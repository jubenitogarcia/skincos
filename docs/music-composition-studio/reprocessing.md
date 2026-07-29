# Selective reprocessing

```mermaid
flowchart LR
  C["Constitution"] --> D["Candidates and DNA"]
  D --> A["Animatic"]
  A --> S["Section stems"]
  S --> R["Arrangement"]
  R --> X["Mix"]
  X --> M["Master"]
  M --> P["Package"]
  MD["Metadata"] --> P
  L["Loudness"] --> M
  BT["Bass timbre"] --> BS["Affected bass stems"]
  BS --> R
```

| Change | Invalidated | Preserved |
| --- | --- | --- |
| Metadata/CTA | package | audio, stems, mix, master |
| Bass timbre | bass, affected sections, arrangement, mix, master, package | melody and unrelated stems |
| Chorus | related harmony/melody/lyrics/stems, arrangement, mix, master | unaffected section stems |
| Loudness | master, package | composition, stems, arrangement, mix |
| Constitution | candidates through package | prior revision and lineage |

`lib/invalidation.js` is the dependency policy. `selectiveReprocess()` returns
the precise invalidation plan and creates a newly hashed Constitution revision
when that source changes. `executeSelectiveReprocess()` applies the local
dry-run plan: metadata changes only the package; loudness creates a new master;
bass timbre replaces only bass stems and descendants; and chorus changes
replace only stems in chorus sections and descendants. Tests compare preserved
URIs and invalidated ledger jobs. Never mutate a locked Constitution in place.

Resume a failed provider job with the same normalized inputs and input hash.
The ledger reuses an approved/completed result and deduplicates callback and
artifact IDs. A changed dependency produces a new hash/revision and only the
listed descendants are scheduled.
