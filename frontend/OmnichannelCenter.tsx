import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { Button } from "@/button"
import { Input } from "@/input"
import { Textarea } from "@/textarea"
import { Label } from "@/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { useKV } from "@/spark-mock"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/dialog"
import { toast } from "sonner"
import * as QRCode from "qrcode"
import { getRelativeTime } from "@/utils"
import { buildCrmBasicAuthHeaders, getCrmBasicAuthToken } from "@/waOrchestratorAuth"
import { useIntegrations } from "@/contexts"
import { getCssVarValue } from "@/visualTheme"
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
  Star,
  Smiley,
  ArrowBendUpLeft,
  DownloadSimple,
  FilePdf,
  ImageSquare
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

export interface OmnichannelHeaderState {
  whatsappConnected: boolean
  connectedWhatsapps: number
  instagramConnected: boolean
  facebookConfigured: boolean
  supportStats: {
    totalTickets: number
    openWithin24: number
    overdueTickets: number
    resolvedTickets: number
    avgSatisfaction: number
  }
  ticketFilter: 'total' | 'open' | 'overdue' | 'resolved'
  paused: boolean
}

export interface OmnichannelCenterHandle {
  openWhatsAppStatus: () => void
  openInstagramStatus: () => void
  openFacebookStatus: () => void
  openTicketsModal: (filter: 'total' | 'open' | 'overdue' | 'resolved') => void
}

interface OmnichannelCenterProps {
  activities: Activity[]
  onStartConversation?: (channel: string, customerId: string) => void
  onHeaderStateChange?: (state: OmnichannelHeaderState) => void
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
const WA_CONVERSATIONS_CACHE_KEY = 'wa.orchestrator.conversations.cache'
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

function isLikelyWhatsAppJid(value?: string | null) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return false
  if (raw.includes('@s.whatsapp.net') || raw.includes('@g.us')) return true
  const digits = normalizePhone(raw)
  if (digits.length >= 10 && digits === raw.replace(/\D+/g, '')) return true
  return false
}

function normalizeWhatsAppJid(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.includes('@')) return raw
  const digits = normalizePhone(raw)
  if (!digits) return raw
  return `${digits}@s.whatsapp.net`
}

function formatPhone(value?: string | null) {
  const digits = normalizePhone(value)
  if (!digits) return ''
  if (digits.startsWith('55') && digits.length >= 12) {
    const area = digits.slice(2, 4)
    const rest = digits.slice(4)
    if (rest.length === 9) return `+55 (${area}) ${rest.slice(0, 5)}-${rest.slice(5)}`
    if (rest.length === 8) return `+55 (${area}) ${rest.slice(0, 4)}-${rest.slice(4)}`
    return `+55 (${area}) ${rest}`
  }
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return digits
}

function resolveConversationDisplayName(conv: any) {
  const rawName = conv?.leadName || conv?.name || conv?.contact_display_name || ''
  if (rawName && !isLikelyWhatsAppJid(rawName)) return rawName
  const phoneCandidate =
    conv?.phone ||
    conv?.leadPhone ||
    conv?.contactPhone ||
    conv?.contact_phone ||
    conv?.contact_phone_raw ||
    conv?.conversationId
  const formatted = formatPhone(phoneCandidate)
  if (formatted) return formatted
  return rawName || conv?.conversationId || 'Contato'
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

function resolveReplyPreview(raw?: string | null, fallback?: string | null) {
  const text = String(raw || fallback || '').trim()
  if (!text) return 'Mensagem'
  if (text.length <= 140) return text
  return `${text.slice(0, 137)}…`
}

function formatReplyPrefix(text: string) {
  const preview = resolveReplyPreview(text, '')
  return `↪ ${preview}`
}

function resolveAvatarUrl(conv: any) {
  return (
    conv?.profilePic ||
    conv?.profilePicUrl ||
    conv?.profile_picture_url ||
    conv?.avatarUrl ||
    conv?.photoUrl ||
    conv?.photo ||
    ''
  )
}

function getInitials(value?: string | null) {
  const text = String(value || '').trim()
  if (!text) return 'U'
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function renderFormattedText(input?: string | null): ReactNode {
  const text = String(input || '')
  if (!text) return null

  const tokens: ReactNode[] = []
  const pattern = /```([\s\S]*?)```|`([^`]+)`|\*([^*]+)\*|_([^_]+)_|~([^~]+)~/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  const pushPlain = (value: string) => {
    if (!value) return
    const parts = value.split('\n')
    parts.forEach((part, idx) => {
      if (idx > 0) tokens.push(<br key={`br-${tokens.length}`} />)
      if (part) tokens.push(part)
    })
  }

  while ((match = pattern.exec(text)) !== null) {
    const [full, blockCode, inlineCode, bold, italic, strike] = match
    if (match.index > lastIndex) {
      pushPlain(text.slice(lastIndex, match.index))
    }
    if (blockCode) {
      tokens.push(
        <pre key={`codeblock-${tokens.length}`} className="whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-xs text-blue-100">
          <code>{blockCode}</code>
        </pre>
      )
    } else if (inlineCode) {
      tokens.push(
        <code key={`incode-${tokens.length}`} className="rounded bg-black/30 px-1 py-0.5 text-[11px] text-blue-100">
          {inlineCode}
        </code>
      )
    } else if (bold) {
      tokens.push(<strong key={`bold-${tokens.length}`}>{bold}</strong>)
    } else if (italic) {
      tokens.push(<em key={`italic-${tokens.length}`}>{italic}</em>)
    } else if (strike) {
      tokens.push(<del key={`strike-${tokens.length}`}>{strike}</del>)
    } else {
      pushPlain(full)
    }
    lastIndex = match.index + full.length
  }

  if (lastIndex < text.length) {
    pushPlain(text.slice(lastIndex))
  }

  return <>{tokens}</>
}

function ConversationAvatar({ conv, size = 36 }: { conv: any; size?: number }) {
  const [failed, setFailed] = useState(false)
  const name = resolveConversationDisplayName(conv)
  const src = resolveAvatarUrl(conv)
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        className="rounded-full object-cover border border-white/10 bg-white/5"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        loading="lazy"
      />
    )
  }
  return (
    <div
      className="rounded-full bg-white/10 border border-white/10 text-xs font-semibold text-blue-100 flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  )
}

function AudioInlinePlayer({ src, mimeType, onError }: { src: string; mimeType?: string; onError?: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const fmt = useCallback((seconds: number) => {
    const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
    const m = Math.floor(safe / 60)
    const s = safe % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }, [])

  return (
    <div className="mt-2 rounded-lg border border-white/15 bg-black/20 p-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onEnded={() => setPlaying(false)}
        onError={onError}
      >
        {mimeType ? <source src={src} type={mimeType} /> : null}
      </audio>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
          onClick={() => {
            const node = audioRef.current
            if (!node) return
            if (playing) {
              node.pause()
              setPlaying(false)
            } else {
              void node.play()
              setPlaying(true)
            }
          }}
          aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
        >
          {playing ? '❚❚' : '▶'}
        </Button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          className="flex-1 accent-emerald-400"
          onChange={(event) => {
            const next = Number(event.target.value)
            if (!audioRef.current || Number.isNaN(next)) return
            audioRef.current.currentTime = next
            setCurrentTime(next)
          }}
        />
        <span className="text-[10px] text-blue-100/70 min-w-[64px] text-right">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>
    </div>
  )
}

function MessageMedia({
  media,
  mediaProxyUrl,
  fallbackText,
  onImagePreview
}: {
  media?: { type?: string; url?: string; mimeType?: string; fileName?: string; durationSec?: number }
  mediaProxyUrl?: string
  fallbackText?: string
  onImagePreview: (payload: { src: string; alt?: string }) => void
}) {
  const [loadFailed, setLoadFailed] = useState(false)
  const type = String(media?.type || '').toLowerCase()
  let src = String(mediaProxyUrl || media?.url || '').trim()
  const authToken = getCrmBasicAuthToken()
  if (src && mediaProxyUrl && authToken && !src.includes('auth=')) {
    try {
      const url = new URL(src, window.location.origin)
      url.searchParams.set('auth', authToken)
      src = url.toString()
    } catch {
      const sep = src.includes('?') ? '&' : '?'
      src = `${src}${sep}auth=${encodeURIComponent(authToken)}`
    }
  }
  const mimeType = String(media?.mimeType || '').trim()
  const isImage = type.includes('image')
  const isAudio = type.includes('audio') || type.includes('ptt') || type.includes('voice')
  const isPdf = type.includes('document') && (mimeType.includes('pdf') || String(media?.fileName || '').toLowerCase().endsWith('.pdf'))
  const isDocument = type.includes('document') && !isPdf
  const isVideo = type.includes('video') || type.includes('ptv')

  if (!src || loadFailed) {
    return (
      <div className="mt-2 rounded-lg border border-dashed border-white/20 bg-white/5 p-2 text-xs text-blue-100/70">
        <div className="inline-flex items-center gap-2">
          <Warning className="h-4 w-4 text-amber-300" />
          {fallbackText || 'Arquivo indisponível no momento.'}
        </div>
      </div>
    )
  }

  if (isImage) {
    return (
      <button
        type="button"
        className="mt-2 block overflow-hidden rounded-lg border border-white/15 bg-black/20"
        onClick={() => onImagePreview({ src, alt: media?.fileName || 'Imagem da mensagem' })}
      >
        <img
          src={src}
          alt={media?.fileName || 'Imagem'}
          className="max-h-64 w-full object-cover"
          loading="lazy"
          onError={() => setLoadFailed(true)}
        />
      </button>
    )
  }

  if (isAudio) {
    return <AudioInlinePlayer src={src} mimeType={mimeType} onError={() => setLoadFailed(true)} />
  }

  if (isPdf) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-white/15 bg-black/20 p-2">
        <div className="overflow-hidden rounded-md border border-white/10 bg-black/30">
          <iframe
            title={media?.fileName || 'Documento PDF'}
            src={src}
            className="h-56 w-full"
            loading="lazy"
            onError={() => setLoadFailed(true)}
          />
        </div>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-xs text-blue-100 hover:bg-white/20"
        >
          <DownloadSimple className="h-3.5 w-3.5" />
          Download PDF
        </a>
      </div>
    )
  }

  if (isDocument) {
    return (
      <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-2 py-1.5 text-xs text-blue-100">
        <FilePdf className="h-4 w-4" />
        <a href={src} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
          {media?.fileName || 'Abrir documento'}
        </a>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] hover:bg-white/10"
        >
          Download
        </a>
      </div>
    )
  }

  if (isVideo) {
    return (
      <video
        src={src}
        controls
        className="mt-2 max-h-64 w-full rounded-lg border border-white/15 bg-black/20"
        onError={() => setLoadFailed(true)}
      >
        {mimeType ? <source src={src} type={mimeType} /> : null}
      </video>
    )
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-2 py-1.5 text-xs text-blue-100 hover:bg-white/10"
    >
      <ImageSquare className="h-4 w-4" />
      Abrir anexo
    </a>
  )
}

export const OmnichannelCenter = forwardRef<OmnichannelCenterHandle, OmnichannelCenterProps>(function OmnichannelCenter(
  { activities, onStartConversation, onHeaderStateChange },
  ref
) {
  const { instagram, connectInstagram, refreshInstagram } = useIntegrations()
  const normalizeQrColor = (value: string, fallback: string) => {
    const v = String(value || "").trim()
    if (!v) return fallback
    if (v.startsWith("oklch") || v.startsWith("color(")) return fallback
    return v
  }
  const QR_DARK = normalizeQrColor(getCssVarValue("--foreground", "#000000"), "#000000")
  const QR_LIGHT = normalizeQrColor(getCssVarValue("--background", "#FFFFFF"), "#FFFFFF")
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
  const [conversationFilter, setConversationFilter] = useState<'all' | 'unread' | 'labels' | 'favorites' | 'communities' | 'groups' | 'archived'>('all')
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [conversationsFailureCount, setConversationsFailureCount] = useState(0)
  const [conversationsPausedUntil, setConversationsPausedUntil] = useState<number | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const autoScrollRef = useRef(false)
  const lastMessageKeyRef = useRef<string>('')
  const [replyTarget, setReplyTarget] = useState<{
    id: string
    text: string
    direction?: string
    platform?: string
  } | null>(null)
  const [imagePreview, setImagePreview] = useState<{ src: string; alt?: string } | null>(null)
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null)
  const [reactionBusyKey, setReactionBusyKey] = useState<string | null>(null)
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus | null>(null)
  const [statusFailureCount, setStatusFailureCount] = useState(0)
  const [statusPausedUntil, setStatusPausedUntil] = useState<number | null>(null)
  const [channelQR, setChannelQR] = useState<Map<number, QRData>>(new Map())
  const [qrDialogChannel, setQrDialogChannel] = useState<number | null>(null)
  const qrPollingRef = useRef<Map<number, NodeJS.Timeout>>(new Map())
  const waEventsRefreshTimerRef = useRef<number | null>(null)
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
  const reactionOptions = useMemo(() => ['👍', '❤️', '😂', '😮', '😢', '🙏'], [])
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
      if (res.status === 304) {
        setStatusFailureCount(0)
        setStatusPausedUntil(null)
        return
      }
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
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

  const CONVERSATION_FETCH_LIMIT = 80
  const conversationsCount = conversations.length
  const CONVERSATION_CACHE_TTL = 2 * 60 * 1000

  const readConversationCache = useCallback(() => {
    try {
      const raw = localStorage.getItem(WA_CONVERSATIONS_CACHE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed?.ts || !Array.isArray(parsed?.items)) return null
      if (Date.now() - parsed.ts > CONVERSATION_CACHE_TTL) return null
      return parsed.items as any[]
    } catch {
      return null
    }
  }, [])

  const writeConversationCache = useCallback((items: any[]) => {
    try {
      const trimmed = items.slice(0, 200)
      localStorage.setItem(WA_CONVERSATIONS_CACHE_KEY, JSON.stringify({ ts: Date.now(), items: trimmed }))
    } catch {
      /* ignore */
    }
  }, [])

  const loadConversations = useCallback(async () => {
    if (!provider) return
    if (conversationsPausedUntil && Date.now() < conversationsPausedUntil) return
    if (provider === 'evolution' && conversationsCount === 0) {
      const cached = readConversationCache()
      if (cached?.length) {
        setConversations(cached)
      }
    }
    setLoadingConversations(conversationsCount === 0)
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
              `/api/wa-orchestrator/channels/${channel}/conversations?limit=${CONVERSATION_FETCH_LIMIT}`,
              { headers: buildCrmBasicAuthHeaders() }
            )
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data?.success) return []
            return (data.items || []).map((item: any) => ({ ...item, channel, platform: 'whatsapp' }))
          })
        )
        const merged = results.flat()
        setConversations(merged)
        if (merged.length) writeConversationCache(merged)
      } else {
        const res = await fetch('/api/conversations')
        const data = await res.json()
        if (res.ok) {
          const merged = data?.items || data || []
          setConversations(merged)
          if (merged?.length) writeConversationCache(merged)
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
  }, [
    provider,
    orchestratorStatus,
    conversationsPausedUntil,
    conversationsCount,
    readConversationCache,
    writeConversationCache
  ])

  const loadMessages = useCallback(async (conv: any, opts?: { silent?: boolean }) => {
    if (!provider || !conv) return
    if (!opts?.silent) setLoadingMessages(true)
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
          const items = data.items || []
          setMessages(items)
          return items
        }
      } else {
        const res = await fetch(`/api/conversations/${encodeURIComponent(conv.conversationId)}/messages?limit=80`)
        const data = await res.json()
        if (res.ok) {
          const items = data.items || []
          setMessages(items)
          return items
        }
      }
    } finally {
      if (!opts?.silent) setLoadingMessages(false)
    }
  }, [provider])

  const patchMessageById = useCallback((messageId: string, updater: (current: any) => any) => {
    setMessages((prev) => prev.map((item) => {
      if (String(item?.id || '') !== String(messageId || '')) return item
      return updater(item)
    }))
  }, [])

  const openReplyComposer = useCallback((message: any) => {
    const replyPreview = resolveReplyPreview(message?.text, message?.caption || message?.type)
    const id = String(message?.id || '').trim()
    if (!id) return
    setReplyTarget({
      id,
      text: replyPreview,
      direction: message?.direction,
      platform: message?.platform
    })
    messageInputRef.current?.focus()
  }, [])

  const toggleReaction = useCallback(async (message: any, emoji: string) => {
    if (!selectedConversation || selectedConversation?.platform === 'lead' || selectedConversation?.platform === 'instagram') return
    const channel =
      Number(selectedConversation?.channel) ||
      orchestratorStatus?.instances?.find((instance) => instance.status === 'connected')?.channel
    const remoteJid = normalizeWhatsAppJid(selectedConversation?.conversationId || selectedConversation?.phone || '')
    const messageId = String(message?.id || '').trim()
    if (!channel || !remoteJid || !messageId) return

    const requestKey = `${messageId}:${emoji}`
    if (reactionBusyKey === requestKey) return
    setReactionBusyKey(requestKey)
    try {
      const optimistic = Array.isArray(message?.reactions) ? message.reactions : []
      const target = optimistic.find((entry: any) => entry.emoji === emoji)
      const nextOptimistic = target
        ? optimistic.map((entry: any) =>
            entry.emoji === emoji
              ? { ...entry, reactedByMe: !entry.reactedByMe, count: Math.max(0, Number(entry.count || 0) + (entry.reactedByMe ? -1 : 1)) }
              : entry
          ).filter((entry: any) => Number(entry.count || 0) > 0)
        : [...optimistic, { emoji, count: 1, reactedByMe: true }]
      patchMessageById(messageId, (item) => ({ ...item, reactions: nextOptimistic }))

      const response = await fetch(
        `/api/wa-orchestrator/channels/${channel}/conversations/${encodeURIComponent(remoteJid)}/messages/${encodeURIComponent(messageId)}/reactions/toggle`,
        {
          method: 'POST',
          headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ emoji })
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        patchMessageById(messageId, (item) => ({ ...item, reactions: optimistic }))
        toast.error(payload?.error || 'Falha ao reagir à mensagem.')
        return
      }
      patchMessageById(messageId, (item) => ({ ...item, reactions: payload.reactions || [] }))
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao reagir à mensagem.')
    } finally {
      setReactionBusyKey((current) => (current === requestKey ? null : current))
    }
  }, [selectedConversation, orchestratorStatus, reactionBusyKey, patchMessageById])

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
    if (!selectedConversation) return
    const trimmed = messageInput.trim()
    if (!trimmed) return
    const isLeadOnly = selectedConversation?.platform === 'lead'
    setSendingMessage(true)
    try {
      const legacyReplyPrefix = replyTarget ? `${formatReplyPrefix(replyTarget.text)}\n` : ''
      const outboundText = trimmed
      if (selectedConversation?.platform === 'instagram') {
        const sent = await sendDirectMessage(
          selectedConversation.conversationId,
          `${legacyReplyPrefix}${outboundText}`,
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
          : normalizeWhatsAppJid(selectedConversation.conversationId || selectedConversation.phone || '')
        if (!remoteJid) {
          toast.error('Número inválido para envio.')
          return
        }
        const res = await fetch(
          `/api/wa-orchestrator/channels/${channel}/conversations/${encodeURIComponent(remoteJid)}/send`,
          {
            method: 'POST',
            headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              text: outboundText,
              replyToMessageId: replyTarget?.id || undefined,
              replyToPreview: replyTarget?.text || undefined
            })
          }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.success === false) {
          toast.error(data?.error || 'Falha ao enviar mensagem.')
          return
        }
        if (isLeadOnly) {
          setHarmoniaMessages((prev) => [
            ...prev,
            {
              id: `out-${Date.now()}`,
              direction: 'outbound',
              text: outboundText,
              created_at: new Date().toISOString(),
              replyTo: replyTarget || undefined
            }
          ])
        }
      } else if (isLeadOnly) {
        toast.error('Envio direto de lead requer WhatsApp conectado.')
        return
      } else {
        const res = await fetch(`/api/conversations/${encodeURIComponent(selectedConversation.conversationId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction: 'outbound', type: 'text', text: `${legacyReplyPrefix}${outboundText}` })
        })
        await res.json().catch(() => ({}))
      }
      setMessageInput('')
      setReplyTarget(null)
      if (selectedConversation?.platform !== 'instagram' && !isLeadOnly) {
        loadMessages(selectedConversation)
      }
    } finally {
      setSendingMessage(false)
    }
  }, [igAccessToken, instagram.businessAccountId, loadMessages, messageInput, provider, selectedConversation, orchestratorStatus, replyTarget])

  const scrollMessagesToBottom = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (!provider) return
    if (provider !== 'evolution') return
    if (!orchestratorStatus?.instances?.length) return
    if (conversationsCount > 0) return
    const anyConnected = orchestratorStatus.instances.some((instance) => instance.status === 'connected')
    if (anyConnected) {
      loadConversations()
    }
  }, [provider, orchestratorStatus, conversationsCount, loadConversations])

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
    if (provider !== 'evolution') return
    const token = getCrmBasicAuthToken()
    const params = token ? `?auth=${encodeURIComponent(token)}` : ''
    const source = new EventSource(`/api/wa-orchestrator/events${params}`, { withCredentials: true })

    source.onmessage = (event) => {
      let payload: any = null
      try {
        payload = JSON.parse(event.data || '{}')
      } catch {
        return
      }
      if (!payload) return

      if (payload.type === 'message_reaction_updated') {
        const remoteJid = normalizeWhatsAppJid(payload.remoteJid || '')
        const selectedJid = normalizeWhatsAppJid(selectedConversation?.conversationId || selectedConversation?.phone || '')
        if (
          payload.messageId &&
          selectedConversation &&
          remoteJid &&
          selectedJid === remoteJid &&
          Number(payload.channel) === Number(selectedConversation?.channel || payload.channel)
        ) {
          patchMessageById(String(payload.messageId), (item) => ({ ...item, reactions: payload.reactions || [] }))
        }
        return
      }

      if (payload.type === 'message_metadata_updated') {
        const remoteJid = normalizeWhatsAppJid(payload.remoteJid || '')
        const selectedJid = normalizeWhatsAppJid(selectedConversation?.conversationId || selectedConversation?.phone || '')
        if (
          payload.messageId &&
          selectedConversation &&
          remoteJid &&
          selectedJid === remoteJid &&
          Number(payload.channel) === Number(selectedConversation?.channel || payload.channel)
        ) {
          patchMessageById(String(payload.messageId), (item) => ({ ...item, replyTo: payload.replyTo || item.replyTo }))
        }
        return
      }

      const webhookEvent = String(payload.event || '').toLowerCase()
      if (!selectedConversation) return
      if (webhookEvent === 'messages.upsert' || webhookEvent === 'messages.update' || webhookEvent === 'chats.update') {
        if (waEventsRefreshTimerRef.current) {
          window.clearTimeout(waEventsRefreshTimerRef.current)
        }
        waEventsRefreshTimerRef.current = window.setTimeout(() => {
          void loadMessages(selectedConversation, { silent: true })
        }, 350)
      }
    }

    source.onerror = () => {
      source.close()
    }

    return () => {
      if (waEventsRefreshTimerRef.current) {
        window.clearTimeout(waEventsRefreshTimerRef.current)
        waEventsRefreshTimerRef.current = null
      }
      source.close()
    }
  }, [provider, selectedConversation, loadMessages, patchMessageById])

  useEffect(() => {
    if (!qrDialogChannel || !orchestratorStatus?.instances?.length) return
    const instance = orchestratorStatus.instances.find((item) => item.channel === qrDialogChannel)
    if (instance?.status === 'connected') {
      const timer = qrPollingRef.current.get(qrDialogChannel)
      if (timer) {
        window.clearTimeout(timer)
        qrPollingRef.current.delete(qrDialogChannel)
      }
      toast.success(`WhatsApp conectado no canal ${qrDialogChannel}`)
      setQrDialogChannel(null)
      setWaStatusOpen(false)
    }
  }, [orchestratorStatus, qrDialogChannel])

  useEffect(() => {
    if (selectedConversation?.platform === 'instagram') {
      const convo = igDMs[selectedConversation.conversationId] || []
      setMessages(convo)
    }
  }, [igDMs, selectedConversation])

  useEffect(() => {
    setReplyTarget(null)
    setReactionPickerMessageId(null)
  }, [selectedConversation?.conversationId, selectedConversation?.channel])

  useEffect(() => {
    if (!selectedConversation) return
    autoScrollRef.current = true
  }, [selectedConversation?.conversationId, selectedConversation?.channel])

  useEffect(() => {
    if (!selectedConversation) return
    if (selectedConversation.platform === 'lead' || selectedConversation.platform === 'instagram') return
    if (provider !== 'evolution') return

    const interval = window.setInterval(async () => {
      const items = await loadMessages(selectedConversation, { silent: true })
      const last = Array.isArray(items) && items.length ? items[items.length - 1] : null
      const key = last?.id || last?.timestamp || last?.createdAt || ''
      if (key && key !== lastMessageKeyRef.current) {
        lastMessageKeyRef.current = key
        scrollMessagesToBottom()
      }
    }, 5000)

    return () => window.clearInterval(interval)
  }, [loadMessages, provider, scrollMessagesToBottom, selectedConversation])

  useEffect(() => {
    const last = messages[messages.length - 1]
    const key = last?.id || last?.timestamp || last?.createdAt || ''
    if (key) lastMessageKeyRef.current = key
  }, [messages])

  useEffect(() => {
    if (!autoScrollRef.current || !selectedConversation) return
    if (selectedConversation.platform === 'lead' && harmoniaMessagesLoading) return
    if (selectedConversation.platform !== 'lead' && loadingMessages) return
    const raf = requestAnimationFrame(() => {
      scrollMessagesToBottom()
      autoScrollRef.current = false
    })
    return () => cancelAnimationFrame(raf)
  }, [selectedConversation, harmoniaMessagesLoading, loadingMessages, messages.length, harmoniaMessages.length, scrollMessagesToBottom])

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
      const h = await harmoniaApiJson<HarmoniaHealth>('/api/harmonia/health')
      let u: { ok: boolean; data?: HarmoniaUnit[] } = { ok: false, data: [] }
      if (h?.harmonia?.dbConfigured) {
        u = await harmoniaApiJson<{ ok: boolean; data?: HarmoniaUnit[] }>('/api/harmonia/units').catch(() => ({ ok: false, data: [] }))
      }
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
      return QRCode.toDataURL(normalized, { width: 300, margin: 2, color: { dark: QR_DARK, light: QR_LIGHT } })
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
            : await QRCode.toDataURL(normalizedQr, { width: 300, margin: 2, color: { dark: QR_DARK, light: QR_LIGHT } })
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

  const whatsappConnected = useMemo(
    () => (orchestratorStatus?.connectedInstances ?? 0) > 0,
    [orchestratorStatus?.connectedInstances]
  )
  const connectedWhatsapps = useMemo(
    () => orchestratorStatus?.instances?.filter((instance) => instance.status === 'connected') ?? [],
    [orchestratorStatus?.instances]
  )
  const paused = Boolean(
    (statusPausedUntil && Date.now() < statusPausedUntil) ||
      (conversationsPausedUntil && Date.now() < conversationsPausedUntil) ||
      (harmoniaInboxPausedUntil && Date.now() < harmoniaInboxPausedUntil)
  )
  const headerState = useMemo<OmnichannelHeaderState>(
    () => ({
      whatsappConnected,
      connectedWhatsapps: connectedWhatsapps.length,
      instagramConnected: Boolean(instagram?.connected),
      facebookConfigured,
      supportStats,
      ticketFilter,
      paused
    }),
    [
      whatsappConnected,
      connectedWhatsapps.length,
      instagram?.connected,
      facebookConfigured,
      supportStats,
      ticketFilter,
      paused
    ]
  )

  useEffect(() => {
    onHeaderStateChange?.(headerState)
  }, [headerState, onHeaderStateChange])

  const openTicketsModal = useCallback(
    (filter: 'total' | 'open' | 'overdue' | 'resolved') => {
      setTicketFilter(filter)
      setShowNewTicket(false)
      setTicketsModalOpen(true)
    },
    []
  )

  useImperativeHandle(
    ref,
    () => ({
      openWhatsAppStatus: () => setWaStatusOpen(true),
      openInstagramStatus: () => setIgStatusOpen(true),
      openFacebookStatus: () => setFbStatusOpen(true),
      openTicketsModal
    }),
    [openTicketsModal]
  )

  useEffect(() => {
    const handler = (event: Event) => {
      const action = String((event as CustomEvent<{ action?: string }>)?.detail?.action || '').trim()
      if (!action) return
      if (action === 'wa') {
        setWaStatusOpen(true)
        return
      }
      if (action === 'ig') {
        setIgStatusOpen(true)
        return
      }
      if (action === 'fb') {
        setFbStatusOpen(true)
        return
      }
      if (action === 'tickets-total') {
        openTicketsModal('total')
        return
      }
      if (action === 'tickets-open') {
        openTicketsModal('open')
        return
      }
      if (action === 'tickets-overdue') {
        openTicketsModal('overdue')
        return
      }
      if (action === 'tickets-resolved') {
        openTicketsModal('resolved')
      }
    }
    window.addEventListener('skincos:atendimento:header-action', handler as EventListener)
    return () => window.removeEventListener('skincos:atendimento:header-action', handler as EventListener)
  }, [openTicketsModal])

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
      conversationId: normalizeWhatsAppJid(conv.conversationId || conv.id || conv.remoteJid),
      platform: conv.platform || (provider === 'evolution' ? 'whatsapp' : provider),
      name: conv.name && !isLikelyWhatsAppJid(conv.name) ? conv.name : undefined,
      phone: conv.phone || conv.contactPhone || conv.contact_phone || conv.contact_phone_raw,
    }))

    const instagramItems = Object.entries(igDMs || {}).map(([userId, msgs]) => {
      const profile = igProfiles[userId]
      const last = msgs[msgs.length - 1]
      const name = profile?.username ? `@${profile.username}` : `@${userId}`
      return {
        conversationId: userId,
        name,
        profilePic: profile?.profilePic,
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
    const matchesFilter = (conv: any) => {
      if (conversationFilter === 'all') return true
      const unreadCount = Number(conv?.unreadCount ?? conv?.unreadMessages ?? conv?.unread_messages ?? 0)
      const labels = conv?.labels || conv?.tags || conv?.etiquetas || []
      const hasLabels = Array.isArray(labels) ? labels.length > 0 : Boolean(labels)
      const isFavorite = Boolean(conv?.isFavorite || conv?.favorite || conv?.starred)
      const isArchived = Boolean(conv?.archived || conv?.isArchived)
      const jid = String(conv?.conversationId || '')
      const isGroup = Boolean(conv?.isGroup || conv?.group || conv?.type === 'group' || jid.includes('@g.us'))
      const isCommunity = Boolean(conv?.isCommunity || conv?.community || conv?.type === 'community')

      switch (conversationFilter) {
        case 'unread':
          return unreadCount > 0
        case 'labels':
          return hasLabels
        case 'favorites':
          return isFavorite
        case 'communities':
          return isCommunity
        case 'groups':
          return isGroup
        case 'archived':
          return isArchived
        default:
          return true
      }
    }

    const scoped = combinedConversations.filter(matchesFilter)
    if (!term) return scoped
    return scoped.filter((conv) => {
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
  }, [combinedConversations, conversationFilter, searchQuery])

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
    const filterLabelMap = {
      total: 'Todos',
      open: 'Abertos (≤ 24h)',
      overdue: 'Atrasados (> 24h)',
      resolved: 'Resolvidos'
    } as const
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {paused ? (
          <div className="flex justify-end">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-1 text-xs text-amber-100">
              Atualização pausada
            </span>
          </div>
        ) : null}
        <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 xl:grid-cols-12">
          <Card className="glass-card xl:col-span-4 flex min-h-0 flex-col overflow-hidden">
                <CardContent className="flex min-h-0 flex-col gap-2 pt-4">
                  <div data-testid="conversation-filters" className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 p-1.5">
                    {[
                      { id: 'all', label: 'Todas' },
                      { id: 'unread', label: 'Não lidas' },
                      { id: 'labels', label: 'Etiquetas' },
                      { id: 'favorites', label: 'Favoritos' },
                      { id: 'communities', label: 'Comunidades' },
                      { id: 'groups', label: 'Grupos' },
                      { id: 'archived', label: 'Arquivadas' }
                    ].map((item) => (
                      <Button
                        key={item.id}
                        size="sm"
                        variant="ghost"
                        className={`h-7 rounded-full border px-2.5 text-[11px] font-semibold leading-none ${
                          conversationFilter === item.id
                            ? 'border-blue-300/60 bg-blue-500/35 text-white'
                            : 'border-white/25 bg-white/15 text-white hover:bg-white/20 hover:text-white'
                        }`}
                        onClick={() => setConversationFilter(item.id as any)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                  <Input
                    data-testid="omnichannel-search"
                    placeholder="Buscar por nome, telefone, perfil ou plataforma"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 bg-white/10 border-white/15 text-white placeholder:text-blue-100/55"
                  />
                      <div data-testid="conversation-scroll" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-0">
                        <div className="space-y-1.5 pb-1 pr-2">
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
                          className={`mx-0.5 box-border w-[calc(100%-4px)] min-w-0 p-3 rounded-xl border cursor-pointer transition-colors hover:bg-white/10 ${
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
                            <div className="mt-1 relative">
                              {getPlatformIcon(conv.platform || conv.channel || conv.type, conv.channel)}
                              {Number(conv.unreadCount || 0) > 0 ? (
                                <span className="absolute -top-2 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold text-white">
                                  {conv.unreadCount}
                                </span>
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-white truncate">
                                {resolveConversationDisplayName(conv)}
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
                            <div className="ml-2 shrink-0">
                              <ConversationAvatar conv={conv} size={34} />
                            </div>
                          </div>
                        </div>
                      ))}
                        </div>
                      </div>
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

          <Card className="glass-card xl:col-span-8 flex min-h-0 flex-col overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-lg text-white">
                      {selectedConversation ? resolveConversationDisplayName(selectedConversation) : 'Selecione uma conversa'}
                    </CardTitle>
                    {selectedConversation ? (
                      <div className="shrink-0">
                        <ConversationAvatar conv={selectedConversation} size={40} />
                      </div>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-col gap-4">
                  {selectedConversation ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-4">
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

                      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/10 bg-white/5 p-4">
                        <div ref={messagesViewportRef} className="flex-1 min-h-0 overflow-y-auto pr-2">
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
                                  const replyPreview = resolveReplyPreview(caption, mediaLabel || 'Mensagem')
                                  return (
                                    <div
                                      key={String(m.id || m.provider_message_id || Math.random())}
                                      className={`rounded-xl border ${isInbound ? 'border-sky-500/20 bg-sky-500/10' : 'border-emerald-500/20 bg-emerald-500/10'} p-3`}
                                      onDoubleClick={() => {
                                        openReplyComposer({
                                          id: String(m.id || m.provider_message_id || ''),
                                          text: replyPreview,
                                          direction: dir,
                                          platform: 'lead'
                                        })
                                      }}
                                    >
                                      <div className="flex items-center justify-between gap-3 text-xs">
                                        <div className="text-white/90 font-semibold">
                                          {isInbound ? 'IN' : 'OUT'}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            className="h-6 w-6 rounded-full border border-white/15 bg-white/10 text-blue-100 hover:bg-white/20"
                                            onClick={() => openReplyComposer({
                                              id: String(m.id || m.provider_message_id || ''),
                                              text: caption || mediaLabel || 'Mensagem',
                                              direction: dir,
                                              platform: 'lead'
                                            })}
                                            aria-label="Responder mensagem"
                                          >
                                            <ArrowBendUpLeft className="h-3.5 w-3.5" />
                                          </Button>
                                          <div className="text-white/70">{fmtDateTime(m.created_at || null)}</div>
                                        </div>
                                      </div>
                                      <div className="mt-2 space-y-1">
                                        {mediaLabel ? (
                                          <Badge className="bg-white/10 text-white border border-white/10 text-[11px] px-2 py-0.5 w-fit">
                                            {mediaLabel}
                                          </Badge>
                                        ) : null}
                                        <div className="text-sm text-white whitespace-pre-wrap break-words">
                                          {caption ? renderFormattedText(caption) : <span className="text-white/60">—</span>}
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
                                const messageId = String(msg?.id || '')
                                const media =
                                  msg?.media ||
                                  (msg?.mediaUrl
                                    ? {
                                        type: msg.mediaType || msg.type,
                                        url: msg.mediaUrl || msg.url,
                                        mimeType: msg.mimeType,
                                        fileName: msg.fileName,
                                        durationSec: msg.durationSec
                                      }
                                    : undefined)
                                const showReactionActions = selectedConversation?.platform !== 'lead' && selectedConversation?.platform !== 'instagram'
                                return (
                                  <div key={msg.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                                    <div
                                      className={`group max-w-[88%] md:max-w-[75%] p-3 rounded-lg border ${outbound ? 'border-blue-300/20 bg-blue-500/35 text-white' : 'border-white/10 bg-white/10 text-blue-100'}`}
                                      onDoubleClick={() => {
                                        openReplyComposer(msg)
                                      }}
                                    >
                                      {msg?.replyTo ? (
                                        <button
                                          type="button"
                                          className="mb-2 w-full rounded-md border border-white/15 bg-black/20 px-2 py-1 text-left text-xs text-blue-100/80"
                                        >
                                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-blue-100/60">
                                            <ArrowBendUpLeft className="h-3 w-3" />
                                            Resposta
                                          </span>
                                          <div className="truncate text-blue-100/90">{msg.replyTo.textPreview}</div>
                                        </button>
                                      ) : null}
                                      <div className="text-sm">
                                        {renderFormattedText(msg.text || msg.caption || `[${msg.type}]`)}
                                      </div>
                                      {media ? (
                                        <MessageMedia
                                          media={media}
                                          mediaProxyUrl={msg.mediaProxyUrl}
                                          fallbackText="Mídia indisponível no momento."
                                          onImagePreview={(payload) => setImagePreview(payload)}
                                        />
                                      ) : null}
                                      {Array.isArray(msg?.reactions) && msg.reactions.length > 0 ? (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                          {msg.reactions.map((reaction: any) => (
                                            <button
                                              key={`${messageId}-${reaction.emoji}`}
                                              type="button"
                                              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
                                                reaction.reactedByMe
                                                  ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
                                                  : 'border-white/15 bg-white/10 text-blue-100/80'
                                              }`}
                                              onClick={() => toggleReaction(msg, reaction.emoji)}
                                            >
                                              <span>{reaction.emoji}</span>
                                              <span>{reaction.count}</span>
                                            </button>
                                          ))}
                                        </div>
                                      ) : null}
                                      {showReactionActions ? (
                                        <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            className="h-6 rounded-full border border-white/15 bg-white/10 px-2 text-[10px] text-blue-100 hover:bg-white/20"
                                            onClick={() => openReplyComposer(msg)}
                                            aria-label="Responder mensagem"
                                          >
                                            <ArrowBendUpLeft className="h-3.5 w-3.5" />
                                            Reply
                                          </Button>
                                          <div className="relative">
                                            <Button
                                              type="button"
                                              size="icon"
                                              variant="ghost"
                                              className="h-6 w-6 rounded-full border border-white/15 bg-white/10 text-blue-100 hover:bg-white/20"
                                              onClick={() => setReactionPickerMessageId((current) => current === messageId ? null : messageId)}
                                              aria-label="Reagir mensagem"
                                            >
                                              <Smiley className="h-3.5 w-3.5" />
                                            </Button>
                                            {reactionPickerMessageId === messageId ? (
                                              <div className="absolute right-0 top-7 z-20 flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/95 p-1 shadow-lg">
                                                {reactionOptions.map((emoji) => (
                                                  <button
                                                    key={`${messageId}-${emoji}`}
                                                    type="button"
                                                    className="h-7 w-7 rounded-full hover:bg-white/10"
                                                    onClick={() => {
                                                      void toggleReaction(msg, emoji)
                                                      setReactionPickerMessageId(null)
                                                    }}
                                                    disabled={reactionBusyKey === `${messageId}:${emoji}`}
                                                  >
                                                    {emoji}
                                                  </button>
                                                ))}
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                      ) : null}
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
                        </div>

                        {replyTarget && (
                          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-blue-100/70">
                            <div className="truncate">
                              Respondendo: <span className="text-white/90">{replyTarget.text}</span>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => setReplyTarget(null)}
                              aria-label="Cancelar resposta"
                            >
                              ✕
                            </Button>
                          </div>
                        )}

                        <div className="mt-3 flex gap-2">
                          <Textarea
                            placeholder="Digite sua mensagem..."
                            value={messageInput}
                            onChange={(e) => setMessageInput(e.target.value)}
                            ref={messageInputRef}
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
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center">
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

        <Dialog open={Boolean(imagePreview)} onOpenChange={(open) => { if (!open) setImagePreview(null) }}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Visualizar imagem</DialogTitle>
              <DialogDescription>Clique fora da janela para fechar.</DialogDescription>
            </DialogHeader>
            {imagePreview?.src ? (
              <div className="max-h-[75vh] overflow-auto rounded-lg border border-white/10 bg-black/40 p-2">
                <img src={imagePreview.src} alt={imagePreview.alt || 'Imagem'} className="mx-auto max-h-[70vh] w-auto object-contain" />
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

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
      <div className="flex h-full min-h-0 flex-col">
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
    <div className="flex h-full min-h-0 flex-col gap-6">
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
})
