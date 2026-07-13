#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');

const inputPath = process.argv[2] || 'workflows/livia.download-compose2.current.json';
const outputPath = process.argv[3] || inputPath;

const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function fail(message) {
  throw new Error(message);
}

function getNode(name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) fail(`Node not found: ${name}`);
  return node;
}

function ensureMainOutput(sourceName, outputIndex = 0) {
  workflow.connections[sourceName] ||= {};
  workflow.connections[sourceName].main ||= [];
  workflow.connections[sourceName].main[outputIndex] ||= [];
  return workflow.connections[sourceName].main[outputIndex];
}

function addConnection(sourceName, targetName, targetInputIndex = 0, outputIndex = 0) {
  const output = ensureMainOutput(sourceName, outputIndex);
  if (!output.some((conn) => conn.node === targetName && conn.type === 'main' && conn.index === targetInputIndex)) {
    output.push({ node: targetName, type: 'main', index: targetInputIndex });
  }
}

function removeConnection(sourceName, targetName) {
  const source = workflow.connections[sourceName];
  if (!source?.main) return;
  for (const group of source.main) {
    if (!Array.isArray(group)) continue;
    for (let i = group.length - 1; i >= 0; i--) {
      if (group[i]?.node === targetName) group.splice(i, 1);
    }
  }
}

function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) fail(`Patch anchor not found: ${label}`);
  return source.replace(needle, replacement);
}

function addCodeNode({ name, position, jsCode }) {
  let node = workflow.nodes.find((item) => item.name === name);
  if (node) {
    node.parameters ||= {};
    node.parameters.jsCode = jsCode;
    return node;
  }

  node = {
    id: crypto.randomUUID(),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { jsCode },
  };
  workflow.nodes.push(node);
  return node;
}

function addReadFileNode({ name, position, fileSelector }) {
  let node = workflow.nodes.find((item) => item.name === name);
  if (node) {
    node.parameters ||= {};
    node.parameters.fileSelector = fileSelector;
    node.parameters.options = { ...(node.parameters.options || {}), fileName: fileSelector };
    return node;
  }

  node = {
    id: crypto.randomUUID(),
    name,
    type: 'n8n-nodes-base.readWriteFile',
    typeVersion: 1,
    position,
    parameters: {
      fileSelector,
      options: {
        fileName: fileSelector,
      },
    },
  };
  workflow.nodes.push(node);
  return node;
}

function cloneUploadNode(sourceName, targetName, position) {
  const source = getNode(sourceName);
  let node = workflow.nodes.find((item) => item.name === targetName);
  if (node) {
    node.parameters = JSON.parse(JSON.stringify(source.parameters || {}));
    return node;
  }

  node = JSON.parse(JSON.stringify(source));
  node.id = crypto.randomUUID();
  node.name = targetName;
  node.position = position;
  workflow.nodes.push(node);
  return node;
}

const optimizeIf = getNode('Optimize?');
const compose2 = getNode('Compose (2)');

optimizeIf.parameters.conditions.conditions[0].leftValue = `={{ (() => {
  const j = $('Download File').item.json || {};
  const mime = String(j.mimeType || '').toLowerCase();
  const name = String(j.name || '').toLowerCase();
  const size = Number(j.size || 0);

  const isVideo = mime.includes('video') || /\\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name);
  const isPng = mime.includes('image/png') || /\\.png$/i.test(name);

  const BIG_IMAGE = 8000000;

  // Videos always need a local publish file because the frame picker and the
  // post-publish video upload both depend on a stable filesystem path.
  return isVideo || (!isVideo && size > BIG_IMAGE) || isPng;
})() }}`;

const prepareMainMediaUploadCode = `// Preserve the original media context immediately before the publishable Cloudinary upload.
function str(v, fb = "") {
  return (v === undefined || v === null) ? fb : String(v);
}

function safeItems(name) {
  try { return $items(name) || []; } catch { return []; }
}

function safeCurrent(name) {
  try { return $(name).item.json || {}; } catch { return {}; }
}

function fileNameOnly(value) {
  return str(value, "").split("/").filter(Boolean).pop() || "";
}

function baseName(value) {
  return fileNameOnly(value).replace(/\\.[^.]+$/, "").replace(/_temp$/, "");
}

function normalizeBase(value) {
  return baseName(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pickCompose1(itemJson, index) {
  const current = safeCurrent("Compose (1)");
  if (current.id || current.name || current.groupKey) return current;

  const composeItems = safeItems("Compose (1)");
  const candidates = composeItems.map((item) => item.json || {});
  const itemBase = normalizeBase(itemJson.fileName || itemJson.filePath || itemJson.path || itemJson.name || "");

  if (itemBase) {
    const match = candidates.find((candidate) => {
      const candidateBase = normalizeBase(candidate.name || candidate.fileName || "");
      return candidateBase && (itemBase.includes(candidateBase) || candidateBase.includes(itemBase));
    });
    if (match) return match;
  }

  return candidates[index] || {};
}

return $input.all().map((item, index) => {
  const current = item.json || {};
  const media = pickCompose1(current, index);
  const publishFileName = str(current.fileName || current.filePath || current.path || "", "");

  return {
    json: {
      ...media,
      ...current,
      id: media.id || current.id,
      name: media.name || current.name,
      mimeType: media.mimeType || current.mimeType,
      groupKey: media.groupKey || current.groupKey,
      groupOrder: media.groupOrder ?? current.groupOrder,
      publishTime: media.publishTime || current.publishTime,
      mainMediaFileName: publishFileName,
      uploadRole: "main_media",
    },
    binary: item.binary,
  };
});`;

const attachUploadedMainMediaCode = `// Reattach media context after Cloudinary upload of the publishable asset.
function str(v, fb = "") {
  return (v === undefined || v === null) ? fb : String(v);
}

function ensureHttps(url) {
  const s = str(url, "").trim();
  if (!s) return "";
  return s.replace(/^http:\\/\\//i, "https://");
}

function safeItems(name) {
  try { return $items(name) || []; } catch { return []; }
}

function normalizeBase(value) {
  return str(value, "")
    .split("/")
    .filter(Boolean)
    .pop()
    .replace(/\\.[^.]+$/, "")
    .replace(/_temp$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function sameMedia(a, b) {
  if (!a || !b) return false;
  if (a.id && b.mediaId && String(a.id) === String(b.mediaId)) return true;
  if (a.id && b.id && String(a.id) === String(b.id)) return true;
  if (a.groupKey && b.groupKey && a.name && b.mediaName && a.groupKey === b.groupKey && a.name === b.mediaName) return true;

  const ab = normalizeBase(a.name || a.mainMediaFileName || "");
  const bb = normalizeBase(b.mediaName || b.name || b.mainMediaFileName || "");
  return !!(ab && bb && (ab.includes(bb) || bb.includes(ab)));
}

function collectFrameContext(media) {
  const frameItems = safeItems("Attach Uploaded Frame Metadata")
    .map((item) => item.json || {})
    .filter((json) => sameMedia(media, json));

  const candidates = [];
  let bestFrame = {};

  for (const frame of frameItems) {
    if (frame.bestFrame && typeof frame.bestFrame === "object") bestFrame = frame.bestFrame;
    if (Array.isArray(frame.technicalFrameCandidates)) candidates.push(...frame.technicalFrameCandidates);
    else if (Array.isArray(frame.frameCandidates)) candidates.push(...frame.frameCandidates);
    else if (frame.candidate && typeof frame.candidate === "object") candidates.push(frame.candidate);
  }

  return {
    bestFrame,
    frameCandidates: candidates,
    technicalFrameCandidates: candidates,
    frameCandidateCount: candidates.length,
  };
}

const sourceItems = safeItems("Prepare Main Media Upload");

return $input.all().map((item, index) => {
  const upload = item.json || {};
  const source = (sourceItems[index] && sourceItems[index].json) || {};
  const finalUrl = ensureHttps(upload.secure_url || upload.url || "");
  const frameContext = collectFrameContext(source);

  return {
    json: {
      ...source,
      ...upload,
      id: source.id || upload.id,
      name: source.name || upload.original_filename || upload.display_name || upload.public_id,
      mimeType: source.mimeType || upload.mimeType,
      groupKey: source.groupKey,
      groupOrder: source.groupOrder,
      publishTime: source.publishTime,
      uploadRole: "main_media",
      finalUrl,
      secure_url: finalUrl || upload.secure_url,
      url: finalUrl || upload.url,
      mainMedia: {
        secure_url: finalUrl || upload.secure_url || "",
        url: finalUrl || upload.url || "",
        resource_type: str(upload.resource_type || "", ""),
        format: str(upload.format || "", ""),
        public_id: str(upload.public_id || "", ""),
      },
      ...frameContext,
    },
    binary: item.binary,
  };
});`;

const attachFrameCandidateMetadataCode = `// Reattach frame candidate metadata after Read Thumb and keep the source media identity.
function str(v, fb = "") {
  return (v === undefined || v === null) ? fb : String(v);
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function fileNameOnly(value) {
  return str(value, "").split("/").filter(Boolean).pop() || "";
}

function safeCurrent(name) {
  try { return $(name).item.json || {}; } catch { return {}; }
}

function normalizeCandidate(raw, idx, fallbackThumbPath) {
  const c = raw && typeof raw === "object" ? raw : {};
  const thumbPath = str(c.thumbPath || c.path || fallbackThumbPath, "");
  return {
    rank: num(c.rank, idx + 1),
    timestamp: str(c.timestamp || c.bestTimestamp, ""),
    timestampSeconds: num(c.timestampSeconds ?? c.bestTimestampSeconds, 0),
    confidence: num(c.confidence ?? c.score, 0),
    reason: str(c.reason || c.why || c.notes, ""),
    thumbPath,
    fileName: fileNameOnly(thumbPath),
    source: "frame-analysis",
  };
}

const inputItems = $input.all();
let parseItems = [];
try {
  parseItems = $items("Parse Frame Analysis JSON") || [];
} catch {
  parseItems = [];
}

return inputItems.map((item, index) => {
  const source = (parseItems[index] && parseItems[index].json) || {};
  const media = safeCurrent("Compose (1)");
  const thumbPath = str(source.thumbPath || item.json?.fileName || item.json?.filePath || item.json?.path, "");
  const candidate = normalizeCandidate(source.candidate || {}, index, thumbPath);
  const bestFrame = source.bestFrame && typeof source.bestFrame === "object" ? source.bestFrame : {};

  return {
    json: {
      ...(item.json || {}),
      mediaId: media.id || "",
      mediaName: media.name || "",
      mediaMimeType: media.mimeType || "",
      groupKey: media.groupKey || "",
      groupOrder: media.groupOrder,
      publishTime: media.publishTime || "",
      thumbPath,
      candidate,
      bestFrame,
      frameCandidates: [candidate],
      technicalFrameCandidates: [candidate],
      frameCandidateCount: 1,
      uploadRole: "frame_candidate",
    },
    binary: item.binary,
  };
});`;

const attachUploadedFrameMetadataCode = `// Reattach frame candidate metadata to Cloudinary thumbnail uploads.
function str(v, fb = "") {
  return (v === undefined || v === null) ? fb : String(v);
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function ensureHttps(url) {
  const s = str(url, "").trim();
  if (!s) return "";
  return s.replace(/^http:\\/\\//i, "https://");
}

function fileNameOnly(value) {
  return str(value, "").split("/").filter(Boolean).pop() || "";
}

function fileBaseName(value) {
  return fileNameOnly(value).replace(/\\.[^.]+$/, "");
}

function normalizeCandidate(raw, upload, idx) {
  const c = raw && typeof raw === "object" ? raw : {};
  const url = ensureHttps(upload.secure_url || upload.url || c.url || "");
  const thumbPath = str(c.thumbPath || c.path || upload.original_filename || upload.display_name || "", "");
  return {
    rank: num(c.rank, idx + 1),
    timestamp: str(c.timestamp || c.bestTimestamp, ""),
    timestampSeconds: num(c.timestampSeconds ?? c.bestTimestampSeconds, 0),
    confidence: num(c.confidence ?? c.score, 0),
    reason: str(c.reason || c.why || c.notes, ""),
    thumbPath,
    fileName: fileNameOnly(thumbPath) || fileNameOnly(url),
    fileBase: fileBaseName(thumbPath) || fileBaseName(url),
    url,
    secure_url: url,
    resource_type: str(upload.resource_type || c.resource_type || "image", "image"),
    public_id: str(upload.public_id || upload.id || ""),
    source: "cloudinary-frame-upload",
  };
}

const inputItems = $input.all();
let sourceItems = [];
try {
  sourceItems = $items("Attach Frame Candidate Metadata") || [];
} catch {
  sourceItems = [];
}

return inputItems.map((item, index) => {
  const upload = item.json || {};
  const source = (sourceItems[index] && sourceItems[index].json) || {};
  const candidate = normalizeCandidate(source.candidate || {}, upload, index);
  const bestFrameSource = source.bestFrame && typeof source.bestFrame === "object" ? source.bestFrame : {};
  const bestFrame = {
    ...bestFrameSource,
    selectedFrameUrl: candidate.url || str(bestFrameSource.selectedFrameUrl, ""),
    selectedFrameRank: candidate.rank,
    selectedFrameSource: "technical_frame_upload",
    bestTimestamp: str(bestFrameSource.bestTimestamp || candidate.timestamp, ""),
    bestTimestampSeconds: num(bestFrameSource.bestTimestampSeconds ?? candidate.timestampSeconds, candidate.timestampSeconds),
    confidence: num(bestFrameSource.confidence ?? candidate.confidence, candidate.confidence),
  };

  return {
    json: {
      ...source,
      ...upload,
      mediaId: source.mediaId || "",
      mediaName: source.mediaName || "",
      mediaMimeType: source.mediaMimeType || "",
      groupKey: source.groupKey || "",
      groupOrder: source.groupOrder,
      publishTime: source.publishTime || "",
      uploadRole: "frame_candidate",
      thumbPath: candidate.thumbPath,
      candidate,
      frameCandidates: [candidate],
      technicalFrameCandidates: [candidate],
      bestFrame,
      frameCandidateCount: 1,
    },
    binary: item.binary,
  };
});`;

const readMainMediaSelector = `={{ (() => {
  function str(v) { return (v === undefined || v === null) ? '' : String(v); }

  const read = $('Read File').item.json || {};
  const direct = str(read.fileName || read.filePath || read.path);
  if (direct) return direct;

  const inputFile = str($('Write File').item.json.fileName);
  const lastSlash = inputFile.lastIndexOf('/');
  const dir = lastSlash >= 0 ? inputFile.substring(0, lastSlash) : '';
  const file = lastSlash >= 0 ? inputFile.substring(lastSlash + 1) : inputFile;
  const parts = file.split('.');
  if (parts.length > 1) parts.pop();
  const base = parts.join('.') || file;
  const outputBase = base.endsWith('_temp') ? base.slice(0, -5) : base;

  return dir ? \`\${dir}/\${outputBase}.mp4\` : \`\${outputBase}.mp4\`;
})() }}`;

addCodeNode({
  name: 'Prepare Main Media Upload',
  position: [-4944, -2240],
  jsCode: prepareMainMediaUploadCode,
});

addReadFileNode({
  name: 'Read Main Media For Publish',
  position: [-3824, -2416],
  fileSelector: readMainMediaSelector,
});

addCodeNode({
  name: 'Attach Uploaded Main Media Metadata',
  position: [-4048, -2240],
  jsCode: attachUploadedMainMediaCode,
});

cloneUploadNode('Upload Main Media', 'Upload Frame Candidate', [-4272, -2416]);

getNode('Attach Frame Candidate Metadata').parameters.jsCode = attachFrameCandidateMetadataCode;
getNode('Attach Uploaded Frame Metadata').parameters.jsCode = attachUploadedFrameMetadataCode;

removeConnection('Is Video?', 'Upload Main Media');
removeConnection('Is Video?', 'Prepare Main Media Upload');
addConnection('Is Video?', 'Prepare Main Media Upload', 0, 1);

removeConnection('Attach Frame Candidate Metadata', 'Upload Main Media');
addConnection('Attach Frame Candidate Metadata', 'Upload Frame Candidate');

removeConnection('Upload Main Media', 'Attach Uploaded Frame Metadata');
addConnection('Upload Main Media', 'Attach Uploaded Main Media Metadata');

addConnection('Upload Frame Candidate', 'Attach Uploaded Frame Metadata');

removeConnection('Attach Uploaded Frame Metadata', 'Livia');
addConnection('Attach Uploaded Frame Metadata', 'Read Main Media For Publish');
addConnection('Read Main Media For Publish', 'Prepare Main Media Upload');

addConnection('Prepare Main Media Upload', 'Upload Main Media');
addConnection('Attach Uploaded Main Media Metadata', 'Livia');

let composeCode = compose2.parameters.jsCode;

composeCode = replaceOnce(
  composeCode,
  `// IMPORTANTE:
// - Este Code node consome apenas o payload direto do Merge (3).
// - Aggregate (2), Livia e mídia principal combinada devem chegar no input direto.
// - Não busca itens de nós anteriores para evitar timeout do JS Task Runner.
// ======================================================`,
  `// IMPORTANTE:
// - Este Code node recebe a saída direta da Livia.
// - A mídia principal já chega combinada em Attach Uploaded Main Media Metadata.
// - Frames técnicos chegam separadamente de Attach Uploaded Frame Metadata.
// ======================================================`,
  'Compose (2) topology comment',
);

composeCode = replaceOnce(
  composeCode,
  `function readDirectInputItems() {
  try {
    if (typeof $input !== "undefined" && $input && typeof $input.all === "function") {
      return $input.all() || [];
    }
  } catch {
    return [];
  }

  return [];
}
`,
  `function readDirectInputItems() {
  try {
    if (typeof $input !== "undefined" && $input && typeof $input.all === "function") {
      return $input.all() || [];
    }
  } catch {
    return [];
  }

  return [];
}

function safeNodeItems(name) {
  try {
    return $items(name) || [];
  } catch {
    return [];
  }
}
`,
  'Compose (2) safeNodeItems helper',
);

composeCode = replaceOnce(
  composeCode,
  `  if (name === "Main Media Context") {
    return items.filter((item) => isCombinedMainMediaItem((item && item.json) || {}));
  }

  if (name === "Aggregate (2)") {`,
  `  if (name === "Attach Uploaded Main Media Metadata") {
    return items.filter((item) => isCombinedMainMediaItem((item && item.json) || {}));
  }

  if (name === "Attach Uploaded Frame Metadata") {`,
  'Compose (2) current node selectors',
);

composeCode = replaceOnce(
  composeCode,
  `// Consumir somente o input direto do Merge (3). Evita buscar itens de nós anteriores, que neste
// workflow pode travar o JS Task Runner quando há dados grandes/pinned.
const directInputItems = readDirectInputItems();
const aggregate2Items = selectDirectNodeItems("Aggregate (2)", directInputItems);
const technicalFrameCandidates = flattenFrameCandidateItems(aggregate2Items);
const parsedFrameCandidateCount = technicalFrameCandidates.length;

let c2Items = selectDirectNodeItems("Main Media Context", directInputItems);
const mainUploadItems = c2Items;
const uploadItems = mainUploadItems;
const liviaItems = selectDirectNodeItems("Livia", directInputItems);

if (!directInputItems.length) {
  throw new Error("Compose (2): Merge (3) não entregou itens no input direto.");
}

if (!aggregate2Items.length) {
  throw new Error("Compose (2): input direto do Merge (3) sem Aggregate (2) para candidatos de frame.");
}

if (!liviaItems.length) {
  throw new Error("Compose (2): input direto do Merge (3) sem saída da Livia.");
}

if (!c2Items.length) {
  throw new Error("Compose (2): input direto do Merge (3) sem mídia principal combinada (Compose 1 + Upload Main Media).");
}
`,
  `// A saída direta é a resposta da Livia. O contexto publicável vem dos nós
// imediatamente anteriores, já sem binários grandes.
const directInputItems = readDirectInputItems();
const liviaItems = selectDirectNodeItems("Livia", directInputItems);

const uploadedMainMediaItems = safeNodeItems("Attach Uploaded Main Media Metadata");
let c2Items = uploadedMainMediaItems.length
  ? uploadedMainMediaItems
  : selectDirectNodeItems("Attach Uploaded Main Media Metadata", directInputItems);

const uploadedFrameItems = safeNodeItems("Attach Uploaded Frame Metadata");
const technicalFrameCandidates = flattenFrameCandidateItems(uploadedFrameItems);
const parsedFrameCandidateCount =
  technicalFrameCandidates.length ||
  countParsedFrameCandidates(safeNodeItems("Parse Frame Analysis JSON"));

const mainUploadItems = c2Items;
const uploadItems = mainUploadItems;

if (!directInputItems.length) {
  throw new Error("Compose (2): Livia não entregou itens no input direto.");
}

if (!liviaItems.length) {
  throw new Error("Compose (2): input direto sem saída da Livia.");
}

if (!c2Items.length) {
  throw new Error("Compose (2): sem mídia principal combinada em Attach Uploaded Main Media Metadata.");
}
`,
  'Compose (2) main input block',
);

compose2.parameters.jsCode = composeCode;

fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2) + '\n');

console.log(JSON.stringify({
  outputPath,
  nodes: workflow.nodes.length,
  hasPrepareMainMediaUpload: !!workflow.nodes.find((node) => node.name === 'Prepare Main Media Upload'),
  hasUploadFrameCandidate: !!workflow.nodes.find((node) => node.name === 'Upload Frame Candidate'),
  hasAttachUploadedMainMediaMetadata: !!workflow.nodes.find((node) => node.name === 'Attach Uploaded Main Media Metadata'),
}, null, 2));
