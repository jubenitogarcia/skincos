function pairedIndex(item, fallback) { const p = item?.pairedItem; return Number((Array.isArray(p) ? p[0]?.item : p?.item) ?? fallback); }
const prepared = $items('Prepare Video Finish') || [];
return $input.all().map((item, index) => {
  const state = prepared[pairedIndex(item, index)]?.json || {};
  const response = item.json || {};
  if (response.ok !== true || response.operation?.status !== 'completed' || response.operation?.result?.success !== true) throw new Error(`Finish de video nao confirmado: ${JSON.stringify(response)}`);
  return { json: { ...state, finish_operation_key: response.operation.operation_key, status_attempt: 0 } };
});
