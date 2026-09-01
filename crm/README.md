# CRM Module

Current layout:

- `console/`: canonical CRM frontend path
- `api/`: canonical CRM backend path
- `docs/` and `ops/`: reserved for module-local guidance

The CRM domain groups its console and API surfaces under `crm/`.

## Dedicated CRM Core repository: pre-cut only

`jubenitogarcia/skincos-crm-core` is the clean, independent source-only
repository for the future CRM Core. It is not a replacement runtime yet:
`crm/console`, `crm/api`, their data stores, the existing Pages/API deployment
workflows, and all incumbent configuration remain owned by this monorepo.

Read [`docs/operations/crm-repository-transition-precut.md`](../docs/operations/crm-repository-transition-precut.md)
before moving code, tests, data, bindings, secrets, routes, or deploy ownership.
