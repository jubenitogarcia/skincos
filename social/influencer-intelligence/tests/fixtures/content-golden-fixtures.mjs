export const CONTENT_GOLDEN_FIXTURES = Object.freeze({
  recentSample: {
    sample_key: 'content-sample-golden-001',
    creator_key: 'creator:content-golden-001',
    provider: 'meta-graph',
    provider_adapter_version: 'meta-graph-adapter-v1',
    source_ref: 'meta-graph:media:recent-sample',
    observed_at: '2026-08-11T10:00:00.000Z',
    retrieved_at: '2026-08-11T10:01:00.000Z',
    now: '2026-08-11T12:00:00.000Z',
    contents: [
      {
        content_key: 'media:content-001',
        media_kind: 'reel',
        published_at: '2026-08-10T10:00:00.000Z',
        source_ref: 'meta-graph:media:content-001',
        caption: 'Rotina de skincare com sérum e protetor solar. #publi use o cupom PELE10.',
        transcript: 'Hoje explico por que o protetor solar é importante.',
        frame_evidence: [{ frame_ref: 'meta-graph:frame:content-001-01', feature_codes: ['face_visible', 'product_packaging'] }],
      },
      {
        content_key: 'media:content-002',
        media_kind: 'post',
        published_at: '2026-08-08T10:00:00.000Z',
        source_ref: 'meta-graph:media:content-002',
        caption: 'Resenha educativa de hidratante facial: minha experiência após duas semanas.',
        context: { topics: ['skincare', 'review'], product_categories: ['moisturizer'] },
      },
      {
        content_key: 'media:content-003',
        media_kind: 'video',
        published_at: '2026-08-05T10:00:00.000Z',
        source_ref: 'meta-graph:media:content-003',
        caption: 'Comparando dois cleansers para pele sensível.',
        frame_evidence: [{ frame_ref: 'meta-graph:frame:content-003-01', feature_codes: ['product_packaging'] }],
      },
    ],
    sampling: { max_items: 2 },
    provider_reliability: 0.95,
  },
  unavailableEntities: {
    sample_key: 'content-sample-golden-002',
    creator_key: 'creator:content-golden-002',
    provider: 'instagrapi',
    provider_adapter_version: 'instagrapi-adapter-v1',
    source_ref: 'instagrapi:media:entity-gap',
    observed_at: '2026-08-11T10:00:00.000Z',
    retrieved_at: '2026-08-11T10:01:00.000Z',
    now: '2026-08-11T12:00:00.000Z',
    contents: [{
      content_key: 'media:content-004',
      media_kind: 'unknown',
      published_at: null,
      source_ref: 'instagrapi:media:content-004',
      frame_evidence: [{ frame_ref: 'instagrapi:frame:content-004-01', feature_codes: ['product_packaging'] }],
    }],
    provider_reliability: 0.45,
  },
  sparseStale: {
    sample_key: 'content-sample-golden-003',
    creator_key: 'creator:content-golden-003',
    provider: 'meta-graph',
    provider_adapter_version: 'meta-graph-adapter-v1',
    source_ref: 'meta-graph:media:stale',
    observed_at: '2026-01-01T10:00:00.000Z',
    retrieved_at: '2026-01-01T10:01:00.000Z',
    now: '2026-08-11T12:00:00.000Z',
    contents: [{
      content_key: 'media:content-005',
      media_kind: 'post',
      published_at: '2026-01-01T10:00:00.000Z',
      source_ref: 'meta-graph:media:content-005',
      caption: 'Post de rotina.',
    }],
    provider_reliability: 0.8,
  },
});

export function structuredSemanticAnalyzer() {
  return {
    async analyze(input) {
      return {
        schema_version: input.schema_version,
        model_version: 'content-semantic-model-v1',
        confidence: 0.88,
        evidence_refs: ['meta-graph:media:recent-sample', 'meta-graph:frame:content-001-01'],
        evidence: [{ code: 'caption_context', basis: 'bounded_caption', count: 2 }],
        items: input.items.map((item) => ({
          content_key: item.content_key,
          confidence: 0.9,
          topics: item.content_key.endsWith('001') ? ['skincare', 'education'] : ['skincare'],
          product_categories: item.content_key.endsWith('001') ? ['serum', 'sunscreen'] : ['moisturizer'],
          brands_mentioned: [],
          competitors: [],
          sponsored_signal: item.content_key.endsWith('001') ? 'present' : 'unknown',
          promotion_coupon_signal: item.content_key.endsWith('001') ? 'present' : 'unknown',
          skincare_affinity: 'high',
          education_vs_entertainment: 'education',
          claim_types: item.content_key.endsWith('001') ? ['efficacy'] : ['personal_experience'],
          content_format: item.media_kind === 'post' ? 'image' : item.media_kind,
          brand_safety_flags: [],
          evidence_refs: [item.source_ref],
          evidence: [{ code: 'semantic_label', basis: 'caption_and_context', count: 1 }],
        })),
      };
    },
  };
}

