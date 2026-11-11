# Continuous integration

Workflow: `.github/workflows/ci.yml`. It runs on pull requests, pushes to `main`, and manually (`workflow_dispatch`). It needs **no secrets**, deploys **nothing**, enables no paid service, and uses **fictional generated data** only.
Credentials for the throwaway local stack are generated inside the job into git-ignored files and are never printed; failure logs strip JWTs.

## Jobs

| Job | What it proves | Needs services? | Fails the run when |
|---|---|---|---|
| `unit` | ESLint, TypeScript, **pure unit tests** (`npm run test:unit`), secret scan | **No** (own Vitest config, no `.env`, no network) | any step fails |
| `build` | `next build` with public placeholder variables | No | build fails |
| `integration` | local Supabase-compatible stack (Docker Compose) -> **health gate** -> seed -> service-backed Vitest (RLS, workflow, Realtime WebSocket, e-mail, API, analytics, hardening) -> Playwright desktop + mobile (journeys, analytics, axe, keyboard, PWA, responsive) | **Yes** (PostgreSQL, GoTrue, PostgREST, Realtime, Mailpit) | stack unhealthy after 3 min, any test fails |
| `fresh-database` | `npm run verify:fresh`: all migrations on an empty **isolated** database + DB tests | Yes (own isolated stack) | any migration or test fails |
| `dependencies` | `npm audit --omit=dev --audit-level=high` (**always on**) and GitHub dependency review (**conditional**, below) | No | high/critical production vulnerability, or availability of dependency review cannot be determined |
| `ci-gate` | single required check | - | **any** job above is not `success` (skipped and cancelled count as failure) |

Jobs are independent, so one red job never hides another job's result.

## Unit vs. service-backed tests

| Command | Config | Scope |
|---|---|---|
| `npm test` / `npm run test:unit` | `vitest.unit.config.ts` | `src/**` and `tests/ai/**`: pure functions, no database, no network, no `.env` files |
| `npm run test:db` | `vitest.config.ts` | `tests/db/**`: needs PostgreSQL, GoTrue, PostgREST, Realtime and Mailpit |
| `npm run test:e2e` | `playwright.config.ts` | needs the stack plus a production build; AI uses the double-gated mock |
| `npm run test:live` | `playwright.config.ts` | manual; real Gemini with `GEMINI_API_KEY` (never in CI) |

**Nothing is skipped silently.** Locally, `test:db` without a stack skips with a visible warning (convenience). With `REQUIRE_SERVICES=1` (set by the `integration` job and by `verify:fresh`)
`tests/db/global-setup.ts` fails the whole run unless every required variable is set **and** GoTrue, PostgREST, the Realtime gateway and Mailpit answer, naming what is missing (never printing values).
`node scripts/stack-health.mjs [seconds]` (`npm run stack:health`) is the same check as a standalone gate: it waits up to the timeout, then exits 1 listing the unhealthy services.

## Dependency review: conditional, and why

`actions/dependency-review-action` needs GitHub's **dependency graph**, and on **private repositories also GitHub Advanced Security** (paid for private repos; free for public repos).
On this repository it failed with: `Dependency review is not supported on this repository. Please ensure that Dependency graph is enabled along with GitHub Advanced Security`.

The workflow therefore **probes the same API the action uses** (`GET /repos/{repo}/dependency-graph/compare/{base}...{head}`) before running it:

* HTTP 200 -> the action runs and fails the job on high/critical findings.
* HTTP 403/404 -> the feature is unavailable: the action is skipped **with a visible warning annotation and a job-summary section** ("Dependency review: NOT RUN"). This is a documented limitation, not a pass: the **production `npm audit` gate still ran** in the same job.
* any other answer (network error, 5xx, 401) -> the job **fails**, because the state is unknown. It is never skipped silently.

To enable full review: make the repository public, or enable **Settings -> Advanced Security -> Dependency graph** and GitHub Advanced Security (needs a paid plan for private repositories). No workflow change is needed; the probe will start returning 200.
Dependabot alerts/updates are configured separately (`.github/dependabot.yml`, minor/patch only) and are not part of this action.

## Known limits of CI
* The Docker images come from Docker Hub; a pull-rate limit would fail the stack job (re-run it).
* Runs use Chromium only. No hosted Supabase/Vercel is contacted; hosted behaviour is NOT covered (docs/DEPLOYMENT.md).
* The live-Gemini suite is manual because it needs a secret and free-tier quota.
