#!/usr/bin/env node

'use strict';

// Applies the narrowly scoped workflow-node migration that accompanies the
// external job-graph source. It is intentionally fail-closed: a different
// node implementation must be reviewed rather than patched heuristically.

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

function nodeByName(workflow, name) {
  const node = (workflow.nodes || []).find((entry) => entry && entry.name === name);
  if (!node || typeof node.parameters?.jsCode !== 'string') {
    throw new Error(`Missing Code node ${name}.`);
  }
  return node;
}

function patchProcessHttp(code) {
  code = replaceOnce(code, `if (kind === "fb_reels_video") {
      const videoStatus = normalizeStatusValue(statusObj.video_status);
      const uploadingStatus = normalizeStatusValue(statusObj?.uploading_phase?.status);
      const publishingStatus = normalizeStatusValue(statusObj?.publishing_phase?.publish_status);
      const processingStatus = normalizeStatusValue(statusObj?.processing_phase?.status);
      const publishingPhaseStatus = normalizeStatusValue(statusObj?.publishing_phase?.status);

      if (videoStatus === "UPLOAD_COMPLETE" || uploadingStatus === "COMPLETE") return true;
      if (publishingStatus.includes("PUBLISH")) return true;
      if (uploadingStatus === "COMPLETE" && processingStatus === "COMPLETE" && publishingPhaseStatus === "COMPLETE") return true;
      return false;
    }`, `if (kind === "fb_reels_upload_ready") {
      const videoStatus = normalizeStatusValue(statusObj.video_status);
      const uploadingStatus = normalizeStatusValue(statusObj?.uploading_phase?.status);
      const processingStatus = normalizeStatusValue(statusObj?.processing_phase?.status);
      return videoStatus === "UPLOAD_COMPLETE" && uploadingStatus === "COMPLETE" && processingStatus === "COMPLETE";
    }

    if (kind === "fb_reels_published") {
      const videoStatus = normalizeStatusValue(statusObj.video_status);
      const processingStatus = normalizeStatusValue(statusObj?.processing_phase?.status);
      const publishingStatus = normalizeStatusValue(statusObj?.publishing_phase?.publish_status);
      const publishingPhaseStatus = normalizeStatusValue(statusObj?.publishing_phase?.status);
      return videoStatus !== "ERROR" && processingStatus === "COMPLETE" &&
        publishingPhaseStatus === "COMPLETE" && publishingStatus === "PUBLISHED";
    }`, 'Process HTTP Publish Result readiness');

  code = replaceOnce(code, `if (resultJson.ready !== true) {`, `function scheduleFacebookReelsFinishRetry(checkJob, fatalStatus) {
  if (str(checkJob.platform, "").toLowerCase() !== "facebook" || str(checkJob.checkKind, "").toLowerCase() !== "fb_reels_published") return null;
  const attempted = Number(checkJob.recoveryAttempt || 0);
  const maximum = Math.min(2, Math.max(0, Number(checkJob.maxRecoveryAttempts || 1)));
  if (!Number.isFinite(attempted) || attempted >= maximum) return null;

  const originalRun = Number(checkJob.postPublishFromRunIndex);
  const originalFinish = state.completed.find((entry) => Number(asObject(entry).publishRunIndex) === originalRun);
  if (!originalFinish) {
    throw new Error("Process HTTP Publish Result: recuperação Facebook Reels sem reels_finish durável (postPublishFromPublishRunIndex=" + str(checkJob.postPublishFromRunIndex, "n/a") + ").");
  }

  const allIndexes = [...state.allJobs, ...state.pending, ...state.completed]
    .map((entry) => Number(asObject(entry).publishRunIndex))
    .filter((value) => Number.isFinite(value));
  const nextRun = (allIndexes.length ? Math.max(...allIndexes) : -1) + 1;
  const retry = { ...asObject(originalFinish) };
  for (const field of ["ready", "reason", "remoteId", "permalink", "lastStatusCode", "lastResponseBody", "statusObjectId", "attempt", "prepareRequestRoute", "prepareRequestStage", "resumeRecord", "__prState", "debug"]) delete retry[field];
  Object.assign(retry, {
    phase: "publish",
    step: "reels_finish_retry",
    publishRunIndex: nextRun,
    recoveryAttempt: attempted + 1,
    recoveryOfPublishRunIndex: originalRun,
    recoveryReason: "facebook_reels_post_publish_status_" + str(fatalStatus, "error").toLowerCase(),
  });

  const retryStatus = { ...asObject(checkJob) };
  for (const field of ["ready", "reason", "remoteId", "permalink", "lastStatusCode", "lastResponseBody", "statusObjectId", "attempt", "prepareRequestRoute", "prepareRequestStage", "resumeRecord", "__prState", "debug"]) delete retryStatus[field];
  Object.assign(retryStatus, {
    phase: "checkStatus",
    step: "reels_publish_status",
    checkKind: "fb_reels_published",
    publishRunIndex: nextRun + 1,
    postPublishFromRunIndex: nextRun,
    attempt: 0,
    recoveryAttempt: attempted + 1,
  });

  state.pending.unshift(retryStatus);
  state.pending.unshift(retry);
  state.allJobs.push(retry, retryStatus);
  state.inflight = {};
  state.updatedAt = new Date().toISOString();
  return retry;
}

if (resultJson.ready !== true) {`, 'Process HTTP Publish Result recovery insertion');

  code = replaceOnce(code, `if (fatalStatus) {
    state.inflight = {};
    state.updatedAt = new Date().toISOString();
    throw new Error(
      "Process HTTP Publish Result: status fatal " +
      "[" + fatalStatus + "] para " + str(inflight.platform, "n/a") + "/" + str(inflight.checkKind, "n/a") + "."
    );
  }`, `if (fatalStatus) {
    const retry = scheduleFacebookReelsFinishRetry(inflight, fatalStatus);
    if (retry) return [routeItem("prepare_http", "facebook_reels_finish_retry", retry)];
    state.inflight = {};
    state.updatedAt = new Date().toISOString();
    throw new Error(
      "Process HTTP Publish Result: status fatal " +
      "[" + fatalStatus + "] para " + str(inflight.platform, "n/a") + "/" + str(inflight.checkKind, "n/a") +
      " (recoveryAttempt=" + str(inflight.recoveryAttempt, "0") + ")."
    );
  }`, 'Process HTTP Publish Result fatal recovery');

  if (!code.includes('fb_reels_published') || !code.includes('scheduleFacebookReelsFinishRetry')) {
    throw new Error('Process HTTP Publish Result: migration postcondition failed.');
  }
  return code;
}

function patchValidateGraph(code) {
  code = replaceOnce(code, `const hasPublish = publishJobs.some((publishJob) => Number(publishJob.checkStatusFromPublishRunIndex || 0) === Number(job.publishRunIndex));
  if (!hasPublish) {`, `const isFacebookReelsPostCheck = str(job.checkKind, "").toLowerCase() === "fb_reels_published";
  const hasPublish = isFacebookReelsPostCheck
    ? publishJobs.some((publishJob) => Number(publishJob.publishRunIndex) === Number(job.postPublishFromRunIndex))
    : publishJobs.some((publishJob) => Number(publishJob.checkStatusFromPublishRunIndex || 0) === Number(job.publishRunIndex));
  if (!hasPublish) {`, 'BQ - Validate Job Graph post-publish check');

  code = replaceOnce(code, `const reelsCheckStatus = groupJobs.find((job) => str(job.phase, "").toLowerCase() === "checkstatus" && str(job.checkKind, "").toLowerCase() === "fb_reels_video");

  if (!reelsStart || !reelsUploadHosted || !reelsCheckStatus) {`, `const reelsCheckStatus = groupJobs.find((job) => str(job.phase, "").toLowerCase() === "checkstatus" && str(job.checkKind, "").toLowerCase() === "fb_reels_upload_ready");
  const reelsPostPublishStatus = groupJobs.find((job) => str(job.phase, "").toLowerCase() === "checkstatus" && str(job.checkKind, "").toLowerCase() === "fb_reels_published");

  if (!reelsStart || !reelsUploadHosted || !reelsCheckStatus || !reelsPostPublishStatus) {`, 'BQ - Validate Job Graph Reel topology');

  code = replaceOnce(code, `if (Number(reelsFinish.checkStatusFromPublishRunIndex || 0) !== Number(reelsCheckStatus.publishRunIndex || 0)) {
    throw new Error("BQ - Validate Job Graph: reels_finish sem checkStatus correspondente em groupKey=" + groupKey + ".");
  }
}`, `if (Number(reelsFinish.checkStatusFromPublishRunIndex || 0) !== Number(reelsCheckStatus.publishRunIndex || 0)) {
    throw new Error("BQ - Validate Job Graph: reels_finish sem checkStatus correspondente em groupKey=" + groupKey + ".");
  }

  if (Number(reelsPostPublishStatus.statusFromPublishRunIndex || 0) !== Number(reelsStart.publishRunIndex || 0) ||
      Number(reelsPostPublishStatus.postPublishFromRunIndex || 0) !== Number(reelsFinish.publishRunIndex || 0)) {
    throw new Error("BQ - Validate Job Graph: Reel sem confirmação pós-publicação correspondente em groupKey=" + groupKey + ".");
  }
}`, 'BQ - Validate Job Graph post-publish dependency');

  if (!code.includes('fb_reels_published') || !code.includes('postPublishFromRunIndex')) {
    throw new Error('BQ - Validate Job Graph: migration postcondition failed.');
  }
  return code;
}

function main() {
  const workflow = readWorkflow();
  nodeByName(workflow, 'Process HTTP Publish Result').parameters.jsCode = patchProcessHttp(nodeByName(workflow, 'Process HTTP Publish Result').parameters.jsCode);
  nodeByName(workflow, 'BQ - Validate Job Graph').parameters.jsCode = patchValidateGraph(nodeByName(workflow, 'BQ - Validate Job Graph').parameters.jsCode);
  process.stdout.write(`${JSON.stringify(workflow)}\n`);
}

main();
