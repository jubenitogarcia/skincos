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

function getCodeNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`${name} node not found`);
  node.parameters ||= {};
  if (typeof node.parameters.jsCode !== 'string') throw new Error(`${name} has no jsCode`);
  return node;
}

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not find ${label}`);
  return source.replace(from, to);
}

function patchAttachFrame(code) {
  return replaceOnce(
    code,
    `  if (frameStore) {
    for (const key of cacheKeys(groupKey, sourceName, upload.public_id, url)) {
      frameStore[key] = frameContext;
    }
  }

  return {
    json: {
      ...upload,
      ...frameContext,
    },
    binary: item.binary,
  };`,
    `  const outputJson = {
    ...upload,
    ...frameContext,
  };

  if (frameStore) {
    frameStore.__items ||= [];
    frameStore.__items.push({ json: outputJson });

    for (const key of cacheKeys(groupKey, sourceName, upload.public_id, url)) {
      frameStore[key] = frameContext;
    }
  }

  return {
    json: outputJson,
    binary: item.binary,
  };`,
    'Attach Uploaded Frame Metadata return block',
  );
}

function patchAttachMain(code) {
  let patched = replaceOnce(
    code,
    `function getExecutionFrameStore() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd.__liviaFrameUploads)[execId]);
  } catch {
    return {};
  }
}
`,
    `function getExecutionFrameStore() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd.__liviaFrameUploads)[execId]);
  } catch {
    return {};
  }
}

function getExecutionMainStore() {
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
    'Attach Uploaded Main Media Metadata static main store helper',
  );

  patched = replaceOnce(
    patched,
    `return $input.all().map((item) => {
  const upload = asObj(item && item.json);`,
    `const mainStore = getExecutionMainStore();

return $input.all().map((item) => {
  const upload = asObj(item && item.json);`,
    'Attach Uploaded Main Media Metadata mainStore init',
  );

  patched = replaceOnce(
    patched,
    `  return {
    json: {
      ...upload,
      id: str(upload.id || upload.mediaId || "", ""),
      name,
      mimeType,
      groupKey,
      groupOrder: upload.groupOrder,
      publishTime: str(upload.publishTime || "", ""),
      uploadRole: "main_media",
      finalUrl,
      secure_url: finalUrl || upload.secure_url,
      url: finalUrl || upload.url,
      resource_type: str(upload.resource_type || (mediaType === "VIDEO" ? "video" : "image"), ""),
      format: str(upload.format || extFromName(name || finalUrl), ""),
      media_type: upload.media_type || mediaType,
      media_type_1st_requisition: upload.media_type_1st_requisition || mediaType,
      media_type_2nd_requisition: upload.media_type_2nd_requisition || mediaType,
      media_type_instagram: upload.media_type_instagram || (mediaType === "VIDEO" ? "REELS" : ""),
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
      frameCandidateCount: technicalFrameCandidates.length,
      warnings,
    },
    binary: item.binary,
  };`,
    `  const outputJson = {
    ...upload,
    id: str(upload.id || upload.mediaId || "", ""),
    name,
    mimeType,
    groupKey,
    groupOrder: upload.groupOrder,
    publishTime: str(upload.publishTime || "", ""),
    uploadRole: "main_media",
    finalUrl,
    secure_url: finalUrl || upload.secure_url,
    url: finalUrl || upload.url,
    resource_type: str(upload.resource_type || (mediaType === "VIDEO" ? "video" : "image"), ""),
    format: str(upload.format || extFromName(name || finalUrl), ""),
    media_type: upload.media_type || mediaType,
    media_type_1st_requisition: upload.media_type_1st_requisition || mediaType,
    media_type_2nd_requisition: upload.media_type_2nd_requisition || mediaType,
    media_type_instagram: upload.media_type_instagram || (mediaType === "VIDEO" ? "REELS" : ""),
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
    frameCandidateCount: technicalFrameCandidates.length,
    warnings,
  };

  if (mainStore) {
    mainStore.__items ||= [];
    mainStore.__items.push({ json: outputJson });

    for (const key of cacheKeys(groupKey, name, upload.public_id, finalUrl, outputJson.id)) {
      mainStore[key] = outputJson;
    }
  }

  return {
    json: outputJson,
    binary: item.binary,
  };`,
    'Attach Uploaded Main Media Metadata return block',
  );

  return patched;
}

function patchCompose2(code) {
  let patched = replaceOnce(
    code,
    `function safeNodeItems(name) {
  try {
    return $items(name) || [];
  } catch {
    return [];
  }
}
`,
    `function getExecutionStaticStore(storeName) {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd[storeName])[execId]);
  } catch {
    return {};
  }
}

function staticStoreItems(store) {
  const direct = Array.isArray(store.__items) ? store.__items : [];
  if (direct.length) {
    return direct
      .map((item) => ({ json: asObj((item && item.json) || item) }))
      .filter((item) => Object.keys(item.json).length);
  }

  const out = [];
  const seen = new Set();
  for (const [key, value] of Object.entries(store || {})) {
    if (key === "__items") continue;
    const json = asObj(value);
    if (!Object.keys(json).length) continue;
    const dedupeKey = [
      str(json.id || json.mediaId || json.public_id || ""),
      str(json.name || json.mediaName || json.fileName || json.thumbPath || ""),
      str(json.secure_url || json.url || json.finalUrl || ""),
      key,
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ json });
  }
  return out;
}

function safeNodeItems(name) {
  if (name === "Attach Uploaded Main Media Metadata") {
    return staticStoreItems(getExecutionStaticStore("__liviaMainUploads"));
  }

  if (name === "Attach Uploaded Frame Metadata") {
    return staticStoreItems(getExecutionStaticStore("__liviaFrameUploads"));
  }

  return [];
}

function cleanupExecutionStaticStores() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    if (sd.__liviaMainUploads) delete sd.__liviaMainUploads[execId];
    if (sd.__liviaFrameUploads) delete sd.__liviaFrameUploads[execId];
  } catch {}
}
`,
    'Compose (2) safeNodeItems block',
  );

  patched = replaceOnce(
    patched,
    `assertEveryCheckStatusHasPublish(results);
assertPlatformPhaseIntegrity(results);

return results;`,
    `assertEveryCheckStatusHasPublish(results);
assertPlatformPhaseIntegrity(results);
cleanupExecutionStaticStores();

return results;`,
    'Compose (2) final return block',
  );

  if (/\$items\s*\(/.test(patched)) throw new Error('Compose (2) still calls $items()');
  return patched;
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = workflowFromRow(row);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-compose2-static-context.${timestamp}.json`);
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
        name: 'livia-compose2-static-context',
        appliedAt: new Date().toISOString(),
      },
    },
  };

  getCodeNode(patched, 'Attach Uploaded Frame Metadata').parameters.jsCode =
    patchAttachFrame(getCodeNode(patched, 'Attach Uploaded Frame Metadata').parameters.jsCode);
  getCodeNode(patched, 'Attach Uploaded Main Media Metadata').parameters.jsCode =
    patchAttachMain(getCodeNode(patched, 'Attach Uploaded Main Media Metadata').parameters.jsCode);
  getCodeNode(patched, 'Compose (2)').parameters.jsCode =
    patchCompose2(getCodeNode(patched, 'Compose (2)').parameters.jsCode);

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
    versionId,
    backupPath,
    exports: EXPORT_PATHS,
    nodes: exported.nodes.length,
    connectionSources: Object.keys(exported.connections || {}).length,
    preservedDatabasePinDataKeys: pinKeys.length,
  }, null, 2));
}

main();
