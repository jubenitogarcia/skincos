import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { Button } from "@/button"
import { Input } from "@/input"
import { ScrollArea } from "@/scroll-area"
import { Textarea } from "@/textarea"
import { Label } from "@/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { useKV } from "@/spark-mock"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/dialog"
import { toast } from "sonner"
import * as QRCode from "qrcode"
import { getRelativeTime } from "@/utils"
import { buildCrmBasicAuthHeaders } from "@/waOrchestratorAuth"
import { useIntegrations } from "@/contexts"
import {
  fetchRecentCommentLeads,
  fetchRecentDMConversations,
  sendDirectMessage,
  type InstagramDMMessage,
  type InstagramUserProfile
} from "@/instagramIntegration"
import {
  Phone,
  Envelope,
  WhatsappLogo,
  InstagramLogo,
  FacebookLogo,
  ChatCircle,
  VideoCamera,
  CalendarBlank,
  User,
  Clock,
  CheckCircle,
  Warning,
  Sparkle,
  Ticket,
  Star
} from "@phosphor-icons/react"
import type { Activity } from "@/types"

interface SupportTicket {
  id: string
  ticketNumber: string
  subject: string
  description: string
  customer: string
  customerEmail: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'in-progress' | 'waiting-customer' | 'resolved' | 'closed'
  category: 'technical' | 'billing' | 'general' | 'feature-request' | 'bug'
  assignedTo?: string
  createdDate: string
  lastUpdate: string
  resolution?: string
  satisfactionRating?: number
  communicationHistory: any[]
  tags: string[]
}

type SystemConfig = {
  integrations?: {
    harmonia?: {
      debugToken?: string
      execToken?: string
    }
    facebook?: {
      pageId?: string
      accessToken?: string
    }
  }
}

type HarmoniaHealth = {
  ok: boolean
  harmonia?: {
    dbConfigured?: boolean
    execTokenConfigured?: boolean
  }
  ts?: string
}

type HarmoniaUnit = {
  id?: string
  slug?: string
  name?: string
}

type HarmoniaConversation = {
  id?: string
  stage?: string
  unit_id?: string
  contact_id?: string
  procedure_code?: string | null
  procedure_confidence?: number | null
  last_inbound_at?: string | null
  last_outbound_at?: string | null
  lead_speed_class?: string | null
  created_at?: string
  updated_at?: string
  contact_phone_raw?: string
  contact_display_name?: string | null
  opted_out_at?: string | null
}

type HarmoniaMessage = {
  id?: string
  direction?: 'inbound' | 'outbound' | string
  provider_message_id?: string
  text?: string | null
  message_type?: string | null
  caption?: string | null
  created_at?: string
}

type HarmoniaInboxItem = {
  id: string
  unit_slug?: string
  unit_name?: string
  stage?: string
  contact_phone_raw?: string
  contact_display_name?: string | null
  contact_opted_out_at?: string | null
  last_message_direction?: string | null
  last_message_text?: string | null
  last_message_at?: string | null
  last_activity_at?: string | null
}

interface OmnichannelCenterProps {
  activities: Activity[]
  onStartConversation?: (channel: string, customerId: string) => void
}

type ChannelStatus = 'free' | 'available' | 'starting' | 'qr_pending' | 'connected' | 'error' | 'stopping'

interface ChannelInstance {
  id: string
  port: number
  channel: number
  status: ChannelStatus
  name?: string
  createdAt?: string
  updatedAt?: string
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

const HARMONIA_DEBUG_TOKEN_KEY = 'harmonia.debugToken'
const HARMONIA_EXEC_TOKEN_KEY = 'harmonia.execToken'
const HARMONIA_UNIT_KEY = 'harmonia.ui.unitSlug'
const MIN_PHONE_LEN = 8

function normalizePhone(value?: string | null) {
  return String(value || '').replace(/\D+/g, '')
}

function extractPhoneFromId(value?: string | null) {
  const digits = normalizePhone(value)
  return digits.length >= MIN_PHONE_LEN ? digits : ''
}

function normalizeName(value?: string | null) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function namesMatch(a?: string | null, b?: string | null) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return true
  const tokensA = na.split(' ').filter((t) => t.length >= 3)
  const tokensB = nb.split(' ').filter((t) => t.length >= 3)
  if (!tokensA.length || !tokensB.length) return true
  return tokensA.some((t) => tokensB.includes(t))
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(d)
  } catch {
    return String(iso)
  }
}

function resolveMediaLabel(message: HarmoniaMessage) {
  const rawType = String(message?.message_type || '').toLowerCase()
  if (!rawType) return null
  if (rawType.includes('image')) return 'Imagem'
  if (rawType.includes('audio') || rawType.includes('ptt') || rawType.includes('voice')) return 'Áudio'
  if (rawType.includes('document') || rawType.includes('pdf') || rawType.includes('doc')) return 'Documento'
  if (rawType.includes('video')) return 'Vídeo'
  if (rawType.includes('sticker')) return 'Sticker'
  return null
}

function resolveMessageCaption(message: HarmoniaMessage) {
  const text = String(message?.text || '').trim()
  if (text) return text
  const caption = String(message?.caption || '').trim()
  return caption || ''
}

export function OmnichannelCenter({ activities, onStartConversation }: OmnichannelCenterProps) {
  const { instagram, connectInstagram, refreshInstagram } = useIntegrations()
  const [systemConfig, setSystemConfig] = useKV<SystemConfig>("system-config", {
    integrations: { harmonia: { debugToken: '', execToken: '' }, facebook: { pageId: '', accessToken: '' } }
  })
  const [provider, setProvider] = useState<string | null>(null)
  const [tickets, setTickets] = useKV<SupportTicket[]>("support-tickets", [
    {
      id: "ticket-001",
      ticketNumber: "SUP-2024-001",
      subject: "Problema de login no sistema",
      description: "Não consigo acessar minha conta no CRM após a atualização",
      customer: "João Silva",
      customerEmail: "joao.silva@empresa.com",
      priority: "high",
      status: "in-progress",
      category: "technical",
      assignedTo: "Ana Costa",
      createdDate: "2024-03-15",
      lastUpdate: "2024-03-20",
      communicationHistory: [],
      tags: ["login", "urgente"]
    },
    {
      id: "ticket-002",
      ticketNumber: "SUP-2024-002",
      subject: "Solicitação de nova funcionalidade",
      description: "Gostaria de solicitar a implementação de relatórios customizados",
      customer: "Maria Santos",
      customerEmail: "maria.santos@cliente.com",
      priority: "medium",
      status: "open",
      category: "feature-request",
      createdDate: "2024-03-18",
      lastUpdate: "2024-03-18",
      communicationHistory: [],
      tags: ["relatórios", "customização"]
    }
  ])
  const [conversations, setConversations] = useState<any[]>([])
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [conversationsFailureCount, setConversationsFailureCount] = useState(0)
  const [conversationsPausedUntil, setConversationsPausedUntil] = useState<number | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus | null>(null)
  const [statusFailureCount, setStatusFailureCount] = useState(0)
  const [statusPausedUntil, setStatusPausedUntil] = useState<number | null>(null)
  const [channelQR, setChannelQR] = useState<Map<number, QRData>>(new Map())
  const [qrDialogChannel, setQrDialogChannel] = useState<number | null>(null)
  const qrPollingRef = useRef<Map<number, NodeJS.Timeout>>(new Map())
  const [waStatusOpen, setWaStatusOpen] = useState(false)
  const [igStatusOpen, setIgStatusOpen] = useState(false)
  const [igDialogOpen, setIgDialogOpen] = useState(false)
  const [igOauthStatus, setIgOauthStatus] = useState<{ configured: boolean; missing?: string[] } | null>(null)
  const [igOauthLoading, setIgOauthLoading] = useState(false)
  const [fbStatusOpen, setFbStatusOpen] = useState(false)
  const [fbDialogOpen, setFbDialogOpen] = useState(false)
  const [igAccessToken, setIgAccessToken] = useState('')
  const [igBusinessId, setIgBusinessId] = useState('')
  const [fbAccessToken, setFbAccessToken] = useState('')
  const [fbPageId, setFbPageId] = useState('')
  const [igLoading, setIgLoading] = useState(false)
  const [igProfiles, setIgProfiles] = useState<Record<string, InstagramUserProfile>>({})
  const [igDMs, setIgDMs] = useState<Record<string, InstagramDMMessage[]>>({})
  const facebookConfig = systemConfig?.integrations?.facebook || { pageId: '', accessToken: '' }
  const facebookConfigured = Boolean(String(facebookConfig?.pageId || '').trim() && String(facebookConfig?.accessToken || '').trim())
  const [showNewTicket, setShowNewTicket] = useState(false)
  const [ticketFilter, setTicketFilter] = useState<'total' | 'open' | 'overdue' | 'resolved'>('total')
  const [ticketsModalOpen, setTicketsModalOpen] = useState(false)
  const [newTicket, setNewTicket] = useState<Partial<SupportTicket>>({
    priority: 'medium',
    status: 'open',
    category: 'general',
    communicationHistory: [],
    tags: []
  })
  const [harmoniaHealth, setHarmoniaHealth] = useState<HarmoniaHealth | null>(null)
  const [harmoniaUnits, setHarmoniaUnits] = useState<HarmoniaUnit[]>([])
  const [harmoniaUnitSlug, setHarmoniaUnitSlug] = useState<string>(() => {
    try {
      return localStorage.getItem(HARMONIA_UNIT_KEY) || ''
    } catch {
      return ''
    }
  })
  const [harmoniaInbox, setHarmoniaInbox] = useState<HarmoniaInboxItem[]>([])
  const [harmoniaInboxCursor, setHarmoniaInboxCursor] = useState<{ cursorTs: string | null; cursorId: string | null } | null>(null)
  const [harmoniaInboxLoading, setHarmoniaInboxLoading] = useState(false)
  const [harmoniaInboxError, setHarmoniaInboxError] = useState<string | null>(null)
  const [harmoniaInboxFailureCount, setHarmoniaInboxFailureCount] = useState(0)
  const [harmoniaInboxPausedUntil, setHarmoniaInboxPausedUntil] = useState<number | null>(null)
  const [harmoniaConversation, setHarmoniaConversation] = useState<HarmoniaConversation | null>(null)
  const [harmoniaMessages, setHarmoniaMessages] = useState<HarmoniaMessage[]>([])
  const [harmoniaMessagesLoading, setHarmoniaMessagesLoading] = useState(false)
  const [harmoniaActionLoading, setHarmoniaActionLoading] = useState(false)
  const [harmoniaActionError, setHarmoniaActionError] = useState<string | null>(null)
  const [harmoniaActionSuccess, setHarmoniaActionSuccess] = useState<string | null>(null)
  const harmoniaActionTimerRef = useRef<number | null>(null)
  const harmoniaTokens = systemConfig?.integrations?.harmonia || {}
  const resolvedExecToken = useMemo(() => {
    let token = harmoniaTokens.execToken || ''
    if (!token) {
      try {
        token = localStorage.getItem(HARMONIA_EXEC_TOKEN_KEY) || ''
      } catch { /* ignore */ }
    }
    return token
  }, [harmoniaTokens.execToken])
  const execRequired = Boolean(harmoniaHealth?.harmonia?.execTokenConfigured)
  const canExecute = !execRequired || Boolean(resolvedExecToken)

  const normalizeOrchestratorStatus = useCallback((payload: any) => {
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
          ? Math.max(1, Number(ch.port) - 3000)
          : index + 1
      const status = (ch?.status === 'available' ? 'free' : ch?.status) || 'free'
      return {
        id: ch?.id || `channel-${resolvedChannel}`,
        port: ch?.port ?? (3000 + resolvedChannel),
        channel: resolvedChannel,
        status,
        name: ch?.name,
        createdAt: ch?.createdAt,
        updatedAt: ch?.updatedAt,
        metadata: ch?.metadata || {}
      }
    })

    return {
      provider: payload?.provider,
      totalChannels: payload?.totalChannels ?? normalizedInstances.length,
      availableChannels: payload?.availableChannels,
      freeInstances: payload?.freeInstances ?? normalizedInstances.filter((c) => c.status === 'free').length,
      connectedInstances: payload?.connectedInstances ?? normalizedInstances.filter((c) => c.status === 'connected').length,
      errorInstances: payload?.errorInstances ?? normalizedInstances.filter((c) => c.status === 'error').length,
      startingInstances: payload?.startingInstances ?? normalizedInstances.filter((c) => c.status === 'starting' || c.status === 'qr_pending').length,
      instances: normalizedInstances,
      availableChannelsList:
        payload?.availableChannelsList ?? normalizedInstances.map((c) => c.channel),
      freeChannelsList:
        payload?.freeChannelsList ?? normalizedInstances.filter((c) => c.status === 'free').map((c) => c.channel)
    } satisfies OrchestratorStatus
  }, [])

  const loadStatus = useCallback(async () => {
    if (statusPausedUntil && Date.now() < statusPausedUntil) return
    try {
      const res = await fetch('/api/wa-orchestrator/status', { headers: buildCrmBasicAuthHeaders() })
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.success === false) return
      setProvider(data?.provider || null)
      const normalized = normalizeOrchestratorStatus(data)
      setOrchestratorStatus(normalized)
      setStatusFailureCount(0)
      setStatusPausedUntil(null)
    } catch {
      setStatusFailureCount((prev) => {
        const next = prev + 1
        if (next >= 5) {
          setStatusPausedUntil(Date.now() + 60000)
          return 0
        }
        return next
      })
    }
  }, [normalizeOrchestratorStatus, statusPausedUntil])

  const loadConversations = useCallback(async () => {
    if (!provider) return
    if (conversationsPausedUntil && Date.now() < conversationsPausedUntil) return
    setLoadingConversations(true)
    try {
      if (provider === 'evolution') {
        const channels =
          orchestratorStatus?.instances
            ?.filter((instance) => instance.status === 'connected')
            .map((instance) => instance.channel) || []
        if (!channels.length) {
          setConversations([])
          return
        }
        const results = await Promise.all(
          channels.map(async (channel) => {
            const res = await fetch(
              `/api/wa-orchestrator/channels/${channel}/conversations?limit=200`,
              { headers: buildCrmBasicAuthHeaders() }
            )
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data?.success) return []
            return (data.items || []).map((item: any) => ({ ...item, channel, platform: 'whatsapp' }))
          })
        )
        setConversations(results.flat())
      } else {
        const res = await fetch('/api/conversations')
        const data = await res.json()
        if (res.ok) {
          setConversations(data?.items || data || [])
        }
      }
      setConversationsFailureCount(0)
      setConversationsPausedUntil(null)
    } catch {
      setConversationsFailureCount((prev) => {
        const next = prev + 1
        if (next >= 5) {
          setConversationsPausedUntil(Date.now() + 60000)
          return 0
        }
        return next
      })
    } finally {
      setLoadingConversations(false)
    }
  }, [provider, orchestratorStatus, conversationsPausedUntil])

  const loadMessages = useCallback(async (conv: any) => {
    if (!provider || !conv) return
    setLoadingMessages(true)
    try {
      if (provider === 'evolution') {
        const channel = Number(conv?.channel)
        if (!channel) return
        const res = await fetch(
          `/api/wa-orchestrator/channels/${channel}/conversations/${encodeURIComponent(conv.conversationId)}/messages?limit=80`,
          { headers: buildCrmBasicAuthHeaders() }
        )
        const data = await res.json()
        if (res.ok && data?.success) {
          setMessages(data.items || [])
        }
      } else {
        const res = await fetch(`/api/conversations/${encodeURIComponent(conv.conversationId)}/messages?limit=80`)
        const data = await res.json()
        if (res.ok) {
          setMessages(data.items || [])
        }
      }
    } finally {
      setLoadingMessages(false)
    }
  }, [provider])

  const loadInstagramConversations = useCallback(async () => {
    if (!instagram?.connected) return
    setIgLoading(true)
    try {
      const [profiles, dms] = await Promise.all([
        fetchRecentCommentLeads(instagram.businessAccountId, igAccessToken || undefined),
        fetchRecentDMConversations(instagram.businessAccountId, igAccessToken || undefined)
      ])
      const profileMap: Record<string, InstagramUserProfile> = {}
      profiles.forEach((p) => { profileMap[p.id] = p })
      setIgProfiles(profileMap)
      setIgDMs(dms || {})
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao carregar DMs do Instagram')
    } finally {
      setIgLoading(false)
    }
  }, [igAccessToken, instagram?.businessAccountId, instagram?.connected])

  const loadInstagramOauthStatus = useCallback(async () => {
    setIgOauthLoading(true)
    try {
      const res = await fetch('/api/instagram/oauth/status', { credentials: 'include', headers: { accept: 'application/json' } })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        setIgOauthStatus({ configured: Boolean(data?.configured), missing: data?.missing || [] })
      } else {
        setIgOauthStatus({ configured: false, missing: ['oauth_status_failed'] })
      }
    } catch {
      setIgOauthStatus({ configured: false, missing: ['oauth_status_failed'] })
    } finally {
      setIgOauthLoading(false)
    }
  }, [])

  const startInstagramOAuth = useCallback(() => {
    const w = 520
    const h = 720
    const left = Math.max(0, Math.floor((window.screen.width - w) / 2))
    const top = Math.max(0, Math.floor((window.screen.height - h) / 2))
    const popup = window.open('/api/instagram/oauth/start', 'instagram_oauth', `width=${w},height=${h},left=${left},top=${top}`)
    if (!popup) {
      toast.error('Pop-up bloqueado. Permita pop-ups e tente novamente.')
      return
    }
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return
      if (ev.data?.type === 'instagram:connected' && ev.data?.ok) {
        toast.success('Instagram conectado')
        void refreshInstagram()
        setIgDialogOpen(false)
        window.removeEventListener('message', onMsg)
      }
    }
    window.addEventListener('message', onMsg)
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer)
        window.removeEventListener('message', onMsg)
      }
    }, 500)
  }, [refreshInstagram])

  const handleConnectInstagram = useCallback(async () => {
    if (!igAccessToken.trim() || !igBusinessId.trim()) {
      toast.error('Informe Access Token e Business Account ID.')
      return
    }
    setIgLoading(true)
    try {
      await connectInstagram(igAccessToken.trim(), igBusinessId.trim())
      toast.success('Instagram conectado')
      setIgDialogOpen(false)
      await loadInstagramConversations()
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao conectar Instagram')
    } finally {
      setIgLoading(false)
    }
  }, [connectInstagram, igAccessToken, igBusinessId, loadInstagramConversations])

  const handleConnectFacebook = useCallback(() => {
    const nextPageId = fbPageId.trim()
    const nextToken = fbAccessToken.trim()
    setSystemConfig(prev => ({
      ...prev,
      integrations: {
        ...(prev.integrations || {}),
        facebook: {
          pageId: nextPageId,
          accessToken: nextToken
        }
      }
    }))
    toast.success(nextPageId && nextToken ? 'Configuração do Facebook salva' : 'Dados do Facebook atualizados')
    setFbDialogOpen(false)
  }, [fbAccessToken, fbPageId, setSystemConfig])

  const sendMessage = useCallback(async () => {
    if (!selectedConversation || !messageInput.trim()) return
    const isLeadOnly = selectedConversation?.platform === 'lead'
    setSendingMessage(true)
    try {
      if (selectedConversation?.platform === 'instagram') {
        const sent = await sendDirectMessage(
          selectedConversation.conversationId,
          messageInput.trim(),
          instagram.businessAccountId,
          igAccessToken || undefined
        )
        setIgDMs((prev) => {
          const next = { ...prev }
          const current = next[selectedConversation.conversationId] || []
          next[selectedConversation.conversationId] = [...current, sent]
          return next
        })
        setMessages((prev) => [...prev, sent])
      } else if (provider === 'evolution') {
        const channel =
          Number(selectedConversation?.channel) ||
          orchestratorStatus?.instances?.find((instance) => instance.status === 'connected')?.channel
        if (!channel) {
          toast.error('Nenhum canal WhatsApp conectado para envio.')
          return
        }
        const phoneKey = extractPhoneFromId(selectedConversation?.phone || selectedConversation?.leadPhone || '')
        const remoteJid = isLeadOnly
          ? (phoneKey ? `${phoneKey}@s.whatsapp.net` : '')
          : String(selectedConversation.conversationId || '')
        if (!remoteJid) {
          toast.error('Número inválido para envio.')
          return
        }
        const res = await fetch(
          `/api/wa-orchestrator/channels/${channel}/conversations/${encodeURIComponent(remoteJid)}/send`,
          {
            method: 'POST',
            headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ text: messageInput })
          }
        )
        await res.json().catch(() => ({}))
        if (isLeadOnly) {
          setHarmoniaMessages((prev) => [
            ...prev,
            { id: `out-${Date.now()}`, direction: 'outbound', text: messageInput, created_at: new Date().toISOString() }
          ])
        }
      } else if (isLeadOnly) {
        toast.error('Envio direto de lead requer WhatsApp conectado.')
        return
      } else {
        const res = await fetch(`/api/conversations/${encodeURIComponent(selectedConversation.conversationId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction: 'outbound', type: 'text', text: messageInput })
        })
        await res.json().catch(() => ({}))
      }
      setMessageInput('')
      if (selectedConversation?.platform !== 'instagram' && !isLeadOnly) {
        loadMessages(selectedConversation)
      }
    } finally {
      setSendingMessage(false)
    }
  }, [igAccessToken, instagram.businessAccountId, loadMessages, messageInput, provider, selectedConversation, orchestratorStatus])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    void refreshInstagram()
  }, [refreshInstagram])

  useEffect(() => {
    if (instagram?.businessAccountId) {
      setIgBusinessId(instagram.businessAccountId)
    }
  }, [instagram?.businessAccountId])

  useEffect(() => {
    if (igDialogOpen) {
      void loadInstagramOauthStatus()
    }
  }, [igDialogOpen, loadInstagramOauthStatus])

  useEffect(() => {
    const nextPageId = String(facebookConfig?.pageId || '')
    const nextToken = String(facebookConfig?.accessToken || '')
    if (nextPageId && nextPageId !== fbPageId) {
      setFbPageId(nextPageId)
    }
    if (nextToken && nextToken !== fbAccessToken) {
      setFbAccessToken(nextToken)
    }
  }, [facebookConfig?.pageId, facebookConfig?.accessToken, fbAccessToken, fbPageId])

  useEffect(() => {
    if (!instagram?.connected) return
    void loadInstagramConversations()
  }, [instagram?.connected, loadInstagramConversations])

  useEffect(() => {
    const interval = setInterval(() => {
      loadStatus()
    }, 15000)
    return () => clearInterval(interval)
  }, [loadStatus])

  useEffect(() => {
    if (selectedConversation?.platform === 'instagram') {
      const convo = igDMs[selectedConversation.conversationId] || []
      setMessages(convo)
    }
  }, [igDMs, selectedConversation])

  useEffect(() => {
    return () => {
      if (harmoniaActionTimerRef.current) window.clearTimeout(harmoniaActionTimerRef.current)
    }
  }, [])

  useEffect(() => {
    let storedDebug = ''
    let storedExec = ''
    try {
      storedDebug = localStorage.getItem(HARMONIA_DEBUG_TOKEN_KEY) || ''
      storedExec = localStorage.getItem(HARMONIA_EXEC_TOKEN_KEY) || ''
    } catch { /* ignore */ }

    const nextDebug = harmoniaTokens.debugToken || storedDebug
    const nextExec = harmoniaTokens.execToken || storedExec

    if (!nextDebug && !nextExec) return
    if (nextDebug === harmoniaTokens.debugToken && nextExec === harmoniaTokens.execToken) return

    setSystemConfig((prev) => ({
      ...(prev || {}),
      integrations: {
        ...(prev?.integrations || {}),
        harmonia: {
          ...(prev?.integrations?.harmonia || {}),
          debugToken: nextDebug,
          execToken: nextExec,
        },
      },
    }))
  }, [harmoniaTokens.debugToken, harmoniaTokens.execToken, setSystemConfig])

  const harmoniaApiJson = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      let debugToken = harmoniaTokens.debugToken || ''
      let execToken = harmoniaTokens.execToken || ''
      if (!debugToken || !execToken) {
        try {
          debugToken = debugToken || (localStorage.getItem(HARMONIA_DEBUG_TOKEN_KEY) || '')
          execToken = execToken || (localStorage.getItem(HARMONIA_EXEC_TOKEN_KEY) || '')
        } catch { /* ignore */ }
      }
      const res = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init?.body ? { 'content-type': 'application/json' } : null),
          ...(debugToken ? { 'x-harmonia-token': debugToken } : null),
          ...(execToken ? { 'x-harmonia-exec-token': execToken } : null),
          ...(init?.headers || {}),
        },
        credentials: 'include',
      })
      const text = await res.text()
      let json: unknown = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
      if (res.ok) return json as T
      const err = (json || {}) as { error?: string; message?: string }
      throw new Error(err.error || err.message || `HTTP ${res.status}`)
    },
    [harmoniaTokens.debugToken, harmoniaTokens.execToken]
  )

  const refreshHarmonia = useCallback(async () => {
    try {
      const [h, u] = await Promise.all([
        harmoniaApiJson<HarmoniaHealth>('/api/harmonia/health'),
        harmoniaApiJson<{ ok: boolean; data?: HarmoniaUnit[] }>('/api/harmonia/units').catch(() => ({ ok: false, data: [] })),
      ])
      setHarmoniaHealth(h || null)
      setHarmoniaUnits(Array.isArray((u as any)?.data) ? (u as any).data : [])
    } catch {
      setHarmoniaHealth(null)
      setHarmoniaUnits([])
    }
  }, [harmoniaApiJson])

  useEffect(() => {
    void refreshHarmonia()
  }, [refreshHarmonia])

  useEffect(() => {
    if (harmoniaUnitSlug) {
      try {
        localStorage.setItem(HARMONIA_UNIT_KEY, harmoniaUnitSlug)
      } catch { /* ignore */ }
    }
  }, [harmoniaUnitSlug])

  useEffect(() => {
    if (harmoniaUnitSlug) return
    const first = harmoniaUnits.find((u) => u?.slug)?.slug
    if (first) setHarmoniaUnitSlug(String(first))
  }, [harmoniaUnitSlug, harmoniaUnits])

  const loadHarmoniaInbox = useCallback(async (mode: 'reset' | 'more' = 'reset') => {
    const slug = String(harmoniaUnitSlug || '').trim()
    if (!harmoniaHealth?.harmonia?.dbConfigured || !slug) return
    if (harmoniaInboxPausedUntil && Date.now() < harmoniaInboxPausedUntil) return
    setHarmoniaInboxLoading(true)
    setHarmoniaInboxError(null)
    try {
      const qs = new URLSearchParams()
      qs.set('unitSlug', slug)
      qs.set('limit', '30')
      const cursor = mode === 'more' ? harmoniaInboxCursor : null
      if (cursor?.cursorTs) qs.set('cursorTs', String(cursor.cursorTs))
      if (cursor?.cursorId) qs.set('cursorId', String(cursor.cursorId))

      const out = await harmoniaApiJson<{ ok: boolean; data?: { items?: HarmoniaInboxItem[]; nextCursor?: { cursorTs?: string | null; cursorId?: string | null } | null } }>(
        `/api/harmonia/conversations?${qs.toString()}`
      )
      const items = Array.isArray(out?.data?.items) ? out.data!.items! : []
      const next = out?.data?.nextCursor
        ? { cursorTs: out.data!.nextCursor!.cursorTs || null, cursorId: out.data!.nextCursor!.cursorId || null }
        : null
      setHarmoniaInboxCursor(next)
      if (mode === 'reset') {
        setHarmoniaInbox(items)
      } else {
        setHarmoniaInbox((prev) => {
          const seen = new Set(prev.map((it) => it.id))
          const merged = [...prev]
          items.forEach((it) => {
            if (!seen.has(it.id)) merged.push(it)
          })
          return merged
        })
      }
      setHarmoniaInboxFailureCount(0)
      setHarmoniaInboxPausedUntil(null)
    } catch (e: any) {
      setHarmoniaInboxError(e?.message || 'Falha ao carregar leads.')
      setHarmoniaInboxFailureCount((prev) => {
        const next = prev + 1
        if (next >= 5) {
          setHarmoniaInboxPausedUntil(Date.now() + 60000)
          return 0
        }
        return next
      })
    } finally {
      setHarmoniaInboxLoading(false)
    }
  }, [harmoniaApiJson, harmoniaHealth?.harmonia?.dbConfigured, harmoniaUnitSlug, harmoniaInboxPausedUntil, harmoniaInboxCursor])

  useEffect(() => {
    setHarmoniaInboxCursor(null)
    void loadHarmoniaInbox('reset')
  }, [loadHarmoniaInbox])

  const openHarmoniaConversationById = useCallback(
    async (id: string) => {
      const cid = String(id || '').trim()
      if (!cid) return
      setHarmoniaMessagesLoading(true)
      setHarmoniaActionError(null)
      setHarmoniaActionSuccess(null)
      try {
        const [c, m] = await Promise.all([
          harmoniaApiJson<{ ok: boolean; data?: HarmoniaConversation }>(`/api/harmonia/conversations/${encodeURIComponent(cid)}`),
          harmoniaApiJson<{ ok: boolean; data?: HarmoniaMessage[] }>(
            `/api/harmonia/conversations/${encodeURIComponent(cid)}/messages?limit=80`
          ),
        ])
        const convo = (c as any)?.data || null
        setHarmoniaConversation(convo)
        const list = Array.isArray((m as any)?.data) ? (m as any).data : []
        const ordered = [...list].sort((a, b) => {
          const ta = a?.created_at ? new Date(a.created_at).getTime() : 0
          const tb = b?.created_at ? new Date(b.created_at).getTime() : 0
          return ta - tb
        })
        setHarmoniaMessages(ordered)
      } catch (e: any) {
        toast.error(e?.message || 'Falha ao abrir lead.')
      } finally {
        setHarmoniaMessagesLoading(false)
      }
    },
    [harmoniaApiJson]
  )

  const patchHarmoniaConversation = useCallback(
    async (patch: { stage?: string; lead_speed_class?: string }) => {
      if (!harmoniaConversation?.id) return
      setHarmoniaActionLoading(true)
      setHarmoniaActionError(null)
      try {
        const out = await harmoniaApiJson<{ ok: boolean; data?: HarmoniaConversation }>(
          `/api/harmonia/conversations/${encodeURIComponent(String(harmoniaConversation.id))}/patch`,
          {
            method: 'POST',
            body: JSON.stringify(patch),
          }
        )
        if ((out as any)?.data) {
          setHarmoniaConversation((out as any).data)
          setHarmoniaActionSuccess('Ação aplicada com sucesso.')
          if (harmoniaActionTimerRef.current) window.clearTimeout(harmoniaActionTimerRef.current)
          harmoniaActionTimerRef.current = window.setTimeout(() => setHarmoniaActionSuccess(null), 2500)
        }
      } catch (e: any) {
        setHarmoniaActionError(e?.message || 'Falha ao aplicar ação.')
      } finally {
        setHarmoniaActionLoading(false)
      }
    },
    [harmoniaApiJson, harmoniaConversation]
  )

  const pollChannelQR = useCallback(async (channel: number) => {
    const resolveQrDataUrl = async (qrValue: unknown) => {
      if (typeof qrValue !== 'string') return null
      const normalized = qrValue.trim().replace(/\\\//g, '/')
      if (!normalized) return null
      if (normalized.startsWith('data:image')) return normalized
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length > 120) {
        const mime = normalized.startsWith('/9j/') ? 'jpeg' : 'png'
        return `data:image/${mime};base64,${normalized}`
      }
      return QRCode.toDataURL(normalized, { width: 300, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } })
    }

    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/qr`, {
        headers: buildCrmBasicAuthHeaders()
      })

      if (!response.ok) {
        if (response.status === 404) {
          const timer = setTimeout(() => pollChannelQR(channel), 1500)
          qrPollingRef.current.set(channel, timer)
          return
        }
        throw new Error(`HTTP ${response.status}`)
      }

      const result = await response.json().catch(() => ({}))
      if (!result?.success || (!result?.qr && !result?.dataUrl)) return

      let qrDataUrl: string | undefined
      if (result.dataUrl) {
        qrDataUrl = result.dataUrl
      } else if (result.qr) {
        qrDataUrl = (await resolveQrDataUrl(result.qr)) ?? undefined
      }

      if (qrDataUrl) {
        console.info('[WA_QR_DEBUG] pollChannelQR:resolved', {
          channel,
          qrType: String(result.qr || '').startsWith('data:image') ? 'image-data-url' : 'raw-text',
          qrLength: typeof result.qr === 'string' ? result.qr.length : 0
        })
        setChannelQR(prev => new Map(prev.set(channel, { qr: result.qr || qrDataUrl, dataUrl: qrDataUrl })))
      }
    } catch (err: any) {
      console.error('[WA_QR_DEBUG] pollChannelQR:error', { channel, error: err?.message || String(err) })
      toast.error(`Falha ao carregar QR: ${err.message || 'erro inesperado'}`)
    }
  }, [])

  const startChannel = useCallback(async (channel: number) => {
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/start`, {
        method: 'POST',
        headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({})
      })
      const result = await response.json().catch(() => ({}))
      if (!result?.success) throw new Error(result?.error || 'Falha ao iniciar canal')
      if (result?.qr) {
        const normalizedQr = String(result.qr).trim().replace(/\\\//g, '/')
        const qrDataUrl = normalizedQr.startsWith('data:image')
          ? normalizedQr
          : (/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedQr) && normalizedQr.length > 120)
            ? `data:image/${normalizedQr.startsWith('/9j/') ? 'jpeg' : 'png'};base64,${normalizedQr}`
            : await QRCode.toDataURL(normalizedQr, { width: 300, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } })
        console.info('[WA_QR_DEBUG] startChannel:resolved', {
          channel,
          qrType: normalizedQr.startsWith('data:image') ? 'image-data-url' : 'raw-text',
          qrLength: normalizedQr.length
        })
        setChannelQR(prev => new Map(prev.set(channel, { qr: result.qr || qrDataUrl, dataUrl: qrDataUrl })))
      }
      toast.success(`Canal ${channel} iniciado`)
      pollChannelQR(channel)
    } catch (err: any) {
      const message = err?.message || 'Falha ao iniciar canal'
      console.error('[WA_QR_DEBUG] startChannel:error', { channel, error: message })
      toast.error(message)
    }
  }, [pollChannelQR])

  const resolveNextWhatsAppChannel = useCallback(() => {
    const instances = orchestratorStatus?.instances ?? []
    const sorted = [...instances].sort((a, b) => a.channel - b.channel)

    const pending = sorted.find((instance) => instance.status === 'qr_pending' || instance.status === 'starting')
    if (pending) {
      return { channel: pending.channel, action: 'poll' as const }
    }

    const free = sorted.find((instance) => instance.status === 'free')
    if (free) {
      return { channel: free.channel, action: 'start' as const }
    }

    const freeFromList = [...(orchestratorStatus?.freeChannelsList ?? [])].sort((a, b) => a - b)[0]
    if (freeFromList) {
      return { channel: freeFromList, action: 'start' as const }
    }

    const availableFromList = [...(orchestratorStatus?.availableChannelsList ?? [])].sort((a, b) => a - b)[0]
    if (availableFromList) {
      return { channel: availableFromList, action: 'start' as const }
    }

    return null
  }, [orchestratorStatus])

  const connectWhatsApp = useCallback(async () => {
    const next = resolveNextWhatsAppChannel()
    if (!next?.channel) {
      toast.error('Nenhum canal livre disponível.')
      return
    }

    setQrDialogChannel(next.channel)

    if (next.action === 'poll') {
      pollChannelQR(next.channel)
      return
    }

    await startChannel(next.channel)
  }, [pollChannelQR, resolveNextWhatsAppChannel, startChannel])

  const createTicket = () => {
    if (newTicket.subject && newTicket.customer && newTicket.customerEmail) {
      const ticket: SupportTicket = {
        id: `ticket-${Date.now()}`,
        ticketNumber: `SUP-${new Date().getFullYear()}-${String(tickets.length + 1).padStart(3, '0')}`,
        subject: newTicket.subject,
        description: newTicket.description || '',
        customer: newTicket.customer,
        customerEmail: newTicket.customerEmail,
        priority: newTicket.priority as SupportTicket['priority'],
        status: 'open',
        category: newTicket.category as SupportTicket['category'],
        createdDate: new Date().toISOString().split('T')[0],
        lastUpdate: new Date().toISOString().split('T')[0],
        communicationHistory: [],
        tags: newTicket.tags || []
      }
      setTickets((current) => [...current, ticket])
      setNewTicket({
        priority: 'medium',
        status: 'open',
        category: 'general',
        communicationHistory: [],
        tags: []
      })
      setShowNewTicket(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800'
      case 'in-progress': return 'bg-yellow-100 text-yellow-800'
      case 'waiting-customer': return 'bg-orange-100 text-orange-800'
      case 'resolved': return 'bg-green-100 text-green-800'
      case 'closed': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800'
      case 'high': return 'bg-orange-100 text-orange-800'
      case 'medium': return 'bg-yellow-100 text-yellow-800'
      case 'low': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const supportStats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    const now = Date.now()
    const isOpen = (t: SupportTicket) => ['open', 'in-progress', 'waiting-customer'].includes(t.status)
    const ageHours = (t: SupportTicket) => {
      const stamp = t.lastUpdate || t.createdDate
      const parsed = stamp ? new Date(stamp).getTime() : 0
      if (!parsed) return 0
      return (now - parsed) / 36e5
    }
    const openTickets = tickets.filter((t) => isOpen(t)).length
    const openWithin24 = tickets.filter((t) => isOpen(t) && ageHours(t) <= 24).length
    const overdueTickets = tickets.filter((t) => isOpen(t) && ageHours(t) > 24).length
    const resolvedTickets = tickets.filter((t) => ['resolved', 'closed'].includes(t.status)).length
    const satisfactionRatings = tickets.map((t) => Number(t?.satisfactionRating)).filter((v) => Number.isFinite(v) && v > 0)
    const avgSatisfaction = satisfactionRatings.length
      ? (satisfactionRatings.reduce((a, b) => a + b, 0) / satisfactionRatings.length)
      : 0
    return {
      totalTickets: tickets.length,
      openTickets,
      openWithin24,
      overdueTickets,
      resolvedTickets,
      avgSatisfaction
    }
  }, [tickets])

  const filteredTickets = useMemo(() => {
    const isOpen = (t: SupportTicket) => ['open', 'in-progress', 'waiting-customer'].includes(t.status)
    const isResolved = (t: SupportTicket) => ['resolved', 'closed'].includes(t.status)
    const now = Date.now()
    const ageHours = (t: SupportTicket) => {
      const stamp = t.lastUpdate || t.createdDate
      const parsed = stamp ? new Date(stamp).getTime() : 0
      if (!parsed) return 0
      return (now - parsed) / 36e5
    }
    switch (ticketFilter) {
      case 'open':
        return tickets.filter((t) => isOpen(t) && ageHours(t) <= 24)
      case 'overdue':
        return tickets.filter((t) => isOpen(t) && ageHours(t) > 24)
      case 'resolved':
        return tickets
          .filter((t) => isResolved(t))
          .sort((a, b) => {
            const da = a.lastUpdate ? new Date(a.lastUpdate).getTime() : 0
            const db = b.lastUpdate ? new Date(b.lastUpdate).getTime() : 0
            return db - da
          })
      default:
        return tickets
    }
  }, [tickets, ticketFilter])

  const combinedConversations = useMemo(() => {
    const whatsappItems = (conversations || []).map((conv) => ({
      ...conv,
      platform: conv.platform || (provider === 'evolution' ? 'whatsapp' : provider),
      phone: conv.phone || conv.contactPhone || conv.contact_phone || conv.contact_phone_raw,
    }))

    const instagramItems = Object.entries(igDMs || {}).map(([userId, msgs]) => {
      const profile = igProfiles[userId]
      const last = msgs[msgs.length - 1]
      const name = profile?.username ? `@${profile.username}` : `@${userId}`
      return {
        conversationId: userId,
        name,
        platform: 'instagram',
        lastMessage: last?.text || 'Sem mensagens',
        updatedAt: last?.timestamp || new Date().toISOString(),
      }
    })

    const harmoniaItems = harmoniaInbox.map((it) => {
      const phone = extractPhoneFromId(it.contact_phone_raw || '')
      return {
        conversationId: `lead-${it.id}`,
        leadId: it.id,
        name: it.contact_display_name || it.contact_phone_raw || 'Lead',
        phone: it.contact_phone_raw || '',
        phoneKey: phone,
        stage: it.stage,
        platform: 'lead',
        lastMessage: it.last_message_text || 'Sem mensagens',
        updatedAt: it.last_message_at || it.last_activity_at || new Date().toISOString(),
        leadUpdatedAt: it.last_message_at || it.last_activity_at || null,
      }
    })

    const merged: any[] = []
    const indexByPhone = new Map<string, number>()

    const pushWithIndex = (item: any, phoneKey: string) => {
      merged.push(item)
      if (phoneKey) indexByPhone.set(phoneKey, merged.length - 1)
    }

    whatsappItems.forEach((item) => {
      const phoneKey = extractPhoneFromId(item.phone || item.conversationId || '')
      if (phoneKey.length < 10) {
        pushWithIndex(item, '')
        return
      }
      if (phoneKey && indexByPhone.has(phoneKey)) {
        const idx = indexByPhone.get(phoneKey)!
        const existing = merged[idx]
        if (namesMatch(existing?.leadName || existing?.name, item.name)) {
          merged[idx] = {
            ...item,
            leadId: existing.leadId,
            stage: existing.stage,
            leadUpdatedAt: existing.leadUpdatedAt,
            leadName: existing.leadName,
            leadPhone: existing.leadPhone,
          }
        } else {
          pushWithIndex(item, phoneKey)
        }
      } else {
        pushWithIndex(item, phoneKey)
      }
    })

    instagramItems.forEach((item) => merged.push(item))

    harmoniaItems.forEach((item) => {
      const phoneKey = item.phoneKey
      if (phoneKey.length < 10) {
        pushWithIndex(item, '')
        return
      }
      if (phoneKey && indexByPhone.has(phoneKey)) {
        const idx = indexByPhone.get(phoneKey)!
        const current = merged[idx]
        if (namesMatch(current?.name, item.name)) {
          const currentTs = current.updatedAt ? new Date(current.updatedAt).getTime() : 0
          const leadTs = item.updatedAt ? new Date(item.updatedAt).getTime() : 0
          merged[idx] = {
            ...current,
            name: current.name || item.name,
            leadId: item.leadId,
            stage: item.stage,
            leadUpdatedAt: item.leadUpdatedAt || current.leadUpdatedAt,
            leadName: item.name,
            leadPhone: item.phone,
            updatedAt: leadTs > currentTs ? item.updatedAt : current.updatedAt,
          }
        } else {
          pushWithIndex(item, phoneKey)
        }
      } else {
        pushWithIndex(item, phoneKey)
      }
    })

    return merged.sort((a, b) => {
      const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return db - da
    })
  }, [conversations, igDMs, igProfiles, provider, harmoniaInbox])

  const filteredConversations = useMemo(() => {
    const term = searchQuery.trim().toLowerCase()
    if (!term) return combinedConversations
    return combinedConversations.filter((conv) => {
      const searchable = [
        conv.name,
        conv.phone,
        conv.profile,
        conv.leadName,
        conv.leadPhone,
        conv.stage,
        conv.platform || conv.channel || conv.type,
        conv.conversationId
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return searchable.includes(term)
    })
  }, [combinedConversations, searchQuery])

  const whatsappPalette = [
    'text-emerald-300',
    'text-teal-300',
    'text-lime-300',
    'text-cyan-300',
    'text-sky-300',
    'text-blue-300',
    'text-violet-300',
    'text-fuchsia-300',
    'text-orange-300'
  ]

  const getPlatformIcon = (platform?: string, channel?: number) => {
    const normalized = String(platform || '').toLowerCase()
    if (normalized.includes('instagram')) return <InstagramLogo className="h-4 w-4 text-pink-300" />
    if (normalized.includes('facebook') || normalized.includes('messenger')) return <FacebookLogo className="h-4 w-4 text-blue-300" />
    if (normalized.includes('lead')) {
      return <WhatsappLogo className="h-4 w-4 text-emerald-300" />
    }
    const color = channel ? whatsappPalette[(Math.max(channel, 1) - 1) % whatsappPalette.length] : 'text-emerald-300'
    return <WhatsappLogo className={`h-4 w-4 ${color}`} />
  }

  const renderOmnichannelChat = () => {
    const whatsappConnected = (orchestratorStatus?.connectedInstances ?? 0) > 0
    const connectedWhatsapps =
      orchestratorStatus?.instances?.filter((instance) => instance.status === 'connected') ?? []
    const filterLabelMap = {
      total: 'Todos',
      open: 'Abertos (≤ 24h)',
      overdue: 'Atrasados (> 24h)',
      resolved: 'Resolvidos'
    } as const
    return (
      <div className="space-y-4">
        <Card className="glass-card">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-white">Omnichannel</CardTitle>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWaStatusOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-blue-100/70 hover:bg-white/10"
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${whatsappConnected ? 'bg-emerald-400' : 'bg-white/20'}`} />
                    <WhatsappLogo className="h-3.5 w-3.5 text-emerald-300" />
                    <span>WhatsApp</span>
                    <span className="text-blue-100/50">{connectedWhatsapps.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIgStatusOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-blue-100/70 hover:bg-white/10"
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${instagram?.connected ? 'bg-pink-400' : 'bg-white/20'}`} />
                    <InstagramLogo className="h-3.5 w-3.5 text-pink-300" />
                    <span>Instagram</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFbStatusOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-blue-100/70 hover:bg-white/10"
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${facebookConfigured ? 'bg-blue-400' : 'bg-white/20'}`} />
                    <FacebookLogo className="h-3.5 w-3.5 text-blue-300" />
                    <span>Facebook</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTicketFilter('total')
                    setShowNewTicket(false)
                    setTicketsModalOpen(true)
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                    ticketFilter === 'total'
                      ? 'border-blue-400/40 bg-blue-500/20 text-white'
                      : 'border-white/10 bg-white/5 text-blue-100/70 hover:bg-white/10'
                  }`}
                >
                  <Ticket className="h-3.5 w-3.5 text-blue-400" />
                  <span>Total tickets</span>
                  <span className="text-[11px] text-blue-100/60">{supportStats.totalTickets}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTicketFilter('open')
                    setShowNewTicket(false)
                    setTicketsModalOpen(true)
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                    ticketFilter === 'open'
                      ? 'border-orange-400/40 bg-orange-500/20 text-white'
                      : 'border-white/10 bg-white/5 text-blue-100/70 hover:bg-white/10'
                  }`}
                >
                  <Warning className="h-3.5 w-3.5 text-orange-400" />
                  <span>Abertos</span>
                  <span className="text-[11px] text-blue-100/60">{supportStats.openWithin24}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTicketFilter('overdue')
                    setShowNewTicket(false)
                    setTicketsModalOpen(true)
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                    ticketFilter === 'overdue'
                      ? 'border-red-400/40 bg-red-500/20 text-white'
                      : 'border-white/10 bg-white/5 text-blue-100/70 hover:bg-white/10'
                  }`}
                >
                  <Clock className="h-3.5 w-3.5 text-red-400" />
                  <span>Atrasados</span>
                  <span className="text-[11px] text-blue-100/60">{supportStats.overdueTickets}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTicketFilter('resolved')
                    setShowNewTicket(false)
                    setTicketsModalOpen(true)
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                    ticketFilter === 'resolved'
                      ? 'border-emerald-400/40 bg-emerald-500/20 text-white'
                      : 'border-white/10 bg-white/5 text-blue-100/70 hover:bg-white/10'
                  }`}
                >
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Resolvidos</span>
                  <span className="text-[11px] text-blue-100/60">{supportStats.resolvedTickets}</span>
                </button>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-blue-100/70">
                  <Star className="h-3.5 w-3.5 text-purple-400" />
                  <span>Satisfação média</span>
                  <span className="text-[11px] text-blue-100/60">{supportStats.avgSatisfaction.toFixed(1)}</span>
                </div>
                {((statusPausedUntil && Date.now() < statusPausedUntil) ||
                  (conversationsPausedUntil && Date.now() < conversationsPausedUntil) ||
                  (harmoniaInboxPausedUntil && Date.now() < harmoniaInboxPausedUntil)) ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-1 text-xs text-amber-100">
                    Atualização pausada
                  </span>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 h-[640px]">
              <Card className="glass-card xl:col-span-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg text-white">Conversas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-3">
                    <Input
                      placeholder="Buscar por nome, telefone, perfil ou plataforma"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                    />
                  </div>
                      <ScrollArea className="h-[520px]">
                        <div className="space-y-2">
                      {(loadingConversations || harmoniaInboxLoading) && (
                        <div className="text-sm text-blue-100/60 py-4 text-center">Carregando conversas...</div>
                      )}
                      {harmoniaInboxError && (
                        <div className="text-xs text-red-200/80 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                          {harmoniaInboxError}
                        </div>
                      )}
                      {!loadingConversations && !harmoniaInboxLoading && filteredConversations.length === 0 && (
                        <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-4 py-6 text-center">
                          <div className="text-sm text-blue-100/70">Nenhuma conversa ainda.</div>
                          <div className="text-xs text-blue-100/50 mt-2">
                            Conecte WhatsApp, Instagram ou Facebook para começar a receber mensagens aqui.
                          </div>
                        </div>
                      )}
                      {filteredConversations.map((conv) => (
                        <div
                          key={`${conv.conversationId}-${conv.channel ?? conv.platform ?? ''}`}
                          data-testid="conversation-item"
                          className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-white/5 ${
                            selectedConversation?.conversationId === conv.conversationId &&
                            selectedConversation?.channel === conv.channel
                              ? 'border-blue-500/70 bg-blue-500/15'
                              : 'border-white/10'
                          }`}
                          onClick={() => {
                            setSelectedConversation(conv)
                            if (conv.leadId) {
                              void openHarmoniaConversationById(conv.leadId)
                            }
                            if (conv.platform === 'instagram') {
                              setMessages(igDMs[conv.conversationId] || [])
                            } else if (conv.platform === 'lead') {
                              setMessages([])
                            } else {
                              loadMessages(conv)
                            }
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <div className="mt-1">{getPlatformIcon(conv.platform || conv.channel || conv.type, conv.channel)}</div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-white truncate">
                                {conv.name || conv.conversationId}
                              </div>
                              {conv.leadId ? (
                                <div className="mt-1 inline-flex items-center gap-2 text-[11px] text-emerald-200">
                                  <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5">
                                    Lead
                                  </span>
                                  {conv.stage ? <span className="text-emerald-200/80">{conv.stage}</span> : null}
                                </div>
                              ) : null}
                              <div className="text-xs text-blue-100/70 truncate mt-1">
                                {conv.lastMessage || 'Sem mensagens'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                        </div>
                      </ScrollArea>
                      {harmoniaInboxCursor?.cursorTs && (
                        <div className="pt-3">
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => loadHarmoniaInbox('more')}
                            disabled={harmoniaInboxLoading}
                          >
                            {harmoniaInboxLoading ? 'Carregando...' : 'Carregar mais leads'}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>

              <Card className="glass-card xl:col-span-8">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg text-white">
                    {selectedConversation ? selectedConversation.name || selectedConversation.conversationId : 'Selecione uma conversa'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedConversation ? (
                    <div className="space-y-4">
                      {selectedConversation.leadId ? (
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-blue-100/70 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="bg-white/10 text-white border border-white/10">
                              stage: {harmoniaConversation?.stage || selectedConversation.stage || '—'}
                            </Badge>
                            <div className="ml-auto flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                className="h-7 px-2"
                                onClick={() => patchHarmoniaConversation({ stage: 'resolved' })}
                                disabled={harmoniaActionLoading || !canExecute}
                              >
                                Resolver
                              </Button>
                              <Button
                                variant="outline"
                                className="h-7 px-2"
                                onClick={() => patchHarmoniaConversation({ stage: 'followup' })}
                                disabled={harmoniaActionLoading || !canExecute}
                              >
                                Follow-up
                              </Button>
                              <Button
                                variant="outline"
                                className="h-7 px-2"
                                onClick={() => patchHarmoniaConversation({ stage: 'handoff' })}
                                disabled={harmoniaActionLoading || !canExecute}
                              >
                                Handoff
                              </Button>
                              <Button
                                variant="outline"
                                className="h-7 px-2"
                                onClick={() => patchHarmoniaConversation({ stage: 'paused' })}
                                disabled={harmoniaActionLoading || !canExecute}
                              >
                                Pausar
                              </Button>
                            </div>
                          </div>
                          {execRequired && !canExecute ? (
                            <div className="text-[11px] text-amber-200/80">
                              Informe o token de execução nas Configurações para habilitar ações.
                            </div>
                          ) : null}
                          {harmoniaActionSuccess ? (
                            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-100">
                              {harmoniaActionSuccess}
                            </div>
                          ) : null}
                          {harmoniaActionError ? (
                            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-100">
                              {harmoniaActionError}
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-4">
                            <div>Contato: <span className="text-white">{harmoniaConversation?.contact_display_name || selectedConversation.leadName || selectedConversation.name || '—'}</span></div>
                            <div>Últ. inbound: <span className="text-white">{fmtDateTime(harmoniaConversation?.last_inbound_at)}</span></div>
                            <div>Últ. outbound: <span className="text-white">{fmtDateTime(harmoniaConversation?.last_outbound_at)}</span></div>
                          </div>
                        </div>
                      ) : null}

                      <ScrollArea className="h-[500px] border border-white/10 rounded-lg p-4">
                        <div className="space-y-3">
                          {selectedConversation.platform === 'lead' ? (
                            harmoniaMessagesLoading ? (
                              <div className="text-sm text-blue-100/60 text-center py-4">Carregando mensagens...</div>
                            ) : (
                              harmoniaMessages.map((m) => {
                                const dir = String(m.direction || '')
                                const isInbound = dir === 'inbound'
                                const mediaLabel = resolveMediaLabel(m)
                                const caption = resolveMessageCaption(m)
                                return (
                                  <div
                                    key={String(m.id || m.provider_message_id || Math.random())}
                                    className={`rounded-xl border ${isInbound ? 'border-sky-500/20 bg-sky-500/10' : 'border-emerald-500/20 bg-emerald-500/10'} p-3`}
                                  >
                                    <div className="flex items-center justify-between gap-3 text-xs">
                                      <div className="text-white/90 font-semibold">
                                        {isInbound ? 'IN' : 'OUT'}
                                      </div>
                                      <div className="text-white/70">{fmtDateTime(m.created_at || null)}</div>
                                    </div>
                                    <div className="mt-2 space-y-1">
                                      {mediaLabel ? (
                                        <Badge className="bg-white/10 text-white border border-white/10 text-[11px] px-2 py-0.5 w-fit">
                                          {mediaLabel}
                                        </Badge>
                                      ) : null}
                                      <div className="text-sm text-white whitespace-pre-wrap break-words">
                                        {caption ? caption : <span className="text-white/60">—</span>}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })
                            )
                          ) : (
                            <>
                              {loadingMessages && (
                                <div className="text-sm text-blue-100/60 text-center py-4">Carregando mensagens...</div>
                              )}
                              {messages.map((msg) => {
                                const outbound = msg.direction === 'outbound' || msg.direction === 'human'
                                const ts = msg.createdAt || msg.timestamp
                                return (
                                  <div key={msg.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[70%] p-3 rounded-lg ${outbound ? 'bg-blue-500/40 text-white' : 'bg-white/10 text-blue-100'}`}>
                                      <div className="text-sm">
                                        {msg.text || msg.caption || `[${msg.type}]`}
                                      </div>
                                      <div className={`text-xs mt-1 ${outbound ? 'text-blue-100/80' : 'text-blue-100/60'}`}>
                                        {ts ? new Date(ts).toLocaleTimeString() : ''}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </>
                          )}
                        </div>
                      </ScrollArea>

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
                        <Button onClick={sendMessage} disabled={!messageInput.trim() || sendingMessage}>
                          {sendingMessage ? '...' : 'Enviar'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[520px]">
                      <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-6 py-6 text-center max-w-sm">
                        <div className="text-sm text-blue-100/70">Nenhuma conversa selecionada</div>
                        <div className="text-xs text-blue-100/50 mt-2">
                          As mensagens aparecerão aqui assim que as contas estiverem conectadas.
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        <Dialog open={waStatusOpen} onOpenChange={setWaStatusOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>WhatsApp conectado</DialogTitle>
              <DialogDescription>
                {connectedWhatsapps.length
                  ? `${connectedWhatsapps.length} canal(is) ativo(s).`
                  : 'Nenhum canal conectado no momento.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {connectedWhatsapps.map((instance) => (
                <div
                  key={instance.channel}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-blue-100/80"
                >
                  {getPlatformIcon('whatsapp', instance.channel)}
                  <div className="flex-1">
                    Canal {instance.channel}
                    {instance.metadata?.phoneNumber ? ` • ${instance.metadata.phoneNumber}` : ''}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setWaStatusOpen(false)}>
                Fechar
              </Button>
              <Button onClick={() => connectWhatsApp()}>
                Conectar novo
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={ticketsModalOpen}
          onOpenChange={(open) => {
            setTicketsModalOpen(open)
            if (!open) setShowNewTicket(false)
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Tickets</DialogTitle>
              <DialogDescription>
                Filtro atual: {filterLabelMap[ticketFilter]}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-blue-100/60">
                  {filteredTickets.length} ticket(s) encontrado(s)
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowNewTicket((prev) => !prev)}
                >
                  {showNewTicket ? 'Fechar novo ticket' : 'Novo ticket'}
                </Button>
              </div>

              {showNewTicket && (
                <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>Assunto</Label>
                      <Input
                        value={newTicket.subject || ''}
                        onChange={(e) => setNewTicket(prev => ({ ...prev, subject: e.target.value }))}
                        placeholder="Assunto do ticket"
                        className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                      />
                    </div>
                    <div>
                      <Label>Cliente</Label>
                      <Input
                        value={newTicket.customer || ''}
                        onChange={(e) => setNewTicket(prev => ({ ...prev, customer: e.target.value }))}
                        placeholder="Nome do cliente"
                        className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                      />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input
                        value={newTicket.customerEmail || ''}
                        onChange={(e) => setNewTicket(prev => ({ ...prev, customerEmail: e.target.value }))}
                        placeholder="email@cliente.com"
                        className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                      />
                    </div>
                    <div>
                      <Label>Prioridade</Label>
                      <Select
                        value={newTicket.priority}
                        onValueChange={(value) => setNewTicket(prev => ({ ...prev, priority: value as SupportTicket['priority'] }))}
                      >
                        <SelectTrigger className="bg-white/5 border-white/10 text-white">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Baixa</SelectItem>
                          <SelectItem value="medium">Média</SelectItem>
                          <SelectItem value="high">Alta</SelectItem>
                          <SelectItem value="urgent">Urgente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Categoria</Label>
                      <Select
                        value={newTicket.category}
                        onValueChange={(value) => setNewTicket(prev => ({ ...prev, category: value as SupportTicket['category'] }))}
                      >
                        <SelectTrigger className="bg-white/5 border-white/10 text-white">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">Geral</SelectItem>
                          <SelectItem value="technical">Técnico</SelectItem>
                          <SelectItem value="billing">Cobrança</SelectItem>
                          <SelectItem value="feature-request">Feature</SelectItem>
                          <SelectItem value="bug">Bug</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Descrição</Label>
                    <Textarea
                      value={newTicket.description || ''}
                      onChange={(e) => setNewTicket(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Detalhes do ticket"
                      className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={createTicket}>Criar ticket</Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {filteredTickets.length === 0 && (
                  <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-blue-100/70">
                    Nenhum ticket encontrado para este filtro.
                  </div>
                )}
                {filteredTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-blue-100/80"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-white">{ticket.subject}</div>
                      <div className="flex items-center gap-2">
                        <Badge className={getPriorityColor(ticket.priority)}>{ticket.priority}</Badge>
                        <Badge className={getStatusColor(ticket.status)}>{ticket.status}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-blue-100/60">
                      {ticket.ticketNumber} • {ticket.customer} • {ticket.customerEmail}
                    </div>
                    <div className="mt-2 text-xs text-blue-100/70 line-clamp-2">
                      {ticket.description || 'Sem descrição'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={igStatusOpen} onOpenChange={setIgStatusOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Instagram conectado</DialogTitle>
              <DialogDescription>
                {instagram?.connected ? 'Conta ativa para DMs.' : 'Nenhuma conta conectada.'}
              </DialogDescription>
            </DialogHeader>
            {instagram?.connected && instagram?.businessAccountId ? (
              <div className="text-xs text-blue-100/70">
                Business Account ID: <span className="text-white">{instagram.businessAccountId}</span>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIgStatusOpen(false)}>
                Fechar
              </Button>
              {!instagram?.connected ? (
                <Button
                  onClick={() => {
                    setIgStatusOpen(false)
                    setIgDialogOpen(true)
                  }}
                >
                  Conectar
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    void refreshInstagram()
                  }}
                >
                  Atualizar
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={fbStatusOpen} onOpenChange={setFbStatusOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Facebook conectado</DialogTitle>
              <DialogDescription>
                {facebookConfigured ? 'Configuração salva para Messenger.' : 'Nenhuma conta conectada.'}
              </DialogDescription>
            </DialogHeader>
            {facebookConfigured && facebookConfig?.pageId ? (
              <div className="text-xs text-blue-100/70">
                Page ID: <span className="text-white">{facebookConfig.pageId}</span>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFbStatusOpen(false)}>
                Fechar
              </Button>
              <Button
                onClick={() => {
                  setFbStatusOpen(false)
                  setFbDialogOpen(true)
                }}
              >
                {facebookConfigured ? 'Editar' : 'Conectar'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={qrDialogChannel !== null} onOpenChange={(open) => !open && setQrDialogChannel(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>QR Code do canal {qrDialogChannel}</DialogTitle>
              <DialogDescription>Use o WhatsApp para escanear.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-center">
              {qrDialogChannel && channelQR.get(qrDialogChannel)?.dataUrl ? (
                <img src={channelQR.get(qrDialogChannel)?.dataUrl} alt={`QR ${qrDialogChannel}`} className="h-64 w-64 rounded-lg bg-white p-2" />
              ) : (
                <div className="text-sm text-blue-100/70">Gerando QR...</div>
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setQrDialogChannel(null)}>
                Fechar
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={igDialogOpen} onOpenChange={(open) => setIgDialogOpen(open)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Conectar Instagram</DialogTitle>
              <DialogDescription>
                Conecte sua conta via Meta (recomendado) ou use token manual.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={startInstagramOAuth}
                  disabled={igOauthLoading || Boolean(igOauthStatus && !igOauthStatus.configured)}
                >
                  {igOauthLoading ? 'Verificando...' : 'Conectar com Meta (OAuth)'}
                </Button>
                {igOauthStatus && !igOauthStatus.configured ? (
                  <div className="text-xs text-red-200/80">
                    OAuth não configurado: {(igOauthStatus.missing || []).join(', ')}
                  </div>
                ) : (
                  <div className="text-xs text-blue-100/70">
                    Recomendado. Conecta via Meta e salva o token no servidor.
                  </div>
                )}
              </div>
              <div className="border-t border-white/10" />
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Access Token</Label>
                  <Input
                    value={igAccessToken}
                    onChange={(e) => setIgAccessToken(e.target.value)}
                    placeholder="token do Graph API"
                    className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Business Account ID</Label>
                  <Input
                    value={igBusinessId}
                    onChange={(e) => setIgBusinessId(e.target.value)}
                    placeholder="id da conta instagram"
                    className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIgDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleConnectInstagram} disabled={igLoading}>
                {igLoading ? 'Conectando...' : 'Conectar'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={fbDialogOpen} onOpenChange={(open) => setFbDialogOpen(open)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Conectar Facebook</DialogTitle>
              <DialogDescription>
                Informe o Page ID e o Access Token para habilitar o Messenger.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Access Token</Label>
                <Input
                  value={fbAccessToken}
                  onChange={(e) => setFbAccessToken(e.target.value)}
                  placeholder="token do Graph API"
                  className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                />
              </div>
              <div className="space-y-1">
                <Label>Page ID</Label>
                <Input
                  value={fbPageId}
                  onChange={(e) => setFbPageId(e.target.value)}
                  placeholder="ID da página"
                  className="bg-white/5 border-white/10 text-white placeholder:text-blue-100/50"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setFbDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleConnectFacebook}>
                  Salvar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="space-y-6">
        {renderOmnichannelChat()}
      </div>
    )
  }

  const getChannelIcon = (type: Activity['type']) => {
    switch (type) {
      case 'call': return <Phone className="h-4 w-4" />
      case 'email': return <Envelope className="h-4 w-4" />
      case 'whatsapp': return <WhatsappLogo className="h-4 w-4" />
      case 'sms': return <ChatCircle className="h-4 w-4" />
      case 'meeting': return <VideoCamera className="h-4 w-4" />
      default: return <ChatCircle className="h-4 w-4" />
    }
  }

  const getChannelColor = (type: Activity['type']) => {
    switch (type) {
      case 'call': return 'text-blue-600 bg-blue-50'
      case 'email': return 'text-green-600 bg-green-50'
      case 'whatsapp': return 'text-green-700 bg-green-100'
      case 'sms': return 'text-purple-600 bg-purple-50'
      case 'meeting': return 'text-orange-600 bg-orange-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const getOutcomeIcon = (outcome?: string) => {
    if (!outcome) return null
    if (outcome.toLowerCase().includes('positivo') || outcome.toLowerCase().includes('sucesso')) {
      return <CheckCircle className="h-4 w-4 text-green-600" />
    }
    if (outcome.toLowerCase().includes('atenção') || outcome.toLowerCase().includes('problema')) {
      return <Warning className="h-4 w-4 text-yellow-600" />
    }
    return <Clock className="h-4 w-4 text-blue-600" />
  }

  const recentActivities = activities
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)

  const channelStats = {
    call: activities.filter(a => a.type === 'call').length,
    email: activities.filter(a => a.type === 'email').length,
    whatsapp: activities.filter(a => a.type === 'whatsapp').length,
    sms: activities.filter(a => a.type === 'sms').length,
    meeting: activities.filter(a => a.type === 'meeting').length
  }

  return (
    <div className="space-y-6">
      {/* Channel Statistics */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Sparkle className="h-5 w-5 text-accent ai-processing" />
            <CardTitle>Central Omnichannel</CardTitle>
            <Badge variant="secondary">Tempo Real</Badge>
          </div>
          <CardDescription>
            Gestão unificada de todos os canais de comunicação
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-4">
            <div className="text-center">
              <div className="p-3 rounded-lg bg-blue-50 text-blue-600 mx-auto w-fit mb-2">
                <Phone className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.call}</div>
              <div className="text-xs text-muted-foreground">Chamadas</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-green-50 text-green-600 mx-auto w-fit mb-2">
                <Envelope className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.email}</div>
              <div className="text-xs text-muted-foreground">E-mails</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-green-100 text-green-700 mx-auto w-fit mb-2">
                <WhatsappLogo className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.whatsapp}</div>
              <div className="text-xs text-muted-foreground">WhatsApp</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-purple-50 text-purple-600 mx-auto w-fit mb-2">
                <ChatCircle className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.sms}</div>
              <div className="text-xs text-muted-foreground">SMS</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-orange-50 text-orange-600 mx-auto w-fit mb-2">
                <VideoCamera className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.meeting}</div>
              <div className="text-xs text-muted-foreground">Reuniões</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {renderOmnichannelChat()}

      {/* Quick Actions */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Ações Rápidas</CardTitle>
          <CardDescription>
            Inicie conversas em qualquer canal com um clique
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('call', '')}
            >
              <Phone className="h-5 w-5 text-blue-600" />
              <span className="text-xs">Nova Chamada</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('email', '')}
            >
              <Envelope className="h-5 w-5 text-green-600" />
              <span className="text-xs">Novo E-mail</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('whatsapp', '')}
            >
              <WhatsappLogo className="h-5 w-5 text-green-700" />
              <span className="text-xs">WhatsApp</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('sms', '')}
            >
              <ChatCircle className="h-5 w-5 text-purple-600" />
              <span className="text-xs">SMS</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('meeting', '')}
            >
              <CalendarBlank className="h-5 w-5 text-orange-600" />
              <span className="text-xs">Agendar</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Interactions */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Interações Recentes</CardTitle>
          <CardDescription>
            Timeline unificado de todas as comunicações
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentActivities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className={`p-2 rounded-lg ${getChannelColor(activity.type)}`}>
                  {getChannelIcon(activity.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-medium text-sm truncate">{activity.title}</h4>
                    <div className="flex items-center space-x-2">
                      {getOutcomeIcon(activity.outcome)}
                      <span className="text-xs text-muted-foreground">
                        {getRelativeTime(activity.date)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                    {activity.description}
                  </p>
                  <div className="flex items-center space-x-4 text-xs">
                    <div className="flex items-center space-x-1">
                      <User className="h-3 w-3" />
                      <span>{activity.createdBy}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Badge variant="outline" className="text-xs px-2 py-0">
                        {activity.channel}
                      </Badge>
                    </div>
                    {activity.duration && (
                      <div className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>{activity.duration}min</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Insights */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Sparkle className="h-5 w-5 text-accent ai-processing" />
            <CardTitle>Insights de Comunicação</CardTitle>
            <Badge variant="secondary" className="ai-processing">IA</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center space-x-2 mb-1">
                <Phone className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-800 text-sm">Melhor Horário</span>
              </div>
              <p className="text-xs text-blue-700">
                Chamadas realizadas entre 14h-16h têm 40% mais taxa de atendimento
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center space-x-2 mb-1">
                <WhatsappLogo className="h-4 w-4 text-green-700" />
                <span className="font-medium text-green-800 text-sm">Canal Preferido</span>
              </div>
              <p className="text-xs text-green-700">
                67% dos clientes preferem WhatsApp para primeiros contatos
              </p>
            </div>
            <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
              <div className="flex items-center space-x-2 mb-1">
                <CalendarBlank className="h-4 w-4 text-orange-600" />
                <span className="font-medium text-orange-800 text-sm">Follow-up</span>
              </div>
              <p className="text-xs text-orange-700">
                5 clientes precisam de follow-up nos próximos 2 dias
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
