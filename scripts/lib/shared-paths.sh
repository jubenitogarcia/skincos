#!/usr/bin/env bash

# Shared path bootstrap for the Skincos shared workspace.
# Prefer the shared sibling clone, but preserve explicit overrides.

if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  _shared_paths_source="${BASH_SOURCE[0]}"
else
  _shared_paths_source="$0"
fi

_shared_paths_lib_dir="$(cd "$(dirname "$_shared_paths_source")" && pwd)"
_shared_paths_script_dir="$(cd "$_shared_paths_lib_dir/.." && pwd)"
_shared_paths_repo_root="$(cd "$_shared_paths_script_dir/.." && pwd)"
_shared_paths_repo_parent="$(cd "$_shared_paths_repo_root/.." && pwd)"

SKINCOS_ROOT="${SKINCOS_ROOT:-$_shared_paths_repo_root}"
N8N_ROOT="${N8N_ROOT:-$_shared_paths_repo_parent/n8n}"

if [[ ! -d "$N8N_ROOT" && -d "$HOME/Automation/n8n" ]]; then
  N8N_ROOT="$HOME/Automation/n8n"
fi

SKINCOS_SCRIPTS_DIR="${SKINCOS_SCRIPTS_DIR:-$SKINCOS_ROOT/scripts}"
N8N_SCRIPTS_DIR="${N8N_SCRIPTS_DIR:-$N8N_ROOT/scripts}"
N8N_ENV="${N8N_ENV:-$N8N_ROOT/.env}"
EVOLUTION_ENV="${EVOLUTION_ENV:-$N8N_ROOT/evolution-api/.env}"
N8N_HEALTH_DIR="${N8N_HEALTH_DIR:-$N8N_ROOT/health}"

export SKINCOS_ROOT
export SKINCOS_SCRIPTS_DIR
export N8N_ROOT
export N8N_SCRIPTS_DIR
export N8N_ENV
export EVOLUTION_ENV
export N8N_HEALTH_DIR
