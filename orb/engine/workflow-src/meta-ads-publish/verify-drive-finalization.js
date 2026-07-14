function text(value) { return String(value ?? '').trim(); }
function pairedIndex(item, fallback) {
  const paired = item && item.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  if (paired && typeof paired === 'object') return Number(paired.item ?? fallback);
  return Number(fallback);
}

const prepared = $items('Prepare Drive Read') || [];
const verified = [];
for (const [index, item] of $input.all().entries()) {
  const sourceIndex = pairedIndex(item, index);
  const expected = (prepared[sourceIndex] || {}).json || {};
  const actual = item.json || {};
  const properties = actual.properties || {};
  const checks = {
    published: text(properties.published) === 'true',
    run_id: text(properties.meta_ads_run_id) === text(expected.run_id),
    groups: text(properties.meta_ads_creative_group_key) === text(expected.meta_ads_creative_group_key),
  };
  if (!checks.published || !checks.run_id || !checks.groups) {
    throw new Error(`Drive readback falhou para ${expected.id}: ${JSON.stringify(checks)}`);
  }
  verified.push(expected);
}
if (verified.length !== prepared.length) throw new Error(`Drive readback incompleto: ${verified.length}/${prepared.length}.`);

const first = verified[0];
return [{
  json: {
    run_id: text(first.run_id),
    verified_file_count: verified.length,
    files: verified.map((item) => ({ id: text(item.id), name: text(item.fileName) })),
    meta_publish_summary: first.meta_publish_summary,
    whatsapp_message: text(first.whatsapp_message),
    telegram_message: text(first.telegram_message),
    completion_request: {
      status: 'completed',
      summary: {
        verified_file_count: verified.length,
        jobs: first.meta_publish_summary,
      },
    },
  },
}];
