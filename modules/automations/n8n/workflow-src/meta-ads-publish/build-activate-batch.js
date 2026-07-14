function text(value) { return String(value ?? '').trim(); }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }

const response = $input.first()?.json || {};
if (response.ok !== true || response.operation?.status !== 'completed' || response.operation?.result?.status !== 'staged') {
  throw new Error(`Stage Ad Batch nao concluiu com seguranca: ${JSON.stringify(response.detail || response.error || response)}`);
}
const stageRequest = $items('Build Stage Batch')[0]?.json || {};
const runId = text(stageRequest.run_id);
const stageOperationKey = text(response.operation.operation_key || stageRequest.stage_operation_key);
if (!runId || !stageOperationKey) throw new Error('Build Activate Batch sem run_id ou stage_operation_key.');

return [{
  json: {
    run_id: runId,
    stage_operation_key: stageOperationKey,
    gateway_request: {
      action: 'activate_batch',
      operation_key: key(`activate:${runId}`),
      stage_operation_key: stageOperationKey,
    },
  },
}];
