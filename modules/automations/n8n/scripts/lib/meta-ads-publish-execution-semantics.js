'use strict';

function effectiveResponsesApiEnabled(model) {
  const stored = model?.parameters?.responsesApiEnabled;
  return stored === true || (stored === undefined && Number(model?.typeVersion || 0) >= 1.3);
}

function executionSummaryForWorkflow(row, currentSummary, historySummaries) {
  if (row.active !== true) return currentSummary;
  return historySummaries.find((item) => item.version_id === row.activeVersionId) || currentSummary;
}

function manualExecutionAuditState(settings) {
  return settings?.saveManualExecutions === true ? 'persisted' : 'not_persisted';
}

module.exports = {
  effectiveResponsesApiEnabled,
  executionSummaryForWorkflow,
  manualExecutionAuditState,
};
