#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  manualExecutionAuditState,
} = require('./lib/meta-ads-publish-execution-semantics');
const { validate: validateVideoUploadReplay } = require('./patch-meta-ads-video-transfer-replay');
const {
  CRM_URL: CRM_OFFER_CONTEXT_URL,
  PREPARE_NODE: CRM_PREPARE_NODE,
  FETCH_NODE: CRM_FETCH_NODE,
  ATTACH_NODE: CRM_ATTACH_NODE,
  validate: validateCrmContextPrefetch,
} = require('./patch-meta-ads-crm-context-prefetch');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const CODE_SOURCES = Object.freeze({
  'Build Meta API Params From Vault': 'build-meta-api-params-from-vault.js',
  'Build Meta Account Inventory Requests': 'build-meta-inventory-requests.js',
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

function structuralContractDrift(nodes, connections) {
  const drift = [];
  const sheets = nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheetsTool');
  if (sheets.length) drift.push({ contract: 'commercial_offer_source', reason: 'google_sheets_tool_present', nodes: sheets.map((node) => node.name) });
  const crmFetch = nodes.find((node) => node.name === CRM_FETCH_NODE);
  if (!crmFetch || crmFetch.type !== 'n8n-nodes-base.httpRequest' || crmFetch.parameters?.authentication !== 'genericCredentialType' || crmFetch.parameters?.genericAuthType !== 'httpBearerAuth' || !crmFetch.credentials?.httpBearerAuth?.id || !String(crmFetch.parameters?.url || '').includes(CRM_OFFER_CONTEXT_URL)) {
    drift.push({ contract: 'commercial_offer_source', reason: 'crm_offer_context_prefetch_request_invalid' });
  }
  try {
    validateCrmContextPrefetch({ id: WORKFLOW_ID, active: false, nodes, connections });
  } catch (error) {
    drift.push({ contract: 'commercial_offer_source', reason: 'crm_offer_context_prefetch_graph_invalid', detail: String(error.message || error) });
  }
  const livia = nodes.find((node) => node.name === 'Livia');
  const systemMessage = String(livia?.parameters?.options?.systemMessage || '');
  const prompt = String(livia?.parameters?.text || '');
  if (!livia || !systemMessage.includes('consultado automaticamente pelo workflow') || !prompt.includes('crmPricing') || !prompt.includes('crm_offer_contexts') || /Knowledge|planilha|spreadsheetPricing|CRM Offer Context/i.test(`${systemMessage}\n${prompt}`)) {
    drift.push({ contract: 'commercial_offer_source', reason: 'livia_crm_prompt_contract_missing' });
  }
  const model = nodes.find((node) => node.name === 'OpenAI Chat Model (Agent)');
  try {
    const schema = JSON.parse(String(model?.parameters?.options?.textFormat?.textOptions?.schema || '{}'));
    const analysis = schema?.properties?.analysis;
    if (!analysis?.properties?.crmPricing || analysis?.properties?.spreadsheetPricing || !Array.isArray(analysis?.required) || !analysis.required.includes('crmPricing')) {
      drift.push({ contract: 'commercial_offer_source', reason: 'livia_crm_schema_missing' });
    }
  } catch {
    drift.push({ contract: 'commercial_offer_source', reason: 'livia_schema_invalid' });
  }
  return drift;
}

function videoUploadContractDrift(workflow) {
  try {
    validateVideoUploadReplay(workflow);
    return [];
  } catch (error) {
    return [{ contract: 'video_upload_replay', reason: String(error.message || error) }];
  }
}

function codeConstant(code, name) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)'`).exec(String(code || ''));
  return match ? match[1] : '';
}

function creativeContractDrift(nodes) {
  const buildJobs = String(nodes.find((node) => node.name === 'Build Jobs')?.parameters?.jsCode || '');
  const validator = String(nodes.find((node) => node.name === 'Validate Meta Creative Payload')?.parameters?.jsCode || '');
  const drift = [];
  const buildRevision = codeConstant(buildJobs, 'WORKFLOW_CONTRACT_REVISION');
  const validatorRevision = codeConstant(validator, 'WORKFLOW_CONTRACT_REVISION');
  if (!buildRevision || buildRevision !== validatorRevision) {
    drift.push({ contract: 'creative_payload', reason: 'workflow_contract_revision_mismatch', build_jobs: buildRevision, validator: validatorRevision });
  }
  if (codeConstant(buildJobs, 'DEFAULT_CTA_TYPE') !== 'BOOK_NOW' || codeConstant(buildJobs, 'WHATSAPP_CTA_TYPE') !== 'WHATSAPP_MESSAGE' || codeConstant(validator, 'REQUIRED_CTA') !== 'BOOK_NOW' || codeConstant(validator, 'WHATSAPP_CTA') !== 'WHATSAPP_MESSAGE') {
    drift.push({ contract: 'creative_payload', reason: 'book_now_contract_mismatch' });
  }
  if (codeConstant(buildJobs, 'OUTCOME_LEADS_CTA_TYPE') !== 'LEARN_MORE' || codeConstant(validator, 'OUTCOME_LEADS_CTA') !== 'LEARN_MORE' || !/function ctaTypeForDestination\(/.test(buildJobs) || !/function expectedFlexibleCta\(/.test(validator)) {
    drift.push({ contract: 'creative_payload', reason: 'objective_aware_cta_contract_mismatch' });
  }
  if (!/const currentEntries = currentItems/.test(buildJobs) || !/if \(currentEntries\.length\) return currentEntries/.test(buildJobs)) {
    drift.push({ contract: 'creative_payload', reason: 'current_build_payload_precedence_missing' });
  }
  if (!/source_url:\s*toHttps\(sourceUrl\)/.test(buildJobs) || !/const sourceUrl\s*=\s*safeString\(asObject\(payload\.creative_sourcing_spec\)\.source_url\)/.test(validator) || !/creative_source_url_missing/.test(validator) || !/creative_source_url_primary_link_mismatch/.test(validator)) {
    drift.push({ contract: 'creative_payload', reason: 'source_url_contract_mismatch' });
  }
  const videoFeatureAliases = [
    /const VIDEO_ADVANTAGE_PLUS_BASELINE_FEATURES\s*=\s*ADVANTAGE_PLUS_BASELINE_FEATURES/,
    /const VIDEO_ADVANTAGE_PLUS_CONDITIONAL_FEATURES\s*=\s*ADVANTAGE_PLUS_CONDITIONAL_FEATURES/,
  ];
  const forbiddenVideoFeatures = ['adapt_to_placement', 'video_filtering', 'video_highlights', 'video_auto_crop', 'video_uncrop'];
  if (!videoFeatureAliases.every((pattern) => pattern.test(buildJobs)) || forbiddenVideoFeatures.some((feature) => new RegExp(`['\"]${feature}['\"]`).test(validator))) {
    drift.push({ contract: 'creative_payload', reason: 'video_feature_gateway_mismatch' });
  }
  return drift;
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
    const structuralDrift = structuralContractDrift(nodes, connections);
    const videoUploadDrift = videoUploadContractDrift({ ...workflow, id: WORKFLOW_ID, nodes, connections });
    const creativeDrift = creativeContractDrift(nodes);
    const report = {
      workflow_id: WORKFLOW_ID,
      mode: 'read_only',
      workflow_active: workflow.active === true,
      current_version_id: workflow.versionId,
      active_version_id: workflow.activeVersionId,
      version_counter: Number(workflow.versionCounter),
      code_sources_synchronized: drift.length === 0,
      code_source_drift: drift,
      crm_catalog_contract_synchronized: structuralDrift.length === 0,
      crm_catalog_contract_drift: structuralDrift,
      video_upload_contract_synchronized: videoUploadDrift.length === 0,
      video_upload_contract_drift: videoUploadDrift,
      creative_payload_contract_synchronized: creativeDrift.length === 0,
      creative_payload_contract_drift: creativeDrift,
      manual_execution_audit: manualExecutionAuditState(settings),
      manual_execution_note: settings.saveManualExecutions === true
        ? 'Manual executions are retained for later inspection.'
        : 'Manual executions are not retained; inspect the active editor output or runtime evidence before it is lost.',
      meta_mutations_performed: false,
      service_restarts_performed: false,
    };
    console.log(JSON.stringify(report, null, 2));
    if (drift.length || structuralDrift.length || videoUploadDrift.length || creativeDrift.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
