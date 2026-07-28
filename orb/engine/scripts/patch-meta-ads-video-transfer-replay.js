#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'eFJhFg79lyaycjlm';
const VIDEO_START_NODE = 'Prepare Video Upload Starts';

function findNode(workflow, name) {
  const node = workflow?.nodes?.find((entry) => entry.name === name);
  if (!node || node.type !== 'n8n-nodes-base.code') throw new Error(`Expected Code node: ${name}`);
  return node;
}

function replaceExactly(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Video upload patch anchor missing: ${label}`);
  return source.replace(from, to);
}

function validate(workflow) {
  if (workflow?.id !== WORKFLOW_ID || workflow?.active !== false) throw new Error('Expected the inactive Meta Ads Publish workflow.');
  const code = String(findNode(workflow, VIDEO_START_NODE).parameters?.jsCode || '');
  const required = [
    'video-start:v5:',
    'checksumSha256',
    'file_checksum: checksumSha256',
    'normalizacao sem checksum SHA-256 valido',
  ];
  const missing = required.filter((value) => !code.includes(value));
  if (missing.length || code.includes('video-start:v4:')) {
    throw new Error(`Video upload replay contract is incomplete: ${[...missing, ...(code.includes('video-start:v4:') ? ['video-start:v4'] : [])].join(', ')}`);
  }
  return true;
}

function transform(workflow) {
  const candidate = structuredClone(workflow);
  if (candidate?.id !== WORKFLOW_ID || candidate?.active !== false) throw new Error('Expected the inactive Meta Ads Publish workflow.');
  const node = findNode(candidate, VIDEO_START_NODE);
  let code = String(node.parameters?.jsCode || '');
  if (code.includes('video-start:v5:')) {
    validate(candidate);
    return candidate;
  }
  code = replaceExactly(
    code,
    "const normalizedFile = text(processing.normalized_file || video.normalized_file);\n    if (!runId || !fileSize || !normalizedFile) throw new Error(`Video ${video.id} sem run_id, tamanho ou caminho normalizado.`);",
    "const normalizedFile = text(processing.normalized_file || video.normalized_file);\n    const checksumSha256 = text(processing.output_checksum_sha256 || video.output_checksum_sha256);\n    if (!runId || !fileSize || !normalizedFile) throw new Error(`Video ${video.id} sem run_id, tamanho ou caminho normalizado.`);\n    if (!/^[a-f0-9]{64}$/i.test(checksumSha256)) throw new Error(`Video ${video.id} normalizacao sem checksum SHA-256 valido.`);",
    'normalized checksum',
  );
  code = replaceExactly(
    code,
    "checksum_sha256: text(processing.output_checksum_sha256 || video.output_checksum_sha256),",
    'checksum_sha256: checksumSha256,',
    'normalized checksum output',
  );
  code = replaceExactly(
    code,
    "operation_key: `video-start:v4:${stableHash([runId, accountId, tokenId, apiVersion, video.id, sourceFingerprint, VIDEO_NORMALIZATION_CONTRACT_REVISION].map(text).join('|'))}`",
    "operation_key: `video-start:v5:${stableHash([runId, accountId, tokenId, apiVersion, video.id, sourceFingerprint, checksumSha256, fileSize, VIDEO_NORMALIZATION_CONTRACT_REVISION].map(text).join('|'))}`",
    'video start operation key',
  );
  code = replaceExactly(
    code,
    "file_checksum: text(processing.output_checksum_sha256 || video.output_checksum_sha256),",
    'file_checksum: checksumSha256,',
    'gateway file checksum',
  );
  node.parameters.jsCode = code;
  validate(candidate);
  return candidate;
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find((value) => value.startsWith('--input='))?.slice('--input='.length);
  const output = args.find((value) => value.startsWith('--output='))?.slice('--output='.length);
  if (!input || !output) throw new Error('Usage: node patch-meta-ads-video-transfer-replay.js --input=<workflow.json> --output=<workflow.json>');
  const candidate = transform(JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')));
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ workflow_id: candidate.id, patched_node: VIDEO_START_NODE, output: path.resolve(output) }));
}

if (require.main === module) main();

module.exports = { VIDEO_START_NODE, transform, validate };
