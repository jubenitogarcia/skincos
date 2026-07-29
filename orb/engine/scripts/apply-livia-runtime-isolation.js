#!/usr/bin/env node
'use strict';

// Operator-only, version-checked publication of the Livia runtime pin.  The
// manifest is written before the DB transaction and removed again on failure,
// so no active version can reference a missing helper bundle.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const REQUIRED_NODES = ['Process Media Asset', 'BQ - Build Platform Job Graph', 'Verify Published Artifacts', 'Record Publish Progress', 'Validate Publish Token Health'];
const MUTABLE_RUNTIME_RE = /\/opt\/skincos\/current\/source|\b(?:ORB_ROOT|N8N_ROOT)\b|\/mnt\/c\/|livia-verify-provider-copy-drift-wrapper|--verifier\b/;
const args = process.argv.slice(2);
const sourcePath = args.find((value) => value.endsWith('.json'));
const expectedVersion = args.find((value) => value.startsWith('--expected-version='))?.slice('--expected-version='.length);
const nextVersion = args.find((value) => value.startsWith('--next-version='))?.slice('--next-version='.length) || crypto.randomUUID();
const releaseRoot = args.find((value) => value.startsWith('--release-root='))?.slice('--release-root='.length);
const apply = args.includes('--apply');
const manifestPrecreated = args.includes('--manifest-precreated');
const runtimeHome = process.env.N8N_RUNTIME_HOME || '/var/lib/skincos-runtime/orb';
const manifestScript = path.join(__dirname, 'workflow-runtime-manifest.js');

function fail(message) { throw new Error(message); }
function loadPgClient() {
  try { return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { return require('pg').Client; }
}
function parseJson(value, fallback) { return value === null || value === undefined || value === '' ? fallback : (typeof value === 'string' ? JSON.parse(value) : value); }
function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function assertPrecreatedManifest(manifestPath, candidate) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  if (manifest.workflowId !== WORKFLOW_ID || manifest.workflowVersion !== nextVersion || manifest.releaseRoot !== releaseRoot) {
    fail('Precreated workflow runtime manifest does not match the requested workflow version or release root.');
  }
  if (manifest.workflowSha256 !== stableHash({ nodes: candidate.nodes, connections: candidate.connections })) {
    fail('Precreated workflow runtime manifest does not match the candidate workflow hash.');
  }
  if (!Array.isArray(manifest.entrypoints) || manifest.entrypoints.length !== 6 || manifest.entrypoints.some((entry) => !/^[a-f0-9]{64}$/.test(String(entry?.sha256 || '')))) {
    fail('Precreated workflow runtime manifest has an invalid entrypoint hash contract.');
  }
}
function assertCandidate(candidate) {
  if (candidate?.id !== WORKFLOW_ID || candidate?.active !== true) fail('Candidate is not the active Livia workflow.');
  const nodes = new Map((candidate.nodes || []).map((node) => [node.name, node]));
  for (const name of REQUIRED_NODES) {
    const node = nodes.get(name);
    const command = String(node?.parameters?.command || '');
    if (node?.type !== 'n8n-nodes-base.executeCommand') fail(`${name} is not an Execute Command node.`);
    if (!command.includes(releaseRoot) || MUTABLE_RUNTIME_RE.test(command)) {
      fail(`${name} is not pinned exclusively to ${releaseRoot}.`);
    }
    if (name === 'Verify Published Artifacts' && !command.includes(`${releaseRoot}/scripts/livia/verify-published-artifacts.js`)) {
      fail('Verify Published Artifacts must invoke the pinned verifier entrypoint directly.');
    }
  }
}
function createManifest() {
  const manifestPath = path.join(runtimeHome, 'workflow-runtime-manifests', WORKFLOW_ID, `${nextVersion}.json`);
  if (manifestPrecreated) {
    if (!fs.existsSync(manifestPath)) fail(`Precreated workflow runtime manifest is missing: ${manifestPath}.`);
    assertPrecreatedManifest(manifestPath, JSON.parse(fs.readFileSync(path.resolve(sourcePath), 'utf8')));
    return { manifestPath };
  }
  const result = spawnSync(process.execPath, [manifestScript, 'create', '--workflow', sourcePath, '--workflow-id', WORKFLOW_ID, '--workflow-version', nextVersion, '--release-root', releaseRoot, '--runtime-home', runtimeHome], { encoding: 'utf8' });
  if (result.status !== 0) fail(result.stderr || result.stdout || 'Could not create workflow runtime manifest.');
  return JSON.parse(result.stdout);
}

async function main() {
  if (!sourcePath || !expectedVersion || !releaseRoot) {
    fail('Usage: apply-livia-runtime-isolation.js <candidate.json> --expected-version=<uuid> --release-root=/opt/skincos/releases/<sha>/source/orb/engine [--next-version=<uuid>] [--manifest-precreated] [--apply]');
  }
  const candidate = JSON.parse(fs.readFileSync(path.resolve(sourcePath), 'utf8'));
  assertCandidate(candidate);
  const Client = loadPgClient();
  const client = new Client({ user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || '/var/run/postgresql', database: process.env.PGDATABASE || 'n8n_runtime' });
  await client.connect();
  let manifestPath = '';
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id,name,active,nodes,connections,settings,meta,description,"versionId","activeVersionId","versionCounter"
         FROM n8n_runtime.workflow_entity WHERE id=$1 FOR UPDATE`, [WORKFLOW_ID]);
    const row = result.rows[0];
    if (!row || row.active !== true) fail('Live Livia workflow is not active.');
    if (row.versionId !== expectedVersion) fail(`Live version changed: expected ${expectedVersion}, found ${row.versionId}.`);
    const report = {
      workflowId: WORKFLOW_ID,
      oldVersion: row.versionId,
      nextVersion,
      releaseRoot,
      liveHash: stableHash({ nodes: parseJson(row.nodes, []), connections: parseJson(row.connections, {}) }),
      candidateHash: stableHash({ nodes: candidate.nodes, connections: candidate.connections }),
      apply,
    };
    if (!apply) {
      await client.query('ROLLBACK');
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return;
    }
    const manifest = createManifest();
    manifestPath = manifest.manifestPath;
    const now = new Date();
    await client.query(
      `INSERT INTO n8n_runtime.workflow_history ("versionId","workflowId",authors,"createdAt","updatedAt",nodes,connections,name,autosaved,description)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,true,$8)`,
      [nextVersion, WORKFLOW_ID, 'Codex workflow runtime isolation', now, JSON.stringify(candidate.nodes), JSON.stringify(candidate.connections), candidate.name, candidate.description || row.description || ''],
    );
    await client.query(
      `UPDATE n8n_runtime.workflow_entity
          SET nodes=$1, connections=$2, settings=$3, meta=$4, "versionId"=$5, "activeVersionId"=$6,
              "versionCounter"=$7, "updatedAt"=$8
        WHERE id=$9`,
      [JSON.stringify(candidate.nodes), JSON.stringify(candidate.connections), JSON.stringify(candidate.settings || parseJson(row.settings, {})), JSON.stringify(candidate.meta || parseJson(row.meta, {})), nextVersion, nextVersion, Number(row.versionCounter) + 1, now, WORKFLOW_ID],
    );
    await client.query(
      `INSERT INTO n8n_runtime.workflow_published_version ("workflowId","publishedVersionId","createdAt","updatedAt")
       VALUES ($1,$2,$3,$3)
       ON CONFLICT ("workflowId") DO UPDATE SET "publishedVersionId"=EXCLUDED."publishedVersionId", "updatedAt"=EXCLUDED."updatedAt"`,
      [WORKFLOW_ID, nextVersion, now],
    );
    await client.query(`INSERT INTO n8n_runtime.workflow_publish_history ("workflowId","versionId",event,"createdAt") VALUES ($1,$2,'deactivated',$3),($1,$4,'activated',$3)`, [WORKFLOW_ID, row.activeVersionId || row.versionId, now, nextVersion]);
    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({ ...report, manifestPath, appliedAt: now.toISOString() })}\n`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (manifestPath && !manifestPrecreated) fs.rmSync(manifestPath, { force: true });
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
