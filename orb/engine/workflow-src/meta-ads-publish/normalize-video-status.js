function pairedIndex(item, fallback) { const p = item?.pairedItem; return Number((Array.isArray(p) ? p[0]?.item : p?.item) ?? fallback); }
const prepared = $items('Prepare Video Status') || [];
return $input.all().map((item, index) => {
  const state = prepared[pairedIndex(item, index)]?.json || {};
  const response = item.json || {};
  if (response.ok !== true || response.operation?.status !== 'completed') throw new Error(`Consulta de status de video falhou: ${JSON.stringify(response.detail || response.error || response)}`);
  const result = response.operation.result || {};
  const status = String(result.video_status || '').toLowerCase();
  if (['error', 'failed', 'expired'].includes(status)) throw new Error(`Processamento Meta do video falhou: ${status}.`);
  return { json: {
    ...state,
    video_id: String(result.id || state.video_id),
    video_status: status,
    ready: result.ready === true || status === 'ready',
    thumbnails: result.thumbnails || {},
    status_operation_key: response.operation.operation_key,
    upload_kind: 'video',
    role: 'vertical_video',
    ratio: '9x16',
    replayed: response.replayed === true,
  } };
});
