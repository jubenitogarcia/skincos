# Providers

Composition, MIDI, generation, instrument, vocal, voice, effects, analysis,
mix, mastering and storage providers share `submit`, `status`, `result`,
`cancel`, `estimateCost`, and `validate`.

`MockMusicProvider` is the default and records zero cost. It refuses work unless
both `dry_run: true` and mock policy are explicit. `HttpMusicProvider` is a
fail-closed shell for a real adapter: it needs an approved endpoint and private
credential adapter, neither of which is stored in this repository.

Polling is bounded by attempts rather than a fixed wait. A real provider needs
license, model, privacy, rate-limit, timeout, fallback, budget, and staging
approval before activation.
