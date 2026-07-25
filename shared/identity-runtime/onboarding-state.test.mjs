import assert from 'node:assert/strict';
import test from 'node:test';
import { isOperationalAccount, isValidAccountTransition, workforceAccessStateForAccount, workforceStatusForAccount } from './onboarding-state.js';

test('pending and invited accounts are non-operational in Workforce', () => {
  for (const state of ['PENDING_ACCESS', 'INVITED', 'SUSPENDED']) {
    assert.equal(workforceStatusForAccount(state), 'LEAVE');
    assert.equal(workforceAccessStateForAccount(state), state);
    assert.equal(isOperationalAccount(state), false);
  }
  assert.equal(workforceStatusForAccount('ACTIVE'), 'ACTIVE');
  assert.equal(isOperationalAccount('ACTIVE'), true);
});

test('status transitions are monotonic and terminal states cannot be reopened', () => {
  assert.equal(isValidAccountTransition('INVITED', 'ACTIVE'), true);
  assert.equal(isValidAccountTransition('ACTIVE', 'INVITED'), false);
  assert.equal(isValidAccountTransition('ACTIVE', 'SUSPENDED'), true);
  assert.equal(isValidAccountTransition('TERMINATED', 'ACTIVE'), false);
  assert.equal(isValidAccountTransition('INVITED', 'INVITED'), true);
});

