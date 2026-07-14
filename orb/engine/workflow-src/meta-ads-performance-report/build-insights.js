const WORKFLOW_NAME = 'Meta Ads - Performance Report';
const WORKFLOW_TIMEZONE = 'America/Sao_Paulo';
const DEFAULT_API_VERSION = 'v24.0';
const DEFAULT_REPORT_MODE = 'full';
const DEFAULT_STORAGE_MODE = 'cloudflare_worker_prepared';
const DEFAULT_RAW_PAYLOAD_ENABLED = true;
const DEFAULT_COMPAT_EXPORT_ENABLED = false;

const FIELD_SETS = {
  full: {
    summary: [
      'ad_id','account_currency','spend','reach','impressions','frequency','clicks','unique_clicks','ctr','unique_ctr','cpc','cpm','cpp','inline_link_clicks','inline_link_click_ctr','cost_per_inline_link_click','unique_inline_link_clicks','outbound_clicks','outbound_clicks_ctr','cost_per_outbound_click','inline_post_engagement','cost_per_inline_post_engagement','social_spend','objective','optimization_goal','instagram_profile_visits','quality_ranking','engagement_rate_ranking','conversion_rate_ranking','estimated_ad_recall_rate','estimated_ad_recallers','actions','action_values','cost_per_action_type','cost_per_unique_action_type','unique_actions','conversions','conversion_values','cost_per_conversion','website_ctr','website_purchase_roas','purchase_roas','video_play_actions','video_30_sec_watched_actions','video_continuous_2_sec_watched_actions','video_p25_watched_actions','video_p50_watched_actions','video_p75_watched_actions','video_p95_watched_actions','video_p100_watched_actions','video_avg_time_watched_actions','video_thruplay_watched_actions','cost_per_thruplay',
    ],
    hourly: [
      'ad_id','spend','reach','impressions','frequency','clicks','inline_link_clicks','inline_post_engagement','instagram_profile_visits','actions','action_values','unique_actions','conversions','conversion_values','video_play_actions','video_30_sec_watched_actions','video_continuous_2_sec_watched_actions','video_p25_watched_actions','video_p50_watched_actions','video_p75_watched_actions','video_p95_watched_actions','video_p100_watched_actions','video_avg_time_watched_actions','video_thruplay_watched_actions',
    ],
    breakdown: [
      'spend','reach','impressions','clicks','inline_link_clicks','inline_post_engagement','instagram_profile_visits','actions','action_values','unique_actions','conversions','conversion_values','video_play_actions','video_30_sec_watched_actions','video_continuous_2_sec_watched_actions','video_p25_watched_actions','video_p50_watched_actions','video_p75_watched_actions','video_p95_watched_actions','video_p100_watched_actions','video_avg_time_watched_actions','video_thruplay_watched_actions',
    ],
    breakdownVariants: [
      { key: 'age', breakdowns: ['age'] },
      { key: 'gender', breakdowns: ['gender'] },
      { key: 'age_gender', breakdowns: ['age', 'gender'] },
      { key: 'country', breakdowns: ['country'] },
      { key: 'region', breakdowns: ['region'] },
      { key: 'dma', breakdowns: ['dma'] },
      { key: 'impression_device', breakdowns: ['impression_device'] },
      { key: 'device_platform', breakdowns: ['device_platform'] },
      { key: 'publisher_platform', breakdowns: ['publisher_platform'] },
      { key: 'publisher_platform_platform_position', breakdowns: ['publisher_platform', 'platform_position'] },
    ],
    breakdownWindows: ['last_24h', 'last_7d', 'last_30d'],
    breakdownLimit24h: '500',
    breakdownLimitRollup: '500',
  },
  lean: {
    summary: [
      'ad_id','account_currency','spend','reach','impressions','frequency','clicks','unique_clicks','ctr','cpc','cpm','cpp','inline_link_clicks','inline_link_click_ctr','cost_per_inline_link_click','inline_post_engagement','instagram_profile_visits','actions','cost_per_action_type','unique_actions','conversions','conversion_values','video_play_actions','video_thruplay_watched_actions',
    ],
    hourly: [
      'ad_id','spend','reach','impressions','clicks','inline_link_clicks','inline_post_engagement','instagram_profile_visits','actions','unique_actions','conversions','conversion_values','video_play_actions','video_thruplay_watched_actions',
    ],
    breakdown: [
      'spend','reach','impressions','clicks','inline_link_clicks','instagram_profile_visits','actions','conversions','video_play_actions','video_thruplay_watched_actions',
    ],
    breakdownVariants: [
      { key: 'age_gender', breakdowns: ['age', 'gender'] },
      { key: 'country', breakdowns: ['country'] },
      { key: 'publisher_platform_platform_position', breakdowns: ['publisher_platform', 'platform_position'] },
    ],
    breakdownWindows: ['last_7d', 'last_30d'],
    breakdownLimit24h: '250',
    breakdownLimitRollup: '250',
  },
};

const SCOPES = [
  { key: 'ad', level: 'ad' },
  { key: 'adset', level: 'adset' },
  { key: 'campaign', level: 'campaign' },
];

function safeString(value) {
  return String(value ?? '').trim();
}

function safeBoolean(value, fallback) {
  const normalized = safeString(value).toLowerCase();
  if (['true', '1', 'yes', 'y', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pickFirstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function pickFirstIdentifier(...values) {
  for (const value of values) {
    const normalized = safeString(value);
    if (normalized && normalized !== '0') {
      return normalized;
    }
  }
  return '';
}

function pickObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }
  }
  return {};
}

function removeEmptyFields(obj) {
  if (Array.isArray(obj)) {
    return obj
      .map(removeEmptyFields)
      .filter((item) => item !== undefined && item !== null);
  }

  if (obj && typeof obj === 'object') {
    const cleaned = {};

    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = removeEmptyFields(value);
      const isEmptyObject =
        cleanedValue &&
        typeof cleanedValue === 'object' &&
        !Array.isArray(cleanedValue) &&
        Object.keys(cleanedValue).length === 0;
      const isEmptyArray =
        Array.isArray(cleanedValue) && cleanedValue.length === 0;

      if (
        cleanedValue !== undefined &&
        cleanedValue !== null &&
        cleanedValue !== '' &&
        !isEmptyObject &&
        !isEmptyArray
      ) {
        cleaned[key] = cleanedValue;
      }
    }

    return cleaned;
  }

  return obj;
}

function normalizeReportMode(value) {
  const normalized = safeString(value).toLowerCase();
  return FIELD_SETS[normalized] ? normalized : DEFAULT_REPORT_MODE;
}

function getLocalDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  };
}

function shiftLocalDateParts(date, deltaDays, timeZone) {
  const parts = getLocalDateParts(date, timeZone);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + deltaDays);
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  };
}

function formatDateParts(parts) {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function buildTimeRange(deltaDaysStart, now, timeZone) {
  const todayParts = getLocalDateParts(now, timeZone);
  return {
    since: formatDateParts(shiftLocalDateParts(now, deltaDaysStart, timeZone)),
    until: formatDateParts(todayParts),
  };
}

function buildQueryString(entries) {
  return entries
    .filter(([key, value]) => safeString(key) !== '' && value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`)
    .join('&');
}

function makeInsightsUrl(apiVersion, scopeId, params) {
  return 'https://graph.facebook.com/' + apiVersion + '/' + scopeId + '/insights?' + buildQueryString(params);
}

function normalizeKeyFragment(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hashString(value) {
  const input = safeString(value) || 'empty';
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildStorageConfig(source, paramsNode) {
  return removeEmptyFields({
    storage_mode: safeString(
      source.storage_mode ||
      source.primary_storage_mode ||
      paramsNode.storage_mode ||
      paramsNode.primary_storage_mode ||
      DEFAULT_STORAGE_MODE
    ) || DEFAULT_STORAGE_MODE,
    cloudflare_worker_url: safeString(
      source.cloudflare_worker_url ||
      source.storage_worker_url ||
      paramsNode.cloudflare_worker_url ||
      paramsNode.storage_worker_url
    ),
    cloudflare_worker_auth_header: safeString(
      source.cloudflare_worker_auth_header ||
      paramsNode.cloudflare_worker_auth_header ||
      'Authorization'
    ),
    cloudflare_worker_auth_scheme: safeString(
      source.cloudflare_worker_auth_scheme ||
      paramsNode.cloudflare_worker_auth_scheme ||
      'Bearer'
    ),
    cloudflare_worker_token_present: safeBoolean(
      source.cloudflare_worker_token_present ??
      paramsNode.cloudflare_worker_token_present,
      false
    ),
    d1_database_name: safeString(
      source.d1_database_name ||
      paramsNode.d1_database_name ||
      paramsNode.cloudflare_d1_database_name
    ),
    r2_bucket_name: safeString(
      source.r2_bucket_name ||
      paramsNode.r2_bucket_name ||
      paramsNode.cloudflare_r2_bucket_name
    ),
    raw_payloads_enabled: safeBoolean(
      source.raw_payloads_enabled ??
      paramsNode.raw_payloads_enabled,
      DEFAULT_RAW_PAYLOAD_ENABLED
    ),
    compatibility_export_enabled: safeBoolean(
      source.compatibility_export_enabled ??
      paramsNode.compatibility_export_enabled,
      DEFAULT_COMPAT_EXPORT_ENABLED
    ),
    compatibility_export_target: safeString(
      source.compatibility_export_target ||
      paramsNode.compatibility_export_target ||
      'google_sheets_optional'
    ),
  });
}

function buildAdSnapshot(item) {
  return removeEmptyFields({
    id: pickFirstIdentifier(item.ad_id, item.id_1, item.id),
    name: safeString(pickFirstValue(item.ad_name, item.name_1, item.name)),
    adset_id: pickFirstIdentifier(item.adset_id, item.adset_id_1, item.id_3, item.id),
    campaign_id: pickFirstIdentifier(item.campaign_id, item.campaign_id_1, item.campaign_id_3, item.campaign_id_2),
    status: safeString(pickFirstValue(item.ad_status, item.status_1, item.status)),
    effective_status: safeString(pickFirstValue(item.ad_effective_status, item.effective_status_1, item.effective_status)),
    configured_status: safeString(pickFirstValue(item.ad_configured_status, item.configured_status_1, item.configured_status)),
    preview_shareable_link: safeString(item.preview_shareable_link),
    tracking_specs: deepClone(item.tracking_specs || []),
    conversion_specs: deepClone(item.conversion_specs || []),
    ad_review_feedback: deepClone(item.ad_review_feedback || {}),
    issues_info: deepClone(item.issues_info || []),
    recommendations: deepClone(item.recommendations || []),
  });
}

function buildCreativeSnapshot(item) {
  const nestedCreative = pickObject(item.creative, item.creative_1, item.creative_2, item.creative_3);
  return removeEmptyFields({
    id: pickFirstIdentifier(item.creative_id, item.effective_creative_id, nestedCreative.id, item.id_2, item.id_1),
    name: safeString(pickFirstValue(item.creative_name, nestedCreative.name, item.name_2, item.name_1)),
    effective_instagram_media_id: safeString(pickFirstValue(item.effective_instagram_media_id_2, item.effective_instagram_media_id, nestedCreative.effective_instagram_media_id, item.effective_instagram_media_id_1)),
    instagram_permalink_url: safeString(pickFirstValue(item.instagram_permalink_url_2, item.instagram_permalink_url, nestedCreative.instagram_permalink_url, item.instagram_permalink_url_1)),
    object_story_id: safeString(pickFirstValue(item.object_story_id_2, item.object_story_id)),
    effective_object_story_id: safeString(pickFirstValue(item.effective_object_story_id_2, item.effective_object_story_id)),
    object_story_spec: deepClone(item.object_story_spec_2 || item.object_story_spec || nestedCreative.object_story_spec || {}),
    asset_feed_spec: deepClone(item.asset_feed_spec_2 || item.asset_feed_spec || nestedCreative.asset_feed_spec || {}),
    image_hash: safeString(pickFirstValue(item.image_hash_2, item.image_hash, nestedCreative.image_hash)),
    image_url: safeString(pickFirstValue(item.image_url_2, item.image_url, nestedCreative.image_url)),
    thumbnail_url: safeString(pickFirstValue(item.thumbnail_url_2, item.thumbnail_url, nestedCreative.thumbnail_url)),
    title: safeString(pickFirstValue(item.title_2, item.title, nestedCreative.title)),
    body: safeString(pickFirstValue(item.body_2, item.body, nestedCreative.body)),
    video_id: safeString(pickFirstValue(item.video_id_2, item.video_id)),
    status: safeString(pickFirstValue(item.creative_status, item.status_2, item.status)),
  });
}

function buildAdsetSnapshot(item) {
  const nestedCampaign = pickObject(item.campaign_2, item.campaign_3, item.campaign);
  return removeEmptyFields({
    id: pickFirstIdentifier(item.adset_id, item.id_3, item.id, item.source_adset_id, item.source_adset_id_3),
    name: safeString(pickFirstValue(item.adset_name, item.name_3, item.name)),
    campaign_id: pickFirstIdentifier(item.campaign_id_3, item.campaign_id, item.campaign_id_2, nestedCampaign.id),
    account_id: pickFirstIdentifier(item.account_id_3, item.account_id),
    status: safeString(pickFirstValue(item.adset_status, item.status_3, item.status_2, item.status)),
    effective_status: safeString(pickFirstValue(item.adset_effective_status, item.effective_status_3, item.effective_status_2, item.effective_status)),
    configured_status: safeString(pickFirstValue(item.adset_configured_status, item.configured_status_3, item.configured_status)),
    bid_amount: pickFirstValue(item.bid_amount_3, item.bid_amount),
    bid_constraints: deepClone(item.bid_constraints_3 || item.bid_constraints || {}),
    bid_strategy: safeString(pickFirstValue(item.bid_strategy_3, item.bid_strategy)),
    billing_event: safeString(pickFirstValue(item.billing_event_3, item.billing_event)),
    budget_remaining: pickFirstValue(item.budget_remaining_3, item.budget_remaining),
    destination_type: safeString(pickFirstValue(item.destination_type_3, item.destination_type)),
    daily_budget: pickFirstValue(item.daily_budget_3, item.daily_budget),
    lifetime_budget: pickFirstValue(item.lifetime_budget_3, item.lifetime_budget),
    optimization_goal: safeString(pickFirstValue(item.optimization_goal_3, item.optimization_goal)),
    promoted_object: deepClone(item.promoted_object_3 || item.promoted_object || {}),
    targeting: deepClone(item.targeting_3 || item.targeting || {}),
    targeting_optimization_types: deepClone(item.targeting_optimization_types_3 || item.targeting_optimization_types || {}),
    attribution_spec: deepClone(item.attribution_spec_3 || item.attribution_spec || []),
    campaign: removeEmptyFields({
      id: safeString(nestedCampaign.id),
      name: safeString(nestedCampaign.name),
      objective: safeString(nestedCampaign.objective),
      buying_type: safeString(nestedCampaign.buying_type),
      status: safeString(nestedCampaign.status),
      effective_status: safeString(nestedCampaign.effective_status),
    }),
  });
}

function buildEntityContext(source, paramsNode) {
  const ad = buildAdSnapshot(source);
  const creative = buildCreativeSnapshot(source);
  const adset = buildAdsetSnapshot(source);
  const campaign = deepClone(adset.campaign || {});

  return removeEmptyFields({
    account_id: pickFirstIdentifier(adset.account_id, source.account_id_3, source.account_id, paramsNode.account_id),
    campaign_id: pickFirstIdentifier(campaign.id, source.campaign_id_3, source.campaign_id),
    campaign_name: safeString(pickFirstValue(source.campaign_name, campaign.name)),
    adset_id: pickFirstIdentifier(adset.id, source.adset_id, source.id_3, source.id),
    adset_name: safeString(pickFirstValue(source.adset_name, adset.name, source.name_3, source.name)),
    ad_id: pickFirstIdentifier(ad.id, source.ad_id, source.id_1, source.id),
    ad_name: safeString(pickFirstValue(source.ad_name, ad.name, source.name_1, source.name)),
    creative_id: pickFirstIdentifier(creative.id, source.creative_id, source.id_2),
    creative_name: safeString(pickFirstValue(source.creative_name, creative.name, source.name_2)),
    page_id: safeString(
      creative.object_story_spec?.page_id ||
      adset.promoted_object?.page_id
    ),
    instagram_user_id: safeString(
      creative.object_story_spec?.instagram_user_id ||
      creative.object_story_spec?.instagram_actor_id ||
      adset.promoted_object?.instagram_user_id
    ),
    campaign_objective: safeString(source.objective || campaign.objective),
    optimization_goal: safeString(source.optimization_goal || adset.optimization_goal),
    destination_type: safeString(source.destination_type || adset.destination_type),
    bid_strategy: safeString(source.bid_strategy || adset.bid_strategy),
    billing_event: safeString(source.billing_event || adset.billing_event),
    buying_type: safeString(source.buying_type || campaign.buying_type),
    ad_status: safeString(ad.status),
    ad_effective_status: safeString(ad.effective_status),
    ad_configured_status: safeString(ad.configured_status),
    creative_status: safeString(creative.status),
    adset_status: safeString(adset.status),
    adset_effective_status: safeString(adset.effective_status),
    campaign_status: safeString(campaign.status),
    campaign_effective_status: safeString(campaign.effective_status),
    ad,
    creative,
    adset,
    campaign,
  });
}

function buildRunContext(now, paramsNode, reportMode, storageConfig) {
  const requestedAt = now.toISOString();
  const reportAnchorDate = formatDateParts(getLocalDateParts(now, WORKFLOW_TIMEZONE));
  const scheduleMode = safeString(
    paramsNode.schedule_mode ||
    paramsNode.trigger_mode ||
    'manual'
  ) || 'manual';
  const runSeed = [
    WORKFLOW_NAME,
    reportAnchorDate,
    safeString(paramsNode.account_id),
    reportMode,
    scheduleMode,
  ].join('|');
  const attemptSeed = [runSeed, requestedAt].join('|');

  return removeEmptyFields({
    run_id: `meta_ads_performance_report_${reportAnchorDate}_${hashString(runSeed)}`,
    run_attempt_id: `meta_ads_performance_attempt_${reportAnchorDate}_${hashString(attemptSeed)}`,
    workflow_name: WORKFLOW_NAME,
    workflow_version_hint: 'browser-synced-local',
    requested_at: requestedAt,
    report_anchor_date: reportAnchorDate,
    report_mode: reportMode,
    schedule_mode: scheduleMode,
    timezone: WORKFLOW_TIMEZONE,
    storage: storageConfig,
  });
}

function buildRequestIdentity(runContext, commonPayload, variantParts) {
  const seed = [
    runContext.run_id,
    commonPayload.metrics_group_key,
    commonPayload.scope_type,
    variantParts.window,
    variantParts.request_kind,
    variantParts.request_variant,
    variantParts.breakdown_key || '',
  ].join('|');

  const requestHash = hashString(seed);
  const auditKey = [
    commonPayload.metrics_group_key,
    commonPayload.scope_type,
    variantParts.window,
    commonPayload.report_date,
  ].join('|');

  return {
    request_key: [
      commonPayload.metrics_group_key,
      commonPayload.scope_type,
      variantParts.window,
      variantParts.request_variant,
      variantParts.breakdown_key || 'core',
      requestHash,
    ].join('|'),
    audit_key: auditKey,
    raw_payload_key: [
      'meta-ads',
      'performance-report',
      commonPayload.report_date,
      normalizeKeyFragment(commonPayload.metrics_group_key),
      commonPayload.scope_type,
      variantParts.window,
      variantParts.request_variant,
      variantParts.breakdown_key || 'core',
      `${requestHash}.json`,
    ].join('/'),
  };
}

function pushJob(outputs, payload) {
  outputs.push({ json: payload });
}

const paramsNode = $('Params').first()?.json || {};
const inputItems = $input.all();
const now = new Date();

const reportMode = normalizeReportMode(
  paramsNode.report_mode ||
  paramsNode.insights_mode ||
  paramsNode.metrics_mode ||
  paramsNode.performance_report_mode
);
const fieldSet = FIELD_SETS[reportMode];
const storageConfig = buildStorageConfig({}, paramsNode);
const runContext = buildRunContext(now, paramsNode, reportMode, storageConfig);

const range24h = buildTimeRange(-1, now, WORKFLOW_TIMEZONE);
const range30d = buildTimeRange(-29, now, WORKFLOW_TIMEZONE);
const outputs = [];

for (const item of inputItems) {
  const source = deepClone(item.json || {});
  const apiVersion = safeString(source.api_version || paramsNode.api_version || DEFAULT_API_VERSION) || DEFAULT_API_VERSION;
  const entityContext = buildEntityContext(source, paramsNode);
  const adId = safeString(entityContext.ad_id);
  const adsetId = safeString(entityContext.adset_id);
  const campaignId = safeString(entityContext.campaign_id);
  const accountId = safeString(entityContext.account_id || paramsNode.account_id);
  const creativeId = safeString(entityContext.creative_id);
  const metricsGroupKey = [adId, accountId, adsetId].filter(Boolean).join(':') || adId;
  const reportDate = range24h.until;

  const scopeValues = {
    ad: adId,
    adset: adsetId,
    campaign: campaignId,
  };

  for (const scope of SCOPES) {
    const scopeId = safeString(scopeValues[scope.key]);
    if (!scopeId) continue;

    const commonPayload = {
      run_context: deepClone(runContext),
      metrics_group_key: metricsGroupKey,
      report_mode: reportMode,
      requested_at: runContext.requested_at,
      report_date: reportDate,
      account_id: accountId,
      api_version: apiVersion,
      ad_id: adId,
      adset_id: adsetId,
      campaign_id: campaignId,
      creative_id: creativeId,
      scope_type: scope.key,
      scope_id: scopeId,
      level: scope.level,
      entity_context: deepClone(entityContext),
    };

    {
      const params = [
        ['level', scope.level],
        ['fields', fieldSet.hourly.join(',')],
        ['time_range', JSON.stringify(range24h)],
        ['breakdowns', 'hourly_stats_aggregated_by_advertiser_time_zone'],
        ['limit', '100'],
      ];

      const identity = buildRequestIdentity(runContext, commonPayload, {
        window: 'last_24h',
        request_kind: 'core',
        request_variant: 'hourly',
      });

      pushJob(outputs, {
        ...commonPayload,
        ...identity,
        request_kind: 'core',
        request_variant: 'hourly',
        source_kind_hint: 'hourly',
        window: 'last_24h',
        request_fields: deepClone(fieldSet.hourly),
        time_range: deepClone(range24h),
        insights_url: makeInsightsUrl(apiVersion, scopeId, params),
      });
    }

    {
      const params = [
        ['level', scope.level],
        ['fields', fieldSet.summary.join(',')],
        ['time_range', JSON.stringify(range24h)],
      ];

      const identity = buildRequestIdentity(runContext, commonPayload, {
        window: 'last_24h',
        request_kind: 'core',
        request_variant: 'summary',
      });

      pushJob(outputs, {
        ...commonPayload,
        ...identity,
        request_kind: 'core',
        request_variant: 'summary',
        source_kind_hint: 'summary',
        window: 'last_24h',
        request_fields: deepClone(fieldSet.summary),
        time_range: deepClone(range24h),
        insights_url: makeInsightsUrl(apiVersion, scopeId, params),
      });
    }

    {
      const params = [
        ['level', scope.level],
        ['fields', fieldSet.summary.join(',')],
        ['time_range', JSON.stringify(range30d)],
        ['time_increment', '1'],
        ['limit', '100'],
      ];

      const identity = buildRequestIdentity(runContext, commonPayload, {
        window: 'multi_window',
        request_kind: 'core',
        request_variant: 'daily_rollup',
      });

      pushJob(outputs, {
        ...commonPayload,
        ...identity,
        request_kind: 'core',
        request_variant: 'daily_rollup',
        source_kind_hint: 'derived',
        window: 'multi_window',
        derived_windows: ['last_7d', 'last_30d'],
        request_fields: deepClone(fieldSet.summary),
        time_range: deepClone(range30d),
        insights_url: makeInsightsUrl(apiVersion, scopeId, params),
      });
    }

    for (const breakdownVariant of fieldSet.breakdownVariants) {
      if (fieldSet.breakdownWindows.includes('last_24h')) {
        const params = [
          ['level', scope.level],
          ['fields', fieldSet.breakdown.join(',')],
          ['time_range', JSON.stringify(range24h)],
          ['breakdowns', breakdownVariant.breakdowns.join(',')],
          ['limit', fieldSet.breakdownLimit24h],
        ];

        const identity = buildRequestIdentity(runContext, commonPayload, {
          window: 'last_24h',
          request_kind: 'breakdown',
          request_variant: 'breakdown_summary_24h',
          breakdown_key: breakdownVariant.key,
        });

        pushJob(outputs, {
          ...commonPayload,
          ...identity,
          request_kind: 'breakdown',
          request_variant: 'breakdown_summary_24h',
          source_kind_hint: 'summary',
          window: 'last_24h',
          breakdown_key: breakdownVariant.key,
          breakdowns: deepClone(breakdownVariant.breakdowns),
          request_fields: deepClone(fieldSet.breakdown),
          time_range: deepClone(range24h),
          insights_url: makeInsightsUrl(apiVersion, scopeId, params),
        });
      }

      const derivedWindows = ['last_7d', 'last_30d'].filter((windowKey) => fieldSet.breakdownWindows.includes(windowKey));
      if (!derivedWindows.length) continue;

      const params = [
        ['level', scope.level],
        ['fields', fieldSet.breakdown.join(',')],
        ['time_range', JSON.stringify(range30d)],
        ['breakdowns', breakdownVariant.breakdowns.join(',')],
        ['time_increment', '1'],
        ['limit', fieldSet.breakdownLimitRollup],
      ];

      const identity = buildRequestIdentity(runContext, commonPayload, {
        window: 'multi_window',
        request_kind: 'breakdown',
        request_variant: 'breakdown_daily_rollup',
        breakdown_key: breakdownVariant.key,
      });

      pushJob(outputs, {
        ...commonPayload,
        ...identity,
        request_kind: 'breakdown',
        request_variant: 'breakdown_daily_rollup',
        source_kind_hint: 'derived',
        window: 'multi_window',
        derived_windows: derivedWindows,
        breakdown_key: breakdownVariant.key,
        breakdowns: deepClone(breakdownVariant.breakdowns),
        request_fields: deepClone(fieldSet.breakdown),
        time_range: deepClone(range30d),
        insights_url: makeInsightsUrl(apiVersion, scopeId, params),
      });
    }
  }
}

return outputs.length ? outputs : [{
  json: {
    result: 'ERROR',
    is_valid: false,
    error_message: 'Build Insights não gerou nenhum job.',
  },
}];
