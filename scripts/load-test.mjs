// Load / reliability benchmark on an ISOLATED, DISPOSABLE stack with FICTIONAL data only (*.example addresses, generated names).
//   DC_PROJECT=donorconnect-load DC_PORT_OFFSET=200 DC_ENV_FILE=supabase/.env.load node scripts/stack.mjs up
//   DC_LOAD_OK=1 LOAD_DATABASE_URL=postgres://postgres:<pw>@127.0.0.1:54522/postgres LOAD_SMTP=smtp://127.0.0.1:54525 node scripts/load-test.mjs [users]
// Refuses to run unless the target is local, is NOT the dev database (port 54322), and DC_LOAD_OK=1 is set. Never point this at a shared or production database.
import { performance } from "node:perf_hooks";
import nodemailer from "nodemailer";
import pg from "pg";
import { drainQueue } from "./email-worker.mjs";

const url = process.env.LOAD_DATABASE_URL, N = Number(process.argv[2] ?? 1200), REQ = N * 5;
if (process.env.DC_LOAD_OK !== "1" || !url) { console.error("Set DC_LOAD_OK=1 and LOAD_DATABASE_URL (isolated stack only)."); process.exit(1); }
const u = new URL(url);
if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port === "54322") { console.error("Refusing: target must be a local ISOLATED stack, not the dev database."); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, max: 20 });
const q = (sql, p) => pool.query(sql, p);
const secret = process.env.RATE_LIMIT_SECRET;

const as = async (uid, fn) => { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claims',$1,true), set_config('request.headers',$2,true)", [JSON.stringify({ sub: uid, role: "authenticated" }), JSON.stringify(secret ? { "x-limiter-secret": secret } : {})]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); } };
const time = async (fn, n = 7) => { const t = []; for (let i = 0; i < n; i++) { const s = performance.now(); await fn(i); t.push(performance.now() - s); } t.sort((a, b) => a - b); return { p50: +t[Math.floor(n / 2)].toFixed(1), p95: +t[Math.min(n - 1, Math.ceil(n * 0.95) - 1)].toFixed(1), max: +t[n - 1].toFixed(1) }; };
const row = (name, r, extra = "") => console.log(`| ${name} | ${r.p50} | ${r.p95} | ${r.max} | ${extra} |`);

const already = Number((await q("select count(*) from public.profiles where full_name like 'Load User%'")).rows[0].count) >= N;
if (already) console.log("# Seed data already present: reusing it"); else {
console.log(`# Seeding ${N} users, ${REQ} requests (fictional)`);
let s = performance.now();
await q(`insert into auth.users (id, aud, role, email, raw_user_meta_data, instance_id)
  select gen_random_uuid(), 'authenticated', 'authenticated', 'load' || g || '@load.example',
    jsonb_build_object('full_name', 'Load User ' || g, 'city', (array['Lahore','Karachi','Islamabad','Peshawar','Quetta','Multan','Faisalabad','Rawalpindi','Sialkot','Hyderabad','Gujranwala','Bahawalpur'])[1 + g % 12],
      'role', case when g % 6 = 0 then 'requester' else 'donor' end, 'blood_group', (array['O+','A+','B+','AB+','O-','A-','B-','AB-'])[1 + (g * 7) % 8]), '00000000-0000-0000-0000-000000000000'
  from generate_series(1, $1) g on conflict do nothing`, [N]);
await q("update public.profiles set role = 'admin' where id in (select id from public.profiles where role = 'donor' and full_name like 'Load User%' order by id limit 5)");
await q("delete from public.donor_profiles where user_id in (select id from public.profiles where role = 'admin')");
console.log(`users: ${((performance.now() - s) / 1000).toFixed(1)}s`);

s = performance.now();
await q(`create unlogged table if not exists load_req_ids as select id from public.profiles where role = 'requester' and full_name like 'Load User%'`);
await q(`insert into public.blood_requests (requester_id, patient_label, blood_group, units, city, hospital, urgency, status, created_at, reviewed_at)
  select (select id from load_req_ids order by random() limit 1), 'Pt ' || g, (array['O+','A+','B+','AB+','O-','A-','B-','AB-'])[1 + (g * 3) % 8]::public.blood_group, 1 + g % 4,
    (array['Lahore','Karachi','Islamabad','Peshawar','Quetta','Multan','Faisalabad','Rawalpindi','Sialkot','Hyderabad','Gujranwala','Bahawalpur'])[1 + (g * 5) % 12], 'Hospital ' || (g % 40),
    (array['routine','urgent','critical'])[1 + g % 3]::public.urgency_level,
    (array['pending_review','approved','approved','approved','approved','rejected','cancelled','matched','matched','fulfilled'])[1 + g % 10]::public.request_status,
    now() - random() * interval '180 days', null from generate_series(1, $1) g`, [REQ]);
// replace the trigger-made single event with a realistic chain; reviewed_at for reviewed requests
await q("delete from public.request_events where request_id in (select id from public.blood_requests where hospital like 'Hospital %')");
await q(`insert into public.request_events (request_id, status, created_at) select id, 'pending_review', created_at from public.blood_requests where hospital like 'Hospital %'`);
await q(`insert into public.request_events (request_id, status, created_at) select id, 'approved', created_at + random() * interval '10 hours' from public.blood_requests where status in ('approved','matched','fulfilled')`);
await q(`insert into public.request_events (request_id, status, created_at) select r.id, 'matched', e.created_at + random() * interval '24 hours' from public.blood_requests r join public.request_events e on e.request_id = r.id and e.status = 'approved' where r.status in ('matched','fulfilled')`);
await q(`insert into public.request_events (request_id, status, created_at) select r.id, 'fulfilled', e.created_at + random() * interval '48 hours' from public.blood_requests r join public.request_events e on e.request_id = r.id and e.status = 'matched' where r.status = 'fulfilled'`);
await q(`insert into public.request_events (request_id, status, created_at) select id, status, created_at + random() * interval '10 hours' from public.blood_requests where status in ('rejected','cancelled')`);
await q(`update public.blood_requests r set reviewed_at = e.created_at from public.request_events e where e.request_id = r.id and e.status in ('approved','rejected') and r.hospital like 'Hospital %'`);
await q(`create unlogged table if not exists load_donor_ids as select user_id from public.donor_profiles`);
await q(`insert into public.offers (request_id, donor_id, origin, status, created_at, accepted_at, responded_at)
  select r.id, d.user_id, case when k % 2 = 0 then 'invited' else 'volunteered' end,
         (case when k = 1 then 'accepted' when k = 2 then 'invited' when k = 3 then 'declined' else 'accepted' end)::public.offer_status, r.created_at + interval '2 hours',
         case when k in (1, 4) then r.created_at + (k || ' hours')::interval end, case when k <> 2 then r.created_at + (k || ' hours')::interval end
  from public.blood_requests r cross join generate_series(1, 4) k
  cross join lateral (select user_id from load_donor_ids order by random() limit 1) d
  where r.status in ('approved','matched','fulfilled') on conflict do nothing`);
await q("insert into public.contact_consents (offer_id, granted, granted_at) select id, random() < 0.6, now() from public.offers where status = 'accepted' on conflict do nothing");
await q("insert into public.notification_preferences (user_id, email_enabled, email_categories) select user_id, true, array['request','offer','invitation','review','account'] from load_donor_ids where random() < 0.5 on conflict do nothing");
await q(`insert into public.notifications (user_id, message, category, is_read, created_at)
  select user_id, 'Load notification ' || g, (array['request','offer','invitation','review','account'])[1 + g % 5], random() < 0.4, now() - random() * interval '90 days' from load_donor_ids cross join generate_series(1, 20) g`);
await q("analyze");
}
await q("create unlogged table if not exists load_donor_ids as select user_id from public.donor_profiles");
const cnt = Object.fromEntries((await q("select 'profiles' t, count(*) from public.profiles union all select 'requests', count(*) from public.blood_requests union all select 'events', count(*) from public.request_events union all select 'offers', count(*) from public.offers union all select 'notifications', count(*) from public.notifications union all select 'email_outbox', count(*) from public.email_outbox")).rows.map((r) => [r.t, Number(r.count)]));
console.log("rows", JSON.stringify(cnt));

const admin = (await q("select id from public.profiles where role = 'admin' limit 1")).rows[0].id;
const donor = (await q("select donor_id id from public.offers group by donor_id order by count(*) desc limit 1")).rows[0].id;
const reqr = (await q("select requester_id id from public.blood_requests group by requester_id order by count(*) desc limit 1")).rows[0].id;
const D = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10), today = D(0);
console.log("\n| query | p50 ms | p95 ms | max ms | note |\n|---|---|---|---|---|");
row("analytics_admin 90d (all)", await time(() => as(admin, (c) => c.query("select public.analytics_admin($1,$2)", [D(89), today]))));
row("analytics_admin 365d", await time(() => as(admin, (c) => c.query("select public.analytics_admin($1,$2)", [D(364), today]))));
row("analytics_admin 90d, city + group filter", await time(() => as(admin, (c) => c.query("select public.analytics_admin($1,$2,'Lahore','O+')", [D(89), today]))));
row("analytics_donor 365d (busiest donor)", await time(() => as(donor, (c) => c.query("select public.analytics_donor($1,$2,null,null)", [D(364), today]))));
row("analytics_requester 365d (busiest)", await time(() => as(reqr, (c) => c.query("select public.analytics_requester($1,$2,null,null)", [D(364), today]))));
row("report_requests page 1 (25)", await time(() => as(admin, (c) => c.query("select * from public.report_requests('admin',$1,$2,null,null,'all',25,0)", [D(179), today]))));
row("report_requests deep page (offset 5000)", await time(() => as(admin, (c) => c.query("select * from public.report_requests('admin',$1,$2,null,null,'all',25,5000)", [D(179), today]))));
row("report_requests_aggregate (export)", await time(() => as(admin, (c) => c.query("select * from public.report_requests_aggregate($1,$2,null,null,'all',5)", [D(179), today]))));
row("open_requests_for_donor", await time(() => as(donor, (c) => c.query("select * from public.open_requests_for_donor()"))));
row("my_offers", await time(() => as(donor, (c) => c.query("select * from public.my_offers()"))));
const par = async (n, fn) => { const s2 = performance.now(); await Promise.all(Array.from({ length: n }, fn)); return +(performance.now() - s2).toFixed(0); };
console.log(`\n20 concurrent analytics_admin (pool 20): ${await par(20, () => as(admin, (c) => c.query("select public.analytics_admin($1,$2)", [D(89), today])))} ms wall`);
console.log(`50 concurrent analytics_donor/requester mix: ${await par(50, (i) => as(i % 2 ? donor : reqr, (c) => c.query(i % 2 ? "select public.analytics_donor($1,$2,null,null)" : "select public.analytics_requester($1,$2,null,null)", [D(89), today])))} ms wall`);

// rate limiter throughput (authenticated per-user limiter and the secret-gated anonymous limiter)
let t0 = performance.now(); for (let i = 0; i < 1000; i++) await q("select public.rate_limit_hit('load:' || $1, 1000000, 3600)", [i % 50]); const rl = 1000 / ((performance.now() - t0) / 1000);
const c = await pool.connect(); await c.query("begin"); await c.query("select set_config('request.headers',$1,true)", [JSON.stringify(secret ? { "x-limiter-secret": secret } : {})]); await c.query("set local role anon");
t0 = performance.now(); try { for (let i = 0; i < 500; i++) await c.query("select public.anon_rate_limit('auth.login.global','load')"); } finally { await c.query("rollback"); c.release(); }
console.log(`rate_limit_hit: ${rl.toFixed(0)} ops/s sequential; anon_rate_limit (gated): ${(500 / ((performance.now() - t0) / 1000)).toFixed(0)} ops/s`);

// notification fan-out + email queue
t0 = performance.now(); await q("select public.push_notification(user_id, 'Fan-out test', '/dashboard', 'load:fan:' || user_id) from load_donor_ids"); const fan = performance.now() - t0;
const queued = Number((await q("select count(*) from public.email_outbox where status = 'pending'")).rows[0].count);
console.log(`push_notification x${N}: ${fan.toFixed(0)} ms; email queue pending: ${queued}`);
if (process.env.LOAD_SMTP) {
  t0 = performance.now(); const r = await drainQueue({ pool, transport: nodemailer.createTransport(process.env.LOAD_SMTP), siteUrl: "http://localhost:3100", batch: 50 });
  console.log(`email drain: ${JSON.stringify(r)} in ${((performance.now() - t0) / 1000).toFixed(1)}s = ${(r.sent / ((performance.now() - t0) / 1000)).toFixed(0)} mails/s (local Mailpit)`);
}
const seq = (await q("select relname, seq_scan, idx_scan from pg_stat_user_tables where schemaname = 'public' and relname in ('blood_requests','request_events','offers','notifications','profiles') order by relname")).rows;
console.log("\nscan counts after run (seq_scan / idx_scan):", seq.map((r) => `${r.relname} ${r.seq_scan}/${r.idx_scan}`).join(", "));
await pool.end();
