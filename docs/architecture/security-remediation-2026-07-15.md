# Security remediation evidence (historical legacy runtime) — 2026-07-15

This is an archival record from before the CRM extraction. The CRM API and
Console rows below refer to source that has since been removed from this
monorepo; they are not current runtime surfaces or release gates.

This record maps the reachable critical/high CodeQL findings addressed during the
native-runtime cutover. Alert numbers refer to the GitHub repository alerts as
observed on `main` before this change.

| Surface | Alerts | Classification and reachability | Remediation | Regression evidence |
| --- | --- | --- | --- | --- |
| Retired CRM API URL construction | 4286 | Historical SSRF/URL-injection path in the removed CRM fallback | The legacy runtime was removed; the current gateway accepts only the external, version-pinned CRM contract | Architecture and gateway contract tests |
| Retired CRM API parsing and logs | 4217–4220, 4283, 4316, 4320–4325 | Historical ReDoS, timer and log-format findings in removed source | The legacy runtime and its launch paths were removed; no equivalent source is reachable here | Architecture and dependency-closure tests |
| Retired CRM Console rich content | 4226, 4232 | Historical unsafe HTML rendering in the removed authenticated UI | The legacy Console was removed from this repository; current HTML exceptions are limited to Website files listed in the active allowlist | JavaScript exception and Website tests |
| WhatsApp engine webhook | 4236 | Reachable reflected content in public Meta verification route | Constant-time token comparison, bounded inert challenge and explicit `text/plain` response | Engine security regression tests, lint and build |
| WhatsApp engine identifiers | 4299–4300 | Reachable predictable identifiers | Cryptographic UUID generation | Engine security regression tests and build |
| WhatsApp engine HTTP views | 4276–4277 | Reachable unauthenticated resource exhaustion | Per-route rate limiting for manager/static views | Engine security regression tests, lint and build |
| WhatsApp proxy and payment identifiers | 4304–4308 | Reachable insecure randomness used in proxy selection and payment references | Cryptographic `randomInt`; bounded proxy components, protocol allowlist and URL reconstruction add defense in depth | Positive/negative proxy tests, lint and build |
| Website normalization | 2541, 2544–2545 | Reachable double-decoding and regex complexity | Single-pass entity decoding and bounded linear email validation | Website suite (76 tests), typecheck and production build |
| Python WhatsApp logging | 2910 | Reachable sensitive-data fingerprint logging | Removed derived phone/message fingerprints from logs | Python syntax and unit suite (20 tests, 87.93% coverage) |
| One-off credential patch | 4317–4319 | Obsolete operational script, no consumer in runtime or repository | Removed instead of suppressing findings | Architecture and security-contract validation |

The remaining critical/high findings observed before this change were confined
to retired, unconsumed WhatsApp variants. Those source trees and their launch
paths were removed. The only supported implementation is now
`messaging/channels/whatsapp/engine`; the CRM is an external product and has no
implementation in this repository.

No scanner suppression, path exclusion, global ignore or alert dismissal is part
of this remediation.
