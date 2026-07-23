// Compatibility adapter for consumers that still use the CRM session boundary.
// The signed cookie format remains owned by Identity during this logical cutover.
export {
  csrfErrorFor,
  isCurrentSessionVersion,
  resolveIdentityActor,
} from '../../identity/session/actor.js';
