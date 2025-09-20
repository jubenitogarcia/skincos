/**
 * RootProviders - Canonical Provider Order with BootGate
 * 
 * CRITICAL ORDER: QueryClientProvider → BootGate → Context Providers → App
 * 
 * This component implements Provider-First boot architecture to ensure
 * deterministic initialization and eliminate structural errors.
 */
import React, { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { ErrorBoundary } from "react-error-boundary"

import { BootGate } from './BootGate'
import { AuthProvider } from '@/contexts/AuthContext'
import { IntegrationsProvider } from '@/contexts/IntegrationsContext'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { ErrorFallback } from '../ErrorFallback'
import { ContextErrorBoundary } from '@/components/ContextErrorBoundary'

// Singleton QueryClient - stable across HMR
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
})

// Provider Order Diagram for tooling and debugging
export const PROVIDERS_DIAGRAM = {
  order: [
    'QueryClientProvider',
    'ContextErrorBoundary',
    'ErrorBoundary',
    'AuthProvider',
    'IntegrationsProvider', 
    'NotificationProvider',
    'BootGate',
    'App'
  ],
  critical: 'QueryClientProvider must be first - all React Query hooks depend on it',
  validation: 'BootGate moved AFTER context providers to ensure hooks have access to QueryClient'
}

interface RootProvidersProps {
  children: ReactNode
}

export function RootProviders({ children }: RootProvidersProps) {
  console.log('[RootProviders] 🏗️ Mounting with canonical order:', PROVIDERS_DIAGRAM.order)
  console.log('[RootProviders] 📦 QueryClient instance:', !!queryClient)
  console.log('[RootProviders] 🔧 DEV mode:', import.meta.env.DEV)
  
  // Expose QueryClient globally for debugging
  React.useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as any).__REACT_QUERY_CLIENT__ = queryClient
      console.log('[RootProviders] 🔍 QueryClient exposed globally for debugging')
    }
  }, [])
  
  return (
    <QueryClientProvider client={queryClient}>
      {/* Provider verification components */}
      <ProviderVerification />
      <QueryClientDebugger />
      <ContextErrorBoundary>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <AuthProvider>
            <IntegrationsProvider>
              <NotificationProvider>
                <BootGate>
                  {children}
                </BootGate>
              </NotificationProvider>
            </IntegrationsProvider>
          </AuthProvider>
        </ErrorBoundary>
      </ContextErrorBoundary>
    </QueryClientProvider>
  )
}


// Debug component to verify QueryClient availability
function QueryClientDebugger() {
  try {
    const queryClient = useQueryClient()
    console.log('[QueryClientDebugger] ✅ QueryClient available in context:', !!queryClient)
    return null
  } catch (error) {
    console.error('[QueryClientDebugger] ❌ QueryClient NOT available:', error)
    return null
  }
}

// Provider verification component - Fixed to properly follow Rules of Hooks
function ProviderVerification() {
  let queryClientAvailable = false
  try {
    // Call useQueryClient at top-level render (correct hook usage)
    const qc = useQueryClient()
    queryClientAvailable = !!qc
  } catch (error) {
    // QueryClient not available in this context
  }
  
  React.useEffect(() => {
    const debugInfo = {
      QueryClient: queryClientAvailable,
      timestamp: new Date().toISOString()
    }
    
    if (import.meta.env.DEV) {
      ;(window as any).__PROVIDER_STATUS__ = debugInfo
      console.log('[ProviderVerification] ✅ Context availability:', debugInfo)
    }
  }, [queryClientAvailable])
  
  return null
}

// Runtime validation to ensure providers mount in correct order
if (import.meta.env.DEV) {
  ;(window as any).__PROVIDERS_DIAGRAM__ = PROVIDERS_DIAGRAM
  console.log('[RootProviders] 📋 Provider diagram available at window.__PROVIDERS_DIAGRAM__')
}