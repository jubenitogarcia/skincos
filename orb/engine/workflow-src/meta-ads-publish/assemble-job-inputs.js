function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function parseJsonObject(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function unwrapAi(value) {
  const json = object(value);
  if (json.output && typeof json.output === 'object') return clone(json.output);
  const parsedOutput = parseJsonObject(json.output);
  if (parsedOutput) return parsedOutput.output && typeof parsedOutput.output === 'object' && Object.keys(parsedOutput).length === 1
    ? clone(parsedOutput.output)
    : clone(parsedOutput);
  return clone(json);
}

const jobs = ($items('Build Payload') || [])
  .map((item) => item.json || {})
  .filter((job) => text(job.job_key) && !text(job.error));
if (!jobs.length) throw new Error('Assemble Job Inputs sem jobs validos do Build Payload.');

const jobsByKey = new Map(jobs.map((job) => [text(job.job_key), job]));
const jobsByGroup = new Map(jobs.map((job) => [text(job.group_key), text(job.job_key)]));
const envelopesByJob = new Map();
const aiCandidates = [];

for (const item of $input.all()) {
  const json = item.json || {};
  if (text(json.media_upload_envelope_version) === '2') {
    const jobKey = text(json.job_key);
    if (!jobsByKey.has(jobKey)) throw new Error(`Envelope de midia nao correlacionado; job_key=${jobKey || 'vazio'}.`);
    if (envelopesByJob.has(jobKey)) throw new Error(`Envelope de midia duplicado para ${jobKey}.`);
    envelopesByJob.set(jobKey, clone(json));
    continue;
  }
  const ai = unwrapAi(json);
  if (Object.keys(object(ai.creative_override)).length) aiCandidates.push({ raw: json, ai });
}

const aiByJob = new Map();
const unmapped = [];
for (const candidate of aiCandidates) {
  const directKey = text(candidate.ai.job_key || candidate.raw.job_key);
  const groupKey = text(candidate.ai.group_key || candidate.raw.group_key);
  const resolved = jobsByKey.has(directKey)
    ? directKey
    : jobsByGroup.get(groupKey) || (jobs.length === 1 && aiCandidates.length === 1 ? text(jobs[0].job_key) : '');
  if (!resolved) {
    unmapped.push({ has_job_key: Boolean(directKey), has_group_key: Boolean(groupKey) });
    continue;
  }
  if (aiByJob.has(resolved)) throw new Error(`Respostas Livia conflitantes para ${resolved}.`);
  const job = jobsByKey.get(resolved);
  if (groupKey && groupKey !== text(job.group_key)) throw new Error(`group_key da Livia diverge em ${resolved}.`);
  aiByJob.set(resolved, clone(candidate.ai));
}

if (unmapped.length) throw new Error(`Resposta Livia nao correlacionada; count=${unmapped.length}.`);

return jobs.map((job) => {
  const jobKey = text(job.job_key);
  const envelope = envelopesByJob.get(jobKey);
  const ai = aiByJob.get(jobKey);
  if (!envelope) throw new Error(`Envelope de midia ausente para ${jobKey}.`);
  if (!ai) throw new Error(`Resposta Livia ausente para ${jobKey}.`);
  if (text(envelope.group_key) !== text(job.group_key)) throw new Error(`group_key do envelope diverge em ${jobKey}.`);
  if (envelope.ready !== true) throw new Error(`Envelope de midia nao ready para ${jobKey}.`);
  return {
    json: {
      job_input_assembly_version: '2',
      job_key: jobKey,
      group_key: text(job.group_key),
      media_mode: text(job.media_mode),
      media_upload_envelope: envelope,
      ai_output: ai,
      assembly_diagnostics: {
        media_ready: true,
        image_upload_count: list(envelope.image_uploads).length,
        video_upload_count: list(envelope.video_uploads).length,
        ai_correlated: true,
      },
    },
  };
});
