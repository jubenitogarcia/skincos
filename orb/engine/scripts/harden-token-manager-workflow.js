#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APPLY_LIVE = process.argv.includes('--apply-live');
const MODULE_ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(MODULE_ROOT, 'workflows', 'token-manager.current.json');
const RUNTIME_HOME = process.env.N8N_RUNTIME_HOME || '/mnt/c/CodexRuntime/n8n';
const BASE_URL = "={{ ($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault')";
const AUTH = { httpBearerAuth: { id: 'metaPublishGatewayBearer', name: 'Meta Ads Publish - Gateway Bearer' } };

function node(workflow, name) {
  const found = workflow.nodes.find((entry) => entry.name === name);
  if (!found) throw new Error(`Token Manager node not found: ${name}`);
  return found;
}

function operationalRequest(target, suffix, extra = {}) {
  target.type = 'n8n-nodes-base.httpRequest';
  target.typeVersion = 4.2;
  target.parameters = {
    url: `${BASE_URL} + '${suffix}' }}`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpBearerAuth',
    options: { timeout: 120000 },
    ...extra,
  };
  target.credentials = AUTH;
}

function makeNoOp(target) {
  target.type = 'n8n-nodes-base.noOp';
  target.typeVersion = 1;
  target.parameters = {};
  delete target.credentials;
}

function harden(workflow) {
  for (const provider of ['Threads', 'Instagram']) {
    operationalRequest(node(workflow, `Get ${provider} Tokens`), `/v1/token-metadata?provider=${provider.toLowerCase()}&active=true`);
    const loopName = `Loop ${provider} Tokens`;
    operationalRequest(node(workflow, `Refresh ${provider} Token`), '/v1/token-maintenance/refresh', {
      method: 'POST',
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: `={{ JSON.stringify({ token_id: $('${loopName}').item.json.token_id || $('${loopName}').item.json.id }) }}`,
    });
    makeNoOp(node(workflow, `Save ${provider} Token`));
  }

  operationalRequest(node(workflow, 'Get Facebook Meta Ads Tokens'), '/v1/token-metadata?provider=facebook&active=true');
  node(workflow, 'Build Facebook Meta Ads Upserts').parameters = {
    jsCode: `const root = $input.first()?.json || {};
const items = Array.isArray(root.items) ? root.items : [];
const required = ['api_version', 'account_id', 'campaign_id', 'adset_id', 'page_id', 'instagram_user_id', 'destination_group'];
const rows = items.filter((item) => item && item.provider === 'facebook' && item.active !== false && item.metadata?.meta_ads_publish);
if (rows.length < 2) throw new Error('Token Manager: esperadas 2 configuracoes facebook/meta_ads_publish no Token Vault.');
return rows.map((item) => {
  const publish = item.metadata.meta_ads_publish || {};
  const missing = required.filter((key) => !String(publish[key] ?? '').trim());
  if (missing.length) throw new Error('Token Manager: metadata.meta_ads_publish incompleto: ' + missing.join(', '));
  return { json: {
    token_id: String(item.token_id || item.id || ''),
    provider: 'facebook',
    unit: String(item.unit || ''),
    external_account_id: String(item.external_account_id || ''),
    active: true,
    configuration_status: 'valid',
    last_refreshed_at: item.last_refreshed_at || null,
    expires_at: item.expires_at || null,
  } };
});`,
  };
  makeNoOp(node(workflow, 'Save Facebook Meta Ads Token'));

  workflow.settings = {
    ...(workflow.settings || {}),
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
    saveManualExecutions: true,
    saveExecutionProgress: true,
  };
  return workflow;
}

function psql(sql) {
  return execFileSync('psql', ['-d', 'n8n_runtime', '-Atqc', sql], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }).trim();
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function main() {
  const workflow = harden(JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8')));
  fs.writeFileSync(WORKFLOW_PATH, `${JSON.stringify(workflow, null, 2)}\n`);

  if (APPLY_LIVE) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointDir = path.join(RUNTIME_HOME, 'exports', 'workflow-patches');
    fs.mkdirSync(checkpointDir, { recursive: true });
    const before = psql("select row_to_json(w)::text from n8n_runtime.workflow_entity w where id='Fuj4MwplckFCL7Si';");
    fs.writeFileSync(path.join(checkpointDir, `token-manager.before-history-hardening-${timestamp}.json`), before, { mode: 0o600 });
    psql(`update n8n_runtime.workflow_entity set nodes=${sqlLiteral(JSON.stringify(workflow.nodes))}::json, connections=${sqlLiteral(JSON.stringify(workflow.connections))}::json, settings=${sqlLiteral(JSON.stringify(workflow.settings))}::json, "updatedAt"=now() where id='Fuj4MwplckFCL7Si';`);
  }

  console.log(JSON.stringify({ ok: true, workflow: workflow.id, live: APPLY_LIVE }, null, 2));
}

if (require.main === module) main();
module.exports = { harden };
