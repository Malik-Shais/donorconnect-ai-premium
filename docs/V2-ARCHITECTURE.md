# Premium V2 architecture

## Stack
Next.js App Router (Server Components + Server Actions, no browser-side Supabase client), Tailwind 4 tokens in `src/app/globals.css`, shadcn-style primitives in `src/components/ui`, Radix Dialog for confirmations. Supabase-compatible Postgres + GoTrue + PostgREST (local Docker stack in `supabase/`). Gemini and advanced analytics are later stages.

## Authorization model (read this first)
**A user's role comes only from `public.profiles.role`.** It is never read from JWT claims, `user_metadata` or `app_metadata`, and never from the URL or client state.
- `profiles.role` cannot be written by app users (column-level grants: only `full_name`, `city`, `phone` are updatable). It is set by the `handle_new_user` trigger, which **clamps client-supplied sign-up metadata to `donor` or `requester`**, and by privileged setup (seed script / SQL editor) for admins.
- RLS policies and SECURITY DEFINER functions resolve the caller with `auth.uid()` (the signature-verified JWT subject) and then look the role up in `profiles` (`current_app_role()`, `is_admin()`).
- A suspended profile resolves to no role at all, so it loses every privileged capability immediately.
- The app repeats the check in every page and Server Action (`requireRole`) purely for UX and early rejection; the database is the authority.

## Data model (`supabase/migrations`, applied in order)
| Migration | Content |
|---|---|
| `…1108000001` core schema | profiles, donor_profiles, blood_requests, request_events, offers, contact_consents, notifications, audit_logs, blood_compat; signup + history triggers |
| `…1108000002` rls + grants | RLS on every table; all default privileges revoked, then minimal grants + policies |
| `…1108000003` functions | stage 2 functions (superseded) |
| `…1109000001` workflow enums | `open`→`approved`, adds `pending_review`, `rejected`, offer `withdrawn` (alone: new enum values are unusable in the same transaction) |
| `…1109000002` request workflow | review/suspension/eligibility-provenance columns, `request_transitions` + enforcing trigger, notification dedupe index, tightened policies |
| `…1109000003` workflow functions | `review_request`, `transition_request`, `invite_donors`, `accept_request`, `respond_to_invitation`, `withdraw_offer`, `set_contact_consent`, `owner_request_offers`, `my_offers`, `open_requests_for_donor`, `set_donor_eligibility`, `set_user_suspended` |

## Request lifecycle (single source of truth: table `request_transitions`)
| From | To | Actor | Notes |
|---|---|---|---|
| pending_review | approved / rejected | admin | verification method required to approve; reason required to reject |
| pending_review | cancelled | requester, admin | admin needs a note |
| approved | matched | system | first donor accepts |
| approved | cancelled | requester, admin | |
| matched | approved | system | the last accepted donor withdraws |
| matched | fulfilled | requester | only the requester can fulfil |
| matched | cancelled | requester, admin | |
`rejected`, `fulfilled`, `cancelled` are terminal. Direct `UPDATE` of request status is revoked for every app role; all moves go through audited functions that lock the row (`FOR UPDATE`), and a `BEFORE UPDATE` trigger rejects any pair not in the table, even from privileged roles.

## Visibility and disclosure rules
- Donors are notified and can see a request **only after approval** (`approved`/`matched`). They never receive the patient label or any requester identity (`open_requests_for_donor`, `my_offers` omit them).
- Requesters never read raw `offers` rows. `owner_request_offers` returns anonymous rows; **name, phone and email appear only if the donor's consent is currently granted, the offer is accepted, and the request is still active**. Closing a request ends access. Administrators never receive contact details.
- Consent is per offer and revocable. Revoking (or withdrawing the offer) stops *future* in-app access; the UI states that anything already seen or copied cannot be recalled.
- Disclosures are audited (`contact.disclosed`, at most once per 10 minutes per viewer and request) with only a count, never contact values. Audit logs are admin-read-only and written only by functions/triggers.

## Matching and notifications
Preliminary ABO/Rh red-cell compatibility (`blood_compat`, mirrored and tested against `src/lib/compat.ts`) with explicit disclaimers. Ranking: same city, then urgency, then needed-by, then recency. Approval notifies up to 50 same-city, compatible, available, opted-in, non-deferred, non-suspended donors. `notifications` has a unique `(user_id, dedupe_key)` so retries and races cannot repeat a notification. Realtime delivery is Stage 4.

## Eligibility
Medical eligibility is decided by authorised blood services, not by this app. `set_donor_eligibility` only **records** a decision with a mandatory named source, the recording admin and a timestamp (audited). `deferred` removes a donor from matching; no interval is hard-coded.

## Stage 4: notifications, realtime, rate limits, email, hardening

### Realtime (Supabase Realtime, self-hosted in the Docker stack, no paid service)
- **Design: private per-user broadcast channel, ids only.** A trigger on `notifications` calls `realtime.send({notification_id}, 'notification', 'notif:<user_id>', private => true)`. The payload never contains message text, request/patient/requester data or contact details. The browser treats it as a *hint* and re-reads `/api/notifications`, which re-authorizes through RLS.
- **Authorization (default deny).** `realtime.messages` has RLS and exactly one policy, `notif_topic_receive` (SELECT, `authenticated`). It requires BOTH (1) the joined topic equals `'notif:' || auth.uid()` where `auth.uid()` comes from the signature-verified JWT, never from a client-supplied value, AND (2) the **row's own topic equals that same session topic**. There is no insert/update/delete policy, so writes are denied; only the SECURITY DEFINER trigger publishes. The dev stack also revokes write grants (as `supabase_admin`, the grantor) and `anon` SELECT.
- **Why the row check matters.** The first version only compared the session topic with the user id. A session that merely *claimed* its own topic could then read every row at the SQL level. It was not reachable through the public API (PostgREST exposes only `public`), but it violated default-deny. It is fixed and covered by a test that fails against the old policy.
- **Replaced design.** An earlier `postgres_changes` approach was dropped: unauthorized anon subscribers still received empty `401` frames whenever anyone got a notification (an activity-timing side channel). Private channels deny the join outright.
- **Token trade-off.** The session cookie is HttpOnly, but joining the socket needs the user's access token, so `/api/notifications/realtime` returns the caller's own short-lived token (`no-store`, authenticated). A script running in the page could read it; the CSP limits that exposure and RLS bounds what it can do.
- **Client behaviour.** Connect, catch-up refresh on every (re)subscribe, exponential-backoff reconnect (3 s doubling to 60 s), token renewal at 50 min, `online`/`offline` handling, focus/visibility refresh, and a 20 s polling fallback whenever the socket is not live (120 s safety net while live).

### Rate limiting (PostgreSQL, persistent, multi-process safe)
`rate_limits` holds fixed-window counters updated by one atomic `INSERT ... ON CONFLICT DO UPDATE`; concurrent callers cannot both slip under a limit (tested with 40 simultaneous calls). Limits are defined in `rate_limit_rules`, not by clients. Authenticated limits are enforced **inside the database** (triggers on request/offer creation; wrappers around `invite_donors`, `review_request`, `set_contact_consent`, `owner_request_offers` i.e. contact disclosure) so direct API calls cannot bypass them. Unauthenticated flows (login, register, password reset) use `anon_rate_limit` keyed by a SHA-256 hash of the email plus a global ceiling; **client IP headers are not trusted** (spoofable). Login counts only failed attempts. Errors say how long to wait (`PT429` -> HTTP 429). `check_rate_limit('ai.chat')` exists for the future AI endpoint.
Known limits: an attacker can burn a victim's per-email login/reset quota (standard lockout trade-off); without a trusted proxy there is no per-IP limit; counters are fixed windows (a burst can straddle a boundary).

### Email (optional, opt-in, development-only)
In-app is the default. A user may opt in per category (`notification_preferences`). A trigger queues rows in the private `email_outbox`; `scripts/email-worker.mjs` drains it (`FOR UPDATE SKIP LOCKED`, exponential backoff, dead-letter after 5 attempts, opt-out re-checked at send time, only an error *code* stored). Emails are generic: no patient, hospital, request or contact data, only a link to `/notifications`. The worker **refuses any non-local SMTP host** unless `EMAIL_ALLOW_REMOTE=1`; production SMTP is intentionally unconfigured. Delivery is at-least-once.

### Browser hardening
CSP: same-origin everywhere, connections only to this origin and the Supabase API/Realtime, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`/`form-action` self. `script-src` keeps `'unsafe-inline'` (Next injects inline bootstrap scripts; nonces would force fully dynamic rendering); no `unsafe-eval` in production. Also HSTS, COOP, nosniff, frame deny. Every private route is `Cache-Control: no-store`. The service worker (`dc-v2`) caches only an allowlist of static build assets and the offline page; navigations, RSC, API and auth requests are never cached.

## Stage 5: Gemini AI assistant

**Request path.** Browser → `POST /api/ai/chat` (same-origin, JSON, ≤30 KB, session cookie) → `getSession()` (suspended users refused) → PostgreSQL `check_rate_limit('ai.chat')` (20/hour/user, 429) → for real Gemini calls only, the project-wide `ai.global` budget (200/hour, tune in `rate_limit_rules`) → `runAssistant()` → provider (`@google/genai`, key read only in `src/lib/ai/provider.ts`) → NDJSON stream back. Nothing is stored server-side; the conversation lives in that browser's `localStorage`, keyed by user id.

**Safety layers (all outside the model, so a jailbroken model cannot skip them):**
1. *Input classifier* (`safety.ts`): emergencies and personal medical-decision questions (eligibility, diagnosis, treatment, transfusion need/compatibility) are answered with fixed text and **never sent to Gemini**.
2. *Prompt construction* (`prompt.ts`): fixed system rules; browser-supplied history is forgeable, so it is placed in the **user** turn as a labelled untrusted transcript, never as a system/model turn.
3. *Tools* (`tools.ts`): five read-only tools bound to roles (donor: opportunities, offers; requester: own requests; admin: aggregate counts; all: help text, unread counts). They run with the **signed-in user's Supabase client**, so RLS decides visibility; no service key, no SQL from the model. The executor re-checks the role for every call and refuses unknown names. Fields are whitelisted and free text is clamped; patient labels, hospitals, names, phones, emails and notes never enter the model context. Tool output is wrapped as `untrusted_data`.
4. *Output guard*: streaming redaction of emails, phone-like numbers and UUIDs (hold-back window, never cuts inside a possible phone number), and a policy check that replaces answers claiming eligibility/safety or claiming to have approved, invited or shared something.
5. *Rendering* (`rich-text.tsx`): React elements only; the sole supported markup is bold and internal `/dashboard/...` links.

**Errors.** Provider failures map to a small vocabulary (`quota`, `unavailable`, `auth`, `not_configured`); raw SDK messages are never shown. Output is capped (700 tokens, 3 tool rounds, 4 calls per round).

**Model.** `GEMINI_MODEL`, default `gemini-3.6-flash`, chosen after a live ListModels + streaming probe (Stage 5 live check: `gemini-3.8-flash`/`3.7-flash` stalled 160s+ or returned 503 under demand; `2.5-flash` returned 404 for the key). Requests time out after 25s (`GEMINI_TIMEOUT_MS`) with no SDK retries so an overloaded model degrades to the "unavailable" message.

**Mock vs live.** Automated tests use a deterministic mock provider that requires *both* `AI_PROVIDER=mock` and `DC_ALLOW_AI_MOCK=1` (set only by `playwright.config.ts`). It can simulate a compromised model, quota errors and slow streams. `tests/live/gemini.live.spec.ts` is the only live-Gemini test; it needs `GEMINI_API_KEY` and `DC_LIVE=1` (`npm run test:live`) and is skipped otherwise.

**Threat notes.** Residual risks: the classifier is regex-based (misses paraphrases, may over-trigger), so the model is also instructed to refuse and its output is checked; a model could still give wrong *general* information; free-tier quota is shared project-wide by design.

## Roadmap
1. ✅ Foundation, design system, landing, shell, PWA.
2. ✅ Supabase-compatible stack, migrations, RLS, Auth, guarded dashboards.
3. ✅ Request workflow: review queue, state machine, offers, consent, moderation, eligibility recording.
4. ✅ Notification center, private realtime + polling fallback, preferences, rate limits, optional dev email, CSP/SW hardening.
5. ✅ Gemini conversational assistant (server-side, read-only role-bound tools, safety layers).
6. Advanced analytics and reports.
7. Hardening: accessibility audit, Lighthouse PWA, CI, production email/SMTP and auth settings.
