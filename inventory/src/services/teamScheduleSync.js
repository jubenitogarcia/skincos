const SCHEDULE_SYNC_STATES = Object.freeze([
  'NOT_CONFIGURED',
  'PENDING',
  'SYNCED',
  'FAILED',
  'BLOCKED',
]);

const OPAQUE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const ERROR_CODE_RE = /^[A-Z0-9][A-Z0-9_:-]{1,79}$/;

function cleanText(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function parseJson(raw, fallback) {
  if (raw && typeof raw === 'object') return raw;
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isoTimestamp(value) {
  const text = cleanText(value, 40);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function normalizeScheduleSyncState(value, fallback = 'PENDING') {
  const candidate = cleanText(value, 40).toUpperCase();
  if (SCHEDULE_SYNC_STATES.includes(candidate)) return candidate;
  const normalizedFallback = cleanText(fallback, 40).toUpperCase();
  return SCHEDULE_SYNC_STATES.includes(normalizedFallback) ? normalizedFallback : 'PENDING';
}

export function normalizeScheduleSyncOperationKey(value) {
  const key = cleanText(value, 180);
  return OPAQUE_KEY_RE.test(key) ? key : '';
}

export function normalizeScheduleSyncErrorCode(value, fallback = '') {
  const normalized = cleanText(value, 80).toUpperCase();
  if (ERROR_CODE_RE.test(normalized)) return normalized;
  const normalizedFallback = cleanText(fallback, 80).toUpperCase();
  return ERROR_CODE_RE.test(normalizedFallback) ? normalizedFallback : '';
}

export function normalizeScheduleSyncResult(value, fallbackProfessionalId = '') {
  const input = value && typeof value === 'object' ? value : {};
  const state = normalizeScheduleSyncState(input.state ?? input.status, 'PENDING');
  const professionalId = cleanText(input.professionalId ?? input.professional_id ?? fallbackProfessionalId, 160);
  const errorCode = normalizeScheduleSyncErrorCode(input.errorCode ?? input.error_code);
  const attemptValue = Number(input.attempt ?? 0);
  const attempt = Number.isFinite(attemptValue) ? Math.max(0, Math.min(999, Math.trunc(attemptValue))) : 0;
  return {
    state,
    professionalId: professionalId || null,
    errorCode: errorCode || null,
    attempt,
    updatedAt: isoTimestamp(input.updatedAt ?? input.updated_at ?? input.createdAt ?? input.created_at),
  };
}

export function buildScheduleSyncRecord({ state, professionalId, errorCode, attempt = 1, createdAt } = {}) {
  const normalizedState = normalizeScheduleSyncState(state);
  const normalizedProfessionalId = cleanText(professionalId, 160);
  const normalizedErrorCode = normalizeScheduleSyncErrorCode(errorCode, normalizedState === 'FAILED' ? 'ESCALA_SYNC_FAILED' : '');
  const timestamp = isoTimestamp(createdAt) || new Date().toISOString();
  const result = normalizeScheduleSyncResult({
    state: normalizedState,
    professionalId: normalizedState === 'SYNCED' || normalizedState === 'FAILED' || normalizedState === 'BLOCKED' ? normalizedProfessionalId : '',
    errorCode: normalizedErrorCode,
    attempt,
    updatedAt: timestamp,
  });
  return {
    requestedStatus: normalizedState,
    outcome: normalizedState,
    result,
    resultJson: JSON.stringify(result),
    createdAt: timestamp,
  };
}

export function operationMemberIds(row) {
  const raw = parseJson(row?.member_ids_json ?? row?.memberIdsJson ?? row?.memberIds, []);
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map((value) => cleanText(value, 180)).filter(Boolean)));
}

export function scheduleSyncOperationMatches(row, {
  onboardingId = '',
  state = '',
  professionalId = '',
  errorCode = '',
} = {}) {
  const memberId = cleanText(onboardingId, 180);
  const requestedState = normalizeScheduleSyncState(state, 'PENDING');
  const requestedProfessionalId = cleanText(professionalId, 160) || null;
  const requestedErrorCode = normalizeScheduleSyncErrorCode(errorCode) || null;
  const result = normalizeScheduleSyncResult(parseJson(row?.result_json ?? row?.resultJson, {}));
  const ids = operationMemberIds(row);
  return String(row?.operation_type ?? row?.operationType ?? '').trim().toUpperCase() === 'ESCALA_SYNC'
    && String(row?.requested_status ?? row?.requestedStatus ?? '').trim().toUpperCase() === requestedState
    && ids.length === 1
    && ids[0] === memberId
    && result.state === requestedState
    && result.professionalId === requestedProfessionalId
    && result.errorCode === requestedErrorCode;
}

function operationCreatedAt(row) {
  const timestamp = Date.parse(String(row?.created_at ?? row?.createdAt ?? ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function latestScheduleSyncByMember(rows = []) {
  const latest = new Map();
  for (const row of rows || []) {
    if (String(row?.operation_type ?? row?.operationType ?? '').trim().toUpperCase() !== 'ESCALA_SYNC') continue;
    const result = normalizeScheduleSyncResult(parseJson(row?.result_json ?? row?.resultJson, {}));
    const entry = {
      ...result,
      operationKey: normalizeScheduleSyncOperationKey(row?.operation_key ?? row?.operationKey) || null,
      createdAt: isoTimestamp(row?.created_at ?? row?.createdAt) || result.updatedAt,
    };
    for (const memberId of operationMemberIds(row)) {
      const previous = latest.get(memberId);
      if (!previous || operationCreatedAt(row) >= operationCreatedAt({ created_at: previous.createdAt })) latest.set(memberId, entry);
    }
  }
  return latest;
}

export function fallbackScheduleSync(professionalId = '') {
  const linkedId = cleanText(professionalId, 160);
  return {
    state: linkedId ? 'SYNCED' : 'PENDING',
    professionalId: linkedId || null,
    errorCode: null,
    attempt: 0,
    updatedAt: null,
    operationKey: null,
    createdAt: null,
  };
}

export { SCHEDULE_SYNC_STATES };
