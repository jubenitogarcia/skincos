const OBSERVED = '2026-08-12T10:00:00.000Z';
const RETRIEVED = '2026-08-12T10:05:00.000Z';

export const CAMPAIGN_FIXTURE = Object.freeze({
  campaign_key: 'campaign-skin-serum-001',
  campaign_version: 1,
  criteria_version: 'campaign-fit-criteria/v1',
  objective: 'awareness',
  brand: 'skinco',
  market: 'brasil',
  category: 'skincare',
  product: 'serum',
  target_geography: ['brasil'],
  target_gender: ['women'],
  target_age: ['25-34'],
  positive_topics: ['skincare', 'education'],
  negative_topics: ['gambling'],
  competitors: ['competitor-x'],
  brand_safety_constraints: ['medical_claim'],
  desired_formats: ['reel'],
  commercial_constraints: { max_sponsored_ratio: 0.4 },
});

export function signal(value, {
  key,
  evidenceState = 'derived',
  confidence = 0.92,
  provider = 'meta-graph',
  freshness = 'fresh',
  modelVersion,
} = {}) {
  const ref = `fixture:campaign-fit:${key}`;
  return {
    value,
    evidence_state: evidenceState,
    confidence,
    evidence_refs: [ref],
    providers: [provider],
    freshness,
    provenance: [{
      provider,
      source_type: 'analysis',
      source_ref: ref,
      observed_at: OBSERVED,
      retrieved_at: RETRIEVED,
      evidence_state: evidenceState,
    }],
    ...(modelVersion ? { model_version: modelVersion } : {}),
  };
}

export function unavailable(key) {
  return {
    value: null,
    evidence_state: 'unavailable',
    confidence: 0,
    freshness: 'unknown',
    limitations: [`${key}_unavailable`],
  };
}

export const GOOD_CREATOR = Object.freeze({
  creator_key: 'creator-good-fit',
  provider_reliability: { 'meta-graph': 0.95 },
  official_provider_available: true,
  signals: {
    topics: signal(['education', 'skincare'], { key: 'topics' }),
    product_categories: signal(['serum', 'moisturizer'], { key: 'product-categories' }),
    brands_mentioned: signal(['skinco'], { key: 'brands-mentioned' }),
    competitors: signal([], { key: 'competitors' }),
    audience_geography: signal({ brasil: 0.82, portugal: 0.08 }, { key: 'audience-geography', confidence: 0.88 }),
    audience_gender: signal({ women: 0.76, men: 0.18 }, { key: 'audience-gender', confidence: 0.86 }),
    audience_age: signal({ '25-34': 0.71, '18-24': 0.17 }, { key: 'audience-age', confidence: 0.84 }),
    commercial_saturation: signal(0.18, { key: 'commercial-saturation' }),
    sponsored_ratio: unavailable('sponsored-ratio'),
    content_formats: signal({ reel: 0.78, image: 0.22 }, { key: 'content-formats' }),
    brand_safety_flags: signal([], { key: 'brand-safety-flags' }),
    engagement_quality: signal(84, { key: 'engagement-quality' }),
    historical_content: signal({ topics: ['skincare', 'education'], product_categories: ['serum'], brands_mentioned: ['skinco'] }, { key: 'historical-content' }),
  },
});

export const MEDIUM_GOOD_FIT = Object.freeze({
  creator_key: 'creator-medium-fit',
  provider_reliability: { 'meta-graph': 0.95 },
  official_provider_available: true,
  signals: {
    topics: signal(['skincare'], { key: 'topics-medium', confidence: 0.8 }),
    product_categories: signal(['serum'], { key: 'product-categories-medium', confidence: 0.8 }),
    brands_mentioned: signal([], { key: 'brands-mentioned-medium', confidence: 0.75 }),
    competitors: signal([], { key: 'competitors-medium', confidence: 0.75 }),
    audience_geography: signal({ brasil: 0.7 }, { key: 'audience-geography-medium', confidence: 0.75 }),
    audience_gender: signal({ women: 0.6 }, { key: 'audience-gender-medium', confidence: 0.75 }),
    audience_age: signal({ '25-34': 0.55 }, { key: 'audience-age-medium', confidence: 0.75 }),
    commercial_saturation: signal(0.3, { key: 'commercial-saturation-medium', confidence: 0.8 }),
    content_formats: signal({ reel: 0.65 }, { key: 'content-formats-medium', confidence: 0.8 }),
    brand_safety_flags: signal([], { key: 'brand-safety-flags-medium', confidence: 0.8 }),
    engagement_quality: signal(54, { key: 'engagement-quality-medium', confidence: 0.8 }),
    historical_content: signal({ product_categories: ['serum'] }, { key: 'historical-content-medium', confidence: 0.8 }),
  },
});

export const COMPETITOR_CONFLICT_CREATOR = Object.freeze({
  creator_key: 'creator-competitor-conflict',
  provider_reliability: { 'meta-graph': 0.95 },
  official_provider_available: true,
  signals: {
    topics: signal(['skincare'], { key: 'topics-conflict' }),
    product_categories: signal(['serum'], { key: 'product-categories-conflict' }),
    brands_mentioned: signal(['competitor-x'], { key: 'brands-mentioned-conflict' }),
    competitors: signal(['competitor-x'], { key: 'competitors-conflict' }),
    commercial_saturation: signal(0.2, { key: 'commercial-saturation-conflict' }),
    content_formats: signal({ reel: 0.8 }, { key: 'content-formats-conflict' }),
    brand_safety_flags: signal([], { key: 'brand-safety-flags-conflict' }),
    engagement_quality: signal(80, { key: 'engagement-quality-conflict' }),
    historical_content: signal({ product_categories: ['serum'] }, { key: 'historical-content-conflict' }),
  },
});

export const MISSING_DEMOGRAPHICS_CREATOR = Object.freeze({
  creator_key: 'creator-missing-demographics',
  provider_reliability: { 'meta-graph': 0.95 },
  official_provider_available: true,
  signals: {
    topics: signal(['skincare'], { key: 'topics-demographics' }),
    product_categories: signal(['serum'], { key: 'product-categories-demographics' }),
    commercial_saturation: signal(0.2, { key: 'commercial-saturation-demographics' }),
    content_formats: signal({ reel: 0.8 }, { key: 'content-formats-demographics' }),
    brand_safety_flags: signal([], { key: 'brand-safety-flags-demographics' }),
    engagement_quality: signal(80, { key: 'engagement-quality-demographics' }),
    historical_content: signal({ product_categories: ['serum'] }, { key: 'historical-content-demographics' }),
    audience_geography: unavailable('audience-geography'),
    audience_gender: unavailable('audience-gender'),
    audience_age: unavailable('audience-age'),
  },
});

export const HIGH_SATURATION_CREATOR = Object.freeze({
  creator_key: 'creator-high-saturation',
  provider_reliability: { 'meta-graph': 0.95 },
  official_provider_available: true,
  signals: {
    topics: signal(['skincare'], { key: 'topics-saturation' }),
    product_categories: signal(['serum'], { key: 'product-categories-saturation' }),
    commercial_saturation: signal(0.9, { key: 'commercial-saturation-high' }),
    content_formats: signal({ reel: 0.8 }, { key: 'content-formats-saturation' }),
    brand_safety_flags: signal([], { key: 'brand-safety-flags-saturation' }),
    engagement_quality: signal(80, { key: 'engagement-quality-saturation' }),
    historical_content: signal({ product_categories: ['serum'] }, { key: 'historical-content-saturation' }),
  },
});

export const INFERRED_CONTENT_CREATOR = Object.freeze({
  creator_key: 'creator-inferred-content',
  provider_reliability: { 'meta-graph': 0.9 },
  official_provider_available: true,
  signals: {
    topics: signal(['skincare'], { key: 'topics-inferred', evidenceState: 'inferred', confidence: 0.62, modelVersion: 'content-model/v1' }),
    product_categories: signal(['serum'], { key: 'product-categories-inferred', evidenceState: 'inferred', confidence: 0.62, modelVersion: 'content-model/v1' }),
    commercial_saturation: signal(0.2, { key: 'commercial-saturation-inferred', evidenceState: 'derived', confidence: 0.8 }),
    content_formats: signal({ reel: 0.8 }, { key: 'content-formats-inferred', confidence: 0.8 }),
    brand_safety_flags: signal([], { key: 'brand-safety-flags-inferred', confidence: 0.8 }),
    engagement_quality: signal(72, { key: 'engagement-quality-inferred', confidence: 0.8 }),
    historical_content: signal({ product_categories: ['serum'] }, { key: 'historical-content-inferred', evidenceState: 'inferred', confidence: 0.62, modelVersion: 'content-model/v1' }),
  },
});
