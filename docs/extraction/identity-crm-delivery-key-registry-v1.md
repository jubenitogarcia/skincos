# Identity CRM delivery key registry v1

This is the versioned, public-only key-state contract published by the
Identity CRM-delivery runtime. It supplements, but does not change, the
compact-envelope contract `identity-crm-delivery/v1`.

It is source-only until a separately approved staging or production release
enables the Identity service surface. This document neither provisions a
secret nor authorizes a route, deploy, database change, or legacy fallback.

## Publication endpoint and document

When the issuing surface is explicitly enabled, the runtime serves only `GET`
and `HEAD` at:

```
/.well-known/identity-crm-delivery/v1/key-registry
```

`GET` returns `Cache-Control: no-store` and this exact JSON shape. The
ellipses below are descriptive placeholders, not literal values.

```json
{
  "version": "identity-crm-delivery/key-registry/v1",
  "environment": "production",
  "active": {
    "kid": "crm-production-identity-2026-10",
    "jwk": {
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "base64url-encoded-32-byte-public-key",
      "alg": "EdDSA",
      "use": "sig"
    }
  },
  "overlap": [
    {
      "kid": "crm-production-identity-2026-09",
      "jwk": {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": "base64url-encoded-32-byte-public-key",
        "alg": "EdDSA",
        "use": "sig"
      },
      "notAfter": 1800000000
    }
  ],
  "revoked": ["crm-production-identity-2026-08"]
}
```

All object fields are mandatory and exact. A public JWK has exactly `kty`,
`crv`, `x`, `alg` and `use`; `d`, private-key fields, alternate algorithms and
unknown fields are invalid. `kid` must begin with `crm-staging-` or
`crm-production-` for the declared environment. The same `kid` cannot appear
twice or in more than one status. `active` can never be revoked. An overlap
key must have an integer `notAfter` strictly after the validation time.

The runtime signs only with `active`. `active` and non-expired `overlap` are
the only verification keys it can publish. `revoked` contains only key IDs: it
has no public JWK and is never an eligible issuer or verifier key. Any invalid
or stale state fails the publication/issuance surface closed.

The existing endpoint
`/.well-known/identity-crm-delivery/v1/keys` remains unchanged for
compatibility. It contains only the active plus valid overlap JWKs and does
not carry status. A status-aware CRM consumer must use this registry contract,
not infer revocation from the legacy key list.

## Required consumer behavior

CRM Core must consume the document only in a controlled promotion or bootstrap
step, then pin the resulting verification registry in its own immutable
runtime configuration. It must **not** fetch this endpoint during a CRM
business request, follow a dynamic JWKS URL, or fall back to the legacy key
list when this registry is unavailable or invalid.

Before accepting a promoted registry, the consumer must require all of the
following:

1. Exact `version` `identity-crm-delivery/key-registry/v1` and its own exact
   environment.
2. Exact JWK shape and Ed25519/EdDSA parameters; no private fields or unknown
   fields.
3. A single, non-revoked active `kid`; unique environment-prefixed key IDs;
   and overlap entries whose `notAfter` is still in the future.
4. A verification lookup that accepts only the promoted active key or an
   unexpired promoted overlap key, and explicitly rejects every promoted
   revoked `kid` and every unknown `kid`.
5. The existing envelope checks before business handling: `alg=EdDSA`, fixed
   issuer/audience, opaque subject, canonical method/target/body digest,
   expiration/skew, Ed25519 signature, and the CRM-owned atomic replay
   reservation for `jti`.

If the registry cannot be read, parsed, pinned, or validated, the promotion
must stop and the CRM request path must fail closed rather than accept a
browser-provided envelope, an unpinned key, or a legacy authorization path.

## Rotation and revocation sequence

1. Put a new custody-held key in `active`; retain the previous active key in
   `overlap` with a finite `notAfter` that exceeds the final envelope that it
   could have signed.
2. Promote and read back the new registry to every CRM verifier before relying
   on the new key; the issuer continues to use only `active`.
3. After the overlap window, remove the old key from eligible verifier state.
   If it is compromised or intentionally retired, add only its `kid` to
   `revoked`; never republish its JWK or re-add it as overlap.
4. Do not revoke the active key in place. Rotate to a valid replacement first;
   an active/revoked collision is intentionally fail-closed.

The source implementation and tests use synthetic keys only. Key creation,
custody, deployment, consumer pinning, staging proof and any production
cutover remain externally governed operations.
