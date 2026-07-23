function pairedIndex(item, fallback) {
  const paired = item && item.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  if (paired && typeof paired === 'object') return Number(paired.item ?? fallback);
  return Number(fallback);
}
function text(value) { return String(value ?? '').trim(); }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }

const prepared = $items('Prepare Creative Operation') || [];
return $input.all().map((item, index) => {
  const sourceIndex = pairedIndex(item, index);
  const source = (prepared[sourceIndex] || {}).json || {};
  const response = item.json || {};
  const result = response.operation?.result || {};
  const creativeId = text(result.id);
  if (response.ok !== true || response.operation?.status !== 'completed' || !creativeId) {
    throw new Error(`Create AdCreative gateway falhou em ${source.job_key || sourceIndex}: ${JSON.stringify(response.detail || response.error || response)}`);
  }
  return {
    json: {
      ...source,
      creative_id: creativeId,
      create_creative_operation_key: text(response.operation.operation_key),
      create_creative_replayed: response.replayed === true,
      gateway_request: {
        action: 'get_creative',
        operation_key: key(`verify:${source.run_id}:${creativeId}`),
        token_id: text(source.token_id),
        account_id: text(source.account_id),
        api_version: text(source.api_version || 'v25.0'),
        object_id: creativeId,
      },
    },
    binary: (prepared[sourceIndex] || {}).binary || item.binary,
    pairedItem: { item: sourceIndex },
  };
});

