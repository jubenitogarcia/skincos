import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
const resolver = read('scripts/resolve-codex-thread-worktree.ps1')
const bootstrap = read('scripts/print-codex-thread-bootstrap.ps1')
const environment = read('.codex/environments/environment.toml')
const hooks = read('.codex/hooks.json')

test('resolver exposes the fail-closed routing contract', () => {
  for (const state of ['ready', 'replace', 'ambiguous', 'manual_registration_required', 'blocked']) {
    assert.match(resolver, new RegExp(`state = '${state}'`))
  }
  for (const field of ['surfaceId', 'currentCheckout', 'currentSha', 'currentBranch', 'currentTracking', 'recommendedCheckout', 'candidateType', 'targetCommit', 'reasonCodes', 'nativeAction', 'preservationReasons']) {
    assert.match(resolver, new RegExp(`${field} =`))
  }
  assert.match(resolver, /SkipProcessScan/)
  assert.match(resolver, /Get-PullRequestState/)
  assert.match(resolver, /Get-ManifestReferences/)
  assert.match(resolver, /Get-ProcessReference/)
  assert.match(resolver, /currentUnderWorktreeRoot/)
  assert.doesNotMatch(resolver, /worktree', 'add|worktree', 'remove|Set-Content|Move-Item/)
})

test('bootstrap delegates replacement to native Codex App actions', () => {
  assert.match(bootstrap, /resolve-codex-thread-worktree\.ps1/)
  assert.match(bootstrap, /nativeAction=create_thread/)
  assert.match(bootstrap, /handoff_thread/)
  assert.match(bootstrap, /não tente trocar o cwd da thread chamadora/i)
})

test('Codex App registers SessionStart routing and a relative diagnostic action', () => {
  assert.match(hooks, /invoke-codex-session-start\.sh/)
  assert.match(hooks, /invoke-codex-session-start\.ps1/)
  assert.match(environment, /name = "Thread – Resolver Worktree"/)
  assert.match(environment, /-File \.\/scripts\/resolve-codex-thread-worktree\.ps1 -Interactive/)
  assert.doesNotMatch(environment, /C:\\CodexShared\\Worktrees/)
})
