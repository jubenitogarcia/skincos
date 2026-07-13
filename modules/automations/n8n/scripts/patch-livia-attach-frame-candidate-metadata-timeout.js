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

const ATTACH_CODE = String.raw`// Reattach frame candidate metadata after Read Thumb without named-node lookups.
// In manual/pinned reruns, resolving external node context can stall in the Task Runner.
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

function firstCandidate(json) {
  if (json.candidate && typeof json.candidate === "object") return json.candidate;
  if (Array.isArray(json.frameCandidates) && json.frameCandidates[0]) return json.frameCandidates[0];
  if (Array.isArray(json.technicalFrameCandidates) && json.technicalFrameCandidates[0]) return json.technicalFrameCandidates[0];
  return {};
}

function normalizeCandidate(raw, index, fallbackThumbPath, fallbackFileName) {
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
    source: hasRichCandidate ? "current-item" : "frame-analysis-fallback",
  };
}

return $input.all().map((item, index) => {
  const currentJson = asObj(item && item.json);
  const rawCandidate = firstCandidate(currentJson);
  const fallbackThumbPath = str(
    currentJson.thumbPath ||
    asObj(rawCandidate).thumbPath ||
    currentJson.fileName ||
    currentJson.filePath ||
    currentJson.path,
    ""
  );
  const fallbackFileName = fileNameOnly(fallbackThumbPath);
  const candidate = normalizeCandidate(rawCandidate, index, fallbackThumbPath, fallbackFileName);
  const bestFrame = asObj(currentJson.bestFrame);
  const derivedGroupKey = deriveGroupKey(candidate.fileName || fallbackFileName || fallbackThumbPath);
  const warnings = [];

  if (!Object.keys(asObj(rawCandidate)).length) {
    pushUnique(warnings, "frame_metadata_missing_due_to_pinned_context");
  }

  if (!currentJson.mediaId && !currentJson.mediaName && !currentJson.groupKey) {
    pushUnique(warnings, "media_context_missing_due_to_pinned_context");
  }

  return {
    json: {
      ...currentJson,
      mediaId: str(currentJson.mediaId || currentJson.id, ""),
      mediaName: str(currentJson.mediaName || "", ""),
      mediaMimeType: str(currentJson.mediaMimeType || "", ""),
      groupKey: str(currentJson.groupKey || derivedGroupKey, ""),
      groupOrder: currentJson.groupOrder,
      publishTime: str(currentJson.publishTime || "", ""),
      thumbPath: candidate.thumbPath || fallbackThumbPath,
      candidate,
      bestFrame,
      frameCandidates: [candidate],
      technicalFrameCandidates: [candidate],
      frameCandidateCount: 1,
      uploadRole: "frame_candidate",
      frameMetadataSource: candidate.source,
      mediaMetadataSource: currentJson.groupKey ? "current-item" : "derived-from-thumb-name",
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
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-attach-frame-candidate-metadata-timeout.${timestamp}.json`);
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
        name: 'livia-attach-frame-candidate-metadata-timeout',
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
