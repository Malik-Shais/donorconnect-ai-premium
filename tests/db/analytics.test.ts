// @vitest-environment node
// Stage 6: analytics SQL against a CONTROLLED dataset with hand-calculated expectations, role isolation, suppression, empty data. REAL PostgreSQL.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, DB_URL, getAdmin, makeDonor, makeRequest, makeRequester, makeUser, pool, root } from "./helpers";

if (!DB_URL) console.warn("\n⚠ TEST_DATABASE_URL not set: analytics tests SKIPPED (run `npm run db:up` first)\n");
const d = DB_URL ? describe : describe.skip;
afterAll(() => pool.end());

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const city = `Ana-${randomUUID().slice(0, 8)}`; // every controlled row lives in one unique city, so filters isolate it from the shared database
const day = (offset: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + offset)).toISOString().slice(0, 10);
const T = `${day(-10)}T00:00:00Z`; // base instant for the controlled data
const at = (h: number) => new Date(Date.parse(T) + h * 3600_000).toISOString();
const admin = async (sql: string, p: unknown[] = []) => as(await getAdmin(), (q) => q<J>(sql, p));
const adm = async (opts: { from?: string; to?: string; city?: string | null; group?: string | null; scope?: string; min?: number } = {}) =>
  (await admin("select public.analytics_admin($1::date,$2::date,$3,$4::public.blood_group,$5,$6) as r", [opts.from ?? day(-10), opts.to ?? day(-8), opts.city === undefined ? city : opts.city, opts.group ?? null, opts.scope ?? "all", opts.min ?? 5]))[0].r as J;
const ev = (id: string, status: string, h: number) => root("update public.request_events set created_at=$3 where request_id=$1 and status=$2", [id, status, at(h)]);

let req: string, req2: string, d1: string, d2: string, ids: Record<string, string> = {};

beforeAll(async () => {
  if (!DB_URL) return;
  const a = await getAdmin(); req = await makeRequester({ city }); req2 = await makeRequester({ city });
  d1 = await makeDonor("O+", { city }); d2 = await makeDonor("O+", { city });
  await makeDonor("A-", { city }); const d4 = await makeDonor("AB+", { city }), d5 = await makeDonor("O-", { city });
  await root("update public.donor_profiles set eligibility_status='deferred' where user_id=$1", [d4]); // available but deferred: not supply
  await root("update public.donor_profiles set available=false where user_id=$1", [d5]);            // unavailable: not supply
  const approve = (id: string) => as(a, (q) => q("select public.review_request($1,'approve',null,'hospital_call')", [id]));
  ids = { r1: await makeRequest(req, "A+", city), r2: await makeRequest(req, "A+", city), r3: await makeRequest(req2, "B+", city), r4: await makeRequest(req2, "B+", city), r5: await makeRequest(req2, "O+", city) };
  await approve(ids.r1); await approve(ids.r2); await approve(ids.r4);
  await as(a, (q) => q("select public.review_request($1,'reject','not verifiable by phone',null)", [ids.r3]));
  await as(req2, (q) => q("select public.transition_request($1,'cancelled',null)", [ids.r5]));
  await as(req, (q) => q("select public.invite_donors($1)", [ids.r2])); // invites d1 and d2 (O+, same city, available) -> 2 invitations
  await as(d1, (q) => q("select public.accept_request($1,true)", [ids.r1]));       // volunteered, shares contact
  await as(d2, (q) => q("select public.respond_to_invitation(o.id,'accept',false) from public.offers o where o.request_id=$1 and o.donor_id=$2", [ids.r2, d2]));
  await as(req, (q) => q("select public.transition_request($1,'fulfilled',null)", [ids.r1]));
  // deterministic timestamps (hours after T)
  for (const id of Object.values(ids)) await root("update public.blood_requests set created_at=$2 where id=$1", [id, at(0)]);
  await root("update public.request_events set created_at=$2 where request_id = any($1) and status='pending_review'", [Object.values(ids), at(0)]);
  await root("update public.blood_requests set reviewed_at=$2 where id=$1", [ids.r1, at(2)]); await ev(ids.r1, "approved", 2); await ev(ids.r1, "matched", 5); await ev(ids.r1, "fulfilled", 32);
  await root("update public.blood_requests set reviewed_at=$2 where id=$1", [ids.r2, at(6)]); await ev(ids.r2, "approved", 6); await ev(ids.r2, "matched", 12);
  await root("update public.blood_requests set reviewed_at=$2 where id=$1", [ids.r3, at(4)]); await ev(ids.r3, "rejected", 4);
  await root("update public.blood_requests set reviewed_at=$2 where id=$1", [ids.r4, at(8)]); await ev(ids.r4, "approved", 8);
  await ev(ids.r5, "cancelled", 3);
  await root("update public.offers set created_at=$3, accepted_at=$3, responded_at=$3 where request_id=$1 and donor_id=$2", [ids.r1, d1, at(5)]);
  await root("update public.offers set created_at=$3 where request_id=$1 and donor_id=$2", [ids.r2, d1, at(6)]);                 // d1's invitation: never answered
  await root("update public.offers set created_at=$3, accepted_at=$4, responded_at=$4 where request_id=$1 and donor_id=$2", [ids.r2, d2, at(6), at(12)]);
});

d("admin analytics: controlled dataset with known answers", () => {
  it("counts, distributions and city filter", async () => {
    const r = await adm();
    expect(r.requests.total).toBe(5);
    const by = (k: string) => Object.fromEntries(r.requests[k].map((x: J) => [x.key, x.n]));
    expect(by("by_status")).toMatchObject({ approved: 1, matched: 1, fulfilled: 1, rejected: 1, cancelled: 1, pending_review: 0 });
    expect(by("by_group")).toMatchObject({ "A+": 2, "B+": 2, "O+": 1, "AB-": 0 });
    expect(r.requests.by_group.find((x: J) => x.key === "A+").units).toBe(4);
    expect(r.people).toMatchObject({ donors_total: 5, requesters_total: 2, donors_active: 5, donors_available: 3 }); // d4 deferred, d5 unavailable
  });

  it("rates use the documented numerators and denominators", async () => {
    const { rates } = await adm();
    expect(rates.approval).toEqual({ num: 3, den: 4, rate: 0.75 });      // approved / reviewed (the cancelled request was never reviewed)
    expect(rates.rejection).toEqual({ num: 1, den: 4, rate: 0.25 });
    expect(rates.matching).toEqual({ num: 2, den: 3, rate: 0.6667 });     // matched / approved
    expect(rates.fulfillment).toEqual({ num: 1, den: 3, rate: 0.3333 });  // fulfilled / approved
    expect(rates.cancellation).toEqual({ num: 1, den: 5, rate: 0.2 });
  });

  it("timing medians/p90 with sample sizes and missing data", async () => {
    const { timing } = await adm();
    expect(timing.review).toEqual({ n: 4, median_h: 5, p90_h: 7.4 });            // hours 2,4,6,8
    expect(timing.first_response).toEqual({ n: 2, median_h: 4.5, p90_h: 5.7 });  // 3h and 6h after approval
    expect(timing.approval_to_fulfilled).toEqual({ n: 1, median_h: 30, p90_h: 30 });
    expect(timing.approved_without_response).toBe(1);                              // r4
  });

  it("supply vs demand is preliminary, group-compatible and excludes deferred/unavailable donors; zero demand gives null", async () => {
    const sd = Object.fromEntries((await adm()).supply_demand.map((x: J) => [x.group, x]));
    expect(sd["A+"]).toMatchObject({ demand_requests: 1, demand_units: 2, supply_donors: 3, donors_per_unit: 1.5 }); // O+ x2 and A- ; not AB+ (deferred) or O- (unavailable)
    expect(sd["B+"]).toMatchObject({ demand_requests: 1, demand_units: 2, supply_donors: 2, donors_per_unit: 1 });
    expect(sd["O+"]).toMatchObject({ demand_units: 0, donors_per_unit: null });
  });

  it("invitation, offer and consent workflow statistics", async () => {
    const { workflow } = await adm();
    // invite_donors also invites compatible donors from other cities (up to its cap), so the expected count comes from the table itself
    const inv = Number((await root<{ n: string }>("select count(*) as n from public.offers where request_id=$1 and origin='invited'", [ids.r2]))[0].n);
    expect(inv).toBeGreaterThanOrEqual(2);
    expect(workflow.invitations_sent).toBe(inv);
    expect(workflow.invitation_response).toEqual({ num: 1, den: inv, rate: Math.round((1 / inv) * 1e4) / 1e4 }); // only d2 answered
    expect(workflow.invitation_acceptance).toEqual({ num: 1, den: 1, rate: 1 });
    expect(workflow.offers_accepted).toBe(2);
    expect(workflow.consent_granted).toEqual({ num: 1, den: 2, rate: 0.5 });  // d1 shared, d2 did not
    expect(workflow.consent_revoked).toBe(0);
  });

  it("trend is bucketed per day and uses each event's own date", async () => {
    const r = await adm({ from: day(-10), to: day(-8) });
    expect(r.meta.bucket).toBe("day");
    expect(r.trend.map((p: J) => [p.t, p.created, p.approved, p.fulfilled])).toEqual([[day(-10), 5, 3, 0], [day(-9), 0, 0, 1], [day(-8), 0, 0, 0]]);
  });

  it("date range filter: the cohort is requests created in range", async () => {
    expect((await adm({ from: day(-7), to: day(-1) })).requests.total).toBe(0);
    expect((await adm({ from: day(-10), to: day(-10) })).requests.total).toBe(5);  // both bounds inclusive
  });

  it("blood-group filter and scope: test accounts use the reserved .example TLD, so they are 'demo'", async () => {
    expect((await adm({ group: "A+" })).requests.total).toBe(2);
    expect((await adm({ scope: "demo" })).requests.total).toBe(5);
    const real = await adm({ scope: "real" }); expect(real.requests.total).toBe(0); expect(real.people.donors_total).toBe(0);
    expect((await adm()).meta.demo_accounts).toBeGreaterThan(0);
    const id2 = randomUUID();
    await root(`insert into auth.users (id, aud, role, email, raw_user_meta_data, instance_id) values ($1,'authenticated','authenticated',$2,$3,'00000000-0000-0000-0000-000000000000')`,
      [id2, `person.${id2}@gmail.com`, JSON.stringify({ full_name: "Real Person", city, blood_group: "O+" })]);
    expect((await root<{ is_demo: boolean }>("select is_demo from public.profiles where id=$1", [id2]))[0].is_demo).toBe(false); // a normal domain is real
    expect((await root<{ is_demo: boolean }>("select is_demo from public.profiles where id=$1", [d1]))[0].is_demo).toBe(true);
    await root("delete from auth.users where id=$1", [id2]);
  });

  it("small city segments are merged into 'Other' (minimum group size) and never named", async () => {
    const hidden = await adm({ min: 6 });
    expect(hidden.requests.by_city).toEqual([{ city: "Other (small groups)", n: 5 }]);
    expect(JSON.stringify(hidden)).not.toContain(city);
    expect((await adm({ min: 5 })).requests.by_city).toEqual([{ city, n: 5 }]);
  });

  it("an empty dataset yields zeros and NULL rates (no division by zero)", async () => {
    const r = await adm({ city: `Empty-${randomUUID().slice(0, 6)}` });
    expect(r.requests.total).toBe(0);
    for (const k of ["approval", "rejection", "matching", "fulfillment", "cancellation"]) expect(r.rates[k]).toEqual({ num: 0, den: 0, rate: null });
    expect(r.timing.review).toEqual({ n: 0, median_h: null, p90_h: null });
    expect(r.trend).toHaveLength(3);
    expect(r.supply_demand.every((x: J) => x.donors_per_unit === null)).toBe(true);
  });

  it("input validation", async () => {
    await expect(adm({ from: day(0), to: day(-3) })).rejects.toThrow(/start date/);
    await expect(adm({ from: "2000-01-01", to: day(0) })).rejects.toThrow(/5 years/);
    await expect(adm({ scope: "everything" })).rejects.toThrow(/data scope/);
    await expect(adm({ min: 0 })).rejects.toThrow(/minimum group/);
  });

  it("notification and email statistics from a quiet historical window", async () => {
    await root("delete from public.notifications where created_at < '2002-01-01'"); // only this test writes to 2001; makes reruns idempotent (email_outbox cascades)
    const rows = await root<{ id: string }>(`insert into public.notifications (user_id, message, category, is_read, created_at) values
      ($1,'a','request',true,'2001-03-02'),($1,'b','offer',false,'2001-03-02'),($1,'c','offer',true,'2001-03-03'),($1,'d','invitation',false,'2001-03-03') returning id`, [d1]);
    for (const [i, c] of ["request", "offer", "offer", "invitation"].entries()) await root("update public.notifications set category=$2 where id=$1", [rows[i].id, c]); // the insert trigger derives it from the message
    await root(`insert into public.email_outbox (notification_id, user_id, category, status, created_at) values ($1,$4,'request','sent','2001-03-02'),($2,$4,'offer','sent','2001-03-02'),($3,$4,'offer','failed','2001-03-03')`, [rows[0].id, rows[1].id, rows[2].id, d1]);
    const w = (await adm({ from: "2001-03-01", to: "2001-03-05", city: null })).workflow;
    expect(w.notifications_total).toBe(4);
    expect(w.notifications_read).toEqual({ num: 2, den: 4, rate: 0.5 });
    expect(Object.fromEntries(w.notifications_by_category.map((x: J) => [x.key, x.n]))).toMatchObject({ request: 1, offer: 2, invitation: 1, review: 0 });
    expect(w.email_delivery).toEqual({ num: 2, den: 3, rate: 0.6667 });
  });
});

d("donor and requester analytics are scoped to the caller", () => {
  const don = (u: string) => as(u, (q) => q<J>("select public.analytics_donor($1::date,$2::date,null,null) as r", [day(-10), day(-8)])).then((x) => x[0].r as J);
  it("donor sees only their own offers, with exact counts", async () => {
    const a = await don(d1);
    expect(a.totals).toMatchObject({ offers: 2, invited: 1, volunteered: 1, accepted_ever: 1, accepted_now: 1, completed: 1, awaiting_reply: 1, withdrawn: 0, contact_shared_now: 1 });
    expect(a.rates.invitation_response).toEqual({ num: 0, den: 1, rate: 0 });
    expect(a.rates.completion).toEqual({ num: 1, den: 1, rate: 1 });
    const b = await don(d2);
    expect(b.totals).toMatchObject({ offers: 1, accepted_ever: 1, completed: 0, contact_shared_now: 0 });
    expect(b.timing.invitation_reply).toEqual({ n: 1, median_h: 6, p90_h: 6 });
    expect((await don(await makeDonor("O+", { city }))).totals.offers).toBe(0); // a donor with no activity sees nothing of anyone else's
  });

  it("withdrawal keeps the acceptance on record and clears completion", async () => {
    const c = `Wd-${randomUUID().slice(0, 6)}`, rq = await makeRequester({ city: c }), dn = await makeDonor("O+", { city: c }), a = await getAdmin();
    const id = await makeRequest(rq, "A+", c); await as(a, (q) => q("select public.review_request($1,'approve',null,'hospital_call')", [id]));
    await as(dn, (q) => q("select public.accept_request($1,false)", [id]));
    await as(dn, (q) => q("select public.withdraw_offer(o.id) from public.offers o where o.request_id=$1", [id]));
    const r = (await as(dn, (q) => q<J>("select public.analytics_donor(current_date-1, current_date, null, null) as r")))[0].r;
    expect(r.totals).toMatchObject({ offers: 1, accepted_ever: 1, accepted_now: 0, withdrawn: 1, completed: 0 });
    expect(r.rates.withdrawal).toEqual({ num: 1, den: 1, rate: 1 });
  });

  it("requester sees only their own requests and never donor identities", async () => {
    const r = (await as(req, (q) => q<J>("select public.analytics_requester($1::date,$2::date,null,null) as r", [day(-10), day(-8)])))[0].r;
    expect(r.totals).toMatchObject({ requests: 2, with_accepted_donor: 2, fulfilled: 1 });
    expect(r.rates.response).toEqual({ num: 2, den: 2, rate: 1 });
    expect(r.timing.first_response).toEqual({ n: 2, median_h: 4.5, p90_h: 5.7 });
    expect(JSON.stringify(r)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no uuids (donor or user ids) anywhere in the payload
    const other = (await as(req2, (q) => q<J>("select public.analytics_requester($1::date,$2::date,null,null) as r", [day(-10), day(-8)])))[0].r;
    expect(other.totals).toMatchObject({ requests: 3, with_accepted_donor: 0 });
  });
});

d("authorization", () => {
  const call = (u: string | null, sql: string) => as(u, (q) => q(sql));
  const A = "select public.analytics_admin(current_date-5,current_date)", D = "select public.analytics_donor(current_date-5,current_date,null,null)", R = "select public.analytics_requester(current_date-5,current_date,null,null)";
  it("each report works only for its own role", async () => {
    await expect(call(d1, A)).rejects.toThrow(/Administrators only/); await expect(call(req, A)).rejects.toThrow(/Administrators only/);
    await expect(call(req, D)).rejects.toThrow(/Donors only/); await expect(call(await getAdmin(), D)).rejects.toThrow(/Donors only/);
    await expect(call(d1, R)).rejects.toThrow(/Requesters only/); await expect(call(await getAdmin(), R)).rejects.toThrow(/Requesters only/);
  });
  it("anonymous callers and the private view are refused", async () => {
    await expect(call(null, A)).rejects.toThrow(/permission denied/); await expect(call(null, D)).rejects.toThrow(/permission denied/);
    await expect(call(d1, "select * from public.analytics_request_facts")).rejects.toThrow(/permission denied/);
    await expect(call(await getAdmin(), "select * from public.analytics_request_facts")).rejects.toThrow(/permission denied/);
  });
  it("a suspended administrator loses access", async () => {
    const s = await makeUser({}, "sadm"); await root("update public.profiles set role='admin', suspended=true where id=$1", [s]);
    await expect(call(s, A)).rejects.toThrow(/Administrators only/);
  });
  it("row reports: no sensitive columns, own rows only, pagination, and caps", async () => {
    const rows = await as(await getAdmin(), (q) => q<J>("select * from public.report_requests('admin',$1::date,$2::date,$3,null,'all',2,0)", [day(-10), day(-8), city]));
    expect(rows).toHaveLength(2); expect(Number(rows[0].total_rows)).toBe(5);
    expect(Object.keys(rows[0]).join()).not.toMatch(/hospital|patient|phone|email|requester|note|donor_id|user/);
    expect((await as(await getAdmin(), (q) => q("select * from public.report_requests('admin',$1::date,$2::date,$3,null,'all',2,4)", [day(-10), day(-8), city])))).toHaveLength(1);
    const mine = await as(req, (q) => q<J>("select * from public.report_requests('mine',$1::date,$2::date,null,null,'all',50,0)", [day(-10), day(-8)]));
    expect(mine).toHaveLength(2); expect(Number(mine[0].total_rows)).toBe(2);
    await expect(as(req, (q) => q("select * from public.report_requests('admin',current_date-1,current_date,null,null,'all',5,0)"))).rejects.toThrow(/Administrators only/);
    await expect(as(d1, (q) => q("select * from public.report_requests('mine',current_date-1,current_date,null,null,'all',5,0)"))).rejects.toThrow(/Requesters only/);
    await expect(as(await getAdmin(), (q) => q("select * from public.report_requests('admin',current_date-1,current_date,null,null,'all',10001,0)"))).rejects.toThrow(/Invalid page/);
    const off = await as(d1, (q) => q<J>("select * from public.report_offers_mine($1::date,$2::date,null,null,25,0)", [day(-10), day(-8)]));
    expect(off).toHaveLength(2); expect(Object.keys(off[0]).join()).not.toMatch(/hospital|patient|phone|email|donor_id|requester/);
  });
  it("export access is audited, validated and rate limited", async () => {
    const a = await getAdmin();
    await as(a, (q) => q(`select public.log_report_event('admin.requests', '{"from":"2026-01-01","to":"2026-01-31","rows":"12","email":"leak@x.example"}')`));
    const [row] = await root<J>("select detail from public.audit_logs where action='report.export' and actor_id=$1 order by id desc limit 1", [a]);
    expect(row.detail).toMatchObject({ from: "2026-01-01", rows: "12" }); expect(JSON.stringify(row.detail)).not.toContain("leak@x.example"); // only whitelisted keys are stored
    await expect(as(req, (q) => q("select public.log_report_event('admin.summary')"))).rejects.toThrow(/Administrators only/);
    await expect(as(req, (q) => q("select public.log_report_event('nonsense')"))).rejects.toThrow(/Invalid report/);
    const u = await makeRequester();
    for (let i = 0; i < 30; i++) await as(u, (q) => q("select public.log_report_event('requester.requests')"));
    await expect(as(u, (q) => q("select public.log_report_event('requester.requests')"))).rejects.toThrow(/too often/);
  });
});
