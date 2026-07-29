# Architecture

```mermaid
flowchart LR
  R["Music production request"] --> B["MSC-10 Brief analysis"]
  B --> C["MSC-20 Constitution lock"]
  C --> L["MSC-30 Lab and beam search"]
  L --> A["MSC-40 Song animatic"]
  A --> S["MSC-50 Stems and MSC-60 Vocals"]
  S --> AR["MSC-70 Arrangement"]
  AR --> MM["MSC-80 Mix and master"]
  MM --> Q["MSC-90 QA and package"]
  E["MSC-99 Sanitized errors"] -.-> Q
  DB[("music_studio ledger")] --- C
  DB --- S
```

The Music Constitution is immutable by hash/revision. The lab uses constrained
top-k/beam selection rather than Cartesian expansion. n8n owns identifiers,
state and URLs only; `audio-service.js` makes deterministic test WAVs. A future
approved production adapter may use FFmpeg/FFprobe or a service outside n8n.

The builder now emits one unified inactive workflow with the ten functional
MSC stages inline plus native MSC-00 orchestration/package handling. The eleven
former MSC-00…MSC-99 exports remain as explicitly archived snapshots under
`generated-workflows/music-composition-studio/archive`; no
`n8n-nodes-base.executeWorkflow` subworkflow node remains.
