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

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not find ${label}`);
  return source.replace(from, to);
}

function patchPrepareRequest(code) {
  let patched = replaceOnce(
    code,
    `function isTransientHttp({ httpEnv, body }) {
  const status = Number(httpEnv?.statusCode || 0);
  if (status >= 500) return true;
  if (status === 429 || status === 408) return true;

  const apiErr = extractApiError(body);
  const raw = apiErr?.raw || {};
  if (raw && (raw.is_transient === true || raw.isTransient === true)) return true;

  return false;
}
`,
    `function isPermanentApiError(apiErr) {
  const code = str(apiErr?.code || apiErr?.raw?.code || "", "");
  const type = str(apiErr?.type || "", "").toLowerCase();
  const msg = str(apiErr?.message || "", "").toLowerCase();

  if (code === "190" || code === "10" || code === "200") return true;
  if (type.includes("oauth")) return true;
  if (msg.includes("invalid oauth") || msg.includes("access token") || msg.includes("token")) return true;

  return false;
}

function isTransientHttp({ httpEnv, body }) {
  const status = Number(httpEnv?.statusCode || 0);
  const apiErr = extractApiError(body);

  if (status === 401 || status === 403 || isPermanentApiError(apiErr)) return false;
  if (status >= 500) return true;
  if (status === 429 || status === 408) return true;

  const raw = apiErr?.raw || {};
  if (raw && (raw.is_transient === true || raw.isTransient === true)) return true;

  return false;
}
`,
    'Prepare Request isTransientHttp block',
  );

  patched = replaceOnce(
    patched,
    `function getRun(runIndex) { return state.byRun[String(runIndex)] || null; }

// ✅ ADD: cache miss explícito (mais previsível)
function ensureRun(runIndex, ctx) {`,
    `function getRun(runIndex) { return state.byRun[String(runIndex)] || null; }

function looksLikePreparedJob(value) {
  const j = normObj(value);
  return !!(j.phase && j.publishRunIndex !== undefined && (j.url || j.httpRequest?.url));
}

function recoverJobFromPairedWaitItem() {
  try {
    const paired = $("Wait").item?.json;
    if (looksLikePreparedJob(paired)) return paired;
  } catch {}

  try {
    const waitItems = $items("Wait") || [];
    for (let i = waitItems.length - 1; i >= 0; i--) {
      const candidate = waitItems[i]?.json;
      if (looksLikePreparedJob(candidate)) return candidate;
    }
  } catch {}

  return null;
}

function accessTokenForJob(job) {
  return str(
    job?.params?.access_token ||
    job?.query?.access_token ||
    job?.requestQuery?.access_token ||
    job?.httpRequest?.query?.access_token ||
    "",
    ""
  ).trim();
}

function assertGraphAccessToken(job) {
  const phase = str(job?.phase, "").toLowerCase();
  const platform = str(job?.platform, "").toLowerCase();
  const url = str(job?.url || job?.httpRequest?.url || "", "");
  if (phase === "mediaavailability") return;
  if (!platform && !url.includes("graph.")) return;
  if (accessTokenForJob(job)) return;

  throw new Error(
    \`Prepare Request: token ausente antes da chamada Graph (platform=\${platform || "n/a"}, phase=\${phase || "n/a"}, step=\${str(job?.step, "n/a")}, unit=\${str(job?.unit, "n/a")}, publishRunIndex=\${str(job?.publishRunIndex, "n/a")}).\`
  );
}

// ✅ ADD: cache miss explícito (mais previsível)
function ensureRun(runIndex, ctx) {`,
    'Prepare Request state helper insertion',
  );

  patched = replaceOnce(
    patched,
    `  const job = dequeue();
  if (!job) {
    throw new Error("Prepare Request: recebi resposta HTTP mas a fila está vazia (sem job correspondente).");
  }
`,
    `  const job = dequeue() || recoverJobFromPairedWaitItem();
  if (!job) {
    throw new Error("Prepare Request: recebi resposta HTTP mas a fila está vazia e não consegui recuperar o job pareado do Wait.");
  }
`,
    'Prepare Request post-http dequeue block',
  );

  patched = replaceOnce(
    patched,
    `const method = (str(job.method, "").toUpperCase() || "POST");

// resolver deps via cache
function getByRun(runIndex) { return getRun(runIndex); }
`,
    `const method = (str(job.method, "").toUpperCase() || "POST");

assertGraphAccessToken(job);

// resolver deps via cache
function getByRun(runIndex) { return getRun(runIndex); }
`,
    'Prepare Request pre-http token guard',
  );

  return patched;
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = workflowFromRow(row);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-prepare-request-token-queue-guard.${timestamp}.json`);
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
        name: 'livia-prepare-request-token-and-queue-guard',
        appliedAt: new Date().toISOString(),
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
  const nodes = JSON.stringify(patched.nodes);
  const connections = JSON.stringify(patched.connections);
  const settings = JSON.stringify(patched.settings || {});
  const staticData = JSON.stringify(patched.staticData || {});
  const meta = JSON.stringify(patched.meta || {});

  const save = db.transaction(() => {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(versionId, WORKFLOW_ID, 'Codex', updatedAt, updatedAt, nodes, connections, patched.name, 0, row.description || null);

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
    previousActiveVersionId: current.activeVersionId,
    versionId,
    backupPath,
    exports: EXPORT_PATHS,
    preservedDatabasePinDataKeys: pinKeys.length,
  }, null, 2));
}

main();
