function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

const plans = $items('Prepare Media Upload Plan') || [];
const planByJob = new Map();
for (const item of plans) {
  const plan = item.json?.media_upload_plan || {};
  const jobKey = text(plan.job_key || item.json?.job_key);
  if (!jobKey) throw new Error('Aggregate Media Upload Results encontrou plano sem job_key.');
  if (planByJob.has(jobKey)) throw new Error(`Plano de upload duplicado para ${jobKey}.`);
  planByJob.set(jobKey, clone(plan));
}
if (!planByJob.size) throw new Error('Aggregate Media Upload Results sem planos de upload.');

const buckets = new Map([...planByJob.keys()].map((jobKey) => [jobKey, {
  image_uploads: [],
  video_uploads: [],
  image_skips: [],
  video_skips: [],
  seen: new Set(),
  receiptsByKey: new Map(),
}]));

for (const item of $input.all()) {
  const receipt = item.json || {};
  const jobKey = text(receipt.job_key);
  const bucket = buckets.get(jobKey);
  if (!bucket) throw new Error(`Resultado de upload nao correlacionado; job_key=${jobKey || 'vazio'}.`);

  const resultKind = text(receipt.upload_result_kind);
  if (resultKind === 'image_skipped') {
    bucket.image_skips.push(clone(receipt));
    continue;
  }
  if (resultKind === 'video_skipped') {
    bucket.video_skips.push(clone(receipt));
    continue;
  }

  const uploadKind = text(receipt.upload_kind);
  const accountId = text(receipt._gateway_account_id || receipt.account_id);
  const sourceFileId = text(receipt.source_file_id);
  if (!accountId || !sourceFileId) {
    throw new Error(`Resultado de upload incompleto em ${jobKey}; account_id/source_file_id ausente.`);
  }
  const dedupeKey = [uploadKind, accountId, sourceFileId].join('::');
  if (bucket.seen.has(dedupeKey)) {
    const previous = bucket.receiptsByKey.get(dedupeKey) || {};
    // Polling a video until it is ready can surface the exact same terminal
    // receipt more than once through the loop/merge graph. It is safe to
    // collapse only an identical ready receipt; any different video result
    // remains an ambiguity and stops publication.
    const identicalReadyVideo = uploadKind === 'video' &&
      text(previous.video_id) === text(receipt.video_id) &&
      text(previous.video_status).toLowerCase() === 'ready' &&
      text(receipt.video_status).toLowerCase() === 'ready' &&
      previous.ready === true && receipt.ready === true;
    if (identicalReadyVideo) continue;
    throw new Error(`Resultado de upload duplicado em ${jobKey}; key=${dedupeKey}.`);
  }
  bucket.seen.add(dedupeKey);
  bucket.receiptsByKey.set(dedupeKey, clone(receipt));

  if (uploadKind === 'image' || uploadKind === 'video_thumbnail') {
    const imageEntries = Object.values(receipt.images || {});
    if (!imageEntries.length || !imageEntries.some((entry) => text(entry?.hash))) {
      throw new Error(`Upload de imagem sem hash em ${jobKey}; kind=${uploadKind}.`);
    }
    bucket.image_uploads.push(clone(receipt));
    continue;
  }
  if (uploadKind === 'video') {
    if (!text(receipt.video_id) || text(receipt.video_status).toLowerCase() !== 'ready' || receipt.ready !== true) {
      throw new Error(`Video ainda nao ready em ${jobKey}; status=${text(receipt.video_status) || 'vazio'}.`);
    }
    bucket.video_uploads.push(clone(receipt));
    continue;
  }
  throw new Error(`Tipo de resultado de upload desconhecido em ${jobKey}; kind=${uploadKind || 'vazio'}.`);
}

const outputs = [];
for (const [jobKey, plan] of planByJob.entries()) {
  const bucket = buckets.get(jobKey);
  const expectedImages = Number(plan.expected?.images || 0);
  const expectedVideos = Number(plan.expected?.videos || 0);
  const completedImages = bucket.image_uploads.length;
  const completedVideos = bucket.video_uploads.length;
  const imageSkipped = expectedImages === 0;
  const videoSkipped = expectedVideos === 0;

  if (imageSkipped ? bucket.image_skips.length !== 1 : bucket.image_skips.length !== 0) {
    throw new Error(`Marcador de imagem invalido em ${jobKey}; expected=${expectedImages} markers=${bucket.image_skips.length}.`);
  }
  if (videoSkipped ? bucket.video_skips.length !== 1 : bucket.video_skips.length !== 0) {
    throw new Error(`Marcador de video invalido em ${jobKey}; expected=${expectedVideos} markers=${bucket.video_skips.length}.`);
  }
  if (completedImages !== expectedImages || completedVideos !== expectedVideos) {
    throw new Error(`Uploads incompletos em ${jobKey}; expected_images=${expectedImages} completed_images=${completedImages} expected_videos=${expectedVideos} completed_videos=${completedVideos}.`);
  }

  outputs.push({
    json: {
      media_upload_envelope_version: '2',
      job_key: jobKey,
      group_key: text(plan.group_key),
      media_mode: text(plan.media_mode),
      expected: {
        images: expectedImages,
        videos: expectedVideos,
        static_images: Number(plan.expected?.static_images || 0),
        video_thumbnails: Number(plan.expected?.video_thumbnails || 0),
      },
      completed: { images: completedImages, videos: completedVideos },
      image_uploads: bucket.image_uploads,
      video_uploads: bucket.video_uploads,
      skipped: { images: imageSkipped, videos: videoSkipped },
      skip_reasons: {
        images: imageSkipped ? 'no_media_of_type' : '',
        videos: videoSkipped ? 'no_media_of_type' : '',
      },
      ready: true,
    },
  });
}

return outputs;
