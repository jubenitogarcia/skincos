function text(value) { return String(value ?? '').trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }

const inputs = $input.all();
if (!inputs.length) throw new Error('Build Stage Batch recebeu zero creatives verificados.');
const runIds = [...new Set(inputs.map((item) => text(item.json && item.json.run_id)).filter(Boolean))];
if (runIds.length !== 1) throw new Error(`Build Stage Batch recebeu run_ids inconsistentes: ${JSON.stringify(runIds)}`);
const runId = runIds[0];
const targets = new Set();

const jobs = inputs.map((item, index) => {
  const job = item.json || {};
  const creativeId = text(job.creative_id);
  if (!creativeId) throw new Error(`Creative ID ausente no job ${job.job_key || index}.`);
  const action = text(job.action);
  if (!['create_new', 'replace_existing'].includes(action)) throw new Error(`Acao invalida no job ${job.job_key || index}.`);
  const target = action === 'replace_existing'
    ? `ad:${text(job.source_ad_id)}`
    : `adset:${text(job.destination_adset_id)}:name:${key(object(job.adPayload).name)}`;
  if (targets.has(target)) throw new Error(`Target Meta duplicado no mesmo lote: ${target}`);
  targets.add(target);
  const adPayload = {
    ...object(job.adPayload),
    status: 'PAUSED',
    creative: { creative_id: creativeId },
  };
  return {
    operation_key: key(`ad:${runId}:${job.creative_group_key}:${job.destination_group}`),
    action,
    target_ad_id: action === 'replace_existing' ? text(job.source_ad_id) : undefined,
    token_id: text(job.token_id),
    account_id: text(job.account_id),
    api_version: text(job.api_version || 'v25.0'),
    destination_group: text(job.destination_group),
    creative_group_key: text(job.creative_group_key || job.group_key),
    creative_id: creativeId,
    ad_payload: adPayload,
    files: Object.entries(object(job.asset_ids)).map(([ratio, id]) => ({
      id: text(id),
      ratio: text(ratio),
      name: text(object(job.asset_names)[ratio]),
    })).filter((file) => file.id),
  };
});

return [{
  json: {
    run_id: runId,
    stage_operation_key: key(`stage:${runId}`),
    gateway_request: {
      action: 'stage_batch',
      operation_key: key(`stage:${runId}`),
      jobs,
    },
    job_count: jobs.length,
  },
}];

