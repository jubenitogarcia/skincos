#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill="$skill_dir/SKILL.md"
metadata="$skill_dir/agents/openai.yaml"
schema="$skill_dir/references/ledger-schema.md"
collector="$skill_dir/scripts/collect-readonly-state.sh"

test -f "$skill"
test -f "$metadata"
test -f "$schema"
test -x "$collector" || test -f "$collector"

grep -qx 'name: skincos-project-orchestrator' <(sed -n '2p' "$skill")
grep -Fq 'Use $skincos-project-orchestrator' "$metadata"
grep -Fq 'Retome o SKINCOS e continue.' "$skill"
grep -Fq 'Veja em que ponto estamos.' "$skill"
grep -Fq 'Revise o que o agente anterior fez e prossiga.' "$skill"
grep -Fq 'Verifique as PRs abertas e execute o próximo passo seguro.' "$skill"
grep -Fq 'Compare o planejamento com o que está realmente em staging.' "$skill"

for gate in \
  'Never deploy, promote, mutate D1/PostgreSQL' \
  'Never call work complete without direct, timestamped evidence' \
  'Never treat a worktree or branch as `main`' \
  'Endpoint health' \
  'Preserve all unrelated dirty changes' \
  'Keep PRs small and single-purpose' \
  'Update the persistent ledgers at the end of every execution'; do
  grep -Fq "$gate" "$skill"
done

bash -n "$collector"
bash -n "$0"
printf 'Skill scenario and guardrail checks: OK\n'
