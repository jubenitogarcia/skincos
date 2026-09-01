# CRM repository transition: pre-cut handoff

## Status and canonical locations

The reviewed legacy source snapshot is
`jubenitogarcia/skincos@43ca74135eea42bbfd93be5a52288a151192c211`.
The dedicated source-only repository is
[`jubenitogarcia/skincos-crm-core`](https://github.com/jubenitogarcia/skincos-crm-core),
with the normal local Codex project at
`C:\CodexShared\Projetos\skincos-crm-core`.

This is a **pre-cut handoff**, not a runtime migration. The new repository
contains only `api/core`, `apps/core-console`, contracts, source-only tests,
docs and empty operational declarations. Its Core artifacts were authored
there; the composed legacy implementation was not copied or preserved in its
active history.

## Incumbent owner remains this monorepo

Until a separately evidenced cutover, this repository remains the only
operational owner of:

- `crm/console/` and `crm/api/`, including the composed server and its tests;
- `.github/workflows/crm-codeql.yml`,
  `.github/workflows/deploy-crm-pages.yml`, and
  `scripts/github-actions/affected-crm-validation-scope.mjs`;
- existing Pages/API publisher configuration, Cloudflare bindings, runtime
  services, secrets, variables, routing, data stores and rollback lineage.

No deploy, secret, variable, flag, grant, database, migration, route or
Cloudflare resource moved in this handoff. The selective monorepo CodeQL and
deploy workflows deliberately remain unchanged so the incumbent runtime stays
covered and has exactly one publisher.

## Known boundary work before real removal

The legacy module is not yet autonomously movable. Examples that must become
local implementation, versioned contracts, or explicit owner adapters before
a removal PR include:

- `crm/console/insumosUnitAccess.ts` importing the shared identity contract;
- `crm/console/tests/clientCommercialAssistedWhatsapp.test.ts` reading a
  repository-root runbook;
- `crm/api/scripts/run.sh` sourcing `backend/scripts/env.sh`;
- `crm/api/server.js` relying on root/backend paths, capabilities and Python
  jobs;
- inbound Inventory tests, WhatsApp adapter boundaries, backend bootstrap/E2E
  and Finance-related checks that still read CRM implementation paths.

## Evidence required before a cutover/removal PR

1. Grant only `jubenitogarcia/skincos-crm-core` read access to the exact
   Identity contract package in GitHub Actions, then prove a clean install with
   the repository `GITHUB_TOKEN` and a signed, replay-safe actor envelope.
2. Establish a dedicated empty CRM staging store, additive migration lineage,
   data-ownership ledger and synthetic-only projection/backfill proof.
3. Produce one CRM-owned staging artifact with an isolated `/crm/*` route and
   exactly one publisher; prove that no Inventory fallback or incumbent
   publisher can serve the same route.
4. Capture a synthetic smoke artifact and an executable rollback for that same
   immutable release.
5. In a separately reviewed change, retire legacy source/publishers only after
   all ownership, observability and rollback receipts are attached.

## Rollback

This handoff changes no incumbent runtime behavior. If the dedicated Core
repository is unavailable or a future gate fails, continue operating solely
from the monorepo and leave every legacy publisher, data store and route in
place. Do not use a destructive data rollback or a second publisher.
