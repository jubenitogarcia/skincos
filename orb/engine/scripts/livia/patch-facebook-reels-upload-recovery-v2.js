#!/usr/bin/env node

'use strict';

const fs = require('fs');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function main() {
  const file = arg('--input');
  const raw = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  const workflow = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const node = (workflow.nodes || []).find((entry) => entry && entry.name === 'Process HTTP Publish Result');
  if (!node || typeof node.parameters?.jsCode !== 'string') throw new Error('Missing Code node Process HTTP Publish Result.');
  const before = `  const allKnown = [...state.completed, ...state.pending, ...state.allJobs].map(asObject);
  const originalFinish = state.completed.map(asObject).find((entry) => Number(entry.publishRunIndex) === originalFinishRun);`;
  const after = `  // Durable resume records are deliberately compact and omit dependency edges.
  // The complete immutable job graph is retained in allJobs, so it must win
  // over compact completed entries when rebuilding a provider-only recovery.
  const allKnown = [...state.allJobs, ...state.pending, ...state.completed].map(asObject);
  const originalFinish = allKnown.find((entry) => Number(entry.publishRunIndex) === originalFinishRun);`;
  const count = node.parameters.jsCode.split(before).length - 1;
  if (count !== 1) throw new Error(`Process HTTP Publish Result: expected one compact-history recovery marker, found ${count}.`);
  node.parameters.jsCode = node.parameters.jsCode.replace(before, after)
    .replace('const originalStart = state.completed.map(asObject).find((entry) =>', 'const originalStart = allKnown.find((entry) =>')
    .replace('const originalUpload = state.completed.map(asObject).find((entry) =>', 'const originalUpload = allKnown.find((entry) =>')
    .replace('const originalReady = state.completed.map(asObject).find((entry) =>', 'const originalReady = allKnown.find((entry) =>');
  if (!node.parameters.jsCode.includes('const allKnown = [...state.allJobs, ...state.pending, ...state.completed]')) throw new Error('Process HTTP Publish Result: full graph recovery postcondition failed.');
  if (node.retryOnFail === true) throw new Error('Process HTTP Publish Result: implicit retry must remain disabled.');
  process.stdout.write(`${JSON.stringify(workflow)}\n`);
}

main();
