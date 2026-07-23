#!/usr/bin/env node
'use strict';

// Controlled recovery for a failed Meta Ads Publish execution. It starts at
// Prepare Creative Operation with jobs rebuilt from persisted data, so neither
// the visual-grouping agent nor Livia is invoked again. This is intentionally
// a temporary webhook workflow: the original publishing workflow remains
// inactive and unchanged while its expensive upstream output is replayed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const DEFAULT_ENV_FILE = '/mnt/c/CodexRuntime/operator/admin/skincos/secrets/orb-n8n-api.env';
const defaultJobsPath = '/mnt/c/CodexRuntime/operator/admin/skincos/meta-ads-publish/diagnostics/execution-253-current-contract-jobs.json';
const jobsPath = path.resolve((process.argv.find((value) => value.startsWith('--jobs=')) || `--jobs=${defaultJobsPath}`).slice(7));
const dryRun = process.argv.includes('--dry-run');
const retention = process.argv.includes('--keep-recovery-workflow');
const cleanupWorkflowId = text((process.argv.find((value) => value.startsWith('--delete-workflow=')) || '').slice('--delete-workflow='.length));

function text(value) { return String(value ?? '').trim(); }
function parseEnvFile(file) {
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) result[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return result;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function executionItems(execution, nodeName) {
  const node = execution?.data?.resultData?.runData?.[nodeName];
  const main = Array.isArray(node?.[0]?.data?.main) ? node[0].data.main : [];
  return main.flatMap((branch) => Array.isArray(branch) ? branch : [])
    .map((item) => item && item.json)
    .filter((item) => item && typeof item === 'object');
}
function validatePlacementSnapshot(items) {
  if (!items.length) throw new Error('Recovery requer a saida persistida de Validate Meta Placement Eligibility.');
  for (const item of items) {
    if (item.ok !== true || !Array.isArray(item.placement_checks) || !item.placement_checks.length || item?.placement_preflight?.status !== 'ok') {
      throw new Error('Recovery recusou snapshot de posicionamentos sem o preflight Meta validado.');
    }
  }
  return items;
}
function createApiSettings(settings = {}) {
  const allowed = [
    'saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
    'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone',
    'executionOrder', 'callerPolicy',
  ];
  return Object.fromEntries(allowed
    .filter((key) => settings[key] !== undefined)
    .map((key) => [key, settings[key]]));
}
function validateJobs(value) {
  const jobs = Array.isArray(value?.jobs) ? value.jobs : [];
  const buildPayload = Array.isArray(value?.build_payload) ? value.build_payload : [];
  if (buildPayload.length !== 1 || !buildPayload[0] || typeof buildPayload[0] !== 'object') {
    throw new Error('Recovery requer exatamente um Build Payload persistido para abrir um novo publish run.');
  }
  if (jobs.length !== 2) throw new Error(`Recovery requer exatamente dois jobs; recebidos ${jobs.length}.`);
  const runIds = new Set(jobs.map((job) => text(job.run_id)));
  if (runIds.size !== 1 || ![...runIds][0]) throw new Error('Recovery requer um unico run_id persistido.');
  const destinations = new Set(jobs.map((job) => text(job.destination_group)));
  if (destinations.size !== 2) throw new Error('Recovery requer os dois destinos.');
  for (const job of jobs) {
    const feed = job?.creativePayload?.asset_feed_spec || {};
    const rules = Array.isArray(feed.asset_customization_rules) ? feed.asset_customization_rules : [];
    const textLabels = {};
    for (const collection of ['bodies', 'titles', 'descriptions']) {
      const values = Array.isArray(feed[collection]) ? feed[collection] : [];
      const labels = values.map((entry) => String(entry?.adlabels?.[0]?.name || '').trim()).filter(Boolean);
      if (values.length !== 5 || labels.length !== 5 || new Set(labels).size !== 5 || values.some((entry) => !Array.isArray(entry.adlabels) || entry.adlabels.length !== 1)) {
        throw new Error(`Recovery recusou ${collection}: video_only requer cinco variacoes com labels unicos.`);
      }
      textLabels[collection] = new Set(labels);
    }
    if (text(job.media_mode) !== 'video_only' || (feed.images || []).length || (feed.videos || []).length !== 1 || rules.length !== 2) {
      throw new Error('Recovery recusou contrato de midia diferente de video_only validado.');
    }
    for (const rule of rules) {
      if (text(rule.video_label?.name) !== 'vertical_video' || text(rule.image_label?.name) || !textLabels.bodies.has(text(rule.body_label?.name)) || !textLabels.titles.has(text(rule.title_label?.name)) || !textLabels.descriptions.has(text(rule.description_label?.name))) {
        throw new Error('Recovery recusou regra de video sem labels de texto exclusivos e correlacionados.');
      }
    }
    if (text(job?.adPayload?.status).toUpperCase() !== 'ACTIVE') throw new Error('Recovery exige o status comercial ACTIVE do job validado.');
  }
  return { jobs, buildPayload, sourceRunId: [...runIds][0] };
}

async function main() {
  const envFile = process.env.ORB_N8N_API_ENV_FILE || DEFAULT_ENV_FILE;
  const env = fs.existsSync(envFile) ? parseEnvFile(envFile) : {};
  const apiKey = process.env.ORB_N8N_API_KEY || env.ORB_N8N_API_KEY;
  const baseUrl = (process.env.ORB_N8N_API_URL || env.ORB_N8N_API_URL || 'https://orb.skincos.com.br/api/v1').replace(/\/$/, '');
  if (!apiKey) throw new Error('ORB_N8N_API_KEY ausente.');
  const replay = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  const { jobs, buildPayload, sourceRunId } = validateJobs(replay);
  const request = async (pathname, options = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'X-N8N-API-KEY': apiKey, ...(options.headers || {}) },
    });
    const raw = await response.text();
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
    if (!response.ok) throw new Error(`n8n API ${response.status}: ${body.message || body.error || raw || 'request_failed'}`);
    return body;
  };

  if (cleanupWorkflowId) {
    await request(`/workflows/${encodeURIComponent(cleanupWorkflowId)}`, { method: 'DELETE' });
    console.log(JSON.stringify({ ok: true, mode: 'cleanup', workflow_id: cleanupWorkflowId }));
    return;
  }

  const [original, sourceExecution] = await Promise.all([
    request(`/workflows/${WORKFLOW_ID}`),
    request(`/executions/${encodeURIComponent(replay.source_execution_id)}?includeData=true`),
  ]);
  if (original.active) throw new Error('O workflow original esta ativo; recovery isolado recusado.');
  const placementSnapshot = validatePlacementSnapshot(executionItems(sourceExecution, 'Validate Meta Placement Eligibility'));
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, mode: 'dry_run', source_execution_id: replay.source_execution_id, source_run_id: sourceRunId, jobs: jobs.length, placement_snapshots: placementSnapshot.length, original_active: false }, null, 2));
    return;
  }

  const recoveryName = `Meta Ads Publish – Recovery ${replay.source_execution_id} ${new Date().toISOString()}`;
  const webhookPath = `meta-ads-publish-recovery-${crypto.randomUUID().replace(/-/g, '')}`;
  const recoveryNodes = clone(original.nodes).filter((node) => ![
    'When clicking ‘Execute workflow’',
    'Validate Meta Placement Eligibility',
  ].includes(node.name));
  recoveryNodes.push(
    {
      id: `recovery-webhook-${crypto.randomUUID()}`,
      name: 'Recovery Webhook Trigger',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [9000, 200],
      webhookId: crypto.randomUUID(),
      parameters: { httpMethod: 'POST', path: webhookPath, responseMode: 'onReceived', options: {} },
    },
    {
      id: `recovery-seed-${crypto.randomUUID()}`,
      name: 'Seed Persisted Build Payload',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [9200, 200],
      parameters: { jsCode: `const payload = ${JSON.stringify(buildPayload)};\nreturn payload.map((json) => ({ json }));` },
    },
    {
      id: `recovery-restore-${crypto.randomUUID()}`,
      name: 'Restore Current-Contract Jobs For New Run',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [9600, 200],
      parameters: { jsCode: `const response = $input.first()?.json || {};\nconst runId = String(response.run?.id || response.id || response.data?.run?.id || '').trim();\nif (!runId) throw new Error('Recovery nao recebeu run_id ao abrir um novo publish run.');\nconst jobs = ${JSON.stringify(jobs)};\nreturn jobs.map((json) => ({ json: { ...json, run_id: runId } }));` },
    },
    {
      id: `recovery-placement-${crypto.randomUUID()}`,
      // Attach Advantage+ Verification reads this node by name. Replaying the
      // successful source output preserves the same independently validated
      // effective-adset placement evidence without re-running upstream work.
      name: 'Validate Meta Placement Eligibility',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [9800, 450],
      parameters: { jsCode: `const snapshots = ${JSON.stringify(placementSnapshot)};\nreturn snapshots.map((json) => ({ json }));` },
    },
  );
  const recoveryConnections = clone(original.connections);
  for (const value of Object.values(recoveryConnections)) {
    if (!value?.main) continue;
    for (const branch of value.main) {
      if (Array.isArray(branch)) {
        for (let index = branch.length - 1; index >= 0; index -= 1) {
          if (['Prepare Publish Run', 'Prepare Creative Operation', 'Validate Meta Placement Eligibility'].includes(branch[index]?.node)) branch.splice(index, 1);
        }
      }
    }
  }
  recoveryConnections['Recovery Webhook Trigger'] = { main: [[{ node: 'Seed Persisted Build Payload', type: 'main', index: 0 }]] };
  recoveryConnections['Seed Persisted Build Payload'] = { main: [[{ node: 'Prepare Publish Run', type: 'main', index: 0 }]] };
  recoveryConnections['Acquire Publish Run'] = { main: [[{ node: 'Restore Current-Contract Jobs For New Run', type: 'main', index: 0 }]] };
  recoveryConnections['Restore Current-Contract Jobs For New Run'] = { main: [[
    { node: 'Prepare Creative Operation', type: 'main', index: 0 },
    { node: 'Validate Meta Placement Eligibility', type: 'main', index: 0 },
  ]] };
  // The source graph sends the placement gate back to its upstream Merge (1)
  // and Build Payload. In recovery it is evidence consumed by $items(...) only;
  // retaining that outbound edge would launch a second, incomplete ingestion.
  delete recoveryConnections['Validate Meta Placement Eligibility'];

  const created = await request('/workflows', {
    method: 'POST',
    body: JSON.stringify({ name: recoveryName, nodes: recoveryNodes, connections: recoveryConnections, settings: createApiSettings(original.settings || {}) }),
  });
  const recoveryId = created.id;
  console.log(JSON.stringify({ mode: 'recovery_created', recovery_workflow_id: recoveryId, source_execution_id: replay.source_execution_id }));
  try {
    const activated = await request(`/workflows/${recoveryId}/activate`, {
      method: 'POST',
      body: JSON.stringify({ versionId: created.versionId, name: created.name, description: created.description || '' }),
    });
    if (activated.active !== true) throw new Error('n8n nao ativou o workflow temporario de recovery.');
    const webhookUrl = `${baseUrl.replace(/\/api\/v1$/, '')}/webhook/${webhookPath}`;
    let triggerResponse;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      triggerResponse = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (triggerResponse.ok) break;
      if (triggerResponse.status !== 404) break;
      await sleep(1000);
    }
    if (!triggerResponse?.ok) throw new Error(`Recovery webhook ${triggerResponse?.status || 0}: ${await triggerResponse?.text() || ''}`);
    let execution;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      await sleep(5000);
      const executions = await request(`/executions?workflowId=${encodeURIComponent(recoveryId)}&limit=1`);
      const latestSummary = Array.isArray(executions.data) ? executions.data[0] : null;
      if (!latestSummary) continue;
      const latest = await request(`/executions/${latestSummary.id}?includeData=true`);
      if (['success', 'error', 'canceled', 'crashed'].includes(text(latest.status))) {
        execution = latest;
        break;
      }
    }
    if (!execution) throw new Error('Recovery excedeu o prazo de quatro minutos sem execucao terminal.');
    const runData = execution.data?.resultData?.runData || {};
    const required = ['Create AdCreative', 'Attach Creative Result', 'Stage Ad Batch', 'Activate Ad Batch', 'Build Drive Finalization'];
    const missing = required.filter((name) => !Object.prototype.hasOwnProperty.call(runData, name));
    const evidencePath = `/mnt/c/CodexRuntime/operator/admin/skincos/meta-ads-publish/diagnostics/recovery-${replay.source_execution_id}-execution-${execution.id}.json`;
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true, mode: 0o750 });
    fs.writeFileSync(evidencePath, `${JSON.stringify({ workflow_id: recoveryId, workflow_name: recoveryName, execution, required_nodes: required, missing_nodes: missing }, null, 2)}\n`, { mode: 0o640 });
    if (execution.status !== 'success' || missing.length) throw new Error(`Recovery terminou em ${execution.status}; nos ausentes: ${missing.join(', ') || 'nenhum'}. Evidencia: ${evidencePath}`);
    console.log(JSON.stringify({ ok: true, source_execution_id: replay.source_execution_id, recovery_workflow_id: recoveryId, recovery_execution_id: execution.id, required_nodes: required, evidence_path: evidencePath }, null, 2));
  } finally {
    await request(`/workflows/${recoveryId}/deactivate`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
    if (!retention) await request(`/workflows/${recoveryId}`, { method: 'DELETE' }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
