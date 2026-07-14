#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite = require('node:sqlite');

const WORKFLOW_ID = 'touoDCdMBuIhytql';
const WORKFLOW_NAME = 'Meta Ads – Copia para o Codex Trabalhar';
const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const ROOT_DIR = path.resolve(__dirname, '..');
const AUTHORS = 'Julian Benito Garcia';
const SOURCE_DIR = path.join(ROOT_DIR, 'workflow-src', 'meta-ads-performance-report');
const BACKUP_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.before-quality-refinements.json');
const LATEST_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.latest.json');
const LIVE_CURRENT_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.live-current.json');

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function parseJson(text, fallback) {
  return text ? JSON.parse(text) : fallback;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function exportWorkflow(db) {
  const row = db.prepare(`
    SELECT id, name, active, nodes, connections, settings, staticData, pinData, versionId, meta, description
    FROM workflow_entity
    WHERE id = ?
  `).get(WORKFLOW_ID);

  if (!row) throw new Error(`Workflow ${WORKFLOW_ID} nao encontrado.`);

  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: parseJson(row.nodes, []),
    connections: parseJson(row.connections, {}),
    settings: parseJson(row.settings, {}),
    staticData: parseJson(row.staticData, null),
    pinData: parseJson(row.pinData, {}),
    versionId: row.versionId,
    meta: parseJson(row.meta, null),
    description: row.description || '',
  };
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node "${name}" nao encontrado.`);
  return node;
}

function replaceConnections(connections, sourceNode, outputs) {
  connections[sourceNode] = {
    main: outputs.map((slot) => slot.map((edge) => ({ ...edge, type: 'main' }))),
  };
}

function buildCodeNode(name, position, jsCode) {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { jsCode },
  };
}

function upsertNode(workflow, definition) {
  const index = workflow.nodes.findIndex((entry) => entry.name === definition.name);
  if (index >= 0) {
    workflow.nodes[index] = {
      ...workflow.nodes[index],
      ...definition,
      parameters: definition.parameters ?? workflow.nodes[index].parameters,
    };
    return workflow.nodes[index];
  }
  workflow.nodes.push(definition);
  return definition;
}

function patchBenchmarksCode(code) {
  const helperNeedle = "function classifyCategory(entity, score) {";
  if (!code.includes("function hasRecentActivity(entity) {")) {
    code = code.replace(helperNeedle, `function hasRecentActivity(entity) {\n  const metrics = entity.metrics || {};\n  const signals = [\n    metrics.spend,\n    metrics.impressions,\n    metrics.reach,\n    metrics.clicks,\n    metrics.linkClicks,\n    metrics.outboundClicks,\n    metrics.conversations,\n    metrics.engagement,\n    metrics.inlinePostEngagement,\n    metrics.igRedirect,\n  ];\n\n  return signals.some((value) => (toNumber(value) ?? 0) > 0);\n}\n\n${helperNeedle}`);
  }

  code = code.replace(
`function classifyCategory(entity, score) {
  const metrics = entity.metrics || {};
  const spend = toNumber(metrics.spend) ?? 0;
  const conversations = toNumber(metrics.conversations) ?? 0;
  const quality = entity.data_quality?.overall_confidence_score ?? 0;

  if (spend >= 10 && conversations === 0) return 'piores';
  if (score <= 35) return 'piores';
  if (score >= 78 && conversations > 0) return 'top_performance';

  if (
    score >= 55 &&
    (
      entity.trend?.flags?.is_accelerating ||
      (toNumber(metrics.linkCtr) ?? 0) >= 0.8 ||
      (entity.messaging_funnel?.last_24h?.reply_rate ?? 0) >= 35
    )
  ) {
    return 'oportunidades';
  }

  if (
    (entity.fatigue?.score ?? 0) >= 35 ||
    entity.trend?.flags?.is_declining ||
    quality < 70
  ) {
    return 'atencao';
  }

  return 'atencao';
}`,
`function classifyCategory(entity, score) {
  const metrics = entity.metrics || {};
  const spend = toNumber(metrics.spend) ?? 0;
  const conversations = toNumber(metrics.conversations) ?? 0;
  const quality = entity.data_quality?.overall_confidence_score ?? 0;

  if (!hasRecentActivity(entity)) return 'no_recent_activity';
  if (spend >= 10 && conversations === 0) return 'piores';
  if (score <= 35) return 'piores';
  if (score >= 78 && conversations > 0) return 'top_performance';

  if (
    score >= 55 &&
    (
      entity.trend?.flags?.is_accelerating ||
      (toNumber(metrics.linkCtr) ?? 0) >= 0.8 ||
      (entity.messaging_funnel?.last_24h?.reply_rate ?? 0) >= 35
    )
  ) {
    return 'oportunidades';
  }

  if (
    (entity.fatigue?.score ?? 0) >= 35 ||
    entity.trend?.flags?.is_declining ||
    quality < 70
  ) {
    return 'atencao';
  }

  return 'atencao';
}`);

  code = code.replace(
`function recommendAction(category, entity) {
  if (entity.confidence_gate?.should_block_aggressive_actions) {
    return 'validar coleta antes de decidir escala ou pausa';
  }

  if (category === 'top_performance') {
    if ((entity.fatigue?.score ?? 0) >= 55) {
      return 'escalar com cautela e preparar renovacao de criativo';
    }
    return 'considerar escala controlada e replicar angulo vencedor';
  }

  if (category === 'piores') {
    return 'reduzir gasto, revisar criativo/oferta e checar segmentacao';
  }

  if (category === 'oportunidades') {
    return 'manter teste com pequeno incremento e destravar etapa pos-clique';
  }

  return 'monitorar de perto e revisar saturacao, delivery ou qualidade do dado';
}`,
`function recommendAction(category, entity) {
  if (category === 'no_recent_activity') {
    return 'sem atividade recente na janela principal; manter apenas como historico';
  }

  if (entity.confidence_gate?.should_block_aggressive_actions) {
    return 'validar coleta antes de decidir escala ou pausa';
  }

  if (category === 'top_performance') {
    if ((entity.fatigue?.score ?? 0) >= 55) {
      return 'escalar com cautela e preparar renovacao de criativo';
    }
    return 'considerar escala controlada e replicar angulo vencedor';
  }

  if (category === 'piores') {
    return 'reduzir gasto, revisar criativo/oferta e checar segmentacao';
  }

  if (category === 'oportunidades') {
    return 'manter teste com pequeno incremento e destravar etapa pos-clique';
  }

  return 'monitorar de perto e revisar saturacao, delivery ou qualidade do dado';
}`);

  code = code.replace(
`function inferMainRisk(entity) {
  if (entity.confidence_gate?.level === 'blocked' || entity.confidence_gate?.level === 'restricted') {
    return 'qualidade do dado';
  }
  if ((entity.fatigue?.score ?? 0) >= 55) {
    return 'fadiga';
  }
  if (entity.trend?.flags?.is_declining) {
    return 'queda recente';
  }
  if ((entity.metrics?.spend ?? 0) > 0 && (entity.metrics?.conversations ?? 0) === 0) {
    return 'gasto sem conversa';
  }
  return 'pressao de eficiencia';
}`,
`function inferMainRisk(entity) {
  if (!hasRecentActivity(entity)) {
    return 'sem atividade recente';
  }
  if (entity.confidence_gate?.level === 'blocked' || entity.confidence_gate?.level === 'restricted') {
    return 'qualidade do dado';
  }
  if ((entity.fatigue?.score ?? 0) >= 55) {
    return 'fadiga';
  }
  if (entity.trend?.flags?.is_declining) {
    return 'queda recente';
  }
  if ((entity.metrics?.spend ?? 0) > 0 && (entity.metrics?.conversations ?? 0) === 0) {
    return 'gasto sem conversa';
  }
  return 'pressao de eficiencia';
}`);

  return code;
}

function applyChanges(workflow) {
  const dedupeNode = buildCodeNode(
    'Deduplicate Inventory Accounts',
    [80, -1320],
    fs.readFileSync(path.join(SOURCE_DIR, 'deduplicate-inventory-accounts.js'), 'utf8'),
  );
  upsertNode(workflow, dedupeNode);

  const consolidatedNode = getNode(workflow, 'Build Consolidated WhatsApp Report');
  consolidatedNode.parameters.jsCode = fs.readFileSync(
    path.join(SOURCE_DIR, 'build-consolidated-whatsapp-report.js'),
    'utf8',
  );

  const benchmarksNode = getNode(workflow, 'Build Benchmarks and Classification');
  benchmarksNode.parameters.jsCode = patchBenchmarksCode(benchmarksNode.parameters.jsCode || '');

  const getAdNode = getNode(workflow, 'Get Ad');
  getAdNode.parameters.url = "=https://graph.facebook.com/{{$json.api_version}}/act_{{$json.account_id}}/ads";

  replaceConnections(workflow.connections, 'Google Sheets', [
    [{ node: 'Deduplicate Inventory Accounts', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Deduplicate Inventory Accounts', [
    [{ node: 'Get Ad', index: 0 }],
  ]);

  return workflow;
}

function persistWorkflow(db, workflow, previous) {
  const versionId = crypto.randomUUID();
  const timestamp = nowSql();
  const nodesText = JSON.stringify(workflow.nodes);
  const connectionsText = JSON.stringify(workflow.connections);

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO workflow_history (
        versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      workflow.id,
      AUTHORS,
      timestamp,
      timestamp,
      nodesText,
      connectionsText,
      workflow.name,
      0,
      workflow.description || '',
    );

    db.prepare(`
      UPDATE workflow_entity
      SET nodes = ?, connections = ?, versionId = ?, updatedAt = ?, name = ?, description = ?
      WHERE id = ?
    `).run(
      nodesText,
      connectionsText,
      versionId,
      timestamp,
      workflow.name,
      workflow.description || '',
      workflow.id,
    );

    db.exec('COMMIT');
    return { ...workflow, versionId, previousVersionId: previous.versionId };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function main() {
  const db = new sqlite.DatabaseSync(DB_PATH);
  const current = exportWorkflow(db);

  if (current.name !== WORKFLOW_NAME) {
    throw new Error(`Workflow inesperado: ${current.name}`);
  }

  writeJson(BACKUP_PATH, current);
  const updated = applyChanges(structuredClone(current));
  const persisted = persistWorkflow(db, updated, current);
  writeJson(LATEST_PATH, persisted);
  writeJson(LIVE_CURRENT_PATH, persisted);

  console.log(JSON.stringify({
    workflowId: persisted.id,
    previousVersionId: current.versionId,
    versionId: persisted.versionId,
    backupPath: BACKUP_PATH,
    latestPath: LATEST_PATH,
    liveCurrentPath: LIVE_CURRENT_PATH,
  }, null, 2));
}

main();
