#!/usr/bin/env node
'use strict';

const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');
const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const requestedId = process.argv[2] ? Number(process.argv[2]) : null;
const secretKey = /^(access_token|token|authorization|secret|api_key|apikey)$/i;
const usefulKeys = new Set([
  'run_id', 'runId', 'batch_fingerprint', 'batchFingerprint', 'job_key', 'operation_key',
  'creative_group_key', 'destination_group', 'action', 'stage', 'status', 'error',
  'error_code', 'upstream_error', 'expected_jobs', 'expectedJobs', 'completed_jobs',
  'completedJobs', 'source_ad_id', 'selected_ad_id', 'target_ad_id', 'creative_id',
  'request_id', 'requestId', 'fallback_available', 'blocked_before_update',
]);

function sanitize(value, depth = 0, visited = new WeakSet()) {
  if (depth > 5) return '<max-depth>';
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /^(Bearer|OAuth)\s+\S+/i.test(value)) return '<redacted>';
    return value;
  }
  if (visited.has(value)) return '<circular>';
  visited.add(value);
  if (Array.isArray(value)) return value.slice(0, 10).map((entry) => sanitize(entry, depth + 1, visited));
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (secretKey.test(key)) output[key] = '<redacted>';
    else output[key] = sanitize(entry, depth + 1, visited);
  }
  return output;
}

function selectedContext(value, output = {}, depth = 0, visited = new WeakSet()) {
  if (!value || typeof value !== 'object' || depth > 8 || visited.has(value)) return output;
  visited.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (usefulKeys.has(key) && !secretKey.test(key)) output[key] = sanitize(entry);
    if (entry && typeof entry === 'object') selectedContext(entry, output, depth + 1, visited);
  }
  return output;
}

function creativeLinkContext(items) {
  const summaries = [];
  for (const item of items) {
    const feed = item?.json?.creativePayload?.asset_feed_spec;
    if (!feed || typeof feed !== 'object') continue;
    const raw = String(feed.link_urls?.[0]?.website_url || '').trim();
    let hostname = '';
    try { hostname = new URL(raw).hostname.toLowerCase(); } catch { hostname = raw ? '<invalid>' : '<missing>'; }
    summaries.push({
      cta_type: String(feed.call_to_action_types?.[0] || ''),
      primary_link_present: Boolean(raw),
      primary_link_hostname: hostname,
    });
  }
  return summaries.length ? { creative_links: summaries.slice(0, 10) } : {};
}

async function main() {
  if (requestedId !== null && (!Number.isInteger(requestedId) || requestedId < 1)) {
    throw new Error('Usage: inspect-meta-ads-publish-execution.js [execution-id]');
  }
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const entity = await client.query(
      requestedId
        ? 'SELECT * FROM n8n_runtime.execution_entity WHERE id=$1 AND "workflowId"=$2'
        : 'SELECT * FROM n8n_runtime.execution_entity WHERE "workflowId"=$1 ORDER BY id DESC LIMIT 1',
      requestedId ? [requestedId, WORKFLOW_ID] : [WORKFLOW_ID],
    );
    if (!entity.rows[0]) throw new Error('Meta Ads - Publish execution not found.');
    const execution = entity.rows[0];
    const data = await client.query(
      'SELECT data, "workflowData" FROM n8n_runtime.execution_data WHERE "executionId"=$1',
      [execution.id],
    );
    if (!data.rows[0]) throw new Error(`Execution ${execution.id} has no execution_data.`);
    const root = parse(data.rows[0].data);
    const result = root.resultData || {};
    const runData = result.runData || {};
    const nodes = {};
    for (const [name, runs] of Object.entries(runData)) {
      nodes[name] = (runs || []).map((run) => {
        const items = run?.data?.main?.flat(2)?.filter(Boolean) || [];
        return {
          executionStatus: run.executionStatus || null,
          startTime: run.startTime || null,
          executionTime: run.executionTime || null,
          itemCount: items.length,
          context: {
            ...selectedContext(items.map((item) => item.json)),
            ...creativeLinkContext(items),
          },
          error: run.error ? sanitize({
            name: run.error.name,
            message: run.error.message,
            description: run.error.description,
            node: run.error.node?.name,
          }) : null,
        };
      });
    }
    console.log(JSON.stringify({
      execution: {
        id: execution.id,
        status: execution.status,
        mode: execution.mode,
        finished: execution.finished,
        startedAt: execution.startedAt,
        stoppedAt: execution.stoppedAt,
        retryOf: execution.retryOf,
      },
      lastNodeExecuted: result.lastNodeExecuted || null,
      topLevelError: result.error ? sanitize({
        name: result.error.name,
        message: result.error.message,
        description: result.error.description,
        node: result.error.node?.name,
      }) : null,
      nodes,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
