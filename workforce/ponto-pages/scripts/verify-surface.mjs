import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const required = [
  'src/PontoApp.tsx',
  'src/PontoAuth.tsx',
  'src/PontoModule.tsx',
  'public/ponto-terminal.html',
  'public/_routes.json',
  'functions/api/auth/[[path]].ts',
  'functions/api/insumos/health.ts',
  'functions/api/ponto/[[path]].ts',
  'functions/_lib/csrf.ts',
  'functions/_lib/insumosAuth.ts',
  'functions/_lib/pontoAuth.ts',
  'functions/_lib/proxy.ts',
  'wrangler.toml',
]

for (const relative of required) {
  await stat(resolve(packageRoot, relative)).catch(() => {
    throw new Error(`PONTO_SURFACE_MISSING:${relative}`)
  })
}

const [wrangler, routes, ...sources] = await Promise.all([
  readFile(resolve(packageRoot, 'wrangler.toml'), 'utf8'),
  readFile(resolve(packageRoot, 'public/_routes.json'), 'utf8'),
  ...['src/PontoApp.tsx', 'src/PontoAuth.tsx', 'src/PontoModule.tsx', 'functions/api/auth/[[path]].ts', 'functions/api/insumos/health.ts', 'functions/api/ponto/[[path]].ts', 'functions/_lib/pontoAuth.ts']
    .map((relative) => readFile(resolve(packageRoot, relative), 'utf8')),
])

if (!wrangler.includes('name = "skincos-ponto-pages-phase1-unconfigured"')) throw new Error('PONTO_WRANGLER_PHASE1_NAME_MISSING')
if (/^\s*(account_id|route|routes|zone_id)\s*=/m.test(wrangler)) throw new Error('PONTO_WRANGLER_MUST_NOT_DECLARE_LIVE_TARGET')
if (/(^|[^a-z])skincos-staging([^a-z]|$)|(^|[^a-z])name\s*=\s*"skincos"/i.test(wrangler)) throw new Error('PONTO_WRANGLER_LEGACY_PROJECT_FORBIDDEN')
const routeContract = JSON.parse(routes)
const expectedRoutes = ['/api/auth/*', '/api/insumos/health', '/api/ponto/*']
if (routeContract.version !== 1 || JSON.stringify(routeContract.include) !== JSON.stringify(expectedRoutes) || routeContract.exclude?.length) {
  throw new Error('PONTO_FUNCTION_ROUTE_CONTRACT_INVALID')
}
for (const source of sources) {
  if (source.includes('@/') || source.includes('crm/console')) throw new Error('PONTO_MONOREPO_IMPORT_FORBIDDEN')
}
if (!sources[5].includes("requireCsrfForMutations")) throw new Error('PONTO_CSRF_GUARD_MISSING')
if (!sources[4].includes("PONTO_INSUMOS_HEALTH_UNCONFIGURED")) throw new Error('PONTO_HEALTH_FAIL_CLOSED_MISSING')

process.stdout.write('Ponto Pages Phase 1 surface is source-only and fail-closed.\n')
