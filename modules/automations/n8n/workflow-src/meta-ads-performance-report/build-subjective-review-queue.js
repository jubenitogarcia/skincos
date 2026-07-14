const ELIGIBLE_ENTITY_TYPES = new Set(['ad']);
const ELIGIBLE_CATEGORIES = new Set(['top_performance', 'atencao', 'piores', 'oportunidades']);

function s(v) { return v == null ? '' : String(v).trim(); }
function a(v) { return Array.isArray(v) ? v : []; }
function hasVisualSignal(entity) {
  return !!(
    entity?.visual_asset_ref?.source_type && entity.visual_asset_ref.source_type !== 'not_available' ||
    entity?.media?.has_true_creative_image ||
    entity?.media?.resolved_from_thumbnail_only ||
    entity?.media?.preview_shareable_link ||
    entity?.media?.instagram_permalink_url ||
    entity?.visual?.download_url ||
    entity?.visual?.visual_status
  );
}

return items.map((item) => {
  const group = item.json || {};
  const entities = a(group.entities);
  const entityType = s(group.entity_type);
  const category = s(group.category);
  const visualSignalCount = entities.filter(hasVisualSignal).length;
  const eligibleByType = ELIGIBLE_ENTITY_TYPES.has(entityType);
  const eligibleByCategory = ELIGIBLE_CATEGORIES.has(category);
  const hasVisualInput = visualSignalCount > 0;
  const requiresSubjectiveAiReview = eligibleByType && eligibleByCategory && hasVisualInput;

  let subjectiveStatus = 'not_requested';
  if (eligibleByType && !hasVisualInput) subjectiveStatus = 'no_visual_input';
  if (requiresSubjectiveAiReview) subjectiveStatus = 'queued_for_ai';

  return {
    json: {
      ...group,
      route: 'subjective_review_queue',
      requires_subjective_ai_review: requiresSubjectiveAiReview,
      subjective_status: subjectiveStatus,
      subjective_queue_meta: {
        eligible_by_type: eligibleByType,
        eligible_by_category: eligibleByCategory,
        has_visual_input: hasVisualInput,
        visual_signal_count: visualSignalCount,
        subjective_scope: 'creative_analysis_attached_to_ad',
      },
    },
    binary: item.binary || {},
  };
});
