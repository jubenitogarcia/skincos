import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { ReactNode } from 'react'

import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { BootGate } from '@/providers/BootGate'

/**
 * AuthProvider Invariant Tests
 * 
 * These tests ensure AuthProvider maintains its contract regardless of:
 * - Network conditions (online/offline/slow)
 * - Authentication states (logged in/out/loading)
 * - Provider mounting order
 * - QueryClient availability
 */

// Test component to access context
function AuthTestComponent() {
  const auth = useAuth()
  return (
    <div data-testid="auth-state">
      <div data-testid="user">{auth.user?.name || 'null'}</div>
      <div data-testid="loading">{auth.loading.toString()}</div>
      <div data-testid="authenticated">{auth.isAuthenticated.toString()}</div>
      <div data-testid="token">{auth.token || 'null'}</div>
      <button onClick={() => auth.signIn('test@example.com', 'password')} data-testid="signin">
        Sign In
      </button>
      <button onClick={() => auth.signOut()} data-testid="signout">
        Sign Out
      </button>
    </div>
  )
}

// Helper to create test wrapper with QueryClient
function createTestWrapper(mockResponses: Record<string, any> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
      },
    },
  })

  // Mock fetch responses
  const fetchMock = vi.mocked(globalThis.fetch)
  fetchMock.mockImplementation((url) => {
    const endpoint = url.toString()
    if (mockResponses[endpoint]) {
      return Promise.resolve({
        ok: mockResponses[endpoint].ok ?? true,
        status: mockResponses[endpoint].status ?? 200,
        statusText: mockResponses[endpoint].statusText ?? 'OK',
        json: () => Promise.resolve(mockResponses[endpoint].data),
      } as Response)
    }
    
    // Default 401 for auth endpoints
    if (endpoint.includes('/api/auth/user')) {
      return Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: 'Not authenticated' }),
      } as Response)
    }
    
    return Promise.reject(new Error(`Unmocked fetch to ${endpoint}`))
  })

  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BootGate>
          <AuthProvider>
            {children}
          </AuthProvider>
        </BootGate>
      </QueryClientProvider>
    )
  }
}

describe('AuthProvider - Invariant Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(globalThis.fetch).mockClear()
    
    // Clear window state
    delete (window as any).__AUTH_PROVIDER_MOUNTED__
    delete (window as any).__BOOT_GATE_READY__
  })

  describe('INVARIANT: Context Availability', () => {
    it('should throw error when useAuth is called outside AuthProvider', () => {
      const TestComponent = () => {
        useAuth() // This should throw
        return <div>Should not render</div>
      }

      expect(() => render(<TestComponent />)).toThrow(
        /useAuth must be used within AuthProvider/
      )
    })

    it('should provide context when wrapped in AuthProvider', () => {
      const TestWrapper = createTestWrapper()
      
      expect(() => 
        render(
          <TestWrapper>
            <AuthTestComponent />
          </TestWrapper>
        )
      ).not.toThrow()
    })
  })

  describe('INVARIANT: Authentication States', () => {
    it('should initialize with unauthenticated state (401 response)', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <AuthTestComponent />
        </TestWrapper>
      )

      // Should start with loading
      expect(screen.getByTestId('loading')).toHaveTextContent('true')
      
      // After loading, should be unauthenticated
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false')
      })
      
      expect(screen.getByTestId('user')).toHaveTextContent('null')
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
      expect(screen.getByTestId('token')).toHaveTextContent('null')
    })

    it('should handle authenticated state (200 response)', async () => {
      const mockUser = {
        id: '123',
        name: 'John Doe',
        email: 'john@example.com',
        createdAt: '2024-01-01T00:00:00Z',
        avatarUrl: 'https://example.com/avatar.jpg'
      }

      const TestWrapper = createTestWrapper({
        '/api/auth/user': {
          ok: true,
          status: 200,
          data: mockUser
        }
      })
      
      render(
        <TestWrapper>
          <AuthTestComponent />
        </TestWrapper>
      )

      // Should eventually be authenticated
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false')
      })
      
      expect(screen.getByTestId('user')).toHaveTextContent('John Doe')
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
      expect(screen.getByTestId('token')).toHaveTextContent('null') // Replit Auth manages tokens internally
    })

    it('should handle network errors gracefully', async () => {
      const fetchMock = vi.mocked(globalThis.fetch)
      fetchMock.mockRejectedValue(new Error('Network error'))

      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <AuthTestComponent />
        </TestWrapper>
      )

      // Should eventually stop loading even with error
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false')
      })
      
      // Should remain unauthenticated
      expect(screen.getByTestId('user')).toHaveTextContent('null')
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    })
  })

  describe('INVARIANT: Authentication Actions', () => {
    it('should provide signIn function that redirects to login', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <AuthTestComponent />
        </TestWrapper>
      )

      // Wait for initial loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false')
      })

      // Mock window.location
      const originalLocation = window.location
      delete (window as any).location
      window.location = { ...originalLocation, href: '' } as any

      act(() => {
        screen.getByTestId('signin').click()
      })

      // Should redirect to login endpoint
      expect(window.location.href).toBe('/api/login')

      // Restore original location
      window.location = originalLocation
    })

    it('should provide signOut function that redirects to logout', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <AuthTestComponent />
        </TestWrapper>
      )

      // Wait for initial loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false')
      })

      // Mock window.location
      const originalLocation = window.location
      delete (window as any).location
      window.location = { ...originalLocation, href: '' } as any

      act(() => {
        screen.getByTestId('signout').click()
      })

      // Should redirect to logout endpoint
      expect(window.location.href).toBe('/api/logout')

      // Restore original location
      window.location = originalLocation
    })

    it('should provide updateProfile function (no-op for Replit Auth)', () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <AuthTestComponent />
        </TestWrapper>
      )

      const auth = useAuth()
      expect(typeof auth.updateProfile).toBe('function')
      
      // Should not throw when called
      expect(() => {
        auth.updateProfile({ name: 'New Name' })
      }).not.toThrow()
    })
  })

  describe('INVARIANT: QueryClient Dependency', () => {
    it('should handle missing QueryClient gracefully', () => {
      // Test without QueryClientProvider to simulate early mount
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      const TestComponent = () => {
        const auth = useAuth()
        return <div data-testid="state">{auth.loading.toString()}</div>
      }

      expect(() => {
        render(
          <BootGate>
            <AuthProvider>
              <TestComponent />
            </BootGate>
          </BootGate>
        )
      }).not.toThrow()
      
      consoleError.mockRestore()
    })

    it('should mark provider as mounted for debugging', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <AuthTestComponent />
        </TestWrapper>
      )

      // Should set debugging marker
      await waitFor(() => {
        expect((window as any).__AUTH_PROVIDER_MOUNTED__).toBe(true)
      })
    })
  })

  describe('INVARIANT: Loading Overlay Behavior', () => {
    it('should show loading overlay only when auth is loading', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <AuthTestComponent />
        </TestWrapper>
      )

      // Initially loading
      expect(screen.getByTestId('loading')).toHaveTextContent('true')

      // After auth resolves, no more loading
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false')
      })
    })
  })

  describe('INVARIANT: HMR Stability', () => {
    it('should maintain context stability across hot reloads', () => {
      // Simulate HMR by creating multiple contexts
      const TestWrapper1 = createTestWrapper()
      const TestWrapper2 = createTestWrapper()
      
      const { unmount } = render(
        <TestWrapper1>
          <AuthTestComponent />
        </TestWrapper1>
      )
      
      unmount()
      
      // Should not throw when remounting with different wrapper
      expect(() => {
        render(
          <TestWrapper2>
            <AuthTestComponent />
          </TestWrapper2>
        )
      }).not.toThrow()
    })
  })
})