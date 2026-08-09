'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const {
  BRAND_STYLE_VERSION,
  COVER_SCHEMA,
  buildCoverPlan,
  buildCoverPrompt,
  buildDeliveryCoverUrl,
  validateCoverArtifact,
} = require('../scripts/livia/reel-cover-contract');
const {
  codes,
  patchWorkflow,
  validate: validatePatchedWorkflow,
} = require('../scripts/patch-livia-ai-reel-covers');
const {
  compactResult,
  contractPayload,
  executeSource,
} = require('../scripts/livia/build-platform-job-graph');

const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'livia', 'livia.current.json');
const BUILD_GRAPH_SCRIPT = path.join(__dirname, '..', 'scripts', 'livia', 'build-platform-job-graph.js');
const BUILD_GRAPH_SOURCE = path.join(__dirname, '..', 'compose2-current.js');

function fixturePng(size = 2048) {
  const buffer = Buffer.alloc(size, 0);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
  Buffer.from('IHDR').copy(buffer, 12);
  buffer.writeUInt32BE(1024, 16);
  buffer.writeUInt32BE(1536, 20);
  return buffer;
}

function fixtureInput(overrides = {}) {
  const frameUrl = 'https://res.cloudinary.com/espacofacial/video/upload/so_3.2,f_jpg/reel.mp4';
  return {
    id: 'media-1',
    quantity: 1,
    mediaKind: 'video',
    visualSource: {
      mediaId: 'media-1',
      groupKey: 'reel-1',
      groupOrder: 0,
      sourceMediaKind: 'video',
      finalUrl: 'https://res.cloudinary.com/espacofacial/video/upload/reel.mp4',
    },
    finalUrl: 'https://res.cloudinary.com/espacofacial/video/upload/reel.mp4',
    frameCandidates: [{ url: frameUrl, timestampSeconds: 3.2, rank: 0, confidence: 0.98 }],
    output: JSON.stringify({
      items: [{
        groupOrder: 0,
        selectedFrameUrl: frameUrl,
        selectedFrameRank: 0,
        bestFrameSeconds: 3.2,
        title: 'Editorial facial care moment',
        summary: 'A clinician prepares a facial care moment in the studio.',
        visualDescription: 'Warm studio light, visible subject, neutral background.',
      }],
    }),
    videoAnalysis: {
      analysis: {
        summary: 'A clinician prepares a facial care moment in the studio.',
        visualDescription: 'Warm studio light, visible subject, neutral background.',
      },
    },
    ...overrides,
  };
}

function planFor(overrides = {}) {
  const current = fixtureInput(overrides);
  return buildCoverPlan({
    mediaId: current.visualSource.mediaId,
    groupKey: current.visualSource.groupKey,
    groupOrder: current.visualSource.groupOrder,
    sourceUrl: current.visualSource.finalUrl,
    frame: {
      selectedFrameUrl: current.frameCandidates[0].url,
      bestFrameSeconds: current.frameCandidates[0].timestampSeconds,
      selectedFrameRank: current.frameCandidates[0].rank,
    },
    candidates: current.frameCandidates,
    visualSummary: overrides.visualSummary || current.videoAnalysis.analysis.summary,
    visualDescription: overrides.visualDescription || current.videoAnalysis.analysis.visualDescription,
    editorialTitle: overrides.editorialTitle || 'Editorial facial care moment',
  });
}

async function runCodeNode(code, { inputItems = [], json = {}, vars = {}, nodeJson = {} } = {}) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const input = {
    all: () => inputItems,
    first: () => inputItems[0],
    item: inputItems[0],
  };
  const lookup = () => ({ item: { json: nodeJson } });
  const execute = new AsyncFunction('require', 'Buffer', '$input', '$json', '$vars', '$', code);
  const result = await execute.call({
    helpers: {
      prepareBinaryData: async (buffer, fileName, mimeType) => ({
        data: Buffer.from(buffer).toString('base64'),
        fileName,
        mimeType,
      }),
    },
  }, require, Buffer, input, json, vars, lookup);
  return Array.isArray(result) ? result : [result];
}

test('cover plan is deterministic and editorial changes invalidate the artifact identity', () => {
  const first = planFor();
  const repeat = planFor();
  const changedTitle = planFor({ editorialTitle: 'A different editorial story.' });
  const changedFrame = planFor({ frameCandidates: [{ url: 'https://res.cloudinary.com/espacofacial/video/upload/so_5.7,f_jpg/reel.mp4', timestampSeconds: 5.7, rank: 0 }] });

  assert.equal(first.schema, COVER_SCHEMA);
  assert.equal(first.brandStyleVersion, BRAND_STYLE_VERSION);
  assert.equal(first.artifactKey, repeat.artifactKey);
  assert.match(first.artifactKey, /^[a-f0-9]{64}$/);
  assert.notEqual(first.artifactKey, changedTitle.artifactKey);
  assert.notEqual(first.artifactKey, changedFrame.artifactKey);
  assert.match(first.cloudinaryPublicId, new RegExp(first.artifactKey + '$'));
});

test('prompt and artifact validation enforce editorial safety and portrait quality', () => {
  const prompt = buildCoverPrompt({
    summary: 'A real patient appears in a calm studio setting.',
    visualDescription: 'Preserve the visible person and treatment room.',
    editorialTitle: 'Real Reel context',
  });
  for (const forbidden of ['price', 'offer', 'procedure name', 'CTA', 'diagnosis', 'medical claim', 'before-and-after']) {
    assert.match(prompt, new RegExp(`Do not add text.*${forbidden}`, 'i'));
  }
  assert.equal(validateCoverArtifact({ buffer: fixturePng(), mimeType: 'image/png', width: 1024, height: 1536 }).valid, true);
  assert.equal(validateCoverArtifact({ buffer: fixturePng(), mimeType: 'image/png' }).valid, true);
  assert.equal(validateCoverArtifact({ buffer: Buffer.alloc(200), mimeType: 'image/png', width: 1536, height: 1024 }).valid, false);
  assert.match(buildDeliveryCoverUrl('https://res.cloudinary.com/espacofacial/image/upload/v1/reel-cover.png'), /c_fill,ar_9:16/);
  assert.match(buildDeliveryCoverUrl('https://res.cloudinary.com/espacofacial/image/upload/v1/reel-cover.png'), /Espa%C3%A7o%20Facial/);
});

test('candidate adds the provider request and deterministic Cloudinary upload without changing the default rollout', () => {
  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
  const candidate = patchWorkflow(workflow);
  validatePatchedWorkflow(candidate);
  const nodes = new Map(candidate.nodes.map((node) => [node.name, node]));
  const openAi = nodes.get('OpenAI Livia Reel Cover Edit');
  const upload = nodes.get('Upload Livia Reel Cover');
  const fields = openAi.parameters.bodyParameters.parameters;

  assert.equal(candidate.meta.codexAiReelCover.defaultMode, 'off');
  assert.deepEqual(candidate.meta.codexAiReelCover.modes, ['off', 'shadow', 'active']);
  assert.equal(openAi.parameters.url, 'https://api.openai.com/v1/images/edits');
  assert.equal(openAi.parameters.contentType, 'multipart-form-data');
  assert.ok(fields.some((field) => field.name === 'image[]' && field.inputDataFieldName === 'data'));
  assert.equal(openAi.credentials.openAiApi.id, 'd5x9D1q8y2QXDeUD');
  assert.equal(upload.parameters.additionalFieldsFile.public_id, '={{ $json.coverPublicId }}');
  assert.equal(upload.credentials.cloudinaryApi.id, '60cg2qgxCV0YLKpD');
});

test('provider failure is converted to a cached frame fallback and retry reuses it without regeneration', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'livia-reel-cover-test-'));
  try {
    const plan = planFor();
    const context = {
      ...fixtureInput(),
      coverMode: 'active',
      coverModel: plan.model,
      coverSize: plan.size,
      coverPrompt: plan.prompt,
      coverArtifactKey: plan.artifactKey,
      coverIdentity: plan.artifactKey,
      coverIdentityPayload: plan.identity,
    };
    const sourceItem = {
      json: context,
      binary: { data: { mimeType: 'image/png', data: fixturePng().toString('base64') } },
      pairedItem: { item: 0 },
    };
    const generated = await runCodeNode(codes.normalizeOpenai, {
      inputItems: [sourceItem],
      json: { data: [{ b64_json: fixturePng().toString('base64') }] },
      vars: { LIVIA_REEL_COVER_CACHE_ROOT: tempRoot },
      nodeJson: context,
    });
    assert.equal(generated[0].json.coverGenerationStatus, 'ready_for_upload');
    assert.equal(generated[0].json.coverQuality.valid, true);
    assert.equal(generated[0].binary.data.mimeType, 'image/png');

    const failed = await runCodeNode(codes.normalizeOpenai, {
      inputItems: [sourceItem],
      json: { error: 'provider_timeout' },
      vars: { LIVIA_REEL_COVER_CACHE_ROOT: tempRoot },
      nodeJson: context,
    });
    assert.equal(failed[0].json.coverResult.coverStatus, 'fallback_frame');
    assert.equal(failed[0].json.coverResult.coverSource, 'frame');
    assert.equal(failed[0].json.coverResult.reason, 'openai_response_missing_b64_json');
    assert.ok(fs.existsSync(path.join(tempRoot, `${plan.artifactKey}.json`)));

    const retried = await runCodeNode(codes.prepare, {
      inputItems: [sourceItem],
      vars: { LIVIA_REEL_COVER_MODE: 'active', LIVIA_REEL_COVER_CACHE_ROOT: tempRoot },
      nodeJson: context,
    });
    assert.equal(retried[0].json.coverGenerationStatus, 'cached_result');
    assert.equal(retried[0].json.coverResult.coverStatus, 'fallback_frame');
    assert.equal(retried[0].json.coverResult.coverArtifactKey, plan.artifactKey);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('valid provider artifact is accepted and the full graph contracts keep non-Reels unchanged', () => {
  const plan = planFor();
  const encoded = fixturePng().toString('base64');
  assert.ok(encoded.length > 1024);
  assert.equal(plan.outputFormat, 'png');

  const raw = execFileSync(process.execPath, [BUILD_GRAPH_SCRIPT, '--assert-job-graph-contracts'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, LIVIA_BUILD_JOB_GRAPH_SOURCE: BUILD_GRAPH_SOURCE },
    encoding: 'utf8',
  });
  const result = JSON.parse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.aiCoverContracts.aiCover, 'canonical_cover_url');
  assert.equal(result.aiCoverContracts.failureFallback, 'frame');
  assert.equal(result.aiCoverContracts.nonReels, 'unchanged');
  assert.equal(result.resumeIdentityContracts.coverChangeInvalidates, true);
});

test('full synthetic dry-run promotes an AI Reel cover into Instagram while preserving the normal job graph', () => {
  const source = fs.readFileSync(BUILD_GRAPH_SOURCE, 'utf8');
  const payload = contractPayload('ai-reel', ['video']);
  const coverUrl = 'https://res.cloudinary.com/espacofacial/image/upload/c_fill,ar_9:16/ai-cover.jpg';
  const cover = {
    schema: COVER_SCHEMA,
    coverStatus: 'ai',
    coverSource: 'ai',
    coverUrl,
    coverAssetUrl: 'https://res.cloudinary.com/espacofacial/image/upload/ai-cover.png',
    coverArtifactKey: 'c'.repeat(64),
    coverIdentity: 'c'.repeat(64),
  };
  const rawMedia = (payload.combinedMediaItems || []).map((item) => item.json);
  payload.combinedMediaItems = rawMedia;
  payload.normalizedCombinedMediaItems = rawMedia;
  for (const item of rawMedia) {
      if (item?.sourceMediaKind === 'video') {
        const frameUrl = 'https://example.invalid/ai-reel-0-cover.jpg';
        item.bestFrame = {
          selectedFrameUrl: frameUrl,
          bestFrameSeconds: 1,
          selectedFrameRank: 1,
          selectedFrameSource: 'editorial_verified',
          candidates: [{ url: frameUrl, timestampSeconds: 1, rank: 1, confidence: 1 }],
        };
        item.reelCover = cover;
      }
  }

  const raw = executeSource(source, payload);
  const result = compactResult(raw, payload, BUILD_GRAPH_SOURCE);
  const instagram = result.jobs.find((job) => job.platform === 'instagram' && job.phase === 'upload' && job.unit === 'bss');
  const body = instagram.jsonRequest;

  assert.equal(body.cover_url, coverUrl);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'thumb_offset'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'thumbnail_url'), false);
  assert.equal(instagram.text.coverStatus, 'ai');
  assert.equal(instagram.text.coverArtifactKey, cover.coverArtifactKey);
  assert.equal(result.platformSummary.instagram.total, 6);
});
