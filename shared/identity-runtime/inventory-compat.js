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

// Employee onboarding is an Identity policy. Inventory consumes it only
// through this registered compatibility adapter during the Worker extraction.
export {
  canCreateEmployee,
  displayJobTitle,
  publicOnboarding,
  validateOnboardingInput,
} from '../../identity/policy/employeeOnboarding.js';
