# Release checklist and GitHub distribution

## Before tagging a release candidate
- [ ] `npm run check` (lint, typecheck, unit, secret scan) green; `npm run build` green
- [ ] `npm run test:db`, `npm run test:e2e`, `npm run verify:fresh` green on the local Docker stack (see docs/TESTING.md for the latest recorded run)
- [ ] `npm run audit:prod` has no high/critical findings; docs/DEPENDENCIES.md updated
- [ ] Lighthouse (mobile) >= 90 performance and 100 accessibility on the key pages; axe suite green
- [ ] No real data anywhere; `.env*` not committed; `npm run scan:secrets` clean
- [ ] All migrations are new files (never edit an applied one); `supabase db push --dry-run` reviewed on **staging**
- [ ] docs/DEPLOYMENT.md "Deployment blockers" reviewed with the owner; written approval for billing/domain/go-live **before** production
- [ ] Staging smoke test (docs/DEPLOYMENT.md section 10) recorded below

## Staging smoke-test record
| Date | Environment | Result | Notes |
|---|---|---|---|
| _not yet performed_ | | | no hosted project exists |

## GitHub distribution
1. Repository settings: protect `main` (require pull request, the single status check **`CI gate (all required jobs)`** (it fails unless every CI job succeeded; see docs/CI.md), and one review); enable Dependabot alerts and secret scanning with push protection; enable private vulnerability reporting.
2. Review and merge pull request #1 **only after the owner approves** (it has deliberately been left open). Squash or merge-commit is a team choice; keep the history if you want the stage checkpoints (`checkpoint/premium-stage-2` ... `-6`).
3. Tag from `main`: `git tag -a v2.0.0-rc1 -m "Release candidate 1" && git push origin v2.0.0-rc1`, then **Releases -> Draft a new release** (pre-release), generate notes, attach nothing secret. Release notes must state what is development-tested vs production-verified (currently: nothing is production-verified).
4. Deploy from the tag to **staging** first (docs/DEPLOYMENT.md). Production only after the blockers are closed.
5. Publishing the repository publicly is a separate decision: confirm `legacy/` (the prototype) and the demo credentials in docs are acceptable to publish, and add a licence.
