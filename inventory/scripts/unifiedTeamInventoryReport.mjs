import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const INVENTORY_VERSION = 'unified-team-inventory-v1';

const ACTIVE_STATUSES = new Set(['ACTIVE', 'ATIVO', 'ATIVA', 'ENABLED']);
const SOURCE_DEFINITIONS = [
  { key: 'crmAccounts', source: 'CRM_ACCOUNT' },
  { key: 'crmOnboarding', source: 'CRM_ONBOARDING' },
  { key: 'workforceEmployees', source: 'WORKFORCE' },
  { key: 'escalaProfessionals', source: 'ESCALA' },
  { key: 'atendimentoProfessionals', source: 'ATENDIMENTO' },
  { key: 'pontoEmployees', source: 'PONTO' },
];

const text = (value) => String(value ?? '').trim();

function hash(value, length = 16) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function listValue(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
  } catch {
    // The legacy Escala payload can be a delimited string.
  }
  return raw.split(/[,;|]/g).map(text).filter(Boolean);
}

function rowsValue(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.rows)) return value.rows;
  return [];
}

function rawSourceValue(input, key) {
  const container = input && input.sources && typeof input.sources === 'object' ? input.sources : input;
  return container && Object.prototype.hasOwnProperty.call(container, key) ? container[key] : undefined;
}

function sourceIdFor(row) {
  return text(
    row?.sourceId ||
      row?.source_id ||
      row?.id ||
      row?.accountId ||
      row?.account_id ||
      row?.onboardingId ||
      row?.onboarding_id ||
      row?.professionalId ||
      row?.professional_id ||
      row?.employeeId ||
      row?.employee_id,
  );
}

function statusFor(row) {
  return text(row?.status || row?.accountStatus || row?.account_status || row?.scheduleStatus || row?.schedule_status).toUpperCase();
}

function unitsFor(row) {
  return [...new Set(listValue(row?.units || row?.unitIds || row?.unit_ids || row?.units_json).map((unit) => unit.toLowerCase()))].sort();
}

function workforceIdFor(row, source, sourceId) {
  if (source === 'WORKFORCE') return text(row?.workforceEmployeeId || row?.workforce_employee_id || sourceId);
  return text(row?.workforceEmployeeId || row?.workforce_employee_id);
}

function recordSubject(source, sourceId, index) {
  return 'source:' + hash(source + ':' + (sourceId || 'row-' + index), 12);
}

function workforceSubject(workforceEmployeeId) {
  return workforceEmployeeId ? 'workforce:' + hash(workforceEmployeeId, 12) : null;
}

function unitSubjects(units) {
  return units.map((unit) => 'unit:' + hash(unit, 12));
}

function makeSourceStats(source, key, present, rows) {
  return {
    source,
    key,
    present,
    scanned: rows.length,
    active: 0,
    ignored: 0,
    pending: 0,
  };
}

function projection(record) {
  return {
    source: record.source,
    subject: record.subject,
    workforceSubject: workforceSubject(record.workforceEmployeeId),
    unitSubjects: unitSubjects(record.units),
  };
}

/**
 * Builds a read-only, sanitized inventory across all identity sources.
 *
 * The input may contain names, emails and phones, but the returned report
 * contains none of them. It never links records by display data; only explicit
 * source and workforce identifiers are considered.
 */
export function buildUnifiedTeamInventoryReport(input = {}) {
  const records = [];
  const activeRecords = [];
  const pending = [];
  const ignored = [];
  const conflicts = [];
  const pendingKeys = new Set();
  const conflictKeys = new Set();
  const conflictedRecordKeys = new Set();
  const sourceStats = [];
  const missingSources = [];

  const pushPending = (item) => {
    const key = [item.source, item.subject, item.reason].join('|');
    if (pendingKeys.has(key)) return;
    pendingKeys.add(key);
    pending.push(item);
  };

  const pushConflict = (item) => {
    const key = [item.kind, item.source, item.subject, item.workforceSubject || ''].join('|');
    if (conflictKeys.has(key)) return;
    conflictKeys.add(key);
    conflictedRecordKeys.add(item.source + ':' + item.subject);
    conflicts.push(item);
  };

  for (const definition of SOURCE_DEFINITIONS) {
    const raw = rawSourceValue(input, definition.key);
    const rows = rowsValue(raw);
    const present = raw !== undefined && raw !== null;
    const stats = makeSourceStats(definition.source, definition.key, present, rows);
    sourceStats.push(stats);
    if (!present) missingSources.push(definition.source);

    rows.forEach((row, index) => {
      const sourceId = sourceIdFor(row);
      const status = statusFor(row);
      const units = unitsFor(row);
      const workforceEmployeeId = workforceIdFor(row, definition.source, sourceId);
      const record = {
        source: definition.source,
        sourceKey: definition.key,
        sourceId,
        workforceEmployeeId,
        status,
        units,
        subject: recordSubject(definition.source, sourceId, index),
        index,
      };
      records.push(record);

      if (!status) {
        stats.pending += 1;
        pushPending({ source: definition.source, subject: record.subject, reason: 'STATUS_REQUIRED' });
        return;
      }
      if (!ACTIVE_STATUSES.has(status)) {
        stats.ignored += 1;
        ignored.push({ source: definition.source, subject: record.subject, reason: 'INACTIVE_OR_HISTORICAL' });
        return;
      }

      stats.active += 1;
      if (!sourceId) {
        stats.pending += 1;
        pushPending({ source: definition.source, subject: record.subject, reason: 'SOURCE_ID_REQUIRED' });
        return;
      }
      if (!workforceEmployeeId) {
        stats.pending += 1;
        pushPending({ source: definition.source, subject: record.subject, reason: 'WORKFORCE_ID_REQUIRED' });
        return;
      }
      if (definition.source !== 'WORKFORCE' && units.length === 0) {
        stats.pending += 1;
        pushPending({
          source: definition.source,
          subject: record.subject,
          workforceSubject: workforceSubject(workforceEmployeeId),
          reason: 'UNITS_REQUIRED',
        });
        return;
      }
      activeRecords.push(record);
    });
  }

  if (missingSources.length) {
    for (const source of missingSources) {
      pushPending({ source, subject: 'source:' + hash(source, 12), reason: 'SOURCE_SNAPSHOT_REQUIRED' });
    }
  }

  const sourceGroups = new Map();
  const sourceWorkforceGroups = new Map();
  for (const record of activeRecords) {
    const sourceGroup = sourceGroups.get(record.source + ':' + record.sourceId) || [];
    sourceGroup.push(record);
    sourceGroups.set(record.source + ':' + record.sourceId, sourceGroup);

    const sourceWorkforceKey = record.source + ':' + record.workforceEmployeeId;
    const sourceWorkforceGroup = sourceWorkforceGroups.get(sourceWorkforceKey) || [];
    sourceWorkforceGroup.push(record);
    sourceWorkforceGroups.set(sourceWorkforceKey, sourceWorkforceGroup);
  }

  for (const group of sourceGroups.values()) {
    if (group.length < 2) continue;
    for (const record of group) {
      pushConflict({
        kind: 'DUPLICATE_SOURCE_ID',
        source: record.source,
        subject: record.subject,
        workforceSubject: workforceSubject(record.workforceEmployeeId),
      });
    }
  }

  for (const group of sourceWorkforceGroups.values()) {
    if (group.length < 2) continue;
    const sourceIds = new Set(group.map((record) => record.sourceId));
    if (sourceIds.size < 2) continue;
    for (const record of group) {
      pushConflict({
        kind: 'DUPLICATE_SOURCE_WORKFORCE',
        source: record.source,
        subject: record.subject,
        workforceSubject: workforceSubject(record.workforceEmployeeId),
      });
    }
  }

  const workforceRecords = records.filter((record) => record.source === 'WORKFORCE' && record.sourceId);
  const workforceById = new Map();
  for (const record of workforceRecords) {
    const group = workforceById.get(record.workforceEmployeeId) || [];
    group.push(record);
    workforceById.set(record.workforceEmployeeId, group);
  }

  for (const record of activeRecords) {
    if (record.source === 'WORKFORCE') continue;
    const canonicalRows = workforceById.get(record.workforceEmployeeId) || [];
    if (!canonicalRows.length) {
      pushConflict({
        kind: 'ORPHAN_WORKFORCE_ID',
        source: record.source,
        subject: record.subject,
        workforceSubject: workforceSubject(record.workforceEmployeeId),
      });
    } else if (canonicalRows.every((row) => !ACTIVE_STATUSES.has(row.status))) {
      pushConflict({
        kind: 'WORKFORCE_INACTIVE',
        source: record.source,
        subject: record.subject,
        workforceSubject: workforceSubject(record.workforceEmployeeId),
      });
    }
  }

  const recordsByWorkforce = new Map();
  for (const record of activeRecords) {
    const group = recordsByWorkforce.get(record.workforceEmployeeId) || [];
    group.push(record);
    recordsByWorkforce.set(record.workforceEmployeeId, group);
  }
  for (const [workforceEmployeeId, group] of recordsByWorkforce.entries()) {
    const nonEmptyUnitSets = [...new Set(group.filter((record) => record.units.length).map((record) => record.units.join('|')))];
    if (nonEmptyUnitSets.length < 2) continue;
    for (const record of group) {
      pushConflict({
        kind: 'UNIT_SCOPE_DIVERGENCE',
        source: record.source,
        subject: record.subject,
        workforceSubject: workforceSubject(workforceEmployeeId),
      });
    }
  }

  const coverageComplete = missingSources.length === 0;
  const ready = [];
  for (const record of activeRecords) {
    if (record.source === 'WORKFORCE') continue;
    const hasPending = [...pendingKeys].some((key) => key.startsWith(record.source + '|' + record.subject + '|'));
    const hasConflict = conflictedRecordKeys.has(record.source + ':' + record.subject);
    if (hasPending || hasConflict) continue;
    if (!coverageComplete) {
      pushPending({
        source: record.source,
        subject: record.subject,
        workforceSubject: workforceSubject(record.workforceEmployeeId),
        reason: 'COMPLETE_SOURCE_SNAPSHOT_REQUIRED',
      });
      continue;
    }
    ready.push(projection(record));
  }

  const fingerprintInput = {
    version: INVENTORY_VERSION,
    coverage: sourceStats.map(({ source, key, present }) => ({ source, key, present })),
    records: records.map(({ source, sourceId, workforceEmployeeId, status, units }) => ({
      source,
      sourceId,
      workforceEmployeeId,
      status,
      units,
    })),
  };

  return {
    mode: 'read-only',
    version: INVENTORY_VERSION,
    fingerprint: hash(stableStringify(fingerprintInput), 24),
    sourceCoverage: sourceStats.map(({ source, key, present }) => ({ source, key, present })),
    sourceStats,
    summary: {
      sources: SOURCE_DEFINITIONS.length,
      missingSources: missingSources.length,
      scanned: records.length,
      active: activeRecords.length,
      ignored: ignored.length,
      canonicalEmployees: workforceById.size,
      ready: ready.length,
      pending: pending.length,
      conflicts: conflicts.length,
      orphaned: conflicts.filter((item) => item.kind === 'ORPHAN_WORKFORCE_ID').length,
    },
    ready,
    pending,
    conflicts,
    ignored,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf('--input');
  const inputPath = inputIndex >= 0 ? text(args[inputIndex + 1]) : '';
  if (!inputPath) throw new Error('INPUT_REQUIRED: use --input <unified-team-inventory.json>.');
  const raw = JSON.parse(await readFile(inputPath, 'utf8'));
  console.log(JSON.stringify(buildUnifiedTeamInventoryReport(raw), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
