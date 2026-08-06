import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEDULE_SYNC_STATES,
  buildScheduleSyncRecord,
  fallbackScheduleSync,
  latestScheduleSyncByMember,
  normalizeScheduleSyncErrorCode,
  normalizeScheduleSyncOperationKey,
  normalizeScheduleSyncResult,
  normalizeScheduleSyncState,
  operationMemberIds,
} from '../src/services/teamScheduleSync.js';

test('normalizes the fail-closed Escala sync state contract', () => {
  assert.deepEqual(SCHEDULE_SYNC_STATES, ['NOT_CONFIGURED', 'PENDING', 'SYNCED', 'FAILED', 'BLOCKED']);
  assert.equal(normalizeScheduleSyncState('synced'), 'SYNCED');
  assert.equal(normalizeScheduleSyncState('unknown'), 'PENDING');
  assert.equal(normalizeScheduleSyncState('unknown', 'NOT_CONFIGURED'), 'NOT_CONFIGURED');
  assert.equal(normalizeScheduleSyncOperationKey('crm-escala-sync-member-1-01'), 'crm-escala-sync-member-1-01');
  assert.equal(normalizeScheduleSyncOperationKey('email@example.com'), '');
  assert.equal(normalizeScheduleSyncErrorCode('Escala API unavailable'), '');
  assert.equal(normalizeScheduleSyncErrorCode('ESCALA_API_UNAVAILABLE'), 'ESCALA_API_UNAVAILABLE');
});

test('builds a PII-free operation result and preserves only bounded operational fields', () => {
  const record = buildScheduleSyncRecord({
    state: 'FAILED',
    professionalId: 'escala-123',
    errorCode: 'ESCALA_TIMEOUT',
    attempt: 3,
    createdAt: '2026-08-06T12:00:00.000Z',
  });
  assert.equal(record.requestedStatus, 'FAILED');
  assert.equal(record.outcome, 'FAILED');
  assert.deepEqual(JSON.parse(record.resultJson), {
    state: 'FAILED',
    professionalId: 'escala-123',
    errorCode: 'ESCALA_TIMEOUT',
    attempt: 3,
    updatedAt: '2026-08-06T12:00:00.000Z',
  });
  assert.doesNotMatch(record.resultJson, /@|Ana|Ribeiro|telefone|phone/i);
});

test('selects the newest Escala sync operation for each explicit member id', () => {
  const rows = [
    { operation_key: 'newer', operation_type: 'ESCALA_SYNC', member_ids_json: JSON.stringify(['member-1']), result_json: JSON.stringify({ state: 'FAILED', errorCode: 'ESCALA_API_ERROR', attempt: 2 }), created_at: '2026-08-06T12:00:00.000Z' },
    { operation_key: 'older', operation_type: 'ESCALA_SYNC', member_ids_json: JSON.stringify(['member-1']), result_json: JSON.stringify({ state: 'PENDING', attempt: 1 }), created_at: '2026-08-06T11:00:00.000Z' },
    { operation_key: 'other', operation_type: 'BULK_STATUS', member_ids_json: JSON.stringify(['member-2']), result_json: '{}', created_at: '2026-08-06T13:00:00.000Z' },
  ];
  const latest = latestScheduleSyncByMember(rows);
  assert.equal(latest.get('member-1').state, 'FAILED');
  assert.equal(latest.get('member-1').attempt, 2);
  assert.equal(latest.has('member-2'), false);
  assert.deepEqual(operationMemberIds(rows[0]), ['member-1']);
});

test('falls back to the visible link state for records created before the ledger', () => {
  assert.deepEqual(fallbackScheduleSync('escala-1'), {
    state: 'SYNCED', professionalId: 'escala-1', errorCode: null, attempt: 0, updatedAt: null, operationKey: null, createdAt: null,
  });
  assert.equal(normalizeScheduleSyncResult({ state: 'BLOCKED', errorCode: 'X', updatedAt: 'invalid' }).updatedAt, null);
});
