const MAX_BODY_LENGTH = 240;
const MAX_TITLE_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 60;
const MIN_IMAGES = 3;
const BODY_COUNT = 5;
const TITLE_COUNT = 5;
const DESCRIPTION_COUNT = 1;
const VERTICAL_CROP_KEY = '90x160';
const HORIZONTAL_CROP_KEY = '191x100';
const FEED_FOUR_BY_FIVE_CROP_KEY = '400x500';
const REQUIRED_VERTICAL_PLATFORMS = ['facebook', 'instagram'];
const REQUIRED_VERTICAL_FACEBOOK_POSITIONS = ['story', 'facebook_reels'];
const REQUIRED_VERTICAL_INSTAGRAM_POSITIONS = ['story', 'reels'];
const REQUIRED_VERTICAL_AUX_PLATFORMS = ['audience_network', 'whatsapp'];
const REQUIRED_HORIZONTAL_PLATFORMS = ['facebook'];
const REQUIRED_HORIZONTAL_FACEBOOK_POSITIONS = ['search'];
const REQUIRED_CTA = 'LEARN_MORE';
const WHATSAPP_CTA = 'WHATSAPP_MESSAGE';
const WORKFLOW_CONTRACT_REVISION = 'meta_destination_contract_v2';
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

function destinationContractKind(source) {
  const kind = safeString(asObject(source.destination_contract).kind).toLowerCase();
  assert(kind === 'whatsapp' || kind === 'website', 'destination_contract_missing_or_invalid', { kind });
  return kind;
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
  // Meta may round a crop edge to a whole source pixel.  Comparing the
  // resulting ratios with only one pixel of tolerance on the longest edge
  // rejects valid crops such as 1731x906 for the 191x100 placement (the ideal
  // height is fractional).  Keep the gate narrow, but allow the bounded error
  // introduced by rounding either coordinate.
  const expectedRatio = targetWidth / targetHeight;
  const actualRatio = width / height;
  const ratioTolerance = Math.max(0.002, 2 / Math.min(width, height));
  assert(Math.abs(actualRatio - expectedRatio) <= ratioTolerance, `${label}_crop_ratio_invalid`, {
    index,
    width,
    height,
    expected_ratio: expectedRatio,
    actual_ratio: actualRatio,
    ratio_tolerance: ratioTolerance,
  });
  return true;
}

function validateVerticalCrop(image, index) {
  return validateCrop(image, index, VERTICAL_CROP_KEY, 9, 16, 'vertical');
}

function validateHorizontalCrop(image, index) {
  return validateCrop(image, index, HORIZONTAL_CROP_KEY, 191, 100, 'horizontal');
}

function validateFeedFourByFiveCrop(image, index) {
  return validateCrop(image, index, FEED_FOUR_BY_FIVE_CROP_KEY, 4, 5, 'feed_four_by_five');
}

function validatePlacementRules(feed) {
  const imageLabels = labelNames(feed.images);
  const videoLabels = labelNames(feed.videos);
  const bodyLabels = labelNames(feed.bodies);
  const titleLabels = labelNames(feed.titles);
  const images = safeArray(feed.images);
  let verticalMixedRuleCount = 0;
  let verticalAuxRuleCount = 0;
  let verticalLegacyRuleCount = 0;
  let horizontalRuleCount = 0;
  let feedFourByFiveRuleCount = 0;
  for (const [index, rule] of safeArray(feed.asset_customization_rules).entries()) {
    const image = safeString(rule && rule.image_label && rule.image_label.name);
    const video = safeString(rule && rule.video_label && rule.video_label.name);
    const body = safeString(rule && rule.body_label && rule.body_label.name);
    const title = safeString(rule && rule.title_label && rule.title_label.name);
    assert(imageLabels.has(image), 'placement_image_label_missing', { index, image });
    if (video) assert(videoLabels.has(video), 'placement_video_label_missing', { index, video });
    assert(bodyLabels.has(body), 'placement_body_label_missing', { index, body });
    assert(titleLabels.has(title), 'placement_title_label_missing', { index, title });
    const creativeImage = images.find((entry) => safeArray(entry && entry.adlabels)
      .some((label) => safeString(label && label.name) === image));
    const spec = asObject(rule && rule.customization_spec);
    const isFeedPlacement = containsAll(spec.publisher_platforms, ['facebook', 'instagram']) &&
      (containsAll(spec.facebook_positions, ['feed']) || containsAll(spec.instagram_positions, ['stream']));
    if (creativeImage && isFeedPlacement && validateFeedFourByFiveCrop(creativeImage, index)) {
      feedFourByFiveRuleCount += 1;
    }
    if (creativeImage && validateVerticalCrop(creativeImage, index)) {
      if (video) {
        verticalMixedRuleCount += 1;
        assert(containsAll(spec.publisher_platforms, REQUIRED_VERTICAL_PLATFORMS), 'vertical_publishers_incomplete', { index });
        assert(containsAll(spec.facebook_positions, REQUIRED_VERTICAL_FACEBOOK_POSITIONS), 'vertical_facebook_positions_incomplete', { index });
        assert(containsAll(spec.instagram_positions, REQUIRED_VERTICAL_INSTAGRAM_POSITIONS), 'vertical_instagram_positions_incomplete', { index });
      } else if (containsAll(spec.publisher_platforms, REQUIRED_VERTICAL_AUX_PLATFORMS)) {
        verticalAuxRuleCount += 1;
      } else {
        verticalLegacyRuleCount += 1;
      }
    }
    if (creativeImage && validateHorizontalCrop(creativeImage, index)) {
      horizontalRuleCount += 1;
      assert(containsAll(spec.publisher_platforms, REQUIRED_HORIZONTAL_PLATFORMS), 'horizontal_publishers_incomplete', { index });
      assert(containsAll(spec.facebook_positions, REQUIRED_HORIZONTAL_FACEBOOK_POSITIONS), 'horizontal_facebook_positions_incomplete', { index });
    }
  }
  if (safeArray(feed.videos).length) {
    assert(verticalMixedRuleCount === 1, 'vertical_mixed_placement_rule_count_invalid', { actual: verticalMixedRuleCount });
    assert(verticalAuxRuleCount === 1, 'vertical_aux_placement_rule_count_invalid', { actual: verticalAuxRuleCount });
  } else {
    assert(verticalLegacyRuleCount === 1, 'vertical_placement_rule_count_invalid', { actual: verticalLegacyRuleCount });
  }
  assert(horizontalRuleCount === 1, 'horizontal_placement_rule_count_invalid', { actual: horizontalRuleCount });
  // A 4:5 source carries Meta's explicit 400x500 crop. A 3:4 or 1:1 fallback
  // deliberately keeps its native aspect, so it has no artificial 4:5 crop.
  assert(feedFourByFiveRuleCount <= 1, 'feed_four_by_five_placement_rule_count_invalid', { actual: feedFourByFiveRuleCount });
  return { feed_four_by_five_rule_count: feedFourByFiveRuleCount };
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
  // Meta accepts the scheduling landing page in asset_feed_spec.link_urls.  Do
  // not add creative_sourcing_spec.source_url unless Meta site extensions are
  // configured: it was rejected by this account's creative endpoint.
  const sourceUrl = safeString(sourcing.source_url);
  assert(!sourceUrl, 'creative_source_url_forbidden_without_site_extensions', {});

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
  assert(
    safeString(source.workflow_contract_revision) === WORKFLOW_CONTRACT_REVISION,
    'workflow_contract_version_skew',
    { expected: WORKFLOW_CONTRACT_REVISION, received: safeString(source.workflow_contract_revision) },
  );
  assert(safeString(source.token_id), 'token_id_missing', {});
  assert(/^v25\.0$/.test(safeString(source.api_version)), 'api_version_must_be_v25', { value: source.api_version });
  assert(/^\d+$/.test(safeString(source.account_id)), 'account_id_invalid', {});
  assert(/^\d+$/.test(safeString(source.page_id)), 'page_id_invalid', {});

  const payload = asObject(source.creativePayload);
  const story = asObject(payload.object_story_spec);
  const feed = asObject(payload.asset_feed_spec);
  const isVideoOnly = safeString(source.media_variant) === 'video_single';
  const hosts = allowedHosts(source);
  const destinationKind = destinationContractKind(source);
  assert(safeString(payload.name), 'creative_name_missing', {});
  assert(safeString(story.page_id) === safeString(source.page_id), 'creative_page_id_mismatch', {});
  assert(isVideoOnly ? Object.keys(feed).length === 0 : Object.keys(feed).length > 0, isVideoOnly ? 'video_single_asset_feed_forbidden' : 'asset_feed_spec_required', {});

  if (isVideoOnly) {
    const videoData = asObject(story.video_data);
    assert(/^\d+$/.test(safeString(videoData.video_id)), 'video_id_invalid', {});
    assert(Boolean(safeString(videoData.image_hash)), 'video_thumbnail_hash_missing', {});
    assert(safeString(source.video_status).toLowerCase() === 'ready', 'video_not_ready', { video_status: source.video_status });
    const cta = asObject(videoData.call_to_action);
    const primaryLink = validateUrl(asObject(cta.value).link, hosts, 'video_primary_link');
    const whatsappDestination = destinationKind === 'whatsapp';
    if (whatsappDestination) {
      assert(safeString(cta.type).toUpperCase() === WHATSAPP_CTA, 'cta_must_be_whatsapp_message', { value: cta.type });
      assert(isWhatsAppUrl(primaryLink), 'primary_link_whatsapp_required', {});
    } else {
      assert(safeString(cta.type).toUpperCase() === REQUIRED_CTA, 'cta_must_be_learn_more', { value: cta.type });
      assert(!isWhatsAppUrl(primaryLink), 'primary_link_whatsapp_forbidden', {});
      assert(primaryLink === safeString(source.landing_page_url), 'primary_link_landing_page_mismatch', {});
    }
  }

  const images = safeArray(feed.images);
  if (!isVideoOnly) assert(images.length >= MIN_IMAGES, 'image_count_invalid', { minimum: MIN_IMAGES, actual: images.length });
  for (const [index, image] of images.entries()) {
    assert(Boolean(safeString(image && image.hash) || safeString(image && image.url)), 'image_reference_missing', { index });
    if (safeString(image && image.url)) validateUrl(image.url, hosts, `image_${index}`);
  }
  const videos = safeArray(feed.videos);
  const requiresVideo = isVideoOnly;
  assert(videos.length === 0, 'mixed_video_asset_feed_forbidden', { actual: videos.length });
  for (const [index, video] of videos.entries()) {
    assert(/^\d+$/.test(safeString(video && video.video_id)), 'video_id_invalid', { index });
    assert(Boolean(safeString(video && video.thumbnail_hash)), 'video_thumbnail_hash_missing', { index });
  }
  if (!isVideoOnly) {
    textAssets(feed.bodies, BODY_COUNT, MAX_BODY_LENGTH, 'bodies');
    textAssets(feed.titles, TITLE_COUNT, MAX_TITLE_LENGTH, 'titles');
    textAssets(feed.descriptions, DESCRIPTION_COUNT, MAX_DESCRIPTION_LENGTH, 'descriptions');
  }

  const ctas = safeArray(feed.call_to_action_types);
  const linkUrls = safeArray(feed.link_urls);
  if (!isVideoOnly) assert(linkUrls.length === 1, 'link_url_count_invalid', { actual: linkUrls.length });
  const primaryLink = isVideoOnly ? '' : validateUrl(linkUrls[0] && linkUrls[0].website_url, hosts, 'primary_link');
  const whatsappDestination = destinationKind === 'whatsapp';
  if (!isVideoOnly && whatsappDestination) {
    assert(ctas.length === 1 && safeString(ctas[0]).toUpperCase() === WHATSAPP_CTA, 'cta_must_be_whatsapp_message', { value: ctas });
    assert(isWhatsAppUrl(primaryLink), 'primary_link_whatsapp_required', {});
    const schedulingUrl = validateUrl(source.scheduling_landing_page_url, hosts, 'scheduling_landing_page');
    assert(!isWhatsAppUrl(schedulingUrl), 'scheduling_landing_page_whatsapp_forbidden', {});
  } else if (!isVideoOnly) {
    assert(ctas.length === 1 && safeString(ctas[0]).toUpperCase() === REQUIRED_CTA, 'cta_must_be_learn_more', { value: ctas });
    assert(!isWhatsAppUrl(primaryLink), 'primary_link_whatsapp_forbidden', {});
    assert(primaryLink === safeString(source.landing_page_url), 'primary_link_landing_page_mismatch', {});
  }
  const placementValidation = !isVideoOnly
    ? validatePlacementRules(feed)
    : { feed_four_by_five_rule_count: 0 };
  if (!isVideoOnly) {
    validateAdvantagePlus(payload, source, hosts);
  }

  const adPayload = asObject(source.adPayload);
  assert(safeString(adPayload.name), 'ad_name_missing', {});
  assert(safeString(adPayload.status) === 'ACTIVE', 'ad_publish_status_must_be_active', { value: adPayload.status });
  const offerFingerprint = asObject(source.offer_fingerprint);
  const offerReplacementGuard = asObject(source.offer_replacement_guard);
  const offerTag = safeString(offerFingerprint.tag).toUpperCase();
  const offerReplacementEligible =
    offerFingerprint.replacement_eligible === true && /^OFV1:[A-Z0-9]+$/.test(offerTag);
  // Replacements are materially riskier than creates: the upstream selector
  // must prove an exact commercial offer, and a verified new offer must leave
  // its deterministic tag on the ad for future non-heuristic correlation.
  assert(Object.keys(offerReplacementGuard).length > 0, 'offer_replacement_guard_missing', {});
  if (safeString(source.action) === 'replace_existing') {
    assert(offerReplacementEligible, 'replacement_offer_fingerprint_unverified', { status: offerFingerprint.status });
    assert(safeString(offerReplacementGuard.reason) === 'exact_eligible_candidate_selected', 'replacement_offer_fingerprint_not_exact', {
      reason: offerReplacementGuard.reason,
    });
    assert(safeString(offerReplacementGuard.selected_candidate_offer_match_status) === 'exact', 'replacement_candidate_offer_match_not_exact', {});
  }
  if (offerReplacementEligible) {
    assert(new RegExp(`\\[${offerTag}\\]`, 'i').test(safeString(adPayload.name)), 'offer_fingerprint_tag_missing_from_ad_name', { offer_tag: offerTag });
  }
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
        video_count: videos.length,
        video_status: safeString(source.video_status),
        vertical_crop_key: VERTICAL_CROP_KEY,
        media_variant: safeString(source.media_variant || 'static_flexible'),
        destination_contract_kind: destinationKind,
        workflow_contract_revision: WORKFLOW_CONTRACT_REVISION,
        vertical_placement_rule_count: isVideoOnly ? 0 : 1,
        horizontal_crop_key: HORIZONTAL_CROP_KEY,
        horizontal_placement_rule_count: 1,
        feed_four_by_five_placement_rule_count: Number(placementValidation.feed_four_by_five_rule_count || 0),
        body_count: isVideoOnly ? 0 : BODY_COUNT,
        title_count: isVideoOnly ? 0 : TITLE_COUNT,
        description_count: isVideoOnly ? 0 : DESCRIPTION_COUNT,
        site_links_count: safeArray(asObject(payload.creative_sourcing_spec).site_links_spec).length,
        advantage_plus_requested_features: safeArray(source.advantage_plus_requested_features),
        offer_fingerprint: {
          status: safeString(offerFingerprint.status || 'unverified'),
          tag: offerTag,
          replacement_eligible: offerReplacementEligible,
          replacement_reason: safeString(offerReplacementGuard.reason),
        },
      },
      warnings: safeArray(source.warnings),
    },
    binary: item.binary,
  };
});
