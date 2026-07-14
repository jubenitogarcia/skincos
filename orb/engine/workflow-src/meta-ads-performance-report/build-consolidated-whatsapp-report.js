const CATEGORY_META = {
  top_performance: { title: 'MELHORES', emoji: '🏆' },
  atencao: { title: 'ATENÇÃO', emoji: '⚠️' },
  piores: { title: 'PIORES', emoji: '📉' },
  oportunidades: { title: 'OPORTUNIDADES', emoji: '🚀' },
};
const CATEGORY_ORDER = ['top_performance', 'atencao', 'piores', 'oportunidades'];
const ENTITY_LABEL = {
  ad: 'ANÚNCIO',
};

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
  if (value === null) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value);
}
function formatPct(v) {
  const value = n(v);
  if (value === null) return '0%';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value) + '%';
}
function formatNumber(v, digits = 0) {
  const value = n(v);
  if (value === null) {
    return digits > 0
      ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(0)
      : '0';
  }
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
function formatInteger(v) {
  const value = n(v);
  if (value === null) return '0';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}
function shortDate(v) {
  const raw = s(v);
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  return match[3] + '/' + match[2];
}
function cleanText(value) {
  return s(value)
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .trim();
}
function normalizePresentationText(value) {
  return cleanText(value)
    .replace(/\bsaturacao\b/gi, 'saturação')
    .replace(/\bangulo\b/gi, 'ângulo')
    .replace(/\bpos-clique\b/gi, 'pós-clique')
    .replace(/\brenovacao\b/gi, 'renovação');
}
function fullText(value) {
  return normalizePresentationText(value);
}
function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}
function safeNodeJson(nodeName) {
  try {
    return $(nodeName).first()?.json || {};
  } catch {
    return {};
  }
}
function titleCase(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
function looksTemplateName(value) {
  const text = cleanText(value);
  return text.includes('{{') || text.includes('}}') || /^template\b/i.test(text);
}
function pickAccountName(group) {
  const sheetsRow = safeNodeJson('Google Sheets');
  const metaParams = safeNodeJson('Meta API Params');
  return cleanText(
    pickFirst(
      group.account_name,
      group.account_overview?.account_name,
      group.account?.account_name,
      group.entities?.[0]?.account?.account_name,
      group.entities?.[0]?.account?.name,
      group.entities?.[0]?.raw_entity?.account_name,
      metaParams.account_name,
      sheetsRow.destination_group,
      sheetsRow.account_name,
      group.account_id ? 'Conta ' + group.account_id : ''
    )
  ) || s(group.account_id);
}
function guessMimeTypeFromUrl(url) {
  const normalized = s(url).toLowerCase();
  if (normalized.includes('.png')) return 'image/png';
  if (normalized.includes('.webp')) return 'image/webp';
  if (normalized.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}
function guessFileExtensionFromMime(mimeType) {
  switch (s(mimeType).toLowerCase()) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: return 'jpg';
  }
}
function pickEntityImageUrl(entity) {
  return cleanText(
    pickFirst(
      entity?.visual?.download_url,
      entity?.media?.primary_url,
      entity?.visual?.primary_image?.url,
      entity?.media?.thumbnail_url,
      entity?.visual?.thumbnail_url
    )
  );
}
function buildMetricLines(entity) {
  const metrics = entity.metrics || {};
  const lines = [
    '💰 Investimento: ' + formatBRL(metrics.spend),
    '💬 Conversa: ' + formatInteger(metrics.conversations),
    '🔄 CPCv: ' + formatBRL(metrics.avgCostConversation),
    '🖱️ Clique: ' + formatInteger(metrics.clicks),
    '📍 Alcance: ' + formatInteger(metrics.reach),
    '👀 Impressão: ' + formatInteger(metrics.impressions),
    '❤️ Engajamento: ' + formatInteger(metrics.engagement),
    '📲 Redirecionamento IG: ' + formatInteger(metrics.igRedirect),
    '🎯 CTR/CTRL: ' + formatPct(metrics.ctr) + '/' + formatPct(metrics.linkCtr),
    '💰 CPC/CPCL: ' + formatBRL(metrics.cpc) + '/' + formatBRL(metrics.costPerLinkClick),
    '📣 CPM: ' + formatBRL(metrics.cpm),
    '👥 CPP: ' + formatBRL(metrics.cpp),
    '🔁 Frequência: ' + formatNumber(metrics.frequency, 2),
    '☝️ CU/CUL: ' + formatInteger(metrics.uniqueClicks) + '/' + formatInteger(metrics.uniqueLinkClicks),
  ];
  return lines.filter(Boolean);
}
function findEntityReview(group, entity) {
  const targetId = cleanText(pickFirst(entity?.identity?.entity_id, entity?.identity?.ad_id));
  const reviews = a(group?.subjective_block?.entity_reviews);
  if (!targetId || !reviews.length) return null;
  return reviews.find((review) => cleanText(review?.entity_id) === targetId) || null;
}
function buildSubjectiveLines(group, entity, entityReview) {
  const subjective = group.subjective_block || {};
  const summary = fullText(
    pickFirst(entityReview?.subjective_summary, a(group.entities).length <= 1 ? subjective.subjective_summary : ''),
  );
  const firstRisk = entityReview ? fullText(a(subjective.top_risks)[0]) : '';
  const firstOpportunity = entityReview ? fullText(a(subjective.top_opportunities)[0]) : '';
  const lines = [];
  if (summary) lines.push('🧠 Análise: ' + summary);
  if (firstRisk) lines.push('⚠️ Risco: ' + firstRisk);
  if (firstOpportunity) lines.push('🚀 Oportunidade: ' + firstOpportunity);
  if (!entityReview && s(group.subjective_status) === 'reviewed_by_ai') {
    lines.push('🧠 Análise: revisão criativa não retornou parecer específico para este anúncio.');
  }
  return lines;
}
function ensureTrailingPeriod(value) {
  const text = normalizePresentationText(value);
  if (!text) return '';
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}
function buildReadableCreativeName(entity) {
  const creative = entity.creative || {};
  const rawName = cleanText(pickFirst(
    creative.creative_name_display,
    entity.visual?.creative_name,
    entity.identity?.creative_id
  ));
  if (!rawName) return '';
  if (!looksTemplateName(rawName)) return rawName;
  const offerFamily = cleanText(creative.offer_family);
  if (offerFamily && offerFamily !== 'unclassified') {
    return 'Criativo ' + titleCase(offerFamily);
  }
  return 'Criativo ' + cleanText(pickFirst(entity.identity?.creative_id, 'Sem nome'));
}
function buildCreativeAttachmentLines(entity) {
  const creativeName = buildReadableCreativeName(entity);
  const creativeId = cleanText(pickFirst(entity.identity?.creative_id, entity.creative?.creative_id));
  const lines = [];
  if (creativeName) lines.push('🎨 Criativo: ' + creativeName);
  if (creativeId) lines.push('🆔 Criativo: ' + creativeId);
  return lines;
}
function buildReadableEntityName(group, entity) {
  const identity = entity.identity || {};
  const baseName = cleanText(pickFirst(identity.name, entity.creative?.creative_name_display, identity.entity_id, 'Sem nome'));
  const creative = entity.creative || {};
  const isCreativeEntity = s(entity.entity_type || group.entity_type) === 'creative';

  if (isCreativeEntity && looksTemplateName(baseName)) {
    const offerFamily = cleanText(creative.offer_family);
    if (offerFamily && offerFamily !== 'unclassified') {
      return 'Criativo ' + titleCase(offerFamily);
    }
    return 'Criativo ' + cleanText(pickFirst(identity.creative_id, identity.entity_id, group.visual_asset_ref?.creative_id, 'Sem nome'));
  }

  return baseName;
}
function buildEntityBlock(group, entity, entityReview) {
  const identity = entity.identity || {};
  const entityName = buildReadableEntityName(group, entity);
  const entityId = cleanText(pickFirst(identity.entity_id, identity.ad_id, identity.creative_id, identity.adset_id, identity.campaign_id));
  const analysis = entity.analysis || {};
  const action = ensureTrailingPeriod(pickFirst(
    analysis.recommended_action,
    entity.recommended_action,
    entity.decision_summary?.primary_action,
    'monitorar'
  ));
  const lines = [
    '⭐️ Anúncio: ' + entityName,
  ];
  if (entityId) lines.push('🫆 ID: ' + entityId);
  lines.push(...buildCreativeAttachmentLines(entity));
  lines.push(...buildMetricLines(entity));
  lines.push('');
  lines.push(...buildSubjectiveLines(group, entity, entityReview));
  lines.push('➡️ Ação: ' + action);
  return lines.join('\n');
}
function countCategoryEntities(groups, categoryKey) {
  return groups
    .filter((group) => s(group.category) === categoryKey)
    .reduce((sum, group) => sum + a(group.entities).length, 0);
}
function buildSingleEntityGroup(group, entity, entityReview, entitySubjectiveStatus) {
  const groupClone = clone(group);
  const subjectiveBlock = groupClone.subjective_block || {};
  return compactObject({
    ...groupClone,
    entities: [clone(entity)],
    selection_summary: {
      ...(groupClone.selection_summary || {}),
      selected_count: 1,
      candidate_count: Math.max(1, n(groupClone.selection_summary?.candidate_count) || a(groupClone.entities).length || 1),
    },
    subjective_status: entitySubjectiveStatus,
    subjective_block: entityReview || entitySubjectiveStatus === 'reviewed_by_ai'
      ? compactObject({
          subjective_status: entitySubjectiveStatus,
          subjective_summary: s(entityReview?.subjective_summary || ''),
          subjective_scores: {
            creative_quality_score: n(entityReview?.creative_quality_score),
            offer_clarity_score: n(entityReview?.offer_clarity_score),
            cta_visual_strength_score: n(entityReview?.cta_visual_strength_score),
            trustworthiness_score: n(entityReview?.trustworthiness_score),
            premium_perception_score: n(entityReview?.premium_perception_score),
          },
          top_risks: a(subjectiveBlock.top_risks).slice(0, 3),
          top_opportunities: a(subjectiveBlock.top_opportunities).slice(0, 3),
          recommended_creative_direction: s(entityReview?.recommended_creative_direction),
          visual_evidence_status: s(subjectiveBlock.visual_evidence_status),
          overall_subjective_verdict: s(subjectiveBlock.overall_subjective_verdict),
          entity_reviews: entityReview ? [clone(entityReview)] : [],
          group_analysis: clone(subjectiveBlock.group_analysis || {}),
          ai_handoff: clone(subjectiveBlock.ai_handoff || {}),
        })
      : undefined,
  });
}

const validGroups = items
  .map((item) => item.json || {})
  .filter((group) => s(group.group_id) && !group._noop_branch && s(group.entity_type) === 'ad');

const groupedByReport = new Map();
for (const group of validGroups) {
  const key = [s(group.account_id), s(group.report_date)].join('::');
  if (!groupedByReport.has(key)) groupedByReport.set(key, []);
  groupedByReport.get(key).push(group);
}

const output = [];
for (const [, reportGroups] of groupedByReport.entries()) {
  const first = reportGroups[0] || {};
  const accountId = s(first.account_id);
  const reportDate = s(first.report_date);
  const accountName = pickAccountName(first);
  const account24h = first.account_overview?.window_metrics?.last_24h?.metrics || first.account_overview?.metrics || {};
  const account7d = first.account_overview?.window_metrics?.last_7d?.metrics || {};
  const account30d = first.account_overview?.window_metrics?.last_30d?.metrics || {};
  const countsByCategory = {};
  for (const category of CATEGORY_ORDER) {
    countsByCategory[category] = countCategoryEntities(reportGroups, category);
  }

  output.push({
    json: compactObject({
      report_key: ['report', accountId, reportDate, 'account_summary'].filter(Boolean).join(':'),
      report_type: 'consolidated_daily_meta_ads_account_summary',
      message_type: 'consolidated_daily_meta_ads_account_summary',
      route: 'consolidated_whatsapp_account_summary',
      delivery_message_mode: 'send-text',
      account_id: accountId,
      account_name: accountName,
      report_date: reportDate,
      category: 'account_summary',
      category_label: 'RESUMO',
      entity_type: 'account',
      headline_math_summary: [
        '24h: Gasto ' + formatBRL(account24h.spend) + ' | Conversas ' + formatInteger(account24h.conversations) + ' | CPA ' + formatBRL(account24h.avgCostConversation) + ' | CTR ' + formatPct(account24h.ctr),
        '7d: Gasto ' + formatBRL(account7d.spend) + ' | Conversas ' + formatInteger(account7d.conversations) + ' | CPA ' + formatBRL(account7d.avgCostConversation),
        '30d: Gasto ' + formatBRL(account30d.spend) + ' | Conversas ' + formatInteger(account30d.conversations) + ' | CPA ' + formatBRL(account30d.avgCostConversation),
      ].join(' | '),
      sections: [
        [
          'Resumo absoluto da conta',
          '24h: Gasto ' + formatBRL(account24h.spend) + ' | Conversas ' + formatInteger(account24h.conversations) + ' | CPA ' + formatBRL(account24h.avgCostConversation) + ' | CTR ' + formatPct(account24h.ctr),
          '7d: Gasto ' + formatBRL(account7d.spend) + ' | Conversas ' + formatInteger(account7d.conversations) + ' | CPA ' + formatBRL(account7d.avgCostConversation),
          '30d: Gasto ' + formatBRL(account30d.spend) + ' | Conversas ' + formatInteger(account30d.conversations) + ' | CPA ' + formatBRL(account30d.avgCostConversation),
        ].join('\n'),
      ],
      whatsapp_text: [
        'Resumo absoluto da conta',
        '24h: Gasto ' + formatBRL(account24h.spend) + ' | Conversas ' + formatInteger(account24h.conversations) + ' | CPA ' + formatBRL(account24h.avgCostConversation) + ' | CTR ' + formatPct(account24h.ctr),
        '7d: Gasto ' + formatBRL(account7d.spend) + ' | Conversas ' + formatInteger(account7d.conversations) + ' | CPA ' + formatBRL(account7d.avgCostConversation),
        '30d: Gasto ' + formatBRL(account30d.spend) + ' | Conversas ' + formatInteger(account30d.conversations) + ' | CPA ' + formatBRL(account30d.avgCostConversation),
      ].join('\n'),
      ready_for_whatsapp: true,
      should_send_whatsapp: true,
      idempotency_key: ['metaads', 'v6', reportDate, accountId, 'account_summary', 'whatsapp_text'].join(':'),
      group_counts_by_category: countsByCategory,
      category_message_count: 1,
      delivery_target: clone(first.delivery_target || { instance_name: 'crm-channel-1', remote_jid: '555195103563' }),
      subjective_coverage: {
        eligible_entities: 0,
        reviewed_entities: 0,
        review_status: 'not_applicable',
        group_entities_total: 0,
      },
      delivery_entity: {
        entity_type: 'account',
        entity_id: accountId,
        entity_name: accountName,
      },
      consolidated_groups: [],
    }),
  });

  for (const categoryKey of CATEGORY_ORDER) {
    const categoryGroups = reportGroups.filter((group) => s(group.category) === categoryKey);
    if (!categoryGroups.length) continue;

    const categoryMeta = CATEGORY_META[categoryKey] || { title: categoryKey.toUpperCase(), emoji: '📊' };
    const categoryEntityCount = countsByCategory[categoryKey];
    let categoryEntityIndex = 0;

    for (const group of categoryGroups) {
      for (const entity of a(group.entities)) {
        categoryEntityIndex += 1;

        const entityId = cleanText(pickFirst(
          entity?.identity?.ad_id,
          entity?.identity?.entity_id,
          entity?.identity?.creative_id
        ));
        const creativeId = cleanText(pickFirst(entity?.identity?.creative_id, entity?.creative?.creative_id));
        const creativeName = buildReadableCreativeName(entity);
        const entityName = buildReadableEntityName(group, entity);
        const imageUrl = pickEntityImageUrl(entity);
        const mimeType = guessMimeTypeFromUrl(imageUrl);
        const fileExtension = guessFileExtensionFromMime(mimeType);
        const fileNameBase = cleanText(pickFirst(creativeId, entityId, 'creative'));
        const entityReview = findEntityReview(group, entity);
        const entitySubjectiveStatus = entityReview
          ? 'reviewed_by_ai'
          : (s(group.subjective_status) === 'reviewed_by_ai' ? 'review_not_returned_for_entity' : s(group.subjective_status));
        const singleEntityGroup = buildSingleEntityGroup(group, entity, entityReview, entitySubjectiveStatus);

        const summaryLines = [
          '24h: Gasto ' + formatBRL(account24h.spend) + ' | Conversas ' + formatInteger(account24h.conversations) + ' | CPA ' + formatBRL(account24h.avgCostConversation) + ' | CTR ' + formatPct(account24h.ctr),
          '7d: Gasto ' + formatBRL(account7d.spend) + ' | Conversas ' + formatInteger(account7d.conversations) + ' | CPA ' + formatBRL(account7d.avgCostConversation),
          '30d: Gasto ' + formatBRL(account30d.spend) + ' | Conversas ' + formatInteger(account30d.conversations) + ' | CPA ' + formatBRL(account30d.avgCostConversation),
        ];
        const header = 'ADS | ' + categoryMeta.title + ' – ' + shortDate(reportDate);
        const entityBlock = buildEntityBlock(group, entity, entityReview);
        const whatsappText = [header, entityBlock]
          .filter(Boolean)
          .join('\n\n');

        const reportKey = ['report', accountId, reportDate, categoryKey, 'ad', entityId || fileNameBase].filter(Boolean).join(':');

        output.push({
          json: compactObject({
            report_key: reportKey,
            report_type: 'consolidated_daily_meta_ads_ad_report',
            message_type: 'consolidated_daily_meta_ads_ad_report',
            route: 'consolidated_whatsapp_ad_report',
            delivery_message_mode: 'send-image',
            account_id: accountId,
            account_name: accountName,
            report_date: reportDate,
            category: categoryKey,
            category_label: categoryMeta.title,
            entity_type: 'ad',
            headline_math_summary: summaryLines.join(' | '),
            sections: [entityBlock],
            whatsapp_text: whatsappText,
            whatsapp_image_url: imageUrl,
            whatsapp_image_mime_type: mimeType,
            whatsapp_image_file_name: `${fileNameBase}.${fileExtension}`,
            representative_image: imageUrl ? {
              image: imageUrl,
              entity_id: entityId,
              creative_id: creativeId,
              mime_type: mimeType,
            } : null,
            ready_for_whatsapp: Boolean(whatsappText && imageUrl),
            should_send_whatsapp: Boolean(whatsappText && imageUrl),
            delivery_block_reason: imageUrl ? '' : 'missing_creative_media',
            idempotency_key: ['metaads', 'v5', reportDate, accountId, categoryKey, 'ad', entityId || fileNameBase, 'whatsapp_image'].join(':'),
            group_counts_by_category: countsByCategory,
            category_message_count: categoryEntityCount,
            category_entity_index: categoryEntityIndex,
            delivery_target: clone(first.delivery_target || { instance_name: 'crm-channel-1', remote_jid: '555195103563' }),
            subjective_coverage: {
              eligible_entities: 1,
              reviewed_entities: entityReview ? 1 : 0,
              review_status: entitySubjectiveStatus || 'not_requested',
              group_entities_total: a(group.entities).length,
            },
            delivery_entity: {
              entity_type: 'ad',
              entity_id: entityId,
              entity_name: entityName,
              ad_id: cleanText(pickFirst(entity?.identity?.ad_id, entityId)),
              ad_name: entityName,
              creative_id: creativeId,
              creative_name: creativeName,
              image_url: imageUrl,
              image_mime_type: mimeType,
              image_file_name: `${fileNameBase}.${fileExtension}`,
              category_index: categoryEntityIndex,
              category_total: categoryEntityCount,
              subjective_status: entitySubjectiveStatus || 'not_requested',
            },
            consolidated_groups: [singleEntityGroup],
          }),
        });
      }
    }
  }
}

return output;
