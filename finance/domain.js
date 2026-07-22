import { FinanceContractError } from '../shared/finance-contracts/index.js';

export function buildPostedJournal({ type, amountMinor, sourceLedgerId, destinationLedgerId, categoryLedgerId }) {
  if (!sourceLedgerId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new FinanceContractError('VALIDATION_ERROR', 'Razão financeiro inválido.');
  let lines;
  if (type === 'income') {
    if (!categoryLedgerId) throw new FinanceContractError('VALIDATION_ERROR', 'Receita exige categoria financeira.');
    lines = [['debit', sourceLedgerId], ['credit', categoryLedgerId]];
  } else if (type === 'expense') {
    if (!categoryLedgerId) throw new FinanceContractError('VALIDATION_ERROR', 'Despesa exige categoria financeira.');
    lines = [['debit', categoryLedgerId], ['credit', sourceLedgerId]];
  } else if (type === 'transfer') {
    if (!destinationLedgerId || destinationLedgerId === sourceLedgerId) throw new FinanceContractError('VALIDATION_ERROR', 'Transferência exige contas financeiras distintas.');
    lines = [['debit', destinationLedgerId], ['credit', sourceLedgerId]];
  } else throw new FinanceContractError('VALIDATION_ERROR', 'Tipo de lançamento inválido.');
  const debit = lines.filter(([direction]) => direction === 'debit').reduce((total) => total + amountMinor, 0);
  const credit = lines.filter(([direction]) => direction === 'credit').reduce((total) => total + amountMinor, 0);
  if (debit !== credit) throw new FinanceContractError('JOURNAL_UNBALANCED', 'Partida dobrada não balanceada.');
  return lines.map(([direction, ledgerAccountId]) => ({ direction, ledgerAccountId, amountMinor }));
}
