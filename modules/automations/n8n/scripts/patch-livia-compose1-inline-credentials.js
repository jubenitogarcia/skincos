#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.token-vault.export.json'),
];

function sqlite(sql) {
  return childProcess.execFileSync('sqlite3', [DB_PATH, sql], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 100,
  });
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function getWorkflow() {
  return JSON.parse(sqlite(
    `SELECT json_object(
      'id', id,
      'name', name,
      'active', active,
      'nodes', json(nodes),
      'connections', json(connections),
      'settings', json(settings),
      'staticData', json(staticData),
      'pinData', json(pinData),
      'meta', json(meta),
      'versionId', versionId
    ) FROM workflow_entity WHERE id=${sqlString(WORKFLOW_ID)};`,
  ));
}

function exportWorkflow(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Unable to find Compose (1) block: ${label}`);
  }
  return source.replace(before, after);
}

function removeConnectionTargets(connections, removedNames) {
  const cleaned = {};
  for (const [sourceName, outputs] of Object.entries(connections || {})) {
    if (removedNames.has(sourceName)) continue;
    const nextOutputs = {};
    for (const [outputName, groups] of Object.entries(outputs || {})) {
      nextOutputs[outputName] = (groups || []).map((group) => (
        (group || []).filter((edge) => !removedNames.has(edge.node))
      ));
    }
    cleaned[sourceName] = nextOutputs;
  }
  return cleaned;
}

function removeDisconnectedStop(nodes, connections) {
  const stop = nodes.find((node) => node.name === 'Stop');
  if (!stop) return nodes;

  const hasIncoming = Object.entries(connections || {}).some(([, outputs]) => (
    Object.values(outputs || {}).some((groups) => (
      (groups || []).some((group) => (
        (group || []).some((edge) => edge.node === 'Stop')
      ))
    ))
  ));
  const hasOutgoing = Boolean(connections.Stop);
  if (hasIncoming || hasOutgoing) return nodes;
  return nodes.filter((node) => node.name !== 'Stop');
}

const oldCredentialFunction = `function getUnitCredentials(items) {
  const byUnit = { bss: null, nh: null };

  for (const item of items) {
    const data = item.json || {};
    const unitKey = normalizeUnit(data.Unit);
    if (!unitKey) continue;
    byUnit[unitKey] = data;
  }

  if (!byUnit.bss || !byUnit.nh) {
    throw new Error(
      "Credenciais das unidades BSS e NH não foram encontradas no Token Vault. Verifique provider/unit/fb/ig/th."
    );
  }

  return { credBSS: byUnit.bss, credNH: byUnit.nh };
}`;

const newCredentialFunction = `function getUnitCredentialsFromTokenVault(root) {
  const tokens = Array.isArray(root?.items) ? root.items : [];
  const byUnit = {
    bss: { Unit: "BSS" },
    nh: { Unit: "NH" },
  };

  for (const token of tokens) {
    if (!token || token.active === false) continue;
    const unitKey = normalizeUnit(token.unit || token.metadata?.legacy_columns?.Unit);
    if (!unitKey || !byUnit[unitKey]) continue;

    if (token.provider === "facebook") {
      byUnit[unitKey].fbId = str(token.fbId || token.external_account_id);
      byUnit[unitKey].fbToken = str(token.fbToken || token.token);
    } else if (token.provider === "instagram") {
      byUnit[unitKey].igId = str(token.igId || token.external_account_id);
      byUnit[unitKey].igToken = str(token.igToken || token.token);
    } else if (token.provider === "threads") {
      byUnit[unitKey].thId = str(token.thId || token.external_account_id);
      byUnit[unitKey].thToken = str(token.thToken || token.token);
    }
  }

  const required = ["fbId", "fbToken", "igId", "igToken", "thId", "thToken"];
  const missing = [];
  for (const [unit, row] of Object.entries(byUnit)) {
    for (const field of required) {
      if (!str(row[field]).trim()) missing.push(\`\${unit}.\${field}\`);
    }
  }
  if (missing.length) {
    throw new Error(\`Credenciais incompletas no Token Vault: \${missing.join(", ")}\`);
  }

  return { credBSS: byUnit.bss, credNH: byUnit.nh };
}`;

const oldInputBlock = `const allItems = $input.all();

const driveFiles = [];
const credentialItems = [];

for (const item of allItems) {
  const j = item.json || {};
  if (j.mimeType && j.name) driveFiles.push(j);
  else if (j.Unit) credentialItems.push(item);
}

if (!driveFiles.length) return [];

// 2) Credenciais
const { credBSS, credNH } = getUnitCredentials(credentialItems);`;

const newInputBlock = `const driveFiles = $input.all()
  .map((item) => item.json || {})
  .filter((item) => item.mimeType && item.name);

if (!driveFiles.length) return [];

let tokenVaultRoot = {};
try {
  tokenVaultRoot = $("Get Credential Tokens").first().json || {};
} catch (error) {
  throw new Error(\`Não foi possível ler credenciais do node Get Credential Tokens: \${error.message}\`);
}

// 2) Credenciais
const { credBSS, credNH } = getUnitCredentialsFromTokenVault(tokenVaultRoot);`;

function patchComposeOne(node) {
  let code = node.parameters?.jsCode || '';
  code = replaceOnce(code, oldCredentialFunction, newCredentialFunction, 'credential function');
  code = replaceOnce(code, oldInputBlock, newInputBlock, 'input split block');
  code = code
    .replace('COMPOSE MEDIA (Drive + Token Vault)', 'COMPOSE MEDIA (Drive + inline Token Vault)')
    .replace('Separa arquivos do Drive vs credenciais do Token Vault', 'Usa arquivos do Drive e credenciais inline do Token Vault');
  node.parameters.jsCode = code;
}

function main() {
  const current = getWorkflow();
  if (!current?.id) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-compose1-inline-credentials.${timestamp}.json`);
  exportWorkflow(current, backupPath);

  const removed = new Set(['Credential', 'Stop']);
  let nodes = JSON.parse(JSON.stringify(current.nodes || []));
  const composeOne = nodes.find((node) => node.name === 'Compose (1)');
  if (!composeOne) throw new Error('Compose (1) node not found');
  patchComposeOne(composeOne);

  nodes = nodes.filter((node) => !removed.has(node.name));

  let connections = removeConnectionTargets(
    JSON.parse(JSON.stringify(current.connections || {})),
    removed,
  );
  nodes = removeDisconnectedStop(nodes, connections);
  connections = removeConnectionTargets(connections, new Set(['Stop']));

  const meta = {
    ...(current.meta || {}),
    codexPatch: {
      ...(current.meta?.codexPatch || {}),
      name: 'livia-compose1-inline-credentials',
      appliedAt: new Date().toISOString(),
    },
  };

  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const versionId = crypto.randomUUID();
  const versionCounter = Number(sqlite(`SELECT versionCounter FROM workflow_entity WHERE id=${sqlString(WORKFLOW_ID)};`).trim() || '0') + 1;

  sqlite([
    'UPDATE workflow_entity SET',
    `nodes=${sqlString(JSON.stringify(nodes))},`,
    `connections=${sqlString(JSON.stringify(connections))},`,
    `settings=${sqlString(JSON.stringify(current.settings || {}))},`,
    `staticData=${sqlString(JSON.stringify(current.staticData || {}))},`,
    `pinData=${sqlString(JSON.stringify(current.pinData || {}))},`,
    `meta=${sqlString(JSON.stringify(meta))},`,
    `versionId=${sqlString(versionId)},`,
    `activeVersionId=${sqlString(versionId)},`,
    `versionCounter=${versionCounter},`,
    `updatedAt=${sqlString(updatedAt)}`,
    `WHERE id=${sqlString(WORKFLOW_ID)};`,
  ].join(' '));

  const exported = {
    ...current,
    nodes,
    connections,
    meta,
    versionId,
  };
  for (const exportPath of EXPORT_PATHS) {
    exportWorkflow(exported, exportPath);
  }

  console.log(`Patched workflow ${WORKFLOW_ID}`);
  console.log(`Backup: ${backupPath}`);
  for (const exportPath of EXPORT_PATHS) console.log(`Export: ${exportPath}`);
}

main();
