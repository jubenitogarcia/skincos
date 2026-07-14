# Code-scanning baseline triage for the domain move

## Scope and decision

The domain-root migration moves source without changing its implementation.
GitHub code scanning treats those paths as new code, so its external CodeQL and
Semgrep integrations reopen findings on the pull request. This file records the
evidence and intentionally does **not** dismiss, suppress, or downgrade any
finding.

The repository-native security workflow remains the merge gate. The external
findings require a separately reviewable remediation program because fixing
them within a path migration would blur ownership, risk a runtime regression,
and prevent meaningful validation.

## Rename evidence

`git diff -M90% origin/main...HEAD` reports these representative code-scanning
paths as `R100` (byte-for-byte rename):

| Current path | Previous path | Classification |
| --- | --- | --- |
| `crm/console/RichTaskManager.tsx` | `modules/crm/web/RichTaskManager.tsx` | First-party pre-existing finding |
| `website/src/lib/bookingNotifications.ts` | `modules/site-public/website/src/lib/bookingNotifications.ts` | First-party pre-existing finding |
| `orb/engine/orb-proxy/server.js` | `modules/automations/n8n/orb-proxy/server.js` | First-party pre-existing finding |
| `integration/ef/scraper_final.py` | `backend/apps/automations/scraper/scraper_final.py` | First-party pre-existing finding |
| `social/instagram/module/instagram_api_server.js` | `backend/apps/instagram/module/instagram_api_server.js` | First-party pre-existing finding |
| `messaging/channels/whatsapp/official-module/channelManager.js` | `modules/whatsapp/whatsapp/official-module/channelManager.js` | Vendored or inherited channel component |

This explains why a large structural PR opens a new scan baseline. It is not
proof that the underlying code is safe.

## Remediation tracks

1. **WhatsApp channel code:** `backend/pnpm-workspace.yaml`, bootstrap scripts,
   capabilities and the CRM orchestrator still reference the `official`,
   `official-module`, `gateway`, `stub` and `chat-module` variants. Establish
   which variant is actually reachable in production and its supported update
   cadence before changing or excluding it. Do not suppress active paths merely
   to make a scan pass.
2. **Orb and Website first-party paths:** reproduce each URL, regex, HTML and
   credential finding through its real public or service boundary; add a narrow
   regression test before changing it.
3. **CRM smoke tooling:** distinguish developer-only input from user-controlled
   production input. Keep browser smoke helpers outside a public trust boundary
   unless an actual caller proves reachability.
4. **Deprecated/duplicate channel implementations:** inventory which process
   can load each copy before retirement. Only unreachable copies may be removed
   after the active WhatsApp service and public tunnel are smoke-tested.
5. **EF agenda sync:** `EF_AGENDA_SYNC_URL` is a private runtime setting that
   transmits appointment data. Before adding a host allowlist, record the
   production and staging owners in `EF_AGENDA_SYNC_ALLOWED_HOSTS`; guessing
   that policy could silently stop the clinical sync. Until then, this finding
   is `blocked`, not suppressed.

## Fixed in this branch

- The Instagram simulator now rejects traversal-like handles before using them
  in filenames, requires an explicit constant-time administrative token, binds
  locally by default, and does not enable browser CORS without an allowlist.
- Orb Graph API helpers accept only resource paths, rejecting absolute URLs,
  query injection, and dot segments before constructing a request URL.

## Merge boundary

The domain move may proceed only after the required repository CI checks pass,
the runtime cutover checks are green, and this triage remains visible in the PR.
It does not authorize a bulk dismissal of external CodeQL or Semgrep alerts.
