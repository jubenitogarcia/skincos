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
5. **EF agenda sync:** the client reconstructs outbound URLs only for the
   canonical `https://espacofacial.com/api/agenda/sync` endpoint. A staging
   host is blocked unless it is explicitly configured in the private
   `EF_AGENDA_SYNC_ALLOWED_HOSTS` setting; the policy rejects IP literals,
   credentials, query/fragment, non-HTTPS schemes, non-standard ports and
   alternate paths. Regression coverage lives beside the EF client.

## Fixed in this branch

- The Instagram simulator now rejects traversal-like handles before using them
  in filenames, requires an explicit constant-time administrative token, binds
  locally by default, and does not enable browser CORS without an allowlist.
- Orb Graph API helpers accept only resource paths, rejecting absolute URLs,
  query injection, and dot segments before constructing a request URL.

## Remediation wave: 2026-07-14

The following alerts were handled from their individual GitHub instances. The
private evidence bundle records the alert number, path, ref and exact sink;
this table records the source-control outcome without copying credentials,
clinical data or request payloads into Git.

| Alert IDs | Classification | Outcome |
| --- | --- | --- |
| CodeQL `#4285`–`#4289` | First-party reachable CRM Unified System facade | Fixed by constraining channels, ports and paths; regression tests are part of `crm/api` test. |
| CodeQL `#4290`–`#4295` | First-party reachable WhatsApp media and webhook requests | Fixed with HTTPS-only public destination validation, DNS private-address rejection, no redirects and authenticated webhook management. |
| CodeQL `#4344`–`#4345` | First-party gateway query input | Fixed by accepting only scalar, normalized WhatsApp IDs. |
| CodeQL `#2542`–`#2543` | First-party GBP diagnostics resource path | Fixed by accepting only numeric account/location identifiers after diagnostics authentication. |
| CodeQL `#4341`–`#4343` | First-party credentialed CRM CORS | Fixed with explicit origins; origin reflection is removed. |
| CodeQL `#4239` | First-party CRM WhatsApp media URL | Fixed by accepting only parsed HTTPS `mmg.whatsapp.net` URLs or fixed-origin direct paths. |
| CodeQL `#4255`–`#4267` | First-party CRM API exhaustion surface | Fixed with an API-wide `express-rate-limit` middleware; no sensitive route is skipped. |
| CodeQL `#108` | First-party command injection | Source fix is integrated; an analysis from the current `main` revision is required before the historic instance is considered closed. |
| CodeQL `#164`–`#177`, `#124`–`#125` | Historical moved paths | The recorded `backend/apps/**` paths are absent from the canonical tree. They remain open only until a current scan replaces historical instances; no path exclusion was added. |

### WhatsApp dependency remediation: 2026-07-15

The active WhatsApp engine keeps link-preview retrieval disabled by default and
requires an explicit private `ENABLE_LINK_PREVIEW_FETCH=true` opt-in. The
engine has no first-party import of `link-preview-js`; it is retained only as a
Baileys peer dependency. The lockfile now resolves that peer to `4.0.1`, the
first patched release for the reported SSRF issue, while the public request
path remains disabled by default. Axios is pinned and overridden to `1.18.1`
so the transitive Axios copy requested by the Chatwoot SDK cannot reintroduce
the high-severity SSRF/prototype-pollution advisories. `npm ci --ignore-scripts`
and `npm audit --omit=dev --audit-level=high` are release gates for this
package; the latter reports zero high or critical findings for the resulting
production dependency graph. No scanner exclusion or suppression was added.

### Current-analysis requirement

The CodeQL workflow formerly did not trigger on `crm/api`, `messaging`, `orb`
or the other root domains. It now does, and it supports `workflow_dispatch`.
After the coverage change reaches `main`, trigger the workflow against `main`,
then inspect each remaining alert instance at that ref. A finding may be marked
historical only when its recorded path is absent and no current-ref instance is
open; a finding in a current active path remains a remediation task.

## Merge boundary

The domain move may proceed only after the required repository CI checks pass,
the runtime cutover checks are green, and this triage remains visible in the PR.
It does not authorize a bulk dismissal of external CodeQL or Semgrep alerts.
