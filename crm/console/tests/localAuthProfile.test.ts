import { describe, expect, it } from 'vitest'
import { isLocalTestUserAdmin } from '../localAuthProfile'

describe('local auth profile', () => {
  it('keeps the default local test account privileged', () => {
    expect(isLocalTestUserAdmin(undefined)).toBe(true)
    expect(isLocalTestUserAdmin('true')).toBe(true)
  })

  it('lets a local role-specific shortcut disable the privileged fallback', () => {
    expect(isLocalTestUserAdmin('false')).toBe(false)
    expect(isLocalTestUserAdmin('FALSE')).toBe(false)
  })
})
