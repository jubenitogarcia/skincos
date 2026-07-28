function text(value) { return String(value ?? '').trim(); }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }

return $input.all().map((item, index) => {
  const merged = item.json || {};
  const response = {
    ok: merged.ok,
    replayed: merged.replayed,
    operation: merged.operation,
    requestId: merged.requestId,
    detail: merged.detail,
    error: merged.error,
  };
  const source = { ...merged };
  for (const field of ['ok', 'replayed', 'operation', 'requestId', 'detail', 'error']) delete source[field];
  const result = response.operation?.result || {};
  const creativeId = text(result.id);
  if (response.ok !== true || response.operation?.status !== 'completed' || !creativeId) {
    throw new Error(`Create AdCreative gateway falhou em ${source.job_key || index}: ${JSON.stringify(response.detail || response.error || response)}`);
  }
  return {
    json: {
      ...source,
      creative_id: creativeId,
      create_creative_operation_key: text(response.operation.operation_key),
      create_creative_replayed: response.replayed === true,
      creative_fallback_attempts: Array.isArray(source.creative_fallback_attempts) ? source.creative_fallback_attempts : [],
      gateway_request: {
        action: 'get_creative',
        operation_key: key(`verify:${source.run_id}:${creativeId}`),
        token_id: text(source.token_id),
        account_id: text(source.account_id),
        api_version: text(source.api_version || 'v25.0'),
        object_id: creativeId,
      },
    },
    binary: item.binary,
    pairedItem: { item: index },
  };
});
