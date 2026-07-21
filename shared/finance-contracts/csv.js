import { FinanceContractError, asCurrency, asIsoDate, asTrimmedString } from './index.js';

export const FINANCE_IMPORT_FIELDS = Object.freeze(['date', 'description', 'amount', 'income', 'expense', 'type', 'account', 'category', 'payee', 'currency', 'note', 'externalId']);

const aliases = Object.freeze({
  date: ['data', 'date', 'competencia', 'competência', 'vencimento'],
  description: ['descricao', 'descrição', 'description', 'historico', 'histórico', 'memo'],
  amount: ['valor', 'amount', 'montante'], income: ['entrada', 'receita', 'credit', 'credito', 'crédito'], expense: ['saida', 'saída', 'despesa', 'debit', 'debito', 'débito'],
  type: ['tipo', 'type', 'natureza'], account: ['conta', 'account'], category: ['categoria', 'category'], payee: ['favorecido', 'beneficiario', 'beneficiário', 'payee'],
  currency: ['moeda', 'currency'], note: ['observacao', 'observação', 'nota', 'note'], externalId: ['id externo', 'identificador externo', 'external id', 'external_id', 'id'],
});

export function importNameKey(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' '); }

export function detectCsvDelimiter(content) {
  const line = String(content || '').split(/\r?\n/).find((value) => value.trim()) || '';
  const counts = [',', ';', '\t'].map((delimiter) => ({ delimiter, count: parseCsvLine(line, delimiter).length - 1 }));
  return counts.sort((a, b) => b.count - a.count)[0]?.count > 0 ? counts.sort((a, b) => b.count - a.count)[0].delimiter : ',';
}

function parseCsvLine(line, delimiter) {
  const values = []; let field = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') { if (quoted && line[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { values.push(field); field = ''; }
    else field += char;
  }
  if (quoted) throw new FinanceContractError('VALIDATION_ERROR', 'CSV possui aspas não fechadas.');
  values.push(field); return values;
}

export function parseCsv(content, delimiter = detectCsvDelimiter(content)) {
  const rows = []; let row = []; let field = ''; let quoted = false; const value = String(content || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') { if (quoted && value[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && value[index + 1] === '\n') index += 1; row.push(field); if (row.some((cell) => cell.trim())) rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new FinanceContractError('VALIDATION_ERROR', 'CSV possui aspas não fechadas.');
  row.push(field); if (row.some((cell) => cell.trim())) rows.push(row);
  if (!rows.length) throw new FinanceContractError('VALIDATION_ERROR', 'CSV está vazio.');
  return rows;
}

export function inferImportMapping(headers) {
  const normalized = headers.map(importNameKey); const mapping = {};
  for (const field of FINANCE_IMPORT_FIELDS) { const found = aliases[field]?.find((alias) => normalized.includes(alias)); if (found) mapping[field] = headers[normalized.indexOf(found)]; }
  return mapping;
}

export function detectDateFormat(values) {
  const samples = values.filter(Boolean).map((value) => String(value).trim()).slice(0, 100);
  if (samples.some((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))) return 'YYYY-MM-DD';
  if (samples.some((value) => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value))) return 'DD/MM/YYYY';
  return 'unknown';
}

export function toIsoImportDate(value, dateFormat = 'unknown') {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return asIsoDate(raw, 'data');
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) throw new FinanceContractError('VALIDATION_ERROR', 'data deve usar YYYY-MM-DD ou DD/MM/AAAA.');
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]; const iso = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return asIsoDate(iso, 'data');
}

export function decimalToMinorUnits(value, field = 'valor') {
  let raw = String(value ?? '').trim().replace(/\s/g, '').replace(/^(R\$|US\$|€)/i, '');
  if (!raw) throw new FinanceContractError('VALIDATION_ERROR', `${field} é obrigatório.`);
  const sign = raw.startsWith('-') ? -1 : 1; raw = raw.replace(/^[+-]/, '');
  const comma = raw.lastIndexOf(','); const dot = raw.lastIndexOf('.'); const decimal = comma > dot ? ',' : dot > comma ? '.' : '';
  if (decimal) {
    const fractionLength = raw.length - raw.lastIndexOf(decimal) - 1;
    if (fractionLength > 2) throw new FinanceContractError('VALIDATION_ERROR', `${field} possui mais de duas casas decimais.`);
    const parts = raw.split(decimal); raw = `${parts.slice(0, -1).join('').replace(/[.,]/g, '')}.${parts.at(-1)}`;
  } else raw = raw.replace(/[.,]/g, '');
  const match = raw.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new FinanceContractError('VALIDATION_ERROR', `${field} não é um valor monetário válido.`);
  const minor = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor === 0) throw new FinanceContractError('VALIDATION_ERROR', `${field} deve ser diferente de zero.`);
  return { sign, amountMinor: minor };
}

export function analyseCsvImport(content, suppliedMapping = {}, encoding = 'utf-8') {
  const delimiter = detectCsvDelimiter(content); const matrix = parseCsv(content, delimiter); const headers = matrix[0];
  if (matrix.length < 2) throw new FinanceContractError('VALIDATION_ERROR', 'CSV precisa de cabeçalho e ao menos uma linha.');
  const mapping = { ...inferImportMapping(headers), ...(suppliedMapping || {}) };
  const dateColumn = mapping.date; const dateFormat = detectDateFormat(dateColumn ? matrix.slice(1).map((row) => row[headers.indexOf(dateColumn)]) : []);
  return { delimiter, encoding, hasHeader: true, headers, mapping, dateFormat, rows: matrix.slice(1).map((values, index) => Object.fromEntries(headers.map((header, column) => [importNameKey(header), values[column] || '']).concat([['__row', index + 2]]))) };
}

export function normalizeImportRow(raw, mapping = {}, dateFormat = 'unknown') {
  const pick = (field) => { const mapped = mapping[field]; if (mapped && raw[importNameKey(mapped)] !== undefined) return raw[importNameKey(mapped)]; return aliases[field]?.map((alias) => raw[alias]).find((candidate) => candidate !== undefined); };
  const description = asTrimmedString(pick('description'), 'descrição'); const competenceDate = toIsoImportDate(pick('date'), dateFormat);
  const income = pick('income'); const expense = pick('expense'); const amount = pick('amount');
  let monetary; let type;
  if (String(income || '').trim() || String(expense || '').trim()) { if (String(income || '').trim() && String(expense || '').trim()) throw new FinanceContractError('VALIDATION_ERROR', 'Linha possui entrada e saída ao mesmo tempo.'); monetary = decimalToMinorUnits(String(income || expense), income ? 'entrada' : 'saída'); type = income ? 'income' : 'expense'; }
  else { monetary = decimalToMinorUnits(amount); const typeText = importNameKey(pick('type')); type = typeText ? ({ receita: 'income', income: 'income', entrada: 'income', despesa: 'expense', expense: 'expense', saida: 'expense', saída: 'expense' }[typeText]) : (monetary.sign < 0 ? 'expense' : 'income'); }
  if (!type) throw new FinanceContractError('VALIDATION_ERROR', 'tipo deve ser receita ou despesa.');
  const currencyValue = pick('currency'); const currency = currencyValue ? asCurrency(currencyValue) : 'BRL';
  return { description, competenceDate, paidDate: competenceDate, type, amountMinor: monetary.amountMinor, currency, accountName: String(pick('account') || '').trim() || null, categoryName: String(pick('category') || '').trim() || null, payeeName: String(pick('payee') || '').trim() || null, note: String(pick('note') || '').trim() || null, externalId: String(pick('externalId') || '').trim() || null };
}
