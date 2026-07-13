function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function buildDeliveryKey(source) {
  const entity = source.delivery_entity || {};
  const entityToken = safeString(entity.ad_id || entity.entity_id || entity.creative_id);
  return safeString(source.delivery_key) ||
    ['delivery', safeString(source.account_id), safeString(source.report_date), safeString(source.category || 'all'), entityToken].filter(Boolean).join(':');
}

function getPairedIndex(pairedItem) {
  if (typeof pairedItem === 'number') return pairedItem;
  if (pairedItem && typeof pairedItem.item === 'number') return pairedItem.item;
  if (Array.isArray(pairedItem) && typeof pairedItem[0]?.item === 'number') return pairedItem[0].item;
  return null;
}

const sourceItems = $('Prepare Evolution Payload')
  .all()
  .filter((item) => item?.json?.should_send_whatsapp !== false && item?.json?.ready_for_whatsapp !== false);

return items.map((item) => {
  const pairedIndex = getPairedIndex(item.pairedItem);
  const source = sourceItems[pairedIndex]?.json || {};
  const sendResponse = item.json || {};
  const sentAt = new Date().toISOString();

  if (!safeString(source.report_key) || !safeString(source.report_date) || !safeString(source.account_id)) {
    return {
      json: {
        _noop_branch: true,
        route: 'skip_delivery_audit',
        delivery_status: 'skipped_missing_paired_source',
        send_response: sendResponse,
      },
    };
  }

  return {
    json: {
      ...source,
      delivery_key: buildDeliveryKey(source),
      delivery_entity: source.delivery_entity || {},
      sent_at: sentAt,
      whatsapp_text_length: safeString(source.whatsapp_text || source.evolution_caption).length,
      send_response: sendResponse,
      delivery_status: safeString(source.delivery_status || (sendResponse.success === true ? 'sent' : 'failed')),
      success: sendResponse.success === true,
      persistence_status: 'captured_in_output',
    },
  };
});
