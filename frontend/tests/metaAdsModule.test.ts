import { describe, expect, it } from 'vitest'

import {
  buildMetaAdsHealthState,
  deriveMetaAdsConnectionMode,
  getDefaultMetaAdsTab,
  normalizeMetaAdsApiError,
} from '../metaAdsState'
import type { MetaAdsStatusResponse } from '../metaAdsTypes'

const baseStatus = (overrides: Partial<MetaAdsStatusResponse> = {}): MetaAdsStatusResponse => ({
  ok: true,
  oauthConfigured: true,
  missingConfig: [],
  connection: {
    connected: false,
    tokenType: null,
    metaUserId: null,
    metaUserName: null,
    selectedAdAccountId: null,
    scopes: [],
    updatedAt: null,
    expiresAt: null,
  },
  ...overrides,
})

describe('Meta Ads state helpers', () => {
  it('normalizes API errors with code, hint and retryable', () => {
    const error = new Error('Falha base')
    ;(error as any).status = 403
    ;(error as any).payload = {
      code: 'ADMIN_REQUIRED',
      message: 'Acesso restrito ao módulo Meta Ads.',
      hint: 'Este módulo exige GESTOR/GERENTE.',
      retryable: false,
    }

    expect(normalizeMetaAdsApiError(error)).toEqual({
      status: 403,
      code: 'ADMIN_REQUIRED',
      message: 'Acesso restrito ao módulo Meta Ads.',
      hint: 'Este módulo exige GESTOR/GERENTE.',
      retryable: false,
      payload: {
        code: 'ADMIN_REQUIRED',
        message: 'Acesso restrito ao módulo Meta Ads.',
        hint: 'Este módulo exige GESTOR/GERENTE.',
        retryable: false,
      },
    })
  })

  it('derives an unauthorized mode for login failures before generic disconnected', () => {
    expect(
      deriveMetaAdsConnectionMode({
        status: null,
        statusError: {
          code: 'UNAUTHORIZED',
          message: 'Faça login no CRM para continuar.',
          retryable: false,
          status: 401,
        },
        selectedAccount: null,
      }),
    ).toBe('unauthorized')
  })

  it('derives a connected-ready mode only after account selection', () => {
    const connectedStatus = baseStatus({
      connection: {
        connected: true,
        tokenType: 'oauth',
        metaUserId: '1',
        metaUserName: 'Jubenito',
        selectedAdAccountId: 'act_123',
        scopes: ['ads_read'],
        updatedAt: '2026-05-13T12:00:00.000Z',
        expiresAt: null,
      },
    })

    expect(
      deriveMetaAdsConnectionMode({
        status: connectedStatus,
        statusError: null,
        selectedAccount: { id: 'act_123', name: 'Conta Principal', isSelected: true },
      }),
    ).toBe('connected-ready')

    expect(
      deriveMetaAdsConnectionMode({
        status: connectedStatus,
        statusError: null,
        selectedAccount: null,
      }),
    ).toBe('connected-no-account')
  })

  it('prioritizes forbidden and misconfigured states before generic disconnected', () => {
    expect(
      deriveMetaAdsConnectionMode({
        status: null,
        statusError: {
          code: 'ADMIN_REQUIRED',
          message: 'Acesso restrito',
          retryable: false,
          status: 403,
        },
        selectedAccount: null,
      }),
    ).toBe('forbidden')

    expect(
      deriveMetaAdsConnectionMode({
        status: baseStatus({ oauthConfigured: false, missingConfig: ['META_APP_ID'] }),
        statusError: null,
        selectedAccount: null,
      }),
    ).toBe('misconfigured')
  })

  it('keeps the product flow centered on Conexão until setup is complete', () => {
    expect(getDefaultMetaAdsTab('disconnected')).toBe('connect')
    expect(getDefaultMetaAdsTab('unauthorized')).toBe('connect')
    expect(getDefaultMetaAdsTab('connected-no-account')).toBe('connect')
    expect(getDefaultMetaAdsTab('connected-ready')).toBe('overview')
  })

  it('builds a health banner that clarifies the difference between connection and account selection', () => {
    const health = buildMetaAdsHealthState({
      mode: 'connected-no-account',
      selectedAccount: null,
      status: baseStatus({
        connection: {
          connected: true,
          tokenType: 'manual',
          metaUserId: '1',
          metaUserName: 'Jubenito',
          selectedAdAccountId: null,
          scopes: ['ads_read'],
          updatedAt: '2026-05-13T12:00:00.000Z',
          expiresAt: null,
        },
      }),
      statusError: null,
    })

    expect(health).toMatchObject({
      mode: 'connected-no-account',
      tone: 'warning',
    })
    expect(health.description).toContain('Selecione a conta de anúncios')
  })

  it('builds a health banner that tells the user to log in again when unauthorized', () => {
    const health = buildMetaAdsHealthState({
      mode: 'unauthorized',
      selectedAccount: null,
      status: null,
      statusError: {
        code: 'UNAUTHORIZED',
        message: 'Faça login no CRM para continuar.',
        retryable: false,
        status: 401,
      },
    })

    expect(health).toMatchObject({
      mode: 'unauthorized',
      tone: 'danger',
      ctaTab: 'connect',
    })
    expect(health.title).toContain('Faça login')
  })
})
