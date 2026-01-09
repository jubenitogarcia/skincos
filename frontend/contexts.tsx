import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useReplitAuth } from '@/useReplitAuth'
import { logContextEvent } from '@/ContextDebugger'
import { createAuthHook } from '@/createRequiredContextHook'
import { isNoAuthMode, logNoAuthMode } from '@/noAuthMode'
import { fetchInstagramAccountMetrics } from '@/instagramIntegration'
import { useWebSocket } from '@/useWebSocket'
import { useKV } from '@/spark-mock'

// =========================
// Auth
// =========================

export interface AuthUser {
  id: string
  name: string
  email: string
  createdAt: string
  avatarUrl?: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  signOut: () => void
  updateProfile: (data: Partial<Pick<AuthUser, 'name' | 'avatarUrl'>>) => void
  token: string | null
  isAuthenticated: boolean
}

const AuthContext = (import.meta.hot?.data.AuthCtx) ?? createContext<AuthContextValue | undefined>(undefined)
if (import.meta.hot) {
  import.meta.hot.dispose(d => { d.AuthCtx = AuthContext })
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

export function AuthProvider({ children }: { children: ReactNode }) {
  logContextEvent('AuthProvider', 'INITIALIZING', { timestamp: Date.now() })
  console.log('[AuthProvider] 🚀 Initializing AuthProvider...')

  const replitAuth = useReplitAuth()

  logContextEvent('AuthProvider', 'REPLIT_AUTH_CALLED', {
    hasReplitAuth: !!replitAuth,
    hasUser: !!replitAuth?.user,
    isLoading: replitAuth?.isLoading
  })

  const user = replitAuth?.user || null
  const isLoading = replitAuth?.isLoading || false
  const isAuthenticated = replitAuth?.isAuthenticated || false
  const shouldShowLoadingOverlay = isLoading && !isNoAuthMode()

  const signIn = async () => {
    if (isNoAuthMode()) {
      logNoAuthMode('AuthContext.signIn', 'Bypassing login redirect - already authenticated in NO_AUTH mode')
      return Promise.resolve()
    }
    window.location.href = '/api/login'
  }

  const signUp = async () => {
    if (isNoAuthMode()) {
      logNoAuthMode('AuthContext.signUp', 'Bypassing signup redirect - already authenticated in NO_AUTH mode')
      return Promise.resolve()
    }
    window.location.href = '/api/login'
  }

  const signOut = () => {
    if (isNoAuthMode()) {
      logNoAuthMode('AuthContext.signOut', 'Bypassing logout redirect - staying authenticated in NO_AUTH mode')
      return
    }
    window.location.href = '/api/logout'
  }

  const updateProfile = () => {
    console.warn('Profile updates not yet implemented with Replit Auth')
  }

  const value: AuthContextValue = {
    user,
    loading: isLoading,
    signIn,
    signUp,
    signOut,
    updateProfile,
    token: null,
    isAuthenticated
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__AUTH_PROVIDER_MOUNTED__ = true
    }
  }, [])

  logContextEvent('AuthProvider', 'RENDERING_PROVIDER', {
    hasUser: !!user,
    isLoading,
    isAuthenticated
  })

  return (
    <AuthContext.Provider value={value}>
      {shouldShowLoadingOverlay && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          fontFamily: 'system-ui',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🔄</div>
            <div>Inicializando autenticação...</div>
          </div>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = createAuthHook(AuthContext)

// =========================
// Integrations
// =========================

interface InstagramIntegrationState {
  connected: boolean
  accessToken?: string
  businessAccountId?: string
  lastSync?: string
  metrics?: any
  error?: string
}

interface WhatsAppIntegrationState {
  connected: boolean
  baseUrl?: string
  lastSync?: string
  error?: string
  stats?: any
}

interface IntegrationsContextValue {
  instagram: InstagramIntegrationState
  whatsapp: WhatsAppIntegrationState
  connectInstagram: (token: string, businessAccountId: string) => Promise<void>
  disconnectInstagram: () => void
  syncInstagram: () => Promise<void>
  connectWhatsApp: (baseUrl: string) => Promise<void>
  disconnectWhatsApp: () => void
  syncWhatsApp: () => Promise<void>
}

const IntegrationsContext = (import.meta.hot?.data.IntegrationsCtx) ?? createContext<IntegrationsContextValue | undefined>(undefined)
if (import.meta.hot) {
  import.meta.hot.dispose(d => { d.IntegrationsCtx = IntegrationsContext })
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

const LS_TOKEN_KEY = 'instagram-access-token'
const LS_BIZ_ID_KEY = 'instagram-business-account-id'
const LS_WA_BASE_KEY = 'whatsapp-base-url'

export function IntegrationsProvider({ children }: { children: ReactNode }) {
  console.log('[IntegrationsProvider] 🚀 Initializing IntegrationsProvider...')

  if (typeof window !== 'undefined') {
    if (!(window as any).__INT_CTX_MOUNTED__) {
      console.log('[IntegrationsProvider] ✅ Client-side mount detected')
        ; (window as any).__INT_CTX_MOUNTED__ = true
    }
    ; (window as any).__INTEGRATIONS_PROVIDER_MOUNTED__ = true
  }

  const [instagram, setInstagram] = useState<InstagramIntegrationState>({ connected: false })
  const [whatsapp, setWhatsApp] = useState<WhatsAppIntegrationState>({ connected: false })

  useEffect(() => {
    const storedToken = localStorage.getItem(LS_TOKEN_KEY) || (import.meta as any).env.VITE_INSTAGRAM_ACCESS_TOKEN
    const storedBiz = localStorage.getItem(LS_BIZ_ID_KEY) || (import.meta as any).env.VITE_INSTAGRAM_BUSINESS_ACCOUNT_ID
    if (storedToken && storedBiz) {
      setInstagram(prev => ({ ...prev, connected: true, accessToken: storedToken, businessAccountId: storedBiz }))
    }
  }, [])

  const connectInstagram = async (token: string, businessAccountId: string) => {
    localStorage.setItem(LS_TOKEN_KEY, token)
    localStorage.setItem(LS_BIZ_ID_KEY, businessAccountId)
    setInstagram({ connected: true, accessToken: token, businessAccountId })
    await syncInstagram()
  }

  const disconnectInstagram = () => {
    localStorage.removeItem(LS_TOKEN_KEY)
    localStorage.removeItem(LS_BIZ_ID_KEY)
    setInstagram({ connected: false })
  }

  const syncInstagram = async () => {
    if (!instagram.accessToken || !instagram.businessAccountId) return
    try {
      const metrics = await fetchInstagramAccountMetrics(instagram.businessAccountId, instagram.accessToken)
      setInstagram(prev => ({ ...prev, metrics, lastSync: new Date().toISOString(), error: undefined }))
    } catch (e: any) {
      setInstagram(prev => ({ ...prev, error: e.message }))
    }
  }

  useEffect(() => {
    const storedBase = localStorage.getItem(LS_WA_BASE_KEY)
    if (storedBase) setWhatsApp(prev => ({ ...prev, connected: true, baseUrl: storedBase }))
  }, [])

  const connectWhatsApp = async (baseUrl: string) => {
    const normalized = baseUrl.replace(/\/$/, '')
    localStorage.setItem(LS_WA_BASE_KEY, normalized)
    setWhatsApp({ connected: true, baseUrl: normalized })
    await syncWhatsApp()
  }

  const disconnectWhatsApp = () => {
    localStorage.removeItem(LS_WA_BASE_KEY)
    setWhatsApp({ connected: false })
  }

  const syncWhatsApp = async () => {
    if (!whatsapp.baseUrl) return
    try {
      const res = await fetch(`${whatsapp.baseUrl.replace(/\/$/, '')}/stats`).catch(() => null)
      if (res && res.ok) {
        const stats = await res.json()
        setWhatsApp(prev => ({ ...prev, stats, lastSync: new Date().toISOString(), error: undefined }))
      } else {
        setWhatsApp(prev => ({ ...prev, lastSync: new Date().toISOString() }))
      }
    } catch (e: any) {
      setWhatsApp(prev => ({ ...prev, error: e.message }))
    }
  }

  const value: IntegrationsContextValue = {
    instagram: {
      ...instagram,
      get lastSyncDate() {
        return instagram.lastSync ? new Date(instagram.lastSync) : undefined
      }
    } as any,
    whatsapp: {
      ...whatsapp,
      get lastSyncDate() {
        return whatsapp.lastSync ? new Date(whatsapp.lastSync) : undefined
      }
    } as any,
    connectInstagram,
    disconnectInstagram,
    syncInstagram,
    connectWhatsApp,
    disconnectWhatsApp,
    syncWhatsApp
  }

  return <IntegrationsContext.Provider value={value}>{children}</IntegrationsContext.Provider>
}

export function useIntegrations(): IntegrationsContextValue {
  const ctx = useContext(IntegrationsContext)
  if (!ctx) {
    const stackTrace = new Error().stack
    const contextInfo = {
      IntegrationsContext: !!IntegrationsContext,
      hasProvider: typeof window !== 'undefined' && !!(window as any).__INTEGRATIONS_PROVIDER_MOUNTED__,
      stackTrace
    }

    logContextEvent('useIntegrations', 'CONTEXT_NULL_ERROR', contextInfo, true)
    console.error('🚨 [useIntegrations] Context is null!', contextInfo)

    throw new Error(`useIntegrations must be used within IntegrationsProvider. Context: ${JSON.stringify(contextInfo)}`)
  }
  return ctx
}

// =========================
// Notifications
// =========================

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

const NotificationContext = (import.meta.hot?.data.NotificationCtx) ?? createContext<NotificationContextType | undefined>(undefined)
if (import.meta.hot) {
  import.meta.hot.dispose(d => { d.NotificationCtx = NotificationContext })
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
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

export function useNotificationsByType(type: string) {
  const { notifications } = useNotifications()
  return notifications.filter(notification => notification.type === type)
}

export function useNotificationsByCategory(category: string) {
  const { notifications } = useNotifications()
  return notifications.filter(notification => notification.category === category)
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  logContextEvent('NotificationProvider', 'INITIALIZING', { timestamp: Date.now() })
  console.log('[NotificationProvider] 🚀 Initializing NotificationProvider...')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      ; (window as any).__NOTIFICATION_PROVIDER_MOUNTED__ = true
    }
  }, [])

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

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(notification.title, { body: notification.message })
      }
    })

    return unsubscribe
  }, [webSocket, setNotifications])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

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

      if (Math.random() < 0.2) {
        const randomNotification = notificationTypes[Math.floor(Math.random() * notificationTypes.length)]

        const notification: Notification = {
          id: Date.now().toString(),
          ...randomNotification,
          timestamp: new Date().toISOString(),
          read: false
        }

        setNotifications(prev => [notification, ...prev.slice(0, 49)])
      }
    }

    const interval = setInterval(simulateNotifications, 60000)
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
