# Ponto Pages Phase 2 guarded dedicated publisher

Phase 1 remains a source-only package. Phase 2 adds a separate guarded
publisher for the dedicated Ponto Pages projects. Its default manual path is a
credential-free plan. Its opt-in publication path cannot proceed until
protected GitHub environments, immutable promotion evidence, remote identity
readback and global coordination all pass.

This source change does not configure a project, read a secret, call
Cloudflare, deploy an artifact, move a domain, or change a browser URL.

## Inventory used for the boundary

| Legacy source | Inventory finding | Phase 2 treatment |
| --- | --- | --- |
| crm/console/wrangler.toml | Ponto Core, Ponto Identity and module control coexist with unrelated CRM integrations and shared storage. | Retain only Ponto roles. The dedicated contract pins the Ponto service identities but copies no unrelated CRM storage, integration or value. |
| .github/workflows/deploy-crm-pages.yml | The composite CRM publisher owns legacy skincos and skincos-staging deployment paths. | Explicitly excluded. It must never be pointed at the dedicated Ponto projects. |
| .github/workflows/cloudflare-pages-sync-ponto.yml | Existing Ponto secret custody is coupled to the legacy composite Pages projects. | Not reused. The successor uses separate protected environments. |
| .github/workflows/ponto-progressive-release.yml | Existing Ponto rollout and rollback governance is domain-wide. | It remains the evidence source for later release decisions; Phase 2 does not replace it. |

The template excludes the unrelated share bucket, Atendimento, Escala, Meta
Ads and local-development controls. It contains no account, route, custom
domain or secret value.

## Dedicated target contract

| Target | Exact Pages project | GitHub environment | Rollout state |
| --- | --- | --- | --- |
| staging | skincos-ponto-staging | ponto-pages-staging | staging |
| production | skincos-ponto | ponto-pages-production | maintenance |

The composite project names skincos and skincos-staging are forbidden. The
workflow has a literal staging to skincos-ponto-staging and production to
skincos-ponto mapping. The configured project variable is compared with that
literal map; it never selects the project.

The Ponto-only service map is also literal:

| Target | PONTO_CORE | PONTO_IDENTITY |
| --- | --- | --- |
| staging | skincos-ponto-core-staging | skincos-insumos-staging |
| production | skincos-ponto-core | skincos-insumos |

MODULE_CONTROL remains a protected target-specific opaque identifier. It is
validated by format and is not committed.

## Custody and runtime boundary

deployment/github-environment.template.json is a names-only checklist for
ponto-pages-staging and ponto-pages-production. It contains no values and
permits no repository-secret fallback. Every secret expression read by the
guarded job has an exclusive PONTO_PAGES_* input name in the selected target
environment; generic repository or environment secret expressions are not
accepted. The job writes the secret payload in runner temporary storage without
echoing it, and removes that material at the end of the job.

Cloudflare custody must be named PONTO_PAGES_CLOUDFLARE_ACCOUNT_ID and
PONTO_PAGES_CLOUDFLARE_API_TOKEN in each protected environment. The other
exclusive inputs are PONTO_PAGES_PONTO_API_TARGET,
PONTO_PAGES_AUTH_API_TARGET, PONTO_PAGES_INSUMOS_API_TARGET,
PONTO_PAGES_ACTOR_HMAC_KEY, PONTO_PAGES_NETWORK_CONTEXT_KEY,
PONTO_PAGES_RELEASE_PROBE_HMAC_KEY and
PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET. The six runtime source inputs
are mapped to their established runtime names only while serialising the JSON
sent to Pages; PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET is used only by
the coordination actions and is never included in that payload. Generic
repository secrets named CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
PONTO_API_TARGET, AUTH_API_TARGET, INSUMOS_API_TARGET,
PONTO_ACTOR_HMAC_KEY, PONTO_NETWORK_CONTEXT_KEY,
PONTO_RELEASE_PROBE_HMAC_KEY or SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET are
not referenced by this publisher. Each mutating Wrangler subprocess receives
the dedicated token and account ID only as its CLOUDFLARE_API_TOKEN and
CLOUDFLARE_ACCOUNT_ID process environment. Cloudflare readback continues to
use curl configuration through stdin headers, never a curl command argument.

The rendered runtime template places all Ponto bindings and plain runtime
variables under env.production. Preview receives no runtime variable, secret,
KV or service binding. The template permits only:

- PONTO_CORE and PONTO_IDENTITY service bindings;
- MODULE_CONTROL KV binding;
- deployment environment, release SHA and rollout state;
- exact Core and Identity version identifiers for staging only;
- PONTO_API_TARGET, AUTH_API_TARGET and INSUMOS_API_TARGET, plus actor,
  network-context and release-probe keys.

Auth and health have their own fail-closed origin checks. AUTH_API_TARGET and
INSUMOS_API_TARGET are therefore explicit roles beside PONTO_API_TARGET;
omitting either makes its route unavailable. Production rejects version
overrides while in maintenance.

## Manual candidate and publication gates

ponto-pages-candidate-preflight.yml is the first manual, non-publishing stage.
It attests a full SHA reachable from main, checks the source package, and emits
standard preview promotion evidence. Its promotion gate explicitly uses
ponto-pages-staging rather than a generic preview or staging environment.

ponto-pages-governed-publisher.yml is the sole dedicated Pages publisher. It
always checks a full SHA and emits a sanitised plan. Its publish input defaults
to false. With the default, no protected environment, Cloudflare credential or
mutation job is reached.

If publish is explicitly true, the workflow requires:

1. Candidate evidence for staging, and exact staging evidence for production.
2. For staging, a successful Ponto Core staging-candidate run and its exact
   immutable receipt, selected by core_candidate_run_id.
3. For production only, a successful staging Pages same-deployment-source
   rollback receipt, selected by staging_rollback_run_id and tied to the exact
   staging_run_id, source SHA, source tree and skincos-ponto-staging project.
4. The exact protected target environment and PONTO_PAGES_PUBLISH_ENABLED set
   to true.
5. Literal project, Ponto service, API-origin, version and source-SHA checks.
6. Three fresh silent Cloudflare readbacks: an empty project before mutation;
   exactly the six Ponto secret names/types after guarded secret configuration;
   then, after deployment, exactly five plain runtime variables, those six
   secret names, two service bindings and one KV binding in production, with an
   empty preview configuration. D1, R2, Durable Objects, Queues, Hyperdrive,
   AI, Analytics, Browser, mTLS, Vectorize, extra config fields, custom domains
   and automatic Git publication all fail closed.
7. A dedicated deploy:ponto-pages target lease, revalidated immediately before
   secret configuration and again immediately before deployment.
8. Same-SHA Pages deployment and complete runtime-configuration readback before
   a sanitised receipt is written.

An absent Git source is a valid direct-upload state. If a Git source is later
connected, all automatic production and preview deployment controls must be
explicitly disabled. The workflow re-reads this at mutation time and does not
infer it from an earlier snapshot.

Run locally from workforce/ponto-pages with:

    npm run publisher:validate

This validates source contracts only. It cannot authorize publication.

## Next Ponto Core staging candidate receipt

This Phase 2 change deliberately does not create, configure or publish a Ponto
Core candidate. The next Core-only phase must emit the exact receipt that the
staging Pages publisher will consume. This prevents a Pages release from
pointing at a legacy Core SHA or an unrelated Worker version.

The future successful main workflow must be named Ponto Core staging candidate
and live at .github/workflows/ponto-core-staging-candidate.yml. The person
starting a guarded staging Pages publication supplies that run identifier as
core_candidate_run_id. The publisher verifies that run's workflow identity and
path, manual event, first attempt, same-repository head, main branch and exact
release SHA before it downloads precisely one artifact:

    ponto-core-staging-candidate-<source_sha>

That artifact must contain ponto-core-staging-candidate.json with contract id
skincos/ponto-core-staging-candidate/v1. Its receipt must identify the same
repository, commit SHA and Git tree as the Pages release; the exact
skincos-ponto-core-staging and skincos-insumos-staging service names; and the
same Core and Identity version IDs held by the protected staging environment.
It must also attest successful staging readiness and same-artifact rollback.
The receipt keeps privateExposure as an explicit compatibility alias of the
private Core, then separately attests the Core and Identity exposure. The
private Core has zero Worker routes and custom domains, with Workers.dev and
preview URLs disabled. Identity has only the allowed staging Worker route
api-staging.skincos.com.br/insumos/* and its
Workers.dev and preview URLs are also disabled. It must contain no values,
credentials or PII. A missing, stale, mismatched or overly public receipt
blocks before Cloudflare is read or changed.

The production Pages path does not accept candidate-version overrides. It is
instead chained to the immutable successful staging Pages evidence for the
same source SHA, whose staging step has already verified this Core receipt.

Production also requires an independent staging synthetic-smoke receipt; it
may not treat the generic promotion artifact or a deployment-list match as a
functional proof. The future workflow must be named Ponto Pages staging
synthetic smoke and live at
.github/workflows/ponto-pages-staging-synthetic-smoke.yml. It must publish
ponto-pages-staging-synthetic-smoke-<source_sha>-<project>, containing
ponto-pages-staging-synthetic-smoke.json with contract id
skincos/ponto-pages-staging-synthetic-smoke/v1. The receipt must bind the
same main SHA/tree, the exact staging publisher run and deployment ID, and
successful synthetic login, CSRF, Ponto read, Ponto write, terminal and
synthetic-cleanup checks. Missing or mismatched smoke evidence blocks before
any production Cloudflare read or mutation.

The staging Pages same-deployment-source rollback receipt is a separate future
producer contract; this Phase 2 change does not create that producer or run a
rollback. Its future workflow must be named Ponto Pages staging same-artifact
rollback and live at
.github/workflows/ponto-pages-staging-same-artifact-rollback.yml. It must
publish ponto-pages-staging-same-artifact-rollback-<source_sha>-<project>,
containing ponto-pages-staging-same-artifact-rollback.json with contract id
skincos/ponto-pages-staging-same-artifact-rollback/v1. The receipt must prove
the same main source SHA and tree; project skincos-ponto-staging; the exact
successful staging publisher run and original deployment identity; distinct
reverted and restored deployment identities; restoration to that same source
SHA; and no values, credentials or PII. It must use the
deploy:ponto-pages:staging lease and be added deliberately to the Ponto Pages
single-writer policy before it can mutate the dedicated staging project.

Staging publication does not require this receipt: the first isolated staging
deployment must exist before it can be rolled back. Production requires it and
fails before any Cloudflare read or change when the future producer, its run or
its receipt is absent, stale or mismatched. This is source/deployment identity
evidence, not a claim that a future build's byte-level bundle digest was
already proven equal.

## Required evidence before the guarded publisher is used

1. Keep ponto-pages-staging and ponto-pages-production protected, with
   target-specific custody matching the names-only template and no repository
   fallback.
2. Run the non-publishing candidate preflight and retain immutable evidence;
   never substitute an arbitrary workflow run as a staging predecessor.
3. Before a staging Pages publication, produce the exact future Ponto Core
   candidate receipt described above; a legacy Ponto Core SHA or a receipt from
   another run is not an acceptable substitute.
4. Read back each exact Pages project at release time and reject shared state,
   automatic Git publication, a domain or identity mismatch.
5. Produce and verify the exact independent synthetic-smoke receipt for
   staging login, CSRF, Ponto read/write, terminal pairing and cleanup, then
   perform the same-deployment-source rollback drill before any production
   staging run is used.
6. Approve host, cookie and terminal re-pairing plans before any domain or
   redirect change. The current CRM host remains untouched.
