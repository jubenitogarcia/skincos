#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const source = 'skincos-db-staging';
const targets = { identity: 'skincos-identity-staging', inventory: 'skincos-inventory-staging', finance: 'skincos-finance-staging' };
const execute = process.argv.includes('--execute');
const requestedDomain = process.argv.includes('--domain') ? String(process.argv[process.argv.indexOf('--domain') + 1] || '') : '';
if (requestedDomain && !targets[requestedDomain]) throw new Error('--domain must be identity, inventory or finance');
const selected = (domain) => !requestedDomain || requestedDomain === domain;
if (!execute) {
  console.log('plan only: pass --execute with SKINCOS_STAGING_DATA_MIGRATION_ACK=1 after migrations are verified');
  process.exit(0);
}
if (process.env.SKINCOS_STAGING_DATA_MIGRATION_ACK !== '1') throw new Error('SKINCOS_STAGING_DATA_MIGRATION_ACK=1 is required for remote staging D1 writes');

const parse = (output) => JSON.parse(output).flatMap((entry) => entry?.results || []);
const d1 = (database, args) => execFileSync('npx', ['wrangler', 'd1', 'execute', database, '--remote', ...args, '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const query = (database, statement) => parse(d1(database, ['--command', statement]));
const quote = (value) => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const checksum = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const runSql = (database, statement) => {
  const temp = path.join(os.tmpdir(), `skincos-shadow-${randomUUID()}.sql`);
  fs.writeFileSync(temp, statement);
  try { d1(database, ['--file', temp]); }
  finally { fs.rmSync(temp, { force: true }); }
};
const addObject = (database, runId, object) => runSql(database, `INSERT OR REPLACE INTO domain_migration_objects(run_id,object_name,classification,action,source_count,target_count,source_checksum,target_checksum,verified_at) VALUES(${quote(runId)},${quote(object.name)},${quote(object.classification)},${quote(object.action)},${object.sourceCount},${object.targetCount},${quote(object.sourceChecksum)},${quote(object.targetChecksum)},CURRENT_TIMESTAMP);`);
const start = (domain) => {
  const id = `${domain}-shadow-${randomUUID()}`;
  runSql(targets[domain], `INSERT INTO domain_migration_runs(id,domain,source_database,mode,status,started_at,notes) VALUES(${quote(id)},${quote(domain)},${quote(source)},'shadow','started',CURRENT_TIMESTAMP,'legacy shared staging remains read-primary; no production route is changed');`);
  return id;
};
const finish = (domain, id) => runSql(targets[domain], `UPDATE domain_migration_runs SET status='verified',finished_at=CURRENT_TIMESTAMP WHERE id=${quote(id)};`);

// Identity reads only non-identifying authorization semantics. The destination
// receives deterministic staging subjects, disabled passwords and no sessions.
if (selected('identity')) {
  const runId = start('identity');
  const sourceRows = query(source, "SELECT ROW_NUMBER() OVER (ORDER BY username) AS source_ordinal, role, COALESCE(allowed_units_json,'[]') AS allowed_units_json, COALESCE(allowed_modules_json,'[]') AS allowed_modules_json, ativo, COALESCE(session_version,0) AS session_version FROM crm_users");
  const sourceChecksum = checksum(sourceRows);
  const inserts = sourceRows.map((row) => `INSERT OR REPLACE INTO identity_users(id,source_ordinal,username,email,display_name,password_hash,role,allowed_units_json,allowed_modules_json,ativo,session_version,migration_state,created_at,updated_at) VALUES(${quote(`identity-shadow-${row.source_ordinal}`)},${row.source_ordinal},${quote(`staging-user-${row.source_ordinal}`)},${quote(`staging-user-${row.source_ordinal}@example.invalid`)},${quote(`Staging User ${row.source_ordinal}`)},'!shadow-non-loginable!',${quote(row.role)},${quote(row.allowed_units_json)},${quote(row.allowed_modules_json)},${Number(row.ativo) ? 1 : 0},${Number(row.session_version) || 0},'shadow',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`).join('\n');
  if (inserts) runSql(targets.identity, inserts);
  const targetRows = query(targets.identity, 'SELECT source_ordinal,role,allowed_units_json,allowed_modules_json,ativo,session_version FROM identity_users WHERE migration_state=\'shadow\' ORDER BY source_ordinal');
  if (sourceRows.length !== targetRows.length || sourceChecksum !== checksum(targetRows)) throw new Error('identity sanitized shadow checksum or count mismatch');
  addObject(targets.identity, runId, { name: 'crm_users', classification: 'sanitized', action: 'copied', sourceCount: sourceRows.length, targetCount: targetRows.length, sourceChecksum, targetChecksum: checksum(targetRows) });
  for (const table of ['crm_invites', 'crm_password_resets', 'crm_user_prefs']) {
    const count = Number(query(source, `SELECT COUNT(*) AS count FROM ${table}`)[0]?.count || 0);
    addObject(targets.identity, runId, { name: table, classification: 'withheld_sensitive', action: 'withheld', sourceCount: count, targetCount: 0, sourceChecksum: null, targetChecksum: null });
  }
  finish('identity', runId);
}

// Inventory has no current operational rows in shared staging. Record the
// zero-count reconciliation and add one clearly synthetic fixture for a real
// isolated-schema read/write validation.
if (selected('inventory')) {
  const runId = start('inventory');
  for (const table of ['insumos_categories', 'insumos_items', 'insumos_stocks', 'insumos_barcodes', 'insumos_movements']) {
    const count = Number(query(source, `SELECT COUNT(*) AS count FROM ${table}`)[0]?.count || 0);
    addObject(targets.inventory, runId, { name: table, classification: table === 'insumos_movements' ? 'withheld_sensitive' : 'non_personal', action: count ? 'withheld' : 'reconciled', sourceCount: count, targetCount: 0, sourceChecksum: count ? null : checksum([]), targetChecksum: checksum([]) });
  }
  runSql(targets.inventory, "INSERT OR IGNORE INTO insumos_categories(slug,label,requires_lot,requires_expiry,fefo,created_at,updated_at) VALUES('staging-synthetic','Synthetic staging category',0,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);");
  const fixtureCount = Number(query(targets.inventory, "SELECT COUNT(*) AS count FROM insumos_categories WHERE slug='staging-synthetic'")[0]?.count || 0);
  addObject(targets.inventory, runId, { name: 'controlled_inventory_fixture', classification: 'non_personal', action: 'fixture', sourceCount: 0, targetCount: fixtureCount, sourceChecksum: checksum([]), targetChecksum: checksum([{ slug: 'staging-synthetic' }]) });
  finish('inventory', runId);
}

// Finance copies only settings and scopes. Financial operations, grants,
// imports and audit evidence remain withheld until an approved sanitizer exists.
if (selected('finance')) {
  const runId = start('finance');
  for (const [table, columns] of [['finance_settings', ['key','value']], ['finance_scopes', ['id','kind','unit_slug','label','active','currency']]]) {
    const sourceRows = query(source, `SELECT ${columns.join(',')} FROM ${table} ORDER BY ${columns[0]}`);
    for (const row of sourceRows) {
      const values = columns.map((column) => quote(row[column])).join(',');
      runSql(targets.finance, `INSERT OR IGNORE INTO ${table}(${columns.join(',')}${table === 'finance_settings' ? ',updated_at' : ',created_at,updated_at'}) VALUES(${values},CURRENT_TIMESTAMP${table === 'finance_scopes' ? ',CURRENT_TIMESTAMP' : ''});`);
    }
    const targetRows = query(targets.finance, `SELECT ${columns.join(',')} FROM ${table} ORDER BY ${columns[0]}`);
    if (sourceRows.length !== targetRows.length || checksum(sourceRows) !== checksum(targetRows)) throw new Error(`finance ${table} checksum or count mismatch`);
    addObject(targets.finance, runId, { name: table, classification: 'non_personal', action: 'copied', sourceCount: sourceRows.length, targetCount: targetRows.length, sourceChecksum: checksum(sourceRows), targetChecksum: checksum(targetRows) });
  }
  for (const table of ['finance_access_grants', 'finance_movements', 'finance_import_batches', 'finance_import_rows', 'finance_audit_events', 'finance_reconciliation_lines', 'finance_reconciliation_matches']) {
    const count = Number(query(source, `SELECT COUNT(*) AS count FROM ${table}`)[0]?.count || 0);
    addObject(targets.finance, runId, { name: table, classification: 'withheld_sensitive', action: 'withheld', sourceCount: count, targetCount: 0, sourceChecksum: null, targetChecksum: null });
  }
  finish('finance', runId);
}

for (const [domain, database] of Object.entries(targets).filter(([domain]) => selected(domain))) {
  const latest = query(database, `SELECT status,COUNT(*) AS objects FROM domain_migration_runs r JOIN domain_migration_objects o ON o.run_id=r.id WHERE r.domain=${quote(domain)} AND r.status='verified' GROUP BY r.id,r.status ORDER BY r.finished_at DESC LIMIT 1`)[0];
  if (!latest || latest.status !== 'verified') throw new Error(`${domain} reconciliation journal is incomplete`);
  console.log(JSON.stringify({ domain, status: latest.status, objects: Number(latest.objects) }));
}
