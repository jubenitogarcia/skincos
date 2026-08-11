#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
preload="$script_dir/preload-n8n-error-workflow-bootstrap.js"

if [[ ! -r "$preload" ]]; then
  printf '%s\n' "Missing required n8n error-workflow bootstrap: $preload" >&2
  exit 1
fi

n8n_user_folder="${N8N_USER_FOLDER:-${N8N_DATA_HOME:-}}"
if [[ -z "$n8n_user_folder" ]]; then
  printf '%s\n' 'N8N_USER_FOLDER or N8N_DATA_HOME must be configured.' >&2
  exit 78
fi
n8n_state_directory="$n8n_user_folder/.n8n"
if [[ -e "$n8n_state_directory" ]]; then
  if [[ ! -d "$n8n_state_directory" || ! -w "$n8n_state_directory" || ! -x "$n8n_state_directory" ]]; then
    printf '%s\n' "N8N state directory is unavailable or not writable: $n8n_state_directory" >&2
    exit 78
  fi
elif [[ ! -d "$n8n_user_folder" || ! -w "$n8n_user_folder" || ! -x "$n8n_user_folder" ]]; then
  printf '%s\n' "N8N user folder is unavailable or not writable: $n8n_user_folder" >&2
  exit 78
fi

case " ${NODE_OPTIONS:-} " in
  *" --require=$preload "*|*" -r $preload "*) ;;
  *) export NODE_OPTIONS="--require=$preload${NODE_OPTIONS:+ $NODE_OPTIONS}" ;;
esac

exec /usr/local/bin/n8n start "$@"
