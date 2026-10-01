import { FinanceContractError, asCurrency, asIsoDate, asMinorAmount, asNonNegativeMinorAmount, asTrimmedString } from './index.js';
import { analyseCsvImport } from './csv.js';

// This adapter is deliberately transport-only. It turns the versioned delivery
// emitted by integration/ef into the same canonical CSV analysed by Finance.
// It never selects a Finance account, creates a movement, or posts the ledger.
export const EF_CAIXA_CONTRACT_VERSION = 'ef-caixa/v1';
const CANONICAL_HEADERS = Object.freeze(['Data', 'Descrição', 'Valor', 'Categoria', 'Favorecido', 'Tags', 'Observação', 'Status', 'Moeda', 'Identificador Externo']);
const REVIEW_STATUSES = /(?:cancel|estorn|refund|inconsisten|taxa_desconhecida)/i;

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const displayMinor = (value) => `${Math.floor(value / 100)},${String(value % 100).padStart(2, '0')}`;
const stableStringify = (value) => JSON.stringify(value, Object.keys(value || {}).sort());
const unitSlug = (value) => asTrimmedString(value, 'unit.slug', { max: 80 }).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function recordFingerprint(record) {
  return stableStringify({ occurredOn: record.occurredOn, occurredAt: record.occurredAt || null, clientName: record.clientName || null, paidAmountMinor: record.paidAmountMinor, paymentMethod: record.paymentMethod || null, status: record.status || null, currency: record.currency || 'BRL' });
}

function validateRecord(raw, index) {
  if (!raw || typeof raw !== 'object') throw new FinanceContractError('VALIDATION_ERROR', `records[${index}] deve ser um objeto.`);
  const occurredOn = asIsoDate(raw.occurredOn, `records[${index}].occurredOn`);
  const paidAmountMinor = asNonNegativeMinorAmount(raw.paidAmountMinor, `records[${index}].paidAmountMinor`);
  const grossAmountMinor = raw.grossAmountMinor === undefined || raw.grossAmountMinor === null ? null : asMinorAmount(raw.grossAmountMinor, `records[${index}].grossAmountMinor`);
  const clientCreditMinor = raw.clientCreditMinor === undefined || raw.clientCreditMinor === null ? 0 : Number(raw.clientCreditMinor);
  const feeAmountMinor = raw.feeAmountMinor === undefined || raw.feeAmountMinor === null ? 0 : Number(raw.feeAmountMinor);
  const installmentCount = raw.installmentCount === undefined || raw.installmentCount === null ? 1 : Number(raw.installmentCount);
  if (!Number.isSafeInteger(clientCreditMinor) || clientCreditMinor < 0 || !Number.isSafeInteger(feeAmountMinor) || feeAmountMinor < 0 || !Number.isSafeInteger(installmentCount) || installmentCount < 1 || installmentCount > 120) throw new FinanceContractError('VALIDATION_ERROR', `records[${index}] possui crédito, taxa ou parcelas inválidos.`);
  const status = asTrimmedString(raw.status || 'confirmed', `records[${index}].status`, { max: 120 });
  const paymentMethod = asTrimmedString(raw.paymentMethod || 'Não informado', `records[${index}].paymentMethod`, { max: 120 });
  const currency = asCurrency(raw.currency || 'BRL');
  const clientName = asTrimmedString(raw.clientName || 'Cliente não identificado', `records[${index}].clientName`, { max: 240 });
  const externalId = raw.externalId ? asTrimmedString(raw.externalId, `records[${index}].externalId`, { max: 240 }) : `ef-caixa:${recordFingerprint({ occurredOn, occurredAt: raw.occurredAt, clientName, paidAmountMinor, paymentMethod, status, currency })}`;
  return { occurredOn, occurredAt: raw.occurredAt ? asTrimmedString(raw.occurredAt, `records[${index}].occurredAt`, { max: 32 }) : null, paidAmountMinor, grossAmountMinor, clientCreditMinor, feeAmountMinor, installmentCount, paymentMethod, paymentMethodRaw: raw.paymentMethodRaw ? asTrimmedString(raw.paymentMethodRaw, `records[${index}].paymentMethodRaw`, { max: 240 }) : null, status, currency, clientName, externalId, refundOfExternalId: raw.refundOfExternalId ? asTrimmedString(raw.refundOfExternalId, `records[${index}].refundOfExternalId`, { max: 240 }) : null };
}

export function prepareEfCaixaImport(rawDelivery) {
  if (!rawDelivery || typeof rawDelivery !== 'object') throw new FinanceContractError('VALIDATION_ERROR', 'Entrega Caixa EF deve ser um objeto JSON.');
  if (rawDelivery.contractVersion !== EF_CAIXA_CONTRACT_VERSION) throw new FinanceContractError('VALIDATION_ERROR', `contractVersion deve ser ${EF_CAIXA_CONTRACT_VERSION}.`);
  const source = rawDelivery.source || {}; const executionId = asTrimmedString(source.executionId, 'source.executionId', { max: 240 }); const unit = rawDelivery.unit || {}; const normalizedUnitSlug = unitSlug(unit.slug || unit.name);
  const period = rawDelivery.period || {}; const from = asIsoDate(period.from, 'period.from'); const to = asIsoDate(period.to, 'period.to'); if (to < from) throw new FinanceContractError('VALIDATION_ERROR', 'period.to não pode ser anterior a period.from.');
  if (!Array.isArray(rawDelivery.records) || !rawDelivery.records.length || rawDelivery.records.length > 20_000) throw new FinanceContractError('VALIDATION_ERROR', 'records deve conter entre 1 e 20000 linhas.');
  const records = rawDelivery.records.map(validateRecord);
  const rows = records.map((record) => {
    const requiresReview = REVIEW_STATUSES.test(record.status) || record.feeAmountMinor > 0 || Boolean(record.refundOfExternalId);
    const status = requiresReview ? `review:${record.status}` : record.status;
    const category = `Receitas > Caixa EF > ${record.paymentMethod}`;
    const note = [`Origem Caixa EF`, `pagamento: ${record.paymentMethodRaw || record.paymentMethod}`, `parcelas informadas: ${record.installmentCount}`, record.grossAmountMinor ? `valor da venda: ${displayMinor(record.grossAmountMinor)}` : null, record.clientCreditMinor ? `crédito cliente: ${displayMinor(record.clientCreditMinor)}` : null, record.feeAmountMinor ? `taxa: ${displayMinor(record.feeAmountMinor)}` : null, record.refundOfExternalId ? `estorno de: ${record.refundOfExternalId}` : null].filter(Boolean).join(' | ');
    return [record.occurredOn, `Caixa EF · ${record.clientName}`, displayMinor(record.paidAmountMinor), category, record.clientName, `ef-caixa;pagamento:${record.paymentMethod}`, note, status, record.currency, record.externalId];
  });
  const csv = [CANONICAL_HEADERS, ...rows].map((row) => row.map(csvCell).join(';')).join('\n'); const mapping = { date: 'Data', description: 'Descrição', amount: 'Valor', category: 'Categoria', payee: 'Favorecido', tags: 'Tags', note: 'Observação', status: 'Status', currency: 'Moeda', externalId: 'Identificador Externo' };
  const analysis = analyseCsvImport(csv, mapping, 'utf-8'); const sourceIdentity = stableStringify({ contractVersion: rawDelivery.contractVersion, executionId, artifactSha256: source.artifactSha256 || null, unitSlug: normalizedUnitSlug, period: { from, to }, records: records.map((record) => record.externalId) });
  return { sourceType: 'ef-caixa', sourceAdapter: EF_CAIXA_CONTRACT_VERSION, unitSlug: normalizedUnitSlug, sourceIdentity, sourcePayload: rawDelivery, csv, mapping: analysis.mapping, analysis: { delimiter: analysis.delimiter, encoding: analysis.encoding, hasHeader: analysis.hasHeader, headers: analysis.headers, dateFormat: analysis.dateFormat }, metadata: { executionId, artifactId: source.artifactId || null, artifactSha256: source.artifactSha256 || null, period: { from, to }, unitSlug: normalizedUnitSlug, recordCount: records.length, limitations: ['Sem identificador nativo de venda na origem; externalId pode ser sintético.', 'Taxas e estornos exigem revisão humana.', 'Parcelas descrevem a venda, não um cronograma de liquidação.'] } };
}
