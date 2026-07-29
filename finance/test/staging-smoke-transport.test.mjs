import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8');

test('staging Finance API smokes use the authenticated Pages transport', async () => {
  const [canary, importer] = await Promise.all([
    read('staging-synthetic-canary.mjs'),
    read('staging-import-smoke.mjs'),
  ]);

  for (const source of [canary, importer]) {
    assert.match(source, /https:\/\/skincos-staging\.pages\.dev/);
    assert.match(source, /\/api\/auth\/login/);
    assert.match(source, /\/api\/finance/);
    assert.doesNotMatch(source, /api-staging\.skincos\.com\.br/);
  }
});
