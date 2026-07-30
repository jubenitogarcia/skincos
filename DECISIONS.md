# DECISIONS

## 2026-07-30 - Accept the complete preview but keep staging closed

- Decision: PR #930's merge
  `71c54b1d406317c614dc33e48ced170458fbd707` and coordinator run
  `30566547605` are the first complete four-surface Ponto preview. The
  Timekeeping, Identity/Inventory, Core API and CRM Pages children all used
  that exact SHA and completed their non-mutating publishers. Combined evidence
  artifact `8769249449` and sanitized run ledger `8769249808` are the canonical
  hosted records; private checkpoint
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T144137-20-complete-preview.md`
  retains every artifact digest.
- Decision: the preview proves build/test/dry-run lineage only. It does not
  authorize staging and does not prove a migration, live deployment,
  module-control transition, authenticated journey, rollback, pilot, canary,
  external SLO or production use.
- Decision: the workflow-run watchdog must skip a successful first-attempt
  coordinator before provenance validation. It continues to admit
  failure/cancelled/timed-out first attempts and every rerun, including a
  successful unauthorized rerun. Run `30567091382` proved the missing
  admission predicate; all emergency jobs skipped and no mutation occurred.
- Decision: staging remains fail-closed until independent deployment approval,
  approved target-specific secret custody, the policy-pinned close-only broker,
  split-custody WAF enforcement and external probes, Ponto resource selectors,
  clinic JIT runner, Identity/Workforce-authorized cohort and external SLO
  monitoring are all functional. Existing Cloudflare resources are not release
  authority, and the four `ENABLE_PONTO_*` flags remain false/absent.
- Impact: if `main` advances after this evidence, the coordinator contract
  requires a fresh preview on the new exact `GITHUB_SHA`; the ancestral run
  cannot become a staging predecessor. Both environments remain
  `module-control:timekeeping=maintenance`.

## 2026-07-30 - Use canonical REST workflow paths and static workflow metadata

- Decision: GitHub REST workflow-run provenance compares `run.path` with the
  canonical workflow file path, without a ref suffix. The branch (`main`),
  immutable head SHA, workflow ID, repository, event, run attempt,
  title/nonce, signed capability and predecessor/artifact identity remain
  independently mandatory.
- Decision: a workflow's static identity comes from workflow metadata.
  `run.name` is not a static name when the workflow declares `run-name`; the
  watchdog accepts the live dynamic value while still pinning the exact
  workflow name/path/ID and all run provenance.
- Decision: the versioned staging/production environment payloads reproduce
  the live custom `main` policy, sole owner reviewer and
  `prevent_self_review=true`, with `can_admins_bypass=false` explicit and
  validator-enforced. This is an intentional lockout baseline, not independent
  approval. The remote and versioned reviewer must be updated together when an
  independent human/app identity is authorized.
- Evidence: preview run `30556924556` on PR #924's merge SHA observed successful
  Timekeeping child `30556988335`, then timed out in job `90919728697` because
  it expected the undocumented ref suffix. Watchdog run `30558653559` exposed
  the separate dynamic-name defect. PR #927 contains both fixes. Its initial
  head passed 14 hosted checks; Codex review then found the omitted
  administrator-bypass field and remaining static `run.name` comparisons.
  Commit `c3131eb8` fixes both, 219/219 governed tests pass and the independent
  follow-up review reports no remaining P0/P1/P2.
- Impact: no environment, secret, deployment or module-control value is changed
  by this decision. Staging and production remain fail-closed until #927 is
  integrated and every external predecessor is independently satisfied.

## 2026-07-30 - Keep Codex Windows-native and encapsulate the Linux backend

- Decision: run the Codex agent natively on Windows with PowerShell as the
  integrated terminal, while routing SKINCOS Node/npm/Python/build/test/runtime
  operations through the typed `scripts/invoke-skincos-wsl.ps1` gateway to
  `Ubuntu-24.04` as operator `admin`.
- Why: Windows-native Codex preserves tasks, plugins, browser, Computer Use,
  MCPs and authentication. Reimplementing the repository's Bash/systemd/Unix
  contracts on Windows would duplicate production behavior and increase drift.
- Impact: Windows Git, GitHub CLI, Node LTS and Python support general agent
  tooling only. Project dependency trees and caches stay Linux-only; visible
  actions use typed gateway arguments, and direct WSL ownership is restricted
  to explicitly documented lifecycle infrastructure.
## 2026-07-30 - Atomic release probe and mandatory Identity session teardown

- Status: integrated by PR #924 at
  `91f6e9033fed8a186ef2e93be070db3ed896fdd3`, with hosted checks and security
  review green. No release SHA is selected and the external inputs needed to
  execute the authenticated path remain absent.
- Decision: the private release probe validates its external HMAC before parsing
  credentials or contacting Identity. Signature v2 is mandatory for `pilot` and
  `canary` and binds timestamp, nonce, method, path, exact body digest, release
  SHA, rollout stage, coordinator run ID and workflow run ID. Signature v1 is
  accepted only for the isolated synthetic staging drill.
- Decision: after the external HMAC passes, Pages sends a server-signed actor
  envelope through the private Ponto Core and consumes the external nonce at the
  Timekeeping boundary with one D1 `INSERT` against the existing UNIQUE nonce
  table. The database key is target + release + SHA-256 of the external nonce;
  body digest remains authenticated but cannot select a second key. Thus
  concurrent cross-PoP requests and same-nonce/different-body replay admit at
  most one request. KV `get` followed by `put` is not an acceptable acceptance
  decision. Ponto Core, not the browser, supplies the exact Timekeeping version
  affinity.
- Decision: receipt of a login session cookie means a release-probe session may
  exist. Teardown therefore runs in `finally`: revoke the current session ID
  when known, otherwise call `/auth/logout`, then replay the exact stale cookie
  against `/auth/me`. Only the canonical `401` unauthenticated response proves
  teardown. An indeterminate teardown fails the probe explicitly and preserves
  the primary contract error; credentials and PII remain absent from evidence.
- Impact: these safeguards close replay and leaked-probe-session failure modes
  in integrated source. They do not authorize staging, identify a pilot, satisfy
  deployment review or prove a live release.

## 2026-07-30 - Contain legacy Ponto UI smoke and harden environment admission

- Decision: keep GitHub workflow `Ponto UI Smoke (prod)` id `231059578`
  manually disabled and keep repository secret names `PONTO_SMOKE_EMAIL` /
  `PONTO_SMOKE_PASSWORD` plus variable `ENABLE_PONTO_UI_SMOKE` removed. The
  checkpoint is
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T072614-11-legacy-ponto-ui-smoke-disable.md`.
  Re-enable only after the reviewed manual-only, production-environment-scoped
  replacement is merged. The historical GESTOR account is not thereby revoked;
  it still requires separate authorized reconciliation without guessing its
  identity or exposing PII.
- Decision: keep legacy workflow `Ponto Smoke (prod)` id `230950805` manually
  disabled and its waiting scheduled run `30536124024` cancelled. The current
  `main` definition unnecessarily enters the protected production environment
  for an unauthenticated read-only health probe; the local successor removes
  that environment. Re-enable only after the read-only successor is reviewed
  and merged. Checkpoint:
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T075100-15-legacy-ponto-smoke-disable.md`.
- Decision: `staging` and `production` admit only branch `main`, have
  `can_admins_bypass=false`, `prevent_self_review=true`, zero wait and one
  required reviewer. Staging rule/policy IDs are `61302994` / `56015291`;
  production IDs are `61303000` / `56015293`. The sole reviewer is repository
  owner `jubenitogarcia` (`199169872`), so the current actor cannot self-approve
  and historical reruns cannot silently hydrate credentials. This is a
  fail-closed improvement, not independent review: a separate valid reviewer
  remains required. Repository collaborator inventory contains only that owner;
  the observed `GITHUB_TOKEN` reports
  `can_approve_pull_request_reviews=false`, and no authorized GitHub App, bot or
  automation approver has been proved. Checkpoint:
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T073000-12-environment-protection-before.md`.
- Decision: `ponto-emergency-staging` and `ponto-emergency-production` exist
  only as fail-close environments, with protected-branch admission,
  `can_admins_bypass=false`, no reviewer/timer/custom rule and branch-policy
  rule IDs `61303367` / `61303369`. Each currently has only
  `PONTO_EMERGENCY_CLOSE_MODE=external-close-only-broker-v1`; broker URL,
  custody reference and credential are absent, so emergency mutation remains
  blocked. Checkpoint:
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T073300-13-emergency-environments-before.md`.
- Decision: immutable Cloudflare resource identities required by the successor
  are repository metadata, not credentials. The six Ponto-specific KV, Pages
  and D1 resource variables plus `CLOUDFLARE_ZONE_ID` were created/read back
  individually after private checkpoint
  `C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T074500-14-ponto-resource-variables-before.md`;
  their values remain in the private checkpoint. This does not authorize any
  `ENABLE_PONTO_*` flag, consume a secret, select a candidate, remove a legacy
  fence, deploy or mutate Cloudflare. Missing custody, WAF-rule identifiers,
  independent review and release predecessors still fail closed.
- Impact: these live controls reduce replay/credential exposure but do not
  select a candidate, provision release custody, identify a pilot, satisfy
  independent approval or prove production use. Their rollback weakens
  security and cannot be used as a release bypass.

## 2026-07-30 - Ponto emergency overlay and direct-surface custody

- Status: the source implementation was integrated by PR #924. The broker,
  custody inputs, enable gates and runner remain
  unprovisioned/non-operational; the latest name-only repository inventory also
  found the Ponto-only resource variables absent. The controls become
  operational release policy only after the exact required names are
  provisioned through authorized custody and live behavior is attested. Until
  then, the checkpointed
  GitHub environment fences remain in force and both staging and production
  stay `module-control:timekeeping=maintenance`.
  Staging was closed through canonical run `30527767707`; that run is
  fail-close evidence only, not candidate or release evidence.
- Decision: emergency closure is a monotonic overlay at
  `module-control:timekeeping:emergency-latch`, separate from ordinary
  `module-control:timekeeping`. Every protected Ponto edge and every workflow
  that could open or mutate the release requires a well-formed schema-v1 latch
  whose value is explicitly `latched=false`. A missing, unreadable, malformed
  or `latched=true` overlay denies service and release progress. Writing an
  ordinary `active` control never clears or overrides the overlay.
- Decision: `.github/workflows/ponto-emergency-latch-reset.yml` is the sole
  writer of `latched=false`. Reset requires immutable latch/reconciliation
  evidence, an idle governed surface and ordinary module-control already in
  maintenance; it leaves the module in maintenance. Emergency close paths may
  only set `latched=true`. Deleting the key, synthesizing an open default or
  using an unreadable prior value as open is forbidden.
- Decision: every direct mutation of a Ponto surface serializes on the global
  `ponto-surface-mutation` mutex, including canonical publishers, scheduled
  Pages secret writers, the rollback drill, latch reset and the watchdog's
  ordinary maintenance write. The external
  `.github/workflows/ponto-release-watchdog.yml` reacts only to an exact
  first-attempt failed, cancelled or timed-out coordinator on `main`; for
  non-preview stages it writes the monotonic latch before waiting on that
  mutex, reconciles/cancels governed work, then writes and reattests ordinary
  maintenance under the still-closed latch.
- Decision: the watchdog's pre-mutex close uses only the dedicated
  `ponto-emergency-{staging,production}` environments and an external
  close-only broker. Each environment has its own
  `PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL` secret,
  `PONTO_EMERGENCY_CLOSE_BROKER_URL`,
  `PONTO_EMERGENCY_CLOSE_CUSTODY_REF` and
  `PONTO_EMERGENCY_CLOSE_MODE=external-close-only-broker-v1` variables. The
  broker identity must also be pinned per target in
  `.github/governance/progressive-release-policy.json` by exact HTTPS URL,
  custody reference, response key ID and Ed25519 SPKI PEM public key. Requests
  carry a fresh nonce/time/digest HMAC bound to that policy identity; responses
  must carry a fresh Ed25519 attestation bound to the exact request and response
  digest. The broker contract permits only `latch-true` and `maintenance`; it denies
  `latch-false`, `active`, `disabled`, `canary`, delete and arbitrary KV writes,
  and returns no credentials or PII. Both `emergencyBrokers.staging` and
  `emergencyBrokers.production` currently have `url`, `custodyRef`,
  `responseKeyId` and `responsePublicKeyPem` set to `null`. Therefore there is
  no functionally attested broker identity for either target, and staging is
  blocked until a reviewed decision pins both identities and authorized custody
  provisions the endpoints/credentials/keys. The emergency environments must not contain a
  direct Cloudflare/KV token, account/KV identifier or broad release credential,
  and staging/production custody references must differ. The two emergency
  environments and mode variable are live; broker URL, custody reference and
  credential remain unprovisioned, while the implementation is local/unmerged.
  No automatic interruption, rollback or kill switch may be described as ready
  while the broker policy, clinic runner and independent external freeze/recovery
  proof are absent. Even after provisioning, this recovery is not independent of terminal GitHub `workflow_run` delivery,
  GitHub Actions, the broker or its downstream Cloudflare control plane;
  outage or delayed delivery can prevent/delay it. External monitoring,
  checkpointed fences and an operator recovery path therefore remain required.
- Decision: target selection has no fallback. `staging` and `production` must
  map explicitly to their own project, D1 and KV identifiers; a missing,
  unsupported or ambiguous target/name fails before credential hydration or
  mutation. The Ponto-only contract is
  `ENABLE_PONTO_CRM_PAGES_DEPLOY`,
  `ENABLE_PONTO_CRM_PAGES_DEPLOY_STAGING`,
  `PONTO_CLOUDFLARE_PAGES_PROJECT`,
  `PONTO_CLOUDFLARE_PAGES_PROJECT_STAGING`,
  `ENABLE_PONTO_CORE_WORKERS_DEPLOY`,
  `ENABLE_PONTO_TIMEKEEPING_PRODUCTION_DEPLOY`,
  `PONTO_TIMEKEEPING_D1_STAGING_ID`,
  `PONTO_TIMEKEEPING_D1_PRODUCTION_ID`,
  `PONTO_MODULE_CONTROL_STAGING_KV_ID` and
  `PONTO_MODULE_CONTROL_PRODUCTION_KV_ID`. General CRM Pages continues to use
  only `CRM_PAGES_PROJECT` and `CRM_PAGES_PROJECT_STAGING`; neither namespace
  may fall back to the other. Legacy general names retained in the current
  external containment are fences, not candidate configuration.
- Decision: governed child capabilities use target-bound schema-v6 Ed25519.
  `PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY` exists only in the selected
  `staging` or `production` environment; the repository stores only the
  non-secret target-to-verifier/key-ID map
  `PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON`. Consumers and the watchdog
  receive only the public map, never another target's private signer.
  Environment-owned application roots and Ponto target selectors have no
  repository, cross-environment or general-CRM fallback. The custom zone WAF
  remains an external precondition.
  `PONTO_WAF_READ_API_TOKEN` is repository-only and
  `PONTO_WAF_WRITE_API_TOKEN` is production-environment-only; both are currently
  unprovisioned and block the release. Neither may fall back to the existing
  `CLOUDFLARE_SECURITY_API_TOKEN`. An unauthorized API principal or
  unauthenticated dashboard is not permission to replace WAF with Worker logic.
  Code review, independent deployment review and
  the separate Identity/Workforce pilot designation remain distinct gates;
  administrator environment bypass is forbidden.
- Impact: the local source remains an evolving, uncommitted proposal; targeted
  checks do not constitute a final aggregate freeze, hosted validation or
  release evidence. Path/test counts, corrective commit, successor PR and
  selected SHA remain pending/null. No candidate SHA may be selected and no fence may
  be removed until the successor is committed, reviewed, hosted-validated and
  merged, the required controls are provisioned, and the WAF, custody,
  deployment approver, pilot identity, runner and SLO prerequisites are
  independently proven.

## 2026-07-29 - Govern Ponto as a four-surface progressive release

- Decision: one Ponto release uses exactly the full `GITHUB_SHA` of the
  coordinator executing on `refs/heads/main`, and that same immutable source
  is used on Timekeeping, Identity/Inventory, Core API and CRM Pages.
  Reachability from `main` and checkout equality remain additional checks;
  an older reachable ancestor is not accepted. If `main` advances between
  stages, the old chain cannot continue and a new `preview` must start from
  the new coordinator SHA. A successful health check or a source merge on
  only one surface is not a release.
- Decision: `.github/workflows/ponto-progressive-release.yml` is the sole
  coordinator. It may dispatch and attest the canonical publishers, but it may
  not run Wrangler or mutate a deployment directly. The ordered chain is
  `preview → staging → pilot → canary → production`; every stage requires the
  exact successful predecessor artifact for the same SHA. The Timekeeping
  publisher exposes only `release_scope=ponto`; a standalone dispatch is
  permitted only for non-mutating `preview`, while every mutating target
  requires the coordinator's single-use lease.
- Decision: preview is non-mutating. Staging first closes Timekeeping, captures
  encrypted checkpoints, applies only additive migrations, publishes all four
  surfaces, writes an active schema-v2 control bound to the release SHA, runs
  an authenticated synthetic CONSULTOR journey, and tears down only its
  run-scoped data while retaining audit evidence.
- Decision: pilot and canary use explicit Cloudflare Worker version affinity.
  Timekeeping, private Ponto Core and Identity/Inventory remain at zero-percent
  default traffic during both stages. Protected CRM Pages service bindings
  select their exact candidates only for the conjunctively authorized
  identity, login, employee, unit and network context; canary bucketing is
  applied there, never through a public Worker override. The selected Core
  version pins the selected Timekeeping version. The protected path must
  exercise candidate auth/session, a representative authorized read and the
  Identity → Workforce HMAC v2 contract during pilot and canary.
- Decision: the one-time private Ponto Core predecessor is the reviewed PR
  #912 source `0f3480dce1a170ac0f862fa392a95456af292a88`, published by PR #919
  run `30512105626`. The catalog pins its run, artifact IDs and digests plus
  the exact staging and production deployment/version identities. Before any
  staging candidate mutation and before the production pilot baseline is
  captured, the workflow revalidates that provenance and reattests live
  bindings, 100-percent weight and zero public exposure. Replacing this
  predecessor is a policy change requiring an explicit reviewed decision; it
  cannot be silently recaptured from the application candidate.
- Decision: an enabled zone-scoped WAF block is a release precondition, not an
  implementation fallback. It must reject public version-selection headers on
  both API hosts and reject the public Workforce contract probe before any
  staging or live mutation. Missing rule IDs, drift, a non-block action or a
  failed external probe stops the chain while Ponto remains in maintenance.
- Decision: production may open `active` only after the same Identity/Inventory
  candidate is published, all four candidates are attested, the authorized
  pilot identity and network-bound cohort have passed, and the external
  authenticated SLO has met its minimum window, sample count and thresholds.
  Any publisher, journey, or SLO failure puts Timekeeping in maintenance first
  and restores all four surfaces to the immutable incumbent baseline captured
  and proved before pilot. A retry may reuse that baseline but may not recapture
  a partially promoted candidate as its rollback source.
- Decision: Identity → Workforce requests use signature contract v2, binding
  timestamp, nonce, HTTP method, canonical path/query and body digest. Active
  Timekeeping requires schema-v2 module control whose release SHA exactly
  matches its artifact; no v1 compatibility or unversioned active control is
  accepted.
- Decision: rollback closes the module first and restores the independently
  attested incumbent on Timekeeping, Identity/Inventory, Core API and CRM
  Pages before any reopening. Additive database migrations are not reversed
  during application rollback.
- Decision: staging and production application-root custody is separate. The
  environment-owned `PONTO_PROFILE_DATA_KEY` may enter only the new
  Timekeeping candidate via `wrangler versions upload --secrets-file`; it may
  not be applied with `wrangler secret put`, because that creates and deploys a
  100-percent version. The environment-owned `PONTO_IDEMPOTENCY_KEY` is also
  supplied only with that immutable candidate. Before maintenance or any other
  mutation, a constant-time comparison rejects byte equality between the
  profile and idempotency roots. The same effective version of audit secret
  `PONTO_ROOT_ATTESTATION_KEY_SHARED` exists only in the protected `staging` and
  `production` environments, never at repository scope; the repository stores
  only opaque non-secret metadata `PONTO_ROOT_ATTESTATION_KEY_ID`. It creates
  domain-separated HMAC-SHA-256 commitments without containing either
  application root. Pages rollback intent uses a separate
  `PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY`, also only in the selected target
  environment and absent from repository/emergency scopes. The artifact also
  records the environment-owned opaque vault references
  `PONTO_PROFILE_DATA_KEY_CUSTODY_REF` and
  `PONTO_IDEMPOTENCY_KEY_CUSTODY_REF`, plus the producing workflow run,
  artifact ID/digest and coordinator correlation. Production is accepted only
  when both of its commitments and both custody references are disjoint from
  staging and the fixed-label key-version commitment proves that both
  comparisons used the exact same audit-key version. Neither audit nor
  Pages-intent key is deployed to a runtime. This
  proves non-reuse of exact bytes under one keyed comparison and declared
  separate custody; it does not prove source entropy or rule out correlated
  derivation, so the approved vault/custodian process remains mandatory.
  Cross-surface actor, network-context and
  release-probe keys are deterministic, domain-separated HMAC derivations of
  the environment-owned idempotency root; only the derived values are sent to
  Timekeeping and Pages after maintenance. Other existing Worker-only secrets
  are inherited remotely and proved by name/presence plus functional
  contracts. Repository-scoped fallback, cross-environment copying, ad hoc
  generated production roots and secret values in logs/evidence are forbidden.
- Decision: the GitHub-hosted coordinator checks pilot login, password and
  cohort only by environment-owned secret name. It never hydrates their
  values. Login/password are consumed only by the approved self-hosted
  clinic-context SLO runner; the opaque cohort is validated only by the
  environment-scoped module-control transition that needs it.
- Impact: missing environment custody, an authorized Identity/Workforce pilot,
  the approved clinic-network runner, a required review, or a production
  enable flag blocks the next mutation while the live module stays
  fail-closed; none of those controls may be bypassed by the coordinator.

## 2026-07-15 - Keep the Windows WSL anchor on a native Linux working directory

- Decision: launch the single WSL keepalive client with `--cd /` and only reuse
  a process whose command line proves that native working directory.
- Why: inheriting `C:\Windows\System32` made the otherwise idle anchor report a
  DrvFS current directory, violating the final runtime contract even though no
  application state was read there.
- Impact: application services, the keepalive anchor and mutable runtime state
  have no working-directory dependency on `/mnt/c`; the Windows task remains
  the supported invisible lifecycle anchor.

## 2026-07-14 - Adopt direct domain roots and a single public API gateway

- Decision: use direct English product roots as defined in
  `docs/architecture/target-domain-map.md`; retain `shared`, `platform`,
  `ops`, `scripts`, `tools`, `docs` and `.github` as cross-cutting roots.
  `archive/` is not a destination for active or retired code.
- Decision: expose programmatic public routes only through
  `api.skincos.com.br/<domain>`. The gateway owns HTTP transport, request
  tracing and authorization envelopes, while each product owns its D1/R2 data,
  migrations and domain rules.
- Decision: migrate in independently reviewable waves. A path move does not
  authorize a service rename, runtime move, D1 migration, public route change
  or deletion. Each of those requires a checkpoint, CI and direct health
  evidence.
- Decision: Booking owns reservation state; `integration/ef` owns external
  browser/session execution; Orb orchestrates authenticated dispatch and
  recovery. The durable booking outbox is the recovery source, not a browser
  process or a best-effort webhook.

## 2026-07-14 - Enforce a compact shared-code and runtime-state footprint

- Decision: keep shared code and tracked documentation under
  `C:\CodexShared`, live runtime and durable operator artifacts under
  `C:\CodexRuntime`, and only mandatory Windows/Codex session state in the
  user profile. Retire the top-level n8n rollback clone and the atendimento
  recovery only after validating current runtime backup, active state, secrets,
  services, and health endpoints.
- Why: rollback copies outside the active runtime duplicated sensitive state,
  obscured the canonical source, and consumed substantial local storage.
- Impact: a worktree may be removed only after it is clean and integrated.
  `npm run codex:footprint:audit` is the recurring read-only audit surface;
  CI blocks new operational references to the retired roots. Codex-managed
  worktrees and active App caches remain out of cleanup scope until closed.

## 2026-07-13 - Split durable operator artifacts from local authentication state

- Keep Codex authentication, browser profiles, private environment overlays,
  temporary files and WSL keepalive state under `%LOCALAPPDATA%\Codex\skincos\`.
- Store durable project artifacts for the sole human operator under the private
  `C:\CodexRuntime\operator\admin\skincos\` runtime tree. This includes local
  logs, reports, debug exports, checkpoints, evidence and local backups.
- The transition keeps directory junctions only as compatibility pointers; they
  do not duplicate data and must not become an alternate source of truth.

## 2026-07-02 - Shared base lives outside user profiles

- Decision: use `C:\CodexShared` as the shared Codex workspace root.
- Why: avoids per-user profile isolation and avoids using the synced `G:` drive
  as the primary Git collaboration base.
- Impact: shared clones, worktrees, and continuity docs live in a neutral path.

## 2026-07-02 - Keep the original skincos checkout as legacy

- Decision: do not move or rewrite `C:\Users\julia\skincos`.
- Why: the legacy checkout carries local state, caches, and migration residue.
- Impact: new shared collaboration starts from the clean clone only.

## 2026-07-03 - Remove the old skincos checkout after shared validation

- Decision: remove the legacy `C:\Users\julia\skincos` checkout once the shared
  clone passed local shared-clone smoke checks and cross-account validation.
- Why: the old profile checkout is no longer needed for supported development
  and keeping it around creates ambiguity about which tree is authoritative.
- Impact: `C:\CodexShared\Projetos\skincos` becomes the only supported local
  code base; if the root folder remains temporarily locked by the current
  session, it should be deleted as soon as the handle is released.

## 2026-07-02 - Secrets stay out of the shared area

- Decision: no `.env`, `.dev.vars`, `.codex`, `.cloudflared`, cookies, or
  tokens may be stored under `C:\CodexShared`.
- Why: multiple local Windows users have access to the shared tree.
- Impact: local runtime execution needs a private overlay or private clone.

## 2026-07-02 - Shared clones need per-user Git trust bootstrap

- Decision: every local Windows user must register shared clones and worktrees
  under `git config --global safe.directory` before using them normally.
- Why: Git blocks commands with `detected dubious ownership` when the clone is
  owned by a different Windows SID.
- Impact: cross-account onboarding must include a short Git bootstrap step.

## 2026-07-02 - Shared clone origin must point to GitHub, not a local checkout

- Decision: the shared `skincos` clone `origin` must use
  `https://github.com/jubenitogarcia/skincos.git`.
- Why: a shared clone cannot depend on `C:\Users\julia\skincos` being present on
  another Windows user.
- Impact: remote validation and future push/pull work become account-scoped
  GitHub operations instead of local-path coupling.

## 2026-07-03 - Shared local CRM boot must be self-healing on a clean clone

- Decision: the shared local CRM launcher must repair first-boot gaps by
  generating the CRM web `dist/` when absent and by syncing only non-secret
  local auth toggles into the module-local `.dev.vars`.
- Why: a clean shared clone does not carry prebuilt assets, and the Pages local
  shell was failing in WSL even though the real issue was missing dist plus a
  `LOCAL_AUTH_BYPASS=false` default being left behind in `.dev.vars`.
- Impact: `npm run codex:crm:site-smoke` and
  `npm run codex:crm:meta-ads-smoke` now work directly from the shared clone
  without depending on the legacy checkout.

## 2026-07-03 - Fold the shared n8n workspace into the skincos monorepo

- Decision: treat `C:\CodexShared\Projetos\skincos\modules\automations\n8n` as
  the canonical shared
  n8n code root and retire `C:\CodexShared\Projetos\n8n` as an active project
  path.
- Why: the `skincos` repo is becoming the umbrella workspace for the clinic's
  subprojects and tools, and keeping n8n as a sibling clone preserves
  ambiguity about where the live automation code belongs.
- Impact: this historical intermediate layout was later superseded by the
  native release/state contract recorded on 2026-07-15.

## 2026-07-14 - Decommission the retired top-level n8n rollback clone

- Decision: remove the former top-level `C:\CodexShared\Projetos\n8n` rollback
  clone after confirming a fresh runtime backup, active state and secret
  equivalence, and healthy services/endpoints.
- Why: the live services already run from
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n`; a second source
  tree duplicated sensitive state and kept operational ambiguity alive.
- Impact: active automation work happens only from
  `skincos\modules\automations\n8n`; rollback is provided by Git history and
  the managed runtime backup contract, not a second local clone.

## 2026-07-03 - Adopt a modular envelope rooted at modules/platform/ops/archive

- Decision: reorganize `skincos` as a domain-first envelope with active product
  code under `modules/`, shared cross-cutting code under `platform/`,
  operational orchestration under `ops/`, and legacy material under `archive/`.
- Why: top-level technical roots like `backend/`, `frontend/`, and `n8n/`
  obscure business ownership and make the repo harder to navigate as the number
  of subprojects grows.
- Impact: new source-of-truth paths are module-centric, while `backend/` and
  `frontend/` become transitional roots to be emptied over time.

## 2026-07-03 - Move the first self-contained modules into the new envelope

- Decision: move the public website to `website`, the CRM
  API to `crm/api`, and the n8n automation workspace to
  `orb/engine` in the first migration wave.
- Why: these three blocks have clearer operational boundaries and reduce path
  ambiguity immediately without forcing a same-day rewrite of every remaining
  module.
- Impact: root scripts, local launchers, health checks, and systemd user units
  must resolve the new module paths; `frontend/`, `backend/apps/meta-ads`, and
  `backend/apps/whatsapp` remain transitional for later waves.

## 2026-07-03 - Complete the second envelope wave for CRM, Meta Ads, and WhatsApp

- Decision: move the CRM web app to `crm/console`, Meta Ads to
  `ads/meta`, and WhatsApp services to
  `messaging/channels/whatsapp`.
- Why: leaving those surfaces under `frontend/` and `backend/apps/*` preserved
  the same ambiguity the envelope was supposed to remove.
- Impact: root scripts, local launchers, health checks, capability maps, and
  shared workspace docs must now treat those module paths as canonical.

## 2026-07-06 - Run the live orb stack as machine-scoped system services

- Decision: the live Orb stack must run only from machine-scoped system units
  under `/etc/systemd/system`, with `User=skincos`.
- Why: the previous hybrid model mixed `systemctl --user`, operator-specific
  homes, and legacy `/etc/skincos` or `/srv/skincos` state, which blocked true
  multi-account autonomy.
- Impact: validators must reject operator-home, checkout and user-service
  execution. The later native lifecycle decision supersedes the intermediate
  Windows-mounted state/config locations.

## 2026-07-06 - Publish shared operational shortcuts in the common Start Menu

- Decision: install the Skincos operational launchers in
  `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Skincos Codex`.
- Why: the workspace and runtime are now machine-shared, so bootstrap,
  contexto, ambiente local, and runtime live actions must be equally reachable
  from every local Windows account without depending on `npm` in Windows.
- Impact: shared operators use the same PowerShell/WSL launchers for setup,
  worktrees, local QA, and live orb operations.

## 2026-07-07 - Version only the Codex App environment definition inside .codex

- Decision: allow only `.codex/environments/environment.toml` to be committed
  in the shared `skincos` repo and keep all other `.codex` content ignored and
  per-user.
- Why: the Start Menu shortcuts are already machine-shared, but the Codex App
  top-bar actions need one portable project contract that works in both the
  shared clone and per-user worktrees without leaking auth, cache, or session
  state.
- Impact: opening either the shared clone or a worktree in Codex App now loads
  the same project actions, while `safe.directory`, Codex login, WSL bootstrap,
  GitHub auth, and recent-project lists remain account-scoped.

## 2026-07-08 - Expose the Espaço Facial external app scraper through Codex actions

- Decision: publish Codex App and Start Menu actions for the
  `app.espacofacial.com.br` scraper, but route its outputs, logs, Chrome
  profile and private env files to `%LOCALAPPDATA%\Codex\skincos\espacofacial-app\`
  instead of keeping runtime state under the repo.
- Why: the scraper is operationally useful for the primary operator, but its
  default `report/`, `debug/` and `chrome_profile/` folders would otherwise
  keep mutable automation state mixed with shared code.
- Impact: the operator can run setup, self-test, agenda delta sync and booking
  API listener directly from Codex buttons without polluting the repository
  with scraper state.

## 2026-07-07 - Publish one shared runtime repair path instead of relying on a principal account

- Decision: expose `Orb Repair` as the canonical shared entrypoint for
  idempotent native layout, unit and health reconciliation.
- Why: the multi-account mini-PC model breaks when Postgres repair knowledge
  exists only in one operator account or one “principal” Codex session.
- Impact: Start Menu shortcuts, Codex App project actions and runbooks point to
  the same native repair flow, which reapplies the final units, restarts the
  runtime and runs local/public health validation.

## 2026-07-06 - Drain the last Orb user services from the human WSL account

- Decision: keep the human WSL user manager free of live Orb services and
  remove all residual user-scoped runtime units after machine-unit validation.
- Why: the shared mini-PC autonomy model breaks when the orb can still boot
  from `systemctl --user` instead of the machine-scoped `skincos-*` units.
- Impact: the live path is singular and rollback is an immutable prior release
  plus the private cutover checkpoint.

## 2026-07-06 - Move the runtime Cloudflare tunnel out of the checkout

- Decision: the runtime tunnel must read private config and credentials outside
  the repository.
- Why: the `cs` tunnel is a machine-scoped live service, so keeping its
  supported config under `/etc/skincos` preserved an unnecessary legacy root.
- Impact: the remaining legacy service convergence now focuses on
  `crm-api` and `booking-api`, while the `cs` tunnel already follows the shared
  runtime model.

## 2026-07-06 - Run CRM and Booking from controlled launchers

- Decision: CRM and Booking should use controlled launchers with config and
  writable state outside the repository.
- Why: leaving those support services on `/srv/skincos` and `/etc/skincos`
  preserved the same single-account coupling that the shared orb convergence
  was meant to remove.
- Impact: this intermediate shared-checkout model was later superseded by
  immutable native releases and native state roots.

## 2026-07-06 - Reapply support services with a shared installer

- Decision: the canonical maintenance entrypoint is the final lifecycle unit
  installer under `scripts/runtime`.
- Why: the shared mini-PC model needs one repeatable installer for
  `crm-api`, `booking-api`, and `cloudflared-cs` instead of ad hoc manual
  edits under `/etc/systemd/system`.
- Impact: future convergence renders units from reviewed source while active
  config/state stays on native Linux and durable evidence stays private.

## 2026-07-08 - Recover orb owner access in place instead of replacing the live instance

- Decision: recover `orb.skincos.com.br` owner access in place by backing up
  the live Postgres DB, clearing MFA for the existing owner row, issuing a
  temporary password only for recovery, and requiring an immediate manual
  password rotation in the n8n UI.
- Why: the live runtime already contained the correct owner account
  `julianbenitogarcia@gmail.com`; the failure mode was access recovery, not a
  missing owner or a need to replace the instance.
- Impact: owner access was restored without destroying workflows, credentials
  or projects; its private recovery evidence remains outside Git.

## 2026-07-08 - Keep the admin WSL runtime on a recovered per-user BasePath until elevated normalization is worth it

- Decision: keep the `admin` account's imported `Ubuntu-24.04` WSL distro
  registered at
  `C:\Users\admin\AppData\Local\wsl\{aa973afc-c57c-49d3-810d-ff364865ce84}`
  for now, instead of forcing an immediate move back to `C:\WSL\Ubuntu-24.04`.
- Why: the original registry path pointed to a missing VHD location, and the
  original shared VHD path required elevated ACL repair that was outside the
  available token in this session. Copying the VHD into the active profile
  restored WSL immediately and unblocked the orb recovery.
- Impact: shared orb operations work again in the `admin` account, but a later
  elevated maintenance pass may still normalize the storage path if a single
  canonical WSL VHD location becomes important.

## 2026-07-06 - Import the clinic orb flows into the live Postgres runtime and keep them inactive

- Decision: import `WORKFLOW_01..04` and the expected `n8n` credentials into
  the live `n8n_runtime` PostgreSQL metadata store, but keep all four clinic
  workflows inactive until the Google Calendar binding is manually verified.
- Why: the live Orb service uses PostgreSQL rather than the legacy
  SQLite file, and the recoverable Google OAuth export did not prove Calendar
  scope or provide the missing `GOOGLE_CALENDAR_ID`.
- Impact: the machine now has the clinic workflows, `wa_n8n` tables, and
  baseline credentials ready in the live DB, while activation and end-to-end
  smoke remain gated on final Google Calendar/OAuth review and test data.

## 2026-07-09 - Collapse the shared shortcut UX into seven domain launchers

- Decision: publish only seven top-level shared launchers in both the Codex App
  and the common Start Menu: `Workspace`, `Contexto`, `Local`, `EF App`,
  `Orb`, `EF App Caixa`, and `Orb Repair`.
- Why: the flat launcher list had grown large enough to make discovery and
  maintenance noisy, while almost every action already routed through the same
  shared PowerShell runner.
- Impact: the runner now owns interactive domain menus, new workflows can be
  added behind those menus without multiplying visible shortcuts, and the two
  direct favorites remain reserved for the most frequent and highest-impact
  operator actions.

## 2026-07-09 - Fold direct favorites back into the EF App and Orb menus

- Decision: remove `EF App Caixa` and `Orb Repair` from the top-level shortcut
  surfaces and keep them only as leaf actions inside `EF App` and `Orb`.
- Why: both actions were already first-class options inside their domain menus,
  so the extra top-level buttons added redundancy without improving coverage.
- Impact: the published launcher set is now `Workspace`, `Contexto`, `Local`,
  `EF App`, and `Orb`, while `EF App Caixa` and `Orb Repair` remain available
  through the same runner for internal routing and direct invocation when
  needed.
# 2026-07-11 - Single Windows/WSL operator with isolated service account

- Decision: `admin` is the only human Windows and WSL operator. Canonical paths
  remain under `C:\CodexShared` and `C:\CodexRuntime`; Linux `skincos` remains a
  non-interactive system-service identity.
- Why: the earlier multi-account model was retired, but moving canonical paths
  would add migration risk without improving isolation.
- Operational consequence: parallel Codex work uses worktrees, not additional
  OS users; execution persistence and backups are managed by system services.

## 2026-07-11 - Audit PostgreSQL-derived n8n runtime invariants

- Decision: validate and repair the `workflow_dependency` sequence and clear
  `activeVersionId` only from workflows already marked inactive.
- Why: the PostgreSQL migration preserved rows whose maximum dependency ID was
  ahead of the sequence and left five inactive workflows publish-linked. This
  caused duplicate-key errors and invalid activation attempts at every startup.
- Impact: `service:audit-executions` now blocks both regressions, while
  `service:repair-postgres-invariants` provides an idempotent checkpointed fix.

## 2026-07-11 - Anchor the WSL runtime from the Windows operator session

- Decision: keep `Ubuntu-24.04` alive with the per-user logon task
  `SkincosWslRuntimeKeepalive`, running `sleep infinity` as a non-privileged
  lifecycle anchor while Linux services continue under their own identities.
- Why: this host terminates the distro after Windows clients disconnect even
  while systemd units are enabled, causing cold starts and transient 502/1033.
- Impact: the orb stack remains resident between Codex actions and is still
  started and supervised by systemd after Windows logon.

## 2026-07-15 - Make the native Linux lifecycle runtime authoritative

- Decision: run the seven final units from immutable releases under
  `/opt/skincos/current`, with mutable state in `/var/lib/skincos-runtime`,
  private configuration in `/etc/skincos` and logs in `/var/log/skincos`.
- Why: recursive DrvFS access produced I/O stalls and tied production to a
  checkout/worktree. Windows-to-Linux archives plus atomic release links give a
  verifiable, reversible boundary.
- Impact: no active service depends on `C:\CodexShared`, `/mnt/c`, or a Codex
  worktree; source promotion and state transfer are separate controlled steps.

## 2026-07-15 - Support one WhatsApp engine and forbid application-driven host recovery

- Decision: retain only `messaging/channels/whatsapp/engine`; CRM delegates to
  it and may retry a bounded upstream request, but may not spawn an engine,
  execute Git, or restart host services through HTTP.
- Why: the retired variants were unconsumed, carried high-severity scanner
  findings and preserved several conflicting state/runtime contracts.
- Impact: old source trees, local gateway routes, dashboards, scripts, HTTP
  restart workflows and their GitHub credential are retired. Host recovery is
  an authenticated operator/systemd operation with rollback evidence.

## 2026-07-15 - Make Windows the owner of native Orb backup publication

- Decision: `orb-backup.service` creates and restore-tests its snapshot entirely
  under `/var/backups/skincos`; the Windows task `SkincosOrbBackup` starts that
  unit and publishes the verified payload through `\\wsl.localhost` to
  `C:\CodexRuntime\backups`.
- Why: WSL system services cannot reliably launch Windows transfer binaries and
  must not recursively traverse `/mnt/c`. The previous timer failed with an
  interop `Invalid argument` before producing a new backup.
- Impact: the WSL timer is disabled, Task Scheduler owns the daily schedule,
  both database and storage hashes are revalidated after the Windows copy, ACLs
  remain limited to SYSTEM and the operator, and only a restore-verified backup
  is eligible for retention.

## 2026-07-15 - Retire migration launchers and make the native contract singular

- Decision: remove user units, one-time cutover transfer helpers, applied
  workflow patchers and old platform launchers after native restart, public
  smoke and restore proof succeeded.
- Why: preserving runnable historical paths made it possible to reintroduce
  checkout execution, DrvFS state, conflicting service names or a second backup
  scheduler.
- Impact: Git history and the private cutover checkpoint preserve audit and
  rollback evidence; current operations use only the lifecycle installer,
  native runtime manager, release builders and Windows-owned backup publisher.

## 2026-07-15 - Keep only publication, evidence and restore checkpoints on Windows

- Decision: after the native runtime passed restart and public smoke gates,
  remove mutable service trees from `C:\CodexRuntime`; retain only verified
  backups, private operator evidence and `config\orb\publish-backup.ps1`.
- Why: duplicated Booking, CRM, WhatsApp, tunnel and Orb state on NTFS no longer
  had an active consumer and could silently revive the retired DrvFS contract.
- Impact: native state is authoritative under `/var/lib/skincos-runtime` and
  `/etc/skincos`. Windows owns transfer/publication only; the final lifecycle
  backup includes private configuration, snapshots and real PostgreSQL restore
  proof before the duplicate trees are deleted.

## 2026-07-18 - Make Workforce Timekeeping canonical and D1-backed

- Decision: own Controle de Ponto in `workforce/timekeeping`, expose it only through the public `api` gateway and use its D1 as the sole operational persistence.
- Why: the CRM-local JSON backend could not provide durable concurrency, canonical employee identity, period snapshots or enforceable cross-unit authorization.
- Impact: CRM is a same-origin client/proxy; legacy JSON is import-only, corrections preserve original events, Escala links require explicit aliases, and staging must pass before the guarded production workflow can run.

## 2026-07-30 - Bind Ponto pilot routing to one exact one-shot runner

- Decision: treat both root secrets as environment-only, reject repository
  duplicates, and admit a live Ponto cohort only after a complete runner
  inventory proves exactly one online/idle runner whose ID, name, four-label
  selector, JIT Ed25519 policy and RSA encryption key match the versioned
  policy. The protected preflight emits the selector consumed by `runs-on`.
- Why: environment variables are unavailable when `runs-on` is resolved, a
  homonymous mutable variable can shadow repository scope, and a generic or
  non-unique label set can schedule a different self-hosted runner after the
  cohort has already opened.
- Impact: the fourth label is a reviewed `ponto-jit-*` one-shot identifier;
  labels and encryption public key exist only as repository variables, are
  attested before cohort mutation and again before SLO scheduling, and missing,
  duplicated, shadowed, stale or incomplete custody remains fail-closed.

## 2026-07-29 - Make the Meta Ads publish contract singular and manual

- Decision: treat the tracked Meta Ads workflow export, all mapped Code-node
  sources, the Token Vault gateway, contract revision, migration, preflight and
  regression tests as one atomic contract. Production changes use a
  version-checked workflow apply and a separately versioned Worker deployment.
- Why: direct editor changes and independent worktrees had allowed the live
  workflow, gateway and repository to drift, causing a previously successful
  path to regress on a later manual run.
- Impact: `Meta Ads – Publish` remains inactive and manual; `WHATSAPP_MESSAGE`
  is paired only with the WhatsApp handoff URL, while unit appointment URLs are
  retained as references. A run is not considered closed merely because n8n is
  green: Drive, journal, locks, readback and notification delivery each need
  explicit evidence.

## 2026-07-29 - Keep Meta Ads notifications local and reconcile journal evidence-first

- Decision: replace the Meta Ads success WhatsApp community-node call with a
  direct HTTP request to the local Evolution API, using private, Meta-specific
  instance and recipient configuration. Preserve Telegram as a separate
  parallel notification branch. Record historical journal closure through an
  immutable event before updating a provable terminal state.
- Why: a CRLF-contaminated environment value and an external public endpoint
  caused an avoidable connection failure. Historical rows cannot be treated as
  completed merely because their locks expired.
- Impact: the notification has bounded timeout/retries and can be tested with
  a synthetic message without invoking the commercial workflow or Meta. Runs
  without staging are closed only when operations prove no activation; staged
  runs are closed only after a recorded read-only Graph lookup establishes the
  physical resource state.

## 2026-07-29 - Promote native Orb source only through a lineage-checked release

- Decision: promote the native Orb source from immutable archives only with
  `prepare-native-source-release.sh` followed by
  `promote-native-source-release.sh`; require the expected prior release SHA,
  private checkpoint and a no-active-publication drain before switching the
  `/opt/skincos/current/source` pointer.
- Why: this keeps the live process, proxy and application sidecars on one
  auditable source release and makes a pointer rollback independent from the
  shared Windows checkout.
- Impact: the 2026-07-29 promotion advanced
  `71ec3a8f63bd8fcaa6861ad1487baf6f1e1be59a` to
  `0c0a4fa0f4c2d0b432d449c0ba154e093b3ffe89` (including PRs #840/#844).
  The preparer grants `postgres` read/traverse access only to the immutable
  Meta Ads preflight surface, so the peer-authenticated audit can validate all
  49 Code nodes without exposing writable source or credentials.

## 2026-07-29 - Close Meta Ads audit only from terminal external evidence

- Decision: close the three historical staged runs only after their physical
  ads were read from Graph and found `ARCHIVED`; retain the original journal
  records, append a readback event and use `rolled_back` rather than deletion.
- Why: a staged job alone is insufficient to infer whether an ad was active,
  absent or safely recoverable.
- Impact: the journal now has no active/reconciliation state, while the full
  audit trail remains available. A current isolated WhatsApp delivery test must
  reach provider `DELIVERY_ACK`; HTTP acceptance alone is not closure evidence.
