import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
const launcher = read('scripts/run-shared-codex-shortcut.ps1')
const environment = read('.codex/environments/environment.toml')
const workspaceDocs = read('docs/codex-shared-workspace.md')

test('thread preview launcher requires an explicit registered worktree', () => {
  assert.match(launcher, /function Resolve-CrmThreadPreviewSourceCheckout/)
  assert.match(launcher, /CRM – Prévia da Thread não pode usar o clone compartilhado/)
  assert.match(launcher, /function Get-CrmThreadPreviewRegisteredWorktrees/)
  assert.match(launcher, /function Select-CrmThreadPreviewSourceCheckout/)
  assert.match(launcher, /Nenhum worktree foi selecionado; a ação foi cancelada/)
  assert.match(launcher, /registered worktree; there is intentionally no remembered\/default/)
  assert.match(launcher, /"CrmUsersThreadPreview"\s*\{[\s\S]*?Invoke-CrmThreadPreviewAction -Role Gestor -Module "users"/)
  assert.match(launcher, /"CrmUsersThreadPreview"\s*\{[\s\S]*?Resolve-CrmThreadPreviewActionSource/)
  assert.match(launcher, /\$SelectedAction -like 'Crm\*' -and \$SelectedAction -notin @\('CrmThreadPreview', 'CrmUsersThreadPreview'\)/)
  assert.doesNotMatch(launcher, /users-production-flag-20260810/)
})

test('Codex App uses the current worktree launcher relatively', () => {
  const usersAction = environment.match(
    /name = "CRM – Prévia Usuários Equipe Thread"\r?\nicon = "[^"]+"\r?\ncommand = "([^"]+)"/,
  )
  assert.ok(usersAction)
  assert.equal(
    usersAction[1],
    'powershell.exe -ExecutionPolicy Bypass -File ./scripts/run-shared-codex-shortcut.ps1 -Action CrmUsersThreadPreview',
  )
  assert.doesNotMatch(usersAction[1], /CodexShared[\\/]Worktrees/)
})

test('documentation records the validated Users lineage', () => {
  assert.match(workspaceDocs, /users-production-flag-20260810/)
  assert.match(workspaceDocs, /ca1e1dab82616f1804b91d0ecd87e355f065e2d2/)
})
