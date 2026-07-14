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

function workflowFromRow(row, includePinData = false) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: includePinData ? parseJson(row.pinData, {}) : {},
    meta: parseJson(row.meta, null),
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    updatedAt: row.updatedAt,
  };
}

function writeExport(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
}

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not find ${label}`);
  return source.replace(from, to);
}

function patchPrepare(code) {
  return replaceOnce(
    code,
    `  const mimeType = str(
    current.mimeType ||
    current.mediaMimeType ||
    preparedBinaryData.mimeType ||
    binaryData.mimeType ||
    mimeFromExt(ext, ""),
    ""
  );`,
    `  const mimeType = str(
    (hasVideoPath ? preparedBinaryData.mimeType : "") ||
    current.mimeType ||
    current.mediaMimeType ||
    preparedBinaryData.mimeType ||
    binaryData.mimeType ||
    mimeFromExt(ext, ""),
    ""
  );`,
    'Prepare Main Media Upload mimeType priority',
  );
}

function patchAttach(code) {
  let patched = code;
  patched = replaceOnce(
    patched,
    `function sourceNameForUpload(upload, finalUrl = "") {`,
    `function getPrepareUploadItems() {
  try {
    return $items("Prepare Main Media Upload") || [];
  } catch {
    return [];
  }
}

function sourceNameForUpload(upload, finalUrl = "") {`,
    'Attach getPrepareUploadItems insertion',
  );

  patched = replaceOnce(
    patched,
    `function isFrameCandidateUpload(upload) {
  if (upload.uploadRole === "frame_candidate") return true;
  if (upload.uploadRole === "main_media") return false;
  const source = sourceNameForUpload(upload, upload.secure_url || upload.url);
  return /(?:^|[_-])cand[_-]?\\d{1,3}(?:\\.|$)/i.test(fileNameOnly(source) || source);
}`,
    `function isFrameCandidateUpload(upload, source = {}) {
  if (source.uploadRole === "frame_candidate") return true;
  if (source.uploadRole === "main_media") return false;
  if (upload.uploadRole === "frame_candidate") return true;
  if (upload.uploadRole === "main_media") return false;
  const sourceName = sourceNameForUpload(source, "") || sourceNameForUpload(upload, upload.secure_url || upload.url);
  return /(?:^|[_-])cand[_-]?\\d{1,3}(?:\\.|$)/i.test(fileNameOnly(sourceName) || sourceName);
}`,
    'Attach isFrameCandidateUpload source-aware',
  );

  patched = replaceOnce(
    patched,
    `function buildFrameContext(upload, index) {
  const url = ensureHttps(upload.secure_url || upload.url || upload.finalUrl || "");
  const sourceName = sourceNameForUpload(upload, url);
  const groupKey = str(upload.groupKey || deriveGroupKey(sourceName), "");
  const candidateSource = asObj(upload.candidate);`,
    `function buildFrameContext(upload, index, source = {}) {
  const url = ensureHttps(upload.secure_url || upload.url || upload.finalUrl || "");
  const sourceName = sourceNameForUpload(source, "") || sourceNameForUpload(upload, url);
  const groupKey = str(upload.groupKey || source.groupKey || deriveGroupKey(sourceName), "");
  const candidateSource = asObj(source.candidate || upload.candidate);`,
    'Attach buildFrameContext source-aware header',
  );

  patched = replaceOnce(
    patched,
    `    mediaId: str(upload.mediaId || upload.id || "", ""),
    mediaName: str(upload.mediaName || "", ""),
    mediaMimeType: str(upload.mediaMimeType || "", ""),
    groupKey,
    groupOrder: upload.groupOrder,
    publishTime: str(upload.publishTime || "", ""),`,
    `    mediaId: str(source.mediaId || source.id || upload.mediaId || "", ""),
    mediaName: str(source.mediaName || source.name || upload.mediaName || "", ""),
    mediaMimeType: str(source.mediaMimeType || source.mimeType || upload.mediaMimeType || "", ""),
    groupKey,
    groupOrder: source.groupOrder ?? upload.groupOrder,
    publishTime: str(source.publishTime || upload.publishTime || "", ""),`,
    'Attach frame context source-aware media fields',
  );

  patched = replaceOnce(
    patched,
    `function cacheFrameContext(upload, index, frameStore) {
  const frameContext = buildFrameContext(upload, index);`,
    `function cacheFrameContext(upload, index, frameStore, source = {}) {
  const frameContext = buildFrameContext(upload, index, source);`,
    'Attach cacheFrameContext source-aware signature',
  );

  patched = replaceOnce(
    patched,
    `const frameStore = getExecutionFrameStoreForWrite();
const mainStore = getExecutionMainStore();
const inputItems = $input.all();

for (const [index, item] of inputItems.entries()) {
  const upload = asObj(item && item.json);
  if (isFrameCandidateUpload(upload)) {
    cacheFrameContext(upload, index, frameStore);
  }
}

const output = [];

for (const item of inputItems) {
  const upload = asObj(item && item.json);
  if (isFrameCandidateUpload(upload)) continue;`,
    `const frameStore = getExecutionFrameStoreForWrite();
const mainStore = getExecutionMainStore();
const inputItems = $input.all();
const sourceItems = getPrepareUploadItems();

function sourceForIndex(index) {
  return asObj(sourceItems[index] && sourceItems[index].json);
}

function mergeUploadWithSource(upload, source) {
  return {
    ...source,
    ...upload,
    uploadRole: upload.uploadRole || source.uploadRole,
    groupKey: upload.groupKey || source.groupKey,
    mimeType: upload.mimeType || source.mimeType,
    mediaMimeType: upload.mediaMimeType || source.mediaMimeType,
    mainMediaFileName: source.mainMediaFileName || upload.mainMediaFileName,
    name: source.name || upload.name,
    mediaName: source.mediaName || upload.mediaName,
  };
}

for (const [index, item] of inputItems.entries()) {
  const source = sourceForIndex(index);
  const upload = mergeUploadWithSource(asObj(item && item.json), source);
  if (isFrameCandidateUpload(upload, source)) {
    cacheFrameContext(upload, index, frameStore, source);
  }
}

const output = [];

for (const [index, item] of inputItems.entries()) {
  const source = sourceForIndex(index);
  const upload = mergeUploadWithSource(asObj(item && item.json), source);
  if (isFrameCandidateUpload(upload, source)) continue;`,
    'Attach source item recovery loops',
  );

  patched = replaceOnce(
    patched,
    `    id: str(upload.id || upload.mediaId || compose1Context.id || "", ""),`,
    `    id: str(source.id || source.mediaId || compose1Context.id || upload.mediaId || "", ""),`,
    'Attach main output drive id priority',
  );

  return patched;
}

const db = new Database(DB_PATH);
const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
if (!row) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

const before = workflowFromRow(row, true);
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const checkpointPath = path.join(__dirname, '..', 'workflows', `livia.before-upload-role-recovery.${timestamp}.json`);
writeExport(before, checkpointPath);

const workflow = workflowFromRow(row, false);
const prepare = getNode(workflow, 'Prepare Main Media Upload');
const attach = getNode(workflow, 'Attach Uploaded Main Media Metadata');
prepare.parameters.jsCode = patchPrepare(prepare.parameters.jsCode || '');
attach.parameters.jsCode = patchAttach(attach.parameters.jsCode || '');

const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-upload-role-recovery',
    appliedAt: new Date().toISOString(),
    previousVersionId: row.versionId,
    previousActiveVersionId: row.activeVersionId,
  },
};

workflow.versionId = versionId;
workflow.activeVersionId = versionId;
workflow.updatedAt = updatedAt;
workflow.meta = meta;
workflow.pinData = {};

const nodesJson = JSON.stringify(workflow.nodes);
const connectionsJson = JSON.stringify(workflow.connections);
const metaJson = JSON.stringify(meta);

db.transaction(() => {
  db.prepare(`
    insert into workflow_history
      (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
    values
      (@versionId, @workflowId, @authors, @createdAt, @updatedAt, @nodes, @connections, @name, 0, @description)
  `).run({
    versionId,
    workflowId: WORKFLOW_ID,
    authors: 'Codex',
    createdAt: updatedAt,
    updatedAt,
    nodes: nodesJson,
    connections: connectionsJson,
    name: workflow.name,
    description: row.description || null,
  });

  db.prepare(`
    update workflow_entity
    set nodes = @nodes,
        connections = @connections,
        meta = @meta,
        versionId = @versionId,
        activeVersionId = @versionId,
        updatedAt = @updatedAt,
        versionCounter = versionCounter + 1
    where id = @workflowId
  `).run({
    nodes: nodesJson,
    connections: connectionsJson,
    meta: metaJson,
    versionId,
    updatedAt,
    workflowId: WORKFLOW_ID,
  });
})();

for (const exportPath of EXPORT_PATHS) {
  writeExport(workflow, exportPath);
}

console.log(JSON.stringify({
  ok: true,
  workflowId: WORKFLOW_ID,
  previousVersionId: row.versionId,
  previousActiveVersionId: row.activeVersionId,
  versionId,
  checkpointPath,
  nodes: workflow.nodes.length,
}, null, 2));
