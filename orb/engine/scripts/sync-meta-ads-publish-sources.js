#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const moduleRoot = path.resolve(__dirname, '..');
// A live checkpoint is the authoritative starting point when reconciling a
// workflow that has evolved in n8n. The override keeps extraction read-only
// with respect to that checkpoint while preserving the normal local snapshot
// behavior for inject/check.
const workflowPath = process.env.META_ADS_PUBLISH_WORKFLOW_PATH
  ? path.resolve(process.env.META_ADS_PUBLISH_WORKFLOW_PATH)
  : path.join(moduleRoot, 'workflows', 'meta-ads-publish.current.json');
const sourceRoot = path.join(moduleRoot, 'workflow-src', 'meta-ads-publish');

const CODE_SOURCES = Object.freeze({
  'Build Meta API Params From Vault': 'build-meta-api-params-from-vault.js',
  'Build Meta Account Inventory Requests': 'build-meta-inventory-requests.js',
  'Build Payload': 'build-payload.js',
  'Prepare Publish Run': 'prepare-publish-run.js',
  'Restore Publish Groups': 'restore-publish-groups.js',
  'Prepare Gateway Uploads': 'prepare-gateway-uploads.js',
  'Normalize Gateway Upload': 'normalize-gateway-upload.js',
  'Build Jobs': 'build-jobs.js',
  'Validate Meta Creative Payload': 'validate-meta-creative-payload.js',
  'Prepare Creative Operation': 'prepare-creative-operation.js',
  'Attach Creative Result': 'attach-creative-result.js',
  'Attach Advantage+ Verification': 'attach-advantage-plus-verification.js',
  'Build Stage Batch': 'build-stage-batch.js',
  'Build Activate Batch': 'build-activate-batch.js',
  'Build Drive Finalization': 'build-drive-finalization.js',
  'Prepare Drive Read': 'prepare-drive-read.js',
  'Verify Drive Finalization': 'verify-drive-finalization.js',
  'Validate Meta Placement Eligibility': 'validate-meta-placement-eligibility.js',
  'Prepare Visual Grouping Batch': 'prepare-visual-grouping-batch.js',
  'Validate Visual Grouping': 'validate-visual-grouping.js',
  'Build Resume Jobs Checkpoint': 'build-resume-jobs-checkpoint.js',
  'Restore Persisted Resume Jobs': 'restore-persisted-resume-jobs.js',
  'Prepare Creative Fallback 1': 'prepare-creative-fallback-1.js',
  'Prepare Creative Fallback 2': 'prepare-creative-fallback-2.js',
  'Classify Media': 'classify-media.js',
  'Parse Processed Video': 'parse-processed-video.js',
  'Attach Video Transcript': 'attach-video-transcript.js',
  'Attach Video Main': 'attach-video-main.js',
  'Attach Video Analysis': 'attach-video-analysis.js',
  'Attach Video Thumbnail': 'attach-video-thumbnail.js',
  'Prepare Video Upload Starts': 'prepare-video-upload-starts.js',
  'Normalize Video Upload Start': 'normalize-video-upload-start.js',
  'Prepare Video Chunk': 'prepare-video-chunk.js',
  'Parse Video Slice': 'parse-video-slice.js',
  'Prepare Video Chunk Transfer': 'prepare-video-chunk-transfer.js',
  'Normalize Video Chunk Transfer': 'normalize-video-chunk-transfer.js',
  'Prepare Video Finish': 'prepare-video-finish.js',
  'Normalize Video Finish': 'normalize-video-finish.js',
  'Prepare Video Status': 'prepare-video-status.js',
  'Normalize Video Status': 'normalize-video-status.js',
  'Attach Video Staging Context': 'attach-video-staging-context.js',
  'Attach Task Runner Health': 'attach-task-runner-health.js',
  'Prepare Media Upload Plan': 'prepare-media-upload-plan.js',
  'Emit No Image Upload': 'emit-no-image-upload.js',
  'Emit No Video Upload': 'emit-no-video-upload.js',
  'Aggregate Media Upload Results': 'aggregate-media-upload-results.js',
  'Assemble Job Inputs': 'assemble-job-inputs.js',
});

function readWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function writeWorkflow(workflow) {
  fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  if (node.type !== 'n8n-nodes-base.code') throw new Error(`Node is not a Code node: ${name}`);
  return node;
}

function extract() {
  const workflow = readWorkflow();
  fs.mkdirSync(sourceRoot, { recursive: true });
  for (const [nodeName, fileName] of Object.entries(CODE_SOURCES)) {
    const code = String(findNode(workflow, nodeName).parameters.jsCode || '');
    if (!code.trim()) throw new Error(`Empty source in node: ${nodeName}`);
    fs.writeFileSync(path.join(sourceRoot, fileName), `${code.replace(/\s+$/, '')}\n`);
  }
}

function inject({ write = true } = {}) {
  const workflow = readWorkflow();
  const drift = [];
  for (const [nodeName, fileName] of Object.entries(CODE_SOURCES)) {
    const filePath = path.join(sourceRoot, fileName);
    const code = fs.readFileSync(filePath, 'utf8').replace(/\s+$/, '');
    const node = findNode(workflow, nodeName);
    const embedded = String(node.parameters.jsCode || '').replace(/\s+$/, '');
    if (embedded !== code) {
      drift.push(nodeName);
      node.parameters.jsCode = code;
    }
  }
  if (write && drift.length) writeWorkflow(workflow);
  return drift;
}

function main() {
  const command = process.argv[2] || 'check';
  if (command === 'extract') {
    extract();
    console.log(`Extracted ${Object.keys(CODE_SOURCES).length} Code nodes.`);
    return;
  }
  if (command === 'inject') {
    const drift = inject({ write: true });
    console.log(`Injected ${drift.length} changed Code nodes.`);
    return;
  }
  if (command === 'check') {
    const drift = inject({ write: false });
    if (drift.length) {
      throw new Error(`Embedded Code node drift: ${drift.join(', ')}`);
    }
    console.log('Embedded Code node sources are synchronized.');
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main();
