# Current state

## Reconciliacao autoritativa — `origin/main` `01d2b6d1f79a9017e0a87efa2a1a32f82eed219f` — 2026-07-31T15:00Z

As PRs #933, #934, #936, #937, #938 e #939 estao integradas; o HEAD atual e
`01d2b6d1...` e o delta apos #933 e nao-Ponto. A branch
`codex/admin/ponto-single-operator-governance` contem a proposta ainda nao
mergeada para governanca `single-operator-codex`: main-only, PR canonica
mergeada, SHA imutavel, checks obrigatorios, sem bypass administrativo, sem
reviewer humano, custodia separada, WAF/broker fail-closed e rollback
automatico. Nao ha SHA final selecionado, nem preview/staging/pilot/canary ou
producao neste HEAD.

O estado remoto permanece fail-closed: staging e producao em
`module-control:timekeeping=maintenance`; os Workers e Pages observados nao
carregam este SHA; as migrations D1 0001--0008 existem nos dois bancos; o
emergency latch, broker, WAF customizado, runner JIT, identidade piloto e
custodias Ponto ainda nao foram comprovados/provisionados. Readiness 200 nao e
prova de jornada autenticada.

## Reconciliacao atual — `origin/main` `28747bb5109407856bd3cb700d91f7f3cb981a69` — 2026-07-31T14:37Z

Este bloco supersede qualquer afirmacao abaixo que trate `35aa17db...`,
`6894e0b...` ou uma PR aberta como estado atual. A PR #933 foi integrada em
2026-07-31T13:56:06Z com merge SHA `a70fe64...`; os checks hospedados da PR
ficaram verdes. A PR #934, que apenas restaurou a compatibilidade do gateway WSL,
foi integrada em `28747bb...` com checks verdes. A lista de PRs integradas apos
#815, incluindo #930/#931/#933/#934, foi revalidada no GitHub. As frentes independentes #736 e #764 continuam
abertas em modo draft: #736 head `76492a20cf0ec89cdacc25a9bccfb23b510beef5`
esta `DIRTY`, e #764 head `0b558f6815c4a5a8c3c23a7f15d0926d997e2f01` esta
`BEHIND`; nenhuma delas foi alterada nesta reconciliacao.

Financeiro: `experimental`, desativado (`module_enabled=false`), sem grants de
usuarios reais, sem piloto e sem recursos produtivos. A ultima cadeia completa
de staging e `ba16cb4a845e8f96032476a3a2828fc1fb22b399`: Worker
`30503675254`, UI `30503676485`, CRM Pages `30503679551`, canary
`30504263595` e identidade/smoke `30504380888`, todos concluidos com sucesso.
O run `30583405735` usou `35aa17db...` somente no Worker; o run
`30583462825` permanece waiting e nao ha UI/Pages/canary correspondente ao
`28747bb...`. Portanto nao existe uma promocao de staging do SHA atual.

Cloudflare confirmou, somente por metadados, D1 `skincos-finance-staging`
(`3059c887-76bf-4200-8d9c-6f02b8fa6d42`), KV de staging
`SKINCOS_FINANCE_STAGING_FLAGS` (`3013d687...`) e Pages
`skincos-finance-ui-staging`. A consulta de deployments do Worker
`skincos-finance` respondeu erro `10007` (Worker inexistente); a lista D1/KV e
de Pages nao contem os equivalentes produtivos. A configuracao versionada ainda
declara nomes/bindings, mas isso nao e prova de recurso live.

Rollback, kill switch, restore scratch Finance e restore offsite PostgreSQL
continuam comprovados apenas para os artefatos registrados, incluindo PR #908 e
`20260729T2255Z-postgresql-fresh`. O historico `audit returned 503` da run
`30168648150` foi um abort/canary antigo e nao e bloqueio atual; nao ha nova
reproducao no SHA `28747bb...`.

Observabilidade: o ledger de alerta humano e recuperacao permanece valido como
evidencia historica. O estado operacional atual nao e continuo: a instalacao
privada registra `operator-run-key`, nao ha Scheduled Task nem processo
`SkincosObservability*`, e `monitor-health.json` teve ultimo sucesso em
`2026-07-30T18:30:37Z`. A proxima acao segura e restabelecer e verificar o
supervisor externo; nao deve haver alegacao de monitoramento continuo ate entao.

Ponto: #930/#931/#933 estao integradas no `28747bb...`, mas os controles
fail-closed nao selecionam release nem fecham os gates externos. Broker/WAF,
runner, custodia de chaves e evidencia nova de staging continuam necessarios.
Insumos P0 permanece resolvido; Identity segue em modo de compatibilidade; os
demais modulos continuam nas maturidades do catalogo, sem promocao inferida por
health ou codigo integrado.

## Historical Ponto snapshot before PR #933 merge — 2026-07-31T13:46Z

The pre-merge wording below is retained for audit history only. PR #933 is now
merged as `a70fe64c87f2c09c96022c0b18b0b05c9d68d979`; the authoritative current
state is the reconciliation block above.

This entry supersedes the 2026-07-29 Ponto section below. The reconstruction
started from `origin/main` through PR #920 and was repeated read-only after PR
#921 at fetched `origin/main`
`aa9bfa6595b9cb12e7228f67f9606527bb375de2`, using GitHub
rules/environments/runs, Cloudflare Pages and Workers control-plane metadata,
Timekeeping D1 journals, Identity/Workforce aggregate eligibility and live
endpoints. PR #894 is merged as
`4a6d0cfced901c5297f76d141f5f7f1c18ea4a93`; PRs #912, #914, #916, #917 and
#919 are also integrated. The old statement that #894 remained open and the
old 29-path post-#886 inventory are revoked. Its three residual review
conversations were answered with the superseding technical-control evidence
in PR #921 and resolved; the fresh GraphQL count is zero unresolved.

PR #921 merged without bypass at
`aa9bfa6595b9cb12e7228f67f9606527bb375de2` on 2026-07-30T05:50:50Z.
Its final head `46cf79db11720a2fc05c62ef4b5b84c7015820e9` had all 19 observed
checks green, including required CI Smoke `30517538777`, Central E2E
`30517538830`, JS/TS `30517538808`, Dependency Audit and Gitleaks
`30517538755`, and Architecture `30517538750`, plus Timekeeping CI
`30517538752`, CodeQL and Semgrep. All eight review conversations were
answered and resolved. Six hardcoded synthetic test keys, one dynamic regex,
two unnecessary `secrets: inherit` edges and one direct workflow-input
interpolation were corrected; Semgrep alerts 4513–4515 became fixed. CodeQL
4519 was dismissed as a documented false positive because SHA-256
canonicalizes an HTTP body inside a one-time HMAC rather than storing or
verifying a password.

That merge is not currently dispatchable. The post-merge review found a
candidate-controlled checkout boundary in the reusable lease gate, privileged
production baseline/SLO workflows without their own single-use capabilities,
six omitted baseline provenance outputs, a physical CRM Pages concurrency race
and no immediate persistent emergency latch outside the long release-custody
queue. The corrective package is frozen and published in PR #933 from
`codex/admin/ponto-release-evidence-successor`, head
`48c23ad77b21c685ca470a87a59eb71a0e88c010`, based on current `origin/main`
`35aa17dbfe21f9b9a7571a786f03a56186e75fff`: trusted-main execution and exact SHA
verification precede lease consumption; production baseline/SLO have
independent leases; all seven baseline outputs are written; Pages mutations
serialize on the physical target; and manual fail-close gains a separate
emergency mutex, persistent latch, lease invalidation, run
cancellation/reconciliation, final `always()` reassertion and a governed reset
that stays in maintenance. The expanded package refuses coordinator and
privileged child reruns through `run_attempt==1`, revalidates the exact live
first-attempt coordinator immediately before every governed job hydrates
secrets or mutates, handles bodyless GitHub 202/204 acknowledgements in the
dispatch/cancellation helpers, serializes the three scheduled CRM Pages secret
writers under `ponto-release-custody`, and removes their dispatches to the
retired auxiliary Pages publisher. It introduces exact Ponto-only fail-closed
controls `ENABLE_PONTO_CRM_PAGES_DEPLOY`,
`ENABLE_PONTO_CRM_PAGES_DEPLOY_STAGING`,
`PONTO_CLOUDFLARE_PAGES_PROJECT`,
`PONTO_CLOUDFLARE_PAGES_PROJECT_STAGING`,
`ENABLE_PONTO_CORE_WORKERS_DEPLOY`,
`ENABLE_PONTO_TIMEKEEPING_PRODUCTION_DEPLOY`,
`PONTO_TIMEKEEPING_D1_STAGING_ID`,
`PONTO_TIMEKEEPING_D1_PRODUCTION_ID`,
`PONTO_MODULE_CONTROL_STAGING_KV_ID` and
`PONTO_MODULE_CONTROL_PRODUCTION_KV_ID`; the consuming controls are on PR #933
and remain unprovisioned/unenabled.
General Pages still uses `CRM_PAGES_PROJECT` /
`CRM_PAGES_PROJECT_STAGING`.

The proposed emergency state is a separate
`module-control:timekeeping:emergency-latch` overlay. Missing, unreadable,
malformed or `latched=true` denies; only exact schema-v1 `latched=false`
permits progression. The governed reset is the sole false writer and leaves
ordinary module-control in maintenance. Direct mutations share
`ponto-surface-mutation`; a terminal coordinator watchdog writes the monotonic
true latch before that mutex with narrow emergency custody, then reconciles and
reattests regular maintenance. Because it still depends on terminal
`workflow_run` delivery, GitHub Actions, the external broker and its downstream
Cloudflare control plane, it is not an independent external recovery system.

The current local design replaces direct Cloudflare/KV emergency credentials
with a target-specific external close-only broker. Each
`ponto-emergency-{staging,production}` environment requires
`PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL`,
`PONTO_EMERGENCY_CLOSE_BROKER_URL`,
`PONTO_EMERGENCY_CLOSE_CUSTODY_REF` and
`PONTO_EMERGENCY_CLOSE_MODE=external-close-only-broker-v1`, with distinct
custody references. The emergency environments are live but contain only the
mode variable; broker URL, custody reference and credential are unprovisioned,
so emergency mutation remains fail-closed.

The broker source now requires more than environment variables: the exact HTTPS
URL, custody reference, response key ID and Ed25519 SPKI PEM public key must be
pinned per target in
`.github/governance/progressive-release-policy.json`. Requests are authenticated
with a fresh policy-bound HMAC over request identity, nonce, time and digest;
responses require a fresh Ed25519 attestation bound to that request and the
response digest. However, all four policy fields are `null` for both staging and
production. There is no reviewed broker endpoint or response key for either
target. Staging remains blocked until a reviewed decision fixes those identities
and authorized custody provisions the endpoints, credentials and keys.

The PR #933 corrective package also adds two fail-closed contracts. First, Pages
validates the release-probe HMAC before Identity access; v2 binds pilot/canary to
stage, coordinator run and workflow run, while v1 is staging-only. Pages then
uses a server-signed actor through private Ponto Core to consume the external
nonce once at Timekeeping using a single UNIQUE D1 insert. The unique key is
target + release + SHA-256(nonce), so another body or concurrent PoP cannot
select a second acceptance. Core supplies the exact Timekeeping affinity.
Second, receipt of a login cookie marks a possible Identity session: teardown
always revokes the known current session or falls back to logout, then requires
the stale cookie to receive the canonical 401 from `/auth/me`. An indeterminate
teardown fails and preserves the primary probe error without including
credentials or PII.

These contracts passed targeted local tests and an independent local security
read found no residual P0/P1 in that six-file scope. The branch freeze is 30
changed files (730 additions and 1,602 deletions), with corrective
`commit_sha=48c23ad77b21c685ca470a87a59eb71a0e88c010` in PR #933. Hosted checks,
valid independent review and merge remain pending; `selected_release_sha` is
still null. The emergency overlay, watchdog, automatic rollback and manual
broker kill switch remain explicitly non-operational: broker policy and keys, a
clinic runner and independent external freeze/recovery proof are absent.

The local watchdog is intended to close a rerun of the canonical coordinator
only after integration and broker provisioning; it is not current automatic
recovery. Historical child workflow reruns still execute their original
definitions, so new source guards cannot retroactively rewrite them. The seven
exact rerunnable
Timekeeping production runs are `30420024733`, `30132172442`, `30132009676`,
`29966286110`, `29959858249`, `29757475250` and `29700295125`; run
`30420024733` predates the guard. CRM Pages run `30491926800` is already
`run_attempt=2`; and the repository inventory found zero Ponto progressive
coordinator runs. The 30-day Actions inventory found 835 Pages secret-sync
runs, 121 Workers secret-sync runs, 35 Timekeeping runs, 83 Core runs, 113 CRM
Pages deploy runs, seven module-control runs and one production-baseline run.
The proposed reconciliation covers correlated children even if their coordinator
became terminal and is designed to rescan/inactivate a late-issued capability,
but that behavior is not hosted or live evidence. Historical child
definitions must remain externally fenced through expiry. The new protections
are published on PR #933 and remain pending only hosted checks, independent
review and canonical merge.

The checkpointed GitHub environment-variable containment and staging fence were
complete at
2026-07-30T06:57:00Z after
private checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T035009-03-production-replay-containment.md`.
The production environment now overrides `ENABLE_CRM_PAGES_DEPLOY=false`,
omits `TIMEKEEPING_D1_PRODUCTION_ID`, and preserves
`ENABLE_CORE_WORKERS_DEPLOY=false`; `CLOUDFLARE_PAGES_PROJECT` points to
deliberately nonexistent `skincos-ponto-fenced-production-20260730`. Staging
now overrides `ENABLE_CORE_WORKERS_DEPLOY=false` and
`ENABLE_CRM_PAGES_DEPLOY_STAGING=false`, omits
`TIMEKEEPING_D1_STAGING_ID`, and points `CLOUDFLARE_PAGES_PROJECT` plus
`CLOUDFLARE_PAGES_PROJECT_STAGING` to deliberately nonexistent
`skincos-ponto-fenced-staging-20260730`. Both module-control KV variables were
intentionally preserved. No Cloudflare Worker, Pages deployment, D1 database,
binding or live runtime changed. The post-change recheck still found production
in maintenance, staging active and Pages health HTTP 200. The checkpoint
contains the exact conditional rollback, which is forbidden until
first-attempt protections and the permanent legacy-run control are integrated
and authorized.
This fence blocks known dispatch inputs; it is not an independent external
automatic freeze or recovery service.

The subsequent scheduled external production Ponto Smoke, run `30521686413` at
2026-07-30T07:04:44Z, failed on all five attempts: proxy target and actor
configuration were visible, but every observation remained `ready=false`.
That confirms the external monitor detects the intended fail-closed
non-readiness; it is not a successful production SLO. Earlier Ponto UI Smoke
run `30518888970` succeeded, but it is neither an authenticated authorized-user
journey nor proof that consultants can use Ponto.

The legacy hourly Ponto UI smoke is now externally contained. Checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T072614-11-legacy-ponto-ui-smoke-disable.md`
records workflow `Ponto UI Smoke (prod)` id `231059578` moving from active to
`disabled_manually`, with no in-progress run. Repository secrets
`PONTO_SMOKE_EMAIL` and `PONTO_SMOKE_PASSWORD` and variable
`ENABLE_PONTO_UI_SMOKE` were removed by name without reading their values. This
stops scheduled reuse, but does not identify or revoke the historical CRM
GESTOR account; that identity remains an external reconciliation blocker.

The legacy backend smoke is now contained separately. Checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T075100-15-legacy-ponto-smoke-disable.md`
records `Ponto Smoke (prod)` id `230950805` moving from active to
`disabled_manually`. Scheduled run `30536124024` on
`aa9bfa6595b9cb12e7228f67f9606527bb375de2` had correctly waited at the
hardened production environment and was cancelled, reaching
`completed/cancelled` at 2026-07-30T10:54:19Z. The current-main workflow still
declares that protected environment for a read-only unauthenticated health
probe; the local successor removes it. Re-enable only after that successor is
reviewed and merged. No secret, identity, flag, deployment or database changed.

GitHub environment admission is also hardened after checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T073000-12-environment-protection-before.md`.
Staging required-reviewer rule `61302994` / custom branch policy `56015291`
and production rule `61303000` / policy `56015293` enforce
`can_admins_bypass=false`, `prevent_self_review=true`, zero wait and branch
`main` only. The sole reviewer is repository owner `jubenitogarcia`
(`199169872`), which blocks the current owner actor and historical credential
hydration but does not create an independent reviewer or valid release
approval. Repository collaborator inventory contains only that owner. The
observed `GITHUB_TOKEN` has
`can_approve_pull_request_reviews=false`, and no authorized GitHub App, bot or
automation approver was proved.

Checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T073300-13-emergency-environments-before.md`
records creation/readback of `ponto-emergency-staging` and
`ponto-emergency-production`: protected branches only,
`can_admins_bypass=false`, no reviewers/timer/custom rule, branch-policy rule
IDs `61303367` / `61303369`. GitHub returned 422 only when
`prevent_self_review=false` was sent without a reviewer; the safe base exists.
Each has zero secrets and only
`PONTO_EMERGENCY_CLOSE_MODE=external-close-only-broker-v1`; URL, custody ref and
credential are absent. The reviewed-policy identity fields URL, custody ref,
response key ID and Ed25519 SPKI PEM are also all `null` for staging and
production, so the broker path and staging progression are fail-closed.

Checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T074500-14-ponto-resource-variables-before.md`
then recorded that all seven dedicated non-secret repository resource variables
were absent before creation. The six Ponto-specific KV, Pages and D1 identifiers
plus `CLOUDFLARE_ZONE_ID` were independently verified against live Cloudflare,
created and individually read back by name. Their exact values remain in the
private checkpoint. This is configuration metadata only: it did not enable an
`ENABLE_PONTO_*` flag, select a release SHA, restore a legacy fence, deploy a
surface, mutate D1/KV or satisfy any missing secret/WAF-rule/pilot/reviewer gate.

Staging was then closed through canonical main workflow run `30527767707` on
`aa9bfa6595b9cb12e7228f67f9606527bb375de2`; jobs `90822614084` and
`90822665436` succeeded. Artifact `8753392021`,
`module-transition-timekeeping-staging-maintenance-30527767707`, is retained
until 2026-10-28 with digest
`sha256:09de66aad85d0df5fec416917becd87a5aa3004542af8a4ed4bf34ef74244612`.
Private checkpoint
`C:\CodexRuntime\operator\admin\skincos\ponto-release\checkpoints\20260730T084146-06-staging-maintenance-before.json`
records the prior staging control as absent. At
2026-07-30T08:43:14.511Z the remote KV readback was schema v2
`maintenance`; edge health returned `ok=false/ready=false`,
`source=control`, and `/me` returned 503. Production remained maintenance.
This proves canonical fail-close, not candidate lineage, staging success or
authorized use.

The complete upstream delta after PR #886
`10b2197731d0210cf8fc8cd961f7a787d73bf650` through the observed main contains
58 commits, 30 first-parent commits and 109 unique pre-control paths: 33 added,
76 modified and none deleted. It includes eight Ponto-exclusive paths, five
ledgers, 27 Finance, six shared/multidomain, eight Orb/n8n, five
Livia/native, 13 website/Meta/WhatsApp, one observability and 36 CRM Local
paths. The path-by-path source of truth is
`docs/project-state/ponto-post-886-delta.json`; some shared files have multiple
labels even though every path has one primary classification. Its
deterministic PR #921 supplement adds 85 classified paths (72 governed Ponto
release controls, eight ledgers/runbook and five local operator safeguards),
with 15 overlaps. The union through merge `aa9bfa65` covers the complete
current post-#886 interval: 59 commits, 31 first-parent commits and 179 net
paths (77 added, 102 modified, none deleted).

Private Ponto Core bootstrap publication is complete and independently
attested. PR #919 workflow run `30512105626` executed on control SHA
`e50385144408c96fbcf919bbe1f3fdc7da4b9e1d` using the reviewed PR #912 source
`0f3480dce1a170ac0f862fa392a95456af292a88`. Staging artifact `8747521765`
attests deployment `d88aa85e-a90b-4fd0-b03b-14bf4c6fc248` and version
`0ee7a2fe-deff-4f37-bcda-c35ad54b68f3`; production artifact `8747532031`
attests deployment `96aba9e3-fb02-48b4-bc38-ef6a7187328a` and version
`487f3c03-0159-4914-8d79-470fd1ef209d`. Both are at 100%, route-only, bound
only to their environment-specific Timekeeping service and have zero Worker
routes/custom domains with `workers.dev` and preview URLs disabled.

The staging CRM Pages baseline is also isolated: preview run `30508476617` and
staging run `30508502488` succeeded for source
`32d5de056788761893aa4025282f0cfa3bcde66c`; deployment
`ee5ab6dd-4bba-48da-96ea-38fa686f8691` serves the immutable
`https://ee5ab6dd.skincos-staging.pages.dev` deployment in project
`skincos-staging` and aliases `https://crm-staging.skincos.com.br`.

PR #921 integrates an initial set of technical release
controls across Timekeeping, private Ponto Core, Identity/Inventory and CRM
Pages: exact current-main `GITHUB_SHA`, ordered predecessor evidence, version
affinity, zero-default-traffic pilot/canary with protected Pages bucketing,
network/identity/unit grants, WAF precondition, additive migrations and
checkpoints, authenticated synthetic staging journey, audit-preserving
teardown, external SLO, child-run reconciliation, exact mutation ownership,
opaque within-environment and cross-environment root separation, pilot
credential hydration restricted to the approved self-hosted runner, automatic
interruption and four-surface rollback. The cataloged Core bootstrap and the
complete production rollback baseline are consumed, verified and pinned before
the first staging/pilot mutation; an arbitrary active incumbent no longer
satisfies the gate.

The historical 2026-07-30T05:57:00Z live snapshot was split and none of its surfaces ran
`aa9bfa6595b9cb12e7228f67f9606527bb375de2`:

- staging is `module-control:timekeeping=active`; Timekeeping is deployment
  `0447e8a9-77fd-4ef0-b858-705110738fff` / version
  `d6e60024-bb67-48da-91b1-4d7e16ee31ba`, Core API is
  `2bcb5e4a-0d84-46c5-b59a-9c6d2114d310` /
  `20e271ba-4130-46f1-9176-d7ca18891a38`, Identity/Inventory is
  `767bd21d-47b5-48de-b26e-80f55e2b113d` /
  `3f39463a-927c-4f16-96d2-b8f376fce816`, and CRM Pages is deployment
  `ee5ab6dd-4bba-48da-96ea-38fa686f8691` from
  `32d5de056788761893aa4025282f0cfa3bcde66c`;
- production is `module-control:timekeeping=maintenance`; Timekeeping is
  deployment `ff33f1a3-8de6-4879-8a6a-2c65f3f7fa9f` / version
  `0da32d7c-6d6f-4b54-a538-6b7c642e57de`, Core API is
  `a4d62169-10af-4a9b-8960-bc785ccd37a4` /
  `a1d6ddb0-905d-4784-9e77-d1231cd75e90`, Identity/Inventory is
  `1aadfff5-de94-4e7d-a7e4-8d781328a038` /
  `4bb6a932-05ba-44a9-aea3-5f139b31abca`, and CRM Pages is deployment
  `a77cf500-f272-4d37-87c2-c02f78352c4e` from
  `f30f66e70e0dc949adde5120378509a1c95fe557`.

The listed deployments/versions remain the last observed split, but the
current module state supersedes that snapshot: canonical run `30527767707`
closed staging, so both staging and production are now maintenance.

Both remote Timekeeping D1 journals contain exactly `0001`–`0008` (8/8), the
same complete named set present in the repository, so no named migration is
pending in this snapshot. This is schema-state evidence, not candidate lineage.
The live Timekeeping `workers.dev` endpoint is still public despite the current
source declaring it disabled. Production `/api/ponto/readiness` still returns
`200/ready=true` during maintenance. Public probes using each forbidden Worker
version-selection header returned 200, while
`/insumos/health/workforce-contract` returned 401 rather than the required
edge-generated 403; therefore the required WAF enforcement was not observed.
This does not establish whether an inaccessible custom rule object exists. The
zone ruleset listing exposed only managed rulesets, and the custom entrypoint
GET was not authorized for the available principal.
The Codex in-app browser and the existing Chrome profile both reached only the
Cloudflare login screen, with no authenticated dashboard session; no credential
was entered and no mutation was attempted. Rule inspection/attestation remains
blocked for the current principal; the post-merge security-token workflow must
prove the state. Aggregate Identity/Workforce reconciliation found zero
eligible production pilots.

No final candidate `preview`, complete staging journey, pilot, canary or
production release has run. The coordinator accepts only its exact
`GITHUB_SHA` on the then-current `main`; if main advances between stages, the
chain must restart at preview. `selected_release_sha` remains null, and no
preview may start until the local P1/P2 package is reviewed and merged.
Production remains explicitly
`module-control:timekeeping=maintenance` from run `30496220685`, with
`ENABLE_CORE_WORKERS_DEPLOY=false`, the production CRM Pages override false and
the Timekeeping production D1 variable absent. Staging is now module-control
`maintenance` from run `30527767707`; Core and CRM Pages deploy are disabled,
its Timekeeping D1
variable is absent and both Pages project variables are fenced to the
deliberately nonexistent staging project. This is containment/freeze, not a
completed release.

Run `30496220685` changed only the production Timekeeping module-control target
to `maintenance` as an emergency fail-close containment. The contemporaneous
ledger does not contain a separate pre-production approval package for that
configuration mutation, so it is recorded as a policy exception rather than
normal release authorization. Its validation was the externally observed
`503/MODULE_MAINTENANCE` on the authenticated module path; residual risk was
the incomplete readiness contract. Although the source fix is present in
`main`, it is not on the split live Timekeeping deployment: production
readiness still reports ready during maintenance. The decision is to
preserve—not repeat or broaden—that safe state under the current explicit
instruction. This exception cannot authorize `active`, a deploy, a grant, a
secret change or any later production mutation.

The first remaining blocker is the reviewed integration of the local P1/P2
corrective package described above. The subsequent blockers are external
authorization/configuration, not a reason to loosen source guards:
`PONTO_PROFILE_DATA_KEY` is absent by name from both
GitHub environments. The required target-environment secrets
`PONTO_ROOT_ATTESTATION_KEY_SHARED`,
`PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY` (distinct Ed25519 signer per
target), `PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY`, and per-environment
`PONTO_PROFILE_DATA_KEY_CUSTODY_REF` /
`PONTO_IDEMPOTENCY_KEY_CUSTODY_REF` inputs are also absent. The repository must
hold only public/non-secret `PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON` and
`PONTO_ROOT_ATTESTATION_KEY_ID`; no private capability, root-attestation or
Pages-intent secret may fall back to repository/emergency scope. The keyed
attestation proves exact-byte non-reuse under one effective audit-key version
and carries producer run/artifact provenance, but cannot replace approved vault
custody or prove entropy/correlation. Repository-only
`PONTO_WAF_READ_API_TOKEN` and production-environment-only
`PONTO_WAF_WRITE_API_TOKEN` are unprovisioned; no
`CLOUDFLARE_SECURITY_API_TOKEN` fallback is allowed. Repository variable
`CLOUDFLARE_ZONE_ID` is present by name after checkpoint 14, but
`PONTO_WAF_RULESET_ID`, `PONTO_WAF_HEADER_RULE_ID` and
`PONTO_WAF_CONTRACT_RULE_ID` remain absent and the custom rule state is
unverified; production
lacks the approved pilot login/password/cohort and runner/canary variables;
the repository has zero self-hosted runners; and no Identity/Workforce pilot
designation is evidenced. The GitHub `staging` and `production` protections now
fail closed as described above, but their sole owner reviewer cannot self-review
and no independent collaborator/reviewer is available. The only collaborator is
that owner, `GITHUB_TOKEN` cannot approve pull-request reviews, and no authorized
app/bot approver was evidenced. PR #921's
`required_approvals=0` is code governance only, not deployment or pilot
approval; no administrator bypass may substitute for separation of
responsibility. `PONTO_IDEMPOTENCY_KEY` exists by name in both environments.
Secret values were not read. Until those prerequisites are provided through
their approved processes, the successor PR is created/reviewed/merged and the
ordered chain passes,
consultants are not authorized to use Ponto in production.

## Finance — fresh PostgreSQL offsite restore proven; pilot still disabled — 2026-07-30T00:13Z

The private, sanitised drill `20260729T2255Z-postgresql-fresh` completed a
fresh authenticated retrieval of the 90,908,667-byte PostgreSQL ciphertext
from the provider-separated Google Drive vault. Its ciphertext SHA-256
`fe11d31fbf0d0ef9d8f78dcc4bff31bb3b2621fc9a92779dc5e018283e884f4a` matches
the offsite manifest; HMAC verification and plaintext-manifest comparison
passed. PostgreSQL 16.14 was restored only in isolated scratch in 55.43 s,
with 58 tables, zero unvalidated foreign keys and sanitised logical checksum
evidence. Plaintext and scratch were destroyed; production was untouched.

This closes the fresh offsite PostgreSQL recovery gate that remained open after
the current-main Finance staging canary. Finance remains `experimental` and
disabled: no production Worker, D1, KV, UI project, grant, cohort or
`module_enabled` change exists. The next permitted action is to present the
already-versioned pilot package for named human approval; production
provisioning remains a separate explicit authorization.

## Inventory production provenance and Identity PII custody correction — 2026-07-30T00:13Z

Fresh read-only reconciliation used `origin/main`
`3868c79ac3bfb9fd98f8bf90be16648e35728c59`, GitHub Actions, Cloudflare
metadata and aggregate D1 queries. PR #787 is documentation/queue-only. The
current Inventory release is instead the immutable
`RELEASE_SHA` `f30f66e70e0dc949adde5120378509a1c95fe557`: canonical production
Core Worker run `30420719000` and CRM Pages run `30420793906` both received
that explicit input, verified the staging predecessor and checked out that
exact commit. Their workflow revision was `2f0bba6…`, but the intervening
delta changes neither `inventory`, `identity` nor `crm/console`; it is not a
second product artifact.

The currently serving Inventory deployment is Cloudflare deployment
`4bb6a932-05ba-44a9-aea3-5f139b31abca`; active CRM Pages deployment
`a77cf500-f272-4d37-87c2-c02f78352c4e` declares source `f30f66e…`. Inventory
health remains `200`/`ready=true`, CRM health remains `200`, and the remote
D1 migration journal reports no migrations to apply. The resolved Insumos P0
therefore remains closed; this audit did not dispatch a workflow or mutate a
secret, flag, user, grant or business record.

This audit corrects the obsolete zero-payload assertion in older historical
sections below. Aggregate, read-only production D1 evidence now finds three
onboarding rows, three encrypted personal-email values, three encrypted phone
values and one encrypted invite token. `IDENTITY_PII_KEY` exists by name in
both GitHub environments and on the active Inventory Worker; its value was not
read. Inventory encrypts and Identity decrypts a shared SHA-256-derived
AES-GCM key with a random 12-byte IV and the `v1.<iv>.<ciphertext>` contract.
Custody remains **case 5**: no external escrow/custodian or rotation record is
currently evidenced. Do not generate, replace, copy or rotate the key. An
authorized Identity security owner must first register the external recovery
reference and a dual-key re-encryption/rollback procedure. This blocks key
rotation and recovery assurance, not the already-resolved Insumos release.

## Finance — current-main staging lineage and canary passed — 2026-07-29T23:54Z

`origin/main` `c277032db96ba96484522a19994a66cbb323a46d` is the current
Finance staging candidate. Candidate `30500613099`, Finance Worker/UI/CRM Pages
preview `30500694945`/`30500696857`/`30500698417`, and staging
`30500732310`/`30500734160`/`30500735957` all used that explicit SHA. Finance
Worker staging completed its encrypted pre-migration checkpoint, additive
migration step, immutable version deployment and Worker smoke through its
canonical workflow.

Synthetic canary `30500922386` passed against that lineage. The authenticated
journey covered login/session, bootstrap, scope and negative authorization,
Finance health/readiness, import stage/analyze/decision/preview/commit,
idempotent replay, conflict, audit and compensating undo; the independent UI
and shell smoke also passed. The canary decision recorded Finance p95 426 ms
(limit 1000 ms), zero errors and zero authentication, journey, data,
audit or dependency failures. Its finalizer restored the non-enabled staging
baseline and the temporary synthetic grant. The standalone 503 from the prior
canary did not recur. A non-Finance `/api/instagram/status` 503 was observed in
the browser console but did not affect Finance responses or the shell result.

Finance remains `experimental`, `module_enabled=false`, without production
resources, user grants or pilot activation. The only technical gate before a
pilot-package review is a fresh provider-separated PostgreSQL retrieval and
isolated scratch restore; named human approval and separately authorized
production provisioning remain subsequent gates. The older Finance section
below is retained as historical audit trail and is superseded where it conflicts
with this section.

## Workforce Timekeeping release — source integrated; production fail-closed — 2026-07-29T22:29Z

PR #886 integrated the Ponto source remediation into `main` as
`10b2197731d0210cf8fc8cd961f7a787d73bf650`, with required checks green. It
restored exactly `atendimento` and `ponto` for CONSULTOR/EMPLOYEE while keeping
server-side authorization, added the synthetic authenticated staging journey,
made `PONTO_PROFILE_DATA_KEY` mandatory, and stamped Worker health with release
SHA/environment. This proves integrated source only; it is not a deployment.

The complete delta from that merge to the freshly fetched `origin/main`
`6642487142e4de30cf27ae337da60d9f7f64449c` contains 29 files and is
classified as follows:

- Finance, 17 files (PRs #891, #890, #895 and #898):
  `.github/scripts/finance-production-preflight.mjs`,
  `.github/scripts/validate-deploy-topology.mjs`,
  `.github/workflows/deploy-finance.yml`,
  `crm/console/modules/RemoteFinanceModule.tsx`,
  `crm/console/vite.finance.config.ts`, migrations `0007`, `0008` and `0013`,
  `finance/package.json`, both staging smoke scripts, the Worker release smoke
  and five Finance tests.
  The shared topology validator change enforces the Finance preflight; it does
  not alter the Ponto publishers.
- Orb/n8n release watch, 8 files (#888/#896): the qualification document,
  scheduled workflow, `audit-release-baseline.sh`,
  `release-watch-policy.json`, three tests and `watch-stable-release.sh`.
- Livia QA accessibility, 2 files (PR #897): `qa-runner.js` and its test.
- Native Livia release preparation, 2 files (PR #892):
  `prepare-native-source-release.sh` and its test.

No file in that delta directly changes the Timekeeping runtime/migrations,
Ponto gateway routes or the three canonical Ponto publisher workflows. The
prior assertion that the delta was only one Finance file was false and is
superseded. The immutable promotion gate accepts any full SHA reachable from
`main`, so ancestral `10b21977…` remains technically eligible; it is not the
final candidate because the governed pilot/canary controls still need a
reviewed source change. No final release SHA is selected yet.

The progressive policy requires `preview → staging → pilot → canary →
production` and currently marks Core Workers, CRM Pages and Timekeeping
pilot/canary blocked by absent version affinity, gradual routing, pilot cohort
configuration and external SLO interruption evidence. The executable publishers
offer only preview/staging/production, so the policy predecessors are not
enforced; Core deploy also defaults a missing gate to enabled
(`${ENABLE:-true}`), and the Timekeeping checkpoint is named with the dispatch
SHA instead of the selected ancestral release SHA. CRM Pages has no
Ponto-specific production gate. These are release-control defects, not
documentation-only blockers. The production Core API config also binds
`FINANCE` to nonexistent Worker `skincos-finance`; a prior API promotion failed
with Cloudflare `10143` before upload. Ponto therefore needs a governed
gateway-only release path that does not require or advance Finance. The production
`ENABLE_CORE_WORKERS_DEPLOY` value was therefore restored from `true` to
`false` at `2026-07-29T22:17:37Z`; staging remains `true`. No workflow was
dispatched by either variable change.

`PONTO_PROFILE_DATA_KEY` remains absent by name from accessible GitHub
staging/production secret metadata and both deployed Timekeeping Workers.
The Cloudflare account's only Secrets Store is empty, so it is not an approved
source for this key.
`module-control:timekeeping` remains absent in staging. Production was moved
from the same implicit default to an explicit `maintenance` state by canonical
workflow run `30496220685` at `2026-07-29T22:28:04Z`; the prior absent-key
state is the recorded rollback checkpoint. Production health now reports
`ok=false`, `ready=false`, `availability=maintenance`, and `/api/ponto/me`
returns `503/MODULE_MAINTENANCE`. The separate readiness endpoint still returns
200/ready and must be fixed before release because it ignores module
availability. Existing version fields still attest only the incumbent
`1.0.0/unknown`, not #886 or a later candidate. Aggregate Identity/Workforce
inventory found one active, unit-scoped staging Core CONSULTOR but zero active
staging Workforce CONSULTORs (the only staging employee is a terminated
SUPERVISOR). Production has zero active Core CONSULTOR/EMPLOYEE; its one linked
CONSULTOR onboarding/hierarchy pair is INVITED and the employee is on LEAVE,
so eligible active pilot count is also zero. The dedicated Ponto smoke account
is a GESTOR automation identity, not an authorized consultant pilot. No PII was
read or recorded.

Current deployed lineage is split. Production Timekeeping is 100% on Worker
version `0da32d7c-6d6f-4b54-a538-6b7c642e57de`, Core API is on
`a1d6ddb0-905d-4784-9e77-d1231cd75e90`, and CRM Pages deployment
`a77cf500-f272-4d37-87c2-c02f78352c4e` still identifies source `f30f66e…`.
Staging Timekeeping is on `d6e60024-bb67-48da-91b1-4d7e16ee31ba`, Core API on
`bc80ab45-c8c8-4742-9109-7e336303dd4d`, and Pages deployment
`2bd3d04d-30df-4d2b-9832-8e0da69151b1` identifies `c64bc546…`. More critically,
the staging Pages proxy resolves its canonical default to the production API
and reports `actorKeyConfigured=false`; it is not a safe staging journey
surface until the isolated proxy configuration is corrected and verified.

The secret layout is also not independently isolated yet. Besides the missing
profile key, several Ponto runtime secrets resolve from repository scope rather
than environment overrides; production and staging can therefore inherit the
same value. A release must migrate all Ponto secret names to independent
environment custody without exposing or copying their values.

No candidate preview/staging deployment, D1 write, migration, KV transition,
authenticated candidate journey, pilot, canary or production promotion has
occurred. Historical Ponto records below remain historical only.

## Authoritative Finance reconciliation — 2026-07-29T14:02Z

This entry is the authoritative Finance status for `origin/main`
`6963ba0495870e8f9b15a0b1e81477dd5f7f3f8b`. Older entries below remain an
audit trail; they do not prove a later deployment or replace the facts in this
section.

**Integrated:** PR #815 is merged at `32bf3ebb296ca95e3273bb4fed664480eb5642e5`
and is an ancestor of the current `main`. Its import state machine is present:
only a persisted `decision=import` on a valid row contributes to preview and
commit, a completed batch rejects a new key with `IMPORT_ALREADY_COMMITTED`,
replaying the same key is idempotent, and undo is compensating/audited.

**Staging:** Finance Worker preview/staging runs `30168426616`/`30168445270`
and Finance UI runs `30168426575`/`30168445288` attested `32bf3ebb…`. Direct
reads now return `200`, `ready=true`, healthy D1/module-control dependencies
and version `32bf3ebb…`; the D1 journal has migrations `0001`–`0012` and
`finance_settings.module_enabled=false`. The currently deployed Finance
Worker is immutable version `51bd6fa4-d775-43e4-96c3-6fbe0cec8513`; the
independent UI Pages deployment also reports source `32bf3eb…`. This is a
healthy, disabled staging baseline, **not** a current-main single-SHA release:
the staging API reports `2ba1e0a7…` and the general CRM Pages project reports
`f30f66e…`.

**Recovery and observability:** staging rollback run `30143185583`, remote-KV
kill-switch runs `30143674681`/`30143742671`, and the isolated Finance scratch
restore are valid historical proof of rollback, kill switch and restore. The
outside-GitHub Windows monitor is currently live through the `SkincosObservability`
Run-key supervisor; its loopback dashboard `/health` and `/metrics` returned
`200` at this reconciliation, with 30-day retention and a recorded controlled
human desktop alert/recovery. This closes the monitor-infrastructure blocker,
but it does not make a later Finance artifact observed.

The `audit returned 503` canary result in run `30168648150` is historical:
that run stopped, restored its baseline, and failed the promotion as designed.
Fresh direct Worker/gateway probes and the continuous monitor currently return
healthy Finance responses; there is no current observation of that `503`.
It remains a resilience finding, not a current deployment blocker.

**Production:** direct Cloudflare read-only queries confirm that
`skincos-finance` does not exist. There is no production `skincos-finance` D1,
Finance control KV namespace, Finance UI Pages project, Worker secret, Worker
version, artifact or applied Finance migration. The production API's `FINANCE`
binding remains configured for that absent Worker; Core API run `30418523054`
therefore failed before upload/smoke (Cloudflare `10143`). Production API
`/health` is reachable, while `/readiness` is `404` and `/finance/health` is
`401`; none is Finance production proof. Production environment configuration
also lacks the four Finance-specific names required by the canonical workflow:
`FINANCE_D1_PRODUCTION_ID`, `FINANCE_CONTROL_PRODUCTION_KV_ID`,
`FINANCE_BACKUP_PASSPHRASE` and `FINANCE_SERVICE_AUTH_SECRET`.

**Open gates:** first create a new immutable candidate from the current main,
then run the canonical Finance Worker/UI preview and staging paths and complete
the synthetic authenticated import/UI journey against that one SHA. The
offsite PostgreSQL recovery gate remains blocked: D1 offsite restoration and
runtime-config retrieval are evidenced, but the large PostgreSQL object has
not been freshly retrieved from the provider-separated vault (IPC limit and
unauthorized alternate path). A named pilot approval follows only after those
staging gates. Production provisioning is a separate, explicitly authorized
change; no production resource, flag, grant, user, secret or data was changed
by this reconciliation.

## Finance production provision — blocked before workflow dispatch — 2026-07-29T11:21Z

The versioned architecture is unambiguous: the production Finance Worker is
`skincos-finance`, its production D1 database is `skincos-finance`, and the API
production service binding targets that Worker. The current staging release
`32bf3ebb296ca95e3273bb4fed664480eb5642e5` is an ancestor of `origin/main` and
the canonical Finance preview (`30168426616`) and staging (`30168445270`) runs
for that SHA succeeded. Fresh staging Finance health and readiness both returned
HTTP 200 with `ready=true`.

Production provisioning did not start. The GitHub `production` environment
lacks `FINANCE_D1_PRODUCTION_ID`, `FINANCE_CONTROL_PRODUCTION_KV_ID`,
`FINANCE_BACKUP_PASSPHRASE`, and `FINANCE_SERVICE_AUTH_SECRET`; the repository
flag `ENABLE_FINANCE_PRODUCTION_DEPLOY` is also `false`. Therefore the canonical
workflow would fail its required resource/secret guards before it can create the
encrypted D1 checkpoint or apply a migration. No workflow was dispatched, no
Cloudflare Worker/D1/KV/binding/secret was changed, no migration ran, and no
Finance production artifact or version exists. Production API `/health` remains
HTTP 200; protected Finance routes return 401, which is not Worker Finance
health evidence.

The 12 Finance migrations were reviewed. They contain no table/data deletion;
`0008_finance_draft_revision.sql` replaces three guard triggers atomically, so
it is a schema-guard replacement rather than data-destructive DDL. Before a
future canonical production run, an authorized operator must provision and
verify the isolated production D1/KV resources and the four GitHub environment
configuration items through the approved platform path. A follow-up PR should
add a read-only Finance production preflight that attests those resource IDs,
secret presence, Worker existence, and the migration plan before dispatch.

## UX/UI PR #832 — Semgrep hosted scanner alignment and isolated rerun passed — 2026-07-29T04:35Z

The hosted `Semgrep OSS` scanner did not honor the preceding-line form of the
scoped loopback rationale, although the local CLI did. The rationale now sits
on the one `fetch` line it exempts; the endpoint and JSON-RPC assertions remain
unchanged. The exact local Semgrep scan remains green. To avoid an unrelated
CRM Local Vite process already bound to host port 5173, the final clean ext4
WSL clone ran in an unprivileged private network namespace with its own
loopback; no parallel process was stopped or used as a test target. The
canonical `audit:ui:full` passed from 04:31:33Z to 04:34:35Z with components,
four pilots, axe, four versioned visual comparisons and Lighthouse. Reports
are local disposable evidence only; no process/listener from this validation,
snapshot update, secret, production access or deployment remains. PR #832
stays draft pending the hosted scanner and the remaining remote checks.

## UX/UI PR #832 — Semgrep loopback finding remediated and rerun passed — 2026-07-29T04:15Z

GitHub Advanced Security reported one `Semgrep OSS` error on the local
Storybook MCP checker: a generic rule interpreted its fixed
`http://127.0.0.1:6006/mcp` request as unencrypted external traffic. The
endpoint is constrained to the locally spawned Storybook process; the existing
documented `nosemgrep` rationale was moved to the exact `fetch` line instead
of the indirect call site. A clean WSL Python virtual environment ran the
same `semgrep scan --config auto --error` target with zero findings. A
disposable ext4 WSL clone at `fdc520c8` then used clean sequential root, CRM
and website lockfile installs plus Chromium only: the direct Lighthouse run
produced HTML/JSON, and `audit:ui:full` passed from 04:12:19Z to 04:14:50Z
for components, four synthetic pilot viewports, axe, the four visual baselines
and Lighthouse. No snapshot update, tolerance change, production access,
secret, account, deployment or product UI change occurred. The PR remains
draft until GitHub reruns and completes remote checks on the corrected head.

## UX/UI PR #832 — second main sync clean; remote checks restarted — 2026-07-29T03:53Z

While the first remote-check run was in progress, `origin/main` advanced to
`2f0bba6ab5df9c09bc3171e190189991a3891052`. It was merged into
`codex/admin/ux-ui-infrastructure` as `1e30fc0df34151e6aa70007bc27c6f0ca523ee9a`;
there were no conflicts and the merge contains only the upstream
`deploy-core-workers.yml` addition. `git diff --check` passed and the
three-dot PR diff remains limited to the UX/UI infrastructure, its versioned
baselines and the related documentation. This branch does not activate or run
that deployment workflow, and no deployment, production access, secret or
product change occurred. The PR remains draft while GitHub recomputes the
checks against this head.

## UX/UI PR #832 — main sync resolved and local suite passed — 2026-07-29T03:48Z

`origin/main` at `1a6650d9c0598d810dca97e778d7adf3e0bd25d7` was merged locally
into `codex/admin/ux-ui-infrastructure` as `04e217fbc3fe5f9119a0cb86a291d9c04f920f98`.
The only conflicts were the shared project-state documents; both the current
main records and UX/UI evidence were retained, with JSON parsing and
`git diff --check` passing. A clean disposable ext4 WSL checkout of the merge
commit then passed `npm run audit:ui:full` from 03:45:33Z to 03:47:43Z:
components, four synthetic pilot viewports, axe JSON, four visual-baseline
comparisons and Lighthouse. No snapshot update, product change, deployment,
secret or production access occurred. This is local validation of an
unpublished merge resolution; PR #832 remains draft until remote checks and
review state are observed again.

## UX/UI infrastructure audit — reproducibility rerun passed — 2026-07-29T03:32Z

After the LHCI Linux-profile and Storybook MCP protocol corrections, a second
disposable ext4 WSL clone repeated the clean lockfile installs and Chromium-only
browser install. The directly affected LHCI baseline and Storybook MCP
Inspector checks passed first. The integrated `audit:ui:full` then passed from
2026-07-29T03:26:33Z to 03:30:43Z: components, all four synthetic pilot
viewports, all four axe JSON results, all four versioned visual-baseline
comparisons and Lighthouse HTML/JSON. CRM typecheck passed; lint completed
with 0 errors and 96 pre-existing warnings outside this infrastructure scope;
Storybook build and `npm audit --omit=dev` (0 vulnerabilities) also passed.
No visual tolerance, assertion, dependency, snapshot, product UI or external
endpoint was changed. The native clone and its generated artifacts are
disposable local evidence only; no validation-owned process remains.

## UX/UI infrastructure audit — final WSL-native validation passed; local remediation pending commit — 2026-07-29T03:14Z

The complete diff from `origin/main` merge base
`b1afd84b9191841d1f4bc28497f70b3755375d70` to published PR head
`5f1bbe75a6072c7da3b55643ab82e9363a0b4c8c` was reviewed before any new
commit or PR action. Two confirmed local-only policy gaps were corrected only
in this worktree: Playwright and Lighthouse now reject non-loopback targets,
and UX request interception prevents network access outside the local harness.
The four visual references were regenerated from that local synthetic state.
The final validation used a disposable ext4 WSL clone at
`/home/admin/skincos-ux-final.vewq2s`, copied only the reviewed source overlay
(never `node_modules`), then ran clean sequential `npm ci` installs from the
root, CRM and website versioned lockfiles. Node 22.23.1, npm 10.9.8,
Playwright 1.58.0 (Chromium only), axe 4.12.1, Storybook 10.5.4, Lighthouse
13.0.3, LHCI 0.15.1 and MCP Inspector 1.0.0 were used. JSON/config parsing,
`git diff --check`, `tools:doctor`, CRM typecheck/lint, components,
`audit:ui:full` (four pilot, four axe JSON and four visual comparisons),
Lighthouse HTML/JSON, LHCI baseline, Storybook build, Storybook MCP
initialize plus Inspector `tools/list`, and `npm audit --omit=dev` all passed.
The LHCI WSL configuration now pins a temporary Linux Chrome profile so
chrome-launcher does not select a Windows profile; it does not add score gates.
No snapshot update command was run, and no local validation Vite, Storybook,
Lighthouse or Chromium process remained. No production URL, deployment,
credential, secret, account, business data, workflow save or configuration
outside the repository was changed.

PR #832 is local-only evidence until its remote checks and review complete.
GitHub and Figma MCP OAuth remain manual/unproven exactly as documented; no
manual authentication was claimed or performed.

## UX/UI audit infrastructure — draft PR #832 — 2026-07-29T01:34Z

The infrastructure-only UX/UI foundation is committed on
`codex/admin/ux-ui-infrastructure` and published as draft PR #832. Its
original base was `c70c85bbdce7d7724cf9e29ac80d167e9c86980e`; it was merged
non-destructively with the then-current `origin/main`
`b1afd84b9191841d1f4bc28497f70b3755375d70` before push. The PR contains
synthetic local Playwright/axe/visual/Lighthouse and LHCI baselines, Storybook
a11y/MCP support, a non-blocking path-filtered workflow, ignored artifacts,
and operator documentation.

In a clean native WSL checkout, `npm run tools:doctor`,
`npm run audit:ui:full`, `npm --prefix crm/console run storybook:build`,
`npm run storybook:mcp`, and `npm run audit:lighthouse:ci` passed. The full
audit covers one Testing Library component test plus four desktop/tablet/mobile
projects each for the synthetic pilot, axe results and visual snapshots; no
production endpoint, account, secret, database, workflow, deployment or
business data was changed. This is **local-only plus PR-open** evidence, not
integration, staging or production evidence.

## Observability independent audit — 2026-07-29T03:30Z

A fresh read-only audit confirms that PR #833 remains integrated in `main`, the local monitor matches clean integrated descendant `62ff7875…`, and the operator runtime has one Run-key supervisor, one dashboard child, and a healthy loopback dashboard. The monitor-policy suite and catalog validation passed again: alert after two failures, recovery after two healthy runs without a popup, 900-second cooldown, 30-second desktop expiry, retention, probe mutex, and watchdog deduplication/cooldown are covered. The real controlled drill still records a delivered alert and a no-popup recovery; no later notification was emitted.

Fresh staging reads keep API health/readiness and gateway Finance health/readiness at HTTP 200. The API reports release `2ba1e0a74eea8a88a5cdb609ba426c8df2c94261`; Finance reports live/current, healthy D1/module control, and no artificial 503 in three rounds. Preview `30417971117`, staging `30418027776`, and attempted production run `30418523054` were all dispatched with that release SHA; production is not a deployment of it. The production API health read is HTTP 200, while production readiness is 404 and Finance safe reads are 401 from the pre-existing API. Those authorization responses prove no unauthenticated Finance data exposure, but do not prove a functional Finance production journey.

The production workflow is terminal, not pending: it failed before version publication or smoke because `FINANCE` references absent Worker `skincos-finance` (Cloudflare 10143). This cannot be corrected by retrying the API-only flow: the governed Finance production path may create a D1 checkpoint and apply migrations, actions excluded from this release authorization. Keep the private reinstall checkpoint and promotion artifacts. Do not declare the release fully promoted or the thread archive-ready until that prerequisite is explicitly authorized and a new immutable production promotion succeeds.

## Meta Ads Publish closure audit — 2026-07-29T03:00Z

PR #840 merged the canonical workflow and Token Vault contract as
`11417df9e362f82337882a4b57e87c98b1a21547`; its required checks were green.
The live workflow `eFJhFg79lyaycjlm` is inactive/manual at version `825`
(`4ec178e3-bc9d-4ed6-b481-eb9015777b2e`) and the Token Vault production Worker
is deployment `beba53d9-67f3-495b-a002-5dc579463c29`. The live preflight is
green and confirms synchronized sources/contracts without a Meta mutation.

The native Orb service source release still resolves to
`71ec3a8f63bd8fcaa6861ad1487baf6f1e1be59a`, an ancestor that predates PR #840.
The preflight was intentionally run read-only from the canonical source against
the live n8n database, so it proves workflow-definition synchronization but not
that the runtime release itself is at `main`. Native promotion is a separately
tracked, explicitly authorized production gate.

Manual execution `333` is persisted as `success` (2026-07-28T13:33:57-03:00
to 13:38:07-03:00). It resumed and completed journal run
`map_f6a59341d6dace99d70f5533`: visual grouping, video upload, creative
validation/readback, staging, activation, Drive finalization and completion all
recorded success. The resulting active ads are BarraShoppingSul
`120247386191180157` (creative `1011986138341232`) and Novo Hamburgo
`120247386191560157` (creative `1400344355311942`). The persisted contract is
WhatsApp / `WHATSAPP_MESSAGE` with `https://api.whatsapp.com/send`; booking
URLs are retained as unit references and not used as a conflicting destination.

This is not a global journal closure: final-run locks are released and no
active lock exists, but the production journal still has historical nonterminal
`acquired`, `processing` and `staged` rows. Telegram notification delivery was
recorded; the WhatsApp notification node returned an error. Both are tracked as
P1 in `TASKS.md` and must be reconciled with idempotent readback before this
workstream can be archived.

## Meta Ads Publish operational closeout — 2026-07-29T11:45Z

The live definition is version `830` (`b22ba74a-4fc9-428e-aa4e-41aebfd5b3f0`)
and remains inactive/manual. The success notification now sends through the
local Evolution HTTP endpoint with private Meta-specific instance/destination
settings; the previous CRLF contamination was removed. A synthetic isolated
send was accepted and then persisted by the provider as `DELIVERY_ACK`.
Telegram remains the independent parallel branch. No workflow execution,
commercial file or Meta API mutation was used in this test.

The D1 journal audit correlated all 49 prior nonterminal runs with jobs,
operations, events and locks. It wrote a durable audit event per run, changed
46 provably pre-stage failures/abandonments to `failed`, and classified the
three staged runs as `reconciliation_required`. The current distribution is
1 archived calibration, 52 completed, 54 failed and 3 reconciliation-required,
with zero active locks. The three residual runs and required read-only Graph
lookup are listed in `orb/engine/docs/meta-ads-publish-historical-run-audit-2026-07-29.md`.

## Observability alert hardening operational closeout — 2026-07-29T03:06Z

PR [#833](https://github.com/jubenitogarcia/skincos/pull/833) is the source
change for the Windows alert correction and merged to `main` as
`2ba1e0a74eea8a88a5cdb609ba426c8df2c94261`.  The later installer guard
repair is integrated on `main` as `62ff787554f67a0d1ea2f40a40543b52b2054263`;
the local monitor therefore runs the descendant that contains the requested
release and its self-supervision fix.

The canonical Core API promotion was immutable: preview
`30417971117` and staging `30418027776` both used release SHA
`2ba1e0a74eea8a88a5cdb609ba426c8df2c94261` and source tree
`6beae5048890803e0fa8b3894eb69cb5eee0f9de`.  Their sanitized promotion
artifacts are retained privately at
`C:\CodexRuntime\operator\admin\skincos\evidence\observability-api-promotion\preview-30417971117\promotion-evidence.json`
and
`C:\CodexRuntime\operator\admin\skincos\evidence\observability-api-promotion\staging-30418027776\promotion-evidence-core-api\promotion-evidence.json`.
Staging API `/health` and `/readiness` returned HTTP 200 with the requested
SHA; the gateway Finance `/health` and `/readiness` also returned HTTP 200,
with dependency `live`, module `active`, sync `current`, and healthy D1/module
control.  Two later four-endpoint rounds remained HTTP 200 (0.174–0.615 s).
The local observer recorded the same staging Finance health/readiness as
healthy, with no post-promotion notification spam.

Production run `30418523054` used that exact release SHA, `unit=api`,
`staging_run_id=30418027776`, and `bootstrap_finance_context=false`.  The
promotion gate passed, but Cloudflare rejected the API upload before a Worker
version, artifact, or automatic smoke existed: error `10143` says the
`FINANCE` service binding references missing Worker `skincos-finance`.  The
release is therefore **not deployed to production**.  Existing production
API `/health` remained HTTP 200, but its old Finance path returned 401 and is
not evidence of this release.  No D1 migration, inventory/all deployment,
binding, secret, or business-data change was made.  Resolving the external
prerequisite requires the separately governed Finance production path, which
would create a D1 checkpoint and may run Finance migrations; it must not be
started without explicit authorization.

Validation included the merged PR's required CI/security checks, catalog
validation, 16 API gateway tests, deterministic monitor policy tests, the
staging HTTP/latency reads above, and a real controlled desktop drill.  The
final drill persisted an alert after two failed probes with
`human_notification_delivery=windows-message-delivered`, then a two-probe
recovery with `human_notification_delivery=not-applicable`; it produced no
recovery popup.  Windows Event Log registration remains unavailable in the
non-elevated `operator-run-key` session, so that secondary delivery channel
reports failure without affecting the delivered desktop alert.

The local runtime is healthy in `operator-run-key` mode: its scripts match the
clean `62ff7875…` source, exactly one supervisor owns one dashboard child, and
loopback dashboard `/health` is HTTP 200.  Baseline Finance staging reads are
healthy.  Preserve
`C:\CodexRuntime\operator\admin\skincos\checkpoints\observability-reinstall-20260728T234648Z`
and the earlier hardening checkpoint.  For a local-monitor rollback, restore
the preserved private runtime checkpoint and restart the Run-key supervisor,
then verify loopback `/health`.  No production API rollback is needed because
no new production version was published; any future source rollback must be a
reviewed revert PR followed by the same immutable preview/staging/production
promotion chain.

## Observability alert hardening — 2026-07-29T02:23Z

The desktop-alert correction is integrated on `main`: PR #833 merged as
`2ba1e0a74eea8a88a5cdb609ba426c8df2c94261`, and the installer fallback repair
in PR #836 merged as `34c9baff3978df71402b917449b6971a914b1110`. The final
installer self-process guard and evidence update merged in PR #839 as
`62ff787554f67a0d1ea2f40a40543b52b2054263`. All applicable CI, test and
security checks were green. The operator runtime was reinstalled from a clean
worktree matching that final integrated SHA in `operator-run-key` mode at
02:23Z. `installation.json`, the Run key, one
supervisor plus one dashboard child, and loopback `/health` prove the active
local runtime; the preserved rollback checkpoint is
`C:\CodexRuntime\operator\admin\skincos\checkpoints\observability-alert-hardening-20260728T2052Z`.

The policy requires two consecutive non-healthy probes before an alert and two
healthy probes before resolution. Desktop recovery notices are disabled,
desktop alerts have a 15-minute per-unit/environment cooldown, and `msg.exe`
expires after 30 seconds. The integrated controlled drill produced one desktop
delivery on its second failure, a persisted recovery with
`human_notification_delivery=not-applicable`, and a cooldown-suppressed second
incident. The watchdog/probe mutex and deterministic tests cover concurrent
invocations and watchdog deduplication. Finance probe requests now have a
three-second service-binding deadline so a valid slow response is classified as
latency degradation; genuine Finance 503 responses remain degraded.

Canonical API promotion used preview run `30414699651` and staging run
`30414749763`, both for immutable SHA `2ba1e0a7…`. Production run `30414808715`
stopped before upload or smoke: Cloudflare rejected API binding `FINANCE`
because production Worker `skincos-finance` does not exist (error 10143). Thus
the API timeout fix is deployed to staging but **not** production; production
API health remains reachable, but is not proof of this release. No D1 data,
secrets, bindings, Finance Worker or business data were changed. The remaining
action needs an explicit production Finance resource/binding decision; do not
retry the same API promotion until that prerequisite is satisfied.

Direct post-promotion reads prove staging API `/health` is HTTP 200 at
`2ba1e0a7…`, and staging `/finance/health` is HTTP 200 with D1/module-control
healthy. Production API `/health` is HTTP 200, while its existing
`/finance/health` path returns 401; neither result proves the blocked API
release or a production Finance journey.

## Fresh runtime-config verification — 2026-07-25T05:05Z

The fresh provider transfer of the encrypted runtime configuration was
successfully verified with the versioned restore script from `origin/main`
(`3071cb95f60d6f91f6b26b201f5f4935e5667155`). The 82,011-byte ciphertext
passed HMAC/AES verification and its decrypted plaintext SHA matched the
offsite manifest (`224236f91f2009974403aabdca33f11cf62e480a1539c7cd363281a05a15d7fc`).
The archive was inspected only for entry names; plaintext was destroyed after
the check. No secrets or archive contents are recorded in the repository.

This closes only the fresh runtime-config leg. The 90,908,667-byte PostgreSQL
object is still blocked by the connector's 64 MiB IPC frame limit and the
alternate provider path remains unauthorized. No fresh PostgreSQL bytes were
transferred or restored, so Finance stays `experimental` and its offsite
backup/restore gate remains open.

## Offsite retrieval retry — 2026-07-25T04:55Z

The provider-separated Drive folder and four recovery objects remain present
and accessible by metadata: `20260724T0620Z-manifest.json`, D1, PostgreSQL and
runtime-config ciphertexts. A fresh connector download of the PostgreSQL object
returned a provider file reference, but a raw fetch exceeded the connector IPC
frame limit (121,214,224 bytes versus 67,108,864). A second direct streaming
attempt using the private `drive.file` rclone credential could not list the
folder, and the direct API token path returned HTTP 403. No bytes were written,
decrypted, restored, uploaded or deleted by these attempts; temporary private
credential copies and the empty output file were removed.

The local encrypted ciphertexts still match the prior manifest evidence, but
that is not a fresh offsite transfer. Consequently the Finance backup gate is
still **unproven** for PostgreSQL/runtime-config transfer. Do not promote or
activate Finance on this evidence. The smallest safe resolution is an
authorized Drive service account or provider-approved streaming path that can
retrieve the two large objects in chunks, followed by hash verification and a
scratch restore.

## Orchestrator continuation audit — 2026-07-25T04:44Z

The attached production-cycle instructions were re-read and reconciled against
fresh source and live evidence. Remote `main` is
`88891143420372fac5024f4ca95f181443cb54ad`; its push checks for architecture,
CI smoke, security/secrets, coverage, lint and Central E2E all completed
successfully in runs `30144394332`, `30144394336`, `30144394341`,
`30144394342`, `30144394346`, `30144394349` and `30144394352`. The local
checkout remains the unrelated dirty `codex/admin/content-studio-v2` branch;
its changes were not used or modified.

The Inventory reconciliation from the attached text is superseded by the
direct evidence already recorded here: PR #787 itself changed only
documentation and the orchestration queue, while the runtime delta from the
old `cb04cb8…` candidate includes the executable `c64ff2b…` D1/environment and
Identity compatibility changes. The sole authorized production release remains
`c64ff2b6655ce9e035a1b3a3840b1d6d809a9c2d`. Production Core Worker run
`30137182608` checked out that SHA, applied the additive migration and created
Worker version `6d7dadc6-7b02-4577-b8b3-d1d4a09cd9ef`; read-only D1 migration
status is `No migrations to apply`. Pages run `30137826907` used the same SHA
and active deployment `e65832a0-5925-4212-b252-2ff20cd08362`.

Fresh probes returned Inventory `/insumos/health` HTTP 200 with `ready=true`
and CRM HTTP 200. The protected `/insumos/readiness` and `/insumos/version`
paths returned 401 without an authenticated session, so deployment metadata and
health are the available unauthenticated evidence. No production deploy,
secret, user, grant, flag or business-data mutation was executed in this
continuation.

`IDENTITY_PII_KEY` is referenced by the canonical current-main Core Worker
workflow through the environment-scoped secret and is forwarded to the
Inventory Worker; its name is present in GitHub `staging` and `production` and
in the Worker secret listing. Values were not read. Production onboarding and
encrypted personal-data payloads remain zero in the prior read-only D1 evidence,
but external custody/escrow, recovery owner and rotation record remain
unproven (case 5). No new key was generated or copied.

The P0 Insumos production cycle is therefore evidenced as stable by the prior
release, authenticated smoke and rollback checkpoints. The current safe state
is to keep Finance frozen: its current-main rollback/restore drill is valid, but
offsite PostgreSQL/configuration retrieval, continuous external alert evidence,
single-SHA authenticated UI/import smoke and nominal pilot approval remain open.

## Finance current-main rollback and scratch restore — 2026-07-25

The current main SHA after PR #807 is `68f88e070629e4077a1a1754b3347e60dc89be18`.
The Finance candidate exercised in staging was the immediately preceding
main SHA `b869485b6a33fae5a5dbe504b41660f842fb4ca9`; it was promoted through
the canonical Worker preview/staging runs `30143039262`/`30143051826`, then
rolled back by `30143185583` to the known reachable immutable SHA
`8af1d5fe9551891a05a104363043bf3d36fb4ef4` (Worker version
`97c7a7da-6a78-44a8-b980-2cc2810df7a0`). The earlier active staging version
pointed at an unreachable local SHA and was rejected by the rollback guard;
that rejection is retained as a safety finding. No production target was
selected and no unrelated module was published.

The Finance UI was independently built and staged from the same candidate SHA
(`30143580303` preview, `30143594297` staging, Pages artifact evidence
`8615284211`, module URL returned HTTP 200). Because the Worker was intentionally
left at its rollback target while the UI remained at the candidate, staging is
currently a rollback-exercise state, not a pilot-ready single-version release.

The corrected remote-KV kill-switch workflow is PR #807, merged as
`68f88e070629e4077a1a1754b3347e60dc89be18`. Its controlled staging run
`30143674681` wrote the disabled state to the remote namespace (the prior run
proved only local KV and is not valid evidence). After propagation, Finance
health returned `ok=false`, readiness false and `MODULE_DISABLED` returned 423
while the CRM shell stayed HTTP 200. Run `30143742671` restored the active
state; health then returned 200. The observed propagation delay was roughly
one to two minutes and is now an explicit operational limitation.

An isolated scratch restore used the candidate Worker source SHA and a synthetic
Finance actor. The staging D1 export was 53,101 bytes with SHA-256
`a24db616e94e156c7da5a26a319094b210e7c078a80df11ce0648bea36c9692a`.
Before the synthetic exercise, counts matched the source (settings 1, scopes 3,
grants 1, accounts 0, movements 0, journal 0, audit 13, migrations 12).
The authenticated functional journey passed health, readiness, bootstrap,
read-only account/category queries, cross-unit denial (403), synthetic create,
compensation and audit. Only two synthetic audit rows were added; no production
data or sessions were touched. The R2 sentinel round-tripped with SHA-256
`e8e08acced00c3c414b3d167fe5958b672acce3352c795ec4e118d9776f981ef`, KV readback
was active, and the scratch D1 post-exercise export was 55,070 bytes with SHA-256
`082188fec4cd48bce08ff2a73c8104acb181f6c2c94239d4ae3d7f9c767b34ca`.
The measured checkpoint-to-functional-smoke interval was 16 minutes. Scratch
Worker, D1, KV and R2 were destroyed after evidence capture; the sanitized
private record is
`C:\\CodexRuntime\\operator\\admin\\skincos\\finance-recovery-drills\\20260725T-current-main-b869485b\\restore-evidence.sanitized.json`.

This closes the current-main staging rollback and scratch-restore exercise, but
does not unlock the Finance pilot. Fresh offsite retrieval of the large
PostgreSQL/runtime-config objects, continuous external human alert evidence,
authenticated UI/import smoke against a single promoted SHA, and named pilot
approval remain required. `module_enabled` and real grants remain unchanged.

## Inventory release reconciliation and `IDENTITY_PII_KEY` audit — 2026-07-25

Fresh source-of-truth check is based on `origin/main`
`fe0ccbee28ad36e0444937a553a8c11cb48112d8` and the production/staging
metadata available at 2026-07-25T03:26Z. PR #787 itself contains only
`docs/project-state/current-state.md`, `docs/project-state/evidence-ledger.json`
and `ops/project-orchestration/work-queue.json`; it does not change Inventory,
Identity, CRM frontend, Pages build inputs, migrations, bindings or executable
deploy configuration.

The historical candidate `cb04cb8b8ca87353c4c672fa5707bf2d5a9fcecb` is not
the current release candidate because it precedes the executable
`c64ff2b6655ce9e035a1b3a3840b1d6d809a9c2d` change that selected the D1 by
environment and the subsequent onboarding compatibility changes. The unique
authorized `RELEASE_SHA` remains `c64ff2b6655ce9e035a1b3a3840b1d6d809a9c2d`:
the current-main delta after that SHA contains only workflows, preflight,
Finance, orchestration and evidence documentation, with no Inventory/Identity
runtime, migration, binding or deployable Pages artifact changes.

The production workflow logs prove the same immutable SHA for both units:
Inventory run `30137182608` checked out and deployed `c64ff2…` after staging
run `30135788180`; CRM Pages run `30137826907` built with `VITE_BUILD_SHA` and
`GIT_SHA` equal to `c64ff2…` after staging run `30135788135`. Current active
metadata is Inventory Worker version
`6d7dadc6-7b02-4577-b8b3-d1d4a09cd9ef` at 100% and Pages deployment
`e65832a0-5925-4212-b252-2ff20cd08362`; `/insumos/health` and the CRM health
probe returned HTTP 200. No deploy was run in this audit.

`IDENTITY_PII_KEY` is an environment-scoped secret, listed independently in
GitHub `staging` and `production` and also present by name in the corresponding
Cloudflare Worker secret lists; secret values were never read or logged. The
Inventory and Identity implementations derive the same 32-byte AES-GCM key
from SHA-256(secret), use a 12-byte random IV, and exchange
`v1.<base64url-iv>.<base64url-ciphertext>` values. The exact key must therefore
be shared between the two domains for existing ciphertexts, while staging and
production keys must remain distinct. Production D1 read-only counts are zero
onboarding rows and zero encrypted personal-email/phone rows.

Classification is **case 5 — evidência insuficiente para prosseguir** for key
custody: the production secret exists, but no authorized external vault/escrow,
owner or recovery record is evidenced. This audit neither generated, rotated,
copied nor changed the secret. Rotation is safe only before encrypted payloads
exist or through an explicit dual-key re-encryption procedure; rollback must
retain the previous key until all ciphertexts are re-encrypted and verified.

The clean current-main `scripts/codex-preflight.sh` run passed with
`failures=0 warnings=0`. The remaining action is administrative evidence of
external custody, not another Inventory deploy.

After PR #803, the canonical workflows produced new staging-only evidence for
the workflow-sync SHA `6e6dd5bb97c27fb070a73c4aeae747a986e4bbc9`: core-all
preview/staging `30142251628`/`30142271109`, CRM Pages preview/staging
`30142340101`/`30142359030`, and core-inventory preview/staging
`30142438522`/`30142457474`. These runs used target `staging` and did not
publish production. They do not replace the already active `c64ff2…` release;
the runtime files are unchanged and no new production promotion is required.

## Offsite restore evidence and next Finance gate — 2026-07-25

Main was `5dae441997916ac610d97f7d10f2a3bd6db9c35c` after PRs #740, #800
and #801. The
provider-separated Drive vault is reachable with the restricted `drive.file`
client. The D1 ciphertext was retrieved and restored in an isolated scratch;
HMAC/plaintext checksums passed, with 58 tables, 16 migrations, zero FK
violations and Finance counts of 3 scopes, 2 grants, 1 setting, 0 movements,
0 journal entries and 12 release migrations. PostgreSQL and runtime-config
ciphertexts already held in the private runtime match the vault manifest
byte-for-byte and restored successfully (58 tables/43 workflows/246
executions/44 credentials; config tar 33 entries; PostgreSQL restore 25.643 s).

The scratch and plaintexts were destroyed; sanitized evidence is private at
`C:\CodexRuntime\operator\admin\skincos\offsite-recovery\20260725T-current-main-offsite-restore-evidence.sanitized.json`.
The raw connector cannot return a fresh download of the large PostgreSQL and
configuration objects within its IPC limit, so that transfer remains
unproven. This closes neither Finance `recoveryProof` nor the pilot gate: the
Finance Worker/frontend artifact restore, authenticated UI/import smoke,
continuous external monitor with human alert and named approval are still
required. `module_enabled` and all grants remain unchanged and disabled.

Next safe action: obtain an auditable fresh download of the two large Drive
objects through a streaming client, then repeat the Finance-specific artifact
restore in staging. Do not promote production or activate pilot until both
evidences and the nominal package are approved.

The first streaming attempt with rclone 1.60.1 was rejected by Google Drive
with `RATE_LIMIT_EXCEEDED` before any bytes were downloaded. It made no
external or repository mutation; the blocker is the provider quota window or
the need for an authorized service-account client.

## Inventory release-SHA reconciliation — 2026-07-25

The old candidate `cb04cb8b8ca87353c4c672fa5707bf3d36fb4ef4` is not the
authorized production SHA: the delta to `c64ff2b6655ce9e035a1b3a3840b1d6d809a9c2d`
contains the additive Identity onboarding migration and runtime compatibility
changes. The production release therefore correctly used the newer immutable
SHA `c64ff2b6655ce9e035a1b3a3840b1d6d809a9c2d`.

The delta from `c64ff2b6655ce9e035a1b3a3840b1d6d809a9c2d` to the current main
`6e6dd5bb97c27fb070a73c4aeae747a986e4bbc9` contains only workflow/preflight,
Finance canary/rollback, orchestration and evidence-documentation changes:
`.github/workflows/*`, `scripts/codex-preflight.sh`,
`docs/project-state/*` and `ops/project-orchestration/work-queue.json`. It
contains no Inventory/Identity/CRM frontend runtime, migration, binding or
deployable Pages artifact change. `c64ff2…` remains the single authorized
`RELEASE_SHA`; no new Inventory/Pages promotion is required.

The exact production workflow inputs prove the same release lineage: Inventory
run `30137182608` used `RELEASE_SHA=c64ff2…` and staging predecessor
`30135788180`; Pages run `30137826907` stamped `GIT_SHA=c64ff2…`. Active
production resources are Inventory deployment
`2a71e616-64fc-40ff-8480-5c24fad4497e` / Worker version
`6d7dadc6-7b02-4577-b8b3-d1d4a09cd9ef` and Pages deployment
`e65832a0-5925-4212-b252-2ff20cd08362`, source `c64ff2…`.

The Inventory promotion did apply the additive
`0017_employee_onboarding.sql` migration. A current read-only D1 query finds
the journal row and zero onboarding rows / zero encrypted-email or phone rows;
`d1 migrations list` now reports no pending migrations. This supersedes the
earlier wording that the promotion had no migrations to apply.

## Finance staging rollback gate — 2026-07-25

The Finance staging release was re-run from the current `origin/main` SHA
`8af1d5fe9551891a05a104363043bf3d36fb4ef4`, not from a historical candidate.
The immutable candidate run `30139535704` and Finance preview run
`30139561027` passed. Staging run `30139576133` passed with migrations,
encrypted D1 checkpoint, immutable Worker upload and health smoke. It created
Worker version `97c7a7da-6a78-44a8-b980-2cc2810df7a0`, whose deployment message
attests the exact current-main SHA. No production target was selected.

The controlled rollback run `30139701809` restored the known immutable
predecessor SHA `67ee53843a9a52ad495ab6d67b8cd2b4fac053f9` using preview
evidence `30138491542`. It resolved and deployed the previously uploaded
version `c57fdafc-6045-4eb5-8b38-07ae98d7c256` at 100% without applying
migrations or publishing another module. The staging health endpoint returned
`200`, `ready=true`, D1 and module-control healthy, and version `67ee…`.
The rollback workflow elapsed from `02:03:07Z` to `02:05:02Z` (approximately
115 seconds; this is workflow elapsed time, not a user-visible outage RTO).
The current staging control state is `module_enabled=false`; no pilot actor or
unit was enabled.

The canary abort drill `30139247054` is valid synthetic evidence: it opened a
remote KV canary, ran the authenticated synthetic journey, injected one
controlled error, recorded `breaches=["errors"]`, executed the kill switch and
restored the baseline. Its non-zero conclusion is intentional promotion
interruption. Final remote KV was verified `state=active` and staging D1
`module_enabled=false`. The earlier run `30139009328` is superseded because
its KV writes were local rather than remote; PR #796 corrected this and was
merged before the valid retry.

The scratch restore drill imported the staging Finance D1 export into the
isolated scratch database `9565bd3b-b9bc-4d7e-95d9-135490a3599e` from export
SHA-256 `a24db616e94e156c7da5a26a319094b210e7c078a80df11ce0648bea36c9692a`.
Sanitized counts/checksums matched for audit events (13/468), movements
(0/0), journal lines (0/0), import batches (0/0), `d1_migrations` (12/407),
settings (1/19) and grants (1/56). The scratch KV namespace was
`8024e25c0b3d4eb0a82805bb38781bd4`; its synthetic control flag round-tripped
with `releaseSha=fdf8cda…` and `syntheticOnly=true`. Finance has no R2 binding
in its current Wrangler configuration, and no `finance_release_migrations`
table exists; the journal of record is `d1_migrations`. These are explicit
scope limitations, not inferred restores.

The scratch D1 and KV resources were temporary staging-only resources and were
deleted after evidence capture at approximately `2026-07-25T02:07Z` (D1
`9565bd3b-b9bc-4d7e-95d9-135490a3599e`, KV
`8024e25c0b3d4eb0a82805bb38781bd4`). Production Finance, flags, grants, users and
business data remain untouched. Finance pilot remains blocked pending the
separate authenticated UI/import smoke, external monitor/human alert,
encrypted offsite backup/restore evidence and named approval.

## Current Inventory production evidence — 2026-07-25

The deployable release is the explicit immutable `RELEASE_SHA`
`c64ff2b6655ce9e035a1b3a3840b1d6d809a9c2d` (source tree
`b22e897c8a4699f1424b3ee83656016be488ad67`; source archive SHA-256
`22b9cf2a6845cc2e6348f0e797f69f6c5f89d7b42665bd27460ca8e131d60155`). The
candidate, preview and staging runs (`30135641022`, `30135763050`,
`30135762996`, `30135788180`, `30135788135`) and the synthetic RBAC journey
(`30135863885`) all attest this SHA. The cancelled duplicate staging run
`30135790724` is not release evidence.

`IDENTITY_PII_KEY` was previously classified as case 3 for data feasibility:
the additive `crm_employee_onboarding` table exists, but production D1 has zero
onboarding rows and zero encrypted personal-email/phone payloads;
`crm_identity_sessions` is absent. A fresh CSPRNG value was provisioned only to
the GitHub `production` environment on 2026-07-25T00:40:42Z; the value is not
stored or printed here. The current operational classification is superseded to
case 5 because an external vault/escrow record, owner and recovery procedure
for that generated key remain unproven. No production user, grant or feature
flag was changed.

The clean preflight from an archive of current `origin/main`
`cb658ad1e25413c2a307c846c9be99d1207eabb5` completed with
`failures=0 warnings=0`. It verified GitHub/Cloudflare authentication, required
secrets and variables, workflow inventory and live health endpoints.

### Production promotion and checkpoints

* Inventory/Core Workers: canonical run `30137182608`, explicit checkout and
  `RELEASE_SHA` `c64ff2b`; migration `0017_employee_onboarding.sql` applied
  successfully, and a subsequent read-only check reports no pending migrations. The
  active deployment is `2a71e616-64fc-40ff-8480-5c24fad4497e`, Worker version
  `6d7dadc6-7b02-4577-b8b3-d1d4a09cd9ef` (version 5135), at 100% traffic.
* CRM Pages: canonical corrected run `30137826907`, explicit checkout and
  metadata `GIT_SHA` `c64ff2b`. The active production deployment is
  `e65832a0-5925-4212-b252-2ff20cd08362`, source `c64ff2b`, URL
  `https://e65832a0.skincos.pages.dev`.
* Previous rollback checkpoints remain Inventory deployment
  `f0037d0a-bc21-4a26-8a8b-59a010c85ba6` / version
  `6104273d-a14c-4a84-8bb1-889a681969dc` (5132) and Pages deployment
  `0b8657b8-d162-4c0e-8a4a-e542255ec1a4` / source `fdf8cda`.
* The first Pages run `30137398895` is superseded because its metadata used the
  workflow SHA; it was replaced by `30137826907` without a code change. The
  stale sync run `30137411063` failed before deployment and PR #793 removed its
  obsolete automatic dispatch path. No duplicate active publisher remains.

Health probes after both promotions returned HTTP 200 for the CRM shell,
Inventory `/insumos/health`, Ponto, Atendimento and CRM API. Inventory health
reported `ready=true`, D1 configured and the two canonical units. The public
`/insumos/readiness`, `/insumos/version` and `/insumos/dependencies` paths are
not implemented as unauthenticated endpoints (401); deployment metadata and
the health response are the authoritative version/readiness evidence.

### Authenticated production smoke

Using the existing authenticated CRM browser session, the read-only smoke opened
`?module=insumos`, rendered stock overview and movements, exposed exactly the
two authorized unit options, switched to Barra Shopping Sul, reloaded, and
closed/reopened the module. The sanitized browser observations contained no
`401`, `403`, `500` or `RBAC_UNIT_DENIED`, and the shell remained usable. No
create/edit/delete control was invoked. Direct localStorage inspection and a
mechanical resource-count probe were not available in the browser sandbox, so
request-storm absence is observational rather than a counted metric.

Finance pilot activation and all unrelated module changes remain frozen until a
separate explicit Finance staging rollback/restore gate is completed.

## Historical P0 production gate attempt — superseded

Workflow `30133378752` stopped before publish because the production secret was
then absent. Its rollback checkpoint and staging evidence are retained below as
historical audit context; they are superseded by the successful production
promotion above.

## P0 incident — current staging evidence validated

`P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos` is
stable after the explicit production Inventory and CRM Pages promotions recorded
above. The historical synthetic journey
was real, but its artifact was built from `f276919ce6a63b337bd02bd0c3799dbf38f13b97`,
which predates functional PR #776. It cannot be used as production evidence.
Finance, production, pilot, GitHub Organization, Ponto, Atendimento, flags,
grants and unrelated module work remain frozen.

PR #763 (`fix(insumos): corrige RBAC por unidade`) merged into main as
`4a8b2074`. It was rebased on the P0 freeze, and its Central E2E Smoke (run
`30124027315`) plus all required checks passed. The repaired scenarios prove
authorized unit access, no-unit request suppression, circuit-breaker behavior
and edit policy only in CI.

The current authorization permits a controlled staging-only release and a
synthetic, removable identity journey. Candidate run `30131393262` archived
immutable main SHA `cb04cb8b8ca87353c4c672fa5707bf2d5a9fcecb`, source tree
`c9ca5f4826d418b2e3b033107185135831437ffd`, and source archive SHA-256
`5284a1554c24c799453404a66cfdd8194cfce021cecb3e184d8969b40ebf83e9`.
Canonical preview and staging workflows promoted this same SHA for Inventory
(preview `30131564731`, staging `30131598506`) and CRM Pages (preview
`30131566250`, staging `30131599897`). The immutable Pages URL is
`https://af0d1d23.skincos-staging.pages.dev`. The Pages custom alias
`crm-staging.skincos.com.br` is not currently resolvable, so the journey must
use the attested immutable Pages deployment URL.

The current authenticated unit-scope journey completed in workflow run
`30131682451` at `2026-07-24T22:43:24Z`, using the same SHA and only synthetic,
removable staging identities. It passed six scenarios: authorized Novo
Hamburgo, BarraShoppingSul, both-unit switching, empty-scope denial, ADMIN
override and recognized legacy alias. It loaded Insumos, movimentações,
overview and insights, and fixture teardown completed. The prior journey
`30129792473` remains historical evidence for `f276…`.

The historical authenticated unit-scope journey completed in workflow run `30129792473`
at `2026-07-24T22:06:03Z`, using only synthetic, removable staging identities
and the immutable Pages URL. It passed authorized Novo Hamburgo,
BarraShoppingSul, both-unit switching, no-unit denial with no data requests,
ADMIN override, recognized legacy alias, and explicit cross-unit denial with
`RBAC_UNIT_DENIED`. Inventory and Pages health were both `200`; the fixture
teardown completed. Follow-up PRs #771–#778 made the harness staging-targeted,
fail-closed when no authorized unit exists, and excluded the authenticated
preferences control route from data-request diagnostics.

No production user, flag, grant or D1 business data was changed. The real CRM
actor was already correlated read-only and the authenticated smoke used that
existing session without writes.

## Current CRM actor correlation — 2026-07-24

The live authenticated CRM session returned `/api/auth/me` with HTTP 200 and a
`GESTOR` actor. A read-only query against production D1 `skincos-db` matched
exactly one active `crm_users` row. The row has the two canonical units
`novo-hamburgo` and `barra-shopping-sul`, the five existing modules
`ponto`, `atendimento`, `conversa`, `finance` and `insumos`, and
`session_version=0`. No username, email, IP or credential is stored here; the
sanitized private evidence is kept outside the repository.

The active non-ADMIN empty-unit query returned zero rows, so the authenticated
actor is not among the affected empty-scope set. Administrative history shows
one scope configuration at `2026-07-24T18:02:25Z`; role and session version were
preserved while the two units and existing modules were recorded. D1 reported
zero changes and zero rows written. This is an identification result only:
there is no repair SQL, grant change or production mutation to roll back.

## Lineage reconciliation — 2026-07-24

The pre-candidate `origin/main` was `b8c356baf90b33cef834417cb75ddd172a0b0a9a`.
The candidate `cb04cb8b8ca87353c4c672fa5707bf2d5a9fcecb` is now an ancestor of
the current `origin/main` `4339df47f2797be78928d1da0a5124635c3ef976`; PRs #763
and #771–#784 are merged. The historical four preview/staging artifacts and journey all
reference `f276919ce6a63b337bd02bd0c3799dbf38f13b97` (merge #770). The functional
change from #776 is the `InsumosModule` fail-closed gate requiring an authenticated
actor with an authorized unit; that expression is absent from `f276…` and present
only after merge `7ba0c11d8a98ff87262b13e268892191120c8544`. The new current-main
candidate and staging cycle above include that change; historical evidence is
preserved but is not used for production.

## Cadastro hierárquico e regressões CRM — fechamento operacional 2026-07-29

O release funcional imutável foi `f30f66e70e0dc949adde5120378509a1c95fe557`;
o checkpoint de pipeline foi integrado pela PR #847 no `main`
`2f0bba6ab5df9c09bc3171e190189991a3891052`. Workforce, Inventory/Identity e
CRM Pages foram promovidos pelos workflows canônicos, com migration Identity
`0018_onboarding_consistency.sql` aplicada antes do Worker e checkpoint D1
cifrado do Inventory preservado no artefato `8711811875`.

O smoke de onboarding em produção, com contatos controlados e teardown
verificado, aprovou 29 cenários: limites de cargo/unidade, convite e consumo
único, login corporativo, recuperação anti-enumeração pelo contato protegido,
status e `session_version`, sessões, sincronização Workforce e fail-closed.
O SMTP usou a configuração iCloud preexistente `smtp.mail.me.com` com remetente
corporativo; nenhum valor de secret foi lido. Aceitação SMTP não prova leitura
de caixa postal.

O smoke UI autenticado em produção confirmou Insumos com reconciliação de
`localStorage` para `novo-hamburgo`, endpoints essenciais em HTTP 200 sem storm
e recusa `400/UNIT_INVALID` para unidade desconhecida e
`403/RBAC_UNIT_DENIED` para uma unidade canônica fora do escopo. Atendimento
carregou referências, atendimentos, overview e catálogo em HTTP 200 sem
`UNAUTHORIZED`. A consulta agregada pós-smoke encontrou um escopo de unidades
vazio e dois de módulos vazios em legados; eles permaneceram sem acesso e não
receberam concessão automática. Rollback permanece disponível pelas versões
anteriores e migrations aditivas já aplicadas.

## Livia — promoção de bundle isolado 2026-07-29

O workflow Livia (`WGXr4vYkv9UoJ8zc`) está ativo na versão histórica
`8316de5d-c047-473a-bd6a-662b513b73b5`, com os cinco sidecars principais
fixados no bundle imutável `1dee4fc24d786d794cd73f30e442ceea329e8563`,
produzido do merge da PR #853. O manifesto ativo tem SHA-256
`3ca96e4038529680e019b35f13b5c306a57beaa4c71426a9a191a28621038a21`.
O schedule diário foi preservado explicitamente como `field: days` às 13:26.
Checkpoint pós-promoção:
`livia-postpromote-1dee4fc2-20260729T093100-0300`, índice SHA-256
`a2a03f4223167bda6f6a4753b7b0073b7d014ca74100980d1cb99be1c996f5a9`.

Uma auditoria posterior encontrou que `Verify Published Artifacts` ainda
invocava um wrapper externo em `C:\CodexRuntime`, que ignorava seu argumento
versionado e chamava `/opt/skincos/current/source`. A PR #853 removeu esse
caminho transitivo: em 2026-07-29T12:30:17Z foi publicada a versão histórica
`8316de5d-c047-473a-bd6a-662b513b73b5`, ligada à release imutável
`1dee4fc24d786d794cd73f30e442ceea329e8563`. O comando chama diretamente o
verificador dessa release; `audit-live` retornou zero referências mutáveis e
os seis hashes do manifesto `3ca96e4038529680e019b35f13b5c306a57beaa4c71426a9a191a28621038a21`
conferiram. No checkpoint da repin, o ponteiro global era `0c0a4fa0…`; a
repin não o alterou nem fez restart. Posteriormente, a promoção independente
da PR #854 moveu o ponteiro global para `a32cf1a9…`. O Livia continua isolado:
seus comandos publicados apontam diretamente para `1dee4fc2…`, sem depender
desse ponteiro global.
O checkpoint pós-promoção `livia-postpromote-1dee4fc2-20260729T093100-0300`
teve `SHA256SUMS` conferido, SHA-256
`a2a03f4223167bda6f6a4753b7b0073b7d014ca74100980d1cb99be1c996f5a9`.
O registro de autorização e o runbook versionado especificam a promoção
`stage-only`, o rollback por nova versão histórica, os probes HTTP e a retenção
dos bundles referenciados por manifestos. O export sanitizado e versionado da
versão publicada está em `orb/engine/workflows/livia/livia.current.json`
(SHA-256 `1dcdef7df289311b553f2b5f44932f999f9a96f96fa32bc2d5d6a5b1192fe4cc`).
O arquivo usa escapes JSON equivalentes somente para as menções editoriais a
Facebook, evitando o falso positivo específico de OAuth sem retirar seus nós
Code/Execute Command da análise SAST.
A evidência de publicação real
continua histórica (execuções 336 e 339); uma publicação posterior só pode ser
considerada prova da versão corrigida se registrar seu `workflowVersionId`
publicado e o verificador direto do bundle.

## Meta Ads Publish — encerramento operacional 2026-07-29

A execução manual comercial `333` terminou `success` e concluiu
idempotentemente o run `map_f6a59341d6dace99d70f5533` (o registro preserva a
origem física na execução `331`). Stage, ativação, Drive, readback, conclusão e
notificação Telegram foram executados; o teste isolado posterior da Evolution
foi persistido com `DELIVERY_ACK`. Os anúncios ativos confirmados no Ads Manager
são `120247386191180157`/criativo `1011986138341232` (BarraShoppingSul) e
`120247386191560157`/criativo `1400344355311942` (Novo Hamburgo). O contrato
live conserva `WHATSAPP_MESSAGE` com `https://api.whatsapp.com/send`; os URLs
de agendamento continuam referências por unidade.

O workflow `eFJhFg79lyaycjlm` está inativo/manual, versão `830`, versão runtime
`b22ba74a-4fc9-428e-aa4e-41aebfd5b3f0`, schema SHA-256
`87e82f8d7c89afbe97b6057d1a417013a37e7a2b6227ba14315c4e869e7ce62f`; o
preflight somente leitura confirmou as 49 fontes sincronizadas e zero mutação
Meta. O Token Vault está 100% no
deployment `b24fc28a-ce09-4978-8fc0-ea40561bbb8c`, versão
`beba53d9-67f3-495b-a002-5dc579463c29`, com D1, token e chave de cifragem
saudáveis. O journal tem 52 `completed`, 54 `failed`, 3 `rolled_back` e 1
`calibration_archived`, sem locks ativos, jobs não terminais ou
`reconciliation_required`.

O source nativo do Orb foi promovido por release descendente de
`0c0a4fa0f4c2d0b432d449c0ba154e093b3ffe89` para
`a32cf1a9034ccd4872cfbde1ae089e56355300c4` (merge PR #854). Orb, proxy, CRM
e Booking usam esse SHA e os health checks local/público são 200. O archive,
checksum, lineage e rollback permanecem privados em
`C:\CodexRuntime\operator\admin\skincos\native-promotions\a32cf1a9034ccd4872cfbde1ae089e56355300c4`.

## Music Composition Studio — source unificado integrado 2026-07-29

PR #870 foi integrada à `main` como
`8442bb840fa8f620ea7e8cb5b37beecd064a7987`; a árvore do squash merge é
byte a byte igual à árvore final validada da branch. O source gera exatamente
um workflow operacional inativo, `Music Composition Studio (Unified)`. MSC-10
a MSC-90 executam inline, os outputs de erro convergem no MSC-99 inline e não
há nodes Execute Workflow. Os 11 predecessores estão arquivados fora do pacote
de importação em
`orb/engine/archived-workflows/music-composition-studio`.

A validação local passou em FAST, STANDARD e PREMIUM com provider mock e custo
zero; também comprovou cache sem nova submissão, callback/artifact dedupe,
polling limitado, rate limit, budget, fallback e reprocessamento seletivo
executável com preservação de URIs não afetadas. Achados Semgrep da revisão
foram tratados com schema patterns fail-closed e paths/nomes de fixtures
restritos, incluindo testes de regressão. O builder foi regenerado duas vezes
com hashes idênticos. Central E2E, JS/TS, Semgrep, CodeQL e os demais checks
obrigatórios da PR passaram. A migration
PostgreSQL foi aplicada duas vezes em um banco temporário, produziu 16 tabelas,
aceitou inserts com FK e preservou zero linhas após rollback. O pacote foi
importado/exportado pelo n8n 2.8.3 em perfil SQLite temporário como exatamente
um workflow inativo. Banco e perfil temporários foram removidos.

O Orb live está saudável, mas a busca somente leitura retorna zero Music
Composition Studio; o `n8n_runtime` também tem zero tabelas no schema
`music_studio`. Nada foi importado, ativado ou migrado em produção e
nenhuma credencial/provider pago foi configurado. Rollout live permanece uma
ação separada que exige staging, backup/rollback e autorização explícita.

## Meta CAPI — minimização de dados e fechamento de produção 2026-07-29

A PR #887 foi integrada como `ebcbcba63324baa1f5ab5b2181da82784cb74f82`.
Todos os checks obrigatórios e adicionais observados ficaram verdes. A cadeia
governada promoveu o release imutável
`5878279e21d7bcd84c18564663ed35f630737e60`, que contém esse merge, por
preview `30492554875`, staging `30492612081` e produção `30492875522`.
O deploy governado produziu a versão de código
`556ea05f-d242-41ac-9b58-55ea51c9d2c8`. Depois da remoção dos dois secrets
temporários de teste, o Worker `espacofacial-site` está 100% na versão
`f351f770-58e2-4da9-94e0-1e6f46382fab`, ainda com o mesmo código: home,
médicos e API de serviços responderam HTTP 200 com
`x-app-build=5878279e…` e `x-app-build-time=30492875522`.

No código desse release, `Schedule` envia ao Meta apenas
`content_type=booking` e `currency=BRL` em `custom_data`; `Contact` não envia
`custom_data` pelo servidor e usa objeto vazio no Pixel do navegador. Os
parâmetros originais de `Contact` continuam disponíveis para Google Ads. O
contrato preserva `event_id`, dados de correspondência com hash, IP/UA,
`fbp`/`fbc`, persistência D1 e o bloqueio fail-closed sem consentimento de
marketing. A suíte isolada passou com 88 testes, ESLint e TypeScript. Os testes
de regressão fazem igualdade exata do `custom_data` de `Schedule`, confirmam
ausência da propriedade em `Contact` CAPI e comprovam que os parâmetros
originais de `Contact` continuam indo ao Google Ads enquanto o Pixel recebe
objeto vazio. Dois testes adicionais executam requisições representativas
contra as rotas de booking e redirect do WhatsApp com um spy no sender CAPI;
assim, uma regressão nos call sites de servidor também falha a suíte.

Uma jornada sintética indispensável foi executada no release já publicado, com
consentimento de marketing, UTM e `fbclid`. Navegador e servidor usaram
`schedule_capi_postdeploy_19faff74937`; o Events Manager marcou o Navegador
como `Desduplicado` contra o evento processado do Servidor. O detalhe do
Servidor mostrou somente `currency=BRL` e `content_type=booking`, além das
chaves de matching esperadas. A lista de teste renderizou duas linhas idênticas
do Servidor, porém o D1 comprova um único dispatch da aplicação: uma linha de
auditoria, HTTP 200, `events_received=1` e nenhum erro. O booking preservou
`meta_event_id`, os dois consentimentos, `fbp`, `fbc`, `fbclid` e a landing URL
com UTM; booking e cliente fictícios foram removidos e somente a auditoria foi
retida.

A prova negativa anterior continua válida: o evento recusado por consentimento
não chegou ao Events Manager e o D1 mantém
`meta_capi_not_sent_without_marketing_consent`, sem tentativa Graph. O CRM
Tracking confirma Meta Pixel/CAPI configurados: `capiScheduleOk` tem valor 7,
`capiScheduleFailed` tem valor 0, `capiScheduleSkippedConsent` tem valor 1,
`capiContactFailed` tem valor 0 e não há candidato retryable; o novo `event_id`
não aparece em issues ou retries. O status agregado está `degraded` somente
pelos alertas históricos de cobertura de tracking/identificadores dos bookings
reais, não por falha da CAPI.

A listagem de secrets do Worker contém apenas os três nomes Meta permanentes
`META_ACCESS_TOKEN`, `META_PIXEL_ID` e `NEXT_PUBLIC_META_PIXEL_ID`.
`META_CAPI_TEST_EVENT_CODE` e o guard de booking sintético estão ausentes; seus
valores não foram persistidos no repositório nem nas evidências. O rollback
seguro da alteração de bindings é a versão Worker pós-minimização
`556ea05f-d242-41ac-9b58-55ea51c9d2c8`, do mesmo release
`5878279e21d7bcd84c18564663ed35f630737e60`: criar um deployment 100% dessa
versão e só aceitá-lo depois de confirmar ausência dos secrets temporários,
HTTP 200 em `/`, `/doutores` e `/api/booking/services` e
`x-app-build=5878279e…`. A versão pré-minimização
`affdc496-a0f4-4177-93e8-79ffa19e04f4`/release `0d73eba1…` é explicitamente
proibida como rollback, pois restauraria o vazamento de `custom_data`.

### Adendo: fechamento de `Contact` e transporte do redirect — 2026-07-30

A revalidação indispensável de `Contact` encontrou dois defeitos reais que os
testes puramente locais não reproduziam. O uso de `next/link` no link rastreado
disparava duas navegações concorrentes; a PR #910, integrada como
`790070968160eb5606225396ec35b65e8aca4651`, restaurou uma única navegação com
âncora nativa. Em seguida, a normalização da query pelo runtime
Cloudflare/OpenNext consumia uma camada de percent-encoding antes da rota,
fazendo os `&` internos de `dest` e `ctx` virarem separadores externos. Isso
truncava a mensagem do WhatsApp e descartava consentimento/atribuição no
servidor. As PRs #913 e #915, integradas como
`74b88b4f39fb07ae19eb01219093bd742d5c7a64` e
`6272becdfba7fc4ef82956ceeda6ab72fbab467b`, canonizaram o contexto compacto e
adicionaram um envelope URI versionado, com leitura retrocompatível antes e
depois da normalização do edge. A PR #904
(`225a94115afb974bc5f2b63140f1066a291aca42`) preservou o transporte do
contexto completo até a rota.

O release imutável `6272becdfba7fc4ef82956ceeda6ab72fbab467b` passou por
preview `30507517010`, staging `30507543078` e produção `30507710641`.
`/`, `/doutores` e `/api/booking/services` responderam HTTP 200 com esse
`x-app-build` e `x-app-build-time=30507710641`. O Worker
`espacofacial-site` está 100% na versão
`7c3d2cdd-1c1f-4edb-91b3-2dd4489b084c`. A listagem de secrets continua com
somente `META_ACCESS_TOKEN`, `META_PIXEL_ID` e
`NEXT_PUBLIC_META_PIXEL_ID`; `META_CAPI_TEST_EVENT_CODE` está ausente.

A PR #893 consolidou a suíte de regressão e a evidência de fechamento e foi
integrada como `122ea0523b4dab0916ee00d347da1c200a3909d8`. A promoção final
desse SHA passou por preview `30508783523`, staging `30508812469` e produção
`30508993966`. Depois da promoção, `/`, `/doutores` e
`/api/booking/services` responderam HTTP 200 com
`x-app-build=122ea0523b4dab0916ee00d347da1c200a3909d8` e
`x-app-build-time=30508993966`; o Worker está 100% na versão
`aec842a3-1fee-4bdf-bbea-86f33f6ee087`. A versão
`7c3d2cdd-1c1f-4edb-91b3-2dd4489b084c` permanece como rollback
pós-minimização conhecido e validado.

A prova final `contact_4f32b56c-cb57-4b5a-9bb0-66929f6c228c` gerou
exatamente uma requisição de redirect, preservou a mensagem original e o token
`EF-*`, enviou `Contact` pelo Pixel `1055784516710042` com objeto Meta vazio e
reutilizou o mesmo `event_id` no servidor. O D1 registrou consentimentos
analytics/marketing, URL e path completos, UTMs, `fbclid`, `fbp`, `fbc`,
first/last touch e a mensagem íntegra. A CAPI respondeu Graph HTTP 200,
`events_received=1`, sem erro. A linha de clique sintética foi removida e a
auditoria de entrega foi retida.

Após a limpeza exata dos diagnósticos, os agregados de 30 dias têm 187
`Contact` CAPI OK, 7 `Schedule` CAPI OK e 0 falhas retryable; as recusas de
consentimento históricas permanecem como auditoria fail-closed. A prova
positiva `schedule_capi_postdeploy_19faff74937` continua Graph 200/
`events_received=1`; a negativa `schedule_capi_negative_1785356808845`
continua pré-Graph por `marketing_consent_denied`. Não restam booking nem
clique sintético. O destino live de Google Ads para `Contact` não está
configurado; a preservação de seus parâmetros foi comprovada no contrato de
regressão, não por uma conversão Google live.

## Livia — PR #939, bundle isolado e preflight do novo carrossel — 2026-07-31

A PR #939 foi integrada com todos os checks verdes no merge commit
`01d2b6d1f79a9017e0a87efa2a1a32f82eed219f`. A correção concede leitura do
script `patch-livia-job-graph-payload-file.js` ao usuário `postgres` durante o
estágio nativo; não altera o contrato de mídia nem os nós específicos de
Reel. O bundle produzido exatamente desse merge foi arquivado em
`C:\CodexRuntime\operator\admin\skincos\native-releases\01d2b6d1f79a9017e0a87efa2a1a32f82eed219f`, com archive SHA-256
`c083bb444a71b1031f6ec0ad601e60db62a5940ad3bbc4ecda2fa1a14244e0c3` e
linhagem SHA-256 `2fc7e38fe254a318126d95b17b89b2bf3a5372655533282354fbda819b4ef14e`.

O Livia foi repinado de forma transacional para a versão histórica
`d11e34fa-7992-4c07-9fba-e212fffe1d8a`, com manifesto no bundle imutável
`01d2b6d1f79a9017e0a87efa2a1a32f82eed219f`. O manifesto tem workflow hash
`cca251e26fc87957f341abb264571025a00a142a4162be8d98b6338ae213afbb` e
`audit-live` confirmou `mutableRuntimeReferences=0` nos cinco workflows ativos.
O ponteiro global permaneceu em `f0200ee0aebe8d9f479179237435ed8727ce9458`;
nenhum outro workflow foi repinado.

Para testar somente o caminho produtivo do scheduler, foi criada uma versão
temporária às 12:30 e o Orb foi reiniciado exclusivamente pelo
`orb-safe-restart.sh`, após drenagem. A execução real `350` foi `trigger`,
`success`, de 12:30:19 a 12:30:26 (-03), mas terminou em `List Files` com zero
itens, zero jobs e zero chamadas HTTP. A pasta canônica do Drive
(`1Dq_1TeD4RCQAaYFSarXA7c63nDvtUvE9`) continha 57 itens; os oito PNGs mais
recentes pertencem ao grupo já publicado `3107260830` da execução 349 e não
foram reutilizados. O schedule diário foi restaurado para `field: days` às
13:26 na versão histórica acima, com novo restart seguro. Não houve gateway,
mutação do Drive, notificação ou publicação duplicada nessa tentativa.

Checkpoint pós-restore íntegro:
`C:\CodexRuntime\operator\admin\skincos\checkpoints\livia-carousel-pr939-post-restore-20260731T123400-0300`, índice SHA-256
`ac8f12e006b0b2af1cca3bd3d5f9704e3183193c8d672e7641a7d777263ed2f1`.
O aceite end-to-end de um carrossel inédito continua pendente até o novo
arquivo aparecer no Drive canônico; a mídia histórica não deve ser usada.
