#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATH = path.join(__dirname, '..', 'workflows', 'livia.token-vault.export.json');
const TOKEN_VAULT_BASE_URL = 'https://api.skincos.com.br/internal/token-vault';

function sqlite(sql) {
  return childProcess.execFileSync('sqlite3', [DB_PATH, sql], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 80,
  });
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function tokenVaultHeaders() {
  return {
    parameters: [
      {
        name: 'Authorization',
        value: '=Bearer {{$vars.TOKEN_VAULT_API_TOKEN}}',
      },
    ],
  };
}

function getCredentialTokensNode(position) {
  return {
    parameters: {
      method: 'GET',
      url: `={{ ($vars.TOKEN_VAULT_BASE_URL || '${TOKEN_VAULT_BASE_URL}') + '/v1/tokens?active=true' }}`,
      sendHeaders: true,
      headerParameters: tokenVaultHeaders(),
      options: {
        timeout: 60000,
      },
    },
    id: 'livia-token-vault-get-credentials',
    name: 'Get Credential Tokens',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position,
  };
}

function credentialCodeNode(previousNode) {
  return {
    ...previousNode,
    parameters: {
      jsCode: [
        'function str(value, fallback = "") {',
        '  return value === undefined || value === null ? fallback : String(value);',
        '}',
        '',
        'function normalizeUnit(value) {',
        '  const compact = str(value).trim().toUpperCase().replace(/\\s+/g, "").replace(/[_-]/g, "");',
        '  if ((compact.includes("BARRA") && compact.includes("SUL")) || compact === "BARRASHOPPINGSUL" || compact === "BSS") return "bss";',
        '  if ((compact.includes("NOVO") && compact.includes("HAMBURGO")) || compact === "NOVOHAMBURGO" || compact === "NH") return "nh";',
        '  return "";',
        '}',
        '',
        'const root = $input.first()?.json || {};',
        'const tokens = Array.isArray(root.items) ? root.items : [];',
        'const byUnit = {',
        '  bss: { Unit: "BSS" },',
        '  nh: { Unit: "NH" },',
        '};',
        '',
        'for (const token of tokens) {',
        '  if (!token || token.active === false) continue;',
        '  const unit = normalizeUnit(token.unit || token.metadata?.legacy_columns?.Unit);',
        '  if (!unit || !byUnit[unit]) continue;',
        '  if (token.provider === "facebook") {',
        '    byUnit[unit].fbId = str(token.fbId || token.external_account_id);',
        '    byUnit[unit].fbToken = str(token.fbToken || token.token);',
        '  } else if (token.provider === "instagram") {',
        '    byUnit[unit].igId = str(token.igId || token.external_account_id);',
        '    byUnit[unit].igToken = str(token.igToken || token.token);',
        '  } else if (token.provider === "threads") {',
        '    byUnit[unit].thId = str(token.thId || token.external_account_id);',
        '    byUnit[unit].thToken = str(token.thToken || token.token);',
        '  }',
        '}',
        '',
        'const required = ["fbId", "fbToken", "igId", "igToken", "thId", "thToken"];',
        'const missing = [];',
        'for (const [unit, row] of Object.entries(byUnit)) {',
        '  for (const field of required) {',
        '    if (!str(row[field]).trim()) missing.push(`${unit}.${field}`);',
        '  }',
        '}',
        'if (missing.length) {',
        '  throw new Error(`Credenciais incompletas no Token Vault: ${missing.join(", ")}`);',
        '}',
        '',
        'return [{ json: byUnit.bss }, { json: byUnit.nh }];',
      ].join('\n'),
    },
    name: 'Credential',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
  };
}

function replaceConnectionTargets(connections) {
  const trigger = connections['Trigger Schedule']?.main?.[0] || [];
  connections['Trigger Schedule'] = {
    main: [
      trigger.map((edge) => (
        edge.node === 'Credential'
          ? { node: 'Get Credential Tokens', type: 'main', index: 0 }
          : edge
      )),
    ],
  };
  connections['Get Credential Tokens'] = {
    main: [[{ node: 'Credential', type: 'main', index: 0 }]],
  };
  connections.Credential = {
    main: [[{ node: 'Merge (1)', type: 'main', index: 1 }]],
  };
}

function updateComposeOne(node) {
  if (!node?.parameters?.jsCode) return;
  node.parameters.jsCode = node.parameters.jsCode
    .replace('COMPOSE MEDIA (Drive + Sheets)', 'COMPOSE MEDIA (Drive + Token Vault)')
    .replace('Separa arquivos do Drive vs credenciais do Sheets', 'Separa arquivos do Drive vs credenciais do Token Vault')
    .replace('Aceita variações do Sheets', 'Aceita variações do Token Vault')
    .replace('1) SEPARAR ARQUIVOS (DRIVE) x CREDENCIAIS (SHEETS)', '1) SEPARAR ARQUIVOS (DRIVE) x CREDENCIAIS (TOKEN VAULT)')
    .replace('Credenciais das unidades BSS e NH não foram encontradas. Verifique a coluna Unit no Sheets.', 'Credenciais das unidades BSS e NH não foram encontradas no Token Vault. Verifique provider/unit/fb/ig/th.');
}

function main() {
  const current = JSON.parse(sqlite(
    `SELECT json_object('id', id, 'name', name, 'active', active, 'nodes', json(nodes), 'connections', json(connections), 'settings', json(settings), 'staticData', json(staticData), 'pinData', json(pinData), 'meta', json(meta)) FROM workflow_entity WHERE id=${sqlString(WORKFLOW_ID)};`,
  ));
  if (!current?.id) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-token-vault.${timestamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify(current, null, 2)}\n`);

  const oldCredential = current.nodes.find((node) => node.name === 'Credential');
  if (!oldCredential) throw new Error('Credential node not found');
  const trigger = current.nodes.find((node) => node.name === 'Trigger Schedule');
  const merge = current.nodes.find((node) => node.name === 'Merge (1)');
  if (!trigger || !merge) throw new Error('Required Livia topology nodes not found');

  const getNode = getCredentialTokensNode(oldCredential.position);
  const codeNode = credentialCodeNode({
    ...oldCredential,
    position: [oldCredential.position[0] + 224, oldCredential.position[1]],
  });

  const nodes = current.nodes
    .filter((node) => node.name !== 'Get Credential Tokens')
    .map((node) => {
      if (node.name === 'Credential') return codeNode;
      if (node.name === 'Compose (1)') updateComposeOne(node);
      return node;
    });

  const credentialIndex = nodes.findIndex((node) => node.name === 'Credential');
  nodes.splice(credentialIndex, 0, getNode);

  const connections = JSON.parse(JSON.stringify(current.connections || {}));
  replaceConnectionTargets(connections);

  const settings = {
    ...(current.settings || {}),
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
    saveManualExecutions: true,
    saveExecutionProgress: true,
  };

  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const versionId = crypto.randomUUID();
  sqlite([
    'UPDATE workflow_entity SET',
    `nodes=${sqlString(JSON.stringify(nodes))},`,
    `connections=${sqlString(JSON.stringify(connections))},`,
    `settings=${sqlString(JSON.stringify(settings))},`,
    `versionId=${sqlString(versionId)},`,
    `updatedAt=${sqlString(updatedAt)}`,
    `WHERE id=${sqlString(WORKFLOW_ID)};`,
  ].join(' '));

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
  console.log(`Patched ${WORKFLOW_ID}`);
  console.log(`Backup: ${backupPath}`);
  console.log(`Export: ${EXPORT_PATH}`);
}

main();
