import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ACTIVE_STATUSES = new Set(['ACTIVE', 'ATIVO', 'ATIVA', 'ENABLED']);
const PLAN_VERSION = 'unified-team-identity-v1';

const text = (value) => String(value ?? '').trim();
const sql = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;
const subject = (value) => createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);

function parseList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [raw];
  } catch {
    return raw.split(/[,;|]/g).map(text).filter(Boolean);
  }
}

function activeStatus(row) {
  return text(row?.status || row?.accountStatus || row?.scheduleStatus).toUpperCase();
}

function sourceIdFor(row) {
  return text(row?.sourceId || row?.source_id || row?.professionalId || row?.professional_id || row?.id);
}

function workforceIdFor(row) {
  return text(row?.workforceEmployeeId || row?.workforce_employee_id);
}

function stableLinkId(sourceId, workforceEmployeeId) {
  return `team-link-${createHash('sha256').update(`${sourceId}\0${workforceEmployeeId}`).digest('hex').slice(0, 24)}`;
}

function normalizedExistingLinks(existingLinks) {
  return (existingLinks || []).map((link) => ({
    source: text(link?.source || 'ESCALA').toUpperCase(),
    sourceId: text(link?.sourceId || link?.source_id),
    workforceEmployeeId: workforceIdFor(link),
    reviewStatus: text(link?.reviewStatus || link?.review_status || 'PENDING_REVIEW').toUpperCase(),
  })).filter((link) => link.sourceId || link.workforceEmployeeId);
}

/**
 * Builds a read-only migration plan from an Escala inventory snapshot.
 * Names, email addresses and phones are never used to establish identity.
 */
export function buildUnifiedTeamMigrationPlan(rows = [], existingLinks = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const existing = normalizedExistingLinks(existingLinks);
  const existingBySource = new Map();
  const existingByWorkforce = new Map();
  for (const link of existing) {
    if (link.sourceId) existingBySource.set(`${link.source}:${link.sourceId}`, link);
    if (link.workforceEmployeeId) {
      const prior = existingByWorkforce.get(link.workforceEmployeeId);
      if (prior && `${prior.source}:${prior.sourceId}` !== `${link.source}:${link.sourceId}`) {
        existingByWorkforce.set(link.workforceEmployeeId, { ...prior, conflict: true });
      } else {
        existingByWorkforce.set(link.workforceEmployeeId, link);
      }
    }
  }

  const ignored = [];
  const pending = [];
  const conflicts = [];
  const candidates = [];
  for (const row of sourceRows) {
    const sourceId = sourceIdFor(row);
    const workforceEmployeeId = workforceIdFor(row);
    const rowSubject = subject(`${sourceId}|${text(row?.name || row?.professionalName)}`);
    if (!ACTIVE_STATUSES.has(activeStatus(row))) {
      ignored.push({ subject: rowSubject, reason: 'INACTIVE_OR_HISTORICAL' });
      continue;
    }
    if (!sourceId) {
      pending.push({ subject: rowSubject, reason: 'SOURCE_ID_REQUIRED' });
      continue;
    }
    if (!workforceEmployeeId) {
      pending.push({ subject: rowSubject, sourceId, reason: 'WORKFORCE_ID_REQUIRED' });
      continue;
    }
    candidates.push({
      subject: rowSubject,
      source: 'ESCALA',
      sourceId,
      workforceEmployeeId,
      units: parseList(row?.units || row?.units_json),
      role: text(row?.role || row?.scheduleRole),
      shift: text(row?.shift || row?.scheduleShift),
    });
  }

  const bySource = new Map();
  const byWorkforce = new Map();
  const duplicateSourceKeys = new Set();
  const duplicateWorkforceKeys = new Set();
  for (const candidate of candidates) {
    const sourceKey = `${candidate.source}:${candidate.sourceId}`;
    const workforceKey = candidate.workforceEmployeeId;
    if (bySource.has(sourceKey)) {
      duplicateSourceKeys.add(sourceKey);
      conflicts.push({ subject: candidate.subject, sourceId: candidate.sourceId, reason: 'DUPLICATE_SOURCE_ID' });
    } else {
      bySource.set(sourceKey, candidate);
    }
    if (byWorkforce.has(workforceKey)) {
      duplicateWorkforceKeys.add(workforceKey);
      conflicts.push({ subject: candidate.subject, sourceId: candidate.sourceId, workforceEmployeeId: workforceKey, reason: 'DUPLICATE_WORKFORCE_ID' });
    } else {
      byWorkforce.set(workforceKey, candidate);
    }
  }

  const duplicateSubjects = new Set(conflicts.map((item) => item.subject));
  const ready = [];
  const noop = [];
  for (const candidate of candidates) {
    const sourceKey = `${candidate.source}:${candidate.sourceId}`;
    if (duplicateSubjects.has(candidate.subject) || duplicateSourceKeys.has(sourceKey) || duplicateWorkforceKeys.has(candidate.workforceEmployeeId)) continue;
    const existingSource = existingBySource.get(sourceKey);
    const existingWorkforce = existingByWorkforce.get(candidate.workforceEmployeeId);
    if (existingWorkforce?.conflict || (existingWorkforce && `${existingWorkforce.source}:${existingWorkforce.sourceId}` !== sourceKey)) {
      conflicts.push({ subject: candidate.subject, sourceId: candidate.sourceId, workforceEmployeeId: candidate.workforceEmployeeId, reason: 'EXISTING_WORKFORCE_LINK_CONFLICT' });
      continue;
    }
    if (existingSource && existingSource.workforceEmployeeId !== candidate.workforceEmployeeId) {
      conflicts.push({ subject: candidate.subject, sourceId: candidate.sourceId, reason: 'EXISTING_SOURCE_LINK_CONFLICT' });
      continue;
    }
    if (existingSource?.reviewStatus && existingSource.reviewStatus !== 'CONFIRMED') {
      pending.push({ subject: candidate.subject, sourceId: candidate.sourceId, workforceEmployeeId: candidate.workforceEmployeeId, reason: 'EXISTING_LINK_REVIEW_REQUIRED' });
      continue;
    }
    if (existingSource?.workforceEmployeeId === candidate.workforceEmployeeId) {
      noop.push({ subject: candidate.subject, sourceId: candidate.sourceId, workforceEmployeeId: candidate.workforceEmployeeId, reason: 'ALREADY_LINKED' });
      continue;
    }
    ready.push(candidate);
  }

  const plan = {
    version: PLAN_VERSION,
    summary: {
      scanned: sourceRows.length,
      active: candidates.length,
      ignored: ignored.length,
      ready: ready.length,
      noop: noop.length,
      pending: pending.length,
      conflicts: conflicts.length,
    },
    ready,
    noop,
    pending,
    conflicts,
    ignored,
  };
  plan.fingerprint = createHash('sha256').update(JSON.stringify({ version: plan.version, ready: plan.ready, pending: plan.pending, conflicts: plan.conflicts })).digest('hex');
  return plan;
}

export function buildUnifiedTeamIdentityLinkSql(item, now = new Date().toISOString()) {
  if (!item?.sourceId || !item?.workforceEmployeeId) throw new Error('MIGRATION_LINK_IDENTIFIERS_REQUIRED');
  const linkId = stableLinkId(item.sourceId, item.workforceEmployeeId);
  const metadata = JSON.stringify({ planVersion: PLAN_VERSION, fingerprintSubject: item.subject || null, units: item.units || [], role: item.role || null, shift: item.shift || null });
  return `INSERT OR IGNORE INTO crm_employee_identity_links (id, workforce_employee_id, source, source_id, match_method, confidence, review_status, metadata_json, created_by, created_at) VALUES (${sql(linkId)}, ${sql(item.workforceEmployeeId)}, 'ESCALA', ${sql(item.sourceId)}, 'EXPLICIT_WORKFORCE_ID', 'HIGH', 'CONFIRMED', ${sql(metadata)}, 'system:unified-team-dry-run', ${sql(now)});`;
}

export function buildUnifiedTeamMigrationSql(plan, now = new Date().toISOString()) {
  const statements = (plan?.ready || []).map((item) => buildUnifiedTeamIdentityLinkSql(item, now));
  if (!statements.length) return '-- No safe identity links are ready; pending and conflict rows require review.\n';
  return ['BEGIN;', ...statements, 'COMMIT;'].join('\n');
}

function publicPlan(plan) {
  return {
    mode: 'dry-run',
    version: plan.version,
    fingerprint: plan.fingerprint,
    summary: plan.summary,
    ready: plan.ready.map(({ subject: rowSubject, sourceId, workforceEmployeeId, units, role, shift }) => ({ rowSubject, sourceId, workforceEmployeeId, units, role, shift })),
    noop: plan.noop,
    pending: plan.pending,
    conflicts: plan.conflicts,
    ignored: plan.ignored,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf('--input');
  const inputPath = inputIndex >= 0 ? text(args[inputIndex + 1]) : '';
  if (!inputPath) throw new Error('INPUT_REQUIRED: use --input <escala-inventory.json>.');
  const raw = JSON.parse(await readFile(inputPath, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw?.rows || raw?.professionals || [];
  const existingLinks = Array.isArray(raw) ? [] : raw?.existingLinks || raw?.existing_links || [];
  const plan = buildUnifiedTeamMigrationPlan(rows, existingLinks);
  console.log(JSON.stringify(publicPlan(plan), null, 2));
  if (args.includes('--emit-sql')) {
    console.log('\n-- SQL PREVIEW (review before any controlled apply)\n');
    console.log(buildUnifiedTeamMigrationSql(plan));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
