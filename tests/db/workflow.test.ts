// @vitest-environment node
// Stage 3: request review workflow, transitions, offers, consent, moderation, concurrency. REAL PostgreSQL (no mocks).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { approve, as, DB_URL, getAdmin, makeAdmin, makeApprovedRequest, makeDonor, makeRequest, makeRequester, pool, root } from "./helpers";

if (!DB_URL) console.warn("\n⚠ TEST_DATABASE_URL not set: workflow tests SKIPPED (run `npm run db:up` first)\n");
const d = DB_URL ? describe : describe.skip;
afterAll(() => pool.end());

const city = () => `City-${randomUUID().slice(0, 8)}`; // isolates each test's matching pool from the shared database
const notifs = (u: string, like: string) => as(u, (q) => q<{ n: number }>("select count(*)::int as n from public.notifications where message like $1", [like])).then((r) => r[0].n);
const status = async (id: string) => (await root<{ status: string }>("select status::text from public.blood_requests where id=$1", [id]))[0].status;
const review = (admin: string, id: string, decision: string, note: string | null = null, method: string | null = "hospital_call") =>
  as(admin, (q) => q("select public.review_request($1,$2,$3,$4)", [id, decision, note, method]));
const transition = (u: string, id: string, to: string, note: string | null = null) => as(u, (q) => q("select public.transition_request($1,$2,$3)", [id, to, note]));
const offersOf = (u: string, id: string) => as(u, (q) => q("select * from public.owner_request_offers($1)", [id]));
const mine = (u: string) => as(u, (q) => q<{ offer_id: string; status: string }>("select * from public.my_offers()"));

d("review queue: unapproved requests are invisible to donors", () => {
  it("a new request is pending_review, notifies admins once, and never reaches donors", async () => {
    const admin = await getAdmin(), c = city(), req = await makeRequester(), donor = await makeDonor("O+", { city: c });
    const id = await makeRequest(req, "A+", c);
    expect(await status(id)).toBe("pending_review");
    expect(await as(admin, (q) => q("select 1 from public.notifications where dedupe_key=$1", [`review:${id}`]))).toHaveLength(1);
    expect((await as(donor, (q) => q("select id from public.open_requests_for_donor()"))).map((r) => r.id)).not.toContain(id); // other approved requests may exist; this one must not
    expect(await notifs(donor, "%request%")).toBe(0);
    await expect(as(donor, (q) => q("select public.accept_request($1,false)", [id]))).rejects.toThrow(/not open to donors/);
  });

  it("only administrators can review; decisions need the right inputs", async () => {
    const admin = await getAdmin(), req = await makeRequester(), donor = await makeDonor(), id = await makeRequest(req);
    await expect(review(req, id, "approve")).rejects.toThrow(/Administrators only/);
    await expect(review(donor, id, "approve")).rejects.toThrow(/Administrators only/);
    await expect(review(admin, id, "approve", null, null)).rejects.toThrow(/how the request was verified/);
    await expect(review(admin, id, "reject", "no")).rejects.toThrow(/reason/);
    await expect(review(admin, id, "maybe")).rejects.toThrow(/Invalid decision/);
    await expect(review(admin, "999999", "approve")).rejects.toThrow(/not found/);
    expect(await status(id)).toBe("pending_review");
  });

  it("approval publishes the request and notifies ONLY same-city, compatible, available, opted-in donors, once", async () => {
    const admin = await getAdmin(), c = city(), req = await makeRequester();
    const match = await makeDonor("O-", { city: c }), farAway = await makeDonor("O-", { city: city() }), incompatible = await makeDonor("A+", { city: c });
    const optedOut = await makeDonor("O+", { city: c }), unavailable = await makeDonor("O+", { city: c }), deferred = await makeDonor("O+", { city: c });
    await as(optedOut, (q) => q("update public.donor_profiles set notify_new_requests=false where user_id=$1", [optedOut]));
    await as(unavailable, (q) => q("update public.donor_profiles set available=false where user_id=$1", [unavailable]));
    await as(admin, (q) => q("select public.set_donor_eligibility($1,'deferred','Test Blood Service',null)", [deferred]));
    const id = await makeRequest(req, "O-", c);
    await review(admin, id, "approve", "Confirmed by phone");
    expect(await status(id)).toBe("approved");
    expect(await notifs(match, "%O- request in%")).toBe(1);
    for (const u of [farAway, incompatible, optedOut, unavailable, deferred]) expect(await notifs(u, "%O- request in%")).toBe(0);
    expect((await as(match, (q) => q("select id from public.open_requests_for_donor()"))).map((r) => r.id)).toContain(id);
    await expect(review(admin, id, "approve")).rejects.toThrow(/already been reviewed/); // no second wave of notifications
    expect(await notifs(match, "%O- request in%")).toBe(1);
    const [row] = await root("select reviewed_by, verification_method, review_note from public.blood_requests where id=$1", [id]);
    expect(row).toMatchObject({ reviewed_by: admin, verification_method: "hospital_call", review_note: "Confirmed by phone" });
    expect(await notifs(req, "%approved%")).toBe(1);
  });

  it("rejection is terminal, tells the requester why, and never notifies donors", async () => {
    const admin = await getAdmin(), c = city(), req = await makeRequester(), donor = await makeDonor("O+", { city: c });
    const id = await makeRequest(req, "A+", c);
    await review(admin, id, "reject", "Could not verify the hospital", null);
    expect(await status(id)).toBe("rejected");
    expect(await notifs(req, "%Could not verify the hospital%")).toBe(1);
    expect(await notifs(donor, "%request%")).toBe(0);
    expect((await as(donor, (q) => q("select id from public.open_requests_for_donor()"))).map((r) => r.id)).not.toContain(id);
    await expect(as(donor, (q) => q("select public.accept_request($1,false)", [id]))).rejects.toThrow(/not open to donors/);
    await expect(transition(req, id, "cancelled")).rejects.toThrow(/not allowed while the request is rejected/);
    await expect(review(admin, id, "approve")).rejects.toThrow(/already been reviewed/);
    const events = await as(req, (q) => q<{ status: string; note: string | null }>("select status::text, note from public.request_events where request_id=$1 order by id", [id]));
    expect(events.map((e) => e.status)).toEqual(["pending_review", "rejected"]);
    expect(events[1].note).toBe("Could not verify the hospital");
  });

  it("history and audit trail record the decision without any contact details", async () => {
    const admin = await getAdmin(), req = await makeRequester({ phone: "0311 4444444" }), id = await makeRequest(req);
    await approve(id);
    const audit = await as(admin, (q) => q<{ action: string; detail: unknown }>("select action, detail from public.audit_logs where entity='blood_requests' and entity_id=$1 order by id", [id]));
    expect(audit.map((a) => a.action)).toEqual(["request.submit", "request.transition", "request.review"]);
    expect(JSON.stringify(audit)).not.toMatch(/0311|@test\.example/);
    expect(await as(req, (q) => q("select * from public.audit_logs"))).toHaveLength(0); // audit is admin-only
  });
});

d("status transitions are authorised in the server AND the database", () => {
  it("requester may cancel at any live stage; fulfil only from matched", async () => {
    const req = await makeRequester(), donor = await makeDonor("O+");
    const pending = await makeRequest(req), approvedId = await makeApprovedRequest(req), matched = await makeApprovedRequest(req, "A+");
    await as(donor, (q) => q("select public.accept_request($1,false)", [matched]));
    expect(await status(matched)).toBe("matched");
    for (const id of [pending, approvedId]) { await transition(req, id, "cancelled", "No longer needed"); expect(await status(id)).toBe("cancelled"); }
    const another = await makeApprovedRequest(req);
    await expect(transition(req, another, "fulfilled")).rejects.toThrow(/not allowed while the request is approved/);
    await transition(req, matched, "fulfilled");
    expect(await status(matched)).toBe("fulfilled");
    await expect(transition(req, matched, "cancelled")).rejects.toThrow(/not allowed/); // terminal
  });

  it("nobody can approve/reject through transition_request, or move other people's requests", async () => {
    const req = await makeRequester(), other = await makeRequester(), donor = await makeDonor(), id = await makeRequest(req);
    await expect(transition(req, id, "approved")).rejects.toThrow(/review action/);
    await expect(transition(other, id, "cancelled")).rejects.toThrow(/Request not found/);
    await expect(transition(donor, id, "cancelled")).rejects.toThrow(/Request not found/);
    await expect(as(null, (q) => q("select public.transition_request($1,'cancelled',null)", [id]))).rejects.toThrow(/permission denied/);
    expect(await status(id)).toBe("pending_review");
  });

  it("direct table updates are impossible for every app role, and the trigger blocks invalid jumps even for privileged roles", async () => {
    const admin = await getAdmin(), req = await makeRequester(), id = await makeRequest(req);
    for (const u of [req, admin]) await expect(as(u, (q) => q("update public.blood_requests set status='approved' where id=$1", [id]))).rejects.toThrow(/permission denied/);
    await expect(root("update public.blood_requests set status='fulfilled' where id=$1", [id])).rejects.toThrow(/Invalid status change/);
    await expect(root("update public.blood_requests set status='matched' where id=$1", [id])).rejects.toThrow(/Invalid status change/);
    await review(admin, id, "reject", "Duplicate of another request", null);
    for (const to of ["approved", "pending_review", "matched", "fulfilled", "cancelled"])
      await expect(root(`update public.blood_requests set status='${to}' where id=$1`, [id])).rejects.toThrow(/Invalid status change/); // rejected is terminal
    expect(await status(id)).toBe("rejected");
  });

  it("admin moderation needs a note, notifies the requester and involved donors, and is audited", async () => {
    const admin = await getAdmin(), req = await makeRequester(), donor = await makeDonor("O+", { city: city() }), id = await makeApprovedRequest(req, "A+");
    await as(donor, (q) => q("select public.accept_request($1,false)", [id]));
    await expect(transition(admin, id, "cancelled")).rejects.toThrow(/moderation note/);
    await expect(transition(admin, id, "fulfilled", "Marked by admin")).rejects.toThrow(/not allowed/); // admins cannot fulfil
    await transition(admin, id, "cancelled", "Request violates the posting policy");
    expect(await status(id)).toBe("cancelled");
    expect(await notifs(req, "%administrator cancelled%")).toBe(1);
    expect(await notifs(donor, "%now cancelled%")).toBe(1);
    expect(await as(admin, (q) => q("select 1 from public.audit_logs where entity_id=$1 and action='request.moderate'", [id]))).toHaveLength(1);
    expect((await as(req, (q) => q<{ note: string }>("select note from public.request_events where request_id=$1 order by id desc limit 1", [id])))[0].note).toBe("Request violates the posting policy");
  });
});

d("offers: invitations, idempotency, withdrawal and races", () => {
  it("accepting twice creates one offer and one notification", async () => {
    const req = await makeRequester(), donor = await makeDonor("O+", { city: city() }), id = await makeApprovedRequest(req, "A+");
    const a = await as(donor, (q) => q<{ accept_request: string }>("select public.accept_request($1,true)", [id]));
    const b = await as(donor, (q) => q<{ accept_request: string }>("select public.accept_request($1,false)", [id]));
    expect(a[0].accept_request).toBe(b[0].accept_request);
    expect(await mine(donor)).toHaveLength(1);
    expect(await notifs(req, "%accepted%")).toBe(1);
  });

  it("race: simultaneous accepts by the same donor produce exactly one offer, one notification, one 'matched' event", async () => {
    const req = await makeRequester(), donor = await makeDonor("O+", { city: city() }), id = await makeApprovedRequest(req, "A+");
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => as(donor, (q) => q("select public.accept_request($1,true)", [id]))));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect((await root("select count(*)::int n from public.offers where request_id=$1", [id]))[0].n).toBe(1);
    expect(await notifs(req, "%accepted%")).toBe(1);
    expect((await root("select count(*)::int n from public.request_events where request_id=$1 and status='matched'", [id]))[0].n).toBe(1);
  });

  it("race: a concurrent approve and reject resolve to exactly one decision", async () => {
    const admin = await getAdmin(), admin2 = await makeAdmin(), req = await makeRequester(), id = await makeRequest(req);
    const results = await Promise.allSettled([review(admin, id, "approve"), review(admin2, id, "reject", "Policy reason here", null)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(["approved", "rejected"]).toContain(await status(id));
    expect((await root("select count(*)::int n from public.audit_logs where entity_id=$1 and action='request.review'", [id]))[0].n).toBe(1);
  });

  it("race: simultaneous cancel and accept never leave an inconsistent request", async () => {
    const req = await makeRequester(), donor = await makeDonor("O+", { city: city() }), id = await makeApprovedRequest(req, "A+");
    await Promise.allSettled([transition(req, id, "cancelled"), as(donor, (q) => q("select public.accept_request($1,false)", [id]))]);
    expect(await status(id)).toBe("cancelled"); // either order ends cancelled; never matched-after-cancelled
  });

  it("invitations: owner-only, approved-only, same city first, no donor identities, never duplicated", async () => {
    const c = city(), req = await makeRequester(), other = await makeRequester(), pending = await makeRequest(req, "A+", c);
    const d1 = await makeDonor("O+", { city: c }), d2 = await makeDonor("A+", { city: c }), tooFar = await makeDonor("B+", { city: c }); // B+ cannot give to A+
    await expect(as(req, (q) => q("select public.invite_donors($1)", [pending]))).rejects.toThrow(/once the request is approved/);
    await approve(pending);
    await expect(as(other, (q) => q("select public.invite_donors($1)", [pending]))).rejects.toThrow(/Request not found/);
    await expect(as(d1, (q) => q("select public.invite_donors($1)", [pending]))).rejects.toThrow(/Only requesters/);
    const [{ invite_donors: n1 }] = await as(req, (q) => q<{ invite_donors: number }>("select public.invite_donors($1)", [pending]));
    expect(n1).toBeGreaterThanOrEqual(2);
    for (const donor of [d1, d2]) { expect((await mine(donor))[0].status).toBe("invited"); expect(await notifs(donor, "%invited%")).toBe(1); }
    expect(await mine(tooFar)).toHaveLength(0);
    const [{ invite_donors: n2 }] = await as(req, (q) => q<{ invite_donors: number }>("select public.invite_donors($1)", [pending]));
    const total = (await root("select count(*)::int n from public.offers where request_id=$1", [pending]))[0].n;
    expect(total).toBe(n1 + n2); // second call only adds donors not yet invited
    expect(await notifs(d1, "%invited%")).toBe(1);
    const rows = await offersOf(req, pending);
    expect(Object.keys(rows[0])).not.toEqual(expect.arrayContaining(["donor_id"]));
    expect(rows.every((r) => r.contact_shared === false && r.phone === null)).toBe(true); // invited donors stay anonymous
  });

  it("accept/decline invitations: only the invited donor, only once", async () => {
    const c = city(), req = await makeRequester(), id = await makeApprovedRequest(req, "A+", c);
    const d1 = await makeDonor("O+", { city: c }), d2 = await makeDonor("O+", { city: c }), stranger = await makeDonor("O+", { city: city() });
    await as(req, (q) => q("select public.invite_donors($1)", [id]));
    const [o1] = await mine(d1), [o2] = await mine(d2);
    await expect(as(stranger, (q) => q("select public.respond_to_invitation($1,'accept',true)", [o1.offer_id]))).rejects.toThrow(/Invitation not found/);
    await as(d1, (q) => q("select public.respond_to_invitation($1,'decline',false)", [o1.offer_id]));
    expect((await mine(d1))[0].status).toBe("declined");
    await expect(as(d1, (q) => q("select public.respond_to_invitation($1,'accept',false)", [o1.offer_id]))).rejects.toThrow(/already responded/);
    await expect(as(d2, (q) => q("select public.respond_to_invitation($1,'dance',false)", [o2.offer_id]))).rejects.toThrow(/Invalid action/);
    await as(d2, (q) => q("select public.respond_to_invitation($1,'accept',true)", [o2.offer_id]));
    expect((await mine(d2))[0].status).toBe("accepted");
    expect(await status(id)).toBe("matched");
  });

  it("withdrawing revokes consent; the request reopens only when the LAST accepted donor withdraws; re-accepting reuses the same offer", async () => {
    const c = city(), req = await makeRequester(), id = await makeApprovedRequest(req, "A+", c);
    const d1 = await makeDonor("O+", { city: c }), d2 = await makeDonor("O+", { city: c });
    await as(d1, (q) => q("select public.accept_request($1,true)", [id])); await as(d2, (q) => q("select public.accept_request($1,true)", [id]));
    const [o1] = await mine(d1);
    await as(d1, (q) => q("select public.withdraw_offer($1)", [o1.offer_id]));
    expect(await status(id)).toBe("matched"); // d2 is still in
    expect((await offersOf(req, id)).filter((r) => r.contact_shared)).toHaveLength(1); // d1's consent died with the withdrawal
    await expect(as(d1, (q) => q("select public.withdraw_offer($1)", [o1.offer_id]))).rejects.toThrow(/Only an accepted offer/);
    const [o2] = await mine(d2);
    await as(d2, (q) => q("select public.withdraw_offer($1)", [o2.offer_id]));
    expect(await status(id)).toBe("approved");
    await as(d1, (q) => q("select public.accept_request($1,false)", [id]));
    expect(await mine(d1)).toHaveLength(1); // same offer row reused
    expect((await mine(d1))[0].status).toBe("accepted");
    expect(await status(id)).toBe("matched");
  });
});

d("contact consent and disclosure", () => {
  it("contacts are visible only while the request is active, never to admins, and the disclosure is audited without content", async () => {
    const admin = await getAdmin(), req = await makeRequester(), id = await makeApprovedRequest(req, "A+");
    const donor = await makeDonor("O+", { city: city(), phone: "0300 9998887" });
    const [{ accept_request: oid }] = await as(donor, (q) => q<{ accept_request: string }>("select public.accept_request($1,true)", [id]));
    expect((await offersOf(req, id))[0]).toMatchObject({ contact_shared: true, phone: "0300 9998887" });
    await offersOf(req, id); // second view inside 10 minutes must not add another audit row
    const audit = await as(admin, (q) => q<{ detail: unknown }>("select detail from public.audit_logs where entity_id=$1 and action='contact.disclosed'", [id]));
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toEqual({ contacts: 1 });
    expect(JSON.stringify(await as(admin, (q) => q("select * from public.audit_logs where entity_id in ($1,$2)", [id, oid])))).not.toMatch(/9998887|@test\.example/);
    expect((await offersOf(admin, id))[0]).toMatchObject({ contact_shared: false, phone: null, email: null }); // admin sees the offer exists, never contact
    await as(req, (q) => q("select public.transition_request($1,'cancelled',null)", [id]));
    expect((await offersOf(req, id))[0]).toMatchObject({ contact_shared: false, phone: null }); // closed request: contact no longer disclosed
    await expect(as(donor, (q) => q("select public.set_contact_consent($1,true)", [oid]))).rejects.toThrow(/active, accepted offer/);
    await as(donor, (q) => q("select public.set_contact_consent($1,false)", [oid])); // revoking is always allowed
  });

  it("revocation takes effect immediately for future views; granting later works while the offer is active", async () => {
    const req = await makeRequester(), id = await makeApprovedRequest(req, "A+"), donor = await makeDonor("O+", { city: city(), phone: "0300 1010101" });
    const oid = (await as(donor, (q) => q<{ accept_request: string }>("select public.accept_request($1,false)", [id])))[0].accept_request;
    expect((await offersOf(req, id))[0].phone).toBeNull();
    await as(donor, (q) => q("select public.set_contact_consent($1,true)", [oid]));
    expect((await offersOf(req, id))[0].phone).toBe("0300 1010101");
    await as(donor, (q) => q("select public.set_contact_consent($1,false)", [oid]));
    expect((await offersOf(req, id))[0]).toMatchObject({ contact_shared: false, phone: null, donor_name: null });
  });

  it("donors never learn the patient label or requester identity", async () => {
    const req = await makeRequester({ full_name: "Secret Requester Name" }), c = city(), donor = await makeDonor("O+", { city: c });
    const id = await makeApprovedRequest(req, "A+", c);
    await as(donor, (q) => q("select public.accept_request($1,true)", [id]));
    const seen = JSON.stringify([await as(donor, (q) => q("select * from public.open_requests_for_donor()")), await mine(donor)]);
    expect(seen).not.toMatch(/Patient X|Secret Requester Name|requester_id/);
    expect(await as(donor, (q) => q("select * from public.blood_requests"))).toHaveLength(0);
    expect(await as(donor, (q) => q("select * from public.profiles where id <> $1", [donor]))).toHaveLength(0);
  });
});

d("moderation, eligibility recording and malicious attempts", () => {
  it("suspended accounts lose donor/requester/admin capabilities immediately; restoring brings them back", async () => {
    const admin = await getAdmin(), c = city(), req = await makeRequester(), donor = await makeDonor("O+", { city: c }), id = await makeApprovedRequest(req, "A+", c);
    await as(admin, (q) => q("select public.set_user_suspended($1,true,'Repeated policy violations')", [donor]));
    expect(await as(donor, (q) => q("select * from public.open_requests_for_donor()"))).toHaveLength(0);
    await expect(as(donor, (q) => q("select public.accept_request($1,false)", [id]))).rejects.toThrow(/Only donors/);
    await as(admin, (q) => q("select public.set_user_suspended($1,true,'Repeated policy violations')", [req]));
    await expect(makeRequest(req)).rejects.toThrow(/row-level security/);
    const admin2 = await makeAdmin();
    await root("update public.profiles set suspended=true where id=$1", [admin2]); // a suspended admin is no longer an admin
    expect((await as(admin2, (q) => q<{ is_admin: boolean }>("select public.is_admin()")))[0].is_admin).toBe(false);
    await expect(review(admin2, id, "approve")).rejects.toThrow(/Administrators only/);
    await as(admin, (q) => q("select public.set_user_suspended($1,false,null)", [donor]));
    await as(donor, (q) => q("select public.accept_request($1,false)", [id]));
    expect(await as(admin, (q) => q("select 1 from public.audit_logs where entity_id=$1 and action in ('user.suspend','user.restore')", [donor]))).toHaveLength(2);
  });

  it("suspension rules: admin-only, reason required, admins and self protected", async () => {
    const admin = await getAdmin(), donor = await makeDonor(), other = await makeDonor(), admin2 = await makeAdmin();
    await expect(as(donor, (q) => q("select public.set_user_suspended($1,true,'Because I can')", [other]))).rejects.toThrow(/Administrators only/);
    await expect(as(admin, (q) => q("select public.set_user_suspended($1,true,'no')", [donor]))).rejects.toThrow(/reason/);
    await expect(as(admin, (q) => q("select public.set_user_suspended($1,true,'Testing rules')", [admin2]))).rejects.toThrow(/cannot be suspended/);
    await expect(as(admin, (q) => q("select public.set_user_suspended($1,true,'Testing rules')", [admin]))).rejects.toThrow(/cannot be suspended/);
    await expect(as(donor, (q) => q("update public.profiles set suspended=false where id=$1", [donor]))).rejects.toThrow(/permission denied/);
  });

  it("eligibility is RECORDED from a named blood-service source, audited, and removes the donor from matching", async () => {
    const admin = await getAdmin(), c = city(), req = await makeRequester(), donor = await makeDonor("O+", { city: c }), id = await makeApprovedRequest(req, "A+", c);
    await expect(as(admin, (q) => q("select public.set_donor_eligibility($1,'deferred','',null)", [donor]))).rejects.toThrow(/Name the blood service/);
    await expect(as(donor, (q) => q("select public.set_donor_eligibility($1,'cleared','Me myself',null)", [donor]))).rejects.toThrow(/Administrators only/);
    await expect(as(req, (q) => q("select public.set_donor_eligibility($1,'cleared','Me myself',null)", [donor]))).rejects.toThrow(/Administrators only/);
    await as(admin, (q) => q("select public.set_donor_eligibility($1,'deferred','City Blood Bank ref 42','Temporary deferral')", [donor]));
    const [row] = await as(donor, (q) => q("select eligibility_status, eligibility_source, eligibility_recorded_by from public.donor_profiles"));
    expect(row).toMatchObject({ eligibility_status: "deferred", eligibility_source: "City Blood Bank ref 42", eligibility_recorded_by: admin });
    expect(await as(donor, (q) => q("select * from public.open_requests_for_donor()"))).toHaveLength(0);
    await expect(as(donor, (q) => q("select public.accept_request($1,false)", [id]))).rejects.toThrow(/not currently available/);
    expect(await notifs(donor, "%blood service decision%")).toBe(1);
    expect(await as(admin, (q) => q("select 1 from public.audit_logs where entity_id=$1 and action='eligibility.record'", [donor]))).toHaveLength(1);
  });

  it("malicious attempts: role changes, internal helpers, forged ownership and cross-user notifications", async () => {
    const donor = await makeDonor(), req = await makeRequester(), victim = await makeRequester();
    await expect(as(donor, (q) => q("update public.profiles set role='admin' where id=$1", [donor]))).rejects.toThrow(/permission denied/);
    await expect(as(req, (q) => q("update public.profiles set role='admin', suspended=false where id=$1", [req]))).rejects.toThrow(/permission denied/);
    await expect(as(donor, (q) => q("select public.push_notification($1,'phish','/x','k')", [victim]))).rejects.toThrow(/permission denied/);
    await expect(as(donor, (q) => q("select * from public.matching_donors('O+','Lahore')"))).rejects.toThrow(/permission denied/);
    await expect(as(req, (q) => q("insert into public.blood_requests (requester_id,patient_label,blood_group,units,city,hospital,urgency,status) values ($1,'Pat','A+',1,'Lahore','Hosp','urgent','approved')", [req]))).rejects.toThrow(/permission denied/);
    await expect(as(req, (q) => q("insert into public.blood_requests (requester_id,patient_label,blood_group,units,city,hospital,urgency) values ($1,'Pat','A+',1,'Lahore','Hosp','urgent')", [victim]))).rejects.toThrow(/row-level security/);
    await expect(as(req, (q) => q("update public.blood_requests set reviewed_by=$1", [req]))).rejects.toThrow(/permission denied/);
    expect(await as(victim, (q) => q("select * from public.notifications where message='phish'"))).toHaveLength(0);
  });
});
