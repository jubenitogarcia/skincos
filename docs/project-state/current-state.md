# Current state

## P0 incident — current staging evidence validated

`P0 — restaurar e estabilizar o acesso por unidade do módulo de Insumos` remains
operationally open for the production identity/release gates, but current
staging evidence is now valid. The historical synthetic journey
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

No production deploy occurred, and no production user, flag, grant or data was
changed. The real CRM actor still requires read-only correlation before any
production consideration.

## Lineage reconciliation — 2026-07-24

The pre-candidate `origin/main` was `b8c356baf90b33cef834417cb75ddd172a0b0a9a`.
After PR #780, current `origin/main` is
`cb04cb8b8ca87353c4c672fa5707bf2d5a9fcecb`. PRs #763 and #771–#780 are
merged. The historical four preview/staging artifacts and journey all
reference `f276919ce6a63b337bd02bd0c3799dbf38f13b97` (merge #770). The functional
change from #776 is the `InsumosModule` fail-closed gate requiring an authenticated
actor with an authorized unit; that expression is absent from `f276…` and present
only after merge `7ba0c11d8a98ff87262b13e268892191120c8544`. The new current-main
candidate and staging cycle above include that change; historical evidence is
preserved but is not used for production.
