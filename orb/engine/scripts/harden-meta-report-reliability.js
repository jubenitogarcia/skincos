const fs = require('fs');
const path = require('path');

const workflowPath = path.resolve(__dirname, '..', 'workflows', 'meta-ads.performance-report.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

function getNode(name) {
  const node = (workflow.nodes || []).find((item) => item.name === name);
  if (!node) {
    throw new Error(`Node not found: ${name}`);
  }
  return node;
}

function patchNodeReliability(name) {
  const node = getNode(name);
  node.continueOnFail = true;
  node.retryOnFail = true;
  node.waitBetweenTries = 5000;
  node.maxTries = 3;
}

function replaceOrThrow(source, searchValue, replaceValue, description) {
  if (!source.includes(searchValue)) {
    throw new Error(`Patch target not found: ${description}`);
  }
  return source.replace(searchValue, replaceValue);
}

function patchBuildMetricsJobs() {
  const node = getNode('Build Metrics Jobs');
  let code = node.parameters.jsCode;

  if (!code.includes('function extractErrorDetails(payload) {')) {
    code = replaceOrThrow(
      code,
      "function deepClone(value) {\n  return value == null ? value : JSON.parse(JSON.stringify(value));\n}\n",
      "function deepClone(value) {\n  return value == null ? value : JSON.parse(JSON.stringify(value));\n}\n\nfunction extractErrorDetails(payload) {\n  if (!payload || typeof payload !== 'object') return null;\n\n  const message = [\n    payload?.error?.message,\n    payload?.errorMessage,\n    payload?.message,\n    payload?.description,\n  ].map((value) => String(value ?? '').trim()).find(Boolean);\n\n  if (!message) return null;\n\n  return {\n    message,\n    code: String(payload?.error?.code || payload?.statusCode || payload?.code || '').trim(),\n    type: String(payload?.error?.type || payload?.type || '').trim(),\n  };\n}\n",
      'insert extractErrorDetails helper',
    );
  }

  code = replaceOrThrow(
    code,
    "  const resolved = deepClone(item.json || {});\n\n  const reportMode = normalizeReportMode(\n",
    "  const resolved = deepClone(item.json || {});\n  const resolutionError = extractErrorDetails(resolved);\n\n  const reportMode = normalizeReportMode(\n",
    'capture resolution error',
  );

  code = replaceOrThrow(
    code,
    "  const campaignId = safeString(resolved.campaign_id);\n  const apiVersion = safeString(buildJob.destination_api_version || DEFAULT_API_VERSION) || DEFAULT_API_VERSION;\n  const metricsGroupKey = [adId, safeString(buildJob.destination_ad_account_id), adsetId].filter(Boolean).join(':') || adId;\n",
    "  const campaignId = safeString(resolved.campaign_id);\n  const apiVersion = safeString(buildJob.destination_api_version || DEFAULT_API_VERSION) || DEFAULT_API_VERSION;\n  const metricsGroupKey = [adId, safeString(buildJob.destination_ad_account_id), adsetId].filter(Boolean).join(':') || adId;\n  const scopeResolutionStatus = resolutionError ? 'error' : (campaignId ? 'resolved' : 'partial');\n  const reportWarnings = Array.isArray(buildJob.warnings) ? deepClone(buildJob.warnings) : [];\n  if (resolutionError?.message) {\n    reportWarnings.push('Resolve Scope IDs falhou: ' + resolutionError.message);\n  }\n  if (!campaignId) {\n    reportWarnings.push('campaign_id indisponível para o relatório de performance.');\n  }\n",
    'compute resolution status',
  );

  code = replaceOrThrow(
    code,
    "      level: scope.level,\n    };\n",
    "      level: scope.level,\n      scope_resolution_status: scopeResolutionStatus,\n      scope_resolution_error: resolutionError ? deepClone(resolutionError) : null,\n      report_warnings: deepClone(reportWarnings),\n    };\n",
    'add common payload reliability fields',
  );

  node.parameters.jsCode = code;
}

function patchNormalizeMetrics() {
  const node = getNode('Normalize Metrics');
  let code = node.parameters.jsCode;

  if (!code.includes('function extractErrorDetails(payload) {')) {
    code = replaceOrThrow(
      code,
      "function safeString(value) {\n  return String(value ?? '').trim();\n}\n",
      "function safeString(value) {\n  return String(value ?? '').trim();\n}\n\nfunction extractErrorDetails(payload) {\n  if (!payload || typeof payload !== 'object') return null;\n  const message = [\n    payload?.error?.message,\n    payload?.errorMessage,\n    payload?.message,\n    payload?.description,\n  ].map((value) => safeString(value)).find(Boolean);\n\n  if (!message) return null;\n\n  return {\n    message,\n    code: safeString(payload?.error?.code || payload?.statusCode || payload?.code),\n    type: safeString(payload?.error?.type || payload?.type),\n  };\n}\n\nfunction buildFallbackInsights(job, windowKey, errorDetails) {\n  return {\n    request_kind: safeString(job?.request_kind),\n    request_variant: safeString(job?.request_variant),\n    scope_type: safeString(job?.scope_type),\n    window: safeString(windowKey || job?.window),\n    requested_fields: Array.isArray(job?.request_fields) ? deepClone(job.request_fields) : [],\n    time_range: deepClone(job?.time_range || {}),\n    row_count: 0,\n    raw_fields_present: [],\n    scalar_metrics: {},\n    list_metrics: {},\n    fetch_status: 'error',\n    fetch_error: deepClone(errorDetails || null),\n  };\n}\n\nfunction buildFailedMetrics(job, windowKey, errorDetails) {\n  return {\n    ...DEFAULT_METRICS,\n    debug_actions: {\n      fetch_error: deepClone(errorDetails || null),\n      action_map: {},\n      engagement_components: {\n        reaction: 0,\n        reaction_source: null,\n        comment: 0,\n        post: 0,\n      },\n    },\n    all_possible_insights: buildFallbackInsights(job, windowKey, errorDetails),\n  };\n}\n\nfunction buildFailedBreakdown(job, windowKey, errorDetails) {\n  return {\n    key: safeString(job?.breakdown_key),\n    breakdowns: Array.isArray(job?.breakdowns) ? deepClone(job.breakdowns) : [],\n    row_count: 0,\n    group_count: 0,\n    rows: [],\n    fetch_status: 'error',\n    fetch_error: deepClone(errorDetails || null),\n    window: safeString(windowKey || job?.window),\n  };\n}\n",
      'insert normalize error helpers',
    );
  }

  code = replaceOrThrow(
    code,
    "for (const item of $input.all()) {\n  const pairedIndex = getPairedIndex(item.pairedItem);\n  const job = deepClone(metricJobItems[pairedIndex]?.json || {});\n  const rawRows = Array.isArray(item.json?.data) ? item.json.data : [];\n  const anchorDate = job?.requested_at ? new Date(job.requested_at) : new Date();\n\n  if (job.request_kind === 'core') {\n",
    "for (const item of $input.all()) {\n  const pairedIndex = getPairedIndex(item.pairedItem);\n  const job = deepClone(metricJobItems[pairedIndex]?.json || {});\n  const inputPayload = deepClone(item.json || {});\n  const rawRows = Array.isArray(inputPayload?.data) ? inputPayload.data : [];\n  const fetchError = extractErrorDetails(inputPayload);\n  const anchorDate = job?.requested_at ? new Date(job.requested_at) : new Date();\n  const fetchedAt = new Date().toISOString();\n\n  if (fetchError) {\n    if (job.request_kind === 'core') {\n      if (job.request_variant === 'hourly' || job.request_variant === 'summary') {\n        outputs.push({\n          json: {\n            ...job,\n            request_variant: job.request_variant,\n            window: 'last_24h',\n            metrics: buildFailedMetrics(job, 'last_24h', fetchError),\n            raw_row_count: 0,\n            windowed_row_count: 0,\n            fetched_at: fetchedAt,\n            fetch_status: 'error',\n            fetch_error: deepClone(fetchError),\n          },\n        });\n        continue;\n      }\n\n      if (job.request_variant === 'daily_rollup') {\n        for (const windowKey of Array.isArray(job.derived_windows) ? job.derived_windows : []) {\n          outputs.push({\n            json: {\n              ...job,\n              request_variant: 'summary',\n              window: windowKey,\n              metrics: buildFailedMetrics(job, windowKey, fetchError),\n              raw_row_count: 0,\n              windowed_row_count: 0,\n              fetched_at: fetchedAt,\n              derived_from: 'daily_rollup',\n              fetch_status: 'error',\n              fetch_error: deepClone(fetchError),\n            },\n          });\n        }\n        continue;\n      }\n    }\n\n    if (job.request_kind === 'breakdown') {\n      if (job.request_variant === 'breakdown_summary_24h') {\n        outputs.push({\n          json: {\n            ...job,\n            window: 'last_24h',\n            breakdown: buildFailedBreakdown(job, 'last_24h', fetchError),\n            raw_row_count: 0,\n            windowed_row_count: 0,\n            fetched_at: fetchedAt,\n            fetch_status: 'error',\n            fetch_error: deepClone(fetchError),\n          },\n        });\n        continue;\n      }\n\n      if (job.request_variant === 'breakdown_daily_rollup') {\n        for (const windowKey of Array.isArray(job.derived_windows) ? job.derived_windows : []) {\n          outputs.push({\n            json: {\n              ...job,\n              window: windowKey,\n              breakdown: buildFailedBreakdown(job, windowKey, fetchError),\n              raw_row_count: 0,\n              windowed_row_count: 0,\n              fetched_at: fetchedAt,\n              derived_from: 'daily_rollup',\n              fetch_status: 'error',\n              fetch_error: deepClone(fetchError),\n            },\n          });\n        }\n        continue;\n      }\n    }\n  }\n\n  if (job.request_kind === 'core') {\n",
    'insert fetch error branching',
  );

  code = code.replace(
    /fetched_at: new Date\(\)\.toISOString\(\),/g,
    "fetched_at: fetchedAt,\n            fetch_status: 'success',\n            fetch_error: null,",
  );

  node.parameters.jsCode = code;
}

function patchConsolidateMetrics() {
  const node = getNode('Consolidate Metrics');
  let code = node.parameters.jsCode;

  code = replaceOrThrow(
    code,
    "function decorateBreakdowns(breakdownParts) {\n  const output = {};\n\n  for (const [key, breakdown] of Object.entries(breakdownParts || {})) {\n    output[key] = {\n      key: breakdown?.key || key,\n      breakdowns: Array.isArray(breakdown?.breakdowns) ? deepClone(breakdown.breakdowns) : [],\n      row_count: breakdown?.row_count || 0,\n      group_count: breakdown?.group_count || 0,\n      rows: Array.isArray(breakdown?.rows)\n        ? breakdown.rows.map((row) => ({\n            dimensions: deepClone(row?.dimensions || {}),\n            row_count: row?.row_count || 0,\n            metrics: decorateMetrics(row?.metrics || {}),\n          }))\n        : [],\n    };\n  }\n\n  return output;\n}\n\nfunction finalizeWindow(parts) {\n  const summary = deepClone(parts?.summary || {});\n  const hourly = deepClone(parts?.hourly || {});\n\n  const merged = {\n    spend: hourly.spend != null ? safeNumber(hourly.spend) : safeNumber(summary.spend),\n    whatsapp_conversations_started: hourly.whatsapp_conversations_started != null\n      ? safeNumber(hourly.whatsapp_conversations_started)\n      : safeNumber(summary.whatsapp_conversations_started),\n    avg_cost_per_conversation: hourly.avg_cost_per_conversation != null\n      ? hourly.avg_cost_per_conversation\n      : (summary.avg_cost_per_conversation ?? null),\n    clicks: hourly.clicks != null ? safeNumber(hourly.clicks) : safeNumber(summary.clicks),\n    reach: safeNumber(summary.reach),\n    engagement_general: hourly.engagement_general != null\n      ? safeNumber(hourly.engagement_general)\n      : safeNumber(summary.engagement_general),\n    instagram_profile_visits: safeNumber(summary.instagram_profile_visits),\n    impressions: hourly.impressions != null ? safeNumber(hourly.impressions) : safeNumber(summary.impressions),\n  };\n\n  return {\n    ...withPretty(\n      merged,\n      {\n        summary: summary.debug_actions || null,\n        hourly: hourly.debug_actions || null,\n        merged_from: Object.keys(parts || {}),\n      },\n      mergeAllPossibleInsights(summary.all_possible_insights, hourly.all_possible_insights),\n    ),\n    breakdowns: decorateBreakdowns(parts?.breakdowns || {}),\n  };\n}\n",
    `function decorateBreakdowns(breakdownParts) {
  const output = {};

  for (const [key, breakdownPart] of Object.entries(breakdownParts || {})) {
    const breakdown = deepClone(breakdownPart?.breakdown || {});
    output[key] = {
      key: breakdown?.key || key,
      breakdowns: Array.isArray(breakdown?.breakdowns) ? deepClone(breakdown.breakdowns) : [],
      status: breakdownPart?.fetch_status || (breakdownPart?.breakdown ? 'success' : 'missing'),
      error: deepClone(breakdownPart?.fetch_error || null),
      row_count: breakdown?.row_count || 0,
      group_count: breakdown?.group_count || 0,
      rows: Array.isArray(breakdown?.rows)
        ? breakdown.rows.map((row) => ({
            dimensions: deepClone(row?.dimensions || {}),
            row_count: row?.row_count || 0,
            metrics: decorateMetrics(row?.metrics || {}),
          }))
        : [],
    };
  }

  return output;
}

function getPartStatus(part) {
  if (!part || !Object.keys(part).length) return 'missing';
  if (part.fetch_status) return part.fetch_status;
  if (part.metrics || part.breakdown) return 'success';
  return 'missing';
}

function collectPartError(label, part, status, errors) {
  if (status !== 'error') return;
  errors.push({
    source: label,
    message: part?.fetch_error?.message || 'Meta API request failed',
    code: part?.fetch_error?.code || null,
    type: part?.fetch_error?.type || null,
  });
}

function finalizeWindow(parts, windowKey) {
  const summaryPart = deepClone(parts?.summary || {});
  const hourlyPart = deepClone(parts?.hourly || {});
  const summary = deepClone(summaryPart?.metrics || {});
  const hourly = deepClone(hourlyPart?.metrics || {});

  const merged = {
    spend: hourly.spend != null ? safeNumber(hourly.spend) : safeNumber(summary.spend),
    whatsapp_conversations_started: hourly.whatsapp_conversations_started != null
      ? safeNumber(hourly.whatsapp_conversations_started)
      : safeNumber(summary.whatsapp_conversations_started),
    avg_cost_per_conversation: hourly.avg_cost_per_conversation != null
      ? hourly.avg_cost_per_conversation
      : (summary.avg_cost_per_conversation ?? null),
    clicks: hourly.clicks != null ? safeNumber(hourly.clicks) : safeNumber(summary.clicks),
    reach: safeNumber(summary.reach),
    engagement_general: hourly.engagement_general != null
      ? safeNumber(hourly.engagement_general)
      : safeNumber(summary.engagement_general),
    instagram_profile_visits: safeNumber(summary.instagram_profile_visits),
    impressions: hourly.impressions != null ? safeNumber(hourly.impressions) : safeNumber(summary.impressions),
  };

  const coverage = {
    summary: getPartStatus(summaryPart),
    hourly: windowKey === 'last_24h' ? getPartStatus(hourlyPart) : 'not_applicable',
    breakdowns: Object.fromEntries(
      Object.entries(parts?.breakdowns || {}).map(([key, value]) => [key, getPartStatus(value)])
    ),
  };

  const errors = [];
  collectPartError('summary', summaryPart, coverage.summary, errors);
  if (windowKey === 'last_24h') {
    collectPartError('hourly', hourlyPart, coverage.hourly, errors);
  }
  for (const [key, breakdownPart] of Object.entries(parts?.breakdowns || {})) {
    collectPartError('breakdown:' + key, breakdownPart, coverage.breakdowns[key], errors);
  }

  const expectedCoreStatuses = [coverage.summary];
  if (windowKey === 'last_24h') expectedCoreStatuses.push(coverage.hourly);

  const hasCoreSuccess = expectedCoreStatuses.includes('success');
  const hasCoreMissing = expectedCoreStatuses.includes('missing');
  const hasAnyError = expectedCoreStatuses.includes('error') || Object.values(coverage.breakdowns).includes('error');
  const status = !hasCoreSuccess && hasCoreMissing
    ? 'missing'
    : (hasAnyError || hasCoreMissing ? 'partial' : 'complete');

  return {
    status,
    partial_data: status !== 'complete',
    coverage,
    errors,
    ...withPretty(
      merged,
      {
        summary: summary.debug_actions || null,
        hourly: hourly.debug_actions || null,
        merged_from: Object.keys(parts || {}),
      },
      mergeAllPossibleInsights(summary.all_possible_insights, hourly.all_possible_insights),
    ),
    breakdowns: decorateBreakdowns(parts?.breakdowns || {}),
  };
}
`,
    'replace consolidate helpers',
  );

  code = replaceOrThrow(
    code,
    "  if (json.request_kind === 'breakdown') {\n    group.parts[json.scope_type][json.window].breakdowns[json.breakdown_key] = deepClone(json.breakdown || {});\n    continue;\n  }\n\n  group.parts[json.scope_type][json.window][json.request_variant] = deepClone(json.metrics || {});\n}\n",
    "  if (json.request_kind === 'breakdown') {\n    group.parts[json.scope_type][json.window].breakdowns[json.breakdown_key] = deepClone(json);\n    continue;\n  }\n\n  group.parts[json.scope_type][json.window][json.request_variant] = deepClone(json);\n}\n",
    'store full normalized payloads',
  );

  code = replaceOrThrow(
    code,
    "      metrics[scopeKey][windowKey] = finalizeWindow(group.parts?.[scopeKey]?.[windowKey] || {});\n",
    "      metrics[scopeKey][windowKey] = finalizeWindow(group.parts?.[scopeKey]?.[windowKey] || {}, windowKey);\n",
    'pass window key to finalizeWindow',
  );

  code = replaceOrThrow(
    code,
    "  const metrics = {};\n\n  for (const scopeKey of SCOPE_KEYS) {\n",
    "  const metrics = {};\n  const reportErrors = [];\n  const reportStatuses = [];\n\n  for (const scopeKey of SCOPE_KEYS) {\n",
    'init report status collection',
  );

  code = replaceOrThrow(
    code,
    "      metrics[scopeKey][windowKey] = finalizeWindow(group.parts?.[scopeKey]?.[windowKey] || {}, windowKey);\n    }\n  }\n\n  outputs.push({\n",
    "      metrics[scopeKey][windowKey] = finalizeWindow(group.parts?.[scopeKey]?.[windowKey] || {}, windowKey);\n      reportStatuses.push(metrics[scopeKey][windowKey].status);\n      for (const error of metrics[scopeKey][windowKey].errors || []) {\n        reportErrors.push({\n          scope_type: scopeKey,\n          window: windowKey,\n          ...deepClone(error),\n        });\n      }\n    }\n  }\n\n  const reportStatus = reportStatuses.every((status) => status === 'complete')\n    ? 'complete'\n    : (reportStatuses.some((status) => status === 'complete' || status === 'partial') ? 'partial' : 'missing');\n\n  outputs.push({\n",
    'collect report-level status',
  );

  code = replaceOrThrow(
    code,
    "      report_mode: base.report_mode || 'full',\n",
    "      report_mode: base.report_mode || 'full',\n      report_status: reportStatus,\n      partial_report: reportStatus !== 'complete',\n      report_errors: reportErrors,\n      report_warnings: Array.isArray(base.report_warnings) ? deepClone(base.report_warnings) : [],\n      scope_resolution_status: base.scope_resolution_status || '',\n      scope_resolution_error: deepClone(base.scope_resolution_error || null),\n",
    'add report health fields',
  );

  node.parameters.jsCode = code;
}

patchNodeReliability('Resolve Scope IDs');
patchNodeReliability('Fetch Insights');
patchBuildMetricsJobs();
patchNormalizeMetrics();
patchConsolidateMetrics();

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
