function text(value) {
  return String(value ?? '').trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function unwrapAgent(value) {
  const root = object(value);
  const direct = parseObject(root.output);
  if (direct) return direct.output && typeof direct.output === 'object' ? direct.output : direct;
  return root.output && typeof root.output === 'object' ? root.output : root;
}

const prepared = ($items('Prepare Visual Grouping Batch') || [])[0];
const manifest = list(prepared?.json?.images);
const preparedBinary = prepared?.binary || {};
if (!manifest.length) {
  throw new Error('Validate Visual Grouping nao encontrou o manifesto original.');
}

const agentItem = $input.first();
const result = unwrapAgent(agentItem?.json || {});
const groups = list(result.groups);
const assignments = list(result.assignments);
if (!groups.length || !assignments.length) {
  throw new Error(`Agente visual retornou estrutura vazia: ${JSON.stringify(result).slice(0, 1000)}`);
}

const groupByKey = new Map();
for (const rawGroup of groups) {
  const group = object(rawGroup);
  const key = text(group.group_key).toUpperCase();
  if (!/^VISUAL_GROUP_[0-9]{2,}$/.test(key)) {
    throw new Error(`Chave de grupo visual invalida: ${text(group.group_key)}.`);
  }
  if (groupByKey.has(key)) throw new Error(`Grupo visual duplicado: ${key}.`);
  groupByKey.set(key, {
    group_key: key,
    visual_concept: text(group.visual_concept),
    confidence: Number(group.confidence),
    evidence: list(group.evidence).map(text).filter(Boolean),
  });
}

const manifestByRef = new Map(manifest.map((entry) => [text(entry.image_ref), entry]));
const assignmentByRef = new Map();
const supportedRatios = new Set(['1x1', '2x1', '3x4', '4x5', '9x16']);
const slotForRatio = (ratio) => ratio === '2x1' ? 'banner' : ratio === '9x16' ? 'stories' : 'feed';

for (const rawAssignment of assignments) {
  const assignment = object(rawAssignment);
  const imageRef = text(assignment.image_ref);
  const groupKey = text(assignment.group_key).toUpperCase();
  const ratio = text(assignment.ratio).toLowerCase();
  const slot = text(assignment.slot).toLowerCase();

  if (!manifestByRef.has(imageRef)) throw new Error(`Agente visual retornou referencia desconhecida: ${imageRef}.`);
  if (assignmentByRef.has(imageRef)) throw new Error(`Imagem atribuida mais de uma vez: ${imageRef}.`);
  if (!groupByKey.has(groupKey)) throw new Error(`Imagem ${imageRef} referencia grupo inexistente: ${groupKey}.`);
  if (!supportedRatios.has(ratio)) throw new Error(`Proporcao visual nao suportada para ${imageRef}: ${ratio}.`);
  if (slotForRatio(ratio) !== slot) throw new Error(`Slot ${slot} incompativel com proporcao ${ratio} em ${imageRef}.`);

  const confidence = Number(assignment.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Confianca invalida para ${imageRef}: ${assignment.confidence}.`);
  }

  assignmentByRef.set(imageRef, {
    image_ref: imageRef,
    group_key: groupKey,
    ratio,
    slot,
    confidence,
    evidence: list(assignment.evidence).map(text).filter(Boolean),
  });
}

const missing = [...manifestByRef.keys()].filter((ref) => !assignmentByRef.has(ref));
if (missing.length || assignmentByRef.size !== manifestByRef.size) {
  throw new Error(`Agrupamento visual nao cobriu o lote exatamente uma vez. missing=${JSON.stringify(missing)} expected=${manifestByRef.size} assigned=${assignmentByRef.size}`);
}

for (const groupKey of groupByKey.keys()) {
  const groupAssignments = [...assignmentByRef.values()].filter((entry) => entry.group_key === groupKey);
  const slots = groupAssignments.map((entry) => entry.slot);
  const missingSlots = ['feed', 'banner', 'stories'].filter((slot) => !slots.includes(slot));
  const duplicateSlots = [...new Set(slots.filter((slot, index) => slots.indexOf(slot) !== index))];
  if (missingSlots.length || duplicateSlots.length || groupAssignments.length !== 3) {
    throw new Error(`Grupo visual incompleto ou ambiguo ${groupKey}. missing_slots=${JSON.stringify(missingSlots)} duplicate_slots=${JSON.stringify(duplicateSlots)} images=${groupAssignments.length}`);
  }
}

const outputs = [];
for (const entry of manifest) {
  const imageRef = text(entry.image_ref);
  const assignment = assignmentByRef.get(imageRef);
  const group = groupByKey.get(assignment.group_key);
  const binaryData = preparedBinary[text(entry.binary_key)];
  if (!binaryData) throw new Error(`Binario original ausente para ${imageRef}.`);

  outputs.push({
    json: {
      ...clone(object(entry.source_json)),
      visual_grouping: {
        version: '1',
        strategy: 'ai_visual_global',
        image_ref: imageRef,
        group_key: assignment.group_key,
        visual_concept: group.visual_concept,
        ratio: assignment.ratio,
        slot: assignment.slot,
        confidence: assignment.confidence,
        evidence: assignment.evidence,
        group_confidence: group.confidence,
        group_evidence: group.evidence,
      },
    },
    binary: { data: clone(binaryData) },
  });
}

return outputs;
