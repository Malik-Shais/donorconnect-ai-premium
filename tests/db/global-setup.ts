// Runs once before the service-backed suites.
//  * REQUIRE_SERVICES=1 (CI, verify:fresh): every required variable must be set AND every service must answer, otherwise the run FAILS here with a clear list.
//    Nothing is skipped silently, so a security suite can never "pass" by not running.
//  * Without it (local convenience): suites skip with a visible warning when the stack is not running.
// Values are never printed, only variable names and service names.
import { config } from "dotenv";
import { Client } from "pg";

const REQUIRED = ["TEST_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "MAILPIT_URL", "RATE_LIMIT_SECRET"];

async function reachable(name: string, url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(5000) }); return r.status < 500 ? null : `${name} answered HTTP ${r.status}`; }
  catch (e) { return `${name} unreachable (${(e as { cause?: { code?: string } }).cause?.code ?? "network error"})`; }
}

export default async function setup() {
  config({ path: ".env.test.local", quiet: true }); config({ path: ".env.local", quiet: true }); // never overrides variables already exported (e.g. verify:fresh)
  if (process.env.REQUIRE_SERVICES === "1") {
    const missing = REQUIRED.filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`REQUIRE_SERVICES=1 but these variables are not set: ${missing.join(", ")}. Start the stack first (npm run db:up).`);
    const api = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! };
    const problems = (await Promise.all([
      reachable("GoTrue (auth)", `${api}/auth/v1/health`), reachable("PostgREST", `${api}/rest/v1/`, key),
      reachable("Realtime gateway", `${api}/realtime/v1/`), reachable("Mailpit", `${process.env.MAILPIT_URL}/api/v1/info`),
    ])).filter(Boolean);
    if (problems.length) throw new Error(`REQUIRE_SERVICES=1 but required services are not healthy:\n - ${problems.join("\n - ")}`);
  }
  if (!process.env.TEST_DATABASE_URL) return;
  // Rate-limit counters are persistent by design, so start each run with clean counters (development/test databases only).
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  await c.query("truncate public.rate_limits");
  await c.end();
}
