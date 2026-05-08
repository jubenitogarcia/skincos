#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const targetDir = path.resolve(process.argv[2] || '.')
const lockfilePath = path.join(targetDir, 'package-lock.json')

const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }

function severityValue(value) {
  return rank[String(value || '').toLowerCase()] ?? 0
}

function maxSeverity(vulnerability) {
  let max = severityValue(vulnerability?.severity)
  for (const entry of Array.isArray(vulnerability?.via) ? vulnerability.via : []) {
    if (typeof entry === 'string') continue
    max = Math.max(max, severityValue(entry?.severity))
  }
  return max
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

const lockfile = loadJson(lockfilePath)
const audit = spawnSync(
  'npm',
  ['audit', '--package-lock-only', '--omit=dev', '--json'],
  { cwd: targetDir, encoding: 'utf8' },
)

const stdout = String(audit.stdout || '').trim()
if (!stdout) {
  process.stderr.write(audit.stderr || 'npm audit returned no JSON output.\n')
  process.exit(1)
}

let report
try {
  report = JSON.parse(stdout)
} catch {
  process.stderr.write(stdout)
  process.stderr.write('\n')
  process.stderr.write(audit.stderr || '')
  process.exit(1)
}

const blocking = []
const ignored = []

for (const vulnerability of Object.values(report.vulnerabilities || {})) {
  const highestSeverity = maxSeverity(vulnerability)
  if (highestSeverity < rank.high) continue

  const candidateNodes = new Set(
    (Array.isArray(vulnerability.nodes) ? vulnerability.nodes : []).filter(Boolean),
  )
  const defaultNode = `node_modules/${vulnerability.name}`
  if ((lockfile.packages || {})[defaultNode]) {
    candidateNodes.add(defaultNode)
  }

  const installedProdNodes = [...candidateNodes].filter((nodePath) => {
    const pkg = (lockfile.packages || {})[nodePath]
    return pkg && pkg.dev !== true
  })

  if (installedProdNodes.length > 0) {
    blocking.push({
      name: vulnerability.name,
      severity: vulnerability.severity,
      nodes: installedProdNodes,
    })
    continue
  }

  ignored.push({
    name: vulnerability.name,
    severity: vulnerability.severity,
    nodes: [...candidateNodes],
  })
}

if (ignored.length > 0) {
  console.log(`Ignoring ${ignored.length} high-severity advisory entries not present in non-dev lockfile packages for ${path.relative(process.cwd(), targetDir) || '.'}.`)
  for (const entry of ignored) {
    const nodesLabel = entry.nodes.length > 0 ? entry.nodes.join(', ') : 'no lockfile nodes'
    console.log(`- ${entry.name} (${entry.severity}): ${nodesLabel}`)
  }
}

if (blocking.length > 0) {
  console.error(`Blocking npm audit findings in ${path.relative(process.cwd(), targetDir) || '.'}:`)
  for (const entry of blocking) {
    console.error(`- ${entry.name} (${entry.severity}): ${entry.nodes.join(', ')}`)
  }
  process.exit(1)
}

console.log(`No blocking npm audit findings in ${path.relative(process.cwd(), targetDir) || '.'}.`)
