import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const app = fs.readFileSync(path.join(root, 'crm/console/App.tsx'), 'utf8')
const registry = fs.readFileSync(path.join(root, 'crm/console/modules/registry.tsx'), 'utf8')
const test = fs.readFileSync(path.join(root, 'crm/console/tests/moduleRegistry.test.ts'), 'utf8')
const errors = []
const fail = (message) => errors.push(message)

if (/const\s+modules\s*[:=]/.test(app) || /\blazy\s*\(/.test(app)) fail('App.tsx must not contain a manual module registry or lazy module imports')
if (!app.includes("from '@/modules/registry'")) fail('App.tsx must consume the module registry')
if (!app.includes('<ModuleSlot')) fail('App.tsx must mount modules through ModuleSlot')
if (!registry.includes('export const moduleRegistry')) fail('module registry export is missing')
if ((registry.match(/\bentry\('/g) || []).length < 50) fail('registry must contain the current CRM module inventory')
for (const token of ['entrypoint', "bundle: 'lazy'", 'permissions', 'tests:', 'unavailable:', 'export function ModuleSlot', 'reloadOnChunkFailure={false}']) {
  if (!registry.includes(token)) fail(`registry is missing ${token}`)
}
if (!test.includes('moduleRegistry') || !test.includes('hasModulePermission')) fail('registry permission and manifest tests are missing')

if (errors.length) {
  for (const error of errors) process.stderr.write(`CRM module registry validation failed: ${error}\n`)
  process.exit(1)
}
process.stdout.write('CRM module registry validation OK.\n')
