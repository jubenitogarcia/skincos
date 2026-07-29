# Testing

`workflow:music:test` covers closed schemas, canonical hashes, job/artifact and
callback idempotency, mock and controlled HTTP provider contracts, cost limits,
PCM WAV integrity, all three tiers, tier cardinality, animatic-before-stems
ordering, similarity rejection, voice-consent blocking, selective invalidation,
bounded DNA selection, final package validation and workflow inventory.

`workflow:music:validate` parses every generated Code node, validates graph
reachability and cycles, checks error-output routing to MSC-99, rejects
subworkflow/HTTP/command/wait/binary/secret candidates, and executes inline
FAST, STANDARD and PREMIUM behavior.

The two shell validators provide integration evidence:

- a fresh temporary PostgreSQL database proves 16 tables, idempotent migration,
  FK behavior and transaction rollback;
- a fresh n8n 2.8.3 SQLite profile proves the one-item package is importable and
  remains inactive.

Dry-runs prove orchestration and artifact contracts, not commercial music
quality. All provider work is mock and USD 0.
