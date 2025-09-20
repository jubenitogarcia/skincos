// NO_AUTH MODE: Utility functions for NO_AUTH mode detection
// Checks for VITE_NO_AUTH=true or NODE_ENV=development to bypass authentication

export const isNoAuthMode = (): boolean => {
  // PRODUCTION SAFETY: NO_AUTH is NEVER enabled in production
  const IS_PRODUCTION = import.meta.env.PROD || 
                       import.meta.env.NODE_ENV === 'production' ||
                       (typeof process !== 'undefined' && process.env.NODE_ENV === 'production')
  
  if (IS_PRODUCTION) {
    console.log('[NO_AUTH MODE] Production environment detected - NO_AUTH mode disabled for security')
    return false
  }
  
  // Check explicit VITE_NO_AUTH flag (highest priority)
  const EXPLICIT_NO_AUTH = import.meta.env.VITE_NO_AUTH === 'true'
  
  // Check NODE_ENV=development (fallback)
  const IS_DEVELOPMENT = import.meta.env.DEV || 
                        import.meta.env.NODE_ENV === 'development' ||
                        (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')
  
  const result = EXPLICIT_NO_AUTH || IS_DEVELOPMENT
  
  console.log('[NO_AUTH MODE] Auth mode check:', {
    IS_PRODUCTION,
    EXPLICIT_NO_AUTH,
    IS_DEVELOPMENT,
    viteEnv: import.meta.env.DEV,
    finalResult: result
  })
  
  return result
}

// NO_AUTH MODE: Mock user for development and no-auth mode
export const getMockUser = () => ({
  id: 'mock-user-dev',
  name: 'Dev User (NO_AUTH)',
  email: 'dev@noauth.local',
  createdAt: new Date().toISOString(),
  avatarUrl: undefined
})

export const logNoAuthMode = (context: string, action: string) => {
  if (isNoAuthMode()) {
    console.log(`[NO_AUTH MODE] ${context}: ${action}`)
  }
}