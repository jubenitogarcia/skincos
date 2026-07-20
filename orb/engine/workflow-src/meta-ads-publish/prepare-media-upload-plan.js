function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function normalizeMediaMode(value, imageCount, videoCount) {
  const mode = text(value);
  if (mode === 'static_only' || mode === 'static_group') return 'static_only';
  if (mode === 'mixed' || mode === 'mixed_group') return 'mixed';
  if (mode === 'video_only') return 'video_only';
  if (imageCount > 0 && videoCount > 0) return 'mixed';
  if (videoCount > 0) return 'video_only';
  return 'static_only';
}

return $input.all().map((item) => {
  const group = item.json || {};
  const jobKey = text(group.job_key);
  const groupKey = text(group.group_key);
  const images = list(group.imagens);
  const videos = list(group.videos);
  if (!jobKey || !groupKey) throw new Error('Prepare Media Upload Plan exige job_key e group_key.');

  const accounts = new Map();
  for (const destination of list(group.destinations)) {
    const accountId = text(destination.destination_ad_account_id || destination.account_id).replace(/^act_/, '');
    if (!accountId) throw new Error(`Destino sem account_id em ${jobKey}.`);
    accounts.set(accountId, accountId);
  }
  if (!accounts.size) throw new Error(`Prepare Media Upload Plan sem contas de destino em ${jobKey}.`);

  const mediaMode = normalizeMediaMode(group.media_mode, images.length, videos.length);
  const modeIsValid =
    (mediaMode === 'static_only' && images.length > 0 && videos.length === 0) ||
    (mediaMode === 'mixed' && images.length > 0 && videos.length > 0) ||
    (mediaMode === 'video_only' && images.length === 0 && videos.length > 0);
  if (!modeIsValid) {
    throw new Error(`Contrato de media_mode inconsistente em ${jobKey}: mode=${mediaMode} images=${images.length} videos=${videos.length}.`);
  }

  const accountCount = accounts.size;
  const staticImageOperations = images.length * accountCount;
  const thumbnailOperations = videos.length * accountCount;
  const videoOperations = videos.length * accountCount;
  const expectedImageOperations = staticImageOperations + thumbnailOperations;

  return {
    json: {
      ...group,
      media_mode: mediaMode,
      media_upload_plan: {
        version: '2',
        job_key: jobKey,
        group_key: groupKey,
        media_mode: mediaMode,
        destination_accounts: [...accounts.keys()],
        expected: {
          images: expectedImageOperations,
          videos: videoOperations,
          static_images: staticImageOperations,
          video_thumbnails: thumbnailOperations,
        },
      },
    },
    binary: clone(item.binary || {}),
  };
});
