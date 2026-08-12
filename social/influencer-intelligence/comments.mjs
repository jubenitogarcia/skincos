import {
  assertNoSensitiveFields,
} from './contracts.mjs';

/**
 * Bounded, aggregate-only comment intelligence.
 *
 * The input comment text is an ephemeral analysis input. It is never returned
 * by this module and is never accepted by the PostgreSQL repository. Provider
 * adapters must reduce commenter identity to a domain-scoped SHA-256 digest
 * before calling this boundary.
 */

export const COMMENT_ANALYSIS_ALGORITHM_VERSION =
  'influencer-intelligence-comments/v1';
export const COMMENT_SAMPLING_VERSION =
  'influencer-intelligence-comments-sampling/v1';
export const COMMENT_SEMANTIC_SCHEMA_VERSION =
  'influencer-intelligence-comments-semantic/v1';

export const MAX_COMMENT_SAMPLE_SIZE = 100;
export const MAX_COMMENT_CANDIDATES = 200;
export const DEFAULT_COMMENT_SAMPLE_SIZE = 50;
export const DEFAULT_COMMENT_FRESHNESS_SECONDS = 7 * 24 * 60 * 60;

export const COMMENT_METRIC_KEYS = Object.freeze([
  'unique_commenter_ratio',
  'emoji_only_ratio',
  'duplicate_ratio',
  'near_duplicate_ratio',
  'generic_short_comment_ratio',
  'repeated_commenter_ratio',
  'comment_length_distribution',
  'language_distribution',
  'comment_like_distribution',
]);

const COMMENT_METRIC_SET = new Set(COMMENT_METRIC_KEYS);
const QUALITY_WEIGHTS = Object.freeze({
  originality: 0.30,
  substance: 0.30,
  audience_diversity: 0.20,
  semantic_relevance: 0.20,
});
const SAMPLING_STRATEGIES = new Set(['bounded_recent', 'deterministic_uniform']);
const FRESHNESS_STATUSES = new Set(['fresh', 'stale', 'unknown']);
const PROVIDER_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/;
const OPAQUE_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/;
const SOURCE_REF_PATTERN = /^[A-Za-z0-9._:/-]{1,240}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^[a-z][a-z0-9._/-]{0,79}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,12}(?:[-_][a-z]{2,8})?$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const COMMENT_FIELDS = new Set([
  'text',
  'commenter_digest',
  'commenterDigest',
  'language_code',
  'languageCode',
  'like_count',
  'likeCount',
]);
const SAMPLING_FIELDS = new Set([
  'max_comments',
  'maxComments',
  'strategy',
]);
const GENERIC_SHORT_PHRASES = new Set([
  'amazing',
  'awesome',
  'congrats',
  'first',
  'gorgeous',
  'linda',
  'lindo',
  'love it',
  'nice',
  'nice post',
  'perfeito',
  'top',
  'wow',
]);
const SEMANTIC_EVIDENCE_CODES = new Set([
  'contextual_relevance',
  'generic_language',
  'repeated_promotion',
  'insufficient_context',
]);
const SEMANTIC_BASIS_CODES = new Set([
  'aggregate_label',
  'topic_overlap',
  'generic_pattern',
  'insufficient_sample_context',
]);

export class CommentIntelligenceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'CommentIntelligenceError';
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new CommentIntelligenceError(code, message);
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

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function boundedInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return undefined;
    fail(`${label.toUpperCase()}_REQUIRED`);
  }
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label.toUpperCase()}_INVALID`);
  }
  return value;
}

function boundedDecimal(value, label, { minimum = 0, maximum = 1, required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return undefined;
    fail(`${label.toUpperCase()}_REQUIRED`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label.toUpperCase()}_INVALID`);
  }
  return round(value);
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

function safeOpaque(value, label, { required = true, pattern = OPAQUE_PATTERN } = {}) {
  const normalized = boundedString(value, label, { maximum: 240, required });
  if (normalized === undefined) return undefined;
  if (!pattern.test(normalized)) fail(`${label.toUpperCase()}_INVALID`);
  return normalized;
}

function safeVersion(value, label, { required = true } = {}) {
  const normalized = boundedString(value, label, { maximum: 80, required });
  if (normalized === undefined) return undefined;
  if (!VERSION_PATTERN.test(normalized)) fail(`${label.toUpperCase()}_INVALID`);
  return normalized;
}

function timestamp(value, label) {
  const normalized = boundedString(value, label, { maximum: 40 });
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) fail(`${label.toUpperCase()}_INVALID`);
  return parsed.toISOString();
}

function normalizeProvider(value) {
  const normalized = boundedString(value, 'provider', { maximum: 64 }).toLowerCase();
  if (!PROVIDER_PATTERN.test(normalized)) fail('PROVIDER_INVALID');
  return normalized;
}

function normalizeLanguage(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = boundedString(value, 'languageCode', { maximum: 24 }).toLowerCase().replace('-', '_');
  if (!LANGUAGE_PATTERN.test(normalized.replace('_', '-'))) fail('LANGUAGE_CODE_INVALID');
  return normalized;
}

function normalizeCommenterDigest(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = boundedString(value, 'commenterDigest', { maximum: 64 }).toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) fail('COMMENTER_DIGEST_INVALID');
  return normalized;
}

function normalizeComment(value, index) {
  if (!isRecord(value)) fail('COMMENT_INVALID', `comment[${index}] must be an object`);
  assertNoSensitiveFields({ ...value, ...('text' in value ? { text: undefined } : {}) }, `comment[${index}]`);
  for (const key of Object.keys(value)) {
    if (!COMMENT_FIELDS.has(key)) fail('COMMENT_FIELD_FORBIDDEN', `comment[${index}] contains an unsupported field`);
  }
  const text = boundedString(value.text, `comment[${index}].text`, { maximum: 2000 });
  try {
    assertNoSensitiveFields(text, `comment[${index}].text`);
  } catch {
    fail('COMMENT_TEXT_POLICY_BLOCKED');
  }
  const commenterDigest = normalizeCommenterDigest(value.commenter_digest ?? value.commenterDigest);
  const languageCode = normalizeLanguage(value.language_code ?? value.languageCode);
  const likeCount = boundedInteger(value.like_count ?? value.likeCount, `comment[${index}].likeCount`, {
    minimum: 0,
    required: false,
  });
  return Object.freeze({
    text,
    ...(commenterDigest ? { commenter_digest: commenterDigest } : {}),
    ...(languageCode ? { language_code: languageCode } : {}),
    ...(likeCount !== undefined ? { like_count: likeCount } : {}),
  });
}

function normalizeSamplingConfig(value = {}, candidateCount = 0) {
  if (!isRecord(value)) fail('SAMPLING_CONFIG_INVALID');
  for (const key of Object.keys(value)) {
    if (!SAMPLING_FIELDS.has(key)) fail('SAMPLING_CONFIG_FIELD_FORBIDDEN');
  }
  const maxComments = boundedInteger(value.max_comments ?? value.maxComments ?? DEFAULT_COMMENT_SAMPLE_SIZE, 'maxComments', {
    minimum: 1,
    maximum: MAX_COMMENT_SAMPLE_SIZE,
  });
  const strategy = boundedString(value.strategy ?? 'bounded_recent', 'sampling.strategy', { maximum: 40 }).toLowerCase();
  if (!SAMPLING_STRATEGIES.has(strategy)) fail('SAMPLING_STRATEGY_INVALID');
  return Object.freeze({
    sampling_version: COMMENT_SAMPLING_VERSION,
    strategy,
    requested_limit: maxComments,
    candidate_count: candidateCount,
    selected_count: Math.min(candidateCount, maxComments),
    truncated: candidateCount > maxComments,
    source_order: 'provider_bounded',
    retention: 'aggregate_only',
  });
}

export function sampleCommentRecords(comments, config = {}) {
  if (!Array.isArray(comments) || comments.length > MAX_COMMENT_CANDIDATES) {
    fail('COMMENT_CANDIDATES_OUT_OF_BOUNDS');
  }
  const normalized = comments.map((comment, index) => normalizeComment(comment, index));
  const sampling = normalizeSamplingConfig(config, normalized.length);
  const limit = sampling.requested_limit;
  let selected;
  if (normalized.length <= limit) {
    selected = normalized;
  } else if (sampling.strategy === 'bounded_recent') {
    selected = normalized.slice(0, limit);
  } else {
    selected = limit === 1
      ? [normalized[0]]
      : Array.from({ length: limit }, (_, index) => {
        const sourceIndex = Math.floor((index * (normalized.length - 1)) / (limit - 1));
        return normalized[sourceIndex];
      });
  }
  return Object.freeze({
    comments: Object.freeze(selected),
    sampling: Object.freeze({ ...sampling, selected_count: selected.length }),
  });
}

function normalizedText(text) {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[.,!?;:()[\]{}"'`…]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function lexicalText(text) {
  return normalizedText(text).replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/gu, ' ').trim();
}

function isEmojiOnly(text) {
  const normalized = text.trim();
  if (!normalized) return false;
  let hasEmoji = false;
  for (const character of normalized) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}/u.test(character)) {
      hasEmoji = true;
      continue;
    }
    if (/\p{M}|\s|\uFE0F|\u200D/u.test(character)) continue;
    return false;
  }
  return hasEmoji;
}

function isGenericShort(text) {
  if (text.length > 24) return false;
  const lexical = lexicalText(text);
  if (!lexical) return false;
  if (GENERIC_SHORT_PHRASES.has(lexical)) return true;
  const words = lexical.split(' ');
  return words.length <= 3 && words.every((word) => GENERIC_SHORT_PHRASES.has(word));
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : Math.min(previous[column - 1] + 1, above + 1, diagonal + 1);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function tokenJaccard(left, right) {
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function isNearDuplicate(left, right) {
  if (!left || !right || left === right) return false;
  const distance = levenshtein(left, right) / Math.max(left.length, right.length);
  return distance <= 0.12 || tokenJaccard(left, right) >= 0.8;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]);
}

function countBins(values, bins) {
  const counts = Object.fromEntries(bins.map(({ bucket }) => [bucket, 0]));
  for (const value of values) {
    const bucket = bins.find(({ minimum, maximum }) => value >= minimum && (maximum === undefined || value <= maximum));
    counts[bucket?.bucket || bins.at(-1).bucket] += 1;
  }
  return counts;
}

function metric(value, { confidence = 1, limitations = [] } = {}) {
  return Object.freeze({
    value: value === null ? null : (typeof value === 'number' ? round(value) : value),
    evidence_state: value === null ? 'unavailable' : 'derived',
    confidence: value === null ? 0 : round(confidence),
    limitations: Object.freeze([...new Set(limitations)]),
  });
}

function unavailableMetric(limitation) {
  return metric(null, { limitations: [limitation] });
}

function calculateFreshness(observedAt, retrievedAt, now, maxAgeSeconds) {
  const nowMs = Date.parse(now);
  const observedMs = Date.parse(observedAt);
  const ageSeconds = Math.max(0, Math.floor((nowMs - observedMs) / 1000));
  const status = ageSeconds <= maxAgeSeconds ? 'fresh' : 'stale';
  return Object.freeze({
    status,
    observed_at: observedAt,
    retrieved_at: retrievedAt,
    age_seconds: ageSeconds,
    max_age_seconds: maxAgeSeconds,
  });
}

function normalizeSemanticEvidence(value, sampleSize) {
  if (!Array.isArray(value) || value.length > 8) fail('SEMANTIC_EVIDENCE_INVALID');
  return Object.freeze(value.map((entry, index) => {
    if (!isRecord(entry)) fail('SEMANTIC_EVIDENCE_INVALID');
    const keys = Object.keys(entry);
    if (keys.some((key) => !['code', 'count', 'basis'].includes(key))) fail('SEMANTIC_FREE_FORM_EVIDENCE_REJECTED');
    const code = boundedString(entry.code, `semantic.evidence[${index}].code`, { maximum: 64 }).toLowerCase();
    const basis = boundedString(entry.basis, `semantic.evidence[${index}].basis`, { maximum: 64 }).toLowerCase();
    if (!SEMANTIC_EVIDENCE_CODES.has(code) || !SEMANTIC_BASIS_CODES.has(basis)) fail('SEMANTIC_EVIDENCE_CODE_INVALID');
    const count = boundedInteger(entry.count, `semantic.evidence[${index}].count`, { maximum: sampleSize });
    return Object.freeze({ code, count, basis });
  }));
}

function normalizeSemanticResult(value, sampleSize, fallbackRef) {
  if (!isRecord(value)) fail('SEMANTIC_RESULT_INVALID');
  const allowed = new Set(['schema_version', 'schemaVersion', 'model_version', 'modelVersion', 'confidence', 'relevance', 'evidence', 'evidence_refs', 'evidenceRefs']);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail('SEMANTIC_FREE_FORM_OUTPUT_REJECTED');
  const schemaVersion = boundedString(value.schema_version ?? value.schemaVersion, 'semantic.schemaVersion', { maximum: 80 });
  if (schemaVersion !== COMMENT_SEMANTIC_SCHEMA_VERSION) fail('SEMANTIC_SCHEMA_VERSION_INVALID');
  const modelVersion = safeVersion(value.model_version ?? value.modelVersion, 'semantic.modelVersion');
  const confidence = boundedDecimal(value.confidence, 'semantic.confidence');
  if (!isRecord(value.relevance)) fail('SEMANTIC_RELEVANCE_INVALID');
  const relevanceKeys = ['relevant', 'generic', 'spam_like', 'unknown'];
  if (Object.keys(value.relevance).some((key) => !relevanceKeys.includes(key))) fail('SEMANTIC_RELEVANCE_INVALID');
  const relevance = Object.fromEntries(relevanceKeys.map((key) => [
    key,
    boundedInteger(value.relevance[key], `semantic.relevance.${key}`, { maximum: sampleSize }),
  ]));
  if (Object.values(relevance).reduce((total, count) => total + count, 0) !== sampleSize) {
    fail('SEMANTIC_RELEVANCE_COVERAGE_INVALID');
  }
  const evidence = normalizeSemanticEvidence(value.evidence, sampleSize);
  const evidenceRefsInput = value.evidence_refs ?? value.evidenceRefs ?? [fallbackRef];
  if (!Array.isArray(evidenceRefsInput) || evidenceRefsInput.length < 1 || evidenceRefsInput.length > 8) fail('SEMANTIC_EVIDENCE_REFS_INVALID');
  const normalizedEvidenceRefs = evidenceRefsInput.map((ref, index) => safeOpaque(ref, `semantic.evidenceRefs[${index}]`, { pattern: SOURCE_REF_PATTERN }));
  const evidenceRefs = Object.freeze([...new Set(normalizedEvidenceRefs)]);
  return Object.freeze({
    status: 'available',
    evidence_state: 'inferred',
    schema_version: schemaVersion,
    model_version: modelVersion,
    confidence,
    relevance,
    relevant_ratio: round(relevance.relevant / Math.max(1, sampleSize)),
    evidence,
    evidence_refs: evidenceRefs,
  });
}

function unavailableSemantic(limitation) {
  return Object.freeze({
    status: 'unavailable',
    evidence_state: 'unavailable',
    schema_version: COMMENT_SEMANTIC_SCHEMA_VERSION,
    model_version: null,
    confidence: 0,
    relevance: null,
    relevant_ratio: null,
    evidence: Object.freeze([]),
    evidence_refs: Object.freeze([]),
    limitation,
  });
}

function buildMetrics(comments) {
  const sampleSize = comments.length;
  if (sampleSize === 0) {
    return Object.freeze(Object.fromEntries(COMMENT_METRIC_KEYS.map((key) => [key, unavailableMetric('empty_sample')])));
  }
  const texts = comments.map(({ text }) => normalizedText(text));
  const frequencies = new Map();
  for (const text of texts) frequencies.set(text, (frequencies.get(text) || 0) + 1);
  const uniqueTexts = frequencies.size;
  const duplicateCount = texts.filter((text) => (frequencies.get(text) || 0) > 1).length;
  const nearDuplicateCount = texts.reduce((count, text, index) => {
    if ((frequencies.get(text) || 0) > 1) return count;
    return count + (texts.some((other, otherIndex) => otherIndex !== index && isNearDuplicate(text, other)) ? 1 : 0);
  }, 0);
  const emojiOnlyCount = comments.filter(({ text }) => isEmojiOnly(text)).length;
  const genericShortCount = comments.filter(({ text }) => isGenericShort(text)).length;
  const lengths = comments.map(({ text }) => [...text].length);
  const commenterDigests = comments.map(({ commenter_digest: digest }) => digest).filter(Boolean);
  const commenterCounts = new Map();
  for (const digest of commenterDigests) commenterCounts.set(digest, (commenterCounts.get(digest) || 0) + 1);
  const repeatedCommentCount = commenterDigests.filter((digest) => commenterCounts.get(digest) > 1).length;
  const languageCounts = new Map();
  for (const language of comments.map(({ language_code: code }) => code).filter(Boolean)) {
    languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
  }
  const likeCounts = comments.map(({ like_count: count }) => count).filter((count) => count !== undefined);
  const likeBins = [
    { bucket: 'none', minimum: 0, maximum: 0 },
    { bucket: 'low', minimum: 1, maximum: 2 },
    { bucket: 'medium', minimum: 3, maximum: 9 },
    { bucket: 'high', minimum: 10, maximum: 49 },
    { bucket: 'very_high', minimum: 50 },
  ];
  const lengthBins = [
    { bucket: 'empty', minimum: 0, maximum: 0 },
    { bucket: 'short_1_20', minimum: 1, maximum: 20 },
    { bucket: 'medium_21_80', minimum: 21, maximum: 80 },
    { bucket: 'long_81_160', minimum: 81, maximum: 160 },
    { bucket: 'very_long_161_plus', minimum: 161 },
  ];
  return Object.freeze({
    unique_commenter_ratio: commenterDigests.length === 0
      ? unavailableMetric('commenter_digest_unavailable')
      : metric(new Set(commenterDigests).size / commenterDigests.length, {
        confidence: commenterDigests.length / sampleSize,
        limitations: commenterDigests.length < sampleSize ? ['partial_commenter_digest_coverage'] : [],
      }),
    emoji_only_ratio: metric(emojiOnlyCount / sampleSize),
    duplicate_ratio: metric((sampleSize - uniqueTexts) / sampleSize),
    near_duplicate_ratio: metric(nearDuplicateCount / sampleSize),
    generic_short_comment_ratio: metric(genericShortCount / sampleSize),
    repeated_commenter_ratio: commenterDigests.length === 0
      ? unavailableMetric('commenter_digest_unavailable')
      : metric(repeatedCommentCount / commenterDigests.length, {
        confidence: commenterDigests.length / sampleSize,
        limitations: commenterDigests.length < sampleSize ? ['partial_commenter_digest_coverage'] : [],
      }),
    comment_length_distribution: metric({
      count: sampleSize,
      mean: round(lengths.reduce((total, value) => total + value, 0) / sampleSize),
      median: median(lengths),
      bins: countBins(lengths, lengthBins),
    }),
    language_distribution: languageCounts.size === 0
      ? unavailableMetric('language_labels_unavailable')
      : metric({
        labeled_count: [...languageCounts.values()].reduce((total, value) => total + value, 0),
        unknown_count: sampleSize - [...languageCounts.values()].reduce((total, value) => total + value, 0),
        counts: Object.fromEntries([...languageCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
      }, {
        confidence: [...languageCounts.values()].reduce((total, value) => total + value, 0) / sampleSize,
        limitations: [...languageCounts.values()].reduce((total, value) => total + value, 0) < sampleSize
          ? ['partial_language_coverage']
          : [],
      }),
    comment_like_distribution: likeCounts.length === 0
      ? unavailableMetric('comment_like_counts_unavailable')
      : metric({
        available_count: likeCounts.length,
        missing_count: sampleSize - likeCounts.length,
        mean: round(likeCounts.reduce((total, value) => total + value, 0) / likeCounts.length),
        median: median(likeCounts),
        bins: countBins(likeCounts, likeBins),
      }, {
        confidence: likeCounts.length / sampleSize,
        limitations: likeCounts.length < sampleSize ? ['partial_comment_like_coverage'] : [],
      }),
  });
}

function qualityComponent(value, evidenceRefs, limitations = [], confidence = 1) {
  return Object.freeze({
    value: round(value * 100, 4),
    evidence_state: 'derived',
    confidence: round(confidence),
    evidence_refs: Object.freeze([...evidenceRefs]),
    limitations: Object.freeze([...limitations]),
  });
}

function buildQuality(metrics, semantic, evidenceRef) {
  const components = {};
  const available = [];
  const originality = 1 - ((metrics.duplicate_ratio.value * 0.6) + (metrics.near_duplicate_ratio.value * 0.4));
  components.originality = qualityComponent(originality, [evidenceRef]);
  available.push(['originality', originality]);
  const substance = 1 - ((metrics.generic_short_comment_ratio.value * 0.6) + (metrics.emoji_only_ratio.value * 0.4));
  components.substance = qualityComponent(substance, [evidenceRef]);
  available.push(['substance', substance]);
  if (metrics.unique_commenter_ratio.value !== null) {
    components.audience_diversity = qualityComponent(
      metrics.unique_commenter_ratio.value,
      [evidenceRef],
      metrics.unique_commenter_ratio.limitations,
      metrics.unique_commenter_ratio.confidence,
    );
    available.push(['audience_diversity', metrics.unique_commenter_ratio.value]);
  } else {
    components.audience_diversity = Object.freeze({ value: null, evidence_state: 'unavailable', confidence: 0, evidence_refs: Object.freeze([]), limitations: Object.freeze(['commenter_digest_unavailable']) });
  }
  if (semantic.status === 'available') {
    components.semantic_relevance = qualityComponent(semantic.relevant_ratio, semantic.evidence_refs, [], semantic.confidence);
    available.push(['semantic_relevance', semantic.relevant_ratio]);
  } else {
    components.semantic_relevance = Object.freeze({ value: null, evidence_state: 'unavailable', confidence: 0, evidence_refs: Object.freeze([]), limitations: Object.freeze([semantic.limitation]) });
  }
  const weightTotal = available.reduce((total, [key]) => total + QUALITY_WEIGHTS[key], 0);
  const score = available.reduce((total, [key, value]) => total + (QUALITY_WEIGHTS[key] * value), 0) / weightTotal;
  return Object.freeze({
    score: round(score * 100, 4),
    components: Object.freeze(components),
    used_components: Object.freeze(available.map(([key]) => key)),
    limitations: Object.freeze(semantic.status === 'unavailable' ? [semantic.limitation] : []),
  });
}

function countAvailableMetrics(metrics) {
  return COMMENT_METRIC_KEYS.reduce((total, key) => total + (metrics[key].value === null ? 0 : 1), 0);
}

function buildConfidence({ sampleSize, coverage, semantic, metrics, freshness, providerReliability }) {
  const sampleFactor = Math.min(1, sampleSize / DEFAULT_COMMENT_SAMPLE_SIZE);
  const commenterCoverage = metrics.unique_commenter_ratio.value === null
    ? 0
    : metrics.unique_commenter_ratio.confidence;
  const semanticFactor = semantic.status === 'available' ? semantic.confidence : 0;
  const freshnessFactor = freshness.status === 'fresh' ? 1 : 0.5;
  const factors = {
    sample_size: round(sampleFactor),
    metric_coverage: round(coverage.ratio),
    commenter_coverage: round(commenterCoverage),
    semantic_confidence: round(semanticFactor),
    freshness: round(freshnessFactor),
    provider_reliability: round(providerReliability),
  };
  const value = (sampleFactor * 0.30)
    + (coverage.ratio * 0.20)
    + (commenterCoverage * 0.15)
    + (semanticFactor * 0.15)
    + (freshnessFactor * 0.10)
    + (providerReliability * 0.10);
  return Object.freeze({ value: round(value), factors });
}

function normalizeAnalysisInput(input, clock) {
  if (!isRecord(input)) fail('ANALYSIS_INPUT_INVALID');
  const allowed = new Set([
    'sample_key', 'sampleKey', 'creator_key', 'creatorKey', 'media_key', 'mediaKey',
    'provider', 'provider_adapter_version', 'providerAdapterVersion', 'source_ref', 'sourceRef',
    'observed_at', 'observedAt', 'retrieved_at', 'retrievedAt', 'comments', 'sampling',
    'semantic_analyzer', 'semanticAnalyzer', 'provider_reliability', 'providerReliability',
    'freshness_max_age_seconds', 'freshnessMaxAgeSeconds',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail('ANALYSIS_FIELD_FORBIDDEN');
  const sampleKey = safeOpaque(input.sample_key ?? input.sampleKey, 'sampleKey');
  const creatorKey = safeOpaque(input.creator_key ?? input.creatorKey, 'creatorKey');
  const mediaKey = safeOpaque(input.media_key ?? input.mediaKey, 'mediaKey', { required: false });
  const provider = normalizeProvider(input.provider);
  const providerAdapterVersion = safeVersion(input.provider_adapter_version ?? input.providerAdapterVersion, 'providerAdapterVersion');
  const sourceRef = safeOpaque(input.source_ref ?? input.sourceRef, 'sourceRef', { pattern: SOURCE_REF_PATTERN });
  const observedAt = timestamp(input.observed_at ?? input.observedAt, 'observedAt');
  const retrievedAt = timestamp(input.retrieved_at ?? input.retrievedAt, 'retrievedAt');
  if (Date.parse(retrievedAt) < Date.parse(observedAt)) fail('TIMESTAMP_ORDER_INVALID');
  const nowValue = typeof clock === 'function' ? clock() : clock;
  const nowDate = nowValue instanceof Date ? nowValue : new Date(nowValue === undefined ? Date.now() : nowValue);
  if (Number.isNaN(nowDate.getTime())) fail('CLOCK_INVALID');
  const maxAgeSeconds = boundedInteger(input.freshness_max_age_seconds ?? input.freshnessMaxAgeSeconds ?? DEFAULT_COMMENT_FRESHNESS_SECONDS, 'freshnessMaxAgeSeconds', {
    minimum: 0,
    maximum: 315360000,
  });
  const providerReliability = boundedDecimal(input.provider_reliability ?? input.providerReliability ?? 0.5, 'providerReliability');
  const sampled = sampleCommentRecords(input.comments, input.sampling || {});
  return {
    sampleKey,
    creatorKey,
    mediaKey,
    provider,
    providerAdapterVersion,
    sourceRef,
    observedAt,
    retrievedAt,
    now: nowDate.toISOString(),
    maxAgeSeconds,
    providerReliability,
    sampled,
    semanticAnalyzer: input.semantic_analyzer ?? input.semanticAnalyzer,
  };
}

function aggregateMetricsForPersistence(analysis) {
  return Object.freeze({
    sample_size: analysis.sample_size,
    metrics: Object.fromEntries(Object.entries(analysis.metrics).map(([key, value]) => [key, value.value])),
    metric_details: analysis.metrics,
    quality_components: analysis.comment_quality.components,
    quality_confidence_factors: analysis.comment_quality.confidence_factors,
    coverage: analysis.coverage,
    sampling: analysis.sampling,
    freshness: analysis.freshness,
    semantic: analysis.semantic.status === 'available'
      ? analysis.semantic
      : { status: 'unavailable', limitation: analysis.semantic.limitation },
    evidence_refs: analysis.evidence_refs,
    limitations: analysis.limitations,
  });
}

export async function analyzeCommentSample(input, { clock = Date.now } = {}) {
  const normalized = normalizeAnalysisInput(input, clock);
  const { comments, sampling } = normalized.sampled;
  const metrics = buildMetrics(comments);
  const evidenceRefs = Object.freeze([normalized.sourceRef]);
  let semantic = unavailableSemantic('semantic_analyzer_unavailable');
  if (comments.length > 0 && normalized.semanticAnalyzer !== undefined && normalized.semanticAnalyzer !== null) {
    if (!normalized.semanticAnalyzer || typeof normalized.semanticAnalyzer.analyze !== 'function') {
      fail('SEMANTIC_ANALYZER_INTERFACE_INVALID');
    }
    try {
      const semanticInput = Object.freeze({
        schema_version: COMMENT_SEMANTIC_SCHEMA_VERSION,
        comments: Object.freeze(comments.map((comment, index) => Object.freeze({ sample_index: index, text: comment.text }))),
      });
      const semanticResult = await normalized.semanticAnalyzer.analyze(semanticInput);
      semantic = normalizeSemanticResult(semanticResult, comments.length, normalized.sourceRef);
    } catch (error) {
      if (error instanceof CommentIntelligenceError) throw error;
      semantic = unavailableSemantic('semantic_analyzer_failed');
    }
  }
  const freshness = calculateFreshness(normalized.observedAt, normalized.retrievedAt, normalized.now, normalized.maxAgeSeconds);
  const availableMetrics = countAvailableMetrics(metrics);
  const coverage = Object.freeze({
    available_metrics: availableMetrics,
    expected_metrics: COMMENT_METRIC_KEYS.length,
    ratio: round(availableMetrics / COMMENT_METRIC_KEYS.length),
    semantic_available: semantic.status === 'available',
  });
  const quality = comments.length === 0
    ? Object.freeze({
      score: null,
      confidence: 0,
      components: Object.freeze({}),
      used_components: Object.freeze([]),
      limitations: Object.freeze(['empty_sample']),
    })
    : buildQuality(metrics, semantic, normalized.sourceRef);
  const confidence = comments.length === 0
    ? Object.freeze({ value: 0, factors: Object.freeze({}) })
    : buildConfidence({
      sampleSize: comments.length,
      coverage,
      semantic,
      metrics,
      freshness,
      providerReliability: normalized.providerReliability,
    });
  const limitations = new Set();
  for (const metricValue of Object.values(metrics)) for (const limitation of metricValue.limitations) limitations.add(limitation);
  for (const limitation of quality.limitations) limitations.add(limitation);
  if (normalized.providerReliability === 0.5 && input.providerReliability === undefined && input.provider_reliability === undefined) {
    limitations.add('provider_reliability_unspecified');
  }
  if (freshness.status === 'stale') limitations.add('stale_observation');
  if (semantic.status === 'unavailable') limitations.add(semantic.limitation);
  const commentQuality = Object.freeze({
    score: quality.score,
    confidence: confidence.value,
    evidence_state: quality.score === null ? 'unavailable' : 'derived',
    algorithm_version: COMMENT_ANALYSIS_ALGORITHM_VERSION,
    components: quality.components,
    used_components: quality.used_components,
    confidence_factors: confidence.factors,
  });
  const analysis = {
    algorithm_version: COMMENT_ANALYSIS_ALGORITHM_VERSION,
    sample_key: normalized.sampleKey,
    creator_key: normalized.creatorKey,
    ...(normalized.mediaKey ? { media_key: normalized.mediaKey } : {}),
    provider: normalized.provider,
    retrieved_at: normalized.retrievedAt,
    data_classification: comments.length === 0 ? 'observed' : 'derived',
    evidence_state: comments.length === 0 ? 'unavailable' : 'derived',
    freshness,
    limitations: Object.freeze([...limitations]),
    provider_specific_evidence: Object.freeze({
      provider: normalized.provider,
      operation: 'get_comments_sample',
      adapter_version: normalized.providerAdapterVersion,
      source_ref: normalized.sourceRef,
      fields: Object.freeze(['aggregate_metrics', 'sample_size', 'sampling_config']),
    }),
    sampling,
    sample_size: comments.length,
    metrics,
    semantic,
    comment_quality: commentQuality,
    coverage,
    evidence_refs: evidenceRefs,
    provenance: Object.freeze({
      provider: normalized.provider,
      source_type: 'comments-aggregate',
      evidence_state: comments.length === 0 ? 'unavailable' : 'derived',
      observed_at: normalized.observedAt,
      retrieved_at: normalized.retrievedAt,
      source_ref: normalized.sourceRef,
    }),
  };
  return deepFreeze({
    ...analysis,
    aggregate_metrics: aggregateMetricsForPersistence(analysis),
  });
}

export async function analyzeAndPersistCommentSample({ repository, retentionPolicyVersion, evidenceKey, ingestKey, ...input } = {}, options = {}) {
  if (!repository || typeof repository.recordCommentSample !== 'function') fail('REPOSITORY_REQUIRED');
  const analysis = await analyzeCommentSample(input, options);
  const result = await repository.recordCommentSample({
    sampleKey: analysis.sample_key,
    ingestKey: safeOpaque(ingestKey, 'ingestKey'),
    creatorKey: analysis.creator_key,
    mediaKey: analysis.media_key,
    evidenceKey: safeOpaque(evidenceKey, 'evidenceKey'),
    provider: analysis.provider,
    providerAdapterVersion: input.providerAdapterVersion ?? input.provider_adapter_version,
    evidenceState: analysis.evidence_state,
    observedAt: analysis.provenance.observed_at,
    retrievedAt: analysis.retrieved_at,
    sourceRef: analysis.provenance.source_ref,
    commentCount: analysis.evidence_state === 'unavailable' ? undefined : analysis.sample_size,
    aggregateMetrics: analysis.evidence_state === 'unavailable' ? {} : analysis.aggregate_metrics,
    modelVersion: analysis.semantic.status === 'available' ? analysis.semantic.model_version : undefined,
    algorithmVersion: analysis.algorithm_version,
    qualityScore: analysis.comment_quality.score,
    qualityConfidence: analysis.comment_quality.confidence,
    samplingVersion: analysis.sampling.sampling_version,
    samplingConfig: analysis.sampling,
    retentionPolicyVersion: safeVersion(retentionPolicyVersion, 'retentionPolicyVersion'),
  });
  return Object.freeze({ analysis, persistence: result });
}
