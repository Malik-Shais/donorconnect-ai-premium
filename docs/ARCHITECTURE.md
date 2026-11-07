# Architecture

**Shape:** one FastAPI process serves a static SPA (`/static`, hash routing) and a JSON API (`/api`, Swagger at `/docs`). SQLite file via stdlib `sqlite3` with parameterised SQL only. No ORM, no build step.

## Backend modules
`config` env · `db` schema + connection · `security` scrypt, sessions, role guards, throttle · `schemas` Pydantic validation · `matching` compatibility/eligibility/ranking · `ai` Gemini + offline + safety filter · `routers/{auth,donors,requests,misc}` · `seed` fictional data.

## Database schema
| Table | Purpose / key columns |
|---|---|
| users | id, email (unique, nocase), name, password_hash, role (donor/requester/admin), city, phone, active |
| donors | user_id PK→users, blood_group, available, last_donation |
| requests | requester_id, patient_label (alias only), blood_group, units 1-10, city, hospital, urgency, needed_by, note, status (open/matched/fulfilled/cancelled) |
| request_events | status timeline per request |
| offers | request_id, donor_id (unique pair), origin (invited/volunteered), status (invited/accepted/declined), **share_contact** consent flag |
| notifications | user_id, message, link, is_read |
| sessions | sha256(token) PK, user_id, expires_at |

## Security model
Passwords: scrypt + salt. Sessions: random token, only its hash stored, HttpOnly + SameSite=Strict cookie (CSRF-resistant with JSON-only writes). Role guard on every route; other users' requests return 404. Contact details are returned only for `accepted` offers with `share_contact=1`. Login lockout (8 failures / 10 min), AI rate limit (20/min). CSP, nosniff, frame-deny headers. Frontend never uses `innerHTML`. CSV export neutralises formula injection.

## Matching
Donor→recipient red-cell table; candidates must be active, available and past the 56-day interval. Score = same city (+40) + exact group (+30) or compatible (+20). Matches show abbreviated names only.

## Design system
Burgundy `#7a1630` (brand), coral `#ff6b5b` (action/accent), teal `#0e8f9b` (support), navy `#0f2540` (text/sidebar), off-white `#faf6f1` (canvas). Serif display headings, system-UI body (no font downloads). 16px radius cards, 44px touch targets, visible focus rings, `prefers-reduced-motion` respected, sidebar on desktop / bottom tab bar on mobile.

## Screen inventory
Public: landing, register, login. Donor: dashboard, availability/profile, opportunities, my offers. Requester: dashboard, my requests, new request, request detail (responses, timeline, suggested donors, invite, close). Admin: analytics, users, all requests, reports/CSV. Shared: notifications, AI assistant.

## Roadmap
1. ✅ Foundation: schema, auth, validation, tests. 2. ✅ Matching, requests, offers, consent. 3. ✅ Dashboards, analytics, notifications. 4. ✅ AI assistant. 5. Next: email/SMS delivery of alerts, geo-distance matching, PWA/offline, audit log, PostgreSQL option, i18n.
