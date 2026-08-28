import assert from 'node:assert/strict';
import test from 'node:test';

import * as contracts from '../src/index.js';

test('aggregate public API exposes the portable contracts', () => {
  assert.equal(contracts.IDENTITY_ACTOR_CONTRACT_VERSION, 'identity-actor/v1');
  assert.equal(contracts.FINANCE_CONTRACT_VERSION, 'finance/v1');
  assert.equal(contracts.OBSERVABILITY_CONTRACT_VERSION, 'skincos-observability/v1');
  assert.equal(typeof contracts.normalizeAllowedUnits, 'function');
  assert.equal(typeof contracts.prepareMoneyWizImport, 'function');
  assert.equal(typeof contracts.readModuleAvailability, 'function');
});

test('identity and finance contracts retain their dependency-free behavior', () => {
  assert.deepEqual(
    contracts.normalizeAllowedUnits(['NH', 'barra shopping sul', 'unknown']),
    ['novo-hamburgo', 'barra-shopping-sul'],
  );
  assert.equal(contracts.asMinorAmount(1_250), 1_250);
  assert.equal(contracts.canaryBucket('contract-test'), contracts.canaryBucket('contract-test'));
});

test('every declared contract entrypoint resolves from the package source', async () => {
  const entries = [
    '../src/identity-contract.js',
    '../src/finance/index.js',
    '../src/finance/csv.js',
    '../src/finance/moneywiz.js',
    '../src/finance/ef-caixa.js',
    '../src/module-availability.js',
    '../src/observability.js',
  ];

  for (const entry of entries) {
    const imported = await import(entry);
    assert.ok(Object.keys(imported).length > 0, 'entrypoint must export a contract');
  }
});
