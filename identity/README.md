# Identity

Identity owns users, authentication, signed session validation, roles, scopes,
invitations and password recovery. Consumers receive only the stable actor in
`shared/identity-contract`; they do not read user tables or password hashes.

## Identity ownership and external CRM contract

The existing `crm_users`, `crm_invites`, `crm_password_resets` and
`crm_user_prefs` D1 tables remain in place. The repository reads their legacy
`insumos_*` names only when a prior schema is still present. No data copy,
password rehash, session-version increment or cookie-format change occurs
during extraction.

The active `/auth/*` path remains mounted by Inventory through the registered
`shared/identity-runtime` compatibility adapter. The API continues to call its
stable `shared/identity-auth` facade, which delegates to the same Identity actor
resolver. The independent CRM consumes only the versioned Identity delivery
contract; it does not import this source tree or share its cookies, tables or
secrets.

This preparation includes an additive, unapplied Identity subject migration for
the shared `crm_users` table. It does not execute the migration, alter a live
D1 database, or activate delivery. Applying it still requires a separately
approved staging data-migration plan, a synthetic smoke and a tested rollback
decision before any production consideration.

The legacy `/admin/users` and `/admin/invites` handlers also remain on the
Inventory Worker as an HTTP compatibility host. Invitation policy and mail are
already supplied by Identity; moving the remaining handlers behind the
independent Identity binding is a separate cutover and must not change cookies,
users, or existing sessions.

## CRM delivery contract (Identity-owned)

`identity/delivery/crm-envelope-v1.js` is a pure helper for the private
Identity-to-CRM delivery contract. It prepares only the
minimized, unsigned `identity-crm-delivery/v1` header and claims after an
explicit caller opt-in. It does not resolve a session, read runtime
configuration, use a secret, serialize or sign a JWS, register a route, add a
Worker binding, or publish an artifact.

`identity/delivery/crm-issuer-v1.js` provides the source-level issuer boundary
for an Identity-owned private WorkerEntrypoint. It has no route, binding, D1
write or secret configuration in this repository. An authorized external
runtime may enable it with the exact pinned
`@jubenitogarcia/skincos-identity-contracts/identity-crm-delivery` package is
the default canonical owner of signing-input validation. An explicit contract
adapter is supported only for isolated tests and must expose the same fixed
version, issuer, audience, algorithm and validators. Identity supplies only a
signer callback backed by a non-exportable Ed25519 key held in external
custody; private key bytes, PEM/JWK material and secrets are rejected by the
key-ring boundary and are never stored in the CRM repository or Git.

The issuer accepts the authenticated actor plus the exact method, canonical
target and body bytes. It computes `SHA-256(body)` itself before producing the
claims, so a caller cannot sign a digest for a different request. The actor is
projected to `identitySubject`, `role` and sorted scopes; username, email,
display name, cookies, sessions and compatibility aliases never enter the
signing input.

The included key-ring state machine is for synthetic tests and local contract
integration only. It exercises active-key selection, overlap during rotation,
revocation and fail-closed behavior. A deployable Identity runtime still needs
a durable key registry/custody adapter, a real Ed25519 signing key, public-key
publication for the CRM verifier and an operational rollback/rotation window.
An optional issuer replay reservation can reject duplicate `jti` values after a
successful signature, but it does not replace the CRM-owned atomic replay
ledger required before business handling.

The Identity package pins the exact private contracts package version and
integrity in `identity/package-lock.json`; local validation installs that
lockfile from GitHub Packages before running the issuer tests. The helper is
not a CRM runtime: any deployment, key custody, public-key publication or
service binding is an external Identity operation.

`identity/delivery/crm-issuer-production-worker.js` and
`identity/wrangler.production.toml` provide an optional production-capable
source surface. The manifest has no route or data binding in this repository
and is not a CRM publisher. If an Identity owner enables it externally, the Worker accepts only the production
`crm-production-` key-id prefix, reads its externally held Ed25519 signing key
and caller HMAC from runtime secrets, and publishes the versioned active,
overlap and revoked-key status required for controlled CRM pinning. The
public-key ring rejects duplicate, revoked, expired or cross-environment keys;
the CRM consumer's atomic replay ledger remains mandatory. See
`docs/extraction/identity-crm-delivery-key-registry-v1.md` for the exact
publication and consumer contract; the legacy flat public-key list remains
available only for compatibility and is not enough to convey revocation.

Production custody, deployment and rollback are external operational concerns;
no CRM deployment or production secret is configured by this repository.

The helper refuses the current username-based actor. A future additive Identity
migration must first provide a stable opaque `identitySubject` and preserve it
through creation, rename, restore and session resolution. Only after that
migration, the exact private contracts package is installed, and the CRM has a
verifier plus replay ledger may a separately deployed, non-public
`WorkerEntrypoint` sign this input through a service binding.
