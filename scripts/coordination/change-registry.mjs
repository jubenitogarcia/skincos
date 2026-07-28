import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ACTIVE_STATUSES = new Set(['planned', 'in_progress', 'blocked', 'handoff']);
const TERMINAL_STATUSES = new Set(['validated', 'integrated', 'deployed', 'cancelled']);
const SURFACE_KINDS = new Set(['source', 'workflow', 'worker', 'database', 'deployment', 'runtime', 'credential']);
const LIVE_SURFACE_KINDS = new Set(['workflow', 'worker', 'database', 'deployment', 'runtime', 'credential']);
const ACCESS_MODES = new Set(['read', 'write']);
const CHANGE_ID = /^[a-z0-9][a-z0-9-]{2,79}$/;
const BRANCH = /^codex\/[a-z0-9._-]+\/[a-z0-9._-]+$/;
const DEFAULT_REGISTRY = 'C:\\CodexRuntime\\operator\\admin\\skincos\\change-coordination\\active-changes.json';

function fail(errors, message) {
  errors.push(message);
}

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function active(change) {
  return ACTIVE_STATUSES.has(change.status);
}

function surfaceKey(surface) {
  return `${surface.kind}:${surface.id}`;
}

function sourceOverlaps(left, right) {
  const a = left.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  const b = right.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function surfacesConflict(left, right) {
  if (!asObject(left) || !asObject(right) || typeof left.id !== 'string' || typeof right.id !== 'string') return false;
  if (left.access !== 'write' && right.access !== 'write') return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === 'source') return sourceOverlaps(left.id, right.id);
  return left.id.toLowerCase() === right.id.toLowerCase();
}

export function validateRegistry(registry) {
  const errors = [];
  if (!asObject(registry)) return ['registry must be an object'];
  if (registry.schema_version !== 1) fail(errors, 'schema_version must be 1');
  if (!Array.isArray(registry.changes)) fail(errors, 'changes must be an array');
  if (!Array.isArray(registry.history)) fail(errors, 'history must be an array');
  const seenIds = new Set();
  const historicalIds = new Set();

  for (const [index, change] of (registry.history || []).entries()) {
    const label = `history[${index}]`;
    if (!asObject(change) || typeof change.id !== 'string' || !CHANGE_ID.test(change.id)) {
      fail(errors, `${label}.id must be lowercase kebab-case with at least 3 characters`);
      continue;
    }
    if (historicalIds.has(change.id)) fail(errors, `${label}.id duplicates historical record ${change.id}`);
    historicalIds.add(change.id);
    if (!TERMINAL_STATUSES.has(change.status)) fail(errors, `${label}.status must be terminal`);
    if (typeof change.completed_at !== 'string' || !change.completed_at.trim()) fail(errors, `${label}.completed_at is required`);
  }

  for (const [index, change] of (registry.changes || []).entries()) {
    const label = `changes[${index}]`;
    if (!asObject(change)) {
      fail(errors, `${label} must be an object`);
      continue;
    }
    if (typeof change.id !== 'string' || !CHANGE_ID.test(change.id)) fail(errors, `${label}.id must be lowercase kebab-case with at least 3 characters`);
    if (seenIds.has(change.id)) fail(errors, `${label}.id duplicates ${change.id}`);
    if (historicalIds.has(change.id)) fail(errors, `${label}.id already exists in history`);
    seenIds.add(change.id);
    if (typeof change.owner !== 'string' || !change.owner.trim()) fail(errors, `${label}.owner is required`);
    if (!ACTIVE_STATUSES.has(change.status) && !TERMINAL_STATUSES.has(change.status)) fail(errors, `${label}.status is invalid`);
    if (typeof change.objective !== 'string' || !change.objective.trim()) fail(errors, `${label}.objective is required`);
    if (typeof change.branch !== 'string' || !BRANCH.test(change.branch)) fail(errors, `${label}.branch must follow codex/<owner>/<task>`);
    if (typeof change.worktree !== 'string' || !change.worktree.trim()) fail(errors, `${label}.worktree is required`);
    if (!asObject(change.baseline) || typeof change.baseline.git_ref !== 'string' || !change.baseline.git_ref.trim() || typeof change.baseline.recorded_at !== 'string') {
      fail(errors, `${label}.baseline requires git_ref and recorded_at`);
    }
    if (!Array.isArray(change.surfaces) || change.surfaces.length === 0) {
      fail(errors, `${label}.surfaces must contain at least one surface`);
      continue;
    }
    const localSurfaces = new Set();
    for (const [surfaceIndex, surface] of change.surfaces.entries()) {
      const surfaceLabel = `${label}.surfaces[${surfaceIndex}]`;
      if (!asObject(surface)) {
        fail(errors, `${surfaceLabel} must be an object`);
        continue;
      }
      if (!SURFACE_KINDS.has(surface.kind)) fail(errors, `${surfaceLabel}.kind is invalid`);
      if (typeof surface.id !== 'string' || !surface.id.trim()) fail(errors, `${surfaceLabel}.id is required`);
      if (!ACCESS_MODES.has(surface.access)) fail(errors, `${surfaceLabel}.access must be read or write`);
      const key = surfaceKey(surface);
      if (localSurfaces.has(key)) fail(errors, `${surfaceLabel} duplicates ${key}`);
      localSurfaces.add(key);
    }
    const writeSurfaces = change.surfaces.filter((surface) => asObject(surface) && surface.access === 'write');
    if (active(change) && writeSurfaces.length > 0 && (!asObject(change.rollback) || typeof change.rollback.summary !== 'string' || !change.rollback.summary.trim())) {
      fail(errors, `${label}.rollback.summary is required for an active write claim`);
    }
    for (const [surfaceIndex, surface] of change.surfaces.entries()) {
      if (!asObject(surface) || surface.access !== 'write' || !LIVE_SURFACE_KINDS.has(surface.kind)) continue;
      if (!asObject(surface.baseline) || typeof surface.baseline.version !== 'string' || !surface.baseline.version.trim() || typeof surface.baseline.observed_at !== 'string' || !surface.baseline.observed_at.trim() || typeof surface.baseline.checkpoint_ref !== 'string' || !surface.baseline.checkpoint_ref.trim()) {
        fail(errors, `${label}.surfaces[${surfaceIndex}].baseline requires version, observed_at and checkpoint_ref for a live write surface`);
      }
    }
    const bundles = Array.isArray(change.contract_bundles) ? change.contract_bundles : [];
    if (change.contract_bundles !== undefined) {
      if (!Array.isArray(change.contract_bundles)) {
        fail(errors, `${label}.contract_bundles must be an array`);
      } else {
        for (const [bundleIndex, bundle] of bundles.entries()) {
          const bundleLabel = `${label}.contract_bundles[${bundleIndex}]`;
          if (!asObject(bundle) || typeof bundle.id !== 'string' || !bundle.id.trim()) {
            fail(errors, `${bundleLabel}.id is required`);
            continue;
          }
          if (!Array.isArray(bundle.surfaces) || bundle.surfaces.length < 2) fail(errors, `${bundleLabel}.surfaces must reference at least two claimed surfaces`);
          if (typeof bundle.compatibility_check !== 'string' || !bundle.compatibility_check.trim()) fail(errors, `${bundleLabel}.compatibility_check is required`);
          for (const reference of bundle.surfaces || []) if (!localSurfaces.has(reference)) fail(errors, `${bundleLabel} references unclaimed surface ${reference}`);
        }
      }
    }
    const requiresBundle = writeSurfaces.length > 1 && writeSurfaces.some((surface) => LIVE_SURFACE_KINDS.has(surface.kind));
    const requiredReferences = writeSurfaces.map(surfaceKey);
    const bundleCoversAllWrites = bundles.some((bundle) => asObject(bundle) && Array.isArray(bundle.surfaces) && requiredReferences.every((reference) => bundle.surfaces.includes(reference)));
    if (requiresBundle && !bundleCoversAllWrites) {
      fail(errors, `${label} must declare a contract_bundle covering every write surface when source and a live surface change together`);
    }
  }

  const activeChanges = (registry.changes || []).filter(active);
  for (let i = 0; i < activeChanges.length; i += 1) {
    for (let j = i + 1; j < activeChanges.length; j += 1) {
      for (const left of activeChanges[i].surfaces || []) {
        for (const right of activeChanges[j].surfaces || []) {
          if (surfacesConflict(left, right)) fail(errors, `active claim conflict: ${activeChanges[i].id} and ${activeChanges[j].id} both claim ${left.kind}:${left.id} / ${right.id}`);
        }
      }
    }
  }
  return errors;
}

function usage() {
  return `Usage:\n  node scripts/coordination/change-registry.mjs init [--registry PATH]\n  node scripts/coordination/change-registry.mjs validate [--registry PATH]\n  node scripts/coordination/change-registry.mjs show [--registry PATH]\n  node scripts/coordination/change-registry.mjs claim --record PATH [--registry PATH]\n  node scripts/coordination/change-registry.mjs assert --change ID --surface KIND:ID [--registry PATH]\n  node scripts/coordination/change-registry.mjs release --change ID --status validated|integrated|deployed|cancelled --summary TEXT [--registry PATH]`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function registryPath(options) {
  const configured = options.registry || process.env.SKINCOS_CHANGE_REGISTRY || DEFAULT_REGISTRY;
  const windowsPath = /^([A-Za-z]):\\(.*)$/.exec(configured);
  if (process.platform !== 'win32' && windowsPath) {
    return path.posix.join('/mnt', windowsPath[1].toLowerCase(), ...windowsPath[2].split('\\'));
  }
  return path.resolve(configured);
}

function readRegistry(file) {
  if (!fs.existsSync(file)) throw new Error(`Registry not found: ${file}. Run the init command first.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeRegistry(file, registry) {
  registry.updated_at = new Date().toISOString();
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

function withLock(file, operation) {
  const lock = `${file}.lock`;
  try {
    fs.mkdirSync(lock);
  } catch {
    throw new Error(`Registry is locked: ${lock}. Do not delete it blindly; confirm the owning task has stopped or complete its handoff.`);
  }
  try {
    fs.writeFileSync(path.join(lock, 'owner.json'), `${JSON.stringify({ pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString() })}\n`, { mode: 0o600 });
    return operation();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function parseSurface(reference) {
  const separator = reference.indexOf(':');
  if (separator < 1 || separator === reference.length - 1) throw new Error(`Surface must be KIND:ID, got ${reference}`);
  return { kind: reference.slice(0, separator), id: reference.slice(separator + 1) };
}

function validateOrThrow(registry) {
  const errors = validateRegistry(registry);
  if (errors.length) throw new Error(`Registry validation failed:\n- ${errors.join('\n- ')}`);
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || command === '--help' || command === 'help') {
    console.log(usage());
    return;
  }
  const file = registryPath(options);
  if (command === 'init') {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify({ schema_version: 1, changes: [], history: [], created_at: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    validateOrThrow(readRegistry(file));
    console.log(`Change registry ready: ${file}`);
    return;
  }
  if (command === 'validate') {
    const registry = readRegistry(file);
    validateOrThrow(registry);
    console.log(`Change registry validation OK (${registry.changes.length} active records; ${registry.history.length} historical records): ${file}`);
    return;
  }
  if (command === 'show') {
    const registry = readRegistry(file);
    validateOrThrow(registry);
    console.log(JSON.stringify(registry, null, 2));
    return;
  }
  if (command === 'claim') {
    if (!options.record) throw new Error('--record is required for claim');
    const record = JSON.parse(fs.readFileSync(path.resolve(options.record), 'utf8'));
    withLock(file, () => {
      const registry = readRegistry(file);
      registry.changes.push(record);
      validateOrThrow(registry);
      writeRegistry(file, registry);
    });
    console.log(`Change claimed: ${record.id}`);
    return;
  }
  if (command === 'assert') {
    if (!options.change || !options.surface) throw new Error('--change and --surface are required for assert');
    const surface = parseSurface(options.surface);
    const registry = readRegistry(file);
    validateOrThrow(registry);
    const change = registry.changes.find((candidate) => candidate.id === options.change && active(candidate));
    if (!change) throw new Error(`No active change claim found for ${options.change}`);
    if (!change.surfaces.some((candidate) => candidate.kind === surface.kind && candidate.id === surface.id && candidate.access === 'write')) {
      throw new Error(`${options.change} does not own write access to ${options.surface}`);
    }
    console.log(`Ownership confirmed: ${options.change} -> ${options.surface}`);
    return;
  }
  if (command === 'release') {
    if (!options.change || !options.status || !options.summary) throw new Error('--change, --status and --summary are required for release');
    if (!TERMINAL_STATUSES.has(options.status)) throw new Error('--status must be validated, integrated, deployed or cancelled');
    withLock(file, () => {
      const registry = readRegistry(file);
      const index = registry.changes.findIndex((candidate) => candidate.id === options.change);
      if (index < 0) throw new Error(`No active change claim found for ${options.change}`);
      const [change] = registry.changes.splice(index, 1);
      registry.history.push({ ...change, status: options.status, completed_at: new Date().toISOString(), summary: options.summary });
      validateOrThrow(registry);
      writeRegistry(file, registry);
    });
    console.log(`Change released: ${options.change} (${options.status})`);
    return;
  }
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
