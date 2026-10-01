# Identity to CRM production readiness

This document records the production gate for the Identity-owned
`identity-crm-delivery/v1` issuer. It is a readiness contract, not a production
deployment instruction.

## Owner and current state

Identity remains the only owner of the issuer, signing-key lifecycle, public-key
publication, release artifact and rollback. CRM is only the consumer: it must
verify the delivery envelope and atomically reserve the `jti` before business
handling. Identity must not be copied into the CRM repository.

The source tree contains a staging Worker and a production-capable candidate at
`identity/delivery/crm-issuer-production-worker.js` with
`identity/wrangler.production.toml`. The candidate is disabled, has no route or
data binding, and is not deployed by CI. A production Worker deployment,
durable key-custody adapter, persistent CRM caller and production replay
readback are not proven by the repository alone. The existing Inventory
authentication Worker and its `IDENTITY_PII_KEY` are a different runtime and do
not satisfy this gate.

The canonical future Worker name is
`skincos-identity-crm-delivery-production`; staging remains
`skincos-identity-crm-delivery-staging`. No production Worker, route, secret or
deployment is created by the readiness workflow.

## Fixed delivery contract

The private `@jubenitogarcia/skincos-identity-contracts` package remains pinned
by Identity. The readback report records these invariants without reading any
private package or secret value:

| Field | Required value |
| --- | --- |
| version | `identity-crm-delivery/v1` |
| issuer | `skincos-identity` |
| audience | `skincos-crm-core` |
| algorithm / type | `EdDSA` / `skincos-identity-delivery+jws` |
| subject | opaque `idn:` Identity subject only |
| target | canonical `/api/crm...` path |
| lifetime | at most 60 seconds |
| replay | CRM-owned atomic single-use `jti` ledger |

The issuer computes the body digest from the request bytes. It never accepts a
caller-supplied digest, username, email, cookie, session or other PII in the
signing input.

## Read-only external audit

Run `Identity CRM delivery production readiness` manually from the protected
`production` environment. The workflow uses only Cloudflare `GET` requests for
the production Worker settings, deployments, secret-name inventory, public
subdomain state, every zone's route inventory, and the account-wide custom
domain inventory. The audit fails closed if any inventory cannot be read; a
single configured zone cannot narrow that check.
It writes a sanitized JSON artifact containing no token, key, secret value or
PII. `strict=false` records a blocked result without failing the workflow;
`strict=true` fails unless every gate is externally attested.

The inventory names checked by the report are scoped to the future production
Worker and are not provisioning instructions:

- `IDENTITY_CRM_DELIVERY_PRODUCTION_KID`
- `IDENTITY_CRM_DELIVERY_PRODUCTION_PRIVATE_JWK`
- `IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK`
- `IDENTITY_CRM_DELIVERY_PRODUCTION_REQUEST_HMAC`

Private key material must remain in an approved Identity-owned custody adapter.
It must never be placed in Git, the CRM repository, logs or the readback
artifact. If production custody does not safely support the staging JWK shape,
the production runtime must use the reviewed signer adapter instead of adding a
secret merely to satisfy this inventory.

## Gates before any production cutover

1. A production Worker exists under the canonical Identity owner and has an
   immutable deployment baseline with a tested rollback artifact.
2. The Worker has no public `workers.dev` or preview access, public zone route,
   or custom domain. CRM access is private and authenticated; the staging public
   endpoint is not a production precedent.
3. Identity has a durable non-exportable key custody/registry reference and a
   documented active/overlap/revoked rotation window. Public keys are published
   and pinned by CRM by `kid`.
4. CRM has a persistent caller adapter owned by CRM, with the exact request
   contract and least-privilege authentication. A one-off local caller is not
   evidence.
5. CRM has an atomic replay ledger, and synthetic staging proves valid, expired,
   wrong-audience, wrong-target, body-mismatch and duplicate-`jti` behavior.
6. A same-artifact staging smoke, release receipt and rollback rehearsal exist;
   only then may a separately reviewed cutover be considered.

The readiness report intentionally remains `blocked` until these external
facts are attested. This prevents an empty or accidentally reused staging
secret from being mistaken for production Identity ownership.
