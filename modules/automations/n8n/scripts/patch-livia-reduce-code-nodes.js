#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const runtimePaths = require('./lib/runtime-paths');

const DB_PATH = runtimePaths.dbPath;
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(runtimePaths.workflowsDir, 'livia.json'),
  path.join(runtimePaths.workflowsDir, 'livia.token-vault.export.json'),
];

const REMOVE_NODES = new Set([
  'Notify Once',
  'Attach Frame Candidate Metadata',
  'Upload Frame Candidate',
  'Attach Uploaded Frame Metadata',
  'Read Main Media For Publish',
]);

const PREPARE_MAIN_MEDIA_UPLOAD_CODE = String.raw`// Prepare frame candidates and the publishable main media upload without Merge nodes.
// Video runs arrive from Read Thumb; image runs usually already carry their main binary.
const fs = require("fs");
const path = require("path");

const TMP_DIR = String(process.env.N8N_TMP_DIR || ${JSON.stringify(runtimePaths.tmpDir)});
const MAX_MAIN_MEDIA_BYTES = 96 * 1024 * 1024;

function str(v, fb = "") {
  return (v === undefined || v === null) ? fb : String(v);
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function asObj(v) {
  return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
}

function fileNameOnly(value) {
  return str(value, "").split("/").filter(Boolean).pop() || "";
}

function fileBaseName(value) {
  return fileNameOnly(value).replace(/\.[^.]+$/, "");
}

function extFromName(value) {
  const name = fileNameOnly(value);
  const match = name.match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function derivePrefix(value) {
  const name = fileNameOnly(value);
  const match = name.match(/^(\d{10})(?:[_\-. ]|$)/);
  return match ? match[1] : "";
}

function deriveGroupKey(value) {
  const prefix = derivePrefix(value);
  return prefix ? "dt:" + prefix : "";
}

function mimeFromExt(ext, fallback = "") {
  const e = str(ext, "").toLowerCase();
  if (["mp4", "m4v"].includes(e)) return "video/mp4";
  if (e === "mov") return "video/quicktime";
  if (e === "webm") return "video/webm";
  if (e === "mkv") return "video/x-matroska";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  return fallback;
}

function normalizeDedupeKey(value, index) {
  const base = fileBaseName(value)
    .replace(/_temp$/i, "")
    .replace(/_thumb$/i, "")
    .replace(/_cand_\d+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return base || "item-" + index;
}

function pushUnique(list, value) {
  if (!value || list.includes(value)) return;
  list.push(value);
}

function firstCandidate(json) {
  if (json.candidate && typeof json.candidate === "object") return json.candidate;
  if (Array.isArray(json.frameCandidates) && json.frameCandidates[0]) return json.frameCandidates[0];
  if (Array.isArray(json.technicalFrameCandidates) && json.technicalFrameCandidates[0]) return json.technicalFrameCandidates[0];
  return {};
}

function deriveRankFromName(value) {
  const name = fileNameOnly(value);
  const match = name.match(/(?:^|[_-])cand[_-]?(\d{1,3})(?:\.|$)/i);
  return match ? num(match[1], 0) : 0;
}

function normalizeCandidate(raw, index, fallbackThumbPath, fallbackFileName) {
  const c = asObj(raw);
  const thumbPath = str(c.thumbPath || c.path || fallbackThumbPath || fallbackFileName, "");
  const fileName = fileNameOnly(thumbPath) || fileNameOnly(fallbackFileName);
  const derivedRank = deriveRankFromName(fileName);
  const hasRichCandidate = Object.keys(c).length > 0;
  return {
    rank: num(c.rank, derivedRank || index + 1),
    timestamp: str(c.timestamp || c.bestTimestamp, ""),
    timestampSeconds: num(c.timestampSeconds ?? c.bestTimestampSeconds, 0),
    confidence: num(c.confidence ?? c.score, 0),
    reason: str(c.reason || c.why || c.notes, ""),
    thumbPath,
    fileName,
    fileBase: fileBaseName(fileName),
    source: hasRichCandidate ? "current-item" : "frame-analysis-fallback",
  };
}

function isFrameCandidateInput(json, binaryData) {
  const source = str(json.thumbPath || json.fileName || json.filePath || json.path || json.name || binaryData.fileName, "");
  return /(?:^|[_-])cand[_-]?\d{1,3}\.(?:jpe?g|png|webp)$/i.test(fileNameOnly(source));
}

function normalizeTmpPath(value) {
  const raw = str(value, "").trim();
  if (!raw) return "";
  const tmpRoot = path.resolve(TMP_DIR);
  const candidate = path.isAbsolute(raw) ? raw : path.join(tmpRoot, fileNameOnly(raw));
  const resolved = path.resolve(candidate);
  if (resolved === tmpRoot || !resolved.startsWith(tmpRoot + path.sep)) return "";
  return resolved;
}

function candidateMainPathsFromThumb(value) {
  const full = normalizeTmpPath(value);
  if (!full) return [];
  const dir = path.dirname(full);
  const file = path.basename(full);
  const stems = [];
  const withoutExt = file.replace(/\.[^.]+$/, "");
  const candMatch = withoutExt.match(/^(.*?)(?:_temp)?_cand_\d+$/i);
  if (candMatch) {
    stems.push(candMatch[1]);
    stems.push(candMatch[1] + "_temp");
  }
  stems.push(withoutExt.replace(/_temp$/i, ""));
  const exts = ["mp4", "mov", "m4v", "webm", "mkv"];
  const out = [];
  for (const stem of stems) {
    for (const ext of exts) {
      const p = normalizeTmpPath(path.join(dir, stem + "." + ext));
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

function resolveMainMediaPath(json) {
  const direct = normalizeTmpPath(json.mainMediaFileName || json.fileName || json.filePath || json.path || "");
  if (direct && fs.existsSync(direct) && /^video\//i.test(mimeFromExt(extFromName(direct)))) return direct;
  const sources = [
    json.mainMediaFileName,
    json.optimizedPath,
    json.optimizedFileName,
    json.thumbPath,
    json.fileName,
    json.filePath,
    json.path,
    json.name,
  ];
  for (const source of sources) {
    for (const p of candidateMainPathsFromThumb(source)) {
      if (fs.existsSync(p)) return p;
    }
  }
  return "";
}

function binaryFromFile(filePath) {
  const safePath = normalizeTmpPath(filePath);
  if (!safePath) throw new Error("main_media_file_path_not_allowed");
  const stat = fs.statSync(safePath);
  if (!stat.isFile()) throw new Error("main_media_file_not_found");
  if (stat.size > MAX_MAIN_MEDIA_BYTES) {
    throw new Error("main_media_file_too_large_for_code_read:" + stat.size);
  }
  const ext = extFromName(safePath);
  const mimeType = mimeFromExt(ext, "application/octet-stream");
  return {
    data: fs.readFileSync(safePath).toString("base64"),
    mimeType,
    fileName: fileNameOnly(safePath),
    fileExtension: ext,
    fileType: mimeType.startsWith("video/") ? "video" : "image",
    fileSize: String(stat.size),
  };
}

function makeFrameCandidateItem(item, index) {
  const currentJson = asObj(item && item.json);
  const binary = item.binary || {};
  const binaryData = binary.data || {};
  const rawCandidate = firstCandidate(currentJson);
  const fallbackThumbPath = str(
    currentJson.thumbPath ||
    asObj(rawCandidate).thumbPath ||
    currentJson.fileName ||
    currentJson.filePath ||
    currentJson.path ||
    currentJson.name ||
    binaryData.fileName,
    ""
  );
  const candidate = normalizeCandidate(rawCandidate, index, fallbackThumbPath, fileNameOnly(fallbackThumbPath));
  const derivedGroupKey = deriveGroupKey(candidate.fileName || fallbackThumbPath);
  const warnings = Array.isArray(currentJson.frameMetadataWarnings) ? [...currentJson.frameMetadataWarnings] : [];

  if (!Object.keys(asObj(rawCandidate)).length) pushUnique(warnings, "frame_metadata_missing_due_to_pinned_context");
  if (!currentJson.mediaId && !currentJson.mediaName && !currentJson.groupKey) pushUnique(warnings, "media_context_missing_due_to_pinned_context");

  return {
    json: {
      ...currentJson,
      mediaId: str(currentJson.mediaId || currentJson.id, ""),
      mediaName: str(currentJson.mediaName || "", ""),
      mediaMimeType: str(currentJson.mediaMimeType || "", ""),
      groupKey: str(currentJson.groupKey || derivedGroupKey, ""),
      groupOrder: currentJson.groupOrder,
      publishTime: str(currentJson.publishTime || "", ""),
      thumbPath: candidate.thumbPath || fallbackThumbPath,
      candidate,
      bestFrame: asObj(currentJson.bestFrame),
      frameCandidates: [candidate],
      technicalFrameCandidates: [candidate],
      frameCandidateCount: 1,
      uploadRole: "frame_candidate",
      fileType: "image",
      frameMetadataSource: candidate.source,
      mediaMetadataSource: currentJson.groupKey ? "current-item" : "derived-from-thumb-name",
      frameMetadataWarnings: warnings,
    },
    binary,
  };
}

function makeMainMediaItem(item, index, forcedPath = "") {
  const current = asObj(item && item.json);
  const binary = item.binary || {};
  const binaryData = binary.data || {};
  const mainPath = forcedPath || resolveMainMediaPath(current);
  const hasVideoPath = !!mainPath;
  const publishFileName = str(
    hasVideoPath ? mainPath : (
      current.mainMediaFileName ||
      current.fileName ||
      current.filePath ||
      current.path ||
      current.name ||
      binaryData.fileName
    ),
    ""
  );
  const ext = extFromName(publishFileName || current.name || binaryData.fileName);
  const prefix = derivePrefix(publishFileName || current.name || binaryData.fileName);
  const derivedName = prefix && ext ? prefix + "." + ext : fileNameOnly(publishFileName || current.name || binaryData.fileName);
  const preparedBinary = hasVideoPath ? { data: binaryFromFile(mainPath) } : binary;
  const preparedBinaryData = preparedBinary.data || {};
  const mimeType = str(
    current.mimeType ||
    current.mediaMimeType ||
    preparedBinaryData.mimeType ||
    binaryData.mimeType ||
    mimeFromExt(ext, ""),
    ""
  );
  const isVideo = mimeType.toLowerCase().startsWith("video/") || ["mp4", "mov", "m4v", "webm", "mkv"].includes(ext);
  const warnings = Array.isArray(current.mainMediaUploadWarnings) ? [...current.mainMediaUploadWarnings] : [];

  if (!current.id && !current.name && !current.groupKey) pushUnique(warnings, "main_media_context_derived_from_file_name");
  if (!publishFileName) pushUnique(warnings, "main_media_file_name_missing");
  if (hasVideoPath) pushUnique(warnings, "main_media_binary_read_in_code_node");

  return {
    json: {
      ...current,
      id: current.id || current.mediaId || "",
      name: current.name || current.mediaName || derivedName,
      mimeType,
      groupKey: current.groupKey || deriveGroupKey(publishFileName || current.name || binaryData.fileName),
      groupOrder: current.groupOrder,
      publishTime: current.publishTime || "",
      mainMediaFileName: publishFileName,
      uploadRole: "main_media",
      fileType: isVideo ? "video" : "image",
      media_type: current.media_type || (isVideo ? "VIDEO" : "IMAGE"),
      media_type_1st_requisition: current.media_type_1st_requisition || (isVideo ? "VIDEO" : "IMAGE"),
      media_type_2nd_requisition: current.media_type_2nd_requisition || (isVideo ? "VIDEO" : "IMAGE"),
      media_type_instagram: current.media_type_instagram || (isVideo ? "REELS" : ""),
      mainMediaUploadWarnings: warnings,
    },
    binary: preparedBinary,
  };
}

const seenMain = new Set();
const output = [];

for (const [index, item] of $input.all().entries()) {
  const current = asObj(item && item.json);
  const binaryData = asObj(asObj(item && item.binary).data);

  if (isFrameCandidateInput(current, binaryData)) {
    output.push(makeFrameCandidateItem(item, index));
    const mainPath = resolveMainMediaPath(current);
    const dedupeKey = normalizeDedupeKey(mainPath || current.thumbPath || current.fileName || current.name, index);
    if (mainPath && !seenMain.has(dedupeKey)) {
      seenMain.add(dedupeKey);
      output.push(makeMainMediaItem(item, index, mainPath));
    }
    continue;
  }

  const publishFileName = str(current.mainMediaFileName || current.fileName || current.filePath || current.path || current.name || binaryData.fileName, "");
  const dedupeKey = normalizeDedupeKey(publishFileName, index);
  if (seenMain.has(dedupeKey)) continue;
  seenMain.add(dedupeKey);
  output.push(makeMainMediaItem(item, index));
}

return output;`;

const ATTACH_UPLOADED_MAIN_MEDIA_METADATA_CODE = String.raw`// Reattach mixed Cloudinary uploads: frame candidates are cached, main media is sent to Livia.
function str(v, fb = "") {
  return (v === undefined || v === null) ? fb : String(v);
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function asObj(v) {
  return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
}

function ensureHttps(url) {
  const s = str(url, "").trim();
  if (!s) return "";
  return s.replace(/^http:\/\//i, "https://");
}

function fileNameOnly(value) {
  return str(value, "").split("/").filter(Boolean).pop() || "";
}

function fileBaseName(value) {
  return fileNameOnly(value).replace(/\.[^.]+$/, "");
}

function extFromName(value) {
  const name = fileNameOnly(value);
  const match = name.match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function normalizeBase(value) {
  return fileBaseName(value)
    .replace(/_temp$/i, "")
    .replace(/_thumb$/i, "")
    .replace(/_cand_\d+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function derivePrefix(value) {
  const name = fileNameOnly(value);
  const match = name.match(/^(\d{10})(?:[_\-. ]|$)/);
  return match ? match[1] : "";
}

function deriveGroupKey(value) {
  const prefix = derivePrefix(value);
  return prefix ? "dt:" + prefix : "";
}

function deriveRankFromName(value, fallback) {
  const name = fileNameOnly(value);
  const match = name.match(/(?:^|[_-])cand[_-]?(\d{1,3})(?:\.|$)/i);
  return match ? num(match[1], fallback) : fallback;
}

function mimeFromUpload(upload, fallback = "") {
  const resourceType = str(upload.resource_type || "", "").toLowerCase();
  const format = str(upload.format || extFromName(upload.secure_url || upload.url || upload.original_filename || upload.display_name || upload.public_id), "").toLowerCase();
  if (resourceType === "video" || ["mp4", "mov", "m4v", "webm", "mkv"].includes(format)) return "video/mp4";
  if (resourceType === "image" || ["jpg", "jpeg", "png", "webp", "gif"].includes(format)) {
    if (format === "png") return "image/png";
    if (format === "webp") return "image/webp";
    return "image/jpeg";
  }
  return fallback;
}

function mediaTypeFromMime(mimeType) {
  return str(mimeType, "").toLowerCase().startsWith("video/") ? "VIDEO" : "IMAGE";
}

function cacheKeys(...values) {
  const keys = [];
  for (const value of values) {
    const raw = str(value, "").trim();
    const groupKey = raw.startsWith("dt:") ? raw : deriveGroupKey(raw);
    const prefix = derivePrefix(raw);
    const base = normalizeBase(raw);
    for (const key of [raw, groupKey, prefix, base]) {
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function getExecutionFrameStoreForWrite() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    sd.__liviaFrameUploads ||= {};
    for (const key of Object.keys(sd.__liviaFrameUploads)) {
      if (key !== execId) delete sd.__liviaFrameUploads[key];
    }
    sd.__liviaFrameUploads[execId] ||= {};
    return sd.__liviaFrameUploads[execId];
  } catch {
    return null;
  }
}

function getExecutionFrameStore() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd.__liviaFrameUploads)[execId]);
  } catch {
    return {};
  }
}

function getExecutionMainStore() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    sd.__liviaMainUploads ||= {};
    for (const key of Object.keys(sd.__liviaMainUploads)) {
      if (key !== execId) delete sd.__liviaMainUploads[key];
    }
    sd.__liviaMainUploads[execId] ||= {};
    return sd.__liviaMainUploads[execId];
  } catch {
    return null;
  }
}

function getExecutionCompose1Store() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd.__liviaCompose1)[execId]);
  } catch {
    return {};
  }
}

function sourceNameForUpload(upload, finalUrl = "") {
  return str(
    upload.fileName ||
    upload.thumbPath ||
    upload.mainMediaFileName ||
    upload.name ||
    upload.mediaName ||
    upload.original_filename ||
    upload.display_name ||
    upload.public_id ||
    finalUrl ||
    upload.url,
    ""
  );
}

function isFrameCandidateUpload(upload) {
  if (upload.uploadRole === "frame_candidate") return true;
  if (upload.uploadRole === "main_media") return false;
  const source = sourceNameForUpload(upload, upload.secure_url || upload.url);
  return /(?:^|[_-])cand[_-]?\d{1,3}(?:\.|$)/i.test(fileNameOnly(source) || source);
}

function buildFrameContext(upload, index) {
  const url = ensureHttps(upload.secure_url || upload.url || upload.finalUrl || "");
  const sourceName = sourceNameForUpload(upload, url);
  const groupKey = str(upload.groupKey || deriveGroupKey(sourceName), "");
  const candidateSource = asObj(upload.candidate);
  const candidate = {
    ...candidateSource,
    rank: num(candidateSource.rank, deriveRankFromName(sourceName, index + 1)),
    timestamp: str(candidateSource.timestamp || candidateSource.bestTimestamp || upload.timestamp || upload.bestTimestamp, ""),
    timestampSeconds: num(candidateSource.timestampSeconds ?? candidateSource.bestTimestampSeconds ?? upload.timestampSeconds ?? upload.bestTimestampSeconds, 0),
    confidence: num(candidateSource.confidence ?? candidateSource.score ?? upload.confidence ?? upload.score, 0),
    reason: str(candidateSource.reason || candidateSource.why || candidateSource.notes || upload.reason || upload.why || upload.notes, ""),
    thumbPath: str(candidateSource.thumbPath || upload.thumbPath || sourceName, ""),
    fileName: fileNameOnly(candidateSource.fileName || sourceName) || fileNameOnly(url),
    fileBase: fileBaseName(candidateSource.fileName || sourceName) || fileBaseName(url),
    url,
    secure_url: url,
    resource_type: str(upload.resource_type || candidateSource.resource_type || "image", "image"),
    public_id: str(upload.public_id || upload.id || candidateSource.public_id || ""),
    source: "cloudinary-frame-upload-derived",
  };
  const bestFrame = {
    applicable: true,
    ...asObj(upload.bestFrame),
    selectedFrameUrl: candidate.url,
    selectedFrameRank: candidate.rank,
    selectedFrameSource: "technical_frame_upload",
    bestTimestamp: candidate.timestamp,
    bestTimestampSeconds: candidate.timestampSeconds,
    confidence: candidate.confidence,
  };
  return {
    mediaId: str(upload.mediaId || upload.id || "", ""),
    mediaName: str(upload.mediaName || "", ""),
    mediaMimeType: str(upload.mediaMimeType || "", ""),
    groupKey,
    groupOrder: upload.groupOrder,
    publishTime: str(upload.publishTime || "", ""),
    uploadRole: "frame_candidate",
    thumbPath: candidate.thumbPath,
    candidate,
    frameCandidates: [candidate],
    technicalFrameCandidates: [candidate],
    bestFrame,
    frameCandidateCount: 1,
  };
}

function cacheFrameContext(upload, index, frameStore) {
  const frameContext = buildFrameContext(upload, index);
  const outputJson = { ...upload, ...frameContext };
  if (frameStore) {
    frameStore.__items ||= [];
    frameStore.__items.push({ json: outputJson });
    const sourceName = sourceNameForUpload(upload, upload.secure_url || upload.url);
    for (const key of cacheKeys(frameContext.groupKey, sourceName, upload.public_id, frameContext.candidate.url)) {
      frameStore[key] = frameContext;
    }
  }
  return outputJson;
}

function findCompose1Context({ groupKey, name, upload, finalUrl }) {
  const keys = cacheKeys(groupKey, name, upload.id, upload.mediaId, upload.public_id, upload.original_filename, upload.display_name, finalUrl);
  const store = getExecutionCompose1Store();
  for (const key of keys) {
    if (store[key]) return asObj(store[key]);
  }
  const rows = Array.isArray(store.__items)
    ? store.__items.map((item) => asObj(item && item.json)).filter((row) => Object.keys(row).length)
    : [];
  for (const row of rows) {
    const rowKeys = cacheKeys(row.groupKey, row.name, row.id, row.webContentLink);
    if (keys.some((key) => rowKeys.includes(key))) return row;
  }
  if (groupKey) {
    const byGroup = rows.find((row) => str(row.groupKey, "") === groupKey);
    if (byGroup) return byGroup;
  }
  return {};
}

function findFrameContext(groupKey, sourceName, upload) {
  const store = getExecutionFrameStore();
  for (const key of cacheKeys(groupKey, sourceName, upload.public_id, upload.secure_url, upload.url, upload.id, upload.mediaId)) {
    if (store[key]) return asObj(store[key]);
  }
  const rows = Array.isArray(store.__items)
    ? store.__items.map((item) => asObj(item && item.json)).filter((row) => Object.keys(row).length)
    : [];
  const matches = rows.filter((row) => {
    if (groupKey && row.groupKey === groupKey) return true;
    const rowKeys = cacheKeys(row.groupKey, row.mediaName, row.thumbPath, row.candidate?.thumbPath, row.candidate?.url);
    const keys = cacheKeys(groupKey, sourceName, upload.public_id, upload.secure_url, upload.url);
    return keys.some((key) => rowKeys.includes(key));
  });
  if (!matches.length) return {};
  const candidates = matches.flatMap((row) => Array.isArray(row.technicalFrameCandidates) ? row.technicalFrameCandidates : []);
  const best = matches.find((row) => asObj(row.bestFrame).selectedFrameUrl)?.bestFrame || matches[0].bestFrame || {};
  return {
    ...matches[0],
    frameCandidates: candidates.length ? candidates : matches.flatMap((row) => Array.isArray(row.frameCandidates) ? row.frameCandidates : []),
    technicalFrameCandidates: candidates,
    bestFrame: best,
    frameCandidateCount: candidates.length || matches.length,
  };
}

function deriveName(upload, finalUrl) {
  const raw = str(
    upload.name ||
    upload.mediaName ||
    upload.mainMediaFileName ||
    upload.fileName ||
    upload.original_filename ||
    upload.display_name ||
    upload.public_id ||
    finalUrl,
    ""
  );
  const fileName = fileNameOnly(raw);
  if (fileName) return fileName;
  const base = fileBaseName(finalUrl);
  const format = str(upload.format || extFromName(finalUrl), "");
  return base && format ? base + "." + format : base;
}

const frameStore = getExecutionFrameStoreForWrite();
const mainStore = getExecutionMainStore();
const inputItems = $input.all();

for (const [index, item] of inputItems.entries()) {
  const upload = asObj(item && item.json);
  if (isFrameCandidateUpload(upload)) {
    cacheFrameContext(upload, index, frameStore);
  }
}

const output = [];

for (const item of inputItems) {
  const upload = asObj(item && item.json);
  if (isFrameCandidateUpload(upload)) continue;

  const finalUrl = ensureHttps(upload.secure_url || upload.url || upload.finalUrl || "");
  const name = deriveName(upload, finalUrl);
  const groupKey = str(upload.groupKey || deriveGroupKey(name || upload.public_id || finalUrl), "");
  const mimeType = str(upload.mimeType || upload.mediaMimeType || mimeFromUpload(upload, ""), "");
  const mediaType = mediaTypeFromMime(mimeType);
  const frameContext = findFrameContext(groupKey, name, upload);
  const compose1Context = findCompose1Context({ groupKey, name, upload, finalUrl });
  const frameCandidates = Array.isArray(frameContext.frameCandidates) ? frameContext.frameCandidates : [];
  const technicalFrameCandidates = Array.isArray(frameContext.technicalFrameCandidates) ? frameContext.technicalFrameCandidates : frameCandidates;
  const bestFrame = asObj(frameContext.bestFrame);
  const warnings = [
    ...(Array.isArray(upload.warnings) ? upload.warnings : []),
    ...(Array.isArray(upload.mainMediaUploadWarnings) ? upload.mainMediaUploadWarnings : []),
  ].filter(Boolean);

  if (!upload.id && !upload.mediaId && !compose1Context.id) warnings.push("main_media_drive_context_not_available_after_upload");
  if (!Object.keys(frameContext).length && mediaType === "VIDEO") warnings.push("frame_context_not_available_after_upload");
  if (!upload.instagram && !compose1Context.instagram) warnings.push("publish_context_rehydrated_from_compose1_missing_instagram");
  if (!upload.facebook && !compose1Context.facebook) warnings.push("publish_context_rehydrated_from_compose1_missing_facebook");
  if (!upload.threads && !compose1Context.threads) warnings.push("publish_context_rehydrated_from_compose1_missing_threads");

  const outputJson = {
    ...compose1Context,
    ...upload,
    id: str(upload.id || upload.mediaId || compose1Context.id || "", ""),
    name: name || str(compose1Context.name || "", ""),
    mimeType: mimeType || str(compose1Context.mimeType || "", ""),
    groupKey: groupKey || str(compose1Context.groupKey || "", ""),
    groupOrder: upload.groupOrder ?? compose1Context.groupOrder,
    publishTime: str(upload.publishTime || compose1Context.publishTime || "", ""),
    uploadRole: "main_media",
    finalUrl,
    secure_url: finalUrl || upload.secure_url,
    url: finalUrl || upload.url,
    resource_type: str(upload.resource_type || (mediaType === "VIDEO" ? "video" : "image"), ""),
    format: str(upload.format || extFromName(name || finalUrl), ""),
    media_type: upload.media_type || compose1Context.media_type || mediaType,
    media_type_1st_requisition: upload.media_type_1st_requisition || compose1Context.media_type_1st_requisition || mediaType,
    media_type_2nd_requisition: upload.media_type_2nd_requisition || compose1Context.media_type_2nd_requisition || mediaType,
    media_type_instagram: upload.media_type_instagram || compose1Context.media_type_instagram || (mediaType === "VIDEO" ? "REELS" : ""),
    facebook: upload.facebook || compose1Context.facebook,
    instagram: upload.instagram || compose1Context.instagram,
    threads: upload.threads || compose1Context.threads,
    mainMedia: {
      secure_url: finalUrl || upload.secure_url || "",
      url: finalUrl || upload.url || "",
      resource_type: str(upload.resource_type || (mediaType === "VIDEO" ? "video" : "image"), ""),
      format: str(upload.format || extFromName(name || finalUrl), ""),
      public_id: str(upload.public_id || "", ""),
    },
    bestFrame,
    frameCandidates,
    technicalFrameCandidates,
    frameCandidateCount: technicalFrameCandidates.length,
    warnings,
  };

  if (mainStore) {
    mainStore.__items ||= [];
    mainStore.__items.push({ json: outputJson });
    for (const key of cacheKeys(groupKey, name, upload.public_id, finalUrl, outputJson.id)) {
      mainStore[key] = outputJson;
    }
  }

  output.push({
    json: outputJson,
    binary: item.binary,
  });
}

return output;`;

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function workflowFromRow(row, includePinData = false) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: includePinData ? parseJson(row.pinData, {}) : {},
    meta: parseJson(row.meta, null),
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    updatedAt: row.updatedAt,
  };
}

function getNode(nodes, name) {
  const node = nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
}

function replaceTarget(connections, from, oldTarget, newTarget) {
  const groups = connections[from]?.main || [];
  for (const group of groups) {
    for (const connection of group || []) {
      if (connection.node === oldTarget) connection.node = newTarget;
    }
  }
}

function setSingleConnection(connections, from, target, outputIndex = 0, inputIndex = 0) {
  connections[from] ||= {};
  connections[from].main ||= [];
  connections[from].main[outputIndex] ||= [];
  connections[from].main[outputIndex] = [{ node: target, type: 'main', index: inputIndex }];
}

function pruneRemovedConnections(connections) {
  for (const source of Object.keys(connections)) {
    if (REMOVE_NODES.has(source)) {
      delete connections[source];
      continue;
    }
    for (const [outputName, groups] of Object.entries(connections[source] || {})) {
      connections[source][outputName] = (groups || []).map((group) =>
        (group || []).filter((connection) => !REMOVE_NODES.has(connection.node)),
      );
    }
  }
}

function assertConnection(connections, source, target) {
  const exists = (connections[source]?.main || []).some((group) =>
    Array.isArray(group) && group.some((connection) => connection.node === target),
  );
  if (!exists) throw new Error(`Missing connection after patch: ${source} -> ${target}`);
}

function patchWorkflow(workflow) {
  const nodes = workflow.nodes;
  const connections = workflow.connections;

  getNode(nodes, 'Compose (3)');
  getNode(nodes, 'Notify Once');
  getNode(nodes, 'Read Thumb');
  getNode(nodes, 'Prepare Main Media Upload');
  getNode(nodes, 'Upload Main Media');
  getNode(nodes, 'Attach Uploaded Main Media Metadata');
  getNode(nodes, 'Inform Success (1)');

  workflow.nodes = nodes.filter((node) => !REMOVE_NODES.has(node.name));
  pruneRemovedConnections(connections);
  replaceTarget(connections, 'Compose (3)', 'Notify Once', 'Inform Success (1)');
  const composeTargets = connections['Compose (3)']?.main?.[0] || [];
  if (!composeTargets.some((connection) => connection.node === 'Inform Success (1)')) {
    composeTargets.push({ node: 'Inform Success (1)', type: 'main', index: 0 });
  }
  connections['Compose (3)'].main[0] = composeTargets.filter((connection, index, list) =>
    list.findIndex((item) => item.node === connection.node && item.index === connection.index) === index,
  );
  setSingleConnection(connections, 'Read Thumb', 'Prepare Main Media Upload', 0, 0);

  const inform = getNode(workflow.nodes, 'Inform Success (1)');
  inform.executeOnce = true;

  getNode(workflow.nodes, 'Prepare Main Media Upload').parameters.jsCode = PREPARE_MAIN_MEDIA_UPLOAD_CODE;
  getNode(workflow.nodes, 'Attach Uploaded Main Media Metadata').parameters.jsCode = ATTACH_UPLOADED_MAIN_MEDIA_METADATA_CODE;

  assertConnection(connections, 'Compose (3)', 'Update File');
  assertConnection(connections, 'Compose (3)', 'Inform Success (1)');
  assertConnection(connections, 'Read Thumb', 'Prepare Main Media Upload');
  assertConnection(connections, 'Prepare Main Media Upload', 'Upload Main Media');
  assertConnection(connections, 'Upload Main Media', 'Attach Uploaded Main Media Metadata');
  assertConnection(connections, 'Attach Uploaded Main Media Metadata', 'Livia');

  workflow.connections = connections;
  return workflow;
}

function writeExport(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

const db = new Database(DB_PATH);
const row = db.prepare('select * from workflow_entity where id = ?').get(WORKFLOW_ID);
if (!row) throw new Error(`Workflow not found: ${WORKFLOW_ID}`);

const before = workflowFromRow(row, true);
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const checkpointPath = path.join(runtimePaths.workflowsDir, `livia.before-reduce-code-nodes.${timestamp}.json`);
writeExport(before, checkpointPath);

const workflow = patchWorkflow(workflowFromRow(row, false));
const versionId = crypto.randomUUID();
const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
const meta = {
  ...(workflow.meta || {}),
  codexPatch: {
    name: 'livia-reduce-code-nodes',
    appliedAt: new Date().toISOString(),
    removedNodes: [...REMOVE_NODES],
    previousVersionId: row.versionId,
  },
};

workflow.versionId = versionId;
workflow.activeVersionId = versionId;
workflow.updatedAt = updatedAt;
workflow.meta = meta;
workflow.pinData = {};

const nodesJson = JSON.stringify(workflow.nodes);
const connectionsJson = JSON.stringify(workflow.connections);
const metaJson = JSON.stringify(meta);

const insertHistory = db.prepare(`
  insert into workflow_history
    (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
  values
    (@versionId, @workflowId, @authors, @createdAt, @updatedAt, @nodes, @connections, @name, 0, @description)
`);
const updateWorkflow = db.prepare(`
  update workflow_entity
  set nodes = @nodes,
      connections = @connections,
      meta = @meta,
      versionId = @versionId,
      activeVersionId = @versionId,
      updatedAt = @updatedAt,
      versionCounter = versionCounter + 1
  where id = @workflowId
`);

db.transaction(() => {
  insertHistory.run({
    versionId,
    workflowId: WORKFLOW_ID,
    authors: 'Codex',
    createdAt: updatedAt,
    updatedAt,
    nodes: nodesJson,
    connections: connectionsJson,
    name: workflow.name,
    description: row.description || null,
  });
  updateWorkflow.run({
    nodes: nodesJson,
    connections: connectionsJson,
    meta: metaJson,
    versionId,
    updatedAt,
    workflowId: WORKFLOW_ID,
  });
})();

for (const exportPath of EXPORT_PATHS) {
  writeExport(workflow, exportPath);
}

console.log(JSON.stringify({
  ok: true,
  workflowId: WORKFLOW_ID,
  previousVersionId: row.versionId,
  versionId,
  checkpointPath,
  nodes: workflow.nodes.length,
  codeNodes: workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.code').length,
  exports: EXPORT_PATHS,
}, null, 2));
