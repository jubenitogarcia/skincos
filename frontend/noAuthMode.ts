// NO_AUTH MODE: Utility functions for NO_AUTH mode detection
// Security rule:
// - NO_AUTH is only allowed when explicitly enabled AND running on localhost.
// - Never enable automatically in dev: we still want to test real auth flows by default.

export const isNoAuthMode = (): boolean => {
  const explicit = import.meta.env.VITE_NO_AUTH === 'true'

  let hostname = ''
  try {
    hostname = typeof window !== 'undefined' ? window.location.hostname : ''
  } catch {
    hostname = ''
  }

  const isLocalhost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local')

  const result = Boolean(explicit && isLocalhost)

  if (import.meta.env.DEV) {
    console.log('[NO_AUTH MODE] Auth mode check:', {
      explicit,
      hostname,
      isLocalhost,
      finalResult: result,
    })
  }

  return result
}

// NO_AUTH MODE: Mock user for development and no-auth mode
export const getMockUser = () => ({
  id: 'mock-user-dev',
  username: 'mock-user-dev',
  name: 'Dev User (NO_AUTH)',
  displayName: 'Dev User (NO_AUTH)',
  email: 'dev@noauth.local',
  role: 'ADMIN',
  allowedUnits: [],
  allowedModules: [],
  createdAt: new Date().toISOString(),
  avatarUrl: undefined,
})

export const logNoAuthMode = (context: string, action: string) => {
  if (isNoAuthMode()) {
    console.log(`[NO_AUTH MODE] ${context}: ${action}`)
  }
}
