#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { renderStill } = require('./index');
const outputDir = process.argv[2] || path.join(process.cwd(), 'output', 'renderer');
const result = renderStill({ outputDir, deliverableId: 'renderer-cli', overlays: [{ text: 'deterministic fixture' }] });
console.log(JSON.stringify(result, null, 2));
