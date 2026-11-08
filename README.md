# DonorConnect AI Premium V2

Blood donor coordination platform. **Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Motion · Recharts · Supabase (PostgreSQL + Auth + RLS) · Vitest · Playwright · PWA.**

> Matching is preliminary. The app never diagnoses, never makes transfusion decisions and never decides donor eligibility. Eligibility is a status recorded by authorised staff; **no donation interval is hard-coded anywhere.**

## Status: Stage 6 (analytics and reporting; see [docs/STAGE6-ANALYTICS.md](docs/STAGE6-ANALYTICS.md))

Stage 6 adds role-specific analytics (`/dashboard/{admin/reports,donor/analytics,requester/analytics}`) and audited CSV exports. Stage 5 notes follow.

### Stage 5 (Gemini AI assistant)
| Area | State |
|---|---|
| Landing, design system, PWA, demo mode (`/demo/*`) | done |
| PostgreSQL schema, 8 versioned migrations, RLS, audit log | **done, tested against real PostgreSQL** |
| Auth, request workflows (requester / admin / donor), consent, eligibility recording | **done, tested** |
| **Notification center**: unread counters, categories, filters, timestamps, links, mark-as-read / mark-all, empty / loading / offline / error states | **done, tested** |
| **Realtime** (self-hosted Supabase Realtime): private per-user channel, ids-only payload, strict per-user authorization, reconnect + catch-up, polling fallback | **done, tested live over a real WebSocket** |
| **Persistent rate limiting** (PostgreSQL atomic counters; auth flows, request creation, invitations, contact disclosure, AI-ready) | **done, tested incl. concurrency** |
| **Optional email** (opt-in, generic content, local Mailpit only; production SMTP NOT configured) | **done, tested via Mailpit** |
| CSP + security headers, `no-store` private routes, service-worker cache audit | **done, tested** |
| **AI assistant** (Gemini via `@google/genai`, server-side only): streaming chat, history/clear, role-aware read-only tools, medical/privacy safeguards, quota + offline handling | **done; tested with a MOCK provider. Live Gemini: not verified unless a key was supplied (see below)** |
| Advanced analytics | **not started** (Stage 6) |

### Request lifecycle
`pending_review` → (`approved` | `rejected`) by an admin; `approved` ⇄ `matched` automatically as donors accept/withdraw; `matched` → `fulfilled` by the requester; `cancelled` by the requester or (with a note) an admin. `rejected`/`fulfilled`/`cancelled` are terminal. Donors never see or hear about a request before it is approved. Full table and rules: [`docs/V2-ARCHITECTURE.md`](docs/V2-ARCHITECTURE.md).

## Quick start (needs Docker)
```bash
npm install
npm run db:up      # real Supabase Postgres + GoTrue + PostgREST + Mailpit in Docker, applies migrations, writes .env.local
npm run db:seed    # fictional development accounts and requests (refuses non-local targets)
npm run dev        # http://localhost:3000
```
Fictional dev accounts (password `Demo@12345`, development only): `admin@demo.example`, `requester1@demo.example`, `donor1@demo.example` … `donor8@demo.example`.
Local services: API gateway `127.0.0.1:54321`, Postgres `127.0.0.1:54322`, **Mailpit inbox `http://127.0.0.1:54324`** (password-reset emails land here).
Clean slate: `npm run db:reset && npm run db:seed`. Stop: `npm run db:down`.
In a cloud sandbox without a running Docker daemon, start one first (`dockerd &`). The Supabase CLI binary is not required: `scripts/stack.mjs` + `supabase/docker-compose.yml` reproduce the stack from the official images. Migrations live in `supabase/migrations/` (the CLI's standard location).

No Docker? The app still runs: `npm run dev` shows the landing page and **demo mode** (`/demo/donor|requester|admin`); auth pages explain the backend isn't configured.

## Architecture
```
Browser ── Next.js (Server Components + Server Actions, no browser Supabase client)
              │  anon key + user JWT in an HttpOnly cookie  (service-role key is NEVER used by the app)
              ▼
        Nginx gateway ─┬─ GoTrue (auth.users, password hashing, recovery email)
                       └─ PostgREST ── PostgreSQL (RLS on every table)
```
Roles live in `public.profiles.role`, writable only by the database owner/service role. Sign-up metadata is client-controlled, so the `handle_new_user` trigger clamps it to `donor`/`requester`; admins are granted only by a privileged script or SQL.

### Permission layers (defence in depth)
1. `proxy.ts` (Next 16): refreshes the session, optimistic redirect for `/dashboard/*`.
2. Every role-specific page and Server Action calls `requireRole()` (layouts are not re-run on client navigation, so they are not trusted).
3. **PostgreSQL RLS + column-level grants** (the real boundary): users cannot write `role` or `eligibility_*`; donors never read `blood_requests` directly (they use `open_requests_for_donor()`, which hides requester identity and patient label); phone/email are released only by `consented_contacts()` to the request owner for accepted offers with live, revocable consent; `audit_logs` are admin-read-only and trigger/function-written.
4. Zod validation on every action; database `CHECK` constraints as a second net.

## AI assistant (Stage 5)
Open **Assistant** in any dashboard. To enable real Gemini add a free-tier key to `.env.local` (server-only, never `NEXT_PUBLIC_`): `GEMINI_API_KEY=...` (optional `GEMINI_MODEL`). Without a key the page says the assistant is not configured and the reviewed "Quick answers" still work. It never gives medical advice, never approves/invites/discloses contacts, and only reads data through role-bound tools under your own permissions. Details: [`docs/V2-ARCHITECTURE.md`](docs/V2-ARCHITECTURE.md#stage-5-gemini-ai-assistant). Billing is never required or enabled by this project.

```bash
npm run test:live   # OPTIONAL real-Gemini check; needs GEMINI_API_KEY, skipped otherwise
```

## Tests
```bash
npm test            # Vitest: unit + AI safety/orchestrator (mock) + 26 RLS + 23 workflow + 13 stage-4 (incl. LIVE realtime WebSocket) + 5 AI-tool DB tests + 7 email + 7 live HTTP API
npm run test:e2e    # builds, then Playwright on desktop + Pixel 7 (needs `npm run db:up && npm run db:seed`)
npm run lint && npm run typecheck
npm run verify:fresh # all migrations + db/realtime/email suites on a brand-new ISOLATED PostgreSQL (dev data untouched)
npm run email:once  # optional: send queued opt-in emails through local Mailpit (http://127.0.0.1:54324)
```
DB/API/realtime/email tests **skip with a visible warning** when the stack isn't running; they never fall back to mocks.

### Verification status (local Docker stack: real Supabase Postgres, GoTrue, PostgREST, **Realtime**, Mailpit)
**Stage 5 final run: typecheck pass, lint clean, Vitest 152/152 (11 files), production build pass, Playwright 106 passed / 0 failed / 6 skipped, `verify:fresh` PASS (all 8 migrations, 81 DB-side tests). The AI e2e tests use the MOCK provider; live Gemini was NOT verified (no key; `tests/live/gemini.live.spec.ts` skipped). Stage 4 record below is kept for history.**

**PASS (Stage 4 record):**
- Typecheck: pass. Lint: clean (0 errors, 0 warnings). Production build: pass.
- **Vitest 89 passed, 0 failed, 0 skipped** (7 files): 13 unit/validation, 26 RLS, 23 workflow (incl. 3 concurrency races), 13 stage-4 (notification categories/preferences, private-realtime RLS, atomic rate limits incl. a 40-way race, **LIVE WebSocket authorization**), 7 email via Mailpit, 7 live HTTP API.
- **Playwright 76 passed, 0 failed, 4 skipped** (desktop + Pixel 7). The 4 skips are the width-sweep tests, which run on the desktop project only by design.
- **Fresh-database verification** (`npm run verify:fresh`): a separate compose project (own containers, volume, credentials, ports +100) applies all 7 migrations to an empty PostgreSQL and passes the 76 database-side tests (RLS, workflow, stage 4 incl. live Realtime, email, API). The dev database is untouched.
- **Realtime authorization** (re-verified on the dev stack and on the fresh stack): the owner receives an ids-only message; another user, a user who *claims* the victim's topic, and an anonymous client are denied; clients cannot publish; at the SQL level a session cannot read another topic's rows. Weakening the policy back to the original makes the test fail (mutation-checked).
- Responsive layouts at 360 / 390 / 768 / 1280 px: no horizontal overflow on any role's screens.

**FAIL:** none in the final run.
**SKIPPED:** the 4 mobile-project width-sweep duplicates (above). The DB/API/email suites skip with a visible warning if the stack is not running; none were skipped here.

**Root cause of the earlier intermittent email e2e failure:** the email worker's `--once` processed a single batch of the oldest 20 due rows. Invitation tests notify up to 20 compatible donors, including leftover opted-in test donors from earlier runs, so a backlog of 60+ queued emails built up *ahead of* the e2e test's own row. The worker run never reached it (row stayed `pending`, attempts 0, Mailpit empty) and later runs drained it minutes afterwards. It appeared only after the Vitest suite had produced that backlog. Fixed by (1) the worker draining the whole queue (`drainQueue`), (2) a deterministic e2e regression that queues 45 older emails and requires a single run to drain them (reverting the worker makes it fail with exactly the original symptom), (3) isolation (global setup skips leftover pending rows; Vitest email tests opt their users out), and (4) a server-side completion check on the outbox row, with the row state printed on failure.


### NOT TESTED / production limitations (be aware)
- **No hosted Supabase project** was used; the official `supabase` CLI was not run (binary download blocked in the build sandbox).
- **Production** email confirmation / SMTP, TLS-terminated deployment (HSTS is sent but untested over HTTPS), per-IP rate limiting behind a trusted proxy, screen-reader and Lighthouse audits, load/soak testing of Realtime.
- Realtime reconnect was tested via browser offline/online and a blocked WebSocket, not via killing the Realtime server mid-session.
- `script-src` keeps `'unsafe-inline'` (Next bootstrap scripts); a nonce-based CSP would need fully dynamic rendering. The realtime token endpoint exposes the user's own access token to page scripts (documented trade-off).
- Rate limits are fixed windows; a victim's per-email login/reset quota can be consumed by an attacker; there is no per-IP limit without a trusted proxy.
- Local dev auto-confirms emails and uses Mailpit only; production needs email confirmation and an approved SMTP provider (deliberately not configured).
- Email delivery is at-least-once (a crash between SMTP accept and commit could resend one message).

## Using a hosted Supabase project (untested here)
1. Create a free project; in SQL editor run the files in `supabase/migrations/` in order (or `supabase db push`).
2. Auth → URL configuration: set Site URL and add `https://<your-domain>/auth/callback` to Redirect URLs. Enable email confirmation and SMTP.
3. Put **only** the project URL and `anon` key in your host's env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Never expose the service-role key.
4. Promote your first admin in the SQL editor: `update public.profiles set role = 'admin' where id = '<user uuid>';`

## Previous prototype
The FastAPI/SQLite version is preserved, unchanged and frozen, in `legacy/` (and on `main`, commit `8931be1`).
