function safeString(value) {
  return value == null ? '' : String(value).trim();
}

const seenCreativeIds = new Set();
const outputs = [];

for (const item of items) {
  const row = item.json || {};
  const creativeId = safeString(
    row.representative_creative_id ||
      row.creative_context?.representative_creative?.creative_id ||
      row.creative_id,
  );

  if (!creativeId || seenCreativeIds.has(creativeId)) {
    continue;
  }

  seenCreativeIds.add(creativeId);
  outputs.push({
    json: {
      creative_id: creativeId,
      report_date: safeString(row.report_date),
      entity_type: safeString(row.entity_type),
      category: safeString(row.category),
      representative_entity_id: safeString(row.entity_id),
      image_url: safeString(row.image_url),
      thumbnail_url: safeString(row.thumbnail_url),
      permalink_url: safeString(row.permalink_url),
      url: safeString(row.url),
    },
  });
}

return outputs;
