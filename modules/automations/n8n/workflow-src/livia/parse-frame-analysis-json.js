// Parse Frame Analysis JSON (n8n Code node)
// Normaliza a saída do analisador e mantém a mídia principal no mesmo branch dos thumbs.
// Evita lookups nomeados entre nós para não travar a resolução de paired items no Task Runner.

function str(v, fb = "") {
  return (v === undefined || v === null) ? fb : String(v);
}

function asObj(v) {
  return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
}

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
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

  const parts = s.split(":").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return 0;

  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    return (Number.isNaN(mm) || Number.isNaN(ss)) ? 0 : (mm * 60 + ss);
  }

  if (parts.length === 3) {
    const hh = Number(parts[0]);
    const mm = Number(parts[1]);
    const ss = Number(parts[2]);
    return (Number.isNaN(hh) || Number.isNaN(mm) || Number.isNaN(ss)) ? 0 : (hh * 3600 + mm * 60 + ss);
  }

  return 0;
}

function toTimestamp(secs) {
  const s = Math.max(0, Number(secs) || 0);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const pad2 = (n) => String(n).padStart(2, "0");
  if (hh > 0) return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  return `${pad2(mm)}:${pad2(ss)}`;
}

function safeJsonParseMaybeString(raw) {
  if (raw && typeof raw === "object") return raw;

  const t = str(raw, "").trim();
  if (!t) return null;

  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return JSON.parse(t);
    } catch {}
  }

  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const maybe = t.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(maybe);
    } catch {}
  }

  return null;
}

function parseJsonl(text) {
  const lines = str(text, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && (line.startsWith("{") || line.startsWith("[")));

  const objs = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed) objs.push(parsed);
    } catch {}
  }
  return objs.length ? objs : null;
}

function normalizeCandidate(c) {
  const o = asObj(c);
  const seconds =
    Number(o.timestampSeconds ?? o.bestTimestampSeconds ?? o.timeSeconds ?? o.time ?? o.t ?? 0) ||
    toSeconds(o.timestamp ?? o.bestTimestamp ?? o.timecode ?? "");

  const ts =
    str(o.timestamp, "") ||
    str(o.bestTimestamp, "") ||
    str(o.timecode, "") ||
    toTimestamp(seconds);

  return {
    timestamp: ts,
    timestampSeconds: Number(seconds) || 0,
    reason: str(o.reason, "") || str(o.why, "") || str(o.notes, ""),
    confidence: clamp01(o.confidence ?? o.score ?? o.prob ?? 0),
  };
}

function buildFromCandidates(candidates) {
  const clean = candidates
    .map(normalizeCandidate)
    .filter((candidate) => candidate.timestampSeconds >= 0)
    .sort((left, right) => (right.confidence - left.confidence) || (left.timestampSeconds - right.timestampSeconds));

  const best = clean[0] || null;
  if (!best) {
    return {
      applicable: false,
      bestTimestamp: "",
      bestTimestampSeconds: 0,
      reason: "Não foi possível extrair candidatos válidos do analisador.",
      confidence: 0,
      candidates: [],
    };
  }

  return {
    applicable: true,
    bestTimestamp: best.timestamp || toTimestamp(best.timestampSeconds),
    bestTimestampSeconds: best.timestampSeconds,
    reason: best.reason || "Selecionado pelo maior score/confidence entre os candidatos.",
    confidence: clamp01(best.confidence),
    candidates: clean.slice(0, 5),
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
    for (const item of store.__items) {
      pushRow(item && item.json);
    }
  }

  for (const value of Object.values(store)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      pushRow(value);
    }
  };

  return rows;
}

function getCandidateThumbPaths(parsed) {
  const direct = str(parsed.thumbPath, "");
  const candidatePaths = Array.isArray(parsed.candidateThumbs)
    ? parsed.candidateThumbs.map((candidate) => str(candidate.path || candidate.thumbPath, "")).filter(Boolean)
    : [];
  return [direct, ...candidatePaths].filter(Boolean);
}

function extractTempIdSuffix(path) {
  const match = fileNameOnly(path).match(/_([A-Za-z0-9_-]{6,})_temp(?:_thumb|_cand[_-]?\d+)?\.[^.]+$/i);
  return match ? match[1] : "";
}

function resolveCompose1Context(parsed) {
  const rows = getCompose1Rows();
  if (!rows.length) return {};
  if (rows.length === 1) return rows[0];

  const hintPaths = getCandidateThumbPaths(parsed);
  const idSuffixes = hintPaths.map(extractTempIdSuffix).filter(Boolean);
  const groupKeys = hintPaths.map(deriveGroupKey).filter(Boolean);

  let bestRow = {};
  let bestScore = -1;

  for (const row of rows) {
    let score = 0;
    const rowIdSuffix = safeBase(row.id).slice(-8);
    const rowGroupKey = str(row.groupKey, "");

    if (rowIdSuffix && idSuffixes.includes(rowIdSuffix)) score += 100;
    if (rowGroupKey && groupKeys.includes(rowGroupKey)) score += 20;

    const rowNameBase = safeBase(row.name);
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

function extFromMimeType(mimeType, fallback = "") {
  const mime = str(mimeType, "").toLowerCase();
  if (!mime) return fallback;
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("mp4")) return "mp4";
  if (mime.startsWith("video/")) return "mp4";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.startsWith("image/")) return "jpg";
  return fallback;
}

function inferMainMediaPath(parsedLike, compose1) {
  const hintPath = getCandidateThumbPaths(parsedLike)[0];
  if (!hintPath) return "";

  const ext = extFromName(compose1.name) || extFromMimeType(compose1.mimeType, "");
  if (!ext) return "";

  const base = hintPath
    .replace(/_thumb\.[^.]+$/i, "")
    .replace(/_cand[_-]?\d+\.[^.]+$/i, "")
    .replace(/\.[^.]+$/i, "");

  return `${base}.${ext}`;
}

function buildMainMediaItem(bestFrame, compose1, candidateThumbs) {
  const row = asObj(compose1);
  const mainMediaPath = inferMainMediaPath({
    thumbPath: str(bestFrame.thumbPath, ""),
    candidateThumbs,
  }, row);
  if (!mainMediaPath && !Object.keys(row).length) return null;

  const name = str(row.name || fileNameOnly(mainMediaPath), "");
  const mimeType = str(row.mimeType, "");
  const groupKey = str(row.groupKey || deriveGroupKey(mainMediaPath || name), "");

  return {
    json: {
      ...row,
      uploadRole: "main_media",
      thumbPath: mainMediaPath,
      mainMediaFilePath: mainMediaPath,
      mainMediaFileName: fileNameOnly(mainMediaPath) || name,
      fileName: fileNameOnly(mainMediaPath) || name,
      id: str(row.id, ""),
      name: name || fileNameOnly(mainMediaPath),
      mimeType,
      groupKey,
      groupOrder: row.groupOrder,
      publishTime: str(row.publishTime, ""),
      bestFrame,
    },
  };
}

function buildThumbItemsFromCandidates(bestFrame, candidateThumbs, compose1) {
  if (!Array.isArray(candidateThumbs) || !candidateThumbs.length) return [];
  const row = asObj(compose1);

  return candidateThumbs
    .map((candidate, index) => ({
      json: {
        ...row,
        uploadRole: "frame_candidate",
        thumbPath: candidate.path || candidate.thumbPath || "",
        candidate: {
          rank: index + 1,
          timestamp: candidate.timestamp || "",
          timestampSeconds: Number(candidate.timestampSeconds || 0),
          confidence: Number(candidate.confidence || 0),
          reason: candidate.reason || "",
        },
        bestFrame,
      },
    }))
    .filter((item) => item.json.thumbPath);
}

function buildMainPlusThumbOutputs(bestFrame, candidateThumbs) {
  const compose1 = resolveCompose1Context({
    thumbPath: str(bestFrame.thumbPath, ""),
    candidateThumbs,
  });
  const output = [];
  const mainItem = buildMainMediaItem(bestFrame, compose1, candidateThumbs);
  if (mainItem) output.push(mainItem);
  output.push(...buildThumbItemsFromCandidates(bestFrame, candidateThumbs, compose1));
  return output;
}

const raw =
  $json.frameAnalysis ||
  $json.analysis ||
  $json.stdout ||
  $json.stderr ||
  $json.text ||
  $json.data ||
  $json.body ||
  "";

let parsed = safeJsonParseMaybeString(raw);

if (!parsed) {
  const jsonl = parseJsonl(raw);
  if (jsonl) parsed = jsonl;
}

if (Array.isArray(parsed) && parsed.length) {
  const rich = parsed.find((item) => item && typeof item === "object" && Array.isArray(item.candidateThumbs) && item.candidateThumbs.length);
  if (rich) {
    parsed = rich;
  } else {
    const firstObject = parsed.find((item) => item && typeof item === "object");
    if (firstObject) parsed = firstObject;
  }
}

if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.bestFrame) {
  const bf = parsed.bestFrame;
  const candidates = Array.isArray(bf.candidates) ? bf.candidates : [];
  const out = buildFromCandidates(candidates.length ? candidates : [bf]);
  const bestSeconds = Number(bf.bestTimestampSeconds ?? toSeconds(bf.bestTimestamp ?? "")) || out.bestTimestampSeconds;
  const bestFrame = {
    applicable: !!(bf.applicable ?? true),
    bestTimestamp: str(bf.bestTimestamp, "") || toTimestamp(bestSeconds),
    bestTimestampSeconds: bestSeconds,
    reason: str(bf.reason, "") || out.reason,
    confidence: clamp01(bf.confidence ?? out.confidence),
    candidates: out.candidates,
    thumbPath: str(parsed.thumbPath || bf.thumbPath, ""),
  };

  const outputs = buildMainPlusThumbOutputs(bestFrame, parsed.candidateThumbs || []);
  if (outputs.length) return outputs;
  return [{ json: { bestFrame } }];
}

if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
  const candidates = parsed.candidates || parsed.frames || parsed.items || [];
  if (Array.isArray(candidates) && candidates.length) {
    const bestFrame = buildFromCandidates(candidates);
    bestFrame.thumbPath = str(parsed.thumbPath, "");
    const outputs = buildMainPlusThumbOutputs(bestFrame, parsed.candidateThumbs || []);
    if (outputs.length) return outputs;
    return [{ json: { bestFrame } }];
  }

  const maybeBest = parsed.best || parsed.bestFrame || parsed.selected || parsed;
  if (maybeBest && typeof maybeBest === "object") {
    const bestFrame = buildFromCandidates([maybeBest]);
    bestFrame.thumbPath = str(parsed.thumbPath || maybeBest.thumbPath, "");
    const outputs = buildMainPlusThumbOutputs(bestFrame, parsed.candidateThumbs || []);
    if (outputs.length) return outputs;
    return [{ json: { bestFrame } }];
  }
}

if (Array.isArray(parsed) && parsed.length) {
  const bestFrame = buildFromCandidates(parsed);
  bestFrame.thumbPath = "";
  const outputs = buildMainPlusThumbOutputs(bestFrame, []);
  if (outputs.length) return outputs;
  return [{ json: { bestFrame } }];
}

const fallbackBestFrame = {
  applicable: false,
  bestTimestamp: "",
  bestTimestampSeconds: 0,
  reason: "Nenhum JSON/JSONL válido encontrado na saída do analisador de frames.",
  confidence: 0,
  candidates: [],
  thumbPath: "",
};

const fallbackOutputs = buildMainPlusThumbOutputs(fallbackBestFrame, []);
if (fallbackOutputs.length) return fallbackOutputs;

return [{
  json: {
    bestFrame: fallbackBestFrame,
  },
}];
