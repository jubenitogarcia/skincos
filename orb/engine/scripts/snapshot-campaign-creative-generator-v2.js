#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dir = path.join(__dirname, '..', 'generated-workflows', 'campaign-creative-generator-v2');
const snapshot = Object.fromEntries(fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => { const raw = fs.readFileSync(path.join(dir, name)); return [name, crypto.createHash('sha256').update(raw).digest('hex')]; }));
const output = path.join(__dirname, '..', 'docs', 'campaign-creative-generator-v2-snapshot.json'); fs.writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`); console.log(`Wrote ${output}`);
