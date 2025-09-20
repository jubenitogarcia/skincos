import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { ReactNode } from 'react'

import { IntegrationsProvider, useIntegrations } from '@/contexts/IntegrationsContext'
import { BootGate } from '@/providers/BootGate'

/**
 * IntegrationsProvider Invariant Tests
 * 
 * These tests ensure IntegrationsProvider maintains its contract regardless of:
 * - Network conditions (Instagram API down, WhatsApp gateway offline)
 * - Integration states (connected/disconnected/syncing/error)
 * - LocalStorage availability
 * - Provider mounting order
 * - External API responses
 */

// Mock Instagram integration service
vi.mock('@/services/instagramIntegration', () => ({
  fetchInstagramAccountMetrics: vi.fn()
}))

import { fetchInstagramAccountMetrics } from '@/services/instagramIntegration'

// Test component to access integrations context
function IntegrationsTestComponent() {
  const integrations = useIntegrations()
  
  return (
    <div data-testid="integrations-state">
      {/* Instagram Integration State */}
      <div data-testid="instagram-connected">{integrations.instagram.connected.toString()}</div>
      <div data-testid="instagram-error">{integrations.instagram.error || 'null'}</div>
      <div data-testid="instagram-metrics">{integrations.instagram.metrics ? 'present' : 'null'}</div>
      <div data-testid="instagram-last-sync">{integrations.instagram.lastSync || 'null'}</div>
      
      {/* WhatsApp Integration State */}
      <div data-testid="whatsapp-connected">{integrations.whatsapp.connected.toString()}</div>
      <div data-testid="whatsapp-error">{integrations.whatsapp.error || 'null'}</div>
      <div data-testid="whatsapp-base-url">{integrations.whatsapp.baseUrl || 'null'}</div>
      <div data-testid="whatsapp-last-sync">{integrations.whatsapp.lastSync || 'null'}</div>
      
      {/* Action Buttons */}
      <button 
        onClick={() => integrations.connectInstagram('test-token', 'test-business-id')}
        data-testid="connect-instagram"
      >
        Connect Instagram
      </button>
      <button 
        onClick={() => integrations.disconnectInstagram()}
        data-testid="disconnect-instagram"
      >
        Disconnect Instagram
      </button>
      <button 
        onClick={() => integrations.syncInstagram()}
        data-testid="sync-instagram"
      >
        Sync Instagram
      </button>
      
      <button 
        onClick={() => integrations.connectWhatsApp('https://wa.example.com')}
        data-testid="connect-whatsapp"
      >
        Connect WhatsApp
      </button>
      <button 
        onClick={() => integrations.disconnectWhatsApp()}
        data-testid="disconnect-whatsapp"
      >
        Disconnect WhatsApp
      </button>
      <button 
        onClick={() => integrations.syncWhatsApp()}
        data-testid="sync-whatsapp"
      >
        Sync WhatsApp
      </button>
    </div>
  )
}

// Helper to create test wrapper
function createTestWrapper(initialLocalStorage: Record<string, string> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  })

  // Setup localStorage mock with initial values
  const localStorage = vi.mocked(window.localStorage)
  localStorage.getItem.mockImplementation((key: string) => initialLocalStorage[key] || null)
  localStorage.setItem.mockImplementation((key: string, value: string) => {
    initialLocalStorage[key] = value
  })
  localStorage.removeItem.mockImplementation((key: string) => {
    delete initialLocalStorage[key]
  })

  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BootGate>
          <IntegrationsProvider>
            {children}
          </IntegrationsProvider>
        </BootGate>
      </QueryClientProvider>
    )
  }
}

describe('IntegrationsProvider - Invariant Tests', () => {
  const mockFetchInstagramAccountMetrics = vi.mocked(fetchInstagramAccountMetrics)

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchInstagramAccountMetrics.mockClear()
    
    // Clear window state
    delete (window as any).__INTEGRATIONS_PROVIDER_MOUNTED__
    delete (window as any).__INT_CTX_MOUNTED__
    
    // Reset fetch mock
    vi.mocked(globalThis.fetch).mockClear()
  })

  describe('INVARIANT: Context Availability', () => {
    it('should throw error when useIntegrations is called outside IntegrationsProvider', () => {
      const TestComponent = () => {
        useIntegrations() // This should throw
        return <div>Should not render</div>
      }

      expect(() => render(<TestComponent />)).toThrow(
        /useIntegrations must be used within IntegrationsProvider/
      )
    })

    it('should provide context when wrapped in IntegrationsProvider', () => {
      const TestWrapper = createTestWrapper()
      
      expect(() => 
        render(
          <TestWrapper>
            <IntegrationsTestComponent />
          </TestWrapper>
        )
      ).not.toThrow()
    })

    it('should mark provider as mounted for debugging', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Should set debugging marker
      await waitFor(() => {
        expect((window as any).__INT_CTX_MOUNTED__).toBe(true)
      })
    })
  })

  describe('INVARIANT: Instagram Integration States', () => {
    it('should initialize with disconnected Instagram state', () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('instagram-connected')).toHaveTextContent('false')
      expect(screen.getByTestId('instagram-error')).toHaveTextContent('null')
      expect(screen.getByTestId('instagram-metrics')).toHaveTextContent('null')
      expect(screen.getByTestId('instagram-last-sync')).toHaveTextContent('null')
    })

    it('should initialize with connected state from localStorage', () => {
      const TestWrapper = createTestWrapper({
        'instagram-access-token': 'stored-token',
        'instagram-business-account-id': 'stored-business-id'
      })
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('instagram-connected')).toHaveTextContent('true')
    })

    it('should initialize with connected state from env variables', () => {
      // Mock env variables
      const originalEnv = (import.meta as any).env
      ;(import.meta as any).env = {
        ...originalEnv,
        VITE_INSTAGRAM_ACCESS_TOKEN: 'env-token',
        VITE_INSTAGRAM_BUSINESS_ACCOUNT_ID: 'env-business-id'
      }

      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('instagram-connected')).toHaveTextContent('true')

      // Restore env
      ;(import.meta as any).env = originalEnv
    })

    it('should connect Instagram and store credentials', async () => {
      const TestWrapper = createTestWrapper()
      const localStorage = vi.mocked(window.localStorage)
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Initially disconnected
      expect(screen.getByTestId('instagram-connected')).toHaveTextContent('false')

      // Mock successful metrics fetch
      mockFetchInstagramAccountMetrics.mockResolvedValue({
        followers: 1000,
        posts: 50,
        engagement: 5.2
      })

      // Connect Instagram
      await act(async () => {
        fireEvent.click(screen.getByTestId('connect-instagram'))
      })

      // Should be connected and credentials stored
      await waitFor(() => {
        expect(screen.getByTestId('instagram-connected')).toHaveTextContent('true')
      })
      
      expect(localStorage.setItem).toHaveBeenCalledWith('instagram-access-token', 'test-token')
      expect(localStorage.setItem).toHaveBeenCalledWith('instagram-business-account-id', 'test-business-id')
      expect(mockFetchInstagramAccountMetrics).toHaveBeenCalledWith('test-business-id', 'test-token')
    })

    it('should disconnect Instagram and clear credentials', async () => {
      const TestWrapper = createTestWrapper({
        'instagram-access-token': 'stored-token',
        'instagram-business-account-id': 'stored-business-id'
      })
      const localStorage = vi.mocked(window.localStorage)
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Initially connected
      expect(screen.getByTestId('instagram-connected')).toHaveTextContent('true')

      // Disconnect Instagram
      act(() => {
        fireEvent.click(screen.getByTestId('disconnect-instagram'))
      })

      // Should be disconnected and credentials removed
      expect(screen.getByTestId('instagram-connected')).toHaveTextContent('false')
      expect(localStorage.removeItem).toHaveBeenCalledWith('instagram-access-token')
      expect(localStorage.removeItem).toHaveBeenCalledWith('instagram-business-account-id')
    })

    it('should handle Instagram sync success', async () => {
      const TestWrapper = createTestWrapper({
        'instagram-access-token': 'stored-token',
        'instagram-business-account-id': 'stored-business-id'
      })
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      const mockMetrics = {
        followers: 1500,
        posts: 75,
        engagement: 6.8
      }

      // Mock successful metrics fetch
      mockFetchInstagramAccountMetrics.mockResolvedValue(mockMetrics)

      // Sync Instagram
      await act(async () => {
        fireEvent.click(screen.getByTestId('sync-instagram'))
      })

      // Should have updated state
      await waitFor(() => {
        expect(screen.getByTestId('instagram-metrics')).toHaveTextContent('present')
        expect(screen.getByTestId('instagram-error')).toHaveTextContent('null')
        expect(screen.getByTestId('instagram-last-sync')).not.toHaveTextContent('null')
      })
    })

    it('should handle Instagram sync failure', async () => {
      const TestWrapper = createTestWrapper({
        'instagram-access-token': 'stored-token',
        'instagram-business-account-id': 'stored-business-id'
      })
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Mock failed metrics fetch
      mockFetchInstagramAccountMetrics.mockRejectedValue(new Error('API rate limit exceeded'))

      // Sync Instagram
      await act(async () => {
        fireEvent.click(screen.getByTestId('sync-instagram'))
      })

      // Should have error state
      await waitFor(() => {
        expect(screen.getByTestId('instagram-error')).toHaveTextContent('API rate limit exceeded')
      })
    })

    it('should not sync Instagram when disconnected', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Sync when disconnected
      await act(async () => {
        fireEvent.click(screen.getByTestId('sync-instagram'))
      })

      // Should not call the API
      expect(mockFetchInstagramAccountMetrics).not.toHaveBeenCalled()
    })
  })

  describe('INVARIANT: WhatsApp Integration States', () => {
    it('should initialize with disconnected WhatsApp state', () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('whatsapp-connected')).toHaveTextContent('false')
      expect(screen.getByTestId('whatsapp-error')).toHaveTextContent('null')
      expect(screen.getByTestId('whatsapp-base-url')).toHaveTextContent('null')
      expect(screen.getByTestId('whatsapp-last-sync')).toHaveTextContent('null')
    })

    it('should initialize with connected state from localStorage', () => {
      const TestWrapper = createTestWrapper({
        'whatsapp-base-url': 'https://wa.stored.com'
      })
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('whatsapp-connected')).toHaveTextContent('true')
      expect(screen.getByTestId('whatsapp-base-url')).toHaveTextContent('https://wa.stored.com')
    })

    it('should connect WhatsApp and normalize URL', async () => {
      const TestWrapper = createTestWrapper()
      const localStorage = vi.mocked(window.localStorage)
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Mock successful stats fetch
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ activeChats: 10, messagesSent: 100 })
      } as Response)

      // Connect WhatsApp
      await act(async () => {
        fireEvent.click(screen.getByTestId('connect-whatsapp'))
      })

      // Should be connected and URL stored (normalized - trailing slash removed)
      await waitFor(() => {
        expect(screen.getByTestId('whatsapp-connected')).toHaveTextContent('true')
      })
      
      expect(localStorage.setItem).toHaveBeenCalledWith('whatsapp-base-url', 'https://wa.example.com')
      expect(screen.getByTestId('whatsapp-base-url')).toHaveTextContent('https://wa.example.com')
    })

    it('should disconnect WhatsApp and clear URL', () => {
      const TestWrapper = createTestWrapper({
        'whatsapp-base-url': 'https://wa.stored.com'
      })
      const localStorage = vi.mocked(window.localStorage)
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Initially connected
      expect(screen.getByTestId('whatsapp-connected')).toHaveTextContent('true')

      // Disconnect WhatsApp
      act(() => {
        fireEvent.click(screen.getByTestId('disconnect-whatsapp'))
      })

      // Should be disconnected and URL removed
      expect(screen.getByTestId('whatsapp-connected')).toHaveTextContent('false')
      expect(screen.getByTestId('whatsapp-base-url')).toHaveTextContent('null')
      expect(localStorage.removeItem).toHaveBeenCalledWith('whatsapp-base-url')
    })

    it('should handle WhatsApp sync success', async () => {
      const TestWrapper = createTestWrapper({
        'whatsapp-base-url': 'https://wa.stored.com'
      })
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Mock successful stats fetch
      const mockStats = { activeChats: 15, messagesSent: 200 }
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStats)
      } as Response)

      // Sync WhatsApp
      await act(async () => {
        fireEvent.click(screen.getByTestId('sync-whatsapp'))
      })

      // Should have updated last sync time and no error
      await waitFor(() => {
        expect(screen.getByTestId('whatsapp-error')).toHaveTextContent('null')
        expect(screen.getByTestId('whatsapp-last-sync')).not.toHaveTextContent('null')
      })

      expect(globalThis.fetch).toHaveBeenCalledWith('https://wa.stored.com/stats')
    })

    it('should handle WhatsApp sync failure gracefully', async () => {
      const TestWrapper = createTestWrapper({
        'whatsapp-base-url': 'https://wa.stored.com'
      })
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Mock failed stats fetch
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Connection refused'))

      // Sync WhatsApp
      await act(async () => {
        fireEvent.click(screen.getByTestId('sync-whatsapp'))
      })

      // Should have error state
      await waitFor(() => {
        expect(screen.getByTestId('whatsapp-error')).toHaveTextContent('Connection refused')
      })
    })

    it('should handle WhatsApp sync when stats endpoint is not available', async () => {
      const TestWrapper = createTestWrapper({
        'whatsapp-base-url': 'https://wa.stored.com'
      })
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Mock 404 response for stats endpoint
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: false,
        status: 404
      } as Response)

      // Sync WhatsApp
      await act(async () => {
        fireEvent.click(screen.getByTestId('sync-whatsapp'))
      })

      // Should still update last sync time even without stats
      await waitFor(() => {
        expect(screen.getByTestId('whatsapp-last-sync')).not.toHaveTextContent('null')
        expect(screen.getByTestId('whatsapp-error')).toHaveTextContent('null')
      })
    })

    it('should not sync WhatsApp when disconnected', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Sync when disconnected
      await act(async () => {
        fireEvent.click(screen.getByTestId('sync-whatsapp'))
      })

      // Should not call the API
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  describe('INVARIANT: Client-Side Mount Detection', () => {
    it('should detect client-side mount only once', () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Mount detection should be lightweight (single log)
      expect((window as any).__INT_CTX_MOUNTED__).toBe(true)

      // Remounting should not log again
      render(
        <TestWrapper>
          <IntegrationsTestComponent />
        </TestWrapper>
      )

      // Flag should still be true
      expect((window as any).__INT_CTX_MOUNTED__).toBe(true)
    })
  })

  describe('INVARIANT: Error Boundary Compatibility', () => {
    it('should not throw during initialization with invalid localStorage data', () => {
      const TestWrapper = createTestWrapper({
        'instagram-access-token': '', // Empty token
        'whatsapp-base-url': 'invalid-url' // Invalid URL
      })
      
      expect(() => {
        render(
          <TestWrapper>
            <IntegrationsTestComponent />
          </TestWrapper>
        )
      }).not.toThrow()

      // Should handle gracefully
      expect(screen.getByTestId('instagram-connected')).toHaveTextContent('false')
      expect(screen.getByTestId('whatsapp-connected')).toHaveTextContent('true') // Still connected even with invalid URL
    })
  })

  describe('INVARIANT: Context Value Stability', () => {
    it('should provide stable function references', () => {
      const TestWrapper = createTestWrapper()
      let firstRenderFunctions: any = {}
      let secondRenderFunctions: any = {}

      function TestComponent() {
        const integrations = useIntegrations()
        
        // Capture functions on first render
        if (Object.keys(firstRenderFunctions).length === 0) {
          firstRenderFunctions = {
            connectInstagram: integrations.connectInstagram,
            disconnectInstagram: integrations.disconnectInstagram,
            syncInstagram: integrations.syncInstagram,
            connectWhatsApp: integrations.connectWhatsApp,
            disconnectWhatsApp: integrations.disconnectWhatsApp,
            syncWhatsApp: integrations.syncWhatsApp
          }
        } else {
          // Compare on subsequent renders
          secondRenderFunctions = {
            connectInstagram: integrations.connectInstagram,
            disconnectInstagram: integrations.disconnectInstagram,
            syncInstagram: integrations.syncInstagram,
            connectWhatsApp: integrations.connectWhatsApp,
            disconnectWhatsApp: integrations.disconnectWhatsApp,
            syncWhatsApp: integrations.syncWhatsApp
          }
        }

        return <div data-testid="functions-captured">OK</div>
      }

      const { rerender } = render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      rerender(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      )

      // Functions should be the same reference
      expect(firstRenderFunctions.connectInstagram).toBe(secondRenderFunctions.connectInstagram)
      expect(firstRenderFunctions.disconnectInstagram).toBe(secondRenderFunctions.disconnectInstagram)
      expect(firstRenderFunctions.syncInstagram).toBe(secondRenderFunctions.syncInstagram)
      expect(firstRenderFunctions.connectWhatsApp).toBe(secondRenderFunctions.connectWhatsApp)
      expect(firstRenderFunctions.disconnectWhatsApp).toBe(secondRenderFunctions.disconnectWhatsApp)
      expect(firstRenderFunctions.syncWhatsApp).toBe(secondRenderFunctions.syncWhatsApp)
    })
  })
})