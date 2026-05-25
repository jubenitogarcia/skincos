import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import QRCode from 'qrcode'
import { useKV } from '@/spark-mock'
import { parseDate, toISODateString } from '@/date-utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Input } from "@/input"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Label } from "@/label"
import { Switch } from "@/switch"
import { ScrollArea } from "@/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/avatar"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { RadioGroup, RadioGroupItem } from "@/radio-group"
import { TooltipButton, TooltipLabel } from '@/tooltip'
import { toast } from 'sonner'
import { LoadingPercentText } from '@/LoadingPattern'
import {
  WhatsappLogo,
  Image as ImageIcon,
  Video,
  FileText,
  Microphone,
  MapPin,
  CalendarBlank,
  Clock,
  Users,
  TrendUp,
  Eye,
  CheckCircle,
  X,
  Plus,
  Robot,
  Lightning,
  Bell,
  Phone,
  Camera,
  List,
  Star,
  ThumbsUp,
  ChartLine,
  Download,
  ArrowRight,
  ArrowDown,
  WarningCircle,
  DotsThreeVertical,
  Pencil,
  Play,
  Stop,
  ArrowClockwise,
  Spinner,
  XCircle,
  Warning,
  QrCode,
  EyeSlash,
  Copy
} from "@phosphor-icons/react"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/dropdown-menu'
import { useIntegrations } from '@/contexts'
import { sendWhatsAppMessage, mapWhatsAppMessageToLead, sendWhatsAppAttachments, detectWhatsAppMediaType } from '@/whatsappIntegration'
import { analyzeSentiment } from '@/sentiment'
import { sendWhatsAppContact, sendWhatsAppPoll, forwardWhatsAppMessage, pinWhatsAppMessage, unpinWhatsAppMessage, deleteWhatsAppMessage, bulkForwardWhatsAppMessages, bulkDeleteWhatsAppMessages, archiveWhatsAppChat, unarchiveWhatsAppChat, muteWhatsAppChat, unmuteWhatsAppChat, pinWhatsAppChat, unpinWhatsAppChat, markChatSeen, searchWhatsAppMessages } from '@/whatsappIntegration'
// import { initiateLocalWhatsApp, getLocalWhatsAppStatus } from '@/whatsappLocalGateway'
import { startSessionAuto, getSessionAuto, detectEndpoints, fetchChatsAuto, fetchMessagesAuto, openEventsStreamAuto, fetchAvatarAuto, fetchRecentMediaAuto, fetchChatFlagsAuto, fetchUnreadCountsAuto, globalSearchAuto } from '@/whatsappGatewayAdapter'
import { fetchCommonGroups } from '@/whatsappIntegration'
import { Progress } from '@/progress'
import { Separator } from "@/separator"
import { buildCrmBasicAuthHeaders } from "@/waOrchestratorAuth"

interface WhatsAppContact {
  id: string
  name: string
  phone: string
  avatar?: string
  lastSeen: Date
  isOnline: boolean
  labels: string[]
  customFields: { [key: string]: any }
  totalMessages: number
  firstContactDate: Date
}

interface WhatsAppMessage {
  id: string
  conversationId: string
  type: 'text' | 'image' | 'video' | 'document' | 'audio' | 'location' | 'template' | 'poll' | 'contact'
  content: string
  mediaUrl?: string
  timestamp: Date
  status: 'sent' | 'delivered' | 'read' | 'failed'
  fromUser: boolean
  templateName?: string
  metadata?: any
}

interface WhatsAppTemplate {
  id: string
  name: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  language: string
  status: 'APPROVED' | 'PENDING' | 'REJECTED'
  components: Array<{
    type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
    text?: string
    format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
    buttons?: Array<{
      type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'
      text: string
      url?: string
      phone_number?: string
    }>
  }>
  usageCount: number
  createdAt: Date
}

interface WhatsAppBroadcast {
  id: string
  name: string
  templateId: string
  targetContacts: string[]
  scheduledTime?: Date
  sentTime?: Date
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed'
  results: {
    sent: number
    delivered: number
    read: number
    failed: number
  }
}

interface WhatsAppAnalytics {
  messagesReceived: number
  messagesSent: number
  uniqueContacts: number
  responseRate: number
  averageResponseTime: number
  conversionsFromWhatsApp: number
  messagesByHour: { [hour: string]: number }
  topLabels: { label: string, count: number }[]
}

// Multi-Channel Orchestrator Interfaces
interface WhatsAppInstance {
  id: string
  port: number
  status: 'free' | 'starting' | 'qr_pending' | 'connected' | 'error' | 'stopping'
  name?: string
  createdAt: string
  updatedAt: string
  metadata?: {
    phoneNumber?: string
    errorCount?: number
    restartCount?: number
    lastActivity?: string
  }
}

interface OrchestratorStatus {
  totalInstances: number
  freeInstances: number
  connectedInstances: number
  errorInstances: number
  instances: WhatsAppInstance[]
}

interface AlternativePortSuggestions {
  type: 'port_occupied' | 'startup_failed' | 'startup_error' | 'no_free_ports'
  message: string
  targetPort?: number
  currentStatus?: string
  nextFreePort?: number | null
  allFreePorts?: number[]
  recoverySuggestions?: {
    erroredInstances: {
      port: number
      status: string
      errorCount: number
      lastUpdated: string
    }[]
    staleInstances: {
      port: number
      status: string
      hoursSinceUpdate: number
      lastUpdated: string
    }[]
  } | null
}

interface EnhancedApiResponse {
  success: boolean
  error?: string
  suggestions?: AlternativePortSuggestions
  instance?: WhatsAppInstance
}

const STATUS_COLORS = {
  free: 'bg-green-500',
  starting: 'bg-yellow-500',
  qr_pending: 'bg-blue-500',
  connected: 'bg-green-600',
  error: 'bg-red-500',
  stopping: 'bg-orange-500'
}

const STATUS_LABELS = {
  free: 'Livre',
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

export function WhatsAppBusinessHub() {
  if (typeof window !== 'undefined' && !(window as any).__WA_HUB_MOUNTED__) {
    console.log('[WhatsAppBusinessHub] mounting component')
      ; (window as any).__WA_HUB_MOUNTED__ = true
  }
  const [activeTab, setActiveTab] = useState("conversations")
  const [isConnectionsOpen, setIsConnectionsOpen] = useState(false)
  const [contacts, setContacts] = useKV<WhatsAppContact[]>("whatsapp-contacts", [])
  const [messages, setMessages] = useKV<WhatsAppMessage[]>("whatsapp-messages", [])
  const [templates, setTemplates] = useKV<WhatsAppTemplate[]>("whatsapp-templates", [])
  const [broadcasts, setBroadcasts] = useKV<WhatsAppBroadcast[]>("whatsapp-broadcasts", [])
  const [selectedContact, setSelectedContact] = useState<string | null>(null)
  const [messageInput, setMessageInput] = useState("")
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false)
  const [isCreatingBroadcast, setIsCreatingBroadcast] = useState(false)
  const { whatsapp, connectWhatsApp, disconnectWhatsApp, syncWhatsApp } = useIntegrations()
  // Base URL agora é gerenciada automaticamente via backend (/api/wa/start)
  const [baseUrlInput, setBaseUrlInput] = useState<string | null>(() => {
    try {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('wa.baseUrl')
      if (!v) return null
      try {
        const u = new URL(v, window.location.origin)
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return v
      } catch { /* ignore */ }
      // purge deprecated remote base URLs
      localStorage.removeItem('wa.baseUrl')
      return null
    } catch { return null }
  })
  const [initializing, setInitializing] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [gatewayState, setGatewayState] = useState<'idle' | 'starting' | 'qr' | 'connected' | 'error'>('idle')
  const [gatewayMessage, setGatewayMessage] = useState<string | null>(null)
  const [lastGatewayStatus, setLastGatewayStatus] = useState<any | null>(null)
  const [desiredPort, setDesiredPort] = useState<number | 'auto'>('auto')
  const connectedToastRef = useRef(false)
  const [endpointMap, setEndpointMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('wa.endpointMap') || '{}') } catch { return {} }
  })
  // Orchestrator-managed gateway instances
  type WaInstance = { instance: number, port: number, pid: number | null, alive: boolean, ready?: boolean, status?: string, message?: string | null, name?: string | null, lastContactName?: string | null, lastContactPhone?: string | null, lastContactAt?: string | null }
  const [waInstances, setWaInstances] = useState<WaInstance[]>([])
  const [waInstancesLoading, setWaInstancesLoading] = useState(false)
  const currentInstanceRef = useRef<number | null>(null)
  const pollRef = useRef<number | null>(null)
  const [lastPoll, setLastPoll] = useState<string | null>(null)
  const lastPollRef = useRef<string | null>(null)
  const contactsRef = useRef<WhatsAppContact[]>([])
  useEffect(() => { contactsRef.current = contacts }, [contacts])
  useEffect(() => { lastPollRef.current = lastPoll }, [lastPoll])
  const POLL_INTERVAL = 10000
  const hydratedRef = useRef(false)
  const eventsRef = useRef<EventSource | null>(null)
  const suppressionEventsRef = useRef<EventSource | null>(null)
  // Polling coordination to avoid re-entrancy and timer piling (helps prevent UI flicker)
  const pollInFlightRef = useRef(false)
  const pollTimeoutRef = useRef<number | null>(null)
  const lastPollAtRef = useRef<number>(0)
  const sseDebounceTimerRef = useRef<number | null>(null)
  const [consecutiveErrors, setConsecutiveErrors] = useState(0)
  const ingestedIdsRef = useRef<Set<string>>(new Set())
  
  // Multi-Channel Orchestrator State
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus | null>(null)
  const [orchestratorLoading, setOrchestratorLoading] = useState(true)
  const [orchestratorError, setOrchestratorError] = useState<string | null>(null)
  const [selectedPort, setSelectedPort] = useState<number | 'auto'>('auto')
  const [instanceName, setInstanceName] = useState('')
  const [startingInstance, setStartingInstance] = useState<number | null>(null)
  const [channelQrDialogOpen, setChannelQrDialogOpen] = useState(false)
  const [currentChannelQr, setCurrentChannelQr] = useState<{ port: number, qr: string, dataUrl: string } | null>(null)
  const [operatingPort, setOperatingPort] = useState<number | null>(null)
  const [suggestionsDialogOpen, setSuggestionsDialogOpen] = useState(false)
  const [currentSuggestions, setCurrentSuggestions] = useState<AlternativePortSuggestions | null>(null)
  const [originalError, setOriginalError] = useState<string>('')
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)
  // Dynamic poll/debounce configuration (overridable via localStorage)
  const pollConfigRef = useRef<{ pollIntervalMs: number, sseMinGapMs: number, sseDebounceMs: number }>({ pollIntervalMs: 10000, sseMinGapMs: 1500, sseDebounceMs: 200 })
  useEffect(() => {
    const read = () => {
      try {
        const pi = Number(localStorage.getItem('wa.pollIntervalMs') || '')
        const mg = Number(localStorage.getItem('wa.sseMinGapMs') || '')
        const db = Number(localStorage.getItem('wa.sseDebounceMs') || '')
        pollConfigRef.current.pollIntervalMs = !isNaN(pi) && pi > 500 ? pi : 10000
        pollConfigRef.current.sseMinGapMs = !isNaN(mg) && mg >= 0 ? mg : 1500
        pollConfigRef.current.sseDebounceMs = !isNaN(db) && db >= 0 ? db : 200
      } catch { /* ignore */ }
    }
    read()
    const onStorage = (e: StorageEvent) => {
      if (!e || !e.key) return
      if (e.key.startsWith('wa.poll') || e.key.startsWith('wa.sse')) read()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Orchestrator API base helper (Express runs on :8099 - CRM Backend API)
  const apiBase = useMemo(() => {
    if (typeof window === 'undefined') return 'http://localhost:8099'
    return 'http://localhost:8099'
  }, [])
  
  // Multi-Channel Orchestrator API Functions
  const orchestratorApiCall = useCallback(async (endpoint: string, options?: RequestInit) => {
    try {
      const response = await fetch(`/api/wa-orchestrator${endpoint}`, {
        headers: buildCrmBasicAuthHeaders({
          'Content-Type': 'application/json',
          ...(options?.headers || {})
        }),
        ...options
      })
      
      if (!response.ok) {
        // Enhanced error handling with specific messages
        let errorMessage = `HTTP ${response.status}`
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorData.message || errorMessage
        } catch {
          // If we can't parse JSON, provide a meaningful error based on status
          if (response.status === 404) {
            errorMessage = 'Endpoint do WhatsApp Orchestrator não encontrado. Verifique se o backend CRM está rodando na porta 8099.'
          } else if (response.status === 500) {
            errorMessage = 'Erro interno do servidor. Verifique os logs do backend CRM.'
          } else if (response.status === 503) {
            errorMessage = 'Serviço WhatsApp Orchestrator indisponível. Tente novamente em alguns segundos.'
          }
        }
        throw new Error(errorMessage)
      }
      
      return await response.json()
    } catch (err) {
      // Handle network errors with specific messaging
      if (err instanceof TypeError && err.message.includes('fetch')) {
        throw new Error('Backend CRM não disponível na porta 8099. Verifique se o servidor está rodando.')
      }
      // Re-throw other errors as-is
      throw err
    }
  }, [])

  // Load orchestrator status
  const loadOrchestratorStatus = useCallback(async () => {
    try {
      const data = await orchestratorApiCall('/status')
      setOrchestratorStatus(data)
      setOrchestratorError(null)
      setConsecutiveErrors(0) // Reset error count on success
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Falha ao carregar status do WhatsApp Orchestrator'
      setOrchestratorError(errorMessage)
      setConsecutiveErrors(prev => prev + 1)
      
      // Log detailed error for debugging
      console.error('Failed to load orchestrator status:', {
        error: err,
        endpoint: '/api/wa-orchestrator/status',
        timestamp: new Date().toISOString(),
        consecutiveErrors: consecutiveErrors + 1
      })
      
      // Show toast only for first few errors to avoid spam
      if (consecutiveErrors < 3) {
        toast.error(`WhatsApp Orchestrator: ${errorMessage}`)
      }
    }
  }, [orchestratorApiCall, consecutiveErrors])

  // Check for QR code on channel
  const checkForChannelQR = useCallback(async (port: number) => {
    try {
      const result = await orchestratorApiCall(`/instances/${port}/qr`)
      
      if (result.qr) {
        // Generate QR code data URL
        const dataUrl = await QRCode.toDataURL(result.qr, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        })
        
        setCurrentChannelQr({ port, qr: result.qr, dataUrl })
        setChannelQrDialogOpen(true)
      }
    } catch (err) {
      console.error('Failed to get QR code:', err)
    }
  }, [orchestratorApiCall])

  // Orchestrator initialization and polling
  useEffect(() => {
    setOrchestratorLoading(true)
    loadOrchestratorStatus().finally(() => setOrchestratorLoading(false))
    
    // Setup refresh interval for orchestrator status
    refreshIntervalRef.current = setInterval(loadOrchestratorStatus, 5000)
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }
    }
  }, [loadOrchestratorStatus])

  // Auto-check for QR codes on orchestrator status changes
  useEffect(() => {
    if (!orchestratorStatus) return
    
    orchestratorStatus.instances.forEach(instance => {
      if (instance.status === 'qr_pending' && !currentChannelQr) {
        checkForChannelQR(instance.port)
      }
    })
  }, [orchestratorStatus, currentChannelQr, checkForChannelQR])

  // UI activity flags to pause polling briefly while user is typing or filtering
  const typingActivityRef = useRef(false)
  const filteringActivityRef = useRef(false)
  const typingIdleTimerRef = useRef<number | null>(null)
  const filterIdleTimerRef = useRef<number | null>(null)
  // Scroll preservation for chat viewport
  const chatViewportRef = useRef<HTMLDivElement | null>(null)
  const lastScrollTopRef = useRef<number>(0)
  const [isNearBottom, setIsNearBottom] = useState(true)
  // Keep last scroll when messages update
  useEffect(() => {
    // Only track when the current chat is visible
    const v = chatViewportRef.current
    if (!v) return
    const handler = () => {
      lastScrollTopRef.current = v.scrollTop
      // Determine if user is near bottom (within 48px)
      const threshold = 48
      const atBottom = (v.scrollHeight - (v.scrollTop + v.clientHeight)) <= threshold
      setIsNearBottom(atBottom)
    }
    v.addEventListener('scroll', handler, { passive: true } as any)
    return () => { v.removeEventListener('scroll', handler as any) }
  }, [])

  const scrollToBottom = useCallback(() => {
    const v = chatViewportRef.current
    if (!v) return
    try {
      v.scrollTo({ top: v.scrollHeight, behavior: 'smooth' })
      lastScrollTopRef.current = v.scrollHeight
      setIsNearBottom(true)
      // Clear unread divider for current chat when jumping to bottom
      if (selectedContact) setUnreadDividerByChat(prev => ({ ...prev, [selectedContact]: null }))
    } catch {
      v.scrollTop = v.scrollHeight
      lastScrollTopRef.current = v.scrollTop
      setIsNearBottom(true)
      if (selectedContact) setUnreadDividerByChat(prev => ({ ...prev, [selectedContact]: null }))
    }
  }, [])

  // When new messages arrive for the open chat and we're near the bottom, keep anchored to bottom
  useEffect(() => {
    if (!selectedContact) return
    const v = chatViewportRef.current
    if (!v) return
    const latest = messages.length ? messages[messages.length - 1] : null
    if (!latest || latest.conversationId !== selectedContact) return
    if (!isNearBottom) return
    requestAnimationFrame(() => {
      try {
        v.scrollTop = v.scrollHeight
        lastScrollTopRef.current = v.scrollTop
      } catch { /* ignore */ }
    })
  }, [messages, selectedContact, isNearBottom])
  // New conversation dialog state
  const [isNewConvOpen, setIsNewConvOpen] = useState(false)
  const [newConvName, setNewConvName] = useState('')
  const [newConvPhone, setNewConvPhone] = useState('')
  // Attachments refs
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const docInputRef = useRef<HTMLInputElement | null>(null)
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false)
  // Microphone recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingLevel, setRecordingLevel] = useState(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const recordTimerRef = useRef<number | null>(null)
  const levelRafRef = useRef<number | null>(null)
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isCallDialogOpen, setIsCallDialogOpen] = useState(false)
  // AI controls & suppression
  const [aiMode, setAiMode] = useState<'auto' | 'assist' | 'off'>(() => {
    try { return (localStorage.getItem('wa.aiMode') as any) || 'auto' } catch { return 'auto' }
  })
  const [aiSuppressed, setAiSuppressed] = useState(false)
  const [aiResumeAt, setAiResumeAt] = useState<string | null>(null)
  const [aiSuggestionsByChat, setAiSuggestionsByChat] = useState<Record<string, string[]>>({})
  // Chat header menus/dialogs state
  const [isNotesOpen, setIsNotesOpen] = useState(false)
  const [isTagsOpen, setIsTagsOpen] = useState(false)
  const [isMediaOpen, setIsMediaOpen] = useState(false)
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [isContactInfoOpen, setIsContactInfoOpen] = useState(false)
  const [isCommonGroupsOpen, setIsCommonGroupsOpen] = useState(false)
  const [commonGroups, setCommonGroups] = useState<{ id: string, name: string, participantCount?: number, unreadCount?: number }[] | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [newTag, setNewTag] = useState('')
  const [mutedChats, setMutedChats] = useState<Set<string>>(new Set())
  // Per-chat UX state
  const [muteUntilByChat, setMuteUntilByChat] = useState<Record<string, number | null>>({})
  const [pinnedChats, setPinnedChats] = useState<Set<string>>(new Set())
  const [archivedChats, setArchivedChats] = useState<Set<string>>(new Set())
  const [unreadChats, setUnreadChats] = useState<Set<string>>(new Set())
  const [notesByChat, setNotesByChat] = useState<Record<string, string[]>>({})
  const [aiModeByChat, setAiModeByChat] = useState<Record<string, 'auto' | 'assist' | 'off'>>(() => {
    try { const v = localStorage.getItem('wa.aiModeByChat'); return v ? JSON.parse(v) : {} } catch { return {} }
  })
  // Avatar cache to avoid redundant fetches per session
  const avatarCacheRef = useRef<Record<string, string>>({})
  // Per-conversation search term
  const [convSearch, setConvSearch] = useState('')
  // Share contact & poll
  const [isShareContactOpen, setIsShareContactOpen] = useState(false)
  const [shareSearch, setShareSearch] = useState('')
  const [isPollOpen, setIsPollOpen] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState<string>('Sim\nNão')
  // Message actions state
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())
  const [replyTo, setReplyTo] = useState<WhatsAppMessage | null>(null)
  // Forward dialog state
  const [isForwardOpen, setIsForwardOpen] = useState(false)
  const [forwardTarget, setForwardTarget] = useState<string>('')
  const [forwardMessageIds, setForwardMessageIds] = useState<string[]>([])
  // Debug logs dialog
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsText, setLogsText] = useState<string>('')
  // Sync and search state
  const [isSyncing, setIsSyncing] = useState(false)
  const [contactsSearch, setContactsSearch] = useState('')
  // Unread counters per chat and global badge
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const globalUnreadCount = useMemo(() => Object.values(unreadCounts).reduce((acc, n) => acc + (Number(n) || 0), 0), [unreadCounts])
  const messagesByChat = useMemo(() => {
    const map: Record<string, WhatsAppMessage[]> = {}
    for (const m of messages) {
      if (!map[m.conversationId]) map[m.conversationId] = []
      map[m.conversationId].push(m)
    }
    return map
  }, [messages])
  // Unread divider: first new message when scrolled up
  const [unreadDividerByChat, setUnreadDividerByChat] = useState<Record<string, string | null>>({})
  const lastSeenMessageIdByChatRef = useRef<Record<string, string | null>>({})

  // When switching chats, consider everything read and clear divider
  useEffect(() => {
    if (!selectedContact) return
    const list = messagesByChat[selectedContact] || []
    const lastId = list.length ? list[list.length - 1].id : null
    lastSeenMessageIdByChatRef.current[selectedContact] = lastId
    setUnreadDividerByChat(prev => ({ ...prev, [selectedContact]: null }))
  }, [selectedContact])

  // Track new messages per open chat: if scrolled up, place divider at first new; if at bottom, advance last seen and clear divider
  useEffect(() => {
    if (!selectedContact) return
    const list = messagesByChat[selectedContact] || []
    if (!list.length) return
    const lastSeenId = lastSeenMessageIdByChatRef.current[selectedContact]
    // Initialize if unseen
    if (lastSeenId == null) {
      lastSeenMessageIdByChatRef.current[selectedContact] = list[list.length - 1]?.id || null
      return
    }
    const lastSeenIdx = list.findIndex(m => m.id === lastSeenId)
    const hasNew = (list.length - 1) > lastSeenIdx
    if (!hasNew) return
    if (isNearBottom) {
      // User is at bottom: consume new messages
      lastSeenMessageIdByChatRef.current[selectedContact] = list[list.length - 1].id
      setUnreadDividerByChat(prev => (prev[selectedContact] ? { ...prev, [selectedContact]: null } : prev))
    } else {
      // User is scrolled up: set divider at first new if not already set
      const firstNew = list[lastSeenIdx + 1]
      setUnreadDividerByChat(prev => (prev[selectedContact] ? prev : { ...prev, [selectedContact]: firstNew.id }))
    }
  }, [messagesByChat, selectedContact, isNearBottom])

  // When user reaches the bottom (via natural scroll), clear divider and advance last seen
  useEffect(() => {
    if (!selectedContact) return
    if (!isNearBottom) return
    const list = messagesByChat[selectedContact] || []
    if (!list.length) return
    lastSeenMessageIdByChatRef.current[selectedContact] = list[list.length - 1].id
    setUnreadDividerByChat(prev => (prev[selectedContact] ? { ...prev, [selectedContact]: null } : prev))
  }, [isNearBottom, selectedContact, messagesByChat])

  // Start an orchestrator instance
  const startOrchestratorInstance = useCallback(async (port?: number) => {
    try {
      setStartingInstance(port || 0)
      setOperatingPort(port || 0)
      
      const endpoint = port ? `/instances/${port}/start` : '/instances/start'
      const body = instanceName.trim() ? { name: instanceName.trim() } : {}
      
      const result: EnhancedApiResponse = await orchestratorApiCall(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      })
      
      if (result.success) {
        toast.success(`Instância iniciada na porta ${result.instance?.port || port}`)
        setInstanceName('')
        await loadOrchestratorStatus()
        
        // Check for QR code immediately
        const actualPort = result.instance?.port || port
        if (actualPort) {
          setTimeout(() => checkForChannelQR(actualPort), 2000)
        }
      } else {
        // Enhanced error handling with intelligent suggestions
        if (result.suggestions) {
          setOriginalError(result.error || 'Unknown error')
          setCurrentSuggestions(result.suggestions)
          setSuggestionsDialogOpen(true)
        } else {
          toast.error(result.error || 'Failed to start instance')
          setOrchestratorError(result.error || 'Failed to start instance')
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start instance'
      toast.error(message)
      setOrchestratorError(message)
    } finally {
      setStartingInstance(null)
      setOperatingPort(null)
    }
  }, [orchestratorApiCall, instanceName, loadOrchestratorStatus])

  // Stop an orchestrator instance
  const stopOrchestratorInstance = useCallback(async (port: number) => {
    try {
      setOperatingPort(port)
      
      const result = await orchestratorApiCall(`/instances/${port}/stop`, {
        method: 'POST'
      })
      
      if (result.success) {
        toast.success(`Instância na porta ${port} foi parada`)
        await loadOrchestratorStatus()
      } else {
        throw new Error(result.error || 'Failed to stop instance')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop instance'
      toast.error(message)
    } finally {
      setOperatingPort(null)
    }
  }, [orchestratorApiCall, loadOrchestratorStatus])

  // Restart an orchestrator instance
  const restartOrchestratorInstance = useCallback(async (port: number) => {
    try {
      setOperatingPort(port)
      
      const result = await orchestratorApiCall(`/instances/${port}/restart`, {
        method: 'POST'
      })
      
      if (result.success) {
        toast.success(`Instância na porta ${port} foi reiniciada`)
        await loadOrchestratorStatus()
        
        // Check for QR code after restart
        setTimeout(() => checkForChannelQR(port), 3000)
      } else {
        throw new Error(result.error || 'Failed to restart instance')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart instance'
      toast.error(message)
    } finally {
      setOperatingPort(null)
    }
  }, [orchestratorApiCall, loadOrchestratorStatus])

  // Clean up errored instances
  const cleanupErroredInstances = useCallback(async () => {
    if (!orchestratorStatus) return
    
    const erroredInstances = orchestratorStatus.instances.filter(inst => inst.status === 'error')
    if (erroredInstances.length === 0) {
      toast.info('Nenhuma instância com erro encontrada')
      return
    }
    
    let cleaned = 0
    for (const instance of erroredInstances) {
      try {
        const result = await orchestratorApiCall(`/instances/${instance.port}/restart`, {
          method: 'POST'
        })
        if (result.success) cleaned++
      } catch (err) {
        console.warn(`Failed to restart errored instance ${instance.port}:`, err)
      }
    }
    
    if (cleaned > 0) {
      toast.success(`${cleaned} instâncias com erro foram reiniciadas`)
      await loadOrchestratorStatus()
    } else {
      toast.error('Falha ao reiniciar instâncias com erro')
    }
  }, [orchestratorStatus, orchestratorApiCall, loadOrchestratorStatus])

  // Check backend connectivity
  const checkBackendConnectivity = useCallback(async () => {
    try {
      setOrchestratorLoading(true)
      const start = Date.now()
      await orchestratorApiCall('/status')
      const duration = Date.now() - start
      
      toast.success(`Backend conectado (${duration}ms)`, {
        description: 'WhatsApp Orchestrator está respondendo normalmente'
      })
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Backend não acessível'
      toast.error('Conectividade com Backend', {
        description: `${message}. Verifique se o CRM Backend está rodando na porta 8099.`
      })
      
      return false
    } finally {
      setOrchestratorLoading(false)
    }
  }, [orchestratorApiCall])

  // Detect port conflicts
  const detectPortConflicts = useCallback(async () => {
    if (!orchestratorStatus) return
    
    const conflicts: { port: number, status: string, issue: string }[] = []
    
    for (const instance of orchestratorStatus.instances) {
      // Check for error instances with high error count
      if (instance.status === 'error' && instance.metadata?.errorCount && instance.metadata.errorCount > 2) {
        conflicts.push({
          port: instance.port,
          status: instance.status,
          issue: `${instance.metadata.errorCount} erros consecutivos`
        })
      }
      
      // Check for stale instances (haven't been updated in over an hour)
      const lastUpdate = new Date(instance.updatedAt)
      const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60)
      if (hoursSinceUpdate > 1 && instance.status !== 'free') {
        conflicts.push({
          port: instance.port,
          status: instance.status,
          issue: `Sem atualização há ${Math.round(hoursSinceUpdate)} horas`
        })
      }
    }
    
    if (conflicts.length > 0) {
      console.warn('Port conflicts detected:', conflicts)
      toast.warning('Conflitos de Porta Detectados', {
        description: `${conflicts.length} instâncias com problemas. Considere reiniciar ou limpar.`
      })
    }
    
    return conflicts
  }, [orchestratorStatus])

  // Copy channel QR code to clipboard
  const copyChannelQRToClipboard = useCallback(async () => {
    if (currentChannelQr?.qr) {
      try {
        await navigator.clipboard.writeText(currentChannelQr.qr)
        toast.success('QR code copiado para a área de transferência')
      } catch {
        toast.error('Falha ao copiar QR code')
      }
    }
  }, [currentChannelQr])

  // Download channel QR code as image
  const downloadChannelQR = useCallback(() => {
    if (currentChannelQr?.dataUrl) {
      const link = document.createElement('a')
      link.href = currentChannelQr.dataUrl
      link.download = `whatsapp-qr-port-${currentChannelQr.port}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success('QR code baixado')
    }
  }, [currentChannelQr])

  // Get next available port
  const getNextAvailablePort = useCallback(() => {
    if (!orchestratorStatus) return null
    const freeInstance = orchestratorStatus.instances.find(inst => inst.status === 'free')
    return freeInstance?.port || null
  }, [orchestratorStatus])

  // Handle start connection button for channels
  const handleStartChannelConnection = useCallback(() => {
    if (selectedPort === 'auto') {
      const availablePort = getNextAvailablePort()
      if (availablePort) {
        startOrchestratorInstance(availablePort)
      } else {
        toast.error('Nenhuma porta disponível')
      }
    } else {
      startOrchestratorInstance(selectedPort)
    }
  }, [selectedPort, getNextAvailablePort, startOrchestratorInstance])

  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    try {
      return await fetch(`${apiBase}${path}`, init)
    } catch (e) {
      // Fallback to same-origin only if localhost:3100 is unreachable
      try { return await fetch(path, init) } catch { throw e }
    }
  }, [apiBase])

  // Helpers: instances
  const loadInstances = useCallback(async () => {
    setWaInstancesLoading(true)
    try {
      const resp = await apiFetch('/api/wa/instances')
      if (resp.ok) {
        const json: any = await resp.json()
        const list = Array.isArray(json) ? json : (json?.instances || [])
        if (Array.isArray(list)) {
          // Only update state if list meaningfully changed to avoid extra rerenders every 10s
          const prev = waInstances
          let changed = prev.length !== list.length
          if (!changed) {
            for (let i = 0; i < list.length; i++) {
              const a = prev[i] as any, b = list[i] as any
              if (!a || !b) { changed = true; break }
              if (a.instance !== b.instance) { changed = true; break }
              if (!!a.alive !== !!b.alive) { changed = true; break }
              if (!!a.ready !== !!b.ready) { changed = true; break }
              if ((a.name || '') !== (b.name || '')) { changed = true; break }
              if ((a.status || '') !== (b.status || '')) { changed = true; break }
              if ((a.lastContactName || '') !== (b.lastContactName || '')) { changed = true; break }
              if ((a.lastContactPhone || '') !== (b.lastContactPhone || '')) { changed = true; break }
              if ((a.lastContactAt || '') !== (b.lastContactAt || '')) { changed = true; break }
            }
          }
          if (changed) setWaInstances(list)
        }
      }
    } catch { /* ignore */ }
    finally { setWaInstancesLoading(false) }
  }, [apiFetch, waInstances])

  const portFromBaseUrl = (u?: string | null) => {
    try { if (!u) return null; const url = new URL(u, window.location.origin); return Number(url.port || (url.hostname === 'localhost' ? '80' : '80')) } catch { return null }
  }
  const instanceFromBaseUrl = (u?: string | null) => {
    const p = portFromBaseUrl(u)
    if (!p) return null
    const inst = p - 3000
    return inst >= 1 && inst <= 9 ? inst : null
  }

  const stopInstance = useCallback(async (inst: number) => {
    // Always force-clean the session before stopping, so next connect shows QR
    try { await apiFetch(`/api/wa/instances/${inst}/force-clean`, { method: 'POST' }) } catch { /* ignore */ }
    const resp = await apiFetch(`/api/wa/stop/${inst}`, { method: 'POST' })
    if (!resp.ok) throw new Error('Falha ao parar instância')
    await loadInstances()
  }, [loadInstances, apiFetch])

  const renameInstance = useCallback(async (inst: number, current?: string | null) => {
    const desired = window.prompt('Defina um nome para esta conta do WhatsApp:', current || '')
    if (!desired) return
    await apiFetch(`/api/wa/instances/${inst}/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: desired.trim() }) })
    await loadInstances()
  }, [loadInstances, apiFetch])

  const updateInstanceMeta = useCallback(async (inst: number, meta: Partial<Pick<WaInstance, 'lastContactName' | 'lastContactPhone' | 'lastContactAt'>>) => {
    try {
      await apiFetch(`/api/wa/instances/${inst}/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) })
      loadInstances()
    } catch { /* ignore */ }
  }, [loadInstances, apiFetch])
  // Attach to an existing or new instance without disconnecting others
  const attachToInstance = useCallback(async (inst: number) => {
    try {
      let assignedBase: string | null = null
      const rec = waInstances.find(i => i.instance === inst)
      if (rec && rec.alive) {
        assignedBase = `http://localhost:${3000 + inst}`
      } else {
        try { await apiFetch(`/api/wa/instances/${inst}/force-clean`, { method: 'POST' }) } catch { /* ignore */ }
        const resp = await apiFetch(`/api/wa/start/${inst}`, { method: 'POST' })
        if (!resp.ok) {
          let detail = 'Falha ao iniciar instância específica'
          try { const j: any = await resp.json(); detail = j?.detail || j?.error || detail } catch { /* ignore */ }
          throw new Error(detail)
        }
        const json: any = await resp.json(); assignedBase = json.baseUrl || `http://localhost:${3000 + inst}`
      }
      currentInstanceRef.current = inst
      const base = assignedBase as string
      setBaseUrlInput(base)
      try { localStorage.setItem('wa.baseUrl', base) } catch { /* ignore */ }
      detectEndpoints(base).then(map => {
        setEndpointMap(map as any)
        try { localStorage.setItem('wa.endpointMap', JSON.stringify(map)) } catch { /* ignore */ }
      })
      // Check session state and update UI
      try {
        const status = await getSessionAuto(base)
        setLastGatewayStatus(status.raw || null)
        if (status.state === 'CONNECTED') {
          setGatewayState('connected')
          setGatewayMessage(status.message || 'Conectado')
          setQrCode(null)
        } else if (status.state === 'QR') {
          setGatewayState('qr')
          setQrCode(status.qr || null)
        } else {
          setGatewayState('starting')
        }
      } catch { /* ignore */ }
      // Re-bind app integration to the selected instance (do not stop others)
      try { disconnectWhatsApp() } catch { /* ignore */ }
      try { connectWhatsApp(base) } catch { /* ignore */ }
      toast.success(`Usando conta ${inst}`)
      await loadInstances()
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao anexar à conta')
    }
  }, [waInstances, apiFetch, detectEndpoints, disconnectWhatsApp, connectWhatsApp, loadInstances])
  const [isMainMenuOpen, setIsMainMenuOpen] = useState(false)
  const [lastSearchResults, setLastSearchResults] = useState<any[]>([])
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchMode, setSearchMode] = useState<'local' | 'global'>('local')
  const [globalSearchParams, setGlobalSearchParams] = useState<{ q: string, phone?: string, tag?: string, has?: string, type?: string, before?: string, after?: string }>({ q: '' })
  const [globalResults, setGlobalResults] = useState<{ contacts: any[], messages: any[], media: any[], meta?: any } | null>(null)
  const [globalPage, setGlobalPage] = useState(1)
  const [globalPageSize, setGlobalPageSize] = useState(25)
  const [globalSort, setGlobalSort] = useState<'recente' | 'antigo'>('recente')
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [isOrderDialogOpen, setIsOrderDialogOpen] = useState(false)
  const [filterForm, setFilterForm] = useState<{ q: string; phone?: string; tag?: string; has?: string; type?: string; after?: string; before?: string }>(() => ({ q: '' }))
  const totalGlobalMessages = useMemo(() => (globalResults?.meta?.total?.messages || 0) as number, [globalResults])
  const totalGlobalPages = useMemo(() => Math.max(1, Math.ceil(totalGlobalMessages / globalPageSize)), [totalGlobalMessages, globalPageSize])

  const performGlobalSearch = useCallback(async (override?: Partial<typeof globalSearchParams> & { page?: number, pageSize?: number, sort?: 'recente' | 'antigo' | string }) => {
    const base = baseUrlInput || whatsapp?.baseUrl || null
    if (!base) { toast.error('Conecte uma instância do WhatsApp'); return }
    const params = { ...globalSearchParams, ...(override || {}) }
    const page = override?.page != null ? override.page : globalPage
    const pageSize = override?.pageSize != null ? override.pageSize : globalPageSize
    const limit = pageSize
    const offset = (page - 1) * pageSize
    try {
      const res = await globalSearchAuto(base, { ...params, limit, offset, sort: override?.sort || undefined })
      setGlobalResults(res as any)
      setGlobalPage(page)
      setGlobalPageSize(pageSize)
      setSearchMode('global')
      setIsSearchOpen(true)
    } catch {
      toast.error('Falha na busca global')
    }
  }, [baseUrlInput, whatsapp?.baseUrl, globalSearchParams, globalPage, globalPageSize])

  // Local error boundary to keep runtime errors in the WhatsApp tab from crashing the whole page
  class SimpleErrorBoundary extends React.Component<{ onReset?: () => void, children: React.ReactNode }, { hasError: boolean; error?: any }> {
    constructor(props: any) { super(props); this.state = { hasError: false, error: undefined } }
    static getDerivedStateFromError(error: any) { return { hasError: true, error } }
    componentDidCatch(error: any, info: any) { try { console.error('[WhatsAppBusinessHub] error in conversations area:', error, info) } catch { /* ignore */ } }
    reset = () => { this.setState({ hasError: false, error: undefined }); try { this.props.onReset?.() } catch { /* ignore */ } }
    render() {
      if (this.state.hasError) {
        return (
          <div className="p-4 border rounded-md bg-destructive/5 text-sm">
            <div className="font-medium mb-2">Ocorreu um erro nesta seção.</div>
            <div className="text-muted-foreground mb-3">Tente recarregar a seção. Os outros módulos não serão afetados.</div>
            <Button variant="outline" onClick={this.reset}>Recarregar seção</Button>
          </div>
        )
      }
      return this.props.children as any
    }
  }

  // Safe contact selection to avoid accidental navigation and swallow unexpected errors
  const onSelectContact = useCallback((e: React.MouseEvent | React.KeyboardEvent | null, id: string) => {
    try {
      if (e) { try { e.preventDefault() } catch { /* ignore */ } try { e.stopPropagation() } catch { /* ignore */ } }
      setSelectedContact(id)
      // Ensure we remain in the conversations tab
      setActiveTab('conversations')
    } catch (err) {
      try { console.error('[WhatsAppBusinessHub] failed to select contact', err) } catch { /* ignore */ }
      toast.error('Não foi possível abrir a conversa')
    }
  }, [])

  // Persist per-instance last contact metadata when the selection changes
  useEffect(() => {
    if (!whatsapp.connected || !selectedContact) return
    const contact = contacts.find(c => c.id === selectedContact)
    const inst = (currentInstanceRef.current) || instanceFromBaseUrl(whatsapp.baseUrl || baseUrlInput)
    if (!inst || !contact) return
    updateInstanceMeta(inst, { lastContactName: contact.name, lastContactPhone: contact.phone, lastContactAt: new Date().toISOString() })
  }, [selectedContact, whatsapp.connected])

  // Hidratar objetos vindos do localStorage (strings -> Date)
  useEffect(() => {
    if (hydratedRef.current) return
    let changed = false
    const newContacts = contacts.map(c => {
      const lastSeen = parseDate(c.lastSeen as any)
      const firstContactDate = parseDate(c.firstContactDate as any)
      if (lastSeen !== c.lastSeen || firstContactDate !== c.firstContactDate) {
        changed = true
        return { ...c, lastSeen, firstContactDate }
      }
      return c
    })
    if (changed) setContacts(newContacts)

    changed = false
    const newMessages = messages.map(m => {
      const timestamp = parseDate(m.timestamp as any)
      if (timestamp !== m.timestamp) { changed = true; return { ...m, timestamp } }
      return m
    })
    if (changed) setMessages(newMessages)

    changed = false
    const newTemplates = templates.map(t => {
      const createdAt = parseDate(t.createdAt as any)
      if (createdAt !== t.createdAt) { changed = true; return { ...t, createdAt } }
      return t
    })
    if (changed) setTemplates(newTemplates)

    changed = false
    const newBroadcasts = broadcasts.map(b => {
      const scheduledTime = b.scheduledTime ? parseDate(b.scheduledTime as any) : undefined
      const sentTime = b.sentTime ? parseDate(b.sentTime as any) : undefined
      if (scheduledTime !== b.scheduledTime || sentTime !== b.sentTime) { changed = true; return { ...b, scheduledTime, sentTime } }
      return b
    })
    if (changed) setBroadcasts(newBroadcasts)

    hydratedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist aiMode
  useEffect(() => {
    try { localStorage.setItem('wa.aiMode', aiMode) } catch { /* ignore */ }
  }, [aiMode])

  // Persist per-chat AI overrides
  useEffect(() => {
    try { localStorage.setItem('wa.aiModeByChat', JSON.stringify(aiModeByChat)) } catch { /* ignore */ }
  }, [aiModeByChat])

  // Auto-expire mutes and remove 🔕 tags
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now()
      const next: Record<string, number | null> = { ...muteUntilByChat }
      let changed = false
      for (const [chatId, until] of Object.entries(muteUntilByChat)) {
        if (until && now >= until) {
          next[chatId] = null
          changed = true
          setMutedChats(prev => { const s = new Set(prev); s.delete(chatId); return s })
          // remove 🔕 tag from contact labels
          setContacts(prev => prev.map(c => c.id === chatId ? { ...c, labels: (c.labels || []).filter(l => !l.startsWith('🔕')) } : c))
        }
      }
      if (changed) setMuteUntilByChat(next)
    }, 30000)
    return () => window.clearInterval(id)
  }, [muteUntilByChat, setContacts])

  // Generate a data URL for QR code strings that are not already images
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const val = qrCode
      if (!val) { setQrDataUrl(null); return }
      if (/^data:image\//.test(val)) { setQrDataUrl(val); return }
      try {
        const url = await QRCode.toDataURL(val, { errorCorrectionLevel: 'M', margin: 1, width: 512 })
        if (!cancelled) setQrDataUrl(url)
      } catch {
        if (!cancelled) setQrDataUrl(null)
      }
    }
    run()
    return () => { cancelled = true }
  }, [qrCode])

  // Fetch AI suppression status for selected conversation
  useEffect(() => {
    if (!selectedContact) { setAiSuppressed(false); setAiResumeAt(null); return }
    let cancelled = false
      ; (async () => {
        try {
          const res = await apiFetch(`/api/conversations/${encodeURIComponent(selectedContact)}/ai-status`)
          if (!res.ok) return
          const json: any = await res.json()
          if (!cancelled) {
            setAiSuppressed(!!json.suppressed)
            setAiResumeAt(json.resumeAt || null)
          }
        } catch { /* ignore */ }
      })()
    return () => { cancelled = true }
  }, [selectedContact])

  // Helper para adicionar mensagens com deduplicação
  const safeAddMessages = (incoming: WhatsAppMessage[]) => {
    if (!incoming || !incoming.length) return
    let added = false
    const prepared = [] as WhatsAppMessage[]
    for (const raw of incoming) {
      if (!raw?.id) continue
      if (ingestedIdsRef.current.has(raw.id)) continue
      ingestedIdsRef.current.add(raw.id)
      // Garantir timestamp Date
      const ts = raw.timestamp instanceof Date ? raw.timestamp : new Date(raw.timestamp as any)
      prepared.push({ ...raw, timestamp: ts })
      added = true
    }
    if (added) {
      setMessages(prev => [...prev, ...prepared].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()))
    }
  }

  // Mock data initialization
  useEffect(() => {
    if (contacts.length === 0) {
      setContacts([
        {
          id: "contact_1",
          name: "João Silva",
          phone: "+5511999887766",
          avatar: "/api/placeholder/40/40",
          lastSeen: new Date(Date.now() - 5 * 60000),
          isOnline: true,
          labels: ["lead", "interessado"],
          customFields: { empresa: "Tech Solutions", cargo: "CEO" },
          totalMessages: 45,
          firstContactDate: new Date(Date.now() - 30 * 24 * 60 * 60000)
        },
        {
          id: "contact_2",
          name: "Maria Santos",
          phone: "+5511888776655",
          avatar: "/api/placeholder/40/40",
          lastSeen: new Date(Date.now() - 30 * 60000),
          isOnline: false,
          labels: ["cliente", "premium"],
          customFields: { empresa: "Marketing Plus", cargo: "Diretora" },
          totalMessages: 128,
          firstContactDate: new Date(Date.now() - 90 * 24 * 60 * 60000)
        },
        {
          id: "contact_3",
          name: "Pedro Costa",
          phone: "+5511777665544",
          lastSeen: new Date(Date.now() - 2 * 60 * 60000),
          isOnline: false,
          labels: ["prospect"],
          customFields: { empresa: "StartupXYZ" },
          totalMessages: 12,
          firstContactDate: new Date(Date.now() - 7 * 24 * 60 * 60000)
        }
      ])
    }

    if (messages.length === 0) {
      setMessages([
        {
          id: "msg_1",
          conversationId: "contact_1",
          type: "text",
          content: "Olá! Gostaria de saber mais sobre o CRM de vocês.",
          timestamp: new Date(Date.now() - 10 * 60000),
          status: "read",
          fromUser: true
        },
        {
          id: "msg_2",
          conversationId: "contact_1",
          type: "text",
          content: "Olá João! Fico feliz com seu interesse. Nosso CRM pode aumentar suas vendas em até 40%. Gostaria de agendar uma demonstração?",
          timestamp: new Date(Date.now() - 8 * 60000),
          status: "read",
          fromUser: false
        },
        {
          id: "msg_3",
          conversationId: "contact_1",
          type: "text",
          content: "Sim, seria ótimo! Quando vocês têm disponibilidade?",
          timestamp: new Date(Date.now() - 5 * 60000),
          status: "read",
          fromUser: true
        }
      ])
    }

    if (templates.length === 0) {
      setTemplates([
        {
          id: "template_1",
          name: "boas_vindas",
          category: "UTILITY",
          language: "pt_BR",
          status: "APPROVED",
          components: [
            {
              type: "BODY",
              text: "Olá {{1}}! Bem-vindo(a) ao nosso CRM. Estou aqui para ajudar com qualquer dúvida."
            },
            {
              type: "BUTTONS",
              buttons: [
                { type: "QUICK_REPLY", text: "Fazer pergunta" },
                { type: "QUICK_REPLY", text: "Agendar demo" }
              ]
            }
          ],
          usageCount: 156,
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60000)
        },
        {
          id: "template_2",
          name: "lembrete_demo",
          category: "UTILITY",
          language: "pt_BR",
          status: "APPROVED",
          components: [
            {
              type: "BODY",
              text: "Olá {{1}}! Lembrete da sua demonstração do CRM hoje às {{2}}. Em caso de dúvidas, estou à disposição."
            }
          ],
          usageCount: 89,
          createdAt: new Date(Date.now() - 15 * 24 * 60 * 60000)
        }
      ])
    }

    if (broadcasts.length === 0) {
      setBroadcasts([
        {
          id: "broadcast_1",
          name: "Campanha Fim de Ano",
          templateId: "template_1",
          targetContacts: ["contact_1", "contact_2"],
          sentTime: new Date(Date.now() - 2 * 24 * 60 * 60000),
          status: "sent",
          results: {
            sent: 234,
            delivered: 231,
            read: 187,
            failed: 3
          }
        }
      ])
    }
  }, [contacts.length, messages.length, templates.length, broadcasts.length, setContacts, setMessages, setTemplates, setBroadcasts])

  const sendMessage = async () => {
    if (!messageInput.trim() || !selectedContact) return
    try {
      // localizar contato
      const contact = contacts.find(c => c.id === selectedContact)
      if (whatsapp.connected && whatsapp.baseUrl && contact) {
        await sendWhatsAppMessage(whatsapp.baseUrl, { to: contact.phone, text: messageInput })
      }
      const newMessage: WhatsAppMessage = {
        id: `msg_${Date.now()}`,
        conversationId: selectedContact,
        type: "text",
        content: messageInput,
        timestamp: new Date(),
        status: "sent",
        fromUser: false,
        metadata: { sentiment: computeSentiment(messageInput) }
      }
      setMessages(current => [...current, newMessage])
      setMessageInput("")
      toast.success("Mensagem enviada!")
    } catch (e: any) {
      toast.error('Erro ao enviar: ' + e.message)
    }
  }

  // Utilities
  const downloadFile = (filename: string, data: Blob | string) => {
    const blob = typeof data === 'string' ? new Blob([data], { type: 'application/json;charset=utf-8' }) : data
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const updateContact = (id: string, patch: Partial<WhatsAppContact> & { customFields?: any }) => {
    setContacts(prev => prev.map(c => {
      if (c.id !== id) return c
      const nextCF = { ...(c.customFields || {}), ...(patch.customFields || {}) }
      const { customFields, ...rest } = patch
      return { ...c, ...rest, customFields: nextCF }
    }))
  }

  const handleExport = () => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        contacts,
        messages: messages.map(m => ({ ...m, timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp })),
        templates,
        broadcasts
      }
      downloadFile(`whatsapp-export-${Date.now()}.json`, JSON.stringify(payload, null, 2))
      toast.success('Exportado com sucesso')
    } catch (e: any) {
      toast.error('Falha ao exportar: ' + e.message)
    }
  }

  const createNewConversation = async () => {
    const phone = newConvPhone.trim()
    const name = newConvName.trim() || newConvPhone.trim()
    if (!phone) { toast.error('Informe um telefone'); return }
    const id = phone
    const exists = contacts.find(c => c.id === id)
    if (exists) {
      setSelectedContact(id)
      setIsNewConvOpen(false)
      setNewConvName(''); setNewConvPhone('')
      // opcional: enviar um "olá" para iniciar via gateway
      try {
        if (whatsapp.connected && whatsapp.baseUrl) {
          await sendWhatsAppMessage(whatsapp.baseUrl, { to: phone, text: 'Olá!' })
        }
      } catch { /* ignore */ }
      return
    }
    const contact: WhatsAppContact = {
      id,
      name: name || id,
      phone,
      lastSeen: new Date(),
      isOnline: false,
      labels: ['manual'],
      customFields: {},
      totalMessages: 0,
      firstContactDate: new Date()
    }
    setContacts(prev => [...prev, contact])
    setSelectedContact(id)
    setIsNewConvOpen(false)
    setNewConvName(''); setNewConvPhone('')
    toast.success('Conversa criada')
    // opcional: enviar um "olá" para iniciar via gateway
    try {
      if (whatsapp.connected && whatsapp.baseUrl) {
        await sendWhatsAppMessage(whatsapp.baseUrl, { to: phone, text: 'Olá!' })
      }
    } catch { /* ignore */ }
  }

  const readFileAsDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(f)
  })

  // Sentiment (pluggable service)
  const computeSentiment = (text: string): 'positive' | 'neutral' | 'negative' => analyzeSentiment(text)

  const handleFilePicked = async (files: FileList | null, kind: WhatsAppMessage['type']) => {
    if (!files || files.length === 0 || !selectedContact) return
    const f = files[0]
    const contact = contacts.find(c => c.id === selectedContact)
    if (!contact) { toast.error('Contato inválido'); return }
    if (!whatsapp.connected || !whatsapp.baseUrl) { toast.error('Conecte ao WhatsApp antes de enviar anexos'); return }
    try {
      const dataUrl = await readFileAsDataUrl(f)
      const waType = detectWhatsAppMediaType(f.type)
      await sendWhatsAppAttachments(whatsapp.baseUrl, contact.phone, [{
        id: 'a_' + Date.now(),
        name: f.name,
        size: f.size,
        mime: f.type,
        dataUrl,
        waType
      }], undefined)
      const objUrl = URL.createObjectURL(f)
      const newMessage: WhatsAppMessage = {
        id: `msg_${Date.now()}`,
        conversationId: selectedContact,
        type: waType,
        content: f.name,
        mediaUrl: objUrl,
        timestamp: new Date(),
        status: 'delivered',
        fromUser: false,
        metadata: { size: f.size, type: f.type }
      }
      setMessages(prev => [...prev, newMessage])
      toast.success('Anexo enviado')
    } catch (e: any) {
      toast.error('Falha ao enviar anexo: ' + (e?.message || 'erro'))
    }
  }

  // Helper: ensure WA connected
  const ensureWhatsAppConnected = () => whatsapp.connected && whatsapp.baseUrl

  // Recording controls (moved to component scope)
  const startRecording = async () => {
    if (!selectedContact) { toast.error('Selecione uma conversa'); return }
    if (!ensureWhatsAppConnected()) { toast.error('Conecte ao WhatsApp'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      recordedChunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        try {
          const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
          const file = new File([blob], `gravacao_${Date.now()}.webm`, { type: 'audio/webm' })
          const url = URL.createObjectURL(file)
          // Send via gateway as attachment
          const contact = contacts.find(c => c.id === selectedContact)!
          const dataUrl = await readFileAsDataUrl(file)
          await sendWhatsAppAttachments(whatsapp.baseUrl!, contact.phone, [{ id: 'a_' + Date.now(), name: file.name, size: file.size, mime: file.type, dataUrl, waType: 'document' }], undefined)
          setMessages(prev => [...prev, {
            id: 'msg_' + Date.now(), conversationId: selectedContact, type: 'audio', content: file.name, mediaUrl: url, timestamp: new Date(), status: 'delivered', fromUser: false
          }])
          toast.success('Áudio enviado')
        } catch (e: any) {
          toast.error('Falha ao enviar áudio: ' + (e?.message || 'erro'))
        }
      }
      mediaRecorderRef.current = mr
      mr.start()
      setIsRecording(true)
      // timer
      setRecordingSeconds(0)
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current)
      recordTimerRef.current = window.setInterval(() => setRecordingSeconds(s => s + 1), 1000)
      // waveform time-domain + level
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      const timeDomain = new Uint8Array(analyser.fftSize)
      const draw = () => {
        analyser.getByteTimeDomainData(timeDomain)
        // Level via RMS
        let sumSq = 0
        for (let i = 0; i < timeDomain.length; i++) {
          const v = (timeDomain[i] - 128) / 128
          sumSq += v * v
        }
        const rms = Math.sqrt(sumSq / timeDomain.length)
        setRecordingLevel(Math.min(100, Math.max(0, Math.round(rms * 100))))
        // Draw waveform
        const canvas = waveformCanvasRef.current
        if (canvas) {
          const dpr = window.devicePixelRatio || 1
          const cssW = canvas.clientWidth || 160
          const cssH = canvas.clientHeight || 24
          const targetW = Math.floor(cssW * dpr)
          const targetH = Math.floor(cssH * dpr)
          if (canvas.width !== targetW) canvas.width = targetW
          if (canvas.height !== targetH) canvas.height = targetH
          const c = canvas.getContext('2d')!
          c.clearRect(0, 0, canvas.width, canvas.height)
          c.lineWidth = 2
          c.strokeStyle = '#16a34a'
          c.beginPath()
          const slice = canvas.width / timeDomain.length
          let x = 0
          for (let i = 0; i < timeDomain.length; i++) {
            const v = timeDomain[i] / 255
            const y = (1 - v) * canvas.height
            if (i === 0) c.moveTo(x, y)
            else c.lineTo(x, y)
            x += slice
          }
          c.stroke()
        }
        levelRafRef.current = requestAnimationFrame(draw)
      }
      levelRafRef.current = requestAnimationFrame(draw)
      toast.info('Gravando áudio...')
    } catch (e: any) {
      toast.error('Permita acesso ao microfone para gravar')
    }
  }

  const stopRecording = () => {
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      mr.stop()
      mr.stream.getTracks().forEach(t => t.stop())
    }
    setIsRecording(false)
    if (recordTimerRef.current) { window.clearInterval(recordTimerRef.current); recordTimerRef.current = null }
    if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = null }
    setRecordingLevel(0)
    try { audioCtxRef.current?.close() } catch { /* ignore */ }
    audioCtxRef.current = null
    // clear waveform
    const canvas = waveformCanvasRef.current
    if (canvas) {
      const c = canvas.getContext('2d')
      if (c) c.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  const handleShareLocation = () => {
    if (!selectedContact) { toast.error('Selecione uma conversa'); return }
    const contact = contacts.find(c => c.id === selectedContact)
    if (!contact) { toast.error('Contato inválido'); return }
    if (!('geolocation' in navigator)) { toast.error('Geolocalização não suportada'); return }
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords
      const gmaps = `https://maps.google.com/?q=${latitude},${longitude}`
      // tenta enviar pelo gateway como texto/link
      if (whatsapp.connected && whatsapp.baseUrl) {
        sendWhatsAppMessage(whatsapp.baseUrl, { to: contact.phone, text: `Minha localização: ${gmaps}` }).catch(() => { /* ignore */ })
      }
      const msg: WhatsAppMessage = {
        id: `msg_${Date.now()}`,
        conversationId: selectedContact,
        type: 'location',
        content: `${latitude},${longitude}`,
        timestamp: new Date(),
        status: 'sent',
        fromUser: false,
        metadata: { latitude, longitude, link: gmaps }
      }
      setMessages(prev => [...prev, msg])
      toast.success('Localização enviada')
    }, () => toast.error('Não foi possível obter a localização'))
  }

  // Track last avatar URL object URLs to revoke when replaced
  const lastAvatarObjectUrlsRef = useRef<Record<string, string>>({})

  // Sync inicial de chats após conexão
  useEffect(() => {
    if (!whatsapp.connected || !whatsapp.baseUrl) return
    (async () => {
      try {
        const chats = await fetchChatsAuto(whatsapp.baseUrl!)
        if (Array.isArray(chats) && chats.length) {
          const normalized: WhatsAppContact[] = chats.slice(0, 200).map((c: any) => {
            const id = c.id || c.chatId || c.jid || c.remoteJid || c.number || c.contact || 'chat_' + Math.random()
            const phone = (id || '').replace(/@c\.us$/, '')
            return {
              id,
              name: c.name || c.pushName || phone,
              phone,
              avatar: undefined,
              lastSeen: new Date(),
              isOnline: false,
              labels: ['whatsapp'],
              customFields: {},
              totalMessages: c.messagesCount || 0,
              firstContactDate: new Date()
            }
          })
          // merge evitando duplicados
          setContacts(prev => {
            const existingIds = new Set(prev.map(p => p.id))
            const add = normalized.filter(n => !existingIds.has(n.id))
            return [...prev, ...add]
          })
          // Hydrate pinned/archived/unread flags if gateway supports
          try {
            const flags = await fetchChatFlagsAuto(whatsapp.baseUrl!)
            if (flags) {
              if (flags.pinned.size) setPinnedChats(new Set(flags.pinned))
              if (flags.archived.size) setArchivedChats(new Set(flags.archived))
              if (flags.unread.size) setUnreadChats(new Set(flags.unread))
            }
          } catch { /* ignore hydration errors */ }
          // Prefetch avatars in background for new contacts
          const idsToFetch = new Set(normalized.map(n => n.id))
          setTimeout(async () => {
            const list = contactsRef.current.filter(c => idsToFetch.has(c.id) && !c.avatar)
            const concurrency = 4
            let idx = 0
            const runNext = async () => {
              const item = list[idx++]
              if (!item) return
              try {
                const key = item.phone || item.id
                if (avatarCacheRef.current[key]) {
                  setContacts(prev => prev.map(p => p.id === item.id ? { ...p, avatar: avatarCacheRef.current[key] } : p))
                } else {
                  const url = await fetchAvatarAuto(whatsapp.baseUrl!, key)
                  if (url) {
                    // If this looks like an object URL, revoke any old one for this id
                    if (lastAvatarObjectUrlsRef.current[item.id] && lastAvatarObjectUrlsRef.current[item.id].startsWith('blob:')) {
                      try { URL.revokeObjectURL(lastAvatarObjectUrlsRef.current[item.id]) } catch { /* ignore */ }
                    }
                    avatarCacheRef.current[key] = url
                    if (url.startsWith('blob:')) lastAvatarObjectUrlsRef.current[item.id] = url
                    setContacts(prev => prev.map(p => p.id === item.id ? { ...p, avatar: url } : p))
                  }
                }
              } catch { /* ignore avatar errors */ }
              await runNext()
            }
            await Promise.all(Array.from({ length: concurrency }).map(() => runNext()))
          }, 0)
        }
      } catch { /* ignore */ }
    })()
  }, [whatsapp.connected, whatsapp.baseUrl, setContacts])

  // Backfill avatars for contacts missing one whenever list updates and connected
  useEffect(() => {
    if (!whatsapp.connected || !whatsapp.baseUrl) return
    const pending = contacts.filter(c => !c.avatar).slice(0, 50)
    if (!pending.length) return
    let cancelled = false
      ; (async () => {
        const concurrency = 3
        let i = 0
        const run = async () => {
          const item = pending[i++]
          if (!item || cancelled) return
          try {
            const key = item.phone || item.id
            if (avatarCacheRef.current[key]) {
              setContacts(prev => prev.map(p => p.id === item.id ? { ...p, avatar: avatarCacheRef.current[key] } : p))
            } else {
              const url = await fetchAvatarAuto(whatsapp.baseUrl!, key)
              if (url) {
                // Revoke any previous object URL for this id
                if (lastAvatarObjectUrlsRef.current[item.id] && lastAvatarObjectUrlsRef.current[item.id].startsWith('blob:')) {
                  try { URL.revokeObjectURL(lastAvatarObjectUrlsRef.current[item.id]) } catch { /* ignore */ }
                }
                avatarCacheRef.current[key] = url
                if (url.startsWith('blob:')) lastAvatarObjectUrlsRef.current[item.id] = url
                if (!cancelled) setContacts(prev => prev.map(p => p.id === item.id ? { ...p, avatar: url } : p))
              }
            }
          } catch { /* ignore */ }
          await run()
        }
        await Promise.all(Array.from({ length: concurrency }).map(() => run()))
      })()
    return () => { cancelled = true }
  }, [contacts, whatsapp.connected, whatsapp.baseUrl, setContacts])

  // When selecting a conversation, mark as read on gateway (if connected) and prefetch recent media
  useEffect(() => {
    if (!selectedContact) return
      // Persist read state on backend if connected
      ; (async () => {
        try {
          if (ensureWhatsAppConnected()) {
            await markChatSeen(whatsapp.baseUrl!, selectedContact)
          }
        } catch { /* ignore */ }
        setUnreadChats(prev => { const s = new Set(prev); s.delete(selectedContact); return s })
        setUnreadCounts(prev => ({ ...prev, [selectedContact]: 0 }))
      })()
      // Prefetch recent media and append as messages if not present
      ; (async () => {
        try {
          if (!ensureWhatsAppConnected()) return
          const data = await fetchRecentMediaAuto(whatsapp.baseUrl!, selectedContact, 12)
          if (!Array.isArray(data) || !data.length) return
          const toAdd: WhatsAppMessage[] = []
          data.forEach((m: any, idx: number) => {
            const typ = (m.type || m.mediaType || '').toLowerCase()
            // map to supported types
            const mapType = typ.includes('image') ? 'image' : typ.includes('video') ? 'video' : (typ.includes('doc') || typ.includes('pdf') || typ.includes('application')) ? 'document' : (typ.includes('audio') ? 'audio' : null)
            if (!mapType) return
            const mid = m.id || m.key || `media_${selectedContact}_${m.timestamp || ''}_${idx}`
            const when = m.timestamp ? new Date(m.timestamp) : new Date()
            const url = m.url || m.mediaUrl || m.link || null
            if (!mid) return
            toAdd.push({ id: String(mid), conversationId: selectedContact, type: mapType as any, content: m.caption || m.name || (mapType.toUpperCase()), mediaUrl: url || undefined, timestamp: when, status: 'read', fromUser: true, metadata: { source: 'prefetch' } })
          })
          if (toAdd.length) safeAddMessages(toAdd)
        } catch { /* ignore */ }
      })()
    // After switching conversation, anchor scroll to the latest (bottom)
    try {
      requestAnimationFrame(() => {
        const v = chatViewportRef.current
        if (v) {
          v.scrollTop = v.scrollHeight
          lastScrollTopRef.current = v.scrollTop
        }
      })
    } catch { /* ignore */ }
  }, [selectedContact])

  // Poll adaptativo + SSE
  useEffect(() => {
    if (!whatsapp.connected || !whatsapp.baseUrl) return
    let cancelled = false
    let timeout: number | null = null

    function schedule(nextMs: number) {
      if (cancelled) return
      if (pollTimeoutRef.current) {
        window.clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
      timeout = window.setTimeout(() => {
        // Skip polling if the user is actively typing/filtering to avoid UI jumps
        if (typingActivityRef.current || filteringActivityRef.current) {
          schedule(Math.max(500, nextMs))
          return
        }
        if (!pollInFlightRef.current) poll()
      }, nextMs)
      pollTimeoutRef.current = timeout
    }

    async function poll() {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      try {
        console.log('[WA Poll] fetching messages since', lastPollRef.current)
        const newMsgs = await fetchMessagesAuto(whatsapp.baseUrl!, lastPollRef.current || undefined)
        if (newMsgs.length) {
          setConsecutiveErrors(0)
          const latest = newMsgs.map((m: any) => m.timestamp).sort().slice(-1)[0]
          setLastPoll(latest)
          lastPollRef.current = latest
          console.log('[WA Poll] received', newMsgs.length, 'messages; latest=', latest)
          const toAddMessages: WhatsAppMessage[] = []
            , newContacts: WhatsAppContact[] = []
          newMsgs.forEach((m: any) => {
            const contactId = m.from
            const exists = contactsRef.current.find(c => c.id === contactId)
            if (!exists) {
              newContacts.push({
                id: contactId,
                name: contactId,
                phone: contactId,
                lastSeen: new Date(),
                isOnline: false,
                labels: ['whatsapp'],
                customFields: {},
                totalMessages: 1,
                firstContactDate: new Date()
              })
              const leadPayload = mapWhatsAppMessageToLead(m as any)
              window.dispatchEvent(new CustomEvent('lead:new', { detail: { ...leadPayload, __silent: true } }))
            }
            toAddMessages.push({
              id: m.id,
              conversationId: contactId,
              type: 'text',
              content: m.text || '',
              timestamp: new Date(m.timestamp),
              status: 'read',
              fromUser: true,
              metadata: { sentiment: computeSentiment(m.text || '') }
            })
            window.dispatchEvent(new CustomEvent('whatsapp:message', { detail: { phone: m.from, text: m.text, timestamp: m.timestamp } }))
          })
          if (newContacts.length) setContacts(prev => [...prev, ...newContacts])
          if (toAddMessages.length) safeAddMessages(toAddMessages)
          // Restore previous scroll position to prevent jump/flicker
          const v = chatViewportRef.current
          if (v && typeof lastScrollTopRef.current === 'number') {
            requestAnimationFrame(() => { try { v.scrollTop = lastScrollTopRef.current } catch { /* ignore */ } })
          }
        }
        schedule(pollConfigRef.current.pollIntervalMs)
      } catch {
        console.warn('[WA Poll] error; consecutiveErrors=', consecutiveErrors + 1)
        setConsecutiveErrors(e => e + 1)
        const backoff = Math.min(pollConfigRef.current.pollIntervalMs * Math.pow(2, consecutiveErrors), 120000)
        schedule(backoff)
      } finally {
        pollInFlightRef.current = false
        lastPollAtRef.current = Date.now()
      }
    }

    // Messages SSE
    if (!eventsRef.current) {
      eventsRef.current = openEventsStreamAuto(whatsapp.baseUrl!, (evt) => {
        if (evt && evt.type === 'message' && evt.data) {
          // Debounce fast polls from SSE to avoid frequent full refresh
          const now = Date.now()
          const since = now - lastPollAtRef.current
          const minGap = pollConfigRef.current.sseMinGapMs
          if (sseDebounceTimerRef.current) {
            window.clearTimeout(sseDebounceTimerRef.current)
            sseDebounceTimerRef.current = null
          }
          if (since >= minGap) {
            // Schedule a near-immediate poll, coalesced
            sseDebounceTimerRef.current = window.setTimeout(() => { if (!pollInFlightRef.current) poll() }, pollConfigRef.current.sseDebounceMs)
          } else {
            sseDebounceTimerRef.current = window.setTimeout(() => { if (!pollInFlightRef.current) poll() }, Math.max(0, minGap - since))
          }
        }
      })
    }
    // AI suppression SSE
    if (!suppressionEventsRef.current) {
      const es = new EventSource(`/api/ai-suppression/events`)
      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data)
          if (payload?.type === 'snapshot' && selectedContact) {
            const resumeAt = payload.suppressions?.[selectedContact]
            setAiSuppressed(!!resumeAt && new Date(resumeAt) > new Date())
            setAiResumeAt(resumeAt || null)
          }
          if (payload?.type === 'suppress' && payload.conversationId === selectedContact) {
            setAiSuppressed(true); setAiResumeAt(payload.resumeAt || null)
          }
          if (payload?.type === 'resume' && payload.conversationId === selectedContact) {
            setAiSuppressed(false); setAiResumeAt(null)
          }
        } catch { /* ignore */ }
      }
      suppressionEventsRef.current = es
    }
    poll()
    return () => {
      cancelled = true
      if (timeout) window.clearTimeout(timeout)
      if (pollTimeoutRef.current) { window.clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null }
      if (sseDebounceTimerRef.current) { window.clearTimeout(sseDebounceTimerRef.current); sseDebounceTimerRef.current = null }
      if (eventsRef.current) { eventsRef.current.close(); eventsRef.current = null }
      if (suppressionEventsRef.current) { suppressionEventsRef.current.close(); suppressionEventsRef.current = null }
    }
  }, [whatsapp.connected, whatsapp.baseUrl, selectedContact])

  const formatLastSeen = (dateInput: Date | string | number) => {
    const date = parseDate(dateInput)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)

    if (minutes < 1) return "agora"
    if (minutes < 60) return `${minutes}m`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
    return `${Math.floor(minutes / 1440)}d`
  }

  const getConversationMessages = (contactId: string) => {
    return messages
      .filter(msg => msg.conversationId === contactId)
      .sort((a, b) => parseDate(a.timestamp).getTime() - parseDate(b.timestamp).getTime())
  }

  // Lightweight local assist suggestions (placeholder until Agent Zero assist API is wired)
  const generateLocalSuggestions = useCallback((text: string, contact?: WhatsAppContact | undefined): string[] => {
    const t = (text || '').trim()
    const name = contact?.name || contact?.phone || 'você'
    if (!t) return [
      `Olá ${name}! Como posso ajudar hoje?`,
      'Poderia me dar mais detalhes, por favor?',
      'Claro! Posso te enviar opções e prazos. Quer seguir?'
    ]
    const lower = t.toLowerCase()
    const base = [
      `${name.split(' ')[0]}, obrigado pela mensagem!`,
      'Consigo te ajudar com isso agora mesmo.',
      'Posso confirmar alguns dados antes?'
    ]
    if (lower.includes('preço') || lower.includes('valor')) {
      return [
        'Temos planos com diferentes faixas — quer que eu te envie uma proposta?',
        'O valor depende do volume/escopo. Pode me dizer seu objetivo principal?',
        'Posso calcular agora e te retorno em instantes.'
      ]
    }
    if (lower.includes('prazo') || lower.includes('quando')) {
      return [
        'Consigo entregar ainda esta semana. Te serve?',
        'O prazo padrão é 2-3 dias. Quer que eu priorize?',
        'Dependendo do escopo, posso agilizar para amanhã.'
      ]
    }
    return base
  }, [])

  // Effective AI mode for current chat (per-chat override > global)
  const effectiveAiMode = useMemo(() => {
    if (!selectedContact) return aiMode
    const m = aiModeByChat[selectedContact]
    return m || aiMode
  }, [selectedContact, aiModeByChat, aiMode])

  // Refresh assist suggestions upon new inbound message in selected chat
  useEffect(() => {
    if (!selectedContact) return
    if (!(effectiveAiMode === 'assist' || effectiveAiMode === 'auto')) return
    if (aiSuppressed) return
    const msgs = getConversationMessages(selectedContact)
    const lastInbound = [...msgs].reverse().find(m => m.fromUser)
    if (!lastInbound) return
      ; (async () => {
        try {
          // Prepare context with last 8 messages (role + text)
          const ctx = msgs.slice(-8).map(m => ({ role: m.fromUser ? 'user' : 'assistant', text: m.content }))
          const res = await fetch(`/api/conversations/${encodeURIComponent(selectedContact)}/ai-suggestions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: ctx, n: 4 })
          })
          if (res.ok) {
            const js: any = await res.json()
            const list: string[] = Array.isArray(js?.suggestions) ? js.suggestions : []
            if (list.length) setAiSuggestionsByChat(prev => ({ ...prev, [selectedContact!]: list }))
            else {
              const contact = contacts.find(c => c.id === selectedContact)
              const ideas = generateLocalSuggestions(lastInbound.content || '', contact)
              setAiSuggestionsByChat(prev => ({ ...prev, [selectedContact!]: ideas }))
            }
          }
        } catch {
          const contact = contacts.find(c => c.id === selectedContact)
          const ideas = generateLocalSuggestions(lastInbound.content || '', contact)
          setAiSuggestionsByChat(prev => ({ ...prev, [selectedContact!]: ideas }))
        }
      })()
  }, [messages, selectedContact, effectiveAiMode, aiSuppressed, contacts, generateLocalSuggestions])

  // Auto-reply in 'auto' mode with AI typing indicator and backoff
  const autoReplyInFlightRef = useRef<Record<string, boolean>>({})
  useEffect(() => {
    if (!selectedContact) return
    if (effectiveAiMode !== 'auto') return
    if (aiSuppressed) return
    const msgs = getConversationMessages(selectedContact)
    const lastInbound = [...msgs].reverse().find(m => m.fromUser)
    if (!lastInbound) return
    const chatKey = selectedContact
    if (autoReplyInFlightRef.current[chatKey]) return
    autoReplyInFlightRef.current[chatKey] = true
      ; (async () => {
        // show AI typing
        try { await fetch(`/api/conversations/${encodeURIComponent(chatKey)}/typing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'ai', typing: true }) }) } catch { /* ignore */ }
        try {
          // Reuse suggestions endpoint; pick the top suggestion as reply
          const ctx = msgs.slice(-8).map(m => ({ role: m.fromUser ? 'user' : 'assistant', text: m.content }))
          let reply = ''
          try {
            const r = await fetch(`/api/conversations/${encodeURIComponent(chatKey)}/ai-suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: ctx, n: 1 }) })
            const js: any = r.ok ? await r.json() : null
            reply = (Array.isArray(js?.suggestions) && js.suggestions[0]) || ''
          } catch { /* ignore */ }
          if (!reply) {
            const contact = contacts.find(c => c.id === chatKey)
            reply = generateLocalSuggestions(lastInbound.content || '', contact)[0] || ''
          }
          reply = String(reply || '').trim()
          if (!reply) { return }
          if (!ensureWhatsAppConnected()) return
          const contact = contacts.find(c => c.id === chatKey)
          if (!contact) return
          // small simulated thinking time to avoid instant sends
          await new Promise(r => setTimeout(r, 600))
          await sendWhatsAppMessage(whatsapp.baseUrl!, { to: contact.phone, text: reply })
          const newMessage: WhatsAppMessage = {
            id: `ai_${Date.now()}`,
            conversationId: chatKey,
            type: 'text',
            content: reply,
            timestamp: new Date(),
            status: 'delivered',
            fromUser: false,
            metadata: { source: 'ai-auto' }
          }
          setMessages(prev => [...prev, newMessage])
        } catch { /* ignore send errors */ }
        finally {
          try { await fetch(`/api/conversations/${encodeURIComponent(chatKey)}/typing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'ai', typing: false }) }) } catch { /* ignore */ }
          autoReplyInFlightRef.current[chatKey] = false
        }
      })()
  }, [messages, selectedContact, effectiveAiMode, aiSuppressed, contacts, whatsapp.connected, whatsapp.baseUrl, generateLocalSuggestions])



  const analytics: WhatsAppAnalytics = useMemo(() => {
    const byHour: Record<string, number> = {}
    const now = new Date()
    messages.forEach(m => {
      const ts = new Date(m.timestamp as any)
      if (ts.toDateString() === now.toDateString()) {
        const h = ts.getHours().toString()
        byHour[h] = (byHour[h] || 0) + 1
      }
    })
    const labelCounts: Record<string, number> = {}
    contacts.forEach(c => c.labels.forEach(l => { labelCounts[l] = (labelCounts[l] || 0) + 1 }))
    const topLabels = Object.entries(labelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, count]) => ({ label, count }))
    const received = messages.filter(m => m.fromUser).length
    const sent = messages.filter(m => !m.fromUser).length
    return {
      messagesReceived: received,
      messagesSent: sent,
      uniqueContacts: contacts.length,
      responseRate: Math.min(100, Math.round((sent / Math.max(1, received)) * 100)),
      averageResponseTime: 8,
      conversionsFromWhatsApp: Math.min(100, Math.floor(sent * 0.2)),
      messagesByHour: byHour,
      topLabels
    }
  }, [messages, contacts])

  // Message helpers
  const updateMessageMeta = (id: string, patch: any) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, metadata: { ...(m.metadata || {}), ...patch } } : m))
  }
  const deleteMessage = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id))
  }
  const toggleSelectMessage = (id: string) => {
    setSelectedMessageIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const startInitialization = async () => {
    setInitializing(true)
    setGatewayState('starting')
    setGatewayMessage(null)
    // Solicitar ao backend a próxima instância livre (porta 3001..3009)
    try {
      const resp = await apiFetch('/api/wa/start', { method: 'POST' })
      if (!resp.ok) throw new Error('Falha ao iniciar instância do gateway')
      const json: any = await resp.json()
      const assignedBase = json.baseUrl as string
      if (typeof json.instance === 'number') currentInstanceRef.current = json.instance
      setBaseUrlInput(assignedBase)
      localStorage.setItem('wa.baseUrl', assignedBase)
      // detectar endpoints em paralelo (não bloqueante)
      detectEndpoints(assignedBase).then(map => {
        setEndpointMap(map as any)
        localStorage.setItem('wa.endpointMap', JSON.stringify(map))
      })
      // Disparar start/checar status, mas tolerar janela de boot: aguarda QR/CONNECTED antes de sinalizar erro
      {
        const bootDeadline = Date.now() + 30000
        let session = await startSessionAuto(assignedBase)
        if (session.state === 'ERROR' || session.state === 'UNKNOWN') {
          while (Date.now() < bootDeadline) {
            await new Promise(r => setTimeout(r, 1200))
            session = await getSessionAuto(assignedBase)
            if (session.state === 'QR' || session.state === 'CONNECTED') break
          }
        }
        if (session.qr) { setQrCode(session.qr); setGatewayState('qr') }
        if (session.state === 'CONNECTED') { setGatewayState('connected'); setGatewayMessage(session.message || 'Conectado') }
        if (session.state === 'ERROR') { setGatewayState('error'); setGatewayMessage(session.message || 'Erro ao iniciar') }
      }
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(async () => {
        const status = await getSessionAuto(assignedBase)
        if (status.state === 'CONNECTED') {
          setGatewayState('connected')
          setGatewayMessage(status.message || 'Dispositivo pareado com sucesso')
          if (pollRef.current) window.clearInterval(pollRef.current)
          // Prompt friendly name on first connect if missing
          try {
            const inst = currentInstanceRef.current || instanceFromBaseUrl(assignedBase)
            if (inst) {
              // Fetch fresh list to avoid stale state
              const resp = await apiFetch('/api/wa/instances')
              let foundName = null
              if (resp.ok) {
                const js: any = await resp.json()
                if (Array.isArray(js.instances)) {
                  const found = js.instances.find((i: any) => i.instance === inst)
                  foundName = found?.name || null
                }
              }
              if (!foundName) {
                const desired = window.prompt('Defina um nome para esta conta do WhatsApp (aparece na lista de hosts):', '')
                if (desired && desired.trim()) {
                  await apiFetch(`/api/wa/instances/${inst}/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: desired.trim() }) })
                  await loadInstances()
                  toast.success('Nome da conta salvo')
                }
              }
            }
          } catch { /* ignore naming prompt errors */ }
        } else if (status.state === 'QR') {
          if (status.qr && status.qr !== qrCode) setQrCode(status.qr)
          setGatewayState('qr')
        } else if (status.state === 'ERROR') {
          setGatewayState('error')
          setGatewayMessage(status.message || 'Erro desconhecido')
        }
      }, 5000) as any
    } catch (e: any) {
      setGatewayState('error')
      setGatewayMessage(e.message || 'Falha ao iniciar gateway')
    } finally {
      setInitializing(false)
    }
  }

  // Force sync: ensure session is connected; if not, guide to QR pairing
  const forceSync = async () => {
    try {
      setIsSyncing(true)
      if (!baseUrlInput) {
        await startInitialization()
        return
      }
      const status = await getSessionAuto(baseUrlInput)
      if (status.state === 'CONNECTED') {
        // Reset hydration state to force a complete reload
        hydratedRef.current = false
        lastPollRef.current = null
        setLastPoll(null)
        setConsecutiveErrors(0)
        setGatewayState('connected')
        setGatewayMessage(status.message || 'Conectado')
        setQrCode(null)

        // 1) Reload chats
        const chats = await fetchChatsAuto(baseUrlInput)
        const normalized: WhatsAppContact[] = Array.isArray(chats) ? chats.slice(0, 400).map((c: any) => {
          const id = c.id || c.chatId || c.jid || c.remoteJid || c.number || c.contact || 'chat_' + Math.random()
          const phone = (id || '').replace(/@c\.us$/, '')
          return {
            id,
            name: c.name || c.pushName || phone,
            phone,
            avatar: undefined,
            lastSeen: new Date(),
            isOnline: false,
            labels: ['whatsapp'],
            customFields: {},
            totalMessages: c.messagesCount || 0,
            firstContactDate: new Date()
          }
        }) : []
        setContacts(normalized)

        // 2) Reload flags (pinned/archived/unread)
        try {
          const flags = await fetchChatFlagsAuto(baseUrlInput)
          // Try to fetch precise unread counts from gateway (if supported)
          try {
            const counts = await fetchUnreadCountsAuto(baseUrlInput)
            if (counts && Object.keys(counts).length) {
              setUnreadCounts(prev => ({ ...prev, ...counts }))
            }
          } catch { /* ignore */ }
          if (flags) {
            setPinnedChats(new Set(flags.pinned))
            setArchivedChats(new Set(flags.archived))
            const unreadArr = Array.from(flags.unread || []) as string[]
            setUnreadChats(new Set(unreadArr))
            setUnreadCounts(prev => {
              const out = { ...prev }
              unreadArr.forEach(id => { out[id] = Math.max(1, Number(out[id] || 0)) })
              Object.keys(out).forEach(k => { if (!unreadArr.includes(k)) out[k] = 0 })
              return out
            })
          }
        } catch { /* ignore */ }

        // 3) Reload all messages (or as many as backend returns)
        try {
          const allMsgs = await fetchMessagesAuto(baseUrlInput, undefined)
          const mapped: WhatsAppMessage[] = Array.isArray(allMsgs) ? allMsgs.map((m: any) => ({
            id: m.id || `msg_${m.timestamp || Date.now()}`,
            conversationId: m.from,
            type: 'text',
            content: m.text || '',
            timestamp: new Date(m.timestamp || Date.now()),
            status: 'read',
            fromUser: true,
            metadata: { sentiment: computeSentiment(m.text || '') }
          })) : []
          mapped.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
          setMessages(mapped)
          // Update lastPoll from the last message timestamp
          const latest = mapped.length ? mapped[mapped.length - 1].timestamp.toISOString() : null
          lastPollRef.current = latest
          setLastPoll(latest)
        } catch { /* ignore messages reload errors */ }

        // 4) Prefetch avatars fresh
        try {
          const idsToFetch = new Set((normalized || []).map(n => n.id))
          // Revoke and clear cached object URLs
          try {
            Object.values(lastAvatarObjectUrlsRef.current || {}).forEach(u => { if (u && u.startsWith('blob:')) { try { URL.revokeObjectURL(u) } catch { /* ignore */ } } })
          } catch { /* ignore */ }
          lastAvatarObjectUrlsRef.current = {}
          avatarCacheRef.current = {}

          const list = (contactsRef.current || []).filter(c => idsToFetch.has(c.id))
          const concurrency = 4
          let idx = 0
          const runNext = async () => {
            const item = list[idx++]
            if (!item) return
            try {
              const key = item.phone || item.id
              const url = await fetchAvatarAuto(baseUrlInput!, key)
              if (url) {
                if (url.startsWith('blob:')) lastAvatarObjectUrlsRef.current[item.id] = url
                setContacts(prev => prev.map(p => p.id === item.id ? { ...p, avatar: url } : p))
              }
            } catch { /* ignore */ }
            await runNext()
          }
          await Promise.all(Array.from({ length: concurrency }).map(() => runNext()))
        } catch { /* ignore avatars */ }

        toast.success('Sincronização completa: conversas, mensagens e imagens atualizadas')
        return
      }
      if (status.state === 'QR') {
        setQrCode(status.qr || null)
        setGatewayState('qr')
        toast.message('Escaneie o QR para conectar')
        return
      }
      await startInitialization()
    } catch {
      await startInitialization()
    } finally {
      setIsSyncing(false)
    }
  }

  useEffect(() => {
    if (gatewayState === 'connected' && !whatsapp.connected && baseUrlInput) {
      connectWhatsApp(baseUrlInput)
    }
  }, [gatewayState, whatsapp.connected, connectWhatsApp, baseUrlInput])

  // Periodically refresh instances list
  useEffect(() => {
    loadInstances()
    // Add a small jitter to avoid alignment with other 10s polls
    const tick = () => loadInstances()
    const t = window.setInterval(tick, 10000 + Math.floor(Math.random() * 500))
    return () => { window.clearInterval(t) }
  }, [loadInstances])

  const handleDisconnectAll = useCallback(async () => {
    // Disconnect current app state and free the host
    const inst = currentInstanceRef.current || instanceFromBaseUrl(baseUrlInput)
    try {
      if (inst) {
        await stopInstance(inst)
        try { await apiFetch(`/api/wa/instances/${inst}/name`, { method: 'DELETE' }) } catch { /* ignore */ }
      }
    } catch (e: any) { toast.error('Falha ao liberar host: ' + (e?.message || 'erro')) }
    try { disconnectWhatsApp() } catch { /* ignore */ }
    setGatewayState('idle')
    setGatewayMessage(null)
    setQrCode(null)
    setBaseUrlInput(null)
    try { localStorage.removeItem('wa.baseUrl') } catch { }
    setDesiredPort('auto')
    await loadInstances()
    toast.message('Conta desconectada; host liberado')
  }, [baseUrlInput, disconnectWhatsApp, loadInstances, stopInstance])

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current) }, [])
  // Cleanup object URLs when component unmounts
  useEffect(() => {
    return () => {
      try {
        Object.values(lastAvatarObjectUrlsRef.current || {}).forEach(u => { if (u && u.startsWith('blob:')) { try { URL.revokeObjectURL(u) } catch { /* ignore */ } } })
      } catch { /* ignore */ }
    }
  }, [])

  // Auto-select first free port when not connected and user hasn't chosen one yet
  useEffect(() => {
    if (whatsapp.connected) return
    if (desiredPort !== 'auto') return
    const free = waInstances.find(i => !i.alive)
    if (free) setDesiredPort(3000 + free.instance)
  }, [waInstances, whatsapp.connected, desiredPort])

  // Derived selection helpers for instance picker
  const selectedInst = useMemo(() => (desiredPort !== 'auto' ? (Number(desiredPort) - 3000) : null), [desiredPort])
  const selectedRec = useMemo(() => (selectedInst ? (waInstances.find(i => i.instance === selectedInst) || null) : null), [selectedInst, waInstances])
  const selectedIsConnected = !!(selectedRec && selectedRec.alive && selectedRec.ready)

  // Store not-connected UI in a variable to avoid early return
  const notConnectedUI = (
      <div className="space-y-8 animate-fade-in">
        <div className="text-center md:text-left">
          <h2 className="text-3xl font-bold text-white flex items-center justify-center md:justify-start gap-3 mb-3">
            <div className="relative">
              <WhatsappLogo className="h-8 w-8 text-green-400" />
              <div className="absolute -inset-1 bg-green-400/20 rounded-full blur opacity-75 animate-pulse"></div>
            </div>
            Conectar WhatsApp Business
          </h2>
          <p className="text-blue-300/80 max-w-2xl text-base leading-relaxed">
            Inicie seu gateway local de WhatsApp para capturar QR, parear o dispositivo e começar a sincronizar conversas.
          </p>
        </div>
        <Card className="max-w-4xl glass-morphism border-white/20 shadow-premium">
          <CardHeader className="pb-6">
            <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
              Primeira Conexão
            </CardTitle>
            <CardDescription className="text-blue-300/70 text-base">
              Clique em "Iniciar Conexão" para iniciar automaticamente o gateway na próxima porta livre (3001, 3002, ...).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="glass-morphism-dark rounded-xl p-6 border border-white/10">
              <ol className="list-decimal list-inside space-y-3 text-blue-100/90 text-base leading-relaxed">
                <li className="pl-2">Clique em "Iniciar Conexão" para iniciar o gateway local e capturar o QR.</li>
                <li className="pl-2">Escaneie o QR no app (Menu &gt; Aparelhos conectados) até status CONNECTED.</li>
                <li className="pl-2">Endpoints detectados serão cacheados para otimizar chamadas subsequentes.</li>
              </ol>
            </div>
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex gap-3 items-center">
                <Select value={String(desiredPort)} onValueChange={(v) => setDesiredPort(v === 'auto' ? 'auto' : Number(v))}>
                  <SelectTrigger className="w-[280px] glass-morphism border-white/20 text-white bg-white/[0.05] hover:bg-white/[0.08] transition-all duration-300">
                    <SelectValue placeholder="Escolha a Conta" className="text-white" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">🔎 Auto (próxima livre)</SelectItem>
                    {[3001, 3002, 3004, 3005, 3006, 3007, 3008, 3009].map(p => {
                      const inst = p - 3000
                      const rec = waInstances.find(i => i.instance === inst)
                      const disable = false // permitir selecionar contas conectadas para anexar
                      const emoji = rec ? (rec.alive ? (rec.ready ? '🟢' : '🟡') : '⚪️') : '⚪️'
                      const statusText = rec ? (rec.alive ? (rec.ready ? 'Conectada' : (rec.status || 'Iniciando')) : 'Livre') : 'Livre'
                      const qrHint = rec && rec.alive && !rec.ready && ((rec.status || '').toLowerCase().includes('qr')) ? ' • QR' : ''
                      const namePart = rec && rec.name ? ` • ${rec.name}` : ''
                      return (
                        <SelectItem key={p} value={String(p)} disabled={disable}>
                          {emoji} Conta {inst} — {statusText}{qrHint}{namePart}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <Button
                  variant={(gatewayState === 'starting' || gatewayState === 'qr' || gatewayState === 'connected') ? 'destructive' : 'default'}
                  className={`
                    px-6 py-3 font-semibold transition-all duration-300 transform hover:scale-105 
                    ${(gatewayState === 'starting' || gatewayState === 'qr' || gatewayState === 'connected') 
                      ? 'glass-morphism border-red-500/30 hover:border-red-400/50 text-white hover:bg-red-500/10' 
                      : 'glass-morphism border-green-500/30 hover:border-green-400/50 text-white hover:bg-green-500/10 shadow-premium'
                    }
                  `}
                  onClick={async () => {
                    const isActive = gatewayState === 'starting' || gatewayState === 'qr' || gatewayState === 'connected'
                    if (isActive) {
                      try {
                        const inst = currentInstanceRef.current || (desiredPort !== 'auto' ? (desiredPort - 3000) : null)
                        if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null }
                        if (inst) {
                          try { await apiFetch(`/api/wa/instances/${inst}/force-clean`, { method: 'POST' }) } catch { /* ignore */ }
                          await stopInstance(inst)
                        }
                        setGatewayState('idle')
                        setGatewayMessage(null)
                        setQrCode(null)
                        setQrDataUrl(null)
                        setLastGatewayStatus(null)
                        setBaseUrlInput(null)
                        try { localStorage.removeItem('wa.baseUrl') } catch { /* ignore */ }
                        hydratedRef.current = false
                        lastPollRef.current = null
                        toast.message('Conexão abortada')
                        await loadInstances()
                      } catch {
                        toast.error('Falha ao parar conexão')
                      }
                      return
                    }
                    // Acessar Canal: se a conta selecionada já está conectada, apenas anexar e ir ao dashboard, sem fluxo de QR
                    if (!isActive && selectedIsConnected && selectedInst) {
                      try {
                        await attachToInstance(selectedInst)
                        setActiveTab('conversations')
                      } catch { /* ignore */ }
                      return
                    }
                    if (initializing) return
                    setInitializing(true)
                    setGatewayState('starting')
                    connectedToastRef.current = false
                    try {
                      let assignedBase: string | null = null
                      let instNumber: number | null = null
                      if (desiredPort === 'auto') {
                        const resp = await apiFetch('/api/wa/start', { method: 'POST' })
                        if (!resp.ok) {
                          let detail = 'Falha ao iniciar instância do gateway'
                          try { const j: any = await resp.json(); detail = j?.detail || j?.error || detail } catch { /* ignore */ }
                          throw new Error(detail)
                        }
                        const json: any = await resp.json(); assignedBase = json.baseUrl; instNumber = json.instance
                      } else {
                        const inst = desiredPort - 3000
                        // Preselect instance so logs can target it if start fails
                        currentInstanceRef.current = inst
                        const rec = waInstances.find(i => i.instance === inst)
                        if (rec && rec.alive) {
                          // Já existe uma instância viva: anexar
                          assignedBase = `http://localhost:${3000 + inst}`
                          instNumber = inst
                        } else {
                          // Pre-clean to avoid EADDRINUSE when a stray process holds the port
                          try { await apiFetch(`/api/wa/instances/${inst}/force-clean`, { method: 'POST' }) } catch { /* ignore */ }
                          const resp = await apiFetch(`/api/wa/start/${inst}`, { method: 'POST' })
                          if (!resp.ok) {
                            let detail = 'Falha ao iniciar instância específica'
                            try { const j: any = await resp.json(); detail = j?.detail || j?.error || detail } catch { /* ignore */ }
                            throw new Error(detail)
                          }
                          const json: any = await resp.json(); assignedBase = json.baseUrl; instNumber = json.instance
                        }
                      }
                      if (!assignedBase) throw new Error('Sem baseUrl')
                      if (typeof instNumber === 'number') currentInstanceRef.current = instNumber
                      setBaseUrlInput(assignedBase)
                      localStorage.setItem('wa.baseUrl', assignedBase)
                      detectEndpoints(assignedBase).then(map => {
                        setEndpointMap(map as any)
                        localStorage.setItem('wa.endpointMap', JSON.stringify(map))
                      })
                      // Tolerar janela de boot do gateway: aguarda QR/CONNECTED antes de sinalizar erro
                      {
                        const bootDeadline = Date.now() + 30000
                        let session = await startSessionAuto(assignedBase)
                        setLastGatewayStatus(session.raw || null)
                        if (session.state === 'ERROR' || session.state === 'UNKNOWN') {
                          while (Date.now() < bootDeadline) {
                            await new Promise(r => setTimeout(r, 1200))
                            session = await getSessionAuto(assignedBase)
                            setLastGatewayStatus(session.raw || null)
                            if (session.state === 'QR' || session.state === 'CONNECTED') break
                          }
                        }
                        if (session.qr) { setQrCode(session.qr); setGatewayState('qr') }
                        if (session.state === 'CONNECTED') {
                          setGatewayState('connected'); setGatewayMessage(session.message || 'Conectado')
                          const port = portFromBaseUrl(assignedBase)
                          if (!connectedToastRef.current && port) { toast.success(`Conectado na porta :${port}`); connectedToastRef.current = true }
                        }
                        if (session.state === 'ERROR') { setGatewayState('error'); setGatewayMessage(session.message || 'Erro ao iniciar') }
                      }
                      if (pollRef.current) window.clearInterval(pollRef.current)
                      pollRef.current = window.setInterval(async () => {
                        const status = await getSessionAuto(assignedBase!)
                        setLastGatewayStatus(status.raw || null)
                        if (status.state === 'CONNECTED') {
                          setGatewayState('connected')
                          setGatewayMessage(status.message || 'Dispositivo pareado com sucesso')
                          const port = portFromBaseUrl(assignedBase)
                          if (!connectedToastRef.current && port) { toast.success(`Conectado na porta :${port}`); connectedToastRef.current = true }
                          if (pollRef.current) window.clearInterval(pollRef.current)
                        } else if (status.state === 'QR') {
                          if (status.qr && status.qr !== qrCode) setQrCode(status.qr)
                          setGatewayState('qr')
                        } else if (status.state === 'ERROR') {
                          setGatewayState('error')
                          setGatewayMessage(status.message || 'Erro desconhecido')
                        }
                      }, 5000) as any
                    } catch (e: any) {
                      const msg = e?.message || 'Falha ao iniciar gateway'
                      setGatewayState('error')
                      setGatewayMessage(msg)
                      toast.error(`Erro ao iniciar: ${msg}`)
                    } finally {
                      setInitializing(false)
                    }
                  }} disabled={false}>
                  {gatewayState === 'starting' || gatewayState === 'qr' || gatewayState === 'connected' ? 'Parar Conexão' : (selectedIsConnected ? 'Acessar Canal' : 'Iniciar Conexão')}
                </Button>
                {(!whatsapp.connected && selectedIsConnected && selectedInst) && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await apiFetch(`/api/wa/instances/${selectedInst}/force-clean`, { method: 'POST' })
                        toast.message('Conta desconectada')
                        await loadInstances()
                      } catch {
                        toast.error('Falha ao desconectar conta')
                      }
                    }}
                  >
                    Desconectar Conta
                  </Button>
                )}
                {gatewayState === 'starting' && (
                  <Badge variant="secondary" className="glass-morphism border-yellow-500/30 text-yellow-300 bg-yellow-500/10 animate-pulse">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-yellow-400 animate-spin border border-yellow-500"></div>
                      Inicializando...
                    </div>
                  </Badge>
                )}
                {gatewayState === 'connected' && (
                  <Badge variant="default" className="glass-morphism border-green-500/30 text-green-300 bg-green-500/10 shadow-premium">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                      Pronto
                    </div>
                  </Badge>
                )}
                <Button 
                  variant="ghost" 
                  disabled={initializing} 
                  className="glass-morphism border-white/10 text-blue-300 hover:text-white hover:bg-white/[0.05] transition-all duration-300"
                  onClick={async () => {
                  try {
                    const inst = (currentInstanceRef.current) || (desiredPort !== 'auto' ? (desiredPort - 3000) : null)
                    if (!inst) { toast.message('Selecione uma porta ou inicie para capturar logs'); return }
                    const res = await apiFetch(`/api/wa/instances/${inst}/logs?lines=600`)
                    let txt = ''
                    try { txt = await res.text() } catch { /* ignore */ }
                    const display = (txt && txt.trim()) ? txt : `(${res.status}) Sem logs`
                    setLogsText(display)
                    setLogsOpen(true)
                  } catch { toast.error('Falha ao obter logs') }
                }}>Ver logs</Button>
              </div>
              {/* Base URL display deprecated: we only show local port now */}
            </div>
            {gatewayState === 'starting' && (
              <div className="glass-morphism rounded-xl p-8 flex flex-col items-center gap-6 border border-white/20 shadow-premium animate-fade-in">
                <div className="w-64 h-64 flex items-center justify-center glass-morphism-dark rounded-xl border border-white/10">
                  <div className="flex items-center gap-3 text-blue-200">
                    <div className="relative">
                      <span className="inline-block w-6 h-6 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                      <div className="absolute inset-0 rounded-full bg-blue-400/20 animate-pulse"></div>
                    </div>
                    <span className="font-medium">Aguardando QR...</span>
                  </div>
                </div>
                {baseUrlInput && (
                  <div className="text-xs text-blue-300/70 font-medium">Conta: {instanceFromBaseUrl(baseUrlInput) || '—'}</div>
                )}
                {lastGatewayStatus && (
                  <div className="text-xs text-blue-300/70 font-medium">
                    Status: {String((lastGatewayStatus.status || lastGatewayStatus.state || 'starting'))}
                    {lastGatewayStatus.qrRequired ? ' • QR requerido' : ''}
                  </div>
                )}
                <div className="flex items-center gap-3 text-sm text-blue-200">
                  <div className={`w-3 h-3 rounded-full ${gatewayState === 'starting' ? 'bg-yellow-400 animate-pulse shadow-yellow-400/50 shadow-lg' : 'bg-gray-400'}`}></div>
                  <span className="font-medium">Inicializando</span>
                </div>
              </div>
            )}
            {gatewayState === 'qr' && (
              <div className="glass-morphism rounded-xl p-8 flex flex-col items-center gap-6 border border-white/20 shadow-premium animate-fade-in">
                <div className="text-base text-blue-200 font-medium text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <WhatsappLogo className="h-5 w-5 text-green-400" />
                    Escaneie o QR no app WhatsApp
                  </div>
                  <div className="text-sm text-blue-300/70">Menu → Aparelhos Conectados → Conectar novo aparelho</div>
                </div>
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="QR Code" className="w-60 h-60 object-contain bg-white p-2 rounded" />
                ) : qrCode ? (
                  <div className="w-60 h-60 flex items-center justify-center text-xs bg-white rounded">Gerando QR...</div>
                ) : (
                  <div className="w-60 h-60 flex flex-col items-center justify-center text-xs bg-white rounded p-2 text-center">
                    <div className="mb-2">QR disponível no gateway.</div>
                    {baseUrlInput && (
                      <a className="text-blue-600 underline" href={`${baseUrlInput.replace(/\/$/, '')}/qr.html`} target="_blank" rel="noreferrer">
                        Abrir {baseUrlInput.replace(/\/$/, '')}/qr.html
                      </a>
                    )}
                  </div>
                )}
                {baseUrlInput && (
                  <div className="text-[11px] text-muted-foreground">Conta: {instanceFromBaseUrl(baseUrlInput) || '—'}</div>
                )}
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <div className={`w-2 h-2 rounded-full ${gatewayState === 'qr' ? 'bg-yellow-500 animate-pulse' : gatewayState === 'connected' ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                  <span>{gatewayState === 'qr' ? 'Aguardando pareamento...' : gatewayState === 'connected' ? 'Conectado' : 'Status'}</span>
                </div>
              </div>
            )}
            {gatewayState === 'error' && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">Erro no gateway: {gatewayMessage}</div>
            )}
            {/* Force-clean is automatic in backend on start failure; no button needed here */}
            <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Logs do gateway {currentInstanceRef.current ? `(instância ${currentInstanceRef.current})` : ''}</DialogTitle>
                  <DialogDescription>Últimas linhas do log da instância selecionada.</DialogDescription>
                </DialogHeader>
                <div className="h-96 overflow-auto bg-black text-green-200 rounded p-3 text-[11px] whitespace-pre-wrap">
                  {logsText || 'Sem logs disponíveis'}
                </div>
              </DialogContent>
            </Dialog>
            {/* Instances grid removed: selector above shows full status */}
            <div className="text-xs text-muted-foreground border-t pt-4 space-y-1">
              <div>Dica: se o QR expirar, clique novamente em "Iniciar Conexão".</div>
              {Object.keys(endpointMap).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(endpointMap).map(([k, v]) => (
                    <span key={k} className="px-2 py-0.5 bg-muted rounded border text-[10px]">{k}:{v}</span>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )

  // Conditional rendering moved to end to avoid hooks violation
  if (!whatsapp.connected) {
    return notConnectedUI
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <WhatsappLogo className="h-6 w-6 text-green-600" />
            <span>WhatsApp Business</span>
          </h2>
          <p className="text-muted-foreground">
            Central de atendimento e automação para WhatsApp Business
          </p>
        </div>
        <div className="flex space-x-2 items-center">
          <TooltipLabel
            label="Modo global da IA"
            description={aiSuppressed && aiResumeAt ? `IA pausada até ${new Date(aiResumeAt).toLocaleString('pt-BR')}` : 'Define como a IA opera em todo o módulo.'}
          >
            <Badge 
              variant="outline" 
              className={`glass-morphism border-white/20 font-medium transition-all duration-300 ${
                aiSuppressed 
                  ? 'border-red-500/30 text-red-300 bg-red-500/10' 
                  : aiMode === 'auto'
                    ? 'border-green-500/30 text-green-300 bg-green-500/10'
                    : aiMode === 'assist'
                      ? 'border-yellow-500/30 text-yellow-300 bg-yellow-500/10'
                      : 'border-gray-500/30 text-gray-300 bg-gray-500/10'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  aiSuppressed ? 'bg-red-400' : aiMode === 'auto' ? 'bg-green-400 animate-pulse' : aiMode === 'assist' ? 'bg-yellow-400' : 'bg-gray-400'
                }`}></div>
                IA {aiSuppressed ? 'Pausada' : aiMode === 'auto' ? 'Ativa' : aiMode === 'assist' ? 'Assistida' : 'Desligada'}
              </div>
            </Badge>
          </TooltipLabel>
          <TooltipButton label="Gerenciar conexões de contas WhatsApp">
            <Button 
              variant="outline" 
              onClick={() => setIsConnectionsOpen(true)} 
              className="glass-morphism border-white/20 text-blue-300 hover:text-white hover:bg-white/[0.05] transition-all duration-300 hover:scale-105"
            >
              Gerenciar Conexões
            </Button>
          </TooltipButton>
          <TooltipButton label="Alternar IA (global)">
            <Button
              variant="ghost"
              size="icon"
              className={`${aiMode === 'auto' ? 'bg-green-100 hover:bg-green-200' : aiMode === 'assist' ? 'bg-amber-100 hover:bg-amber-200' : 'bg-muted'} rounded-full`}
              onClick={() => {
                const modes: typeof aiMode[] = ['auto', 'assist', 'off']
                const idx = modes.indexOf(aiMode)
                setAiMode(modes[(idx + 1) % modes.length])
              }}
            >
              <Robot className={`h-4 w-4 ${aiMode === 'off' ? 'text-muted-foreground' : 'text-foreground'}`} />
            </Button>
          </TooltipButton>
          {!whatsapp.connected && (
            <div className="flex items-center space-x-2">
              <Button variant="outline" onClick={startInitialization} disabled={initializing}>
                {initializing ? 'Inicializando...' : 'Conectar'}
              </Button>
            </div>
          )}
          {whatsapp.connected && (
            <div className="flex items-center space-x-2 text-xs">
              <Button size="sm" variant="outline" disabled={isSyncing} onClick={forceSync} className={isSyncing ? 'border-green-600 text-green-700 animate-pulse' : ''}>
                {isSyncing && <span className="inline-block w-3 h-3 mr-2 rounded-full border-2 border-green-600 border-t-transparent animate-spin align-middle" />}
                Sync
              </Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                // Explicit disconnect should also reset the underlying session
                const inst = currentInstanceRef.current || (desiredPort !== 'auto' ? (desiredPort - 3000) : null)
                try {
                  if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null }
                  if (eventsRef.current) { try { eventsRef.current.close() } catch { /* ignore */ } eventsRef.current = null }
                  if (suppressionEventsRef.current) { try { suppressionEventsRef.current.close() } catch { /* ignore */ } suppressionEventsRef.current = null }
                  if (inst) {
                    try { await apiFetch(`/api/wa/instances/${inst}/force-clean`, { method: 'POST' }) } catch { /* ignore */ }
                    await stopInstance(inst)
                  }
                } catch { /* ignore */ }
                try { disconnectWhatsApp() } catch { /* ignore */ }
                setGatewayState('idle')
                setGatewayMessage(null)
                setQrCode(null)
                setQrDataUrl(null)
                setLastGatewayStatus(null)
                setBaseUrlInput(null)
                try { localStorage.removeItem('wa.baseUrl') } catch { /* ignore */ }
                try { localStorage.removeItem('wa.endpointMap') } catch { /* ignore */ }
                hydratedRef.current = false
                lastPollRef.current = null
                currentInstanceRef.current = null
                setDesiredPort('auto')
                setSelectedContact(null)
                await loadInstances()
                toast.message('Desconectado. Ao reconectar será necessário escanear o QR novamente.')
              }}>Desconectar</Button>
            </div>
          )}
          <TooltipButton label="Exportar contatos e mensagens">
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </Button>
          </TooltipButton>
          <Dialog open={isNewConvOpen} onOpenChange={setIsNewConvOpen}>
            <DialogTrigger asChild>
              <TooltipButton label="Criar nova conversa">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Conversa
                </Button>
              </TooltipButton>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Nova conversa</DialogTitle>
                <DialogDescription>Informe os dados do contato</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Nome</Label>
                  <Input value={newConvName} onChange={e => setNewConvName(e.target.value)} placeholder="Nome do contato (opcional)" />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input value={newConvPhone} onChange={e => setNewConvPhone(e.target.value)} placeholder="ex: +5511999999999" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setIsNewConvOpen(false)}>Cancelar</Button>
                  <Button onClick={createNewConversation}>Criar</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
        <TabsList className="grid grid-cols-6 w-full max-w-4xl glass-morphism p-2 border-white/20 shadow-premium">
          <TabsTrigger 
            value="conversations" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            <div className="flex items-center gap-2">
              <span>Conversas</span>
              {globalUnreadCount > 0 && (
                <Badge variant="secondary" className="glass-morphism border-green-500/30 text-green-300 bg-green-500/10 animate-pulse text-xs px-2 py-0">
                  {globalUnreadCount}
                </Badge>
              )}
            </div>
          </TabsTrigger>
          <TabsTrigger 
            value="templates" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Templates
          </TabsTrigger>
          <TabsTrigger 
            value="broadcasts" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Broadcasts
          </TabsTrigger>
          <TabsTrigger 
            value="analytics" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Analytics
          </TabsTrigger>
          <TabsTrigger 
            value="automation" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Automação
          </TabsTrigger>
          <TabsTrigger 
            value="channels" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Canais
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversations" className="space-y-6">
          <SimpleErrorBoundary onReset={() => { /* keep user on this tab; nothing else */ }}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
              {/* Contacts List */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      {globalUnreadCount > 0 && (
                        <TooltipLabel label="Mensagens não lidas no total">
                          <Badge variant="secondary">Não lidas: {globalUnreadCount}</Badge>
                        </TooltipLabel>
                      )}
                      <TooltipLabel label="Total de conversas">
                        <Badge variant="outline">Total: {contacts.length}</Badge>
                      </TooltipLabel>
                      {/* Badges de filtros ativos */}
                      {!!contactsSearch.trim() && (
                        <TooltipLabel label="Filtro de texto">
                          <Badge variant="secondary">Filtro: “{contactsSearch.trim()}”</Badge>
                        </TooltipLabel>
                      )}
                      {globalSearchParams.tag && (
                        <TooltipLabel label="Etiqueta aplicada">
                          <Badge variant="secondary">Tag: {globalSearchParams.tag}</Badge>
                        </TooltipLabel>
                      )}
                      {globalSearchParams.has && (
                        <TooltipLabel label="Possui tipo">
                          <Badge variant="secondary">has: {globalSearchParams.has}</Badge>
                        </TooltipLabel>
                      )}
                      {globalSearchParams.type && (
                        <TooltipLabel label="Tipo de mensagem">
                          <Badge variant="secondary">type: {globalSearchParams.type}</Badge>
                        </TooltipLabel>
                      )}
                      {globalSearchParams.phone && (
                        <TooltipLabel label="Telefone filtrado">
                          <Badge variant="secondary">phone: {globalSearchParams.phone}</Badge>
                        </TooltipLabel>
                      )}
                      {(globalSearchParams.after || globalSearchParams.before) && (
                        <TooltipLabel label="Janela de data">
                          <Badge variant="secondary">
                            {globalSearchParams.after ? `≥ ${globalSearchParams.after}` : ''}
                            {globalSearchParams.after && globalSearchParams.before ? ' • ' : ''}
                            {globalSearchParams.before ? `≤ ${globalSearchParams.before}` : ''}
                          </Badge>
                        </TooltipLabel>
                      )}
                    </div>
                    {/* espaço à direita mantido vazio deliberadamente */}
                    <span />
                  </CardTitle>
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <Input placeholder="Buscar... (nome, telefone, etiqueta ou frase)" value={contactsSearch} onChange={(e) => {
                        setContactsSearch(e.target.value)
                        filteringActivityRef.current = true
                        if (filterIdleTimerRef.current) { window.clearTimeout(filterIdleTimerRef.current); filterIdleTimerRef.current = null }
                        filterIdleTimerRef.current = window.setTimeout(() => { filteringActivityRef.current = false }, 600)
                      }} />
                      <TooltipButton label="Sincronizar agora">
                        <Button variant="outline" size="sm" onClick={() => forceSync()} disabled={isSyncing}>
                          {isSyncing ? (
                            <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" /> Sync</span>
                          ) : 'Sync'}
                        </Button>
                      </TooltipButton>
                      <TooltipButton label="Abrir filtros">
                        <Button variant="outline" size="sm" onClick={() => {
                          setFilterForm({ ...globalSearchParams, q: contactsSearch })
                          setIsFilterDialogOpen(true)
                        }}>Filtrar</Button>
                      </TooltipButton>
                      <TooltipButton label={`Ordenar (${globalSort === 'recente' ? 'mais recentes' : 'mais antigos'})`}>
                        <Button variant="outline" size="sm" onClick={() => setIsOrderDialogOpen(true)}>Ordenar</Button>
                      </TooltipButton>
                    </div>
                  </div>
                </CardHeader>
                {/* Filter dialog */}
                <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Filtrar resultados</DialogTitle>
                      <DialogDescription>Defina os critérios e aplique para ver os resultados da busca global.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="f-q">Texto (q)</Label>
                        <Input id="f-q" value={filterForm.q || ''} onChange={(e) => setFilterForm(f => ({ ...f, q: e.target.value }))} placeholder="nome, telefone ou frase" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="f-phone">Telefone</Label>
                          <Input id="f-phone" value={filterForm.phone || ''} onChange={(e) => setFilterForm(f => ({ ...f, phone: e.target.value }))} placeholder="ex: 5511999999999" />
                        </div>
                        <div>
                          <Label htmlFor="f-tag">Etiqueta (tag)</Label>
                          <Input id="f-tag" value={filterForm.tag || ''} onChange={(e) => setFilterForm(f => ({ ...f, tag: e.target.value }))} placeholder="vip, suporte..." />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="f-has">Possui (has)</Label>
                          <Input id="f-has" value={filterForm.has || ''} onChange={(e) => setFilterForm(f => ({ ...f, has: e.target.value }))} placeholder="media, image, video, audio..." />
                        </div>
                        <div>
                          <Label htmlFor="f-type">Tipo (type)</Label>
                          <Input id="f-type" value={filterForm.type || ''} onChange={(e) => setFilterForm(f => ({ ...f, type: e.target.value }))} placeholder="text, image, ..." />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="f-after">Depois de (after)</Label>
                          <Input id="f-after" value={filterForm.after || ''} onChange={(e) => setFilterForm(f => ({ ...f, after: e.target.value }))} placeholder="ISO ou epoch" />
                        </div>
                        <div>
                          <Label htmlFor="f-before">Antes de (before)</Label>
                          <Input id="f-before" value={filterForm.before || ''} onChange={(e) => setFilterForm(f => ({ ...f, before: e.target.value }))} placeholder="ISO ou epoch" />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setIsFilterDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={() => {
                          setGlobalSearchParams(p => ({ ...p, ...filterForm }))
                          setSearchMode('global')
                          performGlobalSearch({ ...filterForm, page: 1, pageSize: globalPageSize, sort: globalSort })
                          setIsFilterDialogOpen(false)
                        }}>Aplicar</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Order dialog */}
                <Dialog open={isOrderDialogOpen} onOpenChange={setIsOrderDialogOpen}>
                  <DialogContent className="max-w-sm">
                    <DialogHeader>
                      <DialogTitle>Ordenar resultados</DialogTitle>
                      <DialogDescription>Escolha a ordem dos resultados da busca global.</DialogDescription>
                    </DialogHeader>
                    <RadioGroup value={globalSort} onValueChange={(v) => setGlobalSort((v as any) || 'recente')}>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="recente" id="ord-recente" />
                        <Label htmlFor="ord-recente">Mais recentes primeiro</Label>
                      </div>
                      <div className="flex items-center space-x-2 mt-2">
                        <RadioGroupItem value="antigo" id="ord-antigo" />
                        <Label htmlFor="ord-antigo">Mais antigos primeiro</Label>
                      </div>
                    </RadioGroup>
                    <div className="flex justify-end gap-2 pt-3">
                      <Button variant="outline" onClick={() => setIsOrderDialogOpen(false)}>Cancelar</Button>
                      <Button onClick={() => {
                        setSearchMode('global')
                        performGlobalSearch({ q: contactsSearch, page: 1, pageSize: globalPageSize, sort: globalSort })
                        setIsOrderDialogOpen(false)
                      }}>Aplicar</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <CardContent className="p-0">
                  <ScrollArea className="h-[450px]">
                    {contacts.filter(c => {
                      const term = contactsSearch.trim().toLowerCase()
                      if (!term) return true
                      const inName = (c.name || '').toLowerCase().includes(term)
                      const inPhone = (c.phone || '').toLowerCase().includes(term)
                      const inLabels = (c.labels || []).some(l => (l || '').toLowerCase().includes(term))
                      if (inName || inPhone || inLabels) return true
                      const msgs = messagesByChat[c.id] || []
                      return msgs.some(m => (m.content || '').toLowerCase().includes(term))
                    }).map((contact) => (
                      <ContextMenu key={contact.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            className={`p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors ${selectedContact === contact.id ? 'bg-muted' : ''} ${unreadChats.has(contact.id) ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => onSelectContact(e, contact.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectContact(e, contact.id) }}
                          >
                            <div className="flex items-center space-x-3">
                              <div className="relative">
                                <Avatar className="h-10 w-10">
                                  <AvatarImage src={contact.avatar} />
                                  <AvatarFallback>{contact.name.slice(0, 2)}</AvatarFallback>
                                </Avatar>
                                {contact.isOnline && (
                                  <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background"></div>
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <div className={`truncate ${unreadChats.has(contact.id) ? 'font-semibold' : 'font-medium'}`}>
                                    <span>{contact.name}</span>
                                    {pinnedChats.has(contact.id) && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 align-middle">Fixada</span>}
                                    {archivedChats.has(contact.id) && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600 align-middle">Arquivada</span>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="text-xs text-muted-foreground">
                                      {contact.isOnline ? "online" : formatLastSeen(contact.lastSeen)}
                                    </div>
                                    {((unreadCounts[contact.id] || 0) > 0 || unreadChats.has(contact.id)) && (
                                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] bg-blue-600 text-white rounded-full">
                                        {unreadCounts[contact.id] || 1}
                                      </span>
                                    )}
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button className="p-1 rounded hover:bg-muted" onClick={(e) => { e.stopPropagation(); setSelectedContact(contact.id) }} aria-label="Mais opções">
                                          <DotsThreeVertical className="h-4 w-4" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="min-w-[220px]">
                                        <DropdownMenuItem onClick={() => { setIsNotesOpen(true); setSelectedContact(contact.id) }}>{(notesByChat[contact.id]?.length || 0) > 0 ? 'Ver notas' : 'Adicionar notas'}</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => { setIsTagsOpen(true); setSelectedContact(contact.id) }}>Adicionar/editar etiquetas</DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        {archivedChats.has(contact.id) ? (
                                          <DropdownMenuItem onClick={async () => {
                                            try { if (ensureWhatsAppConnected()) await unarchiveWhatsAppChat(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                                            setArchivedChats(prev => { const s = new Set(prev); s.delete(contact.id); return s }); toast.success('Conversa desarquivada')
                                          }}>Desarquivar conversa</DropdownMenuItem>
                                        ) : (
                                          <DropdownMenuItem onClick={async () => {
                                            try { if (ensureWhatsAppConnected()) await archiveWhatsAppChat(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                                            setArchivedChats(prev => new Set(prev).add(contact.id)); toast.success('Conversa arquivada')
                                          }}>Arquivar conversa</DropdownMenuItem>
                                        )}
                                        {pinnedChats.has(contact.id) ? (
                                          <DropdownMenuItem onClick={async () => {
                                            try { if (ensureWhatsAppConnected()) await unpinWhatsAppChat(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                                            setPinnedChats(prev => { const s = new Set(prev); s.delete(contact.id); return s }); toast.success('Conversa desfixada')
                                          }}>Desfixar conversa</DropdownMenuItem>
                                        ) : (
                                          <DropdownMenuItem onClick={async () => {
                                            try { if (ensureWhatsAppConnected()) await pinWhatsAppChat(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                                            setPinnedChats(prev => new Set(prev).add(contact.id)); toast.success('Conversa fixada')
                                          }}>Fixar conversa</DropdownMenuItem>
                                        )}
                                        {unreadChats.has(contact.id) ? (
                                          <DropdownMenuItem onClick={async () => {
                                            try { if (ensureWhatsAppConnected()) await markChatSeen(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                                            setUnreadChats(prev => { const s = new Set(prev); s.delete(contact.id); return s })
                                            setUnreadCounts(prev => ({ ...prev, [contact.id]: 0 }))
                                          }}>Marcar como lida</DropdownMenuItem>
                                        ) : (
                                          <DropdownMenuItem onClick={() => { setUnreadChats(prev => new Set(prev).add(contact.id)); setUnreadCounts(prev => ({ ...prev, [contact.id]: Math.max(1, Number(prev[contact.id] || 0)) })) }}>Marcar como não lida</DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger>Notificações</DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            {([
                                              { label: '8 horas', ms: 8 * 60 * 60 * 1000, tag: '🔕8h' },
                                              { label: '24 horas', ms: 24 * 60 * 60 * 1000, tag: '🔕24h' },
                                              { label: '1 semana', ms: 7 * 24 * 60 * 60 * 1000, tag: '🔕1w' },
                                              { label: 'Indefinidamente', ms: 0, tag: '🔕' }
                                            ] as const).map(opt => (
                                              <DropdownMenuItem key={opt.label} onClick={() => {
                                                const until = opt.ms ? Date.now() + opt.ms : Number.MAX_SAFE_INTEGER
                                                setMuteUntilByChat(prev => ({ ...prev, [contact.id]: until }))
                                                setMutedChats(prev => new Set(prev).add(contact.id))
                                                setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, labels: [...(c.labels || []).filter(l => !l.startsWith('🔕')), opt.tag] } : c))
                                                toast.success(`Silenciado por ${opt.label.toLowerCase()}`)
                                              }}>
                                                {(muteUntilByChat[contact.id] && (opt.ms === 0 ? true : (muteUntilByChat[contact.id]! - Date.now()) > 0 && Math.abs((muteUntilByChat[contact.id]! - Date.now()) - opt.ms) < opt.ms * 0.05)) ? '✓ ' : ''}{opt.label}
                                              </DropdownMenuItem>
                                            ))}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => {
                                              setMuteUntilByChat(prev => ({ ...prev, [contact.id]: null }))
                                              setMutedChats(prev => { const s = new Set(prev); s.delete(contact.id); return s })
                                              setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, labels: (c.labels || []).filter(l => !l.startsWith('🔕')) } : c))
                                              toast.success('Notificações reativadas')
                                            }}>Reativar notificações</DropdownMenuItem>
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => { setIsMediaOpen(true); setSelectedContact(contact.id) }}>Mídia, links e docs</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => { setIsFavoritesOpen(true); setSelectedContact(contact.id) }}>Marcadas como favoritas</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => { setIsContactInfoOpen(true); setSelectedContact(contact.id) }}>Dados do contato</DropdownMenuItem>
                                        <DropdownMenuItem onClick={async () => {
                                          setIsCommonGroupsOpen(true);
                                          setSelectedContact(contact.id);
                                          try {
                                            if (!ensureWhatsAppConnected() || !whatsapp.baseUrl) { setCommonGroups([]); return }
                                            const key = contact.phone || contact.id
                                            const data: any = await fetchCommonGroups(whatsapp.baseUrl, key)
                                            setCommonGroups(data.groups || [])
                                          } catch { setCommonGroups([]) }
                                        }}>Grupos em comum</DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                                <div className="text-sm text-muted-foreground truncate">
                                  {contact.phone}
                                </div>
                                <div className="flex gap-1 mt-1">
                                  {contact.labels.slice(0, 2).map(label => (
                                    <Badge key={label} variant="outline" className="text-xs">
                                      {label}
                                    </Badge>
                                  ))}
                                  {contact.labels.length > 2 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{contact.labels.length - 2}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          {/* Notes */}
                          <ContextMenuItem onClick={() => { setIsNotesOpen(true); setSelectedContact(contact.id) }}>{(notesByChat[contact.id]?.length || 0) > 0 ? 'Ver notas' : 'Adicionar notas'}</ContextMenuItem>
                          {/* Labels */}
                          <ContextMenuItem onClick={() => { setIsTagsOpen(true); setSelectedContact(contact.id) }}>Adicionar/editar etiquetas</ContextMenuItem>
                          <ContextMenuSeparator />
                          {/* Archive toggle */}
                          {archivedChats.has(contact.id) ? (
                            <ContextMenuItem onClick={async () => {
                              try { if (ensureWhatsAppConnected()) await unarchiveWhatsAppChat(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                              setArchivedChats(prev => { const s = new Set(prev); s.delete(contact.id); return s }); toast.success('Conversa desarquivada')
                            }}>Desarquivar conversa</ContextMenuItem>
                          ) : (
                            <ContextMenuItem onClick={async () => {
                              try { if (ensureWhatsAppConnected()) await archiveWhatsAppChat(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                              setArchivedChats(prev => new Set(prev).add(contact.id)); toast.success('Conversa arquivada')
                            }}>Arquivar conversa</ContextMenuItem>
                          )}
                          {/* Pin toggle */}
                          {pinnedChats.has(contact.id) ? (
                            <ContextMenuItem onClick={async () => {
                              try { if (ensureWhatsAppConnected()) await unpinWhatsAppChat(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                              setPinnedChats(prev => { const s = new Set(prev); s.delete(contact.id); return s }); toast.success('Conversa desfixada')
                            }}>Desfixar conversa</ContextMenuItem>
                          ) : (
                            <ContextMenuItem onClick={async () => {
                              try { if (ensureWhatsAppConnected()) await pinWhatsAppChat(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                              setPinnedChats(prev => new Set(prev).add(contact.id)); toast.success('Conversa fixada')
                            }}>Fixar conversa</ContextMenuItem>
                          )}
                          {/* Read/unread toggle */}
                          {unreadChats.has(contact.id) ? (
                            <ContextMenuItem onClick={async () => {
                              try { if (ensureWhatsAppConnected()) await markChatSeen(whatsapp.baseUrl!, contact.id) } catch { /* ignore */ }
                              setUnreadChats(prev => { const s = new Set(prev); s.delete(contact.id); return s })
                            }}>Marcar como lida</ContextMenuItem>
                          ) : (
                            <ContextMenuItem onClick={() => { setUnreadChats(prev => new Set(prev).add(contact.id)); setUnreadCounts(prev => ({ ...prev, [contact.id]: Math.max(1, Number(prev[contact.id] || 0)) })) }}>Marcar como não lida</ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          {/* Notifications unified: mute durations + resume; add 🔕 tag and auto-expire */}
                          <ContextMenuSub>
                            <ContextMenuSubTrigger>Notificações</ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              {([
                                { label: '8 horas', ms: 8 * 60 * 60 * 1000, tag: '🔕8h' },
                                { label: '24 horas', ms: 24 * 60 * 60 * 1000, tag: '🔕24h' },
                                { label: '1 semana', ms: 7 * 24 * 60 * 60 * 1000, tag: '🔕1w' },
                                { label: 'Indefinidamente', ms: 0, tag: '🔕' }
                              ] as const).map(opt => (
                                <ContextMenuItem key={opt.label} onClick={() => {
                                  const until = opt.ms ? Date.now() + opt.ms : Number.MAX_SAFE_INTEGER
                                  setMuteUntilByChat(prev => ({ ...prev, [contact.id]: until }))
                                  setMutedChats(prev => new Set(prev).add(contact.id))
                                  setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, labels: [...(c.labels || []).filter(l => !l.startsWith('🔕')), opt.tag] } : c))
                                  toast.success(`Silenciado por ${opt.label.toLowerCase()}`)
                                }}>
                                  {(muteUntilByChat[contact.id] && (opt.ms === 0 ? true : (muteUntilByChat[contact.id]! - Date.now()) > 0 && Math.abs((muteUntilByChat[contact.id]! - Date.now()) - opt.ms) < opt.ms * 0.05)) ? '✓ ' : ''}{opt.label}
                                </ContextMenuItem>
                              ))}
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => {
                                setMuteUntilByChat(prev => ({ ...prev, [contact.id]: null }))
                                setMutedChats(prev => { const s = new Set(prev); s.delete(contact.id); return s })
                                setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, labels: (c.labels || []).filter(l => !l.startsWith('🔕')) } : c))
                                toast.success('Notificações reativadas')
                              }}>Reativar notificações</ContextMenuItem>
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSeparator />
                          {/* Media/links/docs quick access */}
                          <ContextMenuItem onClick={() => { setIsMediaOpen(true); setSelectedContact(contact.id) }}>Mídia, links e docs</ContextMenuItem>
                          <ContextMenuItem onClick={() => { setIsFavoritesOpen(true); setSelectedContact(contact.id) }}>Marcadas como favoritas</ContextMenuItem>
                          <ContextMenuItem onClick={() => { setIsContactInfoOpen(true); setSelectedContact(contact.id) }}>Dados do contato</ContextMenuItem>
                          <ContextMenuItem onClick={async () => {
                            setIsCommonGroupsOpen(true);
                            setSelectedContact(contact.id);
                            try {
                              if (!ensureWhatsAppConnected() || !whatsapp.baseUrl) { setCommonGroups([]); return }
                              const key = contact.phone || contact.id
                              const data: any = await fetchCommonGroups(whatsapp.baseUrl, key)
                              setCommonGroups(data.groups || [])
                            } catch { setCommonGroups([]) }
                          }}>Grupos em comum</ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Chat Area */}
              <div className="lg:col-span-2">
                {selectedContact ? (
                  <Card className="glass-card h-full flex flex-col">
                    <CardHeader className="border-b">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          {(() => {
                            const contact = contacts.find(c => c.id === selectedContact)
                            return (
                              <>
                                <Avatar className="h-10 w-10">
                                  <AvatarImage src={contact?.avatar} />
                                  <AvatarFallback>{contact?.name.slice(0, 2)}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <div className="font-medium">{contact?.name}</div>
                                  <div className="text-sm text-muted-foreground flex items-center space-x-2">
                                    <span>{contact?.phone}</span>
                                    {contact?.isOnline ? (
                                      <Badge variant="secondary" className="text-xs">online</Badge>
                                    ) : (
                                      <span className="text-xs">visto {formatLastSeen(contact?.lastSeen || new Date())}</span>
                                    )}
                                  </div>
                                </div>
                              </>
                            )
                          })()}
                        </div>
                        <div className="flex items-center space-x-2">
                          {/* Compact hosts dropdown in connected view */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <TooltipButton label="Hosts locais">
                                <Button variant="outline" size="sm">
                                  <span className="inline-flex items-center gap-2">
                                    <span className={`inline-block w-2 h-2 rounded-full ${waInstances.some(i => i.alive) ? (waInstances.some(i => i.ready) ? 'bg-green-500' : 'bg-yellow-500') : 'bg-gray-400'}`}></span>
                                    Hosts
                                  </span>
                                </Button>
                              </TooltipButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[260px]">
                              <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Contas 1–9 (localhost)</div>
                              <DropdownMenuSeparator />
                              {waInstances.length === 0 && (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                  <LoadingPercentText label="Carregando" showPercent={false} />
                                </div>
                              )}
                              {waInstances.map(inst => (
                                <div key={inst.instance} className="px-2 py-1.5 flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium truncate flex items-center gap-2">
                                      <span className={`inline-block w-2 h-2 rounded-full ${inst.alive ? (inst.ready ? 'bg-green-500' : 'bg-yellow-500') : 'bg-gray-400'}`}></span>
                                      <span className="truncate">{inst.name || 'Sem nome'}</span>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground truncate">{inst.alive ? (inst.ready ? 'Conectada' : (inst.status || 'Inicializando')) : 'Livre'} • Conta {inst.instance}</div>
                                    {inst.lastContactName && (
                                      <div className="text-[10px] text-muted-foreground truncate">Último: {inst.lastContactName} {inst.lastContactPhone ? `(${inst.lastContactPhone})` : ''}</div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <TooltipButton label="Renomear">
                                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => renameInstance(inst.instance, inst.name)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipButton>
                                    {inst.alive && (
                                      <TooltipButton label="Desconectar">
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => stopInstance(inst.instance)}>
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                      </TooltipButton>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <TooltipButton label="Ligar">
                            <Button variant="outline" size="sm" onClick={() => setIsCallDialogOpen(true)}>
                              <Phone className="h-4 w-4" />
                            </Button>
                          </TooltipButton>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <TooltipButton label="Ações de IA">
                                <Button variant="outline" size="sm">
                                  <Robot className="h-4 w-4" />
                                </Button>
                              </TooltipButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[220px]">
                              <DropdownMenuItem onClick={() => setAiMode('auto')}>{aiMode === 'auto' ? '✓ ' : ''}IA Automática</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setAiMode('assist')}>{aiMode === 'assist' ? '✓ ' : ''}Assistir</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setAiMode('off')}>{aiMode === 'off' ? '✓ ' : ''}Desligada</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <div className="px-2 py-1 text-[11px] text-muted-foreground">Modo desta conversa</div>
                              <DropdownMenuItem onClick={() => { if (!selectedContact) return; setAiModeByChat(prev => { const n = { ...prev }; delete n[selectedContact]; return n }) }}>{(!selectedContact || !aiModeByChat[selectedContact]) ? '✓ ' : ''}Usar modo global ({aiMode})</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { if (!selectedContact) return; setAiModeByChat(prev => ({ ...prev, [selectedContact]: 'auto' })) }}>{selectedContact && aiModeByChat[selectedContact] === 'auto' ? '✓ ' : ''}Automático</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { if (!selectedContact) return; setAiModeByChat(prev => ({ ...prev, [selectedContact]: 'assist' })) }}>{selectedContact && aiModeByChat[selectedContact] === 'assist' ? '✓ ' : ''}Assistir</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { if (!selectedContact) return; setAiModeByChat(prev => ({ ...prev, [selectedContact]: 'off' })) }}>{selectedContact && aiModeByChat[selectedContact] === 'off' ? '✓ ' : ''}Desligada</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={async () => {
                                if (!selectedContact) return
                                try {
                                  const res = await fetch(`/api/conversations/${encodeURIComponent(selectedContact)}/human-intervention`, { method: 'POST' })
                                  if (res.ok) {
                                    const j: any = await res.json(); setAiSuppressed(true); setAiResumeAt(j.suppressedUntil || null)
                                    toast.success('IA silenciada por 24h')
                                  } else throw new Error('Falha ao silenciar')
                                } catch (e: any) { toast.error(e?.message || 'Erro ao silenciar IA') }
                              }}>Transferir para humano (24h)</DropdownMenuItem>
                              {aiSuppressed && (
                                <DropdownMenuItem onClick={async () => {
                                  if (!selectedContact) return
                                  try {
                                    const res = await fetch(`/api/conversations/${encodeURIComponent(selectedContact)}/human-intervention`, { method: 'DELETE' })
                                    if (res.ok) { setAiSuppressed(false); setAiResumeAt(null); toast.success('IA reativada') }
                                  } catch { /* ignore */ }
                                }}>Retomar IA</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <DropdownMenu open={isMainMenuOpen} onOpenChange={setIsMainMenuOpen}>
                            <DropdownMenuTrigger asChild>
                              <TooltipButton label="Menu">
                                <Button variant="outline" size="sm">
                                  <List className="h-4 w-4" />
                                </Button>
                              </TooltipButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[240px]">
                              <DropdownMenuItem onClick={() => setIsNotesOpen(true)}>Adicionar notas</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setIsTagsOpen(true)}>Adicionar etiquetas</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setIsMediaOpen(true)}>Mídia, links e docs</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setIsFavoritesOpen(true)}>Marcadas como favoritas</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setIsNotificationsOpen(true)}>Notificações</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setIsContactInfoOpen(true)}>Dados do contato</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setIsCommonGroupsOpen(true)}>Grupos em comum</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => { if (!selectedContact) return; const c = contacts.find(x => x.id === selectedContact); if (!c) return; const payload = { contact: c, messages: getConversationMessages(selectedContact) }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `chat-${(c.name || c.phone)}-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url) }}>Exportar conversa</DropdownMenuItem>
                              <DropdownMenuItem onClick={async () => { if (!selectedContact || !ensureWhatsAppConnected()) return; try { await archiveWhatsAppChat(whatsapp.baseUrl!, selectedContact); toast.success('Conversa arquivada') } catch (e: any) { toast.error('Falha ao arquivar: ' + (e?.message || 'erro')) } }}>Arquivar conversa</DropdownMenuItem>
                              <DropdownMenuItem onClick={async () => { if (!selectedContact || !ensureWhatsAppConnected()) return; try { await unarchiveWhatsAppChat(whatsapp.baseUrl!, selectedContact); toast.success('Conversa desarquivada') } catch (e: any) { toast.error('Falha ao desarquivar: ' + (e?.message || 'erro')) } }}>Desarquivar conversa</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>Silenciar</DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  {[8 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000].map((ms) => (
                                    <DropdownMenuItem key={ms} onClick={async () => { if (!selectedContact || !ensureWhatsAppConnected()) return; try { await muteWhatsAppChat(whatsapp.baseUrl!, selectedContact, ms); toast.success('Conversa silenciada') } catch (e: any) { toast.error('Falha ao silenciar: ' + (e?.message || 'erro')) } }}>{ms === 28800000 ? '8 horas' : ms === 86400000 ? '24 horas' : '1 semana'}</DropdownMenuItem>
                                  ))}
                                  <DropdownMenuItem onClick={async () => { if (!selectedContact || !ensureWhatsAppConnected()) return; try { await muteWhatsAppChat(whatsapp.baseUrl!, selectedContact); toast.success('Conversa silenciada') } catch (e: any) { toast.error('Falha ao silenciar: ' + (e?.message || 'erro')) } }}>Indefinido</DropdownMenuItem>
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuItem onClick={async () => { if (!selectedContact || !ensureWhatsAppConnected()) return; try { await unmuteWhatsAppChat(whatsapp.baseUrl!, selectedContact); toast.success('Notificações reativadas') } catch (e: any) { toast.error('Falha ao reativar: ' + (e?.message || 'erro')) } }}>Reativar notificações</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={async () => { if (!selectedContact || !ensureWhatsAppConnected()) return; try { await pinWhatsAppChat(whatsapp.baseUrl!, selectedContact); toast.success('Conversa fixada') } catch (e: any) { toast.error('Falha ao fixar: ' + (e?.message || 'erro')) } }}>Fixar conversa</DropdownMenuItem>
                              <DropdownMenuItem onClick={async () => { if (!selectedContact || !ensureWhatsAppConnected()) return; try { await unpinWhatsAppChat(whatsapp.baseUrl!, selectedContact); toast.success('Conversa desfixada') } catch (e: any) { toast.error('Falha ao desfixar: ' + (e?.message || 'erro')) } }}>Desfixar conversa</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={async () => { if (!selectedContact || !ensureWhatsAppConnected()) return; try { await markChatSeen(whatsapp.baseUrl!, selectedContact); toast.success('Marcado como lido') } catch { /* ignore */ } setUnreadCounts(prev => ({ ...prev, [selectedContact]: 0 })) }}>Marcar como lida</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="flex-1 p-4">
                      <div className="relative">
                        <ScrollArea className="h-[350px] mb-2" viewportRef={chatViewportRef as any}>
                          <div className="space-y-4">
                            {getConversationMessages(selectedContact).filter(m => convSearch ? (m.content || '').toLowerCase().includes(convSearch.toLowerCase()) : true).map((message) => (
                              <div key={message.id} className={`flex flex-col ${message.fromUser ? 'items-start' : 'items-end'}`}>
                                {/* Unread divider: show before the first new message when scrolled up */}
                                {selectedContact && unreadDividerByChat[selectedContact] === message.id && (
                                  <div className="w-full flex justify-center my-2">
                                    <div className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                                      <span className="h-px w-8 bg-border" />
                                      <span>Novas mensagens</span>
                                      <span className="h-px w-8 bg-border" />
                                    </div>
                                  </div>
                                )}
                                <ContextMenu>
                                  <ContextMenuTrigger asChild>
                                    <div
                                      onClick={(e) => { if (isSelecting) { e.preventDefault(); e.stopPropagation(); toggleSelectMessage(message.id) } }}
                                      onMouseDown={(e) => { if (isSelecting) { e.preventDefault(); e.stopPropagation(); } }}
                                      role="button"
                                      tabIndex={0}
                                      className={`group relative max-w-[70%] p-3 rounded-lg ${message.fromUser ? 'bg-muted' : 'bg-green-600 text-white'} ${isSelecting && selectedMessageIds.has(message.id) ? 'ring-2 ring-blue-400' : ''}`}
                                    >
                                      {/* AI badges on incoming (from user) messages when in auto/assist */}
                                      {message.fromUser && (effectiveAiMode === 'auto' || effectiveAiMode === 'assist') && (
                                        <div className="mb-1 flex items-center gap-1 text-[10px] text-green-700">
                                          <Robot className="h-3 w-3" />
                                          <span>{effectiveAiMode === 'auto' ? 'IA irá responder' : 'IA sugerirá resposta'}</span>
                                          {aiSuppressed && <span className="ml-2 text-yellow-700">(Pausada)</span>}
                                        </div>
                                      )}
                                      {isSelecting && (
                                        <div className="absolute -left-6 top-1/2 -translate-y-1/2">
                                          <input type="checkbox" checked={selectedMessageIds.has(message.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelectMessage(message.id)} className="h-4 w-4" />
                                        </div>
                                      )}
                                      {message.type === 'audio' && message.mediaUrl ? (
                                        <audio controls src={message.mediaUrl} className="w-full" />
                                      ) : message.type === 'location' && message.metadata?.link ? (
                                        <a className="underline text-xs" href={message.metadata.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Ver localização</a>
                                      ) : message.type === 'poll' ? (
                                        <div>
                                          <p className="chat-message font-medium">{message.content}</p>
                                          {Array.isArray(message.metadata?.options) && (
                                            <ul className="mt-1 text-xs list-disc list-inside space-y-0.5">
                                              {message.metadata.options.map((opt: string, idx: number) => <li key={idx}>{opt}</li>)}
                                            </ul>
                                          )}
                                        </div>
                                      ) : message.type === 'contact' ? (
                                        <div>
                                          <p className="chat-message font-medium">{message.content}</p>
                                          {message.metadata?.phone && <div className="text-xs text-muted-foreground">{message.metadata.phone}</div>}
                                        </div>
                                      ) : (
                                        <p className="chat-message">{message.content}</p>
                                      )}
                                      {message.metadata?.reaction && (
                                        <div className={`mt-1 ${message.fromUser ? 'text-muted-foreground' : 'text-green-100'}`}>{message.metadata.reaction}</div>
                                      )}
                                      {/* Hover actions caret (top-right) */}
                                      <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <button className="p-1 rounded hover:bg-white/20" aria-label="Mais ações">
                                              <DotsThreeVertical className="h-4 w-4" />
                                            </button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align={message.fromUser ? 'start' : 'end'} className="min-w-[220px]">
                                            <DropdownMenuItem onClick={() => { setReplyTo(message); setMessageInput(prev => prev || '') }}>Responder</DropdownMenuItem>
                                            <DropdownMenuSub>
                                              <DropdownMenuSubTrigger>Reagir</DropdownMenuSubTrigger>
                                              <DropdownMenuSubContent>
                                                {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(e => (
                                                  <DropdownMenuItem key={e} onClick={() => updateMessageMeta(message.id, { reaction: e })}>{e}</DropdownMenuItem>
                                                ))}
                                              </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                            <DropdownMenuItem onClick={() => updateMessageMeta(message.id, { favorite: !message.metadata?.favorite })}>
                                              {message.metadata?.favorite ? 'Remover favorito' : 'Favoritar'}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={async () => {
                                              try { if (!ensureWhatsAppConnected()) throw new Error('Conecte ao WhatsApp'); await pinWhatsAppMessage(whatsapp.baseUrl!, message.id); updateMessageMeta(message.id, { pinned: true }); toast.success('Mensagem fixada') } catch (e: any) { toast.error('Falha ao fixar: ' + (e?.message || 'erro')) }
                                            }}>Fixar</DropdownMenuItem>
                                            {!!message.metadata?.pinned && (
                                              <DropdownMenuItem onClick={async () => {
                                                try { if (!ensureWhatsAppConnected()) throw new Error('Conecte ao WhatsApp'); await unpinWhatsAppMessage(whatsapp.baseUrl!, message.id); updateMessageMeta(message.id, { pinned: false }); toast.success('Mensagem desfixada') } catch (e: any) { toast.error('Falha ao desfixar: ' + (e?.message || 'erro')) }
                                              }}>Desfixar</DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem onClick={() => { setForwardMessageIds([message.id]); setIsForwardOpen(true) }}>Encaminhar</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => { try { navigator.clipboard.writeText(message.content); toast.success('Copiado') } catch { toast.error('Falha ao copiar') } }}>Copiar</DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            {String(message.conversationId || '').endsWith('@g.us') && (
                                              <>
                                                <DropdownMenuItem onClick={() => { setReplyTo(message); setMessageInput(prev => prev || '') }}>Responder em particular</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => toast.message(`Conversar com ${contacts.find(c => c.id === message.conversationId)?.name || 'contato'}`)}>Conversar com {contacts.find(c => c.id === message.conversationId)?.name || 'contato'}</DropdownMenuItem>
                                              </>
                                            )}
                                            <DropdownMenuItem onClick={() => toast.message('Denúncia enviada (simulado)')}>Denunciar</DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={async () => {
                                              try { if (ensureWhatsAppConnected()) { await deleteWhatsAppMessage(whatsapp.baseUrl!, message.id, true) } } finally { deleteMessage(message.id); toast.success('Mensagem apagada') }
                                            }}>Apagar</DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => { setIsSelecting(true); setSelectedMessageIds(prev => { const next = new Set(prev); next.add(message.id); return next }); toast.message('Seleção de mensagens ativada') }}>Selecionar mensagens</DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>

                                      <div className={`text-xs mt-1 flex items-center justify-between ${message.fromUser ? 'text-muted-foreground' : 'text-green-100'}`}>
                                        <span className="flex items-center gap-1">
                                          {/* Favorite and pinned indicators */}
                                          {message.metadata?.favorite && <Star className="h-3 w-3 text-yellow-300" />}
                                          {message.metadata?.pinned && <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-100 text-yellow-800">Fixado</span>}
                                          {message.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                          {message.metadata?.sentiment && (
                                            <span className={`ml-1 text-[10px] px-1 py-0.5 rounded ${message.metadata.sentiment === 'positive' ? 'bg-green-100 text-green-800' : message.metadata.sentiment === 'negative' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`}>
                                              {message.metadata.sentiment}
                                            </span>
                                          )}
                                        </span>
                                        {!message.fromUser && (
                                          <div className="flex items-center space-x-2">
                                            {/* In-conversation search (live filter; Enter triggers remote search) */}
                                            <div className="hidden md:block">
                                              <Input
                                                placeholder="Pesquisar na conversa..."
                                                value={convSearch}
                                                onChange={(e) => { setConvSearch(e.target.value); filteringActivityRef.current = true; if (filterIdleTimerRef.current) { window.clearTimeout(filterIdleTimerRef.current); filterIdleTimerRef.current = null } filterIdleTimerRef.current = window.setTimeout(() => { filteringActivityRef.current = false }, 600) }}
                                                onKeyDown={async (e) => {
                                                  if (e.key === 'Enter') {
                                                    try {
                                                      if (!selectedContact) return
                                                      if (!ensureWhatsAppConnected()) return
                                                      const res: any = await searchWhatsAppMessages(whatsapp.baseUrl!, convSearch.trim(), selectedContact)
                                                      const list = res?.messages || []
                                                      setLastSearchResults(list)
                                                      setIsSearchOpen(true)
                                                      toast.message(`${list.length} resultado(s) do servidor`)
                                                    } catch { toast.error('Falha na busca remota') }
                                                  }
                                                }}
                                                className="w-48"
                                              />
                                            </div>
                                            {message.status === 'sent' && <CheckCircle className="h-3 w-3" />}
                                            {message.status === 'delivered' && <CheckCircle className="h-3 w-3" />}
                                            {message.status === 'read' && <CheckCircle className="h-3 w-3 text-blue-300" />}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent className="min-w-[240px]">
                                    <ContextMenuItem onClick={() => { setReplyTo(message); setMessageInput(prev => prev || '') }}>Responder</ContextMenuItem>
                                    <ContextMenuSub>
                                      <ContextMenuSubTrigger>Reagir</ContextMenuSubTrigger>
                                      <ContextMenuSubContent className="min-w-[160px]">
                                        {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(e => (
                                          <ContextMenuItem key={e} onClick={() => updateMessageMeta(message.id, { reaction: e })}>{e}</ContextMenuItem>
                                        ))}
                                      </ContextMenuSubContent>
                                    </ContextMenuSub>
                                    <ContextMenuItem onClick={() => updateMessageMeta(message.id, { favorite: !message.metadata?.favorite })}>
                                      {message.metadata?.favorite ? 'Remover favorito' : 'Favoritar'}
                                    </ContextMenuItem>
                                    <ContextMenuItem onClick={async () => {
                                      try {
                                        if (!ensureWhatsAppConnected()) throw new Error('Conecte ao WhatsApp')
                                        await pinWhatsAppMessage(whatsapp.baseUrl!, message.id)
                                        updateMessageMeta(message.id, { pinned: true })
                                        toast.success('Mensagem fixada')
                                      } catch (e: any) { toast.error('Falha ao fixar: ' + (e?.message || 'erro')) }
                                    }}>Fixar</ContextMenuItem>
                                    {!!message.metadata?.pinned && (
                                      <ContextMenuItem onClick={async () => {
                                        try {
                                          if (!ensureWhatsAppConnected()) throw new Error('Conecte ao WhatsApp')
                                          await unpinWhatsAppMessage(whatsapp.baseUrl!, message.id)
                                          updateMessageMeta(message.id, { pinned: false })
                                          toast.success('Mensagem desfixada')
                                        } catch (e: any) { toast.error('Falha ao desfixar: ' + (e?.message || 'erro')) }
                                      }}>Desfixar</ContextMenuItem>
                                    )}
                                    <ContextMenuItem onClick={() => { setForwardMessageIds([message.id]); setIsForwardOpen(true) }}>Encaminhar</ContextMenuItem>
                                    <ContextMenuItem onClick={() => { try { navigator.clipboard.writeText(message.content); toast.success('Copiado') } catch { toast.error('Falha ao copiar') } }}>Copiar</ContextMenuItem>
                                    <ContextMenuSeparator />
                                    {String(message.conversationId || '').endsWith('@g.us') && (
                                      <>
                                        <ContextMenuItem onClick={() => { setReplyTo(message); setMessageInput(prev => prev || '') }}>Responder em particular</ContextMenuItem>
                                        <ContextMenuItem onClick={() => toast.message(`Conversar com ${contacts.find(c => c.id === message.conversationId)?.name || 'contato'}`)}>Conversar com {contacts.find(c => c.id === message.conversationId)?.name || 'contato'}</ContextMenuItem>
                                      </>
                                    )}
                                    <ContextMenuItem onClick={() => toast.message('Denúncia enviada (simulado)')}>Denunciar</ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem onClick={async () => {
                                      try {
                                        if (ensureWhatsAppConnected()) {
                                          await deleteWhatsAppMessage(whatsapp.baseUrl!, message.id, true)
                                        }
                                      } catch { /* ignore network delete errors; proceed to UI removal */ }
                                      deleteMessage(message.id)
                                      toast.success('Mensagem apagada')
                                    }}>Apagar</ContextMenuItem>
                                    <ContextMenuItem onClick={() => { setIsSelecting(true); setSelectedMessageIds(prev => { const next = new Set(prev); next.add(message.id); return next }); toast.message('Seleção de mensagens ativada') }}>Selecionar mensagens</ContextMenuItem>
                                  </ContextMenuContent>
                                </ContextMenu>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                        {!isNearBottom && (
                          <TooltipButton label="Ir para o fim">
                            <button
                              type="button"
                              aria-label="Ir para o fim"
                              onClick={scrollToBottom}
                              className="absolute bottom-3 right-2 p-2 rounded-full border bg-background/90 shadow hover:bg-background"
                            >
                              <ArrowDown className="h-5 w-5" />
                            </button>
                          </TooltipButton>
                        )}
                      </div>
                      {/* AI Assist suggestions (chips) */}
                      {(effectiveAiMode === 'assist' || effectiveAiMode === 'auto') && !aiSuppressed && (aiSuggestionsByChat[selectedContact] || []).length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {(aiSuggestionsByChat[selectedContact] || []).slice(0, 4).map((s, idx) => (
                            <TooltipLabel key={idx} label="Inserir sugestão">
                              <button
                                className="text-xs px-2 py-1 rounded-full border bg-muted hover:bg-muted/70"
                                onClick={() => setMessageInput(prev => (prev && prev.trim().length ? (prev.trimEnd() + ' ' + s) : s))}
                              >
                                {s}
                              </button>
                            </TooltipLabel>
                          ))}
                        </div>
                      )}

                      {replyTo && (
                        <div className="mb-2 px-2 py-1 text-xs border rounded bg-muted flex items-center justify-between">
                          <div className="truncate mr-2">
                            Respondendo a: <span className="font-medium">{replyTo.fromUser ? 'Contato' : 'Você'}</span> — {replyTo.content.slice(0, 80)}
                          </div>
                          <Button size="icon" variant="ghost" onClick={() => setReplyTo(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {/* Bulk selection action bar */}
                      {isSelecting && selectedMessageIds.size > 0 && (
                        <div className="mb-2 px-2 py-1 text-xs border rounded bg-muted flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>{selectedMessageIds.size} selecionada(s)</span>
                            <Button size="sm" variant="outline" onClick={() => setSelectedMessageIds(new Set())}>Limpar</Button>
                            <Button size="sm" variant="ghost" onClick={() => setIsSelecting(false)}>Sair da seleção</Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" onClick={() => { setForwardMessageIds(Array.from(selectedMessageIds)); setIsForwardOpen(true) }}>Encaminhar</Button>
                            <Button size="sm" variant="destructive" onClick={async () => {
                              try {
                                if (ensureWhatsAppConnected()) {
                                  await bulkDeleteWhatsAppMessages(whatsapp.baseUrl!, Array.from(selectedMessageIds), true)
                                }
                              } finally {
                                setMessages(prev => prev.filter(m => !selectedMessageIds.has(m.id)))
                                setSelectedMessageIds(new Set()); setIsSelecting(false)
                                toast.success('Mensagens apagadas')
                              }
                            }}>Apagar</Button>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center space-x-2">
                        <input ref={imageInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => handleFilePicked(e.target.files, detectWhatsAppMediaType((e.target.files && e.target.files[0] && e.target.files[0].type) || ''))} />
                        <input ref={docInputRef} type="file" accept="application/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={e => handleFilePicked(e.target.files, 'document')} />
                        <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={e => handleFilePicked(e.target.files, 'audio')} />

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <TooltipButton label="Anexar mídia">
                              <Button variant="outline" size="sm">
                                <ImageIcon className="h-4 w-4" />
                              </Button>
                            </TooltipButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => {
                              try {
                                const input = document.createElement('input')
                                input.type = 'file'
                                input.accept = 'image/*,video/*'
                                  ; (input as any).capture = 'environment'
                                input.onchange = (e: any) => handleFilePicked(e.target.files, detectWhatsAppMediaType(e.target.files?.[0]?.type || ''))
                                input.click()
                              } catch {
                                imageInputRef.current?.click()
                              }
                            }}>
                              <Camera className="h-4 w-4 mr-2" /> Abrir câmera
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                              <ImageIcon className="h-4 w-4 mr-2" /> Fotos/Vídeos
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <TooltipButton label="Anexar documento">
                          <Button variant="outline" size="sm" onClick={() => docInputRef.current?.click()}>
                            <FileText className="h-4 w-4" />
                          </Button>
                        </TooltipButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <TooltipButton label={isRecording ? 'Parar ou enviar áudio' : 'Áudio'}>
                              <Button variant={isRecording ? 'default' : 'outline'} size="sm">
                                <Microphone className="h-4 w-4" />
                              </Button>
                            </TooltipButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {!isRecording && (
                              <DropdownMenuItem onClick={() => audioInputRef.current?.click()}>Enviar arquivo de áudio</DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => (isRecording ? stopRecording() : startRecording())}>{isRecording ? 'Parar gravação' : 'Começar a gravar'}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {isRecording && (
                          <div className="flex items-center gap-2 px-2 py-1 rounded bg-muted border">
                            <canvas ref={waveformCanvasRef} className="h-6 w-32" />
                            <span className="text-[11px] tabular-nums">{String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</span>
                          </div>
                        )}
                        <TooltipButton label="Enviar contato">
                          <Button variant="outline" size="sm" onClick={() => setIsShareContactOpen(true)}>
                            <Users className="h-4 w-4" />
                          </Button>
                        </TooltipButton>
                        <TooltipButton label="Criar enquete">
                          <Button variant="outline" size="sm" onClick={() => setIsPollOpen(true)}>
                            <List className="h-4 w-4" />
                          </Button>
                        </TooltipButton>
                        <TooltipButton label="Compartilhar localização">
                          <Button variant="outline" size="sm" onClick={handleShareLocation}>
                            <MapPin className="h-4 w-4" />
                          </Button>
                        </TooltipButton>
                        <Input
                          placeholder="Digite sua mensagem..."
                          value={messageInput}
                          onChange={(e) => {
                            setMessageInput(e.target.value)
                            // mark typing activity and clear shortly after last keystroke
                            typingActivityRef.current = true
                            if (typingIdleTimerRef.current) { window.clearTimeout(typingIdleTimerRef.current); typingIdleTimerRef.current = null }
                            typingIdleTimerRef.current = window.setTimeout(() => { typingActivityRef.current = false }, 800)
                          }}
                          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                          className="flex-1"
                        />
                        <Button onClick={sendMessage} disabled={!messageInput.trim()}>
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                    {/* Notes dialog */}
                    <Dialog open={isNotesOpen} onOpenChange={setIsNotesOpen}>
                      <DialogContent className="max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Notas do lead</DialogTitle>
                          <DialogDescription>Adicione informações extras sobre este contato.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <Textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)} placeholder="Observações, contexto, preferências..." rows={6} />
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setIsNotesOpen(false)}>Cancelar</Button>
                            <Button onClick={() => { if (selectedContact) { updateContact(selectedContact, { customFields: { notes: notesDraft } }); toast.success('Notas salvas') } setIsNotesOpen(false) }}>Salvar</Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* Tags dialog */}
                    <Dialog open={isTagsOpen} onOpenChange={setIsTagsOpen}>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>Etiquetas</DialogTitle>
                          <DialogDescription>Organize e filtre seus leads com etiquetas.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {contacts.find(c => c.id === selectedContact)?.labels.map(tag => (
                              <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                                {tag}
                                <button className="ml-1 text-xs" onClick={() => { if (!selectedContact) return; updateContact(selectedContact, { labels: contacts.find(c => c.id === selectedContact)!.labels.filter(t => t !== tag) }) }}>×</button>
                              </Badge>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <Input placeholder="Nova etiqueta" value={newTag} onChange={e => setNewTag(e.target.value)} />
                            <Button onClick={() => { if (!newTag.trim() || !selectedContact) return; const c = contacts.find(x => x.id === selectedContact)!; if (c.labels.includes(newTag.trim())) return; updateContact(selectedContact, { labels: [...c.labels, newTag.trim()] }); setNewTag('') }}>Adicionar</Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* Media/Links/Docs drawer-like dialog */}
                    <Dialog open={isMediaOpen} onOpenChange={setIsMediaOpen}>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Mídia, links e documentos</DialogTitle>
                          <DialogDescription>Todos os arquivos compartilhados nesta conversa.</DialogDescription>
                        </DialogHeader>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-h-[60vh] overflow-auto">
                          {getConversationMessages(selectedContact).filter(m => ['image', 'video', 'document'].includes(m.type) || m.metadata?.link).map(m => (
                            <div key={m.id} className="border rounded p-2 text-sm">
                              <div className="font-medium mb-1">{m.type.toUpperCase()}</div>
                              {m.mediaUrl && (m.type === 'image' ? <img src={m.mediaUrl} alt="mídia" className="rounded" /> : m.type === 'video' ? <video src={m.mediaUrl} controls className="rounded" /> : <a className="underline" href={m.mediaUrl} target="_blank" rel="noreferrer">Abrir documento</a>)}
                              {m.metadata?.link && <a className="underline block mt-1" href={m.metadata.link} target="_blank" rel="noreferrer">{m.metadata.link}</a>}
                              <div className="text-xs text-muted-foreground mt-1">{m.timestamp.toLocaleString('pt-BR')}</div>
                            </div>
                          ))}
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* Favorites dialog */}
                    <Dialog open={isFavoritesOpen} onOpenChange={setIsFavoritesOpen}>
                      <DialogContent className="max-w-xl">
                        <DialogHeader>
                          <DialogTitle>Marcadas como favoritas</DialogTitle>
                          <DialogDescription>Mensagens, mídias e figurinhas favoritadas.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3 max-h-[60vh] overflow-auto">
                          {getConversationMessages(selectedContact).filter(m => m.metadata?.favorite).map(m => (
                            <div key={m.id} className="border rounded p-2 text-sm">
                              <div className="flex items-center gap-2 text-yellow-700"><Star className="h-4 w-4" /> Favorito</div>
                              <div className="mt-1">{m.content}</div>
                              <div className="text-xs text-muted-foreground mt-1">{m.timestamp.toLocaleString('pt-BR')}</div>
                            </div>
                          ))}
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* Notifications dialog */}
                    <Dialog open={isNotificationsOpen} onOpenChange={setIsNotificationsOpen}>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>Notificações</DialogTitle>
                          <DialogDescription>Veja e altere as configurações desta conversa.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div className="text-sm">Estado: {selectedContact && mutedChats.has(selectedContact) ? 'Silenciada' : 'Ativa'}</div>
                          <div className="flex gap-2">
                            <Button variant="outline" onClick={() => { if (!selectedContact) return; setMutedChats(prev => new Set(prev).add(selectedContact)); toast.success('Silenciada (local)') }}>Silenciar</Button>
                            <Button onClick={() => { if (!selectedContact) return; setMutedChats(prev => { const n = new Set(prev); n.delete(selectedContact); return n }); toast.success('Notificações ativadas (local)') }}>Ativar</Button>
                          </div>
                          <p className="text-xs text-muted-foreground">Dica: use o menu principal para silenciar via gateway (8h/24h/1 semana).</p>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* Contact data dialog */}
                    <Dialog open={isContactInfoOpen} onOpenChange={setIsContactInfoOpen}>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>Dados do contato</DialogTitle>
                          <DialogDescription>Informações conhecidas deste lead.</DialogDescription>
                        </DialogHeader>
                        {(() => {
                          const c = contacts.find(x => x.id === selectedContact)
                          if (!c) return <div className="text-sm text-muted-foreground">Nenhum contato selecionado.</div>
                          return (
                            <div className="space-y-2 text-sm">
                              <div><span className="font-medium">Nome:</span> {c.name}</div>
                              <div><span className="font-medium">Telefone:</span> {c.phone}</div>
                              <div><span className="font-medium">Primeiro contato:</span> {c.firstContactDate.toLocaleDateString('pt-BR')}</div>
                              <div><span className="font-medium">Total de mensagens:</span> {c.totalMessages}</div>
                              <div>
                                <span className="font-medium">Campos personalizados:</span>
                                <pre className="bg-muted p-2 rounded text-xs mt-1">{JSON.stringify(c.customFields || {}, null, 2)}</pre>
                              </div>
                            </div>
                          )
                        })()}
                      </DialogContent>
                    </Dialog>

                    {/* Common groups dialog */}
                    <Dialog open={isCommonGroupsOpen} onOpenChange={async (open) => {
                      setIsCommonGroupsOpen(open)
                      if (open) {
                        try {
                          if (!selectedContact || !whatsapp.connected || !whatsapp.baseUrl) { setCommonGroups([]); return }
                          const contact = contacts.find(c => c.id === selectedContact)
                          const key = contact?.phone || selectedContact
                          const data: any = await fetchCommonGroups(whatsapp.baseUrl, key)
                          setCommonGroups(data.groups || [])
                        } catch {
                          setCommonGroups([])
                        }
                      } else {
                        setCommonGroups(null)
                      }
                    }}>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>Grupos em comum</DialogTitle>
                          <DialogDescription>Outros grupos onde este lead aparece.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2 text-sm">
                          {commonGroups === null && (
                            <p className="text-muted-foreground">
                              <LoadingPercentText label="Carregando" showPercent={false} />
                            </p>
                          )}
                          {Array.isArray(commonGroups) && commonGroups.length === 0 && (
                            <p className="text-muted-foreground">Nenhum grupo em comum encontrado.</p>
                          )}
                          {Array.isArray(commonGroups) && commonGroups.length > 0 && (
                            <ul className="divide-y rounded border">
                              {commonGroups.map(g => (
                                <li key={g.id} className="p-2 flex items-center justify-between">
                                  <div>
                                    <div className="font-medium">{g.name}</div>
                                    <div className="text-xs text-muted-foreground">Participantes: {g.participantCount ?? '-'} • Não lidas: {g.unreadCount ?? 0}</div>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">{g.id}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
                  </Card>
                ) : (
                  <Card className="glass-card h-full flex items-center justify-center">
                    <div className="text-center">
                      <WhatsappLogo className="h-12 w-12 text-green-600 mx-auto mb-4" />
                      <h3 className="text-lg font-medium mb-2">Selecione uma conversa</h3>
                      <p className="text-muted-foreground">
                        Escolha um contato da lista para começar a conversar
                      </p>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          </SimpleErrorBoundary>
        </TabsContent>

        {/* Share Contact Dialog (searchable list) */}
        <Dialog open={isShareContactOpen} onOpenChange={setIsShareContactOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Enviar contato</DialogTitle>
              <DialogDescription>Compartilhe um contato via WhatsApp</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Pesquisar contato" value={shareSearch} onChange={e => setShareSearch(e.target.value)} />
              <div className="max-h-64 overflow-auto rounded border">
                {contacts
                  .filter(c => (c.name || '').toLowerCase().includes(shareSearch.toLowerCase()) || (c.phone || '').includes(shareSearch))
                  .map(c => (
                    <div key={c.id} className="px-3 py-2 hover:bg-muted cursor-pointer flex items-center justify-between" onClick={async () => {
                      if (!selectedContact) { toast.error('Selecione uma conversa'); return }
                      const current = contacts.find(x => x.id === selectedContact)
                      if (!current) { toast.error('Contato inválido'); return }
                      if (!ensureWhatsAppConnected()) { toast.error('Conecte ao WhatsApp'); return }
                      try {
                        await sendWhatsAppContact(whatsapp.baseUrl!, current.phone, c.phone, c.name)
                        setIsShareContactOpen(false)
                        setShareSearch('')
                        toast.success('Contato enviado')
                      } catch (e: any) {
                        toast.error('Falha ao enviar contato: ' + (e?.message || 'erro'))
                      }
                    }}>
                      <div>
                        <div className="font-medium">{c.name || c.phone}</div>
                        <div className="text-xs text-muted-foreground">{c.phone}</div>
                      </div>
                      <Button size="sm" variant="ghost">Enviar</Button>
                    </div>
                  ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setIsShareContactOpen(false)}>Cancelar</Button>
                <Button onClick={() => setIsShareContactOpen(false)}>Fechar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Forward Dialog */}
        <ForwardDialog
          open={isForwardOpen}
          onOpenChange={setIsForwardOpen}
          contacts={contacts}
          onConfirm={async (target) => {
            if (!ensureWhatsAppConnected()) { toast.error('Conecte ao WhatsApp'); return }
            try {
              if (forwardMessageIds.length > 1) {
                await bulkForwardWhatsAppMessages(whatsapp.baseUrl!, forwardMessageIds, target)
              } else if (forwardMessageIds.length === 1) {
                await forwardWhatsAppMessage(whatsapp.baseUrl!, forwardMessageIds[0], target)
              }
              toast.success('Encaminhamento realizado')
            } catch (e: any) { toast.error('Falha ao encaminhar: ' + (e?.message || 'erro')) }
            finally {
              setForwardMessageIds([])
              setIsSelecting(false)
              setSelectedMessageIds(new Set())
            }
          }}
        />

        {/* Poll Dialog */}
        <Dialog open={isPollOpen} onOpenChange={setIsPollOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Criar enquete</DialogTitle>
              <DialogDescription>Informe a pergunta e as opções (uma por linha)</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Pergunta</Label>
                <Input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Qual sua opção preferida?" />
              </div>
              <div>
                <Label>Opções</Label>
                <Textarea value={pollOptions} onChange={e => setPollOptions(e.target.value)} rows={4} />
                <p className="text-xs text-muted-foreground mt-1">Separe as opções por linha.</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setIsPollOpen(false)}>Cancelar</Button>
                <Button onClick={async () => {
                  if (!selectedContact) { toast.error('Selecione uma conversa'); return }
                  const contact = contacts.find(c => c.id === selectedContact)
                  if (!contact) { toast.error('Contato inválido'); return }
                  if (!ensureWhatsAppConnected()) { toast.error('Conecte ao WhatsApp'); return }
                  const opts = pollOptions.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
                  if (!pollQuestion.trim() || opts.length < 2) { toast.error('Informe pergunta e pelo menos 2 opções'); return }
                  try {
                    await sendWhatsAppPoll(whatsapp.baseUrl!, contact.phone, pollQuestion.trim(), opts)
                    setIsPollOpen(false)
                    setPollQuestion(''); setPollOptions('Sim\nNão')
                    toast.success('Enquete enviada')
                  } catch (e: any) {
                    toast.error('Falha ao enviar enquete: ' + (e?.message || 'erro'))
                  }
                }}>Enviar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Call Dialog */}
        <Dialog open={isCallDialogOpen} onOpenChange={setIsCallDialogOpen}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle>Iniciar chamada</DialogTitle>
              <DialogDescription>Escolha o tipo de chamada pelo WhatsApp</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setIsCallDialogOpen(false)}>Cancelar</Button>
              <Button onClick={() => {
                const contact = contacts.find(c => c.id === selectedContact)
                if (!contact) { setIsCallDialogOpen(false); return }
                const phone = contact.phone.replace(/[^\d+]/g, '')
                const uri = `whatsapp://call?number=${encodeURIComponent(phone)}`
                const opened = window.open(uri, '_self')
                setTimeout(() => {
                  try { if (!opened) window.location.href = `https://wa.me/${encodeURIComponent(phone)}` } catch { /* ignore */ }
                }, 800)
                setIsCallDialogOpen(false)
              }}>Somente voz</Button>
              <Button onClick={() => {
                const contact = contacts.find(c => c.id === selectedContact)
                if (!contact) { setIsCallDialogOpen(false); return }
                const phone = contact.phone.replace(/[^\d+]/g, '')
                const uri = `whatsapp://video?number=${encodeURIComponent(phone)}`
                const opened = window.open(uri, '_self')
                setTimeout(() => {
                  try { if (!opened) window.location.href = `https://wa.me/${encodeURIComponent(phone)}` } catch { /* ignore */ }
                }, 800)
                setIsCallDialogOpen(false)
              }}>Chamada de vídeo</Button>
            </div>
          </DialogContent>
        </Dialog>

        <TabsContent value="templates" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Templates de Mensagem</h3>
            <Dialog open={isCreatingTemplate} onOpenChange={setIsCreatingTemplate}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Template
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Criar Template de Mensagem</DialogTitle>
                  <DialogDescription>
                    Templates precisam ser aprovados pelo WhatsApp antes do uso
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Nome do Template</Label>
                      <Input placeholder="ex: boas_vindas" />
                    </div>
                    <div>
                      <Label>Categoria</Label>
                      <Select>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MARKETING">Marketing</SelectItem>
                          <SelectItem value="UTILITY">Utilitário</SelectItem>
                          <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Texto da Mensagem</Label>
                    <Textarea
                      placeholder="Olá {{1}}! Bem-vindo à nossa empresa..."
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Use {`{{1}}`}, {`{{2}}`}, etc. para variáveis
                    </p>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setIsCreatingTemplate(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={() => {
                      setIsCreatingTemplate(false)
                      toast.success("Template enviado para aprovação!")
                    }}>
                      Criar Template
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
              <Card key={template.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{template.name}</CardTitle>
                    <Badge
                      variant={
                        template.status === 'APPROVED' ? 'default' :
                          template.status === 'PENDING' ? 'secondary' : 'destructive'
                      }
                    >
                      {template.status === 'APPROVED' ? 'Aprovado' :
                        template.status === 'PENDING' ? 'Pendente' : 'Rejeitado'}
                    </Badge>
                  </div>
                  <CardDescription>
                    {template.category === 'MARKETING' ? 'Marketing' :
                      template.category === 'UTILITY' ? 'Utilitário' : 'Autenticação'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm">
                    {template.components.map((component, index) => (
                      <div key={index} className="mb-2">
                        {component.type === 'BODY' && (
                          <p className="bg-muted p-2 rounded text-sm">
                            {component.text?.replace(/\{\{(\d+)\}\}/g, '[Variável $1]')}
                          </p>
                        )}
                        {component.type === 'BUTTONS' && (
                          <div className="flex gap-2 mt-2">
                            {component.buttons?.map((button, btnIndex) => (
                              <Badge key={btnIndex} variant="outline" className="text-xs">
                                {button.text}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Usado {template.usageCount} vezes
                    </span>
                    <Button variant="outline" size="sm" onClick={async () => {
                      if (!selectedContact) { toast.error('Selecione uma conversa primeiro'); return }
                      const contact = contacts.find(c => c.id === selectedContact)
                      if (!contact) { toast.error('Contato inválido'); return }
                      const text = template.components
                        .filter(c => c.type === 'BODY')
                        .map(c => c.text || '')
                        .join('\n') || template.name
                      try {
                        if (!whatsapp.connected || !whatsapp.baseUrl) throw new Error('Não conectado ao WhatsApp')
                        await sendWhatsAppMessage(whatsapp.baseUrl, { to: contact.phone, text })
                        const newMessage: WhatsAppMessage = {
                          id: `msg_${Date.now()}`,
                          conversationId: selectedContact,
                          type: 'template',
                          content: text,
                          timestamp: new Date(),
                          status: 'delivered',
                          fromUser: false,
                          templateName: template.name,
                          metadata: { templateId: template.id, to: contact.phone }
                        }
                        setMessages(prev => [...prev, newMessage])
                        toast.success('Template enviado')
                      } catch (e: any) {
                        toast.error('Falha ao enviar template: ' + (e?.message || 'erro'))
                      }
                    }}>
                      Usar Template
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="broadcasts" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Campanhas de Broadcast</h3>
            <Dialog open={isCreatingBroadcast} onOpenChange={setIsCreatingBroadcast}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Campanha
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Criar Campanha de Broadcast</DialogTitle>
                  <DialogDescription>
                    Envie mensagens em massa usando templates aprovados
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Nome da Campanha</Label>
                    <Input placeholder="ex: Campanha Black Friday" />
                  </div>
                  <div>
                    <Label>Template</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.filter(t => t.status === 'APPROVED').map(template => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Público-Alvo</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione os contatos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os contatos</SelectItem>
                        <SelectItem value="leads">Apenas leads</SelectItem>
                        <SelectItem value="clients">Apenas clientes</SelectItem>
                        <SelectItem value="prospects">Apenas prospects</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setIsCreatingBroadcast(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={() => {
                      setIsCreatingBroadcast(false)
                      toast.success("Campanha criada com sucesso!")
                    }}>
                      Criar Campanha
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-4">
            {broadcasts.map((broadcast) => (
              <Card key={broadcast.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{broadcast.name}</CardTitle>
                      <CardDescription>
                        Template: {templates.find(t => t.id === broadcast.templateId)?.name}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={
                        broadcast.status === 'sent' ? 'default' :
                          broadcast.status === 'sending' ? 'secondary' :
                            broadcast.status === 'scheduled' ? 'outline' : 'secondary'
                      }
                    >
                      {broadcast.status === 'sent' ? 'Enviado' :
                        broadcast.status === 'sending' ? 'Enviando' :
                          broadcast.status === 'scheduled' ? 'Agendado' : 'Rascunho'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-lg font-semibold text-blue-600">
                        {broadcast.results.sent}
                      </div>
                      <div className="text-xs text-muted-foreground">Enviados</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-green-600">
                        {broadcast.results.delivered}
                      </div>
                      <div className="text-xs text-muted-foreground">Entregues</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-purple-600">
                        {broadcast.results.read}
                      </div>
                      <div className="text-xs text-muted-foreground">Lidos</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-red-600">
                        {broadcast.results.failed}
                      </div>
                      <div className="text-xs text-muted-foreground">Falharam</div>
                    </div>
                  </div>

                  {broadcast.sentTime && (
                    <div className="mt-4 text-sm text-muted-foreground">
                      Enviado em: {broadcast.sentTime.toLocaleString('pt-BR')}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          {/* Analytics Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Mensagens Recebidas</p>
                    <p className="text-2xl font-bold">{analytics.messagesReceived}</p>
                  </div>
                  <TrendUp className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Taxa de Resposta</p>
                    <p className="text-2xl font-bold">{analytics.responseRate}%</p>
                  </div>
                  <ThumbsUp className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Tempo Médio Resposta</p>
                    <p className="text-2xl font-bold">{analytics.averageResponseTime}min</p>
                  </div>
                  <Clock className="h-8 w-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Conversões</p>
                    <p className="text-2xl font-bold">{analytics.conversionsFromWhatsApp}</p>
                  </div>
                  <Star className="h-8 w-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Messages by Hour Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Mensagens por Horário</CardTitle>
              <CardDescription>Distribuição de mensagens ao longo do dia</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between h-40 space-x-2">
                {Object.entries(analytics.messagesByHour).map(([hour, count]) => (
                  <div key={hour} className="flex flex-col items-center">
                    <div
                      className="bg-green-500 rounded-t w-8"
                      style={{ height: `${(count / 45) * 100}%` }}
                    ></div>
                    <span className="text-xs mt-1">{hour}h</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Labels */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Labels Mais Utilizadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analytics.topLabels.map((item, index) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-full bg-green-100 text-green-800 flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </div>
                      <span className="font-medium">{item.label}</span>
                    </div>
                    <Badge variant="secondary">{item.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automation" className="space-y-6">
          {/* Automation Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Robot className="h-5 w-5 text-blue-600" />
                  <div>
                    <div className="text-2xl font-bold">47</div>
                    <div className="text-sm text-muted-foreground">Automações Ativas</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Lightning className="h-5 w-5 text-yellow-600" />
                  <div>
                    <div className="text-2xl font-bold">2.4K</div>
                    <div className="text-sm text-muted-foreground">Mensagens Automáticas</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <ChartLine className="h-5 w-5 text-green-600" />
                  <div>
                    <div className="text-2xl font-bold">94%</div>
                    <div className="text-sm text-muted-foreground">Taxa de Resposta</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Clock className="h-5 w-5 text-purple-600" />
                  <div>
                    <div className="text-2xl font-bold">15s</div>
                    <div className="text-sm text-muted-foreground">Tempo Médio</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Robot className="h-5 w-5" />
                <span>Automação Inteligente WhatsApp</span>
              </CardTitle>
              <CardDescription>
                Configure automações avançadas com IA para WhatsApp Business
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Tabs defaultValue="chatbot" className="space-y-4">
                <TabsList className="grid grid-cols-4 w-full">
                  <TabsTrigger value="chatbot">Chatbot IA</TabsTrigger>
                  <TabsTrigger value="workflows">Workflows</TabsTrigger>
                  <TabsTrigger value="templates">Templates</TabsTrigger>
                  <TabsTrigger value="integrations">Integrações</TabsTrigger>
                </TabsList>

                <TabsContent value="chatbot" className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
                      <CardHeader>
                        <CardTitle className="text-base">Assistente IA Configurado</CardTitle>
                        <CardDescription>
                          Chatbot inteligente com processamento de linguagem natural
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="text-center p-3 bg-white rounded-lg">
                            <div className="text-lg font-bold text-green-600">98.7%</div>
                            <div className="text-xs text-muted-foreground">Precisão</div>
                          </div>
                          <div className="text-center p-3 bg-white rounded-lg">
                            <div className="text-lg font-bold text-blue-600">1.8s</div>
                            <div className="text-xs text-muted-foreground">Resposta Média</div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Detecção de intenção</span>
                            <Switch defaultChecked />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Contextualização</span>
                            <Switch defaultChecked />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Aprendizado contínuo</span>
                            <Switch defaultChecked />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Configurações do Chatbot</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Tom de Voz</Label>
                          <Select defaultValue="professional">
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="professional">Profissional</SelectItem>
                              <SelectItem value="friendly">Amigável</SelectItem>
                              <SelectItem value="casual">Casual</SelectItem>
                              <SelectItem value="formal">Formal</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Idioma Principal</Label>
                          <Select defaultValue="pt-br">
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pt-br">Português (BR)</SelectItem>
                              <SelectItem value="en">English</SelectItem>
                              <SelectItem value="es">Español</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Escalonamento</Label>
                          <Select defaultValue="smart">
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="smart">Inteligente</SelectItem>
                              <SelectItem value="always">Sempre humano</SelectItem>
                              <SelectItem value="never">Só chatbot</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Treinamento e Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-3">
                          <h4 className="font-medium">Categorias de Perguntas</h4>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span>Suporte técnico</span>
                              <span className="font-medium">89%</span>
                            </div>
                            <Progress value={89} className="h-2" />
                            <div className="flex justify-between text-sm">
                              <span>Vendas</span>
                              <span className="font-medium">94%</span>
                            </div>
                            <Progress value={94} className="h-2" />
                            <div className="flex justify-between text-sm">
                              <span>Informações gerais</span>
                              <span className="font-medium">97%</span>
                            </div>
                            <Progress value={97} className="h-2" />
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h4 className="font-medium">Respostas Mais Comuns</h4>
                          <div className="space-y-2 text-sm">
                            <div className="p-2 border rounded">
                              <div className="font-medium">Horário de funcionamento</div>
                              <div className="text-xs text-muted-foreground">234 vezes hoje</div>
                            </div>
                            <div className="p-2 border rounded">
                              <div className="font-medium">Preços e planos</div>
                              <div className="text-xs text-muted-foreground">156 vezes hoje</div>
                            </div>
                            <div className="p-2 border rounded">
                              <div className="font-medium">Status do pedido</div>
                              <div className="text-xs text-muted-foreground">89 vezes hoje</div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h4 className="font-medium">Aprendizado Contínuo</h4>
                          <div className="text-sm space-y-2">
                            <div className="flex items-center justify-between">
                              <span>Novas respostas hoje</span>
                              <Badge variant="secondary">12</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Feedback positivo</span>
                              <Badge variant="default" className="bg-green-600">96%</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Melhoria semanal</span>
                              <Badge variant="secondary">+2.3%</Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="workflows" className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <Card className="border-2 border-dashed border-green-200 bg-green-50">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-medium text-green-800">Lead Qualification Flow</h4>
                            <Badge className="bg-green-600">Ativo</Badge>
                          </div>
                          <div className="text-sm text-green-700 space-y-2">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                              <span>Mensagem de boas-vindas</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                              <span>Coleta informações básicas</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                              <span>Qualifica interesse</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                              <span>Agenda demo ou escala</span>
                            </div>
                          </div>
                          <div className="mt-3 text-xs text-green-600">
                            67% taxa de conversão • 234 leads este mês
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-2 border-dashed border-blue-200 bg-blue-50">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-medium text-blue-800">Customer Support</h4>
                            <Badge className="bg-blue-600">Ativo</Badge>
                          </div>
                          <div className="text-sm text-blue-700 space-y-2">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                              <span>Categoria do problema</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                              <span>Base de conhecimento</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                              <span>Escala se necessário</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                              <span>Follow-up satisfação</span>
                            </div>
                          </div>
                          <div className="mt-3 text-xs text-blue-600">
                            92% resolução automática • 4.8/5 satisfação
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="space-y-4">
                      <Card className="border-2 border-dashed border-purple-200 bg-purple-50">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-medium text-purple-800">Abandoned Cart Recovery</h4>
                            <Badge className="bg-purple-600">Ativo</Badge>
                          </div>
                          <div className="text-sm text-purple-700 space-y-2">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                              <span>Detecta carrinho abandonado</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                              <span>Espera 1 hora</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                              <span>Envia lembrete personalizado</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                              <span>Oferece desconto se necessário</span>
                            </div>
                          </div>
                          <div className="mt-3 text-xs text-purple-600">
                            23% recuperação • R$ 45K em vendas
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-2 border-dashed border-orange-200 bg-orange-50">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-medium text-orange-800">Order Status Updates</h4>
                            <Badge className="bg-orange-600">Ativo</Badge>
                          </div>
                          <div className="text-sm text-orange-700 space-y-2">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
                              <span>Confirma pedido</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
                              <span>Notifica processamento</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
                              <span>Tracking de envio</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
                              <span>Confirmação entrega</span>
                            </div>
                          </div>
                          <div className="mt-3 text-xs text-orange-600">
                            Auto-atualiza 458 pedidos • 99.1% precisão
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      4 workflows ativos • 1.2K execuções hoje • 96.8% taxa de sucesso
                    </div>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Criar Workflow
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="templates" className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {templates.slice(0, 6).map((template) => (
                      <Card key={template.id} className="glass-card">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">{template.name}</CardTitle>
                            <Badge
                              variant={
                                template.status === 'APPROVED' ? 'default' :
                                  template.status === 'PENDING' ? 'secondary' : 'destructive'
                              }
                            >
                              {template.status === 'APPROVED' ? 'Aprovado' :
                                template.status === 'PENDING' ? 'Pendente' : 'Rejeitado'}
                            </Badge>
                          </div>
                          <CardDescription>{template.category} • {template.language}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="text-sm">
                            {template.components.map((component, index) => (
                              <div key={index} className="mb-2">
                                <span className="font-medium text-xs text-muted-foreground uppercase">
                                  {component.type}:
                                </span>
                                <div className="text-sm mt-1">{component.text}</div>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{template.usageCount} usos</span>
                            <span>{Math.floor((Date.now() - parseDate(template.createdAt).getTime()) / 86400000)}d</span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="integrations" className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Integrações CRM</CardTitle>
                        <CardDescription>
                          Sincronização automática com sistemas internos
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm">CRM Principal</span>
                          </div>
                          <Badge variant="default">Conectado</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm">Sistema de Tickets</span>
                          </div>
                          <Badge variant="default">Conectado</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <span className="text-sm">E-commerce</span>
                          </div>
                          <Badge variant="default">Conectado</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <WarningCircle className="h-4 w-4 text-yellow-600" />
                            <span className="text-sm">Analytics</span>
                          </div>
                          <Badge variant="secondary">Configurando</Badge>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">APIs e Webhooks</CardTitle>
                        <CardDescription>
                          Integrações em tempo real com serviços externos
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Webhook URL</Label>
                          <Input
                            value="https://api.empresa.com/whatsapp/webhook"
                            readOnly
                            className="text-xs"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Token de Verificação</Label>
                          <Input
                            value="********-****-****-****-************"
                            readOnly
                            type="password"
                            className="text-xs"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Status do Webhook</span>
                          <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span className="text-sm text-green-600">Ativo</span>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Última verificação: 2 minutos atrás<br />
                          2.4K eventos processados hoje
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="channels" className="space-y-6">
          <div className="grid gap-6">
            <Card className="glass-morphism-dark border-white/10">
              <CardHeader className="border-b border-white/10">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Users className="h-5 w-5 text-blue-400" />
                      Multi-Channel Orchestrator
                    </CardTitle>
                    <CardDescription className="text-blue-100/60">
                      Gerencie múltiplas instâncias do WhatsApp simultâneamente
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => loadOrchestratorStatus()}
                      variant="outline"
                      size="sm"
                      className="border-white/20 text-blue-100 hover:bg-white/10"
                      disabled={orchestratorLoading}
                    >
                      <ArrowClockwise className={`h-4 w-4 ${orchestratorLoading ? 'animate-spin' : ''}`} />
                      Atualizar
                    </Button>
                    <Button
                      onClick={() => selectedPort === 'auto' ? startOrchestratorInstance() : startOrchestratorInstance(selectedPort)}
                      disabled={startingInstance !== null || orchestratorLoading}
                      className="bg-gradient-to-r from-blue-600 to-purple-600 text-white"
                    >
                      {startingInstance !== null ? (
                        <Spinner className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Plus className="h-4 w-4 mr-2" />
                      )}
                      Nova Instância
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="p-6">
                {/* Orchestrator Controls */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className="space-y-2">
                    <Label className="text-blue-100 text-sm">Porta da Instância</Label>
                    <Select value={selectedPort.toString()} onValueChange={(value) => setSelectedPort(value === 'auto' ? 'auto' : parseInt(value))}>
                      <SelectTrigger className="glass-morphism border-white/20 text-blue-100">
                        <SelectValue placeholder="Selecione uma porta" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automática (próxima disponível)</SelectItem>
                        <SelectItem value="3001">Porta 3001</SelectItem>
                        <SelectItem value="3002">Porta 3002</SelectItem>
                        <SelectItem value="3001">Porta 3001</SelectItem>
                        <SelectItem value="3004">Porta 3004</SelectItem>
                        <SelectItem value="3005">Porta 3005</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-blue-100 text-sm">Nome da Instância (opcional)</Label>
                    <Input
                      placeholder="Ex: Vendas, Suporte, Marketing..."
                      value={instanceName}
                      onChange={(e) => setInstanceName(e.target.value)}
                      className="glass-morphism border-white/20 text-blue-100 placeholder:text-blue-100/40"
                    />
                  </div>
                </div>

                {/* Status Overview */}
                {orchestratorStatus && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <Card className="glass-morphism border-white/10">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-blue-400" />
                          <div>
                            <p className="text-xs text-blue-100/60">Total</p>
                            <p className="text-lg font-bold text-white">{orchestratorStatus.totalInstances}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="glass-morphism border-white/10">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-400" />
                          <div>
                            <p className="text-xs text-blue-100/60">Conectadas</p>
                            <p className="text-lg font-bold text-white">{orchestratorStatus.connectedInstances}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="glass-morphism border-white/10">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full" />
                          <div>
                            <p className="text-xs text-blue-100/60">Livres</p>
                            <p className="text-lg font-bold text-white">{orchestratorStatus.freeInstances}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="glass-morphism border-white/10">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-400" />
                          <div>
                            <p className="text-xs text-blue-100/60">Erros</p>
                            <p className="text-lg font-bold text-white">{orchestratorStatus.errorInstances}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Instances List */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Lightning className="h-5 w-5 text-yellow-400" />
                    Instâncias Ativas
                  </h3>
                  
                  {orchestratorLoading ? (
                    <div className="flex justify-center py-8">
                      <Spinner className="h-8 w-8 text-blue-400 animate-spin" />
                    </div>
                  ) : orchestratorError ? (
                    <Card className="glass-morphism border-red-500/20 bg-red-500/5">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-red-400">
                          <Warning className="h-4 w-4" />
                          <span className="text-sm">{orchestratorError}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ) : orchestratorStatus ? (
                    <div className="grid gap-3">
                      {orchestratorStatus.instances.length === 0 ? (
                        <Card className="glass-morphism border-white/10">
                          <CardContent className="p-6 text-center">
                            <Users className="h-12 w-12 text-blue-100/30 mx-auto mb-3" />
                            <p className="text-blue-100/60 mb-2">Nenhuma instância encontrada</p>
                            <p className="text-sm text-blue-100/40">Inicie sua primeira instância para começar</p>
                          </CardContent>
                        </Card>
                      ) : (
                        orchestratorStatus.instances.map((instance) => {
                          const StatusIcon = STATUS_ICONS[instance.status] || Users
                          const isOperating = operatingPort === instance.port

                          return (
                            <Card key={instance.port} className="glass-morphism border-white/10">
                              <CardContent className="p-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[instance.status] || 'bg-gray-500'}`} />
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-white">
                                          {instance.name || `Instância ${instance.port}`}
                                        </span>
                                        <Badge variant="outline" className="border-white/20 text-blue-100 text-xs">
                                          Porta {instance.port}
                                        </Badge>
                                      </div>
                                      <div className="flex items-center gap-2 mt-1">
                                        <StatusIcon className="h-3 w-3 text-blue-100/60" />
                                        <span className="text-sm text-blue-100/60">
                                          {STATUS_LABELS[instance.status] || 'Desconhecido'}
                                        </span>
                                        {instance.metadata?.phoneNumber && (
                                          <>
                                            <span className="text-blue-100/30">•</span>
                                            <span className="text-xs text-blue-100/50">
                                              {instance.metadata.phoneNumber}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  
                                  <div className="flex items-center gap-2">
                                    {instance.status === 'qr_pending' && (
                                      <Button
                                        onClick={() => checkForChannelQR(instance.port)}
                                        variant="outline"
                                        size="sm"
                                        className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10"
                                      >
                                        <QrCode className="h-4 w-4 mr-1" />
                                        Ver QR
                                      </Button>
                                    )}
                                    
                                    {instance.status === 'connected' && (
                                      <Button
                                        onClick={() => restartOrchestratorInstance(instance.port)}
                                        variant="outline"
                                        size="sm"
                                        disabled={isOperating}
                                        className="border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/10"
                                      >
                                        {isOperating ? (
                                          <Spinner className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <>
                                            <ArrowClockwise className="h-4 w-4 mr-1" />
                                            Reiniciar
                                          </>
                                        )}
                                      </Button>
                                    )}
                                    
                                    {(instance.status === 'error' || instance.status === 'free') && (
                                      <Button
                                        onClick={() => startOrchestratorInstance(instance.port)}
                                        variant="outline"
                                        size="sm"
                                        disabled={startingInstance === instance.port}
                                        className="border-green-500/30 text-green-300 hover:bg-green-500/10"
                                      >
                                        {startingInstance === instance.port ? (
                                          <Spinner className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <>
                                            <Play className="h-4 w-4 mr-1" />
                                            Iniciar
                                          </>
                                        )}
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )
                        })
                      )}
                    </div>
                  ) : (
                    <Card className="glass-morphism border-white/10">
                      <CardContent className="p-6 text-center">
                        <p className="text-blue-100/60">
                          <LoadingPercentText label="Carregando status do orchestrator" showPercent={false} />
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
      {/* Dialog: Gerenciar Conexões (sem desconectar outras contas) */}
      <Dialog open={isConnectionsOpen} onOpenChange={setIsConnectionsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Gerenciar Conexões</DialogTitle>
            <DialogDescription>Troque entre contas conectadas, inicie ou pare instâncias locais. Outras contas permanecem conectadas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Contas 1–9 em localhost</div>
            <div className="divide-y rounded border">
              {waInstances.length === 0 && (
                <div className="p-3 text-sm text-muted-foreground">
                  <LoadingPercentText label="Carregando" showPercent={false} />
                </div>
              )}
              {waInstances.map((inst) => (
                <div key={inst.instance} className="p-3 flex items-center justify-between gap-3 flex-wrap md:flex-nowrap">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${inst.alive ? (inst.ready ? 'bg-green-500' : 'bg-yellow-500') : 'bg-gray-400'}`}></span>
                      <span className="truncate">Conta {inst.instance}{inst.name ? ` • ${inst.name}` : ''}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {inst.alive ? (inst.ready ? 'Conectada' : (inst.status || 'Inicializando')) : 'Livre'}
                      {inst.lastContactName ? ` • Último: ${inst.lastContactName}${inst.lastContactPhone ? ` (${inst.lastContactPhone})` : ''}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-2 md:mt-0">
                    <div className="inline-flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => attachToInstance(inst.instance)}>Usar</Button>
                      {!inst.alive ? (
                        <Button size="sm" onClick={() => attachToInstance(inst.instance)}>Iniciar</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => stopInstance(inst.instance)}>Parar</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => renameInstance(inst.instance, inst.name || undefined)}>Renomear</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setIsConnectionsOpen(false)}>Fechar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Search Results Dialog (local and global) */}
      <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Resultados da busca</DialogTitle>
            {searchMode === 'global' ? (
              <DialogDescription>
                {(globalResults?.meta?.total?.messages || 0)} mensagens • {(globalResults?.meta?.total?.contacts || 0)} contatos • {(globalResults?.meta?.total?.media || 0)} mídias
              </DialogDescription>
            ) : (
              <DialogDescription>{lastSearchResults.length} resultado(s)</DialogDescription>
            )}
          </DialogHeader>

          {searchMode === 'global' ? (
            <div className="space-y-3">
              {/* Controls */}
              <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                <div className="md:col-span-2">
                  <Label>Termo</Label>
                  <Input value={globalSearchParams.q} onChange={e => setGlobalSearchParams(p => ({ ...p, q: e.target.value }))} placeholder="frase, has:, type:, tag:" />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input value={globalSearchParams.phone || ''} onChange={e => setGlobalSearchParams(p => ({ ...p, phone: e.target.value }))} placeholder="5599999999999" />
                </div>
                <div>
                  <Label>Tag</Label>
                  <Input value={globalSearchParams.tag || ''} onChange={e => setGlobalSearchParams(p => ({ ...p, tag: e.target.value }))} placeholder="vip, lead, ..." />
                </div>
                <div>
                  <Label>Depois de</Label>
                  <Input value={globalSearchParams.after || ''} onChange={e => setGlobalSearchParams(p => ({ ...p, after: e.target.value }))} placeholder="2025-08-18" />
                </div>
                <div>
                  <Label>Antes de</Label>
                  <Input value={globalSearchParams.before || ''} onChange={e => setGlobalSearchParams(p => ({ ...p, before: e.target.value }))} placeholder="2025-08-19" />
                </div>
                <div className="md:col-span-6 flex gap-2">
                  <Button size="sm" onClick={() => performGlobalSearch({ page: 1 })}>Buscar</Button>
                  <Button size="sm" variant="outline" onClick={() => { setGlobalSearchParams({ q: '' }); setGlobalResults(null); }}>Limpar</Button>
                  {/* Quick chips */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={globalSearchParams.has === 'media' ? 'default' : 'secondary'} className="cursor-pointer" onClick={() => performGlobalSearch({ has: globalSearchParams.has === 'media' ? '' : 'media', page: 1 })}>
                      mídia ({globalResults?.meta?.total?.media || 0})
                    </Badge>
                    {(['text', 'image', 'video', 'audio', 'document', 'ptt', 'sticker'] as const).map(t => (
                      <Badge key={t} variant={globalSearchParams.type === t ? 'default' : 'secondary'} className="cursor-pointer" onClick={() => performGlobalSearch({ type: globalSearchParams.type === t ? '' : t, page: 1 })}>
                        {t} {globalResults?.meta?.facets?.byType?.[t] != null ? `(${globalResults?.meta?.facets?.byType?.[t]})` : ''}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Contacts */}
                <div className="md:col-span-1">
                  <div className="text-sm font-medium mb-2">Contatos ({globalResults?.meta?.total?.contacts || 0})</div>
                  <div className="max-h-64 overflow-auto space-y-2 pr-1">
                    {(globalResults?.contacts || []).map((c: any) => (
                      <div key={c.id} className="p-2 border rounded">
                        <div className="text-sm font-medium">{c.name || c.id}</div>
                        <div className="text-[11px] text-muted-foreground">{c.id}</div>
                        <div className="text-[11px] text-muted-foreground">{(c.tags || []).join(', ')}</div>
                      </div>
                    ))}
                    {(!globalResults || (globalResults.contacts || []).length === 0) && (
                      <div className="text-xs text-muted-foreground">Nenhum contato</div>
                    )}
                  </div>
                </div>
                {/* Messages */}
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">Mensagens ({globalResults?.meta?.total?.messages || 0})</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span>Página {globalPage}/{totalGlobalPages}</span>
                      <Button size="sm" variant="outline" disabled={globalPage <= 1} onClick={() => performGlobalSearch({ page: globalPage - 1 })}>Anterior</Button>
                      <Button size="sm" variant="outline" disabled={globalPage >= totalGlobalPages} onClick={() => performGlobalSearch({ page: globalPage + 1 })}>Próxima</Button>
                    </div>
                  </div>
                  <div className="max-h-96 overflow-auto space-y-2 pr-1">
                    {(globalResults?.messages || []).map((m: any, idx: number) => (
                      <div key={m.id || idx} className="p-2 border rounded text-sm">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{m.chatId || 'chat'}</span>
                          <span>{m.createdAt ? new Date(m.createdAt).toLocaleString('pt-BR') : ''}</span>
                        </div>
                        <div className="mt-1"><span className="text-[11px] uppercase mr-2 opacity-70">{m.type}</span>{m.body || ''}</div>
                      </div>
                    ))}
                    {(!globalResults || (globalResults.messages || []).length === 0) && (
                      <div className="text-xs text-muted-foreground">Nenhuma mensagem</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-auto space-y-2">
              {lastSearchResults.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum resultado</div>
              ) : (
                lastSearchResults.map((item: any, idx: number) => (
                  <div key={item.id || idx} className="p-2 border rounded text-sm">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{item.chatId || item.from || 'chat'}</span>
                      <span>{item.timestamp ? new Date(item.timestamp).toLocaleString('pt-BR') : ''}</span>
                    </div>
                    <div className="mt-1">{item.text || item.content || JSON.stringify(item)}</div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <div className="text-xs text-muted-foreground">
              {searchMode === 'global' ? `Mostrando até ${globalPageSize} por página` : ''}
            </div>
            <div className="flex gap-2">
              {searchMode === 'global' ? (
                <>
                  <Button variant="outline" onClick={() => { setGlobalResults(null); setIsSearchOpen(false) }}>Fechar</Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setLastSearchResults([])}>Limpar</Button>
                  <Button onClick={() => setIsSearchOpen(false)}>Fechar</Button>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Forward dialog UI (select contact/chat or manual phone)
function ForwardDialog({ open, onOpenChange, contacts, onConfirm }: { open: boolean, onOpenChange: (v: boolean) => void, contacts: { id: string, name: string, phone: string }[], onConfirm: (target: string) => void }) {
  const [mode, setMode] = useState<'contact' | 'phone'>('contact')
  const [selectedId, setSelectedId] = useState<string>('')
  const [manual, setManual] = useState('')
  useEffect(() => { if (!open) { setSelectedId(''); setManual(''); setMode('contact') } }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagens</DialogTitle>
          <DialogDescription>Selecione um contato existente ou informe um número</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant={mode === 'contact' ? 'default' : 'outline'} size="sm" onClick={() => setMode('contact')}>Contatos</Button>
            <Button variant={mode === 'phone' ? 'default' : 'outline'} size="sm" onClick={() => setMode('phone')}>Número</Button>
          </div>
          {mode === 'contact' ? (
            <div className="space-y-2">
              <Label>Contato</Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um contato" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map(c => (<SelectItem key={c.id} value={c.id}>{c.name} ({c.phone})</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Número (ex: +5511999999999)</Label>
              <Input value={manual} onChange={e => setManual(e.target.value)} />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => {
              const target = mode === 'contact' ? (selectedId || '') : manual.trim()
              if (!target) return
              onConfirm(target)
              onOpenChange(false)
            }}>Encaminhar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
