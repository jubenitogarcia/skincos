function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function pairedIndex(item, fallback) {
  const paired = item && item.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  if (paired && typeof paired === 'object') return Number(paired.item ?? fallback);
  return Number(fallback);
}

function attestedTrackingContract(sourceTracking, result, group) {
  const tracking = object(sourceTracking);
  const kind = text(group.destination_kind);
  const status = text(result.status);
  if (kind === 'whatsapp') {
    if (status !== 'not_applicable' || text(result.destination_kind) !== 'whatsapp') {
      throw new Error(`Attach Pre-Stage Tracking Reconciliation recebeu resultado WhatsApp invalido: ${JSON.stringify({ status, destination_kind: text(result.destination_kind) })}`);
    }
    return {
      ...tracking,
      destination_kind: 'whatsapp',
      website_event_status: 'not_applicable',
      offline_event_dataset_status: 'not_applicable',
      url_tags_status: 'not_applicable',
      reconciliation_status: 'not_applicable',
      reconciliation_fingerprint: '',
      reconciliation_snapshot_id: '',
    };
  }
  if (!['verified', 'reconciled'].includes(status) || text(result.destination_kind) !== 'website' || text(result.profile_ref) !== text(group.profile_ref)) {
    throw new Error(`Attach Pre-Stage Tracking Reconciliation nao confirmou o perfil Website: ${JSON.stringify({ status, destination_kind: text(result.destination_kind), profile_ref: text(result.profile_ref) })}`);
  }
  const website = object(result.website_event);
  const offline = object(result.offline_event_dataset);
  const websiteEventRequired = text(tracking.website_event_requirement) === 'required';
  const offlineDatasetRequired = text(tracking.offline_event_dataset_requirement) === 'required';
  if (website.required !== websiteEventRequired || (websiteEventRequired && website.configured !== true)) {
    throw new Error('Attach Pre-Stage Tracking Reconciliation nao confirmou o evento Website requerido.');
  }
  if (offline.required !== offlineDatasetRequired || (offlineDatasetRequired && offline.configured !== true)) {
    throw new Error('Attach Pre-Stage Tracking Reconciliation nao confirmou o dataset offline requerido.');
  }
  return {
    ...tracking,
    destination_kind: 'website',
    website_event_status: websiteEventRequired ? 'configured' : 'not_required',
    offline_event_dataset_status: offlineDatasetRequired ? 'configured' : 'not_required',
    reconciliation_status: status,
    reconciliation_fingerprint: text(result.tracking_fingerprint),
    reconciliation_snapshot_id: text(result.snapshot_id),
  };
}

const prepared = $items('Prepare Pre-Stage Tracking Reconciliation') || [];
const verifiedCreatives = $items('Attach Advantage+ Verification') || [];
if (!prepared.length || !verifiedCreatives.length) throw new Error('Attach Pre-Stage Tracking Reconciliation nao encontrou creatives verificados.');

const outputs = [];
for (const [index, item] of $input.all().entries()) {
  const group = object((prepared[pairedIndex(item, index)] || {}).json);
  const response = object(item.json);
  const result = object(object(response.operation).result);
  if (response.ok !== true || text(object(response.operation).status) !== 'completed') {
    throw new Error(`Revalidate Ad Set Conversion Contract falhou: ${JSON.stringify(response.detail || response.error || response)}`);
  }
  const safeResult = {
    status: text(result.status),
    destination_kind: text(result.destination_kind),
    profile_ref: text(result.profile_ref),
    website_event: object(result.website_event),
    offline_event_dataset: object(result.offline_event_dataset),
    tracking_fingerprint: text(result.tracking_fingerprint),
    snapshot_id: text(result.snapshot_id),
    graph_mutation: text(result.graph_mutation),
  };
  for (const sourceIndex of list(group.job_indexes)) {
    const sourceItem = verifiedCreatives[Number(sourceIndex)] || {};
    const source = object(sourceItem.json);
    if (!Object.keys(source).length) throw new Error(`Attach Pre-Stage Tracking Reconciliation perdeu creative verificado ${sourceIndex}.`);
    const tracking = attestedTrackingContract(source.tracking_contract, safeResult, group);
    outputs.push({
      json: {
        ...source,
        tracking_contract: tracking,
        pre_stage_adset_conversion_reconciliation: safeResult,
      },
      binary: sourceItem.binary,
      pairedItem: { item: Number(sourceIndex) },
    });
  }
}

if (outputs.length !== verifiedCreatives.length) {
  throw new Error(`Attach Pre-Stage Tracking Reconciliation produziu cobertura incompleta: esperado ${verifiedCreatives.length}, recebeu ${outputs.length}.`);
}
return outputs;
