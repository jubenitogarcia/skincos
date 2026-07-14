#!/usr/bin/env node
'use strict';

const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');

const APPLY = process.argv.includes('--apply');
const EXECUTION_ID = 68;
const EXPECTED_WORKFLOW = 'eFJhFg79lyaycjlm';
const STOPPED_AT = '2026-07-13T15:44:50.042Z';
const RESTORE_SOURCE_DATABASE = process.env.N8N_EXECUTION_RESTORE_SOURCE_DB
  || 'n8n_execution68_restore_20260713';

function clientFactory(database = 'n8n_runtime') {
  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  return new Client({ user: 'postgres', host: '/var/run/postgresql', database });
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function loadExecution(client) {
  const entity = await client.query(
    'SELECT * FROM n8n_runtime.execution_entity WHERE id=$1',
    [EXECUTION_ID],
  );
  if (!entity.rows[0]) return null;
  const data = await client.query(
    'SELECT * FROM n8n_runtime.execution_data WHERE "executionId"=$1',
    [EXECUTION_ID],
  );
  if (!data.rows[0]) throw new Error('Execution 68 exists without execution_data.');
  return { entity: entity.rows[0], data: data.rows[0] };
}

function validateEvidence(execution) {
  if (execution.entity.workflowId !== EXPECTED_WORKFLOW) {
    throw new Error('Execution 68 belongs to an unexpected workflow.');
  }
  const parsed = parse(execution.data.data);
  const resultData = parsed?.resultData || {};
  const runs = resultData.runData?.['Validate Meta Creative Payload'] || [];
  const terminal = runs.find((run) => run?.error);
  if (!terminal || !String(terminal.error?.message || '').includes('run_id_missing')) {
    throw new Error('Execution 68 does not contain the expected run_id_missing terminal evidence.');
  }
}

async function insertRow(client, table, row) {
  const columns = Object.keys(row);
  const sql = `INSERT INTO ${table} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`;
  await client.query(sql, Object.values(row));
}

async function main() {
  const client = clientFactory();
  await client.connect();
  try {
    let execution = await loadExecution(client);
    let restoredFromBackup = false;
    if (!execution) {
      const source = clientFactory(RESTORE_SOURCE_DATABASE);
      await source.connect();
      try {
        execution = await loadExecution(source);
      } finally {
        await source.end();
      }
      if (!execution) throw new Error('Execution 68 not found in live or checkpoint database.');
      restoredFromBackup = true;
    }
    validateEvidence(execution);
    const row = execution.entity;
    if (row.status !== 'running' || !row.deletedAt || row.finished === true) {
      throw new Error('Execution 68 no longer matches the orphaned execution precondition.');
    }

    if (APPLY) {
      await client.query('BEGIN');
      try {
        if (restoredFromBackup) {
          const recovered = {
            ...execution.entity,
            status: 'error',
            finished: true,
            stoppedAt: STOPPED_AT,
            deletedAt: null,
          };
          await insertRow(client, 'n8n_runtime.execution_entity', recovered);
          await insertRow(client, 'n8n_runtime.execution_data', execution.data);
        } else {
          await client.query(
            `UPDATE n8n_runtime.execution_entity
                SET status='error', finished=true, "stoppedAt"=$1, "deletedAt"=null
              WHERE id=$2 AND status='running' AND "deletedAt" IS NOT NULL`,
            [STOPPED_AT, EXECUTION_ID],
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
      executionId: EXECUTION_ID,
      previousStatus: row.status,
      recoveredStatus: APPLY ? 'error' : null,
      restoredFromBackup,
      terminalNode: 'Validate Meta Creative Payload',
      terminalError: 'run_id_missing',
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
