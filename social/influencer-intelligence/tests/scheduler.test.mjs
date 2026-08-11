import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SCHEDULER_CONFIG,
  RETRYABLE_FAILURE_CLASSES,
  SNAPSHOT_SERVICE_PATH,
  SCHEDULER_CONTRACT_VERSION,
  buildResultRegistrationEvent,
  buildSnapshotJobs,
  classifySnapshotFailure,
  normalizeSchedulerConfig,
  normalizeSnapshotResult,
  selectActiveCreators,
} from '../scheduler.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const domainRoot = path.resolve(here, '..');
const workflowPath = path.resolve(domainRoot, '..', '..', 'orb', 'engine', 'workflows', 'influencer-intelligence-snapshot.json');
const migrationPath = path.join(domainRoot, 'migrations', '20260811_influencer_intelligence_scheduler_v1.up.sql');

const baseConfig = {
  ...DEFAULT_SCHEDULER_CONFIG,
  enabled: true,
};

function creatorRow(overrides = {}) {
  return {
    creator_key: 'creator:synthetic-001',
    identity_key: 'identity:synthetic-001',
    provider: 'meta-graph',
    canonical_handle: 'synthetic.creator',
    identity_state: 'active',
    evidence_state: 'observed',
    monitoring_enabled: true,
    ...overrides,
  };
}

test('scheduler defaults are conservative and fail closed', () => {
  const config = normalizeSchedulerConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.mode, 'shadow');
  assert.equal(config.intervalHours, 6);
  assert.equal(config.maxCreatorsPerRun, 25);
  assert.equal(config.concurrency, 1);
  assert.equal(config.maxAttempts, 2);
  assert.equal(config.timeoutMs, 30_000);
  assert.equal(config.mediaLimit, 20);
});

test('selection requires explicit monitoring opt-in and observed active identity', () => {
  const result = selectActiveCreators([
    creatorRow(),
    creatorRow({ creator_key: 'creator:disabled', monitoring_enabled: false }),
    creatorRow({ creator_key: 'creator:private', identity_state: 'unavailable' }),
    creatorRow({ creator_key: 'creator:gap', evidence_state: 'unavailable' }),
    creatorRow({ creator_key: 'creator:external', provider: 'modash' }),
    creatorRow(),
  ], { config: baseConfig });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.selected.map((item) => item.creatorKey), ['creator:synthetic-001']);
  assert.equal(result.skipped.length, 5);
  assert.equal(result.skipped.some((item) => item.reason === 'monitoring_not_enabled'), true);
  assert.equal(result.skipped.some((item) => item.reason === 'identity_not_observed_active'), true);
  assert.equal(result.skipped.some((item) => item.reason === 'identity_row_invalid'), true);
  assert.equal(result.skipped.some((item) => item.reason === 'duplicate_creator'), true);
});

test('selection is bounded and disabled selection performs no work', () => {
  const rows = Array.from({ length: 30 }, (_, index) => creatorRow({
    creator_key: `creator:synthetic-${String(index).padStart(3, '0')}`,
    identity_key: `identity:synthetic-${String(index).padStart(3, '0')}`,
  }));
  const bounded = selectActiveCreators(rows, {
    config: { ...baseConfig, maxCreatorsPerRun: 3 },
  });
  assert.equal(bounded.selected.length, 3);

  const disabled = selectActiveCreators(rows, { config: { ...baseConfig, enabled: false } });
  assert.equal(disabled.status, 'disabled');
  assert.deepEqual(disabled.selected, []);

  const partialConfig = selectActiveCreators([creatorRow()], { config: { enabled: true } });
  assert.equal(partialConfig.status, 'ready');
  assert.equal(partialConfig.selected.length, 1);
});

test('jobs cover both snapshot operations and are deterministic across replay', () => {
  const selection = selectActiveCreators([creatorRow()], { config: baseConfig });
  const first = buildSnapshotJobs(selection, {
    config: baseConfig,
    now: '2026-08-11T14:23:00.000Z',
  });
  const replay = buildSnapshotJobs(selection, {
    config: baseConfig,
    now: '2026-08-11T14:59:00.000Z',
  });

  assert.equal(first.contractVersion, SCHEDULER_CONTRACT_VERSION);
  assert.equal(first.jobs.length, 2);
  assert.deepEqual(first.jobs.map((job) => job.operation), ['snapshot_creator', 'snapshot_creator_media']);
  assert.equal(first.jobs[1].limit, 20);
  assert.equal(first.jobs[0].limit, 1);
  assert.equal(first.jobs[0].internalService.path, SNAPSHOT_SERVICE_PATH);
  assert.equal(first.jobs[0].internalService.providerTransport, false);
  assert.deepEqual(first.jobs.map((job) => job.idempotencyKey), replay.jobs.map((job) => job.idempotencyKey));
  assert.deepEqual(first.jobs.map((job) => job.runKey), replay.jobs.map((job) => job.runKey));
  assert.deepEqual(first.jobs[0].retryPolicy.retryableClasses, [...RETRYABLE_FAILURE_CLASSES]);
  assert.equal(/access[_-]?token|api[_-]?key|secret|password|cookie|session|authorization/i.test(JSON.stringify(first.jobs)), false);
});

test('retry policy retries only bounded transient classes with the same identity', () => {
  assert.deepEqual(classifySnapshotFailure({ code: 'timeout', attempt: 1, maxAttempts: 2 }), {
    classification: 'timeout',
    retryable: true,
    attempt: 1,
    maxAttempts: 2,
    sameIdempotencyKey: true,
  });
  assert.equal(classifySnapshotFailure({ statusCode: 429, attempt: 2, maxAttempts: 2 }).retryable, false);
  assert.equal(classifySnapshotFailure({ code: 'not_found', attempt: 1, maxAttempts: 2 }).retryable, false);
  assert.equal(classifySnapshotFailure({ code: 'provider_timeout', attempt: 1, maxAttempts: 2 }).classification, 'timeout');
});

test('result receipts preserve unavailable coverage and never synthesize zero', () => {
  const selection = selectActiveCreators([creatorRow()], { config: baseConfig });
  const jobs = buildSnapshotJobs(selection, { config: baseConfig, now: '2026-08-11T14:23:00Z' });
  const job = jobs.jobs[1];
  const result = normalizeSnapshotResult({
    status: 'partial',
    collectorRun: { status: 'partial' },
    freshness: { status: 'stale' },
    failures: [{ code: 'views_unavailable', classification: 'permanent' }],
  }, job);
  assert.equal(result.coverage.state, 'unavailable');
  assert.equal(result.coverage.available, null);
  assert.equal(result.coverage.expected, null);
  assert.equal(result.coverage.ratio, null);
  assert.equal(result.failureCount, 1);

  const event = buildResultRegistrationEvent(job, { status: 'failed' }, { attempt: 2 });
  assert.equal(event.status, 'failed');
  assert.equal(event.retry.retryable, false);
  assert.equal(event.coverage.available, null);
  assert.equal(event.coverage.ratio, null);
});

test('workflow is inactive, internal-only, bounded, and contains no provider credentials or write action', () => {
  const raw = fs.readFileSync(workflowPath, 'utf8');
  const workflow = JSON.parse(raw);
  assert.equal(workflow.active, false);
  assert.equal(workflow.meta.active_default, false);
  assert.equal(workflow.meta.max_concurrency, 1);
  assert.equal(workflow.meta.publish_allowed, false);
  assert.equal(workflow.meta.instagram_write, false);
  assert.equal(workflow.meta.provider_transport, false);
  assert.equal(workflow.nodes.some((node) => node.credentials), false);
  assert.equal(workflow.nodes.some((node) => /graph\.facebook|graph\.instagram|instaloader/i.test(JSON.stringify(node))), false);
  assert.equal(workflow.nodes.some((node) => /follow|like|comment|direct.message|publish|scrap/i.test(JSON.stringify(node.parameters))), false);
  assert.equal(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest').length, 1);
  assert.equal(workflow.nodes.find((node) => node.name === '01_Cron_6h').parameters.triggerTimes.item[0].value, 6);
  assert.equal(workflow.nodes.find((node) => node.name === '06_Dispatch_And_Register_Snapshot').parameters.options.timeout, 30_000);
});

test('scheduler migration is additive and defaults monitoring off', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS monitoring_enabled boolean NOT NULL DEFAULT false/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS monitoring_interval_hours integer NOT NULL DEFAULT 6/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/i);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|SCHEMA)|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
});
