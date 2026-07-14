#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.active.json'),
  path.join(__dirname, '..', 'workflows', 'livia.verify.json'),
  path.join(__dirname, '..', 'workflows', 'livia.db-current.json'),
];

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
    staticData: parseJson(row.staticData, {}),
    pinData: {},
    meta: parseJson(row.meta, {}),
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    updatedAt: row.updatedAt,
  };
}

function replaceRegex(source, regex, replacement, label) {
  if (!regex.test(source)) throw new Error(`Could not find ${label}`);
  return source.replace(regex, replacement);
}

function patchPrepareRequest(code) {
  let patched = code;

  patched = replaceRegex(
    patched,
    /  function namedNodeItemsFallback\(name\) \{[\s\S]*?\n  function cleanupExecutionStaticStores\(\) \{/,
    `  function namedNodeItem(name, mode = "paired") {
    const normalizedName = str(name, "").trim();
    if (!normalizedName || typeof $ !== "function") return null;

    try {
      const ref = $(normalizedName);
      if (!ref) return null;
      if (mode === "first" && typeof ref.first === "function") return ref.first();
      if (mode === "paired" && ref.item) return ref.item;
      if (typeof ref.first === "function") return ref.first();
    } catch {}

    return null;
  }

  function safeNodeItems(name) {
    if (name === "Attach Uploaded Main Media Metadata") {
      const staticItems = staticStoreItems(getExecutionStaticStore("__liviaMainUploads"));
      if (staticItems.length) return staticItems;

      const paired = namedNodeItem(name, "paired");
      const json = asObj((paired && paired.json) || paired) || {};
      return Object.keys(json).length ? [{ json }] : [];
    }

    if (name === "Prepare Media Items") {
      return staticStoreItems(getExecutionStaticStore("__liviaCompose1"));
    }

    if (name === "Get Credential Tokens") {
      const first = namedNodeItem(name, "first");
      const json = asObj((first && first.json) || first) || {};
      return Object.keys(json).length ? [{ json }] : [];
    }

    return [];
  }

  function cleanupExecutionStaticStores() {`,
    'Prepare Request minimal lookup block',
  );

  if (patched.includes('$items(')) {
    throw new Error('Prepare Request still contains $items lookups after minimal lookup patch');
  }

  if (patched.includes('ref.all(') || patched.includes('namedNodeItemsFallback')) {
    throw new Error('Prepare Request still contains broad live lookups after minimal lookup patch');
  }

  if (!patched.includes('namedNodeItem(name, "paired")') || !patched.includes('namedNodeItem(name, "first")')) {
    throw new Error('Prepare Request minimal live lookup patch did not add paired/first accessors');
  }

  return patched;
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = workflowFromRow(row);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-prepare-request-minimal-live-lookups.${timestamp}.json`);
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
        name: 'livia-prepare-request-minimal-live-lookups',
        appliedAt: new Date().toISOString(),
        previousVersionId: current.versionId,
        previousActiveVersionId: current.activeVersionId,
      },
    },
  };

  const prepareNode = patched.nodes.find((node) => node.name === 'Prepare Request');
  if (!prepareNode) throw new Error('Prepare Request node not found');
  prepareNode.parameters = {
    ...(prepareNode.parameters || {}),
    jsCode: patchPrepareRequest(prepareNode.parameters?.jsCode || ''),
  };

  const versionId = crypto.randomUUID();
  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const nodesJson = JSON.stringify(patched.nodes);
  const connectionsJson = JSON.stringify(patched.connections);
  const settingsJson = JSON.stringify(patched.settings || {});
  const staticDataJson = JSON.stringify(patched.staticData || {});
  const metaJson = JSON.stringify(patched.meta || {});

  db.transaction(() => {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      WORKFLOW_ID,
      'Codex',
      updatedAt,
      updatedAt,
      nodesJson,
      connectionsJson,
      patched.name,
      0,
      row.description || null,
    );

    db.prepare(`
      UPDATE workflow_entity
      SET nodes = ?,
          connections = ?,
          settings = ?,
          staticData = ?,
          meta = ?,
          versionId = ?,
          activeVersionId = ?,
          updatedAt = ?,
          versionCounter = versionCounter + 1
      WHERE id = ?
    `).run(
      nodesJson,
      connectionsJson,
      settingsJson,
      staticDataJson,
      metaJson,
      versionId,
      versionId,
      updatedAt,
      WORKFLOW_ID,
    );
  })();

  const exported = {
    ...patched,
    versionId,
    activeVersionId: versionId,
    updatedAt,
  };

  for (const exportPath of EXPORT_PATHS) exportWorkflow(exported, exportPath);

  const fkIssues = db.prepare('PRAGMA foreign_key_check').all();
  const history = db.prepare('SELECT versionId FROM workflow_history WHERE workflowId = ? AND versionId = ?').get(WORKFLOW_ID, versionId);
  db.close();

  if (fkIssues.length) throw new Error(`foreign_key_check failed: ${JSON.stringify(fkIssues)}`);
  if (!history) throw new Error(`workflow_history row missing for ${versionId}`);

  console.log(JSON.stringify({
    ok: true,
    workflowId: WORKFLOW_ID,
    previousVersionId: current.versionId,
    previousActiveVersionId: current.activeVersionId,
    versionId,
    backupPath,
    exports: EXPORT_PATHS,
  }, null, 2));
}

main();
