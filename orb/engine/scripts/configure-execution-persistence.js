#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APPLY = process.argv.includes('--apply');
const RUNTIME_HOME = process.env.N8N_RUNTIME_HOME || '/var/lib/skincos-runtime/orb';

function psql(sql) {
  return execFileSync('psql', ['-d', 'n8n_runtime', '-Atqc', sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

const before = psql("select coalesce(json_agg(row_to_json(q))::text,'[]') from (select id,name,active,settings from n8n_runtime.workflow_entity order by id) q;");
const rows = JSON.parse(before);
const expectedSettings = {
  saveDataSuccessExecution: 'all',
  saveDataErrorExecution: 'all',
  saveManualExecutions: true,
  saveExecutionProgress: true,
};
const drift = rows.filter((row) => Object.entries(expectedSettings)
  .some(([key, value]) => row.settings?.[key] !== value));

if (!APPLY) {
  console.log(JSON.stringify({
    apply: false,
    workflows: rows.length,
    expectedSettings,
    drift: drift.map((row) => ({ id: row.id, name: row.name, settings: row.settings })),
  }, null, 2));
  process.exit(drift.length ? 1 : 0);
}

const checkpointDir = path.join(RUNTIME_HOME, 'exports', 'execution-persistence');
fs.mkdirSync(checkpointDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const checkpoint = path.join(checkpointDir, `workflow-settings.before-${timestamp}.json`);
fs.writeFileSync(checkpoint, JSON.stringify(rows, null, 2), { mode: 0o600 });

psql(`begin;
update n8n_runtime.workflow_entity
set settings = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(coalesce(settings::jsonb, '{}'::jsonb), '{saveDataSuccessExecution}', '"all"'::jsonb, true),
      '{saveDataErrorExecution}', '"all"'::jsonb, true
    ),
    '{saveManualExecutions}', 'true'::jsonb, true
  ),
  '{saveExecutionProgress}', 'true'::jsonb, true
)::json;
commit;`);

const remaining = Number(psql(`select count(*) from n8n_runtime.workflow_entity
where settings->>'saveDataSuccessExecution' is distinct from 'all'
   or settings->>'saveDataErrorExecution' is distinct from 'all'
   or settings->>'saveManualExecutions' is distinct from 'true'
   or settings->>'saveExecutionProgress' is distinct from 'true';`));
if (remaining) throw new Error(`${remaining} workflows still violate the execution persistence policy.`);

console.log(JSON.stringify({ apply: true, workflowsUpdated: rows.length, expectedSettings, checkpoint, remaining }, null, 2));
