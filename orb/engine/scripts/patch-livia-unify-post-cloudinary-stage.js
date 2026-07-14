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
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`Patch anchor not found: ${label}`);
  }
  return source.replace(needle, replacement);
}

function workflowFromRow(row, includeMeta = false) {
  return {
    id: row.id,
    name: row.name,
    active: !!row.active,
    settings: JSON.parse(row.settings || '{}'),
    staticData: JSON.parse(row.staticData || '{}'),
    pinData: JSON.parse(row.pinData || '{}'),
    versionId: row.versionId || '',
    activeVersionId: row.activeVersionId || row.versionId || '',
    meta: includeMeta ? JSON.parse(row.meta || '{}') : JSON.parse(row.meta || '{}'),
    nodes: JSON.parse(row.nodes || '[]'),
    connections: JSON.parse(row.connections || '{}'),
  };
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function removeNode(workflow, name) {
  workflow.nodes = workflow.nodes.filter((node) => node.name !== name);
}

function removeConnectionsForNode(connections, nodeName) {
  delete connections[nodeName];
  for (const source of Object.keys(connections)) {
    for (const [outputName, groups] of Object.entries(connections[source] || {})) {
      connections[source][outputName] = (groups || []).map((group) =>
        (group || []).filter((connection) => connection.node !== nodeName),
      );
    }
  }
}

function addMainConnection(connections, source, target, inputIndex = 0) {
  connections[source] ||= {};
  connections[source].main ||= [];
  connections[source].main[0] ||= [];
  const group = connections[source].main[0];
  if (!group.some((connection) => connection.node === target && connection.type === 'main' && connection.index === inputIndex)) {
    group.push({ node: target, type: 'main', index: inputIndex });
  }
}

function setSingleMainConnection(connections, source, target, inputIndex = 0) {
  connections[source] ||= {};
  connections[source].main ||= [];
  connections[source].main[0] = [{ node: target, type: 'main', index: inputIndex }];
}

function patchAttachMainCode(code) {
  const oldPrepareHelper = `function getPrepareUploadItems() {
  try {
    return $items("Prepare Main Media Upload") || [];
  } catch {
    return [];
  }
}
`;

  const newPrepareHelper = `function getCompose1Rows() {
  const store = getExecutionCompose1Store();
  const rows = [];
  const seen = new Set();

  function addRow(row) {
    const current = asObj(row);
    if (!Object.keys(current).length) return;
    const keys = cacheKeys(current.groupKey, current.id, current.name, current.webContentLink);
    const uniqueKey = keys[0] || JSON.stringify(current);
    if (seen.has(uniqueKey)) return;
    seen.add(uniqueKey);
    rows.push(current);
  }

  if (Array.isArray(store.__items)) {
    for (const item of store.__items) addRow(item && item.json);
  }

  for (const item of getCompose1ItemsFallback()) {
    addRow(item && item.json);
  }

  return rows;
}
`;

  let patched = code;
  if (patched.includes(oldPrepareHelper)) {
    patched = replaceOnce(patched, oldPrepareHelper, newPrepareHelper, 'Attach helper replacement');
  } else {
    assert(patched.includes('function getCompose1Rows()'), 'Attach helper replacement missing and unified helper not found');
  }

  const tailPattern = /const frameStore = getExecutionFrameStoreForWrite\(\);[\s\S]*return output;\s*$/;
  const newTail = String.raw`const frameStore = getExecutionFrameStoreForWrite();
const mainStore = getExecutionMainStore();
const compose1Rows = getCompose1Rows();

function buildCompose1OrderMap(rows) {
  const orderMap = new Map();
  for (const [index, row] of rows.entries()) {
    for (const key of cacheKeys(row.groupKey, row.id, row.name, row.webContentLink)) {
      if (!orderMap.has(key)) orderMap.set(key, index);
    }
  }
  return orderMap;
}

function signalCountFromUpload(upload) {
  let total = 0;
  if (upload.candidate && typeof upload.candidate === "object") total += 1;
  if (Array.isArray(upload.frameCandidates)) total += upload.frameCandidates.length;
  if (Array.isArray(upload.technicalFrameCandidates)) total += upload.technicalFrameCandidates.length;
  if (upload.bestFrame && Array.isArray(upload.bestFrame.candidates)) total += upload.bestFrame.candidates.length;
  if (!total) {
    const sourceName = sourceNameForUpload(upload, upload.secure_url || upload.url);
    if (/(?:^|[_-])cand[_-]?\d{1,3}(?:\.|$)/i.test(fileNameOnly(sourceName) || sourceName)) total = 1;
  }
  return total;
}

function buildFrameSignalCounts(items) {
  const counts = new Map();
  for (const item of items) {
    const upload = asObj(item && item.json);
    const count = signalCountFromUpload(upload);
    if (!count) continue;
    const sourceName = sourceNameForUpload(upload, upload.secure_url || upload.url);
    const groupKey = str(upload.groupKey || deriveGroupKey(sourceName), "");
    if (!groupKey) continue;
    counts.set(groupKey, Number(counts.get(groupKey) || 0) + count);
  }
  return counts;
}

function stableInputSort(items) {
  return [...items].sort((left, right) => {
    const a = asObj(left && left.json);
    const b = asObj(right && right.json);
    const aSource = sourceNameForUpload(a, a.secure_url || a.url);
    const bSource = sourceNameForUpload(b, b.secure_url || b.url);
    const aGroup = str(a.groupKey || deriveGroupKey(aSource), "");
    const bGroup = str(b.groupKey || deriveGroupKey(bSource), "");
    const aRole = isFrameCandidateUpload(a) ? "0" : "1";
    const bRole = isFrameCandidateUpload(b) ? "0" : "1";
    const aRank = String(deriveRankFromName(aSource, 0)).padStart(4, "0");
    const bRank = String(deriveRankFromName(bSource, 0)).padStart(4, "0");
    const aKey = [aGroup, aRole, aRank, fileNameOnly(aSource), str(a.public_id || a.id || "", ""), ensureHttps(a.secure_url || a.url || "")].join("|");
    const bKey = [bGroup, bRole, bRank, fileNameOnly(bSource), str(b.public_id || b.id || "", ""), ensureHttps(b.secure_url || b.url || "")].join("|");
    return aKey.localeCompare(bKey);
  });
}

function resolveCompose1Order(orderMap, compose1Context, upload, finalUrl, name, groupKey) {
  for (const key of cacheKeys(
    compose1Context.groupKey || groupKey,
    compose1Context.id,
    compose1Context.name,
    compose1Context.webContentLink,
    name,
    upload.id,
    upload.mediaId,
    upload.public_id,
    finalUrl
  )) {
    if (orderMap.has(key)) return orderMap.get(key);
  }
  return Number.MAX_SAFE_INTEGER;
}

const compose1Order = buildCompose1OrderMap(compose1Rows);
const inputItems = stableInputSort($input.all());
const frameSignalCounts = buildFrameSignalCounts(inputItems);

for (const [index, item] of inputItems.entries()) {
  const upload = asObj(item && item.json);
  if (isFrameCandidateUpload(upload)) {
    cacheFrameContext(upload, index, frameStore, upload);
  }
}

const mainRecords = [];

for (const [index, item] of inputItems.entries()) {
  const upload = asObj(item && item.json);
  if (isFrameCandidateUpload(upload)) continue;

  const finalUrl = ensureHttps(upload.secure_url || upload.url || upload.finalUrl || "");
  const name = deriveName(upload, finalUrl);
  const groupKey = str(upload.groupKey || deriveGroupKey(name || upload.public_id || finalUrl), "");
  const mimeType = str(upload.mimeType || upload.mediaMimeType || mimeFromUpload(upload, ""), "");
  const mediaType = mediaTypeFromMime(mimeType);
  const frameContext = findFrameContext(groupKey, name, upload);
  const compose1Context = findCompose1Context({ groupKey, name, upload, finalUrl });
  const frameCandidates = Array.isArray(frameContext.frameCandidates) ? frameContext.frameCandidates : [];
  const technicalFrameCandidates = Array.isArray(frameContext.technicalFrameCandidates) ? frameContext.technicalFrameCandidates : frameCandidates;
  const bestFrame = asObj(frameContext.bestFrame);
  const warnings = [
    ...(Array.isArray(upload.warnings) ? upload.warnings : []),
    ...(Array.isArray(upload.mainMediaUploadWarnings) ? upload.mainMediaUploadWarnings : []),
  ].filter(Boolean);

  if (!upload.id && !upload.mediaId && !compose1Context.id) warnings.push("main_media_drive_context_not_available_after_upload");
  if (!upload.instagram && !compose1Context.instagram) warnings.push("publish_context_rehydrated_from_compose1_missing_instagram");
  if (!upload.facebook && !compose1Context.facebook) warnings.push("publish_context_rehydrated_from_compose1_missing_facebook");
  if (!upload.threads && !compose1Context.threads) warnings.push("publish_context_rehydrated_from_compose1_missing_threads");

  if (mediaType === "VIDEO" && Number(frameSignalCounts.get(groupKey) || 0) > 0 && !technicalFrameCandidates.length) {
    throw new Error(
      "Attach Uploaded Main Media Metadata: frame analysis detected for video but no public frame candidate survived upload (groupKey=" +
      str(groupKey, "n/a") +
      ", mediaName=" +
      str(name || upload.name || compose1Context.name, "n/a") +
      ")"
    );
  }

  if (!technicalFrameCandidates.length && mediaType === "VIDEO") {
    warnings.push("frame_context_not_available_after_upload");
  }

  const outputJson = {
    ...compose1Context,
    ...upload,
    id: str(compose1Context.id || upload.id || upload.mediaId || "", ""),
    name: name || str(compose1Context.name || "", ""),
    mimeType: mimeType || str(compose1Context.mimeType || "", ""),
    groupKey: groupKey || str(compose1Context.groupKey || "", ""),
    groupOrder: upload.groupOrder ?? compose1Context.groupOrder,
    publishTime: str(upload.publishTime || compose1Context.publishTime || "", ""),
    uploadRole: "main_media",
    finalUrl,
    secure_url: finalUrl || upload.secure_url,
    url: finalUrl || upload.url,
    resource_type: str(upload.resource_type || (mediaType === "VIDEO" ? "video" : "image"), ""),
    format: str(upload.format || extFromName(name || finalUrl), ""),
    media_type: upload.media_type || compose1Context.media_type || mediaType,
    media_type_1st_requisition: upload.media_type_1st_requisition || compose1Context.media_type_1st_requisition || mediaType,
    media_type_2nd_requisition: upload.media_type_2nd_requisition || compose1Context.media_type_2nd_requisition || mediaType,
    media_type_instagram: upload.media_type_instagram || compose1Context.media_type_instagram || (mediaType === "VIDEO" ? "REELS" : ""),
    facebook: upload.facebook || compose1Context.facebook,
    instagram: upload.instagram || compose1Context.instagram,
    threads: upload.threads || compose1Context.threads,
    mainMedia: {
      secure_url: finalUrl || upload.secure_url || "",
      url: finalUrl || upload.url || "",
      resource_type: str(upload.resource_type || (mediaType === "VIDEO" ? "video" : "image"), ""),
      format: str(upload.format || extFromName(name || finalUrl), ""),
      public_id: str(upload.public_id || "", ""),
    },
    bestFrame,
    frameCandidates,
    technicalFrameCandidates,
    frameCandidateCount: technicalFrameCandidates.length || frameCandidates.length,
    warnings,
  };

  if (mainStore) {
    mainStore.__items ||= [];
    mainStore.__items.push({ json: outputJson });
    for (const key of cacheKeys(groupKey, name, upload.public_id, finalUrl, outputJson.id)) {
      mainStore[key] = outputJson;
    }
  }

  mainRecords.push({
    orderIndex: resolveCompose1Order(compose1Order, compose1Context, upload, finalUrl, name, groupKey),
    groupOrder: Number(outputJson.groupOrder ?? 0),
    groupKey: outputJson.groupKey || "",
    name: outputJson.name || "",
    finalUrl,
    item: {
      json: outputJson,
      binary: item.binary,
    },
  });
}

mainRecords.sort((left, right) => {
  if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
  if (left.groupOrder !== right.groupOrder) return left.groupOrder - right.groupOrder;
  const leftKey = [left.groupKey, left.name, left.finalUrl].join("|");
  const rightKey = [right.groupKey, right.name, right.finalUrl].join("|");
  return leftKey.localeCompare(rightKey);
});

return mainRecords.map((record) => record.item);
`;

  if (!tailPattern.test(patched)) {
    assert(patched.includes('return mainRecords.map((record) => record.item);'), 'Attach tail anchor not found');
    return patched;
  }
  patched = patched.replace(tailPattern, newTail);
  return patched;
}

function patchCompose2Code(code) {
  let patched = code;
  const oldComment = '// - Frames técnicos chegam separadamente de Attach Uploaded Frame Metadata.';
  const newComment = '// - Frames técnicos já chegam agregados no mesmo item combinado de Attach Uploaded Main Media Metadata.';
  if (patched.includes(oldComment)) {
    patched = replaceOnce(
      patched,
      oldComment,
      newComment,
      'Compose (2) comment',
    );
  }

  const directSelectorBlock = `  if (name === "Attach Uploaded Frame Metadata") {
    return items.filter((item) => isAggregate2Item((item && item.json) || {}));
  }

`;
  if (patched.includes(directSelectorBlock)) {
    patched = replaceOnce(patched, directSelectorBlock, '', 'Compose (2) stale direct selector');
  }

  const staleStaticStoreBlock = `  if (name === "Attach Uploaded Frame Metadata") {
    return staticStoreItems(getExecutionStaticStore("__liviaFrameUploads"));
  }

`;
  if (patched.includes(staleStaticStoreBlock)) {
    patched = replaceOnce(patched, staleStaticStoreBlock, '', 'Compose (2) stale static frame store selector');
  }

  const mainBlock = `const uploadedMainMediaItems = safeNodeItems("Attach Uploaded Main Media Metadata");
let c2Items = uploadedMainMediaItems.length
  ? uploadedMainMediaItems
  : selectDirectNodeItems("Attach Uploaded Main Media Metadata", directInputItems);

const uploadedFrameItems = safeNodeItems("Attach Uploaded Frame Metadata");
const technicalFrameCandidates = flattenFrameCandidateItems(uploadedFrameItems);
const parsedFrameCandidateCount =
  technicalFrameCandidates.length ||
  countParsedFrameCandidates(safeNodeItems("Parse Frame Analysis JSON"));

const mainUploadItems = c2Items;
const uploadItems = mainUploadItems;
`;

  const newMainBlock = `const uploadedMainMediaItems = safeNodeItems("Attach Uploaded Main Media Metadata");
let c2Items = uploadedMainMediaItems.length
  ? uploadedMainMediaItems
  : selectDirectNodeItems("Attach Uploaded Main Media Metadata", directInputItems);

const technicalFrameCandidates = flattenFrameCandidateItems(c2Items);
const parsedFrameCandidateCount =
  technicalFrameCandidates.length ||
  countParsedFrameCandidates(c2Items) ||
  countParsedFrameCandidates(safeNodeItems("Parse Frame Analysis JSON"));

const mainUploadItems = c2Items;
const uploadItems = mainUploadItems;
`;
  if (patched.includes(mainBlock)) {
    patched = replaceOnce(patched, mainBlock, newMainBlock, 'Compose (2) unified input block');
  } else {
    assert(patched.includes('const technicalFrameCandidates = flattenFrameCandidateItems(c2Items);'), 'Compose (2) unified input block missing and unified version not found');
  }

  const oldError = 'throw new Error("Compose (2): sem mídia principal combinada em Attach Uploaded Main Media Metadata.");';
  const newError = 'throw new Error("Compose (2): sem mídia principal combinada no estágio unificado Attach Uploaded Main Media Metadata.");';
  if (patched.includes(oldError)) {
    patched = replaceOnce(
      patched,
      oldError,
      newError,
      'Compose (2) unified error message',
    );
  }

  return patched;
}

function patchWorkflow(workflow) {
  const attachMain = getNode(workflow, 'Attach Uploaded Main Media Metadata');
  const compose2 = getNode(workflow, 'Compose (2)');
  getNode(workflow, 'Upload Main Media');
  getNode(workflow, 'Read File');
  getNode(workflow, 'Read Thumb');
  getNode(workflow, 'Livia');

  attachMain.parameters.jsCode = patchAttachMainCode(attachMain.parameters.jsCode);
  compose2.parameters.jsCode = patchCompose2Code(compose2.parameters.jsCode);

  removeNode(workflow, 'Sort');
  removeNode(workflow, 'Prepare Main Media Upload');
  removeConnectionsForNode(workflow.connections, 'Sort');
  removeConnectionsForNode(workflow.connections, 'Prepare Main Media Upload');

  setSingleMainConnection(workflow.connections, 'Upload Main Media', 'Attach Uploaded Main Media Metadata', 0);
  addMainConnection(workflow.connections, 'Attach Uploaded Main Media Metadata', 'Livia', 0);

  assert(!workflow.nodes.some((node) => node.name === 'Sort'), 'Sort node still present after patch');
  assert(!workflow.nodes.some((node) => node.name === 'Prepare Main Media Upload'), 'Prepare Main Media Upload node still present after patch');
  return workflow;
}

function writeExport(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

const db = new Database(DB_PATH);
const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
if (!row) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

const before = workflowFromRow(row, true);
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const checkpointPath = path.join(__dirname, '..', 'workflows', `livia.before-unify-post-cloudinary-stage.${timestamp}.json`);
writeExport(before, checkpointPath);

const workflow = patchWorkflow(workflowFromRow(row, true));
const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-unify-post-cloudinary-stage',
    appliedAt: new Date().toISOString(),
    previousVersionId: row.versionId,
    removedNodes: ['Sort', 'Prepare Main Media Upload'],
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

const insertHistory = db.prepare(`
  insert into workflow_history
    (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
  values
    (@versionId, @workflowId, @authors, @createdAt, @updatedAt, @nodes, @connections, @name, 0, @description)
`);

const updateWorkflow = db.prepare(`
  update workflow_entity
  set nodes = @nodes,
      connections = @connections,
      meta = @meta,
      versionId = @versionId,
      activeVersionId = @versionId,
      updatedAt = @updatedAt,
      versionCounter = versionCounter + 1
  where id = @workflowId
`);

db.transaction(() => {
  insertHistory.run({
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
  updateWorkflow.run({
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
  versionId,
  checkpointPath,
  exports: EXPORT_PATHS,
  nodes: workflow.nodes.length,
}, null, 2));
