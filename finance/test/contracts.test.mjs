import assert from 'node:assert/strict';
import test from 'node:test';
import { asCurrency, asIsoDate, asMinorAmount, FinanceContractError } from '../../shared/finance-contracts/index.js';

test('finance monetary contract accepts integer minor units only', () => {
  assert.equal(asMinorAmount(1250), 1250);
  assert.throws(() => asMinorAmount(12.5), FinanceContractError);
  assert.throws(() => asMinorAmount(0), FinanceContractError);
});

test('finance dates and currencies are normalized at the boundary', () => {
  assert.equal(asCurrency('brl'), 'BRL');
  assert.equal(asIsoDate('2026-07-21', 'competenceDate'), '2026-07-21');
  assert.throws(() => asCurrency('REAL'), FinanceContractError);
  assert.throws(() => asIsoDate('21/07/2026', 'competenceDate'), FinanceContractError);
});
