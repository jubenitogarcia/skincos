# Architecture

```mermaid
flowchart LR
  R["music_production_request"] --> B["MSC-10 Brief and references"]
  B --> C["MSC-20 Constitution lock"]
  C --> L["MSC-30 Labs and bounded beam"]
  L --> A["MSC-40 Song animatics"]
  A --> S["MSC-50 Stems"]
  S --> V["MSC-60 Vocals with consent"]
  V --> AR["MSC-70 Arrangement lock"]
  AR --> MM["MSC-80 Mix and master"]
  MM --> Q["MSC-90 QA and MUSIC_PACKAGE"]
  B -. "error output" .-> E["MSC-99 sanitized error"]
  C -. "error output" .-> E
  L -. "error output" .-> E
  A -. "error output" .-> E
  S -. "error output" .-> E
  V -. "error output" .-> E
  AR -. "error output" .-> E
  MM -. "error output" .-> E
  Q -. "error output" .-> E
  DB[("music_studio ledger")] --- C
  DB --- S
```

The Music Constitution is immutable by revision/hash. Candidate selection uses
hard filters, preliminary scores, top-k and bounded beam search instead of the
full Cartesian product. Animatics are approved before expensive stem work.

n8n is the control plane: states, IDs, jobs, dependency references, callbacks,
costs, QA and manifests. `audio-service.js` is the external-to-n8n dry-run audio
layer and writes short deterministic PCM WAV fixtures. Logical duration remains
in metadata while CI-sized physical samples prove RIFF integrity. A production
audio service may replace this adapter without moving binary audio through
n8n.

The builder is authoritative. It emits one inactive inline workflow and a
one-item import package. Archive descriptors live under
`orb/engine/archived-workflows/music-composition-studio`, outside
`generated-workflows/music-composition-studio`.
