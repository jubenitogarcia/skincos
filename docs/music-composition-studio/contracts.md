# Contracts and schemas

Closed schemas live in `orb/engine/music-composition-studio/schemas`. Every
root uses `additionalProperties: false` with valid and invalid examples.
`lib/contracts.js` applies the same strict validation during dry-runs.

| Area | Schemas |
| --- | --- |
| Intake | production request, brief, reference analysis, constitution |
| Composition | harmony, melody, rhythm, bass, palette, lyric, matrix, DNA |
| Production | blueprint, section, animatic, stem, vocal, arrangement, mix, master |
| Delivery | QA report, package, production report |

The request requires `dry_run: true` and mock provider mode until a separately
approved live adapter exists. File values are URI references, never base64.
