import { createIdentityCrmIssuerWorker } from './crm-issuer-worker-runtime.js';

/**
 * Production-capable, Identity-owned delivery surface. It is deliberately
 * disabled by the production manifest until the protected secret manager,
 * CRM caller and rollback gates are independently attested.
 *
 * The private JWK is accepted only from the runtime secret environment and is
 * imported as a non-extractable Ed25519 signing key. The public key secret may
 * contain the active key plus an explicit overlap/revocation ring; the ring is
 * validated before publication so an active or expired key cannot be served.
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
    privateJwk: 'IDENTITY_CRM_DELIVERY_PRODUCTION_PRIVATE_JWK',
    publicJwk: 'IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK',
    requestHmac: 'IDENTITY_CRM_DELIVERY_PRODUCTION_REQUEST_HMAC',
  },
});

export default { fetch: handleIdentityCrmIssuerProductionRequest };
