import { describe, expect, it } from 'vitest'
import { getLocalDevAuthUser } from '../functions/_lib/crmAuth'

function context(env: Record<string, string | undefined>) {
  return { env }
}

describe('local CRM test user', () => {
  it('uses Gestor and no module restriction by default', () => {
    const user = getLocalDevAuthUser(context({
      LOCAL_AUTH_ROLE: 'CONSULTOR',
      LOCAL_AUTH_ALLOWED_MODULES: 'atendimento,ponto',
    }))

    expect(user.role).toBe('GESTOR')
    expect(user.allowedModules).toBeUndefined()
  })

  it('permits an explicit opt-out for restricted-role checks', () => {
    const user = getLocalDevAuthUser(context({
      LOCAL_AUTH_TEST_USER_ADMIN: 'false',
      LOCAL_AUTH_ROLE: 'CONSULTOR',
      LOCAL_AUTH_ALLOWED_MODULES: 'atendimento,ponto',
    }))

    expect(user.role).toBe('CONSULTOR')
    expect(user.allowedModules).toEqual(['atendimento', 'ponto'])
  })

  it('keeps the synthetic Consultor identity stable for local validation', () => {
    const user = getLocalDevAuthUser(context({
      LOCAL_AUTH_TEST_USER_ADMIN: 'false',
      LOCAL_AUTH_ROLE: 'CONSULTOR',
      LOCAL_AUTH_EMAIL: 'consultor.local@local.test',
      LOCAL_AUTH_USERNAME: 'consultor-local',
      LOCAL_AUTH_NAME: 'Consultor Local',
      LOCAL_AUTH_ALLOWED_MODULES: 'atendimento,ponto',
    }))

    expect(user).toMatchObject({
      id: 'consultor-local',
      username: 'consultor-local',
      email: 'consultor.local@local.test',
      displayName: 'Consultor Local',
      role: 'CONSULTOR',
      allowedModules: ['atendimento', 'ponto'],
    })
  })
})
