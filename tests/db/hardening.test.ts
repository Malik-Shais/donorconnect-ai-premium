// @vitest-environment node
// Stage 7 hardening: limiter credential, protected demo classification, k-anonymous admin export. REAL PostgreSQL.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { as, DB_URL, getAdmin, makeDonor, makeRequester, makeUser, pool, root } from "./helpers";

if (!DB_URL) console.warn("\n⚠ TEST_DATABASE_URL not set: hardening tests SKIPPED (run `npm run db:up` first)\n");
const d = DB_URL ? describe : describe.skip;
afterAll(() => pool.end());
const setting = (k: string, v: string) => root("update public.app_settings set value=$2 where key=$1", [k, v]);
const getSetting = async (k: string) => (await root<{ value: string }>("select value from public.app_settings where key=$1", [k]))[0].value;
const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

d("rate-limit RPC requires the server-only credential", () => {
  const hit = (opts: { noLimiterSecret?: boolean } = {}) => as(null, (q) => q("select public.anon_rate_limit('auth.login', $1, false)", [`h-${randomUUID()}`]), opts);
  it.skipIf(!process.env.RATE_LIMIT_SECRET)("anonymous callers without the secret (anyone with the public anon key) are refused; the server is not", async () => {
    await expect(hit({ noLimiterSecret: true })).rejects.toThrow(/Limiter credential required/);
    await expect(hit()).resolves.toBeTruthy();
    // a wrong secret is refused too, and the global counters cannot be burned from outside
    await expect(as(null, (q) => q("select set_config('request.headers','{\"x-limiter-secret\":\"guess\"}',true)").then(() => q("select public.anon_rate_limit('auth.login.global','global')")), { noLimiterSecret: true })).rejects.toThrow(/Limiter credential required/);
    await expect(as(await makeRequester(), (q) => q("select public.anon_rate_limit('ai.global','global')"), { noLimiterSecret: true })).rejects.toThrow(/Limiter credential required/); // authenticated users too
  });
  it("production without a configured secret fails closed", async () => {
    const [env, hash] = [await getSetting("environment"), await getSetting("limiter_secret_sha256")];
    try {
      await setting("limiter_secret_sha256", ""); await setting("environment", "production");
      await expect(hit()).rejects.toThrow(/Limiter is not configured/);
    } finally { await setting("environment", env); await setting("limiter_secret_sha256", hash); }
  });
  it("settings are unreachable through the API", async () => {
    await expect(as(await getAdmin(), (q) => q("select * from public.app_settings"))).rejects.toThrow(/permission denied/);
    await expect(as(null, (q) => q("select * from public.app_settings"))).rejects.toThrow(/permission denied/);
  });
});

d("demo classification is explicit and protected", () => {
  it("users cannot change it; only an administrator can, with a reason, and it is audited", async () => {
    const u = await makeDonor(), a = await getAdmin();
    await expect(as(u, (q) => q("update public.profiles set is_demo=false where id=$1", [u]))).rejects.toThrow(/permission denied/); // no column grant
    await expect(as(a, (q) => q("update public.profiles set is_demo=false where id=$1", [u]))).rejects.toThrow(/permission denied/);   // not even admins edit the column directly
    await expect(as(u, (q) => q("select public.set_account_demo($1,false,'self service please')", [u]))).rejects.toThrow(/Administrators only/);
    await expect(as(a, (q) => q("select public.set_account_demo($1,false,'no')", [u]))).rejects.toThrow(/reason/);
    await as(a, (q) => q("select public.set_account_demo($1,false,'verified real person')", [u]));
    expect((await root<{ is_demo: boolean }>("select is_demo from public.profiles where id=$1", [u]))[0].is_demo).toBe(false);
    expect((await root<{ detail: { reason: string } }>("select detail from public.audit_logs where action='account.demo_flag' and entity_id=$1", [u]))[0].detail.reason).toBe("verified real person");
    // the trigger blocks any other non-privileged writer too (defence in depth behind the column grant); one dedicated connection, rolled back
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query("grant update (is_demo) on public.profiles to authenticated");   // simulate a future mistaken grant (rolled back below)
      await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated" })]);
      await expect(c.query("update public.profiles set is_demo=true where id=$1", [u])).rejects.toThrow(/managed by administrators/);
    } finally { await c.query("rollback").catch(() => {}); c.release(); }
  });
  it("production refuses demo-domain sign-ups and demo marking", async () => {
    const env = await getSetting("environment"), victim = await makeDonor(), admin = await getAdmin();
    try {
      await setting("environment", "production");
      await expect(as(admin, (q) => q("select public.set_account_demo($1,true,'trying to hide a real user')", [victim]))).rejects.toThrow(/cannot be marked as demo in production/);
      await expect(makeUser({}, "prodx")).rejects.toThrow(/not allowed in production/);                       // *.example email
    } finally { await setting("environment", env); }
  });
});

d("admin request export is k-anonymous", () => {
  const cityBig = `K5-${randomUUID().slice(0, 6)}`, cityB = `K3b-${randomUUID().slice(0, 6)}`, cityC = `K3c-${randomUUID().slice(0, 6)}`;
  const agg = async (args: (string | null)[] = []) => as(await getAdmin(), (q) => q<Record<string, string>>("select * from public.report_requests_aggregate($1::date,$2::date,$3,$4,'all',5)", [day(-2), day(1), args[0] ?? null, args[1] ?? null]));
  const add = async (req: string, city: string, n: number) => root("insert into public.blood_requests (requester_id, patient_label, blood_group, units, city, hospital, urgency) select $1,'Pt','AB-',2,$2,'Hosp','critical' from generate_series(1,$3)", [req, city, n]);
  it("cells below 5 are generalised, then suppressed; names, ids and exact dates never appear; totals are conserved", async () => {
    const r = await makeRequester();
    await add(r, cityBig, 5); await add(r, cityB, 3); await add(r, cityC, 3);
    const rows = await agg();
    expect(Object.keys(rows[0])).toEqual(["week_start", "city", "blood_group", "urgency", "status", "requests", "units"]);   // no id, no exact date, no hospital
    const text = JSON.stringify(rows);
    expect(text).not.toContain(cityB); expect(text).not.toContain(cityC);                                                // small cities are never named
    expect(rows.find((x) => x.city === cityBig)).toMatchObject({ blood_group: "AB-", urgency: "critical", status: "pending_review", requests: "5", units: "10" });
    expect(rows.every((x) => x.week_start === "(suppressed)" || (/^\d{4}-\d{2}-\d{2}$/.test(x.week_start) && new Date(x.week_start + "T00:00:00Z").getUTCDay() === 1))).toBe(true); // week starts Monday
    expect(rows.filter((x) => x.city !== "(suppressed)").every((x) => Number(x.requests) >= 5)).toBe(true);
    const other = rows.find((x) => x.city === "Other (small groups)" && x.blood_group === "AB-" && x.urgency === "critical");
    expect(Number(other?.requests ?? 0)).toBeGreaterThanOrEqual(6);                                                      // B + C merged into one generalised cell
    const [{ n }] = await root<{ n: string }>("select count(*) n from public.blood_requests where created_at >= $1::date and created_at < $2::date + 1", [day(-2), day(1)]);
    expect(rows.reduce((a, x) => a + Number(x.requests), 0)).toBe(Number(n));                                             // nothing lost, nothing invented
  });
  it("a filter that isolates fewer than 5 requests is refused; large filters work; non-admins are refused", async () => {
    await expect(agg([cityB])).rejects.toThrow(/too small to export/);
    expect((await agg([cityBig])).map((x) => x.city)).toEqual([cityBig]);
    await expect(as(await makeDonor(), (q) => q("select * from public.report_requests_aggregate(current_date-1,current_date,null,null,'all',5)"))).rejects.toThrow(/Administrators only/);
  });
});
