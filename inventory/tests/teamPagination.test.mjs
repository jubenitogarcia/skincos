import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('unified team listing is paginated and scoped before the database limit', async () => {
  const admin = await readFile(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../migrations/0028_unified_team_query_indexes.sql', import.meta.url), 'utf8');

  assert.match(admin, /parseTeamPage\(/);
  assert.match(admin, /parseTeamPageSize\(/);
  assert.match(admin, /function teamListSqlFilters\(/);
  assert.match(admin, /json_each\(o\.units_json\)/);
  assert.match(admin, /NOT EXISTS/);
  assert.match(admin, /COUNT\(\*\) AS total/);
  assert.match(admin, /ORDER BY o\.created_at DESC, o\.id DESC LIMIT \? OFFSET \?/);
  assert.match(admin, /pagination: \{ page: effectivePage, limit, total, pages, hasMore: effectivePage < pages \}/);
  assert.match(admin, /json_valid\(member_ids_json\)=1/);
  assert.match(admin, /FROM json_each\(member_ids_json\)/);
  assert.match(admin, /member_id\.value IN \(/);
  assert.match(admin, /const onboardingIds = visible\.map\(\(row\) => String\(row\.id/);
  assert.match(admin, /const effectivePage = Math\.min\(page, pages\)/);
  assert.doesNotMatch(admin, /ORDER BY o\.created_at DESC LIMIT 500/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_crm_employee_onboarding_status_created/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_crm_employee_onboarding_created/);
  assert.doesNotMatch(migration, /ALTER TABLE|DROP TABLE|DELETE FROM|UPDATE /i);
});
