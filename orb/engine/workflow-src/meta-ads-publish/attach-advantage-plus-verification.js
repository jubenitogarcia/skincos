function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function pairedIndex(item, fallback) {
  const paired = item && item.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  if (paired && typeof paired === 'object') return Number(paired.item ?? fallback);
  return Number(fallback);
}
function unique(values) { return [...new Set(list(values).map(text).filter(Boolean))]; }

const sources = $items('Attach Creative Result') || [];
return $input.all().map((item, index) => {
  const sourceIndex = pairedIndex(item, index);
  const sourceItem = sources[sourceIndex] || {};
  const source = object(sourceItem.json);
  const response = object(item.json);
  if (response.ok !== true || response.operation?.status !== 'completed') {
    throw new Error(`Verify Advantage+ Creative falhou em ${source.job_key || sourceIndex}: ${JSON.stringify(response.detail || response.error || response)}`);
  }
  const creative = object(response.operation.result);
  const features = object(object(creative.degrees_of_freedom_spec).creative_features_spec);
  const applied = Object.entries(features)
    .filter(([, config]) => text(config && config.enroll_status).toUpperCase() === 'OPT_IN')
    .map(([name]) => name);
  const requested = unique(source.advantage_plus_requested_features);
  const removed = requested.filter((feature) => !applied.includes(feature));
  const siteLinks = list(object(creative.creative_sourcing_spec).site_links_spec).map((entry) => ({
    title: text(entry && (entry.site_link_title || entry.title)),
    url: text(entry && (entry.site_link_url || entry.url)),
  })).filter((entry) => entry.title && entry.url);
  return {
    json: {
      ...source,
      creative_id: text(source.creative_id || creative.id),
      advantage_plus_applied_features: applied,
      advantage_plus_removed_features: removed,
      advantage_plus_final_features: applied,
      site_links_applied: siteLinks,
      advantage_plus_verification: {
        status: 'ok',
        checked_at: new Date().toISOString(),
        requested_features: requested,
        applied_features: applied,
        removed_features: removed,
        site_links_requested_count: list(source.advantage_plus_site_links).length,
        site_links_applied: siteLinks,
        response_id: text(creative.id),
      },
      warnings: [
        ...list(source.warnings),
        ...(removed.length ? [`A Meta removeu enhancements inelegiveis: ${removed.join(', ')}`] : []),
      ],
    },
    binary: sourceItem.binary || item.binary,
    pairedItem: { item: sourceIndex },
  };
});
