#!/usr/bin/env bash
set -euo pipefail

API=${API:-http://localhost:8099}
WA=${WA:-http://localhost:3001}
FE=${FE:-http://localhost:5173}

json() { jq -r "$1" 2>/dev/null || echo "-"; }

measure() {
  local url=$1
  local label=$2
  local rt
  rt=$(curl -s -o /dev/null -w "%{time_total}" "$url" || true)
  printf "%24s  %8.3f ms  %s\n" "$label" "$(echo "$rt * 1000" | bc -l)" "$url"
}

printf "\n== Health ==\n"
measure "$API/api/health" "API health"
measure "$WA/health" "WA health"
measure "$FE/health" "FE health"
measure "$FE/whatsapp/health" "FE→WA health"

printf "\n== Orchestrator ==\n"
measure "$API/api/wa-orchestrator/status" "orchestrator status"
measure "$API/api/wa-orchestrator/channels" "channels list"

printf "\n== Done ==\n"
