#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || inputPath;

if (!inputPath) {
  console.error('Usage: node scripts/patch-livia-video-main-upload.js <input.json> [output.json]');
  process.exit(1);
}

const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function fail(message) {
  throw new Error(message);
}

function getNode(name) {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) fail(`Node not found: ${name}`);
  return node;
}

function ensureMainArray(sourceName, outputIndex = 0) {
  workflow.connections[sourceName] ||= {};
  workflow.connections[sourceName].main ||= [];
  workflow.connections[sourceName].main[outputIndex] ||= [];
  return workflow.connections[sourceName].main[outputIndex];
}

function addConnection(sourceName, targetName, targetInputIndex = 0, outputIndex = 0) {
  const arr = ensureMainArray(sourceName, outputIndex);
  if (!arr.some((c) => c.node === targetName && c.type === 'main' && c.index === targetInputIndex)) {
    arr.push({ node: targetName, type: 'main', index: targetInputIndex });
  }
}

function replaceExact(haystack, needle, replacement, label) {
  if (!haystack.includes(needle)) fail(`Missing code block: ${label}`);
  return haystack.replace(needle, replacement);
}

const uploadFile = getNode('Upload File');
const merge3 = getNode('Merge (3)');
const compose2 = getNode('Compose (2)');
const prepareRequest = getNode('Prepare Request');

if (!workflow.nodes.some((n) => n.name === 'Upload Main Media')) {
  const uploadMain = JSON.parse(JSON.stringify(uploadFile));
  uploadMain.id = crypto.randomUUID();
  uploadMain.name = 'Upload Main Media';
  uploadMain.position = [-6064, -2368];
  uploadMain.parameters = {
    ...(uploadMain.parameters || {}),
    resource_type_file: "={{ $binary.data.fileType || $json.fileType || 'auto' }}",
  };
  workflow.nodes.push(uploadMain);
}

merge3.parameters ||= {};
merge3.parameters.numberInputs = 3;

addConnection('Read File', 'Upload Main Media', 0, 0);
addConnection('Switch (1)', 'Upload Main Media', 0, 1);
addConnection('Upload Main Media', 'Merge (3)', 2, 0);

let composeCode = compose2.parameters.jsCode;

composeCode = replaceExact(
  composeCode,
  `function looksLikeImageUrl(u) {
  const s = str(u, "").toLowerCase();

  return (
    /\\.(jpg|jpeg|png|webp|gif)(\\?|#|$)/.test(s) ||
    s.includes("/image/upload/")
  );
}
`,
  `function looksLikeImageUrl(u) {
  const s = str(u, "").toLowerCase();

  return (
    /\\.(jpg|jpeg|png|webp|gif)(\\?|#|$)/.test(s) ||
    s.includes("/image/upload/")
  );
}

function looksLikeVideoUrl(u) {
  const s = str(u, "").toLowerCase();

  return (
    /\\.(mp4|mov|m4v|webm|mkv)(\\?|#|$)/.test(s) ||
    s.includes("/video/upload/")
  );
}

function uploadLooksLikeVideo(upload, url) {
  const resourceType = str(upload?.resource_type || "", "").toLowerCase();
  const format = str(upload?.format || "", "").toLowerCase();
  return resourceType === "video" || ["mp4","mov","m4v","webm","mkv"].includes(format) || looksLikeVideoUrl(url);
}

function uploadLooksLikeImage(upload, url) {
  const resourceType = str(upload?.resource_type || "", "").toLowerCase();
  const format = str(upload?.format || "", "").toLowerCase();
  return resourceType === "image" || ["jpg","jpeg","png","webp","gif"].includes(format) || looksLikeImageUrl(url);
}

function selectMainUpload(uploadItems, media, index, warnings, context) {
  const upload = (uploadItems[index] && uploadItems[index].json) || {};
  const directUrl = ensureHttps(str(upload.secure_url || upload.url || "", ""));
  const kind = detectMediaKindSmart(media?.mimeType, directUrl || media?.webContentLink || media?.url || "");

  if (!directUrl) {
    throw new Error(
      \`Compose (2): Upload Main Media sem secure_url/url (\${context}, globalIdx=\${index}, mediaId=\${str(media?.id, "n/a")}, mediaName=\${str(media?.name, "n/a")})\`
    );
  }

  if (kind.isVideo && !uploadLooksLikeVideo(upload, directUrl)) {
    throw new Error(
      \`Compose (2): Upload Main Media retornou URL incompatível para vídeo (\${context}, globalIdx=\${index}, mediaName=\${str(media?.name, "n/a")}, resource_type=\${str(upload.resource_type, "n/a")}, url=\${directUrl})\`
    );
  }

  if (kind.isImage && uploadLooksLikeVideo(upload, directUrl)) {
    throw new Error(
      \`Compose (2): Upload Main Media retornou vídeo para mídia de imagem (\${context}, globalIdx=\${index}, mediaName=\${str(media?.name, "n/a")}, url=\${directUrl})\`
    );
  }

  if (kind.isVideo) pushUnique(warnings, "video_url validado a partir de Upload Main Media");
  return { upload, directUrl };
}
`,
  'video URL helpers',
);

composeCode = replaceExact(
  composeCode,
  `// const aggregate2Items = $items("Aggregate (2)")
//
// Esses nós são opcionais no caminho de imagem e quebram a execução.
// Frames devem vir da Livia em livItem.frameCandidates.

let c2Items = $items("Compose (1)") || [];
const uploadItems = $items("Upload File") || [];
const liviaItems = $items("Livia") || [];
`,
  `// const aggregate2Items = $items("Aggregate (2)")
//
// Esses nós são opcionais no caminho de imagem e quebram a execução.
// Frames devem vir da Livia em livItem.frameCandidates.

let c2Items = $items("Compose (1)") || [];
const thumbnailUploadItems = $items("Upload File") || [];
const mainUploadItems = $items("Upload Main Media") || [];
const uploadItems = mainUploadItems.length ? mainUploadItems : thumbnailUploadItems;
const liviaItems = $items("Livia") || [];
`,
  'main upload items',
);

composeCode = replaceExact(
  composeCode,
  `        const firstIndex = groupItems[0].index;
        const c2 = groupItems[0].c2 || {};
        const upload = (uploadItems[firstIndex] && uploadItems[firstIndex].json) || {};

        const fileWarnings = [];
        const directUrl = ensureHttps(str(upload.secure_url || upload.url || "", ""));

        if (!directUrl) {
          throw new Error(
            \`Compose (2): Upload File sem secure_url/url para facebook/reels (groupKey=\${group.groupKey}, globalIdx=\${firstIndex}, mediaId=\${str(c2.id, "n/a")}, mediaName=\${str(c2.name, "n/a")})\`
          );
        }

        const finalUrl = directUrl;
`,
  `        const firstIndex = groupItems[0].index;
        const c2 = groupItems[0].c2 || {};

        const fileWarnings = [];
        const { directUrl } = selectMainUpload(
          uploadItems,
          c2,
          firstIndex,
          fileWarnings,
          \`facebook/reels groupKey=\${group.groupKey}\`
        );

        const finalUrl = directUrl;
`,
  'facebook reels main upload selection',
);

composeCode = replaceExact(
  composeCode,
  `          const { index: globalIdx, c2 } = groupItems[localIdx];
          const upload = (uploadItems[globalIdx] && uploadItems[globalIdx].json) || {};

          const fileWarnings = [];
          const directUrl = ensureHttps(str(upload.secure_url || upload.url || "", ""));

          if (!directUrl) {
            throw new Error(
              \`Compose (2): Upload File sem secure_url/url para item (platform=\${platform}, groupKey=\${group.groupKey}, localIdx=\${localIdx}, globalIdx=\${globalIdx}, mediaId=\${str(c2.id, "n/a")}, mediaName=\${str(c2.name, "n/a")})\`
            );
          }

          const finalUrl = directUrl;
`,
  `          const { index: globalIdx, c2 } = groupItems[localIdx];

          const fileWarnings = [];
          const { directUrl } = selectMainUpload(
            uploadItems,
            c2,
            globalIdx,
            fileWarnings,
            \`platform=\${platform}, groupKey=\${group.groupKey}, localIdx=\${localIdx}\`
          );

          const finalUrl = directUrl;
`,
  'default main upload selection',
);

composeCode = replaceExact(
  composeCode,
  `let publishRunIndex = 0;
const results = [];
`,
  `let publishRunIndex = 0;
const results = [];

function pushMediaAvailabilityJob({ group, unitKey, platform, c2, finalUrl, localIdx, warnings }) {
  const kind = detectMediaKindSmart(c2?.mimeType, finalUrl || c2?.webContentLink || "");
  if (!kind.isVideo) return null;

  const runIndex = publishRunIndex++;
  results.push({
    json: removeNulls({
      groupKey: group.groupKey,
      groupOrder: group.groupOrder,
      unit: unitKey,
      platform,
      phase: "mediaAvailability",
      step: "wait_public_video_url",
      index: localIdx,
      method: "HEAD",
      url: finalUrl,
      params: {},
      jsonRequest: {},
      requestSkipBody: true,
      requestBinary: false,
      requestHeaders: {},
      expectedContentType: "video",
      waitSeconds: 30,
      maxAttempts: 60,
      media: {
        id: c2.id,
        name: c2.name,
        mimeType: c2.mimeType,
        size: c2.size,
        webContentLink: c2.webContentLink || undefined,
        finalUrl,
      },
      warnings,
      publishRunIndex: runIndex,
    })
  });

  return runIndex;
}
`,
  'media availability helper',
);

composeCode = replaceExact(
  composeCode,
  `        const livIdx = resolveLiviaIndex(liviaNorm, firstIndex, 0, groupItems.length, c2Items.length);
        const livWarn = [];
        const livItem = extractFromLivia(liviaNorm, livIdx, livWarn);
        const capsHere = getCaptionsForIndex(liviaNorm, livIdx);
        const fbCaption = str(capsHere.fbCaption, "") || str(globalCaptions.fbCaption, "");

        const startUrl = baseUrlAccount + "video_reels?upload_phase=start";
`,
  `        const livIdx = resolveLiviaIndex(liviaNorm, firstIndex, 0, groupItems.length, c2Items.length);
        const livWarn = [];
        const livItem = extractFromLivia(liviaNorm, livIdx, livWarn);
        const capsHere = getCaptionsForIndex(liviaNorm, livIdx);
        const fbCaption = str(capsHere.fbCaption, "") || str(globalCaptions.fbCaption, "");

        pushMediaAvailabilityJob({
          group,
          unitKey,
          platform,
          c2,
          finalUrl,
          localIdx: 0,
          warnings: [...warnings, ...fileWarnings, ...livWarn],
        });

        const startUrl = baseUrlAccount + "video_reels?upload_phase=start";
`,
  'facebook reels media availability insertion',
);

composeCode = replaceExact(
  composeCode,
  `          const params = { access_token: token };
          const myRun = publishRunIndex++;
`,
  `          pushMediaAvailabilityJob({
            group,
            unitKey,
            platform,
            c2,
            finalUrl,
            localIdx,
            warnings: [...warnings, ...fileWarnings],
          });

          const params = { access_token: token };
          const myRun = publishRunIndex++;
`,
  'default media availability insertion',
);

compose2.parameters.jsCode = composeCode;

let prepareCode = prepareRequest.parameters.jsCode;

prepareCode = replaceExact(
  prepareCode,
  `  const apiErr = extractApiError(httpBody);
  const hasHttpError = (httpEnv.statusCode && httpEnv.statusCode >= 400) || apiErr;

  if (hasHttpError) {
`,
  `  const apiErr = extractApiError(httpBody);
  const phaseForHttp = str(job.phase).toLowerCase();
  const hasHttpError = (httpEnv.statusCode && httpEnv.statusCode >= 400) || apiErr;

  if (hasHttpError && phaseForHttp !== "mediaavailability") {
`,
  'media availability http errors are retryable',
);

prepareCode = replaceExact(
  prepareCode,
  `  // Se não era checkStatus: pronto para o Loop pegar o próximo item
  if (phase === "permalink") {
`,
  `  if (phase === "mediaavailability") {
    const attempt = Number(job.attempt ?? 0);
    const maxAttempts = Number(job.maxAttempts ?? 60);
    const waitSeconds = Number(job.waitSeconds ?? 30);
    const statusCode = Number(httpEnv.statusCode || 0);
    const headers = normObj(httpEnv.headers || httpBody.headers || {});
    const contentType = str(headers["content-type"] || headers["Content-Type"] || "", "").toLowerCase();
    const expected = str(job.expectedContentType || "", "").toLowerCase();
    const url = str(job.url, "");
    const statusOk = statusCode >= 200 && statusCode < 400;
    const typeOk = expected === "video"
      ? (contentType.includes("video") || contentType.includes("octet-stream") || url.includes("/video/upload/"))
      : true;

    if (statusOk && typeOk) {
      return [{
        json: removeNulls({
          ...job,
          ready: true,
          reason: "media-url-ready",
          attempt,
          lastStatusCode: httpEnv.statusCode,
          lastContentType: contentType,
        })
      }];
    }

    if (attempt + 1 >= maxAttempts) {
      throw new Error(\`Prepare Request: URL pública de mídia não ficou disponível após \${maxAttempts} tentativas (url=\${url}, statusCode=\${statusCode || "n/a"}, contentType=\${contentType || "n/a"}).\`);
    }

    const retryJob = removeNulls({
      ...job,
      ready: false,
      reason: "media-url-wait",
      attempt: attempt + 1,
      waitSeconds,
      lastStatusCode: httpEnv.statusCode,
      lastContentType: contentType,
    });

    retryJob.httpRequest = toHttpRequest(
      retryJob,
      retryJob.url,
      retryJob.method || "HEAD",
      retryJob.requestHeaders,
      retryJob.params,
      retryJob.requestBody,
      true,
      false
    );

    enqueue(retryJob);
    return [{ json: retryJob }];
  }

  // Se não era checkStatus: pronto para o Loop pegar o próximo item
  if (phase === "permalink") {
`,
  'media availability post-http handling',
);

prepareRequest.parameters.jsCode = prepareCode;

workflow.meta ||= {};
workflow.meta.codexPatch = {
  name: 'livia-video-main-upload-availability',
  appliedAt: new Date().toISOString(),
  notes: [
    'Adds Upload Main Media so video_url uses the public video upload, not thumbnails.',
    'Adds mediaAvailability HEAD polling before Meta upload jobs for videos.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2));

console.log(JSON.stringify({
  outputPath,
  nodes: workflow.nodes.length,
  hasUploadMainMedia: workflow.nodes.some((n) => n.name === 'Upload Main Media'),
  merge3Inputs: getNode('Merge (3)').parameters.numberInputs,
}, null, 2));
