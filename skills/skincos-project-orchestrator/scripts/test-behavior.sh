#!/usr/bin/env bash
set -euo pipefail
s="$(cd "$(dirname "$0")/.."&&pwd)/SKILL.md"
for x in 'Default mode is `resume-execute`' '`status`' '`plan`' '`execute:<milestone-id>`' '`supervisor-cycle`' 'Do not stop after plan' 'If unavailable/failing, collect directly' 'staging' 'production'; do grep -Fq "$x" "$s"; done
cycle="$(dirname "$s")/references/supervisor-cycle.md"
for x in 'SKINCOS_SUPERVISOR_STATE_BEGIN' '"orchestration_status": "continue"' '`cycle_budget_exhausted`' 'Stop-generated prompt does not'; do grep -Fq "$x" "$cycle"; done
fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT
printf '%s\n' '{"items":[{"id":"blocked-higher","state":"blocked","priority":100,"dependencies":[]},{"id":"supervisor-safe-fixture","state":"ready","priority":90,"dependencies":[]}]}' >"$fixture"
node "$(dirname "$0")/select-next-item.mjs" "$fixture" | grep -Fq 'supervisor-safe-fixture'
echo 'orchestrator behavior checks: OK'
