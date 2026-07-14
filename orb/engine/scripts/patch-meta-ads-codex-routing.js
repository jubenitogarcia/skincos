const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite = require('node:sqlite');

const WORKFLOW_ID = 'touoDCdMBuIhytql';
const WORKFLOW_NAME = 'Meta Ads – Copia para o Codex Trabalhar';
const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const AUTHORS = 'Julian Benito Garcia';
const ROOT_DIR = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.latest.json');
const BACKUP_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.before-routing-refactor.json');

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function readJson(text, fallback) {
  if (!text) return fallback;
  return JSON.parse(text);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) {
    throw new Error(`Node "${name}" nao encontrado em ${workflow.name}.`);
  }
  return node;
}

function upsertNode(workflow, definition) {
  const index = workflow.nodes.findIndex((item) => item.name === definition.name);
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

function ensureOutgoingSlot(connections, nodeName, outputIndex) {
  if (!connections[nodeName]) connections[nodeName] = { main: [] };
  if (!Array.isArray(connections[nodeName].main)) connections[nodeName].main = [];
  while (connections[nodeName].main.length <= outputIndex) {
    connections[nodeName].main.push([]);
  }
  if (!Array.isArray(connections[nodeName].main[outputIndex])) {
    connections[nodeName].main[outputIndex] = [];
  }
  return connections[nodeName].main[outputIndex];
}

function setConnection(connections, sourceNode, outputIndex, targetNode, inputIndex = 0) {
  const slot = ensureOutgoingSlot(connections, sourceNode, outputIndex);
  const filtered = slot.filter((edge) => !(edge.node === targetNode && edge.index === inputIndex && edge.type === 'main'));
  filtered.push({ node: targetNode, type: 'main', index: inputIndex });
  connections[sourceNode].main[outputIndex] = filtered;
}

function replaceConnections(connections, sourceNode, outputs) {
  connections[sourceNode] = {
    main: outputs.map((slot) => slot.map((edge) => ({ ...edge, type: 'main' }))),
  };
}

function removeConnection(connections, sourceNode, targetNode) {
  if (!connections[sourceNode] || !Array.isArray(connections[sourceNode].main)) return;
  connections[sourceNode].main = connections[sourceNode].main.map((slot) =>
    Array.isArray(slot) ? slot.filter((edge) => edge.node !== targetNode) : slot,
  );
}

function buildDecideGroupRouteCode() {
  return String.raw`const ROUTE_VERSION = 'v2';

function s(v) { return v == null ? '' : String(v).trim(); }
function a(v) { return Array.isArray(v) ? v : []; }
function n(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const normalized = String(v).trim().replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
function low(v) { return s(v).toLowerCase(); }

function hasVisualSignal(entity) {
  return !!(
    entity?.media?.real_asset_available_for_download ||
    entity?.media?.has_preview_link ||
    entity?.media?.has_instagram_permalink ||
    entity?.media?.resolved_from_thumbnail_only ||
    entity?.visual?.evidence_level ||
    entity?.visual?.visual_status
  );
}

function hasCreativeUncertainty(entity) {
  const reasons = a(entity?.meta?.ai_importance_reasons).map(low);
  return !!(
    entity?.flags?.requires_subjective_ai_review ||
    reasons.includes('conflito_de_oferta') ||
    reasons.includes('copy_pouco_coerente') ||
    reasons.includes('fadiga_criativa') ||
    reasons.includes('sinal_visual_relevante')
  );
}

function pickVisualAssetRef(entity) {
  return {
    entity_id: s(entity?.identity?.entity_id),
    creative_id: s(entity?.identity?.creative_id || entity?.creative?.creative_id),
    primary_image_hash: s(entity?.creative?.primary_image_hash || entity?.media?.primary_image_hash),
    visual_status: s(entity?.visual?.visual_status),
    source_type: hasVisualSignal(entity) ? 'entity_visual_signal' : 'not_available',
  };
}

function buildIdempotencyKey(group, messageType, remoteJid) {
  return [
    'metaads',
    ROUTE_VERSION,
    s(group.report_date),
    s(group.account_id),
    s(group.group_id),
    s(messageType),
    s(remoteJid) || 'no-recipient',
  ].join(':');
}

return items.map((item) => {
  const group = item.json || {};
  const entities = a(group.entities);
  const category = s(group.category);
  const entityType = s(group.entity_type);
  const selectedCount = n(group?.selection_summary?.selected_count) ?? entities.length;

  const deliveryPolicy = {
    send_top_performance: false,
    ai_for_ad_level: true,
    send_categories: ['piores', 'oportunidades', 'atencao'],
    default_instance_name: 'crm-channel-1',
    default_remote_jid: '555195103563',
    ...(group.delivery_policy || {}),
  };

  const remoteJid =
    s(group?.delivery_target?.remote_jid) ||
    s(group.remote_jid) ||
    s(group.whatsapp_target) ||
    s(deliveryPolicy.default_remote_jid);

  const instanceName =
    s(group?.delivery_target?.instance_name) ||
    s(group.instance_name) ||
    s(deliveryPolicy.default_instance_name);

  const visualSignals = entities.filter(hasVisualSignal).length;
  const creativeUncertainty = entities.filter(hasCreativeUncertainty).length;
  const lowConfidence =
    (n(group?.pipeline_audit?.low_confidence_windows) ?? 0) > 0 ||
    entities.some((entity) => {
      const label =
        low(entity?.data_quality?.overall_confidence_label) ||
        low(entity?.data_quality?.confidence_label);
      return ['baixa', 'critica', 'low', 'critical'].includes(label);
    });

  const incomplete = ['partial', 'incomplete'].includes(low(group?.pipeline_audit?.report_completeness));

  let route = 'persist_only';
  let messageType = 'store_only';
  let reason = 'default_persist_only';
  const reasons = [];
  let requiresAiReview = false;
  let shouldSendWhatsapp = false;

  if (!s(group.group_id) || !s(group.account_id) || !s(group.report_date) || selectedCount <= 0) {
    route = 'fallback_noop';
    messageType = 'noop';
    reason = 'missing_required_group_keys';
    reasons.push('missing_group_id_or_account_id_or_report_date_or_entities');
  } else if (!deliveryPolicy.send_top_performance && category === 'top_performance') {
    route = 'persist_only';
    messageType = 'store_only';
    reason = 'top_performance_is_not_notified';
    reasons.push('top_performance');
  } else if (incomplete || lowConfidence) {
    route = 'persist_only';
    messageType = 'store_only';
    reason = 'insufficient_confidence_for_delivery';
    reasons.push(incomplete ? 'report_incomplete' : 'low_confidence');
  } else if (
    deliveryPolicy.ai_for_ad_level &&
    entityType === 'ad' &&
    ['piores', 'oportunidades'].includes(category) &&
    (visualSignals > 0 || creativeUncertainty > 0)
  ) {
    route = 'subjective_ai_review';
    messageType = 'creative_subjective_review';
    reason = 'ad_level_group_requires_subjective_review';
    reasons.push('ad_level', category, 'visual_signals:' + visualSignals, 'creative_uncertainty:' + creativeUncertainty);
    requiresAiReview = true;
    shouldSendWhatsapp = true;
  } else if (deliveryPolicy.send_categories.includes(category)) {
    route = 'direct_math_whatsapp';
    messageType = 'math_summary_alert';
    reason = 'quantitative_context_is_sufficient';
    reasons.push('direct_math_summary');
    shouldSendWhatsapp = true;
  }

  if (shouldSendWhatsapp && (!remoteJid || !instanceName)) {
    route = 'persist_only';
    messageType = 'store_only';
    reason = 'missing_delivery_target';
    reasons.push('missing_remote_jid_or_instance_name');
    requiresAiReview = false;
    shouldSendWhatsapp = false;
  }

  const visualAssetRef = pickVisualAssetRef(entities[0] || {});
  const idempotencyKey = buildIdempotencyKey(group, messageType, remoteJid);

  return {
    json: {
      ...group,
      route,
      message_type: messageType,
      requires_ai_review: requiresAiReview,
      should_send_whatsapp: shouldSendWhatsapp,
      should_persist: true,
      idempotency_key: idempotencyKey,
      delivery_target: {
        instance_name: instanceName,
        remote_jid: remoteJid,
      },
      visual_asset_ref: visualAssetRef,
      route_decision: {
        route,
        reason,
        reasons,
        requires_ai_review: requiresAiReview,
        should_send_whatsapp: shouldSendWhatsapp,
        should_persist: true,
        switch_key: route,
        route_version: ROUTE_VERSION,
        visual_signal_count: visualSignals,
        creative_uncertainty_count: creativeUncertainty,
      },
      audit_trace: {
        ...(group.audit_trace || {}),
        route_node: 'Decide Group Route',
        route_version: ROUTE_VERSION,
      },
    },
    binary: item.binary || {},
  };
});`;
}

function buildDirectWhatsappCode() {
  return String.raw`function s(v) { return v == null ? '' : String(v).trim(); }
function a(v) { return Array.isArray(v) ? v : []; }
function n(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const normalized = String(v).trim().replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
function round2(v) {
  const value = n(v);
  return value === null ? null : Math.round(value * 100) / 100;
}
function formatNumber(v) {
  const value = n(v);
  if (value === null) return '';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
}
function formatBRL(v) {
  const value = n(v);
  if (value === null) return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value);
}
function buildEntitySection(entity, index) {
  const identity = entity?.identity || {};
  const analysis = entity?.analysis || {};
  const metrics = entity?.metrics || {};
  const dataQuality = entity?.data_quality || {};
  const lines = [];
  const title = s(identity.name || identity.entity_id || String(index + 1));
  lines.push('*' + (index + 1) + '. ' + title + '*');

  const metricParts = [];
  if (n(metrics.spend) !== null) metricParts.push('Gasto ' + formatBRL(metrics.spend));
  if (n(metrics.conversations) !== null) metricParts.push('Conversas ' + formatNumber(metrics.conversations));
  if (n(metrics.avgCostConversation) !== null) metricParts.push('CPA ' + formatBRL(metrics.avgCostConversation));
  if (metricParts.length) lines.push(metricParts.join(' | '));

  if (s(analysis.headline)) lines.push(s(analysis.headline));
  if (s(analysis.recommended_action)) lines.push('Ação: ' + s(analysis.recommended_action) + '.');

  const confidenceLabel = s(dataQuality.overall_confidence_label || dataQuality.confidence_label);
  const confidenceScore = round2(dataQuality.overall_confidence_score || dataQuality.confidence_score);
  if (confidenceLabel || confidenceScore !== null) {
    lines.push(('Confiança do dado: ' + [confidenceLabel, confidenceScore !== null ? String(confidenceScore) + '/100' : ''].filter(Boolean).join(' ')).trim());
  }

  return lines.filter(Boolean).join('\n');
}

return items.map((item) => {
  const source = item.json || {};
  const entities = a(source.entities).slice(0, 3);
  const title = ['*META ADS*', s(source.entity_type).toUpperCase(), s(source.category).toUpperCase()].filter(Boolean).join(' | ');
  const accountLine = s(source.account_name || source.account_id) ? 'Conta: ' + s(source.account_name || source.account_id) : '';
  const groupLine = s(source.group_id) ? 'Grupo: ' + s(source.group_id) : '';
  const routeLine = 'Rota: resumo matemático direto';

  const sections = [title, accountLine, groupLine, routeLine].filter(Boolean);
  if (entities.length) {
    sections.push(entities.map((entity, index) => buildEntitySection(entity, index)).join('\n\n'));
  } else {
    sections.push('Nenhuma entidade elegível foi encontrada para mensagem direta.');
  }

  sections.push('Chave de envio: ' + s(source.idempotency_key));

  const text = sections.filter(Boolean).join('\n\n').trim();

  return {
    json: {
      ...source,
      route: 'send_whatsapp',
      whatsapp: {
        ready: Boolean(text),
        text,
        short_text: text,
        sections,
      },
      whatsapp_text: text,
      whatsapp_short_text: text,
      ready_for_whatsapp: Boolean(text),
    },
    binary: item.binary || {},
  };
});`;
}

function buildPrepareEvolutionPayloadCode() {
  return String.raw`function s(v) { return v == null ? '' : String(v).trim(); }

return items.map((item) => {
  const source = item.json || {};
  const messageText = s(source?.whatsapp?.text || source.whatsapp_text || source.message_text);
  const readyForWhatsapp = Boolean(
    source.ready_for_whatsapp === true ||
    source?.whatsapp?.ready === true ||
    (source.should_send_whatsapp === true && messageText)
  );

  const instanceName = s(source?.delivery_target?.instance_name || source.instance_name || 'crm-channel-1');
  const remoteJid = s(source?.delivery_target?.remote_jid || source.remote_jid || '555195103563');

  return {
    json: {
      ...source,
      route: 'prepared_evolution_delivery',
      ready_for_whatsapp: readyForWhatsapp,
      evolution_instance_name: instanceName,
      evolution_remote_jid: remoteJid,
      evolution_message_text: messageText,
      delivery_payload: {
        instance_name: instanceName,
        remote_jid: remoteJid,
        message_text: messageText,
        idempotency_key: s(source.idempotency_key),
        message_type: s(source.message_type),
      },
    },
    binary: item.binary || {},
  };
});`;
}

function buildRouteOutcomeCode(status) {
  return String.raw`return items.map((item) => ({
  json: {
    ...(item.json || {}),
    route_status: '${status}',
  },
  binary: item.binary || {},
}));`;
}

function buildSwitchNode() {
  return {
    id: crypto.randomUUID(),
    name: 'Switch Group Route',
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.4,
    position: [272, -672],
    parameters: {
      rules: {
        values: [
          {
            conditions: {
              options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 3,
              },
              conditions: [
                {
                  id: crypto.randomUUID(),
                  leftValue: '={{$json.route_decision.switch_key}}',
                  rightValue: 'subjective_ai_review',
                  operator: {
                    type: 'string',
                    operation: 'equals',
                    name: 'filter.operator.equals',
                  },
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'Subjective AI',
          },
          {
            conditions: {
              options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 3,
              },
              conditions: [
                {
                  id: crypto.randomUUID(),
                  leftValue: '={{$json.route_decision.switch_key}}',
                  rightValue: 'direct_math_whatsapp',
                  operator: {
                    type: 'string',
                    operation: 'equals',
                    name: 'filter.operator.equals',
                  },
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'Direct WhatsApp',
          },
          {
            conditions: {
              options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 3,
              },
              conditions: [
                {
                  id: crypto.randomUUID(),
                  leftValue: '={{$json.route_decision.switch_key}}',
                  rightValue: 'persist_only',
                  operator: {
                    type: 'string',
                    operation: 'equals',
                    name: 'filter.operator.equals',
                  },
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'Persist Only',
          },
          {
            conditions: {
              options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 3,
              },
              conditions: [
                {
                  id: crypto.randomUUID(),
                  leftValue: '={{$json.route_decision.switch_key}}',
                  rightValue: 'fallback_noop',
                  operator: {
                    type: 'string',
                    operation: 'equals',
                    name: 'filter.operator.equals',
                  },
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'Fallback',
          },
        ],
      },
      options: {},
    },
  };
}

function buildIfShouldSendNode() {
  return {
    id: crypto.randomUUID(),
    name: 'Should Send WhatsApp',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [1392, -768],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2,
        },
        conditions: [
          {
            id: crypto.randomUUID(),
            leftValue: "={{ $json.ready_for_whatsapp === true && !!String($json.evolution_message_text || '').trim() && !!String($json.evolution_remote_jid || '').trim() && !!String($json.evolution_instance_name || '').trim() }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  };
}

function buildCodeNode(name, position, jsCode) {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: {
      jsCode,
    },
  };
}

function patchWorkflow(workflow) {
  getNode(workflow, 'Build Grouped Outputs');
  getNode(workflow, 'Prepare AI Review Inputs');
  getNode(workflow, 'Livia');
  getNode(workflow, 'Normalize Agent Output');
  getNode(workflow, 'Send Report');

  upsertNode(workflow, buildCodeNode('Decide Group Route', [48, -672], buildDecideGroupRouteCode()));
  upsertNode(workflow, buildSwitchNode());
  upsertNode(workflow, buildCodeNode('Build Direct WhatsApp Summary', [496, -640], buildDirectWhatsappCode()));
  upsertNode(workflow, buildCodeNode('Route Outcome - Persist Only', [496, -448], buildRouteOutcomeCode('persist_only_completed')));
  upsertNode(workflow, buildCodeNode('Route Outcome - Fallback', [496, -256], buildRouteOutcomeCode('fallback_noop_completed')));
  upsertNode(workflow, buildCodeNode('Prepare Evolution Payload', [1168, -768], buildPrepareEvolutionPayloadCode()));
  upsertNode(workflow, buildIfShouldSendNode());
  upsertNode(workflow, buildCodeNode('Route Outcome - Delivery Skipped', [1616, -640], buildRouteOutcomeCode('delivery_skipped')));

  const prepareAi = getNode(workflow, 'Prepare AI Review Inputs');
  prepareAi.position = [496, -896];

  const livia = getNode(workflow, 'Livia');
  livia.position = [720, -896];

  const normalizeAgent = getNode(workflow, 'Normalize Agent Output');
  normalizeAgent.position = [944, -896];

  const sendReport = getNode(workflow, 'Send Report');
  sendReport.position = [1616, -896];
  sendReport.parameters = {
    ...(sendReport.parameters || {}),
    instanceName: '={{$json.evolution_instance_name}}',
    remoteJid: '={{$json.evolution_remote_jid}}',
    messageText: '={{$json.evolution_message_text}}',
  };

  removeConnection(workflow.connections, 'Build Grouped Outputs', 'Prepare AI Review Inputs');
  removeConnection(workflow.connections, 'Normalize Agent Output', 'Send Report');

  replaceConnections(workflow.connections, 'Build Grouped Outputs', [
    [{ node: 'Decide Group Route', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Decide Group Route', [
    [{ node: 'Switch Group Route', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Switch Group Route', [
    [{ node: 'Prepare AI Review Inputs', index: 0 }],
    [{ node: 'Build Direct WhatsApp Summary', index: 0 }],
    [{ node: 'Route Outcome - Persist Only', index: 0 }],
    [{ node: 'Route Outcome - Fallback', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Prepare AI Review Inputs', [
    [{ node: 'Livia', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Livia', [
    [{ node: 'Normalize Agent Output', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Normalize Agent Output', [
    [{ node: 'Prepare Evolution Payload', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Build Direct WhatsApp Summary', [
    [{ node: 'Prepare Evolution Payload', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Prepare Evolution Payload', [
    [{ node: 'Should Send WhatsApp', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Should Send WhatsApp', [
    [{ node: 'Send Report', index: 0 }],
    [{ node: 'Route Outcome - Delivery Skipped', index: 0 }],
  ]);

  return workflow;
}

function exportWorkflow(db, workflowId) {
  const row = db.prepare(`
    SELECT id, name, active, nodes, connections, settings, staticData, pinData, versionId, meta, description
    FROM workflow_entity
    WHERE id = ?
  `).get(workflowId);

  if (!row) {
    throw new Error(`Workflow ${workflowId} nao encontrado no banco.`);
  }

  return {
    id: row.id,
    name: row.name,
    active: row.active,
    nodes: readJson(row.nodes, []),
    connections: readJson(row.connections, {}),
    settings: readJson(row.settings, {}),
    staticData: readJson(row.staticData, null),
    pinData: readJson(row.pinData, {}),
    versionId: row.versionId,
    meta: readJson(row.meta, null),
    description: row.description || '',
  };
}

function persistWorkflow(db, workflow, previous) {
  const newVersionId = crypto.randomUUID();
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
      newVersionId,
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
      newVersionId,
      timestamp,
      workflow.name,
      workflow.description || '',
      workflow.id,
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    ...workflow,
    versionId: newVersionId,
    previousVersionId: previous.versionId,
  };
}

function main() {
  const db = new sqlite.DatabaseSync(DB_PATH);
  const current = exportWorkflow(db, WORKFLOW_ID);
  if (current.name !== WORKFLOW_NAME) {
    throw new Error(`Workflow ${WORKFLOW_ID} nao corresponde ao nome esperado. Recebi: ${current.name}`);
  }

  writeJson(BACKUP_PATH, current);
  const patched = patchWorkflow(JSON.parse(JSON.stringify(current)));
  const saved = persistWorkflow(db, patched, current);
  writeJson(SNAPSHOT_PATH, saved);

  console.log(JSON.stringify({
    workflowId: saved.id,
    workflowName: saved.name,
    previousVersionId: current.versionId,
    newVersionId: saved.versionId,
    backupPath: BACKUP_PATH,
    snapshotPath: SNAPSHOT_PATH,
    nodeCount: saved.nodes.length,
  }, null, 2));
}

main();
