import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import rolePolicy from '../modules/localRolePolicy.json'
import catalog from '../modules/localLaunchCatalog.json'
import { hasCrmModuleAccess } from '../crmRoleAccess'

const apiSource = readFileSync(new URL('../atendimentoApi.ts', import.meta.url), 'utf8')
const moduleSource = readFileSync(new URL('../ClinicalApprovalModule.tsx', import.meta.url), 'utf8')

describe('clinical approval RBAC and fail-closed contract', () => {
  it('gives the independent role only its fixed approval workspace', () => {
    expect(rolePolicy.fixedModuleGrants.CLINICAL_APPROVER).toEqual(['clinical-approvals'])
    expect(rolePolicy.restrictedRoleModules.CLINICAL_APPROVER).toEqual(['clinical-approvals'])
    expect(hasCrmModuleAccess('CLINICAL_APPROVER', ['clientes'], 'clientes')).toBe(false)
    expect(hasCrmModuleAccess('CLINICAL_APPROVER', ['clinical-approvals'], 'clinical-approvals')).toBe(true)
    expect(hasCrmModuleAccess('GERENTE', ['clinical-approvals'], 'clinical-approvals')).toBe(false)
  })

  it('keeps the approval module offline-only in the launch catalog', () => {
    const entry = catalog.modules.find((item) => item.key === 'clinical-approvals')
    expect(entry?.onlineEnabled).toBe(false)
    expect(entry?.route).toBe('/?module=clinical-approvals')
  })

  it('uses the independent API boundary and contains no messaging action', () => {
    expect(apiSource).toContain("/clinical/approvals")
    expect(apiSource).not.toContain("/clinical/approvals/send")
    expect(moduleSource).toContain('Nenhuma regra aprovada é convertida automaticamente em recomendação clínica.')
    expect(moduleSource).not.toMatch(/sendMessage|sendText|campaign/i)
  })
})
