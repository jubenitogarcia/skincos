# Environment audit

Observed 2026-07-25: Windows 11 Pro 26200; Codex App 26.721.4979.0; Codex CLI 0.144.4; WSL Ubuntu-24.04 with Node 22.23.1 and npm 10.9.8. Docker is unavailable. The repo is a multi-package npm repository, not a root npm workspace.

Primary UI surfaces are CRM Console (React 18, Vite 8, Vitest 4, existing Playwright) and Website (Next 15). Existing CI includes Central E2E Smoke and test coverage. The CRM has many reusable primitives, so Storybook is appropriate. No production endpoint was called.
