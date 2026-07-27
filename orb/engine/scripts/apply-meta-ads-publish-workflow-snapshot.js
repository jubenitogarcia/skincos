#!/usr/bin/env node
'use strict';

// Controlled operator-only updater for the inactive Meta Ads workflow. It is
// deliberately not an n8n runtime feature: callers must provide an exported
// snapshot, an expected live version and --apply. The old workflow is exported
// before any write, and the new definition gets its own n8n history version.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const args = new Set(process.argv.slice(2));
const sourcePath = [...args].find((value) => value.endsWith('.json'));
const expectedVersion = [...args].find((value) => value.startsWith('--expected-version='))?.slice('--expected-version='.length);
const apply = args.has('--apply');
if (!sourcePath || !expectedVersion) throw new Error('Usage: node apply-meta-ads-publish-workflow-snapshot.js <workflow.json> --expected-version=<uuid> [--apply]');

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}
function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function sanitizeWorkflow(row) {
  return {
    ...row,
    nodes: parseJson(row.nodes, []), connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}), staticData: parseJson(row.staticData, null),
    pinData: parseJson(row.pinData, null), meta: parseJson(row.meta, {}),
  };
}

async function main() {
  const candidate = JSON.parse(fs.readFileSync(path.resolve(sourcePath), 'utf8'));
  if (candidate.id !== WORKFLOW_ID || candidate.active !== false) throw new Error('Candidate is not the expected inactive Meta Ads Publish workflow.');
  if (!Array.isArray(candidate.nodes) || !candidate.nodes.some((node) => node.name === 'Visual Grouping Agent')) throw new Error('Candidate workflow is structurally incomplete.');
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || '/var/run/postgresql',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    database: process.env.PGDATABASE || 'n8n_runtime', password: process.env.PGPASSWORD,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, name, active, nodes, connections, settings, "staticData", "pinData", meta, description,
              "versionId", "activeVersionId", "versionCounter", "updatedAt"
         FROM n8n_runtime.workflow_entity WHERE id = $1 FOR UPDATE`, [WORKFLOW_ID]);
    const row = result.rows[0];
    if (!row) throw new Error('Live Meta Ads Publish workflow not found.');
    if (row.active === true) throw new Error('Refusing to replace an active workflow.');
    if (row.versionId !== expectedVersion) throw new Error(`Live version changed: expected ${expectedVersion}, found ${row.versionId}.`);
    const live = sanitizeWorkflow(row);
    const nextVersion = crypto.randomUUID();
    const report = {
      workflow_id: WORKFLOW_ID, old_version: row.versionId, next_version: nextVersion,
      old_version_counter: Number(row.versionCounter), candidate_nodes: candidate.nodes.length,
      live_nodes: live.nodes.length, live_hash: stableHash({ nodes: live.nodes, connections: live.connections }),
      candidate_hash: stableHash({ nodes: candidate.nodes, connections: candidate.connections }), apply,
    };
    if (!apply) { await client.query('ROLLBACK'); console.log(JSON.stringify(report, null, 2)); return; }
    const now = new Date();
    await client.query(
      `UPDATE n8n_runtime.workflow_entity
          SET nodes=$1, connections=$2, settings=$3, meta=$4, "versionId"=$5, "versionCounter"=$6, "updatedAt"=$7
        WHERE id=$8`,
      [JSON.stringify(candidate.nodes), JSON.stringify(candidate.connections), JSON.stringify(candidate.settings || live.settings), JSON.stringify(candidate.meta || live.meta),
        nextVersion, Number(row.versionCounter) + 1, now, WORKFLOW_ID],
    );
    await client.query(
      `INSERT INTO n8n_runtime.workflow_history ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes, connections, name, autosaved, description)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,true,$8)`,
      [nextVersion, WORKFLOW_ID, 'Codex carousel contract', now, JSON.stringify(candidate.nodes), JSON.stringify(candidate.connections), candidate.name, candidate.description || ''],
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({ ...report, applied_at: now.toISOString() }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
