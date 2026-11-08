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

## Roadmap
1. ✅ Foundation, design system, landing, shell, PWA.
2. ✅ Supabase-compatible stack, migrations, RLS, Auth, guarded dashboards.
3. ✅ Request workflow: review queue, state machine, offers, consent, moderation, eligibility recording, notifications.
4. Realtime notifications, rate limiting, email delivery.
5. Gemini conversational agent (server-side).
6. Advanced analytics and reports.
7. Hardening: accessibility audit, Lighthouse PWA, CI.
