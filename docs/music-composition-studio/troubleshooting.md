# Troubleshooting

- Mock-only error: use `dry_run: true`, provider mode `mock` and no live
  credentials.
- Authorization error: grant explicit voice consent; restricted material stays
  blocked.
- Similarity block: regenerate only the named melody/hook/lyric targets; never
  force approval.
- Budget exceeded: reduce tier/candidate/job limits or record an approved budget
  decision before retry.
- No DNA: adjust key, tempo, mood or hard compatibility constraints instead of
  expanding the full Cartesian product.
- Import failure: rebuild, run `workflow:music:validate`, then use the isolated
  n8n import validator. Import `package.json`, not the archive directory.
- Migration failure: run the temporary PostgreSQL validator first. Do not retry
  against live until a backup and exact rollback checkpoint exist.
- Provider timeout/rate limit: resume the same job key with bounded retry; check
  the provider request ID before creating a new artifact.
- Workflow Code-node failure: inspect the sanitized MSC-99 report. Credentials,
  private media and raw stack payloads must not be copied into logs.

For QA, `APPROVE` can proceed to packaging. `REVISE_TARGETED`,
`REGENERATE_COMPONENT`, `REBUILD_SECTION`, `REARRANGE`, `REMIX` and `REMASTER`
map to dependency-scoped reprocessing. `REJECT` blocks delivery.
