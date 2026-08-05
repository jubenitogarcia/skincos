import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchCommercialReferences,
  recordCommercialContactPermission,
  updateCommercialPolicy,
} from '../atendimentoApi'

describe('Clientes commercial scope and optimistic concurrency', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests commercial references from the server-scoped endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, units: [], professionals: [], procedures: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCommercialReferences()

    expect(fetchMock).toHaveBeenCalledWith('/api/atendimento/commercial/references', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }))
  })

  it('sends the permission revision and policy version with commercial writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await recordCommercialContactPermission('identity/1', {
      status: 'granted',
      source: 'consent-form',
      evidenceReference: 'record-1',
      expectedRevision: 4,
    })
    await updateCommercialPolicy({
      activeContactCooldownDays: 30,
      returnRiskThresholds: [90, 180],
      expectedPolicyVersion: 'policy-v4',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/atendimento/commercial/contact-permissions/identity%2F1', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        status: 'granted',
        source: 'consent-form',
        evidenceReference: 'record-1',
        expectedRevision: 4,
      }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/atendimento/commercial/policy', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        activeContactCooldownDays: 30,
        returnRiskThresholds: [90, 180],
        expectedPolicyVersion: 'policy-v4',
      }),
    }))
  })

  it('reloads the scoped profile or policy before reporting a stale-write conflict', () => {
    const source = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')

    expect(source).toContain('fetchCommercialReferences()')
    expect(source).toContain('expectedRevision: current.permissionRevision')
    expect(source).toContain("expectedPolicyVersion: overview?.policy.policyVersion || ''")
    expect(source).toMatch(/COMMERCIAL_CONTACT_PERMISSION_CONFLICT'\) \{\s*await onSaved\(\)/s)
    expect(source).toMatch(/COMMERCIAL_POLICY_CONFLICT'\) \{\s*await load\(\)/s)
    expect(source).toContain('key={`${profile.identityId}:${contactEligibility.permissionRevision}`}')
  })
})
