import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareEfCaixaImport } from '../../shared/finance-contracts/ef-caixa.js';
import { analyseCsvImport, normalizeImportRow } from '../../shared/finance-contracts/csv.js';

test('Caixa EF delivery becomes generic staging CSV without selecting accounts or posting the ledger', async () => {
  const delivery = JSON.parse(await readFile(new URL('./fixtures/ef-caixa-delivery-nh.json', import.meta.url), 'utf8')); const prepared = prepareEfCaixaImport(delivery); const rows = analyseCsvImport(prepared.csv, prepared.mapping).rows;
  const installment = normalizeImportRow(rows[0], prepared.mapping, prepared.analysis.dateFormat); const cancelled = normalizeImportRow(rows[1], prepared.mapping, prepared.analysis.dateFormat);
  assert.equal(prepared.sourceType, 'ef-caixa'); assert.equal(prepared.sourceAdapter, 'ef-caixa/v1'); assert.equal(prepared.unitSlug, 'novo-hamburgo'); assert.equal(installment.amountMinor, 60000); assert.match(installment.note, /parcelas informadas: 2/); assert.equal(installment.accountName, null); assert.match(cancelled.sourceStatus, /^review:/); assert.equal(prepared.metadata.executionId, 'ef-run-20260731-nh');
});

test('Caixa EF rejects malformed currency, period and unsupported personal unit mapping', () => {
  const valid = { contractVersion: 'ef-caixa/v1', source: { executionId: 'run' }, unit: { slug: 'novo-hamburgo' }, period: { from: '2026-07-01', to: '2026-07-02' }, records: [{ occurredOn: '2026-07-01', paidAmountMinor: 100, paymentMethod: 'PIX', status: 'Confirmado', currency: 'BRL' }] };
  assert.throws(() => prepareEfCaixaImport({ ...valid, period: { from: '2026-07-02', to: '2026-07-01' } })); assert.throws(() => prepareEfCaixaImport({ ...valid, records: [{ ...valid.records[0], currency: 'BR' }] }));
});
