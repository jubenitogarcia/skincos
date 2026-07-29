# Providers

The catalog exposes composition, MIDI, generation, instrument, vocal, voice,
effects, analysis, mix, mastering and storage provider kinds. Every adapter
implements `submit`, `status`, `result`, `cancel`, `estimateCost` and
`validate`.

`MockMusicProvider` is the executable default. It requires both
`dry_run: true` and provider mode `mock`, returns deterministic results and
records zero cost.

`HttpMusicProvider` is a real transport adapter but remains disabled until
explicitly configured. It supports:

- POST submit and cancel plus GET status/result;
- abort timeout and bounded exponential retry;
- rate-limiter hook and approved fallback;
- model/version propagation and cost estimation;
- private header injection through `headersProvider`.

Credentials are created in the target secret/credential store and supplied by
the runtime adapter. No credential value, token or provider endpoint is stored
in generated workflow JSON. Enabling live mode additionally requires licensing,
privacy, staging, callback, rate, fallback and budget review.

Environment/config names for a future adapter are intentionally generic:
`MSC_PROVIDER_ENDPOINT`, `MSC_PROVIDER_MODEL`, `MSC_PROVIDER_TIMEOUT_MS` and a
credential-store reference. The repository must never contain the secret
itself.
