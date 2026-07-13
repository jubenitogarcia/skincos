#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const WORKFLOW_ID = 'WGXr4vYkv9UoJ8zc';
const EXPORT_PATHS = [
  path.join(__dirname, '..', 'workflows', 'livia.json'),
  path.join(__dirname, '..', 'workflows', 'livia.active.json'),
  path.join(__dirname, '..', 'workflows', 'livia.verify.json'),
  path.join(__dirname, '..', 'workflows', 'livia.db-current.json'),
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
    staticData: parseJson(row.staticData, {}),
    pinData: {},
    meta: parseJson(row.meta, {}),
    versionId: row.versionId,
    activeVersionId: row.activeVersionId,
    updatedAt: row.updatedAt,
  };
}

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Could not find ${label}`);
  return source.replace(from, to);
}

function patchPrepareRequest(code) {
  let patched = code;

  patched = replaceOnce(
    patched,
    `  function safeNodeItems(name) {
    if (name === "Attach Uploaded Main Media Metadata") {
      return staticStoreItems(getExecutionStaticStore("__liviaMainUploads"));
    }

    return [];
  }
`,
    `  function safeNodeItems(name) {
    if (name === "Attach Uploaded Main Media Metadata") {
      return staticStoreItems(getExecutionStaticStore("__liviaMainUploads"));
    }

    if (name === "Prepare Media Items") {
      return staticStoreItems(getExecutionStaticStore("__liviaCompose1"));
    }

    return [];
  }
`,
    'Prepare Request safeNodeItems block',
  );

  patched = replaceOnce(
    patched,
    `  function selectDirectNodeItems(name, directItems) {
    const items = Array.isArray(directItems) ? directItems : [];
    if (!items.length) return [];

    if (name === "Livia") {
      return items.filter((item) => isLiviaItem((item && item.json) || {}));
    }

    if (name === "Attach Uploaded Main Media Metadata") {
      return items.filter((item) => isCombinedMainMediaItem((item && item.json) || {}));
    }

    return [];
  }

  function flattenFrameCandidateItems(items) {
`,
    `  function selectDirectNodeItems(name, directItems) {
    const items = Array.isArray(directItems) ? directItems : [];
    if (!items.length) return [];

    if (name === "Livia") {
      return items.filter((item) => isLiviaItem((item && item.json) || {}));
    }

    if (name === "Attach Uploaded Main Media Metadata") {
      return items.filter((item) => isCombinedMainMediaItem((item && item.json) || {}));
    }

    return [];
  }

  function nonEmptyObject(value) {
    const obj = asObj(value);
    return obj && Object.keys(obj).length ? obj : null;
  }

  function buildPrepareMediaLookup(items) {
    const rows = normalizeCompose1ToLegacyItems(items)
      .map((item) => asObj((item && item.json) || item) || {})
      .filter((row) => Object.keys(row).length);

    const direct = new Map();

    function push(key, row) {
      const normalized = str(key, "").trim();
      if (!normalized || direct.has(normalized)) return;
      direct.set(normalized, row);
    }

    function fileBaseOf(value) {
      return str(value, "").replace(/\\.[^.]+$/, "");
    }

    for (const row of rows) {
      const fileBase = fileBaseOf(row.name || row.fileName || "");
      const keys = [
        row.id,
        row.name,
        row.fileName,
        row.webContentLink,
        row.groupKey,
        fileBase,
        row.groupKey && row.id ? String(row.groupKey) + "|" + String(row.id) : "",
        row.groupKey && row.name ? String(row.groupKey) + "|" + String(row.name) : "",
        row.groupKey && fileBase ? String(row.groupKey) + "|" + String(fileBase) : "",
      ];

      for (const key of keys) push(key, row);
    }

    return { rows, direct };
  }

  function findPrepareMediaContext(uploadJson, lookup) {
    const upload = asObj(uploadJson) || {};
    const state = lookup || { rows: [], direct: new Map() };
    const groupKey = str(upload.groupKey, "");
    const groupOrder = Number(upload.groupOrder ?? NaN);
    const fileBase = str(upload.name || upload.original_filename || upload.display_name || "", "")
      .replace(/\\.[^.]+$/, "");

    const keys = [
      upload.id,
      upload.name,
      upload.original_filename,
      upload.display_name,
      upload.public_id,
      fileBase,
      groupKey,
      groupKey && upload.id ? String(groupKey) + "|" + String(upload.id) : "",
      groupKey && upload.name ? String(groupKey) + "|" + String(upload.name) : "",
      groupKey && upload.original_filename ? String(groupKey) + "|" + String(upload.original_filename) : "",
      groupKey && fileBase ? String(groupKey) + "|" + String(fileBase) : "",
    ];

    for (const key of keys) {
      const normalized = str(key, "").trim();
      if (normalized && state.direct.has(normalized)) {
        return state.direct.get(normalized) || {};
      }
    }

    const groupRows = state.rows.filter((row) => str(row.groupKey, "") === groupKey);

    if (Number.isFinite(groupOrder)) {
      const byOrder = groupRows.find((row) => Number(row.groupOrder ?? NaN) === groupOrder);
      if (byOrder) return byOrder;
    }

    if (fileBase) {
      const byBase = groupRows.find((row) => str(row.name, "").replace(/\\.[^.]+$/, "") === fileBase);
      if (byBase) return byBase;
    }

    if (groupRows.length === 1) return groupRows[0];
    return {};
  }

  function mergeCombinedPublishContext(item, lookup) {
    const json = asObj((item && item.json) || item) || {};
    const hadPublishContext = !!(
      nonEmptyObject(json.instagram) &&
      nonEmptyObject(json.facebook) &&
      nonEmptyObject(json.threads)
    );

    if (hadPublishContext) {
      return { json };
    }

    const composeContext = findPrepareMediaContext(json, lookup);
    const mergedWarnings = [];

    for (const warning of Array.isArray(composeContext.warnings) ? composeContext.warnings : []) {
      pushUnique(mergedWarnings, warning);
    }

    for (const warning of Array.isArray(json.warnings) ? json.warnings : []) {
      pushUnique(mergedWarnings, warning);
    }

    if (!Object.keys(composeContext).length) {
      pushUnique(mergedWarnings, "prepare_request_publish_context_lookup_failed");
      return {
        json: removeNulls({
          ...json,
          warnings: mergedWarnings,
        }),
      };
    }

    const merged = removeNulls({
      ...composeContext,
      ...json,
      id: str(json.id || composeContext.id, ""),
      name: str(json.name || composeContext.name, ""),
      mimeType: str(json.mimeType || composeContext.mimeType, ""),
      groupKey: str(json.groupKey || composeContext.groupKey, ""),
      groupOrder: json.groupOrder ?? composeContext.groupOrder,
      publishTime: str(json.publishTime || composeContext.publishTime, ""),
      quantity: Number(json.quantity ?? composeContext.quantity ?? 1),
      facebook: nonEmptyObject(json.facebook) || nonEmptyObject(composeContext.facebook) || undefined,
      instagram: nonEmptyObject(json.instagram) || nonEmptyObject(composeContext.instagram) || undefined,
      threads: nonEmptyObject(json.threads) || nonEmptyObject(composeContext.threads) || undefined,
      warnings: mergedWarnings,
    });

    const finalWarnings = Array.isArray(merged.warnings) ? merged.warnings : [];
    pushUnique(finalWarnings, "prepare_request_publish_context_rehydrated_from_prepare_media_items");
    merged.warnings = finalWarnings;

    return { json: merged };
  }

  function ensureCombinedPublishContext(items) {
    const composeLookup = buildPrepareMediaLookup(safeNodeItems("Prepare Media Items"));
    const mergedItems = (Array.isArray(items) ? items : [])
      .map((item) => mergeCombinedPublishContext(item, composeLookup));

    for (const item of mergedItems) {
      const json = (item && item.json) || {};
      if (!(nonEmptyObject(json.instagram) && nonEmptyObject(json.facebook) && nonEmptyObject(json.threads))) {
        throw new Error(
          "Prepare Request bootstrap: item combinado sem contexto completo de plataforma após reidratação " +
          "(groupKey=" + str(json.groupKey, "n/a") + ", name=" + str(json.name, "n/a") + ", id=" + str(json.id, "n/a") + ")."
        );
      }
    }

    return mergedItems;
  }

  function flattenFrameCandidateItems(items) {
`,
    'Prepare Request Prepare Media Items context helpers',
  );

  patched = replaceOnce(
    patched,
    `  const uploadedMainMediaItems = safeNodeItems("Attach Uploaded Main Media Metadata");
  let c2Items = uploadedMainMediaItems.length
    ? uploadedMainMediaItems
    : selectDirectNodeItems("Attach Uploaded Main Media Metadata", directInputItems);

  const technicalFrameCandidates = flattenFrameCandidateItems(c2Items);
  const parsedFrameCandidateCount =
    technicalFrameCandidates.length ||
    countParsedFrameCandidates(c2Items) ||
    countParsedFrameCandidates(safeNodeItems("Parse Frame Analysis JSON"));
`,
    `  const uploadedMainMediaItems = safeNodeItems("Attach Uploaded Main Media Metadata");
  let c2Items = uploadedMainMediaItems.length
    ? uploadedMainMediaItems
    : selectDirectNodeItems("Attach Uploaded Main Media Metadata", directInputItems);

  c2Items = ensureCombinedPublishContext(c2Items);

  const technicalFrameCandidates = flattenFrameCandidateItems(c2Items);
  const parsedFrameCandidateCount =
    technicalFrameCandidates.length ||
    countParsedFrameCandidates(c2Items);
`,
    'Prepare Request bootstrap combined-media recovery block',
  );

  patched = replaceOnce(
    patched,
    `  function looksLikePreparedJob(value) {
    const j = normObj(value);
    return !!(
      j.phase &&
      j.publishRunIndex !== undefined &&
      j.publishRunIndex !== null &&
      j.publishRunIndex !== "" &&
      (j.url || j.httpRequest?.url)
    );
  }

  function recoverJobFromWaitOutput() {
    try {
      const paired = $("Wait").item?.json;
      if (looksLikePreparedJob(paired)) {
        return removeNulls({ ...paired, prepareRequestRecoveredFrom: "wait-item" });
      }
    } catch {}

    try {
      const waitItems = $items("Wait") || [];
      for (let i = waitItems.length - 1; i >= 0; i--) {
        const candidate = waitItems[i]?.json;
        if (looksLikePreparedJob(candidate)) {
          return removeNulls({ ...candidate, prepareRequestRecoveredFrom: "wait-items" });
        }
      }
    } catch {}

    return null;
  }

  function dequeuePostHttpJob() {
    return dequeue() || recoverJobFromWaitOutput();
  }
`,
    `  function dequeuePostHttpJob() {
    return dequeue();
  }
`,
    'Prepare Request Wait lookup recovery block',
  );

  patched = replaceOnce(
    patched,
    `    const job = dequeuePostHttpJob();
    if (!job) {
      throw new Error("Prepare Request: recebi resposta HTTP mas a fila está vazia e não consegui recuperar o job do item anterior do Wait.");
    }
`,
    `    const job = dequeuePostHttpJob();
    if (!job) {
      throw new Error("Prepare Request: recebi resposta HTTP mas a fila está vazia (sem job correspondente no cache da execução).");
    }
`,
    'Prepare Request post-http empty queue message',
  );

  if (patched.includes('Parse Frame Analysis JSON')) {
    throw new Error('Prepare Request still references Parse Frame Analysis JSON after patch');
  }

  if (patched.includes('$("Wait")') || patched.includes('$items("Wait")')) {
    throw new Error('Prepare Request still references Wait by name after patch');
  }

  if (!patched.includes('__liviaCompose1') || !patched.includes('Prepare Media Items')) {
    throw new Error('Prepare Request patch did not wire Prepare Media Items context recovery');
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
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-prepare-request-timeout-fix.${timestamp}.json`);
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
        name: 'livia-prepare-request-timeout-fix',
        appliedAt: new Date().toISOString(),
        previousVersionId: current.versionId,
        previousActiveVersionId: current.activeVersionId,
      },
    },
  };

  const prepareNode = patched.nodes.find((node) => node.name === 'Prepare Request');
  if (!prepareNode) throw new Error('Prepare Request node not found');
  if (prepareNode.type !== 'n8n-nodes-base.code') {
    throw new Error('Prepare Request is not a Code node');
  }

  prepareNode.parameters = {
    ...(prepareNode.parameters || {}),
    jsCode: patchPrepareRequest(prepareNode.parameters?.jsCode || ''),
  };

  const versionId = crypto.randomUUID();
  const updatedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const nodesJson = JSON.stringify(patched.nodes);
  const connectionsJson = JSON.stringify(patched.connections);
  const settingsJson = JSON.stringify(patched.settings || {});
  const staticDataJson = JSON.stringify(patched.staticData || {});
  const metaJson = JSON.stringify(patched.meta || {});

  db.transaction(() => {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      WORKFLOW_ID,
      'Codex',
      updatedAt,
      updatedAt,
      nodesJson,
      connectionsJson,
      patched.name,
      0,
      row.description || null,
    );

    db.prepare(`
      UPDATE workflow_entity
      SET nodes = ?,
          connections = ?,
          settings = ?,
          staticData = ?,
          meta = ?,
          versionId = ?,
          activeVersionId = ?,
          updatedAt = ?,
          versionCounter = versionCounter + 1
      WHERE id = ?
    `).run(
      nodesJson,
      connectionsJson,
      settingsJson,
      staticDataJson,
      metaJson,
      versionId,
      versionId,
      updatedAt,
      WORKFLOW_ID,
    );
  })();

  const exported = {
    ...patched,
    versionId,
    activeVersionId: versionId,
    updatedAt,
  };

  for (const exportPath of EXPORT_PATHS) {
    exportWorkflow(exported, exportPath);
  }

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
