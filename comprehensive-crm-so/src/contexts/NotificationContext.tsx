import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useKV } from '@/lib/spark-mock'
import { logContextEvent } from '../debug/ContextDebugger'

export interface Notification {
  id: string
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  priority: 'low' | 'medium' | 'high'
  timestamp: string
  read: boolean
  category: string
  actions?: Array<{
    label: string
    action: string
    primary?: boolean
  }>
  relatedId?: string
  relatedType?: string
}

interface NotificationContextType {
  notifications: Notification[]
  unreadCount: number
  isConnected: boolean
  isConnecting: boolean
  lastError: string | null
  latency: number
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  removeNotification: (id: string) => void
  clearAll: () => void
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error'
  getNotificationsByType: (type: string) => Notification[]
  getNotificationsByCategory: (category: string) => Notification[]
}

// HMR-stable singleton Context - survives hot reloads
const NotificationContext = (import.meta.hot?.data.NotificationCtx) ?? createContext<NotificationContextType | undefined>(undefined)
if (import.meta.hot) {
    import.meta.hot.dispose(d => { d.NotificationCtx = NotificationContext })
    import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
    // CAPTURE DETAILED ERROR INFORMATION
    const stackTrace = new Error().stack
    const contextInfo = {
      NotificationContext: !!NotificationContext,
      hasProvider: typeof window !== 'undefined' && !!(window as any).__NOTIFICATION_PROVIDER_MOUNTED__,
      stackTrace
    }
    
    logContextEvent('useNotifications', 'CONTEXT_NULL_ERROR', contextInfo, true)
    console.error('🚨 [useNotifications] Context is null!', contextInfo)
    
    throw new Error(`useNotifications must be used within NotificationProvider. Context: ${JSON.stringify(contextInfo)}`)
  }
  return context
}

// Hook for filtering notifications by type - exports properly
export function useNotificationsByType(type: string) {
  const { notifications } = useNotifications()
  return notifications.filter(notification => notification.type === type)
}

// Additional hook for filtering notifications by category
export function useNotificationsByCategory(category: string) {
  const { notifications } = useNotifications()
  return notifications.filter(notification => notification.category === category)
}

interface NotificationProviderProps {
  children: React.ReactNode
}

export function NotificationProvider({ children }: NotificationProviderProps) {
  logContextEvent('NotificationProvider', 'INITIALIZING', { timestamp: Date.now() })
  console.log('[NotificationProvider] 🚀 Initializing NotificationProvider...')
  
  // HOOKS DEVEM SER CHAMADOS INCONDICIONALMENTE - SEM TRY/CATCH
  const [notifications, setNotifications] = useKV<Notification[]>('notifications', [])
  const webSocket = useWebSocket({
    url: 'wss://api.crm-demo.com/ws',
    reconnectInterval: 3000,
    maxReconnectAttempts: 5,
    heartbeatInterval: 30000
  })
  
  logContextEvent('NotificationProvider', 'HOOKS_INITIALIZED', { 
    notificationsLength: notifications?.length || 0,
    hasWebSocket: !!webSocket 
  })

  // Generate some demo notifications
  useEffect(() => {
    if (notifications.length === 0) {
      const demoNotifications: Notification[] = [
        {
          id: '1',
          title: 'Nova oportunidade qualificada',
          message: 'Lead TechCorp passou para etapa de qualificação com score IA: 92%',
          type: 'success',
          priority: 'high',
          timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          read: false,
          category: 'sales',
          relatedId: '1',
          relatedType: 'opportunity'
        },
        {
          id: '2',
          title: 'Cliente em risco de churn',
          message: 'DataFlow Corp não interage há 30 dias. Ação recomendada: campanha reativação',
          type: 'warning',
          priority: 'high',
          timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
          read: false,
          category: 'retention'
        },
        {
          id: '3',
          title: 'Meta mensal atingida',
          message: 'Parabéns! Você atingiu 105% da meta de vendas deste mês',
          type: 'success',
          priority: 'medium',
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          read: true,
          category: 'achievement'
        }
      ]
      setNotifications(demoNotifications)
    }
  }, [notifications.length, setNotifications])

  // WebSocket message handling
  useEffect(() => {
    const unsubscribe = webSocket.subscribe('notification', (data) => {
      const notification: Notification = {
        id: data.id || Date.now().toString(),
        title: data.title,
        message: data.message,
        type: data.type || 'info',
        priority: data.priority || 'medium',
        timestamp: new Date().toISOString(),
        read: false,
        category: data.category || 'general',
        actions: data.actions,
        relatedId: data.relatedId,
        relatedType: data.relatedType
      }

      setNotifications(prev => [notification, ...prev])

      // Show browser notification if supported and permitted
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(notification.title, {
          body: notification.message,
          icon: '/favicon.ico'
        })
      }
    })

    return unsubscribe
  }, [webSocket, setNotifications])

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // Simulate real-time notifications for demo
  useEffect(() => {
    if (!webSocket.isConnected) return

    const simulateNotifications = () => {
      const notificationTypes = [
        {
          title: 'Nova mensagem WhatsApp',
          message: 'Cliente Tech Solutions enviou uma mensagem',
          type: 'info' as const,
          priority: 'medium' as const,
          category: 'communication'
        },
        {
          title: 'Oportunidade movida',
          message: 'Oportunidade CloudCorp movida para "Negociação"',
          type: 'info' as const,
          priority: 'low' as const,
          category: 'pipeline'
        },
        {
          title: 'Tarefa vencida',
          message: 'Follow-up com NextGen está atrasado em 2 dias',
          type: 'warning' as const,
          priority: 'high' as const,
          category: 'tasks'
        },
        {
          title: 'Novo lead qualificado',
          message: 'IA identificou lead de alta qualidade: InnovateX',
          type: 'success' as const,
          priority: 'high' as const,
          category: 'leads'
        }
      ]

      // 20% chance every minute to generate a notification
      if (Math.random() < 0.2) {
        const randomNotification = notificationTypes[Math.floor(Math.random() * notificationTypes.length)]

        const notification: Notification = {
          id: Date.now().toString(),
          ...randomNotification,
          timestamp: new Date().toISOString(),
          read: false
        }

        setNotifications(prev => [notification, ...prev.slice(0, 49)]) // Keep max 50 notifications
      }
    }

    const interval = setInterval(simulateNotifications, 60000) // Every minute
    return () => clearInterval(interval)
  }, [webSocket.isConnected, setNotifications])

  const addNotification = (notificationData: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const notification: Notification = {
      ...notificationData,
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      read: false
    }

    setNotifications(prev => [notification, ...prev])
  }

  const markAsRead = (id: string) => {
    setNotifications(prev =>
      prev.map(notification =>
        notification.id === id
          ? { ...notification, read: true }
          : notification
      )
    )
  }

  const markAllAsRead = () => {
    setNotifications(prev =>
      prev.map(notification => ({ ...notification, read: true }))
    )
  }

  const removeNotification = (id: string) => {
    setNotifications(prev =>
      prev.filter(notification => notification.id !== id)
    )
  }

  const clearAll = () => {
    setNotifications([])
  }

  const getNotificationsByType = (type: string) => {
    return notifications.filter(notification => notification.type === type)
  }

  const getNotificationsByCategory = (category: string) => {
    return notifications.filter(notification => notification.category === category)
  }

  const unreadCount = notifications.filter(n => !n.read).length

  // Determine connection status
  let connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error'
  if (webSocket.lastError) {
    connectionStatus = 'error'
  } else if (webSocket.isConnecting) {
    connectionStatus = 'connecting'
  } else if (webSocket.isConnected) {
    connectionStatus = 'connected'
  } else {
    connectionStatus = 'disconnected'
  }

  const contextValue: NotificationContextType = {
    notifications,
    unreadCount,
    isConnected: webSocket.isConnected,
    isConnecting: webSocket.isConnecting,
    lastError: webSocket.lastError,
    latency: webSocket.latency,
    addNotification,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
    connectionStatus,
    getNotificationsByType,
    getNotificationsByCategory
  }

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  )
}
