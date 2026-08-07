import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(API_ROOT, '../..')

async function read(relativePath) {
    return readFile(path.join(REPO_ROOT, relativePath), 'utf8')
}

test('HTTP API has no continuous worker import or startup boundary', async () => {
    const source = await read('crm/api/server.js')
    assert.doesNotMatch(source, /continuous-worker|startHarmoniaWorker|createContinuousWorkerService|createWorkerHealthServer|clinicalApprovalExpiryJob/)
})

test('dedicated runner and launcher cannot execute arbitrary shell or install dependencies', async () => {
    const runner = await read('crm/api/server/workers/jobRunner.js')
    const jobs = await read('crm/api/server/workers/clientesJobs.js')
    const launcher = await read('scripts/crm/run-continuous-workers-linux.sh')
    const legacySourceRefresh = await read('crm/api/scripts/refresh-atendimento-source.mjs')
    const legacyNativeRefresh = await read('scripts/runtime/run-clientes-source-refresh-native.sh')
    const legacyInstaller = await read('scripts/runtime/install-clientes-source-refresh-service.sh')
    assert.doesNotMatch(runner, /node:child_process|\bspawn\b|\beval\s*\(/)
    assert.doesNotMatch(jobs, /node:child_process|\bspawn\b|\beval\s*\(/)
    assert.doesNotMatch(jobs, /importAtendimentoFromGoogleSheet|sourceRefresh\.js/)
    assert.doesNotMatch(legacySourceRefresh, /importAtendimentoFromGoogleSheet|createAtendimentoStore|createPgPool/)
    assert.match(legacySourceRefresh, /CLIENTES_SOURCE_LEGACY_REFRESH_DISABLED/)
    assert.match(legacyNativeRefresh, /CLIENTES_SOURCE_LEGACY_REFRESH_DISABLED/)
    assert.match(legacyInstaller, /CLIENTES_SOURCE_LEGACY_INSTALL_DISABLED/)
    assert.doesNotMatch(legacyNativeRefresh, /(^|\n)\s*(source|\.)\s+|\beval\s*\(|pg_dump|\bnode\b/)
    assert.doesNotMatch(legacyInstaller, /(^|\n)\s*(source|\.)\s+|\beval\s*\(|\bsed\b|\binstall\b/)
    assert.doesNotMatch(launcher, /(^|\n)\s*(source|\.)\s+.*crm(?:-jobs)?\.env/)
    assert.doesNotMatch(launcher, /npm\s+install/)
    assert.match(launcher, /assisted mode is unavailable in the continuous worker/)
})

test('runtime template is loopback-only and has a durable job checkpoint', async () => {
    const unit = await read('ops/runtime/units/crm-jobs.service')
    assert.match(unit, /^Environment=CRM_CONTINUOUS_WORKER_HOST=127\.0\.0\.1$/m)
    assert.match(unit, /^Environment=CRM_CONTINUOUS_JOBS_STATE_PATH=__STATE_ROOT__\/crm\/continuous-jobs-state\.json$/m)
    assert.match(unit, /^Environment=CRM_CLIENTES_SOURCE_OPERATIONS_TARGET=staging$/m)
    assert.match(unit, /^Environment=CRM_CLIENTES_SOURCE_OPERATIONS_MODE=dry-run$/m)
    assert.match(unit, /^Environment=CRM_CLIENTES_SOURCE_OPERATIONS_APPLY_ENABLED=0$/m)
    assert.doesNotMatch(unit, /CRM_CLIENTES_SOURCE_REFRESH_/)
    assert.match(unit, /^ReadWritePaths=.*__STATE_ROOT__\/crm/m)
})
