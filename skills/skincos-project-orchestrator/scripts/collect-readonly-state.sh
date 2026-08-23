#!/usr/bin/env bash
set -euo pipefail

# Print a reproducible read-only snapshot. It never writes, deploys, runs SQL,
# starts services, or changes Cloudflare/GitHub state.

online=0
if [[ "${1:-}" == "--online" ]]; then
  online=1
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--online]\n' "$0" >&2
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
cd "$root"

section() {
  printf '\n## %s\n' "$1"
}

run_or_note() {
  local label="$1"
  shift
  printf '\n### %s\n' "$label"
  if "$@"; then
    :
  else
    printf '[unproven] command unavailable, unauthorized, or returned a non-zero status\n'
  fi
}

printf '# SKINCOS read-only state snapshot\n'
printf -- '- observed_at_utc: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf -- '- repository: %s\n' "$root"

section 'Git working state'
git status --short --branch
printf '\ncurrent_branch: '
git branch --show-current
printf 'head: '
git rev-parse HEAD
for ref in main origin/main staging origin/staging; do
  if git rev-parse --verify --quiet "$ref" >/dev/null; then
    printf '%s: %s\n' "$ref" "$(git rev-parse "$ref")"
  else
    printf '%s: [unproven locally]\n' "$ref"
  fi
done
if git rev-parse --verify --quiet main >/dev/null && git rev-parse --verify --quiet origin/main >/dev/null; then
  printf 'main_vs_origin_main: '
  git rev-list --left-right --count main...origin/main
fi

section 'Worktrees'
printf 'registered_worktrees: '
git worktree list --porcelain | awk '/^worktree / { count += 1 } END { print count + 0 }'
git worktree list --porcelain | awk '/^worktree |^branch |^detached$/ { print }'

section 'Recent commits'
git log --decorate --date=iso-strict --pretty=format:'%H%x09%ad%x09%d%x20%s' -12
printf '\n'

if command -v gh >/dev/null 2>&1; then
  run_or_note 'GitHub authentication' gh auth status
  run_or_note 'Open pull requests (20 most recently updated)' gh pr list --state open --limit 20 --json number,title,headRefName,baseRefName,isDraft,mergeStateStatus,reviewDecision,updatedAt,url
  run_or_note 'Recent GitHub Actions runs' gh run list --limit 12 --json databaseId,displayTitle,event,headBranch,headSha,status,conclusion,updatedAt,url,workflowName
else
  section 'GitHub'
  printf '[unproven] gh CLI is not available\n'
fi

section 'Local deployment configuration inventory'
find . -type d \( -name '.git' -o -name 'node_modules' \) -prune -o \( -name 'wrangler.toml' -o -name 'wrangler.json' -o -name 'wrangler.jsonc' \) -print | sort
find .github/workflows -maxdepth 1 -type f -name '*.yml' -printf '%f\n' | sort

if [[ "$online" -eq 1 ]]; then
  if command -v npx >/dev/null 2>&1; then
    run_or_note 'Cloudflare account metadata' npx --yes wrangler@4 whoami
    run_or_note 'Cloudflare D1 inventory' npx --yes wrangler@4 d1 list
  else
    section 'Cloudflare and D1'
    printf '[unproven] npx is not available for the read-only Wrangler inventory\n'
  fi
else
  section 'Cloudflare and D1'
  printf '[unproven] rerun with --online to inspect authenticated Cloudflare/D1 metadata; no query or deploy is performed by this collector\n'
fi

if command -v systemctl >/dev/null 2>&1; then
  run_or_note 'Native runtime units' systemctl is-active orb orb-proxy messaging-whatsapp crm booking cloudflare-orb cloudflare-runtime
else
  section 'Native runtime'
  printf '[unproven] systemctl is not available in this execution context\n'
fi

section 'Reminder'
printf '%s\n' 'This snapshot proves neither Cloudflare/D1/PostgreSQL state nor an end-to-end journey. Query only the relevant configured source with read-only credentials and record it in docs/project-state/evidence-ledger.md.'
