import { createHash } from 'node:crypto';

const HANDLE = /^@?[A-Za-z0-9._]{1,30}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function normalizedHandle(value) {
  if (typeof value !== 'string' || !HANDLE.test(value.trim())) fail('INVALID_INPUT');
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  if (!handle || handle.length > 30) fail('INVALID_INPUT');
  return handle;
}

function creatorKeyFor(handle) {
  return `creator:${createHash('sha256').update(handle, 'utf8').digest('hex').slice(0, 32)}`;
}

const INSERT = `
  INSERT INTO influencer_intelligence.creator_registry
    (creator_key, canonical_handle, registry_state, monitoring_enabled, monitoring_interval_hours)
  VALUES ($1, $2, 'candidate', false, 6)
  ON CONFLICT (creator_key) DO UPDATE
    SET canonical_handle = EXCLUDED.canonical_handle,
        updated_at = now()
  RETURNING creator_key, canonical_handle, registry_state, monitoring_enabled,
            monitoring_interval_hours, created_at, updated_at`;

export function createCreatorRegistryWriter({ queryable, clock = () => Date.now() } = {}) {
  if (!queryable || typeof queryable.query !== 'function') fail('UNAVAILABLE');
  return Object.freeze({
    async registerCreator(input = {}) {
      const handle = normalizedHandle(input.handle);
      const creatorKey = creatorKeyFor(handle);
      const result = await queryable.query(INSERT, [creatorKey, handle]);
      const row = result.rows?.[0];
      if (!row) fail('UNAVAILABLE');
      const now = new Date(clock()).toISOString();
      return {
        data: {
          creator_key: row.creator_key,
          canonical_handle: row.canonical_handle,
          registry_state: row.registry_state,
          monitoring_enabled: row.monitoring_enabled === true,
          monitoring_interval_hours: row.monitoring_interval_hours ?? 6,
        },
        data_classification: 'derived',
        freshness: 'fresh',
        retrieved_at: row.updated_at || now,
        confidence: 1,
        coverage: { available_metrics: 1, expected_metrics: 1, ratio: 1 },
        providers: [],
        provenance: [{ provider: null, source_type: 'registry', source_ref: 'db:creator_registry', observed_at: row.updated_at || now, retrieved_at: row.updated_at || now, evidence_state: 'derived' }],
        limitations: ['creator registration does not resolve or collect provider data'],
        errors: [],
      };
    },
  });
}

export const __testing = Object.freeze({ normalizedHandle, creatorKeyFor, INSERT });
