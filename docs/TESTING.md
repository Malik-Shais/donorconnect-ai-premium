# Testing, quality results and how to reproduce them

All results are from the **local Docker stack** (real PostgreSQL, GoTrue, PostgREST, Realtime, Mailpit) with **fictional data only**, run in the Stage 7 session on 2026-11-08.
**Nothing was tested against a hosted Supabase project, Vercel, a real SMTP provider, a real domain, or real users.**

## Final verification

| Check | Result | Detail |
|---|---|---|
| ESLint | **PASS** | no warnings |
| TypeScript | **PASS** | `next typegen && tsc --noEmit` |
| Production build | **PASS** | `next build` |
| Secret scan | **PASS** | `npm run scan:secrets` over all tracked files |
| Dependency audit | **PASS (prod) / INFO (dev)** | 0 production vulnerabilities; 8 moderate in dev lint tooling, major-version fix deliberately not applied (docs/DEPENDENCIES.md) |
| Vitest | **PASS** 208/208 (15 files) | unit + AI + RLS + workflow + Stage 4 (live WebSocket) + email + analytics + hardening |
| Playwright (desktop + Pixel 7) | **PASS** 140 passed, 0 failed, **24 SKIPPED** | skips: 10 live-Gemini (need `DC_LIVE` + key), 7 analytics + 3 keyboard + 4 width-sweep duplicates on the mobile project (run once on desktop by design) |
| Accessibility (axe-core, WCAG 2.1 A/AA) | **PASS** | 6 public pages and every role's key screens incl. analytics, desktop and mobile; 0 violations after fixes |
| Keyboard navigation | **PASS** (desktop) | skip link, keyboard-only sign-in, filter form, data-table disclosure with visible focus |
| Responsive 360 / 390 / 768 / 1280 px | **PASS** | no horizontal overflow on every screen incl. analytics |
| PWA / service-worker privacy | **PASS** | manifest + icons; cache holds only `/offline.html`, `/_next/static/*`, `/icons/*`; offline navigation shows the generic page |
| Sessions / expiry | **PASS** | tampered or cleared session -> sign-in with `next`; APIs 401; session cookies HttpOnly |
| `npm run verify:fresh` | **PASS** | all 10 migrations on an empty isolated database, 108 DB-side tests |
| Live Gemini (`npm run test:live`, free tier, `gemini-3.5-flash-lite`) | **PASS with intermittent FAIL** | 5/5 on two runs, 4/5 on two others: the *requester tool* test ended in the assistant's `error` state (provider-side rate limit/unavailability handled gracefully; exact code not captured). Passed on immediate rerun |
| Lighthouse | **PASS** (see below) | |
| Load test (1 200 users) | **PASS** (see below) | |
| Outage drill (API + auth containers stopped) | **PASS** | 503 from `/api/health`, redirect to sign-in, no stack traces or hostnames, public pages still served; recovery needs the dev gateway restart (finding F11) |
| Screen-reader testing (NVDA/VoiceOver/TalkBack) | **NOT TESTED** | automated axe + keyboard only |
| Hosted Supabase / Vercel / real SMTP / e-mail confirmation flow / hosted Realtime | **NOT TESTED** | no hosted project configured |
| Report error banner, interrupted browser requests to the AI route | **NOT TESTED** end-to-end | the mock covers quota/unavailable states |
| Browser matrix | **NOT TESTED** | Chromium only (desktop + Pixel 7 emulation) |
| Third-party penetration test, legal/privacy review | **NOT TESTED** | |

## Lighthouse (v12.8.2, production build, local; mobile = simulated slow 4G + 4x CPU)

| Page | Perf | A11y | Best practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| `/` mobile | 94 | 100 | 100 | 100 | 3.0 s | 0 | 74 ms |
| `/login` mobile | 99 | 100 | 100 | 100 | 2.0 s | 0 | 52 ms |
| `/register` mobile | 99 | 100 | 100 | 100 | 2.1 s | 0 | 48 ms |
| `/demo/donor` mobile | 94 | 100 | 100 | 100 | 3.1 s | 0 | 46 ms |
| `/dashboard/donor` mobile (signed in) | 87 | 100 | 100 | 100 | 3.5 s | 0 | 246 ms |
| `/dashboard/admin/reports` mobile | **90** (was 64) | 100 | 100 | 100 | 3.5 s | 0 | 142 ms (was 1 199 ms) |
| `/` desktop | 100 | 100 | 100 | 100 | 0.7 s | 0 | 0 |
| `/dashboard/admin/reports` desktop | 99 | 100 | 100 | 100 | 0.9 s | 0 | 31 ms |

Transfer size 280-410 KB per page (fonts via `next/font`, no images on app screens). Fixes made: recharts code-split and loaded near the viewport; contrast tokens; heading order; focusable scroll regions.
Lab numbers, not field data: real-user Core Web Vitals are **NOT MEASURED**. Mobile LCP of ~3 s on the simulated slow network is above the 2.5 s "good" threshold; the remaining cost is the shared framework bundle and web fonts.

## Load and reliability test (`scripts/load-test.mjs`, isolated disposable stack, 1 200 users, 6 000 requests, 13 800 events, 4 200 offers, 51 100 notifications, ~10 000 queued e-mails)

| Query (p50 / p95, ms; 7 runs) | Before plan fix | After |
|---|---|---|
| `analytics_admin` 365 d | 889 / 982 | **179 / 185** |
| `analytics_admin` 90 d | 144 / 824 (cold) | 160 / 208 |
| `analytics_admin` 90 d + city + group | 87 / 103 | 81 / 87 |
| `analytics_donor` / `analytics_requester` 365 d (busiest user) | 33 / 58 | 33 / 58 |
| `report_requests` page 1 / offset 5 000 | 22 / 40 | 19 / 22 |
| `report_requests_aggregate` (export) | 18 / 37 | 14 / 16 |
| `open_requests_for_donor`, `my_offers` | 7 / 25 | 7 / 24 |

* Root cause fixed: after 5 calls plpgsql chose generic plans 4-5x slower; `plan_cache_mode = force_custom_plan` now pinned (migration `20261113000001`).
* 20 concurrent admin analytics calls: 1.55 s -> **0.96 s** wall; 50 concurrent donor/requester reports: 0.41 s.
* Rate limiter: ~1 700 `rate_limit_hit`/s, ~3 600-4 800 gated `anon_rate_limit`/s (sequential, one connection).
* `push_notification` x1 200: 17-121 ms. **E-mail worker: 10 353 queued e-mails drained in 208 s (~50 mails/s)** to local Mailpit with 0 failures/retries.
* Index use after the run: `request_events`, `offers`, `notifications`, `profiles` overwhelmingly index scans. `offers` shows sequential scans (20 222 vs 1.66 M index scans) from the `invited`/`cons` joins at this size; acceptable here, re-check with `EXPLAIN` above ~50 000 offers.
* Realtime reconnect/delivery: covered by the Stage 4 live-WebSocket tests (part of Vitest and verify:fresh); not load-tested with many concurrent sockets. **NOT TESTED**: > 1 200 users, hosted Postgres sizes, network latency to a remote database.

## What needs external services

| Test | Needs |
|---|---|
| `npm run check`, unit tests | nothing |
| `test:db`, `test:e2e`, `verify:fresh`, `load:test` | Docker (local stack; images from Docker Hub, rate limits apply) |
| `test:live` | `GEMINI_API_KEY` + free-tier quota (manual; never in PR CI) |
| Lighthouse | `npx lighthouse@12.8.2` + the bundled Chromium (`CHROME_PATH`) |
| Hosted checks | a staging Supabase + Vercel project (not configured) |

Determinism: fixtures are generated per test in unique cities/e-mails; the seed script creates fixed fictional accounts; the mock AI provider needs two explicit flags. Known flake sources: Docker Hub pull limits, the dev gateway after container restarts, and live-Gemini availability.

## Reproduce
```bash
npm ci && npm run db:up && npm run db:seed
npm run check && npm run test:db && npm run test:e2e && npm run verify:fresh
GEMINI_MODEL=gemini-3.5-flash-lite npm run test:live          # optional, uses the free tier
# load test (isolated stack on offset 200, never the dev database):
export DC_PROJECT=donorconnect-load DC_PORT_OFFSET=200 DC_ENV_FILE=supabase/.env.load; node scripts/stack.mjs up
DC_LOAD_OK=1 LOAD_DATABASE_URL=postgres://postgres:<pw from supabase/.env.load>@127.0.0.1:54522/postgres RATE_LIMIT_SECRET=<from .env.load> LOAD_SMTP=smtp://127.0.0.1:54525 npm run load:test 1200
node scripts/stack.mjs destroy                                  # same env vars
```
