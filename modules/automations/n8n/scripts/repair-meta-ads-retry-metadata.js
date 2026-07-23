#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse, stringify } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');
const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const NODE_NAME = 'Validate Meta Creative Payload';
const executionId = Number(process.argv[2]);
const apply = process.argv.includes('--apply');

if (!Number.isInteger(executionId) || executionId < 1) {
  throw new Error('Usage: repair-meta-ads-retry-metadata.js <execution-id> [--apply]');
}

async function main() {
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT e.*, d.data
         FROM n8n_runtime.execution_entity e
         JOIN n8n_runtime.execution_data d ON d."executionId"=e.id
        WHERE e.id=$1 AND e."workflowId"=$2`,
      [executionId, WORKFLOW_ID],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Execution ${executionId} not found.`);
    if (row.status !== 'error' || row.deletedAt) throw new Error(`Execution ${executionId} is not a recoverable visible error.`);
    const root = parse(row.data);
    const resultData = root.resultData || {};
    const nodeRun = resultData.runData?.[NODE_NAME]?.find((run) => run?.error);
    if (!nodeRun?.error) throw new Error(`Execution ${executionId} has no node error for ${NODE_NAME}.`);
    const topLevelErrorPresent = Boolean(resultData.error);
    const finishedNeedsRepair = row.finished !== false;
    const summary = {
      executionId,
      apply,
      status: row.status,
      lastNodeExecuted: resultData.lastNodeExecuted || null,
      nodeErrorMessage: String(nodeRun.error.message || '').slice(0, 300),
      topLevelErrorPresent,
      finished: row.finished,
      finishedNeedsRepair,
    };
    if (!apply || (topLevelErrorPresent && !finishedNeedsRepair)) {
      console.log(JSON.stringify({
        ...summary,
        alreadyApplied: topLevelErrorPresent && !finishedNeedsRepair,
      }, null, 2));
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointDir = path.join('/mnt/c/CodexRuntime/n8n/exports/workflow-patches', `meta-ads-retry-metadata-${executionId}-${stamp}`);
    fs.mkdirSync(checkpointDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(checkpointDir, 'execution-data.before.flatted'), row.data, { mode: 0o600 });
    fs.writeFileSync(path.join(checkpointDir, 'execution-entity.before.json'), `${JSON.stringify({
      id: row.id,
      status: row.status,
      finished: row.finished,
      retryOf: row.retryOf,
      retrySuccessId: row.retrySuccessId,
      startedAt: row.startedAt,
      stoppedAt: row.stoppedAt,
      deletedAt: row.deletedAt,
    }, null, 2)}\n`, { mode: 0o600 });

    let repaired = row.data;
    if (!topLevelErrorPresent) {
      resultData.error = nodeRun.error;
      root.resultData = resultData;
      repaired = stringify(root);
      const verified = parse(repaired);
      if (!verified.resultData?.error || verified.resultData.error !== verified.resultData.runData?.[NODE_NAME]?.find((run) => run?.error)?.error) {
        throw new Error('Flatted round-trip did not preserve the shared error reference.');
      }
    }

    await client.query('BEGIN');
    try {
      const update = await client.query(
        `UPDATE n8n_runtime.execution_entity e
            SET finished=false
          FROM n8n_runtime.execution_data d
         WHERE e.id=$1 AND e."workflowId"=$2
           AND e.status='error' AND e."deletedAt" IS NULL
           AND d."executionId"=e.id AND d.data=$3
         RETURNING e.id`,
        [executionId, WORKFLOW_ID, row.data],
      );
      if (update.rowCount !== 1) throw new Error('Execution state changed before the repair lock was applied.');
      if (!topLevelErrorPresent) {
        const dataUpdate = await client.query(
          `UPDATE n8n_runtime.execution_data SET data=$1
            WHERE "executionId"=$2 AND data=$3`,
          [repaired, executionId, row.data],
        );
        if (dataUpdate.rowCount !== 1) throw new Error('Execution data changed before the repair lock was applied.');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    fs.writeFileSync(path.join(checkpointDir, 'execution-data.after.flatted'), repaired, { mode: 0o600 });
    console.log(JSON.stringify({
      ...summary,
      checkpointDir,
      topLevelErrorPresentAfter: true,
      finishedAfter: false,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
