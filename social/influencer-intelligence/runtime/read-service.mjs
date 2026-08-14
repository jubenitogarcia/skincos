export const READ_SERVICE_VERSION = 'influencer-intelligence/internal-read-service/v1';

const PROVIDERS = new Set(['meta-graph', 'instagrapi']);
const CREATOR_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_PROVIDER = /^[a-z][a-z0-9._-]{1,63}$/;

export class InfluencerIntelligenceReadServiceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'InfluencerIntelligenceReadServiceError';
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new InfluencerIntelligenceReadServiceError(code, message);
}

function requireQueryable(queryable) {
  if (!queryable || typeof queryable.query !== 'function') fail('UNAVAILABLE', 'database query boundary is unavailable');
}

function normalizedKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!CREATOR_KEY.test(key)) fail('INVALID_INPUT');
  return key;
}

function boundedPage(value, fallback, maximum = 50) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > 100_000) fail('INVALID_INPUT');
  return Math.min(candidate, maximum === 50 ? 50 : candidate);
}

function boundedLimit(value, fallback = 25) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > 50) fail('INVALID_INPUT');
  return candidate;
}

function timestamp(value, fallback) {
  const parsed = new Date(value ?? fallback);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback).toISOString() : parsed.toISOString();
}

function safeProvider(value) {
  if (value === null || value === undefined) return null;
  const provider = String(value).trim().toLowerCase();
  return SAFE_PROVIDER.test(provider) && PROVIDERS.has(provider) ? provider : null;
}

function providerList(value) {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return [...new Set(values.map(safeProvider).filter(Boolean))].sort();
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeProvenance({ provider, sourceType, evidenceState, observedAt, retrievedAt }) {
  const observed = timestamp(observedAt, retrievedAt);
  const retrieved = timestamp(retrievedAt, observed);
  return [{
    provider: safeProvider(provider),
    source_type: sourceType,
    source_ref: `db:${sourceType}`,
    observed_at: observed,
    retrieved_at: retrieved >= observed ? retrieved : observed,
    evidence_state: ['observed', 'derived', 'inferred', 'unavailable'].includes(evidenceState) ? evidenceState : 'unavailable',
  }];
}

function freshnessFromRow(row, clock) {
  const status = String(row?.freshness_status || '').toLowerCase();
  if (['fresh', 'stale', 'unknown'].includes(status)) return status;
  if (!row?.retrieved_at) return 'unknown';
  const age = Math.max(0, clock() - Date.parse(row.retrieved_at));
  return age <= 7 * 24 * 60 * 60 * 1000 ? 'fresh' : 'stale';
}

function coverage(available, expected, fallbackExpected = 1) {
  const expectedValue = Number.isInteger(expected) && expected > 0 ? expected : fallbackExpected;
  const availableValue = Number.isInteger(available) && available >= 0 ? Math.min(available, expectedValue) : 0;
  return {
    available_metrics: availableValue,
    expected_metrics: expectedValue,
    ratio: Number((availableValue / expectedValue).toFixed(6)),
  };
}

function unavailable(clock, sourceType, limitation, provider = null) {
  const now = new Date(clock()).toISOString();
  return {
    data: null,
    data_classification: 'unavailable',
    freshness: 'unknown',
    retrieved_at: now,
    confidence: 0,
    coverage: coverage(0, 1),
    providers: provider ? providerList(provider) : [],
    provenance: safeProvenance({ provider, sourceType, evidenceState: 'unavailable', observedAt: now, retrievedAt: now }),
    limitations: [limitation],
    errors: [],
  };
}

function available({ data, classification = 'observed', freshness = 'unknown', retrievedAt, confidence = 1, available, expected, providers = [], sourceType, evidenceState = classification, observedAt, limitations = [] }, clock) {
  const retrieved = timestamp(retrievedAt, clock());
  return {
    data,
    data_classification: classification,
    freshness,
    retrieved_at: retrieved,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    coverage: coverage(available, expected),
    providers: providerList(providers),
    provenance: safeProvenance({ provider: providerList(providers)[0] || null, sourceType, evidenceState, observedAt: observedAt || retrieved, retrievedAt: retrieved }),
    limitations,
    errors: [],
  };
}

function providerFromRows(rows) {
  return providerList((rows || []).flatMap((row) => row.providers || row.provider || []));
}

function rowProvenance(row, sourceType, fallbackState) {
  const state = row?.evidence_state || fallbackState;
  const providers = providerList(row?.providers || row?.provider);
  return safeProvenance({
    provider: providers[0] || null,
    sourceType,
    evidenceState: state,
    observedAt: row?.observed_at || row?.computed_at,
    retrievedAt: row?.retrieved_at || row?.computed_at,
  });
}

function confidenceFromRow(row, fallback = 0) {
  const value = Number(row?.confidence);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function normalizeWindow(window) {
  if (window === undefined) return null;
  if (!window || typeof window !== 'object' || Array.isArray(window)) fail('INVALID_INPUT');
  const start = new Date(window.start);
  const end = new Date(window.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) fail('INVALID_INPUT');
  if (end.getTime() - start.getTime() > 365 * 24 * 60 * 60 * 1000) fail('INVALID_INPUT');
  return { start: start.toISOString(), end: end.toISOString() };
}

const SQL = Object.freeze({
  search: `
    SELECT r.creator_key, r.canonical_handle, r.registry_state, r.monitoring_enabled,
           r.monitoring_interval_hours, r.updated_at,
           array_remove(array_agg(DISTINCT p.provider), NULL) AS providers
    FROM influencer_intelligence.creator_registry r
    LEFT JOIN influencer_intelligence.creator_provider_registry p ON p.creator_key = r.creator_key
    WHERE ($1::text = '' OR r.creator_key ILIKE '%' || $1 || '%' OR coalesce(r.canonical_handle, '') ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR p.provider = $2)
      AND ($3::text IS NULL OR r.registry_state = $3)
    GROUP BY r.creator_key, r.canonical_handle, r.registry_state, r.monitoring_enabled,
             r.monitoring_interval_hours, r.updated_at
    ORDER BY r.updated_at DESC, r.creator_key
    LIMIT $4 OFFSET $5`,
  profile: `
    SELECT r.creator_key, r.canonical_handle, r.registry_state, r.monitoring_enabled,
           r.monitoring_interval_hours, r.updated_at,
           s.provider, s.observed_at, s.retrieved_at, s.followers_count,
           s.following_count, s.media_count, s.is_private, s.is_verified,
           s.coverage_available, s.coverage_expected, s.freshness_status,
           p.provider AS identity_provider
    FROM influencer_intelligence.creator_registry r
    LEFT JOIN LATERAL (
      SELECT * FROM influencer_intelligence.creator_profile_snapshot s0
      WHERE s0.creator_key = r.creator_key
      ORDER BY s0.observed_at DESC, s0.retrieved_at DESC, s0.snapshot_key DESC
      LIMIT 1
    ) s ON true
    LEFT JOIN influencer_intelligence.creator_provider_registry p ON p.creator_key = r.creator_key
    WHERE r.creator_key = $1
    ORDER BY p.updated_at DESC NULLS LAST
    LIMIT 1`,
  snapshots: `
    SELECT snapshot_key, creator_key, provider, evidence_state, observed_at, retrieved_at,
           followers_count, following_count, media_count, is_private, is_verified,
           coverage_available, coverage_expected, freshness_status, freshness_age_seconds
    FROM influencer_intelligence.creator_profile_snapshot
    WHERE creator_key = $1
      AND ($2::timestamptz IS NULL OR observed_at >= $2)
      AND ($3::timestamptz IS NULL OR observed_at <= $3)
    ORDER BY observed_at DESC, retrieved_at DESC, snapshot_key DESC
    LIMIT $4 OFFSET $5`,
  media: `
    SELECT s.snapshot_key, s.media_key, s.creator_key, s.provider, s.evidence_state,
           s.observed_at, s.retrieved_at, s.likes_count, s.comments_count,
           s.shares_count, s.saves_count, s.views_count, s.reach_count,
           s.impressions_count, s.coverage_available, s.coverage_expected,
           s.freshness_status, m.media_kind, m.published_at
    FROM influencer_intelligence.creator_media_snapshot s
    LEFT JOIN influencer_intelligence.creator_media m ON m.media_key = s.media_key
    WHERE s.creator_key = $1
      AND ($2::timestamptz IS NULL OR s.observed_at >= $2)
      AND ($3::timestamptz IS NULL OR s.observed_at <= $3)
    ORDER BY s.observed_at DESC, s.retrieved_at DESC, s.snapshot_key DESC
    LIMIT $4 OFFSET $5`,
  analysis: `
    SELECT analysis_key, creator_key, window_start, window_end, evidence_state,
           confidence, coverage_available, coverage_expected, algorithm_version,
           model_version, providers, provenance, analysis_metrics, computed_at
    FROM influencer_intelligence.creator_analysis
    WHERE creator_key = $1
    ORDER BY computed_at DESC, analysis_key DESC
    LIMIT 1`,
  score: `
    SELECT score_key, creator_key, score_kind, score, confidence,
           coverage_available, coverage_expected, evidence_state, algorithm_version,
           model_version, providers, provenance, computed_at, weights_version
    FROM influencer_intelligence.creator_score
    WHERE creator_key = $1 AND score_kind = 'influencer'
    ORDER BY computed_at DESC, score_key DESC
    LIMIT 1`,
  components: `
    SELECT component_name, value, weight, contribution, evidence_state, confidence,
           algorithm_version, model_version, providers, evidence_refs
    FROM influencer_intelligence.creator_score_component
    WHERE score_key = $1
    ORDER BY component_name`,
  campaignFitAll: `
    SELECT fit_key, campaign_key, campaign_version, creator_key, score, confidence,
           coverage_available, coverage_expected, evidence_state, algorithm_version,
           model_version, providers, provenance, computed_at, weights_version, components
    FROM influencer_intelligence.campaign_creator_fit
    WHERE campaign_key = $1 AND campaign_version = $2
    ORDER BY score DESC NULLS LAST, creator_key
    LIMIT $3 OFFSET $4`,
  campaignFitSelected: `
    SELECT fit_key, campaign_key, campaign_version, creator_key, score, confidence,
           coverage_available, coverage_expected, evidence_state, algorithm_version,
           model_version, providers, provenance, computed_at, weights_version, components
    FROM influencer_intelligence.campaign_creator_fit
    WHERE campaign_key = $1 AND campaign_version = $2 AND creator_key = ANY($3::text[])
    ORDER BY score DESC NULLS LAST, creator_key
    LIMIT $4 OFFSET $5`,
  compare: `
    SELECT score_key, creator_key, score, confidence, coverage_available,
           coverage_expected, evidence_state, algorithm_version, weights_version,
           providers, provenance, computed_at
    FROM influencer_intelligence.creator_score
    WHERE score_kind = 'influencer' AND creator_key = ANY($1::text[])
    ORDER BY score DESC NULLS LAST, creator_key`,
});

async function creatorRow(queryable, creatorKey) {
  const result = await queryable.query(SQL.profile, [creatorKey]);
  return result.rows?.[0] || null;
}

function profileData(row) {
  return {
    creator_key: row.creator_key,
    canonical_handle: row.canonical_handle || null,
    registry_state: row.registry_state,
    monitoring_enabled: row.monitoring_enabled === true,
    monitoring_interval_hours: row.monitoring_interval_hours ?? null,
    updated_at: row.updated_at || null,
    metrics: {
      followers: row.followers_count ?? null,
      following: row.following_count ?? null,
      media_count: row.media_count ?? null,
      is_private: row.is_private ?? null,
      is_verified: row.is_verified ?? null,
    },
  };
}

function profileCoverage(row) {
  const values = [row.canonical_handle, row.followers_count, row.following_count, row.media_count, row.is_private, row.is_verified];
  return values.filter((value) => value !== null && value !== undefined).length;
}

function rowSnapshot(row) {
  return {
    snapshot_key: row.snapshot_key,
    creator_key: row.creator_key,
    provider: safeProvider(row.provider),
    observed_at: row.observed_at,
    retrieved_at: row.retrieved_at,
    metrics: {
      followers: row.followers_count ?? null,
      following: row.following_count ?? null,
      media_count: row.media_count ?? null,
      is_private: row.is_private ?? null,
      is_verified: row.is_verified ?? null,
    },
    evidence_state: row.evidence_state,
    freshness: row.freshness_status || 'unknown',
    coverage: coverage(row.coverage_available, row.coverage_expected, 5),
  };
}

function rowMedia(row) {
  return {
    snapshot_key: row.snapshot_key,
    media_key: row.media_key,
    creator_key: row.creator_key,
    provider: safeProvider(row.provider),
    media_kind: row.media_kind || 'unknown',
    published_at: row.published_at || null,
    observed_at: row.observed_at,
    retrieved_at: row.retrieved_at,
    metrics: {
      likes: row.likes_count ?? null,
      comments: row.comments_count ?? null,
      shares: row.shares_count ?? null,
      saves: row.saves_count ?? null,
      views: row.views_count ?? null,
      reach: row.reach_count ?? null,
      impressions: row.impressions_count ?? null,
    },
    evidence_state: row.evidence_state,
    freshness: row.freshness_status || 'unknown',
    coverage: coverage(row.coverage_available, row.coverage_expected, 7),
  };
}

function rowScore(row, components = []) {
  return {
    score_key: row.score_key,
    creator_key: row.creator_key,
    score: row.score ?? null,
    confidence: confidenceFromRow(row),
    data_coverage: coverage(row.coverage_available, row.coverage_expected).ratio,
    evidence_state: row.evidence_state,
    algorithm_version: row.algorithm_version,
    model_version: row.model_version || null,
    weights_version: row.weights_version || null,
    calculated_at: row.computed_at,
    components: components.map((component) => ({
      component_name: component.component_name,
      score: component.value ?? null,
      weight: component.weight ?? null,
      contribution: component.contribution ?? null,
      confidence: confidenceFromRow(component),
      evidence_state: component.evidence_state,
      evidence_refs: Array.isArray(component.evidence_refs) ? component.evidence_refs.slice(0, 20) : [],
    })),
  };
}

function rowFit(row) {
  return {
    fit_key: row.fit_key,
    campaign_key: row.campaign_key,
    campaign_version: row.campaign_version,
    creator_key: row.creator_key,
    score: row.score ?? null,
    confidence: confidenceFromRow(row),
    data_coverage: coverage(row.coverage_available, row.coverage_expected).ratio,
    evidence_state: row.evidence_state,
    algorithm_version: row.algorithm_version,
    model_version: row.model_version || null,
    weights_version: row.weights_version || null,
    calculated_at: row.computed_at,
    components: parseJson(row.components, {}),
  };
}

function dataClassification(row, fallback = 'derived') {
  return ['observed', 'derived', 'inferred', 'unavailable'].includes(row?.evidence_state) ? row.evidence_state : fallback;
}

const DASHBOARD_STATES = new Set(['observed', 'derived', 'inferred']);

function provenanceRefs(envelope) {
  return [...new Set((envelope?.provenance || []).map((entry) => entry.source_ref).filter((value) => typeof value === 'string'))].slice(0, 20);
}

function dashboardMetric(value, envelope, { evidenceState, freshness, provider, retrievedAt, limitations = [] } = {}) {
  const present = value !== null && value !== undefined;
  const state = present && DASHBOARD_STATES.has(evidenceState || envelope?.data_classification) ? (evidenceState || envelope.data_classification) : 'unavailable';
  const safeLimitations = [...new Set([
    ...(present ? [] : ['metric_not_available']),
    ...limitations,
    ...(envelope?.limitations || []),
  ])].slice(0, 32);
  return {
    value: present ? value : null,
    evidenceState: state,
    freshness: state === 'unavailable' ? 'unknown' : (['fresh', 'stale', 'unknown'].includes(freshness || envelope?.freshness) ? (freshness || envelope.freshness) : 'unknown'),
    provider: state === 'unavailable' ? null : (provider || envelope?.providers?.[0] || null),
    retrievedAt: state === 'unavailable' ? null : (retrievedAt || envelope?.retrieved_at || null),
    limitations: safeLimitations,
    sourceRefs: provenanceRefs(envelope),
  };
}

function rowDashboardMetric(row, field, envelope) {
  return dashboardMetric(row?.metrics?.[field], envelope, {
    evidenceState: row?.evidence_state,
    freshness: row?.freshness,
    provider: row?.provider,
    retrievedAt: row?.retrieved_at,
  });
}

function analyticsNode(metrics, path) {
  return path.reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), metrics);
}

function analyticsMetric(metrics, path, envelope) {
  const node = analyticsNode(metrics, path);
  const value = node && typeof node === 'object'
    ? [node.value, node.median, node.mean].find((candidate) => candidate !== null && candidate !== undefined)
    : node;
  return dashboardMetric(value ?? null, envelope, {
    evidenceState: node?.evidenceState || node?.evidence_state,
    limitations: Array.isArray(node?.limitations) ? node.limitations : [],
  });
}

function componentLabel(value) {
  return String(value || '').split(/[_-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function dashboardScore(envelope) {
  const score = envelope?.data;
  if (!score) {
    return {
      overallScore: null, confidenceScore: 0, dataCoverage: 0, evidenceState: 'unavailable',
      algorithmVersion: null, weightsVersion: null, calculatedAt: null, providers: [], components: [],
      limitations: envelope?.limitations || ['Influencer Score has not been computed'],
    };
  }
  return {
    overallScore: score.score ?? null,
    confidenceScore: Number((Number(score.confidence || 0) * 100).toFixed(2)),
    dataCoverage: Number((Number(score.data_coverage || 0) * 100).toFixed(2)),
    evidenceState: score.evidence_state || envelope.data_classification,
    algorithmVersion: score.algorithm_version || null,
    weightsVersion: score.weights_version || null,
    calculatedAt: score.calculated_at || envelope.retrieved_at || null,
    providers: envelope.providers || [],
    components: (score.components || []).map((component) => ({
      key: component.component_name,
      label: componentLabel(component.component_name),
      score: component.score ?? null,
      evidenceState: component.evidence_state || 'unavailable',
      confidence: Number((Number(component.confidence || 0) * 100).toFixed(2)),
      explanation: component.evidence_state === 'unavailable'
        ? 'Component unavailable; no value was imputed.'
        : 'Deterministic component with persisted evidence references.',
      sourceRefs: Array.isArray(component.evidence_refs) ? component.evidence_refs.slice(0, 20) : provenanceRefs(envelope),
    })),
    limitations: envelope.limitations || [],
  };
}

function dashboardProvenance(envelopes) {
  const entries = [];
  for (const envelope of envelopes) {
    for (const entry of envelope?.provenance || []) {
      entries.push({
        provider: entry.provider || null,
        sourceType: entry.source_type,
        sourceRef: entry.source_ref,
        evidenceState: entry.evidence_state,
        observedAt: entry.observed_at || null,
        retrievedAt: entry.retrieved_at || null,
      });
    }
  }
  const seen = new Set();
  return entries.filter((entry) => {
    const identity = `${entry.sourceType}:${entry.sourceRef}:${entry.observedAt}:${entry.retrievedAt}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, 32);
}

export function createInfluencerIntelligenceReadService({ queryable, clock = () => Date.now() } = {}) {
  requireQueryable(queryable);

  const service = {
    async searchCreators(input = {}) {
      const query = typeof input.query === 'string' ? input.query.trim().slice(0, 80) : '';
      const provider = input.provider === undefined ? null : safeProvider(input.provider);
      const registryState = input.registry_state === undefined ? null : String(input.registry_state);
      if (input.provider !== undefined && !provider) fail('INVALID_INPUT');
      if (registryState !== null && !['candidate', 'paused', 'unavailable'].includes(registryState)) fail('INVALID_INPUT');
      const page = boundedPage(input.page, 1, 100_000);
      const limit = boundedLimit(input.page_size);
      const result = await queryable.query(SQL.search, [query, provider, registryState, limit, (page - 1) * limit]);
      const rows = result.rows || [];
      const now = new Date(clock()).toISOString();
      return available({
        data: { items: rows.map((row) => ({
          creator_key: row.creator_key,
          canonical_handle: row.canonical_handle || null,
          registry_state: row.registry_state,
          monitoring_enabled: row.monitoring_enabled === true,
          monitoring_interval_hours: row.monitoring_interval_hours ?? null,
          providers: providerList(row.providers),
          updated_at: row.updated_at,
        })), page, page_size: limit },
        classification: 'observed', freshness: 'fresh', retrievedAt: now,
        confidence: 1, available: rows.length > 0 ? 1 : 0, expected: 1,
        providers: providerList(rows.flatMap((row) => row.providers || [])), sourceType: 'registry',
      }, clock);
    },

    async getCreatorProfile(input) {
      const creatorKey = normalizedKey(input?.creator_key);
      const row = await creatorRow(queryable, creatorKey);
      if (!row) fail('NOT_FOUND');
      const providers = providerList([row.provider, row.identity_provider]);
      const availableCount = profileCoverage(row);
      const retrievedAt = row.retrieved_at || row.updated_at || new Date(clock()).toISOString();
      return available({
        data: profileData(row), classification: 'observed', freshness: freshnessFromRow(row, clock),
        retrievedAt, confidence: availableCount >= 4 ? 1 : 0.5, available: availableCount, expected: 6,
        providers, sourceType: 'profile', observedAt: row.observed_at || row.updated_at,
        limitations: availableCount < 6 ? ['some profile metrics are unavailable'] : [],
      }, clock);
    },

    async getCreatorSnapshots(input) {
      const creatorKey = normalizedKey(input?.creator_key);
      const window = normalizeWindow(input?.window);
      const page = boundedPage(input?.page, 1, 100_000);
      const limit = boundedLimit(input?.page_size);
      const exists = await creatorRow(queryable, creatorKey);
      if (!exists) fail('NOT_FOUND');
      const result = await queryable.query(SQL.snapshots, [creatorKey, window?.start || null, window?.end || null, limit, (page - 1) * limit]);
      const rows = result.rows || [];
      if (!rows.length) return unavailable(clock, 'profile', 'profile snapshot history is unavailable', null);
      const latest = rows[0];
      return available({
        data: { items: rows.map(rowSnapshot), page, page_size: limit },
        classification: 'observed', freshness: freshnessFromRow(latest, clock), retrievedAt: latest.retrieved_at,
        confidence: 1, available: rows.length, expected: Math.max(rows.length, 1),
        providers: providerFromRows(rows), sourceType: 'profile', observedAt: latest.observed_at,
      }, clock);
    },

    async getCreatorMedia(input) {
      const creatorKey = normalizedKey(input?.creator_key);
      const window = normalizeWindow(input?.window);
      const page = boundedPage(input?.page, 1, 100_000);
      const limit = boundedLimit(input?.page_size);
      const exists = await creatorRow(queryable, creatorKey);
      if (!exists) fail('NOT_FOUND');
      const result = await queryable.query(SQL.media, [creatorKey, window?.start || null, window?.end || null, limit, (page - 1) * limit]);
      const rows = result.rows || [];
      if (!rows.length) return unavailable(clock, 'media', 'media metrics are unavailable', null);
      const latest = rows[0];
      return available({
        data: { items: rows.map(rowMedia), page, page_size: limit },
        classification: 'observed', freshness: freshnessFromRow(latest, clock), retrievedAt: latest.retrieved_at,
        confidence: 1, available: rows.length, expected: Math.max(rows.length, 1),
        providers: providerFromRows(rows), sourceType: 'media', observedAt: latest.observed_at,
      }, clock);
    },

    async getCreatorAnalytics(input) {
      const creatorKey = normalizedKey(input?.creator_key);
      const exists = await creatorRow(queryable, creatorKey);
      if (!exists) fail('NOT_FOUND');
      const result = await queryable.query(SQL.analysis, [creatorKey]);
      const row = result.rows?.[0];
      if (!row) return unavailable(clock, 'analysis', 'analytics have not been computed', null);
      const classification = dataClassification(row);
      if (classification === 'unavailable') return unavailable(clock, 'analysis', 'analytics are unavailable', providerList(row.providers)[0] || null);
      const provenance = rowProvenance(row, 'analysis', classification);
      return {
        data: { analysis_key: row.analysis_key, creator_key: row.creator_key, window: { start: row.window_start, end: row.window_end }, metrics: parseJson(row.analysis_metrics, {}), algorithm_version: row.algorithm_version, model_version: row.model_version || null },
        data_classification: classification, freshness: freshnessFromRow({ retrieved_at: row.computed_at }, clock),
        retrieved_at: timestamp(row.computed_at, clock()), confidence: confidenceFromRow(row),
        coverage: coverage(row.coverage_available, row.coverage_expected), providers: providerList(row.providers),
        provenance, limitations: row.model_version ? [] : ['no model-backed signal is available'], errors: [],
      };
    },

    async getCreatorDashboard(input) {
      const creatorKey = normalizedKey(input?.creator_key);
      const [profile, snapshots, media, analysis, score] = await Promise.all([
        service.getCreatorProfile({ creator_key: creatorKey }),
        service.getCreatorSnapshots({ creator_key: creatorKey, page: 1, page_size: 50 }),
        service.getCreatorMedia({ creator_key: creatorKey, page: 1, page_size: 50 }),
        service.getCreatorAnalytics({ creator_key: creatorKey }),
        service.getCreatorScore({ creator_key: creatorKey }),
      ]);
      const profileValue = profile.data || {};
      const profileMetrics = profileValue.metrics || {};
      const profileMetric = (value) => dashboardMetric(value, profile, { evidenceState: profile.data_classification });
      const history = (snapshots.data?.items || []).map((row) => ({
        observedAt: row.observed_at,
        followers: rowDashboardMetric(row, 'followers', snapshots),
        following: rowDashboardMetric(row, 'following', snapshots),
        mediaCount: rowDashboardMetric(row, 'media_count', snapshots),
        engagementRate: dashboardMetric(null, snapshots, { limitations: ['engagement_rate_not_persisted_in_profile_snapshot'] }),
      }));
      const recentMedia = (media.data?.items || []).map((row) => ({
        mediaKey: row.media_key,
        publishedAt: row.published_at || null,
        format: row.media_kind || 'unknown',
        likes: rowDashboardMetric(row, 'likes', media),
        comments: rowDashboardMetric(row, 'comments', media),
        views: rowDashboardMetric(row, 'views', media),
        reach: rowDashboardMetric(row, 'reach', media),
        engagementRate: dashboardMetric(null, media, { limitations: ['engagement_rate_is_available_only_in_derived_analytics'] }),
        outlier: dashboardMetric(null, media, { limitations: ['outlier_classification_is_available_only_in_derived_analytics'] }),
      }));
      const analysisMetrics = analysis.data?.metrics || {};
      const warnings = [...new Set([
        ...(analysis.limitations || []),
        ...(Array.isArray(analysisMetrics.limitations) ? analysisMetrics.limitations : []),
        ...(Array.isArray(analysisMetrics.growthAnomalies?.limitations) ? analysisMetrics.growthAnomalies.limitations : []),
      ])].slice(0, 32);
      const dashboardAnalysis = {
        postingCadence: analyticsMetric(analysisMetrics, ['postingCadence', 'postsPerDay'], analysis),
        medianLikes: analyticsMetric(analysisMetrics, ['likes'], analysis),
        medianComments: analyticsMetric(analysisMetrics, ['comments'], analysis),
        engagementRate: analyticsMetric(analysisMetrics, ['engagement', 'engagementRate'], analysis),
        medianViews: analyticsMetric(analysisMetrics, ['engagement', 'medianViews'], analysis),
        growthVelocity: analyticsMetric(analysisMetrics, ['profileGrowth', 'followers', 'growthVelocity'], analysis),
        growthAcceleration: analyticsMetric(analysisMetrics, ['profileGrowth', 'followers', 'growthAcceleration'], analysis),
        volatility: analyticsMetric(analysisMetrics, ['volatility', 'engagementRate', 'coefficientOfVariation'], analysis),
        outlierRatio: analyticsMetric(analysisMetrics, ['outliers', 'likes', 'outlierRatio'], analysis),
        warnings,
      };
      const dashboardScoreValue = dashboardScore(score);
      const qualityEnvelope = score.data ? score : (analysis.data ? analysis : profile);
      const coverageValue = qualityEnvelope.coverage || coverage(0, 1);
      const limitations = [...new Set([
        ...(profile.limitations || []),
        ...(snapshots.limitations || []),
        ...(media.limitations || []),
        ...(analysis.limitations || []),
        ...(score.limitations || []),
      ])].slice(0, 32);
      const providers = providerList([
        ...(profile.providers || []), ...(snapshots.providers || []), ...(media.providers || []),
        ...(analysis.providers || []), ...(score.providers || []),
      ]);
      const provenance = dashboardProvenance([profile, snapshots, media, analysis, score]);
      const classification = score.data_classification !== 'unavailable'
        ? score.data_classification
        : (analysis.data_classification !== 'unavailable' ? analysis.data_classification : profile.data_classification);
      return {
        data: {
          creator: {
            creatorKey: profileValue.creator_key || creatorKey,
            handle: profileValue.canonical_handle || null,
            displayName: null,
            registryState: profileValue.registry_state,
            provider: profile.providers?.[0] || null,
            addedAt: profileValue.updated_at || null,
          },
          profile: {
            followers: profileMetric(profileMetrics.followers),
            following: profileMetric(profileMetrics.following),
            mediaCount: profileMetric(profileMetrics.media_count),
            biography: dashboardMetric(null, profile, { limitations: ['biography_is_not_persisted'] }),
          },
          history,
          media: recentMedia,
          analysis: dashboardAnalysis,
          score: dashboardScoreValue,
          coverage: {
            availableMetrics: coverageValue.available_metrics,
            expectedMetrics: coverageValue.expected_metrics,
            ratio: coverageValue.ratio,
            freshness: qualityEnvelope.freshness,
            limitations,
          },
          provenance,
        },
        data_classification: classification,
        freshness: qualityEnvelope.freshness,
        retrieved_at: qualityEnvelope.retrieved_at,
        confidence: qualityEnvelope.confidence,
        coverage: coverageValue,
        providers,
        provenance: provenance.map((entry) => ({
          provider: entry.provider,
          source_type: entry.sourceType,
          source_ref: entry.sourceRef,
          observed_at: entry.observedAt,
          retrieved_at: entry.retrievedAt,
          evidence_state: entry.evidenceState,
        })),
        limitations,
        errors: [],
      };
    },

    async getCreatorScore(input) {
      const creatorKey = normalizedKey(input?.creator_key);
      const exists = await creatorRow(queryable, creatorKey);
      if (!exists) fail('NOT_FOUND');
      const result = await queryable.query(SQL.score, [creatorKey]);
      const row = result.rows?.[0];
      if (!row) return unavailable(clock, 'score', 'Influencer Score has not been computed', null);
      if (dataClassification(row) === 'unavailable') return unavailable(clock, 'score', 'Influencer Score is unavailable', providerList(row.providers)[0] || null);
      const componentsResult = await queryable.query(SQL.components, [row.score_key]);
      const classification = dataClassification(row);
      return {
        data: rowScore(row, componentsResult.rows || []), data_classification: classification,
        freshness: freshnessFromRow({ retrieved_at: row.computed_at }, clock), retrieved_at: timestamp(row.computed_at, clock()),
        confidence: confidenceFromRow(row), coverage: coverage(row.coverage_available, row.coverage_expected),
        providers: providerList(row.providers), provenance: rowProvenance(row, 'score', classification),
        limitations: [], errors: [],
      };
    },

    async getCampaignFit(input) {
      const campaignKey = normalizedKey(input?.campaign_key);
      const version = Number.isSafeInteger(input?.campaign_version) ? input.campaign_version : 1;
      if (version < 1) fail('INVALID_INPUT');
      const creatorKeys = input?.creator_keys === undefined ? null : input.creator_keys.map(normalizedKey);
      const page = boundedPage(input?.page, 1, 100_000);
      const limit = boundedLimit(input?.page_size);
      const sql = creatorKeys ? SQL.campaignFitSelected : SQL.campaignFitAll;
      const params = creatorKeys
        ? [campaignKey, version, creatorKeys, limit, (page - 1) * limit]
        : [campaignKey, version, limit, (page - 1) * limit];
      const result = await queryable.query(sql, params);
      const rows = result.rows || [];
      if (!rows.length) return unavailable(clock, 'campaign-fit', 'campaign fit has not been computed', null);
      const first = rows[0];
      const classification = dataClassification(first);
      if (classification === 'unavailable') return unavailable(clock, 'campaign-fit', 'campaign fit is unavailable', providerList(first.providers)[0] || null);
      return {
        data: { campaign_key: campaignKey, campaign_version: version, items: rows.map(rowFit), page, page_size: limit },
        data_classification: classification, freshness: freshnessFromRow({ retrieved_at: first.computed_at }, clock),
        retrieved_at: timestamp(first.computed_at, clock()), confidence: Math.min(...rows.map((row) => confidenceFromRow(row))),
        coverage: coverage(first.coverage_available, first.coverage_expected), providers: providerFromRows(rows),
        provenance: rowProvenance(first, 'campaign-fit', classification), limitations: [], errors: [],
      };
    },

    async compareCreators(input) {
      if (!Array.isArray(input?.creator_keys) || input.creator_keys.length < 1 || input.creator_keys.length > 20) fail('INVALID_INPUT');
      const creatorKeys = [...new Set(input.creator_keys.map(normalizedKey))];
      const result = await queryable.query(SQL.compare, [creatorKeys]);
      const rows = result.rows || [];
      if (!rows.length) return unavailable(clock, 'comparison', 'no persisted scores are available for comparison', null);
      const classification = rows.some((row) => row.evidence_state === 'inferred') ? 'inferred' : 'derived';
      if (rows.every((row) => dataClassification(row) === 'unavailable')) return unavailable(clock, 'comparison', 'persisted scores are unavailable for comparison', null);
      return {
        data: { items: rows.map((row) => ({ creator_key: row.creator_key, score: row.score ?? null, confidence: confidenceFromRow(row), data_coverage: coverage(row.coverage_available, row.coverage_expected).ratio, algorithm_version: row.algorithm_version, weights_version: row.weights_version || null, calculated_at: row.computed_at })) },
        data_classification: classification, freshness: freshnessFromRow({ retrieved_at: rows[0].computed_at }, clock), retrieved_at: timestamp(rows[0].computed_at, clock()),
        confidence: Math.min(...rows.map((row) => confidenceFromRow(row))), coverage: coverage(rows.length, creatorKeys.length),
        providers: providerFromRows(rows), provenance: rowProvenance(rows[0], 'comparison', classification),
        limitations: rows.length < creatorKeys.length ? ['some requested creators have no persisted score'] : [], errors: [],
      };
    },
  };

  return Object.freeze(service);
}

export const __testing = Object.freeze({
  SQL,
  coverage,
  freshnessFromRow,
  profileData,
  rowMedia,
  rowSnapshot,
});
