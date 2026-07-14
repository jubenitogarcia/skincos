function safeString(value) {
  return value == null ? '' : String(value).trim();
}

return items.map((item, index) => {
  const row = item.json || {};
  const resolvedUrl =
    safeString(row.image_url) ||
    safeString(row.url) ||
    safeString(row.permalink_url) ||
    safeString(row.thumbnail_url);

  return {
    json: {
      ...row,
      download_url: resolvedUrl,
      download_source: resolvedUrl ? 'creative_media_url' : 'creative_media_unavailable',
      visual_fetch_status: resolvedUrl ? 'media_url_resolved' : 'media_url_missing',
      primary_image: {
        found: Boolean(resolvedUrl),
        url: resolvedUrl,
      },
    },
    pairedItem: item.pairedItem ?? { item: index },
  };
});
