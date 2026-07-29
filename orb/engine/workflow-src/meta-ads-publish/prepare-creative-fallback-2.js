const ATTEMPT = 2;
const OPTIONAL_REMOVAL_PRIORITY = ['music_generation', 'pac_relaxation', 'video_highlights', 'video_filtering', 'adapt_to_placement', 'add_text_overlay'];

function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${stable(value[name])}`).join(',')}}`; return JSON.stringify(value); }
function stableHash(value) { let hash = 2166136261; for (const char of text(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function unique(values) { return [...new Set(list(values).map(text).filter(Boolean))]; }
function responseSucceeded(response) { return response.ok === true && response.operation && response.operation.status === 'completed' && text(response.operation.result && response.operation.result.id); }
function responseText(response) { try { return JSON.stringify(response || {}).toLowerCase(); } catch { return text(response).toLowerCase(); } }
function chooseRemoval(features, response) {
  const available = OPTIONAL_REMOVAL_PRIORITY.filter((feature) => Object.prototype.hasOwnProperty.call(features, feature));
  const detail = responseText(response);
  const indicated = available.find((feature) => detail.includes(feature));
  if (indicated) return indicated;
  return /(creative[ _-]?feature|advantage\+?|enhancement|text[ _-]?overlay|music|pac[ _-]?relaxation|video[ _-]?(filtering|highlights?)|adapt[ _-]?to[ _-]?placement)/.test(detail) ? (available[0] || '') : '';
}
function markRemoved(groups, feature, reason) {
  const out = clone(object(groups));
  for (const group of ['main', 'essential', 'supplemental']) out[group] = list(out[group]).map((entry) => text(entry && entry.api_key) === feature ? { ...entry, requested: false, status: 'fallback_removed', reason } : entry);
  return out;
}

return $input.all().map((item, index) => {
  const merged = object(item.json);
  const response = { ok: merged.ok, replayed: merged.replayed, operation: merged.operation, requestId: merged.requestId, detail: merged.detail, error: merged.error };
  const source = { ...merged };
  for (const field of ['ok', 'replayed', 'operation', 'requestId', 'detail', 'error']) delete source[field];
  const succeeded = responseSucceeded(response);
  const resolvedCreativeId = succeeded ? text(response.operation.result.id) : '';
  if (succeeded) return { json: { ...source, creative_id: resolvedCreativeId, creative_fallback_attempts: list(source.creative_fallback_attempts), gateway_request: { action: 'get_creative', operation_key: key(`fallback-read-${ATTEMPT}:${source.run_id}:${resolvedCreativeId}`), token_id: text(source.token_id), account_id: text(source.account_id), api_version: text(source.api_version || 'v25.0'), object_id: resolvedCreativeId } }, binary: item.binary, pairedItem: { item: index } };
  const payload = clone(object(source.creativePayload));
  const features = object(object(payload.degrees_of_freedom_spec).creative_features_spec);
  const removedFeature = chooseRemoval(features, response);
  if (!removedFeature) throw new Error(`Create AdCreative falhou por erro estrutural ou nao mapeado apos fallbacks seletivos em ${source.job_key || index}.`);
  delete features[removedFeature];
  const payloadHash = stableHash(stable(payload));
  const fallbackReason = `meta_create_failed_fallback_${ATTEMPT}`;
  const removed = unique([...list(source.advantage_plus_fallback_removed_features), removedFeature]);
  const requested = unique(list(source.advantage_plus_requested_features).filter((feature) => feature !== removedFeature));
  return {
    json: {
      ...source, creativePayload: payload, advantage_plus_requested_features: requested,
      advantage_plus_feature_groups: markRemoved(source.advantage_plus_feature_groups, removedFeature, fallbackReason),
      advantage_plus_fallback_removed_features: removed,
      advantage_plus_fallback_reasons: { ...object(source.advantage_plus_fallback_reasons), [removedFeature]: fallbackReason },
      creative_fallback_attempts: [...list(source.creative_fallback_attempts), { attempt: ATTEMPT, removed_feature: removedFeature, reason: fallbackReason }],
      gateway_request: { action: 'create_creative', operation_key: key(`creative:v2:${payloadHash}:${source.run_id}:${source.destination_group}:fallback_${ATTEMPT}:${removedFeature}`), token_id: text(source.token_id), account_id: text(source.account_id), api_version: text(source.api_version || 'v25.0'), payload },
    }, binary: item.binary, pairedItem: { item: index },
  };
});
