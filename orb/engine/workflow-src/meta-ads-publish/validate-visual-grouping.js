function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const parsed = JSON.parse(value); return object(parsed); } catch { return null; }
}
function unwrapAgent(value) {
  const root = object(value);
  const direct = parseObject(root.output);
  if (direct) return object(direct.output) && Object.keys(object(direct.output)).length ? direct.output : direct;
  return object(root.output) && Object.keys(object(root.output)).length ? root.output : root;
}
function sourceItems() {
  try { const items = $items('Prepare Media Inventory') || []; if (items.length) return items; } catch {}
  try { return $items('Download File') || []; } catch { return []; }
}

const prepared = ($items('Prepare Visual Grouping Batch') || [])[0];
const version = text(prepared?.json?.visual_grouping_batch_version || '1');
const manifest = list(prepared?.json?.media).length ? list(prepared.json.media) : list(prepared?.json?.images);
if (!manifest.length) throw new Error('Validate Visual Grouping nao encontrou o manifesto original.');

const result = unwrapAgent($input.first()?.json || {});
const groups = list(result.groups);
const assignments = list(result.assignments);
if (!groups.length || !assignments.length) throw new Error(`Agente visual retornou estrutura vazia: ${JSON.stringify(result).slice(0, 1000)}`);

const groupByKey = new Map();
for (const rawGroup of groups) {
  const group = object(rawGroup);
  const key = text(group.group_key).toUpperCase();
  const confidence = Number(group.confidence);
  if (!/^VISUAL_GROUP_[0-9]{2,}$/.test(key)) throw new Error(`Chave de grupo visual invalida: ${text(group.group_key)}.`);
  if (groupByKey.has(key)) throw new Error(`Grupo visual duplicado: ${key}.`);
  if (!Number.isFinite(confidence) || confidence < 0.75 || confidence > 1) throw new Error(`Confianca de grupo insuficiente em ${key}: ${group.confidence}.`);
  groupByKey.set(key, { group_key: key, visual_concept: text(group.visual_concept), confidence, evidence: list(group.evidence).map(text).filter(Boolean) });
}

const manifestByRef = new Map(manifest.map((entry) => [text(entry.media_ref || entry.image_ref), entry]));
const assignmentByRef = new Map();
const supportedRatios = new Set(['1x1', '2x1', '3x4', '4x5', '9x16']);
const legacyRole = (ratio) => ratio === '2x1' ? 'banner' : ratio === '9x16' ? 'stories' : 'feed';
const v2RoleFor = (mediaType, ratio) => mediaType === 'video' ? (ratio === '9x16' ? 'vertical_video' : '')
  : ratio === '2x1' ? 'banner_image' : ratio === '9x16' ? 'vertical_image' : ['1x1', '3x4', '4x5'].includes(ratio) ? 'feed_image' : '';

for (const rawAssignment of assignments) {
  const assignment = object(rawAssignment);
  const mediaRef = text(assignment.media_ref || assignment.image_ref);
  const manifestEntry = manifestByRef.get(mediaRef);
  const groupKey = text(assignment.group_key).toUpperCase();
  const ratio = text(assignment.ratio).toLowerCase();
  const mediaType = text(assignment.media_type || manifestEntry?.media_type || 'image').toLowerCase();
  const role = text(assignment.role || assignment.slot).toLowerCase();
  const confidence = Number(assignment.confidence);
  if (!manifestEntry) throw new Error(`Agente visual retornou referencia desconhecida: ${mediaRef}.`);
  if (assignmentByRef.has(mediaRef)) throw new Error(`Midia atribuida mais de uma vez: ${mediaRef}.`);
  if (!groupByKey.has(groupKey)) throw new Error(`Midia ${mediaRef} referencia grupo inexistente: ${groupKey}.`);
  if (mediaType !== text(manifestEntry.media_type || 'image')) throw new Error(`Tipo de midia divergente em ${mediaRef}.`);
  if (!supportedRatios.has(ratio)) throw new Error(`Proporcao visual nao suportada para ${mediaRef}: ${ratio}.`);
  const expectedRole = version === '2' ? v2RoleFor(mediaType, ratio) : legacyRole(ratio);
  if (!expectedRole || expectedRole !== role) throw new Error(`Papel ${role} incompativel com ${mediaType}/${ratio} em ${mediaRef}; esperado=${expectedRole}.`);
  if (!Number.isFinite(confidence) || confidence < 0.75 || confidence > 1) throw new Error(`Confianca insuficiente para ${mediaRef}: ${assignment.confidence}.`);
  const evidence = list(assignment.evidence).map(text).filter(Boolean);
  const forbiddenEvidence = [text(manifestEntry.source_file_id), text(manifestEntry.source_json?.name)].filter(Boolean);
  if (evidence.some((entry) => forbiddenEvidence.some((forbidden) => entry.toLowerCase().includes(forbidden.toLowerCase())))) {
    throw new Error(`Nome ou id de arquivo usado como evidencia em ${mediaRef}.`);
  }
  assignmentByRef.set(mediaRef, { media_ref: mediaRef, media_type: mediaType, group_key: groupKey, ratio, role, confidence, evidence });
}

const missing = [...manifestByRef.keys()].filter((ref) => !assignmentByRef.has(ref));
if (missing.length || assignmentByRef.size !== manifestByRef.size) {
  throw new Error(`Agrupamento visual nao cobriu o lote exatamente uma vez. missing=${JSON.stringify(missing)} expected=${manifestByRef.size} assigned=${assignmentByRef.size}`);
}
const groupMediaModes = new Map();
for (const groupKey of groupByKey.keys()) {
  const groupAssignments = [...assignmentByRef.values()].filter((entry) => entry.group_key === groupKey);
  const roles = groupAssignments.map((entry) => entry.role);
  const requiredRoles = version === '2'
    ? (roles.length === 1 && roles[0] === 'vertical_video'
      ? ['vertical_video']
      : ['feed_image', 'banner_image', 'vertical_image', 'vertical_video'])
    : ['feed', 'banner', 'stories'];
  const missingRoles = requiredRoles.filter((role) => !roles.includes(role));
  const duplicateRoles = [...new Set(roles.filter((role, index) => roles.indexOf(role) !== index))];
  if (missingRoles.length || duplicateRoles.length || groupAssignments.length !== requiredRoles.length) {
    throw new Error(`Grupo visual incompleto ou ambiguo ${groupKey}. missing_roles=${JSON.stringify(missingRoles)} duplicate_roles=${JSON.stringify(duplicateRoles)} media=${groupAssignments.length}`);
  }
  groupMediaModes.set(groupKey, version !== '2'
    ? 'static_group'
    : requiredRoles.length === 1 ? 'video_only' : 'mixed_group');
}

const originals = sourceItems();
const outputs = [];
for (const entry of manifest) {
  const mediaRef = text(entry.media_ref || entry.image_ref);
  const assignment = assignmentByRef.get(mediaRef);
  const group = groupByKey.get(assignment.group_key);
  const original = originals[Number(entry.source_item_index)];
  if (!original) throw new Error(`Midia original ausente para ${mediaRef}.`);
  const binary = clone(original.binary || {});
  if (!binary.data) throw new Error(`Binario principal ausente para ${mediaRef}.`);
  if (assignment.media_type === 'video' && (!binary.thumbnail || !binary.analysis)) throw new Error(`Artefatos processados ausentes para ${mediaRef}.`);
  outputs.push({
    json: {
      ...clone(object(original.json)),
      visual_grouping: {
        version,
        strategy: 'ai_visual_global',
        media_ref: mediaRef,
        image_ref: version === '1' ? mediaRef : undefined,
        media_type: assignment.media_type,
        role: assignment.role,
        slot: version === '1' ? assignment.role : assignment.role.replace(/_image$|_video$/, ''),
        group_key: assignment.group_key,
        media_mode: groupMediaModes.get(assignment.group_key),
        visual_concept: group.visual_concept,
        ratio: assignment.ratio,
        confidence: assignment.confidence,
        evidence: assignment.evidence,
        group_confidence: group.confidence,
        group_evidence: group.evidence,
      },
    },
    binary,
  });
}

return outputs;
