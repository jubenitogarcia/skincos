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
function labels(assets) {
  return new Set(list(assets).flatMap((asset) => list(asset && asset.adlabels).map((label) => text(label && label.name))).filter(Boolean));
}
function contains(actual, expected) {
  const values = new Set(list(actual).map(text).filter(Boolean));
  return expected.every((value) => values.has(value));
}
function allCarryLabel(assets, label) {
  return list(assets).length === 5 && list(assets).every((asset) => labels([asset]).has(label));
}
function isNineBySixteen(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    && Math.abs((width / height) - (9 / 16)) <= 0.002;
}
function effectiveWhatsAppStatus(placementItems, source) {
  const destinationGroup = text(source.destination_group);
  const adsetId = text(source.destination_adset_id || source.adset_id);
  const checks = list(placementItems).flatMap((item) => list(object(item && item.json).placement_checks));
  return checks.some((check) => {
    const sameDestination = destinationGroup && text(check.destination_group) === destinationGroup;
    const sameAdset = adsetId && text(check.adset_id) === adsetId;
    return (sameDestination || sameAdset) && contains(object(check.targeting).effective_whatsapp_positions, ['status']);
  });
}
function effectiveVideoOnlyPlacementScope(placementItems, source) {
  const destinationGroup = text(source.destination_group);
  const adsetId = text(source.destination_adset_id || source.adset_id);
  const checks = list(placementItems).flatMap((item) => list(object(item && item.json).placement_checks));
  return checks.some((check) => {
    const sameDestination = destinationGroup && text(check.destination_group) === destinationGroup;
    const sameAdset = adsetId && text(check.adset_id) === adsetId;
    if (!sameDestination && !sameAdset) return false;
    const targeting = object(check.targeting);
    return contains(targeting.effective_publisher_platforms, ['facebook', 'instagram', 'audience_network', 'whatsapp']) &&
      contains(targeting.effective_facebook_positions, ['feed', 'instream_video', 'story', 'search', 'facebook_reels', 'facebook_reels_overlay', 'notification']) &&
      contains(targeting.effective_instagram_positions, ['stream', 'story', 'reels']) &&
      contains(targeting.effective_audience_network_positions, ['classic', 'rewarded_video']) &&
      contains(targeting.effective_whatsapp_positions, ['status']);
  });
}
function verifyMixedCreativeReadback(source, creative, placementItems) {
  if (text(source.media_variant) !== 'mixed_flexible') return { status: 'not_applicable' };
  const feed = object(creative.asset_feed_spec);
  const images = list(feed.images);
  const videos = list(feed.videos);
  const imageLabels = labels(images);
  const videoLabels = labels(videos);
  const descriptions = list(feed.descriptions);
  const descriptionLabels = labels(descriptions);
  const formats = list(feed.ad_formats).map((value) => text(value).toUpperCase()).filter(Boolean);
  const rules = list(feed.asset_customization_rules);
  const staticVertical = rules.filter((rule) => text(rule && rule.image_label && rule.image_label.name) === 'vertical_image' && !text(rule && rule.video_label && rule.video_label.name));
  const videoRewarded = rules.filter((rule) => text(rule && rule.video_label && rule.video_label.name) === 'vertical_video' && !text(rule && rule.image_label && rule.image_label.name));
  const staticSpec = object(staticVertical[0] && staticVertical[0].customization_spec);
  const videoSpec = object(videoRewarded[0] && videoRewarded[0].customization_spec);
  const ruleDescriptionLabels = rules.map((rule) => text(rule && rule.description_label && rule.description_label.name));
  const videoWidth = Number(source.video_width || 0);
  const videoHeight = Number(source.video_height || 0);
  const thumbnailWidth = Number(source.video_thumbnail_width || 0);
  const thumbnailHeight = Number(source.video_thumbnail_height || 0);
  // Graph keeps the WhatsApp publisher platform but canonicalizes the sole
  // supported subposition (Status) by omitting whatsapp_positions. This is
  // equivalent only when the effective ad-set targeting independently proves
  // that Status is the available WhatsApp position; otherwise it remains a
  // fail-closed placement loss.
  const whatsappScopeNormalized = contains(staticSpec.publisher_platforms, ['whatsapp'])
    && list(staticSpec.whatsapp_positions).length === 0
    && effectiveWhatsAppStatus(placementItems, source);
  const failures = [];
  if (images.length !== 3 || !contains([...imageLabels], ['feed_image', 'banner_image', 'vertical_image'])) failures.push('mixed_readback_images_invalid');
  if (videos.length !== 1 || !videoLabels.has('vertical_video')) failures.push('mixed_readback_video_invalid');
  if (descriptions.length !== 5 || ruleDescriptionLabels.some((label) => !label || !descriptionLabels.has(label)) || new Set(ruleDescriptionLabels).size !== rules.length) failures.push('mixed_readback_description_rules_invalid');
  if (formats.length !== 1 || formats[0] !== 'AUTOMATIC_FORMAT') failures.push('mixed_readback_ad_format_invalid');
  if (staticVertical.length !== 1 || !contains(staticSpec.publisher_platforms, ['facebook', 'instagram', 'audience_network', 'whatsapp']) || !contains(staticSpec.facebook_positions, ['instream_video', 'story', 'facebook_reels']) || !contains(staticSpec.instagram_positions, ['story', 'reels']) || !contains(staticSpec.audience_network_positions, ['classic']) || !(contains(staticSpec.whatsapp_positions, ['status']) || whatsappScopeNormalized)) failures.push('mixed_readback_static_vertical_rule_invalid');
  if (videoRewarded.length !== 1 || !contains(videoSpec.publisher_platforms, ['audience_network']) || !contains(videoSpec.audience_network_positions, ['rewarded_video']) || list(videoSpec.facebook_positions).length || list(videoSpec.instagram_positions).length || list(videoSpec.whatsapp_positions).length) failures.push('mixed_readback_rewarded_video_rule_invalid');
  if (!isNineBySixteen(videoWidth, videoHeight) || !isNineBySixteen(thumbnailWidth, thumbnailHeight)) failures.push('mixed_rewarded_video_source_not_verified_9x16');
  if (failures.length) throw new Error(`Mixed creative readback divergiu do contrato de midia: ${JSON.stringify({ creative_id: text(creative.id || source.creative_id), failures })}`);
  return {
    status: 'verified',
    image_count: images.length,
    video_count: videos.length,
    static_vertical_rule_count: staticVertical.length,
    rewarded_video_rule_count: videoRewarded.length,
    rewarded_video_source_dimensions: `${videoWidth}x${videoHeight}`,
    rewarded_video_thumbnail_dimensions: `${thumbnailWidth}x${thumbnailHeight}`,
    rewarded_video_delivery_aspect_ratio: '9x16',
    rewarded_video_format_status: 'recommended_9x16_satisfied_by_exact_original_source',
    ads_manager_format_label: 'original',
    ads_manager_format_label_status: 'exact_9x16_semantic_equivalent_to_recommended',
    ads_manager_crop_control_semantics: 'original_is_exact_9x16_and_recommended_crop_is_a_no_op',
    video_auto_crop_calibration: 'graph_acknowledged_opt_in_but_ads_manager_remained_original',
    graph_video_crop_field_available: false,
    whatsapp_status_scope: whatsappScopeNormalized ? 'graph_normalized_to_effective_adset_status' : 'explicit',
  };
}
function verifyVideoOnlyCreativeReadback(source, creative, placementItems) {
  if (text(source.media_variant) !== 'video_single') return { status: 'not_applicable' };
  const feed = object(creative.asset_feed_spec);
  const images = list(feed.images);
  const videos = list(feed.videos);
  const videoLabels = labels(videos);
  const bodyLabels = labels(feed.bodies);
  const titleLabels = labels(feed.titles);
  const descriptionLabels = labels(feed.descriptions);
  const formats = list(feed.ad_formats).map((value) => text(value).toUpperCase()).filter(Boolean);
  const rules = list(feed.asset_customization_rules);
  const placementScopeVerified = effectiveVideoOnlyPlacementScope(placementItems, source);
  const mainRule = object(rules[0]);
  const rewardedRule = object(rules[1]);
  const mainSpec = object(mainRule.customization_spec);
  const rewardedSpec = object(rewardedRule.customization_spec);
  const whatsappScopeNormalized = contains(mainSpec.publisher_platforms, ['whatsapp'])
    && list(mainSpec.whatsapp_positions).length === 0
    && effectiveWhatsAppStatus(placementItems, source);
  const failures = [];
  if (images.length !== 0) failures.push('video_only_readback_images_present');
  if (videos.length !== 1 || videoLabels.size !== 1 || !videoLabels.has('vertical_video')) failures.push('video_only_readback_video_invalid');
  if (formats.length !== 1 || formats[0] !== 'SINGLE_VIDEO') failures.push('video_only_readback_ad_format_invalid');
  const exactlyFiveUnique = (assets, labels) => list(assets).length === 5 && labels.size === 5 && list(assets).every((asset) => list(asset && asset.adlabels).length === 1);
  if (!exactlyFiveUnique(feed.bodies, bodyLabels)) failures.push('video_only_readback_body_labels_invalid');
  if (!exactlyFiveUnique(feed.titles, titleLabels)) failures.push('video_only_readback_title_labels_invalid');
  if (!exactlyFiveUnique(feed.descriptions, descriptionLabels)) failures.push('video_only_readback_description_labels_invalid');
  const labelsValid = rules.length === 2 && rules.every((rule) => text(rule.video_label && rule.video_label.name) === 'vertical_video' && bodyLabels.has(text(rule.body_label && rule.body_label.name)) && titleLabels.has(text(rule.title_label && rule.title_label.name)) && descriptionLabels.has(text(rule.description_label && rule.description_label.name)) && !text(rule.image_label && rule.image_label.name)) &&
    text(mainRule.body_label && mainRule.body_label.name) !== text(rewardedRule.body_label && rewardedRule.body_label.name) &&
    text(mainRule.title_label && mainRule.title_label.name) !== text(rewardedRule.title_label && rewardedRule.title_label.name) &&
    text(mainRule.description_label && mainRule.description_label.name) !== text(rewardedRule.description_label && rewardedRule.description_label.name);
  if (!labelsValid) failures.push('video_only_readback_rule_labels_invalid');
  if (!contains(mainSpec.publisher_platforms, ['facebook', 'instagram', 'audience_network', 'whatsapp']) || list(mainSpec.publisher_platforms).length !== 4) failures.push('video_only_readback_publishers_invalid');
  if (!contains(mainSpec.facebook_positions, ['feed', 'instream_video', 'story', 'search', 'facebook_reels', 'facebook_reels_overlay', 'notification']) || list(mainSpec.facebook_positions).length !== 7) failures.push('video_only_readback_facebook_positions_invalid');
  if (!contains(mainSpec.instagram_positions, ['stream', 'story', 'reels']) || list(mainSpec.instagram_positions).length !== 3) failures.push('video_only_readback_instagram_positions_invalid');
  if (!contains(mainSpec.audience_network_positions, ['classic']) || list(mainSpec.audience_network_positions).length !== 1) failures.push('video_only_readback_audience_network_positions_invalid');
  if (!(contains(mainSpec.whatsapp_positions, ['status']) || whatsappScopeNormalized)) failures.push('video_only_readback_whatsapp_status_invalid');
  if (!contains(rewardedSpec.publisher_platforms, ['audience_network']) || list(rewardedSpec.publisher_platforms).length !== 1 || !contains(rewardedSpec.audience_network_positions, ['rewarded_video']) || list(rewardedSpec.audience_network_positions).length !== 1 || list(rewardedSpec.facebook_positions).length || list(rewardedSpec.instagram_positions).length || list(rewardedSpec.whatsapp_positions).length) failures.push('video_only_readback_rewarded_rule_invalid');
  if (!placementScopeVerified) failures.push('video_only_readback_placement_scope_invalid');
  if (failures.length) throw new Error(`Video-only creative readback divergiu do contrato: ${JSON.stringify({ creative_id: text(creative.id || source.creative_id), failures })}`);
  return {
    status: 'verified',
    image_count: 0,
    video_count: 1,
    body_count: 5,
    title_count: 5,
    description_count: 5,
    placement_rule_count: 2,
    placement_scope: 'two_explicit_video_rules_match_effective_adset_targeting',
    whatsapp_status_scope: whatsappScopeNormalized ? 'graph_normalized_to_effective_adset_status' : 'explicit',
    aspect_ratio_semantics: 'single_uploaded_source_verified_9x16_no_video_crop_field_in_graph_schema',
  };
}
function verifyCarouselCreativeReadback(source, creative) {
  if (text(source.media_variant) !== 'carousel') return { status: 'not_applicable' };
  const feed = object(creative.asset_feed_spec);
  const images = list(feed.images);
  const bodies = list(feed.bodies);
  const titles = list(feed.titles);
  const descriptions = list(feed.descriptions);
  const links = list(feed.link_urls);
  const carousel = object(list(feed.carousels)[0]);
  const cards = list(carousel.child_attachments);
  const formats = list(feed.ad_formats).map((value) => text(value).toUpperCase()).filter(Boolean);
  const expectedCards = Object.keys(object(source.asset_ids)).filter((key) => /^carousel_card_\d+$/.test(text(key))).length;
  const imageLabels = labels(images);
  const bodyLabels = labels(bodies);
  const titleLabels = labels(titles);
  const descriptionLabels = labels(descriptions);
  const linkLabels = labels(links);
  const expectedCta = text(object(source.destination_contract).kind).toLowerCase() === 'whatsapp' ? 'WHATSAPP_MESSAGE' : 'LEARN_MORE';
  const ctaTypes = list(feed.call_to_action_types).map((value) => text(value).toUpperCase()).filter(Boolean);
  const primaryLinks = new Set(links.map((entry) => text(entry && entry.website_url)).filter(Boolean));
  const failures = [];
  if (formats.length !== 1 || formats[0] !== 'CAROUSEL') failures.push('carousel_readback_ad_format_invalid');
  if (list(feed.carousels).length !== 1 || carousel.multi_share_optimized !== false) failures.push('carousel_readback_container_invalid');
  if (!expectedCards || cards.length !== expectedCards || cards.length < 2 || cards.length > 10) failures.push('carousel_readback_card_count_invalid');
  if ([images, bodies, titles, descriptions, links].some((assets) => assets.length !== cards.length)) failures.push('carousel_readback_asset_count_invalid');
  if (ctaTypes.length !== 1 || ctaTypes[0] !== expectedCta || list(feed.call_to_actions).length) failures.push('carousel_readback_cta_invalid');
  if (primaryLinks.size !== 1) failures.push('carousel_readback_link_consistency_invalid');
  for (const card of cards) {
    const child = object(card);
    if (!imageLabels.has(text(object(child.image_label).name)) ||
      !bodyLabels.has(text(object(child.body_label).name)) ||
      !titleLabels.has(text(object(child.title_label).name)) ||
      !descriptionLabels.has(text(object(child.description_label).name)) ||
      !linkLabels.has(text(object(child.link_url_label).name)) ||
      text(object(child.call_to_action_type_label).name)) failures.push('carousel_readback_card_labels_invalid');
  }
  if (failures.length) throw new Error(`Carousel creative readback divergiu do contrato renderizavel: ${JSON.stringify({ creative_id: text(creative.id || source.creative_id), failures })}`);
  return {
    status: 'verified',
    image_count: images.length,
    card_count: cards.length,
    title_count: titles.length,
    description_count: descriptions.length,
    CTA: ctaTypes[0],
    child_cta_labels: 'absent_by_contract',
  };
}
function updateFeatureGroup(groups, reportedOptIn, removedOrIneligible, notReported) {
  return list(groups).map((entry) => {
    const feature = text(entry && entry.api_key);
    const requested = entry && entry.requested === true;
    if (!requested) return { ...entry, status: 'ineligible' };
    if (reportedOptIn.includes(feature)) return { ...entry, status: 'graph_acknowledged' };
    if (removedOrIneligible.includes(feature)) return { ...entry, status: 'rejected_or_ineligible' };
    if (notReported.includes(feature)) return { ...entry, status: 'not_reported' };
    return { ...entry, status: 'unknown' };
  });
}
function buildEffectiveReport(source, reportedOptIn, removedOrIneligible, notReported, evidenceSource) {
  const groups = object(source.advantage_plus_feature_groups);
  return {
    status: evidenceSource === 'graph_readback'
      ? (removedOrIneligible.length || notReported.length ? 'inconclusive' : 'graph_acknowledged_ui_unverified')
      : 'graph_readback_unavailable',
    evidence_source: evidenceSource,
    main: updateFeatureGroup(groups.main, reportedOptIn, removedOrIneligible, notReported),
    essential: updateFeatureGroup(groups.essential, reportedOptIn, removedOrIneligible, notReported),
    supplemental: updateFeatureGroup(groups.supplemental, reportedOptIn, removedOrIneligible, notReported),
    graph_acknowledged_features: reportedOptIn,
    ui_confirmed_features: [],
    rejected_features: removedOrIneligible,
    not_reported_features: notReported,
    ineligible_features: unique(source.advantage_plus_skipped_features),
    ui_confirmation_required: true,
    graph_acknowledgement_is_not_ui_confirmation: true,
  };
}

const sources = $items('Attach Creative Result') || [];
const placementItems = $items('Validate Meta Placement Eligibility') || [];
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
        advantage_plus_effective_report: buildEffectiveReport(source, [], [], requested, 'none'),
        advantage_plus_verification: {
          status: 'unavailable',
          checked_at: new Date().toISOString(),
          requested_features: requested,
          reported_opt_in: [],
          removed_or_ineligible: [],
          not_reported: requested,
          applied_features: [],
          removed_features: [],
          graph_acknowledged_features: [],
          ui_confirmed_features: [],
          graph_acknowledgement_is_not_ui_confirmation: true,
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
  const mixedMediaReadback = verifyMixedCreativeReadback(source, creative, placementItems);
  const videoOnlyMediaReadback = verifyVideoOnlyCreativeReadback(source, creative, placementItems);
  const carouselMediaReadback = verifyCarouselCreativeReadback(source, creative);
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
      mixed_media_readback: mixedMediaReadback,
      video_only_media_readback: videoOnlyMediaReadback,
      carousel_media_readback: carouselMediaReadback,
      advantage_plus_effective_report: buildEffectiveReport(
        source,
        reportedOptIn,
        removedOrIneligible,
        notReported,
        'graph_readback',
      ),
      advantage_plus_applied_features: reportedOptIn,
      advantage_plus_applied_features_semantics: 'legacy_graph_acknowledged_only',
      advantage_plus_removed_features: removedOrIneligible,
      advantage_plus_not_reported_features: notReported,
      advantage_plus_final_features: reportedOptIn,
      site_links_applied: siteLinks,
      advantage_plus_verification: {
        status: verificationStatus === 'verified' ? 'graph_acknowledged_ui_unverified' : verificationStatus,
        checked_at: new Date().toISOString(),
        requested_features: requested,
        reported_opt_in: reportedOptIn,
        removed_or_ineligible: removedOrIneligible,
        not_reported: notReported,
        applied_features: [],
        removed_features: removedOrIneligible,
        graph_acknowledged_features: reportedOptIn,
        ui_confirmed_features: [],
        graph_acknowledgement_is_not_ui_confirmation: true,
        site_links_requested_count: list(source.advantage_plus_site_links).length,
        site_links_applied: siteLinks,
        response_id: text(creative.id),
      },
      warnings: [
        ...list(source.warnings),
        ...(reportedOptIn.length ? [`A Graph API reconheceu ${reportedOptIn.length} enhancements como OPT_IN; isso nao confirma ativacao no Ads Manager.`] : []),
        ...(removedOrIneligible.length ? [`A Meta reportou enhancements removidos ou inelegiveis: ${removedOrIneligible.join(', ')}`] : []),
        ...(notReported.length ? [`A Meta nao reportou o estado destes enhancements; o readback e inconclusivo: ${notReported.join(', ')}`] : []),
      ],
    },
    binary: sourceItem.binary || item.binary,
    pairedItem: { item: sourceIndex },
  };
});
