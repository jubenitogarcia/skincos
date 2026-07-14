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

function replaceRegex(source, regex, replacement, label) {
  if (!regex.test(source)) throw new Error(`Could not find ${label}`);
  return source.replace(regex, replacement);
}

function patchPrepareRequest(code) {
  let patched = code;

  patched = replaceRegex(
    patched,
    /  function safeNodeItems\(name\) \{[\s\S]*?\n  function cleanupExecutionStaticStores\(\) \{/,
    `  function namedNodeItemsFallback(name) {
    const normalizedName = str(name, "").trim();
    if (!normalizedName) return [];

    const collected = [];

    try {
      if (typeof $ === "function") {
        const ref = $(normalizedName);
        if (ref && typeof ref.all === "function") {
          collected.push(...(ref.all() || []));
        }
      }
    } catch {}

    try {
      if (typeof $items === "function") {
        collected.push(...($items(normalizedName) || []));
      }
    } catch {}

    const out = [];
    const seen = new Set();

    for (const item of collected) {
      const json = asObj((item && item.json) || item) || {};
      if (!Object.keys(json).length) continue;

      const dedupeKey = [
        str(json.id || json.mediaId || json.public_id || "", ""),
        str(json.name || json.original_filename || json.display_name || "", ""),
        str(json.groupKey || "", ""),
        str(json.secure_url || json.url || json.finalUrl || json.webContentLink || "", ""),
      ].join("|");

      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ json });
    }

    return out;
  }

  function safeNodeItems(name) {
    if (name === "Attach Uploaded Main Media Metadata") {
      const staticItems = staticStoreItems(getExecutionStaticStore("__liviaMainUploads"));
      return staticItems.length ? staticItems : namedNodeItemsFallback(name);
    }

    if (name === "Prepare Media Items") {
      const staticItems = staticStoreItems(getExecutionStaticStore("__liviaCompose1"));
      return staticItems.length ? staticItems : namedNodeItemsFallback(name);
    }

    if (name === "Get Credential Tokens") {
      return namedNodeItemsFallback(name);
    }

    return [];
  }

  function cleanupExecutionStaticStores() {`,
    'Prepare Request safeNodeItems replacement',
  );

  patched = replaceRegex(
    patched,
    /  function selectDirectNodeItems\(name, directItems\) \{[\s\S]*?\n  function flattenFrameCandidateItems\(items\) \{/,
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

  function normalizeTokenVaultUnit(raw) {
    const compact = str(raw, "")
      .trim()
      .toUpperCase()
      .replace(/\\s+/g, "")
      .replace(/[_-]/g, "");

    if (compact.includes("BARRA") && compact.includes("SUL")) return "bss";
    if (compact === "BARRASHOPPINGSUL" || compact === "BSS") return "bss";
    if (compact.includes("NOVO") && compact.includes("HAMBURGO")) return "nh";
    if (compact === "NOVOHAMBURGO" || compact === "NH") return "nh";
    return "";
  }

  let cachedTokenVaultPublishContext = null;

  function buildPublishContextFromTokenVault() {
    if (cachedTokenVaultPublishContext) return cachedTokenVaultPublishContext;

    const root = asObj(((safeNodeItems("Get Credential Tokens")[0] || {}).json) || {}) || {};
    const tokens = Array.isArray(root.items) ? root.items : [];
    const byUnit = {
      bss: { Unit: "BSS" },
      nh: { Unit: "NH" },
    };

    for (const token of tokens) {
      if (!token || token.active === false) continue;
      const unitKey = normalizeTokenVaultUnit(token.unit || deepGet(token, "metadata.legacy_columns.Unit", ""));
      if (!unitKey || !byUnit[unitKey]) continue;

      if (token.provider === "facebook") {
        byUnit[unitKey].fbId = str(token.fbId || token.external_account_id, "");
        byUnit[unitKey].fbToken = str(token.fbToken || token.token, "");
      } else if (token.provider === "instagram") {
        byUnit[unitKey].igId = str(token.igId || token.external_account_id, "");
        byUnit[unitKey].igToken = str(token.igToken || token.token, "");
      } else if (token.provider === "threads") {
        byUnit[unitKey].thId = str(token.thId || token.external_account_id, "");
        byUnit[unitKey].thToken = str(token.thToken || token.token, "");
      }
    }

    cachedTokenVaultPublishContext = {
      facebook: {
        network: "facebook.com",
        version: "v24.0",
        id_bss: str(byUnit.bss.fbId, ""),
        id_nh: str(byUnit.nh.fbId, ""),
        token_bss: str(byUnit.bss.fbToken, ""),
        token_nh: str(byUnit.nh.fbToken, ""),
        endpoint_1st: "",
        endpoint_2nd: "feed",
      },
      instagram: {
        network: "facebook.com",
        version: "v24.0",
        id_bss: str(byUnit.bss.igId, ""),
        id_nh: str(byUnit.nh.igId, ""),
        token_bss: str(byUnit.bss.igToken, ""),
        token_nh: str(byUnit.nh.igToken, ""),
        endpoint_1st: "media",
        endpoint_2nd: "media_publish",
      },
      threads: {
        network: "threads.net",
        version: "v1.0",
        id_bss: str(byUnit.bss.thId, ""),
        id_nh: str(byUnit.nh.thId, ""),
        token_bss: str(byUnit.bss.thToken, ""),
        token_nh: str(byUnit.nh.thToken, ""),
        endpoint_1st: "threads",
        endpoint_2nd: "threads_publish",
        use_me: true,
      },
    };

    return cachedTokenVaultPublishContext;
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
    const tokenVaultContext = buildPublishContextFromTokenVault();
    const mergedWarnings = [];

    for (const warning of Array.isArray(composeContext.warnings) ? composeContext.warnings : []) {
      pushUnique(mergedWarnings, warning);
    }

    for (const warning of Array.isArray(json.warnings) ? json.warnings : []) {
      pushUnique(mergedWarnings, warning);
    }

    if (!Object.keys(composeContext).length) {
      pushUnique(mergedWarnings, "prepare_request_publish_context_lookup_failed");
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
      facebook: nonEmptyObject(json.facebook) || nonEmptyObject(composeContext.facebook) || nonEmptyObject(tokenVaultContext.facebook) || undefined,
      instagram: nonEmptyObject(json.instagram) || nonEmptyObject(composeContext.instagram) || nonEmptyObject(tokenVaultContext.instagram) || undefined,
      threads: nonEmptyObject(json.threads) || nonEmptyObject(composeContext.threads) || nonEmptyObject(tokenVaultContext.threads) || undefined,
      warnings: mergedWarnings,
    });

    const finalWarnings = Array.isArray(merged.warnings) ? merged.warnings : [];
    pushUnique(finalWarnings, "prepare_request_publish_context_rehydrated_from_prepare_media_items");

    if (
      !(nonEmptyObject(json.facebook) || nonEmptyObject(composeContext.facebook)) ||
      !(nonEmptyObject(json.instagram) || nonEmptyObject(composeContext.instagram)) ||
      !(nonEmptyObject(json.threads) || nonEmptyObject(composeContext.threads))
    ) {
      pushUnique(finalWarnings, "prepare_request_publish_context_rehydrated_from_token_vault");
    }

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

  function flattenFrameCandidateItems(items) {`,
    'Prepare Request publish-context helper replacement',
  );

  if (patched.includes('$("Wait")') || patched.includes('$items("Wait")')) {
    throw new Error('Prepare Request still references Wait by name');
  }

  if (!patched.includes('namedNodeItemsFallback')) {
    throw new Error('Prepare Request patch did not add named node fallback');
  }

  if (!patched.includes('Get Credential Tokens')) {
    throw new Error('Prepare Request patch did not wire Token Vault fallback');
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
  const backupPath = path.join(__dirname, '..', 'workflows', `livia.before-prepare-request-live-bootstrap-fallback.${timestamp}.json`);
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
        name: 'livia-prepare-request-live-bootstrap-fallback',
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
