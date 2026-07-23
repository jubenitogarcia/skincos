import assert from 'node:assert/strict';
import test from 'node:test';
import { __test, handleRequest } from '../src/index.js';

const encoder = new TextEncoder();
const TEST_API_TOKEN = ['unit', 'auth', 'token'].join('-');
const TEST_ENCRYPTION_KEY = ['unit', 'encryption', 'key', 'with', 'enough', 'length'].join('-');
const THREADS_TOKEN = ['threads', 'fixture', 'token'].join('-');
const FACEBOOK_TOKEN = ['facebook', 'fixture', 'token'].join('-');
const INSTAGRAM_OLD_TOKEN = ['instagram', 'old', 'fixture'].join('-');
const INSTAGRAM_NEW_TOKEN = ['instagram', 'new', 'fixture'].join('-');

class FakeStatement {
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
    if (this.sql.includes('SELECT 1 AS ok')) return { ok: 1 };
    if (this.sql.includes('WHERE id = ?')) {
      return this.db.tokens.find((row) => row.id === this.values[0]) || null;
    }
    throw new Error(`Unexpected first SQL: ${this.sql}`);
  }

  async all() {
    if (!this.sql.includes('FROM credential_tokens')) {
      throw new Error(`Unexpected all SQL: ${this.sql}`);
    }
    const provider = this.values[0];
    return {
      results: this.db.tokens.filter((row) => (!provider || row.provider === provider) && row.active === 1),
    };
  }

  async run() {
    if (this.sql.includes('INSERT INTO credential_token_audit')) {
      this.db.audit.push([...this.values]);
      return { success: true };
    }
    if (this.sql.includes('UPDATE credential_tokens')) {
      const row = this.db.tokens.find((item) => item.id === this.values[5]);
      row.token_ciphertext = this.values[0];
      row.expires_at = this.values[1] || row.expires_at;
      row.last_refreshed_at = this.values[2];
      row.metadata_json = this.values[3];
      row.updated_at = this.values[4];
      return { success: true };
    }
    throw new Error(`Unexpected run SQL: ${this.sql}`);
  }
}

class FakeDb {
  constructor() {
    this.tokens = [];
    this.audit = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function env(db) {
  return {
    TOKEN_VAULT_DB: db,
    TOKEN_VAULT_API_TOKEN: TEST_API_TOKEN,
    TOKEN_VAULT_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    REQUIRE_AUTH: 'true',
    WORKER_AUTH_HEADER_NAME: 'Authorization',
    WORKER_AUTH_SCHEME: 'Bearer',
    LANDING_PAGE_FETCH: async () => new Response('', { status: 200 }),
  };
}

function authHeaders() {
  return { Authorization: `Bearer ${TEST_API_TOKEN}` };
}

function mixedCreativePayload() {
  const image = (name, hash) => ({ hash, adlabels: [{ name }] });
  const labels = (prefix) => [{ name: `${prefix}_feed` }, { name: `${prefix}_banner` }, { name: `${prefix}_vertical` }];
  const bodyLabels = labels('body');
  const titleLabels = labels('title');
  const descriptionLabels = Array.from({ length: 5 }, (_, index) => ({ name: `description_${index}` }));
  return {
    name: 'TEST VIDEO MIX',
    object_story_spec: { page_id: '123456789' },
    asset_feed_spec: {
      ad_formats: ['AUTOMATIC_FORMAT'],
      images: [image('feed_image', 'feed_hash'), image('banner_image', 'banner_hash'), image('vertical_image', 'vertical_hash')],
      videos: [{ video_id: '123456789', thumbnail_hash: 'thumbnail_hash_123456', adlabels: [{ name: 'vertical_video' }] }],
      bodies: Array.from({ length: 5 }, (_, index) => ({ text: `body ${index}`, adlabels: bodyLabels })),
      titles: Array.from({ length: 5 }, (_, index) => ({ text: `title ${index}`, adlabels: titleLabels })),
      descriptions: Array.from({ length: 5 }, (_, index) => ({ text: `description ${index}`, adlabels: [descriptionLabels[index]] })),
      link_urls: [{ website_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' }],
      call_to_action_types: ['LEARN_MORE'],
      asset_customization_rules: [
        { image_label: { name: 'feed_image' }, body_label: bodyLabels[0], title_label: titleLabels[0], description_label: descriptionLabels[0], customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['feed'] } },
        { image_label: { name: 'banner_image' }, body_label: bodyLabels[1], title_label: titleLabels[1], description_label: descriptionLabels[1], customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['search'] } },
        { image_label: { name: 'vertical_image' }, body_label: bodyLabels[2], title_label: titleLabels[2], description_label: descriptionLabels[2], customization_spec: { publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'], facebook_positions: ['instream_video', 'story', 'facebook_reels'], instagram_positions: ['story', 'reels'], audience_network_positions: ['classic'], whatsapp_positions: ['status'] } },
        { video_label: { name: 'vertical_video' }, body_label: bodyLabels[2], title_label: titleLabels[2], description_label: descriptionLabels[3], customization_spec: { publisher_platforms: ['audience_network'], audience_network_positions: ['rewarded_video'] } },
      ],
    },
    degrees_of_freedom_spec: {
      creative_features_spec: Object.fromEntries([
        'add_text_overlay', 'image_touchups', 'text_optimizations', 'inline_comment',
        'enhance_cta', 'image_brightness_and_contrast', 'reveal_details_over_time',
        'show_destination_blurbs', 'image_animation',
      ].map((key) => [key, { enroll_status: 'OPT_IN' }])),
    },
    creative_sourcing_spec: {},
  };
}

test('mixed creative accepts one rewarded-video rule and rejects any other video placement', () => {
  const payload = mixedCreativePayload();
  const validated = __test.validateCreativePayload(payload, 'creative:test:mixed');
  assert.deepEqual(validated.asset_feed_spec.ad_formats, ['AUTOMATIC_FORMAT']);
  assert.equal(validated.asset_feed_spec.videos.length, 1);

  const rejected = mixedCreativePayload();
  rejected.asset_feed_spec.asset_customization_rules[3].customization_spec.audience_network_positions = ['classic'];
  assert.throws(
    () => __test.validateCreativePayload(rejected, 'creative:test:mixed'),
    /creative_mixed_video_rule_must_be_rewarded_video_only/,
  );
});

test('video-only asset feed accepts two non-overlapping vertical-video rules with five text variants', () => {
  const videoLabel = { name: 'vertical_video' };
  const bodyLabels = Array.from({ length: 5 }, (_, index) => ({ name: `video_body_${index}` }));
  const titleLabels = Array.from({ length: 5 }, (_, index) => ({ name: `video_title_${index}` }));
  const descriptionLabels = Array.from({ length: 5 }, (_, index) => ({ name: `video_description_${index}` }));
  const payload = {
    name: 'TEST VIDEO ONLY',
    object_story_spec: { page_id: '123456789' },
    asset_feed_spec: {
      ad_formats: ['SINGLE_VIDEO'],
      videos: [{ video_id: '123456789', thumbnail_hash: 'thumbnail_hash_123456', adlabels: [videoLabel] }],
      bodies: Array.from({ length: 5 }, (_, index) => ({ text: `body ${index}`, adlabels: [bodyLabels[index]] })),
      titles: Array.from({ length: 5 }, (_, index) => ({ text: `title ${index}`, adlabels: [titleLabels[index]] })),
      descriptions: Array.from({ length: 5 }, (_, index) => ({ text: `description ${index}`, adlabels: [descriptionLabels[index]] })),
      link_urls: [{ website_url: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' }],
      call_to_action_types: ['LEARN_MORE'],
      asset_customization_rules: [
        {
          video_label: videoLabel,
          body_label: bodyLabels[0], title_label: titleLabels[0], description_label: descriptionLabels[0],
          customization_spec: {
            publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'],
            facebook_positions: ['feed', 'instream_video', 'story', 'search', 'facebook_reels', 'facebook_reels_overlay', 'notification'],
            instagram_positions: ['stream', 'story', 'reels'],
            audience_network_positions: ['classic'],
            whatsapp_positions: ['status'],
          },
        },
        {
          video_label: videoLabel,
          body_label: bodyLabels[1], title_label: titleLabels[1], description_label: descriptionLabels[1],
          customization_spec: {
            publisher_platforms: ['audience_network'],
            audience_network_positions: ['rewarded_video'],
          },
        },
      ],
    },
    degrees_of_freedom_spec: {
      creative_features_spec: Object.fromEntries([
        'add_text_overlay', 'music_generation', 'adapt_to_placement', 'video_filtering',
        'text_optimizations', 'inline_comment', 'enhance_cta', 'reveal_details_over_time',
        'show_destination_blurbs', 'video_highlights',
      ].map((key) => [key, { enroll_status: 'OPT_IN' }])),
    },
  };
  const validated = __test.validateCreativePayload(payload, 'creative:test:video-only');
  assert.equal(validated.asset_feed_spec.videos.length, 1);
  assert.equal(validated.asset_feed_spec.descriptions.length, 5);

  const rejected = structuredClone(payload);
  rejected.asset_feed_spec.asset_customization_rules[0].customization_spec.facebook_positions = ['feed'];
  assert.throws(
    () => __test.validateCreativePayload(rejected, 'creative:test:video-only'),
    /creative_video_only_placement_scope_invalid/,
  );
});

test('Meta temporary creative subcode remains retryable even when returned as code 100', () => {
  const normalized = __test.normalizeMetaError({
    error: {
      code: 100,
      error_subcode: 1487390,
      message: 'An error occurred. Please try again later',
    },
  }, 400, new Headers());
  assert.equal(normalized.classification, 'transient');
  assert.equal(normalized.retryable, true);
});

test('video start replay is anchored to the source and can reuse a persisted ready video', () => {
  const base = {
    action: 'start_video_upload', operation_key: 'video-start:v4:test', source_file_id: 'drive-video',
    source_fingerprint: 'source-md5', normalization_contract_revision: 'video9x16_h264_aac_v1',
    file_size: 1000, file_checksum: 'a'.repeat(64), resume_video_id: '123456789',
  };
  const changedBytes = { ...base, file_size: 1001, file_checksum: 'b'.repeat(64) };
  assert.deepEqual(__test.operationHashInput(base, null), __test.operationHashInput(changedBytes, null));
  const operation = {
    id: 'op', run_id: 'run', action: 'start_video_upload', status: 'completed',
    result_json: JSON.stringify({ video_id: '123456789', upload_session_id: '987654321', start_offset: '0', end_offset: '1000' }),
  };
  const selected = __test.selectReusableVideoStartOperation(
    { id: 'run', files_json: JSON.stringify([{ id: 'drive-video' }]) },
    base,
    [operation],
  );
  assert.equal(selected, operation);
  assert.equal(__test.selectReusableVideoStartOperation(
    { id: 'run', files_json: JSON.stringify([{ id: 'drive-video' }]) },
    { ...base, upload_session_id: 'different-session' },
    [operation],
  ), null);
  assert.equal(__test.selectReusableVideoStartOperation(
    { id: 'run', files_json: JSON.stringify([{ id: 'other-file' }]) }, base, [operation],
  ), null);
});

test('ad payload keeps an explicit paused calibration status and rejects unknown states', () => {
  const payload = __test.validateAdPayload({
    name: '[TEST-VIDEO-ONLY] BSS',
    status: 'PAUSED',
    adset_id: '123456789',
    creative: { creative_id: '987654321' },
  }, 'create_new');
  assert.equal(payload.status, 'PAUSED');
  assert.throws(
    () => __test.validateAdPayload({ ...payload, status: 'DRAFT' }, 'create_new'),
    /ad_status_invalid/,
  );
});

async function encryptForSeed(token, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token));
  return `v1:${Buffer.from(iv).toString('base64')}:${Buffer.from(ciphertext).toString('base64')}`;
}

test('health requires bearer auth', async () => {
  const db = new FakeDb();
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/health'),
    env(db),
  );
  assert.equal(response.status, 401);
});

test('health validates configured bindings and secrets', async () => {
  const db = new FakeDb();
  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/health', { headers: authHeaders() }),
    env(db),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.checks.d1, true);
});

test('lists decrypted provider tokens with compatibility fields', async () => {
  const db = new FakeDb();
  db.tokens.push({
    id: 'tok_threads_1',
    provider: 'threads',
    unit: 'novo_hamburgo',
    external_account_id: '123',
    token_type: 'long_lived_access_token',
    token_ciphertext: await encryptForSeed(THREADS_TOKEN, env(db).TOKEN_VAULT_ENCRYPTION_KEY),
    expires_at: null,
    last_refreshed_at: null,
    active: 1,
    metadata_json: '{}',
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
  });

  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/tokens?provider=threads', {
      headers: authHeaders(),
    }),
    env(db),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items[0].thId, '123');
  assert.equal(body.items[0].thToken, THREADS_TOKEN);
  assert.equal(body.items[0].token, THREADS_TOKEN);
});

test('lists facebook tokens with compatibility fields', async () => {
  const db = new FakeDb();
  db.tokens.push({
    id: 'tok_facebook_1',
    provider: 'facebook',
    unit: 'novo_hamburgo',
    external_account_id: '789',
    token_type: 'long_lived_access_token',
    token_ciphertext: await encryptForSeed(FACEBOOK_TOKEN, env(db).TOKEN_VAULT_ENCRYPTION_KEY),
    expires_at: null,
    last_refreshed_at: null,
    active: 1,
    metadata_json: '{}',
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
  });

  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/tokens?provider=facebook', {
      headers: authHeaders(),
    }),
    env(db),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items[0].fbId, '789');
  assert.equal(body.items[0].fbToken, FACEBOOK_TOKEN);
  assert.equal(body.items[0].token, FACEBOOK_TOKEN);
});

test('Meta Ads config emits the explicit WhatsApp destination contract without credentials', async () => {
  const db = new FakeDb();
  for (const [index, unit] of ['barra_shopping_sul', 'novo_hamburgo'].entries()) {
    db.tokens.push({
      id: `tok_meta_${index}`,
      provider: 'facebook',
      unit,
      external_account_id: `account_${index}`,
      token_type: 'long_lived_access_token',
      token_ciphertext: 'not-read-by-config',
      expires_at: null,
      active: 1,
      updated_at: '2026-07-20T00:00:00.000Z',
      metadata_json: JSON.stringify({
        meta_ads_publish: {
          row_number: index + 1,
          destination_group: unit,
          api_version: 'v25.0',
          account_id: '123456',
          campaign_id: '123457',
          adset_id: '123458',
          page_id: '123459',
          instagram_user_id: '123460',
          destination_type: 'whatsapp',
          campaign_objective: 'OUTCOME_LEADS',
          optimization_goal: 'CONVERSATIONS',
          whatsapp_destination_url: 'https://wa.me/5551999999999',
          allowed_link_hosts: ['espacofacial.com'],
          landing_pages_by_creative_group: { DEFAULT: 'https://espacofacial.com/agendamento?unit=barrashoppingsul' },
        },
      }),
    });
  }

  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/meta-ads-publish/config', { headers: authHeaders() }),
    env(db),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ready, true);
  assert.equal(body.destinations[0].destination_type, 'WHATSAPP');
  assert.equal(body.destinations[0].whatsapp_destination_url, 'https://wa.me/5551999999999');
  assert.equal(Object.prototype.hasOwnProperty.call(body.destinations[0], 'token_ciphertext'), false);
});

test('patch updates encrypted token and writes audit without token payload', async () => {
  const db = new FakeDb();
  const seedEnv = env(db);
  db.tokens.push({
    id: 'tok_instagram_1',
    provider: 'instagram',
    unit: 'barra_shopping_sul',
    external_account_id: '456',
    token_type: 'long_lived_access_token',
    token_ciphertext: await encryptForSeed(INSTAGRAM_OLD_TOKEN, seedEnv.TOKEN_VAULT_ENCRYPTION_KEY),
    expires_at: null,
    last_refreshed_at: null,
    active: 1,
    metadata_json: '{}',
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
  });

  const response = await handleRequest(
    new Request('https://api.skincos.com.br/internal/token-vault/v1/tokens/tok_instagram_1', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ token: INSTAGRAM_NEW_TOKEN, metadata: { source: 'test' } }),
    }),
    seedEnv,
  );

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.notEqual(db.tokens[0].token_ciphertext.includes(INSTAGRAM_NEW_TOKEN), true);
  assert.equal(JSON.stringify(db.audit).includes(INSTAGRAM_NEW_TOKEN), false);
});
