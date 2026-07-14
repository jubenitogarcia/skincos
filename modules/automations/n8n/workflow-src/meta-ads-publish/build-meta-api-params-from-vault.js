function safeString(value) { return String(value ?? '').trim(); }
function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

const root = $input.first()?.json || {};
if (root.ok !== true || root.ready !== true) {
  throw new Error(`Meta Publish gateway nao esta pronto: ${JSON.stringify(root.invalid || root.error || {})}`);
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
      freshness_window_days: Number(item.freshness_window_days || 7),
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
