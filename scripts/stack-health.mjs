// Waits until every service of the local stack answers, then exits 0; exits 1 (listing what is down) after the timeout.
//   node scripts/stack-health.mjs [timeoutSeconds]        (honours DC_PORT_OFFSET for isolated stacks; prints service names only, never credentials)
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

for (const f of [".env.local", ".env.test.local"]) if (existsSync(f)) for (const l of readFileSync(f, "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const { NEXT_PUBLIC_SUPABASE_URL: api, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, MAILPIT_URL: mail, TEST_DATABASE_URL: db } = process.env;
if (!api || !anon || !mail || !db) { console.error("stack-health: stack environment not found (run `npm run db:up` first)"); process.exit(1); }

const http = (url, headers) => async () => { const r = await fetch(url, { headers, signal: AbortSignal.timeout(4000) }); if (r.status >= 500) throw new Error(`HTTP ${r.status}`); };
const checks = {
  "PostgreSQL": async () => { const c = new pg.Client({ connectionString: db }); await c.connect(); try { await c.query("select 1 from public.app_settings limit 1"); } finally { await c.end(); } },
  "GoTrue (auth)": http(`${api}/auth/v1/health`),
  "PostgREST": http(`${api}/rest/v1/`, { apikey: anon }),
  "Realtime gateway": http(`${api}/realtime/v1/`),
  "Mailpit": http(`${mail}/api/v1/info`),
};
const deadline = Date.now() + Number(process.argv[2] ?? 120) * 1000;
let down = Object.keys(checks);
while (down.length && Date.now() < deadline) {
  const results = await Promise.allSettled(down.map((n) => checks[n]()));
  down = down.filter((_, i) => results[i].status === "rejected");
  if (down.length) await new Promise((r) => setTimeout(r, 3000));
}
if (down.length) { console.error(`stack-health: NOT healthy: ${down.join(", ")}`); process.exit(1); }
console.log(`stack-health: all ${Object.keys(checks).length} services healthy (${Object.keys(checks).join(", ")})`);
