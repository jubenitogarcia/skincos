#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-skincos.com.br}"
ALIAS_ROUTES="${ALIAS_ROUTES:-compras@skincos.com.br=financeiro@skincos.com.br}"
WRANGLER_CWD="${WRANGLER_CWD:-website}"

fail=0

ok() {
  printf 'OK   %s\n' "$*"
}

warn() {
  printf 'WARN %s\n' "$*"
}

bad() {
  printf 'FAIL %s\n' "$*" >&2
  fail=1
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    bad "required command not found: $1"
  fi
}

need_cmd dig

IFS=',' read -r -a route_pairs <<<"$ALIAS_ROUTES"
if [[ "${#route_pairs[@]}" -eq 0 ]]; then
  bad "ALIAS_ROUTES is empty"
fi

printf '[email-alias-routing] validating domain guardrails for %s\n' "$DOMAIN"
printf '[email-alias-routing] expected aliases:\n'
for pair in "${route_pairs[@]}"; do
  alias="${pair%%=*}"
  destination="${pair#*=}"
  if [[ -z "$alias" || -z "$destination" || "$alias" == "$destination" || "$pair" != *"="* ]]; then
    bad "invalid alias route: ${pair}"
  else
    printf 'ROUTE %s -> %s\n' "$alias" "$destination"
  fi
done

mx_records="$(dig "$DOMAIN" MX +short | sort -n || true)"
if [[ -z "$mx_records" ]]; then
  bad "no MX records returned for ${DOMAIN}"
else
  printf '%s\n' "$mx_records" | sed 's/^/MX    /'
fi

if printf '%s\n' "$mx_records" | grep -Eq 'mx0[12]\.mail\.icloud\.com\.?$'; then
  ok "iCloud MX records are present"
else
  bad "expected iCloud MX records are missing"
fi

if printf '%s\n' "$mx_records" | grep -Eq 'route[123]\.mx\.cloudflare\.net\.?$'; then
  bad "Cloudflare Email Routing MX records are active; this would migrate domain email"
else
  ok "Cloudflare Email Routing MX records are not active"
fi

txt_records="$(dig "$DOMAIN" TXT +short || true)"
if printf '%s\n' "$txt_records" | grep -Fq 'include:icloud.com'; then
  ok "SPF includes iCloud"
else
  warn "SPF does not include iCloud; verify whether iCloud Mail is still the intended provider"
fi

settings_output=""
rules_output=""

if [[ -d "$WRANGLER_CWD" ]] && command -v npx >/dev/null 2>&1; then
  settings_output="$(
    cd "$WRANGLER_CWD"
    npx --yes wrangler@4 email routing settings "$DOMAIN" 2>&1
  )" || settings_status=$?
  settings_status="${settings_status:-0}"

  if [[ "$settings_status" -eq 0 ]]; then
    if printf '%s\n' "$settings_output" | grep -Eq 'Enabled:[[:space:]]+false'; then
      ok "Cloudflare Email Routing is disabled for ${DOMAIN}"
    elif printf '%s\n' "$settings_output" | grep -Eq 'Enabled:[[:space:]]+true'; then
      bad "Cloudflare Email Routing is enabled for ${DOMAIN}"
    else
      warn "could not parse Cloudflare Email Routing enabled state"
    fi
  else
    warn "could not read Cloudflare Email Routing settings via Wrangler"
  fi

  rules_output="$(
    cd "$WRANGLER_CWD"
    npx --yes wrangler@4 email routing rules list "$DOMAIN" 2>&1
  )" || rules_status=$?
  rules_status="${rules_status:-0}"

  if [[ "$rules_status" -eq 0 ]]; then
    if printf '%s\n' "$rules_output" | grep -Fq 'No custom routing rules found.'; then
      ok "no Cloudflare custom routing rules exist for ${DOMAIN}"
    else
      warn "Cloudflare has custom email routing rules; checking expected aliases"
    fi

    for pair in "${route_pairs[@]}"; do
      alias="${pair%%=*}"
      if [[ -n "$alias" ]] && printf '%s\n' "$rules_output" | grep -Fq "$alias"; then
        bad "Cloudflare has a routing rule for ${alias}; iCloud should own this alias"
      fi
    done
  else
    warn "could not list Cloudflare Email Routing rules via Wrangler"
  fi
else
  warn "Wrangler check skipped; ${WRANGLER_CWD}/ or npx unavailable"
fi

if [[ "$fail" -ne 0 ]]; then
  printf '[email-alias-routing] result: FAIL\n' >&2
  exit 1
fi

printf '[email-alias-routing] result: OK\n'
printf '[email-alias-routing] delivery still requires an external email test to each alias.\n'
