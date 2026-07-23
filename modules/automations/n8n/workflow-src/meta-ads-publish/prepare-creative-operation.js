function text(value) { return String(value ?? '').trim(); }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }

return $input.all().map((item) => {
  const job = item.json || {};
  if (!text(job.run_id) || !text(job.token_id) || !job.creativePayload) {
    throw new Error(`Prepare Creative Operation recebeu job incompleto: ${job.job_key || 'sem-chave'}.`);
  }
  return {
    json: {
      ...job,
      gateway_request: {
        action: 'create_creative',
        operation_key: key(`creative:${job.run_id}:${job.creative_group_key}:${job.destination_group}`),
        token_id: text(job.token_id),
        account_id: text(job.account_id),
        api_version: text(job.api_version || 'v25.0'),
        payload: job.creativePayload,
      },
    },
    binary: item.binary,
  };
});

