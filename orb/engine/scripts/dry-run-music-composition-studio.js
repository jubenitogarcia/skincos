#!/usr/bin/env node
const { baseRequest, runProduction } = require('../music-composition-studio/pipeline');
(async () => {
  const fixtures = [baseRequest({ production_id: 'MSC-DRY-FAST', production_tier: 'FAST' }), baseRequest({ production_id: 'MSC-DRY-STANDARD', production_tier: 'STANDARD', brief: { ...baseRequest().brief, duration_target_seconds: 75 } }), baseRequest({ production_id: 'MSC-DRY-PREMIUM', production_tier: 'PREMIUM', brief: { ...baseRequest().brief, duration_target_seconds: 120, voice_requested: true }, voice_consent: { status: 'GRANTED', voice_id: 'synthetic-fixture-voice' } })];
  const results = []; for (const fixture of fixtures) { const result = await runProduction(fixture); results.push({ production_id: result.request.production_id, tier: result.request.production_tier, status: result.music_package.status, dna: result.composition_dna.length, stems: result.stem_jobs.length }); }
  console.log(JSON.stringify({ dry_run: true, provider: 'mock-music', results }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
