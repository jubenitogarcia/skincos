#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const runtimePaths = require('./lib/runtime-paths');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const AUTHORS = 'Codex';
const WORKFLOW_PATH = path.join(runtimePaths.workflowsDir, 'livia.active.json');
const CHECKPOINT_DIR = path.join(runtimePaths.workflowsDir, 'checkpoints');
const PRIVATE_CHECKPOINT_ROOT = path.join(runtimePaths.runtimeHome, 'exports', 'livia-workflow-patches');
const PROCESS_SCRIPT = path.join(runtimePaths.repoRoot, 'scripts', 'livia', 'process-media-asset.js')
  .replace(/\\/g, '/');
const BUILD_GRAPH_SCRIPT = path.join(runtimePaths.repoRoot, 'scripts', 'livia', 'build-platform-job-graph.js')
  .replace(/\\/g, '/');
const VERIFY_PUBLISHED_ARTIFACTS_SCRIPT = path.join(runtimePaths.repoRoot, 'scripts', 'livia', 'verify-published-artifacts.js')
  .replace(/\\/g, '/');
const DRY_RUN_URL = 'http://127.0.0.1:8788/meta-review/healthz';

function loadPgClient() {
  try {
    return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client;
  } catch {
    try {
      return require('pg').Client;
    } catch {
      throw new Error('Nao foi possivel carregar o cliente pg no runtime WSL.');
    }
  }
}

function parseJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sanitizeSharedExport(value, key = '') {
  const sensitiveKey = /(access[_-]?token|authorization|api[_-]?key|client[_-]?secret|password|signature|private[_-]?key|cookie)/i;
  if (typeof value === 'string') {
    if (sensitiveKey.test(key)) return '<redacted>';
    return value
      .replace(/\bEAA[A-Za-z0-9]{20,}\b/g, '<redacted-meta-token>')
      .replace(/(Bearer\s+)[A-Za-z0-9._~\-]{20,}/gi, '$1<redacted>');
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeSharedExport(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sensitiveKey.test(entryKey) ? '<redacted>' : sanitizeSharedExport(entryValue, entryKey),
    ]));
  }
  return value;
}

function findNode(workflow, name) {
  const node = (workflow.nodes || []).find((entry) => entry && entry.name === name);
  if (!node) throw new Error(`Node "${name}" nao encontrado.`);
  return node;
}

function optionalNode(workflow, name) {
  return (workflow.nodes || []).find((entry) => entry && entry.name === name) || null;
}

function shellQuoteExpression() {
  return `function sh(value) {
    return "'" + String(value).replace(/'/g, "'\\\\''") + "'";
  }`;
}

function buildProcessMediaCommand() {
  return `={{ (() => {
  const j = $("Download File").item.json || {};
  const inputFile = String($json.fileName || $("Write File").item.json.fileName || "");
  const payload = {
    inputFile,
    mimeType: String(j.mimeType || ""),
    name: String(j.name || ""),
    size: Number(j.size || 0),
    tmpDir: ${JSON.stringify(runtimePaths.tmpDir.replace(/\\/g, '/'))},
    executionId: String($execution?.id || Date.now()),
  };
  ${shellQuoteExpression()}
  return "node " + sh(${JSON.stringify(PROCESS_SCRIPT)}) + " --payload " + sh(JSON.stringify(payload));
})() }}`;
}

function patchPrepareMediaUploadBatch(code) {
  if (code.includes('upload blocked before Cloudinary')) return code;

  let next = replaceOnce(
    code,
    `  const processedMedia = {
    ...asObj(stdoutPayload),
    ...asObj(executeResult.processedMedia),
  };

  const sourceFilePath =`,
    `  const processedMedia = {
    ...asObj(stdoutPayload),
    ...asObj(executeResult.processedMedia),
  };
  const sourceBytes = num(processedMedia.sourceBytes, 0);
  const outputBytes = num(processedMedia.outputBytes, sourceBytes);
  const uploadEligible = processedMedia.uploadEligible !== false;
  const optimizationProfile = str(processedMedia.optimizationProfile || "", "");
  const blockReason = str(processedMedia.blockReason || "", "");

  if (!uploadEligible) {
    throw new Error(
      "Prepare Media Upload Batch: upload blocked before Cloudinary (reason=" +
        (blockReason || "media_not_upload_eligible") +
        ", sourceBytes=" + sourceBytes +
        ", outputBytes=" + outputBytes + ")."
    );
  }

  const sourceFilePath =`,
    'Prepare Media Upload Batch physical-size guard',
  );
  next = replaceOnce(
    next,
    `    optimized: Boolean(processedMedia.optimized),
    analysisApplicable: Boolean(processedMedia.analysisApplicable),`,
    `    optimized: Boolean(processedMedia.optimized),
    sourceBytes,
    outputBytes,
    uploadEligible,
    optimizationProfile,
    blockReason,
    analysisApplicable: Boolean(processedMedia.analysisApplicable),`,
    'Prepare Media Upload Batch audit fields',
  );
  next = replaceOnce(
    next,
    `      optimized: Boolean(processedMedia.optimized),
      analysisApplicable: Boolean(processedMedia.analysisApplicable),`,
    `      optimized: Boolean(processedMedia.optimized),
      sourceBytes,
      outputBytes,
      uploadEligible,
      optimizationProfile,
      blockReason,
      analysisApplicable: Boolean(processedMedia.analysisApplicable),`,
    'Prepare Media Upload Batch nested audit fields',
  );
  return next;
}

function buildPlatformJobGraphCommand() {
  return `={{ (() => {
  const payload = ($json && typeof $json === "object") ? $json : {};
  ${shellQuoteExpression()}
  return "node " + sh(${JSON.stringify(BUILD_GRAPH_SCRIPT)}) + " --payload " + sh(JSON.stringify(payload));
})() }}`;
}

function buildVerifyPublishedArtifactsCommand() {
  return `={{ (() => {
  const final = ($json && typeof $json === "object") ? $json : {};
  ${shellQuoteExpression()}
  // The verifier reads its gateway credential from the service environment. Keep
  // credential-vault data out of command lines and pass the bounded final context via stdin.
  return "printf %s " + sh(JSON.stringify({ final })) + " | node " + sh(${JSON.stringify(VERIFY_PUBLISHED_ARTIFACTS_SCRIPT)}) + " --payload -";
})() }}`;
}

function replaceOnce(text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Nao foi possivel localizar marcador para ${label}.`);
  }
  return text.replace(search, replacement);
}

function externalizeBqBuildPlatformJobGraph(workflow) {
  const buildGraph = optionalNode(workflow, 'BQ - Build Platform Job Graph');
  if (!buildGraph) return;

  buildGraph.type = 'n8n-nodes-base.executeCommand';
  buildGraph.typeVersion = 1;
  buildGraph.parameters = {
    executeOnce: false,
    command: buildPlatformJobGraphCommand(),
  };
}

function patchBqValidateStdout(code) {
  if (code.includes('rawPayload.stdout') && code.includes('JSON.parse(rawPayload.stdout)')) return code;
  return replaceOnce(
    code,
    `const payload = ($json && typeof $json === "object") ? $json : {};`,
    `const rawPayload = ($json && typeof $json === "object") ? $json : {};
const payload = (() => {
  if (typeof rawPayload.stdout === "string" && rawPayload.stdout.trim()) {
    try {
      return JSON.parse(rawPayload.stdout);
    } catch (error) {
      throw new Error("BQ - Validate Job Graph: stdout do Build Platform Job Graph nao e JSON valido: " + error.message);
    }
  }
  return rawPayload;
})();`,
    'BQ Validate stdout payload adapter',
  );
}

function patchBuildPublishQueue(code) {
  if (code.includes('LIVIA_CODEX_DRY_RUN')) return code;
  const search = `const { execId, state } = __prGetState();
__prResetState(state);
state.allJobs = builtJobs.slice();
state.pending = builtJobs.slice(1);
state.updatedAt = new Date().toISOString();

return [__prWrapPrepareHttp(builtJobs[0], state, execId, "Build Publish Queue")];`;
  const replacement = `const codexDryRun = ["1", "true", "yes"].includes(__prStr($vars.LIVIA_CODEX_DRY_RUN, "").trim().toLowerCase()) || envelope.codexDryRun === true;
const qaAwareJobs = builtJobs.map((job) => __prRemoveNulls({
  ...job,
  codexDryRun,
  qa: codexDryRun ? {
    mode: "codex-dry-run",
    source: "LIVIA_CODEX_DRY_RUN",
  } : undefined,
}));

const { execId, state } = __prGetState();
__prResetState(state);
state.allJobs = qaAwareJobs.slice();
state.pending = qaAwareJobs.slice(1);
state.codexDryRun = codexDryRun;
state.updatedAt = new Date().toISOString();

return [__prWrapPrepareHttp(qaAwareJobs[0], state, execId, "Build Publish Queue")];`;
  return replaceOnce(code, search, replacement, 'Build Publish Queue dry-run state');
}

function patchBqSeedPublishState(code) {
  if (code.includes('LIVIA_ALLOW_MANUAL_PUBLISH')) return code;

  const oldDryRunBlock = `const codexDryRun = ["1", "true", "yes"].includes(__prStr($vars.LIVIA_CODEX_DRY_RUN, "").trim().toLowerCase()) || payload.codexDryRun === true;
const qaAwareJobs = jobs.map((job) => __prRemoveNulls({
  ...job,
  codexDryRun,
  qa: codexDryRun ? {
    mode: "codex-dry-run",
    source: "LIVIA_CODEX_DRY_RUN",
  } : undefined,
}));`;
  const manualSafeDryRunBlock = `const executionMode = __prStr($execution?.mode, "").trim().toLowerCase();
const manualPublishAllowed = ["1", "true", "yes"].includes(__prStr($vars.LIVIA_ALLOW_MANUAL_PUBLISH, "").trim().toLowerCase());
const manualRunDefaultsToDryRun = executionMode === "manual" && !manualPublishAllowed;
const codexDryRun = manualRunDefaultsToDryRun || ["1", "true", "yes"].includes(__prStr($vars.LIVIA_CODEX_DRY_RUN, "").trim().toLowerCase()) || payload.codexDryRun === true;
const qaAwareJobs = jobs.map((job) => __prRemoveNulls({
  ...job,
  codexDryRun,
  qa: codexDryRun ? {
    mode: "codex-dry-run",
    source: manualRunDefaultsToDryRun ? "manual_execution_safe_default" : "LIVIA_CODEX_DRY_RUN",
  } : undefined,
}));`;
  let next = code;
  if (next.includes(oldDryRunBlock)) {
    next = replaceOnce(next, oldDryRunBlock, manualSafeDryRunBlock, 'BQ Seed manual safe dry-run');
  } else {
    next = replaceOnce(
      next,
      `const firstJob = __prAsObject(jobs[0]);`,
      `${manualSafeDryRunBlock}

const firstJob = __prAsObject(qaAwareJobs[0]);`,
      'BQ Seed manual safe dry-run decoration',
    );
  }
  if (!next.includes('state.codexDryRun = codexDryRun')) {
    next = replaceOnce(
      next,
      `state.allJobs = jobs.slice();
state.pending = jobs.slice(1);
state.updatedAt = new Date().toISOString();`,
      `state.allJobs = qaAwareJobs.slice();
state.pending = qaAwareJobs.slice(1);
state.codexDryRun = codexDryRun;
state.updatedAt = new Date().toISOString();`,
      'BQ Seed dry-run state',
    );
  }
  if (!next.includes('codexPayloadCompacted: payload.codexPayloadCompacted === true') && !next.includes('    codexDryRun,\n    firstJob,')) {
    next = replaceOnce(
      next,
      `...payload,
    firstJob,`,
      `...payload,
    codexDryRun,
    firstJob,`,
      'BQ Seed dry-run output',
    );
  }
  return next;
}

function patchPrepareHttp(code) {
  let next = code;
  if (!next.includes('if (json.codexDryRun === true) return;') && next.includes('__prAssertSafeOutboundHttpJob')) {
    next = replaceOnce(
      next,
      `function __prAssertSafeOutboundHttpJob(json) {
  const httpRequest = __prAsObject(json.httpRequest);`,
      `function __prAssertSafeOutboundHttpJob(json) {
  if (json.codexDryRun === true) return;
  const httpRequest = __prAsObject(json.httpRequest);`,
      'Prepare HTTP dry-run safe outbound bypass',
    );
  }
  if (!next.includes('if (json.codexDryRun === true) return;') && next.includes('function assertSafeOutboundHttpJob(json)')) {
    next = replaceOnce(
      next,
      `function assertSafeOutboundHttpJob(json) {
  const httpRequest = asObject(json.httpRequest);`,
      `function assertSafeOutboundHttpJob(json) {
  if (json.codexDryRun === true) return;
  const httpRequest = asObject(json.httpRequest);`,
      'Prepare HTTP modular dry-run safe outbound bypass',
    );
  }
  if (!next.includes('codex-dry-run local orb health probe')) {
    if (next.includes('const preparedJson = buildPreparedJob(state, job);')) {
      next = replaceOnce(
        next,
        `const preparedJson = buildPreparedJob(state, job);`,
        `let preparedJson = buildPreparedJob(state, job);`,
        'Prepare HTTP modular mutable prepared job',
      );
    }
    if (next.includes('runPrepareRequestLifecycle')) {
      next = replaceOnce(
        next,
        `state.inflight = preparedJson;
state.updatedAt = new Date().toISOString();

return [__prWrapWaitItem(preparedJson, state, execId)];`,
      `const codexDryRun = job.codexDryRun === true || preparedJson.codexDryRun === true || ["1", "true", "yes"].includes(__prStr($vars.LIVIA_CODEX_DRY_RUN, "").trim().toLowerCase());
if (codexDryRun) {
  preparedJson = __prRemoveNulls({
    ...preparedJson,
    codexDryRun: true,
    originalHttpRequest: preparedJson.httpRequest || {
      method: preparedJson.method,
      url: preparedJson.url,
      query: preparedJson.params,
      body: preparedJson.requestBody || preparedJson.jsonRequest,
    },
    method: "GET",
    url: ${JSON.stringify(DRY_RUN_URL)},
    params: {},
    requestHeaders: {},
    requestBody: {},
    jsonRequest: {},
    requestSkipBody: true,
    requestBinary: false,
    httpRequest: {
      method: "GET",
      url: ${JSON.stringify(DRY_RUN_URL)},
      query: {},
      headers: {},
      body: {},
      skipBody: true,
      binary: false,
    },
    qaNote: "codex-dry-run local orb health probe",
  });
}

state.inflight = preparedJson;
state.updatedAt = new Date().toISOString();

return [__prWrapWaitItem(preparedJson, state, execId)];`,
        'Prepare HTTP dry-run local request',
      );
    } else {
      next = replaceOnce(
        next,
        `assertSafeOutboundHttpJob(preparedJson);

state.inflight = removeNulls({ ...preparedJson });`,
        `const codexDryRun = job.codexDryRun === true || preparedJson.codexDryRun === true || ["1", "true", "yes"].includes(str($vars.LIVIA_CODEX_DRY_RUN, "").trim().toLowerCase());
if (codexDryRun) {
  preparedJson = removeNulls({
    ...preparedJson,
    codexDryRun: true,
    originalHttpRequest: preparedJson.httpRequest || {
      method: preparedJson.method,
      url: preparedJson.url,
      query: preparedJson.params,
      body: preparedJson.requestBody || preparedJson.jsonRequest,
    },
    method: "GET",
    url: ${JSON.stringify(DRY_RUN_URL)},
    params: {},
    requestHeaders: {},
    requestBody: {},
    jsonRequest: {},
    requestSkipBody: true,
    requestBinary: false,
    httpRequest: {
      method: "GET",
      url: ${JSON.stringify(DRY_RUN_URL)},
      query: {},
      headers: {},
      body: {},
      skipBody: true,
      binary: false,
    },
    qaNote: "codex-dry-run local orb health probe",
  });
}

assertSafeOutboundHttpJob(preparedJson);

state.inflight = removeNulls({ ...preparedJson });`,
        'Prepare HTTP modular dry-run local request',
      );
    }
  }
  return next;
}

function patchProcessHttp(code) {
  if (code.includes('codex-dry-run simulated publish result')) return code;
  if (code.includes('__prAsObject(state.inflight)')) {
    const search = `if (!Object.keys(state.inflight).length) {
  throw new Error("Process HTTP Publish Result: __pr.inflight vazio para a resposta HTTP recebida.");
}

let resultJson;`;
    const replacement = `if (!Object.keys(state.inflight).length) {
  throw new Error("Process HTTP Publish Result: __pr.inflight vazio para a resposta HTTP recebida.");
}

const inflight = __prAsObject(state.inflight);
if (inflight.codexDryRun === true) {
  const resultJson = __prRemoveNulls({
    ...inflight,
    ready: true,
    codexDryRun: true,
    statusCode: 200,
    permalink: "codex-dry-run://" + [__prStr(inflight.platform, "platform"), __prStr(inflight.phase, "phase"), __prStr(inflight.unit, "unit"), __prStr(inflight.publishRunIndex, "0")].join("/"),
    lastResponseBody: {
      ok: true,
      codexDryRun: true,
      simulated: true,
      note: "codex-dry-run simulated publish result",
    },
  });

  state.inflight = {};
  state.completed.push(resultJson);
  state.updatedAt = new Date().toISOString();

  if (state.pending.length) {
    const nextJob = state.pending.shift();
    state.updatedAt = new Date().toISOString();
    return [__prRouteItem("prepare_http", "process_http_publish_result", nextJob, state, execId)];
  }

  return [__prRouteItem("finalize", "process_http_publish_result", resultJson, state, execId)];
}

let resultJson;`;
    return replaceOnce(code, search, replacement, 'Process HTTP dry-run simulation');
  }

  const search = `const httpBody = getHttpBody(incoming);
const sanitizedEnv = sanitizeHttpEnvelope(incoming);`;
  const replacement = `if (inflight.codexDryRun === true) {
  const resultJson = removeNulls({
    ...inflight,
    ready: true,
    reason: "codex-dry-run simulated publish result",
    remoteId: str(inflight.remoteId || inflight.publishRunIndex || "", ""),
    permalink: "codex-dry-run://" + [str(inflight.platform, "platform"), str(inflight.phase, "phase"), str(inflight.unit, "unit"), str(inflight.publishRunIndex, "0")].join("/"),
    lastStatusCode: 200,
    lastResponseBody: {
      ok: true,
      codexDryRun: true,
      simulated: true,
      note: "codex-dry-run simulated publish result",
    },
  });

  state.byRun[str(inflight.publishRunIndex)] = {
    statusCode: 200,
    body: resultJson.lastResponseBody,
    codexDryRun: true,
  };
  state.inflight = {};
  state.completed.push(resultJson);
  state.updatedAt = new Date().toISOString();

  if (state.pending.length) {
    const nextJob = asObject(state.pending.shift());
    state.updatedAt = new Date().toISOString();
    if (!Object.keys(nextJob).length) {
      throw new Error("Process HTTP Publish Result: próximo job da fila veio vazio.");
    }
    return [routeItem("prepare_http", "process_http_publish_result_minimal", nextJob)];
  }

  return [routeItem("finalize", "process_http_publish_result_minimal", resultJson)];
}

const httpBody = getHttpBody(incoming);
const sanitizedEnv = sanitizeHttpEnvelope(incoming);`;
  return replaceOnce(code, search, replacement, 'Process HTTP modular dry-run simulation');
}

function patchCollect(code) {
  let next = code;
  if (!next.includes('const codexDryRun = completed.some')) {
    next = replaceOnce(
      next,
      `const finalRows = __prAsArray(buildFinalCollectorRows(completed.map((json) => ({ json }))))`,
      `const codexDryRun = completed.some((entry) => __prAsObject(entry).codexDryRun === true);
const finalRows = __prAsArray(buildFinalCollectorRows(completed.map((json) => ({ json }))))`,
      'Collect dry-run flag',
    );
  }
  if (!next.includes('codexDryRun,')) {
    next = replaceOnce(
      next,
      `...json,
        ready: true,`,
      `...json,
        codexDryRun,
        shouldNotify: codexDryRun ? false : json.shouldNotify,
        whatsappMessage: codexDryRun ? "[DRY-RUN Codex] " + __prStr(json.whatsappMessage, "") : json.whatsappMessage,
        ready: true,`,
      'Collect dry-run output fields',
    );
  }
  return next;
}

function patchCollectDeliveryVerification(code) {
  const marker = `const codexDryRun = completed.some((entry) => __prAsObject(entry).codexDryRun === true);`;
  const targetBuilder = `function buildPublishVerificationTargets(completedRows, groupKey) {
  const rows = __prAsArray(completedRows).filter((entry) => __prStr(__prAsObject(entry).groupKey, "") === __prStr(groupKey, ""));
  function mediaKindFor(platformRows, publishRow) {
    const signals = [];
    for (const row of platformRows) {
      const current = __prAsObject(row);
      const body = __prAsObject(current.requestBody || current.jsonRequest);
      signals.push(
        current.mediaKind,
        __prAsObject(current.media).mediaKind,
        current.mediaType,
        current.media_type,
        current.groupBaseMediaType,
        current.step,
        current.url,
        __prAsObject(current.httpRequest).url,
        body.media_type,
        body.image_url ? "image" : "",
        body.video_url ? "video" : "",
        body.attached_media ? "image" : ""
      );
    }
    signals.push(publishRow.mediaKind, __prAsObject(publishRow.media).mediaKind);
    const raw = signals.map((value) => __prStr(value, "").toLowerCase()).join(" ");
    if (raw.includes("carousel")) return "carousel";
    if (raw.includes("video") || raw.includes("reels") || raw.includes("reel")) return "video";
    if (raw.includes("image") || raw.includes("photo")) return "image";
    return "image";
  }
  function firstSubmitted(platformRows, keys) {
    for (const row of platformRows) {
      const body = __prAsObject(__prAsObject(row).requestBody || __prAsObject(row).jsonRequest);
      for (const key of keys) {
        if (body[key] !== undefined && body[key] !== null && __prStr(body[key], "").trim() !== "") return body[key];
      }
    }
    return "";
  }
  const targets = [];
  for (const unit of ["bss", "nh"]) {
    for (const platform of ["instagram", "facebook", "threads"]) {
      const platformRows = rows.filter((entry) =>
        __prStr(__prAsObject(entry).unit, "").toLowerCase() === unit &&
        __prStr(__prAsObject(entry).platform, "").toLowerCase() === platform
      );
      const publishRow = __prAsObject(platformRows.find((entry) => __prStr(__prAsObject(entry).phase, "").toLowerCase() === "publish"));
      if (!Object.keys(publishRow).length) continue;
      const publishBody = __prAsObject(publishRow.lastResponseBody);
      const startRow = __prAsObject(platformRows.find((entry) => __prStr(__prAsObject(entry).step, "").toLowerCase() === "reels_start"));
      const startBody = __prAsObject(startRow.lastResponseBody);
      const uploadRow = __prAsObject(platformRows.find((entry) => __prStr(__prAsObject(entry).phase, "").toLowerCase() === "upload"));
      const uploadBody = __prAsObject(uploadRow.lastResponseBody);
      const mediaKind = mediaKindFor(platformRows, publishRow);
      const publishMode = platformRows.some((entry) => __prStr(__prAsObject(entry).step, "").toLowerCase().startsWith("reels_"))
        ? "reels"
        : mediaKind === "carousel" ? "carousel" : "static";
      const providerObjectId = platform === "facebook" && publishMode === "reels"
        ? __prStr(startBody.video_id || startBody.id || publishBody.id || publishBody.post_id, "")
        : __prStr(publishBody.id || publishBody.post_id || uploadBody.post_id || uploadBody.id, "");
      const providerMediaId = platform === "facebook" && publishMode === "reels"
        ? __prStr(startBody.video_id || startBody.id, "")
        : __prStr(uploadBody.id || uploadBody.post_id, "");
      if (!providerObjectId) {
        throw new Error("Collect Publish Results: identificador final ausente para " + platform + "/" + unit + ".");
      }
      const text = __prAsObject(publishRow.text);
      targets.push({
        platform,
        unit,
        mediaKind,
        publishMode,
        providerObjectId,
        providerMediaId,
        expected: {
          caption: __prStr(text.caption || text.text, ""),
          title: __prStr(text.title, ""),
          altText: __prStr(text.alt_text || text.altText, ""),
        },
        submitted: {
          title: __prStr(firstSubmitted(platformRows, ["title"]), ""),
          altText: __prStr(firstSubmitted(platformRows, ["alt_text", "altText", "alt_text_custom"]), ""),
          coverUrl: __prStr(firstSubmitted(platformRows, ["cover_url"]), ""),
          thumbOffset: firstSubmitted(platformRows, ["thumb_offset"]),
        },
      });
    }
  }
  return targets;
}`;
  let next = code;
  if (next.includes('function buildPublishVerificationTargets')) {
    const builderStart = next.indexOf('function buildPublishVerificationTargets');
    const codexDryRunStart = next.indexOf('const codexDryRun', builderStart);
    if (builderStart < 0 || codexDryRunStart < 0) {
      throw new Error('Nao foi possivel atualizar o contrato media-aware de verificacao.');
    }
    next = `${next.slice(0, builderStart)}${targetBuilder}\n\n${next.slice(codexDryRunStart)}`;
  } else {
    next = replaceOnce(next, marker, `${targetBuilder}\n\n${marker}`, 'Collect delivery verification target builder');
  }
  if (!next.includes('publishVerification: { targets: buildPublishVerificationTargets')) {
    next = replaceOnce(
      next,
      `...json,
        codexDryRun,`,
      `...json,
        publishVerification: { targets: buildPublishVerificationTargets(completed, json.groupKey || "") },
        codexDryRun,`,
      'Collect delivery verification payload',
    );
  }
  return next;
}

function patchPrepareHttpDeliveryMetadata(code) {
  if (code.includes('body.title = title')) return code;
  return replaceOnce(
    code,
    `    if (caption) body.description = caption;
    }
  }

  return body;`,
    `    if (caption) body.description = caption;
    }
    const title = str(asObject(source.text).title, "").trim();
    if (title && !str(body.title, "").trim()) body.title = title;
  }

  return body;`,
    'Prepare HTTP Facebook title',
  );
}

function patchHydrateApiVersions(workflow) {
  const hydrate = optionalNode(workflow, 'Hydrate Publish Context');
  if (!hydrate?.parameters) return;
  hydrate.parameters = patchStringLeaves(hydrate.parameters, (text) =>
    text.replace(/version:\s*"v24\.0"/g, 'version: "v25.0"'),
  );
}

function patchLegacyGraphUrls(workflow) {
  const graphV25 = (text) => text
    .replace(/https:\/\/graph\.facebook\.com\/v24\.0/gi, 'https://graph.facebook.com/v25.0')
    .replace(/https:\/\/graph\.instagram\.com\/v24\.0/gi, 'https://graph.instagram.com/v25.0')
    .replace(/"v24\.0"/g, '"v25.0"');
  const transformed = patchStringLeaves(workflow, graphV25);
  Object.assign(workflow, transformed);
}

function patchStringLeaves(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map((entry) => patchStringLeaves(entry, transform));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = patchStringLeaves(entry, transform);
    }
    return out;
  }
  return value;
}

function patchHydrateTokenVaultContext(workflow) {
  const hydrate = optionalNode(workflow, 'Hydrate Publish Context');
  if (!hydrate?.parameters) return;

  hydrate.parameters = patchStringLeaves(hydrate.parameters, (text) => {
    if (!text.includes('function buildTokenVaultContext(root)') || text.includes('fbCredentialPurpose')) {
      return text;
    }

    return replaceOnce(
      text,
      `      if (token.provider === "facebook") {
        byUnit[unitKey].fbId = str(token.fbId || token.external_account_id, "");
        byUnit[unitKey].fbToken = str(token.fbToken || token.token, "");
      } else if (token.provider === "instagram") {`,
      `      if (token.provider === "facebook") {
        const metadata = asObj(token.metadata);
        const metaAdsPublish = asObj(metadata.meta_ads_publish);
        const isMetaAdsPublish =
          str(token.id, "").includes("meta_ads_publish") ||
          str(metadata.purpose, "") === "meta_ads_publish" ||
          Object.keys(metaAdsPublish).length > 0;
        if (isMetaAdsPublish && byUnit[unitKey].fbId) continue;

        byUnit[unitKey].fbId = str((isMetaAdsPublish && metaAdsPublish.page_id) || token.fbId || token.external_account_id, "");
        byUnit[unitKey].fbToken = str(token.fbToken || token.token, "");
        byUnit[unitKey].fbCredentialPurpose = isMetaAdsPublish ? "meta_ads_publish_fallback" : "organic_publish";
      } else if (token.provider === "instagram") {`,
      'Hydrate token vault Facebook organic credential preference',
    );
  });
}

function patchBqPayloadCompaction(workflow) {
  externalizeBqBuildPlatformJobGraph(workflow);

  const buildGraph = optionalNode(workflow, 'BQ - Build Platform Job Graph');
  if (buildGraph?.parameters?.jsCode && !buildGraph.parameters.jsCode.includes('codexPayloadCompacted: true')) {
    buildGraph.parameters.jsCode = replaceOnce(
      buildGraph.parameters.jsCode,
      `return [{
  json: __bqRemoveNulls({
    ...payload,
    jobs: builtJobs,
    jobCount: builtJobs.length,
    jobKinds,
    platformSummary,
    debug: {
      ...__bqAsObject(payload.debug),
      sourceNode: "BQ - Build Platform Job Graph",
      jobCount: builtJobs.length,
    },
  }),
}];`,
      `return [{
  json: __bqRemoveNulls({
    jobs: builtJobs,
    jobCount: builtJobs.length,
    jobKinds,
    platformSummary,
    warnings: __bqAsArray(payload.warnings).slice(0, 80),
    codexPayloadCompacted: true,
    debug: {
      ...__bqAsObject(payload.debug),
      sourceNode: "BQ - Build Platform Job Graph",
      jobCount: builtJobs.length,
      droppedPayloadKeys: ["bootstrapItems", "normalizedLiviaOutput", "normalizedCombinedMediaItems", "normalizedTokenVaultContext", "publishContexts"],
    },
  }),
}];`,
      'BQ Build Platform compact output payload',
    );
  }

  const validateGraph = optionalNode(workflow, 'BQ - Validate Job Graph');
  if (validateGraph?.parameters?.jsCode) {
    validateGraph.parameters.jsCode = patchBqValidateStdout(validateGraph.parameters.jsCode);
  }
  if (validateGraph?.parameters?.jsCode && !validateGraph.parameters.jsCode.includes('codexPayloadCompacted')) {
    validateGraph.parameters.jsCode = replaceOnce(
      validateGraph.parameters.jsCode,
      `return [{
  json: removeNulls({
    ...payload,
    validationGraphSummary: {
      jobCount: jobs.length,
      firstPublishRunIndex: runIndexes[0],
      lastPublishRunIndex: runIndexes[runIndexes.length - 1],
      publishCount: publishJobs.length,
      checkStatusCount: checkStatusJobs.length,
    },
    debug: {
      ...(asObject(payload.debug)),
      sourceNode: "BQ - Validate Job Graph",
    },
  }),
}];`,
      `return [{
  json: removeNulls({
    jobs,
    jobCount: jobs.length,
    jobKinds: asArray(payload.jobKinds),
    platformSummary: asObject(payload.platformSummary),
    warnings: asArray(payload.warnings).slice(0, 80),
    codexPayloadCompacted: payload.codexPayloadCompacted === true,
    validationGraphSummary: {
      jobCount: jobs.length,
      firstPublishRunIndex: runIndexes[0],
      lastPublishRunIndex: runIndexes[runIndexes.length - 1],
      publishCount: publishJobs.length,
      checkStatusCount: checkStatusJobs.length,
    },
    debug: {
      ...(asObject(payload.debug)),
      sourceNode: "BQ - Validate Job Graph",
    },
  }),
}];`,
      'BQ Validate compact output payload',
    );
  }

  const seed = optionalNode(workflow, 'BQ - Seed Publish State');
  if (seed?.parameters?.jsCode && !seed.parameters.jsCode.includes('codexPayloadCompacted: payload.codexPayloadCompacted === true')) {
    seed.parameters.jsCode = replaceOnce(
      seed.parameters.jsCode,
      `return [{
  json: __prRemoveNulls({
    ...payload,
    codexDryRun,
    firstJob,
    __prState: __prSnapshotState(state),
    debug: {
      ...__prAsObject(payload.debug),
      execId,
      pendingCount: __prAsArray(state.pending).length,
      completedCount: __prAsArray(state.completed).length,
      sourceNode: "BQ - Seed Publish State",
    },
  }),
}];`,
      `return [{
  json: __prRemoveNulls({
    codexDryRun,
    codexPayloadCompacted: payload.codexPayloadCompacted === true,
    jobCount: jobs.length,
    platformSummary: __prAsObject(payload.platformSummary),
    firstJob,
    __prState: __prSnapshotState(state),
    debug: {
      ...__prAsObject(payload.debug),
      execId,
      pendingCount: __prAsArray(state.pending).length,
      completedCount: __prAsArray(state.completed).length,
      sourceNode: "BQ - Seed Publish State",
    },
  }),
}];`,
      'BQ Seed compact output payload',
    );
  }
}

function patchHttpNode(node) {
  node.parameters ||= {};
  node.parameters.method = `={{ $json.codexDryRun ? "GET" : (() => { const raw = $json.method || $json.httpRequest?.method || "POST"; const method = String(raw).trim().toUpperCase(); return ["GET","POST","HEAD"].includes(method) ? method : "POST"; })() }}`;
  node.parameters.url = `={{ $json.codexDryRun ? ${JSON.stringify(DRY_RUN_URL)} : ($json.url || $json.httpRequest?.url) }}`;
  node.parameters.sendBody = `={{ $json.codexDryRun ? false : !(Boolean($json.requestSkipBody) || Boolean($json.httpRequest?.skipBody)) }}`;
  node.parameters.jsonBody = `={{ JSON.stringify($json.codexDryRun ? {} : (($json.requestSkipBody || $json.httpRequest?.skipBody) ? {} : ($json.requestBody || $json.jsonRequest || $json.httpRequest?.body || {}))) }}`;
  node.parameters.jsonHeaders = `={{ JSON.stringify($json.codexDryRun ? {} : ($json.requestHeaders || $json.httpRequest?.headers || {})) }}`;
  node.parameters.jsonQuery = `={{ JSON.stringify($json.codexDryRun ? {} : ($json.params || $json.query || $json.requestQuery || $json.httpRequest?.query || {})) }}`;
}

function patchCleanupTempFilesCommand(command) {
  if (command.includes('isAllowedCleanupDir')) return command;
  let next = String(command || '');

  next = replaceOnce(
    next,
    `try {
  fs.mkdirSync(tmpDir, { recursive: true });`,
    `function isAllowedCleanupDir(name) {
  if (!name.startsWith(base)) return false;
  const suffix = name.slice(base.length);
  return /^_[A-Za-z0-9_-]+_assets_[A-Za-z0-9_-]+$/i.test(suffix) || /^_assets_[A-Za-z0-9_-]+$/i.test(suffix);
}

try {
  fs.mkdirSync(tmpDir, { recursive: true });`,
    'Cleanup temp files asset-dir allowlist',
  );

  next = replaceOnce(
    next,
    `  const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;`,
    `  const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!isAllowedCleanupDir(entry.name)) continue;

      const fullPath = path.join(tmpDir, entry.name);
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        result.deleted.push(entry.name + "/");
      } catch (error) {
        recordFailed(entry.name + "/", error);
      }
      continue;
    }

    if (!entry.isFile()) continue;`,
    'Cleanup temp files directory removal',
  );

  return next;
}

function ensureFinalDryRunSwitch(workflow) {
  let finalSwitch = workflow.nodes.find((node) => node.name === 'Switch Final Dry Run');
  if (!finalSwitch) {
    finalSwitch = {
      parameters: {
        mode: 'expression',
        numberOutputs: 2,
        output: '={{ $json.codexDryRun === true ? 1 : 0 }}',
      },
      id: crypto.randomUUID(),
      name: 'Switch Final Dry Run',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.4,
      position: [-320, -760],
    };
    workflow.nodes.push(finalSwitch);
  }

  const ensureNode = (node) => {
    const existing = optionalNode(workflow, node.name);
    if (existing) return Object.assign(existing, node);
    workflow.nodes.push(node);
    return node;
  };

  ensureNode({
    parameters: { executeOnce: false, command: buildVerifyPublishedArtifactsCommand() },
    id: crypto.randomUUID(),
    name: 'Verify Published Artifacts',
    type: 'n8n-nodes-base.executeCommand',
    typeVersion: 1,
    position: [-7040, -480],
  });
  ensureNode({
    parameters: {
      jsCode: `const raw = String($json.stdout || "").trim();
if (!raw) throw new Error("Verify Published Artifacts returned no JSON.");
let result;
try { result = JSON.parse(raw); } catch (error) {
  throw new Error("Verify Published Artifacts returned invalid JSON: " + error.message);
}
if (result.ok !== true) {
  const errors = (result.deliveryAudit?.targets || [])
    .filter((entry) => entry.state === "failed")
    .map((entry) => entry.platform + "/" + entry.unit + ": " + (entry.errors || []).join(", "));
  throw new Error("Published artifact verification failed: " + (errors.join("; ") || "unknown failure"));
}
return [{ json: result.final || {} }];`,
    },
    id: crypto.randomUUID(),
    name: 'Attach Verified Publish Artifacts',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-6816, -480],
  });
  ensureNode({
    parameters: {
      mode: 'combine',
      combineBy: 'combineByPosition',
      options: {},
    },
    id: crypto.randomUUID(),
    name: 'Merge Drive Result and Context',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3.2,
    position: [-6592, -480],
  });
  ensureNode({
    parameters: {
      jsCode: `const update = ($json && typeof $json === "object") ? $json : {};
const properties = update.appProperties || update.properties || {};
if (String(properties.published || "").toLowerCase() !== "true") {
  throw new Error("Drive publish verification failed: appProperties.published is not true.");
}
const finalContext = {
  id: String(update.id || ""),
  name: String(update.name || ""),
  groupKey: String(update.groupKey || ""),
  whatsappMessage: String(update.whatsappMessage || ""),
  shouldNotify: update.shouldNotify === true,
  codexDryRun: update.codexDryRun === true,
};
return [{ json: { ...finalContext, driveAudit: {
  state: "verified",
  fileId: String(update.id || ""),
  published: true,
  modifiedTime: update.modifiedTime || "",
} } }];`,
    },
    id: crypto.randomUUID(),
    name: 'Assert Drive Published',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-6592, -384],
  });

  const update = findNode(workflow, 'Update File');
  update.parameters ||= {};
  update.parameters.options = { ...(update.parameters.options || {}), fields: ['*'] };
  const notify = findNode(workflow, 'Inform Success (1)');
  notify.parameters ||= {};
  notify.parameters.remoteJid = `={{ (() => {
  const phone = String($env.N8N_DEFAULT_TEST_PHONE || "").replace(/\\D/g, "");
  if (!/^\\d{12,15}$/.test(phone)) throw new Error("N8N_DEFAULT_TEST_PHONE must be a valid E.164 number.");
  return phone;
})() }}`;

  workflow.connections['Collect Publish Results'] = {
    main: [[{ node: 'Verify Published Artifacts', type: 'main', index: 0 }]],
  };
  workflow.connections['Verify Published Artifacts'] = {
    main: [[{ node: 'Attach Verified Publish Artifacts', type: 'main', index: 0 }]],
  };
  workflow.connections['Attach Verified Publish Artifacts'] = {
    main: [[{ node: 'Switch Final Dry Run', type: 'main', index: 0 }]],
  };
  workflow.connections['Switch Final Dry Run'] = {
    main: [
      [
        { node: 'Update File', type: 'main', index: 0 },
        { node: 'Merge Drive Result and Context', type: 'main', index: 0 },
      ],
      [{ node: 'Cleanup Temp Files', type: 'main', index: 0 }],
    ],
  };
  workflow.connections['Update File'] = {
    main: [[{ node: 'Merge Drive Result and Context', type: 'main', index: 1 }]],
  };
  workflow.connections['Merge Drive Result and Context'] = {
    main: [[{ node: 'Assert Drive Published', type: 'main', index: 0 }]],
  };
  workflow.connections['Assert Drive Published'] = {
    main: [[
      { node: 'Inform Success (1)', type: 'main', index: 0 },
      { node: 'Cleanup Temp Files', type: 'main', index: 0 },
    ]],
  };
}

function patchWorkflow(workflow) {
  const patched = clone(workflow);

  patchHydrateTokenVaultContext(patched);
  patchHydrateApiVersions(patched);
  patchLegacyGraphUrls(patched);

  const processMedia = findNode(patched, 'Process Media Asset');
  processMedia.parameters ||= {};
  processMedia.parameters.command = buildProcessMediaCommand();
  const prepareMediaUploadBatch = findNode(patched, 'Prepare Media Upload Batch');
  prepareMediaUploadBatch.parameters ||= {};
  prepareMediaUploadBatch.parameters.jsonOutput = patchPrepareMediaUploadBatch(
    String(prepareMediaUploadBatch.parameters.jsonOutput || ''),
  );

  const compactBuildQueue = optionalNode(patched, 'Build Publish Queue');
  if (compactBuildQueue) {
    compactBuildQueue.parameters.jsCode = patchBuildPublishQueue(compactBuildQueue.parameters.jsCode);
  } else {
    findNode(patched, 'BQ - Seed Publish State').parameters.jsCode = patchBqSeedPublishState(
      findNode(patched, 'BQ - Seed Publish State').parameters.jsCode,
    );
  }
  findNode(patched, 'Prepare HTTP Publish Request').parameters.jsCode = patchPrepareHttp(
    findNode(patched, 'Prepare HTTP Publish Request').parameters.jsCode,
  );
  findNode(patched, 'Prepare HTTP Publish Request').parameters.jsCode = patchPrepareHttpDeliveryMetadata(
    findNode(patched, 'Prepare HTTP Publish Request').parameters.jsCode,
  );
  findNode(patched, 'Process HTTP Publish Result').parameters.jsCode = patchProcessHttp(
    findNode(patched, 'Process HTTP Publish Result').parameters.jsCode,
  );
  findNode(patched, 'Collect Publish Results').parameters.jsCode = patchCollect(
    findNode(patched, 'Collect Publish Results').parameters.jsCode,
  );
  findNode(patched, 'Collect Publish Results').parameters.jsCode = patchCollectDeliveryVerification(
    findNode(patched, 'Collect Publish Results').parameters.jsCode,
  );
  patchBqPayloadCompaction(patched);
  patchHttpNode(findNode(patched, 'HTTP Request'));
  const cleanup = optionalNode(patched, 'Cleanup Temp Files');
  if (cleanup?.parameters?.command) {
    cleanup.parameters.command = patchCleanupTempFilesCommand(cleanup.parameters.command);
  }
  ensureFinalDryRunSwitch(patched);

  patched.meta = patched.meta && typeof patched.meta === 'object' ? patched.meta : {};
  patched.meta.codexQaControlPatch = {
    name: 'livia-qa-control',
    appliedAt: new Date().toISOString(),
    notes: [
      'Process Media Asset command now delegates to scripts/livia/process-media-asset.js.',
      'Media processing measures physical file size and blocks files unsafe for the simple Cloudinary upload.',
      'BQ - Build Platform Job Graph now delegates to scripts/livia/build-platform-job-graph.js.',
      'Hydrate Publish Context now prefers organic Facebook page credentials over meta_ads_publish credentials.',
      'Publication completion now requires an API readback with canonical public permalinks.',
      'Publication verification resolves image, video, and carousel provider identifiers independently.',
      'Facebook Reels receives the generated title and Instagram receives a remote selected-frame cover URL.',
      'Drive published=true is verified before WhatsApp notification is queued.',
      'LIVIA_CODEX_DRY_RUN=true simulates social HTTP publishing via local orb health.',
      'Switch Final Dry Run blocks Drive update and real notifications during dry-run.',
    ],
  };

  const nodesText = JSON.stringify(patched.nodes);
  if (!nodesText.includes('process-media-asset.js')) {
    throw new Error('Patch incompleto: Process Media Asset nao referencia o script externo.');
  }
  if (!nodesText.includes('upload blocked before Cloudinary') || !nodesText.includes('uploadEligible')) {
    throw new Error('Patch incompleto: Prepare Media Upload Batch nao bloqueia midia insegura antes do Cloudinary.');
  }
  if (!nodesText.includes('build-platform-job-graph.js')) {
    throw new Error('Patch incompleto: BQ - Build Platform Job Graph nao referencia o script externo.');
  }
  if (!nodesText.includes('fbCredentialPurpose')) {
    throw new Error('Patch incompleto: Hydrate Publish Context nao protegeu credenciais Facebook organicas.');
  }
  if (!nodesText.includes('LIVIA_CODEX_DRY_RUN')) {
    throw new Error('Patch incompleto: dry-run nao foi integrado ao workflow.');
  }
  for (const required of [
    'Verify Published Artifacts',
    'Attach Verified Publish Artifacts',
    'Assert Drive Published',
    'N8N_DEFAULT_TEST_PHONE',
    'buildPublishVerificationTargets',
    'mediaKindFor',
    'publishMode',
    'providerMediaId',
    'firstSubmitted',
  ]) {
    if (!nodesText.includes(required)) throw new Error(`Patch incompleto: contrato de entrega ausente (${required}).`);
  }
  return patched;
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    pinData: parseJson(row.pinData, {}),
    meta: parseJson(row.meta, {}),
    description: row.description || '',
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    versionCounter: Number(row.versionCounter || 0),
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
  };
}

async function patchLive() {
  const Client = loadPgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();

  try {
    const result = await client.query(
      `SELECT id, name, active, nodes, connections, settings, "staticData" AS "staticData",
              "pinData" AS "pinData", "versionId" AS "versionId",
              "activeVersionId" AS "activeVersionId", "versionCounter" AS "versionCounter",
              meta, description
         FROM n8n_runtime.workflow_entity
        WHERE id = $1`,
      [WORKFLOW_ID],
    );
    if (!result.rows.length) throw new Error(`Workflow ${WORKFLOW_ID} nao encontrado.`);

    const current = workflowFromRow(result.rows[0]);
    const patched = patchWorkflow(current);
    const timestamp = nowStamp();
    const privateCheckpointDir = path.join(PRIVATE_CHECKPOINT_ROOT, `livia-delivery-audit-${timestamp}`);
    writeJson(path.join(privateCheckpointDir, 'workflow-before.json'), current);
    writeJson(path.join(privateCheckpointDir, 'workflow-after.json'), patched);
    writeJson(WORKFLOW_PATH, sanitizeSharedExport(patched));
    const beforePath = path.join(CHECKPOINT_DIR, `livia.before-qa-control.${timestamp}.json`);
    const afterPath = path.join(CHECKPOINT_DIR, `livia.after-qa-control.${timestamp}.json`);
    writeJson(beforePath, sanitizeSharedExport(current));
    writeJson(afterPath, sanitizeSharedExport(patched));

    const changed = JSON.stringify(current.nodes) !== JSON.stringify(patched.nodes) ||
      JSON.stringify(current.connections) !== JSON.stringify(patched.connections) ||
      JSON.stringify(current.meta) !== JSON.stringify(patched.meta);

    const versionId = crypto.randomUUID();
    const updatedAt = new Date().toISOString();
    await client.query('BEGIN');
    try {
      await ensureQaVariableDefaults(client);
      if (changed) {
        await client.query(
          `INSERT INTO n8n_runtime.workflow_history
            ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes, connections, name, autosaved, description)
           VALUES ($1, $2, $3, $4, $4, $5::json, $6::json, $7, false, $8)`,
          [
            versionId,
            WORKFLOW_ID,
            AUTHORS,
            updatedAt,
            JSON.stringify(patched.nodes),
            JSON.stringify(patched.connections),
            patched.name,
            patched.description || '',
          ],
        );
        await client.query(
          `UPDATE n8n_runtime.workflow_entity
              SET nodes = $1::json,
                  connections = $2::json,
                  settings = $3::json,
                  "staticData" = $4::json,
                  meta = $5::json,
                  "versionId" = CAST($6 AS character varying),
                  "activeVersionId" = CAST($6 AS character varying),
                  "updatedAt" = $7,
                  "versionCounter" = COALESCE("versionCounter", 0) + 1
            WHERE id = $8`,
          [
            JSON.stringify(patched.nodes),
            JSON.stringify(patched.connections),
            JSON.stringify(patched.settings || {}),
            JSON.stringify(patched.staticData || {}),
            JSON.stringify(patched.meta || {}),
            versionId,
            updatedAt,
            WORKFLOW_ID,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    if (!changed) return { changed: false, beforePath, afterPath, privateCheckpointDir, versionId: current.versionId };
    return { changed: true, previousVersionId: current.versionId, versionId, beforePath, afterPath, privateCheckpointDir };
  } finally {
    await client.end();
  }
}

async function ensureQaVariableDefaults(client) {
  const project = await client.query(
    `SELECT "projectId" FROM n8n_runtime.variables WHERE "projectId" IS NOT NULL LIMIT 1`,
  );
  const projectId = project.rows[0]?.projectId || project.rows[0]?.projectid || null;
  for (const key of ['LIVIA_CODEX_DRY_RUN', 'LIVIA_ALLOW_MANUAL_PUBLISH']) {
    const existing = await client.query(
      `SELECT key FROM n8n_runtime.variables WHERE key = $1 LIMIT 1`,
      [key],
    );
    if (existing.rows.length) {
      await client.query(
        `UPDATE n8n_runtime.variables SET type = 'string', value = 'false' WHERE key = $1`,
        [key],
      );
      continue;
    }
    await client.query(
      `INSERT INTO n8n_runtime.variables (key, type, value, id, "projectId")
       VALUES ($1, 'string', 'false', $2, $3)`,
      [key, crypto.randomUUID(), projectId],
    );
  }
}

async function main() {
  const live = await patchLive();
  console.log(JSON.stringify({
    workflowId: WORKFLOW_ID,
    localWorkflowPath: WORKFLOW_PATH,
    processScript: PROCESS_SCRIPT,
    buildGraphScript: BUILD_GRAPH_SCRIPT,
    dryRunVariable: 'LIVIA_CODEX_DRY_RUN=true',
    dryRunUrl: DRY_RUN_URL,
    live,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
