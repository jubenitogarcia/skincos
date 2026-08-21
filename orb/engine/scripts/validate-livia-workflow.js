#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const workflowPath = process.argv[2] || 'workflows/livia.verify.json';
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function getNode(name) {
  return workflow.nodes.find((node) => node.name === name);
}

function codeOf(name) {
  return String(getNode(name)?.parameters?.jsCode || '');
}

function commandOf(name) {
  return String(getNode(name)?.parameters?.command || '');
}

function typeOf(name) {
  return String(getNode(name)?.type || '');
}

function connectionExists(source, target, outputIndex = undefined) {
  const groups = workflow.connections?.[source]?.main || [];
  return groups.some((group, groupIndex) =>
    Array.isArray(group) &&
    (outputIndex === undefined || groupIndex === outputIndex) &&
    group.some((connection) =>
      connection?.node === target &&
      connection?.type === 'main'
    )
  );
}

function incomingCount(name) {
  let total = 0;
  for (const conn of Object.values(workflow.connections || {})) {
    for (const group of (conn.main || [])) {
      for (const edge of (group || [])) {
        if (edge?.node === name) total += 1;
      }
    }
  }
  return total;
}

function compileCode(code) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction(
    '$input',
    '$json',
    '$execution',
    '$getWorkflowStaticData',
    '$items',
    '$',
    '$now',
    `"use strict";\n${code}`,
  );
}

function compileRuntimeCode(code) {
  return new Function(
    '$input',
    '$json',
    '$execution',
    '$getWorkflowStaticData',
    '$items',
    '$',
    '$now',
    `"use strict";\n${code}`,
  );
}

function runCode(code, env = {}) {
  return compileRuntimeCode(code)(
    env.$input || { all: () => [] },
    env.$json || {},
    env.$execution || { id: 'exec-test' },
    env.$getWorkflowStaticData || (() => ({})),
    env.$items || (() => []),
    env.$ || (() => ({
      item: { json: {} },
      first: () => ({ json: {} }),
      all: () => [],
    })),
    env.$now,
  );
}

function validateStructure() {
  const names = new Set(workflow.nodes.map((node) => node.name));

  for (const name of [
    'Prepare Media Items',
    'List Files',
    'Get Credential Tokens',
    'Download File',
    'Write File',
    'Process Media Asset',
    'Prepare Media Upload Batch',
    'Read Media Asset',
    'Upload Main Media',
    'Attach Uploaded Main Media Metadata',
    'Livia',
    'Hydrate Publish Context',
    'Switch Publish Route',
    'Prepare HTTP Publish Request',
    'Wait',
    'HTTP Request',
    'Process HTTP Publish Result',
    'Record Publish Progress',
    'Collect Publish Results',
    'Verify Published Artifacts',
    'Attach Verified Publish Artifacts',
    'Switch Final Dry Run',
    'Prepare Drive Publication Marks',
    'Collect Drive Publication Marks',
    'Assert Drive Published',
    'Release Livia Publication Lock',
  ]) {
    assert(names.has(name), `Missing node: ${name}`);
  }

  for (const removed of [
    'Extract Times and Split Out and Compose (1)',
    'Compose (1)',
    'Read Thumb',
    'Read File',
    'Switch',
    'Optimize',
    'Frame Analysis + Save Thumb',
    'Parse Frame Analysis JSON',
    'Prepare Request',
    'If',
    'Compose (2)',
    'Compose (3)',
    'Loop (2)',
    'Route Prepare Request',
  ]) {
    assert(!names.has(removed), `${removed} must not exist in the canonical topology`);
  }

  const hasCompactBuildQueue = names.has('Build Publish Queue');
  const modularBuildQueueNodes = [
    'BQ - Normalize Hydrated Envelope',
    'BQ - Validate Bootstrap Inputs',
    'BQ - Build Publish Context',
    'BQ - Build Platform Job Graph',
    'BQ - Validate Job Graph',
    'BQ - Seed Publish State',
    'BQ - Emit First Job',
  ];
  const hasModularBuildQueue = modularBuildQueueNodes.every((name) => names.has(name));
  assert(hasCompactBuildQueue || hasModularBuildQueue, 'Workflow must have either compact Build Publish Queue or modular BQ nodes');

  assert(connectionExists('List Files', 'Prepare Media Items'), 'List Files must feed Prepare Media Items');
  const usesManagedTokenGateway = String(getNode('Get Credential Tokens')?.parameters?.url || '').includes('/v1/token-metadata');
  assert(
    connectionExists('Get Credential Tokens', 'Prepare Media Items') ||
      connectionExists('Get Credential Tokens', 'List Files') ||
      connectionExists('Get Credential Tokens', 'Validate Publish Token Health'),
    'Get Credential Tokens must feed the media preparation chain',
  );
  const usesVisualEvidenceTopology = names.has('Prepare Livia Visual Contract');
  assert(
    usesVisualEvidenceTopology
      ? connectionExists('Validate Publish Token Health', 'List Livia Source Folders') &&
          connectionExists('List Livia Source Folders', 'List Files')
      : connectionExists('Validate Publish Token Health', 'List Files'),
    'Token preflight must reach List Files through the approved source-folder scope',
  );
  assert(connectionExists('Prepare Media Items', 'Download File'), 'Prepare Media Items must feed Download File');
  assert(connectionExists('Download File', 'Write File'), 'Download File must feed Write File');
  assert(connectionExists('Write File', 'Process Media Asset'), 'Write File must feed Process Media Asset');
  assert(connectionExists('Process Media Asset', 'Prepare Media Upload Batch'), 'Process Media Asset must feed Prepare Media Upload Batch');
  assert(connectionExists('Prepare Media Upload Batch', 'Read Media Asset'), 'Prepare Media Upload Batch must feed Read Media Asset');
  assert(connectionExists('Read Media Asset', 'Upload Main Media'), 'Read Media Asset must feed Upload Main Media');
  assert(connectionExists('Upload Main Media', 'Attach Uploaded Main Media Metadata'), 'Upload Main Media must feed Attach Uploaded Main Media Metadata');
  if (usesVisualEvidenceTopology) {
    for (const name of [
      'Prepare Livia Visual Contract',
      'Read Livia Visual Asset',
      'Merge Livia Visual Asset and Contract',
      'Assert Livia Visual Input',
      'Loop Livia Media Evidence',
      'Route Livia Media Evidence',
      'Attach Image Visual Evidence',
      'Analyze Video',
      'Merge Video Analysis Response',
      'Normalize Video Analysis',
      'Assert Livia Video Analysis',
      'Build Livia Group Evidence',
      'Merge Livia Output and Visual Contract',
      'Assert Livia Visual Analysis',
    ]) {
      assert(names.has(name), `Missing visual-evidence node: ${name}`);
    }
    assert(connectionExists('Attach Uploaded Main Media Metadata', 'Prepare Livia Visual Contract'), 'Uploaded media must enter the visual-evidence contract');
    assert(connectionExists('Prepare Livia Visual Contract', 'Read Livia Visual Asset'), 'Visual contract must read the current item asset');
    assert(connectionExists('Read Livia Visual Asset', 'Merge Livia Visual Asset and Contract'), 'Read visual asset must join its contract');
    assert(connectionExists('Merge Livia Visual Asset and Contract', 'Assert Livia Visual Input'), 'Merged visual asset must fail closed before evidence routing');
    assert(connectionExists('Assert Livia Visual Input', 'Loop Livia Media Evidence'), 'Validated visual asset must enter the per-item loop');
    assert(connectionExists('Loop Livia Media Evidence', 'Route Livia Media Evidence', 1), 'Visual-evidence loop must route every item by media type');
    assert(connectionExists('Route Livia Media Evidence', 'Attach Image Visual Evidence', 1), 'Image items must carry confirmed visual evidence');
    assert(connectionExists('Route Livia Media Evidence', 'Analyze Video', 0), 'Video items must use the mandatory video analysis path');
    assert(connectionExists('Analyze Video', 'Merge Video Analysis Response'), 'Video analysis response must join its source item');
    assert(connectionExists('Merge Video Analysis Response', 'Normalize Video Analysis'), 'Video analysis must be normalized');
    assert(connectionExists('Normalize Video Analysis', 'Assert Livia Video Analysis'), 'Malformed video analysis must fail before editorial AI');
    assert(connectionExists('Attach Image Visual Evidence', 'Loop Livia Media Evidence'), 'Image evidence must rejoin the per-item loop');
    assert(connectionExists('Assert Livia Video Analysis', 'Loop Livia Media Evidence'), 'Validated video evidence must rejoin the per-item loop');
    assert(connectionExists('Loop Livia Media Evidence', 'Build Livia Group Evidence', 0), 'Ordered media evidence must be composed at group completion');
    if (names.has('Prepare Livia CRM Catalog Context')) {
      assert(connectionExists('Build Livia Group Evidence', 'Prepare Livia CRM Catalog Context'), 'The editorial agent must receive the deterministic CRM unit context');
      assert(connectionExists('Prepare Livia CRM Catalog Context', 'Livia'), 'The editorial agent must receive the CRM unit context before analysis');
    } else {
      assert(connectionExists('Build Livia Group Evidence', 'Livia'), 'The editorial agent must receive the full evidence group');
    }
    assert(connectionExists('Livia', 'Merge Livia Output and Visual Contract'), 'Editorial output must rejoin the validated evidence contract');
    assert(connectionExists('Merge Livia Output and Visual Contract', 'Assert Livia Visual Analysis'), 'Editorial output must be checked against visual evidence');
    const hasReelCoverLane = names.has('Attach Livia Reel Cover Context');
    assert(
      connectionExists('Assert Livia Visual Analysis', 'Hydrate Publish Context') ||
        (hasReelCoverLane &&
          connectionExists('Assert Livia Visual Analysis', 'Prepare Livia Reel Cover Jobs') &&
          connectionExists('Attach Livia Reel Cover Context', 'Hydrate Publish Context')),
      'Only validated editorial output may enter publication context',
    );
  } else {
    assert(connectionExists('Attach Uploaded Main Media Metadata', 'Livia'), 'Attach Uploaded Main Media Metadata must feed Livia');
    assert(connectionExists('Livia', 'Hydrate Publish Context'), 'Livia must feed Hydrate Publish Context');
  }
  if (hasCompactBuildQueue) {
    assert(connectionExists('Hydrate Publish Context', 'Build Publish Queue'), 'Hydrate Publish Context must feed Build Publish Queue');
    assert(connectionExists('Build Publish Queue', 'Switch Publish Route'), 'Build Publish Queue must feed Switch Publish Route');
  } else {
    assert(connectionExists('Hydrate Publish Context', 'BQ - Normalize Hydrated Envelope'), 'Hydrate Publish Context must feed BQ - Normalize Hydrated Envelope');
    assert(connectionExists('BQ - Normalize Hydrated Envelope', 'BQ - Validate Bootstrap Inputs'), 'BQ - Normalize Hydrated Envelope must feed BQ - Validate Bootstrap Inputs');
    assert(connectionExists('BQ - Validate Bootstrap Inputs', 'BQ - Build Publish Context'), 'BQ - Validate Bootstrap Inputs must feed BQ - Build Publish Context');
    assert(names.has('Assert Livia Publication Window'), 'Missing node: Assert Livia Publication Window');
    assert(
      connectionExists('BQ - Build Publish Context', 'Assert Livia Publication Window') &&
        connectionExists('Assert Livia Publication Window', 'BQ - Build Platform Job Graph'),
      'BQ publication context must pass the publication-window guard before platform job generation',
    );
    assert(connectionExists('BQ - Build Platform Job Graph', 'BQ - Validate Job Graph'), 'BQ - Build Platform Job Graph must feed BQ - Validate Job Graph');
    assert(connectionExists('BQ - Validate Job Graph', 'BQ - Seed Publish State'), 'BQ - Validate Job Graph must feed BQ - Seed Publish State');
    assert(connectionExists('BQ - Seed Publish State', 'BQ - Emit First Job'), 'BQ - Seed Publish State must feed BQ - Emit First Job');
    assert(connectionExists('BQ - Emit First Job', 'Switch Publish Route'), 'BQ - Emit First Job must feed Switch Publish Route');
  }
  assert(connectionExists('Switch Publish Route', 'Prepare HTTP Publish Request', 0), 'Switch Publish Route output 0 must feed Prepare HTTP Publish Request');
  assert(connectionExists('Switch Publish Route', 'Collect Publish Results', 1), 'Switch Publish Route output 1 must feed Collect Publish Results');
  assert(connectionExists('Prepare HTTP Publish Request', 'Wait'), 'Prepare HTTP Publish Request must feed Wait');
  assert(connectionExists('Wait', 'HTTP Request'), 'Wait must feed HTTP Request');
  assert(connectionExists('HTTP Request', 'Process HTTP Publish Result'), 'HTTP Request must feed Process HTTP Publish Result');
  assert(connectionExists('Process HTTP Publish Result', 'Switch Publish Route'), 'Process HTTP Publish Result must feed Switch Publish Route');
  assert(connectionExists('Process HTTP Publish Result', 'Record Publish Progress'), 'Every accepted provider response must be stored in the durable publish progress ledger');
  assert(connectionExists('Collect Publish Results', 'Verify Published Artifacts'), 'Collect Publish Results must verify published artifacts first');
  assert(connectionExists('Verify Published Artifacts', 'Attach Verified Publish Artifacts'), 'Verifier output must be parsed before final effects');
  assert(connectionExists('Attach Verified Publish Artifacts', 'Switch Final Dry Run'), 'Verified artifacts must feed Switch Final Dry Run');
  assert(!connectionExists('Collect Publish Results', 'Inform Success (1)'), 'Collect Publish Results must not directly feed Inform Success (1)');
  assert(!connectionExists('Collect Publish Results', 'Update File'), 'Collect Publish Results must not directly feed Update File');
  assert(!connectionExists('Collect Publish Results', 'Cleanup Temp Files'), 'Collect Publish Results must not directly feed Cleanup Temp Files');
  assert(!names.has('Merge Drive Result and Context'), 'Drive publication must not use a positional merge that can discard carousel source files');
  assert(connectionExists('Switch Final Dry Run', 'Prepare Drive Publication Marks', 0), 'Switch Final Dry Run normal output must fan out verified Drive source files');
  assert(connectionExists('Prepare Drive Publication Marks', 'Update File'), 'Every verified Drive source file must be sent to Update File');
  const updateEdges = workflow.connections?.['Update File']?.main?.[0] || [];
  assert(updateEdges.some((edge) => edge?.node === 'Collect Drive Publication Marks'), 'Update File must feed every API readback into the Drive publication collector');
  assert(connectionExists('Collect Drive Publication Marks', 'Assert Drive Published'), 'Collected Drive readbacks must feed Assert Drive Published');
  const notificationNode = ['Inform Success (1)', 'Inform Success (2)'].find((name) => names.has(name));
  if (notificationNode) {
    assert(connectionExists('Assert Drive Published', notificationNode), 'Verified Drive update must feed notification');
  }
  assert(connectionExists('Assert Drive Published', 'Cleanup Temp Files'), 'Verified Drive update must feed cleanup');
  assert(connectionExists('Switch Final Dry Run', 'Cleanup Temp Files', 1), 'Switch Final Dry Run dry-run output must feed Cleanup Temp Files');
}

function validateSyntax() {
  for (const node of workflow.nodes) {
    const code = node.parameters?.jsCode;
    if (!code) continue;
    try {
      compileCode(code);
    } catch (error) {
      errors.push(`Code syntax error in ${node.name}: ${error.message}`);
    }
  }
}

function validateContracts() {
  const prepareMediaItems = codeOf('Prepare Media Items');
  const processMediaAssetCommand = commandOf('Process Media Asset');
  const prepareBatch = String(getNode('Prepare Media Upload Batch')?.parameters?.jsonOutput || '');
  const readMediaAssetFileSelector = String(getNode('Read Media Asset')?.parameters?.fileSelector || '');
  const hydrate = codeOf('Hydrate Publish Context');
  const hasCompactBuildQueue = !!getNode('Build Publish Queue');
  const buildQueue = codeOf('Build Publish Queue');
  const bqBuildPlatformJobGraph = codeOf('BQ - Build Platform Job Graph');
  const bqBuildPlatformJobGraphCommand = commandOf('BQ - Build Platform Job Graph');
  const publicationWindowGuard = codeOf('Assert Livia Publication Window');
  const bqSeedPublishState = codeOf('BQ - Seed Publish State');
  const bqValidateJobGraph = codeOf('BQ - Validate Job Graph');
  const switchOutput = String(getNode('Switch Publish Route')?.parameters?.output || '');
  const prepareHttp = codeOf('Prepare HTTP Publish Request');
  const processHttp = codeOf('Process HTTP Publish Result');
  const publicationWindow = codeOf('Assert Livia Publication Window');
  const collect = codeOf('Collect Publish Results');
  const tokenHealthCommand = commandOf('Validate Publish Token Health');
  const verifyCommand = commandOf('Verify Published Artifacts');
  const attachVerified = codeOf('Attach Verified Publish Artifacts');
  const prepareDriveMarks = codeOf('Prepare Drive Publication Marks');
  const collectDriveMarks = codeOf('Collect Drive Publication Marks');
  const assertDrive = codeOf('Assert Drive Published');
  const attach = codeOf('Attach Uploaded Main Media Metadata');
  const waitAmount = String(getNode('Wait')?.parameters?.amount || '');
  const downloadFileId = String(getNode('Download File')?.parameters?.fileId?.value || '');
  const writeFileName = String(getNode('Write File')?.parameters?.fileName || '');
  const finalDryRunOutput = String(getNode('Switch Final Dry Run')?.parameters?.output || '');
  const httpParameters = getNode('HTTP Request')?.parameters || {};
  const httpNode = getNode('HTTP Request');
  const prepareHttpNode = getNode('Prepare HTTP Publish Request');
  const httpUrl = String(httpParameters.url || '');
  const httpJsonBody = String(httpParameters.jsonBody || '');
  const notifyPhone = String(getNode('Inform Success (1)')?.parameters?.remoteJid || '');
  const telegramText = String(getNode('Inform Success (2)')?.parameters?.text || '');
  const updateOptions = JSON.stringify(getNode('Update File')?.parameters?.options || {});
  const workflowText = JSON.stringify(workflow);

  assert(prepareMediaItems.includes('__liviaCompose1'), 'Prepare Media Items must repopulate __liviaCompose1');
  assert(!prepareMediaItems.includes('waitUntil'), 'Prepare Media Items must not emit waitUntil');
  assert(prepareMediaItems.includes('livia_selection_today_first_due_v1'), "Prepare Media Items must select only today's earliest due group");
  assert(prepareMediaItems.includes('America/Sao_Paulo'), 'Prepare Media Items must calculate today in America/Sao_Paulo');
  assert(prepareMediaItems.includes('row.targetDate !== todayDate'), 'Prepare Media Items must discard media outside today');
  assert(prepareMediaItems.includes('firstReadyGroup'), 'Prepare Media Items must select one earliest due group');
  assert(!prepareMediaItems.includes('newestPublishTimeMs'), 'Prepare Media Items must not select the newest due group');
  assert(processMediaAssetCommand.includes('process-media-asset.js'), 'Process Media Asset must delegate to scripts/livia/process-media-asset.js');
  assert(processMediaAssetCommand.includes('executionId'), 'Process Media Asset payload must include executionId for isolated temp assets');
  assert(processMediaAssetCommand.length < 2500, `Process Media Asset command must stay small enough for stable expression parsing (${processMediaAssetCommand.length} chars)`);
  const jobGraphScript = path.join(__dirname, 'livia', 'build-platform-job-graph.js');
  const jobGraphSource = fs.readFileSync(jobGraphScript, 'utf8');
  const compose2Source = fs.readFileSync(path.join(__dirname, '..', 'compose2-current.js'), 'utf8');
  const verifierSource = fs.readFileSync(path.join(__dirname, 'livia', 'verify-published-artifacts.js'), 'utf8');
  assert(jobGraphSource.includes('normalizeExternalResult'), 'Livia job graph must accept both direct n8n jobs and jobs envelopes.');
  assert(jobGraphSource.includes('assertOutputContract'), 'Livia job graph must self-test its output contract.');
  assert(jobGraphSource.includes('assertJobGraphContracts'), 'Livia job graph must test image, Reel and carousel fixtures without the gateway.');
  assert(jobGraphSource.includes('assertFacebookCarouselRepresentation'), 'Livia job graph must reject Facebook carousel jobs that drop, duplicate, or reorder media.');
  assert(jobGraphSource.includes('semanticJobKey'), 'Livia job graph must derive a semantic durable resume identity.');
  assert(jobGraphSource.includes('assertResumeIdentityContracts'), 'Livia job graph must prove queue-index changes do not alter resume identity.');
  assert(jobGraphSource.includes('invalidateIncompleteCarouselResume'), 'Livia resume logic must invalidate partial Instagram carousel attempts before reusing child containers');
  assert(jobGraphSource.includes('groupResumeContextKey'), 'Livia resume logic must inspect group-scoped carousel container results');
  assert(jobGraphSource.includes('normalizeThreadsCarouselJob'), 'Livia job graph must keep Threads carousel child and parent request contracts distinct');
  assert(jobGraphSource.includes("request.media_type = 'IMAGE'"), 'Livia Threads carousel children must explicitly request media_type=IMAGE');
  assert(jobGraphSource.includes("request.media_type = 'CAROUSEL'"), 'Livia Threads carousel parent must explicitly request media_type=CAROUSEL');
  assert(compose2Source.includes('facebookUseReels'), 'Livia must use Facebook Reels only for a single source video.');
  assert(compose2Source.includes('sourceMediaIds') && compose2Source.includes('sourceMediaCount'), 'Livia must preserve Facebook attachment source identity/count before the gateway.');
  assert(!compose2Source.includes('usando apenas o 1º vídeo'), 'Livia must not publish only the first video from a carousel.');
  assert(!compose2Source.includes('vídeo detectado em grupo não-reels; ignorado'), 'Livia must not silently discard a video from a mixed carousel.');
  assert(prepareHttp.includes('JSON.stringify(ids)'), 'Prepare HTTP Publish Request must serialize Threads carousel children as a JSON array');
  assert(prepareBatch.includes('uploadEligible'), 'Prepare Media Upload Batch must preserve uploadEligible from the media processor');
  assert(prepareBatch.includes('blockReason'), 'Prepare Media Upload Batch must preserve the media block reason');
  assert(prepareBatch.includes('upload blocked before Cloudinary'), 'Prepare Media Upload Batch must block unsafe files before Cloudinary');
  if (prepareBatch.includes('uploadRole')) {
    assert(prepareBatch.includes('main_media'), 'Prepare Media Upload Batch must emit main_media when using uploadRole batching');
    assert(prepareBatch.includes('technicalFrameCandidates'), 'Prepare Media Upload Batch must preserve technical frame candidates');
    assert(prepareBatch.includes('bestFrame'), 'Prepare Media Upload Batch must preserve the selected technical frame');
  }
  assert(readMediaAssetFileSelector.includes('$json.uploadRole'), 'Read Media Asset must branch by uploadRole');
  assert(readMediaAssetFileSelector.includes('mainMediaFilePath'), 'Read Media Asset must support mainMediaFilePath');
  assert(readMediaAssetFileSelector.includes('thumbPath'), 'Read Media Asset must support thumbPath');
  assert(!readMediaAssetFileSelector.includes('Read Thumb'), 'Read Media Asset must not reference Read Thumb');
  assert(!readMediaAssetFileSelector.includes('Read File'), 'Read Media Asset must not reference Read File');

  if (hasCompactBuildQueue) {
    assert(hydrate.includes('tokenVaultContext'), 'Hydrate Publish Context must emit tokenVaultContext');
    assert(hydrate.includes('combinedMediaItems'), 'Hydrate Publish Context must emit combinedMediaItems');
    assert(hydrate.includes('$("Attach Uploaded Main Media Metadata").item') || hydrate.includes("$('Attach Uploaded Main Media Metadata').item"), 'Hydrate Publish Context must use paired lookup for Attach Uploaded Main Media Metadata');
    assert(hydrate.includes('$("Get Credential Tokens").first()') || hydrate.includes("$('Get Credential Tokens').first()"), 'Hydrate Publish Context must use first() lookup for Get Credential Tokens');
  } else {
    assert(typeOf('BQ - Build Platform Job Graph') === 'n8n-nodes-base.executeCommand', 'BQ - Build Platform Job Graph must be externalized as Execute Command');
    assert(bqBuildPlatformJobGraphCommand.includes('build-platform-job-graph.js'), 'BQ - Build Platform Job Graph must delegate to scripts/livia/build-platform-job-graph.js');
    assert(bqBuildPlatformJobGraphCommand.includes('--payload'), 'BQ - Build Platform Job Graph command must pass the input payload to the external script');
    assert(bqBuildPlatformJobGraphCommand.includes('--payload-file'), 'BQ - Build Platform Job Graph must transport the payload through the private file contract');
    assert(!bqBuildPlatformJobGraphCommand.includes('JSON.stringify(payload)'), 'BQ - Build Platform Job Graph must not embed the full payload in argv');
    assert(publicationWindowGuard.includes('_liviaBuildJobGraphPayloadFile') && publicationWindowGuard.includes('fs.renameSync'), 'Assert Livia Publication Window must atomically persist the job-graph payload before Execute Command');
    assert(!/\/opt\/skincos\/current\/source|\b(?:ORB_ROOT|N8N_ROOT)\b/.test(bqBuildPlatformJobGraphCommand), 'BQ - Build Platform Job Graph must use an immutable workflow runtime root.');
    assert(/\/opt\/skincos\/releases\/[0-9a-f]{40}\/source\/orb\/engine/.test(bqBuildPlatformJobGraphCommand), 'BQ - Build Platform Job Graph must use a pinned immutable release root.');
    assert(bqBuildPlatformJobGraphCommand.length < 2500, `BQ - Build Platform Job Graph command must stay small enough for stable expression parsing (${bqBuildPlatformJobGraphCommand.length} chars)`);
    assert(bqBuildPlatformJobGraph.length < 1000, `BQ - Build Platform Job Graph must not be a large Code node anymore (${bqBuildPlatformJobGraph.length} chars)`);
    assert(!bqBuildPlatformJobGraph.includes('...payload,\n    jobs: builtJobs'), 'BQ - Build Platform Job Graph must not spread the full bootstrap payload into output');
    assert(bqValidateJobGraph.includes('rawPayload.stdout'), 'BQ - Validate Job Graph must accept stdout from Execute Command');
    assert(bqValidateJobGraph.includes('JSON.parse(rawPayload.stdout)'), 'BQ - Validate Job Graph must parse Execute Command stdout JSON');
    assert(bqValidateJobGraph.includes('codexPayloadCompacted'), 'BQ - Validate Job Graph must preserve compacted payload marker');
  }
  assert(!hydrate.includes('$items('), 'Hydrate Publish Context must not use $items lookups');
  assert(
    !hydrate.includes('.all(') ||
      hydrate.includes('$input.all(') ||
      hydrate.includes('$("Attach Uploaded Main Media Metadata").all()') ||
      hydrate.includes("$('Attach Uploaded Main Media Metadata').all()"),
    'Hydrate Publish Context may read only the explicitly collected uploaded-media items',
  );

  if (hasCompactBuildQueue) {
    assert(buildQueue.includes('buildPublishJobsFromLiviaInput'), 'Build Publish Queue must reuse buildPublishJobsFromLiviaInput');
    assert(buildQueue.includes('prepareRequestRoute: "prepare_http"'), 'Build Publish Queue must emit prepare_http');
    assert(buildQueue.includes('state.pending = builtJobs.slice(1)') || buildQueue.includes('state.pending = qaAwareJobs.slice(1)'), 'Build Publish Queue must keep the remaining queue in pending');
    assert(buildQueue.includes('state.inflight = {}'), 'Build Publish Queue must reset inflight state');
    assert(!buildQueue.includes('$items('), 'Build Publish Queue must not use $items lookups');
    assert(!buildQueue.includes('namedNodeItem(name, "first")'), 'Build Publish Queue must not actively depend on named first() lookups');
    assert(!buildQueue.includes('Route Prepare Request'), 'Build Publish Queue must not reference Route Prepare Request');
  } else {
    assert(bqSeedPublishState.includes('LIVIA_CODEX_DRY_RUN'), 'BQ - Seed Publish State must read LIVIA_CODEX_DRY_RUN');
    assert(bqSeedPublishState.includes('LIVIA_ALLOW_MANUAL_PUBLISH'), 'BQ - Seed Publish State must require explicit opt-in for manual publication');
    assert(bqSeedPublishState.includes('$execution?.mode'), 'BQ - Seed Publish State must identify manual executions safely');
    assert(bqSeedPublishState.includes('manual_execution_safe_default'), 'BQ - Seed Publish State must dry-run manual executions by default');
    assert(bqSeedPublishState.includes('state.pending = qaAwareJobs.slice(1)') || bqSeedPublishState.includes('state.pending = pendingJobs.slice(1)'), 'BQ - Seed Publish State must keep dry-run-aware pending jobs');
    assert(bqSeedPublishState.includes('state.codexDryRun = codexDryRun'), 'BQ - Seed Publish State must persist codexDryRun in state');
    assert(!bqSeedPublishState.includes('...payload,\n    codexDryRun'), 'BQ - Seed Publish State must not re-spread compacted payload');
  }

  assert(switchOutput.includes('prepareRequestRoute'), 'Switch Publish Route must route by prepareRequestRoute');
  assert(!switchOutput.includes('ready === true'), 'Switch Publish Route must not route by ready anymore');
  assert(httpUrl.includes('/v1/social-publish/operations'), 'HTTP Request must route real social publishing through the Token Vault gateway');
  assert(httpJsonBody.includes('platform: $json.platform'), 'HTTP Request gateway payload must retain the target platform');
  assert(httpJsonBody.includes('unit: $json.unit'), 'HTTP Request gateway payload must retain the target unit');
  assert(httpNode?.retryOnFail === false && !Object.prototype.hasOwnProperty.call(httpNode || {}, 'maxTries'), 'HTTP Request must not retry mutating social operations automatically.');
  assert(prepareHttpNode?.retryOnFail === false, 'Prepare HTTP Publish Request must not retry the outbound queue transition automatically.');
  assert(publicationWindow.includes('livia_publication_lock_v1') && publicationWindow.includes("fs.openSync(publicationLockPath, 'wx'"), 'Assert Livia Publication Window must atomically acquire the Livia publication lease.');
  assert(typeOf('Release Livia Publication Lock') === 'n8n-nodes-base.executeCommand', 'Release Livia Publication Lock must be an Execute Command node.');
  assert(commandOf('Release Livia Publication Lock').includes('release-publication-lock.js'), 'Release Livia Publication Lock must call the immutable helper.');
  assert(connectionExists('Cleanup Temp Files', 'Release Livia Publication Lock'), 'Cleanup Temp Files must release the Livia publication lease.');

  if (hasCompactBuildQueue) {
    assert(prepareHttp.includes('runPrepareRequestLifecycle'), 'Prepare HTTP Publish Request must reuse runPrepareRequestLifecycle');
  }
  assert(prepareHttp.includes('prepareRequestRoute: "wait"'), 'Prepare HTTP Publish Request must emit wait route');
  assert(prepareHttp.includes('state.inflight = preparedJson') || prepareHttp.includes('state.inflight = removeNulls({ ...preparedJson })'), 'Prepare HTTP Publish Request must mark inflight');
  if (hasCompactBuildQueue) {
    assert(processHttp.includes('runPrepareRequestLifecycle'), 'Process HTTP Publish Result must reuse runPrepareRequestLifecycle');
    assert(processHttp.includes('__prRouteItem("prepare_http"'), 'Process HTTP Publish Result must emit prepare_http when continuing');
    assert(processHttp.includes('__prRouteItem("finalize"'), 'Process HTTP Publish Result must emit finalize when queue ends');
  } else {
    assert(processHttp.includes('routeItem("prepare_http"'), 'Process HTTP Publish Result must emit prepare_http when continuing');
    assert(processHttp.includes('routeItem("finalize"'), 'Process HTTP Publish Result must emit finalize when queue ends');
  }
  assert(processHttp.includes('state.completed.push(resultJson)'), 'Process HTTP Publish Result must accumulate completed jobs');
  assert(prepareHttp.includes('childrenPublishRunIndexes'), 'Prepare HTTP Publish Request must resolve carousel child container ids');
  assert(prepareHttp.includes('ids.join(",")'), 'Prepare HTTP Publish Request must serialize carousel children in the Meta format');
  assert(prepareHttp.includes('sourceMediaCount') && prepareHttp.includes('sourceMediaIds'), 'Prepare HTTP Publish Request must validate the complete Facebook attachment contract before the gateway.');
  assert(prepareHttp.includes('perdeu a ordem ou identidade semântica'), 'Prepare HTTP Publish Request must fail closed on Facebook attachment order/identity drift.');
  assert(processHttp.includes('resolvePrepareRequestContext'), 'Process HTTP Publish Result must recover the prepared request context after HTTP nodes replace the input payload');
  assert(processHttp.includes('resolvedStateKey'), 'Process HTTP Publish Result must resolve the matching inflight state deterministically during retries');
  assert(!processHttp.includes('$("Prepare HTTP Publish Request").item'), 'Process HTTP Publish Result must not use named-node lookups inside the task runner');
  assert(!processHttp.includes('$("Wait").item'), 'Process HTTP Publish Result must not use named-node lookups inside the task runner');
  assert(processHttp.includes('codex-dry-run simulated publish result'), 'Process HTTP Publish Result must simulate publish results during Codex dry-run');
  assert(processHttp.includes('const simulatedRemoteId ='), 'Process HTTP Publish Result must create a synthetic ID during Codex dry-run');
  assert(processHttp.includes('id: simulatedRemoteId'), 'Codex dry-run response body must include a synthetic Graph-compatible ID');
  assert(processHttp.includes('compactResumeRecord'), 'Process HTTP Publish Result must emit a sanitized durable progress record');
  assert(processHttp.includes('semanticJobKey: str(source.semanticJobKey'), 'Process HTTP Publish Result must preserve semanticJobKey in durable progress records');
  assert(processHttp.includes('executionId: str(execId'), 'Process HTTP Publish Result must carry the execution lease owner into the progress ledger');
  assert(processHttp.includes('facebook_static_photo_already_posted_recovery'), 'Process HTTP Publish Result must recover an already-published Facebook static photo without duplicating it');
  assert(codeOf('BQ - Seed Publish State').includes('resumeBySemanticKey'), 'BQ - Seed Publish State must restore durable completed jobs by semantic identity');
  assert(codeOf('BQ - Seed Publish State').includes('completedSemanticJobKeys'), 'BQ - Seed Publish State must not use sequential indexes as durable resume keys');
  assert(codeOf('BQ - Validate Job Graph').includes('resumeCompleted: asArray(payload.resumeCompleted)'), 'BQ - Validate Job Graph must preserve durable completed jobs');
  assert(commandOf('Record Publish Progress').includes('publish-progress-ledger.js'), 'Record Publish Progress must call the private runtime ledger script');
  assert(fs.readFileSync(path.join(__dirname, 'livia', 'publish-progress-ledger.js'), 'utf8').includes('heartbeat(executionId)'), 'Publish progress ledger must refresh the execution lease after accepted provider responses');
  assert(!codeOf('BQ - Seed Publish State').includes('completedRunIndexes'), 'BQ - Seed Publish State must not use publishRunIndex as a durable resume identity');
  assert(collect.includes('buildFinalCollectorRows'), 'Collect Publish Results must reuse buildFinalCollectorRows');
  assert(collect.includes('buildPublishVerificationTargets'), 'Collect Publish Results must produce provider verification targets');
  assert(collect.includes('mediaKindFor'), 'Collect Publish Results must resolve image, video, and carousel delivery separately');
  assert(collect.includes('publishMode'), 'Collect Publish Results must distinguish Reels from static posts');
  assert(collect.includes('providerMediaId'), 'Collect Publish Results must preserve the provider media id alongside the final post id');
  assert(collect.includes('firstSubmitted'), 'Collect Publish Results must aggregate submitted fields across upload and publish phases');
  assert(collect.includes('mediaEvidenceContract') && collect.includes('providerMediaId'), 'Collect Publish Results must preserve ordered provider media evidence for every source asset.');
  assert(!collect.includes('platform === "facebook"\n        ? __prStr(startBody.video_id'), 'Collect Publish Results must not require a Reels video_id for every Facebook post');
  assert(collect.includes('codexDryRun'), 'Collect Publish Results must propagate codexDryRun');
  assert(collect.includes('shouldNotify: codexDryRun ? false'), 'Collect Publish Results must disable notifications during Codex dry-run');
  assert(collect.includes('ready: true'), 'Collect Publish Results must emit ready=true');
  assert(collect.includes('delete sd.__pr[execId]'), 'Collect Publish Results must clear __pr for the execution');
  assert(finalDryRunOutput.includes('codexDryRun'), 'Switch Final Dry Run must route by codexDryRun');
  const usesManagedSocialGateway = httpUrl.includes('/v1/social-publish/operations');
  assert(
    (httpUrl.includes('codexDryRun') && httpUrl.includes('127.0.0.1:8788/meta-review/healthz')) || usesManagedSocialGateway,
    'HTTP Request must support Codex dry-run or use the managed social publish gateway',
  );
  if (usesManagedSocialGateway) {
    assert(
      httpParameters.contentType === 'json' || httpParameters.specifyBody === 'json',
      'Managed social publish gateway must use n8n JSON transport, not raw transport',
    );
    assert(httpParameters.specifyBody === 'json', 'Managed social publish gateway must use the JSON body editor');
    assert(String(httpParameters.jsonBody || '').includes('JSON.stringify'), 'Managed social publish gateway must preserve its JSON payload expression');
    assert(!Object.prototype.hasOwnProperty.call(httpParameters, 'body'), 'Managed social publish gateway must not retain a raw body, which turns the response into a stream');
  }
  assert(commandOf('Cleanup Temp Files').includes('isAllowedCleanupDir'), 'Cleanup Temp Files must delete per-execution asset directories safely');
  assert(tokenHealthCommand.includes('validate-publish-token-health.js'), 'Validate Publish Token Health must invoke the versioned credential preflight');
  assert(tokenHealthCommand.includes('. /etc/skincos/orb-business.env'), 'Token preflight must load the same protected bearer used by the verifier');
  const tokenHealthScript = fs.readFileSync(path.join(__dirname, 'livia', 'validate-publish-token-health.js'), 'utf8');
  for (const required of ['gatewayChecks', 'gateway_missing', 'checkThroughGateway']) {
    assert(tokenHealthScript.includes(required), `Token preflight must fail closed on gateway authorization (${required})`);
  }
  assert(verifyCommand.includes('verify-published-artifacts.js'), 'Verify Published Artifacts must call the external verifier');
  assert(verifyCommand.includes('--payload -') && verifyCommand.includes('printf %s'), 'Verifier must receive a bounded payload through stdin');
  assert(/\/opt\/skincos\/releases\/[0-9a-f]{40}\/source\/orb\/engine\/scripts\/livia\/verify-published-artifacts\.js/.test(verifyCommand), 'Verifier must invoke the immutable release entrypoint directly');
  assert(!/\/opt\/skincos\/current\/source|\b(?:ORB_ROOT|N8N_ROOT)\b|\/mnt\/c\/|livia-verify-provider-copy-drift-wrapper|--verifier\b/.test(verifyCommand), 'Verifier must not use a mutable root or compatibility wrapper');
  assert(!verifyCommand.includes('Get Credential Tokens') && !verifyCommand.includes('tokenRoot'), 'Verifier must not expose token-vault data in its command line');
  assert(verifierSource.includes('assessMediaEvidence'), 'Published-artifact verification must reject a provider post that omits a source media attachment.');
  assert(verifierSource.includes('facebook_composite_attachment_identity_missing'), 'Published-artifact verification must name missing Facebook carousel attachments causally.');
  assert(attachVerified.includes('result.ok !== true'), 'Verifier failures must stop final effects');
  assert(prepareDriveMarks.includes('driveExpectedFileIds') && prepareDriveMarks.includes('fileIds'), 'Drive fan-out must use the verified source fileIds contract');
  assert(collectDriveMarks.includes("$items('Prepare Drive Publication Marks')"), 'Drive collector must correlate readbacks to the semantic fan-out contract');
  assert(collectDriveMarks.includes('properties.published') && collectDriveMarks.includes('count mismatch'), 'Drive collector must reject missing or unmarked source files');
  assert(assertDrive.includes('expectedFileIds') && assertDrive.includes('verifiedFileIds'), 'Drive verification must assert every source file was marked published=true');
  assert(assertDrive.includes('const finalContext ='), 'Drive verification must project a bounded final context');
  assert(!assertDrive.includes('...original') && !assertDrive.includes('$('), 'Drive verification must not resolve or spread an upstream publish envelope');
  assert(updateOptions.includes('"fields":["*"]'), 'Update File must return properties for verification');
  if (getNode('Inform Success (1)')) {
    assert(notifyPhone.includes('N8N_DEFAULT_TEST_PHONE') && !notifyPhone.includes('555195103563'), 'Notification must use the runtime E.164 phone instead of a hard-coded JID');
  }
  if (getNode('Inform Success (2)')) {
    assert(telegramText.includes("$('Assert Drive Published').first().json.whatsappMessage"), 'Telegram notification must preserve the verified message after Evolution output');
  }
  assert(JSON.stringify(getNode('Hydrate Publish Context')?.parameters || {}).includes('version: \\"v25.0\\"'), 'Hydrate Publish Context must use Graph API v25.0');
  assert(!workflowText.includes('v24.0'), 'Workflow must not retain Graph API v24.0 templates');
  assert(!workflowText.includes('"access_token":"EAA'), 'Workflow export must not contain inline Meta access tokens');

  assert(!attach.includes('Prepare Request'), 'Attach Uploaded Main Media Metadata must not reference Prepare Request anymore');

  assert(waitAmount.includes('waitSeconds'), 'Wait must still depend on waitSeconds');
  assert(downloadFileId.includes("$('Prepare Media Items').item.json.id"), 'Download File must still depend on Prepare Media Items');
  assert(writeFileName.includes('Prepare Media Items'), 'Write File must keep the Prepare Media Items fallback');
}

function validateFixtures() {
  if (!getNode('Build Publish Queue')) {
    return;
  }

  const hydrate = codeOf('Hydrate Publish Context');
  const staticData = {
    __liviaMainUploads: {
      'exec-test': {
        __items: [{
          json: {
            id: 'file-1',
            name: '240626-post.mp4',
            groupKey: '240626-post',
            finalUrl: 'https://res.cloudinary.com/demo/video/upload/v1/demo.mp4',
            facebook: { token_bss: 'fb' },
            instagram: { token_bss: 'ig' },
            threads: { token_bss: 'th' },
          },
        }],
      },
    },
  };
  const hydrateResult = runCode(hydrate, {
    $input: {
      all: () => [{ json: { output: '{"items":[]}' } }],
    },
    $execution: { id: 'exec-test' },
    $getWorkflowStaticData: () => staticData,
    $: (name) => {
      if (name === 'Attach Uploaded Main Media Metadata') return { item: { json: {} } };
      if (name === 'Get Credential Tokens') {
        return {
          first: () => ({
            json: {
              items: [
                { provider: 'facebook', unit: 'BSS', fbId: '1', fbToken: 'fb-token' },
                { provider: 'instagram', unit: 'BSS', igId: '2', igToken: 'ig-token' },
                { provider: 'threads', unit: 'BSS', thId: '3', thToken: 'th-token' },
              ],
            },
          }),
        };
      }
      return { item: { json: {} }, first: () => ({ json: {} }) };
    },
  });

  const hydrateJson = hydrateResult?.[0]?.json || {};
  assert(Array.isArray(hydrateJson.combinedMediaItems) && hydrateJson.combinedMediaItems.length === 1, 'Hydrate Publish Context fixture must emit combinedMediaItems');
  assert(hydrateJson.tokenVaultContext?.facebook?.token_bss === 'fb-token', 'Hydrate Publish Context fixture must normalize tokenVaultContext');

  const collect = codeOf('Collect Publish Results');
  const collectState = {
    __pr: {
      'exec-test': {
        completed: [{
          id: 'file-1',
          groupKey: 'group-1',
          platform: 'instagram',
          phase: 'publish',
          unit: 'bss',
          text: { title: 'Titulo', caption: 'Legenda', alt_text: 'Alt' },
          permalink: 'https://instagram.com/p/demo',
        }],
      },
    },
  };

  const collectResult = runCode(collect, {
    $input: { all: () => [{ json: { prepareRequestRoute: 'finalize' } }] },
    $execution: { id: 'exec-test' },
    $getWorkflowStaticData: () => collectState,
  });

  assert(Array.isArray(collectResult) && collectResult.length >= 1, 'Collect Publish Results fixture must emit final rows');
  assert(collectResult[0]?.json?.ready === true, 'Collect Publish Results fixture must emit ready=true');
}

function validateManualDryRunFixture() {
  if (getNode('Build Publish Queue')) return;

  const seedCode = codeOf('BQ - Seed Publish State');
  const executeSeed = (mode, id, payload = { jobs: [{ platform: 'instagram', publishRunIndex: 0, semanticJobKey: 'livia:v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }], codexPayloadCompacted: true }) => {
    const fn = new Function(
      '$input',
      '$json',
      '$execution',
      '$getWorkflowStaticData',
      '$items',
      '$',
      '$now',
      '$vars',
      `"use strict";\n${seedCode}`,
    );
    return fn(
      { all: () => [] },
      payload,
      { id, mode },
      () => ({}),
      () => [],
      () => ({ item: { json: {} }, first: () => ({ json: {} }), all: () => [] }),
      undefined,
      { LIVIA_CODEX_DRY_RUN: 'false', LIVIA_ALLOW_MANUAL_PUBLISH: 'false' },
    );
  };

  const manual = executeSeed('manual', 'manual-seed');
  const trigger = executeSeed('trigger', 'trigger-seed');
  assert(manual?.[0]?.json?.codexDryRun === true, 'Manual seed fixture must default to codexDryRun=true');
  assert(manual?.[0]?.json?.firstJob?.codexDryRun === true, 'Manual seed fixture must decorate the first job as dry-run');
  assert(trigger?.[0]?.json?.codexDryRun === false, 'Trigger seed fixture must preserve production behavior by default');

  const semanticJobKey = 'livia:v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const job = { platform: 'instagram', publishRunIndex: 0, semanticJobKey };
  const matching = executeSeed('trigger', 'semantic-match', {
    jobs: [job],
    codexPayloadCompacted: true,
    resumeCompleted: [{ ...job, publishRunIndex: 99, lastResponseBody: { id: 'provider-object' } }],
  });
  const mismatched = executeSeed('trigger', 'semantic-mismatch', {
    jobs: [job],
    codexPayloadCompacted: true,
    resumeCompleted: [{ ...job, semanticJobKey: 'livia:v2:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', lastResponseBody: { id: 'stale-provider-object' } }],
  });
  assert(matching?.[0]?.json?.recoveryFinal === true, 'Matching semantic progress must be resumable regardless of its historical queue index');
  assert(mismatched?.[0]?.json?.firstJob?.semanticJobKey === semanticJobKey, 'Mismatched semantic progress must not suppress a current provider job');
}

function validateDrivePublicationMarkFixture() {
  const prepare = codeOf('Prepare Drive Publication Marks');
  const collect = codeOf('Collect Drive Publication Marks');
  const assertDrive = codeOf('Assert Drive Published');
  const source = {
    json: {
      id: 'drive-a',
      fileIds: ['drive-a', 'drive-b', 'drive-c'],
      groupKey: 'dt:fixture',
      whatsappMessage: 'fixture',
      shouldNotify: true,
      codexDryRun: false,
    },
  };
  const prepared = runCode(prepare, {
    $input: { all: () => [source], first: () => source },
  });
  assert(Array.isArray(prepared) && prepared.length === 3, 'Drive mark fan-out fixture must emit one update item per source file');
  const updates = prepared.map((item) => ({ json: { id: item.json.id, properties: { published: 'true' } } }));
  const collected = runCode(collect, {
    $input: { all: () => updates, first: () => updates[0] },
    $items: (name) => name === 'Prepare Drive Publication Marks' ? prepared : [],
  });
  const verified = runCode(assertDrive, {
    $input: { all: () => collected, first: () => collected[0] },
  });
  assert(verified?.[0]?.json?.driveAudit?.verifiedFileCount === 3, 'Drive mark fixture must retain all verified source file IDs');
}

validateStructure();
validateSyntax();
validateContracts();
validateFixtures();
validateManualDryRunFixture();
validateDrivePublicationMarkFixture();

if (errors.length) {
  console.error(`Validation failed for ${workflowPath}`);
  for (const message of errors) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log(`Validation passed for ${workflowPath}`);
