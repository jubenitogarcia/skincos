import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVIDENCE_STATES,
  INFLUENCER_INTELLIGENCE_CONTRACT_VERSION,
  InfluencerIntelligenceContractError,
  normalizeCoverage,
  normalizeMetricObservation,
  normalizeProviderSnapshot,
  normalizeScoreEnvelope,
  normalizeStructuredSignal,
} from '../contracts.mjs';

const observedAt = '2026-08-10T12:00:00.000Z';
const retrievedAt = '2026-08-10T12:00:03.000Z';

function provenance(overrides = {}) {
  return {
    provider: 'meta-graph',
    sourceType: 'profile',
    evidenceState: 'observed',
    observedAt,
    retrievedAt,
    sourceRef: 'meta-graph:ig-user:synthetic-001',
    ...overrides,
  };
}

function assertContractError(callback, message) {
  assert.throws(callback, (error) => {
    assert.equal(error instanceof InfluencerIntelligenceContractError, true);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test('exposes a closed, versioned evidence vocabulary', () => {
  assert.equal(INFLUENCER_INTELLIGENCE_CONTRACT_VERSION, 'influencer-intelligence/v1');
  assert.deepEqual(EVIDENCE_STATES, ['observed', 'derived', 'inferred', 'unavailable']);
});

test('normalizes a provider snapshot without carrying raw profile payloads', () => {
  const snapshot = normalizeProviderSnapshot({
    creatorKey: 'creator:synthetic-001',
    handle: '@Synthetic.Creator',
    provider: 'META-GRAPH',
    observedAt,
    evidenceState: 'observed',
    provenance: provenance(),
    profile: {
      biography: 'This field is deliberately ignored by the boundary.',
      profilePictureUrl: 'https://example.invalid/not-persisted',
    },
    observations: [
      {
        key: 'followers_count',
        unit: 'count',
        value: 12000,
        evidenceState: 'observed',
        provenance: provenance(),
      },
      {
        key: 'media_count',
        unit: 'count',
        value: 42,
        evidenceState: 'observed',
        provenance: provenance(),
      },
    ],
  });

  assert.equal(snapshot.contractVersion, INFLUENCER_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(snapshot.handle, 'synthetic.creator');
  assert.equal(snapshot.provider, 'meta-graph');
  assert.deepEqual(snapshot.observations.map(({ key, value }) => ({ key, value })), [
    { key: 'followers_count', value: 12000 },
    { key: 'media_count', value: 42 },
  ]);
  assert.equal('profile' in snapshot, false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.observations[0]), true);
});

test('rejects credentials and direct contact identifiers at the contract boundary', () => {
  assertContractError(() => normalizeProviderSnapshot({
    creatorKey: 'creator:synthetic-001',
    provider: 'meta-graph',
    observedAt,
    evidenceState: 'observed',
    provenance: provenance(),
    profile: { email: 'not-for-analytics@example.invalid' },
    observations: [],
  }), /email/);

  assertContractError(() => normalizeProviderSnapshot({
    creatorKey: 'creator:synthetic-001',
    provider: 'meta-graph',
    observedAt,
    evidenceState: 'observed',
    provenance: provenance(),
    access_token: 'never-accepted',
    observations: [],
  }), /access_token/);

  assertContractError(() => normalizeMetricObservation({
    key: 'followers_count',
    unit: 'count',
    value: 12,
    evidenceState: 'observed',
    provenance: provenance({ sourceRef: 'meta-graph:ig-user:synthetic-001?access_token=leak' }),
  }), /credential-like|sourceRef/);
});

test('keeps unavailable observations explicit and value-free', () => {
  const unavailable = normalizeMetricObservation({
    key: 'audience_age_distribution',
    unit: 'ratio',
    value: null,
    evidenceState: 'unavailable',
    confidence: 1,
    provenance: provenance({
      sourceType: 'insights',
      evidenceState: 'unavailable',
    }),
  });
  assert.deepEqual(unavailable, {
    contractVersion: INFLUENCER_INTELLIGENCE_CONTRACT_VERSION,
    key: 'audience_age_distribution',
    unit: 'ratio',
    value: null,
    evidenceState: 'unavailable',
    confidence: 0,
    provenance: {
      contractVersion: INFLUENCER_INTELLIGENCE_CONTRACT_VERSION,
      provider: 'meta-graph',
      sourceType: 'insights',
      evidenceState: 'unavailable',
      observedAt,
      retrievedAt,
      sourceRef: 'meta-graph:ig-user:synthetic-001',
    },
  });

  assertContractError(() => normalizeMetricObservation({
    key: 'audience_age_distribution',
    unit: 'ratio',
    value: 0.4,
    evidenceState: 'unavailable',
    provenance: provenance({ sourceType: 'insights', evidenceState: 'unavailable' }),
  }), /unavailable/);
});

test('calculates coverage rather than accepting a caller-provided ratio', () => {
  assert.deepEqual(normalizeCoverage({ availableMetrics: 3, expectedMetrics: 5 }), {
    availableMetrics: 3,
    expectedMetrics: 5,
    ratio: 0.6,
  });
  assertContractError(() => normalizeCoverage({ availableMetrics: 6, expectedMetrics: 5 }), /cannot exceed/);
});

test('normalizes score envelopes deterministically with provenance and structured signals', () => {
  const envelope = normalizeScoreEnvelope({
    scoreKind: 'influencer',
    score: 78.45678,
    confidence: 0.81,
    coverage: { availableMetrics: 4, expectedMetrics: 5 },
    evidenceState: 'derived',
    providers: ['instagrapi', 'meta-graph', 'meta-graph'],
    provenance: [
      provenance({ provider: 'instagrapi', sourceType: 'media', sourceRef: 'instagrapi:media:synthetic-001' }),
      provenance(),
    ],
    algorithmVersion: 'influencer-score/v1',
    timestamp: retrievedAt,
    signals: [
      {
        key: 'engagement_stability',
        value: 0.73,
        evidenceState: 'derived',
        confidence: 0.9,
        evidenceRefs: ['meta-graph:ig-user:synthetic-001'],
      },
      {
        key: 'suspicious_growth_pattern',
        value: true,
        evidenceState: 'inferred',
        confidence: 0.42,
        modelVersion: 'risk-signals/v1',
        evidenceRefs: ['instagrapi:media:synthetic-001'],
      },
    ],
  });

  assert.equal(envelope.score, 78.4568);
  assert.equal(envelope.coverage.ratio, 0.8);
  assert.deepEqual(envelope.providers, ['instagrapi', 'meta-graph']);
  assert.deepEqual(envelope.signals.map(({ key }) => key), ['engagement_stability', 'suspicious_growth_pattern']);
  assert.equal(envelope.signals[1].modelVersion, 'risk-signals/v1');
  assert.equal(envelope.provenance[0].provider, 'instagrapi');
  assert.equal('rationale' in envelope.signals[0], false);
});

test('requires auditability for inferred signals and scores', () => {
  assertContractError(() => normalizeStructuredSignal({
    key: 'brand_safety',
    value: 'unknown',
    evidenceState: 'inferred',
    confidence: 0.4,
    evidenceRefs: [],
  }), /evidence reference/);

  assertContractError(() => normalizeStructuredSignal({
    key: 'brand_safety',
    value: 'unknown',
    evidenceState: 'inferred',
    confidence: 0.4,
    evidenceRefs: ['meta-graph:ig-user:synthetic-001'],
  }), /modelVersion/);

  assertContractError(() => normalizeScoreEnvelope({
    scoreKind: 'campaign-fit',
    score: 54,
    confidence: 0.5,
    coverage: { availableMetrics: 1, expectedMetrics: 2 },
    evidenceState: 'derived',
    providers: [],
    provenance: [],
    algorithmVersion: 'campaign-fit/v1',
    timestamp: retrievedAt,
  }), /at least one provider/);
});
