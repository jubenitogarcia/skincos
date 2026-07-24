#!/usr/bin/env node
import fs from 'node:fs';
import { parseDomain, privateStateDirectory, requireApply, runWrangler, statePaths } from './lib.mjs';

const argv = process.argv.slice(2);
const domain = parseDomain(argv);
if (!argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'plan', domain: domain.id, safeguards: ['requires private generated config', 'requires SKINCOS_STAGING_TEARDOWN=1', 'deletes only the requested staging domain after a backup/retention decision'], production: 'never targeted' }, null, 2));
  process.exit(0);
}
requireApply(argv, 'SKINCOS_STAGING_TEARDOWN');
const paths = statePaths(domain, privateStateDirectory());
if (!fs.existsSync(paths.config)) throw new Error('No private generated staging config found; refusing to infer destructive targets');
const config = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
const database = config.d1_databases?.[0]?.database_name;
const namespaceId = config.kv_namespaces?.[0]?.id;
const bucket = config.r2_buckets?.[0]?.bucket_name;
if (!database || !namespaceId || !bucket || config.name !== domain.worker) throw new Error('Private generated config is incomplete or does not match the requested domain');
runWrangler(['delete', '--config', paths.config]);
runWrangler(['queues', 'delete', domain.queue]);
runWrangler(['queues', 'delete', domain.deadLetterQueue]);
runWrangler(['r2', 'bucket', 'delete', bucket]);
runWrangler(['kv', 'namespace', 'delete', '--namespace-id', namespaceId]);
runWrangler(['d1', 'delete', database]);
console.log(JSON.stringify({ mode: 'teardown-complete', environment: 'staging', domain: domain.id }, null, 2));
