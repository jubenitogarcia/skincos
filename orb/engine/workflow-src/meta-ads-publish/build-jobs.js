const DEFAULT_AD_STATUS = 'ACTIVE';
const DEFAULT_CTA_TYPE = 'WHATSAPP_MESSAGE';
const DEFAULT_LINK_URL = 'https://api.whatsapp.com/send';
const RATIO_PRIORITY = ['3x4', '2x1', '9x16'];
const TEMPORAL_GUARD_FRESH_DAYS = 7;

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

  const imageLabelId = safeString(imageLabel.id);
  const creativeImage = safeArray(creativeImages).find((image) =>
    safeArray(image && image.adlabels).some((label) => safeString(label && label.id) === imageLabelId)
  );

  return inferRatioFromImageCrops(creativeImage && creativeImage.image_crops ? creativeImage.image_crops : {});
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

function normalizeLinkUrls(list) {
  for (const entry of safeArray(list)) {
    const candidate = toHttps(extractUrlCandidate(entry));
    if (isValidWebsiteUrl(candidate)) return [{ website_url: candidate }];
  }

  return [{ website_url: DEFAULT_LINK_URL }];
}

function normalizeCtaTypes(list) {
  const raw = safeString((Array.isArray(list) ? list[0] : '')).toUpperCase();

  const aliasMap = {
    WHATSAPP: 'WHATSAPP_MESSAGE',
    WHATSAPP_MESSAGE: 'WHATSAPP_MESSAGE',
  };

  const allowed = new Set([
    'OPEN_LINK', 'LIKE_PAGE', 'SHOP_NOW', 'PLAY_GAME', 'INSTALL_APP', 'USE_APP',
    'CALL', 'CALL_ME', 'VIDEO_CALL', 'INSTALL_MOBILE_APP', 'USE_MOBILE_APP',
    'MOBILE_DOWNLOAD', 'BOOK_TRAVEL', 'LISTEN_MUSIC', 'WATCH_VIDEO', 'LEARN_MORE',
    'SIGN_UP', 'DOWNLOAD', 'WATCH_MORE', 'NO_BUTTON', 'VISIT_PAGES_FEED',
    'CALL_NOW', 'APPLY_NOW', 'CONTACT', 'BUY_NOW', 'GET_OFFER', 'GET_OFFER_VIEW',
    'BUY_TICKETS', 'UPDATE_APP', 'GET_DIRECTIONS', 'BUY', 'SEND_UPDATES',
    'MESSAGE_PAGE', 'DONATE', 'SUBSCRIBE', 'SAY_THANKS', 'SELL_NOW', 'SHARE',
    'DONATE_NOW', 'GET_QUOTE', 'CONTACT_US', 'ORDER_NOW', 'START_ORDER',
    'ADD_TO_CART', 'VIEW_CART', 'VIEW_IN_CART', 'VIDEO_ANNOTATION', 'RECORD_NOW',
    'INQUIRE_NOW', 'CONFIRM', 'REFER_FRIENDS', 'REQUEST_TIME', 'GET_SHOWTIMES',
    'LISTEN_NOW', 'TRY_DEMO', 'WOODHENGE_SUPPORT', 'SOTTO_SUBSCRIBE',
    'FOLLOW_USER', 'RAISE_MONEY', 'SEE_SHOP', 'GET_DETAILS', 'FIND_OUT_MORE',
    'VISIT_WEBSITE', 'BROWSE_SHOP', 'EVENT_RSVP', 'WHATSAPP_MESSAGE',
    'FOLLOW_NEWS_STORYLINE', 'SEE_MORE', 'BOOK_NOW', 'FIND_A_GROUP',
    'FIND_YOUR_GROUPS', 'PAY_TO_ACCESS', 'PURCHASE_GIFT_CARDS', 'FOLLOW_PAGE',
    'SEND_A_GIFT', 'SWIPE_UP_SHOP', 'SWIPE_UP_PRODUCT', 'SEND_GIFT_MONEY',
    'PLAY_GAME_ON_FACEBOOK', 'GET_STARTED', 'OPEN_INSTANT_APP', 'AUDIO_CALL',
    'GET_PROMOTIONS', 'JOIN_CHANNEL', 'MAKE_AN_APPOINTMENT',
    'ASK_ABOUT_SERVICES', 'BOOK_A_CONSULTATION', 'GET_A_QUOTE',
    'BUY_VIA_MESSAGE', 'ASK_FOR_MORE_INFO', 'CHAT_WITH_US', 'VIEW_PRODUCT',
    'VIEW_CHANNEL', 'GET_IN_TOUCH', 'ASK_A_QUESTION', 'START_A_CHAT',
    'CHAT_NOW', 'ASK_US', 'WATCH_LIVE_VIDEO', 'SHOP_WITH_AI', 'TRY_ON_WITH_AI'
  ]);

  const normalized = aliasMap[raw] || raw;
  return [allowed.has(normalized) ? normalized : DEFAULT_CTA_TYPE];
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
const ADVANTAGE_PLUS_BASE_FEATURES = [
  'image_touchups',
  'inline_comment',
  'text_optimizations',
  'enhance_cta',
  'image_brightness_and_contrast',
  'image_animation',
];

function parseApiVersionMajor(version) {
  const match = safeString(version).match(/^v?(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function advantagePlusFeatureKeyMode(apiVersion) {
  return parseApiVersionMajor(apiVersion) >= 25 ? 'add_text_overlay' : 'image_template';
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
    const url = toHttps(extractUrlCandidate(entry));
    if (!title || !isValidWebsiteUrl(url)) continue;
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

function buildAdvantagePlusRequest(apiVersion, siteLinks) {
  const creativeFeaturesSpec = {};
  for (const feature of ADVANTAGE_PLUS_BASE_FEATURES) {
    creativeFeaturesSpec[feature] = { enroll_status: 'OPT_IN' };
  }
  const featureKeyMode = advantagePlusFeatureKeyMode(apiVersion);
  creativeFeaturesSpec[featureKeyMode] = { enroll_status: 'OPT_IN' };

  const siteLinksEligible = siteLinks.length >= ADVANTAGE_PLUS_SITE_LINKS_MIN;
  if (siteLinksEligible) {
    creativeFeaturesSpec.site_extensions = { enroll_status: 'OPT_IN' };
  }

  return {
    featureKeyMode,
    requestedFeatures: Object.keys(creativeFeaturesSpec),
    siteLinksEligible,
    siteLinks: deepClone(siteLinks),
    creativeFeaturesSpec,
    creativeSourcingSpec: siteLinksEligible
      ? {
          site_links_spec: siteLinks.map((link) => ({
            site_link_title: safeString(link.site_link_title || link.title),
            site_link_url: toHttps(link.site_link_url || link.url),
          })),
        }
      : undefined,
  };
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
  return $('Build Payload')
    .all()
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
    for (const image of safeArray(job.imagens)) {
      const imageName = safeString(image.name);
      const originalName = safeString(image.original_name);
      const ratio = safeString(image.proporcao || detectRatio(imageName || originalName));

      const payload = {
        job_key: safeString(job.job_key),
        ratio,
        source_file_id: safeString(image.id),
        source_file_name: imageName || originalName,
      };

      if (imageName) fileToJob.set(normalizeKey(imageName), payload);
      if (originalName) fileToJob.set(normalizeKey(originalName), payload);
    }
  }

  return fileToJob;
}

function buildUploadedByJob(inputItems, fileToJob) {
  const uploadItems = inputItems
    .map((item) => item.json || {})
    .filter((json) => json.images && typeof json.images === 'object');

  const uploadedByJob = new Map();

  for (const item of uploadItems) {
    for (const [filename, meta] of Object.entries(item.images || {})) {
      const normalizedFilename = normalizeKey(filename);
      const fileRef = fileToJob.get(normalizedFilename);
      if (!fileRef || !fileRef.job_key) continue;

      const accountId = safeString(item._gateway_account_id || item.account_id);
      if (!accountId) continue;
      if (!uploadedByJob.has(fileRef.job_key)) uploadedByJob.set(fileRef.job_key, new Map());
      const byAccount = uploadedByJob.get(fileRef.job_key);
      if (!byAccount.has(accountId)) byAccount.set(accountId, {});

      byAccount.get(accountId)[fileRef.ratio || detectRatio(filename)] = {
        ratio: fileRef.ratio || detectRatio(filename),
        original_filename: safeString(filename),
        source_file_id: fileRef.source_file_id,
        source_file_name: fileRef.source_file_name,
        hash: safeString(meta && meta.hash),
        url: toHttps(meta && meta.url),
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
      });
    }
  }

  return pool;
}

function buildAiByJob(inputItems, jobEntries) {
  const aiItems = inputItems
    .map((item) => item.json || {})
    .filter((json) =>
      json.output ||
      json.analysis ||
      json.creative_override ||
      json.source_ad_name ||
      json.group_key ||
      json.job_key
    );

  const jobRefs = jobEntries.map((entry) => {
    const job = entry.json || {};
    const key = safeString(job.job_key);
    const aliases = uniqueStrings([
      job.job_key,
      job.source_ad_name,
      job.source_ad_name_base,
      job.group_key,
      job.nome_base,
    ]).map((value) => normalizeKey(value)).filter(Boolean);

    return { key, aliases };
  });

  const jobsByKey = new Map();
  const jobsBySourceName = new Map(jobEntries.map((entry) => [normalizeKey(entry.json.source_ad_name), safeString(entry.json.job_key)]));
  const jobsByGroupKey = new Map(jobEntries.map((entry) => [normalizeKey(entry.json.group_key), safeString(entry.json.job_key)]));

  for (const ref of jobRefs) {
    if (!ref.key) continue;
    jobsByKey.set(ref.key, ref.key);
    jobsByKey.set(normalizeKey(ref.key), ref.key);
  }

  function resolveJobKeyByAlias(value) {
    const normalized = normalizeKey(value);
    if (!normalized) return '';

    let best = null;

    for (const ref of jobRefs) {
      for (const alias of ref.aliases) {
        if (!alias) continue;
        const exact = normalized === alias;
        const aiExtendsJob = normalized.startsWith(alias + '_');
        const jobExtendsAi = alias.startsWith(normalized + '_');
        if (!exact && !aiExtendsJob && !jobExtendsAi) continue;

        if (!best || alias.length > best.alias.length) {
          best = { key: ref.key, alias };
        }
      }
    }

    return best ? best.key : '';
  }

  const aiByJob = new Map();

  for (const item of aiItems) {
    const ai = unwrapAi(item);
    const directKey = safeString(ai.job_key || item.job_key);
    const aiSourceName = safeString(ai.source_ad_name || item.source_ad_name);
    const aiGroupKey = safeString(ai.group_key || ai.nome_base || item.group_key);
    const resolvedJobKey =
      jobsByKey.get(directKey) ||
      jobsByKey.get(normalizeKey(directKey)) ||
      jobsBySourceName.get(normalizeKey(aiSourceName)) ||
      jobsByGroupKey.get(normalizeKey(aiGroupKey)) ||
      resolveJobKeyByAlias(aiSourceName) ||
      resolveJobKeyByAlias(aiGroupKey) ||
      (jobEntries.length === 1 && aiItems.length === 1 ? safeString(jobEntries[0].json.job_key) : '');

    if (!resolvedJobKey) continue;
    aiByJob.set(resolvedJobKey, ai);
  }

  return aiByJob;
}

function buildOrderedAssets(job, uploaded) {
  const requiredRatios = safeArray(job.required_ratios).length ? safeArray(job.required_ratios) : RATIO_PRIORITY;
  const ordered = requiredRatios.map((ratio) => uploaded[ratio]).filter(Boolean);
  if (ordered.length) return ordered;
  return RATIO_PRIORITY.map((ratio) => uploaded[ratio]).filter(Boolean);
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

function buildCanonicalAdName(sourceAdName, destinationGroup) {
  const source = safeString(sourceAdName);
  const destination = safeString(destinationGroup);

  if (!source) return destination;
  if (!destination) return source;

  const sourceParts = source
    .split('|')
    .map((part) => safeString(part))
    .filter(Boolean);

  if (!sourceParts.length) return destination;

  const lastPart = sourceParts[sourceParts.length - 1];
  if (normalizeNameSegment(lastPart) === normalizeNameSegment(destination)) {
    return sourceParts.join(' | ');
  }

  return [...sourceParts, destination].join(' | ');
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

const inputItems = $input.all();
const jobEntries = getBuildPayloadEntries();
const buildPayloadErrors = getBuildPayloadErrorEntries();

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
            input_count: inputItems.length,
            build_payload_item_count: $('Build Payload').all().length,
          },
        }
      : {
          error: 'Nenhum job do Build Payload foi encontrado no input do Build Jobs.',
          debug: {
            input_count: inputItems.length,
            build_payload_item_count: $('Build Payload').all().length,
          },
        },
  }];
}

const fileToJob = buildFileToJob(jobEntries);
const uploadedByJob = buildUploadedByJob(inputItems, fileToJob);
const aiByJob = buildAiByJob(inputItems, jobEntries);
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
    freshness_window_days: Number(destination.freshness_window_days || TEMPORAL_GUARD_FRESH_DAYS),
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
    const shouldReplaceExisting =
      safeString(job.action) === 'replace_existing' || Boolean(job.should_replace_existing);

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

    const inRunClaimExcludedAdIds = shouldReplaceExisting
      ? uniqueStrings(safeArray(job.source_ads).map((ad) => safeString(ad && ad.id)).filter((adId) => claimedReplacementAdIds.has(adId)))
      : [];

    const candidateSourceAds = shouldReplaceExisting
      ? safeArray(job.source_ads).filter((ad) => {
          const adId = safeString(ad && ad.id);
          if (claimedReplacementAdIds.has(adId)) return false;
          if (!preferredIds.size && !matchedIds.size) return true;
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
      reason: chosenEntry
        ? (chosenEntry.temporal.has_known_time ? 'past_candidate_selected' : 'unknown_time_fallback_selected')
        : (freshCandidates.length ? 'all_matching_candidates_are_fresh' : 'no_matching_candidate'),
    };

    if (shouldReplaceExisting && !chosenAd) {
      outputs.push({
        json: {
          error: freshCandidates.length
            ? 'Temporal replacement guard bloqueou replace_existing: todos os candidatos correspondentes estao dentro da janela protegida.'
            : 'replace_existing foi solicitado, mas nenhum candidato antigo e inequivoco foi encontrado.',
          upstream_node: 'Build Jobs',
          upstream_error: freshCandidates.length ? 'temporal_guard_all_candidates_fresh' : 'replacement_candidate_not_found',
          debug: {
            job_key: safeString(job.job_key),
            destination_group: safeString(destinationMeta.destination_group),
            temporal_guard: temporalGuard,
            ranked_candidates: rankedCandidates.slice(0, 10).map((entry) => summarizeAd(entry.ad, entry.score, entry.reasons, entry.temporal)),
          },
        },
        binary: deepClone(entry.binary || {}),
      });
      continue;
    }

    let scopedReplacementPlan = shouldReplaceExisting
      ? safeArray(job.replacement_plan).filter((item) =>
          safeString(item.ad_id) === safeString(chosenAd && chosenAd.id)
        )
      : [];

    if (shouldReplaceExisting && !scopedReplacementPlan.length && chosenAd) {
      scopedReplacementPlan = buildReplacementPlanForAd(chosenAd, mediaInventoryByRatio);
    }

    if (shouldReplaceExisting && !scopedReplacementPlan.length) {
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

    const action = shouldReplaceExisting ? 'replace_existing' : 'create_new';

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
    if (orderedAssets.length !== safeArray(job.required_ratios).length || orderedAssets.length < 3) {
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

    if (!orderedAssets.length) warnings.push('Nenhum asset enviado foi associado a este job.');
    if (!resolvedAccountId) warnings.push('destination_ad_account_id ausente.');
    if (!resolvedPageId) warnings.push('destination_page_id ausente.');
    if (!resolvedCampaignId) warnings.push('destination_campaign_id ausente.');
    if (!resolvedApiVersion) warnings.push('destination_api_version ausente.');
    if (!resolvedTokenId) warnings.push('token_id opaco do gateway ausente para o destino.');
    if (action === 'create_new' && !resolvedAdsetId) warnings.push(`Job ${job.job_key} sem destination_adset_id para create_new.`);
    if (action === 'replace_existing' && !resolvedSourceAdId) warnings.push('source_ad_id ausente para replace_existing.');
    if (shouldReplaceExisting && !chosenAd) warnings.push(`Nenhum anuncio antigo da unidade ${destinationMeta.destination_group} foi localizado para match preciso.`);

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

    if (!aiByJob.has(job.job_key) || aiBodies.length !== 5 || aiTitles.length !== 5 || aiDescriptions.length !== 1) {
      outputs.push({
        json: {
          error: 'A saida estruturada da IA nao atende ao contrato exato de 5 bodies, 5 titles e 1 description.',
          upstream_node: 'Build Jobs',
          upstream_error: 'ai_copy_contract_failed',
          debug: {
            job_key: safeString(job.job_key),
            ai_output_found: aiByJob.has(job.job_key),
            body_count: aiBodies.length,
            title_count: aiTitles.length,
            description_count: aiDescriptions.length,
          },
        },
      });
      continue;
    }

    const linkUrls = normalizeLinkUrls(overrides.link_urls);
    const ctaTypes = normalizeCtaTypes(overrides.call_to_action_types);
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
    const finalAdName = buildCanonicalAdName(sourceAdName, destinationMeta.destination_group);

    const normalizedBodies = aiBodies;
    const normalizedTitles = aiTitles;
    const normalizedDescriptions = aiDescriptions;

    const primaryLinkCandidate = toHttps(extractUrlCandidate(linkUrls[0]));
    const isWhatsAppCta = ctaTypes[0] === DEFAULT_CTA_TYPE;
    const primaryLinkUrl = isWhatsAppCta
      ? DEFAULT_LINK_URL
      : primaryLinkCandidate;
    if (isWhatsAppCta && primaryLinkCandidate && primaryLinkCandidate !== DEFAULT_LINK_URL) {
      warnings.push(`A URL sugerida pela IA foi ignorada porque o CTA e WhatsApp; hostname=${safeHostname(primaryLinkCandidate) || 'invalid'}.`);
    }
    if (!isAllowedLinkUrl(primaryLinkUrl, allowedLinkHosts)) {
      outputs.push({
        json: {
          error: 'A URL principal retornada pela IA esta fora da allowlist de hosts.',
          upstream_node: 'Build Jobs',
          upstream_error: 'primary_link_host_not_allowed',
          debug: {
            job_key: safeString(job.job_key),
            rejected_hostname: safeHostname(primaryLinkUrl) || 'invalid',
            cta_type: ctaTypes[0] || '',
          },
        },
      });
      continue;
    }

    const safeLinkUrls = [{ website_url: primaryLinkUrl }];
    const advantagePlusRequest = buildAdvantagePlusRequest(resolvedApiVersion, siteLinks);
    const adMutationPayload = {
      name: finalAdName || sourceAdName,
      status: 'PAUSED',
      creative: {
        creative_id: '',
      },
      ...(resolvedAdsetId ? { adset_id: resolvedAdsetId } : {}),
    };
    const useFlexibleCreative = orderedAssets.length >= 3;

    const imageLabels = orderedAssets.map((asset, index) => createLabel(sourceAdName + '_' + asset.ratio, 'image', index + 1));
    const bodyRuleLabels = orderedAssets.map((asset, index) => createLabel(sourceAdName + '_' + asset.ratio, 'body_rule', index + 1));
    const titleRuleLabels = orderedAssets.map((asset, index) => createLabel(sourceAdName + '_' + asset.ratio, 'title_rule', index + 1));

    const imageAssets = orderedAssets.map((asset, index) => ({
      hash: safeString(asset.hash) || undefined,
      url: safeString(asset.hash) ? undefined : toHttps(asset.url),
      adlabels: [imageLabels[index]],
    }));

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

    const placementRules = orderedAssets.map((asset, index) => ({
      customization_spec:
        asset.ratio === '9x16'
          ? {
              publisher_platforms: ['facebook', 'instagram'],
              facebook_positions: ['story', 'facebook_reels'],
              instagram_positions: ['story', 'reels'],
            }
          : asset.ratio === '2x1'
            ? {
                publisher_platforms: ['facebook'],
                facebook_positions: ['search'],
              }
            : {
                publisher_platforms: ['facebook', 'instagram'],
                facebook_positions: ['feed', 'marketplace'],
                instagram_positions: ['stream', 'explore'],
              },
      image_label: imageLabels[index],
      body_label: bodyRuleLabels[index],
      title_label: titleRuleLabels[index],
      priority: index + 1,
    }));

    const creativeRootExtras = removeEmptyFields({
      degrees_of_freedom_spec: {
        creative_features_spec: deepClone(advantagePlusRequest.creativeFeaturesSpec),
      },
      creative_sourcing_spec: advantagePlusRequest.siteLinksEligible
        ? deepClone(advantagePlusRequest.creativeSourcingSpec)
        : undefined,
    });

    const creativePayload = useFlexibleCreative
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

    const readyToCreateCreative = Boolean(
      resolvedTokenId &&
      resolvedAccountId &&
      resolvedPageId &&
      resolvedApiVersion &&
      orderedAssets.length
    );

    const readyToCreateAd = action === 'create_new'
      ? Boolean(resolvedTokenId && resolvedAccountId && resolvedAdsetId && resolvedApiVersion && orderedAssets.length)
      : false;

    const readyToReplaceAd = Boolean(resolvedTokenId && action === 'replace_existing' && resolvedSourceAdId && resolvedApiVersion && orderedAssets.length);

    if (readyToReplaceAd) {
      claimedReplacementAdIds.add(resolvedSourceAdId);
    }

    outputs.push({
      json: {
        parent_job_key: safeString(job.job_key),
        job_key: createExpandedJobKey(job.job_key, destinationMeta),

        action,
        match_status: action === 'replace_existing' ? 'destination_replace' : safeString(job.match_status || 'no_match'),
        should_create_new_ad: action === 'create_new',
        should_replace_existing: action === 'replace_existing',

        source_ad_id: resolvedSourceAdId,
        source_ad_name: sourceAdName,
        source_ad_texts: deepClone(job.source_ad_texts || {}),

        group_key: safeString(job.group_key),
        offer_group_key: safeString(job.offer_group_key || job.offer_key || job.group_key),
        creative_group_key: safeString(job.creative_group_key || job.group_key),
        grouping_discriminator: safeString(job.grouping_discriminator),
        grouping_strategy: safeString(job.grouping_strategy),
        nome_base: safeString(job.nome_base),
        product_key: safeString(job.product_key),
        suffix_hint: safeString(job.suffix_hint),

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
        config_revision: safeString(destinationMeta.config_revision || job.config_revision),
        allowed_link_hosts: deepClone(allowedLinkHosts),
        desired_final_status: DEFAULT_AD_STATUS,

        creativePayload,
        advantage_plus_request: {
          requested_features: deepClone(advantagePlusRequest.requestedFeatures),
          feature_key_mode: safeString(advantagePlusRequest.featureKeyMode),
          site_links: deepClone(advantagePlusRequest.siteLinks),
          site_extensions_enabled: Boolean(advantagePlusRequest.siteLinksEligible),
        },
        advantage_plus_requested_features: deepClone(advantagePlusRequest.requestedFeatures),
        advantage_plus_final_features: deepClone(advantagePlusRequest.requestedFeatures),
        advantage_plus_applied_features: [],
        advantage_plus_removed_features: [],
        advantage_plus_feature_key_mode: safeString(advantagePlusRequest.featureKeyMode),
        advantage_plus_site_links: deepClone(advantagePlusRequest.siteLinks),
        site_links_requested_count: safeArray(advantagePlusRequest.siteLinks).length,
        site_links_applied: [],
        advantage_plus_verification: {
          status: 'pending',
          requested_features: deepClone(advantagePlusRequest.requestedFeatures),
          site_links_requested_count: safeArray(advantagePlusRequest.siteLinks).length,
          site_extensions_requested: Boolean(advantagePlusRequest.siteLinksEligible),
        },

        adPayload: deepClone(adMutationPayload),

        updateAdPayload: deepClone(adMutationPayload),

        asset_ids: Object.fromEntries(orderedAssets.map((asset) => [asset.ratio, safeString(asset.source_file_id)])),
        asset_names: Object.fromEntries(orderedAssets.map((asset) => [asset.ratio, safeString(asset.source_file_name || asset.original_filename)])),
        asset_hashes: Object.fromEntries(orderedAssets.map((asset) => [asset.ratio, safeString(asset.hash)])),
        asset_urls: Object.fromEntries(orderedAssets.map((asset) => [asset.ratio, toHttps(asset.url)])),
        ordered_asset_ratios: orderedAssets.map((asset) => safeString(asset.ratio)),

        readyToCreateCreative,
        readyToCreateAd,
        readyToReplaceAd,

        creative_mode: action === 'replace_existing' || useFlexibleCreative ? 'flexible_required' : 'single_image',
        creative_quality_status: useFlexibleCreative ? 'flexible_payload_prepared' : 'single_image_payload_prepared',
        creative_quality_requirements: {
          require_asset_feed_spec: action === 'replace_existing' || useFlexibleCreative,
          min_images: action === 'replace_existing' || useFlexibleCreative ? 3 : 1,
          min_bodies: action === 'replace_existing' || useFlexibleCreative ? 5 : 1,
          min_titles: action === 'replace_existing' || useFlexibleCreative ? 5 : 1,
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
          candidate_count: candidateSourceAds.length,
          ranked_candidates: rankedCandidates.slice(0, 10).map((entry) => summarizeAd(entry.ad, entry.score, entry.reasons, entry.temporal)),
          chosen_ad_id: resolvedSourceAdId,
          chosen_ad_name: safeString(chosenAd && chosenAd.name),
          replacement_plan_count: scopedReplacementPlan.length,
          replacement_plan_built_from_creative: !safeArray(job.replacement_plan).some((item) => safeString(item.ad_id) === resolvedSourceAdId) && scopedReplacementPlan.length > 0,
          temporal_guard: temporalGuard,
        },

        warnings: safeWarnings(safeWarnings(job.warnings, baseWarnings), warnings),
      },
      binary: deepClone(entry.binary || {}),
    });
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

const outputErrors = outputs.filter((item) => safeString(item && item.json && item.json.error));
if (outputErrors.length) {
  throw new Error(`Build Jobs bloqueou o lote antes de qualquer mutacao Meta. errors=${JSON.stringify(outputErrors.map((item) => item.json))}`);
}

return outputs;
