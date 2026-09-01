# Identity

Identity owns users, authentication, signed session validation, roles, scopes,
invitations and password recovery. Consumers receive only the stable actor in
`shared/identity-contract`; they do not read user tables or password hashes.

## Compatible cutover

The existing `crm_users`, `crm_invites`, `crm_password_resets` and
`crm_user_prefs` D1 tables remain in place. The repository reads their legacy
`insumos_*` names only when a prior schema is still present. No data copy,
password rehash, session-version increment or cookie-format change occurs
during extraction.

The active `/auth/*` path remains mounted by Inventory through the registered
`shared/identity-runtime` compatibility adapter. The API continues to call its
stable `shared/crm-auth` facade, which now delegates to the same Identity actor
resolver. The independent Worker cutover requires a disabled-by-default
binding/flag, staging session and recovery smoke, and a rollback to this mount.

This PR intentionally does not include or execute an Identity D1 migration. An
adoption migration may only be introduced with a separately approved staging
data-migration plan.

The legacy `/admin/users` and `/admin/invites` handlers also remain on the
Inventory Worker as an HTTP compatibility host. Invitation policy and mail are
already supplied by Identity; moving the remaining handlers behind the
independent Identity binding is a separate cutover and must not change cookies,
users, or existing sessions.

## CRM delivery preparation

`identity/delivery/crm-envelope-v1.js` is a pure, disabled-by-default helper
for the future private Identity-to-CRM delivery path. It prepares only the
minimized, unsigned `identity-crm-delivery/v1` header and claims after an
explicit caller opt-in. It does not resolve a session, read runtime
configuration, use a secret, serialize or sign a JWS, register a route, add a
Worker binding, or publish an artifact.

Until a clean installation of the exact private contracts package is proven,
this helper is only a disconnected preparation guard; it is not the canonical
wire-contract parser, serializer or compatibility proof. The future private
entrypoint must delegate those responsibilities to the published package.

The helper refuses the current username-based actor. A future additive Identity
migration must first provide a stable opaque `identitySubject` and preserve it
through creation, rename, restore and session resolution. Only after that
migration, the exact private contracts package is installed, and the CRM has a
verifier plus replay ledger may a separately deployed, non-public
`WorkerEntrypoint` sign this input through a service binding.
