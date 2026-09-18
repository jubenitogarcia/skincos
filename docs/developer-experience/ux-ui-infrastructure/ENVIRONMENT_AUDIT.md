# Environment audit

Observed 2026-07-25: Windows 11 Pro 26200; Codex App 26.721.4979.0; Codex CLI 0.144.4; WSL Ubuntu-24.04 with Node 22.23.1 and npm 10.9.8. Docker is unavailable. The repo is a multi-package npm repository, not a root npm workspace.

Primary UI surfaces are Website (Next 15) and the standalone Ponto Pages package. Existing CI includes focused browser smoke and test coverage. No production endpoint was called.
