import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRegistry } from './change-registry.mjs';

function claim(overrides = {}) {
  return {
    id: 'meta-ads-payload',
    owner: 'thread:example',
    status: 'in_progress',
    objective: 'Validate coordination behavior.',
    branch: 'codex/admin/example-task',
    worktree: 'C:\\CodexShared\\Worktrees\\skincos\\admin\\example-task',
    baseline: { git_ref: 'ebb1eb38363fb4ea46b9a2def580e322c49af6b3', recorded_at: '2026-07-28T00:00:00Z' },
    surfaces: [{ kind: 'source', id: 'orb/engine/workflows/meta-ads-publish', access: 'write' }],
    contract_bundles: [],
    rollback: { summary: 'Revert the isolated commit.' },
    ...overrides,
  };
}

function registry(changes) {
  return { schema_version: 1, changes, history: [] };
}

test('accepts a valid isolated change claim', () => {
  assert.deepEqual(validateRegistry(registry([claim()])), []);
});

test('rejects overlapping active source write claims', () => {
  const errors = validateRegistry(registry([
    claim(),
    claim({ id: 'workflow-contract', surfaces: [{ kind: 'source', id: 'orb/engine', access: 'write' }] }),
  ]));
  assert.ok(errors.some((error) => error.includes('active claim conflict')));
});

test('requires rollback for an active write claim', () => {
  const errors = validateRegistry(registry([claim({ rollback: undefined })]));
  assert.ok(errors.some((error) => error.includes('rollback.summary')));
});

test('requires a declared compatibility command for a contract bundle', () => {
  const errors = validateRegistry(registry([claim({
    surfaces: [
      { kind: 'workflow', id: 'n8n:eFJhFg79lyaycjlm', access: 'write' },
      { kind: 'worker', id: 'token-vault-worker', access: 'write' },
    ],
    contract_bundles: [{ id: 'meta-contract', surfaces: ['workflow:n8n:eFJhFg79lyaycjlm', 'worker:token-vault-worker'] }],
  })]));
  assert.ok(errors.some((error) => error.includes('compatibility_check')));
});

test('requires a full contract bundle and live checkpoints across source and workflow writes', () => {
  const errors = validateRegistry(registry([claim({
    surfaces: [
      { kind: 'source', id: 'orb/engine/workflows/meta-ads-publish', access: 'write' },
      { kind: 'workflow', id: 'n8n:eFJhFg79lyaycjlm', access: 'write' },
    ],
  })]));
  assert.ok(errors.some((error) => error.includes('.baseline requires version')));
  assert.ok(errors.some((error) => error.includes('must declare a contract_bundle')));
});

test('does not reuse an ID retained in the private history', () => {
  const finished = { ...claim(), status: 'validated', completed_at: '2026-07-28T00:10:00Z' };
  const errors = validateRegistry({ schema_version: 1, changes: [claim()], history: [finished] });
  assert.ok(errors.some((error) => error.includes('already exists in history')));
});
