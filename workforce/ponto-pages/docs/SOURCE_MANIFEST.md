# Ponto Pages source manifest

This package was carved from monorepo commit
`dfef3dec91ffa251ddb3a5939a172e2ce8ea6891` on 2026-09-09. It is a source
snapshot, not a live deployment claim and not an automatic synchronization
mechanism.

| Package area | Origin at the extraction base | Treatment |
| --- | --- | --- |
| `src/PontoModule.tsx`, Ponto API/types/presentation, UI primitives | `crm/console/**` | Copied, converted to local relative imports, with minimal local type annotations for standalone checking. |
| `public/ponto-terminal.html`, brand asset | `crm/console/public/**` | Copied without changing the terminal's relative `/api/ponto/device/*` contract. |
| `functions/api/ponto/[[path]].ts` | `crm/console/functions/api/ponto/[[path]].ts` | Copied as the existing strict gateway; its runtime bindings remain absent in Phase 1. |
| CSRF and proxy helpers | `crm/console/functions/_lib/**` | Small local copies needed by the Ponto-only Functions. |
| Auth provider and auth Function | CRM auth contract | Minimal local boundary preserving the existing `/api/auth/*` session path and shared-domain cookie behavior. |

The auth helper intentionally preserves `ADMIN`; Ponto reserves canonical
employee-management and diagnostics paths to `ADMIN`/`SUPERVISOR`. Any future
sync must compare this manifest and rerun package tests rather than overwrite
the isolated copy blindly.
