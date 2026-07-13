#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.token-vault.export.json'),
];

const NOTIFY_ONCE_CODE = String.raw`// Pass only the first consolidated notification item.
return $input.all().filter((item) => item.json?.shouldNotify === true);`;

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function exportWorkflow(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: {},
    meta: parseJson(row.meta, null),
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    updatedAt: row.updatedAt,
  };
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = workflowFromRow(row);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-notify-once-code-filter.${timestamp}.json`);
  exportWorkflow(current, backupPath);

  const patched = {
    ...current,
    nodes: JSON.parse(JSON.stringify(current.nodes || [])),
    connections: JSON.parse(JSON.stringify(current.connections || {})),
    settings: JSON.parse(JSON.stringify(current.settings || {})),
    staticData: current.staticData || {},
    pinData: {},
    meta: {
      ...(current.meta || {}),
      codexPatch: {
        ...(current.meta?.codexPatch || {}),
        name: 'livia-notify-once-code-filter',
        appliedAt: new Date().toISOString(),
      },
    },
  };

  const notify = patched.nodes.find((node) => node.name === 'Notify Once');
  if (!notify) throw new Error('Notify Once node not found');

  notify.type = 'n8n-nodes-base.code';
  notify.typeVersion = 2;
  notify.parameters = { jsCode: NOTIFY_ONCE_CODE };

  if (!patched.connections['Notify Once']?.main?.[0]?.some((conn) => conn.node === 'Inform Success (1)' && conn.type === 'main' && conn.index === 0)) {
    throw new Error('Notify Once true branch to Inform Success (1) is missing');
  }
  patched.connections['Notify Once'].main = [[{ node: 'Inform Success (1)', type: 'main', index: 0 }]];

  const versionId = crypto.randomUUID();
  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const nodes = JSON.stringify(patched.nodes);
  const connections = JSON.stringify(patched.connections);
  const settings = JSON.stringify(patched.settings || {});
  const staticData = JSON.stringify(patched.staticData || {});
  const meta = JSON.stringify(patched.meta || {});
  const description = row.description || null;

  const save = db.transaction(() => {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(versionId, WORKFLOW_ID, 'Codex', updatedAt, updatedAt, nodes, connections, patched.name, 0, description);

    db.prepare(`
      UPDATE workflow_entity
      SET nodes = ?, connections = ?, settings = ?, staticData = ?, meta = ?, versionId = ?, activeVersionId = ?, updatedAt = ?
      WHERE id = ?
    `).run(nodes, connections, settings, staticData, meta, versionId, versionId, updatedAt, WORKFLOW_ID);
  });

  save();

  const exported = { ...patched, versionId, activeVersionId: versionId, updatedAt };
  for (const exportPath of EXPORT_PATHS) exportWorkflow(exported, exportPath);

  const fkIssues = db.prepare('PRAGMA foreign_key_check').all();
  const history = db.prepare('SELECT versionId FROM workflow_history WHERE workflowId = ? AND versionId = ?').get(WORKFLOW_ID, versionId);
  const pinKeys = Object.keys(parseJson(row.pinData, {}) || {});
  db.close();
  if (fkIssues.length) throw new Error(`foreign_key_check failed: ${JSON.stringify(fkIssues)}`);
  if (!history) throw new Error(`workflow_history row missing for ${versionId}`);

  console.log(JSON.stringify({
    ok: true,
    workflowId: WORKFLOW_ID,
    previousVersionId: current.versionId,
    versionId,
    backupPath,
    exports: EXPORT_PATHS,
    nodes: exported.nodes.length,
    connectionSources: Object.keys(exported.connections || {}).length,
    preservedDatabasePinDataKeys: pinKeys.length,
  }, null, 2));
}

main();
