#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { validateGraphContract } = require('./meta-ads-publish-graph-contract');
const { validateOfferFingerprintContract } = require('./meta-ads-publish-offer-fingerprint-contract');

// The privileged WSL resolver can return an unreachable IPv6 Cloudflare edge
// before IPv4. Keep live sync deterministic without requiring an operator to
// remember a NODE_OPTIONS override.
dns.setDefaultResultOrder('ipv4first');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const WORKFLOW_FILE = path.resolve(__dirname, '..', 'workflows', 'meta-ads-publish.current.json');
const DEFAULT_ENV_FILE = '/mnt/c/CodexRuntime/operator/admin/skincos/secrets/orb-n8n-api.env';
const CHECKPOINT_ROOT = process.env.N8N_RUNTIME_HOME
  ? path.join(process.env.N8N_RUNTIME_HOME, 'exports', 'workflow-patches')
  : '/var/lib/skincos-runtime/orb/exports/workflow-patches';

function parseEnvFile(file) {
  const result = {};
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    result[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return result;
}

function comparable(workflow) {
  return JSON.stringify({
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
  });
}

function apiSettings(settings = {}) {
  const allowed = [
    'saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
    'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone',
    'executionOrder', 'callerPolicy',
  ];
  return Object.fromEntries(allowed
    .filter((key) => settings[key] !== undefined)
    .map((key) => [key, settings[key]]));
}

async function request(url, key, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'X-N8N-API-KEY': key,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: 'non_json_response' }; }
  if (!response.ok) throw new Error(`n8n API ${response.status}: ${body.message || 'request_failed'}`);
  return body;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pull = process.argv.includes('--pull');
  if (apply && pull) throw new Error('Use apenas um entre --apply e --pull.');
  const envFile = process.env.ORB_N8N_API_ENV_FILE || DEFAULT_ENV_FILE;
  const secrets = fs.existsSync(envFile) ? parseEnvFile(envFile) : {};
  const key = process.env.ORB_N8N_API_KEY || secrets.ORB_N8N_API_KEY;
  const baseUrl = (process.env.ORB_N8N_API_URL || secrets.ORB_N8N_API_URL || 'https://orb.skincos.com.br/api/v1').replace(/\/$/, '');
  if (!key) throw new Error('ORB_N8N_API_KEY ausente.');

  const endpoint = `${baseUrl}/workflows/${WORKFLOW_ID}`;
  const live = await request(endpoint, key);
  if (live.active) throw new Error('Workflow vivo esta ativo; sincronizacao recusada.');
  if (pull) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointDir = path.join(CHECKPOINT_ROOT, `meta-ads-publish-live-pull-${stamp}`);
    fs.mkdirSync(checkpointDir, { recursive: true, mode: 0o750 });
    if (fs.existsSync(WORKFLOW_FILE)) fs.copyFileSync(WORKFLOW_FILE, path.join(checkpointDir, 'workflow.local-before-pull.json'));
    fs.writeFileSync(path.join(checkpointDir, 'workflow.live.json'), `${JSON.stringify(live, null, 2)}\n`, { mode: 0o640 });
    fs.writeFileSync(WORKFLOW_FILE, `${JSON.stringify(live, null, 2)}\n`);
    console.log(JSON.stringify({ mode: 'pull', active: false, checkpoint_dir: checkpointDir, nodes: live.nodes.length }, null, 2));
    return;
  }

  const desired = JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
  const graphFailures = validateGraphContract(desired);
  if (graphFailures.length) throw new Error(`Contrato do grafo invalido: ${graphFailures.join(', ')}`);
  const offerFingerprintFailures = validateOfferFingerprintContract(desired);
  if (offerFingerprintFailures.length) throw new Error(`Contrato de fingerprint comercial invalido: ${offerFingerprintFailures.join(', ')}`);
  const contentMatch = comparable(live) === comparable(desired);
  if (!apply || contentMatch) {
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'check', active: false, content_match: contentMatch, graph_failures: 0, offer_fingerprint_failures: 0 }, null, 2));
    if (!apply && !contentMatch) process.exitCode = 1;
    return;
  }
  if (live.versionId !== desired.versionId) {
    throw new Error('Workflow vivo mudou desde o checkpoint; sincronizacao recusada para evitar sobrescrita concorrente.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const checkpointDir = path.join(CHECKPOINT_ROOT, `meta-ads-optional-media-${stamp}`);
  fs.mkdirSync(checkpointDir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(path.join(checkpointDir, 'workflow.live.json'), `${JSON.stringify(live, null, 2)}\n`, { mode: 0o640 });

  const updated = await request(endpoint, key, {
    method: 'PUT',
    body: JSON.stringify({
      name: desired.name,
      nodes: desired.nodes,
      connections: desired.connections,
      settings: apiSettings(desired.settings),
    }),
  });
  if (updated.active) throw new Error('API retornou workflow ativo apos sincronizacao; verificacao recusada.');
  const verified = await request(endpoint, key);
  if (verified.active || comparable(verified) !== comparable(desired)) {
    throw new Error('Readback do workflow nao coincide com a definicao desejada.');
  }
  console.log(JSON.stringify({
    mode: 'apply',
    active: false,
    content_match: true,
    graph_failures: 0,
    offer_fingerprint_failures: 0,
    checkpoint_dir: checkpointDir,
    nodes: verified.nodes.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
