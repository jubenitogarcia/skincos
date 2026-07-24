import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '../..');
export const manifest = JSON.parse(fs.readFileSync(path.join(root, 'platform/staging/manifest.json'), 'utf8'));
export const domainsById = new Map(manifest.domains.map((domain) => [domain.id, domain]));

export function parseDomain(argv) {
  const position = argv.indexOf('--domain');
  const id = position < 0 ? '' : String(argv[position + 1] || '');
  if (!domainsById.has(id)) throw new Error('--domain must be identity, inventory or finance');
  return domainsById.get(id);
}

export function privateStateDirectory() {
  const state = process.env.SKINCOS_STAGING_STATE_DIR;
  if (!state) throw new Error('SKINCOS_STAGING_STATE_DIR must point outside the repository');
  const resolved = path.resolve(state);
  if (resolved.startsWith(root + path.sep) || resolved === root) throw new Error('SKINCOS_STAGING_STATE_DIR must not be inside the repository');
  return resolved;
}

export function runWrangler(args, options = {}) {
  return execFileSync('npx', ['wrangler', ...args], { cwd: root, encoding: 'utf8', stdio: options.stdio || 'inherit' });
}

export function statePaths(domain, state) {
  const directory = path.join(state, domain.id);
  return {
    directory,
    config: path.join(directory, 'wrangler.json'),
    evidence: path.join(directory, 'bootstrap-evidence.json'),
  };
}

export function requireApply(argv, variable) {
  if (!argv.includes('--apply') || process.env[variable] !== '1') throw new Error(`Refusing remote mutation. Use --apply and ${variable}=1 after an approved staging change window.`);
}
