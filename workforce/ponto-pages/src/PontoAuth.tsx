import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { csrfHeader } from './csrf'

export type PontoAuthUser = {
  id: string
  username: string
  name: string
  displayName?: string
  email: string
  role?: string
  allowedUnits?: string[]
}

type PontoAuthContextValue = {
  user: PontoAuthUser | null
  loading: boolean
  initializing: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string, inviteToken: string) => Promise<void>
  previewSignupInvite: (inviteToken: string) => Promise<{ email: string; expiresAt: string }>
  requestPasswordReset: (email: string) => Promise<{ expiresAt: string }>
  verifyPasswordResetCode: (email: string, code: string) => Promise<{ resetGrant: string; expiresAt: string }>
  resetPassword: (resetGrant: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const PontoAuthContext = createContext<PontoAuthContextValue | undefined>(undefined)

function readJson(value: string): any {
  try { return value ? JSON.parse(value) : null } catch { return null }
}

function mapUser(payload: any): PontoAuthUser | null {
  const raw = payload?.user || payload?.usuario || null
  if (!raw) return null
  const email = String(raw.email || '').trim()
  const username = String(raw.username || email || raw.id || '').trim()
  if (!username) return null
  const displayName = String(raw.displayName || raw.name || username).trim()
  return {
    id: String(raw.id || username),
    username,
    name: displayName,
    displayName,
    email,
    role: raw.role ? String(raw.role) : undefined,
    allowedUnits: Array.isArray(raw.allowedUnits) ? raw.allowedUnits.map(String).filter(Boolean) : undefined,
  }
}

async function request(path: string, init: RequestInit = {}, timeoutMs = 45_000): Promise<any> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(path, { ...init, credentials: 'include', signal: controller.signal })
    const payload = readJson(await response.text())
    if (!response.ok) throw new Error(String(payload?.error || payload?.message || `HTTP ${response.status}`))
    return payload || {}
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Tempo limite. Tente novamente.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export function PontoAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PontoAuthUser | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    const payload = await request('/api/auth/me', { headers: { accept: 'application/json' } }, 15_000)
    const next = mapUser(payload)
    setUser(next)
    return next
  }, [])

  useEffect(() => {
    void refresh().catch(() => setUser(null)).finally(() => setInitializing(false))
  }, [refresh])

  const action = useCallback(async (path: string, body: Record<string, string>, after?: boolean) => {
    setLoading(true)
    try {
      const payload = await request(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
      if (after) {
        const next = await refresh()
        if (!next) throw new Error('A sessão não persistiu. Verifique os cookies e tente novamente.')
      }
      return payload
    } finally {
      setLoading(false)
    }
  }, [refresh])

  const value = useMemo<PontoAuthContextValue>(() => ({
    user,
    loading,
    initializing,
    signIn: async (email, password) => { await action('/api/auth/login', { email: email.trim(), password }, true) },
    signUp: async (name, email, password, token) => { await action('/api/auth/register', { name: name.trim(), email: email.trim(), password, token: token.trim() }, true) },
    previewSignupInvite: async (token) => {
      const payload = await action('/api/auth/invite/preview', { token: token.trim() })
      const email = String(payload?.email || '').trim().toLowerCase()
      if (!email) throw new Error('O convite não contém um e-mail válido.')
      return { email, expiresAt: String(payload?.expiresAt || '') }
    },
    requestPasswordReset: async (email) => {
      const payload = await action('/api/auth/password/request', { email: email.trim().toLowerCase() })
      return { expiresAt: String(payload?.expiresAt || '') }
    },
    verifyPasswordResetCode: async (email, code) => {
      const payload = await action('/api/auth/password/verify', { email: email.trim().toLowerCase(), code: code.trim() })
      if (!payload?.resetGrant) throw new Error('Não foi possível validar o código. Solicite outro.')
      return { resetGrant: String(payload.resetGrant), expiresAt: String(payload?.expiresAt || '') }
    },
    resetPassword: async (resetGrant, password) => { await action('/api/auth/password/reset', { resetGrant, password }, true) },
    signOut: async () => {
      setLoading(true)
      try { await request('/api/auth/logout', { method: 'POST', headers: { accept: 'application/json', ...csrfHeader() } }); setUser(null) } finally { setLoading(false) }
    },
  }), [action, initializing, loading, user])
  return <PontoAuthContext.Provider value={value}>{children}</PontoAuthContext.Provider>
}

export function useAuth(): PontoAuthContextValue {
  const value = useContext(PontoAuthContext)
  if (!value) throw new Error('useAuth must be used inside PontoAuthProvider')
  return value
}
