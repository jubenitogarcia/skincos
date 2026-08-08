#!/usr/bin/bash -p
set -euo pipefail

# Seal the dedicated production Clientes login before the isolated service can
# start. This accepts no database, role, schema, or SQL input.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

readonly DB_NAME='skincos_clientes_production'
readonly APP_ROLE='skincos_clientes_ro'

ACTION="${1:-}"
if [[ "$ACTION" != '--dry-run' && "$ACTION" != '--apply' ]]; then
  echo "Usage: $0 --dry-run|--apply" >&2
  exit 64
fi

for command_path in /usr/bin/sudo /usr/bin/psql; do
  [[ -x "$command_path" ]] || { echo "Missing required command: $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n true

verify_contract() {
  local actual
  actual="$(/usr/bin/sudo -n -u postgres /usr/bin/psql --dbname="$DB_NAME" --tuples-only --no-align --set=ON_ERROR_STOP=1 <<'SQL'
select case when
  coalesce((select 'default_transaction_read_only=on' = any(rolconfig)
      and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls and not rolinherit
    from pg_roles where rolname = 'skincos_clientes_ro'), false)
  and not exists (
    select 1 from pg_roles candidate
    where candidate.rolname <> 'skincos_clientes_ro'
      and pg_has_role('skincos_clientes_ro', candidate.oid, 'SET')
  )
  and not has_database_privilege('skincos_clientes_ro', current_database(), 'CREATE')
  and not has_database_privilege('skincos_clientes_ro', current_database(), 'TEMPORARY')
  and not exists (
    select 1 from pg_namespace n
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
      and has_schema_privilege('skincos_clientes_ro', n.oid, 'CREATE')
  )
  and not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (
        has_table_privilege('skincos_clientes_ro', c.oid, 'INSERT')
        or has_table_privilege('skincos_clientes_ro', c.oid, 'UPDATE')
        or has_table_privilege('skincos_clientes_ro', c.oid, 'DELETE')
        or has_table_privilege('skincos_clientes_ro', c.oid, 'TRUNCATE')
        or has_table_privilege('skincos_clientes_ro', c.oid, 'REFERENCES')
        or has_table_privilege('skincos_clientes_ro', c.oid, 'TRIGGER')
      )
  )
  and not exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and a.attnum > 0 and not a.attisdropped
      and (
        has_column_privilege('skincos_clientes_ro', c.oid, a.attname, 'INSERT')
        or has_column_privilege('skincos_clientes_ro', c.oid, a.attname, 'UPDATE')
        or has_column_privilege('skincos_clientes_ro', c.oid, a.attname, 'REFERENCES')
      )
  )
  and not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
      and c.relkind = 'S'
      and (
        has_sequence_privilege('skincos_clientes_ro', c.oid, 'USAGE')
        or has_sequence_privilege('skincos_clientes_ro', c.oid, 'UPDATE')
      )
  )
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
      and p.prosecdef
      and has_function_privilege('skincos_clientes_ro', p.oid, 'EXECUTE')
  )
  and not coalesce(has_schema_privilege('skincos_clientes_ro', to_regnamespace('harmonia'), 'USAGE'), false)
  and not coalesce(has_schema_privilege('skincos_clientes_ro', to_regnamespace('crm_caixa'), 'USAGE'), false)
  and not exists (
    select 1
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('harmonia', 'crm_caixa') and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('skincos_clientes_ro', c.oid, 'SELECT')
  )
  and not exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('harmonia', 'crm_caixa') and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('skincos_clientes_ro', c.oid, a.attname, 'SELECT')
  )
then 'true' else 'false' end;
SQL
)"
  [[ "$actual" == 'true' ]]
}

if [[ "$ACTION" == '--apply' ]]; then
  /usr/bin/sudo -n -u postgres /usr/bin/psql --dbname="$DB_NAME" --set=ON_ERROR_STOP=1 <<'SQL'
begin;
alter role skincos_clientes_ro nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
alter role skincos_clientes_ro set default_transaction_read_only = on;
revoke create, temporary on database skincos_clientes_production from skincos_clientes_ro;

do $$
declare
  relation_record record;
  column_record record;
  sequence_record record;
  schema_record record;
  membership_record record;
  function_record record;
begin
  for membership_record in
    select parent.rolname
    from pg_auth_members member
    join pg_roles parent on parent.oid = member.roleid
    where member.member = (select oid from pg_roles where rolname = 'skincos_clientes_ro')
  loop
    execute format('revoke %I from skincos_clientes_ro', membership_record.rolname);
  end loop;

  for schema_record in
    select nspname from pg_namespace
    where nspname not like 'pg_%' and nspname <> 'information_schema'
  loop
    execute format('revoke create on schema %I from skincos_clientes_ro', schema_record.nspname);
  end loop;

  for relation_record in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    execute format('revoke insert, update, delete, truncate, references, trigger on table %I.%I from skincos_clientes_ro', relation_record.nspname, relation_record.relname);
  end loop;

  for column_record in
    select n.nspname, c.relname, a.attname
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
      and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped
  loop
    execute format('revoke insert (%I), update (%I), references (%I) on table %I.%I from skincos_clientes_ro', column_record.attname, column_record.attname, column_record.attname, column_record.nspname, column_record.relname);
  end loop;

  for sequence_record in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema' and c.relkind = 'S'
  loop
    execute format('revoke all privileges on sequence %I.%I from skincos_clientes_ro', sequence_record.nspname, sequence_record.relname);
  end loop;

  for function_record in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
      and p.prosecdef
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from skincos_clientes_ro',
      function_record.nspname,
      function_record.proname,
      function_record.identity_arguments
    );
  end loop;
end $$;

do $$
declare
  column_record record;
  relation_record record;
begin
  if exists (select 1 from pg_namespace where nspname = 'harmonia') then
    execute 'revoke all privileges on schema harmonia from skincos_clientes_ro';
  end if;
  if exists (select 1 from pg_namespace where nspname = 'crm_caixa') then
    execute 'revoke all privileges on schema crm_caixa from skincos_clientes_ro';
  end if;

  for relation_record in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('harmonia', 'crm_caixa') and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    execute format('revoke select on table %I.%I from skincos_clientes_ro', relation_record.nspname, relation_record.relname);
  end loop;

  for column_record in
    select n.nspname, c.relname, a.attname
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('harmonia', 'crm_caixa') and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format('revoke select (%I) on table %I.%I from skincos_clientes_ro', column_record.attname, column_record.nspname, column_record.relname);
  end loop;
end $$;
commit;
SQL
fi

if ! verify_contract; then
  echo 'Production runtime grant contract is not read-only.' >&2
  exit 1
fi

printf 'production_runtime_grants_read_only=true database=%s role=%s action=%s pii_harmonia_read=false pii_caixa_source_read=false role_set_blocked=true privileged_function_execute_blocked=true\n' "$DB_NAME" "$APP_ROLE" "$ACTION"
