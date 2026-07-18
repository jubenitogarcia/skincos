import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react"
import { createPortal } from "react-dom"
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
  CircleNotch,
  CheckCircle,
  Warning,
  Sparkle,
  Ticket,
  Star,
  Smiley,
  ArrowCircleDown,
  ArrowBendUpLeft,
  ArrowBendUpRight,
  ArrowCircleUp,
  Archive,
  BellSimpleSlash,
  Broom,
  CaretDown,
  ChatCircleText,
  CopySimple,
  DotsThreeVertical,
  DownloadSimple,
  EnvelopeSimpleOpen,
  FilePdf,
  HeartStraight,
  ImageSquare,
  LockSimple,
  Prohibit,
  PushPin,
  Trash,
  TrashSimple,
  UserList,
  WarningCircle
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
    ownerJid?: string
    profileName?: string
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
  bootstrapSync?: Record<string, any>
}

type OrchestratorIssue = {
  code: string
  message: string
  retriable: boolean
}

function normalizeChannelStatus(value: any): ChannelStatus {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'free'
  if (
    normalized === 'free' ||
    normalized === 'available' ||
    normalized === 'stopped' ||
    normalized === 'disconnected' ||
    normalized === 'idle' ||
    normalized === 'close' ||
    normalized === 'closed' ||
    normalized === 'logout'
  ) return 'free'
  if (normalized === 'open') return 'connected'
  if (normalized === 'connecting') return 'qr_pending'
  if (
    normalized === 'starting' ||
    normalized === 'qr_pending' ||
    normalized === 'connected' ||
    normalized === 'error' ||
    normalized === 'stopping'
  ) {
    return normalized as ChannelStatus
  }
  return 'error'
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
  return digits ? `${digits}@s.whatsapp.net` : raw
}

function buildWhatsAppIdentityAliases(value?: string | null) {
  const raw = String(value || '').trim()
  const normalized = normalizeWhatsAppJid(raw)
  const phone = extractPhoneFromId(raw || normalized)
  const aliases = new Set<string>()
  if (raw) aliases.add(raw.toLowerCase())
  if (normalized) aliases.add(normalized.toLowerCase())
  if (phone) {
    aliases.add(phone)
    aliases.add(`${phone}@s.whatsapp.net`)
  }
  return aliases
}

function doesWhatsAppIdentityMatch(a?: string | null, b?: string | null) {
  const left = buildWhatsAppIdentityAliases(a)
  const right = buildWhatsAppIdentityAliases(b)
  if (!left.size || !right.size) return false
  for (const alias of left) {
    if (right.has(alias)) return true
  }
  return false
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
  const rawName =
    conv?.preferredName ||
    conv?.leadName ||
    conv?.name ||
    conv?.contact_display_name ||
    conv?.contactName ||
    conv?.pushName ||
    ''
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

function resolveConversationInteractionTimestamp(conv: any) {
  const candidates = [
    conv?.lastInteractionAt,
    conv?.lastMessageAt,
    conv?.last_message_at,
    conv?.lastActivity,
    conv?.last_activity_at,
    conv?.updatedAt,
    conv?.updated_at,
    conv?.leadUpdatedAt,
    conv?.createdAt,
    conv?.created_at
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const value = new Date(candidate).getTime()
    if (Number.isFinite(value) && value > 0) return value
  }

  return 0
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

function normalizeMessageSemanticType(raw?: string | null) {
  const type = String(raw || '').trim().toLowerCase()
  if (!type) return ''
  if (type.includes('sticker')) return 'sticker'
  if (type.includes('image')) return 'image'
  if (type.includes('audio') || type.includes('ptt') || type.includes('voice')) return 'audio'
  if (type.includes('video') || type.includes('ptv')) return 'video'
  if (type.includes('document') || type.includes('pdf') || type.includes('doc') || type.includes('file')) return 'document'
  if (type.includes('call') || type.includes('phone')) return 'call'
  if (type.includes('templatebuttonreply')) return 'template'
  if (type.includes('interactive')) return 'interactive'
  if (type.includes('template')) return 'template'
  if (type.includes('placeholder')) return 'placeholder'
  if (type.includes('pininchat') || type === 'pin') return 'pin'
  if (type.includes('reaction')) return 'reaction'
  return type
}

function resolveSemanticLabel(raw?: string | null) {
  switch (normalizeMessageSemanticType(raw)) {
    case 'sticker':
      return 'Sticker'
    case 'image':
      return 'Imagem'
    case 'audio':
      return 'Áudio'
    case 'video':
      return 'Vídeo'
    case 'document':
      return 'Arquivo'
    case 'call':
      return 'Ligação'
    case 'template':
      return 'Modelo'
    case 'interactive':
      return 'Interativa'
    case 'placeholder':
      return 'Conteúdo'
    case 'pin':
      return 'Fixada'
    case 'reaction':
      return 'Reação'
    default:
      return ''
  }
}

function isTransportPlaceholderText(value?: string | null) {
  const text = String(value || '').trim()
  if (!text) return false
  return ['[Sticker]', '[Mensagem]', '[Áudio]', '[Video]', '[Vídeo]', '[Documento]', '[Arquivo]', '[Ligação]'].includes(text)
}

function resolveConversationPreviewMeta(conv: any) {
  const rawText = String(conv?.lastMessage || conv?.last_message_text || '').trim()
  const explicitType =
    conv?.lastMessageMediaType ||
    conv?.lastMessageType ||
    conv?.last_message_media_type ||
    conv?.last_message_type ||
    ''
  const caption = String(conv?.lastMessageCaption || conv?.last_message_caption || '').trim()
  const fileName = String(conv?.lastMessageFileName || conv?.last_message_file_name || '').trim()
  const semanticType =
    normalizeMessageSemanticType(explicitType) ||
    (rawText === '[Sticker]' ? 'sticker' :
      rawText === '[Imagem]' ? 'image' :
      rawText === '[Áudio]' ? 'audio' :
      rawText === '[Ligação]' ? 'call' :
      rawText === '[Mensagem]' ? '' : '')

  const label = resolveSemanticLabel(semanticType)
  const visibleText = caption || (!isTransportPlaceholderText(rawText) ? rawText : '')
  const fallbackText = rawText === '[Mensagem]' ? 'Mensagem' : ''
  const previewText = visibleText || fileName || label || fallbackText || 'Sem mensagens'

  return {
    semanticType,
    previewText,
    mediaProxyUrl: String(conv?.lastMessageMediaProxyUrl || '').trim()
  }
}

function resolveMessageBodyText(msg: any) {
  const text = String(msg?.text || '').trim()
  const caption = String(msg?.caption || '').trim()
  if (caption && !isTransportPlaceholderText(caption)) return caption
  if (text && !isTransportPlaceholderText(text)) return text
  const label = resolveSemanticLabel(msg?.mediaType || msg?.type)
  if (normalizeMessageSemanticType(msg?.mediaType || msg?.type) === 'reaction') return ''
  if (msg?.media || msg?.mediaUrl) return ''
  return label
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

type MentionRenderMeta = {
  label: string
  color?: string
}

type ParticipantRenderMeta = MentionRenderMeta & {
  avatarUrl?: string
}

type RenderFormattedTextOptions = {
  resolveMention?: (token: string) => MentionRenderMeta | null
}

function buildMessageUiAnchorKey(message: any, index: number) {
  const messageId = String(message?.id || message?.provider_message_id || '').trim() || 'msg'
  const timestamp = String(message?.createdAt || message?.timestamp || message?.created_at || '').trim() || 'ts'
  const sender = String(
    message?.senderJid ||
    message?.senderLid ||
    message?.senderPhone ||
    message?.senderName ||
    message?.direction ||
    ''
  ).trim() || 'sender'
  return `${messageId}::${timestamp}::${sender}::${index}`
}

const GROUP_SENDER_PALETTE = [
  { bubbleBg: 'rgba(56, 189, 248, 0.16)', border: 'rgba(56, 189, 248, 0.45)', title: '#7dd3fc', mention: '#7dd3fc' },
  { bubbleBg: 'rgba(16, 185, 129, 0.16)', border: 'rgba(16, 185, 129, 0.45)', title: '#6ee7b7', mention: '#6ee7b7' },
  { bubbleBg: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.45)', title: '#fcd34d', mention: '#fcd34d' },
  { bubbleBg: 'rgba(244, 63, 94, 0.16)', border: 'rgba(244, 63, 94, 0.45)', title: '#fda4af', mention: '#fda4af' },
  { bubbleBg: 'rgba(167, 139, 250, 0.16)', border: 'rgba(167, 139, 250, 0.45)', title: '#c4b5fd', mention: '#c4b5fd' },
  { bubbleBg: 'rgba(20, 184, 166, 0.16)', border: 'rgba(20, 184, 166, 0.45)', title: '#5eead4', mention: '#5eead4' }
]

function resolveGroupSenderStyle(seed?: string | null) {
  const value = String(seed || '').trim().toLowerCase() || 'unknown'
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i)
    hash |= 0
  }
  return GROUP_SENDER_PALETTE[Math.abs(hash) % GROUP_SENDER_PALETTE.length]
}

function buildMentionAliases(value?: string | null) {
  const aliases = new Set<string>()
  const raw = String(value || '').trim()
  if (!raw) return aliases
  const normalized = raw.toLowerCase()
  aliases.add(normalized)
  const local = normalized.includes('@') ? normalized.split('@')[0] : normalized
  if (local) aliases.add(local)
  const localNoDevice = local.split(':')[0]
  if (localNoDevice) aliases.add(localNoDevice)
  const digits = normalizePhone(raw)
  if (digits) aliases.add(digits)
  return aliases
}

function renderFormattedText(input?: string | null, options?: RenderFormattedTextOptions): ReactNode {
  const text = String(input || '')
  if (!text) return null

  const tokens: ReactNode[] = []
  const pattern = /```([\s\S]*?)```|`([^`]+)`|\*([^*]+)\*|_([^_]+)_|~([^~]+)~/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  const mentionPattern = /(^|[^\w])@([0-9A-Za-z._:-]{3,})/g

  const pushMentionAwareLine = (line: string) => {
    let cursor = 0
    mentionPattern.lastIndex = 0
    let mentionMatch: RegExpExecArray | null
    while ((mentionMatch = mentionPattern.exec(line)) !== null) {
      const [full, prefix, mentionToken] = mentionMatch
      const start = mentionMatch.index
      const prefixStart = start
      if (prefixStart > cursor) {
        tokens.push(line.slice(cursor, prefixStart))
      }
      if (prefix) tokens.push(prefix)
      const resolvedMention = options?.resolveMention?.(mentionToken)
      tokens.push(
        <span
          key={`mention-${tokens.length}`}
          className="font-semibold underline underline-offset-2 decoration-solid"
          style={{ color: resolvedMention?.color || '#93c5fd' }}
        >
          @{resolvedMention?.label || mentionToken}
        </span>
      )
      cursor = start + full.length
    }
    if (cursor < line.length) tokens.push(line.slice(cursor))
  }

  const pushPlain = (value: string) => {
    if (!value) return
    const parts = value.split('\n')
    parts.forEach((part, idx) => {
      if (idx > 0) tokens.push(<br key={`br-${tokens.length}`} />)
      if (part) pushMentionAwareLine(part)
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
  onImagePreview,
  onFilePreview
}: {
  media?: { type?: string; url?: string; mimeType?: string; fileName?: string; durationSec?: number }
  mediaProxyUrl?: string
  fallbackText?: string
  onImagePreview: (payload: { src: string; alt?: string }) => void
  onFilePreview: (payload: { src: string; title?: string; mimeType?: string }) => void
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
  const isSticker = type.includes('sticker')

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

  if (isImage || isSticker) {
    return (
      <button
        type="button"
        className="mt-2 block overflow-hidden rounded-lg border border-white/15 bg-black/20"
        onClick={() => onImagePreview({ src, alt: media?.fileName || 'Imagem da mensagem' })}
      >
        <img
          src={src}
          alt={media?.fileName || 'Imagem'}
          className={isSticker ? 'max-h-48 w-auto object-contain' : 'max-h-64 w-full object-cover'}
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
        <Button
          type="button"
          variant="outline"
          className="h-7 w-fit border-white/15 bg-white/10 text-xs text-blue-100 hover:bg-white/20"
          onClick={() => onFilePreview({ src, title: media?.fileName || 'Documento PDF', mimeType })}
        >
          <DownloadSimple className="h-3.5 w-3.5" />
          Visualizar arquivo
        </Button>
      </div>
    )
  }

  if (isDocument) {
    return (
      <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-2 py-1.5 text-xs text-blue-100">
        <FilePdf className="h-4 w-4" />
        <span className="max-w-[200px] truncate">
          {media?.fileName || 'Abrir documento'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 border-white/15 bg-white/10 px-2 text-[10px] hover:bg-white/20"
          onClick={() => onFilePreview({ src, title: media?.fileName || 'Documento', mimeType })}
        >
          Visualizar arquivo
        </Button>
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
    <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/20 px-2 py-1.5 text-xs text-blue-100">
      <ImageSquare className="h-4 w-4" />
      <span className="max-w-[220px] truncate">{media?.fileName || 'Arquivo'}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 border-white/15 bg-white/10 px-2 text-[10px] hover:bg-white/20"
        onClick={() => onFilePreview({ src, title: media?.fileName || 'Arquivo', mimeType })}
      >
        Visualizar arquivo
      </Button>
    </div>
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
  const [conversationFilter, setConversationFilter] = useState<'unread' | 'labels' | 'favorites' | 'communities' | 'groups' | 'archived' | null>(null)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [conversationsFailureCount, setConversationsFailureCount] = useState(0)
  const [conversationsPausedUntil, setConversationsPausedUntil] = useState<number | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [markingConversationRead, setMarkingConversationRead] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [sendUnitChannel, setSendUnitChannel] = useState<string>('')
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const conversationFiltersRef = useRef<HTMLDivElement | null>(null)
  const autoScrollRef = useRef(false)
  const lastMessageKeyRef = useRef<string>('')
  const [replyTarget, setReplyTarget] = useState<{
    id: string
    text: string
    direction?: string
    platform?: string
  } | null>(null)
  const [imagePreview, setImagePreview] = useState<{ src: string; alt?: string } | null>(null)
  const [filePreview, setFilePreview] = useState<{ src: string; title?: string; mimeType?: string } | null>(null)
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null)
  const [openMessageActionMenuId, setOpenMessageActionMenuId] = useState<string | null>(null)
  const [expandedReactionMenuId, setExpandedReactionMenuId] = useState<string | null>(null)
  const [messageActionMenuLayout, setMessageActionMenuLayout] = useState<{
    anchorKey: string
    top: number
    left: number
    maxHeight: number
    width: number
  } | null>(null)
  const [openConversationActionMenuId, setOpenConversationActionMenuId] = useState<string | null>(null)
  const [conversationActionMenuLayout, setConversationActionMenuLayout] = useState<{
    conversationId: string
    top: number
    left: number
    width: number
  } | null>(null)
  const [reactionBusyKey, setReactionBusyKey] = useState<string | null>(null)
  const [messageSelectionMode, setMessageSelectionMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([])
  const [messageScrollState, setMessageScrollState] = useState({ canScrollUp: false, canScrollDown: false })
  const [scrollAffordanceZone, setScrollAffordanceZone] = useState<'top' | 'bottom' | null>(null)
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus | null>(null)
  const [orchestratorIssue, setOrchestratorIssue] = useState<OrchestratorIssue | null>(null)
  const orchestratorStatusRef = useRef<OrchestratorStatus | null>(null)
  const [statusFailureCount, setStatusFailureCount] = useState(0)
  const [statusPausedUntil, setStatusPausedUntil] = useState<number | null>(null)
  const [channelQR, setChannelQR] = useState<Map<number, QRData>>(new Map())
  const [qrDialogChannel, setQrDialogChannel] = useState<number | null>(null)
  const [qrConnectionPhase, setQrConnectionPhase] = useState<'idle' | 'starting' | 'waiting' | 'rendering' | 'ready' | 'error'>('idle')
  const [qrConnectionError, setQrConnectionError] = useState<string | null>(null)
  const [waInitialSyncChannel, setWaInitialSyncChannel] = useState<number | null>(null)
  const waInitialSyncChannelRef = useRef<number | null>(null)
  const qrPollingRef = useRef<Map<number, NodeJS.Timeout>>(new Map())
  const qrPollingInFlightRef = useRef<Set<number>>(new Set())
  const qrLastSuccessAtRef = useRef<Map<number, number>>(new Map())
  const qrDialogChannelRef = useRef<number | null>(null)
  const waEventsRefreshTimerRef = useRef<number | null>(null)
  const waConversationRefreshTimerRef = useRef<number | null>(null)
  const [waStatusOpen, setWaStatusOpen] = useState(false)
  const [connectedChannelAction, setConnectedChannelAction] = useState<Record<number, 'refresh' | 'disconnect' | undefined>>({})
  const [refreshAllChannelsLoading, setRefreshAllChannelsLoading] = useState(false)
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
  const selectedMessageIdSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds])
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
  const messageActionRootRefs = useRef(new Map<string, HTMLDivElement>())
  const messageActionMenuRef = useRef<HTMLDivElement | null>(null)
  const messageActionMenuLayoutRafRef = useRef<number | null>(null)
  const conversationScrollViewportRef = useRef<HTMLDivElement | null>(null)
  const conversationActionTriggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const conversationActionMenuRef = useRef<HTMLDivElement | null>(null)
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
      const status = normalizeChannelStatus(ch?.status)
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
        payload?.freeChannelsList ?? normalizedInstances.filter((c) => c.status === 'free').map((c) => c.channel),
      bootstrapSync:
        payload?.bootstrapSync && typeof payload.bootstrapSync === 'object'
          ? payload.bootstrapSync
          : {}
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
        const code = String(data?.code || data?.error || `HTTP_${res.status}`)
        const message = String(
          data?.hint ||
          (code === 'WA_ORCHESTRATOR_API_TARGET_REQUIRED'
            ? 'Integração WhatsApp não configurada neste ambiente.'
            : code === 'WA_ORCHESTRATOR_TARGET_UNREACHABLE'
              ? 'Não foi possível alcançar o orquestrador WhatsApp local.'
              : 'Não foi possível consultar o orquestrador WhatsApp.')
        )
        setOrchestratorIssue({ code, message, retriable: res.status >= 500 || res.status === 408 || res.status === 429 })
        setOrchestratorStatus(null)
        throw new Error(code)
      }
      setProvider(data?.provider || null)
      const normalized = normalizeOrchestratorStatus(data)
      setOrchestratorStatus(normalized)
      setOrchestratorIssue(null)
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

  const loadConversations = useCallback(async (options?: { disableCache?: boolean }) => {
    const disableCache = Boolean(options?.disableCache)
    if (!provider) return []
    if (conversationsPausedUntil && Date.now() < conversationsPausedUntil) return []
    if (!disableCache && provider === 'evolution' && conversationsCount === 0) {
      const cached = readConversationCache()
      if (cached?.length) {
        setConversations(cached)
      }
    }
    setLoadingConversations(conversationsCount === 0)
    try {
      if (provider === 'evolution') {
        const archivedOnly = conversationFilter === 'archived'
        const fetchLimit = archivedOnly ? 200 : CONVERSATION_FETCH_LIMIT
        const channels =
          orchestratorStatus?.instances
            ?.filter((instance) => instance.status === 'connected')
            .map((instance) => instance.channel) || []
        if (!channels.length) {
          setConversations([])
          return []
        }
        const results = await Promise.all(
          channels.map(async (channel) => {
            const res = await fetch(
              `/api/wa-orchestrator/channels/${channel}/conversations?limit=${fetchLimit}${archivedOnly ? '&archivedOnly=1' : ''}`,
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
        return merged
      } else {
        const res = await fetch('/api/conversations')
        const data = await res.json()
        if (res.ok) {
          const merged = data?.items || data || []
          setConversations(merged)
          if (merged?.length) writeConversationCache(merged)
          return merged
        }
      }
      setConversationsFailureCount(0)
      setConversationsPausedUntil(null)
      return []
    } catch {
      setConversationsFailureCount((prev) => {
        const next = prev + 1
        if (next >= 5) {
          setConversationsPausedUntil(Date.now() + 60000)
          return 0
        }
        return next
      })
      return []
    } finally {
      setLoadingConversations(false)
    }
  }, [
    provider,
    orchestratorStatus,
    conversationFilter,
    conversationsPausedUntil,
    conversationsCount,
    readConversationCache,
    writeConversationCache
  ])

  const finishInitialWhatsAppSync = useCallback((channel: number) => {
    if (waInitialSyncChannelRef.current !== channel) return
    waInitialSyncChannelRef.current = null
    setWaInitialSyncChannel(null)
    if (qrDialogChannelRef.current === channel) {
      setQrDialogChannel(null)
    }
    setWaStatusOpen(false)
  }, [])

  const runInitialWhatsAppSync = useCallback(async (channel: number) => {
    if (!Number.isFinite(channel) || channel <= 0) return
    if (waInitialSyncChannelRef.current === channel) return
    waInitialSyncChannelRef.current = channel
    setWaInitialSyncChannel(channel)

    let finished = false
    let failedReason = ''
    const maxAttempts = 60
    const startedAt = Date.now()
    const baselineState = orchestratorStatusRef.current?.bootstrapSync?.[String(channel)] || null
    const baselineStartedAt = String(baselineState?.startedAt || '')
    const baselineFailedAt = String(baselineState?.failedAt || '')
    const baselineCompletedAt = String(baselineState?.completedAt || '')
    let runStartedAt = baselineState?.running ? baselineStartedAt : ''
    let observedRun = Boolean(runStartedAt)

    try {
      await fetch(`/api/wa-orchestrator/channels/${channel}/bootstrap-sync`, {
        method: 'POST',
        headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ force: true, reason: 'post-qr-connect' })
      })
        .then(async (response) => response.json().catch(() => null))
        .then((payload) => {
          const syncState = payload?.state || null
          const candidateStartedAt = String(syncState?.startedAt || '')
          if (candidateStartedAt && candidateStartedAt !== baselineStartedAt) {
            runStartedAt = candidateStartedAt
            observedRun = true
          }
        })
        .catch(() => null)
    } catch {
      // keep going; we'll still poll status + conversations
    }

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await loadStatus()
        const list = await loadConversations({ disableCache: true })
        const items = Array.isArray(list) ? list : []
        const hasChannelConversations = items.some((item: any) => Number(item?.channel) === channel)
        const statusSnapshot = orchestratorStatusRef.current
        const bootstrapState = statusSnapshot?.bootstrapSync?.[String(channel)] || null
        const channelState = String(
          statusSnapshot?.instances?.find((item) => Number(item?.channel) === channel)?.status || ''
        ).toLowerCase()
        const phase = String(bootstrapState?.progress?.phase || '').trim().toLowerCase()
        const running = Boolean(bootstrapState?.running) || phase === 'running' || phase === 'syncing'
        const failed = phase === 'failed' || Boolean(bootstrapState?.lastError)
        const completed = phase === 'completed' || Boolean(bootstrapState?.completedAt)
        const currentStartedAt = String(bootstrapState?.startedAt || '')
        const currentFailedAt = String(bootstrapState?.failedAt || '')
        const currentCompletedAt = String(bootstrapState?.completedAt || '')

        if (!observedRun && currentStartedAt && currentStartedAt !== baselineStartedAt) {
          observedRun = true
          runStartedAt = currentStartedAt
        }

        if (observedRun && !runStartedAt && currentStartedAt) {
          runStartedAt = currentStartedAt
        }

        if (failed && currentFailedAt && currentFailedAt !== baselineFailedAt) {
          failedReason = String(bootstrapState?.lastError || '').trim() || 'Falha na sincronização inicial.'
          finished = true
          break
        }

        const completedThisRun =
          observedRun &&
          completed &&
          currentCompletedAt &&
          currentCompletedAt !== baselineCompletedAt &&
          (!runStartedAt || Date.parse(currentCompletedAt) >= Date.parse(runStartedAt))

        if (completedThisRun) {
          finished = true
          break
        }

        // If no explicit bootstrap telemetry appears, fallback only after long wait.
        if (!observedRun && attempt >= 24 && hasChannelConversations && channelState === 'connected') {
          finished = true
          break
        }

        if (channelState && channelState !== 'connected' && channelState !== 'starting' && channelState !== 'qr_pending') {
          failedReason = `Canal ${channel} saiu de conectado durante sincronização (${channelState}).`
          finished = true
          break
        }

        if (running) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500))
          continue
        }

        // Prevent premature close if backend has not yet moved bootstrap state.
        if (!observedRun) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500))
          continue
        }

        if (attempt > 8 && hasChannelConversations && channelState === 'connected') {
          finished = true
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500))
      }
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < 2000) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000 - elapsed))
      }
      finishInitialWhatsAppSync(channel)
    }

    if (finished && !failedReason) {
      toast.success(`WhatsApp conectado no canal ${channel}`)
      return
    }
    if (failedReason) {
      toast.error(`Canal ${channel} conectado, mas a sincronização inicial falhou: ${failedReason}`)
      return
    }
    toast.message(`Canal ${channel} conectado. A sincronização inicial continuará em segundo plano.`)
  }, [finishInitialWhatsAppSync, loadConversations, loadStatus])

  const loadMessages = useCallback(async (conv: any, opts?: { silent?: boolean }) => {
    if (!provider || !conv) return []
    if (!opts?.silent) setLoadingMessages(true)
    try {
      if (provider === 'evolution') {
        const channel = Number(conv?.channel)
        if (!channel) return []
        const res = await fetch(
          `/api/wa-orchestrator/channels/${channel}/conversations/${encodeURIComponent(conv.conversationId)}/messages?limit=80`,
          { headers: buildCrmBasicAuthHeaders() }
        )
        const data = await res.json().catch(() => ({}))
        if (res.ok && data?.success) {
          const items = data.items || []
          setMessages(items)
          return items
        }
        if (!opts?.silent) {
          toast.error(String(data?.error || 'Falha ao carregar mensagens.'))
        }
        return []
      } else {
        const res = await fetch(`/api/conversations/${encodeURIComponent(conv.conversationId)}/messages?limit=80`)
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          const items = data.items || []
          setMessages(items)
          return items
        }
        if (!opts?.silent) {
          toast.error(String(data?.error || 'Falha ao carregar mensagens.'))
        }
        return []
      }
    } catch (error: any) {
      if (!opts?.silent && error?.name !== 'AbortError') {
        toast.error(error?.message || 'Falha ao carregar mensagens.')
      }
      return []
    } finally {
      if (!opts?.silent) setLoadingMessages(false)
    }
  }, [provider])

  const markConversationAsRead = useCallback(async (conv: any, loadedMessages?: any[]) => {
    if (!conv || provider !== 'evolution') return
    const channel = Number(conv?.channel)
    const remoteJid = String(conv?.conversationId || conv?.rawJid || conv?.phone || '').trim()
    if (!channel || !remoteJid) return

    const sourceMessages = Array.isArray(loadedMessages) ? loadedMessages : []
    const inboundIds = sourceMessages
      .filter((msg) => {
        const direction = String(msg?.direction || '').toLowerCase()
        return direction !== 'outbound' && direction !== 'human'
      })
      .map((msg) => String(msg?.id || '').trim())
      .filter(Boolean)

    setMarkingConversationRead(true)
    try {
      const response = await fetch(
        `/api/wa-orchestrator/channels/${channel}/conversations/${encodeURIComponent(remoteJid)}/read`,
        {
          method: 'POST',
          headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            messageIds: inboundIds,
            onlyInbound: true
          })
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        return
      }
      setConversations((prev) => prev.map((item) => {
        const sameChannel = Number(item?.channel || 0) === channel
        const sameContact = doesWhatsAppIdentityMatch(item?.conversationId || item?.rawJid || item?.phone, remoteJid)
        if (!sameChannel || !sameContact) return item
        return { ...item, unreadCount: 0, unreadMessages: 0, unread_messages: 0 }
      }))
      setSelectedConversation((current) => {
        if (!current) return current
        const sameChannel = Number(current?.channel || 0) === channel
        const sameContact = doesWhatsAppIdentityMatch(current?.conversationId || current?.rawJid || current?.phone, remoteJid)
        if (!sameChannel || !sameContact) return current
        return { ...current, unreadCount: 0, unreadMessages: 0, unread_messages: 0 }
      })
    } catch {
      // Best-effort sync: failure to mark as read must not break UI interaction.
    } finally {
      setMarkingConversationRead(false)
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

  const toggleMessageSelection = useCallback((messageId: string) => {
    const normalizedId = String(messageId || '').trim()
    if (!normalizedId) return
    setMessageSelectionMode(true)
    setSelectedMessageIds((prev) => (
      prev.includes(normalizedId)
        ? prev.filter((item) => item !== normalizedId)
        : [...prev, normalizedId]
    ))
  }, [])

  const clearMessageSelection = useCallback(() => {
    setSelectedMessageIds([])
    setMessageSelectionMode(false)
  }, [])

  const toggleMessageFlag = useCallback(async (messageId: string, field: 'favorite' | 'pinned' | 'reported') => {
    const normalizedId = String(messageId || '').trim()
    if (!normalizedId) return
    const channel =
      Number(selectedConversation?.channel) ||
      orchestratorStatus?.instances?.find((instance) => instance.status === 'connected')?.channel
    const remoteJid = normalizeWhatsAppJid(
      selectedConversation?.conversationId ||
      selectedConversation?.rawJid ||
      selectedConversation?.normalizedJid ||
      selectedConversation?.phone ||
      ''
    )
    let previousValue = false
    let nextValue = false
    patchMessageById(normalizedId, (item) => {
      previousValue = Boolean(item?.[field])
      nextValue = !previousValue
      return { ...item, [field]: nextValue }
    })
    try {
      if (channel && remoteJid) {
        const response = await fetch(
          `/api/wa-orchestrator/channels/${channel}/conversations/${encodeURIComponent(remoteJid)}/messages/${encodeURIComponent(normalizedId)}/flags/toggle`,
          {
            method: 'POST',
            headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ field })
          }
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload?.success === false) {
          throw new Error(payload?.error || 'Falha ao atualizar metadados da mensagem.')
        }
        const flags = payload?.flags || {}
        patchMessageById(normalizedId, (item) => ({
          ...item,
          favorite: Boolean(flags.favorite),
          pinned: Boolean(flags.pinned),
          reported: Boolean(flags.reported)
        }))
      }
      const labels = {
        favorite: nextValue ? 'Mensagem favoritada.' : 'Favorito removido.',
        pinned: nextValue ? 'Mensagem fixada.' : 'Mensagem desfixada.',
        reported: nextValue ? 'Mensagem marcada como denunciada.' : 'Denúncia removida.'
      }
      toast.success(labels[field])
    } catch (error: any) {
      patchMessageById(normalizedId, (item) => ({ ...item, [field]: previousValue }))
      toast.error(error?.message || 'Falha ao atualizar metadados da mensagem.')
    }
  }, [orchestratorStatus, patchMessageById, selectedConversation])

  const copyMessageContent = useCallback(async (message: any) => {
    const visibleText = resolveMessageBodyText(message)
    const mediaLabel = resolveSemanticLabel(message?.mediaType || message?.type)
    const mediaUrl = String(message?.mediaProxyUrl || message?.media?.url || '').trim()
    const content = [
      visibleText,
      !visibleText ? mediaLabel : '',
      !visibleText && !mediaLabel ? String(message?.media?.fileName || '').trim() : '',
      !visibleText && !mediaLabel && !message?.media?.fileName ? mediaUrl : ''
    ].filter(Boolean).join('\n')

    if (!content) {
      toast.error('Nada para copiar nesta mensagem.')
      return
    }

    try {
      await navigator.clipboard.writeText(content)
      toast.success('Mensagem copiada.')
    } catch {
      toast.error('Falha ao copiar a mensagem.')
    }
  }, [])

  const forwardMessageToComposer = useCallback((message: any) => {
    const visibleText = resolveMessageBodyText(message)
    const mediaLabel = resolveSemanticLabel(message?.mediaType || message?.type)
    const payload = visibleText || mediaLabel || String(message?.media?.fileName || '').trim() || 'Mensagem'
    setReplyTarget(null)
    setMessageInput((current) => {
      const prefix = `[Encaminhada]\n${payload}`
      if (!String(current || '').trim()) return prefix
      return `${current.trim()}\n\n${prefix}`
    })
    messageInputRef.current?.focus()
    toast.success('Conteúdo preparado para encaminhamento.')
  }, [])

  const removeMessageFromView = useCallback(async (messageId: string) => {
    const normalizedId = String(messageId || '').trim()
    if (!normalizedId) return
    const channel =
      Number(selectedConversation?.channel) ||
      orchestratorStatus?.instances?.find((instance) => instance.status === 'connected')?.channel
    const remoteJid = normalizeWhatsAppJid(
      selectedConversation?.conversationId ||
      selectedConversation?.rawJid ||
      selectedConversation?.normalizedJid ||
      selectedConversation?.phone ||
      ''
    )
    const previousMessages = messages
    setMessages((prev) => prev.filter((item) => String(item?.id || '') !== normalizedId))
    setSelectedMessageIds((prev) => prev.filter((item) => item !== normalizedId))
    setReplyTarget((current) => current?.id === normalizedId ? null : current)
    try {
      if (channel && remoteJid) {
        const response = await fetch(
          `/api/wa-orchestrator/channels/${channel}/conversations/${encodeURIComponent(remoteJid)}/messages/${encodeURIComponent(normalizedId)}`,
          {
            method: 'DELETE',
            headers: buildCrmBasicAuthHeaders()
          }
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload?.success === false) {
          throw new Error(payload?.error || 'Falha ao remover a mensagem.')
        }
      }
      toast.success('Mensagem removida da conversa atual.')
    } catch (error: any) {
      setMessages(previousMessages)
      toast.error(error?.message || 'Falha ao remover a mensagem.')
    }
  }, [messages, orchestratorStatus, selectedConversation])

  const computeMessageActionMenuLayout = useCallback((anchorKey: string) => {
    const normalizedKey = String(anchorKey || '').trim()
    const viewport = messagesViewportRef.current
    const anchor = messageActionRootRefs.current.get(normalizedKey) || null
    if (!normalizedKey || !viewport || !anchor) return null

    const viewportRect = viewport.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const horizontalPadding = 12
    const verticalPadding = 12
    const gutter = 8
    const measuredWidth = Math.max(messageActionMenuRef.current?.offsetWidth || 260, 240)
    const measuredHeight = Math.max(messageActionMenuRef.current?.offsetHeight || 360, 220)
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
    const availableWidth = Math.max(220, viewportRect.width - horizontalPadding * 2)
    const width = Math.min(measuredWidth, availableWidth)
    const availableHeight = Math.max(180, viewportRect.height - verticalPadding * 2)
    const spaceBelow = viewportRect.bottom - anchorRect.bottom - gutter - verticalPadding
    const spaceAbove = anchorRect.top - viewportRect.top - gutter - verticalPadding
    const openDown = spaceBelow >= measuredHeight || spaceBelow >= spaceAbove
    const sideAvailableHeight = openDown ? spaceBelow : spaceAbove
    const maxHeight = Math.min(measuredHeight, availableHeight, Math.max(sideAvailableHeight, 140))

    const topPreferred = openDown
      ? anchorRect.bottom + gutter
      : anchorRect.top - maxHeight - gutter
    const top = clamp(
      topPreferred,
      viewportRect.top + verticalPadding,
      viewportRect.bottom - maxHeight - verticalPadding
    )

    const spaceRight = viewportRect.right - anchorRect.left - horizontalPadding
    const spaceLeft = anchorRect.right - viewportRect.left - horizontalPadding
    const openToRight = spaceRight >= width || spaceRight >= spaceLeft
    const leftPreferred = openToRight ? anchorRect.left : anchorRect.right - width
    const left = clamp(
      leftPreferred,
      viewportRect.left + horizontalPadding,
      viewportRect.right - width - horizontalPadding
    )

    return {
      anchorKey: normalizedKey,
      top,
      left,
      maxHeight: Math.max(180, Math.floor(maxHeight)),
      width: Math.max(220, Math.floor(width))
    }
  }, [])

  const syncMessageActionMenuLayout = useCallback((anchorKey: string) => {
    const normalizedKey = String(anchorKey || '').trim()
    if (!normalizedKey) return
    const nextLayout = computeMessageActionMenuLayout(normalizedKey)
    setMessageActionMenuLayout((current) => {
      if (!nextLayout) return current
      if (
        current?.anchorKey === nextLayout.anchorKey &&
        current.top === nextLayout.top &&
        current.left === nextLayout.left &&
        current.maxHeight === nextLayout.maxHeight &&
        current.width === nextLayout.width
      ) {
        return current
      }
      return nextLayout
    })
  }, [computeMessageActionMenuLayout])

  const scheduleMessageActionMenuLayout = useCallback((anchorKey: string) => {
    const normalizedKey = String(anchorKey || '').trim()
    if (!normalizedKey) return
    if (messageActionMenuLayoutRafRef.current !== null) {
      window.cancelAnimationFrame(messageActionMenuLayoutRafRef.current)
    }
    messageActionMenuLayoutRafRef.current = window.requestAnimationFrame(() => {
      messageActionMenuLayoutRafRef.current = null
      syncMessageActionMenuLayout(normalizedKey)
    })
  }, [syncMessageActionMenuLayout])

  const closeMessageActionMenu = useCallback(() => {
    if (messageActionMenuLayoutRafRef.current !== null) {
      window.cancelAnimationFrame(messageActionMenuLayoutRafRef.current)
      messageActionMenuLayoutRafRef.current = null
    }
    setOpenMessageActionMenuId(null)
    setExpandedReactionMenuId(null)
    setMessageActionMenuLayout(null)
  }, [])

  const toggleMessageActionMenu = useCallback((anchorKey: string) => {
    const normalizedKey = String(anchorKey || '').trim()
    if (!normalizedKey) return
    setOpenMessageActionMenuId((current) => {
      const nextOpen = current === normalizedKey ? null : normalizedKey
      setExpandedReactionMenuId((currentExpanded) => (
        nextOpen && currentExpanded === normalizedKey ? currentExpanded : null
      ))
      setMessageActionMenuLayout(nextOpen ? computeMessageActionMenuLayout(normalizedKey) : null)
      return nextOpen
    })
  }, [computeMessageActionMenuLayout])

  const openMessageActionMenu = useCallback((anchorKey: string) => {
    const normalizedKey = String(anchorKey || '').trim()
    if (!normalizedKey) return
    setReactionPickerMessageId(null)
    setOpenMessageActionMenuId(normalizedKey)
    setExpandedReactionMenuId(null)
    setMessageActionMenuLayout(computeMessageActionMenuLayout(normalizedKey))
  }, [computeMessageActionMenuLayout])

  const toggleReaction = useCallback(async (message: any, emoji: string) => {
    if (!selectedConversation || selectedConversation?.platform === 'lead' || selectedConversation?.platform === 'instagram') return
    const channel =
      Number(selectedConversation?.channel) ||
      orchestratorStatus?.instances?.find((instance) => instance.status === 'connected')?.channel
    const remoteJid = normalizeWhatsAppJid(
      selectedConversation?.conversationId ||
      selectedConversation?.rawJid ||
      selectedConversation?.normalizedJid ||
      selectedConversation?.phone ||
      ''
    )
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

  useEffect(() => {
    if (selectedMessageIds.length > 0) return
    setMessageSelectionMode(false)
  }, [selectedMessageIds.length])

  useEffect(() => {
    if (!openMessageActionMenuId) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (!target) return
      if (messageActionMenuRef.current?.contains(target)) return
      const root = (target instanceof Element ? target.closest('[data-message-action-root]') : null) as HTMLElement | null
      if (root?.dataset.messageActionRoot === openMessageActionMenuId) return
      setOpenMessageActionMenuId(null)
      setExpandedReactionMenuId(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpenMessageActionMenuId(null)
      setExpandedReactionMenuId(null)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMessageActionMenuId])

  useLayoutEffect(() => {
    if (!openMessageActionMenuId) return

    const updateLayout = () => {
      scheduleMessageActionMenuLayout(openMessageActionMenuId)
    }

    updateLayout()
    const viewport = messagesViewportRef.current
    const anchor = messageActionRootRefs.current.get(openMessageActionMenuId) || null
    const handleViewportChange = () => {
      updateLayout()
    }

    viewport?.addEventListener('scroll', handleViewportChange, { passive: true })
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateLayout()
      })
      if (viewport) resizeObserver.observe(viewport)
      if (anchor) resizeObserver.observe(anchor)
    }

    return () => {
      if (messageActionMenuLayoutRafRef.current !== null) {
        window.cancelAnimationFrame(messageActionMenuLayoutRafRef.current)
        messageActionMenuLayoutRafRef.current = null
      }
      viewport?.removeEventListener('scroll', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
      resizeObserver?.disconnect()
    }
  }, [expandedReactionMenuId, openMessageActionMenuId, scheduleMessageActionMenuLayout])

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
        const directChannels = Array.isArray(selectedConversation?.channels)
          ? selectedConversation.channels.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
          : []
        const primaryConversationChannel = directChannels.length
          ? directChannels[0]
          : Number(selectedConversation?.channel || 0)
        const channel =
          Number(sendUnitChannel || primaryConversationChannel || selectedConversation?.channel) ||
          orchestratorStatus?.instances?.find((instance) => instance.status === 'connected')?.channel
        if (!channel) {
          toast.error('Nenhum canal WhatsApp conectado para envio.')
          return
        }
        const phoneKey = extractPhoneFromId(selectedConversation?.phone || selectedConversation?.leadPhone || '')
        const remoteJid = isLeadOnly
          ? (phoneKey ? `${phoneKey}@s.whatsapp.net` : '')
          : normalizeWhatsAppJid(
              selectedConversation.conversationId ||
              selectedConversation.rawJid ||
              selectedConversation.normalizedJid ||
              selectedConversation.phone ||
              ''
            )
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
  }, [igAccessToken, instagram.businessAccountId, loadMessages, messageInput, provider, selectedConversation, orchestratorStatus, replyTarget, sendUnitChannel])

  const scrollMessagesToBottom = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [])

  const scrollMessagesToTop = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    viewport.scrollTop = 0
  }, [])

  const updateMessageScrollState = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    const canScrollUp = viewport.scrollTop > 12
    const canScrollDown = (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) > 12
    setMessageScrollState({ canScrollUp, canScrollDown })
  }, [])

  const handleMessagesViewportMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const nearRightEdge = x >= rect.width - 112
    if (!nearRightEdge) {
      setScrollAffordanceZone(null)
      return
    }
    if (y <= 108) {
      setScrollAffordanceZone('top')
      return
    }
    if (y >= rect.height - 116) {
      setScrollAffordanceZone('bottom')
      return
    }
    setScrollAffordanceZone(null)
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
        const remoteJid = String(payload.remoteJid || '')
        const selectedJid = String(selectedConversation?.conversationId || selectedConversation?.rawJid || selectedConversation?.phone || '')
        if (
          payload.messageId &&
          selectedConversation &&
          remoteJid &&
          doesWhatsAppIdentityMatch(selectedJid, remoteJid) &&
          Number(payload.channel) === Number(selectedConversation?.channel || payload.channel)
        ) {
          patchMessageById(String(payload.messageId), (item) => ({ ...item, reactions: payload.reactions || [] }))
        }
        return
      }

      if (payload.type === 'message_metadata_updated') {
        const remoteJid = String(payload.remoteJid || '')
        const selectedJid = String(selectedConversation?.conversationId || selectedConversation?.rawJid || selectedConversation?.phone || '')
        if (
          payload.messageId &&
          selectedConversation &&
          remoteJid &&
          doesWhatsAppIdentityMatch(selectedJid, remoteJid) &&
          Number(payload.channel) === Number(selectedConversation?.channel || payload.channel)
        ) {
          patchMessageById(String(payload.messageId), (item) => ({ ...item, replyTo: payload.replyTo || item.replyTo }))
        }
        return
      }

      const webhookEvent = String(payload.event || '').toLowerCase()
      const normalizedWebhookEvent = webhookEvent.replace(/_/g, '.')
      if (
        normalizedWebhookEvent === 'messages.upsert' ||
        normalizedWebhookEvent === 'messages.update' ||
        normalizedWebhookEvent === 'chats.update'
      ) {
        if (waConversationRefreshTimerRef.current) {
          window.clearTimeout(waConversationRefreshTimerRef.current)
        }
        waConversationRefreshTimerRef.current = window.setTimeout(() => {
          void loadConversations()
        }, 450)
        if (selectedConversation) {
          if (waEventsRefreshTimerRef.current) {
            window.clearTimeout(waEventsRefreshTimerRef.current)
          }
          waEventsRefreshTimerRef.current = window.setTimeout(() => {
            void loadMessages(selectedConversation, { silent: true })
          }, 350)
        }
      }
    }

    source.onerror = () => {
      source.close()
    }

    return () => {
      if (waConversationRefreshTimerRef.current) {
        window.clearTimeout(waConversationRefreshTimerRef.current)
        waConversationRefreshTimerRef.current = null
      }
      if (waEventsRefreshTimerRef.current) {
        window.clearTimeout(waEventsRefreshTimerRef.current)
        waEventsRefreshTimerRef.current = null
      }
      source.close()
    }
  }, [provider, selectedConversation, loadConversations, loadMessages, patchMessageById])

  useEffect(() => {
    qrDialogChannelRef.current = qrDialogChannel
  }, [qrDialogChannel])

  useEffect(() => {
    waInitialSyncChannelRef.current = waInitialSyncChannel
  }, [waInitialSyncChannel])

  useEffect(() => {
    orchestratorStatusRef.current = orchestratorStatus
  }, [orchestratorStatus])

  const stopQrPolling = useCallback((channel?: number | null) => {
    if (typeof channel === 'number' && Number.isFinite(channel)) {
      const timer = qrPollingRef.current.get(channel)
      if (timer) {
        window.clearTimeout(timer)
        qrPollingRef.current.delete(channel)
      }
      return
    }
    qrPollingRef.current.forEach((timer) => {
      window.clearTimeout(timer)
    })
    qrPollingRef.current.clear()
  }, [])

  useEffect(() => {
    if (!qrDialogChannel || !orchestratorStatus?.instances?.length) return
    const instance = orchestratorStatus.instances.find((item) => item.channel === qrDialogChannel)
    if (instance?.status === 'connected') {
      stopQrPolling(qrDialogChannel)
      void runInitialWhatsAppSync(qrDialogChannel)
    }
  }, [orchestratorStatus, qrDialogChannel, runInitialWhatsAppSync, stopQrPolling])

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
    const channels = Array.isArray(selectedConversation?.channels)
      ? selectedConversation.channels.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
      : []
    const fallback = Number(selectedConversation?.channel || 0)
    const resolved = channels.length ? channels : (fallback > 0 ? [fallback] : [])

    if (resolved.length > 0) {
      const current = Number(sendUnitChannel || 0)
      if (current > 0 && resolved.includes(current)) return
      setSendUnitChannel(String(resolved[0]))
      return
    }
    const firstConnected = orchestratorStatus?.instances?.find((instance) => instance.status === 'connected')?.channel
    if (firstConnected) {
      setSendUnitChannel(String(firstConnected))
    }
  }, [selectedConversation?.channels, selectedConversation?.channel, orchestratorStatus?.instances, sendUnitChannel])

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
    updateMessageScrollState()
  }, [messages.length, harmoniaMessages.length, loadingMessages, harmoniaMessagesLoading, selectedConversation?.conversationId, updateMessageScrollState])

  useEffect(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    const handleScroll = () => updateMessageScrollState()
    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [updateMessageScrollState])

  useEffect(() => {
    if (!conversationFilter) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (!target) return
      if (conversationFiltersRef.current?.contains(target)) return
      setConversationFilter(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [conversationFilter])

  useEffect(() => {
    return () => {
      if (harmoniaActionTimerRef.current) window.clearTimeout(harmoniaActionTimerRef.current)
      stopQrPolling()
    }
  }, [stopQrPolling])

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

  const openConversation = useCallback(async (conv: any) => {
    setSelectedConversation(conv)
    setSelectedMessageIds([])
    setMessageSelectionMode(false)
    if (conv?.leadId) {
      void openHarmoniaConversationById(conv.leadId)
      return
    }
    if (conv?.platform === 'instagram') {
      setMessages(igDMs[conv.conversationId] || [])
      return
    }
    if (conv?.platform === 'lead') {
      setMessages([])
      return
    }
    setMessages([])
    try {
      const loaded = await loadMessages(conv)
      await markConversationAsRead(conv, loaded)
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao abrir conversa.')
    }
  }, [igDMs, loadMessages, markConversationAsRead, openHarmoniaConversationById])

  const isSameConversationRecord = useCallback((left: any, right: any) => {
    if (!left || !right) return false
    const leftPlatform = String(left?.platform || left?.type || '')
    const rightPlatform = String(right?.platform || right?.type || '')
    if (leftPlatform !== rightPlatform) return false

    const leftChannel = Number(left?.channel || 0)
    const rightChannel = Number(right?.channel || 0)
    if (leftChannel && rightChannel && leftChannel !== rightChannel) return false

    const leftId = String(left?.conversationId || left?.rawJid || left?.phone || left?.leadId || '')
    const rightId = String(right?.conversationId || right?.rawJid || right?.phone || right?.leadId || '')
    if (!leftId || !rightId) return false
    return leftPlatform === 'lead'
      ? leftId === rightId
      : leftId === rightId || doesWhatsAppIdentityMatch(leftId, rightId)
  }, [])

  const updateConversationRecord = useCallback((target: any, updater: (conv: any) => any) => {
    setConversations((prev) => prev.map((item) => (isSameConversationRecord(item, target) ? updater(item) : item)))
    setSelectedConversation((current) => (isSameConversationRecord(current, target) ? updater(current) : current))
  }, [isSameConversationRecord])

  const removeConversationRecord = useCallback((target: any) => {
    setConversations((prev) => prev.filter((item) => !isSameConversationRecord(item, target)))
    setSelectedConversation((current) => (isSameConversationRecord(current, target) ? null : current))
  }, [isSameConversationRecord])

  const syncConversationArchive = useCallback(async (conv: any, archive: boolean) => {
    if (provider !== 'evolution') return
    const remoteJid = String(conv?.conversationId || conv?.rawJid || conv?.normalizedJid || conv?.phone || '').trim()
    if (!remoteJid) {
      throw new Error('Conversa sem identificador para arquivamento.')
    }
    const channels = Array.isArray(conv?.channels)
      ? conv.channels.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
      : []
    const fallbackChannel = Number(conv?.channel || 0)
    const targetChannels = channels.length ? channels : (fallbackChannel > 0 ? [fallbackChannel] : [])
    if (!targetChannels.length) {
      throw new Error('Canal do WhatsApp não identificado para arquivamento.')
    }

    await Promise.all(targetChannels.map(async (channel) => {
      const response = await fetch(
        `/api/wa-orchestrator/channels/${channel}/conversations/${encodeURIComponent(remoteJid)}/archive`,
        {
          method: 'POST',
          headers: {
            ...buildCrmBasicAuthHeaders(),
            'content-type': 'application/json'
          },
          body: JSON.stringify({ archive })
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Falha ao ${archive ? 'arquivar' : 'desarquivar'} conversa no canal ${channel}.`)
      }
    }))
  }, [provider])

  const computeConversationActionMenuLayout = useCallback((conversationId: string) => {
    const normalizedId = String(conversationId || '').trim()
    const viewport = conversationScrollViewportRef.current
    const trigger = conversationActionTriggerRefs.current.get(normalizedId) || null
    if (!normalizedId || !viewport || !trigger) return null

    const viewportRect = viewport.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    const horizontalPadding = 12
    const verticalPadding = 12
    const gutter = 8
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
    const measuredWidth = Math.max(conversationActionMenuRef.current?.offsetWidth || 320, 280)
    const width = Math.min(measuredWidth, Math.max(280, viewportRect.width - horizontalPadding * 2))
    const availableBelow = viewportRect.bottom - triggerRect.bottom - gutter - verticalPadding
    const availableAbove = triggerRect.top - viewportRect.top - gutter - verticalPadding
    const estimatedHeight = Math.max(conversationActionMenuRef.current?.offsetHeight || 420, 260)
    const openDown = availableBelow >= estimatedHeight || availableBelow >= availableAbove
    const topPreferred = openDown ? triggerRect.bottom + gutter : triggerRect.top - estimatedHeight - gutter
    const top = clamp(
      topPreferred,
      viewportRect.top + verticalPadding,
      viewportRect.bottom - Math.min(estimatedHeight, viewportRect.height - verticalPadding * 2) - verticalPadding
    )
    const leftPreferred = triggerRect.right - width
    const left = clamp(
      leftPreferred,
      viewportRect.left + horizontalPadding,
      viewportRect.right - width - horizontalPadding
    )

    return {
      conversationId: normalizedId,
      top,
      left,
      width: Math.floor(width)
    }
  }, [])

  const closeConversationActionMenu = useCallback(() => {
    setOpenConversationActionMenuId(null)
    setConversationActionMenuLayout(null)
  }, [])

  useEffect(() => {
    if (!openConversationActionMenuId) return

    const viewport = conversationScrollViewportRef.current
    const syncLayout = () => {
      setConversationActionMenuLayout(computeConversationActionMenuLayout(openConversationActionMenuId))
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (!target) return
      const menu = conversationActionMenuRef.current
      const trigger = conversationActionTriggerRefs.current.get(openConversationActionMenuId) || null
      if (menu?.contains(target)) return
      if (trigger?.contains(target)) return
      closeConversationActionMenu()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeConversationActionMenu()
      }
    }

    syncLayout()
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    viewport?.addEventListener('scroll', syncLayout, { passive: true })
    window.addEventListener('resize', syncLayout)
    window.addEventListener('scroll', syncLayout, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      viewport?.removeEventListener('scroll', syncLayout)
      window.removeEventListener('resize', syncLayout)
      window.removeEventListener('scroll', syncLayout, true)
    }
  }, [closeConversationActionMenu, computeConversationActionMenuLayout, openConversationActionMenuId])

  const handleConversationListAction = useCallback((action: string, conv: any) => {
    const displayName = resolveConversationDisplayName(conv)

    if (action === 'mark-unread') {
      updateConversationRecord(conv, (current) => ({
        ...current,
        unreadCount: Math.max(1, Number(current?.unreadCount ?? current?.unreadMessages ?? current?.unread_messages ?? 0) || 0),
        unreadMessages: Math.max(1, Number(current?.unreadMessages ?? current?.unreadCount ?? current?.unread_messages ?? 0) || 0),
        unread_messages: Math.max(1, Number(current?.unread_messages ?? current?.unreadCount ?? current?.unreadMessages ?? 0) || 0)
      }))
      closeConversationActionMenu()
      toast.success('Conversa marcada como não lida.')
      return
    }

    if (action === 'archive') {
      const previousArchived = Boolean(conv?.archived || conv?.isArchived)
      const nextArchived = !previousArchived
      updateConversationRecord(conv, (current) => ({ ...current, archived: nextArchived, isArchived: nextArchived }))
      closeConversationActionMenu()
      void (async () => {
        try {
          await syncConversationArchive(conv, nextArchived)
          await loadConversations()
          toast.success(nextArchived ? 'Conversa arquivada.' : 'Conversa desarquivada.')
        } catch (error: any) {
          const reason = String(error?.message || '').trim()
          if (reason) {
            toast.error(`Arquivamento local aplicado, mas sem sincronização com WhatsApp: ${reason}`)
          } else {
            toast.error('Arquivamento local aplicado, mas sem sincronização com WhatsApp.')
          }
        }
      })()
      return
    }

    if (action === 'mute') {
      updateConversationRecord(conv, (current) => ({ ...current, muted: !(current?.muted || current?.isMuted) }))
      closeConversationActionMenu()
      toast.success('Status de silenciamento atualizado.')
      return
    }

    if (action === 'lock') {
      updateConversationRecord(conv, (current) => ({ ...current, locked: !(current?.locked || current?.isLocked) }))
      closeConversationActionMenu()
      toast.success('Status de bloqueio visual atualizado.')
      return
    }

    if (action === 'favorite') {
      updateConversationRecord(conv, (current) => ({
        ...current,
        isFavorite: !(current?.isFavorite || current?.favorite || current?.starred),
        favorite: !(current?.isFavorite || current?.favorite || current?.starred),
        starred: !(current?.isFavorite || current?.favorite || current?.starred)
      }))
      closeConversationActionMenu()
      toast.success('Favorito atualizado.')
      return
    }

    if (action === 'list') {
      updateConversationRecord(conv, (current) => {
        const currentLabels = Array.isArray(current?.labels)
          ? current.labels
          : Array.isArray(current?.tags)
            ? current.tags
            : Array.isArray(current?.etiquetas)
              ? current.etiquetas
              : []
        const hasList = currentLabels.some((label: any) => String(label).toLowerCase() === 'lista')
        const nextLabels = hasList
          ? currentLabels.filter((label: any) => String(label).toLowerCase() !== 'lista')
          : [...currentLabels, 'Lista']
        return { ...current, labels: nextLabels, tags: nextLabels, etiquetas: nextLabels }
      })
      closeConversationActionMenu()
      toast.success('Lista da conversa atualizada.')
      return
    }

    if (action === 'block') {
      updateConversationRecord(conv, (current) => ({ ...current, blocked: !current?.blocked }))
      closeConversationActionMenu()
      toast.success(`Status de bloqueio de ${displayName} atualizado.`)
      return
    }

    if (action === 'clear') {
      updateConversationRecord(conv, (current) => ({
        ...current,
        lastMessage: '',
        lastMessageText: '',
        last_message_text: '',
        lastActivity: current?.lastActivity || current?.updatedAt || new Date().toISOString()
      }))
      if (isSameConversationRecord(selectedConversation, conv)) {
        setMessages([])
        setHarmoniaMessages([])
        setHarmoniaConversation(null)
        setIgDMs((prev) => {
          const key = String(conv?.conversationId || '')
          if (!key || !(key in prev)) return prev
          return { ...prev, [key]: [] }
        })
      }
      closeConversationActionMenu()
      toast.success('Mensagens visíveis da conversa foram limpas.')
      return
    }

    if (action === 'delete') {
      const isCurrent = isSameConversationRecord(selectedConversation, conv)
      removeConversationRecord(conv)
      if (isCurrent) {
        setMessages([])
        setHarmoniaMessages([])
        setHarmoniaConversation(null)
        setReplyTarget(null)
        setOpenMessageActionMenuId(null)
        setExpandedReactionMenuId(null)
        setSelectedMessageIds([])
        setMessageSelectionMode(false)
      }
      closeConversationActionMenu()
      toast.success('Conversa removida da lista.')
    }
  }, [closeConversationActionMenu, isSameConversationRecord, loadConversations, removeConversationRecord, selectedConversation, syncConversationArchive, updateConversationRecord])

  const renderConversationListMenuItems = useCallback((conv: any) => {
    const displayName = resolveConversationDisplayName(conv)
    const iconClassName = "h-5 w-5 shrink-0 text-white/80"
    const itemClassName = "flex items-center justify-between gap-6 rounded-2xl px-5 py-4 text-left text-[15px] font-medium text-white/95 transition-colors hover:bg-white/10"

    return (
      <>
        <button type="button" className={itemClassName} onClick={() => handleConversationListAction('mark-unread', conv)}>
          <span>Marcar como não lida</span>
          <EnvelopeSimpleOpen className={iconClassName} />
        </button>
        <div className="mx-1 h-px bg-white/10" />
        <button type="button" className={itemClassName} onClick={() => handleConversationListAction('archive', conv)}>
          <span>Arquivar</span>
          <Archive className={iconClassName} />
        </button>
        <div className="mx-1 h-px bg-white/10" />
        <button type="button" className={itemClassName} onClick={() => handleConversationListAction('mute', conv)}>
          <span>Silenciar</span>
          <BellSimpleSlash className={iconClassName} />
        </button>
        <div className="mx-1 h-px bg-white/10" />
        <button type="button" className={itemClassName} onClick={() => handleConversationListAction('lock', conv)}>
          <span>Trancar conversa</span>
          <LockSimple className={iconClassName} />
        </button>
        <div className="mx-1 h-px bg-white/10" />
        <button type="button" className={itemClassName} onClick={() => handleConversationListAction('favorite', conv)}>
          <span>Adicionar aos favoritos</span>
          <HeartStraight className={iconClassName} />
        </button>
        <div className="mx-1 h-px bg-white/10" />
        <button type="button" className={itemClassName} onClick={() => handleConversationListAction('list', conv)}>
          <span>Adicionar à lista</span>
          <UserList className={iconClassName} />
        </button>
        <div className="mx-1 h-px bg-white/10" />
        <button type="button" className={itemClassName} onClick={() => handleConversationListAction('block', conv)}>
          <span className="max-w-[240px] whitespace-normal">Bloquear {displayName}</span>
          <Prohibit className={iconClassName} />
        </button>
        <div className="mx-1 h-px bg-white/10" />
        <button type="button" className={itemClassName} onClick={() => handleConversationListAction('clear', conv)}>
          <span>Limpar conversa</span>
          <Broom className={iconClassName} />
        </button>
        <div className="mx-1 h-px bg-white/10" />
        <button type="button" className="flex items-center justify-between gap-6 rounded-2xl px-5 py-4 text-left text-[15px] font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300" onClick={() => handleConversationListAction('delete', conv)}>
          <span>Apagar conversa</span>
          <TrashSimple className="h-5 w-5 shrink-0 text-red-400" />
        </button>
      </>
    )
  }, [handleConversationListAction])

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
    if (qrPollingInFlightRef.current.has(channel)) return
    stopQrPolling(channel)
    const lastSuccessAt = qrLastSuccessAtRef.current.get(channel) || 0
    const refreshDelayMs = Math.max(0, 15000 - (Date.now() - lastSuccessAt))
    if (refreshDelayMs > 0) {
      const timer = setTimeout(() => {
        void pollChannelQR(channel)
      }, refreshDelayMs)
      qrPollingRef.current.set(channel, timer)
      return
    }
    qrPollingInFlightRef.current.add(channel)
    const queueNextPoll = (delayMs = 3000) => {
      if (qrDialogChannelRef.current !== channel) {
        stopQrPolling(channel)
        return
      }
      const timer = setTimeout(() => {
        void pollChannelQR(channel)
      }, delayMs)
      qrPollingRef.current.set(channel, timer)
    }

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
        if (response.status === 404 || response.status === 409 || response.status === 425) {
          queueNextPoll(1500)
          return
        }
        console.warn('[WA_QR_DEBUG] pollChannelQR:non_ok', { channel, status: response.status })
        setQrConnectionPhase('error')
        setQrConnectionError(`Não foi possível obter o QR Code (HTTP ${response.status}).`)
        stopQrPolling(channel)
        return
      }

      const result = await response.json().catch(() => ({}))
      if (!result?.success || (!result?.qr && !result?.dataUrl)) {
        setQrConnectionPhase('waiting')
        queueNextPoll(2500)
        return
      }

      let qrDataUrl: string | undefined
      setQrConnectionPhase('rendering')
      if (result.dataUrl) {
        qrDataUrl = result.dataUrl
      } else if (result.qr) {
        qrDataUrl = (await resolveQrDataUrl(result.qr)) ?? undefined
      }

      if (qrDataUrl) {
        qrLastSuccessAtRef.current.set(channel, Date.now())
        setChannelQR(prev => new Map(prev.set(channel, { qr: result.qr || qrDataUrl, dataUrl: qrDataUrl })))
        setQrConnectionPhase('ready')
      }

      const status = String(result?.status || '').toLowerCase()
      if (status === 'connected') {
        stopQrPolling(channel)
        void runInitialWhatsAppSync(channel)
        return
      }
      queueNextPoll(15000)
    } catch (err: any) {
      console.warn('[WA_QR_DEBUG] pollChannelQR:error', { channel, error: err?.message || String(err) })
      setQrConnectionPhase('error')
      setQrConnectionError('Não foi possível alcançar o orquestrador para obter o QR Code.')
      stopQrPolling(channel)
    } finally {
      qrPollingInFlightRef.current.delete(channel)
    }
  }, [QR_DARK, QR_LIGHT, runInitialWhatsAppSync, stopQrPolling])

  useEffect(() => {
    if (!qrDialogChannel || !['waiting', 'ready'].includes(qrConnectionPhase)) return
    if (qrConnectionPhase === 'ready') {
      const timer = setTimeout(() => {
        void pollChannelQR(qrDialogChannel)
      }, 15000)
      qrPollingRef.current.set(qrDialogChannel, timer)
    } else {
      void pollChannelQR(qrDialogChannel)
    }
    return () => {
      stopQrPolling(qrDialogChannel)
    }
  }, [qrDialogChannel, qrConnectionPhase, pollChannelQR, stopQrPolling])

  const startChannel = useCallback(async (channel: number) => {
    try {
      setQrConnectionError(null)
      setQrConnectionPhase('starting')
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/start`, {
        method: 'POST',
        headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({})
      })
      const result = await response.json().catch(() => ({}))
      if (!result?.success) throw new Error(result?.error || 'Falha ao iniciar canal')
      if (result?.qr) {
        setQrConnectionPhase('rendering')
        const normalizedQr = String(result.qr).trim().replace(/\\\//g, '/')
        const qrDataUrl = normalizedQr.startsWith('data:image')
          ? normalizedQr
          : (/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedQr) && normalizedQr.length > 120)
            ? `data:image/${normalizedQr.startsWith('/9j/') ? 'jpeg' : 'png'};base64,${normalizedQr}`
            : await QRCode.toDataURL(normalizedQr, { width: 300, margin: 2, color: { dark: QR_DARK, light: QR_LIGHT } })
        qrLastSuccessAtRef.current.set(channel, Date.now())
        setChannelQR(prev => new Map(prev.set(channel, { qr: result.qr || qrDataUrl, dataUrl: qrDataUrl })))
        setQrConnectionPhase('ready')
      } else {
        setQrConnectionPhase('waiting')
      }
      toast.success(`Canal ${channel} iniciado`)
      return true
    } catch (err: any) {
      const message = err?.message || 'Falha ao iniciar canal'
      console.error('[WA_QR_DEBUG] startChannel:error', { channel, error: message })
      setQrConnectionPhase('error')
      setQrConnectionError(message)
      toast.error(message)
      return false
    }
  }, [QR_DARK, QR_LIGHT, pollChannelQR])

  const resolveNextWhatsAppChannel = useCallback(() => {
    const instances = orchestratorStatus?.instances ?? []
    const sorted = [...instances].sort((a, b) => a.channel - b.channel)

    const activeDialogChannel = qrDialogChannelRef.current
    if (activeDialogChannel) {
      const activePending = sorted.find(
        (instance) =>
          instance.channel === activeDialogChannel &&
          (instance.status === 'qr_pending' || instance.status === 'starting')
      )
      if (activePending) {
        return { channel: activePending.channel, action: 'poll' as const }
      }
    }

    const cachedQrChannel = [...channelQR.keys()]
      .sort((a, b) => a - b)
      .find((channel) => {
        const instance = sorted.find((item) => item.channel === channel)
        return Boolean(
          channelQR.get(channel)?.dataUrl &&
          instance &&
          instance.status !== 'connected' &&
          !instance.metadata?.phoneNumber &&
          !instance.metadata?.ownerJid
        )
      })
    if (cachedQrChannel) {
      return { channel: cachedQrChannel, action: 'poll' as const }
    }

    // Reuse any channel whose QR flow is already active before provisioning a
    // new slot. After a page reload qrDialogChannelRef is empty, but the
    // orchestrator still knows which instance is waiting for pairing.
    const pending = sorted.find((instance) => instance.status === 'qr_pending' || instance.status === 'starting')
    if (pending) {
      return { channel: pending.channel, action: 'poll' as const }
    }

    // A disconnected Evolution instance may be reported as `free` even though
    // it has already been created. Prefer that unpaired instance over a pristine
    // slot so repeated clicks/reloads do not open crm-channel-2, -3, ... while
    // the first QR flow is still awaiting an account.
    const reusableUnpaired = sorted.find(
      (instance) =>
        instance.status === 'free' &&
        !instance.metadata?.phoneNumber &&
        !instance.metadata?.ownerJid &&
        Boolean(
          instance.createdAt ||
          instance.updatedAt ||
          (instance.name && !/^WhatsApp Channel \d+$/i.test(instance.name))
        )
    )
    if (reusableUnpaired) {
      return { channel: reusableUnpaired.channel, action: 'start' as const }
    }

    const free = sorted.find(
      (instance) =>
        instance.status === 'free' &&
        !instance.metadata?.phoneNumber &&
        !instance.metadata?.ownerJid &&
        !instance.createdAt &&
        !instance.updatedAt
    ) || sorted.find((instance) => instance.status === 'free')
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
  }, [channelQR, orchestratorStatus])

  const connectWhatsApp = useCallback(async () => {
    if (orchestratorIssue) {
      toast.error(orchestratorIssue.message)
      await loadStatus()
      return
    }
    const next = resolveNextWhatsAppChannel()
    if (!next?.channel) {
      toast.error('Nenhum canal livre disponível. Atualize o status ou verifique o provisionamento do orquestrador.')
      return
    }

    if (next.action === 'poll') {
      setQrDialogChannel(next.channel)
      setQrConnectionPhase('waiting')
      return
    }

    setQrDialogChannel(next.channel)
    setQrConnectionPhase('starting')
    void startChannel(next.channel)
  }, [loadStatus, orchestratorIssue, resolveNextWhatsAppChannel, startChannel])

  const markConnectedChannelAction = useCallback((channel: number, action?: 'refresh' | 'disconnect') => {
    setConnectedChannelAction((prev) => {
      const next = { ...prev }
      if (!action) {
        delete next[channel]
      } else {
        next[channel] = action
      }
      return next
    })
  }, [])

  const refreshConnectedChannel = useCallback(async (channel: number, opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
    markConnectedChannelAction(channel, 'refresh')
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/restart`, {
        method: 'POST',
        headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({})
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result?.success) {
        throw new Error(String(result?.error || `Falha ao refrescar canal ${channel}`))
      }

      let channelStatus = ''
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const stateResponse = await fetch(`/api/wa-orchestrator/channels/${channel}`, {
          headers: buildCrmBasicAuthHeaders()
        })
        const stateData = await stateResponse.json().catch(() => ({}))
        channelStatus = String(stateData?.status || stateData?.instance?.status || '').trim().toLowerCase()
        if (channelStatus && !['starting', 'qr_pending'].includes(channelStatus)) break
        await sleep(1200)
      }

      let bootstrapQueued = false
      if (provider === 'evolution') {
        const syncResponse = await fetch(`/api/wa-orchestrator/channels/${channel}/bootstrap-sync`, {
          method: 'POST',
          headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            force: true,
            reason: 'manual-refresh'
          })
        })
        const syncData = await syncResponse.json().catch(() => ({}))
        bootstrapQueued = Boolean(syncResponse.ok && syncData?.success)
      }

      if (qrDialogChannelRef.current === channel) {
        void pollChannelQR(channel)
      }

      await loadStatus()
      await loadConversations({ disableCache: true })

      const selectedIsWhatsapp = selectedConversation?.platform === 'whatsapp'
      const selectedChannels = Array.isArray(selectedConversation?.channels)
        ? selectedConversation.channels
        : [selectedConversation?.channel]
      const selectedHasChannel = selectedChannels
        .map((value: any) => Number(value))
        .filter((value: number) => Number.isFinite(value) && value > 0)
        .includes(channel)
      if (selectedIsWhatsapp && selectedHasChannel && selectedConversation?.conversationId) {
        await loadMessages(selectedConversation, { silent: true })
      }

      if (!silent) {
        const syncSuffix = bootstrapQueued ? ' • sync forçado' : ''
        toast.success(`Canal ${channel} refrescado${syncSuffix}.`)
      }
      return true
    } catch (error: any) {
      await loadStatus()
      await loadConversations({ disableCache: true })
      if (!silent) {
        toast.error(String(error?.message || `Falha ao refrescar canal ${channel}`))
      }
      return false
    } finally {
      markConnectedChannelAction(channel)
    }
  }, [loadConversations, loadMessages, loadStatus, markConnectedChannelAction, pollChannelQR, provider, selectedConversation])

  const refreshAllConnectedChannels = useCallback(async () => {
    const channels = (orchestratorStatus?.instances || [])
      .filter((instance) => instance.status === 'connected')
      .map((instance) => Number(instance.channel))
      .filter((channel) => Number.isFinite(channel) && channel > 0)
      .sort((a, b) => a - b)
    if (!channels.length) {
      toast.error('Nenhum canal conectado para refrescar.')
      return
    }

    setRefreshAllChannelsLoading(true)
    try {
      const failed: number[] = []
      for (const channel of channels) {
        const ok = await refreshConnectedChannel(channel, { silent: true })
        if (!ok) failed.push(channel)
      }
      if (failed.length) {
        toast.error(`Falha ao refrescar canal(is): ${failed.join(', ')}`)
        return
      }
      toast.success(`Refrescados ${channels.length} canal(is) com recarga completa.`)
    } finally {
      setRefreshAllChannelsLoading(false)
    }
  }, [orchestratorStatus?.instances, refreshConnectedChannel])

  const disconnectConnectedChannel = useCallback(async (channel: number) => {
    markConnectedChannelAction(channel, 'disconnect')
    try {
      const response = await fetch(`/api/wa-orchestrator/channels/${channel}/stop`, {
        method: 'POST',
        headers: buildCrmBasicAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({})
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result?.success) {
        throw new Error(String(result?.error || `Falha ao desconectar canal ${channel}`))
      }

      setOrchestratorStatus((prev) => {
        if (!prev) return prev
        const nextInstances = (prev.instances || []).map((instance) => (
          Number(instance?.channel) === channel
            ? {
                ...instance,
                status: 'free' as const,
                metadata: {
                  ...(instance?.metadata || {}),
                  errorMessage: undefined
                }
              }
            : instance
        ))
        const freeChannelsList = nextInstances
          .filter((instance) => instance.status === 'free')
          .map((instance) => instance.channel)
        const connectedInstances = nextInstances.filter((instance) => instance.status === 'connected').length
        const errorInstances = nextInstances.filter((instance) => instance.status === 'error').length
        const startingInstances = nextInstances.filter((instance) => instance.status === 'starting' || instance.status === 'qr_pending').length
        return {
          ...prev,
          instances: nextInstances,
          availableChannels: freeChannelsList.length,
          freeInstances: freeChannelsList.length,
          connectedInstances,
          errorInstances,
          startingInstances,
          availableChannelsList: nextInstances.map((instance) => instance.channel),
          freeChannelsList
        }
      })

      setConversations((prev) =>
        (prev || []).filter((item) => Number(item?.channel || 0) !== channel)
      )

      stopQrPolling(channel)
      setChannelQR((prev) => {
        const next = new Map(prev)
        next.delete(channel)
        return next
      })
      qrLastSuccessAtRef.current.delete(channel)
      if (qrDialogChannelRef.current === channel) {
        setQrDialogChannel(null)
      }

      if (selectedConversation?.platform === 'whatsapp') {
        const selectedChannels = Array.isArray(selectedConversation?.channels)
          ? selectedConversation.channels
          : [selectedConversation?.channel]
        const selectedChannelNumbers = selectedChannels
          .map((value: any) => Number(value))
          .filter((value: number) => Number.isFinite(value) && value > 0)
        if (selectedChannelNumbers.includes(channel)) {
          const remainingChannels = selectedChannelNumbers.filter((value) => value !== channel)
          if (!remainingChannels.length) {
            setSelectedConversation(null)
            setMessages([])
          } else {
            setSelectedConversation((current) => current ? ({
              ...current,
              channel: remainingChannels[0],
              channels: remainingChannels
            }) : current)
          }
        }
      }

      toast.success(`Canal ${channel} desconectado.`)
      await loadStatus()
      await loadConversations({ disableCache: true })
    } catch (error: any) {
      toast.error(String(error?.message || `Falha ao desconectar canal ${channel}`))
    } finally {
      markConnectedChannelAction(channel)
    }
  }, [loadConversations, loadStatus, markConnectedChannelAction, selectedConversation, stopQrPolling])

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
  const selectedConversationChannels = useMemo(() => {
    const channelsFromConversation = Array.isArray(selectedConversation?.channels)
      ? selectedConversation.channels
      : []
    const fallback = Number(selectedConversation?.channel || 0)
    const merged = channelsFromConversation.length
      ? channelsFromConversation
      : (fallback > 0 ? [fallback] : [])
    return Array.from(new Set<number>(
      merged
        .map((value: any) => Number(value))
        .filter((value: number) => Number.isFinite(value) && value > 0)
    )).sort((a, b) => a - b)
  }, [selectedConversation?.channels, selectedConversation?.channel])
  const shouldShowSendUnitSelector = useMemo(
    () =>
      provider === 'evolution' &&
      selectedConversation?.platform !== 'instagram' &&
      selectedConversationChannels.length > 1,
    [provider, selectedConversation?.platform, selectedConversationChannels]
  )
  const sendUnitOptions = useMemo(
    () => {
      const allowed = new Set(selectedConversationChannels)
      const options = connectedWhatsapps
        .filter((instance) => (allowed.size ? allowed.has(instance.channel) : true))
        .map((instance) => ({
          value: String(instance.channel),
          label: `Unidade/Canal ${instance.channel}${instance.metadata?.phoneNumber ? ` • ${instance.metadata.phoneNumber}` : ''}`
        }))
      if (options.length) return options
      return selectedConversationChannels.map((channel) => ({
        value: String(channel),
        label: `Unidade/Canal ${channel}`
      }))
    },
    [connectedWhatsapps, selectedConversationChannels]
  )
  const selfIdentityAliasesByChannel = useMemo(() => {
    const map = new Map<number, Set<string>>()
    ;(orchestratorStatus?.instances || []).forEach((instance) => {
      const aliases = new Set<string>()
      ;[
        instance?.metadata?.phoneNumber,
        instance?.metadata?.ownerJid,
        instance?.metadata?.profileName,
        instance?.name
      ].forEach((value) => {
        if (!value) return
        buildWhatsAppIdentityAliases(String(value)).forEach((alias) => aliases.add(alias))
        buildMentionAliases(String(value)).forEach((alias) => aliases.add(alias))
        aliases.add(String(value).trim().toLowerCase())
      })
      if (aliases.size) {
        map.set(Number(instance.channel || 0), aliases)
      }
    })
    return map
  }, [orchestratorStatus?.instances])
  const isOutboundMessage = useCallback((message: any) => {
    const direction = String(message?.direction || '').toLowerCase()
    if (direction === 'outbound' || direction === 'human') return true
    if (message?.fromMe === true || message?.key?.fromMe === true) return true
    const senderName = String(message?.senderName || '').trim().toLowerCase()
    if (senderName === 'você' || senderName === 'voce') return true

    const channel = Number(selectedConversation?.channel || 0)
    const selfAliases = selfIdentityAliasesByChannel.get(channel)
    if (!selfAliases?.size) return false

    const candidates = [
      message?.senderJid,
      message?.senderLid,
      message?.senderPhone,
      message?.author,
      message?.participant,
      message?.participantAlt,
      senderName
    ]

    for (const candidate of candidates) {
      if (!candidate) continue
      const raw = String(candidate).trim()
      if (!raw) continue
      if (selfAliases.has(raw.toLowerCase())) return true
      const aliases = new Set<string>([
        ...buildWhatsAppIdentityAliases(raw),
        ...buildMentionAliases(raw),
        raw.toLowerCase()
      ])
      for (const alias of aliases) {
        if (selfAliases.has(alias)) return true
      }
    }

    return false
  }, [selectedConversation?.channel, selfIdentityAliasesByChannel])
  const conversationAvatarDirectory = useMemo(() => {
    const map = new Map<string, string>()
    ;(conversations || []).forEach((conv: any) => {
      const avatarUrl = String(resolveAvatarUrl(conv) || '').trim()
      if (!avatarUrl) return
      const aliases = new Set<string>()
      ;[
        conv?.conversationId,
        conv?.rawJid,
        conv?.normalizedJid,
        conv?.phone,
        ...(Array.isArray(conv?.aliases) ? conv.aliases : [])
      ].forEach((value) => {
        buildMentionAliases(value).forEach((alias) => aliases.add(alias))
      })
      aliases.forEach((alias) => map.set(alias, avatarUrl))
    })
    return map
  }, [conversations])
  const groupParticipantDirectory = useMemo(() => {
    const map = new Map<string, ParticipantRenderMeta>()
    messages.forEach((msg: any) => {
      const senderSeed = String(msg?.senderJid || msg?.senderLid || msg?.senderPhone || msg?.senderName || msg?.id || '')
      if (!senderSeed) return
      const style = resolveGroupSenderStyle(senderSeed)
      const senderLabel = String(
        msg?.senderName ||
        formatPhone(msg?.senderPhone || msg?.senderJid || msg?.senderLid || '') ||
        ''
      ).trim()
      if (!senderLabel || senderLabel.toLowerCase() === 'você') return
      const aliases = new Set<string>()
      ;[
        ...buildMentionAliases(msg?.senderJid),
        ...buildMentionAliases(msg?.senderLid),
        ...buildMentionAliases(msg?.senderPhone)
      ].forEach((alias) => aliases.add(alias))
      const avatarUrl = String(msg?.senderAvatarUrl || '').trim() || Array.from(aliases).map((alias) => conversationAvatarDirectory.get(alias)).find(Boolean) || undefined
      aliases.forEach((alias) => {
        map.set(alias, { label: senderLabel, color: style.mention, avatarUrl })
      })
    })
    return map
  }, [messages, conversationAvatarDirectory])
  const openPrivateConversationForMessage = useCallback(async (message: any, opts?: { prefill?: boolean }) => {
    const senderJid = normalizeWhatsAppJid(message?.senderJid || message?.senderLid || message?.senderPhone || '')
    if (!senderJid || senderJid.includes('@g.us')) {
      toast.error('Não foi possível identificar o remetente desta mensagem.')
      return
    }

    const aliases = new Set<string>()
    ;[
      message?.senderJid,
      message?.senderLid,
      message?.senderPhone,
      senderJid
    ].forEach((value) => {
      buildWhatsAppIdentityAliases(value).forEach((alias) => aliases.add(alias))
      buildMentionAliases(value).forEach((alias) => aliases.add(alias))
    })

    const existingConversation = (conversations || []).find((conv: any) => {
      const candidate = String(conv?.conversationId || conv?.rawJid || conv?.normalizedJid || conv?.phone || '').trim()
      if (!candidate || candidate.includes('@g.us')) return false
      for (const alias of aliases) {
        if (doesWhatsAppIdentityMatch(candidate, alias)) return true
      }
      return false
    })

    const senderName = String(
      message?.senderName ||
      formatPhone(message?.senderPhone || senderJid) ||
      'Contato'
    ).trim()
    const avatarUrl = String(
      message?.senderAvatarUrl ||
      Array.from(aliases).map((alias) => conversationAvatarDirectory.get(alias)).find(Boolean) ||
      ''
    ).trim()
    const fallbackConversation = {
      conversationId: senderJid,
      rawJid: senderJid,
      normalizedJid: senderJid,
      phone: extractPhoneFromId(senderJid),
      name: senderName,
      preferredName: senderName,
      profilePic: avatarUrl,
      channel: Number(selectedConversation?.channel || orchestratorStatus?.instances?.find((instance) => instance.status === 'connected')?.channel || 0)
    }

    const targetConversation = existingConversation || fallbackConversation
    if (!existingConversation) {
      setConversations((prev) => [
        targetConversation,
        ...prev.filter((item) => !doesWhatsAppIdentityMatch(item?.conversationId || item?.rawJid || item?.phone, senderJid))
      ])
    }

    await openConversation(targetConversation)
    if (opts?.prefill) {
      const firstName = senderName.split(/\s+/).filter(Boolean)[0] || senderName
      setMessageInput((current) => current || `Olá ${firstName}, `)
    }
    messageInputRef.current?.focus()
  }, [conversationAvatarDirectory, conversations, openConversation, orchestratorStatus?.instances, selectedConversation?.channel])
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
    window.addEventListener('skincos:conversa:header-action', handler as EventListener)
    return () => window.removeEventListener('skincos:conversa:header-action', handler as EventListener)
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
      conversationId: String(conv.conversationId || conv.rawJid || conv.id || conv.remoteJid || '').trim(),
      rawJid: String(conv.rawJid || conv.conversationId || conv.remoteJid || '').trim(),
      normalizedJid: normalizeWhatsAppJid(conv.normalizedJid || conv.conversationId || conv.rawJid || conv.id || conv.remoteJid),
      platform: conv.platform || (provider === 'evolution' ? 'whatsapp' : provider),
      name: conv.name && !isLikelyWhatsAppJid(conv.name) ? conv.name : undefined,
      preferredName: conv.preferredName || (conv.name && !isLikelyWhatsAppJid(conv.name) ? conv.name : undefined),
      phone: conv.phone || conv.contactPhone || conv.contact_phone || conv.contact_phone_raw,
      aliases: Array.isArray(conv.aliases) ? conv.aliases : [],
      archived: Boolean(conv?.archived || conv?.isArchived),
      isArchived: Boolean(conv?.archived || conv?.isArchived),
      channels: Number.isFinite(Number(conv.channel)) ? [Number(conv.channel)] : []
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
        lastInteractionAt: last?.timestamp || null,
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
        lastInteractionAt: it.last_message_at || it.last_activity_at || null,
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
      const phoneKey = extractPhoneFromId(item.phone || item.conversationId || item.rawJid || '')
      if (phoneKey.length < 10) {
        pushWithIndex(item, '')
        return
      }
      if (phoneKey && indexByPhone.has(phoneKey)) {
        const idx = indexByPhone.get(phoneKey)!
        const existing = merged[idx]
        const existingName = String(existing?.name || '')
        const incomingName = String(item?.name || '')
        const useIncomingName = incomingName && !isLikelyWhatsAppJid(incomingName)
        const useExistingName = existingName && !isLikelyWhatsAppJid(existingName)
        const mergedArchived = Boolean(existing?.archived || existing?.isArchived || item?.archived || item?.isArchived)
        merged[idx] = {
          ...existing,
          ...item,
          name: useIncomingName ? incomingName : (useExistingName ? existingName : incomingName || existingName),
          preferredName: useIncomingName ? incomingName : (existing.preferredName || incomingName || existingName),
          conversationId: item.conversationId || existing.conversationId,
          rawJid: item.rawJid || existing.rawJid,
          normalizedJid: item.normalizedJid || existing.normalizedJid,
          aliases: Array.from(new Set([...(existing.aliases || []), ...(item.aliases || [])])),
          channels: Array.from(new Set([...(existing.channels || []), ...(item.channels || [])])).filter((n) => Number.isFinite(Number(n))),
          archived: mergedArchived,
          isArchived: mergedArchived,
          leadId: existing.leadId,
          stage: existing.stage,
          leadUpdatedAt: existing.leadUpdatedAt,
          leadName: existing.leadName,
          leadPhone: existing.leadPhone,
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
        const currentTs = resolveConversationInteractionTimestamp(current)
        const leadTs = resolveConversationInteractionTimestamp(item)
        const currentName = String(current?.name || '')
        const leadName = String(item?.name || '')
        const preferredName =
          (currentName && !isLikelyWhatsAppJid(currentName) ? currentName : '') ||
          (leadName && !isLikelyWhatsAppJid(leadName) ? leadName : '') ||
          currentName ||
          leadName
        merged[idx] = {
          ...current,
          name: preferredName,
          preferredName,
          leadId: item.leadId,
          stage: item.stage,
          leadUpdatedAt: item.leadUpdatedAt || current.leadUpdatedAt,
          leadName: item.name,
          leadPhone: item.phone,
          lastInteractionAt: leadTs > currentTs ? item.lastInteractionAt || item.updatedAt : current.lastInteractionAt || current.updatedAt,
          updatedAt: leadTs > currentTs ? item.updatedAt : current.updatedAt,
        }
      } else {
        pushWithIndex(item, phoneKey)
      }
    })

    return merged.sort((a, b) => {
      const da = resolveConversationInteractionTimestamp(a)
      const db = resolveConversationInteractionTimestamp(b)
      return db - da
    })
  }, [conversations, igDMs, igProfiles, provider, harmoniaInbox])

  const filteredConversations = useMemo(() => {
    const term = searchQuery.trim().toLowerCase()
    const matchesFilter = (conv: any) => {
      if (!conversationFilter) return true
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
    const isInitialSyncActive = Number.isFinite(waInitialSyncChannel) && waInitialSyncChannel !== null
    const renderWhatsAppSyncNotice = (mode: 'inline' | 'panel' = 'inline') => (
      <div
        className={`rounded-xl border border-cyan-300/30 bg-cyan-500/10 ${
          mode === 'panel' ? 'px-4 py-5' : 'px-3 py-2.5'
        }`}
      >
        <div className={`inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-400/15 px-3 py-1.5 text-sm font-medium text-cyan-100`}>
          <CircleNotch className="h-4 w-4 animate-spin" />
          <span>Carregando</span>
        </div>
        <div className="mt-2 text-sm text-cyan-100/90">Suas conversas estão sendo carregadas.</div>
        <div className="mt-1 text-xs text-cyan-100/75">Mantenha o WhatsApp aberto nos dois dispositivos.</div>
      </div>
    )
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {paused ? (
          <div className="flex justify-end">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-1 text-xs text-amber-100">
              Atualização pausada
            </span>
          </div>
        ) : null}
        <div className="grid flex-1 min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-4 overflow-visible xl:grid-cols-12">
          <Card className="glass-card hover:translate-y-0 xl:col-span-4 flex h-full min-h-0 flex-col overflow-hidden">
                <CardContent className="flex min-h-0 flex-col gap-2 pt-4">
                  <div ref={conversationFiltersRef} data-testid="conversation-filters" className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 p-1.5">
                    {[
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
                        onClick={() => setConversationFilter((current) => current === item.id ? null : item.id as any)}
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
                      <div ref={conversationScrollViewportRef} data-testid="conversation-scroll" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-1 pr-1">
                        <div className="space-y-1.5 pb-2">
                      {(loadingConversations || harmoniaInboxLoading) && (
                        <div className="text-sm text-blue-100/60 py-4 text-center">Carregando conversas...</div>
                      )}
                      {isInitialSyncActive ? (
                        <div className="py-1">
                          {renderWhatsAppSyncNotice('inline')}
                        </div>
                      ) : null}
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
                        (() => {
                          const unreadCount = Number(conv.unreadCount || conv.unreadMessages || conv.unread_messages || 0)
                          const isSelected =
                            selectedConversation?.conversationId === conv.conversationId &&
                            selectedConversation?.channel === conv.channel
                          const previewMeta = resolveConversationPreviewMeta(conv)
                          const conversationKey = `${conv.conversationId}-${conv.channel ?? conv.platform ?? ''}`
                          return (
                            <div
                              key={conversationKey}
                              data-testid="conversation-item"
                              className={`box-border relative w-full min-w-0 rounded-xl border p-3 pr-12 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/10 ${
                                isSelected
                                  ? 'cursor-pointer border-blue-500/70 bg-blue-500/15'
                                  : unreadCount > 0
                                    ? 'cursor-pointer border-sky-300/35 bg-sky-400/10'
                                    : 'cursor-pointer border-white/10'
                              }`}
                              onClick={() => {
                                closeConversationActionMenu()
                                void openConversation(conv)
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                setOpenConversationActionMenuId(conversationKey)
                                setConversationActionMenuLayout(computeConversationActionMenuLayout(conversationKey))
                              }}
                            >
                                  <button
                                    type="button"
                                    ref={(node) => {
                                      if (node) {
                                        conversationActionTriggerRefs.current.set(conversationKey, node)
                                      } else {
                                        conversationActionTriggerRefs.current.delete(conversationKey)
                                      }
                                    }}
                                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                                    aria-label="Abrir ações da conversa"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      setOpenConversationActionMenuId((current) => {
                                        const next = current === conversationKey ? null : conversationKey
                                        setConversationActionMenuLayout(next ? computeConversationActionMenuLayout(conversationKey) : null)
                                        return next
                                      })
                                    }}
                                  >
                                    <DotsThreeVertical className="h-3 w-3" weight="bold" />
                                  </button>

                                  <div className="flex items-start gap-2">
                                    <div className="mt-1">
                                      {getPlatformIcon(conv.platform || conv.channel || conv.type, conv.channel)}
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
                                      <div className="mt-1 flex items-center gap-1.5 text-xs text-blue-100/70">
                                        {previewMeta.semanticType === 'image' || previewMeta.semanticType === 'sticker' ? (
                                          <ImageSquare className="h-3.5 w-3.5 shrink-0 text-blue-100/55" weight="fill" />
                                        ) : null}
                                        {previewMeta.semanticType === 'audio' ? (
                                          <ChatCircle className="h-3.5 w-3.5 shrink-0 text-blue-100/55" weight="fill" />
                                        ) : null}
                                        {previewMeta.semanticType === 'call' ? (
                                          <Phone className="h-3.5 w-3.5 shrink-0 text-blue-100/55" weight="fill" />
                                        ) : null}
                                        {previewMeta.semanticType === 'video' ? (
                                          <VideoCamera className="h-3.5 w-3.5 shrink-0 text-blue-100/55" weight="fill" />
                                        ) : null}
                                        {previewMeta.semanticType === 'document' ? (
                                          <FilePdf className="h-3.5 w-3.5 shrink-0 text-blue-100/55" weight="fill" />
                                        ) : null}
                                        {previewMeta.semanticType === 'template' || previewMeta.semanticType === 'interactive' ? (
                                          <ChatCircle className="h-3.5 w-3.5 shrink-0 text-blue-100/55" weight="fill" />
                                        ) : null}
                                        {previewMeta.semanticType === 'placeholder' ? (
                                          <Warning className="h-3.5 w-3.5 shrink-0 text-blue-100/55" weight="fill" />
                                        ) : null}
                                        {previewMeta.semanticType === 'pin' ? (
                                          <PushPin className="h-3.5 w-3.5 shrink-0 text-blue-100/55" weight="fill" />
                                        ) : null}
                                        {previewMeta.semanticType === 'reaction' ? (
                                          <Smiley className="h-3.5 w-3.5 shrink-0 text-blue-100/55" weight="fill" />
                                        ) : null}
                                        <span className="truncate" data-testid="conversation-preview">
                                          {previewMeta.previewText}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="ml-2 shrink-0 self-center flex items-center gap-2">
                                      <ConversationAvatar conv={conv} size={42} />
                                      {unreadCount > 0 ? (
                                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-sky-500/90 px-1 text-[10px] font-semibold text-white">
                                          {unreadCount > 99 ? '99+' : unreadCount}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                            </div>
                          )
                        })()
                      ))}
                      {openConversationActionMenuId && conversationActionMenuLayout ? (
                        <div
                          ref={conversationActionMenuRef}
                          className="fixed z-[80] flex flex-col overflow-y-auto rounded-[28px] border border-white/12 bg-slate-950/88 p-1.5 text-white shadow-2xl backdrop-blur-2xl"
                          style={{
                            top: `${conversationActionMenuLayout.top}px`,
                            left: `${conversationActionMenuLayout.left}px`,
                            width: `${conversationActionMenuLayout.width}px`,
                            maxHeight: `min(70vh, 560px)`
                          }}
                        >
                          {(() => {
                            const conversation = filteredConversations.find((item) => `${item.conversationId}-${item.channel ?? item.platform ?? ''}` === openConversationActionMenuId)
                            return conversation ? renderConversationListMenuItems(conversation) : null
                          })()}
                        </div>
                      ) : null}
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

          <Card className="glass-card hover:translate-y-0 xl:col-span-8 flex h-full min-h-0 flex-col overflow-hidden">
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

                      <div className="relative flex min-h-0 flex-1 flex-col rounded-xl border border-white/10 bg-white/5 p-4">
                        <div
                          ref={messagesViewportRef}
                          className="relative flex-1 min-h-0 overflow-y-auto pr-2"
                          onMouseMove={handleMessagesViewportMouseMove}
                          onMouseLeave={() => setScrollAffordanceZone(null)}
                        >
                          {openMessageActionMenuId ? (
                            <button
                              type="button"
                              aria-label="Fechar menu de ações da mensagem"
                              className="absolute inset-0 z-20 bg-slate-950/35 backdrop-blur-[1.5px]"
                              onClick={closeMessageActionMenu}
                            />
                          ) : null}
                          <div className="relative space-y-3 px-1 pb-4 pt-2">
                            {selectedConversation.platform === 'lead' ? (
                              harmoniaMessagesLoading ? (
                                <div className="flex min-h-[220px] items-center justify-center">
                                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/45 px-3 py-1.5 text-sm text-blue-100/80 backdrop-blur-sm">
                                    <CircleNotch className="h-4 w-4 animate-spin" />
                                    <span>Carregando mensagens...</span>
                                  </div>
                                </div>
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
                                {loadingMessages ? (
                                  <div className="flex min-h-[220px] items-center justify-center">
                                    <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/45 px-3 py-1.5 text-sm text-blue-100/80 backdrop-blur-sm">
                                      <CircleNotch className="h-4 w-4 animate-spin" />
                                      <span>Carregando mensagens...</span>
                                    </div>
                                  </div>
                                ) : messages.map((msg, msgIndex) => {
                                const outbound = isOutboundMessage(msg)
                                const ts = msg.createdAt || msg.timestamp
                                const messageId = String(msg?.id || msg?.provider_message_id || '').trim()
                                const messageAnchorKey = buildMessageUiAnchorKey(msg, msgIndex)
                                const messageActionTestIdKey = messageId || `msg-${msgIndex}`
                                const isGroupConversation = String(
                                  selectedConversation?.conversationId ||
                                  selectedConversation?.rawJid ||
                                  selectedConversation?.normalizedJid ||
                                  ''
                                ).includes('@g.us')
                                const senderSeed = String(
                                  msg?.senderJid ||
                                  msg?.senderLid ||
                                  msg?.senderPhone ||
                                  msg?.senderName ||
                                  messageId
                                )
                                const senderStyle = resolveGroupSenderStyle(senderSeed)
                                const senderAliases = Array.from(new Set([
                                  ...buildMentionAliases(msg?.senderJid),
                                  ...buildMentionAliases(msg?.senderLid),
                                  ...buildMentionAliases(msg?.senderPhone)
                                ]))
                                const senderDirectoryEntry = senderAliases.map((alias) => groupParticipantDirectory.get(alias)).find(Boolean)
                                const senderDisplayName = String(
                                  msg?.senderName ||
                                  (outbound ? 'Você' : (
                                    formatPhone(msg?.senderPhone || msg?.senderJid || msg?.senderLid || '') ||
                                    'Participante'
                                  ))
                                ).trim()
                                const senderInitials = getInitials(senderDisplayName || (outbound ? 'Você' : 'Contato'))
                                const resolveMentionLabel = (token: string): MentionRenderMeta => {
                                  const aliases = buildMentionAliases(token)
                                  for (const alias of aliases) {
                                    const found = groupParticipantDirectory.get(alias)
                                    if (found) return found
                                  }
                                  return {
                                    label: formatPhone(token) || token,
                                    color: senderStyle.mention
                                  }
                                }
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
                                const visibleBodyText = resolveMessageBodyText(msg)
                                const semanticType = normalizeMessageSemanticType(msg?.mediaType || msg?.type)
                                if (semanticType === 'reaction' && (!Array.isArray(msg?.reactions) || msg.reactions.length === 0)) {
                                  return null
                                }
                                const resolvedSenderAvatarUrl = String(
                                  msg?.senderAvatarUrl ||
                                  senderDirectoryEntry?.avatarUrl ||
                                  (!isGroupConversation && !outbound ? resolveAvatarUrl(selectedConversation) : '')
                                ).trim()
                                const showReactionActions = selectedConversation?.platform !== 'lead' && selectedConversation?.platform !== 'instagram'
                                const isSelectedMessage = selectedMessageIdSet.has(messageId)
                                const isFavoritedMessage = Boolean(msg?.favorite)
                                const isPinnedMessage = Boolean(msg?.pinned)
                                const isReportedMessage = Boolean(msg?.reported)
                                const isMessageActionMenuOpen = openMessageActionMenuId === messageAnchorKey
                                const isReactionMenuExpanded = expandedReactionMenuId === messageAnchorKey
                                return (
                                  <div key={messageAnchorKey} className={`group flex items-end gap-2 ${outbound ? 'justify-end' : 'justify-start'}`}>
                                    {showReactionActions && outbound ? (
                                      <div className="relative flex items-center gap-1 self-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
                                    <div
                                      className={`relative max-w-[88%] md:max-w-[75%] rounded-lg border pb-3 pt-4 transition-colors duration-200 ${
                                        outbound ? 'pl-10 pr-3' : 'pl-3 pr-10'
                                      } ${
                                        outbound ? 'border-blue-300/20 bg-blue-500/35 text-white' : 'border-white/10 bg-white/10 text-blue-100'
                                      } ${
                                        isSelectedMessage ? 'ring-2 ring-emerald-300/70 ring-offset-2 ring-offset-slate-950/40' : ''
                                      } ${
                                        isReportedMessage ? 'border-rose-300/45' : ''
                                      }`}
                                      style={isGroupConversation && !outbound ? {
                                        borderColor: senderStyle.border,
                                        backgroundColor: senderStyle.bubbleBg
                                      } : undefined}
                                      data-testid="message-bubble"
                                      onClick={() => {
                                        if (!messageSelectionMode) return
                                        toggleMessageSelection(messageId)
                                      }}
                                      onDoubleClick={() => {
                                        openReplyComposer(msg)
                                      }}
                                      onContextMenu={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        openMessageActionMenu(messageAnchorKey)
                                      }}
                                    >
                                      <div
                                        className={`absolute top-2 z-40 ${outbound ? 'left-2' : 'right-2'}`}
                                        data-message-action-root={messageAnchorKey}
                                        ref={(node) => {
                                          if (node) {
                                            messageActionRootRefs.current.set(messageAnchorKey, node)
                                          } else {
                                            messageActionRootRefs.current.delete(messageAnchorKey)
                                          }
                                        }}
                                      >
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          className="h-6 w-6 rounded-full border border-white/10 bg-black/15 text-blue-100 opacity-75 transition-opacity hover:bg-black/25 hover:opacity-100"
                                          aria-label="Abrir ações da mensagem"
                                          aria-expanded={isMessageActionMenuOpen}
                                          data-testid={`message-actions-trigger-${messageActionTestIdKey}`}
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            toggleMessageActionMenu(messageAnchorKey)
                                          }}
                                        >
                                          <CaretDown className="h-3.5 w-3.5" />
                                        </Button>
                                        {isMessageActionMenuOpen && typeof document !== 'undefined'
                                          ? createPortal(
                                          <div
                                            ref={messageActionMenuRef}
                                            role="menu"
                                            data-testid={`message-actions-menu-${messageAnchorKey}`}
                                            className="fixed z-[70] flex flex-col overflow-y-auto rounded-2xl border border-white/20 bg-slate-900/72 p-1 text-sm text-blue-50 shadow-2xl backdrop-blur-xl"
                                            style={messageActionMenuLayout?.anchorKey === messageAnchorKey ? {
                                              top: `${messageActionMenuLayout.top}px`,
                                              left: `${messageActionMenuLayout.left}px`,
                                              maxHeight: `${messageActionMenuLayout.maxHeight}px`,
                                              width: `${messageActionMenuLayout.width}px`
                                            } : {
                                              visibility: 'hidden'
                                            }}
                                            onClick={(event) => event.stopPropagation()}
                                          >
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                              onClick={() => {
                                                openReplyComposer(msg)
                                                closeMessageActionMenu()
                                              }}
                                            >
                                              <ArrowBendUpLeft className="h-4 w-4" />
                                              Responder
                                            </button>
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                              onClick={() => {
                                                if (!showReactionActions) return
                                                setExpandedReactionMenuId((current) => current === messageAnchorKey ? null : messageAnchorKey)
                                              }}
                                            >
                                              <Smiley className="h-4 w-4" />
                                              Reagir
                                            </button>
                                            {isReactionMenuExpanded ? (
                                              <div className="mb-1 mt-1 flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                                                {reactionOptions.map((emoji) => (
                                                  <button
                                                    key={`${messageId}-menu-${emoji}`}
                                                    type="button"
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-base transition-colors hover:bg-white/10 disabled:opacity-50"
                                                    onClick={() => {
                                                      void toggleReaction(msg, emoji)
                                                      closeMessageActionMenu()
                                                    }}
                                                    disabled={!showReactionActions || reactionBusyKey === `${messageId}:${emoji}`}
                                                    aria-label={`Reagir com ${emoji}`}
                                                  >
                                                    {emoji}
                                                  </button>
                                                ))}
                                              </div>
                                            ) : null}
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                              onClick={() => {
                                                toggleMessageFlag(messageId, 'favorite')
                                                closeMessageActionMenu()
                                              }}
                                            >
                                              <Star className="h-4 w-4" weight={isFavoritedMessage ? 'fill' : 'regular'} />
                                              {isFavoritedMessage ? 'Desfavoritar' : 'Favoritar'}
                                            </button>
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                              onClick={() => {
                                                toggleMessageFlag(messageId, 'pinned')
                                                closeMessageActionMenu()
                                              }}
                                            >
                                              <PushPin className="h-4 w-4" weight={isPinnedMessage ? 'fill' : 'regular'} />
                                              {isPinnedMessage ? 'Desfixar' : 'Fixar'}
                                            </button>
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                              onClick={() => {
                                                forwardMessageToComposer(msg)
                                                closeMessageActionMenu()
                                              }}
                                            >
                                              <ArrowBendUpRight className="h-4 w-4" />
                                              Encaminhar
                                            </button>
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                              onClick={() => {
                                                void copyMessageContent(msg)
                                                closeMessageActionMenu()
                                              }}
                                            >
                                              <CopySimple className="h-4 w-4" />
                                              Copiar
                                            </button>
                                            {isGroupConversation ? (
                                              <>
                                                <div className="my-1 h-px bg-white/10" />
                                                <button
                                                  type="button"
                                                  role="menuitem"
                                                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                                  onClick={() => {
                                                    void openPrivateConversationForMessage(msg, { prefill: true })
                                                    closeMessageActionMenu()
                                                  }}
                                                >
                                                  <ArrowBendUpLeft className="h-4 w-4" />
                                                  Responder em particular
                                                </button>
                                                <button
                                                  type="button"
                                                  role="menuitem"
                                                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                                  onClick={() => {
                                                    void openPrivateConversationForMessage(msg)
                                                    closeMessageActionMenu()
                                                  }}
                                                >
                                                  <ChatCircle className="h-4 w-4" />
                                                  Conversar com {senderDisplayName || 'contato'}
                                                </button>
                                              </>
                                            ) : null}
                                            <div className="my-1 h-px bg-white/10" />
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                              onClick={() => {
                                                toggleMessageFlag(messageId, 'reported')
                                                closeMessageActionMenu()
                                              }}
                                            >
                                              <WarningCircle className="h-4 w-4" />
                                              {isReportedMessage ? 'Remover denúncia' : 'Denunciar'}
                                            </button>
                                            <div className="my-1 h-px bg-white/10" />
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                              onClick={() => {
                                                removeMessageFromView(messageId)
                                                closeMessageActionMenu()
                                              }}
                                            >
                                              <Trash className="h-4 w-4" />
                                              Apagar
                                            </button>
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                                              onClick={() => {
                                                toggleMessageSelection(messageId)
                                                closeMessageActionMenu()
                                              }}
                                            >
                                              <CheckCircle className="h-4 w-4" weight={isSelectedMessage ? 'fill' : 'regular'} />
                                              {isSelectedMessage ? 'Desselecionar mensagem' : 'Selecionar mensagens'}
                                            </button>
                                          </div>,
                                          document.body
                                        ) : null}
                                      </div>
                                      {Array.isArray(msg?.reactions) && msg.reactions.length > 0 ? (
                                        <div className="absolute right-10 top-0 z-10 flex max-w-[70%] -translate-y-1/2 flex-wrap justify-end gap-1">
                                          {msg.reactions.map((reaction: any) => (
                                            <button
                                              key={`${messageId}-${reaction.emoji}`}
                                              type="button"
                                              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] shadow-sm ${
                                                reaction.reactedByMe
                                                  ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
                                                  : 'border-white/15 bg-slate-950/85 text-blue-100/90'
                                              }`}
                                              onClick={() => toggleReaction(msg, reaction.emoji)}
                                            >
                                              <span>{reaction.emoji}</span>
                                              {Number(reaction.count || 0) > 1 ? <span>{reaction.count}</span> : null}
                                            </button>
                                          ))}
                                        </div>
                                      ) : null}
                                      {isFavoritedMessage || isPinnedMessage || isReportedMessage ? (
                                        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-blue-100/65">
                                          {isFavoritedMessage ? (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-amber-100">
                                              <Star className="h-3 w-3" weight="fill" />
                                              Favorita
                                            </span>
                                          ) : null}
                                          {isPinnedMessage ? (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/30 bg-sky-400/10 px-2 py-0.5 text-sky-100">
                                              <PushPin className="h-3 w-3" weight="fill" />
                                              Fixada
                                            </span>
                                          ) : null}
                                          {isReportedMessage ? (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/30 bg-rose-400/10 px-2 py-0.5 text-rose-100">
                                              <WarningCircle className="h-3 w-3" weight="fill" />
                                              Denunciada
                                            </span>
                                          ) : null}
                                        </div>
                                      ) : null}
                                      {isGroupConversation || (!outbound && resolvedSenderAvatarUrl) ? (
                                        <div className={`mb-2 flex items-center gap-2 ${outbound ? 'justify-end' : 'justify-start'}`}>
                                          {resolvedSenderAvatarUrl ? (
                                            <img
                                              src={resolvedSenderAvatarUrl}
                                              alt={senderDisplayName}
                                              className="h-5 w-5 rounded-full border border-white/20 object-cover bg-white/10"
                                              loading="lazy"
                                            />
                                          ) : (
                                            <div className="h-5 w-5 rounded-full border border-white/20 bg-white/10 text-[9px] font-semibold text-blue-100 flex items-center justify-center">
                                              {senderInitials}
                                            </div>
                                          )}
                                          <div className="text-[11px] font-semibold" style={{ color: outbound ? '#bfdbfe' : senderStyle.title }}>
                                            {senderDisplayName || 'Contato'}
                                          </div>
                                        </div>
                                      ) : null}
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
                                      {visibleBodyText ? (
                                        <div className="text-sm">
                                          {renderFormattedText(visibleBodyText, {
                                            resolveMention: isGroupConversation ? resolveMentionLabel : undefined
                                          })}
                                        </div>
                                      ) : null}
                                      {media ? (
                                        <MessageMedia
                                          media={media}
                                          mediaProxyUrl={msg.mediaProxyUrl}
                                          fallbackText="Mídia indisponível no momento."
                                          onImagePreview={(payload) => setImagePreview(payload)}
                                          onFilePreview={(payload) => setFilePreview(payload)}
                                        />
                                      ) : null}
                                      <div className={`text-xs mt-1 ${outbound ? 'text-blue-100/80' : 'text-blue-100/60'}`}>
                                        {ts ? new Date(ts).toLocaleTimeString() : ''}
                                      </div>
                                    </div>
                                    {showReactionActions && !outbound ? (
                                      <div className="relative flex items-center gap-1 self-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
                                            <div className="absolute left-0 top-7 z-20 flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/95 p-1 shadow-lg">
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
                                  </div>
                                  )
                                })}
                              </>
                            )}
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className={`pointer-events-auto absolute right-4 top-4 z-20 h-9 w-9 rounded-full border-white/20 bg-slate-900/70 text-blue-100 shadow-lg backdrop-blur transition-all duration-200 hover:bg-slate-800/85 ${
                              messageScrollState.canScrollUp && scrollAffordanceZone === 'top'
                                ? 'opacity-100 translate-y-0'
                                : 'pointer-events-none opacity-0 -translate-y-2'
                            }`}
                            onClick={scrollMessagesToTop}
                            aria-label="Ir para o topo da conversa"
                          >
                            <ArrowCircleUp className="h-4 w-4" />
                          </Button>

                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            data-testid="scroll-bottom-button"
                            className={`pointer-events-auto absolute bottom-4 right-4 z-20 h-9 w-9 rounded-full border-white/20 bg-slate-900/70 text-blue-100 shadow-lg backdrop-blur transition-all duration-200 hover:bg-slate-800/85 ${
                              messageScrollState.canScrollDown && scrollAffordanceZone === 'bottom'
                                ? 'opacity-100 translate-y-0'
                                : 'pointer-events-none opacity-0 translate-y-2'
                            }`}
                            onClick={() => {
                              autoScrollRef.current = true
                              scrollMessagesToBottom()
                            }}
                            aria-label="Ir para o fim da conversa"
                          >
                            <ArrowCircleDown className="h-4 w-4" />
                          </Button>
                        </div>

                        {messageSelectionMode && selectedMessageIds.length > 0 ? (
                          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                            <div className="truncate">
                              {selectedMessageIds.length} {selectedMessageIds.length === 1 ? 'mensagem selecionada' : 'mensagens selecionadas'}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-emerald-100 hover:bg-emerald-500/10"
                              onClick={clearMessageSelection}
                            >
                              Limpar seleção
                            </Button>
                          </div>
                        ) : null}

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

                        {shouldShowSendUnitSelector ? (
                          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] uppercase tracking-wide text-blue-100/60">Unidade de envio</div>
                              <Select value={sendUnitChannel} onValueChange={setSendUnitChannel}>
                                <SelectTrigger className="mt-1 h-8 border-white/15 bg-white/10 text-xs text-white">
                                  <SelectValue placeholder="Selecione a unidade/canal" />
                                </SelectTrigger>
                                <SelectContent>
                                  {sendUnitOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {markingConversationRead ? (
                              <div className="shrink-0 rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-100">
                                Sincronizando leitura...
                              </div>
                            ) : null}
                          </div>
                        ) : null}

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
                          <Button
                            onClick={sendMessage}
                            disabled={
                              !messageInput.trim() ||
                              sendingMessage ||
                              (shouldShowSendUnitSelector && !sendUnitChannel)
                            }
                          >
                            {sendingMessage ? '...' : 'Enviar'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center">
                      {isInitialSyncActive ? (
                        <div className="max-w-sm">
                          {renderWhatsAppSyncNotice('panel')}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-6 py-6 text-center max-w-sm">
                          <div className="text-sm text-blue-100/70">Nenhuma conversa selecionada</div>
                          <div className="text-xs text-blue-100/50 mt-2">
                            As mensagens aparecerão aqui assim que as contas estiverem conectadas.
                          </div>
                        </div>
                      )}
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

        <Dialog open={Boolean(filePreview)} onOpenChange={(open) => { if (!open) setFilePreview(null) }}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>{filePreview?.title || 'Visualizar arquivo'}</DialogTitle>
              <DialogDescription>Pré-visualização do arquivo na conversa.</DialogDescription>
            </DialogHeader>
            {filePreview?.src ? (
              <div className="max-h-[75vh] overflow-hidden rounded-lg border border-white/10 bg-black/40">
                {String(filePreview?.mimeType || '').includes('pdf') ? (
                  <iframe
                    title={filePreview?.title || 'Arquivo'}
                    src={filePreview.src}
                    className="h-[70vh] w-full"
                  />
                ) : (
                  <iframe
                    title={filePreview?.title || 'Arquivo'}
                    src={filePreview.src}
                    className="h-[70vh] w-full"
                  />
                )}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={waStatusOpen} onOpenChange={setWaStatusOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{orchestratorIssue ? 'Integração WhatsApp indisponível' : 'WhatsApp conectado'}</DialogTitle>
              <DialogDescription>
                {orchestratorIssue
                  ? orchestratorIssue.message
                  : connectedWhatsapps.length
                  ? `${connectedWhatsapps.length} canal(is) ativo(s).`
                  : 'Nenhum canal conectado no momento.'}
              </DialogDescription>
            </DialogHeader>
            {orchestratorIssue ? (
              <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <div className="font-medium">Código operacional: {orchestratorIssue.code}</div>
                <div className="mt-1 text-amber-100/80">
                  O CRM não tentará iniciar uma conta até que o orquestrador esteja disponível.
                </div>
              </div>
            ) : null}
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
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => refreshConnectedChannel(instance.channel)}
                      disabled={Boolean(connectedChannelAction[instance.channel])}
                    >
                      {connectedChannelAction[instance.channel] === 'refresh' ? (
                        <>
                          <CircleNotch className="mr-1 h-3.5 w-3.5 animate-spin" />
                          Refrescando...
                        </>
                      ) : (
                        'Refrescar'
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px] border-red-300/40 text-red-200 hover:bg-red-500/20"
                      onClick={() => disconnectConnectedChannel(instance.channel)}
                      disabled={Boolean(connectedChannelAction[instance.channel])}
                    >
                      {connectedChannelAction[instance.channel] === 'disconnect' ? (
                        <>
                          <CircleNotch className="mr-1 h-3.5 w-3.5 animate-spin" />
                          Desconectando...
                        </>
                      ) : (
                        'Desconectar'
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              {connectedWhatsapps.length > 1 ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    void refreshAllConnectedChannels()
                  }}
                  disabled={refreshAllChannelsLoading || Object.values(connectedChannelAction).some(Boolean)}
                >
                  {refreshAllChannelsLoading ? (
                    <>
                      <CircleNotch className="mr-1 h-4 w-4 animate-spin" />
                      Refrescando todos...
                    </>
                  ) : (
                    'Refrescar todos'
                  )}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setWaStatusOpen(false)}>
                Fechar
              </Button>
              {orchestratorIssue ? (
                <Button onClick={() => void loadStatus()} disabled={!orchestratorIssue.retriable}>
                  {orchestratorIssue.retriable ? 'Tentar novamente' : 'Configuração necessária'}
                </Button>
              ) : (
                <Button
                  onClick={() => void connectWhatsApp()}
                  disabled={qrConnectionPhase === 'starting' || qrConnectionPhase === 'rendering'}
                >
                  {qrConnectionPhase === 'starting' || qrConnectionPhase === 'rendering' ? (
                    <>
                      <CircleNotch className="mr-1 h-4 w-4 animate-spin" />
                      Preparando QR...
                    </>
                  ) : (
                    'Conectar novo'
                  )}
                </Button>
              )}
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

        <Dialog
          open={qrDialogChannel !== null}
          onOpenChange={(open) => {
            if (open) return
            setQrDialogChannel(null)
            setQrConnectionPhase('idle')
            setQrConnectionError(null)
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {waInitialSyncChannel === qrDialogChannel
                  ? `Conectando canal ${qrDialogChannel}`
                  : qrConnectionPhase === 'starting' || qrConnectionPhase === 'rendering'
                    ? `Preparando QR do canal ${qrDialogChannel}`
                    : `QR Code do canal ${qrDialogChannel}`}
              </DialogTitle>
              <DialogDescription>
                {waInitialSyncChannel === qrDialogChannel
                  ? 'Sincronização inicial em andamento.'
                  : qrConnectionPhase === 'starting'
                    ? 'Canal selecionado. Solicitando o QR Code ao WhatsApp.'
                    : qrConnectionPhase === 'rendering'
                      ? 'QR Code recebido. Preparando a exibição.'
                      : qrConnectionPhase === 'waiting'
                        ? 'Canal iniciado. Aguardando o QR Code do WhatsApp.'
                        : 'Use o WhatsApp para escanear.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-center">
              {waInitialSyncChannel === qrDialogChannel ? (
                <div className="w-full rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-5">
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-400/15 px-3 py-1.5 text-sm font-medium text-cyan-100">
                    <CircleNotch className="h-4 w-4 animate-spin" />
                    <span>Carregando</span>
                  </div>
                  <div className="mt-3 text-sm text-cyan-100/90">Suas conversas estão sendo carregadas.</div>
                  <div className="mt-1 text-xs text-cyan-100/75">Mantenha o WhatsApp aberto nos dois dispositivos.</div>
                </div>
              ) : qrDialogChannel && channelQR.get(qrDialogChannel)?.dataUrl ? (
                <img src={channelQR.get(qrDialogChannel)?.dataUrl} alt={`QR ${qrDialogChannel}`} className="h-64 w-64 rounded-lg bg-white p-2" />
              ) : qrConnectionError ? (
                <div className="w-full rounded-xl border border-red-300/30 bg-red-500/10 px-4 py-5 text-sm text-red-100">
                  {qrConnectionError}
                </div>
              ) : (
                <div className="w-full rounded-xl border border-blue-300/30 bg-blue-500/10 px-4 py-5">
                  <div className="inline-flex items-center gap-2 rounded-full border border-blue-300/30 bg-blue-400/15 px-3 py-1.5 text-sm font-medium text-blue-100">
                    <CircleNotch className="h-4 w-4 animate-spin" />
                    <span>{qrConnectionPhase === 'waiting' ? 'Aguardando QR Code' : 'Conectando ao WhatsApp'}</span>
                  </div>
                  <div className="mt-3 text-sm text-blue-100/90">
                    {qrConnectionPhase === 'waiting'
                      ? 'O WhatsApp ainda está preparando o código. Esta janela será atualizada automaticamente.'
                      : 'O pedido foi enviado. Aguarde enquanto o canal é inicializado.'}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              {qrConnectionError && qrDialogChannel ? (
                <Button variant="outline" className="mr-2" onClick={() => void startChannel(qrDialogChannel)}>
                  Tentar novamente
                </Button>
              ) : null}
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
