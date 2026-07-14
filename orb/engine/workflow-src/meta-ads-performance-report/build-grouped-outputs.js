const MAX_ITEMS_PER_CATEGORY = 3;
const CATEGORY_ORDER = ['top_performance', 'atencao', 'piores', 'oportunidades'];
const ENTITY_ORDER = ['ad'];
const DELIVERABLE_ENTITY_TYPES = new Set(['ad']);
const DELIVERY_THRESHOLDS = {
  top_performance: { min_spend: 15, min_impressions: 500, min_clicks: 8, min_conversations: 2 },
  atencao: { min_spend: 10, min_impressions: 500, min_clicks: 8, min_conversations: 1 },
  piores: { min_spend: 10, min_impressions: 500, min_clicks: 8, min_conversations: 0 },
  oportunidades: { min_spend: 15, min_impressions: 500, min_clicks: 8, min_conversations: 2 },
};

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
    delivery_threshold: group.delivery_threshold,
  });
}
function hasActivity(entity) {
  const metrics = entity?.metrics || {};
  return [
    metrics.spend,
    metrics.impressions,
    metrics.reach,
    metrics.clicks,
    metrics.linkClicks,
    metrics.conversations,
    metrics.engagement,
    metrics.inlinePostEngagement,
    metrics.igRedirect,
  ].some((value) => (n(value) ?? 0) > 0);
}
function looksPhase1Like(reportMode, entity) {
  if (s(reportMode).toLowerCase() === 'phase1') return true;
  const metrics = entity?.metrics || {};
  const spend = n(metrics.spend) ?? 0;
  const impressions = n(metrics.impressions) ?? 0;
  const clicks = n(metrics.clicks) ?? 0;
  const linkClicks = n(metrics.linkClicks) ?? 0;
  const outboundClicks = n(metrics.outboundClicks) ?? 0;
  const conversations = n(metrics.conversations) ?? 0;
  return spend === 0 && impressions === 0 && clicks === 0 && linkClicks === 0 && outboundClicks === 0 && conversations > 0;
}
function meetsDeliveryThreshold(category, entity, context = {}) {
  const threshold = DELIVERY_THRESHOLDS[category] || DELIVERY_THRESHOLDS.atencao;
  const metrics = entity?.metrics || {};
  const spend = n(metrics.spend) ?? 0;
  const impressions = n(metrics.impressions) ?? 0;
  const clicks = n(metrics.clicks) ?? 0;
  const linkClicks = n(metrics.linkClicks) ?? 0;
  const outboundClicks = n(metrics.outboundClicks) ?? 0;
  const igRedirect = n(metrics.igRedirect) ?? 0;
  const conversations = n(metrics.conversations) ?? 0;
  const phase1Like = looksPhase1Like(context.report_mode, entity);

  if (phase1Like) {
    if (category === 'top_performance' || category === 'oportunidades' || category === 'atencao') {
      return conversations >= 1 || linkClicks > 0 || outboundClicks > 0 || igRedirect > 0;
    }
    if (category === 'piores') {
      return conversations === 0 && (linkClicks > 0 || outboundClicks > 0 || igRedirect > 0);
    }
  }

  const hasEnoughSpend = spend >= (threshold.min_spend ?? 0);
  const hasEnoughVolume = impressions >= (threshold.min_impressions ?? 0) || clicks >= (threshold.min_clicks ?? 0);
  const hasEnoughConversations = conversations >= (threshold.min_conversations ?? 0);

  if (category === 'piores') {
    return hasEnoughSpend && (hasEnoughVolume || conversations === 0 || hasEnoughConversations);
  }

  return hasEnoughSpend && (hasEnoughVolume || hasEnoughConversations);
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
const metaParams = (() => {
  try {
    return $('Meta API Params').first()?.json || {};
  } catch {
    return {};
  }
})();
const flatEntities = a(source.flat_entities)
  .filter((entity) => DELIVERABLE_ENTITY_TYPES.has(s(entity?.entity_type)))
  .filter((entity) => hasActivity(entity));
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
        instance_name: s(metaParams.report_instance_name || metaParams.evolution_instance_name || 'crm-channel-1'),
        remote_jid: s(metaParams.report_recipient_jid || '555195103563'),
      },
    });
  }
  grouped.get(key).entities.push(clone(entity));
}

const output = [];

for (const group of grouped.values()) {
  const threshold = clone(DELIVERY_THRESHOLDS[group.category] || DELIVERY_THRESHOLDS.atencao);
  const thresholdQualifiedEntities = group.entities.filter((entity) => meetsDeliveryThreshold(group.category, entity, source));
  if (!thresholdQualifiedEntities.length) continue;

  const sortedEntities = sortEntities(group.category, thresholdQualifiedEntities);
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
      candidate_count_before_threshold: group.entities.length,
      selected_count: selectedEntities.length,
      truncated_count: Math.max(0, sortedEntities.length - selectedEntities.length),
      threshold_filtered_count: Math.max(0, group.entities.length - sortedEntities.length),
      limit_per_category: MAX_ITEMS_PER_CATEGORY,
      has_overflow: sortedEntities.length > MAX_ITEMS_PER_CATEGORY,
    },
    math_block: buildMathBlock({
      entity_type: group.entity_type,
      category: group.category,
      entities: selectedEntities,
      delivery_threshold: threshold,
      selection_summary: {
        selected_count: selectedEntities.length,
      },
    }),
    deferred_processing: {
      subjective_ai_candidate: group.entity_type === 'ad',
      conclusion_scope: 'ads_only',
      support_levels_used_in_calculation: ['campaign', 'adset', 'creative'],
    },
    entities: selectedEntities,
    delivery_threshold: threshold,
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

return output;
