const ERROR_CODES = ['VALIDATION_ERROR', 'PROVIDER_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'STORAGE_ERROR', 'SCHEMA_ERROR', 'AUDIO_PROCESSING_ERROR', 'QUALITY_ERROR', 'SIMILARITY_BLOCK', 'AUTHORIZATION_ERROR', 'BUDGET_EXCEEDED', 'UNKNOWN_ERROR'];

function classify(error) {
  const text = String(error?.message || error || '').toUpperCase();
  if (text.includes('BUDGET_EXCEEDED')) return 'BUDGET_EXCEEDED';
  if (text.includes('AUTHORIZATION')) return 'AUTHORIZATION_ERROR';
  if (text.includes('SIMILARITY')) return 'SIMILARITY_BLOCK';
  if (text.includes('TIMEOUT')) return 'TIMEOUT';
  if (text.includes('SCHEMA') || text.includes('REQUIRED') || text.includes('NOT ALLOWED')) return 'SCHEMA_ERROR';
  if (text.includes('AUDIO')) return 'AUDIO_PROCESSING_ERROR';
  if (text.includes('PROVIDER')) return 'PROVIDER_ERROR';
  return 'UNKNOWN_ERROR';
}

function sanitize(value) {
  const text = String(value || '');
  return text.replace(/(authorization|token|api[_-]?key|secret)\s*[:=]\s*[^\s,]+/ig, '$1=[REDACTED]');
}

function handleError(context, error) {
  const code = classify(error); const retryable = ['PROVIDER_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'STORAGE_ERROR'].includes(code);
  return { workflow: context.workflow, node: context.node, production_id: context.production_id, job_id: context.job_id || null, component_id: context.component_id || null, provider: context.provider || null, attempt: Number(context.attempt || 0), error_code: code, payload: sanitize(JSON.stringify(context.payload || {})), message: sanitize(error?.message || error), retry: retryable, fallback: retryable ? 'mock_or_approved_fallback' : null, manual_review: ['SIMILARITY_BLOCK', 'AUTHORIZATION_ERROR', 'QUALITY_ERROR'].includes(code), cancel: ['BUDGET_EXCEEDED', 'AUTHORIZATION_ERROR', 'SIMILARITY_BLOCK'].includes(code), timestamp: new Date().toISOString() };
}

module.exports = { ERROR_CODES, classify, sanitize, handleError };
