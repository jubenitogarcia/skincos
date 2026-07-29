import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

test('CRM shell records automatic accessibility results without side effects', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Insumos' })).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()
  const reportDir = path.resolve(process.env.AXE_ARTIFACT_DIR || '../../artifacts/axe')
  await mkdir(reportDir, { recursive: true })
  await writeFile(path.join(reportDir, `crm-shell-${testInfo.project.name}.json`), `${JSON.stringify(results, null, 2)}\n`, 'utf8')
  await testInfo.attach('axe-results.json', { body: JSON.stringify(results), contentType: 'application/json' })

  if (process.env.A11Y_ENFORCE === '1') {
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  }
})
