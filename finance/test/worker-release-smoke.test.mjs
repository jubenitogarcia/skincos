import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeBaseUrl,
  runFinanceReleaseSmoke,
  validateEndpointResponse,
} from '../scripts/worker-release-smoke.mjs';

const releaseSha = 'a'.repeat(40);

function payload(overrides = {}) {
  return {
    ok: true,
    unit: 'finance',
    version: releaseSha,
    environment: 'staging',
    ready: true,
    dependencies: {
      d1: { state: 'healthy', required: true },
      module_control: { state: 'healthy', required: false },
    },
    availability: { state: 'active' },
    ...overrides,
  };
}

function response(body, status = 200) {
  return {
    status,
    text: async () => JSON.stringify(body),
  };
}

const silentLogger = { log() {}, error() {} };

test('Finance release smoke accepts only a bare HTTPS Worker origin', () => {
  assert.equal(normalizeBaseUrl('https://skincos-finance-staging.example.workers.dev/'), 'https://skincos-finance-staging.example.workers.dev');
  assert.throws(() => normalizeBaseUrl('http://example.test'), /HTTPS origin/);
  assert.throws(() => normalizeBaseUrl('https://example.test/health'), /HTTPS origin/);
  assert.throws(() => normalizeBaseUrl('https://user:password@example.test'), /HTTPS origin/);
});

test('Finance release smoke validates the immutable version and required dependencies', () => {
  assert.equal(
    validateEndpointResponse({
      endpoint: 'readiness',
      status: 200,
      payload: payload(),
      releaseSha,
      environment: 'staging',
    }).version,
    releaseSha,
  );
  assert.throws(
    () => validateEndpointResponse({
      endpoint: 'health',
      status: 200,
      payload: payload({ version: 'b'.repeat(40) }),
      releaseSha,
      environment: 'staging',
    }),
    /version does not match release SHA/,
  );
  assert.throws(
    () => validateEndpointResponse({
      endpoint: 'readiness',
      status: 200,
      payload: payload({ dependencies: { d1: { state: 'failed' }, module_control: { state: 'healthy' } } }),
      releaseSha,
      environment: 'staging',
    }),
    /D1 is not healthy/,
  );
});

test('Finance release smoke tolerates propagation and requires consecutive healthy samples', async () => {
  const responses = [
    response(payload({ version: 'b'.repeat(40) })),
    response(payload()),
    response(payload()),
    response(payload()),
    response(payload()),
  ];
  let sleeps = 0;

  const result = await runFinanceReleaseSmoke(
    {
      baseUrl: 'https://skincos-finance-staging.example.workers.dev',
      releaseSha,
      environment: 'staging',
      attempts: 4,
      sleepMs: 1,
      timeoutMs: 100,
      consecutiveSuccesses: 2,
    },
    {
      fetchImpl: async () => responses.shift(),
      sleep: async () => {
        sleeps += 1;
      },
      logger: silentLogger,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.attemptsUsed, 3);
  assert.equal(sleeps, 2);
  assert.equal(responses.length, 0);
});

test('Finance release smoke fails closed when the release never converges', async () => {
  await assert.rejects(
    runFinanceReleaseSmoke(
      {
        baseUrl: 'https://skincos-finance-staging.example.workers.dev',
        releaseSha,
        environment: 'staging',
        attempts: 2,
        sleepMs: 1,
        timeoutMs: 100,
        consecutiveSuccesses: 2,
      },
      {
        fetchImpl: async () => response(payload({ availability: { state: 'disabled' } })),
        sleep: async () => {},
        logger: silentLogger,
      },
    ),
    /did not converge.*availability is not active/,
  );
});
