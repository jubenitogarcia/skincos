function text(value) { return String(value ?? '').trim(); }

const checkpoint = $input.first()?.json || {};
if (checkpoint.ok !== true || !checkpoint.run || text(checkpoint.run.id) !== text($items('Build Resume Jobs Checkpoint')[0]?.json?.run_id)) {
  throw new Error(`Persist Resume Jobs falhou: ${JSON.stringify(checkpoint.error || checkpoint)}`);
}

const jobs = $items('Validate Meta Creative Payload') || [];
if (!jobs.length) throw new Error('Restore Persisted Resume Jobs nao encontrou jobs validados.');

return jobs.map((item) => ({
  json: item.json || {},
  binary: item.binary,
}));
