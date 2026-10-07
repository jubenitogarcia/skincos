import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const environment = readFileSync(path.join(repositoryRoot, '.codex/environments/environment.toml'), 'utf8')
const launcher = path.join(repositoryRoot, 'scripts/run-local-codex-shortcut.sh')

const actions = [
  ['Workspace', 'workspace', 'WorkspaceMenu'],
  ['Contexto', 'context', 'ContextMenu'],
  ['Codex – Autônomo', 'autonomous', 'run-skincos-codex.ps1'],
  ['EF App', 'ef-app', 'EfAppMenu'],
  ['Orb', 'orb', 'OrbMenu'],
  ['Cartas da Beleza – Prévia Local', 'beauty-preview', 'start-beauty-movement-local-preview.ps1'],
]

test('Codex actions dispatch to separate macOS and Windows implementations', () => {
  for (const [name, localAction, windowsTarget] of actions) {
    const blocks = [...environment.matchAll(new RegExp(`\\[\\[actions\\]\\]\\nname = "${name}"[\\s\\S]*?(?=\\n\\[\\[actions\\]\\]|$)`, 'g'))].map((match) => match[0])
    assert.equal(blocks.length, 2, `expected macOS and Windows actions for ${name}`)
    assert.ok(blocks.some((block) => block.includes('platform = "darwin"') && block.includes(`command = "bash ./scripts/run-local-codex-shortcut.sh ${localAction}"`)))
    assert.ok(blocks.some((block) => block.includes('platform = "win32"') && block.includes(windowsTarget)), `missing Windows command for ${name}`)
  }
})

test('local Codex launcher validates each action without starting an interactive process', () => {
  const bin = mkdtempSync(path.join(os.tmpdir(), 'skincos-shortcut-bin-'))
  try {
    for (const name of ['codex', 'open']) {
      const executable = path.join(bin, name)
      writeFileSync(executable, '#!/usr/bin/env bash\nexit 0\n')
      chmodSync(executable, 0o755)
    }
    for (const [, action] of actions) {
      const result = execFileSync('bash', [launcher, action, '--dry-run'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      })
      assert.match(result, new RegExp(`dry-run action=${action}`))
    }
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})

test('EF App starts its menu with an explicit mode and safe headed default', () => {
  const source = readFileSync(launcher, 'utf8')
  assert.match(source, /export EF_MODE=menu/)
  assert.match(source, /export HEADLESS="\$\{HEADLESS:-0\}"/)
})
