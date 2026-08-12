/**
 * Deterministic Campaign Fit boundary.
 *
 * This module consumes already-normalized, bounded evidence. It does not call
 * providers, an LLM, PostgreSQL, Orb, CRM, or the network. A campaign brief
 * changes the interpretation of creator evidence; it never changes the
 * Influencer Score weights and never infers missing audience demographics.
 */

import { createHash } from 'node:crypto';

export const CAMPAIGN_FIT_CONTRACT_VERSION = 'influencer-intelligence/campaign-fit/v1';
export const CAMPAIGN_FIT_ALGORITHM_VERSION = 'influencer-intelligence-campaign-fit/v1';
export const CAMPAIGN_FIT_WEIGHTS_VERSION = 'influencer-intelligence-campaign-fit-weights/v1';

export const CAMPAIGN_FIT_COMPONENTS = Object.freeze([
  'topic_affinity',
  'category_affinity',
  'audience_fit',
  'historical_content',
  'commercial_saturation',
  'competitor_conflict',
  'format_affinity',
  'brand_safety',
  'engagement_quality',
]);

export const CAMPAIGN_FIT_WEIGHTS = Object.freeze({
  topic_affinity: 0.18,
  category_affinity: 0.18,
  audience_fit: 0.15,
  historical_content: 0.12,
  commercial_saturation: 0.10,
  competitor_conflict: 0.10,
  format_affinity: 0.05,
  brand_safety: 0.07,
  engagement_quality: 0.05,
});

const COMPONENT_SET = new Set(CAMPAIGN_FIT_COMPONENTS);
const EVIDENCE_STATES = new Set(['observed', 'derived', 'inferred', 'unavailable']);
const FRESHNESS_VALUES = new Set(['fresh', 'stale', 'unknown']);
const PROVIDER_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const VERSION_PATTERN = /^[a-z][a-z0-9._/-]{0,79}$/;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const DIRECT_CONTACT_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b|(?:\+?\d[\d\s().-]{7,}\d)/;
const CREDENTIAL_PATTERN = /(?:access[_-]?token|refresh[_-]?token|authorization|cookie|password|secret|api[_-]?key)\s*[:=]/i;
const MAX_BRIEF_TERMS = 32;
const MAX_SIGNAL_TERMS = 64;
const MAX_EVIDENCE_REFS = 16;

export class CampaignFitError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'CampaignFitError';
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new CampaignFitError(code, message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function boundedText(value, label, { maximum = 160, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${label.toUpperCase()}_REQUIRED`);
    return undefined;
  }
  if (typeof value !== 'string') fail(`${label.toUpperCase()}_INVALID`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    fail(`${label.toUpperCase()}_INVALID`);
  }
  if (DIRECT_CONTACT_PATTERN.test(normalized) || CREDENTIAL_PATTERN.test(normalized)) {
    fail(`${label.toUpperCase()}_SENSITIVE_TEXT`);
  }
  return normalized;
}

function optionalText(value, label, options = {}) {
  return boundedText(value, label, { ...options, required: false });
}

function normalizedTerm(value, label) {
  const text = boundedText(value, label, { maximum: 80 });
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function termArray(value, label, { maximum = MAX_BRIEF_TERMS } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximum) fail(`${label.toUpperCase()}_INVALID`);
  const terms = value.map((item, index) => normalizedTerm(item, `${label}[${index}]`));
  if (new Set(terms).size !== terms.length) fail(`${label.toUpperCase()}_DUPLICATE`);
  return terms.sort();
}

function safeKey(value, label, { required = true } = {}) {
  const normalized = boundedText(value, label, { maximum: 240, required });
  if (normalized === undefined) return undefined;
  if (!KEY_PATTERN.test(normalized)) fail(`${label.toUpperCase()}_INVALID`);
  return normalized;
}

function version(value, label, { required = true } = {}) {
  const normalized = boundedText(value, label, { maximum: 80, required });
  if (normalized === undefined) return undefined;
  if (!VERSION_PATTERN.test(normalized.toLowerCase())) fail(`${label.toUpperCase()}_INVALID`);
  return normalized.toLowerCase();
}

function finite(value, label, { minimum = -Infinity, maximum = Infinity, required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    fail(`${label.toUpperCase()}_REQUIRED`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label.toUpperCase()}_INVALID`);
  }
  return Number(value.toFixed(6));
}

function score(value, label = 'score') {
  return finite(value, label, { minimum: 0, maximum: 100 });
}

function ratio(value, label = 'ratio') {
  return finite(value, label, { minimum: 0, maximum: 1 });
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 40 || CONTROL_CHARACTER_PATTERN.test(value)) {
    fail(`${label.toUpperCase()}_INVALID`);
  }
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) fail(`${label.toUpperCase()}_INVALID`);
  return parsed.toISOString();
}

function normalizeEvidenceState(value, label) {
  const normalized = boundedText(value, label, { maximum: 20 }).toLowerCase();
  if (!EVIDENCE_STATES.has(normalized)) fail(`${label.toUpperCase()}_INVALID`);
  return normalized;
}

function normalizeFreshness(value, label) {
  const normalized = boundedText(value || 'unknown', label, { maximum: 20 }).toLowerCase();
  if (!FRESHNESS_VALUES.has(normalized)) fail(`${label.toUpperCase()}_INVALID`);
  return normalized;
}

function normalizeProviders(value, label, evidenceState) {
  if (value === undefined || value === null) {
    if (evidenceState === 'unavailable') return [];
    fail(`${label.toUpperCase()}_REQUIRED`);
  }
  if (!Array.isArray(value) || value.length > 8) fail(`${label.toUpperCase()}_INVALID`);
  const providers = value.map((item, index) => {
    const provider = boundedText(item, `${label}[${index}]`, { maximum: 64 }).toLowerCase();
    if (!PROVIDER_PATTERN.test(provider)) fail(`${label.toUpperCase()}_INVALID`);
    return provider;
  });
  return [...new Set(providers)].sort();
}

function normalizeEvidenceRefs(value, label, evidenceState) {
  if (value === undefined || value === null) {
    if (evidenceState === 'unavailable') return [];
    fail(`${label.toUpperCase()}_REQUIRED`);
  }
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFS) fail(`${label.toUpperCase()}_INVALID`);
  const refs = value.map((item, index) => safeKey(item, `${label}[${index}]`));
  if (new Set(refs).size !== refs.length) fail(`${label.toUpperCase()}_DUPLICATE`);
  return refs;
}

function normalizeScalarMap(value, label) {
  if (!isRecord(value) || Object.keys(value).length > MAX_SIGNAL_TERMS) fail(`${label.toUpperCase()}_INVALID`);
  const result = {};
  let total = 0;
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = normalizedTerm(key, `${label}.key`);
    if (Object.prototype.hasOwnProperty.call(result, normalizedKey)) fail(`${label.toUpperCase()}_DUPLICATE`);
    const share = ratio(raw, `${label}.${key}`);
    total += share;
    if (total > 1.000001) fail(`${label.toUpperCase()}_DISTRIBUTION_INVALID`);
    result[normalizedKey] = share;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeSignalValue(key, value) {
  if (value === null || value === undefined) return null;
  if (['topics', 'product_categories', 'brands_mentioned', 'competitors', 'brand_safety_flags', 'historical_content'].includes(key)) {
    if (key === 'historical_content' && isRecord(value)) {
      const allowed = new Set(['topics', 'product_categories', 'brands_mentioned', 'competitors']);
      if (Object.keys(value).some((item) => !allowed.has(item))) fail('HISTORICAL_CONTENT_FIELD_FORBIDDEN');
      return Object.fromEntries([...allowed]
        .filter((field) => value[field] !== undefined)
        .map((field) => [field, termArray(value[field], `historical_content.${field}`, { maximum: MAX_SIGNAL_TERMS })]));
    }
    return termArray(value, key, { maximum: MAX_SIGNAL_TERMS });
  }
  if (['audience_geography', 'audience_gender', 'audience_age', 'content_formats'].includes(key)) {
    if (Array.isArray(value)) return termArray(value, key, { maximum: MAX_SIGNAL_TERMS });
    return normalizeScalarMap(value, key);
  }
  if (['commercial_saturation', 'sponsored_ratio'].includes(key)) return ratio(value, key);
  if (key === 'engagement_quality') return score(value, key);
  fail('SIGNAL_KEY_UNSUPPORTED');
}

function normalizeSignal(value, key) {
  if (!isRecord(value)) fail(`${key.toUpperCase()}_SIGNAL_INVALID`);
  const allowed = new Set([
    'value', 'evidence_state', 'evidenceState', 'confidence', 'evidence_refs', 'evidenceRefs',
    'providers', 'freshness', 'limitations', 'model_version', 'modelVersion', 'provenance',
  ]);
  if (Object.keys(value).some((item) => !allowed.has(item))) fail(`${key.toUpperCase()}_SIGNAL_FIELD_FORBIDDEN`);
  const evidenceState = normalizeEvidenceState(value.evidence_state ?? value.evidenceState ?? 'unavailable', `${key}.evidence_state`);
  const normalizedValue = evidenceState === 'unavailable' ? null : normalizeSignalValue(key, value.value);
  if (evidenceState !== 'unavailable' && normalizedValue === null) fail(`${key.toUpperCase()}_SIGNAL_VALUE_REQUIRED`);
  const confidence = evidenceState === 'unavailable' ? 0 : ratio(value.confidence, `${key}.confidence`);
  const evidenceRefs = normalizeEvidenceRefs(value.evidence_refs ?? value.evidenceRefs, `${key}.evidence_refs`, evidenceState);
  if (evidenceState !== 'unavailable' && evidenceRefs.length === 0) fail(`${key.toUpperCase()}_EVIDENCE_REQUIRED`);
  if (evidenceState === 'unavailable' && value.value !== undefined && value.value !== null) fail(`${key.toUpperCase()}_UNAVAILABLE_VALUE_FORBIDDEN`);
  const providers = normalizeProviders(value.providers, `${key}.providers`, evidenceState);
  if (evidenceState !== 'unavailable' && providers.length === 0) fail(`${key.toUpperCase()}_PROVIDERS_REQUIRED`);
  const modelVersion = version(value.model_version ?? value.modelVersion, `${key}.model_version`, { required: false });
  if (evidenceState === 'inferred' && !modelVersion) fail(`${key.toUpperCase()}_MODEL_VERSION_REQUIRED`);
  const limitations = value.limitations === undefined ? [] : termArray(value.limitations, `${key}.limitations`, { maximum: 12 });
  const provenance = value.provenance === undefined ? [] : normalizeProvenance(value.provenance, `${key}.provenance`, evidenceState);
  if (evidenceState !== 'unavailable' && provenance.length === 0) fail(`${key.toUpperCase()}_PROVENANCE_REQUIRED`);
  return deepFreeze({
    value: normalizedValue,
    evidence_state: evidenceState,
    confidence,
    evidence_refs: evidenceRefs,
    providers,
    freshness: normalizeFreshness(value.freshness, `${key}.freshness`),
    limitations,
    ...(modelVersion ? { model_version: modelVersion } : {}),
    provenance,
  });
}

function normalizeProvenance(value, label, evidenceState) {
  if (value === undefined || value === null) {
    if (evidenceState === 'unavailable') return [];
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_REFS) fail(`${label.toUpperCase()}_INVALID`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${label}[${index}]_INVALID`);
    const allowed = new Set(['provider', 'source_type', 'sourceType', 'source_ref', 'sourceRef', 'observed_at', 'observedAt', 'retrieved_at', 'retrievedAt', 'evidence_state', 'evidenceState']);
    if (Object.keys(entry).some((key) => !allowed.has(key))) fail(`${label}[${index}]_FIELD_FORBIDDEN`);
    const provider = boundedText(entry.provider, `${label}[${index}].provider`, { maximum: 64 }).toLowerCase();
    if (!PROVIDER_PATTERN.test(provider)) fail(`${label}[${index}].provider_invalid`);
    const sourceRef = safeKey(entry.source_ref ?? entry.sourceRef, `${label}[${index}].source_ref`);
    const observedAt = timestamp(entry.observed_at ?? entry.observedAt, `${label}[${index}].observed_at`);
    const retrievedAt = timestamp(entry.retrieved_at ?? entry.retrievedAt, `${label}[${index}].retrieved_at`);
    if (Date.parse(retrievedAt) < Date.parse(observedAt)) fail(`${label}[${index}]_TIMESTAMP_ORDER_INVALID`);
    const state = normalizeEvidenceState(entry.evidence_state ?? entry.evidenceState ?? evidenceState, `${label}[${index}].evidence_state`);
    const stateRank = { observed: 0, derived: 1, inferred: 2, unavailable: 3 };
    if (stateRank[state] > stateRank[evidenceState]) fail(`${label}[${index}]_STATE_ESCALATION_INVALID`);
    return Object.freeze({
      provider,
      source_type: normalizedTerm(entry.source_type ?? entry.sourceType ?? 'analysis', `${label}[${index}].source_type`),
      source_ref: sourceRef,
      observed_at: observedAt,
      retrieved_at: retrievedAt,
      evidence_state: state,
    });
  });
}

function normalizeAgeTarget(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return termArray(value, 'target_age', { maximum: 12 });
  if (!isRecord(value)) fail('TARGET_AGE_INVALID');
  const minimum = finite(value.min ?? value.minimum, 'target_age.min', { minimum: 0, maximum: 120 });
  const maximum = finite(value.max ?? value.maximum, 'target_age.max', { minimum: 0, maximum: 120 });
  if (maximum < minimum) fail('TARGET_AGE_RANGE_INVALID');
  return [`${minimum}-${maximum}`];
}

export function normalizeCampaignBrief(input) {
  if (!isRecord(input)) fail('CAMPAIGN_BRIEF_INVALID');
  const allowed = new Set([
    'campaign_key', 'campaignKey', 'campaign_version', 'campaignVersion', 'criteria_version', 'criteriaVersion',
    'objective', 'brand', 'market', 'category', 'product', 'target_geography', 'targetGeography',
    'target_gender', 'targetGender', 'target_age', 'targetAge', 'positive_topics', 'positiveTopics',
    'negative_topics', 'negativeTopics', 'competitors', 'brand_safety_constraints', 'brandSafetyConstraints',
    'desired_content_format', 'desiredContentFormat', 'desired_formats', 'desiredFormats', 'commercial_constraints',
    'commercialConstraints',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail('CAMPAIGN_BRIEF_FIELD_FORBIDDEN');
  const campaignKey = safeKey(input.campaign_key ?? input.campaignKey, 'campaign_key');
  const campaignVersion = Number(input.campaign_version ?? input.campaignVersion ?? 1);
  if (!Number.isSafeInteger(campaignVersion) || campaignVersion < 1) fail('CAMPAIGN_VERSION_INVALID');
  const criteriaVersion = version(input.criteria_version ?? input.criteriaVersion ?? 'campaign-fit-criteria/v1', 'criteria_version');
  const desiredContentFormat = input.desired_content_format ?? input.desiredContentFormat;
  const desiredFormats = termArray(input.desired_formats ?? input.desiredFormats ?? (desiredContentFormat ? [desiredContentFormat] : []), 'desired_formats', { maximum: 8 });
  const brief = {
    campaign_key: campaignKey,
    campaign_version: campaignVersion,
    criteria_version: criteriaVersion,
    objective: optionalText(input.objective, 'objective', { maximum: 240 }),
    brand: optionalText(input.brand, 'brand', { maximum: 120 }),
    market: optionalText(input.market, 'market', { maximum: 80 }),
    category: optionalText(input.category, 'category', { maximum: 80 }),
    product: optionalText(input.product, 'product', { maximum: 120 }),
    target_geography: termArray(input.target_geography ?? input.targetGeography, 'target_geography', { maximum: 16 }),
    target_gender: termArray(input.target_gender ?? input.targetGender, 'target_gender', { maximum: 8 }),
    target_age: normalizeAgeTarget(input.target_age ?? input.targetAge),
    positive_topics: termArray(input.positive_topics ?? input.positiveTopics, 'positive_topics'),
    negative_topics: termArray(input.negative_topics ?? input.negativeTopics, 'negative_topics'),
    competitors: termArray(input.competitors, 'competitors'),
    brand_safety_constraints: termArray(input.brand_safety_constraints ?? input.brandSafetyConstraints, 'brand_safety_constraints', { maximum: 16 }),
    desired_formats: desiredFormats,
    commercial_constraints: isRecord(input.commercial_constraints ?? input.commercialConstraints)
      ? normalizeCommercialConstraints(input.commercial_constraints ?? input.commercialConstraints)
      : {},
  };
  const hasCriterion = Boolean(
    brief.category || brief.product || brief.brand || brief.target_geography.length || brief.target_gender.length
      || brief.target_age.length || brief.positive_topics.length || brief.negative_topics.length
      || brief.competitors.length || brief.brand_safety_constraints.length || brief.desired_formats.length
      || Object.keys(brief.commercial_constraints).length,
  );
  if (!hasCriterion) fail('CAMPAIGN_BRIEF_HAS_NO_CRITERIA');
  return deepFreeze(brief);
}

function normalizeCommercialConstraints(value) {
  const allowed = new Set(['max_sponsored_ratio', 'maxSponsoredRatio', 'max_brand_mentions', 'maxBrandMentions']);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail('COMMERCIAL_CONSTRAINTS_FIELD_FORBIDDEN');
  const result = {};
  const maxSponsored = value.max_sponsored_ratio ?? value.maxSponsoredRatio;
  if (maxSponsored !== undefined) result.max_sponsored_ratio = ratio(maxSponsored, 'max_sponsored_ratio');
  const maxBrandMentions = value.max_brand_mentions ?? value.maxBrandMentions;
  if (maxBrandMentions !== undefined) {
    if (!Number.isSafeInteger(maxBrandMentions) || maxBrandMentions < 0 || maxBrandMentions > MAX_SIGNAL_TERMS) fail('MAX_BRAND_MENTIONS_INVALID');
    result.max_brand_mentions = maxBrandMentions;
  }
  return result;
}

export function normalizeCreatorCampaignEvidence(input) {
  if (!isRecord(input)) fail('CREATOR_EVIDENCE_INVALID');
  const allowed = new Set(['creator_key', 'creatorKey', 'signals', 'provider_reliability', 'providerReliability', 'official_provider_available', 'officialProviderAvailable']);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail('CREATOR_EVIDENCE_FIELD_FORBIDDEN');
  const creatorKey = safeKey(input.creator_key ?? input.creatorKey, 'creator_key');
  if (!isRecord(input.signals)) fail('CREATOR_SIGNALS_REQUIRED');
  const signalKeys = [
    'topics', 'product_categories', 'brands_mentioned', 'competitors', 'audience_geography',
    'audience_gender', 'audience_age', 'commercial_saturation', 'sponsored_ratio', 'content_formats',
    'brand_safety_flags', 'engagement_quality', 'historical_content',
  ];
  if (Object.keys(input.signals).some((key) => !signalKeys.includes(key))) fail('CREATOR_SIGNALS_FIELD_FORBIDDEN');
  const signals = {};
  for (const key of signalKeys) {
    if (input.signals[key] !== undefined) signals[key] = normalizeSignal(input.signals[key], key);
    else signals[key] = unavailableSignal(`signal_${key}_unavailable`);
  }
  const providerReliability = input.provider_reliability ?? input.providerReliability;
  const reliability = providerReliability === undefined ? {} : normalizeReliability(providerReliability);
  const officialProviderAvailable = input.official_provider_available ?? input.officialProviderAvailable;
  if (officialProviderAvailable !== undefined && typeof officialProviderAvailable !== 'boolean') fail('OFFICIAL_PROVIDER_AVAILABLE_INVALID');
  return deepFreeze({ creator_key: creatorKey, signals, provider_reliability: reliability, official_provider_available: officialProviderAvailable ?? null });
}

function normalizeReliability(value) {
  if (!isRecord(value) || Object.keys(value).length > 8) fail('PROVIDER_RELIABILITY_INVALID');
  const output = {};
  for (const [provider, reliability] of Object.entries(value)) {
    const normalizedProvider = boundedText(provider, 'provider_reliability.provider', { maximum: 64 }).toLowerCase();
    if (!PROVIDER_PATTERN.test(normalizedProvider)) fail('PROVIDER_RELIABILITY_PROVIDER_INVALID');
    output[normalizedProvider] = ratio(reliability, `provider_reliability.${provider}`);
  }
  return output;
}

function unavailableSignal(limitation) {
  return deepFreeze({ value: null, evidence_state: 'unavailable', confidence: 0, evidence_refs: [], providers: [], freshness: 'unknown', limitations: [limitation], provenance: [] });
}

function stableSerialize(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function fingerprint(value) {
  return createHash('sha256').update(stableSerialize(value), 'utf8').digest('hex');
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value, places = 4) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function freshnessFactor(value) {
  return value === 'fresh' ? 1 : value === 'stale' ? 0.55 : 0.35;
}

function stateFor(signals) {
  return signals.some((item) => item.evidence_state === 'inferred') ? 'inferred' : 'derived';
}

function evidenceFor(signals, creator) {
  const available = signals.filter((item) => item.evidence_state !== 'unavailable' && item.value !== null);
  const evidenceRefs = [...new Set(available.flatMap((item) => item.evidence_refs))].slice(0, MAX_EVIDENCE_REFS);
  const providers = [...new Set(available.flatMap((item) => item.providers))].sort();
  const limitations = [...new Set(available.flatMap((item) => item.limitations))];
  const modelVersions = [...new Set(available.map((item) => item.model_version).filter(Boolean))].sort();
  const provenance = available.flatMap((item) => item.provenance || []);
  const confidence = available.length === 0 ? 0 : round(available.reduce((sum, item) => sum + item.confidence, 0) / available.length);
  const freshness = available.length === 0
    ? 'unknown'
    : available.every((item) => item.freshness === 'fresh') ? 'fresh' : available.some((item) => item.freshness === 'stale') ? 'stale' : 'unknown';
  const reliabilityValues = available.flatMap((item) => item.providers.map((provider) => creator.provider_reliability[provider] ?? (provider === 'meta-graph' ? 0.9 : 0.65)));
  const providerReliability = reliabilityValues.length === 0 ? 0 : round(reliabilityValues.reduce((sum, item) => sum + item, 0) / reliabilityValues.length);
  return { evidenceRefs, providers, limitations, modelVersions, provenance, confidence, freshness, providerReliability, state: stateFor(signals) };
}

function matches(actual, target) {
  const a = normalizedTerm(actual, 'actual');
  const t = normalizedTerm(target, 'target');
  return a === t || a.includes(t) || t.includes(a);
}

function overlap(targets, actuals) {
  if (!targets.length || !actuals.length) return { matched: [], ratio: null };
  const matched = targets.filter((target) => actuals.some((actual) => matches(actual, target)));
  return { matched, ratio: matched.length / targets.length };
}

function buildComponent({ key, scoreValue, signals, creator, applicable, code, inputs, limitations, conflicts }) {
  const weight = CAMPAIGN_FIT_WEIGHTS[key];
  const available = signals.filter((item) => item.evidence_state !== 'unavailable' && item.value !== null);
  if (!applicable || available.length === 0) {
    const signalLimitations = signals.flatMap((item) => item.limitations || []);
    return {
      key,
      score: null,
      weight,
      contribution: null,
      confidence: 0,
      evidence_state: 'unavailable',
      evidence_refs: [],
      providers: [],
      freshness: 'unknown',
      provenance: [],
      model_versions: [],
       explanation: { code: code || 'component_unavailable', inputs, limitations: [...new Set([...signalLimitations, ...(limitations || [])])] },
      conflicts: [...(conflicts || [])],
    };
  }
  const evidence = evidenceFor(available, creator);
  const componentConfidence = round(evidence.confidence * freshnessFactor(evidence.freshness) * evidence.providerReliability);
  return {
    key,
    score: round(clamp(scoreValue)),
    weight,
    contribution: null,
    confidence: componentConfidence,
    evidence_state: evidence.state,
    evidence_refs: evidence.evidenceRefs,
    providers: evidence.providers,
    provenance: evidence.provenance,
    freshness: evidence.freshness,
    model_versions: evidence.modelVersions,
    explanation: { code, inputs, limitations: [...new Set([...(evidence.limitations || []), ...(limitations || [])])] },
    conflicts: [...(conflicts || [])],
  };
}

function arrayValue(signal) {
  return Array.isArray(signal.value) ? signal.value : [];
}

function mapValue(signal) {
  return isRecord(signal.value) && !Array.isArray(signal.value) ? signal.value : {};
}

function scoreOverlap(targets, signal) {
  const result = overlap(targets, arrayValue(signal));
  return result.ratio === null ? null : result.ratio * 100;
}

function topicComponent(brief, evidence) {
  const targets = [...brief.positive_topics];
  const negatives = [...brief.negative_topics];
  const signal = evidence.signals.topics;
  const actual = arrayValue(signal);
  const positive = overlap(targets, actual);
  const negative = overlap(negatives, actual);
  if (!targets.length && !negatives.length) return buildComponent({ key: 'topic_affinity', signals: [signal], creator: evidence, applicable: false, code: 'brief_topics_not_specified', inputs: {} });
  const positiveScore = targets.length ? (positive.ratio * 100) : 100;
  const negativePenalty = negative.ratio === null ? 0 : negative.ratio * 100;
  return buildComponent({
    key: 'topic_affinity', scoreValue: clamp(positiveScore - negativePenalty), signals: [signal], creator: evidence, applicable: true,
    code: 'topic_overlap_with_negative_penalty', inputs: { positive_targets: targets, matched_positive: positive.matched, negative_targets: negatives, conflicts: negative.matched },
    limitations: targets.length && positive.ratio === 0 ? ['no_positive_topic_match'] : [], conflicts: negative.matched,
  });
}

function categoryComponent(brief, evidence) {
  const targets = [brief.category, brief.product].filter(Boolean);
  const signal = evidence.signals.product_categories;
  if (!targets.length) return buildComponent({ key: 'category_affinity', signals: [signal], creator: evidence, applicable: false, code: 'brief_category_not_specified', inputs: {} });
  const result = overlap(targets, arrayValue(signal));
  return buildComponent({
    key: 'category_affinity', scoreValue: (result.ratio ?? 0) * 100, signals: [signal], creator: evidence, applicable: true,
    code: 'category_product_overlap', inputs: { targets, matched: result.matched }, limitations: result.ratio === 0 ? ['no_category_match'] : [],
  });
}

function audienceDimension(targets, values) {
  if (!targets.length) return null;
  if (Array.isArray(values)) return overlap(targets, values).ratio;
  if (!isRecord(values)) return null;
  const matchingShare = Object.entries(values)
    .filter(([key]) => targets.some((target) => matches(key, target)))
    .reduce((sum, [, share]) => sum + share, 0);
  return matchingShare;
}

function audienceComponent(brief, evidence) {
  const dimensions = [
    ['geography', brief.target_geography, evidence.signals.audience_geography],
    ['gender', brief.target_gender, evidence.signals.audience_gender],
    ['age', brief.target_age, evidence.signals.audience_age],
  ].filter(([, targets]) => targets.length);
  if (!dimensions.length) return buildComponent({ key: 'audience_fit', signals: [], creator: evidence, applicable: false, code: 'brief_audience_constraints_not_specified', inputs: {} });
  const available = dimensions.filter(([, , signal]) => signal.evidence_state !== 'unavailable' && signal.value !== null);
  const scores = available.map(([name, targets, signal]) => ({ name, score: audienceDimension(targets, signal.value) }));
  const usable = scores.filter(({ score: value }) => value !== null);
  const signalSet = dimensions.map(([, , signal]) => signal);
  if (!usable.length) return buildComponent({ key: 'audience_fit', signals: signalSet, creator: evidence, applicable: true, code: 'audience_demographics_unavailable', inputs: { requested_dimensions: dimensions.map(([name]) => name) }, limitations: ['audience_demographics_unavailable'] });
  return buildComponent({
    key: 'audience_fit', scoreValue: usable.reduce((sum, item) => sum + item.score, 0) / usable.length * 100, signals: usable.map(({ name }) => evidence.signals[`audience_${name}`]), creator: evidence, applicable: true,
    code: 'observed_audience_distribution_match', inputs: { requested_dimensions: dimensions.map(([name]) => name), matched_dimensions: scores },
    limitations: usable.length < dimensions.length ? ['some_audience_dimensions_unavailable'] : [],
  });
}

function historicalComponent(brief, evidence) {
  const targets = [brief.brand, brief.category, brief.product, ...brief.positive_topics].filter(Boolean);
  const signal = evidence.signals.historical_content;
  if (!targets.length) return buildComponent({ key: 'historical_content', signals: [signal], creator: evidence, applicable: false, code: 'brief_historical_criteria_not_specified', inputs: {} });
  const actual = isRecord(signal.value) ? Object.values(signal.value).flat() : arrayValue(signal);
  const result = overlap(targets, actual);
  return buildComponent({
    key: 'historical_content', scoreValue: (result.ratio ?? 0) * 100, signals: [signal], creator: evidence, applicable: true,
    code: 'historical_content_overlap', inputs: { targets, matched: result.matched }, limitations: result.ratio === 0 ? ['no_historical_content_match'] : [],
  });
}

function saturationComponent(brief, evidence) {
  const signal = evidence.signals.commercial_saturation;
  const sponsored = evidence.signals.sponsored_ratio;
  const signalToUse = signal.evidence_state === 'unavailable' ? sponsored : signal;
  const maxSaturation = brief.commercial_constraints.max_sponsored_ratio;
  const brandMentions = evidence.signals.brands_mentioned;
  const maxBrandMentions = brief.commercial_constraints.max_brand_mentions;
  if (maxBrandMentions !== undefined && brandMentions.evidence_state === 'unavailable') {
    return buildComponent({ key: 'commercial_saturation', signals: [signalToUse, brandMentions], creator: evidence, applicable: false, code: 'max_brand_mentions_unavailable', inputs: { max_brand_mentions: maxBrandMentions }, limitations: ['max_brand_mentions_unavailable'] });
  }
  if (signalToUse.evidence_state === 'unavailable' && maxBrandMentions === undefined) return buildComponent({ key: 'commercial_saturation', signals: [signalToUse], creator: evidence, applicable: true, code: 'commercial_saturation_unavailable', inputs: {}, limitations: ['commercial_saturation_unavailable'] });
  const value = signalToUse.value;
  const saturationScore = value === null ? null : maxSaturation !== undefined && value > maxSaturation ? Math.max(0, 100 - (((value - maxSaturation) / Math.max(1 - maxSaturation, 0.000001)) * 100)) : (1 - value) * 100;
  const mentionCount = Array.isArray(brandMentions.value) ? brandMentions.value.length : 0;
  const mentionScore = maxBrandMentions === undefined ? null : mentionCount > maxBrandMentions ? 0 : 100;
  const scoreValue = saturationScore === null ? mentionScore : mentionScore === null ? saturationScore : Math.min(saturationScore, mentionScore);
  const constraintsExceeded = (maxSaturation !== undefined && value !== null && value > maxSaturation) || (maxBrandMentions !== undefined && mentionCount > maxBrandMentions);
  return buildComponent({ key: 'commercial_saturation', scoreValue, signals: maxBrandMentions === undefined ? [signalToUse] : [signalToUse, brandMentions], creator: evidence, applicable: true, code: constraintsExceeded ? 'commercial_constraint_exceeded' : 'commercial_saturation_penalty', inputs: { observed_ratio: value, max_allowed_ratio: maxSaturation ?? null, observed_brand_mentions: mentionCount, max_brand_mentions: maxBrandMentions ?? null }, limitations: [] });
}

function competitorComponent(brief, evidence) {
  const signal = evidence.signals.competitors;
  if (!brief.competitors.length) return buildComponent({ key: 'competitor_conflict', signals: [signal], creator: evidence, applicable: false, code: 'competitor_exclusions_not_specified', inputs: {} });
  const actual = arrayValue(signal);
  const mentioned = arrayValue(evidence.signals.brands_mentioned);
  const conflicts = brief.competitors.filter((target) => [...actual, ...mentioned].some((item) => matches(item, target)));
  const partialEvidence = (signal.evidence_state === 'unavailable') !== (evidence.signals.brands_mentioned.evidence_state === 'unavailable');
  if (partialEvidence && conflicts.length === 0) {
    return buildComponent({ key: 'competitor_conflict', signals: [signal, evidence.signals.brands_mentioned], creator: evidence, applicable: false, code: 'competitor_history_partial_unavailable', inputs: { excluded_competitors: brief.competitors }, limitations: ['competitor_history_partial_unavailable'] });
  }
  const conflictRatio = conflicts.length / brief.competitors.length;
  return buildComponent({ key: 'competitor_conflict', scoreValue: (1 - conflictRatio) * 100, signals: [signal, evidence.signals.brands_mentioned], creator: evidence, applicable: true, code: conflicts.length ? 'competitor_conflict_detected' : 'competitor_exclusion_clear', inputs: { excluded_competitors: brief.competitors, conflicts }, limitations: signal.evidence_state === 'unavailable' && evidence.signals.brands_mentioned.evidence_state === 'unavailable' ? ['competitor_history_unavailable'] : [], conflicts });
}

function formatComponent(brief, evidence) {
  const signal = evidence.signals.content_formats;
  if (!brief.desired_formats.length) return buildComponent({ key: 'format_affinity', signals: [signal], creator: evidence, applicable: false, code: 'desired_format_not_specified', inputs: {} });
  if (signal.evidence_state === 'unavailable' || signal.value === null) return buildComponent({ key: 'format_affinity', signals: [signal], creator: evidence, applicable: true, code: 'content_format_unavailable', inputs: { desired_formats: brief.desired_formats }, limitations: ['content_format_unavailable'] });
  const values = signal.value;
  const fit = Array.isArray(values)
    ? (overlap(brief.desired_formats, values).ratio ?? 0)
    : Object.entries(values).filter(([format]) => brief.desired_formats.some((target) => matches(format, target))).reduce((sum, [, share]) => sum + share, 0);
  return buildComponent({ key: 'format_affinity', scoreValue: fit * 100, signals: [signal], creator: evidence, applicable: true, code: 'desired_format_affinity', inputs: { desired_formats: brief.desired_formats }, limitations: fit === 0 ? ['desired_format_not_observed'] : [] });
}

function safetyComponent(brief, evidence) {
  const signal = evidence.signals.brand_safety_flags;
  if (!brief.brand_safety_constraints.length) return buildComponent({ key: 'brand_safety', signals: [signal], creator: evidence, applicable: false, code: 'brand_safety_constraints_not_specified', inputs: {} });
  const flags = arrayValue(signal);
  const conflicts = flags.filter((flag) => brief.brand_safety_constraints.some((constraint) => constraint === 'any' || matches(flag, constraint)));
  return buildComponent({ key: 'brand_safety', scoreValue: conflicts.length ? 0 : 100, signals: [signal], creator: evidence, applicable: true, code: conflicts.length ? 'brand_safety_constraint_conflict' : 'brand_safety_constraints_clear', inputs: { constraints: brief.brand_safety_constraints, observed_flags: flags, conflicts }, limitations: signal.evidence_state === 'unavailable' ? ['brand_safety_evidence_unavailable'] : [], conflicts });
}

function engagementComponent(evidence) {
  const signal = evidence.signals.engagement_quality;
  return buildComponent({ key: 'engagement_quality', scoreValue: signal.value, signals: [signal], creator: evidence, applicable: true, code: 'persisted_engagement_quality_input', inputs: { source: 'persisted_or_structured_engagement_quality' }, limitations: [] });
}

function modelVersionFor(components) {
  const versions = [...new Set(Object.values(components).flatMap((item) => item.model_versions || []))].sort();
  if (!versions.length) return null;
  return versions.length === 1 ? versions[0] : 'campaign-fit-input-models/v1';
}

function calculateCoverage(components) {
  const applicable = Object.values(components).filter((item) => item.explanation.code !== 'brief_topics_not_specified' && item.explanation.code !== 'brief_category_not_specified' && item.explanation.code !== 'brief_audience_constraints_not_specified' && item.explanation.code !== 'brief_historical_criteria_not_specified' && item.explanation.code !== 'competitor_exclusions_not_specified' && item.explanation.code !== 'desired_format_not_specified' && item.explanation.code !== 'brand_safety_constraints_not_specified');
  const available = applicable.filter((item) => item.score !== null);
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const expectedWeight = applicable.reduce((sum, item) => sum + item.weight, 0);
  const ratioValue = expectedWeight === 0 ? 0 : availableWeight / expectedWeight;
  return { available_components: available.length, expected_components: applicable.length, available_weight: round(availableWeight), expected_weight: round(expectedWeight), ratio: round(ratioValue), score: round(ratioValue * 100) };
}

function aggregateConfidence(components, coverage, brief, evidence) {
  const available = Object.values(components).filter((item) => item.score !== null);
  if (!available.length) return { score: 0, factors: { component_coverage: 0, evidence_confidence: 0, freshness: 0, provider_reliability: 0, official_provider: 0, demographic_penalty: 0 } };
  const componentConfidence = available.reduce((sum, item) => sum + item.confidence, 0) / available.length;
  const freshness = available.reduce((sum, item) => sum + freshnessFactor(item.freshness), 0) / available.length;
  const reliability = available.reduce((sum, item) => {
    const values = item.providers.map((provider) => evidence.provider_reliability[provider] ?? (provider === 'meta-graph' ? 0.9 : 0.65));
    return sum + (values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0);
  }, 0) / available.length;
  const official = available.some((item) => item.providers.includes('meta-graph')) ? 1 : available.some((item) => item.providers.length) ? 0.7 : 0;
  const demographicRequested = Boolean(brief.target_geography.length || brief.target_gender.length || brief.target_age.length);
  const demographicAvailable = components.audience_fit.score !== null;
  const demographicPenalty = demographicRequested && !demographicAvailable ? 0.45 : 1;
  const scoreValue = clamp((componentConfidence * 0.30 + coverage.ratio * 0.25 + freshness * 0.15 + reliability * 0.15 + official * 0.15) * 100 * demographicPenalty);
  return {
    score: round(scoreValue),
    factors: {
      component_coverage: coverage.ratio,
      evidence_confidence: round(componentConfidence),
      freshness: round(freshness),
      provider_reliability: round(reliability),
      official_provider: official,
      demographic_penalty: demographicPenalty,
    },
  };
}

function overallState(components) {
  const available = Object.values(components).filter((item) => item.score !== null);
  if (!available.length) return 'unavailable';
  return available.some((item) => item.evidence_state === 'inferred') ? 'inferred' : 'derived';
}

function buildProvenance(components) {
  const entries = [];
  for (const item of Object.values(components)) {
    entries.push(...(item.provenance || []));
  }
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.provider}:${entry.source_ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function repositoryProvenance(entries) {
  return entries.map((entry) => ({
    provider: entry.provider,
    sourceType: entry.source_type,
    sourceRef: entry.source_ref,
    evidenceState: entry.evidence_state,
    observedAt: entry.observed_at,
    retrievedAt: entry.retrieved_at,
  }));
}

export function computeCampaignFit({ campaign, creator, calculated_at: calculatedAtInput, calculatedAt, clock = Date.now } = {}) {
  const brief = normalizeCampaignBrief(campaign);
  const evidence = normalizeCreatorCampaignEvidence(creator);
  if (brief.campaign_key === undefined || evidence.creator_key === undefined) fail('CAMPAIGN_FIT_KEYS_REQUIRED');
  const now = calculatedAtInput ?? calculatedAt ?? (typeof clock === 'function' ? clock() : clock);
  const computedAt = timestamp(typeof now === 'number' ? new Date(now).toISOString() : now, 'calculated_at');
  const components = {
    topic_affinity: topicComponent(brief, evidence),
    category_affinity: categoryComponent(brief, evidence),
    audience_fit: audienceComponent(brief, evidence),
    historical_content: historicalComponent(brief, evidence),
    commercial_saturation: saturationComponent(brief, evidence),
    competitor_conflict: competitorComponent(brief, evidence),
    format_affinity: formatComponent(brief, evidence),
    brand_safety: safetyComponent(brief, evidence),
    engagement_quality: engagementComponent(evidence),
  };
  const coverage = calculateCoverage(components);
  const available = Object.values(components).filter((item) => item.score !== null);
  const overall = available.length === 0
    ? null
    : available.reduce((sum, item) => sum + (item.score * item.weight), 0) / available.reduce((sum, item) => sum + item.weight, 0);
  const confidence = aggregateConfidence(components, coverage, brief, evidence);
  const evidenceState = overallState(components);
  const conflicts = [...new Set(Object.values(components).flatMap((item) => item.conflicts || []))].sort();
  const providers = [...new Set(Object.values(components).flatMap((item) => item.providers || []))].sort();
  const limitations = [...new Set([
    ...Object.values(components).flatMap((item) => item.explanation.limitations || []),
    ...(brief.target_geography.length || brief.target_gender.length || brief.target_age.length) && components.audience_fit.score === null ? ['missing_demographics_reduce_confidence'] : [],
    ...(evidence.official_provider_available === false ? ['official_provider_unavailable'] : []),
  ])];
  const modelVersion = modelVersionFor(components);
  const inputFingerprint = fingerprint({ campaign: brief, creator: evidence });
  const result = {
    contract_version: CAMPAIGN_FIT_CONTRACT_VERSION,
    campaign_key: brief.campaign_key,
    campaign_version: brief.campaign_version,
    criteria_version: brief.criteria_version,
    creator_key: evidence.creator_key,
    campaign_fit_score: overall === null ? null : round(clamp(overall)),
    campaign_fit_confidence: confidence.score,
    data_coverage: coverage.score,
    coverage,
    evidence_state: evidenceState,
    data_classification: evidenceState,
    algorithm_version: CAMPAIGN_FIT_ALGORITHM_VERSION,
    weights_version: CAMPAIGN_FIT_WEIGHTS_VERSION,
    model_version: modelVersion,
    calculated_at: computedAt,
    input_fingerprint: inputFingerprint,
    campaign_fit_components: components,
    component_scores: components,
    competitor_conflicts: conflicts,
    providers,
    provenance: buildProvenance(components),
    confidence_factors: confidence.factors,
    limitations,
  };
  return deepFreeze(result);
}

export function rankCampaignCreators({ campaign, creators, calculated_at: calculatedAt, calculatedAt: calculatedAtAlias, clock = Date.now } = {}) {
  if (!Array.isArray(creators) || creators.length === 0 || creators.length > 20) fail('CREATORS_INVALID');
  const results = creators.map((creator) => computeCampaignFit({ campaign, creator, calculated_at: calculatedAt ?? calculatedAtAlias, clock }));
  return deepFreeze([...results].sort((left, right) => {
    if (left.campaign_fit_score === null && right.campaign_fit_score !== null) return 1;
    if (left.campaign_fit_score !== null && right.campaign_fit_score === null) return -1;
    const scoreDifference = (right.campaign_fit_score ?? -1) - (left.campaign_fit_score ?? -1);
    if (scoreDifference !== 0) return scoreDifference;
    const confidenceDifference = right.campaign_fit_confidence - left.campaign_fit_confidence;
    if (confidenceDifference !== 0) return confidenceDifference;
    return left.creator_key.localeCompare(right.creator_key);
  }).map((item, index) => ({ ...item, rank: index + 1 })));
}

export async function computeAndPersistCampaignFit({
  repository,
  campaign,
  creator,
  fit_key: fitKey,
  fitKey: fitKeyAlias,
  ingest_key: ingestKey,
  ingestKey: ingestKeyAlias,
  retention_policy_version: retentionPolicyVersion,
  retentionPolicyVersion: retentionPolicyVersionAlias,
  campaign_status: campaignStatusSnake,
  campaignStatus: campaignStatusCamel,
  calculated_at: calculatedAt,
  calculatedAt: calculatedAtAlias,
  clock = Date.now,
} = {}) {
  if (!repository || typeof repository.upsertCampaign !== 'function' || typeof repository.recordCampaignFit !== 'function') {
    fail('REPOSITORY_REQUIRED');
  }
  const normalizedCampaign = normalizeCampaignBrief(campaign);
  const result = computeCampaignFit({ campaign: normalizedCampaign, creator, calculated_at: calculatedAt ?? calculatedAtAlias, clock });
  const normalizedFitKey = safeKey(fitKey ?? fitKeyAlias, 'fit_key');
  const normalizedIngestKey = safeKey(ingestKey ?? ingestKeyAlias, 'ingest_key');
  const normalizedRetention = version(retentionPolicyVersion ?? retentionPolicyVersionAlias, 'retention_policy_version');
  const campaignRow = await repository.upsertCampaign({
    campaignKey: normalizedCampaign.campaign_key,
    campaignVersion: normalizedCampaign.campaign_version,
    status: campaignStatusCamel ?? campaignStatusSnake ?? 'draft',
    criteriaVersion: normalizedCampaign.criteria_version,
    criteria: normalizedCampaign,
  });
  const fitRow = await repository.recordCampaignFit({
    fitKey: normalizedFitKey,
    ingestKey: normalizedIngestKey,
    campaignKey: result.campaign_key,
    campaignVersion: result.campaign_version,
    creatorKey: result.creator_key,
    score: result.campaign_fit_score,
    confidence: result.campaign_fit_confidence / 100,
    coverageAvailable: result.coverage.available_components,
    coverageExpected: Math.max(1, result.coverage.expected_components),
    evidenceState: result.evidence_state,
    algorithmVersion: result.algorithm_version,
    weightsVersion: result.weights_version,
    modelVersion: result.model_version,
    providers: result.providers,
    inputFingerprint: result.input_fingerprint,
    provenance: repositoryProvenance(result.provenance),
    computedAt: result.calculated_at,
    components: result.campaign_fit_components,
    retentionPolicyVersion: normalizedRetention,
  });
  return deepFreeze({ result, persistence: { campaign: campaignRow, fit: fitRow } });
}

export const __testing = Object.freeze({
  stableSerialize,
  fingerprint,
  overlap,
  freshnessFactor,
  normalizeCampaignBrief,
  normalizeCreatorCampaignEvidence,
});
