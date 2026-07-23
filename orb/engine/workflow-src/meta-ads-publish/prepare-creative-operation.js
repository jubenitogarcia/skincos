function text(value) { return String(value ?? '').trim(); }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${stable(value[name])}`).join(',')}}`;
  return JSON.stringify(value);
}
function stableHash(value) {
  let hash = 2166136261;
  for (const char of text(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

return $input.all().map((item) => {
  const job = item.json || {};
  if (!text(job.run_id) || !text(job.token_id) || !job.creativePayload) {
    throw new Error(`Prepare Creative Operation recebeu job incompleto: ${job.job_key || 'sem-chave'}.`);
  }
  const payloadHash = stableHash(stable(job.creativePayload));
  return {
    json: {
      ...job,
      gateway_request: {
        action: 'create_creative',
        operation_key: key(`creative:v2:${payloadHash}:${job.run_id}:${job.destination_group}:${job.media_variant || 'static_flexible'}`),
        token_id: text(job.token_id),
        account_id: text(job.account_id),
        api_version: text(job.api_version || 'v25.0'),
        payload: job.creativePayload,
      },
    },
    binary: item.binary,
  };
});
