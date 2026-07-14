import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useReplitAuth } from '@/useReplitAuth'
import { logContextEvent } from '@/ContextDebugger'
import { createAuthHook } from '@/createRequiredContextHook'
import { fetchInstagramAccountMetrics } from '@/instagramIntegration'
import { useWebSocket } from '@/useWebSocket'
import { useKV } from '@/spark-mock'
import { csrfHeader } from '@/csrf'

const LOCAL_CRM_FOCUS_MODULE = (import.meta as any).env?.VITE_LOCAL_CRM_FOCUS_MODULE || ''
const SKIP_INSTAGRAM_PREFLIGHT = LOCAL_CRM_FOCUS_MODULE === 'meta-ads'

// =========================
// Auth
// =========================

export interface AuthUser {
  id: string
  username: string
  name: string
  displayName?: string
  email: string
  role?: string
  allowedUnits?: string[]
  allowedModules?: string[]
  createdAt: string
  avatarUrl?: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  initializing: boolean
  initProgress: number
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string, inviteToken: string) => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (data: Partial<Pick<AuthUser, 'name' | 'avatarUrl'>>) => void
  token: string | null
  isAuthenticated: boolean
}

const AuthContext: React.Context<AuthContextValue | undefined> =
  (import.meta.hot?.data.AuthCtx as React.Context<AuthContextValue | undefined> | undefined) ??
  createContext<AuthContextValue | undefined>(undefined)
if (import.meta.hot) {
  import.meta.hot.dispose(d => { d.AuthCtx = AuthContext })
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

export function AuthProvider({ children }: { children: ReactNode }) {
  logContextEvent('AuthProvider', 'INITIALIZING', { timestamp: Date.now() })
  if (import.meta.env.DEV) console.log('[AuthProvider] 🚀 Initializing AuthProvider...')

  const queryClient = useQueryClient()
  const replitAuth = useReplitAuth()

  logContextEvent('AuthProvider', 'REPLIT_AUTH_CALLED', {
    hasReplitAuth: !!replitAuth,
    hasUser: !!replitAuth?.user,
    isLoading: replitAuth?.isLoading
  })

  const user = replitAuth?.user || null
  const isLoading = replitAuth?.isLoading || false
  const isAuthenticated = replitAuth?.isAuthenticated || false
  const shouldShowLoadingOverlay = isLoading
  const [actionLoading, setActionLoading] = useState(false)
  const [initProgress, setInitProgress] = useState(0)
  const initStartedAtRef = React.useRef<number | null>(null)
  const AUTH_ME_QUERY_KEY = ['/api/auth/me']

  const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  const readJson = (text: string) => {
    try {
      return text ? JSON.parse(text) : null
    } catch {
      return null
    }
  }

  const mapMeToAuthUser = (me: any): AuthUser | null => {
    const insumosUser = me?.user || null
    if (!insumosUser) return null
    const email = String(insumosUser.email || '')
    const username = String(insumosUser.username || insumosUser.email || '')
    const id = username
    const displayName = String(insumosUser.displayName || insumosUser.name || insumosUser.username || email || '')
    return {
      id,
      username,
      name: displayName,
      displayName,
      email,
      role: insumosUser.role ? String(insumosUser.role) : undefined,
      allowedUnits: Array.isArray(insumosUser.allowedUnits) ? insumosUser.allowedUnits : undefined,
      allowedModules: Array.isArray(insumosUser.allowedModules) ? insumosUser.allowedModules : undefined,
      createdAt: String(insumosUser.createdAt || new Date().toISOString()),
      avatarUrl: insumosUser.photoUrl ? String(insumosUser.photoUrl) : undefined,
    }
  }

  const setAuthenticatedUserFromMe = (me: any) => {
    const mapped = mapMeToAuthUser(me)
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, mapped)
  }

  const friendlyLoginError = (status: number, payload: any) => {
    const raw = String(payload?.error || payload?.message || '').toLowerCase()
    if (status === 400) return 'Informe seu email (ou usuário) e senha.'
    if (status === 401) {
      if (raw.includes('password not set')) return 'Senha ainda não definida. Solicite ao gestor um reset de senha.'
      return 'Credenciais inválidas. Verifique email/usuário e senha.'
    }
    if (status === 403) {
      if (raw.includes('inactive')) return 'Usuário desativado. Solicite reativação ao gestor.'
      return 'Acesso não permitido.'
    }
    return payload?.error || payload?.message || `HTTP ${status}`
  }

  const friendlySignupError = (status: number, payload: any) => {
    const code = String(payload?.error || payload?.code || '')
    const friendly =
      code === 'TOKEN_REQUIRED' ? 'Informe o token de acesso.'
      : code === 'TOKEN_INVALID' ? 'Token inválido.'
      : code === 'TOKEN_REVOKED' ? 'Token revogado.'
      : code === 'TOKEN_EXPIRED' ? 'Token expirado.'
      : code === 'TOKEN_EXHAUSTED' ? 'Token já foi utilizado.'
      : code === 'EMAIL_TAKEN' ? 'Este email já está cadastrado.'
      : code === 'PASSWORD_TOO_SHORT' ? 'Senha muito curta (mín. 6).'
      : code === 'EMAIL_INVALID' ? 'Email inválido.'
      : code === 'NAME_REQUIRED' ? 'Informe seu nome.'
      : code === 'USERNAME_UNAVAILABLE' ? 'Não foi possível gerar um usuário único. Tente novamente.'
      : code === 'DB_NOT_CONFIGURED' ? 'Cadastro indisponível no momento. Tente novamente mais tarde.'
      : (payload?.error || payload?.message || `HTTP ${status}`)
    return friendly
  }

  const signIn = async (email: string, password: string) => {
    setActionLoading(true)
    try {
      const res = await fetchWithTimeout(
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: email.trim(), password })
        },
        45000
      ).catch((e: any) => {
        if (e?.name === 'AbortError') throw new Error('Tempo limite ao fazer login. Tente novamente.')
        throw e
      })

      const text = await res.text()
      const json: any = readJson(text)
      if (!res.ok) throw new Error(friendlyLoginError(res.status, json))

      // Confirm session is actually established (cookie survived the proxy) and hydrate React Query cache.
      const meRes = await fetchWithTimeout('/api/auth/me', { credentials: 'include' }, 15000).catch((e: any) => {
        if (e?.name === 'AbortError') return null
        return null
      })
      if (!meRes || !meRes.ok) {
        throw new Error('Login OK, mas a sessão não persistiu (cookies). Verifique se o navegador aceita cookies para crm.skincos.com.br.')
      }
      const me = await meRes.json().catch(() => null)
      setAuthenticatedUserFromMe(me)
      const updated = queryClient.getQueryData(AUTH_ME_QUERY_KEY) as any
      if (!updated) {
        throw new Error('Login OK, mas não foi possível carregar o perfil. Recarregue a página.')
      }
    } finally {
      setActionLoading(false)
    }
  }

  const signUp = async (name: string, email: string, password: string, inviteToken: string) => {
    setActionLoading(true)
    try {
      const res = await fetchWithTimeout(
        '/api/auth/register',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: name.trim(), email: email.trim(), password, token: inviteToken.trim() })
        },
        45000
      ).catch((e: any) => {
        if (e?.name === 'AbortError') throw new Error('Tempo limite ao criar a conta. Tente novamente.')
        throw e
      })

      const text = await res.text()
      const json: any = readJson(text)
      if (!res.ok) throw new Error(friendlySignupError(res.status, json))

      // Confirm session is actually established (cookie survived the proxy) and hydrate React Query cache.
      const meRes = await fetchWithTimeout('/api/auth/me', { credentials: 'include' }, 15000).catch(() => null)
      if (!meRes || !meRes.ok) {
        throw new Error('Conta criada, mas a sessão não persistiu (cookies). Verifique se o navegador aceita cookies para crm.skincos.com.br.')
      }
      const me = await meRes.json().catch(() => null)
      setAuthenticatedUserFromMe(me)
      const updated = queryClient.getQueryData(AUTH_ME_QUERY_KEY) as any
      if (!updated) {
        throw new Error('Conta criada, mas não foi possível carregar o perfil. Recarregue a página.')
      }
    } finally {
      setActionLoading(false)
    }
  }

  const isLocalHost =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

  const signOut = async () => {
    // In local development, allow explicit logout by disabling auth bypass for this browser.
    if (import.meta.env.DEV && isLocalHost) {
      try {
        localStorage.setItem('crm.localAuth', 'off')
      } catch {
        // ignore storage errors
      }
      try {
        document.cookie = 'crm.localAuth=off; Path=/; Max-Age=31536000; SameSite=Lax'
      } catch {
        // ignore cookie errors
      }
    }

    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json', ...csrfHeader() }
    }).catch(() => null)

    // Reset any cached auth state before reloading.
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, null)
    queryClient.removeQueries({ queryKey: AUTH_ME_QUERY_KEY, exact: true })
    window.location.assign('/')
  }

  const updateProfile = () => {
    if (import.meta.env.DEV) console.warn('Profile updates not yet implemented with Replit Auth')
  }

  const value: AuthContextValue = {
    user,
    loading: actionLoading,
    initializing: shouldShowLoadingOverlay,
    initProgress,
    signIn,
    signUp,
    signOut,
    updateProfile,
    token: null,
    isAuthenticated
  }

  useEffect(() => {
    if (!shouldShowLoadingOverlay) {
      initStartedAtRef.current = null
      setInitProgress(100)
      const t = setTimeout(() => setInitProgress(0), 250)
      return () => clearTimeout(t)
    }

    if (!initStartedAtRef.current) initStartedAtRef.current = Date.now()
    const tick = () => {
      const started = initStartedAtRef.current || Date.now()
      const elapsed = Date.now() - started
      const budgetMs = 12000
      const pct = Math.min(95, Math.max(1, Math.floor((elapsed / budgetMs) * 95)))
      setInitProgress(pct)
    }
    tick()
    const id = window.setInterval(tick, 150)
    return () => window.clearInterval(id)
  }, [shouldShowLoadingOverlay])

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
  refreshInstagram: () => Promise<void>
  connectWhatsApp: (baseUrl: string) => Promise<void>
  disconnectWhatsApp: () => void
  syncWhatsApp: () => Promise<void>
}

const IntegrationsContext: React.Context<IntegrationsContextValue | undefined> =
  (import.meta.hot?.data.IntegrationsCtx as React.Context<IntegrationsContextValue | undefined> | undefined) ??
  createContext<IntegrationsContextValue | undefined>(undefined)
if (import.meta.hot) {
  import.meta.hot.dispose(d => { d.IntegrationsCtx = IntegrationsContext })
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

const LS_WA_BASE_KEY = 'whatsapp-base-url'

export function IntegrationsProvider({ children }: { children: ReactNode }) {
  if (import.meta.env.DEV) console.log('[IntegrationsProvider] 🚀 Initializing IntegrationsProvider...')

  if (typeof window !== 'undefined') {
    if (!(window as any).__INT_CTX_MOUNTED__) {
      if (import.meta.env.DEV) console.log('[IntegrationsProvider] ✅ Client-side mount detected')
        ; (window as any).__INT_CTX_MOUNTED__ = true
    }
    ; (window as any).__INTEGRATIONS_PROVIDER_MOUNTED__ = true
  }

  const { isAuthenticated } = useAuth()
  const [instagram, setInstagram] = useState<InstagramIntegrationState>({ connected: false })
  const [whatsapp, setWhatsApp] = useState<WhatsAppIntegrationState>({ connected: false })

  const syncInstagramMetrics = useCallback(async () => {
    try {
      const metrics = await fetchInstagramAccountMetrics()
      setInstagram(prev => ({ ...prev, metrics, lastSync: new Date().toISOString(), error: undefined }))
    } catch (e: any) {
      setInstagram(prev => ({ ...prev, error: e.message }))
    }
  }, [])

  const syncInstagram = useCallback(async () => {
    if (!instagram.connected) return
    await syncInstagramMetrics()
  }, [instagram.connected, syncInstagramMetrics])

  const refreshInstagram = useCallback(async () => {
    try {
      const res = await fetch('/api/instagram/status', { credentials: 'include', headers: { accept: 'application/json' } })
      const text = await res.text()
      let data: any = null
      try { data = text ? JSON.parse(text) : null } catch { data = null }
      if (!res.ok) {
        setInstagram({ connected: false, error: data?.error || data?.message || `HTTP ${res.status}` })
        return
      }
      if (!data?.connected) {
        setInstagram({ connected: false })
        return
      }
      setInstagram(prev => ({ ...prev, connected: true, businessAccountId: data.businessAccountId, error: undefined }))
      await syncInstagramMetrics()
    } catch (e: any) {
      setInstagram({ connected: false, error: e?.message || 'Falha ao carregar status do Instagram' })
    }
  }, [syncInstagramMetrics])

  useEffect(() => {
    if (!isAuthenticated) {
      setInstagram({ connected: false })
      return
    }
    if (SKIP_INSTAGRAM_PREFLIGHT) {
      setInstagram({ connected: false })
      return
    }
    void refreshInstagram()
  }, [isAuthenticated, refreshInstagram])

  const connectInstagram = async (token: string, businessAccountId: string) => {
    const res = await fetch('/api/instagram/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...csrfHeader() },
      credentials: 'include',
      body: JSON.stringify({ accessToken: token, businessAccountId })
    })
    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`)

    setInstagram(prev => ({ ...prev, connected: true, businessAccountId, error: undefined }))
    await syncInstagramMetrics()
  }

  const disconnectInstagram = () => {
    fetch('/api/instagram/disconnect', { method: 'POST', credentials: 'include', headers: csrfHeader() })
      .catch(() => null)
      .finally(() => setInstagram({ connected: false }))
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
    refreshInstagram,
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

const NotificationContext: React.Context<NotificationContextType | undefined> =
  (import.meta.hot?.data.NotificationCtx as React.Context<NotificationContextType | undefined> | undefined) ??
  createContext<NotificationContextType | undefined>(undefined)
if (import.meta.hot) {
  import.meta.hot.dispose(d => { d.NotificationCtx = NotificationContext })
  import.meta.hot.accept(() => import.meta.hot?.invalidate())
}

export function useNotifications(): NotificationContextType {
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
  if (import.meta.env.DEV) console.log('[NotificationProvider] 🚀 Initializing NotificationProvider...')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      ; (window as any).__NOTIFICATION_PROVIDER_MOUNTED__ = true
    }
  }, [])

  const [notifications, setNotifications] = useKV<Notification[]>('notifications', [])
  const notificationsWsUrl = (import.meta as any)?.env?.VITE_NOTIFICATIONS_WS_URL
    ? String((import.meta as any).env.VITE_NOTIFICATIONS_WS_URL || '').trim()
    : ''
  const webSocket = useWebSocket({
    url: notificationsWsUrl || undefined,
    enabled: !!notificationsWsUrl,
    reconnectInterval: 3000,
    maxReconnectAttempts: 5,
    heartbeatInterval: 30000
  })

  logContextEvent('NotificationProvider', 'HOOKS_INITIALIZED', {
    notificationsLength: notifications?.length || 0,
    hasWebSocket: !!webSocket
  })

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
