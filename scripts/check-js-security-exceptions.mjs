import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const repoRoot = process.cwd()
const policyPath = path.join(repoRoot, '.github/security/js-security-exceptions.json')

const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
const trackedFiles = execFileSync('git', ['ls-files', '-z', 'frontend', 'modules/site-public/website'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .map((file) => file.trim())
  .filter(Boolean)

const findings = []

for (const [pattern, filePolicy] of Object.entries(policy.patterns)) {
  for (const [file, config] of Object.entries(filePolicy)) {
    if (!trackedFiles.includes(file)) {
      findings.push(`[missing-file] ${file} is declared in ${path.relative(repoRoot, policyPath)} but is not tracked.`)
      continue
    }

    const content = readFileSync(path.join(repoRoot, file), 'utf8')
    const actualCount = content.split(pattern).length - 1
    const expectedCount = Number(config.count ?? 0)

    if (actualCount !== expectedCount) {
      findings.push(
        `[count-mismatch] pattern "${pattern}" in ${file}: expected ${expectedCount}, found ${actualCount}. Reason: ${config.reason}`,
      )
    }
  }
}

for (const file of trackedFiles) {
  const content = readFileSync(path.join(repoRoot, file), 'utf8')
  for (const pattern of Object.keys(policy.patterns)) {
    const actualCount = content.split(pattern).length - 1
    if (actualCount === 0) continue
    const filePolicy = policy.patterns[pattern][file]
    if (!filePolicy) {
      findings.push(
        `[unapproved] pattern "${pattern}" found ${actualCount}x in ${file} without an approved exception entry.`,
      )
    }
  }
}

if (findings.length > 0) {
  console.error('[js-security-exceptions] FAILED')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log('[js-security-exceptions] PASS')
