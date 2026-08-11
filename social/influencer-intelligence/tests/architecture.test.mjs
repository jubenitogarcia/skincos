import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  API_CONTRACT,
  ARCHITECTURE_MANIFEST,
  BOUNDARIES,
  DATA_MODEL,
  FEATURE_ACCESS,
  IMPLEMENTATION_PLAN,
  INFLUENCER_INTELLIGENCE_ARCHITECTURE_VERSION,
  MCP_CONTRACT,
  PRIVACY_CONTRACT,
  PROVENANCE_CONTRACT,
  PROVIDER_INTERFACE,
  RELEASE_CONTRACT,
  SCORE_CONTRACT,
} from '../architecture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const architecturePath = path.join(here, '..', 'architecture.mjs');
const adrPath = path.resolve(here, '..', '..', '..', 'docs', 'decisions', 'adr-influencer-intelligence-architecture.md');

test('publishes one frozen, versioned architecture manifest', () => {
  assert.equal(INFLUENCER_INTELLIGENCE_ARCHITECTURE_VERSION, 'influencer-intelligence-architecture/v1');
  assert.equal(ARCHITECTURE_MANIFEST.version, INFLUENCER_INTELLIGENCE_ARCHITECTURE_VERSION);
  assert.equal(Object.isFrozen(ARCHITECTURE_MANIFEST), true);
  assert.equal(Object.isFrozen(ARCHITECTURE_MANIFEST.providerInterface), true);
  assert.equal(Object.isFrozen(ARCHITECTURE_MANIFEST.api.routes), true);
});

test('keeps the provider boundary official-first and fail-closed', () => {
  assert.deepEqual(PROVIDER_INTERFACE.providerIdentity.allowed, ['meta-graph', 'instagrapi']);
  assert.equal(PROVIDER_INTERFACE.providerIdentity.officialFirst, 'meta-graph');
  assert.deepEqual(BOUNDARIES.find(({ id }) => id === 'provider-router').fallbackOnlyFor, [
    'provider_unavailable',
    'permission_gap',
    'coverage_gap',
    'timeout',
  ]);
  assert.deepEqual(BOUNDARIES.find(({ id }) => id === 'provider-router').failClosedFor, [
    'policy_block',
    'invalid_response',
    'unclassified_transport',
  ]);
  assert.ok(PROVIDER_INTERFACE.operations.every(({ readOnly }) => readOnly === true));
});

test('models evidence as append-only and provenance-complete', () => {
  assert.deepEqual(PROVENANCE_CONTRACT.evidenceStates, ['observed', 'derived', 'inferred', 'unavailable']);
  assert.deepEqual(PROVENANCE_CONTRACT.requiredFields, [
    'contractVersion',
    'provider',
    'sourceType',
    'evidenceState',
    'observedAt',
    'retrievedAt',
    'sourceRef',
  ]);
  const resources = new Map(DATA_MODEL.resources.map((resource) => [resource.name, resource]));
  for (const name of ['provider_snapshots', 'metric_observations', 'analytics_results', 'score_snapshots', 'structured_signals']) {
    assert.match(resources.get(name).lifecycle, /append-only/i);
  }
  assert.match(DATA_MODEL.invariants.join('\n'), /never silently imputed as zero/i);
});

test('requires deterministic score identity, coverage, and structured signals', () => {
  assert.equal(SCORE_CONTRACT.deterministicFirst, true);
  for (const field of ['score', 'confidence', 'coverage', 'provenance', 'timestamp', 'algorithmVersion', 'signals']) {
    assert.ok(SCORE_CONTRACT.requiredFields.includes(field), `missing score field: ${field}`);
  }
  assert.match(SCORE_CONTRACT.followerRule, /never a quality score/i);
  assert.match(SCORE_CONTRACT.riskRule, /never.*fake-followers/i);
  assert.equal(PRIVACY_CONTRACT.neverPersisted.includes('raw comment text by default'), true);
});

test('keeps API and MCP contracts read-only and bounded', () => {
  assert.ok(API_CONTRACT.routes.every(({ readOnly }) => readOnly === true));
  assert.equal(API_CONTRACT.requestRules.maxCreatorsPerRequest, 20);
  assert.equal(API_CONTRACT.requestRules.maxWindowDays, 365);
  for (const control of ['authentication', 'server-side grant', 'schema sanitization', 'rate limit', 'timeout and abort', 'audit event', 'read-only database role']) {
    assert.ok(MCP_CONTRACT.controls.includes(control), `missing MCP control: ${control}`);
  }
  assert.ok(MCP_CONTRACT.tools.every(({ readOnly }) => readOnly === true));
  assert.equal(MCP_CONTRACT.limits.timeoutMs, 12000);
  assert.match(MCP_CONTRACT.forbidden.join('\n'), /arbitrary SQL/i);
});

test('keeps this architecture milestone off and runtime-free', () => {
  assert.equal(FEATURE_ACCESS.defaultValue, false);
  assert.equal(FEATURE_ACCESS.initialMode, 'off');
  assert.equal(FEATURE_ACCESS.wired, false);
  assert.equal(RELEASE_CONTRACT.architecturePrScope.runtimeEnabled, false);
  assert.equal(RELEASE_CONTRACT.architecturePrScope.migrationApplied, false);
  assert.equal(RELEASE_CONTRACT.architecturePrScope.providerCalls, false);
  assert.equal(RELEASE_CONTRACT.architecturePrScope.crmRegistered, false);
  assert.equal(RELEASE_CONTRACT.architecturePrScope.mcpRegistered, false);
  assert.equal(RELEASE_CONTRACT.architecturePrScope.orbWorkflowChanged, false);

  const source = fs.readFileSync(architecturePath, 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|spawn|exec|execFile|createServer|listen)\s*\(/i);
  assert.doesNotMatch(source, /from\s+['"](?:node:)?(?:http|https|net|tls|child_process|pg)['"]/i);
});

test('covers architecture plus every M0-M13 milestone', () => {
  const ids = IMPLEMENTATION_PLAN.map(({ id }) => id);
  assert.equal(ids[0], 'architecture');
  assert.deepEqual(ids.slice(1), Array.from({ length: 14 }, (_, index) => `M${index}`));
});

test('keeps the ADR synchronized with the required architecture decisions', () => {
  const adr = fs.readFileSync(adrPath, 'utf8');
  assert.match(adr, new RegExp(INFLUENCER_INTELLIGENCE_ARCHITECTURE_VERSION.replaceAll('/', '\\/')));
  for (const heading of [
    '## 1. Decision and scope',
    '## 2. Current-state evidence',
    '## 3. Boundaries',
    '## 4. Provider interface',
    '## 5. Canonical data model',
    '## 6. Provenance model',
    '## 7. Score, confidence, and coverage contract',
    '## 8. Internal API contract',
    '## 9. MCP read-only contract',
    '## 10. Feature flag and release model',
    '## 11. Privacy and data minimization',
    '## 12. Observability and audit',
    '## 13. PostgreSQL and migration policy',
    '## 14. Implementation plan',
    '## 15. Acceptance and rollback',
  ]) {
    assert.ok(adr.includes(heading), `missing ADR heading: ${heading}`);
  }
  assert.match(adr, /Meta Graph/);
  assert.match(adr, /instagrapi/);
  assert.match(adr, /INFLUENCER_INTELLIGENCE_ENABLED=false/);
  assert.match(adr, /off -> shadow -> active/);
  assert.match(adr, /no database, runtime, provider, session, user, or business/);
});
