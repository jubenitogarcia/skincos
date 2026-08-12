/**
 * Deterministic Influencer Score v0 over the normalized analytics artifact.
 *
 * This boundary intentionally owns no provider, persistence, scheduling,
 * prompt, or network behavior. Optional comment, commercial, and brand-fit
 * inputs must arrive as bounded structured signals with evidence references.
 * Missing signals remain unavailable; they are never coerced to zero.
 */

import { createHash } from 'node:crypto';

export const SCORING_CONTRACT_VERSION = 'influencer-intelligence/scoring/v0';
export const SCORING_ALGORITHM_VERSION = 'influencer-intelligence-scoring/v0.1';
export const SCORING_WEIGHTS_VERSION = 'influencer-intelligence-scoring-weights/v0';

export const SCORE_COMPONENTS = Object.freeze([
  'engagement_quality',
  'growth_integrity',
  'content_performance',
  'consistency',
  'comment_quality',
  'commercial_saturation',
  'brand_fit',
  'risk',
  'profile_integrity',
]);

export const SCORE_WEIGHTS = Object.freeze({
  engagement_quality: 0.20,
  growth_integrity: 0.14,
  content_performance: 0.16,
  consistency: 0.12,
  comment_quality: 0.08,
  commercial_saturation: 0.08,
  brand_fit: 0.08,
  risk: 0.08,
  profile_integrity: 0.06,
});

export const SCORE_THRESHOLDS = Object.freeze({
  engagementRate: Object.freeze({ low: 0, high: 0.08 }),
  commentLikeRatio: Object.freeze({ low: 0, high: 0.25 }),
  viewsFollowerRatio: Object.freeze({ low: 0, high: 2 }),
  freshnessDays: Object.freeze({ fresh: 2, recent: 7, aging: 30, stale: 90 }),
  minimumProfileHistory: 6,
  minimumMediaHistory: 12,
  commentSampleConfidenceSize: 100,
  shortHistoryConfidenceCap: 0.55,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const PROVIDER_RELIABILITY = Object.freeze({
  'meta-graph': 1,
  instagrapi: 0.68,
});

function fail(code, message) {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RECORD', `${label} must be an object`);
  }
}

function finite(value, label, { minimum = -Infinity, maximum = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail('INVALID_NUMBER', `${label} must be finite and within its allowed range`);
  }
  return value;
}

function optionalFinite(value, label, options) {
  if (value === undefined || value === null) return null;
  return finite(value, label, options);
}

function boundedInteger(value, label, { minimum = 0, maximum = 10000 } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail('INVALID_INTEGER', `${label} must be a bounded integer`);
  }
  return value;
}

function boundedString(value, label, pattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('INVALID_STRING', `${label} is invalid`);
  return value;
}

function isoTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_TIMESTAMP', `${label} must be a parseable ISO timestamp`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 6) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function get(record, path) {
  return path.split('.').reduce((current, key) => current?.[key], record);
}

function availableMetric(record, path) {
  const value = get(record, path);
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value !== null && 'value' in value) {
    if (value.value === null || value.evidenceState === 'unavailable') return null;
    return Number.isFinite(value.value) ? value.value : null;
  }
  return Number.isFinite(value) ? value : null;
}

function metricEvidence(record, path) {
  const value = get(record, path);
  if (value && typeof value === 'object' && 'evidenceState' in value) return value.evidenceState;
  return availableMetric(record, path) === null ? 'unavailable' : 'derived';
}

function ratioScore(value, { low, high }) {
  if (value === null) return null;
  if (high <= low) fail('INVALID_THRESHOLD', 'ratio threshold must have positive span');
  return clamp(((value - low) / (high - low)) * 100);
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value))].sort();
}

function sourceRefs(analytics, extra = []) {
  const refs = [
    ...(Array.isArray(analytics.inputSnapshotKeys) ? analytics.inputSnapshotKeys : []),
    ...(Array.isArray(analytics.provenance) ? analytics.provenance.map((item) => item.sourceRef) : []),
    ...extra,
  ];
  return unique(refs).slice(0, 32);
}

function providersFor(analytics, signals) {
  return unique([
    ...(Array.isArray(analytics.providers) ? analytics.providers : []),
    ...Object.values(signals || {}).flatMap((signal) => Array.isArray(signal?.providers) ? signal.providers : []),
  ]);
}

function unavailableComponent(name, weight, reasonCode, inputs = {}) {
  return {
    component_name: name,
    score: null,
    weight,
    effective_weight: 0,
    contribution: null,
    evidence_state: 'unavailable',
    confidence: 0,
    evidence_refs: [],
    explanation: {
      code: reasonCode,
      inputs,
      limitations: ['insufficient_observed_or_derived_inputs'],
    },
  };
}

function derivedComponent(name, weight, score, confidence, refs, code, inputs, limitations = []) {
  return {
    component_name: name,
    score: round(clamp(score)),
    weight,
    effective_weight: weight,
    contribution: null,
    evidence_state: 'derived',
    confidence: round(clamp(confidence, 0, 1), 6),
    evidence_refs: unique(refs).slice(0, 32),
    explanation: {
      code,
      inputs,
      limitations,
    },
  };
}

function normalizeStructuredSignal(name, signal, weight) {
  if (signal === undefined || signal === null) return unavailableComponent(name, weight, 'structured_signal_unavailable');
  assertRecord(signal, `${name} signal`);
  const evidenceState = signal.evidence_state || signal.evidenceState;
  if (!['observed', 'derived', 'inferred', 'unavailable'].includes(evidenceState)) {
    fail('INVALID_SIGNAL_STATE', `${name} signal evidence state is invalid`);
  }
  const score = optionalFinite(signal.score ?? signal.value, `${name}.score`, { minimum: 0, maximum: 100 });
  const confidence = finite(signal.confidence ?? 0, `${name}.confidence`, { minimum: 0, maximum: 1 });
  const refs = signal.evidence_refs || signal.evidenceRefs || [];
  if (!Array.isArray(refs) || refs.length > 32 || refs.some((ref) => typeof ref !== 'string' || !ref)) {
    fail('INVALID_SIGNAL_REFS', `${name} signal evidence references are invalid`);
  }
  if (evidenceState === 'unavailable') {
    if (score !== null || confidence !== 0) fail('UNAVAILABLE_SIGNAL_HAS_VALUE', `${name} unavailable signal must be value-free`);
    return unavailableComponent(name, weight, 'structured_signal_unavailable', { sample_size: signal.sample_size ?? null });
  }
  if (score === null || refs.length === 0) fail('AVAILABLE_SIGNAL_EVIDENCE_REQUIRED', `${name} signal requires score and evidence refs`);
  const modelVersion = signal.model_version || signal.modelVersion || null;
  if (evidenceState === 'inferred' && !modelVersion) fail('INFERRED_SIGNAL_MODEL_REQUIRED', `${name} inferred signal requires model version`);
  return {
    component_name: name,
    score: round(score),
    weight,
    effective_weight: weight,
    contribution: null,
    evidence_state: evidenceState,
    confidence: round(confidence, 6),
    evidence_refs: unique(refs).slice(0, 32),
    ...(modelVersion ? { model_version: boundedString(modelVersion, `${name}.model_version`) } : {}),
    explanation: {
      code: 'structured_signal_used_without_recalculation',
      inputs: {
        sample_size: signal.sample_size ?? signal.sampleSize ?? null,
        signal_state: evidenceState,
      },
      limitations: [],
    },
  };
}

function profileHistoryLength(analytics) {
  return Array.isArray(analytics.provenance)
    ? new Set(analytics.provenance
      .filter((item) => item.sourceType === 'profile' && item.evidenceState === 'observed')
      .map((item) => item.sourceRef)).size
    : 0;
}

function mediaHistoryLength(analytics) {
  return Array.isArray(analytics.provenance)
    ? new Set(analytics.provenance
      .filter((item) => item.sourceType === 'media' && item.evidenceState === 'observed')
      .map((item) => item.sourceRef)).size
    : 0;
}

function engagementQuality(analytics, weight) {
  const engagementRate = availableMetric(analytics, 'engagement.engagementRate.median');
  if (engagementRate === null) return unavailableComponent('engagement_quality', weight, 'engagement_rate_unavailable');
  const commentLike = availableMetric(analytics, 'engagement.commentLikeRatio.median');
  const rateScore = ratioScore(engagementRate, SCORE_THRESHOLDS.engagementRate);
  const commentScore = ratioScore(commentLike, SCORE_THRESHOLDS.commentLikeRatio);
  const score = commentScore === null ? rateScore : ((rateScore * 0.8) + (commentScore * 0.2));
  const confidence = clamp((get(analytics, 'engagement.confidence') ?? 0) * (commentScore === null ? 0.75 : 1), 0, 1);
  return derivedComponent(
    'engagement_quality', weight, score, confidence, sourceRefs(analytics),
    commentScore === null ? 'median_engagement_rate_normalized' : 'engagement_and_comment_like_ratio_normalized',
    { median_engagement_rate: engagementRate, median_comment_like_ratio: commentLike, rate_score: round(rateScore), comment_score: round(commentScore) },
    commentScore === null ? ['comment_like_ratio_unavailable'] : [],
  );
}

function growthIntegrity(analytics, weight) {
  const absoluteDelta = availableMetric(analytics, 'profileGrowth.followers.absoluteDelta');
  if (absoluteDelta === null) return unavailableComponent('growth_integrity', weight, 'growth_history_unavailable');
  const anomalyRatio = availableMetric(analytics, 'growthAnomalies.anomalyRatio');
  const anomalyAvailable = metricEvidence(analytics, 'growthAnomalies.anomalyRatio') !== 'unavailable';
  const score = anomalyAvailable ? 75 - (clamp(anomalyRatio, 0, 1) * 75) : 60;
  const history = profileHistoryLength(analytics);
  const confidence = clamp(Math.min(1, history / SCORE_THRESHOLDS.minimumProfileHistory) * (anomalyAvailable ? 1 : 0.55));
  return derivedComponent(
    'growth_integrity', weight, score, confidence, sourceRefs(analytics),
    anomalyAvailable ? 'growth_anomaly_ratio_penalty' : 'growth_history_without_anomaly_coverage',
    { absolute_delta: absoluteDelta, anomaly_ratio: anomalyRatio, history_length: history },
    anomalyAvailable ? [] : ['growth_anomaly_coverage_limited'],
  );
}

function contentPerformance(analytics, weight) {
  const engagementRate = availableMetric(analytics, 'engagement.engagementRate.median');
  const viewsFollowerRatio = availableMetric(analytics, 'engagement.viewsFollowerRatio.median');
  if (engagementRate === null && viewsFollowerRatio === null) return unavailableComponent('content_performance', weight, 'normalized_content_metrics_unavailable');
  const engagementScore = ratioScore(engagementRate, SCORE_THRESHOLDS.engagementRate);
  const viewsScore = ratioScore(viewsFollowerRatio, SCORE_THRESHOLDS.viewsFollowerRatio);
  const score = engagementScore === null ? viewsScore : (viewsScore === null ? engagementScore : ((engagementScore * 0.6) + (viewsScore * 0.4)));
  const availableSignals = [engagementScore, viewsScore].filter((value) => value !== null).length;
  const confidence = clamp((availableSignals / 2) * (get(analytics, 'engagement.confidence') ?? 0));
  return derivedComponent(
    'content_performance', weight, score, confidence, sourceRefs(analytics),
    availableSignals === 2 ? 'engagement_and_views_per_follower_normalized' : 'single_normalized_content_metric',
    { median_engagement_rate: engagementRate, median_views_follower_ratio: viewsFollowerRatio, available_signals: availableSignals },
    availableSignals === 1 ? ['one_normalized_content_metric_unavailable'] : [],
  );
}

function consistency(analytics, weight) {
  const intervalMean = availableMetric(analytics, 'postingCadence.postingInterval.mean');
  const intervalStd = availableMetric(analytics, 'postingCadence.postingInterval.standardDeviation');
  const engagementCv = availableMetric(analytics, 'volatility.engagementRate.coefficientOfVariation');
  if (intervalMean === null && engagementCv === null) return unavailableComponent('consistency', weight, 'cadence_and_volatility_unavailable');
  const cadenceScore = intervalMean !== null && intervalStd !== null && intervalMean > 0
    ? clamp(100 - ((intervalStd / intervalMean) * 100))
    : null;
  const engagementScore = engagementCv !== null ? clamp(100 - (engagementCv * 50)) : null;
  const values = [cadenceScore, engagementScore].filter((value) => value !== null);
  const score = values.reduce((sum, value) => sum + value, 0) / values.length;
  const postCount = mediaHistoryLength(analytics);
  const confidence = clamp((values.length / 2) * Math.min(1, postCount / SCORE_THRESHOLDS.minimumMediaHistory));
  return derivedComponent(
    'consistency', weight, score, confidence, sourceRefs(analytics),
    values.length === 2 ? 'cadence_and_engagement_volatility' : 'single_consistency_signal',
    { posting_interval_mean: intervalMean, posting_interval_standard_deviation: intervalStd, engagement_cv: engagementCv, media_history_length: postCount },
    values.length === 1 ? ['one_consistency_signal_unavailable'] : [],
  );
}

function risk(analytics, weight) {
  const anomalyRatio = availableMetric(analytics, 'growthAnomalies.anomalyRatio');
  const likesOutlierRatio = availableMetric(analytics, 'outliers.likes.viralOutlierRatio');
  const viewsOutlierRatio = availableMetric(analytics, 'outliers.views.viralOutlierRatio');
  if (anomalyRatio === null && likesOutlierRatio === null && viewsOutlierRatio === null) {
    return unavailableComponent('risk', weight, 'risk_signals_unavailable');
  }
  const growthPenalty = anomalyRatio === null ? null : clamp(anomalyRatio, 0, 1) * 70;
  const outlierRatios = [likesOutlierRatio, viewsOutlierRatio].filter((value) => value !== null);
  const outlierPenalty = outlierRatios.length === 0 ? null : Math.max(...outlierRatios) * 20;
  const penalties = [growthPenalty, outlierPenalty].filter((value) => value !== null);
  const score = clamp(100 - penalties.reduce((sum, value) => sum + value, 0));
  const availableSignals = [anomalyRatio, likesOutlierRatio, viewsOutlierRatio].filter((value) => value !== null).length;
  const confidence = clamp(availableSignals / 3);
  return derivedComponent(
    'risk', weight, score, confidence, sourceRefs(analytics),
    'bounded_pattern_risk_not_fake_followers_claim',
    { growth_anomaly_ratio: anomalyRatio, growth_penalty: growthPenalty, likes_viral_outlier_ratio: likesOutlierRatio, views_viral_outlier_ratio: viewsOutlierRatio, outlier_penalty: outlierPenalty },
    ['pattern_signals_are_not_a_fake_followers_determination'],
  );
}

function profileIntegrity(analytics, weight) {
  const history = profileHistoryLength(analytics);
  const profileCoverage = optionalFinite(get(analytics, 'profileGrowth.coverage.ratio'), 'profileGrowth.coverage.ratio', { minimum: 0, maximum: 1 });
  if (history === 0 || profileCoverage === null) return unavailableComponent('profile_integrity', weight, 'profile_observations_unavailable');
  const score = clamp(profileCoverage * 100);
  const confidence = clamp(Math.min(1, history / SCORE_THRESHOLDS.minimumProfileHistory) * profileCoverage);
  return derivedComponent(
    'profile_integrity', weight, score, confidence, sourceRefs(analytics),
    'profile_metric_coverage_and_history_length',
    { profile_history_length: history, profile_metric_coverage: profileCoverage },
    history < SCORE_THRESHOLDS.minimumProfileHistory ? ['short_profile_history'] : [],
  );
}

function normalizeAnalytics(analytics) {
  assertRecord(analytics, 'analytics');
  const creatorKey = boundedString(analytics.creatorKey, 'analytics.creatorKey', /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/);
  const calculatedAt = isoTimestamp(analytics.computedAt, 'analytics.computedAt');
  const evidenceState = analytics.evidenceState;
  if (!['derived', 'unavailable'].includes(evidenceState)) fail('INVALID_ANALYTICS_STATE', 'analytics must be derived or unavailable');
  assertRecord(analytics.coverage, 'analytics.coverage');
  const coverageRatio = finite(analytics.coverage.ratio, 'analytics.coverage.ratio', { minimum: 0, maximum: 1 });
  const providers = unique(Array.isArray(analytics.providers) ? analytics.providers : []);
  const provenance = Array.isArray(analytics.provenance) ? analytics.provenance : [];
  return { ...analytics, creatorKey, calculatedAt, evidenceState, coverageRatio, providers, provenance };
}

function freshnessFactor(analytics, calculatedAt) {
  const observedTimes = analytics.provenance.map((item) => Date.parse(item.observedAt)).filter(Number.isFinite);
  if (observedTimes.length === 0) return 0;
  const ageDays = Math.max(0, (Date.parse(calculatedAt) - Math.max(...observedTimes)) / DAY_MS);
  const { fresh, recent, aging, stale } = SCORE_THRESHOLDS.freshnessDays;
  if (ageDays <= fresh) return 1;
  if (ageDays <= recent) return 0.8;
  if (ageDays <= aging) return 0.5;
  if (ageDays <= stale) return 0.2;
  return 0.05;
}

function providerFactor(providers) {
  if (providers.length === 0) return 0;
  return Math.min(...providers.map((provider) => PROVIDER_RELIABILITY[provider] ?? 0.4));
}

function optionalSignalFactor(signal) {
  if (!signal || signal.evidence_state === 'unavailable' || signal.evidenceState === 'unavailable') return 0.2;
  const sampleSize = signal.sample_size ?? signal.sampleSize;
  if (Number.isFinite(sampleSize)) return Math.min(1, Math.max(0, sampleSize) / SCORE_THRESHOLDS.commentSampleConfidenceSize);
  return finite(signal.confidence ?? 0, 'structured signal confidence', { minimum: 0, maximum: 1 });
}

function confidenceScore(analytics, components, signals) {
  const historyFactor = Math.min(1, profileHistoryLength(analytics) / SCORE_THRESHOLDS.minimumProfileHistory);
  const mediaFactor = Math.min(1, mediaHistoryLength(analytics) / SCORE_THRESHOLDS.minimumMediaHistory);
  const freshness = freshnessFactor(analytics, analytics.calculatedAt);
  const providers = providersFor(analytics, signals);
  const official = providers.includes('meta-graph') ? 1 : (providers.includes('instagrapi') ? 0.55 : 0);
  const comments = optionalSignalFactor(signals.comment_quality);
  const metricCoverage = analytics.coverageRatio;
  const reliability = providerFactor(providers);
  const factors = {
    history_length: historyFactor,
    media_history_length: mediaFactor,
    comment_sample_size: comments,
    freshness,
    provider_reliability: reliability,
    official_availability: official,
    metric_coverage: metricCoverage,
  };
  const weighted = (
    (historyFactor * 0.18)
    + (mediaFactor * 0.18)
    + (comments * 0.10)
    + (freshness * 0.14)
    + (reliability * 0.14)
    + (official * 0.10)
    + (metricCoverage * 0.16)
  );
  const shortHistory = profileHistoryLength(analytics) < 2 || mediaHistoryLength(analytics) < 2;
  const historyGate = shortHistory ? SCORE_THRESHOLDS.shortHistoryConfidenceCap : 1;
  const available = Object.values(components).filter((component) => component.score !== null).length;
  return {
    score: round(clamp(Math.min(weighted, historyGate) * 100)),
    factors: { ...factors, short_history_gate: historyGate },
    available_components: available,
  };
}

function dataCoverage(analytics, components) {
  const availableWeight = Object.values(components).reduce((sum, component) => sum + (component.score === null ? 0 : component.weight), 0);
  const ratio = (analytics.coverageRatio * 0.65) + (availableWeight * 0.35);
  return { score: round(clamp(ratio * 100)), analytics_ratio: analytics.coverageRatio, component_weight_ratio: round(availableWeight) };
}

function inputFingerprint(analytics, components, providers) {
  const canonical = JSON.stringify({
    creatorKey: analytics.creatorKey,
    algorithmVersion: analytics.algorithmVersion || null,
    computedAt: analytics.calculatedAt,
    evidenceState: analytics.evidenceState,
    coverage: analytics.coverage,
    providers: [...(providers || [])].sort(),
    provenance: analytics.provenance || [],
    window: analytics.window || null,
    snapshots: [...(analytics.inputSnapshotKeys || [])].sort(),
    components: Object.values(components).map((component) => ({
      component_name: component.component_name,
      score: component.score,
      evidence_state: component.evidence_state,
      confidence: component.confidence,
      model_version: component.model_version || null,
      weight: component.weight,
      effective_weight: component.effective_weight || null,
      contribution: component.contribution ?? null,
      explanation: component.explanation,
      evidence_refs: component.evidence_refs,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function computeInfluencerScore(input) {
  assertRecord(input, 'input');
  const analytics = normalizeAnalytics(input.analytics);
  const structuredSignals = input.structured_signals || input.structuredSignals || {};
  assertRecord(structuredSignals, 'structuredSignals');
  const weights = { ...SCORE_WEIGHTS };
  const components = {
    engagement_quality: engagementQuality(analytics, weights.engagement_quality),
    growth_integrity: growthIntegrity(analytics, weights.growth_integrity),
    content_performance: contentPerformance(analytics, weights.content_performance),
    consistency: consistency(analytics, weights.consistency),
    comment_quality: normalizeStructuredSignal('comment_quality', structuredSignals.comment_quality, weights.comment_quality),
    commercial_saturation: normalizeStructuredSignal('commercial_saturation', structuredSignals.commercial_saturation, weights.commercial_saturation),
    brand_fit: normalizeStructuredSignal('brand_fit', structuredSignals.brand_fit, weights.brand_fit),
    risk: risk(analytics, weights.risk),
    profile_integrity: profileIntegrity(analytics, weights.profile_integrity),
  };
  const available = Object.values(components).filter((component) => component.score !== null);
  const weightTotal = available.reduce((sum, component) => sum + component.weight, 0);
  if (weightTotal > 0) {
    for (const component of available) {
      component.effective_weight = component.weight / weightTotal;
      component.contribution = round(component.score * component.effective_weight);
    }
  }
  const overall = weightTotal > 0
    ? available.reduce((sum, component) => sum + component.contribution, 0)
    : null;
  const providers = providersFor(analytics, structuredSignals);
  const provenance = analytics.provenance.slice(0, 32);
  const coverage = dataCoverage(analytics, components);
  const confidence = confidenceScore(analytics, components, structuredSignals);
  const calculatedAt = isoTimestamp(input.calculated_at || input.calculatedAt || analytics.calculatedAt, 'calculatedAt');
  const result = {
    contract_version: SCORING_CONTRACT_VERSION,
    score_kind: 'influencer',
    creator_key: analytics.creatorKey,
    overall_score: overall === null ? null : round(clamp(overall)),
    confidence_score: analytics.evidenceState === 'unavailable' ? 0 : confidence.score,
    data_coverage: coverage.score,
    evidence_state: overall === null ? 'unavailable' : 'derived',
    algorithm_version: SCORING_ALGORITHM_VERSION,
    weights_version: SCORING_WEIGHTS_VERSION,
    calculated_at: calculatedAt,
    component_scores: components,
    weights,
    confidence_factors: confidence.factors,
    coverage,
    providers,
    provenance,
    input_snapshot_keys: [...(analytics.inputSnapshotKeys || [])].sort(),
    input_evidence_refs: sourceRefs(analytics, Object.values(structuredSignals).flatMap((signal) => signal?.evidence_refs || signal?.evidenceRefs || [])),
    input_fingerprint: inputFingerprint(analytics, components, providers),
    explanations: Object.values(components).map((component) => ({
      component_name: component.component_name,
      code: component.explanation.code,
      inputs: component.explanation.inputs,
      limitations: component.explanation.limitations,
    })),
    limitations: [
      ...(weightTotal < 1 ? ['one_or_more_component_inputs_unavailable'] : []),
      ...(confidence.score < 60 ? ['confidence_limited_by_history_freshness_provider_or_metric_coverage'] : []),
      ...(analytics.evidenceState === 'unavailable' ? ['analytics_unavailable'] : []),
    ],
  };
  return deepFreeze(result);
}

export const __testing = Object.freeze({ ratioScore, freshnessFactor, providerFactor, inputFingerprint });
