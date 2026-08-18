import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'cloudflare-pages-sync-atendimento.yml'), 'utf8')
const runbook = fs.readFileSync(path.join(root, 'docs', 'runbooks', 'atendimento-pages-secret-custody.md'), 'utf8')

test('Atendimento Pages secret reconciliation is manual, gated and environment-scoped', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /schedule:/)
  assert.match(workflow, /ENABLE_CRM_GENERAL_PAGES_DEPLOY/)
  assert.match(workflow, /global-coordination-acquire/)
  assert.match(workflow, /global-coordination-check/)
  assert.match(workflow, /global-coordination-release/)
  assert.match(workflow, /global:crm-cloudflare-writer/)
  assert.match(workflow, /ATENDIMENTO_ACTOR_HMAC_KEY/)
  assert.match(workflow, /pages secret put ATENDIMENTO_ACTOR_HMAC_KEY --project-name "\$PROJECT" --env "\$env_name"/)
  assert.match(workflow, /for env_name in production preview/)
  assert.match(workflow, /binding\.get\('type'\) != 'secret_text'/)
  assert.match(workflow, /PROJECT: \$\{\{ vars\.CRM_GENERAL_PAGES_PROJECT \}\}/)
  assert.match(runbook, /mesma `ATENDIMENTO_ACTOR_HMAC_KEY`/i)
  assert.match(runbook, /Health e presença de secret não provam/i)
  assert.doesNotMatch(workflow, /echo .*ATENDIMENTO_ACTOR_HMAC_KEY\}/)
})
