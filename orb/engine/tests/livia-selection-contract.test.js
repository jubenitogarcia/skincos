'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.join(__dirname, '..', 'workflows', 'livia', 'livia.current.json');

function prepareCode() {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const node = workflow.nodes.find((candidate) => candidate?.name === 'Prepare Media Items');
  assert.ok(node?.parameters?.jsCode, 'Prepare Media Items must contain executable selection code.');
  return node.parameters.jsCode;
}

function prefixFor(date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.day}${values.month}${values.year}${values.hour}${values.minute}`;
}

function file(prefix, ordinal, extension, mimeType) {
  return {
    id: `fixture-${prefix}-${ordinal}`,
    name: `${prefix}${ordinal > 1 ? ` (${ordinal})` : ''}.${extension}`,
    mimeType,
  };
}

function select(files) {
  const run = new Function('$input', '$getWorkflowStaticData', '$execution', '$now', `${prepareCode()}\n`);
  return run(
    { all: () => files.map((json) => ({ json })) },
    () => ({}),
    { id: 'livia-selection-contract-test' },
    { toMillis: () => Date.now() },
  );
}

test('selects a due six-image carousel without changing its group contract', () => {
  const prefix = prefixFor(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const output = select(Array.from({ length: 6 }, (_, index) => file(prefix, index + 1, 'png', 'image/png')));

  assert.equal(output.length, 6);
  assert.equal(output[0].json.quantity, 6);
  assert.equal(output[0].json.media_type, 'CAROUSEL');
  assert.equal(output[0].json.media_type_instagram, 'CAROUSEL');
  assert.deepEqual(output.map((item) => item.json.groupOrder), [0, 1, 2, 3, 4, 5]);
});

test('keeps a future group as a safe no-op instead of publishing early', () => {
  const prefix = prefixFor(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const output = select(Array.from({ length: 6 }, (_, index) => file(prefix, index + 1, 'png', 'image/png')));

  assert.deepEqual(output, []);
});

test('preserves single-image posts and single-video reels', () => {
  const prefix = prefixFor(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const image = select([file(prefix, 1, 'png', 'image/png')]);
  const video = select([file(prefix, 1, 'mp4', 'video/mp4')]);

  assert.equal(image.length, 1);
  assert.equal(image[0].json.media_type, 'IMAGE');
  assert.equal(image[0].json.media_type_instagram, 'IMAGE');
  assert.equal(video.length, 1);
  assert.equal(video[0].json.media_type, 'VIDEO');
  assert.equal(video[0].json.media_type_instagram, 'REELS');
});
