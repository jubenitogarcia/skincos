// Prepare Media Upload Batch (n8n Code node)
// Normaliza a saída do processador unificado e produz o lote canônico para o upload.

function str(v, fb = "") {
  return v === undefined || v === null ? fb : String(v);
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function fileNameOnly(value) {
  return str(value, "").split("/").filter(Boolean).pop() || "";
}

function extFromName(value) {
  const name = fileNameOnly(value);
  const match = name.match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function safeBase(value) {
  const raw = str(value, "")
    .replace(/^dt:/, "")
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "");
  const normalized = typeof raw.normalize === "function" ? raw.normalize("NFD") : raw;
  return normalized
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "media";
}

function derivePrefix(value) {
  const match = fileNameOnly(value).match(/^(\d{10})(?:[_\-. ]|$)/);
  return match ? match[1] : "";
}

function deriveGroupKey(value) {
  const prefix = derivePrefix(value);
  return prefix ? `dt:${prefix}` : "";
}

function toSeconds(ts) {
  if (typeof ts === "number") return ts;
  const s = str(ts, "").trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);

  const parts = s.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    return Number.isNaN(mm) || Number.isNaN(ss) ? 0 : mm * 60 + ss;
  }

  if (parts.length === 3) {
    const hh = Number(parts[0]);
    const mm = Number(parts[1]);
    const ss = Number(parts[2]);
    return Number.isNaN(hh) || Number.isNaN(mm) || Number.isNaN(ss) ? 0 : hh * 3600 + mm * 60 + ss;
  }

  return 0;
}

function toTimestamp(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const pad2 = (n) => String(n).padStart(2, "0");
  if (hh > 0) return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  return `${pad2(mm)}:${pad2(ss)}`;
}

function safeJsonParseMaybeString(raw) {
  if (raw && typeof raw === "object") return raw;

  const text = str(raw, "").trim();
  if (!text) return null;

  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      return JSON.parse(text);
    } catch {}
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
}

function parseJsonl(text) {
  const lines = str(text, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && (line.startsWith("{") || line.startsWith("[")));

  const rows = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed) rows.push(parsed);
    } catch {}
  }
  return rows.length ? rows : null;
}

function normalizeCandidate(candidate) {
  const current = asObj(candidate);
  const timestampSeconds =
    num(current.timestampSeconds, NaN) ||
    num(current.bestTimestampSeconds, NaN) ||
    num(current.bestFrameSeconds, NaN) ||
    toSeconds(current.timestamp || current.bestTimestamp || current.timecode || "");

  return {
    timestamp: str(current.timestamp, "") || str(current.bestTimestamp, "") || toTimestamp(timestampSeconds),
    timestampSeconds: Number.isFinite(timestampSeconds) ? timestampSeconds : 0,
    confidence: clamp01(current.confidence ?? current.score ?? 0),
    reason: str(current.reason, "") || str(current.why, "") || "melhor score técnico",
  };
}

function normalizeCandidateThumb(candidate, index) {
  const current = asObj(candidate);
  const path = str(current.path || current.thumbPath, "");
  return {
    path,
    thumbPath: path,
    rank: num(current.rank, index + 1) || index + 1,
    ...normalizeCandidate(current),
  };
}

function getCompose1Store() {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    return asObj(asObj(sd.__liviaCompose1)[execId]);
  } catch {
    return {};
  }
}

function getCompose1Rows() {
  const store = getCompose1Store();
  const rows = [];
  const seen = new Set();

  function pushRow(row) {
    const current = asObj(row);
    if (!Object.keys(current).length) return;
    const key = JSON.stringify([
      str(current.id, ""),
      str(current.name, ""),
      str(current.groupKey, ""),
      str(current.webContentLink, ""),
    ]);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(current);
  }

  if (Array.isArray(store.__items)) {
    for (const item of store.__items) pushRow(item && item.json);
  }

  for (const value of Object.values(store)) {
    if (value && typeof value === "object" && !Array.isArray(value)) pushRow(value);
  }

  return rows;
}

function getHintPaths(payload) {
  const current = asObj(payload);
  const bestFrame = asObj(current.bestFrame);
  const candidateThumbs = Array.isArray(current.candidateThumbs) ? current.candidateThumbs : [];
  return [
    str(current.mainMediaFilePath, ""),
    str(current.thumbPath, ""),
    str(bestFrame.thumbPath, ""),
    ...candidateThumbs.map((candidate) => str(candidate.path || candidate.thumbPath, "")),
  ].filter(Boolean);
}

function extractTempIdSuffix(path) {
  const match = fileNameOnly(path).match(/_([A-Za-z0-9_-]{6,})_(?:temp|cand[_-]?\d+|thumb)(?:\.[^.]+)?$/i);
  return match ? match[1] : "";
}

function resolveCompose1Context(payload) {
  const rows = getCompose1Rows();
  if (!rows.length) return {};
  if (rows.length === 1) return rows[0];

  const hintPaths = getHintPaths(payload);
  const idSuffixes = hintPaths.map(extractTempIdSuffix).filter(Boolean);
  const groupKeys = hintPaths.map(deriveGroupKey).filter(Boolean);

  let bestRow = {};
  let bestScore = -1;

  for (const row of rows) {
    let score = 0;
    const rowIdSuffix = safeBase(row.id).slice(-8);
    const rowGroupKey = str(row.groupKey, "");
    const rowNameBase = safeBase(row.name);

    if (rowIdSuffix && idSuffixes.includes(rowIdSuffix)) score += 100;
    if (rowGroupKey && groupKeys.includes(rowGroupKey)) score += 20;

    if (rowNameBase) {
      for (const hintPath of hintPaths) {
        if (safeBase(hintPath).includes(rowNameBase)) {
          score += 10;
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }

  return bestScore > 0 ? bestRow : rows[0];
}

function normalizeBestFrame(payload, candidateThumbs) {
  const current = asObj(payload);
  const rawBest = asObj(current.bestFrame);
  const rawCandidates = Array.isArray(rawBest.candidates) && rawBest.candidates.length
    ? rawBest.candidates
    : Array.isArray(current.candidates) && current.candidates.length
      ? current.candidates
      : candidateThumbs;

  const candidates = rawCandidates.map(normalizeCandidate).filter((item) => item.timestampSeconds >= 0);
  const bestCandidate = candidates[0] || normalizeCandidate(rawBest);
  const bestTimestampSeconds =
    num(rawBest.bestTimestampSeconds, NaN) ||
    num(rawBest.bestFrameSeconds, NaN) ||
    bestCandidate.timestampSeconds ||
    0;

  return {
    applicable: !!current.analysisApplicable,
    bestTimestamp: str(rawBest.bestTimestamp, "") || bestCandidate.timestamp || toTimestamp(bestTimestampSeconds),
    bestTimestampSeconds,
    bestFrameSeconds: num(rawBest.bestFrameSeconds, bestTimestampSeconds),
    reason: str(rawBest.reason, "") || bestCandidate.reason || (current.analysisApplicable ? "frame-analysis" : "not-video"),
    confidence: clamp01(rawBest.confidence ?? bestCandidate.confidence ?? 0),
    candidates,
    thumbPath: str(rawBest.thumbPath || current.thumbPath, ""),
  };
}

function buildMainMediaItem(payload, compose1, bestFrame, warnings) {
  const current = asObj(payload);
  const row = asObj(compose1);
  const mainMediaPath = str(current.mainMediaFilePath, "");
  if (!mainMediaPath) {
    throw new Error("Prepare Media Upload Batch: mainMediaFilePath ausente no payload do Process Media Asset.");
  }

  const mimeType = str(current.mimeType, "") || str(row.mimeType, "");
  const name = str(row.name, "") || str(current.sourceFileName, "") || fileNameOnly(mainMediaPath);
  const groupKey = str(row.groupKey, "") || deriveGroupKey(mainMediaPath || name);

  return {
    json: {
      ...row,
      uploadRole: "main_media",
      mainMediaFilePath: mainMediaPath,
      mainMediaFileName: str(current.mainMediaFileName, "") || fileNameOnly(mainMediaPath),
      fileName: mainMediaPath,
      thumbPath: str(current.thumbPath, ""),
      id: str(row.id, ""),
      name,
      mimeType,
      groupKey,
      groupOrder: row.groupOrder,
      publishTime: str(row.publishTime, ""),
      bestFrame,
      warnings,
      processedMedia: {
        mediaKind: str(current.mediaKind, ""),
        optimized: !!current.optimized,
        analysisApplicable: !!current.analysisApplicable,
      },
    },
  };
}

function buildFrameCandidateItems(candidateThumbs, compose1, bestFrame, warnings) {
  const row = asObj(compose1);
  return candidateThumbs
    .map((candidate, index) => {
      const normalized = normalizeCandidateThumb(candidate, index);
      return {
        json: {
          ...row,
          uploadRole: "frame_candidate",
          thumbPath: normalized.path,
          candidate: {
            rank: normalized.rank,
            timestamp: normalized.timestamp,
            timestampSeconds: normalized.timestampSeconds,
            confidence: normalized.confidence,
            reason: normalized.reason,
          },
          bestFrame,
          warnings,
        },
      };
    })
    .filter((item) => item.json.thumbPath);
}

const raw =
  $json.processedMedia ||
  $json.mediaPayload ||
  $json.stdout ||
  $json.stderr ||
  $json.text ||
  $json.data ||
  $json.body ||
  $json;

let parsed = safeJsonParseMaybeString(raw);
if (!parsed) {
  const jsonl = parseJsonl(raw);
  if (jsonl) parsed = jsonl;
}

if (Array.isArray(parsed) && parsed.length) {
  const firstObject = parsed.find((item) => item && typeof item === "object");
  if (firstObject) parsed = firstObject;
}

if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  throw new Error("Prepare Media Upload Batch: payload inválido ou ausente na saída do Process Media Asset.");
}

const payload = asObj(parsed);
const candidateThumbs = Array.isArray(payload.candidateThumbs)
  ? payload.candidateThumbs.map(normalizeCandidateThumb).filter((candidate) => candidate.path)
  : [];

if (payload.analysisApplicable && !candidateThumbs.length) {
  throw new Error("Prepare Media Upload Batch: frame analysis aplicável, mas nenhum frame_candidate utilizável foi gerado.");
}

const compose1 = resolveCompose1Context(payload);
const warnings = Array.isArray(payload.warnings)
  ? payload.warnings.map((warning) => str(warning, "").trim()).filter(Boolean)
  : [];
const bestFrame = normalizeBestFrame(payload, candidateThumbs);

const output = [];
output.push(buildMainMediaItem(payload, compose1, bestFrame, warnings));
output.push(...buildFrameCandidateItems(candidateThumbs, compose1, bestFrame, warnings));

return output;
