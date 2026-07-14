#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APPLY = process.argv.includes('--apply');
const RUNTIME_HOME = process.env.N8N_RUNTIME_HOME || '/mnt/c/CodexRuntime/n8n';
const EXPORT_ROOT = path.join(RUNTIME_HOME, 'exports', 'postgres-invariants');

function psql(sql) {
  return execFileSync('psql', ['-d', 'n8n_runtime', '-Atqc', sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function readState() {
  return {
    dependencySequence: Number(psql('select last_value from n8n_runtime.workflow_dependency_id_seq;')),
    dependencyMaxId: Number(psql('select coalesce(max(id),0) from n8n_runtime.workflow_dependency;')),
    inactiveWithActiveVersion: Number(psql('select count(*) from n8n_runtime.workflow_entity where active=false and "activeVersionId" is not null;')),
  };
}

const before = readState();
let checkpoint = null;

if (APPLY) {
  fs.mkdirSync(EXPORT_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  checkpoint = path.join(EXPORT_ROOT, `before-${stamp}.json`);
  fs.writeFileSync(checkpoint, `${JSON.stringify(before, null, 2)}\n`, { mode: 0o600 });

  psql(`begin;
select setval('n8n_runtime.workflow_dependency_id_seq', greatest((select coalesce(max(id), 1) from n8n_runtime.workflow_dependency), 1), true);
update n8n_runtime.workflow_entity set "activeVersionId"=null where active=false and "activeVersionId" is not null;
commit;`);
}

const after = readState();
const ok = after.dependencySequence >= after.dependencyMaxId && after.inactiveWithActiveVersion === 0;
console.log(JSON.stringify({ ok, apply: APPLY, checkpoint, before, after }, null, 2));
if (!ok) process.exit(1);
