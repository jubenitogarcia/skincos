import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CREATOR_REGISTRY_STATES,
  PROVIDER_REGISTRY_STATES,
  REGISTRY_CONTRACT_VERSION,
  normalizeCreatorRegistryEntry,
} from '../registry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(here, '..', 'migrations', '20260810_influencer_intelligence_registry_v1.up.sql');
const observedAt = '2026-08-10T13:00:00.000Z';
const retrievedAt = '2026-08-10T13:00:02.000Z';
const digest = 'a'.repeat(64);

function assertRegistryError(callback, pattern) {
  assert.throws(callback, (error) => {
    assert.match(error.message, /InfluencerIntelligenceRegistryError|not permitted in a domain contract/i);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test('keeps registry states closed and versioned', () => {
  assert.deepEqual(CREATOR_REGISTRY_STATES, ['candidate', 'paused', 'unavailable']);
  assert.deepEqual(PROVIDER_REGISTRY_STATES, ['configured', 'revoked', 'unavailable']);
  assert.equal(REGISTRY_CONTRACT_VERSION, 'influencer-intelligence-registry/v1');
});

test('normalizes a minimal candidate without provider identity material', () => {
  const entry = normalizeCreatorRegistryEntry({
    creatorKey: 'creator:synthetic-001',
    canonicalHandle: '@Synthetic.Creator',
    providers: [],
  });
  assert.deepEqual(entry, {
    contractVersion: REGISTRY_CONTRACT_VERSION,
    creatorKey: 'creator:synthetic-001',
    canonicalHandle: 'synthetic.creator',
    registryState: 'candidate',
    providers: [],
  });
  assert.equal(Object.isFrozen(entry), true);
});

test('normalizes pseudonymous provider digests and retains provenance timestamps only', () => {
  const entry = normalizeCreatorRegistryEntry({
    creatorKey: 'creator:synthetic-001',
    registryState: 'candidate',
    providers: [
      {
        provider: 'instagrapi',
        providerState: 'unavailable',
        evidenceState: 'unavailable',
      },
      {
        provider: 'META-GRAPH',
        providerAccountDigest: digest.toUpperCase(),
        providerState: 'configured',
        evidenceState: 'observed',
        lastObservedAt: observedAt,
        lastRetrievedAt: retrievedAt,
        sourceRef: 'meta-graph:ig-user:synthetic-001',
      },
    ],
  });
  assert.deepEqual(entry.providers.map(({ provider }) => provider), ['instagrapi', 'meta-graph']);
  assert.equal(entry.providers[1].providerAccountDigest, digest);
  assert.equal('providerAccountId' in entry.providers[1], false);
  assert.equal('token' in entry.providers[1], false);
});

test('rejects raw account identifiers, direct contact fields, and invalid binding states', () => {
  assertRegistryError(() => normalizeCreatorRegistryEntry({
    creatorKey: 'creator:synthetic-001',
    email: 'not-retained@example.invalid',
    providers: [],
  }), /email/);

  assertRegistryError(() => normalizeCreatorRegistryEntry({
    creatorKey: 'creator:synthetic-001',
    providers: [{ provider: 'meta-graph', providerAccountId: 'raw-id' }],
  }), /providerAccountId/);

  assertRegistryError(() => normalizeCreatorRegistryEntry({
    creatorKey: 'creator:synthetic-001',
    providers: [{
      provider: 'meta-graph',
      providerState: 'unavailable',
      evidenceState: 'unavailable',
      providerAccountDigest: digest,
    }],
  }), /unavailable/);

  assertRegistryError(() => normalizeCreatorRegistryEntry({
    creatorKey: 'creator:synthetic-001',
    providers: [{
      provider: 'meta-graph',
      providerState: 'configured',
      evidenceState: 'observed',
      providerAccountDigest: 'not-a-sha256',
      lastObservedAt: observedAt,
    }],
  }), /SHA-256/);

  assertRegistryError(() => normalizeCreatorRegistryEntry({
    creatorKey: 'creator:synthetic-001',
    providers: [{
      provider: 'meta-graph',
      providerState: 'unavailable',
      evidenceState: 'observed',
      lastObservedAt: observedAt,
    }],
  }), /agree on availability/);
});

test('migration is additive, scoped, idempotent, and does not grant public access', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS influencer_intelligence/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS influencer_intelligence\.schema_migrations/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS influencer_intelligence\.creator_registry/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS influencer_intelligence\.creator_provider_registry/i);
  assert.match(sql, /provider_account_digest/i);
  assert.match(sql, /provider IN \('meta-graph', 'instagrapi'\)/i);
  assert.match(sql, /source_ref !~ '\[\?\#\]'/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/i);
  assert.match(sql, /provider_state = 'unavailable'\)\s*=\s*\(evidence_state = 'unavailable'\)/i);
  assert.doesNotMatch(sql, /\bdrop\s+(?:table|schema)\b|\btruncate\b|\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /\bgrant\b[\s\S]*\bpublic\b/i);
  assert.doesNotMatch(sql, /access[_-]?token|refresh[_-]?token|\bemail\b|\bphone\b/i);
});
