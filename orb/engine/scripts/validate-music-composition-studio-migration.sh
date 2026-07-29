#!/usr/bin/env bash
set -euo pipefail

ENGINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ENGINE_ROOT/db/migrations/20260724_music_composition_studio.sql"
VALIDATION_DB="msc_validation_${UID}_$$"

if [[ ! "$VALIDATION_DB" =~ ^msc_validation_[0-9]+_[0-9]+$ ]]; then
  echo "refusing unsafe validation database name: $VALIDATION_DB" >&2
  exit 2
fi

if sudo -n -u postgres psql -d postgres -Atqc \
  "select 1 from pg_database where datname = '$VALIDATION_DB'" | grep -qx 1; then
  echo "refusing to reuse existing database: $VALIDATION_DB" >&2
  exit 2
fi

cleanup() {
  sudo -n -u postgres dropdb --if-exists "$VALIDATION_DB" >/dev/null
}
trap cleanup EXIT

sudo -n -u postgres createdb "$VALIDATION_DB"
sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d "$VALIDATION_DB" \
  -f "$MIGRATION" >/dev/null
sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d "$VALIDATION_DB" \
  -f "$MIGRATION" >/dev/null

table_count="$(
  sudo -n -u postgres psql -d "$VALIDATION_DB" -Atqc \
    "select count(*) from information_schema.tables where table_schema = 'music_studio'"
)"
[[ "$table_count" == "16" ]]

sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d "$VALIDATION_DB" >/dev/null <<'SQL'
begin;
insert into music_studio.music_productions (
  production_id,
  composition_id,
  production_tier,
  status,
  input_hash
) values (
  'MSC-TX-1',
  'CMP-TX-1',
  'FAST',
  'VALIDATING',
  'hash'
);
insert into music_studio.music_jobs (
  job_key,
  production_id,
  module,
  component_id,
  revision,
  input_hash,
  status
) values (
  'job-1',
  'MSC-TX-1',
  'MSC-30',
  'lab',
  1,
  'hash',
  'QUEUED'
);
rollback;
SQL

row_count="$(
  sudo -n -u postgres psql -d "$VALIDATION_DB" -Atqc \
    "select count(*) from music_studio.music_productions"
)"
[[ "$row_count" == "0" ]]

echo "PostgreSQL migration validation: OK (16 tables; idempotent apply; FK insert; rollback preserved zero rows)"
