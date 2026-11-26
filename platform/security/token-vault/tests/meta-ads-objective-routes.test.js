import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { handleRequest, handleScheduled } from '../src/index.js';
import {
  handleMetaAdsObjectiveRoutesRequest,
  handleMetaAdsPublishRequest,
} from '../src/meta-ads-publish.js';
import {
  OBJECTIVE_ROUTE_ACTIONS,
  OBJECTIVE_ROUTES_PREFIX,
  metaAdsObjectiveRoutesInternals as internals,
  objectiveRouteBudgetCheck,
  objectiveRouteCalendar,
  objectiveRouteNames,
  objectiveRouteUnitCode,
} from '../src/meta-ads-objective-routes.js';

// Fixtures sintéticas: nenhum ID, nome, valor ou público abaixo corresponde a
// uma conta, campanha, conjunto ou página real, e os tetos são inventados.
const ACCOUNT_ID = '123456789';
const PAGE_ID = '555000111';
const WPP_CAMPAIGN_ID = '700000001';
const WPP_ADSET = { BSS: '710000001', NH: '710000002' };
const TOKEN = { BSS: 'tok-bss', NH: 'tok-nh' };
const GROUP = { BSS: 'BarraShoppingSul', NH: 'Novo Hamburgo' };
const CEILINGS = { BSS: { base: 8000, forte: 13000 }, NH: { base: 6000, forte: 11000 } };
// 26/11/2026 12:00 em America/Sao_Paulo: 5 dias restantes contando hoje.
const NOW = Date.parse('2026-11-26T15:00:00Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');

// D1 de teste sobre SQLite real: as migrations e o SQL do módulo rodam de fato.
class TestD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    for (const name of ['0001_initial.sql', '0002_meta_ads_publish_journal.sql', '0007_meta_ads_objective_routes.sql']) {
      this.db.exec(migration(name));
    }
  }

  prepare(sql) {
    const db = this.db;
    const statement = (values) => ({
      first: async () => {
        const row = db.prepare(sql).get(...values);
        return row ? { ...row } : null;
      },
      all: async () => ({ results: db.prepare(sql).all(...values).map((row) => ({ ...row })) }),
      run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
    });
    return { bind: (...values) => statement(values), ...statement([]) };
  }

  rows(sql, ...values) {
    return this.db.prepare(sql).all(...values).map((row) => ({ ...row }));
  }
}

function graphError(message, code = 100, status = 400) {
  return new Response(JSON.stringify({ error: { message, type: 'GraphMethodException', code, fbtrace_id: 'trace-test' } }), {
    status, headers: { 'content-type': 'application/json' },
  });
}

// Conta de anúncios falsa, com estado: o que uma chamada cria a seguinte lê.
class FakeGraph {
  constructor() {
    this.currency = 'BRL';
    this.timezone = 'America/Sao_Paulo';
    // Gasto do mês que nenhuma linha por conjunto explica (conjunto apagado).
    this.unattributedSpend = 0;
    this.campaigns = new Map();
    this.adsets = new Map();
    this.ads = new Map();
    this.spend = new Map();
    this.calls = [];
    this.interceptors = [];
    this.nextId = 800000001;
    this.addCampaign({ id: WPP_CAMPAIGN_ID, name: 'Campanha WhatsApp de teste', status: 'ACTIVE', objective: 'OUTCOME_LEADS' });
    this.addAdset({ id: WPP_ADSET.BSS, name: 'Conjunto WhatsApp A', campaign_id: WPP_CAMPAIGN_ID, status: 'ACTIVE', daily_budget: '10500', optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP' });
    this.addAdset({ id: WPP_ADSET.NH, name: 'Conjunto WhatsApp B', campaign_id: WPP_CAMPAIGN_ID, status: 'ACTIVE', daily_budget: '8100', optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP' });
    this.spend.set(WPP_ADSET.BSS, 2700);
    this.spend.set(WPP_ADSET.NH, 2100);
  }

  addCampaign(campaign) {
    this.campaigns.set(campaign.id, { account_id: ACCOUNT_ID, ...campaign });
  }

  addAdset(adset) {
    this.adsets.set(adset.id, { account_id: ACCOUNT_ID, ...adset });
  }

  addAd(ad) {
    this.ads.set(ad.id, { account_id: ACCOUNT_ID, ...ad });
  }

  intercept(fn) {
    this.interceptors.push(fn);
  }

  posts() {
    return this.calls.filter((call) => call.method === 'POST');
  }

  adsetView(adset) {
    const campaign = this.campaigns.get(adset.campaign_id) || {};
    return { ...adset, campaign: { ...campaign } };
  }

  ok(body) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  fetch = async (target, init = {}) => {
    const url = new URL(target);
    assert.equal(url.origin, 'https://graph.facebook.com');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-access-token');
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { method, path, body, query: Object.fromEntries(url.searchParams) };
    this.calls.push(call);
    let after = null;
    for (const interceptor of this.interceptors) {
      const verdict = await interceptor(call);
      if (verdict instanceof Response) return verdict;
      if (verdict === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (verdict === 'timeout_after') after = verdict;
    }
    const result = this.route(call);
    if (after) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return result;
  };

  route({ method, path, body, query }) {
    const account = `act_${ACCOUNT_ID}`;
    const nameFilter = () => {
      const filtering = JSON.parse(query.filtering || '[]');
      const entry = filtering.find((item) => item.field === 'name');
      return entry ? (row) => row.name.includes(entry.value) : () => true;
    };
    if (method === 'GET') {
      if (path === account) return this.ok({ id: account, currency: this.currency, timezone_name: this.timezone });
      if (path === `${account}/campaigns`) return this.ok({ data: [...this.campaigns.values()].filter(nameFilter()) });
      if (path === `${account}/adsets`) return this.ok({ data: [...this.adsets.values()].map((adset) => this.adsetView(adset)) });
      if (path === `${account}/ads`) return this.ok({ data: [...this.ads.values()] });
      if (path === `${account}/insights` && query.level === 'account') {
        const total = [...this.spend.values()].reduce((sum, value) => sum + value, 0) + this.unattributedSpend;
        return this.ok({ data: total > 0 ? [{ spend: total.toFixed(2) }] : [] });
      }
      if (path === `${account}/insights`) {
        return this.ok({ data: [...this.spend].map(([adsetId, spend]) => ({ adset_id: adsetId, spend: spend.toFixed(2) })) });
      }
      const [id, edge] = path.split('/');
      if (edge === 'adsets') return this.ok({ data: [...this.adsets.values()].filter((row) => row.campaign_id === id).filter(nameFilter()) });
      if (edge === 'ads') return this.ok({ data: [...this.ads.values()].filter((row) => row.adset_id === id) });
      if (!edge && this.campaigns.has(id)) return this.ok(this.campaigns.get(id));
      if (!edge && this.adsets.has(id)) return this.ok(this.adsetView(this.adsets.get(id)));
      if (!edge && this.ads.has(id)) return this.ok(this.ads.get(id));
      return graphError('Unsupported get request');
    }
    if (path === `${account}/campaigns`) {
      const id = String(this.nextId += 1);
      this.addCampaign({ id, ...body });
      return this.ok({ id });
    }
    if (path === `${account}/adsets`) {
      const id = String(this.nextId += 1);
      this.addAdset({ id, ...body, daily_budget: String(body.daily_budget) });
      return this.ok({ id });
    }
    for (const store of [this.campaigns, this.adsets, this.ads]) {
      if (store.has(path)) {
        const next = { ...body };
        if ('daily_budget' in next) next.daily_budget = String(next.daily_budget);
        Object.assign(store.get(path), next);
        return this.ok({ success: true });
      }
    }
    return graphError('Unsupported post request');
  }
}

function setup({ mode = 'on', policies = true } = {}) {
  const d1 = new TestD1();
  const graph = new FakeGraph();
  const clock = { now: NOW };
  const audits = [];
  for (const unit of ['BSS', 'NH']) {
    d1.db.prepare(
      `INSERT INTO credential_tokens (id, provider, unit, external_account_id, token_type, token_ciphertext, active, metadata_json)
       VALUES (?, 'facebook', ?, ?, 'page', 'ciphertext', 1, ?)`,
    ).run(TOKEN[unit], unit, `ext-${unit}`, JSON.stringify({
      meta_ads_publish: {
        destination_group: GROUP[unit],
        api_version: 'v25.0',
        account_id: ACCOUNT_ID,
        campaign_id: WPP_CAMPAIGN_ID,
        adset_id: WPP_ADSET[unit],
        page_id: PAGE_ID,
        instagram_user_id: '666000111',
      },
    }));
  }
  const env = {
    TOKEN_VAULT_DB: d1,
    META_ADS_OBJECTIVE_ROUTES_MODE: mode,
    META_ADS_OBJECTIVE_ROUTES_NOW: () => clock.now,
    META_GRAPH_FETCH: graph.fetch,
    META_GRAPH_SLEEP: async () => {},
  };
  const ctx = { d1, graph, clock, env, audits };
  ctx.call = (sub, body, options = {}) => callRoute(ctx, sub, body, options);
  return ctx;
}

async function callRoute(ctx, sub, body, { role = 'operational', method = 'POST' } = {}) {
  const pathname = `${OBJECTIVE_ROUTES_PREFIX}${sub}`;
  const response = await handleMetaAdsObjectiveRoutesRequest({
    request: new Request(`https://vault.test${pathname}`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }),
    env: ctx.env,
    requestId: 'req-test',
    pathname,
    role,
    decryptToken: async () => 'synthetic-access-token',
    writeAudit: async (env, input) => { ctx.audits.push(input); },
  });
  return { status: response.status, body: await response.json() };
}

function policyBody(unit, overrides = {}) {
  return {
    unit,
    token_id: TOKEN[unit],
    enabled: true,
    ceilings_monthly_brl: { ...CEILINGS[unit] },
    month_profiles: {},
    targeting: { geo_locations: { countries: ['BR'] }, age_min: 25 },
    ...overrides,
  };
}

async function withPolicies(ctx, overrides = {}) {
  for (const unit of ['BSS', 'NH']) {
    const result = await ctx.call('/policy', policyBody(unit, overrides[unit] || {}), { role: 'admin', method: 'PUT' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  return ctx;
}

const CATALOG = {
  TRAFFIC_SITE_AGENDAMENTO: { campaign_objective: 'OUTCOME_TRAFFIC', optimization_goal: 'LANDING_PAGE_VIEWS', destination_type: 'WEBSITE', promoted_object: 'none' },
  AWARENESS: {
    campaign_objective: 'OUTCOME_AWARENESS', optimization_goal: 'REACH', destination_type: '', promoted_object: 'page_id',
    frequency_control_specs: [{ event: 'IMPRESSIONS', interval_days: 7, max_frequency: 2 }],
  },
  ENGAGEMENT_VIDEO: { campaign_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'THRUPLAY', destination_type: 'ON_VIDEO', promoted_object: 'none' },
};

// Mesmo formato do pedido `meta_ads.objective_route_request.v1` do workflow.
function routeRequest(unit, objective, dailyBrl, overrides = {}) {
  const spec = CATALOG[objective] || CATALOG.TRAFFIC_SITE_AGENDAMENTO;
  const names = internals.catalog[objective] && internals.catalog[objective].creatable
    ? objectiveRouteNames(unit, objective)
    : { campaign: 'x', adset: 'x' };
  const routeKey = `objroute_v1:${unit}:${objective}`;
  const request = {
    schema: 'meta_ads.objective_route_request.v1',
    route_key: routeKey,
    unit,
    objective,
    approval_code: 'ZZZZ',
    status_on_create: 'PAUSED',
    budget_mode: 'ABO',
    daily_budget_brl: dailyBrl,
    ceiling_monthly_brl: CEILINGS[unit].base,
    month_profile: 'base',
    campaign: {
      name: names.campaign, objective: spec.campaign_objective, special_ad_categories: [], status: 'PAUSED',
      is_adset_budget_sharing_enabled: false,
    },
    adset: {
      name: names.adset,
      optimization_goal: spec.optimization_goal,
      billing_event: 'IMPRESSIONS',
      ...(spec.destination_type ? { destination_type: spec.destination_type } : {}),
      promoted_object: spec.promoted_object,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      status: 'PAUSED',
      daily_budget_minor_units: Math.round(dailyBrl * 100),
      targeting_ref: `vault_unit_targeting:${unit}`,
      ...(spec.frequency_control_specs ? { frequency_control_specs: spec.frequency_control_specs } : {}),
    },
    creative_contract: { cta: 'BOOK_NOW', link: 'scheduling_page' },
    source_run_id: 'run-test-1',
  };
  const merged = { ...request, ...overrides, campaign: { ...request.campaign, ...(overrides.campaign || {}) }, adset: { ...request.adset, ...(overrides.adset || {}) } };
  return { action: 'ensure_objective_route', idempotency_key: routeKey, request: merged };
}

async function ensure(ctx, unit = 'NH', objective = 'TRAFFIC_SITE_AGENDAMENTO', dailyBrl = 23, overrides = {}) {
  return ctx.call('/requests', routeRequest(unit, objective, dailyBrl, overrides));
}

async function ensureOk(ctx, unit = 'NH', objective = 'TRAFFIC_SITE_AGENDAMENTO', dailyBrl = 23) {
  const result = await ensure(ctx, unit, objective, dailyBrl);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status, 'PENDING_APPROVAL');
  return result.body;
}

let replyCounter = 0;
function decision(ctx, route, verdict = 'APPROVE', overrides = {}) {
  replyCounter += 1;
  return ctx.call('/decisions', {
    action: 'decide_objective_route',
    route_key: route.route_key,
    approval_code: route.approval_code,
    decision: verdict,
    reply_message_id: `reply-${replyCounter}`,
    reply_ts: Math.floor(ctx.clock.now / 1000),
    local_checks: { ok: true, checks: [] },
    ...overrides,
  });
}

function activePosts(ctx) {
  return ctx.graph.posts().filter((call) => call.body && call.body.status === 'ACTIVE');
}

function events(ctx, routeKey) {
  return ctx.d1.rows(
    `SELECT event FROM meta_ads_objective_route_events WHERE route_key = ? ORDER BY rowid`, routeKey,
  ).map((row) => row.event);
}

// ------------------------------------------------------------ funções puras

test('calendário do teto: dias restantes contam hoje, em America/Sao_Paulo (aceite 3)', () => {
  assert.deepEqual(objectiveRouteCalendar(NOW), {
    today: '2026-11-26', month_key: '2026-11', month_start: '2026-11-01', days_remaining: 5,
    next_month_key: '2026-12', days_next_month: 31,
  });
  // 02:30 UTC de 01/12 ainda é 30/11 23:30 em São Paulo: resta 1 dia (hoje).
  assert.equal(objectiveRouteCalendar(Date.parse('2026-12-01T02:30:00Z')).days_remaining, 1);
  assert.equal(objectiveRouteCalendar(Date.parse('2026-12-01T02:30:00Z')).month_key, '2026-11');
  // 03:00 UTC já é o dia 1: o mês inteiro, contando hoje, e a virada do ano.
  const december = objectiveRouteCalendar(Date.parse('2026-12-01T03:00:00Z'));
  assert.equal(december.days_remaining, 31);
  assert.equal(december.next_month_key, '2027-01');
  assert.equal(objectiveRouteCalendar(Date.parse('2028-02-29T12:00:00Z')).days_remaining, 1);
});

test('conta do teto: margem de 10% no mês corrente e na virada', () => {
  const base = { ceiling_monthly_brl: 5000, spend_mtd_brl: 2100, committed_daily_brl: 81, new_daily_brl: 23, days_remaining: 5, next_ceiling_monthly_brl: 5000, days_next_month: 31 };
  assert.deepEqual(objectiveRouteBudgetCheck(base), {
    ok: true, reason: 'within_ceiling', projected_brl: 2620, limit_brl: 4500, headroom_brl: 1880,
    next_month_projected_brl: 3224, next_month_limit_brl: 4500,
  });
  // Exatamente no limite passa; um centavo acima não.
  assert.equal(objectiveRouteBudgetCheck({ ...base, spend_mtd_brl: 3980 }).ok, true);
  assert.equal(objectiveRouteBudgetCheck({ ...base, spend_mtd_brl: 3980.01 }).reason, 'ceiling_exceeded');
  // Cabe no mês corrente, mas não no mês seguinte inteiro.
  assert.equal(objectiveRouteBudgetCheck({ ...base, committed_daily_brl: 130 }).reason, 'next_month_ceiling_exceeded');
  for (const broken of [
    { spend_mtd_brl: null }, { committed_daily_brl: undefined }, { days_remaining: 0 }, { days_remaining: 32 },
    { ceiling_monthly_brl: 0 }, { next_ceiling_monthly_brl: null }, { days_next_month: 27 }, { new_daily_brl: -1 },
  ]) {
    assert.equal(objectiveRouteBudgetCheck({ ...base, ...broken }).reason, 'budget_inputs_invalid', JSON.stringify(broken));
  }
  assert.equal(internals.budgetMargin, 0.1);
});

test('unidade pelo destination_group, como no workflow', () => {
  assert.equal(objectiveRouteUnitCode('BarraShoppingSul'), 'BSS');
  assert.equal(objectiveRouteUnitCode('Novo Hamburgo'), 'NH');
  assert.equal(objectiveRouteUnitCode('nh'), 'NH');
  assert.equal(objectiveRouteUnitCode('Outra unidade'), '');
});

// ---------------------------------------------------- interruptor e papéis

test('desligado por padrão: rotas recusam sem tocar na Graph e a capacidade não é anunciada', async () => {
  const ctx = setup({ mode: 'off' });
  for (const [sub, body] of [
    ['/requests', routeRequest('NH', 'TRAFFIC_SITE_AGENDAMENTO', 23)],
    ['/pending', { action: 'list_pending_objective_routes' }],
    ['/decisions', { action: 'decide_objective_route' }],
    ['/monitor', { action: 'monitor_objective_routes' }],
  ]) {
    const result = await ctx.call(sub, body);
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'objective_routes_disabled');
  }
  assert.equal((await handleScheduled({}, ctx.env, {})).mode, 'off');
  assert.equal(ctx.graph.calls.length, 0);

  const config = async (env) => (await handleMetaAdsPublishRequest({
    request: new Request('https://vault.test/v1/meta-ads-publish/config'), env, requestId: 'req', pathname: '/v1/meta-ads-publish/config',
  })).json();
  const off = await config(ctx.env);
  assert.equal('objective_route_actions' in off.capabilities, false);
  assert.equal('objective_routes' in off.capabilities, false);

  const on = await config({ ...ctx.env, META_ADS_OBJECTIVE_ROUTES_MODE: 'on' });
  assert.deepEqual(on.capabilities.objective_route_actions, [...OBJECTIVE_ROUTE_ACTIONS]);
  assert.deepEqual(on.capabilities.objective_route_actions, ['ensure_objective_route', 'list_pending_objective_routes', 'decide_objective_route']);
  assert.equal(on.capabilities.objective_routes.revision, 'objroute_v1');
  // O contrato do workflow e as capacidades antigas não mudam com o interruptor.
  assert.equal(on.capabilities.workflow_contract_revision, off.capabilities.workflow_contract_revision);
  assert.deepEqual(on.capabilities.video_upload, off.capabilities.video_upload);
  assert.deepEqual(on.capabilities.tracking, off.capabilities.tracking);

  // Ligado, mas sem a migration 0007: não anuncia.
  const bare = { ...ctx.env, META_ADS_OBJECTIVE_ROUTES_MODE: 'on', TOKEN_VAULT_DB: { prepare: (sql) => {
    if (sql.includes('meta_ads_objective_route')) throw new Error('no such table');
    return ctx.d1.prepare(sql);
  } } };
  assert.equal('objective_route_actions' in (await config(bare)).capabilities, false);
});

test('papéis: só admin e operacional chegam às rotas, e a política é só do admin', async () => {
  const ctx = await withPolicies(setup());
  const env = {
    ...ctx.env, REQUIRE_AUTH: 'true',
    TOKEN_VAULT_API_TOKEN: 'synthetic-admin', TOKEN_VAULT_N8N_API_TOKEN: 'synthetic-n8n', TOKEN_VAULT_ANALYTICS_API_TOKEN: 'synthetic-analytics',
  };
  const post = (bearer, sub, body, method = 'POST') => handleRequest(new Request(`https://vault.test/internal/token-vault${OBJECTIVE_ROUTES_PREFIX}${sub}`, {
    method, headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  const list = { action: 'list_pending_objective_routes' };
  assert.equal((await post('synthetic-analytics', '/pending', list)).status, 403);
  assert.equal((await post('wrong', '/pending', list)).status, 401);
  const operational = await post('synthetic-n8n', '/pending', list);
  assert.equal(operational.status, 200);
  assert.deepEqual((await operational.json()).pending, []);
  assert.equal((await post('synthetic-n8n', '/policy', policyBody('NH'), 'PUT')).status, 403);
  assert.equal((await post('synthetic-admin', '/policy', policyBody('NH'), 'PUT')).status, 200);

  // Política inválida ou de um token que não é da unidade é recusada.
  const admin = (body) => ctx.call('/policy', body, { role: 'admin', method: 'PUT' });
  assert.equal((await admin(policyBody('NH', { token_id: TOKEN.BSS }))).body.error, 'objective_route_policy_token_not_configured_for_unit');
  assert.equal((await admin(policyBody('NH', { ceilings_monthly_brl: { base: 9000, forte: 8000 } }))).body.detail.field, 'ceilings_monthly_brl');
  assert.equal((await admin(policyBody('NH', { targeting: {} }))).body.detail.field, 'targeting');
  assert.equal((await admin(policyBody('NH', { month_profiles: { '2026-13': 'forte' } }))).body.detail.field, 'month_profiles');
  assert.equal((await admin({ ...policyBody('NH'), extra: 1 })).body.detail.field, 'unknown_key');
});

// ------------------------------------------------------------------ criação

test('criação: campanha e conjunto nascem PAUSED, com os campos da Marketing API certos por objetivo (aceite 8)', async () => {
  const ctx = await withPolicies(setup());
  const traffic = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  assert.equal(traffic.new_request, true);
  assert.equal(traffic.campaign_status, 'PAUSED');
  assert.equal(traffic.adset_status, 'PAUSED');
  assert.match(traffic.campaign_id, /^\d+$/);
  assert.match(traffic.adset_id, /^\d+$/);
  assert.equal(Date.parse(traffic.expires_at) - Date.parse(traffic.created_at), 24 * HOUR);
  const awareness = await ensureOk(ctx, 'BSS', 'AWARENESS', 15);
  const video = await ensureOk(ctx, 'BSS', 'ENGAGEMENT_VIDEO', 16);

  const posts = ctx.graph.posts();
  assert.equal(posts.length, 6);
  // Nenhuma chamada de criação leva outro status.
  assert.ok(posts.every((call) => call.body.status === 'PAUSED'));
  const [trafficCampaign, trafficAdset, awarenessCampaign, awarenessAdset, videoCampaign, videoAdset] = posts.map((call) => call.body);

  assert.deepEqual(trafficCampaign, {
    name: 'EF | NH | TRAF_AGD | ABO | objroute_v1', objective: 'OUTCOME_TRAFFIC', status: 'PAUSED',
    special_ad_categories: [], is_adset_budget_sharing_enabled: false,
  });
  for (const campaign of [trafficCampaign, awarenessCampaign, videoCampaign]) {
    assert.equal(campaign.is_adset_budget_sharing_enabled, false);
    assert.equal('daily_budget' in campaign, false);
    assert.equal('lifetime_budget' in campaign, false);
  }
  assert.deepEqual(trafficAdset, {
    name: 'NH | TRAF_AGD | LANDING_PAGE_VIEWS | objroute_v1', campaign_id: traffic.campaign_id, status: 'PAUSED',
    // R$ 23 por dia vão para a Meta em centavos.
    daily_budget: 2300, billing_event: 'IMPRESSIONS', optimization_goal: 'LANDING_PAGE_VIEWS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting: { geo_locations: { countries: ['BR'] }, age_min: 25 },
    destination_type: 'WEBSITE',
  });
  assert.equal('promoted_object' in trafficAdset, false);
  assert.equal('frequency_control_specs' in trafficAdset, false);

  assert.equal(awarenessCampaign.objective, 'OUTCOME_AWARENESS');
  assert.equal(awarenessAdset.optimization_goal, 'REACH');
  assert.equal('destination_type' in awarenessAdset, false);
  assert.deepEqual(awarenessAdset.promoted_object, { page_id: PAGE_ID });
  assert.deepEqual(awarenessAdset.frequency_control_specs, [{ event: 'IMPRESSIONS', interval_days: 7, max_frequency: 2 }]);
  assert.equal(awarenessAdset.daily_budget, 1500);

  assert.equal(videoCampaign.objective, 'OUTCOME_ENGAGEMENT');
  assert.equal(videoAdset.optimization_goal, 'THRUPLAY');
  assert.equal(videoAdset.destination_type, 'ON_VIDEO');
  assert.equal('promoted_object' in videoAdset, false);
  assert.equal('frequency_control_specs' in videoAdset, false);
  assert.equal(awareness.status, 'PENDING_APPROVAL');
  assert.equal(video.status, 'PENDING_APPROVAL');

  assert.deepEqual(events(ctx, traffic.route_key), [
    'route_requested', 'create_requested', 'create_done', 'create_requested', 'create_done', 'pending_approval',
  ]);
});

test('pedido que não bate com o catálogo do Vault é recusado antes de qualquer chamada', async () => {
  const ctx = await withPolicies(setup());
  const cases = [
    [{ status_on_create: 'ACTIVE' }, 'status_on_create'],
    [{ campaign: { status: 'ACTIVE' } }, 'campaign.status'],
    [{ adset: { status: 'ACTIVE' } }, 'adset.status'],
    [{ budget_mode: 'CBO' }, 'budget_mode'],
    [{ campaign: { is_adset_budget_sharing_enabled: true } }, 'campaign.is_adset_budget_sharing_enabled'],
    [{ campaign: { objective: 'OUTCOME_SALES' } }, 'campaign.objective'],
    [{ campaign: { name: 'Outro nome' } }, 'campaign.name'],
    [{ adset: { optimization_goal: 'LINK_CLICKS' } }, 'adset.optimization_goal'],
    [{ adset: { destination_type: 'WHATSAPP' } }, 'adset.destination_type'],
    [{ adset: { promoted_object: 'page_id' } }, 'adset.promoted_object'],
    [{ adset: { frequency_control_specs: [{ event: 'IMPRESSIONS', interval_days: 7, max_frequency: 2 }] } }, 'adset.frequency_control_specs'],
    [{ adset: { daily_budget_minor_units: 23 } }, 'daily_budget'],
    [{ adset: { targeting_ref: 'vault_unit_targeting:BSS' } }, 'adset.targeting_ref'],
    [{ unit: 'BSS' }, 'route_key'],
  ];
  for (const [overrides, field] of cases) {
    const result = await ensure(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23, overrides);
    assert.equal(result.status, 400, field);
    assert.equal(result.body.error, 'objective_route_request_invalid');
    assert.equal(result.body.detail.field, field);
  }
  const wrongKey = routeRequest('NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  wrongKey.idempotency_key = 'outra-chave';
  assert.equal((await ctx.call('/requests', wrongKey)).body.detail.field, 'idempotency_key');
  // Objetivos sem rota a criar.
  assert.equal((await ensure(ctx, 'NH', 'LEADS_WHATSAPP', 70)).body.error, 'objective_route_uses_current_route');
  assert.equal((await ensure(ctx, 'NH', 'LEADS_FORM', 80)).body.error, 'objective_route_objective_disabled');
  assert.equal((await ensure(ctx, 'NH', 'CONVERSION_SITE_AGENDAMENTO', 150)).body.error, 'objective_route_objective_disabled');
  // O teto vale o da política do Vault, não o do pedido.
  assert.equal((await ensure(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23, { ceiling_monthly_brl: 11000 })).body.error, 'objective_route_ceiling_above_vault_policy');
  assert.equal((await ensure(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 180)).body.error, 'objective_route_daily_budget_above_ceiling');
  assert.equal(ctx.graph.calls.length, 0);
  assert.equal(ctx.d1.rows('SELECT id FROM meta_ads_objective_routes').length, 0);

  // Unidade sem política habilitada não cria nada.
  const bare = setup();
  assert.equal((await ensure(bare)).body.error, 'objective_route_unit_not_enabled');
  await bare.call('/policy', policyBody('NH', { enabled: false }), { role: 'admin', method: 'PUT' });
  assert.equal((await ensure(bare)).body.error, 'objective_route_unit_not_enabled');
  assert.equal(bare.graph.calls.length, 0);
});

test('criação idempotente por route_key: repetir devolve o mesmo código e não cria de novo', async () => {
  const ctx = await withPolicies(setup());
  const first = await ensureOk(ctx);
  const postsBefore = ctx.graph.posts().length;
  const callsBefore = ctx.graph.calls.length;
  const again = await ensure(ctx);
  assert.equal(again.status, 200);
  assert.equal(again.body.new_request, false);
  assert.equal(again.body.approval_code, first.approval_code);
  assert.equal(again.body.campaign_id, first.campaign_id);
  assert.equal(again.body.adset_id, first.adset_id);
  assert.equal(ctx.graph.posts().length, postsBefore);
  assert.equal(ctx.graph.calls.length, callsBefore);
  // Mesmo route_key com outro orçamento, com a pendência aberta: conflito.
  const other = await ensure(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 25);
  assert.equal(other.status, 409);
  assert.equal(other.body.error, 'objective_route_request_conflict');
  assert.equal(ctx.d1.rows('SELECT id FROM meta_ads_objective_routes').length, 1);
});

test('criação parcial: a retomada reaproveita a campanha e nunca duplica (aceite 6)', async () => {
  // (a) A campanha foi criada e a criação do conjunto falhou sem efeito.
  const ctx = await withPolicies(setup());
  let failed = false;
  ctx.graph.intercept((call) => {
    if (!failed && call.method === 'POST' && call.path.endsWith('/adsets')) {
      failed = true;
      return 'timeout';
    }
    return undefined;
  });
  const partial = await ensure(ctx);
  assert.equal(partial.status, 502);
  assert.equal(partial.body.error, 'objective_route_creation_incomplete');
  assert.equal(partial.body.detail.route_status, 'CREATING');
  const [stored] = ctx.d1.rows('SELECT status, campaign_id, adset_id FROM meta_ads_objective_routes');
  assert.equal(stored.status, 'CREATING');
  assert.match(stored.campaign_id, /^\d+$/);
  assert.equal(stored.adset_id, null);
  // Em CREATING a rota não aparece como pendência nem pode ser decidida.
  assert.deepEqual((await ctx.call('/pending', { action: 'list_pending_objective_routes' })).body.pending, []);

  // Timeout sem resposta: a Meta pode ter criado o conjunto. Dentro da janela
  // o Vault procura pelo nome e, sem achar, espera em vez de criar de novo.
  const waiting = await ensure(ctx);
  assert.equal(waiting.status, 502);
  assert.equal(waiting.body.detail.cause_code, 'objective_route_create_unconfirmed');
  assert.ok(waiting.body.detail.retry_after_seconds > 0);
  assert.equal(ctx.graph.posts().filter((call) => call.path.endsWith('/adsets')).length, 1);
  ctx.clock.now += internals.createUnconfirmedWindowMs + 60_000;

  const resumed = await ensure(ctx);
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.status, 'PENDING_APPROVAL');
  assert.equal(resumed.body.new_request, true);
  assert.equal(resumed.body.campaign_id, stored.campaign_id);
  const names = objectiveRouteNames('NH', 'TRAFFIC_SITE_AGENDAMENTO');
  assert.equal([...ctx.graph.campaigns.values()].filter((row) => row.name === names.campaign).length, 1);
  assert.equal([...ctx.graph.adsets.values()].filter((row) => row.name === names.adset).length, 1);
  assert.equal(ctx.graph.posts().filter((call) => call.path.endsWith('/campaigns')).length, 1);

  // (b) A resposta se perdeu, mas a Meta criou: a campanha e depois o conjunto
  // são achados pelo nome, sem segundo POST de criação.
  const lost = await withPolicies(setup());
  let dropped = 0;
  lost.graph.intercept((call) => {
    if (call.method === 'POST' && dropped < 2 && /\/(campaigns|adsets)$/.test(call.path)) {
      dropped += 1;
      return 'timeout_after';
    }
    return undefined;
  });
  assert.equal((await ensure(lost)).status, 502);
  assert.equal((await ensure(lost)).status, 502);
  const done = await ensure(lost);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.new_request, true);
  assert.equal([...lost.graph.campaigns.values()].filter((row) => row.name === names.campaign).length, 1);
  assert.equal([...lost.graph.adsets.values()].filter((row) => row.name === names.adset).length, 1);
  assert.equal(lost.graph.posts().filter((call) => /\/(campaigns|adsets)$/.test(call.path)).length, 2);
  assert.ok(events(lost, done.body.route_key).includes('campaign_reused_by_name'));
  assert.ok(events(lost, done.body.route_key).includes('adset_reused_by_name'));
  assert.equal(lost.d1.rows('SELECT id FROM meta_ads_objective_routes').length, 1);
});

test('campanha existente com o mesmo nome que não está pausada nunca é tocada', async () => {
  const ctx = await withPolicies(setup());
  const names = objectiveRouteNames('NH', 'TRAFFIC_SITE_AGENDAMENTO');
  ctx.graph.addCampaign({ id: '790000001', name: names.campaign, status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC' });
  const result = await ensure(ctx);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'objective_route_creation_incomplete');
  assert.equal(result.body.detail.cause_code, 'objective_route_existing_campaign_not_paused');
  assert.equal(ctx.graph.posts().length, 0);
  assert.equal(ctx.graph.campaigns.get('790000001').status, 'ACTIVE');

  // Duas campanhas com o nome da rota: ambíguo, recusa.
  const twice = await withPolicies(setup());
  twice.graph.addCampaign({ id: '790000002', name: names.campaign, status: 'PAUSED', objective: 'OUTCOME_TRAFFIC' });
  twice.graph.addCampaign({ id: '790000003', name: names.campaign, status: 'PAUSED', objective: 'OUTCOME_TRAFFIC' });
  assert.equal((await ensure(twice)).body.detail.cause_code, 'objective_route_duplicate_campaign');
  assert.equal(twice.graph.posts().length, 0);
});

test('código de aprovação: aleatório (crypto) e único entre as pendências abertas (aceite 7)', async () => {
  const ctx = await withPolicies(setup());
  const first = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  const second = await ensureOk(ctx, 'BSS', 'TRAFFIC_SITE_AGENDAMENTO', 30);
  for (const code of [first.approval_code, second.approval_code]) {
    assert.match(code, internals.approvalCodePattern);
    assert.doesNotMatch(code, /[ILO01]/);
    // A sugestão determinística do workflow nunca é usada.
    assert.notEqual(code, 'ZZZZ');
  }
  assert.notEqual(first.approval_code, second.approval_code);

  // Forçando a mesma sequência aleatória, o segundo pedido sorteia de novo.
  const forced = await withPolicies(setup());
  const draws = [];
  let draw = 0;
  forced.env.META_ADS_OBJECTIVE_ROUTES_RANDOM = (length) => {
    draw += 1;
    // Sorteios 1 e 2 dão o mesmo código; o 3 dá outro. 250 é descartado.
    const value = draw <= 2 ? 5 : 9;
    draws.push(value);
    return new Uint8Array(length).fill(value).map((byte, index) => (index === 0 ? 250 : byte));
  };
  const one = await ensureOk(forced, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  const two = await ensureOk(forced, 'BSS', 'TRAFFIC_SITE_AGENDAMENTO', 30);
  assert.equal(one.approval_code, internals.approvalCodeAlphabet[5].repeat(4));
  assert.equal(two.approval_code, internals.approvalCodeAlphabet[9].repeat(4));
  assert.deepEqual(draws, [5, 5, 9]);
  // O banco também impede dois códigos iguais em pendências abertas.
  assert.throws(() => forced.d1.db.prepare(
    `UPDATE meta_ads_objective_routes SET approval_code = ? WHERE route_key = ?`,
  ).run(one.approval_code, two.route_key), /UNIQUE/);
});

// --------------------------------------------------------------- pendências

test('lista de pendências: estado da rota, vagas e verba da unidade, com conta compartilhada (aceite 2)', async () => {
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  const graph = ctx.graph;
  // CBO ativo só com conjunto de NH: o orçamento da campanha conta uma vez.
  graph.addCampaign({ id: '720000001', name: 'CBO de teste', status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: '4000' });
  graph.addAdset({ id: '721000001', name: 'CBO a', campaign_id: '720000001', status: 'ACTIVE' });
  graph.addAdset({ id: '721000002', name: 'CBO b', campaign_id: '720000001', status: 'ACTIVE' });
  // Vitalício: R$ 300 de saldo até 30/11 (5 dias contando hoje) = R$ 60/dia.
  graph.addCampaign({ id: '730000001', name: 'Vitalício de teste', status: 'ACTIVE', objective: 'OUTCOME_LEADS' });
  graph.addAdset({ id: '731000001', name: 'Vitalício', campaign_id: '730000001', status: 'ACTIVE', lifetime_budget: '90000', budget_remaining: '30000', end_time: '2026-11-30T20:00:00-0300' });
  // Conjunto pausado e conjunto ativo em campanha pausada não gastam.
  graph.addAdset({ id: '711000009', name: 'Pausado', campaign_id: WPP_CAMPAIGN_ID, status: 'PAUSED', daily_budget: '99900' });
  graph.addCampaign({ id: '740000001', name: 'Campanha pausada', status: 'PAUSED', objective: 'OUTCOME_LEADS' });
  graph.addAdset({ id: '741000001', name: 'Em campanha pausada', campaign_id: '740000001', status: 'ACTIVE', daily_budget: '99900' });
  // Conjunto desconhecido (fora da config, da política e das rotas): conta
  // para as duas unidades, e o gasto dele também.
  graph.addCampaign({ id: '750000001', name: 'Manual', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC' });
  graph.addAdset({ id: '751000001', name: 'Manual', campaign_id: '750000001', status: 'ACTIVE', daily_budget: '1000' });
  graph.spend.set('751000001', 50);
  graph.spend.set('721000001', 120.5);
  // Os conjuntos do CBO e o vitalício são de NH pela política.
  await ctx.call('/policy', policyBody('NH', { adset_ids: ['721000001', '721000002', '731000001'] }), { role: 'admin', method: 'PUT' });

  const listed = await ctx.call('/pending', { action: 'list_pending_objective_routes' });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.pending.length, 1);
  const [pending] = listed.body.pending;
  assert.equal(pending.route_key, 'objroute_v1:NH:TRAFFIC_SITE_AGENDAMENTO');
  assert.equal(pending.unit, 'NH');
  assert.equal(pending.objective, 'TRAFFIC_SITE_AGENDAMENTO');
  assert.equal(pending.approval_code, route.approval_code);
  assert.equal(pending.status, 'PENDING_APPROVAL');
  assert.equal(pending.created_at, route.created_at);
  assert.equal(pending.expires_at, route.expires_at);
  assert.equal(pending.last_decision_at, null);
  assert.equal(pending.notified_at, null);
  assert.equal(pending.daily_budget_brl, 23);
  assert.equal(pending.campaign_status, 'PAUSED');
  assert.equal(pending.adset_status, 'PAUSED');
  assert.deepEqual(pending.ad_ids, []);
  assert.deepEqual(pending.capacity, { used: 0, limit: 50 });
  assert.deepEqual(pending.budget_state, {
    ceiling_monthly_brl: 6000,
    // WhatsApp NH 2100 + CBO 120,50 + manual 50; o WhatsApp da BSS fica fora.
    spend_mtd_brl: 2270.5,
    // WhatsApp NH 81 + CBO 40 + vitalício 60 + manual 10. A rota pendente,
    // ainda pausada, não entra.
    committed_daily_brl: 191,
    // O vitalício termina em 30/11: não entra na conta de dezembro.
    committed_next_daily_brl: 131,
    days_remaining: 5,
    as_of: new Date(NOW).toISOString(),
    next_ceiling_monthly_brl: 6000,
    days_next_month: 31,
    month_profile: 'base',
    invalid: [],
  });

  // A lista usa a leitura guardada por alguns minutos; depois lê de novo.
  const calls = graph.calls.length;
  await ctx.call('/pending', { action: 'list_pending_objective_routes' });
  assert.equal(graph.calls.length, calls);
  ctx.clock.now += 16 * 60_000;
  await ctx.call('/pending', { action: 'list_pending_objective_routes' });
  assert.ok(graph.calls.length > calls);
  assert.ok(graph.calls.every((call) => call.method === 'GET' || call.body.status === 'PAUSED'));

  // Perfil forte no mês seguinte muda só o teto da virada.
  await ctx.call('/policy', policyBody('NH', { month_profiles: { '2026-12': 'forte' } }), { role: 'admin', method: 'PUT' });
  const forte = (await ctx.call('/pending', { action: 'list_pending_objective_routes' })).body.pending[0].budget_state;
  assert.equal(forte.ceiling_monthly_brl, 6000);
  assert.equal(forte.next_ceiling_monthly_brl, 11000);
});

test('lista de pendências falha fechada: sem a leitura da conta não devolve pendência com verba incompleta', async () => {
  const ctx = await withPolicies(setup());
  await ensureOk(ctx);
  ctx.graph.intercept((call) => (call.path.endsWith('/insights') ? graphError('Service temporarily unavailable', 2, 500) : undefined));
  const failed = await ctx.call('/pending', { action: 'list_pending_objective_routes' });
  assert.equal(failed.body.ok, false);
  assert.ok(failed.status >= 500);
  assert.equal('pending' in failed.body, false);

  // Entrada determinística inválida (moeda da conta): os números não saem.
  const other = await withPolicies(setup());
  await ensureOk(other);
  other.graph.currency = 'USD';
  const state = (await other.call('/pending', { action: 'list_pending_objective_routes' })).body.pending[0].budget_state;
  assert.equal(state.spend_mtd_brl, null);
  assert.equal(state.committed_daily_brl, null);
  assert.deepEqual(state.invalid, ['account_currency_not_brl']);
});

// ------------------------------------------------------------------ decisão

test('ativação aprovada: recalcula o teto e ativa campanha → conjunto → anúncios pausados', async () => {
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  ctx.graph.addAd({ id: '910000001', name: 'Anúncio pausado', adset_id: route.adset_id, status: 'PAUSED' });
  ctx.graph.addAd({ id: '910000002', name: 'Anúncio arquivado', adset_id: route.adset_id, status: 'ARCHIVED' });
  const postsBefore = ctx.graph.posts().length;
  const result = await decision(ctx, route, 'APPROVE');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.outcome, 'ACTIVATED');
  assert.equal(result.body.new_decision, true);
  assert.deepEqual(result.body.reasons, []);
  assert.equal(result.body.route_key, route.route_key);
  assert.equal(result.body.approval_code, route.approval_code);
  // 2100 + (81 + 23) × 5 = 2620, contra 6000 × 0,9.
  assert.equal(result.body.budget.projected_brl, 2620);
  assert.equal(result.body.budget.ceiling_monthly_brl, 6000);
  assert.equal(result.body.budget.limit_brl, 5400);
  assert.deepEqual(ctx.graph.posts().slice(postsBefore).map((call) => [call.path, call.body]), [
    [route.campaign_id, { status: 'ACTIVE' }],
    [route.adset_id, { status: 'ACTIVE' }],
    ['910000001', { status: 'ACTIVE' }],
  ]);
  assert.equal(ctx.graph.campaigns.get(route.campaign_id).status, 'ACTIVE');
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'ACTIVE');
  assert.equal(ctx.graph.ads.get('910000002').status, 'ARCHIVED');
  assert.deepEqual(events(ctx, route.route_key).slice(-8), [
    'activation_approved', 'activate_requested', 'activate_done', 'activate_requested', 'activate_done',
    'activate_requested', 'activate_done', 'route_activated',
  ]);

  // Repetir a rodada (mesmo pedido ou outro) não ativa nem responde de novo.
  const before = ctx.graph.calls.length;
  const again = await decision(ctx, route, 'APPROVE');
  assert.equal(again.body.outcome, 'ALREADY_DECIDED');
  assert.equal(again.body.new_decision, false);
  assert.equal(again.body.decided_outcome, 'ACTIVATED');
  assert.equal((await decision(ctx, route, 'REJECT')).body.outcome, 'ALREADY_DECIDED');
  assert.equal(ctx.graph.calls.length, before);
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'ACTIVE');
  // Rota ativada: um novo pedido da mesma route_key não cria nada.
  const ensureAgain = await ensure(ctx);
  assert.equal(ensureAgain.body.status, 'ACTIVATED');
  assert.equal(ensureAgain.body.new_request, false);
  assert.equal(ctx.graph.calls.length, before);
});

test('nunca confia em decision nem em local_checks: o Vault refaz a conta (aceite 1)', async () => {
  // Teto do mês estourado, com o chamador dizendo que está tudo certo.
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  ctx.graph.spend.set(WPP_ADSET.NH, 5000);
  const forged = await decision(ctx, route, 'APPROVE', {
    local_checks: { ok: true, checks: [], budget: { ok: true, reason: 'within_ceiling', projected_brl: 1 } },
  });
  assert.equal(forged.status, 200);
  assert.equal(forged.body.outcome, 'BLOCKED');
  assert.equal(forged.body.new_decision, true);
  assert.deepEqual(forged.body.reasons, ['ceiling_exceeded']);
  assert.equal(forged.body.budget.projected_brl, 5520);
  assert.equal(activePosts(ctx).length, 0);
  assert.equal(ctx.graph.campaigns.get(route.campaign_id).status, 'PAUSED');
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'PAUSED');

  // Virada do mês: cabe em novembro, não cabe em dezembro inteiro.
  const next = await withPolicies(setup());
  const nextRoute = await ensureOk(next);
  next.graph.adsets.get(WPP_ADSET.NH).daily_budget = '16000';
  assert.deepEqual((await decision(next, nextRoute, 'APPROVE')).body.reasons, ['next_month_ceiling_exceeded']);
  assert.equal(activePosts(next).length, 0);

  // Estado relido na Meta: campanha já ativada por fora.
  const touched = await withPolicies(setup());
  const touchedRoute = await ensureOk(touched);
  touched.graph.campaigns.get(touchedRoute.campaign_id).status = 'ACTIVE';
  assert.deepEqual((await decision(touched, touchedRoute, 'APPROVE')).body.reasons, ['route_not_paused']);
  assert.equal(touched.graph.adsets.get(touchedRoute.adset_id).status, 'PAUSED');
  assert.equal(activePosts(touched).length, 0);

  // Orçamento do conjunto aumentado por fora depois do pedido.
  const raised = await withPolicies(setup());
  const raisedRoute = await ensureOk(raised);
  raised.graph.adsets.get(raisedRoute.adset_id).daily_budget = '50000';
  assert.deepEqual((await decision(raised, raisedRoute, 'APPROVE')).body.reasons, ['adset_budget_changed']);
  assert.equal(activePosts(raised).length, 0);

  // Vagas: mais de 50 anúncios no conjunto.
  const full = await withPolicies(setup());
  const fullRoute = await ensureOk(full);
  for (let index = 0; index < 51; index += 1) {
    full.graph.addAd({ id: String(920000000 + index), name: `Anúncio ${index}`, adset_id: fullRoute.adset_id, status: 'PAUSED' });
  }
  assert.deepEqual((await decision(full, fullRoute, 'APPROVE')).body.reasons, ['adset_ad_limit']);
  assert.equal(activePosts(full).length, 0);

  // Código errado ou rota inexistente: nada acontece.
  const missing = await decision(ctx, { route_key: route.route_key, approval_code: 'ABCD' }, 'APPROVE');
  assert.equal(missing.status, 404);
  for (const bad of [{ decision: 'ACTIVATE' }, { reply_message_id: '' }, { reply_ts: 'x' }, { approval_code: 'ab' }]) {
    assert.equal((await decision(ctx, route, 'APPROVE', bad)).status, 400);
  }
});

test('verba comprometida inclui ABO, CBO, vitalício rateado e rotas já aprovadas (aceite 2)', async () => {
  const ctx = await withPolicies(setup(), { NH: { adset_ids: ['721000001', '731000001'], month_profiles: { '2026-12': 'forte' } } });
  const traffic = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  const awareness = await ensureOk(ctx, 'NH', 'AWARENESS', 12);
  assert.equal((await decision(ctx, traffic, 'APPROVE')).body.outcome, 'ACTIVATED');
  ctx.graph.addCampaign({ id: '720000001', name: 'CBO de teste', status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: '4000' });
  ctx.graph.addAdset({ id: '721000001', name: 'CBO a', campaign_id: '720000001', status: 'ACTIVE' });
  ctx.graph.addCampaign({ id: '730000001', name: 'Vitalício de teste', status: 'ACTIVE', objective: 'OUTCOME_LEADS' });
  ctx.graph.addAdset({ id: '731000001', name: 'Vitalício', campaign_id: '730000001', status: 'ACTIVE', lifetime_budget: '90000', budget_remaining: '30000', end_time: '2026-11-30T20:00:00-0300' });
  // A listagem da Meta ainda mostra a rota recém-ativada como pausada: o
  // diário dela entra pelo registro do Vault.
  ctx.graph.adsets.get(traffic.adset_id).status = 'PAUSED';
  const result = await decision(ctx, awareness, 'APPROVE');
  assert.equal(result.body.outcome, 'ACTIVATED', JSON.stringify(result.body));
  // WhatsApp 81 + CBO 40 + vitalício 60 + rota de tráfego aprovada 23 = 204.
  assert.equal(result.body.budget.committed_daily_brl, 204);
  assert.equal(result.body.budget.projected_brl, 2100 + (204 + 12) * 5);
  // Dezembro (perfil forte): sem o vitalício que termina em novembro.
  assert.equal(result.body.budget.committed_next_daily_brl, 144);
  assert.equal(result.body.budget.next_month_projected_brl, (144 + 12) * 31);
  assert.equal(result.body.budget.next_month_limit_brl, 9900);

  // Conjunto ativo sem orçamento legível em nenhum nível: não ativa.
  const unknown = await withPolicies(setup());
  const route = await ensureOk(unknown);
  unknown.graph.addCampaign({ id: '760000001', name: 'Sem orçamento', status: 'ACTIVE', objective: 'OUTCOME_LEADS' });
  unknown.graph.addAdset({ id: '761000001', name: 'Sem orçamento', campaign_id: '760000001', status: 'ACTIVE' });
  const blocked = await decision(unknown, route, 'APPROVE');
  assert.deepEqual(blocked.body.reasons, ['budget_inputs_invalid']);
  assert.equal(activePosts(unknown).length, 0);
});

test('decisões da mesma unidade em série, com trava: a segunda vê o diário da primeira (aceite 4)', async () => {
  const ctx = await withPolicies(setup());
  // Verba justa: a primeira rota cabe (4660 + (81+23)×5 = 5180 ≤ 5400), mas
  // as duas juntas não (4660 + (81+23+60)×5 = 5480 > 5400).
  ctx.graph.spend.set(WPP_ADSET.NH, 4660);
  const first = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  const second = await ensureOk(ctx, 'NH', 'AWARENESS', 60);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  let entered;
  const inside = new Promise((resolve) => { entered = resolve; });
  ctx.graph.intercept(async (call) => {
    if (!held && call.path.endsWith('/insights')) {
      held = true;
      entered();
      await gate;
    }
    return undefined;
  });
  const running = decision(ctx, first, 'APPROVE');
  await inside;
  // A primeira decisão está no meio da conta: a segunda não entra.
  const busy = await decision(ctx, second, 'APPROVE');
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error, 'objective_route_unit_busy');
  assert.ok(busy.body.detail.retry_after_seconds > 0);
  // A criação de outra rota da mesma unidade também espera.
  assert.equal((await ensure(ctx, 'NH', 'ENGAGEMENT_VIDEO', 15)).body.error, 'objective_route_unit_busy');
  // Outra unidade não é afetada pela trava de NH.
  assert.equal((await ensure(ctx, 'BSS', 'TRAFFIC_SITE_AGENDAMENTO', 30)).status, 200);
  release();
  assert.equal((await running).body.outcome, 'ACTIVATED');
  assert.equal(ctx.d1.rows(`SELECT resource_key FROM meta_ads_publish_locks WHERE resource_key LIKE 'objective-route-unit:%'`).length, 0);

  // Na rodada seguinte a segunda vê o diário da primeira e não cabe mais.
  const retry = await decision(ctx, second, 'APPROVE');
  assert.equal(retry.body.outcome, 'BLOCKED');
  assert.deepEqual(retry.body.reasons, ['ceiling_exceeded']);
  assert.equal(retry.body.budget.committed_daily_brl, 104);
  assert.equal(retry.body.budget.projected_brl, 5480);
  assert.equal(ctx.graph.adsets.get(second.adset_id).status, 'PAUSED');

  // Trava presa por um Worker que morreu vence sozinha.
  const stuck = await withPolicies(setup());
  const route = await ensureOk(stuck);
  stuck.d1.db.prepare(
    `INSERT INTO meta_ads_publish_locks (resource_key, run_id, operation_key, heartbeat_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
  ).run('objective-route-unit:NH', internals.unitLockOwner, 'decide:morto', new Date(NOW).toISOString(), new Date(NOW + 5 * 60_000).toISOString());
  assert.equal((await decision(stuck, route, 'APPROVE')).body.error, 'objective_route_unit_busy');
  stuck.clock.now += 5 * 60_000 + 1;
  assert.equal((await decision(stuck, route, 'APPROVE')).body.outcome, 'ACTIVATED');
});

test('BLOCK, REJECT e vencimento são finais; novo pedido só depois de 7 dias e com código novo (aceite 5)', async () => {
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  const rejected = await decision(ctx, route, 'REJECT');
  assert.equal(rejected.body.outcome, 'REJECTED');
  assert.equal(rejected.body.new_decision, true);
  // Recusada: aprovar depois com o mesmo código não ativa.
  const late = await decision(ctx, route, 'APPROVE');
  assert.equal(late.body.outcome, 'ALREADY_DECIDED');
  assert.equal(late.body.decided_outcome, 'REJECTED');
  assert.equal(activePosts(ctx).length, 0);

  const cooling = await ensure(ctx);
  assert.equal(cooling.status, 409);
  assert.equal(cooling.body.error, 'objective_route_cooldown');
  assert.equal(cooling.body.detail.last_status, 'REJECTED');
  assert.equal(cooling.body.detail.retry_after_seconds, 7 * 24 * 3600);
  ctx.clock.now += 7 * DAY - 1000;
  assert.equal((await ensure(ctx)).body.error, 'objective_route_cooldown');
  ctx.clock.now += 1000;
  const postsBefore = ctx.graph.posts().length;
  const renewed = await ensure(ctx);
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.equal(renewed.body.new_request, true);
  assert.notEqual(renewed.body.approval_code, route.approval_code);
  // Reaproveita a campanha e o conjunto pausados: nada novo na Meta.
  assert.equal(renewed.body.campaign_id, route.campaign_id);
  assert.equal(renewed.body.adset_id, route.adset_id);
  assert.equal(ctx.graph.posts().length, postsBefore);
  // O código antigo continua decidido; só o novo ativa.
  assert.equal((await decision(ctx, route, 'APPROVE')).body.outcome, 'ALREADY_DECIDED');
  assert.equal(activePosts(ctx).length, 0);
  const pending = (await ctx.call('/pending', { action: 'list_pending_objective_routes' })).body.pending[0];
  assert.equal(pending.approval_code, renewed.body.approval_code);
  assert.equal(pending.last_decision_at, new Date(NOW).toISOString());

  // BLOCK pedido pelo workflow é final e guarda só motivos no formato esperado.
  const blocked = await withPolicies(setup());
  const blockedRoute = await ensureOk(blocked);
  const block = await decision(blocked, blockedRoute, 'BLOCK', { local_checks: { ok: false, checks: ['ceiling_exceeded', 'Texto livre <b>'] } });
  assert.equal(block.body.outcome, 'BLOCKED');
  assert.deepEqual(block.body.reasons, ['ceiling_exceeded']);
  assert.equal((await decision(blocked, blockedRoute, 'APPROVE')).body.outcome, 'ALREADY_DECIDED');
  assert.equal((await ensure(blocked)).body.error, 'objective_route_cooldown');
  assert.equal(activePosts(blocked).length, 0);

  // Vencimento: resposta dada depois da validade bloqueia de forma final.
  const expired = await withPolicies(setup());
  const expiredRoute = await ensureOk(expired);
  expired.clock.now += 24 * HOUR + 60_000;
  const lateReply = await decision(expired, expiredRoute, 'APPROVE');
  assert.equal(lateReply.body.outcome, 'BLOCKED');
  assert.deepEqual(lateReply.body.reasons, ['approval_expired']);
  assert.equal(activePosts(expired).length, 0);
  assert.equal(expired.d1.rows('SELECT status FROM meta_ads_objective_routes')[0].status, 'EXPIRED');
  assert.equal((await ensure(expired)).body.error, 'objective_route_cooldown');

  // Resposta dada dentro da validade, lida pela rodada seguinte: ainda vale.
  const grace = await withPolicies(setup());
  const graceRoute = await ensureOk(grace);
  const replyTs = Math.floor((NOW + 24 * HOUR - 60_000) / 1000);
  grace.clock.now += 24 * HOUR + 9 * 60_000;
  assert.equal((await decision(grace, graceRoute, 'APPROVE', { reply_ts: replyTs })).body.outcome, 'ACTIVATED');

  // Sem resposta nenhuma: a varredura vence a pendência e ela sai da lista.
  const silent = await withPolicies(setup());
  const silentRoute = await ensureOk(silent);
  silent.clock.now += 24 * HOUR + 31 * 60_000;
  const listed = await silent.call('/pending', { action: 'list_pending_objective_routes' });
  assert.deepEqual(listed.body.pending, []);
  assert.equal(listed.body.unnotified_decisions[0].status, 'EXPIRED');
  assert.equal((await decision(silent, silentRoute, 'APPROVE', { reply_ts: Math.floor(NOW / 1000) + 60 })).body.outcome, 'ALREADY_DECIDED');
  assert.equal(activePosts(silent).length, 0);

  // Resposta anterior ao pedido ou no futuro não decide nem queima a pendência.
  const early = await withPolicies(setup());
  const earlyRoute = await ensureOk(early);
  assert.equal((await decision(early, earlyRoute, 'APPROVE', { reply_ts: Math.floor(NOW / 1000) - 60 })).body.error, 'objective_route_reply_outside_validity');
  assert.equal((await decision(early, earlyRoute, 'REJECT', { reply_ts: Math.floor(NOW / 1000) + 3600 })).body.error, 'objective_route_reply_outside_validity');
  assert.equal(early.d1.rows('SELECT status FROM meta_ads_objective_routes')[0].status, 'PENDING_APPROVAL');
});

test('a mesma resposta do operador nunca decide duas rotas', async () => {
  const ctx = await withPolicies(setup());
  const first = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  const second = await ensureOk(ctx, 'BSS', 'TRAFFIC_SITE_AGENDAMENTO', 30);
  assert.equal((await decision(ctx, first, 'APPROVE', { reply_message_id: 'mesma-resposta' })).body.outcome, 'ACTIVATED');
  const reused = await decision(ctx, second, 'APPROVE', { reply_message_id: 'mesma-resposta' });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.error, 'objective_route_reply_already_used');
  assert.equal(ctx.graph.adsets.get(second.adset_id).status, 'PAUSED');
  const stored = ctx.d1.rows('SELECT reply_message_id, reply_ts FROM meta_ads_objective_routes WHERE route_key = ?', first.route_key)[0];
  assert.equal(stored.reply_message_id, 'mesma-resposta');
  assert.equal(stored.reply_ts, Math.floor(NOW / 1000));
});

test('falha fechada na decisão: leitura que falha não vira decisão e nada é ativado', async () => {
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  let failing = true;
  ctx.graph.intercept((call) => (failing && call.path.endsWith('/insights') ? graphError('Service temporarily unavailable', 2, 500) : undefined));
  const result = await decision(ctx, route, 'APPROVE');
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'objective_route_budget_inputs_unavailable');
  assert.equal(activePosts(ctx).length, 0);
  assert.equal(ctx.d1.rows('SELECT status FROM meta_ads_objective_routes')[0].status, 'PENDING_APPROVAL');
  // A pendência não foi queimada: a rodada seguinte decide.
  failing = false;
  assert.equal((await decision(ctx, route, 'APPROVE')).body.outcome, 'ACTIVATED');

  // Moeda da conta diferente de BRL: a conta em centavos não vale; bloqueia.
  const currency = await withPolicies(setup());
  const currencyRoute = await ensureOk(currency);
  currency.graph.currency = 'USD';
  assert.deepEqual((await decision(currency, currencyRoute, 'APPROVE')).body.reasons, ['budget_inputs_invalid']);
  assert.equal(activePosts(currency).length, 0);

  // Política desabilitada depois do pedido: recusa sem tocar na Meta.
  const disabled = await withPolicies(setup());
  const disabledRoute = await ensureOk(disabled);
  await disabled.call('/policy', policyBody('NH', { enabled: false }), { role: 'admin', method: 'PUT' });
  assert.equal((await decision(disabled, disabledRoute, 'APPROVE')).status, 503);
  assert.equal(activePosts(disabled).length, 0);
});

test('ativação interrompida: a rodada seguinte confere o teto de novo e termina ou pausa tudo', async () => {
  // Timeout ao ativar o conjunto: a campanha já está ativa, o conjunto não.
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  let failed = false;
  ctx.graph.intercept((call) => {
    if (!failed && call.method === 'POST' && call.path === route.adset_id) {
      failed = true;
      return 'timeout';
    }
    return undefined;
  });
  const interrupted = await decision(ctx, route, 'APPROVE', { reply_message_id: 'resposta-a' });
  assert.equal(interrupted.status, 502);
  assert.equal(interrupted.body.error, 'objective_route_activation_incomplete');
  assert.equal(ctx.d1.rows('SELECT status FROM meta_ads_objective_routes')[0].status, 'ACTIVATING');
  assert.equal(ctx.graph.campaigns.get(route.campaign_id).status, 'ACTIVE');
  // Em ACTIVATING a rota já conta no diário comprometido da unidade.
  const resumed = await decision(ctx, route, 'APPROVE', { reply_message_id: 'resposta-a' });
  assert.equal(resumed.body.outcome, 'ACTIVATED', JSON.stringify(resumed.body));
  assert.equal(resumed.body.new_decision, true);
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'ACTIVE');
  assert.ok(events(ctx, route.route_key).includes('activation_resumed'));

  // Mesma interrupção, mas o gasto subiu antes da retomada: pausa e bloqueia.
  const over = await withPolicies(setup());
  const overRoute = await ensureOk(over);
  let overFailed = false;
  over.graph.intercept((call) => {
    if (!overFailed && call.method === 'POST' && call.path === overRoute.adset_id) {
      overFailed = true;
      return 'timeout';
    }
    return undefined;
  });
  assert.equal((await decision(over, overRoute, 'APPROVE')).status, 502);
  over.graph.spend.set(WPP_ADSET.NH, 5000);
  const stopped = await decision(over, overRoute, 'APPROVE');
  assert.equal(stopped.body.outcome, 'BLOCKED');
  assert.deepEqual(stopped.body.reasons, ['ceiling_exceeded']);
  assert.equal(over.graph.campaigns.get(overRoute.campaign_id).status, 'PAUSED');
  assert.equal(over.graph.adsets.get(overRoute.adset_id).status, 'PAUSED');

  // Recusa definitiva da Meta ao ativar o conjunto: desfaz e bloqueia.
  const refused = await withPolicies(setup());
  const refusedRoute = await ensureOk(refused);
  refused.graph.intercept((call) => (call.method === 'POST' && call.path === refusedRoute.adset_id && call.body.status === 'ACTIVE'
    ? graphError('Invalid parameter', 100, 400) : undefined));
  const failedActivation = await decision(refused, refusedRoute, 'APPROVE');
  assert.equal(failedActivation.body.outcome, 'BLOCKED');
  assert.deepEqual(failedActivation.body.reasons, ['activation_failed']);
  assert.equal(refused.graph.campaigns.get(refusedRoute.campaign_id).status, 'PAUSED');
  assert.equal(refused.graph.adsets.get(refusedRoute.adset_id).status, 'PAUSED');
});

test('notified_at: pedidos e decisões sem aviso voltam na lista até a confirmação (aceite 9)', async () => {
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  const list = async () => (await ctx.call('/pending', { action: 'list_pending_objective_routes' })).body;
  const ack = (kind, overrides = {}) => ctx.call('/pending', {
    action: 'ack_objective_route_notification', route_key: route.route_key, approval_code: route.approval_code, kind, ...overrides,
  });
  // O aviso do pedido se perdeu (new_request=true não chegou ao operador).
  assert.equal((await list()).pending[0].notified_at, null);
  assert.equal((await ack('decision')).body.error, 'objective_route_not_decided');
  ctx.clock.now += 60_000;
  const acked = await ack('request');
  assert.equal(acked.body.acknowledged, true);
  assert.equal((await list()).pending[0].notified_at, new Date(NOW + 60_000).toISOString());
  // Confirmar de novo não muda a data.
  const repeated = await ack('request');
  assert.equal(repeated.body.acknowledged, false);
  assert.equal(repeated.body.notified_at, acked.body.notified_at);

  // A ativação aconteceu, mas a resposta ao workflow estourou o tempo: a
  // repetição volta ALREADY_DECIDED e a decisão segue na lista de não avisadas.
  assert.equal((await decision(ctx, route, 'APPROVE')).body.outcome, 'ACTIVATED');
  const repeat = await decision(ctx, route, 'APPROVE');
  assert.equal(repeat.body.outcome, 'ALREADY_DECIDED');
  assert.equal(repeat.body.notified_at, null);
  const afterDecision = await list();
  assert.deepEqual(afterDecision.pending, []);
  assert.equal(afterDecision.unnotified_decisions.length, 1);
  const [unnotified] = afterDecision.unnotified_decisions;
  assert.equal(unnotified.route_key, route.route_key);
  assert.equal(unnotified.approval_code, route.approval_code);
  assert.equal(unnotified.outcome, 'ACTIVATED');
  assert.equal(unnotified.budget.projected_brl, 2620);
  assert.equal(unnotified.notified_at, null);
  assert.equal((await ack('decision')).body.acknowledged, true);
  assert.deepEqual((await list()).unnotified_decisions, []);
  assert.equal((await ack('decision', { kind: 'outro' })).status, 400);
  assert.equal((await ack('decision', { approval_code: 'ABCD' })).status, 404);
  const stored = ctx.d1.rows('SELECT request_notified_at, decision_notified_at FROM meta_ads_objective_routes')[0];
  assert.ok(stored.request_notified_at && stored.decision_notified_at);
});

// ------------------------------------------------------------------ monitor

test('monitor contínuo: pausa as rotas objroute_v1 da unidade quando a projeção passa do teto (aceite 10)', async () => {
  const ctx = await withPolicies(setup());
  const nh = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  const bss = await ensureOk(ctx, 'BSS', 'TRAFFIC_SITE_AGENDAMENTO', 30);
  assert.equal((await decision(ctx, nh, 'APPROVE')).body.outcome, 'ACTIVATED');
  assert.equal((await decision(ctx, bss, 'APPROVE')).body.outcome, 'ACTIVATED');
  const monitor = () => ctx.call('/monitor', { action: 'monitor_objective_routes' });

  const calm = await monitor();
  assert.equal(calm.status, 200, JSON.stringify(calm.body));
  assert.deepEqual(calm.body.units.map((unit) => [unit.unit, unit.action]), [['BSS', 'none'], ['NH', 'none']]);
  assert.equal(calm.body.units[1].projected_brl, 2100 + 104 * 5);
  assert.equal(ctx.graph.posts().filter((call) => call.body.status === 'PAUSED' && Object.keys(call.body).length === 1).length, 0);

  // O gasto real de NH disparou depois da ativação (a Meta pode gastar acima
  // do diário): 4900 + 104 × 5 = 5420 > 5400.
  ctx.graph.spend.set(WPP_ADSET.NH, 4890);
  ctx.graph.spend.set(nh.adset_id, 10);
  const postsBefore = ctx.graph.posts().length;
  // O gatilho agendado do Worker roda o mesmo passo e nunca lança. Aqui o
  // token do teste não é cifrado de verdade, então ele só registra a falha.
  const waited = [];
  const scheduled = await handleScheduled({}, ctx.env, { waitUntil: (promise) => waited.push(promise) });
  assert.equal(scheduled.mode, 'on');
  assert.equal(waited.length, 1);
  assert.ok(scheduled.units.every((unit) => unit.action === 'skipped'));
  assert.equal(ctx.graph.posts().length, postsBefore);
  const paused = await monitor();
  const nhReport = paused.body.units.find((unit) => unit.unit === 'NH');
  assert.equal(nhReport.action, 'paused');
  assert.equal(nhReport.projected_brl, 5420);
  assert.equal(nhReport.limit_brl, 5400);
  assert.deepEqual(nhReport.paused_route_keys, [nh.route_key]);
  assert.equal(paused.body.units.find((unit) => unit.unit === 'BSS').action, 'none');
  // Conjunto primeiro, campanha depois; só a rota de NH; o WhatsApp não é tocado.
  assert.deepEqual(ctx.graph.posts().slice(postsBefore).map((call) => [call.path, call.body]), [
    [nh.adset_id, { status: 'PAUSED' }],
    [nh.campaign_id, { status: 'PAUSED' }],
  ]);
  assert.equal(ctx.graph.adsets.get(WPP_ADSET.NH).status, 'ACTIVE');
  assert.equal(ctx.graph.adsets.get(bss.adset_id).status, 'ACTIVE');
  const rows = ctx.d1.rows('SELECT route_key, status FROM meta_ads_objective_routes ORDER BY route_key');
  assert.deepEqual(rows.map((row) => row.status), ['ACTIVATED', 'PAUSED_BY_MONITOR']);

  // A pausa do monitor aparece para o operador e segue a regra do intervalo.
  const listed = (await ctx.call('/pending', { action: 'list_pending_objective_routes' })).body;
  const notice = listed.unnotified_decisions.find((entry) => entry.route_key === nh.route_key);
  assert.equal(notice.outcome, 'PAUSED_BY_MONITOR');
  assert.deepEqual(notice.reasons, ['monitor_ceiling_exceeded']);
  assert.equal((await ensure(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23)).body.error, 'objective_route_cooldown');
  // Rodar de novo não repete a pausa.
  const again = await monitor();
  assert.equal(again.body.units.find((unit) => unit.unit === 'NH'), undefined);
  assert.equal(ctx.graph.posts().length, postsBefore + 2);

  // Sem conseguir medir, o monitor registra e não age.
  ctx.graph.currency = 'USD';
  const blind = await monitor();
  assert.equal(blind.body.units.find((unit) => unit.unit === 'BSS').action, 'skipped');
  assert.equal(ctx.graph.adsets.get(bss.adset_id).status, 'ACTIVE');
  assert.ok(events(ctx, bss.route_key).includes('monitor_inputs_invalid'));
});

// -------------------------------------------------------- placement_checks

test('placement_checks do inventário trazem a origem da rota (aceite 11)', async () => {
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx, 'BSS', 'TRAFFIC_SITE_AGENDAMENTO', 30);
  const inventory = async (env = ctx.env) => {
    const response = await handleMetaAdsPublishRequest({
      request: new Request('https://vault.test/v1/meta-ads-publish/inventory', {
        method: 'POST',
        body: JSON.stringify({
          token_id: TOKEN.BSS, account_id: ACCOUNT_ID,
          adsets: [{ adset_id: WPP_ADSET.BSS, destination_group: GROUP.BSS }, { adset_id: route.adset_id, destination_group: GROUP.BSS }],
        }),
      }),
      env, requestId: 'req', pathname: '/v1/meta-ads-publish/inventory',
      decryptToken: async () => 'synthetic-access-token', writeAudit: async () => {},
    });
    return { status: response.status, body: await response.json() };
  };
  const pendingView = await inventory();
  assert.equal(pendingView.status, 200, JSON.stringify(pendingView.body));
  const byAdset = (view, adsetId) => view.body.placement_checks.find((check) => check.adset_id === adsetId);
  // Rota pausada à espera de aprovação: a origem aparece, mas não como ativada.
  assert.equal(byAdset(pendingView, route.adset_id).objective_route_key, 'objroute_v1:BSS:TRAFFIC_SITE_AGENDAMENTO');
  assert.equal(byAdset(pendingView, route.adset_id).objective_route_outcome, 'PENDING_APPROVAL');
  // Conjunto que não é rota por objetivo não ganha a marca.
  assert.equal('objective_route_key' in byAdset(pendingView, WPP_ADSET.BSS), false);

  assert.equal((await decision(ctx, route, 'APPROVE')).body.outcome, 'ACTIVATED');
  const activated = byAdset(await inventory(), route.adset_id);
  assert.equal(activated.objective_route_key, 'objroute_v1:BSS:TRAFFIC_SITE_AGENDAMENTO');
  assert.equal(activated.objective_route_outcome, 'ACTIVATED');
  assert.equal(activated.objective_route_campaign_id, route.campaign_id);
  assert.equal(activated.campaign_objective, 'OUTCOME_TRAFFIC');
  assert.equal(activated.optimization_goal, 'LANDING_PAGE_VIEWS');
  assert.equal(activated.destination_type, 'WEBSITE');

  // Rota ativada NÃO entra no inventário quando o chamador não a lista: a
  // resposta é a mesma de antes das rotas (ver o teste de contrato abaixo).
  const implicit = await handleMetaAdsPublishRequest({
    request: new Request('https://vault.test/v1/meta-ads-publish/inventory', {
      method: 'POST',
      body: JSON.stringify({ token_id: TOKEN.BSS, account_id: ACCOUNT_ID, adsets: [{ adset_id: WPP_ADSET.BSS, destination_group: GROUP.BSS }] }),
    }),
    env: ctx.env, requestId: 'req', pathname: '/v1/meta-ads-publish/inventory',
    decryptToken: async () => 'synthetic-access-token', writeAudit: async () => {},
  });
  assert.deepEqual((await implicit.json()).placement_checks.map((check) => check.adset_id), [WPP_ADSET.BSS]);

  // Com o interruptor desligado o inventário fica como antes.
  const off = await inventory({ ...ctx.env, META_ADS_OBJECTIVE_ROUTES_MODE: 'off' });
  assert.equal(off.status, 200);
  assert.equal(off.body.placement_checks.some((check) => 'objective_route_key' in check), false);
});

// ------------------------------------------------------------------ guardas

test('guarda: ACTIVE só sai pela ativação aprovada, em qualquer caminho', async () => {
  const ctx = await withPolicies(setup());
  const nh = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  const bss = await ensureOk(ctx, 'BSS', 'AWARENESS', 15);
  await ensure(ctx);
  await ctx.call('/pending', { action: 'list_pending_objective_routes' });
  await decision(ctx, bss, 'REJECT');
  await decision(ctx, nh, 'BLOCK');
  await ctx.call('/monitor', { action: 'monitor_objective_routes' });
  // Criação, lista, recusa, bloqueio e monitor: nenhum ACTIVE.
  assert.equal(activePosts(ctx).length, 0);
  for (const call of ctx.graph.posts()) {
    assert.ok(call.body.status === 'PAUSED' || Object.keys(call.body).join() === 'daily_budget', JSON.stringify(call));
  }
  // Toda mutação tem pedido e resultado no journal, na ordem.
  const journal = ctx.d1.rows('SELECT event FROM meta_ads_objective_route_events ORDER BY rowid').map((row) => row.event);
  assert.equal(journal.filter((event) => event === 'create_requested').length, journal.filter((event) => event === 'create_done').length);
  assert.equal(journal.filter((event) => event === 'create_requested').length, ctx.graph.posts().length);
  assert.ok(ctx.audits.some((entry) => entry.event === 'meta_ads_objective_routes.ensure_objective_route' && entry.status === 'ok'));
  assert.ok(ctx.audits.some((entry) => entry.event === 'meta_ads_objective_routes.decide_objective_route'));
});

test('novo pedido depois do intervalo com outro orçamento ajusta o conjunto ainda pausado', async () => {
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  await decision(ctx, route, 'REJECT');
  ctx.clock.now += 7 * DAY;
  // 03/12 em São Paulo: mês novo, gasto do mês ainda baixo.
  ctx.graph.spend.set(WPP_ADSET.NH, 100);
  const renewed = await ensure(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 25);
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.equal(renewed.body.adset_id, route.adset_id);
  assert.deepEqual(ctx.graph.posts().at(-1).body, { daily_budget: 2500 });
  assert.equal(ctx.graph.adsets.get(route.adset_id).daily_budget, '2500');
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'PAUSED');
  // A decisão usa o calendário do dia: 29 dias restantes em dezembro.
  const approved = await decision(ctx, renewed.body, 'APPROVE');
  assert.equal(approved.body.outcome, 'ACTIVATED', JSON.stringify(approved.body));
  assert.equal(approved.body.budget.days_remaining, 29);
});

// ------------------------------------------------- achados da revisão adversarial

const monitorStep = (ctx) => ctx.call('/monitor', { action: 'monitor_objective_routes' });
const listRoutes = async (ctx) => (await ctx.call('/pending', { action: 'list_pending_objective_routes' })).body;
const routeRow = (ctx, routeKey) => ctx.d1.rows(
  'SELECT * FROM meta_ads_objective_routes WHERE route_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', routeKey,
)[0];
const AD_ID = '900000001';

// Rota de NH aprovada cuja ativação parou no anúncio: campanha e conjunto já
// estão ACTIVE na Meta e o registro ficou em ACTIVATING.
async function stuckActivation({ adFailure = 'timeout' } = {}) {
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  ctx.graph.addAd({ id: AD_ID, adset_id: route.adset_id, status: 'PAUSED' });
  ctx.adFails = true;
  ctx.graph.intercept((call) => (ctx.adFails && call.method === 'POST' && call.path === AD_ID ? adFailure : undefined));
  const interrupted = await decision(ctx, route, 'APPROVE');
  assert.equal(interrupted.status, 502, JSON.stringify(interrupted.body));
  assert.equal(interrupted.body.error, 'objective_route_activation_incomplete');
  assert.equal(interrupted.body.detail.route_status, 'ACTIVATING');
  assert.equal(ctx.graph.campaigns.get(route.campaign_id).status, 'ACTIVE');
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'ACTIVE');
  return { ctx, route };
}

test('A1: ativação interrompida fica visível e o monitor a retoma sem depender do workflow', async () => {
  const { ctx, route } = await stuckActivation();
  // Não é pendência de aprovação, mas não some: aparece em `in_progress`.
  const listed = await listRoutes(ctx);
  assert.deepEqual(listed.pending, []);
  assert.deepEqual(listed.in_progress.map((entry) => [entry.route_key, entry.status]), [[route.route_key, 'ACTIVATING']]);
  assert.equal(listed.in_progress[0].approval_code, route.approval_code);

  // Antes do prazo de retomada o monitor ainda não mexe na ativação, mas a
  // rota já entra na conferência do teto (2100 + (81 + 23) × 5).
  const early = (await monitorStep(ctx)).body.units.find((unit) => unit.unit === 'NH');
  assert.equal(early.action, 'none');
  assert.equal(early.projected_brl, 2100 + 104 * 5);
  assert.deepEqual(early.recovered, []);
  assert.equal(routeRow(ctx, route.route_key).status, 'ACTIVATING');

  // Passado o prazo, com a Graph de volta: confere o teto de novo e termina.
  ctx.adFails = false;
  ctx.clock.now += internals.activationResumeAfterMs + 60_000;
  const resumed = (await monitorStep(ctx)).body.units.find((unit) => unit.unit === 'NH');
  assert.deepEqual(resumed.recovered, [{ route_key: route.route_key, status: 'ACTIVATED' }]);
  assert.deepEqual(resumed.unresolved_route_keys, []);
  assert.equal(routeRow(ctx, route.route_key).status, 'ACTIVATED');
  assert.equal(ctx.graph.ads.get(AD_ID).status, 'ACTIVE');
  assert.ok(events(ctx, route.route_key).includes('activation_resumed'));
  // A decisão que o workflow nunca recebeu aparece para ser avisada.
  const after = await listRoutes(ctx);
  assert.deepEqual(after.in_progress, []);
  assert.equal(after.unnotified_decisions.find((entry) => entry.route_key === route.route_key).outcome, 'ACTIVATED');
});

test('A1: ativação interrompida com o gasto acima do teto é pausada pelo monitor, mesmo antes do prazo de retomada', async () => {
  const { ctx, route } = await stuckActivation();
  ctx.graph.spend.set(route.adset_id, 50_000);
  const report = (await monitorStep(ctx)).body.units.find((unit) => unit.unit === 'NH');
  assert.equal(report.action, 'paused');
  assert.deepEqual(report.paused_route_keys, [route.route_key]);
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'PAUSED');
  assert.equal(ctx.graph.campaigns.get(route.campaign_id).status, 'PAUSED');
  assert.equal(routeRow(ctx, route.route_key).status, 'PAUSED_BY_MONITOR');
  // O conjunto do WhatsApp não é tocado.
  assert.equal(ctx.graph.adsets.get(WPP_ADSET.NH).status, 'ACTIVE');
});

test('A1: na retomada o teto é conferido de novo; ativação que nunca termina é pausada e bloqueada', async () => {
  // Gasto subiu antes da retomada: o monitor pausa em vez de terminar.
  const over = await stuckActivation();
  over.ctx.adFails = false;
  over.ctx.graph.spend.set(WPP_ADSET.NH, 5000);
  over.ctx.clock.now += internals.activationResumeAfterMs + 60_000;
  const stopped = (await monitorStep(over.ctx)).body.units.find((unit) => unit.unit === 'NH');
  assert.deepEqual(stopped.recovered, [{ route_key: over.route.route_key, status: 'BLOCKED' }]);
  assert.equal(over.ctx.graph.adsets.get(over.route.adset_id).status, 'PAUSED');
  assert.deepEqual(JSON.parse(routeRow(over.ctx, over.route.route_key).decision_json).reasons, ['ceiling_exceeded']);
  assert.equal(over.ctx.graph.ads.get(AD_ID).status, 'PAUSED');

  // O anúncio nunca ativa: o monitor tenta a cada rodada e desiste no prazo.
  const { ctx, route } = await stuckActivation();
  ctx.clock.now += internals.activationResumeAfterMs + 60_000;
  const retry = (await monitorStep(ctx)).body.units.find((unit) => unit.unit === 'NH');
  assert.deepEqual(retry.unresolved_route_keys, [route.route_key]);
  assert.equal(routeRow(ctx, route.route_key).status, 'ACTIVATING');
  assert.ok(events(ctx, route.route_key).includes('monitor_recovery_failed'));
  assert.equal((await listRoutes(ctx)).monitor.find((row) => row.unit === 'NH').consecutive_failures, 1);
  ctx.clock.now += internals.activationGiveUpMs;
  const gaveUp = (await monitorStep(ctx)).body.units.find((unit) => unit.unit === 'NH');
  assert.deepEqual(gaveUp.recovered, [{ route_key: route.route_key, status: 'BLOCKED' }]);
  const row = routeRow(ctx, route.route_key);
  assert.equal(row.status, 'BLOCKED');
  assert.deepEqual(JSON.parse(row.decision_json).reasons, ['activation_incomplete']);
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'PAUSED');
  assert.equal(ctx.graph.campaigns.get(route.campaign_id).status, 'PAUSED');
  const notice = (await listRoutes(ctx)).unnotified_decisions.find((entry) => entry.route_key === route.route_key);
  assert.equal(notice.outcome, 'BLOCKED');
});

test('A2: rota só é fechada com a pausa confirmada por leitura; sem confirmação fica PAUSE_PENDING e o monitor repete', async () => {
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  ctx.graph.addAd({ id: AD_ID, adset_id: route.adset_id, status: 'PAUSED' });
  ctx.pauseFails = true;
  ctx.graph.intercept((call) => {
    if (call.method !== 'POST') return undefined;
    if (call.path === AD_ID) return graphError('Ad disapproved', 100, 400);
    if (ctx.pauseFails && call.body && call.body.status === 'PAUSED' && Object.keys(call.body).length === 1) return 'timeout';
    return undefined;
  });
  const refused = await decision(ctx, route, 'APPROVE');
  assert.equal(refused.status, 200, JSON.stringify(refused.body));
  assert.equal(refused.body.outcome, 'BLOCKED');
  assert.deepEqual(refused.body.reasons, ['activation_failed', 'pause_after_failure_unconfirmed']);
  assert.equal(refused.body.route_status, 'PAUSE_PENDING');
  // O conjunto segue ACTIVE na Meta: a rota NÃO é final e continua viva.
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'ACTIVE');
  let row = routeRow(ctx, route.route_key);
  assert.equal(row.status, 'PAUSE_PENDING');
  assert.equal(row.decided_at, null);
  const listed = await listRoutes(ctx);
  assert.deepEqual(listed.in_progress.map((entry) => [entry.route_key, entry.status]), [[route.route_key, 'PAUSE_PENDING']]);
  assert.deepEqual(listed.unnotified_decisions, []);
  // Continua contando no comprometido da unidade para outra aprovação.
  const other = await ensureOk(ctx, 'NH', 'ENGAGEMENT_VIDEO', 23);
  const pendingOther = (await listRoutes(ctx)).pending.find((entry) => entry.route_key === other.route_key);
  assert.equal(pendingOther.budget_state.committed_daily_brl, 81 + 23);
  // Repetir a decisão ou o pedido não muda nada.
  const again = await decision(ctx, route, 'APPROVE');
  assert.equal(again.body.outcome, 'ALREADY_DECIDED');
  assert.equal(again.body.decided_outcome, 'BLOCKED');
  assert.equal((await ensure(ctx)).body.status, 'PAUSE_PENDING');

  // Monitor com a pausa ainda falhando: repete, não fecha e fica não saudável.
  const failing = (await monitorStep(ctx)).body.units.find((unit) => unit.unit === 'NH');
  assert.deepEqual(failing.unresolved_route_keys, [route.route_key]);
  assert.equal(routeRow(ctx, route.route_key).status, 'PAUSE_PENDING');
  const health = (await listRoutes(ctx)).monitor.find((entry) => entry.unit === 'NH');
  assert.equal(health.consecutive_failures, 1);
  assert.equal(health.last_ok_at, null);

  // Pausa volta a funcionar: o monitor confirma por leitura e só então fecha.
  ctx.pauseFails = false;
  const fixed = (await monitorStep(ctx)).body.units.find((unit) => unit.unit === 'NH');
  assert.deepEqual(fixed.recovered, [{ route_key: route.route_key, status: 'BLOCKED' }]);
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'PAUSED');
  assert.equal(ctx.graph.campaigns.get(route.campaign_id).status, 'PAUSED');
  row = routeRow(ctx, route.route_key);
  assert.equal(row.status, 'BLOCKED');
  assert.deepEqual(JSON.parse(row.decision_json).reasons, ['activation_failed']);
  assert.ok(row.decided_at);
  const done = await listRoutes(ctx);
  assert.deepEqual(done.in_progress, []);
  assert.equal(done.unnotified_decisions.find((entry) => entry.route_key === route.route_key).outcome, 'BLOCKED');
  assert.equal(done.monitor.find((entry) => entry.unit === 'NH').consecutive_failures, 0);
  assert.equal((await ensure(ctx)).body.error, 'objective_route_cooldown');
});

test('A2: pausa cujo POST dá timeout mas foi aplicada é confirmada pela leitura; pausa do monitor sem confirmação não fecha', async () => {
  // A resposta da pausa se perdeu, mas a Meta pausou: a leitura confirma.
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  ctx.graph.addAd({ id: AD_ID, adset_id: route.adset_id, status: 'PAUSED' });
  ctx.graph.intercept((call) => {
    if (call.method !== 'POST') return undefined;
    if (call.path === AD_ID) return graphError('Ad disapproved', 100, 400);
    return call.body && call.body.status === 'PAUSED' ? 'timeout_after' : undefined;
  });
  const refused = await decision(ctx, route, 'APPROVE');
  assert.equal(refused.body.outcome, 'BLOCKED');
  assert.deepEqual(refused.body.reasons, ['activation_failed']);
  assert.equal(routeRow(ctx, route.route_key).status, 'BLOCKED');
  assert.equal(ctx.graph.adsets.get(route.adset_id).status, 'PAUSED');

  // Monitor acima do teto e a pausa falha: a rota não vira PAUSED_BY_MONITOR
  // até a leitura confirmar.
  const mon = await withPolicies(setup());
  const active = await ensureOk(mon);
  assert.equal((await decision(mon, active, 'APPROVE')).body.outcome, 'ACTIVATED');
  mon.graph.spend.set(active.adset_id, 50_000);
  mon.pauseFails = true;
  mon.graph.intercept((call) => (mon.pauseFails && call.method === 'POST' && call.body.status === 'PAUSED' ? 'timeout' : undefined));
  const first = (await monitorStep(mon)).body.units.find((unit) => unit.unit === 'NH');
  assert.equal(first.action, 'pause_incomplete');
  assert.deepEqual(first.paused_route_keys, []);
  assert.equal(routeRow(mon, active.route_key).status, 'PAUSE_PENDING');
  assert.equal(mon.graph.adsets.get(active.adset_id).status, 'ACTIVE');
  mon.pauseFails = false;
  const second = (await monitorStep(mon)).body.units.find((unit) => unit.unit === 'NH');
  assert.deepEqual(second.recovered, [{ route_key: active.route_key, status: 'PAUSED_BY_MONITOR' }]);
  assert.equal(mon.graph.adsets.get(active.adset_id).status, 'PAUSED');
  const notice = (await listRoutes(mon)).unnotified_decisions.find((entry) => entry.route_key === active.route_key);
  assert.equal(notice.outcome, 'PAUSED_BY_MONITOR');
  assert.deepEqual(notice.reasons, ['monitor_ceiling_exceeded']);

  // Conjunto apagado no Gerenciador: a Graph não lê e a listagem completa da
  // conta não o mostra. Isso também conta como parado.
  const gone = await withPolicies(setup());
  const deleted = await ensureOk(gone);
  assert.equal((await decision(gone, deleted, 'APPROVE')).body.outcome, 'ACTIVATED');
  gone.graph.spend.set(WPP_ADSET.NH, 50_000);
  gone.graph.adsets.delete(deleted.adset_id);
  gone.graph.campaigns.delete(deleted.campaign_id);
  const cleaned = (await monitorStep(gone)).body.units.find((unit) => unit.unit === 'NH');
  assert.deepEqual(cleaned.paused_route_keys, [deleted.route_key]);
  assert.equal(routeRow(gone, deleted.route_key).adset_status, 'DELETED');
});

// Réplica sintética da regra do nó "Validate Meta Placement Eligibility" do
// workflow Meta Ads – Publish: TODA entrada de placement_checks precisa dos
// quatro publishers e do posicionamento de status do WhatsApp, senão o lote
// inteiro é bloqueado. O nó não conhece as chaves objective_route_*.
function publishPreflightBlocks(placementChecks) {
  const required = ['facebook', 'instagram', 'audience_network', 'whatsapp'];
  return placementChecks.filter((check) => {
    const targeting = check.targeting || {};
    const publishers = targeting.publisher_platforms || [];
    const positions = targeting.whatsapp_positions || [];
    return !required.every((name) => publishers.includes(name)) || !positions.includes('status');
  }).map((check) => check.adset_id);
}

test('A3: rota ativada não entra no inventário de quem não a listou; o preflight do Publish segue passando', async () => {
  const ctx = await withPolicies(setup());
  const whatsappTargeting = {
    publisher_platforms: ['facebook', 'instagram', 'audience_network', 'whatsapp'],
    whatsapp_positions: ['status'],
  };
  for (const id of Object.values(WPP_ADSET)) ctx.graph.adsets.get(id).targeting = whatsappTargeting;
  const inventory = async (env, adsets) => {
    const response = await handleMetaAdsPublishRequest({
      request: new Request('https://vault.test/v1/meta-ads-publish/inventory', {
        method: 'POST', body: JSON.stringify({ token_id: TOKEN.NH, account_id: ACCOUNT_ID, adsets }),
      }),
      env, requestId: 'req', pathname: '/v1/meta-ads-publish/inventory',
      decryptToken: async () => 'synthetic-access-token', writeAudit: async () => {},
    });
    assert.equal(response.status, 200);
    return (await response.json()).placement_checks;
  };
  // O pedido que o workflow de hoje faz: só os conjuntos do WhatsApp.
  const workflowRequest = [{ adset_id: WPP_ADSET.NH, destination_group: GROUP.NH }];
  const before = await inventory(ctx.env, workflowRequest);
  const route = await ensureOk(ctx);
  assert.equal((await decision(ctx, route, 'APPROVE')).body.outcome, 'ACTIVATED');
  const after = await inventory(ctx.env, workflowRequest);
  // Mesma resposta de antes da rota e de quando o modo está desligado.
  assert.deepEqual(after, before);
  assert.deepEqual(after, await inventory({ ...ctx.env, META_ADS_OBJECTIVE_ROUTES_MODE: 'off' }, workflowRequest));
  assert.deepEqual(after.map((check) => check.adset_id), [WPP_ADSET.NH]);
  // O conjunto de tráfego não tem publishers de WhatsApp: se entrasse sozinho
  // na resposta, o preflight bloquearia o lote. Listado de propósito, ele vem
  // com a origem da rota, para o chamador que já sabe tratá-lo.
  const explicit = await inventory(ctx.env, [...workflowRequest, { adset_id: route.adset_id, destination_group: GROUP.NH }]);
  assert.equal(explicit.find((check) => check.adset_id === route.adset_id).objective_route_outcome, 'ACTIVATED');
  assert.deepEqual(publishPreflightBlocks(after), []);
  assert.deepEqual(publishPreflightBlocks(explicit), [route.adset_id]);
});

test('M2: a busca por nome não usa filtro da Graph e a retomada não duplica quando a listagem ainda não mostra o objeto', async () => {
  const ctx = await withPolicies(setup());
  let dropped = false;
  ctx.graph.intercept((call) => {
    if (call.method === 'POST' && call.path.endsWith('/campaigns') && !dropped) {
      dropped = true;
      return 'timeout_after';
    }
    return undefined;
  });
  // Leitura logo após a escrita: a Meta criou, mas a listagem ainda vem vazia.
  ctx.listingLags = true;
  const route = ctx.graph.route.bind(ctx.graph);
  ctx.graph.route = (call) => (ctx.listingLags && call.method === 'GET' && call.path.endsWith('/campaigns')
    ? ctx.graph.ok({ data: [] }) : route(call));
  const names = objectiveRouteNames('NH', 'TRAFFIC_SITE_AGENDAMENTO');
  const created = () => [...ctx.graph.campaigns.values()].filter((row) => row.name === names.campaign).length;

  assert.equal((await ensure(ctx)).status, 502);
  assert.equal(created(), 1);
  const second = await ensure(ctx);
  assert.equal(second.status, 502);
  assert.equal(second.body.detail.cause_code, 'objective_route_create_unconfirmed');
  assert.equal(created(), 1);
  assert.equal(ctx.graph.posts().filter((call) => call.path.endsWith('/campaigns')).length, 1);
  // A listagem alcança a escrita: reaproveita pelo nome, sem segundo POST.
  ctx.listingLags = false;
  const done = await ensure(ctx);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(created(), 1);
  assert.ok(events(ctx, done.body.route_key).includes('campaign_reused_by_name'));
  // Nenhuma chamada depende do filtro por nome.
  assert.equal(ctx.graph.calls.some((call) => 'filtering' in call.query), false);

  // Recusa definitiva da Meta na criação não abre a janela de espera.
  const refused = await withPolicies(setup());
  let once = false;
  refused.graph.intercept((call) => {
    if (!once && call.method === 'POST' && call.path.endsWith('/campaigns')) {
      once = true;
      return graphError('Invalid parameter', 100, 400);
    }
    return undefined;
  });
  assert.equal((await ensure(refused)).status, 502);
  assert.equal((await ensure(refused)).status, 200);
});

test('M3: conta em outro fuso invalida a conta do teto e gasto sem conjunto conta para as duas unidades', async () => {
  const ctx = await withPolicies(setup());
  const nh = await ensureOk(ctx, 'NH', 'TRAFFIC_SITE_AGENDAMENTO', 23);
  const bss = await ensureOk(ctx, 'BSS', 'TRAFFIC_SITE_AGENDAMENTO', 30);
  // Conjunto apagado no mês: aparece no total da conta, não nas linhas.
  ctx.graph.unattributedSpend = 400;
  const listed = await listRoutes(ctx);
  assert.equal(listed.pending.find((entry) => entry.route_key === nh.route_key).budget_state.spend_mtd_brl, 2100 + 400);
  assert.equal(listed.pending.find((entry) => entry.route_key === bss.route_key).budget_state.spend_mtd_brl, 2700 + 400);
  // NH: 2100 + 3000 sem conjunto + (81 + 23) × 5 = 5620 > 5400.
  ctx.graph.unattributedSpend = 3000;
  const blocked = await decision(ctx, nh, 'APPROVE');
  assert.equal(blocked.body.outcome, 'BLOCKED');
  assert.deepEqual(blocked.body.reasons, ['ceiling_exceeded']);
  assert.equal(blocked.body.budget.spend_mtd_brl, 5100);

  ctx.graph.unattributedSpend = 0;
  ctx.graph.timezone = 'America/Los_Angeles';
  ctx.clock.now += 16 * 60_000;
  const invalid = (await listRoutes(ctx)).pending.find((entry) => entry.route_key === bss.route_key).budget_state;
  assert.deepEqual(invalid.invalid, ['account_timezone_not_sao_paulo']);
  assert.equal(invalid.spend_mtd_brl, null);
  const refused = await decision(ctx, bss, 'APPROVE');
  assert.equal(refused.body.outcome, 'BLOCKED');
  assert.deepEqual(refused.body.reasons, ['budget_inputs_invalid']);
  assert.equal(activePosts(ctx).length, 0);
});

test('M4: troca de estado é compare-and-set e a trava é renovada a cada mutação', async () => {
  // Outra chamada fecha a rota enquanto a aprovação lê a conta: a aprovação
  // perde a corrida, não ativa nada e não sobrescreve a decisão.
  const ctx = await withPolicies(setup());
  const route = await ensureOk(ctx);
  let raced = false;
  ctx.graph.intercept((call) => {
    if (!raced && call.method === 'GET' && call.path.endsWith('/insights')) {
      raced = true;
      ctx.d1.db.prepare(`UPDATE meta_ads_objective_routes SET status = 'REJECTED', decided_at = 'x' WHERE route_key = ?`).run(route.route_key);
    }
    return undefined;
  });
  const lost = await decision(ctx, route, 'APPROVE');
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  assert.equal(lost.body.error, 'objective_route_state_changed');
  assert.equal(activePosts(ctx).length, 0);
  assert.equal(routeRow(ctx, route.route_key).status, 'REJECTED');

  // O vencimento varrido fora da trava não desfaz uma decisão concorrente.
  const sweep = await withPolicies(setup());
  const expiring = await ensureOk(sweep);
  sweep.clock.now += internals.approvalTtlMs + internals.decisionGraceMs + 60_000;
  const first = sweep.d1.db.prepare.bind(sweep.d1.db);
  let flipped = false;
  sweep.d1.db.prepare = (sql) => {
    if (!flipped && /^UPDATE meta_ads_objective_routes SET status = \?/.test(sql)) {
      flipped = true;
      first(`UPDATE meta_ads_objective_routes SET status = 'ACTIVATED' WHERE route_key = ?`).run(expiring.route_key);
    }
    return first(sql);
  };
  const swept = await sweep.call('/pending', { action: 'list_pending_objective_routes' });
  assert.equal(swept.status, 200, JSON.stringify(swept.body));
  assert.equal(routeRow(sweep, expiring.route_key).status, 'ACTIVATED');

  // Trava perdida no meio da ativação (outra chamada assumiu a unidade): a
  // mutação seguinte não sai, a rota fica em ACTIVATING para o monitor.
  const locked = await withPolicies(setup());
  const slow = await ensureOk(locked);
  let heartbeats = 0;
  locked.graph.intercept((call) => {
    if (call.method === 'POST' && call.path === slow.campaign_id && call.body.status === 'ACTIVE') {
      heartbeats = locked.d1.rows(`SELECT heartbeat_at FROM meta_ads_publish_locks WHERE resource_key = 'objective-route-unit:NH'`).length;
      locked.d1.db.prepare(`UPDATE meta_ads_publish_locks SET operation_key = 'outra-chamada' WHERE resource_key = 'objective-route-unit:NH'`).run();
    }
    return undefined;
  });
  const interrupted = await decision(locked, slow, 'APPROVE');
  assert.equal(heartbeats, 1);
  assert.equal(interrupted.status, 502, JSON.stringify(interrupted.body));
  assert.equal(interrupted.body.detail.cause_code, 'objective_route_unit_lock_lost');
  assert.equal(locked.graph.adsets.get(slow.adset_id).status, 'PAUSED');
  assert.equal(routeRow(locked, slow.route_key).status, 'ACTIVATING');
  // A trava da outra chamada não é apagada por quem a perdeu.
  assert.equal(locked.d1.rows(`SELECT operation_key FROM meta_ads_publish_locks WHERE resource_key = 'objective-route-unit:NH'`)[0].operation_key, 'outra-chamada');
});
