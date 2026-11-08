# Deployment guide (hosted Supabase + Vercel)

> **Status: prepared, NOT deployed, NOT verified on hosted infrastructure.** No hosted Supabase project or Vercel project was configured during development, so nothing in
> this guide has been executed against them. It is derived from the local stack (which uses the same migrations, GoTrue, PostgREST and Realtime) and provider documentation.
> Do not deploy, add a domain, enable billing, or load real donor/patient data without explicit approval (see "Deployment blockers").

## 1. Architecture and where each piece runs

| Piece | Runs on | Notes |
|---|---|---|
| Web app (Next.js 16, Node runtime) | Vercel | `vercel.json` disables automatic production deploys from `main` until you approve |
| Postgres, Auth, Realtime | Supabase | all schema, RLS and logic is in `supabase/migrations/*.sql` (10 files) |
| Gemini assistant | Google AI (server-side calls from Vercel) | optional; free tier only |
| E-mail notifications | `scripts/email-worker.mjs` + SMTP provider | **cannot run on Vercel serverless**, see step 9 |

## 2. Environment variables

| Variable | Where | Secret? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | no | project URL (also feeds the CSP `connect-src`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | no (RLS protects data) | publishable/anon key |
| `NEXT_PUBLIC_SITE_URL` | Vercel | no | absolute URL for reset links |
| `RATE_LIMIT_SECRET` | Vercel (Sensitive) | **yes** | server-only; lets the app use the rate-limit RPC (step 5) |
| `GEMINI_API_KEY` | Vercel (Sensitive) | **yes** | optional; absent = "assistant not configured" |
| `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS` | Vercel | no | defaults `gemini-3.6-flash`, 25000 |
| `DATABASE_URL`, `EMAIL_SMTP_URL`, `EMAIL_ALLOW_REMOTE=1`, `SITE_URL` | e-mail worker host only | **yes** | never on Vercel |

Never set: `SUPABASE_SERVICE_ROLE_KEY` (unused), `AI_PROVIDER`/`DC_ALLOW_AI_MOCK` (test mock). `.env.production.example` is the template; filled copies must never be committed (`npm run scan:secrets` checks tracked files).

## 3. Create the Supabase project (staging first)

1. Create a **staging** project (free tier) and a strong database password (password manager). Create production later, only after approval.
2. Install the Supabase CLI, then:
   ```bash
   supabase login
   supabase link --project-ref <staging-ref>
   supabase db push --dry-run     # shows the pending migrations
   supabase db push               # applies supabase/migrations in order
   ```
3. **Before every later push, take a backup** (`supabase db dump -f backup-$(date +%F).sql`); the free tier has no point-in-time recovery. Migrations are forward-only: rollback means restoring the dump, so rehearse on staging.
4. The local-only tweaks in `scripts/stack.mjs` (revoking `realtime.messages` privileges as `supabase_admin`) are **not** applied on hosted projects; the RLS policy `notif_topic_receive` created by migration `20261110000001` is what protects Realtime. Verify it (step 11).

## 4. First administrator

Admins are never created through sign-up. Register normally (as a requester), confirm the e-mail, then in the SQL editor:
```sql
update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.org');
```
Keep at least two administrators.

## 5. Production switches (SQL, once per environment)

Generate the secret locally and store **only its hash** in the database:
```bash
SECRET=$(openssl rand -hex 32)            # put this value in Vercel as RATE_LIMIT_SECRET (Sensitive)
printf %s "$SECRET" | sha256sum           # copy the hex digest
```
```sql
update public.app_settings set value = '<hex digest>' where key = 'limiter_secret_sha256';
update public.app_settings set value = 'production'   where key = 'environment';
```
Effects: the rate-limit RPC rejects callers without the secret (and **fails closed** if it is missing), demo-domain sign-ups (`*.example`) and demo marking are refused.
Check: `select * from public.app_settings` must fail for anon/authenticated (it is not exposed through the API).

## 6. Auth settings (Dashboard -> Authentication)

* **Confirm e-mail: ON** (local development auto-confirms; production must not). **Anonymous sign-ins: OFF.**
* Site URL = your domain; Redirect URLs = `https://<domain>/auth/callback` and the reset-password URL.
* Minimum password length 10+, leaked-password protection where the plan offers it; JWT expiry 3600 s; refresh-token rotation ON.
* **Custom SMTP (required for real users)**: the built-in sender is for testing only and heavily rate limited. Use a provider with SPF/DKIM/DMARC configured for your sending domain.
* Add a CAPTCHA (Turnstile/hCaptcha) in Supabase Auth and in the sign-in form before public launch (not implemented: finding F9).

## 7. Vercel project

1. Import the GitHub repository; framework Next.js; Node 22; install `npm ci`; build `npm run build`.
2. Add the variables from section 2 for the Production (and Preview, with the **staging** Supabase) environments. Mark secrets *Sensitive*.
3. Choose the function region closest to the Supabase region. The AI route has `maxDuration` 60 s.
4. HTTPS is automatic; the app already sends HSTS (`max-age=63072000; includeSubDomains`, no preload). Add the custom domain **only after approval**.
5. Keep "Production Branch" deploys manual until the blockers are closed.

## 8. Gemini (optional)

Free-tier key from Google AI Studio, server-side only. Quotas are small (observed 429 within minutes during testing); the app degrades to "usage limit" and reviewed quick answers. Free-tier prompts may be used by Google to improve products: keep personal data out of the assistant (finding F8).

## 9. E-mail worker

In-app notifications work without it. Digest-free generic e-mails are sent by `scripts/email-worker.mjs` (`npm run email:worker`), a polling process, so it needs a small always-on host (VM, container, or a scheduled job running `npm run email:once` every minute).
It refuses remote SMTP unless `EMAIL_ALLOW_REMOTE=1`, TLS (`smtps://` or `?requireTLS=true`) and an `https://` `SITE_URL`. It needs a database connection string with access to `auth.users` (use the Supabase connection pooler in **session** mode; treat it as a high-privilege secret). Not tested against a real SMTP provider.

## 10. Smoke test on staging (record the results in docs/RELEASE.md)

1. `GET /api/health` -> `{"ok":true,"db":"up"}`.
2. Register -> confirmation e-mail arrives -> sign in. Register a requester and a donor; promote an admin (step 4).
3. Request -> admin review -> donor sees it -> accept with consent -> requester sees contact; revoke -> hidden.
4. Notifications arrive live (Realtime) in two browsers; a user cannot subscribe to another user's topic.
5. Admin analytics loads; CSV exports download; a 1-request city filter is refused.
6. Assistant answers (if a key is set); emergency text short-circuits.
7. `select * from public.app_settings` as anon/authenticated fails; the rate-limit RPC with only the anon key fails.
8. Lighthouse and axe on the deployed URL; confirm security headers (securityheaders.com).

## 11. Rollback

Redeploy the previous Vercel deployment (instant). For database changes restore the pre-migration dump; never edit applied migrations, add a new one.

## 12. Operational costs and free-tier constraints (approximate; confirm on the providers' pricing pages)

| Service | Free tier | Limits that matter here |
|---|---|---|
| Supabase Free | $0 | ~500 MB database, ~50 000 monthly active users, project **pauses after ~1 week of inactivity**, no point-in-time recovery, built-in SMTP unusable for real traffic, Realtime concurrent-connection and message-rate caps |
| Vercel Hobby | $0 | **non-commercial use only**, bandwidth/function limits; a commercial or organisation deployment needs Pro |
| Gemini API free tier | $0 | very small per-minute/day quotas; prompts may be used to improve Google products |
| SMTP provider | usually a small free tier | needed for confirmation and notification e-mail |
| Domain | ~$10-15/year | required for e-mail authentication (SPF/DKIM) |

A realistic starting production cost is the Supabase Pro plan plus Vercel Pro plus an SMTP provider; decide before launch.

## Deployment blockers (do not launch until closed)

1. No hosted staging environment has been created or tested (Auth e-mail confirmation, SMTP, Realtime policy, `request.headers` for the limiter).
2. Legal/privacy review of health-adjacent data handling, retention and a privacy notice/terms (none written).
3. CAPTCHA and IP-level protection (finding F9).
4. A production e-mail sending domain and the e-mail worker host.
5. Gemini data terms (F8): keep the assistant off or on a paid plan with appropriate terms.
6. Backup/restore drill and an on-call/incident process.
7. Explicit approval for billing, domain and go-live.
