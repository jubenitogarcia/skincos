import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(packageRoot, '../..')

describe('Ponto Pages Phase 1 release boundary', () => {
  it('keeps Pages unconfigured and exposes only Ponto functions', async () => {
    const [wrangler, routes] = await Promise.all([
      readFile(resolve(packageRoot, 'wrangler.toml'), 'utf8'),
      readFile(resolve(packageRoot, 'public/_routes.json'), 'utf8'),
    ])
    expect(wrangler).toContain('skincos-ponto-pages-phase1-unconfigured')
    expect(wrangler).not.toMatch(/^\s*(account_id|route|routes|zone_id)\s*=/m)
    expect(wrangler).not.toContain('name = "skincos"')
    expect(JSON.parse(routes)).toEqual({ version: 1, include: ['/api/auth/*', '/api/insumos/health', '/api/ponto/*'], exclude: [] })
  })

  it('makes the dedicated workflow source-only by default', async () => {
    const workflow = await readFile(resolve(repositoryRoot, '.github/workflows/deploy-ponto-pages.yml'), 'utf8')
    expect(workflow).toContain('default: false')
    expect(workflow).toContain('npm run check')
    expect(workflow).not.toMatch(/(?:wrangler|pages)\s+deploy/i)
    expect(workflow).not.toContain('CLOUDFLARE_API_TOKEN')
  })
})
