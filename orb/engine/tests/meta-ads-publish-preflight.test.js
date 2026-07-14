'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  effectiveResponsesApiEnabled,
  executionSummaryForWorkflow,
  manualExecutionAuditState,
} = require('../scripts/lib/meta-ads-publish-execution-semantics');

test('Responses API uses the n8n 1.3 default when the stored parameter is absent', () => {
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.3, parameters: {} }), true);
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.3, parameters: { responsesApiEnabled: false } }), false);
  assert.equal(effectiveResponsesApiEnabled({ typeVersion: 1.2, parameters: {} }), false);
});

test('execution version follows current for inactive workflows and published version for active workflows', () => {
  const current = { version_id: 'current' };
  const history = [{ version_id: 'published' }];
  assert.equal(executionSummaryForWorkflow({ active: false, activeVersionId: 'published' }, current, history), current);
  assert.deepEqual(executionSummaryForWorkflow({ active: true, activeVersionId: 'published' }, current, history), history[0]);
});

test('manual execution retention is reported without assuming execution data exists', () => {
  assert.equal(manualExecutionAuditState({ saveManualExecutions: true }), 'persisted');
  assert.equal(manualExecutionAuditState({ saveManualExecutions: false }), 'not_persisted');
  assert.equal(manualExecutionAuditState({}), 'not_persisted');
});
