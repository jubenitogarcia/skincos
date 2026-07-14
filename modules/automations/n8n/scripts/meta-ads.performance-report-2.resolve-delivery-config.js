function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeBool(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = safeString(value).toLowerCase();
  if (!normalized) return defaultValue;
  return ['1', 'true', 'yes', 'sim', 'y', 'ativo', 'active'].includes(normalized);
}

function onlyDigits(value) {
  return safeString(value).replace(/\D+/g, '');
}

function normalizeKey(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = safeString(value);
    if (normalized) return normalized;
  }
  return '';
}

function resolveToken(row) {
  return firstNonEmpty(
    row.meta_ads_access_token,
    row.facebook_ads_access_token,
    row.fb_ads_access_token,
    row.access_token,
    row.ad_account_access_token,
  );
}

function resolveRemoteJid(row) {
  const explicit = firstNonEmpty(
    row.remote_jid,
    row.remoteJid,
    row.whatsapp_jid,
    row.whatsappJid,
    row.recipient_jid,
    row.recipientJid,
    row.destination_jid,
    row.destinationJid,
    row.jid,
  );

  if (explicit.includes('@')) {
    return explicit;
  }

  const digits = onlyDigits(
    explicit ||
      row.whatsapp_number ||
      row.whatsappNumber ||
      row.phone_number ||
      row.phoneNumber ||
      row.destination_phone ||
      row.destinationPhone ||
      row.recipient_phone ||
      row.recipientPhone ||
      row.phone
  );

  if (!digits) return '';

  return digits.length > 15 ? `${digits}@g.us` : `${digits}@s.whatsapp.net`;
}

function resolveInstanceName(row) {
  return firstNonEmpty(
    row.instance_name,
    row.instanceName,
    row.evolution_instance_name,
    row.evolutionInstanceName,
    row.whatsapp_instance,
    row.whatsappInstance,
    row.instance,
  );
}

function isCandidateRow(row) {
  return !!(
    safeString(row.destination_name) ||
    safeString(row.destination_group) ||
    safeString(row.page_id) ||
    safeString(row.adset_id) ||
    resolveToken(row)
  );
}

const rows = items.map((item) => item.json || {}).filter(isCandidateRow);

if (!rows.length) {
  throw new Error('A planilha DESTINOS não retornou nenhuma linha utilizável para o relatório Meta Ads.');
}

const activeRows = rows.filter((row) =>
  normalizeBool(
    row.active ??
      row.enabled ??
      row.is_active ??
      row.report_enabled ??
      row.meta_ads_report_enabled ??
      row.performance_report_enabled,
    true,
  ),
);

const preferredDestination = firstNonEmpty(
  $input.first()?.json?.destination_name,
  $input.first()?.json?.requested_destination_name,
  $input.first()?.json?.preferred_destination_name,
);

let selectedRow = null;

if (preferredDestination) {
  const preferredKey = normalizeKey(preferredDestination);
  const preferredMatches = activeRows.filter((row) =>
    [row.destination_name, row.destination_group, row.name_suffix]
      .map(normalizeKey)
      .includes(preferredKey),
  );

  if (preferredMatches.length === 1) {
    selectedRow = preferredMatches[0];
  } else if (preferredMatches.length > 1) {
    throw new Error(`A planilha DESTINOS retornou múltiplas linhas ativas para "${preferredDestination}".`);
  }
}

if (!selectedRow && activeRows.length === 1) {
  selectedRow = activeRows[0];
}

if (!selectedRow && rows.length === 1) {
  selectedRow = rows[0];
}

if (!selectedRow) {
  const destinations = activeRows.length ? activeRows : rows;
  throw new Error(
    `Não foi possível resolver um único destino operacional em DESTINOS. ` +
      `Defina apenas uma linha ativa ou informe destination_name. ` +
      `Encontrados: ${destinations.map((row) => firstNonEmpty(row.destination_name, row.destination_group, row.page_id)).join(', ')}`,
  );
}

const accountId = firstNonEmpty(
  selectedRow.account_id,
  selectedRow.ad_account_id,
  selectedRow.destination_ad_account_id,
);
const adsetId = firstNonEmpty(selectedRow.adset_id, selectedRow.destination_adset_id);
const pageId = firstNonEmpty(selectedRow.page_id, selectedRow.destination_page_id);
const instagramUserId = firstNonEmpty(
  selectedRow.instagram_user_id,
  selectedRow.instagram_actor_id,
  selectedRow.destination_instagram_user_id,
  selectedRow.instagram_id,
);
const remoteJid = resolveRemoteJid(selectedRow);
const instanceName = resolveInstanceName(selectedRow);
const accessToken = resolveToken(selectedRow);
const destinationName = firstNonEmpty(selectedRow.destination_name, selectedRow.destination_group);
const apiVersion = firstNonEmpty(selectedRow.api_version, 'v24.0');

const missing = [];

if (!accountId) missing.push('account_id');
if (!adsetId) missing.push('adset_id');
if (!pageId) missing.push('page_id');
if (!instagramUserId) missing.push('instagram_user_id');
if (!remoteJid) missing.push('remote_jid/phone');
if (!instanceName) missing.push('instance_name');
if (!accessToken) missing.push('meta_ads_access_token');
if (!destinationName) missing.push('destination_name');

if (missing.length) {
  throw new Error(
    `DESTINOS não contém a configuração mínima para o workflow Meta Ads. Campos ausentes: ${missing.join(', ')}`,
  );
}

return [
  {
    json: {
      ...selectedRow,
      configuration_source: 'DESTINOS',
      destination_name: destinationName,
      destination_group: firstNonEmpty(selectedRow.destination_group, destinationName),
      account_id: accountId,
      adset_id: adsetId,
      page_id: pageId,
      instagram_user_id: instagramUserId,
      api_version: apiVersion,
      meta_ads_access_token: accessToken,
      remote_jid: remoteJid,
      evolution_instance_name: instanceName,
    },
  },
];
