#!/usr/bin/env bash
set -euo pipefail

# Applies an isolated-domain migration set with a domain-local checksum journal.
# It refuses the current shared compatibility databases by construction.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DOMAIN="${1:-}"; shift || true
MODE=""; ENV_NAME=""; DB_NAME=""; PERSIST_TO=""

usage() {
  echo "Usage: $0 <identity|inventory|finance> --local|--remote --database NAME [--env staging] [--persist-to PATH]" >&2
}
case "$DOMAIN" in
  identity) MIGRATIONS_DIR="$ROOT_DIR/identity/d1/migrations"; JOURNAL="identity_release_migrations" ;;
  inventory) MIGRATIONS_DIR="$ROOT_DIR/inventory/d1/migrations"; JOURNAL="inventory_release_migrations" ;;
  finance) MIGRATIONS_DIR="$ROOT_DIR/finance/migrations"; JOURNAL="finance_release_migrations" ;;
  *) usage; exit 2 ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local|--remote) MODE="$1" ;;
    --database) DB_NAME="${2:?missing database}"; shift ;;
    --env) ENV_NAME="${2:?missing environment}"; shift ;;
    --persist-to) PERSIST_TO="${2:?missing path}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done
[[ -n "$MODE" && -n "$DB_NAME" ]] || { usage; exit 2; }
[[ "$ENV_NAME" == "" || "$ENV_NAME" == "staging" ]] || { echo "Only staging or the explicit production default are valid." >&2; exit 2; }

expected="skincos-$DOMAIN"
[[ "$ENV_NAME" == "staging" ]] && expected+="-staging"
if [[ "$MODE" == "--remote" && "$DB_NAME" != "$expected" ]]; then
  echo "Refusing remote $DOMAIN migration for $DB_NAME; expected isolated target $expected." >&2
  exit 2
fi
[[ "$DB_NAME" != "skincos-db" && "$DB_NAME" != "skincos-db-staging" ]] || { echo "The shared compatibility D1 is never a target of this command." >&2; exit 2; }
if [[ "$MODE" == "--remote" && -z "$ENV_NAME" && "${D1_PRODUCTION_CHANGE_APPROVED:-}" != "1" ]]; then
  echo "Production D1 migrations require explicit D1_PRODUCTION_CHANGE_APPROVED=1 after the approved staging validation." >&2
  exit 2
fi

if [[ -n "${WRANGLER_BIN:-}" ]]; then WRANGLER=("$WRANGLER_BIN"); else WRANGLER=(npx --yes wrangler@4.112.0); fi
args=(d1 execute "$DB_NAME" "$MODE")
[[ -n "$PERSIST_TO" ]] && args+=(--persist-to "$PERSIST_TO")
run_sql() { local sql="$1"; shift; "${WRANGLER[@]}" "${args[@]}" --command "$sql" "$@" >/dev/null; }
run_file() { "${WRANGLER[@]}" "${args[@]}" --file "$1" >/dev/null; }

run_sql "CREATE TABLE IF NOT EXISTS $JOURNAL (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);"
for file in "$MIGRATIONS_DIR"/*.sql; do
  id="$(basename "$file")"; checksum="$(sha256sum "$file" | awk '{print $1}')"
  current="$("${WRANGLER[@]}" "${args[@]}" --command "SELECT checksum FROM $JOURNAL WHERE id='$id';" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);const r=(p||[]).flatMap(x=>x.results||[])[0];if(r?.checksum)process.stdout.write(r.checksum)})')"
  if [[ -n "$current" ]]; then
    [[ "$current" == "$checksum" ]] || { echo "Checksum drift for $DOMAIN migration $id" >&2; exit 1; }
    continue
  fi
  combined="$(mktemp)"; trap 'rm -f "$combined"' EXIT
  { cat "$file"; printf "\nINSERT INTO %s(id,checksum,applied_at) VALUES('%s','%s',CURRENT_TIMESTAMP);\n" "$JOURNAL" "$id" "$checksum"; } > "$combined"
  echo "[d1-$DOMAIN] applying $id to $DB_NAME"
  run_file "$combined"
  rm -f "$combined"; trap - EXIT
done
echo "[d1-$DOMAIN] journal verified for $DB_NAME"
