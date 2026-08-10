#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const MODE_KEY = 'LIVIA_REEL_COVER_MODE';
const MODES = new Set(['off', 'shadow', 'active']);
const LOCK_KEY = 'skincos:livia:reel-cover-rollout';

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || fallback;
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function required(name) {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertVersion(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('--workflow-version must be a workflow UUID');
  return value;
}

function assertRelease(value) {
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error('--release-id must be a full lowercase SHA');
  return value.toLowerCase();
}

function evidenceDigest(file) {
  if (!file) return '';
  if (!path.isAbsolute(file)) throw new Error('--evidence-file must be an absolute path');
  const content = fs.readFileSync(file);
  JSON.parse(content.toString('utf8'));
  return crypto.createHash('sha256').update(content).digest('hex');
}

function evidenceDigestArgument(file) {
  const supplied = argument('--evidence-sha256');
  if (supplied) {
    if (!/^[0-9a-f]{64}$/i.test(supplied)) throw new Error('--evidence-sha256 must be a SHA-256 digest');
    return supplied.toLowerCase();
  }
  return evidenceDigest(file);
}

async function readState(client, expectedVersion) {
  const workflow = await client.query(
    `SELECT id, active, "versionId" FROM n8n_runtime.workflow_entity WHERE id=$1 FOR UPDATE`,
    [WORKFLOW_ID],
  );
  const row = workflow.rows[0];
  if (!row || row.active !== true) throw new Error('Livia workflow is not active');
  if (row.versionId !== expectedVersion) throw new Error(`Livia workflow version drifted: expected ${expectedVersion}, found ${row.versionId}`);
  const variable = await client.query(
    `SELECT id, value FROM n8n_runtime.variables WHERE key=$1 AND "projectId" IS NULL FOR UPDATE`,
    [MODE_KEY],
  );
  const currentMode = String(variable.rows[0]?.value || 'off').trim().toLowerCase();
  if (!MODES.has(currentMode)) throw new Error(`Livia rollout variable has unsupported mode: ${currentMode}`);
  return { workflowVersion: row.versionId, variable: variable.rows[0] || null, currentMode };
}

async function main() {
  const expectedVersion = assertVersion(required('--workflow-version'));
  const releaseId = assertRelease(required('--release-id'));
  const requestedMode = argument('--mode').trim().toLowerCase();
  const inspect = process.argv.includes('--inspect');
  if (!inspect && !MODES.has(requestedMode)) throw new Error('--mode must be off, shadow, or active');
  const apply = process.argv.includes('--apply');
  if (inspect && apply) throw new Error('--inspect cannot be combined with --apply');
  const evidenceSha256 = evidenceDigestArgument(argument('--evidence-file'));
  const Client = loadPgClient();
  const client = new Client({ user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || '/var/run/postgresql', database: process.env.PGDATABASE || 'n8n_runtime' });
  await client.connect();
  try {
    if (apply) await client.query('BEGIN');
    if (apply) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);
    const state = await readState(client, expectedVersion);
    if (inspect) {
      process.stdout.write(`${JSON.stringify({ ok: true, inspect: true, workflowId: WORKFLOW_ID, workflowVersion: state.workflowVersion, releaseId, currentMode: state.currentMode, variablePresent: Boolean(state.variable), evidenceSha256 })}\n`);
      return;
    }
    const changed = state.currentMode !== requestedMode;
    if (apply && changed) {
      if (state.variable) {
        await client.query(
          `UPDATE n8n_runtime.variables SET value=$1, type='string' WHERE key=$2 AND "projectId" IS NULL`,
          [requestedMode, MODE_KEY],
        );
      } else {
        await client.query(
          `INSERT INTO n8n_runtime.variables (key,type,value,id,"projectId") VALUES ($1,'string',$2,$3,NULL)`,
          [MODE_KEY, requestedMode, crypto.randomUUID()],
        );
      }
    }
    if (apply) await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({ ok: true, apply, workflowId: WORKFLOW_ID, workflowVersion: state.workflowVersion, releaseId, previousMode: state.currentMode, requestedMode, changed, evidenceSha256, appliedAt: apply && changed ? new Date().toISOString() : null })}\n`);
  } catch (error) {
    if (apply) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = { MODE_KEY, MODES, WORKFLOW_ID, readState };
