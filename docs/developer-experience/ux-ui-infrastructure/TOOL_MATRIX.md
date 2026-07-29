# Tool matrix

| Resource | State | Decision |
| --- | --- | --- |
| npm / Node / WSL | installed | supported execution path |
| Playwright Test | configured | Chromium, four viewports, traces/screenshots/video on failure |
| axe | configured | automatic results JSON; manual review remains separate |
| eslint-plugin-jsx-a11y | incompatible | crashes against the CRM's secure `minimatch` override; do not weaken that override |
| Testing Library | configured | React/user-event smoke in jsdom |
| Lighthouse | installed in Website | local CRM route reports HTML/JSON |
| Lighthouse CI | installed | baseline-only config; no budgets or blocking assertions |
| Storybook / a11y / MCP addon | validated | build and local JSON-RPC endpoint passed; no Storybook test runner is enabled |
| Native Playwright snapshots | configured | synthetic auth baseline convention |
| MSW | optional | existing route interception is sufficient today |
| Chromatic / Percy | depends on license | neither installed; avoid duplicate cloud visual services |
| Sentry / PostHog / Clarity / BrowserStack / Sonar | depends on account/license | no authorization or data-sharing approval found |
| Docker | incompatible locally | not needed for this local pilot |
| Figma MCP | awaiting manual OAuth | official remote endpoint only |
