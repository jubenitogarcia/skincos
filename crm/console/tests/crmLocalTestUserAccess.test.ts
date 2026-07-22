import { describe, expect, it } from 'vitest'
import { getLocalDevAuthUser } from '../functions/_lib/crmAuth'

function context(env: Record<string, string | undefined>) {
  return { env }
}

describe('local CRM test user', () => {
  it('keeps the configured Consultor profile restricted by default', () => {
    const user = getLocalDevAuthUser(context({
      LOCAL_AUTH_ROLE: 'CONSULTOR',
      LOCAL_AUTH_ALLOWED_MODULES: 'atendimento,ponto',
    }))

    expect(user.role).toBe('CONSULTOR')
    expect(user.allowedModules).toEqual(['atendimento'])
  })

  it('does not expand Consultor modules when the local admin compatibility flag is disabled', () => {
    const user = getLocalDevAuthUser(context({
      LOCAL_AUTH_TEST_USER_ADMIN: 'false',
      LOCAL_AUTH_ROLE: 'CONSULTOR',
      LOCAL_AUTH_ALLOWED_MODULES: 'atendimento,ponto',
    }))

    expect(user.role).toBe('CONSULTOR')
    expect(user.allowedModules).toEqual(['atendimento'])
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
      allowedModules: ['atendimento'],
    })
  })
})
