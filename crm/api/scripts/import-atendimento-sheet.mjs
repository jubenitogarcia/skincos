#!/usr/bin/env node

// This compatibility entry point used to accept `--write` and bypassed the
// target-bound source-sync contract.  Keep the command name only to prevent a
// stale operator or automation from silently reaching a configured database.
process.stderr.write(`${JSON.stringify({
  ok: false,
  code: 'ATENDIMENTO_LEGACY_SHEET_IMPORT_RETIRED',
  replacement: 'npm run sync-atendimento-source -- --dry-run',
  writesDisabled: true,
})}\n`)
process.exitCode = 78
