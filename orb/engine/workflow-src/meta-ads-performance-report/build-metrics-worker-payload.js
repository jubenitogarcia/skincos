const WORKFLOW_NAME = 'Meta Ads – Copia para o Codex Trabalhar';

const ACTION_ALIASES = {
  conversation_started: [
    'onsite_conversion.messaging_conversation_started_7d',
    'onsite_conversion_messaging_conversation_started_7d',
  ],
  total_messaging_connection: [
    'onsite_conversion.total_messaging_connection',
    'onsite_conversion_total_messaging_connection',
  ],
  first_reply: [
    'onsite_conversion.messaging_first_reply',
    'onsite_conversion_messaging_first_reply',
  ],
  conversation_replied: [
    'onsite_conversion.messaging_conversation_replied_7d',
    'onsite_conversion_messaging_conversation_replied_7d',
  ],
  messaging_depth_2: [
    'onsite_conversion.messaging_user_depth_2_message_send',
    'onsite_conversion_messaging_user_depth_2_message_send',
  ],
  messaging_depth_3: [
    'onsite_conversion.messaging_user_depth_3_message_send',
    'onsite_conversion_messaging_user_depth_3_message_send',
  ],
  messaging_depth_5: [
    'onsite_conversion.messaging_user_depth_5_message_send',
    'onsite_conversion_messaging_user_depth_5_message_send',
  ],
  outbound_clicks: [
    'outbound_click',
    'outbound_clicks',
  ],
  inline_link_clicks: [
    'inline_link_click',
    'link_click',
  ],
  post_reaction: [
    'post_reaction',
    'like',
    'onsite_conversion.post_net_like',
    'onsite_conversion_post_net_like',
  ],
  comments: [
    'comment',
  ],
  posts: [
    'post',
  ],
};

const INVERTED_ACTION_ALIASES = (() => {
  const output = {};

  for (const [canonicalName, aliases] of Object.entries(ACTION_ALIASES)) {
    for (const alias of aliases) {
      output[alias] = canonicalName;
    }
  }

  return output;
})();

function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : null;
}

function safeInteger(value) {
  const numeric = safeNumber(value);
  return numeric === null ? 0 : Math.trunc(numeric);
}

function safeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = safeString(value).toLowerCase();
  if (['true', '1', 'yes', 'y', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'nao', 'não'].includes(normalized)) return false;
  return false;
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

function compactValue(value) {
  if (value === null || value === undefined) return undefined;

  if (Array.isArray(value)) {
    const out = value.map(compactValue).filter((entry) => entry !== undefined);
    return out.length ? out : undefined;
  }

  if (isObject(value)) {
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

function getActionCanonicalName(value) {
  const normalized = safeString(value);
  return INVERTED_ACTION_ALIASES[normalized] || normalized
    .replace(/\./g, '_')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizeListMetricName(metricGroup, rawMetricName) {
  const canonicalName = getActionCanonicalName(rawMetricName);

  if (metricGroup === 'action_values') return `${canonicalName}_value`;
  if (metricGroup === 'unique_actions') return `unique_${canonicalName}`;
  if (metricGroup === 'conversions') return `conversion_${canonicalName}`;
  if (metricGroup === 'conversion_values') return `conversion_value_${canonicalName}`;
  if (metricGroup === 'costs') return `cost_per_${canonicalName}`;
  if (metricGroup === 'unique_costs') return `cost_per_unique_${canonicalName}`;
  if (metricGroup === 'website_purchase_roas') return `website_purchase_roas_${canonicalName}`;
  if (metricGroup === 'purchase_roas') return `purchase_roas_${canonicalName}`;
  if (metricGroup === 'actions') return canonicalName;

  return safeString(rawMetricName);
}

function toConfidenceScore(value) {
  const numeric = safeNumber(value);
  if (numeric === null) return 0;
  return numeric <= 1 ? Math.round(numeric * 100) : numeric;
}

function inferSourceKind(windowPayload, metricGroup, fallback) {
  const fromContext = safeString(windowPayload?.context?.source_kind);
  if (fromContext) return fromContext;

  const nonAdditive = safeString(windowPayload?.derivation?.non_additive_source);
  if (nonAdditive) return nonAdditive;

  if (metricGroup === 'breakdown') return 'breakdown';
  return safeString(fallback || 'summary');
}

function inferSourceVariant(windowPayload, metricGroup, fallback) {
  const fromContext = safeString(windowPayload?.context?.request_variant);
  if (fromContext) return fromContext;
  if (metricGroup === 'breakdown') return safeString(fallback || 'breakdown');
  return safeString(fallback || 'normalized');
}

function normalizeDimensions(value) {
  if (!isObject(value)) return {};

  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      output[key] = raw;
    }
  }
  return output;
}

function buildEntityRecord(source) {
  const context = source.entity_context || {};
  const entity = source.entity || {};
  const refs = entity.refs || {};
  const labels = entity.labels || {};
  const requestedAt = safeString(source.requested_at) || new Date().toISOString();

  return compactObject({
    entity_key: safeString(entity.entity_key),
    entity_kind: safeString(entity.entity_kind),
    entity_id: safeString(entity.entity_id),
    entity_name: safeString(entity.entity_name),
    account_id: safeString(refs.account_id || context.account_id || source.account_id),
    campaign_id: safeString(refs.campaign_id || context.campaign_id),
    campaign_name: safeString(labels.campaign_name || context.campaign_name),
    adset_id: safeString(refs.adset_id || context.adset_id),
    adset_name: safeString(labels.adset_name || context.adset_name),
    ad_id: safeString(refs.ad_id || context.ad_id),
    ad_name: safeString(labels.ad_name || context.ad_name),
    creative_id: safeString(refs.creative_id || context.creative_id),
    creative_name: safeString(labels.creative_name || context.creative_name),
    page_id: safeString(refs.page_id || context.page_id),
    instagram_user_id: safeString(refs.instagram_user_id || context.instagram_user_id),
    campaign_objective: safeString(context.campaign_objective),
    optimization_goal: safeString(context.optimization_goal),
    destination_type: safeString(context.destination_type),
    bid_strategy: safeString(context.bid_strategy),
    billing_event: safeString(context.billing_event),
    buying_type: safeString(context.buying_type),
    status: safeString(context.status),
    effective_status: safeString(context.effective_status),
    configured_status: safeString(context.configured_status),
    source_json: compactObject({
      entity_context: context,
      request_context: source.request_context || {},
      visual: source.visual || {},
      summary: source.summary || {},
      register_audit: source.register_audit || {},
    }),
    first_seen_at: requestedAt,
    last_seen_at: requestedAt,
  });
}

function buildSnapshotKey(record) {
  return [
    safeString(record.metrics_group_key),
    safeString(record.entity_level),
    safeString(record.entity_id),
    safeString(record.report_date),
    safeString(record.metrics_window),
    safeString(record.metric_group),
    safeString(record.metric_name),
    safeString(record.dimension_key),
    hashString(safeString(record.dimensions_json)),
  ].join('|');
}

function pushMetricRecords(output, config) {
  const {
    metricsGroupKey,
    reportDate,
    entityLevel,
    entityId,
    entityName,
    metricsWindow,
    sourceKind,
    sourceVariant,
    accountCurrency,
    confidenceStatus,
    confidenceScore,
    warningCodes,
    warningMessages,
    values,
    metricGroup,
    analyticRole,
    valueType,
    metricUnit,
    dimensionKey = '',
    dimensionsJson = '{}',
    sourceField = metricGroup,
    recordedAt,
  } = config;

  for (const [rawMetricName, rawValue] of Object.entries(isObject(values) ? values : {})) {
    const metricName = normalizeListMetricName(metricGroup, rawMetricName);
    const metricValue = safeNumber(rawValue);
    if (metricValue === null) continue;

    const record = {
      snapshot_key: '',
      metrics_group_key: metricsGroupKey,
      audit_key: [metricsGroupKey, entityLevel, metricsWindow, metricGroup, metricName, hashString(dimensionsJson)].join('|'),
      report_date: reportDate,
      entity_level: entityLevel,
      entity_id: entityId,
      entity_name: entityName,
      metrics_window: metricsWindow,
      metric_name: safeString(metricName),
      metric_value: metricValue,
      metric_group: metricGroup,
      analytic_role: analyticRole,
      value_type: valueType,
      metric_unit: metricUnit,
      source_kind: sourceKind,
      source_variant: sourceVariant,
      source_field: sourceField,
      source_metric_name: safeString(rawMetricName),
      account_currency: accountCurrency,
      dimension_key: safeString(dimensionKey),
      dimensions_json: dimensionsJson,
      confidence_status: confidenceStatus,
      confidence_score: confidenceScore,
      warning_codes: warningCodes,
      warning_messages: warningMessages,
      duplicate_source_kinds: [],
      is_primary: 1,
      recorded_at: recordedAt,
    };

    record.snapshot_key = buildSnapshotKey(record);
    output.push(record);
  }
}

function buildBreakdownRecords(source, metricsGroupKey, entityLevel, entityId, entityName, recordedAt) {
  const output = [];

  for (const [windowKey, windowPayload] of Object.entries(source.windows || {})) {
    const confidence = windowPayload?.health?.confidence || {};
    const warningCodes = safeArray(windowPayload?.health?.warning_codes);
    const warningMessages = [];
    const accountCurrency = safeString(windowPayload?.currency);

    for (const [breakdownKey, breakdownPayload] of Object.entries(windowPayload?.breakdowns || {})) {
      const breakdownItems = Array.isArray(breakdownPayload?.items)
        ? breakdownPayload.items
        : (isObject(breakdownPayload?.items) ? [breakdownPayload.items] : []);

      for (const rawItem of breakdownItems) {
        const item = isObject(rawItem) ? rawItem : {};
        const dimensions = {};
        const metrics = {};

        for (const [field, value] of Object.entries(item)) {
          if (safeNumber(value) !== null) {
            metrics[field] = safeNumber(value);
            continue;
          }

          if (typeof value === 'string' || typeof value === 'boolean') {
            dimensions[field] = value;
          }
        }

        if (!Object.keys(metrics).length) continue;

        const normalizedDimensions = normalizeDimensions(dimensions);
        const dimensionsJson = stableStringify(normalizedDimensions);

        pushMetricRecords(output, {
          metricsGroupKey,
          reportDate: safeString(source.report_date),
          entityLevel,
          entityId,
          entityName,
          metricsWindow: windowKey,
          sourceKind: inferSourceKind(windowPayload, 'breakdown', breakdownKey),
          sourceVariant: inferSourceVariant(windowPayload, 'breakdown', breakdownKey),
          accountCurrency,
          confidenceStatus: safeString(confidence.status || 'medium'),
          confidenceScore: toConfidenceScore(confidence.score),
          warningCodes,
          warningMessages,
          values: metrics,
          metricGroup: 'breakdown',
          analyticRole: 'breakdown',
          valueType: 'number',
          metricUnit: '',
          dimensionKey: safeString(breakdownKey),
          dimensionsJson,
          sourceField: `breakdowns.${breakdownKey}`,
          recordedAt,
        });
      }
    }
  }

  return output;
}

function buildMetricSnapshots(source) {
  const output = [];
  const metricsGroupKey = safeString(source.metrics_group_key);
  const entityLevel = safeString(source.entity?.entity_kind);
  const entityId = safeString(source.entity?.entity_id);
  const entityName = safeString(source.entity?.entity_name);
  const recordedAt = safeString(source.requested_at) || new Date().toISOString();

  for (const [windowKey, windowPayload] of Object.entries(source.windows || {})) {
    const confidence = windowPayload?.health?.confidence || {};
    const warningCodes = safeArray(windowPayload?.health?.warning_codes);
    const warningMessages = [];
    const accountCurrency = safeString(windowPayload?.currency);
    const common = {
      metricsGroupKey,
      reportDate: safeString(source.report_date),
      entityLevel,
      entityId,
      entityName,
      metricsWindow: safeString(windowKey),
      sourceKind: inferSourceKind(windowPayload, 'metrics'),
      sourceVariant: inferSourceVariant(windowPayload, 'metrics'),
      accountCurrency,
      confidenceStatus: safeString(confidence.status || 'medium'),
      confidenceScore: toConfidenceScore(confidence.score),
      warningCodes,
      warningMessages,
      valueType: 'number',
      metricUnit: '',
      recordedAt,
    };

    pushMetricRecords(output, {
      ...common,
      values: windowPayload.metrics,
      metricGroup: 'metrics',
      analyticRole: 'scalar',
      sourceField: 'metrics',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.actions,
      metricGroup: 'actions',
      analyticRole: 'action',
      sourceField: 'actions',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.action_values,
      metricGroup: 'action_values',
      analyticRole: 'action_value',
      sourceField: 'action_values',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.conversions,
      metricGroup: 'conversions',
      analyticRole: 'conversion',
      sourceField: 'conversions',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.conversion_values,
      metricGroup: 'conversion_values',
      analyticRole: 'conversion_value',
      sourceField: 'conversion_values',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.costs,
      metricGroup: 'costs',
      analyticRole: 'cost',
      sourceField: 'costs',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.unique_actions,
      metricGroup: 'unique_actions',
      analyticRole: 'unique_action',
      sourceField: 'unique_actions',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.unique_costs,
      metricGroup: 'unique_costs',
      analyticRole: 'unique_cost',
      sourceField: 'unique_costs',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.purchase_roas,
      metricGroup: 'purchase_roas',
      analyticRole: 'roas',
      sourceField: 'purchase_roas',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.website_purchase_roas,
      metricGroup: 'website_purchase_roas',
      analyticRole: 'roas',
      sourceField: 'website_purchase_roas',
    });
    pushMetricRecords(output, {
      ...common,
      values: windowPayload.other_list_metrics,
      metricGroup: 'other_list_metrics',
      analyticRole: 'list_metric',
      sourceField: 'other_list_metrics',
    });
  }

  output.push(...buildBreakdownRecords(source, metricsGroupKey, entityLevel, entityId, entityName, recordedAt));
  return dedupeMetricSnapshots(output);
}

function buildMetricUniquenessKey(record) {
  return [
    safeString(record.metrics_group_key),
    safeString(record.entity_level),
    safeString(record.entity_id),
    safeString(record.report_date),
    safeString(record.metrics_window),
    safeString(record.metric_name),
    safeString(record.dimension_key),
    safeString(record.dimensions_json),
  ].join('|');
}

function dedupeMetricSnapshots(records) {
  const seen = new Set();
  const output = [];

  for (const record of safeArray(records)) {
    const key = buildMetricUniquenessKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(record);
  }

  return output;
}

function buildCompatibilityExports(metricSnapshots) {
  return {
    summary_rows: [],
    breakdown_rows: safeArray(metricSnapshots)
      .filter((record) => safeString(record.dimension_key))
      .slice(0, 250)
      .map((record) => ({
        report_date: safeString(record.report_date),
        entity_level: safeString(record.entity_level),
        entity_id: safeString(record.entity_id),
        entity_name: safeString(record.entity_name),
        metrics_window: safeString(record.metrics_window),
        breakdown_key: safeString(record.dimension_key),
        dimensions_json: safeString(record.dimensions_json),
        metric_name: safeString(record.metric_name),
        metric_value: record.metric_value,
        metric_group: safeString(record.metric_group),
        analytic_role: safeString(record.analytic_role),
      })),
  };
}

function selectRawPayloadWindows(source, payload) {
  const requestKey = safeString(payload?.request_key);
  const parts = requestKey.split('|');
  const windowToken = safeString(parts[2]);

  if (windowToken === 'multi_window') {
    return deepClone(source.windows || {});
  }

  if (windowToken && source.windows?.[windowToken]) {
    return {
      [windowToken]: deepClone(source.windows[windowToken]),
    };
  }

  return {};
}

function hydrateRawPayloadRecord(source, payload) {
  const record = deepClone(payload || {});
  if (safeString(record.raw_payload_body)) return record;

  const bodyPayload = compactObject({
    reconstructed: true,
    reconstruction_reason: 'raw_payload_body_missing_in_finalize_stage',
    request_key: safeString(record.request_key),
    audit_key: safeString(record.audit_key),
    metrics_group_key: safeString(record.metrics_group_key || source.metrics_group_key),
    report_date: safeString(source.report_date),
    requested_at: safeString(source.requested_at),
    entity: source.entity || {},
    entity_context: source.entity_context || {},
    windows: selectRawPayloadWindows(source, record),
    ingestion_audit: safeArray(source.ingestion_audit),
  });

  const rawPayloadBody = JSON.stringify(bodyPayload);
  return {
    ...record,
    payload_hash: hashString(rawPayloadBody),
    raw_payload_body: rawPayloadBody,
    payload_size_bytes: Buffer.byteLength(rawPayloadBody, 'utf8'),
    storage_backend: safeString(record.storage_backend || 'cloudflare_worker'),
    fetch_status: safeString(record.fetch_status || 'reconstructed'),
  };
}

return $input.all().map((item) => {
  const source = deepClone(item.json || {});
  const entityRecord = buildEntityRecord(source);
  const metricSnapshots = buildMetricSnapshots(source);
  const compatibilityExports = buildCompatibilityExports(metricSnapshots);
  const workerBody = {
    run: {
      run_id: safeString(source.run_context?.run_id || source.metrics_group_key),
      workflow_name: safeString(source.run_context?.workflow_name || WORKFLOW_NAME),
      report_mode: safeString(source.report_mode),
      report_date: safeString(source.report_date),
      requested_at: safeString(source.requested_at),
      account_id: safeString(source.account_id),
      metrics_group_key: safeString(source.metrics_group_key),
    },
    entities: [entityRecord],
    metric_snapshots: metricSnapshots,
    ingestion_audit: safeArray(source.ingestion_audit).map((audit) => deepClone(audit)),
    raw_payloads: safeArray(source.raw_payloads).map((payload) => hydrateRawPayloadRecord(source, payload)),
    compatibility_exports: compatibilityExports,
    duplication_report: [],
  };

  const storage = deepClone(source.run_context?.storage || {});

  return {
    json: {
      ...source,
      storage_plan: {
        ...(source.storage_plan || {}),
        mode: safeString(storage.storage_mode || source.storage_plan?.mode || 'cloudflare_worker'),
        worker: {
          enabled: Boolean(storage.cloudflare_worker_url || source.storage_plan?.worker?.url),
          url: safeString(storage.cloudflare_worker_url || source.storage_plan?.worker?.url),
          token_present: safeBoolean(storage.cloudflare_worker_token_present || source.storage_plan?.worker?.token_present),
          body: workerBody,
        },
        d1_targets: ['entities', 'metric_snapshots', 'ingestion_audit', 'raw_payloads'],
        r2_enabled: storage.raw_payloads_enabled !== false,
        r2_bucket_name: safeString(storage.r2_bucket_name || source.storage_plan?.r2_bucket_name),
      },
      metrics_persistence_summary: {
        entity_records: 1,
        metric_snapshots: metricSnapshots.length,
        ingestion_audit_rows: safeArray(source.ingestion_audit).length,
        raw_payload_rows: safeArray(source.raw_payloads).length,
        compatibility_breakdown_rows: safeArray(compatibilityExports.breakdown_rows).length,
      },
    },
    binary: item.binary || {},
  };
});
