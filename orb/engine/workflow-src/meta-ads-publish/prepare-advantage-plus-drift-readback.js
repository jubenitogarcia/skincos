function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function unique(values) { return [...new Set(list(values).map(text).filter(Boolean))]; }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }

function baselineFor(source) {
  const verification = object(source.advantage_plus_verification);
  const requested = unique(verification.requested_features || source.advantage_plus_requested_features);
  const optIn = unique(verification.reported_opt_in || verification.graph_acknowledged_features);
  const reportedNonOptIn = unique(verification.removed_or_ineligible || verification.removed_features);
  const notReported = unique(verification.not_reported);
  const available = verification.graph_acknowledgement_is_not_ui_confirmation === true
    && Boolean(verification.checked_at)
    && requested.length > 0;
  return {
    available,
    status: text(verification.status || 'unavailable'),
    checked_at: text(verification.checked_at),
    requested_features: requested,
    reported_opt_in: optIn,
    reported_non_opt_in: reportedNonOptIn,
    not_reported: notReported,
    graph_request_method: 'GET',
    graph_acknowledgement_is_not_ui_confirmation: true,
  };
}

const activation = object($input.first()?.json);
if (activation.ok !== true || activation.operation?.status !== 'completed' || activation.operation?.result?.status !== 'meta_completed_drive_pending') {
  throw new Error(`Prepare Advantage+ Drift Readback recebeu ativacao invalida: ${JSON.stringify(activation.detail || activation.error || activation)}`);
}

const runId = text(($items('Build Activate Batch')[0]?.json || {}).run_id || activation.run_id);
const jobs = list(activation.operation?.result?.jobs);
const initialReadbacks = $items('Attach Advantage+ Verification') || [];
const byCreativeId = new Map(initialReadbacks.map((item) => [text(item?.json?.creative_id), object(item?.json)]).filter(([creativeId]) => creativeId));
if (!runId || !jobs.length) throw new Error('Prepare Advantage+ Drift Readback sem run_id ou jobs ativados.');

return jobs.map((job, index) => {
  const creativeId = text(job.creative_id);
  const source = object(byCreativeId.get(creativeId));
  if (!creativeId || !text(source.token_id) || !text(source.account_id)) {
    throw new Error(`Prepare Advantage+ Drift Readback sem contexto seguro para creative ${creativeId || index}.`);
  }
  return {
    json: {
      run_id: runId,
      creative_id: creativeId,
      destination_group: text(job.destination_group || source.destination_group),
      creative_group_key: text(job.creative_group_key || source.creative_group_key),
      baseline: baselineFor(source),
      gateway_request: {
        action: 'get_creative',
        operation_key: key(`verify-post-activation:${runId}:${creativeId}`),
        token_id: text(source.token_id),
        account_id: text(source.account_id),
        api_version: text(source.api_version || 'v25.0'),
        object_id: creativeId,
      },
    },
    pairedItem: { item: index },
  };
});
