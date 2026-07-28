#!/usr/bin/env node
'use strict';

// A workflow may call versioned helper scripts, but never the mutable
// /opt/skincos/current pointer.  This utility records and verifies the exact
// immutable release used by one saved workflow version.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_RUNTIME_HOME = '/var/lib/skincos-runtime/orb';
const RELEASE_ROOT_RE = /^\/opt\/skincos\/releases\/([0-9a-f]{7,64})\/source\/orb\/engine$/;
const MUTABLE_SOURCE_RE = /\/opt\/skincos\/current\/source|\b(?:ORB_ROOT|N8N_ROOT)\b/;
const WORKFLOW_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const WORKFLOW_VERSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}
function immutableReleaseId(releaseRoot) {
  const resolved = path.resolve(releaseRoot); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- validated against RELEASE_ROOT_RE below.
  const match = resolved.match(RELEASE_ROOT_RE);
  if (!match) fail(`Workflow runtime root must be an immutable Orb release, got ${releaseRoot}.`);
  return { releaseRoot: resolved, releaseId: match[1] };
}
function commandsFor(workflow) {
  return (Array.isArray(workflow.nodes) ? workflow.nodes : [])
    .filter((node) => node?.type === 'n8n-nodes-base.executeCommand')
    .map((node) => ({ name: String(node.name || ''), command: String(node?.parameters?.command || '') }));
}
function assertNoMutableCommands(workflow) {
  const offenders = commandsFor(workflow)
    .filter(({ command }) => MUTABLE_SOURCE_RE.test(command))
    .map(({ name }) => name);
  if (offenders.length) {
    fail(`Mutable runtime reference is forbidden in Execute Command node(s): ${offenders.join(', ')}.`);
  }
}
function atomicWrite(filePath, content) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o640 });
  fs.renameSync(temporary, filePath);
}
function comparableManifest(manifest) {
  const { createdAt, ...stable } = manifest || {};
  return stable;
}
function manifestPathFor(runtimeHome, workflowId, workflowVersion) {
  if (!WORKFLOW_ID_RE.test(workflowId)) fail('Workflow ID is invalid for a manifest path.');
  if (!WORKFLOW_VERSION_RE.test(workflowVersion)) fail('Workflow version is invalid for a manifest path.');
  const resolvedHome = path.resolve(runtimeHome);
  if (resolvedHome !== DEFAULT_RUNTIME_HOME) fail(`Manifest runtime home must be ${DEFAULT_RUNTIME_HOME}.`);
  const manifestPath = path.resolve(resolvedHome, 'workflow-runtime-manifests', workflowId, `${workflowVersion}.json`); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- validated ID/version and containment above.
  const basePath = path.resolve(resolvedHome, 'workflow-runtime-manifests') + path.sep;
  if (!manifestPath.startsWith(basePath)) fail('Manifest path escapes the runtime manifest directory.');
  return manifestPath;
}
function defaultEntrypoints(releaseRoot) {
  return [
    'compose2-current.js',
    'scripts/livia/process-media-asset.js',
    'scripts/livia/build-platform-job-graph.js',
    'scripts/livia/verify-published-artifacts.js',
    'scripts/livia/publish-progress-ledger.js',
    'scripts/livia/validate-publish-token-health.js',
  ].map((relativePath) => ({ relativePath, absolutePath: path.join(releaseRoot, relativePath) }));
}
function createManifest() {
  const workflowFile = arg('--workflow');
  const workflowId = arg('--workflow-id');
  const workflowVersion = arg('--workflow-version');
  const runtimeHome = arg('--runtime-home') || DEFAULT_RUNTIME_HOME;
  const source = immutableReleaseId(arg('--release-root'));
  if (!workflowFile || !workflowId || !workflowVersion) fail('create requires --workflow, --workflow-id and --workflow-version.');
  const workflow = readJson(workflowFile);
  if (String(workflow.id || '') !== workflowId) fail(`Workflow ID mismatch: expected ${workflowId}, got ${workflow.id || 'missing'}.`);
  assertNoMutableCommands(workflow);
  const commands = commandsFor(workflow);
  const liviaCommands = commands.filter(({ command }) => /scripts\/livia\//.test(command) || /compose2-current\.js/.test(command));
  if (liviaCommands.length && liviaCommands.some(({ command }) => !command.includes(source.releaseRoot))) {
    fail('Livia helper command is not pinned to the manifest release root.');
  }
  const entrypoints = defaultEntrypoints(source.releaseRoot).map(({ relativePath, absolutePath }) => {
    if (!fs.existsSync(absolutePath)) fail(`Pinned workflow entrypoint is missing: ${absolutePath}.`);
    return { path: relativePath, sha256: sha256File(absolutePath) };
  });
  const manifest = {
    schemaVersion: 1,
    workflowId,
    workflowVersion,
    releaseId: source.releaseId,
    releaseRoot: source.releaseRoot,
    createdAt: new Date().toISOString(),
    workflowSha256: crypto.createHash('sha256').update(JSON.stringify({ nodes: workflow.nodes, connections: workflow.connections })).digest('hex'),
    commands: liviaCommands.map(({ name, command }) => ({ name, sha256: crypto.createHash('sha256').update(command).digest('hex') })),
    entrypoints,
  };
  const manifestPath = manifestPathFor(runtimeHome, workflowId, workflowVersion);
  if (fs.existsSync(manifestPath)) {
    const existing = readJson(manifestPath);
    if (JSON.stringify(comparableManifest(existing)) !== JSON.stringify(comparableManifest(manifest))) {
      fail(`Workflow runtime manifest already exists with different content: ${manifestPath}.`);
    }
  } else {
    atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, manifestPath, workflowId, workflowVersion, releaseId: source.releaseId })}\n`);
}
function auditLive() {
  let Client;
  try { Client = require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client; }
  catch { Client = require('pg').Client; }
  const client = new Client({ user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || '/var/run/postgresql', database: process.env.PGDATABASE || 'n8n_runtime' });
  client.connect().then(async () => {
    const result = await client.query(
      `SELECT w.id, w.name, w."activeVersionId" AS "versionId", h.nodes
         FROM n8n_runtime.workflow_entity w
         JOIN n8n_runtime.workflow_history h ON h."workflowId"=w.id AND h."versionId"=w."activeVersionId"
        WHERE w.active=true AND w."isArchived"=false ORDER BY w.name`,
    );
    const offenders = result.rows.flatMap((row) => {
      const workflow = { nodes: typeof row.nodes === 'string' ? JSON.parse(row.nodes) : row.nodes };
      return commandsFor(workflow).filter(({ command }) => MUTABLE_SOURCE_RE.test(command)).map(({ name }) => ({ workflowId: row.id, workflow: row.name, versionId: row.versionId, node: name }));
    });
    await client.end();
    if (offenders.length) fail(`Active workflows contain mutable runtime references: ${JSON.stringify(offenders)}.`);
    process.stdout.write(JSON.stringify({ ok: true, activeWorkflowCount: result.rows.length, mutableRuntimeReferences: 0 }) + '\n');
  }).catch(async (error) => { await client.end().catch(() => {}); fail(error.message); });
}

if (process.argv.includes('create')) createManifest();
else if (process.argv.includes('audit-live')) auditLive();
else fail('Usage: workflow-runtime-manifest.js create ... | audit-live');
