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

function patchCompose1(code) {
  if (code.includes('__liviaCompose1')) return code;

  return replaceOnce(
    code,
    '\nreturn output;',
    `
try {
  const sd = $getWorkflowStaticData("global");
  const execId = str($execution?.id, "noexec");
  sd.__liviaCompose1 ||= {};
  for (const key of Object.keys(sd.__liviaCompose1)) {
    if (key !== execId) delete sd.__liviaCompose1[key];
  }
  const store = { __items: output };
  for (const item of output) {
    const row = item.json || {};
    const keys = [
      row.id,
      row.name,
      row.groupKey,
      row.webContentLink,
      str(row.name, "").replace(/\\.[^.]+$/, ""),
    ].filter(Boolean);
    for (const key of keys) store[String(key)] = row;
  }
  sd.__liviaCompose1[execId] = store;
} catch {}

return output;
`,
    'Compose (1) return output block',
  );
}

function patchAttachUploadedMain(code) {
  let patched = code;

  if (!patched.includes('function getExecutionCompose1Store()')) {
    patched = replaceOnce(
      patched,
      `function getExecutionMainStore() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    sd.__liviaMainUploads ||= {};

    for (const key of Object.keys(sd.__liviaMainUploads)) {
      if (key !== execId) delete sd.__liviaMainUploads[key];
    }

    sd.__liviaMainUploads[execId] ||= {};
    return sd.__liviaMainUploads[execId];
  } catch {
    return null;
  }
}
`,
      `function getExecutionMainStore() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    sd.__liviaMainUploads ||= {};

    for (const key of Object.keys(sd.__liviaMainUploads)) {
      if (key !== execId) delete sd.__liviaMainUploads[key];
    }

    sd.__liviaMainUploads[execId] ||= {};
    return sd.__liviaMainUploads[execId];
  } catch {
    return null;
  }
}

function getExecutionCompose1Store() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd.__liviaCompose1)[execId]);
  } catch {
    return {};
  }
}

function findCompose1Context({ groupKey, name, upload, finalUrl }) {
  const keys = cacheKeys(groupKey, name, upload.id, upload.mediaId, upload.public_id, upload.original_filename, upload.display_name, finalUrl);
  const store = getExecutionCompose1Store();
  for (const key of keys) {
    if (store[key]) return asObj(store[key]);
  }

  const rows = Array.isArray(store.__items)
    ? store.__items.map((item) => asObj(item && item.json)).filter((row) => Object.keys(row).length)
    : [];

  for (const row of rows) {
    const rowKeys = cacheKeys(row.groupKey, row.name, row.id, row.webContentLink);
    if (keys.some((key) => rowKeys.includes(key))) return row;
  }

  if (groupKey) {
    const byGroup = rows.find((row) => str(row.groupKey, "") === groupKey);
    if (byGroup) return byGroup;
  }

  return {};
}
`,
      'Attach Uploaded Main Media Metadata store helpers',
    );
  }

  if (!patched.includes('const compose1Context = findCompose1Context')) {
    patched = replaceOnce(
      patched,
      `  const frameContext = findFrameContext(groupKey, name, upload);
  const frameCandidates = Array.isArray(frameContext.frameCandidates) ? frameContext.frameCandidates : [];
`,
      `  const frameContext = findFrameContext(groupKey, name, upload);
  const compose1Context = findCompose1Context({ groupKey, name, upload, finalUrl });
  const frameCandidates = Array.isArray(frameContext.frameCandidates) ? frameContext.frameCandidates : [];
`,
      'Attach Uploaded Main Media Metadata compose1 context lookup',
    );
  }

  patched = replaceOnce(
    patched,
    `  if (!upload.id && !upload.mediaId) warnings.push("main_media_drive_context_not_available_after_upload");
  if (!Object.keys(frameContext).length && mediaType === "VIDEO") warnings.push("frame_context_not_available_after_upload");

  const outputJson = {
    ...upload,
    id: str(upload.id || upload.mediaId || "", ""),
    name,
    mimeType,
    groupKey,
    groupOrder: upload.groupOrder,
    publishTime: str(upload.publishTime || "", ""),
`,
    `  if (!upload.id && !upload.mediaId && !compose1Context.id) warnings.push("main_media_drive_context_not_available_after_upload");
  if (!Object.keys(frameContext).length && mediaType === "VIDEO") warnings.push("frame_context_not_available_after_upload");
  if (!upload.instagram && !compose1Context.instagram) warnings.push("publish_context_rehydrated_from_compose1_missing_instagram");
  if (!upload.facebook && !compose1Context.facebook) warnings.push("publish_context_rehydrated_from_compose1_missing_facebook");
  if (!upload.threads && !compose1Context.threads) warnings.push("publish_context_rehydrated_from_compose1_missing_threads");

  const outputJson = {
    ...compose1Context,
    ...upload,
    id: str(upload.id || upload.mediaId || compose1Context.id || "", ""),
    name: name || str(compose1Context.name || "", ""),
    mimeType: mimeType || str(compose1Context.mimeType || "", ""),
    groupKey: groupKey || str(compose1Context.groupKey || "", ""),
    groupOrder: upload.groupOrder ?? compose1Context.groupOrder,
    publishTime: str(upload.publishTime || compose1Context.publishTime || "", ""),
`,
    'Attach Uploaded Main Media Metadata output context merge',
  );

  patched = replaceOnce(
    patched,
    `    media_type: upload.media_type || mediaType,
    media_type_1st_requisition: upload.media_type_1st_requisition || mediaType,
    media_type_2nd_requisition: upload.media_type_2nd_requisition || mediaType,
    media_type_instagram: upload.media_type_instagram || (mediaType === "VIDEO" ? "REELS" : ""),
`,
    `    media_type: upload.media_type || compose1Context.media_type || mediaType,
    media_type_1st_requisition: upload.media_type_1st_requisition || compose1Context.media_type_1st_requisition || mediaType,
    media_type_2nd_requisition: upload.media_type_2nd_requisition || compose1Context.media_type_2nd_requisition || mediaType,
    media_type_instagram: upload.media_type_instagram || compose1Context.media_type_instagram || (mediaType === "VIDEO" ? "REELS" : ""),
    facebook: upload.facebook || compose1Context.facebook,
    instagram: upload.instagram || compose1Context.instagram,
    threads: upload.threads || compose1Context.threads,
`,
    'Attach Uploaded Main Media Metadata platform config merge',
  );

  return patched;
}

function patchPrepareRequest(code) {
  let patched = code;

  if (patched.includes('function recoverJobFromPairedWaitItem()')) {
    patched = patched.replace(
      `
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
`,
      '\n',
    );
  }

  patched = patched.replace(
    '  const job = dequeue() || recoverJobFromPairedWaitItem();\n  if (!job) {\n    throw new Error("Prepare Request: recebi resposta HTTP mas a fila está vazia e não consegui recuperar o job pareado do Wait.");\n  }\n',
    '  const job = dequeue();\n  if (!job) {\n    throw new Error("Prepare Request: recebi resposta HTTP mas a fila está vazia (sem job correspondente no cache da execução).");\n  }\n',
  );

  if (patched.includes('recoverJobFromPairedWaitItem') || patched.includes('$items("Wait")') || patched.includes('$("Wait")')) {
    throw new Error('Prepare Request still contains Wait named-node recovery');
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
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-prepare-request-code-context.${timestamp}.json`);
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
        name: 'livia-prepare-request-code-context',
        appliedAt: new Date().toISOString(),
      },
    },
  };

  const compose1 = patched.nodes.find((node) => node.name === 'Compose (1)');
  const attachMain = patched.nodes.find((node) => node.name === 'Attach Uploaded Main Media Metadata');
  const prepare = patched.nodes.find((node) => node.name === 'Prepare Request');
  for (const node of [compose1, attachMain, prepare]) {
    if (!node) throw new Error('Required Code node not found');
    if (node.type !== 'n8n-nodes-base.code') throw new Error(`${node.name} is not a Code node`);
  }

  compose1.parameters.jsCode = patchCompose1(compose1.parameters.jsCode || '');
  attachMain.parameters.jsCode = patchAttachUploadedMain(attachMain.parameters.jsCode || '');
  prepare.parameters.jsCode = patchPrepareRequest(prepare.parameters.jsCode || '');

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
