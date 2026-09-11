import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Finance UI artifact boundary', () => {
  it('owns the mount contract, source entrypoint and styles without importing CRM source', () => {
    const entry = readFileSync(new URL('../src/entry.tsx', import.meta.url), 'utf8')
    const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

    expect(entry).toContain('export function mount(element: HTMLElement)')
    expect(entry).toContain("import financeStyles from './styles.css?inline'")
    expect(entry).toContain("const styleId = 'skincos-finance-ui-styles'")
    expect(entry).toContain('ensureStyles()')
    expect(entry).toContain('<Toaster')
    expect(entry).not.toContain('crm/console')
    expect(config).toContain("resolve(packageRoot, 'src/entry.tsx')")
    expect(config).toContain("outDir: 'dist'")
    expect(config).toContain('codeSplitting: false')
    expect(config).toContain("'process.env.NODE_ENV': '\"production\"'")
  })
})
