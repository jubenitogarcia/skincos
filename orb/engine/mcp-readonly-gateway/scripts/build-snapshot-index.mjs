import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { connectionCount } from '../lib/workflow-analysis.mjs';
import { sanitizeText } from '../lib/sanitize.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function git(repository, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repository, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`git_failed:${sanitizeText(stderr, 300)}`)));
  });
}

const repository = argument('--repository');
const ref = argument('--ref') || 'origin/main';
const output = argument('--output');
if (!repository || !output) throw new Error('usage: --repository <path> --ref <git-ref> --output <path>');

const commit = (await git(repository, ['rev-parse', ref])).trim();
const paths = (await git(repository, ['ls-tree', '-r', '-z', '--name-only', ref, '--', 'orb/engine'])).split('\0').filter((path) => /(?:workflow|orb|n8n).*\.json$/i.test(path));
const workflows = [];
for (const path of paths) {
  try {
    const parsed = JSON.parse(await git(repository, ['show', `${ref}:${path}`]));
    if (!Array.isArray(parsed?.nodes) || !parsed?.connections) continue;
    workflows.push({
      id: parsed.id ? sanitizeText(parsed.id, 120) : null,
      name: sanitizeText(parsed.name || '', 240),
      path: sanitizeText(path, 400),
      node_count: parsed.nodes.length,
      connection_count: connectionCount(parsed.connections),
      node_types: [...new Set(parsed.nodes.map((node) => sanitizeText(node.type || '', 220)).filter(Boolean))].sort(),
      updated_at: parsed.updatedAt || null,
    });
  } catch { /* malformed or non-workflow snapshot is intentionally ignored */ }
}
const index = { version: 1, source: { repository: 'github-origin-mirror', ref, commit, generated_at: new Date().toISOString() }, workflows };
await mkdir(dirname(output), { recursive: true, mode: 0o750 });
await writeFile(output, `${JSON.stringify(index)}\n`, { mode: 0o640 });
process.stdout.write(`${JSON.stringify({ snapshot_workflows: workflows.length, ref, commit })}\n`);
