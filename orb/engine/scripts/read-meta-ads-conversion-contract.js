#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

const DEFAULT_BASE_URL = 'https://api.skincos.com.br/internal/token-vault';

function text(value) {
  return String(value ?? '').trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function safeEnum(value) {
  const normalized = text(value).toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(normalized) ? normalized : '';
}

function codeFor(responseBody, fallback = 'gateway_request_failed') {
  const root = object(responseBody);
  return text(root.error || object(root.detail).code || fallback)
    .replace(/[^a-z0-9_:-]/gi, '_')
    .slice(0, 120) || fallback;
}

class DiagnosticError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function compactAdset(destination, value) {
  // The gateway's dedicated action already projects the Graph response into
  // this reduced structure before it reaches the Token Vault journal. Select
  // the same known fields again here so this utility remains safe if a future
  // gateway adds unrelated response properties.
  const contract = object(value);
  const promoted = object(contract.promoted_object);
  const attribution = object(contract.attribution_spec);
  const websiteEvent = object(contract.website_event);
  const offlineDataset = object(contract.offline_event_dataset);
  return {
    destination_group: text(destination.destination_group),
    billing_event: safeEnum(contract.billing_event),
    optimization_goal: safeEnum(contract.optimization_goal),
    destination_type: safeEnum(contract.destination_type),
    attribution_spec: {
      configured: attribution.configured === true,
      rule_count: Math.min(Math.max(Number(attribution.rule_count) || 0, 0), 20),
    },
    promoted_object: {
      present: promoted.present === true,
      keys: list(promoted.keys).filter((key) => /^[a-z_]{1,80}$/i.test(key)).sort(),
      pixel_configured: promoted.pixel_configured === true,
      custom_event_type: safeEnum(promoted.custom_event_type),
      custom_conversion_configured: promoted.custom_conversion_configured === true,
      offline_conversion_dataset_configured: promoted.offline_conversion_dataset_configured === true,
    },
    website_event: { configured: websiteEvent.configured === true },
    offline_event_dataset: { configured: offlineDataset.configured === true },
  };
}

async function gatewayRequest({ fetchImpl, baseUrl, bearer, path, method = 'GET', body }) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'user-agent': 'skincos-meta-ads-conversion-contract-readback/1.0',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new DiagnosticError('gateway_network_error');
  }
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok || responseBody.ok !== true) {
    throw new DiagnosticError(codeFor(responseBody, `gateway_http_${response.status || 0}`));
  }
  return responseBody;
}

function configuredDestinations(value) {
  const destinations = list(value).filter((entry) => {
    const destination = object(entry);
    return text(destination.token_id) && text(destination.account_id) && text(destination.api_version) &&
      text(destination.adset_id) && text(destination.destination_group);
  });
  // This utility is intentionally scoped to the two configured destinations of
  // the publish flow.  Refuse a broadened config rather than unexpectedly
  // reading additional ad sets during an operational diagnosis.
  if (destinations.length !== 2) throw new DiagnosticError('diagnostic_destination_count_invalid');
  return destinations;
}

async function readConversionContract({
  fetchImpl = fetch,
  env = process.env,
  randomUuid = () => crypto.randomUUID(),
} = {}) {
  const baseUrl = text(env.TOKEN_VAULT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const bearer = text(env.TOKEN_VAULT_N8N_API_TOKEN);
  if (!baseUrl || !bearer) throw new DiagnosticError('gateway_credential_missing');

  const config = await gatewayRequest({ fetchImpl, baseUrl, bearer, path: '/v1/meta-ads-publish/config' });
  if (config.ready !== true || !/^[a-f0-9]{64}$/i.test(text(config.config_revision))) {
    throw new DiagnosticError('diagnostic_config_not_ready');
  }
  const destinations = configuredDestinations(config.destinations);
  const nonce = text(randomUuid()).replace(/[^A-Za-z0-9]/g, '');
  if (!nonce) throw new DiagnosticError('diagnostic_nonce_invalid');

  const runResponse = await gatewayRequest({
    fetchImpl,
    baseUrl,
    bearer,
    path: '/v1/meta-ads-publish/runs',
    method: 'POST',
    body: {
      config_revision: text(config.config_revision),
      workflow_execution_id: `diagnostic-conversion-contract-${nonce}`,
      files: [{
        id: `diagnostic-no-drive-io-${nonce}`,
        name: 'diagnostic-get-adset.json',
      }],
    },
  });
  const runId = text(object(runResponse.run).id);
  if (!runId || runResponse.replayed === true) throw new DiagnosticError('diagnostic_run_not_created');

  const results = [];
  const errors = [];
  let terminal = {};
  try {
    for (const [index, destination] of destinations.entries()) {
      try {
        const operation = await gatewayRequest({
          fetchImpl,
          baseUrl,
          bearer,
          path: `/v1/meta-ads-publish/runs/${encodeURIComponent(runId)}/operations`,
          method: 'POST',
          body: {
            action: 'read_adset_conversion_contract',
            operation_key: `diagnostic-adset-readback-v1-${nonce}-${index}`,
            token_id: text(destination.token_id),
            account_id: text(destination.account_id),
            api_version: text(destination.api_version),
            object_id: text(destination.adset_id),
          },
        });
        if (object(operation.operation).status !== 'completed') {
          throw new DiagnosticError('diagnostic_conversion_contract_readback_incomplete');
        }
        results.push(compactAdset(destination, object(operation.operation).result));
      } catch (error) {
        errors.push({ destination_group: text(destination.destination_group), code: error instanceof DiagnosticError ? error.code : 'diagnostic_conversion_contract_readback_failed' });
      }
    }
  } finally {
    try {
      terminal = await gatewayRequest({
        fetchImpl,
        baseUrl,
        bearer,
        path: `/v1/meta-ads-publish/runs/${encodeURIComponent(runId)}`,
        method: 'PATCH',
        body: {
          status: 'completed',
          summary: {
            kind: 'diagnostic_conversion_contract_readback_v1',
            graph_actions: ['read_adset_conversion_contract'],
            graph_methods: ['GET'],
            no_graph_mutations: true,
            completed_destinations: results.length,
            failed_destinations: errors.length,
          },
        },
      });
    } catch (error) {
      errors.push({ destination_group: '', code: error instanceof DiagnosticError ? error.code : 'diagnostic_run_completion_failed' });
    }
  }

  return {
    ok: errors.length === 0 && text(object(terminal.run).status) === 'completed',
    diagnostic: {
      graph_actions: ['read_adset_conversion_contract'],
      graph_methods: ['GET'],
      no_graph_mutations: true,
      token_vault_journaled: true,
      run_terminal: text(object(terminal.run).status) === 'completed',
      run_locks_release_requested: text(object(terminal.run).status) === 'completed',
    },
    adsets: results,
    errors,
  };
}

async function main() {
  if (!process.argv.includes('--live')) {
    throw new DiagnosticError('live_flag_required');
  }
  const result = await readConversionContract();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof DiagnosticError ? error.code : 'diagnostic_failed';
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exit(1);
  });
}

module.exports = { compactAdset, readConversionContract };
