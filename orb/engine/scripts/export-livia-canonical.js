#!/usr/bin/env node
'use strict';

// Converts a private, live Livia export into the tracked workflow snapshot.
// The active workflow is canonical; this file is never imported into n8n.
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  throw new Error('Usage: node export-livia-canonical.js <live-export.json> <canonical-workflow.json>');
}

const live = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8').replace(/^\uFEFF/, ''));
if (live.id !== WORKFLOW_ID) throw new Error('Unexpected Livia workflow id.');
if (live.active !== true) throw new Error('Refusing to export a non-active Livia workflow.');
if (!Array.isArray(live.nodes) || !live.nodes.length || !live.connections || typeof live.connections !== 'object') {
  throw new Error('Live Livia workflow is structurally incomplete.');
}
if (!live.versionId || live.versionId !== live.activeVersionId) {
  throw new Error('Live Livia export has no aligned active version.');
}

const canonical = {
  id: live.id,
  name: live.name,
  active: live.active,
  isArchived: Boolean(live.isArchived),
  nodes: live.nodes,
  connections: live.connections,
  settings: live.settings || {},
  meta: live.meta || {},
  description: live.description || '',
  versionId: live.versionId,
  activeVersionId: live.activeVersionId,
  versionCounter: Number(live.versionCounter || 0),
};

const destination = path.resolve(outputPath);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${JSON.stringify(canonical, null, 2)}\n`);
console.log(JSON.stringify({
  workflowId: canonical.id,
  versionId: canonical.versionId,
  nodes: canonical.nodes.length,
  output: destination,
  source: 'live:postgres:workflow_history',
}, null, 2));
