#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)}"
subdir="$repo/skills/skincos-project-orchestrator"
test_id="wrapper-shell-$$-$(date +%s%N)"
payload='{"hook_event_name":"Stop","session_id":"'"$test_id"'","turn_id":"'"$test_id"'-direct","cwd":"'"$subdir"'","transcript_path":null,"stop_hook_active":false,"last_assistant_message":"No structured supervisor contract."}'

assert_allow() {
  python3 - "$1" <<'PY'
import json, sys
value = json.loads(sys.argv[1])
assert value.get("continue") is True, value
reason = value.get("stopReason", "")
assert not any(term in reason for term in (
    "internal error",
    "project hook runner not found",
    "process failed",
    "runner failed",
)), value
PY
}

assert_block() {
  python3 - "$1" <<'PY'
import json, sys
value = json.loads(sys.argv[1])
assert value.get("decision") == "block", value
assert "skincos-project-orchestrator supervisor-cycle" in value.get("reason", ""), value
PY
}

output="$(cd "$subdir" && printf '%s' "$payload" | "$repo/.codex/hooks/invoke-skincos-supervisor.sh")"
assert_allow "$output"

registered_command="$(python3 - "$repo/.codex/hooks.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["hooks"]["Stop"][0]["hooks"][0]["command"])
PY
)"
registered_payload="${payload/$test_id-direct/$test_id-registered}"
registered_output="$(cd "$subdir" && printf '%s' "$registered_payload" | bash -c "$registered_command")"
assert_allow "$registered_output"

session="$test_id-supervisor"
continue_payload="$(python3 - "$session" "$subdir" <<'PY'
import json, sys
session, cwd = sys.argv[1:]
contract = {
    "schema_version": 1,
    "orchestration_status": "continue",
    "objective_status": "in_progress",
    "session_id": None,
    "mission_id": None,
    "completed_item": "registered-command-resolved",
    "next_item": "registered-command-terminal-check",
    "progress_made": True,
    "human_blocker": None,
    "credential_blocker": None,
    "production_authorization_required": False,
    "evidence_refs": ["host:shell-registered-command"],
}
message = "SKINCOS_SUPERVISOR_STATE_BEGIN\n" + json.dumps(contract) + "\nSKINCOS_SUPERVISOR_STATE_END"
print(json.dumps({
    "hook_event_name": "Stop",
    "session_id": session,
    "turn_id": "wrapper-shell-continue",
    "cwd": cwd,
    "transcript_path": None,
    "stop_hook_active": False,
    "last_assistant_message": message,
}))
PY
)"
continue_output="$(cd "$subdir" && printf '%s' "$continue_payload" | SKINCOS_ORCHESTRATOR_SKILL_ROOT="$repo/skills/skincos-project-orchestrator" bash -c "$registered_command")"
assert_block "$continue_output"

complete_payload="$(python3 - "$session" "$subdir" <<'PY'
import json, sys
session, cwd = sys.argv[1:]
contract = {
    "schema_version": 1,
    "orchestration_status": "complete",
    "objective_status": "complete",
    "session_id": None,
    "mission_id": None,
    "completed_item": "registered-command-terminal-check",
    "next_item": None,
    "progress_made": True,
    "human_blocker": None,
    "credential_blocker": None,
    "production_authorization_required": False,
    "evidence_refs": ["host:shell-terminal-contract"],
}
message = "SKINCOS_SUPERVISOR_STATE_BEGIN\n" + json.dumps(contract) + "\nSKINCOS_SUPERVISOR_STATE_END"
print(json.dumps({
    "hook_event_name": "Stop",
    "session_id": session,
    "turn_id": "wrapper-shell-complete",
    "cwd": cwd,
    "transcript_path": None,
    "stop_hook_active": True,
    "last_assistant_message": message,
}))
PY
)"
complete_output="$(cd "$subdir" && printf '%s' "$complete_payload" | SKINCOS_ORCHESTRATOR_SKILL_ROOT="$repo/skills/skincos-project-orchestrator" bash -c "$registered_command")"
python3 - "$complete_output" <<'PY'
import json, sys
value = json.loads(sys.argv[1])
assert value.get("continue") is True, value
assert "terminal state: complete" in value.get("stopReason", ""), value
PY

printf '%s\n' 'Shell project-hook registration continue/terminal path: OK'
