function safeString(value) {
  return value == null ? '' : String(value).trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const numeric = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeKey(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function isValidMediaUrl(value) {
  const url = safeString(value);
  if (!url) {
    return { status: 'invalid', reason: 'empty_media_url' };
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { status: 'invalid', reason: `unsupported_protocol:${parsed.protocol}` };
    }
    if (!parsed.hostname) {
      return { status: 'invalid', reason: 'missing_hostname' };
    }
    return { status: 'valid', reason: null };
  } catch (error) {
    return { status: 'invalid', reason: 'malformed_media_url' };
  }
}

const groups = items.map((item) => item.json || {}).filter(Boolean);
const expectedGroups = groups.length;
const expectedMedia = groups.reduce((total, group) => {
  const mediaItems = Array.isArray(group.media_urls) ? group.media_urls : [];
  return total + mediaItems.length;
}, 0);

const outputs = [];

groups.forEach((group, groupIndex) => {
  const groupId =
    safeString(group.group_id) ||
    `${normalizeKey(group.report_date)}_${normalizeKey(group.entity_type)}_${normalizeKey(group.category)}_${groupIndex + 1}`;

  const groupMessage = safeString(group.group_message || group.message_text);
  const pipelineAudit = group.pipeline_audit || {};
  const selectionSummary = group.selection_summary || {};
  const mediaItems = Array.isArray(group.media_urls) ? group.media_urls : [];

  outputs.push({
    json: {
      delivery_id: `${groupId}:text`,
      delivery_type: 'text',
      delivery_status: groupMessage ? 'ready' : 'blocked',
      delivery_reason: groupMessage ? null : 'missing_group_message',
      group_id: groupId,
      group_index: groupIndex + 1,
      total_groups: expectedGroups,
      media_index: null,
      media_total: mediaItems.length,
      message_text: groupMessage,
      report_date: safeString(group.report_date),
      entity_type: safeString(group.entity_type),
      category: safeString(group.category),
      expected_groups: expectedGroups,
      expected_media: expectedMedia,
      report_completeness: safeString(group.report_completeness || pipelineAudit.report_completeness || 'complete'),
      issue_ratio: toNumber(group.issue_ratio ?? pipelineAudit.issue_ratio) ?? 0,
      rows_with_fetch_issues: toNumber(pipelineAudit.rows_with_fetch_issues) ?? 0,
      metrics_with_low_confidence: toNumber(pipelineAudit.metrics_with_low_confidence) ?? 0,
      selection_summary: selectionSummary,
      pipeline_audit: pipelineAudit,
      media_validation_status: null,
      media_validation_reason: null,
      media_url: '',
      media_caption: '',
      file_name: '',
      mime_type: '',
    },
  });

  mediaItems.forEach((mediaItem, mediaIndex) => {
    const mediaUrl = safeString(mediaItem?.url || mediaItem?.media_url);
    const validation = isValidMediaUrl(mediaUrl);
    const fileName = safeString(mediaItem?.file_name || `${groupId}_${mediaIndex + 1}.jpg`);
    const mimeType = safeString(mediaItem?.mime_type || 'image/jpeg');

    outputs.push({
      json: {
        delivery_id: `${groupId}:media:${mediaIndex + 1}`,
        delivery_type: validation.status === 'valid' ? 'media' : 'blocked_media',
        delivery_status: validation.status === 'valid' ? 'ready' : 'blocked',
        delivery_reason: validation.reason,
        group_id: groupId,
        group_index: groupIndex + 1,
        total_groups: expectedGroups,
        media_index: mediaIndex + 1,
        media_total: mediaItems.length,
        message_text: groupMessage,
        report_date: safeString(group.report_date),
        entity_type: safeString(group.entity_type),
        category: safeString(group.category),
        expected_groups: expectedGroups,
        expected_media: expectedMedia,
        report_completeness: safeString(group.report_completeness || pipelineAudit.report_completeness || 'complete'),
        issue_ratio: toNumber(group.issue_ratio ?? pipelineAudit.issue_ratio) ?? 0,
        rows_with_fetch_issues: toNumber(pipelineAudit.rows_with_fetch_issues) ?? 0,
        metrics_with_low_confidence: toNumber(pipelineAudit.metrics_with_low_confidence) ?? 0,
        selection_summary: selectionSummary,
        pipeline_audit: pipelineAudit,
        media_validation_status: validation.status,
        media_validation_reason: validation.reason,
        media_url: mediaUrl,
        media_caption: '',
        file_name: fileName,
        mime_type: mimeType,
        entity_id: safeString(mediaItem?.entity_id),
        creative_id: safeString(mediaItem?.creative_id),
        creative_name: safeString(mediaItem?.creative_name),
      },
    });
  });
});

return outputs;
