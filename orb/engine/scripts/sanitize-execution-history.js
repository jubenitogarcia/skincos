#!/usr/bin/env node
'use strict';

const { parse, stringify } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');

const APPLY = process.argv.includes('--apply');
const TARGET_WORKFLOWS = [
  'WGXr4vYkv9UoJ8zc',
  '4edff84e07534309',
  'f7bd5f08ac17460f',
  'Fuj4MwplckFCL7Si',
];
const SECRET_KEY = /^(access_token|token|fbToken|igToken|thToken|authorization|secret|api_key|apikey)$/i;

function pgClient() {
  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  return new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
}

function redactUrl(value) {
  if (typeof value !== 'string' || !/access_token=/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.searchParams.has('access_token')) url.searchParams.set('access_token', '<redacted>');
    return url.toString();
  } catch {
    return value.replace(/([?&]access_token=)[^&#\s]+/gi, '$1<redacted>');
  }
}

function sanitize(root) {
  let redactions = 0;
  const paths = [];
  const visited = new WeakSet();
  function walk(value, path = 'root') {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        if (entry !== '<redacted>') {
          value[key] = '<redacted>';
          redactions += 1;
          paths.push(`${path}.${key}`);
        }
        continue;
      }
      if (typeof entry === 'string') {
        if (/^(Bearer|OAuth)\s+\S+/i.test(entry)) {
          value[key] = '<redacted>';
          redactions += 1;
          paths.push(`${path}.${key}`);
          continue;
        }
        const cleaned = redactUrl(entry);
        if (cleaned !== entry) {
          value[key] = cleaned;
          redactions += 1;
          paths.push(`${path}.${key}`);
        }
        continue;
      }
      walk(entry, `${path}.${key}`);
    }
  }
  walk(root);
  return { redactions, paths };
}

async function main() {
  const client = pgClient();
  await client.connect();
  try {
    const result = await client.query(
      `SELECT e.id, e."workflowId", d.data
         FROM n8n_runtime.execution_entity e
         JOIN n8n_runtime.execution_data d ON d."executionId" = e.id
        WHERE e."workflowId" = ANY($1::varchar[])
          AND e."createdAt" >= now() - interval '30 days'
        ORDER BY e.id`,
      [TARGET_WORKFLOWS],
    );
    const changes = [];
    for (const row of result.rows) {
      const parsed = parse(row.data);
      const sanitized = sanitize(parsed);
      if (!sanitized.redactions) continue;
      const data = stringify(parsed);
      parse(data);
      changes.push({ id: row.id, workflowId: row.workflowId, redactions: sanitized.redactions, paths: sanitized.paths, data });
    }

    if (APPLY && changes.length) {
      await client.query('BEGIN');
      try {
        for (const change of changes) {
          await client.query(
            `UPDATE n8n_runtime.execution_data SET data=$1 WHERE "executionId"=$2`,
            [change.data, change.id],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(JSON.stringify({
      ok: true,
      apply: APPLY,
      executionsScanned: result.rows.length,
      executionsChanged: changes.length,
      redactions: changes.reduce((sum, item) => sum + item.redactions, 0),
      executionIds: changes.map((item) => item.id),
      redactionPaths: changes.map((item) => ({ id: item.id, paths: item.paths })),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
