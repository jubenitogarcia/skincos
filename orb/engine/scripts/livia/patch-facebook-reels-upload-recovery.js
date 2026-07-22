#!/usr/bin/env node

'use strict';

// Applies the second-stage Facebook Reel recovery. A completed upload can be
// discarded asynchronously by Meta; in that precise terminal state a finish
// retry is impossible, so a bounded, fresh upload chain is required.

const fs = require('fs');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function readWorkflow() {
  const file = arg('--input');
  const raw = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count === 0) throw new Error(`${label}: expected source marker is missing.`);
  if (count > 1) throw new Error(`${label}: source marker is ambiguous (${count} matches).`);
  return source.replace(before, after);
}

function processNode(workflow) {
  const node = (workflow.nodes || []).find((entry) => entry && entry.name === 'Process HTTP Publish Result');
  if (!node || typeof node.parameters?.jsCode !== 'string') {
    throw new Error('Missing Code node Process HTTP Publish Result.');
  }
  return node;
}

function patchProcessHttp(code) {
  code = replaceOnce(code, `if ((Number(incoming.statusCode || 0) >= 400) || apiErr) { state.inflight = {}; state.updatedAt = new Date().toISOString(); throwHttpError(inflight, incoming, httpBody); }`, `const facebookReelsReupload = scheduleFacebookReelsUploadRecovery(inflight, apiErr);
if (facebookReelsReupload) return [routeItem("prepare_http", "facebook_reels_reupload_recovery", facebookReelsReupload)];
if ((Number(incoming.statusCode || 0) >= 400) || apiErr) { state.inflight = {}; state.updatedAt = new Date().toISOString(); throwHttpError(inflight, incoming, httpBody); }`, 'Process HTTP Publish Result upload-missing interception');

  code = replaceOnce(code, `function scheduleFacebookReelsFinishRetry(checkJob, fatalStatus) {`, `function isFacebookReelsUploadMissing(job, apiErr) {
  if (str(job.platform, "").toLowerCase() !== "facebook" || str(job.step, "").toLowerCase() !== "reels_finish_retry") return false;
  const raw = asObject(apiErr?.raw);
  const code = str(raw.code || apiErr?.code, "");
  const subcode = str(raw.error_subcode, "");
  const title = str(raw.error_user_title, "").toLowerCase();
  const message = str(apiErr?.message || raw.error_user_msg, "").toLowerCase();
  return code === "6000" && subcode === "1363130" &&
    (title.includes("video upload is missing") || message.includes("video was not uploaded"));
}

function scheduleFacebookReelsUploadRecovery(failedJob, apiErr) {
  if (!isFacebookReelsUploadMissing(failedJob, apiErr)) return null;
  const attempted = Number(failedJob.reuploadRecoveryAttempt || 0);
  const maximum = Math.min(1, Math.max(0, Number(failedJob.maxReuploadRecoveryAttempts || 1)));
  if (!Number.isFinite(attempted) || attempted >= maximum) return null;

  const originalFinishRun = Number(failedJob.recoveryOfPublishRunIndex || failedJob.publishRunIndex);
  const allKnown = [...state.completed, ...state.pending, ...state.allJobs].map(asObject);
  const originalFinish = state.completed.map(asObject).find((entry) => Number(entry.publishRunIndex) === originalFinishRun);
  const originalStartRun = Number(asObject(originalFinish).reelsStartFromPublishRunIndex);
  const originalStart = state.completed.map(asObject).find((entry) => Number(entry.publishRunIndex) === originalStartRun && str(entry.step, "").toLowerCase() === "reels_start");
  const originalUpload = state.completed.map(asObject).find((entry) =>
    str(entry.step, "").toLowerCase() === "reels_upload_hosted" && Number(entry.reelsStartFromPublishRunIndex) === originalStartRun,
  );
  const originalReady = state.completed.map(asObject).find((entry) =>
    str(entry.checkKind, "").toLowerCase() === "fb_reels_upload_ready" && Number(entry.statusFromPublishRunIndex) === originalStartRun,
  );
  const originalPost = allKnown.find((entry) =>
    str(entry.checkKind, "").toLowerCase() === "fb_reels_published" && Number(entry.statusFromPublishRunIndex) === originalStartRun,
  );
  if (!originalStart || !originalUpload || !originalReady || !originalFinish || !originalPost) {
    state.inflight = {};
    state.updatedAt = new Date().toISOString();
    throw new Error("Process HTTP Publish Result: recuperação Facebook Reels upload-missing sem cadeia durável completa (start=" + str(originalStartRun, "n/a") + ").");
  }

  const allIndexes = [...state.allJobs, ...state.pending, ...state.completed]
    .map((entry) => Number(asObject(entry).publishRunIndex))
    .filter((value) => Number.isFinite(value));
  const nextRun = (allIndexes.length ? Math.max(...allIndexes) : -1) + 1;
  const stripRuntime = (job) => {
    const copy = { ...asObject(job) };
    for (const field of ["ready", "reason", "remoteId", "permalink", "lastStatusCode", "lastResponseBody", "statusObjectId", "attempt", "prepareRequestRoute", "prepareRequestStage", "resumeRecord", "__prState", "debug", "recoveryAttempt", "recoveryOfPublishRunIndex", "recoveryReason", "reuploadRecoveryAttempt", "maxReuploadRecoveryAttempts"]) delete copy[field];
    return copy;
  };
  const recoveryMeta = {
    reuploadRecoveryAttempt: attempted + 1,
    maxReuploadRecoveryAttempts: maximum,
    recoveryReason: "facebook_reels_upload_missing_reupload",
  };
  const start = { ...stripRuntime(originalStart), ...recoveryMeta, phase: "upload", step: "reels_start", publishRunIndex: nextRun };
  const upload = { ...stripRuntime(originalUpload), ...recoveryMeta, phase: "upload", step: "reels_upload_hosted", publishRunIndex: nextRun + 1, reelsStartFromPublishRunIndex: nextRun };
  const ready = { ...stripRuntime(originalReady), ...recoveryMeta, phase: "checkStatus", step: "status", checkKind: "fb_reels_upload_ready", publishRunIndex: nextRun + 2, statusFromPublishRunIndex: nextRun, attempt: 0 };
  const finish = { ...stripRuntime(originalFinish), ...recoveryMeta, phase: "publish", step: "reels_finish", publishRunIndex: nextRun + 3, reelsStartFromPublishRunIndex: nextRun, checkStatusFromPublishRunIndex: nextRun + 2 };
  const post = { ...stripRuntime(originalPost), ...recoveryMeta, phase: "checkStatus", step: "reels_publish_status", checkKind: "fb_reels_published", publishRunIndex: nextRun + 4, statusFromPublishRunIndex: nextRun, reelsStartFromPublishRunIndex: nextRun, postPublishFromRunIndex: nextRun + 3, attempt: 0, recoveryAttempt: 0, maxRecoveryAttempts: 1 };

  state.pending = state.pending.filter((entry) => {
    const candidate = asObject(entry);
    return !(str(candidate.platform, "").toLowerCase() === "facebook" && str(candidate.unit, "") === str(failedJob.unit, "") && str(candidate.groupKey, "") === str(failedJob.groupKey, "") && str(candidate.checkKind, "").toLowerCase() === "fb_reels_published" && Number(candidate.statusFromPublishRunIndex) === originalStartRun);
  });
  // The start job is returned directly to the next node. Only its successors belong
  // in the queue; otherwise a successful recovery would start the same Reel
  // twice and risk a duplicate publication.
  state.pending.unshift(upload, ready, finish, post);
  state.allJobs.push(start, upload, ready, finish, post);
  state.inflight = {};
  state.updatedAt = new Date().toISOString();
  return start;
}

function scheduleFacebookReelsFinishRetry(checkJob, fatalStatus) {`, 'Process HTTP Publish Result upload-missing recovery insertion');

  code = replaceOnce(code, `  state.pending.unshift(retryStatus);
  state.pending.unshift(retry);`, `  // The retry job is returned directly below; queue only its successor status check.
  state.pending.unshift(retryStatus);`, 'Process HTTP Publish Result finish-retry queue ownership');

  for (const required of ['scheduleFacebookReelsUploadRecovery', 'isFacebookReelsUploadMissing', 'facebook_reels_upload_missing_reupload', 'reels_finish_retry']) {
    if (!code.includes(required)) throw new Error(`Process HTTP Publish Result: missing postcondition ${required}.`);
  }
  return code;
}

function main() {
  const workflow = readWorkflow();
  const node = processNode(workflow);
  node.parameters.jsCode = patchProcessHttp(node.parameters.jsCode);
  node.retryOnFail = false;
  delete node.waitBetweenTries;
  process.stdout.write(`${JSON.stringify(workflow)}\n`);
}

main();
