function text(value) { return String(value ?? '').trim(); }
function safe(value) { return text(value).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80); }
return $input.all().map((item, index) => {
  const json = item.json || {};
  const binary = item.binary?.data;
  const mime = text(binary?.mimeType || json.mimeType).toLowerCase();
  const mediaType = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : '';
  if (!mediaType) throw new Error(`MIME nao suportado em ${json.id || index}: ${mime}.`);
  if (mediaType === 'video' && !['video/mp4', 'video/quicktime'].includes(mime)) throw new Error(`Video deve ser MP4 ou MOV: ${mime}.`);
  const sourceId = safe(json.id) || `media_${index + 1}`;
  const executionId = safe($execution.id) || 'manual';
  const ext = mime === 'video/quicktime' ? 'mov' : mediaType === 'video' ? 'mp4' : (text(binary?.fileExtension) || 'jpg').replace(/[^A-Za-z0-9]/g, '');
  // This location is writable from the Orb service namespace. The following
  // staging node creates baseDir before Read/Write Files receives inputFile.
  const baseDir = `/tmp/meta-ads-publish/${executionId}/${sourceId}`;
  const inputFile = `${baseDir}/source.${ext}`;
  const outputDir = `${baseDir}/processed`;
  const processorPayload = { input_file: inputFile, output_dir: outputDir, source_file_id: text(json.id), execution_id: executionId, mime_type: mime };
  return {
    json: {
      ...json,
      mimeType: mime,
      media_type: mediaType,
      media_staging: { base_dir: baseDir, input_file: inputFile, output_dir: outputDir },
      processor_payload_b64: mediaType === 'video' ? Buffer.from(JSON.stringify(processorPayload), 'utf8').toString('base64') : '',
    },
    binary: item.binary,
  };
});
