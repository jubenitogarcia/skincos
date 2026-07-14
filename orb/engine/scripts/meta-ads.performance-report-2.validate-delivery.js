function safeAll(nodeName) {
  try {
    return $(nodeName).all();
  } catch (error) {
    return [];
  }
}

function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const numeric = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function countSuccess(itemsList) {
  return itemsList.filter((item) => item?.json?.success !== false).length;
}

function countFailure(itemsList) {
  return itemsList.filter((item) => item?.json?.success === false).length;
}

const queueItems = safeAll('Build Delivery Queue').map((item) => item.json || {});
const textItems = safeAll('Filter Text Deliveries').map((item) => item.json || {});
const mediaItems = safeAll('Filter Media Deliveries').map((item) => item.json || {});
const blockedItems = safeAll('Filter Blocked Deliveries').map((item) => item.json || {});
const textResults = safeAll('Send Report Text');
const mediaResults = safeAll('Gestor Tráfego');

const expectedGroups = queueItems.reduce((maxValue, item) => {
  return Math.max(maxValue, toNumber(item.expected_groups) ?? 0);
}, 0);
const expectedMedia = queueItems.reduce((maxValue, item) => {
  return Math.max(maxValue, toNumber(item.expected_media) ?? 0);
}, 0);

const reportCompleteness =
  safeString(queueItems.find((item) => safeString(item.report_completeness))?.report_completeness) || 'complete';
const issueRatio = toNumber(queueItems.find((item) => item.issue_ratio !== undefined)?.issue_ratio) ?? 0;
const rowsWithFetchIssues =
  toNumber(queueItems.find((item) => item.rows_with_fetch_issues !== undefined)?.rows_with_fetch_issues) ?? 0;
const metricsWithLowConfidence =
  toNumber(queueItems.find((item) => item.metrics_with_low_confidence !== undefined)?.metrics_with_low_confidence) ?? 0;

const sentGroups = countSuccess(textResults);
const failedGroupSends = countFailure(textResults);
const sentMedia = countSuccess(mediaResults);
const failedMediaSends = countFailure(mediaResults);
const blockedCount = blockedItems.length;

let businessStatus = 'complete';

if (blockedCount > 0) {
  businessStatus = 'delivery_blocked';
} else if (
  textItems.length !== expectedGroups ||
  mediaItems.length !== expectedMedia ||
  sentGroups !== expectedGroups ||
  sentMedia !== expectedMedia ||
  failedGroupSends > 0 ||
  failedMediaSends > 0
) {
  businessStatus = 'delivery_incomplete';
} else if (reportCompleteness === 'partial') {
  businessStatus = 'partial';
}

const output = {
  business_status: businessStatus,
  expected_groups: expectedGroups,
  expected_media: expectedMedia,
  planned_groups: textItems.length,
  planned_media: mediaItems.length,
  queued_items: queueItems.length,
  sent_groups: sentGroups,
  sent_media: sentMedia,
  failed_group_sends: failedGroupSends,
  failed_media_sends: failedMediaSends,
  blocked_items: blockedCount,
  blocked_details: blockedItems.slice(0, 20).map((item) => ({
    delivery_id: item.delivery_id,
    delivery_type: item.delivery_type,
    group_id: item.group_id,
    media_index: item.media_index,
    delivery_reason: item.delivery_reason,
    media_validation_status: item.media_validation_status,
  })),
  report_completeness: reportCompleteness,
  issue_ratio,
  rows_with_fetch_issues: rowsWithFetchIssues,
  metrics_with_low_confidence: metricsWithLowConfidence,
};

if (businessStatus === 'delivery_blocked' || businessStatus === 'delivery_incomplete') {
  throw new Error(JSON.stringify(output));
}

return [{ json: output }];
