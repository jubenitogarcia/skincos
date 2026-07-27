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
function token(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}
function fnv64(value) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const char of String(value)) {
    hash = BigInt.asUintN(64, hash ^ BigInt(char.codePointAt(0)));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(36).toUpperCase();
}
function normalizeOfferFingerprint(raw) {
  const source = object(raw);
  const procedures = list(source.procedures)
    .map((entry) => object(entry))
    .map((entry) => ({ key: token(entry.key), quantity: token(entry.quantity), unit: token(entry.unit) }))
    .filter((entry) => entry.key)
    .sort((left, right) => `${left.key}:${left.quantity}:${left.unit}`.localeCompare(`${right.key}:${right.quantity}:${right.unit}`));
  const payment_terms = [...new Set(list(source.payment_terms).map(token).filter(Boolean))].sort();
  const condition_terms = [...new Set(list(source.condition_terms).map(token).filter(Boolean))].sort();
  const price_amount_cents = Math.max(0, Math.trunc(Number(source.price_amount_cents || 0)));
  const price_qualifier = ['fixed', 'from'].includes(token(source.price_qualifier)) ? token(source.price_qualifier) : 'unknown';
  const validity = token(source.validity);
  const evidence = list(source.evidence).map(text).filter(Boolean).slice(0, 8);
  const canonical_key = [
    'v1',
    `p=${procedures.map((entry) => `${entry.key}:${entry.quantity || 'unknown'}:${entry.unit || 'unknown'}`).join('+') || 'unknown'}`,
    `price=${price_amount_cents}:${price_qualifier}`,
    `pay=${payment_terms.join('+') || 'none'}`,
    `cond=${condition_terms.join('+') || 'none'}`,
    `valid=${validity || 'none'}`,
  ].join('|');
  const replacement_eligible = Number(source.confidence) >= 0.9 && procedures.length > 0 &&
    procedures.every((entry) => entry.quantity && entry.unit) && price_amount_cents > 0 &&
    price_qualifier !== 'unknown' && evidence.length > 0;
  return {
    version: 'v1', confidence: Number(source.confidence || 0), procedures, price_amount_cents,
    price_qualifier, payment_terms, condition_terms, validity, evidence, canonical_key,
    tag: replacement_eligible ? `[OFV1:${fnv64(canonical_key)}]` : '',
    replacement_eligible,
    status: replacement_eligible ? 'verified' : 'unverified',
  };
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
  const offerFingerprint = normalizeOfferFingerprint(group.offer_fingerprint);
  if (!object(group.offer_fingerprint) || !Array.isArray(group.offer_fingerprint.procedures)) {
    throw new Error(`offer_fingerprint ausente ou invalido em ${key}.`);
  }
  const mediaMode = text(group.media_mode).toLowerCase();
  if (version === '3' && !['static_only', 'carousel'].includes(mediaMode)) {
    throw new Error(`media_mode visual invalido em ${key}: ${text(group.media_mode)}.`);
  }
  groupByKey.set(key, {
    group_key: key,
    visual_concept: text(group.visual_concept),
    confidence,
    evidence: list(group.evidence).map(text).filter(Boolean),
    offer_fingerprint: offerFingerprint,
    media_mode: version === '3' ? mediaMode : '',
  });
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
  const declaredRole = text(assignment.role || assignment.slot).toLowerCase();
  const confidence = Number(assignment.confidence);
  if (!manifestEntry) throw new Error(`Agente visual retornou referencia desconhecida: ${mediaRef}.`);
  if (assignmentByRef.has(mediaRef)) throw new Error(`Midia atribuida mais de uma vez: ${mediaRef}.`);
  if (!groupByKey.has(groupKey)) throw new Error(`Midia ${mediaRef} referencia grupo inexistente: ${groupKey}.`);
  if (mediaType !== text(manifestEntry.media_type || 'image')) throw new Error(`Tipo de midia divergente em ${mediaRef}.`);
  if (!supportedRatios.has(ratio)) throw new Error(`Proporcao visual nao suportada para ${mediaRef}: ${ratio}.`);
  const carouselGroup = version === '3' && groupByKey.get(groupKey)?.media_mode === 'carousel';
  const expectedRole = carouselGroup
    ? (mediaType === 'image' ? 'carousel_card' : '')
    : version === '2' ? v2RoleFor(mediaType, ratio) : legacyRole(ratio);
  if (!expectedRole) throw new Error(`Papel sem mapeamento para ${mediaType}/${ratio} em ${mediaRef}.`);
  // Group membership is the visual model's responsibility. The media role is
  // not: it is mechanically determined by type and aspect ratio. Normalize
  // an occasional model label error (for example, 2:1 called feed_image)
  // instead of rejecting a group whose visual association is otherwise sound.
  const role = expectedRole;
  if (!Number.isFinite(confidence) || confidence < 0.75 || confidence > 1) throw new Error(`Confianca insuficiente para ${mediaRef}: ${assignment.confidence}.`);
  const evidence = list(assignment.evidence).map(text).filter(Boolean);
  const forbiddenEvidence = [text(manifestEntry.source_file_id), text(manifestEntry.source_json?.name)].filter(Boolean);
  if (evidence.some((entry) => forbiddenEvidence.some((forbidden) => entry.toLowerCase().includes(forbidden.toLowerCase())))) {
    throw new Error(`Nome ou id de arquivo usado como evidencia em ${mediaRef}.`);
  }
  const carouselCardIndex = carouselGroup ? Number(assignment.carousel_card_index) : 0;
  if (carouselGroup && (!Number.isInteger(carouselCardIndex) || carouselCardIndex < 1 || carouselCardIndex > 10)) {
    throw new Error(`carousel_card_index invalido para ${mediaRef}.`);
  }
  assignmentByRef.set(mediaRef, { media_ref: mediaRef, media_type: mediaType, group_key: groupKey, ratio, role, carousel_card_index: carouselCardIndex, declared_role: declaredRole, confidence, evidence });
}

const missing = [...manifestByRef.keys()].filter((ref) => !assignmentByRef.has(ref));
if (missing.length || assignmentByRef.size !== manifestByRef.size) {
  throw new Error(`Agrupamento visual nao cobriu o lote exatamente uma vez. missing=${JSON.stringify(missing)} expected=${manifestByRef.size} assigned=${assignmentByRef.size}`);
}
const groupMediaModes = new Map();
for (const groupKey of groupByKey.keys()) {
  const groupAssignments = [...assignmentByRef.values()].filter((entry) => entry.group_key === groupKey);
  const roles = groupAssignments.map((entry) => entry.role);
  const carouselMode = version === '3' && groupByKey.get(groupKey)?.media_mode === 'carousel';
  const requiredRoles = carouselMode
    ? ['carousel_card']
    : version === '2'
    ? (roles.length === 1 && roles[0] === 'vertical_video'
      ? ['vertical_video']
      : ['feed_image', 'banner_image', 'vertical_image', 'vertical_video'])
    : ['feed', 'banner', 'stories'];
  const missingRoles = requiredRoles.filter((role) => !roles.includes(role));
  const duplicateRoles = carouselMode ? [] : [...new Set(roles.filter((role, index) => roles.indexOf(role) !== index))];
  const cardIndices = carouselMode ? groupAssignments.map((entry) => entry.carousel_card_index).sort((a, b) => a - b) : [];
  const contiguousCards = carouselMode && cardIndices.length >= 2 && cardIndices.length <= 10 && cardIndices.every((value, index) => value === index + 1);
  if (missingRoles.length || duplicateRoles.length || (carouselMode ? !contiguousCards : groupAssignments.length !== requiredRoles.length)) {
    throw new Error(`Grupo visual incompleto ou ambiguo ${groupKey}. missing_roles=${JSON.stringify(missingRoles)} duplicate_roles=${JSON.stringify(duplicateRoles)} media=${groupAssignments.length}`);
  }
  groupMediaModes.set(groupKey, carouselMode
    ? 'carousel'
    : version !== '2'
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
        offer_fingerprint: clone(group.offer_fingerprint),
        carousel_card_index: assignment.carousel_card_index || undefined,
      },
    },
    binary,
  });
}

return outputs;
