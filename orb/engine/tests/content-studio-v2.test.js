#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { baseRequest, run } = require('../content-studio-v2/dry-run');
const { validate, lockHash } = require('../content-studio-v2/lib/contracts');
const { sha256 } = require('../content-studio-v2/lib/canonical');
const { MemoryLedger } = require('../content-studio-v2/lib/ledger');
const { MockProvider, HttpProvider } = require('../content-studio-v2/lib/providers');
const { invalidationPlan } = require('../content-studio-v2/lib/invalidation');
const { renderStill } = require('../services/renderer');
const { evaluateQa } = require('../content-studio-v2/lib/qa');
const { migrateCampaignBrief } = require('../content-studio-v2/lib/migration');
const { enforceBudget, pollWithBackoff } = require('../content-studio-v2/lib/jobs');
const Ajv = require('ajv');

async function main() {
  const request = baseRequest(); validate('productionRequest', request); assert.throws(() => validate('productionRequest', { ...request, production_id: undefined }), /production_id/);
  const ajv = new Ajv({ allErrors: true, strict: false }); const schemaDir = path.join(__dirname, '..', 'content-studio-v2', 'schemas'); for (const file of fs.readdirSync(schemaDir).filter((item) => item.endsWith('.schema.json'))) { const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8')); const check = ajv.compile(schema); assert.ok(check(schema.examples[0]), `${file} valid example must validate`); assert.ok(!check(schema['x-invalid-examples'][0]), `${file} invalid example must fail`); }
  assert.strictEqual(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 })); assert.notStrictEqual(lockHash({ a: 'x' }), lockHash({ a: 'y' }));
  const ledger = new MemoryLedger(); ledger.beginProduction(request); const first = ledger.upsertJob({ production_id: request.production_id, module: 'CCG-40', component_id: 'x', revision: 1, input_hash: 'same', status: 'DONE', artifact_checksum: 'checksum' }); const reused = ledger.upsertJob({ production_id: request.production_id, module: 'CCG-40', component_id: 'x', revision: 1, input_hash: 'same', status: 'PENDING' }); assert.strictEqual(reused.reused, true); assert.strictEqual(ledger.findReusable('same').job_key, first.job_key);
  const mock = new MockProvider(); const mockJob = await mock.submit({ dry_run: true, provider_policy: { mode: 'mock' } }); assert.strictEqual(mockJob.status, 'COMPLETED'); await assert.rejects(() => new HttpProvider({}).submit({ dry_run: true }), /blocked/);
  assert.deepStrictEqual(invalidationPlan('cta'), ['overlays', 'content_package']); assert.ok(invalidationPlan('claim').includes('audio_manifest'));
  assert.strictEqual(evaluateQa([{ code: 'COMPOSITION', status: 'NEEDS_REVIEW' }]).status, 'NEEDS_REVIEW'); assert.strictEqual(evaluateQa([{ code: 'PRICE_UNEVIDENCED', status: 'NEEDS_REVIEW' }]).status, 'FAIL');
  assert.ok(migrateCampaignBrief({ concept: 'fixture', offers: [], mandatory_claims: ['claim'] }).scientific_claims[0].claim_id);
  assert.throws(() => enforceBudget({ estimatedCost: 1, budget: { max_cost: 0 } }), /budget_exceeded/); const polled = await pollWithBackoff({ requestId: 'x', status: async () => ({ status: 'COMPLETED' }), sleep: async () => {} }); assert.strictEqual(polled.status, 'COMPLETED');
  const rendered = renderStill({ outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-render-')), deliverableId: 'test', overlays: [{ text: 'CTA' }] }); assert.ok(fs.existsSync(rendered.path)); assert.strictEqual(rendered.mime_type, 'image/svg+xml');
  const pass = await run(request); assert.strictEqual(pass.content_package.status, 'READY_TO_PUBLISH'); assert.strictEqual(pass.content_package.posting_payload.publish_requested, false);
  const review = await run(baseRequest({ production_id: 'review' }), { conflict: true }); assert.strictEqual(review.content_package.status, 'NEEDS_REVIEW');
  const failed = await run(baseRequest({ production_id: 'failed' }), { blocking: true }); assert.strictEqual(failed.content_package.status, 'FAILED'); assert.ok(failed.qa_report.blocking_issues.length);
  const video = await run(baseRequest({ production_id: 'video', content_type: 'SHORT_VIDEO', production_tier: 'STANDARD' })); assert.strictEqual(video.content_package.deliverables[0].technical_metadata.artifact_kind, 'deterministic_video_fixture');
  console.log('Content Studio v2 tests: OK');
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
