// Temporary exports used by the remaining Inventory administrative handlers.
export {
  INVITABLE_ROLES,
  normalizeInviteEmail,
  normalizeInviteScope,
  hasRequiredInviteScope,
  validateInviteDelegation,
} from '../../identity/policy/invitePolicy.js';
export {
  hasAuthMailerConfig,
  hasPasswordResetMailerConfig,
  sendPasswordResetEmail,
  sendAccountInviteEmail,
} from '../../identity/notifications/smtpMailer.js';
