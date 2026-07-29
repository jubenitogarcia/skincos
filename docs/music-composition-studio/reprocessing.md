# Selective reprocessing

| Change | Invalidated | Preserved |
| --- | --- | --- |
| Metadata/CTA | package | audio, stems, mix, master |
| Bass timbre | bass, affected sections, arrangement, mix, master, package | melody and unrelated stems |
| Chorus | related harmony/melody/lyrics/stems, arrangement, mix, master | unaffected section stems |
| Loudness | master, package | composition, stems, arrangement, mix |
| Constitution | candidates through package | prior revision and lineage |

`lib/invalidation.js` is the dependency graph. A constitution change creates a
new revision/hash; later modules cannot silently change its BPM, key, meter,
structure, identity, or purpose.
