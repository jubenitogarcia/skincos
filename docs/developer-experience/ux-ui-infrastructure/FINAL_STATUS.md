# Final status

| Item | Status | Notes |
| --- | --- | --- |
| npm / WSL toolchain | validated | Node 22.23.1, npm 10.9.8 |
| Playwright, axe, Testing Library, snapshots | validated | WSL-native full run passed across desktop, notebook, tablet and mobile Chromium |
| Lighthouse and LHCI | validated | 2026-07-29 WSL-native local CRM HTML/JSON and one LHCI baseline run passed; no scores are gates |
| Storybook and local MCP endpoint | validated | static build, JSON-RPC initialize and Inspector `tools/list` passed at local `/mcp` (8 tools) |
| Chrome DevTools / Playwright MCP | not currently exposed | registration is outside the repository; the current Windows CLI list is empty |
| GitHub MCP | manual and unverified | no PAT or OAuth grant; historical dynamic registration stopped as unsupported |
| Figma MCP | awaiting manual OAuth | official remote endpoint, authorized test file required |
| Cloud integrations | optional / unconnected | no account, trial or approval was used |
| CI | configured | non-blocking, path-filtered, artifact retention seven days |

Changed files are package manifests/locks, CRM test and Storybook configuration, scripts, CI, AGENTS and this directory. The 2026-07-29 final WSL-native validation used a disposable ext4 clone, copied no `node_modules`, installed lockfiles sequentially and installed only Playwright Chromium. It passed JSON/config validation, `git diff --check`, `tools:doctor`, CRM typecheck/lint, component tests, `audit:ui:full`, LHCI baseline, Storybook build/MCP/Inspector discovery and `npm audit --omit=dev` (zero production vulnerabilities). A reproducibility rerun then passed the direct LHCI/MCP checks and the complete integrated audit (components, pilot, axe, visual and Lighthouse) from 03:26:33Z to 03:30:43Z. The only LHCI compatibility change pins a temporary Linux Chrome profile; it introduces no score gate. No snapshots were updated and all Vite, Storybook, Lighthouse and Chromium processes started by validation were stopped. Remaining risks are dev-only dependency advisories (production-only audit reports zero vulnerabilities), MCP registrations that are local/outside-repo and not currently exposed by this CLI, and Figma OAuth still requiring a human authorization. Baselines are informative, never release gates.
