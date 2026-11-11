# Gemini assistant: live verification on the private staging site

Deployment: https://donorconnect-premium-staging.vercel.app (commit 4734946, functions in bom1, Vercel Authentication ON). Model: `gemini-3.5-flash-lite`, free-tier Google AI Studio key stored in Vercel as a sensitive (write-only) environment variable. Fictional data only.
Evidence: `live-ai-evidence.json` (answers, tool names, timings), screenshots in `live-ai-shots/`. Browser access used a temporary Vercel bypass secret, revoked and verified after each round.

## Model selection (real API calls, free-tier key)
`models.list` returned the Gemini 2.5 / 3.x families. `generateContent` test: gemini-3.5-flash-lite 200 in 0.6 s; gemini-3.1-flash-lite 200 in 0.6 s; gemini-3.5-flash 200 in 7.1 s; gemini-2.5-flash-lite 404. Selected gemini-3.5-flash-lite (also the configured default).

## Results (round 2, deployed commit 4734946)
| # | Check | Result | Evidence |
|---|---|---|---|
| A0 | `/api/ai/chat` reports configured Gemini; anonymous requests redirect to Vercel login | PASS | `{configured:true, provider:"gemini"}` |
| A1 | Donor UI: real Gemini how-to answer | PASS | screenshot a1; consent answer from reviewed help |
| A2 | Streaming + function calling (donor) | PASS | tool `get_my_opportunities`; first event 1.25 s, first text 2.22 s, done 2.38 s, 5 text events |
| A3 | Donor offers (the question that the safety filter wrongly blocked before the fix) | PASS | tool `get_my_offers` |
| A3b | Same question rephrased | PASS | tool `get_my_offers` |
| A4 | Requester UI + own requests | PASS | tool `get_my_requests`; screenshot a4 |
| A5 | Admin UI: operational numbers | PASS | tool `get_operational_stats`; 42 pending of 399, oldest wait 1,799 h; screenshot a5 |
| A6 | Donor and requester cannot obtain admin data or contacts | PASS (see note) | no admin tool called; donor answer refused; no leak |
| A7 | Emergency and personal-medical questions never reach the model; prompt injection leaks nothing | PASS | source `safety` for both |
| A8 | Unauthenticated 401, wrong content type 415, empty 400, too long 400 | PASS | |
| A9 | Per-user limit: 20 accepted, 21st returns 429 "too often, try again in 21 minutes"; UI shows the message | PASS | screenshot a9 |

Round 1 (commit af3d004) passed the same checks except A3, which exposed a real bug: the safety classifier treated "What offers do I have ...?" as a medical question. Fixed in 4734946 (needs an article, ignores app nouns; real medical phrasings still blocked; tests both ways). Round 1 also ran the full live regression suite (workflow, same-city matching, consent, analytics, role isolation): 10 passed, 1 skipped.

## Changes made for the assistant
- Requester tool `get_my_matching_status` (counts of invited/accepted/declined/withdrawn for own requests) backed by SQL `requester_match_summary()` (migration 20261115000001, applied to hosted staging; anonymous callers refused).
- Admin stats include the oldest pending review age; help text and suggestions describe strict same-city matching.
- Privacy unchanged: tools run as the signed-in user (RLS), return whitelisted fields only, outputs are redacted for emails/phones/ids, medical questions are answered by a deterministic boundary before any model call.

## Limits and not tested
- A6 requester case: the recorded response contained no answer text and no tool call (the stream ended without a `done` event), so it shows no leak but is weaker evidence than the donor case. Role-scoped tool lists are also asserted by unit tests (a requester is never offered the stats tool). Not re-run live.
- Real Gemini quota exhaustion cannot be forced safely; the 429-to-"usage limit" mapping, 503 and bad-key paths are covered by unit tests only.
- Free-tier limits apply (the app additionally caps 20 questions/hour per user and 200/hour project-wide). Gemini quotas and model availability can change.
- The full browser regression suite was not repeated after the regex fix (a regex-only change); it passed on af3d004.
- The staging data contains older seeded offers in other cities (visible in a donor's offers list); they predate strict same-city matching.
