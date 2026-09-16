import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../../../.github/workflows/deploy-finance-ui.yml', import.meta.url),
  'utf8',
)

describe('Finance UI deployment rollback source selection', () => {
  it('selects the standalone package only when its immutable source is complete', () => {
    expect(workflow).toContain('Resolve Finance UI artifact layout')
    expect(workflow).toContain('id: source-layout')
    expect(workflow).toContain('finance/ui/package.json')
    expect(workflow).toContain('finance/ui/package-lock.json')
    expect(workflow).toContain('finance/ui/vite.config.ts')
    expect(workflow).toContain('layout=standalone')
    expect(workflow).toContain('artifact_directory=dist')
  })

  it('keeps a fail-closed legacy source path for rollback SHAs before extraction', () => {
    expect(workflow).toContain('crm/console/package-lock.json')
    expect(workflow).toContain('crm/console/vite.finance.config.ts')
    expect(workflow).toContain('crm/console/finance-remote/entry.tsx')
    expect(workflow).toContain('layout=legacy-crm-console')
    expect(workflow).toContain('artifact_directory=dist-finance')
    expect(workflow).toContain('legacy-crm-console) npx vite build --config vite.finance.config.ts')
    expect(workflow).toContain('The immutable release SHA has neither a standalone nor a legacy Finance UI artifact source.')
  })

  it('uses the selected immutable layout for cache, install, build and artifact publication', () => {
    expect(workflow).toContain('cache-dependency-path: ${{ steps.source-layout.outputs.package_lock }}')
    expect(workflow).toContain('working-directory: ${{ steps.source-layout.outputs.working_directory }}')
    expect(workflow).toContain('FINANCE_UI_ARTIFACT_DIRECTORY: ${{ steps.source-layout.outputs.artifact_directory }}')
    expect(workflow).toContain('cp -R "$FINANCE_UI_ARTIFACT_DIRECTORY"/. "$FINANCE_PAGES_DIR/"')
  })
})
