# Current blockers

## P0 — Workforce Timekeeping production release is fail-closed

PR #894 and the private Ponto Core/Pages staging prerequisites are integrated.
Its three residual conversations are resolved with zero unresolved threads.
PR #921 integrated the missing progressive release controls at
`aa9bfa6595b9cb12e7228f67f9606527bb375de2` after 19 green checks and
eight resolved review conversations. PR #924 integrated the complete
post-#921 corrective package as
`91f6e9033fed8a186ef2e93be070db3ed896fdd3`, with its required checks green
and review conversations resolved. Unrelated PRs #925/#926/#928 advanced
`main` to `46b97519adc056d31553531cf3f90ad5a324fc88`. PR #927 then completed
the REST path/dynamic-name and environment-payload correction: final head
`7d8945300903847167c0ba55234ab8458cfb240d` passed all 14 hosted checks, both
threads were resolved, Codex re-reviewed that exact head without a major issue,
and protected `main` merged it without bypass as
`15ac662e0c3b01317d48270cd211d7910000ca5a`.
PR #929 then removed the invalid pnpm cache bootstrap. Its final head
`019a34367f3e2e40387b3f50da74b35149ff5981` passed all 14 checks, Codex found
no major issue on that exact head, and protected `main` merged it without
bypass as `77f241ec20f8956fc7e9b20dd2b373518dafa7be`.

The first post-merge preview (`30556924556`) proved its source and completed
Timekeeping child `30556988335`, but coordinator job `90919728697` failed
because the GitHub REST `run.path` contract was modeled with a nonexistent ref
suffix. Watchdog run `30558653559` also exposed a dynamic `run.name` mismatch
that prevented the emergency latch path. Those defects are integrated.
Replacement preview `30562834119` selected `15ac662e...`; source admission and
Timekeeping child `30562866947` passed, while Identity/Inventory child
`30562970927` exposed the pnpm-cache bootstrap fixed by #929. Second replacement
preview `30564873785` then selected exact merge `77f241ec...`; source admission
and Timekeeping child `30564915304` passed, with surface/promotion artifacts
`8768441812` and `8768441200`. Identity/Inventory child `30565019029` failed in
job `90947405936` before tests or dry-run because Node 22.12's bundled Corepack
attempted direct pnpm metadata resolution with a stale signing key (`Cannot find
matching keyid`). Core API and CRM Pages were skipped and no live mutation
occurred. The bounded successor reads the exact Inventory `packageManager`,
prepares that version explicitly and verifies the activated pnpm before use in
all three Identity jobs. `selected_release_sha` remains null until that
successor and a complete four-surface preview succeed; no live surface runs
current `main`.

Both module-control KVs are now maintenance. Timekeeping D1 journals contain
exactly `0001`–`0008` and Identity/Inventory exactly `0001`–`0018` in both
environments. Timekeeping workers.dev/previews remain publicly enabled,
readiness returns a false-positive `200/ready=true` during maintenance, staging
Pages lacks its actor key, and 12/12 required WAF block probes failed across
the two API hosts. Ruleset reads are unauthorized (403/code 10000), so hidden
object state remains unproved. Identity/Workforce yields zero authorized
eligible pilots and the repository has zero self-hosted runners.

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
2026-07-30T10:54:19Z. PR #924 removed the protected production environment
from the read-only unauthenticated health probe. Keep the legacy schedule
disabled until the replacement path is independently qualified; it is not
active external SLO evidence.

The executable blockers, in required order, are:

1. Integrate the bounded Corepack signing-key successor without bypass, then
   repeat preview on its exact protected-main merge SHA. The #924/#927/#929
   source package is already integrated; only the observed package-manager
   activation order is changing. Historical child definitions cannot be
   rewritten, so the
   checkpointed fences and disabled legacy smokes remain until their exposure
   expires or the governed release makes them irrelevant.
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
5. Provision the external close-only broker for each target and pin its
   reviewed URL, custody reference, response key ID and Ed25519 public key in
   policy. Each emergency environment needs its own credential and endpoint
   metadata. Reprovision the Ponto-only D1/KV/Pages identifiers and keep all
   four `ENABLE_PONTO_*` flags false until their authorized stage. The current
   name-only inventory finds these inputs absent; a direct Cloudflare/KV
   credential in an emergency environment is prohibited.
6. Only after item 1 is merged and the WAF/staging custody inputs are present,
   select the exact then-current `main` `GITHUB_SHA`, execute `preview` and then
   `staging` using exactly the coordinator `GITHUB_SHA` on the current `main`.
   The staging predecessor
   must include all four surfaces, checkpoints, additive migrations,
   maintenance/active transitions, authenticated CONSULTOR navigation and
   server-side authorization, audit-preserving teardown and the real
   incumbent/candidate rollback drill. Any main advancement requires a fresh
   preview.
7. Only after staging passes and separate pre-production authorization, an
   authorized custodian must provision a different, separately custodied
   `PONTO_PROFILE_DATA_KEY` in `production`, with production-only custody
   references that do not reuse either staging reference.
8. Separately from deployment review, Identity/Workforce must designate an
   existing eligible, active CONSULTOR/EMPLOYEE pilot and authorize
   the minimal unit/network cohort. Then environment owners may register
   `PONTO_PILOT_LOGIN`, `PONTO_PILOT_PASSWORD` and
   `PONTO_PILOT_COHORT_JSON`; do not invent or activate a collaborator.
9. Provide `PONTO_PILOT_RUNNER_LABELS_JSON` and
   `PONTO_PILOT_RUNNER_ENCRYPTION_PUBLIC_KEY_PEM` as repository variables
   (never environment variables with the same names). The selector must contain
   the three automatic labels plus one reviewed `ponto-jit-*` one-shot label
   and resolve uniquely to the policy-pinned clinic-network runner, online and
   idle, with the reviewed supervisor/JIT custody. Also provide
   `PONTO_CANARY_COHORT_PERCENTAGE`. The current repository runner inventory is
   zero.
10. Enable production deploy flags only for the authorized stage, then complete
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

PR #921 closed the earlier Finance-coupling, wrong-target, fail-open default,
version-affinity, predecessor, pilot-credential and key-separation defects; PR
#924 integrated the post-merge P1/P2 package, PR #927 integrated the bounded
REST contract correction and PR #929 integrated the first pnpm bootstrap
correction. The Corepack signing-key successor in item 1 does not change any
external prerequisite. None of these source merges is permission to skip items
2–10.

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
