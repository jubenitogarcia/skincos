#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const STAGES = [
  ['MSC-10', 'Brief and Reference Analyzer', 'REFERENCE_ANALYSIS'],
  ['MSC-20', 'Musical Direction', 'MUSIC_CONSTITUTION'],
  ['MSC-30', 'Composition Lab', 'COMPOSITION_DNA'],
  ['MSC-40', 'Song Blueprint', 'SONG_ANIMATIC'],
  ['MSC-50', 'Stem Factory', 'STEM_MANIFEST'],
  ['MSC-60', 'Vocal Factory', 'VOCAL_MANIFEST'],
  ['MSC-70', 'Arrangement and Assembly', 'ARRANGEMENT_MANIFEST'],
  ['MSC-80', 'Mix and Master', 'MASTER_MANIFEST'],
  ['MSC-90', 'Evaluation and Package', 'MUSIC_PACKAGE'],
].map(([code, name, output]) => ({ code, name, output }));
const ERROR_STAGE = { code: 'MSC-99', name: 'Error Handler', output: 'ERROR_POLICY' };
const ARCHIVED_MODULES = [{ code: 'MSC-00', name: 'Music Orchestrator', output: 'MUSIC_PRODUCTION_REPORT' }, ...STAGES, ERROR_STAGE];
const OUT = process.env.MSC_OUTPUT_DIR ? path.resolve(process.env.MSC_OUTPUT_DIR) : path.join(__dirname, '..', 'generated-workflows', 'music-composition-studio');
const ARCHIVE = process.env.MSC_ARCHIVE_DIR
  ? path.resolve(process.env.MSC_ARCHIVE_DIR)
  : path.join(__dirname, '..', 'archived-workflows', 'music-composition-studio');
const LEGACY_NESTED_ARCHIVE = path.join(OUT, 'archive');
const UNIFIED_ID = 'music-composition-studio-unified';

function node(id, name, type, position, parameters = {}, options = {}) {
  return { id, name, type, typeVersion: type === 'n8n-nodes-base.code' ? 2 : 1.1, position, parameters, ...options };
}

function validateControlledInput(input) {
  if (!input || typeof input !== 'object') throw new Error('VALIDATION_ERROR: missing input');
  if (input.dry_run !== true || input.provider_policy?.mode !== 'mock') throw new Error('AUTHORIZATION_ERROR: MSC is mock-only until explicitly activated');
  if (!input.production_id || !input.production_tier || !input.brief) throw new Error('VALIDATION_ERROR: production_id, production_tier and brief are required');
  if (!['FAST', 'STANDARD', 'PREMIUM'].includes(input.production_tier)) throw new Error('VALIDATION_ERROR: invalid production_tier');
  if (input.brief.voice_requested && input.voice_consent?.status !== 'GRANTED') throw new Error('AUTHORIZATION_ERROR: explicit voice consent is required');
  if ((input.brief.references || []).some((reference) => reference.rights_status === 'RESTRICTED')) throw new Error('AUTHORIZATION_ERROR: restricted reference material is blocked');
  return {
    ...input,
    composition_id: `CMP-${input.production_id}`,
    msc_workflow: 'unified',
    workflow_active: false,
    publish_requested: false,
    binary_audio_transferred: false,
    production_states: ['VALIDATING', 'BRIEF_READY'],
    provider_usage: {},
    costs: { total: 0, currency: 'USD', events: [] },
    generation_history: [],
  };
}

function analyzeBrief(item) {
  const references = item.brief.references || [];
  return {
    ...item,
    normalized_brief: {
      purpose: item.brief.purpose,
      duration_target_seconds: item.brief.duration_target_seconds,
      genre_family: item.brief.genre_family,
      mood: item.brief.mood,
      voice_requested: item.brief.voice_requested,
    },
    source_material_manifest: {
      items: references.map((reference) => ({ reference_id: reference.reference_id, source_uri: reference.source_uri, rights_status: reference.rights_status, usage_scope: reference.reference_usage_scope })),
      binary_in_control_plane: false,
    },
    reference_analyses: references.map((reference, index) => ({ reference_id: reference.reference_id, kind: reference.kind, rights_status: reference.rights_status, bpm: 96 + index * 4, key: 'A minor', meter: '4/4', similarity_risk: 0.08 })),
    production_states: [...item.production_states, 'BRIEF_READY'],
  };
}

function buildDirection(item) {
  const textHash = (value) => {
    let state = 2166136261;
    for (const character of JSON.stringify(value)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
    return (state >>> 0).toString(16).padStart(8, '0');
  };
  const constitution = {
    composition_id: item.composition_id,
    revision: 1,
    purpose: item.brief.purpose,
    use_context: 'workflow-organizer',
    duration_target_seconds: item.brief.duration_target_seconds,
    production_tier: item.production_tier,
    genre_family: item.brief.genre_family,
    mood: item.brief.mood,
    tempo: { target_bpm: 100, allowed_range: [96, 104] },
    tonality: { preferred_keys: ['A minor'], mode: 'minor', allowed_modulations: [] },
    meter: '4/4',
    harmonic_complexity: item.production_tier === 'PREMIUM' ? 'extended' : item.production_tier === 'STANDARD' ? 'moderate' : 'simple',
    energy_curve: [0.2, 0.45, 0.82],
    instrument_palette: item.production_tier === 'FAST' ? ['piano', 'bass', 'drums'] : ['piano', 'bass', 'drums', 'pads', 'texture'],
    vocal_profile: { requested: item.brief.voice_requested, consent_status: item.voice_consent?.status || 'NOT_REQUIRED' },
    forbidden_similarities: ['recognizable melody', 'recognizable hook', 'artist identity imitation'],
    technical_targets: { master_lufs: -14, true_peak_db: -1, sample_rate: 48000, bit_depth: 24 },
    budget_limits: item.budget_limits,
  };
  constitution.lock_hash = textHash(constitution);
  return { ...item, music_constitution: constitution, production_states: [...item.production_states, 'CONSTITUTION_LOCKED'] };
}

function runCompositionLab(item) {
  const counts = { FAST: 3, STANDARD: 4, PREMIUM: 5 };
  const count = counts[item.production_tier];
  const candidates = Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return { harmony_id: `HAR-${number}`, melody_id: `MEL-${number}`, groove_id: `GRV-${number}`, bass_id: `BAS-${number}`, palette_id: 'PAL-001', lyric_id: item.brief.voice_requested ? 'LYR-001' : 'LYR-NONE', score: Number((0.94 - index * 0.02).toFixed(2)) };
  });
  const compatibilityMatrix = {
    composition_id: item.composition_id,
    method: 'hard-filters+top-k+bounded-beam-search',
    entries: candidates.map((entry) => ({ ...entry, factors: { tonality: 1, scale: 1, melodic_fit: 0.9, harmonic_rhythm: 0.9, groove: 0.9, density: 0.9, energy: 0.9, vocal_space: 1, timbre: 0.9, objective: 0.9, genre: 0.9, duration: 1, complexity: 0.9, originality: 0.92 } })),
  };
  const compositionDna = candidates.map((entry, index) => ({ composition_dna_id: `DNA-${String(index + 1).padStart(3, '0')}`, harmony_id: entry.harmony_id, melody_ids: [entry.melody_id], groove_id: entry.groove_id, bass_strategy_id: entry.bass_id, palette_id: entry.palette_id, lyric_concept_id: entry.lyric_id, compatibility_score: entry.score }));
  return { ...item, compatibility_matrix: compatibilityMatrix, composition_dna: compositionDna, selected_composition_dna: compositionDna[0], production_states: [...item.production_states, 'COMPOSITION_CANDIDATES_READY'] };
}

function buildAnimatics(item) {
  const sections = item.brief.duration_target_seconds <= 20 ? ['INTRO', 'OUTRO'] : ['INTRO', 'VERSE', 'CHORUS', 'OUTRO'];
  const songBlueprint = {
    composition_id: item.composition_id,
    composition_dna_id: item.selected_composition_dna.composition_dna_id,
    duration_target_seconds: item.brief.duration_target_seconds,
    sections: sections.map((type, index) => ({ section_id: `SEC-${String(index + 1).padStart(3, '0')}`, type, start_bar: index * 8 + 1, bars: 8, duration_seconds: item.brief.duration_target_seconds / sections.length, energy: Number((0.3 + index * 0.15).toFixed(2)) })),
  };
  const songAnimatics = item.composition_dna.map((dna, index) => ({ animatic_id: `ANI-${String(index + 1).padStart(3, '0')}`, composition_id: item.composition_id, composition_dna_id: dna.composition_dna_id, uri: `storage://music-studio/mock/${item.production_id}/animatics/${dna.composition_dna_id}.wav`, duration_seconds: item.brief.duration_target_seconds, binary_in_control_plane: false }));
  return { ...item, song_blueprint: songBlueprint, song_animatics: songAnimatics, selected_song_animatic: songAnimatics[0], production_states: [...item.production_states, 'ANIMATICS_READY', 'COMPOSITION_SELECTED'] };
}

function buildStems(item) {
  const roleCounts = { FAST: ['DRUMS', 'BASS', 'PIANO'], STANDARD: ['DRUMS', 'PERCUSSION', 'BASS', 'PIANO', 'KEYS', 'PADS'], PREMIUM: ['DRUMS', 'PERCUSSION', 'BASS', 'PIANO', 'KEYS', 'GUITARS', 'SYNTHS', 'STRINGS', 'LEADS', 'PADS', 'TEXTURES', 'FX'] };
  const stems = [];
  for (const section of item.song_blueprint.sections) for (const role of roleCounts[item.production_tier]) stems.push({ stem_job_id: `STEM-${section.section_id}-${role}`, section_id: section.section_id, role, provider: 'mock-music', model: 'deterministic-fixture-v1', status: 'COMPLETED', uri: `storage://music-studio/mock/${item.production_id}/stems/${section.section_id}/${role}.wav`, cost: 0, binary_in_control_plane: false });
  return { ...item, stem_manifest: stems, provider_usage: { ...item.provider_usage, 'mock-music': 1 }, generation_history: [...item.generation_history, { provider: 'mock-music', model: 'deterministic-fixture-v1', cost: 0 }], production_states: [...item.production_states, 'STEMS_READY'] };
}

function buildVocals(item) {
  const artifacts = item.brief.voice_requested ? [`storage://music-studio/mock/${item.production_id}/vocals/lead.wav`] : [];
  return { ...item, vocal_manifest: { composition_id: item.composition_id, voice_consent_status: item.voice_consent?.status || 'NOT_REQUIRED', synthetic_voice_disclosed: Boolean(item.brief.voice_requested), voice_id: item.voice_consent?.voice_id || 'none', artifacts }, production_states: [...item.production_states, 'STEMS_READY'] };
}

function assembleArrangements(item) {
  const counts = { FAST: 1, STANDARD: 2, PREMIUM: 3 };
  const types = ['RADIO', 'DYNAMIC', 'CINEMATIC'];
  const arrangements = Array.from({ length: counts[item.production_tier] }, (_, index) => ({ arrangement_id: `ARR-${String(index + 1).padStart(3, '0')}`, type: types[index], lock_hash: `${item.music_constitution.lock_hash}-${index + 1}`, stem_uris: item.stem_manifest.map((stem) => stem.uri), rough_mix_uri: `storage://music-studio/mock/${item.production_id}/arrangements/${types[index]}.wav` }));
  return { ...item, arrangement_manifests: arrangements, selected_arrangement: arrangements[0], production_states: [...item.production_states, 'ARRANGEMENT_LOCKED'] };
}

function mixAndMaster(item) {
  const counts = { FAST: 1, STANDARD: 2, PREMIUM: 3 };
  const mixes = Array.from({ length: counts[item.production_tier] }, (_, index) => ({ mix_id: `MIX-${String(index + 1).padStart(3, '0')}`, arrangement_id: item.arrangement_manifests[index % item.arrangement_manifests.length].arrangement_id, uri: `storage://music-studio/mock/${item.production_id}/mixes/MIX-${index + 1}.wav`, technical_targets: item.music_constitution.technical_targets }));
  const master = { master_id: 'MASTER-001', mix_id: mixes[0].mix_id, uri: `storage://music-studio/mock/${item.production_id}/masters/master.wav`, loudness_lufs: item.music_constitution.technical_targets.master_lufs, true_peak_db: item.music_constitution.technical_targets.true_peak_db, integrity: 'VALID' };
  return { ...item, mix_manifests: mixes, selected_mix: mixes[0], master_manifest: master, production_states: [...item.production_states, 'MIX_LOCKED', 'QA_RUNNING'] };
}

function evaluateAndPackage(item) {
  const similarity = Math.max(0, ...(item.reference_analyses || []).map((reference) => Number(reference.similarity_risk || 0)));
  const blockingIssues = similarity >= 0.85 ? ['SIMILARITY_BLOCK'] : [];
  const qa = { candidate_id: item.selected_composition_dna.composition_dna_id, scores: { harmonic_coherence: item.selected_composition_dna.compatibility_score, melodic_memorability: 0.81, rhythmic_quality: 0.82, arrangement: 0.84, emotional_fit: 0.85, vocal_quality: item.brief.voice_requested ? 0.8 : 1, technical_quality: 0.91, originality: Number((1 - similarity).toFixed(2)) }, blocking_issues: blockingIssues, revision_targets: blockingIssues.length ? ['melody', 'hook', 'lyric'] : [], decision: blockingIssues.length ? 'REJECT' : 'APPROVE' };
  const status = qa.decision === 'APPROVE' ? 'READY' : 'FAILED';
  const musicPackage = {
    composition_id: item.composition_id,
    production_id: item.production_id,
    status,
    music_constitution: item.music_constitution,
    compatibility_matrix: item.compatibility_matrix,
    composition_dna: item.selected_composition_dna,
    song_blueprint: item.song_blueprint,
    arrangement_manifest: item.selected_arrangement,
    deliverables: { master_wav: item.master_manifest.uri, master_mp3: item.master_manifest.uri, pre_master: item.selected_mix.uri, instrumental: item.selected_mix.uri, acapella: item.vocal_manifest.artifacts[0] || '', clean_version: item.master_manifest.uri, performance_version: item.master_manifest.uri, short_version_60s: item.master_manifest.uri, short_version_30s: item.master_manifest.uri, short_version_15s: item.master_manifest.uri, loop_version: item.master_manifest.uri, stems: item.stem_manifest.map((stem) => stem.uri), midi_files: [], lyrics: '', chord_sheet: `storage://music-studio/mock/${item.production_id}/manifests/chord-sheet.json`, metadata: { master: item.master_manifest, binary_in_control_plane: false, dry_run_audio_format: 'URI_ONLY_MOCK' } },
    qa_reports: [qa],
    generation_history: item.generation_history,
    costs: item.costs,
    provider_usage: item.provider_usage,
    warnings: blockingIssues,
  };
  return { ...item, qa_report: qa, music_package: musicPackage, production_states: [...item.production_states, status], output_type: 'MUSIC_PACKAGE', package_status: status };
}

function handleStageError(item) {
  const raw = JSON.stringify(item.error || item.execution?.error || item).replace(/(authorization|token|api[_-]?key|secret|cookie|password)\s*[:=]\s*[^\s,"'}]+/ig, '$1=[REDACTED]');
  const upper = raw.toUpperCase();
  const errorCode = upper.includes('AUTHORIZATION') ? 'AUTHORIZATION_ERROR' : upper.includes('BUDGET') ? 'BUDGET_EXCEEDED' : upper.includes('SIMILARITY') ? 'SIMILARITY_BLOCK' : upper.includes('TIMEOUT') ? 'TIMEOUT' : upper.includes('RATE_LIMIT') ? 'RATE_LIMIT' : upper.includes('VALIDATION') ? 'VALIDATION_ERROR' : 'UNKNOWN_ERROR';
  return { production_id: item.production_id || null, status: 'FAILED', output_type: 'MUSIC_PRODUCTION_REPORT', publish_requested: false, binary_audio_transferred: false, error_event: { workflow: 'Music Composition Studio (Unified)', error_code: errorCode, message: raw, retry: ['TIMEOUT', 'RATE_LIMIT'].includes(errorCode), blocked: !['TIMEOUT', 'RATE_LIMIT'].includes(errorCode), timestamp: new Date().toISOString() } };
}

const PROCESSORS = {
  'MSC-10': analyzeBrief,
  'MSC-20': buildDirection,
  'MSC-30': runCompositionLab,
  'MSC-40': buildAnimatics,
  'MSC-50': buildStems,
  'MSC-60': buildVocals,
  'MSC-70': assembleArrangements,
  'MSC-80': mixAndMaster,
  'MSC-90': evaluateAndPackage,
  'MSC-99': handleStageError,
};

function codeFor(processor) {
  return `const item = $input.first().json || {};\nreturn [{ json: (${processor.toString()})(item) }];`;
}

function workflow() {
  const trigger = node('msc-unified-trigger', 'When Executed by Another Workflow', 'n8n-nodes-base.executeWorkflowTrigger', [-760, 0]);
  const validate = node('msc-unified-validate', 'Validate controlled input', 'n8n-nodes-base.code', [-520, 0], { mode: 'runOnceForAllItems', jsCode: codeFor(validateControlledInput) }, { onError: 'continueErrorOutput' });
  const nodes = [trigger, validate];
  const connections = { [trigger.name]: { main: [[{ node: validate.name, type: 'main', index: 0 }]] } };
  const error = node('msc-unified-msc-99', 'MSC-99 Error Handler', 'n8n-nodes-base.code', [1840, 300], { mode: 'runOnceForAllItems', jsCode: codeFor(PROCESSORS['MSC-99']) });
  let previous = validate.name;

  for (const [index, stage] of STAGES.entries()) {
    const item = node(`msc-unified-${stage.code.toLowerCase()}`, `${stage.code} ${stage.name}`, 'n8n-nodes-base.code', [-240 + index * 260, 0], { mode: 'runOnceForAllItems', jsCode: codeFor(PROCESSORS[stage.code]) }, { onError: 'continueErrorOutput' });
    nodes.push(item);
    connections[previous] = { main: [[{ node: item.name, type: 'main', index: 0 }], [{ node: error.name, type: 'main', index: 0 }]] };
    previous = item.name;
  }
  const packageNode = node('msc-unified-package', 'Build MUSIC_PACKAGE', 'n8n-nodes-base.code', [2200, 0], { mode: 'runOnceForAllItems', jsCode: "const item = $input.first().json || {};\nif (!item.music_package) throw new Error('SCHEMA_ERROR: MUSIC_PACKAGE missing');\nreturn [{ json: { ...item, publish_requested: false, binary_audio_transferred: false } }];" }, { onError: 'continueErrorOutput' });
  nodes.push(packageNode, error);
  connections[previous] = { main: [[{ node: packageNode.name, type: 'main', index: 0 }], [{ node: error.name, type: 'main', index: 0 }]] };
  connections[packageNode.name] = { main: [[], [{ node: error.name, type: 'main', index: 0 }]] };
  return { id: UNIFIED_ID, name: 'Music Composition Studio (Unified)', active: false, settings: { executionOrder: 'v1' }, nodes, connections, pinData: {}, staticData: null, meta: { codex_generated: true, builder: 'build-music-composition-studio.js', architecture: 'unified-inline-control-plane', active_by_default: false, control_plane_only: true, no_paid_provider_calls: true, operational_workflow_count: 1, archived_predecessors: ARCHIVED_MODULES.map((stage) => stage.code), archive_location: 'orb/engine/archived-workflows/music-composition-studio' } };
}

function archiveSnapshot(stage) {
  const trigger = node(`${stage.code.toLowerCase()}-archived-trigger`, 'When Executed by Another Workflow', 'n8n-nodes-base.executeWorkflowTrigger', [-520, 0]);
  const emit = node(`${stage.code.toLowerCase()}-archived-emit`, `Archived ${stage.output}`, 'n8n-nodes-base.code', [0, 0], { mode: 'runOnceForAllItems', jsCode: "throw new Error('ARCHIVED_WORKFLOW: use Music Composition Studio (Unified)');" });
  return { id: `music-composition-studio-${stage.code.toLowerCase()}`, name: `${stage.code} ${stage.name} (Archived)`, active: false, settings: { executionOrder: 'v1' }, nodes: [trigger, emit], connections: { [trigger.name]: { main: [[{ node: emit.name, type: 'main', index: 0 }]] } }, pinData: {}, staticData: null, meta: { codex_generated: true, archived: true, archive_descriptor: true, superseded_by: UNIFIED_ID, module: stage.code, operational: false } };
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ARCHIVE, { recursive: true });
for (const stale of fs.readdirSync(ARCHIVE).filter((file) => file.endsWith('.json'))) fs.unlinkSync(path.join(ARCHIVE, stale));
for (const stage of ARCHIVED_MODULES) fs.writeFileSync(path.join(ARCHIVE, `music-composition-studio-${stage.code.toLowerCase()}.json`), `${JSON.stringify(archiveSnapshot(stage), null, 2)}\n`);
if (fs.existsSync(LEGACY_NESTED_ARCHIVE)) {
  for (const stale of fs.readdirSync(LEGACY_NESTED_ARCHIVE).filter((file) => file.endsWith('.json'))) fs.unlinkSync(path.join(LEGACY_NESTED_ARCHIVE, stale));
  if (fs.readdirSync(LEGACY_NESTED_ARCHIVE).length === 0) fs.rmdirSync(LEGACY_NESTED_ARCHIVE);
}
for (const stale of fs.readdirSync(OUT).filter((file) => file.endsWith('.json') && !['music-composition-studio.unified.json', 'package.json'].includes(file))) fs.unlinkSync(path.join(OUT, stale));
const unified = workflow();
fs.writeFileSync(path.join(OUT, 'music-composition-studio.unified.json'), `${JSON.stringify(unified, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, 'package.json'), `${JSON.stringify([unified], null, 2)}\n`);
console.log(`Music Composition Studio unified workflow: OK (1 operational workflow; ${ARCHIVED_MODULES.length} predecessors archived outside package)`);
