// Leituras históricas do Meta Ads (somente Graph GET).
//
// Este módulo é deliberadamente separado de meta-ads-publish.js e recebe as
// primitivas do gateway por injeção (autenticação, allowlist de conta, rate
// usage, journal, acesso ao D1). Ele não importa nada do gateway, não conhece
// tokens e não altera o contrato do workflow (WORKFLOW_CONTRACT_REVISION): as
// leituras são anunciadas numa chave nova e independente de capacidades.
//
// Regras fixas:
// - toda chamada usa o método GET e parte da conta configurada no perfil do
//   token (`act_<conta>/...`), ou confere o `account_id` do objeto lido;
// - campos, níveis, períodos, breakdowns e status são allowlists fechadas;
//   nada demográfico ou por pessoa (idade, gênero, região, país, DMA);
// - cada operação lê no máximo UMA página da Graph; o chamador pagina com o
//   cursor opaco devolvido (`paging.after`). URLs de paginação da Graph, que
//   podem carregar credenciais, nunca saem do Worker;
// - cada operação faz no máximo UMA chamada à Graph (sem retry no gateway):
//   uma consulta histórica pesada que estoura o tempo não é repetida;
// - a leitura é recusada, antes de chamar a Graph, enquanto houver publicação
//   recente na conta (lease do limitador de mutações) ou enquanto o uso de
//   cota medido na última leitura estiver em 80% ou mais (guarda de leitura);
// - uma falha de leitura nunca é ambígua: não há efeito externo a reconciliar,
//   então ela não pode levar o run a `reconciliation_required`.

export const META_ADS_READ_REVISION = 'meta_ads_read_v1';

export const META_ADS_READ_NEW_ACTIONS = Object.freeze(['get_insights']);

const INSIGHTS_LEVELS = Object.freeze(['account', 'campaign', 'adset', 'ad']);
const INSIGHTS_PERIODS = Object.freeze(['lifetime', 'monthly']);
// Apenas veiculação/posicionamento. Idade, gênero, país, região, DMA e
// qualquer recorte por pessoa ficam fora de propósito.
const INSIGHTS_BREAKDOWNS = Object.freeze([
  'publisher_platform',
  'platform_position',
  'impression_device',
  'device_platform',
]);
const INSIGHTS_METRIC_FIELDS = Object.freeze([
  'spend',
  'impressions',
  'reach',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'frequency',
  'inline_link_clicks',
  'actions',
  'cost_per_action_type',
]);
const INSIGHTS_IDENTITY_FIELDS = Object.freeze({
  account: ['account_id'],
  campaign: ['account_id', 'campaign_id', 'campaign_name', 'objective'],
  adset: ['account_id', 'campaign_id', 'adset_id', 'adset_name'],
  ad: ['account_id', 'campaign_id', 'adset_id', 'ad_id', 'ad_name'],
});
const INSIGHTS_NUMERIC_FIELDS = Object.freeze([
  'spend',
  'impressions',
  'reach',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'frequency',
  'inline_link_clicks',
]);
const INSIGHTS_DEFAULT_LIMIT = 100;
const INSIGHTS_MAX_LIMIT = 200;
const INSIGHTS_MAX_OBJECT_IDS = 50;
const INSIGHTS_MAX_ACTION_TYPES = 60;
// A Graph limita `date_preset=maximum` a 37 meses; o intervalo explícito
// segue o mesmo teto para manter a resposta e o custo previsíveis.
const INSIGHTS_MAX_RANGE_DAYS = 37 * 31;

const EFFECTIVE_STATUSES = Object.freeze([
  'ACTIVE',
  'PAUSED',
  'DELETED',
  'ARCHIVED',
  'PENDING_REVIEW',
  'DISAPPROVED',
  'PREAPPROVED',
  'PENDING_BILLING_INFO',
  'CAMPAIGN_PAUSED',
  'ADSET_PAUSED',
  'IN_PROCESS',
  'WITH_ISSUES',
]);
// Cada anúncio carrega o criativo completo; páginas pequenas mantêm o
// resultado bem abaixo do teto de 1 MB do journal.
const ADS_PAGE_DEFAULT_LIMIT = 50;
const ADS_PAGE_MAX_LIMIT = 100;
const ADS_PAGE_FIELDS = Object.freeze([
  'id',
  'name',
  'status',
  'effective_status',
  'created_time',
  'updated_time',
  'adset_id',
  'campaign_id',
  'creative{id,name,object_story_spec,asset_feed_spec}',
  'adset{id,name,campaign_id}',
  'campaign{id,name}',
]);

const OBJECT_VIEWS = Object.freeze(['history']);
const CAMPAIGN_HISTORY_FIELDS = Object.freeze([
  'id',
  'account_id',
  'name',
  'objective',
  'buying_type',
  'special_ad_categories',
  'is_adset_budget_sharing_enabled',
  'status',
  'configured_status',
  'effective_status',
  'created_time',
  'updated_time',
  'start_time',
  'stop_time',
  'daily_budget',
  'lifetime_budget',
  'budget_remaining',
  'spend_cap',
  'bid_strategy',
]);
// Sem `targeting` (pode conter públicos personalizados) e sem
// `promoted_object` (IDs de pixel/dataset): a visão histórica só precisa de
// datas, estado e orçamento.
const ADSET_HISTORY_FIELDS = Object.freeze([
  'id',
  'account_id',
  'name',
  'campaign_id',
  'status',
  'configured_status',
  'effective_status',
  'billing_event',
  'optimization_goal',
  'destination_type',
  'bid_strategy',
  'created_time',
  'updated_time',
  'start_time',
  'end_time',
  'daily_budget',
  'lifetime_budget',
  'budget_remaining',
]);

// Guarda de cota das leituras. O estado mora na tabela de locks já existente
// (uma linha por conta, chave própria), sem migration: a leitura confere duas
// linhas por chave primária antes de chamar a Graph.
const LOCK_ROW_SQL = 'SELECT run_id, expires_at FROM meta_ads_publish_locks WHERE resource_key = ?';
const MUTATION_PACING_OWNER = 'graph-rate-limiter-v1';
const READ_GUARD_OWNER = 'graph-read-guard-v1';
const READ_GUARD_WARNING_PCT = 80;
const READ_GUARD_PAUSE_PCT = 95;
const READ_GUARD_WARNING_MS = 10 * 60_000;
const READ_GUARD_PAUSE_MS = 30 * 60_000;
const READ_GUARD_MAX_MS = 60 * 60_000;
const RATE_USAGE_PERCENT_KEYS = Object.freeze([
  'call_count',
  'total_cputime',
  'total_time',
  // x-fb-ads-insights-throttle
  'app_id_util_pct',
  'acc_id_util_pct',
]);
// Códigos da Graph para limite de chamadas (app, usuário, página, conta de
// anúncios e a faixa 80000–80014 de business use case).
const THROTTLE_CODES = Object.freeze([4, 17, 32, 613]);

const CURSOR_PATTERN = /^[A-Za-z0-9_=-]{1,1024}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTION_TYPE_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/;

function text(value) {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

// Capacidade pública (sem segredos) anunciada em GET /config. É uma chave
// nova: consumidores antigos, que só leem `workflow_contract_revision`,
// `video_upload` e `tracking`, continuam vendo exatamente os mesmos valores.
export function metaAdsReadCapabilities() {
  return {
    revision: META_ADS_READ_REVISION,
    graph_methods: ['GET'],
    actions: [...META_ADS_READ_NEW_ACTIONS],
    insights: {
      levels: [...INSIGHTS_LEVELS],
      periods: [...INSIGHTS_PERIODS],
      breakdowns: [...INSIGHTS_BREAKDOWNS],
      fields: [...INSIGHTS_METRIC_FIELDS],
      default_limit: INSIGHTS_DEFAULT_LIMIT,
      max_limit: INSIGHTS_MAX_LIMIT,
      max_object_ids: INSIGHTS_MAX_OBJECT_IDS,
      effective_status_filter: true,
    },
    list_ads: {
      paged: true,
      effective_status_filter: true,
      effective_statuses: [...EFFECTIVE_STATUSES],
      default_limit: ADS_PAGE_DEFAULT_LIMIT,
      max_limit: ADS_PAGE_MAX_LIMIT,
    },
    object_views: {
      get_campaign: [...OBJECT_VIEWS],
      get_adset: [...OBJECT_VIEWS],
    },
    guard: {
      graph_calls_per_operation: 1,
      refuse_at_usage_percent: READ_GUARD_WARNING_PCT,
      refuse_during_publish: true,
      errors: ['meta_ads_read_rate_guard', 'meta_ads_read_publish_in_progress', 'meta_ads_read_guard_unavailable'],
    },
  };
}

// Decide se o pedido usa uma leitura deste módulo. As ações existentes só
// entram aqui quando o chamador envia um parâmetro novo e explícito; sem ele o
// gateway segue pelo caminho antigo, byte a byte.
export function isMetaAdsReadRequest(action, body) {
  const name = text(action);
  const input = isPlainObject(body) ? body : {};
  if (name === 'get_insights') return true;
  if (name === 'list_ads') {
    return present(input.effective_status) || present(input.limit) || present(input.after);
  }
  if (name === 'get_campaign' || name === 'get_adset') return present(input.view);
  return false;
}

export function createMetaAdsReadActions(deps) {
  const {
    resolveGraphAuth,
    graphRequest,
    graphUrl,
    sanitizeGraphValue,
    normalizeNumericId,
    failure,
    dbFirst,
    dbRun,
  } = deps || {};
  for (const [name, dep] of Object.entries({
    resolveGraphAuth, graphRequest, graphUrl, sanitizeGraphValue, normalizeNumericId, failure, dbFirst, dbRun,
  })) {
    if (typeof dep !== 'function') throw new Error(`meta_ads_read_dependency_missing:${name}`);
  }

  const reject = (code, httpStatus = 400) => failure(code, { classification: 'permanent', http_status: httpStatus });

  function normalizeLimit(value, fallback, max) {
    if (!present(value)) return fallback;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > max) throw reject('read_limit_invalid');
    return limit;
  }

  function normalizeCursor(value) {
    if (!present(value)) return '';
    const cursor = text(value);
    if (typeof value !== 'string' || !CURSOR_PATTERN.test(cursor)) throw reject('read_cursor_invalid');
    return cursor;
  }

  function normalizeAllowlistedList(value, allowed, code, { upper = false, max = allowed.length } = {}) {
    if (!present(value)) return [];
    if (!Array.isArray(value) || value.length === 0 || value.length > max) throw reject(code);
    const out = [];
    for (const entry of value) {
      if (typeof entry !== 'string') throw reject(code);
      const item = upper ? text(entry).toUpperCase() : text(entry);
      if (!allowed.includes(item)) throw reject(code);
      if (!out.includes(item)) out.push(item);
    }
    return out;
  }

  function normalizeDate(value, code) {
    const date = text(value);
    if (!DATE_PATTERN.test(date)) throw reject(code);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw reject(code);
    return date;
  }

  function normalizeTimeRange(body) {
    const hasSince = present(body.since);
    const hasUntil = present(body.until);
    if (!hasSince && !hasUntil) return null;
    if (!hasSince || !hasUntil) throw reject('insights_time_range_invalid');
    const since = normalizeDate(body.since, 'insights_time_range_invalid');
    const until = normalizeDate(body.until, 'insights_time_range_invalid');
    const days = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000;
    if (days < 0 || days > INSIGHTS_MAX_RANGE_DAYS) throw reject('insights_time_range_invalid');
    return { since, until };
  }

  function pagingOut(paging) {
    const cursors = isPlainObject(paging) && isPlainObject(paging.cursors) ? paging.cursors : {};
    const hasNext = isPlainObject(paging) && text(paging.next) !== '';
    const after = text(cursors.after);
    // O cursor é opaco; se a Graph devolver algo fora do formato esperado a
    // paginação para em vez de repassar um valor arbitrário.
    return hasNext && CURSOR_PATTERN.test(after)
      ? { has_next: true, after }
      : { has_next: false, after: null };
  }

  function leaseRemainingMs(row, owner, nowMs) {
    if (!isPlainObject(row) || text(row.run_id) !== owner) return 0;
    const expires = Date.parse(row.expires_at);
    // Linha ilegível conta como guarda ativa: na dúvida a leitura espera.
    if (!Number.isFinite(expires)) return READ_GUARD_WARNING_MS;
    return Math.max(0, expires - nowMs);
  }

  function refuse(code, httpStatus, remainingMs) {
    return failure(code, {
      classification: 'transient',
      retryable: false,
      http_status: httpStatus,
      retry_after_seconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    });
  }

  // Confere, antes de qualquer chamada à Graph, se a conta está publicando ou
  // com a cota alta. Sem estado legível a leitura é recusada (fail-closed).
  async function assertReadAllowed(auth, context) {
    let pacing;
    let guard;
    try {
      pacing = await dbFirst(context.env, LOCK_ROW_SQL, `graph-rate-account:${auth.accountId}`);
      guard = await dbFirst(context.env, LOCK_ROW_SQL, `graph-read-guard:${auth.accountId}`);
    } catch {
      throw failure('meta_ads_read_guard_unavailable', { classification: 'transient', retryable: false, http_status: 503 });
    }
    const nowMs = Date.now();
    const publishing = leaseRemainingMs(pacing, MUTATION_PACING_OWNER, nowMs);
    if (publishing > 0) throw refuse('meta_ads_read_publish_in_progress', 409, publishing);
    const cooling = leaseRemainingMs(guard, READ_GUARD_OWNER, nowMs);
    if (cooling > 0) throw refuse('meta_ads_read_rate_guard', 429, cooling);
  }

  function usageSummary(value, out = { percent: 0, regain_minutes: 0 }) {
    if (Array.isArray(value)) {
      for (const item of value) usageSummary(item, out);
    } else if (isPlainObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        const number = Number(item);
        if (RATE_USAGE_PERCENT_KEYS.includes(key) && Number.isFinite(number)) out.percent = Math.max(out.percent, number);
        else if (key === 'estimated_time_to_regain_access' && Number.isFinite(number)) out.regain_minutes = Math.max(out.regain_minutes, number);
        else usageSummary(item, out);
      }
    }
    return out;
  }

  function isThrottleFailure(error) {
    if (!error || typeof error !== 'object') return false;
    const code = Number(error.code || 0);
    return Number(error.http_status) === 429 || THROTTLE_CODES.includes(code) || (code >= 80000 && code <= 80014);
  }

  // Depois de cada chamada, registra a guarda se a cota medida passou do
  // limite ou se a Graph recusou por limite de chamadas. A guarda só é
  // estendida, nunca encurtada, e vence sozinha.
  async function recordReadUsage(auth, context, error) {
    const usage = usageSummary(context.rateUsage);
    const throttled = isThrottleFailure(error);
    let cooldown = 0;
    if (throttled || usage.percent >= READ_GUARD_PAUSE_PCT) cooldown = READ_GUARD_PAUSE_MS;
    else if (usage.percent >= READ_GUARD_WARNING_PCT) cooldown = READ_GUARD_WARNING_MS;
    if (!cooldown) return;
    cooldown = Math.min(READ_GUARD_MAX_MS, Math.max(
      cooldown,
      usage.regain_minutes * 60_000,
      Number(error?.retry_after_seconds || 0) * 1000,
    ));
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const blockedUntil = new Date(nowMs + cooldown).toISOString();
    if (!isPlainObject(context.rateUsage)) context.rateUsage = {};
    if (usage.percent >= READ_GUARD_PAUSE_PCT || throttled) context.rateUsage.pause_recommended = true;
    else context.rateUsage.warning = true;
    context.rateUsage.read_guard = { usage_percent: usage.percent, throttled, blocked_until: blockedUntil };
    try {
      await dbRun(context.env,
        `INSERT INTO meta_ads_publish_locks (
          resource_key, run_id, operation_key, heartbeat_at, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(resource_key) DO UPDATE SET
          operation_key = excluded.operation_key, heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at, updated_at = excluded.updated_at
        WHERE meta_ads_publish_locks.run_id = '${READ_GUARD_OWNER}' AND
          meta_ads_publish_locks.expires_at < excluded.expires_at`,
        `graph-read-guard:${auth.accountId}`, READ_GUARD_OWNER, text(context.operationKey) || 'read',
        now, blockedUntil, now, now);
    } catch {
      context.rateUsage.read_guard.update_failed = true;
    }
  }

  // Única porta de saída para a Graph neste módulo: GET, uma tentativa, com a
  // guarda conferida antes e a cota registrada depois.
  async function readGraph(url, auth, context) {
    await assertReadAllowed(auth, context);
    let caught;
    try {
      return await graphRequest(url, { method: 'GET' }, auth, context, { maxAttempts: 1 });
    } catch (error) {
      caught = error;
      throw error;
    } finally {
      await recordReadUsage(auth, context, caught);
    }
  }

  function numeric(value) {
    if (!present(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function summarizeActions(list) {
    const out = {};
    let count = 0;
    for (const entry of Array.isArray(list) ? list : []) {
      if (!isPlainObject(entry)) continue;
      const type = text(entry.action_type);
      const value = numeric(entry.value);
      if (!ACTION_TYPE_PATTERN.test(type) || value === null) continue;
      if (!(type in out)) {
        if (count >= INSIGHTS_MAX_ACTION_TYPES) continue;
        count += 1;
      }
      // Só o total do tipo de ação. Janelas de atribuição e demais chaves da
      // linha original são descartadas.
      out[type] = value;
    }
    return out;
  }

  function summarizeInsightsRow(row, level, breakdowns) {
    const source = isPlainObject(row) ? row : {};
    const out = { level };
    for (const key of INSIGHTS_IDENTITY_FIELDS[level]) out[key] = present(source[key]) ? text(source[key]) : null;
    out.date_start = present(source.date_start) ? text(source.date_start) : null;
    out.date_stop = present(source.date_stop) ? text(source.date_stop) : null;
    for (const key of breakdowns) out[key] = present(source[key]) ? text(source[key]) : null;
    for (const key of INSIGHTS_NUMERIC_FIELDS) out[key] = numeric(source[key]);
    out.actions = summarizeActions(source.actions);
    out.cost_per_action_type = summarizeActions(source.cost_per_action_type);
    return out;
  }

  async function getInsights(body, context) {
    const auth = await resolveGraphAuth(body, context);
    const level = text(body.level);
    if (!INSIGHTS_LEVELS.includes(level)) throw reject('insights_level_invalid');
    const period = text(body.period || 'lifetime');
    if (!INSIGHTS_PERIODS.includes(period)) throw reject('insights_period_invalid');
    const breakdowns = normalizeAllowlistedList(body.breakdowns, INSIGHTS_BREAKDOWNS, 'insights_breakdown_not_allowed', { max: 2 });
    const statuses = normalizeAllowlistedList(body.effective_status, EFFECTIVE_STATUSES, 'effective_status_invalid', { upper: true });
    const limit = normalizeLimit(body.limit, INSIGHTS_DEFAULT_LIMIT, INSIGHTS_MAX_LIMIT);
    const after = normalizeCursor(body.after);
    const range = normalizeTimeRange(body);

    let objectIds = [];
    if (present(body.object_ids)) {
      if (!Array.isArray(body.object_ids) || body.object_ids.length === 0
        || body.object_ids.length > INSIGHTS_MAX_OBJECT_IDS) {
        throw reject('insights_object_ids_invalid');
      }
      objectIds = [...new Set(body.object_ids.map((id) => normalizeNumericId(id, 'insights_object_id')))];
    }
    if (level === 'account' && (objectIds.length || statuses.length)) {
      throw reject('insights_filter_not_supported_for_account_level');
    }

    const filtering = [];
    if (objectIds.length) filtering.push({ field: `${level}.id`, operator: 'IN', value: objectIds });
    if (statuses.length) filtering.push({ field: `${level}.effective_status`, operator: 'IN', value: statuses });

    const fields = [...INSIGHTS_IDENTITY_FIELDS[level], ...INSIGHTS_METRIC_FIELDS];
    // A consulta sempre parte da conta configurada no perfil do token; os IDs
    // informados só restringem o resultado dentro dela.
    const url = graphUrl(auth.apiVersion, `act_${auth.accountId}/insights`, {
      level,
      fields: fields.join(','),
      limit: String(limit),
      ...(range ? { time_range: JSON.stringify(range) } : { date_preset: 'maximum' }),
      ...(period === 'monthly' ? { time_increment: 'monthly' } : {}),
      ...(breakdowns.length ? { breakdowns: breakdowns.join(',') } : {}),
      ...(filtering.length ? { filtering: JSON.stringify(filtering) } : {}),
      ...(after ? { after } : {}),
    });
    const result = await readGraph(url, auth, context);
    const payload = isPlainObject(result.body) ? result.body : {};
    const rows = (Array.isArray(payload.data) ? payload.data : [])
      .slice(0, limit)
      .map((row) => summarizeInsightsRow(row, level, breakdowns))
      // Defesa em profundidade: uma linha de outra conta nunca é devolvida.
      .filter((row) => row.account_id === null || row.account_id === auth.accountId);
    return sanitizeGraphValue({
      read_revision: META_ADS_READ_REVISION,
      level,
      period,
      time_range: range,
      breakdowns,
      data: rows,
      item_count: rows.length,
      paging: pagingOut(payload.paging),
    });
  }

  async function listAdsPage(body, context) {
    const auth = await resolveGraphAuth(body, context);
    const statuses = normalizeAllowlistedList(body.effective_status, EFFECTIVE_STATUSES, 'effective_status_invalid', { upper: true });
    const limit = normalizeLimit(body.limit, ADS_PAGE_DEFAULT_LIMIT, ADS_PAGE_MAX_LIMIT);
    const after = normalizeCursor(body.after);
    const url = graphUrl(auth.apiVersion, `act_${auth.accountId}/ads`, {
      fields: ADS_PAGE_FIELDS.join(','),
      limit: String(limit),
      ...(statuses.length ? { effective_status: JSON.stringify(statuses) } : {}),
      ...(after ? { after } : {}),
    });
    const result = await readGraph(url, auth, context);
    const payload = isPlainObject(result.body) ? result.body : {};
    const ads = (Array.isArray(payload.data) ? payload.data : []).slice(0, limit);
    const paging = pagingOut(payload.paging);
    return sanitizeGraphValue({
      read_revision: META_ADS_READ_REVISION,
      data: ads,
      page_count: 1,
      item_count: ads.length,
      truncated: paging.has_next,
      effective_status: statuses,
      paging,
    });
  }

  async function readOwnedObject(body, context, fields) {
    const auth = await resolveGraphAuth(body, context);
    const view = text(body.view);
    if (!OBJECT_VIEWS.includes(view)) throw reject('read_view_invalid');
    const objectId = normalizeNumericId(body.object_id, 'object_id');
    const result = await readGraph(graphUrl(auth.apiVersion, objectId, { fields: fields.join(',') }), auth, context);
    const source = isPlainObject(result.body) ? result.body : {};
    // A visão histórica só é devolvida para objetos da conta configurada.
    if (text(source.account_id).replace(/^act_/, '') !== auth.accountId) {
      throw failure('object_not_in_authorized_account', { classification: 'auth', http_status: 403 });
    }
    const out = { read_revision: META_ADS_READ_REVISION, view };
    for (const key of fields) if (key in source) out[key] = source[key];
    return sanitizeGraphValue(out);
  }

  async function dispatch(name, input, context) {
    if (name === 'get_insights') return getInsights(input, context);
    if (name === 'list_ads') return listAdsPage(input, context);
    if (name === 'get_campaign') return readOwnedObject(input, context, CAMPAIGN_HISTORY_FIELDS);
    if (name === 'get_adset') return readOwnedObject(input, context, ADSET_HISTORY_FIELDS);
    throw reject('invalid_action');
  }

  async function perform(action, body, context) {
    try {
      return await dispatch(text(action), isPlainObject(body) ? body : {}, context);
    } catch (error) {
      // Uma leitura não deixa efeito externo pendente: timeout ou queda de
      // rede é falha simples, nunca motivo para `reconciliation_required`.
      if (error && typeof error === 'object' && error.classification) {
        error.ambiguous = false;
        throw error;
      }
      throw failure('meta_ads_read_failed', { classification: 'transient', retryable: false, http_status: 502 });
    }
  }

  return Object.freeze({ perform, getInsights, listAdsPage });
}

export const __test = Object.freeze({
  insightsLevels: INSIGHTS_LEVELS,
  insightsBreakdowns: INSIGHTS_BREAKDOWNS,
  insightsMetricFields: INSIGHTS_METRIC_FIELDS,
  effectiveStatuses: EFFECTIVE_STATUSES,
  adsPageFields: ADS_PAGE_FIELDS,
  campaignHistoryFields: CAMPAIGN_HISTORY_FIELDS,
  adsetHistoryFields: ADSET_HISTORY_FIELDS,
  readGuardOwner: READ_GUARD_OWNER,
  mutationPacingOwner: MUTATION_PACING_OWNER,
});
