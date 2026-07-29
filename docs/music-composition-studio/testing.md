# Testing

`workflow:music:test` covers recursively declared schema boundaries, canonical
hashes, job/artifact/callback idempotency, provider cache-hit submission
suppression, mock and controlled HTTP provider contracts, timeout, rate limit,
retry/fallback and accumulated cost limits. It also covers PCM WAV integrity
with separate logical/rendered duration, all three tiers, tier cardinality,
animatic-before-stems ordering, similarity rejection, voice-consent blocking,
executable selective reprocessing with preserved URI checks, bounded
compatibility scoring across all required dimensions, final package validation
and workflow inventory. Security regression cases reject schema-supplied
regular expressions, unsafe artifact kinds and fixture roots outside the
operating-system temporary directory.

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
