import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Input } from '@/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { LoadingPercentText } from '@/LoadingPattern'

const WhatsAppUnifiedHub = React.lazy(() => import('@/WhatsAppUnifiedHub').then((m) => ({ default: m.WhatsAppUnifiedHub })))
const OmnichannelCenter = React.lazy(() => import('@/OmnichannelCenter').then((m) => ({ default: m.OmnichannelCenter })))
const HelpDeskModule = React.lazy(() => import('@/HelpDeskModule').then((m) => ({ default: m.HelpDeskModule })))
const InstagramStudioPro = React.lazy(() => import('@/InstagramStudioPro').then((m) => ({ default: m.InstagramStudioPro })))

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

function StatPill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
      <div className="text-[11px] text-blue-200/70">{label}</div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  )
}

export function HarmoniaModule() {
  const [tab, setTab] = React.useState<'atendimento' | 'overview' | 'conversations' | 'tasks'>('atendimento')

  const [health, setHealth] = React.useState<HarmoniaHealth | null>(null)
  const [units, setUnits] = React.useState<HarmoniaUnit[]>([])
  const [stats, setStats] = React.useState<HarmoniaTaskStats | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const DEBUG_TOKEN_KEY = 'harmonia.debugToken'
  const [debugToken, setDebugToken] = React.useState<string>(() => {
    try {
      return localStorage.getItem(DEBUG_TOKEN_KEY) || ''
    } catch {
      return ''
    }
  })

  React.useEffect(() => {
    try {
      if (debugToken.trim()) localStorage.setItem(DEBUG_TOKEN_KEY, debugToken.trim())
      else localStorage.removeItem(DEBUG_TOKEN_KEY)
    } catch { /* ignore */ }
  }, [debugToken])

  const apiJson = React.useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const token = debugToken.trim()
      const res = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init?.body ? { 'content-type': 'application/json' } : null),
          ...(token ? { 'x-harmonia-token': token } : null),
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
    [debugToken]
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
      setError(e?.message || 'Não foi possível carregar dados do Harmonia.')
    } finally {
      setLoading(false)
    }
  }, [apiJson])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const dbConfigured = Boolean(health?.harmonia?.dbConfigured)

  const [channelTab, setChannelTab] = React.useState<'whatsapp' | 'instagram' | 'omnichannel' | 'helpdesk'>('whatsapp')

  const [unitSlug, setUnitSlug] = React.useState<string>('')
  const [phoneRaw, setPhoneRaw] = React.useState<string>('')
  const [conversationLoading, setConversationLoading] = React.useState(false)
  const [conversationError, setConversationError] = React.useState<string | null>(null)
  const [conversation, setConversation] = React.useState<HarmoniaConversation | null>(null)
  const [messages, setMessages] = React.useState<HarmoniaMessage[]>([])

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
      setConversationError(null)
      setConversation(null)
      setMessages([])
      try {
        const [c, m] = await Promise.all([
          apiJson<{ ok: boolean; data?: HarmoniaConversation }>(`/api/harmonia/conversations/${encodeURIComponent(cid)}`),
          apiJson<{ ok: boolean; data?: HarmoniaMessage[] }>(`/api/harmonia/conversations/${encodeURIComponent(cid)}/messages?limit=80`),
        ])
        setConversation((c as any)?.data || null)
        setMessages(Array.isArray((m as any)?.data) ? (m as any).data : [])
        setTab('conversations')
      } catch (e: any) {
        setConversationError(e?.message || 'Falha ao abrir conversa.')
      } finally {
        setConversationLoading(false)
      }
    },
    [apiJson]
  )

  const findConversation = React.useCallback(async () => {
    const slug = String(unitSlug || '').trim()
    const phone = onlyDigits(phoneRaw)
    if (!slug || !phone) {
      setConversationError('Informe unidade e telefone (somente dígitos).')
      return
    }
    setConversationLoading(true)
    setConversationError(null)
    setConversation(null)
    setMessages([])
    try {
      const url = `/api/harmonia/conversations/find?unitSlug=${encodeURIComponent(slug)}&phoneRaw=${encodeURIComponent(phone)}&limit=80`
      const out = await apiJson<{ ok: boolean; data?: { conversation?: HarmoniaConversation; messages?: HarmoniaMessage[] } }>(url)
      const c = out?.data?.conversation || null
      const m = Array.isArray(out?.data?.messages) ? out.data!.messages! : []
      setConversation(c)
      setMessages(m)
      if (!c) setConversationError('Conversa não encontrada.')
    } catch (e: any) {
      setConversationError(e?.message || 'Falha ao buscar conversa.')
    } finally {
      setConversationLoading(false)
    }
  }, [apiJson, phoneRaw, unitSlug])

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold text-white">Harmonia</h2>
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
            Central de atendimento unificada (WhatsApp + Instagram DM + Omnichannel + Help Desk) e automação de leads via Decision API.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={refresh} disabled={loading}>
            {loading ? 'Atualizando…' : 'Atualizar'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
      ) : null}

      {!dbConfigured ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          O Harmonia está ativo, mas sem persistência. Configure `DATABASE_URL` no `backend/apps/crm-api` para liberar conversas,
          units e estatísticas.
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="atendimento">Atendimento</TabsTrigger>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="conversations">Conversas</TabsTrigger>
          <TabsTrigger value="tasks">Tarefas</TabsTrigger>
        </TabsList>

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
                    onChange={(e) => setDebugToken(e.target.value)}
                    placeholder="HARMONIA_DEBUG_TOKEN"
                    className="bg-white/[0.06] border-white/10 text-white"
                    autoComplete="off"
                  />
                  <div className="mt-1 text-[11px] text-blue-200/70">
                    Se o backend exigir, este token libera leitura (units/inbox/conversas/stats/cleanup).
                  </div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-blue-200/70 mb-1">Inbox (Harmonia / WhatsApp Leads)</div>
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
                  <TabsTrigger value="instagram">Instagram (DM)</TabsTrigger>
                  <TabsTrigger value="omnichannel">Omnichannel</TabsTrigger>
                  <TabsTrigger value="helpdesk">Help Desk</TabsTrigger>
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

                <TabsContent value="instagram">
                  <React.Suspense
                    fallback={
                      <div className="text-sm text-blue-100/70 p-3">
                        <LoadingPercentText label="Carregando Instagram" showPercent={false} />
                      </div>
                    }
                  >
                    <InstagramStudioPro />
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

                <TabsContent value="helpdesk">
                  <React.Suspense
                    fallback={
                      <div className="text-sm text-blue-100/70 p-3">
                        <LoadingPercentText label="Carregando Help Desk" showPercent={false} />
                      </div>
                    }
                  >
                    <HelpDeskModule />
                  </React.Suspense>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card className="bg-white/[0.06] border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Harmonia (Leads via WhatsApp)</CardTitle>
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
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
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
              <CardTitle className="text-white">Como o Harmonia recebe mensagens</CardTitle>
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
                Dica: no WhatsApp Official Module, use `HARMONIA_WEBHOOK_URL=http://localhost:8099/api/harmonia/webhook/official`.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations" className="space-y-4">
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

          {conversation ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Card className="bg-white/[0.06] border-white/10 lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-white">Conversa</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-blue-100/70">Stage</span>
                    <span className="text-white">{conversation.stage || '—'}</span>
                  </div>
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
                  {messages.length ? (
                    <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
                      {messages.map((m) => {
                        const dir = String(m.direction || '')
                        const isInbound = dir === 'inbound'
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
                            <div className="mt-2 text-sm text-white whitespace-pre-wrap break-words">
                              {m.text || <span className="text-white/60">—</span>}
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
          ) : null}
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <Card className="bg-white/[0.06] border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Estatísticas</CardTitle>
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
