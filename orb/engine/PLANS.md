# Music Composition Studio — implementation plan

## Initial diagnosis

The existing Campaign Creative Generator is a visual-content workflow with a
monolithic legacy builder. It is useful as a naming and n8n-builder reference,
but it couples provider-oriented stages more closely than a music pipeline
should. The current Orb runtime is PostgreSQL-backed and production workflows
are operationally sensitive; this implementation therefore remains local,
generated, inactive, and mock-only.

## Objective and scope

Build an isolated `music-composition-studio` domain under `orb/engine`.
It receives a normalized music production request, locks a versioned Music
Constitution, creates and scores musical candidates, produces animatics and
deterministic audio fixtures, packages stems/mixes/masters by URL, and emits a
non-publishing package. It does not alter the visual generator, import a
workflow, execute a paid provider, write a live database, or activate n8n.

## Architecture decisions

- n8n owns orchestration, identifiers, state and references only. Generated
  audio artifacts use a deterministic local service and flow as URIs.
- The audio service writes valid WAV fixtures using Node's standard library;
  FFmpeg/FFprobe are optional production adapters documented, never required
  for dry-run validation.
- Providers implement the same submit/status/result/cancel/estimateCost/
  validate contract. Only `MockMusicProvider` is executable by default.
- PostgreSQL migration is additive, scoped to `music_studio`, and is not
  applied by this task.
- A dependency graph drives targeted invalidation. Constitution revisions
  preserve lineage and invalidate only dependent components.
- Voice cloning requires explicit consent. Similarity and rights checks fail
  closed before provider work.

## Milestones and acceptance evidence

1. Contracts and closed schemas: all requested schema files, valid/invalid
   examples, deterministic hashes, strict validation.
2. Ledger and migration: production/job/artifact/dependency/cost/QA tables and
   idempotent in-memory dry-run ledger.
3. Providers and audio service: mock-only provider, bounded polling, cost
   guard, URI-only artifacts, valid deterministic WAV/JSON fixtures.
4. Pipeline: FAST, STANDARD and PREMIUM paths, compatibility beam search,
   animatics, stems, arrangement, mix/master, QA and package.
5. n8n: builder generates one inactive unified workflow with all MSC stages
   inline and eleven archived predecessor snapshots; no HTTP, publication,
   fixed wait, binary-audio, secret, or Execute Workflow subworkflow nodes.
6. Verification: unit/contract tests, builder validation, three dry-runs,
   migration structural validation and an acceptance report.

## Commands

Run in Ubuntu-24.04 from `orb/engine`:

```bash
npm run workflow:music:schemas
npm run workflow:music:build
npm run workflow:music:validate
npm run workflow:music:test
npm run workflow:music:dry-run
npm run lint
```

## Risks and controls

- Local dry-runs prove orchestration contracts, not commercial audio quality or
  a live provider integration. Real adapters need credentials, license review,
  staging, budget limits and explicit activation.
- A schema/migration can be locally validated but is **not applied** to the
  production `n8n_runtime` database in this task.
- Audio fixture synthesis is intentionally deterministic and lightweight; it
  is not a DAW or a claim of production-ready mastering.
- The legacy CCG validator in `origin/main` references an untracked snapshot
  (`campaign-creative-generator.full-image-reference-fix.current.json`) and
  cannot run from a clean base. The current shared CCG v2 validator is a
  separate local-only check; neither result establishes production state.
