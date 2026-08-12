'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readConversionContract } = require('../scripts/read-meta-ads-conversion-contract');

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function destination(destinationGroup, suffix) {
  return {
    destination_group: destinationGroup,
    token_id: `facebook_${suffix}`,
    account_id: '123456789',
    api_version: 'v25.0',
    adset_id: `32345678${suffix}`,
  };
}

test('conversion diagnostic creates an isolated run, reads only the reduced conversion contract, and always terminates it', async () => {
  const calls = [];
  const result = await readConversionContract({
    env: {
      TOKEN_VAULT_BASE_URL: 'https://token-vault.example.test',
      TOKEN_VAULT_N8N_API_TOKEN: 'fixture-bearer',
    },
    randomUuid: () => '11111111-2222-3333-4444-555555555555',
    fetchImpl: async (url, init) => {
      const request = {
        url: new URL(url),
        method: init.method,
        body: init.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(request);
      if (request.url.pathname.endsWith('/config')) {
        return json({
          ok: true,
          ready: true,
          config_revision: 'a'.repeat(64),
          destinations: [destination('BarraShoppingSul', '1'), destination('Novo Hamburgo', '2')],
        });
      }
      if (request.url.pathname.endsWith('/runs')) {
        return json({ ok: true, replayed: false, run: { id: 'map_diagnostic' } }, 201);
      }
      if (request.url.pathname.endsWith('/operations')) {
        return json({
          ok: true,
          operation: {
            status: 'completed',
            result: {
              billing_event: 'IMPRESSIONS',
              optimization_goal: 'OFFSITE_CONVERSIONS',
              destination_type: 'WEBSITE',
              attribution_spec: { configured: true, rule_count: 1 },
              promoted_object: {
                present: true,
                keys: ['custom_event_type', 'offline_conversion_data_set_id', 'pixel_id'],
                pixel_configured: true,
                custom_event_type: 'SCHEDULE',
                custom_conversion_configured: false,
                offline_conversion_dataset_configured: true,
              },
              website_event: { configured: true },
              offline_event_dataset: { configured: true },
            },
          },
        });
      }
      if (request.method === 'PATCH' && request.url.pathname.endsWith('/map_diagnostic')) {
        return json({ ok: true, run: { status: 'completed' } });
      }
      throw new Error(`Unexpected ${request.method} ${request.url.pathname}`);
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostic.graph_methods, ['GET']);
  assert.equal(result.diagnostic.no_graph_mutations, true);
  assert.equal(result.diagnostic.run_terminal, true);
  assert.equal(result.adsets.length, 2);
  assert.equal(result.adsets[0].website_event.configured, true);
  assert.equal(result.adsets[0].offline_event_dataset.configured, true);
  assert.equal(JSON.stringify(result).includes('123456789'), false);
  assert.equal(JSON.stringify(result).includes('987654321'), false);

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'POST', 'POST', 'PATCH']);
  const operationBodies = calls.filter((call) => call.url.pathname.endsWith('/operations')).map((call) => call.body);
  assert.equal(operationBodies.length, 2);
  assert.ok(operationBodies.every((body) => body.action === 'read_adset_conversion_contract'));
  assert.ok(operationBodies.every((body) => !Object.keys(body).some((key) => /payload|status|creative/i.test(key))));
  const completion = calls.at(-1).body;
  assert.equal(completion.status, 'completed');
  assert.deepEqual(completion.summary.graph_methods, ['GET']);
  assert.equal(completion.summary.no_graph_mutations, true);
});

test('conversion diagnostic still marks the isolated run terminal when one Graph read fails', async () => {
  const calls = [];
  let operationCount = 0;
  const result = await readConversionContract({
    env: {
      TOKEN_VAULT_BASE_URL: 'https://token-vault.example.test',
      TOKEN_VAULT_N8N_API_TOKEN: 'fixture-bearer',
    },
    randomUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      calls.push({ method: init.method, pathname: parsed.pathname });
      if (parsed.pathname.endsWith('/config')) return json({ ok: true, ready: true, config_revision: 'b'.repeat(64), destinations: [destination('BarraShoppingSul', '1'), destination('Novo Hamburgo', '2')] });
      if (parsed.pathname.endsWith('/runs')) return json({ ok: true, replayed: false, run: { id: 'map_diagnostic' } }, 201);
      if (parsed.pathname.endsWith('/operations')) {
        operationCount += 1;
        return operationCount === 1
          ? json({ ok: false, error: 'meta_operation_failed' }, 502)
          : json({ ok: true, operation: { status: 'completed', result: { promoted_object: {}, attribution_spec: {}, website_event: {}, offline_event_dataset: {} } } });
      }
      if (init.method === 'PATCH') return json({ ok: true, run: { status: 'completed' } });
      throw new Error('unexpected request');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.run_terminal, true);
  assert.equal(result.errors.length, 1);
  assert.equal(calls.at(-1).method, 'PATCH');
});
