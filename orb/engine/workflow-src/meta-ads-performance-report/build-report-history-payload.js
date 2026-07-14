const WORKFLOW_NAME = 'Meta Ads – Copia para o Codex Trabalhar';

function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map((entry) => stableStringify(entry)).join(',') + ']';
  }

  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }

  return JSON.stringify(value ?? null);
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

function getDeliveryEntity(source) {
  const entity = source.delivery_entity;
  if (entity && typeof entity === 'object' && !Array.isArray(entity)) return entity;

  const firstGroup = safeArray(source.consolidated_groups)[0] || {};
  const firstEntity = safeArray(firstGroup.entities)[0] || {};
  return {
    entity_type: safeString(firstEntity.entity_type || firstGroup.entity_type || 'ad'),
    entity_id: safeString(firstEntity.identity?.entity_id || firstEntity.identity?.ad_id),
    entity_name: safeString(firstEntity.identity?.name),
    ad_id: safeString(firstEntity.identity?.ad_id || firstEntity.identity?.entity_id),
    ad_name: safeString(firstEntity.identity?.name),
    creative_id: safeString(firstEntity.identity?.creative_id || firstEntity.creative?.creative_id),
    creative_name: safeString(firstEntity.creative?.creative_name_display),
    image_url: safeString(source.whatsapp_image_url),
  };
}

function buildEntityToken(source, reportKey) {
  const entity = getDeliveryEntity(source);
  return safeString(entity.ad_id || entity.entity_id || entity.creative_id || hashString(reportKey));
}

function buildSnapshotKey(metricsGroupKey, metricName, dimensionKey = '') {
  return [metricsGroupKey, metricName, dimensionKey].filter(Boolean).join('|');
}

function buildMetricSnapshot(base, metricName, metricValue, metricGroup, analyticRole, dimensionKey = '', dimensions = {}) {
  return {
    snapshot_key: buildSnapshotKey(base.metrics_group_key, metricName, dimensionKey),
    metrics_group_key: base.metrics_group_key,
    audit_key: base.audit_key,
    report_date: base.report_date,
    entity_level: base.entity_level,
    entity_id: base.entity_id,
    entity_name: base.entity_name,
    metrics_window: base.metrics_window,
    metric_name: metricName,
    metric_value: metricValue,
    metric_group: metricGroup,
    analytic_role: analyticRole,
    value_type: Number.isFinite(Number(metricValue)) ? 'number' : 'text',
    metric_unit: 'count',
    source_kind: 'workflow_report_history',
    source_variant: 'ad_message',
    source_field: dimensionKey ? 'group_dimension' : 'category_summary',
    source_metric_name: metricName,
    account_currency: 'BRL',
    dimension_key: safeString(dimensionKey),
    dimensions_json: JSON.stringify(dimensions || {}),
    confidence_status: 'high',
    confidence_score: 1,
    warning_codes: [],
    warning_messages: [],
    duplicate_source_kinds: [],
    is_primary: true,
    recorded_at: base.recorded_at,
  };
}

return $input.all().map((item) => {
  const source = deepClone(item.json || {});
  const reportKey = buildReportKey(source);
  const deliveryEntity = getDeliveryEntity(source);
  const accountId = safeString(source.account_id);
  const accountName = safeString(source.account_name);
  const reportDate = safeString(source.report_date);
  const requestedAt = new Date().toISOString();
  const consolidatedGroups = safeArray(source.consolidated_groups);
  const category = safeString(source.category || 'all');
  const entityToken = buildEntityToken(source, reportKey);
  const metricsGroupKey = `report_history:${accountId}:${reportDate}:${category}:${entityToken}`;
  const entityId = reportKey;
  const entityKind = 'report_history';
  const auditKey = `${metricsGroupKey}|report_history|summary|${reportDate}`;
  const rawPayloadReference = `meta-ads/report-history/${reportDate}/${accountId}/${category}/${entityToken}/${hashString(reportKey)}.json`;

  const groupedSnapshots = consolidatedGroups.map((group) => ({
    group_id: safeString(group.group_id),
    entity_type: safeString(group.entity_type),
    category: safeString(group.category),
    route: safeString(group.route),
    selection_count: safeInteger(group.selection_summary?.selected_count),
    candidate_count: safeInteger(group.selection_summary?.candidate_count),
    has_subjective: Boolean(group.subjective_block),
    subjective_status: safeString(group.subjective_status),
    math_block: deepClone(group.math_block || {}),
    subjective_block: deepClone(group.subjective_block || null),
    entities: deepClone(group.entities || []),
    pipeline_audit: deepClone(group.pipeline_audit || {}),
  }));

  const rawPayloadBody = JSON.stringify({
    report_key: reportKey,
    report_date: reportDate,
    account_id: accountId,
    account_name: accountName,
    category,
    category_label: safeString(source.category_label),
    message_type: safeString(source.message_type),
    idempotency_key: safeString(source.idempotency_key),
    headline_math_summary: safeString(source.headline_math_summary),
    sections: deepClone(source.sections || []),
    delivery_target: deepClone(source.delivery_target || {}),
    subjective_coverage: deepClone(source.subjective_coverage || {}),
    representative_image: deepClone(source.representative_image || null),
    whatsapp_image_url: safeString(source.whatsapp_image_url),
    delivery_entity: deepClone(deliveryEntity),
    consolidated_groups: groupedSnapshots,
  });

  const rawPayloadHash = hashString(rawPayloadBody);
  const selectedTotal = groupedSnapshots.reduce((sum, group) => sum + safeInteger(group.selection_count), 0);
  const candidateTotal = groupedSnapshots.reduce((sum, group) => sum + safeInteger(group.candidate_count), 0);
  const subjectiveReviewed = groupedSnapshots.filter((group) => group.has_subjective).length;

  const baseSnapshot = {
    metrics_group_key: metricsGroupKey,
    audit_key: auditKey,
    report_date: reportDate,
    entity_level: entityKind,
    entity_id: entityId,
    entity_name: `${safeString(source.category_label || category)} | ${safeString(deliveryEntity.ad_name || deliveryEntity.entity_name || accountName || accountId)}`,
    metrics_window: 'category_report',
    recorded_at: requestedAt,
  };

  const metricSnapshots = [
    buildMetricSnapshot(baseSnapshot, 'group_count', groupedSnapshots.length, 'report_history', 'summary'),
    buildMetricSnapshot(baseSnapshot, 'selected_entities', selectedTotal, 'report_history', 'summary'),
    buildMetricSnapshot(baseSnapshot, 'candidate_entities', candidateTotal, 'report_history', 'summary'),
    buildMetricSnapshot(baseSnapshot, 'subjective_reviews', subjectiveReviewed, 'report_history', 'summary'),
    buildMetricSnapshot(baseSnapshot, 'whatsapp_text_length', safeString(source.whatsapp_text).length, 'report_history', 'summary'),
    ...groupedSnapshots.flatMap((group) => [
      buildMetricSnapshot(baseSnapshot, 'group_selected_entities', safeInteger(group.selection_count), 'group_history', 'dimension', safeString(group.group_id), {
        group_id: safeString(group.group_id),
        entity_type: safeString(group.entity_type),
        category: safeString(group.category),
        measure: 'selected_entities',
      }),
      buildMetricSnapshot(baseSnapshot, 'group_candidate_entities', safeInteger(group.candidate_count), 'group_history', 'dimension', safeString(group.group_id), {
        group_id: safeString(group.group_id),
        entity_type: safeString(group.entity_type),
        category: safeString(group.category),
        measure: 'candidate_entities',
      }),
    ]),
  ];

  const ingestionAudit = [{
    audit_key: auditKey,
    metrics_group_key: metricsGroupKey,
    entity_level: entityKind,
    entity_id: entityId,
    report_date: reportDate,
    metrics_window: 'category_report',
    requested_at: requestedAt,
    api_version: 'workflow',
    schedule_mode: 'manual',
    fetch_status_summary: 'synthetic',
    fetch_status_hourly: '',
    fetch_status_breakdown: '',
    row_count_summary: 1,
    row_count_hourly: 0,
    row_count_breakdown: groupedSnapshots.length,
    ingestion_status: 'ok',
    payload_hashes_json: JSON.stringify([{ payload_hash: rawPayloadHash, request_key: `${reportKey}|report_history` }]),
    raw_payload_references_json: JSON.stringify([{ raw_payload_reference: rawPayloadReference, request_key: `${reportKey}|report_history` }]),
    processing_notes_json: JSON.stringify(['report_history_fallback_via_metrics_worker']),
    warning_codes_json: JSON.stringify([]),
    warning_count: 0,
    low_confidence_count: 0,
    created_at: requestedAt,
    updated_at: requestedAt,
  }];

  const entityRecord = {
    entity_key: metricsGroupKey,
    entity_kind: entityKind,
    entity_id: entityId,
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
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    configured_status: 'ACTIVE',
    source_json: {
      report_key: reportKey,
      category,
      category_label: safeString(source.category_label),
      message_type: safeString(source.message_type),
      idempotency_key: safeString(source.idempotency_key),
      headline_math_summary: safeString(source.headline_math_summary),
      subjective_coverage: deepClone(source.subjective_coverage || {}),
      group_counts_by_category: deepClone(source.group_counts_by_category || {}),
      delivery_entity: deepClone(deliveryEntity),
      whatsapp_image_url: safeString(source.whatsapp_image_url),
    },
    first_seen_at: requestedAt,
    last_seen_at: requestedAt,
  };

  return {
    json: {
      ...source,
      report_key: reportKey,
      report_history_summary: {
        grouped_snapshots: groupedSnapshots.length,
        subjective_reviews: subjectiveReviewed,
        consolidated_reports: 1,
      },
      storage_plan: {
        ...(source.storage_plan || {}),
        mode: 'cloudflare_worker_metrics_fallback',
        worker: {
          enabled: true,
          body: {
            run: {
              run_id: `${safeString(source.idempotency_key || reportKey)}:report_history`,
              workflow_name: WORKFLOW_NAME,
              report_mode: 'report_history_fallback',
              report_date: reportDate,
              requested_at: requestedAt,
              account_id: accountId,
              metrics_group_key: metricsGroupKey,
            },
            entities: [entityRecord],
            metric_snapshots: metricSnapshots,
            ingestion_audit: ingestionAudit,
            raw_payloads: [{
              payload_hash: rawPayloadHash,
              request_key: `${reportKey}|report_history`,
              audit_key: auditKey,
              metrics_group_key: metricsGroupKey,
              raw_payload_reference: rawPayloadReference,
              raw_payload_body: rawPayloadBody,
              storage_backend: 'cloudflare_worker',
              payload_size_bytes: Buffer.byteLength(rawPayloadBody, 'utf8'),
              fetch_status: 'ok',
              retrieved_at: requestedAt,
            }],
            compatibility_exports: {
              summary_rows: [],
              breakdown_rows: [],
            },
            duplication_report: [],
          },
        },
      },
    },
  };
});
