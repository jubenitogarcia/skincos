import { createProviderRouter } from './provider-router.mjs';
import { createInstagrapiProvider } from './providers/instagrapi-adapter.mjs';
import { createMetaGraphProvider } from './providers/meta-graph-adapter.mjs';
import { createTokenVaultMetaGraphOperations } from './transports/token-vault-meta-graph.mjs';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Runtime composition for read-only collection. The official Meta transport
 * is always first. The existing instagrapi bridge is accepted only as an
 * injected operation set; this module never imports or starts a scraper,
 * session, simulator, or Instagram write path.
 */
export function createInfluencerIntelligenceProviderRouter({
  tokenVaultBaseUrl,
  tokenVaultApiToken,
  tokenVaultCredentialRef,
  instagrapiOperations,
  fetchImpl,
  timeoutMs,
  retryPolicy,
  circuitBreaker,
  clock,
  sleep,
} = {}) {
  const metaGraph = createMetaGraphProvider({
    operations: createTokenVaultMetaGraphOperations({
      baseUrl: tokenVaultBaseUrl,
      apiToken: tokenVaultApiToken,
      credentialRef: tokenVaultCredentialRef,
      fetchImpl,
      timeoutMs,
    }),
    adapterVersion: 'token-vault-meta-graph-adapter-v1',
  });
  const providers = { 'meta-graph': metaGraph };

  if (instagrapiOperations !== undefined) {
    if (!isRecord(instagrapiOperations)) throw new TypeError('instagrapiOperations must be an object');
    providers.instagrapi = createInstagrapiProvider({
      operations: instagrapiOperations,
      adapterVersion: 'existing-instagram-instagrapi-adapter-v1',
    });
  }

  return createProviderRouter({
    providers,
    providerOrder: ['meta-graph', 'instagrapi'],
    timeoutMs,
    retryPolicy,
    circuitBreaker,
    clock,
    sleep,
  });
}
