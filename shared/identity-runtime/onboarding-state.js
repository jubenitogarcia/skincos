export const ACCOUNT_STATES = Object.freeze([
  'PENDING_ACCESS',
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
]);

export const OPERATION_STATES = Object.freeze([
  'PROVISIONING',
  'WORKFORCE_SYNCED',
  'INVITE_PENDING',
  'COMPLETED',
  'FAILED',
]);

const RANK = Object.freeze({
  PENDING_ACCESS: 10,
  INVITED: 20,
  ACTIVE: 30,
  SUSPENDED: 40,
  TERMINATED: 50,
});

export function normalizeAccountState(value) {
  const state = String(value || '').trim().toUpperCase();
  return ACCOUNT_STATES.includes(state) ? state : '';
}

export function workforceStatusForAccount(state) {
  const accountState = normalizeAccountState(state);
  if (!accountState) return '';
  return accountState === 'ACTIVE' ? 'ACTIVE' : accountState === 'TERMINATED' ? 'TERMINATED' : 'LEAVE';
}

export function workforceAccessStateForAccount(state) {
  return normalizeAccountState(state);
}

export function isOperationalAccount(state) {
  return normalizeAccountState(state) === 'ACTIVE';
}

export function isValidAccountTransition(current, next) {
  const from = normalizeAccountState(current);
  const to = normalizeAccountState(next);
  if (!from || !to) return false;
  if (from === to) return true;
  if (to === 'TERMINATED') return true;
  if (from === 'TERMINATED') return false;
  if (to === 'SUSPENDED') return from !== 'TERMINATED';
  if (from === 'SUSPENDED') return to === 'ACTIVE' || to === 'TERMINATED';
  return RANK[to] >= RANK[from];
}

export function shouldIssueInvite(state) {
  return normalizeAccountState(state) === 'INVITED';
}

