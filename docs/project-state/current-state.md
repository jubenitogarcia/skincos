# Current project state

## Snapshot — 2026-07-24T18:24Z

This is a read-only baseline. The evidence index has the commands, identifiers,
and limitations; `TASKS.md` and `DECISIONS.md` remain authoritative for goals
and decisions.

| Surface | Observed state | Level of proof |
| --- | --- | --- |
| Local checkout | Current branch `codex/admin/content-studio-v2` at `598bc3d5`; the worktree is dirty with independent Content Studio work and this orchestration addition. Preserve both. | local-only |
| Local `main` | `118c2283`, while `origin/main` is `fdf8cda8`; local `main` is 162 commits behind. | local-only; not current remote main |
| Current branch commit | `598bc3d5` is an ancestor of `origin/main`; uncommitted work is not integrated. | main only for that committed ancestor |
| Worktree topology | 69 registered worktrees. A worktree must not be used as evidence of integration. | local-only |
| GitHub | Repository has 56 open PRs. Recent PRs #761–#764 are blocked/draft or have failing checks; their checks need individual inspection before prioritization. | GitHub metadata observed |
| Staging API | `https://api-staging.skincos.com.br/health` returned 200, `ready:true`, D1 configured, version `0cc853b3a99dbdd0fcfc3ef589e2bdf199db7f4a`; `/api/ponto/health` returned 200 with `database:true`. | endpoint health, not journey validation |
| Staging CRM | `crm-staging.skincos.com.br` did not resolve during the baseline. The configured preview/staging CRM journey is unproven. | unproven |
| Production endpoints | API, Ponto, CRM Pages, and Orb health endpoints returned 200; Ponto reported `database:true`. | endpoint health, not journey validation |
| Native runtime | All seven final units were active; CRM/Booking/Orb unit definitions point to `/opt/skincos/current/*`. The release SHA was inaccessible to the `admin` read-only session. | runtime availability; exact release SHA unproven |
| D1/PostgreSQL | Cloudflare D1 inventory and local PostgreSQL catalog were reachable read-only. Specific migration/table contents and D1-to-deployment provenance remain unproven in this baseline. | inventory metadata only |

## Current integration focus

## Latest operational evidence — Livia

The active workflow `Livia` (`WGXr4vYkv9UoJ8zc`) was republished as version
`ca552ab3-1983-4e57-a679-1c7daf6fbae1`. Production CLI execution `272`
completed at 2026-07-24T20:36:35Z, with provider readback for Instagram,
Facebook and Threads in both units and a verified Drive `published:true` mark.
The Livia-specific checkpoint series remains under the private native runtime;
see the evidence ledger for scope and limits.

Do not open a large new product front while the active integration queue is
unclear. First inspect the newest relevant non-draft PR with a failing required
check (currently PR #763) and distinguish an actionable regression from the
recurring dependency-audit failures seen on several PRs.

## Next safe action

Run a PR-specific read-only triage for #763: inspect its Central E2E Smoke and
Dependency Audit logs, determine whether its branch is still intended for
integration, and update `TASKS.md` only if it changes the durable priority. No
production, staging, D1, PostgreSQL, or workflow mutation is authorized by this
baseline.

## Orchestrator readiness

The versioned Skill is installed for this operator as a junction under
`C:\Users\admin\.agents\skills\skincos-project-orchestrator`. A fresh
read-only Codex CLI session discovered it and accepted all five required
invocation scenarios. See the final evidence entries below.

## Snapshot — 2026-07-25T03:10Z

| Surface | Observed state | Level of proof |
| --- | --- | --- |
| Remote main | `313857ea3ad5156e2e119ce77e5125880092447f`; PR #799 merge `27af07e25149a2e3a097b0769e357744ed62a87d` is an ancestor. Main checks for the subsequent documentation merge are green. | integrated on `main` |
| Hierarchical onboarding staging | Workforce, Inventory/Identity and CRM Pages were deployed from SHA `27af07e2`; migrations `0018_onboarding_consistency.sql` and `0008_employee_access_states.sql` applied before Workers. | deployed to staging |
| Staging smoke | Synthetic Insumos journey run `30140912603` passed for one unit, both units, aliases, empty scope, ADMIN and deliberate unauthorized access; teardown completed. | deployed to staging; journey validated |
| Staging endpoints | API, Workforce, immutable Pages URL and `crm-staging.skincos.com.br` returned 200. | endpoint health |
| Email transport | No staging `AUTH_RESET_*` SMTP secrets or approved test provider is configured. Invite/recovery end-to-end delivery remains unproven. | unproven; external configuration required |
| Production | No production workflow, migration, binding or business-data mutation was executed for onboarding. | production untouched |

## Snapshot — 2026-07-25T03:38Z

| Surface | Observed state | Level of proof |
| --- | --- | --- |
| Remote main | PR #803 merged as `6e6dd5bb97c27fb070a73c4aeae747a986e4bbc9`; all required PR checks passed. | integrated on `main` |
| Canonical staging pipelines | Release candidate `30142173226`; Workforce preview/staging `30142195253`/`30142211683`; Core preview/staging `30142251628`/`30142271109`; inventory-granular rerun `30142438522`/`30142457474`; CRM Pages preview/staging `30142340101`/`30142359030`. | successful staging deployments |
| Staging journey | First rerun `30142419707` stopped before fixtures because the harness was given a `core-all` artifact. Corrected inventory-granular journey `30142508997` passed with teardown. | journey validated |
| Staging endpoints | API, Workforce, immutable Pages URL `https://cbc99f65.skincos-staging.pages.dev` and CRM staging alias returned 200; API reports release version `6e6dd5bb…`. | endpoint health |
| Email transport | Pipeline now syncs `AUTH_RESET_*` only from the GitHub `staging` environment; no provider/secrets are configured. | invite/recovery remains unproven |
| Production | No production workflow, migration, binding or business-data mutation was selected. | production untouched |

## Snapshot — 2026-07-27T21:14Z

| Surface | Observed state | Level of proof |
| --- | --- | --- |
| iCloud Mail configuration | Project documentation and local-only template specify iCloud Mail SMTP. Repository-level GitHub `AUTH_RESET_*` secret names exist; values were not read. | configuration discovered; values redacted |
| Staging Worker | `wrangler secret list --env staging` returned all six required onboarding/reset secret names. | deployed to staging |
| Controlled recovery delivery | A transient synthetic staging identity received a `200` password-recovery response after SMTP acceptance (`a21ea5b07ed88bfa`); the Worker only returns that result after its SMTP DATA command gets `250`. | SMTP protocol delivery validated; inbox readback unproven |
| Test cleanup | Synthetic user and reset rows were deleted; a targeted count returned zero. | staging data cleaned |
| Staging API | `https://api-staging.skincos.com.br/health` returned 200, ready, version `6e6dd5bb…` at `2026-07-27T21:14:01Z`. | endpoint health |
| Production | No production Worker, migration, binding or business-data action occurred. | production untouched |

## Snapshot — 2026-07-28T15:38Z — MCP post-merge operational validation

| Surface | Observed state | Level of proof |
| --- | --- | --- |
| Integrated main | PR #790 merge `2e4f08978ba736499aa1bc237d8e5957d339297c`; `origin/main` points to the same SHA. | integrated on `main` |
| Effective MCP process | PID 588 is running from immutable release `d15633bbb14e33e5ed3f35f06affec820cb03f66`; all seven gateway artifact hashes match `origin/main`. | active in production; byte-equivalent |
| Atomic current pointer | `/opt/skincos/current/source` points to release `7d0215fedab7e657e2fb0ff94cbc85edd3091356/source`, which lacks the MCP gateway path. Pointer timestamp predates PR #790 merge; cause is not attributed to the merge. | active in production; divergent pointer |
| Gateway persistence/restart gate | Canonical `validate-mcp-readonly-persistence.ps1 -SkipShutdown` stopped at the gateway-file invariant; isolated restart and `wsl --shutdown` were not attempted because the canonical precondition would fail and could degrade the service. | blocked; last healthy state preserved |
| Runtime health | `orb`, `orb-proxy`, `cloudflare-orb` and `skincos-orb-mcp-readonly` active/enabled; Orb, CRM, Booking, WhatsApp local and public proxy health returned 200; public MCP paths returned 404; listener is loopback-only. | active in production; endpoint health |
| MCP safety | Current authenticated read-only call returned 9 fixed tools, 3 Livia matches, sanitized Livia summary 57 nodes/64 connections; `execute_workflow` absent. Static limits and local rate probe returned 118x401 and 7x429. | active in production; read-only behavior validated |

### Next safe action

Obtain a separately authorized native-release reconciliation decision for the pre-existing `/opt/skincos/current/source` pointer. Do not promote, repoint, restart or run the WSL shutdown persistence test until the release pointer contains the integrated gateway and a rollback checkpoint is approved.

## Snapshot — 2026-07-28T16:05Z — n8n upgrade audit (read-only)

| Surface | Observed state | Level of proof |
| --- | --- | --- |
| n8n runtime | 2.8.3; Node 22.23.1; PostgreSQL 16.14; 43 workflows (5 active/38 inactive); 46 credentials; 143 migrations | live read-only inventory |
| OAuth consent | `oauth_user_consents` has unique `(userId,clientId)` constraint `UQ_083721d99ce8db4033e2958ebb4`; 2 live rows observed; no row changed | live schema inspection |
| Official fix | n8n commit `26ecadcf94` (#28703) changes MCP consent from `insert` to `upsert`; first included in 2.19.0 and present in 2.32.5 | official source/release proof |
| Isolated restore | Schema/migrations restored to temporary PostgreSQL; synthetic repeated consent produced one row with latest timestamp | isolated test passed |
| Candidate | 2.32.5 is npm `latest`/`stable`, Node requirement `>=22.22`; clean/schema and disabled-workflow staging boots reached `/healthz` 200 and 227/115 | candidate only; package loader blocks promotion |
| Production | No update, migration, workflow, credential, execution, OAuth-consent, Cloudflare, DNS or Tunnel mutation | production untouched |

Private full report: `C:\CodexRuntime\operator\admin\skincos\n8n-upgrade-audit-20260728\N8N-UPGRADE-AUDIT-20260728.md`. Classification: `UPGRADE_NAO_RECOMENDADO` / `BLOQUEADO_POR_PACOTE`.

## Snapshot — 2026-07-28T17:25Z — n8n candidate staging completion

| Surface | Observed state | Level of proof |
| --- | --- | --- |
| Clean bootstrap | 2.19.0 `/healthz` 200, 168 migrations/79 tables; 2.32.5 `/healthz` 200, 227/115; both orderly exit 0 | isolated staging |
| Sanitized schema | Independent 2.19.0 DB converged to 168/79; independent 2.32.5 DB converged to 227/115 without OAuth uniqueness failure; earlier 2.19.0 227/115 evidence was a reused post-candidate DB | isolated staging |
| OAuth | Repeated synthetic upsert produced exactly one consent row and latest scopes in both versions; unique constraint remains | isolated staging |
| Workflows | Sanitized 43 fixtures loaded in both candidates with original five active IDs recorded then disabled (`active=false`, `activeVersionId=NULL`); final runs 0 active/43 inactive/0 executions, no activation attempts | isolated staging; functional compatibility still open |
| Community nodes | Pinned 11-package installation reproduced `pkce-challenge` custom-loader `index is not a constructor` in both 2.19.0 and 2.32.5 | `BLOQUEADO_POR_PACOTE` |
| Gateway | 5 sanitizer tests, architecture validation and systemd verification passed; public MCP paths 404; listeners loopback-only | live read-only; provenance divergence remains |
| Release provenance | PID 588 executes old release `d15633...`; current pointer `7d0215...` lacks gateway path | convergence blocked; no repair authorized |
| Production | No n8n update, migration, workflow, credential, execution, OAuth, Cloudflare, DNS, Tunnel or service restart | production untouched |

Decision classification: `STAGING_BOOTSTRAP_READY` plus `BLOQUEADO_POR_PACOTE`; overall
`UPGRADE_NAO_RECOMENDADO` until the community-node loader/layout and gateway release
provenance are corrected in a separately authorized staging cycle.

## Snapshot — 2026-07-28T18:30Z — external runtime boundary recorded

| Surface | Observed state | Level of proof |
| --- | --- | --- |
| Orb native release | External process promoted `a27e799154f19fe5148d204f4c4e982fbef2bf6e` and restarted `orb.service` at approximately 15:19:51 -03; this was not caused or executed by the n8n audit. | journal/read-only reconciliation |
| n8n production | Still 2.8.3; 43 workflows, 5 active, 38 inactive, 318 executions at the later readback. | live read-only readback after boundary |
| MCP perimeter | Orb health 200; public `/mcp-server` and `/mcp-server/http` 404; four Orb services active; listeners loopback-only. | live endpoint/systemd/socket checks |
| Provenance | Gateway path exists in `a27e...`, but PID 588 predates the repoint; no restart or reconciliation was attempted by this audit. | external-state evidence; gate open |

This is a provenance boundary. The n8n upgrade remains isolated and classified
`UPGRADE_NAO_RECOMENDADO` / `BLOQUEADO_POR_PACOTE`; production must not be treated as
unchanged after the initial snapshot.

## Snapshot — 2026-07-28T19:10Z — staging qualification closed

The resumed isolated qualification remains `BLOQUEADO`. n8n 2.32.5 passed direct
package-layout bootstrap/idempotent restart on sanitized PostgreSQL (227/115,
43 disabled workflows, health 200), synthetic repeated OAuth consent, and the
gateway loopback smoke (9 tools, 43 workflows, no `execute_workflow`, 401/429,
local public paths 404). A custom-format pre-upgrade dump was restored and n8n
2.8.3 booted on the restored database (143/58, health 200, clean exit), proving
the binary/database rollback path in staging. Full functional journeys, MCP OAuth
against a candidate n8n, WSL shutdown/keepalive, failure injection and production
provenance reconciliation remain open. No production mutation occurred.

## Snapshot — 2026-07-28T18:33Z — external restart churn

Read-only journal checks during finalization observed additional `orb.service`
stop/start cycles at approximately 15:29:55 and 15:32:46–15:32:47 -03. The current
protected source resolved to release `eee3094aed874e479e17dfdfe8443984c8f10ee3/source`
and `ExecMainStartTimestamp` was 15:32:47. No cycle was invoked or authorized by this
audit. Orb health remained 200 and public MCP routes remained 404; runtime provenance
and stability are therefore an external open gate, not evidence for n8n qualification.

## Snapshot — 2026-07-28T19:35Z — Orb/n8n change set PR

PR #828 (`https://github.com/jubenitogarcia/skincos/pull/828`) is a draft,
rebased on `origin/main` at `7c782e4f82436a810e8dae5b377cf00374074892`.
It contains only the fixed n8n 2.32.5 manifest, guarded scripts, synthetic OAuth
fixture and promotion/rollback/observation runbooks. Local dry-runs, architecture,
security, gateway tests and all applicable PR checks passed. The source staging
qualification remains `BLOQUEADO`; the PR is intentionally not a promotion
authorization. No production service, database, workflow, credential, Cloudflare,
DNS or Tunnel was changed.

## Snapshot — 2026-07-28T20:50Z — isolated resilience and MCP/OAuth follow-up

PR #828 advanced to `aceafb17` with sanitized runbooks for failure injection and
candidate MCP/OAuth discovery. Synthetic tests proved closed-fail behavior for
process kill/restart, occupied port, gateway DB outage and read-only filesystem;
the candidate booted with MCP environment management enabled but OAuth metadata
and registration returned 404 without a protected resource in the disabled
workflow snapshot. Low-space, real Streamable HTTP/client registration,
functional package journeys and WSL keepalive remain open. Production remains
untouched; PR remains draft and blocked.

## Snapshot — 2026-07-28T21:23Z — community-node compatibility gate reopened

The post-qualification catalog test invalidated the former direct-layout proof:
candidate 2.32.5 loaded the 11 directories and reached loopback health 200, but
its exported catalog omitted three workflow types, including the Cloudinary and
Evolution package-namespaced types. Their direct descriptions are unnamespaced,
which demonstrates that `N8N_CUSTOM_EXTENSIONS` is not a substitute for the
canonical community-package installer/`PackageDirectoryLoader`. The package
compatibility gate is therefore failed again and PR #828 remains draft; no
production action occurred.
