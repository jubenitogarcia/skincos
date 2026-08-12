/**
 * Bounded semantic content analysis for Influencer Intelligence.
 *
 * This module is deliberately pure at the media boundary. Callers provide a
 * recent media projection and may inject a structured semantic analyzer. The
 * module never downloads media, opens a provider transport, reads credentials,
 * persists captions/transcripts, or computes an Influencer Score.
 */

import { createHash } from 'node:crypto';

export const CONTENT_ANALYSIS_CONTRACT_VERSION =
  'influencer-intelligence/content-analysis/v1';
export const CONTENT_ANALYSIS_ALGORITHM_VERSION =
  'influencer-intelligence-content-analysis/v1';
export const CONTENT_SEMANTIC_SCHEMA_VERSION =
  'influencer-intelligence-content-semantic/v1';
export const CONTENT_SAMPLING_VERSION =
  'influencer-intelligence-content-sampling/v1';
export const DEFAULT_CONTENT_SAMPLE_SIZE = 12;
export const MAX_CONTENT_SAMPLE_SIZE = 20;
export const MAX_CONTENT_CANDIDATES = 50;

const MEDIA_KINDS = new Set(['post', 'reel', 'video', 'short', 'live', 'unknown']);
const CONTENT_FORMATS = new Set(['image', 'carousel', 'post', 'reel', 'video', 'short', 'live', 'unknown']);
const SIGNAL_FIELDS = Object.freeze([
  'topics',
  'product_categories',
  'brands_mentioned',
  'competitors',
  'sponsored_signal',
  'promotion_coupon_signal',
  'skincare_affinity',
  'education_vs_entertainment',
  'claim_types',
  'content_format',
  'brand_safety_flags',
]);
const ARRAY_SIGNAL_FIELDS = new Set([
  'topics',
  'product_categories',
  'brands_mentioned',
  'competitors',
  'claim_types',
  'brand_safety_flags',
]);
const ENUM_SIGNAL_FIELDS = new Set([
  'sponsored_signal',
  'promotion_coupon_signal',
  'skincare_affinity',
  'education_vs_entertainment',
  'content_format',
]);
const ENUM_VALUES = Object.freeze({
  sponsored_signal: new Set(['present', 'absent', 'unknown']),
  promotion_coupon_signal: new Set(['present', 'absent', 'unknown']),
  skincare_affinity: new Set(['high', 'medium', 'low', 'unknown']),
  education_vs_entertainment: new Set(['education', 'entertainment', 'mixed', 'unknown']),
  content_format: CONTENT_FORMATS,
});
const PROVIDER_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/;
const CONTENT_KEY_PATTERN = /^[A-Za-z0-9._:/-]{1,160}$/;
const SOURCE_REF_PATTERN = /^[A-Za-z0-9._:/-]{1,240}$/;
const VERSION_PATTERN = /^[a-z][a-z0-9._/-]{0,79}$/;
const SLUG_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const CREDENTIAL_ASSIGNMENT_PATTERN = /(?:access[_-]?token|refresh[_-]?token|authorization|cookie|password|secret|api[_-]?key)\s*[:=]/i;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/;
const DEFAULT_FRESHNESS_SECONDS = 14 * 24 * 60 * 60;

const TAXONOMY = Object.freeze({
  topics: Object.freeze({
    skincare: ['skincare', 'skin care', 'skincare routine', 'cuidados com a pele', 'pele'],
    beauty: ['beauty', 'beleza', 'makeup', 'maquiagem'],
    wellness: ['wellness', 'bem estar', 'bem-estar', 'saude', 'saúde'],
    tutorial: ['tutorial', 'how to', 'como fazer', 'passo a passo'],
    review: ['review', 'resenha', 'testei', 'testando'],
    education: ['educational', 'educativo', 'explico', 'aprenda', 'entenda'],
    lifestyle: ['lifestyle', 'rotina', 'routine', 'daily'],
  }),
  product_categories: Object.freeze({
    cleanser: ['cleanser', 'face wash', 'limpador', 'gel de limpeza', 'sabonete facial'],
    moisturizer: ['moisturizer', 'hidratante', 'moisturiser'],
    serum: ['serum', 'sérum', 'serum facial'],
    sunscreen: ['sunscreen', 'sun screen', 'protetor solar', 'spf'],
    retinoid: ['retinol', 'retinoid', 'retinoide', 'tretinoína', 'tretinoin'],
    exfoliant: ['exfoliant', 'esfoliante', 'acids', 'ácidos'],
    mask: ['face mask', 'máscara facial', 'mask'],
    makeup: ['makeup', 'maquiagem', 'foundation', 'base'],
    haircare: ['haircare', 'cabelo', 'shampoo', 'conditioner'],
    supplement: ['supplement', 'suplemento', 'vitamin', 'vitamina'],
  }),
  claim_types: Object.freeze({
    efficacy: ['works', 'funciona', 'results', 'resultado', 'improves', 'melhora'],
    medical: ['treats', 'trata', 'cure', 'cura', 'diagnosis', 'diagnóstico', 'clinically'],
    comparison: ['versus', 'vs', 'comparando', 'comparison', 'comparação'],
    personal_experience: ['my experience', 'minha experiência', 'usei', 'testei', 'in my case'],
    before_after: ['before and after', 'antes e depois', 'before-after'],
    guarantee: ['guaranteed', 'garantido', '100%', 'sem dúvida'],
  }),
  brand_safety_flags: Object.freeze({
    medical_claim: ['cure', 'cura', 'treats', 'trata', 'diagnosis', 'diagnóstico'],
    misleading_guarantee: ['guaranteed', 'garantido', '100% guaranteed', 'resultado garantido'],
    adult_content: ['explicit', 'nude', 'nu', 'nua'],
    hate_or_harassment: ['hate speech', 'discurso de ódio'],
  }),
});

const SPONSORED_TERMS = Object.freeze([
  '#ad', '#publi', '#sponsored', 'sponsored', 'publicidade', 'publi', 'parceria paga',
  'paid partnership', 'gifted', 'recebidos', 'affiliate', 'afiliado',
]);
const PROMOTION_TERMS = Object.freeze([
  'coupon', 'cupom', 'discount', 'desconto', 'use o código', 'use o codigo',
  'promo code', 'código promocional', 'codigo promocional', 'link na bio',
]);
const EDUCATION_TERMS = Object.freeze(['how to', 'como', 'tutorial', 'explico', 'entenda', 'passo a passo', 'why', 'por que']);
const ENTERTAINMENT_TERMS = Object.freeze(['challenge', 'desafio', 'funny', 'comédia', 'comedia', 'trend', 'dance', 'dança', 'meme']);

export class ContentAnalysisError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ContentAnalysisError';
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new ContentAnalysisError(code, message);
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

function boundedString(value, label, { maximum = 240, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    fail(`${label.toUpperCase()}_REQUIRED`);
  }
  if (typeof value !== 'string') fail(`${label.toUpperCase()}_INVALID`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    fail(`${label.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function optionalString(value, label, options = {}) {
  return boundedString(value, label, { ...options, required: false });
}

function safeKey(value, label, pattern = KEY_PATTERN) {
  const normalized = boundedString(value, label, { maximum: 240 });
  if (!pattern.test(normalized)) fail(`${label.toUpperCase()}_INVALID`);
  return normalized;
}

function safeVersion(value, label, { required = true } = {}) {
  const normalized = boundedString(value, label, { maximum: 80, required });
  if (normalized === undefined) return undefined;
  if (!VERSION_PATTERN.test(normalized.toLowerCase())) fail(`${label.toUpperCase()}_INVALID`);
  return normalized.toLowerCase();
}

function safeSourceRef(value, label = 'sourceRef') {
  const normalized = safeKey(value, label, SOURCE_REF_PATTERN);
  if (normalized.includes('?') || normalized.includes('#')) fail(`${label.toUpperCase()}_INVALID`);
  return normalized;
}

function timestamp(value, label, { required = true } = {}) {
  const normalized = boundedString(value, label, { maximum: 40, required });
  if (normalized === undefined) return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) fail(`${label.toUpperCase()}_INVALID`);
  return parsed.toISOString();
}

function boundedDecimal(value, label, { required = true, minimum = 0, maximum = 1 } = {}) {
  if (value === undefined || value === null) {
    if (!required) return undefined;
    fail(`${label.toUpperCase()}_REQUIRED`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label.toUpperCase()}_INVALID`);
  }
  return Number(value.toFixed(6));
}

function boundedInteger(value, label, { required = true, minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null) {
    if (!required) return undefined;
    fail(`${label.toUpperCase()}_REQUIRED`);
  }
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label.toUpperCase()}_INVALID`);
  return value;
}

function assertSafeText(value, label) {
  if (CREDENTIAL_ASSIGNMENT_PATTERN.test(value)) fail(`${label.toUpperCase()}_CREDENTIAL_LIKE_TEXT`);
  if (EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value)) {
    fail(`${label.toUpperCase()}_DIRECT_CONTACT_TEXT`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  if (!isRecord(value)) fail(`${label.toUpperCase()}_INVALID`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label.toUpperCase()}_FIELD_FORBIDDEN`);
  }
}

function normalizeSlug(value, label) {
  const normalized = boundedString(value, label, { maximum: 64 }).toLowerCase();
  if (!SLUG_PATTERN.test(normalized)) fail(`${label.toUpperCase()}_INVALID`);
  return normalized;
}

function normalizeSlugArray(value, label, { maximum = 16, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${label.toUpperCase()}_REQUIRED`);
    return [];
  }
  if (!Array.isArray(value) || value.length > maximum) fail(`${label.toUpperCase()}_INVALID`);
  const result = value.map((item, index) => normalizeSlug(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label.toUpperCase()}_DUPLICATE`);
  return result.sort();
}

function normalizeText(value, label, maximum) {
  const normalized = boundedString(value, label, { maximum, required: false });
  if (normalized !== undefined) assertSafeText(normalized, label);
  return normalized;
}

function normalizeFrameEvidence(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 3) fail(`${label.toUpperCase()}_INVALID`);
  return value.map((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    assertAllowedKeys(entry, new Set(['frame_ref', 'feature_codes']), entryLabel);
    const frameRef = safeSourceRef(entry.frame_ref, `${entryLabel}.frame_ref`);
    const featureCodes = normalizeSlugArray(entry.feature_codes, `${entryLabel}.feature_codes`, { maximum: 12 });
    return Object.freeze({ frame_ref: frameRef, feature_codes: Object.freeze(featureCodes) });
  });
}

const CONTEXT_FIELDS = new Set([
  'topics',
  'product_categories',
  'brands_mentioned',
  'competitors',
  'claim_types',
  'brand_safety_flags',
  'sponsored_signal',
  'promotion_coupon_signal',
  'skincare_affinity',
  'education_vs_entertainment',
  'content_format',
]);

function normalizeContext(value, label) {
  if (value === undefined || value === null) return Object.freeze({});
  assertAllowedKeys(value, CONTEXT_FIELDS, label);
  const result = {};
  for (const field of ARRAY_SIGNAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      result[field] = normalizeSlugArray(value[field], `${label}.${field}`);
    }
  }
  for (const field of ENUM_SIGNAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      const normalized = boundedString(value[field], `${label}.${field}`, { maximum: 32 }).toLowerCase();
      if (!ENUM_VALUES[field].has(normalized)) fail(`${label.toUpperCase()}_${field.toUpperCase()}_INVALID`);
      result[field] = normalized;
    }
  }
  return Object.freeze(result);
}

function normalizeContentCandidate(value, index) {
  const label = `content[${index}]`;
  assertAllowedKeys(value, new Set([
    'content_key',
    'media_kind',
    'published_at',
    'source_ref',
    'caption',
    'transcript',
    'context',
    'frame_evidence',
  ]), label);
  const contentKey = safeKey(value.content_key, `${label}.content_key`, CONTENT_KEY_PATTERN);
  const mediaKind = boundedString(value.media_kind ?? 'unknown', `${label}.media_kind`, { maximum: 16 }).toLowerCase();
  if (!MEDIA_KINDS.has(mediaKind)) fail(`${label.toUpperCase()}_MEDIA_KIND_INVALID`);
  const publishedAt = timestamp(value.published_at, `${label}.published_at`, { required: false });
  const sourceRef = safeSourceRef(value.source_ref, `${label}.source_ref`);
  const caption = normalizeText(value.caption, `${label}.caption`, 2000);
  const transcript = normalizeText(value.transcript, `${label}.transcript`, 4000);
  const context = normalizeContext(value.context, `${label}.context`);
  const frameEvidence = normalizeFrameEvidence(value.frame_evidence, `${label}.frame_evidence`);
  if (!caption && !transcript && Object.keys(context).length === 0 && frameEvidence.length === 0) {
    fail(`${label.toUpperCase()}_EVIDENCE_REQUIRED`);
  }
  return Object.freeze({
    content_key: contentKey,
    media_kind: mediaKind,
    published_at: publishedAt,
    source_ref: sourceRef,
    ...(caption ? { caption } : {}),
    ...(transcript ? { transcript } : {}),
    context,
    frame_evidence: Object.freeze(frameEvidence),
    input_index: index,
  });
}

function normalizeSampling(value, candidateCount) {
  const config = value === undefined || value === null ? {} : value;
  assertAllowedKeys(config, new Set(['max_items', 'strategy']), 'sampling');
  const maxItems = boundedInteger(config.max_items ?? DEFAULT_CONTENT_SAMPLE_SIZE, 'sampling.max_items', {
    minimum: 1,
    maximum: MAX_CONTENT_SAMPLE_SIZE,
  });
  const strategy = boundedString(config.strategy ?? 'recent', 'sampling.strategy', { maximum: 24 }).toLowerCase();
  if (strategy !== 'recent') fail('SAMPLING_STRATEGY_INVALID');
  return Object.freeze({
    sampling_version: CONTENT_SAMPLING_VERSION,
    strategy,
    requested_limit: maxItems,
    candidate_count: candidateCount,
    selected_count: Math.min(candidateCount, maxItems),
    truncated: candidateCount > maxItems,
    source_order: 'published_at_desc_then_input_index',
    retention: 'features_and_evidence_refs_only',
  });
}

export function sampleContentRecords(contents, config = {}) {
  if (!Array.isArray(contents) || contents.length > MAX_CONTENT_CANDIDATES) {
    fail('CONTENT_CANDIDATES_OUT_OF_BOUNDS');
  }
  const normalized = contents.map(normalizeContentCandidate);
  const keys = new Set();
  for (const item of normalized) {
    if (keys.has(item.content_key)) fail('CONTENT_KEY_DUPLICATE');
    keys.add(item.content_key);
  }
  const sampling = normalizeSampling(config, normalized.length);
  const sorted = [...normalized].sort((left, right) => {
    if (left.published_at && right.published_at) {
      const difference = Date.parse(right.published_at) - Date.parse(left.published_at);
      if (difference !== 0) return difference;
    } else if (left.published_at && !right.published_at) {
      return -1;
    } else if (!left.published_at && right.published_at) {
      return 1;
    }
    return left.input_index - right.input_index;
  });
  return Object.freeze({
    items: Object.freeze(sorted.slice(0, sampling.requested_limit)),
    sampling,
  });
}

function normalizeProvider(value) {
  const normalized = boundedString(value, 'provider', { maximum: 64 }).toLowerCase();
  if (!PROVIDER_PATTERN.test(normalized)) fail('PROVIDER_INVALID');
  return normalized;
}

function normalizeInput(input, clock) {
  if (!isRecord(input)) fail('ANALYSIS_INPUT_INVALID');
  assertAllowedKeys(input, new Set([
    'sample_key',
    'creator_key',
    'provider',
    'provider_adapter_version',
    'source_ref',
    'observed_at',
    'retrieved_at',
    'contents',
    'sampling',
    'semantic_analyzer',
    'provider_reliability',
    'freshness_max_age_seconds',
    'now',
    'window_start',
    'window_end',
    'input_fingerprint',
  ]), 'analysis');
  const observedAt = timestamp(input.observed_at, 'observed_at');
  const retrievedAt = timestamp(input.retrieved_at, 'retrieved_at');
  if (Date.parse(retrievedAt) < Date.parse(observedAt)) fail('TIMESTAMP_ORDER_INVALID');
  const nowInput = input.now ?? (typeof clock === 'function' ? clock() : clock);
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput ?? Date.now());
  if (Number.isNaN(now.getTime())) fail('CLOCK_INVALID');
  const maxAgeSeconds = boundedInteger(input.freshness_max_age_seconds ?? DEFAULT_FRESHNESS_SECONDS, 'freshness_max_age_seconds', {
    minimum: 0,
    maximum: 315360000,
  });
  const contents = sampleContentRecords(input.contents, input.sampling);
  const windowStart = timestamp(input.window_start, 'window_start', { required: false });
  const windowEnd = timestamp(input.window_end, 'window_end', { required: false });
  if (windowStart && windowEnd && Date.parse(windowEnd) <= Date.parse(windowStart)) fail('WINDOW_INVALID');
  const providerReliability = boundedDecimal(input.provider_reliability ?? 0.5, 'provider_reliability');
  const inputFingerprint = input.input_fingerprint === undefined
    ? undefined
    : boundedString(input.input_fingerprint, 'input_fingerprint', { maximum: 64 });
  if (inputFingerprint !== undefined && !/^[0-9a-f]{64}$/i.test(inputFingerprint)) fail('INPUT_FINGERPRINT_INVALID');
  return Object.freeze({
    sampleKey: safeKey(input.sample_key, 'sample_key'),
    creatorKey: safeKey(input.creator_key, 'creator_key'),
    provider: normalizeProvider(input.provider),
    providerAdapterVersion: safeVersion(input.provider_adapter_version, 'provider_adapter_version'),
    sourceRef: safeSourceRef(input.source_ref),
    observedAt,
    retrievedAt,
    now: now.toISOString(),
    maxAgeSeconds,
    providerReliability,
    sampled: contents,
    semanticAnalyzer: input.semantic_analyzer,
    windowStart,
    windowEnd,
    inputFingerprint: inputFingerprint?.toLowerCase(),
  });
}

function normalizeForMatching(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function textFor(item) {
  return normalizeForMatching([item.caption, item.transcript].filter(Boolean).join(' '));
}

function containsTerm(text, term) {
  return text.includes(normalizeForMatching(term));
}

function matchedLabels(text, taxonomy) {
  return Object.entries(taxonomy)
    .filter(([, terms]) => terms.some((term) => containsTerm(text, term)))
    .map(([key]) => key)
    .sort();
}

function refsFor(item) {
  return Object.freeze([...new Set([
    item.source_ref,
    ...item.frame_evidence.map(({ frame_ref }) => frame_ref),
  ])].slice(0, 8));
}

function signal(value, evidenceState, confidence, evidenceRefs, limitations = []) {
  if (evidenceState === 'unavailable' || value === null || value === undefined) {
    return Object.freeze({
      value: null,
      evidence_state: 'unavailable',
      confidence: 0,
      evidence_refs: Object.freeze([]),
      limitations: Object.freeze([...limitations]),
    });
  }
  return Object.freeze({
    value,
    evidence_state: evidenceState,
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(6)),
    evidence_refs: Object.freeze([...new Set(evidenceRefs)].slice(0, 8)),
    limitations: Object.freeze([...limitations]),
  });
}

function lexicalSignal(item, field, refs) {
  const context = item.context[field];
  if (ARRAY_SIGNAL_FIELDS.has(field) && context !== undefined) {
    return signal(Object.freeze([...context]), 'derived', 0.8, refs, ['structured_context_projection']);
  }
  if (ENUM_SIGNAL_FIELDS.has(field) && context !== undefined) {
    return signal(context, 'derived', 0.8, refs, ['structured_context_projection']);
  }
  const text = textFor(item);
  const hasText = Boolean(text);
  if (field === 'topics' || field === 'product_categories' || field === 'claim_types' || field === 'brand_safety_flags') {
    if (!hasText) return signal(null, 'unavailable', 0, [], ['text_or_structured_context_unavailable']);
    const labels = matchedLabels(text, TAXONOMY[field]);
    return signal(Object.freeze(labels), 'derived', labels.length ? 0.72 : 0.45, refs, ['controlled_vocabulary_only']);
  }
  if (field === 'brands_mentioned' || field === 'competitors') {
    if (context !== undefined) return signal(Object.freeze([...context]), 'derived', 0.8, refs, ['structured_context_projection']);
    return signal(null, 'unavailable', 0, [], ['brand_entity_projection_unavailable']);
  }
  if (field === 'sponsored_signal') {
    if (!hasText) return signal(null, 'unavailable', 0, [], ['sponsorship_text_unavailable']);
    const present = SPONSORED_TERMS.some((term) => containsTerm(text, term));
    return signal(present ? 'present' : 'absent', 'derived', present ? 0.9 : 0.55, refs, ['absence_is_not_proof_of_no_sponsorship']);
  }
  if (field === 'promotion_coupon_signal') {
    if (!hasText) return signal(null, 'unavailable', 0, [], ['promotion_text_unavailable']);
    const present = PROMOTION_TERMS.some((term) => containsTerm(text, term));
    return signal(present ? 'present' : 'absent', 'derived', present ? 0.9 : 0.55, refs, ['absence_is_not_proof_of_no_promotion']);
  }
  if (field === 'skincare_affinity') {
    if (!hasText) return signal(null, 'unavailable', 0, [], ['text_unavailable']);
    const topicMatch = matchedLabels(text, TAXONOMY.topics).includes('skincare');
    const categories = matchedLabels(text, TAXONOMY.product_categories);
    const value = topicMatch || categories.length >= 2 ? 'high' : categories.length === 1 ? 'medium' : 'low';
    return signal(value, 'derived', topicMatch || categories.length ? 0.72 : 0.4, refs, ['controlled_vocabulary_only']);
  }
  if (field === 'education_vs_entertainment') {
    if (!hasText) return signal(null, 'unavailable', 0, [], ['text_unavailable']);
    const education = EDUCATION_TERMS.filter((term) => containsTerm(text, term)).length;
    const entertainment = ENTERTAINMENT_TERMS.filter((term) => containsTerm(text, term)).length;
    if (education === 0 && entertainment === 0) return signal('unknown', 'derived', 0.35, refs, ['no_controlled_format_cue']);
    if (education === entertainment) return signal('mixed', 'derived', 0.6, refs, []);
    return signal(education > entertainment ? 'education' : 'entertainment', 'derived', 0.7, refs, []);
  }
  if (field === 'content_format') {
    const value = item.media_kind === 'post' ? 'post' : item.media_kind === 'unknown' ? 'unknown' : item.media_kind;
    return item.media_kind === 'unknown'
      ? signal(null, 'unavailable', 0, [], ['media_format_unavailable'])
      : signal(value, 'observed', 1, refs, []);
  }
  fail('UNSUPPORTED_SIGNAL_FIELD');
}

function buildDeterministicItem(item) {
  const refs = refsFor(item);
  const features = {};
  for (const field of SIGNAL_FIELDS) features[field] = lexicalSignal(item, field, refs);
  return Object.freeze({
    content_key: item.content_key,
    media_kind: item.media_kind,
    published_at: item.published_at,
    evidence_refs: refs,
    features: Object.freeze(features),
  });
}

function normalizeSemanticEvidence(value, label) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 8) fail(`${label.toUpperCase()}_INVALID`);
  return Object.freeze(value.map((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    assertAllowedKeys(entry, new Set(['code', 'basis', 'count']), entryLabel);
    const code = normalizeSlug(entry.code, `${entryLabel}.code`);
    const basis = normalizeSlug(entry.basis, `${entryLabel}.basis`);
    const count = boundedInteger(entry.count, `${entryLabel}.count`, { minimum: 0, maximum: MAX_CONTENT_SAMPLE_SIZE });
    return Object.freeze({ code, basis, count });
  }));
}

function normalizeSemanticItem(value, index, contentKeys, defaultRefs) {
  const label = `semantic.items[${index}]`;
  assertAllowedKeys(value, new Set([
    'content_key',
    'confidence',
    ...SIGNAL_FIELDS,
    'evidence_refs',
    'evidence',
  ]), label);
  const contentKey = safeKey(value.content_key, `${label}.content_key`, CONTENT_KEY_PATTERN);
  if (!contentKeys.has(contentKey)) fail('SEMANTIC_CONTENT_KEY_UNKNOWN');
  const confidence = boundedDecimal(value.confidence, `${label}.confidence`);
  const evidenceRefs = value.evidence_refs === undefined
    ? [...defaultRefs]
    : value.evidence_refs.map((ref, refIndex) => safeSourceRef(ref, `${label}.evidence_refs[${refIndex}]`));
  if (evidenceRefs.length === 0 || evidenceRefs.length > 8) fail('SEMANTIC_EVIDENCE_REFS_INVALID');
  const evidence = normalizeSemanticEvidence(value.evidence, `${label}.evidence`);
  const features = {};
  let supplied = 0;
  for (const field of SIGNAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    supplied += 1;
    if (ARRAY_SIGNAL_FIELDS.has(field)) {
      if (!Array.isArray(value[field])) fail(`${label.toUpperCase()}_${field.toUpperCase()}_INVALID`);
      features[field] = Object.freeze({
        value: Object.freeze(normalizeSlugArray(value[field], `${label}.${field}`)),
        evidence_state: 'inferred',
        confidence,
        evidence_refs: Object.freeze([...new Set(evidenceRefs)].slice(0, 8)),
        limitations: Object.freeze(['structured_semantic_analyzer']),
      });
    } else {
      const normalized = boundedString(value[field], `${label}.${field}`, { maximum: 32 }).toLowerCase();
      if (!ENUM_VALUES[field].has(normalized)) fail(`${label.toUpperCase()}_${field.toUpperCase()}_INVALID`);
      features[field] = signal(normalized, 'inferred', confidence, evidenceRefs, ['structured_semantic_analyzer']);
    }
  }
  if (supplied === 0) fail('SEMANTIC_ITEM_HAS_NO_FEATURES');
  return Object.freeze({ content_key: contentKey, confidence, features: Object.freeze(features), evidence_refs: Object.freeze([...new Set(evidenceRefs)]), evidence });
}

function normalizeSemanticResult(value, contentItems, fallbackRefs) {
  const label = 'semantic';
  assertAllowedKeys(value, new Set(['schema_version', 'model_version', 'confidence', 'items', 'evidence_refs', 'evidence']), label);
  const schemaVersion = safeVersion(value.schema_version, 'semantic.schema_version');
  if (schemaVersion !== CONTENT_SEMANTIC_SCHEMA_VERSION) fail('SEMANTIC_SCHEMA_VERSION_INVALID');
  const modelVersion = safeVersion(value.model_version, 'semantic.model_version');
  const confidence = boundedDecimal(value.confidence, 'semantic.confidence');
  if (!Array.isArray(value.items) || value.items.length > contentItems.length) fail('SEMANTIC_ITEMS_INVALID');
  const contentKeys = new Set(contentItems.map(({ content_key: key }) => key));
  const evidenceRefs = value.evidence_refs === undefined
    ? [...fallbackRefs]
    : value.evidence_refs.map((ref, index) => safeSourceRef(ref, `semantic.evidence_refs[${index}]`));
  if (evidenceRefs.length === 0 || evidenceRefs.length > 16) fail('SEMANTIC_EVIDENCE_REFS_INVALID');
  const items = value.items.map((item, index) => normalizeSemanticItem(item, index, contentKeys, evidenceRefs));
  if (new Set(items.map(({ content_key: key }) => key)).size !== items.length) fail('SEMANTIC_CONTENT_KEY_DUPLICATE');
  return Object.freeze({
    status: 'available',
    schema_version: CONTENT_SEMANTIC_SCHEMA_VERSION,
    model_version: modelVersion,
    confidence,
    items: Object.freeze(items),
    evidence_refs: Object.freeze([...new Set(evidenceRefs)]),
    evidence: normalizeSemanticEvidence(value.evidence, 'semantic.evidence'),
  });
}

function unavailableSemantic(limitation) {
  return Object.freeze({
    status: 'unavailable',
    schema_version: CONTENT_SEMANTIC_SCHEMA_VERSION,
    model_version: null,
    confidence: 0,
    items: Object.freeze([]),
    evidence_refs: Object.freeze([]),
    evidence: Object.freeze([]),
    limitation,
  });
}

function applySemanticItems(deterministicItems, semantic) {
  if (semantic.status !== 'available') return deterministicItems;
  const semanticByKey = new Map(semantic.items.map((item) => [item.content_key, item]));
  return Object.freeze(deterministicItems.map((item) => {
    const overlay = semanticByKey.get(item.content_key);
    if (!overlay) return item;
    const features = { ...item.features };
    for (const [field, value] of Object.entries(overlay.features)) {
      // The media projection is the authoritative observed format. A model
      // may enrich an unknown format but never overwrite an observed one.
      if (field === 'content_format' && item.features.content_format.evidence_state === 'observed') continue;
      features[field] = value;
    }
    return Object.freeze({
      ...item,
      evidence_refs: Object.freeze([...new Set([...item.evidence_refs, ...overlay.evidence_refs])].slice(0, 8)),
      features: Object.freeze(features),
    });
  }));
}

function aggregateFeature(items, field) {
  const available = items.map((item) => item.features[field]).filter((item) => item.evidence_state !== 'unavailable');
  if (available.length === 0) return signal(null, 'unavailable', 0, [], ['feature_unavailable_in_sample']);
  const evidenceState = available.some((item) => item.evidence_state === 'inferred') ? 'inferred' : available.some((item) => item.evidence_state === 'derived') ? 'derived' : 'observed';
  const confidence = available.reduce((total, item) => total + item.confidence, 0) / available.length;
  const evidenceRefs = [...new Set(available.flatMap((item) => item.evidence_refs))].slice(0, 8);
  const limitations = [...new Set(available.flatMap((item) => item.limitations))];
  if (ARRAY_SIGNAL_FIELDS.has(field)) {
    const values = [...new Set(available.flatMap((item) => item.value))].sort();
    return signal(Object.freeze(values), evidenceState, confidence, evidenceRefs, limitations);
  }
  const counts = Object.fromEntries([...new Set(available.flatMap((item) => [item.value]))].sort().map((value) => [value, 0]));
  for (const item of available) counts[item.value] += 1;
  return signal(Object.freeze({ counts, labeled_count: available.length, sample_count: items.length }), evidenceState, confidence, evidenceRefs, limitations);
}

function calculateFreshness(observedAt, now, maxAgeSeconds) {
  const ageSeconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(observedAt)) / 1000));
  return Object.freeze({
    status: ageSeconds <= maxAgeSeconds ? 'fresh' : 'stale',
    age_seconds: ageSeconds,
    max_age_seconds: maxAgeSeconds,
  });
}

function deriveWindow(normalized) {
  const dated = normalized.sampled.items.map((item) => item.published_at).filter(Boolean).sort();
  const start = normalized.windowStart || dated[0] || normalized.observedAt;
  const end = normalized.windowEnd || dated[dated.length - 1] || normalized.retrievedAt;
  if (Date.parse(end) <= Date.parse(start)) {
    return Object.freeze({ start, end: new Date(Date.parse(start) + 1000).toISOString() });
  }
  return Object.freeze({ start, end });
}

function stableSerialize(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  fail('UNSAFE_HASH_INPUT');
}

function sha256(value) {
  return createHash('sha256').update(stableSerialize(value), 'utf8').digest('hex');
}

function buildInputFingerprint(normalized) {
  return sha256({
    creator_key: normalized.creatorKey,
    provider: normalized.provider,
    sample_key: normalized.sampleKey,
    observed_at: normalized.observedAt,
    retrieved_at: normalized.retrievedAt,
    content: normalized.sampled.items.map((item) => ({
      content_key: item.content_key,
      media_kind: item.media_kind,
      published_at: item.published_at,
      source_ref: item.source_ref,
      caption_digest: item.caption ? sha256(item.caption) : null,
      transcript_digest: item.transcript ? sha256(item.transcript) : null,
      context: item.context,
      frame_evidence: item.frame_evidence,
    })),
  });
}

function countAvailableFeatures(features) {
  return SIGNAL_FIELDS.reduce((count, field) => count + (features[field].value === null ? 0 : 1), 0);
}

function buildConfidence({ sampleSize, coverage, semantic, freshness, providerReliability, textCoverage, frameCoverage }) {
  const sampleFactor = Math.min(1, sampleSize / DEFAULT_CONTENT_SAMPLE_SIZE);
  const semanticFactor = semantic.status === 'available' ? semantic.confidence : 0;
  const freshnessFactor = freshness.status === 'fresh' ? 1 : 0.5;
  const factors = Object.freeze({
    sample_size: Number(sampleFactor.toFixed(6)),
    feature_coverage: Number(coverage.ratio.toFixed(6)),
    semantic_confidence: Number(semanticFactor.toFixed(6)),
    freshness: Number(freshnessFactor.toFixed(6)),
    provider_reliability: Number(providerReliability.toFixed(6)),
    text_coverage: Number(textCoverage.toFixed(6)),
    frame_projection_coverage: Number(frameCoverage.toFixed(6)),
  });
  const value = (sampleFactor * 0.22)
    + (coverage.ratio * 0.24)
    + (semanticFactor * 0.18)
    + (freshnessFactor * 0.12)
    + (providerReliability * 0.12)
    + (textCoverage * 0.08)
    + (frameCoverage * 0.04);
  return Object.freeze({ value: Number(value.toFixed(6)), factors });
}

function persistenceMetrics(analysis) {
  const contentFeatures = Object.fromEntries(SIGNAL_FIELDS.map((field) => [field, {
    value: ENUM_SIGNAL_FIELDS.has(field) && analysis.features[field].value?.counts
      ? Object.entries(analysis.features[field].value.counts).flatMap(([value, count]) => Array.from({ length: count }, () => value))
      : analysis.features[field].value,
    evidence_state: analysis.features[field].evidence_state,
    confidence: analysis.features[field].confidence,
    evidence_refs: analysis.features[field].evidence_refs,
    limitations: analysis.features[field].limitations,
  }]));
  return Object.freeze({
    content_features: contentFeatures,
    content_items: analysis.items.map((item) => ({
      content_key: item.content_key,
      media_kind: item.media_kind,
      published_at: item.published_at,
      ...Object.fromEntries(SIGNAL_FIELDS.map((field) => [`${field}_state`, item.features[field].evidence_state])),
    })),
    sampling: analysis.sampling,
    coverage: analysis.coverage,
    freshness: analysis.freshness,
    semantic: analysis.semantic.status === 'available'
      ? {
        status: analysis.semantic.status,
        schema_version: analysis.semantic.schema_version,
        model_version: analysis.semantic.model_version,
        confidence: analysis.semantic.confidence,
        evidence_refs: analysis.semantic.evidence_refs,
        evidence: analysis.semantic.evidence,
      }
      : { status: 'unavailable', limitation: analysis.semantic.limitation },
    evidence_refs: analysis.evidence_refs,
    limitations: analysis.limitations,
  });
}

export async function analyzeContentSample(input, { clock = Date.now } = {}) {
  const normalized = normalizeInput(input, clock);
  const deterministicItems = normalized.sampled.items.map(buildDeterministicItem);
  let semantic = unavailableSemantic('semantic_analyzer_unavailable');
  if (normalized.sampled.items.length > 0 && normalized.semanticAnalyzer !== undefined && normalized.semanticAnalyzer !== null) {
    if (!normalized.semanticAnalyzer || typeof normalized.semanticAnalyzer.analyze !== 'function') fail('SEMANTIC_ANALYZER_INTERFACE_INVALID');
    const semanticInput = Object.freeze({
      schema_version: CONTENT_SEMANTIC_SCHEMA_VERSION,
      items: Object.freeze(normalized.sampled.items.map((item) => Object.freeze({
        content_key: item.content_key,
        media_kind: item.media_kind,
        published_at: item.published_at,
        source_ref: item.source_ref,
        caption: item.caption,
        transcript: item.transcript,
        context: item.context,
        frame_evidence: item.frame_evidence,
      }))),
    });
    try {
      semantic = normalizeSemanticResult(
        await normalized.semanticAnalyzer.analyze(semanticInput),
        normalized.sampled.items,
        [...new Set(normalized.sampled.items.flatMap(refsFor))].slice(0, 16),
      );
    } catch (error) {
      if (error instanceof ContentAnalysisError) throw error;
      semantic = unavailableSemantic('semantic_analyzer_failed');
    }
  }
  const items = applySemanticItems(deterministicItems, semantic);
  const features = Object.freeze(Object.fromEntries(SIGNAL_FIELDS.map((field) => [field, aggregateFeature(items, field)])));
  const availableFeatures = countAvailableFeatures(features);
  const coverage = Object.freeze({
    available_features: availableFeatures,
    expected_features: SIGNAL_FIELDS.length,
    ratio: Number((availableFeatures / SIGNAL_FIELDS.length).toFixed(6)),
    sample_size: items.length,
    candidate_count: normalized.sampled.sampling.candidate_count,
  });
  const freshness = calculateFreshness(normalized.observedAt, normalized.now, normalized.maxAgeSeconds);
  const textCount = normalized.sampled.items.filter((item) => item.caption || item.transcript).length;
  const frameCount = normalized.sampled.items.filter((item) => item.frame_evidence.length > 0).length;
  const confidence = items.length === 0
    ? Object.freeze({ value: 0, factors: Object.freeze({}) })
    : buildConfidence({
      sampleSize: items.length,
      coverage,
      semantic,
      freshness,
      providerReliability: normalized.providerReliability,
      textCoverage: textCount / items.length,
      frameCoverage: frameCount / items.length,
    });
  const limitations = new Set([
    'bounded_recent_sample',
    'raw_media_not_retained',
  ]);
  if (normalized.sampled.sampling.truncated) limitations.add('candidate_set_truncated');
  if (textCount < items.length) limitations.add('partial_text_coverage');
  if (frameCount === 0) limitations.add('representative_frame_projection_unavailable');
  if (semantic.status === 'unavailable') limitations.add(semantic.limitation);
  if (freshness.status === 'stale') limitations.add('stale_observation');
  if (normalized.providerReliability === 0.5) limitations.add('provider_reliability_unspecified');
  const evidenceRefs = Object.freeze([...new Set([
    normalized.sourceRef,
    ...items.flatMap((item) => item.evidence_refs),
    ...semantic.evidence_refs,
  ])].slice(0, 16));
  const evidenceState = items.length === 0
    ? 'unavailable'
    : semantic.status === 'available'
      ? 'inferred'
      : 'derived';
  const window = deriveWindow(normalized);
  const result = {
    contract_version: CONTENT_ANALYSIS_CONTRACT_VERSION,
    algorithm_version: CONTENT_ANALYSIS_ALGORITHM_VERSION,
    model_version: semantic.status === 'available' ? semantic.model_version : null,
    sample_key: normalized.sampleKey,
    creator_key: normalized.creatorKey,
    provider: normalized.provider,
    retrieved_at: normalized.retrievedAt,
    data_classification: evidenceState,
    evidence_state: evidenceState,
    freshness,
    confidence: confidence.value,
    confidence_factors: confidence.factors,
    coverage,
    window,
    sampling: normalized.sampled.sampling,
    items,
    features,
    semantic,
    evidence_refs: evidenceRefs,
    limitations: Object.freeze([...limitations]),
    provider_specific_evidence: Object.freeze({
      provider: normalized.provider,
      operation: 'content_analysis',
      adapter_version: normalized.providerAdapterVersion,
      sample_size: items.length,
      input_projection: Object.freeze({
        captions: textCount,
        transcripts: normalized.sampled.items.filter((item) => item.transcript).length,
        representative_frames: normalized.sampled.items.reduce((total, item) => total + item.frame_evidence.length, 0),
      }),
      persisted_projection: Object.freeze(['features', 'evidence_refs', 'sampling', 'coverage', 'freshness']),
    }),
    provenance: Object.freeze({
      provider: normalized.provider,
      source_type: 'media',
      evidence_state: evidenceState,
      observed_at: normalized.observedAt,
      retrieved_at: normalized.retrievedAt,
      source_ref: normalized.sourceRef,
    }),
    computed_at: normalized.now,
    input_fingerprint: normalized.inputFingerprint || buildInputFingerprint(normalized),
  };
  return deepFreeze({
    ...result,
    persistence_metrics: persistenceMetrics(result),
  });
}

export async function analyzeAndPersistContentSample({
  repository,
  retentionPolicyVersion,
  analysisKey,
  ingestKey,
  evidenceKey,
  ...input
} = {}, options = {}) {
  if (!repository || typeof repository.recordAnalysis !== 'function') fail('REPOSITORY_REQUIRED');
  const analysis = await analyzeContentSample(input, options);
  const persistence = await repository.recordAnalysis({
    analysisKey: safeKey(analysisKey || `content-analysis:${analysis.creator_key}:${analysis.sample_key}`, 'analysisKey'),
    ingestKey: safeKey(ingestKey, 'ingestKey'),
    creatorKey: analysis.creator_key,
    windowStart: analysis.window.start,
    windowEnd: analysis.window.end,
    evidenceState: analysis.evidence_state,
    confidence: analysis.evidence_state === 'unavailable' ? 0 : analysis.confidence,
    coverageAvailable: analysis.coverage.available_features,
    coverageExpected: analysis.coverage.expected_features,
    algorithmVersion: analysis.algorithm_version,
    modelVersion: analysis.model_version,
    providers: analysis.evidence_state === 'unavailable' ? [] : [analysis.provider],
    inputFingerprint: analysis.input_fingerprint,
    provenance: analysis.evidence_state === 'unavailable' ? [] : [{
      provider: analysis.provider,
      sourceType: 'media',
      evidenceState: 'observed',
      observedAt: analysis.provenance.observed_at,
      retrievedAt: analysis.provenance.retrieved_at,
      sourceRef: analysis.provenance.source_ref,
    }],
    analysisMetrics: analysis.evidence_state === 'unavailable' ? {} : analysis.persistence_metrics,
    computedAt: analysis.computed_at,
    retentionPolicyVersion: safeVersion(retentionPolicyVersion, 'retentionPolicyVersion'),
    evidenceKey,
  });
  return deepFreeze({ analysis, persistence });
}
