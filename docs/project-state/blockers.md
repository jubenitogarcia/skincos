# Current blockers

## P0 — Workforce Timekeeping production release is fail-closed

PR #894 and the private Ponto Core/Pages staging prerequisites are integrated.
Its three residual conversations are resolved with zero unresolved threads.
PR #921 integrated the missing progressive release controls at
`aa9bfa6595b9cb12e7228f67f9606527bb375de2` after 19 green checks and
eight resolved review conversations. A post-merge security/release recheck
supersedes the claim that those controls are sufficient to dispatch: the
trusted-checkout boundary, privileged baseline/SLO leases, baseline provenance
outputs, Pages physical-target mutex and an immediate persistent kill switch
still require a corrective reviewed merge.

At the read-only 2026-07-30T05:57:00Z historical snapshot, `origin/main` was
`aa9bfa6595b9cb12e7228f67f9606527bb375de2`,
`selected_release_sha` remains null and no live Ponto surface runs that SHA.
Staging module-control was `active`; production remained explicitly
`module-control:timekeeping=maintenance` through canonical run `30496220685`
with `ENABLE_CORE_WORKERS_DEPLOY=false`. Both Timekeeping D1 journals contain
exactly migrations `0001`–`0008` (8/8, no named pending migration), but this
does not prove current-main lineage. The live Timekeeping `workers.dev`
endpoint remains publicly reachable, and production `/api/ponto/readiness`
still returns `200/ready=true` while the protected module path is closed for
maintenance. Public version-selection-header probes returned 200 and the
workforce-contract probe returned 401 instead of the required edge 403, so the
required WAF enforcement is not observed at the edge. That does not establish
whether an inaccessible custom rule object exists. Identity/Workforce yields
zero eligible production pilots.

Scheduled production Ponto Smoke run `30521686413` at
2026-07-30T07:04:44Z failed on all five attempts with the proxy target/actor
configured but `ready=false`. This is useful external detection of the intended
fail-closed non-readiness, not successful production SLO evidence. Earlier
Ponto UI Smoke run `30518888970` passed, but it is not an authenticated
authorized-user journey and cannot close the production blocker.

At 2026-07-30T06:57:00Z, the approved replay containment and staging dispatch
fences were complete
after private checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T035009-03-production-replay-containment.md`.
Production now overrides `ENABLE_CRM_PAGES_DEPLOY=false`,
`TIMEKEEPING_D1_PRODUCTION_ID` is absent and
`ENABLE_CORE_WORKERS_DEPLOY=false` remains unchanged; its Pages project
variable targets deliberately nonexistent
`skincos-ponto-fenced-production-20260730`. Staging now overrides
`ENABLE_CORE_WORKERS_DEPLOY=false` and
`ENABLE_CRM_PAGES_DEPLOY_STAGING=false`, omits
`TIMEKEEPING_D1_STAGING_ID`, and targets deliberately nonexistent
`skincos-ponto-fenced-staging-20260730` through both Pages project variables.
The production and staging module-control KV variables and their then-current
maintenance/active states were preserved. No Cloudflare Worker, Pages
deployment, D1 database, binding or live runtime was altered; the follow-up
check still found production maintenance, staging active and Pages health HTTP
200. This blocks the known environment-dependent mutation paths while
historical Actions runs remain rerunnable, but it is containment, not the
permanent source/governance fix.

Staging was subsequently closed through canonical main workflow run
`30527767707` on
`aa9bfa6595b9cb12e7228f67f9606527bb375de2`; jobs `90822614084` and
`90822665436` succeeded. Artifact `8753392021`,
`module-transition-timekeeping-staging-maintenance-30527767707`, has digest
`sha256:09de66aad85d0df5fec416917becd87a5aa3004542af8a4ed4bf34ef74244612`
and expiry 2026-10-28. Private pre-change checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T084146-06-staging-maintenance-before.json`
recorded the prior value as absent. At 2026-07-30T08:43:14.511Z, staging KV
readback was schema v2 `maintenance`; edge health was
`ok=false/ready=false`, `source=control`, and `/me` returned 503. Production
remained maintenance. This is fail-close evidence, not a staging release.

Legacy credential reuse is also contained, but cleanup is incomplete.
Checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T072614-11-legacy-ponto-ui-smoke-disable.md`
records workflow `Ponto UI Smoke (prod)` id `231059578` as
`disabled_manually`, no in-progress runs, deletion by name of repository
secrets `PONTO_SMOKE_EMAIL` / `PONTO_SMOKE_PASSWORD`, and removal of
`ENABLE_PONTO_UI_SMOKE`, without reading values. The historical GESTOR account
has not been identified or revoked; authorized Identity reconciliation remains
required.

The backend smoke is contained independently. Checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T075100-15-legacy-ponto-smoke-disable.md`
records `Ponto Smoke (prod)` id `230950805` as `disabled_manually` and waiting
scheduled run `30536124024` on `aa9bfa65...` as `completed/cancelled` at
2026-07-30T10:54:19Z. Current main still binds this read-only unauthenticated
health probe to the protected production environment; the local successor
removes that environment. Re-enable only after reviewed merge. Until then the
legacy schedule is not active external SLO evidence.

The executable blockers, in required order, are:

1. Stabilize and commit the evolving local P1/P2 corrective package on
   `codex/admin/ponto-release-evidence`, publish it through a new reviewed PR,
   pass hosted checks and merge it without bypass. The local, uncommitted state
   adds trusted-main execution before lease consumption; independent
   `production-baseline`/`production-slo` capabilities; all seven baseline
   provenance outputs; serialization of every physical CRM Pages mutation; and
   an immediate emergency mutex with persistent latch, capability invalidation,
   run cancellation/reconciliation, final `always()` reassertion and a
   separately governed reset that remains in maintenance. The expanded local
   package also refuses privileged `run_attempt>1`, revalidates the exact live
   first-attempt coordinator immediately before secrets/mutations in every
   governed job, accepts bodyless GitHub 202/204 acknowledgements, serializes
   the three scheduled CRM Pages secret writers against release custody and
   removes their dispatches to the retired publisher. It also introduces
   Ponto-only fail-closed controls
   `ENABLE_PONTO_CRM_PAGES_DEPLOY[_STAGING]`,
    `PONTO_CLOUDFLARE_PAGES_PROJECT[_STAGING]`,
    `ENABLE_PONTO_CORE_WORKERS_DEPLOY`,
    `ENABLE_PONTO_TIMEKEEPING_PRODUCTION_DEPLOY`,
    `PONTO_TIMEKEEPING_D1_{STAGING,PRODUCTION}_ID` and
    `PONTO_MODULE_CONTROL_{STAGING,PRODUCTION}_KV_ID`. Checkpoint
    `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T074500-14-ponto-resource-variables-before.md`
    records that the six Ponto-specific KV, Pages and D1 identifiers plus
    `CLOUDFLARE_ZONE_ID` were absent, verified against live Cloudflare, created
    as non-secret repository variables and individually read back. Exact values
    remain private. The `ENABLE_PONTO_*` gates and consuming source are not live;
    this metadata neither restores general Pages fences nor authorizes a
    candidate, deploy, migration or module activation. General Pages continues
    to use `CRM_PAGES_PROJECT[_STAGING]` in historical definitions.

   The proposed emergency contract is a separate
   `module-control:timekeeping:emergency-latch` overlay: missing, unreadable,
   malformed or true denies; only exact schema-v1 `latched=false` opens.
   `ponto-emergency-latch-reset.yml` is the sole false writer and leaves
   ordinary module-control in maintenance. All direct mutations use
   `ponto-surface-mutation`; the terminal coordinator watchdog writes true
   before that mutex with narrow emergency credentials, then reconciles and
   writes regular maintenance. It still depends on terminal `workflow_run`
   delivery, GitHub Actions, the external close-only broker and its downstream
   Cloudflare control plane, so it is not independent external recovery.

   The revised custody is an external close-only broker, not a direct
   Cloudflare/KV token. Each `ponto-emergency-{staging,production}` environment
   requires its own `PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL` secret and
   `PONTO_EMERGENCY_CLOSE_BROKER_URL`,
   `PONTO_EMERGENCY_CLOSE_CUSTODY_REF` and
   `PONTO_EMERGENCY_CLOSE_MODE=external-close-only-broker-v1` variables, with
   distinct custody references. Its exact target identity must also be pinned in
   `.github/governance/progressive-release-policy.json` by HTTPS URL, custody
   ref, response key ID and Ed25519 SPKI PEM public key. The request uses a
   fresh policy-bound HMAC; the response requires a fresh Ed25519 attestation
   bound to that request and response digest. Both target policy objects
   currently contain `null` for all four identity fields. Both emergency environments now exist with
   protected branches, `can_admins_bypass=false`, no reviewer/timer/custom rule,
   rule IDs `61303367` / `61303369`, zero secrets and only the required mode
   variable. URL, custody ref, credential, response key ID and SPKI remain
   unprovisioned, so the broker and staging stay fail-closed. A reviewed decision
   must pin both target identities before provisioning. Checkpoint:
   `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T073300-13-emergency-environments-before.md`.

   The worktree is still evolving, so no final path/test count, corrective SHA
   or successor PR is frozen. `commit_sha`, `pr` and `selected_release_sha`
   remain `null`; hosted checks, valid review and merge are pending. Targeted
   local checks cover the new atomic release-probe and Identity teardown
   contracts, but this is not an aggregate final matrix or operational proof.

   The release probe now validates HMAC before login, requires v2 stage/run
   provenance for pilot/canary, keeps v1 staging-only and consumes the external
   nonce with one UNIQUE D1 insert through private Core/Timekeeping before
   Identity. Same-nonce/different-body and concurrent cross-PoP attempts cannot
   choose a second key. Core owns Timekeeping affinity. Any login cookie triggers
   `finally` teardown by session revoke or logout, followed by mandatory
   canonical stale-cookie 401 verification; indeterminate teardown fails while
   preserving the primary error. These safeguards are local/unmerged.

   The local watchdog is intended to close a rerun only after integration and
   broker provisioning; it is not operational automatic recovery. Historical child runs that predate correlation/attempt guards
   still execute their old workflow definitions. The exact rerunnable
   Timekeeping production runs are
   `30420024733`, `30132172442`, `30132009676`, `29966286110`, `29959858249`,
   `29757475250` and `29700295125`; run `30420024733` has no current guard.
   CRM Pages run `30491926800` is attempt 2, and the read-only inventory found
   zero Ponto progressive coordinator runs. The 30-day inventory also found
   835 Pages secret-sync runs, 121 Workers secret-sync runs, 35 Timekeeping
   runs, 83 Core runs, 113 CRM Pages deploy runs, seven module-control runs and
   one production-baseline run. New definitions propose terminal invalidation
   of late-issued capabilities, but no automatic interruption/rollback is ready
   while broker identities/keys, the clinic runner and independent external
   freeze/recovery proof are absent. Moreover,
   no source edit can rewrite those historical child definitions. Keep the
   external fences in place through their expiry and until the corrective
   package is committed, hosted-validated and merged.
2. An authorized Cloudflare security principal must inspect and attest the exact
   zone-scoped WAF block rules, create/enable them only if that inspection proves
   they are missing or disabled, and use the checkpointed
   `CLOUDFLARE_ZONE_ID` while registering
   `PONTO_WAF_RULESET_ID`,
   `PONTO_WAF_HEADER_RULE_ID` and `PONTO_WAF_CONTRACT_RULE_ID`. The gate
   requires external 403 probes for both public version-selection headers and
   `/insumos/health/workforce-contract`; no Worker-side bypass is accepted.
   The current connector listed only managed rulesets; GET on the custom
   ruleset entrypoint was unauthorized, so rule existence and configuration
   remain unproved. The post-merge security-token workflow still needs to
   attest them. It requires repository-only `PONTO_WAF_READ_API_TOKEN` and
   production-environment-only `PONTO_WAF_WRITE_API_TOKEN`; both are currently
   unprovisioned, and fallback to `CLOUDFLARE_SECURITY_API_TOKEN` is forbidden.
   The Codex in-app browser and the
   existing Chrome profile both reached only Cloudflare login with no
   authenticated dashboard session. No credential was entered and no mutation
   was attempted, so there is no alternate approved UI path in the current
   operator context.
3. Establish independent deployment approval without bypass. After checkpoint
   `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T073000-12-environment-protection-before.md`,
   staging rule/policy IDs `61302994` / `56015291` and production IDs
   `61303000` / `56015293` enforce `main` only,
   `can_admins_bypass=false`, `prevent_self_review=true`, zero wait and sole
   reviewer owner `jubenitogarcia` (`199169872`). This blocks the current owner
   actor and old reruns but does not create an independent reviewer. PR #921's
   `required_approvals=0` describes code governance only and is not deployment
   or pilot approval. Repository collaborator inventory contains only that
   owner; the observed `GITHUB_TOKEN` reports
   `can_approve_pull_request_reviews=false`, and no authorized GitHub App, bot
   or automation approver was proved.
4. An authorized secret custodian must provision a distinct, separately
   custodied `PONTO_PROFILE_DATA_KEY` in the GitHub `staging` environment from
   an approved source, plus environment variables
   `PONTO_PROFILE_DATA_KEY_CUSTODY_REF` and
   `PONTO_IDEMPOTENCY_KEY_CUSTODY_REF` containing distinct opaque approved-vault
   references. A security custodian must provision the same effective
   `PONTO_ROOT_ATTESTATION_KEY_SHARED` version only in protected `staging` and
   `production`, plus target-distinct Ed25519
   `PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY` and target-only
   `PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY`. Repository scope may hold only
   non-secret `PONTO_ROOT_ATTESTATION_KEY_ID` and
   `PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON`. Do not generate in CI,
   print, copy application roots/private signers across environments or version
   a secret value.
5. Only after item 1 is merged and the WAF/staging custody inputs are present,
   select the exact then-current `main` `GITHUB_SHA`, execute `preview` and then
   `staging` using exactly the coordinator `GITHUB_SHA` on the current `main`.
   The staging predecessor
   must include all four surfaces, checkpoints, additive migrations,
   maintenance/active transitions, authenticated CONSULTOR navigation and
   server-side authorization, audit-preserving teardown and the real
   incumbent/candidate rollback drill. Any main advancement requires a fresh
   preview.
6. Only after staging passes and separate pre-production authorization, an
   authorized custodian must provision a different, separately custodied
   `PONTO_PROFILE_DATA_KEY` in `production`, with production-only custody
   references that do not reuse either staging reference.
7. Separately from deployment review, Identity/Workforce must designate an
   existing eligible, active CONSULTOR/EMPLOYEE pilot and authorize
   the minimal unit/network cohort. Then environment owners may register
   `PONTO_PILOT_LOGIN`, `PONTO_PILOT_PASSWORD` and
   `PONTO_PILOT_COHORT_JSON`; do not invent or activate a collaborator.
8. Provide `PONTO_PILOT_RUNNER_LABELS_JSON` as a repository variable (never an
   environment variable with the same name), plus a clinic-network
   self-hosted runner matching it, online and idle, and a reviewed
   `PONTO_CANARY_COHORT_PERCENTAGE`. The current repository runner inventory is
   zero.
9. Enable production deploy flags only for the authorized stage, then complete
   pilot, canary, production and the post-release observation window with the
   exact predecessor artifacts and SLOs. Restore maintenance and exact
   incumbents on any threshold or ownership failure.

`PONTO_PROFILE_DATA_KEY` is absent by name from accessible GitHub
staging/production metadata. `PONTO_ROOT_ATTESTATION_KEY_SHARED`,
`PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY`,
`PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY`,
`PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON`,
`PONTO_ROOT_ATTESTATION_KEY_ID`, `PONTO_PROFILE_DATA_KEY_CUSTODY_REF` and
`PONTO_IDEMPOTENCY_KEY_CUSTODY_REF` are also absent at their required scopes.
The required WAF
rule identifier variables `PONTO_WAF_RULESET_ID`, `PONTO_WAF_HEADER_RULE_ID`
and `PONTO_WAF_CONTRACT_RULE_ID` are absent at their GitHub scopes and the
custom rules remain unverified; approved
production pilot inputs, runner labels and canary percentage are also absent.
Staging/production protections are fail-closed, but the sole owner reviewer
cannot self-review, it is the only repository collaborator, the observed
`GITHUB_TOKEN` cannot approve pull-request reviews, no authorized app/bot
approver is proved and no independent deployment reviewer is available;
production has no `ENABLE_TIMEKEEPING_PRODUCTION_DEPLOY`, keeps the Core flag
false, now overrides CRM Pages deploy false and has no
`TIMEKEEPING_D1_PRODUCTION_ID` under the replay containment. Staging now keeps
Core and CRM Pages deploy false, has no `TIMEKEEPING_D1_STAGING_ID` and fences
both Pages project variables to a deliberately nonexistent project.
`PONTO_IDEMPOTENCY_KEY` is present by name in both environments, but presence
does not prove the missing profile-key custody or a successful release. Secret
values were not read. The external changes were limited to the checkpointed
deployment fences/module maintenance, legacy UI smoke containment and GitHub
environment hardening; no candidate dispatch, migration, Cloudflare deployment,
pilot or canary is authorized or claimed.

The emergency environments contain no endpoint/credential, and the reviewed
policy keeps broker URL, custody ref, response key ID and Ed25519 SPKI PEM
`null` for both targets. Thus the HMAC-request/Ed25519-response broker contract
cannot yet be functionally exercised. This blocks staging and means automatic
interruption/rollback is not operational evidence.

PR #921 did close the earlier Finance-coupling, wrong-target, fail-open default,
version-affinity, predecessor, pilot-credential and key-separation source
defects. It did not deploy those fixes to the live split surfaces, and the
post-merge audit found the additional P1/P2 defects now covered by item 1.
Neither the merged source nor the local correction is permission to skip items
2–9.

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
