#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const moduleRoot = path.resolve(__dirname, '..');
const workflowPath = path.join(moduleRoot, 'workflows', 'meta-ads-publish.current.json');
const sourceRoot = path.join(moduleRoot, 'workflow-src', 'meta-ads-publish');

const CODE_SOURCES = Object.freeze({
  'Classify Media': 'classify-media.js',
  'Attach Video Staging Context': 'attach-video-staging-context.js',
  'Parse Processed Video': 'parse-processed-video.js',
  'Attach Video Transcript': 'attach-video-transcript.js',
  'Attach Video Main': 'attach-video-main.js',
  'Attach Video Analysis': 'attach-video-analysis.js',
  'Attach Video Thumbnail': 'attach-video-thumbnail.js',
  'Prepare Visual Grouping Batch': 'prepare-visual-grouping-batch.js',
  'Validate Visual Grouping': 'validate-visual-grouping.js',
  'Build Meta API Params From Vault': 'build-meta-api-params-from-vault.js',
  'Build Meta Account Inventory Requests': 'build-meta-inventory-requests.js',
  'Build Payload': 'build-payload.js',
  'Prepare Publish Run': 'prepare-publish-run.js',
  'Restore Publish Groups': 'restore-publish-groups.js',
  'Prepare Gateway Uploads': 'prepare-gateway-uploads.js',
  'Normalize Gateway Upload': 'normalize-gateway-upload.js',
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
  'Build Jobs': 'build-jobs.js',
  'Validate Meta Creative Payload': 'validate-meta-creative-payload.js',
  'Build Resume Jobs Checkpoint': 'build-resume-jobs-checkpoint.js',
  'Restore Persisted Resume Jobs': 'restore-persisted-resume-jobs.js',
  'Prepare Creative Operation': 'prepare-creative-operation.js',
  'Prepare Creative Fallback 1': 'prepare-creative-fallback-1.js',
  'Prepare Creative Fallback 2': 'prepare-creative-fallback-2.js',
  'Attach Creative Result': 'attach-creative-result.js',
  'Attach Advantage+ Verification': 'attach-advantage-plus-verification.js',
  'Build Stage Batch': 'build-stage-batch.js',
  'Build Activate Batch': 'build-activate-batch.js',
  'Build Drive Finalization': 'build-drive-finalization.js',
  'Prepare Drive Read': 'prepare-drive-read.js',
  'Verify Drive Finalization': 'verify-drive-finalization.js',
});

const LIVIA_CORRELATION_MARKER = 'Contrato de correlacao deterministica do workflow:';
const LIVIA_PROMPT_CORRELATION_CONTRACT = `${LIVIA_CORRELATION_MARKER}
- Retorne no objeto JSON de nivel raiz os campos \`job_key\` e \`group_key\` exatamente como recebidos no item atual.
- Esses identificadores nao sao texto criativo: nao os traduza, nao os resuma e nao invente valores.
- Em lotes com mais de um job, a resposta sem esses identificadores sera recusada antes de qualquer mutacao Meta.`;
const LIVIA_SYSTEM_CORRELATION_CONTRACT = `${LIVIA_CORRELATION_MARKER}
- \`job_key\` e \`group_key\` devem ser devolvidos no JSON raiz, exatamente como vieram no input.
- Nunca altere esses identificadores; eles sao usados para correlacionar a copy com a midia.`;

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

function synchronizeLiviaCorrelationContract(workflow, { write }) {
  const node = workflow.nodes.find((entry) => entry.name === 'Livia');
  if (!node || node.type !== '@n8n/n8n-nodes-langchain.agent') {
    throw new Error('Livia agent node not found.');
  }

  const prompt = String(node.parameters?.text || '');
  const systemMessage = String(node.parameters?.options?.systemMessage || '');
  const nextPrompt = prompt.includes(LIVIA_CORRELATION_MARKER)
    ? prompt
    : `${prompt.replace(/\s+$/, '')}\n\n${LIVIA_PROMPT_CORRELATION_CONTRACT}`;
  const nextSystemMessage = systemMessage.includes(LIVIA_CORRELATION_MARKER)
    ? systemMessage
    : `${systemMessage.replace(/\s+$/, '')}\n\n${LIVIA_SYSTEM_CORRELATION_CONTRACT}`;

  if (nextPrompt === prompt && nextSystemMessage === systemMessage) return false;
  if (write) {
    node.parameters.text = nextPrompt;
    node.parameters.options = { ...(node.parameters.options || {}), systemMessage: nextSystemMessage };
  }
  return true;
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
  if (synchronizeLiviaCorrelationContract(workflow, { write })) {
    drift.push('Livia correlation contract');
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
