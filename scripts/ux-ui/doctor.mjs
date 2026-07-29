import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const checks = [
  ['root package manager', path.join(root, 'package-lock.json')],
  ['CRM Playwright', path.join(root, 'crm/console/node_modules/@playwright/test/package.json')],
  ['CRM axe', path.join(root, 'crm/console/node_modules/@axe-core/playwright/package.json')],
  ['CRM Storybook', path.join(root, 'crm/console/node_modules/storybook/package.json')],
  ['website Lighthouse', path.join(root, 'website/node_modules/lighthouse/package.json')],
  ['LHCI', path.join(root, 'node_modules/@lhci/cli/package.json')],
  ['MCP Inspector', path.join(root, 'node_modules/@modelcontextprotocol/inspector/package.json')],
]

const results = await Promise.all(checks.map(async ([name, file]) => {
  try {
    await access(file)
    const version = JSON.parse(await readFile(file, 'utf8')).version
    return { name, status: 'installed', version }
  } catch {
    return { name, status: 'missing' }
  }
}))
console.log(JSON.stringify({ node: process.version, results }, null, 2))
if (results.some(result => result.status === 'missing')) process.exitCode = 1
