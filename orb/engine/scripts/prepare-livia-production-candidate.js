#!/usr/bin/env node

'use strict';

// Build the only candidate shape that may be promoted to the active Livia
// workflow. Keeping every required remediation here makes it impossible for a
// production promotion to accidentally omit a previously versioned guard.

const fs = require('fs');
const path = require('path');
const { patchWorkflow: patchDrivePublicationMarks } = require('./patch-livia-drive-publication-marks');
const { patchWorkflow: patchTokenVaultPreflight } = require('./patch-livia-token-vault-preflight');
const { patchWorkflow: patchAccessibilityContract } = require('./patch-livia-accessibility-contract');
const { patchWorkflow: patchFacebookCarouselContract } = require('./patch-livia-facebook-carousel-contract');
const { patchWorkflow: patchJobGraphPayloadFile } = require('./patch-livia-job-graph-payload-file');
const { patchResumeIdentity, validate: pinRuntimeIsolation } = require('./patch-livia-runtime-isolation');

const RELEASE_ROOT_RE = /^\/opt\/skincos\/releases\/[0-9a-f]{40}\/source\/orb\/engine$/;

function required(name) {
  const index = process.argv.indexOf(name);
  const inline = process.argv.find((entry) => entry.startsWith(`${name}=`));
  const value = inline ? inline.slice(name.length + 1) : (index >= 0 ? process.argv[index + 1] || '' : '');
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readWorkflow(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function buildCandidate(workflow, releaseRoot) {
  if (!RELEASE_ROOT_RE.test(releaseRoot)) {
    throw new Error('release root must be an immutable /opt/skincos/releases/<sha>/source/orb/engine path.');
  }

  let candidate = patchDrivePublicationMarks(workflow);
  candidate = patchTokenVaultPreflight(candidate, releaseRoot);
  candidate = patchAccessibilityContract(candidate);
  candidate = patchFacebookCarouselContract(candidate);
  candidate = patchJobGraphPayloadFile(candidate, releaseRoot);
  const semanticResumeNodes = patchResumeIdentity(candidate);
  const runtimeNodes = pinRuntimeIsolation(candidate, releaseRoot);

  return {
    workflow: candidate,
    report: {
      workflowId: candidate.id,
      releaseRoot,
      patches: [
        'drive-publication-marks',
        'token-vault-preflight',
        'accessibility-contract',
        'facebook-carousel-contract',
        'job-graph-payload-file',
        'runtime-isolation',
      ],
      runtimeNodes,
      semanticResumeNodes,
    },
  };
}

function main() {
  const input = required('--input');
  const output = required('--output');
  const releaseRoot = required('--release-root');
  const { workflow, report } = buildCandidate(readWorkflow(input), releaseRoot);
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o750 });
  fs.writeFileSync(output, `${JSON.stringify(workflow, null, 2)}\n`, { mode: 0o640 });
  process.stdout.write(`${JSON.stringify({ ok: true, output, ...report })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || String(error));
    process.exit(1);
  }
}

module.exports = { buildCandidate };
