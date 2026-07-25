# Current state

## Offsite restore evidence and next Finance gate — 2026-07-25

Main is now `1b8a9d4f10f005e05b3475baba75af1d9183c046` after PR #740. The
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
`d006157297c02e2a7bace9fcd1abad654b546d06` contains only workflow/preflight,
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

`IDENTITY_PII_KEY` was classified as case 3 after read-only schema and source
review. The additive `crm_employee_onboarding` table now exists, but production
D1 has zero onboarding rows and zero encrypted personal-email/phone payloads;
`crm_identity_sessions` is absent. A fresh CSPRNG value was provisioned only to
the GitHub `production` environment on 2026-07-25T00:40:42Z; the value is not
stored or printed here. The staging and production secret names are present,
but an external vault/escrow record for the generated production key is not
evidenced and remains an operational security debt. No production user, grant
or feature flag was changed.

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
