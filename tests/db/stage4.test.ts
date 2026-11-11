// @vitest-environment node
// Stage 4: notification categories/preferences, realtime pings, private outbox, persistent rate limits, LIVE Supabase Realtime.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { approve, as, DB_URL, getAdmin, makeApprovedRequest, makeDonor, makeRequest, makeRequester, pool, root } from "./helpers";

if (!DB_URL) console.warn("\n⚠ TEST_DATABASE_URL not set: stage 4 tests SKIPPED (run `npm run db:up` first)\n");
const d = DB_URL ? describe : describe.skip;
afterAll(() => pool.end());
const city = () => `S4-${randomUUID().slice(0, 8)}`;
const cats = (u: string) => as(u, (q) => q<{ category: string; dedupe_key: string | null }>("select category, dedupe_key from public.notifications order by id"));
const check = (u: string, action: string) => as(u, (q) => q("select public.check_rate_limit($1)", [action]));

d("notification categories, preferences and ping events", () => {
  it("categories are derived server-side from the event type", async () => {
    const admin = await getAdmin(), c = city(), req = await makeRequester(), donor = await makeDonor("O+", { city: c });
    const id = await makeRequest(req, "A+", c);
    expect((await cats(admin)).some((n) => n.dedupe_key === `review:${id}` && n.category === "review")).toBe(true);
    await approve(id);
    expect((await cats(req)).find((n) => n.dedupe_key === `req:${id}:reviewed`)?.category).toBe("request");
    expect((await cats(donor)).find((n) => n.dedupe_key === `req:${id}:approved`)?.category).toBe("request");
    expect((await cats(donor))[0].category).toBe("account"); // welcome message
    await as(req, (q) => q("select public.invite_donors($1)", [id]));
    expect((await cats(donor)).some((n) => n.category === "invitation")).toBe(true);
    await as(donor, (q) => q("select public.accept_request($1,false)", [id]));
    expect((await cats(req)).some((n) => n.category === "offer")).toBe(true);
  });

  it("every notification broadcasts one private message holding ONLY the notification id; messages are private to their owner's topic", async () => {
    const a = await makeDonor(), b = await makeDonor();
    await root("insert into public.notifications (user_id, message, link, dedupe_key) values ($1,'TOP SECRET Patient X 0300','/x','req:950:p')", [a]);
    const rows = await root<{ topic: string; event: string; payload: Record<string, unknown> }>("select topic, event, payload from realtime.messages where topic=$1 order by inserted_at", [`notif:${a}`]);
    expect(rows.length).toBeGreaterThanOrEqual(2); // welcome + the insert above
    // "id" is Realtime's own random message id; the only application data is notification_id
    for (const r of rows) { expect(r.event).toBe("notification"); expect(Object.keys(r.payload).sort()).toEqual(["id", "notification_id"]); }
    // scan everything except Realtime's random message id (a random UUID can legitimately start with "0300", which made this assertion flaky)
    expect(JSON.stringify(rows.map((r) => ({ topic: r.topic, event: r.event, notification_id: r.payload.notification_id })))).not.toMatch(/SECRET|Patient|0300/);
    // RLS on realtime.messages: only the owner can read their topic; nobody else, nobody anonymous, nobody can publish
    // The Realtime server sets realtime.topic per connection; emulate it. Claiming a topic is not enough: it must equal notif:<own uid>.
    const readAs = (u: string, claimed: string) => as(u, async (q) => { await q("select set_config('realtime.topic', $1, true)", [claimed]); return q("select * from realtime.messages where topic=$1", [`notif:${a}`]); });
    expect(await readAs(a, `notif:${a}`)).not.toHaveLength(0);
    expect(await readAs(b, `notif:${a}`)).toHaveLength(0); // b claims a's topic: denied
    expect(await readAs(b, `notif:${b}`)).toHaveLength(0);
    await expect(as(null, (q) => q("select * from realtime.messages"))).rejects.toThrow(/permission denied/);
    for (const stmt of ["update realtime.messages set payload='{}'", "delete from realtime.messages"])
      for (const who of [a, null]) await expect(as(who, (q) => q(stmt))).rejects.toThrow(/permission denied|row-level security/); // writes are default-deny
    await expect(as(a, (q) => q("insert into realtime.messages (topic, extension, payload, event, private) values ($1,'broadcast','{}','x',true)", [`notif:${a}`]))).rejects.toThrow(/permission denied|row-level security/);
  });

  it("users read and mark only their own notifications", async () => {
    const a = await makeDonor(), b = await makeDonor();
    expect(await as(b, (q) => q("select * from public.notifications where user_id=$1", [a]))).toHaveLength(0);
    expect(await as(b, (q) => q("update public.notifications set is_read=true where user_id=$1 returning 1", [a]))).toHaveLength(0);
    expect(await as(a, (q) => q("update public.notifications set is_read=true where is_read=false returning 1"))).toHaveLength(1);
  });

  it("email preferences: opt-in, own rows only, validated categories", async () => {
    const a = await makeDonor(), b = await makeDonor();
    expect(await as(a, (q) => q("select * from public.notification_preferences"))).toHaveLength(0); // default: nothing stored = email off
    await as(a, (q) => q("insert into public.notification_preferences (user_id, email_enabled, email_categories) values ($1, true, array['offer']) on conflict (user_id) do update set email_enabled=excluded.email_enabled, email_categories=excluded.email_categories", [a]));
    expect((await as(a, (q) => q("select email_enabled, email_categories from public.notification_preferences")))[0]).toEqual({ email_enabled: true, email_categories: ["offer"] });
    await expect(as(a, (q) => q("insert into public.notification_preferences (user_id) values ($1)", [b]))).rejects.toThrow(/row-level security/);
    expect(await as(a, (q) => q("update public.notification_preferences set email_enabled=false where user_id=$1 returning 1", [b]))).toHaveLength(0);
    await expect(as(a, (q) => q("update public.notification_preferences set email_categories=array['spam'] where user_id=$1", [a]))).rejects.toThrow(/check constraint/);
    expect(await as(b, (q) => q("select * from public.notification_preferences"))).toHaveLength(0);
    await expect(as(null, (q) => q("select * from public.notification_preferences"))).rejects.toThrow(/permission denied/);
  });

  it("the email outbox is private, only queues opted-in categories, and queues each notification once", async () => {
    const donor = await makeDonor(), other = await makeDonor();
    const queued = (u: string) => root<{ category: string }>("select category from public.email_outbox where user_id=$1", [u]);
    await root("insert into public.notifications (user_id, message, dedupe_key) values ($1,'x','req:900:a')", [donor]);
    expect(await queued(donor)).toHaveLength(0); // email off by default
    await root("insert into public.notification_preferences (user_id, email_enabled, email_categories) values ($1,true,array['offer','request'])", [donor]);
    await root("insert into public.notifications (user_id, message, dedupe_key) values ($1,'y','req:901:a'), ($1,'z','invite:902')", [donor]);
    expect(await queued(donor)).toEqual([{ category: "request" }]); // invitation not selected -> not queued
    await expect(root("insert into public.notifications (user_id, message, dedupe_key) values ($1,'y','req:901:a')", [donor])).rejects.toThrow(/duplicate key/); // dedupe
    expect(await queued(other)).toHaveLength(0);
    for (const u of [donor, null]) await expect(as(u, (q) => q("select * from public.email_outbox"))).rejects.toThrow(/permission denied/);
    await expect(as(donor, (q) => q("insert into public.email_outbox (notification_id, user_id, category) values (1, $1, 'x')", [donor]))).rejects.toThrow(/permission denied/);
  });
});

d("persistent, atomic rate limits", () => {
  it("race: 40 simultaneous calls allow exactly the limit (20) and reject the rest with a clear message", async () => {
    const u = await makeDonor();
    const r = await Promise.allSettled(Array.from({ length: 40 }, () => check(u, "ai.chat")));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(20);
    const rejected = r.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(rejected).toHaveLength(20);
    expect(String(rejected[0].reason)).toMatch(/too often\. Please try again in \d+ (seconds|minutes)/);
    expect((await root<{ hits: number }>("select hits from public.rate_limits where key=$1", [`u:${u}:ai.chat`]))[0].hits).toBe(20);
  });

  it("limits are per user and per action, and reset when the window rolls over", async () => {
    const a = await makeDonor(), b = await makeDonor();
    for (let i = 0; i < 20; i++) await check(a, "ai.chat");
    await expect(check(a, "ai.chat")).rejects.toThrow(/too often/);
    await check(a, "profile.update");   // different action: unaffected
    await check(b, "ai.chat");          // different user: unaffected
    await root("update public.rate_limits set window_start = window_start - interval '3 hours' where key=$1", [`u:${a}:ai.chat`]);
    await check(a, "ai.chat");          // old window is irrelevant
    await expect(check(a, "no.such.action")).rejects.toThrow(/Unknown rate-limited action/);
  });

  it("database triggers enforce request creation limits even for direct API use", async () => {
    const req = await makeRequester();
    for (let i = 0; i < 10; i++) await makeRequest(req);
    await expect(makeRequest(req)).rejects.toThrow(/too often/);
    expect((await root<{ n: number }>("select count(*)::int n from public.blood_requests where requester_id=$1", [req]))[0].n).toBe(10);
  });

  it("invitations and contact disclosure are limited; the original functions are not callable directly", async () => {
    const c = city(), req = await makeRequester(), id = await makeApprovedRequest(req, "A+", c);
    // Each invitation click inserts up to 20 offers and offer creation is limited to 100/hour, so abuse is cut off after a few clicks (never more than 10).
    let allowed = 0, blocked = "";
    for (let i = 0; i < 12 && !blocked; i++) {
      try { await as(req, (q) => q("select public.invite_donors($1)", [id])); allowed++; } catch (e) { blocked = String(e); }
    }
    expect(blocked).toMatch(/too often\. Please try again in \d+ (seconds|minutes)/);
    expect(allowed).toBeGreaterThanOrEqual(1);
    expect(allowed).toBeLessThanOrEqual(10);
    const req2 = await makeRequester(), id2 = await makeApprovedRequest(req2, "A+", c);
    for (let i = 0; i < 60; i++) await as(req2, (q) => q("select * from public.owner_request_offers($1)", [id2]));
    await expect(as(req2, (q) => q("select * from public.owner_request_offers($1)", [id2]))).rejects.toThrow(/too often/);
    for (const fn of ["invite_donors_impl(1)", "review_request_impl(1,'approve',null,'other')", "owner_request_offers_impl(1)", "rate_limit_hit('k',1,1)", "rate_limit_check('ai.chat')"])
      await expect(as(req, (q) => q(`select * from public.${fn}`))).rejects.toThrow(/permission denied/);
  });

  it("anonymous flows: peek does not consume, counting is per subject, rules are fixed server-side", async () => {
    const s1 = randomUUID(), s2 = randomUUID();
    const anon = (a: string, s: string, count = true) => as(null, (q) => q<{ anon_rate_limit: number }>("select public.anon_rate_limit($1,$2,$3)", [a, s, count])).then((r) => r[0].anon_rate_limit);
    for (let i = 0; i < 15; i++) expect(await anon("auth.login", s1, false)).toBe(0); // peeking never consumes quota
    for (let i = 0; i < 10; i++) expect(await anon("auth.login", s1)).toBe(0);
    expect(await anon("auth.login", s1)).toBeGreaterThan(0);          // the 11th counted attempt is blocked, with a retry delay
    expect(await anon("auth.login", s1, false)).toBeGreaterThan(0);   // and a peek now reports "blocked"
    expect(await anon("auth.login", s2)).toBe(0);                      // another subject is independent
    await expect(anon("review", s1)).rejects.toThrow(/Unknown rate-limited action/); // a user-scope rule cannot be used anonymously
    await expect(anon("auth.login", "")).rejects.toThrow(/Invalid subject/);
    await expect(anon("auth.login", "x".repeat(200))).rejects.toThrow(/Invalid subject/);
  });

  it("counter and rule tables are invisible and immutable to every app role", async () => {
    const u = await makeDonor();
    for (const who of [u, null]) {
      await expect(as(who, (q) => q("select * from public.rate_limits"))).rejects.toThrow(/permission denied/);
      await expect(as(who, (q) => q("select * from public.rate_limit_rules"))).rejects.toThrow(/permission denied/);
    }
    await expect(as(u, (q) => q("update public.rate_limit_rules set max_hits=100000"))).rejects.toThrow(/permission denied/);
    await expect(as(u, (q) => q("delete from public.rate_limits"))).rejects.toThrow(/permission denied/);
  });
});

d("LIVE Supabase Realtime: private per-user channels, ids only", () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function liveUser(tag: string) {
    const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await c.auth.signUp({ email: `rt.${tag}.${randomUUID().slice(0, 8)}@test.example`, password: "Passw0rd!x", options: { data: { full_name: "Rt User", city: "Lahore", blood_group: "O+", role: "donor" } } });
    if (error || !data.session) throw error ?? new Error("no session");
    await c.realtime.setAuth(data.session.access_token);
    return { c, id: data.user!.id };
  }
  /** Join a private topic; resolves with the final subscribe status. */
  const join = (c: SupabaseClient, topic: string, sink: unknown[]) => new Promise<string>((res) => {
    c.channel(topic, { config: { private: true } }).on("broadcast", { event: "notification" }, (m) => sink.push(m.payload)).subscribe((s) => { if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) res(s); });
  });

  it("the owner receives an ids-only message; other users and anonymous clients cannot even join the topic", async () => {
    const a = await liveUser("a"), b = await liveUser("b"), anonClient = createClient(url, anon, { auth: { persistSession: false } });
    const gotA: unknown[] = [], gotSpy: unknown[] = [], gotAnon: unknown[] = [];
    expect(await join(a.c, `notif:${a.id}`, gotA)).toBe("SUBSCRIBED");
    expect(await join(b.c, `notif:${a.id}`, gotSpy)).toBe("CHANNEL_ERROR");       // b cannot eavesdrop on a's topic
    expect(await join(anonClient, `notif:${a.id}`, gotAnon)).toBe("CHANNEL_ERROR"); // anon-key only: denied
    await wait(2500);
    await root("insert into public.notifications (user_id, message, link, dedupe_key) values ($1,'TOP SECRET hospital Patient X phone 0300','/x','req:777:live')", [a.id]);
    await expect.poll(() => gotA.length, { timeout: 8000 }).toBe(1);
    await wait(1500);
    expect(Object.keys(gotA[0] as object).sort()).toEqual(["id", "notification_id"]); // no message text, identity or contact data
    expect(JSON.stringify(gotA)).not.toMatch(/SECRET|Patient|0300|hospital/i);
    expect(gotSpy).toHaveLength(0);
    expect(gotAnon).toHaveLength(0);
    await Promise.all([a.c.removeAllChannels(), b.c.removeAllChannels(), anonClient.removeAllChannels()]);
  });

  it("clients cannot publish into someone else's topic", async () => {
    const a = await liveUser("pa"), evil = await liveUser("pe");
    const got: unknown[] = [];
    expect(await join(a.c, `notif:${a.id}`, got)).toBe("SUBSCRIBED");
    await wait(2000);
    const ch = evil.c.channel(`notif:${a.id}`, { config: { private: true } });
    await new Promise<void>((res) => ch.subscribe(() => res()));
    await ch.send({ type: "broadcast", event: "notification", payload: { notification_id: 1, forged: true } }).catch(() => undefined);
    await wait(2500);
    expect(got).toHaveLength(0);
    await Promise.all([a.c.removeAllChannels(), evil.c.removeAllChannels()]);
  });
});
