#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const apply = process.argv.includes('--apply');
const runtimeHome = process.env.N8N_RUNTIME_HOME || '/mnt/c/CodexRuntime/n8n';
const target = process.env.CLOUDINARY_NODE_UPLOAD_FILE || path.join(
  runtimeHome,
  'n8n-home/nodes/node_modules/n8n-nodes-cloudinary/dist/nodes/Cloudinary/operations/upload/uploadFile.js',
);

const original = `    const response = await ctx.helpers.httpRequestWithAuthentication.call(ctx, types_1.CREDENTIAL_TYPE, options);\n    return [response];`;
const hardened = `    const response = await ctx.helpers.httpRequestWithAuthentication.call(ctx, types_1.CREDENTIAL_TYPE, options);\n    if (response && typeof response === 'object' && !Array.isArray(response)) {\n        const sanitizedResponse = { ...response };\n        delete sanitizedResponse.api_key;\n        delete sanitizedResponse.api_secret;\n        delete sanitizedResponse.authorization;\n        delete sanitizedResponse.access_token;\n        return [sanitizedResponse];\n    }\n    return [response];`;

if (!fs.existsSync(target)) {
  throw new Error(`Cloudinary community node not found: ${target}`);
}

const source = fs.readFileSync(target, 'utf8');
const patched = source.includes(hardened);
const patchable = source.includes(original);

if (!apply) {
  console.log(JSON.stringify({ ok: patched, target, patched, patchable }, null, 2));
  if (!patched) process.exitCode = 1;
  return;
}

if (patched) {
  console.log(JSON.stringify({ ok: true, target, changed: false, reason: 'already_patched' }, null, 2));
  return;
}
if (!patchable) {
  throw new Error('Cloudinary upload implementation changed; refusing an unsafe patch. Review the installed package before proceeding.');
}

const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const backupDir = path.join(runtimeHome, 'exports/community-node-patches', stamp);
fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const backup = path.join(backupDir, 'uploadFile.js');
fs.copyFileSync(target, backup);
fs.writeFileSync(target, source.replace(original, hardened), { mode: 0o644 });

console.log(JSON.stringify({ ok: true, target, changed: true, backup }, null, 2));
