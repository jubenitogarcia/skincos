import { createIdentityCrmIssuerWorker } from './crm-issuer-worker-runtime.js';

/**
 * Production-capable, Identity-owned delivery surface. It is deliberately
 * disabled by the production manifest until the protected secret manager,
 * CRM caller and rollback gates are independently attested.
 *
 * The private signing key arrives only as a non-extractable Cloudflare
 * `secret_key` binding. The public key secret may contain the active key plus
 * an explicit overlap/revocation ring; the runtime signs a custody challenge
 * and verifies it against that active public key before publication.
 */
export const handleIdentityCrmIssuerProductionRequest = createIdentityCrmIssuerWorker({
  environment: 'production',
  keyIdPrefix: 'crm-production-',
  publicKeyMode: 'production-ring',
  errorCodes: {
    custody: 'IDENTITY_PRODUCTION_CUSTODY_UNAVAILABLE',
    auth: 'IDENTITY_PRODUCTION_REQUEST_AUTH_INVALID',
    crypto: 'IDENTITY_PRODUCTION_CRYPTO_UNAVAILABLE',
  },
  secretNames: {
    kid: 'IDENTITY_CRM_DELIVERY_PRODUCTION_KID',
    signingKey: 'IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY',
    publicJwk: 'IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK',
    requestHmac: 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_HMAC',
  },
  caller: {
    enabled: 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED',
    id: 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ID',
    hmac: 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_HMAC',
    expectedId: 'crm-api-production-v1',
    header: 'x-skincos-identity-issuer-caller',
    required: true,
  },
});

export default { fetch: handleIdentityCrmIssuerProductionRequest };
