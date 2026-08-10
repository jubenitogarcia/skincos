'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateRollout, normalizeEvidence } = require('../scripts/livia/rollout-policy');

const passingShadow = {
  evaluated: 2,
  aiSuccesses: 1,
  fallbacks: 1,
  providerErrors: 0,
  qualityFailures: 0,
  identityMismatches: 0,
  functionalSmoke: true,
  rollbackAvailable: true,
};

test('Livia shadow evidence can activate only with an AI success and rollback proof', () => {
  const decision = evaluateRollout({ from: 'shadow', to: 'active', evidence: passingShadow });
  assert.equal(decision.allowed, true);
  assert.equal(decision.resultingMode, 'active');
});

test('Livia activation returns to shadow on provider or quality failure', () => {
  const decision = evaluateRollout({
    from: 'shadow',
    to: 'active',
    evidence: { ...passingShadow, providerErrors: 1 },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.resultingMode, 'shadow');
  assert.ok(decision.reasons.some((reason) => reason.code === 'provider_errors'));
});

test('Livia active guard can hold a healthy active rollout', () => {
  const decision = evaluateRollout({
    from: 'active',
    to: 'active',
    evidence: { ...passingShadow, fallbacks: 0 },
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.resultingMode, 'active');
});

test('Livia evidence rejects inconsistent sample accounting', () => {
  assert.throws(
    () => normalizeEvidence({ ...passingShadow, evaluated: 1 }),
    /evaluated must cover aiSuccesses plus fallbacks/,
  );
});
