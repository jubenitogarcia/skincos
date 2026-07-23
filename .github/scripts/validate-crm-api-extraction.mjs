import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const errors = [];
const fail = (message) => errors.push(message);
for (const file of ['crm/api/entrypoints/harmonia-worker.js', 'crm/api/entrypoints/jobs-server.js', 'crm/api/entrypoints/domain-server.js', 'crm/api/server/jobs/router.js', 'docs/architecture/crm-api-extraction.md']) {
  if (!fs.existsSync(path.join(root, file))) fail(`missing CRM extraction artifact ${file}`);
}
const server = read('crm/api/server.js');
if (!server.includes("CRM_HARMONIA_WORKER_MODE || 'embedded'")) fail('Harmonia worker must be controllable outside the API process');
if (!server.includes("CRM_JOBS_MODE || 'embedded'")) fail('jobs must have an external-worker mode');
if (!server.includes("createProxyMiddleware({ target: jobsWorkerUrl")) fail('external jobs must be reached through the compatibility gateway');
const pkg = JSON.parse(read('crm/api/package.json'));
for (const script of ['start:harmonia-worker', 'start:jobs-worker', 'start:domain']) if (!pkg.scripts?.[script]) fail(`missing CRM script ${script}`);
if (errors.length) { for (const error of errors) process.stderr.write(`CRM API extraction validation failed: ${error}\n`); process.exit(1); }
process.stdout.write('CRM API extraction validation OK.\n');
