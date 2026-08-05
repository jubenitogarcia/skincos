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
  assert.match(admin, /IDENTITY_ONBOARDING_MANAGED/);
});
