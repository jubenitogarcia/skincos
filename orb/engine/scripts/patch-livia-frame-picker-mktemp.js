#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || inputPath;

if (!inputPath) {
  console.error('Usage: node scripts/patch-livia-frame-picker-mktemp.js <input.json> [output.json]');
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

function replaceExact(haystack, needle, replacement, label) {
  if (!haystack.includes(needle)) fail(`Missing code block: ${label}`);
  return haystack.replace(needle, replacement);
}

const frameNode = getNode('Frame Analysis + Save Thumb');
frameNode.parameters ||= {};

let command = String(frameNode.parameters.command || '');

command = replaceExact(
  command,
  "`\\n` +\n`cat > /tmp/frame_picker.py <<'PY'\\n` +",
  "`FRAME_PICKER=$(mktemp -t livia_frame_picker.XXXXXX.py)\\n` +\n`trap 'rm -f \"$FRAME_PICKER\"' EXIT\\n` +\n`\\n` +\n`cat > \"$FRAME_PICKER\" <<'PY'\\n` +",
  'frame picker mktemp writer',
);

command = replaceExact(
  command,
  "`/Users/jubenitogarcia/.pyenv/versions/3.12.4/bin/python3 /tmp/frame_picker.py --input \"$INPUT\" --thumb \"$THUMB\" --json \"$OUTJSON\" --max 40 --scene 0.35 || (\\n` +",
  "`/Users/jubenitogarcia/.pyenv/versions/3.12.4/bin/python3 \"$FRAME_PICKER\" --input \"$INPUT\" --thumb \"$THUMB\" --json \"$OUTJSON\" --max 40 --scene 0.35 || (\\n` +",
  'frame picker mktemp invocation',
);

frameNode.parameters.command = command;

workflow.meta ||= {};
workflow.meta.codexPatch = {
  name: 'livia-frame-picker-mktemp',
  appliedAt: new Date().toISOString(),
  notes: [
    'Uses a unique mktemp Python script for frame picker execution.',
    'Adds trap cleanup for the temporary frame picker script.',
    'Preserves frame analysis behavior and fallback path.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2));

console.log(JSON.stringify({
  outputPath,
  nodes: workflow.nodes.length,
  usesMktemp: command.includes('mktemp -t livia_frame_picker'),
  usesTrapCleanup: command.includes("trap 'rm -f \"$FRAME_PICKER\"' EXIT"),
  hasFixedTmpFramePicker: command.includes('/tmp/frame_picker.py'),
}, null, 2));
