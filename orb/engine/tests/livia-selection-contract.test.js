'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { patchWorkflow } = require('../scripts/patch-livia-today-first-selection');

const workflowPath = path.join(__dirname, '..', 'workflows', 'livia', 'livia.current.json');
const FIXED_NOW = Date.parse('2026-08-06T17:00:00-03:00');

function prepareCode() {
  const liveWorkflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const workflow = patchWorkflow(liveWorkflow);
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
  return values.day + values.month + values.year + values.hour + values.minute;
}

function file(prefix, ordinal, extension, mimeType) {
  return {
    id: 'fixture-' + prefix + '-' + ordinal,
    name: prefix + (ordinal > 1 ? ' (' + ordinal + ')' : '') + '.' + extension,
    mimeType,
  };
}

function select(files, nowMs = FIXED_NOW) {
  const run = new Function('$input', '$getWorkflowStaticData', '$execution', '$now', prepareCode() + '\n');
  const originalNow = Date.now;
  Date.now = () => nowMs;
  try {
    return run(
      { all: () => files.map((json) => ({ json })) },
      () => ({}),
      { id: 'livia-selection-contract-test' },
      { toMillis: () => nowMs },
    );
  } finally {
    Date.now = originalNow;
  }
}

test('selects the earliest due group from today and holds a later video group', () => {
  const carouselPrefix = prefixFor(new Date('2026-08-06T08:30:00-03:00'));
  const videoPrefix = prefixFor(new Date('2026-08-06T16:00:00-03:00'));
  const carousel = Array.from({ length: 6 }, (_, index) => file(carouselPrefix, index + 1, 'png', 'image/png'));
  const output = select(carousel.concat([file(videoPrefix, 1, 'mp4', 'video/mp4')]));

  assert.equal(output.length, 6);
  assert.deepEqual(output.map((item) => item.json.postPrefix), Array(6).fill(carouselPrefix));
  assert.equal(output[0].json.quantity, 6);
  assert.equal(output[0].json.media_type, 'CAROUSEL');
  assert.equal(output[0].json.media_type_instagram, 'CAROUSEL');
  assert.deepEqual(output.map((item) => item.json.groupOrder), [0, 1, 2, 3, 4, 5]);
  assert.equal(output.some((item) => item.json.postPrefix === videoPrefix), false);
});

test('discards yesterday and keeps a future group as a safe no-op', () => {
  const yesterdayPrefix = prefixFor(new Date('2026-08-05T08:00:00-03:00'));
  const futurePrefix = prefixFor(new Date('2026-08-06T18:00:00-03:00'));
  const output = select([
    file(yesterdayPrefix, 1, 'png', 'image/png'),
    file(futurePrefix, 1, 'mp4', 'video/mp4'),
  ]);

  assert.deepEqual(output, []);
});

test('continues to process one eligible video from today', () => {
  const prefix = prefixFor(new Date('2026-08-06T09:15:00-03:00'));
  const output = select([file(prefix, 1, 'mp4', 'video/mp4')]);

  assert.equal(output.length, 1);
  assert.equal(output[0].json.postPrefix, prefix);
  assert.equal(output[0].json.media_type, 'VIDEO');
  assert.equal(output[0].json.media_type_instagram, 'REELS');
  assert.equal(output[0].json.quantity, 1);
});

test('keeps every file with the same postPrefix in one group', () => {
  const prefix = prefixFor(new Date('2026-08-06T10:00:00-03:00'));
  const files = Array.from({ length: 6 }, (_, index) => file(prefix, index + 1, 'png', 'image/png'));
  const output = select(files);

  assert.equal(output.length, files.length);
  assert.deepEqual(
    output.map((item) => item.json.id).sort(),
    files.map((item) => item.id).sort(),
  );
  assert.deepEqual(output.map((item) => item.json.groupKey), Array(6).fill('dt:' + prefix));
  assert.deepEqual(output.map((item) => item.json.quantity), Array(6).fill(6));
});

test('does not publish a group whose time is still in the future', () => {
  const prefix = prefixFor(new Date('2026-08-06T18:00:00-03:00'));
  const output = select(Array.from({ length: 6 }, (_, index) => file(prefix, index + 1, 'png', 'image/png')));

  assert.deepEqual(output, []);
});
