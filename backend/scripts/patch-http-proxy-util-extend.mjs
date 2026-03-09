import { promises as fs } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const searchRoots = [
  path.join(repoRoot, 'node_modules'),
  path.join(repoRoot, 'apps', 'crm-api', 'node_modules')
]
const targetSuffix = path.join('http-proxy', 'lib', 'http-proxy', 'index.js')
const beforeNeedle = "extend    = require('util')._extend,"
const afterNeedle = 'extend    = Object.assign,'

async function walk(dir, found = []) {
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') && entry.name !== '.pnpm') continue
      await walk(fullPath, found)
      continue
    }
    if (fullPath.endsWith(targetSuffix)) found.push(fullPath)
  }
  return found
}

async function patchFile(filePath) {
  const source = await fs.readFile(filePath, 'utf8')
  if (source.includes(afterNeedle)) return false
  if (!source.includes(beforeNeedle)) return false
  const next = source.replace(beforeNeedle, afterNeedle)
  await fs.writeFile(filePath, next, 'utf8')
  return true
}

const candidates = []
for (const root of searchRoots) {
  await walk(root, candidates)
}

let patched = 0
for (const filePath of new Set(candidates)) {
  if (await patchFile(filePath)) patched += 1
}

console.log(`[patch-http-proxy-util-extend] patched=${patched}`)
