import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('isolated Clientes production unit is loopback-configured and cannot broaden the shared runtime', () => {
  const unit = read('ops/runtime/units/crm-atendimento-production.service')
  assert.match(unit, /Description=.*Clientes.*read-only/)
  assert.match(unit, /EnvironmentFile=-__CONFIG_ROOT__\/crm-clientes-production-readonly\.env/)
  assert.match(unit, /ReadWritePaths=__STATE_ROOT__\/crm-atendimento-production/)
  assert.doesNotMatch(unit, /crm\.service/)
  assert.match(read('scripts/provision-atendimento-production-readonly.sh'), /CRM_API_HOST=127\.0\.0\.1/)
  assert.match(read('scripts/provision-atendimento-production-readonly.sh'), /CRM_ATENDIMENTO_READ_ONLY=true/)
  assert.match(read('scripts/provision-atendimento-production-readonly.sh'), /CRM_ATENDIMENTO_CLIENTES_ONLY=true/)
  assert.match(read('scripts/provision-atendimento-production-readonly.sh'), /default_transaction_read_only = on/)
  assert.match(read('scripts/provision-atendimento-production-readonly.sh'), /grant usage on schema harmonia/)
  assert.match(read('scripts/provision-atendimento-production-readonly.sh'), /grant select \(phone_raw, opted_out_at\) on table harmonia\.contacts/)
  assert.match(read('scripts/runtime/manage-native-runtime.sh'), /crm-atendimento-production\.service/)
})

test('production validation proves the API and database write barriers without sending customer data', () => {
  const validation = read('scripts/validate-atendimento-production-readonly.sh')
  assert.match(validation, /READ_ONLY_RUNTIME/)
  assert.match(validation, /commercial\/actions/)
  assert.match(validation, /skincos_clientes_ro/)
  assert.match(validation, /global_client_identities/)
  assert.match(validation, /crm_caixa\.sales/)
  assert.match(validation, /harmonia\.contacts/)
  assert.match(validation, /has_column_privilege/)
  assert.doesNotMatch(validation, /curl[^\n]*https?:\/\/(?!127\.0\.0\.1)/)
})

test('production control refuses active state without an immutable full SHA', () => {
  const control = read('scripts/set-atendimento-production-readonly-control.sh')
  assert.match(control, /STATE.*active/)
  assert.match(control, /release-sha.*full lowercase SHA/)
  assert.match(control, /state.*disabled\|maintenance\|active/)
})
