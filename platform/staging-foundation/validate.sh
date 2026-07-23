#!/usr/bin/env bash
# Validates the real, isolated staging foundation. It generates one ephemeral
# probe token per Worker and never writes a secret value to disk or stdout.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ "${ALLOW_STAGING_SECRET_ROTATION:-}" != "1" ]; then
  echo 'Refusing to rotate staging control secrets. Re-run with ALLOW_STAGING_SECRET_ROTATION=1 after recording the change window.' >&2
  exit 2
fi

assert_json() {
  local expected_path="$1"
  local expected_value="$2"
  node -e '
    const fs = require("fs");
    const [path, expected] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const value = path.split(".").reduce((current, key) => current?.[key], data);
    if (String(value) !== expected) {
      console.error(`Expected ${path}=${expected}; received ${JSON.stringify(value)}`);
      process.exit(1);
    }
  ' "$expected_path" "$expected_value"
}

probe_worker() {
  local config_file="$1"
  local worker_url="$2"
  local expected_domain="$3"
  local token probe_id receipt=""

  token="$(openssl rand -hex 32)"
  printf '%s' "$token" | npx wrangler secret put STAGING_CONTROL_TOKEN --config "$config_file" >/dev/null

  curl --fail --silent --show-error "$worker_url/health" | assert_json 'environment' 'staging'
  curl --fail --silent --show-error "$worker_url/health" | assert_json 'domain' "$expected_domain"
  curl --fail --silent --show-error "$worker_url/readiness" | assert_json 'ok' 'true'
  curl --fail --silent --show-error "$worker_url/fixtures" | assert_json 'fixtures.0.contains_personal_data' '0'

  local probe_response=""
  for attempt in {1..12}; do
    probe_response="$(curl --silent --show-error \
      --header "x-staging-probe-token: $token" \
      --request POST "$worker_url/control/queue-probe" || true)"
    if printf '%s' "$probe_response" | node -e '
      const fs = require("fs");
      try { process.exit(JSON.parse(fs.readFileSync(0, "utf8")).id ? 0 : 1); }
      catch { process.exit(1); }
    '; then
      break
    fi
    sleep 3
  done
  probe_id="$(printf '%s' "$probe_response" | node -e '
    const fs = require("fs");
    const response = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!response.id) process.exit(1);
    process.stdout.write(response.id);
  ')"

  for attempt in {1..12}; do
    receipt="$(curl --silent --show-error "$worker_url/control/queue-probe/$probe_id" || true)"
    if [ -n "$receipt" ] && printf '%s' "$receipt" | node -e '
      const fs = require("fs");
      const response = JSON.parse(fs.readFileSync(0, "utf8"));
      process.exit(response.receipt?.received_at ? 0 : 1);
    '; then
      break
    fi
    sleep 3
  done

  if [ -z "$receipt" ] || ! printf '%s' "$receipt" | node -e '
    const fs = require("fs");
    const response = JSON.parse(fs.readFileSync(0, "utf8"));
    process.exit(response.receipt?.received_at ? 0 : 1);
  '; then
    echo "Queue consumer did not acknowledge staging probe for $expected_domain" >&2
    exit 1
  fi

  npx wrangler secret list --config "$config_file" | node -e '
    const fs = require("fs");
    const secrets = JSON.parse(fs.readFileSync(0, "utf8"));
    process.exit(secrets.some((secret) => secret.name === "STAGING_CONTROL_TOKEN") ? 0 : 1);
  '
  printf 'validated %s\n' "$expected_domain"
}

cd "$ROOT_DIR"
probe_worker platform/staging-foundation/wrangler.identity.toml https://skincos-identity-staging.skincos.workers.dev identity
probe_worker platform/staging-foundation/wrangler.inventory.toml https://skincos-inventory-staging-foundation.skincos.workers.dev inventory
probe_worker platform/staging-foundation/wrangler.finance.toml https://skincos-finance-staging-foundation.skincos.workers.dev finance
