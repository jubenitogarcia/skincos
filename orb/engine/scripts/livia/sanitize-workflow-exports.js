#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..', 'workflows');
const SENSITIVE_KEY = /(access[_-]?token|authorization|api[_-]?key|client[_-]?secret|password|signature|private[_-]?key|cookie)/i;
const TOKEN_VALUE = /\bEAA[A-Za-z0-9]{20,}\b/g;
const BEARER_VALUE = /(Bearer\s+)[A-Za-z0-9._~\-]{20,}/gi;

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function sanitizeString(value) {
  return String(value)
    .replace(TOKEN_VALUE, '<redacted-meta-token>')
    .replace(BEARER_VALUE, '$1<redacted>');
}

function sanitize(value, key = '') {
  if (typeof value === 'string') return SENSITIVE_KEY.test(key) ? '<redacted>' : sanitizeString(value);
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    SENSITIVE_KEY.test(entryKey) ? '<redacted>' : sanitize(entryValue, entryKey),
  ]));
}

function listJson(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
    }
  };
  visit(root);
  return out;
}

function main() {
  const root = path.resolve(argValue('--root', DEFAULT_ROOT));
  const files = listJson(root);
  const changed = [];
  for (const filePath of files) {
    let source;
    try {
      source = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      continue;
    }
    const sanitized = sanitize(source);
    if (JSON.stringify(source) === JSON.stringify(sanitized)) continue;
    changed.push(path.relative(root, filePath));
    if (hasFlag('--apply')) fs.writeFileSync(filePath, `${JSON.stringify(sanitized, null, 2)}\n`);
  }
  console.log(JSON.stringify({ root, apply: hasFlag('--apply'), filesScanned: files.length, changed }, null, 2));
  if (changed.length && !hasFlag('--apply')) process.exitCode = 2;
}

main();
