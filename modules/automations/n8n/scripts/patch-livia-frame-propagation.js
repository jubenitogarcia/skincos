#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || inputPath;

if (!inputPath) {
  console.error('Usage: node scripts/patch-livia-frame-propagation.js <input.json> [output.json]');
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

function removeConnection(sourceName, targetName) {
  const conn = workflow.connections[sourceName];
  const mains = conn?.main;
  if (!Array.isArray(mains)) return;

  for (const output of mains) {
    if (!Array.isArray(output)) continue;
    for (let i = output.length - 1; i >= 0; i--) {
      if (output[i]?.node === targetName) output.splice(i, 1);
    }
  }
}

function replaceExact(haystack, needle, replacement, label) {
  if (!haystack.includes(needle)) fail(`Missing code block: ${label}`);
  return haystack.replace(needle, replacement);
}

function upsertCodeNode({ name, position, jsCode }) {
  let node = workflow.nodes.find((n) => n.name === name);
  if (!node) {
    node = {
      parameters: { jsCode },
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position,
      id: crypto.randomUUID(),
      name,
    };
    workflow.nodes.push(node);
  } else {
    node.parameters ||= {};
    node.parameters.jsCode = jsCode;
    node.type = 'n8n-nodes-base.code';
    node.typeVersion = node.typeVersion || 2;
  }
  return node;
}

const attachFrameCandidateCode = `// Reattach frame candidate metadata after Read Thumb, which keeps the binary
// but may replace JSON with file metadata.
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
  const thumbPath = str(source.thumbPath || item.json?.fileName || item.json?.filePath || item.json?.path, "");
  const candidate = normalizeCandidate(source.candidate || {}, index, thumbPath);
  const bestFrame = source.bestFrame && typeof source.bestFrame === "object" ? source.bestFrame : {};

  return {
    json: {
      ...(item.json || {}),
      thumbPath,
      candidate,
      bestFrame,
      frameCandidates: [candidate],
      technicalFrameCandidates: [candidate],
      frameCandidateCount: 1,
    },
    binary: item.binary,
  };
});
`;

const attachUploadedFrameCode = `// Reattach frame candidate metadata to Cloudinary thumbnail uploads.
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
      ...upload,
      thumbPath: candidate.thumbPath,
      candidate,
      frameCandidates: [candidate],
      technicalFrameCandidates: [candidate],
      bestFrame,
      frameCandidateCount: 1,
    },
    binary: item.binary,
  };
});
`;

getNode('Read Thumb');
getNode('Upload File');
getNode('Aggregate (2)');
getNode('Merge (2)');
getNode('Merge (3)1');
const compose2 = getNode('Compose (2)');
const compose3 = getNode('Compose (3)');
const prepareRequest = getNode('Prepare Request');

upsertCodeNode({
  name: 'Attach Frame Candidate Metadata',
  position: [-6288, -1728],
  jsCode: attachFrameCandidateCode,
});

upsertCodeNode({
  name: 'Attach Uploaded Frame Metadata',
  position: [-5392, -1968],
  jsCode: attachUploadedFrameCode,
});

removeConnection('Read Thumb', 'Merge (2)');
addConnection('Read Thumb', 'Attach Frame Candidate Metadata', 0, 0);
addConnection('Attach Frame Candidate Metadata', 'Merge (2)', 2, 0);

removeConnection('Upload File', 'Aggregate (2)');
addConnection('Upload File', 'Attach Uploaded Frame Metadata', 0, 0);
addConnection('Attach Uploaded Frame Metadata', 'Aggregate (2)', 0, 0);

const merge31 = getNode('Merge (3)1');
merge31.parameters ||= {};
merge31.parameters.numberInputs = Math.max(Number(merge31.parameters.numberInputs || 2), 3);
addConnection('Attach Uploaded Frame Metadata', 'Merge (3)1', 2, 0);

const aggregate2 = getNode('Aggregate (2)');
aggregate2.parameters ||= {};
aggregate2.parameters.fieldsToAggregate ||= {};
aggregate2.parameters.fieldsToAggregate.fieldToAggregate = [
  { fieldToAggregate: 'url' },
  { fieldToAggregate: 'secure_url' },
  { fieldToAggregate: 'candidate' },
  { fieldToAggregate: 'frameCandidates' },
  { fieldToAggregate: 'technicalFrameCandidates' },
  { fieldToAggregate: 'bestFrame' },
];

let composeCode = compose2.parameters.jsCode;

composeCode = replaceExact(
  composeCode,
  `function normalizeFrameCandidateArray(arr) {
  if (!Array.isArray(arr)) return [];

  return arr
    .map((candidate, idx) => normalizeFrameCandidate(candidate, idx))
    .filter(candidate =>
      candidate.url ||
      Number(candidate.rank || 0) > 0 ||
      Number(candidate.timestampSeconds || 0) > 0
    )
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
}
`,
  `function normalizeFrameCandidateArray(arr) {
  if (!Array.isArray(arr)) return [];

  return arr
    .map((candidate, idx) => normalizeFrameCandidate(candidate, idx))
    .filter(candidate =>
      candidate.url ||
      Number(candidate.rank || 0) > 0 ||
      Number(candidate.timestampSeconds || 0) > 0
    )
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
}

function safeNodeItems(name) {
  try {
    return $items(name) || [];
  } catch {
    return [];
  }
}

function flattenFrameCandidateItems(items) {
  const out = [];

  for (const item of items || []) {
    const j = (item && item.json) || {};
    const uploadUrl = ensureHttps(str(j.secure_url || j.url || "", ""));
    const arrays = [];

    if (Array.isArray(j.frameCandidates)) arrays.push(...j.frameCandidates);
    if (Array.isArray(j.technicalFrameCandidates)) arrays.push(...j.technicalFrameCandidates);
    if (j.candidate && typeof j.candidate === "object") arrays.push(j.candidate);

    for (const raw of arrays) {
      const c = normalizeFrameCandidate({
        ...raw,
        url: raw.url || raw.secure_url || uploadUrl,
        secure_url: raw.secure_url || raw.url || uploadUrl,
        resource_type: raw.resource_type || j.resource_type || "image",
        public_id: raw.public_id || j.public_id || j.id || "",
      }, out.length);

      if (c.url || Number(c.rank || 0) > 0 || Number(c.timestampSeconds || 0) > 0) {
        out.push(c);
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of out) {
    const key = [
      Number(candidate.rank || 0),
      Number(candidate.timestampSeconds || 0).toFixed(3),
      ensureHttps(candidate.url || ""),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped.sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
}

function countParsedFrameCandidates(items) {
  let total = 0;
  for (const item of items || []) {
    const j = (item && item.json) || {};
    if (j.candidate && typeof j.candidate === "object") total += 1;
    if (Array.isArray(j.frameCandidates)) total += j.frameCandidates.length;
    if (Array.isArray(j.technicalFrameCandidates)) total += j.technicalFrameCandidates.length;
    if (j.bestFrame && Array.isArray(j.bestFrame.candidates)) total += j.bestFrame.candidates.length;
  }
  return total;
}

function applyTechnicalFrameFallback(livItem, media, technicalCandidates, parsedCandidateCount, warnings) {
  const item = { ...(livItem || {}) };
  const mediaKind = detectMediaKindSmart(media?.mimeType, media?.webContentLink || media?.url || "");
  const existing = normalizeFrameCandidateArray(Array.isArray(item.frameCandidates) ? item.frameCandidates : []);

  if (existing.length) {
    item.frameCandidates = existing;
    return item;
  }

  if (mediaKind.isVideo && parsedCandidateCount > 0 && !technicalCandidates.length) {
    throw new Error(
      \`Compose (2): frame analysis gerou candidatos, mas nenhum candidato com URL publica chegou ao publish (groupKey=\${str(media?.groupKey, "n/a")}, mediaName=\${str(media?.name, "n/a")}).\`
    );
  }

  if (!technicalCandidates.length) return item;

  item.frameCandidates = technicalCandidates;
  const picked = pickFrameCandidate(item) || technicalCandidates[0];

  if (picked) {
    item.bestFrameSeconds = Number(item.bestFrameSeconds || 0) || Number(picked.timestampSeconds || 0);
    item.selectedFrameUrl = str(item.selectedFrameUrl, "") || str(picked.url, "");
    item.selectedFrameRank = Number(item.selectedFrameRank || 0) || Number(picked.rank || 0);
    const source = str(item.selectedFrameSource, "").trim().toLowerCase();
    item.selectedFrameSource = (!source || source === "none")
      ? "technical_frame_upload"
      : str(item.selectedFrameSource, "");
    item.bestFrameConfidence = Number(item.bestFrameConfidence || 0) || Number(picked.confidence || 0);
  }

  if (mediaKind.isVideo) {
    pushUnique(warnings, "frameCandidates preenchido pelo fallback tecnico do upload de thumbnails");
  }

  return item;
}
`,
  'frame candidate fallback helpers',
);

composeCode = replaceExact(
  composeCode,
  `const aggregate2Items = $items("Aggregate (2)")
//
// Esses nós são opcionais no caminho de imagem e quebram a execução.
// Frames devem vir da Livia em livItem.frameCandidates.

let c2Items = $items("Compose (1)") || [];
const thumbnailUploadItems = $items("Upload File") || [];
const mainUploadItems = $items("Upload Main Media") || [];
const uploadItems = mainUploadItems.length ? mainUploadItems : thumbnailUploadItems;
const liviaItems = $items("Livia") || [];
`,
  `const aggregate2Items = safeNodeItems("Aggregate (2)");
const parsedFrameItems = safeNodeItems("Parse Frame Analysis JSON");
const uploadedFrameItems = safeNodeItems("Attach Uploaded Frame Metadata");
const technicalFrameCandidates = flattenFrameCandidateItems(uploadedFrameItems.length ? uploadedFrameItems : aggregate2Items);
const parsedFrameCandidateCount = countParsedFrameCandidates(parsedFrameItems);

let c2Items = safeNodeItems("Compose (1)");
const thumbnailUploadItems = safeNodeItems("Upload File");
const mainUploadItems = safeNodeItems("Upload Main Media");
const uploadItems = mainUploadItems.length ? mainUploadItems : thumbnailUploadItems;
const liviaItems = safeNodeItems("Livia");
`,
  'safe item access and uploaded frame catalog',
);

composeCode = composeCode.replace(
  `// const aggregate2Items = safeNodeItems("Aggregate (2)");\nconst parsedFrameItems = safeNodeItems("Parse Frame Analysis JSON");`,
  `const aggregate2Items = safeNodeItems("Aggregate (2)");\nconst parsedFrameItems = safeNodeItems("Parse Frame Analysis JSON");`,
);

composeCode = replaceExact(
  composeCode,
  `        const livItem = extractFromLivia(liviaNorm, livIdx, livWarn);
        const capsHere = getCaptionsForIndex(liviaNorm, livIdx);
        const fbCaption = str(capsHere.fbCaption, "") || str(globalCaptions.fbCaption, "");
`,
  `        let livItem = extractFromLivia(liviaNorm, livIdx, livWarn);
        livItem = applyTechnicalFrameFallback(livItem, c2, technicalFrameCandidates, parsedFrameCandidateCount, livWarn);
        const capsHere = getCaptionsForIndex(liviaNorm, livIdx);
        const fbCaption = str(capsHere.fbCaption, "") || str(globalCaptions.fbCaption, "");
`,
  'facebook reels livia technical fallback',
);

composeCode = replaceExact(
  composeCode,
  `          const livItem = extractFromLivia(liviaNorm, livIdx, fileWarnings);
          const capsHere = getCaptionsForIndex(liviaNorm, livIdx);
`,
  `          let livItem = extractFromLivia(liviaNorm, livIdx, fileWarnings);
          livItem = applyTechnicalFrameFallback(livItem, c2, technicalFrameCandidates, parsedFrameCandidateCount, fileWarnings);
          const capsHere = getCaptionsForIndex(liviaNorm, livIdx);
`,
  'default upload livia technical fallback',
);

composeCode = replaceExact(
  composeCode,
  `        const livFirst = extractFromLivia(liviaNorm, livFirstIdx, livFirstWarnings);
        const capsFirst = getCaptionsForIndex(liviaNorm, livFirstIdx);
`,
  `        let livFirst = extractFromLivia(liviaNorm, livFirstIdx, livFirstWarnings);
        livFirst = applyTechnicalFrameFallback(livFirst, firstC2, technicalFrameCandidates, parsedFrameCandidateCount, livFirstWarnings);
        const capsFirst = getCaptionsForIndex(liviaNorm, livFirstIdx);
`,
  'publish livia technical fallback',
);

composeCode = composeCode.replace(
  `              bestFrameSeconds: livItem.bestFrameSeconds`,
  `              bestFrameSeconds: resolveEffectiveBestFrameSeconds(livItem),
              selectedFrameUrl: resolveSelectedFrameUrl(livItem, c2) || resolveSelectedFrameUrlFromLiviaCandidates(livItem)`,
);
composeCode = composeCode.replace(
  `              bestFrameSeconds: livItem.bestFrameSeconds`,
  `              bestFrameSeconds: resolveEffectiveBestFrameSeconds(livItem),
              selectedFrameUrl: resolveSelectedFrameUrl(livItem, c2) || resolveSelectedFrameUrlFromLiviaCandidates(livItem)`,
);

compose2.parameters.jsCode = composeCode;

let prepareCode = prepareRequest.parameters.jsCode;

prepareCode = replaceExact(
  prepareCode,
  `function isReadyFromBody({ platform, checkKind, body }) {
`,
  `function facebookReelsStatusWarnings({ platform, checkKind, body }) {
  const plat = String(platform || "").toLowerCase();
  const kind = String(checkKind || "").toLowerCase();
  if (plat !== "facebook" && !kind.startsWith("fb_")) return [];
  if (kind !== "fb_reels_video") return [];

  const status = body && typeof body === "object" && body.status && typeof body.status === "object"
    ? body.status
    : {};
  const warnings = [];
  const copyrightStatus = String(status?.copyright_check_status?.status || "").trim().toLowerCase();
  const processingStatus = String(status?.processing_phase?.status || "").trim().toLowerCase();
  const publishingStatus = String(status?.publishing_phase?.status || "").trim().toLowerCase();

  if (copyrightStatus && copyrightStatus !== "complete") {
    warnings.push(\`facebook.reels: copyright_check_status=\${copyrightStatus}\`);
  }
  if (processingStatus && !["complete", "completed"].includes(processingStatus)) {
    warnings.push(\`facebook.reels: processing_phase.status=\${processingStatus}\`);
  }
  if (publishingStatus && !["complete", "completed"].includes(publishingStatus)) {
    warnings.push(\`facebook.reels: publishing_phase.status=\${publishingStatus}\`);
  }

  return warnings;
}

function mergeWarnings(existing, additions) {
  const out = Array.isArray(existing) ? [...existing] : [];
  for (const warning of additions || []) {
    const s = str(warning, "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function isReadyFromBody({ platform, checkKind, body }) {
`,
  'facebook status warning helpers',
);

prepareCode = replaceExact(
  prepareCode,
  `  if (readyNow) {
    return [{
      json: removeNulls({
        ...job,
        ready: true,
        reason: "ready",
        attempt,
        lastStatusCode: httpEnv.statusCode,
        statusObjectId: extractIdFromAny(httpBody) || job.statusObjectId,
        // ✅ ADD: metadado útil para debug/auditoria
        lastResponseBody: httpBody,
      })
    }];
  }
`,
  `  if (readyNow) {
    const statusWarnings = facebookReelsStatusWarnings({
      platform: job.platform,
      checkKind: job.checkKind,
      body: httpBody,
    });

    return [{
      json: removeNulls({
        ...job,
        ready: true,
        reason: "ready",
        attempt,
        lastStatusCode: httpEnv.statusCode,
        statusObjectId: extractIdFromAny(httpBody) || job.statusObjectId,
        warnings: mergeWarnings(job.warnings, statusWarnings),
        // metadado útil para debug/auditoria
        lastResponseBody: httpBody,
      })
    }];
  }
`,
  'facebook status warnings on ready',
);

prepareRequest.parameters.jsCode = prepareCode;

let compose3Code = compose3.parameters.jsCode;
compose3Code = replaceExact(
  compose3Code,
  `function formatPermalink(value) {
  return str(value, "")
    .trim()
    .replace(/^https?:\\/\\//i, "")
    .replace(/^www\\./i, "")
    .replace(/\\/+$/g, "");
}

function extractPermalink(j) {
  return pickFirst(
    j.permalink,
    j.permalink_url,
    j.link,
    j.url,
    j.lastResponseBody?.permalink,
    j.lastResponseBody?.permalink_url,
    j.lastResponseBody?.link,
    j.lastResponseBody?.url,
    j.body?.permalink,
    j.body?.permalink_url,
    j.body?.link,
    j.body?.url
  );
}
`,
  `function formatPermalink(value) {
  return str(value, "")
    .trim()
    .replace(/^https?:\\/\\//i, "")
    .replace(/^www\\./i, "")
    .replace(/\\/+$/g, "");
}

function isPublicSocialPermalink(value) {
  const s = str(value, "").trim().toLowerCase();
  return (
    s.includes("instagram.com/") ||
    s.includes("facebook.com/reel/") ||
    s.includes("facebook.com/share/") ||
    s.includes("threads.com/") ||
    s.includes("threads.net/")
  );
}

function extractPermalink(j) {
  const candidates = [
    j.permalink,
    j.permalink_url,
    j.link,
    j.lastResponseBody?.permalink,
    j.lastResponseBody?.permalink_url,
    j.lastResponseBody?.link,
    j.lastResponseBody?.url,
    j.body?.permalink,
    j.body?.permalink_url,
    j.body?.link,
    j.body?.url,
    j.url,
  ];

  for (const value of candidates) {
    const s = str(value, "").trim();
    if (s && isPublicSocialPermalink(s)) return s;
  }

  return "";
}
`,
  'public permalink filtering',
);
compose3.parameters.jsCode = compose3Code;

workflow.meta ||= {};
workflow.meta.codexPatch = {
  name: 'livia-frame-candidate-propagation',
  appliedAt: new Date().toISOString(),
  notes: [
    'Preserves technical frame candidates across Read Thumb and Cloudinary thumbnail upload.',
    'Uses uploaded frame metadata as fallback when Livia omits frameCandidates.',
    'Fails before publish if frame analysis generated candidates but no public frame URL reaches Compose (2).',
    'Filters final notification permalinks to public social URLs.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2));

console.log(JSON.stringify({
  outputPath,
  nodes: workflow.nodes.length,
  hasAttachFrameCandidateMetadata: workflow.nodes.some((n) => n.name === 'Attach Frame Candidate Metadata'),
  hasAttachUploadedFrameMetadata: workflow.nodes.some((n) => n.name === 'Attach Uploaded Frame Metadata'),
  aggregate2Fields: aggregate2.parameters.fieldsToAggregate.fieldToAggregate.map((f) => f.fieldToAggregate),
  readThumbConnection: workflow.connections['Read Thumb'],
  uploadFileConnection: workflow.connections['Upload File'],
}, null, 2));
