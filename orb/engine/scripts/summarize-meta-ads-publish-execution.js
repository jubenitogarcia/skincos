#!/usr/bin/env node
'use strict';

const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');
const executionId = Number(process.argv[2]);
if (!Number.isInteger(executionId) || executionId < 1) throw new Error('Usage: summarize-meta-ads-publish-execution.js <execution-id>');

const text = (value) => String(value ?? '').trim();
const list = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function compactCreative(item) {
  const request = object(object(item).gateway_request);
  const payload = object(request.payload);
  const feed = object(payload.asset_feed_spec);
  const story = object(payload.object_story_spec);
  const sourcing = object(payload.creative_sourcing_spec);
  const features = object(object(payload.degrees_of_freedom_spec).creative_features_spec);
  return {
    destination_group: text(item.destination_group),
    creative_group_key: text(item.creative_group_key),
    operation_key: text(request.operation_key),
    account_id: text(request.account_id),
    page_id: text(story.page_id),
    instagram_user_id: text(story.instagram_user_id),
    website_url: text(list(feed.link_urls)[0]?.website_url),
    creative_sourcing_url: text(sourcing.source_url),
    creative_name: text(payload.name),
    call_to_action_types: list(feed.call_to_action_types),
    link_urls: list(feed.link_urls),
    bodies: list(feed.bodies).map((entry) => text(entry && entry.text)),
    titles: list(feed.titles).map((entry) => text(entry && entry.text)),
    descriptions: list(feed.descriptions).map((entry) => text(entry && entry.text)),
    placement_rules: list(feed.asset_customization_rules).map((entry) => ({
      placement: object(entry.customization_spec),
      image_label: text(entry.image_label),
      body_label: text(entry.body_label),
      title_label: text(entry.title_label),
      priority: entry.priority ?? null,
    })),
    ad_formats: list(feed.ad_formats),
    optimization_type: text(feed.optimization_type),
    image_count: list(feed.images).length,
    images: list(feed.images).map((image) => ({
      hash: text(image.hash),
      labels: list(image.adlabels).map((label) => text(label.name)),
      crop_keys: Object.keys(object(image.image_crops)),
    })),
    body_count: list(feed.bodies).length,
    title_count: list(feed.titles).length,
    description_count: list(feed.descriptions).length,
    rule_count: list(feed.asset_customization_rules).length,
    feature_keys: Object.keys(features),
  };
}

async function main() {
  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT e.id, e.status, e."startedAt", e."stoppedAt", d.data
       FROM n8n_runtime.execution_entity e
       JOIN n8n_runtime.execution_data d ON d."executionId" = e.id
       WHERE e.id = $1`,
      [executionId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Execution ${executionId} not found.`);
    const root = parse(row.data);
    const runData = object(object(root).resultData).runData;
    const visual = list(runData['Validate Visual Grouping']?.at(-1)?.data?.main).flat().map((entry) => object(entry).json).map((item) => ({
      name: text(item.name),
      id: text(item.id),
      ratio: text(object(item.visual_grouping).ratio),
      slot: text(object(item.visual_grouping).slot),
      group_key: text(object(item.visual_grouping).group_key),
      confidence: object(item.visual_grouping).confidence ?? null,
    }));
    const creatives = list(runData['Prepare Creative Operation']?.at(-1)?.data?.main).flat().map((entry) => compactCreative(object(entry).json));
    const error = runData['Create AdCreative']?.at(-1)?.error || null;
    console.log(JSON.stringify({
      execution_id: row.id,
      status: row.status,
      started_at: row.startedAt,
      stopped_at: row.stoppedAt,
      visual_groups: visual,
      prepared_creatives: creatives,
      create_creative_error: error ? {
        message: text(error.message), description: text(error.description), http_code: text(error.httpCode),
      } : null,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
