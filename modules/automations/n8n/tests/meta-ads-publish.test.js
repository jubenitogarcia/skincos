const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moduleRoot = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'workflows', 'meta-ads-publish.current.json'), 'utf8'));
const sourceRoot = path.join(moduleRoot, 'workflow-src', 'meta-ads-publish');
const fixtureRoot = path.join(__dirname, 'fixtures', 'meta-ads-publish');
const { createMetaAdsPublishStructuredSchema } = require('../scripts/lib/meta-ads-publish-structured-schema');

function source(name) {
  return fs.readFileSync(path.join(sourceRoot, name), 'utf8');
}

function runBuildPayload(fileNames, options = {}) {
  const configRevision = 'a'.repeat(64);
  const landingPages = {
    DEFAULT: 'https://espacofacial.com/agendamento?unit=barrashoppingsul',
    BOTOX_35UI_PRICE_DOSE_AVISTA_ANIVERSARIO_7_ANOS: 'https://espacofacial.com/campanhas/aniversario-7-anos/botox',
    BOTOX_35UI_PRICE_DOSE_AVISTA_ANIVERSARIO_7_ANOS_V2: 'https://espacofacial.com/campanhas/aniversario-7-anos/botox-v2',
    BOTOX_35UI_PRICE_DOSE_AVISTA_ANIVERSARIO_7_ANOS_V3: 'https://espacofacial.com/campanhas/aniversario-7-anos/botox-v3',
    FRIENDLY_1: 'https://espacofacial.com/campanhas/aniversario-7-anos/friendly-1',
    FRIENDLY_2: 'https://espacofacial.com/campanhas/aniversario-7-anos/friendly-2',
    FRIENDLY_3: 'https://espacofacial.com/campanhas/aniversario-7-anos/friendly-3',
  };
  const placementChecks = [
    { adset_id: '323456789', destination_group: 'BarraShoppingSul', targeting: { effective_publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'], effective_instagram_positions: ['story', 'reels'] }, advantage_plus_eligibility: { instagram_static_image_music: true } },
    { adset_id: '323456788', destination_group: 'Novo Hamburgo', targeting: { effective_publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'], effective_instagram_positions: ['story', 'reels'] }, advantage_plus_eligibility: { instagram_static_image_music: true } },
  ];
  const destinations = [
    {
      row_number: 1,
      destination_group: 'BarraShoppingSul',
      api_version: 'v25.0',
      account_id: '123456789',
      campaign_id: '223456789',
      adset_id: '323456789',
      page_id: '423456789',
      instagram_user_id: '523456789',
      token_id: 'facebook_barra',
      allowed_link_hosts: ['espacofacial.com'],
      landing_pages_by_creative_group: options.omitLandingPages ? {} : landingPages,
      freshness_window_days: 7,
      config_revision: configRevision,
    },
    {
      row_number: 2,
      destination_group: 'Novo Hamburgo',
      api_version: 'v25.0',
      account_id: '123456789',
      campaign_id: '223456789',
      adset_id: '323456788',
      page_id: '423456788',
      instagram_user_id: '523456788',
      token_id: 'facebook_nh',
      allowed_link_hosts: ['espacofacial.com'],
      landing_pages_by_creative_group: options.omitLandingPages ? {} : landingPages,
      freshness_window_days: 7,
      config_revision: configRevision,
    },
  ];
  const drive = fileNames.map((name, index) => ({
    json: {
      id: `drive-${index + 1}`,
      name,
      mimeType: 'image/jpeg',
      md5Checksum: `checksum-${index + 1}`,
      modifiedTime: '2026-07-10T12:00:00.000Z',
      size: '102400',
      ...(options.visualAssignments?.[index] ? { visual_grouping: options.visualAssignments[index] } : {}),
    },
    binary: {
      data: {
        fileName: name,
        mimeType: 'image/jpeg',
        data: `binary-${index + 1}`,
      },
    },
  }));
  const input = { all: () => [...drive, ...destinations.map((json) => ({ json })), { json: { data: [], placement_checks: placementChecks } }] };
  const execute = new Function('$input', source('build-payload.js'));
  return execute(input);
}

function runBuildMetaParams(gateway) {
  const execute = new Function('$input', source('build-meta-api-params-from-vault.js'));
  return execute({ first: () => ({ json: gateway }) });
}

function runPrepareVisualGrouping(items) {
  const execute = new Function('$input', source('prepare-visual-grouping-batch.js'));
  return execute({ all: () => items });
}

function runValidateVisualGrouping(prepared, agentOutput) {
  const execute = new Function('$input', '$items', source('validate-visual-grouping.js'));
  return execute(
    { first: () => ({ json: { output: JSON.stringify(agentOutput) } }) },
    (name) => name === 'Prepare Visual Grouping Batch' ? prepared : [],
  );
}

function creativeNames(version = '') {
  const suffix = version ? `_${version}` : '';
  return ['2x1', '4x5', '9x16'].map((ratio) => (
    `botox__35ui__price__dose__avista__${ratio}__estatico__aniversario_7_anos${suffix}.jpg`
  ));
}

function validAiOutput(sourceAdName) {
  return {
    source_ad_name: sourceAdName,
    analysis: {
      content_type: 'image',
      detected_procedures: [{ name: 'Botox', evidence: ['Texto da arte'] }],
      adsPricing: { value: '', offer: '', source: 'none' },
      spreadsheetPricing: { value: '', offer: '', source: 'none' },
      notes: 'Copy validada para o criativo.',
    },
    creative_override: {
      bodies: ['Body 1', 'Body 2', 'Body 3', 'Body 4', 'Body 5'].map((text) => ({ text })),
      titles: ['Titulo 1', 'Titulo 2', 'Titulo 3', 'Titulo 4', 'Titulo 5'].map((text) => ({ text })),
      descriptions: [{ text: 'Descricao valida' }],
      site_links: [],
    },
  };
}

function uploadedImages(job, overrides = {}) {
  const dimensions = {
    '1x1': { width: 1080, height: 1080 },
    '2x1': { width: 1910, height: 1000 },
    '3x4': { width: 1080, height: 1440 },
    '4x5': { width: 1080, height: 1350 },
    '9x16': { width: 1080, height: 1920 },
  };
  return Object.fromEntries(job.imagens.map((image, index) => [
    image.name,
    {
      hash: `meta-hash-${index + 1}`,
      ...dimensions[image.proporcao],
      ...(overrides[image.proporcao] || {}),
    },
  ]));
}

function runBuildJobs(buildPayloadItems, inputItems, nodeOverrides = {}) {
  const nodeItems = {
    'Build Payload': buildPayloadItems,
    'Build Meta API Params From Vault': [],
    ...nodeOverrides,
  };
  // n8n's task-runner isolate does not expose the browser-style URL global.
  const execute = new Function('$input', '$items', '$', 'URL', source('build-jobs.js'));
  return execute(
    { all: () => inputItems },
    (name) => nodeItems[name] || [],
    (name) => ({ all: () => nodeItems[name] || [] }),
    undefined,
  );
}

function runCreativeValidator(inputItems, nodeOverrides = {}) {
  const execute = new Function('$input', '$items', 'URL', source('validate-meta-creative-payload.js'));
  return execute(
    { all: () => inputItems },
    (name) => nodeOverrides[name] || [],
    undefined,
  );
}

function runAttachAdvantageVerification(inputItems, sourceItems) {
  const execute = new Function('$input', '$items', source('attach-advantage-plus-verification.js'));
  return execute(
    { all: () => inputItems },
    (name) => name === 'Attach Creative Result' ? sourceItems : [],
  );
}

function runPlacementValidator(inputItems) {
  const execute = new Function('$input', source('validate-meta-placement-eligibility.js'));
  return execute({ all: () => inputItems });
}

test('inventory is requested once per account and API version', () => {
  const execute = new Function('$input', source('build-meta-inventory-requests.js'));
  const output = execute({
    all: () => [
      { json: { account_id: '123456789', api_version: 'v25.0', token_id: 'facebook_barra', adset_id: '323456789', destination_group: 'BarraShoppingSul' } },
      { json: { account_id: '123456789', api_version: 'v25.0', token_id: 'facebook_nh', adset_id: '323456788', destination_group: 'Novo Hamburgo' } },
    ],
  });
  assert.equal(output.length, 1);
  assert.deepEqual(output[0].json.destination_groups, ['BarraShoppingSul', 'Novo Hamburgo']);
  assert.deepEqual(output[0].json.alternate_token_ids, ['facebook_barra', 'facebook_nh']);
  assert.deepEqual(output[0].json.adsets, [
    { adset_id: '323456789', destination_group: 'BarraShoppingSul' },
    { adset_id: '323456788', destination_group: 'Novo Hamburgo' },
  ]);
});

test('gateway adapter injects exact scheduling defaults when deployed Worker omits landing maps', () => {
  const base = {
    token_id: 'facebook_meta_ads_publish',
    api_version: 'v25.0',
    account_id: '123',
    campaign_id: '223',
    adset_id: '323',
    page_id: '423',
    instagram_user_id: '523',
  };
  const output = runBuildMetaParams({
    ok: true,
    ready: true,
    config_revision: 'b'.repeat(64),
    destinations: [
      { ...base, row_number: 1, destination_group: 'BarraShoppingSul' },
      { ...base, row_number: 2, destination_group: 'Novo Hamburgo' },
    ],
  });
  assert.equal(output[0].json.landing_pages_by_creative_group.DEFAULT, 'https://espacofacial.com/agendamento?unit=barrashoppingsul');
  assert.equal(output[1].json.landing_pages_by_creative_group.DEFAULT, 'https://espacofacial.com/agendamento?unit=novo-hamburgo');
});

test('placement preflight accepts every required effective vertical placement', () => {
  const output = runPlacementValidator([{ json: {
    ok: true,
    placement_checks: [{
      adset_id: '323456789',
      destination_group: 'BarraShoppingSul',
      targeting: {
        effective_publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'],
        effective_facebook_positions: ['instream_reel', 'story', 'fb_reels', 'feed', 'search'],
        effective_instagram_positions: ['story', 'reels'],
        effective_audience_network_positions: ['classic'],
        effective_whatsapp_positions: ['status'],
      },
    }],
  } }]);
  assert.equal(output[0].json.placement_preflight.status, 'ok');
  assert.equal(output[0].json.placement_preflight.required_vertical_crop, '90x160');
  assert.equal(output[0].json.placement_preflight.required_horizontal_crop, '191x100');
  assert.equal(output[0].json.placement_preflight.required_horizontal_placement, 'facebook:search');
});

test('placement preflight blocks missing Facebook Search before publication', () => {
  assert.throws(() => runPlacementValidator([{ json: {
    ok: true,
    placement_checks: [{
      adset_id: '323456789',
      destination_group: 'BarraShoppingSul',
      targeting: {
        effective_publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'],
        effective_facebook_positions: ['instream_video', 'story', 'facebook_reels', 'feed'],
        effective_instagram_positions: ['story', 'reels'],
        effective_audience_network_positions: ['classic'],
        effective_whatsapp_positions: ['status'],
      },
    }],
  } }]), /facebook:search/);
});

test('placement preflight blocks missing WhatsApp Status before publication', () => {
  assert.throws(() => runPlacementValidator([{ json: {
    ok: true,
    placement_checks: [{
      adset_id: '323456789',
      destination_group: 'BarraShoppingSul',
      targeting: {
        effective_publisher_platforms: ['facebook', 'instagram', 'audience_network'],
        effective_facebook_positions: ['instream_video', 'story', 'facebook_reels'],
        effective_instagram_positions: ['story', 'reels'],
        effective_audience_network_positions: ['classic'],
        effective_whatsapp_positions: [],
      },
    }],
  } }]), /publisher:whatsapp.*whatsapp:status/);
});

test('workflow topology contains the atomic gateway path and no direct Meta mutation', () => {
  const names = new Set(workflow.nodes.map((node) => node.name));
  for (const required of [
    'Acquire Publish Run',
    'Stage Ad Batch',
    'Activate Ad Batch',
    'Verify Drive Finalization',
    'Claim Success Notification',
    'Validate Meta Placement Eligibility',
    'Prepare Visual Grouping Batch',
    'Visual Grouping Agent',
    'OpenAI Vision Model (Grouping)',
    'Validate Visual Grouping',
  ]) assert.equal(names.has(required), true, required);
  for (const removed of ['Create Ad', 'Update Ad', 'Switch', 'Record Meta Publish Result', 'Wait', 'Meta Publish Structured Output']) {
    assert.equal(names.has(removed), false, removed);
  }
  const serialized = JSON.stringify(workflow);
  for (const forbidden of ['graph.facebook.com', 'access_token', 'TOKEN_VAULT_API_TOKEN', "'v24.0'", '$getWorkflowStaticData']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(workflow.settings.errorWorkflow, 'metaAdsPublishErrorV1');
  assert.equal(workflow.settings.saveDataSuccessExecution, 'all');
  assert.equal(workflow.settings.saveDataErrorExecution, 'all');
  assert.equal(workflow.settings.saveManualExecutions, true);
  assert.equal(workflow.settings.saveExecutionProgress, true);
  assert.equal(workflow.connections['Download File'].main[0][0].node, 'Prepare Visual Grouping Batch');
  assert.equal(workflow.connections['OpenAI Vision Model (Grouping)'].ai_languageModel[0][0].node, 'Visual Grouping Agent');
});

test('visual grouping agent receives the full batch and assignments are rehydrated exactly once', () => {
  const sourceItems = ['qualquer-a.jpg', 'qualquer-b.jpg', 'qualquer-c.jpg', 'sem-padrao-1.jpg', 'sem-padrao-2.jpg', 'sem-padrao-3.jpg']
    .map((name, index) => ({
      json: { id: `drive-${index + 1}`, name, mimeType: 'image/jpeg' },
      binary: { data: { fileName: name, mimeType: 'image/jpeg', data: `binary-${index + 1}` } },
    }));
  const prepared = runPrepareVisualGrouping(sourceItems);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].json.input_count, 6);
  assert.equal(Object.keys(prepared[0].binary).length, 6);

  const agentOutput = {
    groups: [
      { group_key: 'VISUAL_GROUP_01', visual_concept: 'Conceito A', confidence: 0.98, evidence: ['Mesma oferta'] },
      { group_key: 'VISUAL_GROUP_02', visual_concept: 'Conceito B', confidence: 0.97, evidence: ['Mesmo procedimento'] },
    ],
    assignments: [
      ['IMG_001', 'VISUAL_GROUP_01', 'feed', '4x5'],
      ['IMG_002', 'VISUAL_GROUP_01', 'banner', '2x1'],
      ['IMG_003', 'VISUAL_GROUP_01', 'stories', '9x16'],
      ['IMG_004', 'VISUAL_GROUP_02', 'feed', '1x1'],
      ['IMG_005', 'VISUAL_GROUP_02', 'banner', '2x1'],
      ['IMG_006', 'VISUAL_GROUP_02', 'stories', '9x16'],
    ].map(([image_ref, group_key, slot, ratio]) => ({ image_ref, group_key, slot, ratio, confidence: 0.95, evidence: ['Correspondencia visual'] })),
    warnings: [],
  };
  const output = runValidateVisualGrouping(prepared, agentOutput);
  assert.equal(output.length, 6);
  assert.equal(new Set(output.map((item) => item.json.visual_grouping.group_key)).size, 2);
  assert.equal(output.every((item) => item.json.visual_grouping.strategy === 'ai_visual_global'), true);
  assert.equal(output.every((item) => item.binary.data), true);
});

test('visual grouping validator blocks missing and duplicate slots', () => {
  const prepared = runPrepareVisualGrouping(['a.jpg', 'b.jpg', 'c.jpg'].map((name, index) => ({
    json: { id: `drive-${index + 1}`, name, mimeType: 'image/jpeg' },
    binary: { data: { fileName: name, mimeType: 'image/jpeg', data: `binary-${index + 1}` } },
  })));
  const result = {
    groups: [{ group_key: 'VISUAL_GROUP_01', visual_concept: 'A', confidence: 0.8, evidence: ['Visual'] }],
    assignments: ['IMG_001', 'IMG_002', 'IMG_003'].map((image_ref, index) => ({
      image_ref,
      group_key: 'VISUAL_GROUP_01',
      slot: index === 2 ? 'stories' : 'feed',
      ratio: index === 2 ? '9x16' : '4x5',
      confidence: 0.8,
      evidence: ['Visual'],
    })),
    warnings: [],
  };
  assert.throws(() => runValidateVisualGrouping(prepared, result), /incompleto ou ambiguo/);
});

test('structured output contract requires exact creative copy counts', () => {
  const model = workflow.nodes.find((node) => node.name === 'OpenAI Chat Model (Agent)');
  const schema = JSON.parse(model.parameters.options.textFormat.textOptions.schema);
  const creative = schema.properties.creative_override.properties;
  assert.deepEqual([creative.bodies.minItems, creative.bodies.maxItems], [5, 5]);
  assert.deepEqual([creative.titles.minItems, creative.titles.maxItems], [5, 5]);
  assert.deepEqual([creative.descriptions.minItems, creative.descriptions.maxItems], [1, 1]);
  assert.deepEqual([creative.site_links.minItems, creative.site_links.maxItems], [0, 4]);
  assert.equal(creative.link_urls, undefined);
  assert.equal(creative.call_to_action_types, undefined);
  const responsesApiEffective = model.parameters.responsesApiEnabled === true || (
    model.parameters.responsesApiEnabled === undefined && Number(model.typeVersion || 0) >= 1.3
  );
  assert.equal(responsesApiEffective, true);
  assert.equal(model.parameters.options.textFormat.textOptions.name, 'meta_ads_publish');
  assert.equal(workflow.connections['Meta Publish Structured Output'], undefined);
});

test('structured output schema closes every object for OpenAI strict mode', () => {
  const schema = createMetaAdsPublishStructuredSchema();
  function validate(node, location = '$') {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, `${location}.additionalProperties`);
      assert.deepEqual(
        new Set(node.required || []),
        new Set(Object.keys(node.properties || {})),
        `${location}.required`,
      );
      for (const [key, child] of Object.entries(node.properties || {})) {
        validate(child, `${location}.${key}`);
      }
    }
    if (node.type === 'array') validate(node.items, `${location}[]`);
  }
  validate(schema);
});

test('3 arts remain one complete group', () => {
  const output = runBuildPayload(creativeNames());
  assert.equal(output.length, 1);
  assert.equal(output[0].json.imagens.length, 3);
  assert.equal(output[0].json.destinations.length, 2);
});

test('Build Payload blocks a missing campaign landing page before upload and AI', () => {
  assert.throws(
    () => runBuildPayload(creativeNames(), { omitLandingPages: true }),
    /Landing page ausente/,
  );
});

test('Build Payload groups arbitrary file names from global visual assignments', () => {
  const visualAssignments = [
    { strategy: 'ai_visual_global', group_key: 'VISUAL_GROUP_01', visual_concept: 'Bioestimulador com condicao especial', ratio: '4x5', slot: 'feed' },
    { strategy: 'ai_visual_global', group_key: 'VISUAL_GROUP_01', visual_concept: 'Bioestimulador com condicao especial', ratio: '2x1', slot: 'banner' },
    { strategy: 'ai_visual_global', group_key: 'VISUAL_GROUP_01', visual_concept: 'Bioestimulador com condicao especial', ratio: '9x16', slot: 'stories' },
  ];
  const output = runBuildPayload(['foto-final.jpg', 'arte nova sem ratio.jpg', 'export-xyz.jpg'], { visualAssignments });
  assert.equal(output.length, 1);
  assert.equal(output[0].json.creative_group_key, 'VISUAL_GROUP_01');
  assert.equal(output[0].json.grouping_strategy, 'ai_visual_global');
  assert.deepEqual(new Set(output[0].json.imagens.map((image) => image.proporcao)), new Set(['4x5', '2x1', '9x16']));
});

test('9 arts become 3 independent groups', () => {
  const output = runBuildPayload([
    ...creativeNames(),
    ...creativeNames('v2'),
    ...creativeNames('v3'),
  ]);
  assert.equal(output.length, 3);
  assert.equal(new Set(output.map((item) => item.json.creative_group_key)).size, 3);
  assert.equal(output.every((item) => item.json.imagens.length === 3), true);
});

test('friendly orientation names build one complete group', () => {
  const output = runBuildPayload(['Wide 1.png', 'Vertical 1.png', 'Square 1.png']);
  assert.equal(output.length, 1);
  assert.equal(output[0].json.grouping_strategy, 'friendly_orientation_plus_set');
  assert.deepEqual(
    new Set(output[0].json.imagens.map((image) => image.proporcao)),
    new Set(['2x1', '9x16', '1x1']),
  );
});

test('nine friendly orientation names build three isolated groups', () => {
  const output = runBuildPayload([1, 2, 3].flatMap((set) => [
    `Wide ${set}.png`,
    `Vertical ${set}.png`,
    `Square ${set}.png`,
  ]));
  assert.equal(output.length, 3);
  assert.equal(new Set(output.map((item) => item.json.creative_group_key)).size, 3);
  assert.equal(output.every((item) => item.json.imagens.length === 3), true);
});

test('Build Jobs accepts strict AI output and expands uploads for every destination', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  const images = uploadedImages(job);
  const output = runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images } },
    { json: validAiOutput(job.source_ad_name) },
  ]);

  assert.equal(output.length, 2);
  assert.equal(output.every((item) => item.json.error == null), true);
  assert.equal(output.every((item) => item.json.readyToCreateCreative), true);
  assert.equal(output.every((item) => item.json.readyToCreateAd), true);
  assert.equal(output.every((item) => item.json.creativePayload.asset_feed_spec.images.length === 3), true);
  assert.equal(output.every((item) => item.json.creativePayload.asset_feed_spec.bodies.length === 5), true);
  assert.equal(output.every((item) => item.json.creativePayload.asset_feed_spec.titles.length === 5), true);
  assert.equal(output.every((item) => item.json.creativePayload.asset_feed_spec.call_to_action_types[0] === 'BOOK_NOW'), true);
  assert.equal(output.every((item) => item.json.creativePayload.creative_sourcing_spec.source_url === item.json.landing_page_url), true);
  const expectedFeatures = [
    'add_text_overlay', 'image_touchups', 'music_generation', 'pac_relaxation',
    'text_optimizations', 'inline_comment', 'enhance_cta',
    'image_brightness_and_contrast', 'reveal_details_over_time',
    'show_destination_blurbs', 'image_animation',
  ];
  assert.equal(output.every((item) => expectedFeatures.every((feature) => (
    item.json.creativePayload.degrees_of_freedom_spec.creative_features_spec[feature]?.enroll_status === 'OPT_IN'
  ))), true);
  const forbiddenFeatures = [
    'media_type_automation', 'standard_enhancements', 'image_template',
    'show_summary', 'audio',
  ];
  assert.equal(output.every((item) => forbiddenFeatures.every((feature) => (
    !(feature in item.json.creativePayload.degrees_of_freedom_spec.creative_features_spec)
  ))), true);
});

test('Build Jobs applies the recommended 9:16 crop and all requested vertical placements', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  const output = runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images: uploadedImages(job) } },
    { json: validAiOutput(job.source_ad_name) },
  ]);

  for (const item of output) {
    const feed = item.json.creativePayload.asset_feed_spec;
    const vertical = feed.images.find((image) => image.image_crops && image.image_crops['90x160']);
    assert.deepEqual(vertical.image_crops['90x160'], [[0, 0], [1080, 1920]]);
    const verticalLabel = vertical.adlabels[0].name;
    const rule = feed.asset_customization_rules.find((entry) => entry.image_label.name === verticalLabel);
    assert.deepEqual(rule.customization_spec.publisher_platforms, ['facebook', 'instagram', 'audience_network', 'whatsapp']);
    assert.deepEqual(rule.customization_spec.facebook_positions, ['instream_video', 'story', 'facebook_reels']);
    assert.deepEqual(rule.customization_spec.instagram_positions, ['story', 'reels']);
    assert.deepEqual(rule.customization_spec.audience_network_positions, ['classic']);
  }
});

test('Build Jobs maps the internal 2x1 banner to the recommended 1.91:1 Facebook Search crop', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  const output = runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images: uploadedImages(job) } },
    { json: validAiOutput(job.source_ad_name) },
  ]);

  for (const item of output) {
    const feed = item.json.creativePayload.asset_feed_spec;
    const horizontal = feed.images.find((image) => image.image_crops && image.image_crops['191x100']);
    assert.deepEqual(horizontal.image_crops['191x100'], [[0, 0], [1910, 1000]]);
    const horizontalLabel = horizontal.adlabels[0].name;
    const rule = feed.asset_customization_rules.find((entry) => entry.image_label.name === horizontalLabel);
    assert.deepEqual(rule.customization_spec.publisher_platforms, ['facebook']);
    assert.deepEqual(rule.customization_spec.facebook_positions, ['search']);
  }
});

test('Build Jobs calculates a centered 1.91:1 crop for a wider horizontal source', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  const output = runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images: uploadedImages(job, { '2x1': { width: 2000, height: 1000 } }) } },
    { json: validAiOutput(job.source_ad_name) },
  ]);
  const horizontal = output[0].json.creativePayload.asset_feed_spec.images
    .find((image) => image.image_crops && image.image_crops['191x100']);
  assert.deepEqual(horizontal.image_crops['191x100'], [[45, 0], [1955, 1000]]);
});

test('Build Jobs calculates a centered 9:16 crop for a wider vertical source', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  const output = runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images: uploadedImages(job, { '9x16': { width: 1200, height: 1920 } }) } },
    { json: validAiOutput(job.source_ad_name) },
  ]);
  const vertical = output[0].json.creativePayload.asset_feed_spec.images
    .find((image) => image.image_crops && image.image_crops['90x160']);
  assert.deepEqual(vertical.image_crops['90x160'], [[60, 0], [1140, 1920]]);
});

test('Build Jobs blocks the batch when vertical upload dimensions are missing', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  assert.throws(() => runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images: uploadedImages(job, { '9x16': { width: undefined, height: undefined } }) } },
    { json: validAiOutput(job.source_ad_name) },
  ]), /vertical_crop_dimensions_missing/);
});

test('Build Jobs blocks the batch when horizontal upload dimensions are missing', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  assert.throws(() => runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images: uploadedImages(job, { '2x1': { width: undefined, height: undefined } }) } },
    { json: validAiOutput(job.source_ad_name) },
  ]), /horizontal_crop_dimensions_missing/);
});

test('Build Jobs preserves the durable run context restored before expensive operations', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const restoredItems = payloadItems.map((item) => ({
    ...item,
    json: {
      ...item.json,
      run_id: 'map_test_run',
      batch_fingerprint: 'b'.repeat(64),
    },
  }));
  const job = payloadItems[0].json;
  const images = uploadedImages(job);
  const output = runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images } },
    { json: validAiOutput(job.source_ad_name) },
  ], { 'Restore Publish Groups': restoredItems });

  assert.equal(output.every((item) => item.json.run_id === 'map_test_run'), true);
  assert.equal(output.every((item) => item.json.batch_fingerprint === 'b'.repeat(64)), true);
});

test('creative validator recovers run context when retry starts at the failed node', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  const images = uploadedImages(job);
  const built = runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images } },
    { json: validAiOutput(job.source_ad_name) },
  ]);
  const restoredItems = payloadItems.map((item) => ({
    ...item,
    json: { ...item.json, run_id: 'map_retry_run', batch_fingerprint: 'c'.repeat(64) },
  }));
  const validated = runCreativeValidator(built, { 'Restore Publish Groups': restoredItems });

  assert.equal(validated.every((item) => item.json.run_id === 'map_retry_run'), true);
  assert.equal(validated.every((item) => item.json.meta_creative_validation.status === 'ok'), true);
});

test('creative validator blocks a stale primary link instead of repairing or falling back', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  const images = uploadedImages(job);
  const built = runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images } },
    { json: validAiOutput(job.source_ad_name) },
  ]).map((item) => {
    item.json.run_id = '';
    item.json.batch_fingerprint = '';
    item.json.creativePayload.asset_feed_spec.link_urls = [{ website_url: '' }];
    return item;
  });
  const restoredItems = payloadItems.map((item) => ({
    ...item,
    json: { ...item.json, run_id: 'map_retry_link', batch_fingerprint: 'd'.repeat(64) },
  }));

  assert.throws(
    () => runCreativeValidator(built, { 'Restore Publish Groups': restoredItems }),
    /primary_link_invalid/,
  );
});

test('Advantage+ readback remains informational when Meta cannot expose verification fields', () => {
  const sourceItems = [{ json: {
    job_key: 'group-unit',
    creative_id: '123456789',
    advantage_plus_requested_features: ['image_touchups', 'text_optimizations'],
    advantage_plus_site_links: [],
    warnings: [],
  } }];
  const output = runAttachAdvantageVerification([{ json: {
    status: 400,
    error: { message: 'readback unavailable' },
  }, pairedItem: { item: 0 } }], sourceItems);

  assert.equal(output.length, 1);
  assert.equal(output[0].json.creative_id, '123456789');
  assert.equal(output[0].json.advantage_plus_verification.status, 'unavailable');
  assert.equal(output[0].json.warnings.length, 1);
});

test('Advantage+ readback classifies absent feature fields as not_reported, never as applied', () => {
  const sourceItems = [{ json: {
    job_key: 'group-unit',
    creative_id: '123456789',
    advantage_plus_requested_features: ['image_touchups', 'music_generation'],
    advantage_plus_site_links: [],
    warnings: [],
  } }];
  const output = runAttachAdvantageVerification([{ json: {
    ok: true,
    operation: { status: 'completed', result: { id: '123456789' } },
  }, pairedItem: { item: 0 } }], sourceItems);

  assert.equal(output[0].json.advantage_plus_verification.status, 'inconclusive');
  assert.deepEqual(output[0].json.advantage_plus_verification.reported_opt_in, []);
  assert.deepEqual(output[0].json.advantage_plus_verification.not_reported, ['image_touchups', 'music_generation']);
  assert.deepEqual(output[0].json.advantage_plus_applied_features, []);
});

test('Build Jobs ignores AI destination fields and uses the exact Token Vault campaign landing page', () => {
  const payloadItems = runBuildPayload(creativeNames());
  const job = payloadItems[0].json;
  const images = uploadedImages(job);
  const ai = validAiOutput(job.source_ad_name);
  ai.creative_override.link_urls = [{ website_url: 'https://example.invalid/campaign' }];
  ai.creative_override.call_to_action_types = ['WHATSAPP_MESSAGE'];

  const output = runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images } },
    { json: ai },
  ]);

  assert.equal(output.length, 2);
  assert.equal(output.every((item) => item.json.error == null), true);
  assert.equal(output.every((item) => (
    item.json.creativePayload.asset_feed_spec.link_urls[0].website_url === 'https://espacofacial.com/campanhas/aniversario-7-anos/botox'
  )), true);
  assert.equal(output.every((item) => (
    item.json.creativePayload.asset_feed_spec.call_to_action_types[0] === 'BOOK_NOW'
  )), true);
});

test('Build Jobs blocks the whole destination when the campaign landing page mapping is absent', () => {
  const payloadItems = runBuildPayload(creativeNames()).map((item) => ({
    ...item,
    json: {
      ...item.json,
      destinations: item.json.destinations.map((destination) => ({ ...destination, landing_pages_by_creative_group: {} })),
    },
  }));
  const job = payloadItems[0].json;
  assert.throws(() => runBuildJobs(payloadItems, [
    { json: { account_id: '123456789', images: uploadedImages(job) } },
    { json: validAiOutput(job.source_ad_name) },
  ]), /landing_page_mapping_missing/);
});

test('incomplete or duplicate slots block the whole batch', () => {
  assert.throws(() => runBuildPayload(creativeNames().slice(0, 2)), /grupos incompletos|Nenhum grupo completo/);
  assert.throws(() => runBuildPayload([
    ...creativeNames(),
    'botox__35ui__price__dose__avista__3x4__estatico__aniversario_7_anos.jpg',
  ]), /slots duplicados/);
});

test('historical execution 21 preserves mixed create/update business behavior', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'execution-21.json'), 'utf8'));
  assert.equal(fixture.build_jobs.length, 2);
  assert.deepEqual(new Set(fixture.build_jobs.map((job) => job.action)), new Set(['create_new', 'replace_existing']));
  assert.equal(fixture.create_creative.success, 2);
});

test('historical execution 25 would stop before ad staging', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'execution-25.json'), 'utf8'));
  assert.equal(fixture.build_payload.length, 3);
  assert.equal(fixture.build_jobs.length, 6);
  assert.equal(fixture.create_creative.success, 5);
  assert.equal(fixture.create_creative.errors.length, 1);
  const allCreativesReady = fixture.create_creative.success === fixture.build_jobs.length;
  assert.equal(allCreativesReady, false);
  assert.equal(workflow.connections['Attach Advantage+ Verification'].main[0][0].node, 'Build Stage Batch');
});

test('fixtures are sanitized', () => {
  const fixtureText = fs.readdirSync(fixtureRoot)
    .filter((name) => name.endsWith('.json'))
    .map((name) => fs.readFileSync(path.join(fixtureRoot, name), 'utf8'))
    .join('\n');
  for (const forbidden of ['access_token', 'token_ciphertext', 'Bearer ', 'EAA']) {
    assert.equal(fixtureText.includes(forbidden), false, forbidden);
  }
});
