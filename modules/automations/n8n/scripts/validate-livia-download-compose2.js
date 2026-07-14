#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

const workflowPath = process.argv[2] || 'workflows/livia.json';
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const errors = [];

const TMP_DIR = runtimePaths.tmpDir;

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function getNode(name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function nodeExists(name) {
  return workflow.nodes.some((item) => item.name === name);
}

function codeOf(name) {
  return getNode(name).parameters.jsCode || '';
}

function connectionExists(source, target, outputIndex = 0, inputIndex = 0) {
  const groups = workflow.connections?.[source]?.main || [];
  const group = groups[outputIndex] || [];
  return group.some((conn) => conn.node === target && conn.type === 'main' && conn.index === inputIndex);
}

function validateOptimizeExpression() {
  const expr = getNode('Optimize?').parameters.conditions.conditions[0].leftValue;
  const inner = expr.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const evaluate = (json) => {
    const $ = () => ({ item: { json } });
    return new Function('$', `return (${inner});`)($);
  };

  assert(evaluate({ mimeType: 'image/png', name: 'a.png', size: 1000 }) === true, 'Optimize? must optimize PNG');
  assert(evaluate({ mimeType: 'image/jpeg', name: 'a.jpg', size: 1000 }) === false, 'Optimize? must skip small JPG');
  assert(evaluate({ mimeType: 'image/jpeg', name: 'a.jpg', size: 9000000 }) === true, 'Optimize? must optimize large JPG');
  assert(evaluate({ mimeType: 'video/mp4', name: 'a.mp4', size: 1000 }) === true, 'Optimize? must prepare small video');
  assert(evaluate({ mimeType: 'video/mp4', name: 'a.mp4', size: 90000000 }) === true, 'Optimize? must prepare large video');
}

function validateTopology() {
  for (const name of [
    'Read Thumb',
    'Prepare Main Media Upload',
    'Upload Main Media',
    'Attach Uploaded Main Media Metadata',
    'Livia',
  ]) {
    assert(nodeExists(name), `Missing node: ${name}`);
  }

  for (const removed of [
    'Notify Once',
    'Attach Frame Candidate Metadata',
    'Upload Frame Candidate',
    'Attach Uploaded Frame Metadata',
    'Read Main Media For Publish',
    'Merge Main Media Context',
  ]) {
    assert(!nodeExists(removed), `${removed} must not exist in reduced topology`);
  }

  assert(!workflow.nodes.some((node) => node.type === 'n8n-nodes-base.merge'), 'Workflow must not use Merge nodes for Livia media context');
  assert(connectionExists('Is Video?', 'Frame Analysis + Save Thumb', 0), 'Video branch must analyze frames');
  assert(connectionExists('Is Video?', 'Prepare Main Media Upload', 1), 'Image branch must prepare main upload');
  assert(connectionExists('Read Thumb', 'Prepare Main Media Upload', 0), 'Read Thumb must feed Prepare Main Media Upload directly');
  assert(connectionExists('Prepare Main Media Upload', 'Upload Main Media', 0), 'Prepared frame/main uploads must feed Upload Main Media');
  assert(connectionExists('Upload Main Media', 'Attach Uploaded Main Media Metadata', 0), 'Upload Main Media must feed combined metadata attach');
  assert(connectionExists('Attach Uploaded Main Media Metadata', 'Livia', 0), 'Livia must receive only attached main media context');

  const prepareMain = codeOf('Prepare Main Media Upload');
  assert(!/\$items\s*\(/.test(prepareMain), 'Prepare Main Media Upload must not call $items()');
  assert(!/\$\s*\(\s*["'`]/.test(prepareMain), 'Prepare Main Media Upload must not call named-node $()');
  assert(prepareMain.includes('MAX_MAIN_MEDIA_BYTES'), 'Prepare Main Media Upload must guard Code-node file reads by size');
  assert(prepareMain.includes('fs.readFileSync'), 'Prepare Main Media Upload must read the main video binary directly in Code');
  assert(prepareMain.includes('uploadRole: "frame_candidate"'), 'Prepare Main Media Upload must emit frame_candidate items');
  assert(prepareMain.includes('uploadRole: "main_media"'), 'Prepare Main Media Upload must emit main_media items');

  const attachMain = codeOf('Attach Uploaded Main Media Metadata');
  const attachItemsCalls = attachMain.match(/\$items\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g) || [];
  assert(attachItemsCalls.every((call) => call.includes('Prepare Main Media Upload') || call.includes('Compose (1)')), 'Attach Uploaded Main Media Metadata may only call $items("Prepare Main Media Upload") or $items("Compose (1)")');
  assert(attachMain.includes('isFrameCandidateUpload'), 'Attach Uploaded Main Media Metadata must distinguish mixed Cloudinary uploads');
  assert(attachMain.includes('getPrepareUploadItems'), 'Attach Uploaded Main Media Metadata must recover uploadRole from Prepare Main Media Upload when Cloudinary strips input JSON');
  assert(attachMain.includes('getCompose1ItemsFallback'), 'Attach Uploaded Main Media Metadata must recover Compose (1) context when staticData is unavailable');
  assert(attachMain.includes('__liviaFrameUploads'), 'Attach Uploaded Main Media Metadata must cache frame context by execution');
  assert(attachMain.includes('__liviaMainUploads'), 'Attach Uploaded Main Media Metadata must cache main media context by execution');

  const compose2 = codeOf('Compose (2)');
  assert(!/\$items\s*\(/.test(compose2), 'Compose (2) must not call $items()');
  assert(compose2.includes('__liviaMainUploads'), 'Compose (2) must read main uploads from execution cache');
  assert(compose2.includes('__liviaFrameUploads'), 'Compose (2) must read frame uploads from execution cache');
  assert(!compose2.includes('Merge (3)'), 'Compose (2) must not mention Merge (3)');
  assert(!compose2.includes('Main Media Context'), 'Compose (2) must not mention Main Media Context');
}

function runCode(code, args) {
  return new Function(...Object.keys(args), code)(...Object.values(args));
}

function validateCodeSyntax() {
  for (const node of workflow.nodes) {
    const code = node.parameters?.jsCode;
    if (!code) continue;
    try {
      new Function('$input', '$items', '$json', '$binary', '$node', '$getWorkflowStaticData', '$execution', '$', 'require', code);
    } catch (error) {
      errors.push(`Code syntax error in ${node.name}: ${error.message}`);
    }
  }
}

function baseConfigs() {
  return {
    instagram: {
      network: 'facebook.com',
      version: 'v24.0',
      id_bss: 'ig-bss',
      id_nh: 'ig-nh',
      token_bss: 'tok-bss',
      token_nh: 'tok-nh',
      endpoint_1st: 'media',
      endpoint_2nd: 'media_publish',
    },
    facebook: {
      network: 'facebook.com',
      version: 'v24.0',
      id_bss: 'fb-bss',
      id_nh: 'fb-nh',
      token_bss: 'tok-bss',
      token_nh: 'tok-nh',
    },
    threads: {
      network: 'threads.net',
      version: 'v1.0',
      id_bss: 'th-bss',
      id_nh: 'th-nh',
      token_bss: 'tok-bss',
      token_nh: 'tok-nh',
      endpoint_1st: 'threads',
      endpoint_2nd: 'threads_publish',
      use_me: true,
    },
  };
}

function validatePrepareMainMediaUploadFixture() {
  const code = codeOf('Prepare Main Media Upload');
  const prefix = '2306261200_VALID';
  const mainPath = path.join(TMP_DIR, `${prefix}.mp4`);
  const videoBytes = Buffer.from('fake-mp4-for-validator');
  fs.writeFileSync(mainPath, videoBytes);

  try {
    const frameItems = [1, 2, 3, 4].map((rank) => ({
      json: {
        fileName: `${prefix}_temp_cand_0${rank}.jpg`,
        thumbPath: `${prefix}_temp_cand_0${rank}.jpg`,
        candidate: {
          rank,
          timestamp: `00:0${rank}.000`,
          timestampSeconds: rank,
          confidence: 0.9 - rank / 100,
          reason: `frame ${rank}`,
        },
        bestFrame: rank === 1 ? { selectedFrameRank: 1 } : {},
      },
      binary: { data: { id: `thumb-bin-${rank}`, mimeType: 'image/jpeg', fileName: `${prefix}_temp_cand_0${rank}.jpg` } },
    }));

    const output = runCode(code, {
      $input: { all: () => frameItems },
      require,
    });
    const frameUploads = output.filter((item) => item.json.uploadRole === 'frame_candidate');
    const mainUploads = output.filter((item) => item.json.uploadRole === 'main_media');
    assert(output.length === 5, `Prepare Main Media Upload video fixture expected 5 uploads, got ${output.length}`);
    assert(frameUploads.length === 4, `Prepare Main Media Upload expected 4 frame candidates, got ${frameUploads.length}`);
    assert(mainUploads.length === 1, `Prepare Main Media Upload expected 1 main media item, got ${mainUploads.length}`);
    assert(frameUploads.every((item, index) => item.binary?.data?.id === `thumb-bin-${index + 1}`), 'Prepare Main Media Upload must preserve frame binaries');
    assert(frameUploads[0]?.json?.candidate?.rank === 1, 'Prepare Main Media Upload must preserve/derive frame rank');
    assert(mainUploads[0]?.binary?.data?.data === videoBytes.toString('base64'), 'Prepare Main Media Upload must read main video as base64 binary');
    assert(mainUploads[0]?.binary?.data?.fileType === 'video', 'Prepare Main Media Upload main item must be a video binary');
    assert(mainUploads[0]?.json?.mimeType === 'video/mp4', `Prepare Main Media Upload main item must expose video/mp4 JSON mimeType, got ${mainUploads[0]?.json?.mimeType}`);
    assert(mainUploads[0]?.json?.mainMediaUploadWarnings?.includes('main_media_binary_read_in_code_node'), 'Prepare Main Media Upload must annotate direct Code-node reads');

    const imageOutput = runCode(code, {
      $input: {
        all: () => [{
          json: { id: 'img-1', name: '2306261215.jpg', mimeType: 'image/jpeg', groupKey: 'dt:2306261215' },
          binary: { data: { id: 'image-bin', mimeType: 'image/jpeg', fileName: '2306261215.jpg' } },
        }],
      },
      require,
    });
    assert(imageOutput.length === 1 && imageOutput[0]?.json?.uploadRole === 'main_media', 'Prepare Main Media Upload image fixture must return one main_media item');
    assert(imageOutput[0]?.binary?.data?.id === 'image-bin', 'Prepare Main Media Upload image fixture must preserve existing binary');
  } catch (error) {
    errors.push(`Prepare Main Media Upload fixture failed: ${error.message}`);
  } finally {
    try { fs.unlinkSync(mainPath); } catch {}
  }
}

function validateAttachUploadedMainMediaFixture() {
  const code = codeOf('Attach Uploaded Main Media Metadata');
  const executionId = 'validator-exec';
  const staticData = {
    __liviaCompose1: {
      [executionId]: {
        __items: [{
          json: {
            id: 'drive-video-1',
            name: '2306261200_VALID.mp4',
            mimeType: 'video/mp4',
            groupKey: 'dt:2306261200',
            groupOrder: 0,
            publishTime: '2026-06-23T12:00:00-03:00',
            ...baseConfigs(),
          },
        }],
        'dt:2306261200': {
          id: 'drive-video-1',
          name: '2306261200_VALID.mp4',
          mimeType: 'video/mp4',
          groupKey: 'dt:2306261200',
          ...baseConfigs(),
        },
      },
    },
  };

  const thumbUrl = 'https://res.cloudinary.com/demo/image/upload/2306261200_VALID_temp_cand_01.jpg';
  const videoUrl = 'https://res.cloudinary.com/demo/video/upload/2306261200_VALID.mp4';
  const sourceItems = [
    ...[1, 2, 3].map((rank) => ({
      json: {
        uploadRole: 'frame_candidate',
        groupKey: 'dt:2306261200',
        thumbPath: `${TMP_DIR}/2306261200_VALID_temp_cand_0${rank}.jpg`,
        candidate: { rank, timestamp: `00:0${rank}.000`, timestampSeconds: rank, confidence: 0.92 - rank / 100, reason: `frame ${rank}` },
      },
    })),
    {
      json: {
        uploadRole: 'main_media',
        id: 'drive-video-1',
        groupKey: 'dt:2306261200',
        name: '2306261200_VALID.mp4',
        mainMediaFileName: `${TMP_DIR}/2306261200_VALID.mp4`,
        mimeType: 'video/mp4',
      },
    },
  ];
  const uploads = [
    ...[1, 2, 3].map((rank) => ({
      json: {
        secure_url: thumbUrl.replace('thumb.jpg', `thumb_${rank}.jpg`),
        url: thumbUrl.replace('thumb.jpg', `thumb_${rank}.jpg`),
        resource_type: 'image',
        public_id: `2306261200_VALID_temp_cand_0${rank}`,
      },
    })),
    {
      json: {
        secure_url: videoUrl,
        url: videoUrl,
        resource_type: 'video',
        format: 'mp4',
      },
    },
  ];

  try {
    const runAttach = ({ data, dollar }) => runCode(code, {
      $input: { all: () => uploads },
      $items: (name) => {
        if (name === 'Prepare Main Media Upload') return sourceItems;
        if (name === 'Compose (1)') return [{ json: staticData.__liviaCompose1[executionId]['dt:2306261200'] }];
        throw new Error(`Unexpected $items lookup: ${name}`);
      },
      $: dollar || (() => {
        throw new Error('Unexpected named-node lookup');
      }),
      $getWorkflowStaticData: () => data,
      $execution: { id: executionId },
    });

    const output = runAttach({ data: staticData });
    const fallbackOutput = runAttach({
      data: {},
      dollar: (name) => {
        if (name !== 'Compose (1)') throw new Error(`Unexpected named-node lookup: ${name}`);
        return { all: () => [{ json: staticData.__liviaCompose1[executionId]['dt:2306261200'] }] };
      },
    });
    assert(output.length === 1, `Attach Uploaded Main Media Metadata must return only one main_media item, got ${output.length}`);
    assert(fallbackOutput.length === 1, `Attach Uploaded Main Media Metadata fallback must return one main_media item, got ${fallbackOutput.length}`);
    const json = output[0]?.json || {};
    const fallbackJson = fallbackOutput[0]?.json || {};
    assert(json.finalUrl === videoUrl, 'Attach Uploaded Main Media Metadata must preserve main video URL');
    assert(json.frameCandidateCount === 3, `Attach Uploaded Main Media Metadata must attach three frame candidates, got ${json.frameCandidateCount}`);
    assert(json.bestFrame?.selectedFrameUrl === thumbUrl.replace('thumb.jpg', 'thumb_1.jpg'), 'Attach Uploaded Main Media Metadata must attach first uploaded thumbnail URL as bestFrame');
    assert(json.instagram?.id_bss === 'ig-bss' && json.facebook?.id_nh === 'fb-nh' && json.threads?.id_bss === 'th-bss', 'Attach Uploaded Main Media Metadata must rehydrate publish credentials from Compose (1) cache');
    assert(fallbackJson.threads?.token_bss === 'tok-bss' && fallbackJson.threads?.token_nh === 'tok-nh', 'Attach Uploaded Main Media Metadata must rehydrate Threads tokens from Compose (1) fallback when cache is unavailable');
    assert(!fallbackJson.warnings?.some((entry) => String(entry).includes('publish_context_rehydrated_from_compose1_missing')), 'Attach Uploaded Main Media Metadata fallback must not warn about missing publish context');
    assert(staticData.__liviaFrameUploads?.[executionId]?.__items?.length === 3, 'Attach Uploaded Main Media Metadata must cache frame uploads');
    assert(staticData.__liviaMainUploads?.[executionId]?.__items?.length === 1, 'Attach Uploaded Main Media Metadata must cache main uploads');
  } catch (error) {
    errors.push(`Attach Uploaded Main Media Metadata fixture failed: ${error.message}`);
  }
}

function liviaOutput(count, selectedFrameUrl = '') {
  return [{
    json: {
      output: JSON.stringify({
        locale: 'pt-BR',
        meta: { notes: [] },
        procedures: [],
        items: Array.from({ length: count }, (_, index) => ({
          title: `Titulo ${index + 1}`,
          alt_text: `Alt ${index + 1}`,
          bestFrame: selectedFrameUrl ? {
            selectedFrameUrl,
            bestTimestampSeconds: 1,
            confidence: 0.91,
          } : {},
          frameCandidates: [],
        })),
        caption: {
          instagram: { hook: 'IG', blocks: ['B'], cta: 'C', hashtags: ['#x'] },
          facebook: { hook: 'FB', blocks: ['B'], cta: 'C' },
          threads: { hook: 'TH', blocks: ['B'], closing: 'C' },
        },
      }),
    },
  }];
}

function mainMedia({ id, name, mimeType, groupKey, url, frameUrl = '' }) {
  return {
    json: {
      id,
      name,
      mimeType,
      groupKey,
      groupOrder: 0,
      publishTime: '2026-06-23T12:00:00-03:00',
      quantity: 1,
      media_type_1st_requisition: mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
      ...baseConfigs(),
      secure_url: url,
      url,
      finalUrl: url,
      resource_type: mimeType.startsWith('video/') ? 'video' : 'image',
      format: mimeType.startsWith('video/') ? 'mp4' : 'jpg',
      mainMedia: {
        secure_url: url,
        url,
        resource_type: mimeType.startsWith('video/') ? 'video' : 'image',
        format: mimeType.startsWith('video/') ? 'mp4' : 'jpg',
      },
      bestFrame: frameUrl ? { selectedFrameUrl: frameUrl, bestTimestampSeconds: 1, confidence: 0.91 } : {},
      frameCandidates: frameUrl ? [{ rank: 1, url: frameUrl, timestampSeconds: 1, confidence: 0.91 }] : [],
      technicalFrameCandidates: frameUrl ? [{ rank: 1, url: frameUrl, timestampSeconds: 1, confidence: 0.91 }] : [],
      frameCandidateCount: frameUrl ? 1 : 0,
    },
  };
}

function runCompose2({ directItems, itemsByNode, executionId = 'compose2-validator' }) {
  const code = codeOf('Compose (2)');
  const staticData = {
    __liviaMainUploads: {
      [executionId]: {
        __items: itemsByNode['Attach Uploaded Main Media Metadata'] || [],
      },
    },
    __liviaFrameUploads: {
      [executionId]: {
        __items: itemsByNode['Attach Uploaded Main Media Metadata'] || [],
      },
    },
  };

  return runCode(code, {
    $input: { all: () => directItems },
    $items: (name) => itemsByNode[name] || [],
    $getWorkflowStaticData: () => staticData,
    $execution: { id: executionId },
  }).map((item) => item.json);
}

function validateCompose2Fixtures() {
  const imageRows = runCompose2({
    directItems: liviaOutput(1),
    itemsByNode: {
      'Attach Uploaded Main Media Metadata': [
        mainMedia({
          id: 'drive-img-1',
          name: '2306261215.jpg',
          mimeType: 'image/jpeg',
          groupKey: 'dt:2306261215',
          url: 'https://res.cloudinary.com/demo/image/upload/img1.jpg',
        }),
      ],
    },
  });
  assert(imageRows.length > 0, 'Single image fixture must generate jobs');
  assert(imageRows.some((row) => row.phase === 'publish'), 'Single image fixture must generate publish jobs');

  const thumbUrl = 'https://res.cloudinary.com/demo/image/upload/thumb.jpg';
  const videoUrl = 'https://res.cloudinary.com/demo/video/upload/video.mp4';
  const videoRows = runCompose2({
    directItems: liviaOutput(1, thumbUrl),
    itemsByNode: {
      'Attach Uploaded Main Media Metadata': [
        mainMedia({
          id: 'drive-video-1',
          name: '2306261200.mp4',
          mimeType: 'video/mp4',
          groupKey: 'dt:2306261200',
          url: videoUrl,
          frameUrl: thumbUrl,
        }),
      ],
    },
  });
  const igVideoUpload = videoRows.find((row) => row.platform === 'instagram' && row.phase === 'upload' && row.unit === 'bss');
  assert(igVideoUpload?.jsonRequest?.video_url === videoUrl, 'Video fixture must use video URL as video_url');
  assert(igVideoUpload?.jsonRequest?.thumbnail_url === thumbUrl, 'Video fixture must use frame URL as thumbnail_url');
  assert(igVideoUpload?.jsonRequest?.video_url !== thumbUrl, 'Video fixture must not use thumbnail as main video URL');

  const videoNoFrameRows = runCompose2({
    directItems: liviaOutput(1),
    itemsByNode: {
      'Attach Uploaded Main Media Metadata': [
        mainMedia({
          id: 'drive-video-2',
          name: '2306261430.mp4',
          mimeType: 'video/mp4',
          groupKey: 'dt:2306261430',
          url: videoUrl,
        }),
      ],
    },
  });
  assert(videoNoFrameRows.length > 0, 'Video without frame fixture must still generate jobs');
  const igVideoNoFrame = videoNoFrameRows.find((row) => row.platform === 'instagram' && row.phase === 'upload' && row.unit === 'bss');
  assert(igVideoNoFrame?.jsonRequest?.video_url === videoUrl, 'Video without frame must still use video URL');

  const threadsUpload = videoRows.find((row) => row.platform === 'threads' && row.phase === 'upload' && row.unit === 'bss');
  assert(threadsUpload?.params?.access_token, 'Threads upload fixture must carry params.access_token for Prepare Request');
  assert(!threadsUpload?.warnings?.some((entry) => String(entry).includes('threads.token')), 'Threads upload fixture must not warn about missing token');
}

validateOptimizeExpression();
validateTopology();
validateCodeSyntax();
validatePrepareMainMediaUploadFixture();
validateAttachUploadedMainMediaFixture();
validateCompose2Fixtures();

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  workflowPath,
  ok: true,
  checks: [
    'optimize-expression',
    'reduced-topology',
    'code-syntax',
    'prepare-main-media-mixed-uploads',
    'attach-uploaded-main-media-mixed-uploads',
    'compose2-single-image',
    'compose2-video-with-frame',
    'compose2-video-without-frame',
  ],
}, null, 2));
