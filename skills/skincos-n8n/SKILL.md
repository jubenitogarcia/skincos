---
name: skincos-n8n
description: Inspect SKINCOS Orb/n8n workflows, graphs, dependencies, executions, health, and repository snapshots safely. Use for questions about an Orb workflow, n8n error, automation architecture, workflow status, Meta Ads, Livia, or when live evidence is needed before proposing a workflow change.
---

# Skincos n8n

Use `skincos_orb_readonly` as the primary source for the live Orb instance.

1. Start with `list_workflows` or `search_workflows`; do not infer live state from repository files.
2. Use `get_workflow_summary`, `get_workflow_graph`, and `find_workflow_dependencies` for architecture questions. State that the result is live and sanitized.
3. For an incident, call `list_recent_executions` first, then `get_execution_error` only for an execution returned by that list. Explain when the gateway reports that error data exceeded a safe inspection limit.
4. Use `compare_workflow_with_repository` only as a historical comparison. Label its ref/commit as a snapshot, never as live state.
5. Use `get_orb_status` for runtime health. Treat public health as reachability, not proof of a business journey.

Never call or request a workflow execution, retry, creation, import, edit, activation, publication, credential/user/project/secret management, SQL, or shell command through the MCP gateway. `execute_workflow` is intentionally not available. Do not expose credential values, headers, tokens, payloads, patient data, email addresses, phones, or full execution messages.

Distinguish in every response: **live**, **repository snapshot**, **proposal**, or **unproven**. Cite workflow ID/name, tool consulted, timestamp where available, and the limits of the sanitized result.
