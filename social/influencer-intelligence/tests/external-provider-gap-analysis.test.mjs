import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHITECTURE_MANIFEST } from '../architecture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const domainRoot = path.resolve(here, '..');
const report = fs.readFileSync(path.join(domainRoot, 'EXTERNAL_PROVIDER_GAP_ANALYSIS.md'), 'utf8');
const adr = fs.readFileSync(path.resolve(domainRoot, '..', '..', 'docs', 'decisions', 'adr-influencer-intelligence-external-provider-gap-analysis.md'), 'utf8');
const normalizedReport = report.replace(/\s+/g, ' ');

test('M13 records a source-level gap analysis without widening the runtime provider allowlist', () => {
  const milestone = ARCHITECTURE_MANIFEST.implementationPlan.find((item) => item.id === 'M13');
  assert.match(milestone.status, /source implemented/i);
  assert.match(milestone.status, /live coverage decision pending runtime evidence/i);
  assert.equal(ARCHITECTURE_MANIFEST.release.currentSourceScope.gapAnalysisSourceAdded, true);
  assert.equal(ARCHITECTURE_MANIFEST.release.currentSourceScope.externalProviderIntegrated, false);
  assert.deepEqual(ARCHITECTURE_MANIFEST.providerInterface.providerIdentity.allowed, ['meta-graph', 'instagrapi']);
});

test('gap report covers the approved stack, priorities, and candidate decisions', () => {
  for (const term of [
    'Meta Graph / Instagram official',
    'instagrapi',
    'Instaloader',
    'SKINCOS history',
    'Content intelligence',
    'Comment intelligence',
    'critical',
    'high',
    'medium',
    'low',
    'Apify',
    'HypeAuditor',
    'Modash',
    'No external service should be added',
    'Token Vault',
    'shadow-only',
  ]) assert.match(normalizedReport, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('gap report rejects duplicate scraping and keeps missing values unavailable', () => {
  assert.match(report, /Do not add or call from this domain/i);
  assert.match(report, /unavailable when absent/i);
  assert.match(report, /no automatic score inputs/i);
  assert.match(report, /not a live\s+coverage study/i);
  assert.match(report, /approved real creator identities/i);
  assert.doesNotMatch(report, /integrate Apify.*now/i);
});

test('ADR carries the no-integration decision and future admission gates', () => {
  assert.match(adr, /no external provider integrated/i);
  assert.match(adr, /Do not integrate Apify, HypeAuditor, Modash, Instaloader/i);
  assert.match(adr, /Token Vault/i);
  assert.match(adr, /shadow evaluation/i);
  assert.match(adr, /disable\/rollback evidence/i);
});

test('M13 records its own delivery and rollback evidence', () => {
  for (const term of [
    'M13 delivery record',
    'Risk:',
    'Surfaces:',
    'Migration: none',
    'Flag/grant:',
    'Validation:',
    'Rollback:',
    'aa388342d4c3bb457faa33ad2b449061002c0b29',
  ]) assert.match(adr, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});
