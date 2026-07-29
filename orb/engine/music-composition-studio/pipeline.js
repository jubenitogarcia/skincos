const fs = require('fs');
const os = require('os');
const path = require('path');
const { validate } = require('./lib/contracts');
const { hash, stableId } = require('./lib/canonical');
const { MusicLedger } = require('./lib/ledger');
const { MockMusicProvider, enforceBudget, pollControlled } = require('./lib/providers');
const { compositionDna } = require('./lib/compatibility');
const { invalidationPlan, revisionOf } = require('./lib/invalidation');
const { renderFixture, analyzeArtifact, renderManifest } = require('./services/audio-service');

const TIER = {
  FAST: { candidates: 2, dna: 3, stems: ['DRUMS', 'BASS', 'PIANO'], arrangements: 1 },
  STANDARD: { candidates: 3, dna: 4, stems: ['DRUMS', 'PERCUSSION', 'BASS', 'PIANO', 'KEYS', 'PADS'], arrangements: 2 },
  PREMIUM: { candidates: 4, dna: 5, stems: ['DRUMS', 'PERCUSSION', 'BASS', 'PIANO', 'KEYS', 'GUITARS', 'SYNTHS', 'STRINGS', 'LEADS', 'PADS', 'TEXTURES', 'FX'], arrangements: 3 },
};
const STATES = ['DRAFT', 'VALIDATING', 'NEEDS_INFORMATION', 'BRIEF_READY', 'CONSTITUTION_BUILDING', 'CONSTITUTION_LOCKED', 'COMPOSITION_LAB_RUNNING', 'COMPOSITION_CANDIDATES_READY', 'ANIMATICS_READY', 'COMPOSITION_SELECTED', 'STEMS_PRODUCING', 'STEMS_READY', 'ARRANGING', 'ARRANGEMENT_LOCKED', 'MIXING', 'MIX_LOCKED', 'MASTERING', 'QA_RUNNING', 'READY', 'PARTIALLY_READY', 'FAILED', 'ARCHIVED'];
const JOB_STATES = ['PENDING', 'READY', 'QUEUED', 'SUBMITTED', 'PROCESSING', 'WAITING_PROVIDER', 'COMPLETED', 'VALIDATED', 'APPROVED', 'FAILED_RETRYABLE', 'FAILED_BLOCKING', 'RETRYING', 'FALLBACK', 'INVALIDATED', 'SKIPPED', 'CANCELLED'];

function baseRequest(overrides = {}) {
  return {
    schema_version: '1.0.0', production_id: 'MSC-DRY-FAST', production_tier: 'FAST', dry_run: true,
    brief: { purpose: 'vinheta instrumental original para conteúdo social', duration_target_seconds: 15, genre_family: ['ambient-pop'], mood: ['warm', 'optimistic'], voice_requested: false, references: [{ reference_id: 'REF-MIX-1', kind: 'MIX_REFERENCE', rights_status: 'LICENSED', reference_usage_scope: 'ANALYZE_ONLY', source_uri: 'storage://fixture/mix-reference.wav' }] },
    provider_policy: { mode: 'mock', max_cost: 0, max_jobs: 100, allowed_providers: ['mock'] }, budget_limits: { max_cost: 0 }, voice_consent: { status: 'NOT_REQUIRED', voice_id: 'none' },
    ...overrides,
  };
}

function normalizeRequest(request) {
  validate('musicProductionRequest', request);
  if (request.dry_run !== true || request.provider_policy.mode !== 'mock') throw new Error('Only explicit mock dry-runs are permitted by default');
  if (request.brief.voice_requested && request.voice_consent.status !== 'GRANTED') throw new Error('AUTHORIZATION_ERROR: explicit voice consent is required');
  if (request.brief.references.some((reference) => reference.rights_status === 'RESTRICTED')) throw new Error('AUTHORIZATION_ERROR: restricted reference material is blocked');
  return { ...request, composition_id: stableId('CMP', { production_id: request.production_id, brief: request.brief }), brief: { ...request.brief, references: [...request.brief.references] } };
}

function analyzeReferences(request) {
  return request.brief.references.map((reference, index) => {
    const analysis = { reference_id: reference.reference_id, kind: reference.kind, rights_status: reference.rights_status, analysis: { bpm: 96 + index * 4, key: 'A minor', meter: '4/4', duration_seconds: 30, energy_curve: [0.25, 0.55, 0.8], mix_profile: 'balanced' }, similarity_risk: /imit(ar|ate)|copy/i.test(request.brief.purpose) ? 0.96 : 0.08 };
    validate('referenceAnalysis', analysis);
    return analysis;
  });
}

function buildConstitution(request, referenceAnalyses, existing = null) {
  const raw = {
    composition_id: request.composition_id, revision: existing ? Number(existing.revision) + 1 : 1, lock_hash: '', purpose: request.brief.purpose, use_context: 'workflow-organizer', duration_target_seconds: request.brief.duration_target_seconds, production_tier: request.production_tier, genre_family: request.brief.genre_family, mood: request.brief.mood,
    tempo: { target_bpm: 100, allowed_range: [96, 104] }, tonality: { preferred_keys: ['A minor'], mode: 'minor', allowed_modulations: [] }, meter: '4/4', harmonic_complexity: request.production_tier === 'PREMIUM' ? 'extended' : 'simple', melodic_character: 'original memorable motif', rhythmic_character: 'steady humanized', energy_curve: [0.2, 0.45, 0.82], instrument_palette: request.production_tier === 'FAST' ? ['piano', 'bass', 'drums'] : ['piano', 'bass', 'drums', 'pads', 'texture'], vocal_profile: { requested: request.brief.voice_requested, consent_status: request.voice_consent.status, synthetic_voice_disclosed: request.brief.voice_requested }, lyrical_constraints: { original_only: true }, reference_rules: referenceAnalyses.map((item) => `${item.reference_id}: analyze characteristics only`), forbidden_similarities: ['recognizable melody', 'recognizable hook', 'artist identity imitation'], structure_preferences: ['INTRO', 'VERSE', 'CHORUS', 'OUTRO'], technical_targets: { master_lufs: -14, true_peak_db: -1 }, deliverables: ['master_wav', 'master_mp3', 'stems', 'midi', 'chord_sheet'], budget_limits: request.budget_limits,
  };
  raw.lock_hash = hash({ ...raw, lock_hash: undefined });
  validate('musicConstitution', raw);
  return raw;
}

function candidates(constitution, outputDir, count) {
  const harmony = []; const melody = []; const rhythm = []; const bass = [];
  for (let index = 1; index <= count; index += 1) {
    const preview = renderFixture({ outputDir, kind: `candidate-${index}`, compositionId: constitution.composition_id, seconds: 1, frequency: 180 + index * 30 });
    const midi = renderManifest({ outputDir, kind: `midi-${index}`, value: { notes: [57 + index, 60 + index, 64 + index], bpm: constitution.tempo.target_bpm } });
    harmony.push({ candidate_id: `HAR-${String(index).padStart(3, '0')}`, key: 'A minor', scale: 'minor', progression: index % 2 ? ['Am', 'F', 'C', 'G'] : ['Am', 'G', 'F', 'E'], complexity: constitution.harmonic_complexity, preview_uri: preview.uri, midi_uri: midi.uri, compatible_tags: constitution.mood });
    melody.push({ candidate_id: `MEL-${String(index).padStart(3, '0')}`, notes: [69, 72, 76], rhythm: [1, 0.5, 0.5], range: [60, 81], memorability_score: 0.75 + index / 100, preview_uri: preview.uri, midi_uri: midi.uri, compatible_harmony_ids: [`HAR-${String(index).padStart(3, '0')}`] });
    rhythm.push({ candidate_id: `GRV-${String(index).padStart(3, '0')}`, bpm: constitution.tempo.target_bpm, meter: constitution.meter, groove: index % 2 ? 'steady' : 'syncopated', preview_uri: preview.uri, midi_uri: midi.uri, swing: index === 1 ? 0 : 0.1 });
    bass.push({ candidate_id: `BAS-${String(index).padStart(3, '0')}`, strategy: index % 2 ? 'minimal' : 'melodic', compatible_harmony_ids: [`HAR-${String(index).padStart(3, '0')}`], preview_uri: preview.uri, midi_uri: midi.uri });
  }
  const palette = [{ palette_id: 'PAL-001', roles: constitution.instrument_palette, timbre_profile: 'warm organic electronic', forbidden_instruments: [] }];
  const lyrics = constitution.vocal_profile.requested ? [{ candidate_id: 'LYR-001', concept: 'original forward motion', lyrics: 'original dry-run lyric', meter: constitution.meter, similarity_risk: 0.05, forbidden_words: [] }] : [];
  for (const item of harmony) validate('harmonyCandidate', item); for (const item of melody) validate('melodyCandidate', item); for (const item of rhythm) validate('rhythmCandidate', item); for (const item of bass) validate('bassCandidate', item); validate('instrumentPalette', palette[0]); if (lyrics[0]) validate('lyricCandidate', lyrics[0]);
  return { harmony, melody, rhythm, bass, palette, lyrics };
}

function blueprint(constitution, dna) {
  const seconds = constitution.duration_target_seconds;
  const types = seconds <= 20 ? ['INTRO', 'OUTRO'] : ['INTRO', 'VERSE', 'CHORUS', 'OUTRO'];
  const bars = Math.max(2, Math.ceil(seconds / types.length / (60 / constitution.tempo.target_bpm * 4)));
  const sections = types.map((type, index) => ({ section_id: `SEC-${String(index + 1).padStart(3, '0')}`, type, start_bar: 1 + index * bars, bars, duration_seconds: Number((seconds / types.length).toFixed(2)), energy: Number((0.25 + (index / Math.max(1, types.length - 1)) * 0.6).toFixed(2)), harmony_id: dna.harmony_id, melody_ids: dna.melody_ids, groove_id: dna.groove_id, bass_id: dna.bass_strategy_id, instrument_roles: constitution.instrument_palette, vocal_plan: { enabled: constitution.vocal_profile.requested }, transition_in: {}, transition_out: {}, dependencies: index ? [`SEC-${String(index).padStart(3, '0')}`] : [] }));
  for (const section of sections) validate('sectionManifest', section);
  const value = { composition_id: constitution.composition_id, composition_dna_id: dna.composition_dna_id, sections, duration_target_seconds: seconds, energy_curve: constitution.energy_curve };
  validate('songBlueprint', value);
  return value;
}

function createStems({ constitution, dna, songBlueprint, outputDir, roles }) {
  const jobs = []; const artifacts = [];
  for (const section of songBlueprint.sections) for (const role of roles) {
    const job = { stem_job_id: stableId('STEM', { section: section.section_id, role }), composition_id: constitution.composition_id, composition_dna_id: dna.composition_dna_id, section_id: section.section_id, stem_role: role, instrument: role.toLowerCase(), key: constitution.tonality.preferred_keys[0], scale: constitution.tonality.mode, bpm: constitution.tempo.target_bpm, meter: constitution.meter, bars: section.bars, start_bar: section.start_bar, midi_input_url: `storage://midi/${section.section_id}/${role}.mid`, audio_reference_urls: [], variation_index: 1, priority: ['DRUMS', 'BASS', 'LEADS'].includes(role) ? 10 : 3, dependencies: section.dependencies, provider: 'mock-music', status: 'QUEUED' };
    validate('stemJob', job);
    const artifact = renderFixture({ outputDir, kind: `stem-${role.toLowerCase()}`, compositionId: `${constitution.composition_id}-${section.section_id}`, seconds: section.duration_seconds, frequency: 120 + roles.indexOf(role) * 15 });
    jobs.push(job); artifacts.push({ ...artifact, section_id: section.section_id, stem_role: role });
  }
  return { jobs, artifacts };
}

function qualityReport({ dna, referenceAnalyses, vocalRequested }) {
  const similarity = Math.max(0, ...referenceAnalyses.map((item) => item.similarity_risk));
  const blocking_issues = similarity >= 0.85 ? ['SIMILARITY_BLOCK'] : [];
  const qa = { candidate_id: dna.composition_dna_id, scores: { harmonic_coherence: dna.compatibility_score, melodic_memorability: 0.81, rhythmic_quality: 0.82, arrangement: 0.84, emotional_fit: 0.85, vocal_quality: vocalRequested ? 0.8 : 1, technical_quality: 0.91, originality: Number((1 - similarity).toFixed(2)) }, blocking_issues, revision_targets: blocking_issues.length ? ['melody', 'hook', 'lyric'] : [], decision: blocking_issues.length ? 'REJECT' : 'APPROVE' };
  validate('musicQaReport', qa);
  return qa;
}

async function runProduction(input, { outputDir, ledger = new MusicLedger(), provider = new MockMusicProvider(), existingConstitution = null } = {}) {
  const request = normalizeRequest(input); const tier = TIER[request.production_tier]; const localOutput = outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'msc-dry-run-'));
  const transitions = []; const transition = (status) => { if (!STATES.includes(status)) throw new Error(`invalid production state ${status}`); transitions.push(status); };
  ledger.begin(request); transition('VALIDATING'); transition('BRIEF_READY'); const normalizedBrief = { production_id: request.production_id, purpose: request.brief.purpose, duration_target_seconds: request.brief.duration_target_seconds, genre_family: request.brief.genre_family, mood: request.brief.mood, voice_requested: request.brief.voice_requested, references: request.brief.references, restrictions: [] }; validate('musicBrief', normalizedBrief);
  const referenceAnalyses = analyzeReferences(request); transition('CONSTITUTION_BUILDING'); const constitution = buildConstitution(request, referenceAnalyses, existingConstitution); transition('CONSTITUTION_LOCKED');
  const inputHash = hash({ constitution: constitution.lock_hash, module: 'MSC-30' }); const job = ledger.upsertJob({ composition_id: request.composition_id, module: 'MSC-30', component_id: 'composition-lab', revision: constitution.revision, input_hash: inputHash, status: 'QUEUED' }); enforceBudget({ provider_policy: request.provider_policy, budget_limits: request.budget_limits }, provider.estimateCost(job)); const submitted = await provider.submit({ ...job, dry_run: true, provider_policy: request.provider_policy }); await pollControlled({ provider, request_id: submitted.request_id, maxAttempts: 2, sleep: async () => {} }); ledger.completeJob(job.job_key, submitted.result);
  transition('COMPOSITION_LAB_RUNNING'); const candidateSet = candidates(constitution, localOutput, tier.candidates); const dnas = compositionDna({ candidates: candidateSet, constitution, topK: tier.candidates, beamWidth: tier.dna }); for (const dna of dnas) validate('compositionDna', dna); if (!dnas.length) throw new Error('QUALITY_ERROR: no compatible composition DNA'); transition('COMPOSITION_CANDIDATES_READY'); const selectedDna = dnas[0];
  const songBlueprint = blueprint(constitution, selectedDna); const animaticAudio = renderFixture({ outputDir: localOutput, kind: 'song-animatic', compositionId: request.composition_id, seconds: request.brief.duration_target_seconds, frequency: 220 }); const songAnimatic = { animatic_id: stableId('ANI', selectedDna), composition_id: request.composition_id, uri: animaticAudio.uri, duration_seconds: request.brief.duration_target_seconds, components: request.brief.voice_requested ? ['guide-piano', 'guide-drums', 'guide-bass', 'guide-melody', 'guide-vocal'] : ['guide-piano', 'guide-drums', 'guide-bass', 'guide-melody'], technical_metadata: analyzeArtifact(animaticAudio) }; validate('songAnimatic', songAnimatic); ledger.recordArtifact(animaticAudio); transition('ANIMATICS_READY'); transition('COMPOSITION_SELECTED');
  transition('STEMS_PRODUCING'); const stemResult = createStems({ constitution, dna: selectedDna, songBlueprint, outputDir: localOutput, roles: tier.stems }); for (const artifact of stemResult.artifacts) ledger.recordArtifact(artifact); transition('STEMS_READY');
  let vocalManifest = { composition_id: request.composition_id, voice_consent_status: request.voice_consent.status, synthetic_voice_disclosed: Boolean(request.brief.voice_requested), voice_id: request.voice_consent.voice_id, artifacts: [] }; if (request.brief.voice_requested) { const vocal = renderFixture({ outputDir: localOutput, kind: 'vocal-lead', compositionId: request.composition_id, seconds: request.brief.duration_target_seconds, frequency: 330 }); vocalManifest.artifacts.push(vocal.uri); ledger.recordArtifact(vocal); } validate('vocalManifest', vocalManifest);
  transition('ARRANGING'); const roughMix = renderFixture({ outputDir: localOutput, kind: 'rough-mix', compositionId: request.composition_id, seconds: request.brief.duration_target_seconds, frequency: 240 }); const arrangement = { arrangement_id: stableId('ARR', { dna: selectedDna, type: 'RADIO' }), composition_id: request.composition_id, type: 'RADIO', lock_hash: hash({ stems: stemResult.artifacts.map((item) => item.checksum), dna: selectedDna }), stem_uris: stemResult.artifacts.map((item) => item.uri), rough_mix_uri: roughMix.uri }; validate('arrangementManifest', arrangement); ledger.recordArtifact(roughMix); transition('ARRANGEMENT_LOCKED');
  transition('MIXING'); const mixAudio = renderFixture({ outputDir: localOutput, kind: 'mix', compositionId: request.composition_id, seconds: request.brief.duration_target_seconds, frequency: 250 }); const mix = { mix_id: stableId('MIX', arrangement), composition_id: request.composition_id, uri: mixAudio.uri, lock_hash: hash({ arrangement: arrangement.lock_hash, target: constitution.technical_targets }), technical_targets: constitution.technical_targets, stem_uris: arrangement.stem_uris }; validate('mixManifest', mix); ledger.recordArtifact(mixAudio); transition('MIX_LOCKED');
  transition('MASTERING'); const masterAudio = renderFixture({ outputDir: localOutput, kind: 'master', compositionId: request.composition_id, seconds: request.brief.duration_target_seconds, frequency: 260 }); const master = { master_id: stableId('MAS', mix), composition_id: request.composition_id, uri: masterAudio.uri, loudness_lufs: -14, true_peak_db: -1, deliverable_uris: [masterAudio.uri], sample_rate: masterAudio.sample_rate, bit_depth: masterAudio.bit_depth }; validate('masterManifest', master); ledger.recordArtifact(masterAudio);
  transition('QA_RUNNING'); const qa = qualityReport({ dna: selectedDna, referenceAnalyses, vocalRequested: request.brief.voice_requested }); const chordSheet = renderManifest({ outputDir: localOutput, kind: 'chord-sheet', value: { key: constitution.tonality.preferred_keys[0], progression: candidateSet.harmony[0].progression } }); const packageStatus = qa.decision === 'APPROVE' ? 'READY' : 'FAILED';
  const musicPackage = { composition_id: request.composition_id, production_id: request.production_id, status: packageStatus, music_constitution: constitution, composition_dna: selectedDna, song_blueprint: songBlueprint, arrangement_manifest: arrangement, deliverables: { master_wav: masterAudio.uri, master_mp3: masterAudio.uri, pre_master: mixAudio.uri, instrumental: mixAudio.uri, acapella: vocalManifest.artifacts[0] || '', clean_version: masterAudio.uri, performance_version: masterAudio.uri, short_version_60s: masterAudio.uri, short_version_30s: masterAudio.uri, short_version_15s: masterAudio.uri, loop_version: masterAudio.uri, stems: stemResult.artifacts.map((item) => item.uri), midi_files: candidateSet.harmony.map((item) => item.midi_uri), lyrics: candidateSet.lyrics[0]?.lyrics || '', chord_sheet: chordSheet.uri, metadata: { master: analyzeArtifact(masterAudio), binary_in_control_plane: false } }, qa_reports: [qa], generation_history: [{ provider: submitted.provider, model: submitted.model, request_id: submitted.request_id, dry_run: true }], costs: { total: 0, currency: 'USD' }, provider_usage: { [submitted.provider]: 1 }, warnings: qa.blocking_issues };
  validate('musicPackage', musicPackage); const report = { production_id: request.production_id, status: packageStatus, jobs: ledger.snapshot().jobs, costs: musicPackage.costs, warnings: musicPackage.warnings, retry_summary: { max_attempts: 2, duplicate_callbacks_prevented: true } }; validate('musicProductionReport', report); ledger.finish(request.production_id, packageStatus); transition(packageStatus === 'READY' ? 'READY' : 'FAILED');
  return { request, normalized_brief: normalizedBrief, reference_analyses: referenceAnalyses, music_constitution: constitution, candidate_set: candidateSet, composition_dna: dnas, selected_composition_dna: selectedDna, song_blueprint: songBlueprint, song_animatic: songAnimatic, stem_jobs: stemResult.jobs, vocal_manifest: vocalManifest, arrangement_manifest: arrangement, mix_manifest: mix, master_manifest: master, qa_report: qa, music_package: musicPackage, production_report: report, transitions, ledger: ledger.snapshot(), output_dir: localOutput };
}

function selectiveReprocess(change, constitution) { return { change, invalidated: invalidationPlan(change), next_constitution: change === 'constitution' ? revisionOf(constitution, {}) : constitution }; }
module.exports = { TIER, STATES, JOB_STATES, baseRequest, normalizeRequest, analyzeReferences, buildConstitution, runProduction, selectiveReprocess };
