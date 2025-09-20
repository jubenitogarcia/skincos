import { useState, useEffect, useRef, useCallback } from 'react'
import { toISODateString } from '@/lib/date-utils'

export interface WebSocketMessage {
  type: string
  data: any
  timestamp: string
  id?: string
}

export interface WebSocketConfig {
  url?: string
  reconnectInterval?: number
  maxReconnectAttempts?: number
  heartbeatInterval?: number
}

export interface WebSocketState {
  isConnected: boolean
  isConnecting: boolean
  lastError: string | null
  reconnectAttempts: number
  lastMessage: WebSocketMessage | null
  latency: number
}

export function useWebSocket(config: WebSocketConfig = {}) {
  const {
    url = 'wss://echo.websocket.org', // Use a more reliable WebSocket URL for demo
    reconnectInterval = 5000, // Increased interval
    maxReconnectAttempts = 3, // Reduced attempts
    heartbeatInterval = 60000 // Increased heartbeat interval
  } = config

  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isConnecting: false,
    lastError: null,
    reconnectAttempts: 0,
    lastMessage: null,
    latency: 0
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const heartbeatTimeoutRef = useRef<number | null>(null)
  const heartbeatIntervalRef = useRef<number | null>(null)
  const messageHandlersRef = useRef<Map<string, (data: any) => void>>(new Map())
  const lastPingRef = useRef<number>(0)

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (heartbeatTimeoutRef.current) {
      window.clearTimeout(heartbeatTimeoutRef.current)
      heartbeatTimeoutRef.current = null
    }
    if (heartbeatIntervalRef.current) {
      window.clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.CONNECTING ||
      wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setState(prev => ({
      ...prev,
      isConnecting: true,
      lastError: null
    }))

    try {
      // For demo purposes, we'll simulate a WebSocket connection
      // In production, this would be a real WebSocket URL
      const mockWs: any = {
        readyState: WebSocket.OPEN, // Start as open to avoid connection delays
        send: (data: string) => {
          console.log('Mock WebSocket send:', data)
          const parsed = JSON.parse(data)
          if (parsed.type === 'ping') {
            // Simulate pong response with minimal latency
            setTimeout(() => {
              if (mockWs.readyState === WebSocket.OPEN) {
                handleMessage({
                  type: 'pong',
                  data: { timestamp: Date.now() },
                  timestamp: toISODateString(new Date())
                })
              }
            }, 25 + Math.random() * 25) // 25-50ms latency
          }
        },
        close: () => {
          mockWs.readyState = WebSocket.CLOSED
          handleClose()
        }
      }

      wsRef.current = mockWs

      // Immediately simulate successful connection
      setTimeout(() => {
        if (mockWs.readyState === WebSocket.OPEN) {
          handleOpen()
        }
      }, 100) // Very short delay to simulate connection

    } catch (error) {
      console.error('WebSocket connection error:', error)
      setState(prev => ({
        ...prev,
        isConnecting: false,
        lastError: error instanceof Error ? error.message : 'Connection failed'
      }))
    }
  }, [])

  const handleOpen = useCallback(() => {
    console.log('WebSocket connected')
    setState(prev => ({
      ...prev,
      isConnected: true,
      isConnecting: false,
      reconnectAttempts: 0,
      lastError: null
    }))

    // Start heartbeat
    heartbeatIntervalRef.current = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        lastPingRef.current = Date.now()
        const pingMessage = {
          type: 'ping',
          timestamp: toISODateString(new Date())
        }
        wsRef.current.send(JSON.stringify(pingMessage))
      }
    }, heartbeatInterval)

  }, [heartbeatInterval])

  const handleMessage = useCallback((message: WebSocketMessage) => {
    setState(prev => ({ ...prev, lastMessage: message }))

    // Handle pong for latency calculation
    if (message.type === 'pong' && lastPingRef.current) {
      const latency = Date.now() - lastPingRef.current
      setState(prev => ({ ...prev, latency }))
      lastPingRef.current = 0
    }

    // Call registered message handlers
    const handler = messageHandlersRef.current.get(message.type)
    if (handler) {
      handler(message.data)
    }

    // Call general message handler
    const generalHandler = messageHandlersRef.current.get('*')
    if (generalHandler) {
      generalHandler(message)
    }
  }, [])

  const handleClose = useCallback(() => {
    console.log('WebSocket disconnected')
    setState(prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false
    }))

    cleanup()

    // Attempt reconnection if not manually closed
    if (state.reconnectAttempts < maxReconnectAttempts) {
      setState(prev => ({
        ...prev,
        reconnectAttempts: prev.reconnectAttempts + 1
      }))

      reconnectTimeoutRef.current = setTimeout(() => {
        connect()
      }, reconnectInterval)
    } else {
      setState(prev => ({
        ...prev,
        lastError: 'Max reconnection attempts reached'
      }))
    }
  }, [state.reconnectAttempts, maxReconnectAttempts, reconnectInterval, connect, cleanup])

  const disconnect = useCallback(() => {
    cleanup()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setState(prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      reconnectAttempts: 0
    }))
  }, [cleanup])

  const send = useCallback((message: Omit<WebSocketMessage, 'timestamp'>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const fullMessage: WebSocketMessage = {
        ...message,
        timestamp: toISODateString(new Date())
      }
      wsRef.current.send(JSON.stringify(fullMessage))
      return true
    }
    return false
  }, [])

  const subscribe = useCallback((messageType: string, handler: (data: any) => void) => {
    messageHandlersRef.current.set(messageType, handler)

    // Return unsubscribe function
    return () => {
      messageHandlersRef.current.delete(messageType)
    }
  }, [])

  // Auto-connect on mount
  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  // Simulate periodic connection issues for demo
  useEffect(() => {
    const simulateIssues = () => {
      // 5% chance every 30 seconds to simulate disconnection
      if (Math.random() < 0.05 && state.isConnected) {
        console.log('Simulating connection issue...')
        handleClose()
      }
    }

    const interval = window.setInterval(simulateIssues, 30000)
    return () => window.clearInterval(interval)
  }, [state.isConnected, handleClose])

  return {
    ...state,
    connect,
    disconnect,
    send,
    subscribe
  }
}
