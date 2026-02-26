import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Label } from "@/label"
import { ScrollArea } from "@/scroll-area"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/dialog"
import { Alert, AlertDescription } from "@/alert"
import { toast } from 'sonner'
import * as QRCode from 'qrcode'
import { LoadingPercentText } from '@/LoadingPattern'
import {
  WhatsappLogo,
  Play,
  Stop,
  ArrowClockwise,
  CheckCircle,
  XCircle,
  Clock,
  Warning,
  QrCode,
  Spinner,
  Eye,
  Copy
} from "@phosphor-icons/react"

// Channel-based interfaces
interface ChannelInstance {
  id: string
  port: number
  channel: number
  status: 'free' | 'available' | 'starting' | 'qr_pending' | 'connected' | 'error' | 'stopping'
  name?: string
  createdAt: string
  updatedAt: string
  metadata?: {
    phoneNumber?: string
    errorCount?: number
    restartCount?: number
    lastActivity?: string
    errorMessage?: string
  }
}

interface OrchestratorStatus {
  provider?: string
  totalChannels?: number
  availableChannels?: number
  totalInstances: number
  freeInstances: number
  connectedInstances: number
  errorInstances: number
  startingInstances?: number
  instances: ChannelInstance[]
  availableChannelsList: number[]
  freeChannelsList: number[]
}

interface QRData {
  qr: string
  dataUrl?: string
}

interface ConversationItem {
  conversationId: string
  lastMessage: string
  updatedAt: string
  unreadCount?: number
  archived?: boolean
  name?: string
}

interface MessageItem {
  id: string
  conversationId: string
  direction: 'inbound' | 'outbound' | 'human' | 'system'
  type: string
  text?: string
  caption?: string
  mediaType?: string
  createdAt: string
}

// Channel to port mapping (1-9 → 3001-3009)
const channelToPort = (channel: number) => 3000 + channel
const portToChannel = (port: number) => port - 3000

const STATUS_COLORS = {
  free: 'bg-green-500',
  available: 'bg-green-500',
  starting: 'bg-yellow-500',
  qr_pending: 'bg-blue-500',
  connected: 'bg-green-600',
  error: 'bg-red-500',
  stopping: 'bg-orange-500'
}

const STATUS_LABELS = {
  free: 'Livre',
  available: 'Livre',
  starting: 'Iniciando',
  qr_pending: 'Aguardando QR',
  connected: 'Conectado',
  error: 'Erro',
  stopping: 'Parando'
}

const STATUS_ICONS = {
  free: CheckCircle,
  starting: Spinner,
  qr_pending: QrCode,
  connected: CheckCircle,
  error: XCircle,
  stopping: Clock
}

export function WhatsAppUnifiedHub() {
  // Main state
  const [activeTab, setActiveTab] = useState("channels")
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null)
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [proxyStatus, setProxyStatus] = useState<{ target?: string; requestOrigin?: string; isProductionTarget?: boolean } | null>(null)
  const [loadingProxyStatus, setLoadingProxyStatus] = useState(false)
  const [pollPausedUntil, setPollPausedUntil] = useState<number | null>(null)
  const [eventStreamError, setEventStreamError] = useState<string | null>(null)
  const [evolutionPausedUntil, setEvolutionPausedUntil] = useState<number | null>(null)
  
  // Channel operations state
  const [startingChannels, setStartingChannels] = useState<Set<number>>(new Set())
  const [stoppingChannels, setStoppingChannels] = useState<Set<number>>(new Set())
  const [channelErrors, setChannelErrors] = useState<Map<number, string>>(new Map())
  const [channelQR, setChannelQR] = useState<Map<number, QRData>>(new Map())
  const [qrDialogChannel, setQrDialogChannel] = useState<number | null>(null)
  
  // Chat functionality state
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [messageInput, setMessageInput] = useState("")
  const [sendingMessage, setSendingMessage] = useState(false)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [hasMoreConversations, setHasMoreConversations] = useState(true)
  const [messagesPage, setMessagesPage] = useState(1)
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  
  // Polling and real-time updates
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const pollGuardRef = useRef<{ failCount: number; windowStart: number; pausedUntil: number }>({
    failCount: 0,
    windowStart: 0,
    pausedUntil: 0
  })
  const evolutionPollGuardRef = useRef<{ failCount: number; windowStart: number; pausedUntil: number }>({
    failCount: 0,
    windowStart: 0,
    pausedUntil: 0
  })
  const evolutionRefreshRef = useRef<{ last: number }>({ last: 0 })
  const conversationOffsetRef = useRef(0)

  const CONVERSATION_PAGE_SIZE = 50
  const MESSAGE_PAGE_SIZE = 50

  const isEvolution = orchestratorStatus?.provider === 'evolution'
  const hasPollingPause = !!(pollPausedUntil || evolutionPausedUntil)

  useEffect(() => {
    setEventStreamError(null)
  }, [isEvolution])

  const buildEventSourceUrl = useCallback((path: string) => {
    const url = new URL(path, window.location.origin)
    try {
      const auth = window.localStorage.getItem('crm.basicAuth')
      if (auth) {
        url.searchParams.set('auth', auth)
      }
    } catch {
      // ignore localStorage access errors
    }
    return url.toString()
  }, [])

  const getEventStreamErrorMessage = useCallback(() => {
    try {
      const auth = window.localStorage.getItem('crm.basicAuth')
      if (!auth) {
        return 'Realtime indisponível. Se CRM_BASIC_AUTH estiver ativo, defina localStorage crm.basicAuth. Verifique /api/wa-orchestrator/_proxy-status.'
      }
    } catch {
      // ignore
    }
    return 'Realtime indisponível. Verifique /api/wa-orchestrator/_proxy-status.'
  }, [])

  const loadProxyStatus = useCallback(async () => {
    setLoadingProxyStatus(true)
    try {
      const res = await fetch('/api/wa-orchestrator/_proxy-status')
      const data = await res.json()
      if (res.ok && data?.ok) setProxyStatus(data)
    } catch {
      // ignore
    } finally {
      setLoadingProxyStatus(false)
    }
  }, [])

  // Fetch orchestrator status
  const fetchOrchestratorStatus = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    const now = Date.now()
    const guard = pollGuardRef.current
    if (!force && guard.pausedUntil && now < guard.pausedUntil) {
      return
    }
    if (guard.pausedUntil && now >= guard.pausedUntil) {
      guard.pausedUntil = 0
      setPollPausedUntil(null)
    }
    try {
      const response = await fetch('/api/wa-orchestrator/status')
      const contentType = response.headers.get('content-type') || ''
      const isJson = contentType.includes('application/json')
      const payload = isJson ? await response.json() : null

      if (!response.ok) {
        const statusMessage =
          payload?.error ||
          (response.status === 401 || response.status === 403
            ? 'Não autenticado para acessar o orquestrador.'
            : `Falha ao consultar orquestrador (HTTP ${response.status}).`)
        throw new Error(statusMessage)
      }

      if (!isJson) {
        const text = await response.text().catch(() => '')
        throw new Error(`Resposta inválida do orquestrador${text ? `: ${text.slice(0, 120)}` : ''}`)
      }

      if (payload && payload.success === false) {
        throw new Error(payload.error || 'Falha ao carregar status do orquestrador.')
      }

      const rawInstances = Array.isArray(payload?.channels)
        ? payload.channels
        : Array.isArray(payload?.instances)
          ? payload.instances
          : Array.isArray(payload?.data)
            ? payload.data
            : []

      const normalizedInstances: ChannelInstance[] = rawInstances.map((ch: any, index: number) => {
        const resolvedChannel = Number.isFinite(ch?.channel)
          ? Number(ch.channel)
          : Number.isFinite(ch?.port)
            ? portToChannel(Number(ch.port))
            : index + 1
        const status = (ch?.status === 'available' ? 'free' : ch?.status) || 'free'
        return {
          id: ch?.id || `channel-${resolvedChannel}`,
          port: ch?.port ?? channelToPort(resolvedChannel),
          channel: resolvedChannel,
          status,
          name: ch?.name,
          createdAt: ch?.createdAt || new Date().toISOString(),
          updatedAt: ch?.updatedAt || new Date().toISOString(),
          metadata: ch?.metadata || {}
        }
      })

      const transformedData: OrchestratorStatus = {
        provider: payload?.provider,
        totalChannels: payload?.totalChannels ?? normalizedInstances.length,
        availableChannels: payload?.availableChannels,
        totalInstances: payload?.totalChannels ?? normalizedInstances.length,
        freeInstances:
          payload?.freeInstances ?? normalizedInstances.filter((ch) => ch.status === 'free').length,
        connectedInstances:
          payload?.connectedInstances ?? normalizedInstances.filter((ch) => ch.status === 'connected').length,
        errorInstances:
          payload?.errorInstances ?? normalizedInstances.filter((ch) => ch.status === 'error').length,
        startingInstances:
          payload?.startingInstances ?? normalizedInstances.filter((ch) => ch.status === 'starting' || ch.status === 'qr_pending').length,
        instances: normalizedInstances,
        availableChannelsList:
          payload?.availableChannelsList ?? normalizedInstances.map((ch) => ch.channel),
        freeChannelsList:
          payload?.freeChannelsList ?? normalizedInstances.filter((ch) => ch.status === 'free').map((ch) => ch.channel)
      }

      setOrchestratorStatus(transformedData)
      setError(null)
      guard.failCount = 0
      guard.windowStart = 0
      guard.pausedUntil = 0
      setPollPausedUntil(null)
    } catch (err: any) {
      const now = Date.now()
      const windowStart = guard.windowStart || now
      if (now - windowStart > 30000) {
        guard.windowStart = now
        guard.failCount = 1
      } else {
        guard.failCount += 1
      }
      if (guard.failCount >= 5 && !guard.pausedUntil) {
        guard.pausedUntil = now + 60000
        setPollPausedUntil(guard.pausedUntil)
      }
      const suffix = guard.pausedUntil ? ' • pausa de 60s' : ''
      setError(`${err.message}${suffix}`)
      console.error('Channels status error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchEvolutionConversations = useCallback(async ({ reset = false, force = false } = {}) => {
    if (!selectedChannel) return
    const guard = evolutionPollGuardRef.current
    const now = Date.now()
    if (!force && guard.pausedUntil && now < guard.pausedUntil) {
      return
    }
    if (guard.pausedUntil && now >= guard.pausedUntil) {
      guard.pausedUntil = 0
      setEvolutionPausedUntil(null)
    }
    setLoadingConversations(true)
    try {
      const offset = reset ? 0 : conversationOffsetRef.current
      const response = await fetch(`/api/wa-orchestrator/channels/${selectedChannel}/conversations?limit=${CONVERSATION_PAGE_SIZE}&offset=${offset}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || `Falha ao carregar conversas (HTTP ${response.status})`)
      }
      const items = Array.isArray(payload?.items) ? payload.items : []
      setConversations(prev => {
        const base = reset ? [] : prev
        const merged = [...base, ...items]
        const byId = new Map<string, any>()
        merged.forEach((item) => {
          if (!item?.conversationId) return
          byId.set(item.conversationId, item)
        })
        return Array.from(byId.values()).sort((a, b) => {
          const aTime = new Date(a.updatedAt || 0).getTime()
          const bTime = new Date(b.updatedAt || 0).getTime()
          return bTime - aTime
        })
      })
      const nextOffset = offset + items.length
      conversationOffsetRef.current = nextOffset
      const hasMore = typeof payload?.meta?.hasMore === 'boolean'
        ? payload.meta.hasMore
        : items.length >= CONVERSATION_PAGE_SIZE
      setHasMoreConversations(hasMore)
      guard.failCount = 0
      guard.windowStart = 0
      guard.pausedUntil = 0
      setEvolutionPausedUntil(null)
    } catch (err: any) {
      console.error('Evolution conversations error:', err)
      if (force) {
        toast.error(err?.message || 'Falha ao carregar conversas')
      }
      const windowStart = guard.windowStart || now
      if (now - windowStart > 30000) {
        guard.windowStart = now
        guard.failCount = 1
      } else {
        guard.failCount += 1
      }
      if (guard.failCount >= 5) {
        guard.pausedUntil = now + 60000
        setEvolutionPausedUntil(guard.pausedUntil)
      }
    } finally {
      setLoadingConversations(false)
    }
  }, [CONVERSATION_PAGE_SIZE, selectedChannel])

  const fetchEvolutionMessages = useCallback(async (conversationId: string, { page = 1, append = false } = {}) => {
    if (!selectedChannel || !conversationId) return
    setLoadingMessages(true)
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${selectedChannel}/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MESSAGE_PAGE_SIZE}&page=${page}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || `Falha ao carregar mensagens (HTTP ${response.status})`)
      }
      const items = Array.isArray(payload?.items) ? payload.items : []
      if (append) {
        setMessages(prev => [...items, ...prev])
      } else {
        setMessages(items)
      }
      const total = payload?.meta?.total
      const pages = payload?.meta?.pages
      if (typeof total === 'number' && typeof pages === 'number') {
        setHasMoreMessages(page < pages)
      } else {
        setHasMoreMessages(items.length >= MESSAGE_PAGE_SIZE)
      }
      setMessagesPage(page)
    } catch (err: any) {
      console.error('Evolution messages error:', err)
      toast.error(err?.message || 'Falha ao carregar mensagens')
    } finally {
      setLoadingMessages(false)
    }
  }, [MESSAGE_PAGE_SIZE, selectedChannel])

  useEffect(() => {
    setSelectedConversation(null)
    setMessages([])
    setMessagesPage(1)
    setHasMoreMessages(true)
    conversationOffsetRef.current = 0
    setHasMoreConversations(true)
    if (isEvolution && selectedChannel) {
      fetchEvolutionConversations({ reset: true, force: true })
    }
  }, [fetchEvolutionConversations, isEvolution, selectedChannel])

  useEffect(() => {
    if (selectedChannel || !orchestratorStatus) return
    const preferred = orchestratorStatus.instances.find((inst) => inst.status === 'connected')
    const fallback = orchestratorStatus.instances[0]
    const next = preferred?.channel || fallback?.channel
    if (next) setSelectedChannel(next)
  }, [orchestratorStatus, selectedChannel])

  const extractEvolutionRemoteJid = useCallback((payload: any) => {
    const data = payload?.data || payload
    return data?.remoteJid || data?.key?.remoteJid || data?.message?.key?.remoteJid || data?.messages?.[0]?.key?.remoteJid || null
  }, [])

  const scheduleEvolutionRefresh = useCallback(() => {
    const now = Date.now()
    if (now - evolutionRefreshRef.current.last < 1500) return
    evolutionRefreshRef.current.last = now
    fetchEvolutionConversations({ reset: true })
  }, [fetchEvolutionConversations])

  // Start a specific channel
  const startChannel = useCallback(async (channel: number, instanceName?: string) => {
    setStartingChannels(prev => new Set(prev.add(channel)))
    setChannelErrors(prev => {
      const newMap = new Map(prev)
      newMap.delete(channel)
      return newMap
    })
    
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: instanceName })
      })
      
      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to start channel')
      }
      
      toast.success(`Canal ${channel} iniciado com sucesso`)
      
      // Poll for QR code if needed
      setTimeout(() => pollChannelQR(channel), 1000)
      
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      setChannelErrors(prev => new Map(prev.set(channel, errorMsg)))
      toast.error(`Erro ao iniciar Canal ${channel}: ${errorMsg}`)
    } finally {
      setStartingChannels(prev => {
        const newSet = new Set(prev)
        newSet.delete(channel)
        return newSet
      })
    }
  }, [])

  // Stop a specific channel
  const stopChannel = useCallback(async (channel: number) => {
    setStoppingChannels(prev => new Set(prev.add(channel)))
    
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/stop`, {
        method: 'POST'
      })
      
      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to stop channel')
      }
      
      toast.success(`Canal ${channel} parado com sucesso`)
      
      // Clear QR code for this channel
      setChannelQR(prev => {
        const newMap = new Map(prev)
        newMap.delete(channel)
        return newMap
      })
      
    } catch (err: any) {
      toast.error(`Erro ao parar Canal ${channel}: ${err.message}`)
    } finally {
      setStoppingChannels(prev => {
        const newSet = new Set(prev)
        newSet.delete(channel)
        return newSet
      })
    }
  }, [])

  // Restart a specific channel
  const restartChannel = useCallback(async (channel: number) => {
    await stopChannel(channel)
    setTimeout(() => startChannel(channel), 2000)
  }, [startChannel, stopChannel])

  // Get channel instance by channel number
  const getChannelInstance = useCallback((channel: number): ChannelInstance | null => {
    if (!orchestratorStatus) return null
    return orchestratorStatus.instances.find(inst => inst.channel === channel) || null
  }, [orchestratorStatus])

  const resolveChannelPort = useCallback(
    (channel: number, instance?: ChannelInstance | null) => {
      const entry = instance ?? getChannelInstance(channel)
      if (entry?.port) return entry.port
      if (orchestratorStatus?.provider === 'evolution') return 3001
      return channelToPort(channel)
    },
    [getChannelInstance, orchestratorStatus?.provider]
  )

  // QR polling state and refs for abort control
  const qrPollingRefs = useRef<Map<number, { controller: AbortController; timeout: NodeJS.Timeout }>>(new Map())
  const qrRetryCount = useRef<Map<number, number>>(new Map())

  // Poll for QR code on a specific channel with proper error handling and abort control
  const pollChannelQR = useCallback(async (channel: number, retryCount = 0) => {
    // Stop any existing polling for this channel
    const existing = qrPollingRefs.current.get(channel)
    if (existing) {
      existing.controller.abort()
      clearTimeout(existing.timeout)
      qrPollingRefs.current.delete(channel)
    }

    const controller = new AbortController()
    
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/qr`, {
        signal: controller.signal
      })
      
      if (!response.ok) {
        if (response.status === 404) {
          // QR not ready yet, retry with backoff
          const backoffDelay = Math.min(1000 * Math.pow(1.5, retryCount), 5000)
          const timeout = setTimeout(() => pollChannelQR(channel, retryCount + 1), backoffDelay)
          qrPollingRefs.current.set(channel, { controller, timeout })
          return
        }
        throw new Error(`HTTP ${response.status}`)
      }
      
      const result = await response.json()
      if (result.success && (result.qr || result.dataUrl)) {
        let qrDataUrl: string
        
        if (result.dataUrl) {
          // Use provided data URL directly
          qrDataUrl = result.dataUrl
        } else if (result.qr) {
          // Check if it's already a data URL
          if (result.qr.startsWith('data:')) {
            qrDataUrl = result.qr
          } else {
            // Convert QR string to visual QR code image using qrcode library
            try {
              qrDataUrl = await QRCode.toDataURL(result.qr, {
                width: 300,
                margin: 2,
                color: {
                  dark: '#000000',
                  light: '#FFFFFF'
                }
              })
            } catch (qrError) {
              console.error('Failed to generate QR code image:', qrError)
              return
            }
          }
        } else {
          return
        }
        
        setChannelQR(prev => new Map(prev.set(channel, { 
          qr: result.qr || qrDataUrl, 
          dataUrl: qrDataUrl 
        })))
        
        // Reset retry count on success
        qrRetryCount.current.delete(channel)
        
        // Auto-show QR dialog if not already open
        if (!qrDialogChannel) {
          setQrDialogChannel(channel)
        }
        
        // Continue polling until connected (QR may refresh)
        const instance = getChannelInstance(channel)
        if (instance?.status === 'qr_pending') {
          const timeout = setTimeout(() => pollChannelQR(channel, 0), 3000)
          qrPollingRefs.current.set(channel, { controller, timeout })
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return // Expected when aborting
      
      console.warn(`Failed to fetch QR for channel ${channel} (attempt ${retryCount + 1}):`, err)
      
      // Implement exponential backoff for retries
      if (retryCount < 5) {
        const backoffDelay = Math.min(2000 * Math.pow(1.5, retryCount), 10000)
        const timeout = setTimeout(() => pollChannelQR(channel, retryCount + 1), backoffDelay)
        qrPollingRefs.current.set(channel, { controller, timeout })
      } else {
        setChannelErrors(prev => new Map(prev.set(channel, `QR fetch failed after ${retryCount + 1} attempts`)))
      }
    }
  }, [getChannelInstance, qrDialogChannel])

  // Send message to selected conversation
  const sendMessage = useCallback(async () => {
    if (!messageInput.trim() || !selectedConversation || !selectedChannel) return
    
    setSendingMessage(true)
    try {
      if (isEvolution) {
        const response = await fetch(`/api/wa-orchestrator/channels/${selectedChannel}/conversations/${encodeURIComponent(selectedConversation)}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: messageInput })
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload?.success === false) {
          throw new Error(payload?.error || 'Falha ao enviar mensagem')
        }
        setMessageInput("")
        toast.success("Mensagem enviada")
        fetchEvolutionMessages(selectedConversation, { page: 1, append: false })
        fetchEvolutionConversations({ reset: true, force: true })
      } else {
        const port = resolveChannelPort(selectedChannel)
        const response = await fetch(`/api/conversations/${selectedConversation}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            direction: 'outbound',
            type: 'text',
            text: messageInput,
            meta: { port }
          })
        })
        if (!response.ok) throw new Error('Falha ao enviar mensagem')
        setMessageInput("")
        toast.success("Mensagem enviada")
      }
      
    } catch (err: any) {
      toast.error(`Erro ao enviar mensagem: ${err.message}`)
    } finally {
      setSendingMessage(false)
    }
  }, [fetchEvolutionConversations, fetchEvolutionMessages, isEvolution, messageInput, resolveChannelPort, selectedConversation, selectedChannel])

  const syncEvolutionWebhook = useCallback(async (channel: number) => {
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/webhook`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Falha ao sincronizar webhook')
      }
      toast.success('Webhook sincronizado')
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao sincronizar webhook')
    }
  }, [])

  // Cleanup QR polling on unmount
  useEffect(() => {
    return () => {
      // Clean up all QR polling on unmount
      qrPollingRefs.current.forEach(({ controller, timeout }) => {
        controller.abort()
        clearTimeout(timeout)
      })
      qrPollingRefs.current.clear()
    }
  }, [])

  // Monitor status changes and automatically start QR polling for qr_pending channels
  useEffect(() => {
    if (!orchestratorStatus) return
    
    orchestratorStatus.instances.forEach(instance => {
      if (instance.status === 'qr_pending' && !qrPollingRefs.current.has(instance.channel)) {
        // Auto-start QR polling for channels waiting for QR
        setTimeout(() => pollChannelQR(instance.channel), 500)
      } else if (instance.status !== 'qr_pending' && qrPollingRefs.current.has(instance.channel)) {
        // Stop QR polling for channels that are no longer waiting for QR
        const existing = qrPollingRefs.current.get(instance.channel)
        if (existing) {
          existing.controller.abort()
          clearTimeout(existing.timeout)
          qrPollingRefs.current.delete(instance.channel)
        }
      }
    })
  }, [orchestratorStatus, pollChannelQR])

  // Setup polling for status updates
  useEffect(() => {
    fetchOrchestratorStatus()
    
    pollIntervalRef.current = setInterval(fetchOrchestratorStatus, 5000)
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [fetchOrchestratorStatus])

  // Setup real-time conversation updates (legacy provider)
  useEffect(() => {
    if (isEvolution) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      return
    }
    eventSourceRef.current = new EventSource(buildEventSourceUrl('/api/conversations/events'))
    eventSourceRef.current.onopen = () => setEventStreamError(null)
    eventSourceRef.current.onerror = () => {
      try {
        console.warn('SSE unavailable, closing connection.')
        setEventStreamError(getEventStreamErrorMessage())
        eventSourceRef.current?.close()
      } catch {
        // ignore
      }
    }

    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        switch (data.type) {
          case 'snapshot':
            setConversations(data.conversations || [])
            break

          case 'conversation-update':
          case 'conversation-updated':
            setConversations(prev => {
              const idx = prev.findIndex(c => c.conversationId === data.conversation.conversationId)
              if (idx === -1) return [...prev, data.conversation]
              const next = [...prev]
              next[idx] = data.conversation
              return next
            })
            break

          case 'message':
          case 'new-message':
            {
              const message = data.message
              if (message.conversationId === selectedConversation) {
                setMessages(prev => [...prev, message])
              }
            }
            break
        }
      } catch (err) {
        console.warn('Failed to parse SSE event:', err)
      }
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [buildEventSourceUrl, getEventStreamErrorMessage, isEvolution, selectedConversation])

  // Evolution webhook SSE updates
  useEffect(() => {
    if (!isEvolution) return
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    eventSourceRef.current = new EventSource(buildEventSourceUrl('/api/wa-orchestrator/events'))
    eventSourceRef.current.onopen = () => setEventStreamError(null)
    eventSourceRef.current.onerror = () => {
      try {
        setEventStreamError(getEventStreamErrorMessage())
        eventSourceRef.current?.close()
      } catch {
        // ignore
      }
    }
    eventSourceRef.current.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (!payload?.event) return
        if (payload.event?.startsWith('messages') || payload.event?.startsWith('chats')) {
          scheduleEvolutionRefresh()
          const remoteJid = extractEvolutionRemoteJid(payload)
          if (remoteJid && remoteJid === selectedConversation) {
            fetchEvolutionMessages(remoteJid)
          }
        }
      } catch (err) {
        console.warn('Failed to parse evolution event:', err)
      }
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [buildEventSourceUrl, extractEvolutionRemoteJid, fetchEvolutionMessages, getEventStreamErrorMessage, isEvolution, scheduleEvolutionRefresh, selectedConversation])

  // Poll conversations for evolution provider
  useEffect(() => {
    if (!isEvolution) return
    if (!selectedChannel) {
      setConversations([])
      return
    }
    fetchEvolutionConversations({ reset: true })
    const interval = setInterval(() => fetchEvolutionConversations({ reset: true }), 10000)
    return () => clearInterval(interval)
  }, [fetchEvolutionConversations, isEvolution, selectedChannel])

  // Load messages for selected conversation
  useEffect(() => {
    if (!selectedConversation) {
      setMessages([])
      return
    }

    if (isEvolution) {
      setMessagesPage(1)
      setHasMoreMessages(true)
      fetchEvolutionMessages(selectedConversation, { page: 1, append: false })
      return
    }

    const loadMessages = async () => {
      try {
        const response = await fetch(`/api/conversations/${selectedConversation}/messages?limit=50`)
        if (response.ok) {
          const data = await response.json()
          setMessages(data.items || [])
        }
      } catch (err) {
        console.warn('Failed to load messages:', err)
      }
    }

    loadMessages()
  }, [fetchEvolutionMessages, isEvolution, selectedConversation])

  // Render channel status indicator
  const renderChannelStatus = (channel: number) => {
    const instance = getChannelInstance(channel)
    const isStarting = startingChannels.has(channel)
    const isStopping = stoppingChannels.has(channel)
    const hasError = channelErrors.has(channel)
    const hasQR = channelQR.has(channel)
    
    let status = instance?.status || 'free'
    let label = STATUS_LABELS[status] || 'Desconhecido'
    let color = STATUS_COLORS[status] || 'bg-gray-500'
    let Icon = STATUS_ICONS[status] || CheckCircle
    
    if (isStarting) {
      status = 'starting'
      label = 'Iniciando...'
      color = 'bg-yellow-500'
      Icon = Spinner
    } else if (isStopping) {
      status = 'stopping'
      label = 'Parando...'
      color = 'bg-orange-500'
      Icon = Clock
    } else if (hasError) {
      status = 'error'
      label = 'Erro'
      color = 'bg-red-500'
      Icon = XCircle
    }
    
    return (
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${color}`} />
        <Icon className="w-4 h-4 text-blue-100/80" />
        <span className="text-sm font-medium text-blue-100/80">{label}</span>
        {hasQR && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setQrDialogChannel(channel)}
            className="animate-pulse border-blue-400/40 text-blue-100 hover:bg-blue-500/20"
          >
            <QrCode className="w-4 h-4 mr-1" />
            Ver QR
          </Button>
        )}
        {instance?.status === 'qr_pending' && !hasQR && (
          <div className="text-xs text-blue-100/70 flex items-center gap-1">
            <LoadingPercentText label="Carregando QR" className="text-blue-100/70" showPercent={false} />
          </div>
        )}
      </div>
    )
  }

  // Render channel controls
  const renderChannelControls = (channel: number) => {
    const instance = getChannelInstance(channel)
    const isStarting = startingChannels.has(channel)
    const isStopping = stoppingChannels.has(channel)
    const hasError = channelErrors.has(channel)
    const isConnected = instance?.status === 'connected'
    const isActive = instance?.status && !['free', 'available'].includes(instance.status)
    
    return (
      <div className="flex items-center gap-2">
        {!isActive && !isStarting && (
          <Button
            size="sm"
            onClick={() => startChannel(channel)}
            disabled={isStarting}
          >
            <Play className="w-4 h-4 mr-1" />
            Iniciar
          </Button>
        )}
        
        {isActive && !isStopping && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => stopChannel(channel)}
            disabled={isStopping}
          >
            <Stop className="w-4 h-4 mr-1" />
            Parar
          </Button>
        )}
        
        {(isActive || hasError) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => restartChannel(channel)}
            disabled={isStarting || isStopping}
          >
            <ArrowClockwise className="w-4 h-4 mr-1" />
            Reiniciar
          </Button>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingPercentText label="Carregando WhatsApp Hub" showPercent={false} className="text-blue-100/70" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert className="mx-4 border-red-500/40 bg-red-500/10 text-red-100">
          <Warning className="h-4 w-4 text-red-200" />
          <AlertDescription>
            Não foi possível conectar ao orquestrador do WhatsApp.
            <Button
              size="sm"
              variant="outline"
              className="ml-2 border-red-400/40 text-red-100 hover:bg-red-500/20"
              onClick={() => fetchOrchestratorStatus({ force: true })}
            >
              Tentar Novamente
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-2 text-blue-100/70 hover:text-white"
              onClick={loadProxyStatus}
              disabled={loadingProxyStatus}
            >
              {loadingProxyStatus ? 'Verificando...' : 'Diagnóstico'}
            </Button>
          </AlertDescription>
        </Alert>
        {proxyStatus && (
          <div className="mx-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-blue-100/70 space-y-1">
            <div>Target: {proxyStatus.target || '—'}</div>
            <div>Origem: {proxyStatus.requestOrigin || '—'}</div>
            <div>Produção: {proxyStatus.isProductionTarget ? 'sim' : 'não'}</div>
          </div>
        )}
        <div className="mx-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm text-white">Quando estiver conectado, esta área exibirá:</div>
          <ul className="mt-3 space-y-2 text-xs text-blue-100/70">
            <li>• Status dos canais, QR Code e telefone conectado.</li>
            <li>• Lista de conversas em tempo real e histórico.</li>
            <li>• Mensagens, mídia e métricas por canal.</li>
          </ul>
          <div className="mt-3 text-[11px] text-blue-100/50 break-words">
            Detalhes técnicos: {error}
          </div>
        </div>
      </div>
    )
  }

  // Get current selected channel instance
  const getCurrentChannelInstance = () => {
    return selectedChannel ? getChannelInstance(selectedChannel) : null
  }

  // Navigate to channel dashboard using proxy route
  const navigateToChannelDashboard = (channel: number) => {
    // Use proxy route with dashboard path
    const channelRoute = `/canal${channel}/dashboard`
    
    // Validate that channel is actually connected before redirecting
    const instance = getCurrentChannelInstance()
    if (!instance || instance.status !== 'connected') {
      toast.error(`Canal ${channel} não está conectado. Inicie o canal primeiro.`)
      return
    }
    
    // Open dashboard in new tab using the proxy route - this loads the full WhatsApp Business dashboard
    window.open(channelRoute, '_blank')
  }

  return (
    <div className="space-y-6">
      {/* Header with Channel Selection */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <WhatsappLogo className="w-8 h-8 text-emerald-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">WhatsApp Business Hub</h1>
            <p className="text-blue-100/70">Gestão unificada de canais WhatsApp</p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          {/* Channel Selector - Fixed at top */}
          <div className="flex items-center gap-2">
            <Label className="whitespace-nowrap text-blue-100/70">Canal ativo</Label>
            <Select value={selectedChannel?.toString() || ""} onValueChange={(value) => setSelectedChannel(parseInt(value))}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Selecione o canal">
                  {selectedChannel && (
                    <span>Canal {selectedChannel} • Porta {resolveChannelPort(selectedChannel)}</span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 9 }, (_, i) => i + 1).map(channel => {
                  const instance = getChannelInstance(channel)
                  const statusLabel = instance ? STATUS_LABELS[instance.status] : 'Livre'
                  const port = resolveChannelPort(channel, instance)
                  
                  return (
                    <SelectItem key={channel} value={channel.toString()}>
                      Canal {channel} • Porta {port} ({statusLabel})
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {orchestratorStatus && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {orchestratorStatus.provider && (
                <Badge variant="secondary" className="uppercase tracking-wide">
                  {orchestratorStatus.provider}
                </Badge>
              )}
              <Badge variant="outline">
                {orchestratorStatus.connectedInstances} conectados
              </Badge>
              <Badge variant="outline">
                {orchestratorStatus.freeInstances} livres
              </Badge>
              {orchestratorStatus.errorInstances > 0 && (
                <Badge variant="destructive">
                  {orchestratorStatus.errorInstances} com erro
                </Badge>
              )}
              {hasPollingPause && (
                <Badge variant="outline" className="border-yellow-400/40 text-yellow-200">
                  Atualização pausada
                </Badge>
              )}
              {eventStreamError && (
                <Badge variant="destructive">
                  Realtime indisponível
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="channels">Canais</TabsTrigger>
          <TabsTrigger value="conversations">Conversas</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Channels Tab - Contextual Panel */}
        <TabsContent value="channels" className="space-y-4">
          {!selectedChannel ? (
            <Card className="glass-card">
              <CardContent className="py-12">
                <div className="text-center space-y-4">
                  <WhatsappLogo className="w-16 h-16 text-emerald-400 mx-auto" />
                  <h3 className="text-lg font-semibold text-white">Selecione um Canal</h3>
                  <p className="text-blue-100/70 max-w-md mx-auto">
                    Escolha um canal no dropdown acima para ver suas informações e controles de gerenciamento.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Channel Info Panel */}
              <Card className="glass-card lg:col-span-2">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div className="flex items-center gap-3">
                      <WhatsappLogo className="w-8 h-8 text-emerald-400" />
                      <div>
                        <CardTitle className="text-xl text-white">Canal {selectedChannel}</CardTitle>
                        <CardDescription className="text-blue-100/70">Porta {resolveChannelPort(selectedChannel)}</CardDescription>
                      </div>
                    </div>
                    {renderChannelStatus(selectedChannel)}
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-6">
                  {/* Channel Error Display */}
                  {channelErrors.has(selectedChannel) && (
                    <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
                      <Warning className="h-4 w-4 text-red-200" />
                      <AlertDescription className="text-red-100/90">
                        {channelErrors.get(selectedChannel)}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Channel Metadata */}
                  {(() => {
                    const instance = getCurrentChannelInstance()
                    if (instance?.metadata) {
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 bg-white/5 rounded-lg border border-white/10">
                          {instance.metadata.phoneNumber && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-blue-100/70">Telefone</div>
                              <div className="text-sm text-white">{instance.metadata.phoneNumber}</div>
                            </div>
                          )}
                          {instance.metadata.errorCount !== undefined && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-blue-100/70">Erros</div>
                              <div className="text-sm text-white">{instance.metadata.errorCount}</div>
                            </div>
                          )}
                          {instance.metadata.restartCount !== undefined && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-blue-100/70">Reinicializações</div>
                              <div className="text-sm text-white">{instance.metadata.restartCount}</div>
                            </div>
                          )}
                          {instance.metadata.lastActivity && (
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-blue-100/70">Última Atividade</div>
                              <div className="text-sm text-white">
                                {new Date(instance.metadata.lastActivity).toLocaleString()}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    }
                    return null
                  })()}

                  {/* QR Code Preview */}
                  {channelQR.has(selectedChannel) && (
                    <div className="flex flex-col items-center space-y-4 p-6 bg-blue-500/10 rounded-lg border border-blue-500/30">
                      <div className="text-center space-y-2">
                        <QrCode className="w-8 h-8 text-blue-200 mx-auto" />
                        <h4 className="font-semibold text-blue-100">QR Code Disponível</h4>
                        <p className="text-sm text-blue-100/80">
                          QR code gerado e pronto para escaneamento
                        </p>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setQrDialogChannel(selectedChannel)}
                        className="border-blue-400/40 text-blue-100 hover:bg-blue-500/20"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Visualizar QR Code
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Control Panel */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg text-white">Controles</CardTitle>
                  <CardDescription className="text-blue-100/70">Ações do canal selecionado</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(() => {
                    const instance = getCurrentChannelInstance()
                    const isStarting = startingChannels.has(selectedChannel)
                    const isStopping = stoppingChannels.has(selectedChannel)
                    const hasError = channelErrors.has(selectedChannel)
                    const isConnected = instance?.status === 'connected'
                    const isActive = instance?.status && instance.status !== 'free'
                    const hasQR = channelQR.has(selectedChannel)

                    return (
                      <>
                        {/* Primary Action Button */}
                        {!isActive && !isStarting && (
                          <Button
                            className="w-full"
                            size="lg"
                            onClick={() => startChannel(selectedChannel)}
                            disabled={isStarting}
                          >
                            <Play className="w-5 h-5 mr-2" />
                            Iniciar Canal
                          </Button>
                        )}

                        {isStarting && (
                          <Button
                            className="w-full"
                            size="lg"
                            disabled
                          >
                            <Spinner className="w-5 h-5 mr-2 animate-spin" />
                            Iniciando...
                          </Button>
                        )}

                        {isConnected && (
                          <Button
                            className="w-full bg-green-600 hover:bg-green-700"
                            size="lg"
                            onClick={() => navigateToChannelDashboard(selectedChannel)}
                          >
                            <Eye className="w-5 h-5 mr-2" />
                            Acessar Canal
                          </Button>
                        )}

                        {/* Secondary Actions */}
                        {isActive && (
                          <div className="space-y-2">
                            {instance?.status === 'qr_pending' && hasQR && (
                              <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => setQrDialogChannel(selectedChannel)}
                              >
                                <QrCode className="w-4 h-4 mr-2" />
                                Ver QR Code
                              </Button>
                            )}

                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={() => restartChannel(selectedChannel)}
                              disabled={isStarting || isStopping}
                            >
                              <ArrowClockwise className="w-4 h-4 mr-2" />
                              Reiniciar
                            </Button>

                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={() => stopChannel(selectedChannel)}
                              disabled={isStopping}
                            >
                              {isStopping ? (
                                <Spinner className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Stop className="w-4 h-4 mr-2" />
                              )}
                              {isStopping ? 'Parando...' : 'Parar Canal'}
                            </Button>

                            {isEvolution && (
                              <Button
                                variant="outline"
                                className="w-full border-blue-400/40 text-blue-100 hover:bg-blue-500/20"
                                onClick={() => syncEvolutionWebhook(selectedChannel)}
                              >
                                <ArrowClockwise className="w-4 h-4 mr-2" />
                                Sincronizar Webhook
                              </Button>
                            )}
                          </div>
                        )}

                        {hasError && (
                          <Button
                            variant="outline"
                            className="w-full text-orange-200 border-orange-400/40 hover:bg-orange-500/20"
                            onClick={() => {
                              setChannelErrors(prev => {
                                const newMap = new Map(prev)
                                newMap.delete(selectedChannel)
                                return newMap
                              })
                              // Optionally restart the channel
                              restartChannel(selectedChannel)
                            }}
                          >
                            <ArrowClockwise className="w-4 h-4 mr-2" />
                            Resolver Erro
                          </Button>
                        )}
                      </>
                    )
                  })()}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Conversations Tab */}
        <TabsContent value="conversations" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[600px]">
            {/* Conversations List */}
            <Card className="glass-card lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-white">Conversas</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {loadingConversations && (
                      <div className="text-sm text-blue-100/60 py-4 text-center">
                        Carregando conversas...
                      </div>
                    )}
                    {!loadingConversations && conversations.length === 0 && (
                      <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-4 py-6 text-center">
                        <div className="text-sm text-blue-100/70">Nenhuma conversa ainda.</div>
                        <div className="text-xs text-blue-100/50 mt-2">
                          Conecte o WhatsApp e aguarde novas mensagens para aparecerem aqui.
                        </div>
                      </div>
                    )}
                    {conversations.map((conv) => (
                      <div
                        key={conv.conversationId}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-white/5 ${
                          selectedConversation === conv.conversationId ? 'border-blue-500/70 bg-blue-500/15' : 'border-white/10'
                        }`}
                        onClick={() => setSelectedConversation(conv.conversationId)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate text-white">
                              {conv.name || conv.conversationId}
                            </div>
                            <div className="text-xs text-blue-100/70 truncate mt-1">
                              {conv.lastMessage}
                            </div>
                          </div>
                          {conv.unreadCount && conv.unreadCount > 0 && (
                            <Badge className="text-xs">
                              {conv.unreadCount}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                    {isEvolution && hasMoreConversations && (
                      <div className="pt-2 flex justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchEvolutionConversations({ reset: false, force: true })}
                          disabled={loadingConversations}
                          className="border-blue-400/40 text-blue-100 hover:bg-blue-500/20"
                        >
                          {loadingConversations ? 'Carregando...' : 'Carregar mais'}
                        </Button>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Chat Area */}
            <Card className="glass-card lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-white">
                  {selectedConversation ? `Chat: ${selectedConversation}` : 'Selecione uma conversa'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedConversation ? (
                  <div className="space-y-4">
                    {/* Messages Area */}
                    <ScrollArea className="h-[400px] border border-white/10 rounded-lg p-4">
                      <div className="space-y-3">
                        {isEvolution && hasMoreMessages && (
                          <div className="flex justify-center pb-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => fetchEvolutionMessages(selectedConversation, { page: messagesPage + 1, append: true })}
                              disabled={loadingMessages}
                              className="border-blue-400/40 text-blue-100 hover:bg-blue-500/20"
                            >
                              {loadingMessages ? 'Carregando...' : 'Carregar mensagens anteriores'}
                            </Button>
                          </div>
                        )}
                        {loadingMessages && (
                          <div className="text-sm text-blue-100/60 text-center py-4">
                            Carregando mensagens...
                          </div>
                        )}
                        {messages.map((msg) => {
                          const isOutbound = msg.direction === 'outbound' || msg.direction === 'human'
                          const mediaLabelMap: Record<string, string> = {
                            image: 'Imagem',
                            video: 'Vídeo',
                            audio: 'Áudio',
                            document: 'Documento',
                            sticker: 'Sticker',
                            ptv: 'Vídeo curto'
                          }
                          const mediaLabel = msg.mediaType ? mediaLabelMap[msg.mediaType] : null
                          const bodyText = msg.text || msg.caption || (!mediaLabel ? `[${msg.type}]` : '')
                          return (
                            <div
                              key={msg.id}
                              className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[70%] p-3 rounded-lg ${
                                  isOutbound
                                    ? 'bg-blue-500/40 text-white'
                                    : 'bg-white/10 text-blue-100'
                                }`}
                              >
                                {mediaLabel && (
                                  <div className="text-[10px] uppercase tracking-wide text-blue-100/70 mb-1">
                                    {mediaLabel}
                                  </div>
                                )}
                                {bodyText && (
                                  <div className="text-sm">
                                    {bodyText}
                                  </div>
                                )}
                                <div className={`text-xs mt-1 ${
                                  isOutbound ? 'text-blue-100/80' : 'text-blue-100/60'
                                }`}>
                                  {new Date(msg.createdAt).toLocaleTimeString()}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </ScrollArea>

                    {/* Message Input */}
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Digite sua mensagem..."
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                        rows={2}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            sendMessage()
                          }
                        }}
                      />
                      <Button
                        onClick={sendMessage}
                        disabled={!messageInput.trim() || sendingMessage || !selectedChannel}
                      >
                        {sendingMessage ? <Spinner className="w-4 h-4" /> : 'Enviar'}
                      </Button>
                    </div>
                    
                    {!selectedChannel && (
                      <Alert className="border-yellow-500/40 bg-yellow-500/10 text-yellow-100">
                        <Warning className="h-4 w-4 text-yellow-200" />
                        <AlertDescription className="text-yellow-100/80">
                          Selecione um canal ativo para enviar mensagens.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[450px]">
                    <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-6 py-6 text-center max-w-sm">
                      <div className="text-sm text-blue-100/70">Nenhuma conversa selecionada</div>
                      <div className="text-xs text-blue-100/50 mt-2">
                        Assim que um contato enviar mensagem, ela aparecerá aqui.
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-white">Analytics e Métricas</CardTitle>
              <CardDescription className="text-blue-100/70">
                Visão geral do desempenho dos canais WhatsApp
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="glass-card">
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-emerald-300">
                      {orchestratorStatus?.connectedInstances || 0}
                    </div>
                    <div className="text-sm text-blue-100/70">Canais Conectados</div>
                  </CardContent>
                </Card>
                
                <Card className="glass-card">
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-blue-300">
                      {conversations.length}
                    </div>
                    <div className="text-sm text-blue-100/70">Conversas Ativas</div>
                  </CardContent>
                </Card>
                
                <Card className="glass-card">
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-purple-300">
                      {messages.length}
                    </div>
                    <div className="text-sm text-blue-100/70">
                      {isEvolution ? 'Mensagens carregadas' : 'Mensagens Hoje'}
                    </div>
                  </CardContent>
                </Card>
                
                <Card className="glass-card">
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-orange-300">
                      {orchestratorStatus?.errorInstances || 0}
                    </div>
                    <div className="text-sm text-blue-100/70">Canais com Erro</div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* QR Code Dialog */}
      <Dialog open={qrDialogChannel !== null} onOpenChange={() => setQrDialogChannel(null)}>
        <DialogContent className="glass-card border border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">QR Code - Canal {qrDialogChannel}</DialogTitle>
            <DialogDescription className="text-blue-100/70">
              Escaneie o QR code abaixo com seu WhatsApp para conectar o canal
            </DialogDescription>
          </DialogHeader>
          
          {qrDialogChannel && channelQR.has(qrDialogChannel) && (
            <div className="flex flex-col items-center space-y-4">
              <div className="p-4 bg-white rounded-lg border">
                <img 
                  src={channelQR.get(qrDialogChannel)?.dataUrl} 
                  alt="QR Code" 
                  className="w-64 h-64"
                />
              </div>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (qrDialogChannel) {
                      const qrText = channelQR.get(qrDialogChannel)?.qr
                      if (qrText) {
                        navigator.clipboard.writeText(qrText)
                        toast.success("QR code copiado para a área de transferência")
                      }
                    }
                  }}
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Copiar
                </Button>
                
                <Button
                  variant="outline"
                  onClick={() => qrDialogChannel && pollChannelQR(qrDialogChannel)}
                >
                  <ArrowClockwise className="w-4 h-4 mr-1" />
                  Atualizar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
