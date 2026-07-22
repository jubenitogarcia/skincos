// ======================================================
// COMPOSE (2) FINAL - Job Builder (Loop + Prepare Request)
// - Suporta múltiplos grupos por dia (groupKey/groupOrder do Compose 1)
// - Gera jobs determinísticos: upload(s) -> (uploadContainer) -> checkStatus -> publish
// - Threads: por padrão usa /me (evita problema de thId app-scoped)
// - Carrossel: caption/text fica só no container (IG/Threads) [seguro]
// - Livia: suporta 2 schemas (array por item e objeto global)
// - Carrossel: extrai caption/title/alt_text por imagem quando existir items[]
// - Scheduling seguro (>=10min) para Facebook feed (e metadata para IG)
// - Metadados para Prepare Request resolver dependências via publishRunIndex
// - Facebook Reels (vídeo): usa fluxo correto
//    1) /video_reels?upload_phase=start
//    2) POST rupload (hosted) com header file_url
//    3) /video_reels (finish) com video_id
//    4) checkStatus (poll-friendly) do video_id
//
// APRENDIZADO (Meta change):
// - Instagram passou a rejeitar media_type=IMAGE no /media.
// - Para FOTO no Instagram: NÃO enviar media_type (somente image_url + caption quando single).
// - Safety-net: remove IMAGE/PHOTO se chegar indevidamente no body.
//
// NOVO (thumbnail IG Reels):
// - Para vídeo single (REELS), envia thumb_offset (em ms) a partir do bestFrameSeconds.
//
// CORREÇÕES:
/// - Livia às vezes retorna `output` como string JSON.
/// - Este script faz parse seguro antes de normalizar.
/// - Corrige captions estruturadas (hook/blocks/cta/hashtags/closing) para texto final.
/// - Evita duplicar legenda nos uploads de fotos do Facebook; a copy fica no publish final.
/// - Valida no final que todo checkStatus tenha publish correspondente.
// - HARDENING: valida integridade por plataforma e impede saída truncada sem publish.
// ======================================================


// --------------------------
// HELPERS BÁSICOS
// --------------------------
function str(v, fb = "") { return (v === undefined || v === null) ? fb : String(v); }

function toBool(v, defaultValue = false) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined) return defaultValue;
  if (typeof v === "number") return Number.isNaN(v) ? defaultValue : v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["true","1","yes","y","sim"].includes(s)) return true;
  if (["false","0","no","n","não","nao"].includes(s)) return false;
  return defaultValue;
}

function removeNulls(value) {
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) {
      const cleaned = removeNulls(v);
      if (cleaned !== undefined) out.push(cleaned);
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = removeNulls(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  if (value === null) return undefined;
  return value;
}

function pushUnique(arr, msg) {
  if (!msg) return;
  if (!arr.includes(msg)) arr.push(msg);
}

function normId(v) {
  const s = str(v, "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (["null","undefined","nan","0"].includes(low)) return "";
  return s;
}

function normToken(v) {
  const s = str(v, "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (["null","undefined","nan"].includes(low)) return "";
  return s;
}

function detectMediaKind(mimeType) {
  const m = str(mimeType, "").toLowerCase();
  return {
    isVideo: m.startsWith("video"),
    isImage: m.startsWith("image"),
  };
}

function ensureHttps(u) {
  const s = str(u, "").trim();
  if (!s) return "";
  if (s.startsWith("http://")) return "https://" + s.slice("http://".length);
  return s;
}

function detectMediaKindSmart(mimeType, url) {
  const base = detectMediaKind(mimeType);
  if (base.isVideo || base.isImage) return base;

  const u = str(url, "").toLowerCase();
  if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/.test(u)) return { isVideo: true, isImage: false };
  if (/\.(jpg|jpeg|png|webp)(\?|#|$)/.test(u)) return { isVideo: false, isImage: true };
  return base;
}

function extractDriveIdFromUrl(u) {
  const s = str(u, "").trim();
  if (!s) return "";
  const m1 = s.match(/[?&]id=([^&]+)/i);
  if (m1 && m1[1]) return m1[1];
  const m2 = s.match(/\/d\/([^\/]+)\//i);
  if (m2 && m2[1]) return m2[1];
  return "";
}

function asObjSafe(v) { return (v && typeof v === "object") ? v : null; }

function flattenUploadItems(uploadItems) {
  const arr = (Array.isArray(uploadItems) ? uploadItems : [])
    .map(it => (it && it.json) ? it.json : {})
    .filter(x => x && typeof x === "object");

  const out = [];
  for (const u of arr) {
    if (Array.isArray(u.items)) {
      for (const x of u.items) out.push(asObjSafe(x) || {});
    } else {
      out.push(u);
    }
  }
  return out;
}

function fileBaseName(v) {
  const s = str(v, "").trim();
  if (!s) return "";
  return s.replace(/\.[^.]+$/, "").trim();
}

function buildUploadMaps(uploadArr) {
  const byId = new Map();
  const byName = new Map();
  const byDriveId = new Map();
  const byOriginalName = new Map();

  for (const u of uploadArr) {
    const id = str(u.id || u.public_id, "").trim();
    const name = str(u.name, "").trim();
    const originalName = str(u.original_filename, "").trim();
    const displayName = str(u.display_name, "").trim();
    const url = str(u.secure_url || u.url || u.webContentLink, "").trim();
    const driveId = extractDriveIdFromUrl(url);

    if (id) byId.set(id, u);

    const nameCandidates = [name, displayName, fileBaseName(name), fileBaseName(displayName)].filter(Boolean);
    for (const k of nameCandidates) byName.set(k, u);

    const originalCandidates = [originalName, fileBaseName(originalName)].filter(Boolean);
    for (const k of originalCandidates) byOriginalName.set(k, u);

    if (driveId) byDriveId.set(driveId, u);
  }

  return { byId, byName, byDriveId, byOriginalName };
}

function looksLikeImageUrl(u) {
  const s = str(u, "").toLowerCase();
  return /\.(jpg|jpeg|png|webp|gif)(\?|#|$)/.test(s) || s.includes("/image/upload/");
}

function resolveFinalUrlForMedia(media, uploadMaps, warnings) {
  const mid = str(media.id, "").trim();
  const mname = str(media.name, "").trim();
  const mw = str(media.webContentLink, "").trim();
  const mDriveId = extractDriveIdFromUrl(mw);
  const mbase = fileBaseName(mname);
  const mediaKind = detectMediaKindSmart(media.mimeType, mw);

  const hit =
    (mid && uploadMaps.byId.get(mid)) ||
    (mDriveId && uploadMaps.byDriveId.get(mDriveId)) ||
    (mname && uploadMaps.byName.get(mname)) ||
    (mbase && uploadMaps.byName.get(mbase)) ||
    (mname && uploadMaps.byOriginalName.get(mname)) ||
    (mbase && uploadMaps.byOriginalName.get(mbase)) ||
    null;

  const hitUrl = ensureHttps(str(hit?.secure_url || hit?.url || "", ""));
  const mediaDirectUrl = ensureHttps(str(media.secure_url || media.url || "", ""));
  const mediaDriveUrl = ensureHttps(str(media.webContentLink || "", ""));

  const hitResourceType = str(hit?.resource_type || "", "").toLowerCase();
  const hitLooksImage = hitResourceType === "image" || looksLikeImageUrl(hitUrl);

  let url = "";

  if (mediaKind.isVideo) {
    if (hitUrl && !hitLooksImage) url = hitUrl;
    if (!url && mediaDirectUrl && !looksLikeImageUrl(mediaDirectUrl)) url = mediaDirectUrl;
    if (!url && mediaDriveUrl && !looksLikeImageUrl(mediaDriveUrl)) url = mediaDriveUrl;

    if (!url && hitUrl && hitLooksImage) {
      pushUnique(warnings, "Upload File retornou imagem para mídia de vídeo; ignorando URL de thumbnail.");
    }

    if (!url && mediaDirectUrl) url = mediaDirectUrl;
    if (!url && hitUrl) url = hitUrl;
    if (!url) url = mediaDriveUrl;
  } else {
    url = hitUrl || mediaDirectUrl || mediaDriveUrl;
  }

  if (!url) pushUnique(warnings, "media.url ausente (Upload File / Compose 1)");
  return url;
}


// Compose (1) pode vir no schema novo (1 item por grupo com items[]).
function normalizeCompose1ToLegacyItems(compose1Items) {
  const raw = (Array.isArray(compose1Items) ? compose1Items : [])
    .map(it => (it && it.json) ? it.json : {})
    .filter(x => x && typeof x === "object");

  const hasGrouped = raw.some(g => Array.isArray(g.items));
  if (!hasGrouped) return compose1Items;

  const out = [];
  for (let gi = 0; gi < raw.length; gi++) {
    const g = raw[gi] || {};
    const items = Array.isArray(g.items) ? g.items : [];

    for (const m of items) {
      const mm = asObjSafe(m) || {};
      out.push({
        json: {
          groupKey: str(g.groupKey, `g:${gi}`),
          groupOrder: Number(g.groupOrder ?? gi),
          publishTime: str(g.publishTime, ""),
          quantity: Number(g.quantity ?? items.length ?? 1),

          instagram: asObjSafe(g.instagram) || {},
          facebook:  asObjSafe(g.facebook)  || {},
          threads:   asObjSafe(g.threads)   || {},

          ...mm,
        }
      });
    }
  }
  return out;
}

function publishTimeToUnix(publishTime) {
  const iso = str(publishTime, "").trim();
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

function computeSchedule(publishTimeIso) {
  const unix = publishTimeToUnix(publishTimeIso);
  if (!unix) return { shouldSchedule: false, unix: null, reason: "no-publishTime" };

  const nowUnix = Math.floor(Date.now() / 1000);
  const delta = unix - nowUnix;

  if (delta < 600) return { shouldSchedule: false, unix, reason: "publishTime-too-soon-or-past" };

  return { shouldSchedule: true, unix, reason: "ok" };
}

function resolveSelectedFrameUrl(item, media) {
  const fromLivia = str(deepGet(item, "selectedFrameUrl", "")) || str(deepGet(item, "bestFrame.selectedFrameUrl", ""));
  const fromMedia = str(deepGet(media, "videoThumbnail.url", "")) || str(deepGet(media, "thumbnail_url", ""));
  return fromLivia || fromMedia || "";
}

function normalizeThumbOffsetMs(bestFrameSeconds, fallbackSeconds = 1.0) {
  const n = Number(bestFrameSeconds);
  const sec = (Number.isFinite(n) && n > 0) ? n : fallbackSeconds;
  return Math.max(0, Math.round(sec * 1000));
}


// --------------------------
// EXTRAÇÃO LIVIA
// --------------------------
function deepGet(obj, path, fb = "") {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return fb;
    cur = cur[p];
  }
  return (cur === undefined || cur === null) ? fb : cur;
}

function asObj(v) { return (v && typeof v === "object") ? v : null; }

function parseMaybeJson(v) {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return v;

  const looksJson =
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"));

  if (!looksJson) return v;

  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

function normalizeText(v) {
  const s = str(v, "");
  return s
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\r\n/g, "\n");
}

function textish(v, fb = "") {
  if (v === undefined || v === null) return fb;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fb;
}

function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(v => normalizeText(textish(v, "")).trim())
    .filter(Boolean);
}

function joinCaptionParts(parts) {
  return parts
    .map(v => normalizeText(textish(v, "")).trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function renderStructuredCaption(channelObj, channelName) {
  const c = asObj(parseMaybeJson(channelObj)) || {};
  if (!c || typeof c !== "object") return "";

  const hook = normalizeText(textish(c.hook, "")).trim();
  const blocks = normalizeStringArray(c.blocks);

  if (channelName === "instagram") {
    const cta = normalizeText(textish(c.cta, "")).trim();
    const hashtags = normalizeStringArray(c.hashtags).join(" ").trim();
    return joinCaptionParts([hook, ...blocks, cta, hashtags]);
  }

  if (channelName === "facebook") {
    const cta = normalizeText(textish(c.cta, "")).trim();
    return joinCaptionParts([hook, ...blocks, cta]);
  }

  if (channelName === "threads") {
    const closing = normalizeText(textish(c.closing, "")).trim();
    return joinCaptionParts([hook, ...blocks, closing]);
  }

  return "";
}

function normalizeCaptionTriplet(src) {
  const o = asObj(parseMaybeJson(src)) || {};

  const instagramRaw =
    textish(deepGet(o, "instagram.fullText", "")) ||
    textish(deepGet(o, "instagram.caption", "")) ||
    textish(deepGet(o, "instagram.text", "")) ||
    renderStructuredCaption(deepGet(o, "instagram", null), "instagram") ||
    textish(deepGet(o, "igCaption", ""));

  const facebookRaw =
    textish(deepGet(o, "facebook.fullText", "")) ||
    textish(deepGet(o, "facebook.caption", "")) ||
    textish(deepGet(o, "facebook.text", "")) ||
    renderStructuredCaption(deepGet(o, "facebook", null), "facebook") ||
    textish(deepGet(o, "fbCaption", ""));

  const threadsRaw =
    textish(deepGet(o, "threads.fullText", "")) ||
    textish(deepGet(o, "threads.caption", "")) ||
    textish(deepGet(o, "threads.text", "")) ||
    renderStructuredCaption(deepGet(o, "threads", null), "threads") ||
    textish(deepGet(o, "thCaption", ""));

  return {
    instagram: normalizeText(instagramRaw).trim(),
    facebook: normalizeText(facebookRaw).trim(),
    threads: normalizeText(threadsRaw).trim(),
  };
}

function normalizeLiviaPayload(liviaJson) {
  const parsedInput = parseMaybeJson(liviaJson);
  const lj = asObj(parsedInput) || {};
  const rawPayload = ("output" in lj) ? lj.output : lj;
  const payload = parseMaybeJson(rawPayload);

  if (Array.isArray(payload)) {
    const items = payload.map((it) => {
      const item = asObj(parseMaybeJson(it)) || {};
      const captions = normalizeCaptionTriplet(item.captions || item.caption || {});
      const title = str(item.title, "");
      const alt_text = str(item.alt_text, "");
      const bestFrameSeconds =
        Number(deepGet(item, "bestFrame.bestTimestampSeconds", 0)) ||
        Number(deepGet(item, "bestFrameSeconds", 0)) || 0;
      const selectedFrameUrl =
        str(deepGet(item, "bestFrame.selectedFrameUrl", "")) ||
        str(deepGet(item, "selectedFrameUrl", ""));
      const frameCandidates = Array.isArray(item.frameCandidates) ? item.frameCandidates : [];
      const bestFrameConfidence = Number(deepGet(item, "bestFrame.confidence", 0)) || 0;
      const selectedFrameRank = Number(deepGet(item, "bestFrame.selectedFrameRank", 0)) || 0;
      const selectedFrameSource = str(deepGet(item, "bestFrame.selectedFrameSource", ""));
      return {
        captions,
        title,
        alt_text,
        bestFrameSeconds,
        selectedFrameUrl,
        frameCandidates,
        bestFrameConfidence,
        selectedFrameRank,
        selectedFrameSource
      };
    });

    const first = items[0] || {
      captions: { instagram:"", facebook:"", threads:"" },
      title:"",
      alt_text:"",
      bestFrameSeconds:0
    };

    return {
      global: {
        captions: first.captions || { instagram:"", facebook:"", threads:"" },
        title: first.title || "",
        alt_text: first.alt_text || "",
        bestFrameSeconds: first.bestFrameSeconds || 0,
      },
      items,
    };
  }

  if (asObj(payload)) {
    const p = payload;

    const sm =
      p.socialMediaContent ||
      p.social_media_posts ||
      p.socialMediaPosts ||
      {};

    const fromSM = normalizeCaptionTriplet(sm);
    const fromCaptionBlock = normalizeCaptionTriplet(p.caption || p.captions || {});
    const fromFlat = normalizeCaptionTriplet({
      igCaption: str(p.instagramCaption, "") || str(p.igCaption, ""),
      fbCaption: str(p.facebookCaption, "") || str(p.fbCaption, ""),
      thCaption: str(p.threadsCaption, "")  || str(p.thCaption, ""),
    });

    const globalCaptions = {
      instagram: fromCaptionBlock.instagram || fromFlat.instagram || fromSM.instagram,
      facebook:  fromCaptionBlock.facebook  || fromFlat.facebook  || fromSM.facebook,
      threads:   fromCaptionBlock.threads   || fromFlat.threads   || fromSM.threads,
    };

    const acc = asObj(parseMaybeJson(p.accessibility)) || {};
    const ma = asObj(parseMaybeJson(p.mediaAnalysis)) || {};

    const globalTitle = str(acc.title, "") || str(p.title, "");

    const globalAlt =
      str(acc.altText, "") ||
      str(acc.alt_text, "") ||
      str(p.alt_text, "") ||
      str(p.altText, "");

    const globalBestFrameSeconds =
      Number(deepGet(ma, "videoThumbnail.bestTimestampSeconds", 0)) ||
      Number(deepGet(p, "videoAnalysis.bestTimestampSeconds", 0)) ||
      Number(deepGet(p, "videoDetails.bestTimestampSeconds", 0)) ||
      Number(deepGet(p, "bestFrame.bestTimestampSeconds", 0)) || 0;

    const maybeItems = parseMaybeJson(p.items);
    const itemsArr = Array.isArray(maybeItems) ? maybeItems : [];

    const items = itemsArr.map((it) => {
      const item = asObj(parseMaybeJson(it)) || {};
      const captions = normalizeCaptionTriplet(item.captions || item.caption || {});
      const title = str(item.title, "");
      const alt_text = str(item.alt_text, "");
      const bestFrameSeconds = Number(deepGet(item, "bestFrame.bestTimestampSeconds", 0)) || 0;
      const selectedFrameUrl = str(deepGet(item, "bestFrame.selectedFrameUrl", "")) || str(deepGet(item, "selectedFrameUrl", ""));
      const frameCandidates = Array.isArray(item.frameCandidates) ? item.frameCandidates : [];
      const bestFrameConfidence = Number(deepGet(item, "bestFrame.confidence", 0)) || 0;
      const selectedFrameRank = Number(deepGet(item, "bestFrame.selectedFrameRank", 0)) || 0;
      const selectedFrameSource = str(deepGet(item, "bestFrame.selectedFrameSource", ""));
      return {
        captions,
        title,
        alt_text,
        bestFrameSeconds,
        selectedFrameUrl,
        frameCandidates,
        bestFrameConfidence,
        selectedFrameRank,
        selectedFrameSource
      };
    });

    return {
      global: {
        captions: globalCaptions,
        title: globalTitle,
        alt_text: globalAlt,
        bestFrameSeconds: globalBestFrameSeconds,
      },
      items,
    };
  }

  return {
    global: { captions: { instagram:"", facebook:"", threads:"" }, title:"", alt_text:"", bestFrameSeconds:0 },
    items: [],
  };
}

function normalizeLiviaAll(liviaItems, totalCount) {
  const arr = Array.isArray(liviaItems) ? liviaItems : [];
  if (!arr.length) return normalizeLiviaPayload({});

  if (arr.length === 1) {
    return normalizeLiviaPayload(parseMaybeJson((arr[0] && arr[0].json) || {}));
  }

  if (typeof totalCount === "number" && totalCount > 0 && arr.length === totalCount) {
    const items = [];
    let global = null;

    for (let i = 0; i < arr.length; i++) {
      const norm = normalizeLiviaPayload(parseMaybeJson((arr[i] && arr[i].json) || {}));
      if (!global) global = norm.global;

      const it = (norm.items && norm.items[0]) ? norm.items[0] : {
        captions: (norm.global && norm.global.captions) ? norm.global.captions : { instagram:"", facebook:"", threads:"" },
        title: (norm.global && norm.global.title) ? norm.global.title : "",
        alt_text: (norm.global && norm.global.alt_text) ? norm.global.alt_text : "",
        bestFrameSeconds: (norm.global && norm.global.bestFrameSeconds) ? norm.global.bestFrameSeconds : 0,
      };

      items.push(it);
    }

    return {
      global: global || { captions: { instagram:"", facebook:"", threads:"" }, title:"", alt_text:"", bestFrameSeconds:0 },
      items,
    };
  }

  const flattened = [];
  let globalFirst = null;

  for (const it of arr) {
    const norm = normalizeLiviaPayload(parseMaybeJson((it && it.json) || {}));
    if (!globalFirst) globalFirst = norm.global;

    if (norm.items && norm.items.length) {
      for (const x of norm.items) flattened.push(x);
    } else {
      flattened.push({
        captions: norm.global.captions || { instagram:"", facebook:"", threads:"" },
        title: norm.global.title || "",
        alt_text: norm.global.alt_text || "",
        bestFrameSeconds: norm.global.bestFrameSeconds || 0,
      });
    }
  }

  return {
    global: globalFirst || { captions: { instagram:"", facebook:"", threads:"" }, title:"", alt_text:"", bestFrameSeconds:0 },
    items: flattened,
  };
}

function resolveLiviaIndex(liviaNorm, globalIdx, localIdx, groupSize, totalSize) {
  const len = (liviaNorm && Array.isArray(liviaNorm.items)) ? liviaNorm.items.length : 0;

  if (!len) return 0;
  if (groupSize && len === groupSize) return localIdx;
  if (totalSize && len === totalSize) return globalIdx;
  if (localIdx >= 0 && localIdx < len) return localIdx;
  if (globalIdx >= 0 && globalIdx < len) return globalIdx;

  return 0;
}

function getCaptionsGlobal(liviaNorm, warnings) {
  const g = (liviaNorm && liviaNorm.global) ? liviaNorm.global : {};
  const items = (liviaNorm && Array.isArray(liviaNorm.items)) ? liviaNorm.items : [];

  let ig = str(deepGet(g, "captions.instagram", ""), "");
  let fb = str(deepGet(g, "captions.facebook", ""), "");
  let th = str(deepGet(g, "captions.threads", ""), "");

  if ((!ig || !fb || !th) && items.length) {
    if (!ig) ig = str(deepGet(items[0], "captions.instagram", ""), "");
    if (!fb) fb = str(deepGet(items[0], "captions.facebook", ""), "");
    if (!th) th = str(deepGet(items[0], "captions.threads", ""), "");
  }

  if (!ig) pushUnique(warnings, "caption.instagram vazio (Livia)");
  if (!fb) pushUnique(warnings, "caption.facebook vazio (Livia)");
  if (!th) pushUnique(warnings, "caption.threads vazio (Livia)");

  return { igCaption: ig, fbCaption: fb, thCaption: th };
}

function getCaptionsForIndex(liviaNorm, idx) {
  const items = (liviaNorm && Array.isArray(liviaNorm.items)) ? liviaNorm.items : [];
  const g = (liviaNorm && liviaNorm.global) ? liviaNorm.global : {};

  const item = items[idx] || null;

  const ig = str(deepGet(item, "captions.instagram", ""), "") || str(deepGet(g, "captions.instagram", ""), "");
  const fb = str(deepGet(item, "captions.facebook", ""), "") || str(deepGet(g, "captions.facebook", ""), "");
  const th = str(deepGet(item, "captions.threads", ""), "") || str(deepGet(g, "captions.threads", ""), "");

  return { igCaption: ig, fbCaption: fb, thCaption: th };
}

function extractFromLivia(liviaNorm, idx, warnings) {
  const items = (liviaNorm && Array.isArray(liviaNorm.items)) ? liviaNorm.items : [];
  const g = (liviaNorm && liviaNorm.global) ? liviaNorm.global : {};

  const item = items[idx] || null;

  const title = str(deepGet(item, "title", ""), "") || str(deepGet(g, "title", ""), "");
  const alt_text = str(deepGet(item, "alt_text", ""), "") || str(deepGet(g, "alt_text", ""), "");
  const bestFrameSeconds =
    Number(deepGet(item, "bestFrameSeconds", undefined)) ||
    Number(deepGet(g, "bestFrameSeconds", 0)) || 0;
  const selectedFrameUrl =
    str(deepGet(item, "selectedFrameUrl", ""), "") ||
    str(deepGet(item, "bestFrame.selectedFrameUrl", ""), "");
  const selectedFrameRank =
    Number(deepGet(item, "selectedFrameRank", undefined)) ||
    Number(deepGet(item, "bestFrame.selectedFrameRank", 0)) || 0;
  const selectedFrameSource =
    str(deepGet(item, "selectedFrameSource", ""), "") ||
    str(deepGet(item, "bestFrame.selectedFrameSource", ""), "");
  const bestFrameConfidence =
    Number(deepGet(item, "bestFrameConfidence", undefined)) ||
    Number(deepGet(item, "bestFrame.confidence", 0)) || 0;
  const frameCandidates = Array.isArray(deepGet(item, "frameCandidates", []))
    ? deepGet(item, "frameCandidates", [])
    : [];

  if (!title) pushUnique(warnings, "text.title vazio (Livia não retornou)");
  if (!alt_text) pushUnique(warnings, "text.alt_text vazio (Livia não retornou)");

  return {
    title,
    alt_text,
    bestFrameSeconds,
    selectedFrameUrl,
    selectedFrameRank,
    selectedFrameSource,
    bestFrameConfidence,
    frameCandidates,
  };
}


// --------------------------
// BUILDERS DE REQUESTS
// --------------------------
const ALLOW_IG_ALT_TEXT_ON_CAROUSEL_ITEMS = false;
const ALLOW_THREADS_ALT_TEXT_ON_CAROUSEL_ITEMS = false;

function buildUploadBodyInstagram({ isVideo, isCarouselItem, url, media_type, caption, alt_text, bestFrameSeconds, selectedFrameUrl }) {
  const body = {};
  body[isVideo ? "video_url" : "image_url"] = url;

  const mt = str(media_type, "").toUpperCase().trim();
  if (isVideo && mt) body.media_type = mt;
  if (isCarouselItem) body.is_carousel_item = true;
  if (!isCarouselItem && caption) body.caption = caption;
  if (!isCarouselItem && selectedFrameUrl) body.thumbnail_url = selectedFrameUrl;

  const canSetAlt = (!isVideo && mt !== "REELS" && alt_text);
  if (canSetAlt && (!isCarouselItem || ALLOW_IG_ALT_TEXT_ON_CAROUSEL_ITEMS)) {
    body.alt_text = alt_text;
  }

  if (body.media_type && ["IMAGE", "PHOTO"].includes(String(body.media_type).toUpperCase())) {
    delete body.media_type;
  }

  if (isVideo && !isCarouselItem) {
    const offMs = normalizeThumbOffsetMs(bestFrameSeconds, 1.0);
    if (offMs > 0) body.thumb_offset = offMs;
  }

  return removeNulls(body);
}

function buildUploadBodyThreads({ isVideo, isCarouselItem, url, media_type, text, title, alt_text, selectedFrameUrl }) {
  const body = {};
  body[isVideo ? "video_url" : "image_url"] = url;
  if (media_type) body.media_type = media_type;
  if (isCarouselItem) body.is_carousel_item = true;

  if (!isCarouselItem) {
    if (text) body.text = text;
    if (title) body.title = title;
    if (alt_text) body.alt_text = alt_text;
    if (selectedFrameUrl) body.thumbnail_url = selectedFrameUrl;
  } else {
    if (ALLOW_THREADS_ALT_TEXT_ON_CAROUSEL_ITEMS && alt_text) body.alt_text = alt_text;
  }

  return removeNulls(body);
}

function buildUploadBodyFacebookVideos({ url, caption, selectedFrameUrl }) {
  const body = { file_url: url, description: caption || "" };
  if (selectedFrameUrl) body.thumbnail_url = selectedFrameUrl;
  return body;
}

function buildUploadBodyFacebookPhotos({ url, caption }) {
  const body = {
    url,
    published: false,
  };
  if (caption) body.caption = caption;
  return removeNulls(body);
}

function buildUploadContainerBodyInstagram({ caption }) {
  return removeNulls({
    media_type: "CAROUSEL",
    caption: caption || "",
  });
}

function buildUploadContainerBodyThreads({ text, title }) {
  return removeNulls({
    media_type: "CAROUSEL",
    text: text || "",
    title: title || "",
  });
}

function buildPublishBaseFacebookFeed({ message, isCarousel, scheduleUnix }) {
  const body = {
    message: message || "",
    attached_media: [],
  };

  if (scheduleUnix) {
    body.published = false;
    body.scheduled_publish_time = scheduleUnix;
  } else {
    body.published = true;
  }

  if (isCarousel) body.multi_share_optimized = true;
  return removeNulls(body);
}


// --------------------------
// VALIDAÇÃO FINAL
// --------------------------


function assertPlatformPhaseIntegrity(results) {
  const rows = results
    .map(r => (r && r.json) ? r.json : null)
    .filter(Boolean);

  const buckets = new Map();
  for (const j of rows) {
    const key = [j.groupKey, j.unit, j.platform].join("||");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(j);
  }

  for (const [key, list] of buckets.entries()) {
    const [groupKey, unit, platform] = key.split("||");
    const phases = list.map(j => j.phase);

    const uploads = list.filter(j => j.phase === "upload");
    const checks = list.filter(j => j.phase === "checkStatus");
    const publishes = list.filter(j => j.phase === "publish");

    if (!uploads.length) {
      throw new Error(`Compose (2): nenhum upload gerado para platform=${platform}, groupKey=${groupKey}, unit=${unit}`);
    }

    if (!checks.length) {
      throw new Error(`Compose (2): checkStatus ausente para platform=${platform}, groupKey=${groupKey}, unit=${unit}`);
    }

    if (!publishes.length) {
      throw new Error(`Compose (2): publish ausente para platform=${platform}, groupKey=${groupKey}, unit=${unit}; fases geradas=${phases.join(",")}`);
    }

    const isFacebookReels = platform === "facebook" && publishes.some(j => j.facebookPublishMode === "reels");
    const prePublishChecks = checks.filter(j => j.checkKind !== "fb_reels_published");
    const postPublishChecks = checks.filter(j => j.checkKind === "fb_reels_published");

    if (!isFacebookReels && checks.length !== publishes.length) {
      throw new Error(`Compose (2): quantidade inconsistente de checkStatus/publish para platform=${platform}, groupKey=${groupKey}, unit=${unit}; checks=${checks.length}; publishes=${publishes.length}`);
    }

    if (isFacebookReels && (prePublishChecks.length !== publishes.length || postPublishChecks.length !== publishes.length)) {
      throw new Error(`Compose (2): Facebook Reels exige checkStatus antes e depois da publicação para platform=${platform}, groupKey=${groupKey}, unit=${unit}`);
    }

    for (const chk of checks) {
      if (chk.statusFromPublishRunIndex === undefined || chk.statusFromPublishRunIndex === null) {
        throw new Error(`Compose (2): checkStatus sem statusFromPublishRunIndex para platform=${platform}, groupKey=${groupKey}, unit=${unit}`);
      }

      const depTarget = rows.find(r => r.publishRunIndex === chk.statusFromPublishRunIndex);
      if (!depTarget) {
        throw new Error(`Compose (2): checkStatus aponta para publishRunIndex inexistente (${chk.statusFromPublishRunIndex}) em platform=${platform}, groupKey=${groupKey}, unit=${unit}`);
      }
    }

    for (const pub of publishes) {
      if (!pub.dependency || !pub.dependency.fieldName) {
        throw new Error(`Compose (2): publish sem dependency.fieldName para platform=${platform}, groupKey=${groupKey}, unit=${unit}, publishRunIndex=${pub.publishRunIndex}`);
      }

      if ((platform === "instagram" || platform === "threads") && pub.dependency.fieldName !== "creation_id") {
        throw new Error(`Compose (2): publish ${platform} deve depender de creation_id, mas veio ${pub.dependency.fieldName}`);
      }

      if (platform === "facebook" && pub.facebookPublishMode === "feed" && pub.dependency.fieldName !== "attached_media") {
        throw new Error(`Compose (2): publish facebook/feed deve depender de attached_media, mas veio ${pub.dependency.fieldName}`);
      }

      if (platform === "facebook" && pub.facebookPublishMode === "reels" && pub.dependency.fieldName !== "video_id") {
        throw new Error(`Compose (2): publish facebook/reels deve depender de video_id, mas veio ${pub.dependency.fieldName}`);
      }

      if ((platform === "instagram" || platform === "threads") && (pub.creationIdFromPublishRunIndex === undefined || pub.creationIdFromPublishRunIndex === null)) {
        throw new Error(`Compose (2): publish ${platform} sem creationIdFromPublishRunIndex para groupKey=${groupKey}, unit=${unit}`);
      }

      if (platform === "facebook" && pub.facebookPublishMode === "feed" && !Array.isArray(pub.attachedMediaFromPublishRunIndexes)) {
        throw new Error(`Compose (2): publish facebook/feed sem attachedMediaFromPublishRunIndexes para groupKey=${groupKey}, unit=${unit}`);
      }

      if (pub.checkStatusFromPublishRunIndex === undefined || pub.checkStatusFromPublishRunIndex === null) {
        throw new Error(`Compose (2): publish sem checkStatusFromPublishRunIndex para platform=${platform}, groupKey=${groupKey}, unit=${unit}`);
      }
    }

    const maxCheckIdx = Math.max(...checks.map(j => Number(j.publishRunIndex || -1)));
    const minPublishIdx = Math.min(...publishes.map(j => Number(j.publishRunIndex || 999999999)));

    if (minPublishIdx <= maxCheckIdx && checks.length === 1 && publishes.length === 1) {
      throw new Error(`Compose (2): publish apareceu antes do checkStatus para platform=${platform}, groupKey=${groupKey}, unit=${unit}`);
    }
  }
}

function assertEveryCheckStatusHasPublish(results) {
  const rows = results
    .map(r => (r && r.json) ? r.json : null)
    .filter(Boolean);

  for (const chk of rows.filter(j => j.phase === "checkStatus")) {
    const matches = rows.filter(j =>
      j.groupKey === chk.groupKey &&
      j.unit === chk.unit &&
      j.platform === chk.platform &&
      j.phase === "publish"
    );

    if (matches.length !== 1) {
      throw new Error(
        `Compose (2): esperado exatamente 1 publish para checkStatus platform=${chk.platform}, groupKey=${chk.groupKey}, unit=${chk.unit}; encontrados=${matches.length}`
      );
    }
  }
}


// ======================================================
// MAIN
// ======================================================
let c2Items = $items("Compose (1)") || [];
const uploadItems = $items("Upload File") || [];
const aggregate2Items = $items("Aggregate (2)") || [];
const liviaItems = $items("Livia") || [];

if (!c2Items.length) return [];

c2Items = normalizeCompose1ToLegacyItems(c2Items);
if (!c2Items.length) return [];

const uploadArr = flattenUploadItems(uploadItems);
const uploadMaps = buildUploadMaps(uploadArr);

const liviaNorm = normalizeLiviaAll(liviaItems, c2Items.length);

function getAggregateCandidateUploads() {
  const item = (aggregate2Items[0] && aggregate2Items[0].json) ? aggregate2Items[0].json : {};
  const urls = Array.isArray(item.url) ? item.url : [];
  const candidates = Array.isArray(item.candidate) ? item.candidate : [];
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    const candidate = asObj(candidates[i]);
    const url = ensureHttps(str(urls[i], ""));
    if (!candidate || !url) continue;
    out.push({
      url,
      rank: Number(candidate.rank || 0),
      timestampSeconds: Number(candidate.timestampSeconds || 0),
      timestamp: str(candidate.timestamp, ""),
    });
  }
  return out;
}

const aggregateCandidateUploads = getAggregateCandidateUploads();

function resolveSelectedFrameUrlFromAggregate(livItem) {
  if (!livItem || !aggregateCandidateUploads.length) return "";
  if (livItem.selectedFrameRank) {
    const byRank = aggregateCandidateUploads.find((item) => Number(item.rank || 0) === Number(livItem.selectedFrameRank || 0));
    if (byRank && byRank.url) return byRank.url;
  }
  const bestFrameSeconds = Number(livItem.bestFrameSeconds || 0);
  if (bestFrameSeconds > 0) {
    const byTime = aggregateCandidateUploads
      .map((item) => ({ ...item, delta: Math.abs(Number(item.timestampSeconds || 0) - bestFrameSeconds) }))
      .sort((a, b) => a.delta - b.delta)[0];
    if (byTime && byTime.url) return byTime.url;
  }
  return "";
}

const globalCaptionWarnings = [];
const globalCaptions = getCaptionsGlobal(liviaNorm, globalCaptionWarnings);

const groupsMap = new Map();
for (let i = 0; i < c2Items.length; i++) {
  const c2 = (c2Items[i] && c2Items[i].json) || {};
  const groupKey = str(c2.groupKey, `idx:${i}`);
  const groupOrder = Number(c2.groupOrder ?? 0);

  if (!groupsMap.has(groupKey)) {
    groupsMap.set(groupKey, { groupKey, groupOrder, items: [] });
  }

  groupsMap.get(groupKey).items.push({ index: i, c2 });
}

const groups = Array.from(groupsMap.values()).sort((a, b) => (a.groupOrder - b.groupOrder));

const UNIT_KEYS = ["bss", "nh"];
const PLATFORM_ORDER = ["instagram", "facebook", "threads"];

let publishRunIndex = 0;
const results = [];

for (const group of groups) {
  const groupItems = group.items;
  if (!groupItems.length) continue;

  groupItems.sort((a, b) => a.index - b.index);

  const firstC2 = groupItems[0].c2 || {};
  const schedule = computeSchedule(firstC2.publishTime);
  const isCarouselGroup = groupItems.length > 1;

  const firstIdx = groupItems[0].index;
  const firstUpload = (uploadItems[firstIdx] && uploadItems[firstIdx].json) || {};
  const firstUrlProbe = ensureHttps(str(firstUpload.secure_url || firstUpload.url || firstC2.webContentLink, ""));
  const firstIsVideo = detectMediaKindSmart(firstC2.mimeType, firstUrlProbe).isVideo;

  for (const unitKey of UNIT_KEYS) {
    for (const platform of PLATFORM_ORDER) {
      const warnings = [];
      for (const w of globalCaptionWarnings) pushUnique(warnings, w);

      const igObj = firstC2.instagram || {};
      const fbObj = firstC2.facebook || {};
      const thObj = firstC2.threads || {};

      let network = "";
      let version = "";
      let accountId = "";
      let token = "";
      let uploadEndpoint = "";
      let publishEndpoint = "";
      let facebookPublishMode = "";

      if (platform === "instagram") {
        const igNetwork = str(igObj.network, "").toLowerCase();
        network = (igNetwork && igNetwork !== "facebook.com") ? igNetwork : "instagram.com";
        version = str(igObj.version, "v24.0");
        accountId = (unitKey === "bss") ? normId(igObj.id_bss) : normId(igObj.id_nh);
        token = (unitKey === "bss") ? normToken(igObj.token_bss) : normToken(igObj.token_nh);
        uploadEndpoint = str(igObj.endpoint_1st, "media");
        publishEndpoint = str(igObj.endpoint_2nd, "media_publish");
      }

      if (platform === "facebook") {
        network = str(fbObj.network, "facebook.com");
        version = str(fbObj.version, "v24.0");
        accountId = (unitKey === "bss") ? normId(fbObj.id_bss) : normId(fbObj.id_nh);
        token = (unitKey === "bss") ? normToken(fbObj.token_bss) : normToken(fbObj.token_nh);
        publishEndpoint = str(fbObj.endpoint_2nd, "feed");
      }

      if (platform === "threads") {
        network = str(thObj.network, "threads.net");
        version = str(thObj.version, "v1.0");

        const useMe = (thObj.use_me === undefined) ? true : toBool(thObj.use_me, true);
        accountId = useMe ? "me" : ((unitKey === "bss") ? normId(thObj.id_bss) : normId(thObj.id_nh));

        token = (unitKey === "bss") ? normToken(thObj.token_bss) : normToken(thObj.token_nh);
        uploadEndpoint = str(thObj.endpoint_1st, "threads");
        publishEndpoint = str(thObj.endpoint_2nd, "threads_publish");
      }

      if (!accountId) { pushUnique(warnings, `${platform}.id.${unitKey} ausente`); continue; }
      if (!token) pushUnique(warnings, `${platform}.token.${unitKey} ausente`);

      const baseUrlAccount = `https://graph.${network}/${version}/${accountId}/`;

      const uploadRunIndexes = [];

      if (platform === "facebook" && firstIsVideo) {
        facebookPublishMode = "reels";

        if (isCarouselGroup) pushUnique(warnings, "facebook.reels: grupo com múltiplos arquivos; usando apenas o 1º vídeo");

        const firstIndex = groupItems[0].index;
        const c2 = groupItems[0].c2 || {};
        const upload = (uploadItems[firstIndex] && uploadItems[firstIndex].json) || {};

        const fileWarnings = [];
        const directUrl = ensureHttps(str(upload.secure_url || upload.url || "", ""));
        if (!directUrl) {
          throw new Error(
            `Compose (2): Upload File sem secure_url/url para facebook/reels (groupKey=${group.groupKey}, globalIdx=${firstIndex}, mediaId=${str(c2.id, "n/a")}, mediaName=${str(c2.name, "n/a")})`
          );
        }
        const finalUrl = directUrl;

        const livIdx = resolveLiviaIndex(liviaNorm, firstIndex, 0, groupItems.length, c2Items.length);
        const livWarn = [];
        const livItem = extractFromLivia(liviaNorm, livIdx, livWarn);
        const capsHere = getCaptionsForIndex(liviaNorm, livIdx);
        const fbCaption = str(capsHere.fbCaption, "") || str(globalCaptions.fbCaption, "");

        const startUrl = baseUrlAccount + "video_reels?upload_phase=start";
        const startRun = publishRunIndex++;
        uploadRunIndexes.push(startRun);

        results.push({
          json: removeNulls({
            groupKey: group.groupKey,
            groupOrder: group.groupOrder,
            unit: unitKey,
            platform,
            phase: "upload",
            step: "reels_start",
            index: 0,
            method: "POST",
            url: startUrl,
            params: { access_token: token },
            jsonRequest: {},
            requestSkipBody: true,
            requestBinary: false,
            requestHeaders: {},
            media: {
              id: c2.id,
              name: c2.name,
              mimeType: c2.mimeType,
              size: c2.size,
              webContentLink: c2.webContentLink || null,
              finalUrl,
              publishTime: c2.publishTime || "",
              quantity: 1,
            },
            text: { caption: fbCaption, title: livItem.title, alt_text: livItem.alt_text, bestFrameSeconds: livItem.bestFrameSeconds },
            warnings: [...warnings, ...fileWarnings, ...livWarn],
            publishRunIndex: startRun,
          })
        });

        const uploadRun = publishRunIndex++;
        uploadRunIndexes.push(uploadRun);

        const ruploadHeaders = { file_url: finalUrl };
        if (token) ruploadHeaders.Authorization = `OAuth ${token}`;

        results.push({
          json: removeNulls({
            groupKey: group.groupKey,
            groupOrder: group.groupOrder,
            unit: unitKey,
            platform,
            phase: "upload",
            step: "reels_upload_hosted",
            index: 1,
            method: "POST",
            url: "REELS_UPLOAD_URL_FROM_START",
            params: { access_token: token },
            jsonRequest: {},
            requestSkipBody: true,
            requestBinary: false,
            requestHeaders: ruploadHeaders,
            reelsStartFromPublishRunIndex: startRun,
            media: {
              id: c2.id,
              name: c2.name,
              mimeType: c2.mimeType,
              size: c2.size,
              webContentLink: c2.webContentLink || null,
              finalUrl,
              publishTime: c2.publishTime || "",
              quantity: 1,
            },
            text: { caption: fbCaption, title: livItem.title, alt_text: livItem.alt_text, bestFrameSeconds: livItem.bestFrameSeconds },
            warnings: [...warnings, ...fileWarnings, ...livWarn],
            publishRunIndex: uploadRun,
          })
        });

      } else {
        for (let localIdx = 0; localIdx < groupItems.length; localIdx++) {
          const { index: globalIdx, c2 } = groupItems[localIdx];
          const upload = (uploadItems[globalIdx] && uploadItems[globalIdx].json) || {};

          const fileWarnings = [];
          const directUrl = ensureHttps(str(upload.secure_url || upload.url || "", ""));
          if (!directUrl) {
            throw new Error(
              `Compose (2): Upload File sem secure_url/url para item (platform=${platform}, groupKey=${group.groupKey}, localIdx=${localIdx}, globalIdx=${globalIdx}, mediaId=${str(c2.id, "n/a")}, mediaName=${str(c2.name, "n/a")})`
            );
          }
          const finalUrl = directUrl;

          const kind = detectMediaKindSmart(c2.mimeType, finalUrl);
          const isVideo = kind.isVideo;

          const livIdx = resolveLiviaIndex(liviaNorm, globalIdx, localIdx, groupItems.length, c2Items.length);

          const livItem = extractFromLivia(liviaNorm, livIdx, fileWarnings);
          const capsHere = getCaptionsForIndex(liviaNorm, livIdx);
          const selectedFrameUrlResolved =
            resolveSelectedFrameUrl(livItem, c2) ||
            resolveSelectedFrameUrlFromAggregate(livItem);

          const frameAnalysisSummary = {
            candidateCount: Array.isArray(livItem.frameCandidates) ? livItem.frameCandidates.length : 0,
            selectedSource: str(livItem.selectedFrameSource, "") || (selectedFrameUrlResolved ? "fallback" : ""),
            confidence: Number(livItem.bestFrameConfidence || 0)
          };

          if (isVideo && !selectedFrameUrlResolved) pushUnique(fileWarnings, "thumbnail_url ausente (Livia/Media)");

          const isCarouselItem = isCarouselGroup;
          const mediaTypeGeneric = str(c2.media_type_1st_requisition, "").toUpperCase();

          const mediaTypeIGUpload = isCarouselGroup
            ? (isVideo ? "VIDEO" : "")
            : (isVideo ? "REELS" : "");

          const mediaTypeThreadsUpload = mediaTypeGeneric || (isVideo ? "VIDEO" : "");

          let url = "";
          let body = {};
          let textMeta = null;

          if (platform === "instagram") {
            url = baseUrlAccount + uploadEndpoint;

            const igCaptionSingle = str(capsHere.igCaption, "") || str(globalCaptions.igCaption, "");

            body = buildUploadBodyInstagram({
              isVideo,
              isCarouselItem,
              url: finalUrl,
              media_type: mediaTypeIGUpload,
              caption: igCaptionSingle,
              alt_text: livItem.alt_text,
              bestFrameSeconds: livItem.bestFrameSeconds,
              selectedFrameUrl: selectedFrameUrlResolved,
            });

            textMeta = {
              caption: igCaptionSingle,
              title: livItem.title,
              alt_text: livItem.alt_text,
              bestFrameSeconds: livItem.bestFrameSeconds,
              selectedFrameUrl: selectedFrameUrlResolved,
              frameAnalysisSummary
            };
          }

          if (platform === "threads") {
            url = baseUrlAccount + uploadEndpoint;

            const thTextSingle = str(capsHere.thCaption, "") || str(globalCaptions.thCaption, "");

            body = buildUploadBodyThreads({
              isVideo,
              isCarouselItem,
              url: finalUrl,
              media_type: mediaTypeThreadsUpload,
              text: thTextSingle,
              title: livItem.title,
              alt_text: livItem.alt_text,
              selectedFrameUrl: selectedFrameUrlResolved,
            });

            textMeta = {
              caption: thTextSingle,
              title: livItem.title,
              alt_text: livItem.alt_text,
              bestFrameSeconds: livItem.bestFrameSeconds,
              selectedFrameUrl: selectedFrameUrlResolved,
              frameAnalysisSummary
            };
          }

          if (platform === "facebook") {
            if (isVideo) {
              pushUnique(fileWarnings, "facebook: vídeo detectado em grupo não-reels; ignorado (use fluxo reels)");
              continue;
            }

            const endpoint1 = str(fbObj.endpoint_1st, "").trim();
            const edge = str(c2.edge, "").trim();
            const chosen = endpoint1 || edge || "photos";

            url = baseUrlAccount + chosen;

            const fbCaptionPublish = str(capsHere.fbCaption, "") || str(globalCaptions.fbCaption, "");

            // Upload da foto sem duplicar copy.
            body = buildUploadBodyFacebookPhotos({ url: finalUrl, caption: "" });

            textMeta = {
              caption: fbCaptionPublish,
              title: livItem.title,
              alt_text: livItem.alt_text,
              bestFrameSeconds: livItem.bestFrameSeconds,
              selectedFrameUrl: selectedFrameUrlResolved,
              frameAnalysisSummary
            };
          }

          const params = { access_token: token };

          const myRun = publishRunIndex++;
          uploadRunIndexes.push(myRun);

          results.push({
            json: removeNulls({
              groupKey: group.groupKey,
              groupOrder: group.groupOrder,
              unit: unitKey,
              platform,
              phase: "upload",
              step: "default_upload",
              index: localIdx,
              method: "POST",
              url,
              params,
              jsonRequest: body,
              requestSkipBody: false,
              requestBinary: false,
              requestHeaders: {},
              media: {
                id: c2.id,
                name: c2.name,
                mimeType: c2.mimeType,
                size: c2.size,
                webContentLink: c2.webContentLink || null,
                finalUrl,
                publishTime: c2.publishTime || "",
                quantity: Number(c2.quantity ?? groupItems.length),
              },
              text: textMeta,
              warnings: [...warnings, ...fileWarnings],
              publishRunIndex: myRun,
            })
          });
        }
      }

      let containerRunIndex = null;
      if (isCarouselGroup && (platform === "instagram" || platform === "threads")) {
        const containerUrl = baseUrlAccount + uploadEndpoint;
        const params = { access_token: token };

        const livFirstIdx = resolveLiviaIndex(liviaNorm, groupItems[0].index, 0, groupItems.length, c2Items.length);
        const livFirst = extractFromLivia(liviaNorm, livFirstIdx, []);
        const capsFirst = getCaptionsForIndex(liviaNorm, livFirstIdx);

        const igCaptionContainer = str(globalCaptions.igCaption, "") || str(capsFirst.igCaption, "");
        const thTextContainer = str(globalCaptions.thCaption, "") || str(capsFirst.thCaption, "");

        const body = (platform === "instagram")
          ? buildUploadContainerBodyInstagram({ caption: igCaptionContainer })
          : buildUploadContainerBodyThreads({ text: thTextContainer, title: livFirst.title });

        containerRunIndex = publishRunIndex++;

        results.push({
          json: removeNulls({
            groupKey: group.groupKey,
            groupOrder: group.groupOrder,
            unit: unitKey,
            platform,
            phase: "uploadContainer",
            step: "container",
            index: 0,
            method: "POST",
            url: containerUrl,
            params,
            jsonRequest: body,
            requestSkipBody: false,
            requestBinary: false,
            requestHeaders: {},
            dependency: { fieldName: "children" },
            childrenPublishRunIndexes: uploadRunIndexes,
            text: (platform === "instagram")
              ? { caption: igCaptionContainer, title: livFirst.title, alt_text: livFirst.alt_text, bestFrameSeconds: livFirst.bestFrameSeconds }
              : { caption: thTextContainer, title: livFirst.title, alt_text: livFirst.alt_text, bestFrameSeconds: livFirst.bestFrameSeconds },
            publishRunIndex: containerRunIndex,
            warnings,
          })
        });
      }

      let checkStatusRunIndex = null;
      {
        const isFb = platform === "facebook";
        const isIg = platform === "instagram";
        const isTh = platform === "threads";

        let statusFromPublishRunIndex = null;
        let checkFields = "";
        let checkKind = "";

        const lastUploadRun = uploadRunIndexes[uploadRunIndexes.length - 1] ?? null;

        if (isIg) {
          statusFromPublishRunIndex = isCarouselGroup ? containerRunIndex : lastUploadRun;
          checkFields = "status_code,status";
          checkKind = "ig_creation";
        } else if (isTh) {
          statusFromPublishRunIndex = isCarouselGroup ? containerRunIndex : lastUploadRun;
          checkFields = "status";
          checkKind = "th_creation";
        } else if (isFb && firstIsVideo) {
          statusFromPublishRunIndex = uploadRunIndexes[0] ?? null;
          checkFields = "status";
          checkKind = "fb_reels_upload_ready";
        } else if (isFb) {
          statusFromPublishRunIndex = lastUploadRun;
          checkFields = "id";
          checkKind = "fb_feed_media";
        }

        checkStatusRunIndex = publishRunIndex++;

        results.push({
          json: removeNulls({
            groupKey: group.groupKey,
            groupOrder: group.groupOrder,
            unit: unitKey,
            platform,
            phase: "checkStatus",
            step: "status",
            index: 0,
            method: "GET",
            url: "CHECK_STATUS_URL_FROM_ID",
            params: { access_token: token },
            jsonRequest: {},
            requestSkipBody: true,
            requestBinary: false,
            requestHeaders: {},
            checkKind,
            checkFields,
            statusFromPublishRunIndex,
            attempt: 0,
            maxAttempts: 20,
            waitSeconds: 20,
            publishRunIndex: checkStatusRunIndex,
            warnings,
          })
        });
      }

      {
        const isFb = platform === "facebook";
        const isIg = platform === "instagram";
        const isTh = platform === "threads";

        let url = baseUrlAccount + publishEndpoint;
        const params = { access_token: token };

        const lastUploadRun = uploadRunIndexes[uploadRunIndexes.length - 1] ?? null;

        const livFirstWarnings = [];
        const livFirstIdx = resolveLiviaIndex(liviaNorm, groupItems[0].index, 0, groupItems.length, c2Items.length);
        const livFirst = extractFromLivia(liviaNorm, livFirstIdx, livFirstWarnings);
        const capsFirst = getCaptionsForIndex(liviaNorm, livFirstIdx);

        const igCaption = str(globalCaptions.igCaption, "") || str(capsFirst.igCaption, "");
        const fbCaption = str(globalCaptions.fbCaption, "") || str(capsFirst.fbCaption, "");
        const thCaption = str(globalCaptions.thCaption, "") || str(capsFirst.thCaption, "");
        const selUrlFirst =
          livFirst.selectedFrameUrl ||
          resolveSelectedFrameUrl(livFirst, firstC2) ||
          resolveSelectedFrameUrlFromAggregate(livFirst) ||
          "";

        let jsonRequest = {};
        let text = null;
        let dependency = null;

        if (isFb) {
          if (firstIsVideo) {
            facebookPublishMode = "reels";
            url = baseUrlAccount + "video_reels";
            jsonRequest = {};
            dependency = { fieldName: "video_id" };
          } else {
            facebookPublishMode = "feed";
            const scheduleUnix = schedule.shouldSchedule ? schedule.unix : null;

            jsonRequest = buildPublishBaseFacebookFeed({
              message: fbCaption,
              isCarousel: isCarouselGroup,
              scheduleUnix,
            });

            dependency = { fieldName: "attached_media" };
          }

          text = { caption: fbCaption, title: livFirst.title, alt_text: livFirst.alt_text, bestFrameSeconds: livFirst.bestFrameSeconds, selectedFrameUrl: selUrlFirst };
        }

        if (isIg) {
          jsonRequest = {};
          dependency = { fieldName: "creation_id" };
          text = { caption: igCaption, alt_text: livFirst.alt_text, bestFrameSeconds: livFirst.bestFrameSeconds, selectedFrameUrl: selUrlFirst };
        }

        if (isTh) {
          jsonRequest = {};
          dependency = { fieldName: "creation_id" };
          text = { caption: thCaption, title: livFirst.title, alt_text: livFirst.alt_text };
        }

        const myRun = publishRunIndex++;

        const out = {
          groupKey: group.groupKey,
          groupOrder: group.groupOrder,
          unit: unitKey,
          platform,
          phase: "publish",
          step: (isFb && firstIsVideo) ? "reels_finish" : "default_publish",
          index: 0,
          method: "POST",
          url,
          params,
          jsonRequest,
          text,
          dependency,
          requestSkipBody: false,
          requestBinary: false,
          requestHeaders: {},
          publishRunIndex: myRun,
          warnings: [...warnings, ...livFirstWarnings],
          facebookPublishMode,
          creationIdFromPublishRunIndex: (isIg || isTh)
            ? (isCarouselGroup ? containerRunIndex : lastUploadRun)
            : undefined,
          lastUploadFromPublishRunIndex: isFb ? lastUploadRun : undefined,
          attachedMediaFromPublishRunIndexes: (isFb && facebookPublishMode !== "reels")
            ? uploadRunIndexes
            : undefined,
          reelsStartFromPublishRunIndex: (isFb && firstIsVideo) ? uploadRunIndexes[0] : undefined,
          scheduleUnix: (isIg && schedule.shouldSchedule) ? schedule.unix : undefined,
          checkStatusFromPublishRunIndex: checkStatusRunIndex,
        };

        results.push({ json: removeNulls(out) });

        // Meta aceita o comando de finalização antes que o Reel esteja público.
        // O segundo polling é obrigatório: impede que HTTP 200 seja tratado como
        // publicação concluída e preserva o mesmo video_id para uma recuperação
        // idempotente quando o provedor termina assíncronamente em erro.
        if (isFb && firstIsVideo) {
          const postPublishStatusRunIndex = publishRunIndex++;
          results.push({
            json: removeNulls({
              groupKey: group.groupKey,
              groupOrder: group.groupOrder,
              unit: unitKey,
              platform,
              phase: "checkStatus",
              step: "reels_publish_status",
              index: 1,
              method: "GET",
              url: "CHECK_STATUS_URL_FROM_ID",
              params: { access_token: token },
              jsonRequest: {},
              requestSkipBody: true,
              requestBinary: false,
              requestHeaders: {},
              checkKind: "fb_reels_published",
              checkFields: "status",
              statusFromPublishRunIndex: uploadRunIndexes[0] ?? null,
              postPublishFromRunIndex: myRun,
              reelsStartFromPublishRunIndex: uploadRunIndexes[0] ?? null,
              attempt: 0,
              maxAttempts: 20,
              waitSeconds: 20,
              recoveryAttempt: 0,
              maxRecoveryAttempts: 1,
              publishRunIndex: postPublishStatusRunIndex,
              warnings,
            })
          });
        }
      }
    }
  }
}

assertEveryCheckStatusHasPublish(results);
assertPlatformPhaseIntegrity(results);

return results;
