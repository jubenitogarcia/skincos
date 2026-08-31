import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Finance remote module boundary', () => {
  it('keeps the independently published module loader and isolated fallback in the CRM shell', () => {
    const remoteModule = readFileSync(new URL('../modules/RemoteFinanceModule.tsx', import.meta.url), 'utf8')

    expect(remoteModule).toContain('import(/* @vite-ignore */ remoteUrl)')
    expect(remoteModule).toContain('data-testid="finance-remote-unavailable"')
    expect(remoteModule).toContain('data-finance-remote-error')
    expect(remoteModule).toContain('remoteFailureKind(cause)')
    expect(remoteModule).toContain('A navegação e os demais módulos continuam disponíveis.')
    expect(remoteModule).not.toMatch(/from ['"]@\/FinanceModule['"]/)
  })
})
