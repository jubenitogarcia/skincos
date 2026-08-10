#!/usr/bin/env bash
set -euo pipefail

if (( $# > 0 )); then
  projects=("$@")
else
  projects=(skincos skincos-staging)
fi

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"
WRANGLER_CONFIG="${WRANGLER_CONFIG_FILE:-${HOME}/.config/.wrangler/config/default.toml}"
printf 'Cloudflare Pages project inventory (read-only)\n'
inventory="$(npx --yes wrangler@4 pages project list)"
printf '%s\n' "$inventory"
for project in "${projects[@]}"; do
  printf '\n--- project=%s ---\n' "$project"
  printf '%s\n' "$inventory" | awk -v wanted="$project" '$0 ~ "│ " wanted " " { print; found=1 } END { if (!found) exit 1 }'
done

if [[ -n "$ACCOUNT_ID" && -s "$WRANGLER_CONFIG" ]]; then
  token="$(sed -nE 's/^[[:space:]]*(oauth_token|api_token)[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\2/p' "$WRANGLER_CONFIG" | head -n 1)"
  if [[ -n "$token" ]]; then
    for project in "${projects[@]}"; do
      payload="$(curl -fsS \
        -H "Authorization: Bearer ${token}" \
        -H 'Content-Type: application/json' \
        "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${project}")"
      PROJECT_NAME="$project" PAYLOAD="$payload" node <<'NODE'
const data = JSON.parse(process.env.PAYLOAD);
if (!data.success) throw new Error(`Cloudflare Pages API read failed for ${process.env.PROJECT_NAME}`);
const source = data.result?.source;
const config = source?.config || {};
const safeConfig = Object.fromEntries(
  Object.entries(config).filter(([key]) => /owner|repo|production_branch|pr_comments|deployments_enabled|preview_deployment_setting/i.test(key)),
);
console.log(JSON.stringify({
  project: process.env.PROJECT_NAME,
  source: source ? { type: source.type || null, config: safeConfig } : null,
}, null, 2));
NODE
    done
  fi
fi
