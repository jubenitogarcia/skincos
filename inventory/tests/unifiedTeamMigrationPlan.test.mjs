import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUnifiedTeamIdentityLinkSql,
  buildUnifiedTeamMigrationPlan,
  buildUnifiedTeamMigrationSql,
} from '../scripts/unifiedTeamMigrationPlan.mjs';

test('plans only active Escala rows and never matches by display name', () => {
  const plan = buildUnifiedTeamMigrationPlan([
    { id: 'escala-1', name: 'Ana Ribeiro', status: 'Ativo', workforceEmployeeId: 'wf-1', units: ['Novo Hamburgo'] },
    { id: 'escala-2', name: 'Ana Ribeiro', status: 'Inativo', workforceEmployeeId: 'wf-2' },
    { id: 'escala-3', name: 'Ana Ribeiro', status: 'Ativo' },
  ]);
  assert.equal(plan.summary.scanned, 3);
  assert.equal(plan.summary.active, 2);
  assert.equal(plan.summary.ignored, 1);
  assert.equal(plan.summary.ready, 1);
  assert.equal(plan.pending[0].reason, 'WORKFORCE_ID_REQUIRED');
});

test('fails closed on duplicate source or workforce identifiers', () => {
  const plan = buildUnifiedTeamMigrationPlan([
    { id: 'escala-1', status: 'ACTIVE', workforceEmployeeId: 'wf-1' },
    { id: 'escala-1', status: 'ACTIVE', workforceEmployeeId: 'wf-2' },
    { id: 'escala-3', status: 'ACTIVE', workforceEmployeeId: 'wf-1' },
  ]);
  assert.equal(plan.summary.ready, 0);
  assert.ok(plan.conflicts.some((item) => item.reason === 'DUPLICATE_SOURCE_ID'));
  assert.ok(plan.conflicts.some((item) => item.reason === 'DUPLICATE_WORKFORCE_ID'));
});

test('is idempotent for an already confirmed explicit link and flags mismatches for review', () => {
  const rows = [{ id: 'escala-1', status: 'ACTIVE', workforceEmployeeId: 'wf-1' }];
  const noop = buildUnifiedTeamMigrationPlan(rows, [{ source: 'ESCALA', sourceId: 'escala-1', workforceEmployeeId: 'wf-1', reviewStatus: 'CONFIRMED' }]);
  assert.equal(noop.summary.noop, 1);
  assert.equal(noop.summary.ready, 0);

  const conflict = buildUnifiedTeamMigrationPlan(rows, [{ source: 'ESCALA', sourceId: 'escala-1', workforceEmployeeId: 'wf-other', reviewStatus: 'CONFIRMED' }]);
  assert.equal(conflict.summary.conflicts, 1);
  assert.equal(conflict.conflicts[0].reason, 'EXISTING_SOURCE_LINK_CONFLICT');
});

test('emits additive idempotent SQL only for safe explicit links', () => {
  const plan = buildUnifiedTeamMigrationPlan([{ id: 'escala-1', status: 'ACTIVE', workforceEmployeeId: 'wf-1' }]);
  const sql = buildUnifiedTeamMigrationSql(plan, '2026-08-05T00:00:00.000Z');
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /INSERT OR IGNORE/);
  assert.match(sql, /EXPLICIT_WORKFORCE_ID/);
  assert.doesNotMatch(sql, /Ana|Ribeiro/);
  assert.equal(buildUnifiedTeamMigrationSql({ ready: [] }), '-- No safe identity links are ready; pending and conflict rows require review.\n');
  assert.throws(() => buildUnifiedTeamIdentityLinkSql({ sourceId: 'escala-1' }), /MIGRATION_LINK_IDENTIFIERS_REQUIRED/);
});
