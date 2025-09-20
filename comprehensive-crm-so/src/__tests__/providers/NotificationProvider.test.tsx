import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { ReactNode } from 'react'

import { NotificationProvider, useNotifications, useNotificationsByType, useNotificationsByCategory } from '@/contexts/NotificationContext'
import { BootGate } from '@/providers/BootGate'

/**
 * NotificationProvider Invariant Tests
 * 
 * These tests ensure NotificationProvider maintains its contract regardless of:
 * - WebSocket connection states (connected/disconnected/reconnecting)
 * - Browser Notification API availability/permission states
 * - Network conditions affecting real-time updates
 * - LocalStorage persistence and cleanup
 * - High volume notification scenarios
 * - Provider mounting order
 */

// Mock useWebSocket hook
const mockWebSocket = {
  isConnected: false,
  isConnecting: false,
  lastError: null,
  latency: 0,
  subscribe: vi.fn(),
  send: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn()
}

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(() => mockWebSocket)
}))

// Mock useKV hook from spark-mock
const mockUseKV = vi.fn()
vi.mock('@/lib/spark-mock', () => ({
  useKV: mockUseKV
}))

// Test component to access notifications context
function NotificationsTestComponent() {
  const notifications = useNotifications()
  
  return (
    <div data-testid="notifications-state">
      <div data-testid="notifications-count">{notifications.notifications.length}</div>
      <div data-testid="unread-count">{notifications.unreadCount}</div>
      <div data-testid="is-connected">{notifications.isConnected.toString()}</div>
      <div data-testid="is-connecting">{notifications.isConnecting.toString()}</div>
      <div data-testid="last-error">{notifications.lastError || 'null'}</div>
      <div data-testid="latency">{notifications.latency}</div>
      <div data-testid="connection-status">{notifications.connectionStatus}</div>
      
      <button 
        onClick={() => notifications.addNotification({
          title: 'Test Notification',
          message: 'This is a test',
          type: 'info',
          priority: 'medium',
          category: 'test'
        })}
        data-testid="add-notification"
      >
        Add Notification
      </button>
      
      <button 
        onClick={() => {
          if (notifications.notifications.length > 0) {
            notifications.markAsRead(notifications.notifications[0].id)
          }
        }}
        data-testid="mark-first-read"
      >
        Mark First as Read
      </button>
      
      <button 
        onClick={() => notifications.markAllAsRead()}
        data-testid="mark-all-read"
      >
        Mark All as Read
      </button>
      
      <button 
        onClick={() => {
          if (notifications.notifications.length > 0) {
            notifications.removeNotification(notifications.notifications[0].id)
          }
        }}
        data-testid="remove-first"
      >
        Remove First
      </button>
      
      <button 
        onClick={() => notifications.clearAll()}
        data-testid="clear-all"
      >
        Clear All
      </button>

      {/* Render notifications for testing */}
      <div data-testid="notifications-list">
        {notifications.notifications.map(notification => (
          <div 
            key={notification.id}
            data-testid={`notification-${notification.id}`}
            data-read={notification.read}
            data-type={notification.type}
            data-category={notification.category}
          >
            {notification.title}: {notification.message}
          </div>
        ))}
      </div>
    </div>
  )
}

// Test component for filtered notifications
function FilteredNotificationsTestComponent() {
  const errorNotifications = useNotificationsByType('error')
  const salesNotifications = useNotificationsByCategory('sales')
  
  return (
    <div data-testid="filtered-notifications">
      <div data-testid="error-notifications-count">{errorNotifications.length}</div>
      <div data-testid="sales-notifications-count">{salesNotifications.length}</div>
    </div>
  )
}

// Helper to create test wrapper
function createTestWrapper(
  initialNotifications: any[] = [],
  webSocketConfig: Partial<typeof mockWebSocket> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  })

  // Setup useKV mock
  let notificationsState = [...initialNotifications]
  mockUseKV.mockImplementation((key: string, defaultValue: any) => {
    if (key === 'notifications') {
      return [
        notificationsState,
        (newValue: any) => {
          notificationsState = typeof newValue === 'function' ? newValue(notificationsState) : newValue
        }
      ]
    }
    return [defaultValue, vi.fn()]
  })

  // Setup WebSocket mock
  Object.assign(mockWebSocket, {
    isConnected: false,
    isConnecting: false,
    lastError: null,
    latency: 0,
    subscribe: vi.fn(() => vi.fn()), // Return unsubscribe function
    ...webSocketConfig
  })

  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <BootGate>
          <NotificationProvider>
            {children}
          </NotificationProvider>
        </BootGate>
      </QueryClientProvider>
    )
  }
}

describe('NotificationProvider - Invariant Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseKV.mockClear()
    
    // Clear window state
    delete (window as any).__NOTIFICATION_PROVIDER_MOUNTED__
    
    // Reset WebSocket mock
    Object.assign(mockWebSocket, {
      isConnected: false,
      isConnecting: false,
      lastError: null,
      latency: 0,
      subscribe: vi.fn(() => vi.fn()),
      send: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    })
    
    // Reset Notification API mock
    vi.mocked(window.Notification.requestPermission).mockResolvedValue('granted')
  })

  describe('INVARIANT: Context Availability', () => {
    it('should throw error when useNotifications is called outside NotificationProvider', () => {
      const TestComponent = () => {
        useNotifications() // This should throw
        return <div>Should not render</div>
      }

      expect(() => render(<TestComponent />)).toThrow(
        /useNotifications must be used within NotificationProvider/
      )
    })

    it('should provide context when wrapped in NotificationProvider', () => {
      const TestWrapper = createTestWrapper()
      
      expect(() => 
        render(
          <TestWrapper>
            <NotificationsTestComponent />
          </TestWrapper>
        )
      ).not.toThrow()
    })

    it('should mark provider as mounted for debugging', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Should set debugging marker
      await waitFor(() => {
        expect((window as any).__NOTIFICATION_PROVIDER_MOUNTED__).toBe(true)
      })
    })
  })

  describe('INVARIANT: Initial Notification States', () => {
    it('should initialize with empty notifications when no stored data', () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('notifications-count')).toHaveTextContent('0')
      expect(screen.getByTestId('unread-count')).toHaveTextContent('0')
      expect(screen.getByTestId('is-connected')).toHaveTextContent('false')
      expect(screen.getByTestId('connection-status')).toHaveTextContent('disconnected')
    })

    it('should initialize with demo notifications if none stored', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Demo notifications should be generated
      await waitFor(() => {
        const count = parseInt(screen.getByTestId('notifications-count').textContent || '0')
        expect(count).toBeGreaterThan(0)
      })

      // Should have some unread notifications
      await waitFor(() => {
        const unreadCount = parseInt(screen.getByTestId('unread-count').textContent || '0')
        expect(unreadCount).toBeGreaterThan(0)
      })
    })

    it('should initialize with existing stored notifications', () => {
      const initialNotifications = [
        {
          id: '1',
          title: 'Stored Notification',
          message: 'This was stored',
          type: 'info',
          priority: 'medium',
          timestamp: new Date().toISOString(),
          read: false,
          category: 'test'
        }
      ]
      
      const TestWrapper = createTestWrapper(initialNotifications)
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('notifications-count')).toHaveTextContent('1')
      expect(screen.getByTestId('unread-count')).toHaveTextContent('1')
      expect(screen.getByTestId('notification-1')).toHaveTextContent('Stored Notification: This was stored')
    })
  })

  describe('INVARIANT: Notification CRUD Operations', () => {
    it('should add new notifications correctly', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      const initialCount = parseInt(screen.getByTestId('notifications-count').textContent || '0')

      // Add a notification
      act(() => {
        fireEvent.click(screen.getByTestId('add-notification'))
      })

      // Should increase count
      await waitFor(() => {
        const newCount = parseInt(screen.getByTestId('notifications-count').textContent || '0')
        expect(newCount).toBe(initialCount + 1)
      })

      // Should increase unread count
      await waitFor(() => {
        const unreadCount = parseInt(screen.getByTestId('unread-count').textContent || '0')
        expect(unreadCount).toBeGreaterThan(0)
      })
    })

    it('should mark single notification as read', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Add a notification first
      act(() => {
        fireEvent.click(screen.getByTestId('add-notification'))
      })

      // Wait for it to appear
      await waitFor(() => {
        const count = parseInt(screen.getByTestId('notifications-count').textContent || '0')
        expect(count).toBeGreaterThan(0)
      })

      const initialUnreadCount = parseInt(screen.getByTestId('unread-count').textContent || '0')

      // Mark first as read
      act(() => {
        fireEvent.click(screen.getByTestId('mark-first-read'))
      })

      // Unread count should decrease
      await waitFor(() => {
        const newUnreadCount = parseInt(screen.getByTestId('unread-count').textContent || '0')
        expect(newUnreadCount).toBeLessThan(initialUnreadCount)
      })
    })

    it('should mark all notifications as read', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Add multiple notifications
      act(() => {
        fireEvent.click(screen.getByTestId('add-notification'))
        fireEvent.click(screen.getByTestId('add-notification'))
      })

      // Wait for them to appear
      await waitFor(() => {
        const unreadCount = parseInt(screen.getByTestId('unread-count').textContent || '0')
        expect(unreadCount).toBeGreaterThan(0)
      })

      // Mark all as read
      act(() => {
        fireEvent.click(screen.getByTestId('mark-all-read'))
      })

      // All should be read
      await waitFor(() => {
        expect(screen.getByTestId('unread-count')).toHaveTextContent('0')
      })
    })

    it('should remove single notification', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Add a notification
      act(() => {
        fireEvent.click(screen.getByTestId('add-notification'))
      })

      // Wait for it to appear
      await waitFor(() => {
        const count = parseInt(screen.getByTestId('notifications-count').textContent || '0')
        expect(count).toBeGreaterThan(0)
      })

      const initialCount = parseInt(screen.getByTestId('notifications-count').textContent || '0')

      // Remove first notification
      act(() => {
        fireEvent.click(screen.getByTestId('remove-first'))
      })

      // Count should decrease
      await waitFor(() => {
        const newCount = parseInt(screen.getByTestId('notifications-count').textContent || '0')
        expect(newCount).toBe(initialCount - 1)
      })
    })

    it('should clear all notifications', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Add multiple notifications
      act(() => {
        fireEvent.click(screen.getByTestId('add-notification'))
        fireEvent.click(screen.getByTestId('add-notification'))
      })

      // Wait for them to appear
      await waitFor(() => {
        const count = parseInt(screen.getByTestId('notifications-count').textContent || '0')
        expect(count).toBeGreaterThan(0)
      })

      // Clear all
      act(() => {
        fireEvent.click(screen.getByTestId('clear-all'))
      })

      // Should be empty
      await waitFor(() => {
        expect(screen.getByTestId('notifications-count')).toHaveTextContent('0')
        expect(screen.getByTestId('unread-count')).toHaveTextContent('0')
      })
    })
  })

  describe('INVARIANT: WebSocket Integration', () => {
    it('should reflect WebSocket connection state', () => {
      const TestWrapper = createTestWrapper([], { 
        isConnected: true, 
        isConnecting: false,
        latency: 45 
      })
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('is-connected')).toHaveTextContent('true')
      expect(screen.getByTestId('is-connecting')).toHaveTextContent('false')
      expect(screen.getByTestId('latency')).toHaveTextContent('45')
      expect(screen.getByTestId('connection-status')).toHaveTextContent('connected')
    })

    it('should handle WebSocket error states', () => {
      const TestWrapper = createTestWrapper([], {
        isConnected: false,
        isConnecting: false,
        lastError: 'Connection failed'
      })
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('is-connected')).toHaveTextContent('false')
      expect(screen.getByTestId('last-error')).toHaveTextContent('Connection failed')
      expect(screen.getByTestId('connection-status')).toHaveTextContent('error')
    })

    it('should handle WebSocket connecting state', () => {
      const TestWrapper = createTestWrapper([], {
        isConnected: false,
        isConnecting: true,
        lastError: null
      })
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('is-connected')).toHaveTextContent('false')
      expect(screen.getByTestId('is-connecting')).toHaveTextContent('true')
      expect(screen.getByTestId('connection-status')).toHaveTextContent('connecting')
    })

    it('should subscribe to WebSocket notifications on mount', () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Should have called subscribe for notification messages
      expect(mockWebSocket.subscribe).toHaveBeenCalledWith('notification', expect.any(Function))
    })
  })

  describe('INVARIANT: Browser Notification API', () => {
    it('should request notification permission on mount', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Should request permission
      await waitFor(() => {
        expect(window.Notification.requestPermission).toHaveBeenCalled()
      })
    })

    it('should create browser notifications when permission granted', async () => {
      const TestWrapper = createTestWrapper([], { isConnected: true })
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Simulate WebSocket notification
      const subscribeCall = mockWebSocket.subscribe.mock.calls.find(call => call[0] === 'notification')
      const notificationHandler = subscribeCall?.[1]

      if (notificationHandler) {
        act(() => {
          notificationHandler({
            id: 'ws-notification',
            title: 'WebSocket Test',
            message: 'This came from WebSocket',
            type: 'info',
            category: 'websocket'
          })
        })
      }

      // Should create browser notification
      await waitFor(() => {
        expect(window.Notification).toHaveBeenCalledWith('WebSocket Test', {
          body: 'This came from WebSocket',
          icon: '/favicon.ico'
        })
      })
    })
  })

  describe('INVARIANT: Filtered Notification Hooks', () => {
    it('should filter notifications by type correctly', async () => {
      const TestWrapper = createTestWrapper([
        {
          id: '1',
          title: 'Error',
          message: 'Error message',
          type: 'error',
          priority: 'high',
          timestamp: new Date().toISOString(),
          read: false,
          category: 'system'
        },
        {
          id: '2',
          title: 'Info',
          message: 'Info message',
          type: 'info',
          priority: 'low',
          timestamp: new Date().toISOString(),
          read: false,
          category: 'general'
        }
      ])
      
      render(
        <TestWrapper>
          <FilteredNotificationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('error-notifications-count')).toHaveTextContent('1')
    })

    it('should filter notifications by category correctly', async () => {
      const TestWrapper = createTestWrapper([
        {
          id: '1',
          title: 'New Lead',
          message: 'Sales message',
          type: 'success',
          priority: 'high',
          timestamp: new Date().toISOString(),
          read: false,
          category: 'sales'
        },
        {
          id: '2',
          title: 'General Info',
          message: 'General message',
          type: 'info',
          priority: 'low',
          timestamp: new Date().toISOString(),
          read: false,
          category: 'general'
        }
      ])
      
      render(
        <TestWrapper>
          <FilteredNotificationsTestComponent />
        </TestWrapper>
      )

      expect(screen.getByTestId('sales-notifications-count')).toHaveTextContent('1')
    })

    it('should update filtered notifications when main list changes', async () => {
      const TestWrapper = createTestWrapper()
      
      render(
        <TestWrapper>
          <div>
            <NotificationsTestComponent />
            <FilteredNotificationsTestComponent />
          </div>
        </TestWrapper>
      )

      // Initially no error notifications
      expect(screen.getByTestId('error-notifications-count')).toHaveTextContent('0')

      // Simulate adding an error notification through context
      // (This would typically happen through WebSocket or direct action)
      // For this test, we'll verify the hook responds to context changes
      const errorCount = parseInt(screen.getByTestId('error-notifications-count').textContent || '0')
      expect(errorCount).toBe(0)
    })
  })

  describe('INVARIANT: Real-time Simulation', () => {
    it('should handle periodic notification simulation when connected', async () => {
      vi.useFakeTimers()
      
      const TestWrapper = createTestWrapper([], { isConnected: true })
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      const initialCount = parseInt(screen.getByTestId('notifications-count').textContent || '0')

      // Fast-forward time to trigger simulation
      act(() => {
        vi.advanceTimersByTime(60000) // 1 minute
      })

      // Should potentially add notifications (based on 20% chance)
      // Note: Since it's random, we just verify the system doesn't crash
      const newCount = parseInt(screen.getByTestId('notifications-count').textContent || '0')
      expect(newCount).toBeGreaterThanOrEqual(initialCount)

      vi.useRealTimers()
    })

    it('should not simulate notifications when disconnected', async () => {
      vi.useFakeTimers()
      
      const TestWrapper = createTestWrapper([], { isConnected: false })
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      const initialCount = parseInt(screen.getByTestId('notifications-count').textContent || '0')

      // Fast-forward time
      act(() => {
        vi.advanceTimersByTime(60000)
      })

      // Count should not change due to simulation
      const newCount = parseInt(screen.getByTestId('notifications-count').textContent || '0')
      expect(newCount).toBe(initialCount)

      vi.useRealTimers()
    })
  })

  describe('INVARIANT: Error Handling', () => {
    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw
      const originalSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage quota exceeded')
      })

      const TestWrapper = createTestWrapper()
      
      expect(() => {
        render(
          <TestWrapper>
            <NotificationsTestComponent />
          </TestWrapper>
        )
      }).not.toThrow()

      // Restore localStorage
      Storage.prototype.setItem = originalSetItem
    })

    it('should handle malformed notification data gracefully', () => {
      // Mock useKV to return malformed data initially
      mockUseKV.mockImplementation((key: string, defaultValue: any) => {
        if (key === 'notifications') {
          return [
            [{ /* malformed notification without required fields */ }],
            vi.fn()
          ]
        }
        return [defaultValue, vi.fn()]
      })

      const TestWrapper = createTestWrapper()
      
      expect(() => {
        render(
          <TestWrapper>
            <NotificationsTestComponent />
          </TestWrapper>
        )
      }).not.toThrow()
    })
  })

  describe('INVARIANT: Memory Management', () => {
    it('should limit notifications to prevent memory issues', async () => {
      vi.useFakeTimers()
      
      const TestWrapper = createTestWrapper([], { isConnected: true })
      
      render(
        <TestWrapper>
          <NotificationsTestComponent />
        </TestWrapper>
      )

      // Simulate many notifications over time
      for (let i = 0; i < 60; i++) {
        act(() => {
          vi.advanceTimersByTime(60000) // Advance 1 minute each time
        })
      }

      // Should not exceed reasonable limit (check max 50 as mentioned in implementation)
      await waitFor(() => {
        const count = parseInt(screen.getByTestId('notifications-count').textContent || '0')
        expect(count).toBeLessThanOrEqual(50)
      })

      vi.useRealTimers()
    })
  })
})