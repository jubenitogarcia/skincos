# Current blockers

## Resolved — Insumos unit access P0

Insumos is not an executable blocker. The production closure is recorded on
`main` by PRs #847/#848, using canonical Inventory run `30420719000`, CRM
Pages run `30420793906`, checkpoint artifact `8711811875`, and sanitized
synthetic positive/negative unit-scope smokes. Retain rollback evidence, but
do not reopen this item without a new production symptom.

## Finance — staging release evidence is incomplete

The current Finance staging Worker and independent UI are healthy at
`32bf3ebb…` (runs `30168445270` and `30168445288`), but current `origin/main`
is `6963ba04…`; the API and general CRM Pages staging versions differ as well.
The next technical milestone is therefore a single immutable current-main
candidate through canonical Finance Worker/UI preview and staging, followed by
the synthetic authenticated import/UI journey. Until that happens, no staging
release is eligible for a pilot decision.

Historical staging evidence remains valid only for the capabilities it tested:
rollback `30143185583`, remote kill switch
`30143674681`/`30143742671`, scratch restore and the controlled canary stop.
The `audit returned 503` in canary `30168648150` was restored and is not a
current outage: fresh Worker/gateway probes and the continuous monitor are
healthy. External observability is complete as infrastructure, with a live
Run-key monitor, dashboard, 30-day retention and recorded human-alert drill.

## Finance — offsite PostgreSQL recovery remains blocked

The D1 offsite restore and fresh runtime-config retrieval are valid, but a
fresh provider-vault retrieval and scratch restoration of the large PostgreSQL
object is still unproven. The provider connector exceeded its IPC limit and the
alternate path was unauthorized. An authorized streaming/provider identity is
required; do not relabel manifest-matched local ciphertext as an offsite
restore.

## Finance — production is not provisioned

Read-only Cloudflare queries confirm that production Worker `skincos-finance`
does not exist. Consequently production D1 `skincos-finance`, a Finance control
KV namespace, Finance UI Pages project, Worker secret/version/artifact and
Finance migration are absent. The production API binding targets that missing
Worker and Core API run `30418523054` failed before upload or smoke. GitHub
production lacks the Finance-specific D1/KV variable names and backup/service
secret names required by the canonical workflow; the production release flag
is disabled. Provisioning these isolated resources needs separate explicit
production authorization and precedes any production/pilot activation.

## Pilot decision

`module_enabled` is false and no production actor, grant, flag, secret or data
may change. A named pilot approval is meaningful only after the current-main
single-SHA staging journey and the offsite PostgreSQL recovery gate are both
closed.
