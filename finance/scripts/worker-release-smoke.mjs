#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const FINANCE_UNIT = 'finance';
const HEALTH_ENDPOINTS = ['health', 'readiness'];

export function normalizeBaseUrl(value) {
  const parsed = new URL(String(value ?? '').trim());
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !['', '/'].includes(parsed.pathname)
  ) {
    throw new Error('Finance Worker base URL must be an HTTPS origin without credentials, path, query or fragment');
  }
  return parsed.origin;
}

function sanitizedObservation(endpoint, status, payload) {
  return {
    endpoint,
    status,
    ok: payload?.ok,
    unit: payload?.unit,
    version: payload?.version,
    environment: payload?.environment,
    ready: payload?.ready,
    d1: payload?.dependencies?.d1?.state,
    moduleControl: payload?.dependencies?.module_control?.state,
    availability: payload?.availability?.state,
  };
}

export function validateEndpointResponse({ endpoint, status, payload, releaseSha, environment }) {
  const observation = sanitizedObservation(endpoint, status, payload);
  const failures = [];

  if (status !== 200) failures.push(`HTTP ${status}`);
  if (payload?.ok !== true) failures.push('ok is not true');
  if (payload?.unit !== FINANCE_UNIT) failures.push('unit is not finance');
  if (payload?.version !== releaseSha) failures.push('version does not match release SHA');
  if (payload?.environment !== environment) failures.push('environment does not match target');
  if (payload?.dependencies?.d1?.state !== 'healthy') failures.push('D1 is not healthy');
  if (payload?.dependencies?.module_control?.state !== 'healthy') failures.push('module-control is not healthy');
  if (payload?.availability?.state !== 'active') failures.push('availability is not active');
  if (endpoint === 'readiness' && payload?.ready !== true) failures.push('ready is not true');

  if (failures.length) {
    throw new Error(`${endpoint} rejected: ${failures.join(', ')}; observed=${JSON.stringify(observation)}`);
  }
  return observation;
}

async function fetchEndpoint({ baseUrl, endpoint, timeoutMs, fetchImpl }) {
  const response = await fetchImpl(`${baseUrl}/${endpoint}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'user-agent': 'SKINCOS-Finance-Release-Smoke/1.0',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new Error(`${endpoint} did not return valid JSON (HTTP ${response.status})`);
  }
  return { status: response.status, payload };
}

export async function runFinanceReleaseSmoke(
  {
    baseUrl,
    releaseSha,
    environment,
    attempts = 12,
    sleepMs = 5_000,
    timeoutMs = 10_000,
    consecutiveSuccesses = 2,
  },
  {
    fetchImpl = globalThis.fetch,
    sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
    logger = console,
  } = {},
) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('release SHA must be a full lowercase commit SHA');
  if (!['staging', 'production'].includes(environment)) throw new Error('environment must be staging or production');
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be a positive integer');
  if (!Number.isInteger(consecutiveSuccesses) || consecutiveSuccesses < 1 || consecutiveSuccesses > attempts) {
    throw new Error('consecutive successes must be a positive integer no greater than attempts');
  }

  let consecutive = 0;
  let lastFailure = 'no request completed';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      let lastObservation;
      for (const endpoint of HEALTH_ENDPOINTS) {
        const result = await fetchEndpoint({
          baseUrl: normalizedBaseUrl,
          endpoint,
          timeoutMs,
          fetchImpl,
        });
        lastObservation = validateEndpointResponse({
          endpoint,
          status: result.status,
          payload: result.payload,
          releaseSha,
          environment,
        });
      }
      consecutive += 1;
      logger.log(
        `Finance release smoke attempt ${attempt}/${attempts} healthy ` +
          `(${consecutive}/${consecutiveSuccesses} consecutive), version=${lastObservation.version}`,
      );
      if (consecutive >= consecutiveSuccesses) {
        return {
          ok: true,
          attemptsUsed: attempt,
          consecutiveSuccesses: consecutive,
          releaseSha,
          environment,
        };
      }
    } catch (error) {
      consecutive = 0;
      lastFailure = error instanceof Error ? error.message : String(error);
      logger.error(`Finance release smoke attempt ${attempt}/${attempts} failed: ${lastFailure}`);
    }

    if (attempt < attempts) await sleep(sleepMs);
  }

  throw new Error(`Finance release smoke did not converge after ${attempts} attempts: ${lastFailure}`);
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseCliArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    values[key.slice(2)] = value;
  }
  return {
    baseUrl: values['base-url'],
    releaseSha: values['release-sha'],
    environment: values.environment,
    attempts: parsePositiveInteger(values.attempts ?? '12', 'attempts'),
    sleepMs: parsePositiveInteger(values['sleep-ms'] ?? '5000', 'sleep-ms'),
    timeoutMs: parsePositiveInteger(values['timeout-ms'] ?? '10000', 'timeout-ms'),
    consecutiveSuccesses: parsePositiveInteger(
      values['consecutive-successes'] ?? '2',
      'consecutive-successes',
    ),
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await runFinanceReleaseSmoke(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
