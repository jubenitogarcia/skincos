import React from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Input } from '@/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { LoadingPercentText } from '@/LoadingPattern'

const WhatsAppUnifiedHub = React.lazy(() => import('@/WhatsAppUnifiedHub').then((m) => ({ default: m.WhatsAppUnifiedHub })))
const OmnichannelCenter = React.lazy(() => import('@/OmnichannelCenter').then((m) => ({ default: m.OmnichannelCenter })))

type ApiErrorShape = {
  ok?: boolean
  error?: string
  message?: string
}

type HarmoniaHealth = {
  ok: boolean
  harmonia?: {
    dbConfigured?: boolean
    googleConfigured?: boolean
    openAiConfigured?: boolean
    execTokenConfigured?: boolean
    autoMigrate?: boolean
    storeRaw?: boolean
  }
  ts?: string
}

type HarmoniaUnit = {
  id?: string
  slug?: string
  name?: string
  timezone?: string
  working_hours?: unknown
  created_at?: string
  updated_at?: string
}

type HarmoniaTaskStats = {
  byStatus?: Record<string, number>
  byType?: Record<string, number>
  oldestPendingAt?: string | null
  oldestProcessingAt?: string | null
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

function onlyDigits(s: string) {
  return String(s || '').replace(/\D+/g, '')
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

function sortMessagesByTime(messages: HarmoniaMessage[]) {
  return [...messages].sort((a, b) => {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0
    return ta - tb
  })
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

function StatPill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
      <div className="text-[11px] text-blue-200/70">{label}</div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  )
}

type HarmoniaModuleProps = {
  mode?: 'full' | 'expanded' | 'columns'
  showHeader?: boolean
  showChannels?: boolean
}

export function HarmoniaModule({ mode = 'full', showHeader = true, showChannels = true }: HarmoniaModuleProps) {
  const [tab, setTab] = React.useState<'atendimento' | 'overview' | 'conversations' | 'tasks'>(() => {
    try {
      const stored = localStorage.getItem('harmonia.ui.tab')
      if (stored === 'overview' || stored === 'conversations' || stored === 'tasks' || stored === 'atendimento') {
        return stored
      }
    } catch { /* ignore */ }
    return 'atendimento'
  })

  const [health, setHealth] = React.useState<HarmoniaHealth | null>(null)
  const [units, setUnits] = React.useState<HarmoniaUnit[]>([])
  const [stats, setStats] = React.useState<HarmoniaTaskStats | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const DEBUG_TOKEN_KEY = 'harmonia.debugToken'
  const EXEC_TOKEN_KEY = 'harmonia.execToken'
  const UI_UNIT_KEY = 'harmonia.ui.unitSlug'
  const UI_CONVO_KEY = 'harmonia.ui.conversationId'
  const UI_TAB_KEY = 'harmonia.ui.tab'
  const UI_CHANNEL_KEY = 'harmonia.ui.channel'
  const UI_SEARCH_KEY = 'harmonia.ui.search'
  const UI_STAGE_KEY = 'harmonia.ui.stage'
  const [systemConfig, setSystemConfig] = useKV<any>('system-config', {
    integrations: { harmonia: { debugToken: '', execToken: '' } }
  })
  const [debugToken, setDebugToken] = React.useState<string>(() => {
    try {
      return systemConfig?.integrations?.harmonia?.debugToken || localStorage.getItem(DEBUG_TOKEN_KEY) || ''
    } catch {
      return systemConfig?.integrations?.harmonia?.debugToken || ''
    }
  })

  const [execToken, setExecToken] = React.useState<string>(() => {
    try {
      return systemConfig?.integrations?.harmonia?.execToken || localStorage.getItem(EXEC_TOKEN_KEY) || ''
    } catch {
      return systemConfig?.integrations?.harmonia?.execToken || ''
    }
  })

  React.useEffect(() => {
    const nextDebug = systemConfig?.integrations?.harmonia?.debugToken || ''
    const nextExec = systemConfig?.integrations?.harmonia?.execToken || ''
    if (nextDebug !== debugToken) setDebugToken(nextDebug)
    if (nextExec !== execToken) setExecToken(nextExec)
  }, [systemConfig?.integrations?.harmonia?.debugToken, systemConfig?.integrations?.harmonia?.execToken])

  const updateIntegrationToken = React.useCallback(
    (field: 'debugToken' | 'execToken', value: string) => {
      setSystemConfig((prev: any) => ({
        ...(prev || {}),
        integrations: {
          ...(prev?.integrations || {}),
          harmonia: {
            ...(prev?.integrations?.harmonia || {}),
            [field]: value,
          },
        },
      }))
    },
    [setSystemConfig]
  )

  const apiJson = React.useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const token = debugToken.trim()
      const res = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init?.body ? { 'content-type': 'application/json' } : null),
          ...(token ? { 'x-harmonia-token': token } : null),
          ...(execToken.trim() ? { 'x-harmonia-exec-token': execToken.trim() } : null),
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
      const err = (json || {}) as ApiErrorShape
      throw new Error(err.error || err.message || `HTTP ${res.status}`)
    },
    [debugToken, execToken]
  )

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [h, u, s] = await Promise.all([
        apiJson<HarmoniaHealth>('/api/harmonia/health'),
        apiJson<{ ok: boolean; data?: HarmoniaUnit[] }>('/api/harmonia/units').catch((e) => ({ ok: false, data: [], __err: e } as any)),
        apiJson<{ ok: boolean; data?: HarmoniaTaskStats }>('/api/harmonia/tasks/stats').catch((e) => ({ ok: false, data: null, __err: e } as any)),
      ])
      setHealth(h || null)
      setUnits(Array.isArray((u as any)?.data) ? (u as any).data : [])
      setStats(((s as any)?.data as any) || null)
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar dados de leads.')
    } finally {
      setLoading(false)
    }
  }, [apiJson])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (!showChannels && tab === 'atendimento') {
      setTab('overview')
    }
  }, [showChannels, tab])

  React.useEffect(() => {
    try {
      localStorage.setItem(UI_TAB_KEY, tab)
    } catch { /* ignore */ }
  }, [tab])

  const dbConfigured = Boolean(health?.harmonia?.dbConfigured)
  const execRequired = Boolean(health?.harmonia?.execTokenConfigured)
  const canExecute = !execRequired || Boolean(execToken.trim())

  const [channelTab, setChannelTab] = React.useState<'whatsapp' | 'omnichannel'>(() => {
    try {
      const stored = localStorage.getItem('harmonia.ui.channel')
      if (stored === 'omnichannel' || stored === 'whatsapp') {
        return stored
      }
    } catch { /* ignore */ }
    return 'whatsapp'
  })
  React.useEffect(() => {
    try {
      localStorage.setItem(UI_CHANNEL_KEY, channelTab)
    } catch { /* ignore */ }
  }, [channelTab])

  const [unitSlug, setUnitSlug] = React.useState<string>(() => {
    try {
      return localStorage.getItem('harmonia.ui.unitSlug') || ''
    } catch {
      return ''
    }
  })
  React.useEffect(() => {
    if (!unitSlug) return
    try {
      localStorage.setItem(UI_UNIT_KEY, unitSlug)
    } catch { /* ignore */ }
  }, [unitSlug])

  const [inboxSearch, setInboxSearch] = React.useState<string>(() => {
    try {
      return localStorage.getItem(UI_SEARCH_KEY) || ''
    } catch {
      return ''
    }
  })
  const [inboxStage, setInboxStage] = React.useState<string>(() => {
    try {
      return localStorage.getItem(UI_STAGE_KEY) || 'all'
    } catch {
      return 'all'
    }
  })
  const inboxSearchRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    try {
      localStorage.setItem(UI_SEARCH_KEY, inboxSearch)
    } catch { /* ignore */ }
  }, [inboxSearch])

  React.useEffect(() => {
    try {
      localStorage.setItem(UI_STAGE_KEY, inboxStage)
    } catch { /* ignore */ }
  }, [inboxStage])

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault()
        inboxSearchRef.current?.focus()
      }
      if ((event.metaKey || event.ctrlKey) && key === 'r') {
        event.preventDefault()
        void refresh()
      }
      if (key === 'escape') {
        setInboxSearch('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [refresh])
  const [phoneRaw, setPhoneRaw] = React.useState<string>('')
  const [conversationLoading, setConversationLoading] = React.useState(false)
  const [conversationError, setConversationError] = React.useState<string | null>(null)
  const [conversation, setConversation] = React.useState<HarmoniaConversation | null>(null)
  const [messages, setMessages] = React.useState<HarmoniaMessage[]>([])
  const [messagesLoading, setMessagesLoading] = React.useState(false)
  const [actionLoading, setActionLoading] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = React.useState<string | null>(null)
  const [messagesHasMore, setMessagesHasMore] = React.useState(false)
  const [messagesCursor, setMessagesCursor] = React.useState<string | null>(null)
  const actionTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (unitSlug) return
    const first = units.find((u) => u?.slug)?.slug
    if (first) setUnitSlug(String(first))
  }, [unitSlug, units])

  type InboxItem = {
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
  const [inboxItems, setInboxItems] = React.useState<InboxItem[]>([])
  const [inboxCursor, setInboxCursor] = React.useState<{ cursorTs: string | null; cursorId: string | null } | null>(null)
  const [inboxLoading, setInboxLoading] = React.useState(false)
  const [inboxError, setInboxError] = React.useState<string | null>(null)

  const loadInbox = React.useCallback(
    async (mode: 'reset' | 'more') => {
      const slug = String(unitSlug || '').trim()
      if (!dbConfigured || !slug) return
      setInboxLoading(true)
      setInboxError(null)
      try {
        const cursor = mode === 'more' ? inboxCursor : null
        const qs = new URLSearchParams()
        qs.set('unitSlug', slug)
        qs.set('limit', '30')
        if (cursor?.cursorTs) qs.set('cursorTs', String(cursor.cursorTs))
        if (cursor?.cursorId) qs.set('cursorId', String(cursor.cursorId))

        const out = await apiJson<{ ok: boolean; data?: { items?: InboxItem[]; nextCursor?: { cursorTs?: string | null; cursorId?: string | null } | null } }>(
          `/api/harmonia/conversations?${qs.toString()}`
        )

        const items = Array.isArray(out?.data?.items) ? out.data!.items! : []
        const next = out?.data?.nextCursor ? { cursorTs: out.data!.nextCursor!.cursorTs || null, cursorId: out.data!.nextCursor!.cursorId || null } : null

        if (mode === 'reset') setInboxItems(items)
        else setInboxItems((prev) => prev.concat(items))

        setInboxCursor(next)
      } catch (e: any) {
        setInboxError(e?.message || 'Falha ao carregar inbox.')
      } finally {
        setInboxLoading(false)
      }
    },
    [apiJson, dbConfigured, inboxCursor, unitSlug]
  )

  React.useEffect(() => {
    setInboxItems([])
    setInboxCursor(null)
    setInboxError(null)
    if (!dbConfigured || !unitSlug) return
    void loadInbox('reset')
  }, [dbConfigured, loadInbox, unitSlug])

  const openConversationById = React.useCallback(
    async (id: string) => {
      const cid = String(id || '').trim()
      if (!cid) return
      setConversationLoading(true)
      setMessagesLoading(true)
      setConversationError(null)
      setActionError(null)
      setConversation(null)
      setMessages([])
      try {
        const [c, m] = await Promise.all([
          apiJson<{ ok: boolean; data?: HarmoniaConversation }>(`/api/harmonia/conversations/${encodeURIComponent(cid)}`),
          apiJson<{ ok: boolean; data?: HarmoniaMessage[]; meta?: { limit?: number; before?: string | null; hasMore?: boolean } }>(
            `/api/harmonia/conversations/${encodeURIComponent(cid)}/messages?limit=80`
          ),
        ])
        const convo = (c as any)?.data || null
        setConversation(convo)
        const list = Array.isArray((m as any)?.data) ? (m as any).data : []
        const ordered = sortMessagesByTime(list)
        setMessages(ordered)
        const hasMore = typeof (m as any)?.meta?.hasMore === 'boolean'
          ? Boolean((m as any)?.meta?.hasMore)
          : list.length >= 80
        setMessagesHasMore(hasMore)
        setMessagesCursor(ordered[0]?.created_at || null)
        setTab('conversations')
        if (convo?.id) {
          try { localStorage.setItem(UI_CONVO_KEY, String(convo.id)) } catch { /* ignore */ }
        }
      } catch (e: any) {
        setConversationError(e?.message || 'Falha ao abrir conversa.')
      } finally {
        setConversationLoading(false)
        setMessagesLoading(false)
      }
    },
    [apiJson]
  )

  const restoreConversationOnce = React.useRef(false)
  React.useEffect(() => {
    if (restoreConversationOnce.current) return
    if (!dbConfigured || !unitSlug || conversation) return
    let stored = ''
    try {
      stored = localStorage.getItem(UI_CONVO_KEY) || ''
    } catch { /* ignore */ }
    if (stored) {
      restoreConversationOnce.current = true
      void openConversationById(stored)
    }
  }, [dbConfigured, unitSlug, conversation, openConversationById])

  const findConversation = React.useCallback(async () => {
    const slug = String(unitSlug || '').trim()
    const phone = onlyDigits(phoneRaw)
    if (!slug || !phone) {
      setConversationError('Informe unidade e telefone (somente dígitos).')
      return
    }
    setConversationLoading(true)
    setMessagesLoading(true)
    setConversationError(null)
    setActionError(null)
    setConversation(null)
    setMessages([])
    try {
      const url = `/api/harmonia/conversations/find?unitSlug=${encodeURIComponent(slug)}&phoneRaw=${encodeURIComponent(phone)}&limit=80`
      const out = await apiJson<{ ok: boolean; data?: { conversation?: HarmoniaConversation; messages?: HarmoniaMessage[] }; meta?: { limit?: number; before?: string | null; hasMore?: boolean } }>(url)
      const c = out?.data?.conversation || null
      const m = Array.isArray(out?.data?.messages) ? out.data!.messages! : []
      setConversation(c)
      const ordered = sortMessagesByTime(m)
      setMessages(ordered)
      const hasMore = typeof (out as any)?.meta?.hasMore === 'boolean'
        ? Boolean((out as any)?.meta?.hasMore)
        : m.length >= 80
      setMessagesHasMore(hasMore)
      setMessagesCursor(ordered[0]?.created_at || null)
      if (!c) setConversationError('Conversa não encontrada.')
      if (c?.id) {
        try { localStorage.setItem(UI_CONVO_KEY, String(c.id)) } catch { /* ignore */ }
      }
    } catch (e: any) {
      setConversationError(e?.message || 'Falha ao buscar conversa.')
    } finally {
      setConversationLoading(false)
      setMessagesLoading(false)
    }
  }, [apiJson, phoneRaw, unitSlug])

  const loadOlderMessages = React.useCallback(async () => {
    if (!conversation?.id || !messagesCursor || messagesLoading) return
    setMessagesLoading(true)
    setActionError(null)
    try {
      const out = await apiJson<{ ok: boolean; data?: HarmoniaMessage[]; meta?: { limit?: number; before?: string | null; hasMore?: boolean } }>(
        `/api/harmonia/conversations/${encodeURIComponent(String(conversation.id))}/messages?limit=80&before=${encodeURIComponent(messagesCursor)}`
      )
      const list = Array.isArray((out as any)?.data) ? (out as any).data : []
      const ordered = sortMessagesByTime(list)
      setMessages((prev) => ordered.concat(prev))
      const hasMore = typeof (out as any)?.meta?.hasMore === 'boolean'
        ? Boolean((out as any)?.meta?.hasMore)
        : list.length >= 80
      setMessagesHasMore(hasMore)
      setMessagesCursor(ordered[0]?.created_at || messagesCursor)
    } catch (e: any) {
      setActionError(e?.message || 'Falha ao carregar mensagens anteriores.')
    } finally {
      setMessagesLoading(false)
    }
  }, [apiJson, conversation, messagesCursor, messagesLoading])
  const patchConversation = React.useCallback(
    async (patch: { stage?: string; lead_speed_class?: string }) => {
      if (!conversation?.id) return
      setActionLoading(true)
      setActionError(null)
      try {
        const out = await apiJson<{ ok: boolean; data?: HarmoniaConversation }>(`/api/harmonia/conversations/${encodeURIComponent(String(conversation.id))}/patch`, {
          method: 'POST',
          body: JSON.stringify(patch),
        })
        if ((out as any)?.data) {
          setConversation((out as any).data)
          setActionSuccess('Ação aplicada com sucesso.')
          if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current)
          actionTimerRef.current = window.setTimeout(() => setActionSuccess(null), 2500)
        }
      } catch (e: any) {
        setActionError(e?.message || 'Falha ao aplicar ação.')
      } finally {
        setActionLoading(false)
      }
    },
    [apiJson, conversation]
  )

  const renderHeader = showHeader ? (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold text-white">Leads & Tarefas</h2>
          {dbConfigured ? (
            <Badge className="bg-emerald-500/15 text-emerald-100 border border-emerald-500/20">DB OK</Badge>
          ) : (
            <Badge className="bg-amber-500/15 text-amber-100 border border-amber-500/20">DB não configurado</Badge>
          )}
          {health?.harmonia?.openAiConfigured ? (
            <Badge className="bg-indigo-500/15 text-indigo-100 border border-indigo-500/20">OpenAI</Badge>
          ) : null}
          {health?.harmonia?.googleConfigured ? (
            <Badge className="bg-sky-500/15 text-sky-100 border border-sky-500/20">Sheets</Badge>
          ) : null}
        </div>
        <p className="text-sm text-blue-100/70">
          Central de atendimento unificada (WhatsApp + Instagram DM + Omnichannel) com automações e qualificação de leads.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={refresh} disabled={loading}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </div>
    </div>
  ) : null

  const stageOptions = React.useMemo(() => {
    const set = new Set<string>()
    inboxItems.forEach((it) => {
      if (it?.stage) set.add(String(it.stage))
    })
    return Array.from(set).sort()
  }, [inboxItems])

  const filteredInboxItems = React.useMemo(() => {
    const search = inboxSearch.trim().toLowerCase()
    return inboxItems.filter((it) => {
      if (inboxStage !== 'all' && String(it.stage || '') !== inboxStage) return false
      if (!search) return true
      const haystack = [
        it.contact_display_name,
        it.contact_phone_raw,
        it.stage,
        it.last_message_text,
        it.last_message_direction,
        it.unit_name,
        it.unit_slug,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(search)
    })
  }, [inboxItems, inboxSearch, inboxStage])

  const inboxCard = (
    <Card className="bg-white/[0.06] border-white/10">
      <CardHeader>
          <CardTitle className="text-white">Inbox de Leads (WhatsApp)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {dbConfigured ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] text-blue-200/70 mb-1">Unidade</div>
                <Select value={unitSlug} onValueChange={setUnitSlug} disabled={!dbConfigured}>
                  <SelectTrigger className="bg-white/[0.06] border-white/10 text-white">
                    <SelectValue placeholder="Selecione a unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={String(u.slug || '')} value={String(u.slug || '')}>
                        {String(u.name || u.slug || '')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-[11px] text-blue-200/70 mb-1">Stage</div>
                <Select value={inboxStage} onValueChange={setInboxStage}>
                  <SelectTrigger className="bg-white/[0.06] border-white/10 text-white">
                    <SelectValue placeholder="Stage" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {stageOptions.map((st) => (
                      <SelectItem key={st} value={st}>{st}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Input
                ref={inboxSearchRef}
                value={inboxSearch}
                onChange={(e) => setInboxSearch(e.target.value)}
                placeholder="Buscar contato, telefone, mensagem..."
                className="bg-white/[0.06] border-white/10 text-white"
              />
              {inboxSearch ? (
                <Button variant="ghost" className="h-10 px-3" onClick={() => setInboxSearch('')}>
                  Limpar
                </Button>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] text-blue-200/60">
                Atalho: ⌘/Ctrl+K para buscar · ⌘/Ctrl+R para atualizar
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" className="h-8" onClick={() => loadInbox('reset')} disabled={inboxLoading || !unitSlug}>
                  {inboxLoading ? (
                    <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                  ) : (
                    'Recarregar'
                  )}
                </Button>
                <Button
                  variant="secondary"
                  className="h-8"
                  onClick={() => loadInbox('more')}
                  disabled={inboxLoading || !inboxCursor?.cursorTs || !inboxCursor?.cursorId}
                  title={!inboxCursor ? 'Carregue primeiro' : !inboxCursor.cursorTs ? 'Sem mais páginas' : 'Carregar mais'}
                >
                  Mais
                </Button>
              </div>
            </div>

            {inboxError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-100">{inboxError}</div>
            ) : null}

            {inboxLoading && !filteredInboxItems.length ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, idx) => (
                  <div key={idx} className="h-14 rounded-xl border border-white/10 bg-white/[0.04] animate-pulse" />
                ))}
              </div>
            ) : filteredInboxItems.length ? (
              <div className="max-h-[320px] overflow-auto space-y-2 pr-1">
                {filteredInboxItems.map((it) => {
                  const isActive = conversation?.id && String(conversation.id) === String(it.id)
                  return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => openConversationById(it.id)}
                    className={`w-full text-left rounded-xl border ${isActive ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-white/10 bg-black/20'} hover:bg-white/[0.06] transition-colors px-3 py-2`}
                    title="Abrir conversa"
                  >
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <div className="text-white/90 font-semibold truncate">
                        {it.contact_display_name || it.contact_phone_raw || 'Contato'}
                        {it.contact_opted_out_at ? <span className="ml-2 text-amber-200/80">(opt-out)</span> : null}
                      </div>
                      <div className="text-white/70">{fmtDateTime(it.last_activity_at || it.last_message_at || null)}</div>
                    </div>
                    <div className="mt-1 text-xs text-blue-100/70 truncate">
                      {(it.last_message_text || '').trim()
                        ? `${String(it.last_message_direction || '').toUpperCase() === 'OUTBOUND' ? 'OUT' : 'IN'}: ${it.last_message_text}`
                        : '—'}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-blue-200/60">
                      <div>stage: <span className="text-white/70">{it.stage || '—'}</span></div>
                      <div className="truncate">id: <span className="text-white/60">{it.id}</span></div>
                    </div>
                  </button>
                  )
                })}
              </div>
            ) : (
              <div className="text-xs text-blue-200/70">Sem conversas ainda (ou filtro sem resultados).</div>
            )}
          </>
        ) : (
          <div className="text-xs text-blue-200/70">Configure `DATABASE_URL` para habilitar o inbox.</div>
        )}
      </CardContent>
    </Card>
  )

  const overviewSection = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="bg-white/[0.06] border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-100/70">DB configurado</span>
              <span className="text-white">{dbConfigured ? 'sim' : 'não'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-100/70">Auto-migrate</span>
              <span className="text-white">{health?.harmonia?.autoMigrate ? 'sim' : 'não'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-100/70">Store raw</span>
              <span className="text-white">{health?.harmonia?.storeRaw ? 'sim' : 'não'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-100/70">Atualizado</span>
              <span className="text-white">{fmtDateTime(health?.ts || null)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.06] border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Units</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <StatPill label="Total" value={Array.isArray(units) ? units.length : 0} />
            <div className="text-xs text-blue-200/70">
              {units.slice(0, 6).map((u) => u?.slug).filter(Boolean).join(' · ') || '—'}
              {units.length > 6 ? '…' : ''}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/[0.06] border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Tarefas</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <StatPill label="Pending" value={stats?.byStatus?.pending ?? 0} />
            <StatPill label="Processing" value={stats?.byStatus?.processing ?? 0} />
            <StatPill label="Done" value={stats?.byStatus?.done ?? 0} />
            <StatPill label="Failed" value={stats?.byStatus?.failed ?? 0} />
            <div className="col-span-2 text-xs text-blue-200/70">
              Oldest pending: {fmtDateTime(stats?.oldestPendingAt ?? null)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white/[0.06] border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Como os leads chegam</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-100/80 space-y-2">
          <div>
            <span className="font-semibold text-white">Webhooks:</span> `POST /api/harmonia/webhook/official` (WhatsApp Official
            Module) e `POST /api/harmonia/webhook/evolution` (Evolution/Gateway).
          </div>
          <div>
            <span className="font-semibold text-white">Ingest normalizado:</span> `POST /api/harmonia/ingest`.
          </div>
          <div className="text-xs text-blue-200/70">
            Dica: no módulo de WhatsApp Oficial, use o webhook desta instância.
          </div>
        </CardContent>
      </Card>
    </div>
  )

  const tasksSection = (
    <Card className="bg-white/[0.06] border-white/10">
      <CardHeader>
        <CardTitle className="text-white">Tarefas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatPill label="Pending" value={stats?.byStatus?.pending ?? 0} />
          <StatPill label="Processing" value={stats?.byStatus?.processing ?? 0} />
          <StatPill label="Done" value={stats?.byStatus?.done ?? 0} />
          <StatPill label="Failed" value={stats?.byStatus?.failed ?? 0} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
            <div className="text-xs text-blue-200/70 mb-2">Por tipo</div>
            <div className="text-sm text-white space-y-1">
              {stats?.byType && Object.keys(stats.byType).length ? (
                Object.entries(stats.byType)
                  .sort((a, b) => (b[1] || 0) - (a[1] || 0))
                  .map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <span className="text-white/90">{k}</span>
                      <span className="text-white/70">{v}</span>
                    </div>
                  ))
              ) : (
                <div className="text-blue-100/70">—</div>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
            <div className="text-xs text-blue-200/70 mb-2">Sinais</div>
            <div className="text-sm text-white space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/90">Oldest pending</span>
                <span className="text-white/70">{fmtDateTime(stats?.oldestPendingAt ?? null)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/90">Oldest processing</span>
                <span className="text-white/70">{fmtDateTime(stats?.oldestProcessingAt ?? null)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="text-xs text-blue-200/70">
          API: `GET /api/harmonia/tasks/stats` (e manutenção via `POST /api/harmonia/maintenance/cleanup`).
        </div>
      </CardContent>
    </Card>
  )

  const conversationSearchCard = (
    <Card className="bg-white/[0.06] border-white/10">
      <CardHeader>
        <CardTitle className="text-white">Buscar conversa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-blue-200/70 mb-1">Unidade</div>
            <Select value={unitSlug} onValueChange={setUnitSlug} disabled={!dbConfigured}>
              <SelectTrigger className="bg-white/[0.06] border-white/10 text-white">
                <SelectValue placeholder="Selecione a unidade" />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={String(u.slug || '')} value={String(u.slug || '')}>
                    {String(u.name || u.slug || '')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs text-blue-200/70 mb-1">Telefone (somente dígitos)</div>
            <Input
              value={phoneRaw}
              onChange={(e) => setPhoneRaw(e.target.value)}
              placeholder="Ex: 5511999999999"
              className="bg-white/[0.06] border-white/10 text-white"
              disabled={!dbConfigured}
              inputMode="numeric"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={findConversation} disabled={!dbConfigured || conversationLoading}>
            {conversationLoading ? 'Buscando…' : 'Buscar'}
          </Button>
          <div className="text-xs text-blue-200/70">
            Também disponível via API: `GET /api/harmonia/conversations/find?unitSlug=...&phoneRaw=...`
          </div>
        </div>
        {conversationError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            {conversationError}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )

  const conversationDetailCard = conversation ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="bg-white/[0.06] border-white/10 lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-white">Conversa</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-white/10 text-white border border-white/10">
                  stage: {conversation.stage || '—'}
                </Badge>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button variant="secondary" className="h-8" onClick={() => patchConversation({ stage: 'resolved' })} disabled={actionLoading || !canExecute}>
                    Resolver
                  </Button>
                  <Button variant="outline" className="h-8" onClick={() => patchConversation({ stage: 'followup' })} disabled={actionLoading || !canExecute}>
                    Follow-up
                  </Button>
                  <Button variant="outline" className="h-8" onClick={() => patchConversation({ stage: 'handoff' })} disabled={actionLoading || !canExecute}>
                    Handoff
                  </Button>
                  <Button variant="outline" className="h-8" onClick={() => patchConversation({ stage: 'paused' })} disabled={actionLoading || !canExecute}>
                    Pausar
                  </Button>
                </div>
              </div>
              {execRequired && !canExecute ? (
                <div className="text-[11px] text-amber-200/80">
                  Informe o token de execução para habilitar ações.
                </div>
              ) : null}
              {actionSuccess ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-100">
                  {actionSuccess}
                </div>
              ) : null}
              {actionError ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-100">{actionError}</div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-blue-100/70">Contato</span>
                <span className="text-white truncate">{conversation.contact_display_name || conversation.contact_phone_raw || '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-blue-100/70">Opt-out</span>
                <span className="text-white">{conversation.opted_out_at ? 'sim' : 'não'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-blue-100/70">Últ. inbound</span>
                <span className="text-white">{fmtDateTime(conversation.last_inbound_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-blue-100/70">Últ. outbound</span>
                <span className="text-white">{fmtDateTime(conversation.last_outbound_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-blue-100/70">Procedimento</span>
                <span className="text-white">{conversation.procedure_code || '—'}</span>
              </div>
              <div className="pt-2">
                <div className="text-[11px] text-blue-200/70 mb-1">Conversation ID</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs text-white/90 bg-black/30 border border-white/10 rounded-lg px-2 py-1 overflow-hidden text-ellipsis">
                    {conversation.id || '—'}
                  </code>
                  <Button
                    variant="outline"
                    className="h-9"
                    onClick={() => {
                      const id = String(conversation.id || '')
                      if (!id) return
                      try {
                        void navigator.clipboard.writeText(id)
                      } catch { /* ignore */ }
                    }}
                    disabled={!conversation.id}
                    title="Copiar ID"
                  >
                    Copiar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/[0.06] border-white/10 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-white">Mensagens (últimas {messages.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-blue-200/70">
                  {messagesHasMore ? 'Há mensagens anteriores' : 'Fim do histórico'}
                </div>
                {messagesHasMore ? (
                  <Button variant="outline" className="h-8" onClick={loadOlderMessages} disabled={messagesLoading}>
                    {messagesLoading ? 'Carregando…' : 'Carregar anteriores'}
                  </Button>
                ) : null}
              </div>

              {messagesLoading ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, idx) => (
                    <div key={idx} className="h-20 rounded-xl border border-white/10 bg-white/[0.04] animate-pulse" />
                  ))}
                </div>
              ) : messages.length ? (
                <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
                  {messages.map((m) => {
                    const dir = String(m.direction || '')
                    const isInbound = dir === 'inbound'
                    const mediaLabel = resolveMediaLabel(m)
                    const caption = resolveMessageCaption(m)
                    return (
                      <div
                        key={String(m.id || m.provider_message_id || Math.random())}
                        className={`rounded-xl border ${isInbound ? 'border-sky-500/20 bg-sky-500/10' : 'border-emerald-500/20 bg-emerald-500/10'
                          } p-3`}
                      >
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <div className="text-white/90 font-semibold">
                            {isInbound ? 'IN' : 'OUT'} <span className="text-white/50">{m.provider_message_id ? `· ${m.provider_message_id}` : ''}</span>
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
                  })}
                </div>
              ) : (
                <div className="text-sm text-blue-100/70">Sem mensagens para exibir.</div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="bg-white/[0.04] border-white/10">
          <CardContent className="py-6 text-sm text-blue-100/70">
            {conversationLoading ? 'Carregando conversa...' : 'Selecione uma conversa no inbox para ver detalhes.'}
          </CardContent>
        </Card>
      )

  const conversationsSection = (
    <div className="space-y-4">
      {conversationSearchCard}
      {conversationDetailCard}
    </div>
  )

  const leadsCard = (
    <Card className="bg-white/[0.06] border-white/10">
      <CardHeader>
        <CardTitle className="text-white">Leads via WhatsApp</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-blue-100/80 space-y-2">
        <div>
          Este backend é o motor de decisão/executor de mensagens do WhatsApp (webhooks + `ingest`) e mantém conversas/tarefas quando
          `DATABASE_URL` está configurado.
        </div>
        <div className="text-xs text-blue-200/70">
          Webhooks: `POST /api/harmonia/webhook/official` e `POST /api/harmonia/webhook/evolution` · Ingest: `POST /api/harmonia/ingest`
        </div>
      </CardContent>
    </Card>
  )

  const tokensCard = (
    <Card className="bg-white/[0.06] border-white/10">
      <CardHeader>
        <CardTitle className="text-white">Tokens</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs text-blue-200/70 mb-1">Debug (leitura)</div>
            <Input
              value={debugToken}
              onChange={(e) => {
                setDebugToken(e.target.value)
                updateIntegrationToken('debugToken', e.target.value)
              }}
              placeholder="TOKEN_DEBUG"
              className="bg-white/[0.06] border-white/10 text-white"
              autoComplete="off"
            />
        </div>
        <div>
          <div className="text-xs text-blue-200/70 mb-1">Exec (ações)</div>
            <Input
              value={execToken}
              onChange={(e) => {
                setExecToken(e.target.value)
                updateIntegrationToken('execToken', e.target.value)
              }}
              placeholder="TOKEN_EXEC"
              className="bg-white/[0.06] border-white/10 text-white"
              autoComplete="off"
            />
        </div>
        <div className="text-[11px] text-blue-200/60">
          Tokens são opcionais quando não configurados no backend.
        </div>
      </CardContent>
    </Card>
  )

  if (mode === 'columns') {
    return (
      <div className="p-6 space-y-4">
        {renderHeader}

        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        ) : null}

        {!dbConfigured ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            O módulo de leads está ativo, mas sem persistência. Configure `DATABASE_URL` no `backend/apps/crm-api` para liberar conversas,
            units e estatísticas.
          </div>
        ) : null}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-4 space-y-4">
            {inboxCard}
            {conversationSearchCard}
          </div>
          <div className="xl:col-span-5 space-y-4">
            {conversationDetailCard}
          </div>
          <div className="xl:col-span-3 space-y-4">
            {tokensCard}
            {overviewSection}
            {tasksSection}
            {leadsCard}
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'expanded') {
    return (
      <div className="p-6 space-y-4">
        {renderHeader}

        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        ) : null}

        {!dbConfigured ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            O módulo de leads está ativo, mas sem persistência. Configure `DATABASE_URL` no `backend/apps/crm-api` para liberar conversas,
            units e estatísticas.
          </div>
        ) : null}

        {leadsCard}
        {overviewSection}
        {inboxCard}
        {conversationsSection}
        {tasksSection}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      {renderHeader}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
      ) : null}

      {!dbConfigured ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          O módulo de leads está ativo, mas sem persistência. Configure `DATABASE_URL` no `backend/apps/crm-api` para liberar conversas,
          units e estatísticas.
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          {showChannels ? <TabsTrigger value="atendimento">Atendimento</TabsTrigger> : null}
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="conversations">Conversas</TabsTrigger>
          <TabsTrigger value="tasks">Tarefas</TabsTrigger>
        </TabsList>

        {showChannels ? (
          <TabsContent value="atendimento" className="space-y-4">
          <Card className="bg-white/[0.06] border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Central de Atendimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-blue-100/80">
                Acesso rápido a todos os canais de atendimento. (Unificação em “caixa de entrada única” pode ser feita depois, integrando
                os provedores em um único feed.)
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1">
                  <div className="text-xs text-blue-200/70 mb-1">Token (opcional)</div>
                  <Input
                    value={debugToken}
                    onChange={(e) => {
                      setDebugToken(e.target.value)
                      updateIntegrationToken('debugToken', e.target.value)
                    }}
                    placeholder="TOKEN_DEBUG"
                    className="bg-white/[0.06] border-white/10 text-white"
                    autoComplete="off"
                  />
                  <div className="mt-1 text-[11px] text-blue-200/70">
                    Se o backend exigir, este token libera leitura (units/inbox/conversas/stats/cleanup).
                  </div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-blue-200/70 mb-1">Inbox de Leads (WhatsApp)</div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                    {dbConfigured ? (
                      <>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="text-[11px] text-blue-200/70">
                            Unidade: <span className="text-white/80">{unitSlug || '—'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" className="h-8" onClick={() => loadInbox('reset')} disabled={inboxLoading || !unitSlug}>
                              {inboxLoading ? (
                                <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                              ) : (
                                'Recarregar'
                              )}
                            </Button>
                            <Button
                              variant="secondary"
                              className="h-8"
                              onClick={() => loadInbox('more')}
                              disabled={inboxLoading || !inboxCursor?.cursorTs || !inboxCursor?.cursorId}
                              title={!inboxCursor ? 'Carregue primeiro' : !inboxCursor.cursorTs ? 'Sem mais páginas' : 'Carregar mais'}
                            >
                              Mais
                            </Button>
                          </div>
                        </div>

                        {inboxError ? (
                          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-100">{inboxError}</div>
                        ) : null}

                        {inboxItems.length ? (
                          <div className="max-h-[240px] overflow-auto space-y-2 pr-1">
                            {inboxItems.map((it) => (
                              <button
                                key={it.id}
                                type="button"
                                onClick={() => openConversationById(it.id)}
                                className="w-full text-left rounded-xl border border-white/10 bg-black/20 hover:bg-white/[0.06] transition-colors px-3 py-2"
                                title="Abrir conversa"
                              >
                                <div className="flex items-center justify-between gap-3 text-xs">
                                  <div className="text-white/90 font-semibold truncate">
                                    {it.contact_display_name || it.contact_phone_raw || 'Contato'}
                                    {it.contact_opted_out_at ? <span className="ml-2 text-amber-200/80">(opt-out)</span> : null}
                                  </div>
                                  <div className="text-white/70">{fmtDateTime(it.last_activity_at || it.last_message_at || null)}</div>
                                </div>
                                <div className="mt-1 text-xs text-blue-100/70 truncate">
                                  {(it.last_message_text || '').trim()
                                    ? `${String(it.last_message_direction || '').toUpperCase() === 'OUTBOUND' ? 'OUT' : 'IN'}: ${it.last_message_text}`
                                    : '—'}
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-blue-200/60">
                                  <div>stage: <span className="text-white/70">{it.stage || '—'}</span></div>
                                  <div className="truncate">id: <span className="text-white/60">{it.id}</span></div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-blue-200/70">Sem conversas ainda (ou token/DB pendente).</div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-blue-200/70">Configure `DATABASE_URL` para habilitar o inbox.</div>
                    )}
                  </div>
                </div>
              </div>

              <Tabs value={channelTab} onValueChange={(v) => setChannelTab(v as any)}>
                <TabsList className="flex flex-wrap">
                  <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
                  <TabsTrigger value="omnichannel">Omnichannel</TabsTrigger>
                </TabsList>

                <TabsContent value="whatsapp">
                  <React.Suspense
                    fallback={
                      <div className="text-sm text-blue-100/70 p-3">
                        <LoadingPercentText label="Carregando WhatsApp" showPercent={false} />
                      </div>
                    }
                  >
                    <WhatsAppUnifiedHub />
                  </React.Suspense>
                </TabsContent>

                <TabsContent value="omnichannel" className="space-y-3">
                  <React.Suspense
                    fallback={
                      <div className="text-sm text-blue-100/70 p-3">
                        <LoadingPercentText label="Carregando Omnichannel" showPercent={false} />
                      </div>
                    }
                  >
                    <OmnichannelCenter
                      activities={[] as any}
                      onStartConversation={(channel) => {
                        const c = String(channel || '').toLowerCase()
                        if (c === 'whatsapp') setChannelTab('whatsapp')
                        else setChannelTab('omnichannel')
                      }}
                    />
                  </React.Suspense>
                </TabsContent>

              </Tabs>
            </CardContent>
          </Card>

          {leadsCard}
        </TabsContent>
        ) : null}

        <TabsContent value="overview" className="space-y-4">
          {overviewSection}
        </TabsContent>

        <TabsContent value="conversations" className="space-y-4">
          {conversationsSection}
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          {tasksSection}
        </TabsContent>
      </Tabs>
    </div>
  )
}
