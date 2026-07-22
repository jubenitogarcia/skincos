/**
 * Stable, dependency-free transport contract for the Finance domain. It is
 * deliberately consumable by both Workers and browser bundles.
 */
export const FINANCE_CONTRACT_VERSION = 'finance/v1';
export const FINANCE_MODULE_KEY = 'finance';
export const FINANCE_SCOPE_KINDS = Object.freeze(['unit', 'personal']);
export const FINANCE_ACCOUNT_TYPES = Object.freeze(['cash', 'bank', 'card', 'clearing']);
export const FINANCE_MOVEMENT_TYPES = Object.freeze(['income', 'expense', 'transfer']);
// `status` is the immutable ledger lifecycle; `operationalStatus` is the
// intentionally simpler state exposed by the operational UI.
export const FINANCE_MOVEMENT_STATUSES = Object.freeze(['draft', 'posted', 'cancelled']);
export const FINANCE_OPERATIONAL_STATUSES = Object.freeze(['pending', 'confirmed', 'reconciled', 'cancelled']);
// A pending draft is the only mutable operational record.  The client sends
// its last observed revision so the API can reject a stale save atomically.
export const FINANCE_DRAFT_REVISION_CONTRACT = Object.freeze({ method: 'PUT', path: '/movements/:id', requiredField: 'expectedRevision' });

export function asTrimmedString(value, field, { required = true, max = 240 } = {}) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) throw new FinanceContractError('VALIDATION_ERROR', `${field} é obrigatório.`);
  if (normalized.length > max) throw new FinanceContractError('VALIDATION_ERROR', `${field} excede ${max} caracteres.`);
  return normalized;
}

export function asMinorAmount(value, field = 'amountMinor') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new FinanceContractError('VALIDATION_ERROR', `${field} deve ser um inteiro positivo em centavos.`);
  }
  return amount;
}

export function asNonNegativeMinorAmount(value, field = 'amountMinor') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new FinanceContractError('VALIDATION_ERROR', `${field} deve ser um inteiro não negativo em minor units.`);
  }
  return amount;
}

export function asSignedMinorAmount(value, field = 'amountMinor') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new FinanceContractError('VALIDATION_ERROR', `${field} deve ser um inteiro diferente de zero em minor units.`);
  }
  return amount;
}

export function asExchangeRatePpm(value, field = 'exchangeRatePpm') {
  const rate = Number(value ?? 1_000_000);
  if (!Number.isSafeInteger(rate) || rate <= 0) {
    throw new FinanceContractError('VALIDATION_ERROR', `${field} deve ser um inteiro positivo em partes por milhão.`);
  }
  return rate;
}

export function asIsoDate(value, field) {
  const date = asTrimmedString(value, field, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new FinanceContractError('VALIDATION_ERROR', `${field} deve usar YYYY-MM-DD.`);
  }
  return date;
}

export function asCurrency(value) {
  const currency = asTrimmedString(value || 'BRL', 'currency', { max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new FinanceContractError('VALIDATION_ERROR', 'currency deve usar ISO-4217.');
  return currency;
}

export class FinanceContractError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
