#!/usr/bin/env node
import { createAtendimentoStore } from '../server/atendimento/store.js'
import { importAtendimentoFromGoogleSheet } from '../server/atendimento/importer.js'

const args = new Set(process.argv.slice(2))
const dryRun = !args.has('--write')

const actor = {
  id: 'cli-import',
  username: 'cli-import',
  role: 'GESTOR',
  allowedModules: ['atendimento'],
}

async function main() {
  const store = createAtendimentoStore()
  const result = await importAtendimentoFromGoogleSheet(store, { actor, dryRun })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (dryRun) {
    process.stdout.write('Dry-run concluído. Use --write para gravar no banco configurado em DATABASE_URL.\n')
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || error}\n`)
  process.exitCode = 1
})
