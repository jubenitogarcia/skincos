const WORKFLOW_TIMEZONE = 'America/Sao_Paulo';

const NON_METRIC_KEYS = new Set([
  'date_start',
  'date_stop',
  'ad_id',
  'adset_id',
  'campaign_id',
  'hourly_stats_aggregated_by_advertiser_time_zone',
  'age',
  'gender',
  'country',
  'region',
  'dma',
  'impression_device',
  'device_platform',
  'publisher_platform',
  'platform_position',
]);

const MAX_AGGREGATION_FIELDS = new Set([
  'reach',
  'unique_clicks',
  'unique_inline_link_clicks',
  'instagram_profile_visits',
  'estimated_ad_recallers',
]);

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
  return String(value ?? '').trim();
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

function extractErrorDetails(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const message = [
    payload?.error?.message,
    payload?.errorMessage,
    payload?.message,
    payload?.description,
  ]
    .map((value) => safeString(value))
    .find(Boolean);

  if (!message) return null;

  return {
    message,
    code: safeString(payload?.error?.code || payload?.statusCode || payload?.code),
    type: safeString(payload?.error?.type || payload?.type),
    subcode: safeString(payload?.error?.error_subcode),
  };
}

function getPairedIndex(pairedItem) {
  if (typeof pairedItem === 'number') return pairedItem;
  if (pairedItem && typeof pairedItem.item === 'number') return pairedItem.item;
  if (Array.isArray(pairedItem) && typeof pairedItem[0]?.item === 'number') return pairedItem[0].item;
  return null;
}

function getLocalDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
  };
}

function shiftLocalDateParts(date, deltaDays, timeZone) {
  const parts = getLocalDateParts(date, timeZone);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + deltaDays);

  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  };
}

function formatDateParts(parts) {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function buildWindowDateBounds(windowKey, anchorDate) {
  const today = formatDateParts(getLocalDateParts(anchorDate, WORKFLOW_TIMEZONE));
  const deltaDays = windowKey === 'last_7d' ? -6 : -29;
  const since = formatDateParts(shiftLocalDateParts(anchorDate, deltaDays, WORKFLOW_TIMEZONE));
  return { since, until: today };
}

function extractHourBucket(row) {
  const label = safeString(row?.hourly_stats_aggregated_by_advertiser_time_zone);
  const match = label.match(/^(\d{1,2}):/);
  return match ? Number(match[1]) : null;
}

function filterRowsForRolling24h(rows, job) {
  const anchorDate = job?.requested_at ? new Date(job.requested_at) : new Date();
  const anchorParts = getLocalDateParts(anchorDate, WORKFLOW_TIMEZONE);
  const today = formatDateParts(anchorParts);
  const yesterday = formatDateParts(shiftLocalDateParts(anchorDate, -1, WORKFLOW_TIMEZONE));
  const currentHour = anchorParts.hour;

  return rows.filter((row) => {
    const dateStart = safeString(row?.date_start);
    const bucketHour = extractHourBucket(row);

    if (bucketHour == null) return false;
    if (dateStart === today) return bucketHour <= currentHour;
    if (dateStart === yesterday) return bucketHour > currentHour;
    return false;
  });
}

function filterRowsForWindow(rows, windowKey, anchorDate) {
  const bounds = buildWindowDateBounds(windowKey, anchorDate);
  return rows.filter((row) => {
    const dateStart = safeString(row?.date_start);
    return dateStart >= bounds.since && dateStart <= bounds.until;
  });
}

function aggregateScalarMetrics(rows) {
  const numericMetrics = {};
  const textMetrics = {};
  const fieldPresence = new Set();

  for (const row of rows) {
    for (const [key, value] of Object.entries(row || {})) {
      if (NON_METRIC_KEYS.has(key) || Array.isArray(value) || value == null || value === '') continue;

      fieldPresence.add(key);
      const numericValue = Number(value);

      if (typeof value !== 'object' && Number.isFinite(numericValue) && safeString(value) !== '') {
        if (MAX_AGGREGATION_FIELDS.has(key)) {
          numericMetrics[key] = Math.max(safeNumber(numericMetrics[key]), numericValue);
        } else {
          numericMetrics[key] = Number(((numericMetrics[key] || 0) + numericValue).toFixed(6));
        }
        continue;
      }

      textMetrics[key] = value;
    }
  }

  return {
    scalar_metrics: { ...numericMetrics, ...textMetrics },
    scalar_field_presence: [...fieldPresence].sort(),
  };
}

function aggregateListMetric(rows, key) {
  const aggregated = {};

  for (const row of rows) {
    for (const entry of Array.isArray(row?.[key]) ? row[key] : []) {
      const metricKey = safeString(entry?.action_type || entry?.label || entry?.metric || entry?.key || 'value');
      if (!metricKey) continue;

      const rawValue = entry?.value;
      const numericValue = Number(rawValue);

      if (Number.isFinite(numericValue)) {
        aggregated[metricKey] = Number((((aggregated[metricKey] || 0)) + numericValue).toFixed(6));
      } else if (!(metricKey in aggregated)) {
        aggregated[metricKey] = rawValue;
      }
    }
  }

  return aggregated;
}

function aggregateAllPossibleInsights(rows, job, windowKey, errorDetails) {
  if (errorDetails) {
    return {
      request_kind: safeString(job?.request_kind),
      request_variant: safeString(job?.request_variant),
      scope_type: safeString(job?.scope_type),
      window: safeString(windowKey || job?.window),
      requested_fields: Array.isArray(job?.request_fields) ? deepClone(job.request_fields) : [],
      time_range: deepClone(job?.time_range || {}),
      row_count: 0,
      raw_fields_present: [],
      scalar_metrics: {},
      list_metrics: {},
      fetch_status: 'error',
      fetch_error: deepClone(errorDetails || null),
    };
  }

  const { scalar_metrics, scalar_field_presence } = aggregateScalarMetrics(rows);
  const listMetricKeys = new Set();

  for (const row of rows) {
    for (const [key, value] of Object.entries(row || {})) {
      if (Array.isArray(value) && value.length) listMetricKeys.add(key);
    }
  }

  const list_metrics = {};
  for (const key of [...listMetricKeys].sort()) {
    list_metrics[key] = aggregateListMetric(rows, key);
  }

  return {
    request_kind: safeString(job?.request_kind),
    request_variant: safeString(job?.request_variant),
    scope_type: safeString(job?.scope_type),
    window: safeString(windowKey || job?.window),
    requested_fields: Array.isArray(job?.request_fields) ? deepClone(job.request_fields) : [],
    time_range: deepClone(job?.time_range || {}),
    row_count: rows.length,
    raw_fields_present: [...new Set([...scalar_field_presence, ...listMetricKeys])].sort(),
    scalar_metrics,
    list_metrics,
    fetch_status: 'ok',
    fetch_error: null,
  };
}

function getActionCanonicalName(value) {
  const normalized = safeString(value);
  return INVERTED_ACTION_ALIASES[normalized] || normalized
    .replace(/\./g, '_')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function inferMetricGroup(metricName) {
  if (/quality_ranking|engagement_rate_ranking|conversion_rate_ranking|estimated_ad_recall/.test(metricName)) return 'diagnostic';
  if (/conversation|reply|messaging|conversion|purchase|roas/.test(metricName)) return 'conversion';
  if (/click|ctr|cpc|traffic|website_ctr|outbound/.test(metricName)) return 'traffic';
  if (/video|engagement|reaction|comment|post|instagram_profile_visits/.test(metricName)) return 'engagement';
  if (/spend|cpm|cpp|frequency|reach|impressions/.test(metricName)) return 'delivery';
  return 'diagnostic';
}

function inferAnalyticRole(metricName, metricGroup, dimensionKey) {
  if (dimensionKey) return 'investigation';
  if (metricGroup === 'diagnostic') return 'diagnostic';
  if (/quality_ranking|engagement_rate_ranking|conversion_rate_ranking|estimated_ad_recall/.test(metricName)) return 'diagnostic';
  return 'core_business';
}

function inferValueType(metricName) {
  if (/^cost_per_/.test(metricName)) return 'cost_per_action';
  if (/(_ctr|^ctr$|roas|rate|ranking|ratio)/.test(metricName)) return 'ratio';
  if (/^unique_/.test(metricName)) return 'unique';
  if (/_value$/.test(metricName) || /^conversion_value_/.test(metricName)) return 'scalar';
  if (/^derived_/.test(metricName)) return 'derived';
  if (/spend|cpc|cpm|cpp/.test(metricName)) return 'scalar';
  if (/objective|status|currency/.test(metricName)) return 'scalar';
  return 'action_count';
}

function inferMetricUnit(metricName) {
  if (/(_ctr|^ctr$|roas|rate|ranking)/.test(metricName)) return 'percentage';
  if (/spend|cpc|cpm|cpp|cost_per_/.test(metricName)) return 'currency';
  if (/frequency/.test(metricName)) return 'ratio';
  return 'count';
}

function buildMetricDescriptor(metricName, options = {}) {
  const metricGroup = inferMetricGroup(metricName);
  const analyticRole = inferAnalyticRole(metricName, metricGroup, options.dimension_key);
  const valueType = inferValueType(metricName);
  const unit = inferMetricUnit(metricName);

  return {
    metric_group: metricGroup,
    analytic_role: analyticRole,
    value_type: valueType,
    metric_unit: unit,
  };
}

function buildMetricRecord(job, windowKey, rowContext, payload) {
  const metricName = safeString(payload.metric_name);
  const descriptor = buildMetricDescriptor(metricName, {
    dimension_key: rowContext.dimension_key,
  });

  const sourceKind = safeString(payload.source_kind || job?.source_kind_hint || 'summary') || 'summary';
  const dimensionJson = stableStringify(rowContext.dimensions || {});
  const dimensionKey = safeString(rowContext.dimension_key);

  const recordKeySeed = [
    job.metrics_group_key,
    job.scope_type,
    job.scope_id,
    windowKey,
    dimensionKey,
    dimensionJson,
    metricName,
    sourceKind,
  ].join('|');

  return {
    snapshot_key: `snapshot_${hashString(recordKeySeed)}`,
    metrics_group_key: safeString(job.metrics_group_key),
    audit_key: safeString(job.audit_key),
    report_date: safeString(job.report_date),
    entity_level: safeString(job.scope_type),
    entity_id: safeString(job.scope_id),
    entity_name: safeString(
      job.entity_context?.[`${job.scope_type}_name`] ||
      job.entity_context?.ad_name ||
      job.entity_context?.adset_name ||
      job.entity_context?.campaign_name
    ),
    metrics_window: safeString(windowKey),
    metric_name: metricName,
    metric_value: payload.metric_value,
    metric_group: descriptor.metric_group,
    analytic_role: descriptor.analytic_role,
    value_type: descriptor.value_type,
    metric_unit: descriptor.metric_unit,
    source_kind: sourceKind,
    source_variant: safeString(payload.source_variant || job.request_variant),
    source_field: safeString(payload.source_field),
    source_metric_name: safeString(payload.source_metric_name || payload.source_field || metricName),
    account_currency: safeString(payload.account_currency),
    dimension_key: dimensionKey,
    dimensions_json: dimensionJson,
    dimensions: deepClone(rowContext.dimensions || {}),
    confidence_status: 'high',
    confidence_score: 1,
    warning_codes: [],
    warning_messages: [],
  };
}

function flattenScalarMetrics(job, windowKey, rowContext, allPossibleInsights) {
  const output = [];
  const scalarMetrics = allPossibleInsights.scalar_metrics || {};
  const accountCurrency = safeString(scalarMetrics.account_currency);

  for (const [key, value] of Object.entries(scalarMetrics)) {
    if (value === null || value === undefined || value === '') continue;

    const numericValue = nullableNumber(value);
    output.push(buildMetricRecord(job, windowKey, rowContext, {
      metric_name: safeString(key),
      metric_value: numericValue !== null ? numericValue : value,
      source_field: safeString(key),
      source_metric_name: safeString(key),
      source_kind: safeString(job.source_kind_hint || 'summary'),
      source_variant: safeString(job.request_variant),
      account_currency: accountCurrency,
    }));
  }

  return output;
}

function flattenListMetrics(job, windowKey, rowContext, allPossibleInsights) {
  const output = [];
  const accountCurrency = safeString(allPossibleInsights.scalar_metrics?.account_currency);
  const listMetrics = allPossibleInsights.list_metrics || {};

  for (const [listKey, listValues] of Object.entries(listMetrics)) {
    for (const [rawMetricName, rawValue] of Object.entries(listValues || {})) {
      const canonicalName = getActionCanonicalName(rawMetricName);
      const numericValue = nullableNumber(rawValue);
      let metricName = canonicalName;

      if (listKey === 'action_values') metricName = `${canonicalName}_value`;
      if (listKey === 'unique_actions') metricName = `unique_${canonicalName}`;
      if (listKey === 'conversions') metricName = `conversion_${canonicalName}`;
      if (listKey === 'conversion_values') metricName = `conversion_value_${canonicalName}`;
      if (listKey === 'cost_per_action_type') metricName = `cost_per_${canonicalName}`;
      if (listKey === 'cost_per_unique_action_type') metricName = `cost_per_unique_${canonicalName}`;
      if (listKey === 'website_purchase_roas') metricName = `website_purchase_roas_${canonicalName}`;
      if (listKey === 'purchase_roas') metricName = `purchase_roas_${canonicalName}`;

      output.push(buildMetricRecord(job, windowKey, rowContext, {
        metric_name: metricName,
        metric_value: numericValue !== null ? numericValue : rawValue,
        source_field: listKey,
        source_metric_name: rawMetricName,
        source_kind: safeString(job.source_kind_hint || 'summary'),
        source_variant: safeString(job.request_variant),
        account_currency: accountCurrency,
      }));
    }
  }

  return output;
}

function applyWarning(record, warning) {
  if (!record.warning_codes.includes(warning.code)) {
    record.warning_codes.push(warning.code);
  }

  if (!record.warning_messages.includes(warning.message)) {
    record.warning_messages.push(warning.message);
  }

  if (warning.severity === 'high') {
    record.confidence_status = 'low';
    record.confidence_score = Math.min(record.confidence_score, 0.35);
  } else {
    if (record.confidence_status === 'high') {
      record.confidence_status = 'medium';
    }
    record.confidence_score = Math.min(record.confidence_score, 0.7);
  }
}

function compareNumbers(actual, expected, tolerance = 0.03) {
  if (actual == null || expected == null) return false;
  if (expected === 0) return Math.abs(actual) > tolerance;
  return Math.abs((actual - expected) / expected) > tolerance;
}

function collectConsistencyWarnings(recordMap) {
  const warnings = [];

  const spend = recordMap.get('spend')?.metric_value ?? null;
  const clicks = recordMap.get('clicks')?.metric_value ?? null;
  const impressions = recordMap.get('impressions')?.metric_value ?? null;
  const ctr = recordMap.get('ctr')?.metric_value ?? null;
  const cpc = recordMap.get('cpc')?.metric_value ?? null;
  const cpm = recordMap.get('cpm')?.metric_value ?? null;
  const inlineLinkClicks = recordMap.get('inline_link_clicks')?.metric_value ?? null;
  const costPerInlineLinkClick = recordMap.get('cost_per_inline_link_click')?.metric_value ?? null;

  const expectedCtr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(6)) : null;
  const expectedCpc = clicks > 0 ? Number((spend / clicks).toFixed(6)) : null;
  const expectedCpm = impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(6)) : null;
  const expectedCostPerInlineLinkClick = inlineLinkClicks > 0 ? Number((spend / inlineLinkClicks).toFixed(6)) : null;

  if (compareNumbers(ctr, expectedCtr, 0.08)) {
    warnings.push({
      code: 'ctr_mismatch',
      severity: 'medium',
      metric_names: ['ctr'],
      message: `CTR inconsistente com clicks/impressions (${ctr} vs ${expectedCtr}).`,
    });
  }

  if (ctr != null && expectedCtr != null && ctr > 0 && ctr <= 1 && Math.abs((ctr * 100) - expectedCtr) <= 0.08) {
    warnings.push({
      code: 'ctr_scale_warning',
      severity: 'high',
      metric_names: ['ctr'],
      message: `CTR parece estar em escala 0-1 e não em percentual (${ctr}).`,
    });
  }

  if (compareNumbers(cpc, expectedCpc, 0.08)) {
    warnings.push({
      code: 'cpc_mismatch',
      severity: 'medium',
      metric_names: ['cpc'],
      message: `CPC inconsistente com spend/clicks (${cpc} vs ${expectedCpc}).`,
    });
  }

  if (compareNumbers(cpm, expectedCpm, 0.08)) {
    warnings.push({
      code: 'cpm_mismatch',
      severity: 'medium',
      metric_names: ['cpm'],
      message: `CPM inconsistente com spend/impressions (${cpm} vs ${expectedCpm}).`,
    });
  }

  if (compareNumbers(costPerInlineLinkClick, expectedCostPerInlineLinkClick, 0.08)) {
    warnings.push({
      code: 'cost_per_inline_link_click_mismatch',
      severity: 'medium',
      metric_names: ['cost_per_inline_link_click'],
      message: `Cost per inline link click inconsistente com spend/inline_link_clicks (${costPerInlineLinkClick} vs ${expectedCostPerInlineLinkClick}).`,
    });
  }

  for (const [metricName, record] of recordMap.entries()) {
    if (!/^cost_per_/.test(metricName)) continue;
    const baseMetricName = metricName
      .replace(/^cost_per_unique_/, 'unique_')
      .replace(/^cost_per_/, '');
    const baseMetric = recordMap.get(baseMetricName);

    if (!baseMetric) continue;

    const expected = baseMetric.metric_value > 0 ? Number((spend / baseMetric.metric_value).toFixed(6)) : null;
    if (compareNumbers(record.metric_value, expected, 0.12)) {
      warnings.push({
        code: 'cost_per_action_mismatch',
        severity: 'medium',
        metric_names: [metricName, baseMetricName],
        message: `${metricName} inconsistente com spend/${baseMetricName} (${record.metric_value} vs ${expected}).`,
      });
    }
  }

  return warnings;
}

function buildEntityRecords(job) {
  const context = deepClone(job.entity_context || {});
  const timestamp = safeString(job.requested_at || new Date().toISOString());
  const candidates = [
    {
      entity_kind: 'account',
      entity_id: safeString(context.account_id),
      entity_name: safeString(context.account_name),
      status: '',
      effective_status: '',
      configured_status: '',
    },
    {
      entity_kind: 'campaign',
      entity_id: safeString(context.campaign_id),
      entity_name: safeString(context.campaign_name),
      status: safeString(context.campaign_status),
      effective_status: safeString(context.campaign_effective_status),
      configured_status: '',
    },
    {
      entity_kind: 'adset',
      entity_id: safeString(context.adset_id),
      entity_name: safeString(context.adset_name),
      status: safeString(context.adset_status),
      effective_status: safeString(context.adset_effective_status),
      configured_status: '',
    },
    {
      entity_kind: 'ad',
      entity_id: safeString(context.ad_id),
      entity_name: safeString(context.ad_name),
      status: safeString(context.ad_status),
      effective_status: safeString(context.ad_effective_status),
      configured_status: safeString(context.ad_configured_status),
    },
    {
      entity_kind: 'creative',
      entity_id: safeString(context.creative_id),
      entity_name: safeString(context.creative_name),
      status: safeString(context.creative_status),
      effective_status: '',
      configured_status: '',
    },
  ];

  return candidates
    .filter((candidate) => candidate.entity_id)
    .map((candidate) => ({
      entity_key: `${candidate.entity_kind}:${candidate.entity_id}`,
      entity_kind: candidate.entity_kind,
      entity_id: candidate.entity_id,
      entity_name: candidate.entity_name,
      account_id: safeString(context.account_id),
      campaign_id: safeString(context.campaign_id),
      campaign_name: safeString(context.campaign_name),
      adset_id: safeString(context.adset_id),
      adset_name: safeString(context.adset_name),
      ad_id: safeString(context.ad_id),
      ad_name: safeString(context.ad_name),
      creative_id: safeString(context.creative_id),
      creative_name: safeString(context.creative_name),
      page_id: safeString(context.page_id),
      instagram_user_id: safeString(context.instagram_user_id),
      campaign_objective: safeString(context.campaign_objective),
      optimization_goal: safeString(context.optimization_goal),
      destination_type: safeString(context.destination_type),
      bid_strategy: safeString(context.bid_strategy),
      billing_event: safeString(context.billing_event),
      buying_type: safeString(context.buying_type),
      status: candidate.status,
      effective_status: candidate.effective_status,
      configured_status: candidate.configured_status,
      source_json: deepClone(context),
      first_seen_at: timestamp,
      last_seen_at: timestamp,
    }));
}

function buildRawPayloadRecord(job, responsePayload, errorDetails) {
  const rawPayloadString = stableStringify(responsePayload);
  return {
    payload_hash: hashString(rawPayloadString),
    request_key: safeString(job.request_key),
    audit_key: safeString(job.audit_key),
    metrics_group_key: safeString(job.metrics_group_key),
    raw_payload_key: safeString(job.raw_payload_key),
    raw_payload_reference: safeString(job.raw_payload_key),
    payload_size_bytes: rawPayloadString.length,
    raw_payload_body: rawPayloadString,
    storage_backend: 'r2',
    retrieved_at: safeString(job.requested_at || new Date().toISOString()),
    fetch_status: errorDetails ? 'error' : 'ok',
  };
}

function attachWarnings(metricRecords) {
  const grouped = new Map();

  for (const record of metricRecords) {
    const key = [
      record.entity_level,
      record.entity_id,
      record.metrics_window,
      record.dimension_key,
      record.dimensions_json,
      record.source_kind,
    ].join('|');

    if (!grouped.has(key)) grouped.set(key, new Map());
    grouped.get(key).set(record.metric_name, record);
  }

  const allWarnings = [];

  for (const recordMap of grouped.values()) {
    const warnings = collectConsistencyWarnings(recordMap);
    allWarnings.push(...warnings);

    for (const warning of warnings) {
      for (const metricName of warning.metric_names) {
        const record = recordMap.get(metricName);
        if (record) {
          applyWarning(record, warning);
        }
      }
    }
  }

  return {
    metric_records: metricRecords,
    warnings: allWarnings,
  };
}

function normalizeCoreRequest(job, rows, windowKey, errorDetails) {
  const allPossibleInsights = aggregateAllPossibleInsights(rows, job, windowKey, errorDetails);
  const rowContext = {
    dimension_key: '',
    dimensions: {},
  };

  const metricRecords = [
    ...flattenScalarMetrics(job, windowKey, rowContext, allPossibleInsights),
    ...flattenListMetrics(job, windowKey, rowContext, allPossibleInsights),
  ];
  const warningResult = attachWarnings(metricRecords);

  return {
    metric_records: warningResult.metric_records,
    warnings: warningResult.warnings,
    all_possible_insights: allPossibleInsights,
    breakdown_records: [],
  };
}

function getBreakdownDimensions(row, breakdowns) {
  const dimensions = {};

  for (const key of Array.isArray(breakdowns) ? breakdowns : []) {
    dimensions[key] = row?.[key] ?? null;
  }

  return dimensions;
}

function normalizeBreakdownRequest(job, rows, windowKey, errorDetails) {
  if (errorDetails) {
    return {
      metric_records: [],
      warnings: [
        {
          code: 'fetch_error',
          severity: 'high',
          metric_names: [],
          message: safeString(errorDetails.message || 'Falha ao buscar breakdowns.'),
        },
      ],
      all_possible_insights: aggregateAllPossibleInsights([], job, windowKey, errorDetails),
      breakdown_records: [],
    };
  }

  const breakdowns = Array.isArray(job?.breakdowns) ? deepClone(job.breakdowns) : [];
  const grouped = new Map();

  for (const row of rows) {
    const dimensions = getBreakdownDimensions(row, breakdowns);
    const groupKey = stableStringify(dimensions);

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }

    grouped.get(groupKey).push(deepClone(row));
  }

  const metricRecords = [];
  const breakdownRecords = [];
  const warnings = [];

  for (const [groupKey, groupRows] of grouped.entries()) {
    const dimensions = JSON.parse(groupKey);
    const rowContext = {
      dimension_key: safeString(job.breakdown_key),
      dimensions,
    };
    const allPossibleInsights = aggregateAllPossibleInsights(groupRows, job, windowKey, null);
    const rowsForDimension = [
      ...flattenScalarMetrics(job, windowKey, rowContext, allPossibleInsights),
      ...flattenListMetrics(job, windowKey, rowContext, allPossibleInsights),
    ];

    const warningResult = attachWarnings(rowsForDimension);
    metricRecords.push(...warningResult.metric_records);
    warnings.push(...warningResult.warnings);

    breakdownRecords.push({
      breakdown_key: safeString(job.breakdown_key),
      dimensions,
      row_count: groupRows.length,
      metric_count: warningResult.metric_records.length,
    });
  }

  return {
    metric_records: metricRecords,
    warnings,
    all_possible_insights: aggregateAllPossibleInsights(rows, job, windowKey, null),
    breakdown_records: breakdownRecords,
  };
}

function buildAuditFragment(job, windowKey, requestResult, rawPayloadRecord, errorDetails, rawRowCount, windowedRowCount) {
  const warningCodes = [...new Set((requestResult.warnings || []).map((warning) => warning.code))];
  const lowConfidenceCount = (requestResult.metric_records || []).filter((record) => record.confidence_status === 'low').length;

  return {
    audit_key: safeString(job.audit_key),
    request_key: safeString(job.request_key),
    metrics_group_key: safeString(job.metrics_group_key),
    entity_level: safeString(job.scope_type),
    entity_id: safeString(job.scope_id),
    report_date: safeString(job.report_date),
    metrics_window: safeString(windowKey),
    request_kind: safeString(job.request_kind),
    request_variant: safeString(job.request_variant),
    source_kind: safeString(job.source_kind_hint || 'summary'),
    requested_at: safeString(job.requested_at),
    api_version: safeString(job.api_version),
    schedule_mode: safeString(job.run_context?.schedule_mode || 'manual'),
    fetch_status: errorDetails ? 'error' : 'ok',
    row_count: rawRowCount,
    windowed_row_count: windowedRowCount,
    payload_hash: safeString(rawPayloadRecord.payload_hash),
    raw_payload_reference: safeString(rawPayloadRecord.raw_payload_reference),
    warning_codes: warningCodes,
    warnings: deepClone(requestResult.warnings || []),
    low_confidence_count: lowConfidenceCount,
  };
}

function emitNormalizedOutput(job, windowKey, rows, requestResult, rawPayloadRecord, auditFragment, rawRowCount, windowedRowCount) {
  return {
    json: {
      run_context: deepClone(job.run_context || {}),
      metrics_group_key: safeString(job.metrics_group_key),
      audit_key: safeString(job.audit_key),
      request_key: safeString(job.request_key),
      report_mode: safeString(job.report_mode),
      report_date: safeString(job.report_date),
      requested_at: safeString(job.requested_at),
      account_id: safeString(job.account_id),
      api_version: safeString(job.api_version),
      scope_type: safeString(job.scope_type),
      scope_id: safeString(job.scope_id),
      level: safeString(job.level),
      window: safeString(windowKey),
      request_kind: safeString(job.request_kind),
      request_variant: safeString(job.request_variant),
      source_kind: safeString(job.source_kind_hint || 'summary'),
      breakdown_key: safeString(job.breakdown_key),
      entity_context: deepClone(job.entity_context || {}),
      entity_records: buildEntityRecords(job),
      metric_records: requestResult.metric_records || [],
      breakdown_records: requestResult.breakdown_records || [],
      audit_fragment: auditFragment,
      raw_payload_record: rawPayloadRecord,
      raw_row_count: rawRowCount,
      windowed_row_count: windowedRowCount,
      all_possible_insights: requestResult.all_possible_insights,
      fetched_at: new Date().toISOString(),
    },
  };
}

const metricJobItems = $('Build Insights').all();
const outputs = [];

for (const item of $input.all()) {
  const pairedIndex = getPairedIndex(item.pairedItem);
  const job = deepClone(metricJobItems[pairedIndex]?.json || {});
  const rawRows = Array.isArray(item.json?.data) ? item.json.data : [];
  const errorDetails = extractErrorDetails(item.json);
  const rawPayloadRecord = buildRawPayloadRecord(job, item.json || {}, errorDetails);
  const anchorDate = job?.requested_at ? new Date(job.requested_at) : new Date();

  if (job.request_kind === 'core') {
    if (job.request_variant === 'hourly') {
      const filteredRows = errorDetails ? [] : filterRowsForRolling24h(rawRows, job);
      const requestResult = normalizeCoreRequest(job, filteredRows, 'last_24h', errorDetails);
      const auditFragment = buildAuditFragment(job, 'last_24h', requestResult, rawPayloadRecord, errorDetails, rawRows.length, filteredRows.length);
      outputs.push(emitNormalizedOutput(job, 'last_24h', filteredRows, requestResult, rawPayloadRecord, auditFragment, rawRows.length, filteredRows.length));
      continue;
    }

    if (job.request_variant === 'summary') {
      const requestResult = normalizeCoreRequest(job, rawRows, 'last_24h', errorDetails);
      const auditFragment = buildAuditFragment(job, 'last_24h', requestResult, rawPayloadRecord, errorDetails, rawRows.length, rawRows.length);
      outputs.push(emitNormalizedOutput(job, 'last_24h', rawRows, requestResult, rawPayloadRecord, auditFragment, rawRows.length, rawRows.length));
      continue;
    }

    if (job.request_variant === 'daily_rollup') {
      for (const windowKey of Array.isArray(job.derived_windows) ? job.derived_windows : []) {
        const filteredRows = errorDetails ? [] : filterRowsForWindow(rawRows, windowKey, anchorDate);
        const requestResult = normalizeCoreRequest(job, filteredRows, windowKey, errorDetails);
        const auditFragment = buildAuditFragment(job, windowKey, requestResult, rawPayloadRecord, errorDetails, rawRows.length, filteredRows.length);
        outputs.push(emitNormalizedOutput(job, windowKey, filteredRows, requestResult, rawPayloadRecord, auditFragment, rawRows.length, filteredRows.length));
      }
      continue;
    }
  }

  if (job.request_kind === 'breakdown') {
    if (job.request_variant === 'breakdown_summary_24h') {
      const requestResult = normalizeBreakdownRequest(job, rawRows, 'last_24h', errorDetails);
      const auditFragment = buildAuditFragment(job, 'last_24h', requestResult, rawPayloadRecord, errorDetails, rawRows.length, rawRows.length);
      outputs.push(emitNormalizedOutput(job, 'last_24h', rawRows, requestResult, rawPayloadRecord, auditFragment, rawRows.length, rawRows.length));
      continue;
    }

    if (job.request_variant === 'breakdown_daily_rollup') {
      for (const windowKey of Array.isArray(job.derived_windows) ? job.derived_windows : []) {
        const filteredRows = errorDetails ? [] : filterRowsForWindow(rawRows, windowKey, anchorDate);
        const requestResult = normalizeBreakdownRequest(job, filteredRows, windowKey, errorDetails);
        const auditFragment = buildAuditFragment(job, windowKey, requestResult, rawPayloadRecord, errorDetails, rawRows.length, filteredRows.length);
        outputs.push(emitNormalizedOutput(job, windowKey, filteredRows, requestResult, rawPayloadRecord, auditFragment, rawRows.length, filteredRows.length));
      }
    }
  }
}

return outputs;
