# Current blockers

## P0 — Workforce Timekeeping production release is fail-closed

PR #886 is integrated at
`10b2197731d0210cf8fc8cd961f7a787d73bf650`, but no immutable release has
completed the current preview/staging/pilot/canary/production chain. The
production Core deploy flag was restored to
`ENABLE_CORE_WORKERS_DEPLOY=false` at `2026-07-29T22:17:37Z`; staging remains
enabled for a later governed operation. Production Ponto itself is explicitly
in `maintenance` through canonical run `30496220685`.

The executable blockers, in required order, are:

1. integrate and validate version affinity between Core API and Timekeeping,
   gradual Worker routing, a network-context pilot cohort, minimal grants,
   automatic interruption and external SLO evidence; make the Core gate
   fail-closed when unset, label Timekeeping checkpoints with the promoted
   release SHA, and add executable pilot/canary predecessors plus a
   Ponto-specific Pages gate;
2. provision `PONTO_PROFILE_DATA_KEY` in staging only from an approved secret
   source/process, and move the other staging Ponto runtime secrets out of
   shared repository scope; provision an independent production set only
   after complete staging evidence and separate pre-production authorization;
3. choose one immutable SHA reachable from `main` after those controls are
   integrated, then prove the same SHA in Timekeeping, Core API and CRM Pages
   preview/staging; first repair staging Pages, which currently routes its
   canonical default to the production API and has no actor key;
4. add a Ponto gateway-only Core API promotion path that does not require the
   nonexistent `skincos-finance` Worker or mutate/provision Finance; the
   current production binding already caused Cloudflare `10143`;
5. exercise `module-control:timekeeping` through maintenance, active and
   rollback in staging and complete the synthetic authenticated journey with
   audit-preserving teardown;
6. reconcile or designate an eligible pilot through Identity/Workforce. The
   aggregate inventory currently has no active production CONSULTOR with an
   active Workforce counterpart, and staging has one Core CONSULTOR without
   that counterpart;
7. complete separately evidenced pilot and canary predecessors before any
   production deployment, migration, grant or activation.

`PONTO_PROFILE_DATA_KEY` is absent by name from accessible GitHub
staging/production metadata and both incumbent Timekeeping Workers.
`module-control:timekeeping` is absent in staging and explicitly
`maintenance` in production. Production `/api/ponto/me` returns
`503/MODULE_MAINTENANCE`, while readiness incorrectly remains 200 and is a
release-control defect. Incumbent health/version responses do not attest a
candidate release.
No production Ponto dispatch, migration, D1/KV write, pilot or canary is
authorized by the current evidence.

## Resolved — Insumos unit access P0

Insumos is not an executable blocker. The production closure is recorded on
`main` by PRs #847/#848, using canonical Inventory run `30420719000`, CRM
Pages run `30420793906`, checkpoint artifact `8711811875`, and sanitized
synthetic positive/negative unit-scope smokes. Retain rollback evidence, but
do not reopen this item without a new production symptom.

## Finance — current-main staging gate closed; recovery gate remains

The immutable candidate, Finance Worker, independent Finance UI and CRM Pages
all used `c277032db96ba96484522a19994a66cbb323a46d`: candidate `30500613099`,
preview runs `30500694945`/`30500696857`/`30500698417` and staging runs
`30500732310`/`30500734160`/`30500735957`. Synthetic canary `30500922386`
passed the authenticated import, idempotent replay/conflict, audit,
compensation and isolated-shell journeys. Its Finance p95 was 426 ms (limit
1000 ms), with zero errors, authentication failures, journey failures,
divergences, audit failures and dependency failures. It restored the
non-enabled staging baseline and its temporary synthetic grant.

The prior transient `domain_service_degraded`/503 during import analysis is
superseded for this candidate: retry is bounded to transient 5xx on the
idempotent analyze operation, and the full journey now passed. The historical
`audit returned 503` remains an audit finding, not a current blocker.
Historical rollback `30143185583`, remote kill switch
`30143674681`/`30143742671`, scratch restore and the controlled abort remain
valid for their tested capabilities. External observability remains complete as
infrastructure, with its live Run-key monitor, dashboard, 30-day retention and
recorded human-alert drill.

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
