import React, { createContext, useContext, ReactNode, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useReplitAuth } from '../hooks/useReplitAuth'
import { logContextEvent } from '../debug/ContextDebugger'
import { createAuthHook } from '@/utils/createRequiredContextHook'
import { isNoAuthMode, logNoAuthMode } from '@/utils/noAuthMode'

export interface AuthUser {
    id: string
    name: string
    email: string
    createdAt: string
    avatarUrl?: string
}

interface AuthContextValue {
    user: AuthUser | null
    loading: boolean
    signIn: (email: string, password: string) => Promise<void>
    signUp: (name: string, email: string, password: string) => Promise<void>
    signOut: () => void
    updateProfile: (data: Partial<Pick<AuthUser, 'name' | 'avatarUrl'>>) => void
    token: string | null
    isAuthenticated: boolean
}

// HMR-stable singleton Context - survives hot reloads
const AuthContext = (import.meta.hot?.data.AuthCtx) ?? createContext<AuthContextValue | undefined>(undefined)
if (import.meta.hot) {
    import.meta.hot.dispose(d => { d.AuthCtx = AuthContext })
    import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

export function AuthProvider({ children }: { children: ReactNode }) {
    logContextEvent('AuthProvider', 'INITIALIZING', { timestamp: Date.now() })
    console.log('[AuthProvider] 🚀 Initializing AuthProvider...')
    
    // ALWAYS call hooks unconditionally - useReplitAuth now handles QueryClient availability internally
    const replitAuth = useReplitAuth()
    
    logContextEvent('AuthProvider', 'REPLIT_AUTH_CALLED', { 
        hasReplitAuth: !!replitAuth,
        hasUser: !!replitAuth?.user,
        isLoading: replitAuth?.isLoading
    })
    
    // Use values from useReplitAuth hook
    const user = replitAuth?.user || null
    const isLoading = replitAuth?.isLoading || false
    const isAuthenticated = replitAuth?.isAuthenticated || false
    
    // Show loading overlay only if auth is still loading
    // NO_AUTH MODE: Never show loading overlay in NO_AUTH mode
    const shouldShowLoadingOverlay = isLoading && !isNoAuthMode()
    
    console.log('[AuthProvider] 📊 Estado atual:', {
        hasReplitAuth: !!replitAuth,
        hasUser: !!user,
        isLoading,
        isAuthenticated,
        shouldShowLoadingOverlay
    })
    
    console.log('[AuthProvider] 🎯 QueryClient ready, initializing Replit Auth...')

    // Replit Auth - redirect to login
    const signIn = async (email: string, password: string) => {
        // NO_AUTH MODE: Bypass login redirect when in NO_AUTH mode
        if (isNoAuthMode()) {
            logNoAuthMode('AuthContext.signIn', 'Bypassing login redirect - already authenticated in NO_AUTH mode')
            return Promise.resolve()
        }
        
        // Note: Replit Auth doesn't use traditional email/password
        // It handles login through OpenID Connect providers
        window.location.href = '/api/login'
    }

    // Replit Auth - redirect to login (same as signIn since it handles registration too)
    const signUp = async (name: string, email: string, password: string) => {
        // NO_AUTH MODE: Bypass signup redirect when in NO_AUTH mode
        if (isNoAuthMode()) {
            logNoAuthMode('AuthContext.signUp', 'Bypassing signup redirect - already authenticated in NO_AUTH mode')
            return Promise.resolve()
        }
        
        // Note: Replit Auth handles registration through OpenID Connect providers
        window.location.href = '/api/login'
    }

    // Replit Auth - redirect to logout
    const signOut = () => {
        // NO_AUTH MODE: Bypass logout redirect when in NO_AUTH mode
        if (isNoAuthMode()) {
            logNoAuthMode('AuthContext.signOut', 'Bypassing logout redirect - staying authenticated in NO_AUTH mode')
            return
        }
        
        window.location.href = '/api/logout'
    }

    const updateProfile = (data: Partial<Pick<AuthUser, 'name' | 'avatarUrl'>>) => {
        // Note: Profile updates would need to be implemented via API
        // For now, this is a no-op as Replit manages user profiles
        console.warn('Profile updates not yet implemented with Replit Auth')
    }

    const value: AuthContextValue = {
        user,
        loading: isLoading,
        signIn,
        signUp,
        signOut,
        updateProfile,
        token: null, // Replit Auth manages tokens internally
        isAuthenticated
    }

    // Mark that AuthProvider is mounted
    useEffect(() => {
        if (typeof window !== 'undefined') {
            (window as any).__AUTH_PROVIDER_MOUNTED__ = true
        }
    }, [])
    
    logContextEvent('AuthProvider', 'RENDERING_PROVIDER', { 
        hasUser: !!user, 
        isLoading, 
        isAuthenticated 
    })
    
    return (
        <AuthContext.Provider value={value}>
            {shouldShowLoadingOverlay && (
                <div style={{ 
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    fontFamily: 'system-ui',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999
                }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🔄</div>
                        <div>Inicializando autenticação...</div>
                    </div>
                </div>
            )}
            {children}
        </AuthContext.Provider>
    )
}

// Create standardized hook with proper error handling
export const useAuth = createAuthHook(AuthContext)
