import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('onboarding consistency migrations are additive and keep non-operational defaults fail-closed', async () => {
  const inventory = await readFile(new URL('../migrations/0018_onboarding_consistency.sql', import.meta.url), 'utf8');
  const workforce = await readFile(new URL('../../workforce/timekeeping/migrations/0008_employee_access_states.sql', import.meta.url), 'utf8');
  assert.match(inventory, /ADD COLUMN provisioning_state/);
  assert.match(inventory, /ADD COLUMN invite_token_encrypted/);
  assert.doesNotMatch(inventory, /\bDROP\b/i);
  assert.match(workforce, /ADD COLUMN access_state/);
  assert.match(workforce, /status = 'LEAVE'/);
  assert.match(workforce, /access_state IS NULL/);
  assert.doesNotMatch(workforce, /DEFAULT\s+'ACTIVE'/i);
});

test('unified team identity migration is additive and creates explicit link ledgers', async () => {
  const inventory = await readFile(new URL('../migrations/0024_unified_team_identity.sql', import.meta.url), 'utf8');
  const inviteIdentity = await readFile(new URL('../migrations/0026_unified_invite_identity.sql', import.meta.url), 'utf8');
  const accountLinks = await readFile(new URL('../migrations/0027_crm_employee_account_links.sql', import.meta.url), 'utf8');
  const escala = await readFile(new URL('../../workforce/schedule/migrations-d1/0005_unified_employee_links.sql', import.meta.url), 'utf8');
  const atendimento = await readFile(new URL('../../crm/api/server/atendimento/migrations/20260805_unified_workforce_identity_v1.up.sql', import.meta.url), 'utf8');
  assert.match(inventory, /requested_username/i);
  assert.match(inventory, /crm_employee_team/i);
  assert.match(inventory, /crm_employee_identity_links/i);
  assert.match(inventory, /PENDING_REVIEW/i);
  assert.match(inventory, /crm_team_operations/i);
  assert.match(inventory, /crm_team_telemetry/i);
  assert.match(inventory, /CREATE TABLE IF NOT EXISTS/i);
  assert.match(inviteIdentity, /ADD COLUMN corporate_email/i);
  assert.match(inviteIdentity, /crm_employee_onboarding/i);
  assert.match(inviteIdentity, /idx_crm_invites_corporate_email/i);
  assert.doesNotMatch(inviteIdentity, /\bDROP\b/i);
  assert.match(accountLinks, /crm_employee_account_links/i);
  assert.match(accountLinks, /workforce_employee_id TEXT NOT NULL UNIQUE/i);
  assert.match(accountLinks, /onboarding_id TEXT NOT NULL UNIQUE/i);
  assert.match(accountLinks, /crm_username TEXT NOT NULL UNIQUE/i);
  assert.match(accountLinks, /review_note TEXT/i);
  assert.match(accountLinks, /reviewed_by TEXT/i);
  assert.match(accountLinks, /reviewed_at TEXT/i);
  assert.doesNotMatch(accountLinks, /\bDROP\b/i);
  assert.match(escala, /workforce_employee_id/i);
  assert.match(escala, /professional_id/i);
  assert.match(atendimento, /professional_workforce_links/i);
  assert.doesNotMatch(inventory, /\bDROP\b/i);
  assert.doesNotMatch(escala, /\bDROP\b/i);
  assert.doesNotMatch(atendimento, /\bDROP\b/i);
});

test('unified invitations deliver to personal email while preserving corporate login identity', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const auth = await readFile(new URL('../../identity/routes/auth.js', import.meta.url), 'utf8');
  const inviteBlock = admin.slice(admin.indexOf("const inviteColumns = ['id'"), admin.indexOf('await env.DB.prepare(`INSERT INTO ${invitesTable}', admin.indexOf("const inviteColumns = ['id")));
  assert.match(inviteBlock, /'invitee_email'/);
  assert.match(inviteBlock, /inviteColumns\.splice\(4, 0, 'corporate_email'\)/);
  assert.match(inviteBlock, /inviteValues\.splice\(4, 0, input\.corporateEmail\)/);
  assert.match(inviteBlock, /input\.personalEmail/);
  assert.match(admin, /const invitesHasCorporateEmail = await tableHasColumn/);
  assert.match(admin, /LOWER\(corporate_email\)=LOWER\(\?\)/);
  assert.match(auth, /INVITE_EMAIL_MISMATCH/);
  assert.match(auth, /const loginEmail = normalizedCorporateEmail \|\| email/);
  assert.match(auth, /SELECT \?, \?, \?, \?, role/);
  assert.match(auth, /INVITE_IDENTITY_MIGRATION_REQUIRED/);
  assert.match(auth, /crm_employee_account_links/);
  assert.match(auth, /AUTH_INVITE_ACCOUNT_LINKED/);
});

test('CRM account exceptions require an exact username, human review and fail-closed status changes', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const localApi = await readFile(new URL('../../crm/api/server.js', import.meta.url), 'utf8');
  const previewFixture = JSON.parse(await readFile(new URL('../../crm/api/fixtures/local-unified-team.v1.json', import.meta.url), 'utf8'));
  const accountBlock = admin.slice(admin.indexOf('const teamAccountLinkMatch'), admin.indexOf('const teamLinksMatch'));
  assert.match(accountBlock, /crmUsername = normalizeCrmUsername/);
  assert.match(accountBlock, /validateUsername\(crmUsername\)/);
  assert.match(accountBlock, /EXPLICIT_CRM_USERNAME/);
  assert.match(accountBlock, /EMPLOYEE_CRM_ACCOUNT_LINK_PROPOSED/);
  assert.match(accountBlock, /EMPLOYEE_CRM_ACCOUNT_LINK_REVIEWED/);
  assert.match(accountBlock, /CRM_ACCOUNT_LINK_CONFIRMED_IMMUTABLE/);
  assert.match(admin, /CRM_ACCOUNT_LINK_REQUIRED/);
  assert.match(admin, /crm_account_review_status/);
  assert.match(admin, /review_note/);
  assert.doesNotMatch(accountBlock, /LOWER\(email\)/i);
  assert.match(localApi, /team\/:id\/account-link/);
  assert.match(localApi, /CRM_ACCOUNT_USERNAME_INVALID/);
  assert.match(localApi, /CRM_ACCOUNT_LINK_REQUIRED/);
  assert.match(localApi, /EMPLOYEE_CRM_ACCOUNT_LINK_REVIEWED/);
  assert.equal(previewFixture.version, 2);
  assert.equal(previewFixture.team.find((member) => member.id === 'local-team-ana-ribeiro')?.crmAccountReviewStatus, 'CONFIRMED');
  assert.equal(previewFixture.team.find((member) => member.id === 'local-team-carla-souza')?.crmAccountReviewStatus, 'PENDING_REVIEW');
  assert.equal(previewFixture.team.find((member) => member.id === 'local-team-carla-souza')?.crmAccountUsername, 'legacycarla');
});

test('onboarding retries require a payload fingerprint after the unified identity migration', async () => {
  const migration = await readFile(new URL('../migrations/0025_onboarding_idempotency_fingerprint.sql', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(migration, /request_fingerprint/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/i);
  assert.match(admin, /buildEmployeeOnboardingFingerprintPayload/);
  assert.match(admin, /ONBOARDING_IDEMPOTENCY_CONFLICT/);
  assert.match(admin, /ONBOARDING_IDEMPOTENCY_FINGERPRINT_REQUIRED/);
  assert.match(admin, /repairMissingTeam/);
  assert.match(admin, /reuseExistingInvite/);
  assert.match(admin, /String\(existingOnboarding\.id \|\| ''\)\.trim\(\) !== id/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
});

test('invite activation has an audited retry boundary and does not mint a second token', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /const activationMatch = url\.pathname\.match\(\/\^\\\/admin\\\/\(onboarding\|team\)/);
  assert.match(admin, /EMPLOYEE_ONBOARDING_ACTIVATION_RETRY/);
  assert.match(admin, /INVITE_REGISTRATION_REQUIRED/);
  assert.match(admin, /invite remains consumed/);
  const activationBlock = admin.slice(
    admin.indexOf('const activationMatch'),
    admin.indexOf('  // Account-state changes are a second Identity -> Workforce saga boundary.'),
  );
  assert.doesNotMatch(activationBlock, /randomInviteToken\(\)/);
});

test('onboarding status changes stay hierarchical, synchronized, audited and fail closed', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.ok(admin.includes("const statusMatch = url.pathname.match(/^\\/admin\\/(onboarding|team)\\/([^/]+)\\/status$/);"));
  const statusBlock = admin.slice(admin.indexOf('const statusMatch'), admin.indexOf("if (url.pathname === '/admin/onboarding' && request.method === 'GET')"));
  assert.match(statusBlock, /canCreateEmployee\(/);
  assert.match(statusBlock, /isValidAccountTransition\(currentStatus, nextStatus\)/);
  assert.match(statusBlock, /syncIdentityWorkforceStatus\(env/);
  assert.match(statusBlock, /session_version=COALESCE\(session_version, 0\)\+1/);
  assert.match(statusBlock, /EMPLOYEE_ONBOARDING_STATUS_CHANGED/);
  assert.match(statusBlock, /EMPLOYEE_ONBOARDING_STATUS_SYNC_FAILED/);
  assert.match(statusBlock, /WORKFORCE_STATUS_PENDING/);
  assert.match(statusBlock, /failClosed: true/);
  assert.match(statusBlock, /uses_count=0/);
  assert.match(statusBlock, /TEAM_TERMINATION_REASON_REQUIRED/);
  assert.match(statusBlock, /terminationReasonProvided/);
  assert.match(statusBlock, /terminationReason: nextStatus === 'TERMINATED'/);
  assert.match(statusBlock, /const reactivation = nextStatus === 'ACTIVE' && currentStatus === 'SUSPENDED'/);
  assert.match(statusBlock, /Re-enabling access is fail-closed/);
  assert.match(statusBlock, /accountStatus: 'SUSPENDED'/);
  assert.match(statusBlock, /EMPLOYEE_ONBOARDING_STATUS_COMPENSATION_PENDING/);
  assert.match(statusBlock, /teamUnitsVisible\(auth, onboarding\.units_json\)/);
  assert.match(admin, /IDENTITY_ONBOARDING_MANAGED/);
});

test('authenticated staging journey exercises the governed termination reason contract', async () => {
  const journey = await readFile(new URL('../../crm/console/scripts/ponto-staging-journey.cjs', import.meta.url), 'utf8');
  const deprovisionBlock = journey.slice(journey.indexOf('const deprovision'), journey.indexOf('const list = await api', journey.indexOf('const deprovision')));
  assert.match(deprovisionBlock, /accountStatus: 'TERMINATED', reason: 'Synthetic staging deprovisioning'/);
});

test('unified team management is explicit about RBAC, scope, idempotency and aggregate telemetry', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const localApi = await readFile(new URL('../../crm/api/server.js', import.meta.url), 'utf8');
  const teamBlock = admin.slice(admin.indexOf("const isTeamRoute"), admin.indexOf("// POST /admin/onboarding"));
  assert.match(admin, /TEAM_ADMIN_ROLES = \['ADMIN', 'GESTOR', 'GERENTE'\]/);
  assert.match(admin, /TEAM_READ_ROLES = \[\.\.\.TEAM_ADMIN_ROLES, 'SUPERVISOR'\]/);
  assert.match(teamBlock, /request\.method !== 'GET'/);
  assert.match(admin, /function teamPendingItems/);
  assert.match(admin, /url\.pathname === '\/admin\/team\/bulk-status'/);
  assert.match(admin, /BULK_IDEMPOTENCY_REQUIRED/);
  assert.match(admin, /crm_team_operations/);
  assert.match(admin, /recordTeamTelemetry/);
  assert.match(admin, /failClosed: pendingIds\.length > 0/);
  assert.match(admin, /TEAM_WRITE_ROLE_DENIED/);
  assert.match(admin, /const isOnboardingRoute/);
  assert.match(admin, /crm_team_telemetry/);
  assert.match(admin, /const teamHistoryMatch/);
  assert.match(admin, /schedule-sync/);
  assert.match(admin, /TEAM_ESCALA_LINK_REQUIRED/);
  assert.match(admin, /EMPLOYEE_ESCALA_SYNC_RECORDED/);
  assert.match(admin, /kind: 'ESCALA_SYNC'/);
  assert.match(admin, /member_ids_json = \?/);
  assert.match(admin, /after_json LIKE/);
  assert.match(admin, /entity: 'EMPLOYEE_TEAM'/);
  assert.match(admin, /const teamLinkReviewMatch/);
  assert.match(admin, /TEAM_LINK_REJECTION_REASON_REQUIRED/);
  assert.match(admin, /body\.reviewStatus \|\| 'PENDING_REVIEW'/);
  assert.match(localApi, /req\.body\?\.reviewStatus \|\| 'PENDING_REVIEW'/);
  assert.match(admin, /EMPLOYEE_IDENTITY_LINK_REVIEWED/);
  assert.match(admin, /TEAM_LINK_CONFIRMED_IMMUTABLE/);
  assert.match(admin, /mobilePhoneHash: nextPhoneHash \|\| current\.mobile_phone_hash/);
  assert.match(admin, /normalizeTeamData\(body\.team, nextUnits, \{/);
  assert.match(admin, /teamData\.units\.some\(\(unit\) => !nextUnits\.includes\(unit\)\)/);
  assert.match(admin, /pendingSync: pending/);
  assert.match(admin, /Reactivation must be accepted by Workforce before local login/);
  assert.match(admin, /IDENTITY_LOCAL_ACTIVATION_NOT_APPLIED/);
  assert.match(admin, /compensationState/);
  assert.match(admin, /teamUnitsVisible\(auth, onboarding\.units_json\)/);
  assert.doesNotMatch(admin, /teamUnitsVisible\(auth, onboarding\)/);
  assert.match(localApi, /team\/:id\/schedule-sync/);
  assert.match(localApi, /scheduleOperations/);
  assert.match(localApi, /EMPLOYEE_ESCALA_SYNC_RECORDED/);
  assert.match(localApi, /ESCALA_SYNC_IDEMPOTENCY_CONFLICT/);
  assert.match(localApi, /links\/:linkId\/review/);
  assert.match(localApi, /TEAM_LINK_REJECTION_REASON_REQUIRED/);
  assert.match(localApi, /EMPLOYEE_IDENTITY_LINK_REVIEWED/);
  assert.match(localApi, /requestedUsername: input\.requestedUsername/);
  assert.match(localApi, /localHasUnknownUnits/);
  assert.match(localApi, /schedule\.units\.some\(\(unit\) => !units\.includes\(unit\)\)/);
  assert.match(localApi, /team\/:id\/activate/);
  assert.match(localApi, /registeredUser\?\.password \|\| registeredUser\?\.passwordHash/);
});

test('team edits expose a fail-closed local persistence compensation boundary', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const updateBlock = admin.slice(admin.indexOf('const teamMemberMatch'), admin.indexOf("if (url.pathname === '/admin/team' && request.method === 'GET')"));
  assert.match(updateBlock, /let workforceSynchronized = false/);
  assert.match(updateBlock, /localPersistenceStage = 'ONBOARDING_UPDATE'/);
  assert.match(updateBlock, /localPersistenceStage = 'TEAM_UPDATE'/);
  assert.match(updateBlock, /LOCAL_TEAM_UPDATE_PENDING/);
  assert.match(updateBlock, /EMPLOYEE_TEAM_COMPENSATION_PENDING/);
  assert.match(updateBlock, /TEAM_LOCAL_PERSISTENCE_PENDING/);
  assert.match(updateBlock, /failClosed: true/);
  assert.match(updateBlock, /outcome: 'PENDING'/);
});

test('team usernames remain reserved across lifecycle history', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const usernameStart = admin.indexOf('if (onboardingHasUsername) {');
  const usernameEnd = admin.indexOf('const at = new Date().toISOString();', usernameStart);
  const usernameBlock = admin.slice(usernameStart, usernameEnd);
  assert.match(usernameBlock, /LOWER\(requested_username\)=LOWER\(\?\) AND id<>\?/);
  assert.doesNotMatch(usernameBlock, /account_status NOT IN/);
  const migration = await readFile(new URL('../migrations/0024_unified_team_identity.sql', import.meta.url), 'utf8');
  assert.match(migration, /idx_crm_employee_onboarding_requested_username/);
  assert.match(migration, /WHERE requested_username IS NOT NULL/);
});

test('centralized team mode disables every legacy password-management route', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const localApi = await readFile(new URL('../../crm/api/server.js', import.meta.url), 'utf8');
  assert.equal((admin.match(/UNIFIED_TEAM_ROUTE_DISABLED/g) || []).length, 4);
  assert.match(admin, /A senha deve ser criada pelo próprio integrante/);
  assert.equal((admin.match(/legacyUserRoutesDisabled\(env\)/g) || []).length, 5);
  assert.ok((admin.match(/status: 410/g) || []).length >= 4);
  assert.equal((localApi.match(/UNIFIED_TEAM_ROUTE_DISABLED/g) || []).length, 4);
  assert.match(localApi, /const localUnifiedTeamEnabled =/);
  assert.match(localApi, /Use a gestão centralizada de equipe/);
});

test('team telemetry accepts only aggregate fields and cannot persist identity PII', async () => {
  const telemetry = await readFile(new URL('../src/services/teamTelemetry.js', import.meta.url), 'utf8');
  assert.match(telemetry, /item_count/);
  assert.match(telemetry, /unit_count/);
  const implementation = telemetry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(implementation, /email|phone|fullName|entityId|memberId/i);
});

test('unified team rollout is explicit, staging-only and fail-closed by default', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/deploy-core-workers.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /unified_team_enabled:/);
  assert.match(workflow, /default: false/);
  assert.match(workflow, /UNIFIED_TEAM_ENABLED: \$\{\{ inputs\.unified_team_enabled \}\}/);
  assert.match(workflow, /Unified team routes can only be enabled in staging/);
  assert.match(workflow, /Unified team routes require the inventory unit/);
  assert.match(workflow, /unified_team_var=false/);
  assert.match(workflow, /--var "APP_VERSION:\$RELEASE_SHA"/);
  assert.match(workflow, /--var "UNIFIED_TEAM_ENABLED:\$unified_team_var"/);
});

test('team and onboarding routes do not inherit the default unit gate', async () => {
  const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(worker, /const requireRoles = async \(allowedRoles, options = \{\}\)/);
  assert.match(worker, /if \(!options\.skipUnit && !hasUnitAccess\(u, unidade\)\)/);
  assert.match(admin, /const auth = await requireRoles\(ROLE_ADMIN, \{ skipUnit: isTeamRoute \|\| isOnboardingRoute \}\)/);
});

test('unified team maps dependency outages to retryable 503 responses', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /function isOnboardingDependencyError\(value\)/);
  assert.match(admin, /IDENTITY_WORKFORCE_\|SMTP_\|EMAIL_\|MODULE_\|TIMEKEEPING_\|RELEASE_AFFINITY_\|RUNTIME_BINDINGS_\|SERVICE_\|DATABASE_UNAVAILABLE/);
  assert.match(admin, /isOnboardingDependencyError\(message\) \? 503 : 500/);
  assert.doesNotMatch(admin, /message === 'IDENTITY_PII_KEY_NOT_CONFIGURED'.*\^WORKFORCE_\|\^SMTP_\|\^EMAIL_/s);
});

test('the governed Ponto staging identity publisher preserves the unified-team flag', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/ponto-progressive-release.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /unified_team_enabled: process\.env\.STAGE === "staging"/);
});
