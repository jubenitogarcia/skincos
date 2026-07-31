#!/usr/bin/env node
'use strict';

// Keep the full publish-context payload out of Execute Command argv.  Large
// carousels otherwise hit the operating-system argv limit (spawn E2BIG) before
// the job graph builder can validate anything.  The payload is written
// atomically by the existing publication-window guard and consumed by the
// pinned builder through --payload-file.

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const ASSERT_NODE = 'Assert Livia Publication Window';
const BUILD_NODE = 'BQ - Build Platform Job Graph';
const PAYLOAD_DIR = '/tmp/livia-job-graph-input';
const PAYLOAD_FILE_RE = /^\/tmp\/livia-job-graph-input\/[A-Za-z0-9_-]+\.json$/;

const ASSERT_CODE = String.raw`const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const lockPath = '/var/lib/skincos-runtime/orb/state/livia-maintenance/restart.lock';
if (fs.existsSync(lockPath)) {
  throw new Error('Assert Livia Publication Window: manutenção controlada do Orb em andamento; publicação interrompida antes do gateway.');
}

const payloadDir = '${PAYLOAD_DIR}';
fs.mkdirSync(payloadDir, { recursive: true, mode: 0o700 });
const executionId = String($execution?.retryOf || $execution?.id || 'noexec')
  .replace(/[^A-Za-z0-9_-]/g, '_')
  .slice(0, 80) || 'noexec';

return $input.all().map((item, index) => {
  const payload = item && item.json && typeof item.json === 'object' ? item.json : {};
  const serialized = JSON.stringify(payload);
  if (!serialized || serialized === '{}') {
    throw new Error('Assert Livia Publication Window: contexto de publicação vazio; payload não foi gravado.');
  }
  const sha256 = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
  const filename = executionId + '_' + String(index) + '_' + sha256 + '.json';
  const target = path.join(payloadDir, filename);
  // The final name already contains the execution id, item index and payload
  // digest, so it is unique without depending on Node's process global (which
  // is intentionally unavailable in the n8n Code sandbox).
  const temporary = target + '.tmp';
  fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
  return {
    json: {
      ...payload,
      _liviaBuildJobGraphPayloadFile: target,
      _liviaBuildJobGraphPayloadSha256: sha256,
    },
    binary: item && item.binary,
    pairedItem: item && item.pairedItem,
  };
});`;

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function buildCommand(releaseRoot) {
  return `={{ (() => {
  const payload = ($json && typeof $json === "object") ? $json : {};
  const payloadFile = String(payload._liviaBuildJobGraphPayloadFile || "").trim();
  const payloadSha256 = String(payload._liviaBuildJobGraphPayloadSha256 || "").trim().toLowerCase();
  if (!/^\\/tmp\\/livia-job-graph-input\\/[A-Za-z0-9_-]+\\.json$/.test(payloadFile)) {
    throw new Error("BQ - Build Platform Job Graph: payload file ausente ou fora do diretório privado.");
  }
  if (!/^[a-f0-9]{64}$/.test(payloadSha256)) {
    throw new Error("BQ - Build Platform Job Graph: SHA-256 do payload ausente ou inválido.");
  }
  function sh(value) { return "'" + String(value).replace(/'/g, "'\\\\''") + "'"; }
  const source = sh("${releaseRoot}/compose2-current.js");
  const builder = sh("${releaseRoot}/scripts/livia/build-platform-job-graph.js");
  const file = sh(payloadFile);
  const hash = sh(payloadSha256);
  return "trap 'rm -f -- " + payloadFile + "' EXIT HUP INT TERM; test -f " + file +
    " && test \\\"$(sha256sum " + file + " | awk '{print $1}')\\\" = " + hash +
    " && LIVIA_BUILD_JOB_GRAPH_SOURCE=" + source + " node " + builder + " --payload-file " + file;
})() }}`;
}

function patchWorkflow(workflow, releaseRoot) {
  if (workflow?.id !== WORKFLOW_ID) throw new Error('Expected the active Livia workflow.');
  if (!/^\/opt\/skincos\/releases\/[0-9a-f]{40}\/source\/orb\/engine$/.test(String(releaseRoot || ''))) {
    throw new Error('release root must be an immutable /opt/skincos/releases/<sha>/source/orb/engine path.');
  }
  const nodes = new Map((workflow.nodes || []).map((node) => [node.name, node]));
  const assertNode = nodes.get(ASSERT_NODE);
  const buildNode = nodes.get(BUILD_NODE);
  if (!assertNode || assertNode.type !== 'n8n-nodes-base.code') throw new Error(`${ASSERT_NODE} must be a Code node.`);
  if (!buildNode || buildNode.type !== 'n8n-nodes-base.executeCommand') throw new Error(`${BUILD_NODE} must be an Execute Command node.`);
  assertNode.parameters = { ...(assertNode.parameters || {}), jsCode: ASSERT_CODE };
  buildNode.parameters = { ...(buildNode.parameters || {}), command: buildCommand(releaseRoot) };
  return workflow;
}

function validate(workflow) {
  const nodes = new Map((workflow.nodes || []).map((node) => [node.name, node]));
  const assertCode = String(nodes.get(ASSERT_NODE)?.parameters?.jsCode || '');
  const command = String(nodes.get(BUILD_NODE)?.parameters?.command || '');
  if (!assertCode.includes('_liviaBuildJobGraphPayloadFile') || !assertCode.includes('fs.renameSync')) {
    throw new Error('Publication-window guard must atomically persist the job-graph payload.');
  }
  if (!command.includes('--payload-file') || command.includes('JSON.stringify(payload)')) {
    throw new Error('Job-graph command must use the private payload file and never serialize payload into argv.');
  }
  if (!PAYLOAD_FILE_RE.test('/tmp/livia-job-graph-input/example_0_' + '0'.repeat(64) + '.json')) {
    throw new Error('Internal payload-file contract is invalid.');
  }
  return [ASSERT_NODE, BUILD_NODE];
}

function main() {
  const [input, output] = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const releaseRoot = process.argv.find((value) => value.startsWith('--release-root='))?.slice('--release-root='.length) || '';
  if (!input || !output || !releaseRoot) throw new Error('Usage: patch-livia-job-graph-payload-file.js <input.json> <output.json> --release-root=/opt/skincos/releases/<sha>/source/orb/engine');
  const workflow = patchWorkflow(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')), releaseRoot);
  const touched = validate(workflow);
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(workflow, null, 2)}\n`, { mode: 0o640 });
  process.stdout.write(`${JSON.stringify({ ok: true, workflowId: WORKFLOW_ID, nodes: touched })}\n`);
}

if (require.main === module) main();

module.exports = { ASSERT_CODE, BUILD_NODE, PAYLOAD_DIR, PAYLOAD_FILE_RE, buildCommand, patchWorkflow, validate };
