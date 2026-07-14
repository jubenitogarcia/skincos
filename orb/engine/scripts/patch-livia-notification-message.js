#!/usr/bin/env node

const fs = require('fs');

const inputPath = process.argv[2] || 'workflows/livia.json';
const outputPath = process.argv[3] || inputPath;

const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function fail(message) {
  throw new Error(message);
}

function getNode(name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) fail(`Node not found: ${name}`);
  return node;
}

function replaceBetween(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) fail(`Missing start marker: ${label}`);
  const endIndex = source.indexOf(end, startIndex);
  if (endIndex < 0) fail(`Missing end marker: ${label}`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

const compose3 = getNode('Compose (3)');
const telegramFallback = getNode('Inform Success (2)');

let code = compose3.parameters.jsCode;

code = replaceBetween(
  code,
  'function materializePlatform(store) {',
  'function platformDebug(store) {',
  `function extractHashtags(value) {
  return uniqueNonEmpty(str(value, "").match(/#[A-Za-zÀ-ÿ0-9_]+/g) || []);
}

function captionWithoutHashtags(value) {
  return compactText(str(value, "").replace(/#[A-Za-zÀ-ÿ0-9_]+/g, " ").replace(/\\s+([.,;:!?])/g, "$1"));
}

function limitText(value, max = 1000) {
  const s = compactText(value);
  if (!s || s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function materializePlatform(store) {
  const caption = uniqueNonEmpty(store.caption)[0] || "";
  return {
    title: uniqueNonEmpty(store.title)[0] || "",
    caption,
    captionClean: captionWithoutHashtags(caption),
    hashtags: extractHashtags(caption),
    altText: uniqueNonEmpty(store.altText)[0] || "",
    permalinks: {
      bss: uniqueNonEmpty(store.permalinksByUnit.bss)[0] || "",
      nh: uniqueNonEmpty(store.permalinksByUnit.nh)[0] || "",
    },
  };
}

`,
  'platform materialization',
);

code = replaceBetween(
  code,
  'function buildPlatformLinks(label, data, alerts) {',
  'function cleanupPrepareRequestState() {',
  `function buildPlatformLinks(label, data, alerts) {
  const bss = data.permalinks.bss || "";
  const nh = data.permalinks.nh || "";
  if (!bss) alerts.push(label + " BSS: link público pendente.");
  if (!nh) alerts.push(label + " NH: link público pendente.");
  return [
    label + ":",
    "BSS: " + (bss || "pendente"),
    "NH: " + (nh || "pendente"),
  ].join("\\n");
}

function formatHashtags(tags) {
  const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
  return list.length ? list.join(" ") : "sem hashtags";
}

function buildCopyBlock(label, data) {
  return [
    label,
    "Título: " + (limitText(data.title, 180) || "sem título"),
    "Alt text: " + (limitText(data.altText, 280) || "sem alt text"),
    "Hashtags: " + formatHashtags(data.hashtags),
    "Legenda: " + (limitText(data.captionClean || data.caption, 1100) || "sem legenda"),
  ].join("\\n");
}

function buildWhatsAppMessage({ groupLabel, media, contentTitle, whatsapp, alerts }) {
  const lines = [
    "✅ Livia publicada",
    "Grupo: " + groupLabel,
    "Mídia: " + media,
    "Conteúdo: " + contentTitle,
    "",
    "Links públicos",
    buildPlatformLinks("Instagram", whatsapp.instagram, alerts),
    "",
    buildPlatformLinks("Facebook", whatsapp.facebook, alerts),
    "",
    buildPlatformLinks("Threads", whatsapp.threads, alerts),
    "",
    "Copy por rede",
    buildCopyBlock("Instagram", whatsapp.instagram),
    "",
    buildCopyBlock("Facebook", whatsapp.facebook),
    "",
    buildCopyBlock("Threads", whatsapp.threads),
  ];

  if (alerts.length) {
    lines.push("", "Links pendentes:");
    for (const alert of alerts) lines.push("- " + alert);
  }

  return lines.join("\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
}

`,
  'notification message builder',
);

compose3.parameters.jsCode = code;

telegramFallback.parameters.text = `={{ (() => {
  function str(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function htmlEscape(value) {
    return str(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const base = $json.whatsappMessage || $("Compose (3)").first().json.whatsappMessage || "";
  return htmlEscape(base);
})() }}`;

telegramFallback.parameters.additionalFields = {
  ...(telegramFallback.parameters.additionalFields || {}),
  appendAttribution: false,
  disable_web_page_preview: true,
  parse_mode: 'HTML',
};

fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(JSON.stringify({
  inputPath,
  outputPath,
  patched: true,
  nodes: [compose3.name, telegramFallback.name],
  message: 'Notification now includes per-network copy and Telegram fallback no longer reports WhatsApp delivery failure.',
}, null, 2));
