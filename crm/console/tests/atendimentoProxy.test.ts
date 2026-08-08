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
    expect(__testables.hasModuleAccess({ role: 'CONSULTOR', allowedModules: [] })).toBe(true)
  })

  it('keeps Clientes endpoints exclusive to GESTOR before proxying', () => {
    expect(__testables.hasCommercialAccess({ role: 'GESTOR' }, '/commercial/overview')).toBe(true)
    expect(__testables.hasCommercialAccess({ role: 'ADMIN' }, '/commercial/actions')).toBe(true)
    expect(__testables.hasCommercialAccess({ role: 'GERENTE' }, '/commercial/overview')).toBe(false)
    expect(__testables.hasCommercialAccess({ role: 'GERENTE' }, '/overview')).toBe(true)
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
        'idempotency-key': 'att-123',
        'x-custom': 'drop-me',
      },
    })
    const headers = __testables.buildUpstreamHeaders(request, 'req-1')
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('idempotency-key')).toBe('att-123')
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
      isGlobalAdmin: true,
      allowedUnits: ['Novo Hamburgo'],
      allowedModules: ['atendimento'],
    })
  })

  it('narrows legacy consultant accounts to Atendimento before signing the actor', () => {
    expect(__testables.toAtendimentoActor({
      id: 'consultor-1',
      role: 'CONSULTOR',
      allowedModules: [],
    }).allowedModules).toEqual(['atendimento'])
  })

  it('requires the dedicated actor key and never falls back to a shared module key', () => {
    expect(__testables.resolveAtendimentoActorHmacKey({
      ATENDIMENTO_ACTOR_HMAC_KEY: '',
      ESCALA_ACTOR_HMAC_KEY: 'escala-secret',
      CRM_ESCALA_HMAC_KEY: 'crm-escala-secret',
    })).toBe('')
    expect(__testables.resolveAtendimentoActorHmacKey({
      ATENDIMENTO_ACTOR_HMAC_KEY: 'dedicated-secret',
    })).toBe('dedicated-secret')
  })

  it('ignores placeholder actor keys before falling back', () => {
    expect(__testables.resolveAtendimentoActorHmacKey({
      ATENDIMENTO_ACTOR_HMAC_KEY: '__CONFIGURE_REAL_ATENDIMENTO_HMAC_KEY__',
      ESCALA_ACTOR_HMAC_KEY: 'escala-secret',
    })).toBe('')
  })

  it('accepts only a dedicated URL target and rejects remote plaintext or embedded credentials', () => {
    expect(__testables.resolveAtendimentoTarget({
      ATENDIMENTO_API_TARGET: 'https://crm-atendimento.skincos.com.br/root',
      CRM_API_TARGET: 'https://shared-crm.invalid',
    })).toBe('https://crm-atendimento.skincos.com.br/root')
    expect(__testables.resolveAtendimentoTarget({ CRM_API_TARGET: 'https://shared-crm.invalid' })).toBe('')
    expect(__testables.resolveAtendimentoTarget({ ATENDIMENTO_API_TARGET: 'http://shared-crm.invalid' })).toBe('')
    expect(__testables.resolveAtendimentoTarget({ ATENDIMENTO_API_TARGET: 'https://user:secret@crm-atendimento.skincos.com.br' })).toBe('')
  })

  it('binds signature v2 to method, exact upstream path, actor and nonce', () => {
    expect(__testables.actorSignatureMessage(
      '1000',
      'n'.repeat(32),
      'GET',
      '/api/atendimento/commercial/policy?unit=synthetic',
      'actor-payload',
    )).toBe(`atendimento-actor/v2.1000.${'n'.repeat(32)}.GET./api/atendimento/commercial/policy?unit=synthetic.actor-payload`)
    expect(__testables.signedPath('https://crm-atendimento.skincos.com.br/root/api/atendimento/overview?unit=synthetic'))
      .toBe('/root/api/atendimento/overview?unit=synthetic')
  })

  it('does not expose upstream transport details to the browser', async () => {
    const response = __testables.upstreamUnavailableResponse('req-safe')
    expect(response.status).toBe(502)
    expect(response.headers.get('x-request-id')).toBe('req-safe')
    expect(await response.json()).toEqual({ ok: false, error: 'UPSTREAM_UNREACHABLE' })
  })
})
