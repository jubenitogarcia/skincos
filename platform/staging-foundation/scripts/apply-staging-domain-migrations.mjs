#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const execute = process.argv.includes('--execute');
const ack = process.env.SKINCOS_STAGING_DATA_MIGRATION_ACK === '1';
const domains = {
  identity: { database: 'skincos-identity-staging', migrations: 'identity/migrations', journal: 'identity_release_migrations' },
  inventory: { database: 'skincos-inventory-staging', migrations: 'inventory/migrations', journal: 'inventory_release_migrations' },
  finance: { database: 'skincos-finance-staging', migrations: 'finance/migrations', journal: 'finance_release_migrations' },
};

if (!execute) {
  console.log('plan only: pass --execute with SKINCOS_STAGING_DATA_MIGRATION_ACK=1 to apply isolated staging migrations');
  process.exit(0);
}
if (!ack) throw new Error('SKINCOS_STAGING_DATA_MIGRATION_ACK=1 is required for remote staging D1 writes');

const parse = (output) => JSON.parse(output).flatMap((entry) => entry?.results || []);
const d1 = (database, args) => execFileSync('npx', ['wrangler', 'd1', 'execute', database, '--remote', ...args, '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sql = (database, statement) => parse(d1(database, ['--command', statement]));
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const journalSchema = (name, finance) => `CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN (${finance ? "'applied','adopted'" : "'applied'"})), applied_at TEXT NOT NULL);`;

for (const [domain, config] of Object.entries(domains)) {
  d1(config.database, ['--file', path.join(root, 'platform/staging-foundation/migrations/0001_domain_shadow_journal.sql')]);
  sql(config.database, journalSchema(config.journal, domain === 'finance'));
  const applied = new Map(sql(config.database, `SELECT id,checksum FROM ${config.journal}` ).map((row) => [row.id, row.checksum]));
  const files = fs.readdirSync(path.join(root, config.migrations)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const migration = fs.readFileSync(path.join(root, config.migrations, file), 'utf8');
    const checksum = createHash('sha256').update(migration).digest('hex');
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) throw new Error(`${domain}: checksum drift for ${file}`);
      continue;
    }
    const temp = path.join(os.tmpdir(), `skincos-${domain}-${randomUUID()}.sql`);
    fs.writeFileSync(temp, `${migration}\nINSERT INTO ${config.journal}(id,checksum,source,applied_at) VALUES(${quote(file)},${quote(checksum)},'applied',CURRENT_TIMESTAMP);\n`);
    try { d1(config.database, ['--file', temp]); }
    finally { fs.rmSync(temp, { force: true }); }
    console.log(`applied ${domain}/${file}`);
  }
  console.log(`verified ${domain} migration journal (${files.length} files)`);
}
