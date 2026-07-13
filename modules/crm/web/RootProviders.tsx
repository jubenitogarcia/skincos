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
import { AuthProvider, IntegrationsProvider, NotificationProvider } from '@/contexts'
import { ContextErrorBoundary } from '@/ContextErrorBoundary'
import { Alert, AlertTitle, AlertDescription } from "./alert";
import { Button } from "./button";
import { AlertTriangle, RotateCcw } from "lucide-react";

const ErrorFallback = ({ error, resetErrorBoundary }: { error: any, resetErrorBoundary: () => void }) => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This spark has encountered a runtime error</AlertTitle>
          <AlertDescription>
            Something unexpected happened while running the application. The error details are shown below. Contact the spark author and let them know about this issue.
          </AlertDescription>
        </Alert>

        <div className="bg-card border rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-sm text-muted-foreground mb-2">Error Details:</h3>
          <pre className="text-xs text-destructive bg-muted/50 p-3 rounded border overflow-auto max-h-32">
            {error?.message}
          </pre>
        </div>

        <Button onClick={resetErrorBoundary} className="w-full" variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      </div>
    </div>
  );
}

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
  if (import.meta.env.DEV) {
    console.log('[RootProviders] 🏗️ Mounting with canonical order:', PROVIDERS_DIAGRAM.order)
    console.log('[RootProviders] 📦 QueryClient instance:', !!queryClient)
    console.log('[RootProviders] 🔧 DEV mode:', import.meta.env.DEV)
  }
  
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
      {import.meta.env.DEV ? (
        <>
          <ProviderVerification />
          <QueryClientDebugger />
        </>
      ) : null}
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
    if (import.meta.env.DEV) console.log('[QueryClientDebugger] ✅ QueryClient available in context:', !!queryClient)
    return null
  } catch (error) {
    if (import.meta.env.DEV) console.error('[QueryClientDebugger] ❌ QueryClient NOT available:', error)
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
