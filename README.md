# DonorConnect AI Premium V2

Blood donor coordination platform. **Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Motion · Recharts · Supabase (PostgreSQL + Auth + RLS) · Vitest · Playwright · PWA.**

> Matching is preliminary. The app never diagnoses, never makes transfusion decisions and never decides donor eligibility. Eligibility is a status recorded by authorised staff; **no donation interval is hard-coded anywhere.**

## Status: Stage 2 (real backend)
| Area | State |
|---|---|
| Landing page, design system, PWA | done (stage 1) |
| PostgreSQL schema, versioned migrations, RLS, audit log | **done, tested against real PostgreSQL** |
| Register / login / logout / session persistence / password recovery | **done, tested end-to-end in a real browser** |
| Role-based route protection (proxy + per-page + per-action + RLS) | **done, tested** |
| Profiles, donor availability, requests (create / cancel / fulfil), donor opportunities + accept, consent-based contact sharing (database), notifications, admin user list | **done** (consent *UI* for requesters is next) |
| Demo mode with fictional data (`/demo/*`) | kept, clearly labelled |
| Gemini AI agent, advanced analytics, realtime, rate limiting | **not started** (by design: after auth/DB verification) |

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
npm test            # Vitest: unit + validation + 28 SQL/RLS tests (real Postgres) + 6 live HTTP API tests (real GoTrue/PostgREST)
npm run test:e2e    # builds, then Playwright (desktop + Pixel 7): 34 tests incl. real registration/login/recovery
npm run lint && npm run typecheck
```
DB and API tests **skip with a visible warning** when the stack isn't running; they never fall back to mocks. RLS tests were mutation-checked (deliberately weakening a grant/policy makes them fail).

### What was verified live (local Docker stack)
Migrations apply cleanly; sign-up/sign-in/recovery against real GoTrue; role-escalation, cross-user read/write, anonymous access, forged JWT, eligibility self-clearing, consent grant/revoke, audit-log protection; full browser flows on desktop and mobile; real reset email via Mailpit.

### Not verified / not done (be aware)
- **A hosted Supabase project** was not available: nothing here was run against supabase.com. Local GoTrue/PostgREST/Postgres versions are pinned in `supabase/docker-compose.yml`; hosted behaviour may differ in small ways (e.g. SMTP, email confirmation).
- Local dev sets `GOTRUE_MAILER_AUTOCONFIRM=true`. **Production must require email confirmation** and a real SMTP provider.
- The official `supabase` CLI (`supabase start/db push`) was not run (binary download blocked here); migrations follow its conventions but this path is untested.
- No app-level rate limiting yet (only GoTrue's built-in limits); no CSP (basic security headers only); no screen-reader or Lighthouse audit; Realtime not wired; requester-facing contact display, invitations and admin eligibility UI are next (their database functions and RLS are done and tested).

## Using a hosted Supabase project (untested here)
1. Create a free project; in SQL editor run the files in `supabase/migrations/` in order (or `supabase db push`).
2. Auth → URL configuration: set Site URL and add `https://<your-domain>/auth/callback` to Redirect URLs. Enable email confirmation and SMTP.
3. Put **only** the project URL and `anon` key in your host's env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Never expose the service-role key.
4. Promote your first admin in the SQL editor: `update public.profiles set role = 'admin' where id = '<user uuid>';`

## Previous prototype
The FastAPI/SQLite version is preserved, unchanged and frozen, in `legacy/` (and on `main`, commit `8931be1`).
