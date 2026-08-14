import { createInfluencerIntelligenceProviderRouter } from '../provider-runtime.mjs';
import { createInfluencerIntelligenceRepository } from '../repository.mjs';
import { createSnapshotOperations } from '../snapshots.mjs';

function unavailable() {
  const value = new Error('snapshot runtime is not configured');
  value.code = 'UNAVAILABLE';
  return value;
}

function safeCode(value, fallback = 'provider_failure') {
  const code = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80);
  return code || fallback;
}

function failureClassification(code) {
  if (/timeout|deadline/.test(code)) return 'timeout';
  if (/rate|thrott/.test(code)) return 'rate_limited';
  if (/5xx|upstream|service_unavailable/.test(code)) return 'upstream_5xx';
  if (/network|connection|econn/.test(code)) return 'network_transient';
  return 'permanent';
}

function runtimeConfiguration(environment) {
  const baseUrl = String(environment.INFLUENCER_INTELLIGENCE_TOKEN_VAULT_BASE_URL || '').trim();
  const apiToken = String(environment.TOKEN_VAULT_ANALYTICS_API_TOKEN || '').trim();
  const credentialRef = String(environment.INFLUENCER_INTELLIGENCE_TOKEN_VAULT_CREDENTIAL_REF || '').trim();
  if (!baseUrl || !apiToken || !credentialRef) return null;
  return { baseUrl, apiToken, credentialRef };
}

/**
 * Lazy shadow collector composition. No provider or database object is
 * created until the internal service has passed its flag, grant, and Orb
 * caller checks and the Token Vault configuration is complete. The private
 * fallback remains injectable by the existing social/instagram bridge; this
 * runtime does not start a duplicate scraper or session.
 */
export function createSnapshotBatchRunner({ getQueryable, environment = process.env, clock = () => Date.now(), fetchImpl = globalThis.fetch } = {}) {
  if (typeof getQueryable !== 'function') throw new TypeError('getQueryable is required');
  let operations;
  async function getOperations() {
    if (operations) return operations;
    const configuration = runtimeConfiguration(environment);
    if (!configuration) throw unavailable();
    const queryable = await getQueryable();
    const router = createInfluencerIntelligenceProviderRouter({ ...configuration, fetchImpl, timeoutMs: 12_000 });
    const repository = createInfluencerIntelligenceRepository({ queryable });
    operations = createSnapshotOperations({ router, repository, clock });
    return operations;
  }

  return Object.freeze({
    async run(input = {}) {
      const operationSet = await getOperations();
      const creators = Array.isArray(input.creators) ? input.creators.slice(0, 25) : [];
      const requestedAt = typeof input.requested_at === 'string' ? input.requested_at : new Date(clock()).toISOString();
      const results = [];
      for (const creator of creators) {
        for (const operation of ['snapshot_creator', 'snapshot_creator_media']) {
          const idempotencyKey = creator.idempotency_keys?.[operation] || `ii:${operation}:${creator.creator_key}:${requestedAt}`;
          const request = {
            creatorKey: creator.creator_key,
            identityKey: creator.identity_key,
            canonicalHandle: creator.canonical_handle || undefined,
            mode: 'shadow',
            observedAt: requestedAt,
            retrievedAt: new Date(clock()).toISOString(),
            bucketSeconds: 3600,
            limit: operation === 'snapshot_creator_media' ? creator.media_limit : 1,
            idempotencyKey,
            runKey: `ii:run:${idempotencyKey}`,
            correlationId: `ii:orb:${requestedAt}`,
          };
          try {
            const result = await operationSet[operation](request);
            results.push({ creator_key: creator.creator_key, operation, status: result?.status || result?.collectorRun?.status || 'completed', deduplicated: result?.deduplicated === true, coverage: result?.coverage || result?.collectorRun?.coverage || null, freshness: result?.freshness || result?.collectorRun?.freshness || null });
          } catch (caught) {
            const code = safeCode(caught?.code);
            const classification = failureClassification(code);
            results.push({ creator_key: creator.creator_key, operation, status: 'failed', failure: { code, classification, retryable: ['timeout', 'rate_limited', 'upstream_5xx', 'network_transient'].includes(classification) } });
          }
        }
      }
      const failures = results.filter((result) => result.status === 'failed').map((result) => result.failure);
      const status = failures.length === 0 ? 'completed' : failures.length === results.length ? 'failed' : 'partial';
      return {
        status,
        collectorRun: { status, coverage: { available: results.length - failures.length, expected: results.length, ratio: results.length ? (results.length - failures.length) / results.length : null }, freshness: { status: failures.length ? 'unknown' : 'fresh', observedAt: requestedAt, retrievedAt: new Date(clock()).toISOString(), ageSeconds: 0 } },
        coverage: { state: results.length ? 'available' : 'unavailable', available: results.length - failures.length, expected: results.length, ratio: results.length ? (results.length - failures.length) / results.length : null },
        freshness: { status: failures.length ? 'unknown' : 'fresh', observedAt: requestedAt, retrievedAt: new Date(clock()).toISOString(), ageSeconds: 0 },
        failures,
        results: results.slice(0, 50),
        no_provider_payload_logged: true,
        no_credentials_logged: true,
      };
    },
  });
}

export const __testing = Object.freeze({ runtimeConfiguration, failureClassification, safeCode });
