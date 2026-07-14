const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite = require('node:sqlite');

const WORKFLOW_ID = 'touoDCdMBuIhytql';
const WORKFLOW_NAME = 'Meta Ads – Copia para o Codex Trabalhar';
const DB_PATH = '/Users/jubenitogarcia/.n8n/database.sqlite';
const AUTHORS = 'Julian Benito Garcia';
const ROOT_DIR = path.resolve(__dirname, '..');
const ORIGINAL_SNAPSHOT_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.pre-consolidated-refactor.json');
const BACKUP_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.before-consolidated-report.json');
const SNAPSHOT_PATH = path.join(ROOT_DIR, 'workflows', 'meta-ads.codex-working.touoDCdMBuIhytql.latest.json');

function nowSql() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  return JSON.parse(text);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function getNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node "${name}" nao encontrado.`);
  return node;
}

function getFirstNode(workflow, names) {
  for (const name of names) {
    const node = workflow.nodes.find((entry) => entry.name === name);
    if (node) return node;
  }
  throw new Error(`Nenhum dos nodes esperados foi encontrado: ${names.join(', ')}`);
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

function removeNodes(workflow, names) {
  const removeSet = new Set(names);
  workflow.nodes = workflow.nodes.filter((node) => !removeSet.has(node.name));
  for (const sourceName of Object.keys(workflow.connections || {})) {
    if (removeSet.has(sourceName)) {
      delete workflow.connections[sourceName];
      continue;
    }
    const source = workflow.connections[sourceName];
    if (!source || !Array.isArray(source.main)) continue;
    source.main = source.main.map((slot) =>
      Array.isArray(slot) ? slot.filter((edge) => !removeSet.has(edge.node)) : slot
    );
  }
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

function buildIfNode(name, position, leftValueExpression) {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position,
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
            leftValue: leftValueExpression,
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

function buildMergeNode(name, position) {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'n8n-nodes-base.merge',
    typeVersion: 3.2,
    position,
    parameters: {
      mode: 'append',
      numberInputs: 2,
      options: {},
    },
  };
}

function patchBuildDeliveryEntitiesCode(code) {
  const helperInsert = String.raw`

function buildEntityVisualAssetRef(entity) {
  return compactObject({
    entity_type: safeString(entity?.entity_type),
    entity_id: safeString(entity?.identity?.entity_id),
    creative_id: safeString(entity?.identity?.creative_id || entity?.creative?.creative_id),
    primary_image_hash: safeString(entity?.visual?.primary_image_hash || entity?.media?.binary_attachment_key),
    visual_status: safeString(entity?.visual?.visual_status),
    source_type:
      entity?.media?.has_true_creative_image ? 'direct_visual' :
      entity?.media?.resolved_from_thumbnail_only ? 'thumbnail_only' :
      entity?.media?.preview_shareable_link || entity?.media?.instagram_permalink_url ? 'indirect_visual' :
      'not_available',
  });
}

function buildEntityGroupSeedKey(entity) {
  return [
    safeString(entity?.account?.report_date),
    safeString(entity?.account?.account_id),
    safeString(entity?.entity_type),
    safeString(entity?.identity?.entity_id || entity?.creative?.creative_id),
    safeString(entity?.category),
  ].filter(Boolean).join('::');
}

function buildCreativeEntityFromBase(entity) {
  const creativeId = safeString(entity?.identity?.creative_id || entity?.creative?.creative_id);
  if (!creativeId) return null;

  const creativeName =
    safeString(entity?.creative?.creative_name_display) ||
    safeString(entity?.visual?.creative_name) ||
    creativeId;

  const cloned = deepClone(entity);
  cloned.entity_type = 'creative';
  cloned.meta = compactObject({
    ...(cloned.meta || {}),
    entity_type: 'creative',
    entity_label: 'criativo',
    entity_label_singular: 'CRIATIVO',
    entity_label_plural: 'CRIATIVOS',
    metrics_group_key: 'creative:' + creativeId,
  });
  cloned.identity = compactObject({
    ...(cloned.identity || {}),
    entity_id: creativeId,
    name: creativeName,
    creative_id: creativeId,
    source_ad_id: safeString(entity?.identity?.ad_id || entity?.identity?.entity_id),
  });
  cloned.visual_asset_ref = buildEntityVisualAssetRef(cloned);
  cloned.group_seed_key = buildEntityGroupSeedKey(cloned);
  return compactObject(cloned);
}
`;

  let next = code.replace('const inputItems = $input.all();', `${helperInsert}\nconst inputItems = $input.all();`);

  const loopNeedle = String.raw`for (const analyticsEntity of flattened) {
  const dedupKey = buildEntityDedupKey(analyticsEntity);
  if (usedKeys.has(dedupKey)) continue;
  usedKeys.add(dedupKey);

  const sourceBundle = resolveSourceEntityForAnalytics(analyticsEntity, sourceIndexes);
  const built = buildSlimEntity(analyticsEntity, sourceBundle);
  flatEntities.push(built);
}
`;

  const loopReplacement = String.raw`for (const analyticsEntity of flattened) {
  const dedupKey = buildEntityDedupKey(analyticsEntity);
  if (usedKeys.has(dedupKey)) continue;
  usedKeys.add(dedupKey);

  const sourceBundle = resolveSourceEntityForAnalytics(analyticsEntity, sourceIndexes);
  const built = buildSlimEntity(analyticsEntity, sourceBundle);
  flatEntities.push(built);
}

const creativeEntities = [];
const creativeKeys = new Set();
for (const entity of flatEntities) {
  const entityWithRefs = compactObject({
    ...entity,
    visual_asset_ref: buildEntityVisualAssetRef(entity),
    group_seed_key: buildEntityGroupSeedKey(entity),
  });
  Object.assign(entity, entityWithRefs);

  if (safeString(entity?.entity_type) !== 'ad') continue;
  const creativeEntity = buildCreativeEntityFromBase(entity);
  if (!creativeEntity) continue;
  const creativeKey = buildEntityGroupSeedKey(creativeEntity);
  if (!creativeKey || creativeKeys.has(creativeKey)) continue;
  creativeKeys.add(creativeKey);
  creativeEntities.push(creativeEntity);
}

flatEntities.push(...creativeEntities);
`;
  next = next.replace(loopNeedle, loopReplacement);

  next = next.replace(
    String.raw`    entities: {
      campaigns: flatEntities.filter((entity) => safeString(entity.entity_type) === 'campaign'),
      adsets: flatEntities.filter((entity) => safeString(entity.entity_type) === 'adset'),
      ads: flatEntities.filter((entity) => safeString(entity.entity_type) === 'ad'),
    },
    flat_entities: flatEntities,`,
    String.raw`    entities: {
      campaigns: flatEntities.filter((entity) => safeString(entity.entity_type) === 'campaign'),
      adsets: flatEntities.filter((entity) => safeString(entity.entity_type) === 'adset'),
      ads: flatEntities.filter((entity) => safeString(entity.entity_type) === 'ad'),
      creatives: flatEntities.filter((entity) => safeString(entity.entity_type) === 'creative'),
    },
    flat_entities: flatEntities,
    counts: compactObject({
      ...(input.counts || {}),
      creatives: flatEntities.filter((entity) => safeString(entity.entity_type) === 'creative').length,
      total: safeArray(flatEntities).length,
    }),`
  );

  return next;
}

function buildGroupedOutputsCode() {
  return String.raw`const MAX_ITEMS_PER_CATEGORY = 3;
const CATEGORY_ORDER = ['top_performance', 'atencao', 'piores', 'oportunidades'];
const ENTITY_ORDER = ['campaign', 'adset', 'ad', 'creative'];

function s(v) { return v == null ? '' : String(v).trim(); }
function a(v) { return Array.isArray(v) ? v : []; }
function o(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
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
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function compactValue(value) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const out = value.map(compactValue).filter((item) => item !== undefined);
    return out.length ? out : undefined;
  }
  if (o(value)) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const compacted = compactValue(inner);
      if (compacted !== undefined) out[key] = compacted;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return value;
}
function compactObject(value) {
  return compactValue(value) || {};
}
function cloneBinary(binary) {
  if (!binary || typeof binary !== 'object' || !Object.keys(binary).length) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(binary)) out[key] = { ...value };
  return out;
}
function collectBinary(items) {
  const out = {};
  for (let i = 0; i < a(items).length; i += 1) {
    const binary = cloneBinary(items[i]?.binary);
    if (!binary) continue;
    for (const [key, value] of Object.entries(binary)) {
      let targetKey = key;
      let counter = 2;
      while (out[targetKey]) {
        targetKey = key + '_' + counter;
        counter += 1;
      }
      out[targetKey] = { ...value };
    }
  }
  return Object.keys(out).length ? out : undefined;
}
function formatBRL(v) {
  const value = n(v);
  if (value === null) return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value);
}
function buildMathBlock(group) {
  const entities = a(group.entities);
  const first = entities[0] || {};
  return compactObject({
    category: s(group.category),
    entity_type: s(group.entity_type),
    entity_count_total: entities.length,
    selected_count: n(group.selection_summary?.selected_count) ?? entities.length,
    top_headlines: entities.map((entity) => s(entity.analysis?.headline)).filter(Boolean).slice(0, 3),
    top_actions: entities.map((entity) => s(entity.analysis?.recommended_action)).filter(Boolean).slice(0, 3),
    key_metrics: {
      spend: n(first.metrics?.spend),
      conversations: n(first.metrics?.conversations),
      avg_cost_conversation: n(first.metrics?.avgCostConversation),
      ctr: n(first.metrics?.ctr),
      link_ctr: n(first.metrics?.linkCtr),
    },
  });
}
function sortEntities(category, entities) {
  const list = [...a(entities)];
  list.sort((left, right) => {
    const leftScore = n(left.analysis?.score) ?? -999;
    const rightScore = n(right.analysis?.score) ?? -999;
    const leftPriority = n(left.analysis?.priority_score) ?? -999;
    const rightPriority = n(right.analysis?.priority_score) ?? -999;
    const leftConv = n(left.metrics?.conversations) ?? -999;
    const rightConv = n(right.metrics?.conversations) ?? -999;
    const leftCpa = n(left.metrics?.avgCostConversation) ?? Number.POSITIVE_INFINITY;
    const rightCpa = n(right.metrics?.avgCostConversation) ?? Number.POSITIVE_INFINITY;

    if (category === 'top_performance') {
      if (rightScore !== leftScore) return rightScore - leftScore;
      if (rightConv !== leftConv) return rightConv - leftConv;
      return leftCpa - rightCpa;
    }

    if (category === 'piores' || category === 'atencao') {
      if (rightPriority !== leftPriority) return rightPriority - leftPriority;
      if (leftScore !== rightScore) return leftScore - rightScore;
      return rightCpa - leftCpa;
    }

    if (category === 'oportunidades') {
      if (rightPriority !== leftPriority) return rightPriority - leftPriority;
      if (rightScore !== leftScore) return rightScore - leftScore;
      return leftCpa - rightCpa;
    }

    if (rightPriority !== leftPriority) return rightPriority - leftPriority;
    return rightScore - leftScore;
  });
  return list;
}

const inputItems = $input.all();
const source = clone(inputItems?.[0]?.json || {});
const inputBinary = collectBinary(inputItems);
const flatEntities = a(source.flat_entities);
const grouped = new Map();

for (const entity of flatEntities) {
  const reportDate = s(entity.account?.report_date || source.report_date);
  const accountId = s(entity.account?.account_id || source.account_id);
  const entityType = s(entity.entity_type);
  const category = s(entity.category);
  if (!reportDate || !accountId || !entityType || !category) continue;

  const key = [reportDate, accountId, entityType, category].join('::');
  if (!grouped.has(key)) {
    grouped.set(key, {
      report_date: reportDate,
      account_id: accountId,
      account_name: s(source.account_overview?.account_name || source.account_name),
      entity_type: entityType,
      category,
      pipeline_audit: clone(source.pipeline_audit || {}),
      account_overview: clone(source.account_overview || {}),
      entities: [],
      delivery_target: {
        instance_name: 'crm-channel-1',
        remote_jid: '555195103563',
      },
    });
  }
  grouped.get(key).entities.push(clone(entity));
}

const output = [];

for (const group of grouped.values()) {
  const sortedEntities = sortEntities(group.category, group.entities);
  const selectedEntities = sortedEntities.slice(0, MAX_ITEMS_PER_CATEGORY);
  const groupId = [
    group.report_date.replace(/-/g, '_'),
    group.entity_type,
    group.category,
    group.account_id,
  ].join('__');

  const payload = compactObject({
    group_id: groupId,
    route: 'grouped_math_snapshot',
    report_date: group.report_date,
    account_id: group.account_id,
    account_name: group.account_name,
    entity_type: group.entity_type,
    category: group.category,
    pipeline_audit: group.pipeline_audit,
    account_overview: group.account_overview,
    delivery_target: group.delivery_target,
    selection_summary: {
      candidate_count: sortedEntities.length,
      selected_count: selectedEntities.length,
      truncated_count: Math.max(0, sortedEntities.length - selectedEntities.length),
      limit_per_category: MAX_ITEMS_PER_CATEGORY,
      has_overflow: sortedEntities.length > MAX_ITEMS_PER_CATEGORY,
    },
    math_block: buildMathBlock({
      entity_type: group.entity_type,
      category: group.category,
      entities: selectedEntities,
      selection_summary: {
        selected_count: selectedEntities.length,
      },
    }),
    deferred_processing: {
      subjective_ai_candidate: ['ad', 'creative'].includes(group.entity_type),
    },
    entities: selectedEntities,
  });

  output.push(inputBinary ? { json: payload, binary: cloneBinary(inputBinary) } : { json: payload });
}

output.sort((left, right) => {
  const leftCat = CATEGORY_ORDER.indexOf(s(left.json?.category));
  const rightCat = CATEGORY_ORDER.indexOf(s(right.json?.category));
  if (leftCat !== rightCat) return leftCat - rightCat;
  const leftType = ENTITY_ORDER.indexOf(s(left.json?.entity_type));
  const rightType = ENTITY_ORDER.indexOf(s(right.json?.entity_type));
  return leftType - rightType;
});

return output;`;
}

function buildSubjectiveReviewQueueCode() {
  return String.raw`const ELIGIBLE_ENTITY_TYPES = new Set(['ad', 'creative']);
const ELIGIBLE_CATEGORIES = new Set(['top_performance', 'atencao', 'piores', 'oportunidades']);

function s(v) { return v == null ? '' : String(v).trim(); }
function a(v) { return Array.isArray(v) ? v : []; }
function hasVisualSignal(entity) {
  return !!(
    entity?.visual_asset_ref?.source_type && entity.visual_asset_ref.source_type !== 'not_available' ||
    entity?.media?.has_true_creative_image ||
    entity?.media?.resolved_from_thumbnail_only ||
    entity?.media?.preview_shareable_link ||
    entity?.media?.instagram_permalink_url ||
    entity?.visual?.download_url ||
    entity?.visual?.visual_status
  );
}

return items.map((item) => {
  const group = item.json || {};
  const entities = a(group.entities);
  const entityType = s(group.entity_type);
  const category = s(group.category);
  const visualSignalCount = entities.filter(hasVisualSignal).length;
  const eligibleByType = ELIGIBLE_ENTITY_TYPES.has(entityType);
  const eligibleByCategory = ELIGIBLE_CATEGORIES.has(category);
  const hasVisualInput = visualSignalCount > 0;
  const requiresSubjectiveAiReview = eligibleByType && eligibleByCategory && hasVisualInput;

  let subjectiveStatus = 'not_requested';
  if (eligibleByType && !hasVisualInput) subjectiveStatus = 'no_visual_input';
  if (requiresSubjectiveAiReview) subjectiveStatus = 'queued_for_ai';

  return {
    json: {
      ...group,
      route: 'subjective_review_queue',
      requires_subjective_ai_review: requiresSubjectiveAiReview,
      subjective_status: subjectiveStatus,
      subjective_queue_meta: {
        eligible_by_type: eligibleByType,
        eligible_by_category: eligibleByCategory,
        has_visual_input: hasVisualInput,
        visual_signal_count: visualSignalCount,
      },
    },
    binary: item.binary || {},
  };
});`;
}

function buildPrepareAiReviewInputsCode() {
  return String.raw`const MAX_ENTITIES_FOR_AI = 3;

function s(v) { return v == null ? '' : String(v).trim(); }
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
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function compactValue(value) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const out = value.map(compactValue).filter((item) => item !== undefined);
    return out.length ? out : undefined;
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const compacted = compactValue(inner);
      if (compacted !== undefined) out[key] = compacted;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return value;
}
function compactObject(value) {
  return compactValue(value) || {};
}
function buildEntityMathSummary(entity) {
  return compactObject({
    spend: n(entity.metrics?.spend),
    conversations: n(entity.metrics?.conversations),
    avg_cost_conversation: n(entity.metrics?.avgCostConversation),
    ctr: n(entity.metrics?.ctr),
    link_ctr: n(entity.metrics?.linkCtr),
    confidence_score: n(entity.data_quality?.overall_confidence_score),
    confidence_label: s(entity.data_quality?.overall_confidence_label),
    recommended_action: s(entity.analysis?.recommended_action),
    headline: s(entity.analysis?.headline),
    takeaway: [
      n(entity.metrics?.conversations) !== null ? 'Conversas ' + n(entity.metrics.conversations) : '',
      n(entity.metrics?.avgCostConversation) !== null ? 'CPA ' + n(entity.metrics.avgCostConversation) : '',
      s(entity.analysis?.recommended_action) ? 'Ação ' + s(entity.analysis.recommended_action) : '',
    ].filter(Boolean).join(' | '),
  });
}

const queued = items.filter((item) => item?.json?.requires_subjective_ai_review === true);
if (!queued.length) {
  return [{
    json: {
      _noop_branch: 'subjective_ai_results',
      _subjective_ai_work: false,
    },
  }];
}

return queued.map((item) => {
  const group = clone(item.json || {});
  const entities = a(group.entities).slice(0, MAX_ENTITIES_FOR_AI);
  const accountMetrics24h = group.account_overview?.window_metrics?.last_24h?.metrics || group.account_overview?.metrics || {};

  return {
    json: compactObject({
      source_group_snapshot: group,
      group_id: s(group.group_id),
      report_date: s(group.report_date),
      account_id: s(group.account_id),
      account_name: s(group.account_name),
      entity_type: s(group.entity_type),
      category: s(group.category),
      original_route: s(group.route),
      route: 'subjective_ai_review',
      deferred_processing: clone(group.deferred_processing || {}),
      selection_summary: clone(group.selection_summary || {}),
      pipeline_audit: clone(group.pipeline_audit || {}),
      account_overview: {
        math_summary: compactObject({
          spend_24h: n(accountMetrics24h.spend),
          conversations_24h: n(accountMetrics24h.conversations),
          avg_cost_conversation_24h: n(accountMetrics24h.avgCostConversation),
          ctr_24h: n(accountMetrics24h.ctr),
          link_ctr_24h: n(accountMetrics24h.linkCtr),
        }),
      },
      ai_review_context: {
        review_mode: 'subjective_creative_review',
        review_goals: [
          'avaliar clareza e coerência entre promessa, oferta e CTA',
          'identificar riscos criativos e de percepção comercial',
          'apontar melhorias práticas de copy, imagem e framing',
        ],
        math_context_summary: {
          group_category: s(group.category),
          entity_type: s(group.entity_type),
          selected_entities: entities.length,
          top_recommended_actions: entities.map((entity) => s(entity.analysis?.recommended_action)).filter(Boolean).slice(0, 3),
          avg_confidence_score: round2(entities.reduce((acc, entity) => acc + (n(entity.data_quality?.overall_confidence_score) ?? 0), 0) / Math.max(1, entities.length)),
          group_takeaway: entities.map((entity) => s(entity.analysis?.headline)).filter(Boolean).slice(0, 2).join(' | '),
        },
        entity_filtering: {
          total_entities_received: a(group.entities).length,
          entities_sent_to_ai: entities.length,
          entities_omitted: Math.max(0, a(group.entities).length - entities.length),
          max_entities_for_ai: MAX_ENTITIES_FOR_AI,
        },
      },
      token_saving: {
        original_entities_count: a(group.entities).length,
        reduced_entities_count: entities.length,
        reduction_ratio: round2(a(group.entities).length ? (1 - (entities.length / a(group.entities).length)) * 100 : 0),
        payload_compaction_mode: 'math_summary_primary',
      },
      entities: entities.map((entity, index) => compactObject({
        meta: {
          ...(entity.meta || {}),
          entity_position_label: (index + 1) + '/' + entities.length,
        },
        identity: clone(entity.identity || {}),
        creative: clone(entity.creative || {}),
        media: clone(entity.media || {}),
        visual: clone(entity.visual || {}),
        flags: clone(entity.flags || {}),
        measurement: clone(entity.measurement || {}),
        analysis: clone(entity.analysis || {}),
        metrics: clone(entity.metrics || {}),
        data_quality: clone(entity.data_quality || {}),
        status: clone(entity.status || {}),
        math_summary: buildEntityMathSummary(entity),
      })),
      _subjective_ai_work: true,
    }),
    binary: item.binary || {},
  };
});`;
}

function buildSubjectiveAiEmptyResultCode() {
  return String.raw`return items.map((item) => ({
  json: {
    ...(item.json || {}),
    _noop_branch: 'subjective_ai_results',
    _subjective_ai_work: false,
  },
}));`;
}

function buildNormalizeSubjectiveReviewOutputCode() {
  return String.raw`function s(v) { return v == null ? '' : String(v).trim(); }
function a(v) { return Array.isArray(v) ? v : []; }
function o(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function n(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const value = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function tryParse(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!(trimmed.startsWith('{') || trimmed.startsWith('[')))) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}
function compactValue(value) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const out = value.map(compactValue).filter((item) => item !== undefined);
    return out.length ? out : undefined;
  }
  if (o(value)) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const compacted = compactValue(inner);
      if (compacted !== undefined) out[key] = compacted;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return value;
}
function compactObject(value) { return compactValue(value) || {}; }

const preparedInputs = $('Prepare AI Review Inputs').all();
const sourceGroupById = new Map(
  preparedInputs
    .map((item) => item?.json || {})
    .filter((item) => s(item.group_id))
    .map((item) => [s(item.group_id), clone(item.source_group_snapshot || {})])
);

return items.map((item) => {
  const source = item.json || {};
  const parsed = tryParse(source.output);
  const normalized = o(parsed) ? parsed : {};
  const groupAnalysis = clone(normalized.group_analysis || {});
  const entityReviews = clone(normalized.entity_reviews || []);
  const aiHandoff = clone(normalized.ai_handoff || {});
  const primaryReview = a(entityReviews)[0] || {};
  const resolvedGroupId = s(
    source.group_id ||
    groupAnalysis.group_id ||
    primaryReview.group_id
  );
  const sourceGroup = clone(
    source.source_group_snapshot ||
    sourceGroupById.get(resolvedGroupId) ||
    {}
  );

  return {
    json: compactObject({
      ...sourceGroup,
      group_id: resolvedGroupId || s(sourceGroup.group_id),
      route: 'subjective_review_completed',
      subjective_status: 'reviewed_by_ai',
      subjective_block: {
        subjective_status: 'reviewed_by_ai',
        subjective_summary: s(primaryReview.subjective_summary || groupAnalysis.group_summary),
        subjective_scores: {
          creative_quality_score: n(primaryReview.creative_quality_score),
          offer_clarity_score: n(primaryReview.offer_clarity_score),
          cta_visual_strength_score: n(primaryReview.cta_visual_strength_score),
          trustworthiness_score: n(primaryReview.trustworthiness_score),
          premium_perception_score: n(primaryReview.premium_perception_score),
        },
        top_risks: a(groupAnalysis.top_risks).slice(0, 3),
        top_opportunities: a(groupAnalysis.top_opportunities).slice(0, 3),
        recommended_creative_direction: s(primaryReview.recommended_creative_direction),
        visual_evidence_status: s(groupAnalysis.visual_evidence_status),
        overall_subjective_verdict: s(groupAnalysis.overall_subjective_verdict),
        group_analysis: groupAnalysis,
        entity_reviews: entityReviews,
        ai_handoff: aiHandoff,
      },
    }),
    binary: item.binary || {},
  };
});`;
}

function buildSubjectivePlaceholderCode() {
  return String.raw`const passthrough = items
  .filter((item) => item?.json?.requires_subjective_ai_review !== true)
  .map((item) => {
    const source = item.json || {};
    return {
      json: {
        ...source,
        route: 'subjective_review_placeholder',
        subjective_status: source.subjective_status || 'not_requested',
        subjective_block: null,
      },
      binary: item.binary || {},
    };
  });

if (!passthrough.length) {
  return [{
    json: {
      _noop_branch: 'subjective_placeholder',
    },
  }];
}

return passthrough;`;
}

function buildConsolidatedWhatsappReportCode() {
  return String.raw`const CATEGORY_META = {
  top_performance: 'Top Performance',
  atencao: 'Attention',
  piores: 'Worst Performance',
  oportunidades: 'Opportunity',
};
const CATEGORY_ORDER = ['top_performance', 'atencao', 'piores', 'oportunidades'];
const ENTITY_ORDER = ['campaign', 'adset', 'ad', 'creative'];

function s(v) { return v == null ? '' : String(v).trim(); }
function a(v) { return Array.isArray(v) ? v : []; }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function n(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const normalized = String(v).trim().replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
function compactValue(value) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const out = value.map(compactValue).filter((item) => item !== undefined);
    return out.length ? out : undefined;
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const compacted = compactValue(inner);
      if (compacted !== undefined) out[key] = compacted;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return value;
}
function compactObject(value) { return compactValue(value) || {}; }
function formatBRL(v) {
  const value = n(v);
  if (value === null) return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value);
}
function formatPct(v) {
  const value = n(v);
  if (value === null) return '';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value) + '%';
}
function buildEntityLine(entity) {
  const identity = entity.identity || {};
  const metrics = entity.metrics || {};
  const analysis = entity.analysis || {};
  const parts = [];
  parts.push('[' + s(entity.entity_type).toUpperCase() + '] ' + (s(identity.name) || s(identity.entity_id) || 'Sem nome'));
  if (n(metrics.spend) !== null) parts.push('Gasto ' + formatBRL(metrics.spend));
  if (n(metrics.conversations) !== null) parts.push('Conversas ' + n(metrics.conversations));
  if (n(metrics.avgCostConversation) !== null) parts.push('CPA ' + formatBRL(metrics.avgCostConversation));
  if (n(metrics.ctr) !== null) parts.push('CTR ' + formatPct(metrics.ctr));
  if (s(analysis.recommended_action)) parts.push('Ação ' + s(analysis.recommended_action));
  return '• ' + parts.filter(Boolean).join(' | ');
}
function buildSubjectiveLine(group) {
  const subjective = group.subjective_block || {};
  const summary = s(subjective.subjective_summary);
  if (!summary) return '';
  const risks = a(subjective.top_risks).slice(0, 2);
  const opportunities = a(subjective.top_opportunities).slice(0, 2);
  const lines = ['  Subjetivo: ' + summary];
  if (risks.length) lines.push('  Riscos: ' + risks.join(' | '));
  if (opportunities.length) lines.push('  Oportunidades: ' + opportunities.join(' | '));
  return lines.join('\n');
}
function buildSection(category, groups) {
  const lines = ['*' + (CATEGORY_META[category] || s(category).toUpperCase()) + '*'];
  const ordered = [...groups].sort((left, right) => ENTITY_ORDER.indexOf(s(left.entity_type)) - ENTITY_ORDER.indexOf(s(right.entity_type)));
  for (const group of ordered) {
    const entities = a(group.entities);
    if (!entities.length) continue;
    lines.push('_' + s(group.entity_type).toUpperCase() + '_');
    for (const entity of entities.slice(0, 3)) {
      lines.push(buildEntityLine(entity));
    }
    const subjective = buildSubjectiveLine(group);
    if (subjective) lines.push(subjective);
  }
  return lines.join('\n');
}

const validGroups = items
  .map((item) => item.json || {})
  .filter((group) => s(group.group_id) && !group._noop_branch);

const groupedByReport = new Map();
for (const group of validGroups) {
  const key = [s(group.account_id), s(group.report_date)].join('::');
  if (!groupedByReport.has(key)) {
    groupedByReport.set(key, []);
  }
  groupedByReport.get(key).push(group);
}

const output = [];
for (const [key, groups] of groupedByReport.entries()) {
  const first = groups[0] || {};
  const accountId = s(first.account_id);
  const reportDate = s(first.report_date);
  const accountName = s(first.account_name) || accountId;
  const account24h = first.account_overview?.window_metrics?.last_24h?.metrics || first.account_overview?.metrics || {};
  const account7d = first.account_overview?.window_metrics?.last_7d?.metrics || {};
  const account30d = first.account_overview?.window_metrics?.last_30d?.metrics || {};

  const countsByCategory = {};
  for (const category of CATEGORY_ORDER) {
    countsByCategory[category] = groups.filter((group) => s(group.category) === category).length;
  }

  const subjectiveEligible = groups.filter((group) => ['ad', 'creative'].includes(s(group.entity_type))).length;
  const subjectiveReviewed = groups.filter((group) => s(group.subjective_status) === 'reviewed_by_ai').length;

  const header = [
    '*META ADS | RELATÓRIO CONSOLIDADO*',
    'Conta: ' + accountName,
    'Data: ' + reportDate,
  ].join('\n');

  const summaryLines = [
    '*Resumo absoluto da conta*',
    '24h: Gasto ' + formatBRL(account24h.spend) + ' | Conversas ' + (n(account24h.conversations) ?? 0) + ' | CPA ' + formatBRL(account24h.avgCostConversation) + ' | CTR ' + formatPct(account24h.ctr),
    '7d: Gasto ' + formatBRL(account7d.spend) + ' | Conversas ' + (n(account7d.conversations) ?? 0) + ' | CPA ' + formatBRL(account7d.avgCostConversation),
    '30d: Gasto ' + formatBRL(account30d.spend) + ' | Conversas ' + (n(account30d.conversations) ?? 0) + ' | CPA ' + formatBRL(account30d.avgCostConversation),
  ];

  const categorySections = CATEGORY_ORDER
    .map((category) => {
      const categoryGroups = groups.filter((group) => s(group.category) === category);
      if (!categoryGroups.length) return '';
      return buildSection(category, categoryGroups);
    })
    .filter(Boolean);

  const footer = [
    '*Cobertura subjetiva*',
    'Elegíveis: ' + subjectiveEligible + ' | Revisados por IA: ' + subjectiveReviewed,
  ].join('\n');

  const whatsappText = [header, summaryLines.join('\n'), ...categorySections, footer].filter(Boolean).join('\n\n');

  output.push({
    json: compactObject({
      report_type: 'consolidated_daily_meta_ads_report',
      message_type: 'consolidated_daily_meta_ads_report',
      route: 'consolidated_whatsapp_report',
      account_id: accountId,
      account_name: accountName,
      report_date: reportDate,
      headline_math_summary: summaryLines.slice(1).join(' | '),
      sections: categorySections,
      whatsapp_text: whatsappText,
      ready_for_whatsapp: Boolean(whatsappText),
      should_send_whatsapp: Boolean(whatsappText),
      idempotency_key: 'metaads:v3:' + reportDate + ':' + accountId + ':consolidated_whatsapp',
      group_counts_by_category: countsByCategory,
      subjective_coverage: {
        eligible_groups: subjectiveEligible,
        reviewed_groups: subjectiveReviewed,
        not_requested_groups: groups.filter((group) => s(group.subjective_status) === 'not_requested').length,
        no_visual_input_groups: groups.filter((group) => s(group.subjective_status) === 'no_visual_input').length,
      },
      delivery_target: clone(first.delivery_target || { instance_name: 'crm-channel-1', remote_jid: '555195103563' }),
      consolidated_groups: groups,
    }),
  });
}

return output;`;
}

function buildCheckIdempotencyCode() {
  return String.raw`return items.map((item) => {
  const source = item.json || {};

  return {
    json: {
      ...source,
      idempotency_status: 'not_checked_runtime',
      idempotency_check_supported: false,
      idempotency_note: 'Code node runtime does not expose getWorkflowStaticData here; external persistence is still required for cross-execution dedupe.',
      should_send_whatsapp: source.should_send_whatsapp !== false,
      ready_for_whatsapp: source.ready_for_whatsapp !== false,
    },
  };
});`;
}

function buildPrepareEvolutionPayloadCode() {
  return String.raw`function s(v) { return v == null ? '' : String(v).trim(); }

return items.map((item) => {
  const source = item.json || {};
  const messageText = s(source.whatsapp_text || source?.whatsapp?.text || source.message_text);
  const shouldSend = source.should_send_whatsapp !== false;
  const readyForWhatsapp = Boolean(
    shouldSend &&
    (source.ready_for_whatsapp === true || messageText)
  );

  const instanceName = s(source?.delivery_target?.instance_name || source.instance_name || 'crm-channel-1');
  const remoteJid = s(source?.delivery_target?.remote_jid || source.remote_jid || '555195103563');

  return {
    json: {
      ...source,
      route: 'prepared_evolution_delivery',
      ready_for_whatsapp: readyForWhatsapp,
      should_send_whatsapp: shouldSend,
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
  };
});`;
}

function buildPersistMathSnapshotCode() {
  return String.raw`return items.map((item) => {
  const group = item.json || {};
  return {
    json: {
      ...group,
      persistence_audit: {
        ...(group.persistence_audit || {}),
        math_group_snapshot: {
          snapshot_status: 'captured_in_payload',
          account_id: group.account_id,
          report_date: group.report_date,
          group_id: group.group_id,
          entity_type: group.entity_type,
          category: group.category,
          selected_count: group.selection_summary?.selected_count,
          entity_ids: Array.isArray(group.entities) ? group.entities.map((entity) => entity.identity?.entity_id).filter(Boolean) : [],
        },
      },
    },
    binary: item.binary || {},
  };
});`;
}

function buildPersistSubjectiveSnapshotCode() {
  return String.raw`return items.map((item) => {
  const group = item.json || {};
  return {
    json: {
      ...group,
      persistence_audit: {
        ...(group.persistence_audit || {}),
        subjective_review_snapshot: {
          snapshot_status: 'captured_in_payload',
          group_id: group.group_id,
          report_date: group.report_date,
          account_id: group.account_id,
          entity_type: group.entity_type,
          category: group.category,
          subjective_status: group.subjective_status,
          subjective_summary: group.subjective_block?.subjective_summary || '',
          recommended_creative_direction: group.subjective_block?.recommended_creative_direction || '',
          visual_evidence_status: group.subjective_block?.visual_evidence_status || '',
        },
      },
    },
    binary: item.binary || {},
  };
});`;
}

function buildPersistDeliveryAuditCode() {
  return String.raw`const sourceItems = $('Check Consolidated Idempotency').all();

return items.map((item, index) => {
  const source = sourceItems[index]?.json || {};
  const key = String(source.idempotency_key || '').trim();
  const auditRecord = {
    idempotency_key: key,
    message_type: source.message_type,
    account_id: source.account_id,
    report_date: source.report_date,
    sent_at: new Date().toISOString(),
    whatsapp_text_length: String(source.whatsapp_text || '').length,
    group_counts_by_category: source.group_counts_by_category || {},
    subjective_coverage: source.subjective_coverage || {},
    send_response: item.json || {},
  };

  return {
    json: {
      ...auditRecord,
      success: true,
      persistence_status: 'captured_in_output',
    },
  };
});`;
}

function patchWorkflow(workflow) {
  workflow.connections = workflow.connections || {};

  const buildDelivery = getNode(workflow, 'Build Delivery Entities');
  buildDelivery.parameters.jsCode = patchBuildDeliveryEntitiesCode(loadOriginalNodeCode('Build Delivery Entities'));

  const buildGrouped = getNode(workflow, 'Build Grouped Outputs');
  buildGrouped.parameters.jsCode = buildGroupedOutputsCode();
  buildGrouped.position = [-176, -640];

  const prepareAi = getNode(workflow, 'Prepare AI Review Inputs');
  prepareAi.parameters.jsCode = buildPrepareAiReviewInputsCode();
  prepareAi.position = [496, -944];

  const normalizeSubjective = getFirstNode(workflow, ['Normalize Subjective Review Output', 'Normalize Agent Output']);
  normalizeSubjective.name = 'Normalize Subjective Review Output';
  normalizeSubjective.parameters.jsCode = buildNormalizeSubjectiveReviewOutputCode();
  normalizeSubjective.position = [1072, -944];

  const prepareEvolution = getNode(workflow, 'Prepare Evolution Payload');
  prepareEvolution.parameters.jsCode = buildPrepareEvolutionPayloadCode();
  prepareEvolution.position = [1744, -752];

  const shouldSend = getNode(workflow, 'Should Send WhatsApp');
  shouldSend.position = [1968, -752];
  shouldSend.parameters = buildIfNode('tmp', [0, 0], "={{ $json.should_send_whatsapp === true && $json.ready_for_whatsapp === true && !!String($json.evolution_message_text || '').trim() && !!String($json.evolution_remote_jid || '').trim() && !!String($json.evolution_instance_name || '').trim() }}").parameters;

  const sendReport = getNode(workflow, 'Send Report');
  sendReport.position = [2192, -848];
  sendReport.parameters = {
    ...(sendReport.parameters || {}),
    instanceName: '={{$json.evolution_instance_name}}',
    remoteJid: '={{$json.evolution_remote_jid}}',
    messageText: '={{$json.evolution_message_text}}',
  };

  upsertNode(workflow, buildCodeNode('Build Subjective Review Queue', [48, -736], buildSubjectiveReviewQueueCode()));
  upsertNode(workflow, buildIfNode('Has Subjective AI Work', [720, -944], '={{ $json._subjective_ai_work === true }}'));
  upsertNode(workflow, buildCodeNode('Build Subjective AI Empty Result', [944, -752], buildSubjectiveAiEmptyResultCode()));
  upsertNode(workflow, buildCodeNode('Build Subjective Placeholder', [496, -496], buildSubjectivePlaceholderCode()));
  upsertNode(workflow, buildMergeNode('Merge Subjective AI Results', [1296, -848]));
  upsertNode(workflow, buildMergeNode('Merge Subjective Insights Into Groups', [1520, -672]));
  upsertNode(workflow, buildCodeNode('Build Consolidated WhatsApp Report', [1744, -592], buildConsolidatedWhatsappReportCode()));
  upsertNode(workflow, buildCodeNode('Check Consolidated Idempotency', [1520, -752], buildCheckIdempotencyCode()));
  upsertNode(workflow, buildCodeNode('Persist Consolidated Delivery Audit', [2416, -848], buildPersistDeliveryAuditCode()));

  removeNodes(workflow, [
    'Decide Group Route',
    'Switch Group Route',
    'Build Direct WhatsApp Summary',
    'Route Outcome - Persist Only',
    'Route Outcome - Fallback',
    'Route Outcome - Delivery Skipped',
    'Persist Math Group Snapshot',
    'Persist Subjective Review Snapshot',
  ]);

  replaceConnections(workflow.connections, 'Build Delivery Entities', [
    [{ node: 'Build Grouped Outputs', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Build Grouped Outputs', [
    [{ node: 'Build Subjective Review Queue', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Build Subjective Review Queue', [
    [{ node: 'Prepare AI Review Inputs', index: 0 }, { node: 'Build Subjective Placeholder', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Prepare AI Review Inputs', [
    [{ node: 'Has Subjective AI Work', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Has Subjective AI Work', [
    [{ node: 'Livia', index: 0 }],
    [{ node: 'Build Subjective AI Empty Result', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Livia', [
    [{ node: 'Normalize Subjective Review Output', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Normalize Subjective Review Output', [
    [{ node: 'Merge Subjective AI Results', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Build Subjective AI Empty Result', [
    [{ node: 'Merge Subjective AI Results', index: 1 }],
  ]);
  replaceConnections(workflow.connections, 'Build Subjective Placeholder', [
    [{ node: 'Merge Subjective Insights Into Groups', index: 1 }],
  ]);
  replaceConnections(workflow.connections, 'Merge Subjective AI Results', [
    [{ node: 'Merge Subjective Insights Into Groups', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Merge Subjective Insights Into Groups', [
    [{ node: 'Build Consolidated WhatsApp Report', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Build Consolidated WhatsApp Report', [
    [{ node: 'Check Consolidated Idempotency', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Check Consolidated Idempotency', [
    [{ node: 'Prepare Evolution Payload', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Prepare Evolution Payload', [
    [{ node: 'Should Send WhatsApp', index: 0 }],
  ]);
  replaceConnections(workflow.connections, 'Should Send WhatsApp', [
    [{ node: 'Send Report', index: 0 }],
    [],
  ]);
  replaceConnections(workflow.connections, 'Send Report', [
    [{ node: 'Persist Consolidated Delivery Audit', index: 0 }],
  ]);

  return workflow;
}

function exportWorkflow(db, workflowId) {
  const row = db.prepare(`
    SELECT id, name, active, nodes, connections, settings, staticData, pinData, versionId, meta, description
    FROM workflow_entity
    WHERE id = ?
  `).get(workflowId);
  if (!row) throw new Error(`Workflow ${workflowId} nao encontrado.`);
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

function loadOriginalNodeCode(nodeName) {
  if (!fs.existsSync(ORIGINAL_SNAPSHOT_PATH)) {
    throw new Error(`Snapshot original nao encontrado em ${ORIGINAL_SNAPSHOT_PATH}`);
  }
  const workflow = JSON.parse(fs.readFileSync(ORIGINAL_SNAPSHOT_PATH, 'utf8'));
  const node = (workflow.nodes || []).find((entry) => entry.name === nodeName);
  if (!node) {
    throw new Error(`Node original "${nodeName}" nao encontrado no snapshot base.`);
  }
  return node.parameters?.jsCode || '';
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
