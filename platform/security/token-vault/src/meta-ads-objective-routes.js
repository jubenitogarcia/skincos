// Rotas por objetivo do Meta Ads (objroute_v1), Fases 2 e 3 do Meta Ads – Publish.
//
// Três rotas HTTP, fora do ciclo de runs de publicação:
//   POST /v1/meta-ads-objective-routes/requests   ensure_objective_route
//   POST /v1/meta-ads-objective-routes/pending    list_pending_objective_routes
//                                                 ack_objective_route_notification
//   POST /v1/meta-ads-objective-routes/decisions  decide_objective_route
// e duas de apoio: POST .../monitor (o mesmo passo do cron) e GET|PUT .../policy
// (só admin).
//
// Este módulo recebe as primitivas do gateway por injeção, como meta-ads-read.js.
// Ele não muda o contrato do workflow (WORKFLOW_CONTRACT_REVISION): a capacidade
// é anunciada numa chave nova e só com META_ADS_OBJECTIVE_ROUTES_MODE=on.
//
// Regras fixas (toda a proteção real de gasto mora aqui; o workflow é só a
// primeira barreira):
// - campanha e conjunto nascem PAUSED. Nenhum caminho de criação envia outro
//   status, e só a ativação aprovada, com o teto recalculado, envia ACTIVE;
// - a decisão do chamador (`decision`, `local_checks`) nunca autoriza gasto:
//   o Vault relê estados, vagas, gasto do mês e orçamentos e refaz a conta;
// - o teto mensal por unidade vem da política gravada no Vault, nunca do pedido;
// - uma decisão por unidade de cada vez (trava em meta_ads_publish_locks);
// - criação idempotente por route_key, inclusive na criação parcial: a retomada
//   reaproveita a campanha ou o conjunto que já existe com o mesmo nome;
// - toda mutação entra no journal antes e depois da chamada à Graph;
// - na dúvida não ativa (fail-closed): leitura que falha não vira decisão;
// - uma rota que pode estar gastando nunca sai da vista do monitor: ativação
//   interrompida (ACTIVATING) é retomada ou pausada por ele, e uma rota só é
//   fechada depois de a pausa ser confirmada por leitura (senão PAUSE_PENDING);
// - toda troca de estado é compare-and-set sobre o estado lido.

export const META_ADS_OBJECTIVE_ROUTES_REVISION = 'objroute_v1';
export const OBJECTIVE_ROUTES_PREFIX = '/v1/meta-ads-objective-routes';
export const OBJECTIVE_ROUTE_ACTIONS = Object.freeze([
  'ensure_objective_route',
  'list_pending_objective_routes',
  'decide_objective_route',
]);
export const OBJECTIVE_ROUTE_NOTIFICATION_ACTIONS = Object.freeze(['ack_objective_route_notification']);

const REQUEST_SCHEMA = 'meta_ads.objective_route_request.v1';
const UNITS = Object.freeze(['BSS', 'NH']);
const ROUTE_KEY_PATTERN = /^objroute_v1:(BSS|NH):([A-Z_]{3,40})$/;
const APPROVAL_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const APPROVAL_CODE_PATTERN = /^[2-9A-HJKMNP-Z]{4}$/;
const REPLY_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_.:@-]{1,200}$/;
const REASON_PATTERN = /^[a-z0-9_]{1,80}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_=-]{1,1024}$/;
const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const TOKEN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

// Limite da Meta: 50 anúncios não arquivados por conjunto.
const AD_SET_AD_LIMIT = 50;
// Margem para o excesso diário da Meta (pode gastar acima do diário num dia).
const BUDGET_MARGIN = 0.1;
const APPROVAL_TTL_MS = 24 * 3600_000;
// A resposta do operador é lida por consulta a cada 10 minutos; a decisão de
// uma resposta dada dentro da validade ainda é aceita por este intervalo.
const DECISION_GRACE_MS = 30 * 60_000;
const REPLY_CLOCK_SKEW_MS = 5 * 60_000;
const REREQUEST_COOLDOWN_MS = 7 * 24 * 3600_000;
const CREATING_ABANDON_MS = 24 * 3600_000;
const UNNOTIFIED_DECISION_WINDOW_MS = 14 * 24 * 3600_000;
const CODE_REUSE_WINDOW_MS = 30 * 24 * 3600_000;
const SNAPSHOT_CACHE_MS = 15 * 60_000;
const UNIT_LOCK_TTL_MS = 5 * 60_000;
// Ativação parada há mais que isto é retomada pelo monitor (o teto é conferido
// de novo); parada há mais que o segundo prazo é pausada e bloqueada.
const ACTIVATION_RESUME_AFTER_MS = 10 * 60_000;
const ACTIVATION_GIVE_UP_MS = 2 * 3600_000;
// Depois de uma criação sem resposta clara (timeout, 5xx) o Vault não cria de
// novo dentro desta janela: a Meta pode ter criado e a listagem ainda não mostrar.
const CREATE_UNCONFIRMED_WINDOW_MS = 30 * 60_000;
const ACCOUNT_TIMEZONE = 'America/Sao_Paulo';
const NAME_LOOKUP_PAGE_LIMIT = 200;
const UNIT_LOCK_OWNER = 'objective-route-unit-lock-v1';
const ACTIVATION_GRANT_TTL_MS = 5 * 60_000;
const MAX_LIST_PAGES = 10;
const ADSET_PAGE_LIMIT = 200;
const INSIGHTS_PAGE_LIMIT = 500;
const POLICY_MAX_CEILING_BRL = 100_000;
const POLICY_MAX_TARGETING_BYTES = 8 * 1024;
const MINOR_UNITS_PER_BRL = 100;

const LIVE_STATUSES = Object.freeze(['CREATING', 'PENDING_APPROVAL', 'ACTIVATING', 'ACTIVATED', 'PAUSE_PENDING']);
// Estados em que a campanha ou o conjunto da rota podem estar ACTIVE na Meta.
// Contam no comprometido da unidade e são acompanhados pelo monitor.
const SPENDING_STATUSES = Object.freeze(['ACTIVATING', 'ACTIVATED', 'PAUSE_PENDING']);
const SPENDING_STATUSES_SQL = SPENDING_STATUSES.map((status) => `'${status}'`).join(', ');
const STOPPED_OBJECT_STATUSES = Object.freeze(['PAUSED', 'ARCHIVED', 'DELETED']);
const FINAL_STATUSES = Object.freeze(['REJECTED', 'BLOCKED', 'EXPIRED', 'PAUSED_BY_MONITOR']);

// Catálogo ODAX (Marketing API v25) do próprio Vault. O pedido do workflow tem
// de bater com ele campo a campo; o que vai para a Graph sai daqui.
const OBJECTIVE_CATALOG = Object.freeze({
  TRAFFIC_SITE_AGENDAMENTO: Object.freeze({
    short: 'TRAF_AGD',
    campaign_objective: 'OUTCOME_TRAFFIC',
    optimization_goal: 'LANDING_PAGE_VIEWS',
    billing_event: 'IMPRESSIONS',
    destination_type: 'WEBSITE',
    promoted_object: 'none',
    creatable: true,
  }),
  AWARENESS: Object.freeze({
    short: 'AWARE',
    campaign_objective: 'OUTCOME_AWARENESS',
    optimization_goal: 'REACH',
    billing_event: 'IMPRESSIONS',
    // OUTCOME_AWARENESS não tem destination_type na tabela ODAX.
    destination_type: '',
    promoted_object: 'page_id',
    // Limite de frequência só vale com REACH.
    frequency_control_specs: Object.freeze([
      Object.freeze({ event: 'IMPRESSIONS', interval_days: 7, max_frequency: 2 }),
    ]),
    creatable: true,
  }),
  ENGAGEMENT_VIDEO: Object.freeze({
    short: 'ENG_VID',
    campaign_objective: 'OUTCOME_ENGAGEMENT',
    optimization_goal: 'THRUPLAY',
    billing_event: 'IMPRESSIONS',
    destination_type: 'ON_VIDEO',
    // THRUPLAY/ON_VIDEO não leva promoted_object.
    promoted_object: 'none',
    creatable: true,
  }),
  // A rota do WhatsApp é o conjunto já configurado; nada a criar.
  LEADS_WHATSAPP: Object.freeze({ creatable: false, reason: 'objective_route_uses_current_route' }),
  // Dependem de integrações que ainda não existem (leads no CRM, CAPI).
  LEADS_FORM: Object.freeze({ creatable: false, reason: 'objective_route_objective_disabled' }),
  CONVERSION_SITE_AGENDAMENTO: Object.freeze({ creatable: false, reason: 'objective_route_objective_disabled' }),
});

const ADSET_LIST_FIELDS = [
  'id', 'name', 'campaign_id', 'status', 'effective_status',
  'daily_budget', 'lifetime_budget', 'budget_remaining', 'end_time',
  'campaign{id,status,daily_budget,lifetime_budget,budget_remaining,stop_time}',
].join(',');

function readText(value) {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(readText(value) || '{}');
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function roundBrl(value) {
  return Math.round(value * 100) / 100;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function saoPauloDate(ms) {
  // 'en-CA' formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

// Calendário do teto em America/Sao_Paulo. `days_remaining` conta hoje.
export function objectiveRouteCalendar(nowMs) {
  const today = saoPauloDate(nowMs);
  const [year, month, day] = today.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    today,
    month_key: `${year}-${pad2(month)}`,
    month_start: `${year}-${pad2(month)}-01`,
    days_remaining: daysInMonth(year, month) - day + 1,
    next_month_key: `${nextYear}-${pad2(nextMonth)}`,
    days_next_month: daysInMonth(nextYear, nextMonth),
  };
}

// Dias até o fim de um orçamento vitalício, contando hoje. Sem data legível
// conta 1 dia: o saldo inteiro pode sair hoje (lado conservador).
function daysUntil(endTime, today) {
  const ms = Date.parse(readText(endTime));
  if (!Number.isFinite(ms)) return 1;
  const diff = Math.round((Date.parse(`${saoPauloDate(ms)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return Math.max(1, diff + 1);
}

// Mesma conta do trecho `obj-budget-check-v1` do workflow:
// - mês corrente: gasto + (diários ativos + o novo) × dias restantes ≤ teto × 0,9;
// - virada do mês: (diários ativos + o novo) × dias do mês seguinte ≤ teto seguinte × 0,9.
export function objectiveRouteBudgetCheck(input) {
  const values = [
    input.ceiling_monthly_brl, input.spend_mtd_brl, input.committed_daily_brl, input.new_daily_brl,
    input.days_remaining, input.next_ceiling_monthly_brl, input.days_next_month,
  ].map((value) => (value === null || value === undefined || value === '' ? NaN : Number(value)));
  const invalid = values.some((value) => !Number.isFinite(value) || value < 0)
    || !(values[0] > 0) || !(values[5] > 0)
    || !(values[6] >= 28 && values[6] <= 31) || !(values[4] >= 1 && values[4] <= 31);
  if (invalid) {
    return { ok: false, reason: 'budget_inputs_invalid', projected_brl: null, limit_brl: null, next_month_projected_brl: null, next_month_limit_brl: null };
  }
  const [ceiling, spend, committed, extra, days, nextCeiling, nextDays] = values;
  // Só o Vault informa um comprometido próprio para o mês seguinte (sem os
  // vitalícios que terminam neste mês); sem ele vale o mesmo do mês corrente.
  const committedNextInput = Number(input.committed_next_daily_brl);
  const committedNext = input.committed_next_daily_brl !== undefined && input.committed_next_daily_brl !== null
    && Number.isFinite(committedNextInput) && committedNextInput >= 0 ? committedNextInput : committed;
  const limit = roundBrl(ceiling * (1 - BUDGET_MARGIN));
  const nextLimit = roundBrl(nextCeiling * (1 - BUDGET_MARGIN));
  const projected = roundBrl(spend + (committed + extra) * days);
  const nextProjected = roundBrl((committedNext + extra) * nextDays);
  let reason = 'within_ceiling';
  if (projected > limit) reason = 'ceiling_exceeded';
  else if (nextProjected > nextLimit) reason = 'next_month_ceiling_exceeded';
  return {
    ok: reason === 'within_ceiling',
    reason,
    projected_brl: projected,
    limit_brl: limit,
    headroom_brl: roundBrl(limit - projected),
    next_month_projected_brl: nextProjected,
    next_month_limit_brl: nextLimit,
  };
}

// Mesma regra do workflow para reconhecer a unidade pelo destination_group.
export function objectiveRouteUnitCode(destinationGroup) {
  const key = readText(destinationGroup).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (key === 'bss' || key.includes('barrashoppingsul')) return 'BSS';
  if (key === 'nh' || key.includes('novohamburgo')) return 'NH';
  return '';
}

export function objectiveRouteNames(unit, objective) {
  const spec = OBJECTIVE_CATALOG[objective];
  return {
    campaign: `EF | ${unit} | ${spec.short} | ABO | ${META_ADS_OBJECTIVE_ROUTES_REVISION}`,
    adset: `${unit} | ${spec.short} | ${spec.optimization_goal} | ${META_ADS_OBJECTIVE_ROUTES_REVISION}`,
  };
}

export function objectiveRoutesMode(env) {
  return readText(env && env.META_ADS_OBJECTIVE_ROUTES_MODE).toLowerCase() === 'on' ? 'on' : 'off';
}

export function isObjectiveRoutesPath(pathname) {
  return pathname === OBJECTIVE_ROUTES_PREFIX || pathname.startsWith(`${OBJECTIVE_ROUTES_PREFIX}/`);
}

export function createMetaAdsObjectiveRoutes(deps) {
  const {
    resolveGraphAuth, graphRequest, graphUrl, normalizeNumericId, failure, normalizeFailure,
    listConfigRows, dbFirst, dbAll, dbRun, response,
  } = deps || {};
  for (const [name, dep] of Object.entries({
    resolveGraphAuth, graphRequest, graphUrl, normalizeNumericId, failure, normalizeFailure,
    listConfigRows, dbFirst, dbAll, dbRun, response,
  })) {
    if (typeof dep !== 'function') throw new Error(`meta_ads_objective_routes_dependency_missing:${name}`);
  }

  // Relógio e aleatoriedade trocáveis só por função injetada no `env` (um
  // valor de configuração do Worker é sempre texto e nunca chega aqui).
  function nowMs(env) {
    return typeof env?.META_ADS_OBJECTIVE_ROUTES_NOW === 'function' ? Number(env.META_ADS_OBJECTIVE_ROUTES_NOW()) : Date.now();
  }
  function iso(ms) {
    return new Date(ms).toISOString();
  }
  function randomBytes(env, length) {
    if (typeof env?.META_ADS_OBJECTIVE_ROUTES_RANDOM === 'function') return env.META_ADS_OBJECTIVE_ROUTES_RANDOM(length);
    return crypto.getRandomValues(new Uint8Array(length));
  }

  const reject = (code, httpStatus = 400, extra = {}) => failure(code, { classification: 'permanent', http_status: httpStatus, ...extra });
  const conflict = (code, extra = {}) => failure(code, { classification: 'permanent', http_status: 409, ...extra });
  const unavailable = (code, extra = {}) => failure(code, { classification: 'transient', retryable: false, http_status: 503, ...extra });

  function graphContext(base, action, unitLock = null) {
    return {
      env: base.env,
      decryptToken: base.decryptToken,
      attempts: 0,
      rateUsage: {},
      traceId: '',
      action,
      operationKey: `objective-route:${action}`,
      // Renovada antes de cada mutação: uma ativação longa não perde a trava.
      unitLock,
    };
  }

  function changedRows(result) {
    const changes = Number(result && result.meta && result.meta.changes);
    return Number.isFinite(changes) ? changes : 1;
  }

  // ---------------------------------------------------------------- journal

  async function journal(env, route, event, payload = {}) {
    await dbRun(env,
      `INSERT INTO meta_ads_objective_route_events (id, route_id, route_key, event, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), route.id, route.route_key, event, JSON.stringify(payload), iso(nowMs(env)));
  }

  // Compare-and-set: a gravação só vale se o registro ainda está no estado que
  // esta chamada leu. Quem perde a corrida recebe 409 e não muda nada.
  async function saveRoute(env, route, changes) {
    const next = { ...changes, updated_at: iso(nowMs(env)) };
    const keys = Object.keys(next);
    const result = await dbRun(env,
      `UPDATE meta_ads_objective_routes SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ? AND status = ?`,
      ...keys.map((key) => next[key]), route.id, route.status);
    if (changedRows(result) === 0) {
      throw failure('objective_route_state_changed', { classification: 'transient', retryable: false, http_status: 409 });
    }
    Object.assign(route, next);
    return route;
  }

  async function latestRoute(env, routeKey) {
    return dbFirst(env,
      `SELECT * FROM meta_ads_objective_routes WHERE route_key = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      routeKey);
  }

  // ------------------------------------------------------------------ trava

  // Trava por unidade: criação, decisão e monitor da mesma unidade nunca rodam
  // juntos. A segunda chamada recebe 409 e tenta de novo na rodada seguinte,
  // quando já enxerga o que a primeira ativou.
  async function withUnitLock(env, unit, purpose, fn) {
    const resourceKey = `objective-route-unit:${unit}`;
    const owner = `${purpose}:${crypto.randomUUID()}`;
    const now = nowMs(env);
    const nowIso = iso(now);
    const expires = iso(now + UNIT_LOCK_TTL_MS);
    await dbRun(env,
      `INSERT INTO meta_ads_publish_locks (
         resource_key, run_id, operation_key, heartbeat_at, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(resource_key) DO UPDATE SET
         run_id = excluded.run_id, operation_key = excluded.operation_key,
         heartbeat_at = excluded.heartbeat_at, expires_at = excluded.expires_at,
         updated_at = excluded.updated_at
       WHERE meta_ads_publish_locks.expires_at <= excluded.heartbeat_at`,
      resourceKey, UNIT_LOCK_OWNER, owner, nowIso, expires, nowIso, nowIso);
    const held = await dbFirst(env,
      `SELECT operation_key, expires_at FROM meta_ads_publish_locks WHERE resource_key = ?`, resourceKey);
    if (!held || readText(held.operation_key) !== owner) {
      const remaining = Math.max(1000, Date.parse(readText(held && held.expires_at)) - now || UNIT_LOCK_TTL_MS);
      throw failure('objective_route_unit_busy', {
        classification: 'transient', retryable: false, http_status: 409,
        retry_after_seconds: Math.ceil(remaining / 1000),
      });
    }
    const lock = {
      async renew() {
        const at = nowMs(env);
        const result = await dbRun(env,
          `UPDATE meta_ads_publish_locks SET heartbeat_at = ?, expires_at = ?, updated_at = ?
            WHERE resource_key = ? AND operation_key = ?`,
          iso(at), iso(at + UNIT_LOCK_TTL_MS), iso(at), resourceKey, owner);
        if (changedRows(result) === 0) {
          throw failure('objective_route_unit_lock_lost', { classification: 'transient', retryable: false, http_status: 409 });
        }
      },
    };
    try {
      return await fn(lock);
    } finally {
      try {
        await dbRun(env,
          `DELETE FROM meta_ads_publish_locks WHERE resource_key = ? AND operation_key = ?`, resourceKey, owner);
      } catch {
        // A trava vence sozinha em UNIT_LOCK_TTL_MS.
      }
    }
  }

  // --------------------------------------------------------------- política

  function normalizeCeilings(value) {
    if (!isPlainObject(value)) throw reject('objective_route_policy_invalid', 400, { field: 'ceilings_monthly_brl' });
    const base = Number(value.base);
    const forte = Number(value.forte);
    const valid = [base, forte].every((n) => Number.isFinite(n) && n > 0 && n <= POLICY_MAX_CEILING_BRL) && base <= forte;
    if (!valid || Object.keys(value).some((key) => !['base', 'forte'].includes(key))) {
      throw reject('objective_route_policy_invalid', 400, { field: 'ceilings_monthly_brl' });
    }
    return { base, forte };
  }

  function normalizeMonthProfiles(value) {
    if (value === undefined || value === null) return {};
    if (!isPlainObject(value) || Object.keys(value).length > 36) {
      throw reject('objective_route_policy_invalid', 400, { field: 'month_profiles' });
    }
    const out = {};
    for (const [month, profile] of Object.entries(value)) {
      if (!MONTH_KEY_PATTERN.test(month) || !['base', 'forte'].includes(profile)) {
        throw reject('objective_route_policy_invalid', 400, { field: 'month_profiles' });
      }
      out[month] = profile;
    }
    return out;
  }

  function normalizeTargeting(value) {
    if (!isPlainObject(value) || !isPlainObject(value.geo_locations) || !Object.keys(value.geo_locations).length
      || JSON.stringify(value).length > POLICY_MAX_TARGETING_BYTES) {
      throw reject('objective_route_policy_invalid', 400, { field: 'targeting' });
    }
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeIdList(value, field) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 200) throw reject('objective_route_policy_invalid', 400, { field });
    return [...new Set(value.map((id) => normalizeNumericId(id, field)))];
  }

  function normalizeObjectives(value) {
    const creatable = Object.keys(OBJECTIVE_CATALOG).filter((key) => OBJECTIVE_CATALOG[key].creatable);
    if (value === undefined || value === null) return creatable;
    if (!Array.isArray(value) || value.some((key) => !creatable.includes(key))) {
      throw reject('objective_route_policy_invalid', 400, { field: 'objectives' });
    }
    return [...new Set(value)];
  }

  function normalizePolicyInput(value) {
    if (!isPlainObject(value)) throw reject('objective_route_policy_invalid');
    const allowed = ['unit', 'token_id', 'enabled', 'ceilings_monthly_brl', 'month_profiles', 'targeting', 'adset_ids', 'objectives'];
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw reject('objective_route_policy_invalid', 400, { field: 'unknown_key' });
    const unit = readText(value.unit);
    if (!UNITS.includes(unit)) throw reject('objective_route_policy_invalid', 400, { field: 'unit' });
    const tokenId = readText(value.token_id);
    if (!TOKEN_ID_PATTERN.test(tokenId)) throw reject('objective_route_policy_invalid', 400, { field: 'token_id' });
    if (typeof value.enabled !== 'boolean') throw reject('objective_route_policy_invalid', 400, { field: 'enabled' });
    return {
      unit,
      token_id: tokenId,
      enabled: value.enabled,
      policy: {
        ceilings_monthly_brl: normalizeCeilings(value.ceilings_monthly_brl),
        month_profiles: normalizeMonthProfiles(value.month_profiles),
        targeting: normalizeTargeting(value.targeting),
        adset_ids: normalizeIdList(value.adset_ids, 'adset_ids'),
        objectives: normalizeObjectives(value.objectives),
      },
    };
  }

  function policyFromRow(row) {
    if (!row) return null;
    const policy = parseJsonObject(row.policy_json);
    return {
      unit: readText(row.unit),
      token_id: readText(row.token_id),
      enabled: Number(row.enabled) === 1,
      ceilings_monthly_brl: isPlainObject(policy.ceilings_monthly_brl) ? policy.ceilings_monthly_brl : {},
      month_profiles: isPlainObject(policy.month_profiles) ? policy.month_profiles : {},
      targeting: isPlainObject(policy.targeting) ? policy.targeting : null,
      adset_ids: safeList(policy.adset_ids).map(readText),
      objectives: safeList(policy.objectives).map(readText),
      updated_at: readText(row.updated_at),
    };
  }

  async function loadPolicies(env) {
    const rows = await dbAll(env, `SELECT * FROM meta_ads_objective_route_policies ORDER BY unit`);
    return rows.map(policyFromRow);
  }

  async function requirePolicy(env, unit) {
    const policy = policyFromRow(await dbFirst(env,
      `SELECT * FROM meta_ads_objective_route_policies WHERE unit = ?`, unit));
    if (!policy || !policy.enabled) throw conflict('objective_route_unit_not_enabled');
    return policy;
  }

  // Teto duro do mês, pelo perfil que a política marca para aquele mês.
  function ceilingForMonth(policy, monthKey) {
    const profile = policy.month_profiles[monthKey] === 'forte' ? 'forte' : 'base';
    const ceiling = Number(policy.ceilings_monthly_brl[profile]);
    return { profile, ceiling_monthly_brl: Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null };
  }

  // Linhas de configuração do Meta Ads – Publish por unidade. É o que liga a
  // unidade ao token, à conta e aos conjuntos que já gastam.
  async function unitConfigs(env) {
    const byUnit = new Map();
    for (const row of await listConfigRows(env)) {
      const config = parseJsonObject(row.metadata_json).meta_ads_publish;
      if (!isPlainObject(config) || !Object.keys(config).length) continue;
      const unit = objectiveRouteUnitCode(config.destination_group);
      if (!unit) continue;
      const entry = byUnit.get(unit) || { rows: [] };
      entry.rows.push({ token_id: readText(row.id), config });
      byUnit.set(unit, entry);
    }
    return byUnit;
  }

  async function assertPolicyMatchesConfig(env, unit, tokenId) {
    const entry = (await unitConfigs(env)).get(unit);
    if (!entry || !entry.rows.some((row) => row.token_id === tokenId)) {
      throw conflict('objective_route_policy_token_not_configured_for_unit');
    }
  }

  async function putPolicy(base) {
    let body;
    try { body = await base.request.json(); } catch { body = null; }
    const input = normalizePolicyInput(body);
    await assertPolicyMatchesConfig(base.env, input.unit, input.token_id);
    const now = iso(nowMs(base.env));
    await dbRun(base.env,
      `INSERT INTO meta_ads_objective_route_policies (unit, token_id, enabled, policy_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(unit) DO UPDATE SET
         token_id = excluded.token_id, enabled = excluded.enabled,
         policy_json = excluded.policy_json, updated_at = excluded.updated_at`,
      input.unit, input.token_id, input.enabled ? 1 : 0, JSON.stringify(input.policy), now, now);
    return { ok: true, unit: input.unit, enabled: input.enabled, updated_at: now };
  }

  // -------------------------------------------------------- leitura da conta

  async function listAll(auth, context, path, query) {
    const rows = [];
    let after = '';
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await graphRequest(
        graphUrl(auth.apiVersion, path, { ...query, ...(after ? { after } : {}) }),
        { method: 'GET' }, auth, context,
      );
      const body = isPlainObject(result.body) ? result.body : {};
      rows.push(...safeList(body.data));
      const paging = isPlainObject(body.paging) ? body.paging : {};
      if (!readText(paging.next)) return { rows, complete: true };
      const cursor = readText(isPlainObject(paging.cursors) ? paging.cursors.after : '');
      if (!CURSOR_PATTERN.test(cursor)) return { rows, complete: false };
      after = cursor;
    }
    return { rows, complete: false };
  }

  function minorToBrl(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number / MINOR_UNITS_PER_BRL : 0;
  }

  // Lê, sem cache, o que a conta pode gastar e o que já gastou no mês.
  async function readAccountSnapshot(auth, context, calendar) {
    const invalid = [];
    const account = await graphRequest(
      graphUrl(auth.apiVersion, `act_${auth.accountId}`, { fields: 'currency,timezone_name' }), { method: 'GET' }, auth, context);
    if (readText(account.body && account.body.currency).toUpperCase() !== 'BRL') invalid.push('account_currency_not_brl');
    // O `time_range` de Insights segue o fuso da conta; o calendário do teto é
    // America/Sao_Paulo. Com outro fuso o "gasto do mês" seria de outro período.
    if (readText(account.body && account.body.timezone_name) !== ACCOUNT_TIMEZONE) invalid.push('account_timezone_not_sao_paulo');

    const adsetList = await listAll(auth, context, `act_${auth.accountId}/adsets`, {
      fields: ADSET_LIST_FIELDS, limit: String(ADSET_PAGE_LIMIT),
    });
    if (!adsetList.complete) invalid.push('adset_listing_incomplete');
    const adsets = adsetList.rows.filter(isPlainObject).map((row) => {
      const campaign = isPlainObject(row.campaign) ? row.campaign : {};
      return {
        id: readText(row.id),
        campaign_id: readText(row.campaign_id || campaign.id),
        status: readText(row.status).toUpperCase(),
        campaign_status: readText(campaign.status).toUpperCase(),
        daily_brl: minorToBrl(row.daily_budget),
        lifetime_brl: minorToBrl(row.lifetime_budget),
        remaining_brl: minorToBrl(row.budget_remaining),
        end_time: readText(row.end_time),
        campaign_daily_brl: minorToBrl(campaign.daily_budget),
        campaign_lifetime_brl: minorToBrl(campaign.lifetime_budget),
        campaign_remaining_brl: minorToBrl(campaign.budget_remaining),
        campaign_stop_time: readText(campaign.stop_time),
      };
    });

    const insights = await listAll(auth, context, `act_${auth.accountId}/insights`, {
      level: 'adset',
      fields: 'adset_id,spend',
      time_range: JSON.stringify({ since: calendar.month_start, until: calendar.today }),
      limit: String(INSIGHTS_PAGE_LIMIT),
    });
    if (!insights.complete) invalid.push('insights_listing_incomplete');
    const spend = {};
    for (const row of insights.rows.filter(isPlainObject)) {
      const id = readText(row.adset_id);
      const value = Number(row.spend);
      if (!id || !Number.isFinite(value) || value < 0) {
        invalid.push('insights_row_invalid');
        continue;
      }
      spend[id] = roundBrl((spend[id] || 0) + value);
    }
    // Total da conta no mesmo período. O que as linhas por conjunto não explicam
    // (conjunto arquivado ou apagado no mês, por exemplo) conta para as duas unidades.
    const accountInsights = await listAll(auth, context, `act_${auth.accountId}/insights`, {
      level: 'account',
      fields: 'spend',
      time_range: JSON.stringify({ since: calendar.month_start, until: calendar.today }),
      limit: '10',
    });
    if (!accountInsights.complete) invalid.push('insights_listing_incomplete');
    let accountSpend = 0;
    for (const row of accountInsights.rows.filter(isPlainObject)) {
      const value = Number(row.spend);
      if (!Number.isFinite(value) || value < 0) {
        invalid.push('insights_row_invalid');
        continue;
      }
      accountSpend += value;
    }
    const attributed = Object.values(spend).reduce((sum, value) => sum + value, 0);
    return {
      account_id: auth.accountId,
      as_of: iso(nowMs(context.env)),
      today: calendar.today,
      month_key: calendar.month_key,
      adsets,
      spend_by_adset: spend,
      account_spend_brl: roundBrl(accountSpend),
      unattributed_spend_brl: Math.max(0, roundBrl(accountSpend - attributed)),
      route_ads: {},
      invalid: [...new Set(invalid)],
    };
  }

  async function readAdsetAds(auth, context, adsetId) {
    const list = await listAll(auth, context, `${adsetId}/ads`, { fields: 'id,status,effective_status', limit: '100' });
    const ads = list.rows.filter(isPlainObject).map((row) => ({ id: readText(row.id), status: readText(row.status).toUpperCase() }));
    const counted = ads.filter((ad) => ['ACTIVE', 'PAUSED'].includes(ad.status));
    return {
      complete: list.complete,
      used: counted.length,
      paused_ad_ids: counted.filter((ad) => ad.status === 'PAUSED' && /^\d{5,30}$/.test(ad.id)).map((ad) => ad.id),
    };
  }

  // De que unidade é cada conjunto conhecido: configuração do Publish, política
  // e as próprias rotas. Conjunto desconhecido conta para as duas unidades.
  async function knownAdsetUnits(env, policies) {
    const known = new Map();
    for (const [unit, entry] of await unitConfigs(env)) {
      for (const row of entry.rows) {
        for (const id of [row.config.adset_id, row.config.carousel_native_adset_id]) {
          if (/^\d{5,30}$/.test(readText(id))) known.set(readText(id), unit);
        }
      }
    }
    for (const policy of policies) for (const id of policy.adset_ids) known.set(id, policy.unit);
    const routes = await dbAll(env,
      `SELECT adset_id, unit FROM meta_ads_objective_routes WHERE adset_id IS NOT NULL`);
    for (const row of routes) known.set(readText(row.adset_id), readText(row.unit));
    return known;
  }

  // Gasto do mês e diário comprometido da unidade. Inclui diários ABO,
  // orçamentos de campanha (CBO), vitalícios rateados pelos dias restantes e
  // as rotas já ativadas que a listagem ainda não mostra como ativas.
  function unitBudgetState({ snapshot, unit, known, policy, calendar, liveRoutes, excludeAdsetId }) {
    const invalid = [...snapshot.invalid];
    const mine = (adsetId) => !known.has(adsetId) || known.get(adsetId) === unit;
    let committed = 0;
    // Mês seguinte: um vitalício que termina neste mês não gasta na virada.
    let committedNext = 0;
    const lifetime = (remaining, endTime) => {
      const days = daysUntil(endTime, calendar.today);
      const rate = remaining / days;
      committed += rate;
      if (days > calendar.days_remaining) committedNext += rate;
    };
    const countedAdsets = new Set();
    const campaigns = new Map();
    for (const adset of snapshot.adsets) {
      if (!mine(adset.id) || adset.id === excludeAdsetId) continue;
      if (adset.status !== 'ACTIVE' || adset.campaign_status !== 'ACTIVE') continue;
      countedAdsets.add(adset.id);
      if (adset.daily_brl > 0) {
        committed += adset.daily_brl;
        committedNext += adset.daily_brl;
      } else if (adset.lifetime_brl > 0) {
        lifetime(adset.remaining_brl || adset.lifetime_brl, adset.end_time);
      } else if (adset.campaign_daily_brl > 0 || adset.campaign_lifetime_brl > 0) {
        campaigns.set(adset.campaign_id, adset);
      } else {
        invalid.push('active_adset_budget_unknown');
      }
    }
    for (const adset of campaigns.values()) {
      if (adset.campaign_daily_brl > 0) {
        committed += adset.campaign_daily_brl;
        committedNext += adset.campaign_daily_brl;
      } else {
        lifetime(adset.campaign_remaining_brl || adset.campaign_lifetime_brl, adset.campaign_stop_time);
      }
    }
    for (const route of liveRoutes) {
      const adsetId = readText(route.adset_id);
      if (readText(route.unit) !== unit || adsetId === excludeAdsetId || countedAdsets.has(adsetId)) continue;
      if (!SPENDING_STATUSES.includes(readText(route.status))) continue;
      committed += minorToBrl(route.daily_budget_minor_units);
      committedNext += minorToBrl(route.daily_budget_minor_units);
    }
    // Gasto que nenhum conjunto listado explica entra inteiro em cada unidade.
    let spend = Number(snapshot.unattributed_spend_brl) > 0 ? Number(snapshot.unattributed_spend_brl) : 0;
    for (const [adsetId, value] of Object.entries(snapshot.spend_by_adset)) if (mine(adsetId)) spend += value;

    const current = ceilingForMonth(policy, calendar.month_key);
    const next = ceilingForMonth(policy, calendar.next_month_key);
    if (!current.ceiling_monthly_brl || !next.ceiling_monthly_brl) invalid.push('ceiling_not_configured');
    if (snapshot.today !== calendar.today) invalid.push('snapshot_from_another_day');
    return {
      ceiling_monthly_brl: current.ceiling_monthly_brl,
      month_profile: current.profile,
      spend_mtd_brl: roundBrl(spend),
      committed_daily_brl: roundBrl(committed),
      committed_next_daily_brl: roundBrl(committedNext),
      days_remaining: calendar.days_remaining,
      as_of: snapshot.as_of,
      next_ceiling_monthly_brl: next.ceiling_monthly_brl,
      days_next_month: calendar.days_next_month,
      invalid: [...new Set(invalid)],
    };
  }

  async function liveRouteRows(env) {
    return dbAll(env,
      `SELECT * FROM meta_ads_objective_routes WHERE status IN (${SPENDING_STATUSES_SQL})`);
  }

  // ------------------------------------------------------ mutações na Graph

  // Única porta de saída para mutações. Uma tentativa por chamada (a retomada
  // reconcilia pelo estado lido) e o status conferido contra o motivo:
  // criação só PAUSED, pausa só PAUSED, orçamento sem status, e ACTIVE só com
  // a autorização emitida pela conferência do teto daquela mesma rota.
  async function mutate(kind, { auth, context, route, path, payload, grant }) {
    const status = Object.prototype.hasOwnProperty.call(payload, 'status') ? readText(payload.status) : null;
    let allowed = false;
    if (kind === 'create') allowed = status === 'PAUSED';
    else if (kind === 'pause') allowed = status === 'PAUSED' && Object.keys(payload).length === 1;
    else if (kind === 'budget') allowed = status === null && Object.keys(payload).join(',') === 'daily_budget';
    else if (kind === 'activate') {
      allowed = status === 'ACTIVE' && Object.keys(payload).length === 1
        && isPlainObject(grant) && grant.route_id === route.id && grant.budget_ok === true
        && nowMs(context.env) - grant.checked_at_ms <= ACTIVATION_GRANT_TTL_MS;
    }
    if (!allowed) {
      await journal(context.env, route, 'mutation_refused_by_guard', { kind, path_kind: path.split('/').pop(), status });
      throw failure('objective_route_mutation_guard', { classification: 'permanent', http_status: 500 });
    }
    if (context.unitLock) await context.unitLock.renew();
    await journal(context.env, route, `${kind}_requested`, { path, status });
    try {
      const result = await graphRequest(
        graphUrl(auth.apiVersion, path),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
        auth, context, { maxAttempts: 1 },
      );
      await journal(context.env, route, `${kind}_done`, { path, id: readText(result.body && result.body.id) });
      return isPlainObject(result.body) ? result.body : {};
    } catch (error) {
      const normalized = normalizeFailure(error);
      await journal(context.env, route, `${kind}_failed`, {
        path, classification: normalized.classification, ambiguous: normalized.ambiguous, code: normalized.code,
      });
      throw error;
    }
  }

  async function readStatus(auth, context, objectId, extraFields = '') {
    const result = await graphRequest(
      graphUrl(auth.apiVersion, objectId, { fields: `id,name,status,account_id${extraFields}` }),
      { method: 'GET' }, auth, context,
    );
    const body = isPlainObject(result.body) ? result.body : {};
    if (readText(body.account_id).replace(/^act_/, '') !== auth.accountId) {
      throw failure('object_not_in_authorized_account', { classification: 'auth', http_status: 403 });
    }
    return body;
  }

  // ----------------------------------------------------------------- pedido

  function mismatch(field) {
    return reject('objective_route_request_invalid', 400, { field });
  }

  function sameJson(left, right) {
    return stableJson(left) === stableJson(right);
  }

  // Valida o pedido do workflow contra o catálogo do Vault. Qualquer campo que
  // não bata recusa o pedido: o que vai para a Graph é montado aqui.
  function normalizeRouteRequest(body) {
    if (readText(body.action) !== 'ensure_objective_route') throw reject('invalid_action');
    const request = isPlainObject(body.request) ? body.request : null;
    if (!request) throw mismatch('request');
    if (readText(request.schema) !== REQUEST_SCHEMA) throw mismatch('schema');
    const routeKey = readText(request.route_key);
    const match = ROUTE_KEY_PATTERN.exec(routeKey);
    if (!match) throw mismatch('route_key');
    if (readText(body.idempotency_key) !== routeKey) throw mismatch('idempotency_key');
    const [, unit, objective] = match;
    if (readText(request.unit) !== unit || readText(request.objective) !== objective) throw mismatch('route_key');
    const spec = OBJECTIVE_CATALOG[objective];
    if (!spec) throw mismatch('objective');
    if (!spec.creatable) throw conflict(spec.reason);

    const campaign = isPlainObject(request.campaign) ? request.campaign : {};
    const adset = isPlainObject(request.adset) ? request.adset : {};
    const names = objectiveRouteNames(unit, objective);
    if (readText(request.status_on_create) !== 'PAUSED') throw mismatch('status_on_create');
    if (readText(campaign.status) !== 'PAUSED') throw mismatch('campaign.status');
    if (readText(adset.status) !== 'PAUSED') throw mismatch('adset.status');
    if (readText(request.budget_mode) !== 'ABO') throw mismatch('budget_mode');
    if (campaign.is_adset_budget_sharing_enabled !== false) throw mismatch('campaign.is_adset_budget_sharing_enabled');
    if (readText(campaign.objective) !== spec.campaign_objective) throw mismatch('campaign.objective');
    if (!Array.isArray(campaign.special_ad_categories) || campaign.special_ad_categories.length) {
      throw mismatch('campaign.special_ad_categories');
    }
    if (readText(campaign.name) !== names.campaign) throw mismatch('campaign.name');
    if (readText(adset.name) !== names.adset) throw mismatch('adset.name');
    if (readText(adset.optimization_goal) !== spec.optimization_goal) throw mismatch('adset.optimization_goal');
    if (readText(adset.billing_event) !== spec.billing_event) throw mismatch('adset.billing_event');
    if (readText(adset.bid_strategy) !== 'LOWEST_COST_WITHOUT_CAP') throw mismatch('adset.bid_strategy');
    if (readText(adset.destination_type) !== spec.destination_type) throw mismatch('adset.destination_type');
    if (readText(adset.promoted_object) !== spec.promoted_object) throw mismatch('adset.promoted_object');
    if (readText(adset.targeting_ref) !== `vault_unit_targeting:${unit}`) throw mismatch('adset.targeting_ref');
    if (spec.frequency_control_specs) {
      if (!sameJson(adset.frequency_control_specs, spec.frequency_control_specs)) throw mismatch('adset.frequency_control_specs');
    } else if (adset.frequency_control_specs !== undefined) {
      throw mismatch('adset.frequency_control_specs');
    }

    const dailyBrl = Number(request.daily_budget_brl);
    const minor = Number(adset.daily_budget_minor_units);
    if (!Number.isFinite(dailyBrl) || dailyBrl < 1 || !Number.isSafeInteger(minor)
      || minor !== Math.round(dailyBrl * MINOR_UNITS_PER_BRL)) {
      throw mismatch('daily_budget');
    }
    const ceiling = Number(request.ceiling_monthly_brl);
    if (!Number.isFinite(ceiling) || ceiling <= 0) throw mismatch('ceiling_monthly_brl');
    return {
      route_key: routeKey,
      unit,
      objective,
      spec,
      names,
      daily_brl: dailyBrl,
      daily_minor: minor,
      ceiling_monthly_brl: ceiling,
      stored: {
        daily_budget_brl: dailyBrl,
        ceiling_monthly_brl: ceiling,
        month_profile: readText(request.month_profile).slice(0, 40),
        source_run_id: readText(request.source_run_id).slice(0, 160),
      },
    };
  }

  async function generateApprovalCode(env) {
    const since = iso(nowMs(env) - CODE_REUSE_WINDOW_MS);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      let code = '';
      while (code.length < 4) {
        for (const byte of randomBytes(env, 8)) {
          // Amostragem com rejeição: sem viés para as 31 letras do alfabeto.
          if (byte < 248 && code.length < 4) code += APPROVAL_CODE_ALPHABET[byte % APPROVAL_CODE_ALPHABET.length];
        }
      }
      const taken = await dbFirst(env,
        `SELECT id FROM meta_ads_objective_routes
          WHERE approval_code = ? AND (status IN ('CREATING', 'PENDING_APPROVAL', 'ACTIVATING') OR created_at >= ?)
          LIMIT 1`,
        code, since);
      if (!taken) return code;
    }
    throw unavailable('objective_route_approval_code_unavailable');
  }

  function routeSummary(route, extra = {}) {
    return {
      ok: true,
      route_key: route.route_key,
      approval_code: route.approval_code,
      status: route.status,
      new_request: false,
      campaign_id: route.campaign_id || null,
      adset_id: route.adset_id || null,
      campaign_status: route.campaign_status || null,
      adset_status: route.adset_status || null,
      created_at: route.pending_at || route.created_at,
      expires_at: route.expires_at || null,
      ...extra,
    };
  }

  function notDeleted(row) {
    return !['DELETED', 'ARCHIVED'].includes(readText(row.status).toUpperCase());
  }

  // Lista sem filtro e compara o nome aqui: a idempotência da criação não pode
  // depender do comportamento de um filtro da Graph. Listagem truncada falha.
  async function findByName(auth, context, path, name, fields) {
    const list = await listAll(auth, context, path, { fields, limit: String(NAME_LOOKUP_PAGE_LIMIT) });
    if (!list.complete) throw unavailable('objective_route_lookup_incomplete');
    return list.rows.filter(isPlainObject).filter((row) => readText(row.name) === name && notDeleted(row));
  }

  // Antes de criar: se a última criação neste caminho ficou sem resposta clara
  // (pedido no journal sem resultado, timeout ou 5xx) e é recente, a Meta pode
  // ter criado o objeto e a listagem ainda não o mostrar. Criar de novo agora
  // duplicaria; a retomada espera a janela e procura pelo nome outra vez.
  async function assertNoUnconfirmedCreate(env, route, path) {
    const rows = await dbAll(env,
      `SELECT event, payload_json, created_at FROM meta_ads_objective_route_events
        WHERE route_key = ? AND event IN ('create_requested', 'create_done', 'create_failed')
        ORDER BY created_at DESC, rowid DESC LIMIT 40`,
      route.route_key);
    const last = rows.find((row) => parseJsonObject(row.payload_json).path === path);
    if (!last || last.event === 'create_done') return;
    const payload = parseJsonObject(last.payload_json);
    const refused = last.event === 'create_failed' && ['permanent', 'auth'].includes(readText(payload.classification))
      && payload.ambiguous !== true;
    if (refused) return;
    const availableAt = Date.parse(readText(last.created_at)) + CREATE_UNCONFIRMED_WINDOW_MS;
    if (availableAt > nowMs(env)) {
      throw failure('objective_route_create_unconfirmed', {
        classification: 'transient', retryable: false, http_status: 503,
        retry_after_seconds: Math.ceil((availableAt - nowMs(env)) / 1000),
      });
    }
  }

  // Um id herdado de um pedido anterior pode ter sido apagado na Meta; nesse
  // caso a criação procura pelo nome e, sem achar, cria de novo.
  async function readInherited(auth, context, objectId, extraFields) {
    try {
      const current = await readStatus(auth, context, objectId, extraFields);
      return notDeleted(current) ? current : null;
    } catch (error) {
      const normalized = normalizeFailure(error);
      if (normalized.classification === 'permanent' && !normalized.ambiguous) return null;
      throw error;
    }
  }

  async function ensureCampaign(route, request, auth, context) {
    let current = route.campaign_id ? await readInherited(auth, context, route.campaign_id, ',objective') : null;
    if (!current) {
      const found = await findByName(auth, context, `act_${auth.accountId}/campaigns`, request.names.campaign, 'id,name,status,objective');
      if (found.length > 1) throw conflict('objective_route_duplicate_campaign');
      if (found.length === 1) {
        current = found[0];
        await journal(context.env, route, 'campaign_reused_by_name', { id: readText(current.id) });
      } else {
        await assertNoUnconfirmedCreate(context.env, route, `act_${auth.accountId}/campaigns`);
        const created = await mutate('create', {
          auth, context, route,
          path: `act_${auth.accountId}/campaigns`,
          payload: {
            name: request.names.campaign,
            objective: request.spec.campaign_objective,
            status: 'PAUSED',
            special_ad_categories: [],
            // ABO: sem orçamento na campanha, cada conjunto tem o seu.
            is_adset_budget_sharing_enabled: false,
          },
        });
        current = { id: readText(created.id), name: request.names.campaign, status: 'PAUSED', objective: request.spec.campaign_objective };
      }
    }
    const campaignId = normalizeNumericId(current.id, 'campaign_id');
    await saveRoute(context.env, route, { campaign_id: campaignId, campaign_status: readText(current.status).toUpperCase() });
    if (readText(current.name) !== request.names.campaign
      || readText(current.objective).toUpperCase() !== request.spec.campaign_objective) {
      throw conflict('objective_route_existing_campaign_mismatch');
    }
    // Uma campanha que não está pausada nunca é tocada por este caminho.
    if (readText(current.status).toUpperCase() !== 'PAUSED') throw conflict('objective_route_existing_campaign_not_paused');
    return campaignId;
  }

  function adsetPayload(request, auth, policy, campaignId) {
    const spec = request.spec;
    const payload = {
      name: request.names.adset,
      campaign_id: campaignId,
      status: 'PAUSED',
      // Unidade mínima da moeda da conta (centavos).
      daily_budget: request.daily_minor,
      billing_event: spec.billing_event,
      optimization_goal: spec.optimization_goal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: policy.targeting,
    };
    if (spec.destination_type) payload.destination_type = spec.destination_type;
    if (spec.promoted_object === 'page_id') {
      payload.promoted_object = { page_id: normalizeNumericId(auth.config.page_id, 'page_id') };
    }
    if (spec.frequency_control_specs && spec.optimization_goal === 'REACH') {
      payload.frequency_control_specs = spec.frequency_control_specs.map((entry) => ({ ...entry }));
    }
    return payload;
  }

  async function ensureAdset(route, request, auth, context, policy, campaignId) {
    const fields = 'id,name,status,daily_budget,optimization_goal,campaign_id';
    let current = route.adset_id ? await readInherited(auth, context, route.adset_id, ',daily_budget,optimization_goal,campaign_id') : null;
    if (!current) {
      const found = await findByName(auth, context, `${campaignId}/adsets`, request.names.adset, fields);
      if (found.length > 1) throw conflict('objective_route_duplicate_adset');
      if (found.length === 1) {
        current = found[0];
        await journal(context.env, route, 'adset_reused_by_name', { id: readText(current.id) });
      } else {
        await assertNoUnconfirmedCreate(context.env, route, `act_${auth.accountId}/adsets`);
        const created = await mutate('create', {
          auth, context, route,
          path: `act_${auth.accountId}/adsets`,
          payload: adsetPayload(request, auth, policy, campaignId),
        });
        current = {
          id: readText(created.id), name: request.names.adset, status: 'PAUSED',
          daily_budget: String(request.daily_minor), optimization_goal: request.spec.optimization_goal, campaign_id: campaignId,
        };
      }
    }
    const adsetId = normalizeNumericId(current.id, 'adset_id');
    await saveRoute(context.env, route, { adset_id: adsetId, adset_status: readText(current.status).toUpperCase() });
    if (readText(current.name) !== request.names.adset
      || readText(current.campaign_id) !== campaignId
      || readText(current.optimization_goal).toUpperCase() !== request.spec.optimization_goal) {
      throw conflict('objective_route_existing_adset_mismatch');
    }
    if (readText(current.status).toUpperCase() !== 'PAUSED') throw conflict('objective_route_existing_adset_not_paused');
    if (Number(current.daily_budget) !== request.daily_minor) {
      await mutate('budget', { auth, context, route, path: adsetId, payload: { daily_budget: request.daily_minor } });
    }
    return adsetId;
  }

  async function createRouteObjects(route, request, auth, context, policy) {
    try {
      const campaignId = await ensureCampaign(route, request, auth, context);
      const adsetId = await ensureAdset(route, request, auth, context, policy, campaignId);
      // Readback: só vira pendência com os dois níveis lidos como PAUSED.
      const campaign = await readStatus(auth, context, campaignId);
      const adset = await readStatus(auth, context, adsetId);
      const campaignStatus = readText(campaign.status).toUpperCase();
      const adsetStatus = readText(adset.status).toUpperCase();
      await saveRoute(context.env, route, { campaign_status: campaignStatus, adset_status: adsetStatus });
      if (campaignStatus !== 'PAUSED' || adsetStatus !== 'PAUSED') throw conflict('objective_route_created_not_paused');
    } catch (error) {
      const normalized = normalizeFailure(error);
      await journal(context.env, route, 'creation_incomplete', { error: normalized.message, ambiguous: normalized.ambiguous });
      // O registro fica em CREATING: a próxima chamada com a mesma route_key
      // retoma daqui e reaproveita o que já existe na Meta.
      throw failure('objective_route_creation_incomplete', {
        classification: 'transient', retryable: false,
        http_status: normalized.http_status === 409 ? 409 : 502,
        cause_code: normalized.message,
        route_status: 'CREATING',
        ...(error && error.retry_after_seconds ? { retry_after_seconds: error.retry_after_seconds } : {}),
      });
    }
    const now = nowMs(context.env);
    await saveRoute(context.env, route, {
      status: 'PENDING_APPROVAL', pending_at: iso(now), expires_at: iso(now + APPROVAL_TTL_MS),
    });
    await journal(context.env, route, 'pending_approval', { expires_at: route.expires_at });
    return routeSummary(route, { new_request: true });
  }

  async function finalize(env, route, status, outcome, reasons, extra = {}) {
    const now = iso(nowMs(env));
    const decision = { outcome, reasons, ...extra };
    await saveRoute(env, route, {
      status, decision: outcome, decision_json: JSON.stringify(decision), decided_at: now,
    });
    await journal(env, route, `route_${status.toLowerCase()}`, decision);
    return decision;
  }

  // Vencimento é final: pendência fora da validade vira EXPIRED e um registro
  // em CREATING parado há um dia é abandonado.
  async function sweepStale(env, routeKey = null) {
    const now = nowMs(env);
    const rows = await dbAll(env,
      `SELECT * FROM meta_ads_objective_routes
        WHERE status IN ('CREATING', 'PENDING_APPROVAL') ${routeKey ? 'AND route_key = ?' : ''}`,
      ...(routeKey ? [routeKey] : []));
    for (const route of rows) {
      try {
        if (route.status === 'PENDING_APPROVAL' && Date.parse(route.expires_at) + DECISION_GRACE_MS < now) {
          await finalize(env, route, 'EXPIRED', 'BLOCKED', ['approval_expired'], { decided_by: 'expiry' });
        } else if (route.status === 'CREATING' && Date.parse(route.created_at) + CREATING_ABANDON_MS < now) {
          await finalize(env, route, 'BLOCKED', 'BLOCKED', ['creation_abandoned'], { decided_by: 'expiry' });
        }
      } catch (error) {
        // A lista de pendências roda fora da trava: se uma decisão mudou o
        // estado neste meio-tempo, vale a decisão e o vencimento não se aplica.
        if (readText(error && error.message) !== 'objective_route_state_changed') throw error;
      }
    }
  }

  async function ensureRoute(base, body) {
    const request = normalizeRouteRequest(body);
    const env = base.env;
    const policy = await requirePolicy(env, request.unit);
    if (!policy.objectives.includes(request.objective)) throw conflict('objective_route_objective_not_enabled_for_unit');
    if (!policy.targeting) throw conflict('objective_route_targeting_not_configured');
    const calendar = objectiveRouteCalendar(nowMs(env));
    const ceiling = ceilingForMonth(policy, calendar.month_key).ceiling_monthly_brl;
    if (!ceiling) throw conflict('objective_route_ceiling_not_configured');
    // O teto do pedido é só informativo, mas um pedido que parte de um teto
    // maior que o do Vault indica perfil do mês divergente: recusa.
    if (request.ceiling_monthly_brl > ceiling) throw conflict('objective_route_ceiling_above_vault_policy');
    if (request.daily_brl * 31 > ceiling * (1 - BUDGET_MARGIN)) throw conflict('objective_route_daily_budget_above_ceiling');
    const requestHash = await sha256Hex(stableJson({
      route_key: request.route_key, daily_minor: request.daily_minor, campaign: request.names.campaign, adset: request.names.adset,
    }));

    return withUnitLock(env, request.unit, 'ensure', async (lock) => {
      await sweepStale(env, request.route_key);
      const context = graphContext(base, 'ensure_objective_route', lock);
      let route = await latestRoute(env, request.route_key);
      let inherited = {};
      if (route && LIVE_STATUSES.includes(route.status)) {
        if (SPENDING_STATUSES.includes(route.status)) return routeSummary(route);
        if (route.request_hash !== requestHash) throw conflict('objective_route_request_conflict');
        if (route.status === 'PENDING_APPROVAL') return routeSummary(route);
      } else {
        if (route) {
          const availableAt = Date.parse(route.decided_at || route.updated_at) + REREQUEST_COOLDOWN_MS;
          if (availableAt > nowMs(env)) {
            throw conflict('objective_route_cooldown', {
              retry_after_seconds: Math.ceil((availableAt - nowMs(env)) / 1000),
              available_at: iso(availableAt),
              last_status: route.status,
            });
          }
          inherited = { campaign_id: route.campaign_id || null, adset_id: route.adset_id || null };
        }
        route = null;
      }
      const auth = await resolveGraphAuth({ token_id: policy.token_id }, context);
      if (!route) {
        const now = iso(nowMs(env));
        route = {
          id: crypto.randomUUID(),
          route_key: request.route_key,
          unit: request.unit,
          objective: request.objective,
          status: 'CREATING',
          approval_code: await generateApprovalCode(env),
          request_hash: requestHash,
          request_json: JSON.stringify(request.stored),
          token_id: policy.token_id,
          account_id: auth.accountId,
          daily_budget_minor_units: request.daily_minor,
          campaign_name: request.names.campaign,
          adset_name: request.names.adset,
          campaign_id: inherited.campaign_id || null,
          adset_id: inherited.adset_id || null,
          created_at: now,
          updated_at: now,
        };
        const keys = Object.keys(route);
        await dbRun(env,
          `INSERT INTO meta_ads_objective_routes (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          ...keys.map((key) => route[key]));
        await journal(env, route, 'route_requested', { ...request.stored, inherited: Boolean(inherited.campaign_id) });
      } else {
        await journal(env, route, 'creation_resumed', {});
      }
      return createRouteObjects(route, request, auth, context, policy);
    });
  }

  // -------------------------------------------------------------- pendências

  async function cachedSnapshot(env, accountId, calendar, neededAdsetIds) {
    const row = await dbFirst(env,
      `SELECT payload_json, as_of FROM meta_ads_objective_route_snapshots WHERE account_id = ?`, accountId);
    if (!row) return null;
    const snapshot = parseJsonObject(row.payload_json);
    const fresh = nowMs(env) - Date.parse(readText(row.as_of)) <= SNAPSHOT_CACHE_MS;
    const known = new Set(safeList(snapshot.adsets).map((adset) => adset.id));
    const complete = neededAdsetIds.every((id) => known.has(id) && isPlainObject(snapshot.route_ads) && snapshot.route_ads[id]);
    return fresh && complete && snapshot.today === calendar.today ? snapshot : null;
  }

  async function snapshotForList(base, accountId, tokenId, calendar, neededAdsetIds) {
    const cached = await cachedSnapshot(base.env, accountId, calendar, neededAdsetIds);
    if (cached) return cached;
    const context = graphContext(base, 'list_pending_objective_routes');
    const auth = await resolveGraphAuth({ token_id: tokenId }, context);
    const snapshot = await readAccountSnapshot(auth, context, calendar);
    for (const adsetId of neededAdsetIds) snapshot.route_ads[adsetId] = await readAdsetAds(auth, context, adsetId);
    await dbRun(base.env,
      `INSERT INTO meta_ads_objective_route_snapshots (account_id, payload_json, as_of) VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET payload_json = excluded.payload_json, as_of = excluded.as_of`,
      accountId, JSON.stringify(snapshot), snapshot.as_of);
    return snapshot;
  }

  function decisionView(route) {
    const decision = parseJsonObject(route.decision_json);
    return {
      route_key: route.route_key,
      unit: route.unit,
      objective: route.objective,
      approval_code: route.approval_code,
      status: route.status,
      outcome: readText(decision.outcome) || null,
      reasons: safeList(decision.reasons),
      budget: isPlainObject(decision.budget) ? decision.budget : null,
      decided_at: route.decided_at,
      notified_at: route.decision_notified_at || null,
    };
  }

  async function listPending(base) {
    const env = base.env;
    await sweepStale(env);
    const calendar = objectiveRouteCalendar(nowMs(env));
    const rows = await dbAll(env,
      `SELECT * FROM meta_ads_objective_routes WHERE status = 'PENDING_APPROVAL' ORDER BY pending_at, id`);
    const policies = await loadPolicies(env);
    const known = rows.length ? await knownAdsetUnits(env, policies) : new Map();
    const liveRoutes = rows.length ? await liveRouteRows(env) : [];
    const byAccount = new Map();
    for (const route of rows) {
      const entry = byAccount.get(route.account_id) || { token_id: route.token_id, adset_ids: [] };
      entry.adset_ids.push(route.adset_id);
      byAccount.set(route.account_id, entry);
    }
    const snapshots = new Map();
    for (const [accountId, entry] of byAccount) {
      // Sem a leitura da conta a lista inteira falha: uma pendência sem gasto
      // do mês faria o workflow bloquear, de forma final, uma aprovação válida.
      snapshots.set(accountId, await snapshotForList(base, accountId, entry.token_id, calendar, entry.adset_ids));
    }
    const lastDecisions = await dbAll(env,
      `SELECT route_key, MAX(decided_at) AS decided_at FROM meta_ads_objective_routes
        WHERE decided_at IS NOT NULL GROUP BY route_key`);
    const lastDecisionAt = new Map(lastDecisions.map((row) => [row.route_key, row.decided_at]));

    const pending = [];
    for (const route of rows) {
      const snapshot = snapshots.get(route.account_id);
      const policy = policies.find((entry) => entry.unit === route.unit);
      if (!policy) continue;
      const adset = snapshot.adsets.find((entry) => entry.id === route.adset_id) || {};
      const ads = snapshot.route_ads[route.adset_id] || { used: null, paused_ad_ids: [], complete: false };
      const state = unitBudgetState({ snapshot, unit: route.unit, known, policy, calendar, liveRoutes, excludeAdsetId: route.adset_id });
      const usable = state.invalid.length === 0;
      pending.push({
        route_key: route.route_key,
        unit: route.unit,
        objective: route.objective,
        approval_code: route.approval_code,
        status: route.status,
        created_at: route.pending_at,
        expires_at: route.expires_at,
        last_decision_at: lastDecisionAt.get(route.route_key) || null,
        notified_at: route.request_notified_at || null,
        daily_budget_brl: minorToBrl(route.daily_budget_minor_units),
        campaign_status: adset.campaign_status || null,
        adset_status: adset.status || null,
        ad_ids: ads.paused_ad_ids,
        capacity: { used: ads.complete ? ads.used : null, limit: AD_SET_AD_LIMIT },
        budget_state: {
          ceiling_monthly_brl: state.ceiling_monthly_brl,
          // Com entrada inválida os números não são devolvidos: o workflow
          // trata a ausência como `budget_inputs_invalid`.
          spend_mtd_brl: usable ? state.spend_mtd_brl : null,
          committed_daily_brl: usable ? state.committed_daily_brl : null,
          committed_next_daily_brl: usable ? state.committed_next_daily_brl : null,
          days_remaining: state.days_remaining,
          as_of: state.as_of,
          next_ceiling_monthly_brl: state.next_ceiling_monthly_brl,
          days_next_month: state.days_next_month,
          month_profile: state.month_profile,
          invalid: state.invalid,
        },
      });
    }
    const decided = await dbAll(env,
      `SELECT * FROM meta_ads_objective_routes
        WHERE decided_at IS NOT NULL AND decision_notified_at IS NULL AND decided_at >= ?
        ORDER BY decided_at, id`,
      iso(nowMs(env) - UNNOTIFIED_DECISION_WINDOW_MS));
    const inProgress = await dbAll(env,
      `SELECT * FROM meta_ads_objective_routes WHERE status IN ('ACTIVATING', 'PAUSE_PENDING') ORDER BY updated_at, id`);
    let monitor = [];
    try {
      monitor = await dbAll(env,
        `SELECT unit, last_run_at, last_ok_at, last_reason, consecutive_failures
           FROM meta_ads_objective_route_monitor ORDER BY unit`);
    } catch {
      // Sem a tabela a lista segue sem a saúde do monitor.
    }
    return {
      ok: true,
      pending,
      // Decisões que o operador ainda não recebeu (inclui as pausas do monitor
      // e as ativações cuja resposta se perdeu num timeout).
      unnotified_decisions: decided.map(decisionView),
      // Rotas aprovadas que ainda não fecharam: ativação interrompida
      // (ACTIVATING) ou pausa sem confirmação (PAUSE_PENDING). Não são
      // pendências de aprovação; o monitor as resolve e a decisão final aparece
      // em `unnotified_decisions`.
      in_progress: inProgress.map((route) => ({
        route_key: route.route_key,
        unit: route.unit,
        objective: route.objective,
        approval_code: route.approval_code,
        status: route.status,
        since: route.status === 'ACTIVATING' ? (route.activating_at || route.updated_at) : route.updated_at,
        reasons: decisionView(route).reasons,
        campaign_status: route.campaign_status || null,
        adset_status: route.adset_status || null,
      })),
      // Última rodada do monitor por unidade. `consecutive_failures` maior que
      // zero significa que as rotas ativas estão sem conferência de teto.
      monitor: monitor.map((row) => ({
        unit: readText(row.unit),
        last_run_at: row.last_run_at || null,
        last_ok_at: row.last_ok_at || null,
        last_reason: readText(row.last_reason),
        consecutive_failures: Number(row.consecutive_failures) || 0,
      })),
      as_of: iso(nowMs(env)),
    };
  }

  async function ackNotification(base, body) {
    const routeKey = readText(body.route_key);
    const code = readText(body.approval_code);
    const kind = readText(body.kind);
    if (!ROUTE_KEY_PATTERN.test(routeKey) || !APPROVAL_CODE_PATTERN.test(code) || !['request', 'decision'].includes(kind)) {
      throw reject('objective_route_ack_invalid');
    }
    const route = await dbFirst(base.env,
      `SELECT * FROM meta_ads_objective_routes WHERE route_key = ? AND approval_code = ? ORDER BY created_at DESC LIMIT 1`,
      routeKey, code);
    if (!route) throw reject('objective_route_not_found', 404);
    const column = kind === 'request' ? 'request_notified_at' : 'decision_notified_at';
    if (kind === 'decision' && !route.decided_at) throw conflict('objective_route_not_decided');
    if (route[column]) return { ok: true, route_key: routeKey, approval_code: code, kind, acknowledged: false, notified_at: route[column] };
    const now = iso(nowMs(base.env));
    await saveRoute(base.env, route, { [column]: now });
    await journal(base.env, route, `${kind}_notified`, {});
    return { ok: true, route_key: routeKey, approval_code: code, kind, acknowledged: true, notified_at: now };
  }

  // ---------------------------------------------------------------- decisão

  function decisionResponse(route, outcome, newDecision, reasons, budget, extra = {}) {
    return {
      ok: true,
      route_key: route.route_key,
      approval_code: route.approval_code,
      outcome,
      new_decision: newDecision,
      reasons,
      budget: budget || null,
      ...extra,
    };
  }

  function budgetView(check, state) {
    return {
      projected_brl: check.projected_brl,
      ceiling_monthly_brl: state.ceiling_monthly_brl,
      limit_brl: check.limit_brl,
      next_month_projected_brl: check.next_month_projected_brl,
      next_month_limit_brl: check.next_month_limit_brl,
      spend_mtd_brl: state.spend_mtd_brl,
      committed_daily_brl: state.committed_daily_brl,
      committed_next_daily_brl: state.committed_next_daily_brl,
      days_remaining: state.days_remaining,
      as_of: state.as_of,
    };
  }

  // Relê tudo na Graph e refaz a conta do teto. Não usa cache nem nada que o
  // chamador tenha enviado.
  async function evaluateActivation(route, auth, context, { resuming }) {
    const env = context.env;
    const calendar = objectiveRouteCalendar(nowMs(env));
    const policy = await requirePolicy(env, route.unit);
    const reasons = [];
    const campaign = await readStatus(auth, context, route.campaign_id);
    const adset = await readStatus(auth, context, route.adset_id, ',daily_budget,campaign_id');
    const campaignStatus = readText(campaign.status).toUpperCase();
    const adsetStatus = readText(adset.status).toUpperCase();
    await saveRoute(env, route, { campaign_status: campaignStatus, adset_status: adsetStatus });
    const allowedStates = resuming ? ['PAUSED', 'ACTIVE'] : ['PAUSED'];
    if (!allowedStates.includes(campaignStatus) || !allowedStates.includes(adsetStatus)
      || readText(adset.campaign_id) !== route.campaign_id) {
      reasons.push('route_not_paused');
    }
    // O diário que conta é o que está na Meta agora, não o do pedido.
    const liveDailyMinor = Number(adset.daily_budget);
    if (!Number.isSafeInteger(liveDailyMinor) || liveDailyMinor <= 0 || liveDailyMinor !== Number(route.daily_budget_minor_units)) {
      reasons.push('adset_budget_changed');
    }
    const ads = await readAdsetAds(auth, context, route.adset_id);
    if (!ads.complete || ads.used > AD_SET_AD_LIMIT) reasons.push('adset_ad_limit');

    const snapshot = await readAccountSnapshot(auth, context, calendar);
    const policies = await loadPolicies(env);
    const state = unitBudgetState({
      snapshot, unit: route.unit, policy, calendar,
      known: await knownAdsetUnits(env, policies),
      liveRoutes: (await liveRouteRows(env)).filter((row) => row.id !== route.id),
      excludeAdsetId: route.adset_id,
    });
    const check = state.invalid.length
      ? objectiveRouteBudgetCheck({})
      : objectiveRouteBudgetCheck({ ...state, new_daily_brl: minorToBrl(route.daily_budget_minor_units) });
    if (!check.ok) reasons.push(check.reason);
    return { reasons, budget: budgetView(check, state), ads, invalid: state.invalid };
  }

  // Estado de um objeto que não gasta mais, conferido por leitura. Vazio quando
  // a leitura não confirma (ainda ACTIVE, ou não deu para ler).
  async function readStoppedStatus(auth, context, objectId) {
    try {
      const status = readText((await readStatus(auth, context, objectId)).status).toUpperCase();
      return { status: STOPPED_OBJECT_STATUSES.includes(status) ? status : '', missing: false };
    } catch (error) {
      const normalized = normalizeFailure(error);
      return { status: '', missing: normalized.classification === 'permanent' && !normalized.ambiguous };
    }
  }

  // Pausa conjunto e campanha e só dá a rota por parada com leitura na Graph:
  // a resposta do POST não basta. O conjunto parado já basta para não gastar;
  // a campanha é pausada junto e o estado lido fica no registro.
  async function pauseAndConfirm(route, auth, context) {
    const statuses = {};
    let stopped = false;
    let adsetMissing = false;
    // Conjunto antes da campanha: o que gasta para primeiro.
    for (const [column, objectId] of [['adset_status', route.adset_id], ['campaign_status', route.campaign_id]]) {
      if (!objectId) continue;
      try {
        await mutate('pause', { auth, context, route, path: objectId, payload: { status: 'PAUSED' } });
      } catch {
        // Quem decide é a leitura abaixo.
      }
      const read = await readStoppedStatus(auth, context, objectId);
      if (read.status) {
        statuses[column] = read.status;
        stopped = true;
      } else if (column === 'adset_status') {
        adsetMissing = read.missing;
      }
    }
    if (!stopped && adsetMissing) {
      // Conjunto que a Graph diz não existir: só vale como parado se a listagem
      // completa da conta também não o mostra ativo (apagado no Gerenciador).
      try {
        const list = await listAll(auth, context, `act_${auth.accountId}/adsets`, { fields: 'id,status', limit: String(ADSET_PAGE_LIMIT) });
        const row = list.rows.filter(isPlainObject).find((entry) => readText(entry.id) === route.adset_id);
        const listed = readText(row && row.status).toUpperCase();
        if (list.complete && (!row || STOPPED_OBJECT_STATUSES.includes(listed))) {
          statuses.adset_status = row ? listed : 'DELETED';
          stopped = true;
        }
      } catch {
        // Sem a listagem a pausa segue sem confirmação.
      }
    }
    return { confirmed: stopped, statuses };
  }

  // Fecha uma rota que pode estar gastando. Com a pausa confirmada grava o
  // estado final; sem confirmação a rota fica em PAUSE_PENDING (ainda conta no
  // comprometido) e o monitor repete a pausa até conseguir ler PAUSED.
  async function stopRoute(route, auth, context, final) {
    const env = context.env;
    const stop = await pauseAndConfirm(route, auth, context);
    if (stop.confirmed) {
      // Uma rota já avisada como ativada precisa de aviso novo ao ser fechada.
      await saveRoute(env, route, { ...stop.statuses, decision_notified_at: null });
      await finalize(env, route, final.status, final.outcome, final.reasons, final.extra);
      return { confirmed: true, reasons: final.reasons };
    }
    const reasons = [...final.reasons, 'pause_after_failure_unconfirmed'];
    if (route.status !== 'PAUSE_PENDING') {
      await saveRoute(env, route, {
        status: 'PAUSE_PENDING',
        decision: final.outcome,
        decision_json: JSON.stringify({ outcome: final.outcome, reasons, ...final.extra, pending_final: final }),
      });
      await journal(env, route, 'route_pause_pending', { outcome: final.outcome, reasons });
    }
    return { confirmed: false, reasons };
  }

  function pendingFinal(route) {
    const stored = parseJsonObject(route.decision_json).pending_final;
    const valid = isPlainObject(stored) && FINAL_STATUSES.includes(stored.status)
      && ['BLOCKED', 'PAUSED_BY_MONITOR'].includes(stored.outcome) && Array.isArray(stored.reasons);
    return valid
      ? { status: stored.status, outcome: stored.outcome, reasons: stored.reasons.map(readText), extra: isPlainObject(stored.extra) ? stored.extra : {} }
      : { status: 'BLOCKED', outcome: 'BLOCKED', reasons: ['activation_failed'], extra: { decided_by: 'monitor' } };
  }

  async function activate(route, auth, context, evaluation) {
    const env = context.env;
    const grant = { route_id: route.id, budget_ok: true, checked_at_ms: nowMs(env) };
    try {
      // Ordem do contrato: campanha → conjunto → anúncios pausados.
      await mutate('activate', { auth, context, route, grant, path: route.campaign_id, payload: { status: 'ACTIVE' } });
      await mutate('activate', { auth, context, route, grant, path: route.adset_id, payload: { status: 'ACTIVE' } });
      for (const adId of evaluation.ads.paused_ad_ids) {
        await mutate('activate', { auth, context, route, grant, path: adId, payload: { status: 'ACTIVE' } });
      }
      const campaign = await readStatus(auth, context, route.campaign_id);
      const adset = await readStatus(auth, context, route.adset_id);
      const campaignStatus = readText(campaign.status).toUpperCase();
      const adsetStatus = readText(adset.status).toUpperCase();
      await saveRoute(env, route, { campaign_status: campaignStatus, adset_status: adsetStatus });
      if (campaignStatus !== 'ACTIVE' || adsetStatus !== 'ACTIVE') {
        throw failure('objective_route_activation_readback_mismatch', { classification: 'transient', ambiguous: true, http_status: 502 });
      }
    } catch (error) {
      const normalized = normalizeFailure(error);
      if (normalized.ambiguous || normalized.classification === 'transient') {
        // Fica em ACTIVATING (já conta no comprometido). O monitor retoma em
        // até ACTIVATION_RESUME_AFTER_MS + um ciclo: confere o teto de novo e
        // termina a ativação, ou pausa tudo.
        await journal(env, route, 'activation_incomplete', { error: normalized.message });
        throw failure('objective_route_activation_incomplete', {
          classification: 'transient', retryable: false, http_status: 502, cause_code: normalized.message,
          route_status: 'ACTIVATING',
        });
      }
      const stop = await stopRoute(route, auth, context, {
        status: 'BLOCKED', outcome: 'BLOCKED', reasons: ['activation_failed'],
        extra: { budget: evaluation.budget, decided_by: 'operator_reply' },
      });
      return decisionResponse(route, 'BLOCKED', true, stop.reasons, evaluation.budget, { route_status: route.status });
    }
    await finalize(env, route, 'ACTIVATED', 'ACTIVATED', [], { budget: evaluation.budget, decided_by: 'operator_reply' });
    return decisionResponse(route, 'ACTIVATED', true, [], evaluation.budget);
  }

  // Retomada de uma ativação interrompida (pela rodada seguinte do workflow ou
  // pelo monitor). Vale a aprovação já registrada, com o teto conferido de
  // novo; `giveUp` desiste sem conferir e só pausa.
  async function resumeActivation(route, auth, context, { giveUp = false, decidedBy = 'operator_reply' } = {}) {
    const evaluation = giveUp ? null : await evaluateActivation(route, auth, context, { resuming: true });
    const reasons = giveUp ? ['activation_incomplete'] : evaluation.reasons;
    const budget = evaluation ? evaluation.budget : null;
    if (reasons.length) {
      const stop = await stopRoute(route, auth, context, {
        status: 'BLOCKED', outcome: 'BLOCKED', reasons, extra: { budget, decided_by: decidedBy },
      });
      return decisionResponse(route, 'BLOCKED', true, stop.reasons, budget, { route_status: route.status });
    }
    await journal(context.env, route, 'activation_resumed', { by: decidedBy });
    return activate(route, auth, context, evaluation);
  }

  function normalizeDecision(body) {
    if (readText(body.action) !== 'decide_objective_route') throw reject('invalid_action');
    const routeKey = readText(body.route_key);
    const match = ROUTE_KEY_PATTERN.exec(routeKey);
    const code = readText(body.approval_code);
    const decision = readText(body.decision);
    const replyId = readText(body.reply_message_id);
    const replyTs = Number(body.reply_ts);
    if (!match || !APPROVAL_CODE_PATTERN.test(code)) throw reject('objective_route_decision_invalid', 400, { field: 'route_key' });
    if (!['APPROVE', 'REJECT', 'BLOCK'].includes(decision)) throw reject('objective_route_decision_invalid', 400, { field: 'decision' });
    if (!REPLY_MESSAGE_ID_PATTERN.test(replyId)) throw reject('objective_route_decision_invalid', 400, { field: 'reply_message_id' });
    if (!Number.isFinite(replyTs) || replyTs <= 0) throw reject('objective_route_decision_invalid', 400, { field: 'reply_ts' });
    // Os motivos locais só entram no registro de um BLOCK; nunca liberam nada.
    const localReasons = safeList(isPlainObject(body.local_checks) ? body.local_checks.checks : [])
      .map(readText).filter((reason) => REASON_PATTERN.test(reason)).slice(0, 10);
    return { route_key: routeKey, unit: match[1], approval_code: code, decision, reply_message_id: replyId, reply_ms: Math.round(replyTs * 1000), local_reasons: localReasons };
  }

  async function decideRoute(base, body) {
    const input = normalizeDecision(body);
    const env = base.env;
    return withUnitLock(env, input.unit, 'decide', async (lock) => {
      const route = await dbFirst(env,
        `SELECT * FROM meta_ads_objective_routes WHERE route_key = ? AND approval_code = ? ORDER BY created_at DESC LIMIT 1`,
        input.route_key, input.approval_code);
      if (!route) throw reject('objective_route_not_found', 404);
      if (route.status === 'CREATING') throw conflict('objective_route_not_pending');
      if (FINAL_STATUSES.includes(route.status) || route.status === 'ACTIVATED') {
        const view = decisionView(route);
        return decisionResponse(route, 'ALREADY_DECIDED', false, view.reasons, view.budget, {
          decided_outcome: view.outcome, decided_at: view.decided_at, notified_at: view.notified_at,
        });
      }
      const context = graphContext(base, 'decide_objective_route', lock);
      const now = nowMs(env);

      if (route.status === 'PAUSE_PENDING') {
        // Já decidida como bloqueio; falta só o monitor confirmar a pausa.
        const view = decisionView(route);
        return decisionResponse(route, 'ALREADY_DECIDED', false, view.reasons, view.budget, {
          decided_outcome: view.outcome, decided_at: null, notified_at: null, route_status: route.status,
        });
      }
      if (route.status === 'ACTIVATING') {
        // O pedido atual não muda nada: vale a aprovação já registrada.
        const auth = await resolveGraphAuth({ token_id: route.token_id }, context);
        return resumeActivation(route, auth, context);
      }

      const pendingAt = Date.parse(route.pending_at);
      const expiresAt = Date.parse(route.expires_at);
      if (input.reply_ms < pendingAt || input.reply_ms > now + REPLY_CLOCK_SKEW_MS) {
        throw reject('objective_route_reply_outside_validity', 409);
      }
      if (input.reply_ms > expiresAt || now > expiresAt + DECISION_GRACE_MS) {
        const decision = await finalize(env, route, 'EXPIRED', 'BLOCKED', ['approval_expired'], { decided_by: 'expiry' });
        return decisionResponse(route, 'BLOCKED', true, decision.reasons, null);
      }
      const used = await dbFirst(env,
        `SELECT id FROM meta_ads_objective_routes WHERE reply_message_id = ? AND id <> ?`, input.reply_message_id, route.id);
      if (used) throw conflict('objective_route_reply_already_used');
      const reply = { reply_message_id: input.reply_message_id, reply_ts: Math.round(input.reply_ms / 1000) };

      if (input.decision === 'REJECT') {
        await saveRoute(env, route, reply);
        await finalize(env, route, 'REJECTED', 'REJECTED', [], { decided_by: 'operator_reply' });
        return decisionResponse(route, 'REJECTED', true, [], null);
      }
      if (input.decision === 'BLOCK') {
        const reasons = input.local_reasons.length ? input.local_reasons : ['blocked_by_workflow'];
        await saveRoute(env, route, reply);
        await finalize(env, route, 'BLOCKED', 'BLOCKED', reasons, { decided_by: 'workflow_local_checks' });
        return decisionResponse(route, 'BLOCKED', true, reasons, null);
      }

      // APPROVE: daqui em diante só vale o que o Vault lê e calcula.
      const auth = await resolveGraphAuth({ token_id: route.token_id }, context);
      let evaluation;
      try {
        evaluation = await evaluateActivation(route, auth, context, { resuming: false });
      } catch (error) {
        const normalized = normalizeFailure(error);
        await journal(env, route, 'activation_inputs_unavailable', { error: normalized.message });
        // Leitura que falhou não é decisão: nada muda e a próxima rodada tenta.
        throw unavailable('objective_route_budget_inputs_unavailable', { cause_code: normalized.message });
      }
      if (evaluation.reasons.length) {
        await saveRoute(env, route, reply);
        await finalize(env, route, 'BLOCKED', 'BLOCKED', evaluation.reasons, {
          budget: evaluation.budget, invalid: evaluation.invalid, decided_by: 'operator_reply',
        });
        return decisionResponse(route, 'BLOCKED', true, evaluation.reasons, evaluation.budget);
      }
      await saveRoute(env, route, {
        ...reply, status: 'ACTIVATING', activating_at: iso(now), decision_json: JSON.stringify({ budget: evaluation.budget }),
      });
      await journal(env, route, 'activation_approved', { budget: evaluation.budget });
      return activate(route, auth, context, evaluation);
    });
  }

  // ---------------------------------------------------------------- monitor

  async function recordMonitorHealth(env, unit, ok, reason) {
    const now = iso(nowMs(env));
    try {
      await dbRun(env,
        `INSERT INTO meta_ads_objective_route_monitor (unit, last_run_at, last_ok_at, last_reason, consecutive_failures)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(unit) DO UPDATE SET
           last_run_at = excluded.last_run_at,
           last_ok_at = COALESCE(excluded.last_ok_at, meta_ads_objective_route_monitor.last_ok_at),
           last_reason = excluded.last_reason,
           consecutive_failures = CASE WHEN excluded.consecutive_failures = 0 THEN 0
             ELSE meta_ads_objective_route_monitor.consecutive_failures + 1 END`,
        unit, now, ok ? now : null, readText(reason).slice(0, 120), ok ? 0 : 1);
    } catch {
      // A saúde do monitor é só informativa.
    }
  }

  // Passo do monitor contínuo, por unidade com rota que pode estar gastando
  // (ACTIVATING, ACTIVATED ou PAUSE_PENDING):
  // 1. repete a pausa das rotas fechadas sem confirmação (PAUSE_PENDING);
  // 2. retoma, ou pausa, as ativações interrompidas (ACTIVATING parada);
  // 3. confere o teto: o que foi conferido na ativação não cobre o gasto real
  //    depois dela. Quando a projeção do mês passa do teto com a margem, as
  //    rotas objroute_v1 da unidade são pausadas (conjunto e campanha).
  async function runMonitor(base) {
    const env = base.env;
    if (objectiveRoutesMode(env) !== 'on') return { ok: true, mode: 'off', units: [] };
    const calendar = objectiveRouteCalendar(nowMs(env));
    const policies = await loadPolicies(env);
    const spending = await dbAll(env,
      `SELECT * FROM meta_ads_objective_routes WHERE status IN (${SPENDING_STATUSES_SQL}) ORDER BY unit, id`);
    const units = [];
    for (const unit of UNITS) {
      const routes = spending.filter((route) => route.unit === unit);
      if (!routes.length) continue;
      const policy = policies.find((entry) => entry.unit === unit);
      const report = { unit, action: 'none', reason: 'within_ceiling', paused_route_keys: [], recovered: [], unresolved_route_keys: [] };
      units.push(report);
      try {
        await withUnitLock(env, unit, 'monitor', async (lock) => {
          const context = graphContext(base, 'monitor_objective_routes', lock);
          const auth = await resolveGraphAuth({ token_id: routes[0].token_id }, context);

          for (const route of routes) {
            const stalled = route.status === 'ACTIVATING'
              ? nowMs(env) - Date.parse(readText(route.activating_at || route.updated_at)) : 0;
            if (route.status !== 'PAUSE_PENDING' && !(stalled > ACTIVATION_RESUME_AFTER_MS)) continue;
            try {
              if (route.status === 'PAUSE_PENDING') await stopRoute(route, auth, context, pendingFinal(route));
              else await resumeActivation(route, auth, context, { giveUp: stalled > ACTIVATION_GIVE_UP_MS, decidedBy: 'monitor' });
              if (!['ACTIVATING', 'PAUSE_PENDING'].includes(route.status)) {
                report.recovered.push({ route_key: route.route_key, status: route.status });
              }
            } catch (error) {
              // Fica como está e a próxima rodada tenta de novo.
              await journal(env, route, 'monitor_recovery_failed', { status: route.status, error: normalizeFailure(error).message });
            }
            if (['ACTIVATING', 'PAUSE_PENDING'].includes(route.status)) report.unresolved_route_keys.push(route.route_key);
          }

          const watched = routes.filter((route) => ['ACTIVATING', 'ACTIVATED'].includes(route.status));
          if (!watched.length) return;
          const snapshot = await readAccountSnapshot(auth, context, calendar);
          const state = policy
            ? unitBudgetState({ snapshot, unit, policy, calendar, known: await knownAdsetUnits(env, policies), liveRoutes: await liveRouteRows(env) })
            : { invalid: ['policy_missing'] };
          if (state.invalid.length) {
            // Sem conseguir medir, o monitor não pausa por conta própria: a
            // falha fica no journal, no relatório do passo e na saúde do monitor.
            report.action = 'skipped';
            report.reason = 'budget_inputs_invalid';
            report.invalid = state.invalid;
            for (const route of watched) await journal(env, route, 'monitor_inputs_invalid', { invalid: state.invalid });
            return;
          }
          const projected = roundBrl(state.spend_mtd_brl + state.committed_daily_brl * state.days_remaining);
          const limit = roundBrl(state.ceiling_monthly_brl * (1 - BUDGET_MARGIN));
          report.projected_brl = projected;
          report.limit_brl = limit;
          if (projected <= limit) return;
          report.action = 'paused';
          report.reason = 'monitor_ceiling_exceeded';
          for (const route of watched) {
            const stop = await stopRoute(route, auth, context, {
              status: 'PAUSED_BY_MONITOR', outcome: 'PAUSED_BY_MONITOR', reasons: ['monitor_ceiling_exceeded'],
              extra: {
                budget: { projected_brl: projected, ceiling_monthly_brl: state.ceiling_monthly_brl, limit_brl: limit, as_of: state.as_of },
                decided_by: 'monitor',
              },
            });
            if (stop.confirmed) {
              report.paused_route_keys.push(route.route_key);
            } else {
              report.action = 'pause_incomplete';
              report.unresolved_route_keys.push(route.route_key);
              await journal(env, route, 'monitor_pause_incomplete', { projected_brl: projected, limit_brl: limit });
            }
          }
        });
      } catch (error) {
        const normalized = normalizeFailure(error);
        report.action = 'skipped';
        report.reason = normalized.message;
        for (const route of routes) {
          try { await journal(env, route, 'monitor_failed', { error: normalized.message }); } catch { /* journal indisponível */ }
        }
      }
      report.unresolved_route_keys = [...new Set(report.unresolved_route_keys)];
      const healthy = report.action !== 'skipped' && report.action !== 'pause_incomplete' && !report.unresolved_route_keys.length;
      await recordMonitorHealth(env, unit, healthy, healthy ? 'ok' : (report.action === 'none' ? 'route_unresolved' : report.reason));
    }
    return { ok: true, mode: 'on', as_of: iso(nowMs(env)), units };
  }

  // ---------------------------------------------- capacidade e placement_checks

  // Só anuncia a capacidade com o interruptor ligado e a migration aplicada.
  async function capabilities(env) {
    if (objectiveRoutesMode(env) !== 'on') return null;
    try {
      await dbFirst(env, `SELECT unit FROM meta_ads_objective_route_policies LIMIT 1`);
      await dbFirst(env, `SELECT id FROM meta_ads_objective_routes LIMIT 1`);
    } catch {
      return null;
    }
    return {
      objective_route_actions: [...OBJECTIVE_ROUTE_ACTIONS],
      objective_routes: {
        revision: META_ADS_OBJECTIVE_ROUTES_REVISION,
        notification_actions: [...OBJECTIVE_ROUTE_NOTIFICATION_ACTIONS],
        objectives: Object.keys(OBJECTIVE_CATALOG).filter((key) => OBJECTIVE_CATALOG[key].creatable),
        approval_ttl_hours: APPROVAL_TTL_MS / 3600_000,
        rerequest_cooldown_days: REREQUEST_COOLDOWN_MS / 86_400_000,
        budget_margin: BUDGET_MARGIN,
        ad_set_ad_limit: AD_SET_AD_LIMIT,
      },
    };
  }

  // Origem da rota nos placement_checks do inventário: o `enforce` do workflow
  // só aceita um conjunto novo com `objective_route_outcome: 'ACTIVATED'`.
  // Só anota os conjuntos que o chamador listou; nunca acrescenta entradas (um
  // conjunto de tráfego ou vídeo não passa no preflight de WhatsApp do Publish
  // e uma entrada a mais bloquearia o lote inteiro).
  async function annotatePlacementChecks(env, checks) {
    if (objectiveRoutesMode(env) !== 'on' || !Array.isArray(checks) || !checks.length) return checks;
    try {
      const rows = await dbAll(env,
        `SELECT route_key, adset_id, campaign_id, status FROM meta_ads_objective_routes
          WHERE adset_id IS NOT NULL ORDER BY created_at`);
      const byAdset = new Map(rows.map((row) => [readText(row.adset_id), row]));
      for (const check of checks) {
        const row = byAdset.get(readText(check && check.adset_id));
        if (!row) continue;
        check.objective_route_key = row.route_key;
        check.objective_route_outcome = row.status;
        check.objective_route_campaign_id = row.campaign_id;
      }
    } catch {
      // Sem a tabela o inventário segue como antes, sem a origem da rota.
    }
    return checks;
  }

  // ------------------------------------------------------------------- HTTP

  function errorResponse(error, requestId) {
    const normalized = normalizeFailure(error);
    const classified = error && typeof error === 'object' && error.classification;
    const detail = {};
    for (const key of ['field', 'retry_after_seconds', 'available_at', 'last_status', 'cause_code', 'route_status']) {
      if (classified && error[key] !== undefined) detail[key] = error[key];
    }
    return response({
      ok: false,
      error: classified ? normalized.message : 'objective_route_failed',
      detail,
      requestId,
    }, classified ? normalized.http_status || 502 : 500);
  }

  async function handle(input) {
    const { request, env, requestId, pathname, role, decryptToken, writeAudit } = input;
    const base = { request, env, decryptToken };
    const sub = pathname.slice(OBJECTIVE_ROUTES_PREFIX.length);
    const audit = async (event, status, metadata) => {
      if (typeof writeAudit !== 'function') return;
      try { await writeAudit(env, { event, status, requestId, metadata }); } catch { /* auditoria não derruba a rota */ }
    };
    try {
      if (sub === '/policy') {
        if (role !== 'admin') return response({ ok: false, error: 'admin_credential_required', requestId }, 403);
        if (request.method === 'GET') return response({ ok: true, mode: objectiveRoutesMode(env), policies: await loadPolicies(env), requestId });
        if (request.method === 'PUT') {
          const result = await putPolicy(base);
          await audit('meta_ads_objective_routes.policy', 'ok', { unit: result.unit, enabled: result.enabled });
          return response({ ...result, requestId });
        }
      }
      if (request.method !== 'POST' || !['/requests', '/pending', '/decisions', '/monitor'].includes(sub)) {
        return response({ ok: false, error: 'meta_ads_objective_routes_not_found', requestId }, 404);
      }
      // Interruptor desligado: nenhuma rota lê ou muda nada.
      if (objectiveRoutesMode(env) !== 'on') return response({ ok: false, error: 'objective_routes_disabled', requestId }, 409);
      let body;
      try { body = await request.json(); } catch { body = null; }
      if (!isPlainObject(body)) throw reject('objective_route_body_invalid');
      const action = readText(body.action);
      let result;
      if (sub === '/requests') result = await ensureRoute(base, body);
      else if (sub === '/decisions') result = await decideRoute(base, body);
      else if (sub === '/monitor') {
        if (action !== 'monitor_objective_routes') throw reject('invalid_action');
        result = await runMonitor(base);
      } else if (action === 'list_pending_objective_routes') result = await listPending(base);
      else if (action === 'ack_objective_route_notification') result = await ackNotification(base, body);
      else throw reject('invalid_action');
      if (sub !== '/pending' || action !== 'list_pending_objective_routes') {
        await audit(`meta_ads_objective_routes.${action}`, 'ok', {
          route_key: readText(result.route_key || body.route_key), status: readText(result.status), outcome: readText(result.outcome),
        });
      }
      return response({ ...result, requestId });
    } catch (error) {
      const normalized = normalizeFailure(error);
      await audit('meta_ads_objective_routes.request', 'failed', { path: sub, error: normalized.message });
      return errorResponse(error, requestId);
    }
  }

  return Object.freeze({ handle, runMonitor, capabilities, annotatePlacementChecks });
}

// Nomes únicos no bundle, só para testes.
export const metaAdsObjectiveRoutesInternals = Object.freeze({
  catalog: OBJECTIVE_CATALOG,
  approvalCodePattern: APPROVAL_CODE_PATTERN,
  approvalCodeAlphabet: APPROVAL_CODE_ALPHABET,
  unitLockOwner: UNIT_LOCK_OWNER,
  budgetMargin: BUDGET_MARGIN,
  adSetAdLimit: AD_SET_AD_LIMIT,
  approvalTtlMs: APPROVAL_TTL_MS,
  decisionGraceMs: DECISION_GRACE_MS,
  rerequestCooldownMs: REREQUEST_COOLDOWN_MS,
  activationResumeAfterMs: ACTIVATION_RESUME_AFTER_MS,
  activationGiveUpMs: ACTIVATION_GIVE_UP_MS,
  createUnconfirmedWindowMs: CREATE_UNCONFIRMED_WINDOW_MS,
  unitLockTtlMs: UNIT_LOCK_TTL_MS,
});
