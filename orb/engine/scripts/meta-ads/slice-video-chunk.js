#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const encoded = process.argv[process.argv.indexOf('--payload-b64') + 1] || '';
let payload;
try { payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { throw new Error('video_chunk_payload_invalid'); }
const input = path.resolve(String(payload.input_file || ''));
const outputDir = path.resolve(String(payload.output_dir || ''));
const start = Number(payload.start_offset);
const end = Number(payload.end_offset);
if (!fs.existsSync(input)) throw new Error('video_chunk_input_missing');
if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end - start > MAX_CHUNK_BYTES) {
  throw new Error('video_chunk_offsets_invalid');
}
if (!outputDir || !outputDir.includes('meta-ads-publish')) throw new Error('video_chunk_output_dir_invalid');
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `chunk_${start}_${end}.part`);
const inputFd = fs.openSync(input, 'r');
const buffer = Buffer.alloc(end - start);
try {
  const bytesRead = fs.readSync(inputFd, buffer, 0, buffer.length, start);
  if (bytesRead !== buffer.length) throw new Error('video_chunk_short_read');
  fs.writeFileSync(output, buffer);
} finally {
  fs.closeSync(inputFd);
}
process.stdout.write(JSON.stringify({ ...payload, chunk_file: output, chunk_size: buffer.length }));
