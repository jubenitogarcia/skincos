# Final status

| Item | Status | Notes |
| --- | --- | --- |
| npm / WSL toolchain | validated | Node 22.23.1, npm 10.9.8 |
| Playwright, axe, Testing Library, snapshots | validated | WSL-native full run passed across desktop, notebook, tablet and mobile Chromium |
| Lighthouse and LHCI | validated | local CRM HTML/JSON and one LHCI baseline run passed; no scores are gates |
| Storybook and local MCP endpoint | validated | production build and JSON-RPC initialize check passed at local `/mcp` |
| Chrome DevTools / Playwright MCP | configured | official server, WSL Node runtime, isolated profile; registration verified |
| GitHub MCP | configured, OAuth blocked by host | official read-only URL registered; Codex dynamic registration is unsupported by that server; no PAT created |
| Figma MCP | awaiting manual OAuth | official remote endpoint, authorized test file required |
| Cloud integrations | optional / unconnected | no account, trial or approval was used |
| CI | configured | non-blocking, path-filtered, artifact retention seven days |

Changed files are package manifests/locks, CRM test and Storybook configuration, scripts, CI, AGENTS and this directory. The full WSL-native command passed components, pilot, axe, visual and Lighthouse with all local processes stopped. Remaining risks are dev-only dependency advisories (production-only audit reports zero vulnerabilities), unsupported GitHub OAuth dynamic registration in this host, and Figma OAuth still requiring a human authorization. Baselines are informative, never release gates.
