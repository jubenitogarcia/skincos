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

const ATTACH_UPLOADED_FRAME_CODE = String.raw`// Reattach frame candidate metadata to Cloudinary thumbnail uploads without external item lookups.
function str(v, fb = "") {
  return (v === undefined || v === null) ? fb : String(v);
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function asObj(v) {
  return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
}

function ensureHttps(url) {
  const s = str(url, "").trim();
  if (!s) return "";
  return s.replace(/^http:\/\//i, "https://");
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
    .replace(/_thumb$/i, "")
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

function deriveRankFromName(value, fallback) {
  const name = fileNameOnly(value);
  const match = name.match(/(?:^|[_-])cand[_-]?(\d{1,3})(?:\.|$)/i);
  return match ? num(match[1], fallback) : fallback;
}

function cacheKeys(...values) {
  const keys = [];
  for (const value of values) {
    const raw = str(value, "").trim();
    const groupKey = raw.startsWith("dt:") ? raw : deriveGroupKey(raw);
    const prefix = derivePrefix(raw);
    const base = normalizeBase(raw);
    for (const key of [raw, groupKey, prefix, base]) {
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function getExecutionFrameStore() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    sd.__liviaFrameUploads ||= {};

    for (const key of Object.keys(sd.__liviaFrameUploads)) {
      if (key !== execId) delete sd.__liviaFrameUploads[key];
    }

    sd.__liviaFrameUploads[execId] ||= {};
    return sd.__liviaFrameUploads[execId];
  } catch {
    return null;
  }
}

const frameStore = getExecutionFrameStore();

return $input.all().map((item, index) => {
  const upload = asObj(item && item.json);
  const url = ensureHttps(upload.secure_url || upload.url || "");
  const sourceName = str(
    upload.fileName ||
    upload.thumbPath ||
    upload.original_filename ||
    upload.display_name ||
    upload.public_id ||
    url,
    ""
  );
  const groupKey = str(upload.groupKey || deriveGroupKey(sourceName), "");
  const candidate = {
    rank: deriveRankFromName(sourceName, index + 1),
    timestamp: str(upload.timestamp || upload.bestTimestamp, ""),
    timestampSeconds: num(upload.timestampSeconds ?? upload.bestTimestampSeconds, 0),
    confidence: num(upload.confidence ?? upload.score, 0),
    reason: str(upload.reason || upload.why || upload.notes, ""),
    thumbPath: sourceName,
    fileName: fileNameOnly(sourceName) || fileNameOnly(url),
    fileBase: fileBaseName(sourceName) || fileBaseName(url),
    url,
    secure_url: url,
    resource_type: str(upload.resource_type || "image", "image"),
    public_id: str(upload.public_id || upload.id || ""),
    source: "cloudinary-frame-upload-derived",
  };
  const bestFrame = {
    applicable: true,
    selectedFrameUrl: candidate.url,
    selectedFrameRank: candidate.rank,
    selectedFrameSource: "technical_frame_upload",
    bestTimestamp: candidate.timestamp,
    bestTimestampSeconds: candidate.timestampSeconds,
    confidence: candidate.confidence,
  };
  const frameContext = {
    mediaId: str(upload.mediaId || upload.id || "", ""),
    mediaName: str(upload.mediaName || "", ""),
    mediaMimeType: str(upload.mediaMimeType || "", ""),
    groupKey,
    groupOrder: upload.groupOrder,
    publishTime: str(upload.publishTime || "", ""),
    uploadRole: "frame_candidate",
    thumbPath: candidate.thumbPath,
    candidate,
    frameCandidates: [candidate],
    technicalFrameCandidates: [candidate],
    bestFrame,
    frameCandidateCount: 1,
  };

  if (frameStore) {
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
  };
});`;

const ATTACH_UPLOADED_MAIN_CODE = String.raw`// Reattach main media upload metadata without external item lookups.
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

function fileNameOnly(value) {
  return str(value, "").split("/").filter(Boolean).pop() || "";
}

function fileBaseName(value) {
  return fileNameOnly(value).replace(/\.[^.]+$/, "");
}

function extFromName(value) {
  const name = fileNameOnly(value);
  const match = name.match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function normalizeBase(value) {
  return fileBaseName(value)
    .replace(/_temp$/i, "")
    .replace(/_thumb$/i, "")
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
  const format = str(upload.format || extFromName(upload.secure_url || upload.url || upload.original_filename || upload.display_name || upload.public_id), "").toLowerCase();
  if (resourceType === "video" || ["mp4", "mov", "m4v", "webm", "mkv"].includes(format)) return "video/mp4";
  if (resourceType === "image" || ["jpg", "jpeg", "png", "webp", "gif"].includes(format)) {
    if (format === "png") return "image/png";
    if (format === "webp") return "image/webp";
    return "image/jpeg";
  }
  return fallback;
}

function mediaTypeFromMime(mimeType) {
  return str(mimeType, "").toLowerCase().startsWith("video/") ? "VIDEO" : "IMAGE";
}

function cacheKeys(...values) {
  const keys = [];
  for (const value of values) {
    const raw = str(value, "").trim();
    const groupKey = raw.startsWith("dt:") ? raw : deriveGroupKey(raw);
    const prefix = derivePrefix(raw);
    const base = normalizeBase(raw);
    for (const key of [raw, groupKey, prefix, base]) {
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function getExecutionFrameStore() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd.__liviaFrameUploads)[execId]);
  } catch {
    return {};
  }
}

function findFrameContext(groupKey, sourceName, upload) {
  const store = getExecutionFrameStore();
  for (const key of cacheKeys(groupKey, sourceName, upload.public_id, upload.secure_url, upload.url)) {
    if (store[key]) return asObj(store[key]);
  }
  return {};
}

function deriveName(upload, finalUrl) {
  const raw = str(
    upload.name ||
    upload.mediaName ||
    upload.mainMediaFileName ||
    upload.fileName ||
    upload.original_filename ||
    upload.display_name ||
    upload.public_id ||
    finalUrl,
    ""
  );
  const fileName = fileNameOnly(raw);
  if (fileName) return fileName;
  const base = fileBaseName(finalUrl);
  const format = str(upload.format || extFromName(finalUrl), "");
  return base && format ? base + "." + format : base;
}

return $input.all().map((item) => {
  const upload = asObj(item && item.json);
  const finalUrl = ensureHttps(upload.secure_url || upload.url || upload.finalUrl || "");
  const name = deriveName(upload, finalUrl);
  const groupKey = str(upload.groupKey || deriveGroupKey(name || upload.public_id || finalUrl), "");
  const mimeType = str(upload.mimeType || upload.mediaMimeType || mimeFromUpload(upload, ""), "");
  const mediaType = mediaTypeFromMime(mimeType);
  const frameContext = findFrameContext(groupKey, name, upload);
  const frameCandidates = Array.isArray(frameContext.frameCandidates) ? frameContext.frameCandidates : [];
  const technicalFrameCandidates = Array.isArray(frameContext.technicalFrameCandidates) ? frameContext.technicalFrameCandidates : frameCandidates;
  const bestFrame = asObj(frameContext.bestFrame);
  const warnings = [
    ...(Array.isArray(upload.warnings) ? upload.warnings : []),
    ...(Array.isArray(upload.mainMediaUploadWarnings) ? upload.mainMediaUploadWarnings : []),
  ].filter(Boolean);

  if (!upload.id && !upload.mediaId) warnings.push("main_media_drive_context_not_available_after_upload");
  if (!Object.keys(frameContext).length && mediaType === "VIDEO") warnings.push("frame_context_not_available_after_upload");

  return {
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
  };
});`;

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
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-upload-attach-no-items.${timestamp}.json`);
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
        name: 'livia-upload-attach-no-items',
        appliedAt: new Date().toISOString(),
      },
    },
  };

  const frameNode = patched.nodes.find((node) => node.name === 'Attach Uploaded Frame Metadata');
  if (!frameNode) throw new Error('Attach Uploaded Frame Metadata node not found');
  frameNode.parameters = { ...(frameNode.parameters || {}), jsCode: ATTACH_UPLOADED_FRAME_CODE };

  const mainNode = patched.nodes.find((node) => node.name === 'Attach Uploaded Main Media Metadata');
  if (!mainNode) throw new Error('Attach Uploaded Main Media Metadata node not found');
  mainNode.parameters = { ...(mainNode.parameters || {}), jsCode: ATTACH_UPLOADED_MAIN_CODE };

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
