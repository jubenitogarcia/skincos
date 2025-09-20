// Replit Auth Integration: Custom hook for authentication
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isNoAuthMode, getMockUser, logNoAuthMode } from '@/utils/noAuthMode';

export function useReplitAuth() {
  console.log('[useReplitAuth] 🔍 Starting authentication check...')
  
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
    console.log('[useReplitAuth] ✅ QueryClient acessível:', !!queryClient)
  } catch (error) {
    console.error('[useReplitAuth] ❌ QueryClient não disponível:', error)
  }
  
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      console.log('[useReplitAuth] 📡 Fetching user authentication status...')
      
      const response = await fetch('/api/auth/user', {
        credentials: 'include' // Important for cookies/sessions
      });
      
      console.log('[useReplitAuth] 📊 Response status:', response.status, response.statusText)
      
      if (!response.ok) {
        if (response.status === 401) {
          console.log('[useReplitAuth] 🚫 User not authenticated (401)')
          return null;
        }
        console.log('[useReplitAuth] ❌ Authentication check failed:', response.statusText)
        throw new Error(`Authentication check failed: ${response.statusText}`);
      }
      
      const userData = await response.json();
      console.log('[useReplitAuth] ✅ User authenticated:', userData)
      return userData;
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
  
  console.log('[useReplitAuth] 📋 Hook result:', {
    hasUser: !!user,
    isLoading,
    isAuthenticated: !!user,
    hasError: !!error
  })
  
  return result;
}