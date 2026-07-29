# Pilot results

Target flow: local CRM root with synthetic local-auth data -> `Insumos` shell -> keyboard focus from `Atendimento` to `Caixa`. The pilot does not submit a form or mutate data. It records axe JSON, Lighthouse HTML/JSON, failure-only traces/screenshots/video and native visual snapshots across four Chromium viewports.

On 2026-07-25, `npm run audit:ui:full` passed in the WSL-native verification checkout: 1 component test, 4 pilot cases, 4 axe cases, 4 visual cases and Lighthouse. The generated reports remain in ignored `artifacts/`; no production endpoint, account, customer data or write path was used. DrvFS dependencies remain unsuitable as primary execution evidence, so repeat the command from a native WSL checkout.
