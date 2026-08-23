#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { MODULES } = require('../content-studio-v2/workflow-modules');
const dir = path.join(__dirname, '..', 'generated-workflows', 'campaign-creative-generator-v2');
const errors = [];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
if (!fs.existsSync(dir)) errors.push('generated workflow directory missing');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'package.json') : [];
if (files.length !== MODULES.length) errors.push(`expected ${MODULES.length} workflows, found ${files.length}`);
for (const file of files) { const workflow = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); const names = workflow.nodes.map((node) => node.name); if (new Set(names).size !== names.length) errors.push(`${file}: duplicate node name`); for (const [source, outputs] of Object.entries(workflow.connections || {})) { if (!names.includes(source)) errors.push(`${file}: missing source ${source}`); for (const buckets of Object.values(outputs || {})) for (const bucket of buckets || []) for (const edge of bucket || []) if (!names.includes(edge.node)) errors.push(`${file}: missing target ${edge.node}`); } if (workflow.nodes.some((node) => node.type === 'n8n-nodes-base.manualTrigger')) errors.push(`${file}: manual trigger is not allowed in production modules`); if (workflow.nodes.some((node) => /\b(post|publish|schedule|activate)\b/i.test(node.name))) errors.push(`${file}: publication-like node found`); if (workflow.nodes.some((node) => /n8n-nodes-base\.(httpRequest|googleAds|facebookGraphApi)/i.test(node.type))) errors.push(`${file}: external publication/network node found`); if (/base64|Bearer\s+[A-Za-z0-9]|drive-folder-id|google-drive-folder-id/i.test(JSON.stringify(workflow))) errors.push(`${file}: forbidden inline secret/base64/folder placeholder`); }
for (const file of files) { const workflow = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); for (const node of workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.code')) { try { new AsyncFunction('$input', '$json', node.parameters.jsCode || ''); } catch (error) { errors.push(`${file}: invalid Code node ${node.name}: ${error.message}`); } } }
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`CCG v2 workflow validation: OK (${files.length} workflows)`);
