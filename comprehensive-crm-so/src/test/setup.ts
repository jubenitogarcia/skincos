import '@testing-library/jest-dom'
import { expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import React from 'react'

// Ensure React is available globally
globalThis.React = React

// Ensure window object exists for React 18
if (typeof window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...globalThis,
      location: { href: 'http://localhost:3000', reload: vi.fn() },
      navigator: { userAgent: 'test' }
    },
    writable: true
  })
}

// Ensure AbortSignal.timeout is available for BootGate
if (!globalThis.AbortSignal?.timeout) {
  Object.defineProperty(globalThis.AbortSignal || {}, 'timeout', {
    value: (ms: number) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), ms)
      return controller.signal
    },
    writable: true
  })
}

// Mock global environment variables
Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: true,
    VITE_INSTAGRAM_ACCESS_TOKEN: 'test-instagram-token',
    VITE_INSTAGRAM_BUSINESS_ACCOUNT_ID: 'test-business-id',
    MODE: 'test'
  },
  writable: true
})

// Mock fetch globally
const fetchMock = vi.fn()
globalThis.fetch = fetchMock

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
})

// Mock EventSource for WebSocket tests
class MockEventSource {
  onopen: ((this: EventSource, ev: Event) => any) | null = null
  onmessage: ((this: EventSource, ev: MessageEvent) => any) | null = null
  onerror: ((this: EventSource, ev: Event) => any) | null = null
  close = vi.fn()
  
  constructor(public url: string) {
    setTimeout(() => {
      if (this.onopen) {
        this.onopen.call(this, new Event('open'))
      }
    }, 10)
  }
}
Object.defineProperty(window, 'EventSource', {
  value: MockEventSource
})

// Mock Notification API
Object.defineProperty(window, 'Notification', {
  value: class MockNotification {
    static permission = 'granted'
    static requestPermission = vi.fn().mockResolvedValue('granted')
    constructor(title: string, options?: NotificationOptions) {}
  }
})

// Clear mocks after each test
afterEach(() => {
  vi.clearAllMocks()
  localStorageMock.getItem.mockClear()
  localStorageMock.setItem.mockClear()
  localStorageMock.removeItem.mockClear()
  localStorageMock.clear.mockClear()
  fetchMock.mockClear()
  
  // Clear window properties that tests might set (safely)
  if (typeof window !== 'undefined' && window && typeof window === 'object') {
    const windowObj = window as any
    try {
      // Safe property deletion
      const propsToDelete = [
        '__AUTH_PROVIDER_MOUNTED__',
        '__INTEGRATIONS_PROVIDER_MOUNTED__',
        '__NOTIFICATION_PROVIDER_MOUNTED__',
        '__BOOT_GATE_READY__',
        '__PROVIDERS_DIAGRAM__'
      ]
      
      propsToDelete.forEach(prop => {
        if (prop in windowObj) {
          delete windowObj[prop]
        }
      })
    } catch (e) {
      // Ignore deletion errors in test environment
      console.debug('[Test Setup] Could not clear window properties:', e)
    }
  }
  
  // Reset timers
  vi.useRealTimers()
})

// Setup global test utilities
beforeAll(() => {
  // Mock console methods to reduce test noise
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
})