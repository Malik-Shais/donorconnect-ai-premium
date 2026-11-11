// @vitest-environment node
// Stage 5: the AI tools against the REAL stack (GoTrue JWT -> PostgREST -> RLS). No Gemini involved: this proves what the model COULD ever see.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { runTool } from "@/lib/ai/tools";
import { approve, as, DB_URL, makeRequest, pool } from "./helpers";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !ANON || !DB_URL) console.warn("\n⚠ Supabase env not set: AI tool DB tests SKIPPED (run `npm run db:up` first)\n");
const d = URL_ && ANON && DB_URL ? describe : describe.skip;
afterAll(() => pool.end());

const PASSWORD = "Passw0rd!x";
async function token(email: string, password: string) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const b = await r.json(); expect(r.status, "sign in").toBe(200);
  return { jwt: b.access_token as string, id: b.user.id as string };
}
async function user(meta: Record<string, unknown>) {
  const email = `ai.${randomUUID().slice(0, 8)}@test.example`;
  const r = await fetch(`${URL_}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD, data: { full_name: "Secret Name", city: "Lahore", blood_group: "O+", phone: `03${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`, ...meta } }) });
  expect(r.status).toBeLessThan(300);
  const t = await token(email, PASSWORD);
  return { ...t, email, sb: createClient(URL_!, ANON!, { global: { headers: { Authorization: `Bearer ${t.jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } }) };
}
const run = (name: string, u: Awaited<ReturnType<typeof user>>, role: "donor" | "requester" | "admin") => runTool(name, {}, { role, supabase: u.sb }) as Promise<{ untrusted_data?: Record<string, unknown>; error?: string }>;

d("AI tools: real permissions, isolation and data minimisation", () => {
  it("a requester's tool shows only their own requests, never patient/hospital details; other requesters see nothing of it", async () => {
    const city = `AI-${randomUUID().slice(0, 6)}`;
    const a = await user({ role: "requester" }), b = await user({ role: "requester" });
    await makeRequest(a.id, "A+", city);
    const mine = await run("get_my_requests", a, "requester");
    expect(mine.untrusted_data?.count).toBe(1);
    const dump = JSON.stringify(mine);
    expect(dump).not.toMatch(/Patient X|Demo Hospital|Secret Name|@test\.example/);
    expect(dump).toContain(city);
    expect((await run("get_my_requests", b, "requester")).untrusted_data?.count).toBe(0);
  });

  it("a donor's tools list approved matches and own offers with whitelisted fields only; requester data is not exposed", async () => {
    const city = `AI-${randomUUID().slice(0, 6)}`;
    const req = await user({ role: "requester", phone: "0311 1112223" }), donor = await user({ role: "donor", blood_group: "O+", city });
    const pending = await makeRequest(req.id, "A+", city); // not yet approved
    const ids = (o: { untrusted_data?: Record<string, unknown> }) => (o.untrusted_data!.items as { request_id: number }[]).map((i) => Number(i.request_id));
    expect(ids(await run("get_my_opportunities", donor, "donor"))).not.toContain(Number(pending)); // unreviewed: invisible
    await approve(pending);
    const opp = await run("get_my_opportunities", donor, "donor");
    expect(ids(opp)[0]).toBe(Number(pending)); // same-city matches are listed first (shared dev DB may hold other approved requests)
    expect(JSON.stringify(opp)).not.toMatch(/Patient X|Demo Hospital|Secret Name|0311|@test\.example|requester/i);
    expect(Object.keys((opp.untrusted_data!.items as object[])[0]).sort()).toEqual(["blood_group", "city", "in_my_city", "my_offer_status", "request_id", "status", "units", "urgency"]);
    await as(donor.id, (q) => q("select public.accept_request($1,false)", [pending]));
    const offers = await run("get_my_offers", donor, "donor");
    expect(offers.untrusted_data?.count).toBe(1);
    expect(JSON.stringify(offers)).not.toMatch(/Patient X|Demo Hospital|Secret Name|0311/);
    // the requester cannot read the donor's data through any AI tool either
    expect(await run("get_my_offers", req, "requester")).toEqual({ error: "tool_not_available" });
  });

  it("role claims are NOT trusted: a donor's session cannot read admin stats even if the role argument says admin", async () => {
    const donor = await user({ role: "donor" });
    const out = await run("get_operational_stats", donor, "admin"); // forged role at the call site
    const data = out.untrusted_data as { requests_by_status: Record<string, number> } | undefined;
    expect(Object.values(data?.requests_by_status ?? {}).reduce((a, b) => a + b, 0)).toBe(0); // RLS returns 0 rows for a donor
  });

  it("the seeded admin gets aggregate counts only", async () => {
    const t = await token("admin@demo.example", "Demo@12345");
    const sb = createClient(URL_!, ANON!, { global: { headers: { Authorization: `Bearer ${t.jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const out = (await runTool("get_operational_stats", {}, { role: "admin", supabase: sb })) as { untrusted_data: Record<string, Record<string, number>> };
    expect(Object.keys(out.untrusted_data).sort()).toEqual(["oldest_pending_review_hours", "requests_by_status", "users_by_role"]);
    expect(Object.values(out.untrusted_data.requests_by_status).every((n) => typeof n === "number")).toBe(true);
  });

  it("get_my_matching_status: a requester sees only counts for their own requests; other requesters and donors get nothing", async () => {
    const city = `AI-${randomUUID().slice(0, 6)}`;
    const a = await user({ role: "requester" }), b = await user({ role: "requester" }), donor = await user({ role: "donor", city, blood_group: "O+" });
    const id = await makeRequest(a.id, "A+", city); await approve(id);
    await a.sb.rpc("invite_donors", { p_id: id });
    await donor.sb.rpc("accept_request", { p_request_id: id, p_share_contact: true });
    const mine = await run("get_my_matching_status", a, "requester");
    expect(mine.untrusted_data?.items).toEqual([{ request_id: Number(id), donors_invited: 0, donors_accepted: 1, donors_declined: 0, donors_withdrawn: 0 }]);
    expect(JSON.stringify(mine)).not.toMatch(/donor_id|@test\.example|contact|phone/i);
    expect((await run("get_my_matching_status", b, "requester")).untrusted_data?.count).toBe(0);                 // someone else's requests
    expect((await run("get_my_matching_status", donor, "requester")).untrusted_data?.count).toBe(0);             // forged role: the SQL function returns no rows for a donor
    expect(await run("get_my_matching_status", a, "donor")).toEqual({ error: "tool_not_available" });
  });

  it("notification summary is counts only (no notification text)", async () => {
    const u = await user({ role: "donor" });
    const out = await run("get_notification_summary", u, "donor");
    expect(Object.keys(out.untrusted_data!).sort()).toEqual(["unread_by_category", "unread_total"]);
  });
});
