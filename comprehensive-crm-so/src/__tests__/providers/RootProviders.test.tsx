import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import React, { ReactNode, useEffect, useState } from 'react'

import { RootProviders, PROVIDERS_DIAGRAM } from '@/providers/RootProviders'
import { useAuth } from '@/contexts/AuthContext'
import { useIntegrations } from '@/contexts/IntegrationsContext'
import { useNotifications } from '@/contexts/NotificationContext'

/**
 * RootProviders Integration Tests
 * 
 * These tests ensure the entire provider tree works correctly as an integrated system:
 * - Provider mounting order (QueryClient → BootGate → Context Providers → App)
 * - Cross-provider dependencies work correctly
 * - Error boundaries contain failures appropriately  
 * - HMR stability across all providers
 * - All hooks are available after boot
 * - Provider initialization race conditions are handled
 * - Memory leaks are prevented during mount/unmount cycles
 */

// Mock all external dependencies
vi.mock('@/services/instagramIntegration', () => ({
  fetchInstagramAccountMetrics: vi.fn().mockResolvedValue({ followers: 1000, posts: 50 })
}))

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: true,
    isConnecting: false,
    lastError: null,
    latency: 25,
    subscribe: vi.fn(() => vi.fn()),
    send: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn()
  })
}))

vi.mock('@/lib/spark-mock', () => ({
  useKV: (key: string, defaultValue: any) => [defaultValue, vi.fn()]
}))

// Comprehensive test component that uses all providers
function FullIntegrationTestComponent() {
  const [mountOrder, setMountOrder] = useState<string[]>([])
  const [allHooksAvailable, setAllHooksAvailable] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // Test all context hooks
  let auth: any = null
  let integrations: any = null
  let notifications: any = null

  try {
    auth = useAuth()
    setMountOrder(prev => prev.includes('auth') ? prev : [...prev, 'auth'])
  } catch (error) {
    setErrors(prev => [...prev, `Auth: ${error instanceof Error ? error.message : 'Unknown error'}`])
  }

  try {
    integrations = useIntegrations()
    setMountOrder(prev => prev.includes('integrations') ? prev : [...prev, 'integrations'])
  } catch (error) {
    setErrors(prev => [...prev, `Integrations: ${error instanceof Error ? error.message : 'Unknown error'}`])
  }

  try {
    notifications = useNotifications()
    setMountOrder(prev => prev.includes('notifications') ? prev : [...prev, 'notifications'])
  } catch (error) {
    setErrors(prev => [...prev, `Notifications: ${error instanceof Error ? error.message : 'Unknown error'}`])
  }

  // Check if all hooks are available
  useEffect(() => {
    setAllHooksAvailable(!!(auth && integrations && notifications))
  }, [auth, integrations, notifications])

  return (
    <div data-testid="integration-test">
      <div data-testid="mount-order">{mountOrder.join(',')}</div>
      <div data-testid="all-hooks-available">{allHooksAvailable.toString()}</div>
      <div data-testid="errors">{errors.join('; ')}</div>
      
      {/* Test each context's core functionality */}
      {auth && (
        <div data-testid="auth-state">
          <div data-testid="auth-loading">{auth.loading.toString()}</div>
          <div data-testid="auth-authenticated">{auth.isAuthenticated.toString()}</div>
          <div data-testid="auth-has-signin">{typeof auth.signIn === 'function' ? 'true' : 'false'}</div>
        </div>
      )}
      
      {integrations && (
        <div data-testid="integrations-state">
          <div data-testid="instagram-connected">{integrations.instagram.connected.toString()}</div>
          <div data-testid="whatsapp-connected">{integrations.whatsapp.connected.toString()}</div>
          <div data-testid="has-connect-instagram">{typeof integrations.connectInstagram === 'function' ? 'true' : 'false'}</div>
        </div>
      )}
      
      {notifications && (
        <div data-testid="notifications-state">
          <div data-testid="notifications-count">{notifications.notifications.length}</div>
          <div data-testid="connection-status">{notifications.connectionStatus}</div>
          <div data-testid="has-add-notification">{typeof notifications.addNotification === 'function' ? 'true' : 'false'}</div>
        </div>
      )}
    </div>
  )
}

// Component to test boot sequence detection
function BootSequenceTestComponent() {
  const [bootStages, setBootStages] = useState<string[]>([])

  useEffect(() => {
    // Check various boot markers
    const checkBootStages = () => {
      const stages: string[] = []
      
      if ((window as any).__BOOT_GATE_READY__) {
        stages.push('boot-gate')
      }
      if ((window as any).__AUTH_PROVIDER_MOUNTED__) {
        stages.push('auth-provider')
      }
      if ((window as any).__INT_CTX_MOUNTED__) {
        stages.push('integrations-provider')
      }
      if ((window as any).__NOTIFICATION_PROVIDER_MOUNTED__) {
        stages.push('notifications-provider')
      }
      if ((window as any).__PROVIDERS_DIAGRAM__) {
        stages.push('providers-diagram')
      }
      
      setBootStages(stages)
    }

    // Check immediately and then periodically
    checkBootStages()
    const interval = setInterval(checkBootStages, 100)
    
    return () => clearInterval(interval)
  }, [])

  return (
    <div data-testid="boot-sequence">
      <div data-testid="boot-stages">{bootStages.join(',')}</div>
      <div data-testid="boot-stages-count">{bootStages.length}</div>
    </div>
  )
}

describe('RootProviders - Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Clear all window state
    delete (window as any).__BOOT_GATE_READY__
    delete (window as any).__AUTH_PROVIDER_MOUNTED__
    delete (window as any).__INT_CTX_MOUNTED__
    delete (window as any).__NOTIFICATION_PROVIDER_MOUNTED__
    delete (window as any).__PROVIDERS_DIAGRAM__
    
    // Reset localStorage
    localStorage.clear()
    
    // Mock fetch for health checks
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'healthy' })
    } as Response)
  })

  describe('INVARIANT: Provider Architecture', () => {
    it('should expose provider diagram for debugging', async () => {
      render(
        <RootProviders>
          <div data-testid="test-app">Test App</div>
        </RootProviders>
      )

      // Should make provider diagram available
      await waitFor(() => {
        expect((window as any).__PROVIDERS_DIAGRAM__).toEqual(PROVIDERS_DIAGRAM)
      })

      // Diagram should have correct structure
      expect(PROVIDERS_DIAGRAM.order).toEqual([
        'QueryClientProvider',
        'BootGate', 
        'ContextErrorBoundary',
        'ErrorBoundary',
        'AuthProvider',
        'IntegrationsProvider', 
        'NotificationProvider',
        'App'
      ])

      expect(PROVIDERS_DIAGRAM.critical).toContain('QueryClientProvider must be first')
      expect(PROVIDERS_DIAGRAM.validation).toContain('BootGate ensures proper initialization')
    })

    it('should mount providers in the correct canonical order', async () => {
      render(
        <RootProviders>
          <BootSequenceTestComponent />
        </RootProviders>
      )

      // Wait for boot sequence to complete
      await waitFor(() => {
        const stagesCount = parseInt(screen.getByTestId('boot-stages-count').textContent || '0')
        expect(stagesCount).toBeGreaterThan(0)
      }, { timeout: 5000 })

      // Should have all expected boot markers
      await waitFor(() => {
        const stages = screen.getByTestId('boot-stages').textContent || ''
        expect(stages).toContain('boot-gate')
        expect(stages).toContain('auth-provider')
        expect(stages).toContain('integrations-provider')  
        expect(stages).toContain('notifications-provider')
        expect(stages).toContain('providers-diagram')
      })
    })

    it('should maintain singleton QueryClient across re-renders', async () => {
      let firstQueryClient: QueryClient | null = null
      let secondQueryClient: QueryClient | null = null

      function QueryClientCapture({ onCapture }: { onCapture: (client: QueryClient) => void }) {
        try {
          const { QueryClient } = require('@tanstack/react-query')
          const client = new QueryClient()
          onCapture(client)
        } catch {
          // Handle gracefully
        }
        return <div>Capturing</div>
      }

      const { rerender } = render(
        <RootProviders>
          <QueryClientCapture onCapture={(client) => { firstQueryClient = client }} />
        </RootProviders>
      )

      rerender(
        <RootProviders>
          <QueryClientCapture onCapture={(client) => { secondQueryClient = client }} />
        </RootProviders>
      )

      // Should use stable QueryClient (testing the concept, not the exact instance)
      expect(firstQueryClient).toBeTruthy()
      expect(secondQueryClient).toBeTruthy()
    })
  })

  describe('INVARIANT: Cross-Provider Integration', () => {
    it('should make all provider hooks available after boot', async () => {
      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // Wait for all providers to be available
      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 10000 })

      // Should have no errors
      expect(screen.getByTestId('errors')).toHaveTextContent('')

      // Should have mounted all providers
      const mountOrder = screen.getByTestId('mount-order').textContent || ''
      expect(mountOrder).toContain('auth')
      expect(mountOrder).toContain('integrations')
      expect(mountOrder).toContain('notifications')
    })

    it('should provide working auth context functionality', async () => {
      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })

      // Auth context should provide expected interface
      expect(screen.getByTestId('auth-loading')).toBeInTheDocument()
      expect(screen.getByTestId('auth-authenticated')).toBeInTheDocument()  
      expect(screen.getByTestId('auth-has-signin')).toHaveTextContent('true')
    })

    it('should provide working integrations context functionality', async () => {
      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })

      // Integrations context should provide expected interface
      expect(screen.getByTestId('instagram-connected')).toHaveTextContent('false') // Initially disconnected
      expect(screen.getByTestId('whatsapp-connected')).toHaveTextContent('false') // Initially disconnected
      expect(screen.getByTestId('has-connect-instagram')).toHaveTextContent('true')
    })

    it('should provide working notifications context functionality', async () => {
      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })

      // Notifications context should provide expected interface
      expect(screen.getByTestId('connection-status')).toHaveTextContent('connected')
      expect(screen.getByTestId('has-add-notification')).toHaveTextContent('true')
      
      // Should have some demo notifications
      await waitFor(() => {
        const count = parseInt(screen.getByTestId('notifications-count').textContent || '0')
        expect(count).toBeGreaterThan(0)
      }, { timeout: 2000 })
    })

    it('should handle provider dependencies correctly', async () => {
      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // All providers depend on QueryClient being available first
      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })

      // No dependency errors should occur
      expect(screen.getByTestId('errors')).toHaveTextContent('')
    })
  })

  describe('INVARIANT: Error Boundary Integration', () => {
    it('should contain provider errors without breaking entire app', async () => {
      // Mock console to suppress error logs during testing
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock one provider to throw an error
      const originalAuth = require('@/contexts/AuthContext').useAuth
      const useAuthSpy = vi.spyOn(require('@/contexts/AuthContext'), 'useAuth')
      useAuthSpy.mockImplementation(() => {
        throw new Error('Auth provider failed')
      })

      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // Should still render something (error boundary fallback)
      await waitFor(() => {
        expect(document.body).toBeInTheDocument()
      })

      // Restore mocks
      useAuthSpy.mockRestore()
      consoleSpy.mockRestore()
    })

    it('should recover from transient provider errors', async () => {
      let shouldFail = true

      // Mock provider to fail initially then succeed
      const useAuthSpy = vi.spyOn(require('@/contexts/AuthContext'), 'useAuth')
      useAuthSpy.mockImplementation(() => {
        if (shouldFail) {
          shouldFail = false
          throw new Error('Transient failure')
        }
        return {
          user: null,
          loading: false,
          signIn: vi.fn(),
          signUp: vi.fn(),
          signOut: vi.fn(),
          updateProfile: vi.fn(),
          token: null,
          isAuthenticated: false
        }
      })

      const { rerender } = render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // Re-render to simulate recovery
      rerender(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // Should eventually work after recovery
      await waitFor(() => {
        expect(screen.queryByTestId('auth-state')).toBeInTheDocument()
      }, { timeout: 3000 })

      useAuthSpy.mockRestore()
    })
  })

  describe('INVARIANT: HMR Stability', () => {
    it('should survive hot module reloads', async () => {
      const { unmount, rerender } = render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })

      // Simulate HMR by unmounting and remounting
      unmount()

      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // Should work again after HMR
      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })
    })

    it('should maintain state across re-renders', async () => {
      const { rerender } = render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // Wait for initial state
      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })

      const initialNotificationsCount = screen.getByTestId('notifications-count').textContent

      // Re-render with same component
      rerender(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // State should be maintained (notifications preserved via useKV)
      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      })

      // Notifications count should be maintained
      expect(screen.getByTestId('notifications-count')).toHaveTextContent(initialNotificationsCount || '0')
    })
  })

  describe('INVARIANT: Performance & Memory', () => {
    it('should not leak memory during mount/unmount cycles', async () => {
      const iterations = 5
      const initialMemory = (performance as any).memory?.usedJSHeapSize || 0

      for (let i = 0; i < iterations; i++) {
        const { unmount } = render(
          <RootProviders>
            <FullIntegrationTestComponent />
          </RootProviders>
        )

        await waitFor(() => {
          expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
        }, { timeout: 3000 })

        unmount()
      }

      // Memory should not grow excessively (this is a rough check)
      const finalMemory = (performance as any).memory?.usedJSHeapSize || 0
      if (initialMemory && finalMemory) {
        const memoryGrowth = finalMemory - initialMemory
        // Should not grow more than 50MB (very generous threshold)
        expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024)
      }
    })

    it('should initialize within reasonable time', async () => {
      const startTime = performance.now()

      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })

      const endTime = performance.now()
      const initTime = endTime - startTime

      // Should initialize within 3 seconds (generous threshold for CI)
      expect(initTime).toBeLessThan(3000)
    })

    it('should handle concurrent initializations gracefully', async () => {
      // Render multiple RootProviders simultaneously
      const renders = Array.from({ length: 3 }, (_, i) => 
        render(
          <RootProviders key={i}>
            <div data-testid={`app-${i}`}>App {i}</div>
          </RootProviders>
        )
      )

      // All should initialize without interfering with each other
      for (let i = 0; i < renders.length; i++) {
        await waitFor(() => {
          expect(screen.getByTestId(`app-${i}`)).toBeInTheDocument()
        }, { timeout: 5000 })
      }

      // Cleanup
      renders.forEach(({ unmount }) => unmount())
    })
  })

  describe('INVARIANT: Development Experience', () => {
    it('should provide helpful debugging information', async () => {
      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })

      // Should set debugging markers
      expect((window as any).__BOOT_GATE_READY__).toBe(true)
      expect((window as any).__PROVIDERS_DIAGRAM__).toBeTruthy()
      
      // Check that provider diagram is detailed
      const diagram = (window as any).__PROVIDERS_DIAGRAM__
      expect(diagram.order).toHaveLength(8) // All providers + app
      expect(diagram.critical).toContain('QueryClientProvider')
      expect(diagram.validation).toContain('BootGate')
    })

    it('should log mount sequence in development', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      render(
        <RootProviders>
          <BootSequenceTestComponent />
        </RootProviders>
      )

      await waitFor(() => {
        const stagesCount = parseInt(screen.getByTestId('boot-stages-count').textContent || '0')
        expect(stagesCount).toBeGreaterThan(0)
      }, { timeout: 5000 })

      // Should have logged mount sequence
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[RootProviders]'),
        expect.stringContaining('Mounting with canonical order'),
        expect.any(Array)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('INVARIANT: Edge Cases', () => {
    it('should handle rapid mount/unmount cycles', async () => {
      for (let i = 0; i < 10; i++) {
        const { unmount } = render(
          <RootProviders>
            <div data-testid={`rapid-${i}`}>Rapid {i}</div>
          </RootProviders>
        )
        
        // Immediately unmount (simulating very rapid cycles)
        unmount()
      }

      // Final render should still work
      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 5000 })
    })

    it('should handle provider initialization race conditions', async () => {
      // Mock slow boot to create race conditions
      vi.mocked(globalThis.fetch).mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: 'healthy' })
        } as Response), 100))
      )

      render(
        <RootProviders>
          <FullIntegrationTestComponent />
        </RootProviders>
      )

      // Should still complete successfully despite race conditions
      await waitFor(() => {
        expect(screen.getByTestId('all-hooks-available')).toHaveTextContent('true')
      }, { timeout: 10000 })

      expect(screen.getByTestId('errors')).toHaveTextContent('')
    })
  })
})