#!/usr/bin/env node

'use strict';

// Patches the queue-side dependency resolver so a Facebook feed publication
// can never be prepared from a subset, duplicate, or reordered set of
// unpublished carousel children. This runs before the gateway is called.

const fs = require('fs');
const path = require('path');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const NODE_NAME = 'Prepare HTTP Publish Request';
const START_MARKER = 'function resolveDependencyValue(state, job, fieldName) {';
const END_MARKER = '\n\nfunction applyPublishDependency';

const REPLACEMENT = String.raw`function resolveDependencyValue(state, job, fieldName) {
  const source = asObject(job);
  const field = str(fieldName, "").trim();

  if (!field) return undefined;

  if (field === "creation_id") {
    return resolveRemoteIdByExplicitRunIndexes(state, [
      source.creationIdFromPublishRunIndex,
      source.checkStatusFromPublishRunIndex,
      source.statusFromPublishRunIndex,
    ]);
  }

  if (field === "video_id") {
    return resolveRemoteIdByExplicitRunIndexes(state, [
      source.reelsStartFromPublishRunIndex,
      source.checkStatusFromPublishRunIndex,
      source.lastUploadFromPublishRunIndex,
      source.statusFromPublishRunIndex,
    ]);
  }

  if (field === "attached_media") {
    const runIndexes = asArray(source.attachedMediaFromPublishRunIndexes);
    const expectedSourceIds = asArray(source.sourceMediaIds).map((value) => str(value, "").trim()).filter(Boolean);
    const expectedCount = Number(source.sourceMediaCount || 0);
    if (!expectedCount || expectedSourceIds.length !== expectedCount || runIndexes.length !== expectedCount) {
      throw new Error(
        "Prepare HTTP Publish Request: contrato Facebook attached_media incompleto " +
        "(expected=" + expectedCount + ", sourceIds=" + expectedSourceIds.length + ", runIndexes=" + runIndexes.length + ")."
      );
    }
    if (new Set(expectedSourceIds).size !== expectedSourceIds.length || new Set(runIndexes).size !== runIndexes.length) {
      throw new Error("Prepare HTTP Publish Request: contrato Facebook attached_media contém identidade duplicada.");
    }

    const allJobs = asArray(state.allJobs);
    const entries = runIndexes.map((runIndex) => {
      const producer = allJobs.find((candidate) => Number(asObject(candidate).publishRunIndex) === Number(runIndex));
      const sourceMediaId = str(asObject(asObject(producer).media).id, "").trim();
      const providerMediaId = extractRemoteIdFromEnvelope(getRunEnvelope(state, runIndex));
      return { runIndex, sourceMediaId, providerMediaId };
    });
    if (entries.some((entry) => !entry.sourceMediaId || !entry.providerMediaId)) {
      throw new Error("Prepare HTTP Publish Request: Facebook attached_media contém upload sem identidade ou provider media id.");
    }
    if (entries.map((entry) => entry.sourceMediaId).join("|") !== expectedSourceIds.join("|")) {
      throw new Error("Prepare HTTP Publish Request: Facebook attached_media perdeu a ordem ou identidade semântica do grupo.");
    }
    if (new Set(entries.map((entry) => entry.providerMediaId)).size !== entries.length) {
      throw new Error("Prepare HTTP Publish Request: Facebook attached_media recebeu provider media id duplicado.");
    }
    return entries.map((entry) => ({ media_fbid: entry.providerMediaId }));
  }

  if (field === "children") {
    const ids = asArray(source.childrenPublishRunIndexes)
      .map((runIndex) => extractRemoteIdFromEnvelope(getRunEnvelope(state, runIndex)))
      .filter((value) => str(value, "").trim());
    // Threads expects a JSON array; Instagram uses a comma-separated list.
    return str(source.platform, "").trim().toLowerCase() === "threads" ? JSON.stringify(ids) : ids.join(",");
  }

  return resolveRemoteIdFromState(state, source);
}`;

function readWorkflow(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function patchCode(code) {
  const current = String(code || '');
  const start = current.indexOf(START_MARKER);
  const end = start >= 0 ? current.indexOf(END_MARKER, start) : -1;
  if (start < 0 || end < 0) {
    throw new Error(`${NODE_NAME} does not contain the expected dependency resolver.`);
  }
  return `${current.slice(0, start)}${REPLACEMENT}${current.slice(end)}`;
}

function patchWorkflow(workflow) {
  if (workflow?.id !== WORKFLOW_ID) throw new Error(`Expected Livia workflow ${WORKFLOW_ID}.`);
  const candidate = structuredClone(workflow);
  const node = (candidate.nodes || []).find((entry) => entry?.name === NODE_NAME);
  if (!node || node.type !== 'n8n-nodes-base.code') throw new Error(`${NODE_NAME} must be a Code node.`);
  node.parameters ||= {};
  node.parameters.jsCode = patchCode(node.parameters.jsCode);
  return candidate;
}

function requiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] || '' : '';
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function main() {
  const input = requiredOption('--input');
  const output = requiredOption('--output');
  const patched = patchWorkflow(readWorkflow(input));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(patched, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(JSON.stringify({ ok: true, workflowId: patched.id, node: NODE_NAME, output }) + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || String(error));
    process.exit(1);
  }
}

module.exports = { NODE_NAME, REPLACEMENT, patchCode, patchWorkflow };
