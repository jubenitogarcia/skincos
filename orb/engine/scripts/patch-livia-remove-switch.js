#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(process.env.HOME, '.n8n', 'database.sqlite');
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPECTED_VERSION_IDS = new Set([
  '46387969-5224-49ba-bed8-558d2e78d189',
  '98450d65-abcf-43d7-8475-55132d3eff5a',
]);
const ROOT = path.join(__dirname, '..');
const EXPORT_PATHS = [
  path.join(ROOT, 'workflows', 'livia.json'),
  path.join(ROOT, 'workflows', 'livia.active.json'),
  path.join(ROOT, 'workflows', 'livia.verify.json'),
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: !!row.active,
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    pinData: parseJson(row.pinData, {}),
    meta: parseJson(row.meta, {}),
    description: row.description || null,
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
  };
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function maybeFindNode(workflow, name) {
  return workflow.nodes.find((item) => item.name === name) || null;
}

function removeNode(workflow, name) {
  if (!maybeFindNode(workflow, name)) return;
  workflow.nodes = workflow.nodes.filter((node) => node.name !== name);
  delete workflow.connections[name];
  for (const conn of Object.values(workflow.connections)) {
    const groups = conn.main || [];
    conn.main = groups.map((group) => (group || []).filter((edge) => edge.node !== name));
  }
}

function renameNode(workflow, from, to) {
  const node = maybeFindNode(workflow, from);
  if (!node) return maybeFindNode(workflow, to);
  node.name = to;
  if (workflow.connections[from]) {
    workflow.connections[to] = workflow.connections[from];
    delete workflow.connections[from];
  }
  for (const conn of Object.values(workflow.connections)) {
    for (const group of (conn.main || [])) {
      for (const edge of (group || [])) {
        if (edge.node === from) edge.node = to;
      }
    }
  }
  return node;
}

function backupWorkflow(workflow) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', 'T');
  const backupPath = path.join(ROOT, 'workflows', `livia.before-remove-switch.${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify(workflow, null, 2)}\n`);
  return backupPath;
}

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function stripExpressionWrapper(expression) {
  const text = String(expression || '').trim();
  if (text.startsWith('={{') && text.endsWith('}}')) {
    return text.slice(3, -2).trim();
  }
  return text;
}

function evaluateExpression(expression, env = {}) {
  const body = stripExpressionWrapper(expression);
  return new Function('$', '$json', `"use strict"; return (${body});`)(
    env.$ || (() => ({ item: { json: {} } })),
    env.$json || {},
  );
}

function extractThreshold(expression, name, fallback) {
  const match = String(expression || '').match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  return match ? Number(match[1]) : fallback;
}

function extractFramePickerArtifacts(frameCommandExpression) {
  const rendered = evaluateExpression(frameCommandExpression, {
    $: (name) => {
      if (name === 'Download File') return { item: { json: { mimeType: 'video/mp4' } } };
      if (name === 'Write File') return { item: { json: { fileName: '/tmp/sample_ABCDEFGH_temp.mp4' } } };
      return { item: { json: {} } };
    },
  });

  const pythonMatch = String(rendered).match(/<<'PY'\n([\s\S]*?)\nPY\n/);
  assert(pythonMatch, 'Could not extract frame picker Python block from Frame Analysis + Save Thumb');
  const pythonSource = pythonMatch[1];

  const pythonBinMatch = String(rendered).match(/\n([^\n"]*python3) "\$FRAME_PICKER"/);
  const pythonBin = pythonBinMatch ? pythonBinMatch[1].trim() : 'python3';

  const maxMatch = String(rendered).match(/--max\s+(\d+)/);
  const sceneMatch = String(rendered).match(/--scene\s+([0-9.]+)/);

  return {
    pythonSource,
    pythonBin,
    maxCandidates: maxMatch ? Number(maxMatch[1]) : 40,
    sceneThreshold: sceneMatch ? Number(sceneMatch[1]) : 0.35,
  };
}

function extractEmbeddedFramePickerArtifacts(commandSource) {
  const text = String(commandSource || '');
  const pythonMatch = text.match(/<<'PY'\n([\s\S]*?)\nPY\n/);
  assert(pythonMatch, 'Could not extract embedded frame picker Python block from Process Media Asset');

  const pythonBinMatch = text.match(/PYTHON_BIN=([^\n]+)/);
  const maxMatch = text.match(/--max\s+(\d+)/);
  const sceneMatch = text.match(/--scene\s+([0-9.]+)/);

  return {
    pythonSource: pythonMatch[1],
    pythonBin: pythonBinMatch ? pythonBinMatch[1].replace(/^["']|["']$/g, '').trim() : 'python3',
    maxCandidates: maxMatch ? Number(maxMatch[1]) : 40,
    sceneThreshold: sceneMatch ? Number(sceneMatch[1]) : 0.35,
  };
}

function buildProcessMediaAssetCommand({ imageThreshold, videoThreshold, frameArtifacts }) {
  const bt = '`';
  const fallbackAnalysis = {
    applicable: true,
    bestTimestamp: '00:01.000',
    bestTimestampSeconds: 1,
    bestFrameSeconds: 1,
    reason: 'fallback: ffmpeg @ 1s (framepicker unavailable)',
    confidence: 0.55,
    weights: { face: 0.5, sharp: 0.3, text: 0.15, smile: 0.05 },
    thumbPath: '__THUMB__',
    candidates: [],
    candidateThumbs: [],
  };

  return String.raw`={{ (() => {
  const j = $('Download File').item.json || {};
  const inputFile = String($json.fileName || $('Write File').item.json.fileName || '');
  const mime = String(j.mimeType || '').toLowerCase();
  const name = String(j.name || '').toLowerCase();
  const size = Number(j.size || 0);

  const IMAGE_THRESHOLD = ${imageThreshold};
  const VIDEO_THRESHOLD = ${videoThreshold};

  const isVideo =
    mime.includes('video') ||
    /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name);

  const isImage =
    mime.includes('image/') ||
    /\.(jpg|jpeg|webp|gif|heic|heif|tif|tiff|bmp|png)$/i.test(name);

  const isPng =
    mime.includes('image/png') ||
    /\.png$/i.test(name);

  const needsOptimization =
    (isVideo && size > VIDEO_THRESHOLD) ||
    (isImage && !isVideo && (isPng || size > IMAGE_THRESHOLD));

  const lastSlash = inputFile.lastIndexOf('/');
  const dir = lastSlash >= 0 ? inputFile.substring(0, lastSlash) : '';
  const file = lastSlash >= 0 ? inputFile.substring(lastSlash + 1) : inputFile;
  const parts = file.split('.');
  if (parts.length > 1) parts.pop();
  const base = parts.join('.') || file;
  const outputBase = base.endsWith('_temp') ? base.slice(0, -5) : base;
  const optimizedExt = isVideo ? '.mp4' : '.jpg';
  const optimizedPath = dir ? dir + '/' + outputBase + optimizedExt : outputBase + optimizedExt;
  const legacyPath = isVideo
    ? (dir ? dir + '/' + base + '_compressed.mp4' : base + '_compressed.mp4')
    : (dir ? dir + '/' + base + '_ig.jpg' : base + '_ig.jpg');
  const thumbPath = dir ? dir + '/' + base + '_thumb.jpg' : base + '_thumb.jpg';
  const outJson = dir ? dir + '/' + base + '_frame_analysis.json' : base + '_frame_analysis.json';
  const mainMediaFilePath = needsOptimization ? optimizedPath : inputFile;
  const outputMimeType = isVideo
    ? (needsOptimization ? 'video/mp4' : (mime || 'video/mp4'))
    : (needsOptimization ? 'image/jpeg' : (mime || 'image/jpeg'));

  const payload = {
    inputFile,
    inputFileName: file,
    mainMediaFilePath,
    mainMediaFileName: (needsOptimization ? optimizedPath : inputFile).split('/').pop() || file,
    optimizedPath,
    legacyPath,
    thumbPath,
    outJson,
    mimeType: outputMimeType,
    isVideo,
    isImage,
    needsOptimization,
  };

  const fallbackAnalysis = ${JSON.stringify(fallbackAnalysis)};

  return ${bt}set -e
ORIGINAL=\${JSON.stringify(payload.inputFile)}
OPTIMIZED=\${JSON.stringify(payload.optimizedPath)}
LEGACY=\${JSON.stringify(payload.legacyPath)}
THUMB=\${JSON.stringify(payload.thumbPath)}
OUTJSON=\${JSON.stringify(payload.outJson)}
IS_VIDEO=\${payload.isVideo ? '1' : '0'}
NEEDS_OPTIMIZATION=\${payload.needsOptimization ? '1' : '0'}
rm -f "$OUTJSON" "$THUMB" 2>/dev/null || true
rm -f \${JSON.stringify((dir ? dir + '/' : '') + base + '_cand_' )}*.jpg 2>/dev/null || true

if [ "$NEEDS_OPTIMIZATION" = "1" ]; then
  if [ "$IS_VIDEO" = "1" ]; then
    ffmpeg -hide_banner -loglevel error -y -i "$ORIGINAL" -vf scale=-2:1080 -c:v libx264 -preset medium -crf 24 -c:a aac -b:a 128k "$OPTIMIZED"
  else
    ffmpeg -hide_banner -loglevel error -y -i "$ORIGINAL" -vf scale=1440:-2 -q:v 4 "$OPTIMIZED"
  fi
  if [ ! -f "$OPTIMIZED" ]; then
    echo "Process Media Asset failed to create optimized file: $OPTIMIZED" 1>&2
    exit 1
  fi
fi

if [ "$IS_VIDEO" = "1" ]; then
  INPUT=""
  for candidate in "$OPTIMIZED" "$LEGACY" "$ORIGINAL"; do
    if [ -f "$candidate" ]; then INPUT="$candidate"; break; fi
  done
  if [ -z "$INPUT" ]; then
    echo "Process Media Asset input file missing: $OPTIMIZED | $LEGACY | $ORIGINAL" 1>&2
    exit 1
  fi

  FRAME_PICKER=$(mktemp -t livia_frame_picker.XXXXXX.py)
  trap 'rm -f "$FRAME_PICKER"' EXIT
  cat > "$FRAME_PICKER" <<'PY'
${frameArtifacts.pythonSource}
PY

  PYTHON_BIN=${JSON.stringify(frameArtifacts.pythonBin)}
  if [ ! -x "$PYTHON_BIN" ]; then PYTHON_BIN=python3; fi

  "$PYTHON_BIN" "$FRAME_PICKER" --input "$INPUT" --thumb "$THUMB" --json "$OUTJSON" --max ${frameArtifacts.maxCandidates} --scene ${frameArtifacts.sceneThreshold} || (
    echo "FramePicker falhou, fallback ffmpeg" 1>&2
    ffmpeg -hide_banner -loglevel error -y -ss 1.0 -i "$INPUT" -frames:v 1 -q:v 2 -vf "scale=-2:1080" "$THUMB" || true
    cat > "$OUTJSON" <<'JSON'
\${JSON.stringify({ ...fallbackAnalysis, thumbPath: payload.thumbPath }, null, 2)}
JSON
  )
fi

node <<'NODE'
const fs = require('fs');
const payload = \${JSON.stringify(payload)};

function str(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asObj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

let analysis = {};
if (payload.isVideo) {
  if (!fs.existsSync(payload.outJson)) {
    throw new Error('Process Media Asset did not produce frame analysis JSON: ' + payload.outJson);
  }
  analysis = JSON.parse(fs.readFileSync(payload.outJson, 'utf8'));
}

const current = asObj(analysis);
const bestFrame = {
  applicable: !!payload.isVideo,
  bestTimestamp: str(current.bestTimestamp, ''),
  bestTimestampSeconds: num(current.bestTimestampSeconds, num(current.bestFrameSeconds, 0)),
  bestFrameSeconds: num(current.bestFrameSeconds, num(current.bestTimestampSeconds, 0)),
  reason: str(current.reason, payload.isVideo ? 'frame-analysis' : 'not-video'),
  confidence: num(current.confidence, payload.isVideo ? 0 : 1),
  candidates: Array.isArray(current.candidates) ? current.candidates : [],
  thumbPath: str(current.thumbPath, ''),
};

const output = {
  status: 'ok',
  mediaKind: payload.isVideo ? 'video' : 'image',
  sourceFilePath: payload.inputFile,
  sourceFileName: payload.inputFileName,
  mainMediaFilePath: payload.mainMediaFilePath,
  mainMediaFileName: str(payload.mainMediaFileName, '') || str(payload.inputFileName, ''),
  mimeType: payload.mimeType,
  optimized: !!payload.needsOptimization,
  analysisApplicable: !!payload.isVideo,
  thumbPath: str(current.thumbPath, ''),
  candidateThumbs: Array.isArray(current.candidateThumbs) ? current.candidateThumbs : [],
  bestFrame,
  warnings: Array.isArray(current.warnings) ? current.warnings : [],
};

process.stdout.write(JSON.stringify(output));
NODE${bt};
})() }}`;
}

function buildReadMediaAssetExpression() {
  return String.raw`={{ (() => {
  const role = String($json.uploadRole || '').toLowerCase();
  const writePath = String($('Write File').item.json.fileName || '');

  if (role === 'frame_candidate') {
    return String($json.thumbPath || $json.fileName || '');
  }

  if (role === 'main_media') {
    return String($json.mainMediaFilePath || $json.fileName || writePath);
  }

  return String($json.mainMediaFilePath || $json.thumbPath || $json.fileName || writePath);
})() }}`;
}

function persistWorkflow(db, row, workflow) {
  const versionId = crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  const nodes = JSON.stringify(workflow.nodes);
  const connections = JSON.stringify(workflow.connections);
  const settings = JSON.stringify(workflow.settings || {});
  const staticData = JSON.stringify(workflow.staticData || {});
  const pinData = JSON.stringify(workflow.pinData || {});
  const meta = JSON.stringify(workflow.meta || {});

  db.prepare(`
    INSERT INTO workflow_history (
      versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    versionId,
    WORKFLOW_ID,
    'Codex',
    updatedAt,
    updatedAt,
    nodes,
    connections,
    workflow.name,
    workflow.description || row.description || null,
  );

  db.prepare(`
    UPDATE workflow_entity
    SET
      name = ?,
      nodes = ?,
      connections = ?,
      settings = ?,
      staticData = ?,
      pinData = ?,
      meta = ?,
      description = ?,
      versionId = ?,
      activeVersionId = ?,
      updatedAt = ?
    WHERE id = ?
  `).run(
    workflow.name,
    nodes,
    connections,
    settings,
    staticData,
    pinData,
    meta,
    workflow.description || row.description || null,
    versionId,
    versionId,
    updatedAt,
    WORKFLOW_ID,
  );

  return { versionId, updatedAt };
}

function exportWorkflow(workflow, versionId, updatedAt) {
  const exportData = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    active: workflow.active,
    settings: workflow.settings || {},
    staticData: workflow.staticData || {},
    pinData: workflow.pinData || {},
    meta: workflow.meta || {},
    versionId,
    updatedAt,
  };

  for (const exportPath of EXPORT_PATHS) {
    fs.writeFileSync(exportPath, `${JSON.stringify(exportData, null, 2)}\n`);
  }
}

function main() {
  const db = new Database(DB_PATH);
  try {
    const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
    assert(row, `Workflow not found: ${WORKFLOW_ID}`);
    assert(EXPECTED_VERSION_IDS.has(row.versionId), `Expected versionId in ${JSON.stringify([...EXPECTED_VERSION_IDS])}, got ${row.versionId}`);

    const workflow = workflowFromRow(row);
    const backupPath = backupWorkflow(workflow);

    const switchNode = maybeFindNode(workflow, 'Switch');
    const frameNode = maybeFindNode(workflow, 'Frame Analysis + Save Thumb');
    const existingProcessNode = maybeFindNode(workflow, 'Process Media Asset');
    const processBatchSource = readSource('workflow-src/livia/prepare-media-upload-batch.js');

    const imageThreshold = switchNode
      ? extractThreshold(JSON.stringify(switchNode.parameters), 'IMAGE_THRESHOLD', 8000000)
      : extractThreshold(existingProcessNode?.parameters?.command, 'IMAGE_THRESHOLD', 8000000);
    const videoThreshold = switchNode
      ? extractThreshold(JSON.stringify(switchNode.parameters), 'VIDEO_THRESHOLD', 50000000)
      : extractThreshold(existingProcessNode?.parameters?.command, 'VIDEO_THRESHOLD', 50000000);
    const frameArtifacts = frameNode
      ? extractFramePickerArtifacts(frameNode.parameters.command)
      : extractEmbeddedFramePickerArtifacts(existingProcessNode?.parameters?.command);

    renameNode(workflow, 'Optimize', 'Process Media Asset');
    renameNode(workflow, 'Parse Frame Analysis JSON', 'Prepare Media Upload Batch');
    removeNode(workflow, 'Switch');
    removeNode(workflow, 'Frame Analysis + Save Thumb');

    const processNode = findNode(workflow, 'Process Media Asset');
    processNode.parameters.command = buildProcessMediaAssetCommand({
      imageThreshold,
      videoThreshold,
      frameArtifacts,
    });

    const batchNode = findNode(workflow, 'Prepare Media Upload Batch');
    batchNode.parameters.jsCode = processBatchSource;

    const readMediaAsset = findNode(workflow, 'Read Media Asset');
    const fileSelector = buildReadMediaAssetExpression();
    readMediaAsset.parameters.fileSelector = fileSelector;
    readMediaAsset.parameters.options = {
      ...(readMediaAsset.parameters.options || {}),
      fileName: fileSelector,
    };

    const attachNode = findNode(workflow, 'Attach Uploaded Main Media Metadata');
    attachNode.parameters.jsCode = String(attachNode.parameters.jsCode || '')
      .replace(
        '// Reattach mixed Cloudinary uploads: frame candidates are cached, main media is sent to Livia.',
        '// Reattach mixed Cloudinary uploads from the unified media processor: frame candidates are cached, main media is sent to Livia.',
      );

    workflow.connections['Write File'] = {
      main: [[{ node: 'Process Media Asset', type: 'main', index: 0 }]],
    };
    workflow.connections['Process Media Asset'] = {
      main: [[{ node: 'Prepare Media Upload Batch', type: 'main', index: 0 }]],
    };
    workflow.connections['Prepare Media Upload Batch'] = {
      main: [[{ node: 'Read Media Asset', type: 'main', index: 0 }]],
    };

    const { versionId, updatedAt } = persistWorkflow(db, row, workflow);
    exportWorkflow(workflow, versionId, updatedAt);

    console.log(JSON.stringify({
      ok: true,
      workflowId: WORKFLOW_ID,
      previousVersionId: row.versionId,
      previousActiveVersionId: row.activeVersionId,
      versionId,
      exportPaths: EXPORT_PATHS,
      backupPath,
      thresholds: { imageThreshold, videoThreshold },
    }, null, 2));
  } finally {
    db.close();
  }
}

main();
