#!/usr/bin/env bash
set -euo pipefail

# Exports Cloudflare Alerting/Notifications data for inspection.
#
# Required env:
#   CLOUDFLARE_API_TOKEN
#   CLOUDFLARE_ACCOUNT_ID
#
# Optional env:
#   CLOUDFLARE_ZONE_NAME (default: skincos.com.br)
#
# Output files are written to the current working directory.

api="https://api.cloudflare.com/client/v4"
token="${CLOUDFLARE_API_TOKEN:-}"
acct="${CLOUDFLARE_ACCOUNT_ID:-}"
zone_name="${CLOUDFLARE_ZONE_NAME:-skincos.com.br}"

if [[ -z "${token}" ]]; then
  echo "[cloudflare-alerting-export] Missing CLOUDFLARE_API_TOKEN" >&2
  exit 2
fi
if [[ -z "${acct}" ]]; then
  echo "[cloudflare-alerting-export] Missing CLOUDFLARE_ACCOUNT_ID" >&2
  exit 2
fi

hdr=(-H "Authorization: Bearer ${token}" -H "Content-Type: application/json")

curl_json() {
  local path="$1"
  local out="$2"
  local url="${api}${path}"
  local code
  code="$(curl -sS -o "${out}" -w "%{http_code}" "${hdr[@]}" "${url}" || true)"
  echo "${code}"
}

echo "[cloudflare-alerting-export] token verify"
curl -fsS "${hdr[@]}" "${api}/user/tokens/verify" > token_verify.json

echo "[cloudflare-alerting-export] eligible destinations"
curl_json "/accounts/${acct}/alerting/v3/destinations/eligible" eligible_destinations.json >/dev/null

echo "[cloudflare-alerting-export] policies list"
curl_json "/accounts/${acct}/alerting/v3/policies" policies.json >/dev/null

echo "[cloudflare-alerting-export] zones (name=${zone_name})"
curl_json "/zones?name=${zone_name}&status=active" zones.json >/dev/null

zone_id=""
if command -v jq >/dev/null 2>&1; then
  zone_id="$(jq -r '.result[0].id // empty' zones.json 2>/dev/null || true)"
fi
if [[ -n "${zone_id}" ]]; then
  echo "${zone_id}" > zone_id.txt
fi

echo "[cloudflare-alerting-export] discover alert types (best-effort)"
alert_out="alert_types.json"
rm -f "${alert_out}" 2>/dev/null || true

# Cloudflare has changed alerting APIs over time; try multiple endpoints and keep the first that works.
declare -a candidates=(
  "/accounts/${acct}/alerting/v3/available_alerts"
  "/accounts/${acct}/alerting/v3/alerts"
  "/accounts/${acct}/alerting/v3/alert-types"
  "/accounts/${acct}/alerting/v3/rules"
  "/accounts/${acct}/alerting/v3/policies/available"
)

for p in "${candidates[@]}"; do
  code="$(curl_json "${p}" "${alert_out}" || true)"
  if [[ "${code}" == "200" ]]; then
    echo "${p}" > alert_types_endpoint.txt
    break
  fi
done

if [[ ! -f "${alert_out}" ]]; then
  echo "{}" > "${alert_out}"
  echo "none" > alert_types_endpoint.txt
fi

echo "[cloudflare-alerting-export] done"

