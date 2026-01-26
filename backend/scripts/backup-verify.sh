#!/usr/bin/env bash
set -euo pipefail

API_URL="${INSUMOS_API_URL:-https://api.skincos.com.br/insumos}"
UNIDADE="${INSUMOS_UNIDADE:-}"
COOKIE="${INSUMOS_COOKIE:-}"
CSRF="${INSUMOS_CSRF_TOKEN:-}"
RESTORE="false"
CONFIRM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url) API_URL="$2"; shift 2 ;;
    --unidade) UNIDADE="$2"; shift 2 ;;
    --cookie) COOKIE="$2"; shift 2 ;;
    --csrf) CSRF="$2"; shift 2 ;;
    --restore) RESTORE="true"; shift ;;
    --confirm) CONFIRM="$2"; shift 2 ;;
    *) echo "Uso: $0 [--api-url URL] [--unidade SLUG] [--cookie COOKIE] [--csrf TOKEN] [--restore --confirm RESTORE]"; exit 1 ;;
  esac
done

auth_headers=()
if [[ -n "$COOKIE" ]]; then auth_headers+=(-H "Cookie: $COOKIE"); fi
if [[ -n "$CSRF" ]]; then auth_headers+=(-H "X-CSRF-Token: $CSRF"); fi

echo "[backup] status"
curl -fsS "${API_URL}/backup/status" "${auth_headers[@]}" >/dev/null

if [[ -z "$COOKIE" || -z "$CSRF" ]]; then
  echo "[backup] precisa de INSUMOS_COOKIE e INSUMOS_CSRF_TOKEN para trigger/restore"
  exit 1
fi

trigger_url="${API_URL}/backup/trigger"
if [[ -n "$UNIDADE" ]]; then
  trigger_url="${trigger_url}?unidade=${UNIDADE}"
fi

echo "[backup] trigger"
trigger_resp="$(curl -fsS -X POST "${trigger_url}" -H "Content-Type: application/json" "${auth_headers[@]}" -d '{}')"

backup_id="$(printf '%s' "$trigger_resp" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));console.log(d?.data?.id||'');")"
if [[ -z "$backup_id" ]]; then
  echo "[backup] não foi possível obter id do backup"
  exit 1
fi
echo "[backup] id=${backup_id}"

echo "[backup] list"
curl -fsS "${API_URL}/backup/list?limit=5" "${auth_headers[@]}" >/dev/null

if [[ "$RESTORE" == "true" ]]; then
  if [[ "${CONFIRM}" != "RESTORE" ]]; then
    echo "[backup] para restaurar, use --restore --confirm RESTORE"
    exit 1
  fi
  echo "[backup] restore id=${backup_id}"
  curl -fsS -X POST "${API_URL}/backup/restore" -H "Content-Type: application/json" "${auth_headers[@]}" \
    -d "{\"id\":\"${backup_id}\",\"confirm\":\"RESTORE\"}" >/dev/null
fi

echo "[backup] ok"
