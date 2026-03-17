import { describe, expect, it } from 'vitest'

import { __testables } from '../escalaApi'

describe('escalaApi helpers', () => {
  it('parses valid JSON payloads', () => {
    expect(__testables.parseJsonResponse('{"ok":true}')).toEqual({ ok: true })
  })

  it('returns null for invalid JSON payloads', () => {
    expect(__testables.parseJsonResponse('{invalid')).toBeNull()
  })

  it('prefers explicit API errors from JSON payloads', () => {
    const response = new Response(JSON.stringify({ ok: false }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })

    expect(__testables.normalizeApiError(response, { error: 'status_unavailable' }, '')).toBe('status_unavailable')
  })

  it('keeps fetch error guidance actionable', () => {
    expect(__testables.normalizeFetchError(new Error('socket hang up'))).toContain('/api/escala/_proxy-status')
  })
})
