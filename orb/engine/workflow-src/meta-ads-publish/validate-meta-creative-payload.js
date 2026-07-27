const MAX_BODY_LENGTH = 240;
const MAX_TITLE_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 60;
const MIN_IMAGES = 3;
const BODY_COUNT = 5;
const TITLE_COUNT = 5;
const DESCRIPTION_COUNT = 5;
const VERTICAL_CROP_KEY = '90x160';
const HORIZONTAL_CROP_KEY = '191x100';
const FEED_FOUR_BY_FIVE_CROP_KEY = '400x500';
const REQUIRED_MIXED_STATIC_VERTICAL_PLATFORMS = ['facebook', 'instagram', 'audience_network', 'whatsapp'];
const REQUIRED_MIXED_STATIC_VERTICAL_FACEBOOK_POSITIONS = ['instream_video', 'story', 'facebook_reels'];
const REQUIRED_VERTICAL_INSTAGRAM_POSITIONS = ['story', 'reels'];
const REQUIRED_MIXED_STATIC_VERTICAL_AUDIENCE_NETWORK_POSITIONS = ['classic'];
const REQUIRED_MIXED_STATIC_VERTICAL_WHATSAPP_POSITIONS = ['status'];
const REQUIRED_MIXED_VIDEO_PLATFORMS = ['audience_network'];
const REQUIRED_MIXED_VIDEO_AUDIENCE_NETWORK_POSITIONS = ['rewarded_video'];
const REQUIRED_VIDEO_ONLY_SOCIAL_PLATFORMS = ['facebook', 'instagram'];
const REQUIRED_VIDEO_ONLY_NETWORK_PLATFORMS = ['audience_network', 'whatsapp'];
const REQUIRED_VIDEO_ONLY_FACEBOOK_POSITIONS = ['feed', 'instream_video', 'story', 'search', 'facebook_reels', 'facebook_reels_overlay', 'notification'];
const REQUIRED_VIDEO_ONLY_INSTAGRAM_POSITIONS = ['stream', 'story', 'reels'];
const REQUIRED_VIDEO_ONLY_AUDIENCE_NETWORK_POSITIONS = ['classic'];
const REQUIRED_VIDEO_ONLY_REWARDED_AUDIENCE_NETWORK_POSITIONS = ['rewarded_video'];
const REQUIRED_VIDEO_ONLY_WHATSAPP_POSITIONS = ['status'];
const REQUIRED_HORIZONTAL_PLATFORMS = ['facebook'];
const REQUIRED_HORIZONTAL_FACEBOOK_POSITIONS = ['search'];
const REQUIRED_CTA = 'LEARN_MORE';
const WHATSAPP_CTA = 'WHATSAPP_MESSAGE';
const WORKFLOW_CONTRACT_REVISION = 'meta_destination_contract_v10_carousel';
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
  'adapt_to_placement',
  'video_filtering',
  'video_highlights',
  'video_auto_crop',
  'video_uncrop',
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

function isNineBySixteen(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.abs((width / height) - (9 / 16)) <= 0.002;
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

function validateVideoOnlyPlacementRules(feed) {
  const imageLabels = labelNames(feed.images);
  const videoLabels = labelNames(feed.videos);
  const bodyLabels = labelNames(feed.bodies);
  const titleLabels = labelNames(feed.titles);
  const descriptionLabels = labelNames(feed.descriptions);
  const rules = safeArray(feed.asset_customization_rules);
  assert(imageLabels.size === 0, 'video_only_images_forbidden', { actual: imageLabels.size });
  assert(videoLabels.size === 1 && videoLabels.has('vertical_video'), 'video_only_video_label_invalid', { labels: [...videoLabels] });
  const exactUniqueLabels = (assets, labels) => safeArray(assets).length === 5 && labels.size === 5 && safeArray(assets).every((asset) => safeArray(asset && asset.adlabels).length === 1);
  assert(exactUniqueLabels(feed.bodies, bodyLabels), 'video_only_body_labels_invalid', { labels: [...bodyLabels] });
  assert(exactUniqueLabels(feed.titles, titleLabels), 'video_only_title_labels_invalid', { labels: [...titleLabels] });
  assert(exactUniqueLabels(feed.descriptions, descriptionLabels), 'video_only_description_labels_invalid', { labels: [...descriptionLabels] });
  assert(rules.length === 2, 'video_only_placement_rule_count_invalid', { actual: rules.length });
  const mainRule = asObject(rules[0]);
  const rewardedRule = asObject(rules[1]);
  const mainSpec = asObject(mainRule.customization_spec);
  const rewardedSpec = asObject(rewardedRule.customization_spec);
  for (const rule of [mainRule, rewardedRule]) {
    assert(!safeString(rule.image_label && rule.image_label.name), 'video_only_image_label_forbidden', {});
    assert(safeString(rule.video_label && rule.video_label.name) === 'vertical_video', 'video_only_rule_video_label_invalid', {});
    assert(bodyLabels.has(safeString(rule.body_label && rule.body_label.name)), 'video_only_rule_body_label_invalid', {});
    assert(titleLabels.has(safeString(rule.title_label && rule.title_label.name)), 'video_only_rule_title_label_invalid', {});
    assert(descriptionLabels.has(safeString(rule.description_label && rule.description_label.name)), 'video_only_rule_description_label_invalid', {});
  }
  assert(safeString(mainRule.body_label && mainRule.body_label.name) !== safeString(rewardedRule.body_label && rewardedRule.body_label.name), 'video_only_rule_body_label_reused', {});
  assert(safeString(mainRule.title_label && mainRule.title_label.name) !== safeString(rewardedRule.title_label && rewardedRule.title_label.name), 'video_only_rule_title_label_reused', {});
  assert(safeString(mainRule.description_label && mainRule.description_label.name) !== safeString(rewardedRule.description_label && rewardedRule.description_label.name), 'video_only_rule_description_label_reused', {});
  assert(containsAll(mainSpec.publisher_platforms, [...REQUIRED_VIDEO_ONLY_SOCIAL_PLATFORMS, ...REQUIRED_VIDEO_ONLY_NETWORK_PLATFORMS]), 'video_only_publishers_incomplete', {});
  assert(safeArray(mainSpec.publisher_platforms).length === 4, 'video_only_publishers_not_exclusive', {});
  assert(containsAll(mainSpec.facebook_positions, REQUIRED_VIDEO_ONLY_FACEBOOK_POSITIONS), 'video_only_facebook_positions_incomplete', {});
  assert(safeArray(mainSpec.facebook_positions).length === REQUIRED_VIDEO_ONLY_FACEBOOK_POSITIONS.length, 'video_only_facebook_positions_not_exclusive', {});
  assert(containsAll(mainSpec.instagram_positions, REQUIRED_VIDEO_ONLY_INSTAGRAM_POSITIONS), 'video_only_instagram_positions_incomplete', {});
  assert(safeArray(mainSpec.instagram_positions).length === REQUIRED_VIDEO_ONLY_INSTAGRAM_POSITIONS.length, 'video_only_instagram_positions_not_exclusive', {});
  assert(containsAll(mainSpec.audience_network_positions, REQUIRED_VIDEO_ONLY_AUDIENCE_NETWORK_POSITIONS), 'video_only_audience_network_positions_incomplete', {});
  assert(safeArray(mainSpec.audience_network_positions).length === REQUIRED_VIDEO_ONLY_AUDIENCE_NETWORK_POSITIONS.length, 'video_only_audience_network_positions_not_exclusive', {});
  assert(containsAll(mainSpec.whatsapp_positions, REQUIRED_VIDEO_ONLY_WHATSAPP_POSITIONS), 'video_only_whatsapp_positions_incomplete', {});
  assert(safeArray(mainSpec.whatsapp_positions).length === REQUIRED_VIDEO_ONLY_WHATSAPP_POSITIONS.length, 'video_only_whatsapp_positions_not_exclusive', {});
  assert(containsAll(rewardedSpec.publisher_platforms, ['audience_network']) && safeArray(rewardedSpec.publisher_platforms).length === 1, 'video_only_rewarded_publishers_invalid', {});
  assert(containsAll(rewardedSpec.audience_network_positions, REQUIRED_VIDEO_ONLY_REWARDED_AUDIENCE_NETWORK_POSITIONS) && safeArray(rewardedSpec.audience_network_positions).length === 1, 'video_only_rewarded_positions_invalid', {});
  assert(!safeArray(rewardedSpec.facebook_positions).length && !safeArray(rewardedSpec.instagram_positions).length && !safeArray(rewardedSpec.whatsapp_positions).length, 'video_only_rewarded_scope_invalid', {});
  return {
    feed_four_by_five_rule_count: 0,
    mixed_static_vertical_rule_count: 0,
    mixed_video_rewarded_rule_count: 0,
    video_only_placement_rule_count: 2,
  };
}

function validatePlacementRules(feed, isVideoOnly = false) {
  if (isVideoOnly) return validateVideoOnlyPlacementRules(feed);
  const imageLabels = labelNames(feed.images);
  const videoLabels = labelNames(feed.videos);
  const bodyLabels = labelNames(feed.bodies);
  const titleLabels = labelNames(feed.titles);
  const descriptionLabels = labelNames(feed.descriptions);
  const images = safeArray(feed.images);
  const hasMixedVideo = safeArray(feed.videos).length > 0;
  const usedDescriptionLabels = new Set();
  let mixedStaticVerticalRuleCount = 0;
  let mixedVideoVerticalRuleCount = 0;
  let verticalLegacyRuleCount = 0;
  let horizontalRuleCount = 0;
  let feedFourByFiveRuleCount = 0;
  for (const [index, rule] of safeArray(feed.asset_customization_rules).entries()) {
    const image = safeString(rule && rule.image_label && rule.image_label.name);
    const video = safeString(rule && rule.video_label && rule.video_label.name);
    const body = safeString(rule && rule.body_label && rule.body_label.name);
    const title = safeString(rule && rule.title_label && rule.title_label.name);
    const description = safeString(rule && rule.description_label && rule.description_label.name);
    assert(Boolean(image || video), 'placement_media_label_missing', { index });
    if (image) assert(imageLabels.has(image), 'placement_image_label_missing', { index, image });
    if (video) assert(videoLabels.has(video), 'placement_video_label_missing', { index, video });
    assert(bodyLabels.has(body), 'placement_body_label_missing', { index, body });
    assert(titleLabels.has(title), 'placement_title_label_missing', { index, title });
    assert(descriptionLabels.has(description), 'placement_description_label_missing', { index, description });
    assert(!usedDescriptionLabels.has(description), 'placement_description_label_reused', { index, description });
    usedDescriptionLabels.add(description);
    const creativeImage = images.find((entry) => safeArray(entry && entry.adlabels)
      .some((label) => safeString(label && label.name) === image));
    const spec = asObject(rule && rule.customization_spec);
    if (video) {
      // The vertical video is not a companion for Stories/Reels. It is the
      // explicit replacement only for Audience Network rewarded video.
      assert(!image, 'mixed_video_rule_must_not_include_image_label', { index, image });
      mixedVideoVerticalRuleCount += 1;
      assert(containsAll(spec.publisher_platforms, REQUIRED_MIXED_VIDEO_PLATFORMS), 'mixed_video_publishers_incomplete', { index });
      assert(containsAll(spec.audience_network_positions, REQUIRED_MIXED_VIDEO_AUDIENCE_NETWORK_POSITIONS), 'mixed_video_rewarded_position_missing', { index });
      assert(safeArray(spec.publisher_platforms).length === REQUIRED_MIXED_VIDEO_PLATFORMS.length, 'mixed_video_publishers_not_exclusive', { index });
      assert(safeArray(spec.audience_network_positions).length === REQUIRED_MIXED_VIDEO_AUDIENCE_NETWORK_POSITIONS.length, 'mixed_video_positions_not_exclusive', { index });
      assert(safeArray(spec.facebook_positions).length === 0, 'mixed_video_facebook_position_forbidden', { index });
      assert(safeArray(spec.instagram_positions).length === 0, 'mixed_video_instagram_position_forbidden', { index });
      assert(safeArray(spec.whatsapp_positions).length === 0, 'mixed_video_whatsapp_position_forbidden', { index });
      continue;
    }
    const isFeedPlacement = containsAll(spec.publisher_platforms, ['facebook', 'instagram']) &&
      (containsAll(spec.facebook_positions, ['feed']) || containsAll(spec.instagram_positions, ['stream']));
    if (creativeImage && isFeedPlacement && validateFeedFourByFiveCrop(creativeImage, index)) {
      feedFourByFiveRuleCount += 1;
    }
    if (creativeImage && validateVerticalCrop(creativeImage, index)) {
      if (hasMixedVideo) {
        mixedStaticVerticalRuleCount += 1;
        assert(containsAll(spec.publisher_platforms, REQUIRED_MIXED_STATIC_VERTICAL_PLATFORMS), 'mixed_static_vertical_publishers_incomplete', { index });
        assert(containsAll(spec.facebook_positions, REQUIRED_MIXED_STATIC_VERTICAL_FACEBOOK_POSITIONS), 'mixed_static_vertical_facebook_positions_incomplete', { index });
        assert(containsAll(spec.instagram_positions, REQUIRED_VERTICAL_INSTAGRAM_POSITIONS), 'vertical_instagram_positions_incomplete', { index });
        assert(containsAll(spec.audience_network_positions, REQUIRED_MIXED_STATIC_VERTICAL_AUDIENCE_NETWORK_POSITIONS), 'mixed_static_vertical_audience_network_positions_incomplete', { index });
        assert(containsAll(spec.whatsapp_positions, REQUIRED_MIXED_STATIC_VERTICAL_WHATSAPP_POSITIONS), 'mixed_static_vertical_whatsapp_positions_incomplete', { index });
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
  if (hasMixedVideo) {
    assert(mixedStaticVerticalRuleCount === 1, 'mixed_static_vertical_placement_rule_count_invalid', { actual: mixedStaticVerticalRuleCount });
    assert(mixedVideoVerticalRuleCount === 1, 'mixed_video_rewarded_placement_rule_count_invalid', { actual: mixedVideoVerticalRuleCount });
  } else {
    assert(verticalLegacyRuleCount === 1, 'vertical_placement_rule_count_invalid', { actual: verticalLegacyRuleCount });
  }
  assert(horizontalRuleCount === 1, 'horizontal_placement_rule_count_invalid', { actual: horizontalRuleCount });
  assert(usedDescriptionLabels.size === safeArray(feed.asset_customization_rules).length, 'placement_description_rule_count_invalid', {
    expected: safeArray(feed.asset_customization_rules).length,
    actual: usedDescriptionLabels.size,
  });
  // A 4:5 source carries Meta's explicit 400x500 crop. A 3:4 or 1:1 fallback
  // deliberately keeps its native aspect, so it has no artificial 4:5 crop.
  assert(feedFourByFiveRuleCount <= 1, 'feed_four_by_five_placement_rule_count_invalid', { actual: feedFourByFiveRuleCount });
  return {
    feed_four_by_five_rule_count: feedFourByFiveRuleCount,
    mixed_static_vertical_rule_count: mixedStaticVerticalRuleCount,
    mixed_video_rewarded_rule_count: mixedVideoVerticalRuleCount,
  };
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

function validateCarouselStory(story, source, hosts, destinationKind) {
  const linkData = asObject(story.link_data);
  const cards = safeArray(linkData.child_attachments);
  assert(cards.length >= 2 && cards.length <= 10, 'carousel_card_count_invalid', { actual: cards.length });
  assert(linkData.multi_share_optimized === false, 'carousel_multi_share_optimized_must_be_false', {});
  const primaryLink = validateUrl(linkData.link, hosts, 'carousel_primary_link');
  const parentCta = asObject(linkData.call_to_action);
  const expectedCta = destinationKind === 'whatsapp' ? WHATSAPP_CTA : REQUIRED_CTA;
  assert(safeString(parentCta.type).toUpperCase() === expectedCta, 'carousel_parent_cta_invalid', { value: parentCta.type });
  assert(validateUrl(asObject(parentCta.value).link, hosts, 'carousel_parent_cta_link') === primaryLink, 'carousel_parent_cta_link_mismatch', {});
  for (const [index, card] of cards.entries()) {
    assert(Boolean(safeString(card && card.image_hash) || safeString(card && card.picture)), 'carousel_card_image_missing', { index });
    assert(validateUrl(card && card.link, hosts, `carousel_card_${index}_link`) === primaryLink, 'carousel_card_link_mismatch', { index });
    assert(safeString(card && card.name), 'carousel_card_name_missing', { index });
    const cta = asObject(card && card.call_to_action);
    assert(safeString(cta.type).toUpperCase() === expectedCta, 'carousel_card_cta_invalid', { index, value: cta.type });
    assert(validateUrl(asObject(cta.value).link, hosts, `carousel_card_${index}_cta_link`) === primaryLink, 'carousel_card_cta_link_mismatch', { index });
  }
  const expectedCards = Object.keys(asObject(source.asset_ids)).filter((key) => /^carousel_card_\d+$/.test(safeString(key))).length;
  assert(!expectedCards || expectedCards === cards.length, 'carousel_card_asset_count_mismatch', { expected: expectedCards, actual: cards.length });
  return { primaryLink, card_count: cards.length };
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
  const isMixedFlexible = safeString(source.media_variant) === 'mixed_flexible';
  const isCarousel = safeString(source.media_variant) === 'carousel';
  const hosts = allowedHosts(source);
  const destinationKind = destinationContractKind(source);
  assert(safeString(payload.name), 'creative_name_missing', {});
  assert(safeString(story.page_id) === safeString(source.page_id), 'creative_page_id_mismatch', {});
  assert(isCarousel ? Object.keys(feed).length === 0 : Object.keys(feed).length > 0, isCarousel ? 'carousel_asset_feed_spec_forbidden' : 'asset_feed_spec_required', {});
  if (isMixedFlexible || isVideoOnly) {
    assert(Object.keys(asObject(story.video_data)).length === 0, 'asset_feed_video_object_story_spec_forbidden', {});
  }

  const images = safeArray(feed.images);
  if (isCarousel) assert(images.length === 0, 'carousel_asset_feed_images_forbidden', { actual: images.length });
  else if (isVideoOnly) assert(images.length === 0, 'video_only_images_forbidden', { actual: images.length });
  else assert(images.length >= MIN_IMAGES, 'image_count_invalid', { minimum: MIN_IMAGES, actual: images.length });
  for (const [index, image] of images.entries()) {
    assert(Boolean(safeString(image && image.hash) || safeString(image && image.url)), 'image_reference_missing', { index });
    if (safeString(image && image.url)) validateUrl(image.url, hosts, `image_${index}`);
  }
  const videos = safeArray(feed.videos);
  const expectsAssetFeedVideo = isMixedFlexible || isVideoOnly;
  assert(expectsAssetFeedVideo ? videos.length === 1 : videos.length === 0, expectsAssetFeedVideo ? 'asset_feed_video_count_invalid' : 'unexpected_asset_feed_video', { actual: videos.length });
  for (const [index, video] of videos.entries()) {
    assert(/^\d+$/.test(safeString(video && video.video_id)), 'video_id_invalid', { index });
    assert(Boolean(safeString(video && video.thumbnail_hash)), 'video_thumbnail_hash_missing', { index });
  }
  if (expectsAssetFeedVideo) {
    assert(safeString(source.video_status).toLowerCase() === 'ready', 'video_not_ready', { video_status: source.video_status });
    assert(isNineBySixteen(source.video_width, source.video_height), 'video_source_aspect_ratio_invalid', { width: source.video_width, height: source.video_height, required: '9x16' });
    assert(safeString(source.video_aspect_ratio) === '9x16' && safeString(source.video_recommended_aspect_ratio) === '9x16', 'video_source_aspect_ratio_metadata_invalid', {});
    assert(isNineBySixteen(source.video_thumbnail_width, source.video_thumbnail_height), 'video_thumbnail_aspect_ratio_invalid', { width: source.video_thumbnail_width, height: source.video_thumbnail_height, required: '9x16' });
    assert(safeString(source.video_thumbnail_aspect_ratio) === '9x16', 'video_thumbnail_aspect_ratio_metadata_invalid', {});
    const adFormats = safeArray(feed.ad_formats).map((format) => safeString(format).toUpperCase()).filter(Boolean);
    if (isMixedFlexible) {
      // The Graph endpoint rejects a multi-format feed (1885374), and
      // SINGLE_VIDEO rejects images (1885718). AUTOMATIC_FORMAT is the
      // supported flexible envelope for mixed labelled inventory.
      assert(adFormats.length === 1 && adFormats[0] === 'AUTOMATIC_FORMAT', 'mixed_ad_format_must_be_automatic', { formats: safeArray(feed.ad_formats) });
    } else {
      assert(adFormats.length === 1 && adFormats[0] === 'SINGLE_VIDEO', 'video_only_ad_format_must_be_single_video', { formats: safeArray(feed.ad_formats) });
    }
  }
  if (!isCarousel) {
    textAssets(feed.bodies, BODY_COUNT, MAX_BODY_LENGTH, 'bodies');
    textAssets(feed.titles, TITLE_COUNT, MAX_TITLE_LENGTH, 'titles');
    textAssets(feed.descriptions, DESCRIPTION_COUNT, MAX_DESCRIPTION_LENGTH, 'descriptions');
  }

  const ctas = safeArray(feed.call_to_action_types);
  const linkUrls = safeArray(feed.link_urls);
  const carouselValidation = isCarousel ? validateCarouselStory(story, source, hosts, destinationKind) : null;
  if (!isCarousel) assert(linkUrls.length === 1, 'link_url_count_invalid', { actual: linkUrls.length });
  const primaryLink = isCarousel ? carouselValidation.primaryLink : validateUrl(linkUrls[0] && linkUrls[0].website_url, hosts, 'primary_link');
  const whatsappDestination = destinationKind === 'whatsapp';
  if (isCarousel && whatsappDestination) assert(isWhatsAppUrl(primaryLink), 'carousel_primary_link_whatsapp_required', {});
  if (isCarousel && !whatsappDestination) assert(!isWhatsAppUrl(primaryLink), 'carousel_primary_link_whatsapp_forbidden', {});
  if (whatsappDestination && !isCarousel) {
    assert(ctas.length === 1 && safeString(ctas[0]).toUpperCase() === WHATSAPP_CTA, 'cta_must_be_whatsapp_message', { value: ctas });
    assert(isWhatsAppUrl(primaryLink), 'primary_link_whatsapp_required', {});
    const schedulingUrl = validateUrl(source.scheduling_landing_page_url, hosts, 'scheduling_landing_page');
    assert(!isWhatsAppUrl(schedulingUrl), 'scheduling_landing_page_whatsapp_forbidden', {});
  } else if (!isCarousel) {
    assert(ctas.length === 1 && safeString(ctas[0]).toUpperCase() === REQUIRED_CTA, 'cta_must_be_learn_more', { value: ctas });
    assert(!isWhatsAppUrl(primaryLink), 'primary_link_whatsapp_forbidden', {});
    assert(primaryLink === safeString(source.landing_page_url), 'primary_link_landing_page_mismatch', {});
  }
  const placementValidation = isCarousel ? { carousel_card_count: carouselValidation.card_count } : validatePlacementRules(feed, isVideoOnly);
  validateAdvantagePlus(payload, source, hosts);

  const adPayload = asObject(source.adPayload);
  assert(safeString(adPayload.name), 'ad_name_missing', {});
  const adStatus = safeString(adPayload.status).toUpperCase();
  const isPausedCalibration =
    source.calibration_mode === true &&
    isVideoOnly &&
    safeString(source.action) === 'create_new' &&
    safeString(adPayload.name).toUpperCase().startsWith('[TEST-VIDEO-ONLY]') &&
    safeString(source.desired_final_status).toUpperCase() === 'PAUSED' &&
    adStatus === 'PAUSED';
  assert(
    adStatus === 'ACTIVE' || isPausedCalibration,
    'ad_publish_status_invalid',
    { value: adPayload.status, calibration_mode: source.calibration_mode === true },
  );
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
        video_delivery_aspect_ratio: expectsAssetFeedVideo ? '9x16' : '',
        video_delivery_format_semantics: safeString(source.media_variant) === 'mixed_flexible'
          ? 'rewarded_video_recommended_9x16_satisfied_by_exact_original_source'
          : (expectsAssetFeedVideo ? 'recommended_9x16_satisfied_by_exact_original_source' : ''),
        vertical_crop_key: VERTICAL_CROP_KEY,
        media_variant: safeString(source.media_variant || 'static_flexible'),
        destination_contract_kind: destinationKind,
        workflow_contract_revision: WORKFLOW_CONTRACT_REVISION,
        vertical_placement_rule_count: isVideoOnly ? Number(placementValidation.video_only_placement_rule_count || 0) : 1,
        video_only_placement_rule_count: Number(placementValidation.video_only_placement_rule_count || 0),
        mixed_static_vertical_rule_count: Number(placementValidation.mixed_static_vertical_rule_count || 0),
        mixed_video_rewarded_rule_count: Number(placementValidation.mixed_video_rewarded_rule_count || 0),
        horizontal_crop_key: HORIZONTAL_CROP_KEY,
        horizontal_placement_rule_count: isVideoOnly ? 0 : 1,
        feed_four_by_five_placement_rule_count: Number(placementValidation.feed_four_by_five_rule_count || 0),
        body_count: isCarousel ? 1 : BODY_COUNT,
        title_count: isCarousel ? carouselValidation.card_count : TITLE_COUNT,
        description_count: isCarousel ? carouselValidation.card_count : DESCRIPTION_COUNT,
        carousel_card_count: isCarousel ? carouselValidation.card_count : 0,
        ad_status: adStatus,
        calibration_mode: isPausedCalibration,
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
