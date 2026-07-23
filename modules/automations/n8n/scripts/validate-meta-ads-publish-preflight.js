#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  manualExecutionAuditState,
} = require('./lib/meta-ads-publish-execution-semantics');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const CODE_SOURCES = Object.freeze({
  'Prepare Visual Grouping Batch': 'prepare-visual-grouping-batch.js',
  'Validate Visual Grouping': 'validate-visual-grouping.js',
  'Build Meta API Params From Vault': 'build-meta-api-params-from-vault.js',
  'Build Meta Account Inventory Requests': 'build-meta-inventory-requests.js',
  'Validate Meta Placement Eligibility': 'validate-meta-placement-eligibility.js',
  'Build Payload': 'build-payload.js',
  'Prepare Publish Run': 'prepare-publish-run.js',
  'Restore Publish Groups': 'restore-publish-groups.js',
  'Prepare Gateway Uploads': 'prepare-gateway-uploads.js',
  'Normalize Gateway Upload': 'normalize-gateway-upload.js',
  'Build Jobs': 'build-jobs.js',
  'Validate Meta Creative Payload': 'validate-meta-creative-payload.js',
  'Prepare Creative Operation': 'prepare-creative-operation.js',
  'Attach Creative Result': 'attach-creative-result.js',
  'Attach Advantage+ Verification': 'attach-advantage-plus-verification.js',
  'Build Stage Batch': 'build-stage-batch.js',
  'Build Activate Batch': 'build-activate-batch.js',
  'Build Drive Finalization': 'build-drive-finalization.js',
  'Prepare Drive Read': 'prepare-drive-read.js',
  'Verify Drive Finalization': 'verify-drive-finalization.js',
});

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
      `SELECT active, nodes, settings, "versionId", "activeVersionId", "versionCounter"
         FROM n8n_runtime.workflow_entity WHERE id = $1`,
      [WORKFLOW_ID],
    );
    const workflow = result.rows[0];
    if (!workflow) throw new Error('Meta Ads Publish workflow not found.');
    const nodes = parseJson(workflow.nodes, []);
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
    const report = {
      workflow_id: WORKFLOW_ID,
      mode: 'read_only',
      workflow_active: workflow.active === true,
      current_version_id: workflow.versionId,
      active_version_id: workflow.activeVersionId,
      version_counter: Number(workflow.versionCounter),
      code_sources_synchronized: drift.length === 0,
      code_source_drift: drift,
      manual_execution_audit: manualExecutionAuditState(settings),
      manual_execution_note: settings.saveManualExecutions === true
        ? 'Manual executions are retained for later inspection.'
        : 'Manual executions are not retained; inspect the active editor output or runtime evidence before it is lost.',
      meta_mutations_performed: false,
      service_restarts_performed: false,
    };
    console.log(JSON.stringify(report, null, 2));
    if (drift.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
