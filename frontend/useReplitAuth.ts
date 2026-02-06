// Replit Auth Integration: Custom hook for authentication
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { isNoAuthMode, getMockUser, logNoAuthMode } from '@/noAuthMode';

export function useReplitAuth() {
  if (import.meta.env.DEV) console.log('[useReplitAuth] 🔍 Starting authentication check...')
  
  const noAuth = isNoAuthMode()
  if (noAuth) {
    logNoAuthMode('useReplitAuth', 'NO_AUTH mode enabled - returning mock user')
  }

  const queryClient = useQueryClient()
  if (import.meta.env.DEV) console.log('[useReplitAuth] ✅ QueryClient acessível:', !!queryClient)
  
  const [authChecked, setAuthChecked] = useState(noAuth)

  const { data: user, error, status } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      if (import.meta.env.DEV) console.log('[useReplitAuth] 📡 Fetching user authentication status...')
      
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 12000)
      const response = await fetch('/api/auth/me', {
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

      const username = String(insumosUser.username || insumosUser.email || '').trim()
      const displayName = String(insumosUser.displayName || insumosUser.name || insumosUser.username || insumosUser.email || '')
      const allowedUnits = Array.isArray(insumosUser.allowedUnits) ? insumosUser.allowedUnits : undefined
      const allowedModules = Array.isArray(insumosUser.allowedModules) ? insumosUser.allowedModules : undefined

      const mapped = {
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

      if (import.meta.env.DEV) console.log('[useReplitAuth] ✅ User authenticated:', mapped)
      return mapped;
    },
    retry: false, // Don't retry on 401
    staleTime: 30 * 1000,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    enabled: !noAuth && !!queryClient, // In NO_AUTH mode we bypass /me entirely
  });

  useEffect(() => {
    if (!noAuth && !authChecked && status !== 'loading') {
      setAuthChecked(true)
    }
  }, [authChecked, noAuth, status])

  const safeUser = noAuth ? getMockUser() : (authChecked ? (user ?? null) : null)

  const result = {
    user: safeUser,
    isLoading: noAuth ? false : !authChecked,
    isAuthenticated: noAuth ? true : (authChecked && !!safeUser),
    error: noAuth ? null : error
  };
  
  if (import.meta.env.DEV) {
    console.log('[useReplitAuth] 📋 Hook result:', {
      hasUser: !!safeUser,
      isLoading: noAuth ? false : !authChecked,
      isAuthenticated: noAuth ? true : (authChecked && !!safeUser),
      hasError: noAuth ? false : !!error
    })
  }
  
  return result;
}
