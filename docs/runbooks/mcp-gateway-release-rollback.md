# MCP gateway release lifecycle

The read-only gateway uses `/opt/skincos/current/mcp-readonly-source`, an atomic
service-specific link. It never changes `/opt/skincos/current/source`, Orb, or
orb-proxy. The lifecycle script must itself run from a staged immutable source
release that contains the integrated unit; it refuses a checkout. `provision`
captures the previous unit, atomically installs the unit, reloads systemd and
selects the target gateway release without restarting any service. It restores
the previous unit automatically if provisioning cannot be verified.

Before a live reconciliation, capture `status`, run `preflight` for both the
incumbent and target immutable SHA, provision the exclusive pointer, then use
`promote <target> <incumbent>`. A failed post-restart health check automatically
selects and restarts the incumbent exactly once; do not retry promotion in that
execution.

```bash
MCP_GATEWAY_APPLY=YES scripts/runtime/mcp-gateway-release.sh provision <target-sha>
MCP_GATEWAY_APPLY=YES scripts/runtime/mcp-gateway-release.sh promote <target-sha> <incumbent-sha>
scripts/runtime/mcp-gateway-release.sh status
```

The script refuses paths outside `/opt/skincos/releases`, missing server or
lineage files, non-SHA input, unverified lineage, development paths, an
unverified unit, a non-immutable control source, and any apply operation without
explicit confirmation. No n8n, database, workflow, credential, proxy, tunnel
or global release pointer is changed.
