import { createIdentityCrmIssuerWorker } from './crm-issuer-worker-runtime.js';

/**
 * Staging-only service-binding surface. It has no production route or data
 * binding: the config intentionally leaves routes/workers.dev disabled. The
 * private JWK and request HMAC are supplied as staging secrets at runtime;
 * neither is read from source control. Public-key publication is explicit and
 * read-only so CRM can pin the `kid`/JWK out of band before accepting tokens.
 */
export async function handleIdentityCrmIssuerStagingRequest(request, env = {}) {
  return stagingWorker(request, env);
}

const stagingWorker = createIdentityCrmIssuerWorker({
  environment: 'staging',
  keyIdPrefix: 'crm-staging-',
  errorCodes: {
    custody: 'IDENTITY_STAGING_CUSTODY_UNAVAILABLE',
    auth: 'IDENTITY_STAGING_REQUEST_AUTH_INVALID',
    crypto: 'IDENTITY_STAGING_CRYPTO_UNAVAILABLE',
  },
  caller: {
    enabled: 'IDENTITY_CRM_DELIVERY_CALLER_ENABLED',
    id: 'IDENTITY_CRM_DELIVERY_CALLER_ID',
    hmac: 'IDENTITY_CRM_DELIVERY_CALLER_HMAC',
    expectedId: 'crm-api-staging-v1',
    header: 'x-skincos-identity-issuer-caller',
  },
});

export default { fetch: stagingWorker };
