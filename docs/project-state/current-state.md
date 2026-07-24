# Current state

## Active operational incident — P0

`P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos` is
the only executable orchestrator item. Finance pilot/staging progression,
GitHub Organization transfer, Ponto, Atendimento and every unrelated module
milestone are frozen until this incident is resolved.

PR #763 (`fix(insumos): corrige RBAC por unidade`) is draft and behind current
main `3f3e9453`. Its current head is `6fbe4b3`; all listed required checks pass
except Central E2E Smoke (run `30121896932`). That run has three failing Insumos
scenarios: circuit-breaker pause, edit-modal policy, and no-unit RBAC request
suppression. The failure is not an authorization to deploy, change data or
promote any environment.

Production, staging mutations, D1/PostgreSQL writes, flags, grants and deploys
are prohibited for this incident phase. The permitted next work is scoped PR
rebase/fix/test/CI remediation and read-only verification only.
