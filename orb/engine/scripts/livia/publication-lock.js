'use strict';

// A single Livia publication group may be in flight at a time.  The workflow
// acquires this lease before it builds the outbound job graph; the progress
// ledger refreshes it after every accepted provider response and the final
// cleanup node releases it.  The lock is deliberately file based because the
// n8n Code sandbox cannot safely coordinate through workflow static data.

const fs = require('fs');
const path = require('path');
const runtimePaths = require('../lib/runtime-paths');

const DEFAULT_LEASE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_LOCK_PATH = path.join(runtimePaths.runtimeHome, 'state', 'livia-publication.lock');

function lockPath() {
  return process.env.LIVIA_PUBLICATION_LOCK_PATH || DEFAULT_LOCK_PATH;
}

function normalizeExecutionId(value) {
  const normalized = String(value === undefined || value === null ? '' : value)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 80);
  return normalized || 'noexec';
}

function leaseMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LEASE_MS;
}

function readLock(filePath = lockPath()) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('lock payload is not an object');
    }
    const owner = normalizeExecutionId(value.executionId);
    const expiresAt = Number(value.expiresAt);
    if (!owner || !Number.isFinite(expiresAt)) throw new Error('lock payload is incomplete');
    return { executionId: owner, acquiredAt: String(value.acquiredAt || ''), expiresAt };
  } catch (error) {
    const wrapped = new Error(`Livia publication lock is unreadable: ${error.message}`);
    wrapped.code = 'LIVIA_LOCK_UNREADABLE';
    throw wrapped;
  }
}

function writeNewLock(filePath, executionId, ttl) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o750 });
  const now = Date.now();
  const payload = {
    schema: 'livia-publication-lock.v1',
    executionId,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: now + ttl,
  };
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(payload)}\n`, { encoding: 'utf8' });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  return payload;
}

function acquire(executionId, options = {}) {
  const owner = normalizeExecutionId(executionId);
  const filePath = lockPath();
  const ttl = leaseMs(options.leaseMs);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const payload = writeNewLock(filePath, owner, ttl);
      return { acquired: true, reentrant: false, lock: payload };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = readLock(filePath);
      if (existing.executionId === owner) {
        return { acquired: true, reentrant: true, lock: existing };
      }
      if (existing.expiresAt > Date.now()) {
        return { acquired: false, reentrant: false, lock: existing };
      }
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkError) {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      }
    }
  }

  return { acquired: false, reentrant: false, lock: readLock(filePath) };
}

function heartbeat(executionId, options = {}) {
  const owner = normalizeExecutionId(executionId);
  const filePath = lockPath();
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r+');
    const before = fs.fstatSync(descriptor);
    const existing = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      return { ok: false, reason: 'owner_mismatch_or_missing', lock: null };
    }
    if (normalizeExecutionId(existing.executionId) !== owner) {
      return { ok: false, reason: 'owner_mismatch_or_missing', lock: existing };
    }
    const pathStat = fs.statSync(filePath);
    if (pathStat.dev !== before.dev || pathStat.ino !== before.ino) {
      return { ok: false, reason: 'owner_mismatch_or_missing', lock: existing };
    }
    const now = Date.now();
    const updated = {
      ...existing,
      expiresAt: now + leaseMs(options.leaseMs),
      updatedAt: new Date(now).toISOString(),
    };
    const encoded = `${JSON.stringify(updated)}\n`;
    fs.ftruncateSync(descriptor, 0);
    fs.writeSync(descriptor, encoded, 0, 'utf8');
    fs.fsyncSync(descriptor);
    const after = fs.statSync(filePath);
    if (after.dev !== before.dev || after.ino !== before.ino) {
      return { ok: false, reason: 'owner_mismatch_or_missing', lock: null };
    }
    return { ok: true, lock: updated };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, reason: 'owner_mismatch_or_missing', lock: null };
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function release(executionId) {
  const owner = normalizeExecutionId(executionId);
  const filePath = lockPath();
  const existing = readLock(filePath);
  if (!existing) return { released: false, reason: 'missing' };
  if (existing.executionId !== owner) return { released: false, reason: 'owner_mismatch' };
  fs.unlinkSync(filePath);
  return { released: true };
}

module.exports = {
  DEFAULT_LEASE_MS,
  DEFAULT_LOCK_PATH,
  acquire,
  heartbeat,
  lockPath,
  normalizeExecutionId,
  readLock,
  release,
};
