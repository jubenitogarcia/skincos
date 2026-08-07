#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
preload="$script_dir/preload-n8n-error-workflow-bootstrap.js"

if [[ ! -r "$preload" ]]; then
  printf '%s\n' "Missing required n8n error-workflow bootstrap: $preload" >&2
  exit 1
fi

case " ${NODE_OPTIONS:-} " in
  *" --require=$preload "*|*" -r $preload "*) ;;
  *) export NODE_OPTIONS="--require=$preload${NODE_OPTIONS:+ $NODE_OPTIONS}" ;;
esac

exec /usr/local/bin/n8n start "$@"
