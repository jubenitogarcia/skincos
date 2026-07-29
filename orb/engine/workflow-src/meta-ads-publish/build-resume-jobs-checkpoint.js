function text(value) { return String(value ?? '').trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

const jobs = $input.all().map((item) => clone(item.json || {}));
if (!jobs.length) throw new Error('Build Resume Jobs Checkpoint recebeu zero jobs validados.');

const runIds = [...new Set(jobs.map((job) => text(job.run_id)).filter(Boolean))];
if (runIds.length !== 1) throw new Error(`Build Resume Jobs Checkpoint recebeu run_ids inconsistentes: ${JSON.stringify(runIds)}`);

return [{
  json: {
    run_id: runIds[0],
    checkpoint_request: {
      status: 'processing',
      // Store the exact validated mutation bodies before the first Graph write.
      // A retry must never ask the generative copy agent to recreate them.
      summary: { resume_jobs: jobs },
      error: {},
    },
  },
}];
