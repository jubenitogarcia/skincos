import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(root, 'src')

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(resolved)
    return entry.isFile() && entry.name.endsWith('.js') ? [resolved] : []
  })
}

function importSpecifiers(source) {
  return [...source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)].map((match) => match[1])
}

test('the extraction seed is self-contained and has no commercial implementation import', () => {
  const files = sourceFiles(sourceRoot)
  assert.ok(files.length > 0)
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const specifier of importSpecifiers(source)) {
      assert.match(specifier, /^\.\//, `${path.relative(root, file)} must not import an external implementation: ${specifier}`)
      assert.doesNotMatch(specifier, /(?:^|\/)(?:crm|harmonia|caixa)(?:\/|$)|atendimento/i)
    }
    assert.doesNotMatch(source, /\bprocess\.env\b/)
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/)
  }
})

test('the extraction seed admits no mutable HTTP or data operation', () => {
  const source = sourceFiles(sourceRoot).map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(source, /\b(?:POST|PUT|PATCH|DELETE|INSERT|UPDATE|CREATE|ALTER|DROP)\b/)
  assert.doesNotMatch(source, /readModel\.(?:create|update|delete|write|mutate)/)
  assert.match(source, /readModel\.listClients/)
  assert.match(source, /readModel\.getClientById/)
})
