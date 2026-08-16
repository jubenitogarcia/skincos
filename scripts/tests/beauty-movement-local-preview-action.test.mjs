import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const environment = readFileSync(path.join(repositoryRoot, '.codex', 'environments', 'environment.toml'), 'utf8')
const launcher = readFileSync(path.join(repositoryRoot, 'scripts', 'start-beauty-movement-local-preview.ps1'), 'utf8')

test('Beauty Movement Action stays relative to the opened worktree', () => {
  const actionBlocks = environment.match(/\[\[actions\]\][\s\S]*?(?=\n\[\[actions\]\]|$)/g) ?? []
  const beautyActions = actionBlocks.filter((block) => block.includes('name = "Cartas da Beleza – Prévia Local"'))

  assert.equal(beautyActions.length, 1)
  assert.match(beautyActions[0], /-File \.\/scripts\/start-beauty-movement-local-preview\.ps1/)
  assert.doesNotMatch(beautyActions[0], /CodexRuntime|beauty-movement-canonical/i)
})

test('launcher v2 fails closed unless manifest, WSL process, and served headers agree', () => {
  assert.match(launcher, /Assert-ActionSourceRoot/)
  assert.match(launcher, /This Codex Action must be opened from a worktree containing/)
  assert.match(launcher, /\$previewProtocol = 'beauty-movement-local-preview-v2'/)
  assert.match(launcher, /Get-PreviewIdentity/)
  assert.match(launcher, /inputFingerprint/)
  assert.match(launcher, /contractFingerprint/)
  assert.match(launcher, /instanceFingerprint/)
  assert.match(launcher, /Get-VerifiedRunnerState/)
  assert.match(launcher, /Test-VerifiedSupervisor/)
  assert.match(launcher, /Materialize-PreviewSource/)
  assert.match(launcher, /materializedSourceRootWsl/)
  assert.match(launcher, /Get-OwnedPreviewSupervisor/)
  assert.match(launcher, /X-Skincos-Preview-Fingerprint/)
  assert.match(launcher, /X-Skincos-Preview-Instance/)
  assert.match(launcher, /WEBSITE_ALLOW_PORT_FALLBACK=1/)
  assert.match(launcher, /Write-AtomicJson/)
  assert.doesNotMatch(launcher, /beauty-movement-canonical/)
  assert.doesNotMatch(launcher, /C:\\CodexRuntime/)
})
