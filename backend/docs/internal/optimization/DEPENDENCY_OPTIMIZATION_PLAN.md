# Dependency Optimization Plan

Goal: Consolidate and upgrade dependencies safely across Node and Python modules, reduce duplication, and ensure reproducible builds with tests and CI checks.

Last updated: 2025-09-21

References:
- Inventory: `docs/internal/optimization/DEPENDENCY_INVENTORY.md`
- Baseline script: `docs/internal/performance/quick-baseline.sh`

## Principles

- Prefer one major version across modules for core libs (express, axios).
- Avoid breaking WA module by pinning puppeteer to a known-good version.
- Make Python `pyproject.toml` the source of truth; generate requirements for deployments.
- Use constraints files to pin transitive versions for reproducibility.
- Validate via smoke tests, unit tests, and baseline latency checks.

## Proposed Changes (Phased)

### Phase 1: Low-risk hygiene (1-2 PRs)
- Node:
  - Fix body-parser version in `a0/package.json` from ^2.2.0 to ^1.20.3.
  - Align axios to ^1.12.2 across root and CRM.
  - Add helmet to CRM API (if missing) and ensure basic CORS/security defaults.
- Python:
  - Add constraints pins for fastapi, uvicorn, httpx (e.g., fastapi==0.114.x, uvicorn==0.30.x, httpx==0.27.x) and recommend installing with `-c constraints.txt`.
  - Ensure only `pypdf` is used (no PyPDF2 elsewhere).

### Phase 2: Express alignment (2-3 PRs)
- Target standard Express 4.x for all dev servers initially to reduce coordination risk (or 5.x if all features are compatible). Suggested path:
  - Choose: Express 4.21.x standard initially.
  - Downgrade root/a0/whatsapp-backup from 5.1.0 → 4.21.1 where used for dev servers.
  - Keep a branch to evaluate 5.x migration later with comprehensive tests.

Rationale: CRM and WA module already use 4.x; standardizing reduces divergent middleware behaviors.

### Phase 3: Cleanup and consolidation
- Create a top-level `scripts/deps/` with utilities to:
  - Check for skewed versions among package.json files.
  - Generate Python requirements from `pyproject.toml`.
- Ensure `whatsapp/official` puppeteer remains at 18.x unless tested; document CHROMIUM_EXECUTABLE_PATH requirement.

### Phase 4: Upgrades under test
- Pilot upgrades with CI and smoke:
  - axios 1.12.x → latest 1.x
  - express 4.21.x → 5.x in a branch with route/middleware test coverage.
  - playwright 1.52.x → latest 1.x (only if not breaking other subsystems).

## Testing & Validation

 - Unit tests: (optional) reintroduce frontend tests; currently no `frontend` test suite is configured.
- Smoke: run WA module, API, and Vite; verify /health and orchestrator flows.
- Performance: run `docs/internal/performance/quick-baseline.sh` before/after each phase, store results in `docs/internal/performance/baseline-<date>.md`.
- CI: ensure lint/typecheck/tests pass across modules where configured.

## Rollback Plan

- Each phase is isolated per PR with changelog notes. Rollback by reverting the PR.
- For Express alignment, keep a branch with 5.x configuration to restore if needed.

## Tasks

1) Implement Phase 1 changes (versions, pins, helmet) and open PR
2) Decide Express baseline (recommend 4.21.x) and align versions
3) Add `scripts/deps/` utilities and docs
4) Capture before/after baselines; update docs
