#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtimePaths = require('../lib/runtime-paths');

const LEDGER_DIR = path.join(runtimePaths.runtimeHome, 'state', 'livia-publish-ledger');
const SENSITIVE_KEY = /(access[_-]?token|authorization|api[_-]?key|client[_-]?secret|password|cookie|credential)/i;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function readPayload() {
  const value = argValue('--payload');
  const raw = value === '-'
    ? fs.readFileSync(0, 'utf8')
    : value || (argValue('--payload-file') ? fs.readFileSync(argValue('--payload-file'), 'utf8') : '');
  if (!raw.trim()) throw new Error('Missing --payload for Livia publish progress ledger.');
  return JSON.parse(raw);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function str(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function sanitize(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry)).filter((entry) => entry !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)])
      .filter(([, entryValue]) => entryValue !== undefined));
  }
  return value;
}

function contextFor(record) {
  const source = asObject(record);
  const media = asObject(source.media);
  const groupKey = str(source.groupKey);
  // Container, status, and publish jobs belong to a carousel group rather than
  // an individual source file. Keep their durable audit record group-scoped.
  const mediaId = str(media.id || source.mediaId) || '__group__';
  if (!groupKey) {
    throw new Error('Livia publish progress requires groupKey.');
  }
  const key = crypto.createHash('sha256').update(`${groupKey}\n${mediaId}`).digest('hex');
  return { key, groupKey, mediaId };
}

function ledgerPath(key) {
  return path.join(LEDGER_DIR, `${key}.json`);
}

function loadLedger(filePath, context) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, ...context, createdAt: new Date().toISOString(), updatedAt: '', completed: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (parsed.key !== context.key || parsed.groupKey !== context.groupKey || parsed.mediaId !== context.mediaId) {
    throw new Error(`Livia publish progress ledger context mismatch: ${filePath}`);
  }
  return { ...parsed, completed: Array.isArray(parsed.completed) ? parsed.completed : [] };
}

function writeLedger(filePath, ledger) {
  fs.mkdirSync(LEDGER_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  // DrvFS applies the Windows ACL and rejects POSIX chmod. Native Linux files still keep 0600.
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
  }
}

function recordOne(value) {
  const record = sanitize(asObject(value));
  if (!Object.keys(record).length || record.codexDryRun === true) {
    return { recorded: false, reason: record.codexDryRun === true ? 'dry_run' : 'empty' };
  }
  const semanticJobKey = str(record.semanticJobKey);
  if (!/^livia:v2:[a-f0-9]{64}$/.test(semanticJobKey)) {
    throw new Error('Livia publish progress requires a semanticJobKey (livia:v2 SHA-256); publishRunIndex is not a durable identity.');
  }
  if (!asObject(record.lastResponseBody).id && !asObject(record.lastResponseBody).post_id && !asObject(record.lastResponseBody).video_id) {
    throw new Error(`Livia publish progress requires a provider identifier for semantic job ${semanticJobKey}.`);
  }

  const context = contextFor(record);
  const filePath = ledgerPath(context.key);
  const ledger = loadLedger(filePath, context);
  const completed = ledger.completed.filter((entry) => str(asObject(entry).semanticJobKey) !== semanticJobKey);
  completed.push({ ...record, recordedAt: new Date().toISOString() });
  completed.sort((left, right) => str(left.semanticJobKey).localeCompare(str(right.semanticJobKey)));
  ledger.completed = completed;
  ledger.updatedAt = new Date().toISOString();
  writeLedger(filePath, ledger);
  return { recorded: true, key: context.key, completedCount: completed.length, semanticJobKey };
}

function main() {
  if (process.argv.includes('--assert-contract')) {
    const source = fs.readFileSync(__filename, 'utf8');
    if (!source.includes('semanticJobKey') || !source.includes('filter((entry) => str(asObject(entry).semanticJobKey) !== semanticJobKey)')) {
      throw new Error('Livia ledger resume contract is not semantic-key based.');
    }
    process.stdout.write(`${JSON.stringify({ ok: true, resumeIdentity: 'semanticJobKey', legacyIndexOnlyResume: false })}\n`);
    return;
  }
  const payload = readPayload();
  const rows = Array.isArray(payload) ? payload : [payload];
  const results = rows.map(recordOne);
  process.stdout.write(`${JSON.stringify({ ok: true, results })}\n`);
}

main();
