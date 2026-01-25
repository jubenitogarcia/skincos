// Replit Auth Integration: Custom hook for authentication
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isNoAuthMode, getMockUser, logNoAuthMode } from '@/noAuthMode';

export function useReplitAuth() {
  if (import.meta.env.DEV) console.log('[useReplitAuth] 🔍 Starting authentication check...')
  
  // NO_AUTH MODE: Bypass authentication completely when in NO_AUTH mode
  if (isNoAuthMode()) {
    logNoAuthMode('useReplitAuth', 'Bypassing authentication - returning mock user')
    const mockUser = getMockUser()
    return {
      user: mockUser,
      isLoading: false, // NO_AUTH MODE: No loading in development
      isAuthenticated: true, // NO_AUTH MODE: Always authenticated in development
      error: null
    };
  }
  
  // Check if QueryClient is available
  let queryClient: any = null
  try {
    queryClient = useQueryClient()
    if (import.meta.env.DEV) console.log('[useReplitAuth] ✅ QueryClient acessível:', !!queryClient)
  } catch (error) {
    if (import.meta.env.DEV) console.error('[useReplitAuth] ❌ QueryClient não disponível:', error)
  }
  
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/insumos/auth/me"],
    queryFn: async () => {
      if (import.meta.env.DEV) console.log('[useReplitAuth] 📡 Fetching user authentication status...')
      
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 12000)
      const response = await fetch('/api/insumos/auth/me', {
        credentials: 'include', // Important for cookies/sessions
        signal: ac.signal,
        headers: { 'accept': 'application/json' }
      }).finally(() => clearTimeout(timer))
      
      if (import.meta.env.DEV) console.log('[useReplitAuth] 📊 Response status:', response.status, response.statusText)
      
      if (!response.ok) {
        if (response.status === 401) {
          if (import.meta.env.DEV) console.log('[useReplitAuth] 🚫 User not authenticated (401)')
          return null;
        }
        if (import.meta.env.DEV) console.log('[useReplitAuth] ❌ Authentication check failed:', response.statusText)
        throw new Error(`Authentication check failed: ${response.statusText}`);
      }
      
      const me = await response.json().catch(() => null) as any;
      const insumosUser = me?.user || null;
      if (!insumosUser) return null;

      const mapped = {
        id: String(insumosUser.username || insumosUser.email || ''),
        name: String(insumosUser.displayName || insumosUser.name || insumosUser.username || insumosUser.email || ''),
        email: String(insumosUser.email || ''),
        createdAt: String(insumosUser.createdAt || new Date().toISOString()),
        avatarUrl: insumosUser.photoUrl ? String(insumosUser.photoUrl) : undefined,
      };

      if (import.meta.env.DEV) console.log('[useReplitAuth] ✅ User authenticated:', mapped)
      return mapped;
    },
    retry: false, // Don't retry on 401
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!queryClient, // CRITICAL: Only run if QueryClient is available
  });

  const result = {
    user,
    isLoading,
    isAuthenticated: !!user,
    error
  };
  
  if (import.meta.env.DEV) {
    console.log('[useReplitAuth] 📋 Hook result:', {
      hasUser: !!user,
      isLoading,
      isAuthenticated: !!user,
      hasError: !!error
    })
  }
  
  return result;
}
