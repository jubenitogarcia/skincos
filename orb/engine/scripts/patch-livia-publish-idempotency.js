#!/usr/bin/env node
'use strict';

// Prevents overlapping Livia executions from publishing the same Drive group
// twice.  The durable semantic ledger is still the resume source of truth, but
// it cannot prevent two executions that both read it before either has written
// the first accepted provider response.

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const HTTP_NODE = 'HTTP Request';
const PREPARE_NODE = 'Prepare HTTP Publish Request';
const PROCESS_NODE = 'Process HTTP Publish Result';
const ASSERT_NODE = 'Assert Livia Publication Window';
const CLEANUP_NODE = 'Cleanup Temp Files';
const RELEASE_NODE = 'Release Livia Publication Lock';
const RELEASE_ROOT_RE = /^\/opt\/skincos\/releases\/[0-9a-f]{40}\/source\/orb\/engine$/;
const RELEASE_NODE_ID = 'livia-release-publication-lock';

const LOCK_BLOCK = String.raw`// livia_publication_lock_v1: serialize the whole outbound publication run.
const publicationLockPath = '/var/lib/skincos-runtime/orb/state/livia-publication.lock';
const publicationLeaseMs = 2 * 60 * 60 * 1000;
const publicationExecutionId = String($execution?.retryOf || $execution?.id || 'noexec')
  .replace(/[^A-Za-z0-9_-]/g, '_')
  .slice(0, 80) || 'noexec';

function readPublicationLock() {
  if (!fs.existsSync(publicationLockPath)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(publicationLockPath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('payload is not an object');
    return value;
  } catch (error) {
    throw new Error('Assert Livia Publication Window: publication lock unreadable; refusing to publish. ' + error.message);
  }
}

function acquirePublicationLock() {
  fs.mkdirSync(path.dirname(publicationLockPath), { recursive: true, mode: 0o750 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = Date.now();
    const lock = {
      schema: 'livia-publication-lock.v1',
      executionId: publicationExecutionId,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: now + publicationLeaseMs,
    };
    let descriptor;
    try {
      descriptor = fs.openSync(publicationLockPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(lock) + '\n', { encoding: 'utf8' });
      fs.closeSync(descriptor);
      return;
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
      if (error?.code !== 'EEXIST') throw error;
      const existing = readPublicationLock();
      const owner = String(existing?.executionId || '').trim();
      if (owner === publicationExecutionId) return;
      if (Number(existing?.expiresAt || 0) > Date.now()) {
        throw new Error('Assert Livia Publication Window: outra execução Livia já possui o lease de publicação; execução interrompida antes do gateway.');
      }
      try { fs.unlinkSync(publicationLockPath); } catch (unlinkError) {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  throw new Error('Assert Livia Publication Window: não foi possível adquirir o lease de publicação.');
}

acquirePublicationLock();`;

function fail(message) {
  throw new Error(message);
}

function ensureConnection(workflow, from, to) {
  workflow.connections ||= {};
  workflow.connections[from] ||= {};
  workflow.connections[from].main ||= [];
  if (!workflow.connections[from].main.length) workflow.connections[from].main.push([]);
  const bucket = workflow.connections[from].main[0];
  if (!bucket.some((edge) => edge.node === to && edge.type === 'main')) {
    bucket.push({ node: to, type: 'main', index: 0 });
  }
}

function releaseCommand(releaseRoot) {
  return `={{ (() => {
  const executionId = String($execution?.retryOf || $execution?.id || "noexec")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 80) || "noexec";
  function sh(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
  return "node " + sh("${releaseRoot}/scripts/livia/release-publication-lock.js") + " --execution-id " + sh(executionId);
})() }}`;
}

function patchWorkflow(workflow, releaseRoot) {
  if (workflow?.id !== WORKFLOW_ID) fail(`Expected Livia workflow ${WORKFLOW_ID}.`);
  if (!RELEASE_ROOT_RE.test(String(releaseRoot || ''))) fail('release root must be an immutable /opt/skincos/releases/<sha>/source/orb/engine path.');

  const nodes = new Map((workflow.nodes || []).map((node) => [node?.name, node]));
  const http = nodes.get(HTTP_NODE);
  const prepare = nodes.get(PREPARE_NODE);
  const process = nodes.get(PROCESS_NODE);
  const assertNode = nodes.get(ASSERT_NODE);
  const cleanup = nodes.get(CLEANUP_NODE);
  for (const [name, node] of [[HTTP_NODE, http], [PREPARE_NODE, prepare], [PROCESS_NODE, process], [ASSERT_NODE, assertNode], [CLEANUP_NODE, cleanup]]) {
    if (!node) fail(`Livia publish idempotency requires ${name}.`);
  }
  if (http.type !== 'n8n-nodes-base.httpRequest') fail(`${HTTP_NODE} must be an HTTP Request node.`);
  if (assertNode.type !== 'n8n-nodes-base.code') fail(`${ASSERT_NODE} must be a Code node.`);
  if (process.type !== 'n8n-nodes-base.code') fail(`${PROCESS_NODE} must be a Code node.`);
  if (cleanup.type !== 'n8n-nodes-base.executeCommand') fail(`${CLEANUP_NODE} must be an Execute Command node.`);

  http.retryOnFail = false;
  delete http.waitBetweenTries;
  delete http.maxTries;
  prepare.retryOnFail = false;
  delete prepare.waitBetweenTries;
  delete prepare.maxTries;

  const assertCode = String(assertNode.parameters?.jsCode || '');
  if (!assertCode.includes('_liviaBuildJobGraphPayloadFile') || !assertCode.includes("const payloadDir = '/tmp/livia-job-graph-input';")) {
    fail(`${ASSERT_NODE} does not contain the private payload-file contract expected by the idempotency patch.`);
  }
  if (!assertCode.includes('livia_publication_lock_v1')) {
    assertNode.parameters = {
      ...(assertNode.parameters || {}),
      jsCode: assertCode.replace("const payloadDir = '/tmp/livia-job-graph-input';", `${LOCK_BLOCK}\n\nconst payloadDir = '/tmp/livia-job-graph-input';`),
    };
  }

  const processCode = String(process.parameters?.jsCode || '');
  const processNeedle = '    semanticJobKey: str(source.semanticJobKey, ""),\n    media:';
  if (!processCode.includes('executionId: str(execId, "")')) {
    if (!processCode.includes(processNeedle)) fail(`${PROCESS_NODE} does not expose the expected durable resume record shape.`);
    process.parameters = {
      ...(process.parameters || {}),
      jsCode: processCode.replace(processNeedle, '    semanticJobKey: str(source.semanticJobKey, ""),\n    executionId: str(execId, ""),\n    media:'),
    };
  }

  let release = nodes.get(RELEASE_NODE);
  if (!release) {
    release = {
      id: RELEASE_NODE_ID,
      name: RELEASE_NODE,
      type: 'n8n-nodes-base.executeCommand',
      typeVersion: 1,
      position: [-2400, 480],
      parameters: { executeOnce: true },
    };
    workflow.nodes ||= [];
    workflow.nodes.push(release);
  }
  release.type = 'n8n-nodes-base.executeCommand';
  release.typeVersion = 1;
  release.executeOnce = true;
  release.parameters = { ...(release.parameters || {}), executeOnce: true, command: releaseCommand(releaseRoot) };
  ensureConnection(workflow, CLEANUP_NODE, RELEASE_NODE);
  return workflow;
}

function validate(workflow, releaseRoot) {
  if (workflow?.id !== WORKFLOW_ID) fail(`Expected Livia workflow ${WORKFLOW_ID}.`);
  if (!RELEASE_ROOT_RE.test(String(releaseRoot || ''))) fail('release root must be an immutable /opt/skincos/releases/<sha>/source/orb/engine path.');
  const nodes = new Map((workflow.nodes || []).map((node) => [node?.name, node]));
  const http = nodes.get(HTTP_NODE);
  const prepare = nodes.get(PREPARE_NODE);
  const process = nodes.get(PROCESS_NODE);
  const assertCode = String(nodes.get(ASSERT_NODE)?.parameters?.jsCode || '');
  const release = nodes.get(RELEASE_NODE);
  if (http?.retryOnFail !== false || Object.prototype.hasOwnProperty.call(http || {}, 'maxTries')) {
    fail('HTTP Request must not retry mutating social operations automatically.');
  }
  if (prepare?.retryOnFail !== false) fail('Prepare HTTP Publish Request must not retry the outbound queue transition automatically.');
  if (!String(process?.parameters?.jsCode || '').includes('executionId: str(execId, "")')) fail('Process HTTP Publish Result must carry the execution lease owner into the progress ledger.');
  if (!assertCode.includes('livia_publication_lock_v1') || !assertCode.includes("fs.openSync(publicationLockPath, 'wx'")) {
    fail('Assert Livia Publication Window must atomically acquire the Livia publication lease.');
  }
  if (!release || release.type !== 'n8n-nodes-base.executeCommand' || !String(release.parameters?.command || '').includes(`${releaseRoot}/scripts/livia/release-publication-lock.js`)) {
    fail('Release Livia Publication Lock must call the pinned immutable release helper.');
  }
  const cleanupEdges = workflow.connections?.[CLEANUP_NODE]?.main?.flat?.() || [];
  if (!cleanupEdges.some((edge) => edge.node === RELEASE_NODE)) fail('Cleanup Temp Files must release the Livia publication lease.');
  return [HTTP_NODE, PREPARE_NODE, PROCESS_NODE, ASSERT_NODE, CLEANUP_NODE, RELEASE_NODE];
}

function main() {
  const [input, output] = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const releaseRoot = process.argv.find((value) => value.startsWith('--release-root='))?.slice('--release-root='.length) || '';
  if (!input || !output || !releaseRoot) fail('Usage: patch-livia-publish-idempotency.js <input.json> <output.json> --release-root=/opt/skincos/releases/<sha>/source/orb/engine');
  const workflow = patchWorkflow(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')), releaseRoot);
  const touched = validate(workflow, releaseRoot);
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(workflow, null, 2)}\n`, { mode: 0o640 });
  process.stdout.write(`${JSON.stringify({ ok: true, workflowId: WORKFLOW_ID, nodes: touched })}\n`);
}

if (require.main === module) main();

module.exports = { LOCK_BLOCK, RELEASE_NODE, releaseCommand, patchWorkflow, validate };
