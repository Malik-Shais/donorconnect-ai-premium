# Premium V2 architecture

## Stack decisions
Next.js App Router with Server Components by default; client components only for interaction (motion, charts, forms). Tailwind 4 tokens live in `src/app/globals.css`; UI primitives in `src/components/ui` follow shadcn/ui conventions (`components.json` is set so `npx shadcn add` works). Supabase provides Postgres, Auth, Realtime and RLS. Gemini is called only from server Route Handlers.

## Planned data model (Supabase, migrations in `supabase/migrations`)
`profiles` (id = auth.users.id, role, name, city, phone), `donor_profiles` (blood_group, available, self-reported last_donation, **eligibility status set by the donor/blood service, no built-in interval**), `blood_requests`, `request_events`, `offers` (with `share_contact` consent), `notifications`, `audit_log`.

## RLS principles
Every table has RLS on. Requesters read only their requests; donors read open compatible requests via a security-definer view that hides requester identity; phone/email exposed only through a function that checks `offers.status='accepted' AND share_contact`. Admin role from a JWT claim set server-side, never client-writable. The service-role key is server-only.

## Security / quality
Zod validation on every Route Handler and Server Action; rate limiting on auth and AI routes (free-tier store or Postgres-backed counter); CSP headers; Playwright journeys per role; Vitest for domain logic.

## Roadmap
1. ✅ Foundation, design system, landing, shell, PWA, tests.
2. Supabase project (local via CLI), migrations, RLS policies + policy tests, Auth (register/login/session via `proxy.ts`).
3. Requests, matching, offers, consent flow.
4. Realtime notification centre.
5. Gemini conversational agent (server-side, safety filter, rate limit).
6. Real analytics (SQL views → Recharts), admin reports/CSV.
7. Hardening: accessibility audit, Lighthouse PWA, CI.
