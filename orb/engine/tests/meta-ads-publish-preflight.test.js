'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  effectiveResponsesApiEnabled,
  executionSummaryForWorkflow,
  manualExecutionAuditState,
} = require('../scripts/lib/meta-ads-publish-execution-semantics');
const workflow = require('../workflows/meta-ads-publish.current.json');

test('Responses API uses the n8n 1.3 default when the stored parameter is absent', () => {
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.3, parameters: {} }), true);
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.3, parameters: { responsesApiEnabled: false } }), false);
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.2, parameters: {} }), false);
});

test('execution version follows current for inactive workflows and published version for active workflows', () => {
  const current = { version_id: 'current' };
  const history = [{ version_id: 'published' }];
  assert.equal(executionSummaryForWorkflow({ active: false, activeVersionId: 'published' }, current, history), current);
  assert.deepEqual(executionSummaryForWorkflow({ active: true, activeVersionId: 'published' }, current, history), history[0]);
});

test('manual execution retention is reported without assuming execution data exists', () => {
  assert.equal(manualExecutionAuditState({ saveManualExecutions: true }), 'persisted');
  assert.equal(manualExecutionAuditState({ saveManualExecutions: false }), 'not_persisted');
  assert.equal(manualExecutionAuditState({}), 'not_persisted');
});

test('all embedded Code nodes compile', () => {
  for (const node of workflow.nodes.filter((entry) => entry.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(
      () => new Function(String(node.parameters?.jsCode || '')),
      `${node.name} must contain valid JavaScript`,
    );
  }
});

test('external Meta mutation nodes retain the propagation and transient retry contract', () => {
  const retryContract = {
    'Upload File': [4, 10000],
    'Create AdCreative': [4, 20000],
    'Create AdCreative Fallback 1': [2, 10000],
    'Create AdCreative Fallback 2': [2, 10000],
    'Verify Advantage+ Creative': [4, 10000],
    'Stage Ad Batch': [3, 15000],
    'Activate Ad Batch': [3, 15000],
  };

  for (const [nodeName, [maxTries, waitBetweenTries]] of Object.entries(retryContract)) {
    const node = workflow.nodes.find((entry) => entry.name === nodeName);
    assert.ok(node, `${nodeName} must exist`);
    assert.equal(node.retryOnFail, true, `${nodeName} must retry failures`);
    assert.equal(node.maxTries, maxTries, `${nodeName} maxTries`);
    assert.equal(node.waitBetweenTries, waitBetweenTries, `${nodeName} waitBetweenTries`);
  }

  const buildJobs = workflow.nodes.find((entry) => entry.name === 'Build Jobs');
  assert.equal(buildJobs.retryOnFail, false, 'pure payload building must not be retried');
});

test('Advantage+ reporting separates the five main enhancements from the three essentials', () => {
  const buildJobs = workflow.nodes.find((entry) => entry.name === 'Build Jobs');
  const attachVerification = workflow.nodes.find((entry) => entry.name === 'Attach Advantage+ Verification');
  const buildCode = String(buildJobs?.parameters?.jsCode || '');
  const verificationCode = String(attachVerification?.parameters?.jsCode || '');

  for (const feature of ['add_text_overlay', 'music_generation', 'pac_relaxation', 'image_touchups', 'text_optimizations']) {
    assert.match(buildCode, new RegExp(feature), `main feature ${feature} must be classified`);
  }
  for (const feature of ['inline_comment', 'enhance_cta', 'image_brightness_and_contrast']) {
    assert.match(buildCode, new RegExp(feature), `essential feature ${feature} must be classified`);
  }
  assert.match(buildCode, /if \(musicEligible\)[\s\S]*creativeFeaturesSpec\.music_generation/);
  assert.match(buildCode, /if \(pacEligible\)[\s\S]*creativeFeaturesSpec\.pac_relaxation/);
  assert.match(verificationCode, /graph_acknowledgement_is_not_ui_confirmation/);
  assert.match(verificationCode, /ui_confirmed_features:\s*\[\]/);
});

test('selective creative fallback removes one optional enhancement per attempt', () => {
  for (const nodeName of ['Prepare Creative Fallback 1', 'Prepare Creative Fallback 2']) {
    const node = workflow.nodes.find((entry) => entry.name === nodeName);
    const code = String(node?.parameters?.jsCode || '');
    assert.ok(node, `${nodeName} must exist`);
    assert.match(code, /delete features\[removedFeature\]/);
    assert.match(code, /fallback_removed/);
    assert.doesNotMatch(code, /\$items\(/, `${nodeName} must not reconstruct prior execution history`);
    assert.doesNotMatch(code, /delete features\.image_touchups/);
    assert.doesNotMatch(code, /delete features\.text_optimizations/);
  }
});

test('creative responses are correlated explicitly before every fallback code node', () => {
  const expected = [
    ['Prepare Creative Operation', 'Create AdCreative', 'Merge Creative Response 0', 'Prepare Creative Fallback 1'],
    ['Prepare Creative Fallback 1', 'Create AdCreative Fallback 1', 'Merge Creative Response 1', 'Prepare Creative Fallback 2'],
    ['Prepare Creative Fallback 2', 'Create AdCreative Fallback 2', 'Merge Creative Response 2', 'Attach Creative Result'],
  ];
  for (const [source, request, mergeName, consumer] of expected) {
    const merge = workflow.nodes.find((entry) => entry.name === mergeName);
    assert.ok(merge, `${mergeName} must exist`);
    assert.equal(merge.type, 'n8n-nodes-base.merge');
    assert.equal(merge.parameters.mode, 'combine');
    assert.equal(merge.parameters.combineBy, 'combineByPosition');
    assert.equal(merge.parameters.options.clashHandling.values.resolveClash, 'preferInput2');
    assert.ok(workflow.connections[source].main[0].some((edge) => edge.node === mergeName && edge.index === 0));
    assert.ok(workflow.connections[request].main[0].some((edge) => edge.node === mergeName && edge.index === 1));
    assert.equal(workflow.connections[mergeName].main[0][0].node, consumer);
  }
  const attach = workflow.nodes.find((entry) => entry.name === 'Attach Creative Result');
  assert.doesNotMatch(String(attach.parameters.jsCode), /\$items\(/);
});

function runCodeNode(nodeName, inputItems, sourceItemsByNode = {}) {
  const node = workflow.nodes.find((entry) => entry.name === nodeName);
  assert.ok(node, `${nodeName} must exist`);
  const execute = new Function('$input', '$items', String(node.parameters?.jsCode || ''));
  return execute(
    { all: () => inputItems },
    (name) => sourceItemsByNode[name] || [],
  );
}

function runBuildJobs(inputItems, sourceItemsByNode = {}) {
  const node = workflow.nodes.find((entry) => entry.name === 'Build Jobs');
  assert.ok(node, 'Build Jobs must exist');
  const execute = new Function('$input', '$items', '$', String(node.parameters?.jsCode || ''));
  const itemsFor = (name) => sourceItemsByNode[name] || [];
  return execute(
    { all: () => inputItems },
    itemsFor,
    (name) => ({ all: () => itemsFor(name) }),
  );
}

function copyOutput({ jobKey = '', groupKey = '', bodyCount = 5 } = {}) {
  return {
    json: {
      output: JSON.stringify({
        ...(jobKey ? { job_key: jobKey } : {}),
        ...(groupKey ? { group_key: groupKey } : {}),
        source_ad_name: 'nome retornado pela IA sem alias do job',
        creative_override: {
          bodies: Array.from({ length: bodyCount }, (_, index) => ({ text: `Body ${index + 1}` })),
          titles: Array.from({ length: 5 }, (_, index) => ({ text: `Titulo ${index + 1}` })),
          descriptions: [{ text: 'Descricao segura' }],
        },
      }),
    },
  };
}

const STATIC_MEDIA = [
  { id: 'feed-1', name: 'feed-4x5.png', original_name: 'feed-4x5.png', proporcao: '4x5', role: 'feed_image', media_type: 'image' },
  { id: 'banner-1', name: 'banner-2x1.png', original_name: 'banner-2x1.png', proporcao: '2x1', role: 'banner_image', media_type: 'image' },
  { id: 'vertical-1', name: 'vertical-9x16.png', original_name: 'vertical-9x16.png', proporcao: '9x16', role: 'vertical_image', media_type: 'image' },
];

function buildJob({ jobKey = 'VISUAL_GROUP_01__CAMPAIGN', groupKey = 'PROMO_FACIAL', mediaMode = 'static_group', destinations = 1 } = {}) {
  const destination = (index) => ({
    destination_group: index === 0 ? 'BarraShoppingSul' : 'NovoHamburgo',
    destination_row_number: String(index + 1),
    destination_campaign_id: `campaign-${index + 1}`,
    destination_ad_account_id: `account-${index + 1}`,
    destination_page_id: `page-${index + 1}`,
    destination_instagram_user_id: `instagram-${index + 1}`,
    destination_adset_id: `adset-${index + 1}`,
    destination_api_version: 'v25.0',
    token_id: `opaque-token-${index + 1}`,
    allowed_link_hosts: ['espacofacial.com'],
    landing_pages_by_creative_group: { [groupKey]: `https://espacofacial.com/agendamento?unit=${index === 0 ? 'barrashoppingsul' : 'novo-hamburgo'}` },
    placement_eligibility: {},
  });
  const video = { id: 'video-1', name: 'video-9x16.mp4', original_name: 'video-9x16.mp4', proporcao: '9x16', role: 'vertical_video', media_type: 'video' };
  const hasStatic = mediaMode !== 'video_only';
  const hasVideo = mediaMode !== 'static_group';
  return {
    json: {
      job_key: jobKey,
      group_key: groupKey,
      creative_group_key: groupKey,
      nome_base: 'Promo Facial',
      source_ad_name: 'Promo Facial',
      source_ad_name_base: 'Promo Facial',
      action: 'create_new',
      match_status: 'no_match',
      media_mode: mediaMode,
      imagens: hasStatic ? structuredClone(STATIC_MEDIA) : [],
      videos: hasVideo ? [video] : [],
      media_inventory: [...(hasStatic ? STATIC_MEDIA : []), ...(hasVideo ? [video] : [])].map((media) => ({ ...media, ratio: media.proporcao })),
      required_ratios: hasStatic ? ['4x5', '2x1', '9x16'] : [],
      required_media_roles: hasStatic ? ['feed_image', 'banner_image', 'vertical_image'] : ['vertical_video'],
      destinations: Array.from({ length: destinations }, (_, index) => destination(index)),
      source_ads: [],
      selected_ad_ids: [],
      matched_ads: [],
      replacement_plan: [],
      run_id: 'fixture-run',
      batch_fingerprint: 'fixture-fingerprint',
    },
  };
}

function staticUpload(jobKey, media, accountId, hash) {
  const dimensions = media.proporcao === '9x16'
    ? { width: 1080, height: 1920 }
    : media.proporcao === '2x1'
      ? { width: 1200, height: 628 }
      : { width: 1080, height: 1350 };
  return {
    json: {
      job_key: jobKey,
      _gateway_account_id: accountId,
      ratio: media.proporcao,
      role: media.role,
      media_type: 'image',
      source_file_id: media.id,
      source_file_name: media.name,
      images: { [media.name]: { hash, ...dimensions } },
    },
  };
}

function staticUploads(job, accountId = 'account-1') {
  return STATIC_MEDIA.map((media, index) => staticUpload(job.json.job_key, media, accountId, `hash-${index + 1}`));
}

test('fallback 1 removes only the rejected enhancement and preserves the rest', () => {
  const source = {
    json: {
      job_key: 'job-1', run_id: 'run-1', creative_group_key: 'group-1', destination_group: 'unit-1',
      token_id: 'token-1', account_id: '123', api_version: 'v25.0',
      advantage_plus_requested_features: ['add_text_overlay', 'music_generation', 'pac_relaxation', 'image_touchups'],
      advantage_plus_feature_groups: {
        main: [
          { api_key: 'add_text_overlay', requested: true, status: 'requested' },
          { api_key: 'music_generation', requested: true, status: 'requested' },
          { api_key: 'pac_relaxation', requested: true, status: 'requested' },
          { api_key: 'image_touchups', requested: true, status: 'requested' },
        ],
      },
      creativePayload: {
        degrees_of_freedom_spec: {
          creative_features_spec: {
            add_text_overlay: { enroll_status: 'OPT_IN' },
            music_generation: { enroll_status: 'OPT_IN' },
            pac_relaxation: { enroll_status: 'OPT_IN' },
            image_touchups: { enroll_status: 'OPT_IN' },
          },
        },
      },
    },
  };
  const result = runCodeNode(
    'Prepare Creative Fallback 1',
    [{ json: { ...source.json, ok: false, detail: { message: 'pac_relaxation is not supported' } } }],
  )[0].json;
  const features = result.creativePayload.degrees_of_freedom_spec.creative_features_spec;
  assert.equal(features.pac_relaxation, undefined);
  assert.ok(features.music_generation);
  assert.ok(features.add_text_overlay);
  assert.ok(features.image_touchups);
  assert.deepEqual(result.advantage_plus_fallback_removed_features, ['pac_relaxation']);
  assert.equal(result.gateway_request.action, 'create_creative');
});

test('a successful earlier creative attempt is converted into a read, not another create', () => {
  const source = {
    json: {
      run_id: 'run-1', token_id: 'token-1', account_id: '123', api_version: 'v25.0',
      creativePayload: { degrees_of_freedom_spec: { creative_features_spec: {} } },
    },
  };
  const result = runCodeNode(
    'Prepare Creative Fallback 2',
    [{ json: { ...source.json, ok: true, operation: { status: 'completed', result: { id: '987' } } } }],
  )[0].json;
  assert.equal(result.creative_id, '987');
  assert.equal(result.gateway_request.action, 'get_creative');
  assert.equal(result.gateway_request.object_id, '987');
});

test('fallback 1 routes two replayed successful creatives without historical item lookup', () => {
  const inputs = ['959318413790885', '1580623543860255'].map((creativeId, index) => ({
    json: {
      job_key: `job-${index + 1}`,
      run_id: 'run-replay',
      creative_group_key: 'VISUAL_GROUP_01',
      destination_group: index === 0 ? 'BarraShoppingSul' : 'Novo_Hamburgo',
      token_id: `token-${index + 1}`,
      account_id: '3271664739829465',
      api_version: 'v25.0',
      creativePayload: { degrees_of_freedom_spec: { creative_features_spec: {} } },
      ok: true,
      replayed: true,
      operation: { status: 'completed', result: { id: creativeId } },
    },
  }));
  const startedAt = process.hrtime.bigint();
  const results = runCodeNode('Prepare Creative Fallback 1', inputs);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((item) => item.json.creative_id), ['959318413790885', '1580623543860255']);
  assert.equal(results.every((item) => item.json.gateway_request.action === 'get_creative'), true);
  assert.equal(results.every((item) => item.json.operation === undefined), true);
  assert.ok(elapsedMs < 500, `fallback replay should be synchronous, got ${elapsedMs.toFixed(2)} ms`);
});

test('Graph OPT_IN readback remains UI-unverified in the structured report', () => {
  const source = {
    json: {
      creative_id: '987', advantage_plus_requested_features: ['image_touchups'],
      advantage_plus_feature_groups: { main: [{ api_key: 'image_touchups', requested: true, status: 'requested' }] },
      advantage_plus_skipped_features: [], advantage_plus_site_links: [], warnings: [],
    },
  };
  const result = runCodeNode(
    'Attach Advantage+ Verification',
    [{ json: { ok: true, operation: { status: 'completed', result: {
      id: '987', degrees_of_freedom_spec: { creative_features_spec: { image_touchups: { enroll_status: 'OPT_IN' } } },
    } } } }],
    { 'Attach Creative Result': [source] },
  )[0].json;
  assert.deepEqual(result.advantage_plus_effective_report.graph_acknowledged_features, ['image_touchups']);
  assert.deepEqual(result.advantage_plus_effective_report.ui_confirmed_features, []);
  assert.equal(result.advantage_plus_effective_report.status, 'graph_acknowledged_ui_unverified');
  assert.equal(result.advantage_plus_verification.graph_acknowledgement_is_not_ui_confirmation, true);
});

function binary(fileName, mimeType) {
  return { fileName, mimeType, fileSize: 1024, data: 'fixture' };
}

function runPrepareVisual(items) {
  const node = workflow.nodes.find((entry) => entry.name === 'Prepare Visual Grouping Batch');
  return new Function('$input', String(node.parameters.jsCode))({ all: () => items });
}

function runValidateVisual(prepared, originals, agentOutput) {
  const node = workflow.nodes.find((entry) => entry.name === 'Validate Visual Grouping');
  return new Function('$input', '$items', String(node.parameters.jsCode))(
    { first: () => ({ json: { output: agentOutput } }) },
    (name) => name === 'Prepare Visual Grouping Batch' ? prepared : name === 'Prepare Media Inventory' ? originals : [],
  );
}

test('legacy image batches retain the exact three-image contract', () => {
  const items = [
    { json: { id: 'a', mimeType: 'image/jpeg' }, binary: { data: binary('random-a.jpg', 'image/jpeg') } },
    { json: { id: 'b', mimeType: 'image/jpeg' }, binary: { data: binary('random-b.jpg', 'image/jpeg') } },
    { json: { id: 'c', mimeType: 'image/jpeg' }, binary: { data: binary('random-c.jpg', 'image/jpeg') } },
  ];
  const prepared = runPrepareVisual(items);
  assert.equal(prepared[0].json.visual_grouping_batch_version, '1');
  assert.deepEqual(prepared[0].json.required_roles, ['feed', 'banner', 'stories']);
  assert.equal(Object.keys(prepared[0].binary).length, 3);
});

test('mixed batches expose only image representations and validate four shuffled roles', () => {
  const originals = [
    { json: { id: 'static-3', mimeType: 'image/jpeg' }, binary: { data: binary('z.jpg', 'image/jpeg') } },
    { json: { id: 'video-1', mimeType: 'video/mp4', media_processing: { mime_type: 'video/mp4', duration_seconds: 12, width: 1080, height: 1920, has_audio: true, transcript: 'oferta visual' } }, binary: { data: binary('v.mp4', 'video/mp4'), analysis: binary('sheet.jpg', 'image/jpeg'), thumbnail: binary('thumb.jpg', 'image/jpeg') } },
    { json: { id: 'static-1', mimeType: 'image/jpeg' }, binary: { data: binary('x.jpg', 'image/jpeg') } },
    { json: { id: 'static-2', mimeType: 'image/jpeg' }, binary: { data: binary('y.jpg', 'image/jpeg') } },
  ];
  const prepared = runPrepareVisual(originals);
  assert.equal(prepared[0].json.visual_grouping_batch_version, '2');
  assert.deepEqual(prepared[0].json.required_roles, ['feed_image', 'banner_image', 'vertical_image', 'vertical_video']);
  assert.equal(Object.values(prepared[0].binary).every((entry) => entry.mimeType.startsWith('image/')), true);
  const refs = prepared[0].json.media.map((entry) => entry.media_ref);
  const output = runValidateVisual(prepared, originals, {
    groups: [{ group_key: 'VISUAL_GROUP_01', visual_concept: 'mesma oferta', confidence: 0.96, evidence: ['mesmo procedimento e preco'] }],
    assignments: [
      { media_ref: refs[3], media_type: 'image', group_key: 'VISUAL_GROUP_01', role: 'banner_image', ratio: '2x1', confidence: 0.91, evidence: ['mesma oferta em faixa horizontal'] },
      { media_ref: refs[1], media_type: 'video', group_key: 'VISUAL_GROUP_01', role: 'vertical_video', ratio: '9x16', confidence: 0.94, evidence: ['quadros exibem a mesma oferta'] },
      { media_ref: refs[0], media_type: 'image', group_key: 'VISUAL_GROUP_01', role: 'vertical_image', ratio: '9x16', confidence: 0.92, evidence: ['mesma composicao vertical'] },
      { media_ref: refs[2], media_type: 'image', group_key: 'VISUAL_GROUP_01', role: 'feed_image', ratio: '4x5', confidence: 0.93, evidence: ['mesmo procedimento e preco'] },
    ], warnings: [],
  });
  assert.equal(output.length, 4);
  assert.equal(output.find((item) => item.json.id === 'video-1').binary.thumbnail.mimeType, 'image/jpeg');
});

test('mixed batches block missing video, duplicate roles and confidence below 0.75', () => {
  const originals = [
    { json: { id: 'i1', mimeType: 'image/jpeg' }, binary: { data: binary('a.jpg', 'image/jpeg') } },
    { json: { id: 'i2', mimeType: 'image/jpeg' }, binary: { data: binary('b.jpg', 'image/jpeg') } },
    { json: { id: 'i3', mimeType: 'image/jpeg' }, binary: { data: binary('c.jpg', 'image/jpeg') } },
    { json: { id: 'v1', mimeType: 'video/mp4', media_processing: { mime_type: 'video/mp4', duration_seconds: 10, width: 1080, height: 1920 } }, binary: { data: binary('v.mp4', 'video/mp4'), analysis: binary('s.jpg', 'image/jpeg'), thumbnail: binary('t.jpg', 'image/jpeg') } },
  ];
  const prepared = runPrepareVisual(originals);
  const refs = prepared[0].json.media.map((entry) => entry.media_ref);
  const lowConfidence = {
    groups: [{ group_key: 'VISUAL_GROUP_01', visual_concept: 'x', confidence: 0.9, evidence: ['visual'] }],
    assignments: [
      { media_ref: refs[0], media_type: 'image', group_key: 'VISUAL_GROUP_01', role: 'feed_image', ratio: '4x5', confidence: 0.74, evidence: ['visual'] },
      { media_ref: refs[1], media_type: 'image', group_key: 'VISUAL_GROUP_01', role: 'banner_image', ratio: '2x1', confidence: 0.9, evidence: ['visual'] },
      { media_ref: refs[2], media_type: 'image', group_key: 'VISUAL_GROUP_01', role: 'vertical_image', ratio: '9x16', confidence: 0.9, evidence: ['visual'] },
      { media_ref: refs[3], media_type: 'video', group_key: 'VISUAL_GROUP_01', role: 'vertical_video', ratio: '9x16', confidence: 0.9, evidence: ['visual'] },
    ], warnings: [],
  };
  assert.throws(() => runValidateVisual(prepared, originals, lowConfidence), /Confianca insuficiente/);
  const missing = structuredClone(lowConfidence);
  missing.assignments = missing.assignments.filter((entry) => entry.media_type !== 'video');
  missing.assignments[0].confidence = 0.9;
  assert.throws(() => runValidateVisual(prepared, originals, missing), /nao cobriu o lote exatamente uma vez/);
});

test('workflow contains resumable video operations and preserves both unit landing URLs', () => {
  for (const nodeName of ['Start Video Upload', 'Transfer Video Chunk', 'Finish Video Upload', 'Get Video Status', 'Video Ready?']) {
    assert.ok(workflow.nodes.some((node) => node.name === nodeName), `${nodeName} must exist`);
  }
  const buildJobs = String(workflow.nodes.find((node) => node.name === 'Build Jobs').parameters.jsCode);
  assert.match(buildJobs, /ad_formats: \['SINGLE_IMAGE'\]/);
  assert.match(buildJobs, /object_story_spec\.video_data/);
  assert.match(buildJobs, /media_variant: 'static_flexible'/);
  assert.match(buildJobs, /media_variant: 'video_single'/);
  assert.match(buildJobs, /logical_creative_group_key/);
  const config = String(workflow.nodes.find((node) => node.name === 'Build Meta API Params From Vault').parameters.jsCode);
  assert.match(config, /https:\/\/espacofacial\.com\/agendamento\?unit=barrashoppingsul/);
  assert.match(config, /https:\/\/espacofacial\.com\/agendamento\?unit=novo-hamburgo/);
});

test('Build Jobs preserves a valid singleton Livia copy when three static upload receipts also carry job_key', () => {
  const job = buildJob({ destinations: 2 });
  const result = runBuildJobs(
    [copyOutput(), ...staticUploads(job, 'account-1'), ...staticUploads(job, 'account-2')],
    { 'Build Payload': [job], 'Restore Publish Groups': [], 'Build Meta API Params From Vault': [] },
  );

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.json.media_variant), ['static_flexible', 'static_flexible']);
  assert.equal(result[0].json.creativePayload.asset_feed_spec.images.length, 3);
  assert.equal(result[0].json.creativePayload.asset_feed_spec.bodies.length, 5);
  assert.equal(result[0].json.creativePayload.asset_feed_spec.titles.length, 5);
  assert.equal(result[0].json.creativePayload.asset_feed_spec.descriptions.length, 1);
});

test('Build Jobs creates a separate active ad when every replacement candidate is within the freshness window', () => {
  const job = buildJob({ destinations: 1 });
  const candidate = {
    id: 'recent-ad-1',
    name: 'Oferta atual | BarraShoppingSul',
    adset_id: 'adset-1',
    campaign_id: 'campaign-1',
    updated_time: new Date().toISOString(),
    creative: { object_story_spec: { page_id: 'page-1', instagram_user_id: 'instagram-1' } },
  };
  job.json.action = 'replace_existing';
  job.json.should_replace_existing = true;
  job.json.selected_ad_ids = [candidate.id];
  job.json.matched_ads = [{ ad_id: candidate.id, score: 500 }];
  job.json.source_ads = [candidate];

  const result = runBuildJobs(
    [copyOutput({ jobKey: job.json.job_key, groupKey: job.json.group_key }), ...staticUploads(job)],
    { 'Build Payload': [job], 'Restore Publish Groups': [], 'Build Meta API Params From Vault': [] },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].json.action, 'create_new');
  assert.equal(result[0].json.should_create_new_ad, true);
  assert.equal(result[0].json.should_replace_existing, false);
  assert.equal(result[0].json.source_ad_id, '');
  assert.equal(result[0].json.match_status, 'temporal_guard_create_new');
  assert.equal(result[0].json.adPayload.status, 'ACTIVE');
  assert.equal(result[0].json.adPayload.adset_id, 'adset-1');
  assert.equal(result[0].json.destination_match_debug.temporal_guard.fresh_candidate_count, 1);
  assert.equal(result[0].json.destination_match_debug.temporal_guard.reason, 'all_matching_candidates_are_fresh');
  assert.match(result[0].json.warnings.join(' '), /sera criado um novo anuncio ACTIVE/);
});

test('Build Jobs creates a separate active ad when replacement has no candidate at all', () => {
  const job = buildJob({ destinations: 1 });
  job.json.action = 'replace_existing';
  job.json.should_replace_existing = true;

  const result = runBuildJobs(
    [copyOutput({ jobKey: job.json.job_key, groupKey: job.json.group_key }), ...staticUploads(job)],
    { 'Build Payload': [job], 'Restore Publish Groups': [], 'Build Meta API Params From Vault': [] },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].json.action, 'create_new');
  assert.equal(result[0].json.match_status, 'replacement_candidate_create_new');
  assert.equal(result[0].json.adPayload.status, 'ACTIVE');
  assert.match(result[0].json.warnings.join(' '), /Nenhum candidato inequivoco/);
});

test('Build Stage Batch sends verified new and replacement ads to Meta as active', () => {
  const result = runCodeNode('Build Stage Batch', [{ json: {
    run_id: 'fixture-run', job_key: 'fixture-job', action: 'create_new',
    destination_adset_id: 'adset-1', creative_id: 'creative-1',
    creative_group_key: 'PROMO_FACIAL', destination_group: 'BarraShoppingSul',
    token_id: 'opaque-token-1', account_id: 'account-1', api_version: 'v25.0',
    adPayload: { name: 'Oferta fixture', status: 'PAUSED', adset_id: 'adset-1' },
    asset_ids: {}, asset_names: {}, media_variant: 'static_flexible',
  } }]);

  assert.equal(result[0].json.gateway_request.jobs[0].ad_payload.status, 'ACTIVE');
});

test('Validate Meta Creative Payload requires the active commercial publish status', () => {
  const node = workflow.nodes.find((entry) => entry.name === 'Validate Meta Creative Payload');
  const code = String(node?.parameters?.jsCode || '');
  assert.match(code, /adPayload\.status\) === 'ACTIVE'/);
  assert.match(code, /ad_publish_status_must_be_active/);
  assert.doesNotMatch(code, /ad_stage_status_must_be_paused/);
});

test('Classify Media stages video source files under the writable Orb runtime root', () => {
  const node = workflow.nodes.find((entry) => entry.name === 'Classify Media');
  assert.ok(node, 'Classify Media must exist');
  const execute = new Function('$input', '$execution', String(node.parameters?.jsCode || ''));
  const [result] = execute(
    {
      all: () => [{
        json: { id: 'video-source-1' },
        binary: { data: { mimeType: 'video/mp4', fileExtension: 'mp4' } },
      }],
    },
    { id: 'execution-1' },
  );
  assert.equal(result.json.media_staging.base_dir, '/var/lib/skincos-runtime/orb/tmp/meta-ads-publish/execution-1/video-source-1');
  assert.equal(result.json.media_staging.input_file, '/var/lib/skincos-runtime/orb/tmp/meta-ads-publish/execution-1/video-source-1/source.mp4');
  assert.equal(result.json.media_staging.output_dir, '/var/lib/skincos-runtime/orb/tmp/meta-ads-publish/execution-1/video-source-1/processed');
  assert.match(result.json.processor_payload_b64, /^[A-Za-z0-9+/]+=*$/);
});

test('video staging preparation restores the original binary input before Write Video Source', () => {
  const binary = { data: { mimeType: 'video/mp4', fileName: 'fixture.mp4' } };
  const source = {
    json: { media_staging: { base_dir: '/var/lib/skincos-runtime/orb/tmp/meta-ads-publish/fixture', input_file: '/var/lib/skincos-runtime/orb/tmp/meta-ads-publish/fixture/source.mp4' } },
    binary,
    pairedItem: { item: 0 },
  };
  const result = runCodeNode(
    'Attach Video Staging Context',
    [{ json: { exitCode: 0 }, pairedItem: { item: 0 } }],
    { 'Is Video?': [source] },
  )[0];
  assert.equal(result.json.media_staging.input_file, source.json.media_staging.input_file);
  assert.equal(result.binary, binary);
});

test('video staging directory is prepared before writing the downloaded binary', () => {
  const prepare = workflow.nodes.find((entry) => entry.name === 'Prepare Video Staging Directory');
  assert.ok(prepare, 'Prepare Video Staging Directory must exist');
  assert.match(String(prepare.parameters?.command || ''), /install -d -m 0750 --/);
  assert.match(String(prepare.parameters?.command || ''), /media_staging\.base_dir/);
  assert.equal(workflow.connections['Is Video?'].main[0][0].node, 'Prepare Video Staging Directory');
  assert.equal(workflow.connections['Prepare Video Staging Directory'].main[0][0].node, 'Attach Video Staging Context');
  assert.equal(workflow.connections['Attach Video Staging Context'].main[0][0].node, 'Write Video Source');
});

test('Build Jobs preserves supported mixed and video-only media modes', () => {
  const mixed = buildJob({ mediaMode: 'mixed_group', destinations: 1 });
  const mixedVideo = mixed.json.videos[0];
  const mixedResult = runBuildJobs(
    [
      copyOutput({ jobKey: mixed.json.job_key, groupKey: mixed.json.group_key }),
      ...staticUploads(mixed),
      { json: { job_key: mixed.json.job_key, _gateway_account_id: 'account-1', upload_kind: 'video', video_id: 'video-123', video_status: 'ready', ready: true, source_file_id: mixedVideo.id, source_file_name: mixedVideo.name } },
      { json: { job_key: mixed.json.job_key, _gateway_account_id: 'account-1', upload_kind: 'video_thumbnail', ratio: '9x16', role: 'vertical_video', source_file_id: mixedVideo.id, source_file_name: 'video-thumb.jpg', images: { 'video-thumb.jpg': { hash: 'thumb-123', width: 1080, height: 1920 } } } },
    ],
    { 'Build Payload': [mixed], 'Restore Publish Groups': [], 'Build Meta API Params From Vault': [] },
  );
  assert.deepEqual(mixedResult.map((item) => item.json.media_variant), ['static_flexible', 'video_single']);

  const videoOnly = buildJob({ mediaMode: 'video_only', destinations: 1 });
  const video = videoOnly.json.videos[0];
  const videoOnlyResult = runBuildJobs(
    [
      copyOutput({ jobKey: videoOnly.json.job_key, groupKey: videoOnly.json.group_key }),
      { json: { job_key: videoOnly.json.job_key, _gateway_account_id: 'account-1', upload_kind: 'video', video_id: 'video-456', video_status: 'ready', ready: true, source_file_id: video.id, source_file_name: video.name } },
      { json: { job_key: videoOnly.json.job_key, _gateway_account_id: 'account-1', upload_kind: 'video_thumbnail', ratio: '9x16', role: 'vertical_video', source_file_id: video.id, source_file_name: 'video-thumb.jpg', images: { 'video-thumb.jpg': { hash: 'thumb-456', width: 1080, height: 1920 } } } },
    ],
    { 'Build Payload': [videoOnly], 'Restore Publish Groups': [], 'Build Meta API Params From Vault': [] },
  );
  assert.equal(videoOnlyResult.length, 1);
  assert.equal(videoOnlyResult[0].json.media_variant, 'video_single');
  assert.ok(videoOnlyResult[0].json.creativePayload.object_story_spec.video_data.video_id);
});

test('Build Jobs accepts an unkeyed valid Livia response only for one job and rejects ambiguous multi-job mapping', () => {
  const oneJob = buildJob({ destinations: 1 });
  assert.equal(
    runBuildJobs(
      [copyOutput(), ...staticUploads(oneJob)],
      { 'Build Payload': [oneJob], 'Restore Publish Groups': [], 'Build Meta API Params From Vault': [] },
    ).length,
    1,
  );

  const secondJob = buildJob({ jobKey: 'VISUAL_GROUP_02__CAMPAIGN', groupKey: 'PROMO_CORPO', destinations: 1 });
  assert.throws(
    () => runBuildJobs(
      [copyOutput(), ...staticUploads(oneJob)],
      { 'Build Payload': [oneJob, secondJob], 'Restore Publish Groups': [], 'Build Meta API Params From Vault': [] },
    ),
    /ai_output_unmapped/,
  );
});

test('Build Jobs distinguishes incomplete and conflicting Livia outputs before Meta mutation', () => {
  const job = buildJob({ destinations: 1 });
  const sourceItems = { 'Build Payload': [job], 'Restore Publish Groups': [], 'Build Meta API Params From Vault': [] };
  assert.throws(
    () => runBuildJobs([copyOutput({ jobKey: job.json.job_key, bodyCount: 4 }), ...staticUploads(job)], sourceItems),
    /ai_copy_contract_failed/,
  );
  assert.throws(
    () => runBuildJobs([copyOutput({ jobKey: job.json.job_key }), copyOutput({ jobKey: job.json.job_key }), ...staticUploads(job)], sourceItems),
    /ai_output_conflict/,
  );
});

test('Livia is instructed to return deterministic job and group correlation keys', () => {
  const livia = workflow.nodes.find((node) => node.name === 'Livia');
  const prompt = String(livia?.parameters?.text || '');
  const systemMessage = String(livia?.parameters?.options?.systemMessage || '');
  assert.match(prompt, /Contrato de correlacao deterministica do workflow/);
  assert.match(prompt, /\`job_key\` e \`group_key\`/);
  assert.match(systemMessage, /Contrato de correlacao deterministica do workflow/);
});
