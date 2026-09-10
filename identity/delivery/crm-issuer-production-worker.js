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
  // This is an externally signed release receipt, not an Identity delivery
  // envelope. The private resolver only returns it to the exact API caller;
  // the API verifies the receipt with its separate route-receipt public key.
  routeReceipt: {
    secret: 'IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT',
  },
  // R (the receipt resolver) and I (the envelope issuer) are distinct,
  // immutable versions of this private Worker. Exactly one of these flags is
  // true in each deployed version: R cannot issue, and I cannot resolve.
  roleFlags: {
    issue: 'IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED',
    routeReceiptResolver: 'IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED',
  },
});

export default { fetch: handleIdentityCrmIssuerProductionRequest };
