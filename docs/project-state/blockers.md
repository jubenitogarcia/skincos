# Current blockers

## P0 — Workforce Timekeeping production release is fail-closed

PR #894 and the private Ponto Core/Pages staging prerequisites are integrated,
and the changeset carrying this entry implements the missing progressive
release controls. No immutable candidate has completed the current
preview/staging/pilot/canary/production chain. Production remains explicitly
`module-control:timekeeping=maintenance` through canonical run `30496220685`
and `ENABLE_CORE_WORKERS_DEPLOY=false`.

The executable blockers, in required order, are:

1. An authorized Cloudflare owner must create/enable the exact zone-scoped WAF
   block rules and register `CLOUDFLARE_ZONE_ID`, `PONTO_WAF_RULESET_ID`,
   `PONTO_WAF_HEADER_RULE_ID` and `PONTO_WAF_CONTRACT_RULE_ID`. The gate
   requires external 403 probes for both public version-selection headers and
   `/insumos/health/workforce-contract`; no Worker-side bypass is accepted.
2. An authorized secret custodian must provision a distinct, separately
   custodied `PONTO_PROFILE_DATA_KEY` in the GitHub `staging` environment from
   an approved source, plus environment variables
   `PONTO_PROFILE_DATA_KEY_CUSTODY_REF` and
   `PONTO_IDEMPOTENCY_KEY_CUSTODY_REF` containing distinct opaque approved-vault
   references. A security custodian must provision
   `PONTO_ROOT_ATTESTATION_KEY_SHARED` only as a repository secret and
   `PONTO_ROOT_ATTESTATION_KEY_ID` only as a repository variable. Do not
   generate in CI, print, copy application roots across environments or
   version a secret value.
3. With (1) and (2) present, execute `preview` and then `staging` using exactly
   the coordinator `GITHUB_SHA` on the current `main`. The staging predecessor
   must include all four surfaces, checkpoints, additive migrations,
   maintenance/active transitions, authenticated CONSULTOR navigation and
   server-side authorization, audit-preserving teardown and the real
   incumbent/candidate rollback drill. Any main advancement requires a fresh
   preview.
4. Only after staging passes and separate pre-production authorization, an
   authorized custodian must provision a different, separately custodied
   `PONTO_PROFILE_DATA_KEY` in `production`, with production-only custody
   references that do not reuse either staging reference.
5. Identity/Workforce must designate an existing eligible pilot and authorize
   the minimal unit/network cohort. Then environment owners may register
   `PONTO_PILOT_LOGIN`, `PONTO_PILOT_PASSWORD` and
   `PONTO_PILOT_COHORT_JSON`; do not invent or activate a collaborator.
6. Provide a clinic-network self-hosted runner matching
   `PONTO_PILOT_RUNNER_LABELS_JSON`, online and idle, plus a reviewed
   `PONTO_CANARY_COHORT_PERCENTAGE`. The current repository runner inventory is
   zero.
7. Enable production deploy flags only for the authorized stage, then complete
   pilot, canary, production and the post-release observation window with the
   exact predecessor artifacts and SLOs. Restore maintenance and exact
   incumbents on any threshold or ownership failure.

`PONTO_PROFILE_DATA_KEY` is absent by name from accessible GitHub
staging/production metadata. `PONTO_ROOT_ATTESTATION_KEY_SHARED`,
`PONTO_ROOT_ATTESTATION_KEY_ID`, `PONTO_PROFILE_DATA_KEY_CUSTODY_REF` and
`PONTO_IDEMPOTENCY_KEY_CUSTODY_REF` are also absent at their required scopes.
The required WAF variables/rules, approved
production pilot inputs and runner labels are also absent; production has no
`ENABLE_TIMEKEEPING_PRODUCTION_DEPLOY` and keeps the Core flag false.
`PONTO_IDEMPOTENCY_KEY` is present by name in both environments, but presence
does not prove the missing profile-key custody or a successful release. Secret
values were not read. No production Ponto dispatch, migration, D1/KV write,
pilot or canary is authorized by the current evidence.

The technical defects recorded in the older section—Finance-coupled Ponto
Core, wrong staging Pages target, fail-open deploy default, dispatch-SHA
checkpoint labels, missing version affinity, missing executable predecessors,
readiness ignoring maintenance, arbitrary Core incumbent capture, late
production-baseline verification, hosted-coordinator pilot credentials and
unproved key separation—are closed by the reviewed source in the changeset
containing this entry. They must still pass hosted checks and the ordered
workflow; they are not external permission to skip items 1–7.

## Resolved — Insumos unit access P0

Insumos is not an executable blocker. The production closure is recorded on
`main` by PRs #847/#848, using canonical Inventory run `30420719000`, CRM
Pages run `30420793906`, checkpoint artifact `8711811875`, and sanitized
synthetic positive/negative unit-scope smokes. Retain rollback evidence, but
do not reopen this item without a new production symptom.

## P1 — Identity PII key custody

The active production `IDENTITY_PII_KEY` is used by the Inventory onboarding
writer and Identity recovery reader. The 2026-07-30 read-only aggregate query
found three onboarding rows with encrypted personal email and phone fields and
one encrypted invite token. GitHub and the active Worker attest the secret
name, but do not prove an external escrow reference, recovery custodian or
rotation record. The current key must therefore not be generated, copied,
replaced or rotated.

**Responsible:** authorized Identity security owner. **Required action:**
register the private escrow/custody reference and approve a dual-key
re-encryption plus rollback procedure before any key lifecycle operation.
This is a recovery-assurance blocker only; it does not reopen the resolved
Insumos P0 or authorize a deployment.

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

## Resolved Finance gate — offsite PostgreSQL recovery

Drill `20260729T2255Z-postgresql-fresh` freshly retrieved the 90,908,667-byte
PostgreSQL ciphertext from the provider-separated Google Drive vault,
validated its manifest hash and HMAC, restored it in isolated PostgreSQL 16.14
scratch in 55.43 s and destroyed both plaintext and scratch. No production
resource or Finance setting changed. The historical connector/authorization
failure is retained as context, but is not a current recovery blocker.

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
may change. The current-main single-SHA staging journey and the offsite
PostgreSQL recovery gate are closed. A named pilot approval and a separately
authorized production foundation remain required before activation.
