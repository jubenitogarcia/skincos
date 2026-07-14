#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [, , inputPath, outputPathArg] = process.argv;

if (!inputPath) {
  console.error('Uso: node patch-meta-ads-image-report-format.js <input-json> [output-json]');
  process.exit(1);
}

const outputPath = outputPathArg || inputPath;
const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function getNode(name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) {
    throw new Error(`Node não encontrado: ${name}`);
  }
  return node;
}

getNode('Build Consolidated WhatsApp Report').parameters.jsCode = `const CATEGORY_META = {
  top_performance: { title: 'MELHORES', emoji: '🏆' },
  atencao: { title: 'ATENÇÃO', emoji: '⚠️' },
  piores: { title: 'PIORES', emoji: '📉' },
  oportunidades: { title: 'OPORTUNIDADES', emoji: '🚀' },
};
const CATEGORY_ORDER = ['top_performance', 'atencao', 'piores', 'oportunidades'];
const ENTITY_ORDER = ['campaign', 'adset', 'ad', 'creative'];
const ENTITY_LABEL = {
  campaign: 'CAMPANHA',
  adset: 'CONJUNTO DE ANÚNCIOS',
  ad: 'ANÚNCIO',
  creative: 'CRIATIVO',
};

function s(v) { return v == null ? '' : String(v).trim(); }
function a(v) { return Array.isArray(v) ? v : []; }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function n(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const normalized = String(v).trim().replace(/\\.(?=\\d{3}(?:\\D|$))/g, '').replace(',', '.');
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
  if (value === null) return digits > 0 ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(0) : '0';
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
  const match = raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (!match) return raw;
  return match[3] + '/' + match[2];
}
function cleanText(value) {
  return s(value)
    .replace(/\\s+/g, ' ')
    .replace(/[\\u0000-\\u001f]+/g, ' ')
    .trim();
}
function limitText(value, max = 280) {
  const text = cleanText(value);
  if (!text || text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}
function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}
function pickAccountName(group) {
  return cleanText(
    pickFirst(
      group.account_name,
      group.account_overview?.account_name,
      group.account?.account_name,
      group.entities?.[0]?.account?.account_name,
      group.entities?.[0]?.account?.name,
      group.entities?.[0]?.raw_entity?.account_name,
      group.account_id
    )
  ) || s(group.account_id);
}
function entitySortIndex(entityType) {
  const index = ENTITY_ORDER.indexOf(s(entityType));
  return index === -1 ? ENTITY_ORDER.length : index;
}
function categorySortIndex(category) {
  const index = CATEGORY_ORDER.indexOf(s(category));
  return index === -1 ? CATEGORY_ORDER.length : index;
}
function candidateScore(group, entity) {
  const reviewed = s(group.subjective_status) === 'reviewed_by_ai' ? 20 : 0;
  const typeScore = ({ creative: 40, ad: 30, adset: 20, campaign: 10 })[s(entity.entity_type || group.entity_type)] || 0;
  const trueCreative = entity?.media?.has_true_creative_image || entity?.visual?.has_true_creative_image ? 10 : 0;
  const directDownload = entity?.visual?.has_download_url ? 8 : 0;
  const directUrl = s(entity?.visual?.download_url || entity?.media?.primary_url || entity?.visual?.primary_image?.url) ? 5 : 0;
  return reviewed + typeScore + trueCreative + directDownload + directUrl;
}
function findRepresentativeImage(groups) {
  const candidates = [];
  for (const group of a(groups)) {
    for (const entity of a(group.entities)) {
      const image = cleanText(
        pickFirst(
          entity?.visual?.download_url,
          entity?.media?.primary_url,
          entity?.visual?.primary_image?.url,
          entity?.media?.thumbnail_url,
          entity?.visual?.thumbnail_url
        )
      );
      if (!image) continue;
      candidates.push({
        image,
        score: candidateScore(group, entity),
        group_id: s(group.group_id),
        entity_type: s(entity.entity_type || group.entity_type),
        entity_id: s(entity?.identity?.entity_id),
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score || entitySortIndex(left.entity_type) - entitySortIndex(right.entity_type));
  return candidates[0] || null;
}
function buildMetricLines(entity) {
  const metrics = entity.metrics || {};
  const analysis = entity.analysis || {};
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
    '➡️ Ação: ' + cleanText(pickFirst(analysis.recommended_action, entity.recommended_action, entity.decision_summary?.primary_action, 'monitorar')),
  ];
  return lines.filter(Boolean);
}
function buildSubjectiveLines(group) {
  const subjective = group.subjective_block || {};
  const summary = limitText(subjective.subjective_summary, 260);
  const firstRisk = limitText(a(subjective.top_risks)[0], 180);
  const firstOpportunity = limitText(a(subjective.top_opportunities)[0], 180);
  const lines = [];
  if (summary) lines.push('🧠 Subjetivo: ' + summary);
  if (firstRisk) lines.push('⚠️ Risco: ' + firstRisk);
  if (firstOpportunity) lines.push('🚀 Oportunidade: ' + firstOpportunity);
  return lines;
}
function buildEntityBlock(group, entity) {
  const identity = entity.identity || {};
  const entityName = cleanText(pickFirst(identity.name, entity.creative?.creative_name_display, identity.entity_id, 'Sem nome'));
  const entityId = cleanText(pickFirst(identity.entity_id, identity.ad_id, identity.creative_id, identity.adset_id, identity.campaign_id));
  const lines = [
    ENTITY_LABEL[s(entity.entity_type || group.entity_type)] || s(entity.entity_type || group.entity_type).toUpperCase(),
    entityName,
  ];
  if (entityId) lines.push(entityId);
  lines.push(...buildMetricLines(entity));
  lines.push(...buildSubjectiveLines(group));
  return lines.join('\\n');
}
function buildCategoryMessage(groups, reportDate, categoryKey) {
  const categoryMeta = CATEGORY_META[categoryKey] || { title: categoryKey.toUpperCase(), emoji: '📊' };
  const blocks = [categoryMeta.emoji + ' ' + categoryMeta.title + ' - ' + shortDate(reportDate)];
  const orderedGroups = [...groups].sort((left, right) => entitySortIndex(left.entity_type) - entitySortIndex(right.entity_type));
  for (const group of orderedGroups) {
    const entities = a(group.entities);
    for (const entity of entities) {
      blocks.push(buildEntityBlock(group, entity));
    }
  }
  return blocks.filter(Boolean).join('\\n\\n');
}

const validGroups = items
  .map((item) => item.json || {})
  .filter((group) => s(group.group_id) && !group._noop_branch);

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
    countsByCategory[category] = reportGroups.filter((group) => s(group.category) === category).length;
  }

  for (const categoryKey of CATEGORY_ORDER) {
    const categoryGroups = reportGroups
      .filter((group) => s(group.category) === categoryKey)
      .sort((left, right) => entitySortIndex(left.entity_type) - entitySortIndex(right.entity_type));

    if (!categoryGroups.length) continue;

    const subjectiveEligible = categoryGroups.filter((group) => ['ad', 'creative'].includes(s(group.entity_type))).length;
    const subjectiveReviewed = categoryGroups.filter((group) => s(group.subjective_status) === 'reviewed_by_ai').length;
    const representative = findRepresentativeImage(categoryGroups);
    const categoryMeta = CATEGORY_META[categoryKey] || { title: categoryKey.toUpperCase(), emoji: '📊' };

    const header = [
      '*META ADS | ' + categoryMeta.title + '*',
      'Conta: ' + accountName,
      'Data: ' + reportDate,
      'Categoria: ' + categoryMeta.title,
    ].join('\\n');

    const summaryLines = [
      '*Resumo absoluto da conta*',
      '24h: Gasto ' + formatBRL(account24h.spend) + ' | Conversas ' + formatInteger(account24h.conversations) + ' | CPA ' + formatBRL(account24h.avgCostConversation) + ' | CTR ' + formatPct(account24h.ctr),
      '7d: Gasto ' + formatBRL(account7d.spend) + ' | Conversas ' + formatInteger(account7d.conversations) + ' | CPA ' + formatBRL(account7d.avgCostConversation),
      '30d: Gasto ' + formatBRL(account30d.spend) + ' | Conversas ' + formatInteger(account30d.conversations) + ' | CPA ' + formatBRL(account30d.avgCostConversation),
    ];

    const categoryBody = buildCategoryMessage(categoryGroups, reportDate, categoryKey);
    const footer = [
      '*Cobertura subjetiva*',
      'Elegíveis: ' + subjectiveEligible + ' | Revisados por IA: ' + subjectiveReviewed,
      '🖼️ Imagem anexada: referência visual disponível do recorte.',
    ].join('\\n');

    const whatsappText = [header, summaryLines.join('\\n'), categoryBody, footer].filter(Boolean).join('\\n\\n');

    output.push({
      json: compactObject({
        report_type: 'consolidated_daily_meta_ads_report_category',
        message_type: 'consolidated_daily_meta_ads_report_category',
        route: 'consolidated_whatsapp_category_report',
        account_id: accountId,
        account_name: accountName,
        report_date: reportDate,
        category: categoryKey,
        category_label: categoryMeta.title,
        headline_math_summary: summaryLines.slice(1).join(' | '),
        sections: [categoryBody],
        whatsapp_text: whatsappText,
        whatsapp_image_url: representative?.image || '',
        representative_image: representative || null,
        ready_for_whatsapp: Boolean(whatsappText),
        should_send_whatsapp: Boolean(whatsappText),
        idempotency_key: 'metaads:v4:' + reportDate + ':' + accountId + ':' + categoryKey + ':consolidated_whatsapp_image',
        group_counts_by_category: countsByCategory,
        category_group_count: categoryGroups.length,
        subjective_coverage: {
          eligible_groups: subjectiveEligible,
          reviewed_groups: subjectiveReviewed,
          not_requested_groups: categoryGroups.filter((group) => s(group.subjective_status) === 'not_requested').length,
          no_visual_input_groups: categoryGroups.filter((group) => s(group.subjective_status) === 'no_visual_input').length,
        },
        delivery_target: clone(first.delivery_target || { instance_name: 'crm-channel-1', remote_jid: '555195103563' }),
        consolidated_groups: categoryGroups,
      }),
    });
  }
}

return output;`;

getNode('Prepare Evolution Payload').parameters.jsCode = `const FALLBACK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sX6lzQAAAAASUVORK5CYII=';

function s(v) { return v == null ? '' : String(v).trim(); }

return items.map((item) => {
  const source = item.json || {};
  const caption = s(source.whatsapp_text || source?.whatsapp?.text || source.message_text);
  const shouldSend = source.should_send_whatsapp !== false;
  const readyForWhatsapp = Boolean(
    shouldSend &&
    (source.ready_for_whatsapp === true || caption)
  );

  const instanceName = s(source?.delivery_target?.instance_name || source.instance_name || 'crm-channel-1');
  const remoteJid = s(source?.delivery_target?.remote_jid || source.remote_jid || '555195103563');
  const media = s(source.whatsapp_image_url || source.representative_image?.image || source.image_url || FALLBACK_IMAGE_BASE64);

  return {
    json: {
      ...source,
      route: 'prepared_evolution_delivery',
      ready_for_whatsapp: readyForWhatsapp,
      should_send_whatsapp: shouldSend,
      evolution_instance_name: instanceName,
      evolution_remote_jid: remoteJid,
      evolution_media: media,
      evolution_caption: caption,
      evolution_message_text: caption,
      delivery_payload: {
        instance_name: instanceName,
        remote_jid: remoteJid,
        media,
        caption,
        idempotency_key: s(source.idempotency_key),
        message_type: s(source.message_type),
        category: s(source.category),
      },
    },
  };
});`;

const sendReportNode = getNode('Send Report');
sendReportNode.parameters.resource = 'messages-api';
sendReportNode.parameters.operation = 'send-image';
delete sendReportNode.parameters.messageText;
sendReportNode.parameters.instanceName = '={{$json.evolution_instance_name}}';
sendReportNode.parameters.remoteJid = '={{$json.evolution_remote_jid}}';
sendReportNode.parameters.media = '={{$json.evolution_media}}';
sendReportNode.parameters.caption = '={{$json.evolution_caption}}';
sendReportNode.parameters.options_message = {};

getNode('Build Report History Payload').parameters.jsCode = getNode('Build Report History Payload').parameters.jsCode
  .replace(
    "return ['report_bundle', safeString(source.account_id), safeString(source.report_date)].filter(Boolean).join(':');",
    "return ['report_bundle', safeString(source.account_id), safeString(source.report_date), safeString(source.category || 'all')].filter(Boolean).join(':');",
  )
  .replace(
    "entity_name: \\`meta_ads_consolidated_report_\\${safeString(source.report_date)}\\`,",
    "entity_name: \\`meta_ads_consolidated_report_\\${safeString(source.report_date)}_\\${safeString(source.category || 'all')}\\`,",
  )
  .replace(
    "message_type: safeString(source.message_type),",
    `message_type: safeString(source.message_type),
      category: safeString(source.category),
      category_label: safeString(source.category_label),`,
  )
  .replace(
    "entity_name: \\`meta_ads_consolidated_report_\\${reportDate}\\`,",
    "entity_name: \\`meta_ads_consolidated_report_\\${reportDate}_\\${safeString(source.category || 'all')}\\`,",
  )
  .replace(
    new RegExp(String.raw`raw_payload_reference:\s*\`meta-ads/report-history/\$\{safeString\(source\.report_date\)\}/account_\$\{safeString\(source\.account_id\)\}/\$\{referenceSuffix\}\.json\`,`),
    "raw_payload_reference: `meta-ads/report-history/${safeString(source.report_date)}/account_${safeString(source.account_id)}/category_${safeString(source.category || 'all')}/${referenceSuffix}.json`,",
  );

getNode('Build Delivery History Payload').parameters.jsCode = getNode('Build Delivery History Payload').parameters.jsCode
  .replace(
    "return ['report_delivery', safeString(source.account_id), safeString(source.report_date)].filter(Boolean).join(':');",
    "return ['report_delivery', safeString(source.account_id), safeString(source.report_date), safeString(source.category || 'all')].filter(Boolean).join(':');",
  )
  .replace(
    "return ['delivery_audit', safeString(source.account_id), safeString(source.report_date)].filter(Boolean).join(':') || metricsGroupKey;",
    "return ['delivery_audit', safeString(source.account_id), safeString(source.report_date), safeString(source.category || 'all')].filter(Boolean).join(':') || metricsGroupKey;",
  )
  .replace(
    "entity_name: \\`meta_ads_delivery_audit_\\${safeString(source.report_date)}\\`,",
    "entity_name: \\`meta_ads_delivery_audit_\\${safeString(source.report_date)}_\\${safeString(source.category || 'all')}\\`,",
  )
  .replace(
    "remote_jid: safeString(source.send_response?.data?.key?.remoteJid || source.evolution_remote_jid),",
    `remote_jid: safeString(source.send_response?.data?.key?.remoteJid || source.evolution_remote_jid),
      category: safeString(source.category),
      category_label: safeString(source.category_label),`,
  )
  .replace(
    "entity_name: \\`meta_ads_delivery_audit_\\${reportDate}\\`,",
    "entity_name: \\`meta_ads_delivery_audit_\\${reportDate}_\\${safeString(source.category || 'all')}\\`,",
  )
  .replace(
    new RegExp(String.raw`raw_payload_reference:\s*\`meta-ads/report-history/\$\{safeString\(source\.report_date\)\}/account_\$\{safeString\(source\.account_id\)\}/delivery-audit\.json\`,`),
    "raw_payload_reference: `meta-ads/report-history/${safeString(source.report_date)}/account_${safeString(source.account_id)}/category_${safeString(source.category || 'all')}/delivery-audit.json`,",
  );

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2));
console.log('Patched workflow written to ' + outputPath);
