function pairedIndex(item, fallback) {
  const paired = item?.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  return Number(paired?.item ?? fallback);
}
const prepared = $items('Prepare Video Chunk Transfer') || [];
return $input.all().map((item, index) => {
  const sourceIndex = pairedIndex(item, index);
  const state = prepared[sourceIndex]?.json || {};
  const response = item.json || {};
  if (response.ok !== true || response.operation?.status !== 'completed') throw new Error(`Transferencia de video falhou: ${JSON.stringify(response.detail || response.error || response)}`);
  const result = response.operation.result || {};
  const start = Number(result.start_offset);
  const end = Number(result.end_offset);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < Number(state.start_offset) || end < start) throw new Error('Meta retornou offsets de video invalidos.');
  return { json: {
    ...state,
    start_offset: start,
    end_offset: end,
    transfer_count: Number(state.transfer_count || 0) + 1,
    last_transfer_operation_key: response.operation.operation_key,
    upload_bytes_complete: start === end,
  } };
});
