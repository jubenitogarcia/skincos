#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';

function loadRuntimeModule(name) {
  try { return require(`/usr/local/lib/node_modules/n8n/node_modules/${name}`); }
  catch { return require(name); }
}

const { Client } = loadRuntimeModule('pg');
const { parse } = loadRuntimeModule('flatted');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sourceRoot = path.join(__dirname, '..', 'workflow-src', 'meta-ads-publish');

function outputItems(runData, name) {
  const run = Array.isArray(runData[name]) ? runData[name][0] : null;
  return Array.isArray(run?.data?.main?.[0]) ? run.data.main[0] : [];
}

async function executeCode(fileName, input, itemsByNode) {
  const code = fs.readFileSync(path.join(sourceRoot, fileName), 'utf8');
  const execute = new AsyncFunction('$input', '$items', '$', code);
  return execute(
    { all: () => input },
    (name) => itemsByNode[name] || [],
    (name) => ({ all: () => itemsByNode[name] || [] }),
  );
}

async function main() {
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT e.status, d.data
         FROM n8n_runtime.execution_entity e
         JOIN n8n_runtime.execution_data d ON d."executionId" = e.id
        WHERE e."workflowId" = $1
        ORDER BY e.id DESC
        LIMIT 1`,
      [WORKFLOW_ID],
    );
    if (!result.rows.length) throw new Error('Nenhuma execucao persistida para replay.');
    const payload = parse(result.rows[0].data);
    const runData = payload.resultData?.runData || {};
    const buildPayload = outputItems(runData, 'Build Payload');
    const livia = outputItems(runData, 'Livia');
    const images = outputItems(runData, 'Normalize Gateway Upload');
    const videos = outputItems(runData, 'Video Ready?');
    if (!buildPayload.length || !livia.length || !images.length) {
      throw new Error('Execucao mais recente nao possui o fixture estatico necessario para replay.');
    }

    const named = {
      'Build Payload': buildPayload,
      'Livia': livia,
      'Normalize Gateway Upload': images,
      'Video Ready?': videos,
      'Restore Publish Groups': outputItems(runData, 'Restore Publish Groups'),
      'Build Meta API Params From Vault': outputItems(runData, 'Build Meta API Params From Vault'),
    };
    const plans = await executeCode('prepare-media-upload-plan.js', buildPayload, named);
    named['Prepare Media Upload Plan'] = plans;

    const noImagePlans = plans.filter((entry) => Number(entry.json?.media_upload_plan?.expected?.images || 0) === 0);
    const noVideoPlans = plans.filter((entry) => Number(entry.json?.media_upload_plan?.expected?.videos || 0) === 0);
    const noImages = noImagePlans.length ? await executeCode('emit-no-image-upload.js', noImagePlans, named) : [];
    const noVideos = noVideoPlans.length ? await executeCode('emit-no-video-upload.js', noVideoPlans, named) : [];
    const envelopes = await executeCode(
      'aggregate-media-upload-results.js',
      [...images, ...videos, ...noImages, ...noVideos],
      named,
    );
    const assemblies = await executeCode('assemble-job-inputs.js', [...livia, ...envelopes], named);
    const jobs = await executeCode('build-jobs.js', assemblies, named);
    const errors = jobs.filter((entry) => String(entry.json?.error || '').trim());

    console.log(JSON.stringify({
      mode: 'read_only_replay',
      source_execution_status: result.rows[0].status,
      source: {
        build_payload_items: buildPayload.length,
        livia_items: livia.length,
        image_upload_receipts: images.length,
        video_upload_receipts: videos.length,
      },
      planned_modes: plans.map((entry) => entry.json?.media_mode),
      envelopes: envelopes.map((entry) => ({
        media_mode: entry.json?.media_mode,
        expected: entry.json?.expected,
        completed: entry.json?.completed,
        skipped: entry.json?.skipped,
        ready: entry.json?.ready === true,
      })),
      assembly_count: assemblies.length,
      build_jobs_count: jobs.length,
      build_jobs_error_count: errors.length,
      destination_count: new Set(jobs.map((entry) => entry.json?.destination_group).filter(Boolean)).size,
      replacement_decisions: jobs.map((entry) => ({
        action: entry.json?.action,
        match_status: entry.json?.match_status,
        offer_replacement_reason: entry.json?.offer_replacement_guard?.reason || '',
        offer_tag_present: Boolean(entry.json?.offer_replacement_guard?.expected_tag),
      })),
      meta_mutations_performed: false,
    }, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
