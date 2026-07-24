#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { parseDomain, privateStateDirectory, requireApply, runWrangler, statePaths } from './lib.mjs';

const argv = process.argv.slice(2);
const domain = parseDomain(argv);
if (!argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'plan', domain: domain.id, validates: ['synthetic fixture count', 'fixture privacy flag', 'queue receipt table'], copiesData: false }, null, 2));
  process.exit(0);
}
requireApply(argv, 'SKINCOS_STAGING_RECONCILE');
const paths = statePaths(domain, privateStateDirectory());
if (!fs.existsSync(paths.config)) throw new Error('No private generated staging config found; bootstrap the domain first');
const config = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
const database = config.d1_databases?.[0]?.database_name;
if (!database) throw new Error('Private generated config does not contain a D1 database name');
const command = "SELECT id, label, contains_personal_data FROM staging_fixtures ORDER BY id";
const raw = runWrangler(['d1', 'execute', database, '--remote', '--command', command, '--json'], { stdio: 'pipe' });
const rows = JSON.parse(raw).flatMap((entry) => entry.results || []);
if (rows.length !== 1 || rows[0]?.id !== 'synthetic-control-fixture' || Number(rows[0]?.contains_personal_data) !== 0) throw new Error('Synthetic staging control fixture is absent or unsafe');
const checksum = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const evidence = { schemaVersion: 1, environment: 'staging', domain: domain.id, objects: [{ name: 'staging_fixtures', classification: 'synthetic', count: rows.length, checksum }], copiedData: false, reconciledAt: new Date().toISOString() };
fs.writeFileSync(paths.evidence.replace('bootstrap-evidence', 'reconciliation-evidence'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
