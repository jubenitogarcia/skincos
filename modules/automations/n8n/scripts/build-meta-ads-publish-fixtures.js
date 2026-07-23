#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');

const executionIds = [21, 22, 23, 24, 25];
const fixtureRoot = path.resolve(__dirname, '..', 'tests', 'fixtures', 'meta-ads-publish');

function query(sql) {
  return execFileSync('sudo', ['-n', '-u', 'postgres', 'psql', '-d', 'n8n_runtime', '-Atq', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function hashId(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return `id_${crypto.createHash('sha256').update(text).digest('hex').slice(0, 10)}`;
}

function nodeItems(runData, name) {
  return (runData[name] || []).flatMap((run) => (
    Array.isArray(run?.data?.main)
      ? run.data.main.flatMap((output) => Array.isArray(output) ? output : [])
      : []
  ));
}

function errorSummary(item) {
  const json = item?.json || {};
  const error = json.error || item?.error || null;
  if (!error) return null;
  return {
    message: String(error.message || error.error_user_msg || error || '').slice(0, 300),
    code: Number(error.code || 0),
    error_subcode: Number(error.error_subcode || 0),
    fbtrace_id_present: Boolean(error.fbtrace_id),
  };
}

function creativeCounts(job) {
  const feed = job?.creativePayload?.asset_feed_spec || {};
  return {
    images: Array.isArray(feed.images) ? feed.images.length : 0,
    bodies: Array.isArray(feed.bodies) ? feed.bodies.length : 0,
    titles: Array.isArray(feed.titles) ? feed.titles.length : 0,
    descriptions: Array.isArray(feed.descriptions) ? feed.descriptions.length : 0,
  };
}

function buildFixture(executionId) {
  const entity = JSON.parse(query(
    `select json_build_object('id',id,'status',status,'startedAt',"startedAt",'stoppedAt',"stoppedAt")::text from n8n_runtime.execution_entity where id=${executionId} and "workflowId"='eFJhFg79lyaycjlm';`,
  ));
  const encoded = query(`select data from n8n_runtime.execution_data where "executionId"=${executionId};`);
  const parsed = parse(encoded);
  const resultData = parsed?.resultData || {};
  const runData = resultData.runData || {};
  const buildPayload = nodeItems(runData, 'Build Payload');
  const buildJobs = nodeItems(runData, 'Build Jobs');
  const creatives = nodeItems(runData, 'Create AdCreative');
  const creates = nodeItems(runData, 'Create Ad');
  const updates = nodeItems(runData, 'Update Ad');

  return {
    execution: entity,
    last_node_executed: String(resultData.lastNodeExecuted || ''),
    terminal_error: resultData.error ? {
      node: String(resultData.error.node?.name || resultData.lastNodeExecuted || ''),
      message: String(resultData.error.message || '').slice(0, 500),
    } : null,
    build_payload: buildPayload.map((item) => {
      const json = item.json || {};
      return {
        job_key: hashId(json.job_key),
        creative_group_key: String(json.creative_group_key || json.group_key || ''),
        action: String(json.action || ''),
        image_ratios: (json.imagens || []).map((image) => String(image.proporcao || '')),
        destination_groups: (json.destinations || []).map((destination) => String(destination.destination_group || '')),
        matched_count: Array.isArray(json.matched_ads) ? json.matched_ads.length : 0,
        selected_count: Array.isArray(json.selected_ads) ? json.selected_ads.length : 0,
      };
    }),
    build_jobs: buildJobs.map((item) => {
      const json = item.json || {};
      return {
        job_key: hashId(json.job_key),
        creative_group_key: String(json.creative_group_key || json.group_key || ''),
        destination_group: String(json.destination_group || ''),
        action: String(json.action || ''),
        selected_ad_id: hashId(json.source_ad_id || json.selected_ad_id),
        creative_counts: creativeCounts(json),
        temporal_reason: String(json.destination_match_debug?.temporal_guard?.reason || ''),
      };
    }),
    create_creative: {
      total: creatives.length,
      success: creatives.filter((item) => Boolean(item?.json?.id) && !errorSummary(item)).length,
      errors: creatives.map(errorSummary).filter(Boolean),
    },
    create_ad_count: creates.length,
    update_ad_count: updates.length,
  };
}

fs.mkdirSync(fixtureRoot, { recursive: true });
for (const executionId of executionIds) {
  const fixture = buildFixture(executionId);
  fs.writeFileSync(path.join(fixtureRoot, `execution-${executionId}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
}
console.log(`Wrote ${executionIds.length} sanitized execution fixtures.`);

