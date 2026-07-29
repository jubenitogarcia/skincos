#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { definitions } = require('../music-composition-studio/lib/schema-definitions');
const out = path.join(__dirname, '..', 'music-composition-studio', 'schemas');
fs.mkdirSync(out, { recursive: true });
for (const [name, schema] of Object.entries(definitions)) fs.writeFileSync(path.join(out, `${name}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`);
console.log(`Music Composition Studio schemas: OK (${Object.keys(definitions).length} generated)`);
