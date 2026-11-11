# Stage 6: analytics and reporting

Read-only reporting over the real PostgreSQL tables. No dashboard figure is hard-coded; every number comes from a SQL function in
`supabase/migrations/20261112000001_stage6_analytics.sql` and is verified against controlled datasets (`tests/db/analytics.test.ts`).

## Data-model audit (what existed, what was added)

| Need | Finding | Resolution |
|---|---|---|
| Request lifecycle times | `request_events` holds one row per status change; `reviewed_at` exists | Private view `analytics_request_facts` takes the **first** event per status (`approved_at`, `matched_at`, `fulfilled_at`, `rejected_at`, `cancelled_at`) |
| Offer response / withdrawal times | `offers` only had `created_at`; later changes were only in `audit_logs` | New columns `accepted_at` (first acceptance, never cleared), `responded_at`, `withdrawn_at`, maintained by trigger `t_offer_times`, backfilled from the audit log |
| Real vs fictional data | No marker | `profiles.is_demo`, set at sign-up for emails on the reserved `.example` TLD (RFC 2606: `demo.example`, `test.example`) |
| Actual donations | **Not recorded anywhere** | "Completed" is defined as an accepted offer on a request that reached `fulfilled`. The app does not know a donation took place |
| Blood stock | **Not recorded** | Supply is counted in *donors*, never units; labelled preliminary |
| Notification kinds | `notifications.category`, `email_outbox.status`, `contact_consents` | Used directly |

Indexes added: `blood_requests(created_at)`, `blood_requests(lower(city))`, `request_events(request_id,status,created_at)`,
`offers(request_id,accepted_at)`, `offers(donor_id,created_at)`, `profiles(role) where not suspended`, `notifications(created_at)`.

## Conventions

* **Dates**: UTC calendar days, `from` and `to` both inclusive, at most 5 years. Default range = last 90 days.
* **Cohort**: request metrics cover requests **created** in range (after city / blood-group / data-scope filters). Trend series are the exception: each series is counted on its own event date.
* **Snapshots** (not date-bound, but filtered by city / group / scope): donor totals, availability, open demand, supply.
* **Buckets**: day (≤ 31 days), week (≤ 180), month (longer).
* **Rates** always return `{num, den, rate}`; `rate` is `null` (shown as "—") when `den = 0`. Never 0 and never an error.
* **Durations** are in hours; only rows holding **both** timestamps count; `n` is returned with every median / 90th percentile.
* **Data scope** (admin only): `all`, `real` (non-`.example` accounts), `demo`. A banner shows how many accounts are fictional.

## Metric definitions

| Metric | Numerator | Denominator |
|---|---|---|
| Approval rate | requests ever approved | requests reviewed (`reviewed_at` set; cancelled-before-review excluded) |
| Rejection rate | requests rejected | requests reviewed |
| Matching rate | requests ever matched | requests ever approved |
| Fulfillment rate | requests fulfilled | requests ever approved |
| Cancellation rate | requests currently cancelled | all requests in cohort |
| Time to review | `reviewed_at − created_at` | requests with both |
| Time to first donor response | first `accepted_at` − first `approved` event | approved requests with an acceptance (others counted as `approved_without_response`) |
| Approval to fulfilled | first `fulfilled` − first `approved` event | fulfilled requests |
| Registered / active donors | donors / donors not suspended | – |
| Available donors | not suspended, `available`, eligibility ≠ `deferred` (same rule as invitation matching) | – |
| Responded in 90 days | donors with an offer response in the last 90 days | – |
| **Supply vs demand (preliminary)** | demand = units on `approved`/`matched` requests; supply = available, compatible donors (`blood_compat`) | `donors_per_unit` = supply ÷ demand units, `null` when demand is 0 |
| Notifications read | read notifications | notifications created in range |
| Email delivery | `sent` | `sent` + `failed` (pending / skipped excluded) |
| Invitation response | invitations answered | invitations sent for cohort requests |
| Invitation acceptance | invitations accepted | invitations answered |
| Contact consent granted | active grants (granted, not revoked) | accepted offers with a consent row |

Donor: invitations answered, acceptance (accepted ÷ answered), completion (completed ÷ accepted ever), withdrawal (withdrawn ÷ accepted ever), reply time.
Requester: approved ÷ reviewed, with-donor ÷ approved, fulfilled ÷ approved, three timelines.

### Known limits
* A withdrawn offer keeps its `accepted_at`, so a request whose donor later withdrew still counts as "has had a response".
* Invitations are same-city only (migration `…1114000001`); invitations created before that migration may include other cities.
* City is free text; it is grouped case-insensitively, not spell-corrected.
* Supply compares people with units; it says nothing about stock, medical suitability, or whether a donor can actually reach the hospital.

## Security model

* Reports are **`SECURITY DEFINER` functions that check the caller's role** (`is_admin()` / `current_app_role()`, which already excludes suspended accounts) and scope rows to `auth.uid()`. The fact view is granted to nobody; anonymous callers get `permission denied`.
* **Donors** see only their own offers. **Requesters** see only their own requests; accepted offers are counted, donors are never identified. **Administrators** see platform aggregates.
* **Minimum group size**: admin city breakdowns merge any city with fewer than 5 rows (and everything beyond the top 12) into "Other (small groups)"; the name is not sent to the browser. The same rule is used in CSV.
* **Exports** (`GET /api/reports/<kind>`): authenticate → role check per kind → zod-validated filters → compute → `log_report_event` (whitelisted params, 30 exports / hour / user, audit row `report.export`) → only then send data. A failed audit or rate limit sends nothing. Responses are `no-store`, `nosniff`, `attachment`.
* **CSV formula injection**: any text cell starting with `= + - @ TAB CR LF` is prefixed with `'`; RFC 4180 quoting; real numbers untouched.
* **Excluded from every report and export**: names, phone, email, hospital, patient label, notes, user ids, donor identities. Row exports contain request id, date, blood group, city, urgency, units, status, durations, counts.
* Reports never modify business data. Viewing a dashboard is not logged; **exports are**.

## Using it

| Role | Page | Exports |
|---|---|---|
| Admin | `/dashboard/admin/reports` | summary, trend, supply-demand, request rows |
| Donor | `/dashboard/donor/analytics` | own offers |
| Requester | `/dashboard/requester/analytics` | own requests |

Filters are a plain GET form (URL is shareable, works without JavaScript). Every chart has a text name and a "View as data table" disclosure.
History tables are paginated 25 per page in SQL (`limit/offset` with `count(*) over ()`); exports are capped at 10 000 rows (`X-Report-Truncated: true` when cut).

## Tests

* `tests/db/analytics.test.ts`: controlled dataset (5 requests, 5 donors, hand-calculated rates, medians, p90, trend, supply/demand), scope, small-group suppression, empty data, validation, role isolation, anonymous denial, suspended admin, column whitelist, pagination, audit, rate limit.
* `src/lib/csv.test.ts`, `src/lib/analytics-shared.test.ts`: injection and filter parsing.
* `tests/e2e/analytics.spec.ts`: figures vs database, filters, chart + table accessibility, CSV content and de-identification, audit rows, HTTP authorization matrix, empty and zero-denominator states, pagination.
* `tests/e2e/responsive.spec.ts` now includes the three analytics screens at 360 / 390 / 768 / 1280 px.

## Not covered
Screen-reader and Lighthouse audits; the error banner path (needs an induced RPC failure); load testing beyond the ~10²–10³-row development data; production data; scheduled / emailed reports.
