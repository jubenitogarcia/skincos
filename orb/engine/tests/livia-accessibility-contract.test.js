'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const {
  NODE_NAME,
  patchWorkflow,
} = require('../scripts/patch-livia-accessibility-contract');
const {
  patchCode: patchFacebookCarouselDependency,
} = require('../scripts/patch-livia-facebook-carousel-contract');
const {
  assessAccessibilityContract,
  assessMediaEvidence,
  buildDelivery,
} = require('../scripts/livia/verify-published-artifacts');

function mediaItem({ id, order, kind, support, expected = 'Descrição editorial', submitted = expected }) {
  return {
    sourceMediaId: id,
    groupOrder: order,
    semanticJobKey: `livia:v2:${id}`,
    mediaKind: kind,
    support,
    expectedAltText: expected,
    submittedAltText: submitted,
  };
}

function contract(items) {
  const required = items.filter((item) => item.support === 'required');
  return {
    schema: 'livia.media-alt-text.v1',
    orderedBy: 'groupOrder',
    items,
    requiredCount: required.length,
    submittedRequiredCount: required.filter((item) => item.submittedAltText).length,
    unsupportedCount: items.filter((item) => item.support === 'unsupported').length,
  };
}

function mediaEvidence(items) {
  return {
    schema: 'livia.media-evidence.v1',
    orderedBy: 'groupOrder',
    items,
  };
}

test('accessibility workflow patch replaces the group-level first-alt lookup with correlated media evidence', () => {
  const legacyCode = [
    'const __prAsArray = (value) => Array.isArray(value) ? value : [];',
    'const __prAsObject = (value) => value && typeof value === "object" ? value : {};',
    'const __prStr = (value) => String(value || "");',
    'function buildPublishVerificationTargets(completedRows, groupKey) { return []; }',
    '',
    'const codexDryRun = false;',
  ].join('\n');
  const workflow = {
    id: 'WGXr4vYkv9UoJ8zc',
    nodes: [{ name: NODE_NAME, type: 'n8n-nodes-base.code', parameters: { jsCode: legacyCode } }],
  };
  const patched = patchWorkflow(workflow);
  const code = patched.nodes[0].parameters.jsCode;
  assert.match(code, /accessibilityContract/);
  assert.match(code, /semanticJobKey/);
  assert.match(code, /required alt_text is missing or does not match editorial evidence/);
  assert.deepEqual(patchWorkflow(patched), patched);
});

test('Facebook carousel dependency patch rejects positional attachment assembly', () => {
  const legacyCode = [
    'function resolveDependencyValue(state, job, fieldName) { return []; }',
    '',
    'function applyPublishDependency(state, job, requestBody) { return requestBody; }',
  ].join('\n');
  const patched = patchFacebookCarouselDependency(legacyCode);
  assert.match(patched, /sourceMediaCount/);
  assert.match(patched, /sourceMediaIds/);
  assert.match(patched, /perdeu a ordem ou identidade semântica/);
  assert.equal(patchFacebookCarouselDependency(patched), patched);
});

test('Threads requires alt text for image and video carousel children, while Instagram records video as explicit unsupported', () => {
  const threads = assessAccessibilityContract({
    platform: 'threads',
    accessibilityContract: contract([
      mediaItem({ id: 'image-1', order: 0, kind: 'image', support: 'required', expected: 'Imagem clínica' }),
      mediaItem({ id: 'video-2', order: 1, kind: 'video', support: 'required', expected: 'Vídeo clínico' }),
    ]),
  });
  assert.equal(threads.status, 'accepted');
  assert.equal(threads.requiredCount, 2);

  const instagramMixed = assessAccessibilityContract({
    platform: 'instagram',
    accessibilityContract: contract([
      mediaItem({ id: 'image-1', order: 0, kind: 'image', support: 'required', expected: 'Imagem clínica' }),
      mediaItem({ id: 'video-2', order: 1, kind: 'video', support: 'unsupported', expected: 'Vídeo clínico', submitted: '' }),
    ]),
  });
  assert.equal(instagramMixed.status, 'accepted');
  assert.equal(instagramMixed.requiredCount, 1);
  assert.equal(instagramMixed.unsupportedCount, 1);
});

test('missing or mismatched required alt text turns provider verification into a failure', () => {
  const accessibility = assessAccessibilityContract({
    platform: 'instagram',
    accessibilityContract: contract([
      mediaItem({ id: 'image-1', order: 0, kind: 'image', support: 'required', expected: 'Imagem clínica', submitted: '' }),
    ]),
  });
  assert.equal(accessibility.status, 'failed');
  assert.equal(accessibility.reason, 'alt_text_not_submitted_or_mismatched');

  const delivery = buildDelivery({
    platform: 'instagram',
    unit: 'bss',
    mediaKind: 'image',
    publishMode: 'static',
    providerObjectId: 'provider-image-1',
    expected: { caption: 'Legenda validada' },
    submitted: {},
    accessibilityContract: contract([
      mediaItem({ id: 'image-1', order: 0, kind: 'image', support: 'required', expected: 'Imagem clínica', submitted: '' }),
    ]),
  }, {
    statusCode: 200,
    body: { id: 'provider-image-1', permalink: 'https://instagram.com/p/example', media_type: 'IMAGE', caption: 'Legenda validada' },
  });
  assert.equal(delivery.state, 'failed');
  assert.ok(delivery.errors.some((entry) => entry.startsWith('accessibility_failed:')));
});

test('Facebook carousel verification rejects a provider post that omits a later source attachment', () => {
  const evidenceItems = [
    { sourceMediaId: 'video-1', groupOrder: 0, semanticJobKey: 'livia:v2:video-1', mediaKind: 'video', providerMediaId: '10' },
    { sourceMediaId: 'image-2', groupOrder: 1, semanticJobKey: 'livia:v2:image-2', mediaKind: 'image', providerMediaId: '20' },
  ];
  const target = {
    platform: 'facebook',
    unit: 'bss',
    mediaKind: 'carousel',
    publishMode: 'carousel',
    providerObjectId: '111_222',
    providerMediaId: '10',
    expected: { caption: 'Legenda baseada nas duas mídias' },
    submitted: {},
    accessibilityContract: contract([
      mediaItem({ id: 'video-1', order: 0, kind: 'video', support: 'unsupported', expected: 'Vídeo editorial', submitted: '' }),
      mediaItem({ id: 'image-2', order: 1, kind: 'image', support: 'unsupported', expected: 'Imagem editorial', submitted: '' }),
    ]),
    mediaEvidenceContract: mediaEvidence(evidenceItems),
  };
  const provider = {
    statusCode: 200,
    body: {
      id: '111_222',
      permalink_url: 'https://www.facebook.com/111/posts/222',
      message: 'Legenda baseada nas duas mídias',
      from: { id: '111' },
      attachments: { data: [{ media_type: 'video', target: { id: '10' } }, { media_type: 'photo', target: { id: '20' } }] },
    },
  };
  assert.equal(assessMediaEvidence(target, provider.body).status, 'accepted');
  assert.equal(buildDelivery(target, provider).state, 'verified');

  const missingLater = {
    ...provider,
    body: { ...provider.body, attachments: { data: [{ media_type: 'video', target: { id: '10' } }] } },
  };
  const delivery = buildDelivery(target, missingLater);
  assert.equal(delivery.state, 'failed');
  assert.ok(delivery.errors.includes('media_evidence_failed:facebook_composite_attachment_identity_missing'));
});

test('offline job-graph matrix proves per-media accessibility without calling the gateway', () => {
  const engine = path.resolve(__dirname, '..');
  const result = spawnSync(process.execPath, [
    'scripts/livia/build-platform-job-graph.js',
    '--assert-job-graph-contracts',
  ], {
    cwd: engine,
    env: {
      ...process.env,
      LIVIA_BUILD_JOB_GRAPH_SOURCE: path.join(engine, 'compose2-current.js'),
      N8N_RUNTIME_HOME: path.join(engine, '.tmp-livia-accessibility-contract'),
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.accessibilityContracts.threadsVideo, 'submitted');
  assert.equal(report.accessibilityContracts.instagramVideo, 'unsupported');
  assert.equal(report.jobGraphContracts.length, 5);
});
