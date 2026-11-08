// @vitest-environment node
// REAL PostgreSQL tests (Supabase Postgres image + the project's migrations). Skipped, loudly, if TEST_DATABASE_URL is unset.
import { afterAll, describe, expect, it } from "vitest";
import { canGiveTo, GROUPS } from "../../src/lib/compat";
import { as, DB_URL, makeAdmin, makeDonor, makeRequest, makeRequester, makeUser, pool, root } from "./helpers";

if (!DB_URL) console.warn("\n⚠ TEST_DATABASE_URL not set: database/RLS tests SKIPPED (run `npm run db:up` first)\n");
const d = DB_URL ? describe : describe.skip;
afterAll(() => pool.end());

d("signup trigger & privilege escalation", () => {
  it("clamps client-supplied role: 'admin' metadata becomes donor", async () => {
    const id = await makeUser({ role: "admin" });
    expect((await root("select role from public.profiles where id=$1", [id]))[0].role).toBe("donor");
  });
  it("honours requester role and creates no donor profile for requesters", async () => {
    const id = await makeRequester();
    expect((await root("select role from public.profiles where id=$1", [id]))[0].role).toBe("requester");
    expect(await root("select 1 from public.donor_profiles where user_id=$1", [id])).toHaveLength(0);
  });
  it("rejects invalid profile data at the database", async () => {
    await expect(makeUser({ full_name: "X" })).rejects.toThrow(/check constraint/);
    await expect(makeUser({ phone: "abc" })).rejects.toThrow(/check constraint/);
    await expect(makeUser({ blood_group: "Z+" })).rejects.toThrow();
  });
  it("creates a welcome notification", async () => {
    const id = await makeDonor();
    expect(await as(id, (q) => q("select * from public.notifications"))).toHaveLength(1);
  });
});

d("profiles", () => {
  it("a user sees only their own profile; admin sees all", async () => {
    const a = await makeDonor(), b = await makeRequester(), admin = await makeAdmin();
    expect(await as(a, (q) => q("select id from public.profiles"))).toEqual([{ id: a }]);
    expect((await as(admin, (q) => q("select id from public.profiles"))).map((r) => r.id)).toEqual(expect.arrayContaining([a, b, admin]));
  });
  it("anonymous users cannot read anything", async () => {
    await expect(as(null, (q) => q("select * from public.profiles"))).rejects.toThrow(/permission denied/);
    await expect(as(null, (q) => q("select * from public.blood_requests"))).rejects.toThrow(/permission denied/);
  });
  it("users cannot change their role or id (column privileges)", async () => {
    const a = await makeDonor();
    await expect(as(a, (q) => q("update public.profiles set role='admin' where id=$1", [a]))).rejects.toThrow(/permission denied/);
    await expect(as(a, (q) => q("update public.profiles set id=gen_random_uuid() where id=$1", [a]))).rejects.toThrow(/permission denied/);
    expect((await root("select role from public.profiles where id=$1", [a]))[0].role).toBe("donor");
  });
  it("users can update own details but not someone else's", async () => {
    const a = await makeDonor(), b = await makeDonor();
    await as(a, (q) => q("update public.profiles set city='Karachi' where id=$1", [a]));
    expect((await root("select city from public.profiles where id=$1", [a]))[0].city).toBe("Karachi");
    const hit = await as(a, (q) => q("update public.profiles set city='Hacked' where id=$1 returning id", [b]));
    expect(hit).toHaveLength(0);
    expect((await root("select city from public.profiles where id=$1", [b]))[0].city).toBe("Lahore");
    await expect(as(a, (q) => q("update public.profiles set phone='nope' where id=$1", [a]))).rejects.toThrow(/check constraint/);
  });
  it("nobody can remove profiles or insert them directly", async () => {
    const a = await makeDonor(), admin = await makeAdmin();
    await expect(as(a, (q) => q("delete from public.profiles where id=$1", [a]))).rejects.toThrow(/permission denied/);
    await expect(as(admin, (q) => q("delete from public.profiles where id=$1", [a]))).rejects.toThrow(/permission denied/);
    await expect(as(a, (q) => q("insert into public.profiles (id, full_name, city) values (gen_random_uuid(),'Ab','Cd')"))).rejects.toThrow(/permission denied/);
  });
});

d("donor profiles & eligibility (healthcare decision stays with staff)", () => {
  it("donors read/update only their own donor profile", async () => {
    const a = await makeDonor("A+"), b = await makeDonor("B+");
    expect((await as(a, (q) => q("select blood_group from public.donor_profiles"))).map((r) => r.blood_group)).toEqual(["A+"]);
    await as(a, (q) => q("update public.donor_profiles set available=false where user_id=$1", [a]));
    expect(await as(a, (q) => q("update public.donor_profiles set available=false where user_id=$1 returning 1", [b]))).toHaveLength(0);
    expect((await root("select available from public.donor_profiles where user_id=$1", [b]))[0].available).toBe(true);
  });
  it("donors cannot self-clear eligibility", async () => {
    const a = await makeDonor();
    await expect(as(a, (q) => q("update public.donor_profiles set eligibility_status='cleared' where user_id=$1", [a]))).rejects.toThrow(/permission denied/);
    await expect(as(a, (q) => q("select public.set_donor_eligibility($1,'cleared','self')", [a]))).rejects.toThrow(/Administrators only/);
  });
  it("only an admin can set eligibility; it is audited and notified", async () => {
    const a = await makeDonor(), admin = await makeAdmin();
    await as(admin, (q) => q("select public.set_donor_eligibility($1,'deferred','Staff decision')", [a]));
    expect((await as(a, (q) => q("select eligibility_status from public.donor_profiles")))[0].eligibility_status).toBe("deferred");
    expect(await as(admin, (q) => q("select 1 from public.audit_logs where action='eligibility.set' and entity_id=$1", [a]))).toHaveLength(1);
  });
  it("rejects future last-donation dates", async () => {
    const a = await makeDonor();
    await expect(as(a, (q) => q("update public.donor_profiles set last_donation_date = current_date + 1 where user_id=$1", [a]))).rejects.toThrow(/check constraint/);
  });
  it("encodes no donation interval: a donation yesterday does not block matching by itself", async () => {
    const a = await makeDonor("O+"), r = await makeRequester();
    await makeRequest(r, "O+");
    await as(a, (q) => q("update public.donor_profiles set last_donation_date = current_date - 1 where user_id=$1", [a]));
    expect((await as(a, (q) => q("select * from public.open_requests_for_donor()"))).length).toBeGreaterThan(0);
  });
});

d("blood requests", () => {
  it("only requesters can create requests, and only as themselves", async () => {
    const don = await makeDonor(), req = await makeRequester(), other = await makeRequester();
    const sql = "insert into public.blood_requests (requester_id,patient_label,blood_group,units,city,hospital,urgency) values ($1,'Pat','A+',1,'Lahore','Hosp','urgent')";
    await expect(as(don, (q) => q(sql, [don]))).rejects.toThrow(/row-level security/);
    await expect(as(req, (q) => q(sql, [other]))).rejects.toThrow(/row-level security/);
    await as(req, (q) => q(sql, [req]));
  });
  it("validates request fields", async () => {
    const req = await makeRequester();
    await expect(as(req, (q) => q("insert into public.blood_requests (requester_id,patient_label,blood_group,units,city,hospital,urgency) values ($1,'Pat','A+',99,'Lahore','Hosp','urgent')", [req]))).rejects.toThrow(/check constraint/);
  });
  it("requesters see only their own requests; donors none directly; admin all", async () => {
    const r1 = await makeRequester(), r2 = await makeRequester(), don = await makeDonor("O+"), admin = await makeAdmin();
    const id1 = await makeRequest(r1), id2 = await makeRequest(r2);
    expect((await as(r1, (q) => q("select id from public.blood_requests"))).map((r) => r.id)).toEqual([id1]);
    expect(await as(don, (q) => q("select id from public.blood_requests"))).toHaveLength(0);
    expect((await as(admin, (q) => q("select id from public.blood_requests"))).map((r) => r.id)).toEqual(expect.arrayContaining([id1, id2]));
  });
  it("owner may fulfil/cancel (history recorded) but not set matched/open or touch others' requests", async () => {
    const r1 = await makeRequester(), r2 = await makeRequester(), admin = await makeAdmin();
    const id = await makeRequest(r1);
    await expect(as(r1, (q) => q("update public.blood_requests set status='matched' where id=$1", [id]))).rejects.toThrow(/row-level security/);
    expect(await as(r2, (q) => q("update public.blood_requests set status='cancelled' where id=$1 returning 1", [id]))).toHaveLength(0);
    await expect(as(r1, (q) => q("update public.blood_requests set units=9 where id=$1", [id]))).rejects.toThrow(/permission denied/);
    await as(r1, (q) => q("update public.blood_requests set status='fulfilled' where id=$1", [id]));
    expect((await as(r1, (q) => q("select status from public.request_events where request_id=$1 order by id", [id]))).map((e) => e.status)).toEqual(["open", "fulfilled"]);
    expect(await as(r2, (q) => q("select * from public.request_events where request_id=$1", [id]))).toHaveLength(0);
    expect(await as(admin, (q) => q("select 1 from public.audit_logs where entity_id=$1 and action like 'request.%'", [id]))).toHaveLength(2);
  });
  it("closed requests cannot be reopened or removed", async () => {
    const r1 = await makeRequester(), id = await makeRequest(r1);
    await as(r1, (q) => q("update public.blood_requests set status='cancelled' where id=$1", [id]));
    expect(await as(r1, (q) => q("update public.blood_requests set status='fulfilled' where id=$1 returning 1", [id]))).toHaveLength(0);
    await expect(as(r1, (q) => q("delete from public.blood_requests where id=$1", [id]))).rejects.toThrow(/permission denied/);
  });
});

d("matching, offers and contact consent", () => {
  it("donors see only compatible, available, non-deferred requests, with no requester identity", async () => {
    const req = await makeRequester(), admin = await makeAdmin();
    const abPlus = await makeRequest(req, "AB+"), oNeg = await makeRequest(req, "O-");
    const okDonor = await makeDonor("O-"), aPlusDonor = await makeDonor("A+");
    const unavailable = await makeDonor("O-"), deferred = await makeDonor("O-");
    await as(unavailable, (q) => q("update public.donor_profiles set available=false where user_id=$1", [unavailable]));
    await as(admin, (q) => q("select public.set_donor_eligibility($1,'deferred',null)", [deferred]));
    const ids = (u: string) => as(u, (q) => q<{ id: string }>("select id from public.open_requests_for_donor()")).then((r) => r.map((x) => x.id));
    expect(await ids(okDonor)).toEqual(expect.arrayContaining([abPlus, oNeg]));
    expect(await ids(aPlusDonor)).toContain(abPlus);       // A+ can give to AB+
    expect(await ids(aPlusDonor)).not.toContain(oNeg);     // A+ cannot give to O-
    expect(await ids(unavailable)).toHaveLength(0);
    expect(await ids(deferred)).toHaveLength(0);
    const cols = Object.keys((await as(okDonor, (q) => q("select * from public.open_requests_for_donor() limit 1")))[0]);
    expect(cols).not.toContain("requester_id");
    expect(cols).not.toContain("patient_label");
  });
  it("accept_request enforces role, compatibility and availability", async () => {
    const req = await makeRequester(), id = await makeRequest(req, "O-");
    const bad = await makeDonor("A+");
    await expect(as(bad, (q) => q("select public.accept_request($1,false)", [id]))).rejects.toThrow(/not preliminarily compatible/);
    await expect(as(req, (q) => q("select public.accept_request($1,false)", [id]))).rejects.toThrow(/Only donors/);
    await expect(as(null, (q) => q("select public.accept_request($1,false)", [id]))).rejects.toThrow(/permission denied/);
    await expect(as(await makeDonor("O-"), (q) => q("select public.accept_request(999999,false)"))).rejects.toThrow(/no longer open/);
  });
  it("contact details are hidden without consent, shown with consent, hidden again on revoke", async () => {
    const req = await makeRequester({ phone: "0311 0000000" }), other = await makeRequester(), id = await makeRequest(req, "A+");
    const don = await makeDonor("O+", { phone: "0300 5555555" }), bystander = await makeDonor("O+");
    const [{ accept_request: oid }] = await as(don, (q) => q<{ accept_request: string }>("select public.accept_request($1,false)", [id]));
    const contacts = (u: string) => as(u, (q) => q("select * from public.consented_contacts($1)", [id]));
    expect(await contacts(req)).toHaveLength(0); // accepted but no consent
    expect((await root("select status from public.blood_requests where id=$1", [id]))[0].status).toBe("matched");
    expect(await as(req, (q) => q("select * from public.notifications where message like '%accepted%'"))).toHaveLength(1);

    await as(don, (q) => q("select public.set_contact_consent($1,true)", [oid]));
    const [c] = await contacts(req);
    expect(c).toMatchObject({ phone: "0300 5555555", blood_group: "O+" });
    expect(String(c.email)).toContain("@test.example");
    expect(await contacts(other)).toHaveLength(0);     // other requester
    expect(await contacts(bystander)).toHaveLength(0); // unrelated donor
    expect(await contacts(don)).toHaveLength(0);       // donor is not the request owner

    await expect(as(bystander, (q) => q("select public.set_contact_consent($1,false)", [oid]))).rejects.toThrow(/Offer not found/);
    await as(don, (q) => q("select public.set_contact_consent($1,false)", [oid]));
    expect(await contacts(req)).toHaveLength(0);
    expect(await as(await makeAdmin(), (q) => q("select * from public.audit_logs where action in ('consent.grant','consent.revoke') and entity_id=$1", [oid]))).toHaveLength(2);
  });
  it("offers and consent rows are isolated between users", async () => {
    const req = await makeRequester(), id = await makeRequest(req, "O+");
    const a = await makeDonor("O+"), b = await makeDonor("O+");
    await as(a, (q) => q("select public.accept_request($1,true)", [id]));
    expect(await as(a, (q) => q("select * from public.offers"))).toHaveLength(1);
    expect(await as(b, (q) => q("select * from public.offers"))).toHaveLength(0);
    expect(await as(b, (q) => q("select * from public.contact_consents"))).toHaveLength(0);
    expect(await as(req, (q) => q("select * from public.contact_consents"))).toHaveLength(0); // requester cannot read consent table
    expect(await as(req, (q) => q("select * from public.offers where request_id=$1", [id]))).toHaveLength(1);
    await expect(as(b, (q) => q("insert into public.offers (request_id,donor_id,origin,status) values ($1,$2,'volunteered','accepted')", [id, b]))).rejects.toThrow(/permission denied/);
    await expect(as(a, (q) => q("update public.contact_consents set granted=false"))).rejects.toThrow(/permission denied/);
  });
  it("SQL compatibility table equals the TypeScript reference", async () => {
    const rows = await root<{ donor_group: string; recipient_group: string }>("select donor_group::text, recipient_group::text from public.blood_compat");
    for (const g of GROUPS) expect(rows.filter((r) => r.donor_group === g).map((r) => r.recipient_group).sort()).toEqual([...canGiveTo(g)].sort());
  });
});

d("notifications, audit logs and function exposure", () => {
  it("users read/mark only their own notifications and cannot create any", async () => {
    const a = await makeDonor(), b = await makeDonor();
    expect(await as(a, (q) => q("select * from public.notifications"))).toHaveLength(1);
    expect(await as(a, (q) => q("update public.notifications set is_read=true returning 1"))).toHaveLength(1);
    expect((await root("select is_read from public.notifications where user_id=$1", [b]))[0].is_read).toBe(false);
    await expect(as(a, (q) => q("insert into public.notifications (user_id,message) values ($1,'x')", [b]))).rejects.toThrow(/permission denied/);
    await expect(as(a, (q) => q("update public.notifications set message='x'"))).rejects.toThrow(/permission denied/);
  });
  it("audit logs are admin-read-only and unwritable by users", async () => {
    const a = await makeDonor(), admin = await makeAdmin();
    await as(admin, (q) => q("select public.set_donor_eligibility($1,'cleared',null)", [a]));
    expect(await as(a, (q) => q("select * from public.audit_logs"))).toHaveLength(0);
    expect((await as(admin, (q) => q("select * from public.audit_logs"))).length).toBeGreaterThan(0);
    await expect(as(admin, (q) => q("insert into public.audit_logs (action,entity) values ('x','y')"))).rejects.toThrow(/permission denied/);
    await expect(as(admin, (q) => q("delete from public.audit_logs"))).rejects.toThrow(/permission denied/);
  });
  it("anonymous users cannot execute any application function", async () => {
    for (const fn of ["open_requests_for_donor()", "is_admin()", "consented_contacts(1)"]) {
      await expect(as(null, (q) => q(`select * from public.${fn}`))).rejects.toThrow(/permission denied/);
    }
  });
  it("RLS is enabled on every public table", async () => {
    const rows = await root("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
    expect(rows).toEqual([]);
  });
});
