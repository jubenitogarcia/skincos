import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentSessionVersion } from './worker.js';

test('CRM session version matches only the current user session version', () => {
  assert.equal(isCurrentSessionVersion({ sv: 2 }, { sessionVersion: 2 }), true);
  assert.equal(isCurrentSessionVersion({ sv: 1 }, { sessionVersion: 2 }), false);
  assert.equal(isCurrentSessionVersion({}, { sessionVersion: 0 }), false);
  assert.equal(isCurrentSessionVersion({ sv: 'not-a-number' }, { sessionVersion: 0 }), false);
});
