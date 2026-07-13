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

const ATTACH_UPLOADED_MAIN_CODE = String.raw`// Reattach media context after Cloudinary upload using Code node references.
function str(v, fb = "") {
  return (v === undefined || v === null) ? fb : String(v);
}

function asObj(v) {
  return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
}

function ensureHttps(url) {
  const s = str(url, "").trim();
  if (!s) return "";
  return s.replace(/^http:\/\//i, "https://");
}

function safeItems(name) {
  try {
    const items = $items(name);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function fileNameOnly(value) {
  return str(value, "").split("/").filter(Boolean).pop() || "";
}

function fileBaseName(value) {
  return fileNameOnly(value).replace(/\.[^.]+$/, "");
}

function normalizeBase(value) {
  return fileBaseName(value)
    .replace(/_temp$/i, "")
    .replace(/_cand_\d+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function derivePrefix(value) {
  const name = fileNameOnly(value);
  const match = name.match(/^(\d{10})(?:[_\-. ]|$)/);
  return match ? match[1] : "";
}

function deriveGroupKey(value) {
  const prefix = derivePrefix(value);
  return prefix ? "dt:" + prefix : "";
}

function mimeFromUpload(upload, fallback = "") {
  const resourceType = str(upload.resource_type || "", "").toLowerCase();
  const format = str(upload.format || "", "").toLowerCase();
  if (resourceType === "video" || ["mp4", "mov", "m4v", "webm", "mkv"].includes(format)) return "video/mp4";
  if (resourceType === "image" || ["jpg", "jpeg", "png", "webp", "gif"].includes(format)) {
    if (format === "png") return "image/png";
    if (format === "webp") return "image/webp";
    return "image/jpeg";
  }
  return fallback;
}

function firstJson(items, index) {
  return asObj(items[index] && items[index].json);
}

function findPrepared(upload, index, preparedItems) {
  const byIndex = firstJson(preparedItems, index);
  if (byIndex.id || byIndex.name || byIndex.groupKey || byIndex.mainMediaFileName) return byIndex;

  const uploadBase = normalizeBase(upload.original_filename || upload.display_name || upload.public_id || upload.secure_url || upload.url || upload.name);
  if (!uploadBase) return {};

  for (const item of preparedItems) {
    const json = asObj(item && item.json);
    const preparedBase = normalizeBase(json.mainMediaFileName || json.name || json.fileName || json.filePath || json.path);
    if (preparedBase && (preparedBase.includes(uploadBase) || uploadBase.includes(preparedBase))) return json;
  }

  return {};
}

function findComposeMedia(source, upload, index, composeItems) {
  const candidates = composeItems.map((item) => asObj(item && item.json)).filter((json) => Object.keys(json).length);
  const wantedGroup =
    source.groupKey ||
    upload.groupKey ||
    deriveGroupKey(source.mainMediaFileName || source.name || upload.original_filename || upload.display_name || upload.public_id);
  const wantedId = source.id || source.mediaId || "";
  const wantedBase = normalizeBase(source.name || source.mainMediaFileName || upload.original_filename || upload.display_name || upload.public_id);

  if (wantedId) {
    const byId = candidates.find((json) => str(json.id, "") === str(wantedId, ""));
    if (byId) return byId;
  }

  if (wantedGroup) {
    const groupMatches = candidates.filter((json) => str(json.groupKey, "") === wantedGroup);
    if (groupMatches.length === 1) return groupMatches[0];
    if (groupMatches.length > 1 && wantedBase) {
      const byName = groupMatches.find((json) => {
        const base = normalizeBase(json.name || json.fileName || "");
        return base && (base.includes(wantedBase) || wantedBase.includes(base));
      });
      if (byName) return byName;
    }
  }

  if (wantedBase) {
    const byName = candidates.find((json) => {
      const base = normalizeBase(json.name || json.fileName || "");
      return base && (base.includes(wantedBase) || wantedBase.includes(base));
    });
    if (byName) return byName;
  }

  return candidates[index] || (candidates.length === 1 ? candidates[0] : {});
}

function sameMedia(media, frame) {
  if (!media || !frame) return false;
  if (media.id && frame.mediaId && str(media.id, "") === str(frame.mediaId, "")) return true;
  if (media.groupKey && frame.groupKey && str(media.groupKey, "") === str(frame.groupKey, "")) return true;
  const mediaBase = normalizeBase(media.name || media.mainMediaFileName || "");
  const frameBase = normalizeBase(frame.mediaName || frame.name || frame.mainMediaFileName || "");
  return !!(mediaBase && frameBase && (mediaBase.includes(frameBase) || frameBase.includes(mediaBase)));
}

function collectFrameContext(media, frameItems) {
  const frames = frameItems.map((item) => asObj(item && item.json)).filter((frame) => sameMedia(media, frame));
  const candidates = [];
  let bestFrame = {};

  for (const frame of frames) {
    if (frame.bestFrame && typeof frame.bestFrame === "object") bestFrame = frame.bestFrame;
    if (Array.isArray(frame.technicalFrameCandidates)) candidates.push(...frame.technicalFrameCandidates);
    else if (Array.isArray(frame.frameCandidates)) candidates.push(...frame.frameCandidates);
    else if (frame.candidate && typeof frame.candidate === "object") candidates.push(frame.candidate);
  }

  return {
    bestFrame,
    frameCandidates: candidates,
    technicalFrameCandidates: candidates,
    frameCandidateCount: candidates.length,
  };
}

const preparedItems = safeItems("Prepare Main Media Upload");
const composeItems = safeItems("Compose (1)");
const frameItems = safeItems("Attach Uploaded Frame Metadata");

return $input.all().map((item, index) => {
  const upload = asObj(item && item.json);
  const source = findPrepared(upload, index, preparedItems);
  const media = findComposeMedia(source, upload, index, composeItems);
  const finalUrl = ensureHttps(upload.secure_url || upload.url || upload.finalUrl || "");
  const frameContext = collectFrameContext({ ...media, ...source }, frameItems);
  const warnings = [
    ...(Array.isArray(media.warnings) ? media.warnings : []),
    ...(Array.isArray(source.mainMediaUploadWarnings) ? source.mainMediaUploadWarnings : []),
    ...(Array.isArray(source.warnings) ? source.warnings : []),
    ...(Array.isArray(upload.warnings) ? upload.warnings : []),
  ].filter(Boolean);

  return {
    json: {
      ...media,
      ...source,
      ...upload,
      id: media.id || source.id || upload.id || "",
      name: media.name || source.name || upload.original_filename || upload.display_name || upload.public_id || fileBaseName(finalUrl),
      mimeType: media.mimeType || source.mimeType || mimeFromUpload(upload, ""),
      groupKey: media.groupKey || source.groupKey || deriveGroupKey(source.mainMediaFileName || source.name || upload.original_filename || upload.display_name || upload.public_id),
      groupOrder: media.groupOrder ?? source.groupOrder,
      publishTime: media.publishTime || source.publishTime || "",
      uploadRole: "main_media",
      finalUrl,
      secure_url: finalUrl || upload.secure_url,
      url: finalUrl || upload.url,
      mainMedia: {
        secure_url: finalUrl || upload.secure_url || "",
        url: finalUrl || upload.url || "",
        resource_type: str(upload.resource_type || "", ""),
        format: str(upload.format || "", ""),
        public_id: str(upload.public_id || "", ""),
      },
      ...frameContext,
      warnings,
    },
    binary: item.binary,
  };
});`;

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function exportWorkflow(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function getWorkflowFromRow(row) {
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

function removeNodeByName(workflow, name) {
  workflow.nodes = workflow.nodes.filter((node) => node.name !== name);
  delete workflow.connections[name];
  for (const outputs of Object.values(workflow.connections || {})) {
    for (const groups of Object.values(outputs || {})) {
      for (const group of groups || []) {
        if (!Array.isArray(group)) continue;
        for (let i = group.length - 1; i >= 0; i--) {
          if (group[i]?.node === name) group.splice(i, 1);
        }
      }
    }
  }
}

function removeConnection(connections, source, target) {
  const groups = connections[source]?.main || [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (let i = group.length - 1; i >= 0; i--) {
      if (group[i]?.node === target) group.splice(i, 1);
    }
  }
}

function addConnection(connections, source, target, outputIndex = 0, inputIndex = 0) {
  connections[source] ||= {};
  connections[source].main ||= [];
  while (connections[source].main.length <= outputIndex) connections[source].main.push([]);
  const group = connections[source].main[outputIndex];
  const exists = group.some((conn) => conn.node === target && conn.type === 'main' && conn.index === inputIndex);
  if (!exists) group.push({ node: target, type: 'main', index: inputIndex });
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = getWorkflowFromRow(row);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-code-context-no-merge.${timestamp}.json`);
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
        name: 'livia-code-context-no-merge',
        appliedAt: new Date().toISOString(),
      },
    },
  };

  removeNodeByName(patched, 'Merge Main Upload Context');
  removeNodeByName(patched, 'Merge Uploaded Main Media Context');

  const attachMainNode = patched.nodes.find((node) => node.name === 'Attach Uploaded Main Media Metadata');
  if (!attachMainNode) throw new Error('Attach Uploaded Main Media Metadata node not found');
  attachMainNode.parameters = {
    ...(attachMainNode.parameters || {}),
    jsCode: ATTACH_UPLOADED_MAIN_CODE,
  };

  removeConnection(patched.connections, 'Prepare Main Media Upload', 'Merge Main Upload Context');
  removeConnection(patched.connections, 'Upload Main Media', 'Merge Uploaded Main Media Context');
  removeConnection(patched.connections, 'Merge Uploaded Main Media Context', 'Attach Uploaded Main Media Metadata');
  addConnection(patched.connections, 'Prepare Main Media Upload', 'Upload Main Media', 0, 0);
  addConnection(patched.connections, 'Upload Main Media', 'Attach Uploaded Main Media Metadata', 0, 0);

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
