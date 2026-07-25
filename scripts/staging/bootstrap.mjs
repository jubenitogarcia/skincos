#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { manifest, parseDomain, privateStateDirectory, requireApply, root, runWrangler, statePaths } from './lib.mjs';

const argv = process.argv.slice(2);
const domain = parseDomain(argv);
const apply = argv.includes('--apply');
const plan = {
  environment: manifest.environment,
  domain: domain.id,
  creates: ['Worker', 'D1', 'KV', 'R2', 'source queue', 'dead-letter queue'],
  bindings: domain.bindings,
  featureFlags: manifest.safety.defaultFeatureFlags,
  remoteState: 'written only to SKINCOS_STAGING_STATE_DIR outside the repository',
};
if (!apply) {
  console.log(JSON.stringify({ mode: 'plan', ...plan }, null, 2));
  process.exit(0);
}
requireApply(argv, 'SKINCOS_STAGING_APPLY');
const state = privateStateDirectory();
const paths = statePaths(domain, state);
fs.mkdirSync(paths.directory, { recursive: true });

const config = {
  name: domain.worker,
  main: path.join(root, 'platform/staging/control-worker.js'),
  compatibility_date: '2026-07-24',
  workers_dev: true,
  observability: { enabled: true, head_sampling_rate: 1 },
  vars: { DOMAIN: domain.id, ENVIRONMENT: 'staging', APP_VERSION: 'staging-foundation-v1' },
  d1_databases: [{ binding: 'DB', database_name: domain.d1 }],
  kv_namespaces: [{ binding: 'FLAGS' }],
  r2_buckets: [{ binding: 'DATA_BUCKET' }],
  queues: {
    producers: [{ binding: 'EVENT_QUEUE', queue: domain.queue }],
    consumers: [{ queue: domain.queue, max_batch_size: 10, max_batch_timeout: 5, max_retries: 3, retry_delay: 30, dead_letter_queue: domain.deadLetterQueue }],
  },
};
fs.writeFileSync(paths.config, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
runWrangler(['deploy', '--config', paths.config]);

const resolved = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
const database = resolved.d1_databases?.[0]?.database_name;
const namespaceId = resolved.kv_namespaces?.[0]?.id;
const bucket = resolved.r2_buckets?.[0]?.bucket_name;
if (!database || !namespaceId || !bucket) throw new Error('Wrangler did not persist D1, KV and R2 bindings in the private generated config');
runWrangler(['d1', 'execute', database, '--remote', '--file', path.join(root, 'platform/staging/d1/0001_control.sql')]);
runWrangler(['kv', 'key', 'put', '--namespace-id', namespaceId, 'module_enabled', 'false']);
runWrangler(['r2', 'object', 'put', `${bucket}/_control/sentinel.json`, '--file', path.join(root, 'platform/staging/sentinel.json'), '--content-type', 'application/json']);
fs.writeFileSync(paths.evidence, `${JSON.stringify({ schemaVersion: 1, environment: 'staging', domain: domain.id, featureFlags: { module_enabled: false }, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ mode: 'applied', environment: 'staging', domain: domain.id, secretStillRequired: domain.secretNames, evidence: paths.evidence }, null, 2));
