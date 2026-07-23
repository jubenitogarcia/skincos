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
  const requested = unique(source.advantage_plus_requested_features);
  if (response.ok !== true || response.operation?.status !== 'completed') {
    const detail = object(response.detail);
    return {
      json: {
        ...source,
        advantage_plus_verification: {
          status: 'unavailable',
          checked_at: new Date().toISOString(),
          requested_features: requested,
          reported_opt_in: [],
          removed_or_ineligible: [],
          not_reported: requested,
          applied_features: [],
          removed_features: [],
          site_links_requested_count: list(source.advantage_plus_site_links).length,
          site_links_applied: [],
          error_code: text(detail.code || response.status),
          error_subcode: text(detail.error_subcode),
        },
        warnings: [
          ...list(source.warnings),
          'A verificacao informativa do creative Advantage+ nao ficou disponivel; a criacao confirmada foi preservada.',
        ],
      },
      binary: sourceItem.binary || item.binary,
      pairedItem: { item: sourceIndex },
    };
  }
  const creative = object(response.operation.result);
  const features = object(object(creative.degrees_of_freedom_spec).creative_features_spec);
  const reported = Object.keys(features);
  const reportedOptIn = Object.entries(features)
    .filter(([, config]) => text(config && config.enroll_status).toUpperCase() === 'OPT_IN')
    .map(([name]) => name);
  const removedOrIneligible = requested.filter((feature) => reported.includes(feature) && !reportedOptIn.includes(feature));
  const notReported = requested.filter((feature) => !reported.includes(feature));
  const verificationStatus = removedOrIneligible.length || notReported.length ? 'inconclusive' : 'verified';
  const siteLinks = list(object(creative.creative_sourcing_spec).site_links_spec).map((entry) => ({
    title: text(entry && (entry.site_link_title || entry.title)),
    url: text(entry && (entry.site_link_url || entry.url)),
  })).filter((entry) => entry.title && entry.url);
  return {
    json: {
      ...source,
      creative_id: text(source.creative_id || creative.id),
      advantage_plus_applied_features: reportedOptIn,
      advantage_plus_removed_features: removedOrIneligible,
      advantage_plus_not_reported_features: notReported,
      advantage_plus_final_features: reportedOptIn,
      site_links_applied: siteLinks,
      advantage_plus_verification: {
        status: verificationStatus,
        checked_at: new Date().toISOString(),
        requested_features: requested,
        reported_opt_in: reportedOptIn,
        removed_or_ineligible: removedOrIneligible,
        not_reported: notReported,
        applied_features: reportedOptIn,
        removed_features: removedOrIneligible,
        site_links_requested_count: list(source.advantage_plus_site_links).length,
        site_links_applied: siteLinks,
        response_id: text(creative.id),
      },
      warnings: [
        ...list(source.warnings),
        ...(removedOrIneligible.length ? [`A Meta reportou enhancements removidos ou inelegiveis: ${removedOrIneligible.join(', ')}`] : []),
        ...(notReported.length ? [`A Meta nao reportou o estado destes enhancements; o readback e inconclusivo: ${notReported.join(', ')}`] : []),
      ],
    },
    binary: sourceItem.binary || item.binary,
    pairedItem: { item: sourceIndex },
  };
});
