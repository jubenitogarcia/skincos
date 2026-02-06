// Replit Auth Integration: Custom hook for authentication
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function useReplitAuth() {
  const queryClient = useQueryClient()

  const { data: user, error, status } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 12000)
      const response = await fetch('/api/auth/me', {
        credentials: 'include', // Important for cookies/sessions
        signal: ac.signal,
        headers: { 'accept': 'application/json' }
      }).finally(() => clearTimeout(timer))

      if (!response.ok) {
        if (response.status === 401) {
          return null;
        }
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

      return mapped;
    },
    retry: false, // Don't retry on 401
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    enabled: !!queryClient,
  });

  const safeUser = user ?? null

  const result = {
    user: safeUser,
    isLoading: status === 'pending',
    isAuthenticated: !!safeUser,
    error: error ?? null
  };

  return result;
}
