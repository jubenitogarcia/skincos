#!/usr/bin/env bash
set -euo pipefail

if (( $# < 3 )); then
  echo 'usage: ponto-wrangler-deploy.sh <output-file> <command> [args...]' >&2
  exit 2
fi

output_file=$1
shift
attempts=${PONTO_WRANGLER_DEPLOY_ATTEMPTS:-6}
delay_seconds=${PONTO_WRANGLER_DEPLOY_DELAY_SECONDS:-5}
error_file="${output_file}.stderr"

[[ "$attempts" =~ ^[1-9][0-9]*$ ]] || { echo 'PONTO_WRANGLER_DEPLOY_ATTEMPTS must be a positive integer' >&2; exit 2; }
[[ "$delay_seconds" =~ ^[0-9]+$ ]] || { echo 'PONTO_WRANGLER_DEPLOY_DELAY_SECONDS must be a non-negative integer' >&2; exit 2; }
(( attempts <= 6 )) || { echo 'PONTO_WRANGLER_DEPLOY_ATTEMPTS exceeds the bounded retry limit' >&2; exit 2; }
(( delay_seconds <= 30 )) || { echo 'PONTO_WRANGLER_DEPLOY_DELAY_SECONDS exceeds the bounded propagation window' >&2; exit 2; }

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  rm -f "$output_file" "$error_file"
  if WRANGLER_OUTPUT_FILE_PATH="$output_file" "$@" 2> >(tee "$error_file" >&2); then
    rm -f "$error_file"
    exit 0
  fi

  if ! grep -Eq 'code: 100146|requested Worker version could not be found' "$error_file"; then
    echo "Worker version deployment failed with a non-propagation failure on attempt $attempt/$attempts" >&2
    exit 1
  fi

  if (( attempt == attempts )); then
    echo "Worker version deployment failed after $attempts bounded propagation attempts" >&2
    exit 1
  fi

  echo "Worker version deployment hit Cloudflare version propagation delay; bounded propagation retry $attempt/$((attempts - 1)) after ${delay_seconds}s" >&2
  sleep "$delay_seconds"
done
