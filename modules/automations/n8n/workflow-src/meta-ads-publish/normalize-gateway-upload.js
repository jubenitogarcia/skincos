function pairedIndex(item, fallback) {
  const paired = item && item.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  if (paired && typeof paired === 'object') return Number(paired.item ?? fallback);
  return Number(fallback);
}

const prepared = $items('Prepare Gateway Uploads') || [];
return $input.all().map((item, index) => {
  const sourceIndex = pairedIndex(item, index);
  const source = (prepared[sourceIndex] || {}).json || {};
  const response = item.json || {};
  if (response.ok !== true || response.operation?.status !== 'completed') {
    throw new Error(`Upload gateway falhou para ${source.source_file_name || source.source_file_id}: ${JSON.stringify(response.detail || response.error || response)}`);
  }
  const result = response.operation.result || {};
  if (!result.images || typeof result.images !== 'object') {
    throw new Error(`Upload gateway sem images para ${source.source_file_name || source.source_file_id}.`);
  }
  return {
    json: {
      ...result,
      _gateway_account_id: source._gateway_account_id,
      account_id: source.account_id,
      source_file_id: source.source_file_id,
      source_file_name: source.source_file_name,
      ratio: source.ratio,
      operation_key: response.operation.operation_key,
      replayed: response.replayed === true,
    },
    pairedItem: { item: sourceIndex },
  };
});

