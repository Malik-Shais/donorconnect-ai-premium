# DonorConnect AI Premium V2

Consent-based blood-donor coordination. Next.js 16 · React 19 · TypeScript · Tailwind 4 · Supabase-compatible stack (PostgreSQL + RLS, GoTrue, PostgREST, Realtime) · optional Gemini assistant.
The earlier FastAPI/SQLite prototype is preserved unchanged in [`legacy/`](legacy/).

> **Release status: release candidate, development-tested only.** Everything below was verified on the local Docker stack with fictional data.
> **Nothing is deployed and nothing has been verified on hosted Supabase/Vercel or with real users.** See [Deployment blockers](docs/DEPLOYMENT.md#deployment-blockers-do-not-launch-until-closed).

## What it does
| Area | Capabilities |
|---|---|
| Accounts | donor / requester / admin roles (admins only via the database), suspension, e-mail + password auth, rate-limited |
| Request workflow | submit -> admin review (approve/reject with audit) -> compatible donors notified -> accept/decline/withdraw -> matched -> fulfilled/cancelled; transitions enforced in the database |
| Privacy | contact details shared only per-offer with explicit, revocable consent; no medical eligibility is ever computed; patient aliases only |
| Notifications | in-app, live via private Realtime channels, optional generic e-mail through a worker |
| AI assistant | Gemini, server-side, role-bound read-only tools, safety rules outside the model; live-verified on the free tier (mock in CI) |
| Analytics & reports | admin / donor / requester dashboards (Recharts, accessible tables), filters, k-anonymous CSV exports, audit log — [definitions](docs/STAGE6-ANALYTICS.md) |
| Quality | axe-core clean (WCAG 2.1 A/AA), Lighthouse a11y 100 / best-practices 100 / SEO 100, PWA with privacy-safe service worker, 360-1280 px layouts |

## Quick start (local, needs Docker, Node 22)
```bash
npm ci
npm run db:up        # Postgres, Auth, REST, Realtime, Mailpit; applies all migrations; writes git-ignored .env.local
npm run db:seed      # fictional demo accounts: admin@demo.example, donor1@demo.example, requester1@demo.example (password Demo@12345, local only)
npm run build && npm start -- -p 3100      # or: npm run dev
```
Mail UI (Mailpit): http://127.0.0.1:54324. Stop: `npm run db:down`; wipe: `npm run db:reset`.
Optional assistant: put `GEMINI_API_KEY=...` in `.env.local` (free tier; never commit it). Without it the assistant says it is not configured.

## Commands
| Command | Purpose | Needs |
|---|---|---|
| `npm run check` | lint + typecheck + unit tests + secret scan | nothing |
| `npm test` | Vitest (DB suites skip with a warning if no stack) | optional stack |
| `npm run test:db` | RLS, workflow, stage 4 (live WebSocket), email, analytics, hardening | stack |
| `npm run test:e2e` | build + Playwright (desktop + mobile): journeys, analytics, axe, keyboard, PWA | stack |
| `npm run verify:fresh` | all migrations on a brand-new **isolated** database + DB tests | Docker |
| `npm run test:live` | real Gemini API (manual; needs `GEMINI_API_KEY`) | key + quota |
| `npm run load:test` | 1 000+ fictional users benchmark (isolated stack only) | Docker |
| `npm run audit:prod`, `npm run scan:secrets` | dependency and secret checks | nothing |

## Documentation
[Architecture](docs/V2-ARCHITECTURE.md) · [Security & privacy review](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md) · [Testing & results](docs/TESTING.md) · [Analytics definitions](docs/STAGE6-ANALYTICS.md) ·
[User guide](docs/USER_GUIDE.md) · [Admin guide](docs/ADMIN_GUIDE.md) · [Dependencies](docs/DEPENDENCIES.md) · [Release checklist](docs/RELEASE.md) · [Security policy](SECURITY.md)

## Database migrations
`supabase/migrations/*.sql`, applied in filename order (10 files; core schema -> RLS -> functions -> workflow -> notifications/realtime/limits -> AI budget -> analytics -> hardening).
Local: `npm run db:migrate` (tracked in `supabase_migrations.schema_migrations`). Hosted: `supabase db push` (docs/DEPLOYMENT.md). Never edit an applied migration; add a new one.

## Environment
See `.env.example` (local) and `.env.production.example` (hosted). Public: Supabase URL and anon key. **Server-only secrets: `RATE_LIMIT_SECRET`, `GEMINI_API_KEY`.** The Supabase service-role key is never used by the web app.

## Limitations to be aware of
Preliminary (non-clinical) blood-group compatibility; no medical advice; free-tier Gemini quotas are tight and prompts may be used by Google; no MFA/CAPTCHA/IP limits; CSP needs `'unsafe-inline'` for scripts;
local nginx gateway needs a restart after restarting its upstream containers; no legal/privacy review. Details: [docs/SECURITY.md](docs/SECURITY.md).
