# Acceptance report

## Scope and state

Evidence refreshed on 2026-07-29 from branch
`codex/admin/music-composition-studio`.

- Repository candidate: one generated, inactive, inline workflow named
  `Music Composition Studio (Unified)`.
- Operational import package: exactly that one workflow.
- Archive: 11 inactive predecessor descriptors under
  `orb/engine/archived-workflows/music-composition-studio`, outside the import
  package.
- Live Orb: healthy on n8n 2.8.3, but no workflow named Music Composition
  Studio is imported or active.
- Live database/provider: the migration is not applied to `n8n_runtime`; no
  provider credential or paid call is configured.

This report proves the local candidate and isolated compatibility checks. It is
not production deployment evidence.

## Commands and results

Executed in Ubuntu-24.04:

```text
npm run workflow:music:build
  -> 23 schemas, valid/invalid fixtures, FAST/STANDARD/PREMIUM fixtures,
     1 operational workflow, 11 predecessors archived outside the package

npm run workflow:music:validate
  -> 1 operational workflow; inline FAST/STANDARD/PREMIUM behavior;
     MSC-99 error routing; zero Execute Workflow nodes

npm run workflow:music:test
  -> Music Composition Studio tests: OK

npm run workflow:music:dry-run
  -> FAST READY: 3 DNA/matrix entries/animatics, 15 stem jobs,
     1 arrangement/mix, no vocals
  -> STANDARD READY: 4 DNA/matrix entries/animatics, 32 stem jobs,
     2 arrangements/mixes, no vocals
  -> PREMIUM READY: 5 DNA/matrix entries/animatics, 119 stem jobs,
     3 arrangements/mixes, 4 vocal fixtures
  -> all tiers: QA APPROVE, one mock submission, cost USD 0

bash scripts/validate-music-composition-studio-migration.sh
  -> 16 PostgreSQL tables; migration applied twice; FK insert succeeded;
     transaction rollback preserved zero rows; temporary database removed

bash scripts/validate-music-composition-studio-n8n-import.sh
  -> n8n 2.8.3 imported and exported exactly 1 inactive unified workflow;
     isolated SQLite profile removed

npm run lint
  -> all Music Composition Studio JavaScript parsed successfully
```

The Campaign Creative Generator validator was also invoked. It stops before
execution because clean `origin/main` does not contain its referenced
`campaign-creative-generator.full-image-reference-fix.current.json`. This is a
pre-existing baseline defect. The music diff changes no Campaign Creative
Generator path. Read-only live evidence shows its unified graph still has 23
nodes, 22 connections and no subworkflow calls; it is currently archived and
inactive. No visual workflow or runtime state was changed by this work.

## Acceptance matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| Preserve the visual workflow | Pass at source boundary | Zero visual/CCG paths in the diff; read-only live graph unchanged by this task |
| Isolated music domain | Pass | Only `music-composition-studio` paths plus scoped package scripts/migration |
| Builder-authoritative workflows | Pass | Regeneration is deterministic and validation follows the builder |
| One operational workflow | Pass | Package length 1; one top-level unified JSON |
| Predecessors outside operational package | Pass | 11 descriptors in `archived-workflows`, no nested operational archive |
| Valid/importable JSON | Pass | JSON parse, graph validation and isolated n8n 2.8.3 import/export |
| Static security findings | Pass | Schema patterns fail closed; artifact kinds, filenames and temporary roots are constrained; traversal/unsafe-pattern tests pass |
| Closed schemas and fixtures | Pass | 23 closed roots, declared nested policies/cardinality and targeted boundary tests |
| Migration works | Pass | Fresh temporary PostgreSQL, idempotent second apply and rollback test |
| FAST dry-run | Pass | READY, three DNA/animatics, one arrangement/mix |
| STANDARD dry-run | Pass | READY, four DNA/animatics, two arrangements/mixes |
| PREMIUM dry-run | Pass | READY, five DNA/animatics, voice, three arrangements/mixes |
| No paid calls | Pass | Explicit mock-only gate and USD 0 |
| Mock providers | Pass | Deterministic submit/status/result/cancel path |
| Real-provider abstraction | Pass, disabled | HTTP submit/status/result/cancel, timeout/retry/rate hook/fallback/model; credential headers injected privately |
| Callbacks and bounded polling | Pass | Callback dedupe and bounded polling tests |
| Cache/idempotency/lineage | Pass | Same-ledger rerun keeps one provider submission and stable artifact count; callbacks dedupe independent of payload variation |
| Compatibility matrix and DNA | Pass | Hard filters, top-k and bounded beam; three to five DNA |
| Animatic before final stems | Pass | State-order assertion |
| Stems/arrangement/mix/master | Pass | URI-only fixtures and tier cardinality assertions |
| Multilevel QA | Pass | Musical, rhythmic, vocal, technical, creative and similarity fields |
| Similarity block | Pass | Derivative-purpose fixture returns FAILED |
| Vocal consent | Pass | Denied consent fails before provider work |
| Selective reprocessing | Pass | Metadata/master/stem URI preservation plus bass, chorus, loudness, Constitution revision and invalidated-ledger assertions |
| Final package schema | Pass | Strict runtime validation |
| Cost registration | Pass | Cost event shape and zero-cost dry-run |
| MSC-99 | Pass | Error routing, classification and redaction |
| Large files by URL | Pass | Storage/file URIs only; no base64/binary in n8n |
| No hardcoded secret | Pass | Structural scan plus injected-header provider test |
| No fragile fixed wait/loop | Pass | Bounded attempts/backoff; graph cycle validation |
| No critical TODO | Pass | No TODO/FIXME in the domain |
| Documentation | Pass | Ten required documents plus this command ledger |

## Deployment decision

Do not import or activate this workflow in live Orb, apply the migration to the
live database, or enable a provider merely to close a source task. Production
currently has no Music Composition Studio workflow. A later rollout requires a
named staging target, database backup/rollback checkpoint, private provider
credentials and budget approval. The isolated n8n/PostgreSQL tests establish
compatibility without changing production.
