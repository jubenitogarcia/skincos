function text(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const inputItems = $input.all();
if (!inputItems.length) {
  throw new Error('Prepare Visual Grouping Batch recebeu zero imagens.');
}

const images = [];
const binary = {};
const seenDriveIds = new Set();

for (const [itemIndex, item] of inputItems.entries()) {
  const source = item?.json || {};
  const driveId = text(source.id);
  const entries = Object.entries(item?.binary || {}).filter(([, value]) =>
    text(value?.mimeType).toLowerCase().startsWith('image/')
  );

  if (!driveId) {
    throw new Error(`Imagem ${itemIndex + 1} sem id do Google Drive.`);
  }
  if (seenDriveIds.has(driveId)) {
    throw new Error(`Imagem duplicada no lote visual: ${driveId}.`);
  }
  if (entries.length !== 1) {
    throw new Error(`Arquivo ${driveId} precisa conter exatamente um binario de imagem; encontrados ${entries.length}.`);
  }

  seenDriveIds.add(driveId);
  const [, binaryData] = entries[0];
  const ordinal = images.length + 1;
  const imageRef = `IMG_${String(ordinal).padStart(3, '0')}`;
  const binaryKey = `image_${String(ordinal).padStart(3, '0')}`;

  images.push({
    image_ref: imageRef,
    ordinal,
    drive_id: driveId,
    binary_key: binaryKey,
    mime_type: text(binaryData.mimeType || source.mimeType),
    source_json: clone(source),
  });
  binary[binaryKey] = clone(binaryData);
}

return [{
  json: {
    visual_grouping_batch_version: '1',
    input_count: images.length,
    images,
  },
  binary,
}];
