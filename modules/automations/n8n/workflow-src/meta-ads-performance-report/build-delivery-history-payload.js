const WORKFLOW_NAME = 'Meta Ads – Copia para o Codex Trabalhar';

function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function safeInteger(value) {
  const numeric = safeNumber(value);
  return numeric === null ? 0 : Math.trunc(numeric);
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function hashString(value) {
  const input = safeString(value) || 'empty';
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildReportKey(source) {
  return safeString(source.report_key) ||
    ['report', safeString(source.account_id), safeString(source.report_date), safeString(source.category || 'all')].filter(Boolean).join(':');
}

function buildDeliveryKey(source) {
  const entity = source.delivery_entity || {};
  const entityToken = safeString(entity.ad_id || entity.entity_id || entity.creative_id);
  return safeString(source.delivery_key) ||
    ['delivery', safeString(source.account_id), safeString(source.report_date), safeString(source.category || 'all'), entityToken].filter(Boolean).join(':');
}

function getDeliveryEntity(source) {
  const entity = source.delivery_entity;
  if (entity && typeof entity === 'object' && !Array.isArray(entity)) return entity;
  return {};
}

function buildSnapshot(base, metricName, metricValue) {
  return {
    snapshot_key: [base.metrics_group_key, metricName].join('|'),
    metrics_group_key: base.metrics_group_key,
    audit_key: base.audit_key,
    report_date: base.report_date,
    entity_level: base.entity_level,
    entity_id: base.entity_id,
    entity_name: base.entity_name,
    metrics_window: base.metrics_window,
    metric_name: metricName,
    metric_value: metricValue,
    metric_group: 'delivery_history',
    analytic_role: 'summary',
    value_type: 'number',
    metric_unit: 'count',
    source_kind: 'workflow_delivery_history',
    source_variant: 'whatsapp_delivery',
    source_field: 'delivery_audit',
    source_metric_name: metricName,
    account_currency: 'BRL',
    dimension_key: '',
    dimensions_json: '{}',
    confidence_status: 'high',
    confidence_score: 1,
    warning_codes: [],
    warning_messages: [],
    duplicate_source_kinds: [],
    is_primary: true,
    recorded_at: base.recorded_at,
  };
}

return $input.all()
  .filter((item) => item?.json?._noop_branch !== true)
  .map((item) => {
  const source = deepClone(item.json || {});
  const reportKey = buildReportKey(source);
  const deliveryKey = buildDeliveryKey(source);
  const deliveryEntity = getDeliveryEntity(source);
  const sendResponse = source.send_response || {};
  const providerKey = sendResponse.data?.key || {};
  const sentAt = safeString(source.sent_at || new Date().toISOString());
  const category = safeString(source.category || 'all');
  const accountId = safeString(source.account_id);
  const accountName = safeString(source.account_name);
  const entityToken = safeString(deliveryEntity.ad_id || deliveryEntity.entity_id || deliveryEntity.creative_id || hashString(deliveryKey));
  const metricsGroupKey = `delivery_history:${accountId}:${safeString(source.report_date)}:${category}:${entityToken}`;
  const auditKey = `${metricsGroupKey}|delivery_history|summary|${safeString(source.report_date)}`;
  const rawPayloadReference = `meta-ads/delivery-history/${safeString(source.report_date)}/${accountId}/${category}/${entityToken}/${hashString(deliveryKey)}.json`;
  const rawPayloadBody = JSON.stringify({
    delivery_key: deliveryKey,
    report_key: reportKey,
    report_date: safeString(source.report_date),
    account_id: accountId,
    account_name: accountName,
    category,
    message_type: safeString(source.message_type),
    idempotency_key: safeString(source.idempotency_key),
    sent_at: sentAt,
    whatsapp_text_length: safeInteger(source.whatsapp_text_length),
    group_counts_by_category: deepClone(source.group_counts_by_category || {}),
    subjective_coverage: deepClone(source.subjective_coverage || {}),
    delivery_entity: deepClone(deliveryEntity),
    whatsapp_image_url: safeString(source.whatsapp_image_url),
    send_response: deepClone(sendResponse || {}),
  });
  const rawPayloadHash = hashString(rawPayloadBody);
  const baseSnapshot = {
    metrics_group_key: metricsGroupKey,
    audit_key: auditKey,
    report_date: safeString(source.report_date),
    entity_level: 'delivery_history',
    entity_id: deliveryKey,
    entity_name: `${safeString(source.category_label || category)} | ${safeString(deliveryEntity.ad_name || deliveryEntity.entity_name || accountName || accountId)}`,
    metrics_window: 'delivery_report',
    recorded_at: sentAt,
  };

  return {
    json: {
      ...source,
      delivery_key: deliveryKey,
      storage_plan: {
        ...(source.storage_plan || {}),
        mode: 'cloudflare_worker_metrics_fallback',
        worker: {
          enabled: true,
          body: {
            run: {
              run_id: `${deliveryKey}:delivery_history`,
              workflow_name: WORKFLOW_NAME,
              report_mode: 'delivery_history_fallback',
              report_date: safeString(source.report_date),
              requested_at: sentAt,
              account_id: accountId,
              metrics_group_key: metricsGroupKey,
            },
            entities: [{
              entity_key: metricsGroupKey,
              entity_kind: 'delivery_history',
              entity_id: deliveryKey,
              entity_name: `${safeString(source.category_label || category)} | ${safeString(deliveryEntity.ad_name || deliveryEntity.entity_name || accountName || accountId)}`,
              account_id: accountId,
              campaign_id: null,
              campaign_name: null,
              adset_id: null,
              adset_name: null,
              ad_id: safeString(deliveryEntity.ad_id || deliveryEntity.entity_id),
              ad_name: safeString(deliveryEntity.ad_name || deliveryEntity.entity_name),
              creative_id: safeString(deliveryEntity.creative_id),
              creative_name: safeString(deliveryEntity.creative_name),
              page_id: null,
              instagram_user_id: null,
              campaign_objective: null,
              optimization_goal: null,
              destination_type: null,
              bid_strategy: null,
              billing_event: null,
              buying_type: null,
              status: sendResponse.success === true ? 'SENT' : 'FAILED',
              effective_status: sendResponse.success === true ? 'SENT' : 'FAILED',
              configured_status: 'ACTIVE',
              source_json: {
                report_key: reportKey,
                delivery_key: deliveryKey,
                category,
                message_type: safeString(source.message_type),
                idempotency_key: safeString(source.idempotency_key),
                delivery_entity: deepClone(deliveryEntity),
                whatsapp_image_url: safeString(source.whatsapp_image_url),
                provider_message_id: safeString(providerKey.id),
                provider_remote_jid: safeString(providerKey.remoteJid || source.evolution_remote_jid),
              },
              first_seen_at: sentAt,
              last_seen_at: sentAt,
            }],
            metric_snapshots: [
              buildSnapshot(baseSnapshot, 'send_success', sendResponse.success === true ? 1 : 0),
              buildSnapshot(baseSnapshot, 'whatsapp_text_length', safeInteger(source.whatsapp_text_length)),
            ],
            ingestion_audit: [{
              audit_key: auditKey,
              metrics_group_key: metricsGroupKey,
              entity_level: 'delivery_history',
              entity_id: deliveryKey,
              report_date: safeString(source.report_date),
              metrics_window: 'delivery_report',
              requested_at: sentAt,
              api_version: 'workflow',
              schedule_mode: 'manual',
              fetch_status_summary: sendResponse.success === true ? 'sent' : 'failed',
              fetch_status_hourly: '',
              fetch_status_breakdown: '',
              row_count_summary: 1,
              row_count_hourly: 0,
              row_count_breakdown: 0,
              ingestion_status: sendResponse.success === true ? 'ok' : 'failed',
              payload_hashes_json: JSON.stringify([{ payload_hash: rawPayloadHash, request_key: `${deliveryKey}|delivery_history` }]),
              raw_payload_references_json: JSON.stringify([{ raw_payload_reference: rawPayloadReference, request_key: `${deliveryKey}|delivery_history` }]),
              processing_notes_json: JSON.stringify(['delivery_history_fallback_via_metrics_worker']),
              warning_codes_json: JSON.stringify([]),
              warning_count: 0,
              low_confidence_count: 0,
              created_at: sentAt,
              updated_at: sentAt,
            }],
            raw_payloads: [{
              payload_hash: rawPayloadHash,
              request_key: `${deliveryKey}|delivery_history`,
              audit_key: auditKey,
              metrics_group_key: metricsGroupKey,
              raw_payload_reference: rawPayloadReference,
              raw_payload_body: rawPayloadBody,
              storage_backend: 'cloudflare_worker',
              payload_size_bytes: Buffer.byteLength(rawPayloadBody, 'utf8'),
              fetch_status: 'ok',
              retrieved_at: sentAt,
            }],
            compatibility_exports: {
              summary_rows: [],
              breakdown_rows: [],
            },
            duplication_report: [],
          },
        },
      },
      report_history_summary: {
        delivery_audits: 1,
      },
    },
  };
});
