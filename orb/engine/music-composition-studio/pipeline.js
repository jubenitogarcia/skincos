const fs = require('fs');
const os = require('os');
const path = require('path');
const { validate } = require('./lib/contracts');
const { hash, stableId } = require('./lib/canonical');
const { MusicLedger } = require('./lib/ledger');
const { MockMusicProvider, executeProviderJob } = require('./lib/providers');
const { buildCompatibilityMatrix, compositionDna } = require('./lib/compatibility');
const { invalidationPlan, revisionOf } = require('./lib/invalidation');
const { renderFixture, analyzeArtifact, renderManifest } = require('./services/audio-service');

const TIER = {
  FAST: {
    candidates: 3,
    dna: 3,
    stems: ['DRUMS', 'BASS', 'PIANO'],
    arrangements: 1,
    mixes: 1,
    retries: 1,
    maxJobs: 48,
  },
  STANDARD: {
    candidates: 4,
    dna: 4,
    stems: ['DRUMS', 'PERCUSSION', 'BASS', 'PIANO', 'KEYS', 'PADS'],
    arrangements: 2,
    mixes: 2,
    retries: 2,
    maxJobs: 160,
  },
  PREMIUM: {
    candidates: 5,
    dna: 5,
    stems: ['DRUMS', 'PERCUSSION', 'BASS', 'PIANO', 'KEYS', 'GUITARS', 'SYNTHS', 'STRINGS', 'BRASS', 'LEADS', 'PADS', 'TEXTURES', 'AMBIENCE', 'FX'],
    arrangements: 3,
    mixes: 3,
    retries: 3,
    maxJobs: 500,
  },
};

const STATES = [
  'DRAFT',
  'VALIDATING',
  'NEEDS_INFORMATION',
  'BRIEF_READY',
  'CONSTITUTION_BUILDING',
  'CONSTITUTION_LOCKED',
  'COMPOSITION_LAB_RUNNING',
  'COMPOSITION_CANDIDATES_READY',
  'ANIMATICS_READY',
  'COMPOSITION_SELECTED',
  'STEMS_PRODUCING',
  'STEMS_READY',
  'ARRANGING',
  'ARRANGEMENT_LOCKED',
  'MIXING',
  'MIX_LOCKED',
  'MASTERING',
  'QA_RUNNING',
  'READY',
  'PARTIALLY_READY',
  'FAILED',
  'ARCHIVED',
];

const JOB_STATES = [
  'PENDING',
  'READY',
  'QUEUED',
  'SUBMITTED',
  'PROCESSING',
  'WAITING_PROVIDER',
  'COMPLETED',
  'VALIDATED',
  'APPROVED',
  'FAILED_RETRYABLE',
  'FAILED_BLOCKING',
  'RETRYING',
  'FALLBACK',
  'INVALIDATED',
  'SKIPPED',
  'CANCELLED',
];

function baseRequest(overrides = {}) {
  return {
    schema_version: '1.0.0',
    production_id: 'MSC-DRY-FAST',
    production_tier: 'FAST',
    dry_run: true,
    brief: {
      purpose: 'vinheta instrumental original para conteúdo social',
      duration_target_seconds: 15,
      genre_family: ['ambient-pop'],
      mood: ['warm', 'optimistic'],
      voice_requested: false,
      references: [{
        reference_id: 'REF-MIX-1',
        kind: 'MIX_REFERENCE',
        rights_status: 'LICENSED',
        reference_usage_scope: 'ANALYZE_ONLY',
        source_uri: 'storage://fixture/mix-reference.wav',
      }],
    },
    provider_policy: {
      mode: 'mock',
      max_cost: 0,
      max_jobs: 500,
      allowed_providers: ['mock'],
    },
    budget_limits: { max_cost: 0 },
    voice_consent: { status: 'NOT_REQUIRED', voice_id: 'none' },
    ...overrides,
  };
}

function normalizeRequest(request) {
  validate('musicProductionRequest', request);
  if (request.dry_run !== true || request.provider_policy.mode !== 'mock') {
    throw new Error('AUTHORIZATION_ERROR: only explicit mock dry-runs are permitted by default');
  }
  if (request.brief.voice_requested && request.voice_consent.status !== 'GRANTED') {
    throw new Error('AUTHORIZATION_ERROR: explicit voice consent is required');
  }
  if (request.brief.references.some((reference) => reference.rights_status === 'RESTRICTED')) {
    throw new Error('AUTHORIZATION_ERROR: restricted reference material is blocked');
  }
  return {
    ...request,
    composition_id: stableId('CMP', {
      production_id: request.production_id,
      brief: request.brief,
    }),
    brief: {
      ...request.brief,
      references: [...request.brief.references],
    },
  };
}

function analyzeReferences(request) {
  return request.brief.references.map((reference, index) => {
    const result = {
      reference_id: reference.reference_id,
      kind: reference.kind,
      rights_status: reference.rights_status,
      analysis: {
        bpm: 96 + index * 4,
        key: 'A minor',
        meter: '4/4',
        duration_seconds: 30,
        energy_curve: [0.25, 0.55, 0.8],
        mix_profile: 'balanced',
      },
      similarity_risk: /imit(ar|ate)|copy|artist/i.test(request.brief.purpose) ? 0.96 : 0.08,
    };
    validate('referenceAnalysis', result);
    return result;
  });
}

function technicalTargets(request) {
  if (/cinema|film|cinematic/i.test(request.brief.purpose)) {
    return {
      master_lufs: -16,
      true_peak_db: -1,
      sample_rate: 48_000,
      bit_depth: 24,
    };
  }
  return {
    master_lufs: -14,
    true_peak_db: -1,
    sample_rate: 48_000,
    bit_depth: 24,
  };
}

function buildConstitution(request, referenceAnalyses, existing = null) {
  const constitution = {
    composition_id: request.composition_id,
    revision: existing ? Number(existing.revision) + 1 : 1,
    lock_hash: '',
    purpose: request.brief.purpose,
    use_context: 'workflow-organizer',
    duration_target_seconds: request.brief.duration_target_seconds,
    production_tier: request.production_tier,
    genre_family: request.brief.genre_family,
    mood: request.brief.mood,
    tempo: { target_bpm: 100, allowed_range: [96, 104] },
    tonality: {
      preferred_keys: ['A minor'],
      mode: 'minor',
      allowed_modulations: [],
    },
    meter: '4/4',
    harmonic_complexity: request.production_tier === 'PREMIUM' ? 'extended' : 'simple',
    melodic_character: 'original memorable motif',
    rhythmic_character: 'steady humanized',
    energy_curve: [0.2, 0.45, 0.82],
    instrument_palette: TIER[request.production_tier].stems.map((role) => role.toLowerCase()),
    vocal_profile: {
      requested: request.brief.voice_requested,
      consent_status: request.voice_consent.status,
      synthetic_voice_disclosed: request.brief.voice_requested,
    },
    lyrical_constraints: { original_only: true, forbidden_words: [] },
    reference_rules: referenceAnalyses.map((item) => `${item.reference_id}: analyze characteristics only`),
    forbidden_similarities: [
      'recognizable melody',
      'recognizable hook',
      'artist identity imitation',
      'unauthorized voice identity',
    ],
    structure_preferences: ['INTRO', 'VERSE', 'CHORUS', 'OUTRO'],
    technical_targets: technicalTargets(request),
    deliverables: ['master_wav', 'master_mp3', 'stems', 'midi', 'chord_sheet'],
    budget_limits: request.budget_limits,
  };
  constitution.lock_hash = hash({ ...constitution, lock_hash: undefined });
  validate('musicConstitution', constitution);
  return constitution;
}

function buildCandidates(constitution, outputDir, count) {
  const result = {
    harmony: [],
    melody: [],
    rhythm: [],
    bass: [],
    palette: [],
    lyrics: [],
  };

  for (let index = 1; index <= count; index += 1) {
    const suffix = String(index).padStart(3, '0');
    const preview = renderFixture({
      outputDir,
      kind: `candidate-${index}`,
      compositionId: constitution.composition_id,
      seconds: 1,
      frequency: 180 + index * 30,
    });
    const midi = renderManifest({
      outputDir,
      kind: `midi-${index}`,
      value: {
        notes: [57 + index, 60 + index, 64 + index],
        bpm: constitution.tempo.target_bpm,
      },
    });

    result.harmony.push({
      candidate_id: `HAR-${suffix}`,
      key: 'A minor',
      scale: 'minor',
      progression: index % 2 ? ['Am', 'F', 'C', 'G'] : ['Am', 'G', 'F', 'E'],
      complexity: constitution.harmonic_complexity,
      preview_uri: preview.uri,
      midi_uri: midi.uri,
      compatible_tags: constitution.mood,
    });
    result.melody.push({
      candidate_id: `MEL-${suffix}`,
      notes: [69, 72, 76],
      rhythm: [1, 0.5, 0.5],
      range: [60, 81],
      memorability_score: 0.75 + index / 100,
      preview_uri: preview.uri,
      midi_uri: midi.uri,
      compatible_harmony_ids: [`HAR-${suffix}`],
    });
    result.rhythm.push({
      candidate_id: `GRV-${suffix}`,
      bpm: constitution.tempo.target_bpm,
      meter: constitution.meter,
      groove: index % 2 ? 'steady' : 'syncopated',
      preview_uri: preview.uri,
      midi_uri: midi.uri,
      swing: index === 1 ? 0 : 0.1,
    });
    result.bass.push({
      candidate_id: `BAS-${suffix}`,
      strategy: index % 2 ? 'minimal' : 'melodic',
      compatible_harmony_ids: [`HAR-${suffix}`],
      preview_uri: preview.uri,
      midi_uri: midi.uri,
    });
  }

  result.palette.push({
    palette_id: 'PAL-001',
    roles: constitution.instrument_palette,
    timbre_profile: 'warm organic electronic',
    forbidden_instruments: [],
  });

  if (constitution.vocal_profile.requested) {
    result.lyrics.push({
      candidate_id: 'LYR-001',
      concept: 'original forward motion',
      lyrics: 'original dry-run lyric',
      meter: constitution.meter,
      similarity_risk: 0.05,
      forbidden_words: [],
    });
  }

  for (const item of result.harmony) validate('harmonyCandidate', item);
  for (const item of result.melody) validate('melodyCandidate', item);
  for (const item of result.rhythm) validate('rhythmCandidate', item);
  for (const item of result.bass) validate('bassCandidate', item);
  validate('instrumentPalette', result.palette[0]);
  if (result.lyrics[0]) validate('lyricCandidate', result.lyrics[0]);
  return result;
}

function buildBlueprint(constitution, dna) {
  const seconds = constitution.duration_target_seconds;
  const types = seconds <= 30
    ? ['INTRO', 'CHORUS', 'OUTRO']
    : constitution.production_tier === 'PREMIUM'
      ? ['INTRO', 'VERSE', 'PRE_CHORUS', 'CHORUS', 'BRIDGE', 'CHORUS', 'OUTRO']
      : ['INTRO', 'VERSE', 'CHORUS', 'OUTRO'];
  const bars = Math.max(
    2,
    Math.ceil(seconds / types.length / (60 / constitution.tempo.target_bpm * 4)),
  );
  const sections = types.map((type, index) => ({
    section_id: `SEC-${String(index + 1).padStart(3, '0')}`,
    type,
    start_bar: 1 + index * bars,
    bars,
    duration_seconds: Number((seconds / types.length).toFixed(2)),
    energy: Number((0.25 + (index / Math.max(1, types.length - 1)) * 0.6).toFixed(2)),
    harmony_id: dna.harmony_id,
    melody_ids: dna.melody_ids,
    groove_id: dna.groove_id,
    bass_id: dna.bass_strategy_id,
    instrument_roles: constitution.instrument_palette,
    vocal_plan: { enabled: constitution.vocal_profile.requested },
    transition_in: { type: index ? 'CROSSFADE' : 'NONE' },
    transition_out: { type: index < types.length - 1 ? 'FILL' : 'NONE' },
    dependencies: index ? [`SEC-${String(index).padStart(3, '0')}`] : [],
  }));
  for (const section of sections) validate('sectionManifest', section);
  const blueprint = {
    composition_id: constitution.composition_id,
    composition_dna_id: dna.composition_dna_id,
    sections,
    duration_target_seconds: seconds,
    energy_curve: constitution.energy_curve,
  };
  validate('songBlueprint', blueprint);
  return blueprint;
}

function createStems({ constitution, dna, songBlueprint, outputDir, tier }) {
  const jobs = [];
  const artifacts = [];
  for (const section of songBlueprint.sections) {
    for (const role of tier.stems) {
      const variations = ['DRUMS', 'BASS', 'LEADS'].includes(role)
        ? Math.min(2, tier.candidates)
        : 1;
      for (let variation = 1; variation <= variations; variation += 1) {
        const job = {
          stem_job_id: stableId('STEM', {
            section: section.section_id,
            role,
            variation,
          }),
          composition_id: constitution.composition_id,
          composition_dna_id: dna.composition_dna_id,
          section_id: section.section_id,
          stem_role: role,
          instrument: role.toLowerCase(),
          key: constitution.tonality.preferred_keys[0],
          scale: constitution.tonality.mode,
          bpm: constitution.tempo.target_bpm,
          meter: constitution.meter,
          bars: section.bars,
          start_bar: section.start_bar,
          midi_input_url: `storage://midi/${section.section_id}/${role}.mid`,
          audio_reference_urls: [],
          variation_index: variation,
          priority: ['DRUMS', 'BASS', 'LEADS'].includes(role) ? 10 : 3,
          dependencies: section.dependencies,
          provider: 'mock-music',
          status: 'QUEUED',
        };
        validate('stemJob', job);
        const artifact = renderFixture({
          outputDir,
          kind: `stem-${role.toLowerCase()}-${variation}`,
          compositionId: `${constitution.composition_id}-${section.section_id}`,
          seconds: section.duration_seconds,
          frequency: 120 + tier.stems.indexOf(role) * 15 + variation,
        });
        jobs.push(job);
        artifacts.push({
          ...artifact,
          section_id: section.section_id,
          stem_role: role,
          variation_index: variation,
        });
      }
    }
  }
  if (jobs.length > tier.maxJobs) throw new Error('BUDGET_EXCEEDED: tier job limit exceeded');
  return { jobs, artifacts };
}

function buildVocalManifest(request, compositionId, outputDir, ledger) {
  const manifest = {
    composition_id: compositionId,
    voice_consent_status: request.voice_consent.status,
    synthetic_voice_disclosed: Boolean(request.brief.voice_requested),
    voice_id: request.voice_consent.voice_id,
    artifacts: [],
  };
  if (request.brief.voice_requested) {
    const kinds = ['vocal-lead', 'vocal-double', 'vocal-harmony', 'vocal-ad-lib'];
    for (const [index, kind] of kinds.entries()) {
      const artifact = renderFixture({
        outputDir,
        kind,
        compositionId,
        seconds: request.brief.duration_target_seconds,
        frequency: 330 + index * 20,
      });
      manifest.artifacts.push(artifact.uri);
      ledger.recordArtifact(artifact);
      recordLocalJob(ledger, {
        compositionId,
        module: 'MSC-60',
        componentId: `vocal:${kind}`,
        revision: 1,
        input: { kind, voice_id: request.voice_consent.voice_id },
        output: artifact,
      });
    }
  }
  validate('vocalManifest', manifest);
  return manifest;
}

function createArrangements({
  constitution,
  dna,
  stemArtifacts,
  outputDir,
  count,
  ledger,
}) {
  const types = ['RADIO', 'CINEMATIC', 'ACOUSTIC'];
  return Array.from({ length: count }, (_, index) => {
    const roughMix = renderFixture({
      outputDir,
      kind: `rough-mix-${index + 1}`,
      compositionId: constitution.composition_id,
      seconds: constitution.duration_target_seconds,
      frequency: 240 + index * 8,
    });
    const arrangement = {
      arrangement_id: stableId('ARR', { dna, type: types[index] }),
      composition_id: constitution.composition_id,
      type: types[index],
      lock_hash: hash({
        stems: stemArtifacts.map((item) => item.checksum),
        dna,
        type: types[index],
      }),
      stem_uris: stemArtifacts
        .filter((item) => item.variation_index === 1)
        .map((item) => item.uri),
      rough_mix_uri: roughMix.uri,
    };
    validate('arrangementManifest', arrangement);
    ledger.recordArtifact(roughMix);
    return arrangement;
  });
}

function createMixes({ constitution, arrangement, outputDir, count, ledger }) {
  return Array.from({ length: count }, (_, index) => {
    const audio = renderFixture({
      outputDir,
      kind: `mix-${index + 1}`,
      compositionId: constitution.composition_id,
      seconds: constitution.duration_target_seconds,
      frequency: 250 + index * 8,
    });
    const mix = {
      mix_id: stableId('MIX', { arrangement, index }),
      composition_id: constitution.composition_id,
      uri: audio.uri,
      lock_hash: hash({
        arrangement: arrangement.lock_hash,
        target: constitution.technical_targets,
        index,
      }),
      technical_targets: constitution.technical_targets,
      stem_uris: arrangement.stem_uris,
    };
    validate('mixManifest', mix);
    ledger.recordArtifact(audio);
    return { manifest: mix, audio };
  });
}

function recordLocalJob(ledger, {
  compositionId,
  module,
  componentId,
  revision,
  input,
  output,
}) {
  const stored = ledger.upsertJob({
    composition_id: compositionId,
    module,
    component_id: componentId,
    revision,
    input_hash: hash(input),
    status: 'QUEUED',
    provider: 'local-audio-fixture',
    model: 'deterministic-wav-v1',
    cost: 0,
  });
  if (!stored.reused) ledger.completeJob(stored.job_key, output);
  return ledger.updateJobStatus(stored.job_key, 'COMPLETED', {
    provider: 'local-audio-fixture',
    model: 'deterministic-wav-v1',
    cost: 0,
  });
}

function qualityReport({ dna, referenceAnalyses, vocalRequested }) {
  const similarity = Math.max(
    0,
    ...referenceAnalyses.map((item) => item.similarity_risk),
  );
  const blockingIssues = similarity >= 0.85 ? ['SIMILARITY_BLOCK'] : [];
  const report = {
    candidate_id: dna.composition_dna_id,
    scores: {
      harmonic_coherence: dna.compatibility_score,
      melodic_memorability: 0.81,
      rhythmic_quality: 0.82,
      arrangement: 0.84,
      emotional_fit: 0.85,
      vocal_quality: vocalRequested ? 0.8 : 1,
      technical_quality: 0.91,
      originality: Number((1 - similarity).toFixed(2)),
    },
    blocking_issues: blockingIssues,
    revision_targets: blockingIssues.length ? ['melody', 'hook', 'lyric'] : [],
    decision: blockingIssues.length ? 'REJECT' : 'APPROVE',
  };
  validate('musicQaReport', report);
  return report;
}

async function runProduction(
  input,
  {
    outputDir,
    ledger = new MusicLedger(),
    provider = new MockMusicProvider(),
    fallbackProvider = null,
    existingConstitution = null,
  } = {},
) {
  const request = normalizeRequest(input);
  const tier = TIER[request.production_tier];
  const localOutput = outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'msc-dry-run-'));
  const transitions = [];
  const transition = (status) => {
    if (!STATES.includes(status)) throw new Error(`invalid production state ${status}`);
    transitions.push(status);
  };

  const productionStart = ledger.begin(request);
  transition('VALIDATING');
  const normalizedBrief = {
    production_id: request.production_id,
    purpose: request.brief.purpose,
    duration_target_seconds: request.brief.duration_target_seconds,
    genre_family: request.brief.genre_family,
    mood: request.brief.mood,
    voice_requested: request.brief.voice_requested,
    references: request.brief.references,
    restrictions: [],
  };
  validate('musicBrief', normalizedBrief);
  transition('BRIEF_READY');

  const referenceAnalyses = analyzeReferences(request);
  const sourceMaterialManifest = request.brief.references.map((reference) => ({
    reference_id: reference.reference_id,
    source_uri: reference.source_uri,
    rights_status: reference.rights_status,
    reference_usage_scope: reference.reference_usage_scope,
  }));
  transition('CONSTITUTION_BUILDING');
  const constitution = buildConstitution(
    request,
    referenceAnalyses,
    existingConstitution,
  );
  transition('CONSTITUTION_LOCKED');

  const inputHash = hash({
    constitution: constitution.lock_hash,
    module: 'MSC-30',
    provider: provider.name,
    model: provider.model,
    parameters: tier,
    references: referenceAnalyses,
    revision: constitution.revision,
  });
  const providerExecution = await executeProviderJob({
    ledger,
    provider,
    fallbackProvider,
    request,
    job: {
      composition_id: request.composition_id,
      module: 'MSC-30',
      component_id: 'composition-lab',
      revision: constitution.revision,
      input_hash: inputHash,
      status: 'QUEUED',
      provider: provider.name,
      model: provider.model,
      lineage: { constitution_hash: constitution.lock_hash },
    },
    maxAttempts: tier.retries + 1,
    sleep: async () => {},
  });
  ledger.recordCallback({
    event_id: `${providerExecution.provider}:${providerExecution.request_id}:completed`,
    provider: providerExecution.provider,
    provider_request_id: providerExecution.request_id,
    payload: { output_hash: hash(providerExecution.output) },
  });

  transition('COMPOSITION_LAB_RUNNING');
  const candidateSet = buildCandidates(
    constitution,
    localOutput,
    tier.candidates,
  );
  const compatibilityMatrix = buildCompatibilityMatrix({
    candidates: candidateSet,
    constitution,
    topK: tier.candidates,
    beamWidth: tier.dna,
  });
  validate('compatibilityMatrix', compatibilityMatrix);
  const dnas = compositionDna({
    candidates: candidateSet,
    constitution,
    topK: tier.candidates,
    beamWidth: tier.dna,
    matrix: compatibilityMatrix,
  });
  for (const dna of dnas) validate('compositionDna', dna);
  if (!dnas.length) throw new Error('QUALITY_ERROR: no compatible composition DNA');
  transition('COMPOSITION_CANDIDATES_READY');
  const selectedDna = dnas[0];

  const songBlueprint = buildBlueprint(constitution, selectedDna);
  const songAnimatics = dnas.map((dna, index) => {
    const audio = renderFixture({
      outputDir: localOutput,
      kind: `song-animatic-${index + 1}`,
      compositionId: request.composition_id,
      seconds: request.brief.duration_target_seconds,
      frequency: 220 + index * 10,
    });
    const animatic = {
      animatic_id: stableId('ANI', dna),
      composition_id: request.composition_id,
      uri: audio.uri,
      duration_seconds: request.brief.duration_target_seconds,
      components: request.brief.voice_requested
        ? ['guide-piano', 'guide-drums', 'guide-bass', 'guide-melody', 'guide-vocal']
        : ['guide-piano', 'guide-drums', 'guide-bass', 'guide-melody'],
      technical_metadata: analyzeArtifact(audio),
    };
    validate('songAnimatic', animatic);
    ledger.recordArtifact(audio);
    return animatic;
  });
  transition('ANIMATICS_READY');
  transition('COMPOSITION_SELECTED');

  transition('STEMS_PRODUCING');
  const stemResult = createStems({
    constitution,
    dna: selectedDna,
    songBlueprint,
    outputDir: localOutput,
    tier,
  });
  if (stemResult.jobs.length > request.provider_policy.max_jobs) {
    throw new Error('BUDGET_EXCEEDED: request job limit exceeded');
  }
  for (const [index, artifact] of stemResult.artifacts.entries()) {
    ledger.recordArtifact(artifact);
    const stemJob = stemResult.jobs[index];
    recordLocalJob(ledger, {
      compositionId: request.composition_id,
      module: 'MSC-50',
      componentId: `${stemJob.stem_role}:${stemJob.section_id}:v${stemJob.variation_index}`,
      revision: constitution.revision,
      input: stemJob,
      output: artifact,
    });
  }
  transition('STEMS_READY');

  const vocalManifest = buildVocalManifest(
    request,
    request.composition_id,
    localOutput,
    ledger,
  );

  transition('ARRANGING');
  const arrangements = createArrangements({
    constitution,
    dna: selectedDna,
    stemArtifacts: stemResult.artifacts,
    outputDir: localOutput,
    count: tier.arrangements,
    ledger,
  });
  for (const candidate of arrangements) {
    recordLocalJob(ledger, {
      compositionId: request.composition_id,
      module: 'MSC-70',
      componentId: `arrangement:${candidate.type}`,
      revision: constitution.revision,
      input: candidate.stem_uris,
      output: candidate,
    });
  }
  const arrangement = arrangements[0];
  transition('ARRANGEMENT_LOCKED');

  transition('MIXING');
  const mixes = createMixes({
    constitution,
    arrangement,
    outputDir: localOutput,
    count: tier.mixes,
    ledger,
  });
  for (const candidate of mixes) {
    recordLocalJob(ledger, {
      compositionId: request.composition_id,
      module: 'MSC-80',
      componentId: `mix:${candidate.manifest.mix_id}`,
      revision: constitution.revision,
      input: candidate.manifest,
      output: candidate.audio,
    });
  }
  const selectedMix = mixes[0];
  transition('MIX_LOCKED');

  transition('MASTERING');
  const masterAudio = renderFixture({
    outputDir: localOutput,
    kind: 'master',
    compositionId: request.composition_id,
    seconds: request.brief.duration_target_seconds,
    frequency: 260,
  });
  const master = {
    master_id: stableId('MAS', selectedMix.manifest),
    composition_id: request.composition_id,
    uri: masterAudio.uri,
    loudness_lufs: constitution.technical_targets.master_lufs,
    true_peak_db: constitution.technical_targets.true_peak_db,
    deliverable_uris: [masterAudio.uri],
    sample_rate: masterAudio.sample_rate,
    bit_depth: masterAudio.bit_depth,
  };
  validate('masterManifest', master);
  ledger.recordArtifact(masterAudio);
  recordLocalJob(ledger, {
    compositionId: request.composition_id,
    module: 'MSC-80',
    componentId: 'master',
    revision: constitution.revision,
    input: selectedMix.manifest,
    output: master,
  });

  for (const animatic of songAnimatics) ledger.addDependency(animatic.animatic_id, selectedDna.composition_dna_id);
  for (const stemJob of stemResult.jobs) {
    ledger.addDependency(stemJob.stem_job_id, stemJob.section_id);
    ledger.addDependency(stemJob.stem_job_id, stemJob.composition_dna_id);
  }
  for (const candidate of arrangements) for (const uri of candidate.stem_uris) ledger.addDependency(candidate.arrangement_id, uri);
  for (const candidate of mixes) ledger.addDependency(candidate.manifest.mix_id, arrangement.arrangement_id);
  ledger.addDependency(master.master_id, selectedMix.manifest.mix_id);
  ledger.addDependency('music-package', master.master_id);

  transition('QA_RUNNING');
  const qa = qualityReport({
    dna: selectedDna,
    referenceAnalyses,
    vocalRequested: request.brief.voice_requested,
  });
  const chordSheet = renderManifest({
    outputDir: localOutput,
    kind: 'chord-sheet',
    value: {
      key: constitution.tonality.preferred_keys[0],
      progression: candidateSet.harmony[0].progression,
    },
  });
  const packageStatus = qa.decision === 'APPROVE' ? 'READY' : 'FAILED';
  const musicPackage = {
    composition_id: request.composition_id,
    production_id: request.production_id,
    status: packageStatus,
    music_constitution: constitution,
    compatibility_matrix: compatibilityMatrix,
    composition_dna: selectedDna,
    song_blueprint: songBlueprint,
    arrangement_manifest: arrangement,
    deliverables: {
      master_wav: masterAudio.uri,
      master_mp3: masterAudio.uri,
      pre_master: selectedMix.audio.uri,
      instrumental: selectedMix.audio.uri,
      acapella: vocalManifest.artifacts[0] || '',
      clean_version: masterAudio.uri,
      performance_version: masterAudio.uri,
      short_version_60s: masterAudio.uri,
      short_version_30s: masterAudio.uri,
      short_version_15s: masterAudio.uri,
      loop_version: masterAudio.uri,
      stems: stemResult.artifacts.map((item) => item.uri),
      midi_files: candidateSet.harmony.map((item) => item.midi_uri),
      lyrics: candidateSet.lyrics[0]?.lyrics || '',
      chord_sheet: chordSheet.uri,
      metadata: {
        master: analyzeArtifact(masterAudio),
        binary_in_control_plane: false,
        dry_run_audio_format: 'PCM_WAV_FIXTURE',
      },
    },
    qa_reports: [qa],
    generation_history: [{
      provider: providerExecution.provider,
      model: providerExecution.model,
      request_id: providerExecution.request_id,
      dry_run: true,
      reused: providerExecution.reused,
      attempts: providerExecution.attempts || 0,
    }],
    costs: { total: ledger.totalCost(), currency: 'USD', events: ledger.snapshot().costs },
    provider_usage: { [providerExecution.provider]: providerExecution.reused ? 0 : 1 },
    warnings: qa.blocking_issues,
  };
  validate('musicPackage', musicPackage);
  recordLocalJob(ledger, {
    compositionId: request.composition_id,
    module: 'MSC-90',
    componentId: 'package',
    revision: constitution.revision,
    input: { master: master.master_id, qa: qa.decision },
    output: musicPackage,
  });
  const report = {
    production_id: request.production_id,
    status: packageStatus,
    jobs: ledger.snapshot().jobs,
    costs: musicPackage.costs,
    warnings: musicPackage.warnings,
    retry_summary: {
      max_attempts: tier.retries + 1,
      duplicate_callbacks_prevented: productionStart.reused || ledger.snapshot().callbacks.some((event) => event.duplicate),
    },
  };
  validate('musicProductionReport', report);
  ledger.finish(request.production_id, packageStatus);
  transition(packageStatus === 'READY' ? 'READY' : 'FAILED');

  return {
    request,
    normalized_brief: normalizedBrief,
    source_material_manifest: sourceMaterialManifest,
    reference_analyses: referenceAnalyses,
    music_constitution: constitution,
    candidate_set: candidateSet,
    compatibility_matrix: compatibilityMatrix,
    composition_dna: dnas,
    selected_composition_dna: selectedDna,
    song_blueprint: songBlueprint,
    song_animatics: songAnimatics,
    song_animatic: songAnimatics[0],
    stem_jobs: stemResult.jobs,
    stem_artifacts: stemResult.artifacts,
    vocal_manifest: vocalManifest,
    arrangement_candidates: arrangements,
    arrangement_manifest: arrangement,
    mix_candidates: mixes.map((item) => item.manifest),
    mix_manifest: selectedMix.manifest,
    master_manifest: master,
    qa_report: qa,
    music_package: musicPackage,
    production_report: report,
    transitions,
    ledger: ledger.snapshot(),
    ledger_store: ledger,
    provider_execution: providerExecution,
    output_dir: localOutput,
  };
}

function selectiveReprocess(change, constitution, { ledger = null, patch = {} } = {}) {
  const invalidated = invalidationPlan(change);
  return {
    change,
    invalidated,
    invalidated_jobs: ledger ? ledger.invalidateComponents(invalidated, change) : [],
    next_constitution: change === 'constitution'
      ? revisionOf(constitution, patch)
      : constitution,
  };
}

function executeSelectiveReprocess({
  result,
  change,
  patch = {},
  ledger = result.ledger_store,
  outputDir = result.output_dir,
}) {
  const plan = selectiveReprocess(change, result.music_constitution, { ledger, patch });
  const nextPackage = {
    ...result.music_package,
    deliverables: {
      ...result.music_package.deliverables,
      metadata: {
        ...result.music_package.deliverables.metadata,
        annotations: {
          ...(result.music_package.deliverables.metadata.annotations || {}),
        },
      },
    },
  };
  const regenerated = [];

  if (change === 'metadata') {
    nextPackage.deliverables.metadata.annotations = {
      ...nextPackage.deliverables.metadata.annotations,
      ...patch,
    };
    regenerated.push('package');
  } else if (change === 'loudness') {
    const remaster = renderFixture({
      outputDir,
      kind: `master-remaster-${patch.master_lufs ?? -16}`,
      compositionId: result.request.composition_id,
      seconds: result.request.brief.duration_target_seconds,
      frequency: 265,
    });
    ledger.recordArtifact(remaster);
    nextPackage.deliverables.master_wav = remaster.uri;
    nextPackage.deliverables.metadata.master = analyzeArtifact(remaster);
    nextPackage.deliverables.metadata.annotations.target_loudness_lufs = patch.master_lufs ?? -16;
    regenerated.push('master', 'package');
  } else if (change === 'bass_timbre' || change === 'chorus') {
    const affectedSections = new Set(
      change === 'chorus'
        ? result.song_blueprint.sections.filter((section) => section.type === 'CHORUS').map((section) => section.section_id)
        : result.song_blueprint.sections.map((section) => section.section_id),
    );
    const affectedArtifacts = result.stem_artifacts.filter((artifact) => (
      change === 'bass_timbre'
        ? artifact.stem_role === 'BASS'
        : affectedSections.has(artifact.section_id)
    ));
    const affectedUris = new Set(affectedArtifacts.map((artifact) => artifact.uri));
    const replacements = affectedArtifacts.map((artifact, index) => renderFixture({
      outputDir,
      kind: `reprocess-${change}-${artifact.stem_role.toLowerCase()}-${index + 1}`,
      compositionId: `${result.request.composition_id}-${artifact.section_id}`,
      seconds: result.song_blueprint.sections.find((section) => section.section_id === artifact.section_id).duration_seconds,
      frequency: 170 + index * 3,
    }));
    for (const artifact of replacements) ledger.recordArtifact(artifact);
    nextPackage.deliverables.stems = nextPackage.deliverables.stems
      .filter((uri) => !affectedUris.has(uri))
      .concat(replacements.map((artifact) => artifact.uri));
    const remix = renderFixture({
      outputDir,
      kind: `reprocess-${change}-mix`,
      compositionId: result.request.composition_id,
      seconds: result.request.brief.duration_target_seconds,
      frequency: 270,
    });
    const remaster = renderFixture({
      outputDir,
      kind: `reprocess-${change}-master`,
      compositionId: result.request.composition_id,
      seconds: result.request.brief.duration_target_seconds,
      frequency: 275,
    });
    ledger.recordArtifact(remix);
    ledger.recordArtifact(remaster);
    nextPackage.deliverables.pre_master = remix.uri;
    nextPackage.deliverables.master_wav = remaster.uri;
    nextPackage.deliverables.metadata.master = analyzeArtifact(remaster);
    regenerated.push(...plan.invalidated);
  } else if (change === 'constitution') {
    regenerated.push(...plan.invalidated);
  } else {
    regenerated.push('manual_review');
  }

  const components = ['candidates', 'composition_dna', 'animatic', 'stems', 'arrangement', 'mix', 'master', 'package'];
  const preserved = components.filter((component) => !regenerated.includes(component));
  validate('musicPackage', nextPackage);
  return {
    ...plan,
    result: { ...result, music_package: nextPackage },
    regenerated: [...new Set(regenerated)],
    preserved,
  };
}

module.exports = {
  TIER,
  STATES,
  JOB_STATES,
  baseRequest,
  normalizeRequest,
  analyzeReferences,
  buildConstitution,
  runProduction,
  selectiveReprocess,
  executeSelectiveReprocess,
};
