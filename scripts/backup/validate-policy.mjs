import fs from 'node:fs';
const policy = JSON.parse(fs.readFileSync('ops/backup/policy.json', 'utf8'));
const requiredAssets = ['d1-critical', 'postgres', 'r2', 'configuration', 'operational-state'];
const required = ['rpo', 'rto', 'frequency', 'retention', 'primaryCopy', 'offsiteCopy', 'restore', 'testFrequency'];
const fail = (message) => { console.error(`backup policy validation failed: ${message}`); process.exitCode = 1; };
for (const id of requiredAssets) { const asset = policy.assets?.find((item) => item.id === id); if (!asset) { fail(`missing asset ${id}`); continue; } for (const field of required) if (!asset[field]) fail(`${id} missing ${field}`); }
if (!String(policy.offsite?.encryption || '').includes('age')) fail('offsite encryption must be client-side age encryption');
if (!policy.evidence?.required?.includes('restoreVerified')) fail('restore evidence must include restoreVerified');
if (!process.exitCode) console.log(`Backup policy validation OK (${policy.assets.length} asset classes).`);
