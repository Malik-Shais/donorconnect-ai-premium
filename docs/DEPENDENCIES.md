# Dependency and security review

Policy: patch/minor updates may be grouped (Dependabot, weekly); **major upgrades are never automatic** and are tested by hand. CI runs `npm audit --omit=dev --audit-level=high` (fails on high/critical production vulnerabilities) and GitHub's dependency-review on pull requests **where the repository supports it** (needs the dependency graph + GitHub Advanced Security on private repos; on this repository it is currently unavailable, so the workflow reports "NOT RUN" with a warning while the production audit stays enforced; see docs/CI.md).

## Result at Stage 7 (npm audit, advisory data at the time of the run)
* **Production dependencies: 0 known vulnerabilities.**
* **Development tooling: 8 moderate** (all one chain: `minimatch` ReDoS via `@typescript-eslint/*` pulled in by `eslint-config-next`). It affects only linting on developer/CI machines, never the running app. The only offered fix is `eslint-config-next@15.5.29`, a **major downgrade**, so it was **not applied**. Revisit when `eslint-config-next` publishes a release that updates `typescript-eslint`.
* Outdated but deliberately not changed: `typescript` 5.9 -> 7 (major), `eslint` 9 -> 10 (major), `@types/node` 22 -> 26 (major, Node 22 is the runtime), `react`/`react-dom` 19.3.0 -> 19.3.1 (patch; apply with the next verified release).
* Secrets in the repository: `npm run scan:secrets` over all tracked files is clean; `.env*` is git-ignored except the two `*.example` templates.

## How to review an update
`npm outdated` -> read the changelog -> update one group -> `npm run check` -> `npm run test:db` and `npm run test:e2e` on the local stack -> `npm run verify:fresh` for anything touching Supabase/Postgres -> merge.
