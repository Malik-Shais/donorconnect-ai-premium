# DonorConnect AI Premium V2

Blood donor coordination platform. **Next.js (App Router) · React · TypeScript · Tailwind CSS 4 · shadcn/ui-style components · Motion · Recharts · Supabase (planned) · Vitest · Playwright · PWA.**

> Matching is preliminary. This app never diagnoses, never makes transfusion decisions and never decides donor eligibility. Blood services and clinicians do; no donation interval is hard-coded.

## Status: stage 1 (foundation)
Done: design system (burgundy, coral, teal, navy, off-white tokens), premium landing page with interactive compatibility guide, dashboard shell (desktop sidebar, mobile bottom tabs) for donor/requester/admin with **fictional** data and Recharts, validated login/register forms, installable PWA (manifest, icons, offline fallback), unit + e2e tests.
Next: Supabase Auth + migrations + RLS, requests/offers/consent, realtime notifications, Gemini agent route, rate limiting. See `docs/V2-ARCHITECTURE.md`.

## Run
```bash
npm install
npm run dev            # http://localhost:3000
npm run build && npm start -- -p 3100   # production preview
```
Preview dashboards: `/dashboard/donor`, `/dashboard/requester`, `/dashboard/admin`.

## Test
```bash
npm test               # Vitest
npm run lint && npm run typecheck
npm run test:e2e       # Playwright (desktop + mobile); uses the pre-installed Chromium via CHROMIUM_PATH
```

## Previous prototype
The FastAPI/SQLite version is preserved, unchanged, in `legacy/` (and on `main`, commit `8931be1`). It is frozen and no longer developed.
