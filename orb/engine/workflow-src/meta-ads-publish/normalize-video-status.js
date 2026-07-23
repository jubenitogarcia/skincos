function pairedIndex(item, fallback) { const p = item?.pairedItem; return Number((Array.isArray(p) ? p[0]?.item : p?.item) ?? fallback); }
function list(value) { return Array.isArray(value) ? value : []; }
function isNineBySixteen(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.abs((width / height) - (9 / 16)) <= 0.002;
}
const prepared = $items('Prepare Video Status') || [];
return $input.all().map((item, index) => {
  const state = prepared[pairedIndex(item, index)]?.json || {};
  const response = item.json || {};
  if (response.ok !== true || response.operation?.status !== 'completed') throw new Error(`Consulta de status de video falhou: ${JSON.stringify(response.detail || response.error || response)}`);
  const result = response.operation.result || {};
  const status = String(result.video_status || '').toLowerCase();
  if (['error', 'failed', 'expired'].includes(status)) throw new Error(`Processamento Meta do video falhou: ${status}.`);
  const thumbnailCandidates = list(result.thumbnails && result.thumbnails.data);
  const preferredThumbnail = thumbnailCandidates.find((thumbnail) => thumbnail && thumbnail.is_preferred === true) || thumbnailCandidates[0] || {};
  const videoWidth = Number(state.video_width || 0);
  const videoHeight = Number(state.video_height || 0);
  const thumbnailWidth = Number(preferredThumbnail.width || 0);
  const thumbnailHeight = Number(preferredThumbnail.height || 0);
  if (status === 'ready' && (!isNineBySixteen(videoWidth, videoHeight) || !isNineBySixteen(thumbnailWidth, thumbnailHeight))) {
    throw new Error(`Video Audience Network rewarded precisa permanecer em 9:16 na Meta; video=${videoWidth}x${videoHeight}, miniatura=${thumbnailWidth}x${thumbnailHeight}.`);
  }
  return { json: {
    ...state,
    video_id: String(result.id || state.video_id),
    video_status: status,
    ready: result.ready === true || status === 'ready',
    thumbnails: result.thumbnails || {},
    video_width: videoWidth,
    video_height: videoHeight,
    video_aspect_ratio: '9x16',
    video_recommended_aspect_ratio: '9x16',
    preferred_thumbnail_width: thumbnailWidth,
    preferred_thumbnail_height: thumbnailHeight,
    preferred_thumbnail_aspect_ratio: status === 'ready' ? '9x16' : '',
    status_operation_key: response.operation.operation_key,
    upload_kind: 'video',
    role: 'vertical_video',
    ratio: '9x16',
    replayed: response.replayed === true,
  } };
});
