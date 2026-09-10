import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const workflowDirectory = path.join(repositoryRoot, '.github/workflows')
const readWorkflow = (name) => fs.readFileSync(path.join(workflowDirectory, name), 'utf8')

test('only Ponto Pages overrides the reusable promotion environment', () => {
  const promotionGate = readWorkflow('promotion-gate.yml')
  assert.match(promotionGate, /promotion_environment: \{ required: false, type: string, default: "" \}/)
  assert.match(promotionGate, /environment: \$\{\{ inputs\.promotion_environment \|\| inputs\.target \}\}/)

  const consumers = fs.readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .filter((name) => readWorkflow(name).includes('uses: ./.github/workflows/promotion-gate.yml'))
  const overrides = consumers.filter((name) => /^\s+promotion_environment:/m.test(readWorkflow(name)))

  assert.deepEqual(overrides.sort(), [
    'ponto-pages-candidate-preflight.yml',
    'ponto-pages-governed-publisher.yml',
  ])
  for (const consumer of consumers.filter((name) => !overrides.includes(name))) {
    assert.doesNotMatch(readWorkflow(consumer), /^\s+promotion_environment:/m, `${consumer} must keep the default target environment`)
  }
})

test('Ponto Pages selects the two protected dedicated environments literally', () => {
  const candidate = readWorkflow('ponto-pages-candidate-preflight.yml')
  const publisher = readWorkflow('ponto-pages-governed-publisher.yml')

  assert.match(candidate, /promotion_environment: ponto-pages-staging/)
  assert.match(publisher, /promotion_environment: \$\{\{ inputs\.target == 'staging' && 'ponto-pages-staging' \|\| 'ponto-pages-production' \}\}/)
  assert.match(publisher, /name: \$\{\{ inputs\.target == 'staging' && 'ponto-pages-staging' \|\| 'ponto-pages-production' \}\}/)
  assert.doesNotMatch(candidate, /promotion_environment: (?:preview|staging|production)$/m)
})
