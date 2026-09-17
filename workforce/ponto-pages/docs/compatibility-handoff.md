# Ponto compatibility and handoff

## Phase 1 invariant

This repository creates no Pages project and changes no DNS, custom domain,
Cloudflare route, API target, secret, cookie, database or workflow secret. The
CRM host is owned by `jubenitogarcia/crm`; this package is source-only and has
no active Ponto publisher or URL claim. Its dedicated workflow rejects any
manual publish intent.

| Existing contract | Phase 1 state | Future dedicated-project handling |
| --- | --- | --- |
| `https://crm.skincos.com.br/?module=ponto` | Historical CRM-hosted entrypoint; not owned by this package | Choose and validate a dedicated Ponto host before publishing a redirect or new URL. |
| `/ponto-terminal.html` | Historical path only | Publish the same path on the dedicated host and guide administrators through device re-pairing. |
| `/api/ponto/*` | No active route in this package | Provision a dedicated secure gateway before enabling browser calls. |
| `/api/auth/*` | No active route in this package | Validate the cookie/Identity contract in isolated staging before allowing a sibling host. |
| `/api/insumos/health` | Source compatibility function only | Keep it narrow and owner-scoped when a dedicated host is provisioned. |

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
4. Choose and validate a dedicated host. A sibling host needs cookie, origin
   and CSRF validation before any redirect or public release.
5. Announce and execute terminal re-pairing. The device token is stored under
   the browser origin, so it must not be copied or assumed to survive a host
   change.
6. Only after independent readback, make a single controlled URL/publisher
   switch. Keep the legacy deployment available as a rollback artifact until
   the prescribed observation window closes.

## Rollback principle

Before the future URL switch, rollback is simply no deployment. After a
governed switch, rollback must restore the previous verified Pages deployment
or remove the new URL mapping; it must not restore old writers, bypass CSRF, or
forward device credentials through a new unreviewed proxy.
