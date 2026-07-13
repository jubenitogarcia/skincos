import { describe, expect, it } from 'vitest'

import { __testables } from '../functions/api/atendimento/[[path]].ts'

describe('Atendimento proxy helpers', () => {
  it('builds the upstream URL preserving base path and query string', () => {
    expect(
      __testables.buildTargetUrl(
        'https://crm-api.skincos.com.br/root',
        'https://crm.skincos.com.br/api/atendimento/attendances?unit=novo-hamburgo',
        '/attendances',
      ),
    ).toBe('https://crm-api.skincos.com.br/root/api/atendimento/attendances?unit=novo-hamburgo')
  })

  it('allows gestores and explicit module permissions', () => {
    expect(__testables.hasModuleAccess({ role: 'GESTOR', allowedModules: [] })).toBe(true)
    expect(__testables.hasModuleAccess({ role: 'INJETOR', allowedModules: ['atendimento'] })).toBe(true)
    expect(__testables.hasModuleAccess({ role: 'INJETOR', allowedModules: ['insumos'] })).toBe(false)
  })

  it('normalizes legacy roles', () => {
    expect(__testables.normalizeRole('ADMIN')).toBe('GESTOR')
    expect(__testables.normalizeRole('OPERADOR')).toBe('INJETOR')
  })

  it('forwards only safe headers to the Atendimento upstream', () => {
    const request = new Request('https://crm.skincos.com.br/api/atendimento/overview', {
      headers: {
        accept: 'application/json',
        authorization: 'Bearer secret',
        cookie: 'sid=secret',
        'content-type': 'application/json',
        'x-custom': 'drop-me',
      },
    })
    const headers = __testables.buildUpstreamHeaders(request, 'req-1')
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-request-id')).toBe('req-1')
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('cookie')).toBe(false)
    expect(headers.has('x-custom')).toBe(false)
  })

  it('normalizes the signed actor payload once before proxying', () => {
    expect(__testables.toAtendimentoActor({
      id: 12,
      username: 'user',
      email: 'user@example.test',
      displayName: 'User Test',
      role: 'ADMIN',
      allowedUnits: ['Novo Hamburgo'],
      allowedModules: ['atendimento'],
    })).toEqual({
      id: '12',
      username: 'user',
      email: 'user@example.test',
      name: 'User Test',
      role: 'GESTOR',
      allowedUnits: ['Novo Hamburgo'],
      allowedModules: ['atendimento'],
    })
  })

  it('falls back to escala keys when the dedicated atendimento key is absent', () => {
    expect(__testables.resolveAtendimentoActorHmacKey({
      ATENDIMENTO_ACTOR_HMAC_KEY: '',
      ESCALA_ACTOR_HMAC_KEY: 'escala-secret',
      CRM_ESCALA_HMAC_KEY: 'crm-escala-secret',
    })).toBe('escala-secret')
    expect(__testables.resolveAtendimentoActorHmacKey({
      CRM_ESCALA_HMAC_KEY: 'crm-escala-secret',
    })).toBe('crm-escala-secret')
  })

  it('ignores placeholder actor keys before falling back', () => {
    expect(__testables.resolveAtendimentoActorHmacKey({
      ATENDIMENTO_ACTOR_HMAC_KEY: '__CONFIGURE_REAL_ATENDIMENTO_HMAC_KEY__',
      ESCALA_ACTOR_HMAC_KEY: 'escala-secret',
    })).toBe('escala-secret')
  })

  it('allows unsigned local proxy only when localhost bypass is active and no real actor key exists', () => {
    expect(__testables.shouldAllowUnsignedLocalProxy({
      request: new Request('http://localhost:8791/api/atendimento/overview'),
      env: { LOCAL_AUTH_BYPASS: 'true' },
    }, '')).toBe(true)

    expect(__testables.shouldAllowUnsignedLocalProxy({
      request: new Request('https://crm.skincos.com.br/api/atendimento/overview'),
      env: { LOCAL_AUTH_BYPASS: 'true' },
    }, '')).toBe(false)

    expect(__testables.shouldAllowUnsignedLocalProxy({
      request: new Request('http://localhost:8791/api/atendimento/overview'),
      env: { LOCAL_AUTH_BYPASS: 'true' },
    }, 'real-secret')).toBe(false)
  })
})
