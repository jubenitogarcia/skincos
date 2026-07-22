import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyseCsvImport, decimalToMinorUnits, normalizeImportRow } from '../../shared/finance-contracts/csv.js';

test('analisa CSV brasileiro UTF-8 com ponto e vírgula, acentos e duplicidade preservável', async () => {
  const csv = await readFile(new URL('./fixtures/extrato-br-duplicados.csv', import.meta.url), 'utf8');
  const analysis = analyseCsvImport(csv);
  assert.equal(analysis.delimiter, ';'); assert.equal(analysis.dateFormat, 'DD/MM/YYYY'); assert.equal(analysis.rows.length, 3);
  const first = normalizeImportRow(analysis.rows[0], analysis.mapping, analysis.dateFormat);
  assert.deepEqual(first, { description: 'Consulta estética', competenceDate: '2026-07-01', paidDate: '2026-07-01', type: 'income', amountMinor: 125050, currency: 'BRL', accountName: 'Banco NH', categoryName: 'Receitas', categoryPath: 'Receitas', payeeName: 'Paciente João', tagNames: [], note: 'Pagamento cartão', sourceStatus: null, transferAccountName: null, externalId: 'ef-1001' });
});

test('converte valores monetários brasileiros sem ponto flutuante', () => {
  assert.deepEqual(decimalToMinorUnits('1.250,50'), { sign: 1, amountMinor: 125050 });
  assert.deepEqual(decimalToMinorUnits('-3.500,00'), { sign: -1, amountMinor: 350000 });
});

test('aceita colunas separadas de entrada e saída sem inferir receita como transferência', () => {
  const income = normalizeImportRow({ data: '03/07/2026', descricao: 'Recebimento', entrada: '10,00', saída: '' }, { date: 'data', description: 'descricao', income: 'entrada', expense: 'saída' }, 'DD/MM/YYYY');
  const expense = normalizeImportRow({ data: '03/07/2026', descricao: 'Fornecedor', entrada: '', saída: '10,00' }, { date: 'data', description: 'descricao', income: 'entrada', expense: 'saída' }, 'DD/MM/YYYY');
  assert.equal(income.type, 'income'); assert.equal(expense.type, 'expense'); assert.equal(income.amountMinor, 1000); assert.equal(expense.amountMinor, 1000);
});
