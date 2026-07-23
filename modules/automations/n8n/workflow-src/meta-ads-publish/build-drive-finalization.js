function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function unique(values) { return [...new Set(list(values).map(text).filter(Boolean))]; }

const input = $input.first()?.json || {};
let runId = text(input.run_id);
let jobs = [];
if (input.resume_drive_only === true) {
  runId = text(input.run_id || input.run?.id);
  jobs = list(input.run?.summary?.jobs);
} else {
  if (input.ok !== true || input.operation?.status !== 'completed') {
    throw new Error(`Activate Ad Batch falhou: ${JSON.stringify(input.detail || input.error || input)}`);
  }
  const result = input.operation.result || {};
  if (result.status !== 'meta_completed_drive_pending') {
    throw new Error(`Activate Ad Batch retornou estado inesperado: ${JSON.stringify(result)}`);
  }
  runId = text(($items('Build Activate Batch')[0]?.json || {}).run_id);
  jobs = list(result.jobs);
}
if (!runId || !jobs.length) throw new Error('Build Drive Finalization sem run_id ou jobs persistidos.');

const byFile = new Map();
for (const job of jobs) {
  for (const file of list(job.files)) {
    const id = text(file.id);
    if (!id) continue;
    if (!byFile.has(id)) byFile.set(id, { id, name: text(file.name), ratio: text(file.ratio), units: [], ad_ids: [], creative_ids: [], groups: [] });
    const row = byFile.get(id);
    row.units.push(job.destination_group);
    row.ad_ids.push(job.ad_id);
    row.creative_ids.push(job.creative_id);
    row.groups.push(job.creative_group_key);
  }
}
if (!byFile.size) throw new Error('Build Drive Finalization nao recuperou os arquivos do journal.');

const publishedAt = new Date().toISOString();
const summaries = jobs.map((job) => ({
  creative_group_key: text(job.creative_group_key),
  destination_group: text(job.destination_group),
  action: text(job.action),
  ad_id: text(job.ad_id),
  creative_id: text(job.creative_id),
  created_new: job.created_new === true,
}));
const lines = [
  'Meta Ads Publish concluido',
  `Run: ${runId}`,
  `Jobs Meta: ${summaries.length}`,
  `Artes: ${byFile.size}`,
  '',
  ...summaries.map((job) => `- ${job.creative_group_key} | ${job.destination_group} | ${job.action} | ad ${job.ad_id}`),
];
const message = lines.join('\n');

return [...byFile.values()].map((file) => ({
  json: {
    id: file.id,
    fileName: file.name,
    ratio: file.ratio,
    run_id: runId,
    published: true,
    meta_ads_published_at: publishedAt,
    meta_ads_execution_id: String($execution.id),
    meta_ads_run_id: runId,
    meta_ads_creative_group_key: unique(file.groups).join(', '),
    meta_ads_units: unique(file.units).join(', '),
    meta_ads_ad_ids: unique(file.ad_ids).join(', '),
    meta_ads_creative_ids: unique(file.creative_ids).join(', '),
    meta_publish_summary: summaries,
    whatsapp_message: message,
    telegram_message: message,
  },
}));

