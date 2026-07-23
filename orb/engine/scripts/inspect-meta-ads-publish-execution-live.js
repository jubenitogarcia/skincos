#!/usr/bin/env node
'use strict';

const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');

const executionId = Number(process.argv[2]);
if (!Number.isInteger(executionId) || executionId < 1) {
  throw new Error('Usage: inspect-meta-ads-publish-execution-live.js <execution-id>');
}

function redact(value, depth = 0) {
  if (depth > 7) return '[truncated-depth]';
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 1200)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /token|authorization|secret|api[_-]?key|cookie/i.test(key) ? '[redacted]' : redact(item, depth + 1),
  ]));
}

async function main() {
  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT e.id, e.status, e.mode, e."startedAt", e."stoppedAt", d.data
       FROM n8n_runtime.execution_entity e
       LEFT JOIN n8n_runtime.execution_data d ON d."executionId" = e.id
       WHERE e.id = $1`,
      [executionId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Execution ${executionId} not found.`);
    const root = row.data ? parse(row.data) : {};
    const runData = root?.resultData?.runData || {};
    const nodeRuns = Object.entries(runData).map(([node, runs]) => {
      const lastRun = Array.isArray(runs) ? runs.at(-1) : null;
      const error = lastRun?.error;
      return {
        node,
        runs: Array.isArray(runs) ? runs.length : 0,
        lastError: error
          ? String(error.message || error.description || 'node error').slice(0, 500)
          : null,
        lastErrorSafe: error ? {
          name: error.name || null,
          message: error.message || null,
          description: error.description || null,
          httpCode: error.httpCode || null,
          cause: typeof error.cause === 'string' ? error.cause.slice(0, 1500) : null,
        } : null,
        itemCount: (lastRun?.data?.main || []).flat().length,
      };
    });
    const selectedNodeOutput = process.argv.includes('--detail')
      ? Object.fromEntries(
        ['Validate Visual Grouping', 'Build Payload', 'Prepare Creative Operation'].flatMap((node) => {
          const lastRun = runData[node]?.at(-1);
          const output = (lastRun?.data?.main || []).flat().map((item) => redact(item?.json));
          return output.length ? [[node, output]] : [];
        }),
      )
      : undefined;
    const createShape = (runData['Create AdCreative']?.at(-1)?.data?.main || []).flat().map((item) => ({
      jsonKeys: Object.keys(item?.json || {}),
      operationKeys: Object.keys(item?.json?.operation || {}),
      resultKeys: Object.keys(item?.json?.operation?.result || {}),
      pairedItem: item?.pairedItem || null,
      binaryKeys: Object.keys(item?.binary || {}),
      jsonBytes: Buffer.byteLength(JSON.stringify(item?.json || {})),
    }));
    const terminalShapes = Object.fromEntries(
      ['Verify Drive Finalization', 'Complete Publish Run', 'Inform Meta Publish Success (WhatsApp)', 'Inform Meta Publish Success (Telegram)']
        .map((node) => [node, (runData[node]?.at(-1)?.data?.main || []).flat().map((item) => ({
          jsonKeys: Object.keys(item?.json || {}),
          json: redact(item?.json),
          hasItemError: Boolean(item?.error),
        }))]),
    );
    console.log(JSON.stringify({
      id: row.id,
      status: row.status,
      mode: row.mode,
      startedAt: row.startedAt,
      stoppedAt: row.stoppedAt,
      lastNodeExecuted: root?.resultData?.lastNodeExecuted || null,
      executionStack: (root?.executionData?.nodeExecutionStack || []).map((entry) => ({
        node: entry?.node?.name || null,
        runIndex: entry?.runIndex ?? null,
        startTime: entry?.startTime ?? null,
        source: entry?.source || null,
      })),
      waitingExecutionNodes: Object.keys(root?.executionData?.waitingExecution || {}),
      waitingExecutionSourceNodes: Object.keys(root?.executionData?.waitingExecutionSource || {}),
      createShape,
      terminalShapes,
      nodeRuns,
      ...(selectedNodeOutput ? { selectedNodeOutput } : {}),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
