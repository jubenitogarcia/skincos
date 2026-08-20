import { readBoundedText } from './bounded-body.js';

const PREFIX = '/v1/meta-ads-publish';
const GRAPH_ORIGIN = 'https://graph.facebook.com';
const GRAPH_VIDEO_ORIGIN = 'https://graph-video.facebook.com';
const LOCK_TTL_MS = 30 * 60 * 1000;
const GRAPH_TIMEOUT_MS = 60 * 1000;
const MAX_RETRY_WINDOW_MS = 5 * 60 * 1000;
const MAX_GRAPH_ATTEMPTS = 3;
const IMAGE_PROPAGATION_SUBCODE = 2446386;
const CREATIVE_RETRY_SUBCODE = 1487390;
const IMAGE_PROPAGATION_BASE_DELAY_MS = 15 * 1000;
const MAX_AD_PAGES = 20;
const MAX_ADS = 2000;
const CREATIVE_READ_FIELDS = Object.freeze([
  'id',
  'name',
  'object_story_spec',
  'asset_feed_spec',
  'url_tags',
  'degrees_of_freedom_spec',
  'creative_sourcing_spec',
]);
const ADSET_PLACEMENT_FIELDS = [
  'id',
  'campaign{id,objective}',
  'billing_event',
  'optimization_goal',
  'destination_type',
  'attribution_spec',
  'promoted_object',
  'targeting{publisher_platforms,facebook_positions,instagram_positions,audience_network_positions,whatsapp_positions,effective_publisher_platforms,effective_facebook_positions,effective_instagram_positions,effective_audience_network_positions,effective_whatsapp_positions}',
].join(',');
const ADSET_READ_FIELDS = [
  'id',
  'name',
  'campaign_id',
  'status',
  'billing_event',
  'optimization_goal',
  'destination_type',
  'bid_strategy',
  'daily_budget',
  'lifetime_budget',
  'start_time',
  'end_time',
  'attribution_spec',
  'promoted_object',
  'targeting',
].join(',');
// Narrow readback used by the diagnostic runner. Unlike get_adset it never
// reads targeting, budget, dates, names or raw identifiers into the journal.
const ADSET_CONVERSION_CONTRACT_FIELDS = [
  'account_id',
  'campaign{objective}',
  'billing_event',
  'optimization_goal',
  'destination_type',
  'attribution_spec',
  'promoted_object',
].join(',');
// The autonomous legacy bootstrap may inspect candidate source ad sets, but it
// must not use the broad inventory endpoint or persist raw account inventory.
const TRACKING_PROMOTED_OBJECT_KEYS = Object.freeze([
  'pixel_id',
  'custom_event_type',
  'custom_conversion_id',
  'offline_conversion_data_set_id',
]);
// A Website profile may omit a website event only when both the campaign and
// optimization objective are explicitly known to be non-conversion delivery.
// Meta adds delivery goals over time, so an unknown goal must never silently
// inherit the optional branch.  In particular, VALUE is a conversion goal even
// though it does not contain the word CONVERSION.
const WEBSITE_EVENT_REQUIRED_OPTIMIZATION_GOALS = new Set([
  'OFFSITE_CONVERSIONS',
  'APP_INSTALLS_AND_OFFSITE_CONVERSIONS',
  'CONVERSIONS',
  'VALUE',
  'VALUE_OPTIMIZATION',
  'PURCHASE',
  'SALES',
  'LEAD_GENERATION',
]);
const WEBSITE_EVENT_OPTIONAL_OPTIMIZATION_GOALS = new Set([
  'LINK_CLICKS',
  'LANDING_PAGE_VIEWS',
  'REACH',
  'IMPRESSIONS',
  'THRUPLAY',
  'VIDEO_VIEWS',
  'POST_ENGAGEMENT',
  'PAGE_LIKES',
  'EVENT_RESPONSES',
]);
const WEBSITE_EVENT_REQUIRED_CAMPAIGN_OBJECTIVES = new Set([
  'OUTCOME_SALES',
  'OUTCOME_LEADS',
  'OUTCOME_APP_PROMOTION',
]);
const WEBSITE_EVENT_OPTIONAL_CAMPAIGN_OBJECTIVES = new Set([
  'OUTCOME_TRAFFIC',
  'OUTCOME_AWARENESS',
  'OUTCOME_ENGAGEMENT',
]);
const CAMPAIGN_READ_FIELDS = [
  'id',
  'name',
  'objective',
  'buying_type',
  'special_ad_categories',
  'is_adset_budget_sharing_enabled',
  'status',
].join(',');
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 90 * 1024 * 1024;
const MAX_VIDEO_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_MULTIPART_REQUEST_BYTES = MAX_VIDEO_CHUNK_BYTES + 1024 * 1024;
const MAX_BATCH_JOBS = 50;
const MAX_LANDING_REDIRECTS = 5;
const PAUSED_CALIBRATION_CAMPAIGN_OBJECTIVES = new Set(['OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS']);
const WHATSAPP_HOSTS = new Set(['wa.me', 'api.whatsapp.com']);
const ALLOWED_CREATIVE_FEATURES = new Set([
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
const FORBIDDEN_CREATIVE_FEATURES = new Set([
  'image_template',
  'media_type_automation',
  'show_summary',
  'audio',
  'standard_enhancements',
]);
const REQUIRED_CREATIVE_FEATURES = Object.freeze([
  'add_text_overlay',
  'image_touchups',
  'text_optimizations',
  'inline_comment',
  'enhance_cta',
  'image_brightness_and_contrast',
  'reveal_details_over_time',
  'show_destination_blurbs',
  'image_animation',
]);
const TERMINAL_RUN_STATES = new Set(['completed', 'rolled_back']);
const VIDEO_UPLOAD_ACTIONS = Object.freeze([
  'start_video_upload',
  'transfer_video_chunk',
  'finish_video_upload',
  'get_video_status',
]);
// This revision is deliberately returned with the public (non-secret) gateway
// capabilities.  The workflow rejects a mismatch before it can open a publish
// run, so a partial rollout cannot silently mix producer, checkpoint and
// gateway behavior.
const WORKFLOW_CONTRACT_REVISION = 'meta_destination_contract_v20_tracking_reconciliation';
const CONFIG_WRITER_LOCK_RESOURCE_KEY = 'meta_ads_publish_config_authority';
const CONFIG_WRITER_LOCK_TTL_MS = 60 * 1000;
const CONFIG_WRITER_MAX_REQUEST_BYTES = 150 * 1024;
const BOOTSTRAP_LOCK_TTL_MS = 15 * 60 * 1000;
// A bootstrap holds the same authority lease as the normal writer. Keeping
// this batch deliberately small makes its renewable lease observable and
// prevents a broad legacy migration from starving normal configuration work.
const BOOTSTRAP_MAX_ENTRIES = 10;
const BOOTSTRAP_OPERATION_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,160}$/;
const STAGING_EXERCISE_OPERATION_KEY_PATTERN = /^staging-tracking-fixture:[A-Za-z0-9_.:-]{8,120}$/;
const STAGING_SYNTHETIC_SEED_OPERATION_KEY_PATTERN = /^meta-ads-staging-seed:[A-Za-z0-9_.:-]{8,140}$/;
const STAGING_SYNTHETIC_SEED_MAX_REQUEST_BYTES = 16 * 1024;
const STAGING_SYNTHETIC_SEED_CONTRACT = 'meta-ads-tracking-v20/staging-synthetic-seed/v2';
const STAGING_SYNTHETIC_SEED_ATTEST_MAX_GRAPH_ATTEMPTS = 1;
const STAGING_SYNTHETIC_SEED_UNIT = 'meta-ads-tracking-staging-synthetic';
const STAGING_SYNTHETIC_SEED_SOURCE_TOKEN_TYPE = 'staging_synthetic_source';
const STAGING_SYNTHETIC_SEED_TARGET_TOKEN_TYPE = 'staging_synthetic_target';
const STAGING_SYNTHETIC_SEED_LOCK_TTL_MS = 15 * 60 * 1000;
const STAGING_SYNTHETIC_SEED_MAX_GRAPH_OBJECTS = 5;
const STAGING_SYNTHETIC_SEED_LANDING_GROUP = 'staging_tracking_fixture';
const STAGING_SYNTHETIC_SEED_CREATIVE_MESSAGE = 'SKINCOS staging tracking verification';
const STAGING_SYNTHETIC_SEED_CREATIVE_CTA = 'LEARN_MORE';
// The staging seed has two independently governed Website destinations. Their
// selectors are supplied only in the candidate request body, never as Worker
// bindings. Keep the source/target seed lineage stable while assigning its
// resulting configuration rows deterministically to the two destinations.
const STAGING_SYNTHETIC_SEED_DESTINATIONS = Object.freeze([
  Object.freeze({
    key: 'novo_hamburgo',
    credentialKey: 'source',
    destinationGroup: 'meta-ads-tracking-staging-novo-hamburgo',
  }),
  Object.freeze({
    key: 'barra_shopping_sul',
    credentialKey: 'target',
    destinationGroup: 'meta-ads-tracking-staging-barra-shopping-sul',
  }),
]);
const STAGING_SYNTHETIC_SEED_DESTINATION_KEYS = new Set(
  STAGING_SYNTHETIC_SEED_DESTINATIONS.map((destination) => destination.key),
);
// Meta's current Page API can return either the legacy ADVERTISE task or its
// Profile Plus equivalent for the same narrow creative/advertising capability.
// Do not broaden this to other PROFILE_PLUS_* tasks: the seed needs an
// explicit advertising grant and must remain fail-closed for every other task.
const STAGING_SYNTHETIC_SEED_PAGE_ADVERTISE_TASKS = new Set([
  'ADVERTISE',
  'PROFILE_PLUS_ADVERTISE',
]);
const STAGING_SYNTHETIC_SEED_DISCOVERY_FAILURES = Object.freeze({
  sourceUnavailable: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  sourceAuthRejected: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  pixelAccessDenied: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  pixelAccountRelationAccessDenied: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  pixelAccountRelationAmbiguous: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  pageAccessDenied: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  datasetAccessDenied: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  // Keep the mutation-capable seed's historical generic response, while
  // allowing the read-only attestation to classify a successful but
  // schema-incompatible AdsDataset envelope separately.
  datasetContractInvalid: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  identityMismatch: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  identityMalformed: 'meta_ads_publish_staging_seed_graph_identity_invalid',
  pageAmbiguous: 'meta_ads_publish_staging_seed_graph_page_ambiguous',
  datasetAmbiguous: 'meta_ads_publish_staging_seed_graph_dataset_ambiguous',
  landingOrMediaUnavailable: 'meta_ads_publish_staging_seed_landing_or_media_unavailable',
});
const STAGING_SYNTHETIC_SEED_ATTESTATION_FAILURES = Object.freeze({
  sourceUnavailable: 'meta_ads_publish_staging_seed_graph_source_unavailable',
  sourceAuthRejected: 'meta_ads_publish_staging_seed_graph_source_auth_rejected',
  pixelAccessDenied: 'meta_ads_publish_staging_seed_graph_pixel_access_denied',
  pixelAccountRelationAccessDenied: 'meta_ads_publish_staging_seed_graph_pixel_account_relation_denied',
  pixelAccountRelationAmbiguous: 'meta_ads_publish_staging_seed_graph_pixel_account_relation_ambiguous',
  appSecretProofMismatch: 'meta_ads_publish_staging_seed_graph_appsecret_proof_mismatch',
  appSecretProofUnavailable: 'meta_ads_publish_staging_seed_graph_appsecret_proof_unavailable',
  pageAccessDenied: 'meta_ads_publish_staging_seed_graph_page_access_denied',
  datasetAccessDenied: 'meta_ads_publish_staging_seed_graph_dataset_access_denied',
  datasetContractInvalid: 'meta_ads_publish_staging_seed_graph_contract_invalid',
  identityMismatch: 'meta_ads_publish_staging_seed_graph_identity_mismatch',
  identityMalformed: 'meta_ads_publish_staging_seed_graph_identity_malformed',
  pageAmbiguous: 'meta_ads_publish_staging_seed_graph_page_ambiguous',
  datasetAmbiguous: 'meta_ads_publish_staging_seed_graph_dataset_ambiguous',
  landingOrMediaUnavailable: 'meta_ads_publish_staging_seed_landing_or_media_unavailable',
});
const STAGING_SYNTHETIC_SEED_ADSET_FIELDS = [
  'id',
  'name',
  'account_id',
  'campaign{id,objective}',
  'campaign_id',
  'status',
  'billing_event',
  'optimization_goal',
  'destination_type',
  'attribution_spec',
  'promoted_object',
].join(',');
const BOOTSTRAP_FIXTURE_NAME_PREFIX = 'Meta Ads URL Tags Fixture';
const BOOTSTRAP_AD_FIELDS = [
  'id',
  'adset_id',
  'status',
  'effective_status',
  'creative{id,name,url_tags,object_story_spec,asset_feed_spec}',
].join(',');
const CONFIG_WRITER_TOKEN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const CONFIG_WRITER_OPERATION_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,160}$/;
const CONFIG_WRITER_TOP_LEVEL_KEYS = new Set([
  'row_number',
  'destination_group',
  'api_version',
  'account_id',
  'campaign_id',
  'adset_id',
  'page_id',
  'instagram_user_id',
  'allowed_link_hosts',
  'landing_pages_by_creative_group',
  'freshness_window_days',
  'destination_type',
  'whatsapp_destination_url',
  'tracking_contract',
  'tracking_profiles',
  'carousel_native_campaign_id',
  'carousel_native_adset_id',
  'carousel_native_adset_verified',
  'carousel_native_route_active',
]);
const CONFIG_WRITER_TRACKING_CONTRACT_KEYS = new Set([
  'url_tags',
  'profile_ref',
  'production_url_tags_readback_fixture',
]);
const CONFIG_WRITER_TRACKING_PROFILE_KEYS = new Set([
  'source_adset_id',
  'destination_kind',
  'website_event_requirement',
  'offline_event_dataset_requirement',
  'staging_synthetic_fixture',
  'authorized_destination_adset_ids',
]);
const CONFIG_WRITER_FIXTURE_KEYS = new Set(['ad_id', 'creative_id']);
const CONFIG_WRITER_CAROUSEL_KEYS = [
  'carousel_native_campaign_id',
  'carousel_native_adset_id',
  'carousel_native_adset_verified',
  'carousel_native_route_active',
];
const CONFIG_WRITER_ERROR_CODES = new Set([
  'meta_ads_publish_config_request_invalid',
  'meta_ads_publish_config_request_too_large',
  'meta_ads_publish_config_token_id_invalid',
  'meta_ads_publish_config_operation_key_invalid',
  'meta_ads_publish_config_expected_tracking_binding_revision_invalid',
  'meta_ads_publish_config_invalid',
  'meta_ads_publish_config_token_not_eligible',
  'meta_ads_publish_config_binding_not_ready',
  'meta_ads_publish_config_binding_stale',
  'meta_ads_publish_config_operation_conflict',
  'meta_ads_publish_config_operation_in_progress',
  'meta_ads_publish_config_operation_state_stale',
  'meta_ads_publish_config_locked',
  'meta_ads_publish_config_readback_mismatch',
  'meta_ads_publish_config_authority_unavailable',
]);
const MUTATING_ACTIONS = new Set([
  'upload_image',
  'start_video_upload',
  'transfer_video_chunk',
  'finish_video_upload',
  'create_creative',
  'create_campaign',
  'create_adset',
  'ensure_adset_conversion_contract',
  'rollback_adset_conversion_contract',
  'promote_native_carousel_route',
  'stage_batch',
  'activate_batch',
  'rollback_batch',
]);
const ALLOWED_ACTIONS = new Set([
  'list_ads',
  'upload_image',
  ...VIDEO_UPLOAD_ACTIONS,
  'create_creative',
  'get_creative',
  'get_ad',
  'get_adset',
  'read_adset_conversion_contract',
  'read_authorized_creative_url_tags_contract',
  'ensure_adset_conversion_contract',
  'rollback_adset_conversion_contract',
  'get_campaign',
  'create_campaign',
  'create_adset',
  'promote_native_carousel_route',
  'stage_batch',
  'activate_batch',
  'rollback_batch',
]);

const AD_INVENTORY_FIELDS = [
  'id',
  'name',
  'status',
  'effective_status',
  'created_time',
  'updated_time',
  'adset_id',
  'campaign_id',
  'creative{id,name,object_story_spec,asset_feed_spec}',
  'adset{id,name,campaign_id}',
  'campaign{id,name}',
].join(',');

const AD_STATE_FIELDS = [
  'id',
  'name',
  'status',
  'effective_status',
  'created_time',
  'updated_time',
  'adset_id',
  'campaign_id',
  'creative{id,name}',
].join(',');

export function isMetaAdsPublishPath(pathname) {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

export async function handleMetaAdsPublishRequest(input) {
  const { request, env, requestId, pathname, decryptToken, encryptToken, writeAudit } = input;

  if (request.method === 'GET' && pathname === `${PREFIX}/config`) {
    return getConfig(env, requestId);
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/bootstrap`) {
    return bootstrapMetaAdsPublishConfig({ request, env, requestId, decryptToken, encryptToken, writeAudit });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/bootstrap/derive-plan`) {
    return deriveMetaAdsPublishBootstrapPlan({ request, env, requestId, decryptToken });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/bootstrap/derive`) {
    return bootstrapMetaAdsPublishConfigFromDerivedPlan({ request, env, requestId, decryptToken, encryptToken, writeAudit });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/staging-synthetic-seed/attest`) {
    return attestStagingSyntheticMetaAdsTracking({ request, env, requestId });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/staging-synthetic-seed/attest-appsecret-proof`) {
    return attestStagingSyntheticMetaAdsTrackingAppSecretProof({ request, env, requestId });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/staging-synthetic-seed/reconcile`) {
    return reconcileStagingSyntheticMetaAdsTracking({ request, env, requestId, decryptToken, encryptToken, writeAudit });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/staging-synthetic-seed`) {
    return seedStagingSyntheticMetaAdsTracking({ request, env, requestId, encryptToken, writeAudit });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/staging-synthetic-seed/rollback`) {
    return rollbackStagingSyntheticMetaAdsTracking({ request, env, requestId, decryptToken, encryptToken, writeAudit });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/bootstrap/rollback`) {
    return rollbackBootstrapMetaAdsPublishConfig({ request, env, requestId, decryptToken, encryptToken, writeAudit });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/config/staging-exercise`) {
    return exerciseStagingMetaAdsTrackingFixture({ request, env, requestId, decryptToken, encryptToken, writeAudit });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/inventory`) {
    return getInventory({ request, env, requestId, decryptToken, writeAudit });
  }

  if (request.method === 'POST' && pathname === `${PREFIX}/runs`) {
    return createOrResumeRun(request, env, requestId);
  }

  const runMatch = pathname.match(/^\/v1\/meta-ads-publish\/runs\/([^/]+)$/);
  if (request.method === 'GET' && runMatch) {
    return getRun(decodeURIComponent(runMatch[1]), env, requestId);
  }
  if (request.method === 'PATCH' && runMatch) {
    return updateRun(decodeURIComponent(runMatch[1]), request, env, requestId);
  }

  const heartbeatMatch = pathname.match(/^\/v1\/meta-ads-publish\/runs\/([^/]+)\/heartbeat$/);
  if (request.method === 'POST' && heartbeatMatch) {
    return heartbeatRun(decodeURIComponent(heartbeatMatch[1]), env, requestId);
  }

  const eventMatch = pathname.match(/^\/v1\/meta-ads-publish\/runs\/([^/]+)\/events$/);
  if (request.method === 'POST' && eventMatch) {
    return claimEvent(decodeURIComponent(eventMatch[1]), request, env, requestId);
  }

  const operationMatch = pathname.match(/^\/v1\/meta-ads-publish\/runs\/([^/]+)\/operations$/);
  if (request.method === 'POST' && operationMatch) {
    return executeOperation({
      runId: decodeURIComponent(operationMatch[1]),
      request,
      env,
      requestId,
      decryptToken,
      encryptToken,
      writeAudit,
    });
  }

  return response({ ok: false, error: 'meta_ads_publish_not_found', requestId }, 404);
}

// This writer is intentionally separate from the token CRUD endpoints.  The
// credential ciphertext is never accepted, decrypted, or re-encrypted here:
// the only mutable subtree is metadata.meta_ads_publish.
export async function updateMetaAdsPublishConfig({ request, env, requestId }) {
  try {
    const body = await readConfigWriterRequest(request);
    const input = await validateConfigWriterInput(body);
    const result = await applyMetaAdsPublishConfigAtomically({ input, env, requestId });
    return configWriterSuccessResponse({
      replayed: result.replayed,
      revision: result.revision,
      requestId,
    }, result.status);
  } catch (error) {
    return configWriterFailureResponse(error, requestId);
  }
}

// Both the administrative writer and the narrowly-scoped bootstrap saga use
// this core.  It deliberately accepts an already validated input rather than
// an HTTP request so the bootstrap never re-enters the public handler.
async function applyMetaAdsPublishConfigAtomically({ input, env, requestId, lockAlreadyHeld = false, assertLease = null }) {
  let lockOwner = '';
  let lockAcquired = false;
  try {
    if (!env?.TOKEN_VAULT_DB || typeof env.TOKEN_VAULT_DB.batch !== 'function') {
      throw configWriterFailure('meta_ads_publish_config_authority_unavailable', 503);
    }
    if (
      clean(env.ENVIRONMENT).toLowerCase() !== 'staging' &&
      safeArray(input?.updates).some((update) => hasStagingSyntheticFixture(update?.metaAdsPublish))
    ) {
      throw configWriterFailure('meta_ads_publish_config_invalid', 409);
    }

    if (!lockAlreadyHeld) {
      lockOwner = crypto.randomUUID();
      await acquireConfigWriterLock(env, lockOwner);
      lockAcquired = true;
    } else if (typeof assertLease !== 'function') {
      throw configWriterFailure('meta_ads_publish_config_locked', 409);
    }

    if (assertLease) await assertLease();

    const existingOperation = await dbFirst(
      env,
      [
        'SELECT operation_key, target_token_ids_json, request_hash, resulting_tracking_binding_revision, status',
        'FROM meta_ads_publish_config_operations WHERE operation_key = ?',
      ].join(' '),
      input.operationKey,
    );
    const currentRows = await listMetaAdsPublishConfigRows(env);
    const currentAuthority = await configWriterAuthorityState(currentRows);

    if (existingOperation) {
      if (clean(existingOperation.request_hash) !== input.requestHash) {
        throw configWriterFailure('meta_ads_publish_config_operation_conflict', 409);
      }
      if (clean(existingOperation.status) !== 'applied') {
        throw configWriterFailure('meta_ads_publish_config_operation_in_progress', 409);
      }
      if (
        !currentAuthority.ready ||
        clean(existingOperation.resulting_tracking_binding_revision) !== currentAuthority.revision
      ) {
        throw configWriterFailure('meta_ads_publish_config_operation_state_stale', 409);
      }
      return {
        replayed: true,
        revision: currentAuthority.revision,
        status: 200,
      };
    }

    if (currentAuthority.revision !== input.expectedTrackingBindingRevision) {
      throw configWriterFailure('meta_ads_publish_config_binding_stale', 409);
    }

    const plans = input.updates.map((update) => {
      const target = currentRows.find((row) => clean(row.id) === update.tokenId);
      if (!target || Number(target.active) !== 1) {
        throw configWriterFailure('meta_ads_publish_config_token_not_eligible', 409);
      }
      const previousMetadata = parseConfigWriterMetadata(target.metadata_json);
      const nextMetadata = {
        ...previousMetadata,
        meta_ads_publish: update.metaAdsPublish,
      };
      return {
        tokenId: update.tokenId,
        target,
        nextMetadataJson: JSON.stringify(nextMetadata),
      };
    });
    const plansByTokenId = new Map(plans.map((plan) => [plan.tokenId, plan]));
    const candidateRows = currentRows.map((row) => (
      plansByTokenId.has(clean(row.id))
        ? { ...row, metadata_json: plansByTokenId.get(clean(row.id)).nextMetadataJson }
        : row
    ));
    const candidateAuthority = await configWriterAuthorityState(candidateRows);
    if (!candidateAuthority.ready) {
      throw configWriterFailure('meta_ads_publish_config_invalid', 400);
    }

    const operationId = crypto.randomUUID();
    const now = nowIso();
    const auditMetadata = JSON.stringify({
      contract_revision: WORKFLOW_CONTRACT_REVISION,
      operation: 'meta_ads_publish_config_update',
      prior_tracking_binding_revision: currentAuthority.revision,
      resulting_tracking_binding_revision: candidateAuthority.revision,
      target_count: plans.length,
    });
    const batchStatements = [
      env.TOKEN_VAULT_DB.prepare([
        'INSERT INTO meta_ads_publish_config_operations (',
        'id, operation_key, target_token_ids_json, request_hash, expected_tracking_binding_revision,',
        'resulting_tracking_binding_revision, status, created_at, updated_at',
        ') VALUES (?, ?, ?, ?, ?, ?, \'pending\', ?, ?)',
        'ON CONFLICT(operation_key) DO NOTHING',
      ].join(' ')).bind(
        operationId,
        input.operationKey,
        input.targetTokenIdsJson,
        input.requestHash,
        input.expectedTrackingBindingRevision,
        candidateAuthority.revision,
        now,
        now,
      ),
      buildConfigWriterAtomicMetadataUpdate(env, {
        plans,
        now,
        operationId,
        requestHash: input.requestHash,
      }),
      buildConfigWriterAppliedOperationUpdate(env, {
        plans,
        now,
        operationId,
      }),
    ];
    for (const plan of plans) {
      batchStatements.push(env.TOKEN_VAULT_DB.prepare([
        'INSERT INTO credential_token_audit (',
        'id, token_id, event, provider, unit, token_type, status, request_id, metadata_json',
        ') SELECT ?, ?, \'meta_ads_publish.config.update\', \'facebook\', ?, ?, \'ok\', ?, ?',
        'WHERE EXISTS (SELECT 1 FROM meta_ads_publish_config_operations',
        'WHERE id = ? AND status = \'applied\')',
      ].join(' ')).bind(
        crypto.randomUUID(),
        plan.tokenId,
        clean(plan.target.unit) || null,
        clean(plan.target.token_type) || null,
        clean(requestId) || null,
        auditMetadata,
        operationId,
      ));
    }
    batchStatements.push(
      env.TOKEN_VAULT_DB.prepare([
        'DELETE FROM meta_ads_publish_config_operations',
        'WHERE id = ? AND status = \'pending\'',
      ].join(' ')).bind(operationId),
    );
    if (assertLease) await assertLease();
    const batchResults = await env.TOKEN_VAULT_DB.batch(batchStatements);
    if (
      batchChanges(batchResults, 1) !== plans.length ||
      batchChanges(batchResults, 2) !== 1
    ) {
      throw configWriterFailure('meta_ads_publish_config_readback_mismatch', 409);
    }

    const readbackAuthority = await configWriterAuthorityState(await listMetaAdsPublishConfigRows(env));
    if (!readbackAuthority.ready || readbackAuthority.revision !== candidateAuthority.revision) {
      throw configWriterFailure('meta_ads_publish_config_readback_mismatch', 409);
    }
    return {
      replayed: false,
      revision: readbackAuthority.revision,
      status: 201,
    };
  } finally {
    if (lockAcquired) {
      await releaseConfigWriterLock(env, lockOwner);
    }
  }
}

async function readConfigWriterRequest(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > CONFIG_WRITER_MAX_REQUEST_BYTES) {
    throw configWriterFailure('meta_ads_publish_config_request_too_large', 413);
  }
  try {
    const body = await request.json();
    if (!isJsonObject(body)) {
      throw configWriterFailure('meta_ads_publish_config_request_invalid', 400);
    }
    return body;
  } catch (error) {
    if (isConfigWriterFailure(error)) throw error;
    throw configWriterFailure('meta_ads_publish_config_request_invalid', 400);
  }
}

async function validateConfigWriterInput(body) {
  assertExactKeys(body, new Set([
    'operation_key',
    'expected_tracking_binding_revision',
    'updates',
  ]));
  const operationKey = clean(body.operation_key);
  if (!CONFIG_WRITER_OPERATION_KEY_PATTERN.test(operationKey)) {
    throw configWriterFailure('meta_ads_publish_config_operation_key_invalid', 400);
  }
  const expectedTrackingBindingRevision = clean(body.expected_tracking_binding_revision).toLowerCase();
  if (
    !/^[a-f0-9]{64}$/.test(expectedTrackingBindingRevision) &&
    !/^legacy:[a-f0-9]{64}$/.test(expectedTrackingBindingRevision)
  ) {
    throw configWriterFailure('meta_ads_publish_config_expected_tracking_binding_revision_invalid', 400);
  }
  if (!Array.isArray(body.updates) || !body.updates.length || body.updates.length > 50) {
    throw configWriterFailure('meta_ads_publish_config_request_invalid', 400);
  }
  const seenTokenIds = new Set();
  const updates = body.updates.map((rawUpdate) => {
    assertExactKeys(rawUpdate, new Set(['token_id', 'meta_ads_publish']));
    const tokenId = clean(rawUpdate.token_id);
    if (!CONFIG_WRITER_TOKEN_ID_PATTERN.test(tokenId) || seenTokenIds.has(tokenId)) {
      throw configWriterFailure('meta_ads_publish_config_token_id_invalid', 400);
    }
    seenTokenIds.add(tokenId);
    return {
      tokenId,
      metaAdsPublish: validateGovernedMetaAdsPublishConfig(rawUpdate.meta_ads_publish),
    };
  }).sort((left, right) => left.tokenId.localeCompare(right.tokenId));
  const serialized = stableStringify(updates);
  if (serialized.length > CONFIG_WRITER_MAX_REQUEST_BYTES) {
    throw configWriterFailure('meta_ads_publish_config_request_too_large', 413);
  }
  const targetTokenIds = updates.map((update) => update.tokenId);
  return {
    operationKey,
    expectedTrackingBindingRevision,
    updates,
    targetTokenIdsJson: JSON.stringify(targetTokenIds),
    requestHash: await sha256(stableStringify({
      operation_key: operationKey,
      expected_tracking_binding_revision: expectedTrackingBindingRevision,
      updates,
    })),
  };
}

function validateGovernedMetaAdsPublishConfig(value) {
  try {
    if (!isJsonObject(value)) throw configWriterFailure('meta_ads_publish_config_invalid', 400);
    assertExactKeys(value, CONFIG_WRITER_TOP_LEVEL_KEYS);
    const destinationType = normalizeDestinationKind(value.destination_type);
    const config = {
      destination_group: requireConfigText(value.destination_group, 160),
      api_version: normalizeApiVersion(requireConfigText(value.api_version, 24)),
      account_id: normalizeNumericId(value.account_id, 'account_id'),
      campaign_id: normalizeNumericId(value.campaign_id, 'campaign_id'),
      adset_id: normalizeNumericId(value.adset_id, 'adset_id'),
      page_id: normalizeNumericId(value.page_id, 'page_id'),
      instagram_user_id: normalizeNumericId(value.instagram_user_id, 'instagram_user_id'),
      allowed_link_hosts: normalizeConfigWriterHosts(value.allowed_link_hosts),
      landing_pages_by_creative_group: normalizeConfigWriterLandingPages(
        value.landing_pages_by_creative_group,
        value.allowed_link_hosts,
      ),
      freshness_window_days: normalizeConfigWriterDays(value.freshness_window_days),
      destination_type: destinationType,
    };
    if (Object.prototype.hasOwnProperty.call(value, 'row_number')) {
      config.row_number = normalizeConfigWriterRowNumber(value.row_number);
    }
    if (destinationType === 'whatsapp') {
      if (
        Object.prototype.hasOwnProperty.call(value, 'tracking_contract') ||
        Object.prototype.hasOwnProperty.call(value, 'tracking_profiles') ||
        CONFIG_WRITER_CAROUSEL_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))
      ) {
        throw configWriterFailure('meta_ads_publish_config_invalid', 400);
      }
      config.whatsapp_destination_url = normalizeConfigWriterWhatsAppUrl(value.whatsapp_destination_url);
      return config;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'whatsapp_destination_url')) {
      throw configWriterFailure('meta_ads_publish_config_invalid', 400);
    }
    const tracking = normalizeConfigWriterWebsiteTracking(value, config.adset_id);
    config.tracking_contract = tracking.tracking_contract;
    config.tracking_profiles = tracking.tracking_profiles;
    Object.assign(config, tracking.carousel);
    return config;
  } catch (error) {
    if (isConfigWriterFailure(error)) throw error;
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
}

function normalizeConfigWriterWebsiteTracking(value, targetAdsetId) {
  const rawContract = value.tracking_contract;
  const rawProfiles = value.tracking_profiles;
  if (!isJsonObject(rawContract) || !isJsonObject(rawProfiles)) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  assertExactKeys(rawContract, CONFIG_WRITER_TRACKING_CONTRACT_KEYS);
  const profileRef = normalizeTrackingProfileRef(rawContract.profile_ref);
  if (!profileRef || !Object.prototype.hasOwnProperty.call(rawProfiles, profileRef)) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  const fixture = normalizeConfigWriterPausedFixture(rawContract.production_url_tags_readback_fixture);
  const trackingProfiles = {};
  const entries = Object.entries(rawProfiles);
  if (!entries.length || entries.length > 30) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  for (const [rawProfileRef, rawProfile] of entries) {
    const normalizedRef = normalizeTrackingProfileRef(rawProfileRef);
    if (!normalizedRef || normalizedRef !== rawProfileRef || !isJsonObject(rawProfile)) {
      throw configWriterFailure('meta_ads_publish_config_invalid', 400);
    }
    assertExactKeys(rawProfile, CONFIG_WRITER_TRACKING_PROFILE_KEYS);
    const destinationKind = normalizeDestinationKind(rawProfile.destination_kind);
    if (destinationKind !== 'website') {
      throw configWriterFailure('meta_ads_publish_config_invalid', 400);
    }
    const profile = {
      source_adset_id: normalizeNumericId(rawProfile.source_adset_id, 'tracking_profile_source_adset_id'),
      destination_kind: destinationKind,
      website_event_requirement: normalizeTrackingRequirement(
        rawProfile.website_event_requirement,
        'website_event_requirement',
      ),
      offline_event_dataset_requirement: normalizeTrackingRequirement(
        rawProfile.offline_event_dataset_requirement,
        'offline_event_dataset_requirement',
      ),
    };
    if (Object.prototype.hasOwnProperty.call(rawProfile, 'staging_synthetic_fixture')) {
      if (typeof rawProfile.staging_synthetic_fixture !== 'boolean') {
        throw configWriterFailure('meta_ads_publish_config_invalid', 400);
      }
      if (rawProfile.staging_synthetic_fixture) profile.staging_synthetic_fixture = true;
    }
    if (Object.prototype.hasOwnProperty.call(rawProfile, 'authorized_destination_adset_ids')) {
      profile.authorized_destination_adset_ids = normalizeConfigWriterNumericIdList(
        rawProfile.authorized_destination_adset_ids,
        'authorized_destination_adset_ids',
      );
    }
    trackingProfiles[normalizedRef] = profile;
  }
  const trackingContract = {
    url_tags: normalizeUrlTags(rawContract.url_tags, { required: true }),
    profile_ref: profileRef,
    production_url_tags_readback_fixture: fixture,
  };
  const normalized = normalizeTrackingContract(trackingContract, trackingProfiles, targetAdsetId);
  if (
    !normalized.profile_configured ||
    normalized.destination_kind !== 'website' ||
    normalized.reconciliation !== TRACKING_RECONCILIATION_MODE ||
    !normalized.url_tags_configured ||
    !normalized.production_url_tags_readback_fixture_configured
  ) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  const selectedProfile = trackingProfiles[profileRef];
  if (
    selectedProfile.staging_synthetic_fixture === true &&
    !normalized.staging_synthetic_fixture
  ) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  return {
    tracking_contract: trackingContract,
    tracking_profiles: trackingProfiles,
    carousel: normalizeConfigWriterCarousel(value, selectedProfile),
  };
}

function hasStagingSyntheticFixture(value) {
  return Object.values(asObject(asObject(value).tracking_profiles))
    .some((profile) => asObject(profile).staging_synthetic_fixture === true);
}

function normalizeConfigWriterPausedFixture(value) {
  if (!isJsonObject(value)) throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  assertExactKeys(value, CONFIG_WRITER_FIXTURE_KEYS);
  return {
    ad_id: normalizeNumericId(value.ad_id, 'production_url_tags_readback_fixture_ad_id'),
    creative_id: normalizeNumericId(value.creative_id, 'production_url_tags_readback_fixture_creative_id'),
  };
}

function normalizeConfigWriterCarousel(value, profile) {
  const present = CONFIG_WRITER_CAROUSEL_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
  if (!present) return {};
  if (!CONFIG_WRITER_CAROUSEL_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  if (value.carousel_native_adset_verified !== true || value.carousel_native_route_active !== true) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  const campaignId = normalizeNumericId(value.carousel_native_campaign_id, 'carousel_native_campaign_id');
  const adsetId = normalizeNumericId(value.carousel_native_adset_id, 'carousel_native_adset_id');
  if (!safeArray(profile.authorized_destination_adset_ids).includes(adsetId)) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  return {
    carousel_native_campaign_id: campaignId,
    carousel_native_adset_id: adsetId,
    carousel_native_adset_verified: true,
    carousel_native_route_active: true,
  };
}

function normalizeConfigWriterHosts(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  const hosts = value.map((entry) => clean(entry).toLowerCase());
  if (
    hosts.some((host) => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) ||
    new Set(hosts).size !== hosts.length
  ) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  return hosts.sort();
}

function normalizeConfigWriterLandingPages(value, hosts) {
  if (!isJsonObject(value) || !Object.keys(value).length || Object.keys(value).length > 100) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  for (const rawUrl of Object.values(value)) {
    assertConfigWriterUrlHasNoCredentialQuery(rawUrl);
  }
  const definition = normalizeLandingPageMap(value, normalizeConfigWriterHosts(hosts));
  if (definition.errors.length || !Object.keys(definition.pages).length) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  return definition.pages;
}

function normalizeConfigWriterWhatsAppUrl(value) {
  const raw = requireConfigText(value, 2048);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !isWhatsAppHostname(url.hostname)
  ) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  assertConfigWriterUrlHasNoCredentialQuery(url);
  return url.toString();
}

function assertConfigWriterUrlHasNoCredentialQuery(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(clean(value));
  } catch {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  for (const key of url.searchParams.keys()) {
    if (URL_TAG_FORBIDDEN_KEY_PATTERN.test(key)) {
      throw configWriterFailure('meta_ads_publish_config_invalid', 400);
    }
  }
}

function normalizeConfigWriterNumericIdList(value) {
  if (!Array.isArray(value) || value.length > 50) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  const values = value.map((entry) => normalizeNumericId(entry, 'authorized_destination_adset_id'));
  if (new Set(values).size !== values.length) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  return values.sort();
}

function normalizeConfigWriterDays(value) {
  if (value === undefined) return 7;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 90) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  return number;
}

function normalizeConfigWriterRowNumber(value) {
  const rowNumber = clean(value);
  if (!rowNumber || rowNumber.length > 60 || /[\u0000-\u001f]/.test(rowNumber)) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  return rowNumber;
}

function requireConfigText(value, maxLength) {
  const text = clean(value);
  if (!text || text.length > maxLength || /[\u0000-\u001f]/.test(text)) {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
  return text;
}

function assertExactKeys(value, allowed) {
  if (!isJsonObject(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw configWriterFailure('meta_ads_publish_config_request_invalid', 400);
  }
}

function parseConfigWriterMetadata(value) {
  try {
    const metadata = JSON.parse(value);
    if (!isJsonObject(metadata)) throw new Error('invalid_metadata');
    return metadata;
  } catch {
    throw configWriterFailure('meta_ads_publish_config_invalid', 400);
  }
}

// A legacy configuration cannot satisfy the v20 writer schema by definition,
// but it still needs an optimistic-concurrency identity. The legacy revision
// is derived from the complete currently configured Facebook destination set;
// it is not a wildcard and changes whenever that source configuration changes.
async function configWriterAuthorityState(rows) {
  const configuredRows = safeArray(rows)
    .filter((row) => Object.keys(asObject(parseObject(row && row.metadata_json).meta_ads_publish)).length > 0)
    .sort((left, right) => clean(left.id).localeCompare(clean(right.id)));
  const legacyRevision = `legacy:${await sha256(stableStringify(configuredRows.map((row) => {
    const metadata = parseObject(row.metadata_json);
    return {
      token_id: clean(row.id),
      external_account_id: clean(row.external_account_id),
      meta_ads_publish: asObject(metadata.meta_ads_publish),
    };
  })))}`;

  if (configuredRows.length < 2) {
    return { ready: false, revision: legacyRevision, mode: 'legacy_bootstrap' };
  }
  try {
    for (const row of configuredRows) {
      validateGovernedMetaAdsPublishConfig(parseObject(row.metadata_json).meta_ads_publish);
    }
    const tracking = await deriveTrackingBindingState(configuredRows);
    if (tracking.ready) {
      return { ready: true, revision: tracking.revision, mode: 'tracking_ready' };
    }
  } catch {
    // Deliberately return the hash-bound bootstrap mode below. No malformed or
    // v18 state can be silently treated as a valid v20 binding.
  }
  return { ready: false, revision: legacyRevision, mode: 'legacy_bootstrap' };
}

function buildConfigWriterAtomicMetadataUpdate(env, { plans, now, operationId, requestHash }) {
  const caseClauses = plans.map(() => 'WHEN ? THEN ?').join(' ');
  const targetPlaceholders = plans.map(() => '?').join(', ');
  const oldConditions = plans.map(() => '(id = ? AND metadata_json = ?)').join(' OR ');
  const values = [
    ...plans.flatMap((plan) => [plan.tokenId, plan.nextMetadataJson]),
    now,
    ...plans.map((plan) => plan.tokenId),
    ...plans.flatMap((plan) => [plan.tokenId, plan.target.metadata_json]),
    plans.length,
    operationId,
    requestHash,
  ];
  return env.TOKEN_VAULT_DB.prepare([
    'UPDATE credential_tokens',
    `SET metadata_json = CASE id ${caseClauses} ELSE metadata_json END, updated_at = ?`,
    `WHERE id IN (${targetPlaceholders}) AND provider = 'facebook' AND active = 1`,
    'AND (SELECT COUNT(*) FROM credential_tokens',
    `WHERE provider = 'facebook' AND active = 1 AND (${oldConditions})) = ?`,
    'AND EXISTS (SELECT 1 FROM meta_ads_publish_config_operations',
    `WHERE id = ? AND request_hash = ? AND status = 'pending')`,
  ].join(' ')).bind(...values);
}

function buildConfigWriterAppliedOperationUpdate(env, { plans, now, operationId }) {
  const newConditions = plans.map(() => '(id = ? AND metadata_json = ?)').join(' OR ');
  return env.TOKEN_VAULT_DB.prepare([
    "UPDATE meta_ads_publish_config_operations SET status = 'applied', updated_at = ?",
    "WHERE id = ? AND status = 'pending'",
    'AND (SELECT COUNT(*) FROM credential_tokens',
    `WHERE provider = 'facebook' AND active = 1 AND (${newConditions})) = ?`,
  ].join(' ')).bind(
    now,
    operationId,
    ...plans.flatMap((plan) => [plan.tokenId, plan.nextMetadataJson]),
    plans.length,
  );
}

async function acquireConfigWriterLock(env, ownerId, {
  resourceKey = CONFIG_WRITER_LOCK_RESOURCE_KEY,
  ttlMs = CONFIG_WRITER_LOCK_TTL_MS,
} = {}) {
  try {
    const now = nowIso();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await dbRun(
      env,
      'DELETE FROM meta_ads_publish_config_locks WHERE resource_key = ? AND expires_at <= ?',
      resourceKey,
      now,
    );
    await dbRun(
      env,
      [
        'INSERT INTO meta_ads_publish_config_locks (resource_key, owner_id, expires_at, created_at, updated_at)',
        'VALUES (?, ?, ?, ?, ?)',
        'ON CONFLICT(resource_key) DO UPDATE SET owner_id = excluded.owner_id,',
        'expires_at = excluded.expires_at, updated_at = excluded.updated_at',
        'WHERE meta_ads_publish_config_locks.expires_at <= ?',
      ].join(' '),
      resourceKey,
      ownerId,
      expiresAt,
      now,
      now,
      now,
    );
    const lock = await dbFirst(
      env,
      'SELECT resource_key, owner_id FROM meta_ads_publish_config_locks WHERE resource_key = ?',
      resourceKey,
    );
    if (!lock || clean(lock.owner_id) !== ownerId) {
      throw configWriterFailure('meta_ads_publish_config_locked', 409);
    }
  } catch (error) {
    if (isConfigWriterFailure(error)) throw error;
    throw configWriterFailure('meta_ads_publish_config_authority_unavailable', 503);
  }
}

async function releaseConfigWriterLock(env, ownerId, {
  resourceKey = CONFIG_WRITER_LOCK_RESOURCE_KEY,
} = {}) {
  try {
    await dbRun(
      env,
      'DELETE FROM meta_ads_publish_config_locks WHERE resource_key = ? AND owner_id = ?',
      resourceKey,
      ownerId,
    );
  } catch {
    // The lock has a short expiry; a release failure cannot rewrite a committed
    // configuration and must not turn a durable result into a false failure.
  }
}

async function renewConfigWriterLock(env, ownerId, {
  resourceKey = CONFIG_WRITER_LOCK_RESOURCE_KEY,
  ttlMs = CONFIG_WRITER_LOCK_TTL_MS,
} = {}) {
  try {
    const now = nowIso();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const result = await dbRun(
      env,
      `UPDATE meta_ads_publish_config_locks
          SET expires_at = ?, updated_at = ?
        WHERE resource_key = ? AND owner_id = ? AND expires_at > ?`,
      expiresAt,
      now,
      resourceKey,
      ownerId,
      now,
    );
    if (statementChanges(result) !== 1) {
      throw configWriterFailure('meta_ads_publish_config_locked', 409);
    }
  } catch (error) {
    if (isConfigWriterFailure(error)) throw error;
    throw configWriterFailure('meta_ads_publish_config_authority_unavailable', 503);
  }
}

function batchChanges(results, index) {
  const result = safeArray(results)[index] || {};
  return Number(result.meta?.changes ?? result.changes ?? 0);
}

function configWriterSuccessResponse({ replayed, revision, requestId }, status = 200) {
  return response({
    ok: true,
    applied: !replayed,
    replayed,
    operation_status: 'applied',
    config_revision: revision,
    tracking_binding_revision: revision,
    workflow_contract_revision: WORKFLOW_CONTRACT_REVISION,
    requestId,
  }, status);
}

function configWriterFailure(code, httpStatus) {
  return Object.assign(new Error(code), {
    config_writer_error: true,
    http_status: httpStatus,
  });
}

function isConfigWriterFailure(error) {
  return Boolean(error && error.config_writer_error === true);
}

function configWriterFailureResponse(error, requestId) {
  const code = isConfigWriterFailure(error) && CONFIG_WRITER_ERROR_CODES.has(clean(error.message))
    ? clean(error.message)
    : 'meta_ads_publish_config_authority_unavailable';
  const status = code === 'meta_ads_publish_config_request_too_large'
    ? 413
    : Number(error?.http_status) === 409
      ? 409
      : Number(error?.http_status) === 503
        ? 503
        : 400;
  return response({ ok: false, error: code, requestId }, status);
}

// A legacy v18 destination has enough private authority to identify its target,
// but not enough governed v20 metadata to name an authorized source or raw URL
// tag fragment. The derive endpoints keep those values inside the Vault: they
// use only bounded Graph GETs, return a digest/count summary, and then bind the
// normal encrypted bootstrap saga to the exact plan that was observed on the
// immutable Worker candidate.
export async function deriveMetaAdsPublishBootstrapPlan({ request, env, requestId, decryptToken }) {
  try {
    const input = validateBootstrapDerivePlanInput(await readBootstrapDeriveRequest(request));
    const plan = await deriveBootstrapManifestPlan({
      env,
      requestId,
      decryptToken,
      expectedConfigAuthorityRevision: input.expectedConfigAuthorityRevision,
    });
    return bootstrapDerivePlanResponse(plan, requestId);
  } catch (error) {
    return bootstrapFailureResponse(normalizeBootstrapDeriveFailure(error), requestId);
  }
}

export async function bootstrapMetaAdsPublishConfigFromDerivedPlan({
  request,
  env,
  requestId,
  decryptToken,
  encryptToken,
  writeAudit,
}) {
  try {
    const input = validateBootstrapDeriveApplyInput(await readBootstrapDeriveRequest(request));
    const replay = await replayDerivedBootstrapIfApplied({
      env,
      requestId,
      decryptToken,
      input,
    });
    if (replay) return replay;
    const plan = await deriveBootstrapManifestPlan({
      env,
      requestId,
      decryptToken,
      expectedConfigAuthorityRevision: input.expectedConfigAuthorityRevision,
    });
    if (plan.manifestSha256 !== input.expectedManifestSha256) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_derive_plan_stale', 409);
    }
    const bootstrapRequest = new Request('https://token-vault.invalid/internal/token-vault/v1/meta-ads-publish/config/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_key: input.operationKey,
        expected_config_authority_revision: input.expectedConfigAuthorityRevision,
        derived_plan_sha256: input.expectedManifestSha256,
        entries: plan.entries,
      }),
    });
    return bootstrapMetaAdsPublishConfig({
      request: bootstrapRequest,
      env,
      requestId,
      decryptToken,
      encryptToken,
      writeAudit,
    });
  } catch (error) {
    return bootstrapFailureResponse(normalizeBootstrapDeriveFailure(error), requestId);
  }
}

// A staging D1 starts empty by design. The normal legacy bootstrap is not a
// credential importer, so it cannot migrate an empty authority set. This
// narrow, one-shot seed creates only a paused synthetic Website lineage after
// proving all external facts with bounded Graph reads. It is deliberately not
// available to the operational/config/admin gateway roles; index.js exposes it
// only to a release-scoped, candidate-only bearer.
export async function attestStagingSyntheticMetaAdsTracking({ request, env, requestId }) {
  return runStagingSyntheticMetaAdsTrackingAttestation({ request, env, requestId });
}

// This separate candidate-only diagnostic is intentionally stricter than the
// regular source attestation: success proves the inherited Worker binding did
// generate an appsecret_proof for the same bounded Graph reads. It remains
// read-only and never becomes a generic secret-presence oracle.
export async function attestStagingSyntheticMetaAdsTrackingAppSecretProof({ request, env, requestId }) {
  return runStagingSyntheticMetaAdsTrackingAttestation({
    request,
    env,
    requestId,
    requireAppSecretProof: true,
  });
}

async function runStagingSyntheticMetaAdsTrackingAttestation({
  request,
  env,
  requestId,
  requireAppSecretProof = false,
}) {
  try {
    assertStagingSyntheticSeedAttestationEnvironment(env);
    const input = await readStagingSyntheticSeedInput(request);
    const auth = await buildStagingSyntheticSeedGraphAuth(input, env);
    if (requireAppSecretProof && !clean(auth.appSecretProof)) {
      throw stagingSyntheticSeedFailure(
        STAGING_SYNTHETIC_SEED_ATTESTATION_FAILURES.appSecretProofUnavailable,
        409,
      );
    }
    await discoverStagingSyntheticSeedFacts({
      input,
      auth,
      context: createStagingSyntheticSeedAttestationContext(env, requestId, input.operationKey),
      failureCodes: STAGING_SYNTHETIC_SEED_ATTESTATION_FAILURES,
      maxGraphAttempts: STAGING_SYNTHETIC_SEED_ATTEST_MAX_GRAPH_ATTEMPTS,
      probeAppSecretProof: true,
    });
    return requireAppSecretProof
      ? stagingSyntheticSeedAppSecretProofAttestationSuccess({ requestId })
      : stagingSyntheticSeedAttestationSuccess({ requestId, operationKey: input.operationKey });
  } catch (error) {
    return stagingSyntheticSeedFailureResponse(normalizeStagingSyntheticSeedError(error), requestId);
  }
}

export async function seedStagingSyntheticMetaAdsTracking({ request, env, requestId, encryptToken, writeAudit }) {
  let input;
  let operation;
  let state;
  let context;
  let lockOwner = '';
  try {
    assertStagingSyntheticSeedEnvironment(env);
    input = await readStagingSyntheticSeedInput(request);
    if (typeof encryptToken !== 'function') {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
    }
    lockOwner = `staging-seed:${input.operationKey}:${crypto.randomUUID()}`;
    await acquireConfigWriterLock(env, lockOwner, { ttlMs: STAGING_SYNTHETIC_SEED_LOCK_TTL_MS });
    context = createStagingSyntheticSeedContext(env, lockOwner, requestId, 'seed_staging_synthetic_meta_ads_tracking', input.operationKey);

    operation = await loadStagingSyntheticSeedOperation(env, input.operationKey);
    if (operation) {
      return await replayStagingSyntheticSeed({ operation, input, env, requestId, decryptToken: null });
    }

    const currentRows = await listMetaAdsPublishConfigRows(env);
    const configuredCount = currentRows.filter((row) => Object.keys(asObject(parseObject(row?.metadata_json).meta_ads_publish)).length > 0).length;
    if (configuredCount > 0) {
      return stagingSyntheticSeedSuccess({ requestId, operationKey: input.operationKey, status: 'not_required', replayed: false });
    }
    const outstanding = await loadOutstandingStagingSyntheticSeedOperation(env);
    if (outstanding && clean(outstanding.operation_key) !== input.operationKey) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    const facebookCount = await countFacebookCredentials(env);
    if (facebookCount !== 0) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_facebook_credentials_present', 409);
    }

    state = await createInitialStagingSyntheticSeedState(input);
    operation = await createStagingSyntheticSeedOperation({ env, input, state, encryptToken });

    const auth = await buildStagingSyntheticSeedGraphAuth(input, env);
    const facts = await discoverStagingSyntheticSeedFacts({ input, auth, context });
    state.facts = facts;
    state.phase = 'graph_validated';
    await persistStagingSyntheticSeedState({ env, operation, state, status: 'creating', encryptToken, context });

    await createStagingSyntheticSeedResources({ input, auth, facts, operation, state, encryptToken, context });
    await sealStagingSyntheticSeedCredentials({ input, env, operation, state, encryptToken, requestId, context });
    // The durable seal is authoritative. An audit delivery outage must not
    // make a successful one-shot seed appear failed to the deploy workflow.
    await writeStagingSyntheticSeedAudit(writeAudit, env, requestId, 'ok', { phase: 'sealed' }).catch(() => undefined);
    return stagingSyntheticSeedSuccess({ requestId, operationKey: input.operationKey, status: 'sealed', replayed: false });
  } catch (error) {
    const normalized = normalizeStagingSyntheticSeedError(error);
    if (operation && state && !state.credentials_sealed && !state.reconciliation_required) {
      try {
        // A failed shared ad-set lease means another governed data-plane
        // operation may own one of the newly created targets. Do not attempt a
        // best-effort cleanup under only the config lock.
        if (context?.stagingSyntheticSeedMutationLocksRequired === true && context.stagingSyntheticSeedMutationLocksHeld !== true) {
          throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
        }
        const rollbackInput = input || {};
        const auth = rollbackInput.accessToken ? await buildStagingSyntheticSeedGraphAuth(rollbackInput, env) : null;
        const rollback = await compensateStagingSyntheticSeed({
          env,
          operation,
          state,
          auth,
          encryptToken,
          context: context || createStagingSyntheticSeedContext(env, lockOwner, requestId, 'rollback_staging_synthetic_meta_ads_tracking', clean(input?.operationKey)),
          deactivateCredentials: false,
        });
        if (!rollback.ok) {
          normalized.code = 'meta_ads_publish_staging_seed_reconciliation_required';
          normalized.status = 409;
        }
      } catch {
        normalized.code = 'meta_ads_publish_staging_seed_reconciliation_required';
        normalized.status = 409;
      }
    }
    try {
      await writeStagingSyntheticSeedAudit(writeAudit, env, requestId, normalized.code, {
        phase: clean(state?.phase) || 'not_started',
      });
    } catch {
      // An audit outage must never turn a sanitized error into a raw exception.
    }
    return stagingSyntheticSeedFailureResponse(normalized, requestId);
  } finally {
    if (context?.stagingSyntheticSeedMutationLocksHeld === true) {
      await releaseOperationLocks(
        env,
        context.stagingSyntheticSeedMutationRunId,
        context.stagingSyntheticSeedMutationOperationKey,
      ).catch(() => undefined);
    }
    if (lockOwner) await releaseConfigWriterLock(env, lockOwner);
  }
}

export async function rollbackStagingSyntheticMetaAdsTracking({ request, env, requestId, decryptToken, encryptToken, writeAudit }) {
  let input;
  let operation;
  let state;
  let context;
  let lockOwner = '';
  try {
    assertStagingSyntheticSeedEnvironment(env);
    input = await readStagingSyntheticSeedRollbackInput(request);
    if (typeof decryptToken !== 'function' || typeof encryptToken !== 'function') {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
    }
    lockOwner = `staging-seed-rollback:${input.operationKey}:${crypto.randomUUID()}`;
    await acquireConfigWriterLock(env, lockOwner, { ttlMs: STAGING_SYNTHETIC_SEED_LOCK_TTL_MS });
    context = createStagingSyntheticSeedContext(env, lockOwner, requestId, 'rollback_staging_synthetic_meta_ads_tracking', input.operationKey);
    operation = await loadStagingSyntheticSeedOperation(env, input.operationKey);
    if (!operation) throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_operation_not_found', 409);
    state = await decryptStagingSyntheticSeedState(operation, decryptToken, env);
    assertStagingSyntheticSeedStateMatchesInput(state, input);
    if (clean(operation.status) === 'rolled_back') {
      return stagingSyntheticSeedRollbackSuccess({ requestId, operationKey: input.operationKey, replayed: true });
    }
    if (state.reconciliation_required === true) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    if (stagingSyntheticSeedStateHasNoGraphMutation(state)) {
      state.phase = 'rolled_back';
      await persistStagingSyntheticSeedState({ env, operation, state, status: 'rolled_back', encryptToken, context });
      await writeStagingSyntheticSeedAudit(writeAudit, env, requestId, 'rolled_back', { phase: 'rolled_back' }).catch(() => undefined);
      return stagingSyntheticSeedRollbackSuccess({ requestId, operationKey: input.operationKey, replayed: false });
    }
    if (!['creating', 'sealed'].includes(clean(operation.status)) || stagingSyntheticSeedStateHasAmbiguousMutation(state)) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    if (clean(operation.status) === 'sealed') {
      await assertStagingSyntheticSeedRollbackAuthority(env, state);
    }
    await acquireStagingSyntheticSeedMutationLocks(context, state);
    const auth = await buildStagingSyntheticSeedGraphAuth(input, env);
    const rollback = await compensateStagingSyntheticSeed({
      env,
      operation,
      state,
      auth,
      encryptToken,
      decryptToken,
      context,
      deactivateCredentials: true,
    });
    if (!rollback.ok) throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    await writeStagingSyntheticSeedAudit(writeAudit, env, requestId, 'rolled_back', { phase: 'rolled_back' }).catch(() => undefined);
    return stagingSyntheticSeedRollbackSuccess({ requestId, operationKey: input.operationKey, replayed: false });
  } catch (error) {
    const normalized = normalizeStagingSyntheticSeedError(error);
    try {
      await writeStagingSyntheticSeedAudit(writeAudit, env, requestId, normalized.code, { phase: clean(state?.phase) || 'rollback' });
    } catch {
      // Keep the endpoint fail-closed without exposing persistence internals.
    }
    return stagingSyntheticSeedFailureResponse(normalized, requestId);
  } finally {
    if (context?.stagingSyntheticSeedMutationLocksHeld === true) {
      await releaseOperationLocks(
        env,
        context.stagingSyntheticSeedMutationRunId,
        context.stagingSyntheticSeedMutationOperationKey,
      ).catch(() => undefined);
    }
    if (lockOwner) await releaseConfigWriterLock(env, lockOwner);
  }
}

// A previous seed request can be accepted by Graph and then lose the runner
// before its response is journaled.  The ordinary seed and rollback routes must
// remain fail-closed for that state.  This separate, candidate-only route is the
// only recovery path: it proves the exact pending ad-set by campaign/name/account
// before issuing any archive POST, and never guesses from list order.
export async function reconcileStagingSyntheticMetaAdsTracking({ request, env, requestId, decryptToken, encryptToken, writeAudit }) {
  let operation;
  let state;
  let context;
  let lockOwner = '';
  try {
    assertStagingSyntheticSeedEnvironment(env);
    const input = await readStagingSyntheticSeedReconciliationInput(request);
    if (typeof decryptToken !== 'function' || typeof encryptToken !== 'function') {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
    }
    lockOwner = `staging-seed-reconcile:${crypto.randomUUID()}`;
    await acquireConfigWriterLock(env, lockOwner, { ttlMs: STAGING_SYNTHETIC_SEED_LOCK_TTL_MS });
    context = createStagingSyntheticSeedContext(env, lockOwner, requestId, 'reconcile_staging_synthetic_meta_ads_tracking');

    const candidates = await loadReconciliationStagingSyntheticSeedOperations(env);
    if (!candidates.length) {
      return stagingSyntheticSeedReconciliationSuccess({ requestId, status: 'not_required' });
    }
    if (candidates.length !== 1) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    operation = candidates[0];
    context.operationKey = clean(operation.operation_key);
    Object.assign(context, stagingSyntheticSeedMutationLockIdentity(operation.operation_key));
    state = await decryptStagingSyntheticSeedState(operation, decryptToken, env);
    if (clean(operation.status) !== 'reconciliation_required' || state.reconciliation_required !== true) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    assertStagingSyntheticSeedReconciliationInput(state, input);
    const auth = await buildStagingSyntheticSeedGraphAuth(input, env);
    await resolveStagingSyntheticSeedPendingResources({ env, operation, state, auth, encryptToken, context });
    await acquireStagingSyntheticSeedMutationLocks(context, state);
    const rollback = await compensateStagingSyntheticSeed({
      env,
      operation,
      state,
      auth,
      encryptToken,
      context,
      deactivateCredentials: true,
      allowReconciliation: true,
    });
    if (!rollback.ok) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    await writeStagingSyntheticSeedAudit(writeAudit, env, requestId, 'rolled_back', { phase: 'reconciled' }).catch(() => undefined);
    return stagingSyntheticSeedReconciliationSuccess({ requestId, status: 'rolled_back' });
  } catch (error) {
    const normalized = normalizeStagingSyntheticSeedError(error);
    await writeStagingSyntheticSeedAudit(writeAudit, env, requestId, normalized.code, {
      phase: clean(state?.phase) || 'reconciliation',
    }).catch(() => undefined);
    return stagingSyntheticSeedFailureResponse(normalized, requestId);
  } finally {
    if (context?.stagingSyntheticSeedMutationLocksHeld === true) {
      await releaseOperationLocks(
        env,
        context.stagingSyntheticSeedMutationRunId,
        context.stagingSyntheticSeedMutationOperationKey,
      ).catch(() => undefined);
    }
    if (lockOwner) await releaseConfigWriterLock(env, lockOwner);
  }
}

function assertStagingSyntheticSeedEnvironment(env) {
  assertStagingSyntheticSeedAttestationEnvironment(env);
  if (!env?.TOKEN_VAULT_DB || typeof env.TOKEN_VAULT_DB.prepare !== 'function' || typeof env.TOKEN_VAULT_DB.batch !== 'function') {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
}

function assertStagingSyntheticSeedAttestationEnvironment(env) {
  if (clean(env?.ENVIRONMENT).toLowerCase() !== 'staging') {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_disabled', 503);
  }
}

async function readStagingSyntheticSeedInput(request) {
  const body = await readStagingSyntheticSeedBody(request, new Set([
    'operation_key', 'access_token', 'account_id', 'pixel_id', 'destination_page_ids', 'api_version',
  ]));
  const operationKey = clean(body.operation_key);
  if (!STAGING_SYNTHETIC_SEED_OPERATION_KEY_PATTERN.test(operationKey)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_operation_key_invalid', 400);
  }
  const accessToken = normalizeStagingSyntheticSeedAccessToken(body.access_token);
  return {
    operationKey,
    accessToken,
    accountId: normalizeStagingSyntheticSeedNumericId(body.account_id, 'account_id'),
    pixelId: normalizeStagingSyntheticSeedNumericId(body.pixel_id, 'pixel_id'),
    destinationPages: normalizeStagingSyntheticSeedDestinationPages(body.destination_page_ids),
    apiVersion: normalizeStagingSyntheticSeedApiVersion(body.api_version),
  };
}

async function readStagingSyntheticSeedRollbackInput(request) {
  const body = await readStagingSyntheticSeedBody(request, new Set([
    'operation_key', 'access_token', 'account_id', 'api_version',
  ]));
  const operationKey = clean(body.operation_key);
  if (!STAGING_SYNTHETIC_SEED_OPERATION_KEY_PATTERN.test(operationKey)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_operation_key_invalid', 400);
  }
  return {
    operationKey,
    accessToken: normalizeStagingSyntheticSeedAccessToken(body.access_token),
    accountId: normalizeStagingSyntheticSeedNumericId(body.account_id, 'account_id'),
    apiVersion: normalizeStagingSyntheticSeedApiVersion(body.api_version),
  };
}

async function readStagingSyntheticSeedReconciliationInput(request) {
  const body = await readStagingSyntheticSeedBody(request, new Set([
    'access_token', 'account_id', 'api_version',
  ]));
  return {
    accessToken: normalizeStagingSyntheticSeedAccessToken(body.access_token),
    accountId: normalizeStagingSyntheticSeedNumericId(body.account_id, 'account_id'),
    apiVersion: normalizeStagingSyntheticSeedApiVersion(body.api_version),
  };
}

async function readStagingSyntheticSeedBody(request, allowed) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isInteger(contentLength) && contentLength > STAGING_SYNTHETIC_SEED_MAX_REQUEST_BYTES) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_too_large', 413);
  }
  let body;
  try {
    const text = request.body
      ? await readBoundedText(request.body, STAGING_SYNTHETIC_SEED_MAX_REQUEST_BYTES, () => stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_too_large', 413))
      : await request.text();
    body = JSON.parse(text);
  } catch (error) {
    if (isStagingSyntheticSeedFailure(error)) throw error;
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_invalid', 400);
  }
  if (!isJsonObject(body) || Object.keys(body).some((key) => !allowed.has(key))) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_invalid', 400);
  }
  return body;
}

function normalizeStagingSyntheticSeedAccessToken(value) {
  if (typeof value !== 'string') throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_invalid', 400);
  const token = value.trim();
  if (token.length < 20 || token.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(token)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_invalid', 400);
  }
  return token;
}

function normalizeStagingSyntheticSeedDestinationPages(value) {
  if (!isJsonObject(value)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_invalid', 400);
  }
  const keys = Object.keys(value);
  if (
    keys.length !== STAGING_SYNTHETIC_SEED_DESTINATIONS.length ||
    keys.some((key) => !STAGING_SYNTHETIC_SEED_DESTINATION_KEYS.has(key))
  ) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_invalid', 400);
  }
  const destinationPages = {};
  for (const destination of STAGING_SYNTHETIC_SEED_DESTINATIONS) {
    destinationPages[destination.key] = normalizeStagingSyntheticSeedNumericId(
      value[destination.key],
      `${destination.key}_page_id`,
    );
  }
  if (new Set(Object.values(destinationPages)).size !== STAGING_SYNTHETIC_SEED_DESTINATIONS.length) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_invalid', 400);
  }
  return destinationPages;
}

function normalizeStagingSyntheticSeedNumericId(value, label) {
  try {
    return normalizeNumericId(value, `staging_seed_${label}`);
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_invalid', 400);
  }
}

function normalizeStagingSyntheticSeedApiVersion(value) {
  try {
    return normalizeApiVersion(clean(value) || 'v25.0');
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_request_invalid', 400);
  }
}

function stagingSyntheticSeedFailure(code, httpStatus = 400) {
  return Object.assign(new Error(code), {
    staging_synthetic_seed_error: true,
    http_status: httpStatus,
  });
}

function isStagingSyntheticSeedFailure(error) {
  return Boolean(error && error.staging_synthetic_seed_error === true);
}

function normalizeStagingSyntheticSeedError(error) {
  if (isStagingSyntheticSeedFailure(error)) {
    return { code: clean(error.message), status: Number(error.http_status) || 400 };
  }
  const normalized = normalizeFailure(error);
  return {
    code: normalized.retryable || normalized.ambiguous
      ? 'meta_ads_publish_staging_seed_unavailable'
      : 'meta_ads_publish_staging_seed_failed',
    status: normalized.retryable || normalized.ambiguous ? 503 : 409,
  };
}

function stagingSyntheticSeedFailureResponse(error, requestId) {
  const code = clean(error?.code);
  const allowed = new Set([
    'meta_ads_publish_staging_seed_disabled',
    'meta_ads_publish_staging_seed_unavailable',
    'meta_ads_publish_staging_seed_request_too_large',
    'meta_ads_publish_staging_seed_request_invalid',
    'meta_ads_publish_staging_seed_operation_key_invalid',
    'meta_ads_publish_staging_seed_operation_not_found',
    'meta_ads_publish_staging_seed_operation_conflict',
    'meta_ads_publish_staging_seed_reconciliation_required',
    'meta_ads_publish_staging_seed_facebook_credentials_present',
    'meta_ads_publish_staging_seed_graph_identity_invalid',
    'meta_ads_publish_staging_seed_graph_source_unavailable',
    'meta_ads_publish_staging_seed_graph_source_auth_rejected',
    'meta_ads_publish_staging_seed_graph_pixel_access_denied',
    'meta_ads_publish_staging_seed_graph_pixel_account_relation_denied',
    'meta_ads_publish_staging_seed_graph_pixel_account_relation_ambiguous',
    'meta_ads_publish_staging_seed_graph_appsecret_proof_mismatch',
    'meta_ads_publish_staging_seed_graph_appsecret_proof_unavailable',
    'meta_ads_publish_staging_seed_graph_page_access_denied',
    'meta_ads_publish_staging_seed_graph_dataset_access_denied',
    'meta_ads_publish_staging_seed_graph_identity_mismatch',
    'meta_ads_publish_staging_seed_graph_identity_malformed',
    'meta_ads_publish_staging_seed_graph_page_ambiguous',
    'meta_ads_publish_staging_seed_graph_dataset_ambiguous',
    'meta_ads_publish_staging_seed_landing_or_media_unavailable',
    'meta_ads_publish_staging_seed_graph_campaign_contract_malformed',
    'meta_ads_publish_staging_seed_graph_campaign_identity_mismatch',
    'meta_ads_publish_staging_seed_graph_campaign_name_mismatch',
    'meta_ads_publish_staging_seed_graph_campaign_status_mismatch',
    'meta_ads_publish_staging_seed_graph_campaign_objective_mismatch',
    'meta_ads_publish_staging_seed_graph_contract_invalid',
    'meta_ads_publish_staging_seed_failed',
  ]);
  const safeCode = allowed.has(code) ? code : 'meta_ads_publish_staging_seed_unavailable';
  const status = Number(error?.status) === 413
    ? 413
    : Number(error?.status) === 503
      ? 503
      : Number(error?.status) === 409
        ? 409
        : 400;
  return response({ ok: false, error: safeCode, requestId }, status);
}

function stagingSyntheticSeedSuccess({ requestId, operationKey, status, replayed }) {
  return response({
    ok: true,
    seed: status,
    operation_status: status,
    replayed: Boolean(replayed),
    operation_key: operationKey,
    contract_version: STAGING_SYNTHETIC_SEED_CONTRACT,
    requestId,
  }, status === 'sealed' && !replayed ? 201 : 200);
}

function stagingSyntheticSeedReconciliationSuccess({ requestId, status }) {
  return response({
    ok: true,
    reconciled: status === 'rolled_back',
    operation_status: status,
    contract_version: STAGING_SYNTHETIC_SEED_CONTRACT,
    requestId,
  });
}

function stagingSyntheticSeedRollbackSuccess({ requestId, operationKey, replayed }) {
  return response({
    ok: true,
    rolled_back: true,
    operation_status: 'rolled_back',
    replayed: Boolean(replayed),
    operation_key: operationKey,
    contract_version: STAGING_SYNTHETIC_SEED_CONTRACT,
    requestId,
  });
}

function stagingSyntheticSeedAttestationSuccess({ requestId, operationKey }) {
  return response({
    ok: true,
    attestation: 'match',
    operation_key: operationKey,
    contract_version: STAGING_SYNTHETIC_SEED_CONTRACT,
    requestId,
  });
}

function stagingSyntheticSeedAppSecretProofAttestationSuccess({ requestId }) {
  return response({
    ok: true,
    attestation: 'appsecret_proof_verified',
    contract_version: STAGING_SYNTHETIC_SEED_CONTRACT,
    requestId,
  });
}

function createStagingSyntheticSeedAttestationContext(env, requestId, operationKey) {
  return {
    env,
    requestId,
    action: 'attest_staging_synthetic_meta_ads_tracking',
    operationKey: clean(operationKey),
    attempts: 0,
    rateUsage: {},
    traceId: '',
  };
}

function createStagingSyntheticSeedContext(env, lockOwner, requestId, action, operationKey = '') {
  const context = {
    env,
    requestId,
    action,
    operationKey: clean(operationKey),
    ...stagingSyntheticSeedMutationLockIdentity(operationKey),
    stagingSyntheticSeedMutationLockKeys: [],
    stagingSyntheticSeedMutationLocksHeld: false,
    stagingSyntheticSeedMutationLocksRequired: false,
    attempts: 0,
    rateUsage: {},
    traceId: '',
    assertBootstrapLease: async () => {
      try {
        await renewConfigWriterLock(env, lockOwner, { ttlMs: STAGING_SYNTHETIC_SEED_LOCK_TTL_MS });
        await renewStagingSyntheticSeedMutationLocks(context);
      } catch (error) {
        const locked = isConfigWriterFailure(error) || clean(error?.message).startsWith('resource_locked:');
        throw stagingSyntheticSeedFailure(
          locked
            ? 'meta_ads_publish_staging_seed_reconciliation_required'
            : 'meta_ads_publish_staging_seed_unavailable',
          locked ? 409 : 503,
        );
      }
    },
  };
  return context;
}

function stagingSyntheticSeedMutationLockIdentity(operationKey) {
  const normalized = clean(operationKey);
  return {
    stagingSyntheticSeedMutationRunId: `staging-seed:${normalized}`,
    stagingSyntheticSeedMutationOperationKey: `staging-seed-mutation:${normalized}`,
  };
}

function stagingSyntheticSeedMutationLockKeys(state) {
  const accountId = normalizeStagingSyntheticSeedGraphId(asObject(state?.input).account_id, 'lock_account_id');
  const resources = asObject(state?.resources);
  const adsetIds = [
    clean(asObject(resources.source_adset).id),
    clean(asObject(resources.target_adset).id),
  ].filter(Boolean);
  return [...new Set(adsetIds.map((adsetId) => bootstrapAdsetContractLockKey(accountId, adsetId)))].sort();
}

async function acquireStagingSyntheticSeedMutationLocks(context, state) {
  const keys = stagingSyntheticSeedMutationLockKeys(state);
  if (!keys.length) return;
  context.stagingSyntheticSeedMutationLocksRequired = true;
  context.stagingSyntheticSeedMutationLockKeys = keys;
  await acquireLocks(
    context.env,
    context.stagingSyntheticSeedMutationRunId,
    context.stagingSyntheticSeedMutationOperationKey,
    keys,
  );
  context.stagingSyntheticSeedMutationLocksHeld = true;
}

async function renewStagingSyntheticSeedMutationLocks(context) {
  if (context?.stagingSyntheticSeedMutationLocksHeld !== true || !safeArray(context.stagingSyntheticSeedMutationLockKeys).length) return;
  await acquireLocks(
    context.env,
    context.stagingSyntheticSeedMutationRunId,
    context.stagingSyntheticSeedMutationOperationKey,
    context.stagingSyntheticSeedMutationLockKeys,
  );
}

async function buildStagingSyntheticSeedGraphAuth(input, env) {
  const appSecretProof = clean(env.META_APP_SECRET)
    ? await hmacSha256(clean(env.META_APP_SECRET), input.accessToken)
    : '';
  return {
    tokenId: '',
    accountId: input.accountId,
    apiVersion: input.apiVersion,
    accessToken: input.accessToken,
    appSecretProof,
    config: {},
  };
}

async function createInitialStagingSyntheticSeedState(input) {
  const marker = await sha256(`meta-ads-staging-synthetic-seed\n${input.operationKey}`);
  const sourceTokenId = `staging.meta-ads.source.${marker.slice(0, 32)}`;
  const targetTokenId = `staging.meta-ads.target.${marker.slice(0, 32)}`;
  return {
    contract: STAGING_SYNTHETIC_SEED_CONTRACT,
    phase: 'pending',
    reconciliation_required: false,
    input: {
      operation_key: input.operationKey,
      account_id: input.accountId,
      pixel_id: input.pixelId,
      destination_pages: { ...input.destinationPages },
      api_version: input.apiVersion,
    },
    marker,
    url_tags: `skincos_staging_v20=${marker.slice(0, 32)}`,
    credential_ids: { source: sourceTokenId, target: targetTokenId },
    credentials_sealed: false,
    facts: {},
    resources: {},
  };
}

async function countFacebookCredentials(env) {
  try {
    const row = await dbFirst(env, 'SELECT COUNT(*) AS count FROM credential_tokens WHERE provider = ? AND active = 1', 'facebook');
    return Number(row?.count || 0);
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
}

async function loadStagingSyntheticSeedOperation(env, operationKey) {
  try {
    return await dbFirst(env, [
      'SELECT id, operation_key, request_hash, status, state_ciphertext, summary_json',
      'FROM meta_ads_publish_staging_seed_operations WHERE operation_key = ?',
    ].join(' '), operationKey);
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
}

async function loadOutstandingStagingSyntheticSeedOperation(env) {
  try {
    return await dbFirst(env, [
      'SELECT id, operation_key, status FROM meta_ads_publish_staging_seed_operations',
      "WHERE status IN ('pending', 'creating', 'rolling_back', 'reconciliation_required')",
      'ORDER BY updated_at DESC LIMIT 1',
    ].join(' '));
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
}

async function loadReconciliationStagingSyntheticSeedOperations(env) {
  try {
    return await dbAll(env, [
      'SELECT id, operation_key, request_hash, status, state_ciphertext, summary_json',
      'FROM meta_ads_publish_staging_seed_operations',
      "WHERE status = 'reconciliation_required'",
      'ORDER BY updated_at DESC LIMIT 2',
    ].join(' '));
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
}

async function createStagingSyntheticSeedOperation({ env, input, state, encryptToken }) {
  const requestHash = await stagingSyntheticSeedRequestHash(input);
  const stateCiphertext = await encryptStagingSyntheticSeedState(state, encryptToken, env);
  const now = nowIso();
  try {
    await dbRun(env, [
      'INSERT INTO meta_ads_publish_staging_seed_operations',
      '(id, operation_key, request_hash, status, state_ciphertext, summary_json, created_at, updated_at)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ].join(' '),
    crypto.randomUUID(), input.operationKey, requestHash, 'pending', stateCiphertext,
    JSON.stringify(summarizeStagingSyntheticSeedState(state)), now, now);
  } catch {
    const existing = await loadStagingSyntheticSeedOperation(env, input.operationKey);
    if (existing) return existing;
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
  const operation = await loadStagingSyntheticSeedOperation(env, input.operationKey);
  if (!operation) throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  return operation;
}

async function stagingSyntheticSeedRequestHash(input) {
  return sha256(stableStringify({
    operation_key: input.operationKey,
    account_id: input.accountId,
    pixel_id: input.pixelId || '',
    destination_pages: input.destinationPages,
    api_version: input.apiVersion,
  }));
}

async function encryptStagingSyntheticSeedState(state, encryptToken, env) {
  try {
    return await encryptToken(JSON.stringify(state), env);
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
}

async function decryptStagingSyntheticSeedState(operation, decryptToken, env) {
  try {
    const parsed = JSON.parse(await decryptToken(operation.state_ciphertext, env));
    if (!isJsonObject(parsed) || clean(parsed.contract) !== STAGING_SYNTHETIC_SEED_CONTRACT) {
      throw new Error('invalid_seed_state');
    }
    return parsed;
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
}

async function persistStagingSyntheticSeedState({ env, operation, state, status, encryptToken, context }) {
  if (context?.assertBootstrapLease) await context.assertBootstrapLease();
  if (typeof encryptToken !== 'function') {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
  const stateCiphertext = await encryptStagingSyntheticSeedState(state, encryptToken, env);
  try {
    const result = await dbRun(env, [
      'UPDATE meta_ads_publish_staging_seed_operations',
      'SET status = ?, state_ciphertext = ?, summary_json = ?, updated_at = ?',
      'WHERE id = ? AND operation_key = ?',
    ].join(' '),
    status, stateCiphertext, JSON.stringify(summarizeStagingSyntheticSeedState(state)), nowIso(), operation.id, operation.operation_key);
    if (statementChanges(result) !== 1) {
      throw new Error('seed_state_missing');
    }
    operation.status = status;
    operation.state_ciphertext = stateCiphertext;
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
}

function summarizeStagingSyntheticSeedState(state) {
  const resources = asObject(state?.resources);
  const destinationFacts = asObject(asObject(state?.facts).destinations);
  return {
    contract: STAGING_SYNTHETIC_SEED_CONTRACT,
    phase: clean(state?.phase) || 'unknown',
    reconciliation_required: state?.reconciliation_required === true,
    graph_facts_verified:
      clean(asObject(state?.facts).dataset_id) !== '' &&
      STAGING_SYNTHETIC_SEED_DESTINATIONS.every((destination) => {
        const facts = asObject(destinationFacts[destination.key]);
        return Boolean(clean(facts.page_id) && clean(facts.instagram_user_id));
      }),
    destination_count: STAGING_SYNTHETIC_SEED_DESTINATIONS.length,
    campaign_created: Boolean(clean(asObject(resources.campaign).id)),
    adset_count: ['source_adset', 'target_adset'].filter((key) => clean(asObject(resources[key]).id)).length,
    creative_created: Boolean(clean(asObject(resources.source_creative).id)),
    detached_creative_retained: state?.detached_creative_retained === true,
    ad_created: Boolean(clean(asObject(resources.source_ad).id)),
    credentials_sealed: state?.credentials_sealed === true,
  };
}

async function replayStagingSyntheticSeed({ operation, input, env, requestId, decryptToken }) {
  const requestHash = await stagingSyntheticSeedRequestHash(input);
  if (clean(operation.request_hash) !== requestHash) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_operation_conflict', 409);
  }
  const status = clean(operation.status);
  if (status === 'sealed') {
    // A sealed operation never needs the inbound source token to prove its
    // replay. The caller still supplied it because this route intentionally
    // has one closed request shape.
    return stagingSyntheticSeedSuccess({ requestId, operationKey: input.operationKey, status: 'sealed', replayed: true });
  }
  if (status === 'rolled_back') {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_operation_conflict', 409);
  }
  // Do not attempt to decrypt or heal a partial operation in the seed path.
  // A caller must use the explicit rollback surface under a new governed run.
  void env;
  void decryptToken;
  throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
}

function assertStagingSyntheticSeedStateMatchesInput(state, input) {
  const saved = asObject(state?.input);
  if (
    clean(saved.operation_key) !== input.operationKey ||
    clean(saved.account_id) !== input.accountId ||
    clean(saved.api_version) !== input.apiVersion
  ) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_operation_conflict', 409);
  }
}

function assertStagingSyntheticSeedReconciliationInput(state, input) {
  const saved = asObject(state?.input);
  if (
    clean(saved.account_id) !== input.accountId ||
    clean(saved.api_version) !== input.apiVersion
  ) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_operation_conflict', 409);
  }
}

function stagingSyntheticSeedStateHasNoGraphMutation(state) {
  const resources = asObject(state?.resources);
  return (
    state?.credentials_sealed !== true &&
    state?.credentials_sealing_started !== true &&
    Object.values(resources).every((resource) => {
      const value = asObject(resource);
      return !value.pending && !clean(value.id);
    })
  );
}

async function resolveStagingSyntheticSeedPendingResources({ env, operation, state, auth, encryptToken, context }) {
  const resources = asObject(state.resources);
  const campaignResource = asObject(resources.campaign);
  const campaignId = clean(campaignResource.id);
  const campaignName = clean(campaignResource.name);
  if (!/^\d{5,30}$/.test(campaignId) || !campaignName) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  await readStagingSyntheticSeedReconciliationCampaign(auth, campaignId, campaignName, context);

  const pendingKeys = ['source_adset', 'target_adset'].filter((key) => (
    asObject(resources[key]).pending === true
  ));
  if (!pendingKeys.length) {
    if (stagingSyntheticSeedStateHasAmbiguousMutation(state)) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    return;
  }
  if (pendingKeys.length > 2) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }

  let listing;
  try {
    listing = await seedGraphRead(
      auth,
      `${campaignId}/adsets`,
      'id,name,campaign_id,account_id,status,destination_type',
      context,
      { limit: '100' },
      { maxAttempts: 1, failureCode: 'meta_ads_publish_staging_seed_reconciliation_required', authFailureCode: 'meta_ads_publish_staging_seed_reconciliation_required', malformedFailureCode: 'meta_ads_publish_staging_seed_reconciliation_required', contractFailureCode: 'meta_ads_publish_staging_seed_reconciliation_required' },
    );
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  if (!Array.isArray(listing.data) || clean(asObject(listing.paging).next)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  if (listing.data.length === 0) {
    for (const key of pendingKeys) {
      state.resources[key] = {
        name: clean(asObject(resources[key]).name),
        pending: false,
        owned_by_operation: false,
      };
    }
    state.phase = 'reconciling';
    await persistStagingSyntheticSeedState({ env, operation, state, status: 'reconciliation_required', encryptToken, context });
    return;
  }

  const normalized = listing.data.map((entry) => {
    const value = asObject(entry);
    let id;
    let accountId;
    let entryCampaignId;
    try {
      id = normalizeStagingSyntheticSeedGraphId(value.id, 'reconcile_adset_id');
      accountId = normalizeStagingSyntheticSeedGraphId(value.account_id, 'reconcile_adset_account_id');
      entryCampaignId = normalizeStagingSyntheticSeedGraphId(value.campaign_id, 'reconcile_adset_campaign_id');
    } catch {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    return {
      id,
      name: clean(value.name),
      accountId,
      campaignId: entryCampaignId,
      status: clean(value.status).toUpperCase(),
      destinationType: clean(value.destination_type).toUpperCase(),
    };
  });
  const accountId = clean(asObject(state.input).account_id);
  for (const key of pendingKeys) {
    const expectedName = clean(asObject(resources[key]).name);
    const matches = normalized.filter((entry) => (
      entry.name === expectedName &&
      entry.campaignId === campaignId &&
      entry.accountId === accountId
    ));
    if (matches.length !== 1) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    const match = matches[0];
    state.resources[key] = {
      id: match.id,
      name: expectedName,
      pending: false,
      owned_by_operation: true,
    };
  }
  state.phase = 'reconciling';
  await persistStagingSyntheticSeedState({ env, operation, state, status: 'reconciliation_required', encryptToken, context });
}

function stagingSyntheticSeedStateHasAmbiguousMutation(state) {
  return state?.credentials_sealing_started === true ||
    Object.values(asObject(state?.resources)).some((resource) => asObject(resource).pending === true);
}

async function assertStagingSyntheticSeedRollbackAuthority(env, state) {
  const expected = asObject(state?.seeded_authority);
  const expectedRevision = clean(expected.revision);
  const credentials = asObject(state?.credential_ids);
  const sourceId = clean(credentials.source);
  const targetId = clean(credentials.target);
  const expectedSource = asObject(expected.source_meta_ads_publish);
  const expectedTarget = asObject(expected.target_meta_ads_publish);
  if (!expectedRevision || !sourceId || !targetId || sourceId === targetId || !Object.keys(expectedSource).length || !Object.keys(expectedTarget).length) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  const currentRows = await listMetaAdsPublishConfigRows(env);
  const authority = await configWriterAuthorityState(currentRows);
  const rowsById = new Map(currentRows.map((row) => [clean(row.id), row]));
  const source = asObject(parseObject(rowsById.get(sourceId)?.metadata_json).meta_ads_publish);
  const target = asObject(parseObject(rowsById.get(targetId)?.metadata_json).meta_ads_publish);
  if (
    authority.ready ||
    authority.mode !== 'legacy_bootstrap' ||
    clean(authority.revision) !== expectedRevision ||
    stableStringify(source) !== stableStringify(expectedSource) ||
    stableStringify(target) !== stableStringify(expectedTarget)
  ) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
}

async function writeStagingSyntheticSeedAudit(writeAudit, env, requestId, status, metadata = {}) {
  if (typeof writeAudit !== 'function') return;
  await writeAudit(env, {
    tokenId: null,
    event: 'meta_ads_publish.staging_synthetic_seed',
    provider: 'facebook',
    unit: STAGING_SYNTHETIC_SEED_UNIT,
    tokenType: 'staging_synthetic',
    status: clean(status).slice(0, 120) || 'unknown',
    requestId,
    metadata: {
      contract: STAGING_SYNTHETIC_SEED_CONTRACT,
      environment: 'staging',
      ...metadata,
    },
  });
}

async function discoverStagingSyntheticSeedFacts({
  input,
  auth,
  context,
  failureCodes = STAGING_SYNTHETIC_SEED_DISCOVERY_FAILURES,
  maxGraphAttempts = MAX_GRAPH_ATTEMPTS,
  probeAppSecretProof = false,
}) {
  const read = (
    path,
    fields,
    query = {},
    failureCode = failureCodes.sourceUnavailable,
    malformedFailureCode = '',
    contractFailureCode = '',
  ) => seedGraphRead(auth, path, fields, context, query, {
    maxAttempts: maxGraphAttempts,
    failureCode,
    authFailureCode: failureCodes.sourceAuthRejected,
    malformedFailureCode,
    contractFailureCode,
  });
  const readPixel = (candidateAuth) => seedGraphRead(
    candidateAuth,
    input.pixelId,
    'id',
    context,
    {},
    {
      maxAttempts: maxGraphAttempts,
      failureCode: failureCodes.pixelAccessDenied,
      authFailureCode: failureCodes.sourceAuthRejected,
    },
  );
  let pixel;
  try {
    pixel = await readPixel(auth);
  } catch (error) {
    const appSecretProofMismatch = clean(failureCodes.appSecretProofMismatch);
    if (
      !probeAppSecretProof ||
      !clean(auth.appSecretProof) ||
      !appSecretProofMismatch ||
      clean(error?.message) === 'meta_ads_publish_staging_seed_unavailable'
    ) {
      throw error;
    }
    try {
      await readPixel({ ...auth, appSecretProof: '' });
    } catch (fallbackError) {
      if (clean(fallbackError?.message) === 'meta_ads_publish_staging_seed_unavailable') {
        throw fallbackError;
      }
      throw error;
    }
    throw stagingSyntheticSeedFailure(appSecretProofMismatch, 409);
  }
  if (normalizeStagingSyntheticSeedGraphId(pixel.id, 'pixel_id', failureCodes.identityMalformed) !== input.pixelId) {
    throw stagingSyntheticSeedFailure(failureCodes.identityMismatch, 409);
  }

  // A Pixel may be shared with an ad account without that account owning it.
  // Validate the association required by the later promoted_object instead of
  // requiring ownership, while bounding the account's visible Pixel list.
  const accountPixels = await read(
    `act_${input.accountId}/adspixels`,
    'id',
    { limit: String(STAGING_SYNTHETIC_SEED_MAX_GRAPH_OBJECTS) },
    failureCodes.pixelAccountRelationAccessDenied,
    failureCodes.identityMalformed,
  );
  if (!Array.isArray(accountPixels.data)) {
    throw stagingSyntheticSeedFailure(failureCodes.identityMalformed, 409);
  }
  const associatedPixelIds = accountPixels.data.map((entry) => normalizeStagingSyntheticSeedGraphId(
    asObject(entry).id,
    'account_pixel_id',
    failureCodes.identityMalformed,
  ));
  const matchingPixelCount = associatedPixelIds.filter((pixelId) => pixelId === input.pixelId).length;
  if (matchingPixelCount === 1 && new Set(associatedPixelIds).size === associatedPixelIds.length) {
    // Membership is proven by an exact target on this bounded page. Do not
    // follow opaque pagination URLs or reject an otherwise valid account just
    // because it has more associated Pixels than the diagnostic page limit.
  } else if (clean(asObject(accountPixels.paging).next)) {
    throw stagingSyntheticSeedFailure(failureCodes.pixelAccountRelationAmbiguous, 409);
  } else {
    throw stagingSyntheticSeedFailure(failureCodes.identityMismatch, 409);
  }

  // Both destination selectors are explicit staging facts. The authenticated
  // System User's bounded `assigned_pages` edge returns Page objects, so keep
  // the landing/media fields on that read and do not issue an additional
  // Page-node GET with a Business/Marketing-scoped bearer. Never select by
  // list order or fall back to user-centric `/me/accounts` discovery when the
  // deployment has declared two units.
  const pageDiscoveryFields = 'id,tasks,instagram_business_account{id},website,picture{url}';
  const sourcePrincipal = await read(
    'me',
    'id',
    {},
    failureCodes.pageAccessDenied,
    failureCodes.identityMalformed,
  );
  const sourcePrincipalId = normalizeStagingSyntheticSeedGraphId(
    sourcePrincipal.id,
    'source_principal_id',
    failureCodes.identityMalformed,
  );
  const assignedPages = await read(
    `${sourcePrincipalId}/assigned_pages`,
    pageDiscoveryFields,
    { limit: '100' },
    failureCodes.pageAccessDenied,
    failureCodes.identityMalformed,
  );
  if (!Array.isArray(assignedPages.data)) {
    throw stagingSyntheticSeedFailure(failureCodes.identityMalformed, 409);
  }
  if (clean(asObject(assignedPages.paging).next)) {
    throw stagingSyntheticSeedFailure(failureCodes.pageAmbiguous, 409);
  }
  const selectedDestinations = [];
  const seenPageIds = new Set();
  const seenInstagramUserIds = new Set();
  for (const destination of STAGING_SYNTHETIC_SEED_DESTINATIONS) {
    const selectedPage = selectStagingSyntheticSeedPage(
      assignedPages.data,
      input.destinationPages[destination.key],
      failureCodes,
    );
    const selectedPageId = normalizeStagingSyntheticSeedGraphId(
      selectedPage.id,
      `${destination.key}_page_id`,
      failureCodes.identityMalformed,
    );
    const selectedInstagramUserId = normalizeStagingSyntheticSeedGraphId(
      asObject(selectedPage.instagram_business_account).id,
      `${destination.key}_instagram_user_id`,
      failureCodes.identityMalformed,
    );
    if (seenPageIds.has(selectedPageId) || seenInstagramUserIds.has(selectedInstagramUserId)) {
      throw stagingSyntheticSeedFailure(failureCodes.identityMismatch, 409);
    }
    seenPageIds.add(selectedPageId);
    seenInstagramUserIds.add(selectedInstagramUserId);
    selectedDestinations.push({
      destination,
      selectedPageId,
      selectedInstagramUserId,
      page: selectedPage,
    });
  }
  const destinations = {};
  for (const { destination, selectedPageId, selectedInstagramUserId, page } of selectedDestinations) {
    const landing = normalizeStagingSyntheticSeedLanding(page.website);
    const pictureUrl = normalizeStagingSyntheticSeedPicture(page.picture);
    if (!landing || !pictureUrl) {
      throw stagingSyntheticSeedFailure(failureCodes.landingOrMediaUnavailable, 409);
    }
    destinations[destination.key] = {
      page_id: selectedPageId,
      instagram_user_id: selectedInstagramUserId,
      landing_url: landing.url,
      landing_host: landing.host,
      page_picture_url: pictureUrl,
    };
  }

  // Meta's converged website/offline Dataset uses the Pixel identity as its
  // Dataset ID. The Pixel node and its exact ad-account membership were
  // already proven above, so do not enumerate the Business Dataset edge here:
  // that edge is contract-drifted for this token and is not needed to construct the
  // later offline_conversion_data_set_id.
  const datasetId = normalizeStagingSyntheticSeedGraphId(
    input.pixelId,
    'offline_dataset_id',
    failureCodes.identityMalformed,
  );
  return {
    destinations,
    dataset_id: datasetId,
  };
}

function stagingSyntheticSeedEligiblePages(value) {
  return safeArray(value).map(asObject).filter((page) => {
    const tasks = new Set(safeArray(page.tasks).map((task) => clean(task).toUpperCase()));
    return [...STAGING_SYNTHETIC_SEED_PAGE_ADVERTISE_TASKS].some((task) => tasks.has(task)) &&
      /^\d{5,30}$/.test(clean(asObject(page.instagram_business_account).id));
  });
}

function selectStagingSyntheticSeedPage(value, selectedPageId, failureCodes) {
  const eligiblePages = stagingSyntheticSeedEligiblePages(value);
  const candidates = selectedPageId
    ? eligiblePages.filter((page) => clean(page.id) === selectedPageId)
    : eligiblePages;
  if (candidates.length !== 1) {
    throw stagingSyntheticSeedFailure(failureCodes.pageAmbiguous, 409);
  }
  return candidates[0];
}

async function seedGraphRead(auth, path, fields, context, query = {}, {
  maxAttempts = MAX_GRAPH_ATTEMPTS,
  failureCode = 'meta_ads_publish_staging_seed_graph_identity_invalid',
  authFailureCode = failureCode,
  malformedFailureCode = '',
  contractFailureCode = '',
} = {}) {
  try {
    const result = await graphRequest(
      graphUrl(auth.apiVersion, path, { fields, ...query }),
      { method: 'GET' },
      auth,
      context,
      { maxAttempts },
    );
    return asObject(result.body);
  } catch (error) {
    const normalized = normalizeFailure(error);
    if (normalized.retryable || normalized.ambiguous || Number(normalized.http_status) >= 500) {
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
    }
    if (isStagingSyntheticSeedSourceAuthFailure(normalized)) {
      throw stagingSyntheticSeedFailure(authFailureCode, 409);
    }
    // Non-auth permanent/unknown failures on an explicitly classified edge
    // are bounded contract/response rejections. Keep them separate from
    // identity/asset failures so a caller does not grant Meta permissions for
    // an unsupported edge, field projection, or malformed error envelope.
    if (
      clean(contractFailureCode) &&
      ['permanent', 'unknown'].includes(clean(normalized.classification))
    ) {
      throw stagingSyntheticSeedFailure(contractFailureCode, 409);
    }
    if (clean(malformedFailureCode) && clean(normalized.classification) === 'permanent') {
      throw stagingSyntheticSeedFailure(malformedFailureCode, 409);
    }
    throw stagingSyntheticSeedFailure(failureCode, 409);
  }
}

function isStagingSyntheticSeedSourceAuthFailure(normalized) {
  return Number(normalized?.http_status) === 401 || [102, 190].includes(Number(normalized?.code || 0));
}

function normalizeStagingSyntheticSeedGraphId(value, label, failureCode = 'meta_ads_publish_staging_seed_graph_identity_invalid') {
  try {
    return normalizeNumericId(value, `staging_seed_${label}`);
  } catch {
    throw stagingSyntheticSeedFailure(failureCode, 409);
  }
}

function normalizeStagingSyntheticSeedLanding(value) {
  try {
    const url = new URL(clean(value));
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      /(?:facebook|instagram|whatsapp)\.com$/i.test(url.hostname)
    ) {
      return null;
    }
    return { url: url.toString(), host: url.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

function normalizeStagingSyntheticSeedPicture(value) {
  const picture = asObject(value);
  const candidate = clean(picture.url || asObject(picture.data).url);
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

async function createStagingSyntheticSeedResources({ input, auth, facts, operation, state, encryptToken, context }) {
  state.phase = 'creating_resources';
  await persistStagingSyntheticSeedState({ env: context.env, operation, state, status: 'creating', encryptToken, context });
  const marker = stagingSyntheticSeedMarker(state);
  const sourceDestinationFacts = stagingSyntheticSeedDestinationFacts(facts, 'source');

  const campaign = await createStagingSyntheticSeedGraphResource({
    key: 'campaign',
    name: `${marker} Campaign`,
    operation,
    state,
    encryptToken,
    context,
    create: () => seedGraphCreate(auth, `act_${input.accountId}/campaigns`, {
      name: `${marker} Campaign`,
      objective: 'OUTCOME_LEADS',
      buying_type: 'AUCTION',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      status: 'PAUSED',
    }, context),
    read: (id) => readStagingSyntheticSeedCampaign(auth, id, `${marker} Campaign`, context),
  });

  const commonAdset = {
    campaign_id: campaign.id,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    destination_type: 'WEBSITE',
    daily_budget: '1000',
    attribution_spec: [
      { event_type: 'CLICK_THROUGH', window_days: 7 },
      { event_type: 'VIEW_THROUGH', window_days: 1 },
    ],
    targeting: { geo_locations: { countries: ['BR'] } },
    status: 'PAUSED',
  };
  const sourceAdset = await createStagingSyntheticSeedGraphResource({
    key: 'source_adset',
    name: `${marker} Source Ad Set`,
    operation,
    state,
    encryptToken,
    context,
    create: () => seedGraphCreate(auth, `act_${input.accountId}/adsets`, {
      ...commonAdset,
      name: `${marker} Source Ad Set`,
      promoted_object: {
        pixel_id: input.pixelId,
        custom_event_type: 'LEAD',
        offline_conversion_data_set_id: facts.dataset_id,
      },
    }, context),
    read: (id) => readStagingSyntheticSeedAdset(auth, id, campaign.id, `${marker} Source Ad Set`, context),
  });
  const targetAdset = await createStagingSyntheticSeedGraphResource({
    key: 'target_adset',
    name: `${marker} Target Ad Set`,
    operation,
    state,
    encryptToken,
    context,
    create: () => seedGraphCreate(auth, `act_${input.accountId}/adsets`, {
      ...commonAdset,
      name: `${marker} Target Ad Set`,
    }, context),
    read: (id) => readStagingSyntheticSeedAdset(auth, id, campaign.id, `${marker} Target Ad Set`, context),
  });
  // From here on the synthetic ad sets are durable and can be referenced by a
  // concurrent data-plane request. Hold the same resource locks used by normal
  // ensure/stage/rollback operations until this seed has either sealed or
  // compensated them.
  await acquireStagingSyntheticSeedMutationLocks(context, state);
  assertStagingSyntheticSeedAdsetContract({ input, source: sourceAdset.value, target: targetAdset.value });

  const creative = await createStagingSyntheticSeedGraphResource({
    key: 'source_creative',
    name: `${marker} Source Creative`,
    operation,
    state,
    encryptToken,
    context,
    create: () => seedGraphCreate(auth, `act_${input.accountId}/adcreatives`, {
      name: `${marker} Source Creative`,
      object_story_spec: {
        page_id: sourceDestinationFacts.page_id,
        instagram_actor_id: sourceDestinationFacts.instagram_user_id,
        link_data: {
          link: sourceDestinationFacts.landing_url,
          picture: sourceDestinationFacts.page_picture_url,
          message: STAGING_SYNTHETIC_SEED_CREATIVE_MESSAGE,
          call_to_action: {
            type: STAGING_SYNTHETIC_SEED_CREATIVE_CTA,
            value: { link: sourceDestinationFacts.landing_url },
          },
        },
      },
      url_tags: state.url_tags,
    }, context),
    read: (id) => readStagingSyntheticSeedCreative(auth, id, `${marker} Source Creative`, state.url_tags, context),
  });
  const ad = await createStagingSyntheticSeedGraphResource({
    key: 'source_ad',
    name: `${marker} Source Ad`,
    operation,
    state,
    encryptToken,
    context,
    create: () => seedGraphCreate(auth, `act_${input.accountId}/ads`, {
      name: `${marker} Source Ad`,
      adset_id: sourceAdset.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    }, context),
    read: (id) => readStagingSyntheticSeedAd(auth, id, sourceAdset.id, creative.id, `${marker} Source Ad`, context),
  });

  state.phase = 'resources_verified';
  await persistStagingSyntheticSeedState({ env: context.env, operation, state, status: 'creating', encryptToken, context });
  return { campaign, sourceAdset, targetAdset, creative, ad };
}

function stagingSyntheticSeedMarker(state) {
  return `[SKINCOS-STAGING-V20:${clean(state?.marker).slice(0, 24)}]`;
}

function stagingSyntheticSeedDestinationForCredential(credentialKey) {
  const destination = STAGING_SYNTHETIC_SEED_DESTINATIONS.find((candidate) => candidate.credentialKey === credentialKey);
  if (!destination) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  return destination;
}

function stagingSyntheticSeedDestinationFacts(value, credentialKey) {
  const destination = stagingSyntheticSeedDestinationForCredential(credentialKey);
  const facts = asObject(asObject(value).destinations)[destination.key];
  const normalized = asObject(facts);
  const required = [
    clean(normalized.page_id),
    clean(normalized.instagram_user_id),
    clean(normalized.landing_url),
    clean(normalized.landing_host),
    clean(normalized.page_picture_url),
  ];
  if (required.some((entry) => !entry)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  return normalized;
}

async function createStagingSyntheticSeedGraphResource({ key, name, operation, state, encryptToken, context, create, read }) {
  const existing = asObject(asObject(state.resources)[key]);
  if (clean(existing.id)) {
    const value = await read(clean(existing.id));
    return { id: clean(existing.id), value };
  }
  state.resources[key] = { name, pending: true, owned_by_operation: false };
  await persistStagingSyntheticSeedState({ env: context.env, operation, state, status: 'creating', encryptToken, context });
  let created;
  try {
    created = await create();
  } catch (error) {
    const normalized = normalizeFailure(error);
    if (normalized.ambiguous || normalized.retryable) {
      state.reconciliation_required = true;
      state.phase = 'reconciliation_required';
      await persistStagingSyntheticSeedState({ env: context.env, operation, state, status: 'reconciliation_required', encryptToken, context }).catch(() => undefined);
      throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
    }
    state.resources[key].pending = false;
    await persistStagingSyntheticSeedState({ env: context.env, operation, state, status: 'creating', encryptToken, context });
    throw error;
  }
  const id = normalizeStagingSyntheticSeedCreatedId(created, key);
  state.resources[key] = { id, name, pending: false, owned_by_operation: true };
  // Persist the durable acknowledgement before the first readback. A process
  // loss after Meta accepted the POST must become reconciliation, never a
  // duplicate create or an unowned cleanup.
  await persistStagingSyntheticSeedState({ env: context.env, operation, state, status: 'creating', encryptToken, context });
  const value = await read(id);
  return { id, value };
}

async function seedGraphCreate(auth, path, body, context) {
  try {
    const result = await graphRequest(
      graphUrl(auth.apiVersion, path),
      seedJsonRequest('POST', body),
      auth,
      context,
      { maxAttempts: 1 },
    );
    return asObject(result.body);
  } catch (error) {
    throw error;
  }
}

function seedJsonRequest(method, body) {
  // jsonRequest intentionally removes empty arrays. Meta requires an explicit
  // empty special_ad_categories list for a campaign, so this one narrow helper
  // preserves the closed synthetic payload exactly.
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sanitizeGraphValue(body)),
  };
}

function normalizeStagingSyntheticSeedCreatedId(value, key) {
  try {
    return normalizeNumericId(asObject(value).id, `staging_seed_${key}_id`);
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
}

async function readStagingSyntheticSeedCampaign(auth, campaignId, expectedName, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, campaignId, { fields: CAMPAIGN_READ_FIELDS }),
    { method: 'GET' }, auth, context,
  );
  const campaign = asObject(result.body);
  let actualId;
  try {
    actualId = normalizeStagingSyntheticSeedGraphId(campaign.id, 'campaign_id');
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_campaign_contract_malformed', 409);
  }
  if (actualId !== campaignId) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_campaign_identity_mismatch', 409);
  }
  if (!clean(campaign.name)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_campaign_contract_malformed', 409);
  }
  if (clean(campaign.name) !== expectedName) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_campaign_name_mismatch', 409);
  }
  if (!clean(campaign.status)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_campaign_contract_malformed', 409);
  }
  if (clean(campaign.status).toUpperCase() !== 'PAUSED') {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_campaign_status_mismatch', 409);
  }
  if (!clean(campaign.objective)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_campaign_contract_malformed', 409);
  }
  if (clean(campaign.objective).toUpperCase() !== 'OUTCOME_LEADS') {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_campaign_objective_mismatch', 409);
  }
  return campaign;
}

async function readStagingSyntheticSeedReconciliationCampaign(auth, campaignId, expectedName, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, campaignId, { fields: 'id,name,status' }),
    { method: 'GET' }, auth, context,
  );
  const campaign = asObject(result.body);
  let actualId;
  try {
    actualId = normalizeStagingSyntheticSeedGraphId(campaign.id, 'reconcile_campaign_id');
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  if (actualId !== campaignId || clean(campaign.name) !== expectedName || !clean(campaign.status)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  return campaign;
}

async function readStagingSyntheticSeedAdset(auth, adsetId, campaignId, expectedName, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, adsetId, { fields: STAGING_SYNTHETIC_SEED_ADSET_FIELDS }),
    { method: 'GET' }, auth, context,
  );
  const adset = asObject(result.body);
  if (
    normalizeStagingSyntheticSeedGraphId(adset.account_id, 'adset_account_id') !== auth.accountId ||
    normalizeStagingSyntheticSeedGraphId(adset.campaign_id || asObject(adset.campaign).id, 'adset_campaign_id') !== campaignId ||
    clean(adset.name) !== expectedName ||
    clean(adset.status).toUpperCase() !== 'PAUSED' ||
    safeTrackingEnum(adset.destination_type) !== 'WEBSITE'
  ) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_contract_invalid', 409);
  }
  return adset;
}

function assertStagingSyntheticSeedAdsetContract({ input, source, target }) {
  try {
    const sourcePromoted = asObject(source.promoted_object);
    if (
      normalizeNumericId(sourcePromoted.pixel_id, 'staging_seed_source_pixel_id') !== input.pixelId ||
      !safeTrackingEnum(sourcePromoted.custom_event_type) ||
      !normalizeNumericId(sourcePromoted.offline_conversion_data_set_id, 'staging_seed_source_dataset_id')
    ) {
      throw new Error('source_tracking_missing');
    }
    assertWebsiteTrackingCompatibility(source, target, {
      website_event_requirement: 'required',
      offline_event_dataset_requirement: 'required',
    });
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_contract_invalid', 409);
  }
}

async function readStagingSyntheticSeedCreative(auth, creativeId, expectedName, expectedUrlTags, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, creativeId, { fields: 'id,name,url_tags' }),
    { method: 'GET' }, auth, context,
  );
  const creative = asObject(result.body);
  try {
    if (
      normalizeNumericId(creative.id, 'staging_seed_creative_id') !== creativeId ||
      clean(creative.name) !== expectedName ||
      normalizeUrlTags(creative.url_tags, { required: true }) !== expectedUrlTags
    ) {
      throw new Error('creative_mismatch');
    }
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_contract_invalid', 409);
  }
  return creative;
}

async function readStagingSyntheticSeedAd(auth, adId, expectedAdsetId, expectedCreativeId, expectedName, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, adId, { fields: AD_STATE_FIELDS }),
    { method: 'GET' }, auth, context,
  );
  const ad = asObject(result.body);
  try {
    if (
      normalizeNumericId(ad.id, 'staging_seed_ad_id') !== adId ||
      normalizeNumericId(ad.adset_id, 'staging_seed_ad_adset_id') !== expectedAdsetId ||
      normalizeNumericId(asObject(ad.creative).id, 'staging_seed_ad_creative_id') !== expectedCreativeId ||
      clean(ad.name) !== expectedName ||
      clean(ad.status).toUpperCase() !== 'PAUSED' ||
      !['PAUSED', 'PENDING_REVIEW', 'WITH_ISSUES'].includes(clean(ad.effective_status).toUpperCase())
    ) {
      throw new Error('ad_mismatch');
    }
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_graph_contract_invalid', 409);
  }
  return ad;
}

async function sealStagingSyntheticSeedCredentials({ input, env, operation, state, encryptToken, requestId, context }) {
  const resources = asObject(state.resources);
  const facts = asObject(state.facts);
  const sourceDestinationFacts = stagingSyntheticSeedDestinationFacts(facts, 'source');
  const targetDestinationFacts = stagingSyntheticSeedDestinationFacts(facts, 'target');
  const required = [
    clean(asObject(resources.campaign).id),
    clean(asObject(resources.source_adset).id),
    clean(asObject(resources.target_adset).id),
    clean(asObject(resources.source_creative).id),
    clean(asObject(resources.source_ad).id),
    clean(sourceDestinationFacts.page_id),
    clean(sourceDestinationFacts.instagram_user_id),
    clean(targetDestinationFacts.page_id),
    clean(targetDestinationFacts.instagram_user_id),
    clean(facts.dataset_id),
  ];
  if (required.some((value) => !/^\d{5,30}$/.test(value))) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  await context.assertBootstrapLease();
  let sourceCiphertext;
  let targetCiphertext;
  try {
    sourceCiphertext = await encryptToken(input.accessToken, env);
    targetCiphertext = await encryptToken(input.accessToken, env);
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
  const metadata = buildStagingSyntheticSeedCredentialMetadata({ input, state });
  const sourceMetadataJson = JSON.stringify(metadata.source);
  const targetMetadataJson = JSON.stringify(metadata.target);
  const seededAuthority = await configWriterAuthorityState([
    {
      id: state.credential_ids.source,
      external_account_id: input.accountId,
      metadata_json: sourceMetadataJson,
    },
    {
      id: state.credential_ids.target,
      external_account_id: input.accountId,
      metadata_json: targetMetadataJson,
    },
  ]);
  if (seededAuthority.ready || seededAuthority.mode !== 'legacy_bootstrap' || !clean(seededAuthority.revision)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  state.credentials_sealing_started = true;
  state.credentials = {
    source: { id: state.credential_ids.source, token_type: STAGING_SYNTHETIC_SEED_SOURCE_TOKEN_TYPE },
    target: { id: state.credential_ids.target, token_type: STAGING_SYNTHETIC_SEED_TARGET_TOKEN_TYPE },
  };
  state.seeded_authority = {
    revision: seededAuthority.revision,
    source_meta_ads_publish: asObject(metadata.source.meta_ads_publish),
    target_meta_ads_publish: asObject(metadata.target.meta_ads_publish),
  };
  await persistStagingSyntheticSeedState({ env, operation, state, status: 'creating', encryptToken, context });
  const nextState = {
    ...state,
    phase: 'sealed',
    credentials_sealed: true,
    credentials_sealing_started: false,
  };
  const stateCiphertext = await encryptStagingSyntheticSeedState(nextState, encryptToken, env);
  const now = nowIso();
  const statements = [
    env.TOKEN_VAULT_DB.prepare([
      'INSERT INTO credential_tokens (id, provider, unit, external_account_id, token_type, token_ciphertext, active, metadata_json, created_at, updated_at)',
      'SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?',
      "WHERE NOT EXISTS (SELECT 1 FROM credential_tokens WHERE provider = 'facebook' AND active = 1 AND id NOT IN (?, ?))",
    ].join(' ')).bind(
      state.credential_ids.source, 'facebook', STAGING_SYNTHETIC_SEED_UNIT, input.accountId,
      STAGING_SYNTHETIC_SEED_SOURCE_TOKEN_TYPE, sourceCiphertext, sourceMetadataJson, now, now,
      state.credential_ids.source, state.credential_ids.target,
    ),
    env.TOKEN_VAULT_DB.prepare([
      'INSERT INTO credential_tokens (id, provider, unit, external_account_id, token_type, token_ciphertext, active, metadata_json, created_at, updated_at)',
      'SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?',
      "WHERE NOT EXISTS (SELECT 1 FROM credential_tokens WHERE provider = 'facebook' AND active = 1 AND id NOT IN (?, ?))",
    ].join(' ')).bind(
      state.credential_ids.target, 'facebook', STAGING_SYNTHETIC_SEED_UNIT, input.accountId,
      STAGING_SYNTHETIC_SEED_TARGET_TOKEN_TYPE, targetCiphertext, targetMetadataJson, now, now,
      state.credential_ids.source, state.credential_ids.target,
    ),
    env.TOKEN_VAULT_DB.prepare([
      'UPDATE meta_ads_publish_staging_seed_operations',
      "SET status = 'sealed', state_ciphertext = ?, summary_json = ?, updated_at = ?",
      "WHERE id = ? AND operation_key = ? AND status = 'creating'",
      'AND (SELECT COUNT(*) FROM credential_tokens',
      "WHERE provider = 'facebook' AND active = 1 AND id IN (?, ?)) = 2",
      'AND NOT EXISTS (SELECT 1 FROM credential_tokens',
      "WHERE provider = 'facebook' AND active = 1 AND id NOT IN (?, ?))",
    ].join(' ')).bind(
      stateCiphertext, JSON.stringify(summarizeStagingSyntheticSeedState(nextState)), now, operation.id, operation.operation_key,
      state.credential_ids.source, state.credential_ids.target, state.credential_ids.source, state.credential_ids.target,
    ),
  ];
  let results;
  try {
    results = await env.TOKEN_VAULT_DB.batch(statements);
  } catch {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_unavailable', 503);
  }
  if (safeArray(results).some((result) => statementChanges(result) !== 1)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  Object.assign(state, nextState);
  operation.status = 'sealed';
  void requestId;
}

function buildStagingSyntheticSeedCredentialMetadata({ input, state }) {
  const facts = asObject(state.facts);
  const resources = asObject(state.resources);
  const common = (credentialKey) => {
    const destination = stagingSyntheticSeedDestinationForCredential(credentialKey);
    const destinationFacts = stagingSyntheticSeedDestinationFacts(facts, credentialKey);
    return {
      destination_group: destination.destinationGroup,
      api_version: input.apiVersion,
      account_id: input.accountId,
      campaign_id: clean(asObject(resources.campaign).id),
      page_id: clean(destinationFacts.page_id),
      instagram_user_id: clean(destinationFacts.instagram_user_id),
      allowed_link_hosts: [clean(destinationFacts.landing_host)],
      landing_pages_by_creative_group: { [STAGING_SYNTHETIC_SEED_LANDING_GROUP]: clean(destinationFacts.landing_url) },
      freshness_window_days: 7,
      destination_type: 'website',
      fixture_source_ad_id: clean(asObject(resources.source_ad).id),
      url_tags: normalizeUrlTags(state.url_tags, { required: true }),
    };
  };
  return {
    source: {
      meta_ads_publish: {
        ...common('source'),
        adset_id: clean(asObject(resources.source_adset).id),
        source_adset_id: clean(asObject(resources.source_adset).id),
      },
    },
    target: {
      meta_ads_publish: {
        ...common('target'),
        adset_id: clean(asObject(resources.target_adset).id),
        source_config_token_id: clean(state.credential_ids.source),
      },
    },
  };
}

async function compensateStagingSyntheticSeed({ env, operation, state, auth, encryptToken, context, deactivateCredentials, allowReconciliation = false }) {
  if (state.reconciliation_required === true && allowReconciliation !== true) return { ok: false };
  const resources = asObject(state.resources);
  if (Object.values(resources).some((value) => asObject(value).pending === true)) {
    state.reconciliation_required = true;
    state.phase = 'reconciliation_required';
    if (typeof encryptToken === 'function') {
      await persistStagingSyntheticSeedState({ env, operation, state, status: 'reconciliation_required', encryptToken, context }).catch(() => undefined);
    }
    return { ok: false };
  }
  try {
    if (context?.stagingSyntheticSeedMutationLocksHeld !== true) {
      await acquireStagingSyntheticSeedMutationLocks(context, state);
    }
    if (auth) {
      await archiveStagingSyntheticSeedAd(auth, asObject(resources.source_ad), asObject(resources.source_adset), context);
      await archiveStagingSyntheticSeedAdset(auth, asObject(resources.target_adset), asObject(resources.campaign), context);
      await archiveStagingSyntheticSeedAdset(auth, asObject(resources.source_adset), asObject(resources.campaign), context);
      await archiveStagingSyntheticSeedCampaign(auth, asObject(resources.campaign), context);
    }
    // An AdCreative has no documented archive state, but once every owned ad
    // has been read back as ARCHIVED it is detached from delivery. Retain that
    // inert creative under the encrypted operation journal rather than let an
    // otherwise complete rollback strand the candidate Worker forever.
    state.detached_creative_retained = Boolean(clean(asObject(resources.source_creative).id));
    state.reconciliation_required = false;
    if (deactivateCredentials || state.credentials_sealing_started === true) {
      await deactivateStagingSyntheticSeedCredentials({ env, operation, state, encryptToken, context });
    } else {
      state.phase = 'rolled_back';
      await persistStagingSyntheticSeedState({ env, operation, state, status: 'rolled_back', encryptToken, context });
    }
    return { ok: true };
  } catch {
    state.reconciliation_required = true;
    state.phase = 'reconciliation_required';
    if (typeof encryptToken === 'function') {
      await persistStagingSyntheticSeedState({ env, operation, state, status: 'reconciliation_required', encryptToken, context }).catch(() => undefined);
    }
    return { ok: false };
  }
}

async function archiveStagingSyntheticSeedAd(auth, resource, adset, context) {
  const id = clean(resource.id);
  if (!id) return;
  const currentResult = await graphRequest(
    graphUrl(auth.apiVersion, id, { fields: AD_STATE_FIELDS }),
    { method: 'GET' }, auth, context,
  );
  const current = asObject(currentResult.body);
  if (clean(current.status).toUpperCase() === 'ARCHIVED') return;
  if (clean(current.name) !== clean(resource.name) || clean(current.adset_id) !== clean(adset.id)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  await graphRequest(graphUrl(auth.apiVersion, id), seedJsonRequest('POST', { status: 'ARCHIVED' }), auth, context, { maxAttempts: 1 });
  const readbackResult = await graphRequest(
    graphUrl(auth.apiVersion, id, { fields: AD_STATE_FIELDS }),
    { method: 'GET' }, auth, context,
  );
  const readback = asObject(readbackResult.body);
  if (clean(readback.status).toUpperCase() !== 'ARCHIVED') {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
}

async function archiveStagingSyntheticSeedAdset(auth, resource, campaign, context) {
  const id = clean(resource.id);
  if (!id) return;
  const currentResult = await graphRequest(
    graphUrl(auth.apiVersion, id, { fields: STAGING_SYNTHETIC_SEED_ADSET_FIELDS }),
    { method: 'GET' }, auth, context,
  );
  const current = asObject(currentResult.body);
  if (clean(current.status).toUpperCase() === 'ARCHIVED') return;
  if (
    clean(current.campaign_id || asObject(current.campaign).id) !== clean(campaign.id) ||
    clean(current.name) !== clean(resource.name)
  ) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  await graphRequest(graphUrl(auth.apiVersion, id), seedJsonRequest('POST', { status: 'ARCHIVED' }), auth, context, { maxAttempts: 1 });
  const readbackResult = await graphRequest(
    graphUrl(auth.apiVersion, id, { fields: STAGING_SYNTHETIC_SEED_ADSET_FIELDS }),
    { method: 'GET' }, auth, context,
  );
  const readback = asObject(readbackResult.body);
  if (clean(readback.status).toUpperCase() !== 'ARCHIVED') {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
}

async function archiveStagingSyntheticSeedCampaign(auth, resource, context) {
  const id = clean(resource.id);
  if (!id) return;
  const current = await graphRequest(graphUrl(auth.apiVersion, id, { fields: CAMPAIGN_READ_FIELDS }), { method: 'GET' }, auth, context);
  if (clean(asObject(current.body).status).toUpperCase() === 'ARCHIVED') return;
  if (clean(asObject(current.body).name) !== clean(resource.name)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  await graphRequest(graphUrl(auth.apiVersion, id), seedJsonRequest('POST', { status: 'ARCHIVED' }), auth, context, { maxAttempts: 1 });
  const readback = await graphRequest(graphUrl(auth.apiVersion, id, { fields: CAMPAIGN_READ_FIELDS }), { method: 'GET' }, auth, context);
  if (clean(asObject(readback.body).status).toUpperCase() !== 'ARCHIVED') {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
}

async function deactivateStagingSyntheticSeedCredentials({ env, operation, state, encryptToken, context }) {
  const credentials = asObject(state.credentials);
  const sourceId = clean(asObject(credentials.source).id || asObject(state.credential_ids).source);
  const targetId = clean(asObject(credentials.target).id || asObject(state.credential_ids).target);
  if (!sourceId || !targetId || sourceId === targetId) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  const present = await dbFirst(env, [
    'SELECT COUNT(*) AS count FROM credential_tokens',
    "WHERE provider = 'facebook' AND unit = ? AND active = 1 AND id IN (?, ?)",
  ].join(' '), STAGING_SYNTHETIC_SEED_UNIT, sourceId, targetId);
  const presentCount = Number(present?.count || 0);
  if (presentCount !== 0 && presentCount !== 2) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  state.phase = 'rolling_back';
  await persistStagingSyntheticSeedState({ env, operation, state, status: 'rolling_back', encryptToken, context });
  const nextState = { ...state, phase: 'rolled_back', credentials_sealed: false };
  const stateCiphertext = await encryptStagingSyntheticSeedState(nextState, encryptToken, env);
  const now = nowIso();
  const statements = [
    ...(presentCount === 2 ? [
      env.TOKEN_VAULT_DB.prepare([
        'UPDATE credential_tokens SET active = 0, updated_at = ?',
        'WHERE id = ? AND provider = ? AND unit = ? AND token_type = ? AND active = 1',
      ].join(' ')).bind(now, sourceId, 'facebook', STAGING_SYNTHETIC_SEED_UNIT, STAGING_SYNTHETIC_SEED_SOURCE_TOKEN_TYPE),
      env.TOKEN_VAULT_DB.prepare([
        'UPDATE credential_tokens SET active = 0, updated_at = ?',
        'WHERE id = ? AND provider = ? AND unit = ? AND token_type = ? AND active = 1',
      ].join(' ')).bind(now, targetId, 'facebook', STAGING_SYNTHETIC_SEED_UNIT, STAGING_SYNTHETIC_SEED_TARGET_TOKEN_TYPE),
    ] : []),
    env.TOKEN_VAULT_DB.prepare([
      'UPDATE meta_ads_publish_staging_seed_operations',
      "SET status = 'rolled_back', state_ciphertext = ?, summary_json = ?, updated_at = ?",
      "WHERE id = ? AND operation_key = ? AND status = 'rolling_back'",
    ].join(' ')).bind(
      stateCiphertext, JSON.stringify(summarizeStagingSyntheticSeedState(nextState)), now, operation.id, operation.operation_key,
    ),
  ];
  const results = await env.TOKEN_VAULT_DB.batch(statements);
  if (safeArray(results).some((result) => statementChanges(result) !== 1)) {
    throw stagingSyntheticSeedFailure('meta_ads_publish_staging_seed_reconciliation_required', 409);
  }
  Object.assign(state, nextState);
  operation.status = 'rolled_back';
}

function normalizeBootstrapDeriveFailure(error) {
  if (isBootstrapFailure(error)) return error;
  return bootstrapFailure('meta_ads_publish_bootstrap_derive_unavailable', 503);
}

async function replayDerivedBootstrapIfApplied({ env, requestId, decryptToken, input }) {
  if (!env?.TOKEN_VAULT_DB || typeof env.TOKEN_VAULT_DB.prepare !== 'function') {
    throw bootstrapFailure('meta_ads_publish_bootstrap_unavailable', 503);
  }
  const operation = await loadBootstrapOperation(env, input.operationKey);
  if (!operation || clean(operation.status) !== 'applied') return null;
  if (clean(operation.expected_config_authority_revision) !== input.expectedConfigAuthorityRevision) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_operation_conflict', 409);
  }
  const state = await decryptBootstrapState(operation, decryptToken, env);
  const stateInput = asObject(state.input);
  if (
    clean(stateInput.operation_key) !== input.operationKey ||
    clean(stateInput.expected_config_authority_revision) !== input.expectedConfigAuthorityRevision ||
    !Array.isArray(stateInput.entries)
  ) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
  }
  if (clean(stateInput.derived_plan_sha256) !== input.expectedManifestSha256) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_operation_conflict', 409);
  }
  const authority = await configWriterAuthorityState(await listMetaAdsPublishConfigRows(env));
  if (!authority.ready || clean(operation.resulting_tracking_binding_revision) !== authority.revision) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
  }
  return bootstrapSuccessResponse({
    input: { operationKey: input.operationKey },
    state,
    revision: authority.revision,
    requestId,
    replayed: true,
  });
}

async function readBootstrapDeriveRequest(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 8 * 1024) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_request_too_large', 413);
  }
  try {
    const body = await request.json();
    if (!isJsonObject(body)) throw bootstrapFailure('meta_ads_publish_bootstrap_derive_request_invalid', 400);
    return body;
  } catch (error) {
    if (isBootstrapFailure(error)) throw error;
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_request_invalid', 400);
  }
}

function validateBootstrapDerivePlanInput(body) {
  assertBootstrapExactKeys(body, new Set(['expected_config_authority_revision']));
  return {
    expectedConfigAuthorityRevision: normalizeBootstrapDeriveRevision(body.expected_config_authority_revision),
  };
}

function validateBootstrapDeriveApplyInput(body) {
  assertBootstrapExactKeys(body, new Set([
    'operation_key',
    'expected_config_authority_revision',
    'expected_manifest_sha256',
  ]));
  const operationKey = clean(body.operation_key);
  if (!BOOTSTRAP_OPERATION_KEY_PATTERN.test(operationKey)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_operation_key_invalid', 400);
  }
  const expectedManifestSha256 = clean(body.expected_manifest_sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_digest_invalid', 400);
  }
  return {
    operationKey,
    expectedConfigAuthorityRevision: normalizeBootstrapDeriveRevision(body.expected_config_authority_revision),
    expectedManifestSha256,
  };
}

function normalizeBootstrapDeriveRevision(value) {
  const revision = clean(value).toLowerCase();
  if (!/^legacy:[a-f0-9]{64}$/.test(revision)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_expected_revision_invalid', 400);
  }
  return revision;
}

async function deriveBootstrapManifestPlan({ env, requestId, decryptToken, expectedConfigAuthorityRevision }) {
  if (!env?.TOKEN_VAULT_DB || typeof env.TOKEN_VAULT_DB.prepare !== 'function') {
    throw bootstrapFailure('meta_ads_publish_bootstrap_unavailable', 503);
  }
  if (typeof decryptToken !== 'function') {
    throw bootstrapFailure('meta_ads_publish_bootstrap_token_unavailable', 503);
  }
  const currentRows = await listMetaAdsPublishConfigRows(env);
  const authority = await configWriterAuthorityState(currentRows);
  if (authority.ready || authority.mode !== 'legacy_bootstrap') {
    throw bootstrapFailure('meta_ads_publish_bootstrap_not_legacy', 409);
  }
  if (authority.revision !== expectedConfigAuthorityRevision) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_binding_stale', 409);
  }
  const context = {
    env,
    requestId,
    action: 'derive_meta_ads_publish_bootstrap_plan',
    decryptToken,
    attempts: 0,
    rateUsage: {},
    traceId: '',
  };
  const plan = await deriveBootstrapManifestEntries({
    rows: currentRows,
    context,
    staging: clean(env.ENVIRONMENT).toLowerCase() === 'staging',
  });
  // The digest is an execution seal, not merely a manifest hash. It covers
  // every Graph fact that can affect the persisted profile or the tracking
  // promoted-object mutation, and it is rederived before the saga can write.
  const manifestSha256 = await sha256(stableStringify({
    entries: plan.entries,
    graph_contract: plan.graphContract,
  }));
  return {
    authority,
    entries: plan.entries,
    manifestSha256,
    summary: summarizeBootstrapDeriveEntries(plan.entries),
  };
}

async function deriveBootstrapManifestEntries({ rows, context, staging }) {
  const configuredRows = safeArray(rows)
    .filter((row) => Object.keys(asObject(parseObject(row?.metadata_json).meta_ads_publish)).length > 0)
    .sort((left, right) => clean(left.id).localeCompare(clean(right.id)));
  if (configuredRows.length < 2 || configuredRows.length > BOOTSTRAP_MAX_ENTRIES) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_targets_invalid', 409);
  }

  const records = [];
  const stagingCandidates = [];
  for (const targetRow of configuredRows) {
    const targetAuth = await resolveLegacyBootstrapGraphAuth(clean(targetRow.id), context);
    const targetAdset = await readAdsetConversionState(targetAuth, targetAuth.config.adset_id, context);
    const graphDestination = safeTrackingEnum(targetAdset.destination_type);
    if (graphDestination === 'WEBSITE') {
      const standardRecord = await deriveWebsiteBootstrapEntry({
        targetRow,
        targetAuth,
        targetAdset,
        configuredRows,
        context,
        staging: false,
      });
      records.push(standardRecord);
      if (staging) {
        const stagingRecord = await tryDeriveStagingWebsiteBootstrapEntry({
          targetRow,
          targetAuth,
          targetAdset,
          configuredRows,
          context,
        });
        stagingCandidates.push({ standardRecord, stagingRecord });
      }
      continue;
    }
    if (isBootstrapWhatsAppGraphDestination(graphDestination)) {
      const whatsappDestinationUrl = await discoverBootstrapWhatsAppDestination(targetAuth, targetAdset, context, {});
      records.push({
        entry: {
          config_token_id: targetAuth.tokenId,
          destination_type: 'whatsapp',
        },
        graphFact: deriveWhatsAppBootstrapGraphFact({
          targetAuth,
          targetAdset,
          whatsappDestinationUrl,
        }),
      });
      continue;
    }
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_destination_invalid', 409);
  }

  const websites = records.filter((record) => record.entry.destination_type === 'website');
  if (!websites.length) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_website_destination_required', 409);
  }
  if (staging) {
    const eligible = stagingCandidates.filter((candidate) => candidate.stagingRecord);
    if (eligible.length !== 1) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_derive_staging_fixture_ambiguous', 409);
    }
    const selected = eligible[0];
    const index = records.indexOf(selected.standardRecord);
    if (index < 0) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_derive_staging_fixture_ambiguous', 409);
    }
    records[index] = selected.stagingRecord;
  }
  const ordered = records.sort((left, right) => clean(left.entry.config_token_id).localeCompare(clean(right.entry.config_token_id)));
  return {
    entries: ordered.map((record) => record.entry),
    graphContract: ordered.map((record) => record.graphFact),
  };
}

async function tryDeriveStagingWebsiteBootstrapEntry(input) {
  try {
    return await deriveWebsiteBootstrapEntry({ ...input, staging: true });
  } catch (error) {
    return derivedBootstrapCandidateOrNull(error);
  }
}

async function deriveWebsiteBootstrapEntry({
  targetRow,
  targetAuth,
  targetAdset,
  configuredRows,
  context,
  staging,
}) {
  const targetConfig = asObject(targetAuth.config);
  // A target-declared tag fragment is an authority fact, not a candidate
  // preference. Validate it before examining any potential source so a bad
  // target value can never make another source look acceptable by fallback.
  const targetCanonicalUrlTags = resolveDerivedCanonicalUrlTags([targetConfig]);
  const source = await deriveWebsiteBootstrapSource({
    targetRow,
    targetAuth,
    targetAdset,
    targetConfig,
    configuredRows,
    context,
    staging,
    targetCanonicalUrlTags,
  });
  const entry = {
    config_token_id: targetAuth.tokenId,
    destination_type: 'website',
  };
  if (source.selector.sourceConfigTokenId) {
    entry.source_config_token_id = source.selector.sourceConfigTokenId;
  } else {
    entry.source_adset_id = source.sourceAuth.config.adset_id;
  }
  entry.fixture_source_ad_id = source.fixture.adId;
  entry.url_tags = source.fixture.urlTags;
  if (source.profile.staging_synthetic_fixture === true) {
    entry.staging_synthetic_fixture = true;
  }
  return {
    entry,
    graphFact: deriveWebsiteBootstrapGraphFact({
      targetAuth,
      targetAdset,
      source,
      entry,
    }),
  };
}

async function deriveWebsiteBootstrapSource({
  targetRow,
  targetAuth,
  targetAdset,
  targetConfig,
  configuredRows,
  context,
  staging,
  targetCanonicalUrlTags,
}) {
  const canonical = deriveCanonicalBootstrapSourceSelector(targetConfig);
  if (canonical) {
    const resolved = await tryResolveDerivedBootstrapSource({
      selector: canonical,
      targetAuth,
      targetAdset,
      targetConfig,
      context,
      staging,
    });
    const finalized = resolved && await tryFinalizeDerivedBootstrapSource({ resolved, targetCanonicalUrlTags, context });
    if (!finalized) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_derive_canonical_source_invalid', 409);
    }
    return finalized;
  }

  const pipeline = derivePipelineBootstrapSourceSelectors({
    targetRow,
    targetAuth,
    targetConfig,
    configuredRows,
  });
  const pipelineSource = await selectSingleDerivedBootstrapSource({
    selectors: pipeline,
    targetAuth,
    targetAdset,
    targetConfig,
    context,
    staging,
    targetCanonicalUrlTags,
  });
  if (pipeline.length) {
    if (pipelineSource) return pipelineSource;
    if (staging) throw bootstrapFailure('meta_ads_publish_bootstrap_derive_source_unavailable', 409);
  }

  // The target's live creatives are delivery state, not source authority.
  // A legacy destination may promote only an explicit private selector or a
  // distinct peer already enrolled in the same bounded publishing lineage.
  // In particular, never turn a single target ad into a production source.
  throw bootstrapFailure('meta_ads_publish_bootstrap_derive_source_unavailable', 409);
}

function deriveCanonicalBootstrapSourceSelector(config) {
  const sourceConfigTokenId = clean(config.source_config_token_id);
  const sourceAdsetId = clean(config.source_adset_id);
  if (!sourceConfigTokenId && !sourceAdsetId) return null;
  if (Boolean(sourceConfigTokenId) === Boolean(sourceAdsetId)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_canonical_source_invalid', 409);
  }
  const fixtureSourceAdId = clean(config.fixture_source_ad_id);
  if (sourceConfigTokenId) {
    if (!CONFIG_WRITER_TOKEN_ID_PATTERN.test(sourceConfigTokenId)) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_derive_canonical_source_invalid', 409);
    }
    return { sourceConfigTokenId, fixtureSourceAdId, provenance: 'canonical_config' };
  }
  try {
    return {
      sourceAdsetId: normalizeNumericId(sourceAdsetId, 'bootstrap_derive_source_adset_id'),
      fixtureSourceAdId,
      provenance: 'canonical_config',
    };
  } catch {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_canonical_source_invalid', 409);
  }
}

function derivePipelineBootstrapSourceSelectors({ targetRow, targetAuth, targetConfig, configuredRows }) {
  let targetCampaignId = '';
  try {
    targetCampaignId = normalizeNumericId(targetConfig.campaign_id, 'bootstrap_derive_target_campaign_id');
  } catch {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_target_invalid', 409);
  }
  const selectors = [];
  for (const row of configuredRows) {
    if (clean(row.id) === clean(targetRow.id)) continue;
    const config = asObject(parseObject(row.metadata_json).meta_ads_publish);
    try {
      if (
        normalizeNumericId(config.account_id, 'bootstrap_derive_source_account_id') !== targetAuth.accountId ||
        normalizeNumericId(config.campaign_id, 'bootstrap_derive_source_campaign_id') !== targetCampaignId
      ) {
        continue;
      }
      selectors.push({
        sourceAdsetId: normalizeNumericId(config.adset_id, 'bootstrap_derive_source_adset_id'),
        provenance: 'pipeline_source',
      });
    } catch {
      // A malformed or unrelated legacy destination is never evidence for a
      // source selector. The bounded Graph compatibility test below still
      // decides whether every remaining candidate is authorized.
    }
  }
  return uniqueDerivedBootstrapSelectors(selectors);
}

function uniqueDerivedBootstrapSelectors(selectors) {
  const byAdset = new Map();
  for (const selector of safeArray(selectors)) {
    const key = clean(selector?.sourceAdsetId);
    if (!key || byAdset.has(key)) continue;
    byAdset.set(key, selector);
  }
  return [...byAdset.values()].sort((left, right) => clean(left.sourceAdsetId).localeCompare(clean(right.sourceAdsetId)));
}

async function selectSingleDerivedBootstrapSource({
  selectors,
  targetAuth,
  targetAdset,
  targetConfig,
  context,
  staging,
  targetCanonicalUrlTags,
}) {
  const resolved = [];
  for (const selector of uniqueDerivedBootstrapSelectors(selectors)) {
    const candidate = await tryResolveDerivedBootstrapSource({
      selector,
      targetAuth,
      targetAdset,
      targetConfig,
      context,
      staging,
    });
    if (candidate) resolved.push(candidate);
  }
  if (resolved.length > 1) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_source_ambiguous', 409);
  }
  if (!resolved[0]) return null;
  return tryFinalizeDerivedBootstrapSource({ resolved: resolved[0], targetCanonicalUrlTags, context });
}

async function tryResolveDerivedBootstrapSource({
  selector,
  targetAuth,
  targetAdset,
  targetConfig,
  context,
  staging,
}) {
  try {
    const sourceAuth = await resolveLegacyBootstrapSourceAuth({
      sourceConfigTokenId: clean(selector.sourceConfigTokenId),
      sourceAdsetId: clean(selector.sourceAdsetId),
    }, targetAuth, context);
    const sourceAdset = await readAdsetConversionState(targetAuth, sourceAuth.config.adset_id, context);
    const profile = buildBootstrapTrackingProfile({
      sourceAuth,
      sourceAdset,
      targetAuth,
      targetAdset,
      targetConfig,
      stagingSyntheticFixture: staging,
    });
    return { selector, sourceAuth, sourceAdset, profile };
  } catch (error) {
    return derivedBootstrapCandidateOrNull(error);
  }
}

async function tryFinalizeDerivedBootstrapSource({ resolved, targetCanonicalUrlTags, context }) {
  try {
    const sourceCanonicalUrlTags = resolveDerivedCanonicalUrlTags([resolved.sourceAuth.config]);
    if (targetCanonicalUrlTags && sourceCanonicalUrlTags && targetCanonicalUrlTags !== sourceCanonicalUrlTags) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_derive_source_url_tags_incompatible', 409);
    }
    const canonicalUrlTags = targetCanonicalUrlTags || sourceCanonicalUrlTags;
    const fixture = await deriveBootstrapFixtureSource({
      source: resolved,
      canonicalUrlTags,
      context,
    });
    return { ...resolved, fixture };
  } catch (error) {
    return derivedBootstrapCandidateOrNull(error);
  }
}

function derivedBootstrapCandidateOrNull(error) {
  if (isBootstrapFailure(error)) {
    if (Number(error?.http_status) === 409) return null;
    throw error;
  }
  const normalized = normalizeFailure(error);
  if (Number(normalized.http_status) === 409 && normalized.classification === 'permanent') {
    return null;
  }
  throw bootstrapFailure('meta_ads_publish_bootstrap_derive_unavailable', 503);
}

function resolveDerivedCanonicalUrlTags(configs) {
  const values = new Set();
  for (const configValue of safeArray(configs)) {
    const config = asObject(configValue);
    const tracking = asObject(config.tracking_contract);
    for (const value of [config.url_tags, tracking.url_tags]) {
      if (String(value ?? '') === '') continue;
      try {
        values.add(normalizeUrlTags(value, { required: true }));
      } catch {
        throw bootstrapFailure('meta_ads_publish_bootstrap_derive_canonical_url_tags_invalid', 409);
      }
    }
  }
  if (values.size > 1) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_canonical_url_tags_ambiguous', 409);
  }
  return values.size === 1 ? [...values][0] : '';
}

async function deriveBootstrapFixtureSource({ source, canonicalUrlTags, context }) {
  const sourceAdsetId = source.sourceAuth.config.adset_id;
  let ad;
  const requestedId = clean(source.selector.fixtureSourceAdId);
  if (requestedId) {
    try {
      ad = await readBootstrapAd(source.sourceAuth, requestedId, context);
      assertBootstrapFixtureSourceAd(ad, sourceAdsetId);
    } catch (error) {
      const candidate = derivedBootstrapCandidateOrNull(error);
      if (candidate === null) throw bootstrapFailure('meta_ads_publish_bootstrap_derive_fixture_source_invalid', 409);
      throw bootstrapFailure('meta_ads_publish_bootstrap_derive_unavailable', 503);
    }
  } else {
    const candidates = (await listBootstrapAdsetAds(source.sourceAuth, sourceAdsetId, context))
      .filter((entry) => isBootstrapFixtureSourceCandidate(entry, sourceAdsetId));
    if (candidates.length !== 1) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_derive_fixture_source_ambiguous', 409);
    }
    ad = candidates[0];
  }
  let urlTags = canonicalUrlTags;
  if (!urlTags) {
    try {
      urlTags = normalizeUrlTags(asObject(ad.creative).url_tags, { required: true });
    } catch {
      throw bootstrapFailure('meta_ads_publish_bootstrap_derive_url_tags_unavailable', 409);
    }
  }
  return {
    adId: normalizeNumericId(ad.id, 'bootstrap_derive_fixture_source_ad_id'),
    urlTags,
  };
}

function deriveWebsiteBootstrapGraphFact({ targetAuth, targetAdset, source, entry }) {
  const profile = asObject(source.profile);
  const projected = projectAuthorizedTrackingPromotedObject(
    source.sourceAdset,
    targetAdset,
    profile,
  );
  return {
    config_token_id: targetAuth.tokenId,
    destination_type: 'website',
    source_adset_id: clean(source.sourceAuth.config.adset_id),
    fixture_source_ad_id: clean(source.fixture.adId),
    url_tags: clean(entry.url_tags),
    profile: {
      source_adset_id: clean(profile.source_adset_id),
      destination_kind: clean(profile.destination_kind),
      website_event_requirement: clean(profile.website_event_requirement),
      offline_event_dataset_requirement: clean(profile.offline_event_dataset_requirement),
      staging_synthetic_fixture: profile.staging_synthetic_fixture === true,
      authorized_destination_adset_ids: safeArray(profile.authorized_destination_adset_ids),
    },
    source_adset: deriveAdsetGraphContractFact(source.sourceAdset),
    target_adset: deriveAdsetGraphContractFact(targetAdset),
    desired_tracking_promoted_object: asObject(projected.tracking_promoted_object),
  };
}

function deriveWhatsAppBootstrapGraphFact({ targetAuth, targetAdset, whatsappDestinationUrl }) {
  return {
    config_token_id: targetAuth.tokenId,
    destination_type: 'whatsapp',
    target_adset: deriveAdsetGraphContractFact(targetAdset),
    whatsapp_destination_url: clean(whatsappDestinationUrl),
  };
}

function deriveAdsetGraphContractFact(value) {
  const adset = asObject(value);
  try {
    const promotedObject = asObject(adset.promoted_object);
    const trackingPromotedObject = {};
    for (const key of TRACKING_PROMOTED_OBJECT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(promotedObject, key)) {
        trackingPromotedObject[key] = clean(promotedObject[key]);
      }
    }
    return {
      account_id: normalizeNumericId(adset.account_id, 'bootstrap_derive_adset_account_id'),
      campaign_objective: safeTrackingEnum(asObject(adset.campaign).objective),
      optimization_goal: safeTrackingEnum(adset.optimization_goal),
      destination_type: safeTrackingEnum(adset.destination_type),
      billing_event: safeTrackingEnum(adset.billing_event),
      attribution_spec: safeArray(adset.attribution_spec),
      tracking_promoted_object: trackingPromotedObject,
    };
  } catch {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_graph_contract_invalid', 409);
  }
}

function summarizeBootstrapDeriveEntries(entries) {
  const websites = safeArray(entries).filter((entry) => clean(entry.destination_type) === 'website');
  const whatsapp = safeArray(entries).filter((entry) => clean(entry.destination_type) === 'whatsapp');
  return {
    destination_count: websites.length + whatsapp.length,
    website_destination_count: websites.length,
    whatsapp_destination_count: whatsapp.length,
    staging_fixture_count: websites.filter((entry) => entry.staging_synthetic_fixture === true).length,
  };
}

function bootstrapDerivePlanResponse(plan, requestId) {
  return response({
    ok: true,
    config_authority_revision: plan.authority.revision,
    manifest_sha256: plan.manifestSha256,
    summary: plan.summary,
    requestId,
  });
}

// The legacy configuration predates the v20 tracking contract, so it cannot
// create a normal creative in order to obtain the mandatory paused URL-tags
// fixture.  This narrowly-scoped saga is the only bootstrap escape hatch. It
// resolves every identifier and credential inside the Vault, journals all
// Graph-side state encrypted, and commits the v20 configuration with the same
// CAS core used by the administrative writer.
export async function bootstrapMetaAdsPublishConfig({ request, env, requestId, decryptToken, encryptToken, writeAudit }) {
  let input;
  let operation;
  let state;
  let context;
  let lockOwner = '';
  let lockAcquired = false;
  try {
    input = await validateBootstrapInput(await readBootstrapRequest(request));
    if (!env?.TOKEN_VAULT_DB || typeof env.TOKEN_VAULT_DB.batch !== 'function') {
      throw bootstrapFailure('meta_ads_publish_bootstrap_unavailable', 503);
    }
    if (input.entries.some((entry) => entry.stagingSyntheticFixture === true) && clean(env.ENVIRONMENT).toLowerCase() !== 'staging') {
      throw bootstrapFailure('meta_ads_publish_bootstrap_staging_fixture_forbidden', 409);
    }

    lockOwner = crypto.randomUUID();
    await acquireConfigWriterLock(env, lockOwner, {
      ttlMs: BOOTSTRAP_LOCK_TTL_MS,
    });
    lockAcquired = true;

    const currentRows = await listMetaAdsPublishConfigRows(env);
    assertBootstrapTargetsComplete(input.entries, currentRows);
    const authority = await configWriterAuthorityState(currentRows);
    operation = await loadBootstrapOperation(env, input.operationKey);
    if (operation) {
      if (clean(operation.request_hash) !== input.requestHash) {
        throw bootstrapFailure('meta_ads_publish_bootstrap_operation_conflict', 409);
      }
      state = await decryptBootstrapState(operation, decryptToken, env);
      if (clean(operation.status) === 'applied') {
        if (!authority.ready || clean(operation.resulting_tracking_binding_revision) !== authority.revision) {
          throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
        }
        return bootstrapSuccessResponse({ input, state, revision: authority.revision, requestId, replayed: true });
      }
      if (['rolled_back', 'reconciliation_required'].includes(clean(operation.status))) {
        throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
      }
    } else {
      if (authority.mode !== 'legacy_bootstrap' || authority.ready) {
        throw bootstrapFailure('meta_ads_publish_bootstrap_not_legacy', 409);
      }
      if (authority.revision !== input.expectedConfigAuthorityRevision) {
        throw bootstrapFailure('meta_ads_publish_bootstrap_binding_stale', 409);
      }
      state = {
        schema: 'meta_ads_publish_bootstrap/v1',
        input: {
          operation_key: input.operationKey,
          expected_config_authority_revision: input.expectedConfigAuthorityRevision,
          ...(input.derivedPlanSha256 ? { derived_plan_sha256: input.derivedPlanSha256 } : {}),
          entries: input.entries,
        },
        items: [],
        config_input: null,
        config_applied: false,
      };
      operation = await createBootstrapOperation({ env, input, state, encryptToken });
    }

    context = {
      env,
      requestId,
      operationKey: input.operationKey,
      ...bootstrapMutationLockIdentity(input.operationKey),
      bootstrapMutationLockKeys: [],
      bootstrapMutationLocksHeld: false,
      action: 'bootstrap_meta_ads_publish_config',
      decryptToken,
      encryptToken,
      attempts: 0,
      rateUsage: {},
      traceId: '',
      assertBootstrapLease: async () => {
        try {
          await renewConfigWriterLock(env, lockOwner, { ttlMs: BOOTSTRAP_LOCK_TTL_MS });
          await renewBootstrapMutationLocks(context);
        } catch (error) {
          const locked = isConfigWriterFailure(error) || clean(error?.message).startsWith('resource_locked:');
          throw bootstrapFailure(
            locked
              ? 'meta_ads_publish_bootstrap_locked'
              : 'meta_ads_publish_bootstrap_unavailable',
            locked ? 409 : Number(error?.http_status) || 503,
          );
        }
      },
    };
    try {
      context.bootstrapMutationLockKeys = bootstrapMutationLockKeysForInput(input.entries, currentRows);
      await acquireLocks(
        env,
        context.bootstrapMutationRunId,
        context.bootstrapMutationOperationKey,
        context.bootstrapMutationLockKeys,
      );
      context.bootstrapMutationLocksHeld = true;
    } catch (error) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_locked', 409);
    }
    const result = await executeBootstrapSaga({
      input,
      state,
      operation,
      currentRows,
      authority,
      context,
      requestId,
    });
    // The durable D1 commit is the source of truth. Audit delivery is useful
    // but must never turn a committed v20 authority into a false failed
    // bootstrap that a deploy may try to compensate.
    await writeBootstrapAudit(writeAudit, env, requestId, 'ok', result.state).catch(() => undefined);
    return bootstrapSuccessResponse({
      input,
      state: result.state,
      revision: result.revision,
      requestId,
      replayed: result.replayed,
    }, result.status);
  } catch (error) {
    const configCommitted = state && !state.config_applied
      ? await bootstrapConfigWasCommitted(env, state).catch(() => false)
      : Boolean(state?.config_applied);
    if (state && configCommitted) {
      state.config_applied = true;
      const authority = await configWriterAuthorityState(await listMetaAdsPublishConfigRows(env)).catch(() => null);
      if (authority?.ready) {
        try {
          await persistBootstrapState({
            env,
            operation,
            state,
            status: 'applied',
            resultingRevision: authority.revision,
            encryptToken,
            context,
          });
        } catch {
          // A Graph/D1 bootstrap is only externally compensable if its journal
          // durably records the candidate revision and encrypted baseline.
          // Do not report success when that evidence cannot be persisted.
          error = bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
          await writeBootstrapAudit(writeAudit, env, requestId, 'failed', state).catch(() => undefined);
          return bootstrapFailureResponse(error, requestId);
        }
        await writeBootstrapAudit(writeAudit, env, requestId, 'ok', state).catch(() => undefined);
        return bootstrapSuccessResponse({
          input: input || { operationKey: clean(operation?.operation_key) },
          state,
          revision: authority.revision,
          requestId,
          replayed: false,
        });
      }
    }
    if (operation && state && !configCommitted) {
      const cleanupContext = context || {
        env,
        requestId,
        operationKey: input?.operationKey || clean(operation.operation_key),
        ...bootstrapMutationLockIdentity(input?.operationKey || clean(operation.operation_key)),
        bootstrapMutationLockKeys: [],
        bootstrapMutationLocksHeld: false,
        action: 'bootstrap_meta_ads_publish_config_cleanup',
        decryptToken,
        encryptToken,
        attempts: 0,
        rateUsage: {},
        traceId: '',
        assertBootstrapLease: async () => undefined,
      };
      if (cleanupContext.bootstrapMutationLocksHeld === true) {
        const compensated = await compensateBootstrapState({ state, context: cleanupContext }).catch(() => false);
        const terminalStatus = compensated ? 'rolled_back' : 'reconciliation_required';
        await persistBootstrapState({ env, operation, state, status: terminalStatus, encryptToken, context: cleanupContext }).catch(() => undefined);
        if (!compensated) error = bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
      } else if (bootstrapStateMayHaveGraphMutation(state)) {
        // We failed to establish the shared ad-set lease. Do not attempt a
        // best-effort Graph cleanup that could overwrite an active v20 run.
        await persistBootstrapState({ env, operation, state, status: 'reconciliation_required', encryptToken, context: cleanupContext }).catch(() => undefined);
        error = bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
      }
    }
    await writeBootstrapAudit(writeAudit, env, requestId, 'failed', state).catch(() => undefined);
    return bootstrapFailureResponse(error, requestId);
  } finally {
    if (context?.bootstrapMutationLocksHeld === true) {
      await releaseOperationLocks(
        env,
        context.bootstrapMutationRunId,
        context.bootstrapMutationOperationKey,
      ).catch(() => undefined);
    }
    if (lockAcquired) {
      await releaseConfigWriterLock(env, lockOwner);
    }
  }
}

// A deployment can cross several independently recoverable surfaces after a
// bootstrap has committed.  This endpoint is intentionally narrower than the
// normal configuration writer: it can only undo the exact encrypted baseline
// captured by its own applied bootstrap operation, and only while the current
// authority is still that operation's resulting v20 revision.
export async function rollbackBootstrapMetaAdsPublishConfig({ request, env, requestId, decryptToken, encryptToken, writeAudit }) {
  let input;
  let operation;
  let state;
  let lockOwner = '';
  let lockAcquired = false;
  let context;
  try {
    input = validateBootstrapRollbackInput(await readBootstrapRollbackRequest(request));
    if (!env?.TOKEN_VAULT_DB || typeof env.TOKEN_VAULT_DB.batch !== 'function') {
      throw bootstrapFailure('meta_ads_publish_bootstrap_unavailable', 503);
    }
    lockOwner = crypto.randomUUID();
    await acquireConfigWriterLock(env, lockOwner, { ttlMs: BOOTSTRAP_LOCK_TTL_MS });
    lockAcquired = true;
    context = {
      env,
      requestId,
      operationKey: input.operationKey,
      ...bootstrapMutationLockIdentity(input.operationKey),
      bootstrapMutationLockKeys: [],
      bootstrapMutationLocksHeld: false,
      action: 'rollback_meta_ads_publish_bootstrap',
      decryptToken,
      encryptToken,
      attempts: 0,
      rateUsage: {},
      traceId: '',
      assertBootstrapLease: async () => {
        try {
          await renewConfigWriterLock(env, lockOwner, { ttlMs: BOOTSTRAP_LOCK_TTL_MS });
          await renewBootstrapMutationLocks(context);
        } catch (error) {
          const locked = isConfigWriterFailure(error) || clean(error?.message).startsWith('resource_locked:');
          throw bootstrapFailure(
            locked
              ? 'meta_ads_publish_bootstrap_locked'
              : 'meta_ads_publish_bootstrap_unavailable',
            locked ? 409 : Number(error?.http_status) || 503,
          );
        }
      },
    };
    operation = await loadBootstrapOperation(env, input.operationKey);
    if (!operation) throw bootstrapFailure('meta_ads_publish_bootstrap_operation_not_found', 404);
    if (clean(operation.resulting_tracking_binding_revision) !== input.expectedTrackingBindingRevision) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
    }
    state = await decryptBootstrapState(operation, decryptToken, env);
    const currentRows = await listMetaAdsPublishConfigRows(env);
    const currentAuthority = await configWriterAuthorityState(currentRows);
    if (clean(operation.status) === 'rolled_back') {
      if (currentAuthority.ready || currentAuthority.revision !== clean(state.input?.expected_config_authority_revision)) {
        throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
      }
      return bootstrapRollbackSuccessResponse({ state, revision: currentAuthority.revision, requestId, replayed: true });
    }
    if (clean(operation.status) !== 'applied' || !state.config_applied) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
    }
    if (!currentAuthority.ready || currentAuthority.revision !== input.expectedTrackingBindingRevision) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
    }
    try {
      context.bootstrapMutationLockKeys = bootstrapMutationLockKeysForState(state, currentRows);
      await acquireLocks(
        env,
        context.bootstrapMutationRunId,
        context.bootstrapMutationOperationKey,
        context.bootstrapMutationLockKeys,
      );
      context.bootstrapMutationLocksHeld = true;
    } catch {
      throw bootstrapFailure('meta_ads_publish_bootstrap_locked', 409);
    }

    // Do not restore legacy metadata until Graph has been returned to the
    // encrypted baseline.  On a failed Graph compensation we retain v20 and
    // fail closed rather than reactivating a v18 publisher against unknown
    // tracking state.
    const graphCompensated = await compensateBootstrapState({ state, context });
    if (!graphCompensated) {
      await persistBootstrapState({
        env,
        operation,
        state,
        status: 'reconciliation_required',
        encryptToken,
        context,
      });
      throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
    }

    const restored = await restoreBootstrapConfigAuthority({
      env,
      operation,
      state,
      expectedTrackingBindingRevision: input.expectedTrackingBindingRevision,
      encryptToken,
      context,
    });
    await writeBootstrapAudit(writeAudit, env, requestId, 'rolled_back', state).catch(() => undefined);
    return bootstrapRollbackSuccessResponse({ state, revision: restored.revision, requestId, replayed: false });
  } catch (error) {
    await writeBootstrapAudit(writeAudit, env, requestId, 'rollback_failed', state).catch(() => undefined);
    return bootstrapFailureResponse(error, requestId);
  } finally {
    if (context?.bootstrapMutationLocksHeld === true) {
      await releaseOperationLocks(
        env,
        context.bootstrapMutationRunId,
        context.bootstrapMutationOperationKey,
      ).catch(() => undefined);
    }
    if (lockAcquired) await releaseConfigWriterLock(env, lockOwner);
  }
}

async function readBootstrapRollbackRequest(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 8 * 1024) throw bootstrapFailure('meta_ads_publish_bootstrap_request_too_large', 413);
  try {
    const body = await request.json();
    if (!isJsonObject(body)) throw bootstrapFailure('meta_ads_publish_bootstrap_request_invalid', 400);
    return body;
  } catch (error) {
    if (isBootstrapFailure(error)) throw error;
    throw bootstrapFailure('meta_ads_publish_bootstrap_request_invalid', 400);
  }
}

function validateBootstrapRollbackInput(body) {
  assertBootstrapExactKeys(body, new Set(['operation_key', 'expected_tracking_binding_revision']));
  const operationKey = clean(body.operation_key);
  const expectedTrackingBindingRevision = clean(body.expected_tracking_binding_revision).toLowerCase();
  if (!BOOTSTRAP_OPERATION_KEY_PATTERN.test(operationKey)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_operation_key_invalid', 400);
  }
  if (!/^[a-f0-9]{64}$/.test(expectedTrackingBindingRevision)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_expected_revision_invalid', 400);
  }
  return { operationKey, expectedTrackingBindingRevision };
}

async function restoreBootstrapConfigAuthority({ env, operation, state, expectedTrackingBindingRevision, encryptToken, context }) {
  await assertBootstrapLease(context);
  const configInput = asObject(state.config_input);
  const updates = safeArray(configInput.updates);
  const priorConfigs = asObject(state.previous_meta_ads_publish);
  if (!updates.length || !Object.keys(priorConfigs).length) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
  }
  const currentRows = await listMetaAdsPublishConfigRows(env);
  const plans = updates.map((update) => {
    const tokenId = clean(update.tokenId);
    const target = currentRows.find((row) => clean(row.id) === tokenId);
    const expectedV20 = asObject(update.metaAdsPublish);
    const previous = asObject(priorConfigs[tokenId]);
    if (
      !target || Number(target.active) !== 1 || !Object.keys(expectedV20).length || !Object.keys(previous).length
    ) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
    }
    const currentMetadata = parseConfigWriterMetadata(target.metadata_json);
    if (stableStringify(asObject(currentMetadata.meta_ads_publish)) !== stableStringify(expectedV20)) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
    }
    return {
      tokenId,
      target,
      nextMetadataJson: JSON.stringify({ ...currentMetadata, meta_ads_publish: previous }),
    };
  });
  const previousAuthorityRevision = clean(state.input?.expected_config_authority_revision);
  if (!/^legacy:[a-f0-9]{64}$/.test(previousAuthorityRevision)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
  }
  state.config_applied = false;
  state.config_rolled_back = true;
  const stateCiphertext = await encryptBootstrapState(state, encryptToken, env);
  const now = nowIso();
  await assertBootstrapLease(context);
  const results = await env.TOKEN_VAULT_DB.batch([
    buildBootstrapAtomicMetadataRestore(env, { plans, now }),
    buildBootstrapRolledBackOperationUpdate(env, {
      plans,
      now,
      operation,
      expectedTrackingBindingRevision,
      stateCiphertext,
      summaryJson: JSON.stringify(summarizeBootstrapState(state)),
    }),
  ]);
  if (batchChanges(results, 0) !== plans.length || batchChanges(results, 1) !== 1) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
  }
  const authority = await configWriterAuthorityState(await listMetaAdsPublishConfigRows(env));
  if (authority.ready || authority.revision !== previousAuthorityRevision) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
  }
  operation.status = 'rolled_back';
  return { revision: authority.revision };
}

function buildBootstrapAtomicMetadataRestore(env, { plans, now }) {
  const caseClauses = plans.map(() => 'WHEN ? THEN ?').join(' ');
  const targetPlaceholders = plans.map(() => '?').join(', ');
  const oldConditions = plans.map(() => '(id = ? AND metadata_json = ?)').join(' OR ');
  return env.TOKEN_VAULT_DB.prepare([
    'UPDATE credential_tokens',
    `SET metadata_json = CASE id ${caseClauses} ELSE metadata_json END, updated_at = ?`,
    `WHERE id IN (${targetPlaceholders}) AND provider = 'facebook' AND active = 1`,
    'AND (SELECT COUNT(*) FROM credential_tokens',
    `WHERE provider = 'facebook' AND active = 1 AND (${oldConditions})) = ?`,
  ].join(' ')).bind(
    ...plans.flatMap((plan) => [plan.tokenId, plan.nextMetadataJson]),
    now,
    ...plans.map((plan) => plan.tokenId),
    ...plans.flatMap((plan) => [plan.tokenId, plan.target.metadata_json]),
    plans.length,
  );
}

function buildBootstrapRolledBackOperationUpdate(env, {
  plans,
  now,
  operation,
  expectedTrackingBindingRevision,
  stateCiphertext,
  summaryJson,
}) {
  const newConditions = plans.map(() => '(id = ? AND metadata_json = ?)').join(' OR ');
  return env.TOKEN_VAULT_DB.prepare([
    "UPDATE meta_ads_publish_bootstrap_operations SET status = 'rolled_back', state_ciphertext = ?, summary_json = ?, updated_at = ?",
    "WHERE id = ? AND operation_key = ? AND request_hash = ? AND status = 'applied'",
    'AND resulting_tracking_binding_revision = ?',
    'AND (SELECT COUNT(*) FROM credential_tokens',
    `WHERE provider = 'facebook' AND active = 1 AND (${newConditions})) = ?`,
  ].join(' ')).bind(
    stateCiphertext,
    summaryJson,
    now,
    clean(operation.id),
    clean(operation.operation_key),
    clean(operation.request_hash),
    expectedTrackingBindingRevision,
    ...plans.flatMap((plan) => [plan.tokenId, plan.nextMetadataJson]),
    plans.length,
  );
}

function bootstrapRollbackSuccessResponse({ state, revision, requestId, replayed }) {
  const summary = summarizeBootstrapState(state);
  return response({
    ok: true,
    rolled_back: true,
    replayed: Boolean(replayed),
    operation_status: 'rolled_back',
    config_authority_revision: revision,
    website_fixture_count: summary.website_fixture_count,
    requestId,
  });
}

// The staging deployment proves a deliberately isolated source/target pair can
// reconcile the authorized conversion contract and restore the exact prior
// state.  It is not a generic Meta operation: selectors stay in the private
// configuration, the endpoint only accepts a bounded idempotency key, and it
// is disabled outside the staging Worker.
export async function exerciseStagingMetaAdsTrackingFixture({ request, env, requestId, decryptToken, encryptToken, writeAudit }) {
  let input;
  let fixture;
  let context;
  let snapshotId = '';
  let runId = '';
  let transactionOperationKey = '';
  let transactionLockHeld = false;
  let configLockOwner = '';
  let configLockHeld = false;
  let bindingRevision = '';
  try {
    input = await validateStagingExerciseInput(await readStagingExerciseRequest(request));
    if (clean(env?.ENVIRONMENT).toLowerCase() !== 'staging') {
      throw stagingExerciseFailure('staging_tracking_fixture_exercise_disabled', 503);
    }
    if (!env?.TOKEN_VAULT_DB || typeof env.TOKEN_VAULT_DB.prepare !== 'function') {
      throw stagingExerciseFailure('staging_tracking_fixture_exercise_unavailable', 503);
    }

    configLockOwner = crypto.randomUUID();
    try {
      await acquireConfigWriterLock(env, configLockOwner, { ttlMs: BOOTSTRAP_LOCK_TTL_MS });
      configLockHeld = true;
    } catch (error) {
      throw stagingExerciseFailure(
        isConfigWriterFailure(error)
          ? 'staging_tracking_fixture_config_locked'
          : 'staging_tracking_fixture_exercise_unavailable',
        Number(error?.http_status) || 503,
      );
    }

    const rows = await listMetaAdsPublishConfigRows(env);
    const authority = await configWriterAuthorityState(rows);
    const binding = await deriveTrackingBindingState(rows);
    if (!authority.ready || !binding.ready) {
      throw stagingExerciseFailure('staging_tracking_fixture_config_not_ready', 409);
    }
    bindingRevision = binding.revision;
    fixture = resolveStagingTrackingFixture(rows);
    runId = await ensureStagingExerciseRun({ env, input, bindingRevision: binding.revision });
    context = {
      env,
      runId,
      operationKey: '',
      action: 'staging_tracking_fixture_exercise',
      decryptToken,
      encryptToken,
      attempts: 0,
      rateUsage: {},
      traceId: '',
      stagingExerciseLockOperationKey: '',
      stagingExerciseLockKeys: [],
      assertBootstrapLease: async () => {
        try {
          await renewConfigWriterLock(env, configLockOwner, { ttlMs: BOOTSTRAP_LOCK_TTL_MS });
          if (transactionLockHeld) {
            await acquireLocks(
              env,
              runId,
              transactionOperationKey,
              context.stagingExerciseLockKeys,
            );
          }
        } catch (error) {
          const locked = isConfigWriterFailure(error) || clean(error?.message).startsWith('resource_locked:');
          throw stagingExerciseFailure(
            locked
              ? 'staging_tracking_fixture_config_locked'
              : 'staging_tracking_fixture_exercise_unavailable',
            locked ? 409 : Number(error?.http_status) || 503,
          );
        }
      },
    };

    // Keep the exact ad-set resource locked for the complete synthetic
    // exercise. Releasing it between ensure and rollback would let a normal
    // publication attest the temporary promoted_object and then have that
    // state restored underneath its subsequent ad mutation.
    transactionOperationKey = stagingExerciseOperationKey(input.operationKey, 'transaction');
    context.stagingExerciseLockOperationKey = transactionOperationKey;
    context.stagingExerciseLockKeys = [stagingExerciseAdsetLockKey(fixture)];
    await acquireLocks(env, runId, transactionOperationKey, context.stagingExerciseLockKeys);
    transactionLockHeld = true;

    const creativeReadback = await readAuthorizedCreativeUrlTagsContract({
      action: 'read_authorized_creative_url_tags_contract',
      operation_key: stagingExerciseOperationKey(input.operationKey, 'creative-readback'),
      token_id: fixture.tokenId,
      account_id: fixture.accountId,
      api_version: fixture.apiVersion,
    }, {
      ...context,
      operationKey: stagingExerciseOperationKey(input.operationKey, 'creative-readback'),
      action: 'read_authorized_creative_url_tags_contract',
    });
    assertStagingExerciseCreativeReadback(creativeReadback);

    const ensureOperationKey = stagingExerciseOperationKey(input.operationKey, 'ensure');
    const existingSnapshot = await loadTrackingSnapshotByOperation(env, ensureOperationKey);
    if (existingSnapshot && clean(existingSnapshot.status) === 'restored') {
      await completeStagingExerciseRun(env, runId, input.operationKey, true);
      await writeStagingExerciseAudit(writeAudit, env, requestId, 'replayed');
      return stagingExerciseSuccessResponse(requestId, true);
    }
    if (existingSnapshot) {
      // A previous transport failure can leave a captured/reconciled snapshot.
      // Restore it before refusing the replay so the next deployment attempt
      // begins from the documented synthetic baseline rather than stale Graph
      // state.  It never retries a potentially ambiguous Graph mutation.
      snapshotId = clean(existingSnapshot.id);
      const recovered = await rollbackStagingExerciseSnapshot({
        fixture,
        snapshotId,
        context,
        operationKey: stagingExerciseOperationKey(input.operationKey, 'rollback-recovery'),
        lockOperationKey: transactionOperationKey,
        releaseLocks: false,
      });
      if (!['restored', 'already_restored', 'not_applied'].includes(clean(recovered.status))) {
        throw stagingExerciseFailure('staging_tracking_fixture_rollback_unconfirmed', 502);
      }
      await setRunState(env, runId, 'rolled_back', stagingExerciseRunSummary(input.operationKey, 'recovered'));
      await writeStagingExerciseAudit(writeAudit, env, requestId, 'rolled_back');
      return stagingExerciseFailureResponse(
        stagingExerciseFailure('staging_tracking_fixture_retry_requires_new_operation', 409),
        requestId,
      );
    }

    const ensureContext = {
      ...context,
      operationKey: ensureOperationKey,
      action: 'ensure_adset_conversion_contract',
    };
    const ensured = await ensureAdsetConversionContract(stagingExerciseEnsureBody(fixture), ensureContext);
    snapshotId = clean(ensured?.snapshot_id);
    if (
      ensured?.status !== 'reconciled' ||
      ensured?.graph_mutation !== 'promoted_object_updated' ||
      !snapshotId ||
      ensured?.website_event?.configured !== true ||
      ensured?.website_event?.required !== true ||
      ensured?.offline_event_dataset?.configured !== true ||
      ensured?.offline_event_dataset?.required !== true
    ) {
      throw stagingExerciseFailure('staging_tracking_fixture_not_reconciled', 409);
    }

    const rolledBack = await rollbackStagingExerciseSnapshot({
      fixture,
      snapshotId,
      context,
      operationKey: stagingExerciseOperationKey(input.operationKey, 'rollback'),
      lockOperationKey: transactionOperationKey,
      releaseLocks: false,
    });
    if (rolledBack.status !== 'restored' || rolledBack.graph_mutation !== 'promoted_object_restored') {
      throw stagingExerciseFailure('staging_tracking_fixture_rollback_unconfirmed', 502);
    }
    await assertStagingExerciseBinding(env, bindingRevision);
    await completeStagingExerciseRun(env, runId, input.operationKey, false);
    await writeStagingExerciseAudit(writeAudit, env, requestId, 'ok');
    return stagingExerciseSuccessResponse(requestId, false);
  } catch (error) {
    const compensationSnapshotId = snapshotId || stagingExerciseCompensationSnapshotId(error);
    let cleanupStatus = '';
    if (fixture && context && compensationSnapshotId) {
      try {
        const cleanup = await rollbackStagingExerciseSnapshot({
          fixture,
          snapshotId: compensationSnapshotId,
          context,
          operationKey: stagingExerciseOperationKey(input?.operationKey || 'staging-tracking-fixture:cleanup', 'rollback-cleanup'),
          lockOperationKey: transactionLockHeld
            ? transactionOperationKey
            : stagingExerciseOperationKey(input?.operationKey || 'staging-tracking-fixture:cleanup', 'rollback-cleanup'),
          releaseLocks: !transactionLockHeld,
        });
        cleanupStatus = clean(cleanup.status);
      } catch {
        cleanupStatus = 'reconciliation_required';
      }
    }
    if (runId) {
      const terminal = ['restored', 'already_restored', 'not_applied'].includes(cleanupStatus)
        ? 'rolled_back'
        : 'reconciliation_required';
      await setRunState(env, runId, terminal, stagingExerciseRunSummary(input?.operationKey || '', cleanupStatus || 'failed')).catch(() => undefined);
    }
    await writeStagingExerciseAudit(
      writeAudit,
      env,
      requestId,
      ['restored', 'already_restored', 'not_applied'].includes(cleanupStatus) ? 'rolled_back' : 'failed',
    ).catch(() => undefined);
    return stagingExerciseFailureResponse(error, requestId);
  } finally {
    if (transactionLockHeld && context && runId) {
      await releaseOperationLocks(env, runId, transactionOperationKey).catch(() => undefined);
    }
    if (configLockHeld) await releaseConfigWriterLock(env, configLockOwner);
  }
}

async function readStagingExerciseRequest(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 8 * 1024) throw stagingExerciseFailure('staging_tracking_fixture_request_too_large', 413);
  try {
    const body = await request.json();
    if (!isJsonObject(body) || Object.keys(body).length !== 1 || !Object.prototype.hasOwnProperty.call(body, 'operation_key')) {
      throw stagingExerciseFailure('staging_tracking_fixture_request_invalid', 400);
    }
    return body;
  } catch (error) {
    if (isStagingExerciseFailure(error)) throw error;
    throw stagingExerciseFailure('staging_tracking_fixture_request_invalid', 400);
  }
}

function validateStagingExerciseInput(body) {
  const operationKey = clean(body.operation_key);
  if (!STAGING_EXERCISE_OPERATION_KEY_PATTERN.test(operationKey)) {
    throw stagingExerciseFailure('staging_tracking_fixture_operation_key_invalid', 400);
  }
  return { operationKey };
}

function resolveStagingTrackingFixture(rows) {
  const candidates = [];
  for (const row of safeArray(rows)) {
    const config = asObject(parseObject(row.metadata_json).meta_ads_publish);
    if (!Object.keys(config).length) continue;
    const contract = normalizeTrackingContract(config.tracking_contract, config.tracking_profiles, config.adset_id);
    if (
      normalizeDestinationKind(config.destination_type) !== 'website' ||
      contract.destination_kind !== 'website' ||
      contract.staging_synthetic_fixture !== true ||
      contract.website_event_requirement !== 'required' ||
      contract.offline_event_dataset_requirement !== 'required'
    ) {
      continue;
    }
    const profile = asObject(asObject(config.tracking_profiles)[contract.profile_ref]);
    const sourceAdsetId = normalizeNumericId(profile.source_adset_id, 'staging_tracking_fixture_source_adset_id');
    const targetAdsetId = normalizeNumericId(config.adset_id, 'staging_tracking_fixture_target_adset_id');
    if (sourceAdsetId === targetAdsetId) continue;
    candidates.push({
      tokenId: clean(row.id),
      accountId: normalizeNumericId(config.account_id, 'staging_tracking_fixture_account_id'),
      apiVersion: normalizeApiVersion(config.api_version || 'v25.0'),
      adsetId: targetAdsetId,
      profileRef: contract.profile_ref,
    });
  }
  if (candidates.length !== 1) {
    throw stagingExerciseFailure('staging_tracking_fixture_not_unique', 409);
  }
  return candidates[0];
}

async function ensureStagingExerciseRun({ env, input, bindingRevision }) {
  const fingerprint = await sha256(`staging-tracking-fixture:${input.operationKey}`);
  const existing = await dbFirst(env,
    `SELECT id, config_revision FROM meta_ads_publish_runs WHERE batch_fingerprint = ?`,
    fingerprint,
  );
  if (existing) {
    if (clean(existing.config_revision) !== clean(bindingRevision)) {
      throw stagingExerciseFailure('staging_tracking_fixture_binding_stale', 409);
    }
    return clean(existing.id);
  }
  const runId = `stx_${fingerprint.slice(0, 24)}`;
  const now = nowIso();
  const result = await dbRun(env,
    `INSERT INTO meta_ads_publish_runs (
      id, batch_fingerprint, request_hash, workflow_execution_id, config_revision,
      status, files_json, summary_json, error_json, heartbeat_at, lock_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'processing', '[]', '{}', '{}', ?, ?, ?, ?)`,
    runId,
    fingerprint,
    fingerprint,
    `staging-tracking-fixture:${shortKey(input.operationKey)}`,
    bindingRevision,
    now,
    new Date(Date.now() + LOCK_TTL_MS).toISOString(),
    now,
    now,
  );
  if (statementChanges(result) !== 1) {
    throw stagingExerciseFailure('staging_tracking_fixture_run_unavailable', 503);
  }
  return runId;
}

function stagingExerciseOperationKey(operationKey, phase) {
  const normalized = clean(operationKey);
  const suffix = clean(phase).replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 32);
  return `${normalized}:${suffix}`.slice(0, 160);
}

function stagingExerciseAdsetLockKey(fixture) {
  return `adset-contract:${clean(fixture.accountId)}:${clean(fixture.adsetId)}`;
}

function stagingExerciseEnsureBody(fixture) {
  return {
    token_id: fixture.tokenId,
    account_id: fixture.accountId,
    api_version: fixture.apiVersion,
    object_id: fixture.adsetId,
    destination_kind: 'website',
    profile_ref: fixture.profileRef,
    workflow_contract_revision: WORKFLOW_CONTRACT_REVISION,
  };
}

async function assertStagingExerciseBinding(env, expectedRevision) {
  const rows = await listMetaAdsPublishConfigRows(env);
  const authority = await configWriterAuthorityState(rows);
  const binding = await deriveTrackingBindingState(rows);
  if (!authority.ready || !binding.ready || clean(binding.revision) !== clean(expectedRevision)) {
    throw stagingExerciseFailure('staging_tracking_fixture_binding_stale', 409);
  }
}

async function rollbackStagingExerciseSnapshot({
  fixture,
  snapshotId,
  context,
  operationKey,
  lockOperationKey = operationKey,
  releaseLocks = true,
}) {
  const normalizedSnapshotId = normalizeSnapshotId(snapshotId);
  const normalizedLockOperationKey = clean(lockOperationKey);
  const lockKeys = [
    stagingExerciseAdsetLockKey(fixture),
    `adset-contract-snapshot:${normalizedSnapshotId}`,
  ];
  const rollbackContext = {
    ...context,
    operationKey,
    action: 'rollback_adset_conversion_contract',
  };
  await acquireLocks(context.env, context.runId, normalizedLockOperationKey, lockKeys);
  if (clean(context.stagingExerciseLockOperationKey) === normalizedLockOperationKey) {
    context.stagingExerciseLockKeys = [...new Set([
      ...safeArray(context.stagingExerciseLockKeys),
      ...lockKeys,
    ])].sort();
  }
  try {
    return await rollbackAdsetConversionContract({
      token_id: fixture.tokenId,
      account_id: fixture.accountId,
      api_version: fixture.apiVersion,
      object_id: fixture.adsetId,
      snapshot_id: normalizedSnapshotId,
    }, rollbackContext);
  } finally {
    if (releaseLocks) await releaseOperationLocks(context.env, context.runId, normalizedLockOperationKey);
  }
}

function assertStagingExerciseCreativeReadback(result) {
  if (
    asObject(result).destination_kind !== 'website' ||
    asObject(result).creative_url_tags?.required !== true ||
    asObject(result).creative_url_tags?.paused_fixture_verified !== true ||
    asObject(result).creative_url_tags?.exact_match !== true
  ) {
    throw stagingExerciseFailure('staging_tracking_fixture_creative_readback_mismatch', 409);
  }
}

async function completeStagingExerciseRun(env, runId, operationKey, replayed) {
  await setRunState(env, runId, 'completed', stagingExerciseRunSummary(operationKey, replayed ? 'replayed' : 'reconciled_and_rolled_back'));
}

function stagingExerciseRunSummary(operationKey, status) {
  return {
    kind: 'staging_tracking_fixture',
    operation: shortKey(operationKey),
    status: clean(status),
    reconciliation: status === 'reconciled_and_rolled_back' ? 'reconciled' : '',
    rollback: status === 'reconciled_and_rolled_back' ? 'restored' : '',
    fixture_count: 1,
  };
}

async function writeStagingExerciseAudit(writeAudit, env, requestId, status) {
  if (typeof writeAudit !== 'function') return;
  await writeAudit(env, {
    event: 'meta_ads_publish.config.staging_tracking_fixture',
    status,
    requestId,
    metadata: {
      environment: 'staging',
      fixture_count: 1,
      reconciliation: status === 'ok' ? 'reconciled' : '',
      rollback: status === 'ok' ? 'restored' : '',
    },
  });
}

function stagingExerciseCompensationSnapshotId(error) {
  const normalized = normalizeFailure(error);
  const candidate = clean(asObject(normalized.compensation).snapshot_id);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : '';
}

function stagingExerciseSuccessResponse(requestId, replayed) {
  return response({
    ok: true,
    replayed: Boolean(replayed),
    exercise: {
      status: 'reconciled_and_rolled_back',
      reconciliation: 'reconciled',
      rollback: 'restored',
      fixture_count: 1,
    },
    requestId,
  });
}

function stagingExerciseFailure(code, httpStatus = 400) {
  return Object.assign(new Error(code), { staging_exercise_error: true, http_status: httpStatus });
}

function isStagingExerciseFailure(error) {
  return Boolean(error && error.staging_exercise_error === true);
}

function stagingExerciseFailureResponse(error, requestId) {
  const code = isStagingExerciseFailure(error)
    ? clean(error.message)
    : 'staging_tracking_fixture_exercise_failed';
  const status = Number(error?.http_status) === 409
    ? 409
    : Number(error?.http_status) === 404
      ? 404
    : Number(error?.http_status) === 503
      ? 503
      : Number(error?.http_status) === 413
        ? 413
        : 400;
  return response({ ok: false, error: code, requestId }, status);
}

async function executeBootstrapSaga({ input, state, operation, currentRows, authority, context, requestId }) {
  let configInput = state.config_input;
  if (!configInput) {
    if (authority.mode !== 'legacy_bootstrap' || authority.revision !== input.expectedConfigAuthorityRevision) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_binding_stale', 409);
    }
    if (!isJsonObject(state.previous_meta_ads_publish)) {
      state.previous_meta_ads_publish = captureBootstrapPreviousMetaAdsPublish(input.entries, currentRows);
      await persistBootstrapState({ env: context.env, operation, state, status: 'pending', encryptToken: context.encryptToken, context });
    }
    const updates = await buildBootstrapUpdates({ input, state, operation, currentRows, context });
    configInput = await validateConfigWriterInput({
      operation_key: bootstrapConfigOperationKey(input.operationKey),
      expected_tracking_binding_revision: input.expectedConfigAuthorityRevision,
      updates,
    });
    state.config_input = configInput;
    await persistBootstrapState({ env: context.env, operation, state, status: 'configuring', encryptToken: context.encryptToken, context });
  }

  const applied = await applyMetaAdsPublishConfigAtomically({
    input: configInput,
    env: context.env,
    requestId,
    lockAlreadyHeld: true,
    assertLease: context.assertBootstrapLease,
  });
  state.config_applied = true;
  state.resulting_tracking_binding_revision = applied.revision;
  await persistBootstrapState({
    env: context.env,
    operation,
    state,
    status: 'applied',
    resultingRevision: applied.revision,
    encryptToken: context.encryptToken,
    context,
  });
  return { state, revision: applied.revision, replayed: applied.replayed, status: applied.status };
}

function bootstrapMutationLockIdentity(operationKey) {
  const normalized = clean(operationKey);
  return {
    bootstrapMutationRunId: `bootstrap:${normalized}`,
    bootstrapMutationOperationKey: `bootstrap-mutation:${normalized}`,
  };
}

function bootstrapAdsetContractLockKey(accountId, adsetId) {
  return `adset-contract:${normalizeNumericId(accountId, 'bootstrap_lock_account_id')}:${normalizeNumericId(adsetId, 'bootstrap_lock_adset_id')}`;
}

function bootstrapMutationLockKeysForInput(entries, rows) {
  const rowsByTokenId = new Map(safeArray(rows).map((row) => [clean(row.id), row]));
  const keys = [];
  for (const entry of safeArray(entries)) {
    if (clean(entry.destinationType) !== 'website') continue;
    const targetConfig = asObject(parseObject(rowsByTokenId.get(clean(entry.configTokenId))?.metadata_json).meta_ads_publish);
    if (!Object.keys(targetConfig).length) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_legacy_config_invalid', 409);
    }
    keys.push(bootstrapAdsetContractLockKey(targetConfig.account_id, targetConfig.adset_id));
    if (clean(entry.sourceAdsetId)) {
      keys.push(bootstrapAdsetContractLockKey(targetConfig.account_id, entry.sourceAdsetId));
      continue;
    }
    const sourceConfig = asObject(parseObject(rowsByTokenId.get(clean(entry.sourceConfigTokenId))?.metadata_json).meta_ads_publish);
    if (!Object.keys(sourceConfig).length) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_legacy_config_invalid', 409);
    }
    keys.push(bootstrapAdsetContractLockKey(sourceConfig.account_id, sourceConfig.adset_id));
  }
  return [...new Set(keys)].sort();
}

function bootstrapMutationLockKeysForState(state, rows) {
  const rowsByTokenId = new Map(safeArray(rows).map((row) => [clean(row.id), row]));
  const keys = [];
  for (const item of safeArray(state?.items)) {
    if (clean(item.destination_type) !== 'website') continue;
    const targetConfig = asObject(parseObject(rowsByTokenId.get(clean(item.config_token_id))?.metadata_json).meta_ads_publish);
    if (!Object.keys(targetConfig).length) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
    }
    keys.push(bootstrapAdsetContractLockKey(targetConfig.account_id, targetConfig.adset_id));
  }
  return [...new Set(keys)].sort();
}

async function renewBootstrapMutationLocks(context) {
  if (context?.bootstrapMutationLocksHeld !== true || !safeArray(context.bootstrapMutationLockKeys).length) return;
  await acquireLocks(
    context.env,
    clean(context.bootstrapMutationRunId),
    clean(context.bootstrapMutationOperationKey),
    context.bootstrapMutationLockKeys,
  );
}

function bootstrapStateMayHaveGraphMutation(state) {
  return safeArray(state?.items).some((item) => {
    if (clean(item.destination_type) !== 'website') return false;
    const tracking = asObject(item.tracking);
    const fixture = asObject(item.fixture);
    return safeArray(tracking.keys).length > 0 ||
      fixture.copy_pending === true ||
      fixture.copy_ambiguous === true ||
      Boolean(clean(fixture.ad_id));
  });
}

function captureBootstrapPreviousMetaAdsPublish(entries, currentRows) {
  const rowsById = new Map(safeArray(currentRows).map((row) => [clean(row.id), row]));
  const prior = {};
  for (const entry of safeArray(entries)) {
    const tokenId = clean(entry.configTokenId);
    const row = rowsById.get(tokenId);
    const metaAdsPublish = asObject(parseObject(row?.metadata_json).meta_ads_publish);
    if (!row || !Object.keys(metaAdsPublish).length) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_token_not_eligible', 409);
    }
    prior[tokenId] = metaAdsPublish;
  }
  return prior;
}

async function readBootstrapRequest(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > CONFIG_WRITER_MAX_REQUEST_BYTES) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_request_too_large', 413);
  }
  try {
    const body = await request.json();
    if (!isJsonObject(body)) throw bootstrapFailure('meta_ads_publish_bootstrap_request_invalid', 400);
    return body;
  } catch (error) {
    if (isBootstrapFailure(error)) throw error;
    throw bootstrapFailure('meta_ads_publish_bootstrap_request_invalid', 400);
  }
}

async function validateBootstrapInput(body) {
  assertBootstrapExactKeys(body, new Set([
    'operation_key',
    'expected_config_authority_revision',
    'derived_plan_sha256',
    'entries',
  ]));
  const operationKey = clean(body.operation_key);
  if (!BOOTSTRAP_OPERATION_KEY_PATTERN.test(operationKey)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_operation_key_invalid', 400);
  }
  const expectedConfigAuthorityRevision = clean(body.expected_config_authority_revision).toLowerCase();
  if (!/^legacy:[a-f0-9]{64}$/.test(expectedConfigAuthorityRevision)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_expected_revision_invalid', 400);
  }
  if (!Array.isArray(body.entries) || body.entries.length < 2 || body.entries.length > BOOTSTRAP_MAX_ENTRIES) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_request_invalid', 400);
  }
  const seen = new Set();
  const entries = body.entries.map((value) => normalizeBootstrapEntry(value, seen))
    .sort((left, right) => left.configTokenId.localeCompare(right.configTokenId));
  const derivedPlanSha256 = clean(body.derived_plan_sha256).toLowerCase();
  if (derivedPlanSha256 && !/^[a-f0-9]{64}$/.test(derivedPlanSha256)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_derive_digest_invalid', 400);
  }
  const requestHash = await sha256(stableStringify({
    operation_key: operationKey,
    expected_config_authority_revision: expectedConfigAuthorityRevision,
    derived_plan_sha256: derivedPlanSha256,
    entries,
  }));
  return {
    operationKey,
    expectedConfigAuthorityRevision,
    derivedPlanSha256,
    entries,
    requestHash,
  };
}

function normalizeBootstrapEntry(value, seen) {
  if (!isJsonObject(value)) throw bootstrapFailure('meta_ads_publish_bootstrap_request_invalid', 400);
  const destinationType = normalizeDestinationKind(value.destination_type);
  const allowed = destinationType === 'website'
    ? new Set(['config_token_id', 'destination_type', 'source_config_token_id', 'source_adset_id', 'fixture_source_ad_id', 'url_tags', 'staging_synthetic_fixture'])
    : new Set(['config_token_id', 'destination_type']);
  assertBootstrapExactKeys(value, allowed);
  const configTokenId = clean(value.config_token_id);
  if (!CONFIG_WRITER_TOKEN_ID_PATTERN.test(configTokenId) || seen.has(configTokenId)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_token_invalid', 400);
  }
  seen.add(configTokenId);
  if (destinationType === 'whatsapp') return { configTokenId, destinationType };
  const sourceConfigTokenId = clean(value.source_config_token_id);
  const sourceAdsetId = clean(value.source_adset_id);
  const hasSourceConfigToken = Boolean(sourceConfigTokenId);
  const hasSourceAdset = Boolean(sourceAdsetId);
  if (hasSourceConfigToken === hasSourceAdset) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_source_invalid', 400);
  }
  const entry = {
    configTokenId,
    destinationType,
    urlTags: normalizeUrlTags(value.url_tags, { required: true }),
  };
  if (hasSourceConfigToken) {
    if (!CONFIG_WRITER_TOKEN_ID_PATTERN.test(sourceConfigTokenId)) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_source_invalid', 400);
    }
    entry.sourceConfigTokenId = sourceConfigTokenId;
  } else {
    entry.sourceAdsetId = normalizeNumericId(sourceAdsetId, 'bootstrap_source_adset_id');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'staging_synthetic_fixture')) {
    if (typeof value.staging_synthetic_fixture !== 'boolean') {
      throw bootstrapFailure('meta_ads_publish_bootstrap_request_invalid', 400);
    }
    if (value.staging_synthetic_fixture) entry.stagingSyntheticFixture = true;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'fixture_source_ad_id')) {
    entry.fixtureSourceAdId = normalizeNumericId(value.fixture_source_ad_id, 'bootstrap_fixture_source_ad_id');
  }
  return entry;
}

function assertBootstrapExactKeys(value, allowed) {
  if (!isJsonObject(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_request_invalid', 400);
  }
}

function assertBootstrapTargetsComplete(entries, rows) {
  // A Vault may carry unrelated active Facebook credentials.  This migration
  // is scoped strictly to rows that already opt into meta_ads_publish; do not
  // force a configuration write for a token that has no publishing contract.
  const configuredIds = safeArray(rows)
    .filter((row) => Object.keys(asObject(parseObject(row?.metadata_json).meta_ads_publish)).length > 0)
    .map((row) => clean(row.id))
    .sort();
  const requestedIds = safeArray(entries).map((entry) => entry.configTokenId).sort();
  if (configuredIds.length !== requestedIds.length || configuredIds.some((id, index) => id !== requestedIds[index])) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_targets_incomplete', 409);
  }
}

function bootstrapConfigOperationKey(operationKey) {
  const prefix = 'bootstrap-config:';
  return `${prefix}${clean(operationKey).slice(0, 160 - prefix.length)}`;
}

function bootstrapFailure(code, httpStatus = 400) {
  return Object.assign(new Error(code), { bootstrap_error: true, http_status: httpStatus });
}

function isBootstrapFailure(error) {
  return Boolean(error && error.bootstrap_error === true);
}

function bootstrapFailureResponse(error, requestId) {
  const code = isBootstrapFailure(error)
    ? clean(error.message)
    : 'meta_ads_publish_bootstrap_failed';
  const status = Number(error?.http_status) === 409
    ? 409
    : Number(error?.http_status) === 503
      ? 503
      : Number(error?.http_status) === 413
        ? 413
        : 400;
  return response({ ok: false, error: code, requestId }, status);
}

async function loadBootstrapOperation(env, operationKey) {
  return dbFirst(env, [
    'SELECT id, operation_key, request_hash, expected_config_authority_revision,',
    'resulting_tracking_binding_revision, status, state_ciphertext, summary_json',
    'FROM meta_ads_publish_bootstrap_operations WHERE operation_key = ?',
  ].join(' '), operationKey);
}

async function createBootstrapOperation({ env, input, state, encryptToken }) {
  const id = crypto.randomUUID();
  const now = nowIso();
  const stateCiphertext = await encryptBootstrapState(state, encryptToken, env);
  const result = await dbRun(env, [
    'INSERT INTO meta_ads_publish_bootstrap_operations (',
    'id, operation_key, request_hash, expected_config_authority_revision, status,',
    'state_ciphertext, summary_json, created_at, updated_at',
    ") VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)",
  ].join(' '),
  id,
  input.operationKey,
  input.requestHash,
  input.expectedConfigAuthorityRevision,
  stateCiphertext,
  JSON.stringify(summarizeBootstrapState(state)),
  now,
  now);
  if (statementChanges(result) !== 1) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_operation_conflict', 409);
  }
  return {
    id,
    operation_key: input.operationKey,
    request_hash: input.requestHash,
    expected_config_authority_revision: input.expectedConfigAuthorityRevision,
    status: 'pending',
  };
}

async function persistBootstrapState({ env, operation, state, status, resultingRevision = '', encryptToken, context = null }) {
  if (context?.assertBootstrapLease) await context.assertBootstrapLease();
  const stateCiphertext = await encryptBootstrapState(state, encryptToken, env);
  const result = await dbRun(env, [
    'UPDATE meta_ads_publish_bootstrap_operations',
    'SET status = ?, state_ciphertext = ?, summary_json = ?,',
    'resulting_tracking_binding_revision = COALESCE(NULLIF(?, \'\'), resulting_tracking_binding_revision),',
    'updated_at = ?',
    'WHERE id = ? AND operation_key = ? AND request_hash = ?',
  ].join(' '),
  status,
  stateCiphertext,
  JSON.stringify(summarizeBootstrapState(state)),
  clean(resultingRevision),
  nowIso(),
  clean(operation.id),
  clean(operation.operation_key),
  clean(operation.request_hash));
  if (statementChanges(result) !== 1) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_operation_state_stale', 409);
  }
  operation.status = status;
  if (resultingRevision) operation.resulting_tracking_binding_revision = resultingRevision;
}

async function assertBootstrapLease(context) {
  if (typeof context?.assertBootstrapLease !== 'function') {
    throw bootstrapFailure('meta_ads_publish_bootstrap_locked', 409);
  }
  await context.assertBootstrapLease();
}

async function encryptBootstrapState(state, encryptToken, env) {
  if (typeof encryptToken !== 'function') {
    throw bootstrapFailure('meta_ads_publish_bootstrap_unavailable', 503);
  }
  try {
    return await encryptToken(JSON.stringify(state), env);
  } catch {
    throw bootstrapFailure('meta_ads_publish_bootstrap_unavailable', 503);
  }
}

async function decryptBootstrapState(operation, decryptToken, env) {
  if (typeof decryptToken !== 'function') {
    throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
  }
  try {
    const parsed = JSON.parse(await decryptToken(clean(operation.state_ciphertext), env));
    if (!isJsonObject(parsed) || parsed.schema !== 'meta_ads_publish_bootstrap/v1' || !Array.isArray(parsed.items)) {
      throw new Error('invalid_bootstrap_state');
    }
    return parsed;
  } catch {
    throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
  }
}

function summarizeBootstrapState(state) {
  const items = safeArray(state?.items);
  const websites = items.filter((item) => clean(item.destination_type) === 'website');
  const whatsapp = items.filter((item) => clean(item.destination_type) === 'whatsapp');
  return {
    destination_count: items.length,
    website_destination_count: websites.length,
    whatsapp_destination_count: whatsapp.length,
    website_fixture_count: websites.filter((item) => Boolean(clean(item?.fixture?.ad_id))).length,
    website_event_required_count: websites.filter((item) => clean(item?.profile?.website_event_requirement) === 'required').length,
    offline_dataset_required_count: websites.filter((item) => clean(item?.profile?.offline_event_dataset_requirement) === 'required').length,
    website_url_tags_verified: websites.length > 0 && websites.every((item) => item?.fixture?.verified === true),
    conversion_contract_verified: websites.every((item) => item?.tracking?.verified === true),
  };
}

function bootstrapSuccessResponse({ input, state, revision, requestId, replayed }, status = 200) {
  const summary = summarizeBootstrapState(state);
  return response({
    ok: true,
    applied: !replayed,
    replayed: Boolean(replayed),
    operation_key: input.operationKey,
    operation_status: 'applied',
    config_authority_revision: revision,
    config_revision: revision,
    tracking_binding_revision: revision,
    workflow_contract_revision: WORKFLOW_CONTRACT_REVISION,
    website_fixture_count: summary.website_fixture_count,
    offline_dataset_count: summary.offline_dataset_required_count,
    website_url_tags_verified: summary.website_url_tags_verified,
    conversion_contract_verified: summary.conversion_contract_verified,
    requestId,
  }, status);
}

async function bootstrapConfigWasCommitted(env, state) {
  const configInput = asObject(state?.config_input);
  const operationKey = clean(configInput.operationKey);
  if (!operationKey) return false;
  const operation = await dbFirst(env, [
    'SELECT resulting_tracking_binding_revision, status',
    'FROM meta_ads_publish_config_operations WHERE operation_key = ?',
  ].join(' '), operationKey);
  if (!operation || clean(operation.status) !== 'applied') return false;
  const authority = await configWriterAuthorityState(await listMetaAdsPublishConfigRows(env));
  return authority.ready && clean(operation.resulting_tracking_binding_revision) === authority.revision;
}

async function writeBootstrapAudit(writeAudit, env, requestId, status, state) {
  if (typeof writeAudit !== 'function') return;
  const summary = summarizeBootstrapState(state);
  await writeAudit(env, {
    event: 'meta_ads_publish.config.bootstrap',
    status,
    requestId,
    metadata: {
      workflow_contract_revision: WORKFLOW_CONTRACT_REVISION,
      ...summary,
    },
  });
}

function statementChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function buildBootstrapUpdates({ input, state, operation, currentRows, context }) {
  const rowsById = new Map(currentRows.map((row) => [clean(row.id), row]));
  const itemsByTokenId = new Map(safeArray(state.items).map((item) => [clean(item.config_token_id), item]));
  const updates = [];
  for (const entry of input.entries) {
    const targetRow = rowsById.get(entry.configTokenId);
    if (!targetRow) throw bootstrapFailure('meta_ads_publish_bootstrap_token_not_eligible', 409);
    let item = itemsByTokenId.get(entry.configTokenId);
    if (!item) {
      item = {
        config_token_id: entry.configTokenId,
        destination_type: entry.destinationType,
        source_config_token_id: entry.sourceConfigTokenId || '',
        source_adset_id: entry.sourceAdsetId || '',
        url_tags: entry.urlTags || '',
        fixture_source_ad_id: entry.fixtureSourceAdId || '',
        staging_synthetic_fixture: entry.stagingSyntheticFixture === true,
      };
      state.items.push(item);
      itemsByTokenId.set(entry.configTokenId, item);
      await persistBootstrapState({ env: context.env, operation, state, status: 'pending', encryptToken: context.encryptToken, context });
    }
    if (clean(item.destination_type) !== entry.destinationType ||
      clean(item.source_config_token_id) !== clean(entry.sourceConfigTokenId) ||
      clean(item.source_adset_id) !== clean(entry.sourceAdsetId) ||
      String(item.url_tags || '') !== String(entry.urlTags || '') ||
      Boolean(item.staging_synthetic_fixture) !== Boolean(entry.stagingSyntheticFixture)) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
    }
    const targetAuth = await resolveLegacyBootstrapGraphAuth(entry.configTokenId, context);
    const targetAdset = await readAdsetConversionState(targetAuth, targetAuth.config.adset_id, context);
    if (entry.destinationType === 'website') {
      const sourceAuth = await resolveLegacyBootstrapSourceAuth(entry, targetAuth, context);
      // The v20 runtime later reads the authorized source ad set through the
      // destination credential. Prove that exact access path now rather than
      // committing a profile that only the bootstrap's separate source token
      // can inspect.
      const sourceAdset = await readAdsetConversionState(targetAuth, sourceAuth.config.adset_id, context);
      const profile = buildBootstrapTrackingProfile({
        sourceAuth,
        sourceAdset,
        targetAuth,
        targetAdset,
        targetConfig: targetAuth.config,
        stagingSyntheticFixture: entry.stagingSyntheticFixture === true,
      });
      item.profile = profile;
      item.target_adset_id = targetAuth.config.adset_id;
      item.source_adset_id = sourceAuth.config.adset_id;
      await reconcileBootstrapTracking({ item, sourceAdset, targetAdset, sourceAuth, targetAuth, state, operation, context });
      await createOrReuseBootstrapFixture({
        item,
        sourceAdsetId: sourceAuth.config.adset_id,
        targetAuth,
        state,
        operation,
        context,
      });
      if (item.profile?.staging_synthetic_fixture === true) {
        await restoreBootstrapTrackingBaseline({ item, targetAuth, state, operation, context });
      }
      updates.push({
        token_id: entry.configTokenId,
        meta_ads_publish: buildBootstrapWebsiteConfig(targetAuth.config, item),
      });
      continue;
    }

    const whatsappDestinationUrl = await discoverBootstrapWhatsAppDestination(targetAuth, targetAdset, context, item);
    item.whatsapp_destination_url = whatsappDestinationUrl;
    await persistBootstrapState({ env: context.env, operation, state, status: 'pending', encryptToken: context.encryptToken, context });
    updates.push({
      token_id: entry.configTokenId,
      meta_ads_publish: buildBootstrapWhatsAppConfig(targetAuth.config, whatsappDestinationUrl),
    });
  }
  return updates;
}

async function resolveLegacyBootstrapGraphAuth(configTokenId, context) {
  const tokenId = clean(configTokenId);
  if (!CONFIG_WRITER_TOKEN_ID_PATTERN.test(tokenId)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_token_invalid', 400);
  }
  const row = await dbFirst(context.env, [
    'SELECT id, provider, active, token_ciphertext, metadata_json',
    'FROM credential_tokens WHERE id = ?',
  ].join(' '), tokenId);
  if (!row || clean(row.provider) !== 'facebook' || Number(row.active) !== 1) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_token_not_eligible', 409);
  }
  const config = asObject(parseObject(row.metadata_json).meta_ads_publish);
  let accountId;
  let apiVersion;
  let adsetId;
  try {
    accountId = normalizeNumericId(config.account_id, 'bootstrap_account_id');
    apiVersion = normalizeApiVersion(config.api_version || 'v25.0');
    adsetId = normalizeNumericId(config.adset_id, 'bootstrap_adset_id');
  } catch {
    throw bootstrapFailure('meta_ads_publish_bootstrap_legacy_config_invalid', 409);
  }
  let accessToken;
  try {
    accessToken = await context.decryptToken(row.token_ciphertext, context.env);
  } catch {
    throw bootstrapFailure('meta_ads_publish_bootstrap_token_unavailable', 503);
  }
  const appSecretProof = clean(context.env.META_APP_SECRET)
    ? await hmacSha256(clean(context.env.META_APP_SECRET), accessToken)
    : '';
  return {
    tokenId,
    accountId,
    apiVersion,
    accessToken,
    appSecretProof,
    config: { ...config, adset_id: adsetId, account_id: accountId, api_version: apiVersion },
  };
}

// A bootstrap manifest may either identify a separately-authorized legacy
// source destination or point directly to a source ad set that the target
// credential is already authorized to read.  In both cases, all Graph reads
// use the target credential: that is the credential the v20 runtime retains.
async function resolveLegacyBootstrapSourceAuth(entry, targetAuth, context) {
  let sourceAdsetId = clean(entry.sourceAdsetId);
  let sourceAccountId = targetAuth.accountId;
  const sourceConfigTokenId = clean(entry.sourceConfigTokenId);
  if (sourceConfigTokenId) {
    if (!CONFIG_WRITER_TOKEN_ID_PATTERN.test(sourceConfigTokenId)) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_source_invalid', 400);
    }
    const row = await dbFirst(context.env, [
      'SELECT id, provider, active, metadata_json',
      'FROM credential_tokens WHERE id = ?',
    ].join(' '), sourceConfigTokenId);
    if (!row || clean(row.provider) !== 'facebook' || Number(row.active) !== 1) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_token_not_eligible', 409);
    }
    const config = asObject(parseObject(row.metadata_json).meta_ads_publish);
    try {
      sourceAdsetId = normalizeNumericId(config.adset_id, 'bootstrap_source_adset_id');
      sourceAccountId = normalizeNumericId(config.account_id, 'bootstrap_source_account_id');
    } catch {
      throw bootstrapFailure('meta_ads_publish_bootstrap_legacy_config_invalid', 409);
    }
  }
  sourceAdsetId = normalizeNumericId(sourceAdsetId, 'bootstrap_source_adset_id');
  return {
    ...targetAuth,
    accountId: sourceAccountId,
    config: {
      ...asObject(targetAuth.config),
      adset_id: sourceAdsetId,
      account_id: sourceAccountId,
    },
  };
}

function buildBootstrapTrackingProfile({ sourceAuth, sourceAdset, targetAuth, targetAdset, targetConfig, stagingSyntheticFixture = false }) {
  const source = asObject(sourceAdset);
  const target = asObject(targetAdset);
  const sourceKind = normalizeDestinationKind(source.destination_type, { optional: true });
  const targetKind = normalizeDestinationKind(target.destination_type, { optional: true });
  if (sourceKind !== 'website' || targetKind !== 'website') {
    throw bootstrapFailure('meta_ads_publish_bootstrap_website_destination_required', 409);
  }
  assertAdsetAccountAuthorized(source, target, targetAuth.accountId);
  const websiteRequired = websiteEventRequiredForDelivery(
    asObject(source.campaign).objective,
    source.optimization_goal,
  );
  const offlineRequired = Boolean(clean(asObject(source.promoted_object).offline_conversion_data_set_id));
  const profile = {
    profile_ref: bootstrapProfileRef(targetAuth.tokenId),
    source_adset_id: sourceAuth.config.adset_id,
    destination_kind: 'website',
    website_event_requirement: websiteRequired ? 'required' : 'not_required',
    offline_event_dataset_requirement: offlineRequired ? 'required' : 'not_required',
  };
  if (stagingSyntheticFixture) {
    if (
      sourceAuth.config.adset_id === targetAuth.config.adset_id ||
      profile.website_event_requirement !== 'required' ||
      profile.offline_event_dataset_requirement !== 'required'
    ) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_staging_fixture_invalid', 409);
    }
    profile.staging_synthetic_fixture = true;
  }
  assertWebsiteTrackingCompatibility(source, target, profile);
  // Retain an already verified native-carousel route rather than silently
  // disabling an existing campaign during the legacy-to-v20 transition.
  const carouselAdsetId = clean(targetConfig.carousel_native_adset_id);
  if (
    targetConfig.carousel_native_adset_verified === true &&
    targetConfig.carousel_native_route_active === true &&
    carouselAdsetId
  ) {
    profile.authorized_destination_adset_ids = [
      normalizeNumericId(carouselAdsetId, 'bootstrap_carousel_native_adset_id'),
    ];
  }
  return profile;
}

function bootstrapProfileRef(tokenId) {
  const suffix = clean(tokenId).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64);
  return `bootstrap.${suffix}`;
}

function buildBootstrapWebsiteConfig(legacyConfig, item) {
  const base = buildBootstrapConfigBase(legacyConfig, 'website');
  const profile = {
    source_adset_id: clean(item.profile?.source_adset_id),
    destination_kind: 'website',
    website_event_requirement: clean(item.profile?.website_event_requirement),
    offline_event_dataset_requirement: clean(item.profile?.offline_event_dataset_requirement),
  };
  if (item.profile?.staging_synthetic_fixture === true) profile.staging_synthetic_fixture = true;
  if (safeArray(item.profile?.authorized_destination_adset_ids).length) {
    profile.authorized_destination_adset_ids = safeArray(item.profile.authorized_destination_adset_ids);
    Object.assign(base, bootstrapCarouselConfig(legacyConfig));
  }
  const profileRef = clean(item.profile?.profile_ref);
  return validateGovernedMetaAdsPublishConfig({
    ...base,
    tracking_contract: {
      url_tags: String(item.url_tags || ''),
      profile_ref: profileRef,
      production_url_tags_readback_fixture: {
        ad_id: clean(item.fixture?.ad_id),
        creative_id: clean(item.fixture?.creative_id),
      },
    },
    tracking_profiles: { [profileRef]: profile },
  });
}

function buildBootstrapWhatsAppConfig(legacyConfig, whatsappDestinationUrl) {
  return validateGovernedMetaAdsPublishConfig({
    ...buildBootstrapConfigBase(legacyConfig, 'whatsapp'),
    whatsapp_destination_url: whatsappDestinationUrl,
  });
}

function buildBootstrapConfigBase(value, destinationType) {
  const config = asObject(value);
  const base = {
    destination_group: clean(config.destination_group),
    api_version: clean(config.api_version),
    account_id: clean(config.account_id),
    campaign_id: clean(config.campaign_id),
    adset_id: clean(config.adset_id),
    page_id: clean(config.page_id),
    instagram_user_id: clean(config.instagram_user_id),
    allowed_link_hosts: safeArray(config.allowed_link_hosts),
    landing_pages_by_creative_group: asObject(config.landing_pages_by_creative_group),
    freshness_window_days: config.freshness_window_days,
    destination_type: destinationType,
  };
  if (Object.prototype.hasOwnProperty.call(config, 'row_number')) base.row_number = config.row_number;
  return base;
}

function bootstrapCarouselConfig(value) {
  const config = asObject(value);
  return {
    carousel_native_campaign_id: clean(config.carousel_native_campaign_id),
    carousel_native_adset_id: clean(config.carousel_native_adset_id),
    carousel_native_adset_verified: true,
    carousel_native_route_active: true,
  };
}

async function reconcileBootstrapTracking({ item, sourceAdset, targetAdset, sourceAuth, targetAuth, state, operation, context }) {
  if (sourceAuth.accountId !== targetAuth.accountId) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_source_account_incompatible', 409);
  }
  const profile = asObject(item.profile);
  const desired = projectAuthorizedTrackingPromotedObject(sourceAdset, targetAdset, profile);
  const keys = trackingKeysForProfile(profile);
  const previousTracking = selectTrackingKeys(asObject(targetAdset).promoted_object, keys);
  const desiredTracking = selectTrackingKeys(desired.tracking_promoted_object, keys);
  const stored = asObject(item.tracking);
  if (Object.keys(stored).length) {
    if (
      stableStringify(safeArray(stored.keys)) !== stableStringify(keys) ||
      stableStringify(asObject(stored.desired_tracking_promoted_object)) !== stableStringify(desiredTracking)
    ) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
    }
  } else {
    item.tracking = {
      keys,
      previous_tracking_promoted_object: previousTracking,
      desired_tracking_promoted_object: desiredTracking,
      verified: false,
    };
    await persistBootstrapState({ env: context.env, operation, state, status: 'pending', encryptToken: context.encryptToken, context });
  }

  const current = asObject(targetAdset).promoted_object;
  if (!trackingKeysMatch(current, desiredTracking, keys)) {
    const expectedPrevious = asObject(item.tracking.previous_tracking_promoted_object);
    if (!trackingKeysMatch(current, expectedPrevious, keys)) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_tracking_concurrent_drift', 409);
    }
    await assertBootstrapLease(context);
    await updateAdsetTrackingWithReconciliation(targetAuth, targetAuth.config.adset_id, desired.full_promoted_object, profile, context);
  }
  const readback = await readAdsetConversionState(targetAuth, targetAuth.config.adset_id, context);
  if (!trackingKeysMatch(readback.promoted_object, desiredTracking, keys)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_tracking_readback_mismatch', 502);
  }
  item.tracking.verified = true;
  item.tracking.graph_mutation = keys.length && !trackingKeysMatch(current, desiredTracking, keys)
    ? 'promoted_object_updated'
    : 'none';
  // Keep an explicit source/target proof in the encrypted state only. The
  // public summary exposes booleans, never the pixel, event, dataset or IDs.
  item.tracking.source = summarizeAdsetConversionTracking(sourceAdset);
  item.tracking.target = summarizeAdsetConversionTracking(readback);
  await persistBootstrapState({ env: context.env, operation, state, status: 'tracking_configured', encryptToken: context.encryptToken, context });
}

// A staging-only synthetic fixture must begin from a known, intentionally
// mismatched state so the deployment can prove GET -> POST -> GET
// reconciliation and its rollback. We create and read back the fixture while
// the target is conforming, then restore exactly the encrypted pre-bootstrap
// tracking fields before committing the staging profile.
async function restoreBootstrapTrackingBaseline({ item, targetAuth, state, operation, context }) {
  const tracking = asObject(item.tracking);
  const keys = safeArray(tracking.keys);
  const previous = asObject(tracking.previous_tracking_promoted_object);
  const desired = asObject(tracking.desired_tracking_promoted_object);
  if (!keys.length || !tracking.verified) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_staging_fixture_tracking_unverified', 409);
  }
  const current = await readAdsetConversionState(targetAuth, targetAuth.config.adset_id, context);
  if (trackingKeysMatch(current.promoted_object, previous, keys)) {
    item.tracking.staging_baseline_restored = true;
    await persistBootstrapState({ env: context.env, operation, state, status: 'fixture_created', encryptToken: context.encryptToken, context });
    return;
  }
  if (!trackingKeysMatch(current.promoted_object, desired, keys)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_tracking_concurrent_drift', 409);
  }
  const restored = { ...asObject(current.promoted_object) };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(previous, key)) restored[key] = previous[key];
    else delete restored[key];
  }
  await assertBootstrapLease(context);
  await updateAdsetPromotedObject(targetAuth, targetAuth.config.adset_id, restored, context);
  const readback = await readAdsetConversionState(targetAuth, targetAuth.config.adset_id, context);
  if (!trackingKeysMatch(readback.promoted_object, previous, keys)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_staging_fixture_restore_mismatch', 502);
  }
  item.tracking.staging_baseline_restored = true;
  await persistBootstrapState({ env: context.env, operation, state, status: 'fixture_created', encryptToken: context.encryptToken, context });
}

function selectTrackingKeys(value, keys) {
  const source = asObject(value);
  const selected = {};
  for (const key of safeArray(keys)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) selected[key] = source[key];
  }
  return selected;
}

async function createOrReuseBootstrapFixture({ item, sourceAdsetId, targetAuth, state, operation, context }) {
  const fixtureName = clean(item.fixture?.name) || await bootstrapFixtureName(context.operationKey, item.config_token_id);
  item.fixture = { ...asObject(item.fixture), name: fixtureName };
  await persistBootstrapState({ env: context.env, operation, state, status: 'tracking_configured', encryptToken: context.encryptToken, context });

  const recordedFixture = asObject(item.fixture);
  if (recordedFixture.copy_pending === true || recordedFixture.copy_ambiguous === true) {
    // A process may have stopped after the single allowed POST but before a
    // durable owned ad id was recorded. Never issue another copy or claim a
    // clean rollback from this ambiguous state.
    throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_copy_reconciliation_required', 409);
  }

  const recordedAdId = clean(recordedFixture.ad_id);
  if (recordedAdId) {
    if (recordedFixture.owned_by_operation !== true) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_ownership_unconfirmed', 409);
    }
    try {
      const verified = await validateBootstrapFixture(
        targetAuth,
        recordedAdId,
        targetAuth.config.adset_id,
        fixtureName,
        item.url_tags,
        context,
      );
      item.fixture = {
        name: fixtureName,
        source_ad_id: clean(recordedFixture.source_ad_id),
        ad_id: verified.adId,
        creative_id: verified.creativeId,
        verified: true,
        owned_by_operation: true,
        copy_pending: false,
      };
      await persistBootstrapState({ env: context.env, operation, state, status: 'fixture_created', encryptToken: context.encryptToken, context });
      return;
    } catch (error) {
      if (isBootstrapFailure(error)) throw error;
      // Do not fall through to a second copy when the exact fixture recorded
      // by this saga has changed or cannot be read. Its ownership must be
      // reconciled explicitly before any retry.
      throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_owned_state_drift', 409);
    }
  }

  const existing = await findBootstrapFixture(targetAuth, targetAuth.config.adset_id, fixtureName, item.url_tags, context);
  if (existing) {
    // A fixture with our deterministic marker but without a durable owned id
    // may belong to a failed/foreign operation. It is never adopted or
    // archived by this saga.
    throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_ownership_unconfirmed', 409);
  }

  // The target credential is the only credential retained by v20. It was
  // already used to read the source ad set above; use it again here so the
  // fixture cannot depend on a one-off bootstrap-only Facebook grant.
  const sourceAdId = await resolveBootstrapFixtureSourceAd({
    item,
    auth: targetAuth,
    expectedAdsetId: sourceAdsetId,
    context,
  });
  // Persist the intent before the only mutating copy request. If the Worker
  // dies at any later point, the next attempt refuses to duplicate an unknown
  // paused fixture and records reconciliation as required.
  item.fixture = {
    ...asObject(item.fixture),
    name: fixtureName,
    source_ad_id: sourceAdId,
    copy_pending: true,
    copy_ambiguous: false,
  };
  await persistBootstrapState({ env: context.env, operation, state, status: 'tracking_configured', encryptToken: context.encryptToken, context });

  let copiedId = '';
  let copyIssued = false;
  try {
    await assertBootstrapLease(context);
    const result = await graphRequest(
      graphUrl(targetAuth.apiVersion, `${sourceAdId}/copies`),
      jsonRequest('POST', {
        adset_id: targetAuth.config.adset_id,
        status_option: 'PAUSED',
        creative_parameters: {
          name: fixtureName,
          url_tags: String(item.url_tags),
        },
      }),
      targetAuth,
      context,
      { maxAttempts: 1 },
    );
    copyIssued = true;
    copiedId = normalizeBootstrapCopiedAdId(result.body);
  } catch (error) {
    const normalized = normalizeFailure(error);
    if (copyIssued || normalized.ambiguous || normalized.retryable) {
      // The marker allows a governed recovery process to find a possible
      // orphan, but this request does not claim ownership from a timeout.
      // Retrying the copy could duplicate an ad; continuing could archive a
      // human-created fixture. Preserve the encrypted intent and fail closed.
      item.fixture = {
        ...asObject(item.fixture),
        copy_pending: true,
        copy_ambiguous: true,
      };
      await persistBootstrapState({ env: context.env, operation, state, status: 'reconciliation_required', encryptToken: context.encryptToken, context }).catch(() => undefined);
      throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_copy_reconciliation_required', 409);
    }
    throw error;
  }
  if (!copiedId) {
    item.fixture = {
      ...asObject(item.fixture),
      copy_pending: true,
      copy_ambiguous: true,
    };
    await persistBootstrapState({ env: context.env, operation, state, status: 'reconciliation_required', encryptToken: context.encryptToken, context }).catch(() => undefined);
    throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_copy_reconciliation_required', 409);
  }
  // Persist the opaque ad ID before its Graph readback. A successful POST can
  // still be followed by a transport/readback failure; cleanup may archive
  // only this explicitly owned fixture after proving its marker and tags.
  item.fixture = {
    ...asObject(item.fixture),
    name: fixtureName,
    source_ad_id: sourceAdId,
    ad_id: copiedId,
    verified: false,
    owned_by_operation: true,
    copy_pending: false,
    copy_ambiguous: false,
  };
  await persistBootstrapState({ env: context.env, operation, state, status: 'tracking_configured', encryptToken: context.encryptToken, context });
  const verified = await validateBootstrapFixture(targetAuth, copiedId, targetAuth.config.adset_id, fixtureName, item.url_tags, context);
  item.fixture = {
    name: fixtureName,
    source_ad_id: sourceAdId,
    ad_id: verified.adId,
    creative_id: verified.creativeId,
    verified: true,
    owned_by_operation: true,
    copy_pending: false,
  };
  await persistBootstrapState({ env: context.env, operation, state, status: 'fixture_created', encryptToken: context.encryptToken, context });
}

async function bootstrapFixtureName(operationKey, configTokenId) {
  // Never derive ownership from a shared human-readable prefix. The marker is
  // collision-resistant across operations and token rows, but contains no raw
  // account/ad-set ID or URL tag value.
  const marker = await sha256(`meta-ads-bootstrap-fixture\n${clean(operationKey)}\n${clean(configTokenId)}`);
  return `${BOOTSTRAP_FIXTURE_NAME_PREFIX} [sk:${marker.slice(0, 32)}]`.slice(0, 255);
}

async function resolveBootstrapFixtureSourceAd({ item, auth, expectedAdsetId, context }) {
  const sourceAdsetId = normalizeNumericId(expectedAdsetId, 'bootstrap_fixture_source_adset_id');
  const existingId = clean(item.fixture?.source_ad_id || item.fixture_source_ad_id);
  if (existingId) {
    const ad = await readBootstrapAd(auth, existingId, context);
    assertBootstrapFixtureSourceAd(ad, sourceAdsetId);
    return normalizeNumericId(ad.id, 'bootstrap_fixture_source_ad_id');
  }
  const candidates = (await listBootstrapAdsetAds(auth, sourceAdsetId, context))
    .filter((entry) => isBootstrapFixtureSourceCandidate(entry, sourceAdsetId));
  if (candidates.length !== 1) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_source_ambiguous', 409);
  }
  return normalizeNumericId(candidates[0].id, 'bootstrap_fixture_source_ad_id');
}

function assertBootstrapFixtureSourceAd(value, expectedAdsetId) {
  const ad = asObject(value);
  if (
    normalizeNumericId(ad.adset_id, 'bootstrap_fixture_source_adset_id') !== expectedAdsetId ||
    !isBootstrapFixtureSourceCandidate(ad, expectedAdsetId)
  ) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_source_invalid', 409);
  }
}

function isBootstrapFixtureSourceCandidate(value, expectedAdsetId) {
  const ad = asObject(value);
  const status = clean(ad.status).toUpperCase();
  const effectiveStatus = clean(ad.effective_status).toUpperCase();
  const creativeId = clean(asObject(ad.creative).id);
  return clean(ad.adset_id) === clean(expectedAdsetId) &&
    ['ACTIVE', 'PAUSED'].includes(status) &&
    (!effectiveStatus || ['ACTIVE', 'PAUSED'].includes(effectiveStatus)) &&
    /^\d{5,30}$/.test(creativeId);
}

async function findBootstrapFixture(auth, adsetId, fixtureName, urlTags, context) {
  const named = (await listBootstrapAdsetAds(auth, adsetId, context)).filter((entry) => {
    const creative = asObject(entry.creative);
    return clean(entry.adset_id) === clean(adsetId) &&
      clean(creative.name) === fixtureName;
  });
  const matches = named.filter((entry) => String(asObject(entry.creative).url_tags ?? '') === String(urlTags));
  if (named.length !== matches.length) {
    // The deterministic marker belongs to a fixture with different raw tags.
    // Never overwrite its state with a new copy: it may be an interrupted
    // prior saga whose ownership cannot be established from a list response.
    throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_marker_conflict', 409);
  }
  if (matches.length > 1) throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_ambiguous', 409);
  return matches[0] || null;
}

function normalizeBootstrapCopiedAdId(value) {
  const body = asObject(value);
  const candidate = clean(body.copied_ad_id || body.ad_id || body.id);
  if (!candidate) return '';
  try {
    return normalizeNumericId(candidate, 'bootstrap_fixture_ad_id');
  } catch {
    throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_create_unconfirmed', 502);
  }
}

async function validateBootstrapFixture(auth, adId, expectedAdsetId, fixtureName, urlTags, context) {
  const ad = await readBootstrapAd(auth, adId, context);
  if (
    normalizeNumericId(ad.adset_id, 'bootstrap_fixture_adset_id') !== expectedAdsetId ||
    clean(ad.status).toUpperCase() !== 'PAUSED'
  ) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_readback_mismatch', 502);
  }
  const creativeId = normalizeNumericId(asObject(ad.creative).id, 'bootstrap_fixture_creative_id');
  const creativeResult = await graphRequest(
    graphUrl(auth.apiVersion, creativeId, { fields: CREATIVE_READ_FIELDS.join(',') }),
    { method: 'GET' },
    auth,
    context,
  );
  const creative = asObject(creativeResult.body);
  if (clean(creative.name) !== fixtureName || String(creative.url_tags ?? '') !== String(urlTags)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_readback_mismatch', 502);
  }
  return { adId: normalizeNumericId(ad.id, 'bootstrap_fixture_ad_id'), creativeId };
}

async function readBootstrapAd(auth, adId, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, normalizeNumericId(adId, 'bootstrap_ad_id'), { fields: BOOTSTRAP_AD_FIELDS }),
    { method: 'GET' },
    auth,
    context,
  );
  return asObject(result.body);
}

async function listBootstrapAdsetAds(auth, adsetId, context) {
  let url = graphUrl(auth.apiVersion, `${normalizeNumericId(adsetId, 'bootstrap_adset_id')}/ads`, {
    fields: BOOTSTRAP_AD_FIELDS,
    limit: '100',
  });
  const ads = [];
  let pages = 0;
  while (url) {
    pages += 1;
    if (pages > MAX_AD_PAGES || ads.length > MAX_ADS) {
      throw bootstrapFailure('meta_ads_publish_bootstrap_fixture_discovery_limit', 409);
    }
    const result = await graphRequest(url, { method: 'GET' }, auth, context);
    ads.push(...safeArray(result.body.data).map(asObject));
    url = validatePagingUrl(result.body?.paging?.next, auth.apiVersion);
  }
  return ads;
}

async function discoverBootstrapWhatsAppDestination(auth, targetAdset, context, item) {
  const graphDestination = clean(asObject(targetAdset).destination_type).toUpperCase();
  if (graphDestination && !isBootstrapWhatsAppGraphDestination(graphDestination)) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_whatsapp_destination_required', 409);
  }
  const urls = new Set();
  for (const ad of await listBootstrapAdsetAds(auth, auth.config.adset_id, context)) {
    const status = clean(ad.status).toUpperCase();
    if (!['ACTIVE', 'PAUSED'].includes(status)) continue;
    for (const rawUrl of bootstrapCreativeDestinationUrls(asObject(ad.creative))) {
      try {
        const normalized = normalizeConfigWriterWhatsAppUrl(rawUrl);
        urls.add(normalized);
      } catch {
        // An arbitrary creative field is not evidence of a WhatsApp route.
      }
    }
  }
  if (urls.size !== 1) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_whatsapp_destination_ambiguous', 409);
  }
  const destination = [...urls][0];
  if (clean(item.whatsapp_destination_url) && clean(item.whatsapp_destination_url) !== destination) {
    throw bootstrapFailure('meta_ads_publish_bootstrap_reconciliation_required', 409);
  }
  return destination;
}

function isBootstrapWhatsAppGraphDestination(value) {
  const normalized = clean(value).toUpperCase();
  return normalized === 'WHATSAPP' || /^MESSAGING(?:_[A-Z0-9]+)*_WHATSAPP$/.test(normalized);
}

function bootstrapCreativeDestinationUrls(value) {
  const creative = asObject(value);
  const story = asObject(creative.object_story_spec);
  const linkData = asObject(story.link_data);
  const videoData = asObject(story.video_data);
  const videoCtaValue = asObject(asObject(videoData.call_to_action).value);
  const feed = asObject(creative.asset_feed_spec);
  return [
    linkData.link,
    videoCtaValue.link,
    ...safeArray(feed.link_urls).map((entry) => asObject(entry).website_url),
  ].map(clean).filter(Boolean);
}

async function compensateBootstrapState({ state, context }) {
  let safe = true;
  const items = [...safeArray(state.items)].reverse();
  for (const item of items) {
    if (clean(item.destination_type) !== 'website') continue;
    try {
      const targetAuth = await resolveLegacyBootstrapGraphAuth(clean(item.config_token_id), context);
      const fixture = asObject(item.fixture);
      const tracking = asObject(item.tracking);
      const keys = safeArray(tracking.keys);
      if (keys.length) {
        const current = await readAdsetConversionState(targetAuth, targetAuth.config.adset_id, context);
        const desired = asObject(tracking.desired_tracking_promoted_object);
        const previous = asObject(tracking.previous_tracking_promoted_object);
        if (!trackingKeysMatch(current.promoted_object, previous, keys)) {
          if (!trackingKeysMatch(current.promoted_object, desired, keys)) {
            safe = false;
            continue;
          }
          const restored = { ...asObject(current.promoted_object) };
          for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(previous, key)) restored[key] = previous[key];
            else delete restored[key];
          }
          await assertBootstrapLease(context);
          await updateAdsetPromotedObject(targetAuth, targetAuth.config.adset_id, restored, context);
          const readback = await readAdsetConversionState(targetAuth, targetAuth.config.adset_id, context);
          if (!trackingKeysMatch(readback.promoted_object, previous, keys)) {
            safe = false;
            continue;
          }
        }
      }

      // Do not archive the known-good paused creative before tracking has
      // been restored. If Graph refuses the promoted_object restore, v20 stays
      // authoritative and its required fixture remains usable for recovery.
      if (fixture.copy_pending === true || fixture.copy_ambiguous === true) {
        safe = false;
        continue;
      }
      const fixtureAdId = clean(fixture.ad_id);
      if (fixtureAdId && fixture.owned_by_operation === true) {
        // Do not archive a merely discovered fixture. Even a deterministic
        // marker is not ownership proof until this saga recorded a successful
        // copy response; read back its exact target/name/tags before cleanup.
        const currentFixture = await readBootstrapAd(targetAuth, fixtureAdId, context);
        if (clean(currentFixture.status).toUpperCase() !== 'ARCHIVED') {
          const verified = await validateBootstrapFixture(
            targetAuth,
            fixtureAdId,
            targetAuth.config.adset_id,
            clean(fixture.name),
            String(item.url_tags || ''),
            context,
          );
          await assertBootstrapLease(context);
          await updateAdWithReconciliation(targetAuth, verified.adId, { status: 'ARCHIVED' }, context);
          const archived = await readBootstrapAd(targetAuth, verified.adId, context);
          if (clean(archived.status).toUpperCase() !== 'ARCHIVED') safe = false;
        }
      }
    } catch {
      safe = false;
    }
  }
  return safe;
}

async function getInventory({ request, env, requestId, decryptToken, writeAudit }) {
  const body = await readObject(request);
  try {
    const context = {
      env,
      runId: 'inventory',
      operationKey: `inventory:${clean(body.account_id)}`,
      decryptToken,
      attempts: 0,
      rateUsage: {},
      traceId: '',
    };
    const result = await listAds(body, context);
    const placementChecks = [];
    const seenAdsets = new Set();
    for (const entry of safeArray(body.adsets)) {
      const adsetId = normalizeNumericId(entry && entry.adset_id, 'adset_id');
      if (seenAdsets.has(adsetId)) continue;
      seenAdsets.add(adsetId);
      placementChecks.push({
        adset_id: adsetId,
        destination_group: clean(entry && entry.destination_group),
        ...await readAdsetPlacements(body, adsetId, context),
      });
    }
    await writeAudit(env, {
      event: 'meta_ads_publish.inventory',
      status: 'ok',
      requestId,
      metadata: {
        token_id: clean(body.token_id),
        account_id: clean(body.account_id),
        item_count: result.item_count,
        page_count: result.page_count,
      },
    });
    return response({ ok: true, ...result, placement_checks: placementChecks, rate_usage: context.rateUsage, requestId });
  } catch (error) {
    const normalized = normalizeFailure(error);
    await writeAudit(env, {
      event: 'meta_ads_publish.inventory',
      status: 'failed',
      requestId,
      metadata: {
        token_id: clean(body.token_id),
        account_id: clean(body.account_id),
        error_class: normalized.classification,
        code: normalized.code,
        subcode: normalized.error_subcode,
        fbtrace_id: normalized.fbtrace_id,
      },
    });
    return response({ ok: false, error: 'meta_inventory_failed', detail: normalized, requestId }, normalized.http_status || 502);
  }
}

async function getConfig(env, requestId) {
  const rows = await listMetaAdsPublishConfigRows(env);

  const destinations = [];
  const landingPageInvalid = [];
  for (const row of rows) {
    const metadata = parseObject(row.metadata_json);
    const config = asObject(metadata.meta_ads_publish);
    if (!Object.keys(config).length) {
      continue;
    }
    const allowedLinkHosts = normalizeHosts(config.allowed_link_hosts);
    const trackingContract = normalizeTrackingContract(config.tracking_contract, config.tracking_profiles, config.adset_id);
    const landingDefinition = normalizeLandingPageMap(config.landing_pages_by_creative_group, allowedLinkHosts);
    const landingPageValidation = await validateLandingPagesOnline(landingDefinition.pages, allowedLinkHosts, env);
    const landingErrors = [...landingDefinition.errors, ...landingPageValidation.errors];
    if (!Object.keys(landingDefinition.pages).length) landingErrors.push({ error: 'landing_pages_by_creative_group_required' });
    if (landingErrors.length) {
      landingPageInvalid.push({
        token_id: clean(row.id),
        destination_group: clean(config.destination_group),
        errors: landingErrors,
      });
    }
    destinations.push({
      token_id: clean(row.id),
      unit: clean(row.unit),
      external_account_id: clean(row.external_account_id),
      expires_at: nullable(row.expires_at),
      updated_at: nullable(row.updated_at),
      row_number: config.row_number ?? '',
      destination_group: clean(config.destination_group),
      api_version: normalizeApiVersion(config.api_version || 'v25.0'),
      account_id: normalizeNumericId(config.account_id, 'account_id'),
      campaign_id: normalizeNumericId(config.campaign_id, 'campaign_id'),
      adset_id: normalizeNumericId(config.adset_id, 'adset_id'),
      page_id: normalizeNumericId(config.page_id, 'page_id'),
      instagram_user_id: normalizeNumericId(config.instagram_user_id, 'instagram_user_id'),
      allowed_link_hosts: allowedLinkHosts,
      landing_pages_by_creative_group: landingDefinition.pages,
      // These are non-secret destination hints consumed by Build Meta API
      // Params. They deliberately remain independent from Website-only
      // tracking metadata so Click-to-WhatsApp can run without it.
      destination_type: clean(config.destination_type).toUpperCase(),
      whatsapp_destination_url: clean(config.whatsapp_destination_url),
      // URL tags are a creative-level contract. They are intentionally
      // configured here rather than inferred from an existing ad, so a legacy
      // creative can never copy stale campaign attribution into a new one.
      tracking_contract: trackingContract,
      landing_page_validation: {
        ok: landingErrors.length === 0,
        results: landingPageValidation.results,
      },
      freshness_window_days: clampInteger(config.freshness_window_days, 7, 1, 90),
      carousel_native_campaign_id: clean(config.carousel_native_campaign_id),
      carousel_native_adset_id: clean(config.carousel_native_adset_id),
      carousel_native_adset_verified: config.carousel_native_adset_verified === true,
      carousel_native_route_active: config.carousel_native_route_active === true,
    });
  }

  const required = [
    'token_id', 'destination_group', 'api_version', 'account_id', 'campaign_id',
    'adset_id', 'page_id', 'instagram_user_id',
  ];
  const invalid = destinations
    .map((item) => ({
      token_id: item.token_id,
      missing: required.filter((key) => !clean(item[key])),
    }))
    .filter((item) => item.missing.length);
  invalid.push(...landingPageInvalid);
  // This revision is intentionally derived from the static authorization
  // configuration, not from landing_page_validation.  The latter contains a
  // point-in-time HTTP probe and would make an otherwise authorized run
  // unresumable merely because a live endpoint briefly changed state.
  const binding = await deriveTrackingBindingState(rows);
  const authority = await configWriterAuthorityState(rows);
  const configRevision = binding.revision;
  invalid.push(...binding.invalid);
  // A legacy row can satisfy the historical shape while still lacking the v20
  // tracking/CTWA split. Do not advertise such a source as publish-ready.
  const ready = invalid.length === 0 && destinations.length >= 2 && binding.ready && authority.ready;

  return response({
    ok: ready,
    ready,
    count: destinations.length,
    config_revision: configRevision,
    tracking_binding_revision: configRevision,
    // This opaque revision is only for the governed administrative writer. In
    // a legacy state it is hash-bound to the exact existing configuration,
    // allowing an atomic bootstrap without a wildcard bypass.
    config_authority_revision: authority.revision,
    config_authority_mode: authority.mode,
    destinations,
    invalid,
    capabilities: {
      workflow_contract_revision: WORKFLOW_CONTRACT_REVISION,
      video_upload: {
        supported_actions: VIDEO_UPLOAD_ACTIONS,
        max_file_bytes: MAX_VIDEO_BYTES,
        max_chunk_bytes: MAX_VIDEO_CHUNK_BYTES,
      },
      tracking: {
        adset_conversion_reconciliation: true,
        creative_url_tags_readback: true,
        authorized_creative_url_tags_readback: true,
      },
    },
    secrets_exposed: false,
    requestId,
  }, ready ? 200 : 409);
}

async function listMetaAdsPublishConfigRows(env) {
  return dbAll(env,
    `SELECT id, unit, external_account_id, token_type, expires_at, active,
            metadata_json, updated_at
       FROM credential_tokens
      WHERE provider = 'facebook' AND active = 1
      ORDER BY unit, external_account_id`,
  );
}

// The run binding deliberately contains only configuration that authorizes a
// Meta Ads Publish mutation. It is hashed privately and never returned with
// raw source-adset or tracking identifiers. In contrast to the public config
// payload, it excludes online landing-page probe results and timestamps.
function buildTrackingBindingDestination(row) {
  const metadata = parseObject(row.metadata_json);
  const config = asObject(metadata.meta_ads_publish);
  if (!Object.keys(config).length) return null;

  const tokenId = clean(row.id);
  const destinationGroup = clean(config.destination_group);
  if (!tokenId || !destinationGroup) throw failure('tracking_binding_destination_invalid', { http_status: 409 });

  const allowedLinkHosts = normalizeHosts(config.allowed_link_hosts).sort();
  const landingDefinition = normalizeLandingPageMap(config.landing_pages_by_creative_group, allowedLinkHosts);
  if (landingDefinition.errors.length || !Object.keys(landingDefinition.pages).length) {
    throw failure('tracking_binding_landing_pages_invalid', { http_status: 409 });
  }
  const trackingContract = normalizeTrackingContract(config.tracking_contract, config.tracking_profiles, config.adset_id);
  const profile = trackingContract.profile_configured
    ? asObject(asObject(config.tracking_profiles)[trackingContract.profile_ref])
    : {};
  const authorizedDestinationAdsetIds = trackingContract.profile_configured
    ? normalizeProfileAuthorizedDestinationAdsetIds(profile)
    : [];
  const productionUrlTagsReadbackFixture = resolveProductionUrlTagsReadbackFixture(config, {
    required: false,
  });

  return {
    token_id: tokenId,
    external_account_id: clean(row.external_account_id),
    destination_group: destinationGroup,
    api_version: normalizeApiVersion(config.api_version || 'v25.0'),
    account_id: normalizeNumericId(config.account_id, 'account_id'),
    campaign_id: normalizeNumericId(config.campaign_id, 'campaign_id'),
    adset_id: normalizeNumericId(config.adset_id, 'adset_id'),
    page_id: normalizeNumericId(config.page_id, 'page_id'),
    instagram_user_id: normalizeNumericId(config.instagram_user_id, 'instagram_user_id'),
    allowed_link_hosts: allowedLinkHosts,
    landing_pages_by_creative_group: landingDefinition.pages,
    destination_type: clean(config.destination_type).toLowerCase(),
    whatsapp_destination_url: clean(config.whatsapp_destination_url),
    freshness_window_days: clampInteger(config.freshness_window_days, 7, 1, 90),
    carousel_native_campaign_id: clean(config.carousel_native_campaign_id),
    carousel_native_adset_id: clean(config.carousel_native_adset_id),
    carousel_native_adset_verified: config.carousel_native_adset_verified === true,
    carousel_native_route_active: config.carousel_native_route_active === true,
    tracking_contract: {
      url_tags: trackingContract.url_tags,
      profile_ref: trackingContract.profile_ref,
      profile_configured: trackingContract.profile_configured,
      destination_kind: trackingContract.destination_kind,
      website_event_requirement: trackingContract.website_event_requirement,
      offline_event_dataset_requirement: trackingContract.offline_event_dataset_requirement,
      reconciliation: trackingContract.reconciliation,
      staging_synthetic_fixture: trackingContract.staging_synthetic_fixture,
      production_url_tags_readback_fixture: productionUrlTagsReadbackFixture,
      // Source IDs remain private: they influence the binding hash but never
      // cross the Token Vault response boundary.
      ...(trackingContract.profile_configured ? {
        profile: {
          source_adset_id: normalizeNumericId(profile.source_adset_id, 'tracking_profile_source_adset_id'),
          destination_kind: normalizeDestinationKind(profile.destination_kind),
          website_event_requirement: normalizeTrackingRequirement(profile.website_event_requirement, 'website_event_requirement'),
          offline_event_dataset_requirement: normalizeTrackingRequirement(profile.offline_event_dataset_requirement, 'offline_event_dataset_requirement'),
          staging_synthetic_fixture: profile.staging_synthetic_fixture === true,
          // A Website tracking profile may opt into a verified native-carousel
          // route, but only through this private list. The raw IDs affect the
          // binding revision and never cross the public config boundary.
          authorized_destination_adset_ids: authorizedDestinationAdsetIds,
        },
      } : {}),
    },
  };
}

async function deriveTrackingBindingState(rows) {
  const bindings = [];
  const invalid = [];
  for (const row of safeArray(rows)) {
    try {
      const binding = buildTrackingBindingDestination(row);
      if (binding) bindings.push(binding);
    } catch (error) {
      const metadata = parseObject(row && row.metadata_json);
      const config = asObject(metadata.meta_ads_publish);
      invalid.push({
        token_id: clean(row && row.id),
        destination_group: clean(config.destination_group),
        errors: [{ error: clean(error && error.message) || 'tracking_binding_invalid' }],
      });
    }
  }
  bindings.sort((left, right) => (
    `${left.destination_group}:${left.token_id}`.localeCompare(`${right.destination_group}:${right.token_id}`)
  ));
  return {
    revision: await sha256(stableStringify(bindings)),
    // The public workflow configuration independently requires its expected
    // destination count. The server-side binding itself only needs one valid
    // authorized destination to prove that a particular mutating operation is
    // still tied to its current token configuration.
    ready: invalid.length === 0 && bindings.length > 0,
    invalid,
  };
}

async function currentTrackingBindingRevision(env) {
  const state = await deriveTrackingBindingState(await listMetaAdsPublishConfigRows(env));
  if (!state.ready) {
    throw failure('tracking_binding_not_ready', { classification: 'permanent', http_status: 409 });
  }
  return state.revision;
}

async function assertCurrentRunTrackingBinding(run, env) {
  const expected = await currentTrackingBindingRevision(env);
  if (clean(run.config_revision).toLowerCase() !== expected) {
    throw failure('run_tracking_binding_stale', { classification: 'permanent', http_status: 409 });
  }
}

async function createOrResumeRun(request, env, requestId) {
  const body = await readObject(request);
  const workflowContractRevision = clean(body.workflow_contract_revision);
  if (workflowContractRevision !== WORKFLOW_CONTRACT_REVISION) {
    return response({ ok: false, error: 'workflow_contract_revision_unsupported', requestId }, 409);
  }
  const configRevision = clean(body.config_revision).toLowerCase();
  const trackingBindingRevision = clean(body.tracking_binding_revision).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(configRevision)) {
    return response({ ok: false, error: 'config_revision_invalid', requestId }, 400);
  }
  if (!/^[a-f0-9]{64}$/.test(trackingBindingRevision)) {
    return response({ ok: false, error: 'tracking_binding_revision_invalid', requestId }, 400);
  }
  if (trackingBindingRevision !== configRevision) {
    return response({ ok: false, error: 'tracking_binding_revision_mismatch', requestId }, 409);
  }
  let currentBindingRevision;
  try {
    currentBindingRevision = await currentTrackingBindingRevision(env);
  } catch (error) {
    const normalized = normalizeFailure(error);
    return response({ ok: false, error: normalized.message || 'tracking_binding_not_ready', requestId }, normalized.http_status || 409);
  }
  if (configRevision !== currentBindingRevision) {
    return response({ ok: false, error: 'tracking_binding_revision_stale', requestId }, 409);
  }
  const files = normalizeFiles(body.files);
  if (!files.length) return response({ ok: false, error: 'files_required', requestId }, 400);
  const batchFingerprint = body.batch_fingerprint
    ? requireHash(body.batch_fingerprint, 'batch_fingerprint')
    : await sha256(stableStringify({ configRevision, trackingBindingRevision, workflowContractRevision, files }));

  const requestHash = await sha256(stableStringify({
    batchFingerprint,
    configRevision,
    trackingBindingRevision,
    workflowContractRevision,
    files,
  }));
  const existing = await dbFirst(env,
    `SELECT * FROM meta_ads_publish_runs WHERE batch_fingerprint = ?`,
    batchFingerprint,
  );
  if (existing) {
    if (clean(existing.request_hash) !== requestHash) {
      return response({ ok: false, error: 'batch_fingerprint_conflict', requestId }, 409);
    }
    return response({ ok: true, replayed: true, run: serializeRun(existing), requestId });
  }

  const now = nowIso();
  const runId = `map_${batchFingerprint.slice(0, 24)}`;
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  await dbRun(env,
    `INSERT INTO meta_ads_publish_runs (
      id, batch_fingerprint, request_hash, workflow_execution_id, config_revision,
      status, files_json, heartbeat_at, lock_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'acquired', ?, ?, ?, ?, ?)`,
    runId,
    batchFingerprint,
    requestHash,
    nullable(body.workflow_execution_id),
    configRevision,
    JSON.stringify(files),
    now,
    expiresAt,
    now,
    now,
  );
  await acquireLocks(env, runId, `run:${runId}`, [`batch:${batchFingerprint}`, ...files.map((file) => `drive:${file.id}`)]);
  const created = await loadRun(env, runId);
  return response({ ok: true, replayed: false, run: serializeRun(created), requestId }, 201);
}

async function getRun(runId, env, requestId) {
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: 'run_not_found', requestId }, 404);
  const jobs = await dbAll(env,
    `SELECT id, operation_key, destination_group, creative_group_key, action,
            resource_key, status, previous_state_json, result_json, error_json,
            created_at, updated_at
       FROM meta_ads_publish_jobs WHERE run_id = ? ORDER BY created_at, id`,
    runId,
  );
  const operations = await dbAll(env,
    `SELECT operation_key, action, status, attempt_count, result_json, error_json,
            meta_trace_id, rate_usage_json, created_at, updated_at
       FROM meta_ads_publish_operations WHERE run_id = ? ORDER BY created_at, id`,
    runId,
  );
  return response({
    ok: true,
    run: serializeRun(run),
    jobs: jobs.map(serializeJob),
    operations: operations.map(serializeOperation),
    requestId,
  });
}

async function updateRun(runId, request, env, requestId) {
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: 'run_not_found', requestId }, 404);
  const body = await readObject(request);
  const allowedStatuses = new Set([
    'processing', 'creatives_ready', 'staged', 'meta_completed_drive_pending',
    'completed', 'failed', 'rolled_back', 'reconciliation_required',
  ]);
  const status = clean(body.status);
  if (!allowedStatuses.has(status)) {
    return response({ ok: false, error: 'invalid_run_status', requestId }, 400);
  }
  const now = nowIso();
  await dbRun(env,
    `UPDATE meta_ads_publish_runs
        SET status = ?, summary_json = ?, error_json = ?, heartbeat_at = ?,
            lock_expires_at = ?, updated_at = ?
      WHERE id = ?`,
    status,
    limitedJson(body.summary),
    limitedJson(body.error),
    now,
    new Date(Date.now() + LOCK_TTL_MS).toISOString(),
    now,
    runId,
  );
  if (TERMINAL_RUN_STATES.has(status)) await releaseRunLocks(env, runId);
  return getRun(runId, env, requestId);
}

async function heartbeatRun(runId, env, requestId) {
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: 'run_not_found', requestId }, 404);
  if (TERMINAL_RUN_STATES.has(clean(run.status))) {
    return response({ ok: false, error: 'run_already_terminal', requestId }, 409);
  }
  const now = nowIso();
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  await dbRun(env,
    `UPDATE meta_ads_publish_runs SET heartbeat_at = ?, lock_expires_at = ?, updated_at = ? WHERE id = ?`,
    now, expiresAt, now, runId,
  );
  await dbRun(env,
    `UPDATE meta_ads_publish_locks SET heartbeat_at = ?, expires_at = ?, updated_at = ? WHERE run_id = ?`,
    now, expiresAt, now, runId,
  );
  return response({ ok: true, run_id: runId, heartbeat_at: now, lock_expires_at: expiresAt, requestId });
}

async function claimEvent(runId, request, env, requestId) {
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: 'run_not_found', requestId }, 404);
  const body = await readObject(request);
  const eventKey = requireKey(body.event_key, 'event_key');
  const existing = await dbFirst(env,
    `SELECT id, status, payload_json, created_at, updated_at
       FROM meta_ads_publish_events WHERE run_id = ? AND event_key = ?`,
    runId, eventKey,
  );
  if (existing) {
    return response({ ok: true, claimed: false, replayed: true, event: serializeEvent(existing), requestId });
  }
  const now = nowIso();
  const id = crypto.randomUUID();
  await dbRun(env,
    `INSERT INTO meta_ads_publish_events (id, run_id, event_key, status, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, 'claimed', ?, ?, ?)`,
    id, runId, eventKey, limitedJson(body.payload), now, now,
  );
  return response({
    ok: true,
    claimed: true,
    replayed: false,
    event: { id, event_key: eventKey, status: 'claimed', payload: asObject(body.payload) },
    requestId,
  }, 201);
}

async function executeOperation(context) {
  const { runId, request, env, requestId, decryptToken, encryptToken, writeAudit } = context;
  const run = await loadRun(env, runId);
  if (!run) return response({ ok: false, error: 'run_not_found', requestId }, 404);
  if (TERMINAL_RUN_STATES.has(clean(run.status))) {
    return response({ ok: false, error: 'run_already_terminal', status: run.status, requestId }, 409);
  }

  const parsed = await readOperationRequest(request);
  if (parsed.error) return response({ ok: false, error: parsed.error, requestId }, parsed.status || 400);
  const body = parsed.body;
  const action = clean(body.action);
  if (!ALLOWED_ACTIONS.has(action)) return response({ ok: false, error: 'invalid_action', requestId }, 400);
  const operationKey = requireKey(body.operation_key, 'operation_key');
  const requestHash = await sha256(stableStringify(operationHashInput(body, parsed.file)));
  if (body.request_hash && clean(body.request_hash) !== requestHash) {
    return response({ ok: false, error: 'request_hash_mismatch', request_hash: requestHash, requestId }, 400);
  }

  const existing = await dbFirst(env,
    `SELECT * FROM meta_ads_publish_operations WHERE operation_key = ?`,
    operationKey,
  );
  if (existing) {
    if (clean(existing.request_hash) !== requestHash) {
      return response({ ok: false, error: 'operation_key_conflict', requestId }, 409);
    }
    // A completed tracking reconciliation is not a timeless fact: the
    // configured ad set can drift after the journal entry was written.  Its
    // exact request is deliberately reopened below under the same resource
    // lock so `ensure` performs a fresh GET/(conditional POST)/GET cycle.
    // Both conversion reconciliation and the authorized paused-creative
    // readback attest mutable remote state. A completed journal row therefore
    // cannot replace the current Graph check on a same-key retry.
    if (clean(existing.status) === 'completed' &&
        action !== 'ensure_adset_conversion_contract' &&
        action !== 'read_authorized_creative_url_tags_contract') {
      return response({ ok: true, replayed: true, operation: serializeOperation(existing), requestId });
    }
    if (clean(existing.status) === 'in_progress') {
      return response({ ok: false, error: 'operation_in_progress', operation: serializeOperation(existing), requestId }, 409);
    }
  }

  const resources = deriveResourceKeys(action, body);
  try {
    await acquireLocks(env, runId, operationKey, resources);
  } catch (error) {
    return response({ ok: false, error: clean(error.message) || 'resource_locked', requestId }, 409);
  }

  const now = nowIso();
  const operationId = existing?.id || crypto.randomUUID();
  if (existing) {
    await dbRun(env,
      `UPDATE meta_ads_publish_operations
          SET status = 'in_progress', error_json = '{}', updated_at = ?
        WHERE id = ?`,
      now, operationId,
    );
  } else {
    await dbRun(env,
      `INSERT INTO meta_ads_publish_operations (
        id, run_id, operation_key, request_hash, action, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?)`,
      operationId, runId, operationKey, requestHash, action, now, now,
    );
  }

  try {
    const graphContext = {
      env,
      runId,
      operationKey,
      action,
      decryptToken,
      encryptToken,
      file: parsed.file,
      attempts: 0,
      rateUsage: {},
      traceId: '',
    };
    // A run is an authorization snapshot, not a blanket permit for a later
    // configuration. Re-check the static binding immediately before every
    // Graph mutation so a later token/profile/ad-set change cannot be used by
    // a long-lived run.
    if (MUTATING_ACTIONS.has(action)) {
      await assertCurrentRunTrackingBinding(run, env);
    }
    const result = await performOperation(action, body, graphContext);
    const completedAt = nowIso();
    await dbRun(env,
      `UPDATE meta_ads_publish_operations
          SET status = 'completed', attempt_count = ?, result_json = ?, error_json = '{}',
              meta_trace_id = ?, rate_usage_json = ?, updated_at = ?
        WHERE id = ?`,
      graphContext.attempts,
      limitedJson(result),
      nullable(graphContext.traceId),
      limitedJson(graphContext.rateUsage),
      completedAt,
      operationId,
    );
    await releaseOperationLocks(env, runId, operationKey);
    await writeAudit(env, {
      event: `meta_ads_publish.${action}`,
      status: 'ok',
      requestId,
      metadata: { run_id: runId, operation_key: operationKey, attempts: graphContext.attempts },
    });
    const saved = await dbFirst(env, `SELECT * FROM meta_ads_publish_operations WHERE id = ?`, operationId);
    return response({ ok: true, replayed: false, operation: serializeOperation(saved), requestId });
  } catch (error) {
    const normalized = normalizeFailure(error);
    const status = normalized.ambiguous ? 'reconciliation_required' : 'failed';
    await dbRun(env,
      `UPDATE meta_ads_publish_operations
          SET status = ?, attempt_count = attempt_count + 1, error_json = ?,
              meta_trace_id = ?, updated_at = ?
        WHERE id = ?`,
      status,
      limitedJson(normalized),
      nullable(normalized.fbtrace_id),
      nowIso(),
      operationId,
    );
    if (normalized.ambiguous) {
      await dbRun(env,
        `UPDATE meta_ads_publish_runs SET status = 'reconciliation_required', error_json = ?, updated_at = ? WHERE id = ?`,
        limitedJson(normalized), nowIso(), runId,
      );
    }
    await releaseOperationLocks(env, runId, operationKey);
    await writeAudit(env, {
      event: `meta_ads_publish.${action}`,
      status,
      requestId,
      metadata: {
        run_id: runId,
        operation_key: operationKey,
        error_class: normalized.classification,
        code: normalized.code,
        subcode: normalized.error_subcode,
        fbtrace_id: normalized.fbtrace_id,
      },
    });
    return response({ ok: false, error: 'meta_operation_failed', detail: normalized, requestId }, normalized.http_status || 502);
  }
}

async function performOperation(action, body, context) {
  if (action === 'list_ads') return listAds(body, context);
  if (action === 'upload_image') return uploadImage(body, context);
  if (action === 'start_video_upload') return startVideoUpload(body, context);
  if (action === 'transfer_video_chunk') return transferVideoChunk(body, context);
  if (action === 'finish_video_upload') return finishVideoUpload(body, context);
  if (action === 'get_video_status') return getVideoStatus(body, context);
  if (action === 'create_creative') return createCreative(body, context);
  if (action === 'get_creative') return getCreative(body, context);
  if (action === 'get_ad') return getAd(body, context);
  if (action === 'get_adset') return getAdset(body, context);
  if (action === 'read_adset_conversion_contract') return readAdsetConversionContract(body, context);
  if (action === 'read_authorized_creative_url_tags_contract') return readAuthorizedCreativeUrlTagsContract(body, context);
  if (action === 'ensure_adset_conversion_contract') return ensureAdsetConversionContract(body, context);
  if (action === 'rollback_adset_conversion_contract') return rollbackAdsetConversionContract(body, context);
  if (action === 'get_campaign') return getCampaign(body, context);
  if (action === 'create_campaign') return createCampaign(body, context);
  if (action === 'create_adset') return createAdset(body, context);
  if (action === 'promote_native_carousel_route') return promoteNativeCarouselRoute(body, context);
  if (action === 'stage_batch') return stageBatch(body, context);
  if (action === 'activate_batch') return activateBatch(body, context);
  if (action === 'rollback_batch') return rollbackBatch(body, context);
  throw failure('invalid_action', { classification: 'permanent', http_status: 400 });
}

async function listAds(body, context) {
  const auth = await resolveGraphAuth(body, context);
  let url = graphUrl(auth.apiVersion, `act_${auth.accountId}/ads`, {
    fields: AD_INVENTORY_FIELDS,
    limit: '500',
  });
  const ads = [];
  let pages = 0;
  while (url) {
    pages += 1;
    if (pages > MAX_AD_PAGES) throw failure('ad_inventory_page_limit', { classification: 'permanent', http_status: 409 });
    const result = await graphRequest(url, { method: 'GET' }, auth, context);
    ads.push(...safeArray(result.body.data));
    if (ads.length > MAX_ADS) throw failure('ad_inventory_item_limit', { classification: 'permanent', http_status: 409 });
    url = validatePagingUrl(result.body?.paging?.next, auth.apiVersion);
  }
  return { data: ads, page_count: pages, item_count: ads.length, truncated: false };
}

async function readAdsetPlacements(body, adsetId, context) {
  const auth = await resolveGraphAuth(body, context);
  const result = await graphRequest(
    graphUrl(auth.apiVersion, adsetId, { fields: ADSET_PLACEMENT_FIELDS }),
    { method: 'GET' },
    auth,
    context,
  );
  const adset = asObject(result.body);
  const campaign = asObject(adset.campaign);
  return sanitizeGraphValue({
    targeting: asObject(adset.targeting),
    // This comes from the live ad set/campaign, not from a manually copied
    // Token Vault field. Build Jobs uses it to choose a CTA the destination
    // contract can actually stage.
    campaign_objective: clean(campaign.objective).toUpperCase(),
    optimization_goal: clean(adset.optimization_goal).toUpperCase(),
    destination_type: clean(adset.destination_type).toUpperCase(),
    // Never pass raw IDs from promoted_object into n8n execution history. The
    // publisher only needs a boolean contract to decide whether a website ad
    // may proceed; the Token Vault remains the boundary for identifiers.
    conversion_tracking: summarizeAdsetConversionTracking(adset),
  });
}

async function uploadImage(body, context) {
  const auth = await resolveGraphAuth(body, context);
  if (!(context.file instanceof Blob)) throw failure('image_file_required', { classification: 'permanent', http_status: 400 });
  if (context.file.size <= 0 || context.file.size > MAX_UPLOAD_BYTES) {
    throw failure('image_size_invalid', { classification: 'permanent', http_status: 413 });
  }
  const form = new FormData();
  form.append('filename', context.file, clean(body.file_name) || 'creative-image.jpg');
  const result = await graphRequest(
    graphUrl(auth.apiVersion, `act_${auth.accountId}/adimages`),
    { method: 'POST', body: form },
    auth,
    context,
  );
  return sanitizeGraphValue(result.body);
}

// Video uploads use Meta's resumable protocol. Keeping it inside the Token
// Vault preserves the existing token boundary and makes each phase journaled
// and idempotent by the normal operation-key mechanism.
async function startVideoUpload(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const fileSize = normalizeVideoFileSize(body.file_size);
  const form = new FormData();
  form.append('upload_phase', 'start');
  form.append('file_size', String(fileSize));
  const result = await graphRequest(
    graphVideoUrl(auth.apiVersion, `act_${auth.accountId}/advideos`),
    { method: 'POST', body: form },
    auth,
    context,
  );
  return normalizeVideoUploadResponse(result.body, 'start');
}

async function transferVideoChunk(body, context) {
  const auth = await resolveGraphAuth(body, context);
  if (!(context.file instanceof Blob)) throw failure('video_chunk_required', { classification: 'permanent', http_status: 400 });
  if (context.file.size <= 0 || context.file.size > MAX_VIDEO_CHUNK_BYTES) {
    throw failure('video_chunk_size_invalid', { classification: 'permanent', http_status: 413 });
  }
  const uploadSessionId = normalizeUploadSessionId(body.upload_session_id);
  const startOffset = normalizeVideoOffset(body.start_offset, 'start_offset');
  const expectedEndOffset = startOffset + context.file.size;
  if (expectedEndOffset > MAX_VIDEO_BYTES) throw failure('video_offset_invalid', { classification: 'permanent', http_status: 400 });
  const form = new FormData();
  form.append('upload_phase', 'transfer');
  form.append('upload_session_id', uploadSessionId);
  form.append('start_offset', String(startOffset));
  form.append('video_file_chunk', context.file, clean(body.file_name) || `video-${startOffset}.part`);
  const result = await graphRequest(
    graphVideoUrl(auth.apiVersion, `act_${auth.accountId}/advideos`),
    { method: 'POST', body: form },
    auth,
    context,
  );
  const normalized = normalizeVideoUploadResponse(result.body, 'transfer');
  const returnedStart = normalizeVideoOffset(normalized.start_offset, 'returned_start_offset');
  const returnedEnd = normalizeVideoOffset(normalized.end_offset, 'returned_end_offset');
  if (returnedStart < startOffset || returnedStart > expectedEndOffset || returnedEnd < returnedStart || returnedEnd > MAX_VIDEO_BYTES) {
    throw failure('video_offsets_invalid', { classification: 'permanent', http_status: 502 });
  }
  return normalized;
}

async function finishVideoUpload(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const uploadSessionId = normalizeUploadSessionId(body.upload_session_id);
  const form = new FormData();
  form.append('upload_phase', 'finish');
  form.append('upload_session_id', uploadSessionId);
  const title = clean(body.title);
  if (title) form.append('title', title.slice(0, 255));
  const result = await graphRequest(
    graphVideoUrl(auth.apiVersion, `act_${auth.accountId}/advideos`),
    { method: 'POST', body: form },
    auth,
    context,
  );
  return normalizeVideoUploadResponse(result.body, 'finish');
}

async function getVideoStatus(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const videoId = normalizeNumericId(body.object_id || body.video_id, 'video_id');
  const result = await graphRequest(
    graphUrl(auth.apiVersion, videoId, { fields: 'id,status,thumbnails' }),
    { method: 'GET' },
    auth,
    context,
  );
  const value = sanitizeGraphValue(result.body);
  const videoStatus = clean(value?.status?.video_status || value?.status?.status || value?.video_status).toLowerCase();
  return { ...value, video_status: videoStatus, ready: videoStatus === 'ready' };
}

function assertWorkflowContractRevision(value) {
  if (clean(value) !== WORKFLOW_CONTRACT_REVISION) {
    throw failure('workflow_contract_revision_unsupported', { classification: 'permanent', http_status: 409 });
  }
}

function resolveConfiguredNativeCarouselAdsetId(config) {
  // An alternate route is never inferred from a caller-supplied ID. It exists
  // only while the private configuration names it and explicitly keeps the
  // route both verified and active.
  if (config.carousel_native_adset_verified !== true || config.carousel_native_route_active !== true) {
    return '';
  }
  return normalizeNumericId(config.carousel_native_adset_id, 'carousel_native_adset_id');
}

function normalizeProfileAuthorizedDestinationAdsetIds(value) {
  const profile = asObject(value);
  if (profile.authorized_destination_adset_ids === undefined || profile.authorized_destination_adset_ids === null) {
    return [];
  }
  if (!Array.isArray(profile.authorized_destination_adset_ids)) {
    throw failure('tracking_profile_authorized_destination_adsets_invalid', {
      classification: 'permanent', http_status: 409,
    });
  }
  return [...new Set(profile.authorized_destination_adset_ids.map((adsetId) =>
    normalizeNumericId(adsetId, 'tracking_profile_authorized_destination_adset_id'),
  ))].sort();
}

function authorizeConfiguredDestinationAdset(body, config, destinationKind) {
  // `destination_kind` is supplied by the workflow and therefore cannot be
  // allowed to choose a less restrictive authorization branch. The private
  // destination type is the authority for whether Website tracking is
  // mandatory or the explicit Click-to-WhatsApp exemption applies.
  const configuredDestinationKind = normalizeDestinationKind(config.destination_type);
  if (destinationKind !== configuredDestinationKind) {
    throw failure('destination_kind_not_authorized_for_token', {
      classification: 'auth', http_status: 403,
    });
  }
  const requested = normalizeNumericId(body.destination_adset_id, 'destination_adset_id');
  const configured = normalizeNumericId(config.adset_id, 'configured_adset_id');
  if (requested === configured) return requested;

  const nativeCarouselAdsetId = resolveConfiguredNativeCarouselAdsetId(config);
  if (requested !== nativeCarouselAdsetId) {
    throw failure('destination_adset_not_authorized_for_token', { classification: 'auth', http_status: 403 });
  }

  // The native carousel route may be a different Website ad set. Its
  // conversion contract is only inherited when the selected private tracking
  // profile explicitly lists that exact alternate. WhatsApp has no Website
  // conversion profile, but still needs the verified/active private route.
  if (destinationKind === 'website') {
    const profile = resolveAuthorizedTrackingProfile(config, body.profile_ref);
    if (!normalizeProfileAuthorizedDestinationAdsetIds(
      asObject(asObject(config.tracking_profiles)[profile.profile_ref]),
    ).includes(requested)) {
      throw failure('website_tracking_profile_destination_adset_not_authorized', {
        classification: 'auth', http_status: 403,
      });
    }
  }
  return requested;
}

function resolveAuthorizedWebsiteTrackingMetadata(body, config) {
  const contract = normalizeTrackingContract(config.tracking_contract, config.tracking_profiles, config.adset_id);
  if (!contract.profile_configured || contract.destination_kind !== 'website' ||
      contract.reconciliation !== TRACKING_RECONCILIATION_MODE || !contract.url_tags_configured) {
    throw failure('website_tracking_contract_not_configured', { classification: 'permanent', http_status: 409 });
  }
  const profile = resolveAuthorizedTrackingProfile(config, body.profile_ref);
  const requestedUrlTags = normalizeUrlTags(body.url_tags, { required: true });
  if (requestedUrlTags !== contract.url_tags) {
    throw failure('creative_url_tags_not_authorized', { classification: 'auth', http_status: 403 });
  }
  return { profile_ref: profile.profile_ref, url_tags: requestedUrlTags };
}

function assertNoTrackingMetadataForWhatsApp(body) {
  if (clean(body.profile_ref)) {
    throw failure('whatsapp_tracking_profile_forbidden', { classification: 'permanent', http_status: 400 });
  }
  if (Object.prototype.hasOwnProperty.call(asObject(body), 'url_tags') && String(body.url_tags ?? '') !== '') {
    throw failure('whatsapp_url_tags_forbidden', { classification: 'permanent', http_status: 400 });
  }
}

function authorizeTrackingMutationMetadata(body, config) {
  assertWorkflowContractRevision(body.workflow_contract_revision);
  const destinationKind = normalizeDestinationKind(body.destination_kind);
  const destinationAdsetId = authorizeConfiguredDestinationAdset(body, config, destinationKind);
  if (destinationKind === 'website') {
    return {
      destination_adset_id: destinationAdsetId,
      destination_kind: destinationKind,
      ...resolveAuthorizedWebsiteTrackingMetadata(body, config),
    };
  }
  assertNoTrackingMetadataForWhatsApp(body);
  return {
    destination_adset_id: destinationAdsetId,
    destination_kind: destinationKind,
    profile_ref: '',
    url_tags: '',
  };
}

function inferCreativeDestinationKind(payload) {
  const creative = asObject(payload);
  const flexibleUrl = clean(safeArray(asObject(creative.asset_feed_spec).link_urls)[0]?.website_url);
  const carouselUrl = clean(asObject(asObject(creative.object_story_spec).link_data).link);
  const destinationUrl = flexibleUrl || carouselUrl;
  try {
    const parsed = new URL(destinationUrl);
    if (parsed.protocol !== 'https:') throw new Error('creative_destination_protocol_invalid');
    return isWhatsAppHostname(parsed.hostname) ? 'whatsapp' : 'website';
  } catch {
    throw failure('creative_destination_kind_undetermined', { classification: 'permanent', http_status: 400 });
  }
}

function assertCreativeTrackingAuthorization(body, auth, payload) {
  const metadata = authorizeTrackingMutationMetadata(body, auth.config);
  if (inferCreativeDestinationKind(payload) !== metadata.destination_kind) {
    throw failure('creative_destination_kind_mismatch', { classification: 'permanent', http_status: 409 });
  }
  const hasPayloadUrlTags = Object.prototype.hasOwnProperty.call(asObject(payload), 'url_tags');
  if (metadata.destination_kind === 'website') {
    if (!hasPayloadUrlTags) {
      throw failure('website_creative_url_tags_required', { classification: 'permanent', http_status: 400 });
    }
    const payloadUrlTags = normalizeUrlTags(payload.url_tags, { required: true });
    if (payloadUrlTags !== metadata.url_tags) {
      throw failure('creative_url_tags_payload_mismatch', { classification: 'permanent', http_status: 409 });
    }
  } else if (hasPayloadUrlTags && String(payload.url_tags ?? '') !== '') {
    throw failure('whatsapp_url_tags_forbidden', { classification: 'permanent', http_status: 400 });
  }
  return metadata;
}

async function assertStagedCreativeTracking(auth, creativeId, metadata, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, creativeId, { fields: CREATIVE_READ_FIELDS.join(',') }),
    { method: 'GET' },
    auth,
    context,
  );
  const creative = asObject(result.body);
  if (normalizeNumericId(creative.id, 'creative_readback_id') !== creativeId) {
    throw failure('creative_readback_identity_mismatch', { classification: 'permanent', http_status: 502 });
  }
  if (inferCreativeDestinationKind(creative) !== metadata.destination_kind) {
    throw failure('stage_creative_destination_kind_mismatch', { classification: 'permanent', http_status: 409 });
  }
  if (metadata.destination_kind === 'website') {
    if (normalizeUrlTags(creative.url_tags, { required: true }) !== metadata.url_tags) {
      throw failure('creative_url_tags_readback_mismatch', { classification: 'permanent', http_status: 409 });
    }
  } else if (clean(creative.url_tags)) {
    throw failure('whatsapp_creative_url_tags_readback_mismatch', { classification: 'permanent', http_status: 409 });
  }
}

async function createCreative(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const payload = validateCreativePayload(body.payload, context.operationKey);
  assertCreativeTrackingAuthorization(body, auth, payload);
  try {
    const result = await graphRequest(
      graphUrl(auth.apiVersion, `act_${auth.accountId}/adcreatives`),
      jsonRequest('POST', payload),
      auth,
      context,
    );
    return sanitizeGraphValue(result.body);
  } catch (error) {
    if (!normalizeFailure(error).ambiguous) throw error;
    const reconciled = await findCreativeByOperationName(auth, payload.name, context);
    if (reconciled) return { ...reconciled, reconciled_after_ambiguous_response: true };
    throw error;
  }
}

async function getCreative(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const creativeId = normalizeNumericId(body.object_id, 'object_id');
  const fields = CREATIVE_READ_FIELDS.join(',');
  const result = await graphRequest(graphUrl(auth.apiVersion, creativeId, { fields }), { method: 'GET' }, auth, context);
  return sanitizeGraphValue(result.body);
}

async function getAd(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const adId = normalizeNumericId(body.object_id, 'object_id');
  return readAd(auth, adId, context);
}

async function getAdset(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const adsetId = normalizeNumericId(body.object_id, 'object_id');
  const result = await graphRequest(
    graphUrl(auth.apiVersion, adsetId, { fields: ADSET_READ_FIELDS }),
    { method: 'GET' },
    auth,
    context,
  );
  return sanitizeGraphValue(result.body);
}

// This dedicated diagnostic action persists only a reduced conversion
// contract. It avoids journaling targeting, names, budgets, raw Pixel IDs and
// raw dataset IDs that the generic get_adset readback would otherwise retain.
async function readAdsetConversionContract(body, context) {
  const auth = await resolveGraphAuth(body, context);
  // This endpoint is used by the deployment readback. Treat it as a narrow
  // authorized diagnostic, never as a generic ad-set discovery primitive.
  const adsetId = authorizeConfiguredAdset(body, auth.config);
  const result = await graphRequest(
    graphUrl(auth.apiVersion, adsetId, { fields: ADSET_CONVERSION_CONTRACT_FIELDS }),
    { method: 'GET' },
    auth,
    context,
  );
  return summarizeAdsetConversionTracking(asObject(result.body));
}

function assertAuthorizedCreativeUrlTagsReadbackRequest(body) {
  const allowed = new Set([
    'action',
    'operation_key',
    'token_id',
    'account_id',
    'api_version',
    'request_hash',
  ]);
  for (const key of Object.keys(asObject(body))) {
    if (!allowed.has(key)) {
      throw failure('authorized_creative_url_tags_contract_request_invalid', {
        classification: 'permanent', http_status: 400,
      });
    }
  }
}

function resolveProductionUrlTagsReadbackFixture(config, { required = true } = {}) {
  const rawContract = asObject(asObject(config).tracking_contract);
  const fixture = asObject(rawContract.production_url_tags_readback_fixture);
  if (!Object.keys(fixture).length && !required) return null;
  let adId;
  let creativeId;
  try {
    adId = normalizeNumericId(fixture.ad_id, 'production_url_tags_readback_fixture_ad_id');
    creativeId = normalizeNumericId(fixture.creative_id, 'production_url_tags_readback_fixture_creative_id');
  } catch {
    throw failure('authorized_creative_url_tags_readback_fixture_invalid', {
      classification: 'permanent', http_status: 409,
    });
  }
  return { ad_id: adId, creative_id: creativeId };
}

function resolveAuthorizedCreativeUrlTagsReadbackContract(config) {
  const contract = normalizeTrackingContract(config.tracking_contract, config.tracking_profiles, config.adset_id);
  if (!contract.profile_configured || contract.destination_kind !== 'website' ||
      contract.reconciliation !== TRACKING_RECONCILIATION_MODE || !contract.url_tags_configured) {
    throw failure('authorized_creative_url_tags_contract_not_configured', {
      classification: 'permanent', http_status: 409,
    });
  }
  return {
    destination_kind: 'website',
    url_tags: contract.url_tags,
    fixture: resolveProductionUrlTagsReadbackFixture(config),
  };
}

function redactAuthorizedCreativeUrlTagsReadbackFailure(error) {
  const normalized = normalizeFailure(error);
  return failure('authorized_creative_url_tags_contract_readback_failed', {
    classification: normalized.classification || 'unknown',
    retryable: Boolean(normalized.retryable),
    ambiguous: Boolean(normalized.ambiguous),
    http_status: Number(normalized.http_status || 502),
    code: Number(normalized.code || 0),
    error_subcode: Number(normalized.error_subcode || 0),
    // This dedicated readback has a deliberately boolean-only evidence
    // surface. Keep Graph trace identifiers out of its journal/error record
    // alongside the private fixture IDs and raw URL tags.
    fbtrace_id: '',
  });
}

// A production diagnostic must not accept ad, creative or URL-tag selectors
// from Orb. The fixture is resolved entirely from the private credential
// configuration and only fixed booleans leave this boundary.
async function readAuthorizedCreativeUrlTagsContract(body, context) {
  assertAuthorizedCreativeUrlTagsReadbackRequest(body);
  const auth = await resolveGraphAuth(body, context);
  const contract = resolveAuthorizedCreativeUrlTagsReadbackContract(auth.config);
  try {
    const adReadback = await graphRequest(
      graphUrl(auth.apiVersion, contract.fixture.ad_id, { fields: 'id,status,creative{id}' }),
      { method: 'GET' },
      auth,
      context,
    );
    const ad = asObject(adReadback.body);
    if (normalizeNumericId(ad.id, 'authorized_creative_fixture_ad_readback_id') !== contract.fixture.ad_id ||
        clean(ad.status).toUpperCase() !== 'PAUSED' ||
        normalizeNumericId(asObject(ad.creative).id, 'authorized_creative_fixture_ad_creative_id') !== contract.fixture.creative_id) {
      throw failure('authorized_creative_url_tags_fixture_not_paused_or_matched', {
        classification: 'permanent', http_status: 409,
      });
    }
    const creativeReadback = await graphRequest(
      graphUrl(auth.apiVersion, contract.fixture.creative_id, { fields: 'id,url_tags' }),
      { method: 'GET' },
      auth,
      context,
    );
    const creative = asObject(creativeReadback.body);
    if (normalizeNumericId(creative.id, 'authorized_creative_fixture_creative_readback_id') !== contract.fixture.creative_id ||
        normalizeUrlTags(creative.url_tags, { required: true }) !== contract.url_tags) {
      throw failure('authorized_creative_url_tags_fixture_readback_mismatch', {
        classification: 'permanent', http_status: 409,
      });
    }
  } catch (error) {
    throw redactAuthorizedCreativeUrlTagsReadbackFailure(error);
  }
  return {
    destination_kind: 'website',
    creative_url_tags: {
      required: true,
      paused_fixture_verified: true,
      exact_match: true,
    },
  };
}

// Reconcile the conversion fields of an existing, authorized ad set from a
// separately authorized source ad set.  The Orb never receives the source
// ID, Pixel ID, custom-conversion ID or offline dataset ID: it asks only for a
// profile reference and gets back a redacted attestation.
async function ensureAdsetConversionContract(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const destinationKind = normalizeDestinationKind(body.destination_kind);
  const targetAdsetId = authorizeConfiguredTrackingAdset(body, auth.config, destinationKind);

  // A WhatsApp handoff is deliberately outside the website-conversion
  // contract.  Still authorize the configured target before returning the
  // no-op attestation so a caller cannot use this action as an ad-set probe.
  if (destinationKind === 'whatsapp') {
    if (clean(body.profile_ref)) throw failure('whatsapp_tracking_profile_forbidden');
    return {
      status: 'not_applicable',
      destination_kind: 'whatsapp',
      website_event: { configured: false, required: false },
      offline_event_dataset: { configured: false, required: false },
      tracking_fingerprint: '',
      snapshot_id: '',
      graph_mutation: 'none',
    };
  }

  if (destinationKind !== 'website') throw failure('destination_kind_invalid');
  const profile = resolveAuthorizedTrackingProfile(auth.config, body.profile_ref);
  const source = await readAdsetConversionState(auth, profile.source_adset_id, context);
  const target = profile.source_adset_id === targetAdsetId
    ? source
    : await readAdsetConversionState(auth, targetAdsetId, context);

  assertAdsetAccountAuthorized(source, target, auth.accountId);
  assertWebsiteTrackingCompatibility(source, target, profile);
  const desired = projectAuthorizedTrackingPromotedObject(source, target, profile);
  const existingSnapshot = await loadTrackingSnapshotByOperation(context.env, context.operationKey);
  if (existingSnapshot) {
    await assertTrackingSnapshotContract(existingSnapshot, {
      auth,
      targetAdsetId,
      profile,
      desiredTrackingPromotedObject: desired.tracking_promoted_object,
      context,
    });
  }
  const sourceSummary = summarizeAdsetConversionTracking(source);
  const targetSummary = summarizeAdsetConversionTracking(target);
  const matches = trackingPromotedObjectMatches(target.promoted_object, desired.tracking_promoted_object, profile);
  const state = trackingAttestation({
    destinationKind,
    profile,
    sourceSummary,
    targetSummary,
    trackingPromotedObject: asObject(target.promoted_object),
    status: matches ? 'verified' : 'pending',
  });
  if (matches) {
    if (existingSnapshot) await markTrackingSnapshotReconciled(context.env, existingSnapshot.id);
    return { ...state, graph_mutation: 'none', snapshot_id: clean(existingSnapshot?.id) };
  }

  if (existingSnapshot) {
    await assertTrackingSnapshotRetryIsSafe(existingSnapshot, target.promoted_object, context);
  }

  const snapshotId = await captureTrackingSnapshot({
    auth,
    targetAdsetId,
    profile,
    previousPromotedObject: asObject(target.promoted_object),
    desiredTrackingPromotedObject: desired.tracking_promoted_object,
    existingSnapshot,
    context,
  });
  try {
    await updateAdsetTrackingWithReconciliation(
      auth,
      targetAdsetId,
      desired.full_promoted_object,
      profile,
      context,
    );
    const readback = await readAdsetConversionState(auth, targetAdsetId, context);
    if (!trackingPromotedObjectMatches(readback.promoted_object, desired.tracking_promoted_object, profile)) {
      throw failure('adset_conversion_readback_mismatch', {
        classification: 'permanent',
        http_status: 502,
      });
    }
    await markTrackingSnapshotReconciled(context.env, snapshotId);
    const readbackSummary = summarizeAdsetConversionTracking(readback);
    return {
      ...trackingAttestation({
        destinationKind,
        profile,
        sourceSummary,
        targetSummary: readbackSummary,
        trackingPromotedObject: asObject(readback.promoted_object),
        status: 'reconciled',
      }),
      graph_mutation: 'promoted_object_updated',
      snapshot_id: snapshotId,
    };
  } catch (error) {
    // The encrypted snapshot is committed before a Graph POST.  Retain only
    // its opaque UUID in the sanitized failure so a caller can compensate a
    // mutation that succeeded but whose POST response or readback failed.
    throw redactTrackingFailure(error, snapshotId);
  }
}

async function rollbackAdsetConversionContract(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const snapshotId = normalizeSnapshotId(body.snapshot_id);
  const requestedAdsetId = normalizeNumericId(body.object_id || body.adset_id, 'object_id');
  const snapshot = await dbFirst(context.env,
    `SELECT * FROM meta_ads_publish_adset_tracking_snapshots WHERE id = ?`,
    snapshotId,
  );
  if (!snapshot) throw failure('adset_tracking_snapshot_not_found', { http_status: 404 });
  if (clean(snapshot.token_id) !== auth.tokenId || clean(snapshot.account_id) !== auth.accountId || clean(snapshot.adset_id) !== requestedAdsetId) {
    throw failure('adset_tracking_snapshot_not_authorized', { classification: 'auth', http_status: 403 });
  }
  // A rollback is a mutation too: the stored snapshot alone must not keep an
  // alternate route authorized after its private route/profile grant changed.
  // Resolve the current Website profile before accepting either the standard
  // ad set or a verified native-carousel alternate.
  resolveAuthorizedTrackingProfile(auth.config, snapshot.profile_ref);
  authorizeConfiguredTrackingAdset({
    destination_adset_id: requestedAdsetId,
    profile_ref: snapshot.profile_ref,
  }, auth.config, 'website');
  if (clean(snapshot.status) === 'restored') {
    return { status: 'already_restored', snapshot_id: snapshotId, graph_mutation: 'none' };
  }
  const snapshotState = await readTrackingSnapshotState(snapshot, context);
  const current = await readAdsetConversionState(auth, requestedAdsetId, context);
  if (trackingKeysMatch(current.promoted_object, snapshotState.previousPromotedObject, snapshotState.keys)) {
    // A failed ensure may have captured a snapshot before the Graph POST was
    // accepted.  Do not issue a redundant POST when the protected keys still
    // equal the exact pre-mutation state; the stored snapshot remains usable
    // for a safe same-operation retry.
    return { status: 'not_applied', snapshot_id: snapshotId, graph_mutation: 'none' };
  }
  if (!trackingKeysMatch(current.promoted_object, snapshotState.desiredTrackingPromotedObject, snapshotState.keys)) {
    throw failure('adset_tracking_rollback_concurrent_drift', { classification: 'permanent', http_status: 409 });
  }
  const rollbackPromotedObject = { ...asObject(current.promoted_object) };
  for (const key of snapshotState.keys) {
    if (Object.prototype.hasOwnProperty.call(snapshotState.previousPromotedObject, key)) {
      rollbackPromotedObject[key] = snapshotState.previousPromotedObject[key];
    } else {
      delete rollbackPromotedObject[key];
    }
  }
  try {
    await updateAdsetPromotedObject(auth, requestedAdsetId, rollbackPromotedObject, context);
  } catch (error) {
    throw redactTrackingFailure(error);
  }
  const readback = await readAdsetConversionState(auth, requestedAdsetId, context);
  if (!trackingKeysMatch(readback.promoted_object, snapshotState.previousPromotedObject, snapshotState.keys)) {
    throw failure('adset_tracking_rollback_readback_mismatch', { http_status: 502 });
  }
  await dbRun(context.env,
    `UPDATE meta_ads_publish_adset_tracking_snapshots
        SET status = 'restored', restored_at = ?, updated_at = ?
      WHERE id = ?`,
    nowIso(), nowIso(), snapshotId,
  );
  return { status: 'restored', snapshot_id: snapshotId, graph_mutation: 'promoted_object_restored' };
}

function authorizeConfiguredAdset(body, config) {
  const requested = normalizeNumericId(body.object_id || body.adset_id, 'object_id');
  const configured = normalizeNumericId(config.adset_id, 'configured_adset_id');
  if (requested !== configured) {
    throw failure('adset_not_authorized_for_token', { classification: 'auth', http_status: 403 });
  }
  return requested;
}

function authorizeConfiguredTrackingAdset(body, config, destinationKind) {
  return authorizeConfiguredDestinationAdset({
    ...asObject(body),
    destination_adset_id: body.object_id || body.adset_id || body.destination_adset_id,
  }, config, destinationKind);
}

function resolveAuthorizedTrackingProfile(config, requestedProfileRef) {
  const contract = normalizeTrackingContract(config.tracking_contract, config.tracking_profiles);
  if (!contract.profile_configured || contract.destination_kind !== 'website' || contract.reconciliation !== 'enforce_from_authorized_source') {
    throw failure('website_tracking_profile_not_configured', { classification: 'permanent', http_status: 409 });
  }
  const requested = normalizeTrackingProfileRef(requestedProfileRef);
  if (!requested || requested !== contract.profile_ref) {
    throw failure('tracking_profile_not_authorized', { classification: 'auth', http_status: 403 });
  }
  const profile = asObject(asObject(config.tracking_profiles)[requested]);
  return {
    profile_ref: requested,
    source_adset_id: normalizeNumericId(profile.source_adset_id, 'tracking_profile_source_adset_id'),
    destination_kind: 'website',
    website_event_requirement: normalizeTrackingRequirement(profile.website_event_requirement, 'website_event_requirement'),
    offline_event_dataset_requirement: normalizeTrackingRequirement(profile.offline_event_dataset_requirement, 'offline_event_dataset_requirement'),
  };
}

async function readAdsetConversionState(auth, adsetId, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, adsetId, { fields: ADSET_CONVERSION_CONTRACT_FIELDS }),
    { method: 'GET' },
    auth,
    context,
  );
  return asObject(result.body);
}

function assertWebsiteTrackingCompatibility(sourceValue, targetValue, profile) {
  const source = asObject(sourceValue);
  const target = asObject(targetValue);
  const sourceCampaignObjective = safeTrackingEnum(asObject(source.campaign).objective);
  const targetCampaignObjective = safeTrackingEnum(asObject(target.campaign).objective);
  const sourceOptimizationGoal = safeTrackingEnum(source.optimization_goal);
  const targetOptimizationGoal = safeTrackingEnum(target.optimization_goal);
  const sourceDestinationType = safeTrackingEnum(source.destination_type);
  const targetDestinationType = safeTrackingEnum(target.destination_type);
  const sourceBillingEvent = safeTrackingEnum(source.billing_event);
  const targetBillingEvent = safeTrackingEnum(target.billing_event);
  if (!sourceCampaignObjective || !targetCampaignObjective || sourceCampaignObjective !== targetCampaignObjective) {
    throw failure('tracking_profile_campaign_objective_incompatible', { http_status: 409 });
  }
  if (!sourceOptimizationGoal || !targetOptimizationGoal || sourceOptimizationGoal !== targetOptimizationGoal) {
    throw failure('tracking_profile_optimization_goal_incompatible', { http_status: 409 });
  }
  if (sourceDestinationType !== 'WEBSITE' || targetDestinationType !== 'WEBSITE') {
    throw failure('tracking_profile_destination_type_incompatible', { http_status: 409 });
  }
  if (!sourceBillingEvent || !targetBillingEvent || sourceBillingEvent !== targetBillingEvent) {
    throw failure('tracking_profile_billing_event_incompatible', { http_status: 409 });
  }
  if (websiteEventRequiredForDelivery(sourceCampaignObjective, sourceOptimizationGoal) && profile.website_event_requirement !== 'required') {
    throw failure('tracking_profile_website_event_required_for_optimization', { http_status: 409 });
  }
  if (stableStringify(safeArray(source.attribution_spec)) !== stableStringify(safeArray(target.attribution_spec))) {
    throw failure('tracking_profile_attribution_spec_incompatible', { http_status: 409 });
  }
}

function websiteEventRequiredForDelivery(campaignObjective, optimizationGoal) {
  const campaign = safeTrackingEnum(campaignObjective);
  const optimization = safeTrackingEnum(optimizationGoal);
  if (WEBSITE_EVENT_REQUIRED_CAMPAIGN_OBJECTIVES.has(campaign) || WEBSITE_EVENT_REQUIRED_OPTIMIZATION_GOALS.has(optimization)) {
    return true;
  }
  if (/(?:CONVERSION|VALUE|PURCHASE|SALE|LEAD|APP.*INSTALL)/.test(campaign) ||
      /(?:CONVERSION|VALUE|PURCHASE|SALE|LEAD|APP.*INSTALL)/.test(optimization)) {
    return true;
  }
  // Optional means explicitly known to be non-conversion at both levels. A
  // new Graph enum or a malformed/missing value therefore fails closed rather
  // than silently publishing Website traffic without its required event.
  return !(WEBSITE_EVENT_OPTIONAL_CAMPAIGN_OBJECTIVES.has(campaign) &&
    WEBSITE_EVENT_OPTIONAL_OPTIMIZATION_GOALS.has(optimization));
}

function assertAdsetAccountAuthorized(sourceValue, targetValue, accountId) {
  const sourceAccount = normalizeNumericId(asObject(sourceValue).account_id, 'tracking_profile_source_account_id');
  const targetAccount = normalizeNumericId(asObject(targetValue).account_id, 'tracking_profile_target_account_id');
  if (sourceAccount !== accountId || targetAccount !== accountId) {
    throw failure('tracking_profile_account_not_authorized', { classification: 'auth', http_status: 403 });
  }
}

function projectAuthorizedTrackingPromotedObject(sourceValue, targetValue, profile) {
  const source = asObject(sourceValue);
  const target = asObject(targetValue);
  const sourcePromotedObject = asObject(source.promoted_object);
  const targetPromotedObject = asObject(target.promoted_object);
  const tracking = {};

  if (profile.website_event_requirement === 'required') {
    const pixelId = normalizeNumericId(sourcePromotedObject.pixel_id, 'authorized_pixel_id');
    const customEventType = safeTrackingEnum(sourcePromotedObject.custom_event_type);
    const customConversionId = clean(sourcePromotedObject.custom_conversion_id)
      ? normalizeNumericId(sourcePromotedObject.custom_conversion_id, 'authorized_custom_conversion_id')
      : '';
    if (Boolean(customEventType) === Boolean(customConversionId)) {
      throw failure('authorized_website_event_invalid', { http_status: 409 });
    }
    tracking.pixel_id = pixelId;
    if (customEventType) tracking.custom_event_type = customEventType;
    if (customConversionId) tracking.custom_conversion_id = customConversionId;
  }

  if (profile.offline_event_dataset_requirement === 'required') {
    tracking.offline_conversion_data_set_id = normalizeNumericId(
      sourcePromotedObject.offline_conversion_data_set_id,
      'authorized_offline_conversion_dataset_id',
    );
  }

  // Preserve every unrelated promoted-object field already accepted by Meta
  // for this existing campaign. Only the fields explicitly required by this
  // authorized profile may be replaced; an optional offline dataset is never
  // silently removed while reconciling a website event, for example.
  const full = { ...targetPromotedObject };
  if (profile.website_event_requirement === 'required') {
    for (const key of ['pixel_id', 'custom_event_type', 'custom_conversion_id']) delete full[key];
  }
  if (profile.offline_event_dataset_requirement === 'required') delete full.offline_conversion_data_set_id;
  Object.assign(full, tracking);
  return { full_promoted_object: full, tracking_promoted_object: tracking };
}

function trackingPromotedObjectMatches(currentValue, expectedValue, profile) {
  return trackingKeysMatch(currentValue, expectedValue, trackingKeysForProfile(profile));
}

function trackingKeysForProfile(profile) {
  const keys = [];
  if (profile.website_event_requirement === 'required') {
    keys.push('pixel_id', 'custom_event_type', 'custom_conversion_id');
  }
  if (profile.offline_event_dataset_requirement === 'required') keys.push('offline_conversion_data_set_id');
  return keys;
}

function trackingKeysMatch(currentValue, expectedValue, keys) {
  const current = asObject(currentValue);
  const expected = asObject(expectedValue);
  return safeArray(keys).every((key) => clean(current[key]) === clean(expected[key]));
}

async function updateAdsetTrackingWithReconciliation(auth, adsetId, promotedObject, profile, context) {
  try {
    await updateAdsetPromotedObject(auth, adsetId, promotedObject, context);
    return { reconciled_after_ambiguous_response: false };
  } catch (error) {
    if (!normalizeFailure(error).ambiguous) throw error;
    const current = await readAdsetConversionState(auth, adsetId, context);
    const expected = projectTrackingKeysFromPromotedObject(promotedObject, profile);
    if (trackingPromotedObjectMatches(current.promoted_object, expected, profile)) {
      return { reconciled_after_ambiguous_response: true };
    }
    throw error;
  }
}

function projectTrackingKeysFromPromotedObject(value, profile) {
  const source = asObject(value);
  const out = {};
  if (profile.website_event_requirement === 'required') {
    out.pixel_id = clean(source.pixel_id);
    if (clean(source.custom_event_type)) out.custom_event_type = clean(source.custom_event_type);
    if (clean(source.custom_conversion_id)) out.custom_conversion_id = clean(source.custom_conversion_id);
  }
  if (profile.offline_event_dataset_requirement === 'required') {
    out.offline_conversion_data_set_id = clean(source.offline_conversion_data_set_id);
  }
  return out;
}

async function updateAdsetPromotedObject(auth, adsetId, promotedObject, context) {
  return graphRequest(
    graphUrl(auth.apiVersion, adsetId),
    jsonRequest('POST', { promoted_object: promotedObject }),
    auth,
    context,
  );
}

async function captureTrackingSnapshot({ auth, targetAdsetId, profile, previousPromotedObject, desiredTrackingPromotedObject, existingSnapshot, context }) {
  if (typeof context.encryptToken !== 'function') {
    throw failure('tracking_snapshot_encryption_unavailable', { classification: 'permanent', http_status: 500 });
  }
  const keys = trackingKeysForProfile(profile).filter((key) => clean(asObject(previousPromotedObject)[key]) !== clean(asObject(desiredTrackingPromotedObject)[key]));
  if (!keys.length) throw failure('tracking_snapshot_without_mutation', { classification: 'permanent', http_status: 409 });
  // Snapshots are for compensating only the fields this reconciliation is
  // allowed to change.  Do not encrypt or retain unrelated promoted-object
  // state (catalogs, products, etc.), even though the Graph POST preserves it.
  const previous = stableStringify(projectTrackingSnapshotFields(previousPromotedObject, keys));
  const desiredTracking = stableStringify(projectTrackingSnapshotFields(desiredTrackingPromotedObject, keys));
  if (existingSnapshot) return existingSnapshot.id;
  const snapshotId = crypto.randomUUID();
  const previousCiphertext = await context.encryptToken(previous, context.env);
  const desiredTrackingCiphertext = await context.encryptToken(desiredTracking, context.env);
  await dbRun(context.env,
    `INSERT OR IGNORE INTO meta_ads_publish_adset_tracking_snapshots (
      id, run_id, operation_key, token_id, account_id, adset_id, profile_ref,
      previous_promoted_object_ciphertext, previous_promoted_object_fingerprint,
      desired_promoted_object_fingerprint, desired_tracking_promoted_object_ciphertext,
      tracking_keys_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?, ?)`,
    snapshotId,
    context.runId,
    context.operationKey,
    auth.tokenId,
    auth.accountId,
    targetAdsetId,
    profile.profile_ref,
    previousCiphertext,
    await sha256(previous),
    await sha256(desiredTracking),
    desiredTrackingCiphertext,
    JSON.stringify(keys),
    nowIso(),
    nowIso(),
  );
  const stored = await loadTrackingSnapshotByOperation(context.env, context.operationKey);
  if (!stored) throw failure('tracking_snapshot_capture_failed', { classification: 'permanent', http_status: 500 });
  await assertTrackingSnapshotContract(stored, {
    auth,
    targetAdsetId,
    profile,
    desiredTrackingPromotedObject,
    context,
  });
  // INSERT OR IGNORE intentionally never overwrites an existing checkpoint.
  // A same-key retry (or a concurrent claimant that won the insert race) must
  // still prove that the target state read by this operation matches the
  // snapshot's original tracking values before a Graph write can reuse it.
  await assertTrackingSnapshotRetryIsSafe(stored, previousPromotedObject, context);
  return stored.id;
}

async function loadTrackingSnapshotByOperation(env, operationKey) {
  return dbFirst(env,
    `SELECT * FROM meta_ads_publish_adset_tracking_snapshots WHERE operation_key = ?`,
    operationKey,
  );
}

async function assertTrackingSnapshotContract(snapshot, { auth, targetAdsetId, profile, desiredTrackingPromotedObject, context }) {
  if (!snapshot || clean(snapshot.token_id) !== auth.tokenId || clean(snapshot.account_id) !== auth.accountId ||
    clean(snapshot.adset_id) !== targetAdsetId || clean(snapshot.profile_ref) !== profile.profile_ref ||
    clean(snapshot.status) === 'restored') {
    throw failure('adset_tracking_snapshot_operation_conflict', { classification: 'permanent', http_status: 409 });
  }
  const state = await readTrackingSnapshotState(snapshot, context, { previousRequired: false });
  const expectedFingerprint = await sha256(stableStringify(projectTrackingSnapshotFields(desiredTrackingPromotedObject, state.keys)));
  // Releases before v20 stored the whole desired promoted object.  Continue to
  // accept that legacy fingerprint only for a previously captured snapshot;
  // new captures above are always the narrower projection.
  const legacyFingerprint = await sha256(stableStringify(asObject(desiredTrackingPromotedObject)));
  if (![expectedFingerprint, legacyFingerprint].includes(clean(snapshot.desired_promoted_object_fingerprint)) ||
    !trackingKeysMatch(state.desiredTrackingPromotedObject, desiredTrackingPromotedObject, state.keys)) {
    throw failure('adset_tracking_snapshot_operation_conflict', { classification: 'permanent', http_status: 409 });
  }
}

function projectTrackingSnapshotFields(value, keys) {
  const source = asObject(value);
  const projected = {};
  for (const key of safeArray(keys)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) projected[key] = source[key];
  }
  return projected;
}

async function assertTrackingSnapshotRetryIsSafe(snapshot, currentPromotedObject, context) {
  const state = await readTrackingSnapshotState(snapshot, context);
  if (!trackingKeysMatch(currentPromotedObject, state.previousPromotedObject, state.keys)) {
    throw failure('adset_tracking_retry_concurrent_drift', { classification: 'permanent', http_status: 409 });
  }
}

async function readTrackingSnapshotState(snapshot, context, { previousRequired = true } = {}) {
  const keys = parseTrackingSnapshotKeys(snapshot.tracking_keys_json);
  let desiredTrackingPromotedObject;
  try {
    desiredTrackingPromotedObject = asObject(JSON.parse(await context.decryptToken(snapshot.desired_tracking_promoted_object_ciphertext, context.env)));
  } catch {
    throw failure('adset_tracking_snapshot_unreadable', { classification: 'permanent', http_status: 409 });
  }
  let previousPromotedObject = {};
  if (previousRequired) {
    try {
      previousPromotedObject = asObject(JSON.parse(await context.decryptToken(snapshot.previous_promoted_object_ciphertext, context.env)));
    } catch {
      throw failure('adset_tracking_snapshot_unreadable', { classification: 'permanent', http_status: 409 });
    }
  }
  return { keys, desiredTrackingPromotedObject, previousPromotedObject };
}

function parseTrackingSnapshotKeys(value) {
  let keys;
  try {
    keys = JSON.parse(clean(value));
  } catch {
    throw failure('adset_tracking_snapshot_unreadable', { classification: 'permanent', http_status: 409 });
  }
  if (!Array.isArray(keys) || !keys.length || keys.length > TRACKING_PROMOTED_OBJECT_KEYS.length ||
    new Set(keys).size !== keys.length || !keys.every((key) => TRACKING_PROMOTED_OBJECT_KEYS.includes(key))) {
    throw failure('adset_tracking_snapshot_unreadable', { classification: 'permanent', http_status: 409 });
  }
  return keys;
}

async function markTrackingSnapshotReconciled(env, snapshotId) {
  await dbRun(env,
    `UPDATE meta_ads_publish_adset_tracking_snapshots
        SET status = 'reconciled', updated_at = ?
      WHERE id = ? AND status = 'captured'`,
    nowIso(), snapshotId,
  );
}

function trackingAttestation({ destinationKind, profile, sourceSummary, targetSummary, trackingPromotedObject, status }) {
  const target = asObject(targetSummary);
  const tracking = asObject(trackingPromotedObject);
  return {
    status,
    destination_kind: destinationKind,
    profile_ref: profile.profile_ref,
    website_event: {
      configured: target.website_event?.configured === true,
      required: profile.website_event_requirement === 'required',
    },
    offline_event_dataset: {
      configured: target.offline_event_dataset?.configured === true,
      required: profile.offline_event_dataset_requirement === 'required',
    },
    // The fingerprint is intentionally calculated from the redacted contract
    // shape, never from a raw Pixel or dataset identifier.
    tracking_fingerprint: trackingContractFingerprint({
      website_event: target.website_event?.configured === true,
      offline_event_dataset: target.offline_event_dataset?.configured === true,
      custom_event_type: target.promoted_object?.custom_event_type || '',
      source_website_event: sourceSummary.website_event?.configured === true,
      source_offline_event_dataset: sourceSummary.offline_event_dataset?.configured === true,
      fields: Object.keys(tracking).filter((key) => TRACKING_PROMOTED_OBJECT_KEYS.includes(key)).sort(),
    }),
  };
}

function trackingContractFingerprint(value) {
  let hash = 2166136261;
  for (const char of stableStringify(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function redactTrackingFailure(error, snapshotId = '') {
  const normalized = normalizeFailure(error);
  const candidateSnapshotId = clean(snapshotId);
  const compensation = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateSnapshotId)
    ? { snapshot_id: candidateSnapshotId }
    : undefined;
  return failure('adset_conversion_reconciliation_failed', {
    classification: normalized.classification || 'unknown',
    retryable: Boolean(normalized.retryable),
    ambiguous: Boolean(normalized.ambiguous),
    http_status: Number(normalized.http_status || 502),
    code: Number(normalized.code || 0),
    error_subcode: Number(normalized.error_subcode || 0),
    fbtrace_id: clean(normalized.fbtrace_id),
    ...(compensation ? { compensation } : {}),
  });
}

async function getCampaign(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const campaignId = normalizeNumericId(body.object_id, 'object_id');
  const result = await graphRequest(
    graphUrl(auth.apiVersion, campaignId, { fields: CAMPAIGN_READ_FIELDS }),
    { method: 'GET' },
    auth,
    context,
  );
  return sanitizeGraphValue(result.body);
}

async function createCampaign(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const payload = validatePausedCampaignPayload(body.payload);
  const result = await graphRequest(
    graphUrl(auth.apiVersion, `act_${auth.accountId}/campaigns`),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
    auth,
    context,
  );
  return sanitizeGraphValue(result.body);
}

async function createAdset(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const payload = validatePausedAdsetPayload(body.payload);
  const result = await graphRequest(
    graphUrl(auth.apiVersion, `act_${auth.accountId}/adsets`),
    jsonRequest('POST', payload),
    auth,
    context,
  );
  return sanitizeGraphValue(result.body);
}

async function promoteNativeCarouselRoute(body, context) {
  const auth = await resolveGraphAuth(body, context);
  const payload = validateNativeCarouselRoutePromotion(body.payload);
  const campaign = await graphRequest(
    graphUrl(auth.apiVersion, payload.campaign_id, { fields: 'id,name,status' }),
    { method: 'GET' }, auth, context,
  );
  if (!isNativeCarouselRouteName(campaign.body && campaign.body.name)) {
    throw failure('native_carousel_campaign_name_invalid', { classification: 'permanent', http_status: 400 });
  }
  for (const adId of payload.test_ad_ids) {
    const ad = await readAd(auth, adId, context);
    if (!clean(ad.name).startsWith('[TEST-CAROUSEL-NATIVE]')) {
      throw failure('native_carousel_test_ad_name_invalid', { classification: 'permanent', http_status: 400 });
    }
    await graphRequest(graphUrl(auth.apiVersion, adId), jsonRequest('POST', { status: 'ARCHIVED' }), auth, context);
  }
  for (const adset of payload.adsets) {
    const current = await graphRequest(
      graphUrl(auth.apiVersion, adset.id, { fields: 'id,name,status' }),
      { method: 'GET' }, auth, context,
    );
    if (!isNativeCarouselRouteName(current.body && current.body.name)) {
      throw failure('native_carousel_adset_name_invalid', { classification: 'permanent', http_status: 400 });
    }
    await graphRequest(graphUrl(auth.apiVersion, adset.id), jsonRequest('POST', { name: adset.name, status: 'ACTIVE' }), auth, context);
  }
  await graphRequest(
    graphUrl(auth.apiVersion, payload.campaign_id),
    jsonRequest('POST', { name: payload.campaign_name, status: 'ACTIVE' }),
    auth,
    context,
  );
  return {
    campaign_id: payload.campaign_id,
    campaign_status: 'ACTIVE',
    adsets: payload.adsets.map((adset) => ({ id: adset.id, name: adset.name, status: 'ACTIVE' })),
    archived_test_ad_ids: payload.test_ad_ids,
  };
}

async function stageBatch(body, context) {
  const jobs = validateBatchJobs(body.jobs);
  const staged = [];
  try {
    for (const job of jobs) {
      const auth = await resolveGraphAuth(job, context);
      const payload = validateAdPayload(job.ad_payload, job.action);
      const tracking = authorizeTrackingMutationMetadata(job, auth.config);
      const creativeId = normalizeNumericId(job.creative_id, 'creative_id');
      if (creativeId !== normalizeNumericId(payload.creative.creative_id, 'ad_payload.creative.creative_id')) {
        throw failure('stage_creative_identity_mismatch', { classification: 'permanent', http_status: 409 });
      }
      const payloadAdsetId = clean(payload.adset_id)
        ? normalizeNumericId(payload.adset_id, 'ad_payload.adset_id')
        : '';
      if ((job.action === 'create_new' && !payloadAdsetId) ||
          (payloadAdsetId && payloadAdsetId !== tracking.destination_adset_id)) {
        throw failure('stage_adset_not_authorized_for_destination', { classification: 'auth', http_status: 403 });
      }
      // The stage request is a second trust boundary. Reconcile the configured
      // ad set again under the batch's ad-set lock instead of treating the
      // earlier Orb pre-stage attestation as a durable authorization. This
      // catches drift between creative construction and the eventual ad POST.
      await ensureAdsetConversionContract({
        token_id: job.token_id,
        account_id: auth.accountId,
        api_version: auth.apiVersion,
        object_id: tracking.destination_adset_id,
        destination_kind: tracking.destination_kind,
        profile_ref: tracking.profile_ref,
      }, context);
      // Do not trust a creative ID merely because it appeared in a workflow
      // payload. Its exact raw URL-tag contract is read back inside the Token
      // Vault before the ad can reference it.
      await assertStagedCreativeTracking(auth, creativeId, tracking, context);
      payload.status = 'PAUSED';
      if (job.action === 'replace_existing') {
        const adId = normalizeNumericId(job.target_ad_id, 'target_ad_id');
        const previous = await readAd(auth, adId, context);
        if (normalizeNumericId(previous.adset_id, 'existing_adset_id') !== tracking.destination_adset_id) {
          throw failure('stage_adset_not_authorized_for_destination', { classification: 'auth', http_status: 403 });
        }
        const result = await updateAdWithReconciliation(auth, adId, payload, context);
        const record = buildStagedRecord(job, adId, previous, result, false);
        staged.push(record);
        await upsertJob(context.env, context.runId, record, 'staged');
      } else {
        const result = await createAdWithReconciliation(auth, payload, context);
        const adId = normalizeNumericId(result.id, 'created_ad_id');
        const record = buildStagedRecord(job, adId, {}, result, true);
        staged.push(record);
        await upsertJob(context.env, context.runId, record, 'staged');
      }
    }
  } catch (error) {
    const rollback = await compensateStaged(staged, context);
    const normalized = normalizeFailure(error);
    normalized.compensation = rollback;
    normalized.ambiguous = normalized.ambiguous || rollback.reconciliation_required;
    throw Object.assign(new Error(normalized.message || 'stage_batch_failed'), normalized);
  }
  await setRunState(context.env, context.runId, 'staged', { jobs: staged.map(stripJobForSummary) });
  return { status: 'staged', job_count: staged.length, jobs: staged };
}

async function activateBatch(body, context) {
  const staged = await loadStagedOperation(body.stage_operation_key, context);
  const activated = [];
  try {
    for (const record of staged.jobs) {
      const auth = await resolveGraphAuth(record, context);
      const result = await updateAdWithReconciliation(auth, record.ad_id, { status: 'ACTIVE' }, context);
      activated.push({ ...record, activation_result: sanitizeGraphValue(result) });
      await updateJobStatus(context.env, record.operation_key, 'active', { ad_id: record.ad_id });
    }
  } catch (error) {
    const rollback = await compensateStaged(staged.jobs, context);
    const normalized = normalizeFailure(error);
    normalized.compensation = rollback;
    normalized.ambiguous = normalized.ambiguous || rollback.reconciliation_required;
    throw Object.assign(new Error(normalized.message || 'activate_batch_failed'), normalized);
  }
  await setRunState(context.env, context.runId, 'meta_completed_drive_pending', {
    jobs: activated.map(stripJobForSummary),
  });
  return { status: 'meta_completed_drive_pending', job_count: activated.length, jobs: activated };
}

async function rollbackBatch(body, context) {
  const staged = await loadStagedOperation(body.stage_operation_key, context);
  const rollback = await compensateStaged(staged.jobs, context);
  const status = rollback.reconciliation_required ? 'reconciliation_required' : 'rolled_back';
  await setRunState(context.env, context.runId, status, rollback);
  if (rollback.reconciliation_required) {
    throw failure('rollback_reconciliation_required', {
      classification: 'ambiguous',
      ambiguous: true,
      http_status: 502,
      compensation: rollback,
    });
  }
  return { status, ...rollback };
}

async function loadStagedOperation(operationKey, context) {
  const key = requireKey(operationKey, 'stage_operation_key');
  const row = await dbFirst(context.env,
    `SELECT result_json, status, action FROM meta_ads_publish_operations
      WHERE run_id = ? AND operation_key = ?`,
    context.runId, key,
  );
  if (!row || clean(row.status) !== 'completed' || clean(row.action) !== 'stage_batch') {
    throw failure('staged_operation_not_found', { classification: 'permanent', http_status: 409 });
  }
  const result = parseObject(row.result_json);
  if (!safeArray(result.jobs).length) throw failure('staged_jobs_missing', { classification: 'permanent', http_status: 409 });
  return result;
}

async function compensateStaged(records, context) {
  const results = [];
  let reconciliationRequired = false;
  for (const record of [...records].reverse()) {
    try {
      const auth = await resolveGraphAuth(record, context);
      if (record.created_new) {
        await updateAdWithReconciliation(auth, record.ad_id, { status: 'PAUSED' }, context);
        results.push({ ad_id: record.ad_id, action: 'pause_created', ok: true });
      } else {
        const payload = previousStatePayload(record.previous_state);
        await updateAdWithReconciliation(auth, record.ad_id, payload, context);
        results.push({ ad_id: record.ad_id, action: 'restore_existing', ok: true });
      }
      await updateJobStatus(context.env, record.operation_key, 'rolled_back', { ad_id: record.ad_id });
    } catch (error) {
      reconciliationRequired = true;
      const normalized = normalizeFailure(error);
      results.push({
        ad_id: record.ad_id,
        action: record.created_new ? 'pause_created' : 'restore_existing',
        ok: false,
        error: normalized,
      });
      await updateJobStatus(context.env, record.operation_key, 'reconciliation_required', normalized);
    }
  }
  return { reconciliation_required: reconciliationRequired, results };
}

async function resolveGraphAuth(body, context) {
  const tokenId = clean(body.token_id);
  if (!tokenId) throw failure('token_id_required', { classification: 'permanent', http_status: 400 });
  const row = await dbFirst(context.env,
    `SELECT id, provider, active, token_ciphertext, metadata_json
       FROM credential_tokens WHERE id = ?`,
    tokenId,
  );
  if (!row || row.provider !== 'facebook' || Number(row.active) !== 1) {
    throw failure('facebook_token_not_available', { classification: 'auth', http_status: 401 });
  }
  const metadata = parseObject(row.metadata_json);
  const config = asObject(metadata.meta_ads_publish);
  const accountId = normalizeNumericId(body.account_id || config.account_id, 'account_id');
  const configuredAccount = normalizeNumericId(config.account_id, 'configured_account_id');
  if (accountId !== configuredAccount) {
    throw failure('account_not_authorized_for_token', { classification: 'auth', http_status: 403 });
  }
  const apiVersion = normalizeApiVersion(body.api_version || config.api_version || 'v25.0');
  const accessToken = await context.decryptToken(row.token_ciphertext, context.env);
  const appSecretProof = clean(context.env.META_APP_SECRET)
    ? await hmacSha256(clean(context.env.META_APP_SECRET), accessToken)
    : '';
  return { tokenId, accountId, apiVersion, accessToken, appSecretProof, config };
}

async function graphRequest(url, init, auth, context, { maxAttempts = MAX_GRAPH_ATTEMPTS } = {}) {
  let lastFailure;
  const started = Date.now();
  const attemptsAllowed = clampInteger(maxAttempts, MAX_GRAPH_ATTEMPTS, 1, MAX_GRAPH_ATTEMPTS);
  for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
    // Bootstrap may spend several retry windows walking a source ad set.  Its
    // configuration lease must be renewed before every Graph request, not
    // only before a later POST/persist, otherwise an expired saga could leave
    // an already-mutated target without a live owner able to compensate it.
    if (typeof context?.assertBootstrapLease === 'function') {
      await context.assertBootstrapLease();
    }
    context.attempts += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
    try {
      const target = appendAppSecretProof(url, auth.appSecretProof);
      const headers = new Headers(init.headers || {});
      headers.set('Authorization', `Bearer ${auth.accessToken}`);
      const graphFetch = context.env.META_GRAPH_FETCH || fetch;
      const graphResponse = await graphFetch(target, { ...init, headers, signal: controller.signal });
      const body = await parseGraphBody(graphResponse);
      const rateUsage = extractRateUsage(graphResponse.headers);
      context.rateUsage = mergeRateUsage(context.rateUsage, rateUsage);
      context.traceId = clean(body?.error?.fbtrace_id || context.traceId);
      const maxUsage = maxRateUsage(rateUsage);
      if (maxUsage >= 95 && graphResponse.ok) {
        context.rateUsage.pause_recommended = true;
      } else if (maxUsage >= 80) {
        context.rateUsage.warning = true;
      }
      if (graphResponse.ok && !body?.error) return { body, status: graphResponse.status, headers: graphResponse.headers };

      const normalized = normalizeMetaError(body, graphResponse.status, graphResponse.headers, context.action);
      lastFailure = normalized;
      if (!normalized.retryable || attempt === attemptsAllowed) throw Object.assign(new Error(normalized.message), normalized);
      const delay = retryDelayMs(attempt, graphResponse.headers, started, normalized);
      if (delay <= 0) throw Object.assign(new Error(normalized.message), normalized);
      await (context.env.META_GRAPH_SLEEP || sleep)(delay);
    } catch (error) {
      const normalized = normalizeFailure(error);
      lastFailure = normalized;
      if (!normalized.retryable || attempt === attemptsAllowed) throw Object.assign(new Error(normalized.message), normalized);
      const delay = retryDelayMs(attempt, null, started);
      if (delay <= 0) throw Object.assign(new Error(normalized.message), normalized);
      await (context.env.META_GRAPH_SLEEP || sleep)(delay);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw Object.assign(new Error(lastFailure?.message || 'meta_graph_failed'), lastFailure || {});
}

async function readAd(auth, adId, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, adId, { fields: AD_STATE_FIELDS }),
    { method: 'GET' },
    auth,
    context,
  );
  return sanitizeGraphValue(result.body);
}

async function updateAdWithReconciliation(auth, adId, payload, context) {
  try {
    const result = await graphRequest(graphUrl(auth.apiVersion, adId), jsonRequest('POST', payload), auth, context);
    return sanitizeGraphValue(result.body);
  } catch (error) {
    if (!normalizeFailure(error).ambiguous) throw error;
    const current = await readAd(auth, adId, context);
    if (adStateMatches(current, payload)) return { success: true, id: adId, reconciled_after_ambiguous_response: true };
    throw error;
  }
}

async function createAdWithReconciliation(auth, payload, context) {
  try {
    const result = await graphRequest(
      graphUrl(auth.apiVersion, `act_${auth.accountId}/ads`),
      jsonRequest('POST', payload),
      auth,
      context,
    );
    return sanitizeGraphValue(result.body);
  } catch (error) {
    if (!normalizeFailure(error).ambiguous) throw error;
    const found = await findAdByPayload(auth, payload, context);
    if (found) return { id: found.id, success: true, reconciled_after_ambiguous_response: true };
    throw error;
  }
}

async function findCreativeByOperationName(auth, name, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, `act_${auth.accountId}/adcreatives`, { fields: 'id,name', limit: '100' }),
    { method: 'GET' }, auth, context,
  );
  const matches = safeArray(result.body.data).filter((entry) => clean(entry.name) === clean(name));
  return matches.length === 1 ? sanitizeGraphValue(matches[0]) : null;
}

async function findAdByPayload(auth, payload, context) {
  const result = await graphRequest(
    graphUrl(auth.apiVersion, `act_${auth.accountId}/ads`, { fields: AD_STATE_FIELDS, limit: '100' }),
    { method: 'GET' }, auth, context,
  );
  const creativeId = clean(payload?.creative?.creative_id);
  const matches = safeArray(result.body.data).filter((entry) => (
    clean(entry.name) === clean(payload.name)
    && clean(entry.adset_id) === clean(payload.adset_id)
    && clean(entry.creative?.id) === creativeId
  ));
  return matches.length === 1 ? matches[0] : null;
}

function validateCreativePayload(value, operationKey) {
  const payload = sanitizeGraphValue(asObject(value));
  if (Object.prototype.hasOwnProperty.call(payload, 'url_tags')) {
    payload.url_tags = normalizeUrlTags(payload.url_tags, { required: true });
  }
  const hasStory = Object.keys(asObject(payload.object_story_spec)).length > 0;
  const hasFeed = Object.keys(asObject(payload.asset_feed_spec)).length > 0;
  if (!hasStory) {
    throw failure('flexible_creative_required', { classification: 'permanent', http_status: 400 });
  }
  if (hasFeed) return validateFlexibleCreativePayload(payload, operationKey);
  return validateNativeCarouselCreativePayload(payload, operationKey);
}

function validateFlexibleCreativePayload(payload, operationKey) {
  const feed = asObject(payload.asset_feed_spec);
  const images = safeArray(feed.images);
  const videos = safeArray(feed.videos);
  const videoOnly = images.length === 0 && videos.length === 1;
  const mixed = images.length >= 3 && videos.length === 1;
  const staticOnly = images.length >= 3 && videos.length === 0;
  if ((!videoOnly && !mixed && !staticOnly) || safeArray(feed.bodies).length !== 5 || safeArray(feed.titles).length !== 5) {
    throw failure('creative_quality_gate_failed', { classification: 'permanent', http_status: 400 });
  }
  if (safeArray(feed.descriptions).length !== 5) {
    throw failure('creative_description_count_invalid', { classification: 'permanent', http_status: 400 });
  }
  const formats = safeArray(feed.ad_formats).map((entry) => clean(entry)).filter(Boolean);
  const requiredFormat = videoOnly ? 'SINGLE_VIDEO' : mixed ? 'AUTOMATIC_FORMAT' : 'SINGLE_IMAGE';
  if (formats.length !== 1 || formats[0] !== requiredFormat) {
    throw failure(videoOnly ? 'video_only_feed_requires_single_video_format' : mixed ? 'mixed_video_feed_requires_automatic_format' : 'static_feed_requires_single_image_format');
  }
  if (videos.length > 1) throw failure('creative_video_count_invalid', { classification: 'permanent', http_status: 400 });
  if (videos.length === 1) {
    const video = asObject(videos[0]);
    normalizeNumericId(video.video_id, 'video_id');
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(clean(video.thumbnail_hash))) throw failure('video_thumbnail_hash_invalid');
    const labels = safeArray(video.adlabels).map((label) => clean(label?.name)).filter(Boolean);
    if (labels.length !== 1 || labels[0] !== 'vertical_video') throw failure('video_label_invalid');
  }
  if (payload.video_id || asObject(payload.object_story_spec).video_id) throw failure('root_video_id_forbidden');

  const mediaLabels = new Set(images.flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const videoLabels = new Set(videos.flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const bodyLabels = new Set(safeArray(feed.bodies).flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const titleLabels = new Set(safeArray(feed.titles).flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const descriptionLabels = new Set(safeArray(feed.descriptions).flatMap((asset) => safeArray(asset?.adlabels).map((label) => clean(label?.name))).filter(Boolean));
  const rules = safeArray(feed.asset_customization_rules);
  if (!rules.length) throw failure('creative_customization_rules_required');
  const claimedPlacements = new Set();
  let videoRuleCount = 0;
  for (const [index, rule] of rules.entries()) {
    const imageLabel = clean(rule?.image_label?.name);
    const videoLabel = clean(rule?.video_label?.name);
    const bodyLabel = clean(rule?.body_label?.name);
    const titleLabel = clean(rule?.title_label?.name);
    const descriptionLabel = clean(rule?.description_label?.name);
    if (!imageLabel && !videoLabel) throw failure(`creative_rule_media_label_missing:${index}`);
    if (imageLabel && !mediaLabels.has(imageLabel)) throw failure(`creative_rule_image_label_invalid:${index}`);
    if (videoLabel && !videoLabels.has(videoLabel)) throw failure(`creative_rule_video_label_invalid:${index}`);
    if (imageLabel && videoLabel) throw failure(`creative_rule_multiple_media_labels:${index}`);
    if (!bodyLabels.has(bodyLabel) || !titleLabels.has(titleLabel) || !descriptionLabels.has(descriptionLabel)) {
      throw failure(`creative_rule_text_label_invalid:${index}`);
    }
    if (videoLabel) videoRuleCount += 1;
    const spec = asObject(rule?.customization_spec);
    for (const publisher of safeArray(spec.publisher_platforms).map(clean).filter(Boolean)) {
      const positions = publisher === 'facebook' ? safeArray(spec.facebook_positions)
        : publisher === 'instagram' ? safeArray(spec.instagram_positions)
          : publisher === 'audience_network' ? safeArray(spec.audience_network_positions)
            : publisher === 'whatsapp' ? safeArray(spec.whatsapp_positions) : [];
      for (const position of positions) {
        const claim = `${publisher}:${clean(position)}`;
        if (claimedPlacements.has(claim)) throw failure(`creative_rule_overlap:${index}`);
        claimedPlacements.add(claim);
      }
    }
  }
  if (videoOnly && videoRuleCount !== 2) throw failure('creative_video_only_rule_invalid');
  if (mixed && videoRuleCount !== 1) throw failure('creative_mixed_video_rule_invalid');
  const ctas = safeArray(feed.call_to_action_types).map((entry) => clean(entry).toUpperCase());
  if (ctas.length !== 1 || !['BOOK_NOW', 'LEARN_MORE', 'WHATSAPP_MESSAGE'].includes(ctas[0])) {
    throw failure('creative_cta_type_invalid', { classification: 'permanent', http_status: 400 });
  }
  const primaryUrl = clean(safeArray(feed.link_urls)[0]?.website_url);
  const sourceUrl = clean(asObject(payload.creative_sourcing_spec).source_url);
  let primaryParsed;
  try { primaryParsed = new URL(primaryUrl); } catch { primaryParsed = null; }
  const isWhatsAppDestination = Boolean(primaryParsed && primaryParsed.protocol === 'https:' && isWhatsAppHostname(primaryParsed.hostname));
  const isWebsiteDestination = Boolean(primaryParsed && primaryParsed.protocol === 'https:' && !isWhatsAppDestination && primaryUrl === sourceUrl);
  if ((ctas[0] === 'WHATSAPP_MESSAGE' && !isWhatsAppDestination) ||
      (ctas[0] !== 'WHATSAPP_MESSAGE' && !isWebsiteDestination)) {
    throw failure('creative_landing_page_invalid', { classification: 'permanent', http_status: 400 });
  }
  const freedom = asObject(payload.degrees_of_freedom_spec);
  if (Object.prototype.hasOwnProperty.call(freedom, 'standard_enhancements')) {
    throw failure('standard_enhancements_forbidden', { classification: 'permanent', http_status: 400 });
  }
  const features = asObject(freedom.creative_features_spec);
  for (const [feature, details] of Object.entries(features)) {
    if (!ALLOWED_CREATIVE_FEATURES.has(feature) || FORBIDDEN_CREATIVE_FEATURES.has(feature)) {
      throw failure(`creative_feature_forbidden:${feature}`, { classification: 'permanent', http_status: 400 });
    }
    if (clean(details && details.enroll_status).toUpperCase() !== 'OPT_IN') {
      throw failure(`creative_feature_not_opted_in:${feature}`, { classification: 'permanent', http_status: 400 });
    }
  }
  for (const feature of REQUIRED_CREATIVE_FEATURES) {
    if (!Object.prototype.hasOwnProperty.call(features, feature)) {
      throw failure(`creative_feature_required:${feature}`, { classification: 'permanent', http_status: 400 });
    }
  }
  const siteLinks = safeArray(asObject(payload.creative_sourcing_spec).site_links_spec);
  if (Boolean(features.site_extensions) !== (siteLinks.length >= 2 && siteLinks.length <= 4)) {
    throw failure('creative_site_extensions_mismatch', { classification: 'permanent', http_status: 400 });
  }
  const marker = `[sk:${shortKey(operationKey)}]`;
  const name = clean(payload.name) || 'Meta Ads Publish Creative';
  payload.name = name.includes(marker) ? name : `${name} ${marker}`.slice(0, 255);
  delete payload.access_token;
  return payload;
}

function validateNativeCarouselCreativePayload(payload, operationKey) {
  const story = asObject(payload.object_story_spec);
  const linkData = asObject(story.link_data);
  const cards = safeArray(linkData.child_attachments);
  if (!clean(story.page_id) || cards.length < 2 || cards.length > 10) {
    throw failure('native_carousel_contract_invalid', { classification: 'permanent', http_status: 400 });
  }
  const sourceUrl = clean(asObject(payload.creative_sourcing_spec).source_url);
  const rootLink = clean(linkData.link);
  let parsed;
  try { parsed = new URL(rootLink); } catch { parsed = null; }
  const rootCta = asObject(linkData.call_to_action);
  const ctaType = clean(rootCta.type).toUpperCase();
  const isWhatsApp = Boolean(parsed && isWhatsAppHostname(parsed.hostname));
  const isWebsiteBooking = Boolean(parsed && parsed.protocol === 'https:' && !isWhatsApp && rootLink === sourceUrl);
  if (!parsed || !(ctaType === 'WHATSAPP_MESSAGE' && isWhatsApp) && !(ctaType === 'BOOK_NOW' && isWebsiteBooking)) {
    throw failure('native_carousel_landing_page_invalid', { classification: 'permanent', http_status: 400 });
  }
  if (!['BOOK_NOW', 'WHATSAPP_MESSAGE'].includes(ctaType)) {
    throw failure('native_carousel_cta_invalid', { classification: 'permanent', http_status: 400 });
  }
  for (const [index, rawCard] of cards.entries()) {
    const card = asObject(rawCard);
    const cardLink = clean(card.link || rootLink);
    if (!clean(card.image_hash) || !clean(card.name) || cardLink !== rootLink) {
      throw failure(`native_carousel_card_${index + 1}_invalid`, { classification: 'permanent', http_status: 400 });
    }
    const cardCta = asObject(card.call_to_action);
    if (Object.keys(cardCta).length && clean(cardCta.type).toUpperCase() !== ctaType) {
      throw failure(`native_carousel_card_${index + 1}_cta_invalid`, { classification: 'permanent', http_status: 400 });
    }
  }
  if (Object.keys(asObject(payload.degrees_of_freedom_spec)).length) {
    throw failure('native_carousel_advantage_plus_unsupported', { classification: 'permanent', http_status: 400 });
  }
  const marker = `[sk:${shortKey(operationKey)}]`;
  const name = clean(payload.name) || 'Meta Ads Publish Native Carousel';
  payload.name = name.includes(marker) ? name : `${name} ${marker}`.slice(0, 255);
  delete payload.access_token;
  return payload;
}

function validatePausedAdsetPayload(value) {
  const source = asObject(value);
  const allowed = new Set([
    'name', 'campaign_id', 'billing_event', 'optimization_goal', 'destination_type', 'bid_strategy',
    'daily_budget', 'lifetime_budget', 'start_time', 'end_time', 'attribution_spec',
    'promoted_object', 'targeting', 'status',
  ]);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw failure(`adset_field_forbidden:${key}`, { classification: 'permanent', http_status: 400 });
  }
  const payload = sanitizeGraphValue(source);
  if (!clean(payload.name) || !clean(payload.campaign_id) || !Object.keys(asObject(payload.targeting)).length) {
    throw failure('adset_payload_incomplete', { classification: 'permanent', http_status: 400 });
  }
  if (clean(payload.status).toUpperCase() !== 'PAUSED') {
    throw failure('adset_must_be_paused', { classification: 'permanent', http_status: 400 });
  }
  if (!clean(payload.billing_event) || !clean(payload.optimization_goal)) {
    throw failure('adset_delivery_contract_missing', { classification: 'permanent', http_status: 400 });
  }
  delete payload.access_token;
  return payload;
}

function validatePausedCampaignPayload(value) {
  const source = asObject(value);
  const allowed = new Set(['name', 'objective', 'buying_type', 'special_ad_categories', 'is_adset_budget_sharing_enabled', 'status']);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw failure(`campaign_field_forbidden:${key}`, { classification: 'permanent', http_status: 400 });
  }
  const payload = sanitizeGraphValue(source);
  if (!clean(payload.name) || !PAUSED_CALIBRATION_CAMPAIGN_OBJECTIVES.has(clean(payload.objective))) {
    throw failure('campaign_payload_invalid', { classification: 'permanent', http_status: 400 });
  }
  if (clean(payload.status).toUpperCase() !== 'PAUSED') {
    throw failure('campaign_must_be_paused', { classification: 'permanent', http_status: 400 });
  }
  payload.buying_type = clean(payload.buying_type) || 'AUCTION';
  payload.special_ad_categories = safeArray(payload.special_ad_categories);
  payload.is_adset_budget_sharing_enabled = Boolean(payload.is_adset_budget_sharing_enabled);
  delete payload.access_token;
  return payload;
}

function isNativeCarouselRouteName(value) {
  const name = clean(value);
  return name.startsWith('[TEST-CAROUSEL-NATIVE]') || name.startsWith('[NATIVE-CAROUSEL]');
}

function validateNativeCarouselRoutePromotion(value) {
  const source = asObject(value);
  const allowed = new Set(['campaign_id', 'campaign_name', 'adsets', 'test_ad_ids']);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw failure(`native_carousel_route_field_forbidden:${key}`, { classification: 'permanent', http_status: 400 });
  }
  const campaignId = normalizeNumericId(source.campaign_id, 'campaign_id');
  const campaignName = clean(source.campaign_name);
  if (!campaignName.startsWith('[NATIVE-CAROUSEL]')) {
    throw failure('native_carousel_campaign_name_required', { classification: 'permanent', http_status: 400 });
  }
  const adsets = safeArray(source.adsets).map((entry, index) => {
    const adset = asObject(entry);
    const id = normalizeNumericId(adset.id, `adsets[${index}].id`);
    const name = clean(adset.name);
    if (!name.startsWith('[NATIVE-CAROUSEL]')) {
      throw failure(`native_carousel_adset_name_required:${index}`, { classification: 'permanent', http_status: 400 });
    }
    return { id, name };
  });
  if (!adsets.length || adsets.length > 10) {
    throw failure('native_carousel_adset_count_invalid', { classification: 'permanent', http_status: 400 });
  }
  const testAdIds = [...new Set(safeArray(source.test_ad_ids).map((id) => normalizeNumericId(id, 'test_ad_id')))];
  if (!testAdIds.length || testAdIds.length > 20) {
    throw failure('native_carousel_test_ad_count_invalid', { classification: 'permanent', http_status: 400 });
  }
  return { campaign_id: campaignId, campaign_name: campaignName, adsets, test_ad_ids: testAdIds };
}

function validateAdPayload(value, action) {
  const payload = sanitizeGraphValue(asObject(value));
  if (!clean(payload.name) || !clean(payload?.creative?.creative_id)) {
    throw failure('ad_payload_incomplete', { classification: 'permanent', http_status: 400 });
  }
  if (action === 'create_new' && !clean(payload.adset_id)) {
    throw failure('adset_id_required_for_create', { classification: 'permanent', http_status: 400 });
  }
  delete payload.access_token;
  return payload;
}

function validateBatchJobs(value) {
  const jobs = safeArray(value);
  if (!jobs.length || jobs.length > MAX_BATCH_JOBS) {
    throw failure('batch_job_count_invalid', { classification: 'permanent', http_status: 400 });
  }
  const targets = new Set();
  return jobs.map((raw, index) => {
    const job = asObject(raw);
    const action = clean(job.action);
    if (!['create_new', 'replace_existing'].includes(action)) {
      throw failure(`job_${index}_action_invalid`, { classification: 'permanent', http_status: 400 });
    }
    const operationKey = requireKey(job.operation_key, `jobs[${index}].operation_key`);
    const resourceKey = action === 'replace_existing'
      ? `ad:${normalizeNumericId(job.target_ad_id, 'target_ad_id')}`
      : `adset:${normalizeNumericId(job.ad_payload?.adset_id, 'adset_id')}:name:${shortKey(clean(job.ad_payload?.name))}`;
    if (targets.has(resourceKey)) {
      throw failure(`duplicate_batch_target:${resourceKey}`, { classification: 'permanent', http_status: 409 });
    }
    targets.add(resourceKey);
    return {
      ...sanitizeGraphValue(job),
      action,
      operation_key: operationKey,
      resource_key: resourceKey,
      destination_group: clean(job.destination_group),
      creative_group_key: clean(job.creative_group_key),
    };
  });
}

function buildStagedRecord(job, adId, previousState, result, createdNew) {
  return {
    operation_key: job.operation_key,
    token_id: job.token_id,
    api_version: job.api_version,
    account_id: job.account_id,
    destination_group: job.destination_group,
    creative_group_key: job.creative_group_key,
    creative_id: clean(job.creative_id || job.ad_payload?.creative?.creative_id),
    action: job.action,
    resource_key: job.resource_key,
    ad_id: adId,
    created_new: createdNew,
    files: safeArray(job.files).map((file) => ({
      id: clean(file && file.id),
      name: clean(file && file.name),
      ratio: clean(file && file.ratio),
    })).filter((file) => file.id),
    previous_state: sanitizeGraphValue(previousState),
    stage_result: sanitizeGraphValue(result),
  };
}

function previousStatePayload(previous) {
  const state = asObject(previous);
  const payload = {
    name: clean(state.name),
    status: clean(state.status),
    creative: clean(state.creative?.id) ? { creative_id: clean(state.creative.id) } : undefined,
    adset_id: clean(state.adset_id) || undefined,
  };
  return removeEmpty(payload);
}

function adStateMatches(current, intended) {
  const state = asObject(current);
  const payload = asObject(intended);
  if (payload.name && clean(state.name) !== clean(payload.name)) return false;
  if (payload.status && clean(state.status) !== clean(payload.status)) return false;
  if (payload.adset_id && clean(state.adset_id) !== clean(payload.adset_id)) return false;
  if (payload.creative?.creative_id && clean(state.creative?.id) !== clean(payload.creative.creative_id)) return false;
  return true;
}

async function upsertJob(env, runId, record, status) {
  const now = nowIso();
  const requestHash = await sha256(stableStringify(record));
  await dbRun(env,
    `INSERT INTO meta_ads_publish_jobs (
      id, run_id, operation_key, request_hash, destination_group, creative_group_key,
      action, resource_key, status, previous_state_json, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_key) DO UPDATE SET
      status = excluded.status,
      previous_state_json = excluded.previous_state_json,
      result_json = excluded.result_json,
      updated_at = excluded.updated_at`,
    crypto.randomUUID(), runId, record.operation_key, requestHash,
    record.destination_group, record.creative_group_key, record.action, record.resource_key,
    status, limitedJson(record.previous_state), limitedJson(record), now, now,
  );
}

async function updateJobStatus(env, operationKey, status, result) {
  await dbRun(env,
    `UPDATE meta_ads_publish_jobs SET status = ?, result_json = ?, updated_at = ? WHERE operation_key = ?`,
    status, limitedJson(result), nowIso(), operationKey,
  );
}

async function setRunState(env, runId, status, summary) {
  await dbRun(env,
    `UPDATE meta_ads_publish_runs SET status = ?, summary_json = ?, updated_at = ? WHERE id = ?`,
    status, limitedJson(summary), nowIso(), runId,
  );
}

async function acquireLocks(env, runId, operationKey, resourceKeys) {
  const keys = [...new Set(safeArray(resourceKeys).map(clean).filter(Boolean))].sort();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const newlyAcquired = [];
  try {
    for (const resourceKey of keys) {
      const current = await dbFirst(env,
        `SELECT resource_key, run_id, operation_key, expires_at FROM meta_ads_publish_locks WHERE resource_key = ?`,
        resourceKey,
      );
      const reentrant = Boolean(
        current &&
        Date.parse(current.expires_at) > Date.now() &&
        clean(current.run_id) === runId &&
        clean(current.operation_key) === operationKey,
      );
      // A run is not a blanket lock owner. Re-entrancy is permitted only for
      // the same idempotent operation so a same-run rollback/ensure cannot
      // replace a stage batch's fresh ad-set attestation between its Graph GET
      // and ad POST.
      if (
        current &&
        Date.parse(current.expires_at) > Date.now() &&
        !reentrant
      ) {
        throw new Error(`resource_locked:${resourceKey}`);
      }
      await dbRun(env,
        `INSERT INTO meta_ads_publish_locks (
          resource_key, run_id, operation_key, heartbeat_at, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(resource_key) DO UPDATE SET
          run_id = excluded.run_id,
          operation_key = excluded.operation_key,
          heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
        WHERE meta_ads_publish_locks.expires_at <= ? OR
          (meta_ads_publish_locks.run_id = ? AND meta_ads_publish_locks.operation_key = ?)`,
        resourceKey, runId, operationKey, now, expiresAt, now, now, now, runId, operationKey,
      );
      const acquired = await dbFirst(env,
        `SELECT run_id, operation_key FROM meta_ads_publish_locks WHERE resource_key = ?`,
        resourceKey,
      );
      if (
        !acquired ||
        clean(acquired.run_id) !== runId ||
        clean(acquired.operation_key) !== operationKey
      ) {
        throw new Error(`resource_locked:${resourceKey}`);
      }
      if (!reentrant) newlyAcquired.push(resourceKey);
    }
  } catch (error) {
    if (newlyAcquired.length) {
      try {
        await releaseSpecificOperationLocks(env, runId, operationKey, newlyAcquired);
      } catch {
        // The caller must fail closed if D1 cannot prove that a partial lease
        // was released. Retrying a Graph mutation in that state could race a
        // stale owner until the bounded lease expires.
        throw new Error('resource_lock_cleanup_failed');
      }
    }
    throw error;
  }
}

async function releaseSpecificOperationLocks(env, runId, operationKey, resourceKeys) {
  const keys = [...new Set(safeArray(resourceKeys).map(clean).filter(Boolean))].sort();
  if (!keys.length) return;
  const placeholders = keys.map(() => '?').join(', ');
  await dbRun(env,
    `DELETE FROM meta_ads_publish_locks
      WHERE run_id = ? AND operation_key = ? AND resource_key IN (${placeholders})`,
    runId,
    operationKey,
    ...keys,
  );
}

async function releaseOperationLocks(env, runId, operationKey) {
  await dbRun(env,
    `DELETE FROM meta_ads_publish_locks
      WHERE run_id = ? AND operation_key = ? AND resource_key NOT LIKE 'batch:%' AND resource_key NOT LIKE 'drive:%'`,
    runId, operationKey,
  );
}

async function releaseRunLocks(env, runId) {
  await dbRun(env, `DELETE FROM meta_ads_publish_locks WHERE run_id = ?`, runId);
}

function deriveResourceKeys(action, body) {
  if (action === 'stage_batch') {
    const jobs = validateBatchJobs(body.jobs);
    return [
      ...jobs.map((job) => job.resource_key),
      ...jobs.map((job) => `adset-contract:${normalizeNumericId(job.account_id, 'account_id')}:${normalizeNumericId(job.destination_adset_id, 'destination_adset_id')}`),
    ];
  }
  if (['activate_batch', 'rollback_batch'].includes(action)) return [`run:${clean(body.stage_operation_key)}`];
  if (action === 'create_creative') return [`creative:${clean(body.account_id)}:${shortKey(body.operation_key)}`];
  if (action === 'create_campaign') return [`campaign:${clean(body.account_id)}:${shortKey(body.operation_key)}`];
  if (action === 'create_adset') return [`adset:${clean(body.account_id)}:${shortKey(body.operation_key)}`];
  if (action === 'ensure_adset_conversion_contract') {
    return [`adset-contract:${clean(body.account_id)}:${clean(body.object_id || body.adset_id)}`];
  }
  if (action === 'rollback_adset_conversion_contract') {
    return [
      `adset-contract:${clean(body.account_id)}:${clean(body.object_id || body.adset_id)}`,
      `adset-contract-snapshot:${clean(body.snapshot_id)}`,
    ];
  }
  if (action === 'upload_image') return [`image:${clean(body.account_id)}:${shortKey(body.operation_key)}`];
  if (VIDEO_UPLOAD_ACTIONS.includes(action)) {
    const videoKey = clean(body.video_id || body.object_id || body.upload_session_id || body.source_file_id || body.operation_key);
    return [`video:${clean(body.account_id)}:${shortKey(videoKey)}`];
  }
  return [];
}

function normalizeMetaError(body, status, headers, action = '') {
  const error = asObject(body?.error);
  const code = Number(error.code || 0);
  const subcode = Number(error.error_subcode || 0);
  // Meta can acknowledge an ad-image upload before that hash is available to
  // the adcreative endpoint. It reports this propagation window as code 100,
  // subcode 2446386 (normally classified as permanent), although retrying the
  // same idempotent creative request after a short delay succeeds.
  const propagationRetry = clean(action) === 'create_creative' && code === 100 && subcode === IMAGE_PROPAGATION_SUBCODE;
  // Meta occasionally returns this generic creative-construction subcode while
  // explicitly asking the caller to retry. It is safe to retry the same
  // idempotent operation a bounded number of times; do not generalize this to
  // other code-100 validation failures.
  const creativeRetry = clean(action) === 'create_creative' &&
    code === 100 &&
    subcode === CREATIVE_RETRY_SUBCODE &&
    /try again later|tente novamente mais tarde/i.test(clean(error.error_user_msg || error.message));
  const transient = propagationRetry || creativeRetry || error.is_transient === true || status === 408 || status === 429 || status >= 500;
  const auth = [190, 102, 10, 200].includes(code) || status === 401 || status === 403;
  const permanent = auth || (!(propagationRetry || creativeRetry) && code === 100) || (!transient && status >= 400 && status < 500);
  return {
    message: redactText(error.error_user_msg || error.message || `Meta Graph HTTP ${status}`),
    classification: auth ? 'auth' : permanent ? 'permanent' : transient ? 'transient' : 'unknown',
    retryable: transient && !permanent,
    propagation_retry: propagationRetry,
    creative_retry: creativeRetry,
    ambiguous: false,
    http_status: status,
    code,
    error_subcode: subcode,
    fbtrace_id: clean(error.fbtrace_id),
    retry_after_seconds: retryAfterSeconds(headers),
  };
}

function normalizeFailure(error) {
  if (error && typeof error === 'object' && error.classification) {
    return {
      message: redactText(error.message || 'meta_operation_failed'),
      classification: clean(error.classification),
      retryable: Boolean(error.retryable),
      ambiguous: Boolean(error.ambiguous),
      http_status: Number(error.http_status || 502),
      code: Number(error.code || 0),
      error_subcode: Number(error.error_subcode || 0),
      fbtrace_id: clean(error.fbtrace_id),
      compensation: error.compensation,
    };
  }
  const name = clean(error?.name);
  const aborted = name === 'AbortError';
  return {
    message: aborted ? 'meta_graph_timeout' : redactText(error?.message || 'meta_graph_network_error'),
    classification: 'transient',
    retryable: true,
    ambiguous: true,
    http_status: 502,
    code: 0,
    error_subcode: 0,
    fbtrace_id: '',
  };
}

function failure(message, extra = {}) {
  return Object.assign(new Error(message), {
    classification: 'permanent', retryable: false, ambiguous: false, http_status: 400, ...extra,
  });
}

function retryDelayMs(attempt, headers, startedAt, failureState = {}) {
  const elapsed = Date.now() - startedAt;
  const remaining = MAX_RETRY_WINDOW_MS - elapsed;
  if (remaining <= 0) return 0;
  const retryAfter = retryAfterSeconds(headers) * 1000;
  const propagationBackoff = failureState.propagation_retry === true
    ? Math.min(60_000, IMAGE_PROPAGATION_BASE_DELAY_MS * (2 ** (attempt - 1)))
    : 0;
  const backoff = propagationBackoff || Math.min(30_000, (2 ** (attempt - 1)) * 1000 + Math.floor(Math.random() * 500));
  return Math.min(remaining, retryAfter || backoff);
}

function retryAfterSeconds(headers) {
  const value = Number(headers?.get?.('retry-after') || 0);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 300) : 0;
}

function extractRateUsage(headers) {
  const out = {};
  for (const name of ['x-business-use-case-usage', 'x-ad-account-usage', 'x-app-usage']) {
    const raw = clean(headers?.get?.(name));
    if (!raw) continue;
    try { out[name] = JSON.parse(raw); } catch { out[name] = { unparsed: true }; }
  }
  return out;
}

function maxRateUsage(value) {
  let max = 0;
  if (Array.isArray(value)) {
    for (const item of value) max = Math.max(max, maxRateUsage(item));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['call_count', 'total_cputime', 'total_time'].includes(key) && Number.isFinite(Number(item))) {
        max = Math.max(max, Number(item));
      } else {
        max = Math.max(max, maxRateUsage(item));
      }
    }
  }
  return max;
}

function mergeRateUsage(left, right) {
  return { ...asObject(left), ...asObject(right) };
}

function graphUrl(apiVersion, path, query = {}) {
  const version = normalizeApiVersion(apiVersion);
  const cleanPath = clean(path).replace(/^\/+/, '');
  if (!cleanPath || /[^A-Za-z0-9_/-]/.test(cleanPath)) throw failure('invalid_graph_path');
  const url = new URL(`${GRAPH_ORIGIN}/${version}/${cleanPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function graphVideoUrl(apiVersion, path) {
  const version = normalizeApiVersion(apiVersion);
  const cleanPath = clean(path).replace(/^\/+/, '');
  if (!cleanPath || /[^A-Za-z0-9_/-]/.test(cleanPath)) throw failure('invalid_graph_video_path');
  return `${GRAPH_VIDEO_ORIGIN}/${version}/${cleanPath}`;
}

function validatePagingUrl(value, apiVersion) {
  const raw = clean(value);
  if (!raw) return '';
  const url = new URL(raw);
  if (url.origin !== GRAPH_ORIGIN || !url.pathname.startsWith(`/${normalizeApiVersion(apiVersion)}/`)) {
    throw failure('invalid_meta_paging_url', { classification: 'permanent', http_status: 502 });
  }
  url.searchParams.delete('access_token');
  return url.toString();
}

function appendAppSecretProof(value, proof) {
  if (!proof) return value;
  const url = new URL(value);
  url.searchParams.set('appsecret_proof', proof);
  return url.toString();
}

function jsonRequest(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(removeEmpty(sanitizeGraphValue(body))),
  };
}

async function parseGraphBody(graphResponse) {
  const text = await graphResponse.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw_response: redactText(text.slice(0, 1000)) }; }
}

function normalizeApiVersion(value) {
  const version = clean(value || 'v25.0');
  if (!/^v(?:2[5-9]|[3-9][0-9])\.0$/.test(version)) throw failure('unsupported_api_version');
  return version;
}

function normalizeNumericId(value, label) {
  const id = clean(value).replace(/^act_/, '');
  if (!/^\d{5,30}$/.test(id)) throw failure(`${label}_invalid`);
  return id;
}

function normalizeVideoFileSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
    throw failure('video_size_invalid', { classification: 'permanent', http_status: 413 });
  }
  return size;
}

function normalizeUploadSessionId(value) {
  const id = clean(value);
  if (!/^\d{5,100}$/.test(id)) throw failure('upload_session_id_invalid');
  return id;
}

function normalizeVideoOffset(value, label) {
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_VIDEO_BYTES) throw failure(`${label}_invalid`);
  return offset;
}

function normalizeVideoUploadResponse(value, phase) {
  const result = sanitizeGraphValue(asObject(value));
  if (phase === 'start') {
    normalizeUploadSessionId(result.upload_session_id);
    normalizeNumericId(result.video_id, 'video_id');
    normalizeVideoOffset(result.start_offset, 'start_offset');
    normalizeVideoOffset(result.end_offset, 'end_offset');
  } else if (phase === 'transfer') {
    normalizeVideoOffset(result.start_offset, 'start_offset');
    normalizeVideoOffset(result.end_offset, 'end_offset');
  } else if (result.success !== true && clean(result.success) !== 'true') {
    throw failure('video_finish_not_confirmed', { classification: 'permanent', http_status: 502 });
  }
  return result;
}

function normalizeHosts(value) {
  return [...new Set(safeArray(value).map((entry) => clean(entry).toLowerCase()).filter((entry) => /^[a-z0-9.-]+$/.test(entry)))];
}

// URL parameter names are deliberately generic rather than UTM-shaped. Keep
// only the RFC 3986 unreserved spelling in names; values additionally allow
// common Meta macros and query-safe punctuation without ever decoding them.
const URL_TAG_PARAMETER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const URL_TAG_FORBIDDEN_KEY_PATTERN = /(?:token|secret|password|authorization|signature|api_?key)/i;
const URL_TAG_VALUE_PATTERN = /^[A-Za-z0-9._~%{}|:+,\-@!$'()*\/;=]+$/;
const TRACKING_PROFILE_REF_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
const TRACKING_REQUIREMENTS = new Set(['required', 'not_required']);
const TRACKING_RECONCILIATION_MODE = 'enforce_from_authorized_source';

// Meta expects url_tags to be a query-string fragment on the AdCreative, not
// a URL. Keep the value deliberately narrow: it may contain standard UTM
// parameters and Meta macros, but no URL, fragment, whitespace or secret-like
// parameter names can cross into a Graph mutation body.
function normalizeUrlTags(value, { required = false } = {}) {
  const raw = String(value ?? '');
  if (!raw) {
    if (required) throw failure('url_tags_required');
    return '';
  }
  // Preserve this fragment byte-for-byte after validation. It is passed to
  // JSON.stringify exactly once by jsonRequest; do not decode or re-encode it
  // here, otherwise an already encoded value such as `%20` becomes `%2520`.
  if (raw !== raw.trim() || raw.length > 1_000 || /[?#\s\u0000-\u001f]/.test(raw) || /:\/\//.test(raw) || /%(?![0-9A-Fa-f]{2})/.test(raw)) {
    throw failure('url_tags_invalid');
  }
  const seen = new Set();
  const pairs = raw.split('&');
  if (!pairs.length) throw failure('url_tags_invalid');
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    if (separator <= 0) throw failure('url_tags_invalid');
    const key = pair.slice(0, separator).toLowerCase();
    const parameterValue = pair.slice(separator + 1);
    if (!URL_TAG_PARAMETER_KEY_PATTERN.test(key) || URL_TAG_FORBIDDEN_KEY_PATTERN.test(key) || seen.has(key) || !parameterValue || !URL_TAG_VALUE_PATTERN.test(parameterValue)) {
      throw failure('url_tags_invalid');
    }
    seen.add(key);
  }
  return raw;
}

function normalizeTrackingContract(value, profilesValue = {}, targetAdsetId = '') {
  const source = asObject(value);
  const urlTags = normalizeUrlTags(source.url_tags);
  const profileRef = normalizeTrackingProfileRef(source.profile_ref);
  const profile = asObject(asObject(profilesValue)[profileRef]);
  const destinationKind = normalizeDestinationKind(profile.destination_kind, { optional: true });
  const websiteRequirement = normalizeTrackingRequirement(profile.website_event_requirement, 'website_event_requirement', { optional: true });
  const offlineRequirement = normalizeTrackingRequirement(profile.offline_event_dataset_requirement, 'offline_event_dataset_requirement', { optional: true });
  const sourceAdsetId = clean(profile.source_adset_id);
  const profileConfigured = Boolean(
    profileRef &&
    /^\d{5,30}$/.test(sourceAdsetId) &&
    destinationKind === 'website' &&
    websiteRequirement &&
    offlineRequirement,
  );
  // Only an explicitly marked, distinct source/target profile may be used by
  // the deployment workflow's reversible staging exercise. This marker does
  // not expose either identifier to Orb or to the workflow evidence.
  const stagingSyntheticFixture = profileConfigured &&
    profile.staging_synthetic_fixture === true &&
    sourceAdsetId !== clean(targetAdsetId) &&
    websiteRequirement === 'required' &&
    offlineRequirement === 'required';
  const productionUrlTagsReadbackFixtureConfigured = profileConfigured &&
    hasValidProductionUrlTagsReadbackFixture(source.production_url_tags_readback_fixture);
  return {
    url_tags: urlTags,
    url_tags_configured: Boolean(urlTags),
    profile_ref: profileRef,
    profile_configured: profileConfigured,
    destination_kind: profileConfigured ? destinationKind : '',
    website_event_requirement: profileConfigured ? websiteRequirement : 'unconfigured',
    offline_event_dataset_requirement: profileConfigured ? offlineRequirement : 'unconfigured',
    reconciliation: profileConfigured ? TRACKING_RECONCILIATION_MODE : 'unconfigured',
    staging_synthetic_fixture: stagingSyntheticFixture,
    // The fixture IDs remain private. The public config reports only whether a
    // production-safe, paused readback fixture is available for the deployed
    // diagnostic action.
    production_url_tags_readback_fixture_configured: productionUrlTagsReadbackFixtureConfigured,
  };
}

function hasValidProductionUrlTagsReadbackFixture(value) {
  const fixture = asObject(value);
  return /^\d{5,30}$/.test(clean(fixture.ad_id)) && /^\d{5,30}$/.test(clean(fixture.creative_id));
}

function normalizeTrackingProfileRef(value) {
  const profileRef = clean(value);
  return TRACKING_PROFILE_REF_PATTERN.test(profileRef) ? profileRef : '';
}

function normalizeDestinationKind(value, { optional = false } = {}) {
  const kind = clean(value).toLowerCase();
  if (!kind && optional) return '';
  if (kind === 'website' || kind === 'whatsapp') return kind;
  throw failure('destination_kind_invalid');
}

function normalizeTrackingRequirement(value, label, { optional = false } = {}) {
  const requirement = clean(value).toLowerCase();
  if (!requirement && optional) return '';
  if (TRACKING_REQUIREMENTS.has(requirement)) return requirement;
  throw failure(`${label}_invalid`);
}

function normalizeSnapshotId(value) {
  const id = clean(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw failure('snapshot_id_invalid');
  }
  return id;
}

function safeTrackingEnum(value) {
  const normalized = clean(value).toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(normalized) ? normalized : '';
}

function summarizeAdsetConversionTracking(value) {
  const adset = asObject(value);
  const promotedObject = asObject(adset.promoted_object);
  const promotedKeys = Object.keys(promotedObject)
    .filter((key) => /^[a-z_]{1,80}$/i.test(key))
    .sort();
  const pixelConfigured = Boolean(clean(promotedObject.pixel_id));
  const customEventType = safeTrackingEnum(promotedObject.custom_event_type);
  const customConversionConfigured = Boolean(clean(promotedObject.custom_conversion_id));
  const offlineDatasetConfigured = Boolean(clean(promotedObject.offline_conversion_data_set_id));
  const attributionRules = safeArray(adset.attribution_spec);
  const websiteEventConfigured = pixelConfigured && Boolean(customEventType || customConversionConfigured);
  return {
    billing_event: safeTrackingEnum(adset.billing_event),
    optimization_goal: safeTrackingEnum(adset.optimization_goal),
    destination_type: safeTrackingEnum(adset.destination_type),
    attribution_spec: {
      configured: attributionRules.length > 0,
      rule_count: Math.min(attributionRules.length, 20),
    },
    promoted_object: {
      present: promotedKeys.length > 0,
      keys: promotedKeys,
      pixel_configured: pixelConfigured,
      custom_event_type: customEventType,
      custom_conversion_configured: customConversionConfigured,
      offline_conversion_dataset_configured: offlineDatasetConfigured,
    },
    website_event: {
      configured: websiteEventConfigured,
    },
    offline_event_dataset: {
      configured: offlineDatasetConfigured,
    },
  };
}

function isAllowedHostname(hostname, allowedHosts) {
  const normalized = clean(hostname).replace(/\.$/, '').toLowerCase();
  return normalizeHosts(allowedHosts).some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

function isWhatsAppHostname(hostname) {
  const normalized = clean(hostname).replace(/\.$/, '').toLowerCase();
  return WHATSAPP_HOSTS.has(normalized) || normalized.endsWith('.whatsapp.com');
}

function parseLandingUrl(value, allowedHosts) {
  try {
    const url = new URL(clean(value));
    if (isWhatsAppHostname(url.hostname)) {
      return { ok: false, error: 'landing_page_whatsapp_forbidden', hostname: url.hostname };
    }
    if (url.protocol !== 'https:' || url.username || url.password || !isAllowedHostname(url.hostname, allowedHosts)) {
      return { ok: false, error: 'landing_page_invalid_or_not_allowed', hostname: clean(url.hostname) || 'invalid' };
    }
    url.hash = '';
    return { ok: true, url: url.toString(), hostname: url.hostname };
  } catch {
    return { ok: false, error: 'landing_page_url_invalid', hostname: 'invalid' };
  }
}

function normalizeLandingPageMap(value, allowedHosts) {
  const pages = {};
  const errors = [];
  const seen = new Set();
  for (const [rawKey, rawUrl] of Object.entries(asObject(value))) {
    const key = clean(rawKey);
    const normalizedKey = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key || key.length > 200 || !normalizedKey || seen.has(normalizedKey)) {
      errors.push({ key: key.slice(0, 200), error: seen.has(normalizedKey) ? 'landing_page_key_duplicate' : 'landing_page_key_invalid' });
      continue;
    }
    seen.add(normalizedKey);
    const parsed = parseLandingUrl(rawUrl, allowedHosts);
    if (!parsed.ok) {
      errors.push({ key, error: parsed.error, hostname: parsed.hostname });
      continue;
    }
    pages[key] = parsed.url;
  }
  return { pages, errors };
}

async function validateLandingPagesOnline(pages, allowedHosts, env) {
  const results = {};
  const errors = [];
  for (const [key, configuredUrl] of Object.entries(asObject(pages))) {
    let currentUrl = configuredUrl;
    let redirectCount = 0;
    let completed = false;
    try {
      while (redirectCount <= MAX_LANDING_REDIRECTS) {
        const parsed = parseLandingUrl(currentUrl, allowedHosts);
        if (!parsed.ok) {
          errors.push({ key, error: parsed.error, hostname: parsed.hostname });
          break;
        }
        const landingFetch = env.LANDING_PAGE_FETCH || fetch;
        const pageResponse = await landingFetch(parsed.url, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'User-Agent': 'Skincos-Meta-Ads-Preflight/1.0', Range: 'bytes=0-0' },
        });
        const location = clean(pageResponse.headers.get('location'));
        if (pageResponse.status >= 300 && pageResponse.status < 400 && location) {
          if (pageResponse.body && typeof pageResponse.body.cancel === 'function') await pageResponse.body.cancel();
          redirectCount += 1;
          if (redirectCount > MAX_LANDING_REDIRECTS) {
            errors.push({ key, error: 'landing_page_redirect_limit_exceeded' });
            break;
          }
          currentUrl = new URL(location, parsed.url).toString();
          continue;
        }
        if (pageResponse.body && typeof pageResponse.body.cancel === 'function') await pageResponse.body.cancel();
        if (pageResponse.status < 200 || pageResponse.status >= 400) {
          errors.push({ key, error: 'landing_page_http_error', status: pageResponse.status });
          break;
        }
        results[key] = {
          ok: true,
          final_url: parsed.url,
          final_hostname: parsed.hostname,
          redirect_count: redirectCount,
          status: pageResponse.status,
        };
        completed = true;
        break;
      }
      if (!completed && !errors.some((entry) => entry.key === key)) {
        errors.push({ key, error: 'landing_page_validation_incomplete' });
      }
    } catch (error) {
      errors.push({ key, error: 'landing_page_fetch_failed', detail: redactText(error && error.message) });
    }
  }
  return { results, errors };
}

function normalizeFiles(value) {
  const files = safeArray(value);
  if (files.length > 300) throw failure('too_many_files', { http_status: 413 });
  const seen = new Set();
  return files.map((entry) => {
    const file = asObject(entry);
    const id = clean(file.id);
    const name = clean(file.name);
    if (!id || !name || seen.has(id)) throw failure('invalid_or_duplicate_file');
    seen.add(id);
    return {
      id,
      name,
      md5_checksum: clean(file.md5_checksum || file.md5Checksum),
      modified_time: clean(file.modified_time || file.modifiedTime),
      size: clean(file.size),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

async function readOperationRequest(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_MULTIPART_REQUEST_BYTES) return { error: 'request_too_large', status: 413 };
  const contentType = clean(request.headers.get('content-type')).toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await request.formData();
      const body = JSON.parse(clean(form.get('request')) || '{}');
      const file = form.get('file');
      return { body: asObject(body), file: file instanceof Blob ? file : null };
    } catch {
      return { error: 'invalid_multipart_payload', status: 400 };
    }
  }
  return { body: await readObject(request), file: null };
}

function operationHashInput(body, file) {
  const copy = sanitizeGraphValue({ ...body });
  delete copy.request_hash;
  if (clean(copy.action) === 'start_video_upload') {
    // The source fingerprint and normalization contract identify a semantic
    // replay. Encoder metadata may change the normalized byte count.
    delete copy.file_size;
    delete copy.file_checksum;
    delete copy.resume_video_id;
  }
  if (['transfer_video_chunk', 'finish_video_upload'].includes(clean(copy.action))) {
    delete copy.semantic_replay_video_id;
  }
  return {
    ...copy,
    file: file instanceof Blob ? { size: file.size, type: file.type, name: file.name || '' } : null,
  };
}

function deriveRunFiles(row) {
  return parseArray(row.files_json);
}

function serializeRun(row) {
  return {
    id: row.id,
    batch_fingerprint: row.batch_fingerprint,
    workflow_execution_id: row.workflow_execution_id,
    config_revision: row.config_revision,
    status: row.status,
    files: deriveRunFiles(row),
    summary: parseObject(row.summary_json),
    error: parseObject(row.error_json),
    heartbeat_at: row.heartbeat_at,
    lock_expires_at: row.lock_expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeJob(row) {
  return {
    id: row.id,
    operation_key: row.operation_key,
    destination_group: row.destination_group,
    creative_group_key: row.creative_group_key,
    action: row.action,
    resource_key: row.resource_key,
    status: row.status,
    previous_state: parseObject(row.previous_state_json),
    result: parseObject(row.result_json),
    error: parseObject(row.error_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeOperation(row) {
  return {
    operation_key: row.operation_key,
    action: row.action,
    status: row.status,
    attempt_count: Number(row.attempt_count || 0),
    result: parseObject(row.result_json),
    error: parseObject(row.error_json),
    fbtrace_id: nullable(row.meta_trace_id),
    rate_usage: parseObject(row.rate_usage_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeEvent(row) {
  return {
    id: row.id,
    status: row.status,
    payload: parseObject(row.payload_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function stripJobForSummary(record) {
  return {
    operation_key: record.operation_key,
    destination_group: record.destination_group,
    creative_group_key: record.creative_group_key,
    action: record.action,
    ad_id: record.ad_id,
    creative_id: record.creative_id,
    created_new: record.created_new,
    files: safeArray(record.files),
  };
}

function sanitizeGraphValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeGraphValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(access_token|token|fbToken|authorization)$/i.test(key)) continue;
    out[key] = sanitizeGraphValue(item);
  }
  return out;
}

function removeEmpty(value) {
  if (Array.isArray(value)) return value.map(removeEmpty).filter((item) => item !== undefined && item !== null && item !== '');
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const cleaned = removeEmpty(item);
    if (cleaned === undefined || cleaned === null || cleaned === '') continue;
    if (Array.isArray(cleaned) && cleaned.length === 0) continue;
    if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) continue;
    out[key] = cleaned;
  }
  return out;
}

async function loadRun(env, runId) {
  return dbFirst(env, `SELECT * FROM meta_ads_publish_runs WHERE id = ?`, runId);
}

async function dbFirst(env, sql, ...values) {
  return env.TOKEN_VAULT_DB.prepare(sql).bind(...values).first();
}

async function dbAll(env, sql, ...values) {
  const result = await env.TOKEN_VAULT_DB.prepare(sql).bind(...values).all();
  return result.results || [];
}

async function dbRun(env, sql, ...values) {
  return env.TOKEN_VAULT_DB.prepare(sql).bind(...values).run();
}

async function readObject(request) {
  try { return asObject(await request.json()); } catch { return {}; }
}

function response(data, status = 200) {
  return new Response(JSON.stringify(sanitizeGraphValue(data)), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function limitedJson(value) {
  const serialized = JSON.stringify(sanitizeGraphValue(value || {}));
  if (serialized.length > 1_000_000) throw failure('journal_payload_too_large', { http_status: 413 });
  return serialized;
}

function parseObject(value) {
  try { return asObject(typeof value === 'string' ? JSON.parse(value || '{}') : value); } catch { return {}; }
}

function parseArray(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value;
    return safeArray(parsed);
  } catch { return []; }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value) {
  return String(value ?? '').trim();
}

function nullable(value) {
  return clean(value) || null;
}

function requireHash(value, label) {
  const hash = clean(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw failure(`${label}_invalid`);
  return hash;
}

function requireKey(value, label) {
  const key = clean(value);
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(key)) throw failure(`${label}_invalid`);
  return key;
}

function shortKey(value) {
  const text = clean(value).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return text.slice(0, 12) || 'unknown';
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactText(value) {
  return clean(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[REDACTED]')
    .slice(0, 1000);
}

export const __test = Object.freeze({
  acquireLocks,
  createCreative,
  createOrResumeRun,
  currentTrackingBindingRevision,
  creativeReadFields: CREATIVE_READ_FIELDS,
  campaignReadFields: CAMPAIGN_READ_FIELDS,
  adsetPlacementFields: ADSET_PLACEMENT_FIELDS,
  adsetConversionContractFields: ADSET_CONVERSION_CONTRACT_FIELDS,
  adsetReadFields: ADSET_READ_FIELDS,
  graphRequest,
  jsonRequest,
  graphVideoUrl,
  getVideoStatus,
  maxRateUsage,
  normalizeApiVersion,
  normalizeFailure,
  normalizeUploadSessionId,
  normalizeVideoFileSize,
  normalizeVideoOffset,
  normalizeVideoUploadResponse,
  normalizeMetaError,
  normalizeTrackingContract,
  normalizeUrlTags,
  ensureAdsetConversionContract,
  rollbackAdsetConversionContract,
  readAdsetConversionContract,
  readAuthorizedCreativeUrlTagsContract,
  deriveResourceKeys,
  retryDelayMs,
  readAdsetPlacements,
  normalizeLandingPageMap,
  operationHashInput,
  startVideoUpload,
  transferVideoChunk,
  finishVideoUpload,
  videoUploadActions: VIDEO_UPLOAD_ACTIONS,
  parseLandingUrl,
  previousStatePayload,
  sanitizeGraphValue,
  summarizeAdsetConversionTracking,
  stageBatch,
  stableStringify,
  validateAdPayload,
  validatePausedCampaignPayload,
  validatePausedAdsetPayload,
  validateNativeCarouselRoutePromotion,
  validateBatchJobs,
  validateCreativePayload,
  validateLandingPagesOnline,
  validatePagingUrl,
  updateAdWithReconciliation,
});
