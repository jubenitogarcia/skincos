const items = $input.all();

const CATEGORY_META = {
  top_performance: { emoji: '🏆', label: 'MELHORES' },
  oportunidades: { emoji: '💡', label: 'OPORTUNIDADES' },
  piores: { emoji: '📉', label: 'PIORES' },
  atencao: { emoji: '⚠️', label: 'ATENÇÃO' },
};

const ENTITY_META = {
  ad: { singular: 'ANÚNCIO', plural: 'ANÚNCIOS' },
  adset: { singular: 'CONJUNTO', plural: 'CONJUNTOS' },
  campaign: { singular: 'CAMPANHA', plural: 'CAMPANHAS' },
};

const ACTIONS = {
  PAUSE: 'PAUSE',
  REDUCE_BUDGET: 'REDUCE_BUDGET',
  HOLD: 'HOLD',
  SCALE_SMALL: 'SCALE_SMALL',
  SCALE_MODERATE: 'SCALE_MODERATE',
  REFRESH_CREATIVE: 'REFRESH_CREATIVE',
  CHECK_TRACKING: 'CHECK_TRACKING',
  CHECK_SEGMENTATION: 'CHECK_SEGMENTATION',
  REVIEW_OFFER: 'REVIEW_OFFER',
  REQUEST_AI_REVIEW: 'REQUEST_AI_REVIEW',
  REQUEST_HUMAN_REVIEW: 'REQUEST_HUMAN_REVIEW',
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNil(v) {
  return v === null || v === undefined || v === '';
}

function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function toNumber(v) {
  if (isNil(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  const n = toNumber(value);
  if (n === null) return null;
  return Math.round(n * 100) / 100;
}

function hasValue(v) {
  if (isNil(v)) return false;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim();
  return s !== '' && s !== '0';
}

function clamp(value, minValue, maxValue) {
  return Math.min(Math.max(value, minValue), maxValue);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const s = safeString(value);
    if (s) return s;
  }
  return '';
}

function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];

  for (const item of arr) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function uniqueStrings(arr) {
  return uniqueBy(
    (Array.isArray(arr) ? arr : []).map(v => safeString(v)).filter(Boolean),
    v => safeString(v).toLowerCase()
  );
}

function countBy(list, keyFn) {
  const out = {};
  for (const item of Array.isArray(list) ? list : []) {
    const key = safeString(keyFn(item));
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function normalizePriority(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function slugify(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizeText(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function tokenize(value) {
  const stopWords = new Set([
    'A', 'AS', 'O', 'OS', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'NO', 'NA', 'NOS', 'NAS',
    'PARA', 'POR', 'COM', 'SEM', 'UM', 'UMA', 'UNS', 'UMAS',
    'MES', 'CONSUMIDOR', 'VALORES', 'EXCLUSIVOS', 'OFERTA', 'OFERTAS',
    'CLIQUE', 'CHAME', 'SAIBA', 'MAIS', 'AGENDE', 'WHATSAPP', 'ESPACO', 'FACIAL'
  ]);

  return normalizeText(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token && token.length > 2 && !stopWords.has(token) && !/^\d+$/.test(token));
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeAll(nodeName) {
  try {
    return $(nodeName).all();
  } catch (error) {
    return [];
  }
}

function countVisualCompleteness(visual) {
  let score = 0;

  const metadataKeys = [
    'primary_title',
    'primary_body',
    'primary_description',
    'primary_link_url',
    'primary_display_url',
    'primary_image_hash',
    'primary_image_label_id',
    'primary_image_label_name',
    'download_url',
    'download_source',
  ];

  for (const key of metadataKeys) {
    if (safeString(visual?.[key])) score += 1;
  }

  if (Array.isArray(visual?.images_requested) && visual.images_requested.length) {
    score += 1;
  }

  if (visual?.primary_image?.found === true) {
    score += 6;
  } else if (safeString(visual?.primary_image?.url)) {
    score += 1;
  }

  const status = safeString(visual?.visual_status);
  if (status === 'resolved_creative_image') score += 3;
  if (status === 'fallback_thumbnail') score += 0.5;

  return Number(score);
}

function formatDateShort(isoDate) {
  const s = safeString(isoDate);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}`;
}

function formatBRL(v) {
  const n = toNumber(v);
  if (n === null) return null;

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

function formatDecimal(v, digits = 2) {
  const n = toNumber(v);
  if (n === null) return null;

  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
}

function formatInteger(v) {
  const n = toNumber(v);
  if (n === null) return null;

  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMetricValue(key, value) {
  if (!hasValue(value)) return null;

  const currencyKeys = new Set([
    'spend',
    'avgCostConversation',
    'cpc',
    'cpm',
    'cpp',
    'costPerLinkClick',
    'costPerUniqueClick',
    'costPerUniqueLinkClick',
    'costPerOutboundClick',
    'costPerInlinePostEngagement',
  ]);

  const integerKeys = new Set([
    'conversations',
    'clicks',
    'reach',
    'impressions',
    'engagement',
    'igRedirect',
    'linkClicks',
    'uniqueClicks',
    'uniqueLinkClicks',
    'outboundClicks',
    'inlinePostEngagement',
  ]);

  if (currencyKeys.has(key)) return formatBRL(value);
  if (integerKeys.has(key)) return formatInteger(value);
  return formatDecimal(value, 2);
}

function metricLine(label, value, formatterKey) {
  if (!hasValue(value)) return null;
  const formatted = formatMetricValue(formatterKey, value);
  if (!formatted) return null;
  return `${label}: ${formatted}`;
}

function metricPairLine(label, leftValue, rightValue, leftKey, rightKey) {
  const leftHas = hasValue(leftValue);
  const rightHas = hasValue(rightValue);

  if (!leftHas && !rightHas) return null;

  const leftFormatted = leftHas ? formatMetricValue(leftKey, leftValue) : '—';
  const rightFormatted = rightHas ? formatMetricValue(rightKey, rightValue) : '—';

  return `${label}: ${leftFormatted}/${rightFormatted}`;
}

function extractPrices(text) {
  const s = safeString(text);
  if (!s) return [];
  const matches = s.match(/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g) || [];
  return uniqueStrings(matches);
}

function detectWhatsAppSignal(text) {
  const s = normalizeText(text);
  return s.includes('WHATSAPP') || s.includes('API WHATSAPP') || s.includes('MESSAGE');
}

function parseJsonLike(value) {
  if (isObject(value)) return value;
  const s = safeString(value);
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function extractWelcomeMessageSignals(additionalData) {
  const pageWelcomeMessage = additionalData?.page_welcome_message;
  const parsed = parseJsonLike(pageWelcomeMessage);

  let icebreakers = [];
  let autofillText = '';
  let greetingText = '';

  if (parsed) {
    const rawIcebreakers = Array.isArray(parsed.ice_breakers) ? parsed.ice_breakers : [];
    icebreakers = rawIcebreakers
      .map(item => safeString(item?.call_to_action_text || item?.text || item?.message))
      .filter(Boolean);

    autofillText = safeString(
      parsed.cta_message ||
      parsed.autofill_text ||
      parsed.text ||
      parsed.message
    );

    greetingText = safeString(
      parsed.greeting ||
      parsed.greeting_text ||
      parsed.welcome_message
    );
  }

  return {
    raw_present: !!safeString(pageWelcomeMessage),
    parsed_present: !!parsed,
    icebreakers,
    icebreakers_count: icebreakers.length,
    autofill_text: autofillText,
    greeting_text: greetingText,
    has_autofill_text: !!autofillText,
    has_greeting_text: !!greetingText,
  };
}

function inferOfferFamily(text) {
  const s = normalizeText(text);

  const families = [
    { key: 'preenchimento_labial', patterns: ['PREENCHIMENTO LABIAL'] },
    { key: 'lavieen_microagulhamento', patterns: ['LAVIEEN', 'MICROAGULHAMENTO'] },
    { key: 'lavieen', patterns: ['LAVIEEN'] },
    { key: 'microagulhamento', patterns: ['MICROAGULHAMENTO'] },
    { key: 'clube_do_botox', patterns: ['CLUBE DO BOTOX'] },
    { key: 'botox', patterns: ['BOTOX'] },
    { key: 'bioestimulador', patterns: ['BIOESTIMULADOR'] },
    { key: 'fios', patterns: ['FIOS'] },
    { key: 'peito', patterns: ['PEITO'] },
    { key: 'elleva', patterns: ['ELLEVA'] },
  ];

  for (const family of families) {
    const ok = family.patterns.every(pattern => s.includes(pattern));
    if (ok) return family.key;
  }

  return 'unclassified';
}

function inferCreativeStructure(creative, imagesRequested, customizationRules) {
  const titlesCount = Array.isArray(creative?.titles) ? creative.titles.length : 0;
  const bodiesCount = Array.isArray(creative?.bodies) ? creative.bodies.length : 0;
  const linkUrlsCount = Array.isArray(creative?.link_urls) ? creative.link_urls.length : 0;

  const imagesCount = Array.isArray(imagesRequested) ? imagesRequested.length : 0;
  const rulesCount = Array.isArray(customizationRules) ? customizationRules.length : 0;

  const isDynamicLike =
    titlesCount > 1 ||
    bodiesCount > 1 ||
    imagesCount > 1 ||
    rulesCount > 1 ||
    linkUrlsCount > 1;

  if (isDynamicLike && rulesCount > 0) return 'dynamic_multi_asset';
  if (isDynamicLike) return 'dynamic_like';
  if (imagesCount <= 1) return 'single_asset';
  return 'multi_asset';
}

function getVisualSourceConfidence(visualStatus) {
  const status = safeString(visualStatus);
  if (status === 'resolved_creative_image') return 'high';
  if (status === 'fallback_thumbnail') return 'medium';
  return 'low';
}

function computeVisualResolutionScore(visualStatus) {
  const status = safeString(visualStatus);
  if (status === 'resolved_creative_image') return 1;
  if (status === 'fallback_thumbnail') return 0.5;
  return 0;
}

function computePlacementCoverage(customizationRules) {
  const rules = Array.isArray(customizationRules) ? customizationRules : [];

  const publisherPlatforms = new Set();
  const facebookPositions = new Set();
  const instagramPositions = new Set();
  const audienceNetworkPositions = new Set();
  const messengerPositions = new Set();

  for (const rule of rules) {
    const spec = rule?.customization_spec || {};

    for (const v of Array.isArray(spec.publisher_platforms) ? spec.publisher_platforms : []) {
      publisherPlatforms.add(safeString(v).toLowerCase());
    }

    for (const v of Array.isArray(spec.facebook_positions) ? spec.facebook_positions : []) {
      facebookPositions.add(safeString(v).toLowerCase());
    }

    for (const v of Array.isArray(spec.instagram_positions) ? spec.instagram_positions : []) {
      instagramPositions.add(safeString(v).toLowerCase());
    }

    for (const v of Array.isArray(spec.audience_network_positions) ? spec.audience_network_positions : []) {
      audienceNetworkPositions.add(safeString(v).toLowerCase());
    }

    for (const v of Array.isArray(spec.messenger_positions) ? spec.messenger_positions : []) {
      messengerPositions.add(safeString(v).toLowerCase());
    }
  }

  const allPositions = [
    ...facebookPositions,
    ...instagramPositions,
    ...audienceNetworkPositions,
    ...messengerPositions,
  ].filter(Boolean);

  const hasSearchVariant = allPositions.includes('search');
  const hasStoryVariant = allPositions.some(v => v.includes('story'));
  const hasReelsVariant = allPositions.some(v => v.includes('reels'));
  const hasFeedVariant = allPositions.some(v =>
    ['feed', 'stream', 'marketplace', 'explore', 'explore_home'].includes(v)
  );

  const score =
    Math.min(1, (
      (publisherPlatforms.size ? 0.2 : 0) +
      (hasFeedVariant ? 0.25 : 0) +
      (hasStoryVariant ? 0.2 : 0) +
      (hasReelsVariant ? 0.2 : 0) +
      (hasSearchVariant ? 0.15 : 0)
    ));

  return {
    placement_rules_count: rules.length,
    placement_platforms: [...publisherPlatforms],
    facebook_positions: [...facebookPositions],
    instagram_positions: [...instagramPositions],
    audience_network_positions: [...audienceNetworkPositions],
    messenger_positions: [...messengerPositions],
    placement_positions_flat: uniqueStrings(allPositions),
    has_search_variant: hasSearchVariant,
    has_story_variant: hasStoryVariant,
    has_reels_variant: hasReelsVariant,
    has_feed_variant: hasFeedVariant,
    placement_coverage_score: Number(score.toFixed(2)),
  };
}

function summarizeDecision(entity) {
  const policy = entity?.decision || {};
  const features = policy?.features || {};
  const primaryAction = safeString(policy?.policy?.primary_action || entity?.analysis?.executive_summary?.primary_action);
  const gateLevel = safeString(policy?.policy?.confidence_gate_level || entity?.analysis?.classification?.confidence_gate?.level);
  const urgency = safeString(policy?.policy?.action_urgency_level || entity?.analysis?.priority_level);
  const blocks = !!policy?.policy?.should_block_aggressive_actions;
  const accel = !!features?.trend_is_accelerating;
  const decline = !!features?.trend_is_declining;

  return {
    primary_action: primaryAction,
    confidence_gate_level: gateLevel || 'open',
    action_urgency_level: urgency || '',
    should_block_aggressive_actions: blocks,
    trend_is_accelerating: accel,
    trend_is_declining: decline,
  };
}

function buildGroupedMessage(row) {
  const entityType = safeString(row.entity_type);
  const category = safeString(row.category);
  const reportDate = safeString(row.report_date);
  const entities = Array.isArray(row.entities) ? row.entities : [];

  const categoryMeta = CATEGORY_META[category] || {
    emoji: '📌',
    label: safeString(category).toUpperCase(),
  };

  const entityMeta = ENTITY_META[entityType] || {
    singular: 'ITEM',
    plural: 'ITENS',
  };

  const dateLabel = formatDateShort(reportDate);

  const lines = [];
  lines.push(`${categoryMeta.emoji} ${categoryMeta.label} ${entityMeta.plural} – ${dateLabel}`);

  const issueRatio = toNumber(row.issue_ratio) ?? toNumber(row.pipeline_audit?.issue_ratio) ?? 0;
  const rowsWithFetchIssues = toNumber(row.pipeline_audit?.rows_with_fetch_issues) ?? 0;
  const selectionSummary = row.selection_summary || {};

  if (safeString(row.report_completeness).toLowerCase() === 'partial') {
    lines.push(`Cobertura: PARCIAL (${formatDecimal(issueRatio * 100, 1)}% da coleta com degradação; ${rowsWithFetchIssues} linha(s) com fetch issue).`);
  }

  if (selectionSummary.has_overflow) {
    lines.push(`Recorte priorizado: ${selectionSummary.selected_count}/${selectionSummary.candidate_count} itens exibidos; ${selectionSummary.truncated_count} ficaram fora do top ${selectionSummary.limit_per_category}.`);
  }

  if ((selectionSummary.excluded_low_confidence_entities ?? 0) > 0) {
    lines.push(`Itens fora por baixa confiança: ${selectionSummary.excluded_low_confidence_entities}.`);
  }

  const thumbnailFallbackRows = toNumber(row.pipeline_audit?.thumbnail_fallback_rows) ?? 0;
  const directVisualRows = toNumber(row.pipeline_audit?.direct_visual_rows) ?? 0;

  if (directVisualRows || thumbnailFallbackRows) {
    lines.push(`Visuais: ${directVisualRows} imagem(ns) diretas e ${thumbnailFallbackRows} thumbnail(s) de fallback.`);
  }

  const blockedCount = toNumber(row.decision_summary?.blocked_entities) ?? 0;
  const restrictedCount = toNumber(row.decision_summary?.restricted_entities) ?? 0;
  if (blockedCount || restrictedCount) {
    lines.push(`Decisão: ${blockedCount} bloqueado(s) e ${restrictedCount} restrito(s) por confiança/política.`);
  }

  for (const entity of entities) {
    const identity = entity.identity || {};
    const analysis = entity.analysis || {};
    const summary = analysis.executive_summary || {};
    const media = entity.media || {};
    const m = entity.metrics || {};
    const decision = entity.decision_summary || {};

    lines.push('');
    lines.push(`*${safeString(identity.name)}*`);
    lines.push(`_${safeString(identity.entity_id)}_`);

    const metricLines = [
      metricLine('💰 *Investimento*', m.spend, 'spend'),
      metricLine('💬 *Conversa*', m.conversations, 'conversations'),
      metricLine('🔄 *CPCv*', m.avgCostConversation, 'avgCostConversation'),
      metricLine('🖱️ *Clique*', m.clicks, 'clicks'),
      metricLine('📍 *Alcance*', m.reach, 'reach'),
      metricLine('👀 *Impressão*', m.impressions, 'impressions'),
      metricLine('❤️ *Engajamento*', m.engagement, 'engagement'),
      metricLine('📲 *Redirecionamento IG*', m.igRedirect, 'igRedirect'),
      metricPairLine('🎯 *CTR/CTRL*', m.ctr, m.linkCtr, 'ctr', 'linkCtr'),
      metricPairLine('💰 *CPC/CPCL*', m.cpc, m.costPerLinkClick, 'cpc', 'costPerLinkClick'),
      metricLine('📣 *CPM*', m.cpm, 'cpm'),
      metricLine('👥 *CPP*', m.cpp, 'cpp'),
      metricLine('🔁 *Frequência*', m.frequency, 'frequency'),
      metricPairLine('☝️ *CU/CUL*', m.uniqueClicks, m.uniqueLinkClicks, 'uniqueClicks', 'uniqueLinkClicks'),
    ].filter(Boolean);

    lines.push(...metricLines);

    if (safeString(summary.primary_action)) {
      lines.push(`➡️ *Ação*: ${safeString(summary.primary_action)}`);
    }

    if (decision.should_block_aggressive_actions) {
      lines.push(`🧱 *Gate*: ${safeString(decision.confidence_gate_level || 'restricted')}`);
    }

    if (safeString(media.primary_url)) {
      const visualNote = media.resolved_from_thumbnail_only
        ? ' _(thumbnail de fallback)_'
        : media.has_true_creative_image
          ? ' _(imagem criativa direta)_'
          : '';
      lines.push(`🖼️ *Imagem*: ${safeString(media.primary_url)}${visualNote}`);
    }
  }

  return lines.join('\n');
}

function buildEntityMessage(entity) {
  const meta = entity.meta || {};
  const identity = entity.identity || {};
  const analysis = entity.analysis || {};
  const summary = analysis.executive_summary || {};
  const metrics = entity.metrics || {};
  const media = entity.media || {};
  const decision = entity.decision_summary || {};

  const dateLabel = formatDateShort(meta.report_date);
  const header = `${safeString(meta.category_emoji || '📌')} ${safeString(meta.category_label || '').toUpperCase()} ${safeString(meta.entity_label || 'ITEM')} ${safeString(meta.entity_position_label)} – ${dateLabel}`;

  const lines = [];
  lines.push(header);
  lines.push('');
  lines.push(`*${safeString(identity.name)}*`);
  lines.push(`_${safeString(identity.entity_id)}_`);

  if (safeString(summary.headline)) {
    lines.push('');
    lines.push(`🧠 *Leitura*: ${safeString(summary.headline)}`);
  }

  const metricLines = [
    metricLine('💰 *Investimento*', metrics.spend, 'spend'),
    metricLine('💬 *Conversa*', metrics.conversations, 'conversations'),
    metricLine('🔄 *CPCv*', metrics.avgCostConversation, 'avgCostConversation'),
    metricLine('🖱️ *Clique*', metrics.clicks, 'clicks'),
    metricLine('📍 *Alcance*', metrics.reach, 'reach'),
    metricLine('👀 *Impressão*', metrics.impressions, 'impressions'),
    metricLine('❤️ *Engajamento*', metrics.engagement, 'engagement'),
    metricLine('📲 *Redirecionamento IG*', metrics.igRedirect, 'igRedirect'),
    metricPairLine('🎯 *CTR/CTRL*', metrics.ctr, metrics.linkCtr, 'ctr', 'linkCtr'),
    metricPairLine('💰 *CPC/CPCL*', metrics.cpc, metrics.costPerLinkClick, 'cpc', 'costPerLinkClick'),
    metricLine('📣 *CPM*', metrics.cpm, 'cpm'),
    metricLine('👥 *CPP*', metrics.cpp, 'cpp'),
    metricLine('🔁 *Frequência*', metrics.frequency, 'frequency'),
    metricPairLine('☝️ *CU/CUL*', metrics.uniqueClicks, metrics.uniqueLinkClicks, 'uniqueClicks', 'uniqueLinkClicks'),
  ].filter(Boolean);

  if (metricLines.length) {
    lines.push(...metricLines);
  }

  if (safeString(summary.primary_action)) {
    lines.push(`➡️ *Ação*: ${safeString(summary.primary_action)}`);
  }

  if (safeString(summary.main_risk)) {
    lines.push(`⚠️ *Risco*: ${safeString(summary.main_risk)}`);
  }

  if (safeString(summary.main_opportunity)) {
    lines.push(`🚀 *Oportunidade*: ${safeString(summary.main_opportunity)}`);
  }

  if (decision.should_block_aggressive_actions) {
    lines.push(`🧱 *Gate*: ${safeString(decision.confidence_gate_level || 'restricted')}`);
  }

  if (safeString(media.primary_url)) {
    const visualNote = media.resolved_from_thumbnail_only
      ? ' _(thumbnail de fallback)_'
      : media.has_true_creative_image
        ? ' _(imagem criativa direta)_'
        : '';
    lines.push(`🖼️ *Imagem*: ${safeString(media.primary_url)}${visualNote}`);
  }

  return lines.join('\n');
}

function shouldRouteGroupToSubjectiveAI(row) {
  const entityType = safeString(row.entity_type).toLowerCase();
  if (entityType !== 'ad') return false;

  const entities = Array.isArray(row.entities) ? row.entities : [];
  if (!entities.length) return false;

  return entities.some((entity) => {
    const media = entity.media || {};
    return Boolean(
      safeString(media.primary_url) &&
      (media.has_true_creative_image || media.resolved_from_thumbnail_only)
    );
  });
}

function pickDeterministicMetrics(metrics) {
  const source = metrics || {};

  return {
    spend: toNumber(source.spend),
    conversations: toNumber(source.conversations),
    avgCostConversation: toNumber(source.avgCostConversation),
    clicks: toNumber(source.clicks),
    ctr: toNumber(source.ctr),
    linkCtr: toNumber(source.linkCtr),
    cpc: toNumber(source.cpc),
    costPerLinkClick: toNumber(source.costPerLinkClick),
    cpm: toNumber(source.cpm),
    frequency: toNumber(source.frequency),
    reach: toNumber(source.reach),
    impressions: toNumber(source.impressions),
  };
}

function buildSubjectiveEntityReview(entity) {
  const identity = entity.identity || {};
  const analysis = entity.analysis || {};
  const executiveSummary = analysis.executive_summary || {};
  const creative = entity.creative || {};
  const media = entity.media || {};
  const measurement = entity.measurement || {};
  const taxonomy = entity.taxonomy || {};
  const flags = entity.flags || {};
  const decisionSummary = entity.decision_summary || {};
  const decisionEngine = entity.decision_engine || {};

  return {
    entity_id: safeString(identity.entity_id),
    entity_name: safeString(identity.name),
    creative_id: safeString(identity.creative_id || entity.creative_id || entity.representative_creative_id),
    math_action: safeString(decisionEngine.action || decisionSummary.primary_action),
    priority_level: safeString(analysis.priority_level),
    confidence_gate_level: safeString(decisionSummary.confidence_gate_level),
    deterministic_summary: {
      headline: safeString(executiveSummary.headline),
      main_risk: safeString(executiveSummary.main_risk),
      main_opportunity: safeString(executiveSummary.main_opportunity),
      primary_action: safeString(executiveSummary.primary_action || decisionEngine.action),
    },
    deterministic_metrics: pickDeterministicMetrics(entity.metrics),
    creative_context: {
      primary_title: safeString(creative.primary_title),
      primary_body: safeString(creative.primary_body),
      primary_description: safeString(creative.primary_description),
      primary_link_url: safeString(creative.primary_link_url),
      primary_display_url: safeString(creative.primary_display_url),
      call_to_action_types: uniqueStrings(creative.call_to_action_types || []),
      offer_family: safeString(taxonomy.offer_family),
      creative_structure: safeString(taxonomy.creative_structure),
      creative_name_display: safeString(identity.creative_name_display || creative.creative_name_display),
      prices_detected: uniqueStrings(measurement.detected_prices || []),
    },
    visual_context: {
      primary_url: safeString(media.primary_url),
      thumbnail_url: safeString(media.thumbnail_url),
      has_true_creative_image: !!media.has_true_creative_image,
      resolved_from_thumbnail_only: !!media.resolved_from_thumbnail_only,
      visual_source_confidence: safeString(entity.enrichment?.visual_source_confidence),
      visual_status: safeString(entity.enrichment?.visual_status),
    },
    subjective_hints: {
      has_whatsapp_cta: !!flags.has_whatsapp_cta,
      multi_offer_flag: !!flags.multi_offer_flag,
      offer_conflict_flag: !!flags.offer_conflict_flag,
      low_copy_coherence_flag: !!flags.low_copy_coherence_flag,
      high_creative_complexity_flag: !!flags.high_creative_complexity_flag,
      placement_positions: uniqueStrings(taxonomy.placement_positions_flat || []),
    },
  };
}

function buildSubjectiveReviewPayload(row, groupId, pipelineAudit, groupMeasurement, groupFlags, groupDecisionSummary) {
  const entities = Array.isArray(row.entities) ? row.entities : [];

  return {
    group_id: groupId,
    report_date: safeString(row.report_date),
    entity_type: safeString(row.entity_type),
    category: safeString(row.category),
    category_label: safeString(row.category_label || row.category),
    deterministic_context: {
      report_completeness: safeString(row.report_completeness),
      issue_ratio: toNumber(row.issue_ratio),
      selection_summary: deepClone(row.selection_summary || {}),
      pipeline_audit: {
        visual_rows: toNumber(pipelineAudit.visual_rows),
        direct_visual_rows: toNumber(pipelineAudit.direct_visual_rows),
        thumbnail_fallback_rows: toNumber(pipelineAudit.thumbnail_fallback_rows),
        rows_with_fetch_issues: toNumber(pipelineAudit.rows_with_fetch_issues),
      },
      measurement: {
        total_entities: toNumber(groupMeasurement.total_entities),
        avg_visual_completeness: toNumber(groupMeasurement.avg_visual_completeness),
        avg_creative_complexity_score: toNumber(groupMeasurement.avg_creative_complexity_score),
        avg_copy_coherence_score: toNumber(groupMeasurement.avg_copy_coherence_score),
        avg_confidence_score: toNumber(groupMeasurement.avg_confidence_score),
      },
      group_flags: deepClone(groupFlags || {}),
      decision_summary: deepClone(groupDecisionSummary || {}),
    },
    entities: entities.map(buildSubjectiveEntityReview),
  };
}

function aggregateEntityRows(rows) {
  const buckets = new Map();

  for (const row of rows) {
    const meta = row.meta || {};
    const key = [
      safeString(meta.report_date),
      safeString(meta.entity_type),
      safeString(meta.category),
    ].join('|');

    if (!buckets.has(key)) {
      buckets.set(key, {
        report_date: safeString(meta.report_date),
        entity_type: safeString(meta.entity_type),
        category: safeString(meta.category),
        entities: [],
      });
    }

    buckets.get(key).entities.push(row);
  }

  const entityOrder = ['ad', 'adset', 'campaign'];
  const categoryOrder = ['top_performance', 'piores', 'atencao', 'oportunidades'];

  return [...buckets.values()].sort((left, right) => {
    const entityDelta = entityOrder.indexOf(left.entity_type) - entityOrder.indexOf(right.entity_type);
    if (entityDelta !== 0) return entityDelta;
    return categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category);
  });
}

function buildSourceEntityIndex(sourceItems) {
  const byCreativeId = new Map();
  const fallbackQueue = [];

  for (const item of sourceItems) {
    const json = item?.json || {};
    const creativeId = safeString(
      json.creative_id ||
      json.representative_creative_id ||
      json.creative_context?.representative_creative?.creative_id
    );

    const cloned = deepClone(json);

    if (creativeId) {
      if (!byCreativeId.has(creativeId)) {
        byCreativeId.set(creativeId, []);
      }
      byCreativeId.get(creativeId).push(cloned);
    } else {
      fallbackQueue.push(cloned);
    }
  }

  return { byCreativeId, fallbackQueue };
}

function buildAnalyticsGroupIndex(groupItems) {
  const index = new Map();

  for (const item of groupItems) {
    const json = item?.json || {};
    const key = [
      safeString(json.report_date),
      safeString(json.entity_type),
      safeString(json.category),
    ].join('|');

    if (!key) continue;
    index.set(key, deepClone(json));
  }

  return index;
}

function getSourceEntities(indexData, creativeId) {
  const normalizedCreativeId = safeString(creativeId);
  if (normalizedCreativeId && indexData.byCreativeId.has(normalizedCreativeId)) {
    return deepClone(indexData.byCreativeId.get(normalizedCreativeId) || []);
  }
  return [];
}

function consumeFallbackSourceEntity(indexData) {
  if (indexData.fallbackQueue.length) {
    return deepClone(indexData.fallbackQueue.shift());
  }
  return null;
}

function buildEntityDedupKey(sourceEntity, creativeId) {
  return [
    safeString(sourceEntity.report_date),
    safeString(sourceEntity.entity_type),
    safeString(sourceEntity.category),
    safeString(sourceEntity.entity_id || sourceEntity.ad_id || sourceEntity.adset_id || sourceEntity.campaign_id),
    safeString(sourceEntity.creative_id || sourceEntity.representative_creative_id || creativeId),
  ].join('|');
}

function getDecisionInputs(entity) {
  const metrics = entity.metrics || {};
  const dataQuality = entity.data_quality || {};
  const fatigue = entity.fatigue || {};
  const trend = entity.trend || {};
  const flags = entity.flags || {};
  const measurement = entity.measurement || {};
  const decisionSummary = entity.decision_summary || {};
  const benchmark = entity.benchmark_context || {};
  const analysis = entity.analysis || {};
  const classification = analysis.classification || {};
  const executiveSummary = analysis.executive_summary || {};
  const decision = entity.decision || {};
  const decisionFeatures = decision.features || {};
  const decisionPolicy = decision.policy || {};

  return {
    spend: toNumber(metrics.spend) ?? 0,
    conversations: toNumber(metrics.conversations) ?? 0,
    avgCostConversation: toNumber(metrics.avgCostConversation),
    ctr: toNumber(metrics.ctr),
    linkCtr: toNumber(metrics.linkCtr),
    cpc: toNumber(metrics.cpc),
    costPerLinkClick: toNumber(metrics.costPerLinkClick),
    frequency: toNumber(metrics.frequency),
    clicks: toNumber(metrics.clicks) ?? 0,
    linkClicks: toNumber(metrics.linkClicks) ?? 0,
    uniqueClicks: toNumber(metrics.uniqueClicks) ?? 0,
    uniqueLinkClicks: toNumber(metrics.uniqueLinkClicks) ?? 0,
    repeatLinkClickPressure: toNumber(metrics.repeatLinkClickPressure),
    confidenceScore: toNumber(dataQuality.overall_confidence_score) ?? 0,
    confidenceLabel: safeString(dataQuality.overall_confidence_label),
    fatigueScore: toNumber(fatigue.score) ?? 0,
    fatigueStage: safeString(fatigue.stage),
    trendIsAccelerating: !!trend.flags?.is_accelerating,
    trendIsDeclining: !!trend.flags?.is_declining,
    trendIsStable: !!trend.flags?.is_stable,
    benchmarkCpcvDeltaPct: toNumber(benchmark.deltas?.avgCostConversation?.delta_pct),
    benchmarkCtrDeltaPct: toNumber(benchmark.deltas?.ctr?.delta_pct),
    benchmarkLinkCtrDeltaPct: toNumber(benchmark.deltas?.linkCtr?.delta_pct),
    category: safeString(classification.category || entity.meta?.category),
    score: toNumber(analysis.score),
    priorityScore: toNumber(analysis.priority_score),
    priorityLevel: safeString(analysis.priority_level),
    primaryAction: safeString(executiveSummary.primary_action || decisionSummary.primary_action || decisionPolicy.primary_action),
    shouldBlockAggressiveActions: !!decisionSummary.should_block_aggressive_actions || !!decisionPolicy.should_block_aggressive_actions,
    confidenceGateLevel: safeString(decisionSummary.confidence_gate_level || decisionPolicy.confidence_gate_level || analysis.confidence_gate?.level),
    hasTrueCreativeImage: !!entity.media?.has_true_creative_image,
    resolvedFromThumbnailOnly: !!entity.media?.resolved_from_thumbnail_only,
    visualCompleteness: toNumber(entity.enrichment?.visual_completeness),
    visualSourceConfidence: safeString(entity.enrichment?.visual_source_confidence),
    visualResolutionScore: toNumber(measurement.visual_resolution_score),
    creativeComplexityScore: toNumber(measurement.creative_complexity_score),
    copyCoherenceScore: toNumber(measurement.copy_coherence_score),
    hasWhatsappCta: !!flags.has_whatsapp_cta,
    welcomeMessagePresent: !!flags.welcome_message_present,
    multiOfferFlag: !!flags.multi_offer_flag,
    offerConflictFlag: !!flags.offer_conflict_flag,
    lowCopyCoherenceFlag: !!flags.low_copy_coherence_flag,
    highCreativeComplexityFlag: !!flags.high_creative_complexity_flag,
    missingDirectImageFlag: !!flags.missing_direct_image_flag,
    missingAnyVisualFlag: !!flags.missing_any_visual_flag,
    lowVisualConfidenceFlag: !!flags.low_visual_confidence_flag,
    activeButVisualFallbackOnly: !!flags.active_but_visual_fallback_only,
    decisionFeaturesCount: toNumber(measurement.decision_feature_count) ?? 0,
    trendFromFeaturesAccelerating: !!decisionFeatures.trend_is_accelerating,
    trendFromFeaturesDeclining: !!decisionFeatures.trend_is_declining,
  };
}

function inferCauseHypothesis(input) {
  if (input.confidenceScore < 45) return 'tracking_or_data_quality';
  if (input.missingAnyVisualFlag) return 'creative_asset_missing';
  if (input.offerConflictFlag || input.multiOfferFlag) return 'offer_confusion';
  if (input.lowCopyCoherenceFlag) return 'copy_structure';
  if (input.fatigueScore >= 55) return 'creative_fatigue';
  if (input.trendIsDeclining && input.frequency !== null && input.frequency >= 2.3) return 'audience_saturation';
  if (input.ctr !== null && input.ctr < 1.2 && input.linkCtr !== null && input.linkCtr < 0.7) return 'creative_or_audience';
  if (input.ctr !== null && input.ctr >= 2.0 && input.linkCtr !== null && input.linkCtr < 0.8) return 'cta_or_message_mismatch';
  if (input.linkCtr !== null && input.linkCtr >= 1.0 && input.conversations === 0) return 'post_click_or_whatsapp_entry';
  if (input.avgCostConversation !== null && input.avgCostConversation >= 20) return 'efficiency_problem';
  if (input.trendIsAccelerating) return 'positive_momentum';
  return 'mixed_signal';
}

function inferBudgetRecommendation(action) {
  switch (action) {
    case ACTIONS.SCALE_MODERATE:
      return {
        direction: 'increase',
        pct: 20,
        note: 'Escala moderada por desempenho forte e sinais consistentes.',
      };
    case ACTIONS.SCALE_SMALL:
      return {
        direction: 'increase',
        pct: 10,
        note: 'Escala pequena para validar continuidade da tração.',
      };
    case ACTIONS.REDUCE_BUDGET:
      return {
        direction: 'decrease',
        pct: 20,
        note: 'Redução preventiva por ineficiência ou deterioração.',
      };
    case ACTIONS.PAUSE:
      return {
        direction: 'decrease',
        pct: 100,
        note: 'Pausar até revisão estrutural.',
      };
    default:
      return {
        direction: 'hold',
        pct: 0,
        note: 'Manter orçamento atual.',
      };
  }
}

function inferCreativeRecommendation(action, input) {
  if (action === ACTIONS.REFRESH_CREATIVE) {
    return 'Renovar criativo e revisar ângulo visual/textual.';
  }
  if (input.fatigueScore >= 55) {
    return 'Preparar nova variação criativa por fadiga.';
  }
  if (input.lowCopyCoherenceFlag) {
    return 'Revisar consistência entre título, corpo e CTA.';
  }
  if (input.offerConflictFlag) {
    return 'Simplificar oferta para reduzir conflito de mensagem.';
  }
  if (input.resolvedFromThumbnailOnly) {
    return 'Validar asset visual real antes de decisão criativa final.';
  }
  return 'Sem ajuste criativo obrigatório no nível matemático.';
}

function computeActionConfidence(input, action) {
  let score = 60;

  if (input.confidenceScore >= 80) score += 20;
  else if (input.confidenceScore >= 62) score += 10;
  else if (input.confidenceScore < 45) score -= 25;
  else if (input.confidenceScore < 62) score -= 15;

  if (input.trendIsStable) score += 5;
  if (input.trendIsAccelerating || input.trendIsDeclining) score += 5;

  if (input.multiOfferFlag) score -= 8;
  if (input.offerConflictFlag) score -= 10;
  if (input.lowCopyCoherenceFlag) score -= 8;
  if (input.missingAnyVisualFlag) score -= 10;
  if (input.resolvedFromThumbnailOnly) score -= 6;

  if (action === ACTIONS.REQUEST_HUMAN_REVIEW || action === ACTIONS.REQUEST_AI_REVIEW) {
    score -= 10;
  }

  return clamp(Math.round(score), 0, 100);
}

function decideAction(input) {
  const reasons = [];
  const causeHypothesis = inferCauseHypothesis(input);

  if (input.confidenceScore < 35) {
    reasons.push('Confiança crítica da coleta.');
    return {
      action: ACTIONS.CHECK_TRACKING,
      reason: reasons.join(' '),
      cause_hypothesis: causeHypothesis,
      requires_ai_review: false,
      requires_human_review: true,
    };
  }

  if (input.shouldBlockAggressiveActions && input.confidenceScore < 62) {
    reasons.push('Gate de confiança restringe ação agressiva.');
    return {
      action: ACTIONS.REQUEST_HUMAN_REVIEW,
      reason: reasons.join(' '),
      cause_hypothesis: causeHypothesis,
      requires_ai_review: false,
      requires_human_review: true,
    };
  }

  if (input.spend >= 20 && input.conversations === 0 && ((input.ctr !== null && input.ctr < 1.2) || (input.linkCtr !== null && input.linkCtr < 0.7))) {
    reasons.push('Gasto relevante sem conversa e com CTR fraco.');
    return {
      action: ACTIONS.PAUSE,
      reason: reasons.join(' '),
      cause_hypothesis: causeHypothesis,
      requires_ai_review: input.hasTrueCreativeImage || input.resolvedFromThumbnailOnly,
      requires_human_review: false,
    };
  }

  if (input.spend >= 12 && input.conversations === 0 && input.linkCtr !== null && input.linkCtr >= 1.0) {
    reasons.push('Clique existe, mas não vira conversa.');
    return {
      action: ACTIONS.CHECK_TRACKING,
      reason: reasons.join(' '),
      cause_hypothesis: 'post_click_or_whatsapp_entry',
      requires_ai_review: false,
      requires_human_review: false,
    };
  }

  if (input.avgCostConversation !== null && input.avgCostConversation >= 20 && input.spend >= 10) {
    reasons.push('CPCv alto em volume já relevante.');
    if (input.offerConflictFlag || input.multiOfferFlag) {
      return {
        action: ACTIONS.REVIEW_OFFER,
        reason: reasons.concat(['Sinais de oferta conflitante.']).join(' '),
        cause_hypothesis: 'offer_confusion',
        requires_ai_review: true,
        requires_human_review: false,
      };
    }
    if (input.fatigueScore >= 55) {
      return {
        action: ACTIONS.REFRESH_CREATIVE,
        reason: reasons.concat(['Fadiga elevada.']).join(' '),
        cause_hypothesis: 'creative_fatigue',
        requires_ai_review: true,
        requires_human_review: false,
      };
    }
    return {
      action: ACTIONS.REDUCE_BUDGET,
      reason: reasons.join(' '),
      cause_hypothesis: causeHypothesis,
      requires_ai_review: true,
      requires_human_review: false,
    };
  }

  if (
    input.conversations >= 3 &&
    input.avgCostConversation !== null &&
    input.avgCostConversation <= 12 &&
    (
      (input.ctr !== null && input.ctr >= 2.0) ||
      (input.linkCtr !== null && input.linkCtr >= 1.0)
    ) &&
    input.confidenceScore >= 62
  ) {
    reasons.push('Desempenho forte com eficiência saudável.');

    if (input.fatigueScore >= 55) {
      return {
        action: ACTIONS.REFRESH_CREATIVE,
        reason: reasons.concat(['Escala bloqueada por fadiga.']).join(' '),
        cause_hypothesis: 'creative_fatigue',
        requires_ai_review: true,
        requires_human_review: false,
      };
    }

    if (input.trendIsAccelerating && !input.shouldBlockAggressiveActions) {
      return {
        action: ACTIONS.SCALE_MODERATE,
        reason: reasons.concat(['Aceleração recente detectada.']).join(' '),
        cause_hypothesis: 'positive_momentum',
        requires_ai_review: true,
        requires_human_review: false,
      };
    }

    return {
      action: ACTIONS.SCALE_SMALL,
      reason: reasons.join(' '),
      cause_hypothesis: 'positive_momentum',
      requires_ai_review: true,
      requires_human_review: false,
    };
  }

  if (
    input.spend >= 3 &&
    input.conversations === 0 &&
    (
      (input.ctr !== null && input.ctr >= 2.0) ||
      (input.linkCtr !== null && input.linkCtr >= 1.0)
    ) &&
    (input.cpc !== null && input.cpc <= 1.5)
  ) {
    reasons.push('Há tração de clique com baixa conversão em conversa.');
    return {
      action: ACTIONS.CHECK_TRACKING,
      reason: reasons.join(' '),
      cause_hypothesis: 'post_click_or_whatsapp_entry',
      requires_ai_review: false,
      requires_human_review: false,
    };
  }

  if (input.fatigueScore >= 55 && input.conversations >= 1) {
    reasons.push('Saturação alta com sinal de fadiga.');
    return {
      action: ACTIONS.REFRESH_CREATIVE,
      reason: reasons.join(' '),
      cause_hypothesis: 'creative_fatigue',
      requires_ai_review: true,
      requires_human_review: false,
    };
  }

  if (input.trendIsDeclining && input.spend >= 10) {
    reasons.push('Queda recente com gasto relevante.');
    return {
      action: ACTIONS.REDUCE_BUDGET,
      reason: reasons.join(' '),
      cause_hypothesis: causeHypothesis,
      requires_ai_review: true,
      requires_human_review: false,
    };
  }

  if (input.offerConflictFlag || input.multiOfferFlag) {
    reasons.push('Oferta múltipla ou conflitante detectada.');
    return {
      action: ACTIONS.REVIEW_OFFER,
      reason: reasons.join(' '),
      cause_hypothesis: 'offer_confusion',
      requires_ai_review: true,
      requires_human_review: false,
    };
  }

  if (input.lowCopyCoherenceFlag || input.highCreativeComplexityFlag) {
    reasons.push('Estrutura criativa/copy pode estar reduzindo clareza.');
    return {
      action: ACTIONS.REQUEST_AI_REVIEW,
      reason: reasons.join(' '),
      cause_hypothesis: 'copy_structure',
      requires_ai_review: true,
      requires_human_review: false,
    };
  }

  if (input.missingAnyVisualFlag) {
    reasons.push('Sem visual utilizável para leitura criativa.');
    return {
      action: ACTIONS.REQUEST_HUMAN_REVIEW,
      reason: reasons.join(' '),
      cause_hypothesis: 'creative_asset_missing',
      requires_ai_review: false,
      requires_human_review: true,
    };
  }

  reasons.push('Sem trigger matemático forte para mudança operacional.');
  return {
    action: ACTIONS.HOLD,
    reason: reasons.join(' '),
    cause_hypothesis: causeHypothesis,
    requires_ai_review: input.resolvedFromThumbnailOnly || input.hasTrueCreativeImage,
    requires_human_review: false,
  };
}

function buildEntityDecision(entity) {
  const input = getDecisionInputs(entity);
  const baseDecision = decideAction(input);
  const actionConfidence = computeActionConfidence(input, baseDecision.action);
  const budgetRecommendation = inferBudgetRecommendation(baseDecision.action);
  const creativeRecommendation = inferCreativeRecommendation(baseDecision.action, input);

  const mathematicalConclusion = {
    should_scale: [ACTIONS.SCALE_SMALL, ACTIONS.SCALE_MODERATE].includes(baseDecision.action),
    should_reduce: [ACTIONS.REDUCE_BUDGET, ACTIONS.PAUSE].includes(baseDecision.action),
    should_refresh_creative: baseDecision.action === ACTIONS.REFRESH_CREATIVE,
    should_check_tracking: baseDecision.action === ACTIONS.CHECK_TRACKING,
    should_review_offer: baseDecision.action === ACTIONS.REVIEW_OFFER,
    should_hold: baseDecision.action === ACTIONS.HOLD,
  };

  return {
    action: baseDecision.action,
    action_reason: baseDecision.reason,
    action_confidence: actionConfidence,
    action_confidence_label:
      actionConfidence >= 80 ? 'high' :
      actionConfidence >= 60 ? 'medium' :
      actionConfidence >= 40 ? 'low' : 'very_low',
    cause_hypothesis: baseDecision.cause_hypothesis,
    budget_recommendation: budgetRecommendation,
    creative_recommendation: creativeRecommendation,
    requires_ai_review: !!baseDecision.requires_ai_review,
    requires_human_review: !!baseDecision.requires_human_review,
    mathematical_conclusion: mathematicalConclusion,
    inputs_snapshot: {
      spend: input.spend,
      conversations: input.conversations,
      avgCostConversation: input.avgCostConversation,
      ctr: input.ctr,
      linkCtr: input.linkCtr,
      cpc: input.cpc,
      costPerLinkClick: input.costPerLinkClick,
      frequency: input.frequency,
      confidenceScore: input.confidenceScore,
      fatigueScore: input.fatigueScore,
      trendIsAccelerating: input.trendIsAccelerating,
      trendIsDeclining: input.trendIsDeclining,
      benchmarkCpcvDeltaPct: input.benchmarkCpcvDeltaPct,
      benchmarkCtrDeltaPct: input.benchmarkCtrDeltaPct,
      benchmarkLinkCtrDeltaPct: input.benchmarkLinkCtrDeltaPct,
      confidenceGateLevel: input.confidenceGateLevel,
    },
  };
}

const creativeRows = items.map(item => item.json).filter(Boolean);
const sourceItems = safeAll('Split Out (1)');
const analyticsGroupIndex = buildAnalyticsGroupIndex(safeAll('Code - Analytics Core'));
const sourceIndex = buildSourceEntityIndex(sourceItems);

if (!creativeRows.length) {
  return [];
}

const flatEntities = [];
const usedEntityKeys = new Set();

for (const creative of creativeRows) {
  const creativeId = safeString(creative.id);
  let sourceEntities = getSourceEntities(sourceIndex, creativeId);

  if (!sourceEntities.length) {
    const fallbackEntity = consumeFallbackSourceEntity(sourceIndex);
    if (fallbackEntity) sourceEntities = [fallbackEntity];
  }

  for (const sourceEntity of sourceEntities) {
    const dedupKey = buildEntityDedupKey(sourceEntity, creativeId);
    if (usedEntityKeys.has(dedupKey)) continue;
    usedEntityKeys.add(dedupKey);

    const entityType = safeString(sourceEntity.entity_type);
    const category = safeString(sourceEntity.category);
    const reportDate = safeString(sourceEntity.report_date);

    const creativeName = safeString(creative.name);
    const thumbnailUrl = safeString(creative.thumbnail_url);
    const creativeImageUrl = safeString(creative.image_url);
    const effectiveInstagramMediaId = safeString(creative.effective_instagram_media_id);
    const objectType = safeString(creative.object_type);
    const previewShareableLink = safeString(creative.preview_shareable_link);

    const pageId = safeString(creative.object_story_spec?.page_id);
    const instagramUserId = safeString(
      creative.object_story_spec?.instagram_user_id ||
      creative.object_story_spec?.instagram_actor_id
    );

    const entityId = safeString(sourceEntity.entity_id);
    const adId = safeString(sourceEntity.ad_id || sourceEntity.entity_id);
    const adsetId = safeString(sourceEntity.adset_id);
    const campaignId = safeString(sourceEntity.campaign_id);
    const entityStatus = safeString(sourceEntity.status || creative.status);
    const effectiveStatus = safeString(sourceEntity.effective_status || creative.effective_status);

    const creativeImagesRaw = Array.isArray(creative.asset_feed_spec?.images)
      ? creative.asset_feed_spec.images
      : [];

    const customizationRules = Array.isArray(creative.asset_feed_spec?.asset_customization_rules)
      ? creative.asset_feed_spec.asset_customization_rules
      : [];

    const titles = Array.isArray(creative.asset_feed_spec?.titles)
      ? creative.asset_feed_spec.titles.map(t => safeString(t.text)).filter(Boolean)
      : [];

    const bodies = Array.isArray(creative.asset_feed_spec?.bodies)
      ? creative.asset_feed_spec.bodies.map(t => safeString(t.text)).filter(Boolean)
      : [];

    const descriptions = Array.isArray(creative.asset_feed_spec?.descriptions)
      ? creative.asset_feed_spec.descriptions.map(t => safeString(t.text)).filter(Boolean)
      : [];

    const linkUrls = Array.isArray(creative.asset_feed_spec?.link_urls)
      ? creative.asset_feed_spec.link_urls.map(link => ({
          website_url: safeString(link.website_url),
          display_url: safeString(link.display_url),
        }))
      : [];

    const callToActionTypes = Array.isArray(creative.asset_feed_spec?.call_to_action_types)
      ? creative.asset_feed_spec.call_to_action_types.map(v => safeString(v)).filter(Boolean)
      : [];

    const callToActions = Array.isArray(creative.asset_feed_spec?.call_to_actions)
      ? creative.asset_feed_spec.call_to_actions.map(v => deepClone(v))
      : [];

    const additionalData = deepClone(creative.asset_feed_spec?.additional_data || {});
    const welcomeSignals = extractWelcomeMessageSignals(additionalData);

    const imagesRequested = uniqueBy(
      creativeImagesRaw
        .map((img, imageIndex) => {
          const adlabels = Array.isArray(img.adlabels) ? img.adlabels : [];
          return {
            hash: safeString(img.hash),
            image_index: imageIndex,
            adlabel_ids: adlabels.map(label => safeString(label.id)).filter(Boolean),
            adlabel_names: adlabels.map(label => safeString(label.name)).filter(Boolean),
            image_crops: img.image_crops ?? null,
          };
        })
        .filter(img => img.hash),
      item => item.hash
    );

    const sortedRules = [...customizationRules]
      .filter(rule => isObject(rule))
      .sort((a, b) => normalizePriority(a.priority) - normalizePriority(b.priority));

    let primaryHash = '';
    let primaryImageLabelId = '';
    let primaryImageLabelName = '';
    let primaryRulePriority = null;

    for (const rule of sortedRules) {
      const targetImageLabelId = safeString(rule?.image_label?.id);
      const targetImageLabelName = safeString(rule?.image_label?.name);

      if (!targetImageLabelId) continue;

      const matchedRequested = imagesRequested.find(img =>
        Array.isArray(img.adlabel_ids) && img.adlabel_ids.includes(targetImageLabelId)
      );

      if (matchedRequested?.hash) {
        primaryHash = matchedRequested.hash;
        primaryImageLabelId = targetImageLabelId;
        primaryImageLabelName = targetImageLabelName;
        primaryRulePriority = Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : null;
        break;
      }
    }

    if (!primaryHash && imagesRequested.length) {
      primaryHash = imagesRequested[0].hash;
    }

    const primaryImageRequested =
      imagesRequested.find(img => img.hash === primaryHash) ||
      imagesRequested[0] ||
      null;

    const primaryImage = creativeImageUrl
      ? {
          hash: primaryImageRequested?.hash || primaryHash || '',
          image_index: primaryImageRequested?.image_index ?? null,
          adlabel_ids: primaryImageRequested?.adlabel_ids || [],
          adlabel_names: primaryImageRequested?.adlabel_names || [],
          image_crops: primaryImageRequested?.image_crops ?? null,
          found: true,
          url: creativeImageUrl,
          permalink_url: '',
          original_width: null,
          original_height: null,
          adimage_id: '',
          is_primary: true,
          source: 'creative_image_url',
        }
      : thumbnailUrl
        ? {
            hash: primaryImageRequested?.hash || primaryHash || '',
            image_index: primaryImageRequested?.image_index ?? null,
            adlabel_ids: primaryImageRequested?.adlabel_ids || [],
            adlabel_names: primaryImageRequested?.adlabel_names || [],
            image_crops: primaryImageRequested?.image_crops ?? null,
            found: false,
            url: thumbnailUrl,
            permalink_url: '',
            original_width: null,
            original_height: null,
            adimage_id: '',
            is_primary: true,
            source: 'thumbnail_fallback',
          }
        : null;

    const visualStatus = creativeImageUrl
      ? 'resolved_creative_image'
      : thumbnailUrl
        ? 'fallback_thumbnail'
        : 'no_visual';

    const primaryTitle = titles[0] || '';
    const primaryBody = bodies[0] || '';
    const primaryDescription = descriptions[0] || '';
    const primaryLink = linkUrls[0] || { website_url: '', display_url: '' };

    const selectedUrl = safeString(primaryImage?.url);
    const selectedSource = safeString(primaryImage?.source);
    const fallbackLevel = creativeImageUrl ? 1 : thumbnailUrl ? 4 : 999;

    const extension = 'jpg';
    const baseName =
      slugify(primaryTitle) ||
      slugify(creativeName) ||
      `creative_${creativeId}`;

    const fileName = `${baseName}_${creativeId}.${extension}`;
    const imageCatalogMatchCount = 0;

    const entityCreativeId = safeString(
      sourceEntity.creative_id ||
      sourceEntity.representative_creative_id ||
      creativeId
    );

    const placementCoverage = computePlacementCoverage(customizationRules);

    const allCreativeText = [
      creativeName,
      primaryTitle,
      primaryBody,
      primaryDescription,
      titles.join(' '),
      bodies.join(' '),
      descriptions.join(' '),
    ].join(' ');

    const detectedPrices = uniqueStrings([
      ...extractPrices(primaryTitle),
      ...extractPrices(primaryBody),
      ...extractPrices(primaryDescription),
      ...extractPrices(titles.join(' ')),
      ...extractPrices(bodies.join(' ')),
      ...extractPrices(descriptions.join(' ')),
    ]);

    const offerFamily = inferOfferFamily(allCreativeText);

    const uniqueTitleTokens = new Set(titles.flatMap(tokenize));
    const uniqueBodyTokens = new Set(bodies.flatMap(tokenize));
    const overlapTokens = [...uniqueTitleTokens].filter(token => uniqueBodyTokens.has(token));

    const copyCoherenceScore = (() => {
      if (!uniqueTitleTokens.size && !uniqueBodyTokens.size) return 0;
      const denom = Math.max(uniqueTitleTokens.size, uniqueBodyTokens.size, 1);
      return Number((overlapTokens.length / denom).toFixed(2));
    })();

    const creativeComplexityScore = Number(Math.min(1,
      (titles.length > 1 ? 0.2 : titles.length ? 0.1 : 0) +
      (bodies.length > 1 ? 0.2 : bodies.length ? 0.1 : 0) +
      (descriptions.length > 0 ? 0.05 : 0) +
      (imagesRequested.length > 1 ? 0.2 : imagesRequested.length ? 0.1 : 0) +
      (placementCoverage.placement_rules_count > 1 ? 0.2 : placementCoverage.placement_rules_count ? 0.1 : 0) +
      (callToActionTypes.length > 0 ? 0.05 : 0) +
      (linkUrls.length > 0 ? 0.05 : 0) +
      (welcomeSignals.icebreakers_count > 0 || welcomeSignals.has_autofill_text ? 0.05 : 0)
    ).toFixed(2));

    const visualPayload = {
      creative_id: entityCreativeId,
      creative_name: creativeName,
      thumbnail_url: thumbnailUrl,
      effective_instagram_media_id: effectiveInstagramMediaId,
      object_type: objectType,
      page_id: pageId,
      instagram_user_id: instagramUserId,
      visual_status: visualStatus,
      visual_strategy: 'get_creative_direct_image_or_thumbnail',
      visual_source_confidence: getVisualSourceConfidence(visualStatus),
      resolved_from_thumbnail_only: visualStatus === 'fallback_thumbnail',
      has_true_creative_image: visualStatus === 'resolved_creative_image',
      image_catalog_match_count: imageCatalogMatchCount,
      images_requested_count: imagesRequested.length,
      primary_image_hash: primaryHash || '',
      primary_image_label_id: primaryImageLabelId,
      primary_image_label_name: primaryImageLabelName,
      primary_rule_priority: primaryRulePriority,
      primary_image: primaryImage,
      images_requested: imagesRequested,
      image_catalog_source: null,
      titles,
      bodies,
      descriptions,
      link_urls: linkUrls,
      call_to_action_types: callToActionTypes,
      primary_title: primaryTitle,
      primary_body: primaryBody,
      primary_description: primaryDescription,
      primary_link_url: primaryLink.website_url,
      primary_display_url: primaryLink.display_url,
      download_url: selectedUrl,
      download_source: selectedSource,
      fallback_level: fallbackLevel,
      has_download_url: !!selectedUrl,
      file_name: fileName,
      mime_type: 'image/jpeg',
    };

    const visualCompleteness = countVisualCompleteness(visualPayload);
    const visualResolutionScore = computeVisualResolutionScore(visualStatus);
    const metrics = deepClone(sourceEntity.metrics ?? {});
    const entityMeta = ENTITY_META[entityType] || { singular: 'ITEM', plural: 'ITENS' };
    const categoryMeta = CATEGORY_META[category] || { emoji: '📌', label: safeString(category).toUpperCase() };

    const flags = {
      is_thumbnail_fallback_only: visualStatus === 'fallback_thumbnail',
      has_true_creative_image: visualStatus === 'resolved_creative_image',
      missing_direct_image_flag: visualStatus !== 'resolved_creative_image',
      missing_any_visual_flag: visualStatus === 'no_visual',
      low_visual_confidence_flag: getVisualSourceConfidence(visualStatus) !== 'high',
      missing_preview_link_flag: !previewShareableLink,
      missing_primary_link_flag: !safeString(primaryLink.website_url),
      has_whatsapp_cta: callToActionTypes.includes('WHATSAPP_MESSAGE') || detectWhatsAppSignal(allCreativeText),
      welcome_message_present: welcomeSignals.raw_present,
      has_icebreakers: welcomeSignals.icebreakers_count > 0,
      multi_offer_flag: detectedPrices.length > 1,
      offer_conflict_flag: detectedPrices.length > 1 && offerFamily === 'unclassified',
      low_copy_coherence_flag: copyCoherenceScore < 0.2 && (titles.length > 1 || bodies.length > 1),
      high_creative_complexity_flag: creativeComplexityScore >= 0.75,
      active_but_visual_fallback_only:
        ['ACTIVE', 'PAUSED', 'ARCHIVED', 'WITH_ISSUES'].includes(effectiveStatus.toUpperCase()) &&
        visualStatus === 'fallback_thumbnail',
    };

    const measurement = {
      titles_count: titles.length,
      bodies_count: bodies.length,
      descriptions_count: descriptions.length,
      link_urls_count: linkUrls.length,
      call_to_action_types_count: callToActionTypes.length,
      call_to_actions_count: callToActions.length,
      images_requested_count: imagesRequested.length,
      unique_image_labels_count: uniqueStrings(
        imagesRequested.flatMap(img => Array.isArray(img.adlabel_ids) ? img.adlabel_ids : [])
      ).length,
      unique_image_label_names_count: uniqueStrings(
        imagesRequested.flatMap(img => Array.isArray(img.adlabel_names) ? img.adlabel_names : [])
      ).length,
      placement_rules_count: placementCoverage.placement_rules_count,
      placement_platforms_count: placementCoverage.placement_platforms.length,
      placement_positions_count: placementCoverage.placement_positions_flat.length,
      visual_completeness: visualCompleteness,
      visual_resolution_score: visualResolutionScore,
      copy_coherence_score: copyCoherenceScore,
      creative_complexity_score: creativeComplexityScore,
      detected_prices_count: detectedPrices.length,
      welcome_message_icebreakers_count: welcomeSignals.icebreakers_count,
      has_preview_link: !!previewShareableLink,
      has_primary_link_url: !!safeString(primaryLink.website_url),
      decision_feature_count: isObject(sourceEntity.decision_features) ? Object.keys(sourceEntity.decision_features).length : 0,
    };

    const taxonomy = {
      cta_type_primary: callToActionTypes[0] || '',
      cta_types: callToActionTypes,
      cta_destination: detectWhatsAppSignal(primaryLink.website_url) || callToActionTypes.includes('WHATSAPP_MESSAGE')
        ? 'whatsapp'
        : safeString(primaryLink.website_url)
          ? 'website'
          : 'unknown',
      offer_family: offerFamily,
      unit_key: [pageId, instagramUserId].filter(Boolean).join('__') || '',
      creative_structure: inferCreativeStructure(
        {
          titles,
          bodies,
          link_urls: linkUrls,
        },
        imagesRequested,
        customizationRules
      ),
      visual_resolution_mode: visualStatus,
      optimization_type: safeString(creative.asset_feed_spec?.optimization_type),
      object_type: objectType,
      entity_status: entityStatus,
      effective_status: effectiveStatus,
    };

    const decisionSummaryBase = summarizeDecision({
      decision: {
        features: deepClone(sourceEntity.decision_features || {}),
        policy: deepClone(sourceEntity.decision_policy || {}),
      },
      analysis: {
        executive_summary: deepClone(sourceEntity.executive_summary || {}),
        classification: deepClone(sourceEntity.classification || {}),
        priority_level: safeString(sourceEntity.priority_level),
      },
    });

    const entity = {
      meta: {
        report_date: reportDate,
        entity_type: entityType,
        entity_label: entityMeta.singular,
        entity_label_plural: entityMeta.plural,
        category,
        category_label: categoryMeta.label,
        category_emoji: categoryMeta.emoji,
        group_type: 'performance_category_group',
        entity_index: null,
        total_entities: null,
        entity_position_label: '',
      },

      identity: {
        entity_id: entityId,
        ad_id: adId,
        adset_id: adsetId,
        campaign_id: campaignId,
        name: safeString(sourceEntity.name || sourceEntity.ad_name || creativeName),
        ad_name: safeString(sourceEntity.ad_name || sourceEntity.name),
        creative_id: entityCreativeId,
        creative_name_display: creativeName,
      },

      analysis: {
        score: toNumber(sourceEntity.score),
        priority_score: toNumber(sourceEntity.priority_score),
        priority_level: safeString(sourceEntity.priority_level),
        executive_summary: deepClone(sourceEntity.executive_summary ?? null),
        classification: deepClone(sourceEntity.classification ?? null),
        priority: deepClone(sourceEntity.priority ?? null),
        confidence_gate: deepClone(sourceEntity.confidence_gate ?? null),
      },

      metrics: metrics,
      window_metrics: deepClone(sourceEntity.window_metrics ?? {}),
      metric_provenance: deepClone(sourceEntity.metric_provenance ?? {}),
      trend: deepClone(sourceEntity.trend ?? {}),
      fatigue: deepClone(sourceEntity.fatigue ?? {}),
      data_quality: deepClone(sourceEntity.data_quality ?? {}),
      benchmark_context: deepClone(sourceEntity.benchmark_context ?? {}),
      breakdown_insights: deepClone(sourceEntity.breakdown_insights ?? {}),
      visual_enrichment_base: deepClone(sourceEntity.visual_enrichment ?? {}),
      representation_strategy: deepClone(sourceEntity.representation_strategy ?? {}),
      delivery_context: deepClone(sourceEntity.delivery_context ?? {}),
      platform_refs: deepClone(sourceEntity.platform_refs ?? {}),
      confidence_gate: deepClone(sourceEntity.confidence_gate ?? {}),
      decision: {
        features: deepClone(sourceEntity.decision_features ?? {}),
        policy: deepClone(sourceEntity.decision_policy ?? {}),
      },

      creative: {
        creative_id: entityCreativeId,
        creative_name_display: creativeName,
        preview_shareable_link: previewShareableLink,
        primary_title: primaryTitle,
        primary_description: primaryDescription,
        primary_body: primaryBody,
        titles,
        bodies,
        descriptions,
        link_urls: linkUrls,
        call_to_action_types: callToActionTypes,
        call_to_actions: callToActions,
        primary_link_url: primaryLink.website_url,
        primary_display_url: primaryLink.display_url,
        additional_data: additionalData,
      },

      media: {
        primary_url: selectedUrl,
        primary_link_url: primaryLink.website_url,
        thumbnail_url: thumbnailUrl,
        download_source: selectedSource,
        fallback_level: fallbackLevel,
        has_download_url: !!selectedUrl,
        has_true_creative_image: visualStatus === 'resolved_creative_image',
        resolved_from_thumbnail_only: visualStatus === 'fallback_thumbnail',
        file_name: fileName,
        mime_type: 'image/jpeg',
        gallery: [],
      },

      measurement,
      flags,
      taxonomy,
      decision_summary: decisionSummaryBase,

      operational: {
        status: entityStatus,
        effective_status: effectiveStatus,
        preview_shareable_link: previewShareableLink,
        page_id: pageId,
        instagram_user_id: instagramUserId,
        effective_instagram_media_id: effectiveInstagramMediaId,
        operational_trace: {
          campaign_id: campaignId,
          adset_id: adsetId,
          ad_id: adId,
          creative_id: entityCreativeId,
        },
      },

      conversation_entry: {
        is_click_to_whatsapp: flags.has_whatsapp_cta,
        welcome_message_present: welcomeSignals.raw_present,
        welcome_message_parsed: welcomeSignals.parsed_present,
        welcome_message_autofill_text: welcomeSignals.autofill_text,
        welcome_message_greeting_text: welcomeSignals.greeting_text,
        icebreakers: welcomeSignals.icebreakers,
        icebreakers_count: welcomeSignals.icebreakers_count,
      },

      enrichment: {
        visual_status: visualStatus,
        visual_completeness: visualCompleteness,
        visual_source_confidence: getVisualSourceConfidence(visualStatus),
        visual_enrichment: {
          status: visualStatus === 'resolved_creative_image'
            ? 'completed'
            : visualStatus === 'fallback_thumbnail'
              ? 'completed_with_fallback'
              : 'partial',
          strategy: 'get_creative_direct_image_or_thumbnail',
          representative_creative_id: entityCreativeId,
          requires_get_creative: true,
          requires_get_image: false,
          used_get_creative: true,
          used_get_image: false,
          visual_completeness: visualCompleteness,
          visual_source_confidence: getVisualSourceConfidence(visualStatus),
          resolved_from_thumbnail_only: visualStatus === 'fallback_thumbnail',
          match_strategy: 'creative_id',
          matched_source_entity: !!safeString(
            sourceEntity.entity_id ||
            sourceEntity.ad_id ||
            sourceEntity.adset_id ||
            sourceEntity.campaign_id
          ),
          inherited_visual_enrichment: deepClone(sourceEntity.visual_enrichment ?? null),
        },
        visual: {
          ...visualPayload,
          visual_completeness: visualCompleteness,
        },
      },

      messages: {
        entity_message_text: '',
      },

      group_context: {
        total_entities: null,
        entity_position_label: '',
      },
    };

    entity.decision_engine = buildEntityDecision(entity);

    flatEntities.push(entity);
  }
}

const groupedRows = aggregateEntityRows(flatEntities);
const results = [];

for (const row of groupedRows) {
  const groupKey = [safeString(row.report_date), safeString(row.entity_type), safeString(row.category)].join('|');
  const analyticsGroup = analyticsGroupIndex.get(groupKey) || {};
  const pipelineAudit = deepClone(analyticsGroup.pipeline_audit || {});
  pipelineAudit.visual_enrichment_deferred = false;
  pipelineAudit.visual_enrichment_completed = true;

  const mediaUrls = uniqueBy(
    row.entities
      .map(entity => ({
        entity_id: safeString(entity.identity?.entity_id),
        creative_id: safeString(entity.identity?.creative_id),
        creative_name: safeString(entity.identity?.creative_name_display),
        url: safeString(entity.media?.primary_url),
        file_name: safeString(entity.media?.file_name),
        mime_type: safeString(entity.media?.mime_type || 'image/jpeg'),
        has_true_creative_image: !!entity.media?.has_true_creative_image,
        resolved_from_thumbnail_only: !!entity.media?.resolved_from_thumbnail_only,
      }))
      .filter(item => item.url),
    item => `${item.entity_id}|${item.url}`
  );

  const visualRows = row.entities.filter(entity => safeString(entity.media?.primary_url)).length;
  const directVisualRows = row.entities.filter(entity => entity.media?.has_true_creative_image).length;
  const thumbnailFallbackRows = row.entities.filter(entity => entity.media?.resolved_from_thumbnail_only).length;

  pipelineAudit.visual_rows = visualRows;
  pipelineAudit.visual_assets_count = mediaUrls.length;
  pipelineAudit.direct_visual_rows = directVisualRows;
  pipelineAudit.thumbnail_fallback_rows = thumbnailFallbackRows;

  row.pipeline_audit = pipelineAudit;
  row.report_completeness = safeString(analyticsGroup.report_completeness || pipelineAudit.report_completeness || 'complete');
  row.issue_ratio = analyticsGroup.issue_ratio ?? pipelineAudit.issue_ratio ?? 0;
  row.selection_summary = deepClone(analyticsGroup.selection_summary || {});

  row.entities.forEach((entity, index) => {
    const entityIndex = index + 1;
    const totalEntities = row.entities.length;
    const positionLabel = `${entityIndex}/${totalEntities}`;

    entity.meta.entity_index = entityIndex;
    entity.meta.total_entities = totalEntities;
    entity.meta.entity_position_label = positionLabel;

    entity.group_context.total_entities = totalEntities;
    entity.group_context.entity_position_label = positionLabel;

    entity.media.gallery = mediaUrls.filter(
      m => safeString(m.entity_id) === safeString(entity.identity?.entity_id)
    );

    entity.decision_summary = {
      ...deepClone(entity.decision_summary || {}),
      primary_action: safeString(entity.decision_engine?.action || entity.decision_summary?.primary_action),
      confidence_gate_level: safeString(entity.decision_summary?.confidence_gate_level || entity.confidence_gate?.level || ''),
      should_block_aggressive_actions:
        !!entity.decision_engine?.mathematical_conclusion &&
        !!(entity.decision_summary?.should_block_aggressive_actions || entity.confidence_gate?.should_block_aggressive_actions),
    };

    entity.messages.entity_message_text = buildEntityMessage(entity);
  });

  const actionCounts = countBy(row.entities, entity => entity.decision_engine?.action);
  const aiReviewCount = row.entities.filter(entity => entity.decision_engine?.requires_ai_review).length;
  const humanReviewCount = row.entities.filter(entity => entity.decision_engine?.requires_human_review).length;
  const dominantAction = Object.entries(actionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const blockedEntities = row.entities.filter(entity => entity.decision_summary?.confidence_gate_level === 'blocked').length;
  const restrictedEntities = row.entities.filter(entity => entity.decision_summary?.confidence_gate_level === 'restricted').length;
  const cautionEntities = row.entities.filter(entity => entity.decision_summary?.confidence_gate_level === 'caution').length;
  const aggressiveBlockedEntities = row.entities.filter(entity => entity.decision_summary?.should_block_aggressive_actions).length;

  const groupMeasurement = {
    total_entities: row.entities.length,
    visual_rows: visualRows,
    direct_visual_rows: directVisualRows,
    thumbnail_fallback_rows: thumbnailFallbackRows,
    avg_visual_completeness: Number((
      row.entities.reduce((sum, entity) => sum + (toNumber(entity.enrichment?.visual_completeness) || 0), 0) /
      Math.max(row.entities.length, 1)
    ).toFixed(2)),
    avg_creative_complexity_score: Number((
      row.entities.reduce((sum, entity) => sum + (toNumber(entity.measurement?.creative_complexity_score) || 0), 0) /
      Math.max(row.entities.length, 1)
    ).toFixed(2)),
    avg_copy_coherence_score: Number((
      row.entities.reduce((sum, entity) => sum + (toNumber(entity.measurement?.copy_coherence_score) || 0), 0) /
      Math.max(row.entities.length, 1)
    ).toFixed(2)),
    avg_action_urgency_score: Number((
      row.entities.reduce((sum, entity) => sum + (toNumber(entity.analysis?.priority_score) || 0), 0) /
      Math.max(row.entities.length, 1)
    ).toFixed(2)),
    avg_confidence_score: Number((
      row.entities.reduce((sum, entity) => sum + (toNumber(entity.data_quality?.overall_confidence_score) || 0), 0) /
      Math.max(row.entities.length, 1)
    ).toFixed(2)),
    whatsapp_cta_entities: row.entities.filter(entity => entity.flags?.has_whatsapp_cta).length,
    welcome_message_entities: row.entities.filter(entity => entity.flags?.welcome_message_present).length,
    multi_offer_entities: row.entities.filter(entity => entity.flags?.multi_offer_flag).length,
    missing_direct_image_entities: row.entities.filter(entity => entity.flags?.missing_direct_image_flag).length,
    blocked_entities: blockedEntities,
    restricted_entities: restrictedEntities,
    caution_entities: cautionEntities,
    aggressive_blocked_entities: aggressiveBlockedEntities,
  };

  const groupFlags = {
    has_any_direct_visual: directVisualRows > 0,
    has_any_thumbnail_fallback: thumbnailFallbackRows > 0,
    all_visuals_are_fallback: visualRows > 0 && directVisualRows === 0 && thumbnailFallbackRows === visualRows,
    has_any_multi_offer: row.entities.some(entity => entity.flags?.multi_offer_flag),
    has_any_offer_conflict: row.entities.some(entity => entity.flags?.offer_conflict_flag),
    has_any_low_copy_coherence: row.entities.some(entity => entity.flags?.low_copy_coherence_flag),
    has_any_blocked_entity: blockedEntities > 0,
    has_any_restricted_entity: restrictedEntities > 0,
    should_block_aggressive_group_action: aggressiveBlockedEntities > 0,
  };

  const groupTaxonomy = {
    entity_type: safeString(row.entity_type),
    category: safeString(row.category),
    unit_keys: uniqueStrings(row.entities.map(entity => entity.taxonomy?.unit_key)),
    offer_families: uniqueStrings(row.entities.map(entity => entity.taxonomy?.offer_family)),
    cta_types: uniqueStrings(row.entities.flatMap(entity => entity.taxonomy?.cta_types || [])),
    creative_structures: uniqueStrings(row.entities.map(entity => entity.taxonomy?.creative_structure)),
    visual_resolution_modes: uniqueStrings(row.entities.map(entity => entity.taxonomy?.visual_resolution_mode)),
    confidence_gate_levels: uniqueStrings(row.entities.map(entity => entity.decision_summary?.confidence_gate_level)),
    primary_actions: uniqueStrings(row.entities.map(entity => entity.decision_engine?.action)),
  };

  const groupDecisionSummary = {
    blocked_entities: blockedEntities,
    restricted_entities: restrictedEntities,
    caution_entities: cautionEntities,
    aggressive_blocked_entities: aggressiveBlockedEntities,
    primary_actions: uniqueStrings(row.entities.map(entity => entity.decision_engine?.action)),
    confidence_gate_levels: uniqueStrings(row.entities.map(entity => entity.decision_summary?.confidence_gate_level)),
    action_urgency_levels: uniqueStrings(row.entities.map(entity => entity.analysis?.priority_level)),
  };

  const decisionEngineSummary = {
    action_counts: actionCounts,
    dominant_action: dominantAction,
    requires_ai_review_count: aiReviewCount,
    requires_human_review_count: humanReviewCount,
    blocked_scale_count: aggressiveBlockedEntities,
    actions_present: uniqueStrings(row.entities.map(entity => entity.decision_engine?.action)),
  };

  const groupId = [safeString(row.report_date), safeString(row.entity_type), safeString(row.category)].map(slugify).filter(Boolean).join('__');
  const groupMessage = buildGroupedMessage({
    ...row,
    decision_summary: groupDecisionSummary,
  });
  const requiresSubjectiveAiReview = shouldRouteGroupToSubjectiveAI(row);
  const aiRoutingReason = requiresSubjectiveAiReview
    ? 'ad_group_with_visual_evidence'
    : safeString(row.entity_type).toLowerCase() === 'ad'
      ? 'no_visual_evidence_for_subjective_review'
      : 'aggregate_group_is_deterministic';
  const subjectiveReviewPayload = requiresSubjectiveAiReview
    ? buildSubjectiveReviewPayload(
        row,
        groupId,
        pipelineAudit,
        groupMeasurement,
        groupFlags,
        groupDecisionSummary,
      )
    : null;

  results.push({
    json: {
      report_date: row.report_date,
      entity_type: row.entity_type,
      category: row.category,
      group_id: groupId,
      group_type: 'performance_category_group',
      total_entities: row.entities.length,
      media_urls: mediaUrls,
      media_urls_count: mediaUrls.length,
      direct_visual_rows: directVisualRows,
      thumbnail_fallback_rows: thumbnailFallbackRows,
      group_message: groupMessage,
      message_text: groupMessage,
      delivery_text_base: groupMessage,
      requires_subjective_ai_review: requiresSubjectiveAiReview,
      ai_routing_reason: aiRoutingReason,
      subjective_ai_payload: deepClone(subjectiveReviewPayload),
      pipeline_audit: pipelineAudit,
      report_completeness: row.report_completeness,
      issue_ratio: row.issue_ratio,
      selection_summary: row.selection_summary,
      confidence_summary: deepClone(analyticsGroup.confidence_summary || pipelineAudit.confidence_summary || {}),
      measurement: groupMeasurement,
      flags: groupFlags,
      taxonomy: groupTaxonomy,
      decision_summary: groupDecisionSummary,
      decision_engine_summary: decisionEngineSummary,
      entities: row.entities,
    },
  });
}

return results;
