#!/usr/bin/env node
const { prepareMaterial } = require('../services/media-prep');
const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node scripts/media-prep.js <file>'); process.exit(2); }
console.log(JSON.stringify(prepareMaterial({ filePath }), null, 2));
