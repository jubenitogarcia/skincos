function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }

const gateway = $input.first()?.json || {};
if (gateway.ok !== true || !gateway.run || !text(gateway.run.id)) {
  throw new Error(`Acquire Publish Run falhou: ${JSON.stringify(gateway.error || gateway)}`);
}
const run = gateway.run;
const resumeJobs = Array.isArray(run.summary?.resume_jobs) ? run.summary.resume_jobs : [];
if (run.status === 'reconciliation_required') {
  throw new Error(`Run ${run.id} exige reconciliacao manual antes de continuar.`);
}
if (run.status === 'completed' || run.status === 'rolled_back' || run.status === 'calibration_paused') {
  throw new Error(`Run ${run.id} ja terminou com status ${run.status}; novos arquivos ou nova revisao sao necessarios.`);
}
if (run.status === 'meta_completed_drive_pending') {
  const completedJobs = list(run.summary?.jobs);
  const commercialResume = text(run.summary?.publication_mode) === 'commercial' &&
    completedJobs.length > 0 && completedJobs.every((job) =>
      text(job.publication_mode) === 'commercial' &&
      text(job.desired_status).toUpperCase() === 'ACTIVE' &&
      !text(job.calibration_marker)
    );
  if (!commercialResume) {
    throw new Error(`Run ${run.id} pendente no Drive sem contrato comercial explicito; exige reconciliacao manual.`);
  }
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
    // Preserve the exact, already-validated mutation bodies on a retry. The
    // copy agent is intentionally generative, so rebuilding it would change
    // the request hash while this run must remain idempotent.
    resume_jobs: resumeJobs,
  },
  binary: item.binary,
}));
