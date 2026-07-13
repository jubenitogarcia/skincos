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

const preparedItems = $('Prepare Worker Persistence').all();

const outputs = $input.all().map((item) => {
  const pairedIndex = getPairedIndex(item.pairedItem);
  const prepared = deepClone(preparedItems[pairedIndex]?.json || {});
  const responseJson = item.json || {};
  const statusCode = safeNumber(responseJson.statusCode || responseJson.status || responseJson.code);
  const body = deepClone(responseJson.body || responseJson.data || responseJson);
  const ok = body?.ok === true && statusCode >= 200 && statusCode < 300;

  if (!ok) {
    throw new Error(JSON.stringify({
      type: 'worker_persistence_error',
      metrics_group_key: safeString(prepared.metrics_group_key),
      run_id: safeString(prepared.run_context?.run_id),
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
      worker_persistence: {
        ok: true,
        status_code: statusCode,
        request_url: safeString(prepared.persistence_target_url),
        idempotency_key: safeString(prepared.idempotency_key),
        results: deepClone(body.results || {}),
        warnings_count: safeNumber(body.results?.warnings_count || body.warnings_count),
        duplication_count: safeNumber(body.results?.duplication_count || body.duplication_count),
      },
    },
  };
});

return outputs;
