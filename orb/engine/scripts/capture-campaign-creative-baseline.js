#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const source = path.join(root, 'scripts', 'build-campaign-creative-generator.js');
const out = path.join(root, 'baseline', 'campaign-creative-generator-legacy');
fs.mkdirSync(out, { recursive: true });
const builder = fs.readFileSync(source); fs.writeFileSync(path.join(out, 'build-campaign-creative-generator.js'), builder);
const workflowDir = path.join(root, 'workflows'); const files = fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir).filter((name) => name.startsWith('campaign-creative-generator.') && name.endsWith('.json')) : [];
const manifest = { captured_from: 'scripts/build-campaign-creative-generator.js', files: [], credentials: 'credential references retained only as non-secret metadata', generated_at: new Date().toISOString() };
for (const file of files) { const raw = fs.readFileSync(path.join(workflowDir, file)); const target = path.join(out, file); fs.writeFileSync(target, raw); manifest.files.push({ file, sha256: crypto.createHash('sha256').update(raw).digest('hex'), bytes: raw.length }); }
fs.writeFileSync(path.join(out, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`); console.log(`Captured legacy baseline in ${out}`);
