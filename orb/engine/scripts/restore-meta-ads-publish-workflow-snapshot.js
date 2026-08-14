#!/usr/bin/env node
'use strict';

// Operator-only rollback for the inactive Meta Ads Publish workflow.  The
// checkpoint must be the full export created immediately before the matching
// version-checked apply.  Its graph is additionally matched against n8n's
// immutable workflow_history record before any write occurs.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const CHECKPOINT_ROOT = '/var/lib/skincos-runtime/orb/exports/workflow-patches';
const VERSION_PATTERN = /^[0-9a-fA-F-]{36}$/;
const CHECKPOINT_DIRECTORY_PATTERN = /^meta-ads-build-payload-[0-9TZ-]{20,64}$/;

function parseArguments(argv) {
  const args = new Set(argv);
  const expectedVersion = [...args].find((value) => value.startsWith('--expected-version='))?.slice('--expected-version='.length);
  const rollbackVersion = [...args].find((value) => value.startsWith('--rollback-version='))?.slice('--rollback-version='.length);
  const rollbackSnapshot = [...args].find((value) => value.startsWith('--rollback-snapshot='))?.slice('--rollback-snapshot='.length);
  return {
    apply: args.has('--apply'),
    expectedVersion,
    rollbackVersion,
    rollbackSnapshot,
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertCanonicalAbsolutePath(value, label) {
  const candidate = String(value || '');
  if (!path.isAbsolute(candidate) || path.normalize(candidate) !== candidate) {
    throw new Error(`${label} must be a canonical absolute path.`);
  }
  return candidate;
}

function assertCheckpointPath(snapshotPath, checkpointRoot = CHECKPOINT_ROOT) {
  const root = assertCanonicalAbsolutePath(checkpointRoot, 'controlled Meta Ads checkpoint root');
  const requested = assertCanonicalAbsolutePath(snapshotPath, 'rollback snapshot');
  const resolvedRoot = fs.realpathSync(root);
  if (resolvedRoot !== root) {
    throw new Error('controlled Meta Ads checkpoint root may not traverse symlinks.');
  }
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!requested.startsWith(rootPrefix)) {
    throw new Error('rollback snapshot is outside the controlled Meta Ads checkpoint directory.');
  }
  const relative = requested.slice(rootPrefix.length);
  const parts = relative.split(path.sep);
  if (
    !relative ||
    parts.length !== 2 || !CHECKPOINT_DIRECTORY_PATTERN.test(parts[0]) || parts[1] !== 'workflow.live.json'
  ) {
    throw new Error('rollback snapshot is outside the controlled Meta Ads checkpoint directory.');
  }
  const checkpointDirectory = `${rootPrefix}${parts[0]}`;
  if (requested !== `${checkpointDirectory}${path.sep}workflow.live.json`) {
    throw new Error('rollback snapshot is outside the controlled Meta Ads checkpoint directory.');
  }
  const rootStat = fs.lstatSync(root);
  const directoryStat = fs.lstatSync(checkpointDirectory);
  const snapshotStat = fs.lstatSync(requested);
  if (!rootStat.isDirectory() || !directoryStat.isDirectory() || !snapshotStat.isFile()) {
    throw new Error('rollback snapshot must be a regular file in a regular checkpoint directory.');
  }
  if (fs.realpathSync(checkpointDirectory) !== checkpointDirectory || fs.realpathSync(requested) !== requested) {
    throw new Error('rollback snapshot path may not traverse symlinks.');
  }
  return requested;
}

function assertSnapshot(snapshot, { rollbackVersion, history, live }) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('rollback snapshot is invalid.');
  }
  if (snapshot.id !== WORKFLOW_ID || snapshot.active !== false) {
    throw new Error('rollback snapshot is not the expected inactive Meta Ads Publish workflow.');
  }
  if (snapshot.versionId !== rollbackVersion) {
    throw new Error('rollback snapshot version does not match --rollback-version.');
  }
  if (!Array.isArray(snapshot.nodes) || !snapshot.connections || typeof snapshot.connections !== 'object' || Array.isArray(snapshot.connections)) {
    throw new Error('rollback snapshot graph is invalid.');
  }
  const snapshotGraph = { nodes: snapshot.nodes, connections: snapshot.connections };
  const historyGraph = {
    nodes: parseJson(history.nodes, []),
    connections: parseJson(history.connections, {}),
  };
  if (stableHash(snapshotGraph) !== stableHash(historyGraph)) {
    throw new Error('rollback snapshot graph does not match the recorded workflow history version.');
  }
  requirePlainObject(snapshot.settings, 'rollback snapshot settings');
  requirePlainObject(snapshot.meta, 'rollback snapshot meta');
  if (snapshot.name !== live.name || (snapshot.description || '') !== (live.description || '')) {
    throw new Error('rollback snapshot identity does not match the live workflow.');
  }
  return {
    nodes: snapshot.nodes,
    connections: snapshot.connections,
    settings: snapshot.settings,
    meta: snapshot.meta,
  };
}

function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}

async function main() {
  const { apply, expectedVersion, rollbackVersion, rollbackSnapshot } = parseArguments(process.argv.slice(2));
  if (!apply || !expectedVersion || !rollbackVersion || !rollbackSnapshot) {
    throw new Error('Usage: node restore-meta-ads-publish-workflow-snapshot.js --expected-version=<post-apply-uuid> --rollback-version=<checkpoint-uuid> --rollback-snapshot=<absolute workflow.live.json> --apply');
  }
  if (!VERSION_PATTERN.test(expectedVersion) || !VERSION_PATTERN.test(rollbackVersion) || expectedVersion === rollbackVersion) {
    throw new Error('expected-version and rollback-version must be distinct UUIDs.');
  }
  const snapshotPath = assertCheckpointPath(rollbackSnapshot);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    database: process.env.PGDATABASE || 'n8n_runtime',
    password: process.env.PGPASSWORD,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT id, name, active, nodes, connections, settings, meta, description,
              "versionId", "activeVersionId", "versionCounter", "updatedAt"
         FROM n8n_runtime.workflow_entity WHERE id = $1 FOR UPDATE`,
      [WORKFLOW_ID],
    );
    const live = current.rows[0];
    if (!live) throw new Error('Live Meta Ads Publish workflow not found.');
    if (live.active === true) throw new Error('Refusing to restore an active workflow.');
    if (live.versionId !== expectedVersion) {
      throw new Error(`Live version changed: expected ${expectedVersion}, found ${live.versionId}.`);
    }
    const historical = await client.query(
      `SELECT "versionId", nodes, connections
         FROM n8n_runtime.workflow_history
        WHERE "workflowId" = $1 AND "versionId" = $2
        FOR SHARE`,
      [WORKFLOW_ID, rollbackVersion],
    );
    if (historical.rows.length !== 1) {
      throw new Error('Requested rollback version is not an exact workflow_history record.');
    }
    const restored = assertSnapshot(snapshot, { rollbackVersion, history: historical.rows[0], live });
    const nextVersion = crypto.randomUUID();
    const now = new Date();
    await client.query(
      `UPDATE n8n_runtime.workflow_entity
          SET nodes=$1, connections=$2, settings=$3, meta=$4, "versionId"=$5, "versionCounter"=$6, "updatedAt"=$7
        WHERE id=$8`,
      [
        JSON.stringify(restored.nodes),
        JSON.stringify(restored.connections),
        JSON.stringify(restored.settings),
        JSON.stringify(restored.meta),
        nextVersion,
        Number(live.versionCounter) + 1,
        now,
        WORKFLOW_ID,
      ],
    );
    await client.query(
      `INSERT INTO n8n_runtime.workflow_history ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes, connections, name, autosaved, description)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,true,$8)`,
      [
        nextVersion,
        WORKFLOW_ID,
        'Codex Meta Ads Publish tracking rollback',
        now,
        JSON.stringify(restored.nodes),
        JSON.stringify(restored.connections),
        live.name,
        live.description || '',
      ],
    );
    const readback = await client.query(
      `SELECT active, nodes, connections, settings, meta, "versionId", "versionCounter"
         FROM n8n_runtime.workflow_entity WHERE id = $1 FOR UPDATE`,
      [WORKFLOW_ID],
    );
    const result = readback.rows[0];
    if (!result || result.active === true || result.versionId !== nextVersion ||
      stableHash({ nodes: parseJson(result.nodes, []), connections: parseJson(result.connections, {}) }) !== stableHash({ nodes: restored.nodes, connections: restored.connections }) ||
      stableHash(parseJson(result.settings, {})) !== stableHash(restored.settings) ||
      stableHash(parseJson(result.meta, {})) !== stableHash(restored.meta)) {
      throw new Error('Meta Ads workflow rollback readback did not match the checkpoint.');
    }
    // Validate the owned row before committing. A failed readback can then roll
    // back atomically instead of reporting an error after a successful write.
    await client.query('COMMIT');
    console.log(JSON.stringify({
      workflow_id: WORKFLOW_ID,
      restored_from_version: rollbackVersion,
      expected_post_apply_version: expectedVersion,
      restored_version: nextVersion,
      version_counter: Number(result.versionCounter),
      checkpoint: snapshotPath,
      graph_readback: 'matched',
      settings_readback: 'matched',
      meta_readback: 'matched',
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}

module.exports = {
  CHECKPOINT_DIRECTORY_PATTERN,
  CHECKPOINT_ROOT,
  WORKFLOW_ID,
  assertCheckpointPath,
  assertSnapshot,
  canonical,
  parseArguments,
  stableHash,
};
