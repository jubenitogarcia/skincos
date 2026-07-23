#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const {
  manualExecutionAuditState,
} = require('./lib/meta-ads-publish-execution-semantics');
const CODE_SOURCES = require('./meta-ads-publish-code-sources');
const { validateGraphContract } = require('./meta-ads-publish-graph-contract');
const { validateOfferFingerprintContract } = require('./meta-ads-publish-offer-fingerprint-contract');
const { validateAgentContract } = require('./meta-ads-publish-agent-contract');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function normalizedCode(value) {
  return String(value || '').replace(/\s+$/, '');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function checkVideoProcessorRuntime(moduleRoot) {
  const sourcePath = path.join(moduleRoot, 'scripts', 'meta-ads', 'process-video-asset.js');
  const runtimePath = process.env.META_ADS_VIDEO_PROCESSOR_PATH
    || '/var/lib/skincos-runtime/orb/scripts/meta-ads/process-video-asset.js';
  const runtimeHash = String(process.env.META_ADS_VIDEO_PROCESSOR_RUNTIME_SHA256 || '').trim();
  if (!fs.existsSync(sourcePath)) {
    return { ok: false, reason: 'canonical_source_missing', source_path: sourcePath, runtime_path: runtimePath };
  }
  const sourceHash = sha256File(sourcePath);
  if (!runtimeHash) {
    return {
      ok: false,
      reason: 'runtime_hash_not_provided',
      source_path: sourcePath,
      runtime_path: runtimePath,
      source_sha256: sourceHash,
    };
  }
  return {
    ok: sourceHash === runtimeHash,
    reason: sourceHash === runtimeHash ? null : 'source_runtime_drift',
    source_path: sourcePath,
    runtime_path: runtimePath,
    source_sha256: sourceHash,
    runtime_sha256: runtimeHash,
  };
}

function checkTaskRunnerHealth() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:5681/health', { timeout: 3000 }, (response) => {
      response.resume();
      resolve({ ok: response.statusCode === 200, status_code: response.statusCode || 0, endpoint: 'loopback' });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => resolve({ ok: false, status_code: 0, endpoint: 'loopback', error: error.message }));
  });
}

async function main() {
  const moduleRoot = path.resolve(__dirname, '..');
  const sourceRoot = path.join(moduleRoot, 'workflow-src', 'meta-ads-publish');
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT active, nodes, connections, settings, "versionId", "activeVersionId", "versionCounter"
         FROM n8n_runtime.workflow_entity WHERE id = $1`,
      [WORKFLOW_ID],
    );
    const workflow = result.rows[0];
    if (!workflow) throw new Error('Meta Ads Publish workflow not found.');
    const nodes = parseJson(workflow.nodes, []);
    const connections = parseJson(workflow.connections, {});
    const drift = [];
    for (const [nodeName, fileName] of Object.entries(CODE_SOURCES)) {
      const sourcePath = path.join(sourceRoot, fileName);
      const node = nodes.find((entry) => entry.name === nodeName);
      if (!fs.existsSync(sourcePath)) {
        drift.push({ node: nodeName, reason: 'source_missing' });
      } else if (!node?.parameters?.jsCode) {
        drift.push({ node: nodeName, reason: 'live_code_node_missing' });
      } else if (normalizedCode(fs.readFileSync(sourcePath, 'utf8')) !== normalizedCode(node.parameters.jsCode)) {
        drift.push({ node: nodeName, reason: 'source_live_drift' });
      }
    }
    const settings = parseJson(workflow.settings, {});
    const graphFailures = validateGraphContract({ nodes, connections });
    const offerFingerprintFailures = validateOfferFingerprintContract({ nodes, connections });
    const agentContractFailures = validateAgentContract({ nodes, connections });
    const taskRunnerHealth = await checkTaskRunnerHealth();
    const videoProcessorRuntime = checkVideoProcessorRuntime(moduleRoot);
    const report = {
      workflow_id: WORKFLOW_ID,
      mode: 'read_only',
      workflow_active: workflow.active === true,
      current_version_id: workflow.versionId,
      active_version_id: workflow.activeVersionId,
      version_counter: Number(workflow.versionCounter),
      code_sources_synchronized: drift.length === 0,
      code_source_drift: drift,
      graph_contract: { ok: graphFailures.length === 0, failures: graphFailures },
      offer_fingerprint_contract: { ok: offerFingerprintFailures.length === 0, failures: offerFingerprintFailures },
      agent_contract: { ok: agentContractFailures.length === 0, failures: agentContractFailures },
      task_runner_health: taskRunnerHealth,
      video_processor_runtime: videoProcessorRuntime,
      manual_execution_audit: manualExecutionAuditState(settings),
      manual_execution_note: settings.saveManualExecutions === true
        ? 'Manual executions are retained for later inspection.'
        : 'Manual executions are not retained; inspect the active editor output or runtime evidence before it is lost.',
      meta_mutations_performed: false,
      service_restarts_performed: false,
    };
    console.log(JSON.stringify(report, null, 2));
    if (drift.length || graphFailures.length || offerFingerprintFailures.length || agentContractFailures.length || !taskRunnerHealth.ok || !videoProcessorRuntime.ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
