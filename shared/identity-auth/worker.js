// Neutral API-facing identity adapter. The gateway keeps this tiny import while
// Identity owns session verification and actor projection.
import {
  csrfErrorFor,
  isCurrentSessionVersion,
  resolveIdentityActor,
} from '../identity-runtime/session.js';

export { csrfErrorFor, isCurrentSessionVersion };
export const resolveCrmActor = resolveIdentityActor;
