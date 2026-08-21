'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const lockModulePath = require.resolve('../scripts/livia/publication-lock');

test('Livia publication lease serializes concurrent executions and only the owner can release it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'livia-publication-lock-'));
  const lockPath = path.join(directory, 'publication.lock');
  const previous = process.env.LIVIA_PUBLICATION_LOCK_PATH;
  process.env.LIVIA_PUBLICATION_LOCK_PATH = lockPath;
  delete require.cache[lockModulePath];
  const lock = require(lockModulePath);
  try {
    assert.equal(lock.acquire('execution-a', { leaseMs: 60_000 }).acquired, true);
    assert.equal(lock.acquire('execution-b', { leaseMs: 60_000 }).acquired, false);
    assert.equal(lock.heartbeat('execution-b').ok, false);
    assert.equal(lock.heartbeat('execution-a').ok, true);
    assert.equal(lock.release('execution-b').released, false);
    assert.equal(lock.release('execution-a').released, true);
    assert.equal(lock.acquire('execution-b', { leaseMs: 60_000 }).acquired, true);
  } finally {
    try { lock.release('execution-b'); } catch {}
    if (previous === undefined) delete process.env.LIVIA_PUBLICATION_LOCK_PATH;
    else process.env.LIVIA_PUBLICATION_LOCK_PATH = previous;
    delete require.cache[lockModulePath];
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('expired Livia publication leases are recoverable without weakening active leases', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'livia-publication-lock-expired-'));
  const lockPath = path.join(directory, 'publication.lock');
  const previous = process.env.LIVIA_PUBLICATION_LOCK_PATH;
  process.env.LIVIA_PUBLICATION_LOCK_PATH = lockPath;
  delete require.cache[lockModulePath];
  const lock = require(lockModulePath);
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ schema: 'livia-publication-lock.v1', executionId: 'old', acquiredAt: '', expiresAt: Date.now() - 1 }));
    assert.equal(lock.acquire('new', { leaseMs: 60_000 }).acquired, true);
    assert.equal(lock.readLock().executionId, 'new');
  } finally {
    try { lock.release('new'); } catch {}
    if (previous === undefined) delete process.env.LIVIA_PUBLICATION_LOCK_PATH;
    else process.env.LIVIA_PUBLICATION_LOCK_PATH = previous;
    delete require.cache[lockModulePath];
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
