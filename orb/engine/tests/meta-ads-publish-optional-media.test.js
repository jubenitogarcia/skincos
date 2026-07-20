'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const CODE_SOURCES = require('../scripts/meta-ads-publish-code-sources');
const {
  applyGraphContract,
  validateGraphContract,
} = require('../scripts/meta-ads-publish-graph-contract');
const {
  DESIRED: TASK_RUNNER_HEALTH_ENV,
  render: renderTaskRunnerHealthEnv,
  summary: summarizeTaskRunnerHealthEnv,
} = require('../scripts/configure-task-runner-health');

const sourceRoot = path.join(__dirname, '..', 'workflow-src', 'meta-ads-publish');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function item(json, binary = {}) {
  return { json, binary };
}

async function runCode(fileName, { input = [], itemsByNode = {}, dollarItems = {} } = {}) {
  const code = fs.readFileSync(path.join(sourceRoot, fileName), 'utf8');
  const execute = new AsyncFunction('$input', '$items', '$', code);
  return execute(
    { all: () => input },
    (name) => itemsByNode[name] || [],
    (name) => ({ all: () => dollarItems[name] || itemsByNode[name] || [] }),
  );
}

function destination(accountId = '100') {
  return { destination_ad_account_id: accountId, token_id: 'token', destination_api_version: 'v25.0' };
}

function mediaGroup({ jobKey, groupKey, images = 0, videos = 0, mediaMode, accounts = ['100'] }) {
  return item({
    job_key: jobKey,
    group_key: groupKey,
    media_mode: mediaMode,
    imagens: Array.from({ length: images }, (_, index) => ({ id: `${jobKey}-image-${index}`, proporcao: ['3x4', '2x1', '9x16'][index] || '3x4' })),
    videos: Array.from({ length: videos }, (_, index) => ({ id: `${jobKey}-video-${index}` })),
    destinations: accounts.map(destination),
  });
}

function imageReceipt(jobKey, sourceFileId, uploadKind = 'image', accountId = '100') {
  return item({
    job_key: jobKey,
    account_id: accountId,
    _gateway_account_id: accountId,
    source_file_id: sourceFileId,
    upload_kind: uploadKind,
    images: { [`${sourceFileId}.jpg`]: { hash: `hash-${sourceFileId}` } },
  });
}

function videoReceipt(jobKey, sourceFileId, accountId = '100', ready = true) {
  return item({
    job_key: jobKey,
    account_id: accountId,
    _gateway_account_id: accountId,
    source_file_id: sourceFileId,
    upload_kind: 'video',
    video_id: `video-${sourceFileId}`,
    video_status: ready ? 'ready' : 'processing',
    ready,
  });
}

function ai(jobKey, groupKey) {
  return item({
    output: {
      job_key: jobKey,
      group_key: groupKey,
      creative_override: {
        bodies: Array.from({ length: 5 }, (_, index) => ({ text: `body ${index}` })),
        titles: Array.from({ length: 5 }, (_, index) => ({ text: `title ${index}` })),
        descriptions: [{ text: 'description' }],
      },
    },
  });
}

test('static-only media emits an explicit no-video result and assembles one deterministic job', async () => {
  const group = mediaGroup({ jobKey: 'STATIC', groupKey: 'GROUP_STATIC', images: 3, videos: 0, mediaMode: 'static_only' });
  const [planned] = await runCode('prepare-media-upload-plan.js', { input: [group] });
  assert.deepEqual(planned.json.media_upload_plan.expected, {
    images: 3,
    videos: 0,
    static_images: 3,
    video_thumbnails: 0,
  });

  const [noVideo] = await runCode('emit-no-video-upload.js', { input: [planned] });
  const receipts = planned.json.imagens.map((media) => imageReceipt('STATIC', media.id));
  const [envelope] = await runCode('aggregate-media-upload-results.js', {
    input: [...receipts, noVideo],
    itemsByNode: { 'Prepare Media Upload Plan': [planned] },
  });
  assert.equal(envelope.json.ready, true);
  assert.deepEqual(envelope.json.completed, { images: 3, videos: 0 });
  assert.deepEqual(envelope.json.skipped, { images: false, videos: true });

  const [assembled] = await runCode('assemble-job-inputs.js', {
    input: [ai('STATIC', 'GROUP_STATIC'), envelope],
    itemsByNode: { 'Build Payload': [group] },
  });
  assert.equal(assembled.json.job_key, 'STATIC');
  assert.equal(assembled.json.media_upload_envelope.ready, true);
  assert.equal(assembled.json.assembly_diagnostics.ai_correlated, true);
});

test('mixed and video-only groups count video thumbnails as image gateway operations', async () => {
  const mixed = mediaGroup({ jobKey: 'MIXED', groupKey: 'GROUP_MIXED', images: 3, videos: 1, mediaMode: 'mixed' });
  const videoOnly = mediaGroup({ jobKey: 'VIDEO', groupKey: 'GROUP_VIDEO', images: 0, videos: 1, mediaMode: 'video_only' });
  const planned = await runCode('prepare-media-upload-plan.js', { input: [mixed, videoOnly] });
  assert.equal(planned[0].json.media_upload_plan.expected.images, 4);
  assert.equal(planned[0].json.media_upload_plan.expected.videos, 1);
  assert.equal(planned[1].json.media_upload_plan.expected.images, 1);
  assert.equal(planned[1].json.media_upload_plan.expected.videos, 1);
});

test('multiple media modes aggregate independently in the same batch', async () => {
  const staticGroup = mediaGroup({ jobKey: 'A', groupKey: 'GA', images: 3, mediaMode: 'static_only' });
  const mixedGroup = mediaGroup({ jobKey: 'B', groupKey: 'GB', images: 3, videos: 1, mediaMode: 'mixed' });
  const plans = await runCode('prepare-media-upload-plan.js', { input: [staticGroup, mixedGroup] });
  const [noVideo] = await runCode('emit-no-video-upload.js', { input: [plans[0]] });
  const receipts = [
    ...plans[0].json.imagens.map((media) => imageReceipt('A', media.id)),
    noVideo,
    ...plans[1].json.imagens.map((media) => imageReceipt('B', media.id)),
    imageReceipt('B', plans[1].json.videos[0].id, 'video_thumbnail'),
    videoReceipt('B', plans[1].json.videos[0].id),
  ];
  const envelopes = await runCode('aggregate-media-upload-results.js', {
    input: receipts,
    itemsByNode: { 'Prepare Media Upload Plan': plans },
  });
  assert.deepEqual(envelopes.map((entry) => entry.json.completed), [
    { images: 3, videos: 0 },
    { images: 4, videos: 1 },
  ]);
});

test('missing, duplicate, or non-ready uploads fail closed', async () => {
  const group = mediaGroup({ jobKey: 'FAIL', groupKey: 'GF', images: 1, videos: 1, mediaMode: 'mixed' });
  const plans = await runCode('prepare-media-upload-plan.js', { input: [group] });
  const image = imageReceipt('FAIL', group.json.imagens[0].id);
  const thumb = imageReceipt('FAIL', group.json.videos[0].id, 'video_thumbnail');
  await assert.rejects(
    runCode('aggregate-media-upload-results.js', {
      input: [image, thumb],
      itemsByNode: { 'Prepare Media Upload Plan': plans },
    }),
    /Uploads incompletos/,
  );
  await assert.rejects(
    runCode('aggregate-media-upload-results.js', {
      input: [image, image, thumb, videoReceipt('FAIL', group.json.videos[0].id)],
      itemsByNode: { 'Prepare Media Upload Plan': plans },
    }),
    /duplicado/,
  );
  await assert.rejects(
    runCode('aggregate-media-upload-results.js', {
      input: [image, thumb, videoReceipt('FAIL', group.json.videos[0].id, '100', false)],
      itemsByNode: { 'Prepare Media Upload Plan': plans },
    }),
    /ainda nao ready/,
  );
});

test('AI response must be unique and correlated by job_key and group_key', async () => {
  const group = mediaGroup({ jobKey: 'AI', groupKey: 'GAI', images: 3, mediaMode: 'static_only' });
  const envelope = item({ media_upload_envelope_version: '2', job_key: 'AI', group_key: 'GAI', ready: true, image_uploads: [], video_uploads: [] });
  await assert.rejects(
    runCode('assemble-job-inputs.js', { input: [envelope], itemsByNode: { 'Build Payload': [group] } }),
    /Resposta Livia ausente/,
  );
  await assert.rejects(
    runCode('assemble-job-inputs.js', { input: [ai('AI', 'GAI'), ai('AI', 'GAI'), envelope], itemsByNode: { 'Build Payload': [group] } }),
    /conflitantes/,
  );
  await assert.rejects(
    runCode('assemble-job-inputs.js', { input: [ai('AI', 'WRONG'), envelope], itemsByNode: { 'Build Payload': [group] } }),
    /group_key da Livia diverge/,
  );
});

test('Build Jobs refuses raw merge items and accepts only assembled v2 inputs', async () => {
  const group = mediaGroup({ jobKey: 'STRICT', groupKey: 'GSTRICT', images: 3, mediaMode: 'static_only' });
  await assert.rejects(
    runCode('build-jobs.js', {
      input: [imageReceipt('STRICT', group.json.imagens[0].id)],
      itemsByNode: {
        'Build Payload': [group],
        'Restore Publish Groups': [],
        'Build Meta API Params From Vault': [],
      },
    }),
    /somente itens produzidos por Assemble Job Inputs v2/,
  );
});

test('graph contract makes optional branches explicit and retries Build Jobs', () => {
  const baseNode = (name, type = 'n8n-nodes-base.noOp') => ({ name, id: name, type, typeVersion: 1, position: [0, 0], parameters: {} });
  const workflow = {
    nodes: [
      baseNode('Build Payload'), baseNode('Prepare Publish Run'), baseNode('Acquire Publish Run'),
      baseNode('Restore Publish Groups'), baseNode('Resume Drive Only?'), baseNode('Build Drive Finalization'),
      baseNode('Prepare Gateway Uploads'), baseNode('Normalize Gateway Upload'), baseNode('Prepare Video Upload Starts'),
      baseNode('Video Ready?'), baseNode('Wait Video Processing'), baseNode('Livia'),
      baseNode('Merge Media Upload Results', 'n8n-nodes-base.merge'), baseNode('Merge (2)', 'n8n-nodes-base.merge'),
      baseNode('Build Jobs', 'n8n-nodes-base.code'), baseNode('Validate Meta Creative Payload'),
    ],
    connections: {
      'Build Payload': { main: [[{ node: 'Prepare Publish Run', type: 'main', index: 0 }]] },
      'Acquire Publish Run': { main: [[{ node: 'Restore Publish Groups', type: 'main', index: 0 }]] },
      'Restore Publish Groups': { main: [[{ node: 'Resume Drive Only?', type: 'main', index: 0 }]] },
      'Build Jobs': { main: [[{ node: 'Validate Meta Creative Payload', type: 'main', index: 0 }]] },
    },
  };
  assert.ok(applyGraphContract(workflow).length > 0);
  assert.deepEqual(validateGraphContract(workflow), []);
  assert.deepEqual(workflow.nodes.find((node) => node.name === 'Merge (2)').parameters, { mode: 'append', numberInputs: 2 });
  assert.equal(workflow.nodes.find((node) => node.name === 'Build Jobs').maxTries, 3);
});

test('task runner health configuration is rendered idempotently without changing unrelated values', () => {
  const before = 'DB_POSTGRESDB_HOST=127.0.0.1\nN8N_RUNNERS_HEALTH_CHECK_SERVER_ENABLED=false\n';
  const rendered = renderTaskRunnerHealthEnv(before);
  assert.deepEqual(summarizeTaskRunnerHealthEnv(rendered), { ok: true, mismatches: [] });
  assert.equal(renderTaskRunnerHealthEnv(rendered), rendered);
  assert.match(rendered, /^DB_POSTGRESDB_HOST=127\.0\.0\.1$/m);
  for (const [key, value] of Object.entries(TASK_RUNNER_HEALTH_ENV)) {
    assert.match(rendered, new RegExp(`^${key}=${value.replaceAll('.', '\\.')}$`, 'm'));
  }
});

test('every canonical Code node source is present', () => {
  for (const fileName of Object.values(CODE_SOURCES)) {
    assert.equal(fs.existsSync(path.join(sourceRoot, fileName)), true, fileName);
  }
});
