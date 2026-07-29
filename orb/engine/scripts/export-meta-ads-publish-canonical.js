#!/usr/bin/env node
'use strict';

// Converts a private, live n8n export into the tracked workflow definition.
// Runtime execution state and version counters deliberately stay out of Git.
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  throw new Error('Usage: node export-meta-ads-publish-canonical.js <live-export.json> <canonical-workflow.json>');
}

const live = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
if (live.id !== WORKFLOW_ID) throw new Error('Unexpected workflow id.');
if (live.active !== false) throw new Error('Refusing to export an active workflow.');
if (!Array.isArray(live.nodes) || !live.nodes.length || !live.connections || typeof live.connections !== 'object') {
  throw new Error('Live workflow is structurally incomplete.');
}

const canonical = {
  id: live.id,
  name: live.name,
  active: false,
  nodes: live.nodes,
  connections: live.connections,
  settings: live.settings || {},
  meta: live.meta || {},
  description: live.description || '',
};

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(canonical, null, 2)}\n`);
console.log(JSON.stringify({
  workflow_id: canonical.id,
  nodes: canonical.nodes.length,
  output: path.resolve(outputPath),
  omitted: ['staticData', 'pinData', 'versionId', 'activeVersionId', 'versionCounter', 'updatedAt'],
}, null, 2));
