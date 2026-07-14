const FALLBACK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sX6lzQAAAAASUVORK5CYII=';

function s(v) { return v == null ? '' : String(v).trim(); }
function normalizeMediaUrl(value) {
  const url = s(value);
  if (!url || !/^https?:\/\//i.test(url)) return url;
  return url
    .replace(/\.png(\?[^#]*\bstp=dst-jpg[^#]*)/i, '.jpg$1')
    .replace(/\.webp(\?[^#]*\bstp=dst-jpg[^#]*)/i, '.jpg$1');
}
function guessMimeType(value) {
  const url = s(value).toLowerCase();
  if (url.includes('stp=dst-jpg') || url.includes('format=jpg') || url.includes('format=jpeg') || url.includes('.jpg') || url.includes('.jpeg')) return 'image/jpeg';
  if (url.includes('.png')) return 'image/png';
  if (url.includes('.webp')) return 'image/webp';
  if (url.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}
function guessFileExtension(mimeType) {
  switch (s(mimeType).toLowerCase()) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: return 'jpg';
  }
}

return items.map((item) => {
  const source = item.json || {};
  const deliveryMode = s(source.delivery_message_mode || 'send-image').toLowerCase() === 'send-text'
    ? 'send-text'
    : 'send-image';
  const caption = s(source.whatsapp_text || source?.whatsapp?.text || source.message_text);
  const media = normalizeMediaUrl(s(
    source.whatsapp_image_url ||
    source.delivery_entity?.image_url ||
    source.representative_image?.image ||
    source.image_url ||
    FALLBACK_IMAGE_BASE64
  ));
  const mimeType = s(source.whatsapp_image_mime_type || source.delivery_entity?.image_mime_type || guessMimeType(media));
  const fileName = s(
    source.whatsapp_image_file_name ||
    source.delivery_entity?.image_file_name ||
    (source.delivery_entity?.creative_id || source.delivery_entity?.ad_id
      ? `creative_${source.delivery_entity?.creative_id || source.delivery_entity?.ad_id}.${guessFileExtension(mimeType)}`
      : `creative.${guessFileExtension(mimeType)}`)
  );
  const shouldSend = deliveryMode === 'send-text'
    ? source.should_send_whatsapp !== false && Boolean(caption)
    : source.should_send_whatsapp !== false && Boolean(media);
  const readyForWhatsapp = Boolean(
    shouldSend &&
    (source.ready_for_whatsapp === true || caption)
  );

  const instanceName = s(source?.delivery_target?.instance_name || source.instance_name || 'crm-channel-1');
  const remoteJid = s(source?.delivery_target?.remote_jid || source.remote_jid || '555195103563');

  return {
    json: {
      ...source,
      route: 'prepared_evolution_delivery',
      delivery_message_mode: deliveryMode,
      ready_for_whatsapp: readyForWhatsapp,
      should_send_whatsapp: shouldSend,
      evolution_instance_name: instanceName,
      evolution_remote_jid: remoteJid,
      evolution_media: media,
      evolution_mime_type: mimeType,
      evolution_file_name: fileName,
      evolution_caption: caption,
      evolution_message_text: caption,
      delivery_payload: {
        delivery_mode: deliveryMode,
        instance_name: instanceName,
        remote_jid: remoteJid,
        media,
        mimetype: mimeType,
        file_name: fileName,
        caption,
        idempotency_key: s(source.idempotency_key),
        message_type: s(source.message_type),
        category: s(source.category),
      },
    },
  };
});
