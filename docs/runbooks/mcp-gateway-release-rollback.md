# MCP gateway release lifecycle

The read-only gateway uses `/opt/skincos/current/mcp-readonly-source`, an atomic
service-specific link. It never changes `/opt/skincos/current/source`, Orb, or
orb-proxy. Before a live reconciliation, capture `status`, run `preflight` for
both the incumbent and target immutable SHA, then select and restart only the
gateway. If validation fails, execute `rollback <incumbent-sha>`.

```bash
MCP_GATEWAY_APPLY=YES scripts/runtime/mcp-gateway-release.sh select <target-sha>
MCP_GATEWAY_APPLY=YES scripts/runtime/mcp-gateway-release.sh restart
scripts/runtime/mcp-gateway-release.sh status
```

The script refuses paths outside `/opt/skincos/releases`, missing server or
lineage files, non-SHA input, unverified lineage, development paths and any
apply operation without explicit confirmation. No n8n, database, workflow,
credential, proxy, tunnel or global release pointer is changed.
