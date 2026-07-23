function text(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mediaTypeOf(source, binaryData) {
  const mime = text(source.media_processing?.mime_type || source.mimeType || binaryData?.mimeType).toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return '';
}

function dimensionsOf(source, binaryData) {
  const processing = object(source.media_processing);
  return {
    width: Number(processing.width || source.width || binaryData?.width || 0),
    height: Number(processing.height || source.height || binaryData?.height || 0),
  };
}

const inputItems = $input.all();
if (!inputItems.length) throw new Error('Prepare Visual Grouping Batch recebeu zero midias.');

const anyVideo = inputItems.some((item) => {
  const source = item?.json || {};
  return mediaTypeOf(source, item?.binary?.data) === 'video';
});
const version = anyVideo ? '2' : '1';
const media = [];
const binary = {};
const seenDriveIds = new Set();

for (const [itemIndex, item] of inputItems.entries()) {
  const source = item?.json || {};
  const driveId = text(source.id || source.drive_id);
  const data = item?.binary?.data;
  const mediaType = mediaTypeOf(source, data);
  if (!driveId) throw new Error(`Midia ${itemIndex + 1} sem id do Google Drive.`);
  if (seenDriveIds.has(driveId)) throw new Error(`Midia duplicada no lote visual: ${driveId}.`);
  if (!['image', 'video'].includes(mediaType)) throw new Error(`Arquivo ${driveId} possui MIME nao suportado.`);

  const analysisBinary = mediaType === 'video' ? item?.binary?.analysis : data;
  if (!analysisBinary || !text(analysisBinary.mimeType).toLowerCase().startsWith('image/')) {
    throw new Error(`Midia ${driveId} sem representacao visual de imagem para o agente.`);
  }
  if (mediaType === 'video') {
    if (!data || !text(data.mimeType).toLowerCase().startsWith('video/')) throw new Error(`Video ${driveId} sem binario normalizado.`);
    if (!item?.binary?.thumbnail || !text(item.binary.thumbnail.mimeType).toLowerCase().startsWith('image/')) {
      throw new Error(`Video ${driveId} sem miniatura limpa.`);
    }
  }

  seenDriveIds.add(driveId);
  const ordinal = media.length + 1;
  const mediaRef = version === '2'
    ? `MEDIA_${String(ordinal).padStart(3, '0')}`
    : `IMG_${String(ordinal).padStart(3, '0')}`;
  const analysisKey = `analysis_${String(ordinal).padStart(3, '0')}`;
  const dimensions = dimensionsOf(source, data);
  const processing = object(source.media_processing);
  const entry = {
    media_ref: mediaRef,
    image_ref: version === '1' ? mediaRef : undefined,
    ordinal,
    media_type: mediaType,
    mime_type: text(processing.mime_type || data?.mimeType || source.mimeType),
    width: dimensions.width,
    height: dimensions.height,
    duration_seconds: mediaType === 'video' ? Number(processing.duration_seconds || 0) : 0,
    has_audio: mediaType === 'video' ? Boolean(processing.has_audio) : false,
    transcript: mediaType === 'video' ? text(processing.transcript) : '',
    analysis_binary_key: analysisKey,
    source_item_index: itemIndex,
    source_file_id: driveId,
    drive_reference: { id: driveId, modified_time: text(source.modifiedTime || source.modified_time) },
  };
  media.push(entry);
  binary[analysisKey] = clone(analysisBinary);
}

return [{
  json: {
    visual_grouping_batch_version: version,
    grouping_contract: version === '2' ? 'mixed_media_four_roles' : 'legacy_three_images',
    input_count: media.length,
    contains_video: anyVideo,
    required_roles: version === '2'
      ? ['feed_image', 'banner_image', 'vertical_image', 'vertical_video']
      : ['feed', 'banner', 'stories'],
    media,
    images: version === '1' ? media : undefined,
  },
  // Only image representations are forwarded to the vision model. Raw video
  // and upload thumbnails remain on Prepare Media Inventory and are restored
  // after the model output has passed the exact-coverage gate.
  binary,
}];
