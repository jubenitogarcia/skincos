#!/usr/bin/env bash
set -euo pipefail
s="$(cd "$(dirname "$0")/.."&&pwd)/SKILL.md"
for x in 'Default mode is `resume-execute`' '`status`' '`plan`' '`execute:<milestone-id>`' 'Do not stop after plan' 'If unavailable/failing, collect directly' 'staging' 'production'; do grep -Fq "$x" "$s"; done
node "$(dirname "$0")/select-next-item.mjs" "$(cd "$(dirname "$0")/../../.."&&pwd)/ops/project-orchestration/work-queue.json" | grep -Fq 'finance-staging-gate'
echo 'orchestrator behavior checks: OK'
