# Ponto compatibility and handoff

## Phase 1 invariant

This repository change creates no Pages project and changes no DNS, custom
domain, Cloudflare route, API target, secret, cookie, database, workflow secret,
or user-facing URL. The legacy `skincos` Pages project continues to serve Ponto.
The new package has no deploy command and its dedicated workflow rejects any
manual publish intent.

| Existing contract | Phase 1 state | Future dedicated-project handling |
| --- | --- | --- |
| `https://crm.skincos.com.br/?module=ponto` | Unchanged and still canonical | Serve the Ponto client from a separate host only after an approved client handoff or a narrowly scoped compatibility redirect. |
| `/ponto-terminal.html` | Unchanged and still canonical | Publish the same path on the dedicated host; guide administrators through device re-pairing. |
| `/api/ponto/*` | Unchanged on the legacy origin | Keep the existing secure Pages gateway contract. Do not replace it with a browser-to-API call or a generic worker proxy. |
| `/api/auth/*` | Unchanged on the legacy origin | Validate the shared `.skincos.com.br` cookie contract in isolated staging before allowing a sibling host. |
| `/api/insumos/health` | Unchanged on the legacy origin | The dedicated package only reads this narrow health endpoint for unit labels. |

The pure `src/legacyHandoff.ts` helper records the candidate mapping and is not
wired to browser navigation, a Function, or a Worker. It exists so that a later
change can test exactly what would change instead of silently taking over a
URL.

## Required future sequence

1. Create distinct staging and production Pages projects, neither named
   `skincos` nor `skincos-staging`, and prove their ownership and rollback
   deployment history.
2. Provision only the approved runtime bindings through external custody.
   The Ponto proxy requires its existing Core, Identity, rollout-control and
   HMAC contracts; no binding value belongs in Git.
3. Run synthetic staging smoke for login/session/CSRF, Ponto read/write paths,
   terminal device pairing and the same-artifact rollback.
4. Choose and validate a dedicated host without changing the legacy URL. A
   sibling host needs cookie, origin and CSRF validation before any redirect.
5. Announce and execute terminal re-pairing. The device token is stored under
   the browser origin, so it must not be copied or assumed to survive a host
   change.
6. Only after independent readback, make a single controlled URL/publisher
   switch. Keep the legacy deployment available as a rollback artifact until
   the prescribed observation window closes.

## Rollback principle

Before the future URL switch, rollback is simply no deployment: the legacy
Ponto surface remains active. After a governed switch, rollback must restore the
previous verified Pages deployment or remove the new URL mapping; it must not
restore old writers, bypass CSRF, or forward device credentials through a new
unreviewed proxy.
