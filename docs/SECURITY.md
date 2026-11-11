# Security and privacy review (Stage 7)

Scope: authentication, sessions, role authorization, PostgreSQL RLS, API endpoints, privileged SQL functions, rate limiting, consent revocation,
Realtime authorization, Gemini tools, CSV exports, demo-data classification, and leakage through logs, errors, AI prompts, exports and notifications.
Method: catalog queries against the running database (RLS coverage, grants, `SECURITY DEFINER` inventory), code review, and executable tests.
Everything below was **development-tested on the local Docker stack**; nothing was verified on a hosted Supabase project or in production.

## Findings (prioritised)

| ID | Severity | Finding | Status | Evidence |
|---|---|---|---|---|
| F1 | **High** | `anon_rate_limit()` was executable by anyone holding the **public** anon key. An attacker could burn `auth.login.global` (600/min) and lock every user out, or exhaust the shared `ai.global` AI budget. | **Fixed**: the RPC requires a server-only secret (`x-limiter-secret`, only its SHA-256 stored in `public.app_settings`); in production without a configured secret it **fails closed**. | `tests/db/hardening.test.ts` |
| F2 | Medium | Fictional/real classification was only an email-domain heuristic and unprotected in principle. | **Fixed**: explicit column, no user/admin write grant, guard trigger, audited admin function `set_account_demo`, seed marks accounts explicitly, production refuses demo-domain sign-ups and demo marking. | `hardening.test.ts` |
| F3 | Medium | Administrator request export contained row-level quasi-identifiers (request id + exact date + city + blood group + urgency). | **Fixed**: export is a k-anonymous weekly aggregate (k = 5: generalise city, then fold into an attribute-free "(suppressed)" row); filters isolating < 5 requests or donors are refused for every admin export. | `hardening.test.ts`, `analytics.spec.ts` |
| F4 | Low (availability) | After 5 calls plpgsql switched report functions to generic plans that were 4-5x slower (load test). | **Fixed**: `plan_cache_mode = force_custom_plan` on all report functions. | `scripts/load-test.mjs` |
| F5 | Low | WCAG failures: teal text contrast (3.9:1), unread badge contrast (2.9:1), heading order, scrollable regions not keyboard-focusable, role-less `aria-label`. | **Fixed** | axe suite `tests/e2e/quality.spec.ts` |
| F6 | Medium (config) | Local GoTrue auto-confirms e-mail (`GOTRUE_MAILER_AUTOCONFIRM=true`) and uses Mailpit. | **Documented**: hosted project must enable e-mail confirmation and custom SMTP (docs/DEPLOYMENT.md). The e-mail confirmation flow on a hosted project is **NOT TESTED**. | |
| F7 | Info | CSP allows `'unsafe-inline'` for scripts (Next.js bootstrap). | Accepted limitation; nonce-based CSP would force fully dynamic rendering. Everything else is locked down (no framing, no external forms, connect-src limited to this origin and Supabase). | `next.config.ts` |
| F8 | Info | Gemini **free tier**: Google may use prompts to improve its products. | **Risk to accept or avoid**: do not type personal data into the assistant; tools return whitelisted, non-identifying fields only. A paid tier with data-protection terms needs billing (not activated). | |
| F9 | Info | No CAPTCHA and no per-IP limiting (client IP headers are spoofable without a trusted proxy). Limits are per e-mail, per user and global. A flood of *distinct* login attempts can still exhaust the global login limiter. | **Residual risk**: add Cloudflare/Vercel firewall rules and a CAPTCHA before public launch. | |
| F10 | Info | `anon_rate_limit` relies on PostgREST exposing `request.headers`. | **Verified on hosted Supabase (staging, 2026-11-09)**: the anon key alone, a wrong secret and a global-counter burn attempt are refused; the correct secret works. Still fails closed in production if the header is ever absent. | `docs/STAGING.md` |
| F11 | Info | Local nginx gateway caches upstream IPs: after restarting `rest`/`auth` containers, restart `gateway` too. | Dev-only; hosted Supabase unaffected. | outage drill |
| F12 | Info | In-app invitation text contains the hospital name (donors see it in the opportunity anyway). E-mails are generic by design. | Accepted product decision | `email-worker.mjs` |

## Controls verified (development)

| Area | Control | Verified by |
|---|---|---|
| Authentication | Supabase Auth; password min 8 (set 10+ in production); login/register/forgot limited per e-mail and globally; generic error messages | `auth.spec.ts`, `stage4.test.ts` |
| Sessions | HttpOnly cookies, `Secure` in production, `getUser()` validates the JWT with the auth server in the proxy; tampered/expired cookie -> redirect to sign-in; APIs answer 401 | `quality.spec.ts` |
| Role authorization | Role comes from `public.profiles` (never JWT metadata, URL or client); every page and action calls `requireRole`; suspended accounts lose all privileges (`current_app_role()`/`is_admin()`) | `rls.test.ts`, `workflow.test.ts`, e2e |
| RLS | Every `public` table has RLS enabled; no `anon` grants; users cannot write role/suspension/eligibility/demo columns (column-level grants only) | catalog audit + `rls.test.ts` |
| Privileged SQL | 39 `SECURITY DEFINER` functions, **all** with a fixed `search_path`; 24 are callable by signed-in users (each re-checks the caller's role), the rest are internal; execute is revoked from `PUBLIC`/`anon` except the secret-gated limiter | catalog audit |
| Rate limiting | PostgreSQL-backed, atomic, persistent: per-user (`rate_limit_check`) and gated global/anonymous (`anon_rate_limit`); 1 700 - 4 800 ops/s | `stage4.test.ts`, load test |
| Consent | Contact details only after explicit per-offer grant; revoke/withdraw/close hides them again; disclosure is audited | `rls.test.ts`, `workflow.test.ts`, `api.test.ts` |
| Realtime | Private channels; one topic per user (`notif:<uid>`); `realtime.messages` policy allows receive only on own topic; clients cannot send | `stage4.test.ts` (live WebSocket) |
| Gemini | Key server-side only; tools are role-bound, read-only, whitelisted fields; emergencies and medical-decision questions never reach the model; output redaction and policy guard; per-user and global budgets | `tests/ai`, `ai-tools.test.ts`, live run |
| Exports | Role check, validated filters, audit + rate limit before sending, `no-store`, formula-injection protection, no identifiers/contacts/hospitals/patient labels, k-anonymous admin export | `csv.test.ts`, `analytics.spec.ts`, `hardening.test.ts` |
| Headers | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy; private routes `no-store` | `next.config.ts` |
| PWA / service worker | Caches only `/offline.html`, `/_next/static/*`, `/icons/*`; never navigations, API or auth; offline page is generic | `quality.spec.ts` |

## Re-identification analysis of CSV exports

| Export | Content | Risk handling |
|---|---|---|
| `admin.requests` | ISO week x city x blood group x urgency x status, counts and units | cells < 5 generalised then suppressed; no id, no exact date; refuses filters isolating < 5 |
| `admin.summary/trend/supply_demand` | aggregates by group/day/city | same refusal rule; city breakdown merged below 5 |
| `donor.offers`, `requester.requests` | the caller's **own** rows (ids, dates, city, group) | own data only, no other person's data |

Residual: *differencing* (comparing two overlapping exports/filters) and small totals can still narrow a population; the suppression bucket reveals a small count without attributes. Exports are rate limited (30/hour) and audited (`report.export`) so abuse is detectable. Treat exports as confidential.

## Leakage review (logs, errors, AI, notifications)

* **Logs/errors**: `src/` has no `console.*`; `rpc()` maps database errors to user-safe messages; the error boundary shows a fixed text; the e-mail worker stores only an error *code*; audit `detail` is whitelisted. The outage drill produced no stack traces or hostnames in responses.
* **AI**: tool results contain no names, phones, e-mails, ids, hospitals or patient labels; history is an untrusted transcript; streamed output is redacted for e-mail/phone/uuid patterns.
* **Notifications / e-mail**: e-mails carry only a category and a link, never request, patient or contact details.
* **Not tested**: third-party log drains, Vercel/Supabase dashboards' own retention, browser extensions.

## Known limitations

No MFA, no CAPTCHA, no IP-level limits, no automated anomaly alerting, free-tier AI data terms (F8), `unsafe-inline` scripts (F7), free-text cities, preliminary (non-clinical) compatibility, no medical eligibility computation by design, no penetration test by a third party, no formal privacy/legal review (health-adjacent data may fall under local law such as GDPR or national health-data rules).
