#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { definitions } = require('../music-composition-studio/lib/schema-definitions');
const { baseRequest } = require('../music-composition-studio/pipeline');
const out = path.join(__dirname, '..', 'music-composition-studio', 'fixtures');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'schema-fixtures.json'), `${JSON.stringify(Object.fromEntries(Object.entries(definitions).map(([name, schema]) => [name, { valid: schema.examples[0], invalid: schema['x-invalid-examples'][0] }])), null, 2)}\n`);
const fast = baseRequest({ production_id: 'MSC-FIXTURE-FAST' });
const standard = baseRequest({ production_id: 'MSC-FIXTURE-STANDARD', production_tier: 'STANDARD', brief: { ...fast.brief, duration_target_seconds: 75 } });
const premium = baseRequest({ production_id: 'MSC-FIXTURE-PREMIUM', production_tier: 'PREMIUM', brief: { ...fast.brief, duration_target_seconds: 120, voice_requested: true }, voice_consent: { status: 'GRANTED', voice_id: 'synthetic-fixture-voice' } });
for (const [name, value] of Object.entries({ fast, standard, premium })) fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
console.log('Music Composition Studio fixtures: OK (3 tiers + schema valid/invalid pairs)');
