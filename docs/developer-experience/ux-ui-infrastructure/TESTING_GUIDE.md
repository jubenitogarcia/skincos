# Testing guide

`npm run test:components` runs Testing Library. `npm run test:e2e`, `test:e2e:ui`, and `test:e2e:headed` use existing CRM Playwright. `npm run test:a11y` records axe JSON; `npm run test:visual` uses native snapshots; `npm run audit:lighthouse` produces HTML/JSON; `npm run audit:bundle` reuses the CRM bundle analyzer; `npm run audit:ui:full` starts and stops the local environment and executes the pilot chain.

Playwright projects are desktop 1440x900, notebook 1280x720, tablet 1024x768 and mobile 390x844. The three non-desktop projects run only the UX pilot, accessibility and visual suites; existing functional suites retain their desktop coverage. `E2E_BASE_URL` and `LIGHTHOUSE_URL` must be HTTP loopback URLs. Use roles, labels and text locators; do not add position or class selectors. Update a visual baseline only after an intentional, reviewed synthetic-state change.
