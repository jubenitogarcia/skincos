import { useCallback, useEffect, useRef, useState } from 'react'
import { toISODateString } from '@/date-utils'

export interface WebSocketMessage {
  type: string
  data: any
  timestamp: string
  id?: string
}

export interface WebSocketConfig {
  url?: string
  enabled?: boolean
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
    url,
    enabled = import.meta.env.DEV, // disabled in production unless explicitly enabled
    reconnectInterval = 5000,
    maxReconnectAttempts = 3,
    heartbeatInterval = 60000
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
  const manualCloseRef = useRef<boolean>(false)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const connectRef = useRef<(() => void) | null>(null)
  const messageHandlersRef = useRef<Map<string, (data: any) => void>>(new Map())
  const lastPingRef = useRef<number>(0)

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current)
      heartbeatTimeoutRef.current = null
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
  }, [])

  const handleOpen = useCallback(() => {
    if (import.meta.env.DEV) console.log('WebSocket connected')
    setState((prev) => ({
      ...prev,
      isConnected: true,
      isConnecting: false,
      reconnectAttempts: 0,
      lastError: null
    }))

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        lastPingRef.current = Date.now()
        const pingMessage = { type: 'ping', timestamp: toISODateString(new Date()) }
        wsRef.current.send(JSON.stringify(pingMessage))
      }
    }, heartbeatInterval)
  }, [heartbeatInterval])

  const handleMessage = useCallback((message: WebSocketMessage) => {
    setState((prev) => ({ ...prev, lastMessage: message }))

    if (message.type === 'pong' && lastPingRef.current) {
      const latency = Date.now() - lastPingRef.current
      setState((prev) => ({ ...prev, latency }))
      lastPingRef.current = 0
    }

    const handler = messageHandlersRef.current.get(message.type)
    if (handler) handler(message.data)

    const generalHandler = messageHandlersRef.current.get('*')
    if (generalHandler) generalHandler(message)
  }, [])

  const scheduleReconnect = useCallback(() => {
    setState((prev) => {
      if (prev.reconnectAttempts >= maxReconnectAttempts) {
        return { ...prev, lastError: 'Max reconnection attempts reached' }
      }

      const nextAttempts = prev.reconnectAttempts + 1
      if (reconnectTimeoutRef.current) {
        try { clearTimeout(reconnectTimeoutRef.current) } catch { /* ignore */ }
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current?.()
      }, reconnectInterval)

      return { ...prev, reconnectAttempts: nextAttempts }
    })
  }, [maxReconnectAttempts, reconnectInterval])

  const handleClose = useCallback(() => {
    if (import.meta.env.DEV) console.log('WebSocket disconnected')
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isConnecting: false
    }))

    cleanup()

    if (manualCloseRef.current) {
      manualCloseRef.current = false
      return
    }
    scheduleReconnect()
  }, [cleanup, scheduleReconnect])

  const connect = useCallback(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, isConnected: false, isConnecting: false }))
      return
    }

    if (!url) {
      setState((prev) => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        lastError: prev.lastError || 'WebSocket URL not configured'
      }))
      return
    }

    if (wsRef.current?.readyState === WebSocket.CONNECTING || wsRef.current?.readyState === WebSocket.OPEN) return

    manualCloseRef.current = false
    setState((prev) => ({ ...prev, isConnecting: true, lastError: null }))

    try {
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.addEventListener('open', handleOpen)
      ws.addEventListener('close', handleClose)
      ws.addEventListener('error', () => {
        setState((prev) => ({ ...prev, lastError: 'WebSocket error' }))
      })
      ws.addEventListener('message', (ev) => {
        try {
          const raw = typeof ev.data === 'string' ? ev.data : ''
          const parsed = raw ? JSON.parse(raw) : null
          if (parsed && typeof parsed === 'object' && typeof (parsed as any).type === 'string') {
            handleMessage({
              type: (parsed as any).type,
              data: (parsed as any).data,
              timestamp: (parsed as any).timestamp || toISODateString(new Date()),
              id: (parsed as any).id
            })
          }
        } catch {
          // ignore
        }
      })
    } catch (error) {
      console.error('WebSocket connection error:', error)
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        lastError: error instanceof Error ? error.message : 'Connection failed'
      }))
    }
  }, [enabled, handleClose, handleMessage, handleOpen, url])

  connectRef.current = connect

  const disconnect = useCallback(() => {
    cleanup()
    if (wsRef.current) {
      manualCloseRef.current = true
      wsRef.current.close()
      wsRef.current = null
    }
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      reconnectAttempts: 0
    }))
  }, [cleanup])

  const send = useCallback(
    (message: Omit<WebSocketMessage, 'timestamp'>) => {
      if (!enabled) return false
      if (wsRef.current?.readyState !== WebSocket.OPEN) return false

      const fullMessage: WebSocketMessage = { ...message, timestamp: toISODateString(new Date()) }
      if (import.meta.env.DEV && String(message.type || '').toLowerCase() === 'ping') {
        // eslint-disable-next-line no-console
        console.debug('[ws] ping')
      }
      wsRef.current.send(JSON.stringify(fullMessage))
      return true
    },
    [enabled]
  )

  const subscribe = useCallback((messageType: string, handler: (data: any) => void) => {
    messageHandlersRef.current.set(messageType, handler)
    return () => {
      messageHandlersRef.current.delete(messageType)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!enabled) return
    const interval = setInterval(() => {
      if (Math.random() < 0.05 && state.isConnected) {
        console.log('Simulating connection issue...')
        handleClose()
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [enabled, handleClose, state.isConnected])

  return { ...state, connect, disconnect, send, subscribe }
}
