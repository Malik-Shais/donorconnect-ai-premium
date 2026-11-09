// @vitest-environment node
// Strict same-city matching: invitations, visibility and acceptance (incl. direct RPC calls). REAL PostgreSQL (no mocks).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { approve, as, DB_URL, makeApprovedRequest, makeDonor, makeRequester, pool, root } from "./helpers";

if (!DB_URL) console.warn("\n⚠ TEST_DATABASE_URL not set: same-city tests SKIPPED (run `npm run db:up` first)\n");
const d = DB_URL ? describe : describe.skip;
afterAll(() => pool.end());

const city = () => `City-${randomUUID().slice(0, 8)}`;
const invite = (req: string, id: string) => as(req, (q) => q<{ invite_donors: number }>("select public.invite_donors($1)", [id])).then((r) => r[0].invite_donors);
const offersFor = (donor: string, id: string) => root<{ status: string }>("select status::text from public.offers where request_id=$1 and donor_id=$2", [id, donor]);
const openIds = (donor: string) => as(donor, (q) => q<{ id: string }>("select id from public.open_requests_for_donor()")).then((r) => r.map((x) => x.id));
const accept = (donor: string, id: string, share = false) => as(donor, (q) => q("select public.accept_request($1,$2)", [id, share]));
const statusOf = async (id: string) => (await root<{ status: string }>("select status::text from public.blood_requests where id=$1", [id]))[0].status;

d("invitations only reach compatible, available, eligible, unsuspended, opted-in donors in the request's city", () => {
  it("invites exactly the eligible same-city donors, however many out-of-city donors exist", async () => {
    const c = city(), other = city(), req = await makeRequester();
    const ok1 = await makeDonor("O+", { city: c }), ok2 = await makeDonor("A+", { city: `  ${c.toUpperCase()}  ` }); // case / spacing differences still match
    const far = [await makeDonor("O+", { city: other }), await makeDonor("A+", { city: other }), await makeDonor("O-", { city: other })];
    const wrongGroup = await makeDonor("B+", { city: c }), unavailable = await makeDonor("O+", { city: c }), deferred = await makeDonor("O+", { city: c });
    const suspended = await makeDonor("O+", { city: c }), noNotify = await makeDonor("O+", { city: c });
    await root("update public.donor_profiles set available=false where user_id=$1", [unavailable]);
    await root("update public.donor_profiles set eligibility_status='deferred' where user_id=$1", [deferred]);
    await root("update public.profiles set suspended=true where id=$1", [suspended]);
    await root("update public.donor_profiles set notify_new_requests=false where user_id=$1", [noNotify]);
    const id = await makeApprovedRequest(req, "A+", c);

    expect(await invite(req, id)).toBe(2);
    expect((await root<{ donor_id: string }>("select donor_id from public.offers where request_id=$1", [id])).map((r) => r.donor_id).sort()).toEqual([ok1, ok2].sort());
    for (const x of [...far, wrongGroup, unavailable, deferred, suspended, noNotify]) expect(await offersFor(x, id)).toHaveLength(0);
    expect(await invite(req, id)).toBe(0); // nothing new, no duplicates
    const audit = await root<{ detail: { invited: number; city: string } }>("select detail from public.audit_logs where action='request.invite' and entity_id=$1 order by id", [id]);
    expect(audit[0].detail).toMatchObject({ invited: 2, city: c });
  });

  it("a request in a city with no registered donors invites nobody (even if donors exist elsewhere)", async () => {
    const req = await makeRequester(), c = city();
    await makeDonor("O+", { city: city() }); await makeDonor("A+", { city: city() });
    const id = await makeApprovedRequest(req, "A+", c);
    expect(await invite(req, id)).toBe(0);
    expect(await root("select 1 from public.offers where request_id=$1", [id])).toHaveLength(0);
  });

  it("an exact-spelling mismatch (request 'Gujat' vs donor 'Gujrat') matches nobody: the request must be corrected, not guessed", async () => {
    const req = await makeRequester(), real = city(), donor = await makeDonor("A+", { city: real });
    const id = await makeApprovedRequest(req, "A+", real.slice(0, -1)); // one letter short
    expect(await invite(req, id)).toBe(0);
    expect(await offersFor(donor, id)).toHaveLength(0);
  });

  it("approval notifies only same-city donors, and a donor who later moves into the city sees the request", async () => {
    const c = city(), req = await makeRequester(), near = await makeDonor("O+", { city: c }), moved = await makeDonor("A+", { city: city() });
    const id = await makeApprovedRequest(req, "A+", c);
    const n = (u: string) => as(u, (q) => q<{ n: number }>("select count(*)::int n from public.notifications where dedupe_key=$1", [`req:${id}:approved`])).then((r) => r[0].n);
    expect(await n(near)).toBe(1);
    expect(await n(moved)).toBe(0);
    expect(await openIds(moved)).not.toContain(id);
    await as(moved, (q) => q("update public.profiles set city=$1 where id=auth.uid()", [c])); // the donor saves their profile
    expect(await openIds(moved)).toContain(id);
    expect(await invite(req, id)).toBe(2);
  });
});

d("donors cannot see or accept requests outside their city, including direct RPC calls", () => {
  it("accept_request is refused for an out-of-city donor and creates nothing", async () => {
    const c = city(), req = await makeRequester(), id = await makeApprovedRequest(req, "A+", c), far = await makeDonor("O+", { city: city() });
    expect(await openIds(far)).not.toContain(id);
    await expect(accept(far, id, true)).rejects.toThrow(/outside your city/);
    expect(await offersFor(far, id)).toHaveLength(0);
    expect(await statusOf(id)).toBe("approved"); // not matched
  });

  it("a legacy out-of-city invitation cannot be accepted (respond_to_invitation), but can be declined", async () => {
    const c = city(), req = await makeRequester(), id = await makeApprovedRequest(req, "A+", c), far = await makeDonor("O+", { city: city() });
    const [{ id: oid }] = await root<{ id: string }>("insert into public.offers (request_id, donor_id, origin, status) values ($1,$2,'invited','invited') returning id", [id, far]);
    await expect(as(far, (q) => q("select public.respond_to_invitation($1,'accept',true)", [oid]))).rejects.toThrow(/outside your city/);
    expect((await offersFor(far, id))[0].status).toBe("invited");
    await as(far, (q) => q("select public.respond_to_invitation($1,'decline',false)", [oid]));
    expect((await offersFor(far, id))[0].status).toBe("declined");
  });

  it("cannot be bypassed by writing the offers table directly", async () => {
    const c = city(), req = await makeRequester(), id = await makeApprovedRequest(req, "A+", c), far = await makeDonor("O+", { city: city() });
    await expect(as(far, (q) => q("insert into public.offers (request_id, donor_id, origin, status) values ($1, auth.uid(), 'volunteered', 'accepted')", [id]))).rejects.toThrow(/permission denied|row-level security/);
    expect(await offersFor(far, id)).toHaveLength(0);
  });

  it("an eligible same-city donor can still accept, with consent and blood compatibility preserved", async () => {
    const c = city(), req = await makeRequester(), id = await makeApprovedRequest(req, "A+", c);
    const near = await makeDonor("O+", { city: c, phone: "0300 5550101" }), noShare = await makeDonor("A+", { city: c }), incompatible = await makeDonor("B+", { city: c });
    await expect(accept(incompatible, id)).rejects.toThrow(/not preliminarily compatible/);
    await accept(near, id, true);
    await accept(noShare, id, false);
    const rows = await as(req, (q) => q<{ contact_shared: boolean; phone: string | null }>("select * from public.owner_request_offers($1)", [id]));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.contact_shared).map((r) => r.phone)).toEqual(["0300 5550101"]);
    expect(rows.find((r) => !r.contact_shared)?.phone).toBeNull();
    expect(await statusOf(id)).toBe("matched");
  });

  it("an unapproved request stays invisible and unacceptable even in the donor's own city", async () => {
    const c = city(), req = await makeRequester(), near = await makeDonor("O+", { city: c });
    const [{ id }] = await as(req, (q) => q<{ id: string }>("insert into public.blood_requests (requester_id, patient_label, blood_group, units, city, hospital, urgency) values (auth.uid(),'Patient P','A+',1,$1,'Demo Hospital','urgent') returning id", [c]));
    expect(await openIds(near)).not.toContain(id);
    await expect(accept(near, id)).rejects.toThrow(/not open to donors/);
    await approve(id);
    expect(await openIds(near)).toContain(id);
  });
});
