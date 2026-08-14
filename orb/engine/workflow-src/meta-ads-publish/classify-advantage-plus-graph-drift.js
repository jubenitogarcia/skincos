function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function unique(values) { return [...new Set(list(values).map(text).filter(Boolean))]; }
function pairedIndex(item, fallback) {
  const paired = item && item.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  if (paired && typeof paired === 'object') return Number(paired.item ?? fallback);
  return Number(fallback);
}

function featureSnapshot(creative, requested) {
  const features = object(object(creative.degrees_of_freedom_spec).creative_features_spec);
  const reportedOptIn = [];
  const reportedNonOptIn = [];
  const notReported = [];
  for (const feature of requested) {
    if (!Object.prototype.hasOwnProperty.call(features, feature)) {
      notReported.push(feature);
    } else if (text(features[feature] && features[feature].enroll_status).toUpperCase() === 'OPT_IN') {
      reportedOptIn.push(feature);
    } else {
      reportedNonOptIn.push(feature);
    }
  }
  return {
    reported_opt_in: reportedOptIn,
    reported_non_opt_in: reportedNonOptIn,
    not_reported: notReported,
  };
}

function unavailable(prepared, response) {
  const detail = object(response && (response.detail || response.error));
  return {
    creative_id: text(prepared.creative_id),
    destination_group: text(prepared.destination_group),
    creative_group_key: text(prepared.creative_group_key),
    status: 'unavailable',
    checked_at: new Date().toISOString(),
    comparison_scope: 'requested_features_only:degrees_of_freedom_spec.creative_features_spec',
    graph_request_method: 'GET',
    graph_acknowledgement_is_not_ui_confirmation: true,
    baseline: object(prepared.baseline),
    current: null,
    error_code: text(detail.code || response?.status || response?.error || 'graph_readback_unavailable'),
    error_subcode: text(detail.error_subcode),
    lost_opt_in: [],
    not_reported_after_ack: [],
    new_opt_in: [],
  };
}

const preparedItems = $items('Prepare Advantage+ Drift Readback') || [];
const reports = [];
for (const [index, item] of $input.all().entries()) {
  const sourceIndex = pairedIndex(item, index);
  const prepared = object(preparedItems[sourceIndex] && preparedItems[sourceIndex].json);
  const response = object(item.json);
  const baseline = object(prepared.baseline);
  if (!prepared.creative_id || response.ok !== true || response.operation?.status !== 'completed' || !baseline.available) {
    reports.push(unavailable(prepared, response));
    continue;
  }
  const creative = object(response.operation.result);
  const requested = unique(baseline.requested_features);
  const current = featureSnapshot(creative, requested);
  const baselineOptIn = new Set(unique(baseline.reported_opt_in));
  const currentOptIn = new Set(current.reported_opt_in);
  const currentNonOptIn = new Set(current.reported_non_opt_in);
  const currentNotReported = new Set(current.not_reported);
  const lostOptIn = requested.filter((feature) => baselineOptIn.has(feature) && currentNonOptIn.has(feature));
  const notReportedAfterAck = requested.filter((feature) => baselineOptIn.has(feature) && currentNotReported.has(feature));
  const newOptIn = requested.filter((feature) => !baselineOptIn.has(feature) && currentOptIn.has(feature));
  const driftDetected = lostOptIn.length || notReportedAfterAck.length || newOptIn.length;
  reports.push({
    creative_id: text(prepared.creative_id || creative.id),
    destination_group: text(prepared.destination_group),
    creative_group_key: text(prepared.creative_group_key),
    status: driftDetected ? 'graph_state_drift_detected' : 'unchanged_graph_state_ui_unverified',
    checked_at: new Date().toISOString(),
    comparison_scope: 'requested_features_only:degrees_of_freedom_spec.creative_features_spec',
    graph_request_method: 'GET',
    graph_acknowledgement_is_not_ui_confirmation: true,
    baseline: {
      checked_at: text(baseline.checked_at),
      requested_features: requested,
      reported_opt_in: unique(baseline.reported_opt_in),
      reported_non_opt_in: unique(baseline.reported_non_opt_in),
      not_reported: unique(baseline.not_reported),
    },
    current,
    lost_opt_in: lostOptIn,
    not_reported_after_ack: notReportedAfterAck,
    new_opt_in: newOptIn,
  });
}

const hasDrift = reports.some((report) => report.status === 'graph_state_drift_detected');
const hasUnavailable = reports.some((report) => report.status === 'unavailable');
const status = hasDrift
  ? 'graph_state_drift_detected'
  : hasUnavailable
    ? 'unavailable'
    : 'unchanged_graph_state_ui_unverified';

return [{
  json: {
    run_id: text((preparedItems[0] || {}).json?.run_id),
    advantage_plus_graph_drift: {
      status,
      graph_request_method: 'GET',
      comparison_scope: 'requested_features_only:degrees_of_freedom_spec.creative_features_spec',
      graph_acknowledgement_is_not_ui_confirmation: true,
      ui_confirmation_required: true,
      automatic_remediation: 'none',
      creatives: reports,
    },
  },
}];
