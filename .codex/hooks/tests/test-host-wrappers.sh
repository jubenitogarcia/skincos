#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)}"
source_subdir="$repo/skills/skincos-project-orchestrator"
test_id="wrapper-shell-$$-$(date +%s%N)"
fixture_root="$(mktemp -d)"
redirect_root="$(mktemp -d)"
external_root="$(mktemp -d)"
symlink_runner_root="$(mktemp -d)"
non_git_root="$(mktemp -d)"

cleanup() {
  rm -rf -- "$fixture_root" "$redirect_root" "$external_root" "$symlink_runner_root" "$non_git_root"
}
trap cleanup EXIT

payload() {
  python3 - "$1" "$2" "$3" "${4:-No structured supervisor contract.}" "${5:-false}" <<'PY'
import json, sys
session, turn, cwd, message, active = sys.argv[1:]
print(json.dumps({
    "hook_event_name": "Stop",
    "session_id": session,
    "turn_id": turn,
    "cwd": cwd,
    "transcript_path": None,
    "stop_hook_active": active == "true",
    "last_assistant_message": message,
}))
PY
}

assert_allow() {
  python3 - "$1" "$2" "${3:-false}" <<'PY'
import json, sys
value = json.loads(sys.argv[1])
context = sys.argv[2]
expect_canonical_failure = sys.argv[3] == "true"
assert value.get("continue") is True, (context, value)
reason = value.get("stopReason", "")
if expect_canonical_failure:
    assert "canonical Git root unavailable or invalid" in reason, (context, value)
else:
    assert not any(term in reason for term in (
        "internal error",
        "canonical Git root unavailable",
        "process failed",
        "runner failed",
    )), (context, value)
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

mkdir -p "$fixture_root/.codex/hooks" "$fixture_root/skills"
cp "$repo/.codex/supervisor.json" "$fixture_root/.codex/supervisor.json"
cp "$repo/.codex/hooks/invoke-skincos-supervisor.sh" "$fixture_root/.codex/hooks/"
cp "$repo/.codex/hooks/skincos-supervisor-gate.py" "$fixture_root/.codex/hooks/"
cp -R "$repo/skills/skincos-project-orchestrator" "$fixture_root/skills/"
git -C "$fixture_root" init --quiet

direct_payload="$(payload "$test_id-direct" "$test_id-direct-1" "$source_subdir")"
direct_output="$(cd "$source_subdir" && printf '%s' "$direct_payload" | "$repo/.codex/hooks/invoke-skincos-supervisor.sh")"
assert_allow "$direct_output" "direct shell wrapper"

registered_command="$(python3 - "$repo/.codex/hooks.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["hooks"]["Stop"][0]["hooks"][0]["command"])
PY
)"

root_payload="$(payload "$test_id-root" "$test_id-root-1" "$fixture_root")"
root_output="$(cd "$fixture_root" && printf '%s' "$root_payload" | bash -c "$registered_command")"
assert_allow "$root_output" "registered shell command from repository root"

fixture_subdir="$fixture_root/workspace/intermediate/deep"
decoy_hooks="$fixture_root/workspace/.codex/hooks"
decoy_marker="$fixture_root/decoy-shell-executed.txt"
mkdir -p "$fixture_subdir" "$decoy_hooks"
cat >"$decoy_hooks/invoke-skincos-supervisor.sh" <<EOF
#!/usr/bin/env bash
printf '%s' executed >"$decoy_marker"
printf '%s\n' '{"continue":true,"stopReason":"decoy runner executed"}'
EOF
chmod +x "$decoy_hooks/invoke-skincos-supervisor.sh"
subdir_payload="$(payload "$test_id-subdir" "$test_id-subdir-1" "$fixture_subdir")"
subdir_output="$(cd "$fixture_subdir" && printf '%s' "$subdir_payload" | bash -c "$registered_command")"
assert_allow "$subdir_output" "registered shell command from nested subdirectory"
test ! -e "$decoy_marker"

mkdir -p "$external_root/.codex/hooks"
git -C "$redirect_root" init --quiet
redirect_marker="$external_root/redirect-shell-executed.txt"
cat >"$external_root/.codex/hooks/invoke-skincos-supervisor.sh" <<EOF
#!/usr/bin/env bash
printf '%s' executed >"$redirect_marker"
printf '%s\n' '{"continue":true,"stopReason":"redirected runner executed"}'
EOF
chmod +x "$external_root/.codex/hooks/invoke-skincos-supervisor.sh"
ln -s "$external_root/.codex" "$redirect_root/.codex"
redirect_payload="$(payload "$test_id-redirect" "$test_id-redirect-1" "$redirect_root")"
redirect_output="$(cd "$redirect_root" && printf '%s' "$redirect_payload" | bash -c "$registered_command")"
assert_allow "$redirect_output" "registered shell command with redirected .codex" true
test ! -e "$redirect_marker"

mkdir -p "$symlink_runner_root/.codex/hooks"
git -C "$symlink_runner_root" init --quiet
runner_marker="$external_root/symlink-runner-executed.txt"
cat >"$external_root/invoke-skincos-supervisor.sh" <<EOF
#!/usr/bin/env bash
printf '%s' executed >"$runner_marker"
printf '%s\n' '{"continue":true,"stopReason":"symlink runner executed"}'
EOF
chmod +x "$external_root/invoke-skincos-supervisor.sh"
ln -s "$external_root/invoke-skincos-supervisor.sh" "$symlink_runner_root/.codex/hooks/invoke-skincos-supervisor.sh"
runner_symlink_payload="$(payload "$test_id-runner-symlink" "$test_id-runner-symlink-1" "$symlink_runner_root")"
runner_symlink_output="$(cd "$symlink_runner_root" && printf '%s' "$runner_symlink_payload" | bash -c "$registered_command")"
assert_allow "$runner_symlink_output" "registered shell command with symlinked runner" true
test ! -e "$runner_marker"

non_git_payload="$(payload "$test_id-no-git" "$test_id-no-git-1" "$non_git_root")"
non_git_output="$(cd "$non_git_root" && printf '%s' "$non_git_payload" | bash -c "$registered_command")"
assert_allow "$non_git_output" "registered shell command outside Git" true

session="$test_id-supervisor"
continue_contract="$(python3 - <<'PY'
import json
print(json.dumps({
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
}))
PY
)"
continue_message="$(printf 'SKINCOS_SUPERVISOR_STATE_BEGIN\n%s\nSKINCOS_SUPERVISOR_STATE_END' "$continue_contract")"
continue_payload="$(payload "$session" "wrapper-shell-continue" "$fixture_subdir" "$continue_message")"
continue_output="$(
  cd "$fixture_subdir"
  printf '%s' "$continue_payload" |
    SKINCOS_ORCHESTRATOR_SKILL_ROOT="$fixture_root/skills/skincos-project-orchestrator" \
      bash -c "$registered_command"
)"
assert_block "$continue_output"

complete_contract="$(python3 - <<'PY'
import json
print(json.dumps({
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
}))
PY
)"
complete_message="$(printf 'SKINCOS_SUPERVISOR_STATE_BEGIN\n%s\nSKINCOS_SUPERVISOR_STATE_END' "$complete_contract")"
complete_payload="$(payload "$session" "wrapper-shell-complete" "$fixture_subdir" "$complete_message" true)"
complete_output="$(
  cd "$fixture_subdir"
  printf '%s' "$complete_payload" |
    SKINCOS_ORCHESTRATOR_SKILL_ROOT="$fixture_root/skills/skincos-project-orchestrator" \
      bash -c "$registered_command"
)"
python3 - "$complete_output" <<'PY'
import json, sys
value = json.loads(sys.argv[1])
assert value.get("continue") is True, value
assert "terminal state: complete" in value.get("stopReason", ""), value
PY

printf '%s\n' 'Shell project-hook canonical-root, redirect refusal, continue and terminal paths: OK'
