# Current state

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
review: the compatibility path is present, but production D1 has no
`crm_employee_onboarding` or `crm_identity_sessions` tables and no encrypted
payload was evidenced. A new CSPRNG value was provisioned only to the GitHub
`production` environment on 2026-07-25T00:40:42Z; the value is not stored or
printed here. No production data, user, grant or feature flag was changed.

The clean preflight from an archive of current `origin/main`
`cb658ad1e25413c2a307c846c9be99d1207eabb5` completed with
`failures=0 warnings=0`. It verified GitHub/Cloudflare authentication, required
secrets and variables, workflow inventory and live health endpoints.

### Production promotion and checkpoints

* Inventory/Core Workers: canonical run `30137182608`, explicit checkout and
  `RELEASE_SHA` `c64ff2b`; migration step reported no pending migrations. The
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
