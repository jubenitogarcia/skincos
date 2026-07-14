#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.token-vault.export.json'),
];

function parseJson(value, fallback) {
  if (!value) return fallback;
  return JSON.parse(value);
}

function exportWorkflow(workflow, exportPath) {
  fs.writeFileSync(exportPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: {},
    meta: parseJson(row.meta, null),
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    updatedAt: row.updatedAt,
  };
}

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not find ${label}`);
  return source.replace(from, to);
}

function patchCompose3(code) {
  let patched = code;

  patched = replaceOnce(
    patched,
    `function mediaLabel(kinds, fileCount) {
  const values = uniqueNonEmpty(kinds);
  if (fileCount > 1 || values.includes("carousel")) return "carrossel";
  if (values.includes("video")) return "vídeo";
  if (values.includes("image")) return "imagem";
  return "desconhecida";
}
`,
    `function mediaLabel(kinds, fileCount) {
  const values = uniqueNonEmpty(kinds);
  if (fileCount > 1 || values.includes("carousel")) return "carrossel";
  if (values.includes("video")) return "vídeo";
  if (values.includes("image")) return "imagem";
  return "desconhecida";
}

function publishHeadline(kinds, fileCount) {
  const values = uniqueNonEmpty(kinds);
  if (fileCount > 1 || values.includes("carousel")) {
    return \`✅ Carrossel (\${fileCount} mídias) publicado\`;
  }
  if (values.includes("video")) return "✅ Reels publicado";
  if (values.includes("image")) return "✅ Post publicado";
  return "✅ Publicação concluída";
}

function unitLabel(unit) {
  if (unit === "bss") return "BarraShoppingSul";
  if (unit === "nh") return "Novo Hamburgo";
  return unit || "Unidade";
}

function platformIcon(platform) {
  if (platform === "instagram") return "📷";
  if (platform === "facebook") return "🔵";
  if (platform === "threads") return "🧵";
  return "🔗";
}
`,
    'Compose (3) mediaLabel block',
  );

  patched = replaceOnce(
    patched,
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
`,
    `function buildUnitLinks(unit, whatsapp, alerts) {
  const platforms = [
    ["instagram", "Instagram", whatsapp.instagram],
    ["facebook", "Facebook", whatsapp.facebook],
    ["threads", "Threads", whatsapp.threads],
  ];

  const lines = ["*" + unitLabel(unit) + "*"];
  for (const [platform, label, data] of platforms) {
    const url = data.permalinks[unit] || "";
    if (!url) alerts.push(label + " " + unit.toUpperCase() + ": link público pendente.");
    lines.push("- " + platformIcon(platform) + " " + (url || "pendente"));
  }
  return lines.join("\\n");
}
`,
    'Compose (3) buildPlatformLinks block',
  );

  patched = replaceOnce(
    patched,
    `function buildCopyBlock(label, data) {
  return [
    label,
    "Título: " + (limitText(data.title, 180) || "sem título"),
    "Alt text: " + (limitText(data.altText, 280) || "sem alt text"),
    "Hashtags: " + formatHashtags(data.hashtags),
    "Legenda: " + (limitText(data.captionClean || data.caption, 1100) || "sem legenda"),
  ].join("\\n");
}
`,
    `function buildCopyBlock(label, data) {
  return [
    "*" + label + "*",
    "🏷️ " + (limitText(data.title, 180) || "sem título"),
    "🖼️ " + (limitText(data.altText, 280) || "sem alt text"),
    "#️⃣ " + formatHashtags(data.hashtags),
    "📝 " + (limitText(data.captionClean || data.caption, 1100) || "sem legenda"),
  ].join("\\n");
}
`,
    'Compose (3) buildCopyBlock block',
  );

  patched = replaceOnce(
    patched,
    `function buildWhatsAppMessage({ groupLabel, media, contentTitle, whatsapp, alerts }) {
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
    `function buildWhatsAppMessage({ mediaKinds, fileCount, whatsapp, alerts }) {
  const lines = [
    publishHeadline(mediaKinds, fileCount),
    "",
    buildUnitLinks("bss", whatsapp, alerts),
    "",
    buildUnitLinks("nh", whatsapp, alerts),
    "",
    buildCopyBlock("Instagram", whatsapp.instagram),
    "",
    buildCopyBlock("Facebook", whatsapp.facebook),
    "",
    buildCopyBlock("Threads", whatsapp.threads),
  ];

  if (alerts.length) {
    lines.push("", "*Pendências*", ...alerts.map((alert) => "- " + alert));
  }

  return lines.join("\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
}
`,
    'Compose (3) buildWhatsAppMessage block',
  );

  patched = replaceOnce(
    patched,
    `  const alerts = [];
  const groupLabel = formatGroupLabel(meta.groupKey || f.groupKey, f.notificationKey);
  const contentTitle = pickContentTitle(whatsapp);

  return {
`,
    `  const alerts = [];

  return {
`,
    'Compose (3) unused notification variables block',
  );

  patched = replaceOnce(
    patched,
    `      whatsappMessage: buildWhatsAppMessage({
        groupLabel,
        media: mediaLabel(meta.mediaKinds, fileIds.length),
        contentTitle,
        whatsapp,
        alerts,
      }),
`,
    `      whatsappMessage: buildWhatsAppMessage({
        mediaKinds: meta.mediaKinds,
        fileCount: fileIds.length,
        whatsapp,
        alerts,
      }),
`,
    'Compose (3) buildWhatsAppMessage call',
  );

  for (const forbidden of ['"✅ Livia publicada"', '"Grupo: "', '"Mídia: "', '"Conteúdo: "', '"Links públicos"', 'buildPlatformLinks(']) {
    if (patched.includes(forbidden)) throw new Error(`Compose (3) still contains old message fragment: ${forbidden}`);
  }

  return patched;
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(WORKFLOW_ID);
  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} not found`);

  const current = workflowFromRow(row);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-notification-message-layout.${timestamp}.json`);
  exportWorkflow(current, backupPath);

  const patched = {
    ...current,
    nodes: JSON.parse(JSON.stringify(current.nodes || [])),
    connections: JSON.parse(JSON.stringify(current.connections || {})),
    settings: JSON.parse(JSON.stringify(current.settings || {})),
    staticData: current.staticData || {},
    pinData: {},
    meta: {
      ...(current.meta || {}),
      codexPatch: {
        ...(current.meta?.codexPatch || {}),
        name: 'livia-notification-message-layout',
        appliedAt: new Date().toISOString(),
      },
    },
  };

  const compose3 = patched.nodes.find((node) => node.name === 'Compose (3)');
  if (!compose3) throw new Error('Compose (3) node not found');
  if (compose3.type !== 'n8n-nodes-base.code') throw new Error('Compose (3) is not a Code node');
  compose3.parameters.jsCode = patchCompose3(compose3.parameters.jsCode || '');

  const versionId = crypto.randomUUID();
  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const nodes = JSON.stringify(patched.nodes);
  const connections = JSON.stringify(patched.connections);
  const settings = JSON.stringify(patched.settings || {});
  const staticData = JSON.stringify(patched.staticData || {});
  const meta = JSON.stringify(patched.meta || {});

  const save = db.transaction(() => {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(versionId, WORKFLOW_ID, 'Codex', updatedAt, updatedAt, nodes, connections, patched.name, 0, row.description || null);

    db.prepare(`
      UPDATE workflow_entity
      SET nodes = ?, connections = ?, settings = ?, staticData = ?, meta = ?, versionId = ?, activeVersionId = ?, updatedAt = ?
      WHERE id = ?
    `).run(nodes, connections, settings, staticData, meta, versionId, versionId, updatedAt, WORKFLOW_ID);
  });

  save();

  const exported = { ...patched, versionId, activeVersionId: versionId, updatedAt };
  for (const exportPath of EXPORT_PATHS) exportWorkflow(exported, exportPath);

  const fkIssues = db.prepare('PRAGMA foreign_key_check').all();
  const history = db.prepare('SELECT versionId FROM workflow_history WHERE workflowId = ? AND versionId = ?').get(WORKFLOW_ID, versionId);
  db.close();
  if (fkIssues.length) throw new Error(`foreign_key_check failed: ${JSON.stringify(fkIssues)}`);
  if (!history) throw new Error(`workflow_history row missing for ${versionId}`);

  console.log(JSON.stringify({
    ok: true,
    workflowId: WORKFLOW_ID,
    previousVersionId: current.versionId,
    previousActiveVersionId: current.activeVersionId,
    versionId,
    backupPath,
    exports: EXPORT_PATHS,
  }, null, 2));
}

main();
