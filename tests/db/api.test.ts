// @vitest-environment node
// LIVE HTTP tests through the real gateway: GoTrue (sign-up/sign-in, real JWTs) -> PostgREST -> PostgreSQL RLS.
// Skipped, loudly, if the local stack is not configured (.env.local from `npm run db:up`).
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) console.warn("\n⚠ Supabase env not set: live API tests SKIPPED (run `npm run db:up` first)\n");
const d = URL_ && ANON ? describe : describe.skip;

type Json = Record<string, unknown>;
const req = async (path: string, token: string | null, init: RequestInit = {}) => {
  const r = await fetch(`${URL_}${path}`, { ...init, headers: { apikey: ANON!, Authorization: `Bearer ${token ?? ANON}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers } });
  const text = await r.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON from the HTTP API
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};
const PASSWORD = "Passw0rd!x";
async function signIn(email: string, password: string) {
  const r = await req("/auth/v1/token?grant_type=password", null, { method: "POST", body: JSON.stringify({ email, password }) });
  expect(r.status, `sign in ${email} (did you run \`npm run db:seed\`?)`).toBe(200);
  return { token: r.body.access_token as string, id: r.body.user.id as string };
}
async function signUp(meta: Json) {
  const email = `api.${randomUUID().slice(0, 8)}@test.example`;
  const r = await req("/auth/v1/signup", null, { method: "POST", body: JSON.stringify({ email, password: PASSWORD, data: { full_name: "Api Tester", city: "Lahore", blood_group: "O+", ...meta } }) });
  expect(r.status).toBe(200);
  return { token: r.body.access_token as string, id: r.body.user.id as string, email };
}

d("live API: authentication and authorization over HTTP", () => {
  it("sign-up with metadata role=admin yields a plain donor (no privilege escalation)", async () => {
    const u = await signUp({ role: "admin" });
    const me = await req("/rest/v1/profiles", u.token);
    expect(me.body).toHaveLength(1);
    expect(me.body[0].role).toBe("donor");
  });

  it("a signed-in user cannot change their role over the API (403), nor another user's data", async () => {
    const a = await signUp({}), b = await signUp({});
    const esc = await req(`/rest/v1/profiles?id=eq.${a.id}`, a.token, { method: "PATCH", body: JSON.stringify({ role: "admin" }) });
    expect(esc.status).toBe(403);
    expect(esc.body.code).toBe("42501");
    const other = await req(`/rest/v1/profiles?id=eq.${b.id}`, a.token, { method: "PATCH", body: JSON.stringify({ city: "Hacked" }) });
    expect(other.body).toEqual([]); // RLS hides the row: nothing updated
    const check = await req(`/rest/v1/profiles?id=eq.${b.id}`, b.token);
    expect(check.body[0].city).toBe("Lahore");
  });

  it("cross-user reads return nothing; anonymous and forged tokens are rejected", async () => {
    const a = await signUp({}), b = await signUp({});
    expect((await req(`/rest/v1/profiles?id=eq.${b.id}`, a.token)).body).toEqual([]);
    expect((await req(`/rest/v1/donor_profiles?user_id=eq.${b.id}`, a.token)).body).toEqual([]);
    expect((await req("/rest/v1/profiles", null)).status).toBe(401); // anon key: permission denied
    const forged = (() => { // valid JWT structure, wrong signing secret, claiming to be user A
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: a.id, role: "authenticated", aud: "authenticated", exp: 4102444800 })}`;
      return `${h}.${createHmac("sha256", "wrong-secret").update(h).digest("base64url")}`;
    })();
    expect((await req("/rest/v1/profiles", forged)).status).toBe(401);
  });

  it("users cannot self-clear medical eligibility or call admin-only functions", async () => {
    const a = await signUp({});
    const self = await req(`/rest/v1/donor_profiles?user_id=eq.${a.id}`, a.token, { method: "PATCH", body: JSON.stringify({ eligibility_status: "cleared" }) });
    expect(self.status).toBe(403);
    const fn = await req("/rest/v1/rpc/set_donor_eligibility", a.token, { method: "POST", body: JSON.stringify({ p_user: a.id, p_status: "cleared", p_source: "Me", p_note: null }) });
    expect(fn.body.message).toMatch(/Administrators only/);
  });

  it("full workflow over HTTP: unapproved requests are invisible, review gate, consent lifecycle, no direct status changes", async () => {
    const city = `Api${randomUUID().slice(0, 6)}`;
    const requester = await signUp({ role: "requester", phone: "0311 7000000", city }), donor = await signUp({ blood_group: "O+", phone: "0300 7000000", city });
    const other = await signUp({ role: "requester" });
    const admin = await signIn("admin@demo.example", "Demo@12345"); // seeded by `npm run db:seed`
    const call = (tok: string, fn: string, body: object = {}) => req(`/rest/v1/rpc/${fn}`, tok, { method: "POST", body: JSON.stringify(body) });
    const offers = (tok: string, rid: number) => call(tok, "owner_request_offers", { p_request_id: rid });
    const base = { requester_id: requester.id, patient_label: "Pat Z.", blood_group: "A+", units: 1, city, hospital: "API Hospital", urgency: "urgent" };

    // a requester cannot create an already-approved request or set review fields
    expect((await req("/rest/v1/blood_requests", requester.token, { method: "POST", body: JSON.stringify({ ...base, status: "approved" }) })).status).toBe(403);
    const created = await req("/rest/v1/blood_requests", requester.token, { method: "POST", body: JSON.stringify(base) });
    expect(created.status).toBe(201);
    expect(created.body[0].status).toBe("pending_review");
    const rid = created.body[0].id;

    // unapproved: invisible to donors, cannot be accepted, donor not notified
    expect((await call(donor.token, "open_requests_for_donor")).body.some((r: Json) => r.id === rid)).toBe(false);
    const early = await call(donor.token, "accept_request", { p_request_id: rid, p_share_contact: true });
    expect(early.status).toBe(400); expect(early.body.message).toMatch(/not open to donors/);
    expect(JSON.stringify((await req("/rest/v1/notifications", donor.token)).body)).not.toMatch(/O\+|A\+ request/);

    // nobody but an admin can review; requesters cannot patch status; other users cannot see the request
    expect((await call(requester.token, "review_request", { p_id: rid, p_decision: "approve", p_method: "other" })).status).toBe(403);
    expect((await req(`/rest/v1/blood_requests?id=eq.${rid}`, requester.token, { method: "PATCH", body: JSON.stringify({ status: "approved" }) })).status).toBe(403);
    expect((await req(`/rest/v1/blood_requests?id=eq.${rid}`, other.token)).body).toEqual([]);
    expect((await call(other.token, "transition_request", { p_id: rid, p_to: "cancelled" })).body.message).toMatch(/Request not found/);

    // admin approves; donor now sees it (without patient label) and accepts without consent
    expect((await call(admin.token, "review_request", { p_id: rid, p_decision: "approve", p_method: "hospital_call", p_note: "ok" })).status).toBe(200);
    const seen = await call(donor.token, "open_requests_for_donor");
    expect(seen.body.some((r: Json) => r.id === rid)).toBe(true);
    expect(JSON.stringify(seen.body)).not.toContain("Pat Z.");
    expect((await req("/rest/v1/blood_requests", donor.token)).body).toEqual([]);
    const accepted = await call(donor.token, "accept_request", { p_request_id: rid, p_share_contact: false });
    expect(accepted.status).toBe(200);
    const offerId = accepted.body;
    expect((await call(donor.token, "accept_request", { p_request_id: rid, p_share_contact: false })).body).toBe(offerId); // idempotent
    expect((await offers(requester.token, rid)).body[0]).toMatchObject({ contact_shared: false, phone: null, email: null });

    // consent grant -> visible to the owner only; admin and others never see contact
    await call(donor.token, "set_contact_consent", { p_offer_id: offerId, p_granted: true });
    expect((await offers(requester.token, rid)).body[0]).toMatchObject({ contact_shared: true, phone: "0300 7000000", email: donor.email });
    expect(JSON.stringify((await offers(admin.token, rid)).body)).not.toMatch(/7000000|@test\.example/);
    expect((await offers(other.token, rid)).body.message).toMatch(/Request not found/);
    expect((await offers(donor.token, rid)).body.message).toMatch(/Request not found/);

    // revoke -> hidden again; re-grant; closing the request hides contact for good
    await call(donor.token, "set_contact_consent", { p_offer_id: offerId, p_granted: false });
    expect((await offers(requester.token, rid)).body[0]).toMatchObject({ contact_shared: false, phone: null });
    await call(donor.token, "set_contact_consent", { p_offer_id: offerId, p_granted: true });
    expect((await call(requester.token, "transition_request", { p_id: rid, p_to: "fulfilled" })).status).toBe(200);
    expect((await offers(requester.token, rid)).body[0]).toMatchObject({ contact_shared: false, phone: null });
    expect((await call(requester.token, "transition_request", { p_id: rid, p_to: "cancelled" })).body.message).toMatch(/not allowed/); // terminal
    expect((await call(donor.token, "set_contact_consent", { p_offer_id: offerId, p_granted: true })).body.message).toMatch(/active, accepted offer/);
  });

  it("only the owner role and the database decide: requesters cannot approve, admins cannot fulfil, donors cannot moderate", async () => {
    const requester = await signUp({ role: "requester" }), donor = await signUp({});
    const admin = await signIn("admin@demo.example", "Demo@12345");
    const created = await req("/rest/v1/blood_requests", requester.token, { method: "POST", body: JSON.stringify({ requester_id: requester.id, patient_label: "Pat Q.", blood_group: "A+", units: 1, city: "Lahore", hospital: "API Hospital 2", urgency: "routine" }) });
    const rid = created.body[0].id;
    const call = (tok: string, fn: string, body: object) => req(`/rest/v1/rpc/${fn}`, tok, { method: "POST", body: JSON.stringify(body) });
    expect((await call(admin.token, "transition_request", { p_id: rid, p_to: "fulfilled", p_note: "admin tries" })).body.message).toMatch(/not allowed/);
    expect((await call(donor.token, "set_user_suspended", { p_user: requester.id, p_suspended: true, p_reason: "malicious attempt" })).status).toBe(403);
    expect((await call(admin.token, "review_request", { p_id: rid, p_decision: "reject", p_note: "no" })).body.message).toMatch(/reason/);
    expect((await call(admin.token, "review_request", { p_id: rid, p_decision: "reject", p_note: "Duplicate request", p_method: null })).status).toBe(200);
    expect((await call(admin.token, "review_request", { p_id: rid, p_decision: "approve", p_method: "other" })).body.message).toMatch(/already been reviewed/);
  });

  it("wrong passwords are rejected and password sign-in works", async () => {
    const u = await signUp({});
    const bad = await req("/auth/v1/token?grant_type=password", null, { method: "POST", body: JSON.stringify({ email: u.email, password: "Wrong-pass1" }) });
    expect(bad.status).toBe(400);
    const ok = await req("/auth/v1/token?grant_type=password", null, { method: "POST", body: JSON.stringify({ email: u.email, password: PASSWORD }) });
    expect(ok.status).toBe(200);
    expect(ok.body.access_token).toBeTruthy();
  });
});
