import { FinanceContractError } from './index.js';
import { analyseCsvImport, importNameKey } from './csv.js';

// MoneyWiz has configurable CSV exports. This adapter only recognizes the
// documented transaction/report vocabulary and returns a generic staging
// contract; it never assigns a ledger account or posts a movement.
const MONEYWIZ_HEADERS = Object.freeze({
  date: ['date', 'data'], description: ['description', 'descrição', 'descricao'], amount: ['amount', 'valor'],
  income: ['credits', 'credit', 'income', 'receitas', 'entrada'], expense: ['debits', 'debit', 'expenses', 'despesas', 'saída', 'saida'],
  account: ['account', 'conta'], category: ['category', 'categoria'], payee: ['payee', 'favorecido'], tags: ['tags', 'tag'],
  note: ['memo', 'note', 'observação', 'observacao'], status: ['status'], currency: ['currency', 'moeda'],
  transferAccount: ['transfers', 'transfer', 'transfer account', 'conta destino'], externalId: ['transaction id', 'transaction_id', 'external id', 'id', 'check #'],
});

function mappingFor(headers) {
  const keys = headers.map(importNameKey); const mapping = {};
  for (const [field, names] of Object.entries(MONEYWIZ_HEADERS)) { const index = names.map(importNameKey).map((name) => keys.indexOf(name)).find((value) => value >= 0); if (index !== undefined && index >= 0) mapping[field] = headers[index]; }
  return mapping;
}

export function prepareMoneyWizImport(content, encoding = 'utf-8') {
  const probe = analyseCsvImport(content, {}, encoding); const mapping = mappingFor(probe.headers);
  if (!mapping.date || !mapping.description || (!mapping.amount && !mapping.income && !mapping.expense)) throw new FinanceContractError('VALIDATION_ERROR', 'Exportação MoneyWiz requer Date, Description e Amount ou Credits/Debits.');
  const analysis = analyseCsvImport(content, mapping, encoding);
  return { sourceType: 'moneywiz', mapping: analysis.mapping, analysis: { delimiter: analysis.delimiter, encoding: analysis.encoding, hasHeader: analysis.hasHeader, headers: analysis.headers, dateFormat: analysis.dateFormat }, capabilities: { accounts: Boolean(mapping.account), categories: Boolean(mapping.category), payees: Boolean(mapping.payee), tags: Boolean(mapping.tags), notes: Boolean(mapping.note), status: Boolean(mapping.status), currencies: Boolean(mapping.currency), transfers: Boolean(mapping.transferAccount), externalIds: Boolean(mapping.externalId) } };
}
