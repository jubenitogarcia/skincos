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
   inline and eleven predecessor descriptors outside the operational package;
   no HTTP, publication, fixed wait, binary-audio, secret, or Execute Workflow
   subworkflow nodes.
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

## Final audit — 2026-07-29

- The operational package contains exactly one inactive workflow,
  `Music Composition Studio (Unified)`. MSC-10…MSC-90 execute inline and each
  error output routes to inline MSC-99. There are no Execute Workflow nodes.
- The 11 predecessor identities live under
  `orb/engine/archived-workflows/music-composition-studio`, outside the package.
- The seven required `lib/*.js` modules are explicitly unignored and versioned;
  this closes the clean-clone/CI failure where local ignored modules could make
  tests pass falsely.
- PostgreSQL validation applied the 16-table migration twice in a fresh
  temporary database, exercised FK inserts and transaction rollback, then
  removed the database.
- n8n 2.8.3 validation imported/exported exactly one inactive workflow in a
  fresh temporary SQLite profile, then removed the profile.
- Live Orb is healthy but contains no Music Composition Studio workflow.
  Production import, activation, database migration and provider configuration
  are intentionally deferred to a separately authorized staged rollout.
