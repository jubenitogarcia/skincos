function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }

function trackingGroupKey(job) {
  const destination = object(job.destination_contract);
  const tracking = object(job.tracking_contract);
  const kind = text(destination.kind || tracking.destination_kind).toLowerCase();
  const adsetId = text(job.destination_adset_id || object(job.destination_meta).destination_adset_id);
  const accountId = text(job.account_id);
  const profileRef = text(tracking.profile_ref);
  if (!text(job.run_id) || !text(job.token_id) || !accountId || !adsetId) {
    throw new Error(`Prepare Tracking Reconciliation recebeu job incompleto: ${job.job_key || 'sem-chave'}.`);
  }
  if (kind === 'whatsapp') {
    if (text(tracking.reconciliation_status) !== 'not_applicable' || text(tracking.url_tags_status) !== 'not_applicable' || text(object(job.creativePayload).url_tags)) {
      throw new Error(`Prepare Tracking Reconciliation recusou contrato WhatsApp invalido: ${job.job_key || adsetId}.`);
    }
    return { kind, adsetId, accountId, profileRef: '', id: `${job.run_id}:${accountId}:${adsetId}:whatsapp` };
  }
  const websiteEventRequired = text(tracking.website_event_requirement) === 'required';
  const offlineDatasetRequired = text(tracking.offline_event_dataset_requirement) === 'required';
  const reconciliationStatus = text(tracking.reconciliation_status);
  const resumed = ['verified', 'reconciled'].includes(reconciliationStatus);
  const expectedWebsiteStatus = websiteEventRequired
    ? (resumed ? 'configured' : 'pending_reconciliation')
    : 'not_required';
  const expectedOfflineStatus = offlineDatasetRequired
    ? (resumed ? 'configured' : 'pending_reconciliation')
    : 'not_required';
  if (kind !== 'website' || tracking.profile_configured !== true || !['pending', 'verified', 'reconciled'].includes(reconciliationStatus) ||
    text(tracking.website_event_status) !== expectedWebsiteStatus || text(tracking.offline_event_dataset_status) !== expectedOfflineStatus ||
    !profileRef || text(tracking.url_tags_status) !== 'expected') {
    throw new Error(`Prepare Tracking Reconciliation recusou contrato Website pendente/incompleto: ${job.job_key || adsetId}.`);
  }
  return { kind, adsetId, accountId, profileRef, id: `${job.run_id}:${accountId}:${adsetId}:${profileRef}` };
}

const jobs = $input.all();
if (!jobs.length) throw new Error('Prepare Tracking Reconciliation recebeu zero jobs validados.');
const grouped = new Map();
const targetContracts = new Map();
for (const [index, item] of jobs.entries()) {
  const source = object(item.json);
  const group = trackingGroupKey(source);
  // A single target ad set cannot safely receive two distinct destination/profile
  // contracts in one resumable run.  The Token Vault owns profile resolution, but
  // reject the ambiguous fan-out here before any mutation is requested.
  const targetId = `${text(source.run_id)}:${group.accountId}:${group.adsetId}`;
  const contractId = `${group.kind}:${group.profileRef}`;
  const priorContract = targetContracts.get(targetId);
  if (priorContract && priorContract !== contractId) {
    throw new Error(`Prepare Tracking Reconciliation encontrou contratos de tracking divergentes para ${group.adsetId}.`);
  }
  targetContracts.set(targetId, contractId);
  const existing = grouped.get(group.id);
  if (existing) {
    if (existing.token_id !== text(source.token_id) || existing.api_version !== text(source.api_version || 'v25.0') || existing.destination_kind !== group.kind) {
      throw new Error(`Prepare Tracking Reconciliation encontrou contexto divergente para ${group.adsetId}.`);
    }
    existing.job_indexes.push(index);
    continue;
  }
  grouped.set(group.id, {
    group_id: group.id,
    job_indexes: [index],
    run_id: text(source.run_id),
    token_id: text(source.token_id),
    account_id: group.accountId,
    api_version: text(source.api_version || 'v25.0'),
    destination_adset_id: group.adsetId,
    destination_kind: group.kind,
    profile_ref: group.profileRef,
  });
}

return [...grouped.values()].map((group, index) => ({
  json: {
    ...group,
    gateway_request: {
      action: 'ensure_adset_conversion_contract',
      operation_key: key(`tracking-adset:v1:${group.group_id}`),
      token_id: group.token_id,
      account_id: group.account_id,
      api_version: group.api_version,
      object_id: group.destination_adset_id,
      destination_kind: group.destination_kind,
      ...(group.profile_ref ? { profile_ref: group.profile_ref } : {}),
    },
  },
  pairedItem: { item: index },
}));
