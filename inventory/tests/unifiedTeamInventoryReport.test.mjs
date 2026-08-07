import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnifiedTeamInventoryReport } from '../scripts/unifiedTeamInventoryReport.mjs';

function completeInventory(overrides = {}) {
  return {
    sources: {
      crmAccounts: [{
        id: 'crm-account-1',
        status: 'ACTIVE',
        workforceEmployeeId: 'wf-1',
        units: ['novo-hamburgo'],
        fullName: 'Ana Ribeiro',
        email: 'ana.ribeiro@example.test',
        phone: '+55 51 99999-0001',
      }],
      crmOnboarding: [{
        id: 'onboarding-1',
        status: 'ACTIVE',
        workforceEmployeeId: 'wf-1',
        units: ['novo-hamburgo'],
      }],
      workforceEmployees: [{
        id: 'wf-1',
        status: 'ACTIVE',
        units: ['novo-hamburgo'],
      }],
      escalaProfessionals: [{
        id: 'escala-1',
        status: 'ATIVO',
        workforceEmployeeId: 'wf-1',
        units: ['novo-hamburgo'],
      }],
      atendimentoProfessionals: [{
        id: 'atendimento-1',
        status: 'ACTIVE',
        workforceEmployeeId: 'wf-1',
        units: ['novo-hamburgo'],
      }],
      pontoEmployees: [{
        id: 'ponto-1',
        status: 'ACTIVE',
        workforceEmployeeId: 'wf-1',
        units: ['novo-hamburgo'],
      }],
    },
    ...overrides,
  };
}

test('produces a complete sanitized inventory from explicit identifiers', () => {
  const report = buildUnifiedTeamInventoryReport(completeInventory());
  assert.equal(report.mode, 'read-only');
  assert.equal(report.summary.missingSources, 0);
  assert.equal(report.summary.canonicalEmployees, 1);
  assert.equal(report.summary.ready, 5);
  assert.equal(report.summary.pending, 0);
  assert.equal(report.summary.conflicts, 0);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('Ana Ribeiro'), false);
  assert.equal(serialized.includes('ana.ribeiro@example.test'), false);
  assert.equal(serialized.includes('+55 51 99999-0001'), false);
  assert.equal(serialized.includes('crm-account-1'), false);
  assert.equal(serialized.includes('wf-1'), false);
});

test('fails closed when the source snapshot is incomplete or identifiers are missing', () => {
  const report = buildUnifiedTeamInventoryReport({
    sources: {
      crmAccounts: [
        { status: 'ACTIVE', fullName: 'Synthetic Pending', email: 'pending@example.test' },
        { id: 'crm-inactive', status: 'INACTIVE', workforceEmployeeId: 'wf-old' },
      ],
      crmOnboarding: [],
      escalaProfessionals: [{ id: 'escala-orphan', status: 'ACTIVE', workforceEmployeeId: 'wf-missing', units: ['novo-hamburgo'] }],
    },
  });
  assert.equal(report.summary.missingSources, 3);
  assert.ok(report.pending.some((item) => item.reason === 'SOURCE_ID_REQUIRED'));
  assert.ok(report.pending.some((item) => item.reason === 'SOURCE_SNAPSHOT_REQUIRED'));
  assert.ok(report.conflicts.some((item) => item.kind === 'ORPHAN_WORKFORCE_ID'));
  assert.ok(report.ignored.some((item) => item.reason === 'INACTIVE_OR_HISTORICAL'));
  assert.equal(report.ready.length, 0);
});

test('reports duplicate explicit records and unit divergence without linking by similarity', () => {
  const input = completeInventory();
  input.sources.escalaProfessionals.push({
    id: 'escala-duplicate',
    status: 'ACTIVE',
    workforceEmployeeId: 'wf-1',
    units: ['novo-hamburgo'],
  });
  input.sources.atendimentoProfessionals[0].units = ['barra-shopping-sul'];
  const report = buildUnifiedTeamInventoryReport(input);
  assert.ok(report.conflicts.some((item) => item.kind === 'DUPLICATE_SOURCE_WORKFORCE'));
  assert.ok(report.conflicts.some((item) => item.kind === 'UNIT_SCOPE_DIVERGENCE'));
  assert.equal(report.ready.length, 0);
});

test('keeps the report fingerprint stable for the same read-only snapshot', () => {
  const first = buildUnifiedTeamInventoryReport(completeInventory());
  const second = buildUnifiedTeamInventoryReport(completeInventory());
  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first.summary, second.summary);
});
