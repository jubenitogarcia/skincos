import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'))

test('the standalone Worker configuration is staging-only and cannot publish or bind data by default', () => {
  assert.equal(config.name, 'skincos-clientes-readonly')
  assert.equal(config.main, 'src/worker.js')
  assert.equal(config.workers_dev, false)
  assert.equal(config.preview_urls, false)
  assert.equal(config.vars.CLIENTES_READONLY_DEPLOY_ENABLED, 'false')
  assert.equal(config.vars.CLIENTES_READONLY_SYNTHETIC_ONLY, 'true')
  assert.equal(config.env.staging.vars.CLIENTES_READONLY_DEPLOY_ENABLED, 'false')
  assert.equal(config.env.staging.vars.CLIENTES_READONLY_ENVIRONMENT, 'staging')
  assert.equal(config.env.production, undefined)
  for (const key of ['d1_databases', 'kv_namespaces', 'r2_buckets', 'services', 'routes', 'triggers']) {
    assert.equal(config[key], undefined, `unprovisioned config must not declare ${key}`)
  }
})

test('the release-gate workflow has no deploy command, credential or Cloudflare mutation path', () => {
  const workflow = fs.readFileSync(path.join(root, '..', '.github', 'workflows', 'clientes-readonly-release-gate.yml'), 'utf8')
  assert.match(workflow, /name: Clientes Readonly Release Gate/)
  assert.match(workflow, /npm --prefix clientes-readonly run smoke:synthetic/)
  assert.match(workflow, /--require-ready/)
  assert.doesNotMatch(workflow, /\bwrangler\b|\bCLOUDFLARE\b|secrets\./i)
})
