# Current state

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
