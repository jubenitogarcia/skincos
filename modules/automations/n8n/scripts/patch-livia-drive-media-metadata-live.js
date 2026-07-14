#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const AUTHORS = 'Codex';
const WORKFLOW_PATH = path.join(runtimePaths.workflowsDir, 'livia.active.json');
const PRIVATE_CHECKPOINT_ROOT = path.join(runtimePaths.runtimeHome, 'exports', 'livia-workflow-patches');
const TOKEN_HEALTH_SCRIPT = path.join(runtimePaths.repoRoot, 'scripts', 'livia', 'validate-publish-token-health.js').replace(/\\/g, '/');
const PUBLISH_PROGRESS_LEDGER_SCRIPT = path.join(runtimePaths.repoRoot, 'scripts', 'livia', 'publish-progress-ledger.js').replace(/\\/g, '/');

function pgClient() {
  return require('/usr/local/lib/node_modules/n8n/node_modules/pg').Client;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeJson(filePath, value, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

function sanitize(value, key = '') {
  const secretKey = /(access[_-]?token|authorization|api[_-]?key|client[_-]?secret|password|cookie)/i;
  if (typeof value === 'string') {
    if (secretKey.test(key)) return '<redacted>';
    return value.replace(/\bEAA[A-Za-z0-9]{20,}\b/g, '<redacted-meta-token>');
  }
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      secretKey.test(entryKey) ? '<redacted>' : sanitize(entryValue, entryKey),
    ]));
  }
  return value;
}

function fromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: typeof row.nodes === 'string' ? JSON.parse(row.nodes) : row.nodes,
    connections: typeof row.connections === 'string' ? JSON.parse(row.connections) : row.connections,
    settings: typeof row.settings === 'string' ? JSON.parse(row.settings || '{}') : (row.settings || {}),
    staticData: typeof row.staticData === 'string' ? JSON.parse(row.staticData || '{}') : (row.staticData || {}),
    pinData: typeof row.pinData === 'string' ? JSON.parse(row.pinData || '{}') : (row.pinData || {}),
    meta: typeof row.meta === 'string' ? JSON.parse(row.meta || '{}') : (row.meta || {}),
    description: row.description || '',
    versionId: row.versionId || '',
  };
}

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Missing workflow node: ${name}`);
  return node;
}

function patchPrepareMediaItems(source) {
  const marker = 'livia_missing_drive_mime_type';
  if (source.includes(marker)) return source;

  const anchor = 'const readyGroups = new Map();';
  if (!source.includes(anchor)) throw new Error('Prepare Media Items source changed; cannot add MIME guard safely.');
  const guard = `const unclassifiedCandidates = normalizedList.filter((row) =>
  row.id && row.postPrefix && !row.mimeType,
);
if (unclassifiedCandidates.length) {
  throw new Error(
    "livia_missing_drive_mime_type: List Files must return mimeType for scheduled media: " +
      unclassifiedCandidates.map((row) => row.name || row.id).join(", "),
  );
}
`;
  return source.replace(anchor, `${guard}${anchor}`);
}

function patchProcessHttpRequestContext(source) {
  const safeResolver = `function resolvePrepareRequestContext() {
  // HTTP Request replaces the input payload. The state lookup below is enough
  // because Livia permits only one inflight provider operation per execution.
  return asObject(incoming);
}`;
  if (source.includes('function resolvePrepareRequestContext()')) {
    const start = source.indexOf('function resolvePrepareRequestContext()');
    const end = source.indexOf('\n\nconst prepareContext = resolvePrepareRequestContext();', start);
    if (end < 0) {
      throw new Error('Process HTTP Publish Result context resolver changed; cannot remove unsafe named-node lookups.');
    }
    return `${source.slice(0, start)}${safeResolver}${source.slice(end)}`;
  }

  const anchor = `const execId = str(asObject(incoming.debug).execId, "").trim() || str($execution?.retryOf ?? $execution?.id, "noexec");
const sd = $getWorkflowStaticData("global");
sd.__pr = asObject(sd.__pr);
const state = sd.__pr[execId] = asObject(sd.__pr[execId]);
state.pending = asArray(state.pending);
state.completed = asArray(state.completed);
state.allJobs = asArray(state.allJobs);
state.byRun = asObject(state.byRun);
state.queue = asArray(state.queue);
state.inflight = asObject(state.inflight);
state.createdAt = str(state.createdAt, new Date().toISOString());
state.updatedAt = new Date().toISOString();

const inflight = asObject(state.inflight);
if (!Object.keys(inflight).length) {
  throw new Error("Process HTTP Publish Result: __pr.inflight vazio para a resposta HTTP recebida.");
}`;
  if (!source.includes(anchor)) {
    throw new Error('Process HTTP Publish Result state contract changed; cannot add request-context recovery safely.');
  }

  const replacement = `${safeResolver}

const prepareContext = resolvePrepareRequestContext();
const requestedExecId = str(asObject(prepareContext.debug).execId, "").trim() ||
  str(asObject(incoming.debug).execId, "").trim() ||
  str($execution?.retryOf ?? $execution?.id, "noexec");
const sd = $getWorkflowStaticData("global");
sd.__pr = asObject(sd.__pr);

const candidateStates = Object.entries(sd.__pr)
  .map(([key, value]) => [key, asObject(value)])
  .filter(([, value]) => Object.keys(asObject(value.inflight)).length);
const expectedRunIndex = str(prepareContext.publishRunIndex, "").trim();
const matchingStates = expectedRunIndex
  ? candidateStates.filter(([, value]) => str(asObject(value.inflight).publishRunIndex, "").trim() === expectedRunIndex)
  : [];
const requestedState = asObject(sd.__pr[requestedExecId]);
const resolvedStateKey = Object.keys(asObject(requestedState.inflight)).length
  ? requestedExecId
  : (matchingStates.length === 1 ? matchingStates[0][0] : (candidateStates.length === 1 ? candidateStates[0][0] : requestedExecId));
const state = sd.__pr[resolvedStateKey] = asObject(sd.__pr[resolvedStateKey]);
state.pending = asArray(state.pending);
state.completed = asArray(state.completed);
state.allJobs = asArray(state.allJobs);
state.byRun = asObject(state.byRun);
state.queue = asArray(state.queue);
state.inflight = asObject(state.inflight);
state.createdAt = str(state.createdAt, new Date().toISOString());
state.updatedAt = new Date().toISOString();

const execId = resolvedStateKey;
const inflight = asObject(state.inflight);
if (!Object.keys(inflight).length) {
  throw new Error(
    "Process HTTP Publish Result: __pr.inflight vazio para a resposta HTTP recebida " +
    "(requestedExecId=" + requestedExecId + ", candidateStates=" + candidateStates.length + ")."
  );
}`;
  return source.replace(anchor, replacement);
}

function patchPrepareHttpCarouselChildren(source) {
  if (source.includes('childrenPublishRunIndexes') && source.includes('ids.join(",")') && source.includes('JSON.stringify(ids)')) return source;

  if (source.includes('if (field === "children")')) {
    const legacyChild = `  if (field === "children") {
    const ids = asArray(source.childrenPublishRunIndexes)
      .map((runIndex) => extractRemoteIdFromEnvelope(getRunEnvelope(state, runIndex)))
      .filter((value) => str(value, "").trim());
    // Meta expects carousel child container ids as a comma-separated value.
    return ids.join(",");
  }`;
    const patchedChild = `  if (field === "children") {
    const ids = asArray(source.childrenPublishRunIndexes)
      .map((runIndex) => extractRemoteIdFromEnvelope(getRunEnvelope(state, runIndex)))
      .filter((value) => str(value, "").trim());
    // Threads expects a JSON array; Instagram uses a comma-separated list.
    return str(source.platform, "").trim().toLowerCase() === "threads" ? JSON.stringify(ids) : ids.join(",");
  }`;
    if (!source.includes(legacyChild)) {
      throw new Error('Prepare HTTP Publish Request has an unrecognized carousel child serializer.');
    }
    return source.replace(legacyChild, patchedChild);
  }

  const anchor = `  if (field === "attached_media") {
    const ids = asArray(source.attachedMediaFromPublishRunIndexes)
      .map((runIndex) => extractRemoteIdFromEnvelope(getRunEnvelope(state, runIndex)))
      .filter((value) => str(value, "").trim())
      .map((value) => ({ media_fbid: value }));
    return ids;
  }

  return resolveRemoteIdFromState(state, source);`;
  if (!source.includes(anchor)) {
    throw new Error('Prepare HTTP Publish Request dependency contract changed; cannot add carousel children safely.');
  }

  const replacement = `  if (field === "attached_media") {
    const ids = asArray(source.attachedMediaFromPublishRunIndexes)
      .map((runIndex) => extractRemoteIdFromEnvelope(getRunEnvelope(state, runIndex)))
      .filter((value) => str(value, "").trim())
      .map((value) => ({ media_fbid: value }));
    return ids;
  }

  if (field === "children") {
    const ids = asArray(source.childrenPublishRunIndexes)
      .map((runIndex) => extractRemoteIdFromEnvelope(getRunEnvelope(state, runIndex)))
      .filter((value) => str(value, "").trim());
    // Threads expects a JSON array; Instagram uses a comma-separated list.
    return str(source.platform, "").trim().toLowerCase() === "threads" ? JSON.stringify(ids) : ids.join(",");
  }

  return resolveRemoteIdFromState(state, source);`;
  return source.replace(anchor, replacement);
}

function tokenHealthCommand() {
  return `={{ (() => {
  const payload = $json || {};
  function sh(value) { return "'" + String(value).replace(/'/g, "'\\\\''") + "'"; }
  return "node " + sh(${JSON.stringify(TOKEN_HEALTH_SCRIPT)}) + " --payload " + sh(JSON.stringify(payload));
})() }}`;
}

function ensureTokenHealthPreflight(workflow) {
  const name = 'Validate Publish Token Health';
  let node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) {
    node = {
      id: 'livia-validate-publish-token-health',
      name,
      type: 'n8n-nodes-base.executeCommand',
      typeVersion: 1,
      position: [-11952, -672],
      parameters: { command: tokenHealthCommand() },
    };
    workflow.nodes.push(node);
  } else {
    node.type = 'n8n-nodes-base.executeCommand';
    node.typeVersion = 1;
    node.parameters = { command: tokenHealthCommand() };
  }

  workflow.connections ||= {};
  const credentialEdges = workflow.connections['Get Credential Tokens']?.main?.[0] || [];
  const retainedEdges = credentialEdges.filter((edge) => edge.node !== 'List Files' && edge.node !== name);
  workflow.connections['Get Credential Tokens'] = { main: [[...retainedEdges, { node: name, type: 'main', index: 0 }]] };
  workflow.connections[name] = { main: [[{ node: 'List Files', type: 'main', index: 0 }]] };
}

function removeTokenHealthPreflight(workflow) {
  const name = 'Validate Publish Token Health';
  workflow.nodes = workflow.nodes.filter((entry) => entry.name !== name);
  delete workflow.connections[name];
  const edges = workflow.connections['Get Credential Tokens']?.main?.[0] || [];
  const retained = edges.filter((edge) => edge.node !== name);
  if (!retained.some((edge) => edge.node === 'List Files')) {
    retained.push({ node: 'List Files', type: 'main', index: 0 });
  }
  workflow.connections['Get Credential Tokens'] = { main: [retained] };
}

function ensureManagedGatewayJsonTransport(workflow) {
  const httpRequest = nodeByName(workflow, 'HTTP Request');
  // The workflow credential is a Token Vault bearer, not a Meta access token.
  // Every real provider request must therefore flow through the Vault gateway.
  httpRequest.type = 'n8n-nodes-base.httpRequest';
  httpRequest.typeVersion = 4.2;
  httpRequest.parameters = {
    method: 'POST',
    url: `={{ $json.codexDryRun
      ? 'http://127.0.0.1:8788/meta-review/healthz'
      : (($vars.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault') + '/v1/social-publish/operations') }}`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpBearerAuth',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify($json.codexDryRun ? {} : {
      platform: $json.platform,
      unit: $json.unit,
      operation: $json.step || $json.phase,
      method: $json.method || $json.httpRequest?.method || 'POST',
      url: $json.url || $json.httpRequest?.url,
      query: $json.params || $json.query || $json.httpRequest?.query || {},
      headers: $json.requestHeaders || $json.headers || $json.httpRequest?.headers || {},
      body: ($json.requestSkipBody || $json.httpRequest?.skipBody)
        ? {}
        : ($json.requestBody || $json.jsonRequest || $json.httpRequest?.body || {})
    }) }}`,
    options: {
      timeout: 120000,
      response: { response: { neverError: true, responseFormat: 'json' } },
    },
  };
  httpRequest.credentials = {
    httpBearerAuth: { id: 'metaPublishGatewayBearer', name: 'Meta Ads Publish - Gateway Bearer' },
  };
}

function patchProcessHttpDryRun(source) {
  if (source.includes('const simulatedRemoteId =')) return source;

  const anchor = 'if (inflight.codexDryRun === true) {\n  const resultJson = removeNulls({';
  if (!source.includes(anchor)) {
    throw new Error('Process HTTP Publish Result dry-run contract changed; cannot add synthetic IDs safely.');
  }
  const withId = source.replace(
    anchor,
    `if (inflight.codexDryRun === true) {
  const simulatedRemoteId = str(inflight.remoteId, '').trim() ||
    ['codex-dry-run', str(inflight.platform, 'platform'), str(inflight.unit, 'unit'), str(inflight.publishRunIndex, '0')].join('-');
  const resultJson = removeNulls({`,
  );
  const remoteIdLine = '    remoteId: str(inflight.remoteId || inflight.publishRunIndex || "", ""),';
  if (!withId.includes(remoteIdLine)) {
    throw new Error('Process HTTP Publish Result dry-run remoteId line changed; cannot patch safely.');
  }
  const withRemoteId = withId.replace(remoteIdLine, '    remoteId: simulatedRemoteId,');
  const bodyAnchor = '      ok: true,\n      codexDryRun: true,';
  if (!withRemoteId.includes(bodyAnchor)) {
    throw new Error('Process HTTP Publish Result dry-run response body changed; cannot patch safely.');
  }
  return withRemoteId.replace(bodyAnchor, '      id: simulatedRemoteId,\n      ok: true,\n      codexDryRun: true,');
}

function patchSeedPublishStateForResume(source) {
  if (source.includes('const resumeRecords =')) return source;

  const jobAnchor = `const firstJob = __prAsObject(qaAwareJobs[0]);
if (!Object.keys(firstJob).length) {
  throw new Error("BQ - Seed Publish State: firstJob vazio.");
}`;
  if (!source.includes(jobAnchor)) {
    throw new Error('BQ - Seed Publish State contract changed; cannot add durable resume safely.');
  }
  const resumeBlock = `const rawResumeRecords = codexDryRun ? [] : __prAsArray(payload.resumeCompleted);
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
const pendingJobs = qaAwareJobs.filter((job) => !completedRunIndexes.has(__prStr(job.publishRunIndex)));
const firstJob = __prAsObject(pendingJobs[0]);
if (!Object.keys(firstJob).length) {
  throw new Error("BQ - Seed Publish State: todos os jobs deste conteúdo já foram concluídos; use o estado final para recuperação sem republicar.");
}`;
  let patched = source.replace(jobAnchor, resumeBlock);
  const stateAnchor = `state.allJobs = qaAwareJobs.slice();
state.pending = qaAwareJobs.slice(1);
state.codexDryRun = codexDryRun;`;
  if (!patched.includes(stateAnchor)) {
    throw new Error('BQ - Seed Publish State state contract changed; cannot add durable resume safely.');
  }
  patched = patched.replace(stateAnchor, `state.allJobs = qaAwareJobs.slice();
state.completed = resumeRecords.slice();
state.byRun = resumeByRun;
state.pending = pendingJobs.slice(1);
state.codexDryRun = codexDryRun;`);
  const countAnchor = `    jobCount: jobs.length,
    platformSummary: __prAsObject(payload.platformSummary),`;
  if (!patched.includes(countAnchor)) {
    throw new Error('BQ - Seed Publish State output contract changed; cannot expose resume counters safely.');
  }
  return patched.replace(countAnchor, `    jobCount: jobs.length,
    resumeCompletedCount: resumeRecords.length,
    resumePendingJobCount: pendingJobs.length,
    platformSummary: __prAsObject(payload.platformSummary),`);
}

function patchValidateJobGraphForResume(source) {
  if (source.includes('resumeCompleted: asArray(payload.resumeCompleted)')) return source;
  const anchor = `    jobs,
    jobCount: jobs.length,
    jobKinds: asArray(payload.jobKinds),`;
  if (!source.includes(anchor)) {
    throw new Error('BQ - Validate Job Graph output contract changed; cannot preserve durable resume safely.');
  }
  return source.replace(anchor, `    jobs,
    jobCount: jobs.length,
    resumeCompleted: asArray(payload.resumeCompleted),
    resumePendingJobCount: Number(payload.resumePendingJobCount || jobs.length),
    jobKinds: asArray(payload.jobKinds),`);
}

function patchProcessHttpProgressRecord(source) {
  if (source.includes('function compactResumeRecord(')) return source;
  const routeAnchor = 'function routeItem(route, stage, job) {';
  if (!source.includes(routeAnchor)) {
    throw new Error('Process HTTP Publish Result route contract changed; cannot add durable progress safely.');
  }
  const compact = `function compactResumeRecord(value) {
  const source = asObject(value);
  const media = asObject(source.media);
  const body = asObject(source.lastResponseBody);
  return removeNulls({
    groupKey: str(source.groupKey, ""),
    unit: str(source.unit, ""),
    platform: str(source.platform, ""),
    phase: str(source.phase, ""),
    step: str(source.step, ""),
    publishRunIndex: source.publishRunIndex,
    media: { id: str(media.id, ""), name: str(media.name, ""), mimeType: str(media.mimeType, "") },
    text: asObject(source.text),
    method: str(source.method, ""),
    url: str(source.url, ""),
    requestBody: asObject(source.requestBody || source.jsonRequest),
    remoteId: str(source.remoteId, ""),
    permalink: str(source.permalink, ""),
    lastStatusCode: source.lastStatusCode,
    lastResponseBody: body,
    codexDryRun: source.codexDryRun === true,
  });
}

function routeItem(route, stage, job, resumeRecord) {`;
  let patched = source.replace(routeAnchor, compact);
  const phaseAnchor = `      phase: str(json.phase, ""),
      job: route === "prepare_http" ? json : undefined,`;
  if (!patched.includes(phaseAnchor)) {
    throw new Error('Process HTTP Publish Result route output changed; cannot add progress payload safely.');
  }
  patched = patched.replace(phaseAnchor, `      phase: str(json.phase, ""),
      resumeRecord: resumeRecord ? compactResumeRecord(resumeRecord) : undefined,
      job: route === "prepare_http" ? json : undefined,`);
  patched = patched.replaceAll(
    'return [routeItem("prepare_http", "process_http_publish_result_minimal", nextJob)];',
    'return [routeItem("prepare_http", "process_http_publish_result_minimal", nextJob, resultJson)];',
  );
  patched = patched.replaceAll(
    'return [routeItem("finalize", "process_http_publish_result_minimal", resultJson)];',
    'return [routeItem("finalize", "process_http_publish_result_minimal", resultJson, resultJson)];',
  );
  return patched;
}

function patchFacebookStaticPhotoRecovery(source) {
  if (source.includes('facebook_static_photo_already_posted_recovery')) return source;
  const errorAnchor = `const apiErr = extractApiError(httpBody);
if ((Number(incoming.statusCode || 0) >= 400) || apiErr) {
  state.inflight = {};
  state.updatedAt = new Date().toISOString();
  throwHttpError(inflight, incoming, httpBody);
}`;
  if (!source.includes(errorAnchor)) throw new Error('Process HTTP Publish Result error contract changed; cannot add Facebook photo recovery safely.');
  const recovery = `const apiErr = extractApiError(httpBody);
const facebookStaticPhotoAlreadyPosted = str(inflight.platform, "").trim().toLowerCase() === "facebook" && str(inflight.step, "").trim().toLowerCase() === "default_publish" && str(apiErr?.code, "") === "100" && str(asObject(apiErr?.raw).error_subcode, "") === "1366051";
if (facebookStaticPhotoAlreadyPosted) {
  const mediaId = asArray(asObject(inflight.requestBody).attached_media).map((entry) => str(asObject(entry).media_fbid, "").trim()).find(Boolean);
  const caption = str(asObject(inflight.text).caption, "").trim();
  if (!mediaId || !caption) { state.inflight = {}; state.updatedAt = new Date().toISOString(); throw new Error("Process HTTP Publish Result: facebook_static_photo_already_posted_recovery requer media_fbid e legenda."); }
  const recoveryJob = removeNulls({ ...inflight, step: "update_static_photo_caption", url: "https://graph.facebook.com/v25.0/" + mediaId, params: {}, jsonRequest: { message: caption }, requestBody: { message: caption }, httpRequest: { method: "POST", url: "https://graph.facebook.com/v25.0/" + mediaId, query: {}, headers: {}, body: { message: caption }, skipBody: false, binary: false }, dependency: undefined, existingPhotoId: mediaId, recoveryReason: "facebook_static_photo_already_posted_recovery" });
  state.inflight = {}; state.updatedAt = new Date().toISOString();
  return [routeItem("prepare_http", "process_http_publish_result_minimal", recoveryJob)];
}
if ((Number(incoming.statusCode || 0) >= 400) || apiErr) { state.inflight = {}; state.updatedAt = new Date().toISOString(); throwHttpError(inflight, incoming, httpBody); }`;
  let patched = source.replace(errorAnchor, recovery);
  const responseAnchor = `    remoteId: str(extractIdFromAny(httpBody), ""),
    permalink: extractPermalinkAny(httpBody),
    lastStatusCode: incoming.statusCode,
    lastResponseBody: httpBody,`;
  if (!patched.includes(responseAnchor)) throw new Error('Process HTTP Publish Result provider response contract changed; cannot retain recovered Facebook photo id safely.');
  return patched.replace(responseAnchor, `    remoteId: str(inflight.existingPhotoId || extractIdFromAny(httpBody), ""),
    permalink: extractPermalinkAny(httpBody),
    lastStatusCode: incoming.statusCode,
    lastResponseBody: removeNulls({ ...asObject(httpBody), id: inflight.existingPhotoId || extractIdFromAny(httpBody) || undefined }),`);
}

function progressLedgerCommand() {
  return `={{ (() => {
  const payload = ($json && $json.resumeRecord) || {};
  function sh(value) { return "'" + String(value).replace(/'/g, "'\\\\''") + "'"; }
  return "node " + sh(${JSON.stringify(PUBLISH_PROGRESS_LEDGER_SCRIPT)}) + " --payload " + sh(JSON.stringify(payload));
})() }}`;
}

function ensurePublishProgressLedger(workflow) {
  const name = 'Record Publish Progress';
  let node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) {
    node = {
      id: 'livia-record-publish-progress',
      name,
      type: 'n8n-nodes-base.executeCommand',
      typeVersion: 1,
      position: [-4240, 1080],
      parameters: { command: progressLedgerCommand() },
    };
    workflow.nodes.push(node);
  } else {
    node.type = 'n8n-nodes-base.executeCommand';
    node.typeVersion = 1;
    node.parameters = { command: progressLedgerCommand() };
  }

  workflow.connections ||= {};
  const edges = workflow.connections['Process HTTP Publish Result']?.main?.[0] || [];
  if (!edges.some((edge) => edge.node === name)) {
    workflow.connections['Process HTTP Publish Result'] = { main: [[...edges, { node: name, type: 'main', index: 0 }]] };
  }
}

function ensureTelegramSuccessMessage(workflow) {
  const telegram = nodeByName(workflow, 'Inform Success (2)');
  telegram.parameters ||= {};
  telegram.parameters.text = `={{ (() => {
  function str(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function htmlEscape(value) {
    return str(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const base = $('Assert Drive Published').first().json.whatsappMessage || '';
  if (!str(base).trim()) throw new Error('Telegram notification message is empty after Drive verification.');
  return htmlEscape(base);
})() }}`;
}

function patchWorkflow(current) {
  const workflow = structuredClone(current);
  const listFiles = nodeByName(workflow, 'List Files');
  const prepareMedia = nodeByName(workflow, 'Prepare Media Items');
  const processHttp = nodeByName(workflow, 'Process HTTP Publish Result');
  const prepareHttp = nodeByName(workflow, 'Prepare HTTP Publish Request');
  const seedPublishState = nodeByName(workflow, 'BQ - Seed Publish State');
  const validateJobGraph = nodeByName(workflow, 'BQ - Validate Job Graph');

  listFiles.parameters.options ||= {};
  const fields = new Set(Array.isArray(listFiles.parameters.options.fields) ? listFiles.parameters.options.fields : []);
  for (const field of ['id', 'name', 'mimeType']) fields.add(field);
  listFiles.parameters.options.fields = [...fields];
  prepareMedia.parameters.jsCode = patchPrepareMediaItems(String(prepareMedia.parameters.jsCode || ''));
  prepareHttp.parameters.jsCode = patchPrepareHttpCarouselChildren(String(prepareHttp.parameters.jsCode || ''));
  processHttp.parameters.jsCode = patchProcessHttpRequestContext(String(processHttp.parameters.jsCode || ''));
  processHttp.parameters.jsCode = patchProcessHttpDryRun(String(processHttp.parameters.jsCode || ''));
  processHttp.parameters.jsCode = patchProcessHttpProgressRecord(String(processHttp.parameters.jsCode || ''));
  processHttp.parameters.jsCode = patchFacebookStaticPhotoRecovery(String(processHttp.parameters.jsCode || ''));
  seedPublishState.parameters.jsCode = patchSeedPublishStateForResume(String(seedPublishState.parameters.jsCode || ''));
  validateJobGraph.parameters.jsCode = patchValidateJobGraphForResume(String(validateJobGraph.parameters.jsCode || ''));
  // Token metadata does not prove that the encrypted provider value is usable.
  // Keep the gateway-backed preflight enabled for both legacy and vault modes.
  ensureTokenHealthPreflight(workflow);
  ensureManagedGatewayJsonTransport(workflow);
  ensurePublishProgressLedger(workflow);
  ensureTelegramSuccessMessage(workflow);
  return workflow;
}

async function main() {
  const Client = pgClient();
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || '/var/run/postgresql',
    database: process.env.PGDATABASE || 'n8n_runtime',
  });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, name, active, nodes, connections, settings, "staticData" AS "staticData", "pinData" AS "pinData", meta, description, "versionId" AS "versionId"
         FROM n8n_runtime.workflow_entity WHERE id = $1`,
      [WORKFLOW_ID],
    );
    if (!result.rows.length) throw new Error(`Workflow ${WORKFLOW_ID} not found.`);

    const current = fromRow(result.rows[0]);
    const patched = patchWorkflow(current);
    const changed = JSON.stringify(current.nodes) !== JSON.stringify(patched.nodes);
    const stamp = timestamp();
    const checkpoint = path.join(PRIVATE_CHECKPOINT_ROOT, `livia-drive-media-metadata-${stamp}`);
    writeJson(path.join(checkpoint, 'workflow-before.json'), current, 0o600);
    writeJson(path.join(checkpoint, 'workflow-after.json'), patched, 0o600);
    writeJson(WORKFLOW_PATH, sanitize(patched), 0o644);

    if (!changed) {
      console.log(JSON.stringify({ changed: false, workflowId: WORKFLOW_ID, checkpoint, workflowPath: WORKFLOW_PATH }, null, 2));
      return;
    }

    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO n8n_runtime.workflow_history
          ("versionId", "workflowId", authors, "createdAt", "updatedAt", nodes, connections, name, autosaved, description)
         VALUES ($1, $2, $3, $4, $4, $5::json, $6::json, $7, false, $8)`,
        [versionId, WORKFLOW_ID, AUTHORS, now, JSON.stringify(patched.nodes), JSON.stringify(patched.connections), patched.name, patched.description],
      );
      await client.query(
        `UPDATE n8n_runtime.workflow_entity
            SET nodes = $1::json, connections = $2::json, settings = $3::json,
                "staticData" = $4::json, meta = $5::json, "versionId" = CAST($6 AS character varying),
                "activeVersionId" = CAST($6 AS character varying), "updatedAt" = $7,
                "versionCounter" = COALESCE("versionCounter", 0) + 1
          WHERE id = $8`,
        [JSON.stringify(patched.nodes), JSON.stringify(patched.connections), JSON.stringify(patched.settings), JSON.stringify(patched.staticData), JSON.stringify(patched.meta), versionId, now, WORKFLOW_ID],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(JSON.stringify({ changed: true, workflowId: WORKFLOW_ID, previousVersionId: current.versionId, versionId, checkpoint, workflowPath: WORKFLOW_PATH }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
