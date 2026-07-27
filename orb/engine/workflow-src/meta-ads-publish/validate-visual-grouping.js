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
let assignments = list(result.assignments);
if (!groups.length || !assignments.length) throw new Error(`Agente visual retornou estrutura vazia: ${JSON.stringify(result).slice(0, 1000)}`);

const groupByKey = new Map();
for (const rawGroup of groups) {
  const group = object(rawGroup);
  const key = text(group.group_key).toUpperCase();
  const confidence = Number(group.confidence);
  if (!/^VISUAL_GROUP_[0-9]{2,}$/.test(key)) throw new Error(`Chave de grupo visual invalida: ${text(group.group_key)}.`);
  if (!Number.isFinite(confidence) || confidence < 0.75 || confidence > 1) throw new Error(`Confianca de grupo insuficiente em ${key}: ${group.confidence}.`);
  const offerFingerprint = normalizeOfferFingerprint(group.offer_fingerprint);
  if (!object(group.offer_fingerprint) || !Array.isArray(group.offer_fingerprint.procedures)) {
    throw new Error(`offer_fingerprint ausente ou invalido em ${key}.`);
  }
  const mediaMode = text(group.media_mode).toLowerCase();
  if (version === '3' && mediaMode && !['static_only', 'carousel', 'mixed', 'video_only'].includes(mediaMode)) {
    throw new Error(`media_mode visual invalido em ${key}: ${text(group.media_mode)}.`);
  }
  const normalizedGroup = {
    group_key: key,
    visual_concept: text(group.visual_concept),
    confidence,
    evidence: list(group.evidence).map(text).filter(Boolean),
    offer_fingerprint: offerFingerprint,
    media_mode: version === '3' ? mediaMode : '',
  };
  if (groupByKey.has(key)) {
    // The Responses adapter can repeat a complete group verbatim. It carries
    // no new classification information, so collapse only an exact normalized
    // duplicate; any material disagreement stays fail-closed.
    if (JSON.stringify(groupByKey.get(key)) !== JSON.stringify(normalizedGroup)) {
      throw new Error(`Grupo visual conflitante: ${key}.`);
    }
    continue;
  }
  groupByKey.set(key, normalizedGroup);
}

const manifestByRef = new Map(manifest.map((entry) => [text(entry.media_ref || entry.image_ref), entry]));
// Some multimodal adapters serialize only the first assignment despite having
// produced one high-confidence, explicitly sequential carousel group. This is
// a response-shape defect, not permission to guess membership: recover only
// when the model itself states carousel/sequence, every item is an image, and
// the group is the sole, high-confidence explanation of the entire batch.
const soleGroup = groupByKey.size === 1 ? [...groupByKey.values()][0] : null;
const carouselNarrative = /carrossel|sequ[êe]ncia/i.test(`${soleGroup?.visual_concept || ''} ${(soleGroup?.evidence || []).join(' ')}`);
const partialCarouselAssignmentFallback = version === '3' && assignments.length < manifest.length &&
  soleGroup && soleGroup.confidence >= 0.9 && carouselNarrative &&
  manifest.length >= 2 && manifest.length <= 10 && manifest.every((entry) => text(entry.media_type || 'image') === 'image') &&
  assignments.every((entry) => text(object(entry).group_key).toUpperCase() === soleGroup.group_key);
if (partialCarouselAssignmentFallback) {
  assignments = manifest
    .slice()
    .sort((left, right) => Number(left.ordinal || 0) - Number(right.ordinal || 0))
    .map((entry, index) => ({
      media_ref: text(entry.media_ref || entry.image_ref), media_type: 'image', group_key: soleGroup.group_key,
      role: 'carousel_card', ratio: text(entry.ratio || '4x5'), carousel_card_index: index + 1,
      confidence: soleGroup.confidence, evidence: soleGroup.evidence,
    }));
  soleGroup.media_mode = 'carousel';
}
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
  const declaredMode = groupByKey.get(groupKey)?.media_mode;
  const inferCarousel = version === '3' && !declaredMode &&
    groupAssignments.length >= 2 && groupAssignments.length <= 10 &&
    groupAssignments.every((entry) => entry.media_type === 'image');
  const carouselMode = version === '3' && (declaredMode === 'carousel' || inferCarousel);
  if (inferCarousel) {
    // The model already proved membership visually. Older model responses may
    // omit the new v3 field; retain the intake sequence rather than falling
    // back to filename parsing or silently treating five cards as placements.
    groupAssignments.sort((left, right) => Number(manifestByRef.get(left.media_ref)?.ordinal || 0) - Number(manifestByRef.get(right.media_ref)?.ordinal || 0))
      .forEach((entry, index) => {
        entry.role = 'carousel_card';
        entry.carousel_card_index = index + 1;
      });
  }
  const roles = groupAssignments.map((entry) => entry.role);
  const requiredRoles = carouselMode
    ? ['carousel_card']
    : version === '3' && declaredMode === 'mixed'
      ? ['feed_image', 'banner_image', 'vertical_image', 'vertical_video']
    : version === '3' && declaredMode === 'video_only'
      ? ['vertical_video']
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
    : version === '3' && declaredMode === 'mixed'
      ? 'mixed_group'
    : version === '3' && declaredMode === 'video_only'
      ? 'video_only'
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
        carousel_card_order_source: version === '3' && !text(group.media_mode)
          ? 'intake_sequence_fallback_after_visual_membership'
          : (assignment.carousel_card_index ? 'visual_agent' : undefined),
      },
    },
    binary,
  });
}

return outputs;
