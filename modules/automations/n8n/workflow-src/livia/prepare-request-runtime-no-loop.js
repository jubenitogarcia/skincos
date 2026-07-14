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
    return value
      .map((entry) => __prRemoveNulls(entry))
      .filter((entry) => entry !== undefined);
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

function __prCloneItem(item, overrides = {}) {
  const json = item && typeof item === "object" && item.json && typeof item.json === "object"
    ? item.json
    : {};

  return {
    ...item,
    json: __prRemoveNulls({
      ...json,
      ...overrides,
    }),
  };
}

function __prGetInputItems() {
  try {
    if ($input && typeof $input.all === "function") {
      const rows = $input.all();
      if (Array.isArray(rows) && rows.length) return rows;
    }
  } catch {}

  if ($json && typeof $json === "object") {
    return [{ json: $json }];
  }

  return [];
}

function __prLooksLikeHttpEnvelope(obj) {
  return !!(obj && typeof obj === "object" && (
    "statusCode" in obj ||
    "body" in obj ||
    "headers" in obj ||
    "response" in obj
  ));
}

function __prLooksLikePreparedJob(obj) {
  const job = __prAsObject(obj);
  return !!(
    __prStr(job.phase, "").trim() &&
    (job.publishRunIndex !== undefined && job.publishRunIndex !== null && job.publishRunIndex !== "") &&
    (__prStr(job.url, "").trim() || __prAsObject(job.httpRequest).url)
  );
}

function __prGetExecutionState() {
  const execId = __prStr($execution?.id, "noexec");
  const sd = $getWorkflowStaticData("global");
  sd.__pr = __prAsObject(sd.__pr);

  for (const key of Object.keys(sd.__pr)) {
    if (key !== execId) delete sd.__pr[key];
  }

  const state = sd.__pr[execId] = __prAsObject(sd.__pr[execId]);
  state.queue = __prAsArray(state.queue);
  state.byRun = __prAsObject(state.byRun);
  state.pending = __prAsArray(state.pending);
  state.completed = __prAsArray(state.completed);
  state.allJobs = __prAsArray(state.allJobs);
  state.createdAt = __prStr(state.createdAt, new Date().toISOString());
  state.updatedAt = new Date().toISOString();

  return { execId, sd, state };
}

function __prResetState(state) {
  state.queue = [];
  state.byRun = {};
  state.pending = [];
  state.completed = [];
  state.allJobs = [];
  state.createdAt = new Date().toISOString();
  state.updatedAt = state.createdAt;
}

function __prEnsureWaitItem(item) {
  return __prCloneItem(item, {
    ready: false,
    stage: "wait",
  });
}

function __prEnsureFinalItems(items) {
  return __prAsArray(items).map((item) => __prCloneItem(item, {
    ready: true,
    stage: "final",
  }));
}

function __prPrepareNextPendingJob(state) {
  if (!state.pending.length) return [];

  const nextJob = state.pending.shift();
  state.updatedAt = new Date().toISOString();

  const prepared = __prAsArray(runPrepareRequestLifecycle(nextJob, [{ json: nextJob }]));
  if (!prepared.length) {
    throw new Error("Prepare Request: bootstrap/lifecycle não conseguiu preparar o próximo request.");
  }

  return [__prEnsureWaitItem(prepared[0])];
}

function __prFinalizeFromState(state) {
  const completedItems = state.completed.map((json) => ({ json }));
  const finalRows = buildFinalCollectorRows(completedItems);
  state.pending = [];
  state.completed = [];
  state.allJobs = [];
  state.updatedAt = new Date().toISOString();
  return __prEnsureFinalItems(finalRows);
}

function __prBootstrap(items) {
  const { state } = __prGetExecutionState();
  __prResetState(state);

  const jobs = __prAsArray(buildPublishJobsFromLiviaInput(items))
    .map((item) => __prAsObject(item && item.json))
    .filter((job) => Object.keys(job).length);

  if (!jobs.length) return [];

  state.pending = jobs.slice();
  state.allJobs = jobs.slice();
  return __prPrepareNextPendingJob(state);
}

function __prContinueAfterResult(resultItems) {
  const { state } = __prGetExecutionState();
  const first = __prAsArray(resultItems)[0];
  if (!first) return [];

  const resultJson = __prAsObject(first.json);
  if (resultJson.ready !== true) {
    state.updatedAt = new Date().toISOString();
    return [__prEnsureWaitItem(first)];
  }

  state.completed.push(resultJson);
  state.updatedAt = new Date().toISOString();

  if (state.pending.length) {
    return __prPrepareNextPendingJob(state);
  }

  return __prFinalizeFromState(state);
}

const __prepareRequestInputItems = __prGetInputItems();
const __prepareRequestIncoming = __prAsObject(__prepareRequestInputItems[0]?.json);

if (!__prepareRequestInputItems.length) {
  return [];
}

if (__prLooksLikeHttpEnvelope(__prepareRequestIncoming)) {
  return __prContinueAfterResult(
    runPrepareRequestLifecycle(__prepareRequestIncoming, __prepareRequestInputItems),
  );
}

if (__prLooksLikePreparedJob(__prepareRequestIncoming)) {
  return __prContinueAfterResult(
    runPrepareRequestLifecycle(__prepareRequestIncoming, __prepareRequestInputItems),
  );
}

return __prBootstrap(__prepareRequestInputItems);
