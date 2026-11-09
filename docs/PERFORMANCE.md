# Button response times: before and after (staging, 2026-11-09)

Measured on the live protected staging site, click to visible confirmation (requestAnimationFrame polling), 5 cycles per round with fresh fictional accounts
(one requester, one donor, the demo admin). Seconds, P50 / P95. With n = 5 the P95 is effectively the maximum.

| Button | A. Before: functions in iad1 (commit 376a735) | B. Region change only: functions in bom1 (commit 1554e9c) | C. Optimized, bom1 (commit 5c2f834) | Improvement A to C (P50) |
|---|---|---|---|---|
| Submit request | 2.90 / 3.95 | 1.32 / 1.66 | **0.83 / 0.93** | 71% |
| Approve | 2.15 / 2.90 | 1.22 / 1.37 | **0.87 / 0.89** | 60% |
| Invite donors | 2.35 / 3.51 | 1.13 / 1.22 | **0.77 / 0.79** | 67% |
| Accept | 2.08 / 2.60 | 1.22 / 1.28 | **0.73 / 0.77** | 65% |
| Grant consent | 2.15 / 2.64 | 0.98 / 1.27 | **0.67 / 0.71** | 69% |
| Revoke consent | 2.30 / 2.96 | 0.98 / 1.05 | **0.70 / 0.73** | 70% |
| Save profile | 2.85 / 3.19 | 1.05 / 1.59 | **0.70 / 0.74** | 75% |
| Mark fulfilled | 2.32 / 3.56 | 1.02 / 1.24 | **0.74 / 0.78** | 68% |

Full page loads (P50, seconds, 3 loads each):

| Page | A | B | C |
|---|---|---|---|
| admin review queue | 1.53 | 1.08 | **0.78** |
| requester request detail | 1.35 | 1.06 | **0.73** |
| donor offers | 1.10 | 0.92 | **0.71** |
| donor profile | 1.07 | 0.95 | **0.64** |
| admin dashboard | 1.16 | 0.92 | **0.69** |
| donor dashboard | 1.22 | 0.90 | **0.66** |
| requester dashboard | 1.08 | 0.85 | **0.70** |

Deployed region: A `iad1`, B and C `bom1` (Vercel deployment metadata `regions: ["bom1"]`; response header `x-vercel-id` shows the function region). Database: Supabase Mumbai (ap-south-1).

## What changed between B and C
- `getSession()` and `proxy.ts` verify the access token locally with `getClaims()` (measured 1 ms) instead of an auth-server round trip on every request. Role and suspension are still read from Postgres on every request, and RLS is unchanged.
- Dashboard links no longer prefetch. Before, one click was followed by 8 to 12 extra server renders (every visible link re-prefetched after the cache refresh).
- The layout's unread count runs in parallel with the role check; the profile save validates first and writes both rows concurrently.
- `revalidatePath("/dashboard", "layout")` is kept on purpose: it keeps every page synchronized, and its cost was the prefetches, which are gone.

## Server-side timings (Vercel runtime logs, PERF_LOG=1, 68 requests on deployment C)
`auth.claims` P50 1 ms, P95 3 ms; `auth.profile` (one Supabase query from bom1) P50 23 ms, P95 42 ms. Key SQL functions run in 1 to 2 ms warm on hosted data (the first call in a new database session costs about 200 ms once), so no index was added.

## Limitations
- The test machine is in the US, so each request travels to the nearest Vercel edge (about 0.27 s round trip, measured) and then to Mumbai. Absolute numbers include that distance; a user near Mumbai should see lower times. The A to B to C differences are comparable because the client was the same.
- Cold starts were not isolated; a function idle for several minutes can add a second or more to the first request on the Hobby plan.
- Supabase Free is a shared small instance and pauses after about a week of inactivity.
- n = 5 per action per round: treat P95 as indicative only.
- Realtime notification delivery was not changed.
