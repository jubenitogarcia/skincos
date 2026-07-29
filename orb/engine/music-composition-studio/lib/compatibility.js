const { hash } = require('./canonical');

const DIMENSIONS = [
  'tonality',
  'scale',
  'melodic_fit',
  'harmonic_rhythm',
  'groove',
  'density',
  'energy',
  'vocal_space',
  'timbre',
  'objective',
  'genre',
  'duration',
  'complexity',
  'originality',
];

function bounded(value) {
  return Number(Math.max(0, Math.min(1, Number(value))).toFixed(3));
}

function dimensionScores(candidate, constitution) {
  const preferredKey = constitution.tonality.preferred_keys[0];
  const requestedRoles = constitution.instrument_palette.length;
  const actualRoles = candidate.palette.roles.length;
  const targetDensity = constitution.production_tier === 'PREMIUM' ? 8 : constitution.production_tier === 'STANDARD' ? 5 : 3;
  const lyricsRisk = Number(candidate.lyrics?.similarity_risk || 0);
  const vocalRequested = Boolean(constitution.vocal_profile.requested);
  const hasVocalSpace = !vocalRequested || !candidate.palette.roles.includes('LEADS');
  const tempoDelta = Math.abs(candidate.groove.bpm - constitution.tempo.target_bpm);
  const harmonyCompatible = candidate.melody.compatible_harmony_ids.includes(candidate.harmony.candidate_id);
  const bassCompatible = candidate.bass.compatible_harmony_ids.includes(candidate.harmony.candidate_id);
  const genreHint = `${candidate.palette.timbre_profile} ${candidate.groove.groove}`.toLowerCase();
  const desiredHints = [...constitution.genre_family, ...constitution.mood].map((item) => String(item).toLowerCase());
  const timbreMatches = desiredHints.some((hint) => genreHint.includes(hint.split(/[-_\s]/)[0]));

  return {
    tonality: candidate.harmony.key === preferredKey ? 1 : 0.45,
    scale: candidate.harmony.scale === constitution.tonality.mode ? 1 : 0.55,
    melodic_fit: harmonyCompatible ? candidate.melody.memorability_score : 0.15,
    harmonic_rhythm: bassCompatible ? 0.95 : 0.25,
    groove: bounded(1 - tempoDelta / 40),
    density: bounded(1 - Math.abs(actualRoles - targetDensity) / Math.max(1, targetDensity)),
    energy: bounded(0.75 + Number(candidate.groove.energy || 0.15)),
    vocal_space: hasVocalSpace ? 1 : 0.55,
    timbre: timbreMatches ? 0.95 : 0.8,
    objective: constitution.purpose ? 0.9 : 0,
    genre: constitution.genre_family.length ? 0.9 : 0.5,
    duration: constitution.duration_target_seconds > 0 ? 1 : 0,
    complexity: requestedRoles >= actualRoles ? 0.95 : 0.75,
    originality: bounded(1 - lyricsRisk),
  };
}

function score(candidate, constitution) {
  const dimensions = dimensionScores(candidate, constitution);
  const total = DIMENSIONS.reduce((sum, dimension) => sum + dimensions[dimension], 0);
  return Number((total / DIMENSIONS.length).toFixed(3));
}

function buildCompatibilityMatrix({ candidates, constitution, topK = 4, beamWidth = 5, minimumScore = 0.6 }) {
  const entries = [];
  const harmonies = candidates.harmony.slice(0, topK);
  const melodies = candidates.melody.slice(0, topK);
  const grooves = candidates.rhythm.slice(0, topK);
  const evaluatedCombinations = harmonies.length * melodies.length * grooves.length;

  for (const harmony of harmonies) for (const melody of melodies) for (const groove of grooves) {
    const bass = candidates.bass.find((item) => item.compatible_harmony_ids.includes(harmony.candidate_id));
    const palette = candidates.palette[0];
    if (!bass || !palette) continue;
    const lyrics = candidates.lyrics?.[0];
    const candidate = { harmony, melody, groove, bass, palette, lyrics };
    const dimensions = dimensionScores(candidate, constitution);
    const compatibilityScore = score(candidate, constitution);
    if (compatibilityScore < minimumScore) continue;
    entries.push({
      harmony_id: harmony.candidate_id,
      melody_id: melody.candidate_id,
      groove_id: groove.candidate_id,
      bass_id: bass.candidate_id,
      palette_id: palette.palette_id,
      lyric_id: lyrics?.candidate_id || 'LYR-NONE',
      score: compatibilityScore,
      dimensions,
      reasons: DIMENSIONS.filter((dimension) => dimensions[dimension] >= 0.8),
    });
  }

  const selected = entries
    .sort((left, right) => right.score - left.score || hash(left).localeCompare(hash(right)))
    .slice(0, beamWidth);
  return {
    composition_id: constitution.composition_id,
    entries: selected,
    method: 'hard-filters+top-k+bounded-beam-search',
    evaluated_combinations: evaluatedCombinations,
    pruned_combinations: Math.max(0, evaluatedCombinations - selected.length),
    limits: { top_k: topK, beam_width: beamWidth, minimum_score: minimumScore },
  };
}

function compositionDna({ candidates, constitution, topK = 4, beamWidth = 5, matrix = null }) {
  const compatibilityMatrix = matrix || buildCompatibilityMatrix({ candidates, constitution, topK, beamWidth });
  return compatibilityMatrix.entries.map((entry, index) => ({
    composition_dna_id: `DNA-${String(index + 1).padStart(3, '0')}`,
    harmony_id: entry.harmony_id,
    melody_ids: [entry.melody_id],
    groove_id: entry.groove_id,
    bass_strategy_id: entry.bass_id,
    palette_id: entry.palette_id,
    lyric_concept_id: entry.lyric_id,
    compatibility_score: entry.score,
  }));
}

module.exports = { DIMENSIONS, dimensionScores, score, buildCompatibilityMatrix, compositionDna };
