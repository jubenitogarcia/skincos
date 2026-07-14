#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const [, , inputPath, outputPathArg] = process.argv;

if (!inputPath) {
  console.error('Uso: node patch-meta-ads-remaining-fixes.js <input-json> [output-json]');
  process.exit(1);
}

const SOURCE_DIR = path.join(runtimePaths.workflowSrcDir, 'meta-ads-performance-report');
const outputPath = outputPathArg || inputPath;
const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const codeSources = {
  'Build Consolidated WhatsApp Report': path.join(SOURCE_DIR, 'build-consolidated-whatsapp-report.js'),
  'Check Consolidated Idempotency': path.join(SOURCE_DIR, 'check-consolidated-idempotency.js'),
  'Persist Consolidated Delivery Audit': path.join(SOURCE_DIR, 'persist-consolidated-delivery-audit.js'),
  'Prepare Metrics Worker Persistence': path.join(SOURCE_DIR, 'prepare-metrics-worker-request.js'),
  'Validate Metrics Worker Persistence': path.join(SOURCE_DIR, 'validate-metrics-worker-persistence.js'),
  'Build Report History Payload': path.join(SOURCE_DIR, 'build-report-history-payload.js'),
  'Prepare Report History Persistence': path.join(SOURCE_DIR, 'prepare-report-history-request.js'),
  'Prepare Delivery History Persistence': path.join(SOURCE_DIR, 'prepare-report-history-request.js'),
  'Validate Report History Persistence': path.join(SOURCE_DIR, 'validate-report-history-persistence.js'),
  'Build Delivery History Payload': path.join(SOURCE_DIR, 'build-delivery-history-payload.js'),
  'Validate Delivery History Persistence': path.join(SOURCE_DIR, 'validate-delivery-history-persistence.js'),
};

for (const [nodeName, sourcePath] of Object.entries(codeSources)) {
  const node = workflow.nodes.find((entry) => entry.name === nodeName);
  if (!node) {
    throw new Error(`Node não encontrado: ${nodeName}`);
  }
  node.parameters.jsCode = fs.readFileSync(sourcePath, 'utf8');
}

const sendReportNode = workflow.nodes.find((entry) => entry.name === 'Send Report');
if (!sendReportNode) {
  throw new Error('Node não encontrado: Send Report');
}
sendReportNode.parameters.resource = 'messages-api';
sendReportNode.parameters.operation = 'send-image';
sendReportNode.parameters.instanceName = '={{$json.evolution_instance_name}}';
sendReportNode.parameters.remoteJid = '={{$json.evolution_remote_jid}}';
sendReportNode.parameters.media = '={{$json.evolution_media}}';
sendReportNode.parameters.caption = '={{$json.evolution_caption}}';
sendReportNode.parameters.options_message = sendReportNode.parameters.options_message || {};
delete sendReportNode.parameters.messageText;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2));
console.log('Patched workflow written to ' + outputPath);
