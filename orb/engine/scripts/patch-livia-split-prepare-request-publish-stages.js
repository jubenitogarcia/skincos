#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(process.env.HOME, '.n8n', 'database.sqlite');
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(ROOT, 'workflows', 'livia.json'),
  path.join(ROOT, 'workflows', 'livia.active.json'),
  path.join(ROOT, 'workflows', 'livia.verify.json'),
  path.join(ROOT, 'workflows', 'livia.db-current.json'),
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: !!row.active,
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, {}),
    pinData: parseJson(row.pinData, {}),
    meta: parseJson(row.meta, {}),
    versionId: row.versionId || '',
    activeVersionId: row.activeVersionId || row.versionId || '',
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    description: row.description || null,
  };
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function maybeNode(workflow, name) {
  return workflow.nodes.find((item) => item.name === name) || null;
}

function removeNode(workflow, name) {
  workflow.nodes = workflow.nodes.filter((node) => node.name !== name);
  delete workflow.connections[name];
  for (const conn of Object.values(workflow.connections)) {
    const groups = Array.isArray(conn.main) ? conn.main : [];
    conn.main = groups.map((group) => (group || []).filter((edge) => edge.node !== name));
  }
}

function setMainConnections(connections, source, groups) {
  connections[source] ||= {};
  connections[source].main = groups.map((group) =>
    (group || []).map((connection) => ({
      node: connection.node,
      type: 'main',
      index: connection.index ?? 0,
    })),
  );
}

function buildCodeNode(name, position, jsCode) {
  return {
    parameters: { jsCode },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    id: crypto.randomUUID(),
    name,
    retryOnFail: true,
    waitBetweenTries: 5000,
  };
}

function buildSwitchNode(position) {
  return {
    parameters: {
      mode: 'expression',
      numberOutputs: 2,
      output: '={{ (() => { const route = String($json.prepareRequestRoute || "").trim().toLowerCase(); if (route === "finalize") return 1; return 0; })() }}',
    },
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.4,
    position,
    id: crypto.randomUUID(),
    name: 'Switch Publish Route',
  };
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function extractFunction(source, name) {
  const needle = `function ${name}(`;
  const start = source.indexOf(needle);
  if (start < 0) throw new Error(`Function not found in Prepare Request: ${name}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function body: ${name}`);
}

function patchBuilderSource(source) {
  return source.replace(
    /function safeNodeItems\(name\) \{[\s\S]*?\n  function cleanupExecutionStaticStores\(\) \{/,
    `function safeNodeItems(name) {
    if (name === "Attach Uploaded Main Media Metadata") {
      return staticStoreItems(getExecutionStaticStore("__liviaMainUploads"));
    }

    if (name === "Prepare Media Items") {
      return staticStoreItems(getExecutionStaticStore("__liviaCompose1"));
    }

    if (name === "Get Credential Tokens") {
      return [];
    }

    return [];
  }

  function cleanupExecutionStaticStores() {`,
  );
}

function patchLifecycleSource(source) {
  return source.replace(
    /\/\/ IMPORTANTE PARA TOPOLOGIA[\s\S]*?\/\/ ======================================================/,
    `// Topologia atual:
  // Hydrate Publish Context -> Build Publish Queue -> Switch Publish Route
  // -> Prepare HTTP Publish Request -> Wait -> HTTP Request -> Process HTTP Publish Result
  // -> Switch Publish Route -> Collect Publish Results
  //
  // ======================================================`,
  );
}

function buildHydrateCode() {
  return `const inputItems = (() => {
  try {
    if ($input && typeof $input.all === "function") return $input.all() || [];
  } catch {}
  return ($json && typeof $json === "object") ? [{ json: $json }] : [];
})();

function str(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function asObj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function removeNulls(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => removeNulls(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = removeNulls(entry);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  if (value === null) return undefined;
  return value;
}

function pushUnique(arr, msg) {
  if (!msg) return;
  if (!arr.includes(msg)) arr.push(msg);
}

function storeItems(storeName) {
  const execId = str($execution?.id, "noexec");
  const sd = $getWorkflowStaticData("global");
  const root = asObj(asObj(sd[storeName])[execId]);
  const direct = asArray(root.__items)
    .map((item) => asObj((item && item.json) || item))
    .filter((item) => Object.keys(item).length);

  if (direct.length) return direct;

  const out = [];
  const seen = new Set();
  for (const [key, value] of Object.entries(root)) {
    if (key === "__items") continue;
    const json = asObj(value);
    if (!Object.keys(json).length) continue;
    const dedupeKey = [
      str(json.id || json.mediaId || json.public_id, ""),
      str(json.name || json.fileName || json.thumbPath, ""),
      str(json.secure_url || json.url || json.finalUrl, ""),
      key,
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(json);
  }
  return out;
}

function normalizeTokenVaultUnit(raw) {
  const compact = str(raw, "")
    .trim()
    .toUpperCase()
    .replace(/\\s+/g, "")
    .replace(/[_-]/g, "");
  if (compact.includes("BARRA") && compact.includes("SUL")) return "bss";
  if (compact === "BARRASHOPPINGSUL" || compact === "BSS") return "bss";
  if (compact.includes("NOVO") && compact.includes("HAMBURGO")) return "nh";
  if (compact === "NOVOHAMBURGO" || compact === "NH") return "nh";
  return "";
}

function buildTokenVaultContext(root) {
  const tokenRoot = asObj(root);
  const tokens = asArray(tokenRoot.items);
  const byUnit = {
    bss: { Unit: "BSS" },
    nh: { Unit: "NH" },
  };

  for (const token of tokens) {
    if (!token || token.active === false) continue;
    const unitKey = normalizeTokenVaultUnit(token.unit || asObj(token.metadata).legacy_columns?.Unit || "");
    if (!unitKey || !byUnit[unitKey]) continue;

    if (token.provider === "facebook") {
      byUnit[unitKey].fbId = str(token.fbId || token.external_account_id, "");
      byUnit[unitKey].fbToken = str(token.fbToken || token.token, "");
    } else if (token.provider === "instagram") {
      byUnit[unitKey].igId = str(token.igId || token.external_account_id, "");
      byUnit[unitKey].igToken = str(token.igToken || token.token, "");
    } else if (token.provider === "threads") {
      byUnit[unitKey].thId = str(token.thId || token.external_account_id, "");
      byUnit[unitKey].thToken = str(token.thToken || token.token, "");
    }
  }

  return {
    raw: tokenRoot,
    facebook: {
      network: "facebook.com",
      version: "v24.0",
      id_bss: str(byUnit.bss.fbId, ""),
      id_nh: str(byUnit.nh.fbId, ""),
      token_bss: str(byUnit.bss.fbToken, ""),
      token_nh: str(byUnit.nh.fbToken, ""),
      endpoint_1st: "",
      endpoint_2nd: "feed",
    },
    instagram: {
      network: "facebook.com",
      version: "v24.0",
      id_bss: str(byUnit.bss.igId, ""),
      id_nh: str(byUnit.nh.igId, ""),
      token_bss: str(byUnit.bss.igToken, ""),
      token_nh: str(byUnit.nh.igToken, ""),
      endpoint_1st: "media",
      endpoint_2nd: "media_publish",
    },
    threads: {
      network: "threads.net",
      version: "v1.0",
      id_bss: str(byUnit.bss.thId, ""),
      id_nh: str(byUnit.nh.thId, ""),
      token_bss: str(byUnit.bss.thToken, ""),
      token_nh: str(byUnit.nh.thToken, ""),
      endpoint_1st: "threads",
      endpoint_2nd: "threads_publish",
      use_me: true,
    },
  };
}

function dedupeItems(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const json = slimMediaItem(asObj(item));
    if (!Object.keys(json).length) continue;
    const key = [
      str(json.id || json.public_id || "", ""),
      str(json.groupKey || "", ""),
      str(json.name || json.original_filename || json.display_name || "", ""),
      str(json.finalUrl || json.secure_url || json.url || "", ""),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(json);
  }
  return out;
}

function slimMediaItem(item) {
  const json = asObj(item);
  const keys = [
    "id",
    "name",
    "mimeType",
    "groupKey",
    "groupOrder",
    "publishTime",
    "quantity",
    "finalUrl",
    "mainMedia",
    "facebook",
    "instagram",
    "threads",
    "frameCandidates",
    "technicalFrameCandidates",
    "bestFrame",
    "warnings",
    "resource_type",
    "format",
    "secure_url",
    "url",
    "public_id",
    "original_filename",
    "display_name",
    "width",
    "height",
    "duration",
    "bytes",
    "groupBaseMediaType",
    "groupIsVideo",
    "groupIsHomogeneous",
    "groupHasMixedMedia",
    "media_type",
    "media_type_instagram",
    "media_type_1st_requisition",
    "edge",
  ];
  const out = {};
  for (const key of keys) {
    if (json[key] !== undefined) out[key] = json[key];
  }
  return out;
}

if (!inputItems.length) {
  return [];
}

const warnings = [];
const liviaOutput = inputItems
  .map((item) => asObj(item.json))
  .filter((json) => Object.keys(json).length);

const staticCombinedMediaItems = storeItems("__liviaMainUploads");

let pairedAttachJson = {};
if (!staticCombinedMediaItems.length) {
  try {
    const paired = $("Attach Uploaded Main Media Metadata").item;
    pairedAttachJson = asObj((paired && paired.json) || paired);
  } catch {}
}

const combinedMediaItems = dedupeItems([
  ...staticCombinedMediaItems,
  ...(
    Object.keys(pairedAttachJson).length
      ? [pairedAttachJson]
      : []
  ),
]);

if (staticCombinedMediaItems.length) {
  pushUnique(warnings, "hydrate_publish_context_combined_media_from_static_store");
} else if (Object.keys(pairedAttachJson).length) {
  pushUnique(warnings, "hydrate_publish_context_combined_media_from_paired_lookup");
}

if (!combinedMediaItems.length) {
  throw new Error("Hydrate Publish Context: nenhuma mídia combinada encontrada em __liviaMainUploads nem no lookup pareado de Attach Uploaded Main Media Metadata.");
}

let tokenFirst = {};
try {
  const first = $("Get Credential Tokens").first();
  tokenFirst = asObj((first && first.json) || first);
} catch {}

return [{
  json: removeNulls({
    prepareRequestStage: "hydrate_publish_context",
    liviaOutput,
    combinedMediaItems,
    tokenVaultContext: buildTokenVaultContext(tokenFirst),
    warnings,
    debug: {
      execId: str($execution?.id, "noexec"),
      pendingCount: 0,
      completedCount: 0,
      sourceNode: "Hydrate Publish Context",
      liviaItemCount: liviaOutput.length,
      combinedMediaCount: combinedMediaItems.length,
    },
  }),
}];
`;
}

function buildBuildQueueCode(builderSource) {
  return [
    '// ======================================================',
    '// BUILD PUBLISH QUEUE',
    '// - recebe envelope hidratado sem binários',
    '// - monta a fila completa de jobs de publish',
    '// - inicializa staticData.__pr e emite o primeiro job',
    '// ======================================================',
    patchBuilderSource(builderSource),
    `
function __prStr(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function __prAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function __prAsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function __prRemoveNulls(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => __prRemoveNulls(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = __prRemoveNulls(entry);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  if (value === null) return undefined;
  return value;
}

function __prPushUnique(arr, msg) {
  if (!msg) return;
  if (!arr.includes(msg)) arr.push(msg);
}

function __prGetState() {
  const execId = __prStr($execution?.id, "noexec");
  const sd = $getWorkflowStaticData("global");
  sd.__pr = __prAsObject(sd.__pr);

  for (const key of Object.keys(sd.__pr)) {
    if (key !== execId) delete sd.__pr[key];
  }

  const state = sd.__pr[execId] = __prAsObject(sd.__pr[execId]);
  state.pending = __prAsArray(state.pending);
  state.queue = __prAsArray(state.queue);
  state.completed = __prAsArray(state.completed);
  state.allJobs = __prAsArray(state.allJobs);
  state.byRun = __prAsObject(state.byRun);
  state.inflight = __prAsObject(state.inflight);
  state.createdAt = __prStr(state.createdAt, new Date().toISOString());
  state.updatedAt = new Date().toISOString();
  return { execId, sd, state };
}

function __prResetState(state) {
  state.pending = [];
  state.queue = [];
  state.completed = [];
  state.allJobs = [];
  state.byRun = {};
  state.inflight = {};
  state.createdAt = new Date().toISOString();
  state.updatedAt = state.createdAt;
}

function __prMergePlatformContext(item, tokenVaultContext) {
  const json = __prAsObject(item);
  const ctx = __prAsObject(tokenVaultContext);
  const warnings = __prAsArray(json.warnings).slice();

  const merged = {
    ...json,
    facebook: Object.keys(__prAsObject(json.facebook)).length ? json.facebook : __prAsObject(ctx.facebook),
    instagram: Object.keys(__prAsObject(json.instagram)).length ? json.instagram : __prAsObject(ctx.instagram),
    threads: Object.keys(__prAsObject(json.threads)).length ? json.threads : __prAsObject(ctx.threads),
    warnings,
  };

  if (!Object.keys(__prAsObject(json.facebook)).length || !Object.keys(__prAsObject(json.instagram)).length || !Object.keys(__prAsObject(json.threads)).length) {
    __prPushUnique(warnings, "build_publish_queue_platform_context_filled_from_token_vault");
  }

  return __prRemoveNulls(merged);
}

function __prBuildBootstrapItems(envelope) {
  const liviaItems = __prAsArray(envelope.liviaOutput)
    .map((json) => ({ json: __prAsObject(json) }))
    .filter((item) => Object.keys(item.json).length);

  const combinedItems = __prAsArray(envelope.combinedMediaItems)
    .map((json) => ({ json: __prMergePlatformContext(json, envelope.tokenVaultContext) }))
    .filter((item) => Object.keys(item.json).length);

  return [...liviaItems, ...combinedItems];
}

function __prWrapPrepareHttp(job, state, execId, sourceNode) {
  const json = __prAsObject(job);
  return {
    json: __prRemoveNulls({
      prepareRequestRoute: "prepare_http",
      prepareRequestStage: "build_publish_queue",
      publishRunIndex: json.publishRunIndex,
      groupKey: __prStr(json.groupKey, ""),
      platform: __prStr(json.platform, ""),
      phase: __prStr(json.phase, ""),
      job: json,
      debug: {
        execId,
        pendingCount: __prAsArray(state.pending).length,
        completedCount: __prAsArray(state.completed).length,
        sourceNode,
      },
    }),
  };
}

const items = (() => {
  try {
    if ($input && typeof $input.all === "function") return $input.all() || [];
  } catch {}
  return ($json && typeof $json === "object") ? [{ json: $json }] : [];
})();

if (!items.length) {
  return [];
}

const envelope = __prAsObject(items[0].json);
const bootstrapItems = __prBuildBootstrapItems(envelope);
const builtJobs = __prAsArray(buildPublishJobsFromLiviaInput(bootstrapItems))
  .map((item) => __prAsObject(item && item.json))
  .filter((job) => Object.keys(job).length);

if (!builtJobs.length) {
  throw new Error("Build Publish Queue: buildPublishJobsFromLiviaInput não produziu jobs de publish.");
}

const { execId, state } = __prGetState();
__prResetState(state);
state.allJobs = builtJobs.slice();
state.pending = builtJobs.slice(1);
state.updatedAt = new Date().toISOString();

return [__prWrapPrepareHttp(builtJobs[0], state, execId, "Build Publish Queue")];
`,
  ].join('\n\n');
}

function buildPrepareHttpCode(lifecycleSource) {
  return [
    '// ======================================================',
    '// PREPARE HTTP PUBLISH REQUEST',
    '// - recebe job bare ou job já preparado para repoll/retry',
    '// - marca inflight em __pr e entrega item de espera para o HTTP Request',
    '// ======================================================',
    patchLifecycleSource(lifecycleSource),
    `
function __prStr(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function __prAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function __prAsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function __prRemoveNulls(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => __prRemoveNulls(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = __prRemoveNulls(entry);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  if (value === null) return undefined;
  return value;
}

function __prAllowedOutboundHost(hostname) {
  const host = __prStr(hostname, "").trim().toLowerCase();
  return (
    host === "graph.facebook.com" ||
    host === "graph.instagram.com" ||
    host === "graph.threads.net" ||
    host === "rupload.facebook.com" ||
    host === "res.cloudinary.com" ||
    host === "cloudinary.com" ||
    host.endsWith(".cloudinary.com")
  );
}

function __prAssertSafeOutboundHttpJob(json) {
  const httpRequest = __prAsObject(json.httpRequest);
  const url = __prStr(json.url, "").trim() || __prStr(httpRequest.url, "").trim();
  const method = (__prStr(json.method, "").trim() || __prStr(httpRequest.method, "").trim() || "POST").toUpperCase();

  if (!url) throw new Error("Prepare HTTP Publish Request: URL externa vazia.");
  if (!["GET", "POST", "HEAD"].includes(method)) {
    throw new Error("Prepare HTTP Publish Request: método HTTP não permitido (" + method + ").");
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Prepare HTTP Publish Request: URL externa inválida (" + url + ").");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Prepare HTTP Publish Request: protocolo inseguro (" + parsed.protocol + ").");
  }

  if (!__prAllowedOutboundHost(parsed.hostname)) {
    throw new Error("Prepare HTTP Publish Request: host não permitido (" + parsed.hostname + ").");
  }
}

function __prGetState() {
  const execId = __prStr($execution?.id, "noexec");
  const sd = $getWorkflowStaticData("global");
  sd.__pr = __prAsObject(sd.__pr);
  const state = sd.__pr[execId] = __prAsObject(sd.__pr[execId]);
  state.pending = __prAsArray(state.pending);
  state.queue = __prAsArray(state.queue);
  state.completed = __prAsArray(state.completed);
  state.allJobs = __prAsArray(state.allJobs);
  state.byRun = __prAsObject(state.byRun);
  state.inflight = __prAsObject(state.inflight);
  state.createdAt = __prStr(state.createdAt, new Date().toISOString());
  state.updatedAt = new Date().toISOString();
  return { execId, state };
}

function __prWrapWaitItem(json, state, execId) {
  const out = __prRemoveNulls({
    ...json,
    prepareRequestRoute: "wait",
    prepareRequestStage: "prepare_http_publish_request",
    ready: false,
    debug: {
      execId,
      pendingCount: state.pending.length,
      completedCount: state.completed.length,
      sourceNode: "Prepare HTTP Publish Request",
    },
  });
  __prAssertSafeOutboundHttpJob(out);
  return { json: out };
}

function __prIsPreparedJob(job) {
  const json = __prAsObject(job);
  return !!(
    __prAsObject(json.httpRequest).url ||
    (__prStr(json.url, "").trim() && __prStr(json.method, "").trim())
  );
}

const items = (() => {
  try {
    if ($input && typeof $input.all === "function") return $input.all() || [];
  } catch {}
  return ($json && typeof $json === "object") ? [{ json: $json }] : [];
})();

if (!items.length) {
  return [];
}

const payload = __prAsObject(items[0].json);
if (__prStr(payload.prepareRequestRoute, "").toLowerCase() !== "prepare_http") {
  throw new Error("Prepare HTTP Publish Request: prepareRequestRoute inválido (" + __prStr(payload.prepareRequestRoute, "n/a") + ").");
}

const job = __prAsObject(payload.job);
if (!Object.keys(job).length) {
  throw new Error("Prepare HTTP Publish Request: item sem job para preparar.");
}

const { execId, state } = __prGetState();
if (Object.keys(state.inflight).length) {
  throw new Error("Prepare HTTP Publish Request: inflight anterior ainda presente em __pr.");
}

let preparedJson;

try {
  if (__prIsPreparedJob(job)) {
    preparedJson = __prRemoveNulls(job);
  } else {
    const preparedItems = __prAsArray(runPrepareRequestLifecycle(job, [{ json: job }]));
    preparedJson = __prAsObject(preparedItems[0] && preparedItems[0].json);
  }
} catch (error) {
  throw new Error("Prepare HTTP Publish Request: " + error.message);
}

if (!Object.keys(preparedJson).length) {
  throw new Error("Prepare HTTP Publish Request: runPrepareRequestLifecycle não devolveu request válido.");
}

state.inflight = preparedJson;
state.updatedAt = new Date().toISOString();

return [__prWrapWaitItem(preparedJson, state, execId)];
`,
  ].join('\n\n');
}

function buildProcessHttpCode(lifecycleSource) {
  return [
    '// ======================================================',
    '// PROCESS HTTP PUBLISH RESULT',
    '// - consome o fullResponse do HTTP Request',
    '// - atualiza byRun/completed/inflight',
    '// - emite próximo prepare_http ou gatilho finalize',
    '// ======================================================',
    patchLifecycleSource(lifecycleSource),
    `
function __prStr(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function __prAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function __prAsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function __prRemoveNulls(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => __prRemoveNulls(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = __prRemoveNulls(entry);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  if (value === null) return undefined;
  return value;
}

function __prGetState() {
  const execId = __prStr($execution?.id, "noexec");
  const sd = $getWorkflowStaticData("global");
  sd.__pr = __prAsObject(sd.__pr);
  const state = sd.__pr[execId] = __prAsObject(sd.__pr[execId]);
  state.pending = __prAsArray(state.pending);
  state.queue = __prAsArray(state.queue);
  state.completed = __prAsArray(state.completed);
  state.allJobs = __prAsArray(state.allJobs);
  state.byRun = __prAsObject(state.byRun);
  state.inflight = __prAsObject(state.inflight);
  state.createdAt = __prStr(state.createdAt, new Date().toISOString());
  state.updatedAt = new Date().toISOString();
  return { execId, state };
}

function __prRouteItem(route, stage, job, state, execId) {
  const json = __prAsObject(job);
  return {
    json: __prRemoveNulls({
      prepareRequestRoute: route,
      prepareRequestStage: stage,
      publishRunIndex: json.publishRunIndex,
      groupKey: __prStr(json.groupKey, ""),
      platform: __prStr(json.platform, ""),
      phase: __prStr(json.phase, ""),
      job: route === "prepare_http" ? json : undefined,
      debug: {
        execId,
        pendingCount: state.pending.length,
        completedCount: state.completed.length,
        sourceNode: "Process HTTP Publish Result",
      },
    }),
  };
}

const inputItems = (() => {
  try {
    if ($input && typeof $input.all === "function") return $input.all() || [];
  } catch {}
  return ($json && typeof $json === "object") ? [{ json: $json }] : [];
})();

if (!inputItems.length) {
  return [];
}

const incoming = __prAsObject(inputItems[0].json);
const { execId, state } = __prGetState();

if (!Object.keys(state.inflight).length) {
  throw new Error("Process HTTP Publish Result: __pr.inflight vazio para a resposta HTTP recebida.");
}

let resultJson;
try {
  const resultItems = __prAsArray(runPrepareRequestLifecycle(incoming, inputItems));
  resultJson = __prAsObject(resultItems[0] && resultItems[0].json);
} catch (error) {
  throw new Error("Process HTTP Publish Result: " + error.message);
}

state.inflight = {};
state.updatedAt = new Date().toISOString();

if (!Object.keys(resultJson).length) {
  throw new Error("Process HTTP Publish Result: runPrepareRequestLifecycle não devolveu resultado útil.");
}

if (resultJson.ready !== true) {
  return [__prRouteItem("prepare_http", "process_http_publish_result", resultJson, state, execId)];
}

state.completed.push(resultJson);
state.updatedAt = new Date().toISOString();

if (state.pending.length) {
  const nextJob = state.pending.shift();
  state.updatedAt = new Date().toISOString();
  return [__prRouteItem("prepare_http", "process_http_publish_result", nextJob, state, execId)];
}

return [__prRouteItem("finalize", "process_http_publish_result", resultJson, state, execId)];
`,
  ].join('\n\n');
}

function buildCollectCode(collectorSource) {
  return [
    '// ======================================================',
    '// COLLECT PUBLISH RESULTS',
    '// - consolida state.completed',
    '// - emite o contrato final atual para notificações e update do Drive',
    '// - limpa __pr ao final',
    '// ======================================================',
    collectorSource,
    `
function __prStr(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function __prAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function __prAsObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function __prRemoveNulls(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => __prRemoveNulls(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = __prRemoveNulls(entry);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  if (value === null) return undefined;
  return value;
}

const execId = __prStr($execution?.id, "noexec");
const sd = $getWorkflowStaticData("global");
sd.__pr = __prAsObject(sd.__pr);
const state = __prAsObject(sd.__pr[execId]);
const completed = __prAsArray(state.completed);

if (!completed.length) {
  throw new Error("Collect Publish Results: __pr.completed vazio na fase de finalização.");
}

const finalRows = __prAsArray(buildFinalCollectorRows(completed.map((json) => ({ json }))))
  .map((item) => {
    const json = __prAsObject(item && item.json);
    return {
      json: __prRemoveNulls({
        ...json,
        ready: true,
        stage: "final",
        prepareRequestRoute: "finalize",
        prepareRequestStage: "collect_publish_results",
        debug: {
          execId,
          pendingCount: 0,
          completedCount: completed.length,
          sourceNode: "Collect Publish Results",
        },
      }),
    };
  });

delete sd.__pr[execId];

return finalRows;
`,
  ].join('\n\n');
}

function patchWorkflow(workflow) {
  const sourceCode = [
    maybeNode(workflow, 'Prepare Request')?.parameters?.jsCode,
    maybeNode(workflow, 'Build Publish Queue')?.parameters?.jsCode,
    maybeNode(workflow, 'Prepare HTTP Publish Request')?.parameters?.jsCode,
    maybeNode(workflow, 'Process HTTP Publish Result')?.parameters?.jsCode,
    maybeNode(workflow, 'Collect Publish Results')?.parameters?.jsCode,
  ]
    .filter(Boolean)
    .join('\n\n');

  assert(sourceCode, 'Could not find publish-stage source code in the current workflow');

  const buildPublishJobsSource = extractFunction(sourceCode, 'buildPublishJobsFromLiviaInput');
  const lifecycleSource = extractFunction(sourceCode, 'runPrepareRequestLifecycle');
  const collectorSource = extractFunction(sourceCode, 'buildFinalCollectorRows');

  const preparePosition = firstDefined(
    maybeNode(workflow, 'Prepare Request')?.position,
    maybeNode(workflow, 'Build Publish Queue')?.position,
    [-9632, -392],
  );
  const ifPosition = firstDefined(
    maybeNode(workflow, 'If')?.position,
    maybeNode(workflow, 'Switch Publish Route')?.position,
    [-9408, -560],
  );
  const waitNode = getNode(workflow, 'Wait');
  const httpNode = getNode(workflow, 'HTTP Request');
  const liviaNode = getNode(workflow, 'Livia');

  removeNode(workflow, 'Prepare Request');
  removeNode(workflow, 'If');
  removeNode(workflow, 'Schedule Trigger');
  removeNode(workflow, 'Trigger Schedule');
  removeNode(workflow, 'Hydrate Publish Context');
  removeNode(workflow, 'Build Publish Queue');
  removeNode(workflow, 'Switch Publish Route');
  removeNode(workflow, 'Prepare HTTP Publish Request');
  removeNode(workflow, 'Process HTTP Publish Result');
  removeNode(workflow, 'Collect Publish Results');

  const hydrateNode = buildCodeNode(
    'Hydrate Publish Context',
    [preparePosition[0] - 280, liviaNode.position?.[1] ?? preparePosition[1]],
    buildHydrateCode(),
  );
  const buildQueueNode = buildCodeNode(
    'Build Publish Queue',
    [preparePosition[0] - 28, preparePosition[1]],
    buildBuildQueueCode(buildPublishJobsSource),
  );
  const switchNode = buildSwitchNode(
    [ifPosition[0], preparePosition[1]],
  );
  const prepareHttpNode = buildCodeNode(
    'Prepare HTTP Publish Request',
    [waitNode.position?.[0] - 260 || -9440, waitNode.position?.[1] || -272],
    buildPrepareHttpCode(lifecycleSource),
  );
  const processHttpNode = buildCodeNode(
    'Process HTTP Publish Result',
    [httpNode.position?.[0] + 264 || -8696, httpNode.position?.[1] || -200],
    buildProcessHttpCode(lifecycleSource),
  );
  const collectNode = buildCodeNode(
    'Collect Publish Results',
    [ifPosition[0] - 32, ifPosition[1]],
    buildCollectCode(collectorSource),
  );

  workflow.nodes.push(
    hydrateNode,
    buildQueueNode,
    switchNode,
    prepareHttpNode,
    processHttpNode,
    collectNode,
  );

  setMainConnections(workflow.connections, 'Livia', [
    [{ node: 'Hydrate Publish Context', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Hydrate Publish Context', [
    [{ node: 'Build Publish Queue', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Build Publish Queue', [
    [{ node: 'Switch Publish Route', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Switch Publish Route', [
    [{ node: 'Prepare HTTP Publish Request', index: 0 }],
    [{ node: 'Collect Publish Results', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Prepare HTTP Publish Request', [
    [{ node: 'Wait', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Wait', [
    [{ node: 'HTTP Request', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'HTTP Request', [
    [{ node: 'Process HTTP Publish Result', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Process HTTP Publish Result', [
    [{ node: 'Switch Publish Route', index: 0 }],
  ]);
  setMainConnections(workflow.connections, 'Collect Publish Results', [
    [
      { node: 'Inform Success (1)', index: 0 },
      { node: 'Update File', index: 0 },
      { node: 'Cleanup Temp Files', index: 0 },
    ],
  ]);

  for (const key of Object.keys(workflow.staticData || {})) {
    if (key === 'node:Schedule Trigger' || key === 'node:Schedule Trigger1' || key === 'node:Trigger Schedule') {
      delete workflow.staticData[key];
    }
  }

  return workflow;
}

const db = new Database(DB_PATH);
const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
assert(row, `Workflow not found: ${WORKFLOW_ID}`);

const before = workflowFromRow(row);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const backupPath = path.join(ROOT, 'workflows', `livia.before-split-prepare-request-publish-stages.${stamp}.json`);
writeJson(backupPath, before);

const workflow = patchWorkflow(workflowFromRow(row));
const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-split-prepare-request-publish-stages',
    appliedAt: new Date().toISOString(),
    previousVersionId: row.versionId,
    removedNodes: ['Prepare Request', 'If'],
    addedNodes: [
      'Hydrate Publish Context',
      'Build Publish Queue',
      'Switch Publish Route',
      'Prepare HTTP Publish Request',
      'Process HTTP Publish Result',
      'Collect Publish Results',
    ],
  },
};

workflow.versionId = versionId;
workflow.activeVersionId = versionId;
workflow.meta = meta;

const nodesJson = JSON.stringify(workflow.nodes);
const connectionsJson = JSON.stringify(workflow.connections);
const metaJson = JSON.stringify(meta);
const staticDataJson = JSON.stringify(workflow.staticData || {});

const insertHistory = db.prepare(`
  insert into workflow_history
    (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
  values
    (@versionId, @workflowId, @authors, @createdAt, @updatedAt, @nodes, @connections, @name, 0, @description)
`);

const updateWorkflow = db.prepare(`
  update workflow_entity
  set nodes = @nodes,
      connections = @connections,
      staticData = @staticData,
      meta = @meta,
      versionId = @versionId,
      activeVersionId = @versionId,
      updatedAt = @updatedAt,
      versionCounter = versionCounter + 1
  where id = @workflowId
`);

db.transaction(() => {
  insertHistory.run({
    versionId,
    workflowId: WORKFLOW_ID,
    authors: 'Codex',
    createdAt: updatedAt,
    updatedAt,
    nodes: nodesJson,
    connections: connectionsJson,
    name: workflow.name,
    description: row.description || null,
  });

  updateWorkflow.run({
    nodes: nodesJson,
    connections: connectionsJson,
    staticData: staticDataJson,
    meta: metaJson,
    versionId,
    updatedAt,
    workflowId: WORKFLOW_ID,
  });
})();

const refreshed = workflowFromRow(db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID));
for (const exportPath of EXPORT_PATHS) {
  writeJson(exportPath, refreshed);
}

console.log(JSON.stringify({
  ok: true,
  backupPath,
  versionId,
  exports: EXPORT_PATHS,
}, null, 2));
