#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MODES = new Set(['off', 'shadow', 'active']);
const POLICY_PATH = path.resolve(__dirname, '../../../../ops/governance/livia-rollout-policy.json');

function loadPolicy(policyPath = POLICY_PATH) {
  return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
}

function integer(value, name) {
  const normalized = Number(value ?? 0);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return normalized;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`);
  return value;
}

function normalizeEvidence(input = {}) {
  const evaluated = integer(input.evaluated, 'evaluated');
  const aiSuccesses = integer(input.aiSuccesses, 'aiSuccesses');
  const fallbacks = integer(input.fallbacks, 'fallbacks');
  const providerErrors = integer(input.providerErrors, 'providerErrors');
  const qualityFailures = integer(input.qualityFailures, 'qualityFailures');
  const identityMismatches = integer(input.identityMismatches, 'identityMismatches');
  if (evaluated < aiSuccesses + fallbacks) {
    throw new Error('evaluated must cover aiSuccesses plus fallbacks');
  }
  return {
    evaluated,
    aiSuccesses,
    fallbacks,
    providerErrors,
    qualityFailures,
    identityMismatches,
    functionalSmoke: boolean(input.functionalSmoke, 'functionalSmoke'),
    rollbackAvailable: boolean(input.rollbackAvailable, 'rollbackAvailable'),
  };
}

function pushLimitFailure(reasons, actual, expected, code, message) {
  if (actual > expected) reasons.push({ code, message, actual, expected });
}

function evaluateRollout({ from, to, evidence = {}, policy = loadPolicy() }) {
  const currentMode = String(from || '').trim().toLowerCase();
  const requestedMode = String(to || '').trim().toLowerCase();
  if (!MODES.has(currentMode)) throw new Error(`unsupported current mode: ${currentMode}`);
  if (!MODES.has(requestedMode)) throw new Error(`unsupported requested mode: ${requestedMode}`);

  const normalized = normalizeEvidence(evidence);
  const reasons = [];
  if (requestedMode === 'active' && currentMode !== 'active') {
    if (currentMode !== 'shadow') {
      reasons.push({ code: 'active_requires_shadow', message: 'active promotion must come from shadow' });
    }
    const activation = policy.activation;
    if (normalized.evaluated < activation.minEvaluated) {
      reasons.push({ code: 'insufficient_samples', message: 'shadow evidence has too few evaluated samples', actual: normalized.evaluated, expected: activation.minEvaluated });
    }
    if (normalized.aiSuccesses < activation.minAiSuccesses) {
      reasons.push({ code: 'no_ai_success', message: 'shadow evidence has no qualifying AI success', actual: normalized.aiSuccesses, expected: activation.minAiSuccesses });
    }
    const fallbackRate = normalized.fallbacks / Math.max(normalized.evaluated, 1);
    if (fallbackRate > activation.maxFallbackRate) {
      reasons.push({ code: 'fallback_rate', message: 'shadow fallback rate exceeds the activation limit', actual: fallbackRate, expected: activation.maxFallbackRate });
    }
    pushLimitFailure(reasons, normalized.providerErrors, activation.maxProviderErrors, 'provider_errors', 'provider errors exceed the activation limit');
    pushLimitFailure(reasons, normalized.qualityFailures, activation.maxQualityFailures, 'quality_failures', 'quality failures exceed the activation limit');
    pushLimitFailure(reasons, normalized.identityMismatches, activation.maxIdentityMismatches, 'identity_mismatches', 'identity mismatches exceed the activation limit');
    if (activation.requireFunctionalSmoke && !normalized.functionalSmoke) reasons.push({ code: 'functional_smoke', message: 'functional smoke is not green' });
    if (activation.requireRollbackAvailable && !normalized.rollbackAvailable) reasons.push({ code: 'rollback_missing', message: 'rollback target is not recorded and available' });
  }

  if (requestedMode === 'active' && currentMode === 'active') {
    const guard = policy.activeGuard;
    const failureRate = (normalized.providerErrors + normalized.qualityFailures + normalized.identityMismatches) / Math.max(normalized.evaluated, 1);
    if (failureRate > guard.maxFailureRate) reasons.push({ code: 'active_failure_rate', message: 'active failure rate exceeds the guard', actual: failureRate, expected: guard.maxFailureRate });
    pushLimitFailure(reasons, normalized.providerErrors, guard.maxProviderErrors, 'active_provider_errors', 'active provider errors exceed the guard');
    pushLimitFailure(reasons, normalized.qualityFailures, guard.maxQualityFailures, 'active_quality_failures', 'active quality failures exceed the guard');
    pushLimitFailure(reasons, normalized.identityMismatches, guard.maxIdentityMismatches, 'active_identity_mismatches', 'active identity mismatches exceed the guard');
    if (guard.requireFunctionalSmoke && !normalized.functionalSmoke) reasons.push({ code: 'active_functional_smoke', message: 'active functional smoke is not green' });
    if (guard.requireRollbackAvailable && !normalized.rollbackAvailable) reasons.push({ code: 'active_rollback_missing', message: 'active rollback target is not recorded and available' });
  }

  const allowed = reasons.length === 0;
  const resultingMode = allowed ? requestedMode : (requestedMode === 'active' ? policy.failureMode : currentMode);
  return {
    schemaVersion: policy.schemaVersion,
    module: policy.module,
    from: currentMode,
    requestedMode,
    allowed,
    resultingMode,
    reasons,
    evidence: normalized,
  };
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || fallback;
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function main() {
  if (process.argv[2] !== 'evaluate') throw new Error('Usage: rollout-policy.js evaluate --from <mode> --to <mode> (--evidence-file <json> | --evidence-stdin)');
  const evidenceFile = argument('--evidence-file');
  const evidence = process.argv.includes('--evidence-stdin')
    ? JSON.parse(fs.readFileSync(0, 'utf8'))
    : (path.isAbsolute(evidenceFile) ? JSON.parse(fs.readFileSync(evidenceFile, 'utf8')) : null);
  if (!evidence) throw new Error('an evidence file or stdin evidence is required');
  process.stdout.write(`${JSON.stringify(evaluateRollout({ from: argument('--from'), to: argument('--to'), evidence }))}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
}

module.exports = { MODES, POLICY_PATH, loadPolicy, normalizeEvidence, evaluateRollout };
