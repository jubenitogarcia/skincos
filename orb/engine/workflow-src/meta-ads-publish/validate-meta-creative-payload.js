const MAX_BODY_LENGTH = 240;
const MAX_TITLE_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 60;
const MIN_IMAGES = 3;
const BODY_COUNT = 5;
const TITLE_COUNT = 5;
const DESCRIPTION_COUNT = 1;
const ALLOWED_CTAS = new Set([
  'WHATSAPP_MESSAGE',
  'LEARN_MORE',
  'GET_QUOTE',
  'GET_A_QUOTE',
  'BOOK_NOW',
  'MAKE_AN_APPOINTMENT',
  'BOOK_A_CONSULTATION',
  'CONTACT_US',
  'MESSAGE_PAGE',
]);

function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function fail(message, detail = {}) {
  throw new Error(`Meta creative quality gate: ${message} | detail=${JSON.stringify(detail)}`);
}

function assert(condition, message, detail) {
  if (!condition) fail(message, detail);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(fbToken|authorization)$/i.test(key)) continue;
    out[key] = sanitize(item);
  }
  return out;
}

function textAssets(value, expected, maxLength, label) {
  const assets = safeArray(value);
  assert(assets.length === expected, `${label}_count_invalid`, { expected, actual: assets.length });
  const normalized = assets.map((entry, index) => {
    const text = safeString(typeof entry === 'string' ? entry : entry && entry.text).replace(/\s+/g, ' ');
    assert(text.length > 0, `${label}_empty`, { index });
    assert(text.length <= maxLength, `${label}_too_long`, { index, maxLength, actual: text.length });
    return text.toLowerCase();
  });
  assert(new Set(normalized).size === normalized.length, `${label}_duplicates`, {});
  return assets;
}

function allowedHosts(source) {
  return new Set([
    'api.whatsapp.com',
    'wa.me',
    'espacofacial.com',
    'www.espacofacial.com',
    ...safeArray(source.allowed_link_hosts).map((entry) => safeString(entry).toLowerCase()),
  ]);
}

function validateUrl(value, hosts, label) {
  const raw = safeString(value);
  let url;
  try { url = new URL(raw); } catch { fail(`${label}_invalid`, {}); }
  assert(url.protocol === 'https:', `${label}_must_be_https`, {});
  const hostname = url.hostname.toLowerCase();
  assert([...hosts].some((host) => hostname === host || hostname.endsWith(`.${host}`)), `${label}_host_not_allowed`, { hostname });
  return raw;
}

function labelNames(assets) {
  return new Set(safeArray(assets).flatMap((asset) => safeArray(asset && asset.adlabels).map((label) => safeString(label && label.name))).filter(Boolean));
}

function validatePlacementRules(feed) {
  const imageLabels = labelNames(feed.images);
  const bodyLabels = labelNames(feed.bodies);
  const titleLabels = labelNames(feed.titles);
  for (const [index, rule] of safeArray(feed.asset_customization_rules).entries()) {
    const image = safeString(rule && rule.image_label && rule.image_label.name);
    const body = safeString(rule && rule.body_label && rule.body_label.name);
    const title = safeString(rule && rule.title_label && rule.title_label.name);
    assert(imageLabels.has(image), 'placement_image_label_missing', { index, image });
    assert(bodyLabels.has(body), 'placement_body_label_missing', { index, body });
    assert(titleLabels.has(title), 'placement_title_label_missing', { index, title });
  }
}

function validateAdvantagePlus(payload, source, hosts) {
  const legacyBundleKey = ['standard', 'enhancements'].join('_');
  assert(!Object.prototype.hasOwnProperty.call(payload, legacyBundleKey), 'legacy_enhancement_bundle_forbidden', {});
  const features = asObject(asObject(payload.degrees_of_freedom_spec).creative_features_spec);
  const requested = safeArray(source.advantage_plus_requested_features);
  assert(Object.keys(features).length > 0, 'advantage_plus_features_missing', {});
  for (const [feature, config] of Object.entries(features)) {
    assert(safeString(config && config.enroll_status).toUpperCase() === 'OPT_IN', 'advantage_plus_feature_not_opted_in', { feature });
  }
  for (const feature of requested) {
    assert(Object.prototype.hasOwnProperty.call(features, feature), 'advantage_plus_requested_feature_missing', { feature });
  }

  const siteLinks = safeArray(asObject(payload.creative_sourcing_spec).site_links_spec);
  assert(siteLinks.length === 0 || (siteLinks.length >= 2 && siteLinks.length <= 4), 'site_links_count_invalid', { count: siteLinks.length });
  for (const [index, link] of siteLinks.entries()) {
    assert(safeString(link && link.site_link_title), 'site_link_title_missing', { index });
    validateUrl(link && link.site_link_url, hosts, `site_link_${index}`);
  }
  const siteExtensions = asObject(features.site_extensions);
  assert(Boolean(siteLinks.length) === Boolean(safeString(siteExtensions.enroll_status)), 'site_extensions_site_links_mismatch', {});
}

return $input.all().map((item) => {
  const source = sanitize(clone(item.json || {}));
  if (safeString(source.error)) fail('upstream_error', { error: safeString(source.error), upstream: safeString(source.upstream_error) });

  assert(safeString(source.run_id), 'run_id_missing', {});
  assert(safeString(source.token_id), 'token_id_missing', {});
  assert(/^v25\.0$/.test(safeString(source.api_version)), 'api_version_must_be_v25', { value: source.api_version });
  assert(/^\d+$/.test(safeString(source.account_id)), 'account_id_invalid', {});
  assert(/^\d+$/.test(safeString(source.page_id)), 'page_id_invalid', {});

  const payload = asObject(source.creativePayload);
  const story = asObject(payload.object_story_spec);
  const feed = asObject(payload.asset_feed_spec);
  const hosts = allowedHosts(source);
  assert(safeString(payload.name), 'creative_name_missing', {});
  assert(safeString(story.page_id) === safeString(source.page_id), 'creative_page_id_mismatch', {});
  assert(Object.keys(feed).length > 0, 'asset_feed_spec_required', {});

  const images = safeArray(feed.images);
  assert(images.length >= MIN_IMAGES, 'image_count_invalid', { minimum: MIN_IMAGES, actual: images.length });
  for (const [index, image] of images.entries()) {
    assert(Boolean(safeString(image && image.hash) || safeString(image && image.url)), 'image_reference_missing', { index });
    if (safeString(image && image.url)) validateUrl(image.url, hosts, `image_${index}`);
  }
  textAssets(feed.bodies, BODY_COUNT, MAX_BODY_LENGTH, 'bodies');
  textAssets(feed.titles, TITLE_COUNT, MAX_TITLE_LENGTH, 'titles');
  textAssets(feed.descriptions, DESCRIPTION_COUNT, MAX_DESCRIPTION_LENGTH, 'descriptions');

  const linkUrls = safeArray(feed.link_urls);
  assert(linkUrls.length === 1, 'link_url_count_invalid', { actual: linkUrls.length });
  validateUrl(linkUrls[0] && linkUrls[0].website_url, hosts, 'primary_link');
  const ctas = safeArray(feed.call_to_action_types);
  assert(ctas.length === 1 && ALLOWED_CTAS.has(safeString(ctas[0]).toUpperCase()), 'cta_invalid', { value: ctas });
  validatePlacementRules(feed);
  validateAdvantagePlus(payload, source, hosts);

  const adPayload = asObject(source.adPayload);
  assert(safeString(adPayload.name), 'ad_name_missing', {});
  assert(safeString(adPayload.status) === 'PAUSED', 'ad_stage_status_must_be_paused', { value: adPayload.status });
  if (safeString(source.action) === 'create_new') {
    assert(/^\d+$/.test(safeString(adPayload.adset_id)), 'adset_id_required_for_create', {});
  }

  return {
    json: {
      ...source,
      creativePayload: payload,
      creativePayloadFallback: undefined,
      allow_fallback_creative: false,
      blocked_before_update: false,
      meta_creative_validation: {
        status: 'ok',
        applied_at: new Date().toISOString(),
        fallback_available: false,
        fallback_policy: 'disabled',
        creative_error_policy: 'fail_fast_before_ad_mutation',
        ad_mutation_requires_all_creatives: true,
        image_count: images.length,
        body_count: BODY_COUNT,
        title_count: TITLE_COUNT,
        description_count: DESCRIPTION_COUNT,
        site_links_count: safeArray(asObject(payload.creative_sourcing_spec).site_links_spec).length,
        advantage_plus_requested_features: safeArray(source.advantage_plus_requested_features),
      },
      warnings: safeArray(source.warnings),
    },
    binary: item.binary,
  };
});
