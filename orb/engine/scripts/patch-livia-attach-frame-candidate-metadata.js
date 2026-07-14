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

const ATTACH_CODE = String.raw`// Reattach frame candidate metadata after Read Thumb and keep upload resilient.
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

function fileNameOnly(value) {
  return str(value, "").split("/").filter(Boolean).pop() || "";
}

function fileBaseName(value) {
  return fileNameOnly(value).replace(/\.[^.]+$/, "");
}

function normalizeLookupKey(value) {
  return fileNameOnly(value).trim().toLowerCase();
}

function deriveRankFromName(value) {
  const name = fileNameOnly(value);
  const match = name.match(/(?:^|[_-])cand[_-]?(\d{1,3})(?:\.|$)/i);
  return match ? num(match[1], 0) : 0;
}

function deriveMediaPrefix(value) {
  const name = fileNameOnly(value);
  const match = name.match(/^(\d{10})(?:[_\-. ]|$)/);
  return match ? match[1] : "";
}

function deriveGroupKey(value) {
  const prefix = deriveMediaPrefix(value);
  return prefix ? "dt:" + prefix : "";
}

function pushUnique(list, value) {
  if (!value) return;
  if (!list.includes(value)) list.push(value);
}

function safeItems(name) {
  try {
    const items = $items(name);
    return { available: true, items: Array.isArray(items) ? items : [] };
  } catch {
    return { available: false, items: [] };
  }
}

function safeCurrentJson(name) {
  try {
    const item = $(name).item;
    return asObj(item && item.json);
  } catch {
    return {};
  }
}

function itemJson(item) {
  return asObj(item && item.json);
}

function hasFrameMetadata(json) {
  return !!(
    json.thumbPath ||
    json.candidate ||
    json.bestFrame ||
    Array.isArray(json.frameCandidates) ||
    Array.isArray(json.technicalFrameCandidates)
  );
}

function candidateThumbName(json) {
  const candidate = asObj(json.candidate);
  return normalizeLookupKey(
    json.thumbPath ||
    candidate.thumbPath ||
    candidate.path ||
    candidate.fileName ||
    json.fileName ||
    json.filePath ||
    json.path
  );
}

function findFrameSource(parseItems, currentJson, index) {
  if (hasFrameMetadata(currentJson)) {
    return { json: currentJson, source: "current-item" };
  }

  const currentName = normalizeLookupKey(
    currentJson.fileName ||
    currentJson.filePath ||
    currentJson.path ||
    currentJson.thumbPath
  );

  if (currentName) {
    const matched = parseItems.find((parseItem) => candidateThumbName(itemJson(parseItem)) === currentName);
    if (matched) return { json: itemJson(matched), source: "parse-frame-analysis-name" };
  }

  if (parseItems[index]) {
    return { json: itemJson(parseItems[index]), source: "parse-frame-analysis-index" };
  }

  return { json: {}, source: "fallback-read-thumb" };
}

function findMediaJson(composeItems, currentJson, frameJson, thumbName) {
  const current = safeCurrentJson("Compose (1)");
  if (current.id || current.name || current.groupKey) return { json: current, source: "compose-current" };

  const prefix =
    deriveMediaPrefix(thumbName) ||
    deriveMediaPrefix(currentJson.fileName) ||
    deriveMediaPrefix(frameJson.thumbPath) ||
    deriveMediaPrefix(asObj(frameJson.candidate).thumbPath);

  if (prefix) {
    const matched = composeItems.find((composeItem) => {
      const media = itemJson(composeItem);
      return (
        str(media.groupKey, "") === "dt:" + prefix ||
        fileBaseName(media.name) === prefix ||
        str(media.name, "").startsWith(prefix)
      );
    });
    if (matched) return { json: itemJson(matched), source: "compose-prefix" };
  }

  if (composeItems.length === 1) return { json: itemJson(composeItems[0]), source: "compose-single" };

  return { json: {}, source: "derived-from-thumb-name" };
}

function normalizeCandidate(raw, index, fallbackThumbPath, fallbackFileName, metadataSource) {
  const c = asObj(raw);
  const thumbPath = str(c.thumbPath || c.path || fallbackThumbPath || fallbackFileName, "");
  const fileName = fileNameOnly(thumbPath) || fileNameOnly(fallbackFileName);
  const derivedRank = deriveRankFromName(fileName);
  const hasRichCandidate = Object.keys(c).length > 0;

  return {
    rank: num(c.rank, derivedRank || index + 1),
    timestamp: str(c.timestamp || c.bestTimestamp, ""),
    timestampSeconds: num(c.timestampSeconds ?? c.bestTimestampSeconds, 0),
    confidence: num(c.confidence ?? c.score, 0),
    reason: str(c.reason || c.why || c.notes, ""),
    thumbPath,
    fileName,
    fileBase: fileBaseName(fileName),
    source: hasRichCandidate ? metadataSource : "frame-analysis-fallback",
  };
}

const inputItems = $input.all();
const parseLookup = safeItems("Parse Frame Analysis JSON");
const composeLookup = safeItems("Compose (1)");
const parseItems = parseLookup.items;
const composeItems = composeLookup.items;

return inputItems.map((item, index) => {
  const currentJson = itemJson(item);
  const thumbName = fileNameOnly(
    currentJson.fileName ||
    currentJson.filePath ||
    currentJson.path ||
    currentJson.thumbPath
  );
  const warnings = [];

  const frame = findFrameSource(parseItems, currentJson, index);
  const frameJson = asObj(frame.json);
  const rawCandidate = asObj(frameJson.candidate);
  const fallbackThumbPath = str(
    frameJson.thumbPath ||
    rawCandidate.thumbPath ||
    currentJson.fileName ||
    currentJson.filePath ||
    currentJson.path ||
    currentJson.thumbPath,
    ""
  );
  const candidate = normalizeCandidate(rawCandidate, index, fallbackThumbPath, thumbName, frame.source);
  const bestFrame = asObj(frameJson.bestFrame);
  const media = findMediaJson(composeItems, currentJson, frameJson, candidate.fileName || thumbName);
  const mediaJson = asObj(media.json);
  const derivedGroupKey = deriveGroupKey(candidate.fileName || thumbName || fallbackThumbPath);

  if (!parseLookup.available || !hasFrameMetadata(frameJson) || !Object.keys(rawCandidate).length) {
    pushUnique(warnings, "frame_metadata_missing_due_to_pinned_context");
  }

  if (!mediaJson.id && !mediaJson.name && !mediaJson.groupKey) {
    pushUnique(warnings, "media_context_missing_due_to_pinned_context");
  }

  return {
    json: {
      ...currentJson,
      mediaId: str(mediaJson.id || currentJson.mediaId, ""),
      mediaName: str(mediaJson.name || currentJson.mediaName, ""),
      mediaMimeType: str(mediaJson.mimeType || currentJson.mediaMimeType, ""),
      groupKey: str(mediaJson.groupKey || currentJson.groupKey || derivedGroupKey, ""),
      groupOrder: mediaJson.groupOrder ?? currentJson.groupOrder,
      publishTime: str(mediaJson.publishTime || currentJson.publishTime, ""),
      thumbPath: candidate.thumbPath || fallbackThumbPath,
      candidate,
      bestFrame,
      frameCandidates: [candidate],
      technicalFrameCandidates: [candidate],
      frameCandidateCount: 1,
      uploadRole: "frame_candidate",
      frameMetadataSource: frame.source,
      mediaMetadataSource: media.source,
      frameMetadataWarnings: warnings,
    },
    binary: item.binary || {},
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

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = getWorkflowFromRow(row);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-attach-frame-candidate-metadata.${timestamp}.json`);
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
        name: 'livia-attach-frame-candidate-metadata',
        appliedAt: new Date().toISOString(),
      },
    },
  };

  const attachNode = patched.nodes.find((node) => node.name === 'Attach Frame Candidate Metadata');
  if (!attachNode) throw new Error('Attach Frame Candidate Metadata node not found');
  attachNode.parameters = {
    ...(attachNode.parameters || {}),
    jsCode: ATTACH_CODE,
  };

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
    `).run(
      versionId,
      WORKFLOW_ID,
      'Codex',
      updatedAt,
      updatedAt,
      nodes,
      connections,
      patched.name,
      0,
      description,
    );

    db.prepare(`
      UPDATE workflow_entity
      SET
        nodes = ?,
        connections = ?,
        settings = ?,
        staticData = ?,
        meta = ?,
        versionId = ?,
        activeVersionId = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      nodes,
      connections,
      settings,
      staticData,
      meta,
      versionId,
      versionId,
      updatedAt,
      WORKFLOW_ID,
    );
  });

  save();

  const exported = {
    ...patched,
    versionId,
    activeVersionId: versionId,
    updatedAt,
  };

  for (const exportPath of EXPORT_PATHS) {
    exportWorkflow(exported, exportPath);
  }

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
