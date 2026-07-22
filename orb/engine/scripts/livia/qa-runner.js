#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted');
const runtimePaths = require('../lib/runtime-paths');

const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const WORKFLOW_PATH = path.join(runtimePaths.workflowsDir, 'livia.active.json');
const PROCESS_SCRIPT = path.join(runtimePaths.repoRoot, 'scripts', 'livia', 'process-media-asset.js');
const BUILD_GRAPH_SCRIPT = path.join(runtimePaths.repoRoot, 'scripts', 'livia', 'build-platform-job-graph.js');
const VERIFY_PUBLISHED_ARTIFACTS_SCRIPT = path.join(runtimePaths.repoRoot, 'scripts', 'livia', 'verify-published-artifacts.js');
const PUBLISH_PROGRESS_LEDGER_SCRIPT = path.join(runtimePaths.repoRoot, 'scripts', 'livia', 'publish-progress-ledger.js');

function parseProcessMediaOutput(run) {
  const raw = String(run?.data?.main?.[0]?.[0]?.json?.stdout || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { parseError: 'Process Media Asset stdout is not valid JSON.' };
  }
}

function flag(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function runPsql(sql) {
  return execFileSync(
    'sudo',
    ['-n', '-u', 'postgres', 'psql', '-d', 'n8n_runtime', '-Atqc', sql],
    { encoding: 'utf8', maxBuffer: 120 * 1024 * 1024 },
  ).trim();
}

function loadExecutionData(executionId) {
  const raw = runPsql(`select data from n8n_runtime.execution_data where "executionId"=${Number(executionId)};`);
  if (!raw) throw new Error(`Execution data not found for ${executionId}.`);
  return parse(raw);
}

function loadExecutionEntity(executionId) {
  const raw = runPsql(
    `select row_to_json(q)::text from (
      select id, status, "startedAt", "stoppedAt", "retryOf", "retrySuccessId"
      from n8n_runtime.execution_entity where id=${Number(executionId)}
    ) q;`,
  );
  if (!raw) throw new Error(`Execution entity not found for ${executionId}.`);
  return JSON.parse(raw);
}

function executionItems(runData, nodeName) {
  return (runData?.[nodeName] || []).flatMap((run) => run?.data?.main?.flat() || []);
}

function normalizeMediaKind(...values) {
  const raw = values.flat(Infinity).map((value) => String(value || '').toLowerCase()).join(' ');
  if (raw.includes('carousel')) return 'carousel';
  if (raw.includes('video') || raw.includes('reels') || raw.includes('reel')) return 'video';
  if (raw.includes('image') || raw.includes('photo')) return 'image';
  return '';
}

function publicationKind(rows, publish) {
  const bodies = rows.map((row) => row.requestBody || row.jsonRequest || {});
  const steps = rows.map((row) => row.step);
  const urls = rows.map((row) => row.url || row.httpRequest?.url);
  const kind = normalizeMediaKind(
    publish.mediaKind,
    publish.media?.mediaKind,
    publish.mediaType,
    publish.media_type,
    publish.groupBaseMediaType,
    rows.map((row) => [row.mediaKind, row.media?.mediaKind, row.mediaType, row.media_type, row.groupBaseMediaType]),
    bodies.map((body) => [body.media_type, body.image_url ? 'image' : '', body.video_url ? 'video' : '', body.attached_media ? 'image' : '']),
    steps,
    urls,
  );
  return kind || 'image';
}

function firstSubmitted(rows, keys) {
  for (const row of rows) {
    const body = row.requestBody || row.jsonRequest || {};
    for (const key of keys) {
      if (body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== '') return body[key];
    }
  }
  return '';
}

function buildAuditTargets(runData) {
  const prepared = executionItems(runData, 'Prepare HTTP Publish Request').map((item) => item.json || {});
  const responses = executionItems(runData, 'HTTP Request').map((item) => item.json || {});
  const jobs = prepared.map((job, index) => ({ ...job, response: responses[index]?.body || responses[index] || {} }));
  const targets = [];
  for (const unit of ['bss', 'nh']) {
    for (const platform of ['instagram', 'facebook', 'threads']) {
      const current = jobs.filter((job) => String(job.unit || '').toLowerCase() === unit && String(job.platform || '').toLowerCase() === platform);
      const publish = current.find((job) => String(job.phase || '').toLowerCase() === 'publish');
      if (!publish || !Object.keys(publish.response || {}).length) continue;
      const start = current.find((job) => String(job.step || '').toLowerCase() === 'reels_start');
      const upload = current.find((job) => String(job.phase || '').toLowerCase() === 'upload');
      const mediaKind = publicationKind(current, publish);
      const publishMode = current.some((job) => String(job.step || '').toLowerCase().startsWith('reels_'))
        ? 'reels'
        : mediaKind === 'carousel' ? 'carousel' : 'static';
      const providerObjectId = platform === 'facebook' && publishMode === 'reels'
        ? String(start?.response?.video_id || start?.response?.id || publish.response?.id || publish.response?.post_id || '')
        : String(publish.response?.id || publish.response?.post_id || upload?.response?.post_id || upload?.response?.id || '');
      const providerMediaId = platform === 'facebook' && publishMode === 'reels'
        ? String(start?.response?.video_id || start?.response?.id || '')
        : String(upload?.response?.id || upload?.response?.post_id || '');
      targets.push({
        platform,
        unit,
        mediaKind,
        publishMode,
        providerObjectId,
        providerMediaId,
        expected: {
          caption: String(publish.text?.caption || publish.text?.text || ''),
          title: String(publish.text?.title || ''),
          altText: String(publish.text?.alt_text || publish.text?.altText || ''),
        },
        submitted: {
          title: String(firstSubmitted(current, ['title']) || ''),
          altText: String(firstSubmitted(current, ['alt_text', 'altText', 'alt_text_custom']) || ''),
          coverUrl: String(firstSubmitted(current, ['cover_url']) || ''),
          thumbOffset: firstSubmitted(current, ['thumb_offset']),
        },
      });
    }
  }
  const tokenOverrides = {};
  for (const job of jobs) {
    const platform = String(job.platform || '').toLowerCase();
    const unit = String(job.unit || '').toLowerCase();
    const token = String(job.params?.access_token || job.query?.access_token || '').trim();
    if (!platform || !unit || !token) continue;
    tokenOverrides[platform] ||= {};
    tokenOverrides[platform][unit] ||= token;
  }
  return { jobs, targets, tokenOverrides };
}

function extractNodeParameters(runData, nodeName) {
  const first = executionItems(runData, nodeName)[0]?.json || {};
  return first;
}

function readRuntimePhone() {
  const envPath = path.join(runtimePaths.runtimeHome, 'env', 'n8n-business.env');
  if (!fs.existsSync(envPath)) return '';
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .find((entry) => entry.startsWith('N8N_DEFAULT_TEST_PHONE='));
  return line ? line.split('=').slice(1).join('').replace(/\D/g, '') : '';
}

function auditExecution(executionId) {
  const summary = summarizeExecution(executionId);
  const execution = loadExecutionEntity(executionId);
  const runData = summary.runData;
  const { jobs, targets, tokenOverrides } = buildAuditTargets(runData);
  const tokenRoot = executionItems(runData, 'Get Credential Tokens')[0]?.json || {};
  const verification = spawnSync('node', [VERIFY_PUBLISHED_ARTIFACTS_SCRIPT, '--payload', JSON.stringify({
    final: { publishVerification: { targets } },
    tokenRoot,
    tokenOverrides,
  })], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  let verificationResult = {};
  try {
    verificationResult = JSON.parse(verification.stdout || '{}');
  } catch {
    verificationResult = { ok: false, error: verification.stderr || verification.stdout || 'Invalid verifier output.' };
  }

  const processMedia = parseProcessMediaOutput((runData['Process Media Asset'] || [])[0]);
  const final = executionItems(runData, 'Collect Publish Results')[0]?.json || {};
  const drive = executionItems(runData, 'Update File')[0]?.json || {};
  const notification = executionItems(runData, 'Inform Success (1)')[0]?.json || {};
  const runtimePhone = readRuntimePhone();
  const destination = String(notification?.data?.key?.remoteJid || '').replace(/\D/g, '');
  const deprecations = jobs
    .flatMap((job) => Object.values(job.response?.headers || {}))
    .filter((value) => /deprecated|auto-upgraded/i.test(String(value)));
  const contentFailures = (verificationResult.deliveryAudit?.targets || []).flatMap((target) =>
    Object.entries(target.content || {})
      .filter(([, value]) => value && typeof value === 'object' && value.status === 'failed')
      .map(([field, value]) => `${target.platform}/${target.unit}:${field}:${value.reason || 'not_delivered'}`),
  );
  const graphOutput = executionItems(runData, 'BQ - Build Platform Job Graph')[0]?.json || {};
  let graphJobs = Array.isArray(graphOutput.jobs) ? graphOutput.jobs : [];
  if (!graphJobs.length && typeof graphOutput.stdout === 'string') {
    try {
      graphJobs = JSON.parse(graphOutput.stdout).jobs || [];
    } catch {
      graphJobs = [];
    }
  }
  const completedRunIndexes = new Set(jobs
    .filter((job) => Object.keys(job.response || {}).length)
    .map((job) => Number(job.publishRunIndex)));
  const publishedTargets = graphJobs
    .filter((job) => String(job.phase || '').toLowerCase() === 'publish' && completedRunIndexes.has(Number(job.publishRunIndex)))
    .map((job) => `${job.platform}/${job.unit}`);
  const pendingJobs = graphJobs
    .filter((job) => !completedRunIndexes.has(Number(job.publishRunIndex)))
    .map((job) => ({ platform: job.platform, unit: job.unit, phase: job.phase, step: job.step, publishRunIndex: job.publishRunIndex }));

  console.log(JSON.stringify({
    executionId: String(executionId),
    status: execution.status || (summary.error ? 'failed' : 'unknown'),
    timing: { startedAt: execution.startedAt, stoppedAt: execution.stoppedAt },
    lastNode: summary.lastNode,
    jobGraph: {
      plannedJobs: Number(extractNodeParameters(runData, 'BQ - Seed Publish State').jobCount || targets.length * 3),
      httpCalls: jobs.length,
      targets: targets.length,
      completedRunIndexes: [...completedRunIndexes].sort((left, right) => left - right),
    },
    recovery: {
      publishedTargets,
      pendingJobs,
      safeRetry: execution.status === 'canceled' && pendingJobs.length > 0
        ? 'requires durable progress ledger before a live retry; retrying the original execution directly can duplicate completed publications'
        : 'not_applicable',
    },
    media: processMedia && {
      sourceBytes: processMedia.sourceBytes,
      outputBytes: processMedia.outputBytes,
      optimized: processMedia.optimized,
      optimizationProfile: processMedia.optimizationProfile,
      uploadEligible: processMedia.uploadEligible,
    },
    delivery: verificationResult.deliveryAudit || { state: 'unavailable' },
    drive: {
      updateReturned: Boolean(drive.id),
      publishedPropertyConfirmed: String(drive.appProperties?.published || drive.properties?.published || '').toLowerCase() === 'true',
      state: String(drive.appProperties?.published || drive.properties?.published || '').toLowerCase() === 'true' ? 'verified' : 'unconfirmed',
    },
    notification: {
      state: String(notification?.data?.status || '').toLowerCase() === 'pending' ? 'queued' : String(notification?.data?.status || '') || 'unconfirmed',
      destinationMatchesRuntime: Boolean(runtimePhone) && destination === runtimePhone,
      shouldNotify: final.shouldNotify === true,
    },
    findings: {
      graphApiDeprecationWarnings: [...new Set(deprecations)],
      contentDeliveryGaps: contentFailures,
      linksInHistoricalCollector: final.whatsapp?.instagram?.permalinks || {},
    },
  }, null, 2));
}

function restoreInterruptedProgress(executionId) {
  const execution = loadExecutionEntity(executionId);
  const summary = summarizeExecution(executionId);
  const recoverableTimeout = execution.status === 'error'
    && /Task request timed out/i.test(String(summary.error?.message || summary.error?.description || ''));
  // Reaching the post-publication verifier means all HTTP publishing jobs have
  // already passed the processor. Preserve their provider IDs if verification
  // itself is interrupted, rather than risking a duplicate social post.
  const recoverablePostPublishFailure = execution.status === 'error'
    && summary.lastNode === 'Verify Published Artifacts';
  if (execution.status !== 'canceled' && !recoverableTimeout && !recoverablePostPublishFailure) {
    throw new Error(
      `Progress restore only accepts canceled executions or task-runner interruptions; ${executionId} is ${execution.status}.`,
    );
  }
  const runData = summary.runData;
  const prepared = executionItems(runData, 'Prepare HTTP Publish Request').map((item) => item.json || {});
  const responses = executionItems(runData, 'HTTP Request').map((item) => item.json || {});
  const mediaByGroup = new Map();
  for (const job of prepared) {
    if (job.groupKey && job.media?.id) mediaByGroup.set(String(job.groupKey), job.media);
  }
  const records = prepared.map((job, index) => {
    const response = responses[index]?.body || responses[index] || {};
    if (!Object.keys(response).length) return null;
    const media = job.media?.id ? job.media : mediaByGroup.get(String(job.groupKey));
    if (!media?.id) return null;
    return {
      ...job,
      media,
      lastStatusCode: Number(response.statusCode) || 200,
      lastResponseBody: response,
      codexDryRun: false,
    };
  }).filter(Boolean);
  if (!records.length) throw new Error(`Execution ${executionId} has no accepted provider responses to restore.`);

  const result = spawnSync(
    'sudo',
    ['-n', '-u', 'skincos', 'node', PUBLISH_PROGRESS_LEDGER_SCRIPT, '--payload', '-'],
    { input: JSON.stringify(records), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`Unable to restore durable publish progress: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  console.log(JSON.stringify({
    ok: true,
    executionId: String(executionId),
    recoveryReason: recoverableTimeout
      ? 'task_runner_interruption'
      : recoverablePostPublishFailure
        ? 'post_publish_verification_interruption'
        : 'canceled',
    restoredResponses: records.length,
    result: JSON.parse(result.stdout || '{}'),
  }, null, 2));
}

function latestExecutionId() {
  const raw = runPsql(
    `select id from n8n_runtime.execution_entity where "workflowId"='${WORKFLOW_ID}' order by id desc limit 1;`,
  );
  if (!raw) throw new Error(`No executions found for workflow ${WORKFLOW_ID}.`);
  return raw;
}

function summarizeExecution(executionId) {
  const parsed = loadExecutionData(executionId);
  const runData = parsed?.resultData?.runData || {};
  const error = parsed?.resultData?.error || null;
  const nodeNames = Object.keys(runData);
  const lastNode = nodeNames[nodeNames.length - 1] || '';
  return {
    executionId,
    error,
    lastNode,
    nodes: nodeNames.map((name) => {
      const entries = runData[name] || [];
      const last = entries[entries.length - 1] || {};
      return {
        name,
        runs: entries.length,
        executionTime: last.executionTime,
        hasError: !!last.error,
        errorMessage: last.error?.message || last.error?.description || '',
      };
    }),
    runData,
  };
}

function printInspect(executionId) {
  const summary = summarizeExecution(executionId);
  const processRun = summary.runData['Process Media Asset'] || [];
  const writeRun = summary.runData['Write File'] || [];
  const downloadRun = summary.runData['Download File'] || [];
  const processMedia = parseProcessMediaOutput(processRun[0]);
  const compact = {
    executionId: summary.executionId,
    lastNode: summary.lastNode,
    error: summary.error && {
      name: summary.error.name,
      message: summary.error.message,
      node: summary.error.node?.name,
      description: summary.error.description,
    },
    nodes: summary.nodes,
    writeFileOutput: writeRun[0]?.data?.main?.[0]?.[0]?.json || null,
    downloadBinary: downloadRun[0]?.data?.main?.[0]?.[0]?.binary?.data
      ? {
        fileName: downloadRun[0].data.main[0][0].binary.data.fileName,
        fileSize: downloadRun[0].data.main[0][0].binary.data.fileSize,
        mimeType: downloadRun[0].data.main[0][0].binary.data.mimeType,
      }
      : null,
    processMediaOutput: processMedia && {
      status: processMedia.status,
      sourceBytes: processMedia.sourceBytes,
      outputBytes: processMedia.outputBytes,
      optimized: processMedia.optimized,
      optimizationProfile: processMedia.optimizationProfile,
      uploadEligible: processMedia.uploadEligible,
      blockReason: processMedia.blockReason,
      safeUploadBytes: processMedia.safeUploadBytes,
      warnings: processMedia.warnings,
    },
    processMediaAssetError: processRun[0]?.error || null,
  };
  console.log(JSON.stringify(compact, null, 2));
}

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8').replace(/^\uFEFF/, ''));
}

function validateWorkflow() {
  const workflow = loadWorkflow();
  const errors = [];
  const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const processMedia = nodeByName.get('Process Media Asset');
  const command = String(processMedia?.parameters?.command || '');
  const bqBuildGraph = nodeByName.get('BQ - Build Platform Job Graph');
  const bqCommand = String(bqBuildGraph?.parameters?.command || '');
  const bqValidate = nodeByName.get('BQ - Validate Job Graph');
  const bqValidateCode = String(bqValidate?.parameters?.jsCode || '');
  const listFiles = nodeByName.get('List Files');
  const tokenHealth = nodeByName.get('Validate Publish Token Health');
  const usesTokenVaultGateway = String(nodeByName.get('Get Credential Tokens')?.parameters?.url || '').includes('/v1/token-metadata');
  const listFileFields = Array.isArray(listFiles?.parameters?.options?.fields)
    ? listFiles.parameters.options.fields
    : [];
  const prepareMediaItemsCode = String(nodeByName.get('Prepare Media Items')?.parameters?.jsCode || '');
  const hydrateParameters = JSON.stringify(nodeByName.get('Hydrate Publish Context')?.parameters || {});
  const prepareMediaParameters = JSON.stringify(nodeByName.get('Prepare Media Upload Batch')?.parameters || {});
  const processMediaScript = fs.existsSync(PROCESS_SCRIPT)
    ? fs.readFileSync(PROCESS_SCRIPT, 'utf8')
    : '';
  const buildGraphScript = fs.existsSync(BUILD_GRAPH_SCRIPT)
    ? fs.readFileSync(BUILD_GRAPH_SCRIPT, 'utf8')
    : '';
  if (!command.includes('process-media-asset.js')) {
    errors.push('Process Media Asset must call scripts/livia/process-media-asset.js.');
  }
  for (const field of ['id', 'name', 'mimeType']) {
    if (!listFileFields.includes(field)) {
      errors.push(`List Files must request Google Drive field: ${field}.`);
    }
  }
  if (!prepareMediaItemsCode.includes('livia_missing_drive_mime_type')) {
    errors.push('Prepare Media Items must reject scheduled files whose MIME type is missing.');
  }
  if (!usesTokenVaultGateway && (tokenHealth?.type !== 'n8n-nodes-base.executeCommand' || !String(tokenHealth?.parameters?.command || '').includes('validate-publish-token-health.js'))) {
    errors.push('Validate Publish Token Health must run the versioned read-only credential preflight.');
  }
  const credentialTargets = (workflow.connections['Get Credential Tokens']?.main?.[0] || []).map((edge) => edge.node);
  const tokenHealthTargets = (workflow.connections['Validate Publish Token Health']?.main?.[0] || []).map((edge) => edge.node);
  if (!usesTokenVaultGateway && (!credentialTargets.includes('Validate Publish Token Health') || !tokenHealthTargets.includes('List Files'))) {
    errors.push('Credential preflight must run between Get Credential Tokens and List Files.');
  }
  if (usesTokenVaultGateway && !credentialTargets.includes('Validate Publish Token Health')) {
    errors.push('Token Vault credential metadata must feed the gateway-backed token preflight.');
  }
  if (command.length > 2500) {
    errors.push(`Process Media Asset command is too large for stable n8n expression parsing (${command.length} chars).`);
  }
  for (const required of ['cloudinaryVideoCoverUrl', 'normalizeGraphApiVersion', 'cover_url', 'applyPlatformAccessibilityContract', 'alt_text_omitted_for_video', 'body.title = text.title']) {
    if (!buildGraphScript.includes(required)) {
      errors.push(`build-platform-job-graph.js must enforce the publication delivery contract (${required}).`);
    }
  }
  for (const required of ['fs.statSync', 'sourceBytes', 'outputBytes', 'uploadEligible', 'SAFE_UPLOAD_BYTES', 'video_h264_720p_fallback']) {
    if (!processMediaScript.includes(required)) {
      errors.push(`process-media-asset.js must enforce the physical-size upload contract (${required}).`);
    }
  }
  for (const required of ['uploadEligible', 'blockReason', 'upload blocked before Cloudinary']) {
    if (!prepareMediaParameters.includes(required)) {
      errors.push(`Prepare Media Upload Batch must block unsafe media before Cloudinary (${required}).`);
    }
  }
  if (bqBuildGraph?.type !== 'n8n-nodes-base.executeCommand') {
    errors.push('BQ - Build Platform Job Graph must be externalized as Execute Command.');
  }
  if (!bqCommand.includes('build-platform-job-graph.js')) {
    errors.push('BQ - Build Platform Job Graph must call scripts/livia/build-platform-job-graph.js.');
  }
  if (bqCommand.length > 2500) {
    errors.push(`BQ - Build Platform Job Graph command is too large for stable n8n expression parsing (${bqCommand.length} chars).`);
  }
  if (!bqValidateCode.includes('rawPayload.stdout') || !bqValidateCode.includes('JSON.parse(rawPayload.stdout)')) {
    errors.push('BQ - Validate Job Graph must parse stdout JSON from the externalized build graph command.');
  }
  if (
    !buildGraphScript.includes('facebookCredentialContext') ||
    !buildGraphScript.includes('normalizeFacebookGraphUrl') ||
    !buildGraphScript.includes('facebook_account_resolved_from:') ||
    !buildGraphScript.includes('facebook_account_id_slug_stripped')
  ) {
    errors.push('build-platform-job-graph.js must resolve organic Facebook page credentials before Graph API calls.');
  }
  if (
    !buildGraphScript.includes('technicalFrameContext') ||
    !buildGraphScript.includes('applyTechnicalFrame') ||
    !buildGraphScript.includes('thumbnail_url_removed_local_path') ||
    !buildGraphScript.includes('thumb_offset')
  ) {
    errors.push('build-platform-job-graph.js must force current technical frame metadata and reject local thumbnail URLs.');
  }
  if (
    !buildGraphScript.includes('dedupeHashtagsInText') ||
    !buildGraphScript.includes('applyCaptionHygiene') ||
    !buildGraphScript.includes('duplicate_hashtags_deduped')
  ) {
    errors.push('build-platform-job-graph.js must deduplicate hashtags before publishing captions.');
  }
  if (!buildGraphScript.includes("request.media_type = 'IMAGE'") || !buildGraphScript.includes("request.media_type = 'CAROUSEL'")) {
    errors.push('build-platform-job-graph.js must request IMAGE for Threads carousel children and CAROUSEL for the parent.');
  }
  const prepareHttpCode = String(nodeByName.get('Prepare HTTP Publish Request')?.parameters?.jsCode || '');
  if (!prepareHttpCode.includes('JSON.stringify(ids)') || !prepareHttpCode.includes('source.platform')) {
    errors.push('Prepare HTTP Publish Request must serialize Threads carousel children as a JSON array.');
  }
  if (!hydrateParameters.includes('fbCredentialPurpose') || !hydrateParameters.includes('meta_ads_publish')) {
    errors.push('Hydrate Publish Context must prefer organic Facebook page credentials over meta_ads_publish credentials.');
  }
  const bqSeedCode = String(nodeByName.get('BQ - Seed Publish State')?.parameters?.jsCode || '');
  for (const required of ['LIVIA_ALLOW_MANUAL_PUBLISH', '$execution?.mode', 'manual_execution_safe_default']) {
    if (!bqSeedCode.includes(required)) {
      errors.push(`BQ - Seed Publish State must protect manual execution (${required}).`);
    }
  }
  for (const required of ['resumeRecords', 'resumeByRun', 'completedRunIndexes']) {
    if (!bqSeedCode.includes(required)) errors.push(`BQ - Seed Publish State must restore durable publish progress (${required}).`);
  }
  if (!String(nodeByName.get('BQ - Validate Job Graph')?.parameters?.jsCode || '').includes('resumeCompleted: asArray(payload.resumeCompleted)')) {
    errors.push('BQ - Validate Job Graph must preserve durable completed jobs for BQ - Seed Publish State.');
  }
  const progressNode = nodeByName.get('Record Publish Progress');
  if (progressNode?.type !== 'n8n-nodes-base.executeCommand' || !String(progressNode?.parameters?.command || '').includes('publish-progress-ledger.js')) {
    errors.push('Record Publish Progress must persist accepted provider responses in the private runtime ledger.');
  }
  const processTargets = (workflow.connections['Process HTTP Publish Result']?.main?.[0] || []).map((edge) => edge.node);
  if (!processTargets.includes('Record Publish Progress')) {
    errors.push('Process HTTP Publish Result must fan out accepted responses to Record Publish Progress.');
  }
  if (!String(nodeByName.get('Process HTTP Publish Result')?.parameters?.jsCode || '').includes('compactResumeRecord')) {
    errors.push('Process HTTP Publish Result must emit a sanitized durable progress record.');
  }
  if (!String(nodeByName.get('Process HTTP Publish Result')?.parameters?.jsCode || '').includes('facebook_static_photo_already_posted_recovery')) {
    errors.push('Process HTTP Publish Result must recover already-published Facebook static photos without duplication.');
  }
  for (const required of ['fb_reels_published', 'scheduleFacebookReelsFinishRetry']) {
    if (!String(nodeByName.get('Process HTTP Publish Result')?.parameters?.jsCode || '').includes(required)) {
      errors.push(`Process HTTP Publish Result must enforce Facebook Reel post-publication confirmation (${required}).`);
    }
  }
  if (!String(nodeByName.get('BQ - Validate Job Graph')?.parameters?.jsCode || '').includes('postPublishFromRunIndex')) {
    errors.push('BQ - Validate Job Graph must validate the Facebook Reel post-publication status dependency.');
  }
  const progressScript = fs.existsSync(PUBLISH_PROGRESS_LEDGER_SCRIPT)
    ? fs.readFileSync(PUBLISH_PROGRESS_LEDGER_SCRIPT, 'utf8')
    : '';
  for (const required of ['livia-publish-ledger', 'codexDryRun === true', 'publishRunIndex', "'__group__'"]) {
    if (!progressScript.includes(required)) errors.push(`publish-progress-ledger.js must preserve safe resume semantics (${required}).`);
  }
  for (const name of ['Verify Published Artifacts', 'Attach Verified Publish Artifacts', 'Switch Final Dry Run', 'Merge Drive Result and Context', 'Assert Drive Published', 'Cleanup Temp Files']) {
    if (!nodeByName.has(name)) errors.push(`Missing node: ${name}`);
  }
  const assertDriveCode = String(nodeByName.get('Assert Drive Published')?.parameters?.jsCode || '');
  if (!assertDriveCode.includes('appProperties.published')) {
    errors.push('Assert Drive Published must verify appProperties.published=true.');
  }
  if (!assertDriveCode.includes('const finalContext =') || assertDriveCode.includes('$(') || assertDriveCode.includes('...original')) {
    errors.push('Assert Drive Published must project a bounded context without resolving an upstream node.');
  }
  if (assertDriveCode) {
    try {
      const executeAssertDrive = new Function('$json', assertDriveCode);
      const mergedContext = {
        id: 'drive-file-fixture',
        name: 'fixture.png',
        groupKey: 'dt:fixture',
        whatsappMessage: 'fixture message',
        shouldNotify: true,
        codexDryRun: false,
        oversizedPublishEnvelope: 'x'.repeat(1024 * 1024),
        modifiedTime: '2026-07-10T00:00:00.000Z',
        appProperties: { published: 'true' },
      };
      const result = executeAssertDrive(mergedContext);
      const projected = result?.[0]?.json || {};
      if (
        projected.groupKey !== mergedContext.groupKey ||
        projected.whatsappMessage !== mergedContext.whatsappMessage ||
        projected.driveAudit?.state !== 'verified' ||
        Object.prototype.hasOwnProperty.call(projected, 'oversizedPublishEnvelope')
      ) {
        errors.push('Assert Drive Published bounded-context replay returned an invalid projection.');
      }
      let rejectedUnpublished = false;
      try {
        executeAssertDrive(
          { id: 'drive-file-fixture', appProperties: { published: 'false' } },
        );
      } catch {
        rejectedUnpublished = true;
      }
      if (!rejectedUnpublished) {
        errors.push('Assert Drive Published replay must reject published=false.');
      }
    } catch (error) {
      errors.push(`Assert Drive Published bounded-context replay failed: ${error.message}`);
    }
  }
  const collectTargets = (workflow.connections['Collect Publish Results']?.main?.[0] || []).map((edge) => edge.node);
  if (!collectTargets.includes('Verify Published Artifacts')) {
    errors.push('Collect Publish Results must feed Verify Published Artifacts.');
  }
  if (collectTargets.includes('Update File') || collectTargets.includes('Inform Success (1)')) {
    errors.push('Collect Publish Results must not directly feed Update File or Inform Success in QA-safe topology.');
  }
  const finalSwitchTargets = workflow.connections['Switch Final Dry Run']?.main || [];
  const normalTargets = (finalSwitchTargets[0] || []).map((edge) => edge.node).sort();
  const dryTargets = (finalSwitchTargets[1] || []).map((edge) => edge.node).sort();
  for (const required of ['Update File']) {
    if (!normalTargets.includes(required)) errors.push(`Switch Final Dry Run normal output must feed ${required}.`);
  }
  const verifyTargets = (workflow.connections['Verify Published Artifacts']?.main?.[0] || []).map((edge) => edge.node);
  if (!verifyTargets.includes('Attach Verified Publish Artifacts')) {
    errors.push('Verify Published Artifacts must feed Attach Verified Publish Artifacts.');
  }
  const attachedTargets = (workflow.connections['Attach Verified Publish Artifacts']?.main?.[0] || []).map((edge) => edge.node);
  if (!attachedTargets.includes('Switch Final Dry Run')) {
    errors.push('Attach Verified Publish Artifacts must feed Switch Final Dry Run.');
  }
  const updateTargets = (workflow.connections['Update File']?.main?.[0] || []).map((edge) => edge.node);
  if (!updateTargets.includes('Merge Drive Result and Context')) {
    errors.push('Update File must feed Merge Drive Result and Context.');
  }
  const mergeTargets = (workflow.connections['Merge Drive Result and Context']?.main?.[0] || []).map((edge) => edge.node);
  if (!mergeTargets.includes('Assert Drive Published')) {
    errors.push('Merge Drive Result and Context must feed Assert Drive Published.');
  }
  const mergeParameters = nodeByName.get('Merge Drive Result and Context')?.parameters || {};
  if (mergeParameters.mode !== 'combine' || mergeParameters.combineBy !== 'combineByPosition') {
    errors.push('Merge Drive Result and Context must combine Drive output and notification context by position.');
  }
  const driveTargets = (workflow.connections['Assert Drive Published']?.main?.[0] || []).map((edge) => edge.node);
  for (const required of ['Inform Success (1)', 'Cleanup Temp Files']) {
    if (!driveTargets.includes(required)) errors.push(`Assert Drive Published must feed ${required}.`);
  }
  if (dryTargets.length !== 1 || dryTargets[0] !== 'Cleanup Temp Files') {
    errors.push('Switch Final Dry Run dry-run output must feed only Cleanup Temp Files.');
  }
  const httpUrl = String(nodeByName.get('HTTP Request')?.parameters?.url || '');
  const usesManagedSocialGateway = httpUrl.includes('/v1/social-publish/operations');
  if ((!httpUrl.includes('codexDryRun') || !httpUrl.includes('127.0.0.1:8788/meta-review/healthz')) && !usesManagedSocialGateway) {
    errors.push('HTTP Request URL must use local orb health endpoint during codexDryRun.');
  }
  if (usesManagedSocialGateway) {
    const httpParameters = nodeByName.get('HTTP Request')?.parameters || {};
    if (httpParameters.contentType !== 'json' || httpParameters.specifyBody !== 'json') {
      errors.push('Managed social publish gateway must use n8n JSON transport, not raw transport.');
    }
    if (!String(httpParameters.jsonBody || '').includes('JSON.stringify')) {
      errors.push('Managed social publish gateway JSON body expression is missing.');
    }
    if (Object.prototype.hasOwnProperty.call(httpParameters, 'body')) {
      errors.push('Managed social publish gateway must not retain a raw body because n8n returns it as a stream.');
    }
  }
  const verificationCommand = String(nodeByName.get('Verify Published Artifacts')?.parameters?.command || '');
  if (!verificationCommand.includes('verify-published-artifacts.js')) {
    errors.push('Verify Published Artifacts must call the external verifier.');
  }
  const collectCode = String(nodeByName.get('Collect Publish Results')?.parameters?.jsCode || '');
  const processHttpCode = String(nodeByName.get('Process HTTP Publish Result')?.parameters?.jsCode || '');
  if (!processHttpCode.includes('const simulatedRemoteId =') || !processHttpCode.includes('id: simulatedRemoteId')) {
    errors.push('Process HTTP Publish Result dry-run must return a synthetic Graph-compatible ID for polling dependencies.');
  }
  for (const required of ['mediaKind', 'publishMode', 'providerMediaId', 'firstSubmitted']) {
    if (!collectCode.includes(required)) errors.push(`Collect Publish Results must use the media-aware delivery contract (${required}).`);
  }
  const verifierScript = fs.existsSync(VERIFY_PUBLISHED_ARTIFACTS_SCRIPT)
    ? fs.readFileSync(VERIFY_PUBLISHED_ARTIFACTS_SCRIPT, 'utf8')
    : '';
  if (!verifierScript.includes('facebookCompositePost') || !verifierScript.includes('facebookReadObjectId')) {
    errors.push('verify-published-artifacts.js must safely verify Facebook composite post IDs through their numeric attached media.');
  }
  for (const required of ['expectedMediaKind', 'facebookStaticPost', 'not_applicable_for_static_image', 'video_alt_text_not_supported']) {
    if (!verifierScript.includes(required)) errors.push(`verify-published-artifacts.js must verify images separately from video (${required}).`);
  }
  if (!String(nodeByName.get('Inform Success (1)')?.parameters?.remoteJid || '').includes('N8N_DEFAULT_TEST_PHONE')) {
    errors.push('Inform Success (1) must use N8N_DEFAULT_TEST_PHONE.');
  }
  if (!String(nodeByName.get('Inform Success (2)')?.parameters?.text || '').includes("$('Assert Drive Published').first().json.whatsappMessage")) {
    errors.push('Inform Success (2) must read the verified message instead of the Evolution response.');
  }

  const validateScript = path.join(runtimePaths.repoRoot, 'scripts', 'validate-livia-workflow.js');
  const staticValidation = spawnSync('node', [validateScript, WORKFLOW_PATH], {
    cwd: runtimePaths.repoRoot,
    encoding: 'utf8',
  });
  if (staticValidation.status !== 0) {
    errors.push(staticValidation.stdout || staticValidation.stderr || 'validate-livia-workflow failed.');
  }

  if (errors.length) {
    console.error(JSON.stringify({ ok: false, errors }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    workflowPath: WORKFLOW_PATH,
    processCommandLength: command.length,
    buildGraphCommandLength: bqCommand.length,
  }, null, 2));
}

function replayProcessMedia(executionId) {
  const summary = summarizeExecution(executionId);
  const writeJson = summary.runData['Write File']?.[0]?.data?.main?.[0]?.[0]?.json;
  if (!writeJson?.fileName) {
    throw new Error(`Execution ${executionId} has no Write File output to replay.`);
  }
  const downloadJson = summary.runData['Download File']?.[0]?.data?.main?.[0]?.[0]?.json || {};
  const payload = {
    inputFile: writeJson.fileName,
    mimeType: downloadJson.mimeType || '',
    name: downloadJson.name || writeJson.fileName,
    size: Number(downloadJson.size || 0),
    tmpDir: runtimePaths.tmpDir,
  };
  const result = spawnSync('node', [PROCESS_SCRIPT, '--payload', JSON.stringify(payload)], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status || 1);
  }
  const parsed = JSON.parse(result.stdout);
  console.log(JSON.stringify({
    ok: true,
    executionId: String(executionId),
    sourceBytes: parsed.sourceBytes,
    outputBytes: parsed.outputBytes,
    optimized: parsed.optimized,
    optimizationProfile: parsed.optimizationProfile,
    uploadEligible: parsed.uploadEligible,
    blockReason: parsed.blockReason,
    bestFrameSeconds: parsed.bestFrame?.bestFrameSeconds,
    candidateFrameCount: Array.isArray(parsed.candidateThumbs) ? parsed.candidateThumbs.length : 0,
    warnings: parsed.warnings,
  }, null, 2));
}

function replayBuildGraph(executionId) {
  const summary = summarizeExecution(executionId);
  const payload = summary.runData['BQ - Build Publish Context']?.[0]?.data?.main?.[0]?.[0]?.json;
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Execution ${executionId} has no BQ - Build Publish Context output to replay.`);
  }
  const started = Date.now();
  const result = spawnSync('node', [BUILD_GRAPH_SCRIPT, '--payload', JSON.stringify(payload)], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status || 1);
  }
  const parsed = JSON.parse(result.stdout);
  const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
  const instagramUploads = jobs.filter((job) => job.platform === 'instagram' && job.phase === 'upload');
  const threadsUploads = jobs.filter((job) => job.platform === 'threads' && job.phase === 'upload');
  const facebookFinishes = jobs.filter((job) => job.platform === 'facebook' && job.step === 'reels_finish');
  console.log(JSON.stringify({
    ok: true,
    executionId: String(executionId),
    elapsedMs: Date.now() - started,
    jobCount: parsed.jobCount,
    jobKinds: parsed.jobKinds,
    platformSummary: parsed.platformSummary,
    outputBytes: Buffer.byteLength(result.stdout),
    graphApiV24Jobs: jobs.filter((job) => /v24\.0/i.test(String(job.url || ''))).length,
    instagramCoverRequests: instagramUploads.map((job) => ({
      unit: job.unit,
      coverUrl: job.jsonRequest?.cover_url || '',
      thumbOffset: job.jsonRequest?.thumb_offset,
      altTextSubmitted: Boolean(job.jsonRequest?.alt_text),
    })),
    threadsAccessibilityRequests: threadsUploads.map((job) => ({
      unit: job.unit,
      mediaType: job.jsonRequest?.media_type || '',
      altTextSubmitted: Boolean(job.jsonRequest?.alt_text),
    })),
    facebookTitleRequests: facebookFinishes.map((job) => ({
      unit: job.unit,
      title: job.jsonRequest?.title || '',
    })),
  }, null, 2));
}

async function main() {
  const command = process.argv[2] || 'inspect';
  if (command === 'inspect') {
    printInspect(flag('--execution', latestExecutionId()));
    return;
  }
  if (command === 'audit') {
    auditExecution(flag('--execution', latestExecutionId()));
    return;
  }
  if (command === 'validate') {
    validateWorkflow();
    return;
  }
  if (command === 'replay-process-media') {
    replayProcessMedia(flag('--execution', latestExecutionId()));
    return;
  }
  if (command === 'replay-build-graph') {
    replayBuildGraph(flag('--execution', latestExecutionId()));
    return;
  }
  if (command === 'latest') {
    printInspect(latestExecutionId());
    return;
  }
  if (command === 'retry') {
    throw new Error(
      'Livia retry is disabled: the QA runner must never reload variables or restart Orb itself. Use the controlled runtime runbook after an explicit dry-run and operator review.',
    );
  }
  if (command === 'restore-progress') {
    restoreInterruptedProgress(flag('--execution', latestExecutionId()));
    return;
  }
  throw new Error(`Unknown Livia QA command: ${command}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
