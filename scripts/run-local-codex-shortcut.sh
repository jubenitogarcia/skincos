#!/usr/bin/env bash
# macOS actions exposed by .codex/environments/environment.toml.
# They never use the Windows/WSL gateway and keep per-machine data outside Git.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/run-local-codex-shortcut.sh <action> [--dry-run]

Actions:
  workspace  Show local Git/worktree metadata.
  context    Print the local SKINCOS context snapshot.
  autonomous Start native Codex in this worktree using the user's defaults.
  ef-app     Open the interactive EF integration through its private venv.
  orb        Open the independent Orb repository on GitHub.
  beauty-preview  Start the local Cartas da Beleza preview.

--dry-run validates the selected action without opening a browser, Codex,
the EF menu, or a preview server.
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 2
fi

action="$1"
dry_run=false
if [[ $# -eq 2 ]]; then
  if [[ "$2" != "--dry-run" ]]; then
    usage >&2
    exit 2
  fi
  dry_run=true
fi

case "$action" in
  workspace|context|autonomous|ef-app|orb|beauty-preview) ;;
  *)
    echo "Unsupported local Codex action: $action" >&2
    usage >&2
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
project_root="$(cd "$script_dir/.." && pwd -P)"
if [[ ! -f "$project_root/AGENTS.md" || ! -e "$project_root/.git" ]]; then
  echo "SKINCOS project root was not found beside this launcher." >&2
  exit 2
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command is unavailable: $1" >&2
    exit 127
  fi
}

if [[ "$dry_run" == true ]]; then
  printf 'dry-run action=%s project_root=%s\n' "$action" "$project_root"
fi

case "$action" in
  workspace)
    require_command python3
    [[ -f "$project_root/scripts/local-environment-doctor.py" ]] || { echo "Local environment doctor is missing." >&2; exit 2; }
    if [[ "$dry_run" == true ]]; then exit 0; fi
    exec python3 "$project_root/scripts/local-environment-doctor.py" --project-root "$project_root"
    ;;
  context)
    require_command bash
    [[ -x "$project_root/scripts/codex-context.sh" ]] || { echo "Context helper is missing or not executable." >&2; exit 2; }
    if [[ "$dry_run" == true ]]; then exit 0; fi
    exec bash "$project_root/scripts/codex-context.sh"
    ;;
  autonomous)
    require_command codex
    if [[ "$dry_run" == true ]]; then exit 0; fi
    exec codex --cd "$project_root"
    ;;
  ef-app)
    require_command python3
    [[ -f "$project_root/integration/ef/scripts/run-local-python.sh" ]] || { echo "EF local launcher is missing." >&2; exit 2; }
    if [[ "$dry_run" == true ]]; then
      python3 "$project_root/scripts/shared-workspace.py" environment --project-root "$project_root" >/dev/null
      exit 0
    fi
    eval "$(python3 "$project_root/scripts/shared-workspace.py" environment --project-root "$project_root")"
    export EF_MODE=menu
    export HEADLESS="${HEADLESS:-0}"
    exec bash "$project_root/integration/ef/scripts/run-local-python.sh" run_scraper.py
    ;;
  orb)
    require_command open
    if [[ "$dry_run" == true ]]; then exit 0; fi
    exec open "https://github.com/jubenitogarcia/orb"
    ;;
  beauty-preview)
    require_command python3
    [[ -f "$project_root/scripts/mac-local-preview.py" ]] || { echo "Mac local preview helper is missing." >&2; exit 2; }
    if [[ "$dry_run" == true ]]; then
      python3 "$project_root/scripts/mac-local-preview.py" --help >/dev/null
      exit 0
    fi
    exec python3 "$project_root/scripts/mac-local-preview.py" start --project-root "$project_root"
    ;;
esac
