#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { baseRequest, run } = require('../content-studio-v2/dry-run');
const cases = [
  ['fast-static', {}],
  ['standard-video', { content_type: 'SHORT_VIDEO', production_tier: 'STANDARD', production_id: 'dryrun-standard' }],
  ['premium-hybrid', { content_type: 'HYBRID', production_tier: 'PREMIUM', production_id: 'dryrun-premium' }],
  ['price-conflict', { production_id: 'dryrun-conflict' }, { conflict: true }],
  ['claim-without-source', { production_id: 'dryrun-claim' }, { blocking: true }],
  ['provider-fallback', { content_type: 'SHORT_VIDEO', production_id: 'dryrun-provider-fallback' }],
  ['cta-revision', { production_id: 'dryrun-cta', cta: 'Agende uma avaliação' }],
  ['resume', { production_id: 'dryrun-resume' }],
];
(async () => { const root = path.join(process.cwd(), 'output', 'ccg-dry-run'); const results = []; for (const [name, overrides, options] of cases) { const result = await run(baseRequest(overrides), { ...options, outputDir: path.join(root, name) }); fs.writeFileSync(path.join(root, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`); results.push({ name, status: result.content_package.status }); } console.log(JSON.stringify({ dry_run: true, paid_calls: 0, cases: results }, null, 2)); })().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
