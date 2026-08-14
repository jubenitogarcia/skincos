import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflow = fs.readFileSync(path.resolve(here, '../../../.github/workflows/influencer-intelligence-staging-shadow.yml'), 'utf8');
const bootstrapScript = fs.readFileSync(path.resolve(here, '../../../platform/security/token-vault/scripts/seal-staging-analytics-credential.mjs'), 'utf8');

test('staging shadow workflow is manual, staging-only, and forbids the fallback bridge', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /run_real_router_smoke:/);
  assert.match(workflow, /default:\s*false/);
  assert.match(workflow, /environment:\s*staging/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /--env staging/);
  assert.match(workflow, /--strict/);
  assert.match(workflow, /INFLUENCER_INTELLIGENCE_ANALYTICS_MODE/);
  assert.match(workflow, /TOKEN_VAULT_ANALYTICS_API_TOKEN/);
  assert.match(workflow, /candidate_active_after_validation/);
  assert.match(workflow, /versions\.length\s*!==\s*1/);
  assert.match(workflow, /Number\(versions\[0\]\?\.percentage\)\s*!==\s*100/);
  assert.equal(
    (workflow.match(/shared_secret:\s*\$\{\{\s*secrets\.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY\s*\}\}/g) || []).length,
    3,
    'all staging shadow lease operations must use the active coordinator key',
  );
  assert.doesNotMatch(workflow, /secrets\.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET/);
  assert.match(workflow, /name:\s*Guard private real-read inputs/);
  assert.match(workflow, /if:\s*\$\{\{\s*inputs\.run_real_router_smoke\s*==\s*true\s*\}\}/);
  assert.match(workflow, /INFLUENCER_INTELLIGENCE_META_GRAPH_TOKEN/);
  assert.match(workflow, /INFLUENCER_INTELLIGENCE_META_GRAPH_INSTAGRAM_ACCOUNT_ID/);
  assert.match(workflow, /TOKEN_VAULT_STAGING_ANALYTICS_BOOTSTRAP_TOKEN/);
  assert.match(workflow, /scripts\/seal-staging-analytics-credential\.mjs/);
  assert.match(bootstrapScript, /\/v1\/analytics\/staging-bootstrap/);
  assert.match(bootstrapScript, /readFileSync\(0, 'utf8'\)/);
  assert.doesNotMatch(workflow, /INFLUENCER_INTELLIGENCE_SHADOW_CREDENTIAL_REF:\s*\$\{\{\s*secrets\./);
  assert.match(workflow, /name:\s*Remove workflow-only analytics credential/);
  assert.doesNotMatch(workflow, /instagrapi/i);
  assert.doesNotMatch(workflow, /TOKEN_VAULT_API_TOKEN:\s*\$\{\{\s*secrets\./);

  const promoteStep = workflow.match(/- name: Promote bounded staging shadow and validate its contract([\s\S]*?)(?=\n\s*- name: Seal one staging-only Meta analytics credential)/)?.[1] || '';
  assert.notEqual(promoteStep, '');
  assert.doesNotMatch(promoteStep, /INFLUENCER_INTELLIGENCE_(META_GRAPH_TOKEN|META_GRAPH_INSTAGRAM_ACCOUNT_ID|SHADOW_CREATOR_HANDLE)/);
});

test('staging shadow workflow shell blocks remain parseable, including nested heredocs', () => {
  const lines = workflow.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== '        run: |') continue;
    const block = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.length > 0 && !line.startsWith('          ')) {
        index -= 1;
        break;
      }
      block.push(line.startsWith('          ') ? line.slice(10) : line);
    }
    blocks.push(block.join('\n'));
  }

  assert.ok(blocks.length >= 5);
  for (const [index, block] of blocks.entries()) {
    const parsed = spawnSync('bash', ['-n'], { input: block, encoding: 'utf8' });
    assert.equal(parsed.status, 0, `workflow shell block ${index + 1} is invalid: ${parsed.stderr}`);
  }
});
