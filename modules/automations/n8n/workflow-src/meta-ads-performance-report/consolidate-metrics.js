function safeString(value) {
  return String(value ?? '').trim();
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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

function dedupeBy(arr, keyFn) {
  const output = [];
  const seen = new Set();

  for (const item of Array.isArray(arr) ? arr : []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function getMetricVariantPriority(metricRecord) {
  const windowKey = safeString(metricRecord.metrics_window);
  const sourceKind = safeString(metricRecord.source_kind);
  const metricName = safeString(metricRecord.metric_name);

  const preferSummary = (
    /reach|frequency|unique_|quality_ranking|engagement_rate_ranking|conversion_rate_ranking|estimated_ad_recall|account_currency/.test(metricName)
  );

  if (windowKey === 'last_24h') {
    if (preferSummary && sourceKind === 'summary') return 100;
    if (!preferSummary && sourceKind === 'hourly') return 100;
    if (sourceKind === 'summary') return 80;
    if (sourceKind === 'hourly') return 75;
  }

  if (windowKey === 'last_7d' || windowKey === 'last_30d') {
    if (sourceKind === 'derived') return 100;
    if (sourceKind === 'summary') return 80;
  }

  return 50;
}

function mergeWarningArrays(records) {
  return dedupeBy(
    records.flatMap((record) => (record.warning_codes || []).map((code) => ({ code }))),
    (entry) => entry.code
  ).map((entry) => entry.code);
}

function buildMetricSelectionKey(record) {
  return [
    safeString(record.entity_level),
    safeString(record.entity_id),
    safeString(record.metrics_window),
    safeString(record.dimension_key),
    safeString(record.dimensions_json),
    safeString(record.metric_name),
  ].join('|');
}

function selectPrimaryMetricRecords(records) {
  const grouped = new Map();

  for (const record of records) {
    const key = buildMetricSelectionKey(record);

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(deepClone(record));
  }

  const primaryRecords = [];
  const duplicationReport = [];

  for (const [selectionKey, candidates] of grouped.entries()) {
    candidates.sort((left, right) => {
      const rightPriority = getMetricVariantPriority(right);
      const leftPriority = getMetricVariantPriority(left);

      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }

      return safeString(right.source_kind).localeCompare(safeString(left.source_kind));
    });

    const primary = deepClone(candidates[0]);
    primary.warning_codes = mergeWarningArrays(candidates);
    primary.warning_messages = dedupeBy(
      candidates.flatMap((candidate) => (candidate.warning_messages || []).map((message) => ({ message }))),
      (entry) => entry.message
    ).map((entry) => entry.message);
    primary.duplicate_source_kinds = dedupeBy(candidates.map((candidate) => ({ source_kind: candidate.source_kind })), (entry) => entry.source_kind).map((entry) => entry.source_kind);
    primary.is_primary = true;

    if (candidates.length > 1) {
      duplicationReport.push({
        selection_key: selectionKey,
        metric_name: primary.metric_name,
        kept_source_kind: primary.source_kind,
        discarded_source_kinds: candidates.slice(1).map((candidate) => candidate.source_kind),
      });
    }

    primaryRecords.push(primary);
  }

  return {
    primary_records: primaryRecords,
    duplication_report: duplicationReport,
  };
}

function summarizeAuditFragments(fragments, base) {
  const output = {};
  const byWindow = new Map();

  for (const fragment of fragments) {
    const windowKey = safeString(fragment.metrics_window);
    if (!windowKey) continue;

    if (!byWindow.has(windowKey)) {
      byWindow.set(windowKey, []);
    }

    byWindow.get(windowKey).push(fragment);
  }

  for (const [windowKey, windowFragments] of byWindow.entries()) {
    const summaryFragment = windowFragments.find((fragment) => fragment.request_kind === 'core' && fragment.request_variant === 'summary');
    const hourlyFragment = windowFragments.find((fragment) => fragment.request_kind === 'core' && fragment.request_variant === 'hourly');
    const breakdownFragments = windowFragments.filter((fragment) => fragment.request_kind === 'breakdown');

    const notes = [];
    const warnings = windowFragments.flatMap((fragment) => fragment.warnings || []);
    const warningCodes = dedupeBy(warnings.map((warning) => ({ code: warning.code })), (entry) => entry.code).map((entry) => entry.code);

    if (summaryFragment?.fetch_status === 'error') notes.push('summary_fetch_failed');
    if (hourlyFragment?.fetch_status === 'error') notes.push('hourly_fetch_failed');
    if (breakdownFragments.some((fragment) => fragment.fetch_status === 'error')) notes.push('breakdown_fetch_failed');
    if (warnings.length) notes.push('consistency_warnings_present');

    const ingestionStatus = (() => {
      if (notes.includes('summary_fetch_failed') && notes.includes('hourly_fetch_failed')) return 'error';
      if (notes.length) return 'partial';
      return 'ok';
    })();

    output[windowKey] = {
      audit_key: [
        safeString(base.metrics_group_key),
        safeString(base.scope_type),
        windowKey,
        safeString(base.report_date),
      ].join('|'),
      metrics_group_key: safeString(base.metrics_group_key),
      entity_level: safeString(base.scope_type),
      entity_id: safeString(base.scope_id),
      report_date: safeString(base.report_date),
      metrics_window: windowKey,
      requested_at: safeString(base.requested_at),
      api_version: safeString(base.api_version),
      schedule_mode: safeString(base.run_context?.schedule_mode || 'manual'),
      fetch_status_summary: safeString(summaryFragment?.fetch_status || ''),
      fetch_status_hourly: safeString(hourlyFragment?.fetch_status || ''),
      fetch_status_breakdown: breakdownFragments.length
        ? (breakdownFragments.some((fragment) => fragment.fetch_status === 'error') ? 'partial' : 'ok')
        : '',
      row_count_summary: safeNumber(summaryFragment?.windowed_row_count),
      row_count_hourly: safeNumber(hourlyFragment?.windowed_row_count),
      row_count_breakdown: breakdownFragments.reduce((sum, fragment) => sum + safeNumber(fragment.windowed_row_count), 0),
      ingestion_status: ingestionStatus,
      payload_hashes_json: stableStringify(windowFragments.map((fragment) => ({
        request_key: fragment.request_key,
        payload_hash: fragment.payload_hash,
      }))),
      raw_payload_references_json: stableStringify(windowFragments.map((fragment) => ({
        request_key: fragment.request_key,
        raw_payload_reference: fragment.raw_payload_reference,
      }))),
      processing_notes_json: stableStringify(notes),
      warning_codes_json: stableStringify(warningCodes),
      warning_count: warnings.length,
      low_confidence_count: windowFragments.reduce((sum, fragment) => sum + safeNumber(fragment.low_confidence_count), 0),
      created_at: safeString(base.requested_at),
      updated_at: new Date().toISOString(),
    };
  }

  return output;
}

function buildCompatibilitySummaryRows(primaryMetricRecords, base) {
  const grouped = new Map();

  for (const record of primaryMetricRecords.filter((metricRecord) => !safeString(metricRecord.dimension_key))) {
    const key = [
      record.entity_level,
      record.entity_id,
      record.metrics_window,
    ].join('|');

    if (!grouped.has(key)) {
      grouped.set(key, {
        report_date: safeString(base.report_date),
        entity_level: safeString(record.entity_level),
        entity_id: safeString(record.entity_id),
        entity_name: safeString(record.entity_name),
        metrics_window: safeString(record.metrics_window),
      });
    }

    grouped.get(key)[record.metric_name] = record.metric_value;
  }

  return [...grouped.values()];
}

function buildCompatibilityBreakdownRows(primaryMetricRecords, base) {
  return primaryMetricRecords
    .filter((metricRecord) => safeString(metricRecord.dimension_key))
    .map((record) => ({
      report_date: safeString(base.report_date),
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
    }));
}

function buildStoragePlan(base, entities, metricSnapshots, ingestionAudit, rawPayloads, compatibilityExports, duplicationReport) {
  const storage = deepClone(base.run_context?.storage || {});
  const workerBody = {
    run: {
      run_id: safeString(base.run_context?.run_id),
      workflow_name: safeString(base.run_context?.workflow_name),
      report_mode: safeString(base.report_mode),
      report_date: safeString(base.report_date),
      requested_at: safeString(base.requested_at),
      account_id: safeString(base.account_id),
      metrics_group_key: safeString(base.metrics_group_key),
    },
    entities,
    metric_snapshots: metricSnapshots,
    ingestion_audit: Object.values(ingestionAudit),
    raw_payloads: rawPayloads,
    compatibility_exports: compatibilityExports,
    duplication_report: duplicationReport,
  };

  return {
    mode: safeString(storage.storage_mode || 'cloudflare_worker_prepared'),
    worker: {
      enabled: Boolean(storage.cloudflare_worker_url),
      url: safeString(storage.cloudflare_worker_url),
      token_present: Boolean(storage.cloudflare_worker_token_present),
      body: workerBody,
    },
    d1_targets: [
      'entities',
      'metric_snapshots',
      'ingestion_audit',
      'raw_payloads',
    ],
    r2_enabled: storage.raw_payloads_enabled !== false,
    r2_bucket_name: safeString(storage.r2_bucket_name),
    compatibility_export_enabled: Boolean(storage.compatibility_export_enabled),
    compatibility_export_target: safeString(storage.compatibility_export_target || 'google_sheets_optional'),
  };
}

const groups = new Map();

for (const item of $input.all()) {
  const json = deepClone(item.json || {});
  const groupKey = safeString(json.metrics_group_key || json.ad_id);
  if (!groupKey) continue;

  if (!groups.has(groupKey)) {
    groups.set(groupKey, {
      base: json,
      entity_records: [],
      metric_records: [],
      audit_fragments: [],
      raw_payload_records: [],
      breakdown_records: [],
    });
  }

  const group = groups.get(groupKey);
  group.base = group.base || json;
  group.entity_records.push(...(json.entity_records || []));
  group.metric_records.push(...(json.metric_records || []));
  group.audit_fragments.push(deepClone(json.audit_fragment || {}));
  group.raw_payload_records.push(deepClone(json.raw_payload_record || {}));
  group.breakdown_records.push(...(json.breakdown_records || []));
}

const outputs = [];

for (const group of groups.values()) {
  const base = group.base || {};
  const rawPayloadsEnabled = base.run_context?.storage?.raw_payloads_enabled !== false;
  const entities = dedupeBy(group.entity_records, (entity) => safeString(entity.entity_key));
  const availableRawPayloads = dedupeBy(group.raw_payload_records, (payload) => safeString(payload.request_key));
  const rawPayloads = rawPayloadsEnabled ? availableRawPayloads : [];
  const metricSelection = selectPrimaryMetricRecords(group.metric_records || []);
  const ingestionAudit = summarizeAuditFragments(group.audit_fragments || [], base);

  const compatibilityExports = {
    summary_rows: buildCompatibilitySummaryRows(metricSelection.primary_records, base),
    breakdown_rows: buildCompatibilityBreakdownRows(metricSelection.primary_records, base),
  };

  const storagePlan = buildStoragePlan(
    base,
    entities,
    metricSelection.primary_records,
    ingestionAudit,
    rawPayloads,
    compatibilityExports,
    metricSelection.duplication_report
  );

  outputs.push({
    json: {
      run_context: deepClone(base.run_context || {}),
      metrics_group_key: safeString(base.metrics_group_key),
      report_mode: safeString(base.report_mode || 'full'),
      report_date: safeString(base.report_date),
      requested_at: safeString(base.requested_at),
      account_id: safeString(base.account_id),
      api_version: safeString(base.api_version),
      ad_id: safeString(base.entity_context?.ad_id || base.ad_id),
      adset_id: safeString(base.entity_context?.adset_id || base.adset_id),
      campaign_id: safeString(base.entity_context?.campaign_id || base.campaign_id),
      creative_id: safeString(base.entity_context?.creative_id || base.creative_id),
      entity_context: deepClone(base.entity_context || {}),
      entities,
      metric_snapshots: metricSelection.primary_records,
      ingestion_audit: Object.values(ingestionAudit),
      raw_payloads: rawPayloads,
      compatibility_exports: compatibilityExports,
      duplication_report: metricSelection.duplication_report,
      storage_plan: storagePlan,
      summary: {
        entity_count: entities.length,
        metric_snapshot_count: metricSelection.primary_records.length,
        audit_record_count: Object.keys(ingestionAudit).length,
        raw_payload_count: rawPayloads.length,
        raw_payload_available_count: availableRawPayloads.length,
        warning_metric_count: metricSelection.primary_records.filter((record) => (record.warning_codes || []).length).length,
        low_confidence_metric_count: metricSelection.primary_records.filter((record) => record.confidence_status === 'low').length,
      },
    },
  });
}

return outputs;
