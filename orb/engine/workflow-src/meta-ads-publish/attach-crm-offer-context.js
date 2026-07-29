function text(value) { return String(value ?? '').trim(); }
function pairedIndex(item, fallback) {
  const paired = item?.pairedItem;
  return Number((Array.isArray(paired) ? paired[0]?.item : paired?.item) ?? fallback);
}

const requests = $items('Prepare CRM Offer Context Requests') || [];
const buckets = new Map();
for (const [index, item] of $input.all().entries()) {
  const request = requests[pairedIndex(item, index)];
  if (!request?.json) throw new Error(`CRM Offer Context sem request correlacionado; index=${index}.`);
  const meta = request.json;
  const jobKey = text(meta.job_key);
  const groupKey = text(meta.group_key);
  const crmUnit = text(meta.crm_unit);
  const sourceJob = meta.crm_source_job;
  if (!jobKey || !groupKey || !crmUnit || !sourceJob) throw new Error('CRM Offer Context retornou contexto incompleto.');
  const bucket = buckets.get(jobKey) || { job: sourceJob, group_key: groupKey, contexts: {}, binary: request.binary || {} };
  if (bucket.group_key !== groupKey || bucket.contexts[crmUnit]) throw new Error(`CRM Offer Context duplicado ou divergente em ${jobKey}.`);
  bucket.contexts[crmUnit] = item.json || {};
  buckets.set(jobKey, bucket);
}

return [...buckets.entries()].map(([jobKey, bucket]) => {
  const expected = Array.isArray(bucket.job.destinations) ? bucket.job.destinations.length : 0;
  if (!expected || Object.keys(bucket.contexts).length !== expected) {
    throw new Error(`Cobertura CRM incompleta em ${jobKey}; expected=${expected} completed=${Object.keys(bucket.contexts).length}.`);
  }
  return {
    json: {
      ...bucket.job,
      crm_offer_context_version: '1',
      crm_offer_contexts: bucket.contexts,
    },
    binary: bucket.binary,
  };
});
