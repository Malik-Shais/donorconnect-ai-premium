// Verifies ALL migrations + live Realtime authorization + email worker on a brand-new, ISOLATED PostgreSQL stack:
// its own compose project ("donorconnect-fresh"), volume, credentials and ports (+100). The dev stack and its data are never touched.
//   npm run verify:fresh            (add --keep to leave the isolated stack running for inspection)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const OFF = 100, ENVF = "supabase/.env.fresh";
const base = { ...process.env, DC_PROJECT: "donorconnect-fresh", DC_PORT_OFFSET: String(OFF), DC_ENV_FILE: ENVF };
const run = (cmd, args, env = base) => spawnSync(cmd, args, { stdio: "inherit", env }).status ?? 1;

if (existsSync(ENVF)) run("node", ["scripts/stack.mjs", "destroy"]); // clean slate for the ISOLATED project only (guarded in stack.mjs)
let code = run("node", ["scripts/stack.mjs", "up"]);            // fresh volume -> every migration applied from empty
if (code === 0) {
  const e = Object.fromEntries(readFileSync(ENVF, "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
  const api = `http://127.0.0.1:${54321 + OFF}`;
  const env = { ...base, TEST_DATABASE_URL: `postgres://postgres:${e.POSTGRES_PASSWORD}@127.0.0.1:${54322 + OFF}/postgres`, NEXT_PUBLIC_SUPABASE_URL: api,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: e.SUPABASE_ANON_KEY, MAILPIT_URL: `http://127.0.0.1:${54324 + OFF}`, EMAIL_SMTP_URL: `smtp://127.0.0.1:${54325 + OFF}`, SEED_API_URL: api, RATE_LIMIT_SECRET: e.RATE_LIMIT_SECRET };
  code = run("node", ["scripts/seed-dev.mjs"], env) || run("npx", ["vitest", "run", "tests/db"], env); // RLS + workflow + stage 4 (live WebSocket) + email + API
}
if (!process.argv.includes("--keep")) run("node", ["scripts/stack.mjs", "destroy"]);
console.log(code === 0 ? "\nFRESH-DATABASE VERIFICATION: PASS" : "\nFRESH-DATABASE VERIFICATION: FAIL");
process.exit(code);
