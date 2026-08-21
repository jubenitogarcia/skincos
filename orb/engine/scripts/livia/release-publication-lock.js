#!/usr/bin/env node
'use strict';

const { release } = require('./publication-lock');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

const executionId = argument('--execution-id');
if (!executionId) {
  console.error('Missing --execution-id for Livia publication lock release.');
  process.exit(2);
}

try {
  const result = release(executionId);
  if (result.reason === 'owner_mismatch') {
    throw new Error('Livia publication lock owner mismatch; refusing to remove another execution lease.');
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  console.error(error.stack || String(error));
  process.exit(1);
}
