function text(value) { return String(value ?? '').trim(); }

const gateway = $input.first()?.json || {};
if (gateway.ok !== true || !gateway.run || !text(gateway.run.id)) {
  throw new Error(`Acquire Publish Run falhou: ${JSON.stringify(gateway.error || gateway)}`);
}
const run = gateway.run;
if (run.status === 'reconciliation_required') {
  throw new Error(`Run ${run.id} exige reconciliacao manual antes de continuar.`);
}
if (run.status === 'completed' || run.status === 'rolled_back') {
  throw new Error(`Run ${run.id} ja terminou com status ${run.status}; novos arquivos ou nova revisao sao necessarios.`);
}
if (run.status === 'meta_completed_drive_pending') {
  return [{ json: { resume_drive_only: true, run_id: run.id, run } }];
}

const groups = $items('Build Payload') || [];
return groups.map((item) => ({
  json: {
    ...(item.json || {}),
    run_id: run.id,
    batch_fingerprint: text(run.batch_fingerprint),
    config_revision: text(run.config_revision),
    resume_drive_only: false,
  },
  binary: item.binary,
}));

