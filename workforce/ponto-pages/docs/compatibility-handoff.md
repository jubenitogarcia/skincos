# Ponto compatibility and handoff

## Phase 1 invariant

This package no longer claims or serves any CRM origin. Ponto publication is
isolated to the dedicated Pages projects `skincos-ponto-staging` and
`skincos-ponto`; this source-only checkout does not change DNS, routes, API
targets, secrets, cookies or databases by itself.

| Surface | Current state | Owner |
| --- | --- | --- |
| `https://skincos-ponto-staging.pages.dev` | Dedicated staging origin used by the governed synthetic journey | `skincos-ponto-staging` Pages project |
| `https://skincos-ponto.pages.dev` | Dedicated production origin used by release probes and smoke tooling | `skincos-ponto` Pages project |
| `/api/ponto/*` | Dedicated Ponto Pages Function surface only | `workforce/ponto-pages` plus `skincos-ponto-core` |
| `/api/auth/*`, `/api/insumos/health` | Owner-scoped bindings of the dedicated Ponto surface | Identity/Inventory owners |

## Required future sequence

1. Keep the distinct staging and production Pages projects, neither named
   `skincos` nor `skincos-staging`, and prove their ownership and rollback
   deployment history.
2. Provision only the approved runtime bindings through external custody.
   The Ponto proxy requires its existing Core, Identity, rollout-control and
   HMAC contracts; no binding value belongs in Git.
3. Run synthetic staging smoke for login/session/CSRF, Ponto read/write paths,
   terminal device pairing and the same-artifact rollback.
4. Use only the exact dedicated Pages origin selected by the governed release.
   A custom sibling host requires its own cookie, origin and CSRF validation
   before it can be introduced.
5. Announce and execute terminal pairing on the dedicated origin. The device token is stored under
   the browser origin, so it must not be copied or assumed to survive a host
   change.
6. Only after independent readback, make a single controlled publisher switch.
   The former CRM-hosted Ponto surface is not a rollback target.

## Rollback principle

Before the future URL switch, rollback is simply no deployment. After a
governed switch, rollback must restore the previous verified Pages deployment
or remove the new URL mapping; it must not restore old writers, bypass CSRF, or
forward device credentials through a new unreviewed proxy.
