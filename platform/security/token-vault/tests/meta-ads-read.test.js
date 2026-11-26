import assert from 'node:assert/strict';
import test from 'node:test';
import { __test as gateway, handleMetaAdsPublishRequest } from '../src/meta-ads-publish.js';
import {
  META_ADS_READ_NEW_ACTIONS,
  META_ADS_READ_REVISION,
  __test as read,
  createMetaAdsReadActions,
  isMetaAdsReadRequest,
  metaAdsReadCapabilities,
} from '../src/meta-ads-read.js';

// Fixtures sintéticas: nenhum ID, nome ou valor abaixo corresponde a uma conta,
// campanha, conjunto ou anúncio real.
const ACCOUNT_ID = '123456789';
const OTHER_ACCOUNT_ID = '987654321';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

class ReadStatement {
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
    if (this.sql.includes('FROM meta_ads_publish_runs')) return this.db.run;
    if (this.sql.includes('FROM credential_tokens')) return this.db.credential;
    if (this.sql.includes('FROM meta_ads_publish_locks')) {
      if (this.db.failLockReads) throw new Error('D1 unavailable');
      const lock = this.db.locks.get(this.values[0]);
      return lock ? { ...lock } : null;
    }
    if (this.sql.includes('FROM meta_ads_publish_operations')) {
      const [key] = this.values;
      return this.db.operations.find((row) => row.operation_key === key || row.id === key) || null;
    }
    return null;
  }

  async all() {
    return { results: [] };
  }

  async run() {
    this.db.statements.push({ sql: this.sql, values: this.values });
    if (this.sql.includes('INSERT INTO meta_ads_publish_locks')) {
      if (this.db.failLockWrites) throw new Error('D1 unavailable');
      const [resourceKey, runId, operationKey, heartbeatAt, expiresAt] = this.values;
      const current = this.db.locks.get(resourceKey);
      // Mesma regra do SQL: só o dono da guarda estende, e nunca encurta.
      if (current && !(current.run_id === runId && current.expires_at < expiresAt)) return { success: true, meta: { changes: 0 } };
      this.db.locks.set(resourceKey, {
        resource_key: resourceKey, run_id: runId, operation_key: operationKey,
        heartbeat_at: heartbeatAt, expires_at: expiresAt,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.includes('INSERT INTO meta_ads_publish_operations')) {
      const [id, runId, operationKey, requestHash, action, createdAt, updatedAt] = this.values;
      this.db.operations.push({
        id, run_id: runId, operation_key: operationKey, request_hash: requestHash, action,
        status: 'in_progress', attempt_count: 0, result_json: '{}', error_json: '{}',
        meta_trace_id: null, rate_usage_json: '{}', created_at: createdAt, updated_at: updatedAt,
      });
    } else if (this.sql.includes('UPDATE meta_ads_publish_operations') && this.sql.includes("status = 'completed'")) {
      const [attempts, resultJson, traceId, rateUsage, updatedAt, id] = this.values;
      Object.assign(this.db.operations.find((row) => row.id === id), {
        status: 'completed', attempt_count: attempts, result_json: resultJson, error_json: '{}',
        meta_trace_id: traceId, rate_usage_json: rateUsage, updated_at: updatedAt,
      });
    } else if (this.sql.includes('UPDATE meta_ads_publish_operations') && this.sql.includes('SET status = ?')) {
      const [status, errorJson, traceId, updatedAt, id] = this.values;
      Object.assign(this.db.operations.find((row) => row.id === id), {
        status, error_json: errorJson, meta_trace_id: traceId, updated_at: updatedAt,
      });
    }
    return { success: true };
  }
}

class ReadDb {
  constructor({ runStatus = 'acquired', accountId = ACCOUNT_ID } = {}) {
    this.statements = [];
    this.operations = [];
    this.locks = new Map();
    this.failLockReads = false;
    this.failLockWrites = false;
    this.run = { id: 'map_read', status: runStatus, config_revision: 'a'.repeat(64) };
    this.credential = {
      id: 'facebook_fixture',
      provider: 'facebook',
      active: 1,
      token_ciphertext: 'encrypted',
      metadata_json: JSON.stringify({ meta_ads_publish: { account_id: accountId, api_version: 'v25.0' } }),
    };
  }

  prepare(sql) {
    return new ReadStatement(this, sql);
  }

  mutatedTables() {
    return [...new Set(this.statements
      .map((entry) => (entry.sql.match(/(?:INSERT(?: OR IGNORE)? INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/i) || [])[1])
      .filter(Boolean))].sort();
  }
}

async function operate(body, { db = new ReadDb(), graph, audits = [] } = {}) {
  const calls = [];
  const result = await handleMetaAdsPublishRequest({
    request: new Request('https://token-vault.test/internal/token-vault/v1/meta-ads-publish/runs/map_read/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_key: `read-fixture-${Math.random().toString(16).slice(2)}`,
        token_id: 'facebook_fixture',
        account_id: ACCOUNT_ID,
        api_version: 'v25.0',
        ...body,
      }),
    }),
    env: {
      TOKEN_VAULT_DB: db,
      META_GRAPH_FETCH: async (url, init) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, method: init.method, authorization: init.headers.get('Authorization') });
        return graph(parsed, init);
      },
      META_GRAPH_SLEEP: async () => {},
    },
    requestId: 'read-fixture',
    pathname: '/v1/meta-ads-publish/runs/map_read/operations',
    decryptToken: async () => 'fixture-secret',
    encryptToken: async (value) => `encrypted:${value}`,
    writeAudit: async (_env, entry) => { audits.push(entry); },
  });
  return { status: result.status, body: await result.json(), calls, db, audits };
}

function insightsRow(overrides = {}) {
  return {
    account_id: ACCOUNT_ID,
    campaign_id: '223456789',
    campaign_name: 'Campanha sintetica',
    objective: 'OUTCOME_LEADS',
    date_start: '2026-01-01',
    date_stop: '2026-01-31',
    spend: '120.50',
    impressions: '1000',
    reach: '800',
    clicks: '40',
    ctr: '4.0',
    cpc: '3.0125',
    cpm: '120.5',
    frequency: '1.25',
    inline_link_clicks: '30',
    actions: [
      { action_type: 'link_click', value: '30', '7d_click': '28' },
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '5' },
      { action_type: 'tipo invalido com espaco', value: '1' },
    ],
    cost_per_action_type: [{ action_type: 'link_click', value: '4.01' }],
    // Chaves fora da allowlist nunca chegam ao chamador.
    age: '25-34',
    gender: 'female',
    unexpected_field: 'x',
    ...overrides,
  };
}

test('read capabilities are additive, GET-only and exclude demographic breakdowns', () => {
  const capabilities = metaAdsReadCapabilities();
  assert.equal(capabilities.revision, META_ADS_READ_REVISION);
  assert.deepEqual(capabilities.graph_methods, ['GET']);
  assert.deepEqual(capabilities.actions, [...META_ADS_READ_NEW_ACTIONS]);
  assert.deepEqual(capabilities.insights.levels, ['account', 'campaign', 'adset', 'ad']);
  assert.deepEqual(capabilities.insights.periods, ['lifetime', 'monthly']);
  for (const forbidden of ['age', 'gender', 'country', 'region', 'dma', 'user_segment_key', 'hourly_stats_aggregated_by_audience_time_zone']) {
    assert.equal(read.insightsBreakdowns.includes(forbidden), false, forbidden);
  }
  assert.ok(capabilities.list_ads.effective_statuses.includes('ARCHIVED'));
  assert.ok(capabilities.list_ads.effective_statuses.includes('DELETED'));
  assert.equal(read.adsetHistoryFields.includes('targeting'), false);
  assert.equal(read.adsetHistoryFields.includes('promoted_object'), false);
  // Uma chamada não vaza estado mutável da allowlist interna.
  capabilities.insights.breakdowns.push('age');
  assert.equal(metaAdsReadCapabilities().insights.breakdowns.includes('age'), false);
});

test('existing read requests without the new parameters stay on the legacy path', () => {
  assert.equal(isMetaAdsReadRequest('list_ads', { token_id: 't', account_id: ACCOUNT_ID }), false);
  assert.equal(isMetaAdsReadRequest('get_campaign', { object_id: '223456789' }), false);
  assert.equal(isMetaAdsReadRequest('get_adset', { object_id: '323456789' }), false);
  assert.equal(isMetaAdsReadRequest('get_adset', { object_id: '323456789', view: '' }), false);
  assert.equal(isMetaAdsReadRequest('get_creative', { view: 'history' }), false);
  assert.equal(isMetaAdsReadRequest('stage_batch', { limit: 5, effective_status: ['ACTIVE'] }), false);
  assert.equal(isMetaAdsReadRequest('get_insights', {}), true);
  assert.equal(isMetaAdsReadRequest('list_ads', { effective_status: ['ARCHIVED'] }), true);
  assert.equal(isMetaAdsReadRequest('list_ads', { limit: 50 }), true);
  assert.equal(isMetaAdsReadRequest('list_ads', { after: 'abc' }), true);
  assert.equal(isMetaAdsReadRequest('get_campaign', { view: 'history' }), true);
});

test('legacy list_ads, get_campaign and get_adset keep their exact Graph requests', async () => {
  const list = await operate({ action: 'list_ads' }, {
    graph: () => jsonResponse({ data: [{ id: '423456789' }] }),
  });
  assert.equal(list.status, 200);
  assert.equal(list.calls.length, 1);
  assert.equal(list.calls[0].url.pathname, `/v25.0/act_${ACCOUNT_ID}/ads`);
  assert.equal(list.calls[0].url.searchParams.get('limit'), '500');
  assert.equal(list.calls[0].url.searchParams.has('effective_status'), false);
  assert.deepEqual(list.body.operation.result, { data: [{ id: '423456789' }], page_count: 1, item_count: 1, truncated: false });

  const campaign = await operate({ action: 'get_campaign', object_id: '223456789' }, {
    graph: () => jsonResponse({ id: '223456789', name: 'Campanha sintetica', status: 'PAUSED' }),
  });
  assert.equal(campaign.calls[0].url.searchParams.get('fields'), gateway.campaignReadFields);
  assert.deepEqual(campaign.body.operation.result, { id: '223456789', name: 'Campanha sintetica', status: 'PAUSED' });

  const adset = await operate({ action: 'get_adset', object_id: '323456789' }, {
    graph: () => jsonResponse({ id: '323456789', targeting: { geo_locations: {} } }),
  });
  assert.equal(adset.calls[0].url.searchParams.get('fields'), gateway.adsetReadFields);
  assert.deepEqual(adset.body.operation.result, { id: '323456789', targeting: { geo_locations: {} } });
});

test('get_insights reads one page from the configured account with allowlisted fields', async () => {
  const audits = [];
  const result = await operate({
    action: 'get_insights',
    level: 'campaign',
    period: 'monthly',
    since: '2026-01-01',
    until: '2026-06-30',
    object_ids: ['223456789', '223456789', '223456790'],
    effective_status: ['active', 'ARCHIVED'],
    breakdowns: ['publisher_platform'],
    limit: 50,
  }, {
    audits,
    graph: () => jsonResponse({
      data: [
        insightsRow({ publisher_platform: 'instagram' }),
        insightsRow({ account_id: OTHER_ACCOUNT_ID, campaign_id: '999999999' }),
      ],
      paging: {
        cursors: { before: 'QVFI', after: 'QVFJ_cursor-2' },
        next: 'https://graph.facebook.com/v25.0/act_123456789/insights?access_token=fixture-secret&after=QVFJ_cursor-2',
      },
    }, 200, { 'x-business-use-case-usage': JSON.stringify({ [ACCOUNT_ID]: [{ call_count: 12 }] }) }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.calls.length, 1);
  const { url, method, authorization } = result.calls[0];
  assert.equal(method, 'GET');
  assert.equal(authorization, 'Bearer fixture-secret');
  assert.equal(url.origin, 'https://graph.facebook.com');
  assert.equal(url.pathname, `/v25.0/act_${ACCOUNT_ID}/insights`);
  assert.equal(url.searchParams.has('access_token'), false);
  assert.equal(url.searchParams.get('level'), 'campaign');
  assert.equal(url.searchParams.get('time_increment'), 'monthly');
  assert.equal(url.searchParams.get('limit'), '50');
  assert.equal(url.searchParams.get('breakdowns'), 'publisher_platform');
  assert.equal(url.searchParams.has('date_preset'), false);
  assert.deepEqual(JSON.parse(url.searchParams.get('time_range')), { since: '2026-01-01', until: '2026-06-30' });
  assert.deepEqual(JSON.parse(url.searchParams.get('filtering')), [
    { field: 'campaign.id', operator: 'IN', value: ['223456789', '223456790'] },
    { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE', 'ARCHIVED'] },
  ]);
  const requested = url.searchParams.get('fields').split(',');
  for (const field of requested) {
    assert.ok([...read.insightsMetricFields, 'account_id', 'campaign_id', 'campaign_name', 'objective'].includes(field), field);
  }

  const operation = result.body.operation;
  assert.equal(operation.status, 'completed');
  assert.equal(operation.result.read_revision, META_ADS_READ_REVISION);
  assert.equal(operation.result.item_count, 1);
  assert.deepEqual(operation.result.paging, { has_next: true, after: 'QVFJ_cursor-2' });
  assert.deepEqual(operation.result.data[0], {
    level: 'campaign',
    account_id: ACCOUNT_ID,
    campaign_id: '223456789',
    campaign_name: 'Campanha sintetica',
    objective: 'OUTCOME_LEADS',
    date_start: '2026-01-01',
    date_stop: '2026-01-31',
    publisher_platform: 'instagram',
    spend: 120.5,
    impressions: 1000,
    reach: 800,
    clicks: 40,
    ctr: 4,
    cpc: 3.0125,
    cpm: 120.5,
    frequency: 1.25,
    inline_link_clicks: 30,
    actions: { link_click: 30, 'onsite_conversion.messaging_conversation_started_7d': 5 },
    cost_per_action_type: { link_click: 4.01 },
  });
  assert.deepEqual(operation.rate_usage, { 'x-business-use-case-usage': { [ACCOUNT_ID]: [{ call_count: 12 }] } });
  const serialized = JSON.stringify({ body: result.body, journal: result.db.operations });
  assert.doesNotMatch(serialized, /fixture-secret|access_token|25-34|female|unexpected_field|999999999/);
  // Mesmo journal e auditoria das demais leituras; nenhuma outra tabela muda.
  assert.deepEqual(result.db.mutatedTables(), ['meta_ads_publish_locks', 'meta_ads_publish_operations']);
  assert.deepEqual(audits.map((entry) => [entry.event, entry.status]), [['meta_ads_publish.get_insights', 'ok']]);
});

test('get_insights defaults to lifetime over the maximum preset at every level', async () => {
  for (const level of read.insightsLevels) {
    const result = await operate({ action: 'get_insights', level }, {
      graph: () => jsonResponse({ data: [], paging: { cursors: { after: 'QVFJ' } } }),
    });
    assert.equal(result.status, 200, level);
    const { url } = result.calls[0];
    assert.equal(url.searchParams.get('level'), level);
    assert.equal(url.searchParams.get('date_preset'), 'maximum');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(url.searchParams.has('time_increment'), false);
    assert.equal(url.searchParams.has('filtering'), false);
    assert.equal(url.searchParams.has('breakdowns'), false);
    // Sem `paging.next` não há próxima página, mesmo com cursor presente.
    assert.deepEqual(result.body.operation.result.paging, { has_next: false, after: null });
    assert.equal(result.body.operation.result.period, 'lifetime');
  }
});

test('get_insights rejects anything outside the closed allowlists before calling Graph', async () => {
  const cases = [
    [{ level: 'creative' }, 'insights_level_invalid'],
    [{ level: 'ad', period: 'daily' }, 'insights_period_invalid'],
    [{ level: 'ad', breakdowns: ['age'] }, 'insights_breakdown_not_allowed'],
    [{ level: 'ad', breakdowns: ['gender'] }, 'insights_breakdown_not_allowed'],
    [{ level: 'ad', breakdowns: ['country'] }, 'insights_breakdown_not_allowed'],
    [{ level: 'ad', breakdowns: 'publisher_platform' }, 'insights_breakdown_not_allowed'],
    [{ level: 'ad', breakdowns: ['publisher_platform', 'platform_position', 'impression_device'] }, 'insights_breakdown_not_allowed'],
    [{ level: 'ad', limit: 0 }, 'read_limit_invalid'],
    [{ level: 'ad', limit: 201 }, 'read_limit_invalid'],
    [{ level: 'ad', limit: '10; drop' }, 'read_limit_invalid'],
    [{ level: 'ad', after: 'https://graph.facebook.com/x' }, 'read_cursor_invalid'],
    [{ level: 'ad', after: 12345 }, 'read_cursor_invalid'],
    [{ level: 'ad', since: '2026-01-01' }, 'insights_time_range_invalid'],
    [{ level: 'ad', since: '2026-02-30', until: '2026-03-01' }, 'insights_time_range_invalid'],
    [{ level: 'ad', since: '2026-03-01', until: '2026-01-01' }, 'insights_time_range_invalid'],
    [{ level: 'ad', since: '2020-01-01', until: '2026-01-01' }, 'insights_time_range_invalid'],
    [{ level: 'ad', object_ids: [] }, 'insights_object_ids_invalid'],
    [{ level: 'ad', object_ids: Array.from({ length: 51 }, (_, index) => String(100000 + index)) }, 'insights_object_ids_invalid'],
    [{ level: 'ad', object_ids: ['12345 OR 1=1'] }, 'insights_object_id_invalid'],
    [{ level: 'ad', effective_status: ['EVERYTHING'] }, 'effective_status_invalid'],
    [{ level: 'account', object_ids: ['223456789'] }, 'insights_filter_not_supported_for_account_level'],
    [{ level: 'account', effective_status: ['ARCHIVED'] }, 'insights_filter_not_supported_for_account_level'],
  ];
  for (const [input, expected] of cases) {
    const result = await operate({ action: 'get_insights', ...input }, {
      graph: () => { throw new Error('graph must not be called'); },
    });
    assert.equal(result.status, 400, expected);
    assert.equal(result.body.error, 'meta_operation_failed');
    assert.equal(result.body.detail.message, expected);
    assert.equal(result.calls.length, 0, expected);
    assert.equal(result.db.operations[0].status, 'failed');
  }
});

test('read actions keep the account allowlist, run and action gates of the gateway', async () => {
  const otherAccount = await operate({ action: 'get_insights', level: 'ad', account_id: OTHER_ACCOUNT_ID }, {
    graph: () => { throw new Error('graph must not be called'); },
  });
  assert.equal(otherAccount.status, 403);
  assert.equal(otherAccount.body.detail.message, 'account_not_authorized_for_token');
  assert.equal(otherAccount.calls.length, 0);

  const terminal = await operate({ action: 'get_insights', level: 'ad' }, {
    db: new ReadDb({ runStatus: 'completed' }),
    graph: () => { throw new Error('graph must not be called'); },
  });
  assert.equal(terminal.status, 409);
  assert.equal(terminal.body.error, 'run_already_terminal');

  const unknown = await operate({ action: 'get_insights_raw', level: 'ad' }, {
    graph: () => { throw new Error('graph must not be called'); },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'invalid_action');
});

function lockRow(owner, msFromNow) {
  return { run_id: owner, expires_at: new Date(Date.now() + msFromNow).toISOString() };
}

const GUARD_KEY = `graph-read-guard:${ACCOUNT_ID}`;
const PACING_KEY = `graph-rate-account:${ACCOUNT_ID}`;

test('a throttled read makes one Graph call, records the read guard and blocks the next read', async () => {
  let attempts = 0;
  const db = new ReadDb();
  const result = await operate({ action: 'get_insights', level: 'account' }, {
    db,
    graph: () => {
      attempts += 1;
      return jsonResponse({ error: { message: 'User request limit reached', code: 17, is_transient: true, fbtrace_id: 'Atrace' } }, 400);
    },
  });
  // Sem retry no gateway: uma consulta recusada não vira três.
  assert.equal(attempts, 1);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, 'meta_operation_failed');
  assert.equal(result.body.detail.classification, 'transient');
  assert.equal(result.body.detail.ambiguous, false);
  assert.equal(result.db.operations[0].status, 'failed');
  assert.ok(result.calls.every((call) => call.method === 'GET'));
  const guard = db.locks.get(GUARD_KEY);
  assert.equal(guard.run_id, read.readGuardOwner);
  assert.ok(Date.parse(guard.expires_at) - Date.now() > 29 * 60_000);

  const next = await operate({ action: 'list_ads', limit: 10 }, {
    db,
    graph: () => { throw new Error('graph must not be called'); },
  });
  assert.equal(next.status, 429);
  assert.equal(next.body.detail.message, 'meta_ads_read_rate_guard');
  assert.equal(next.body.detail.ambiguous, false);
  assert.equal(next.calls.length, 0);
});

test('a read timeout is not retried and never moves the run to reconciliation_required', async () => {
  for (const error of [new TypeError('network disconnected'), Object.assign(new Error('aborted'), { name: 'AbortError' })]) {
    let attempts = 0;
    const result = await operate({ action: 'get_insights', level: 'ad', period: 'monthly' }, {
      graph: () => { attempts += 1; throw error; },
    });
    assert.equal(attempts, 1);
    assert.equal(result.status, 502);
    assert.equal(result.body.detail.ambiguous, false);
    assert.equal(result.db.operations[0].status, 'failed');
    assert.equal(result.db.statements.some((entry) => /UPDATE meta_ads_publish_runs/.test(entry.sql)), false);
    assert.equal(result.db.statements.some((entry) => /INSERT INTO meta_ads_publish_locks/.test(entry.sql)), false);
  }
});

test('insights throttle usage at 80% or more is journaled and closes the read guard until it expires', async () => {
  const db = new ReadDb();
  const first = await operate({ action: 'get_insights', level: 'campaign' }, {
    db,
    graph: () => jsonResponse({ data: [insightsRow()] }, 200, {
      'x-fb-ads-insights-throttle': JSON.stringify({ app_id_util_pct: 12, acc_id_util_pct: 83, ads_api_access_tier: 'standard_access' }),
    }),
  });
  assert.equal(first.status, 200);
  const usage = first.body.operation.rate_usage;
  assert.equal(usage['x-fb-ads-insights-throttle'].acc_id_util_pct, 83);
  assert.equal(usage.warning, true);
  assert.equal(usage.read_guard.usage_percent, 83);
  assert.equal(usage.read_guard.throttled, false);
  const remaining = Date.parse(db.locks.get(GUARD_KEY).expires_at) - Date.now();
  assert.ok(remaining > 9 * 60_000 && remaining <= 10 * 60_000);

  const blocked = await operate({ action: 'get_campaign', object_id: '223456789', view: 'history' }, {
    db,
    graph: () => { throw new Error('graph must not be called'); },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.detail.message, 'meta_ads_read_rate_guard');

  // A guarda vence sozinha.
  db.locks.set(GUARD_KEY, lockRow(read.readGuardOwner, -1000));
  const after = await operate({ action: 'get_insights', level: 'campaign' }, {
    db,
    graph: () => jsonResponse({ data: [insightsRow()] }, 200, {
      'x-business-use-case-usage': JSON.stringify({ [ACCOUNT_ID]: [{ type: 'ads_insights', call_count: 20, total_cputime: 5, total_time: 9, estimated_time_to_regain_access: 0 }] }),
    }),
  });
  assert.equal(after.status, 200);
  assert.equal(after.body.operation.rate_usage.read_guard, undefined);
  assert.ok(Date.parse(db.locks.get(GUARD_KEY).expires_at) < Date.now());
});

test('usage of 95% or more, or a regain estimate, lengthens the guard up to one hour', async () => {
  const db = new ReadDb();
  const result = await operate({ action: 'get_insights', level: 'account' }, {
    db,
    graph: () => jsonResponse({ data: [] }, 200, {
      'x-business-use-case-usage': JSON.stringify({ [ACCOUNT_ID]: [{ type: 'ads_insights', call_count: 97, total_cputime: 10, total_time: 10, estimated_time_to_regain_access: 500 }] }),
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.operation.rate_usage.pause_recommended, true);
  const remaining = Date.parse(db.locks.get(GUARD_KEY).expires_at) - Date.now();
  assert.ok(remaining > 59 * 60_000 && remaining <= 60 * 60_000);
});

test('reads are refused while the account has a recent publish mutation or unreadable guard state', async () => {
  const publishing = new ReadDb();
  publishing.locks.set(PACING_KEY, lockRow(read.mutationPacingOwner, 35_000));
  const during = await operate({ action: 'get_insights', level: 'account' }, {
    db: publishing,
    graph: () => { throw new Error('graph must not be called'); },
  });
  assert.equal(during.status, 409);
  assert.equal(during.body.detail.message, 'meta_ads_read_publish_in_progress');
  assert.equal(during.calls.length, 0);
  assert.equal(during.db.operations[0].status, 'failed');

  // Lease vencido do limitador ou linha de outro dono não bloqueiam.
  const idle = new ReadDb();
  idle.locks.set(PACING_KEY, lockRow(read.mutationPacingOwner, -1));
  idle.locks.set(GUARD_KEY, lockRow('some-other-owner', 60_000));
  const allowed = await operate({ action: 'get_insights', level: 'account' }, { db: idle, graph: () => jsonResponse({ data: [] }) });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.db.statements.some((entry) => /INSERT INTO meta_ads_publish_locks/.test(entry.sql)), false);

  const broken = new ReadDb();
  broken.failLockReads = true;
  const closed = await operate({ action: 'get_insights', level: 'account' }, {
    db: broken,
    graph: () => { throw new Error('graph must not be called'); },
  });
  assert.equal(closed.status, 503);
  assert.equal(closed.body.detail.message, 'meta_ads_read_guard_unavailable');
  assert.equal(closed.calls.length, 0);

  // Falha ao gravar a guarda não derruba a leitura; fica registrada.
  const unwritable = new ReadDb();
  unwritable.failLockWrites = true;
  const noted = await operate({ action: 'get_insights', level: 'account' }, {
    db: unwritable,
    graph: () => jsonResponse({ data: [] }, 200, { 'x-fb-ads-insights-throttle': JSON.stringify({ app_id_util_pct: 90, acc_id_util_pct: 1 }) }),
  });
  assert.equal(noted.status, 200);
  assert.equal(noted.body.operation.rate_usage.read_guard.update_failed, true);
});

test('list_ads paged mode filters archived and deleted ads and returns only an opaque cursor', async () => {
  const result = await operate({
    action: 'list_ads',
    effective_status: ['ARCHIVED', 'deleted'],
    limit: 2,
    after: 'QVFJ_prev',
  }, {
    graph: () => jsonResponse({
      data: [
        { id: '423456781', effective_status: 'ARCHIVED', access_token: 'fixture-secret' },
        { id: '423456782', effective_status: 'DELETED' },
        { id: '423456783', effective_status: 'ARCHIVED' },
      ],
      paging: { cursors: { after: 'QVFJ_next' }, next: 'https://graph.facebook.com/v25.0/next?access_token=fixture-secret' },
    }),
  });
  assert.equal(result.status, 200);
  const { url, method } = result.calls[0];
  assert.equal(method, 'GET');
  assert.equal(url.pathname, `/v25.0/act_${ACCOUNT_ID}/ads`);
  assert.deepEqual(JSON.parse(url.searchParams.get('effective_status')), ['ARCHIVED', 'DELETED']);
  assert.equal(url.searchParams.get('limit'), '2');
  assert.equal(url.searchParams.get('after'), 'QVFJ_prev');
  assert.equal(url.searchParams.get('fields'), read.adsPageFields.join(','));
  const payload = result.body.operation.result;
  assert.deepEqual(payload.data.map((ad) => ad.id), ['423456781', '423456782']);
  assert.equal(payload.item_count, 2);
  assert.equal(payload.page_count, 1);
  assert.equal(payload.truncated, true);
  assert.deepEqual(payload.effective_status, ['ARCHIVED', 'DELETED']);
  assert.deepEqual(payload.paging, { has_next: true, after: 'QVFJ_next' });
  assert.doesNotMatch(JSON.stringify(result.body), /fixture-secret|access_token/);

  for (const [input, expected] of [
    [{ effective_status: ['NOPE'] }, 'effective_status_invalid'],
    [{ effective_status: 'ARCHIVED' }, 'effective_status_invalid'],
    [{ limit: 101 }, 'read_limit_invalid'],
    [{ after: 'a b' }, 'read_cursor_invalid'],
  ]) {
    const rejected = await operate({ action: 'list_ads', ...input }, {
      graph: () => { throw new Error('graph must not be called'); },
    });
    assert.equal(rejected.status, 400, expected);
    assert.equal(rejected.body.detail.message, expected);
  }
});

test('history view of campaign and ad set returns dates and budget only for the configured account', async () => {
  const campaign = await operate({ action: 'get_campaign', object_id: '223456789', view: 'history' }, {
    graph: () => jsonResponse({
      id: '223456789',
      account_id: ACCOUNT_ID,
      name: 'Campanha sintetica',
      status: 'PAUSED',
      effective_status: 'ARCHIVED',
      created_time: '2026-01-02T10:00:00-0300',
      start_time: '2026-01-03T00:00:00-0300',
      stop_time: '2026-02-03T00:00:00-0300',
      daily_budget: '5000',
      budget_remaining: '0',
      not_requested: 'x',
    }),
  });
  assert.equal(campaign.status, 200);
  assert.equal(campaign.calls[0].method, 'GET');
  assert.equal(campaign.calls[0].url.pathname, '/v25.0/223456789');
  assert.equal(campaign.calls[0].url.searchParams.get('fields'), read.campaignHistoryFields.join(','));
  assert.deepEqual(campaign.body.operation.result, {
    read_revision: META_ADS_READ_REVISION,
    view: 'history',
    id: '223456789',
    account_id: ACCOUNT_ID,
    name: 'Campanha sintetica',
    status: 'PAUSED',
    effective_status: 'ARCHIVED',
    created_time: '2026-01-02T10:00:00-0300',
    start_time: '2026-01-03T00:00:00-0300',
    stop_time: '2026-02-03T00:00:00-0300',
    daily_budget: '5000',
    budget_remaining: '0',
  });

  const adset = await operate({ action: 'get_adset', object_id: '323456789', view: 'history' }, {
    graph: () => jsonResponse({
      id: '323456789',
      account_id: `act_${ACCOUNT_ID}`,
      campaign_id: '223456789',
      created_time: '2026-01-02T10:00:00-0300',
      end_time: '2026-02-03T00:00:00-0300',
      lifetime_budget: '90000',
      targeting: { custom_audiences: [{ id: '1' }] },
      promoted_object: { pixel_id: '1' },
    }),
  });
  assert.equal(adset.status, 200);
  const fields = adset.calls[0].url.searchParams.get('fields').split(',');
  assert.equal(fields.includes('targeting'), false);
  assert.equal(fields.includes('promoted_object'), false);
  assert.ok(fields.includes('created_time') && fields.includes('lifetime_budget') && fields.includes('budget_remaining'));
  assert.equal('targeting' in adset.body.operation.result, false);
  assert.equal('promoted_object' in adset.body.operation.result, false);
  assert.equal(adset.body.operation.result.lifetime_budget, '90000');

  const foreign = await operate({ action: 'get_campaign', object_id: '223456789', view: 'history' }, {
    graph: () => jsonResponse({ id: '223456789', account_id: OTHER_ACCOUNT_ID, name: 'Outra conta' }),
  });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.detail.message, 'object_not_in_authorized_account');
  assert.doesNotMatch(JSON.stringify(foreign.body), /Outra conta/);

  const badView = await operate({ action: 'get_adset', object_id: '323456789', view: 'full' }, {
    graph: () => { throw new Error('graph must not be called'); },
  });
  assert.equal(badView.status, 400);
  assert.equal(badView.body.detail.message, 'read_view_invalid');
});

test('the read module refuses to be built without the gateway primitives', () => {
  assert.throws(() => createMetaAdsReadActions({}), /meta_ads_read_dependency_missing:resolveGraphAuth/);
});
