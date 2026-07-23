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
  applyOfferFingerprintContract,
  validateOfferFingerprintContract,
} = require('../scripts/meta-ads-publish-offer-fingerprint-contract');
const {
  applyAgentContract,
  validateAgentContract,
} = require('../scripts/meta-ads-publish-agent-contract');
const {
  DESIRED: TASK_RUNNER_HEALTH_ENV,
  render: renderTaskRunnerHealthEnv,
  summary: summarizeTaskRunnerHealthEnv,
} = require('../scripts/configure-task-runner-health');

const sourceRoot = path.join(__dirname, '..', 'workflow-src', 'meta-ads-publish');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('canonical video processor safely normalizes near-9:16 portrait video without cropping foreground content', () => {
  const processor = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'meta-ads', 'process-video-asset.js'), 'utf8');
  assert.match(processor, /MAX_CANVAS_PADDING_FRACTION = 0\.12/);
  assert.match(processor, /blurred_background_padding/);
  assert.match(processor, /content_crop: false/);
  assert.match(processor, /video_ratio_not_compatible_with_9x16_canvas/);
});

function item(json, binary = {}) {
  return { json, binary };
}

async function runCode(fileName, { input = [], itemsByNode = {}, dollarItems = {} } = {}) {
  const code = fs.readFileSync(path.join(sourceRoot, fileName), 'utf8');
  const execute = new AsyncFunction('$input', '$items', '$', code);
  return execute(
    { all: () => input, first: () => input[0] },
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
        descriptions: Array.from({ length: 5 }, (_, index) => ({ text: `description ${index}` })),
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

test('video upload start key is stable for replays and changes with its request contract', async () => {
  const source = item({
    run_id: 'RUN_1',
    job_key: 'MIXED',
    videos: [{ id: 'video-drive-id', original_name: 'vertical.mp4' }],
    media_inventory: [{
      source_file_id: 'video-drive-id',
      media_processing: {
        output_bytes: 1024,
        normalized_file: '/tmp/video.mp4',
        output_checksum_sha256: 'a'.repeat(64),
        width: 1080,
        height: 1920,
      },
    }],
    destinations: [{ destination_ad_account_id: '100', token_id: 'token-a', destination_api_version: 'v25.0' }],
  });
  const [first] = await runCode('prepare-video-upload-starts.js', { input: [source] });
  const [replay] = await runCode('prepare-video-upload-starts.js', { input: [source] });
  const changedToken = item({
    ...source.json,
    destinations: [{ destination_ad_account_id: '100', token_id: 'token-b', destination_api_version: 'v25.0' }],
  });
  const [changed] = await runCode('prepare-video-upload-starts.js', { input: [changedToken] });

  assert.match(first.json.gateway_request.operation_key, /^video-start:v4:[a-z0-9]+$/);
  assert.equal(replay.json.gateway_request.operation_key, first.json.gateway_request.operation_key);
  assert.notEqual(changed.json.gateway_request.operation_key, first.json.gateway_request.operation_key);

  const changedNormalizedBytes = item({
    ...source.json,
    media_inventory: [{
      ...source.json.media_inventory[0],
      media_processing: {
        ...source.json.media_inventory[0].media_processing,
        output_bytes: 2048,
        output_checksum_sha256: 'b'.repeat(64),
      },
    }],
  });
  const [sameSourceReplay] = await runCode('prepare-video-upload-starts.js', { input: [changedNormalizedBytes] });
  assert.equal(sameSourceReplay.json.gateway_request.operation_key, first.json.gateway_request.operation_key);

  const duplicateAccount = item({
    ...source.json,
    destinations: [
      ...source.json.destinations,
      { destination_ad_account_id: '100', token_id: 'token-b', destination_api_version: 'v25.0' },
    ],
  });
  const deduplicated = await runCode('prepare-video-upload-starts.js', { input: [duplicateAccount] });
  assert.equal(deduplicated.length, 1, 'same Meta account receives one video upload regardless of destination count');

  const horizontal = item({
    ...source.json,
    media_inventory: [{
      ...source.json.media_inventory[0],
      media_processing: { ...source.json.media_inventory[0].media_processing, width: 1920, height: 1080 },
    }],
  });
  await assert.rejects(
    runCode('prepare-video-upload-starts.js', { input: [horizontal] }),
    /nao esta em 9:16/,
  );
});

test('video processing and Meta-ready status prove the rewarded-video asset is 9:16', async () => {
  const source = item({ media_staging: { output_dir: '/tmp/video' } });
  const processing = {
    ok: true, normalized_file: '/tmp/video/video.mp4', contact_sheet_file: '/tmp/video/contact.jpg', thumbnail_file: '/tmp/video/thumb.jpg',
    width: 1080, height: 1920, has_audio: false,
  };
  const [parsed] = await runCode('parse-processed-video.js', {
    input: [item({ exitCode: 0, stdout: JSON.stringify(processing) })],
    itemsByNode: { 'Write Video Source': [source] },
  });
  assert.equal(parsed.json.media_processing.recommended_aspect_ratio, '9x16');

  await assert.rejects(
    runCode('parse-processed-video.js', {
      input: [item({ exitCode: 0, stdout: JSON.stringify({ ...processing, width: 1920, height: 1080 }) })],
      itemsByNode: { 'Write Video Source': [source] },
    }),
    /precisa ser 9:16/,
  );

  const [ready] = await runCode('normalize-video-status.js', {
    input: [item({ ok: true, operation: { status: 'completed', result: { id: '123', video_status: 'ready', ready: true, thumbnails: { data: [{ is_preferred: true, width: 1080, height: 1920 }] } } } })],
    itemsByNode: { 'Prepare Video Status': [item({ video_id: '123', video_width: 1080, video_height: 1920 })] },
  });
  assert.equal(ready.json.preferred_thumbnail_aspect_ratio, '9x16');

  await assert.rejects(
    runCode('normalize-video-status.js', {
      input: [item({ ok: true, operation: { status: 'completed', result: { id: '123', video_status: 'ready', ready: true, thumbnails: { data: [{ is_preferred: true, width: 1920, height: 1080 }] } } } })],
      itemsByNode: { 'Prepare Video Status': [item({ video_id: '123', video_width: 1080, video_height: 1920 })] },
    }),
    /precisa permanecer em 9:16/,
  );
});

test('semantic video replay carries the verified video id through chunk and finish operations', async () => {
  const prepared = item({
    run_id: 'RUN', account_id: '100', token_id: 'token', api_version: 'v25.0',
    source_file_id: 'drive-video', source_file_name: 'video.mov', checksum_sha256: 'a'.repeat(64), file_size: 100,
  });
  const [started] = await runCode('normalize-video-upload-start.js', {
    input: [item({
      ok: true, replayed: true, semantic_replay: true,
      operation: { operation_key: 'old-start', status: 'completed', result: {
        upload_session_id: '987654321', video_id: '123456789', start_offset: 0, end_offset: 100,
      } },
    })],
    itemsByNode: { 'Prepare Video Upload Starts': [prepared] },
  });
  assert.equal(started.json.semantic_replay_video_id, '123456789');
  assert.equal(started.json.start_offset, 100);
  assert.equal(started.json.end_offset, 100);
  assert.equal(started.json.semantic_replay_ready, true);
  assert.equal(started.json.upload_bytes_complete, true);
  const [finish] = await runCode('prepare-video-finish.js', {
    input: [item({ ...started.json, start_offset: 100, end_offset: 100 })],
  });
  assert.equal(finish.json.gateway_request.semantic_replay_video_id, '123456789');
});

test('image upload keys distinguish the gateway request contract while preserving exact replays', async () => {
  const source = item({
    run_id: 'RUN_1',
    job_key: 'MIXED',
    imagens: [{ id: 'image-drive-id', binary_key: 'data', proporcao: '3x4', original_name: 'feed.jpg' }],
    videos: [],
    destinations: [{ destination_ad_account_id: '100', token_id: 'token-a', destination_api_version: 'v25.0' }],
  }, { data: { fileName: 'feed.jpg', fileSize: '1024', mimeType: 'image/jpeg' } });
  const [first] = await runCode('prepare-gateway-uploads.js', { input: [source] });
  const [replay] = await runCode('prepare-gateway-uploads.js', { input: [source] });
  const changedToken = item({
    ...source.json,
    destinations: [{ destination_ad_account_id: '100', token_id: 'token-b', destination_api_version: 'v25.0' }],
  }, source.binary);
  const [changed] = await runCode('prepare-gateway-uploads.js', { input: [changedToken] });

  assert.match(first.json.gateway_request.operation_key, /^upload:v3:[a-z0-9]+$/);
  assert.equal(replay.json.gateway_request.operation_key, first.json.gateway_request.operation_key);
  assert.notEqual(changed.json.gateway_request.operation_key, first.json.gateway_request.operation_key);
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
  const [deduped] = await runCode('aggregate-media-upload-results.js', {
    input: [image, thumb, videoReceipt('FAIL', group.json.videos[0].id), videoReceipt('FAIL', group.json.videos[0].id)],
    itemsByNode: { 'Prepare Media Upload Plan': plans },
  });
  assert.deepEqual(deduped.json.completed, { images: 2, videos: 1 });
  await assert.rejects(
    runCode('aggregate-media-upload-results.js', {
      input: [image, thumb, videoReceipt('FAIL', group.json.videos[0].id), item({ ...videoReceipt('FAIL', group.json.videos[0].id).json, video_id: 'different-video' })],
      itemsByNode: { 'Prepare Media Upload Plan': plans },
    }),
    /duplicado/,
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

test('visual grouping normalizes a proven commercial offer into one deterministic replacement tag', async () => {
  const prepared = item({
    visual_grouping_batch_version: '1',
    media: [
      { media_ref: 'IMG_001', media_type: 'image', source_item_index: 0, source_file_id: 'drive-a' },
      { media_ref: 'IMG_002', media_type: 'image', source_item_index: 1, source_file_id: 'drive-b' },
      { media_ref: 'IMG_003', media_type: 'image', source_item_index: 2, source_file_id: 'drive-c' },
    ],
  });
  const originals = ['a', 'b', 'c'].map((suffix) => item({ id: `drive-${suffix}` }, { data: { mimeType: 'image/jpeg' } }));
  const agentOutput = item({
    groups: [{
      group_key: 'VISUAL_GROUP_01', visual_concept: 'combo facial', confidence: 0.97, evidence: ['botox e preenchimento visiveis'],
      offer_fingerprint: {
        confidence: 0.97,
        procedures: [
          { key: 'botox', quantity: '40', unit: 'UI' },
          { key: 'preenchimento labial', quantity: '1', unit: 'ml' },
        ],
        price_amount_cents: 99800, price_qualifier: 'fixed', payment_terms: ['12x'],
        condition_terms: ['combo'], validity: 'julho', evidence: ['Botox 40 UI + preenchimento labial 1 ml por R$ 998'],
      },
    }],
    assignments: [
      { media_ref: 'IMG_001', media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '3x4', role: 'feed', confidence: 0.97, evidence: ['mesma modelo e oferta'] },
      { media_ref: 'IMG_002', media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '2x1', role: 'banner', confidence: 0.97, evidence: ['mesmo tratamento e preco'] },
      { media_ref: 'IMG_003', media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '9x16', role: 'stories', confidence: 0.97, evidence: ['mesma chamada comercial'] },
    ],
  });
  const output = await runCode('validate-visual-grouping.js', {
    input: [agentOutput],
    itemsByNode: {
      'Prepare Visual Grouping Batch': [prepared],
      'Prepare Media Inventory': originals,
    },
  });
  const fingerprints = output.map((entry) => entry.json.visual_grouping.offer_fingerprint);
  assert.equal(fingerprints.every((entry) => entry.replacement_eligible), true);
  assert.match(fingerprints[0].tag, /^\[OFV1:[A-Z0-9]+\]$/);
  assert.equal(new Set(fingerprints.map((entry) => entry.tag)).size, 1);
});

test('visual grouping keeps an ambiguous offer publishable but marks it non-replaceable', async () => {
  const prepared = item({
    visual_grouping_batch_version: '1',
    media: [
      { media_ref: 'IMG_001', media_type: 'image', source_item_index: 0, source_file_id: 'drive-a' },
      { media_ref: 'IMG_002', media_type: 'image', source_item_index: 1, source_file_id: 'drive-b' },
      { media_ref: 'IMG_003', media_type: 'image', source_item_index: 2, source_file_id: 'drive-c' },
    ],
  });
  const originals = ['a', 'b', 'c'].map((suffix) => item({ id: `drive-${suffix}` }, { data: { mimeType: 'image/jpeg' } }));
  const output = await runCode('validate-visual-grouping.js', {
    input: [item({
      groups: [{
        group_key: 'VISUAL_GROUP_01', visual_concept: 'procedimento', confidence: 0.9, evidence: ['procedimento visivel'],
        offer_fingerprint: { confidence: 0.8, procedures: [{ key: 'botox', quantity: '', unit: '' }], price_amount_cents: 0, price_qualifier: 'unknown', payment_terms: [], condition_terms: [], validity: '', evidence: ['botox'] },
      }],
      assignments: [
        { media_ref: 'IMG_001', media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '3x4', role: 'feed', confidence: 0.9, evidence: ['procedimento'] },
        { media_ref: 'IMG_002', media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '2x1', role: 'banner', confidence: 0.9, evidence: ['procedimento'] },
        { media_ref: 'IMG_003', media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '9x16', role: 'stories', confidence: 0.9, evidence: ['procedimento'] },
      ],
    })],
    itemsByNode: { 'Prepare Visual Grouping Batch': [prepared], 'Prepare Media Inventory': originals },
  });
  assert.equal(output[0].json.visual_grouping.offer_fingerprint.status, 'unverified');
  assert.equal(output[0].json.visual_grouping.offer_fingerprint.replacement_eligible, false);
});

test('visual grouping normalizes a model role typo from immutable media type and ratio', async () => {
  const prepared = item({
    visual_grouping_batch_version: '2',
    media: [
      { media_ref: 'MEDIA_001', media_type: 'image', source_item_index: 0, source_file_id: 'drive-media-001' },
      { media_ref: 'MEDIA_002', media_type: 'image', source_item_index: 1, source_file_id: 'drive-media-002' },
      { media_ref: 'MEDIA_003', media_type: 'image', source_item_index: 2, source_file_id: 'drive-media-003' },
      { media_ref: 'MEDIA_004', media_type: 'video', source_item_index: 3, source_file_id: 'drive-media-004' },
    ],
  });
  const originals = [
    item({ id: 'drive-media-001' }, { data: { mimeType: 'image/jpeg' } }),
    item({ id: 'drive-media-002' }, { data: { mimeType: 'image/jpeg' } }),
    item({ id: 'drive-media-003' }, { data: { mimeType: 'image/jpeg' } }),
    item({ id: 'drive-media-004' }, { data: { mimeType: 'video/mp4' }, thumbnail: {}, analysis: {} }),
  ];
  const agent = item({
    groups: [{ group_key: 'VISUAL_GROUP_01', visual_concept: 'oferta', confidence: 0.9, evidence: ['mesma oferta'], offer_fingerprint: { confidence: 0.8, procedures: [{ key: 'botox', quantity: '', unit: '' }], evidence: ['botox'] } }],
    assignments: [
      { media_ref: 'MEDIA_001', media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '2x1', role: 'feed_image', confidence: 0.9, evidence: ['mesma oferta'] },
      { media_ref: 'MEDIA_002', media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '3x4', role: 'feed_image', confidence: 0.9, evidence: ['mesma oferta'] },
      { media_ref: 'MEDIA_003', media_type: 'image', group_key: 'VISUAL_GROUP_01', ratio: '9x16', role: 'vertical_image', confidence: 0.9, evidence: ['mesma oferta'] },
      { media_ref: 'MEDIA_004', media_type: 'video', group_key: 'VISUAL_GROUP_01', ratio: '9x16', role: 'vertical_video', confidence: 0.9, evidence: ['mesma oferta'] },
    ],
  });
  const output = await runCode('validate-visual-grouping.js', {
    input: [agent],
    itemsByNode: { 'Prepare Visual Grouping Batch': [prepared], 'Prepare Media Inventory': originals },
  });
  assert.equal(output[0].json.visual_grouping.role, 'banner_image');
  assert.equal(output[0].json.visual_grouping.media_mode, 'mixed_group');
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

test('mixed groups stage one physical ad per destination, without static/video expansion', async () => {
  const prefix = 'Nome de anuncio muito longo '.repeat(12);
  const makeJob = (destinationGroup, adsetId) => item({
    run_id: 'RUN_STAGE',
    job_key: `JOB_${destinationGroup}`,
    media_variant: 'mixed_flexible',
    action: 'create_new',
    destination_adset_id: adsetId,
    creative_group_key: 'GROUP',
    destination_group: destinationGroup,
    creative_id: `creative-${destinationGroup}`,
    token_id: 'token', account_id: '100', api_version: 'v25.0',
    adPayload: { name: `${prefix} [OFV1:TAG] ${destinationGroup}`, status: 'ACTIVE', adset_id: adsetId },
    asset_ids: {}, asset_names: {},
  });
  const [batch] = await runCode('build-stage-batch.js', { input: [makeJob('BSS', '300'), makeJob('NH', '301')] });
  assert.equal(batch.json.job_count, 2);
  assert.deepEqual(batch.json.gateway_request.jobs.map((job) => job.media_variant), ['mixed_flexible', 'mixed_flexible']);
  assert.deepEqual(batch.json.gateway_request.jobs.map((job) => job.desired_status), ['ACTIVE', 'ACTIVE']);
  assert.equal(new Set(batch.json.gateway_request.jobs.map((job) => job.operation_key)).size, 2);
});

test('explicit video-only calibration stays paused through stage preparation', async () => {
  const source = item({
    run_id: 'RUN_CALIBRATION', job_key: 'JOB_CALIBRATION', media_variant: 'video_single',
    action: 'create_new', destination_adset_id: '300', creative_group_key: 'GROUP',
    destination_group: 'BSS', creative_id: 'creative-calibration', token_id: 'token',
    account_id: '100', api_version: 'v25.0', desired_final_status: 'PAUSED',
    calibration_mode: true,
    adPayload: { name: '[TEST-VIDEO-ONLY] Oferta BSS', status: 'PAUSED', adset_id: '300' },
    asset_ids: {}, asset_names: {},
  });
  const [batch] = await runCode('build-stage-batch.js', { input: [source] });
  const [job] = batch.json.gateway_request.jobs;
  assert.equal(job.desired_status, 'PAUSED');
  assert.equal(job.ad_payload.status, 'PAUSED');
  assert.match(job.ad_payload.name, /^\[TEST-VIDEO-ONLY\]/);
});

function mixedCreativeFixture() {
  const feedLabel = { name: 'feed_image' };
  const bannerLabel = { name: 'banner_image' };
  const verticalLabel = { name: 'vertical_image' };
  const videoLabel = { name: 'vertical_video' };
  const bodyLabels = [{ name: 'body_feed' }, { name: 'body_banner' }, { name: 'body_vertical' }];
  const titleLabels = [{ name: 'title_feed' }, { name: 'title_banner' }, { name: 'title_vertical' }];
  const descriptionLabels = Array.from({ length: 5 }, (_, index) => ({ name: `description_${index}` }));
  const features = Object.fromEntries([
    'add_text_overlay', 'image_touchups', 'text_optimizations', 'inline_comment',
    'enhance_cta', 'image_brightness_and_contrast', 'reveal_details_over_time',
    'show_destination_blurbs', 'image_animation',
  ].map((key) => [key, { enroll_status: 'OPT_IN' }]));
  return item({
    run_id: 'RUN_MIXED', batch_fingerprint: 'BATCH_MIXED', token_id: 'opaque-token',
    account_id: '100', page_id: '200', api_version: 'v25.0', media_variant: 'mixed_flexible',
    video_status: 'ready', action: 'create_new', landing_page_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul',
    video_width: 1080, video_height: 1920, video_aspect_ratio: '9x16', video_recommended_aspect_ratio: '9x16',
    video_thumbnail_width: 1080, video_thumbnail_height: 1920, video_thumbnail_aspect_ratio: '9x16',
    scheduling_landing_page_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul',
    destination_contract: { kind: 'website' }, offer_fingerprint: { status: 'unverified', tag: '', replacement_eligible: false },
    offer_replacement_guard: { reason: 'offer_fingerprint_unverified' },
    adPayload: { name: 'Oferta BSS', status: 'ACTIVE', adset_id: '300' },
    workflow_contract_revision: 'meta_destination_contract_v9',
    advantage_plus_requested_features: [],
    creativePayload: {
      name: 'Oferta BSS', object_story_spec: { page_id: '200' },
      asset_feed_spec: {
        ad_formats: ['AUTOMATIC_FORMAT'], optimization_type: 'PLACEMENT',
        images: [
          { hash: 'feedhash', adlabels: [feedLabel] },
          { hash: 'bannerhash', image_crops: { '191x100': [[0, 0], [1910, 1000]] }, adlabels: [bannerLabel] },
          { hash: 'verticalhash', image_crops: { '90x160': [[0, 0], [900, 1600]] }, adlabels: [verticalLabel] },
        ],
        videos: [{ video_id: '123456789', thumbnail_hash: 'thumbnailhash', adlabels: [videoLabel] }],
        bodies: Array.from({ length: 5 }, (_, index) => ({ text: `body ${index}`, adlabels: bodyLabels })),
        titles: Array.from({ length: 5 }, (_, index) => ({ text: `title ${index}`, adlabels: titleLabels })),
        descriptions: Array.from({ length: 5 }, (_, index) => ({ text: `description ${index}`, adlabels: [descriptionLabels[index]] })),
        link_urls: [{ website_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' }],
        call_to_action_types: ['LEARN_MORE'],
        asset_customization_rules: [
          { customization_spec: { publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['feed', 'marketplace'], instagram_positions: ['stream', 'explore'] }, image_label: feedLabel, body_label: bodyLabels[0], title_label: titleLabels[0], description_label: descriptionLabels[0] },
          { customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['search'] }, image_label: bannerLabel, body_label: bodyLabels[1], title_label: titleLabels[1], description_label: descriptionLabels[1] },
          { customization_spec: { publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'], facebook_positions: ['instream_video', 'story', 'facebook_reels'], instagram_positions: ['story', 'reels'], audience_network_positions: ['classic'], whatsapp_positions: ['status'] }, image_label: verticalLabel, body_label: bodyLabels[2], title_label: titleLabels[2], description_label: descriptionLabels[2] },
          { customization_spec: { publisher_platforms: ['audience_network'], audience_network_positions: ['rewarded_video'] }, video_label: videoLabel, body_label: bodyLabels[2], title_label: titleLabels[2], description_label: descriptionLabels[3] },
        ],
      },
      degrees_of_freedom_spec: { creative_features_spec: features },
      creative_sourcing_spec: {},
    },
  });
}

test('mixed creative validation accepts only the requested static and rewarded-video placement split', async () => {
  const [validated] = await runCode('validate-meta-creative-payload.js', { input: [mixedCreativeFixture()] });
  assert.deepEqual(validated.json.creativePayload.asset_feed_spec.ad_formats, ['AUTOMATIC_FORMAT']);
  assert.equal(validated.json.meta_creative_validation.video_count, 1);
  assert.equal(validated.json.meta_creative_validation.mixed_static_vertical_rule_count, 1);
  assert.equal(validated.json.meta_creative_validation.mixed_video_rewarded_rule_count, 1);
  assert.equal(new Set(validated.json.creativePayload.asset_feed_spec.asset_customization_rules.map((rule) => rule.description_label.name)).size, 4);

  const rejected = mixedCreativeFixture();
  rejected.json.creativePayload.asset_feed_spec.asset_customization_rules[3].customization_spec.audience_network_positions = ['classic'];
  await assert.rejects(
    runCode('validate-meta-creative-payload.js', { input: [rejected] }),
    /mixed_video_rewarded_position_missing/,
  );

  const invalidFormat = mixedCreativeFixture();
  invalidFormat.json.creativePayload.asset_feed_spec.ad_formats = ['SINGLE_IMAGE', 'SINGLE_VIDEO'];
  await assert.rejects(
    runCode('validate-meta-creative-payload.js', { input: [invalidFormat] }),
    /mixed_ad_format_must_be_automatic/,
  );
});

test('Build Jobs keeps a unique description binding on every mixed placement rule', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'build-jobs.js'), 'utf8');
  assert.equal((source.match(/description_label:\s*descriptionRuleLabels\[2\],\s*priority:\s*3/g) || []).length, 2);
  assert.equal((source.match(/description_label:\s*descriptionRuleLabels\[3\],\s*priority:\s*4/g) || []).length, 1);
});

test('Build Jobs labels the mixed 9:16 video for its rewarded-video customization rule', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'build-jobs.js'), 'utf8');
  const mixedPayload = source.match(/const mixedCreativePayload =[\s\S]*?const videoCreativePayload =/);
  assert.ok(mixedPayload, 'mixed creative payload source must exist');
  assert.match(mixedPayload[0], /videos:\s*\[\{[\s\S]*?adlabels:\s*\[videoLabel\]/);
  assert.match(source, /audience_network_positions:\s*VERTICAL_REWARDED_VIDEO_POSITIONS[\s\S]*?video_label:\s*videoLabel/);
});

function videoOnlyCreativeFixture() {
  const requestedFeatures = [
    'add_text_overlay', 'music_generation', 'adapt_to_placement', 'video_filtering',
    'text_optimizations', 'inline_comment', 'enhance_cta', 'reveal_details_over_time',
    'show_destination_blurbs', 'video_highlights',
  ];
  const videoLabel = { name: 'vertical_video' };
  const bodyLabels = Array.from({ length: 5 }, (_, index) => ({ name: `video_body_${index}` }));
  const titleLabels = Array.from({ length: 5 }, (_, index) => ({ name: `video_title_${index}` }));
  const descriptionLabels = Array.from({ length: 5 }, (_, index) => ({ name: `video_description_${index}` }));
  return item({
    run_id: 'RUN_VIDEO', batch_fingerprint: 'BATCH_VIDEO', token_id: 'opaque-token',
    account_id: '100', page_id: '200', api_version: 'v25.0', media_mode: 'video_only', media_variant: 'video_single',
    video_status: 'ready', action: 'create_new', landing_page_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul',
    scheduling_landing_page_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul',
    video_width: 1080, video_height: 1920, video_aspect_ratio: '9x16', video_recommended_aspect_ratio: '9x16',
    video_thumbnail_width: 1080, video_thumbnail_height: 1920, video_thumbnail_aspect_ratio: '9x16',
    destination_contract: { kind: 'website' }, offer_fingerprint: { status: 'unverified', tag: '', replacement_eligible: false },
    offer_replacement_guard: { reason: 'offer_fingerprint_unverified' },
    adPayload: { name: 'Oferta video BSS', status: 'ACTIVE', adset_id: '300' },
    workflow_contract_revision: 'meta_destination_contract_v9',
    advantage_plus_requested_features: requestedFeatures,
    creativePayload: {
      name: 'Oferta video BSS', object_story_spec: { page_id: '200' },
      asset_feed_spec: {
        ad_formats: ['SINGLE_VIDEO'], optimization_type: 'PLACEMENT', images: [],
        videos: [{ video_id: '123456789', thumbnail_hash: 'thumbnailhash', adlabels: [videoLabel] }],
        bodies: Array.from({ length: 5 }, (_, index) => ({ text: `body ${index}`, adlabels: [bodyLabels[index]] })),
        titles: Array.from({ length: 5 }, (_, index) => ({ text: `title ${index}`, adlabels: [titleLabels[index]] })),
        descriptions: Array.from({ length: 5 }, (_, index) => ({ text: `description ${index}`, adlabels: [descriptionLabels[index]] })),
        link_urls: [{ website_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' }],
        call_to_action_types: ['LEARN_MORE'],
        asset_customization_rules: [
          {
            customization_spec: {
              publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'],
              facebook_positions: ['feed', 'instream_video', 'story', 'search', 'facebook_reels', 'facebook_reels_overlay', 'notification'],
              instagram_positions: ['stream', 'story', 'reels'],
              audience_network_positions: ['classic'],
              whatsapp_positions: ['status'],
            },
            video_label: videoLabel,
            body_label: bodyLabels[0], title_label: titleLabels[0], description_label: descriptionLabels[0],
            priority: 1,
          },
          {
            customization_spec: {
              publisher_platforms: ['audience_network'],
              audience_network_positions: ['rewarded_video'],
            },
            video_label: videoLabel,
            body_label: bodyLabels[1], title_label: titleLabels[1], description_label: descriptionLabels[1],
            priority: 2,
          },
        ],
      },
      degrees_of_freedom_spec: {
        creative_features_spec: Object.fromEntries(requestedFeatures.map((feature) => [feature, { enroll_status: 'OPT_IN' }])),
      },
    },
  });
}

test('video-only creative uses two labelled 9:16 rules across every enabled placement', async () => {
  const [validated] = await runCode('validate-meta-creative-payload.js', { input: [videoOnlyCreativeFixture()] });
  const feed = validated.json.creativePayload.asset_feed_spec;
  assert.equal(feed.videos.length, 1);
  assert.equal(feed.bodies.length, 5);
  assert.equal(feed.titles.length, 5);
  assert.equal(feed.descriptions.length, 5);
  assert.equal(validated.json.meta_creative_validation.video_only_placement_rule_count, 2);
  assert.equal(validated.json.meta_creative_validation.video_delivery_aspect_ratio, '9x16');
  assert.equal(validated.json.creativePayload.object_story_spec.video_data, undefined);

  const customized = videoOnlyCreativeFixture();
  customized.json.creativePayload.asset_feed_spec.asset_customization_rules[0].customization_spec.facebook_positions = ['feed'];
  await assert.rejects(
    runCode('validate-meta-creative-payload.js', { input: [customized] }),
    /video_only_facebook_positions_incomplete/,
  );

  const labelledDescription = videoOnlyCreativeFixture();
  labelledDescription.json.creativePayload.asset_feed_spec.descriptions[4].adlabels = [];
  await assert.rejects(
    runCode('validate-meta-creative-payload.js', { input: [labelledDescription] }),
    /video_only_description_labels_invalid/,
  );

  const missingVideoLabel = videoOnlyCreativeFixture();
  missingVideoLabel.json.creativePayload.asset_feed_spec.videos[0].adlabels = [];
  await assert.rejects(
    runCode('validate-meta-creative-payload.js', { input: [missingVideoLabel] }),
    /video_only_video_label_invalid/,
  );

  const duplicateRule = videoOnlyCreativeFixture();
  duplicateRule.json.creativePayload.asset_feed_spec.asset_customization_rules.push(structuredClone(duplicateRule.json.creativePayload.asset_feed_spec.asset_customization_rules[0]));
  await assert.rejects(
    runCode('validate-meta-creative-payload.js', { input: [duplicateRule] }),
    /video_only_placement_rule_count_invalid/,
  );

  const calibration = videoOnlyCreativeFixture();
  calibration.json.calibration_mode = true;
  calibration.json.desired_final_status = 'PAUSED';
  calibration.json.adPayload.status = 'PAUSED';
  calibration.json.adPayload.name = '[TEST-VIDEO-ONLY] Oferta video BSS';
  const [validatedCalibration] = await runCode('validate-meta-creative-payload.js', { input: [calibration] });
  assert.equal(validatedCalibration.json.meta_creative_validation.ad_status, 'PAUSED');
  assert.equal(validatedCalibration.json.meta_creative_validation.calibration_mode, true);

  const unsafePaused = videoOnlyCreativeFixture();
  unsafePaused.json.adPayload.status = 'PAUSED';
  await assert.rejects(
    runCode('validate-meta-creative-payload.js', { input: [unsafePaused] }),
    /ad_publish_status_invalid/,
  );
});

test('video-only creative readback preserves one video, five copy variants, and placement scope', async () => {
  const fixture = videoOnlyCreativeFixture().json;
  const source = item({
    ...fixture,
    creative_id: '987654321', destination_group: 'BSS', destination_adset_id: '300',
    advantage_plus_skipped_features: ['video_auto_crop', 'video_uncrop'],
    advantage_plus_feature_groups: { main: [], essential: [], supplemental: [] }, warnings: [],
  });
  const readback = { id: '987654321', ...fixture.creativePayload };
  const placement = item({ placement_checks: [{ destination_group: 'BSS', adset_id: '300', targeting: {
    effective_publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'],
    effective_facebook_positions: ['feed', 'instream_video', 'story', 'search', 'facebook_reels', 'facebook_reels_overlay', 'notification'],
    effective_instagram_positions: ['stream', 'story', 'reels'],
    effective_audience_network_positions: ['classic', 'rewarded_video'],
    effective_whatsapp_positions: ['status'],
  } }] });
  const [verified] = await runCode('attach-advantage-plus-verification.js', {
    input: [item({ ok: true, operation: { status: 'completed', result: readback } })],
    itemsByNode: { 'Attach Creative Result': [source], 'Validate Meta Placement Eligibility': [placement] },
  });
  assert.equal(verified.json.video_only_media_readback.status, 'verified');
  assert.equal(verified.json.video_only_media_readback.video_count, 1);
  assert.equal(verified.json.video_only_media_readback.description_count, 5);
  assert.equal(verified.json.video_only_media_readback.placement_rule_count, 2);

  const missingRewarded = structuredClone(readback);
  missingRewarded.asset_feed_spec.asset_customization_rules[1].customization_spec.audience_network_positions = ['classic'];
  await assert.rejects(
    runCode('attach-advantage-plus-verification.js', {
      input: [item({ ok: true, operation: { status: 'completed', result: missingRewarded } })],
      itemsByNode: { 'Attach Creative Result': [source], 'Validate Meta Placement Eligibility': [placement] },
    }),
    /video_only_readback_rewarded_rule_invalid/,
  );
});

test('creative operation key replays identical payloads and changes after a structural correction', async () => {
  const base = item({
    run_id: 'RUN', job_key: 'JOB', creative_group_key: 'GROUP', destination_group: 'BSS',
    media_variant: 'video_single', token_id: 'token', account_id: '100', api_version: 'v25.0',
    creativePayload: { name: 'creative', asset_feed_spec: { asset_customization_rules: [{ priority: 1 }] } },
  });
  const [first] = await runCode('prepare-creative-operation.js', { input: [base] });
  const [replay] = await runCode('prepare-creative-operation.js', { input: [structuredClone(base)] });
  const changed = structuredClone(base);
  changed.json.creativePayload.asset_feed_spec.asset_customization_rules.push({ priority: 2 });
  const [corrected] = await runCode('prepare-creative-operation.js', { input: [changed] });
  assert.match(first.json.gateway_request.operation_key, /^creative:v2:/);
  assert.equal(replay.json.gateway_request.operation_key, first.json.gateway_request.operation_key);
  assert.notEqual(corrected.json.gateway_request.operation_key, first.json.gateway_request.operation_key);
});

test('creative fallback is reserved for a demonstrated Advantage+ incompatibility', async () => {
  const source = item({
    run_id: 'RUN_FALLBACK', creative_group_key: 'GROUP', destination_group: 'BSS', media_variant: 'mixed_flexible',
    token_id: 'opaque-token', account_id: '100', api_version: 'v25.0', job_key: 'JOB',
    creativePayload: { degrees_of_freedom_spec: { creative_features_spec: { pac_relaxation: { enroll_status: 'OPT_IN' } } } },
    advantage_plus_requested_features: ['pac_relaxation'], advantage_plus_feature_groups: { main: [{ api_key: 'pac_relaxation', requested: true }] },
  });
  await assert.rejects(
    runCode('prepare-creative-fallback-1.js', { input: [item({ ...source.json, error: { message: 'Asset feed can have exactly one ad format.' } })] }),
    /erro estrutural ou nao mapeado/,
  );

  const [fallback] = await runCode('prepare-creative-fallback-1.js', {
    input: [item({ ...source.json, error: { message: 'Advantage enhancement pac_relaxation is not eligible.' } })],
  });
  assert.deepEqual(fallback.json.advantage_plus_fallback_removed_features, ['pac_relaxation']);
  assert.equal(fallback.json.creativePayload.degrees_of_freedom_spec.creative_features_spec.pac_relaxation, undefined);
});

test('placement eligibility blocks a mixed creative when rewarded video is unavailable', async () => {
  const input = item({
    ok: true,
    placement_checks: [{
      destination_group: 'BSS', adset_id: '300',
      targeting: {
        effective_publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'],
        effective_facebook_positions: ['instream_video', 'story', 'facebook_reels', 'facebook_reels_overlay', 'notification', 'feed', 'search'],
        effective_instagram_positions: ['stream', 'story', 'reels'],
        effective_audience_network_positions: ['classic'],
        effective_whatsapp_positions: ['status'],
      },
    }],
  });
  await assert.rejects(
    runCode('validate-meta-placement-eligibility.js', { input: [input] }),
    /audience_network:rewarded_video/,
  );

  const unknownPlacement = structuredClone(input);
  unknownPlacement.json.placement_checks[0].targeting.effective_audience_network_positions = ['classic', 'rewarded_video', 'future_surface'];
  await assert.rejects(
    runCode('validate-meta-placement-eligibility.js', { input: [unknownPlacement] }),
    /audience_network:unsupported:future_surface/,
  );
});

test('mixed creative readback fails before staging when Meta removes the video rule', async () => {
  const fixture = mixedCreativeFixture().json;
  const source = item({
    media_variant: 'mixed_flexible', creative_id: '987654321',
    video_width: 1080, video_height: 1920,
    video_thumbnail_width: 1080, video_thumbnail_height: 1920,
    advantage_plus_requested_features: [], advantage_plus_skipped_features: [],
    advantage_plus_feature_groups: { main: [], essential: [], supplemental: [] },
    warnings: [],
  });
  const readback = { id: '987654321', ...fixture.creativePayload };
  const [verified] = await runCode('attach-advantage-plus-verification.js', {
    input: [item({ ok: true, operation: { status: 'completed', result: readback } })],
    itemsByNode: { 'Attach Creative Result': [source] },
  });
  assert.equal(verified.json.mixed_media_readback.status, 'verified');
  assert.equal(verified.json.mixed_media_readback.rewarded_video_delivery_aspect_ratio, '9x16');
  assert.equal(verified.json.mixed_media_readback.rewarded_video_format_status, 'recommended_9x16_satisfied_by_exact_original_source');
  assert.equal(verified.json.mixed_media_readback.ads_manager_format_label, 'original');
  assert.equal(verified.json.mixed_media_readback.ads_manager_format_label_status, 'exact_9x16_semantic_equivalent_to_recommended');
  assert.equal(verified.json.mixed_media_readback.video_auto_crop_calibration, 'graph_acknowledged_opt_in_but_ads_manager_remained_original');
  assert.equal(verified.json.mixed_media_readback.graph_video_crop_field_available, false);

  const missingDescriptionBinding = mixedCreativeFixture();
  delete missingDescriptionBinding.json.creativePayload.asset_feed_spec.asset_customization_rules[3].description_label;
  await assert.rejects(
    runCode('validate-meta-creative-payload.js', { input: [missingDescriptionBinding] }),
    /placement_description_label_missing/,
  );

  const removedVideo = structuredClone(readback);
  removedVideo.asset_feed_spec.videos = [];
  await assert.rejects(
    runCode('attach-advantage-plus-verification.js', {
      input: [item({ ok: true, operation: { status: 'completed', result: removedVideo } })],
      itemsByNode: { 'Attach Creative Result': [source] },
    }),
    /Mixed creative readback divergiu/,
  );

  const wrongAspectSource = structuredClone(source);
  wrongAspectSource.json.video_width = 1920;
  wrongAspectSource.json.video_height = 1080;
  await assert.rejects(
    runCode('attach-advantage-plus-verification.js', {
      input: [item({ ok: true, operation: { status: 'completed', result: readback } })],
      itemsByNode: { 'Attach Creative Result': [wrongAspectSource] },
    }),
    /mixed_rewarded_video_source_not_verified_9x16/,
  );
});

test('mixed creative accepts Meta WhatsApp Status scope normalization only with effective Status targeting', async () => {
  const fixture = mixedCreativeFixture().json;
  const source = item({
    media_variant: 'mixed_flexible', creative_id: '987654321', destination_group: 'BSS', destination_adset_id: '300',
    video_width: 1080, video_height: 1920,
    video_thumbnail_width: 1080, video_thumbnail_height: 1920,
    advantage_plus_requested_features: [], advantage_plus_skipped_features: [],
    advantage_plus_feature_groups: { main: [], essential: [], supplemental: [] }, warnings: [],
  });
  const normalized = structuredClone({ id: '987654321', ...fixture.creativePayload });
  delete normalized.asset_feed_spec.asset_customization_rules[2].customization_spec.whatsapp_positions;
  const placement = item({ placement_checks: [{ destination_group: 'BSS', adset_id: '300', targeting: { effective_whatsapp_positions: ['status'] } }] });
  const [verified] = await runCode('attach-advantage-plus-verification.js', {
    input: [item({ ok: true, operation: { status: 'completed', result: normalized } })],
    itemsByNode: { 'Attach Creative Result': [source], 'Validate Meta Placement Eligibility': [placement] },
  });
  assert.equal(verified.json.mixed_media_readback.whatsapp_status_scope, 'graph_normalized_to_effective_adset_status');

  await assert.rejects(
    runCode('attach-advantage-plus-verification.js', {
      input: [item({ ok: true, operation: { status: 'completed', result: normalized } })],
      itemsByNode: { 'Attach Creative Result': [source], 'Validate Meta Placement Eligibility': [item({ placement_checks: [{ destination_group: 'BSS', adset_id: '300', targeting: { effective_whatsapp_positions: [] } }] })] },
    }),
    /mixed_readback_static_vertical_rule_invalid/,
  );
});

test('Token Vault destination contract survives normalization without exposing credentials', async () => {
  const makeDestination = (destinationGroup, destinationType) => ({
    token_id: `opaque-${destinationGroup}`,
    destination_group: destinationGroup,
    api_version: 'v25.0',
    account_id: '100',
    campaign_id: '200',
    adset_id: destinationGroup === 'A' ? '300' : '301',
    page_id: '400',
    instagram_user_id: '500',
    destination_type: destinationType,
    whatsapp_destination_url: destinationType === 'whatsapp' ? 'https://wa.me/5551999999999' : '',
    campaign_objective: 'OUTCOME_LEADS',
    optimization_goal: 'CONVERSATIONS',
    landing_pages_by_creative_group: { DEFAULT: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' },
  });
  const output = await runCode('build-meta-api-params-from-vault.js', {
    input: [item({
      ok: true,
      ready: true,
      config_revision: 'test',
      destinations: [makeDestination('A', 'whatsapp'), makeDestination('B', 'website')],
    })],
  });
  assert.deepEqual(output.map((entry) => entry.json.destination_type), ['WHATSAPP', 'WEBSITE']);
  assert.equal(output[0].json.campaign_objective, 'OUTCOME_LEADS');
  assert.equal(output[0].json.optimization_goal, 'CONVERSATIONS');
  assert.equal(output[0].json.whatsapp_destination_url, 'https://wa.me/5551999999999');
  assert.equal(Object.prototype.hasOwnProperty.call(output[0].json, 'access_token'), false);
});

test('creative validator source requires the destination-contract workflow revision', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'validate-meta-creative-payload.js'), 'utf8');
  const buildJobs = fs.readFileSync(path.join(sourceRoot, 'build-jobs.js'), 'utf8');
  assert.match(source, /workflow_contract_version_skew/);
  assert.match(source, /meta_destination_contract_v9/);
  assert.match(buildJobs, /workflow_contract_revision: WORKFLOW_CONTRACT_REVISION/);
  assert.match(buildJobs, /destination_whatsapp_url_config_missing_or_invalid/);
});

test('canonical ad names retain the verified offer tag at the Meta length limit', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'build-jobs.js'), 'utf8');
  const match = source.match(/function buildCanonicalAdName[\s\S]*?\n}\n\nfunction parseMetaTimestamp/);
  assert.ok(match, 'canonical ad-name builder should be extractable');
  const functionSource = match[0].replace(/\nfunction parseMetaTimestamp$/, '');
  const safeString = (value) => String(value ?? '').trim();
  const normalizeNameSegment = (value) => safeString(value).replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const builders = new Function('safeString', 'normalizeNameSegment', `${functionSource}; return { buildCanonicalAdName, buildVariantAdName };`)(safeString, normalizeNameSegment);
  const tag = 'OFV1:GT301F53ENBB';
  const name = builders.buildCanonicalAdName('Oferta comercial muito longa '.repeat(20), 'Novo Hamburgo', tag);
  assert.ok(name.length <= 255);
  assert.match(name, new RegExp(`\\[${tag}\\]$`));
  const staticName = builders.buildVariantAdName(name, '[STATIC]', tag);
  const videoName = builders.buildVariantAdName(name, '[VIDEO]', tag);
  assert.ok(staticName.length <= 255 && videoName.length <= 255);
  assert.notEqual(staticName, videoName);
  assert.match(staticName, /\[STATIC\] \[OFV1:GT301F53ENBB\]$/);
  assert.match(videoName, /\[VIDEO\] \[OFV1:GT301F53ENBB\]$/);
});

test('feed media prefers a real 4:5 source and preserves non-4:5 fallback aspects', () => {
  const buildPayload = fs.readFileSync(path.join(sourceRoot, 'build-payload.js'), 'utf8');
  const buildJobs = fs.readFileSync(path.join(sourceRoot, 'build-jobs.js'), 'utf8');
  const validator = fs.readFileSync(path.join(sourceRoot, 'validate-meta-creative-payload.js'), 'utf8');
  assert.match(buildPayload, /slot: 'feed', acceptedRatios: \['4x5', '3x4', '1x1'\]/);
  assert.match(buildJobs, /if \(ratio === '4x5'\)[\s\S]*\[FEED_FOUR_BY_FIVE_CROP_KEY\]/);
  assert.match(validator, /FEED_FOUR_BY_FIVE_CROP_KEY = '400x500'/);
  assert.match(validator, /deliberately keeps its native aspect/);
});

test('graph contract makes optional branches explicit and retries Build Jobs', () => {
  const baseNode = (name, type = 'n8n-nodes-base.noOp') => ({ name, id: name, type, typeVersion: 1, position: [0, 0], parameters: {} });
  const workflow = {
    nodes: [
      { ...baseNode('Classify Media', 'n8n-nodes-base.code'), parameters: { jsCode: 'const baseDir = `/var/lib/skincos-runtime/orb/tmp/meta-ads-publish/${executionId}/${sourceId}`;' } },
      baseNode('Build Payload'), baseNode('Prepare Publish Run'), baseNode('Acquire Publish Run'),
      baseNode('Restore Publish Groups'), baseNode('Resume Drive Only?'), baseNode('Build Drive Finalization'),
      baseNode('Prepare Gateway Uploads'), baseNode('Normalize Gateway Upload'), baseNode('Prepare Video Upload Starts'),
      baseNode('Video Ready?'), baseNode('Wait Video Processing'), baseNode('Livia'),
      baseNode('Attach Creative Result'), baseNode('Verify Advantage+ Creative'),
      baseNode('Visual Grouping Agent', '@n8n/n8n-nodes-langchain.agent'),
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
  assert.match(workflow.nodes.find((node) => node.name === 'Classify Media').parameters.jsCode, /\/tmp\/meta-ads-publish/);
  assert.deepEqual(workflow.nodes.find((node) => node.name === 'Merge (2)').parameters, { mode: 'append', numberInputs: 2 });
  assert.equal(workflow.nodes.find((node) => node.name === 'Build Jobs').maxTries, 3);
  assert.equal(workflow.nodes.find((node) => node.name === 'Visual Grouping Agent').maxTries, 3);
  assert.equal(workflow.connections['Normalize Video Upload Start'].main[0][0].node, 'Video Bytes Complete?');
  assert.equal(workflow.nodes.find((node) => node.name === 'Wait Advantage+ Stabilization').parameters.amount, 30);
  assert.equal(workflow.connections['Attach Creative Result'].main[0][0].node, 'Wait Advantage+ Stabilization');
  assert.equal(workflow.connections['Wait Advantage+ Stabilization'].main[0][0].node, 'Verify Advantage+ Creative');
});

test('visual agent contract requires offer fingerprint evidence and is idempotent', () => {
  const workflow = {
    nodes: [
      {
        name: 'OpenAI Vision Model (Grouping)',
        parameters: {
          options: {
            textFormat: {
              textOptions: {
                schema: JSON.stringify({ properties: { groups: { items: { properties: {}, required: [] } } } }),
              },
            },
          },
        },
      },
      { name: 'Visual Grouping Agent', parameters: { text: 'Agrupe as artes.', options: { systemMessage: 'Use evidencias visuais.' } } },
    ],
  };
  assert.ok(applyOfferFingerprintContract(workflow).length > 0);
  assert.deepEqual(validateOfferFingerprintContract(workflow), []);
  assert.deepEqual(applyOfferFingerprintContract(workflow), []);
});

test('Livia copy contract requires five descriptions and is idempotent', () => {
  const workflow = {
    nodes: [
      {
        name: 'Livia',
        parameters: {
          text: '- 1 `description`\n- `description.text` com no máximo 60 caracteres',
          options: { systemMessage: 'A URL principal e o CTA BOOK_NOW sao controlados pelo workflow; retorne apenas os campos definidos no schema.\nGerar exatamente 1 `description`.\n- `description.text` deve ter no máximo 60 caracteres.' },
        },
      },
      {
        name: 'OpenAI Chat Model (Agent)',
        parameters: { options: { textFormat: { textOptions: { schema: JSON.stringify({
          type: 'object', additionalProperties: false, required: ['creative_override'],
          properties: { creative_override: { type: 'object', properties: { descriptions: { type: 'array', minItems: 1, maxItems: 1 } } } },
        }) } } } },
      },
    ],
  };
  assert.ok(applyAgentContract(workflow).length > 0);
  assert.deepEqual(validateAgentContract(workflow), []);
  const schema = JSON.parse(workflow.nodes[1].parameters.options.textFormat.textOptions.schema);
  assert.deepEqual(schema.required.slice(0, 2), ['job_key', 'group_key']);
  assert.equal(schema.properties.creative_override.properties.descriptions.minItems, 5);
  assert.equal(schema.properties.creative_override.properties.descriptions.maxItems, 5);
  assert.doesNotMatch(workflow.nodes[0].parameters.options.systemMessage, /CTA BOOK_NOW/);
  assert.deepEqual(applyAgentContract(workflow), []);
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
