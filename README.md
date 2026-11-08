# DonorConnect AI Premium V2

Blood donor coordination platform. **Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Motion · Recharts · Supabase (PostgreSQL + Auth + RLS) · Vitest · Playwright · PWA.**

> Matching is preliminary. The app never diagnoses, never makes transfusion decisions and never decides donor eligibility. Eligibility is a status recorded by authorised staff; **no donation interval is hard-coded anywhere.**

## Status: Stage 3 (request workflows)
| Area | State |
|---|---|
| Landing, design system, PWA, demo mode (`/demo/*`) | done |
| PostgreSQL schema, 6 versioned migrations, RLS, audit log | **done, tested against real PostgreSQL** |
| Register / login / logout / sessions / password recovery | **done, tested in a real browser** |
| **Requester**: 3-step request wizard, status + timeline, anonymous invitations, consented contact display, cancel / fulfil | **done, tested** |
| **Admin**: review queue (verification method, audited decisions), request management + full history/audit, moderation cancel, user suspension, **recording** of blood-service eligibility decisions | **done, tested** |
| **Donor**: filtered preliminary opportunities, accept/decline invitations, offers manager, revocable contact consent, notification preference | **done, tested** |
| Realtime, rate limiting, Gemini AI, advanced analytics | **not started** (Stage 4+) |

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

## Tests
```bash
npm test            # Vitest: unit/validation + 26 SQL/RLS + 23 workflow (incl. 3 concurrency races) + 7 live HTTP API tests
npm run test:e2e    # builds, then Playwright on desktop + Pixel 7 (needs `npm run db:up && npm run db:seed`)
npm run lint && npm run typecheck
```
DB/API tests **skip with a visible warning** when the stack isn't running; they never fall back to mocks. Security tests were mutation-checked (deliberately weakening a grant, a trigger or `is_admin()` makes specific tests fail).

**Verified live on the local Docker stack (real Supabase Postgres, GoTrue, PostgREST, Mailpit):** migrations from an empty database; the full requester → admin review → donor offer → consent → revoke → re-consent → fulfil journey; rejection; cancellation (requester and admin moderation); anonymous invitations; withdrawal; eligibility recording; suspension; cross-user access; forged/escalating requests (role change, `approved` insert, direct status patch, forged JWT); concurrent accepts and concurrent approve/reject; responsive layouts at 360/390/768/1280 px.

### Not verified / not done (be aware)
- **No hosted Supabase project** was used; nothing was run against supabase.com. The official `supabase` CLI was not run (binary download blocked in the build sandbox).
- Local dev auto-confirms emails (`GOTRUE_MAILER_AUTOCONFIRM=true`); **production must require email confirmation** and real SMTP. No email delivery of notifications (in-app only).
- No app-level rate limiting (GoTrue limits only), no CSP (basic security headers), no screen-reader or Lighthouse audit, no Realtime, no pagination beyond the newest 100 users/donors (search is provided).
- Admin analytics are live counts only; charts/reports arrive later.

## Using a hosted Supabase project (untested here)
1. Create a free project; in SQL editor run the files in `supabase/migrations/` in order (or `supabase db push`).
2. Auth → URL configuration: set Site URL and add `https://<your-domain>/auth/callback` to Redirect URLs. Enable email confirmation and SMTP.
3. Put **only** the project URL and `anon` key in your host's env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Never expose the service-role key.
4. Promote your first admin in the SQL editor: `update public.profiles set role = 'admin' where id = '<user uuid>';`

## Previous prototype
The FastAPI/SQLite version is preserved, unchanged and frozen, in `legacy/` (and on `main`, commit `8931be1`).
