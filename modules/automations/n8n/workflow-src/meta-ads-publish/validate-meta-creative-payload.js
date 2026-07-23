const MAX_BODY_LENGTH = 240;
const MAX_TITLE_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 60;
const MIN_IMAGES = 3;
const BODY_COUNT = 5;
const TITLE_COUNT = 5;
const DESCRIPTION_COUNT = 1;
const VERTICAL_CROP_KEY = '90x160';
const HORIZONTAL_CROP_KEY = '191x100';
const REQUIRED_VERTICAL_PLATFORMS = ['facebook', 'instagram', 'audience_network', 'whatsapp'];
const REQUIRED_VERTICAL_FACEBOOK_POSITIONS = ['instream_video', 'story', 'facebook_reels'];
const REQUIRED_VERTICAL_INSTAGRAM_POSITIONS = ['story', 'reels'];
const REQUIRED_VERTICAL_AUDIENCE_NETWORK_POSITIONS = ['classic'];
const REQUIRED_HORIZONTAL_PLATFORMS = ['facebook'];
const REQUIRED_HORIZONTAL_FACEBOOK_POSITIONS = ['search'];
const REQUIRED_CTA = 'BOOK_NOW';
const ALLOWED_ADVANTAGE_PLUS_FEATURES = new Set([
  'add_text_overlay',
  'image_touchups',
  'music_generation',
  'pac_relaxation',
  'text_optimizations',
  'inline_comment',
  'enhance_cta',
  'image_brightness_and_contrast',
  'reveal_details_over_time',
  'show_destination_blurbs',
  'image_animation',
  'site_extensions',
]);
const FORBIDDEN_ADVANTAGE_PLUS_FEATURES = new Set([
  'image_template',
  'media_type_automation',
  'show_summary',
  'audio',
  ['standard', 'enhancements'].join('_'),
]);

function safeString(value) { return String(value ?? '').trim(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function restoredRunContext() {
  let groups = [];
  try { groups = $items('Restore Publish Groups') || []; } catch (error) { groups = []; }
  const runIds = [...new Set(groups.map((item) => safeString(item && item.json && item.json.run_id)).filter(Boolean))];
  const fingerprints = [...new Set(groups.map((item) => safeString(item && item.json && item.json.batch_fingerprint)).filter(Boolean))];
  assert(runIds.length <= 1, 'restored_run_id_ambiguous', { count: runIds.length });
  assert(fingerprints.length <= 1, 'restored_batch_fingerprint_ambiguous', { count: fingerprints.length });
  return { run_id: runIds[0] || '', batch_fingerprint: fingerprints[0] || '' };
}

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
  const match = /^https:\/\/([^\/?#\s:@]+)(?::\d+)?(?:[\/?#]|$)/i.exec(raw);
  const hostname = safeString(match && match[1]).replace(/\.$/, '').toLowerCase();
  assert(Boolean(hostname) && !hostname.includes('..') && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname), `${label}_invalid`, {});
  assert([...hosts].some((host) => hostname === host || hostname.endsWith(`.${host}`)), `${label}_host_not_allowed`, { hostname });
  return raw;
}

function isWhatsAppUrl(value) {
  const raw = safeString(value);
  const match = /^https:\/\/([^\/?#\s:@]+)(?::\d+)?(?:[\/?#]|$)/i.exec(raw);
  const hostname = safeString(match && match[1]).toLowerCase();
  return hostname === 'wa.me' || hostname === 'api.whatsapp.com' || hostname.endsWith('.whatsapp.com');
}

function labelNames(assets) {
  return new Set(safeArray(assets).flatMap((asset) => safeArray(asset && asset.adlabels).map((label) => safeString(label && label.name))).filter(Boolean));
}

function containsAll(actual, expected) {
  const values = new Set(safeArray(actual).map((value) => safeString(value).toLowerCase()));
  return expected.every((value) => values.has(value));
}

function validateCrop(image, index, cropKey, targetWidth, targetHeight, label) {
  const crops = asObject(image && image.image_crops);
  if (!Object.prototype.hasOwnProperty.call(crops, cropKey)) return false;
  const crop = safeArray(crops[cropKey]);
  assert(crop.length === 2, `${label}_crop_points_invalid`, { index });
  const start = safeArray(crop[0]);
  const end = safeArray(crop[1]);
  assert(start.length === 2 && end.length === 2, `${label}_crop_coordinates_invalid`, { index });
  const width = Number(end[0]) - Number(start[0]);
  const height = Number(end[1]) - Number(start[1]);
  assert(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0, `${label}_crop_bounds_invalid`, { index });
  assert(Math.abs((width / height) - (targetWidth / targetHeight)) <= (1 / Math.max(width, height)), `${label}_crop_ratio_invalid`, { index, width, height });
  return true;
}

function validateVerticalCrop(image, index) {
  return validateCrop(image, index, VERTICAL_CROP_KEY, 9, 16, 'vertical');
}

function validateHorizontalCrop(image, index) {
  return validateCrop(image, index, HORIZONTAL_CROP_KEY, 191, 100, 'horizontal');
}

function validatePlacementRules(feed) {
  const imageLabels = labelNames(feed.images);
  const bodyLabels = labelNames(feed.bodies);
  const titleLabels = labelNames(feed.titles);
  const images = safeArray(feed.images);
  let verticalRuleCount = 0;
  let horizontalRuleCount = 0;
  for (const [index, rule] of safeArray(feed.asset_customization_rules).entries()) {
    const image = safeString(rule && rule.image_label && rule.image_label.name);
    const body = safeString(rule && rule.body_label && rule.body_label.name);
    const title = safeString(rule && rule.title_label && rule.title_label.name);
    assert(imageLabels.has(image), 'placement_image_label_missing', { index, image });
    assert(bodyLabels.has(body), 'placement_body_label_missing', { index, body });
    assert(titleLabels.has(title), 'placement_title_label_missing', { index, title });
    const creativeImage = images.find((entry) => safeArray(entry && entry.adlabels)
      .some((label) => safeString(label && label.name) === image));
    const spec = asObject(rule && rule.customization_spec);
    if (creativeImage && validateVerticalCrop(creativeImage, index)) {
      verticalRuleCount += 1;
      assert(containsAll(spec.publisher_platforms, REQUIRED_VERTICAL_PLATFORMS), 'vertical_publishers_incomplete', { index });
      assert(containsAll(spec.facebook_positions, REQUIRED_VERTICAL_FACEBOOK_POSITIONS), 'vertical_facebook_positions_incomplete', { index });
      assert(containsAll(spec.instagram_positions, REQUIRED_VERTICAL_INSTAGRAM_POSITIONS), 'vertical_instagram_positions_incomplete', { index });
      assert(containsAll(spec.audience_network_positions, REQUIRED_VERTICAL_AUDIENCE_NETWORK_POSITIONS), 'vertical_audience_network_positions_incomplete', { index });
    }
    if (creativeImage && validateHorizontalCrop(creativeImage, index)) {
      horizontalRuleCount += 1;
      assert(containsAll(spec.publisher_platforms, REQUIRED_HORIZONTAL_PLATFORMS), 'horizontal_publishers_incomplete', { index });
      assert(containsAll(spec.facebook_positions, REQUIRED_HORIZONTAL_FACEBOOK_POSITIONS), 'horizontal_facebook_positions_incomplete', { index });
    }
  }
  assert(verticalRuleCount === 1, 'vertical_placement_rule_count_invalid', { actual: verticalRuleCount });
  assert(horizontalRuleCount === 1, 'horizontal_placement_rule_count_invalid', { actual: horizontalRuleCount });
}

function validateAdvantagePlus(payload, source, hosts) {
  const legacyBundleKey = ['standard', 'enhancements'].join('_');
  assert(!Object.prototype.hasOwnProperty.call(payload, legacyBundleKey), 'legacy_enhancement_bundle_forbidden', {});
  const freedom = asObject(payload.degrees_of_freedom_spec);
  assert(!Object.prototype.hasOwnProperty.call(freedom, legacyBundleKey), 'legacy_enhancement_bundle_forbidden', {});
  const features = asObject(freedom.creative_features_spec);
  const requested = safeArray(source.advantage_plus_requested_features);
  assert(Object.keys(features).length > 0, 'advantage_plus_features_missing', {});
  for (const [feature, config] of Object.entries(features)) {
    assert(ALLOWED_ADVANTAGE_PLUS_FEATURES.has(feature), 'advantage_plus_feature_not_allowlisted', { feature });
    assert(!FORBIDDEN_ADVANTAGE_PLUS_FEATURES.has(feature), 'advantage_plus_feature_forbidden', { feature });
    assert(safeString(config && config.enroll_status).toUpperCase() === 'OPT_IN', 'advantage_plus_feature_not_opted_in', { feature });
  }
  for (const feature of requested) {
    assert(Object.prototype.hasOwnProperty.call(features, feature), 'advantage_plus_requested_feature_missing', { feature });
  }

  for (const feature of FORBIDDEN_ADVANTAGE_PLUS_FEATURES) {
    assert(!Object.prototype.hasOwnProperty.call(features, feature), 'advantage_plus_feature_forbidden', { feature });
  }

  const sourcing = asObject(payload.creative_sourcing_spec);
  const sourceUrl = validateUrl(sourcing.source_url, hosts, 'creative_source_url');
  assert(!isWhatsAppUrl(sourceUrl), 'creative_source_url_whatsapp_forbidden', {});
  assert(sourceUrl === safeString(source.landing_page_url), 'creative_source_url_mismatch', {});

  const siteLinks = safeArray(sourcing.site_links_spec);
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
  const restored = restoredRunContext();
  if (!safeString(source.run_id)) source.run_id = restored.run_id;
  if (!safeString(source.batch_fingerprint)) source.batch_fingerprint = restored.batch_fingerprint;
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

  const ctas = safeArray(feed.call_to_action_types);
  assert(ctas.length === 1 && safeString(ctas[0]).toUpperCase() === REQUIRED_CTA, 'cta_must_be_book_now', { value: ctas });
  const linkUrls = safeArray(feed.link_urls);
  assert(linkUrls.length === 1, 'link_url_count_invalid', { actual: linkUrls.length });
  const primaryLink = validateUrl(linkUrls[0] && linkUrls[0].website_url, hosts, 'primary_link');
  assert(!isWhatsAppUrl(primaryLink), 'primary_link_whatsapp_forbidden', {});
  assert(primaryLink === safeString(source.landing_page_url), 'primary_link_landing_page_mismatch', {});
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
        vertical_crop_key: VERTICAL_CROP_KEY,
        vertical_placement_rule_count: 1,
        horizontal_crop_key: HORIZONTAL_CROP_KEY,
        horizontal_placement_rule_count: 1,
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
