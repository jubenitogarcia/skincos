#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RUNTIME_HOME = process.env.N8N_RUNTIME_HOME || '/var/lib/skincos-runtime/orb';
const ENV_FILE = process.env.N8N_ENV_FILE || '/etc/skincos/orb.env';
const STORAGE_PATH = process.env.N8N_STORAGE_PATH || path.join(RUNTIME_HOME, 'n8n-home', '.n8n', 'storage');
const BACKUP_ROOT = process.env.BACKUP_ROOT || '/var/backups/skincos/orb/daily';
const QUICK = process.argv.includes('--quick');

function parseEnv(file) {
  const result = {};
  const content = fs.readFileSync(file, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    result[line.slice(0, index)] = line.slice(index + 1).replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function psql(sql) {
  const command = process.getuid?.() === 106
    ? ['psql', ['-d', 'n8n_runtime', '-Atqc', sql]]
    : ['sudo', ['-n', '-u', 'postgres', 'psql', '-d', 'n8n_runtime', '-Atqc', sql]];
  return execFileSync(command[0], command[1], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
}

function latestBackup() {
  if (!fs.existsSync(BACKUP_ROOT)) return null;
  const candidates = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.partial-'))
    .map((entry) => ({ name: entry.name, fullPath: path.join(BACKUP_ROOT, entry.name) }))
    .filter((entry) => fs.existsSync(path.join(entry.fullPath, 'manifest.json')))
    .sort((a, b) => b.name.localeCompare(a.name));
  if (!candidates.length) return null;
  const selected = candidates[0];
  const stat = fs.statSync(path.join(selected.fullPath, 'manifest.json'));
  return { name: selected.name, ageHours: (Date.now() - stat.mtimeMs) / 3600000 };
}

const env = parseEnv(ENV_FILE);
const entityCount = Number(psql('select count(*) from n8n_runtime.execution_entity;'));
const dataCount = Number(psql('select count(*) from n8n_runtime.execution_data;'));
const entityWithoutData = Number(psql('select count(*) from n8n_runtime.execution_entity e left join n8n_runtime.execution_data d on d."executionId"=e.id where d."executionId" is null;'));
const dataWithoutEntity = Number(psql('select count(*) from n8n_runtime.execution_data d left join n8n_runtime.execution_entity e on e.id=d."executionId" where e.id is null;'));
const emptyRecentData = Number(psql('select count(*) from (select d.data from n8n_runtime.execution_data d order by d."executionId" desc limit 20) q where coalesce(length(data),0)=0;'));
const workflowSettingsDrift = Number(psql(`select count(*) from n8n_runtime.workflow_entity
where settings->>'saveDataSuccessExecution' is distinct from 'all'
   or settings->>'saveDataErrorExecution' is distinct from 'all'
   or settings->>'saveManualExecutions' is distinct from 'true'
   or settings->>'saveExecutionProgress' is distinct from 'true';`));
const deletedRunningExecutions = Number(psql(`select count(*) from n8n_runtime.execution_entity
where status='running' and "deletedAt" is not null;`));
const workflowsTotal = Number(psql('select count(*) from n8n_runtime.workflow_entity;'));
const dependencySequence = Number(psql('select last_value from n8n_runtime.workflow_dependency_id_seq;'));
const dependencyMaxId = Number(psql('select coalesce(max(id),0) from n8n_runtime.workflow_dependency;'));
const inactiveWithActiveVersion = Number(psql('select count(*) from n8n_runtime.workflow_entity where active=false and "activeVersionId" is not null;'));
const latestExecution = psql('select coalesce(max(id),0) from n8n_runtime.execution_entity;');
const executionsLast24h = Number(psql(`select count(*) from n8n_runtime.execution_entity
where "createdAt" >= now() - interval '24 hours';`));
const projectedExecutions30d = executionsLast24h * 30;
const staleRunningExecutions = JSON.parse(psql(`select coalesce(json_agg(row_to_json(q))::text,'[]') from (
  select id, "workflowId", "startedAt" from n8n_runtime.execution_entity
  where status='running' and "startedAt" < now() - interval '6 hours'
  order by id
) q;`));
const backup = latestBackup();

const failures = [];
const warnings = [];
if (entityCount !== dataCount || entityWithoutData || dataWithoutEntity) failures.push('execution_entity/execution_data mismatch');
if (emptyRecentData) failures.push('recent execution_data payload is empty');
if (env.EXECUTIONS_DATA_SAVE_ON_SUCCESS !== 'all') failures.push('success executions are not fully saved');
if (env.EXECUTIONS_DATA_SAVE_ON_ERROR !== 'all') failures.push('error executions are not fully saved');
if (env.EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS !== 'true') failures.push('manual executions are not saved');
if (env.EXECUTIONS_DATA_SAVE_ON_PROGRESS !== 'true') failures.push('per-node progress persistence is disabled');
if (env.EXECUTIONS_DATA_MAX_AGE !== '720') failures.push('execution retention is not 720 hours');
if (env.EXECUTIONS_DATA_PRUNE_MAX_COUNT !== '5000') failures.push('execution count retention is not 5000');
if (env.N8N_STORAGE_PATH !== STORAGE_PATH) failures.push('N8N_STORAGE_PATH is not pinned to the canonical storage');
if (Object.prototype.hasOwnProperty.call(env, 'N8N_BINARY_DATA_FILE_PATH')) failures.push('deprecated N8N_BINARY_DATA_FILE_PATH is still configured');
if (workflowSettingsDrift) failures.push(`${workflowSettingsDrift} workflows override the complete execution persistence policy`);
if (deletedRunningExecutions) failures.push(`${deletedRunningExecutions} executions are both running and logically deleted`);
if (staleRunningExecutions.length) failures.push(`${staleRunningExecutions.length} running executions are older than 6 hours and require runner reconciliation`);
if (dependencySequence < dependencyMaxId) failures.push('workflow dependency sequence is behind the stored IDs');
if (inactiveWithActiveVersion) failures.push(`${inactiveWithActiveVersion} inactive workflows still have an active version`);
if (!fs.existsSync(STORAGE_PATH)) failures.push('canonical storage path is missing');
if (!QUICK && (!backup || backup.ageHours > 30)) failures.push('no successful backup in the last 30 hours');
if (projectedExecutions30d >= 5000) warnings.push(`30-day execution projection (${projectedExecutions30d}) can reach the 5000-record cap`);

let checkedBinaryReferences = 0;
let missingBinaryReferences = 0;
const missingBinaryDetails = [];
if (!QUICK) {
  const recent = JSON.parse(psql(`select coalesce(json_agg(row_to_json(q))::text,'[]') from (
    select "executionId", data from n8n_runtime.execution_data order by "executionId" desc limit 20
  ) q;`));
  const seen = new Set();
  for (const execution of recent) {
    const pattern = /filesystem-v2:([^"\\\\]+)/g;
    for (const match of String(execution.data || '').matchAll(pattern)) {
      const ref = match[1].trim();
      const key = `${execution.executionId}:${ref}`;
      if (!ref || seen.has(key)) continue;
      seen.add(key);
      checkedBinaryReferences += 1;
      const resolved = path.resolve(STORAGE_PATH, ref);
      const inStorage = resolved.startsWith(`${path.resolve(STORAGE_PATH)}${path.sep}`);
      if (!inStorage || !fs.existsSync(resolved)) {
        missingBinaryReferences += 1;
        missingBinaryDetails.push({ executionId: execution.executionId, reference: ref, inStorage });
      }
      if (checkedBinaryReferences >= 500) break;
    }
    if (checkedBinaryReferences >= 500) break;
  }
  if (missingBinaryReferences) failures.push(`${missingBinaryReferences} recent binary references are missing`);
}

const report = {
  ok: failures.length === 0,
  executionEntityCount: entityCount,
  executionDataCount: dataCount,
  entityWithoutData,
  dataWithoutEntity,
  emptyRecentData,
  latestExecution,
  executionsLast24h,
  projectedExecutions30d,
  staleRunningExecutions,
  workflowsTotal,
  workflowSettingsDrift,
  deletedRunningExecutions,
  dependencySequence,
  dependencyMaxId,
  inactiveWithActiveVersion,
  retentionHours: Number(env.EXECUTIONS_DATA_MAX_AGE || 0),
  progressPersistence: env.EXECUTIONS_DATA_SAVE_ON_PROGRESS === 'true',
  storagePath: STORAGE_PATH,
  checkedBinaryReferences,
  missingBinaryReferences,
  missingBinaryDetails,
  latestBackup: backup,
  warnings,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
