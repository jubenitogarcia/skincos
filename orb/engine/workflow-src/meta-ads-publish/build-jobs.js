const DEFAULT_AD_STATUS = 'ACTIVE';
// Build Jobs and the downstream quality gate must advance together. This
// prevents a stale n8n node definition from quietly accepting a payload whose
// destination contract was added by a newer workflow revision.
const WORKFLOW_CONTRACT_REVISION = 'meta_destination_contract_v2';
// Website Lead ad sets with dynamic creative reject BOOK_NOW. A replacement
// must, however, preserve the destination contract of its source ad: message
// campaigns require WHATSAPP_MESSAGE and the WhatsApp URL.
const DEFAULT_CTA_TYPE = 'LEARN_MORE';
const WHATSAPP_CTA_TYPE = 'WHATSAPP_MESSAGE';
const RATIO_PRIORITY = ['4x5', '3x4', '2x1', '9x16'];
const TEMPORAL_GUARD_FRESH_DAYS = 7;
const VERTICAL_CROP_KEY = '90x160';
const HORIZONTAL_CROP_KEY = '191x100';
const FEED_FOUR_BY_FIVE_CROP_KEY = '400x500';
const VERTICAL_PUBLISHER_PLATFORMS = ['facebook', 'instagram', 'audience_network', 'whatsapp'];
const VERTICAL_FACEBOOK_POSITIONS = ['instream_video', 'story', 'facebook_reels'];
const VERTICAL_INSTAGRAM_POSITIONS = ['story', 'reels'];
const VERTICAL_AUDIENCE_NETWORK_POSITIONS = ['classic'];

function safeString(value) {
  return String(value ?? '').trim();
}

function toHttps(url) {
  const value = safeString(url);
  return value ? value.replace(/^http:\/\//i, 'https://') : '';
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMediaMode(value, job) {
  const mode = safeString(value);
  if (mode === 'static_only' || mode === 'static_group') return 'static_only';
  if (mode === 'mixed' || mode === 'mixed_group') return 'mixed';
  if (mode === 'video_only') return 'video_only';
  if (safeArray(job && job.videos).length && safeArray(job && job.imagens).length) return 'mixed';
  if (safeArray(job && job.videos).length) return 'video_only';
  return 'static_only';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeLookupKey(value) {
  return safeString(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}
function buildMetaConfigLookup() {
  const map = new Map();
  let rows = [];
  try { rows = $items('Build Meta API Params From Vault') || []; } catch (error) { rows = []; }
  for (const item of rows) {
    const row = (item && item.json) || {};
    const keys = [row.destination_group, row.row_number, row.destination_row_number, row.page_id, row.instagram_user_id, row.adset_id, row.account_id && row.destination_group ? `${row.account_id}:${row.destination_group}` : ''];
    for (const key of keys) {
      const normalized = normalizeLookupKey(key);
      if (normalized && !map.has(normalized)) map.set(normalized, deepClone(row));
    }
  }
  return map;
}
const __metaConfigLookup = buildMetaConfigLookup();
function metaConfigForDestination(destinationMeta) {
  const keys = [destinationMeta.destination_group, destinationMeta.destination_row_number, destinationMeta.destination_page_id, destinationMeta.destination_instagram_user_id, destinationMeta.destination_adset_id, destinationMeta.destination_ad_account_id && destinationMeta.destination_group ? `${destinationMeta.destination_ad_account_id}:${destinationMeta.destination_group}` : ''];
  for (const key of keys) {
    const config = __metaConfigLookup.get(normalizeLookupKey(key));
    if (config) return config;
  }
  return null;
}

function parseHttpsHostname(value) {
  const url = toHttps(value);
  const match = /^https:\/\/([^\/?#\s:@]+)(?::\d+)?(?:[\/?#]|$)/i.exec(url);
  const hostname = safeString(match && match[1]).replace(/\.$/, '').toLowerCase();
  if (!hostname || hostname.includes('..')) return '';
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname) ? hostname : '';
}

function isAllowedLinkUrl(value, configuredHosts) {
  const hostname = parseHttpsHostname(value);
  if (!hostname) return false;
  const allowed = new Set([
    'api.whatsapp.com',
    'wa.me',
    'espacofacial.com',
    'www.espacofacial.com',
    ...safeArray(configuredHosts).map((host) => safeString(host).toLowerCase()),
  ]);
  return [...allowed].some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function safeHostname(value) {
  return parseHttpsHostname(value);
}

function isWhatsAppHostname(value) {
  const hostname = parseHttpsHostname(value);
  return hostname === 'wa.me' || hostname === 'api.whatsapp.com' || hostname.endsWith('.whatsapp.com');
}

function contractFromSourceAd(ad) {
  const creative = asObject(ad && ad.creative);
  const feed = asObject(creative.asset_feed_spec);
  const story = asObject(creative.object_story_spec);
  const linkData = asObject(story.link_data);
  const storyCta = asObject(linkData.call_to_action);
  const ctaType = safeString(
    safeArray(feed.call_to_action_types)[0] || storyCta.type
  ).toUpperCase();
  const linkUrl = toHttps(
    safeArray(feed.link_urls)[0] && safeArray(feed.link_urls)[0].website_url ||
    asObject(storyCta.value).link ||
    linkData.link
  );
  if (!ctaType || !linkUrl) return null;
  if (ctaType === WHATSAPP_CTA_TYPE && isWhatsAppHostname(linkUrl)) {
    return { kind: 'whatsapp', cta_type: WHATSAPP_CTA_TYPE, link_url: linkUrl };
  }
  if (!isWhatsAppHostname(linkUrl)) {
    return { kind: 'website', cta_type: ctaType, link_url: linkUrl };
  }
  return null;
}

function configuredDestinationKind(destinationMeta) {
  const value = safeString(destinationMeta && destinationMeta.destination_type).toUpperCase();
  if (/WHATSAPP|MESSAG/.test(value)) return 'whatsapp';
  if (/WEBSITE|WEB|SITE/.test(value)) return 'website';
  return '';
}

function resolveDestinationContract(job, destinationMeta) {
  const configuredKind = configuredDestinationKind(destinationMeta);
  const configuredWhatsAppUrl = toHttps(destinationMeta && destinationMeta.whatsapp_destination_url);
  const scopedContracts = safeArray(job && job.source_ads)
    .filter((ad) => safeString(ad && ad.adset_id) === safeString(destinationMeta && destinationMeta.destination_adset_id))
    .map(contractFromSourceAd)
    .filter(Boolean);
  const observedKinds = uniqueStrings(scopedContracts.map((contract) => contract.kind));

  if (configuredKind && observedKinds.length && (observedKinds.length !== 1 || observedKinds[0] !== configuredKind)) {
    return { ok: false, error: 'destination_contract_conflict', configured_kind: configuredKind, observed_kinds: observedKinds };
  }
  const kind = configuredKind || (observedKinds.length === 1 ? observedKinds[0] : '');
  if (!kind) {
    return {
      ok: false,
      error: observedKinds.length > 1 ? 'destination_contract_ambiguous' : 'destination_contract_unverified',
      configured_kind: configuredKind,
      observed_kinds: observedKinds,
    };
  }
  if (kind === 'website') {
    return {
      ok: true,
      kind,
      source: configuredKind ? 'gateway_destination_type' : 'source_adset_creative',
      configured_kind: configuredKind,
      observed_source_ad_count: scopedContracts.length,
    };
  }
  if (configuredKind === 'whatsapp') {
    if (!isWhatsAppHostname(configuredWhatsAppUrl)) {
      return {
        ok: false,
        error: 'destination_whatsapp_url_config_missing_or_invalid',
        configured_kind: configuredKind,
        observed_kinds: observedKinds,
      };
    }
    return {
      ok: true,
      kind,
      link_url: configuredWhatsAppUrl,
      source: scopedContracts.length ? 'gateway_destination_contract_and_source_adset_creative' : 'gateway_destination_contract',
      configured_kind: configuredKind,
      observed_source_ad_count: scopedContracts.length,
    };
  }
  const whatsappUrls = uniqueStrings(scopedContracts
    .filter((contract) => contract.kind === 'whatsapp')
    .map((contract) => contract.link_url));
  if (whatsappUrls.length !== 1) {
    return {
      ok: false,
      error: whatsappUrls.length > 1 ? 'destination_whatsapp_link_ambiguous' : 'destination_whatsapp_link_unverified',
      configured_kind: configuredKind,
      observed_kinds: observedKinds,
    };
  }
  return {
    ok: true,
    kind,
    link_url: whatsappUrls[0],
    source: configuredKind ? 'gateway_destination_type_and_source_adset_creative' : 'source_adset_creative',
    configured_kind: configuredKind,
    observed_source_ad_count: scopedContracts.length,
  };
}

function publicDestinationContract(contract) {
  return {
    kind: safeString(contract && contract.kind),
    source: safeString(contract && contract.source),
    configured_kind: safeString(contract && contract.configured_kind),
    observed_source_ad_count: Number(contract && contract.observed_source_ad_count || 0),
    link_host: safeHostname(contract && contract.link_url),
  };
}

// Keep the contract beside the final Graph payload as well as beside its
// resolution metadata. n8n may persist only selected Code-node fields after a
// manual resume; reconstructing from the payload prevents that persistence
// shape from stripping the fail-closed destination gate.
function primaryLinkFromCreativePayload(payload) {
  const story = asObject(asObject(payload).object_story_spec);
  const videoCta = asObject(asObject(story.video_data).call_to_action);
  const feed = asObject(asObject(payload).asset_feed_spec);
  const feedLink = asObject(safeArray(feed.link_urls)[0]).website_url;
  return toHttps(asObject(videoCta.value).link || feedLink);
}

function ensureOutputDestinationContract(output) {
  const row = asObject(output && output.json);
  if (safeString(row.error)) return;
  const linkUrl = primaryLinkFromCreativePayload(row.creativePayload);
  const inferredKind = isWhatsAppHostname(linkUrl) ? 'whatsapp' : 'website';
  const existing = asObject(row.destination_contract);
  const kind = safeString(existing.kind).toLowerCase() || inferredKind;
  if (kind !== 'whatsapp' && kind !== 'website') {
    throw new Error('Build Jobs gerou contrato de destino invalido para ' + safeString(row.job_key) + '.');
  }
  if (kind === 'whatsapp' && !isWhatsAppHostname(linkUrl)) {
    throw new Error('Build Jobs perdeu URL WhatsApp no payload final para ' + safeString(row.job_key) + '.');
  }
  if (kind === 'website' && (!linkUrl || isWhatsAppHostname(linkUrl))) {
    throw new Error('Build Jobs perdeu landing page web no payload final para ' + safeString(row.job_key) + '.');
  }
  row.workflow_contract_revision = WORKFLOW_CONTRACT_REVISION;
  row.destination_contract = {
    kind,
    source: safeString(existing.source) || 'final_graph_payload',
    configured_kind: safeString(existing.configured_kind),
    observed_source_ad_count: Number(existing.observed_source_ad_count || 0),
    link_host: safeHostname(linkUrl),
  };
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();

  for (const value of safeArray(values)) {
    const normalized = safeString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function uniqueObjectsBy(values, getKey) {
  const out = [];
  const seen = new Set();

  for (const value of safeArray(values)) {
    const key = safeString(getKey(value));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function normalizeKey(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function normalizeCompactKey(value) {
  return normalizeKey(value).replace(/_/g, '');
}

function detectRatio(value) {
  const name = safeString(value).toLowerCase();
  if (/(^|[^a-z0-9])2x1([^a-z0-9]|$)/i.test(name)) return '2x1';
  if (/(^|[^a-z0-9])3x4([^a-z0-9]|$)/i.test(name)) return '3x4';
  if (/(^|[^a-z0-9])4x5([^a-z0-9]|$)/i.test(name)) return '4x5';
  if (/(^|[^a-z0-9])9x16([^a-z0-9]|$)/i.test(name)) return '9x16';
  if (/(^|[^a-z0-9])1x1([^a-z0-9]|$)/i.test(name)) return '1x1';
  if (/(^|[^a-z0-9])16x9([^a-z0-9]|$)/i.test(name)) return '16x9';
  return '';
}

function detectRatioFromLabelName(labelName) {
  const normalized = normalizeKey(labelName);

  if (normalized.includes('IMAGE_1')) return '3x4';
  if (normalized.includes('IMAGE_2')) return '2x1';
  if (normalized.includes('IMAGE_3')) return '9x16';
  if (normalized.includes('9X16')) return '9x16';
  if (normalized.includes('16X9')) return '16x9';
  if (normalized.includes('4X5')) return '4x5';
  if (normalized.includes('3X4')) return '3x4';
  if (normalized.includes('2X1')) return '2x1';
  if (normalized.includes('1X1')) return '1x1';

  return '';
}

function inferRatioFromImageCrops(imageCrops) {
  const cropKeys = Object.keys(imageCrops || {}).map((key) => safeString(key));
  const cropMap = {
    '191x100': '2x1',
    '100x100': '3x4',
    '400x500': '4x5',
    '300x400': '3x4',
    '600x750': '4x5',
    '768x1024': '3x4',
    '90x160': '9x16',
    '160x90': '16x9',
    '1080x1920': '9x16',
    '1920x1080': '16x9',
    '1080x1080': '1x1',
    '1200x628': '2x1',
  };

  for (const key of cropKeys) {
    if (cropMap[key]) return cropMap[key];
  }

  return '';
}

function inferRatioFromRule(rule, creativeImages) {
  const customization = rule && rule.customization_spec ? rule.customization_spec : {};
  const imageLabel = rule && rule.image_label ? rule.image_label : {};
  const ratioFromLabel = detectRatioFromLabelName(imageLabel.name);
  if (ratioFromLabel) return ratioFromLabel;

  const imageLabelId = safeString(imageLabel.id);
  const creativeImage = safeArray(creativeImages).find((image) =>
    safeArray(image && image.adlabels).some((label) => safeString(label && label.id) === imageLabelId)
  );
  const ratioFromCrop = inferRatioFromImageCrops(creativeImage && creativeImage.image_crops ? creativeImage.image_crops : {});
  if (ratioFromCrop) return ratioFromCrop;

  const allPositions = [
    ...safeArray(customization.publisher_platforms),
    ...safeArray(customization.facebook_positions),
    ...safeArray(customization.instagram_positions),
    ...safeArray(customization.audience_network_positions),
    ...safeArray(customization.messenger_positions),
  ].map((value) => safeString(value).toLowerCase());

  if (allPositions.some((value) => ['story', 'stories', 'reels', 'facebook_reels', 'instagram_reels'].includes(value))) {
    return '9x16';
  }

  if (allPositions.includes('search')) {
    return '2x1';
  }

  if (allPositions.some((value) =>
    [
      'feed',
      'stream',
      'explore',
      'explore_home',
      'marketplace',
      'notification',
      'instream_video',
      'video_feeds',
      'right_hand_column',
      'facebook_feed',
      'instagram_stream',
    ].includes(value)
  )) {
    return '3x4';
  }

  return '';
}

function buildReplacementPlanForAd(ad, mediaInventoryByRatio) {
  const creative = ad && ad.creative ? ad.creative : {};
  const assetFeed = creative.asset_feed_spec || {};
  const rules = safeArray(assetFeed.asset_customization_rules);
  const creativeImages = safeArray(assetFeed.images);
  const plan = [];

  for (const rule of rules) {
    const ratio = inferRatioFromRule(rule, creativeImages);
    if (!ratio) continue;

    const mediaItem = mediaInventoryByRatio.get(ratio);
    if (!mediaItem) continue;

    plan.push({
      ad_id: safeString(ad.id),
      ad_name: safeString(ad.name),
      creative_id: safeString(creative.id),
      ratio,
      binary_key: safeString(mediaItem.binary_key),
      new_image_drive_id: safeString(mediaItem.id),
      new_image_name: safeString(mediaItem.name),
      target_image_label_id: safeString(rule && rule.image_label && rule.image_label.id),
      target_image_label_name: safeString(rule && rule.image_label && rule.image_label.name),
      rule_priority: rule && rule.priority != null ? rule.priority : null,
      inferred_from_positions: true,
    });
  }

  return uniqueObjectsBy(plan, (item) =>
    [item.ad_id, item.ratio, item.target_image_label_id || item.target_image_label_name].join('::')
  );
}

function hasCreativeAsset(asset) {
  return Boolean(safeString(asset && asset.hash) || safeString(asset && asset.url));
}

function parseJsonObject(value) {
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function unwrapAi(json) {
  if (!json || typeof json !== 'object') return deepClone(json || {});
  if (json.output && typeof json.output === 'object') return deepClone(json.output);

  const parsedOutput = parseJsonObject(json.output);
  if (parsedOutput) {
    if (parsedOutput.output && typeof parsedOutput.output === 'object' && Object.keys(parsedOutput).length === 1) {
      return deepClone(parsedOutput.output);
    }

    return deepClone(parsedOutput);
  }

  return deepClone(json || {});
}

function normalizeTextAssets(list, maxItems) {
  const out = [];
  const seen = new Set();

  for (const entry of safeArray(list)) {
    const text = safeString(typeof entry === 'string' ? entry : entry && entry.text);
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push({ text });
    if (out.length >= maxItems) break;
  }

  return out;
}

function mergeTextAssets(primaryList, fallbackList, maxItems) {
  return normalizeTextAssets([
    ...safeArray(primaryList),
    ...safeArray(fallbackList),
  ], maxItems);
}

function extractUrlCandidate(value) {
  if (typeof value === 'string') return safeString(value);

  if (value && typeof value === 'object') {
    if (typeof value.website_url === 'string') return safeString(value.website_url);
    if (typeof value.url === 'string') return safeString(value.url);
    if (typeof value.href === 'string') return safeString(value.href);

    if (value.website_url && typeof value.website_url === 'object') {
      if (typeof value.website_url.url === 'string') return safeString(value.website_url.url);
      if (typeof value.website_url.href === 'string') return safeString(value.website_url.href);
    }
  }

  return '';
}

function isValidWebsiteUrl(url) {
  return Boolean(parseHttpsHostname(url));
}

function removeEmptyFields(value) {
  if (Array.isArray(value)) {
    return value.map(removeEmptyFields).filter((item) => item !== undefined && item !== null && item !== '');
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const cleaned = removeEmptyFields(inner);
      const emptyObject = cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0;
      const emptyArray = Array.isArray(cleaned) && cleaned.length === 0;
      if (cleaned !== undefined && cleaned !== null && cleaned !== '' && !emptyObject && !emptyArray) {
        out[key] = cleaned;
      }
    }
    return out;
  }
  return value;
}

const ADVANTAGE_PLUS_SITE_LINKS_MIN = 2;
const ADVANTAGE_PLUS_SITE_LINKS_MAX = 4;
const ADVANTAGE_PLUS_MAIN_FEATURES = Object.freeze({
  add_text_overlay: 'Adicionar sobreposicoes',
  music_generation: 'Adicionar musica',
  pac_relaxation: 'Midia flexivel',
  image_touchups: 'Retoques visuais',
  text_optimizations: 'Melhorias no texto',
});
const ADVANTAGE_PLUS_ESSENTIAL_FEATURES = Object.freeze({
  inline_comment: 'Comentarios relevantes',
  enhance_cta: 'Aprimorar CTA',
  image_brightness_and_contrast: 'Ajustar brilho e contraste',
});
const ADVANTAGE_PLUS_SUPPLEMENTAL_FEATURES = Object.freeze({
  reveal_details_over_time: 'Revelar detalhes ao longo do tempo',
  show_destination_blurbs: 'Mostrar detalhes do destino',
  image_animation: 'Animacao de imagem',
  site_extensions: 'Extensoes do site',
});
const ADVANTAGE_PLUS_BASELINE_FEATURES = [
  'add_text_overlay',
  'image_touchups',
  'text_optimizations',
  'inline_comment',
  'enhance_cta',
  'image_brightness_and_contrast',
  'reveal_details_over_time',
  'show_destination_blurbs',
  'image_animation',
];
const ADVANTAGE_PLUS_CONDITIONAL_FEATURES = ['music_generation', 'pac_relaxation', 'site_extensions'];

function parseApiVersionMajor(version) {
  const match = safeString(version).match(/^v?(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function normalizeSiteLinks(list) {
  const out = [];
  const seen = new Set();
  for (const entry of safeArray(list)) {
    const title = safeString(
      typeof entry === 'string'
        ? ''
        : entry && (entry.title || entry.site_link_title || entry.name || entry.label)
    );
    const url = safeString(extractUrlCandidate(entry));
    if (!title || !/^https:\/\//i.test(url) || !isValidWebsiteUrl(url)) continue;
    const key = title.toLowerCase() + '::' + url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url,
      site_link_title: title,
      site_link_url: url,
    });
    if (out.length >= ADVANTAGE_PLUS_SITE_LINKS_MAX) break;
  }
  return out;
}

function buildAdvantagePlusRequest({ apiVersion, siteLinks, musicEligible, pacEligible }) {
  if (parseApiVersionMajor(apiVersion) < 25) {
    throw new Error(`Advantage+ Creative completo exige Marketing API v25.0; recebido ${safeString(apiVersion) || 'vazio'}.`);
  }
  const creativeFeaturesSpec = {};
  const eligibleFeatures = [...ADVANTAGE_PLUS_BASELINE_FEATURES];
  const skippedFeatures = [];
  const skipReasons = {};
  for (const feature of ADVANTAGE_PLUS_BASELINE_FEATURES) {
    creativeFeaturesSpec[feature] = { enroll_status: 'OPT_IN' };
  }

  if (musicEligible) {
    creativeFeaturesSpec.music_generation = { enroll_status: 'OPT_IN' };
    eligibleFeatures.push('music_generation');
  } else {
    skippedFeatures.push('music_generation');
    skipReasons.music_generation = 'adset_without_eligible_instagram_static_image_placement';
  }

  if (pacEligible) {
    creativeFeaturesSpec.pac_relaxation = { enroll_status: 'OPT_IN' };
    eligibleFeatures.push('pac_relaxation');
  } else {
    skippedFeatures.push('pac_relaxation');
    skipReasons.pac_relaxation = 'multiple_ratios_or_explicit_placement_rules_missing';
  }

  const siteLinksEligible = siteLinks.length >= ADVANTAGE_PLUS_SITE_LINKS_MIN;
  if (siteLinksEligible) {
    creativeFeaturesSpec.site_extensions = { enroll_status: 'OPT_IN' };
    eligibleFeatures.push('site_extensions');
  } else {
    skippedFeatures.push('site_extensions');
    skipReasons.site_extensions = 'fewer_than_two_valid_site_links';
  }

  return {
    featureKeyMode: 'add_text_overlay',
    desiredFeatures: [...ADVANTAGE_PLUS_BASELINE_FEATURES, ...ADVANTAGE_PLUS_CONDITIONAL_FEATURES],
    requestedFeatures: Object.keys(creativeFeaturesSpec),
    eligibleFeatures,
    skippedFeatures,
    skipReasons,
    siteLinksEligible,
    siteLinks: deepClone(siteLinks),
    featureGroups: {
      main: Object.entries(ADVANTAGE_PLUS_MAIN_FEATURES).map(([apiKey, label]) => ({
        api_key: apiKey,
        label,
        requested: Object.prototype.hasOwnProperty.call(creativeFeaturesSpec, apiKey),
        eligible: eligibleFeatures.includes(apiKey),
        status: Object.prototype.hasOwnProperty.call(creativeFeaturesSpec, apiKey) ? 'requested' : 'ineligible',
        reason: skipReasons[apiKey] || '',
      })),
      essential: Object.entries(ADVANTAGE_PLUS_ESSENTIAL_FEATURES).map(([apiKey, label]) => ({
        api_key: apiKey,
        label,
        requested: Object.prototype.hasOwnProperty.call(creativeFeaturesSpec, apiKey),
        eligible: eligibleFeatures.includes(apiKey),
        status: Object.prototype.hasOwnProperty.call(creativeFeaturesSpec, apiKey) ? 'requested' : 'ineligible',
        reason: skipReasons[apiKey] || '',
      })),
      supplemental: Object.entries(ADVANTAGE_PLUS_SUPPLEMENTAL_FEATURES).map(([apiKey, label]) => ({
        api_key: apiKey,
        label,
        requested: Object.prototype.hasOwnProperty.call(creativeFeaturesSpec, apiKey),
        eligible: eligibleFeatures.includes(apiKey),
        status: Object.prototype.hasOwnProperty.call(creativeFeaturesSpec, apiKey) ? 'requested' : 'ineligible',
        reason: skipReasons[apiKey] || '',
      })),
    },
    creativeFeaturesSpec,
    creativeSourcingSpec: siteLinksEligible
      ? { site_links_spec: siteLinks.map((link) => ({
            site_link_title: safeString(link.site_link_title || link.title),
            site_link_url: toHttps(link.site_link_url || link.url),
          })) }
      : {},
  };
}

function resolveLandingPage(destinationMeta, gatewayConfig, creativeGroupKey, allowedHosts) {
  const map = asObject(destinationMeta.landing_pages_by_creative_group || gatewayConfig && gatewayConfig.landing_pages_by_creative_group);
  const normalizedGroup = normalizeKey(creativeGroupKey);
  const exactMatches = Object.entries(map).filter(([key]) => normalizeKey(key) === normalizedGroup);
  const defaultMatches = Object.entries(map).filter(([key]) => ['DEFAULT', 'ALL'].includes(normalizeKey(key)) || safeString(key) === '*');
  const uniqueUrls = uniqueStrings(Object.values(map));
  const matches = exactMatches.length
    ? exactMatches
    : defaultMatches.length
      ? defaultMatches
      : uniqueUrls.length === 1
        ? [Object.entries(map).find(([, value]) => safeString(value) === uniqueUrls[0])]
        : [];
  if (matches.length !== 1) {
    return {
      ok: false,
      error: matches.length ? 'landing_page_mapping_ambiguous' : 'landing_page_mapping_missing',
      configured_keys: Object.keys(map).map(normalizeKey).filter(Boolean),
    };
  }
  const url = safeString(matches[0][1]);
  if (!/^https:\/\//i.test(url) || !isAllowedLinkUrl(url, allowedHosts) || isWhatsAppHostname(url)) {
    return {
      ok: false,
      error: isWhatsAppHostname(url) ? 'landing_page_redirects_to_whatsapp' : 'landing_page_invalid_or_not_allowed',
      rejected_hostname: safeHostname(url) || 'invalid',
    };
  }
  return {
    ok: true,
    url,
    source: 'token_vault.landing_pages_by_creative_group',
    configured_key: matches[0][0],
  };
}

function isMusicEligible(placementEligibility) {
  const eligibility = asObject(placementEligibility && placementEligibility.advantage_plus_eligibility);
  if (eligibility.instagram_static_image_music === true) return true;
  const targeting = asObject(placementEligibility && placementEligibility.targeting);
  const publishers = safeArray(targeting.effective_publisher_platforms || targeting.publisher_platforms).map((value) => safeString(value).toLowerCase());
  const instagram = safeArray(targeting.effective_instagram_positions || targeting.instagram_positions).map((value) => safeString(value).toLowerCase());
  return publishers.includes('instagram') && instagram.some((value) => ['story', 'reels', 'stream'].includes(value));
}


function createLabel(seed, type, index) {
  const base = normalizeKey(seed).toLowerCase().slice(0, 24) || 'asset';
  return { name: ['placement_asset', base, type, index].join('_') };
}

function safeWarnings(jobWarnings, extraWarnings) {
  return [
    ...safeArray(jobWarnings),
    ...safeArray(extraWarnings),
  ];
}

function getBuildPayloadEntries() {
  let items = [];
  try { items = $items('Restore Publish Groups') || []; } catch (error) { items = []; }
  if (!items.some((item) => safeString(item && item.json && item.json.job_key))) {
    items = $('Build Payload').all();
  }
  return items
    .map((item) => ({
      json: item.json || {},
      binary: item.binary || {},
    }))
    .filter((entry) => entry.json && safeString(entry.json.job_key));
}

function getBuildPayloadErrorEntries() {
  return $('Build Payload')
    .all()
    .map((item) => ({
      json: item.json || {},
      binary: item.binary || {},
    }))
    .filter((entry) => entry.json && safeString(entry.json.error));
}

function buildFileToJob(jobEntries) {
  const fileToJob = new Map();

  for (const entry of jobEntries) {
    const job = entry.json || {};
    for (const media of [...safeArray(job.imagens), ...safeArray(job.videos)]) {
      const imageName = safeString(media.name);
      const originalName = safeString(media.original_name);
      const ratio = safeString(media.proporcao || detectRatio(imageName || originalName));

      const payload = {
        job_key: safeString(job.job_key),
        ratio,
        role: safeString(media.role),
        media_type: safeString(media.media_type || 'image'),
        source_file_id: safeString(media.id),
        source_file_name: imageName || originalName,
      };

      if (imageName) fileToJob.set(normalizeKey(imageName), payload);
      if (originalName) fileToJob.set(normalizeKey(originalName), payload);
    }
  }

  return fileToJob;
}

function buildUploadedByJob(inputItems, fileToJob) {
  const uploadItems = inputItems.map((item) => item.json || {});

  const uploadedByJob = new Map();
  const targetFor = (jobKey, accountId) => {
    if (!jobKey || !accountId) return null;
    if (!uploadedByJob.has(jobKey)) uploadedByJob.set(jobKey, new Map());
    const byAccount = uploadedByJob.get(jobKey);
    if (!byAccount.has(accountId)) byAccount.set(accountId, {});
    return byAccount.get(accountId);
  };

  for (const item of uploadItems) {
    if (item.video_id && item.upload_kind === 'video') {
      const target = targetFor(safeString(item.job_key), safeString(item._gateway_account_id || item.account_id));
      if (target) target.vertical_video = {
        media_type: 'video', role: 'vertical_video', ratio: '9x16', video_id: safeString(item.video_id),
        video_status: safeString(item.video_status), ready: item.ready === true,
        source_file_id: safeString(item.source_file_id), source_file_name: safeString(item.source_file_name),
        checksum_sha256: safeString(item.checksum_sha256), operation_key: safeString(item.status_operation_key),
      };
      continue;
    }
    for (const [filename, meta] of Object.entries(item.images || {})) {
      const normalizedFilename = normalizeKey(filename);
      const fileRef = safeString(item.job_key)
        ? { job_key: safeString(item.job_key), ratio: safeString(item.ratio), role: safeString(item.role), media_type: item.upload_kind === 'video_thumbnail' ? 'video_thumbnail' : 'image', source_file_id: safeString(item.source_file_id), source_file_name: safeString(item.source_file_name) }
        : fileToJob.get(normalizedFilename);
      if (!fileRef || !fileRef.job_key) continue;

      const accountId = safeString(item._gateway_account_id || item.account_id);
      if (!accountId) continue;
      const target = targetFor(fileRef.job_key, accountId);
      const targetKey = item.upload_kind === 'video_thumbnail' ? 'vertical_video_thumbnail' : (fileRef.ratio || detectRatio(filename));
      target[targetKey] = {
        ratio: fileRef.ratio || detectRatio(filename),
        role: fileRef.role,
        media_type: fileRef.media_type,
        original_filename: safeString(filename),
        source_file_id: fileRef.source_file_id,
        source_file_name: fileRef.source_file_name,
        hash: safeString(meta && meta.hash),
        url: toHttps(meta && meta.url),
        width: Number(meta && meta.width),
        height: Number(meta && meta.height),
      };
    }
  }

  return uploadedByJob;
}

function buildFallbackUploadPool(inputItems) {
  const uploadItems = inputItems
    .map((item) => item.json || {})
    .filter((json) => json.images && typeof json.images === 'object');

  const pool = [];
  const seen = new Set();

  for (const item of uploadItems) {
    for (const [filename, meta] of Object.entries(item.images || {})) {
      const hash = safeString(meta && meta.hash);
      const url = toHttps(meta && meta.url);
      if (!hash && !url) continue;

      const ratio = safeString(detectRatio(filename));
      const dedupeKey = [hash, url, ratio].join('::');
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      pool.push({
        ratio,
        original_filename: safeString(filename),
        source_file_id: '',
        source_file_name: safeString(filename),
        hash,
        url,
        width: Number(meta && meta.width),
        height: Number(meta && meta.height),
      });
    }
  }

  return pool;
}

function buildAiByJob(inputItems, jobEntries) {
  // This node receives a Merge containing Livia output plus image/video upload
  // receipts.  Upload receipts also carry job_key, so job_key alone is never
  // evidence of an AI response.  Treat only a parsed creative_override as copy.
  const aiItems = inputItems
    .map((item, input_index) => ({ item: item.json || {}, input_index }))
    .map(({ item, input_index }) => ({ item, ai: unwrapAi(item), input_index }))
    .filter(({ ai }) => Object.keys(asObject(ai.creative_override)).length > 0);

  const jobsByKey = new Map();
  const jobsBySourceName = new Map(jobEntries.map((entry) => [normalizeKey(entry.json.source_ad_name), safeString(entry.json.job_key)]));
  const jobsByGroupKey = new Map(jobEntries.map((entry) => [normalizeKey(entry.json.group_key), safeString(entry.json.job_key)]));

  for (const entry of jobEntries) {
    const key = safeString(entry.json && entry.json.job_key);
    if (!key) continue;
    jobsByKey.set(key, key);
    jobsByKey.set(normalizeKey(key), key);
  }

  const aiByJob = new Map();
  const unmappedInputIndexes = [];
  const conflictingJobKeys = new Set();

  for (const { item, ai, input_index } of aiItems) {
    const directKey = safeString(ai.job_key || item.job_key);
    const aiSourceName = safeString(ai.source_ad_name || item.source_ad_name);
    const aiGroupKey = safeString(ai.group_key || ai.nome_base || item.group_key);
    const resolvedJobKey =
      jobsByKey.get(directKey) ||
      jobsByKey.get(normalizeKey(directKey)) ||
      jobsBySourceName.get(normalizeKey(aiSourceName)) ||
      jobsByGroupKey.get(normalizeKey(aiGroupKey)) ||
      (jobEntries.length === 1 && aiItems.length === 1 ? safeString(jobEntries[0].json.job_key) : '');

    if (!resolvedJobKey) {
      unmappedInputIndexes.push(input_index);
      continue;
    }
    if (aiByJob.has(resolvedJobKey)) {
      conflictingJobKeys.add(resolvedJobKey);
      continue;
    }
    aiByJob.set(resolvedJobKey, ai);
  }

  return {
    aiByJob,
    diagnostics: {
      candidate_count: aiItems.length,
      mapped_job_keys: [...aiByJob.keys()],
      unmapped_candidate_count: unmappedInputIndexes.length,
      conflicting_job_keys: [...conflictingJobKeys],
    },
  };
}

function buildOrderedAssets(job, uploaded) {
  const requiredRatios = safeArray(job.required_ratios).length ? safeArray(job.required_ratios) : RATIO_PRIORITY;
  const ordered = requiredRatios.map((ratio) => uploaded[ratio]).filter(Boolean);
  if (ordered.length) return ordered;
  return RATIO_PRIORITY.map((ratio) => uploaded[ratio]).filter(Boolean);
}

function buildCenteredCrop(widthValue, heightValue, targetWidth, targetHeight) {
  const width = Math.trunc(Number(widthValue));
  const height = Math.trunc(Number(heightValue));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = width / height;
  if (Math.abs(sourceRatio - targetRatio) < 0.000001) {
    return [[0, 0], [width, height]];
  }

  // Meta evaluates image_crops against the exact integer ratio encoded in the
  // crop key.  Rounding only one edge can produce a crop such as 1731x906 for
  // 191x100, which looks correct locally but is rejected by the creative API.
  // When the source is large enough, retain the largest centred crop whose
  // dimensions are an exact integer multiple of the requested ratio.
  const exactScale = Math.floor(Math.min(width / targetWidth, height / targetHeight));
  if (exactScale >= 1) {
    const cropWidth = targetWidth * exactScale;
    const cropHeight = targetHeight * exactScale;
    const left = Math.max(0, Math.floor((width - cropWidth) / 2));
    const top = Math.max(0, Math.floor((height - cropHeight) / 2));
    return [[left, top], [left + cropWidth, top + cropHeight]];
  }

  if (sourceRatio > targetRatio) {
    const cropWidth = Math.max(1, Math.round(height * targetRatio));
    const left = Math.max(0, Math.floor((width - cropWidth) / 2));
    return [[left, 0], [Math.min(width, left + cropWidth), height]];
  }

  const cropHeight = Math.max(1, Math.round(width / targetRatio));
  const top = Math.max(0, Math.floor((height - cropHeight) / 2));
  return [[0, top], [width, Math.min(height, top + cropHeight)]];
}

function buildImageCrops(asset) {
  const ratio = safeString(asset && asset.ratio);
  if (ratio === '4x5') {
    const crop = buildCenteredCrop(asset && asset.width, asset && asset.height, 4, 5);
    return crop ? { [FEED_FOUR_BY_FIVE_CROP_KEY]: crop } : undefined;
  }
  if (ratio === '9x16') {
    const crop = buildCenteredCrop(asset && asset.width, asset && asset.height, 9, 16);
    return crop ? { [VERTICAL_CROP_KEY]: crop } : undefined;
  }
  if (ratio === '2x1') {
    const crop = buildCenteredCrop(asset && asset.width, asset && asset.height, 191, 100);
    return crop ? { [HORIZONTAL_CROP_KEY]: crop } : undefined;
  }
  return undefined;
}

function buildSourceAssetFallback(job, preferredAd) {
  const sourceAds = safeArray(job.source_ads);
  const sourceAd =
    preferredAd ||
    sourceAds.find((ad) => safeString(ad && ad.id) === safeString(job.source_ad_id)) ||
    sourceAds[0] ||
    null;

  if (!sourceAd || !sourceAd.creative || typeof sourceAd.creative !== 'object') return null;

  const creative = sourceAd.creative;
  const assetImages = safeArray(creative.asset_feed_spec && creative.asset_feed_spec.images);
  const candidateFromAssetFeed = assetImages.find((image) =>
    Boolean(safeString(image && image.hash) || safeString(image && image.url))
  ) || null;

  const hash = safeString((candidateFromAssetFeed && candidateFromAssetFeed.hash) || creative.image_hash);
  const url = toHttps((candidateFromAssetFeed && candidateFromAssetFeed.url) || creative.image_url || creative.thumbnail_url);
  if (!hash && !url) return null;

  const preferredRatio = safeString(safeArray(job.required_ratios)[0]) || '3x4';

  return {
    ratio: preferredRatio,
    original_filename: safeString(sourceAd.name || job.source_ad_name || 'source_fallback'),
    source_file_id: safeString(sourceAd.id),
    source_file_name: safeString(sourceAd.name || job.source_ad_name || 'source_fallback'),
    hash,
    url,
  };
}

function buildMediaInventoryByRatio(job) {
  const inventory = new Map();
  const candidates = safeArray(job.media_inventory).length ? safeArray(job.media_inventory) : safeArray(job.imagens);

  for (const item of candidates) {
    const ratio = safeString(item.ratio || item.proporcao || detectRatio(item.name || item.original_name));
    if (!ratio || inventory.has(ratio)) continue;
    inventory.set(ratio, {
      id: safeString(item.id),
      name: safeString(item.name || item.original_name),
      binary_key: safeString(item.binary_key || `data_${ratio.replace(/[^a-zA-Z0-9]+/g, '_')}`),
    });
  }

  return inventory;
}

function buildDestinationAliases(destinationGroup) {
  const aliases = new Set();
  const normalized = normalizeKey(destinationGroup);
  const compact = normalizeCompactKey(destinationGroup);
  if (normalized) aliases.add(normalized);
  if (compact) aliases.add(compact);

  if (/BARRA.*SHOPPING.*SUL|BARRASHOPPINGSUL/i.test(normalized)) {
    aliases.add('BARRASHOPPINGSUL');
    aliases.add('BARRA_SHOPPING_SUL');
    aliases.add('BSS');
  }

  if (/NOVO.*HAMBURGO|NOVOHAMBURGO/i.test(normalized)) {
    aliases.add('NOVOHAMBURGO');
    aliases.add('NOVO_HAMBURGO');
    aliases.add('NH');
  }

  return [...aliases];
}

function normalizeNameSegment(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function buildCanonicalAdName(sourceAdName, destinationGroup, offerFingerprintTag) {
  const source = safeString(sourceAdName).replace(/\s*\[OFV1:[A-Z0-9]+\]/ig, '').trim();
  const destination = safeString(destinationGroup);
  const tag = safeString(offerFingerprintTag);

  if (!source) return [destination, tag].filter(Boolean).join(' ');
  if (!destination) return [source, tag].filter(Boolean).join(' ');

  const sourceParts = source
    .split('|')
    .map((part) => safeString(part))
    .filter(Boolean);

  if (!sourceParts.length) return [destination, tag].filter(Boolean).join(' ');

  const lastPart = sourceParts[sourceParts.length - 1];
  const canonical = normalizeNameSegment(lastPart) === normalizeNameSegment(destination)
    ? sourceParts.join(' | ')
    : [...sourceParts, destination].join(' | ');
  return [canonical, tag].filter(Boolean).join(' ').slice(0, 255);
}

function parseMetaTimestamp(value) {
  const raw = safeString(value);
  if (!raw) return NaN;
  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : NaN;
}

function isoFromMs(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function buildTemporalCandidateInfo(ad, freshnessCutoffMs) {
  const creative = ad && ad.creative && typeof ad.creative === 'object' ? ad.creative : {};
  const candidates = [
    { field: 'updated_time', value: safeString(ad && ad.updated_time), ms: parseMetaTimestamp(ad && ad.updated_time) },
    { field: 'created_time', value: safeString(ad && ad.created_time), ms: parseMetaTimestamp(ad && ad.created_time) },
    { field: 'creative.updated_time', value: safeString(creative.updated_time), ms: parseMetaTimestamp(creative.updated_time) },
    { field: 'creative.created_time', value: safeString(creative.created_time), ms: parseMetaTimestamp(creative.created_time) },
  ].filter((entry) => Number.isFinite(entry.ms));

  candidates.sort((left, right) => right.ms - left.ms);
  const latest = candidates[0] || null;
  const hasKnownTime = Boolean(latest);
  const isFresh = Boolean(hasKnownTime && latest.ms >= freshnessCutoffMs);

  return {
    created_time: safeString(ad && ad.created_time),
    updated_time: safeString(ad && ad.updated_time),
    creative_created_time: safeString(creative.created_time),
    creative_updated_time: safeString(creative.updated_time),
    candidate_last_mutation_field: latest ? latest.field : '',
    candidate_last_mutation_time: latest ? latest.value : '',
    candidate_last_mutation_iso: latest ? isoFromMs(latest.ms) : '',
    candidate_last_mutation_ms: latest ? latest.ms : null,
    has_known_time: hasKnownTime,
    is_fresh: isFresh,
    freshness_cutoff: isoFromMs(freshnessCutoffMs),
    freshness_window_days: TEMPORAL_GUARD_FRESH_DAYS,
  };
}

function compareRankedCandidates(left, right) {
  if (left.temporal.is_fresh !== right.temporal.is_fresh) return left.temporal.is_fresh ? 1 : -1;
  if (!left.temporal.is_fresh && left.temporal.has_known_time !== right.temporal.has_known_time) {
    return left.temporal.has_known_time ? -1 : 1;
  }

  const scoreDiff = right.score - left.score;
  if (scoreDiff) return scoreDiff;

  const leftTime = Number.isFinite(left.temporal.candidate_last_mutation_ms) ? left.temporal.candidate_last_mutation_ms : Number.MAX_SAFE_INTEGER;
  const rightTime = Number.isFinite(right.temporal.candidate_last_mutation_ms) ? right.temporal.candidate_last_mutation_ms : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function summarizeAd(ad, score, reasons, temporal) {
  const temporalInfo = temporal || buildTemporalCandidateInfo(ad, Date.now() - TEMPORAL_GUARD_FRESH_DAYS * 24 * 60 * 60 * 1000);
  return {
    ad_id: safeString(ad && ad.id),
    ad_name: safeString(ad && ad.name),
    adset_id: safeString(ad && ad.adset_id),
    campaign_id: safeString(ad && ad.campaign_id),
    page_id: safeString(ad && ad.creative && ad.creative.object_story_spec && ad.creative.object_story_spec.page_id),
    instagram_user_id: safeString(ad && ad.creative && ad.creative.object_story_spec && ad.creative.object_story_spec.instagram_user_id),
    created_time: temporalInfo.created_time,
    updated_time: temporalInfo.updated_time,
    creative_created_time: temporalInfo.creative_created_time,
    creative_updated_time: temporalInfo.creative_updated_time,
    candidate_last_mutation_time: temporalInfo.candidate_last_mutation_time,
    candidate_last_mutation_iso: temporalInfo.candidate_last_mutation_iso,
    temporal_has_known_time: temporalInfo.has_known_time,
    temporal_is_fresh: temporalInfo.is_fresh,
    score,
    reasons,
  };
}

function hasHardDestinationMismatch(ad, destinationMeta) {
  const adsetId = safeString(ad && ad.adset_id);
  const pageId = safeString(ad && ad.creative && ad.creative.object_story_spec && ad.creative.object_story_spec.page_id);
  const instagramUserId = safeString(ad && ad.creative && ad.creative.object_story_spec && ad.creative.object_story_spec.instagram_user_id);
  const destinationAdsetId = safeString(destinationMeta.destination_adset_id);
  const destinationPageId = safeString(destinationMeta.destination_page_id);
  const destinationInstagramUserId = safeString(destinationMeta.destination_instagram_user_id);

  return Boolean(
    (destinationAdsetId && adsetId && adsetId !== destinationAdsetId) ||
    (destinationPageId && pageId && pageId !== destinationPageId) ||
    (destinationInstagramUserId && instagramUserId && instagramUserId !== destinationInstagramUserId)
  );
}

function scoreSourceAdForDestination(ad, destinationMeta, aliases, preferredIds, temporalInfo) {
  const reasons = [];
  let score = 0;

  if (hasHardDestinationMismatch(ad, destinationMeta)) {
    return { score: 0, reasons: ['destination_id_mismatch'] };
  }

  const adId = safeString(ad && ad.id);
  const adsetId = safeString(ad && ad.adset_id);
  const campaignId = safeString(ad && ad.campaign_id);
  const pageId = safeString(ad && ad.creative && ad.creative.object_story_spec && ad.creative.object_story_spec.page_id);
  const instagramUserId = safeString(ad && ad.creative && ad.creative.object_story_spec && ad.creative.object_story_spec.instagram_user_id);
  const adNameKey = normalizeKey(ad && ad.name);
  const adNameCompact = normalizeCompactKey(ad && ad.name);

  if (preferredIds.has(adId)) {
    if (temporalInfo && temporalInfo.is_fresh) {
      reasons.push('selected_ad_id_fresh_ignored');
    } else {
      score += 500;
      reasons.push('selected_ad_id');
    }
  }

  if (adsetId && adsetId === safeString(destinationMeta.destination_adset_id)) {
    score += 1000;
    reasons.push('adset_id');
  }

  if (campaignId && campaignId === safeString(destinationMeta.destination_campaign_id)) {
    score += 220;
    reasons.push('campaign_id');
  }

  if (pageId && pageId === safeString(destinationMeta.destination_page_id)) {
    score += 160;
    reasons.push('page_id');
  }

  if (instagramUserId && instagramUserId === safeString(destinationMeta.destination_instagram_user_id)) {
    score += 160;
    reasons.push('instagram_user_id');
  }

  for (const alias of aliases) {
    if (!alias) continue;
    if (adNameKey.includes(alias) || adNameCompact.includes(alias.replace(/_/g, ''))) {
      score += 120;
      reasons.push(`alias:${alias}`);
      break;
    }
  }

  return {
    score,
    reasons,
  };
}

function createExpandedJobKey(parentJobKey, destinationMeta) {
  return [
    safeString(parentJobKey),
    normalizeKey(destinationMeta.destination_group || destinationMeta.destination_row_number || 'DEST')
  ].filter(Boolean).join('__');
}

function expandAssembledInputs(items, jobs) {
  const jobByKey = new Map(jobs.map((entry) => [safeString(entry.json && entry.json.job_key), entry.json || {}]));
  const assemblies = new Map();
  const expanded = [];

  for (const item of items) {
    const assembly = item.json || {};
    if (safeString(assembly.job_input_assembly_version) !== '2') {
      throw new Error('Build Jobs aceita somente itens produzidos por Assemble Job Inputs v2.');
    }
    const jobKey = safeString(assembly.job_key);
    const job = jobByKey.get(jobKey);
    if (!job) throw new Error(`Build Jobs recebeu assembly nao correlacionado; job_key=${jobKey || 'vazio'}.`);
    if (assemblies.has(jobKey)) throw new Error(`Build Jobs recebeu assembly duplicado para ${jobKey}.`);
    const envelope = asObject(assembly.media_upload_envelope);
    const ai = asObject(assembly.ai_output);
    if (safeString(envelope.media_upload_envelope_version) !== '2' || envelope.ready !== true) {
      throw new Error(`Envelope de midia invalido em ${jobKey}.`);
    }
    if (safeString(envelope.job_key) !== jobKey || safeString(envelope.group_key) !== safeString(job.group_key)) {
      throw new Error(`Envelope de midia diverge do Build Payload em ${jobKey}.`);
    }
    if (!Object.keys(asObject(ai.creative_override)).length) {
      throw new Error(`Assembly sem creative_override valido em ${jobKey}.`);
    }
    assemblies.set(jobKey, assembly);
    for (const receipt of [...safeArray(envelope.image_uploads), ...safeArray(envelope.video_uploads)]) {
      expanded.push({ json: deepClone(receipt) });
    }
    expanded.push({ json: deepClone(ai) });
  }

  for (const jobKey of jobByKey.keys()) {
    if (!assemblies.has(jobKey)) throw new Error(`Assembly ausente para ${jobKey}.`);
  }
  return expanded;
}

const assembledInputItems = $input.all();
const jobEntries = getBuildPayloadEntries();
const buildPayloadErrors = getBuildPayloadErrorEntries();

function persistedResumeJobs() {
  let restored = [];
  try { restored = $items('Restore Publish Groups') || []; } catch (error) { restored = []; }
  const jobs = restored.flatMap((item) => safeArray(item && item.json && item.json.resume_jobs));
  const unique = new Map();
  for (const job of jobs) {
    const key = safeString(job && job.job_key);
    if (key && !unique.has(key)) unique.set(key, deepClone(job));
  }
  return [...unique.values()];
}

const persistedJobs = persistedResumeJobs();
const resumeJobs = persistedJobs.filter((job) => {
  const row = asObject(job);
  const contract = asObject(row.destination_contract);
  const kind = safeString(contract.kind).toLowerCase();
  const linkUrl = primaryLinkFromCreativePayload(row.creativePayload);
  return safeString(row.workflow_contract_revision) === WORKFLOW_CONTRACT_REVISION &&
    (kind === 'website' || kind === 'whatsapp') &&
    Boolean(linkUrl) &&
    (kind !== 'whatsapp' || isWhatsAppHostname(linkUrl));
});
if (persistedJobs.length && !resumeJobs.length && !assembledInputItems.length) {
  throw new Error('Build Jobs recusou resume_jobs de revisao de contrato anterior sem entradas suficientes para reconstruir com seguranca.');
}
if (resumeJobs.length === persistedJobs.length && resumeJobs.length) {
  return resumeJobs.map((job) => ({ json: job }));
}

if (!jobEntries.length) {
  const rootError = buildPayloadErrors[0] && buildPayloadErrors[0].json ? buildPayloadErrors[0].json : null;
  return [{
    json: rootError
      ? {
          error: 'Build Payload falhou antes de gerar jobs.',
          upstream_node: 'Build Payload',
          upstream_error: safeString(rootError.error),
          upstream_debug: deepClone(rootError.debug || {}),
          debug: {
            input_count: assembledInputItems.length,
            build_payload_item_count: $('Build Payload').all().length,
          },
        }
      : {
          error: 'Nenhum job do Build Payload foi encontrado no input do Build Jobs.',
          debug: {
            input_count: assembledInputItems.length,
            build_payload_item_count: $('Build Payload').all().length,
          },
        },
  }];
}

const inputItems = expandAssembledInputs(assembledInputItems, jobEntries);
const fileToJob = buildFileToJob(jobEntries);
const uploadedByJob = buildUploadedByJob(inputItems, fileToJob);
const aiCorrelation = buildAiByJob(inputItems, jobEntries);
const aiByJob = aiCorrelation.aiByJob;
function buildDestinationClaimKey(destinationMeta) {
  return safeString(destinationMeta && destinationMeta.destination_adset_id) ||
    safeString(destinationMeta && destinationMeta.destination_campaign_id) ||
    normalizeKey(destinationMeta && destinationMeta.destination_group) ||
    'SEM_DESTINO';
}

const claimedReplacementAdIdsByDestination = new Map();

const outputs = [];

for (const entry of jobEntries) {
  const job = entry.json || {};
  const uploadedByAccount = uploadedByJob.get(job.job_key) || new Map();
  const ai = aiByJob.get(job.job_key) || {};
  const mediaInventoryByRatio = buildMediaInventoryByRatio(job);
  const baseWarnings = [];

  const rawDestinations = safeArray(job.destinations);
  if (!rawDestinations.length) {
    outputs.push({
      json: {
        error: 'Nenhum destino explicito foi encontrado para o grupo.',
        upstream_node: 'Build Jobs',
        upstream_error: 'destination_required',
        debug: { job_key: safeString(job.job_key) },
      },
    });
    continue;
  }

  const destinationsToProcess = rawDestinations;

  const resolvedDestinations = destinationsToProcess.map((destination) => ({
    destination_group: safeString(destination.destination_group),
    destination_row_number: safeString(destination.destination_row_number || destination.row_number),
    destination_campaign_id: safeString(destination.destination_campaign_id || destination.campaign_id),
    destination_ad_account_id: safeString(destination.destination_ad_account_id || destination.account_id),
    destination_page_id: safeString(destination.destination_page_id || destination.page_id),
    destination_instagram_user_id: safeString(destination.destination_instagram_user_id || destination.instagram_user_id),
    destination_adset_id: safeString(destination.destination_adset_id || destination.adset_id),
    destination_api_version: safeString(destination.destination_api_version || destination.api_version || 'v25.0'),
    token_id: safeString(destination.token_id),
    allowed_link_hosts: safeArray(destination.allowed_link_hosts),
    landing_pages_by_creative_group: deepClone(destination.landing_pages_by_creative_group || {}),
    landing_page_validation: deepClone(destination.landing_page_validation || {}),
    placement_eligibility: deepClone(destination.placement_eligibility || {}),
    freshness_window_days: Number(destination.freshness_window_days || TEMPORAL_GUARD_FRESH_DAYS),
    campaign_objective: safeString(destination.campaign_objective),
    optimization_goal: safeString(destination.optimization_goal),
    destination_type: safeString(destination.destination_type).toUpperCase(),
    whatsapp_destination_url: toHttps(destination.whatsapp_destination_url),
    config_revision: safeString(destination.config_revision || job.config_revision),
    destination_id_source: safeString(destination.destination_id_source || 'build_payload'),
    suffix_hint: safeString(destination.suffix_hint || job.suffix_hint),
  }));

  for (const destinationMeta of resolvedDestinations) {
    const aliases = buildDestinationAliases(destinationMeta.destination_group);
    const destinationClaimKey = buildDestinationClaimKey(destinationMeta);
    if (!claimedReplacementAdIdsByDestination.has(destinationClaimKey)) {
      claimedReplacementAdIdsByDestination.set(destinationClaimKey, new Set());
    }
    const claimedReplacementAdIds = claimedReplacementAdIdsByDestination.get(destinationClaimKey);
    const requestedReplaceExisting =
      safeString(job.action) === 'replace_existing' || Boolean(job.should_replace_existing);
    const mediaMode = normalizeMediaMode(job.media_mode, job);
    if (!['static_only', 'mixed', 'video_only'].includes(mediaMode)) {
      outputs.push({ json: { error: 'Modo de midia invalido.', upstream_node: 'Build Jobs', upstream_error: 'media_mode_invalid', debug: { job_key: safeString(job.job_key), media_mode: mediaMode } } });
      continue;
    }
    // A mixed logical group is materialized as two physical ads. Replacing one
    // old ad with both would be non-idempotent and can silently discard a media
    // variant, so this migration always creates separate ACTIVE ads. Static
    // replacement also needs a complete, deterministic commercial-offer
    // fingerprint. Missing evidence must create a new ad, never broaden the
    // candidate search back to campaign/product-only matches.
    const expectedOfferFingerprint = asObject(job.offer_fingerprint);
    const offerFingerprintTag = safeString(expectedOfferFingerprint.tag).toUpperCase();
    const offerFingerprintReplacementEligible =
      expectedOfferFingerprint.replacement_eligible === true &&
      /^OFV1:[A-Z0-9]+$/.test(offerFingerprintTag);
    const shouldReplaceExisting =
      requestedReplaceExisting && mediaMode === 'static_only' && offerFingerprintReplacementEligible;

    const preferredIds = new Set(
      shouldReplaceExisting
        ? uniqueStrings(safeArray(job.selected_ad_ids))
        : []
    );
    const matchedScoreByAdId = new Map(
      safeArray(job.matched_ads)
        .map((item) => [safeString(item && item.ad_id), Number(item && item.score) || 0])
        .filter(([adId]) => Boolean(adId))
    );
    const matchedIds = new Set([...matchedScoreByAdId.keys()]);
    const offerMatchStatusByAdId = new Map(
      safeArray(job.matched_ads)
        .map((item) => [safeString(item && item.ad_id), safeString(item && item.offer_match_status)])
        .filter(([adId]) => Boolean(adId))
    );

    const inRunClaimExcludedAdIds = shouldReplaceExisting
      ? uniqueStrings(safeArray(job.source_ads).map((ad) => safeString(ad && ad.id)).filter((adId) => claimedReplacementAdIds.has(adId)))
      : [];

    const offerExcludedCandidateIds = shouldReplaceExisting
      ? uniqueStrings(safeArray(job.source_ads)
          .map((ad) => safeString(ad && ad.id))
          .filter((adId) => adId && offerMatchStatusByAdId.get(adId) !== 'exact'))
      : [];

    const candidateSourceAds = shouldReplaceExisting
      ? safeArray(job.source_ads).filter((ad) => {
          const adId = safeString(ad && ad.id);
          if (claimedReplacementAdIds.has(adId)) return false;
          // Build Payload is the only component allowed to prove offer
          // equivalence. A source ad cannot become replaceable merely because
          // it shares a campaign, destination, product, or legacy job_key.
          if (offerMatchStatusByAdId.get(adId) !== 'exact') return false;
          return preferredIds.has(adId) || matchedIds.has(adId);
        })
      : [];

    const freshnessWindowDays = Math.max(1, Math.min(90, Number(destinationMeta.freshness_window_days || TEMPORAL_GUARD_FRESH_DAYS)));
    const freshnessCutoffMs = Date.now() - freshnessWindowDays * 24 * 60 * 60 * 1000;
    const rankedCandidates = shouldReplaceExisting
      ? candidateSourceAds
          .map((ad) => {
            const temporal = buildTemporalCandidateInfo(ad, freshnessCutoffMs);
            const scored = scoreSourceAdForDestination(ad, destinationMeta, aliases, preferredIds, temporal);
            const matchScore = Number(matchedScoreByAdId.get(safeString(ad && ad.id)) || 0);
            if (matchScore > 0) {
              scored.score += Math.min(matchScore, 750);
              scored.reasons.push('match_score:' + matchScore);
            }
            if (temporal.is_fresh) {
              scored.reasons.push('temporal_guard:fresh_candidate_excluded');
            } else if (!temporal.has_known_time) {
              scored.reasons.push('temporal_guard:unknown_time_fallback');
            } else {
              scored.reasons.push('temporal_guard:past_candidate');
            }
            return {
              ad,
              temporal,
              ...scored,
            };
          })
          .filter((entry) => entry.score > 0)
          .sort(compareRankedCandidates)
      : [];

    const knownPastCandidates = rankedCandidates.filter((entry) => !entry.temporal.is_fresh && entry.temporal.has_known_time);
    const unknownTimeFallbackCandidates = rankedCandidates.filter((entry) => !entry.temporal.is_fresh && !entry.temporal.has_known_time);
    const freshCandidates = rankedCandidates.filter((entry) => entry.temporal.is_fresh);
    const eligibleCandidates = knownPastCandidates.length ? knownPastCandidates : unknownTimeFallbackCandidates;
    const chosenEntry = shouldReplaceExisting && eligibleCandidates[0]
      ? eligibleCandidates[0]
      : null;
    const chosenAd = chosenEntry ? chosenEntry.ad : null;
    const temporalGuard = {
      freshness_window_days: freshnessWindowDays,
      freshness_cutoff: isoFromMs(freshnessCutoffMs),
      candidate_count: rankedCandidates.length,
      eligible_past_candidate_count: eligibleCandidates.length,
      known_past_candidate_count: knownPastCandidates.length,
      unknown_time_fallback_candidate_count: unknownTimeFallbackCandidates.length,
      fresh_candidate_count: freshCandidates.length,
      excluded_fresh_candidate_ids: freshCandidates.map((entry) => safeString(entry.ad && entry.ad.id)).filter(Boolean),
      chosen_ad_id: safeString(chosenAd && chosenAd.id),
      chosen_ad_name: safeString(chosenAd && chosenAd.name),
      candidate_last_mutation_time: chosenEntry ? chosenEntry.temporal.candidate_last_mutation_time : '',
      candidate_last_mutation_iso: chosenEntry ? chosenEntry.temporal.candidate_last_mutation_iso : '',
      reason: !offerFingerprintReplacementEligible
        ? 'offer_fingerprint_unverified'
        : chosenEntry
        ? (chosenEntry.temporal.has_known_time ? 'past_candidate_selected' : 'unknown_time_fallback_selected')
        : (freshCandidates.length ? 'all_matching_candidates_are_fresh' : 'no_matching_candidate'),
    };

    // A requested replacement only proceeds when an unambiguous, old target
    // exists. Recent candidates and an empty match set are both normal reasons
    // to create a separate ad in the configured ad set, never to block a valid
    // publication batch or overwrite a protected ad.
    const replacementFallsBackToNewAd = requestedReplaceExisting && !chosenAd;
    const temporalGuardRequiresNewAd = replacementFallsBackToNewAd && freshCandidates.length > 0;

    const action = shouldReplaceExisting && !replacementFallsBackToNewAd
      ? 'replace_existing'
      : 'create_new';

    const offerReplacementGuard = {
      required: true,
      requested_replace_existing: requestedReplaceExisting,
      expected_status: safeString(expectedOfferFingerprint.status || (offerFingerprintReplacementEligible ? 'verified' : 'unverified')),
      expected_tag: offerFingerprintTag,
      replacement_eligible: offerFingerprintReplacementEligible,
      exact_candidate_count: candidateSourceAds.length,
      excluded_candidate_ids: offerExcludedCandidateIds,
      selected_candidate_offer_match_status: chosenAd
        ? safeString(offerMatchStatusByAdId.get(safeString(chosenAd.id)))
        : '',
      reason: action === 'replace_existing'
        ? 'exact_eligible_candidate_selected'
        : (!offerFingerprintReplacementEligible
          ? 'offer_fingerprint_unverified'
          : (freshCandidates.length ? 'all_exact_candidates_are_fresh' : 'offer_fingerprint_mismatch')),
    };

    let scopedReplacementPlan = action === 'replace_existing'
      ? safeArray(job.replacement_plan).filter((item) =>
          safeString(item.ad_id) === safeString(chosenAd && chosenAd.id)
        )
      : [];

    if (action === 'replace_existing' && !scopedReplacementPlan.length && chosenAd) {
      scopedReplacementPlan = buildReplacementPlanForAd(chosenAd, mediaInventoryByRatio);
    }

    if (action === 'replace_existing' && !scopedReplacementPlan.length) {
      outputs.push({
        json: {
          error: 'replace_existing foi bloqueado porque o plano de substituicao nao pode ser construido com seguranca.',
          upstream_node: 'Build Jobs',
          upstream_error: 'replacement_plan_missing',
          debug: {
            job_key: safeString(job.job_key),
            destination_group: safeString(destinationMeta.destination_group),
            chosen_ad_id: safeString(chosenAd && chosenAd.id),
          },
        },
      });
      continue;
    }

    const chosenScore = chosenEntry ? chosenEntry.score : 0;
    const chosenReasons = chosenEntry ? chosenEntry.reasons : [];

    const warnings = [];
    const resolvedAdsetId = safeString(destinationMeta.destination_adset_id);
    const resolvedSourceAdId = action === 'replace_existing'
      ? safeString(chosenAd && chosenAd.id)
      : '';
    const resolvedApiVersion = safeString(destinationMeta.destination_api_version || 'v25.0');
    const resolvedAccountId = safeString(destinationMeta.destination_ad_account_id);
    const resolvedPageId = safeString(destinationMeta.destination_page_id);
    const resolvedInstagramUserId = safeString(destinationMeta.destination_instagram_user_id);
    const resolvedCampaignId = safeString(destinationMeta.destination_campaign_id);
    const gatewayConfig = metaConfigForDestination(destinationMeta);
    const resolvedTokenId = safeString(destinationMeta.token_id || gatewayConfig && gatewayConfig.token_id);
    const uploaded = uploadedByAccount.get(resolvedAccountId) || {};
    const orderedAssets = buildOrderedAssets(job, uploaded).filter(hasCreativeAsset);
    const requiresVideo = mediaMode === 'mixed' || mediaMode === 'video_only';
    const requiresStaticImages = mediaMode === 'mixed' || mediaMode === 'static_only';
    const uploadedVideo = asObject(uploaded.vertical_video);
    const uploadedVideoThumbnail = asObject(uploaded.vertical_video_thumbnail);
    if (requiresStaticImages && (orderedAssets.length !== safeArray(job.required_ratios).length || orderedAssets.length < 3)) {
      outputs.push({
        json: {
          error: 'Upload gateway incompleto ou sem correlacao estrita por nome, ratio e conta.',
          upstream_node: 'Build Jobs',
          upstream_error: 'strict_upload_mapping_failed',
          debug: {
            job_key: safeString(job.job_key),
            account_id: resolvedAccountId,
            required_ratios: deepClone(job.required_ratios || []),
            resolved_ratios: orderedAssets.map((asset) => safeString(asset.ratio)),
          },
        },
      });
      continue;
    }
    if (requiresVideo && (!safeString(uploadedVideo.video_id) || uploadedVideo.ready !== true || safeString(uploadedVideo.video_status) !== 'ready' || !safeString(uploadedVideoThumbnail.hash))) {
      outputs.push({
        json: {
          error: 'Upload de video ou miniatura incompleto antes da criacao do creative.',
          upstream_node: 'Build Jobs',
          upstream_error: 'strict_video_upload_mapping_failed',
          debug: {
            job_key: safeString(job.job_key), account_id: resolvedAccountId,
            video_id: safeString(uploadedVideo.video_id), video_status: safeString(uploadedVideo.video_status),
            video_ready: uploadedVideo.ready === true, thumbnail_hash_present: Boolean(safeString(uploadedVideoThumbnail.hash)),
          },
        },
      });
      continue;
    }
    if (!requiresStaticImages && orderedAssets.length) {
      outputs.push({ json: { error: 'Video unico nao pode carregar imagens estaticas no mesmo job.', upstream_node: 'Build Jobs', upstream_error: 'video_only_contains_images', debug: { job_key: safeString(job.job_key), image_count: orderedAssets.length } } });
      continue;
    }

    if (!orderedAssets.length) warnings.push('Nenhum asset enviado foi associado a este job.');
    if (!resolvedAccountId) warnings.push('destination_ad_account_id ausente.');
    if (!resolvedPageId) warnings.push('destination_page_id ausente.');
    if (!resolvedCampaignId) warnings.push('destination_campaign_id ausente.');
    if (!resolvedApiVersion) warnings.push('destination_api_version ausente.');
    if (!resolvedTokenId) warnings.push('token_id opaco do gateway ausente para o destino.');
    if (action === 'create_new' && !resolvedAdsetId) warnings.push(`Job ${job.job_key} sem destination_adset_id para create_new.`);
    if (action === 'replace_existing' && !resolvedSourceAdId) warnings.push('source_ad_id ausente para replace_existing.');
    if (temporalGuardRequiresNewAd) warnings.push(`Janela de ${freshnessWindowDays} dias protegeu ${freshCandidates.length} anuncio(s) recente(s); sera criado um novo anuncio ACTIVE sem substituir os existentes.`);
    if (replacementFallsBackToNewAd && !temporalGuardRequiresNewAd) warnings.push(`Nenhum candidato com oferta comercial comprovadamente identica foi localizado para substituicao; sera criado um novo anuncio ACTIVE sem substituir anuncios existentes.`);
    if (requestedReplaceExisting && !offerFingerprintReplacementEligible) warnings.push('replace_existing foi convertido para create_new ACTIVE porque a oferta comercial nao possui fingerprint comprovado.');
    else if (requestedReplaceExisting && !shouldReplaceExisting) warnings.push('replace_existing foi convertido para create_new ACTIVE porque o grupo possui video; os anuncios fisicos precisam permanecer distintos.');

    const overrides = deepClone(ai.creative_override || {});
    const analysis = deepClone(ai.analysis || {});
    const videoFrame = deepClone(ai.video_frame || {
      bestTimestamp: '',
      bestTimestampSeconds: 0,
      selectedFrameUrl: '',
      selectedFrameRank: 0,
      reason: '',
      confidence: 0,
      candidates: [],
    });

    const aiBodies = normalizeTextAssets(overrides.bodies, 5);
    const aiTitles = normalizeTextAssets(overrides.titles, 5);
    const aiDescriptions = normalizeTextAssets(overrides.descriptions, 1);

    const aiCorrelationConflict = aiCorrelation.diagnostics.conflicting_job_keys.includes(safeString(job.job_key));
    const aiOutputUnmapped = !aiByJob.has(job.job_key) && aiCorrelation.diagnostics.unmapped_candidate_count > 0;
    if (aiCorrelationConflict || aiOutputUnmapped || !aiByJob.has(job.job_key) || aiBodies.length !== 5 || aiTitles.length !== 5 || aiDescriptions.length !== 1) {
      const upstreamError = aiCorrelationConflict
        ? 'ai_output_conflict'
        : aiOutputUnmapped
          ? 'ai_output_unmapped'
          : 'ai_copy_contract_failed';
      outputs.push({
        json: {
          error: upstreamError === 'ai_output_unmapped'
            ? 'A resposta estruturada da IA nao pode ser correlacionada com seguranca ao job.'
            : upstreamError === 'ai_output_conflict'
              ? 'Mais de uma resposta estruturada da IA foi correlacionada ao mesmo job.'
              : 'A saida estruturada da IA nao atende ao contrato exato de 5 bodies, 5 titles e 1 description.',
          upstream_node: 'Build Jobs',
          upstream_error: upstreamError,
          debug: {
            job_key: safeString(job.job_key),
            ai_output_found: aiByJob.has(job.job_key),
            body_count: aiBodies.length,
            title_count: aiTitles.length,
            description_count: aiDescriptions.length,
            ai_candidate_count: aiCorrelation.diagnostics.candidate_count,
            ai_unmapped_candidate_count: aiCorrelation.diagnostics.unmapped_candidate_count,
            ai_conflicting_job_keys: deepClone(aiCorrelation.diagnostics.conflicting_job_keys),
          },
        },
      });
      continue;
    }

    const destinationContract = resolveDestinationContract(job, destinationMeta);
    if (!destinationContract.ok) {
      outputs.push({
        json: {
          error: 'O contrato de destino do ad set nao foi comprovado; lote bloqueado antes de qualquer mutacao Meta.',
          upstream_node: 'Build Jobs',
          upstream_error: destinationContract.error,
          debug: {
            job_key: safeString(job.job_key),
            destination_group: safeString(destinationMeta.destination_group),
            destination_adset_id_present: Boolean(safeString(destinationMeta.destination_adset_id)),
            configured_kind: safeString(destinationContract.configured_kind),
            observed_kinds: deepClone(destinationContract.observed_kinds || []),
          },
        },
      });
      continue;
    }
    const usesWhatsAppDestination = destinationContract.kind === 'whatsapp';
    const ctaTypes = [usesWhatsAppDestination ? WHATSAPP_CTA_TYPE : DEFAULT_CTA_TYPE];
    const requestedRawSiteLinks = safeArray(overrides.site_links || overrides.siteLinks || ai.site_links || ai.siteLinks);
    const allowedLinkHosts = safeArray(destinationMeta.allowed_link_hosts || gatewayConfig && gatewayConfig.allowed_link_hosts);
    const siteLinks = normalizeSiteLinks(requestedRawSiteLinks);
    const rejectedSiteLinks = siteLinks.filter((link) => !isAllowedLinkUrl(link.url, allowedLinkHosts));
    if (rejectedSiteLinks.length) {
      outputs.push({
        json: {
          error: 'A IA retornou site_links fora da allowlist de hosts.',
          upstream_node: 'Build Jobs',
          upstream_error: 'site_link_host_not_allowed',
          debug: { job_key: safeString(job.job_key), rejected_count: rejectedSiteLinks.length },
        },
      });
      continue;
    }
    if (requestedRawSiteLinks.length && siteLinks.length < ADVANTAGE_PLUS_SITE_LINKS_MIN) {
      warnings.push('Advantage+ site links recebidos da IA, mas menos de 2 links HTTPS validos restaram apos a sanitizacao; site_extensions sera omitido.');
    }
    if (requestedRawSiteLinks.length > ADVANTAGE_PLUS_SITE_LINKS_MAX) {
      warnings.push('Advantage+ site links acima do limite; apenas os 4 primeiros links validos serao considerados.');
    }

    const sourceAdName = safeString(
      job.source_ad_name_base ||
      job.source_ad_name ||
      ai.source_ad_name ||
      job.nome_base ||
      (action === 'replace_existing' && chosenAd && chosenAd.name) ||
      'Duplicated Ad'
    );
    const finalAdName = buildCanonicalAdName(sourceAdName, destinationMeta.destination_group, offerFingerprintTag);

    const normalizedBodies = aiBodies;
    const normalizedTitles = aiTitles;
    const normalizedDescriptions = aiDescriptions;

    const creativeGroupKey = safeString(job.creative_group_key || job.group_key);
    const landingPage = resolveLandingPage(destinationMeta, gatewayConfig, creativeGroupKey, allowedLinkHosts);
    if (!landingPage.ok) {
      outputs.push({
        json: {
          error: 'A landing page especifica da campanha nao esta pronta no Token Vault.',
          upstream_node: 'Build Jobs',
          upstream_error: landingPage.error,
          debug: {
            job_key: safeString(job.job_key),
            creative_group_key: creativeGroupKey,
            destination_group: safeString(destinationMeta.destination_group),
            configured_keys: landingPage.configured_keys || [],
            rejected_hostname: landingPage.rejected_hostname || '',
          },
        },
      });
      continue;
    }

    const schedulingLandingPageUrl = landingPage.url;
    const primaryLinkUrl = usesWhatsAppDestination ? destinationContract.link_url : schedulingLandingPageUrl;
    const safeLinkUrls = [{ website_url: primaryLinkUrl }];
    const adMutationPayload = {
      name: finalAdName || sourceAdName,
      status: DEFAULT_AD_STATUS,
      creative: {
        creative_id: '',
      },
      ...(resolvedAdsetId ? { adset_id: resolvedAdsetId } : {}),
    };
    const useFlexibleCreative = orderedAssets.length >= 3;

    const imageLabels = orderedAssets.map((asset) => ({ name: asset.ratio === '2x1' ? 'banner_image' : asset.ratio === '9x16' ? 'vertical_image' : 'feed_image' }));
    const videoLabel = { name: 'vertical_video' };
    const bodyRuleLabels = orderedAssets.map((asset, index) => createLabel(sourceAdName + '_' + asset.ratio, 'body_rule', index + 1));
    const titleRuleLabels = orderedAssets.map((asset, index) => createLabel(sourceAdName + '_' + asset.ratio, 'title_rule', index + 1));

    const imageAssets = orderedAssets.map((asset, index) => ({
      hash: safeString(asset.hash) || undefined,
      url: safeString(asset.hash) ? undefined : toHttps(asset.url),
      image_crops: buildImageCrops(asset),
      adlabels: [imageLabels[index]],
    }));

    const verticalAsset = orderedAssets.find((asset) => safeString(asset && asset.ratio) === '9x16');
    if (verticalAsset && !buildImageCrops(verticalAsset)) {
      outputs.push({
        json: {
          error: 'A arte vertical nao possui dimensoes validas para calcular o corte recomendado 9:16.',
          upstream_node: 'Build Jobs',
          upstream_error: 'vertical_crop_dimensions_missing',
          debug: {
            job_key: safeString(job.job_key),
            ratio: '9x16',
            width_present: Number(verticalAsset.width) > 0,
            height_present: Number(verticalAsset.height) > 0,
          },
        },
      });
      continue;
    }

    const horizontalAsset = orderedAssets.find((asset) => safeString(asset && asset.ratio) === '2x1');
    if (horizontalAsset && !buildImageCrops(horizontalAsset)) {
      outputs.push({
        json: {
          error: 'A arte horizontal nao possui dimensoes validas para calcular o corte recomendado 1,91:1.',
          upstream_node: 'Build Jobs',
          upstream_error: 'horizontal_crop_dimensions_missing',
          debug: {
            job_key: safeString(job.job_key),
            ratio: '2x1',
            meta_crop_key: HORIZONTAL_CROP_KEY,
            width_present: Number(horizontalAsset.width) > 0,
            height_present: Number(horizontalAsset.height) > 0,
          },
        },
      });
      continue;
    }

    const bodyAssets = normalizedBodies.map((asset) => ({
      text: safeString(asset.text),
      adlabels: bodyRuleLabels,
    }));

    const titleAssets = normalizedTitles.map((asset) => ({
      text: safeString(asset.text).slice(0, 80),
      adlabels: titleRuleLabels,
    }));

    const descriptionAssets = normalizedDescriptions.map((asset) => ({
      text: safeString(asset.text),
    }));

    const feedIndex = orderedAssets.findIndex((asset) => !['2x1', '9x16'].includes(asset.ratio));
    const bannerIndex = orderedAssets.findIndex((asset) => asset.ratio === '2x1');
    const verticalIndex = orderedAssets.findIndex((asset) => asset.ratio === '9x16');
    const placementRules = [
      {
        customization_spec: { publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['feed', 'marketplace'], instagram_positions: ['stream', 'explore'] },
        image_label: imageLabels[feedIndex], body_label: bodyRuleLabels[feedIndex], title_label: titleRuleLabels[feedIndex], priority: 1,
      },
      {
        customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['search'] },
        image_label: imageLabels[bannerIndex], body_label: bodyRuleLabels[bannerIndex], title_label: titleRuleLabels[bannerIndex], priority: 2,
      },
      {
        customization_spec: { publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['story', 'facebook_reels'], instagram_positions: ['story', 'reels'] },
        image_label: imageLabels[verticalIndex],
        body_label: bodyRuleLabels[verticalIndex], title_label: titleRuleLabels[verticalIndex], priority: 3,
      },
    ];

    const advantagePlusRequest = buildAdvantagePlusRequest({
      apiVersion: resolvedApiVersion,
      siteLinks,
      musicEligible: isMusicEligible(destinationMeta.placement_eligibility),
      pacEligible: orderedAssets.length > 1 && placementRules.length > 1,
    });

    const creativeRootExtras = removeEmptyFields({
      degrees_of_freedom_spec: {
        creative_features_spec: deepClone(advantagePlusRequest.creativeFeaturesSpec),
      },
      creative_sourcing_spec: deepClone(advantagePlusRequest.creativeSourcingSpec),
    });

    const staticCreativePayload = useFlexibleCreative
      ? removeEmptyFields({
          name: finalAdName || sourceAdName,
          object_story_spec: {
            page_id: String(resolvedPageId),
            instagram_user_id: resolvedInstagramUserId ? String(resolvedInstagramUserId) : undefined,
          },
          asset_feed_spec: {
            ad_formats: ['SINGLE_IMAGE'],
            optimization_type: 'PLACEMENT',
            images: imageAssets,
            bodies: bodyAssets,
            titles: titleAssets,
            descriptions: descriptionAssets,
            link_urls: safeLinkUrls,
            call_to_action_types: ctaTypes,
            asset_customization_rules: placementRules,
          },
          ...creativeRootExtras,
        })
      : removeEmptyFields({
          name: finalAdName || sourceAdName,
          object_story_spec: {
            page_id: String(resolvedPageId),
            instagram_user_id: resolvedInstagramUserId ? String(resolvedInstagramUserId) : undefined,
            link_data: {
              link: primaryLinkUrl,
              message: safeString(bodyAssets[0] && bodyAssets[0].text),
              name: safeString(titleAssets[0] && titleAssets[0].text).slice(0, 80),
              description: safeString(descriptionAssets[0] && descriptionAssets[0].text),
              image_hash: safeString(imageAssets[0] && imageAssets[0].hash) || undefined,
              picture: safeString(imageAssets[0] && imageAssets[0].hash)
                ? undefined
                : toHttps(orderedAssets[0] && orderedAssets[0].url),
              call_to_action: {
                type: ctaTypes[0] || DEFAULT_CTA_TYPE,
                value: { link: primaryLinkUrl },
              },
            },
          },
          ...creativeRootExtras,
        });

    const videoCreativePayload = requiresVideo ? removeEmptyFields({
      name: `${finalAdName || sourceAdName} [VIDEO]`,
      object_story_spec: {
        page_id: String(resolvedPageId),
        instagram_user_id: resolvedInstagramUserId ? String(resolvedInstagramUserId) : undefined,
        video_data: {
          video_id: safeString(uploadedVideo.video_id),
          image_hash: safeString(uploadedVideoThumbnail.hash),
          message: safeString(bodyAssets[0] && bodyAssets[0].text),
          title: safeString(titleAssets[0] && titleAssets[0].text).slice(0, 80),
          call_to_action: {
            type: ctaTypes[0] || DEFAULT_CTA_TYPE,
            value: { link: primaryLinkUrl },
          },
        },
      },
      // Meta accepts a video creative through object_story_spec.video_data.
      // Do not attach the image-only Advantage+ asset-feed configuration here.
    }) : null;

    const creativeVariants = [
      ...(requiresStaticImages ? [{
        media_variant: 'static_flexible',
        name_suffix: '[STATIC]',
        creativePayload: staticCreativePayload,
        assetIds: Object.fromEntries(orderedAssets.map((asset) => [asset.ratio, safeString(asset.source_file_id)])),
        assetNames: Object.fromEntries(orderedAssets.map((asset) => [asset.ratio, safeString(asset.source_file_name || asset.original_filename)])),
        assetHashes: Object.fromEntries(orderedAssets.map((asset) => [asset.ratio, safeString(asset.hash)])),
        assetUrls: Object.fromEntries(orderedAssets.map((asset) => [asset.ratio, toHttps(asset.url)])),
        orderedRatios: orderedAssets.map((asset) => safeString(asset.ratio)),
        requiredMediaRoles: ['feed_image', 'banner_image', 'vertical_image'],
        advantagePlusEnabled: true,
      }] : []),
      ...(requiresVideo ? [{
        media_variant: 'video_single',
        name_suffix: '[VIDEO]',
        creativePayload: videoCreativePayload,
        assetIds: Object.fromEntries(safeArray(job.videos).map((video) => ['vertical_video', safeString(video.id)])),
        assetNames: Object.fromEntries(safeArray(job.videos).map((video) => ['vertical_video', safeString(video.original_name || video.name)])),
        assetHashes: { vertical_video: safeString(uploadedVideo.video_id), vertical_video_thumbnail: safeString(uploadedVideoThumbnail.hash) },
        assetUrls: {},
        orderedRatios: ['9x16_video'],
        requiredMediaRoles: ['vertical_video'],
        advantagePlusEnabled: false,
      }] : []),
    ];

    const readyToCreateCreative = Boolean(
      resolvedTokenId &&
      resolvedAccountId &&
      resolvedPageId &&
      resolvedApiVersion &&
      (requiresStaticImages ? orderedAssets.length : safeString(uploadedVideo.video_id))
    );

    const readyToCreateAd = action === 'create_new'
      ? Boolean(resolvedTokenId && resolvedAccountId && resolvedAdsetId && resolvedApiVersion && (requiresStaticImages ? orderedAssets.length : safeString(uploadedVideo.video_id)))
      : false;

    const readyToReplaceAd = Boolean(resolvedTokenId && action === 'replace_existing' && resolvedSourceAdId && resolvedApiVersion && orderedAssets.length);

    if (readyToReplaceAd) {
      claimedReplacementAdIds.add(resolvedSourceAdId);
    }

    for (const variant of creativeVariants) {
      const variantAdName = `${finalAdName || sourceAdName} ${variant.name_suffix}`.slice(0, 255);
      const variantAdPayload = { ...adMutationPayload, name: variantAdName };
      const reportedAdvantage = variant.advantagePlusEnabled ? advantagePlusRequest : {
        desiredFeatures: [], requestedFeatures: [], eligibleFeatures: [],
        skippedFeatures: ['video_single_creative_no_asset_feed_advantage_plus'],
        skipReasons: { video_single_creative_no_asset_feed_advantage_plus: 'O creative de video usa object_story_spec.video_data, sem asset_feed_spec.' },
        featureKeyMode: 'not_applicable_video_single', siteLinks: [], siteLinksEligible: false,
        featureGroups: { main: [], essential: [], supplemental: [] },
      };
      if (variant.media_variant === 'static_flexible') variant.creativePayload.name = variantAdName;
      outputs.push({
      json: {
        parent_job_key: safeString(job.job_key),
        job_key: `${createExpandedJobKey(job.job_key, destinationMeta)}:${variant.media_variant}`,

        action,
        match_status: action === 'replace_existing'
          ? 'destination_replace'
          : (temporalGuardRequiresNewAd
            ? 'temporal_guard_create_new'
            : (replacementFallsBackToNewAd
              ? (offerFingerprintReplacementEligible ? 'offer_fingerprint_create_new' : 'offer_fingerprint_unverified_create_new')
              : safeString(job.match_status || 'no_match'))),
        should_create_new_ad: action === 'create_new',
        should_replace_existing: action === 'replace_existing',

        source_ad_id: resolvedSourceAdId,
        source_ad_name: sourceAdName,
        source_ad_texts: deepClone(job.source_ad_texts || {}),

        group_key: safeString(job.group_key),
        offer_group_key: safeString(job.offer_group_key || job.offer_key || job.group_key),
        creative_group_key: safeString(job.creative_group_key || job.group_key),
        logical_creative_group_key: safeString(job.creative_group_key || job.group_key),
        media_mode: mediaMode,
        media_variant: variant.media_variant,
        grouping_discriminator: safeString(job.grouping_discriminator),
        grouping_strategy: safeString(job.grouping_strategy),
        nome_base: safeString(job.nome_base),
        product_key: safeString(job.product_key),
        suffix_hint: safeString(job.suffix_hint),
        offer_fingerprint: deepClone(expectedOfferFingerprint),
        offer_replacement_guard: deepClone(offerReplacementGuard),

        analysis,
        video_frame: videoFrame,

        destination_group: safeString(destinationMeta.destination_group),
        destination_row_number: safeString(destinationMeta.destination_row_number),
        destination_campaign_id: resolvedCampaignId,
        destination_ad_account_id: resolvedAccountId,
        destination_page_id: resolvedPageId,
        destination_instagram_user_id: resolvedInstagramUserId,
        destination_adset_id: resolvedAdsetId,
        destination_api_version: resolvedApiVersion,
        destination_id_source: safeString(destinationMeta.destination_id_source),

        destination_meta: deepClone(destinationMeta),
        destinations: [deepClone(destinationMeta)],
        all_destinations: deepClone(resolvedDestinations),

        account_id: safeString(resolvedAccountId),
        api_version: safeString(resolvedApiVersion),
        page_id: safeString(resolvedPageId),
        instagram_user_id: safeString(resolvedInstagramUserId),
        row_number: safeString(destinationMeta.destination_row_number),
        token_id: resolvedTokenId,
        run_id: safeString(job.run_id),
        batch_fingerprint: safeString(job.batch_fingerprint),
        workflow_contract_revision: WORKFLOW_CONTRACT_REVISION,
        config_revision: safeString(destinationMeta.config_revision || job.config_revision),
        allowed_link_hosts: deepClone(allowedLinkHosts),
        landing_page_url: primaryLinkUrl,
        scheduling_landing_page_url: schedulingLandingPageUrl,
        destination_mode: usesWhatsAppDestination
          ? (action === 'replace_existing' ? 'whatsapp_message_preserved_from_source_ad' : 'whatsapp_message_inferred_from_adset')
          : 'website_leads',
        destination_contract: publicDestinationContract(destinationContract),
        landing_page_source: landingPage.source,
        landing_page_configured_key: landingPage.configured_key,
        desired_final_status: DEFAULT_AD_STATUS,

        creativePayload: variant.creativePayload,
        advantage_plus_request: {
          desired_features: deepClone(reportedAdvantage.desiredFeatures),
          requested_features: deepClone(reportedAdvantage.requestedFeatures),
          eligible_features: deepClone(reportedAdvantage.eligibleFeatures),
          skipped_features: deepClone(reportedAdvantage.skippedFeatures),
          skip_reasons: deepClone(reportedAdvantage.skipReasons),
          feature_key_mode: safeString(reportedAdvantage.featureKeyMode),
          site_links: deepClone(reportedAdvantage.siteLinks),
          site_extensions_enabled: Boolean(reportedAdvantage.siteLinksEligible),
          landing_page_source: landingPage.source,
          requested_at_api_version: resolvedApiVersion,
          feature_groups: deepClone(reportedAdvantage.featureGroups),
        },
        advantage_plus_feature_groups: deepClone(reportedAdvantage.featureGroups),
        advantage_plus_effective_report: {
          status: 'pending_graph_readback',
          evidence_source: 'request_only',
          main: deepClone(reportedAdvantage.featureGroups.main),
          essential: deepClone(reportedAdvantage.featureGroups.essential),
          supplemental: deepClone(reportedAdvantage.featureGroups.supplemental),
          graph_acknowledged_features: [],
          ui_confirmed_features: [],
          rejected_features: [],
          ineligible_features: deepClone(reportedAdvantage.skippedFeatures),
          ui_confirmation_required: true,
        },
        advantage_plus_requested_features: deepClone(reportedAdvantage.requestedFeatures),
        advantage_plus_eligible_features: deepClone(reportedAdvantage.eligibleFeatures),
        advantage_plus_skipped_features: deepClone(reportedAdvantage.skippedFeatures),
        advantage_plus_skip_reasons: deepClone(reportedAdvantage.skipReasons),
        advantage_plus_final_features: deepClone(reportedAdvantage.requestedFeatures),
        advantage_plus_applied_features: [],
        advantage_plus_removed_features: [],
        advantage_plus_feature_key_mode: safeString(reportedAdvantage.featureKeyMode),
        advantage_plus_site_links: deepClone(reportedAdvantage.siteLinks),
        site_links_requested_count: safeArray(reportedAdvantage.siteLinks).length,
        site_links_applied: [],
        advantage_plus_verification: {
          status: 'pending',
          requested_features: deepClone(reportedAdvantage.requestedFeatures),
          eligible_features: deepClone(reportedAdvantage.eligibleFeatures),
          skipped_features: deepClone(reportedAdvantage.skippedFeatures),
          skip_reasons: deepClone(reportedAdvantage.skipReasons),
          site_links_requested_count: safeArray(reportedAdvantage.siteLinks).length,
          site_extensions_requested: Boolean(reportedAdvantage.siteLinksEligible),
          landing_page_source: landingPage.source,
          requested_at_api_version: resolvedApiVersion,
          graph_acknowledgement_is_not_ui_confirmation: true,
        },

        adPayload: deepClone(variantAdPayload),

        updateAdPayload: deepClone(variantAdPayload),

        asset_ids: variant.assetIds,
        asset_names: variant.assetNames,
        asset_hashes: variant.assetHashes,
        asset_urls: variant.assetUrls,
        ordered_asset_ratios: variant.orderedRatios,
        required_media_roles: variant.requiredMediaRoles,
        video_id: safeString(uploadedVideo.video_id),
        video_status: safeString(uploadedVideo.video_status),
        video_thumbnail_hash: safeString(uploadedVideoThumbnail.hash),

        readyToCreateCreative,
        readyToCreateAd,
        readyToReplaceAd,

        creative_mode: variant.media_variant === 'video_single' ? 'video_single' : (action === 'replace_existing' || useFlexibleCreative ? 'flexible_required' : 'single_image'),
        creative_quality_status: variant.media_variant === 'video_single' ? 'video_single_payload_prepared' : (useFlexibleCreative ? 'flexible_payload_prepared' : 'single_image_payload_prepared'),
        creative_quality_requirements: {
          require_asset_feed_spec: variant.media_variant !== 'video_single' && (action === 'replace_existing' || useFlexibleCreative),
          min_images: variant.media_variant === 'video_single' ? 0 : (action === 'replace_existing' || useFlexibleCreative ? 3 : 1),
          min_bodies: variant.media_variant === 'video_single' ? 0 : (action === 'replace_existing' || useFlexibleCreative ? 5 : 1),
          min_titles: variant.media_variant === 'video_single' ? 0 : (action === 'replace_existing' || useFlexibleCreative ? 5 : 1),
        },
        allow_fallback_creative: false,
        blocked_before_update: false,

        matched_ads: rankedCandidates.slice(0, 10).map((entry) => summarizeAd(entry.ad, entry.score, entry.reasons, entry.temporal)),
        selected_ad_ids: resolvedSourceAdId ? [resolvedSourceAdId] : [],
        selected_ads: resolvedSourceAdId ? [summarizeAd(chosenAd, chosenScore, chosenReasons, chosenEntry ? chosenEntry.temporal : null)] : [],
        replacement_plan: deepClone(scopedReplacementPlan),

        related_ids: {
          ...deepClone(job.related_ids || {}),
          selected_ad_ids: resolvedSourceAdId ? [resolvedSourceAdId] : [],
          replacement_ad_ids: uniqueStrings(scopedReplacementPlan.map((item) => item.ad_id)),
          replacement_creative_ids: uniqueStrings(scopedReplacementPlan.map((item) => item.creative_id)),
          destination_campaign_ids: uniqueStrings([destinationMeta.destination_campaign_id]),
          destination_adset_ids: uniqueStrings([destinationMeta.destination_adset_id]),
          destination_page_ids: uniqueStrings([destinationMeta.destination_page_id]),
          destination_instagram_user_ids: uniqueStrings([destinationMeta.destination_instagram_user_id]),
          destination_ad_account_ids: uniqueStrings([destinationMeta.destination_ad_account_id]),
        },

        destination_match_debug: {
          aliases,
          preferred_ids: [...preferredIds],
          in_run_claim_key: destinationClaimKey,
          in_run_claimed_ad_ids: [...claimedReplacementAdIds],
          in_run_claim_excluded_ad_ids: inRunClaimExcludedAdIds,
          offer_fingerprint: {
            status: safeString(expectedOfferFingerprint.status),
            tag: offerFingerprintTag,
            replacement_eligible: offerFingerprintReplacementEligible,
            exact_candidate_count: candidateSourceAds.length,
            excluded_candidate_ids: offerExcludedCandidateIds,
          },
          candidate_count: candidateSourceAds.length,
          ranked_candidates: rankedCandidates.slice(0, 10).map((entry) => summarizeAd(entry.ad, entry.score, entry.reasons, entry.temporal)),
          chosen_ad_id: resolvedSourceAdId,
          chosen_ad_name: safeString(chosenAd && chosenAd.name),
          replacement_plan_count: scopedReplacementPlan.length,
          replacement_plan_built_from_creative: !safeArray(job.replacement_plan).some((item) => safeString(item.ad_id) === resolvedSourceAdId) && scopedReplacementPlan.length > 0,
          temporal_guard: temporalGuard,
          destination_contract: publicDestinationContract(destinationContract),
        },

        warnings: safeWarnings(safeWarnings(job.warnings, baseWarnings), warnings),
      },
      binary: deepClone(entry.binary || {}),
    });
    }
  }
}

if (!outputs.length) {
  throw new Error(`Build Jobs terminou sem outputs. debug=${JSON.stringify({
    inputCount: inputItems.length,
    buildPayloadCount: jobEntries.length,
    uploadedByJobKeys: [...uploadedByJob.keys()],
    aiByJobKeys: [...aiByJob.keys()],
  })}`);
}

for (const output of outputs) ensureOutputDestinationContract(output);

const outputErrors = outputs.filter((item) => safeString(item && item.json && item.json.error));
if (outputErrors.length) {
  throw new Error(`Build Jobs bloqueou o lote antes de qualquer mutacao Meta. errors=${JSON.stringify(outputErrors.map((item) => item.json))}`);
}

return outputs;
