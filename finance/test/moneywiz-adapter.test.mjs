import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareMoneyWizImport } from '../../shared/finance-contracts/moneywiz.js';
import { analyseCsvImport, normalizeImportRow } from '../../shared/finance-contracts/csv.js';

test('MoneyWiz adapter normalizes documented transaction CSV columns without posting to the ledger', async () => {
  const csv = await readFile(new URL('./fixtures/moneywiz-transactions-comma.csv', import.meta.url), 'utf8'); const prepared = prepareMoneyWizImport(csv);
  assert.equal(prepared.sourceType, 'moneywiz'); assert.equal(prepared.analysis.delimiter, ','); assert.equal(prepared.capabilities.transfers, true); assert.equal(prepared.capabilities.tags, true);
  const rows = analyseCsvImport(csv, prepared.mapping).rows; const income = normalizeImportRow(rows[0], prepared.mapping, prepared.analysis.dateFormat); const transfer = normalizeImportRow(rows[2], prepared.mapping, prepared.analysis.dateFormat); const incomplete = (() => { try { return normalizeImportRow(rows[5], prepared.mapping, prepared.analysis.dateFormat) } catch (error) { return error.code } })();
  assert.equal(income.categoryPath, 'Receitas > Procedimentos'); assert.deepEqual(income.tagNames, ['clínica', 'recorrente']); assert.equal(income.externalId, 'mw-1001'); assert.equal(transfer.type, 'expense'); assert.equal(transfer.transferAccountName, 'Cartão Corporativo'); assert.equal(incomplete, 'VALIDATION_ERROR'); assert.equal(normalizeImportRow(rows[6], prepared.mapping, prepared.analysis.dateFormat).externalId, income.externalId);
});

test('MoneyWiz adapter supports separate credits/debits and semicolon decimal-comma exports', async () => {
  const csv = await readFile(new URL('./fixtures/moneywiz-transactions-semicolon.csv', import.meta.url), 'utf8'); const prepared = prepareMoneyWizImport(csv); const rows = analyseCsvImport(csv, prepared.mapping).rows;
  const income = normalizeImportRow(rows[0], prepared.mapping, prepared.analysis.dateFormat); const expense = normalizeImportRow(rows[1], prepared.mapping, prepared.analysis.dateFormat);
  assert.equal(prepared.analysis.delimiter, ';'); assert.equal(income.type, 'income'); assert.equal(income.amountMinor, 10000); assert.equal(expense.type, 'expense'); assert.equal(expense.amountMinor, 7525);
});
