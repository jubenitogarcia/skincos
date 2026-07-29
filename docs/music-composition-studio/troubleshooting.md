# Troubleshooting

- Mock-only error: set `dry_run: true` and provider mode `mock`.
- Authorization error: grant explicit voice consent; a `RESTRICTED` reference is
  blocked rather than silently reused.
- Similarity block: regenerate melody, hook, lyric, or reference rules; never
  force approval.
- Budget exceeded: reduce tier/candidates or make a reviewed budget decision.
- No DNA: correct key, tempo, mood, or compatibility constraints instead of
  brute-force expansion.
- Workflow validation failure: regenerate from the builder; do not hand-edit
  only exported JSON.

MSC-99 receives sanitized metadata only. Credentials and private media never go
into an error event.
