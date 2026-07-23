// Deprecated CRM-facing compatibility surface. The API keeps this import while
// Identity becomes the owner of session verification and actor projection.
import {
  csrfErrorFor,
  isCurrentSessionVersion,
  resolveIdentityActor,
} from '../identity-runtime/session.js';

export { csrfErrorFor, isCurrentSessionVersion };
export const resolveCrmActor = resolveIdentityActor;
