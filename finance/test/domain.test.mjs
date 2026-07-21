import assert from 'node:assert/strict';
import test from 'node:test';
import { FinanceContractError } from '../../shared/finance-contracts/index.js';
import { buildPostedJournal } from '../domain.js';

test('income and expense use distinct financial and category ledger accounts', () => {
  assert.deepEqual(buildPostedJournal({ type: 'income', amountMinor: 1250, sourceLedgerId: 'bank', categoryLedgerId: 'revenue' }), [
    { direction: 'debit', ledgerAccountId: 'bank', amountMinor: 1250 },
    { direction: 'credit', ledgerAccountId: 'revenue', amountMinor: 1250 },
  ]);
  assert.deepEqual(buildPostedJournal({ type: 'expense', amountMinor: 1250, sourceLedgerId: 'bank', categoryLedgerId: 'rent' }), [
    { direction: 'debit', ledgerAccountId: 'rent', amountMinor: 1250 },
    { direction: 'credit', ledgerAccountId: 'bank', amountMinor: 1250 },
  ]);
});

test('transfer requires two different ledger accounts and every entry balances', () => {
  const lines = buildPostedJournal({ type: 'transfer', amountMinor: 3500, sourceLedgerId: 'cash', destinationLedgerId: 'bank' });
  assert.equal(lines.filter((line) => line.direction === 'debit').reduce((sum, line) => sum + line.amountMinor, 0), 3500);
  assert.equal(lines.filter((line) => line.direction === 'credit').reduce((sum, line) => sum + line.amountMinor, 0), 3500);
  assert.throws(() => buildPostedJournal({ type: 'transfer', amountMinor: 1, sourceLedgerId: 'bank', destinationLedgerId: 'bank' }), FinanceContractError);
});
