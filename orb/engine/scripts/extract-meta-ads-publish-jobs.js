#!/usr/bin/env node
'use strict';

const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');
const executionId = Number(process.argv[2]);
const mode = String(process.argv[3] || 'jobs').trim();
if (!Number.isInteger(executionId) || executionId < 1) throw new Error('Usage: extract-meta-ads-publish-jobs.js <execution-id>');

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

async function main() {
  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const result = await client.query('SELECT data FROM n8n_runtime.execution_data WHERE "executionId" = $1', [executionId]);
    if (!result.rows[0]) throw new Error(`Execution ${executionId} not found.`);
    const root = parse(result.rows[0].data);
    const runData = object(object(root).resultData).runData;
    if (mode === 'source-ads') {
      const items = (runData['Meta List Ads'] || []).at(-1)?.data?.main?.flat()
        .map((item) => object(item).json) || [];
      const ids = new Set(['120244825669330157', '120244825669880157']);
      const ads = items.flatMap((item) => Array.isArray(item.data) ? item.data : [])
        .filter((ad) => ids.has(String(ad && ad.id)))
        .map((ad) => ({ id: ad.id, name: ad.name, adset_id: ad.adset_id, campaign_id: ad.campaign_id, creative: ad.creative }));
      console.log(JSON.stringify(ads));
      return;
    }
    const jobs = (runData['Build Jobs'] || []).at(-1)?.data?.main?.flat()
      .map((item) => object(item).json)
      .filter((job) => Object.keys(job).length) || [];
    if (!jobs.length) throw new Error(`Execution ${executionId} has no Build Jobs output.`);
    console.log(JSON.stringify(jobs));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
