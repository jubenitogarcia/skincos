import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/write-local-fixture.mjs', import.meta.url));
const launcher = fileURLToPath(new URL('../../scripts/run-local-finance.sh', import.meta.url));

async function fixture(scenario, actor = undefined) {
  const directory = await mkdtemp(join(tmpdir(), 'skincos-finance-fixture-'));
  const output = join(directory, `${scenario}.sql`);
  try {
    return await new Promise((resolve, reject) => {
      const args = [script, '--scenario', scenario, '--output', output]
      if (actor) args.push('--actor', actor)
      execFile(process.execPath, args, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(JSON.parse(stdout));
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('local Finance fixture exposes only the intended module and business scopes', async () => {
  const disabled = await fixture('disabled');
  assert.equal(disabled.moduleEnabled, false);
  assert.deepEqual(disabled.allowedModules, ['finance']);

  const noModule = await fixture('no-module');
  assert.equal(noModule.moduleEnabled, true);
  assert.deepEqual(noModule.allowedModules, []);

  const noGrant = await fixture('no-grant');
  assert.deepEqual(noGrant.grantedScopes, []);

  const nh = await fixture('nh');
  assert.deepEqual(nh.allowedUnits, ['novo-hamburgo']);
  assert.deepEqual(nh.grantedScopes, ['finance-scope-novo-hamburgo']);

  const bss = await fixture('bss');
  assert.deepEqual(bss.allowedUnits, ['barra-shopping-sul']);
  assert.deepEqual(bss.grantedScopes, ['finance-scope-barra-shopping-sul']);

  const both = await fixture('both');
  assert.deepEqual(both.allowedUnits, ['novo-hamburgo', 'barra-shopping-sul']);
  assert.equal(both.personalScopeGranted, false);
  assert.equal(both.grantedScopes.includes('finance-scope-personal'), false);
});

test('local Finance fixture supports an isolated, bounded smoke actor', async () => {
  const actor = 'finance-local-1721650000-12345';
  const both = await fixture('both', actor);
  assert.equal(both.username, actor);
  assert.equal(both.personalScopeGranted, false);
});

test('local Finance launcher preserves the module grant when exercising only the disabled flag', async () => {
  const source = await readFile(launcher, 'utf8');
  assert.match(source, /no-module\) LOCAL_MODULES='' ;;/);
  assert.doesNotMatch(source, /disabled\|no-module\) LOCAL_MODULES='' ;;/);
  assert.match(source, /curl -sS --connect-timeout 1 --max-time 1/);
});
