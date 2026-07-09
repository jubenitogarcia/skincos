#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ONLINE=false

usage() {
  cat <<'EOF'
Usage: scripts/codex-context.sh [--online]

Prints safe, non-secret project context for Codex App sessions:
- repo/branch/state;
- relevant docs and entrypoints;
- recommended commands by surface;
- optional live endpoint checks.

No secrets are printed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --online) ONLINE=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

cd "$ROOT_DIR"

section() {
  printf '\n## %s\n' "$1"
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' --max-time 12 "$url" 2>/dev/null || printf 'ERR'
}

section "Skincos Codex Context"
printf 'cwd=%s\n' "$ROOT_DIR"
printf 'date=%s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
branch="$(git branch --show-current 2>/dev/null || true)"
head="$(git log -1 --oneline 2>/dev/null || true)"
if [[ -n "$head" ]]; then
  printf 'branch=%s\n' "${branch:-detached}"
  printf 'head=%s\n' "$head"
else
  printf 'branch=unavailable\n'
  printf 'head=unavailable\n'
fi

section "Worktree"
if ! status="$(git status --short 2>/dev/null)"; then
  echo "git_status=unavailable"
  echo "git_note=Git metadata could not be read from this shell; Windows/WSL worktrees may need safe.directory or a matching gitdir path."
elif [[ -z "$status" ]]; then
  echo "clean=true"
else
  echo "clean=false"
  printf '%s\n' "$status" | sed 's/^/  /'
fi

section "Source Of Truth"
cat <<'EOF'
site_public=modules/site-public/website/ (espacofacial.com, booking, tracking, WhatsApp, CAPI)
crm=frontend/ + backend/apps/crm-api/ (crm.skincos.com.br)
meta_ads=frontend/ + backend/apps/meta-ads/
cloudflare=.github/workflows/ + wrangler configs + scripts/cloudflare-token-health.sh
codex_docs=AGENTS.md, docs/codex-app-native.md, docs/codex-autonomy.md
EOF

section "Preferred Plugin Routing"
cat <<'EOF'
Browser: local/prod UI QA, screenshots, interaction checks
Build Web Apps: React/frontend refactors, dashboard UX, Playwright flows
Cloudflare: Workers, Pages, D1, routes, deploy verification
GitHub: PRs, checks, automerge, workflow/deploy evidence
Sites: prototypes/demos only; production site stays in modules/site-public/website/ unless explicitly migrated
Security: auth/session/tracking/secrets threat review
EOF

section "Fast Commands"
cat <<'EOF'
context=npm run codex:context
preflight=npm run codex:preflight
site_check=npm run codex:site:check
site_live_check=npm run codex:site:live-check
site_release_check=npm run codex:site:release-check
site_ef_smoke=npm run codex:crm:site-smoke
meta_ads_smoke=npm run codex:crm:meta-ads-smoke
atendimento_clinica_smoke=npm run codex:crm:atendimento-clinica-smoke
crm_local=npm run crm:local
EOF

if $ONLINE; then
  section "Live Endpoint Smoke"
  printf 'espacofacial.com=%s\n' "$(http_code 'https://espacofacial.com')"
  printf 'crm.skincos.com.br=%s\n' "$(http_code 'https://crm.skincos.com.br')"
  printf 'crm_health=%s\n' "$(http_code 'https://crm.skincos.com.br/api/health')"
  printf 'site_custom_urls_unauth=%s (401 expected)\n' "$(http_code 'https://espacofacial.com/api/tracking/custom-urls')"

  section "Live Website Release Signals"
  if command -v node >/dev/null 2>&1 && [[ -f scripts/site-live-check.mjs ]]; then
    node ./scripts/site-live-check.mjs --summary --no-fail || true
  else
    echo "site_live_check=SKIPPED (node unavailable)"
  fi
  cat <<'EOF'
site_release_note=website deploy source is modules/site-public/website/; old website/ does not trigger deploy
esfa_redirect_note=esfa.co resolves D1 site_custom_urls before ESFA_REDIRECTS fallback
cloudflare_note=Wrangler local auth may be absent; prefer GitHub Actions for audited Worker/D1 production sync
EOF
fi
