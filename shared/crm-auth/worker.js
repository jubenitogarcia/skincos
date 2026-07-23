// Deprecated compatibility surface. Identity owns session validation and data
// access; consumers use shared/identity-contract for the stable actor shape.
import { csrfErrorFor } from '../identity-contract/index.js';

export function isCurrentSessionVersion(session, user) {
  const sessionVersion = Number(session?.sv);
  const userVersion = Number(user?.sessionVersion || 0);
  return Number.isSafeInteger(sessionVersion) && Number.isSafeInteger(userVersion) && sessionVersion === userVersion;
}

export { csrfErrorFor };
