#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const runtimePaths = require('./lib/runtime-paths');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || inputPath;

if (!inputPath) {
  console.error('Usage: node scripts/patch-livia-temp-cleanup.js <input.json> [output.json]');
  process.exit(1);
}

const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function fail(message) {
  throw new Error(message);
}

function getNode(name) {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) fail(`Node not found: ${name}`);
  return node;
}

function ensureMainArray(sourceName, outputIndex = 0) {
  workflow.connections[sourceName] ||= {};
  workflow.connections[sourceName].main ||= [];
  workflow.connections[sourceName].main[outputIndex] ||= [];
  return workflow.connections[sourceName].main[outputIndex];
}

function addConnection(sourceName, targetName, targetInputIndex = 0, outputIndex = 0) {
  const arr = ensureMainArray(sourceName, outputIndex);
  if (!arr.some((c) => c.node === targetName && c.type === 'main' && c.index === targetInputIndex)) {
    arr.push({ node: targetName, type: 'main', index: targetInputIndex });
  }
}

const updateFile = getNode('Update File');
getNode('Compose (3)');

const commandExpression = `={{ (() => {
  const tmpDir = $vars.LIVIA_TMP_DIR || ${JSON.stringify(runtimePaths.tmpDir)};

  function str(v) {
    return (v === undefined || v === null) ? "" : String(v);
  }

  function basenameNoExt(name) {
    const n = str(name).split("/").pop();
    return n.replace(/\\.[^.]+$/, "");
  }

  const groupKey = str($("Compose (3)").item.json.groupKey).trim();
  let base = groupKey.startsWith("dt:") ? groupKey.slice(3) : groupKey;
  if (!base) base = basenameNoExt($json.name);

  const payload = { tmpDir, base };

  return \`node <<'NODE'
const fs = require('fs');
const path = require('path');

const payload = \${JSON.stringify(payload)};
const tmpDir = payload.tmpDir;
const base = payload.base;

const result = {
  tmpDir,
  base,
  deleted: [],
  skipped: [],
  failed: [],
};

function recordFailed(file, reason) {
  result.failed.push({ file, reason: String(reason && reason.message ? reason.message : reason) });
}

function isAllowedBase(value) {
  return /^[A-Za-z0-9_-]+$/.test(String(value || ""));
}

function isAllowedCleanupName(name) {
  if (!name.startsWith(base)) return false;
  const suffix = name.slice(base.length);
  return (
    /^\\.(mp4|mov|m4v|webm|mkv|jpg|jpeg|png|webp)$/i.test(suffix) ||
    /^_temp\\.[A-Za-z0-9]+$/i.test(suffix) ||
    /^_temp_cand_[0-9]+\\.jpg$/i.test(suffix) ||
    /^_cand_[0-9]+\\.jpg$/i.test(suffix) ||
    /^_temp_thumb\\.jpg$/i.test(suffix) ||
    /^_thumb\\.jpg$/i.test(suffix) ||
    /^_temp_frame_analysis\\.json$/i.test(suffix) ||
    /^_frame_analysis\\.json$/i.test(suffix) ||
    /^_compressed\\.mp4$/i.test(suffix) ||
    /^_ig\\.jpg$/i.test(suffix) ||
    /^_temp_compressed\\.mp4$/i.test(suffix) ||
    /^_temp_ig\\.jpg$/i.test(suffix)
  );
}

try {
  if (!isAllowedBase(base)) {
    recordFailed("", "unsafe-or-empty-base");
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isAllowedCleanupName(entry.name)) continue;

    const fullPath = path.join(tmpDir, entry.name);
    try {
      fs.unlinkSync(fullPath);
      result.deleted.push(entry.name);
    } catch (error) {
      recordFailed(entry.name, error);
    }
  }

  console.log(JSON.stringify(result));
  process.exit(0);
} catch (error) {
  recordFailed("", error);
  console.log(JSON.stringify(result));
  process.exit(0);
}
NODE\`;
})() }}`;

let cleanupNode = workflow.nodes.find((n) => n.name === 'Cleanup Temp Files');

if (!cleanupNode) {
  cleanupNode = {
    parameters: {
      executeOnce: false,
      command: commandExpression,
    },
    type: 'n8n-nodes-base.executeCommand',
    typeVersion: 1,
    position: [
      Number(updateFile.position?.[0] || -3872) + 224,
      Number(updateFile.position?.[1] || -2448),
    ],
    id: crypto.randomUUID(),
    name: 'Cleanup Temp Files',
  };
  workflow.nodes.push(cleanupNode);
} else {
  cleanupNode.parameters ||= {};
  cleanupNode.parameters.executeOnce = false;
  cleanupNode.parameters.command = commandExpression;
}

addConnection('Update File', 'Cleanup Temp Files', 0, 0);

workflow.meta ||= {};
workflow.meta.codexPatch = {
  name: 'livia-post-publish-temp-cleanup',
  appliedAt: new Date().toISOString(),
  notes: [
    'Adds best-effort temp cleanup after successful Update File.',
    'Cleanup is scoped by Compose (3) groupKey/base and deletes only whitelisted temp artifacts.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2));

console.log(JSON.stringify({
  outputPath,
  nodes: workflow.nodes.length,
  hasCleanupTempFiles: workflow.nodes.some((n) => n.name === 'Cleanup Temp Files'),
  updateFileConnection: workflow.connections['Update File'],
}, null, 2));
