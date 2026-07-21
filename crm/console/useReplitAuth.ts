// Replit Auth Integration: Custom hook for authentication
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { consumeLocalAuthReset } from './localDevAuthReset'
import { isLocalTestUserAdmin } from './localAuthProfile'

export function useReplitAuth() {
  const queryClient = useQueryClient()
  if (typeof window !== 'undefined') {
    consumeLocalAuthReset(
      window.location,
      window.localStorage,
      (value) => { document.cookie = value },
      (url) => { window.history.replaceState(null, '', url) },
    )
  }
  const isLocalDevHost = typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  const localAuthBypassEnabled =
    !!import.meta.env.DEV &&
    isLocalDevHost &&
    String(localStorage.getItem('crm.localAuth') || 'on').toLowerCase() !== 'off'
  const localTestUserAdmin = isLocalTestUserAdmin(import.meta.env.VITE_LOCAL_AUTH_TEST_USER_ADMIN)
  const localRoleRaw = localTestUserAdmin
    ? 'GESTOR'
    : String(localStorage.getItem('crm.localRole') || import.meta.env.VITE_LOCAL_AUTH_ROLE || 'GESTOR').trim().toUpperCase()
  const localRole = localRoleRaw === 'ADMIN' ? 'GESTOR' : (localRoleRaw === 'OPERADOR' ? 'INJETOR' : localRoleRaw)
  const localEmail = String(localStorage.getItem('crm.localEmail') || import.meta.env.VITE_LOCAL_AUTH_EMAIL || 'dev@local.test')
  const localUsername = String(localStorage.getItem('crm.localUser') || localEmail.split('@')[0] || 'dev')
  const localDisplayName = String(localStorage.getItem('crm.localName') || import.meta.env.VITE_LOCAL_AUTH_NAME || 'Dev Local')
  const localUser = {
    id: localUsername,
    username: localUsername,
    name: localDisplayName,
    displayName: localDisplayName,
    email: localEmail,
    role: localRole,
    allowedUnits: [],
    allowedModules: [],
    createdAt: new Date().toISOString(),
    avatarUrl: undefined,
  }

  const { data: user, error, status } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 12000)
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
        signal: ac.signal,
        headers: { 'accept': 'application/json' }
      }).finally(() => clearTimeout(timer))

      if (!response.ok) {
        if (localAuthBypassEnabled && response.status === 401) {
          return localUser;
        }
        if (response.status === 401) {
          return null;
        }
        throw new Error(`Authentication check failed: ${response.statusText}`);
      }

      const me = await response.json().catch(() => null) as any;
      const insumosUser = me?.user || null;
      if (!insumosUser) return localAuthBypassEnabled ? localUser : null;

      const username = String(insumosUser.username || insumosUser.email || '').trim()
      const displayName = String(insumosUser.displayName || insumosUser.name || insumosUser.username || insumosUser.email || '')
      const allowedUnits = Array.isArray(insumosUser.allowedUnits) ? insumosUser.allowedUnits : undefined
      const allowedModules = Array.isArray(insumosUser.allowedModules) ? insumosUser.allowedModules : undefined

      return {
        id: username,
        username,
        name: displayName,
        displayName,
        email: String(insumosUser.email || ''),
        role: insumosUser.role ? String(insumosUser.role) : undefined,
        allowedUnits,
        allowedModules,
        createdAt: String(insumosUser.createdAt || new Date().toISOString()),
        avatarUrl: insumosUser.photoUrl ? String(insumosUser.photoUrl) : undefined,
      };
    },
    retry: false,
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    enabled: !!queryClient,
  });

  const safeUser = user ?? (localAuthBypassEnabled ? localUser : null)

  return {
    user: safeUser,
    isLoading: status === 'pending',
    isAuthenticated: !!safeUser,
    error: error ?? null
  };
}
