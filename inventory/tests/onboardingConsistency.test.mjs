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
  const escala = await readFile(new URL('../../workforce/schedule/migrations-d1/0005_unified_employee_links.sql', import.meta.url), 'utf8');
  const atendimento = await readFile(new URL('../../crm/api/server/atendimento/migrations/20260805_unified_workforce_identity_v1.up.sql', import.meta.url), 'utf8');
  assert.match(inventory, /requested_username/i);
  assert.match(inventory, /crm_employee_team/i);
  assert.match(inventory, /crm_employee_identity_links/i);
  assert.match(inventory, /PENDING_REVIEW/i);
  assert.match(inventory, /crm_team_operations/i);
  assert.match(inventory, /crm_team_telemetry/i);
  assert.match(inventory, /CREATE TABLE IF NOT EXISTS/i);
  assert.match(escala, /workforce_employee_id/i);
  assert.match(escala, /professional_id/i);
  assert.match(atendimento, /professional_workforce_links/i);
  assert.doesNotMatch(inventory, /\bDROP\b/i);
  assert.doesNotMatch(escala, /\bDROP\b/i);
  assert.doesNotMatch(atendimento, /\bDROP\b/i);
});

test('invite activation has an audited retry boundary and does not mint a second token', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.ok(admin.includes("const activationMatch = url.pathname.match(/^\\/admin\\/onboarding\\/([^/]+)\\/activate$/);"));
  assert.match(admin, /EMPLOYEE_ONBOARDING_ACTIVATION_RETRY/);
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
  assert.match(statusBlock, /teamUnitsVisible\(auth, onboarding\.units_json\)/);
  assert.match(admin, /IDENTITY_ONBOARDING_MANAGED/);
});

test('unified team management is explicit about RBAC, scope, idempotency and aggregate telemetry', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
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
  assert.match(admin, /after_json LIKE/);
  assert.match(admin, /entity: 'EMPLOYEE_TEAM'/);
  assert.match(admin, /pendingSync: pendingIds\.includes\(row\.id\)/);
  assert.match(admin, /compensationState/);
  assert.match(admin, /teamUnitsVisible\(auth, onboarding\.units_json\)/);
  assert.doesNotMatch(admin, /teamUnitsVisible\(auth, onboarding\)/);
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
  const usernameBlock = admin.slice(admin.indexOf('if (onboardingHasUsername) {'), admin.indexOf('const at = new Date().toISOString();'));
  assert.match(usernameBlock, /LOWER\(requested_username\)=LOWER\(\?\) AND id<>\?/);
  assert.doesNotMatch(usernameBlock, /account_status NOT IN/);
  const migration = await readFile(new URL('../migrations/0024_unified_team_identity.sql', import.meta.url), 'utf8');
  assert.match(migration, /idx_crm_employee_onboarding_requested_username/);
  assert.match(migration, /WHERE requested_username IS NOT NULL/);
});

test('centralized team mode disables every legacy password-management route', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.equal((admin.match(/UNIFIED_TEAM_ROUTE_DISABLED/g) || []).length, 4);
  assert.match(admin, /A senha deve ser criada pelo próprio integrante/);
  assert.equal((admin.match(/legacyUserRoutesDisabled\(env\)/g) || []).length, 5);
  assert.ok((admin.match(/status: 410/g) || []).length >= 4);
});

test('team telemetry accepts only aggregate fields and cannot persist identity PII', async () => {
  const telemetry = await readFile(new URL('../src/services/teamTelemetry.js', import.meta.url), 'utf8');
  assert.match(telemetry, /item_count/);
  assert.match(telemetry, /unit_count/);
  const implementation = telemetry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(implementation, /email|phone|fullName|entityId|memberId/i);
});
