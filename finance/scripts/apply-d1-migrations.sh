#!/usr/bin/env bash
set -euo pipefail

# Finance owns this migration journal.  It intentionally does not reuse the
# Inventory journal: a Finance release must be traceable and deployable on its
# own, while still sharing the official SKINCOS D1 binding.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MODE=""
ENV_NAME=""
ADOPT_EXISTING=0
DB_NAME=""
PERSIST_TO=""

usage() {
  cat <<'EOF'
Usage: finance/scripts/apply-d1-migrations.sh --local|--remote [--env staging] [--database NAME] [--persist-to PATH] [--adopt-existing-schema]

`--adopt-existing-schema` is a one-time, explicit reconciliation for a D1
database which already has Finance v1-v10 tables but no Finance migration
journal. It verifies the expected baseline before marking it adopted; it never
silently assumes that an existing schema is current.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local|--remote) MODE="$1" ;;
    --env) ENV_NAME="${2:?missing environment}"; shift ;;
    --database) DB_NAME="${2:?missing database}"; shift ;;
    --persist-to) PERSIST_TO="${2:?missing path}"; shift ;;
    --adopt-existing-schema) ADOPT_EXISTING=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
[[ -n "$MODE" ]] || { usage >&2; exit 2; }
[[ "$MODE" == "--remote" || "$ADOPT_EXISTING" -eq 0 ]] || { echo '--adopt-existing-schema is only for a reviewed remote baseline.' >&2; exit 2; }

if [[ -n "${WRANGLER_BIN:-}" ]]; then
  [[ -x "$WRANGLER_BIN" ]] || { echo "Wrangler unavailable: $WRANGLER_BIN" >&2; exit 1; }
  WRANGLER=("$WRANGLER_BIN")
elif [[ -x "$ROOT_DIR/api/node_modules/.bin/wrangler" ]]; then
  WRANGLER=("$ROOT_DIR/api/node_modules/.bin/wrangler")
else
  # CI installs api dependencies first. The fallback keeps the audited command
  # usable from a clean operator worktree without committing dependencies.
  WRANGLER=(npx --yes wrangler@4.112.0)
fi
if [[ -z "$DB_NAME" ]]; then
  [[ "$ENV_NAME" == "staging" ]] && DB_NAME="skincos-db-staging" || DB_NAME="skincos-db"
fi

args=(d1 execute "$DB_NAME" "$MODE" --config "$ROOT_DIR/api/wrangler.toml")
[[ -n "$ENV_NAME" ]] && args+=(--env "$ENV_NAME")
[[ -n "$PERSIST_TO" ]] && args+=(--persist-to "$PERSIST_TO")
run_sql() { local sql="$1"; shift; "${WRANGLER[@]}" "${args[@]}" --command "$sql" "$@"; }
run_file() { "${WRANGLER[@]}" "${args[@]}" --file "$1"; }

run_sql "CREATE TABLE IF NOT EXISTS finance_schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('applied','adopted')), applied_at TEXT NOT NULL);" >/dev/null
journal="$(run_sql 'SELECT id,checksum,source FROM finance_schema_migrations ORDER BY id;' --json 2>/dev/null || true)"
if [[ "$ADOPT_EXISTING" -eq 1 && "$journal" != *'0001_finance_foundation.sql'* ]]; then
  # The staging D1 predates the Finance journal. Its proven baseline is v7:
  # v8-v10 added workflow evidence and must still execute normally. Checking
  # the v7 trigger prevents silently adopting a pre-integrity schema.
  for object in finance_settings finance_movements finance_movement_splits finance_movement_revisions finance_import_batches finance_import_operations; do
    run_sql "SELECT 1 FROM $object LIMIT 1;" >/dev/null || { echo "Cannot adopt: expected baseline object missing: $object" >&2; exit 1; }
  done
  run_sql "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='finance_movements_no_delete' LIMIT 1;" | grep -q 'finance_movements_no_delete' || { echo 'Cannot adopt: Finance v7 integrity trigger is missing.' >&2; exit 1; }
  for file in "$ROOT_DIR"/finance/migrations/000{1,2,3,4,5,6,7}_*.sql; do
    id="$(basename "$file")"; checksum="$(sha256sum "$file" | awk '{print $1}')"
    run_sql "INSERT OR IGNORE INTO finance_schema_migrations(id,checksum,source,applied_at) VALUES('$id','$checksum','adopted',CURRENT_TIMESTAMP);" >/dev/null
  done
  journal="$(run_sql 'SELECT id,checksum,source FROM finance_schema_migrations ORDER BY id;' --json 2>/dev/null || true)"
fi

tmpdir="$(mktemp -d)"; trap 'rm -rf "$tmpdir"' EXIT
for file in "$ROOT_DIR"/finance/migrations/*.sql; do
  id="$(basename "$file")"; checksum="$(sha256sum "$file" | awk '{print $1}')"
  if grep -Fq "\"id\": \"$id\"" <<<"$journal"; then
    grep -Fq "$checksum" <<<"$journal" || { echo "Checksum drift for applied migration: $id" >&2; exit 1; }
    continue
  fi
  combined="$tmpdir/$id"
  { cat "$file"; printf "\nINSERT INTO finance_schema_migrations(id,checksum,source,applied_at) VALUES('%s','%s','applied',CURRENT_TIMESTAMP);\n" "$id" "$checksum"; } > "$combined"
  echo "[finance-migrate] applying $id to $DB_NAME${ENV_NAME:+ ($ENV_NAME)}"
  run_file "$combined" >/dev/null
done
echo "[finance-migrate] Finance migrations verified for $DB_NAME."
