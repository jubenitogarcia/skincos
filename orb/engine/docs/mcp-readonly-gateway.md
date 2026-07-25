# Orb MCP Read-only Gateway

## Purpose

`SKINCOS Orb MCP Readonly Gateway` is a local MCP inspection gateway. It
replaces the former temporary filter that depended on n8n's `availableInMCP`
workflow flag. It binds only to
`127.0.0.1:8766/mcp`, preserves the `skincos_orb_readonly` Codex entry and
never forwards a workflow execution request.

The native n8n MCP endpoint remains local-only. The public
`/mcp-server/http` route is blocked by `orb-proxy` and is not part of this
gateway.

## Trust boundary

1. Codex presents its already-authorized n8n OAuth bearer token to the local
   gateway.
2. The gateway validates that token with a fixed, read-only native `tools/list`
   request. It does not initiate consent or store OAuth tokens.
3. The gateway exposes only its own fixed inspection tools and uses the
   `skincos_mcp_ro` PostgreSQL role for fixed `SELECT` queries.
4. The role has `CONNECT`, schema `USAGE`, and `SELECT` only on the seven n8n
   metadata/execution tables required by the gateway. It is `NOINHERIT`, has
   `default_transaction_read_only=on`, and query timeouts.

No MCP argument becomes SQL, a shell command, an n8n API request, or a
workflow execution.

## Tools and sources

| Tool | Live source | Returned scope |
| --- | --- | --- |
| `list_workflows` | PostgreSQL workflow/folder/project/tag tables | paginated metadata only |
| `search_workflows` | same live tables | bounded structural search |
| `get_workflow_summary` | workflow structure | nodes, triggers, integrations, risks |
| `get_workflow_graph` | workflow structure | sanitized graph |
| `list_recent_executions` | execution metadata and reduced error fields | no payloads |
| `get_execution_error` | execution metadata/data | reduced, redacted diagnostic |
| `find_workflow_dependencies` | workflow structure | structural dependency categories |
| `compare_workflow_with_repository` | live workflow plus prebuilt `origin/main` snapshot index | comparison only |
| `get_orb_status` | fixed health/systemd/database probes | sanitized health summary |

The snapshot index is generated from the locally available GitHub-origin ref.
It records only workflow path, name, counts and node types. Its ref and commit
are returned so stale or unavailable snapshots are not presented as live.

## Sanitization and limits

All tool output passes through a shared sanitizer. It removes credentials,
authorization/cookie fields, tokens, secret-like values, signed URLs, emails,
phone numbers, CPF values, payload/body/form/binary fields and long strings.
Workflow graph output maps raw connection names to generated node IDs and never
returns node parameters or credential names/values. Execution output never
returns execution payloads.

The HTTP request body is limited to 64 KiB, filters to 160 characters, tool
pages to 100 items, execution queries to 50 items and 31 days, database
statements to 8 seconds, child output to 2 MiB, MCP responses to 512 KiB and
four simultaneous tool calls. Each tool has a 12-second deadline, local rate
limiting, client-disconnect cancellation and fail-closed output sanitization.
The audit record contains only timestamp, generated request ID, tool name,
success and duration.

## Installation and update

Do not run the service from a worktree. First promote the reviewed source into
the native immutable release link and generate a structural snapshot from a
GitHub-origin ref:

```bash
node orb/engine/mcp-readonly-gateway/scripts/build-snapshot-index.mjs \
  --repository /mnt/c/CodexShared/Projetos/skincos \
  --ref origin/main \
  --output /mnt/c/CodexRuntime/operator/admin/skincos/mcp-readonly-gateway/workflow-snapshot-index.json
sudo bash orb/engine/mcp-readonly-gateway/scripts/install-runtime.sh \
  /opt/skincos/current/source \
  /mnt/c/CodexRuntime/operator/admin/skincos/mcp-readonly-gateway/workflow-snapshot-index.json
```

The installer creates `/etc/skincos/orb-mcp-readonly-gateway.env` with a local
read-only database password. It is private, root-owned and never belongs in
Git. It creates/enforces the least-privilege database role, verifies
`systemd-analyze`, installs `skincos-orb-mcp-readonly.service` pointing at
`/opt/skincos/current/source/orb/engine/mcp-readonly-gateway`, and stops the
legacy predecessor only after the new unit is installed. Re-running it
preserves the private password and updates only the snapshot state.

The Codex entry remains:

```toml
[mcp_servers.skincos_orb_readonly]
url = "http://127.0.0.1:8766/mcp"
```

The non-live regression is `npm run mcp:readonly:test` plus
`npm run mcp:readonly:validate`. The role-policy fixture fails if any forbidden
write, dangerous role attribute or inherited privilege is introduced. The
optional live role review must still confirm `rolinherit=false`, the explicit
table `SELECT` grants and no membership in another role.

After a controlled WSL shutdown/recovery, run
`powershell -ExecutionPolicy Bypass -File .\scripts\validate-mcp-readonly-persistence.ps1`.
It checks the native process path, four services, local health, public `404`
and the existing Codex server entry without requesting OAuth consent.

## n8n upgrade recommendation

The installed runtime is n8n 2.8.3. The upstream release stream is materially
newer and includes later MCP fixes, but this gateway does not require an n8n
upgrade for normal restarts because it reuses the existing OAuth authorization
and performs no consent write. Do not repeat consent approval merely to test
the gateway: n8n 2.8.3 has a non-idempotent insert into
`oauth_user_consents (userId, clientId)`.

Plan a separately approved n8n upgrade with backup, staging smoke and rollback.
Confirm the exact consent-idempotence fix against the chosen release before
claiming that the duplicate-key defect is resolved.

## Rollback

```bash
sudo bash orb/engine/mcp-readonly-gateway/scripts/rollback-runtime.sh
```

Rollback disables/removes only the gateway unit and its private configuration.
It retains gateway state, snapshots and logs, does not start the retired
predecessor automatically, and intentionally retains the no-write database role
for a separate explicit database-role review. It does not touch the public MCP
route block, Orb services, workflows or n8n credentials.
