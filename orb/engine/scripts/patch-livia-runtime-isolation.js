#!/usr/bin/env node
'use strict';

// Creates a version-pinned Livia candidate.  Applying it is intentionally a
// separate, expected-version-checked operation.
const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const REQUIRED_NODES = new Set([
  'Process Media Asset',
  'BQ - Build Platform Job Graph',
  'Verify Published Artifacts',
  'Record Publish Progress',
  'Validate Publish Token Health',
]);
const RELEASE_ROOT_RE = /^\/opt\/skincos\/releases\/[0-9a-f]{7,64}\/source\/orb\/engine$/;
const PINNED_ROOT_RE = /\/opt\/skincos\/releases\/[0-9a-f]{7,64}\/source\/orb\/engine/g;
const SEMANTIC_JOB_KEY_RE = /^livia:v2:[a-f0-9]{64}$/;
const MUTABLE_RUNTIME_RE = /\/opt\/skincos\/current\/source|\b(?:ORB_ROOT|N8N_ROOT)\b|\/mnt\/c\/|livia-verify-provider-copy-drift-wrapper|--verifier\b/;

function fail(message) { throw new Error(message); }
function arg(prefix) { return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || ''; }

function directVerifierCommand(releaseRoot) {
  // Keep the verifier inside the workflow-version bundle.  In particular, do
  // not insert a compatibility wrapper: a wrapper can silently call another
  // release or turn a provider mismatch into a successful verification.
  return `={{ (() => {
  const final = ($json && typeof $json === "object") ? $json : {};
  function sh(value) {
    return "'" + String(value).replace(/'/g, "'\\\\''") + "'";
  }
  return "set -a; . /etc/skincos/orb-business.env; set +a; printf %s " + sh(JSON.stringify({ final })) + " | node " + sh("${releaseRoot}/scripts/livia/verify-published-artifacts.js") + " --payload -";
})() }}`;
}

function patchResumeIdentity(workflow) {
  const nodes = new Map((workflow.nodes || []).map((node) => [node?.name, node]));
  const seed = nodes.get('BQ - Seed Publish State');
  const process = nodes.get('Process HTTP Publish Result');
  if (seed?.type !== 'n8n-nodes-base.code' || process?.type !== 'n8n-nodes-base.code') {
    fail('Livia semantic resume patch requires BQ - Seed Publish State and Process HTTP Publish Result Code nodes.');
  }

  const seedCode = String(seed.parameters?.jsCode || '');
  const processCode = String(process.parameters?.jsCode || '');
  if (seedCode.includes('resumeBySemanticKey') &&
      seedCode.includes('completedSemanticJobKeys') &&
      processCode.includes('semanticJobKey: str(source.semanticJobKey')) {
    return [];
  }

  const seedNeedle = `const rawResumeRecords = codexDryRun ? [] : __prAsArray(payload.resumeCompleted);
const resumeRecords = rawResumeRecords
  .map((entry) => __prAsObject(entry))
  .filter((entry) => Number.isInteger(Number(entry.publishRunIndex)) && Object.keys(__prAsObject(entry.lastResponseBody)).length);
const resumeByRun = {};
for (const entry of resumeRecords) {
  resumeByRun[__prStr(entry.publishRunIndex)] = {
    statusCode: entry.lastStatusCode || 200,
    body: __prAsObject(entry.lastResponseBody),
  };
}
const completedRunIndexes = new Set(resumeRecords.map((entry) => __prStr(entry.publishRunIndex)));
const pendingJobs = qaAwareJobs.filter((job) => !completedRunIndexes.has(__prStr(job.publishRunIndex)));`;
  const seedReplacement = `const rawResumeRecords = codexDryRun ? [] : __prAsArray(payload.resumeCompleted);
const jobsBySemanticKey = new Map();
for (const job of qaAwareJobs) {
  const semanticJobKey = __prStr(job.semanticJobKey, "");
  if (!/^livia:v2:[a-f0-9]{64}$/.test(semanticJobKey)) {
    throw new Error("BQ - Seed Publish State: job sem semanticJobKey válido; bloqueando antes do gateway.");
  }
  if (jobsBySemanticKey.has(semanticJobKey)) {
    throw new Error("BQ - Seed Publish State: semanticJobKey duplicado; bloqueando antes do gateway.");
  }
  jobsBySemanticKey.set(semanticJobKey, job);
}
const resumeBySemanticKey = new Map();
for (const rawEntry of rawResumeRecords.map((entry) => __prAsObject(entry))) {
  const semanticJobKey = __prStr(rawEntry.semanticJobKey, "");
  if (!/^livia:v2:[a-f0-9]{64}$/.test(semanticJobKey)) continue;
  if (!jobsBySemanticKey.has(semanticJobKey)) continue;
  if (!Object.keys(__prAsObject(rawEntry.lastResponseBody)).length) continue;
  resumeBySemanticKey.set(semanticJobKey, rawEntry);
}
const resumeRecords = qaAwareJobs
  .map((job) => {
    const record = resumeBySemanticKey.get(__prStr(job.semanticJobKey));
    return record ? __prRemoveNulls({ ...record, publishRunIndex: job.publishRunIndex, semanticJobKey: job.semanticJobKey }) : null;
  })
  .filter(Boolean);
const resumeByRun = {};
for (const entry of resumeRecords) {
  // This map serves only intra-execution dependency references. The durable
  // lookup above is exclusively semanticJobKey based.
  resumeByRun[__prStr(entry.publishRunIndex)] = {
    statusCode: entry.lastStatusCode || 200,
    body: __prAsObject(entry.lastResponseBody),
  };
}
const completedSemanticJobKeys = new Set(resumeRecords.map((entry) => __prStr(entry.semanticJobKey)));
const pendingJobs = qaAwareJobs.filter((job) => !completedSemanticJobKeys.has(__prStr(job.semanticJobKey)));`;
  if (!seedCode.includes(seedNeedle)) {
    fail('Livia semantic resume patch could not find the expected legacy publishRunIndex resume block.');
  }
  seed.parameters.jsCode = seedCode.replace(seedNeedle, seedReplacement);

  const processNeedle = '    publishRunIndex: source.publishRunIndex,\n    media: {';
  const processReplacement = '    publishRunIndex: source.publishRunIndex,\n    semanticJobKey: str(source.semanticJobKey, ""),\n    media: {';
  if (!processCode.includes(processNeedle)) {
    fail('Livia semantic resume patch could not preserve semanticJobKey in compactResumeRecord.');
  }
  process.parameters.jsCode = processCode.replace(processNeedle, processReplacement);
  return ['BQ - Seed Publish State', 'Process HTTP Publish Result'];
}

function validate(workflow, releaseRoot) {
  if (workflow?.id !== WORKFLOW_ID || workflow?.active !== true) fail('Expected the active Livia workflow.');
  if (!RELEASE_ROOT_RE.test(releaseRoot)) fail(`Invalid immutable Orb release root: ${releaseRoot}.`);
  const touched = [];
  for (const node of workflow.nodes || []) {
    if (!REQUIRED_NODES.has(node?.name)) continue;
    if (node.type !== 'n8n-nodes-base.executeCommand') fail(`${node.name} must remain an Execute Command node.`);
    const command = String(node.parameters?.command || '');
    const hasMutableRoot = command.includes('/opt/skincos/current/source/orb/engine');
    const hasPinnedRoot = PINNED_ROOT_RE.test(command);
    PINNED_ROOT_RE.lastIndex = 0;
    if (node.name === 'Verify Published Artifacts') {
      node.parameters.command = directVerifierCommand(releaseRoot);
    } else {
      if (!hasMutableRoot && !hasPinnedRoot) fail(`${node.name} has no recognized Orb runtime root.`);
      node.parameters.command = hasMutableRoot
        ? command.replaceAll('/opt/skincos/current/source/orb/engine', releaseRoot)
        : command.replace(PINNED_ROOT_RE, releaseRoot);
    }
    touched.push(node.name);
  }
  if (touched.length !== REQUIRED_NODES.size) fail(`Expected to pin ${REQUIRED_NODES.size} Livia sidecars, changed ${touched.length}.`);
  const mutable = (workflow.nodes || []).filter((node) => node?.type === 'n8n-nodes-base.executeCommand')
    .filter((node) => MUTABLE_RUNTIME_RE.test(String(node.parameters?.command || '')))
    .map((node) => node.name);
  if (mutable.length) fail(`Mutable Execute Command reference remains: ${mutable.join(', ')}.`);
  return touched.sort();
}

function main() {
  const [input, output] = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const releaseRoot = arg('--release-root=');
  if (!input || !output || !releaseRoot) {
    fail('Usage: patch-livia-runtime-isolation.js <live-export.json> <candidate.json> --release-root=/opt/skincos/releases/<sha>/source/orb/engine');
  }
  const workflow = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  const semanticResumeNodes = patchResumeIdentity(workflow);
  const touched = validate(workflow, releaseRoot);
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(workflow, null, 2)}\n`, { mode: 0o640 });
  process.stdout.write(JSON.stringify({ ok: true, workflowId: WORKFLOW_ID, releaseRoot, nodes: touched, semanticResumeNodes }) + '\n');
}

main();
