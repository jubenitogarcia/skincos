const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const digestC = 'c'.repeat(64);

export const COMMENTER_DIGESTS = Object.freeze({ digestA, digestB, digestC });

export const COMMENT_FIXTURES = Object.freeze({
  mixed: Object.freeze([
    { text: 'This explanation helped me understand the ingredient.', commenterDigest: digestA, languageCode: 'en', likeCount: 3 },
    { text: 'Amei a explicação e vou testar na rotina.', commenterDigest: digestB, languageCode: 'pt-BR', likeCount: 1 },
    { text: 'This explanation helped me understand the ingredient.', commenterDigest: digestA, languageCode: 'en', likeCount: 3 },
    { text: '😍', commenterDigest: digestC, languageCode: 'en', likeCount: 0 },
    { text: 'nice post', commenterDigest: digestC, languageCode: 'en' },
    { text: 'This explanation helped me understand the ingredients!', commenterDigest: digestB, languageCode: 'en', likeCount: 10 },
    { text: 'La textura parece ligera para piel sensible.', languageCode: 'es', likeCount: 2 },
  ]),
  genuine: Object.freeze([
    { text: 'Usei por duas semanas e a textura funcionou bem na minha pele seca.', commenterDigest: digestA, languageCode: 'pt', likeCount: 5 },
    { text: 'The comparison between the two formulas was useful for my routine.', commenterDigest: digestB, languageCode: 'en', likeCount: 4 },
    { text: 'La explicación del protector solar fue clara y práctica.', commenterDigest: digestC, languageCode: 'es', likeCount: 2 },
  ]),
  noLabels: Object.freeze([
    { text: 'A thoughtful question about the routine.' },
    { text: 'Another independent response with useful detail.' },
  ]),
  boundedCandidates: Object.freeze(Array.from({ length: 6 }, (_, index) => ({
    text: `bounded sample comment ${index + 1}`,
    commenterDigest: digestA,
    languageCode: 'en',
  }))),
});

export const STRUCTURED_SEMANTIC_RESULT = Object.freeze({
  schemaVersion: 'influencer-intelligence-comments-semantic/v1',
  modelVersion: 'semantic-comments-fixture/v1',
  confidence: 0.78,
  relevance: { relevant: 4, generic: 1, spam_like: 1, unknown: 1 },
  evidence: [
    { code: 'contextual_relevance', count: 4, basis: 'aggregate_label' },
    { code: 'generic_language', count: 1, basis: 'generic_pattern' },
    { code: 'repeated_promotion', count: 1, basis: 'aggregate_label' },
    { code: 'insufficient_context', count: 1, basis: 'insufficient_sample_context' },
  ],
  evidenceRefs: ['synthetic-fixture/comments-semantic'],
});
