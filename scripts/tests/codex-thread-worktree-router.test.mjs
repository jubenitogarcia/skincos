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
const routingState = read('scripts/codex-thread-routing-state.ps1')
const promptHook = read('.codex/hooks/invoke-codex-thread-routing.ps1')
const guardHook = read('.codex/hooks/invoke-codex-thread-routing-guard.ps1')
const routingDocs = read('docs/codex-thread-bootstrap.md')
const ciSmoke = read('.github/workflows/ci-smoke.yml')

test('resolver exposes the fail-closed routing contract', () => {
  for (const state of ['ready', 'replace', 'ambiguous', 'manual_registration_required', 'blocked']) {
    assert.match(resolver, new RegExp(`state = '${state}'`))
  }
  for (const field of ['surfaceId', 'currentCheckout', 'currentSha', 'currentBranch', 'currentTracking', 'recommendedCheckout', 'candidateType', 'targetCommit', 'reasonCodes', 'nativeAction', 'currentThreadAction', 'preservationReasons']) {
    assert.match(resolver, new RegExp(`${field} =`))
  }
  assert.match(resolver, /SkipProcessScan/)
  assert.match(resolver, /CodexManagedWorktreeRoot/)
  assert.match(resolver, /current_bound_managed_worktree_ready/)
  assert.match(resolver, /Invoke-RoutingState/)
  assert.match(resolver, /Get-PullRequestState/)
  assert.match(resolver, /Get-ManifestReferences/)
  assert.match(resolver, /Get-ProcessReference/)
  assert.match(resolver, /currentUnderWorktreeRoot/)
  assert.doesNotMatch(resolver, /worktree', 'add|worktree', 'remove|Set-Content|Move-Item/)
})

test('bootstrap delegates replacement to native Codex App actions', () => {
  assert.match(bootstrap, /UserPromptSubmit/)
  assert.match(bootstrap, /currentThreadAction=create_replacement_thread/)
  assert.match(bootstrap, /handoff_thread/)
  assert.match(bootstrap, /nunca para a própria chamadora/i)
})

test('Codex App registers prompt routing, a write guard, and a relative diagnostic action', () => {
  assert.match(hooks, /invoke-codex-session-start\.sh/)
  assert.match(hooks, /invoke-codex-session-start\.ps1/)
  assert.match(hooks, /UserPromptSubmit/)
  assert.match(hooks, /invoke-codex-thread-routing\.sh/)
  assert.match(hooks, /invoke-codex-thread-routing\.ps1/)
  assert.match(hooks, /PreToolUse/)
  assert.match(hooks, /invoke-codex-thread-routing-guard\.sh/)
  assert.match(hooks, /invoke-codex-thread-routing-guard\.ps1/)
  assert.match(environment, /name = "Thread – Resolver Worktree"/)
  assert.match(environment, /-File \.\/scripts\/resolve-codex-thread-worktree\.ps1 -Interactive/)
  assert.match(environment, /name = "CRM – Prévia Usuários Equipe Thread"[\s\S]*-File \.\/scripts\/resolve-codex-thread-worktree\.ps1 -Intent preview -SurfaceType crm-module -SurfaceId users/)
  assert.doesNotMatch(environment, /name = "CRM – Prévia Usuários Equipe Thread"[\s\S]*run-shared-codex-shortcut\.ps1 -Action CrmUsersThreadPreview/)
  assert.doesNotMatch(environment, /C:\\CodexShared\\Worktrees/)
})

test('managed replacement binding is private, nonce-bound, and fail-closed', () => {
  for (const action of ['issue', 'consume', 'get-binding', 'get-pending', 'register-native-project', 'get-native-project-registration', 'clear-expired']) {
    assert.match(routingState, new RegExp(`'${action}'`))
  }
  assert.match(routingState, /managed_checkout_not_registered_under_configured_root/)
  assert.match(routingState, /managed_checkout_target_commit_mismatch/)
  assert.match(routingState, /managed_worktree_binding_reused/)
  assert.match(routingState, /route_marker_consumed_for_another_checkout_or_sha/)
  assert.doesNotMatch(routingState, /threadId|cookie|authorization/i)
})

test('prompt hook uses an explicit edit default and guards a pending replacement', () => {
  assert.match(promptHook, /hook_event_name.*UserPromptSubmit/)
  assert.match(promptHook, /TaskBrief = \$prompt/)
  assert.match(promptHook, /Intent = 'edit'/)
  assert.match(promptHook, /currentThreadAction -eq 'create_replacement_thread'/)
  assert.match(promptHook, /SKINCOS_ROUTE_V1/)
  assert.match(promptHook, /Never hand off this task to itself/)
  assert.match(guardHook, /pending replacement route/)
  assert.match(guardHook, /permissionDecision = 'deny'/)
  assert.match(guardHook, /codex_app__create_thread/)
})

test('routing documentation records the managed App perimeter and separate primary projects', () => {
  assert.match(routingDocs, /Settings > Worktrees/)
  assert.match(routingDocs, /C:\\CodexShared\\Worktrees\\skincos\\admin\\managed/)
  assert.match(routingDocs, /C:\\CodexShared\\Worktrees\\skincos\\admin\\canonical\\crm\\users/)
  assert.match(routingDocs, /C:\\CodexShared\\Worktrees\\skincos\\admin\\canonical\\orb\\meta-ads-publish/)
  assert.match(routingDocs, /threadId`, cookies ou segredos/)
})

test('CI executes the routing contracts on Linux and Windows', () => {
  assert.match(ciSmoke, /Setup Node for supervised Codex continuity/)
  assert.match(ciSmoke, /node --test scripts\/tests\/codex-thread-worktree-router\.test\.mjs/)
  assert.match(ciSmoke, /scripts\\tests\\codex-thread-worktree-router\.test\.ps1/)
  assert.match(ciSmoke, /scripts\\tests\\codex-thread-routing-hook\.test\.ps1/)
})
