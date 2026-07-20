return $input.all().map((item) => {
  const plan = item.json?.media_upload_plan || {};
  if (Number(plan.expected?.images || 0) !== 0) {
    throw new Error(`Emit No Image Upload recebeu plano com uploads esperados; job_key=${plan.job_key || ''}.`);
  }
  return {
    json: {
      job_key: String(plan.job_key || item.json?.job_key || ''),
      group_key: String(plan.group_key || item.json?.group_key || ''),
      media_mode: String(plan.media_mode || item.json?.media_mode || ''),
      upload_result_kind: 'image_skipped',
      skipped: true,
      reason: 'no_media_of_type',
    },
  };
});
