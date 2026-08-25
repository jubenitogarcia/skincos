# Contracts and schemas

Closed schemas live in the Orb repository's `music-composition-studio/schemas`. Every
root and bounded nested object declares an `additionalProperties` policy, with
valid and invalid examples. Provider payloads, lineage, annotations and usage
maps are explicit controlled extension points rather than accidental open
objects. Cardinality is enforced for required candidate, section, matrix,
stem, MIDI and QA collections. `lib/contracts.js` applies the same strict
validation during dry-runs.

| Area | Schemas |
| --- | --- |
| Intake | production request, brief, reference analysis, constitution |
| Composition | harmony, melody, rhythm, bass, palette, lyric, matrix, DNA |
| Production | blueprint, section, animatic, stem, vocal, arrangement, mix, master |
| Delivery | QA report, package, production report |

The request requires `dry_run: true` and mock provider mode until a separately
approved live adapter exists. File values are URI references, never base64.
