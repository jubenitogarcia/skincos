import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __test,
  handleMetaAdsPublishRequest,
} from '../src/meta-ads-publish.js';

class ConfigStatement {
  constructor(rows) {
    this.rows = rows;
  }

  bind() {
    return this;
  }

  async all() {
    return { results: this.rows };
  }
}

class ConfigDb {
  constructor(rows) {
    this.rows = rows;
  }

  prepare(sql) {
    assert.match(sql, /FROM credential_tokens/);
    return new ConfigStatement(this.rows);
  }
}

function configRow(id, unit, rowNumber) {
  return {
    id,
    unit,
    external_account_id: '123456789',
    token_type: 'long_lived_access_token',
    expires_at: null,
    active: 1,
    updated_at: '2026-07-10T00:00:00.000Z',
    metadata_json: JSON.stringify({
      meta_ads_publish: {
        row_number: rowNumber,
        destination_group: unit,
        api_version: 'v25.0',
        account_id: '123456789',
        campaign_id: '223456789',
        adset_id: String(323456780 + rowNumber),
        page_id: String(423456780 + rowNumber),
        instagram_user_id: String(523456780 + rowNumber),
        carousel_native_campaign_id: '723456789',
        carousel_native_adset_id: String(823456780 + rowNumber),
        carousel_native_adset_verified: true,
        carousel_native_route_active: true,
        allowed_link_hosts: ['espacofacial.com'],
        landing_pages_by_creative_group: {
          BOTOX_35UI_PRICE_DOSE_AVISTA_ANIVERSARIO_7_ANOS: 'https://espacofacial.com/campanhas/aniversario-7-anos/botox',
        },
      },
    }),
  };
}

test('config exposes metadata and opaque token ids without token material', async () => {
  const env = { TOKEN_VAULT_DB: new ConfigDb([
    configRow('facebook_barra', 'BarraShoppingSul', 1),
    configRow('facebook_nh', 'Novo Hamburgo', 2),
  ]), LANDING_PAGE_FETCH: async () => new Response('', { status: 200 }) };
  const result = await handleMetaAdsPublishRequest({
    request: new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config'),
    env,
    requestId: 'test-request',
    pathname: '/v1/meta-ads-publish/config',
    decryptToken: async () => { throw new Error('must not decrypt config'); },
    writeAudit: async () => {},
  });
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(body.ready, true);
  assert.equal(body.destinations.length, 2);
  assert.equal(body.destinations[0].token_id, 'facebook_barra');
  assert.equal(JSON.stringify(body).includes('access_token'), false);
  assert.equal(JSON.stringify(body).includes('token_ciphertext'), false);
  assert.equal(body.destinations[0].landing_page_validation.ok, true);
  assert.equal(body.destinations[0].carousel_native_adset_verified, true);
  assert.equal(body.destinations[0].carousel_native_route_active, true);
  assert.equal(body.destinations[0].landing_pages_by_creative_group.BOTOX_35UI_PRICE_DOSE_AVISTA_ANIVERSARIO_7_ANOS, 'https://espacofacial.com/campanhas/aniversario-7-anos/botox');
  assert.match(body.config_revision, /^[a-f0-9]{64}$/);
  assert.equal(body.capabilities.workflow_contract_revision, 'meta_destination_contract_v18_live_campaign_cta');
  assert.deepEqual(body.capabilities.video_upload.supported_actions, __test.videoUploadActions);
  assert.equal(body.capabilities.video_upload.max_file_bytes, 90 * 1024 * 1024);
  assert.equal(body.capabilities.video_upload.max_chunk_bytes, 16 * 1024 * 1024);
});

function flexibleStaticFeed() {
  const label = (prefix, index) => ({ name: `${prefix}_${index}` });
  return {
    ad_formats: ['SINGLE_IMAGE'],
    images: [
      { hash: 'a', adlabels: [{ name: 'feed_image' }] },
      { hash: 'b', adlabels: [{ name: 'banner_image' }] },
      { hash: 'c', adlabels: [{ name: 'vertical_image' }] },
    ],
    bodies: Array.from({ length: 5 }, (_, index) => ({ text: `body-${index}`, adlabels: [label('body', index)] })),
    titles: Array.from({ length: 5 }, (_, index) => ({ text: `title-${index}`, adlabels: [label('title', index)] })),
    descriptions: Array.from({ length: 5 }, (_, index) => ({ text: `description-${index}`, adlabels: [label('description', index)] })),
    link_urls: [{ website_url: 'https://espacofacial.com/campanhas/botox' }],
    call_to_action_types: ['BOOK_NOW'],
    asset_customization_rules: [
      { image_label: { name: 'feed_image' }, body_label: label('body', 0), title_label: label('title', 0), description_label: label('description', 0), customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['feed'] } },
      { image_label: { name: 'banner_image' }, body_label: label('body', 1), title_label: label('title', 1), description_label: label('description', 1), customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['search'] } },
      { image_label: { name: 'vertical_image' }, body_label: label('body', 2), title_label: label('title', 2), description_label: label('description', 2), customization_spec: { publisher_platforms: ['instagram'], instagram_positions: ['story'] } },
    ],
  };
}

function requiredCreativeFeatures() {
  return Object.fromEntries([
    'add_text_overlay', 'image_touchups', 'text_optimizations', 'inline_comment',
    'enhance_cta', 'image_brightness_and_contrast', 'reveal_details_over_time',
    'show_destination_blurbs', 'image_animation', 'music_generation', 'pac_relaxation',
  ].map((feature) => [feature, { enroll_status: 'OPT_IN' }]));
}

test('flexible creative quality gate requires 3 images, 5 bodies, 5 titles and 5 descriptions', () => {
  const payload = {
    name: 'Botox',
    object_story_spec: { page_id: '123456789' },
    asset_feed_spec: flexibleStaticFeed(),
    creative_sourcing_spec: { source_url: 'https://espacofacial.com/campanhas/botox' },
    degrees_of_freedom_spec: {
      creative_features_spec: requiredCreativeFeatures(),
    },
  };
  const validated = __test.validateCreativePayload(payload, 'creative:group:unit');
  assert.match(validated.name, /\[sk:creativegrou\]/);
  assert.throws(
    () => __test.validateCreativePayload({ ...payload, asset_feed_spec: { ...payload.asset_feed_spec, titles: [{ text: 'one' }] } }, 'creative:bad'),
    /creative_quality_gate_failed/,
  );
});

test('flexible creative quality gate accepts an explicit WhatsApp destination', () => {
  const payload = {
    name: 'Botox WhatsApp',
    object_story_spec: { page_id: '123456789' },
    asset_feed_spec: {
      ...flexibleStaticFeed(),
      link_urls: [{ website_url: 'https://api.whatsapp.com/send' }],
      call_to_action_types: ['WHATSAPP_MESSAGE'],
    },
    creative_sourcing_spec: { source_url: 'https://api.whatsapp.com/send' },
    degrees_of_freedom_spec: { creative_features_spec: requiredCreativeFeatures() },
  };
  assert.doesNotThrow(() => __test.validateCreativePayload(payload, 'creative:whatsapp:unit'));
});

test('video-only flexible creative accepts the labeled 9:16 contract', () => {
  const label = (prefix, index) => ({ name: `${prefix}_${index}` });
  const payload = {
    name: 'Video vertical',
    object_story_spec: { page_id: '123456789' },
    asset_feed_spec: {
      ad_formats: ['SINGLE_VIDEO'],
      optimization_type: 'PLACEMENT',
      videos: [{ video_id: '123456789', thumbnail_hash: 'thumbhash0123456789', adlabels: [{ name: 'vertical_video' }] }],
      bodies: Array.from({ length: 5 }, (_, index) => ({ text: `body-${index}`, adlabels: [label('body', index)] })),
      titles: Array.from({ length: 5 }, (_, index) => ({ text: `title-${index}`, adlabels: [label('title', index)] })),
      descriptions: Array.from({ length: 5 }, (_, index) => ({ text: `description-${index}`, adlabels: [label('description', index)] })),
      link_urls: [{ website_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' }],
      call_to_action_types: ['BOOK_NOW'],
      asset_customization_rules: [
        { video_label: { name: 'vertical_video' }, body_label: label('body', 0), title_label: label('title', 0), description_label: label('description', 0), customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['feed'] } },
        { video_label: { name: 'vertical_video' }, body_label: label('body', 1), title_label: label('title', 1), description_label: label('description', 1), customization_spec: { publisher_platforms: ['audience_network'], audience_network_positions: ['rewarded_video'] } },
      ],
    },
    creative_sourcing_spec: { source_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' },
    degrees_of_freedom_spec: { creative_features_spec: requiredCreativeFeatures() },
  };
  assert.doesNotThrow(() => __test.validateCreativePayload(payload, 'creative:video:unit'));
});

test('native carousel contract accepts labeled card attachments and rejects flexible-only fields', () => {
  const payload = {
    name: '[TEST-CAROUSEL-NATIVE] Restylane',
    object_story_spec: {
      page_id: '123456789',
      instagram_actor_id: '987654321',
      link_data: {
        link: 'https://espacofacial.com/agendamento?unit=barrashoppingsul',
        message: 'Conheça as etapas do procedimento.',
        call_to_action: { type: 'BOOK_NOW', value: { link: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' } },
        child_attachments: [
          { image_hash: 'image-one', name: 'Etapa 1', link: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' },
          { image_hash: 'image-two', name: 'Etapa 2', link: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' },
        ],
      },
    },
    creative_sourcing_spec: { source_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' },
  };
  const validated = __test.validateCreativePayload(payload, 'creative:native:unit');
  assert.match(validated.name, /\[sk:creativenati\]/);
  assert.throws(
    () => __test.validateCreativePayload({ ...payload, degrees_of_freedom_spec: { creative_features_spec: {} } }, 'creative:native:bad'),
    /native_carousel_advantage_plus_unsupported/,
  );
  const whatsapp = structuredClone(payload);
  whatsapp.object_story_spec.link_data.link = 'https://api.whatsapp.com/send';
  whatsapp.object_story_spec.link_data.call_to_action = { type: 'WHATSAPP_MESSAGE', value: { link: 'https://api.whatsapp.com/send' } };
  whatsapp.object_story_spec.link_data.child_attachments.forEach((card) => { card.link = 'https://api.whatsapp.com/send'; });
  delete whatsapp.creative_sourcing_spec;
  assert.doesNotThrow(() => __test.validateCreativePayload(whatsapp, 'creative:native:whatsapp'));
});

test('landing page validation rejects redirects to WhatsApp before any Meta operation', async () => {
  const definition = __test.normalizeLandingPageMap({
    BOTOX_CAMPAIGN: 'https://espacofacial.com/campanhas/botox',
  }, ['espacofacial.com']);
  assert.deepEqual(definition.errors, []);
  const validation = await __test.validateLandingPagesOnline(definition.pages, ['espacofacial.com'], {
    LANDING_PAGE_FETCH: async () => new Response('', {
      status: 302,
      headers: { location: 'https://wa.me/5551995103563' },
    }),
  });
  assert.equal(validation.results.BOTOX_CAMPAIGN, undefined);
  assert.equal(validation.errors[0].error, 'landing_page_whatsapp_forbidden');
});

test('creative gateway rejects legacy or catalog-only enhancement keys', () => {
  const payload = {
    name: 'Botox',
    object_story_spec: { page_id: '123456789' },
    asset_feed_spec: flexibleStaticFeed(),
    creative_sourcing_spec: { source_url: 'https://espacofacial.com/campanhas/botox' },
    degrees_of_freedom_spec: {
      creative_features_spec: {
        media_type_automation: { enroll_status: 'OPT_IN' },
      },
    },
  };
  assert.throws(() => __test.validateCreativePayload(payload, 'creative:legacy'), /creative_feature_forbidden:media_type_automation/);
});

test('creative readback requests only fields supported by the Graph creative object', () => {
  assert.equal(__test.creativeReadFields.includes('created_time'), false);
  assert.equal(__test.creativeReadFields.includes('updated_time'), false);
  assert.equal(__test.creativeReadFields.includes('asset_feed_spec'), true);
  assert.equal(__test.creativeReadFields.includes('degrees_of_freedom_spec'), true);
});

test('video upload gateway uses Graph Video phases and enforces the chunk contract', async () => {
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    const parsed = new URL(url);
    const form = init.body;
    calls.push({ host: parsed.host, path: parsed.pathname, phase: form.get('upload_phase'), startOffset: form.get('start_offset') });
    if (form.get('upload_phase') === 'start') return jsonResponse({ upload_session_id: '123456', video_id: '987654321', start_offset: '0', end_offset: '1024' });
    if (form.get('upload_phase') === 'transfer') return jsonResponse({ start_offset: '0', end_offset: '1024' });
    return jsonResponse({ success: true });
  });
  context.action = 'start_video_upload';
  const start = await __test.startVideoUpload({ token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', file_size: 1024 }, context);
  assert.equal(start.video_id, '987654321');
  context.action = 'transfer_video_chunk';
  context.file = new Blob([new Uint8Array(1024)], { type: 'video/mp4' });
  await __test.transferVideoChunk({ token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', upload_session_id: '123456', start_offset: 0, file_name: 'creative.mp4' }, context);
  context.action = 'finish_video_upload';
  await __test.finishVideoUpload({ token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', upload_session_id: '123456' }, context);
  assert.deepEqual(calls.map((call) => call.phase), ['start', 'transfer', 'finish']);
  assert.ok(calls.every((call) => call.host === 'graph-video.facebook.com' && call.path === '/v25.0/act_123456789/advideos'));
  assert.throws(() => __test.normalizeVideoFileSize(91 * 1024 * 1024), /video_size_invalid/);
  await assert.rejects(
    () => __test.transferVideoChunk({ token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', upload_session_id: '123456', start_offset: 0 }, { ...context, file: new Blob([new Uint8Array(16 * 1024 * 1024 + 1)]) }),
    /video_chunk_size_invalid/,
  );
});

test('video upload actions stay part of the gateway capability contract', () => {
  assert.deepEqual(__test.videoUploadActions, ['start_video_upload', 'transfer_video_chunk', 'finish_video_upload', 'get_video_status']);
});

test('adset placement readback requests effective WhatsApp and vertical placement fields', () => {
  assert.match(__test.adsetPlacementFields, /campaign\{id,objective\}/);
  assert.match(__test.adsetPlacementFields, /optimization_goal/);
  assert.match(__test.adsetPlacementFields, /effective_whatsapp_positions/);
  assert.match(__test.adsetPlacementFields, /effective_facebook_positions/);
  assert.match(__test.adsetPlacementFields, /effective_instagram_positions/);
  assert.match(__test.adsetPlacementFields, /effective_audience_network_positions/);
});

test('native-carousel calibration ad sets are constrained to paused, explicit delivery payloads', () => {
  const payload = {
    name: '[TEST-CAROUSEL-NATIVE] BSS',
    campaign_id: '123456789',
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'CONVERSATIONS',
    targeting: { publisher_platforms: ['facebook', 'instagram'] },
  };
  assert.equal(__test.validatePausedAdsetPayload(payload).status, 'PAUSED');
  assert.throws(() => __test.validatePausedAdsetPayload({ ...payload, status: 'ACTIVE' }), /adset_must_be_paused/);
  assert.throws(() => __test.validatePausedAdsetPayload({ ...payload, account_id: 'forbidden' }), /adset_field_forbidden:account_id/);
  assert.match(__test.adsetReadFields, /promoted_object/);
  assert.match(__test.adsetReadFields, /destination_type/);
});

test('native-carousel calibration campaigns are limited to paused supported objectives', () => {
  const payload = {
    name: '[TEST-CAROUSEL-NATIVE] BSS',
    objective: 'OUTCOME_ENGAGEMENT',
    buying_type: 'AUCTION',
    special_ad_categories: [],
    status: 'PAUSED',
  };
  assert.equal(__test.validatePausedCampaignPayload(payload).objective, 'OUTCOME_ENGAGEMENT');
  assert.equal(__test.validatePausedCampaignPayload({ ...payload, objective: 'OUTCOME_LEADS' }).objective, 'OUTCOME_LEADS');
  assert.throws(() => __test.validatePausedCampaignPayload({ ...payload, objective: 'OUTCOME_SALES' }), /campaign_payload_invalid/);
  assert.throws(() => __test.validatePausedCampaignPayload({ ...payload, status: 'ACTIVE' }), /campaign_must_be_paused/);
});

test('campaign calibration readback requests the delivery contract fields', () => {
  assert.match(__test.campaignReadFields, /objective/);
  assert.match(__test.campaignReadFields, /is_adset_budget_sharing_enabled/);
});

test('native carousel promotion can only activate explicitly named routes', () => {
  const payload = {
    campaign_id: '123456789',
    campaign_name: '[NATIVE-CAROUSEL] WhatsApp',
    adsets: [{ id: '223456789', name: '[NATIVE-CAROUSEL] BSS' }],
    test_ad_ids: ['323456789'],
  };
  assert.equal(__test.validateNativeCarouselRoutePromotion(payload).adsets.length, 1);
  assert.throws(
    () => __test.validateNativeCarouselRoutePromotion({ ...payload, campaign_name: 'Campaign' }),
    /native_carousel_campaign_name_required/,
  );
  assert.throws(
    () => __test.validateNativeCarouselRoutePromotion({ ...payload, test_ad_ids: [] }),
    /native_carousel_test_ad_count_invalid/,
  );
});

test('batch validation rejects duplicate replacement targets', () => {
  const job = {
    operation_key: 'job:barra:botox:1',
    action: 'replace_existing',
    target_ad_id: '120246883241450157',
    destination_group: 'BarraShoppingSul',
    creative_group_key: 'botox-v1',
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
    ad_payload: {
      name: 'Botox | BarraShoppingSul',
      creative: { creative_id: '1024340013785371' },
    },
  };
  assert.throws(() => __test.validateBatchJobs([job, { ...job, operation_key: 'job:barra:botox:2' }]), /duplicate_batch_target/);
});

test('error classification retries only transient Meta failures', () => {
  const permanent = __test.normalizeMetaError({ error: { code: 100, message: 'Invalid parameter' } }, 400, new Headers());
  assert.equal(permanent.classification, 'permanent');
  assert.equal(permanent.retryable, false);

  const transient = __test.normalizeMetaError({ error: { code: 2, is_transient: true, message: 'Temporary' } }, 500, new Headers());
  assert.equal(transient.classification, 'transient');
  assert.equal(transient.retryable, true);
});

test('fresh ad-image propagation is retried only for creative creation', () => {
  const errorBody = {
    error: {
      code: 100,
      error_subcode: 2446386,
      message: 'Selected image is not available yet',
    },
  };
  const creativeFailure = __test.normalizeMetaError(errorBody, 400, new Headers(), 'create_creative');
  assert.equal(creativeFailure.classification, 'transient');
  assert.equal(creativeFailure.retryable, true);
  assert.equal(creativeFailure.propagation_retry, true);
  assert.equal(__test.retryDelayMs(1, new Headers(), Date.now(), creativeFailure), 15_000);
  assert.equal(__test.retryDelayMs(2, new Headers(), Date.now(), creativeFailure), 30_000);

  const unrelatedFailure = __test.normalizeMetaError(errorBody, 400, new Headers(), 'get_ad');
  assert.equal(unrelatedFailure.classification, 'permanent');
  assert.equal(unrelatedFailure.retryable, false);
  assert.equal(unrelatedFailure.propagation_retry, false);
});

test('Meta generic retry-later creative failure is retried only for creative creation', () => {
  const errorBody = {
    error: {
      code: 100,
      error_subcode: 1487390,
      error_user_msg: 'Ocorreu um erro. Tente novamente mais tarde',
    },
  };
  const creativeFailure = __test.normalizeMetaError(errorBody, 400, new Headers(), 'create_creative');
  assert.equal(creativeFailure.classification, 'transient');
  assert.equal(creativeFailure.retryable, true);
  assert.equal(creativeFailure.creative_retry, true);

  const unrelatedFailure = __test.normalizeMetaError(errorBody, 400, new Headers(), 'get_ad');
  assert.equal(unrelatedFailure.classification, 'permanent');
  assert.equal(unrelatedFailure.retryable, false);
  assert.equal(unrelatedFailure.creative_retry, false);
});

test('creative creation waits for fresh image hashes and succeeds without duplicating the operation', async () => {
  let attempts = 0;
  const delays = [];
  const context = {
    action: 'create_creative',
    attempts: 0,
    rateUsage: {},
    traceId: '',
    env: {
      META_GRAPH_FETCH: async () => {
        attempts += 1;
        if (attempts < 3) {
          return new Response(JSON.stringify({
            error: {
              code: 100,
              error_subcode: 2446386,
              message: 'Selected image is not available yet',
            },
          }), { status: 400, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ id: 'creative-accepted' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      META_GRAPH_SLEEP: async (delay) => delays.push(delay),
    },
  };

  const result = await __test.graphRequest(
    'https://graph.facebook.com/v25.0/act_123/adcreatives',
    { method: 'POST', body: '{}' },
    { accessToken: 'test-token', appSecretProof: '' },
    context,
  );

  assert.equal(result.body.id, 'creative-accepted');
  assert.equal(attempts, 3);
  assert.equal(context.attempts, 3);
  assert.deepEqual(delays, [15_000, 30_000]);
});

test('pagination accepts only the official Graph host and current API version', () => {
  const valid = __test.validatePagingUrl('https://graph.facebook.com/v25.0/act_123/ads?after=cursor&access_token=secret', 'v25.0');
  assert.equal(valid.includes('access_token'), false);
  assert.throws(() => __test.validatePagingUrl('https://example.com/v25.0/act_123/ads', 'v25.0'), /invalid_meta_paging_url/);
  assert.throws(() => __test.validatePagingUrl('https://graph.facebook.com/v24.0/act_123/ads', 'v25.0'), /invalid_meta_paging_url/);
});

test('sanitizer strips token fields recursively', () => {
  const sanitized = __test.sanitizeGraphValue({
    id: '1',
    access_token: 'secret',
    nested: { token: 'secret', authorization: 'secret', keep: true },
  });
  assert.deepEqual(sanitized, { id: '1', nested: { keep: true } });
});

test('rollback payload restores mutable ad state', () => {
  assert.deepEqual(__test.previousStatePayload({
    name: 'Old ad',
    status: 'PAUSED',
    adset_id: '323456789',
    creative: { id: '623456789' },
  }), {
    name: 'Old ad',
    status: 'PAUSED',
    adset_id: '323456789',
    creative: { creative_id: '623456789' },
  });
});

class GatewayStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes('FROM credential_tokens')) return this.db.credential;
    if (this.sql.includes('FROM meta_ads_publish_locks')) return null;
    if (this.sql.includes('FROM meta_ads_publish_operations')) return null;
    return null;
  }

  async all() {
    return { results: [] };
  }

  async run() {
    this.db.statements.push({ sql: this.sql, values: this.values });
    return { success: true };
  }
}

class GatewayDb {
  constructor() {
    this.statements = [];
    this.credential = {
      id: 'facebook_barra',
      provider: 'facebook',
      active: 1,
      token_ciphertext: 'encrypted',
      metadata_json: JSON.stringify({ meta_ads_publish: { account_id: '123456789', api_version: 'v25.0' } }),
    };
  }

  prepare(sql) {
    return new GatewayStatement(this, sql);
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function gatewayContext(fetchImpl) {
  const db = new GatewayDb();
  return {
    db,
    context: {
      env: {
        TOKEN_VAULT_DB: db,
        META_GRAPH_FETCH: fetchImpl,
        META_GRAPH_SLEEP: async () => {},
      },
      runId: 'run-test',
      operationKey: 'stage:run-test',
      decryptToken: async () => 'fixture-secret',
      attempts: 0,
      rateUsage: {},
      traceId: '',
    },
  };
}

function replacementJob(adId, operationKey) {
  return {
    operation_key: operationKey,
    action: 'replace_existing',
    target_ad_id: adId,
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
    destination_group: `unit-${adId}`,
    creative_group_key: `group-${adId}`,
    creative_id: `9${adId}`,
    ad_payload: {
      name: `New ad ${adId}`,
      status: 'PAUSED',
      creative: { creative_id: `9${adId}` },
      adset_id: '323456789',
    },
    files: [{ id: `drive-${adId}`, name: `${adId}.jpg`, ratio: '4x5' }],
  };
}

test('stage batch compensates earlier ads when a later permanent mutation fails', async () => {
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'GET') {
      const adId = parsed.pathname.split('/').pop();
      return jsonResponse({ id: adId, name: `Old ad ${adId}`, status: 'ACTIVE', adset_id: '323456789', creative: { id: `8${adId}` } });
    }
    if (parsed.pathname.endsWith('/22222')) {
      return jsonResponse({ error: { code: 100, message: 'Invalid parameter', is_transient: false } }, 400);
    }
    return jsonResponse({ success: true });
  });

  let caught;
  try {
    await __test.stageBatch({ jobs: [replacementJob('11111', 'job:one1'), replacementJob('22222', 'job:two2')] }, context);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(caught.classification, 'permanent');
  assert.equal(caught.compensation.reconciliation_required, false);
  assert.equal(caught.compensation.results.length, 1);
  const firstAdPosts = calls.filter((call) => call.path.endsWith('/11111') && call.method === 'POST');
  assert.equal(firstAdPosts.length, 2);
  assert.equal(firstAdPosts[1].body.name, 'Old ad 11111');
  assert.equal(firstAdPosts[1].body.creative.creative_id, '811111');
});

test('ambiguous update timeout reconciles by reading the final ad state', async () => {
  let calls = 0;
  const intended = {
    name: 'Intended ad',
    status: 'PAUSED',
    adset_id: '323456789',
    creative: { creative_id: '923456789' },
  };
  const { context } = gatewayContext(async (url, init) => {
    calls += 1;
    if (init.method === 'POST') throw new TypeError('network disconnected after request');
    return jsonResponse({
      id: '120246883241450157',
      name: intended.name,
      status: intended.status,
      adset_id: intended.adset_id,
      creative: { id: intended.creative.creative_id },
    });
  });
  const result = await __test.updateAdWithReconciliation(
    { accountId: '123456789', apiVersion: 'v25.0', accessToken: 'fixture-secret', appSecretProof: '' },
    '120246883241450157',
    intended,
    context,
  );
  assert.equal(result.reconciled_after_ambiguous_response, true);
  assert.equal(calls, 4);
});

class LockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) { this.values = values; return this; }

  async first() {
    const lock = this.db.locks.get(this.values[0]);
    return lock ? { ...lock } : null;
  }

  async run() {
    if (this.sql.includes('INSERT INTO meta_ads_publish_locks')) {
      const [resourceKey, runId, operationKey, heartbeatAt, expiresAt] = this.values;
      const current = this.db.locks.get(resourceKey);
      if (!current || Date.parse(current.expires_at) <= Date.now() || current.run_id === runId) {
        this.db.locks.set(resourceKey, {
          resource_key: resourceKey,
          run_id: runId,
          operation_key: operationKey,
          heartbeat_at: heartbeatAt,
          expires_at: expiresAt,
        });
      }
    }
    return { success: true };
  }
}

test('resource locks reject concurrent runs targeting the same ad', async () => {
  const db = { locks: new Map(), prepare(sql) { return new LockStatement(this, sql); } };
  const env = { TOKEN_VAULT_DB: db };
  await __test.acquireLocks(env, 'run-one', 'operation-one', ['ad:120246883241450157']);
  await assert.rejects(
    () => __test.acquireLocks(env, 'run-two', 'operation-two', ['ad:120246883241450157']),
    /resource_locked/,
  );
});
