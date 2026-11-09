# Private staging environment

A private, free-tier preview for inspecting the finished product with **fictional data only**. It is **not** public, has no custom domain and uses no billing.
No credentials appear in this repository or in this file: the demo passwords were generated for this environment and given to the owner privately.

| Piece | Value |
|---|---|
| Supabase project | `donorconnect-ai-premium-staging`, id `epxsqchyuyhcktvlqnrk`, region Mumbai (ap-south-1), Free plan, PostgreSQL 17 |
| Vercel project | `donorconnect-premium-staging` (Hobby), URL `https://donorconnect-premium-staging.vercel.app` |
| Code | branch `feature/premium-nextjs-v2` at the CI-verified commit (see the deployment record in the PR) |
| Gemini assistant | **not configured** on purpose (the page shows "not configured"; quick answers still work) |

## Protection
* **Vercel Authentication on all deployments** (production and preview): anyone not signed in to the owner's Vercel account is redirected to Vercel's sign-in (verified for the stable alias, the team alias and the unique deployment URL, for pages and API routes).
* **No protection-bypass secret was created** (it would be a second way in).
* Database: RLS on all 15 tables, no anonymous grants, `app_settings` unreachable through the API, rate limiter gated by a server-only secret (stored only as a SHA-256 hash in the database and as a *sensitive* Vercel variable).
* Demo/real separation: `app_settings.environment = 'staging'` allows `.example` demo accounts, which are flagged `is_demo`. Production keeps `environment = 'production'`, which refuses them, so nothing here weakens production.
* The Supabase service-role key is used only for seeding from a private session; it is **not** in Vercel and not in any browser bundle (scanned: no service-role key, limiter secret or password in the shipped files).

## Differences from production (deliberate, staging only)
Auto-confirm for sign-ups (the free built-in e-mail sender allows about 2 e-mails per hour); `environment = staging`; password minimum 8 (matches the app); Gemini off; seeded demo data.

## Testing it safely
1. Open the URL in a browser signed in to **your** Vercel account (on a phone: sign in to Vercel there first).
2. Sign in with a demo account (the owner has the passwords): `donor1@demo.example` (donor), `requester1@demo.example` (requester), `admin@demo.example` (admin).
3. Use fictional data only: no real names, phone numbers, e-mails, hospitals or patient details. Self-registration works (auto-confirmed); use made-up `@test.example` addresses.
4. Suggested flow with three browser profiles: requester submits a request, admin approves it (Review queue), donor accepts and shares contact (a live notification arrives without reloading), requester sees the contact, donor revokes, requester fulfils. Then open Analytics & reports, download a CSV, and try the donor and requester analytics pages.
5. Report problems with the page, role and time; nothing here is real data.

## What was verified on the hosted backend (2026-11-09)
Migrations (10, clean on PostgreSQL 17); hosted audit equals the local audit; the limiter refuses the anon key alone, a wrong secret and a global-counter burn, and accepts the correct secret; sign-in for all three roles, a wrong password, self-registration and the persistent sign-in limiter; the full request -> approval -> **live Realtime push** -> consent -> revoke -> fulfil workflow; admin, donor and requester analytics; CSV exports (aggregate only, role-isolated); the Gemini-unconfigured state.
These ran against the hosted Supabase project using the production build served locally. **The Vercel-served instance itself is behind Vercel Authentication and was not exercised by automation.** One hosted-only defect was found and fixed: `/api/health` needs the public `apikey` header on hosted Supabase.

## Redeploy / teardown
* Redeploy: export the verified commit (`git archive <sha>`), then `vercel deploy --prod` from that folder with `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` set (the project already holds the environment variables).
* Teardown: delete the Vercel project; delete or pause the Supabase project; delete the Supabase and Vercel access tokens you created; remove the saved credentials from the Claude environment settings.
* Free-tier limits: Supabase pauses an idle free project after about a week; Vercel Hobby is for non-commercial use.
