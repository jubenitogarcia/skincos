import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8');

test('staging Finance API smokes use the authenticated Pages transport', async () => {
  const [canary, importer, remoteFinanceModule, financeViteConfig] = await Promise.all([
    read('staging-synthetic-canary.mjs'),
    read('staging-import-smoke.mjs'),
    readFile(new URL('../../crm/console/modules/RemoteFinanceModule.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../crm/console/vite.finance.config.ts', import.meta.url), 'utf8'),
  ]);

  for (const source of [canary, importer]) {
    assert.match(source, /https:\/\/skincos-staging\.pages\.dev/);
    assert.match(source, /\/api\/auth\/login/);
    assert.match(source, /\/api\/finance/);
    assert.match(source, /JSON\.stringify\(\{ email: username, password \}\)/);
    assert.doesNotMatch(source, /JSON\.stringify\(\{ username, password \}\)/);
    assert.doesNotMatch(source, /api-staging\.skincos\.com\.br/);
  }

  assert.match(canary, /const password = requiredSecret\('FINANCE_CANARY_PASSWORD'\)/);
  assert.match(importer, /const password = requiredSecret\('FINANCE_SMOKE_PASSWORD'\)/);
  assert.match(canary, /String\(process\.env\[name\] \?\? ''\)/);
  assert.match(importer, /String\(process\.env\[name\] \?\? ''\)/);
  assert.match(importer, /const analyzePayload = \{[\s\S]*mapping: loaded\.batch\?\.mapping \|\| stagedBody\.analysis\?\.mapping \|\| \{\}/);
  assert.match(importer, /retryTransientRequest\(`\$\{financePath\(`\/imports\/\$\{encodeURIComponent\(batchId\)\}\/analyze`\)\}/);
  assert.match(importer, /response\.status < 500 \|\| attempt === attempts/);
  assert.match(importer, /body: JSON\.stringify\(analyzePayload\)/);
  assert.match(importer, /analysisBody\?\.ok !== true/);
  assert.doesNotMatch(importer, /analysisBody\.analysis\?\.rows/);
  assert.match(importer, /loaded\.batch\?\.undone_at/);
  assert.match(importer, /financePath\(`\/movements\/\$\{encodeURIComponent\(movementId\)\}`\)/);
  assert.match(importer, /movement\.operationalStatus !== 'cancelled'/);
  assert.match(importer, /Number\(undoBody\.undone \|\| 0\) !== movementIds\.length/);
  assert.doesNotMatch(importer, /loaded\.batch\?\.status !== 'undone'/);
  assert.match(remoteFinanceModule, /data-finance-remote-error/);
  assert.match(remoteFinanceModule, /remoteFailureKind\(cause\)/);
  assert.match(financeViteConfig, /'process\.env\.NODE_ENV': '\"production\"'/);
});
