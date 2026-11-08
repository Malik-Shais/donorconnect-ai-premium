# Administrator guide

Administrators verify requests, manage accounts and see platform-wide aggregates. Admins are created only by the database owner (docs/DEPLOYMENT.md step 4), never through sign-up.

## Daily work
* **Review queue**: verify each request by the channel you can trust (hospital call/document, known requester) and record how. *Approve* notifies compatible, opted-in donors in the same city (max 50). *Reject* requires a reason shown to the requester. Every decision is audited.
* **Requests**: all requests; you may cancel a request with a reason. **Users**: search, suspend/restore accounts (a suspended account loses all privileges at once; you cannot suspend admins or yourself).
* **Eligibility**: record a decision that an **authorised blood service** communicated (source required, audited). The system never computes medical eligibility.

## Analytics & reports (`/dashboard/admin/reports`)
* Filters: date range (UTC, inclusive, <= 5 years), city, blood group, **data scope** (all / real / fictional). A banner shows how many accounts are fictional demo data.
* Definitions, denominators and missing-data rules: [STAGE6-ANALYTICS.md](STAGE6-ANALYTICS.md).
* **Small groups**: cities with fewer than 5 rows are merged into "Other". On screen you may filter to a small city; **exports refuse** selections with fewer than 5 requests or donors.
* **CSV exports** (30 per hour per user, all logged as `report.export`): Summary, Trend, Supply vs demand, and a **weekly aggregate** of requests (no ids or exact dates; small cells suppressed). Treat files as confidential; do not combine overlapping exports to narrow down individuals.
* Supply vs demand is **preliminary**: available compatible *donors* against *units* needed. It is not blood stock.

## Fictional vs real data
Accounts are flagged `is_demo` explicitly: by the reserved `.example` sign-up domain, by the seed script, or by an admin via `set_account_demo(user, flag, reason)` (audited). Users cannot change the flag. In production, demo-domain sign-ups and demo marking are refused; use scope **Real accounts only** for production metrics.

## Operations
* Audit trail: `public.audit_logs` (review, moderation, eligibility, consent, contact disclosure, report exports, demo flag). Admin-readable only.
* Health: `GET /api/health`. Rate limits: `public.rate_limit_rules` (change with SQL; takes effect immediately).
* Incident basics: suspend the account, review `audit_logs`, rotate `RATE_LIMIT_SECRET` (new hash in `app_settings`, new Vercel value), rotate the Gemini key. Backups per docs/DEPLOYMENT.md.
