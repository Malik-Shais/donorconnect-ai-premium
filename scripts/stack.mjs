// Local dev stack controller: node scripts/stack.mjs up|down|reset|migrate|psql
import { execFileSync, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

// Optional isolated stack for verification: DC_PROJECT=<name> DC_PORT_OFFSET=<n> DC_ENV_FILE=<path>. The dev stack is untouched.
const PROJECT = process.env.DC_PROJECT ?? "donorconnect", ISOLATED = PROJECT !== "donorconnect", OFF = Number(process.env.DC_PORT_OFFSET ?? 0);
const PORTS = { api: 54321 + OFF, db: 54322 + OFF, ui: 54324 + OFF, smtp: 54325 + OFF };
const ENV = process.env.DC_ENV_FILE ?? "supabase/.env.dev";
const COMPOSE_ENV = { ...process.env, DC_API_PORT: String(PORTS.api), DC_DB_PORT: String(PORTS.db), DC_MAIL_UI_PORT: String(PORTS.ui), DC_SMTP_PORT: String(PORTS.smtp) };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role, secret) => { const h = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, iss: "donorconnect-dev", iat: 1700000000, exp: 4102444800 })}`; return `${h}.${createHmac("sha256", secret).update(h).digest("base64url")}`; };

function ensureEnv() {
  if (existsSync(ENV)) { // backfill values introduced after the file was first generated
    if (!readFileSync(ENV, "utf8").includes("RATE_LIMIT_SECRET=")) writeFileSync(ENV, readFileSync(ENV, "utf8").replace(/\n?$/, "\n") + `RATE_LIMIT_SECRET=${randomBytes(24).toString("hex")}\n`);
    if (!readFileSync(ENV, "utf8").includes("REALTIME_SECRET_KEY_BASE=")) writeFileSync(ENV, readFileSync(ENV, "utf8").replace(/\n?$/, "\n") + `REALTIME_SECRET_KEY_BASE=${randomBytes(48).toString("hex")}\n`);
    return;
  }
  // Generated per machine, development only; both files are git-ignored.
  const pw = randomBytes(16).toString("hex"), secret = randomBytes(32).toString("hex"), skb = randomBytes(48).toString("hex");
  writeFileSync(ENV, `POSTGRES_PASSWORD=${pw}\nJWT_SECRET=${secret}\nSUPABASE_ANON_KEY=${jwt("anon", secret)}\nSUPABASE_SERVICE_ROLE_KEY=${jwt("service_role", secret)}\nREALTIME_SECRET_KEY_BASE=${skb}\nRATE_LIMIT_SECRET=${randomBytes(24).toString("hex")}\n`);
  console.log(`Generated ${ENV}`);
}
const env = () => Object.fromEntries(readFileSync(ENV, "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
const dc = (...a) => execFileSync("docker", ["compose", "-p", PROJECT, "-f", "supabase/docker-compose.yml", "--env-file", ENV, ...a], { stdio: "inherit", env: COMPOSE_ENV });
const psql = (args, input, user = "postgres") => spawnSync("psql", ["-h", "127.0.0.1", "-p", String(PORTS.db), "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-X", ...args], { env: { ...process.env, PGPASSWORD: env().POSTGRES_PASSWORD }, input, encoding: "utf8" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, fn, tries = 90) {
  for (let i = 0; i < tries; i++) { if (fn()) return; await sleep(2000); }
  throw new Error(`Timed out waiting for ${label}`);
}

function migrate() {
  psql(["-c", "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, name text)"]);
  const done = new Set(psql(["-At", "-c", "select version from supabase_migrations.schema_migrations"]).stdout.split("\n"));
  for (const f of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
    if (done.has(version)) continue;
    const r = psql(["-f", `supabase/migrations/${f}`]);
    if (r.status) throw new Error(`Migration ${f} failed:\n${r.stderr}`);
    psql(["-c", `insert into supabase_migrations.schema_migrations values ('${version}','${rest.join("_")}')`]);
    console.log("applied", f);
  }
  psql(["-c", "notify pgrst, 'reload schema'"]); // PostgREST picks up new tables/functions without a restart
}

const cmd = process.argv[2];
if (cmd === "up") {
  ensureEnv();
  dc("up", "-d", "db", "mail"); await waitFor("postgres", () => psql(["-c", "select 1"]).status === 0);
  // The image does not give service roles the POSTGRES_PASSWORD; Supabase's own compose does this in roles.sql.
  const pw = env().POSTGRES_PASSWORD;
  const r = psql(["-c", ["authenticator", "supabase_auth_admin"].map((x) => `alter user ${x} with password '${pw}';`).join(" ")], undefined, "supabase_admin");
  if (r.status) throw new Error(`Setting service role passwords failed:\n${r.stderr}`);
  dc("up", "-d", "auth");        await waitFor("auth migrations", () => psql(["-c", "select 1 from auth.users limit 0"]).status === 0);
  // Realtime creates the `realtime.*` schema (messages, send(), topic()) at startup; app migrations depend on it.
  psql(["-c", "create schema if not exists _realtime; alter schema _realtime owner to supabase_admin"], undefined, "supabase_admin");
  dc("up", "-d", "realtime"); await waitFor("realtime schema", () => psql(["-c", "select 1 from realtime.messages limit 0"]).status === 0);
  migrate();
  // Register the server-only limiter secret (only its SHA-256 is stored in the database).
  psql(["-q", "-c", `update public.app_settings set value = encode(sha256(convert_to('${env().RATE_LIMIT_SECRET}', 'utf8')), 'hex') where key = 'limiter_secret_sha256'`]);
  // Defence in depth on top of RLS (needs the table's grantor): app roles never write realtime.messages, anon never reads it.
  psql(["-q", "-c", "revoke insert, update, delete on realtime.messages from anon, authenticated; revoke select on realtime.messages from anon"], undefined, "supabase_admin");
  dc("up", "-d", "rest", "gateway");
  dc("restart", "gateway"); // pick up nginx config changes
  const e = env();
  if (!ISOLATED) {
  // .env.local (read by Next): public URL + anon key ONLY. Privileged and test-only values go elsewhere.
  writeFileSync(".env.local", `# generated by scripts/stack.mjs (git-ignored, development only)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=${e.SUPABASE_ANON_KEY}
# server-only (never NEXT_PUBLIC_): lets this app's server use the rate-limit RPC; the public anon key alone cannot
RATE_LIMIT_SECRET=${e.RATE_LIMIT_SECRET}
`);
  writeFileSync(".env.test.local", `# generated (git-ignored): used by Vitest/Playwright only, never loaded by the Next.js app
TEST_DATABASE_URL=postgres://postgres:${e.POSTGRES_PASSWORD}@127.0.0.1:54322/postgres
MAILPIT_URL=http://127.0.0.1:54324
RATE_LIMIT_SECRET=${e.RATE_LIMIT_SECRET}
`);
  writeFileSync(".env.worker", `# generated (git-ignored): optional dev email worker. Local SMTP (Mailpit) only; no production SMTP is configured.\nDATABASE_URL=postgres://postgres:${e.POSTGRES_PASSWORD}@127.0.0.1:54322/postgres\nEMAIL_SMTP_URL=smtp://127.0.0.1:54325\nSITE_URL=http://localhost:3100\n`);
  }
  console.log(`Stack "${PROJECT}" is up. API http://127.0.0.1:${PORTS.api}  Mail UI http://127.0.0.1:${PORTS.ui}  DB 127.0.0.1:${PORTS.db}  SMTP ${PORTS.smtp}`);
} else if (cmd === "migrate") migrate();
else if (cmd === "destroy") { if (!ISOLATED) throw new Error("destroy is only for isolated verification stacks (set DC_PROJECT); use db:reset for dev"); dc("down", "-v"); }
else if (cmd === "down") dc("down");
else if (cmd === "reset") { ensureEnv(); dc("down", "-v"); spawnSync("node", [process.argv[1], "up"], { stdio: "inherit" }); }
else console.log("usage: node scripts/stack.mjs up|down|reset|migrate");
