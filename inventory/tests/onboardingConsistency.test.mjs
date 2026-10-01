import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('onboarding consistency migrations are additive and fail closed by default', async () => {
  const inventory = await read('../migrations/0018_onboarding_consistency.sql');
  const workforce = await read('../../workforce/timekeeping/migrations/0008_employee_access_states.sql');
  assert.match(inventory, /ADD COLUMN provisioning_state/);
  assert.match(inventory, /ADD COLUMN invite_token_encrypted/);
  assert.doesNotMatch(inventory, /\bDROP\b/i);
  assert.match(workforce, /ADD COLUMN access_state/);
  assert.match(workforce, /status = 'LEAVE'/);
  assert.match(workforce, /access_state IS NULL/);
  assert.doesNotMatch(workforce, /DEFAULT\s+'ACTIVE'/i);
});

test('unified team identity migrations stay owned by Inventory and Workforce', async () => {
  const inventory = await read('../migrations/0024_unified_team_identity.sql');
  const inviteIdentity = await read('../migrations/0026_unified_invite_identity.sql');
  const accountLinks = await read('../migrations/0027_crm_employee_account_links.sql');
  const escala = await read('../../workforce/schedule/migrations-d1/0005_unified_employee_links.sql');
  assert.match(inventory, /requested_username/i);
  assert.match(inventory, /crm_employee_team/i);
  assert.match(inventory, /crm_employee_identity_links/i);
  assert.match(inventory, /PENDING_REVIEW/i);
  assert.match(inventory, /crm_team_operations/i);
  assert.match(inventory, /crm_team_telemetry/i);
  assert.match(inviteIdentity, /ADD COLUMN corporate_email/i);
  assert.match(inviteIdentity, /crm_employee_onboarding/);
  assert.match(accountLinks, /crm_employee_account_links/i);
  assert.match(accountLinks, /workforce_employee_id TEXT NOT NULL UNIQUE/i);
  assert.match(accountLinks, /onboarding_id TEXT NOT NULL UNIQUE/i);
  assert.match(accountLinks, /crm_username TEXT NOT NULL UNIQUE/i);
  assert.match(accountLinks, /reviewed_by TEXT/i);
  assert.match(escala, /workforce_employee_id/i);
  assert.match(escala, /professional_id/i);
  for (const sql of [inventory, inviteIdentity, accountLinks, escala]) assert.doesNotMatch(sql, /\bDROP\b/i);
});

test('invitations preserve corporate login identity while delivering to personal email', async () => {
  const admin = await read('../src/routes/admin.js');
  const auth = await read('../../identity/routes/auth.js');
  assert.match(admin, /inviteColumns\.splice\(4, 0, 'corporate_email'\)/);
  assert.match(admin, /inviteValues\.splice\(4, 0, input\.corporateEmail\)/);
  assert.match(admin, /input\.personalEmail/);
  assert.match(auth, /INVITE_EMAIL_MISMATCH/);
  assert.match(auth, /const loginEmail = normalizedCorporateEmail \|\| email/);
  assert.match(auth, /INVITE_IDENTITY_MIGRATION_REQUIRED/);
  assert.match(auth, /crm_employee_account_links/);
});

test('onboarding retries and activation preserve idempotency', async () => {
  const migration = await read('../migrations/0025_onboarding_idempotency_fingerprint.sql');
  const admin = await read('../src/routes/admin.js');
  assert.match(migration, /request_fingerprint/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/i);
  assert.match(admin, /buildEmployeeOnboardingFingerprintPayload/);
  assert.match(admin, /ONBOARDING_IDEMPOTENCY_CONFLICT/);
  assert.match(admin, /ONBOARDING_IDEMPOTENCY_FINGERPRINT_REQUIRED/);
  assert.match(admin, /const activationMatch/);
  assert.match(admin, /EMPLOYEE_ONBOARDING_ACTIVATION_RETRY/);
  assert.doesNotMatch(migration, /\bDROP\b/i);
});

test('status changes are hierarchical, synchronized, audited and fail closed', async () => {
  const admin = await read('../src/routes/admin.js');
  const statusBlock = admin.slice(admin.indexOf('const statusMatch'), admin.indexOf("if (url.pathname === '/admin/onboarding' && request.method === 'GET')"));
  assert.match(statusBlock, /canCreateEmployee\(/);
  assert.match(statusBlock, /isValidAccountTransition\(currentStatus, nextStatus\)/);
  assert.match(statusBlock, /syncIdentityWorkforceStatus\(env/);
  assert.match(statusBlock, /EMPLOYEE_ONBOARDING_STATUS_CHANGED/);
  assert.match(statusBlock, /EMPLOYEE_ONBOARDING_STATUS_SYNC_FAILED/);
  assert.match(statusBlock, /WORKFORCE_STATUS_PENDING/);
  assert.match(statusBlock, /failClosed: true/);
  assert.match(statusBlock, /TEAM_TERMINATION_REASON_REQUIRED/);
  assert.match(admin, /IDENTITY_ONBOARDING_MANAGED/);
});

test('team management remains explicit about RBAC, scope, idempotency and telemetry', async () => {
  const admin = await read('../src/routes/admin.js');
  const teamBlock = admin.slice(admin.indexOf('const isTeamRoute'), admin.indexOf('// POST /admin/onboarding'));
  assert.match(admin, /TEAM_ADMIN_ROLES = \['ADMIN', 'GESTOR', 'GERENTE'\]/);
  assert.match(teamBlock, /request\.method !== 'GET'/);
  assert.match(admin, /BULK_IDEMPOTENCY_REQUIRED/);
  assert.match(admin, /crm_team_operations/);
  assert.match(admin, /recordTeamTelemetry/);
  assert.match(admin, /TEAM_WRITE_ROLE_DENIED/);
  assert.match(admin, /TEAM_LINK_REJECTION_REASON_REQUIRED/);
  assert.match(admin, /TEAM_LINK_CONFIRMED_IMMUTABLE/);
  assert.match(admin, /pendingSync: pending/);
});

test('team edits validate before Workforce synchronization and retain compensation evidence', async () => {
  const admin = await read('../src/routes/admin.js');
  const updateBlock = admin.slice(admin.indexOf('const teamMemberMatch'), admin.indexOf("if (url.pathname === '/admin/team' && request.method === 'GET')"));
  assert.ok(updateBlock.indexOf('const teamData = normalizeTeamData') < updateBlock.indexOf('await syncIdentityWorkforceOnboarding'));
  assert.match(updateBlock, /let workforceSynchronized = false/);
  assert.match(updateBlock, /LOCAL_TEAM_UPDATE_PENDING/);
  assert.match(updateBlock, /EMPLOYEE_TEAM_COMPENSATION_PENDING/);
  assert.match(updateBlock, /TEAM_LOCAL_PERSISTENCE_PENDING/);
  assert.match(updateBlock, /failClosed: true/);
});

test('team usernames remain reserved across lifecycle history', async () => {
  const admin = await read('../src/routes/admin.js');
  const migration = await read('../migrations/0024_unified_team_identity.sql');
  const usernameStart = admin.indexOf('if (onboardingHasUsername) {');
  const usernameEnd = admin.indexOf('const at = new Date().toISOString();', usernameStart);
  assert.match(admin.slice(usernameStart, usernameEnd), /LOWER\(requested_username\)=LOWER\(\?\) AND id<>\?/);
  assert.match(migration, /idx_crm_employee_onboarding_requested_username/);
});

test('centralized team mode disables legacy password-management routes', async () => {
  const admin = await read('../src/routes/admin.js');
  assert.equal((admin.match(/UNIFIED_TEAM_ROUTE_DISABLED/g) || []).length, 5);
  assert.equal((admin.match(/legacyUserRoutesDisabled\(env\)/g) || []).length, 5);
  assert.ok((admin.match(/status: 410/g) || []).length >= 4);
});

test('team telemetry and readiness never expose identity PII', async () => {
  const telemetry = await read('../src/services/teamTelemetry.js');
  const readiness = await read('../src/services/teamReadiness.js');
  assert.match(telemetry, /item_count/);
  assert.match(telemetry, /unit_count/);
  assert.doesNotMatch(telemetry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /email|phone|fullName|entityId|memberId/i);
  assert.match(readiness, /never returns secret/);
  assert.doesNotMatch(readiness, /personalEmail|mobilePhone/i);
});

test('unified team rollout remains explicitly disabled by default', async () => {
  const workflow = await read('../../.github/workflows/deploy-core-workers.yml');
  assert.match(workflow, /unified_team_enabled:/);
  assert.match(workflow, /default: false/);
  assert.match(workflow, /UNIFIED_TEAM_ENABLED: \$\{\{ inputs\.unified_team_enabled \}\}/);
  assert.match(workflow, /production_unified_team_authorized:/);
  assert.match(workflow, /UNIFIED_TEAM_PRODUCTION_GATE: \$\{\{ vars\.ENABLE_UNIFIED_TEAM_PRODUCTION \}\}/);
  assert.match(workflow, /Unified team routes can only be enabled in staging or an explicitly authorized production rollout/);
});

test('team routes use an explicit unit-scope bypass only for team management', async () => {
  const worker = await read('../src/worker.js');
  const admin = await read('../src/routes/admin.js');
  assert.match(worker, /const requireRoles = async \(allowedRoles, options = \{\}\)/);
  assert.match(worker, /if \(!options\.skipUnit && !hasUnitAccess\(u, unidade\)\)/);
  assert.match(admin, /const auth = await requireRoles\(ROLE_ADMIN, \{ skipUnit: isTeamRoute \|\| isOnboardingRoute \}\)/);
});

test('the governed Ponto staging publisher preserves the unified-team flag', async () => {
  const workflow = await read('../../.github/workflows/ponto-progressive-release.yml');
  assert.match(workflow, /unified_team_enabled: process\.env\.STAGE === "staging"/);
});
