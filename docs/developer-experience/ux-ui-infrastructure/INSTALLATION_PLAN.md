# Installation plan

Installed from official npm registries after checking official documentation: `@axe-core/playwright`, Testing Library, Storybook React/Vite with a11y/MCP addons, `@lhci/cli`, and MCP Inspector. `eslint-plugin-jsx-a11y` was evaluated but rejected because it crashes against the CRM's secure `minimatch` override; that override was not weakened. Versions are locked in the root or CRM lockfile.

Do not run `npm audit fix --force`. `npm audit --omit=dev` reports zero vulnerabilities; the complete development graph still reports advisories, including a transitive Storybook MCP/Vitest Browser chain. `@sentry/node` appears only transitively through `@lhci/cli` → Lighthouse; no Sentry package was added directly and no Sentry DSN, initialization or telemetry configuration exists. It is local-only and must be reviewed before a security-gated rollout. No runtime product dependency changed.
