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
        destination_type: 'website',
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
        tracking_contract: {
          url_tags: 'key1=value1&key2=value2%20encoded',
          profile_ref: 'website_schedule_v1',
          production_url_tags_readback_fixture: {
            ad_id: '723456789',
            creative_id: '823456789',
          },
        },
        tracking_profiles: {
          website_schedule_v1: {
            source_adset_id: '623456789',
            destination_kind: 'website',
            website_event_requirement: 'required',
            offline_event_dataset_requirement: 'required',
            staging_synthetic_fixture: true,
            authorized_destination_adset_ids: [String(823456780 + rowNumber)],
          },
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
  assert.equal(body.destinations[0].tracking_contract.url_tags, 'key1=value1&key2=value2%20encoded');
  assert.equal(body.destinations[0].tracking_contract.url_tags_configured, true);
  assert.equal(body.destinations[0].tracking_contract.profile_ref, 'website_schedule_v1');
  assert.equal(body.destinations[0].tracking_contract.profile_configured, true);
  assert.equal(body.destinations[0].tracking_contract.website_event_requirement, 'required');
  assert.equal(body.destinations[0].tracking_contract.offline_event_dataset_requirement, 'required');
  assert.equal(body.destinations[0].tracking_contract.staging_synthetic_fixture, true);
  assert.equal(body.destinations[0].tracking_contract.production_url_tags_readback_fixture_configured, true);
  assert.equal(JSON.stringify(body.destinations[0].tracking_contract).includes('623456789'), false);
  assert.equal(JSON.stringify(body.destinations[0].tracking_contract).includes('723456789'), false);
  assert.equal(JSON.stringify(body.destinations[0].tracking_contract).includes('823456789'), false);
  assert.match(body.config_revision, /^[a-f0-9]{64}$/);
  assert.equal(body.capabilities.workflow_contract_revision, 'meta_destination_contract_v20_tracking_reconciliation');
  assert.equal(body.capabilities.tracking.adset_conversion_reconciliation, true);
  assert.equal(body.capabilities.tracking.creative_url_tags_readback, true);
  assert.equal(body.capabilities.tracking.authorized_creative_url_tags_readback, true);
  assert.deepEqual(body.capabilities.video_upload.supported_actions, __test.videoUploadActions);
  assert.equal(body.capabilities.video_upload.max_file_bytes, 90 * 1024 * 1024);
  assert.equal(body.capabilities.video_upload.max_chunk_bytes, 16 * 1024 * 1024);
});

test('tracking binding revision excludes volatile live landing-page probe results', async () => {
  const rows = [
    configRow('facebook_barra', 'BarraShoppingSul', 1),
    configRow('facebook_nh', 'Novo Hamburgo', 2),
  ];
  const input = (status) => handleMetaAdsPublishRequest({
    request: new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config'),
    env: {
      TOKEN_VAULT_DB: new ConfigDb(rows),
      LANDING_PAGE_FETCH: async () => new Response('', { status }),
    },
    requestId: `binding-${status}`,
    pathname: '/v1/meta-ads-publish/config',
    decryptToken: async () => { throw new Error('must not decrypt config'); },
    writeAudit: async () => {},
  });
  const healthy = await (await input(200)).json();
  const unavailable = await (await input(503)).json();
  assert.equal(healthy.ready, true);
  assert.equal(unavailable.ready, false);
  assert.equal(healthy.tracking_binding_revision, unavailable.tracking_binding_revision);
  assert.equal(healthy.config_revision, healthy.tracking_binding_revision);
});

test('tracking binding includes private URL-tag fixtures and Website native-carousel profile grants', async () => {
  const fixtureA = await __test.currentTrackingBindingRevision({
    TOKEN_VAULT_DB: new RunBindingDb(productionUrlTagsReadbackProfile({ creative_id: '823456789' })),
  });
  const fixtureB = await __test.currentTrackingBindingRevision({
    TOKEN_VAULT_DB: new RunBindingDb(productionUrlTagsReadbackProfile({ creative_id: '923456789' })),
  });
  assert.notEqual(fixtureA, fixtureB);

  const profileWithoutAlternate = websiteTrackingProfile();
  const profileWithAlternate = websiteTrackingProfile();
  profileWithAlternate.tracking_profiles.website_schedule_v1.authorized_destination_adset_ids = ['823456789'];
  const withoutAlternate = await __test.currentTrackingBindingRevision({
    TOKEN_VAULT_DB: new RunBindingDb({
      ...profileWithoutAlternate,
      carousel_native_adset_id: '823456789',
      carousel_native_adset_verified: true,
      carousel_native_route_active: true,
    }),
  });
  const withAlternate = await __test.currentTrackingBindingRevision({
    TOKEN_VAULT_DB: new RunBindingDb({
      ...profileWithAlternate,
      carousel_native_adset_id: '823456789',
      carousel_native_adset_verified: true,
      carousel_native_route_active: true,
    }),
  });
  assert.notEqual(withoutAlternate, withAlternate);
});

test('run creation requires v20 and binds only the current stable authorized tracking configuration', async () => {
  const db = new RunBindingDb();
  const env = { TOKEN_VAULT_DB: db };
  const binding = await __test.currentTrackingBindingRevision(env);
  const body = {
    workflow_contract_revision: 'meta_destination_contract_v20_tracking_reconciliation',
    config_revision: binding,
    tracking_binding_revision: binding,
    files: [{ id: 'drive-asset-001', name: 'creative.jpg' }],
  };
  const created = await __test.createOrResumeRun(new Request('https://token-vault.test/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, 'run-binding-created');
  const createdBody = await created.json();
  assert.equal(created.status, 201);
  assert.equal(createdBody.run.config_revision, binding);

  const unsupported = await __test.createOrResumeRun(new Request('https://token-vault.test/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      ...body, workflow_contract_revision: 'meta_destination_contract_v19',
    }),
  }), env, 'run-binding-v19');
  assert.equal((await unsupported.json()).error, 'workflow_contract_revision_unsupported');

  const stale = await __test.createOrResumeRun(new Request('https://token-vault.test/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      ...body, config_revision: '0'.repeat(64), tracking_binding_revision: '0'.repeat(64),
    }),
  }), env, 'run-binding-stale');
  assert.equal((await stale.json()).error, 'tracking_binding_revision_stale');

  const mismatched = await __test.createOrResumeRun(new Request('https://token-vault.test/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      ...body, tracking_binding_revision: 'f'.repeat(64),
    }),
  }), env, 'run-binding-mismatch');
  assert.equal((await mismatched.json()).error, 'tracking_binding_revision_mismatch');
});

test('tracking contract accepts arbitrary safe URL fragments without allowing secret-like keys or malformed percent encoding', () => {
  assert.equal(
    __test.normalizeTrackingContract({ url_tags: 'key1=value1&key2=value2%20encoded' }).url_tags_configured,
    true,
  );
  assert.equal(
    __test.normalizeTrackingContract({ url_tags: 'utm_source=meta&utm_medium=paid_social&utm_id={{campaign.id}}&placement={{placement}}' }).url_tags_configured,
    true,
  );
  assert.throws(
    () => __test.normalizeTrackingContract({ url_tags: 'utm_source=meta&utm_medium=paid_social&redirect=https://example.test' }),
    /url_tags_invalid/,
  );
  assert.throws(
    () => __test.normalizeTrackingContract({ url_tags: 'utm_source=meta&utm_medium=paid_social&access_token=not_allowed' }),
    /url_tags_invalid/,
  );
  assert.throws(() => __test.normalizeTrackingContract({ url_tags: 'key=value%2' }), /url_tags_invalid/);
  assert.throws(() => __test.normalizeTrackingContract({ url_tags: 'key=value%ZZ' }), /url_tags_invalid/);
  assert.equal(__test.normalizeTrackingContract({ url_tags: 'key1=value1&key2=value2' }).url_tags, 'key1=value1&key2=value2');
  assert.equal(__test.normalizeTrackingContract({ url_tags: 'payload=abc==&key2=value2' }).url_tags, 'payload=abc==&key2=value2');
});

test('creative URL tags are serialized exactly once without double encoding', () => {
  const urlTags = 'key1=value1&key2=value2%20encoded';
  const request = __test.jsonRequest('POST', { url_tags: urlTags });
  assert.equal(JSON.parse(request.body).url_tags, urlTags);
  assert.match(request.body, /%20encoded/);
  assert.doesNotMatch(request.body, /%2520encoded/);
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

function authorizedWebsiteCreativePayload(urlTags = 'key1=value1&key2=value2%20encoded') {
  return {
    name: 'Authorized Website Creative',
    object_story_spec: { page_id: '123456789' },
    asset_feed_spec: flexibleStaticFeed(),
    creative_sourcing_spec: { source_url: 'https://espacofacial.com/campanhas/botox' },
    degrees_of_freedom_spec: { creative_features_spec: requiredCreativeFeatures() },
    url_tags: urlTags,
  };
}

function websiteCreativeTrackingRequest(payload) {
  return {
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
    workflow_contract_revision: 'meta_destination_contract_v20_tracking_reconciliation',
    destination_kind: 'website',
    destination_adset_id: '323456789',
    profile_ref: 'website_schedule_v1',
    url_tags: 'key1=value1&key2=value2%20encoded',
    payload,
  };
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
  const withUrlTags = __test.validateCreativePayload({
    ...payload,
    url_tags: 'key1=value1&key2=value2%20encoded',
  }, 'creative:tracking:unit');
  assert.equal(withUrlTags.url_tags, 'key1=value1&key2=value2%20encoded');
  assert.throws(
    () => __test.validateCreativePayload({ ...payload, url_tags: 'https://espacofacial.com/?utm_source=meta&utm_medium=paid_social' }, 'creative:tracking:invalid'),
    /url_tags_invalid/,
  );
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

test('creative creation accepts only the exact Website tracking authorization and explicit no-tag WhatsApp contract', async () => {
  const websiteCalls = [];
  const { context: websiteContext } = gatewayContext(async (url, init) => {
    websiteCalls.push({ url: new URL(url), init });
    return jsonResponse({ id: '923456789' });
  }, { metaAdsPublish: websiteTrackingProfile() });
  websiteContext.action = 'create_creative';
  const websitePayload = authorizedWebsiteCreativePayload();
  const result = await __test.createCreative(websiteCreativeTrackingRequest(websitePayload), websiteContext);
  assert.equal(result.id, '923456789');
  assert.equal(websiteCalls.length, 1);
  assert.equal(JSON.parse(websiteCalls[0].init.body).url_tags, 'key1=value1&key2=value2%20encoded');

  for (const invalid of [
    { ...websiteCreativeTrackingRequest(websitePayload), workflow_contract_revision: 'meta_destination_contract_v19' },
    { ...websiteCreativeTrackingRequest(websitePayload), destination_adset_id: '923456789' },
    { ...websiteCreativeTrackingRequest(websitePayload), profile_ref: 'website_unapproved_v1' },
    { ...websiteCreativeTrackingRequest(websitePayload), url_tags: 'key1=other&key2=value2%20encoded' },
    websiteCreativeTrackingRequest(authorizedWebsiteCreativePayload('key1=other&key2=value2%20encoded')),
  ]) {
    const { context } = gatewayContext(async () => {
      throw new Error('Graph must not be called for invalid creative authorization');
    }, { metaAdsPublish: websiteTrackingProfile() });
    context.action = 'create_creative';
    await assert.rejects(() => __test.createCreative(invalid, context));
  }

  const whatsappPayload = {
    ...authorizedWebsiteCreativePayload(),
    asset_feed_spec: {
      ...flexibleStaticFeed(),
      link_urls: [{ website_url: 'https://api.whatsapp.com/send' }],
      call_to_action_types: ['WHATSAPP_MESSAGE'],
    },
    creative_sourcing_spec: { source_url: 'https://api.whatsapp.com/send' },
  };
  delete whatsappPayload.url_tags;
  const whatsappRequest = {
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0',
    workflow_contract_revision: 'meta_destination_contract_v20_tracking_reconciliation',
    destination_kind: 'whatsapp', destination_adset_id: '323456789', profile_ref: '', url_tags: '',
    payload: whatsappPayload,
  };
  const whatsappCalls = [];
  const { context: whatsappContext } = gatewayContext(async (url, init) => {
    whatsappCalls.push({ url, init });
    return jsonResponse({ id: '923456788' });
  }, { metaAdsPublish: { destination_type: 'whatsapp' } });
  whatsappContext.action = 'create_creative';
  await __test.createCreative(whatsappRequest, whatsappContext);
  assert.equal(whatsappCalls.length, 1);
  await assert.rejects(() => __test.createCreative({
    ...whatsappRequest,
    url_tags: 'key1=value1',
    payload: { ...whatsappPayload, url_tags: 'key1=value1' },
  }, whatsappContext), /whatsapp_url_tags_forbidden/);

  const { context: spoofedWhatsAppContext } = gatewayContext(async () => {
    throw new Error('Graph must not be called when destination kind is spoofed');
  }, { metaAdsPublish: websiteTrackingProfile() });
  spoofedWhatsAppContext.action = 'create_creative';
  await assert.rejects(
    () => __test.createCreative(whatsappRequest, spoofedWhatsAppContext),
    /destination_kind_not_authorized_for_token/,
  );
});

test('Website native-carousel alternate ad set requires an active verified private route and explicit profile grant', async () => {
  const nativeCarouselAdsetId = '823456789';
  const request = {
    ...websiteCreativeTrackingRequest(authorizedWebsiteCreativePayload()),
    destination_adset_id: nativeCarouselAdsetId,
  };
  const allowedCalls = [];
  const { context: allowedContext } = gatewayContext(async (url, init) => {
    allowedCalls.push({ url, init });
    return jsonResponse({ id: '923456789' });
  }, { metaAdsPublish: websiteTrackingProfileWithVerifiedNativeCarousel() });
  allowedContext.action = 'create_creative';
  await __test.createCreative(request, allowedContext);
  assert.equal(allowedCalls.length, 1);

  for (const [label, metaAdsPublish, destinationAdsetId] of [
    ['arbitrary', websiteTrackingProfileWithVerifiedNativeCarousel(), '923456789'],
    ['disabled', websiteTrackingProfileWithVerifiedNativeCarousel({ routeActive: false }), nativeCarouselAdsetId],
    ['profile_not_granted', websiteTrackingProfileWithVerifiedNativeCarousel({ profileApplies: false }), nativeCarouselAdsetId],
  ]) {
    const { context } = gatewayContext(async () => {
      throw new Error(`Graph must not be called for ${label} native-carousel route`);
    }, { metaAdsPublish });
    context.action = 'create_creative';
    await assert.rejects(() => __test.createCreative({
      ...request,
      destination_adset_id: destinationAdsetId,
    }, context));
  }
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
  assert.equal(__test.creativeReadFields.includes('url_tags'), true);
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
  assert.match(__test.adsetPlacementFields, /billing_event/);
  assert.match(__test.adsetPlacementFields, /optimization_goal/);
  assert.match(__test.adsetPlacementFields, /attribution_spec/);
  assert.match(__test.adsetPlacementFields, /promoted_object/);
  assert.match(__test.adsetPlacementFields, /effective_whatsapp_positions/);
  assert.match(__test.adsetPlacementFields, /effective_facebook_positions/);
  assert.match(__test.adsetPlacementFields, /effective_instagram_positions/);
  assert.match(__test.adsetPlacementFields, /effective_audience_network_positions/);
});

test('adset placement readback uses Graph GET and exposes only a reduced conversion contract', async () => {
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    calls.push({ url: new URL(url), method: init.method });
    return jsonResponse({
      id: '323456789',
      campaign: { id: '223456789', objective: 'OUTCOME_SALES' },
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      destination_type: 'WEBSITE',
      attribution_spec: [{ event_type: 'CLICK_THROUGH' }],
      promoted_object: {
        pixel_id: '123456789',
        custom_event_type: 'SCHEDULE',
        custom_conversion_id: '234567891',
        offline_conversion_data_set_id: '345678912',
      },
      targeting: { publisher_platforms: ['facebook'] },
    });
  });
  const result = await __test.readAdsetPlacements({
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
  }, '323456789', context);

  assert.deepEqual(calls.map((call) => call.method), ['GET']);
  assert.match(calls[0].url.searchParams.get('fields'), /promoted_object/);
  assert.equal(result.conversion_tracking.website_event.configured, true);
  assert.equal(result.conversion_tracking.offline_event_dataset.configured, true);
  assert.equal(result.conversion_tracking.promoted_object.pixel_configured, true);
  assert.equal(result.conversion_tracking.promoted_object.custom_event_type, 'SCHEDULE');
  assert.equal(JSON.stringify(result).includes('123456789'), false);
  assert.equal(JSON.stringify(result).includes('234567891'), false);
  assert.equal(JSON.stringify(result).includes('345678912'), false);
});

test('dedicated conversion-contract readback uses Graph GET and never returns targeting or raw IDs', async () => {
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    calls.push({ url: new URL(url), method: init.method });
    return jsonResponse({
      id: '323456789',
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      destination_type: 'WEBSITE',
      attribution_spec: [{ event_type: 'CLICK_THROUGH' }],
      promoted_object: {
        pixel_id: '123456789',
        custom_event_type: 'SCHEDULE',
        offline_conversion_data_set_id: '345678912',
      },
      targeting: { publisher_platforms: ['facebook'] },
    });
  });
  const result = await __test.readAdsetConversionContract({
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
    object_id: '323456789',
  }, context);

  assert.deepEqual(calls.map((call) => call.method), ['GET']);
  const fields = calls[0].url.searchParams.get('fields');
  assert.equal(fields, __test.adsetConversionContractFields);
  assert.match(fields, /account_id/);
  assert.doesNotMatch(fields, /targeting|name|budget/);
  assert.equal(result.website_event.configured, true);
  assert.equal(result.offline_event_dataset.configured, true);
  assert.equal(result.destination_type, 'WEBSITE');
  assert.equal(JSON.stringify(result).includes('123456789'), false);
  assert.equal(JSON.stringify(result).includes('345678912'), false);
  assert.equal(JSON.stringify(result).includes('publisher_platforms'), false);
});

test('conversion-contract readback cannot probe an ad set outside the configured authorization', async () => {
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({});
  });
  await assert.rejects(() => __test.readAdsetConversionContract({
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
    object_id: '923456789',
  }, context), /adset_not_authorized_for_token/);
  assert.equal(calls.length, 0);
});

function authorizedCreativeUrlTagsReadbackRequest() {
  return {
    action: 'read_authorized_creative_url_tags_contract',
    operation_key: 'diagnostic:creative-url-tags:fixture',
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
  };
}

test('authorized creative URL-tag readback is GET-only, fixture-derived, and redacts all IDs and tags', async () => {
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, method: init.method, fields: parsed.searchParams.get('fields') });
    if (parsed.pathname.endsWith('/723456789')) {
      return jsonResponse({ id: '723456789', status: 'PAUSED', creative: { id: '823456789' } });
    }
    return jsonResponse({ id: '823456789', url_tags: 'key1=value1&key2=value2%20encoded' });
  }, { metaAdsPublish: productionUrlTagsReadbackProfile() });
  const result = await __test.readAuthorizedCreativeUrlTagsContract(authorizedCreativeUrlTagsReadbackRequest(), context);
  assert.deepEqual(result, {
    destination_kind: 'website',
    creative_url_tags: { required: true, paused_fixture_verified: true, exact_match: true },
  });
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET']);
  assert.equal(calls[0].fields, 'id,status,creative{id}');
  assert.equal(calls[1].fields, 'id,url_tags');
  assert.doesNotMatch(JSON.stringify(result), /723456789|823456789|key1=value1/);
});

test('authorized creative URL-tag readback fails closed for absent, active, mismatched, and tag-mismatched private fixtures', async () => {
  const request = authorizedCreativeUrlTagsReadbackRequest();
  const absent = gatewayContext(async () => jsonResponse({}), { metaAdsPublish: websiteTrackingProfile() });
  await assert.rejects(
    () => __test.readAuthorizedCreativeUrlTagsContract(request, absent.context),
    /authorized_creative_url_tags_readback_fixture_invalid/,
  );

  const cases = [
    {
      name: 'active',
      responses: [
        { id: '723456789', status: 'ACTIVE', creative: { id: '823456789' } },
      ],
    },
    {
      name: 'creative-mismatch',
      responses: [
        { id: '723456789', status: 'PAUSED', creative: { id: '923456789' } },
      ],
    },
    {
      name: 'tag-mismatch',
      responses: [
        { id: '723456789', status: 'PAUSED', creative: { id: '823456789' } },
        { id: '823456789', url_tags: 'key1=other&key2=value2%20encoded' },
      ],
    },
  ];
  for (const fixture of cases) {
    const calls = [];
    const { context } = gatewayContext(async (url, init) => {
      calls.push({ method: init.method, path: new URL(url).pathname });
      return jsonResponse(fixture.responses.shift());
    }, { metaAdsPublish: productionUrlTagsReadbackProfile() });
    await assert.rejects(async () => {
      try {
        await __test.readAuthorizedCreativeUrlTagsContract(request, context);
      } catch (error) {
        assert.equal(error.message, 'authorized_creative_url_tags_contract_readback_failed');
        assert.doesNotMatch(`${error.message}:${JSON.stringify(error)}`, /723456789|823456789|key1=value1/);
        throw error;
      }
    }, /authorized_creative_url_tags_contract_readback_failed/, fixture.name);
    assert.ok(calls.length >= 1 && calls.length <= 2, fixture.name);
    assert.ok(calls.every((call) => call.method === 'GET'), fixture.name);
  }
});

test('authorized creative URL-tag readback rejects caller-selected identifiers before Graph access', async () => {
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({});
  }, { metaAdsPublish: productionUrlTagsReadbackProfile() });
  await assert.rejects(() => __test.readAuthorizedCreativeUrlTagsContract({
    ...authorizedCreativeUrlTagsReadbackRequest(),
    object_id: '923456789',
  }, context), /authorized_creative_url_tags_contract_request_invalid/);
  assert.equal(calls.length, 0);
});

function websiteTrackingProfile() {
  return {
    destination_type: 'website',
    tracking_contract: {
      profile_ref: 'website_schedule_v1',
      url_tags: 'key1=value1&key2=value2%20encoded',
    },
    tracking_profiles: {
      website_schedule_v1: {
        source_adset_id: '623456789',
        destination_kind: 'website',
        website_event_requirement: 'required',
        offline_event_dataset_requirement: 'required',
      },
    },
  };
}

function websiteTrackingProfileWithVerifiedNativeCarousel({ routeActive = true, profileApplies = true } = {}) {
  const profile = websiteTrackingProfile();
  profile.carousel_native_adset_id = '823456789';
  profile.carousel_native_adset_verified = true;
  profile.carousel_native_route_active = routeActive;
  if (profileApplies) {
    profile.tracking_profiles.website_schedule_v1.authorized_destination_adset_ids = ['823456789'];
  }
  return profile;
}

function productionUrlTagsReadbackProfile(overrides = {}) {
  const profile = websiteTrackingProfile();
  profile.tracking_contract.production_url_tags_readback_fixture = {
    ad_id: '723456789',
    creative_id: '823456789',
    ...overrides,
  };
  return profile;
}

function optionalWebsiteTrackingProfile() {
  return {
    destination_type: 'website',
    tracking_contract: {
      profile_ref: 'website_optional_v1',
      url_tags: 'key1=value1&key2=value2%20encoded',
    },
    tracking_profiles: {
      website_optional_v1: {
        source_adset_id: '623456789',
        destination_kind: 'website',
        website_event_requirement: 'not_required',
        offline_event_dataset_requirement: 'not_required',
      },
    },
  };
}

function conversionAdset(promotedObject, overrides = {}) {
  return {
    account_id: '123456789',
    campaign: { id: '223456789', objective: 'OUTCOME_SALES' },
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    destination_type: 'WEBSITE',
    attribution_spec: [{ event_type: 'CLICK_THROUGH' }],
    promoted_object: promotedObject,
    ...overrides,
  };
}

test('website reconciliation copies only the authorized tracking fields, snapshots privately, and confirms the Graph readback', async () => {
  const calls = [];
  let targetReads = 0;
  const source = conversionAdset({
    pixel_id: '723456789',
    custom_event_type: 'SCHEDULE',
    offline_conversion_data_set_id: '823456789',
  });
  const before = conversionAdset({
    pixel_id: '923456789',
    custom_conversion_id: '103456789',
    product_catalog_id: '113456789',
  });
  const after = conversionAdset({
    product_catalog_id: '113456789',
    pixel_id: '723456789',
    custom_event_type: 'SCHEDULE',
    offline_conversion_data_set_id: '823456789',
  });
  const { db, context } = gatewayContext(async (url, init) => {
    const parsed = new URL(url);
    const id = parsed.pathname.split('/').pop();
    calls.push({ id, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST') return jsonResponse({ success: true });
    if (id === '623456789') return jsonResponse(source);
    targetReads += 1;
    return jsonResponse(targetReads === 1 ? before : after);
  }, { metaAdsPublish: websiteTrackingProfile() });
  context.action = 'ensure_adset_conversion_contract';
  context.operationKey = 'tracking-adset:run-test';
  const result = await __test.ensureAdsetConversionContract({
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
    object_id: '323456789',
    destination_kind: 'website',
    profile_ref: 'website_schedule_v1',
  }, context);

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'POST', 'GET']);
  assert.deepEqual(calls[2].body.promoted_object, after.promoted_object);
  assert.equal(result.status, 'reconciled');
  assert.equal(result.website_event.configured, true);
  assert.equal(result.offline_event_dataset.configured, true);
  assert.match(result.snapshot_id, /^[0-9a-f-]{36}$/i);
  assert.equal(JSON.stringify(result).includes('723456789'), false);
  assert.equal(JSON.stringify(result).includes('823456789'), false);
  assert.equal(JSON.stringify(result).includes('113456789'), false);
  const encryptedPrevious = JSON.parse(db.snapshot.previous_promoted_object_ciphertext.slice('encrypted:'.length));
  const encryptedDesired = JSON.parse(db.snapshot.desired_tracking_promoted_object_ciphertext.slice('encrypted:'.length));
  assert.equal(encryptedPrevious.product_catalog_id, undefined);
  assert.equal(encryptedDesired.product_catalog_id, undefined);
  assert.deepEqual(Object.keys(encryptedPrevious).sort(), ['custom_conversion_id', 'pixel_id']);
  assert.deepEqual(Object.keys(encryptedDesired).sort(), ['custom_event_type', 'offline_conversion_data_set_id', 'pixel_id']);
  assert.ok(db.statements.some((entry) => entry.sql.includes('meta_ads_publish_adset_tracking_snapshots')));
});

test('an already reconciled website ad set performs no Graph POST', async () => {
  const calls = [];
  const state = conversionAdset({
    pixel_id: '723456789',
    custom_event_type: 'SCHEDULE',
    offline_conversion_data_set_id: '823456789',
  }, { metaAdsPublish: websiteTrackingProfile() });
  const { context } = gatewayContext(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ id: parsed.pathname.split('/').pop(), method: init.method });
    return jsonResponse(state);
  }, { metaAdsPublish: websiteTrackingProfile() });
  context.action = 'ensure_adset_conversion_contract';
  const result = await __test.ensureAdsetConversionContract({
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    destination_kind: 'website', profile_ref: 'website_schedule_v1',
  }, context);
  assert.equal(result.status, 'verified');
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET']);
});

test('conversion Website objectives require a website-event profile even when the profile is otherwise optional', async () => {
  const source = conversionAdset({}, { optimization_goal: 'OFFSITE_CONVERSIONS' });
  const target = conversionAdset({}, { optimization_goal: 'OFFSITE_CONVERSIONS' });
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    const id = new URL(url).pathname.split('/').pop();
    calls.push(init.method);
    return jsonResponse(id === '623456789' ? source : target);
  }, { metaAdsPublish: optionalWebsiteTrackingProfile() });
  await assert.rejects(() => __test.ensureAdsetConversionContract({
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    destination_kind: 'website', profile_ref: 'website_optional_v1',
  }, context), /tracking_profile_website_event_required_for_optimization/);
  assert.deepEqual(calls, ['GET', 'GET']);
});

test('Website tracking fails closed for VALUE and unknown conversion-shaped delivery goals', async () => {
  for (const delivery of [
    { campaign: { id: '223456789', objective: 'OUTCOME_TRAFFIC' }, optimization_goal: 'VALUE' },
    { campaign: { id: '223456789', objective: 'OUTCOME_FUTURE_CONVERSION' }, optimization_goal: 'FUTURE_CONVERSION_GOAL' },
  ]) {
    const source = conversionAdset({}, delivery);
    const target = conversionAdset({}, delivery);
    const calls = [];
    const { context } = gatewayContext(async (url, init) => {
      const id = new URL(url).pathname.split('/').pop();
      calls.push(init.method);
      return jsonResponse(id === '623456789' ? source : target);
    }, { metaAdsPublish: optionalWebsiteTrackingProfile() });
    await assert.rejects(() => __test.ensureAdsetConversionContract({
      token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
      destination_kind: 'website', profile_ref: 'website_optional_v1',
    }, context), /tracking_profile_website_event_required_for_optimization/);
    assert.deepEqual(calls, ['GET', 'GET']);
  }
});

test('non-conversion Website objectives retain explicitly optional tracking profiles', async () => {
  const nonConversionDelivery = {
    campaign: { id: '223456789', objective: 'OUTCOME_TRAFFIC' },
    optimization_goal: 'LINK_CLICKS',
  };
  const source = conversionAdset({}, nonConversionDelivery);
  const target = conversionAdset({}, nonConversionDelivery);
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    const id = new URL(url).pathname.split('/').pop();
    calls.push(init.method);
    return jsonResponse(id === '623456789' ? source : target);
  }, { metaAdsPublish: optionalWebsiteTrackingProfile() });
  const result = await __test.ensureAdsetConversionContract({
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    destination_kind: 'website', profile_ref: 'website_optional_v1',
  }, context);
  assert.equal(result.status, 'verified');
  assert.equal(result.website_event.required, false);
  assert.deepEqual(calls, ['GET', 'GET']);
});

test('a completed ensure operation revalidates a later drift under the same lock instead of serving stale journal output', async () => {
  const operationKey = 'tracking-adset:completed-revalidate';
  const requestBody = {
    action: 'ensure_adset_conversion_contract',
    operation_key: operationKey,
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
    object_id: '323456789',
    destination_kind: 'website',
    profile_ref: 'website_schedule_v1',
  };
  const requestHash = await testSha256(__test.stableStringify(__test.operationHashInput(requestBody, null)));
  const db = new OperationReplayDb({ operationKey, requestHash, metaAdsPublish: websiteTrackingProfile() });
  db.run.config_revision = await __test.currentTrackingBindingRevision({ TOKEN_VAULT_DB: db });
  const source = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  let target = conversionAdset({ pixel_id: '923456789', custom_conversion_id: '103456789' });
  const calls = [];
  const result = await handleMetaAdsPublishRequest({
    request: new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/runs/map_resume/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    }),
    env: {
      TOKEN_VAULT_DB: db,
      META_GRAPH_FETCH: async (url, init) => {
        const id = new URL(url).pathname.split('/').pop();
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ id, method: init.method, body });
        if (init.method === 'POST') {
          target = conversionAdset(body.promoted_object);
          return jsonResponse({ success: true });
        }
        return jsonResponse(id === '623456789' ? source : target);
      },
      META_GRAPH_SLEEP: async () => {},
    },
    requestId: 'completed-ensure-revalidation',
    pathname: '/v1/meta-ads-publish/runs/map_resume/operations',
    decryptToken: async (value) => String(value).startsWith('encrypted:') ? String(value).slice('encrypted:'.length) : 'fixture-secret',
    encryptToken: async (value) => `encrypted:${value}`,
    writeAudit: async () => {},
  });
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.replayed, false);
  assert.equal(body.operation.status, 'completed');
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'POST', 'GET']);
  assert.ok(db.statements.some((entry) => entry.sql.includes("SET status = 'in_progress'")));
  assert.ok(db.statements.some((entry) => entry.sql.includes("SET status = 'completed'")));
});

test('a completed authorized URL-tag diagnostic re-reads the private paused fixture instead of replaying stale evidence', async () => {
  const operationKey = 'diagnostic:creative-url-tags:revalidate';
  const requestBody = {
    action: 'read_authorized_creative_url_tags_contract',
    operation_key: operationKey,
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
  };
  const requestHash = await testSha256(__test.stableStringify(__test.operationHashInput(requestBody, null)));
  const db = new OperationReplayDb({
    operationKey,
    requestHash,
    action: requestBody.action,
    metaAdsPublish: productionUrlTagsReadbackProfile(),
  });
  const calls = [];
  const result = await handleMetaAdsPublishRequest({
    request: new Request('https://token-vault.test/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    }),
    env: {
      TOKEN_VAULT_DB: db,
      META_GRAPH_FETCH: async (url, init) => {
        const id = new URL(url).pathname.split('/').pop();
        calls.push({ id, method: init.method });
        if (id === '723456789') return jsonResponse({ id, status: 'PAUSED', creative: { id: '823456789' } });
        return jsonResponse({ id, url_tags: 'key1=value1&key2=value2%20encoded' });
      },
      META_GRAPH_SLEEP: async () => {},
    },
    requestId: 'completed-url-tag-readback-revalidation',
    pathname: '/v1/meta-ads-publish/runs/map_resume/operations',
    decryptToken: async (value) => String(value).startsWith('encrypted:') ? String(value).slice('encrypted:'.length) : 'fixture-secret',
    encryptToken: async (value) => `encrypted:${value}`,
    writeAudit: async () => {},
  });
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.replayed, false);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET']);
  assert.deepEqual(body.operation.result, {
    destination_kind: 'website',
    creative_url_tags: { required: true, paused_fixture_verified: true, exact_match: true },
  });
  assert.doesNotMatch(JSON.stringify({
    result: body.operation.result,
    journal_result: db.operation.result_json,
    journal_error: db.operation.error_json,
    journal_trace: db.operation.meta_trace_id,
  }), /723456789|823456789|key1=value1/);
});

test('Click-to-WhatsApp remains a no-op for website conversion reconciliation', async () => {
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    calls.push({ url, method: init.method });
    return jsonResponse({});
  }, { metaAdsPublish: { destination_type: 'whatsapp' } });
  const result = await __test.ensureAdsetConversionContract({
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    destination_kind: 'whatsapp',
  }, context);
  assert.equal(result.status, 'not_applicable');
  assert.equal(result.graph_mutation, 'none');
  assert.equal(calls.length, 0);
});

test('explicit tracking rollback restores only the encrypted private snapshot and confirms readback', async () => {
  const previous = { pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789' };
  const desired = { pixel_id: '923456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '993456789' };
  const calls = [];
  let graphState = desired;
  const { db, context } = gatewayContext(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ method: init.method, body: init.body ? JSON.parse(init.body) : null, id: parsed.pathname.split('/').pop() });
    if (init.method === 'POST') {
      graphState = init.body ? JSON.parse(init.body).promoted_object : graphState;
      return jsonResponse({ success: true });
    }
    return jsonResponse(conversionAdset(graphState));
  }, { metaAdsPublish: websiteTrackingProfile() });
  db.snapshot = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    token_id: 'facebook_barra',
    account_id: '123456789',
    adset_id: '323456789',
    profile_ref: 'website_schedule_v1',
    previous_promoted_object_ciphertext: 'snapshot-ciphertext',
    desired_tracking_promoted_object_ciphertext: 'desired-tracking-ciphertext',
    tracking_keys_json: JSON.stringify(['pixel_id', 'custom_event_type', 'offline_conversion_data_set_id']),
    status: 'captured',
  };
  context.decryptToken = async (value) => {
    if (value === 'snapshot-ciphertext') return JSON.stringify(previous);
    if (value === 'desired-tracking-ciphertext') return JSON.stringify(desired);
    return 'fixture-secret';
  };
  context.action = 'rollback_adset_conversion_contract';
  const result = await __test.rollbackAdsetConversionContract({
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    snapshot_id: db.snapshot.id,
  }, context);
  assert.equal(result.status, 'restored');
  assert.equal(result.snapshot_id, db.snapshot.id);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET']);
  assert.deepEqual(calls[1].body.promoted_object, previous);
  assert.equal(JSON.stringify(result).includes('723456789'), false);
  assert.ok(db.statements.some((entry) => entry.sql.includes("SET status = 'restored'")));
});

test('tracking rollback preserves unrelated promoted-object changes made after reconciliation', async () => {
  const previous = {
    pixel_id: '723456789',
    custom_conversion_id: '733456789',
    offline_conversion_data_set_id: '823456789',
    product_catalog_id: 'old-catalog',
  };
  const desiredTracking = {
    pixel_id: '923456789',
    custom_event_type: 'SCHEDULE',
    offline_conversion_data_set_id: '993456789',
  };
  const current = {
    product_catalog_id: 'new-catalog',
    ...desiredTracking,
  };
  const calls = [];
  let graphState = current;
  const { db, context } = gatewayContext(async (url, init) => {
    calls.push({ method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST') {
      graphState = init.body ? JSON.parse(init.body).promoted_object : graphState;
      return jsonResponse({ success: true });
    }
    return jsonResponse(conversionAdset(graphState));
  }, { metaAdsPublish: websiteTrackingProfile() });
  db.snapshot = {
    id: '223e4567-e89b-42d3-a456-426614174000',
    token_id: 'facebook_barra', account_id: '123456789', adset_id: '323456789', profile_ref: 'website_schedule_v1',
    previous_promoted_object_ciphertext: 'snapshot-ciphertext',
    desired_tracking_promoted_object_ciphertext: 'desired-tracking-ciphertext',
    tracking_keys_json: JSON.stringify(['pixel_id', 'custom_event_type', 'custom_conversion_id', 'offline_conversion_data_set_id']),
    status: 'reconciled',
  };
  context.decryptToken = async (value) => {
    if (value === 'snapshot-ciphertext') return JSON.stringify(previous);
    if (value === 'desired-tracking-ciphertext') return JSON.stringify(desiredTracking);
    return 'fixture-secret';
  };
  const result = await __test.rollbackAdsetConversionContract({
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    snapshot_id: db.snapshot.id,
  }, context);
  assert.equal(result.status, 'restored');
  assert.deepEqual(calls[1].body.promoted_object, {
    product_catalog_id: 'new-catalog',
    pixel_id: '723456789',
    custom_conversion_id: '733456789',
    offline_conversion_data_set_id: '823456789',
  });
});

test('reconciliation retry reuses its encrypted snapshot after a failed Graph POST', async () => {
  const source = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  const before = conversionAdset({ pixel_id: '923456789', custom_conversion_id: '103456789' });
  const after = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  let target = before;
  let postAttempts = 0;
  const { db, context } = gatewayContext(async (url, init) => {
    const id = new URL(url).pathname.split('/').pop();
    if (init.method === 'POST') {
      postAttempts += 1;
      if (postAttempts === 1) return jsonResponse({ error: { code: 100, message: 'fixture POST rejected', is_transient: false } }, 400);
      target = after;
      return jsonResponse({ success: true });
    }
    return jsonResponse(id === '623456789' ? source : target);
  }, { metaAdsPublish: websiteTrackingProfile() });
  context.operationKey = 'tracking-adset:retry-post';
  const request = {
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    destination_kind: 'website', profile_ref: 'website_schedule_v1',
  };
  let failed;
  await assert.rejects(() => __test.ensureAdsetConversionContract(request, context), (error) => {
    failed = error;
    return /adset_conversion_reconciliation_failed/.test(error.message);
  });
  const snapshotId = db.snapshot.id;
  const detail = __test.normalizeFailure(failed);
  assert.deepEqual(detail.compensation, { snapshot_id: snapshotId });
  assert.match(detail.compensation.snapshot_id, /^[0-9a-f-]{36}$/i);
  assert.doesNotMatch(JSON.stringify(detail), /723456789|923456789|103456789/);
  const retried = await __test.ensureAdsetConversionContract(request, context);
  assert.equal(retried.status, 'reconciled');
  assert.equal(retried.snapshot_id, snapshotId);
  assert.equal(db.statements.filter((entry) => entry.sql.includes('INSERT OR IGNORE INTO meta_ads_publish_adset_tracking_snapshots')).length, 1);
});

test('failed tracking ensure exposes a sanitized snapshot compensator and rollback is a no-op when Graph was not applied', async () => {
  const source = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  const before = conversionAdset({ pixel_id: '923456789', custom_conversion_id: '103456789' });
  const calls = [];
  const { db, context } = gatewayContext(async (url, init) => {
    const id = new URL(url).pathname.split('/').pop();
    calls.push({ id, method: init.method });
    if (init.method === 'POST') {
      return jsonResponse({ error: { code: 100, message: 'fixture POST rejected', is_transient: false } }, 400);
    }
    return jsonResponse(id === '623456789' ? source : before);
  }, { metaAdsPublish: websiteTrackingProfile() });
  context.operationKey = 'tracking-adset:failed-post-compensation';
  const request = {
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    destination_kind: 'website', profile_ref: 'website_schedule_v1',
  };
  let failed;
  await assert.rejects(() => __test.ensureAdsetConversionContract(request, context), (error) => {
    failed = error;
    return /adset_conversion_reconciliation_failed/.test(error.message);
  });
  const detail = __test.normalizeFailure(failed);
  assert.deepEqual(detail.compensation, { snapshot_id: db.snapshot.id });
  assert.doesNotMatch(JSON.stringify(detail), /723456789|923456789|103456789/);

  const rollback = await __test.rollbackAdsetConversionContract({
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    snapshot_id: detail.compensation.snapshot_id,
  }, context);
  assert.equal(rollback.status, 'not_applied');
  assert.equal(rollback.graph_mutation, 'none');
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'POST', 'GET']);
});

test('a successful Graph POST with failed final readback retains a sanitized cleanup snapshot that restores the fixture', async () => {
  const source = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  const before = {
    product_catalog_id: '113456789',
    pixel_id: '923456789',
    custom_conversion_id: '103456789',
  };
  let graphState = before;
  let targetReads = 0;
  const calls = [];
  const { db, context } = gatewayContext(async (url, init) => {
    const id = new URL(url).pathname.split('/').pop();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ id, method: init.method, body });
    if (init.method === 'POST') {
      graphState = body.promoted_object;
      return jsonResponse({ success: true });
    }
    if (id === '623456789') return jsonResponse(source);
    targetReads += 1;
    // Simulate a Graph POST that applied, followed by a stale final GET. The
    // later rollback read sees the actual applied state and must compensate it.
    if (targetReads === 2) return jsonResponse(conversionAdset(before));
    return jsonResponse(conversionAdset(graphState));
  }, { metaAdsPublish: websiteTrackingProfile() });
  context.operationKey = 'tracking-adset:post-applied-readback-failed';
  const request = {
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    destination_kind: 'website', profile_ref: 'website_schedule_v1',
  };

  let failed;
  await assert.rejects(() => __test.ensureAdsetConversionContract(request, context), (error) => {
    failed = error;
    return /adset_conversion_reconciliation_failed/.test(error.message);
  });
  const detail = __test.normalizeFailure(failed);
  assert.deepEqual(detail.compensation, { snapshot_id: db.snapshot.id });
  assert.doesNotMatch(JSON.stringify(detail), /723456789|923456789|103456789|113456789/);

  const rollback = await __test.rollbackAdsetConversionContract({
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    snapshot_id: detail.compensation.snapshot_id,
  }, context);
  assert.equal(rollback.status, 'restored');
  assert.equal(rollback.graph_mutation, 'promoted_object_restored');
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'POST', 'GET', 'GET', 'POST', 'GET']);
  assert.deepEqual(calls[5].body.promoted_object, before);
  assert.equal(graphState.product_catalog_id, '113456789');
});

test('reconciliation retry completes from the original snapshot after a delayed readback', async () => {
  const source = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  const before = conversionAdset({ pixel_id: '923456789', custom_conversion_id: '103456789' });
  const after = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  let targetReads = 0;
  let postApplied = false;
  const { db, context } = gatewayContext(async (url, init) => {
    const id = new URL(url).pathname.split('/').pop();
    if (init.method === 'POST') {
      postApplied = true;
      return jsonResponse({ success: true });
    }
    if (id === '623456789') return jsonResponse(source);
    targetReads += 1;
    if (postApplied && targetReads === 2) return jsonResponse(before);
    return jsonResponse(postApplied ? after : before);
  }, { metaAdsPublish: websiteTrackingProfile() });
  context.operationKey = 'tracking-adset:retry-readback';
  const request = {
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    destination_kind: 'website', profile_ref: 'website_schedule_v1',
  };
  let failed;
  await assert.rejects(() => __test.ensureAdsetConversionContract(request, context), (error) => {
    failed = error;
    return /adset_conversion_reconciliation_failed/.test(error.message);
  });
  const snapshotId = db.snapshot.id;
  const detail = __test.normalizeFailure(failed);
  assert.deepEqual(detail.compensation, { snapshot_id: snapshotId });
  assert.doesNotMatch(JSON.stringify(detail), /723456789|923456789|103456789/);
  const retried = await __test.ensureAdsetConversionContract(request, context);
  assert.equal(retried.status, 'verified');
  assert.equal(retried.snapshot_id, snapshotId);
  assert.equal(db.statements.filter((entry) => entry.sql.includes('INSERT OR IGNORE INTO meta_ads_publish_adset_tracking_snapshots')).length, 1);
});

test('reconciliation retry refuses a reused snapshot whose target or desired fingerprint changed after failure', async () => {
  const source = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  const before = conversionAdset({ pixel_id: '923456789', custom_conversion_id: '103456789' });
  let postAttempts = 0;
  const { db, context } = gatewayContext(async (url, init) => {
    const id = new URL(url).pathname.split('/').pop();
    if (init.method === 'POST') {
      postAttempts += 1;
      return jsonResponse({ error: { code: 100, message: 'fixture POST rejected', is_transient: false } }, 400);
    }
    return jsonResponse(id === '623456789' ? source : before);
  }, { metaAdsPublish: websiteTrackingProfile() });
  context.operationKey = 'tracking-adset:retry-snapshot-contract';
  const request = {
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    destination_kind: 'website', profile_ref: 'website_schedule_v1',
  };
  await assert.rejects(() => __test.ensureAdsetConversionContract(request, context), /adset_conversion_reconciliation_failed/);
  const originalTarget = db.snapshot.adset_id;
  db.snapshot.adset_id = '999999999';
  await assert.rejects(() => __test.ensureAdsetConversionContract(request, context), /adset_tracking_snapshot_operation_conflict/);
  assert.equal(postAttempts, 1);

  db.snapshot.adset_id = originalTarget;
  db.snapshot.desired_promoted_object_fingerprint = '0'.repeat(64);
  await assert.rejects(() => __test.ensureAdsetConversionContract(request, context), /adset_tracking_snapshot_operation_conflict/);
  assert.equal(postAttempts, 1);
});

test('tracking rollback refuses concurrent tracking drift without posting or restoring the product catalog', async () => {
  const previous = {
    pixel_id: '723456789',
    custom_conversion_id: '733456789',
    offline_conversion_data_set_id: '823456789',
    product_catalog_id: 'old-catalog',
  };
  const desiredTracking = {
    pixel_id: '923456789',
    custom_event_type: 'SCHEDULE',
    offline_conversion_data_set_id: '993456789',
  };
  const current = {
    product_catalog_id: 'new-catalog',
    ...desiredTracking,
    // This is a concurrent edit to a field that this snapshot would restore.
    pixel_id: '963456789',
  };
  const calls = [];
  const { db, context } = gatewayContext(async (url, init) => {
    calls.push({ method: init.method, body: init.body ? JSON.parse(init.body) : null });
    return jsonResponse(conversionAdset(current));
  }, { metaAdsPublish: websiteTrackingProfile() });
  db.snapshot = {
    id: '323e4567-e89b-42d3-a456-426614174000',
    token_id: 'facebook_barra', account_id: '123456789', adset_id: '323456789', profile_ref: 'website_schedule_v1',
    previous_promoted_object_ciphertext: 'snapshot-ciphertext',
    desired_tracking_promoted_object_ciphertext: 'desired-tracking-ciphertext',
    tracking_keys_json: JSON.stringify(['pixel_id', 'custom_event_type', 'custom_conversion_id', 'offline_conversion_data_set_id']),
    status: 'reconciled',
  };
  context.decryptToken = async (value) => {
    if (value === 'snapshot-ciphertext') return JSON.stringify(previous);
    if (value === 'desired-tracking-ciphertext') return JSON.stringify(desiredTracking);
    return 'fixture-secret';
  };
  await assert.rejects(() => __test.rollbackAdsetConversionContract({
    token_id: 'facebook_barra', account_id: '123456789', api_version: 'v25.0', object_id: '323456789',
    snapshot_id: db.snapshot.id,
  }, context), /adset_tracking_rollback_concurrent_drift/);
  assert.deepEqual(calls.map((call) => call.method), ['GET']);
  assert.equal(current.product_catalog_id, 'new-catalog');
  assert.equal(db.statements.some((entry) => entry.sql.includes("SET status = 'restored'")), false);
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
    if (this.sql.includes('FROM meta_ads_publish_adset_tracking_snapshots')) return this.db.snapshot || null;
    if (this.sql.includes('FROM meta_ads_publish_locks')) return null;
    if (this.sql.includes('FROM meta_ads_publish_operations')) return null;
    return null;
  }

  async all() {
    if (this.sql.includes('FROM credential_tokens')) return { results: [this.db.credential] };
    return { results: [] };
  }

  async run() {
    this.db.statements.push({ sql: this.sql, values: this.values });
    if (this.sql.includes('INSERT OR IGNORE INTO meta_ads_publish_adset_tracking_snapshots')) {
      const [id, runId, operationKey, tokenId, accountId, adsetId, profileRef, previousCiphertext, previousFingerprint, desiredFingerprint, desiredCiphertext, trackingKeys] = this.values;
      if (!this.db.snapshot) {
        this.db.snapshot = {
          id,
          run_id: runId,
          operation_key: operationKey,
          token_id: tokenId,
          account_id: accountId,
          adset_id: adsetId,
          profile_ref: profileRef,
          previous_promoted_object_ciphertext: previousCiphertext,
          previous_promoted_object_fingerprint: previousFingerprint,
          desired_promoted_object_fingerprint: desiredFingerprint,
          desired_tracking_promoted_object_ciphertext: desiredCiphertext,
          tracking_keys_json: trackingKeys,
          status: 'captured',
        };
      }
    }
    if (this.sql.includes("SET status = 'reconciled'") && this.db.snapshot) this.db.snapshot.status = 'reconciled';
    if (this.sql.includes("SET status = 'restored'") && this.db.snapshot) this.db.snapshot.status = 'restored';
    return { success: true };
  }
}

class GatewayDb {
  constructor(metaAdsPublish = {}) {
    this.statements = [];
    this.snapshot = null;
    this.credential = {
      id: 'facebook_barra',
      provider: 'facebook',
      active: 1,
      token_ciphertext: 'encrypted',
      metadata_json: JSON.stringify({
        meta_ads_publish: {
          ...baseMetaAdsPublishConfig(),
          ...metaAdsPublish,
        },
      }),
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

function baseMetaAdsPublishConfig() {
  return {
    destination_group: 'BarraShoppingSul',
    account_id: '123456789',
    api_version: 'v25.0',
    campaign_id: '223456789',
    adset_id: '323456789',
    page_id: '423456789',
    instagram_user_id: '523456789',
    allowed_link_hosts: ['espacofacial.com'],
    landing_pages_by_creative_group: {
      BOTOX: 'https://espacofacial.com/campanhas/botox',
    },
  };
}

class RunBindingStatement {
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
    if (this.sql.includes('FROM meta_ads_publish_runs')) {
      const requested = this.values[0];
      return this.db.run && (this.db.run.id === requested || this.db.run.batch_fingerprint === requested) ? this.db.run : null;
    }
    if (this.sql.includes('FROM meta_ads_publish_locks')) return this.db.locks.get(this.values[0]) || null;
    return null;
  }

  async all() {
    if (this.sql.includes('FROM credential_tokens')) return { results: [this.db.credential] };
    return { results: [] };
  }

  async run() {
    if (this.sql.includes('INSERT INTO meta_ads_publish_runs')) {
      const [id, batchFingerprint, requestHash, workflowExecutionId, configRevision, filesJson, heartbeatAt, lockExpiresAt, createdAt, updatedAt] = this.values;
      this.db.run = {
        id,
        batch_fingerprint: batchFingerprint,
        request_hash: requestHash,
        workflow_execution_id: workflowExecutionId,
        config_revision: configRevision,
        status: 'acquired',
        files_json: filesJson,
        summary_json: '{}',
        error_json: '{}',
        heartbeat_at: heartbeatAt,
        lock_expires_at: lockExpiresAt,
        created_at: createdAt,
        updated_at: updatedAt,
      };
    }
    if (this.sql.includes('INSERT INTO meta_ads_publish_locks')) {
      const [resourceKey, runId, operationKey, heartbeatAt, expiresAt] = this.values;
      this.db.locks.set(resourceKey, {
        resource_key: resourceKey,
        run_id: runId,
        operation_key: operationKey,
        heartbeat_at: heartbeatAt,
        expires_at: expiresAt,
      });
    }
    return { success: true };
  }
}

class RunBindingDb {
  constructor(metaAdsPublish = websiteTrackingProfile()) {
    this.locks = new Map();
    this.run = null;
    this.credential = {
      id: 'facebook_barra',
      provider: 'facebook',
      active: 1,
      external_account_id: '123456789',
      unit: 'BarraShoppingSul',
      token_type: 'long_lived_access_token',
      expires_at: null,
      updated_at: '2026-08-13T00:00:00.000Z',
      token_ciphertext: 'encrypted',
      metadata_json: JSON.stringify({
        meta_ads_publish: {
          ...baseMetaAdsPublishConfig(),
          ...metaAdsPublish,
        },
      }),
    };
  }

  prepare(sql) {
    return new RunBindingStatement(this, sql);
  }
}

function gatewayContext(fetchImpl, { metaAdsPublish = {}, encryptToken } = {}) {
  const db = new GatewayDb(metaAdsPublish);
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
      decryptToken: async (value) => String(value).startsWith('encrypted:') ? String(value).slice('encrypted:'.length) : 'fixture-secret',
      encryptToken: encryptToken || (async (value) => `encrypted:${value}`),
      attempts: 0,
      rateUsage: {},
      traceId: '',
    },
  };
}

async function testSha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class OperationReplayStatement {
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
    if (this.sql.includes('FROM meta_ads_publish_runs')) return this.db.run;
    if (this.sql.includes('FROM meta_ads_publish_adset_tracking_snapshots')) return this.db.snapshot;
    if (this.sql.includes('FROM meta_ads_publish_operations')) {
      if (this.sql.includes('WHERE id = ?')) return this.values[0] === this.db.operation.id ? this.db.operation : null;
      return this.values[0] === this.db.operation.operation_key ? this.db.operation : null;
    }
    if (this.sql.includes('FROM meta_ads_publish_locks')) return this.db.locks.get(this.values[0]) || null;
    return null;
  }

  async all() {
    if (this.sql.includes('FROM credential_tokens')) return { results: [this.db.credential] };
    return { results: [] };
  }

  async run() {
    this.db.statements.push({ sql: this.sql, values: this.values });
    if (this.sql.includes('INSERT INTO meta_ads_publish_locks')) {
      const [resourceKey, runId, operationKey] = this.values;
      this.db.locks.set(resourceKey, { resource_key: resourceKey, run_id: runId, operation_key: operationKey });
    }
    if (this.sql.includes("SET status = 'in_progress'")) {
      this.db.operation.status = 'in_progress';
    }
    if (this.sql.includes("SET status = 'completed'")) {
      this.db.operation.status = 'completed';
      this.db.operation.attempt_count = this.values[0];
      this.db.operation.result_json = this.values[1];
      this.db.operation.error_json = '{}';
      this.db.operation.meta_trace_id = this.values[2];
      this.db.operation.rate_usage_json = this.values[3];
    }
    if (this.sql.includes('INSERT OR IGNORE INTO meta_ads_publish_adset_tracking_snapshots')) {
      const [id, runId, operationKey, tokenId, accountId, adsetId, profileRef, previousCiphertext, previousFingerprint, desiredFingerprint, desiredCiphertext, trackingKeys] = this.values;
      if (!this.db.snapshot) {
        this.db.snapshot = {
          id,
          run_id: runId,
          operation_key: operationKey,
          token_id: tokenId,
          account_id: accountId,
          adset_id: adsetId,
          profile_ref: profileRef,
          previous_promoted_object_ciphertext: previousCiphertext,
          previous_promoted_object_fingerprint: previousFingerprint,
          desired_promoted_object_fingerprint: desiredFingerprint,
          desired_tracking_promoted_object_ciphertext: desiredCiphertext,
          tracking_keys_json: trackingKeys,
          status: 'captured',
        };
      }
    }
    if (this.sql.includes("SET status = 'reconciled'") && this.db.snapshot) this.db.snapshot.status = 'reconciled';
    if (this.sql.includes('DELETE FROM meta_ads_publish_locks')) this.db.locks.clear();
    return { success: true };
  }
}

class OperationReplayDb {
  constructor({ operationKey, requestHash, metaAdsPublish, action = 'ensure_adset_conversion_contract' }) {
    this.locks = new Map();
    this.snapshot = null;
    this.statements = [];
    this.run = { id: 'map_resume', status: 'acquired' };
    this.operation = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      run_id: 'map_resume',
      operation_key: operationKey,
      request_hash: requestHash,
      action,
      status: 'completed',
      attempt_count: 1,
      result_json: JSON.stringify({ status: 'verified', stale: true }),
      error_json: '{}',
      meta_trace_id: null,
      rate_usage_json: '{}',
      created_at: '2026-08-13T00:00:00.000Z',
      updated_at: '2026-08-13T00:00:00.000Z',
    };
    this.credential = {
      id: 'facebook_barra',
      provider: 'facebook',
      active: 1,
      token_ciphertext: 'encrypted',
      metadata_json: JSON.stringify({
        meta_ads_publish: {
          ...baseMetaAdsPublishConfig(),
          ...metaAdsPublish,
        },
      }),
    };
  }

  prepare(sql) {
    return new OperationReplayStatement(this, sql);
  }
}

function replacementJob(adId, operationKey) {
  return {
    workflow_contract_revision: 'meta_destination_contract_v20_tracking_reconciliation',
    operation_key: operationKey,
    action: 'replace_existing',
    target_ad_id: adId,
    token_id: 'facebook_barra',
    account_id: '123456789',
    api_version: 'v25.0',
    destination_group: `unit-${adId}`,
    creative_group_key: `group-${adId}`,
    creative_id: `9${adId}`,
    destination_kind: 'website',
    destination_adset_id: '323456789',
    profile_ref: 'website_schedule_v1',
    url_tags: 'key1=value1&key2=value2%20encoded',
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
  const reconciled = conversionAdset({
    pixel_id: '723456789',
    custom_event_type: 'SCHEDULE',
    offline_conversion_data_set_id: '823456789',
  });
  const { context } = gatewayContext(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'GET') {
      const adId = parsed.pathname.split('/').pop();
      if (adId === '623456789' || adId === '323456789') return jsonResponse(reconciled);
      if (adId === '911111' || adId === '922222') {
        return jsonResponse({
          id: adId,
          url_tags: 'key1=value1&key2=value2%20encoded',
          object_story_spec: { link_data: { link: 'https://espacofacial.com/campanhas/botox' } },
        });
      }
      return jsonResponse({ id: adId, name: `Old ad ${adId}`, status: 'ACTIVE', adset_id: '323456789', creative: { id: `8${adId}` } });
    }
    if (parsed.pathname.endsWith('/22222')) {
      return jsonResponse({ error: { code: 100, message: 'Invalid parameter', is_transient: false } }, 400);
    }
    return jsonResponse({ success: true });
  }, { metaAdsPublish: websiteTrackingProfile() });

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

test('stage batch freshly reconciles a drifted Website ad set before attaching the creative', async () => {
  const source = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  let target = conversionAdset({ pixel_id: '923456789', custom_conversion_id: '103456789' });
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    const parsed = new URL(url);
    const id = parsed.pathname.split('/').pop();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ id, method: init.method, body });
    if (id === '623456789') return jsonResponse(source);
    if (id === '323456789') {
      if (init.method === 'POST') {
        target = conversionAdset(body.promoted_object);
        return jsonResponse({ success: true });
      }
      return jsonResponse(target);
    }
    if (id === '911111') {
      return jsonResponse({
        id,
        url_tags: 'key1=value1&key2=value2%20encoded',
        object_story_spec: { link_data: { link: 'https://espacofacial.com/campanhas/botox' } },
      });
    }
    if (id === '11111' && init.method === 'GET') {
      return jsonResponse({ id, name: 'Old ad', status: 'PAUSED', adset_id: '323456789', creative: { id: '811111' } });
    }
    return jsonResponse({ success: true });
  }, { metaAdsPublish: websiteTrackingProfile() });
  await __test.stageBatch({ jobs: [replacementJob('11111', 'job:stage-fresh-reconciliation')] }, context);
  const trackingPost = calls.findIndex((call) => call.id === '323456789' && call.method === 'POST');
  const adPost = calls.findIndex((call) => call.id === '11111' && call.method === 'POST');
  assert.ok(trackingPost > 1);
  assert.ok(adPost > trackingPost);
  assert.deepEqual(calls[trackingPost].body.promoted_object, source.promoted_object);
  assert.equal(target.promoted_object.pixel_id, source.promoted_object.pixel_id);
});

test('stage batch rejects a caller-supplied WhatsApp exemption for a Website destination', async () => {
  const job = replacementJob('11111', 'job:stage-spoofed-whatsapp');
  job.destination_kind = 'whatsapp';
  job.profile_ref = '';
  job.url_tags = '';
  const calls = [];
  const { context } = gatewayContext(async (url) => {
    calls.push(url);
    throw new Error('Graph must not be called when destination kind is spoofed');
  }, { metaAdsPublish: websiteTrackingProfile() });

  await assert.rejects(
    () => __test.stageBatch({ jobs: [job] }, context),
    /destination_kind_not_authorized_for_token/,
  );
  assert.equal(calls.length, 0);
});

test('stage batch reconciles an explicitly granted verified Website native-carousel alternate', async () => {
  const nativeCarouselAdsetId = '823456789';
  const source = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  const job = replacementJob('11111', 'job:stage-native-carousel');
  job.destination_adset_id = nativeCarouselAdsetId;
  job.ad_payload.adset_id = nativeCarouselAdsetId;
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    const id = new URL(url).pathname.split('/').pop();
    calls.push({ id, method: init.method });
    if (id === '623456789' || id === nativeCarouselAdsetId) return jsonResponse(source);
    if (id === '911111') {
      return jsonResponse({
        id,
        url_tags: 'key1=value1&key2=value2%20encoded',
        object_story_spec: { link_data: { link: 'https://espacofacial.com/campanhas/botox' } },
      });
    }
    if (id === '11111' && init.method === 'GET') {
      return jsonResponse({ id, name: 'Old ad', status: 'PAUSED', adset_id: nativeCarouselAdsetId, creative: { id: '811111' } });
    }
    if (id === '11111' && init.method === 'POST') return jsonResponse({ success: true });
    throw new Error(`unexpected native-carousel Graph request ${id}`);
  }, { metaAdsPublish: websiteTrackingProfileWithVerifiedNativeCarousel() });
  await __test.stageBatch({ jobs: [job] }, context);
  assert.deepEqual(calls.map((call) => `${call.method}:${call.id}`), [
    'GET:623456789',
    `GET:${nativeCarouselAdsetId}`,
    'GET:911111',
    'GET:11111',
    'POST:11111',
  ]);
});

test('stage batch blocks the ad mutation when fresh Website reconciliation cannot be confirmed', async () => {
  const source = conversionAdset({
    pixel_id: '723456789', custom_event_type: 'SCHEDULE', offline_conversion_data_set_id: '823456789',
  });
  const drifted = conversionAdset({ pixel_id: '923456789', custom_conversion_id: '103456789' });
  const calls = [];
  const { context } = gatewayContext(async (url, init) => {
    const parsed = new URL(url);
    const id = parsed.pathname.split('/').pop();
    calls.push({ id, method: init.method });
    if (id === '623456789') return jsonResponse(source);
    if (id === '323456789' && init.method === 'GET') return jsonResponse(drifted);
    if (id === '323456789' && init.method === 'POST') {
      return jsonResponse({ error: { code: 100, message: 'fixture rejected', is_transient: false } }, 400);
    }
    throw new Error('stage must stop before reading or posting the ad');
  }, { metaAdsPublish: websiteTrackingProfile() });
  await assert.rejects(
    () => __test.stageBatch({ jobs: [replacementJob('11111', 'job:stage-blocked-reconciliation')] }, context),
    /adset_conversion_reconciliation_failed/,
  );
  assert.equal(calls.some((call) => call.id === '11111' && call.method === 'POST'), false);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'POST']);
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
      if (
        !current ||
        Date.parse(current.expires_at) <= Date.now() ||
        (current.run_id === runId && current.operation_key === operationKey)
      ) {
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

test('resource locks permit only the same operation to re-enter a target', async () => {
  const db = { locks: new Map(), prepare(sql) { return new LockStatement(this, sql); } };
  const env = { TOKEN_VAULT_DB: db };
  await __test.acquireLocks(env, 'run-one', 'operation-one', ['ad:120246883241450157']);
  await __test.acquireLocks(env, 'run-one', 'operation-one', ['ad:120246883241450157']);
  await assert.rejects(
    () => __test.acquireLocks(env, 'run-two', 'operation-two', ['ad:120246883241450157']),
    /resource_locked/,
  );
  await assert.rejects(
    () => __test.acquireLocks(env, 'run-one', 'operation-two', ['ad:120246883241450157']),
    /resource_locked/,
  );
});

test('stage and rollback contend on the same ad-set contract lock within one run', async () => {
  const stageJob = replacementJob('11111', 'stage:locked-adset');
  const stageKeys = __test.deriveResourceKeys('stage_batch', { jobs: [stageJob] });
  const rollbackKeys = __test.deriveResourceKeys('rollback_adset_conversion_contract', {
    account_id: stageJob.account_id,
    object_id: stageJob.destination_adset_id,
    snapshot_id: '123e4567-e89b-42d3-a456-426614174000',
  });
  const sharedKey = `adset-contract:${stageJob.account_id}:${stageJob.destination_adset_id}`;
  assert.ok(stageKeys.includes(sharedKey));
  assert.ok(rollbackKeys.includes(sharedKey));

  const db = { locks: new Map(), prepare(sql) { return new LockStatement(this, sql); } };
  const env = { TOKEN_VAULT_DB: db };
  await __test.acquireLocks(env, 'run-one', 'stage:locked-adset', [sharedKey]);
  await assert.rejects(
    () => __test.acquireLocks(env, 'run-one', 'rollback:known-snapshot', rollbackKeys),
    /resource_locked:adset-contract:123456789:323456789/,
  );
  assert.equal(db.locks.get(sharedKey).operation_key, 'stage:locked-adset');
});
