#!/usr/bin/env node
const assert = require('assert');
const { TIER, baseRequest, runProduction } = require('../music-composition-studio/pipeline');

async function main() {
  const baseline = baseRequest();
  const fixtures = [
    baseRequest({ production_id: 'MSC-DRY-FAST', production_tier: 'FAST' }),
    baseRequest({ production_id: 'MSC-DRY-STANDARD', production_tier: 'STANDARD', brief: { ...baseline.brief, duration_target_seconds: 75 } }),
    baseRequest({ production_id: 'MSC-DRY-PREMIUM', production_tier: 'PREMIUM', brief: { ...baseline.brief, duration_target_seconds: 120, voice_requested: true }, voice_consent: { status: 'GRANTED', voice_id: 'synthetic-fixture-voice' } }),
  ];
  const results = [];

  for (const fixture of fixtures) {
    const result = await runProduction(fixture);
    const expected = TIER[fixture.production_tier];
    assert.strictEqual(result.music_package.status, 'READY');
    assert.strictEqual(result.composition_dna.length, expected.dna);
    assert.strictEqual(result.song_animatics.length, expected.dna);
    assert.strictEqual(result.arrangement_candidates.length, expected.arrangements);
    assert.strictEqual(result.mix_candidates.length, expected.mixes);
    assert.strictEqual(result.compatibility_matrix.entries.length, expected.dna);
    assert.strictEqual(result.music_package.costs.total, 0);
    assert.ok(result.ledger.dependencies.length > 0);
    assert.ok(result.qa_report.decision === 'APPROVE');
    if (fixture.production_tier === 'PREMIUM') assert.strictEqual(result.vocal_manifest.artifacts.length, 4);
    results.push({
      production_id: result.request.production_id,
      tier: result.request.production_tier,
      status: result.music_package.status,
      dna: result.composition_dna.length,
      compatibility_entries: result.compatibility_matrix.entries.length,
      animatics: result.song_animatics.length,
      stems: result.stem_jobs.length,
      arrangements: result.arrangement_candidates.length,
      mixes: result.mix_candidates.length,
      vocals: result.vocal_manifest.artifacts.length,
      qa: result.qa_report.decision,
      provider_submissions: result.music_package.provider_usage['mock-music'],
      cost: result.music_package.costs.total,
    });
  }
  console.log(JSON.stringify({ dry_run: true, provider: 'mock-music', results }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
