# Security remediation evidence — 2026-07-15

This record maps the reachable critical/high CodeQL findings addressed during the
native-runtime cutover. Alert numbers refer to the GitHub repository alerts as
observed on `main` before this change.

| Surface | Alerts | Classification and reachability | Remediation | Regression evidence |
| --- | --- | --- | --- | --- |
| CRM API URL construction | 4286 | Real SSRF/URL-injection path in active CRM fallback | Local origins, ports and route suffixes are selected from constants; the active provider defaults to the native WhatsApp engine and receives a private runtime overlay | CRM API suite (78 tests); invalid port/path cases |
| CRM API parsing and logs | 4217–4220, 4283, 4316, 4320–4325 | Reachable ReDoS, timer and log-format findings | Bounded linear parsing, finite timeout buckets, capped input and structured logging | CRM API suite (78 tests) |
| CRM Console rich content | 4226, 4232 | Reachable unsafe HTML rendering in authenticated UI | Rich content is converted to text/React nodes; obsolete `dangerouslySetInnerHTML` exceptions were removed | Console suite (96 tests), typecheck and production build |
| WhatsApp engine webhook | 4236 | Reachable reflected content in public Meta verification route | Constant-time token comparison, bounded inert challenge and explicit `text/plain` response | Engine security regression tests, lint and build |
| WhatsApp engine identifiers | 4299–4300 | Reachable predictable identifiers | Cryptographic UUID generation | Engine security regression tests and build |
| WhatsApp engine HTTP views | 4276–4277 | Reachable unauthenticated resource exhaustion | Per-route rate limiting for manager/static views | Engine security regression tests, lint and build |
| WhatsApp proxy and payment identifiers | 4304–4308 | Reachable insecure randomness used in proxy selection and payment references | Cryptographic `randomInt`; bounded proxy components, protocol allowlist and URL reconstruction add defense in depth | Positive/negative proxy tests, lint and build |
| Website normalization | 2541, 2544–2545 | Reachable double-decoding and regex complexity | Single-pass entity decoding and bounded linear email validation | Website suite (76 tests), typecheck and production build |
| Python WhatsApp logging | 2910 | Reachable sensitive-data fingerprint logging | Removed derived phone/message fingerprints from logs | Python syntax and unit suite (20 tests, 87.93% coverage) |
| One-off credential patch | 4317–4319 | Obsolete operational script, no consumer in runtime or repository | Removed instead of suppressing findings | Architecture and security-contract validation |

The remaining critical/high findings observed before this change were confined
to retired, unconsumed WhatsApp variants. After the hardened native engine and
CRM overlay passed production smokes, those source trees and their launch paths
were removed. The only supported implementation is now
`messaging/channels/whatsapp/engine`.

No scanner suppression, path exclusion, global ignore or alert dismissal is part
of this remediation.
