function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getPairedIndex(pairedItem) {
  if (typeof pairedItem === 'number') return pairedItem;
  if (pairedItem && typeof pairedItem.item === 'number') return pairedItem.item;
  if (Array.isArray(pairedItem) && typeof pairedItem[0]?.item === 'number') return pairedItem[0].item;
  return null;
}

function safeAll(nodeName) {
  try {
    return $(nodeName).all();
  } catch {
    return [];
  }
}

function isMissingReportHistoryEndpoint(statusCode, body, prepared) {
  return (
    statusCode === 404 &&
    safeString(body?.error) === 'not_found' &&
    safeString(prepared.persistence_target_url).includes('/ingest/meta-ads-report-history')
  );
}

const preparedItems = safeAll('Prepare Report History Persistence').length
  ? safeAll('Prepare Report History Persistence')
  : safeAll('Prepare Delivery History Persistence');

return $input.all().map((item) => {
  const pairedIndex = getPairedIndex(item.pairedItem);
  const prepared = deepClone(preparedItems[pairedIndex]?.json || {});
  const responseJson = item.json || {};
  const statusCode = safeNumber(responseJson.statusCode || responseJson.status || responseJson.code);
  const body = deepClone(responseJson.body || responseJson.data || responseJson);
  const ok = body?.ok === true && statusCode >= 200 && statusCode < 300;
  const endpointUnavailable = isMissingReportHistoryEndpoint(statusCode, body, prepared);

  if (!ok && !endpointUnavailable) {
    throw new Error(JSON.stringify({
      type: 'report_history_persistence_error',
      account_id: safeString(prepared.account_id),
      report_date: safeString(prepared.report_date),
      request_url: safeString(prepared.persistence_target_url),
      status_code: statusCode,
      worker_error: safeString(body?.error),
      worker_message: safeString(body?.message),
      body,
    }));
  }

  return {
    json: {
      ...prepared,
      report_history_persistence: {
        ok,
        status_code: statusCode,
        request_url: safeString(prepared.persistence_target_url),
        idempotency_key: safeString(prepared.persistence_idempotency_key || prepared.idempotency_key),
        idempotent_replay: ok && body?.idempotentReplay === true,
        in_progress: ok && body?.inProgress === true,
        endpoint_unavailable: endpointUnavailable,
        request_id: safeString(body?.requestId),
        worker_error: safeString(body?.error),
        worker_message: safeString(body?.message),
        results: deepClone(body.results || {}),
      },
      persistence_status: endpointUnavailable
        ? 'report_history_endpoint_unavailable'
        : 'persisted_to_metrics_worker_fallback',
    },
  };
});
