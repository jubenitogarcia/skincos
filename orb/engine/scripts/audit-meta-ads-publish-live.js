#!/usr/bin/env node
'use strict';

const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');
const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');

const executionId = Number(process.argv[2]);
if (!Number.isInteger(executionId) || executionId < 1) {
  throw new Error('Usage: audit-meta-ads-publish-live.js <execution-id>');
}

const bearer = String(process.env.TOKEN_VAULT_N8N_API_TOKEN || '').trim();
if (!bearer) throw new Error('TOKEN_VAULT_N8N_API_TOKEN is required.');

const baseUrl = String(process.env.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault').replace(/\/+$/, '');

function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) { return String(value ?? '').trim(); }

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let root;
  try {
    const result = await client.query(
      `SELECT e.status, d.data
       FROM n8n_runtime.execution_entity e
       JOIN n8n_runtime.execution_data d ON d."executionId" = e.id
       WHERE e.id = $1`,
      [executionId],
    );
    if (!result.rows[0]) throw new Error(`Execution ${executionId} not found.`);
    if (result.rows[0].status !== 'success') throw new Error(`Execution ${executionId} is not successful.`);
    root = parse(result.rows[0].data);
  } finally {
    await client.end();
  }

  const runData = object(object(root).resultData).runData;
  const activateRequest = object(list(runData['Build Activate Batch']?.at(-1)?.data?.main).flat()[0]?.json);
  const activateResponse = object(list(runData['Activate Ad Batch']?.at(-1)?.data?.main).flat()[0]?.json);
  const runId = text(activateRequest.run_id) || text(activateResponse.operation?.operation_key).replace(/^activate:/, '');
  const jobs = list(activateResponse.operation?.result?.jobs);
  if (!runId || !jobs.length) throw new Error('Completed activation jobs were not found.');

  const inventoryRequest = object(list(runData['Build Meta Account Inventory Requests']?.at(-1)?.data?.main).flat()[0]?.json);
  if (!text(inventoryRequest.account_id) || !text(inventoryRequest.token_id)) {
    throw new Error('Inventory request was not found in the successful execution.');
  }
  const inventoryResponse = await fetch(`${baseUrl}/v1/meta-ads-publish/inventory`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(inventoryRequest),
  });
  const inventory = await inventoryResponse.json().catch(() => ({}));
  if (!inventoryResponse.ok || inventory.ok !== true) {
    throw new Error(`Live inventory audit failed: ${inventoryResponse.status} ${text(inventory.error || inventory.detail || 'unknown_error')}`);
  }

  const adsById = new Map(list(inventory.data).map((ad) => [text(ad.id), object(ad)]));
  const audit = [];
  for (const job of jobs) {
    const current = adsById.get(text(job.ad_id));
    if (!current) throw new Error(`Live ad ${job.ad_id} was not returned by inventory.`);
    audit.push({
      destination_group: text(job.destination_group),
      ad_id: text(job.ad_id),
      created_new: job.created_new === true,
      status: text(current.status),
      effective_status: text(current.effective_status),
      creative_id: text(current.creative?.id),
      expected_creative_id: text(job.creative_id),
      creative_matches: text(current.creative?.id) === text(job.creative_id),
      previous_status: text(job.previous_state?.status),
      previous_effective_status: text(job.previous_state?.effective_status),
      stage_success: job.stage_result?.success === true,
      activation_success: job.activation_result?.success === true,
    });
  }

  const configResponse = await fetch(`${baseUrl}/v1/meta-ads-publish/config`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  const config = await configResponse.json().catch(() => ({}));
  if (!configResponse.ok || config.ok !== true) {
    throw new Error(`Live config audit failed: ${configResponse.status} ${text(config.error || 'unknown_error')}`);
  }
  const landingPages = list(config.destinations)
    .filter((destination) => audit.some((ad) => ad.destination_group === text(destination.destination_group)))
    .map((destination) => ({
      destination_group: text(destination.destination_group),
      landing_pages_by_creative_group: object(destination.landing_pages_by_creative_group),
      landing_page_validation_ok: destination.landing_page_validation?.ok === true,
    }));

  console.log(JSON.stringify({
    execution_id: executionId,
    run_id: runId,
    inventory_item_count: inventory.item_count,
    inventory_page_count: inventory.page_count,
    ads: audit,
    landing_pages: landingPages,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
