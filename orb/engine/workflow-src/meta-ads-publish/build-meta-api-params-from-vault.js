function safeString(value) { return String(value ?? '').trim(); }
function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function normalizeCompact(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

const SAFE_LANDING_PAGE_BY_DESTINATION = Object.freeze({
  barrashoppingsul: 'https://espacofacial.com/agendamento?unit=barrashoppingsul',
  novohamburgo: 'https://espacofacial.com/agendamento?unit=novo-hamburgo',
});
const SAFE_WHATSAPP_DESTINATION_URL = 'https://api.whatsapp.com/send';
const WORKFLOW_CONTRACT_REVISION = 'meta_destination_contract_v18_live_campaign_cta';

const root = $input.first()?.json || {};
if (root.ok !== true || root.ready !== true) {
  throw new Error(`Meta Publish gateway nao esta pronto: ${JSON.stringify(root.invalid || root.error || {})}`);
}

const gatewayContractRevision = safeString(asObject(root.capabilities).workflow_contract_revision);
if (gatewayContractRevision !== WORKFLOW_CONTRACT_REVISION) {
  throw new Error(`Meta Publish gateway com revisao de contrato divergente: esperado ${WORKFLOW_CONTRACT_REVISION}, recebido ${gatewayContractRevision || 'ausente'}.`);
}

// The workflow and the Token Vault must evolve as one contract. Verify the
// complete resumable-video API before any batch work starts, even for a static
// batch: a missing action is a deployment mismatch, not a media error.
const requiredVideoActions = [
  'start_video_upload',
  'transfer_video_chunk',
  'finish_video_upload',
  'get_video_status',
];
const videoUpload = asObject(asObject(root.capabilities).video_upload);
const supportedVideoActions = Array.isArray(videoUpload.supported_actions)
  ? videoUpload.supported_actions.map(safeString).filter(Boolean)
  : [];
const missingVideoActions = requiredVideoActions.filter((action) => !supportedVideoActions.includes(action));
if (missingVideoActions.length) {
  throw new Error(`Meta Publish gateway sem contrato de upload de video: ${missingVideoActions.join(', ')}.`);
}
if (Number(videoUpload.max_file_bytes) < 90 * 1024 * 1024 || Number(videoUpload.max_chunk_bytes) < 16 * 1024 * 1024) {
  throw new Error('Meta Publish gateway declarou limites insuficientes para upload de video.');
}

const destinations = Array.isArray(root.destinations) ? root.destinations : [];
const required = [
  'token_id',
  'api_version',
  'account_id',
  'campaign_id',
  'adset_id',
  'page_id',
  'instagram_user_id',
  'destination_group',
];

const rows = destinations.map((entry) => {
  const item = asObject(entry);
  const missing = required.filter((key) => !safeString(item[key]));
  if (missing.length) {
    throw new Error(`Meta Publish config incompleta em ${item.token_id || item.destination_group || 'destino'}: ${missing.join(', ')}`);
  }
  const configuredLandingPages = asObject(item.landing_pages_by_creative_group);
  const destinationKey = normalizeCompact(item.destination_group);
  const safeFallbackLandingPage = SAFE_LANDING_PAGE_BY_DESTINATION[destinationKey] || '';
  if (!Object.keys(configuredLandingPages).length && !safeFallbackLandingPage) {
    throw new Error(`Meta Publish sem landing page segura para o destino ${safeString(item.destination_group)}.`);
  }
  const landingPages = Object.keys(configuredLandingPages).length
    ? configuredLandingPages
    : { DEFAULT: safeFallbackLandingPage };
  return {
    json: {
      row_number: item.row_number ?? '',
      destination_group: safeString(item.destination_group),
      api_version: safeString(item.api_version || 'v25.0'),
      account_id: safeString(item.account_id).replace(/^act_/, ''),
      campaign_id: safeString(item.campaign_id),
      adset_id: safeString(item.adset_id),
      page_id: safeString(item.page_id),
      instagram_user_id: safeString(item.instagram_user_id),
      token_id: safeString(item.token_id),
      allowed_link_hosts: Array.isArray(item.allowed_link_hosts) ? item.allowed_link_hosts : [],
      landing_pages_by_creative_group: landingPages,
      landing_page_validation: asObject(item.landing_page_validation),
      freshness_window_days: Number(item.freshness_window_days || 7),
      // Destination data is intentionally non-secret and lets the publisher
      // validate the ad-set contract before it creates a new ad. Older Token
      // Vault rows may omit it; Build Jobs then requires corroboration from an
      // existing creative in the exact same ad set instead of guessing.
      campaign_objective: safeString(item.campaign_objective),
      optimization_goal: safeString(item.optimization_goal),
      destination_type: safeString(item.destination_type).toUpperCase(),
      // The effective destination type is read from the live ad set. This
      // endpoint is the only fallback when a legacy Token Vault row omits its
      // explicit WhatsApp handoff URL; it is corroborated by the source ads.
      whatsapp_destination_url: safeString(item.whatsapp_destination_url || SAFE_WHATSAPP_DESTINATION_URL),
      carousel_native_campaign_id: safeString(item.carousel_native_campaign_id),
      carousel_native_adset_id: safeString(item.carousel_native_adset_id),
      carousel_native_adset_verified: item.carousel_native_adset_verified === true,
      carousel_native_route_active: item.carousel_native_route_active === true,
      config_revision: safeString(root.config_revision),
      destination_id_source: 'meta_publish_gateway',
      secrets_exposed: false,
    },
  };
}).sort((left, right) => Number(left.json.row_number || 0) - Number(right.json.row_number || 0));

if (rows.length < 2) {
  throw new Error(`Meta Publish gateway precisa de 2 destinos ativos; encontrados ${rows.length}.`);
}

return rows;
