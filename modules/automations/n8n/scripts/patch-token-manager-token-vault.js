#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'Fuj4MwplckFCL7Si';
const EXPORT_PATH = path.join(__dirname, '..', 'workflows', 'token-manager.export.json');
const TOKEN_VAULT_BASE_URL = "https://api.skincos.com.br/internal/token-vault";

function sqlite(sql) {
  return childProcess.execFileSync('sqlite3', [DB_PATH, sql], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function nodeBase({ id, name, type, typeVersion, position, parameters }) {
  return { parameters, id, name, type, typeVersion, position };
}

function authHeaders() {
  return {
    parameters: [
      {
        name: 'Authorization',
        value: "=Bearer {{$vars.TOKEN_VAULT_API_TOKEN}}",
      },
    ],
  };
}

function tokenVaultGetNode({ id, name, provider, position }) {
  return nodeBase({
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position,
    parameters: {
      method: 'GET',
      url: `={{ ($vars.TOKEN_VAULT_BASE_URL || '${TOKEN_VAULT_BASE_URL}') + '/v1/tokens?provider=${provider}&active=true' }}`,
      sendHeaders: true,
      headerParameters: authHeaders(),
      options: {
        timeout: 60000,
      },
    },
  });
}

function explodeNode({ id, name, provider, position }) {
  return nodeBase({
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: {
      jsCode: [
        'const root = $input.first()?.json || {};',
        'const items = Array.isArray(root.items) ? root.items : [];',
        `return items.filter((item) => item && item.provider === '${provider}').map((item) => ({ json: item }));`,
      ].join('\n'),
    },
  });
}

function loopNode({ id, name, position }) {
  return nodeBase({
    id,
    name,
    type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3,
    position,
    parameters: {
      batchSize: 1,
      options: {},
    },
  });
}

function refreshThreadsNode({ id, position }) {
  return nodeBase({
    id,
    name: 'Refresh Threads Token',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position,
    parameters: {
      url: 'https://graph.threads.net/v1.0/refresh_access_token',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'grant_type', value: 'th_refresh_token' },
          { name: 'access_token', value: '={{ $json.token || $json.thToken }}' },
        ],
      },
      options: {
        timeout: 60000,
      },
    },
  });
}

function refreshInstagramNode({ id, position }) {
  return nodeBase({
    id,
    name: 'Refresh Instagram Token',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position,
    parameters: {
      url: 'https://graph.instagram.com/refresh_access_token',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'grant_type', value: 'ig_refresh_token' },
          { name: 'access_token', value: '={{ $json.token || $json.igToken }}' },
        ],
      },
      options: {
        timeout: 60000,
      },
    },
  });
}

function saveTokenNode({ id, name, loopName, provider, position }) {
  return nodeBase({
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position,
    parameters: {
      method: 'PATCH',
      url: `={{ ($vars.TOKEN_VAULT_BASE_URL || '${TOKEN_VAULT_BASE_URL}') + '/v1/tokens/' + $('${loopName}').item.json.id }}`,
      sendHeaders: true,
      headerParameters: authHeaders(),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ token: $json.access_token, expires_at: $json.expires_in ? new Date(Date.now() + Number($json.expires_in) * 1000).toISOString() : undefined, source: 'n8n-token-manager', metadata: { provider: '${provider}', expires_in: $json.expires_in || null } }) }}`,
      options: {
        timeout: 60000,
      },
    },
  });
}

function main() {
  const row = sqlite(`SELECT name, active, nodes, connections, settings, staticData, pinData, meta FROM workflow_entity WHERE id=${sqlString(WORKFLOW_ID)};`).trim();
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = JSON.parse(sqlite(`SELECT json_object('id', id, 'name', name, 'active', active, 'nodes', json(nodes), 'connections', json(connections), 'settings', json(settings), 'staticData', json(staticData), 'pinData', json(pinData), 'meta', json(meta)) FROM workflow_entity WHERE id=${sqlString(WORKFLOW_ID)};`));
  const schedule = current.nodes.find((node) => node.name === 'Schedule Trigger');
  if (!schedule) throw new Error('Schedule Trigger not found');

  const nodes = [
    schedule,
    tokenVaultGetNode({
      id: 'token-vault-get-threads',
      name: 'Get Threads Tokens',
      provider: 'threads',
      position: [-144, -160],
    }),
    explodeNode({
      id: 'token-vault-explode-threads',
      name: 'Explode Threads Tokens',
      provider: 'threads',
      position: [80, -160],
    }),
    loopNode({
      id: 'token-vault-loop-threads',
      name: 'Loop Threads Tokens',
      position: [304, -160],
    }),
    refreshThreadsNode({
      id: 'token-vault-refresh-threads',
      position: [528, -240],
    }),
    saveTokenNode({
      id: 'token-vault-save-threads',
      name: 'Save Threads Token',
      loopName: 'Loop Threads Tokens',
      provider: 'threads',
      position: [752, -240],
    }),
    tokenVaultGetNode({
      id: 'token-vault-get-instagram',
      name: 'Get Instagram Tokens',
      provider: 'instagram',
      position: [528, 32],
    }),
    explodeNode({
      id: 'token-vault-explode-instagram',
      name: 'Explode Instagram Tokens',
      provider: 'instagram',
      position: [752, 32],
    }),
    loopNode({
      id: 'token-vault-loop-instagram',
      name: 'Loop Instagram Tokens',
      position: [976, 32],
    }),
    refreshInstagramNode({
      id: 'token-vault-refresh-instagram',
      position: [1200, -48],
    }),
    saveTokenNode({
      id: 'token-vault-save-instagram',
      name: 'Save Instagram Token',
      loopName: 'Loop Instagram Tokens',
      provider: 'instagram',
      position: [1424, -48],
    }),
  ];

  const connections = {
    'Schedule Trigger': { main: [[{ node: 'Get Threads Tokens', type: 'main', index: 0 }]] },
    'Get Threads Tokens': { main: [[{ node: 'Explode Threads Tokens', type: 'main', index: 0 }]] },
    'Explode Threads Tokens': { main: [[{ node: 'Loop Threads Tokens', type: 'main', index: 0 }]] },
    'Loop Threads Tokens': {
      main: [
        [{ node: 'Get Instagram Tokens', type: 'main', index: 0 }],
        [{ node: 'Refresh Threads Token', type: 'main', index: 0 }],
      ],
    },
    'Refresh Threads Token': { main: [[{ node: 'Save Threads Token', type: 'main', index: 0 }]] },
    'Save Threads Token': { main: [[{ node: 'Loop Threads Tokens', type: 'main', index: 0 }]] },
    'Get Instagram Tokens': { main: [[{ node: 'Explode Instagram Tokens', type: 'main', index: 0 }]] },
    'Explode Instagram Tokens': { main: [[{ node: 'Loop Instagram Tokens', type: 'main', index: 0 }]] },
    'Loop Instagram Tokens': {
      main: [
        [],
        [{ node: 'Refresh Instagram Token', type: 'main', index: 0 }],
      ],
    },
    'Refresh Instagram Token': { main: [[{ node: 'Save Instagram Token', type: 'main', index: 0 }]] },
    'Save Instagram Token': { main: [[{ node: 'Loop Instagram Tokens', type: 'main', index: 0 }]] },
  };

  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const versionId = crypto.randomUUID();
  const settings = {
    ...(current.settings || {}),
    executionOrder: (current.settings && current.settings.executionOrder) || 'v1',
    availableInMCP: Boolean(current.settings && current.settings.availableInMCP),
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
    saveManualExecutions: true,
    saveExecutionProgress: true,
  };
  const updateSql = [
    'UPDATE workflow_entity SET',
    `nodes=${sqlString(JSON.stringify(nodes))},`,
    `connections=${sqlString(JSON.stringify(connections))},`,
    `settings=${sqlString(JSON.stringify(settings))},`,
    `versionId=${sqlString(versionId)},`,
    `updatedAt=${sqlString(updatedAt)}`,
    `WHERE id=${sqlString(WORKFLOW_ID)};`,
  ].join(' ');
  sqlite(updateSql);

  const exported = {
    id: WORKFLOW_ID,
    name: current.name,
    active: Boolean(current.active),
    nodes,
    connections,
    settings,
    staticData: current.staticData || null,
    pinData: current.pinData || null,
    meta: current.meta || null,
  };
  fs.writeFileSync(EXPORT_PATH, `${JSON.stringify(exported, null, 2)}\n`);
  console.log(`Patched workflow ${WORKFLOW_ID} and exported ${EXPORT_PATH}`);
}

main();
