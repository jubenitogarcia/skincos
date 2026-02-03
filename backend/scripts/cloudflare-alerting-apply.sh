#!/usr/bin/env bash
set -euo pipefail

# Applies a baseline set of Cloudflare Alerting policies in an idempotent way.
#
# Required env:
#   CLOUDFLARE_ACCOUNT_ID
#   CLOUDFLARE_ALERTS_API_TOKEN  (preferred) OR CLOUDFLARE_API_TOKEN
#
# Destination config (at least one is required):
#   CLOUDFLARE_ALERT_EMAILS          CSV of emails (e.g. "ops@skincos.com.br,dev@skincos.com.br")
#   CLOUDFLARE_ALERT_WEBHOOK_URL     Webhook URL (Slack/Discord/HTTP receiver)
#
# Optional env:
#   CLOUDFLARE_ALERT_WEBHOOK_NAME    Default: "skincos-alerts"
#   CLOUDFLARE_ZONE_NAME             Default: "skincos.com.br" (used only for best-effort Pages discovery)
#   CLOUDFLARE_PAGES_PROJECT_IDS     CSV of Pages project ids (optional filter)
#   CLOUDFLARE_PAGES_ENVIRONMENTS    CSV (default: "production,preview")
#   CLOUDFLARE_PAGES_EVENTS          CSV (optional filter)
#   CLOUDFLARE_ALERTING_DRY_RUN      "true" to print requests without mutating
#
# Output:
#   Writes cloudflare-alerting-apply.summary.json in the current directory.

api="https://api.cloudflare.com/client/v4"
acct="${CLOUDFLARE_ACCOUNT_ID:-}"
token="${CLOUDFLARE_ALERTS_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"

emails_csv="${CLOUDFLARE_ALERT_EMAILS:-}"
webhook_url="${CLOUDFLARE_ALERT_WEBHOOK_URL:-}"
webhook_name="${CLOUDFLARE_ALERT_WEBHOOK_NAME:-skincos-alerts}"

zone_name="${CLOUDFLARE_ZONE_NAME:-skincos.com.br}"
pages_project_ids_csv="${CLOUDFLARE_PAGES_PROJECT_IDS:-}"
pages_envs_csv="${CLOUDFLARE_PAGES_ENVIRONMENTS:-production,preview}"
pages_events_csv="${CLOUDFLARE_PAGES_EVENTS:-}"

dry_run="${CLOUDFLARE_ALERTING_DRY_RUN:-false}"

if [[ -z "${acct}" ]]; then
  echo "[cloudflare-alerting-apply] Missing CLOUDFLARE_ACCOUNT_ID" >&2
  exit 2
fi
if [[ -z "${token}" ]]; then
  echo "[cloudflare-alerting-apply] Missing CLOUDFLARE_ALERTS_API_TOKEN (or CLOUDFLARE_API_TOKEN)" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "[cloudflare-alerting-apply] Missing jq (required)" >&2
  exit 2
fi
if [[ -z "${emails_csv}" && -z "${webhook_url}" ]]; then
  echo "[cloudflare-alerting-apply] Missing destinations: set CLOUDFLARE_ALERT_EMAILS and/or CLOUDFLARE_ALERT_WEBHOOK_URL" >&2
  exit 2
fi

hdr=(-H "Authorization: Bearer ${token}" -H "Content-Type: application/json")

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "${tmpdir}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

csv_to_json_array() {
  local csv="${1:-}"
  if [[ -z "${csv}" ]]; then
    echo "[]"
    return 0
  fi
  jq -Rsc 'split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length>0))' <<<"${csv}"
}

cf_get() {
  local path="$1"
  curl -fsS "${hdr[@]}" "${api}${path}"
}

cf_post() {
  local path="$1"
  local body="$2"
  if [[ "${dry_run}" == "true" ]]; then
    echo "[dry-run] POST ${path}"
    echo "${body}" | jq -c .
    return 0
  fi
  curl -fsS "${hdr[@]}" -X POST "${api}${path}" --data "${body}"
}

cf_put() {
  local path="$1"
  local body="$2"
  if [[ "${dry_run}" == "true" ]]; then
    echo "[dry-run] PUT ${path}"
    echo "${body}" | jq -c .
    return 0
  fi
  curl -fsS "${hdr[@]}" -X PUT "${api}${path}" --data "${body}"
}

echo "[cloudflare-alerting-apply] token verify (best-effort)"
if [[ "${dry_run}" != "true" ]]; then
  cf_get "/user/tokens/verify" >/dev/null || true
fi

emails_json="$(csv_to_json_array "${emails_csv}")"
pages_project_ids_json="$(csv_to_json_array "${pages_project_ids_csv}")"
pages_envs_json="$(csv_to_json_array "${pages_envs_csv}")"
pages_events_json="$(csv_to_json_array "${pages_events_csv}")"

webhook_id=""
webhooks_out="${tmpdir}/webhooks.json"

if [[ -n "${webhook_url}" ]]; then
  echo "[cloudflare-alerting-apply] ensure webhook destination: ${webhook_name}"
  cf_get "/accounts/${acct}/alerting/v3/destinations/webhooks" > "${webhooks_out}"
  webhook_id="$(jq -r --arg name "${webhook_name}" '.result[]? | select(.name==$name) | .id' "${webhooks_out}" | head -n 1)"
  if [[ -z "${webhook_id}" || "${webhook_id}" == "null" ]]; then
    created="$(cf_post "/accounts/${acct}/alerting/v3/destinations/webhooks" "$(jq -n --arg name "${webhook_name}" --arg url "${webhook_url}" '{name:$name,url:$url}')")"
    webhook_id="$(jq -r '.result.id // empty' <<<"${created}" 2>/dev/null || true)"
  else
    current_url="$(jq -r --arg id "${webhook_id}" '.result[]? | select(.id==$id) | .url // empty' "${webhooks_out}" | head -n 1)"
    if [[ -n "${current_url}" && "${current_url}" != "${webhook_url}" ]]; then
      cf_put "/accounts/${acct}/alerting/v3/destinations/webhooks/${webhook_id}" "$(jq -n --arg name "${webhook_name}" --arg url "${webhook_url}" '{name:$name,url:$url}')" >/dev/null
    fi
  fi
fi

mechanisms="$(jq -n \
  --argjson emails "${emails_json}" \
  --arg webhook_id "${webhook_id}" \
  '{} | 
   if ($emails | length) > 0 then .email = $emails else . end |
   if ($webhook_id | length) > 0 then .webhooks = [$webhook_id] else . end')"

if [[ "$(jq -r 'keys|length' <<<"${mechanisms}")" == "0" ]]; then
  echo "[cloudflare-alerting-apply] No valid mechanisms resolved (check CLOUDFLARE_ALERT_EMAILS / webhook creation)" >&2
  exit 2
fi

echo "[cloudflare-alerting-apply] list policies"
policies_out="${tmpdir}/policies.json"
cf_get "/accounts/${acct}/alerting/v3/policies" > "${policies_out}"

ensure_policy() {
  local name="$1"
  local alert_type="$2"
  local description="$3"
  local filters_json="$4" # object

  local existing_id
  existing_id="$(jq -r --arg name "${name}" '.result[]? | select(.name==$name) | .id' "${policies_out}" | head -n 1)"

  local body
  body="$(jq -n \
    --arg name "${name}" \
    --arg description "${description}" \
    --arg alert_type "${alert_type}" \
    --argjson enabled true \
    --argjson mechanisms "${mechanisms}" \
    --argjson filters "${filters_json}" \
    '{
      name: $name,
      description: $description,
      alert_type: $alert_type,
      enabled: $enabled,
      mechanisms: $mechanisms
    } | if ($filters | keys | length) > 0 then .filters = $filters else . end
  ')"

  if [[ -z "${existing_id}" || "${existing_id}" == "null" ]]; then
    echo "[cloudflare-alerting-apply] create policy: ${name}"
    cf_post "/accounts/${acct}/alerting/v3/policies" "${body}" >/dev/null
  else
    echo "[cloudflare-alerting-apply] update policy: ${name}"
    cf_put "/accounts/${acct}/alerting/v3/policies/${existing_id}" "${body}" >/dev/null
  fi

  if [[ "${dry_run}" != "true" ]]; then
    cf_get "/accounts/${acct}/alerting/v3/policies" > "${policies_out}"
  fi
}

pages_filters="$(jq -n \
  --argjson pids "${pages_project_ids_json}" \
  --argjson envs "${pages_envs_json}" \
  --argjson events "${pages_events_json}" \
  '{} |
    if ($pids | length) > 0 then .project_id = $pids else . end |
    if ($envs | length) > 0 then .environment = $envs else . end |
    if ($events | length) > 0 then .event = $events else . end
  ')"

if [[ "$(jq -r 'keys|length' <<<"${pages_filters}")" == "0" ]]; then
  # Best-effort: try to discover Pages project ids to at least scope the policy.
  pages_discovered="${tmpdir}/pages-projects.json"
  if cf_get "/accounts/${acct}/pages/projects" > "${pages_discovered}" 2>/dev/null; then
    discovered_ids="$(jq -r '.result[]?.id' "${pages_discovered}" 2>/dev/null | head -n 20 | paste -sd, -)"
    if [[ -n "${discovered_ids}" ]]; then
      pages_filters="$(jq -n --argjson pids "$(csv_to_json_array "${discovered_ids}")" '{project_id:$pids}')"
      echo "[cloudflare-alerting-apply] pages projects discovered (scoping alert): ${discovered_ids}"
    fi
  fi
fi

ensure_policy "skincos - Cloudflare incidents" "incident_alert" "Incidentes do Cloudflare Status" "{}"
ensure_policy "skincos - Cloudflare maintenance" "maintenance_event_notification" "Janelas de manutenção do Cloudflare Status" "{}"
ensure_policy "skincos - Pages events" "pages_event_alert" "Eventos e falhas de deploy do Cloudflare Pages" "${pages_filters}"
ensure_policy "skincos - Origin unreachable" "real_origin_monitoring" "Cloudflare não consegue alcançar o origin" "{}"
ensure_policy "skincos - HTTP DDoS attack" "dos_attack_l7" "Alertas de ataque DDoS HTTP (L7)" "{}"
ensure_policy "skincos - Universal SSL events" "universal_ssl_event_type" "Eventos de Universal SSL (certificados / validação)" "{}"

echo "[cloudflare-alerting-apply] refresh policies list"
final="$(cf_get "/accounts/${acct}/alerting/v3/policies")"
echo "${final}" | jq '{count:(.result|length), names:(.result|map(.name)|sort)}' > cloudflare-alerting-apply.summary.json

echo "[cloudflare-alerting-apply] done"
