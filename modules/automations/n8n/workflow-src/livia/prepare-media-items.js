function str(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value);
}

function inferMimeTypeFromName(name, fallback = "") {
  const lower = str(name, "").trim().toLowerCase();
  if (!lower) return fallback;
  if (/\.(mp4|m4v|webm|mkv)$/i.test(lower)) return "video/mp4";
  if (/\.mov$/i.test(lower)) return "video/quicktime";
  if (/\.(jpg|jpeg)$/i.test(lower)) return "image/jpeg";
  if (/\.png$/i.test(lower)) return "image/png";
  if (/\.webp$/i.test(lower)) return "image/webp";
  if (/\.heic$/i.test(lower)) return "image/heic";
  return fallback;
}

function toBoolLoose(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = str(value, "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "sim"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "nao", "não"].includes(normalized)) return false;
  return fallback;
}

function normalizeUnit(raw) {
  const compact = str(raw, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");

  if (compact.includes("BARRA") && compact.includes("SUL")) return "bss";
  if (compact === "BARRASHOPPINGSUL" || compact === "BSS") return "bss";
  if (compact.includes("NOVO") && compact.includes("HAMBURGO")) return "nh";
  if (compact === "NOVOHAMBURGO" || compact === "NH") return "nh";
  return "";
}

function getBaseDatetime(name) {
  const base = str(name, "").split(".")[0] || "";
  const match = base.match(/^(\d{10})/);
  return match ? match[1] : "";
}

function getPublishTimeFromName(name) {
  const match = str(name, "").match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!match) return "";
  const [, dd, MM, yy, HH, mm] = match;
  return `20${yy}-${MM}-${dd}T${HH}:${mm}:00-03:00`;
}

function detectBaseMediaType(mimeType) {
  const normalized = str(mimeType, "").toLowerCase();
  if (normalized.startsWith("video")) return "VIDEO";
  if (normalized.startsWith("image")) return "IMAGE";
  return "";
}

function detectFacebookEdge(mimeType) {
  const normalized = str(mimeType, "").toLowerCase();
  if (normalized.startsWith("video")) return "videos";
  if (normalized.startsWith("image")) return "photos";
  return "";
}

function getTargetDate() {
  try {
    if (typeof $now !== "undefined" && $now && typeof $now.toFormat === "function") {
      return $now.toFormat("ddMMyy");
    }
  } catch {}

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

function getUnitCredentialsFromTokenVault(root) {
  const tokens = Array.isArray(root?.items) ? root.items : [];
  const byUnit = {
    bss: { Unit: "BSS" },
    nh: { Unit: "NH" },
  };

  for (const token of tokens) {
    if (!token || token.active === false) continue;
    const unitKey = normalizeUnit(token.unit || token.metadata?.legacy_columns?.Unit);
    if (!unitKey || !byUnit[unitKey]) continue;

    if (token.provider === "facebook") {
      byUnit[unitKey].fbId = str(token.fbId || token.external_account_id);
      byUnit[unitKey].fbToken = str(token.fbToken || token.token);
    } else if (token.provider === "instagram") {
      byUnit[unitKey].igId = str(token.igId || token.external_account_id);
      byUnit[unitKey].igToken = str(token.igToken || token.token);
    } else if (token.provider === "threads") {
      byUnit[unitKey].thId = str(token.thId || token.external_account_id);
      byUnit[unitKey].thToken = str(token.thToken || token.token);
    }
  }

  const required = ["fbId", "fbToken", "igId", "igToken", "thId", "thToken"];
  const missing = [];
  for (const [unit, row] of Object.entries(byUnit)) {
    for (const field of required) {
      if (!str(row[field]).trim()) missing.push(`${unit}.${field}`);
    }
  }

  if (missing.length) {
    throw new Error(`Credenciais incompletas no Token Vault: ${missing.join(", ")}`);
  }

  return {
    credBSS: byUnit.bss,
    credNH: byUnit.nh,
  };
}

function buildFacebookConfig(credBSS, credNH) {
  return {
    network: "facebook.com",
    version: "v24.0",
    id_bss: str(credBSS.fbId),
    id_nh: str(credNH.fbId),
    token_bss: credBSS.fbToken,
    token_nh: credNH.fbToken,
    endpoint_1st: "",
    endpoint_2nd: "feed",
  };
}

function buildInstagramConfig(credBSS, credNH) {
  return {
    network: "facebook.com",
    version: "v24.0",
    id_bss: str(credBSS.igId),
    id_nh: str(credNH.igId),
    token_bss: credBSS.igToken,
    token_nh: credNH.igToken,
    endpoint_1st: "media",
    endpoint_2nd: "media_publish",
  };
}

function buildThreadsConfig(credBSS, credNH) {
  return {
    network: "threads.net",
    version: "v1.0",
    id_bss: str(credBSS.thId),
    id_nh: str(credNH.thId),
    token_bss: credBSS.thToken,
    token_nh: credNH.thToken,
    endpoint_1st: "threads",
    endpoint_2nd: "threads_publish",
    use_me: true,
  };
}

function cachePreparedItems(items) {
  try {
    const sd = $getWorkflowStaticData("global");
    const execId = str($execution?.id, "noexec");
    sd.__liviaCompose1 ||= {};
    for (const key of Object.keys(sd.__liviaCompose1)) {
      if (key !== execId) delete sd.__liviaCompose1[key];
    }

    const store = { __items: items };
    for (const item of items) {
      const row = item.json || {};
      const fileBase = str(row.name, "").replace(/\.[^.]+$/, "");
      const keys = [
        row.id,
        row.name,
        row.groupKey,
        row.webContentLink,
        fileBase,
      ].filter(Boolean);

      for (const key of keys) {
        store[String(key)] = row;
      }
    }

    sd.__liviaCompose1[execId] = store;
  } catch {}
}

const driveFiles = $input.all()
  .map((item) => item.json || {})
  .filter((item) => item && item.name)
  .map((item) => ({
    ...item,
    mimeType: str(item.mimeType, "") || inferMimeTypeFromName(item.name, ""),
  }));

if (!driveFiles.length) return [];

let tokenVaultRoot = {};
try {
  tokenVaultRoot = $("Get Credential Tokens").first().json || {};
} catch (error) {
  throw new Error(`Não foi possível ler credenciais do node Get Credential Tokens: ${error.message}`);
}

const { credBSS, credNH } = getUnitCredentialsFromTokenVault(tokenVaultRoot);
const FACEBOOK = buildFacebookConfig(credBSS, credNH);
const INSTAGRAM = buildInstagramConfig(credBSS, credNH);
const THREADS = buildThreadsConfig(credBSS, credNH);
const targetDate = getTargetDate();

const unpublished = driveFiles
  .filter((file) => !toBoolLoose(file.properties?.published, false))
  .sort((left, right) => str(left.name).localeCompare(str(right.name)));

const groupsByKey = new Map();

for (const file of unpublished) {
  const base = getBaseDatetime(file.name);
  if (!base) continue;

  const fileDate = base.slice(0, 6);
  if (targetDate && fileDate !== targetDate) continue;

  const hour = Number.parseInt(base.slice(6, 8), 10);
  const minute = Number.parseInt(base.slice(8, 10), 10);
  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    continue;
  }

  const groupKey = `dt:${base}`;
  if (!groupsByKey.has(groupKey)) {
    groupsByKey.set(groupKey, {
      groupKey,
      postPrefix: base,
      targetDate: fileDate,
      items: [],
    });
  }

  groupsByKey.get(groupKey).items.push(file);
}

const groups = [...groupsByKey.values()].sort((left, right) => left.postPrefix.localeCompare(right.postPrefix));
const output = [];

groups.forEach((group, groupOrder) => {
  const files = [...group.items].sort((left, right) => str(left.name).localeCompare(str(right.name)));
  if (!files.length) return;

  const first = files[0] || {};
  const publishTime = getPublishTimeFromName(first.name);
  const quantity = files.length;
  const isMulti = quantity > 1;
  const groupBaseMediaType = detectBaseMediaType(first.mimeType);
  const groupIsVideo = groupBaseMediaType === "VIDEO";
  const groupMediaTypes = files
    .map((file) => detectBaseMediaType(file.mimeType))
    .filter(Boolean);
  const groupIsHomogeneous = !groupMediaTypes.length || groupMediaTypes.every((type) => type === groupMediaTypes[0]);
  const groupHasMixedMedia = groupMediaTypes.length > 0 && !groupIsHomogeneous;

  for (const file of files) {
    const baseMediaType = detectBaseMediaType(file.mimeType);
    output.push({
      json: {
        targetDate: group.targetDate,
        postPrefix: group.postPrefix,
        groupKey: group.groupKey,
        groupOrder,
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        webContentLink: file.webContentLink,
        publishTime,
        quantity,
        isMulti,
        groupBaseMediaType,
        groupIsVideo,
        groupIsHomogeneous,
        groupHasMixedMedia,
        multi_share_optimized: isMulti ? "TRUE" : "FALSE",
        is_carousel_item: isMulti ? "TRUE" : "FALSE",
        media_type: isMulti ? "CAROUSEL" : baseMediaType,
        media_type_1st_requisition: baseMediaType,
        media_type_2nd_requisition: isMulti ? "CAROUSEL" : baseMediaType,
        media_type_instagram: isMulti
          ? "CAROUSEL"
          : (baseMediaType === "VIDEO" ? "REELS" : baseMediaType),
        edge: detectFacebookEdge(file.mimeType),
        facebook: FACEBOOK,
        instagram: INSTAGRAM,
        threads: THREADS,
      },
    });
  }
});

cachePreparedItems(output);

return output;
