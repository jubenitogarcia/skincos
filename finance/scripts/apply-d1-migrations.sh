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
# Wrangler emits a JSON envelope (not a stable pretty-printed string).  Parse
# it structurally so a formatting change cannot turn an already recorded
# migration into an attempted duplicate insert.
journal_checksum_for() {
  local migration_id="$1"
  printf '%s' "$journal" | node -e '
    const fs = require("node:fs");
    const wanted = process.argv[1];
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!Array.isArray(payload)) throw new Error("unexpected D1 journal response");
    const row = payload.flatMap((entry) => entry && Array.isArray(entry.results) ? entry.results : [])
      .find((entry) => entry.id === wanted);
    if (row && typeof row.checksum === "string") process.stdout.write(row.checksum);
  ' "$migration_id"
}

run_sql "CREATE TABLE IF NOT EXISTS finance_release_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('applied','adopted')), applied_at TEXT NOT NULL);" >/dev/null
journal="$(run_sql 'SELECT id,checksum,source FROM finance_release_migrations ORDER BY id;' --json 2>/dev/null || true)"
if [[ "$ADOPT_EXISTING" -eq 1 && "$journal" != *'0001_finance_foundation.sql'* ]]; then
  # The staging D1 predates this Finance-owned release journal. Its proven
  # baseline is v6; v7-v10 must still execute normally.
  for object in finance_settings finance_movements finance_movement_splits finance_movement_revisions finance_import_batches finance_import_operations; do
    run_sql "SELECT 1 FROM $object LIMIT 1;" >/dev/null || { echo "Cannot adopt: expected baseline object missing: $object" >&2; exit 1; }
  done
  run_sql "SELECT source_adapter FROM finance_import_batches LIMIT 1;" >/dev/null || { echo 'Cannot adopt: Finance v6 import adapter columns are missing.' >&2; exit 1; }
  for file in "$ROOT_DIR"/finance/migrations/000{1,2,3,4,5,6}_*.sql; do
    id="$(basename "$file")"; checksum="$(sha256sum "$file" | awk '{print $1}')"
    run_sql "INSERT OR IGNORE INTO finance_release_migrations(id,checksum,source,applied_at) VALUES('$id','$checksum','adopted',CURRENT_TIMESTAMP);" >/dev/null
  done
  journal="$(run_sql 'SELECT id,checksum,source FROM finance_release_migrations ORDER BY id;' --json 2>/dev/null || true)"
fi

tmpdir="$(mktemp -d)"; trap 'rm -rf "$tmpdir"' EXIT
for file in "$ROOT_DIR"/finance/migrations/*.sql; do
  id="$(basename "$file")"; checksum="$(sha256sum "$file" | awk '{print $1}')"
  applied_checksum="$(journal_checksum_for "$id")"
  if [[ -n "$applied_checksum" ]]; then
    [[ "$applied_checksum" == "$checksum" ]] || { echo "Checksum drift for applied migration: $id" >&2; exit 1; }
    continue
  fi
  combined="$tmpdir/$id"
  { cat "$file"; printf "\nINSERT INTO finance_release_migrations(id,checksum,source,applied_at) VALUES('%s','%s','applied',CURRENT_TIMESTAMP);\n" "$id" "$checksum"; } > "$combined"
  echo "[finance-migrate] applying $id to $DB_NAME${ENV_NAME:+ ($ENV_NAME)}"
  run_file "$combined" >/dev/null
done
echo "[finance-migrate] Finance migrations verified for $DB_NAME."
