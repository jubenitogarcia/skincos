# Pilot results

Target flow: local CRM root with synthetic local-auth data -> `Insumos` shell -> keyboard focus from `Atendimento` to `Caixa`. The pilot does not submit a form or mutate data. It records axe JSON, Lighthouse HTML/JSON, failure-only traces/screenshots/video and native visual snapshots across four Chromium viewports.

On 2026-07-25, `npm run audit:ui:full` passed in the WSL-native verification checkout: 1 component test, 4 pilot cases, 4 axe cases, 4 visual cases and Lighthouse. The generated reports remain in ignored `artifacts/`; no production endpoint, account, customer data or write path was used. DrvFS dependencies remain unsuitable as primary execution evidence, so repeat the command from a native WSL checkout.

On 2026-07-29, the final run repeated the canonical full audit in a disposable
ext4 WSL clone using clean, sequential lockfile installs and Playwright
Chromium only. It again passed the component test, the four pilot viewports,
the four axe JSON reports, the four baseline comparisons and Lighthouse
HTML/JSON. No snapshot update command was used; the visual comparison passed
against the four versioned local-synthetic baselines. All reports were kept in
ignored `artifacts/`, and the validation-owned Vite/Lighthouse/Chromium
processes were stopped afterwards.

The reproducibility rerun completed on 2026-07-29 from 03:26:33Z to
03:30:43Z with the same result: components, pilot, axe, visual and Lighthouse
all passed. This followed direct successful LHCI baseline and Storybook MCP
Inspector checks. No visual tolerance or snapshot was changed for this rerun.
