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
    const fn = await req("/rest/v1/rpc/set_donor_eligibility", a.token, { method: "POST", body: JSON.stringify({ p_user: a.id, p_status: "cleared" }) });
    expect(fn.body.message).toMatch(/Administrators only/);
  });

  it("contact sharing over the API: hidden without consent, visible to the owner with it, never to others", async () => {
    const requester = await signUp({ role: "requester", phone: "0311 7000000" }), other = await signUp({ role: "requester" });
    const donor = await signUp({ blood_group: "O+", phone: "0300 7000000" });
    const created = await req("/rest/v1/blood_requests", requester.token, { method: "POST", body: JSON.stringify({ requester_id: requester.id, patient_label: "Pat Z.", blood_group: "A+", units: 1, city: "Lahore", hospital: "API Hospital", urgency: "urgent" }) });
    expect(created.status).toBe(201);
    const rid = created.body[0].id;

    const seen = await req("/rest/v1/rpc/open_requests_for_donor", donor.token, { method: "POST", body: "{}" });
    expect(seen.body.some((r: Json) => r.id === rid)).toBe(true);
    expect(JSON.stringify(seen.body)).not.toContain("Pat Z."); // patient label not exposed to donors
    expect((await req("/rest/v1/blood_requests", donor.token)).body).toEqual([]); // no direct table access

    const accepted = await req("/rest/v1/rpc/accept_request", donor.token, { method: "POST", body: JSON.stringify({ p_request_id: rid, p_share_contact: false }) });
    expect(accepted.status).toBe(200);
    const offerId = accepted.body;
    const contacts = (tok: string) => req("/rest/v1/rpc/consented_contacts", tok, { method: "POST", body: JSON.stringify({ p_request_id: rid }) });
    expect((await contacts(requester.token)).body).toEqual([]);

    await req("/rest/v1/rpc/set_contact_consent", donor.token, { method: "POST", body: JSON.stringify({ p_offer_id: offerId, p_granted: true }) });
    const shared = (await contacts(requester.token)).body;
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ phone: "0300 7000000", email: donor.email });
    expect((await contacts(other.token)).body).toEqual([]);
    expect((await contacts(donor.token)).body).toEqual([]);

    await req("/rest/v1/rpc/set_contact_consent", donor.token, { method: "POST", body: JSON.stringify({ p_offer_id: offerId, p_granted: false }) });
    expect((await contacts(requester.token)).body).toEqual([]); // consent is revocable
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
