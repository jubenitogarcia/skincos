import React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'

type InsumosHealth = {
  ok?: boolean
  service?: string
  runtime?: string
  dbConfigured?: boolean
  sheetsConfigured?: boolean
  sheets?: {
    spreadsheetIdPresent?: boolean
    serviceAccountEmailPresent?: boolean
    privateKeyPresent?: boolean
    missing?: string[]
    hint?: string
  }
}

type InsumosUser = {
  username?: string
  displayName?: string
  name?: string
  email?: string
  role?: string
  photoUrl?: string
}

type Insumo = {
  registro?: string
  codigoBarras?: string
  categoria?: string
  marca?: string
  produto?: string
  lote?: string
  precoCusto?: number
  estoqueAtual?: number
  estoqueMinimo?: number
  dataValidade?: string | null
  statusValidade?: { status?: string; dias?: number | null }
}

type Movimentacao = {
  dataHora?: string
  tipo?: string
  codigoBarras?: string
  produto?: string
  quantidade?: number
  unidade?: string
  usuario?: string
  observacoes?: string
}

type NotificationsSummary = {
  generatedAt?: string
  unidade?: string
  counts?: { lowStock?: number; expiringSoon?: number; expiredWithStock?: number }
  lowStock?: Array<{ codigoBarras?: string; produto?: string; estoqueAtual?: number; estoqueMinimo?: number; categoria?: string }>
  expiringSoon?: Array<{ codigoBarras?: string; produto?: string; estoqueAtual?: number; dataValidade?: string; dias?: number; categoria?: string }>
  expiredWithStock?: Array<{ codigoBarras?: string; produto?: string; estoqueAtual?: number; dataValidade?: string; categoria?: string }>
}

type EstoqueResumo = {
  totalInsumos?: number
  valorEstoqueTotal?: number
  criticos?: number
}

type Actionables = {
  unidade?: string
  reposicao?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; estoqueAtual?: number; estoqueMinimo?: number; suggestedPurchaseQty?: number; estimatedValue?: number }>
  transferencias?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; from?: string; to?: string; qty?: number; estimatedValue?: number }>
  perdasValidade?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; estoqueAtual?: number; dataValidade?: string; lossValue?: number }>
  rupturas?: Array<{ codigoBarras?: string; produto?: string; categoria?: string; estoqueMinimo?: number; estimatedImpact?: number }>
}

type BackupSnapshot = {
  id?: number
  ts?: string
  actor?: string
  role?: string
  unidade?: string
  kind?: string
}

type AuditRow = {
  timestamp?: string
  actor?: string
  role?: string
  action?: string
  entity?: string
  entityId?: string
  unidade?: string
  ip?: string
  userAgent?: string
  idempotencyKey?: string
}

type ApiError = {
  error?: string
  message?: string
  success?: boolean
  code?: string
}

function fmtMoneyBRL(value: number) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
  } catch {
    return `R$ ${value.toFixed(2)}`
  }
}

function fmtDate(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('pt-BR')
}

function statusBadgeVariant(status?: string): 'default' | 'secondary' | 'destructive' {
  const s = String(status || '').toUpperCase()
  if (s === 'EXPIRADO') return 'destructive'
  if (s === 'VENCENDO') return 'secondary'
  return 'default'
}

async function apiJson<T>(
  path: string,
  opts: {
    method?: string
    body?: unknown
    csrfToken?: string | null
    signal?: AbortSignal
    retryOnCsrf?: () => Promise<string | null>
  } = {}
): Promise<T> {
  const method = opts.method || 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.csrfToken) headers['x-csrf-token'] = opts.csrfToken

  const url = path.startsWith('/api/insumos') ? path : `/api/insumos${path.startsWith('/') ? '' : '/'}${path}`
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal
  })

  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (res.ok) return json as T

  const err = (json || {}) as ApiError
  const message = err.error || err.message || `HTTP ${res.status}`

  if (res.status === 403 && String(err.code || '').toUpperCase() === 'CSRF_INVALID' && opts.retryOnCsrf) {
    const nextCsrf = await opts.retryOnCsrf()
    if (nextCsrf) {
      return apiJson<T>(path, { ...opts, csrfToken: nextCsrf, retryOnCsrf: undefined })
    }
  }

  throw new Error(message)
}

export function InsumosModule() {
  const [health, setHealth] = React.useState<InsumosHealth | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [healthLoading, setHealthLoading] = React.useState(true)

  const [unidade, setUnidade] = React.useState<'novo-hamburgo' | 'barra-shopping-sul'>('novo-hamburgo')
  const [csrfToken, setCsrfToken] = React.useState<string | null>(null)
  const [user, setUser] = React.useState<InsumosUser | null>(null)
  const [authLoading, setAuthLoading] = React.useState(true)

  const [loginUsername, setLoginUsername] = React.useState('')
  const [loginPassword, setLoginPassword] = React.useState('')

  const [activeTab, setActiveTab] = React.useState<'overview' | 'insumos' | 'mov' | 'backup' | 'audit'>('overview')

  const [quickCodigo, setQuickCodigo] = React.useState('')
  const [quickQuantidade, setQuickQuantidade] = React.useState('1')
  const [quickNovoEstoque, setQuickNovoEstoque] = React.useState('')
  const [quickObs, setQuickObs] = React.useState('')
  const [quickMotivo, setQuickMotivo] = React.useState('Ajuste manual')
  const [quickActionLoading, setQuickActionLoading] = React.useState(false)

  const [insumos, setInsumos] = React.useState<Insumo[]>([])
  const [insumosLoading, setInsumosLoading] = React.useState(false)
  const [insumosQuery, setInsumosQuery] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createCodigo, setCreateCodigo] = React.useState('')
  const [createProduto, setCreateProduto] = React.useState('')
  const [createCategoria, setCreateCategoria] = React.useState('')
  const [createMarca, setCreateMarca] = React.useState('')
  const [createTipoUnidade, setCreateTipoUnidade] = React.useState('')
  const [createPrecoCusto, setCreatePrecoCusto] = React.useState('')
  const [createEstoqueMinimo, setCreateEstoqueMinimo] = React.useState('0')
  const [createLote, setCreateLote] = React.useState('')
  const [createDataValidade, setCreateDataValidade] = React.useState('')
  const [createLoading, setCreateLoading] = React.useState(false)

  const [movimentacoes, setMovimentacoes] = React.useState<Movimentacao[]>([])
  const [movLoading, setMovLoading] = React.useState(false)
  const [movTipo, setMovTipo] = React.useState<'TODOS' | 'ENTRADA' | 'SAÍDA'>('TODOS')
  const [movDe, setMovDe] = React.useState('')
  const [movAte, setMovAte] = React.useState('')

  const [backupItems, setBackupItems] = React.useState<BackupSnapshot[]>([])
  const [backupLoading, setBackupLoading] = React.useState(false)
  const [backupRestoreId, setBackupRestoreId] = React.useState('')
  const [backupCleanupDays, setBackupCleanupDays] = React.useState('30')

  const [auditRows, setAuditRows] = React.useState<AuditRow[]>([])
  const [auditLoading, setAuditLoading] = React.useState(false)

  const [overviewLoading, setOverviewLoading] = React.useState(false)
  const [overviewResumo, setOverviewResumo] = React.useState<EstoqueResumo | null>(null)
  const [overviewNotifications, setOverviewNotifications] = React.useState<NotificationsSummary | null>(null)
  const [overviewActionables, setOverviewActionables] = React.useState<Actionables | null>(null)

  const canUseApi = !!health?.ok && !!health?.sheetsConfigured
  const isAuthed = !!user?.username

  const refreshCsrf = React.useCallback(async () => {
    try {
      const out = await apiJson<{ success?: boolean; user?: InsumosUser; csrfToken?: string }>('/auth/refresh', { method: 'POST' })
      const next = out?.csrfToken || null
      setCsrfToken(next)
      if (out?.user) setUser(out.user)
      return next
    } catch {
      setCsrfToken(null)
      setUser(null)
      return null
    }
  }, [])

  const loadHealth = React.useCallback(async () => {
    setHealthLoading(true)
    setError(null)
    try {
      const data = await apiJson<InsumosHealth>('/health')
      setHealth(data || null)
    } catch (e) {
      setHealth(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setHealthLoading(false)
    }
  }, [])

  const loadMe = React.useCallback(async () => {
    setAuthLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; user?: InsumosUser; csrfToken?: string }>('/auth/me')
      setUser(out?.user || null)
      setCsrfToken(out?.csrfToken || null)
    } catch {
      setUser(null)
      setCsrfToken(null)
    } finally {
      setAuthLoading(false)
    }
  }, [])

  const login = React.useCallback(async () => {
    try {
      const out = await apiJson<{ success?: boolean; user?: InsumosUser; csrfToken?: string }>('/auth/login', {
        method: 'POST',
        body: { username: loginUsername.trim(), password: loginPassword }
      })
      setUser(out?.user || null)
      setCsrfToken(out?.csrfToken || null)
      setLoginPassword('')
      toast.success('Conectado ao Insumos')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [loginPassword, loginUsername])

  const logout = React.useCallback(async () => {
    try {
      await apiJson('/auth/logout', { method: 'POST' })
    } catch {
      // ignore
    } finally {
      setUser(null)
      setCsrfToken(null)
    }
  }, [])

  const loadInsumos = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setInsumosLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; data?: Insumo[] }>(`/insumos?unidade=${encodeURIComponent(unidade)}`)
      setInsumos(Array.isArray(out?.data) ? out.data : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setInsumos([])
    } finally {
      setInsumosLoading(false)
    }
  }, [canUseApi, isAuthed, unidade])

  const loadMovimentacoes = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setMovLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('unidade', unidade)
      params.set('limite', '200')
      if (movTipo !== 'TODOS') params.set('tipo', movTipo)
      if (movDe) params.set('de', movDe)
      if (movAte) params.set('ate', movAte)
      const out = await apiJson<{ success?: boolean; data?: Movimentacao[] }>(`/movimentacoes?${params.toString()}`)
      setMovimentacoes(Array.isArray(out?.data) ? out.data : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setMovimentacoes([])
    } finally {
      setMovLoading(false)
    }
  }, [canUseApi, isAuthed, movAte, movDe, movTipo, unidade])

  const loadBackups = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setBackupLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; data?: BackupSnapshot[] }>(`/backup/list?limit=20&unidade=${encodeURIComponent(unidade)}`)
      setBackupItems(Array.isArray(out?.data) ? out.data : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setBackupItems([])
    } finally {
      setBackupLoading(false)
    }
  }, [canUseApi, isAuthed, unidade])

  const loadAudit = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setAuditLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; data?: AuditRow[] }>(`/audit?limit=200&unidade=${encodeURIComponent(unidade)}`)
      setAuditRows(Array.isArray(out?.data) ? out.data : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setAuditRows([])
    } finally {
      setAuditLoading(false)
    }
  }, [canUseApi, isAuthed, unidade])

  const loadOverview = React.useCallback(async () => {
    if (!canUseApi || !isAuthed) return
    setOverviewLoading(true)
    try {
      const params = `unidade=${encodeURIComponent(unidade)}`
      const [estoque, notif, act] = await Promise.all([
        apiJson<{ success?: boolean; data?: { resumo?: EstoqueResumo } }>(`/relatorios/estoque?${params}`),
        apiJson<{ success?: boolean; data?: NotificationsSummary }>(`/notifications/summary?${params}`),
        apiJson<{ success?: boolean; data?: Actionables }>(`/analytics/actionables?${params}`)
      ])
      setOverviewResumo(estoque?.data?.resumo || null)
      setOverviewNotifications(notif?.data || null)
      setOverviewActionables(act?.data || null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setOverviewResumo(null)
      setOverviewNotifications(null)
      setOverviewActionables(null)
    } finally {
      setOverviewLoading(false)
    }
  }, [canUseApi, isAuthed, unidade])

  const runQuickAction = React.useCallback(
    async (kind: 'ENTRADA' | 'BAIXA' | 'AJUSTE') => {
      if (!canUseApi || !isAuthed) return
      const codigoBarras = quickCodigo.trim()
      if (!codigoBarras) return toast.error('Informe o código de barras')

      setQuickActionLoading(true)
      try {
        if (kind === 'AJUSTE') {
          const novoEstoque = Number.isFinite(Number(quickNovoEstoque)) ? Number(quickNovoEstoque) : null
          if (novoEstoque === null) return toast.error('Informe o novo estoque')
          await apiJson('/insumos/ajuste', {
            method: 'POST',
            body: { codigoBarras, novoEstoque, motivo: quickMotivo, observacoes: quickObs },
            csrfToken,
            retryOnCsrf: refreshCsrf
          })
          toast.success('Ajuste registrado')
        } else {
          const quantidade = Math.max(1, parseInt(quickQuantidade, 10) || 0)
          const path = kind === 'ENTRADA' ? '/insumos/entrada' : '/insumos/baixa'
          await apiJson(path, {
            method: 'POST',
            body: { codigoBarras, quantidade, observacoes: quickObs },
            csrfToken,
            retryOnCsrf: refreshCsrf
          })
          toast.success(kind === 'ENTRADA' ? 'Entrada registrada' : 'Baixa registrada')
        }

        await Promise.allSettled([loadInsumos(), loadMovimentacoes()])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        setQuickActionLoading(false)
      }
    },
    [
      canUseApi,
      csrfToken,
      isAuthed,
      loadInsumos,
      loadMovimentacoes,
      quickCodigo,
      quickMotivo,
      quickNovoEstoque,
      quickObs,
      quickQuantidade,
      refreshCsrf
    ]
  )

  React.useEffect(() => {
    void loadHealth()
    void loadMe()
  }, [loadHealth, loadMe])

  React.useEffect(() => {
    if (!canUseApi || !isAuthed) return
    if (activeTab === 'overview') void loadOverview()
    if (activeTab === 'insumos') void loadInsumos()
    if (activeTab === 'mov') void loadMovimentacoes()
    if (activeTab === 'backup') void loadBackups()
    if (activeTab === 'audit') void loadAudit()
  }, [activeTab, canUseApi, isAuthed, loadAudit, loadBackups, loadInsumos, loadMovimentacoes, loadOverview])

  const filteredInsumos = React.useMemo(() => {
    const q = insumosQuery.trim().toLowerCase()
    if (!q) return insumos
    return insumos.filter((i) => {
      const hay = [i.codigoBarras, i.produto, i.categoria, i.marca, i.lote]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [insumos, insumosQuery])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Insumos</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-blue-200/80">
            <span>API</span>
            <span className="font-mono">/api/insumos/*</span>
            {health?.ok ? <Badge variant={health.ok ? 'default' : 'destructive'}>{health.ok ? 'Online' : 'Offline'}</Badge> : null}
            {isAuthed ? <Badge variant="default">Autenticado</Badge> : <Badge variant="secondary">Desconectado</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={unidade} onValueChange={(v) => setUnidade(v as any)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="novo-hamburgo">Unidade: Novo Hamburgo</SelectItem>
              <SelectItem value="barra-shopping-sul">Unidade: Barra Shopping Sul</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={loadHealth} disabled={healthLoading}>
            {healthLoading ? 'Atualizando…' : 'Atualizar'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="glass-morphism border border-white/10 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-white">Conexão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {error ? (
              <div className="text-red-200">
                Erro ao consultar <span className="font-mono">/api/insumos/health</span>: {error}
              </div>
            ) : health ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={health.ok ? 'default' : 'destructive'}>{health.ok ? 'OK' : 'NOK'}</Badge>
                  <span className="text-sm text-blue-100/80">
                    {health.service || 'insumos'} • {health.runtime || 'worker'}
                  </span>
                  <Badge variant={health.dbConfigured ? 'default' : 'secondary'}>D1: {health.dbConfigured ? 'on' : 'off'}</Badge>
                  <Badge variant={health.sheetsConfigured ? 'default' : 'secondary'}>Sheets: {health.sheetsConfigured ? 'on' : 'off'}</Badge>
                </div>

                {!health.sheetsConfigured && health.sheets?.missing?.length ? (
                  <div className="text-sm text-blue-100/70">
                    Para habilitar: configure <span className="font-mono">{health.sheets.missing.join(', ')}</span> no Worker.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-blue-100/70">{healthLoading ? 'Carregando…' : 'Sem dados.'}</div>
            )}

            <div className="border-t border-white/10 pt-3">
              {authLoading ? (
                <div className="text-blue-100/70">Verificando sessão…</div>
              ) : canUseApi ? (
                isAuthed ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-blue-100/80">
                      Conectado como <span className="font-mono">{user?.username}</span> • <span className="font-mono">{user?.role}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" onClick={loadMe}>
                        Atualizar sessão
                      </Button>
                      <Button variant="destructive" onClick={logout}>
                        Sair
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Usuário</div>
                      <Input value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} placeholder="usuario" />
                    </div>
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Senha</div>
                      <Input value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="••••••••" type="password" />
                    </div>
                    <Button onClick={login} disabled={!loginUsername.trim() || !loginPassword}>
                      Entrar
                    </Button>
                  </div>
                )
              ) : (
                <div className="text-sm text-blue-100/70">Módulo indisponível: integração Sheets não configurada no Worker.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-morphism border border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Ações rápidas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Código de barras</div>
                <Input value={quickCodigo} onChange={(e) => setQuickCodigo(e.target.value)} placeholder="ex: 789..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-blue-200/70 mb-1">Quantidade</div>
                  <Input value={quickQuantidade} onChange={(e) => setQuickQuantidade(e.target.value)} type="number" min={1} />
                </div>
                <div>
                  <div className="text-xs text-blue-200/70 mb-1">Novo estoque</div>
                  <Input value={quickNovoEstoque} onChange={(e) => setQuickNovoEstoque(e.target.value)} type="number" placeholder="(somente ajuste)" />
                </div>
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Motivo (ajuste)</div>
                <Input value={quickMotivo} onChange={(e) => setQuickMotivo(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-blue-200/70 mb-1">Observações</div>
                <Input value={quickObs} onChange={(e) => setQuickObs(e.target.value)} placeholder="opcional" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button onClick={() => runQuickAction('ENTRADA')} disabled={quickActionLoading || !isAuthed}>
                Entrada
              </Button>
              <Button variant="secondary" onClick={() => runQuickAction('BAIXA')} disabled={quickActionLoading || !isAuthed}>
                Baixa
              </Button>
              <Button variant="outline" onClick={() => runQuickAction('AJUSTE')} disabled={quickActionLoading || !isAuthed}>
                Ajuste
              </Button>
            </div>

            <div className="text-xs text-blue-200/60">
              Export:{' '}
              <a className="underline" href={`/api/insumos/export/insumos.csv?unidade=${encodeURIComponent(unidade)}`} target="_blank" rel="noreferrer">
                insumos.csv
              </a>{' '}
              •{' '}
              <a
                className="underline"
                href={`/api/insumos/export/movimentacoes.csv?unidade=${encodeURIComponent(unidade)}`}
                target="_blank"
                rel="noreferrer"
              >
                movimentacoes.csv
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-morphism border border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Operação</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList className="bg-black/20">
              <TabsTrigger value="overview">Visão geral</TabsTrigger>
              <TabsTrigger value="insumos">Insumos</TabsTrigger>
              <TabsTrigger value="mov">Movimentações</TabsTrigger>
              <TabsTrigger value="backup">Backup</TabsTrigger>
              <TabsTrigger value="audit">Auditoria</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-blue-100/70">
                  Painel rápido para decisão: alertas, pontos críticos e próximas ações.
                </div>
                <Button variant="secondary" onClick={loadOverview} disabled={overviewLoading || !isAuthed}>
                  {overviewLoading ? 'Carregando…' : 'Recarregar'}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Estoque</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <div className="text-sm text-blue-100/80">Itens: <span className="font-mono">{overviewResumo?.totalInsumos ?? '-'}</span></div>
                    <div className="text-sm text-blue-100/80">Críticos: <span className="font-mono">{overviewResumo?.criticos ?? '-'}</span></div>
                    <div className="text-sm text-blue-100/80">Valor: <span className="font-mono">{overviewResumo?.valorEstoqueTotal != null ? fmtMoneyBRL(Number(overviewResumo.valorEstoqueTotal) || 0) : '-'}</span></div>
                  </CardContent>
                </Card>

                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Alertas</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <div className="text-sm text-blue-100/80">Estoque baixo: <span className="font-mono">{overviewNotifications?.counts?.lowStock ?? '-'}</span></div>
                    <div className="text-sm text-blue-100/80">Vencendo: <span className="font-mono">{overviewNotifications?.counts?.expiringSoon ?? '-'}</span></div>
                    <div className="text-sm text-blue-100/80">Expirado c/ estoque: <span className="font-mono">{overviewNotifications?.counts?.expiredWithStock ?? '-'}</span></div>
                  </CardContent>
                </Card>

                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Reposição</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(overviewActionables?.reposicao || []).slice(0, 5).map((r) => (
                      <div key={String(r.codigoBarras)} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm text-blue-50 truncate">{r.produto || '-'}</div>
                          <div className="text-xs text-blue-200/60 font-mono truncate">{r.codigoBarras || ''}</div>
                        </div>
                        <div className="text-xs text-blue-100/70 text-right">
                          <div>+{r.suggestedPurchaseQty ?? '-'}</div>
                          <div>{r.estimatedValue != null ? fmtMoneyBRL(Number(r.estimatedValue) || 0) : ''}</div>
                        </div>
                      </div>
                    ))}
                    {!overviewActionables?.reposicao?.length ? (
                      <div className="text-sm text-blue-100/70">
                        {overviewLoading ? 'Carregando…' : isAuthed ? 'Sem recomendações.' : 'Faça login para carregar.'}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="insumos" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={insumosQuery}
                    onChange={(e) => setInsumosQuery(e.target.value)}
                    placeholder="Buscar por código, produto, categoria…"
                    className="w-80"
                  />
                  <Button variant="secondary" onClick={loadInsumos} disabled={insumosLoading || !isAuthed}>
                    {insumosLoading ? 'Carregando…' : 'Recarregar'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setCreateOpen((v) => !v)}
                    disabled={!isAuthed}
                  >
                    {createOpen ? 'Fechar' : 'Adicionar'}
                  </Button>
                </div>
                <div className="text-xs text-blue-200/60">{filteredInsumos.length} itens</div>
              </div>

              {createOpen ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
                  <div className="text-sm text-blue-100/70">
                    Cadastro rápido (campos mínimos). Depois você pode ajustar detalhes direto na planilha/integração.
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Código de barras</div>
                      <Input value={createCodigo} onChange={(e) => setCreateCodigo(e.target.value)} placeholder="789..." />
                    </div>
                    <div className="md:col-span-2">
                      <div className="text-xs text-blue-200/70 mb-1">Produto</div>
                      <Input value={createProduto} onChange={(e) => setCreateProduto(e.target.value)} placeholder="Nome do produto" />
                    </div>
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Categoria</div>
                      <Input value={createCategoria} onChange={(e) => setCreateCategoria(e.target.value)} placeholder="ex: Anestésicos" />
                    </div>
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Marca</div>
                      <Input value={createMarca} onChange={(e) => setCreateMarca(e.target.value)} placeholder="ex: Marca X" />
                    </div>
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Unidade (medida)</div>
                      <Input value={createTipoUnidade} onChange={(e) => setCreateTipoUnidade(e.target.value)} placeholder="ex: Frasco" />
                    </div>
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Preço custo</div>
                      <Input value={createPrecoCusto} onChange={(e) => setCreatePrecoCusto(e.target.value)} placeholder="R$ 0,00" />
                    </div>
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Estoque mínimo</div>
                      <Input value={createEstoqueMinimo} onChange={(e) => setCreateEstoqueMinimo(e.target.value)} type="number" min={0} />
                    </div>
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Lote</div>
                      <Input value={createLote} onChange={(e) => setCreateLote(e.target.value)} placeholder="opcional" />
                    </div>
                    <div>
                      <div className="text-xs text-blue-200/70 mb-1">Data validade</div>
                      <Input value={createDataValidade} onChange={(e) => setCreateDataValidade(e.target.value)} placeholder="YYYY-MM-DD" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-blue-200/60">
                      Dica: para listar nas unidades, a planilha precisa ter colunas da unidade e estoque inicial.
                    </div>
                    <Button
                      onClick={async () => {
                        const codigoBarras = createCodigo.trim()
                        if (!codigoBarras) return toast.error('Informe o código de barras')
                        const produto = createProduto.trim()
                        if (!produto) return toast.error('Informe o produto')

                        setCreateLoading(true)
                        try {
                          await apiJson('/insumos', {
                            method: 'POST',
                            body: {
                              codigoBarras,
                              produto,
                              categoria: createCategoria.trim(),
                              marca: createMarca.trim(),
                              tipoUnidade: createTipoUnidade.trim(),
                              precoCusto: createPrecoCusto.trim(),
                              estoqueMinimo: Number(createEstoqueMinimo) || 0,
                              lote: createLote.trim(),
                              dataValidade: createDataValidade.trim()
                            },
                            csrfToken,
                            retryOnCsrf: refreshCsrf
                          })
                          toast.success('Insumo cadastrado')
                          setCreateCodigo('')
                          setCreateProduto('')
                          setCreateCategoria('')
                          setCreateMarca('')
                          setCreateTipoUnidade('')
                          setCreatePrecoCusto('')
                          setCreateEstoqueMinimo('0')
                          setCreateLote('')
                          setCreateDataValidade('')
                          setCreateOpen(false)
                          await loadInsumos()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : String(e))
                        } finally {
                          setCreateLoading(false)
                        }
                      }}
                      disabled={createLoading || !isAuthed}
                    >
                      {createLoading ? 'Salvando…' : 'Salvar'}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="overflow-auto rounded-xl border border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/30 text-blue-100/80">
                    <tr>
                      <th className="text-left p-3">Produto</th>
                      <th className="text-left p-3">Categoria</th>
                      <th className="text-left p-3">Código</th>
                      <th className="text-right p-3">Estoque</th>
                      <th className="text-right p-3">Mínimo</th>
                      <th className="text-left p-3">Validade</th>
                      <th className="text-right p-3">Valor</th>
                      <th className="text-right p-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredInsumos.map((i) => {
                      const status = i.statusValidade?.status || 'OK'
                      const estoque = Number(i.estoqueAtual) || 0
                      const min = Number(i.estoqueMinimo) || 0
                      const critico = min > 0 && estoque <= min
                      const valor = (Number(i.precoCusto) || 0) * estoque

                      return (
                        <tr key={`${i.registro || ''}-${i.codigoBarras || ''}`} className="hover:bg-white/5">
                          <td className="p-3">
                            <div className="text-blue-50">{i.produto || '-'}</div>
                            <div className="text-xs text-blue-200/60">{i.marca || ''}</div>
                          </td>
                          <td className="p-3 text-blue-100/80">{i.categoria || '-'}</td>
                          <td className="p-3">
                            <div className="font-mono text-blue-100/80">{i.codigoBarras || '-'}</div>
                            {i.codigoBarras ? (
                              <a
                                className="text-xs underline text-blue-200/70"
                                href={`/api/insumos/insumos/${encodeURIComponent(i.codigoBarras)}/qr`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                QR
                              </a>
                            ) : null}
                          </td>
                          <td className={`p-3 text-right ${critico ? 'text-red-200' : 'text-blue-100/80'}`}>{estoque}</td>
                          <td className="p-3 text-right text-blue-100/70">{min || '-'}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
                              <span className="text-blue-100/70">{fmtDate(i.dataValidade || '')}</span>
                            </div>
                          </td>
                          <td className="p-3 text-right text-blue-100/80">{fmtMoneyBRL(valor)}</td>
                          <td className="p-3 text-right">
                            <Button
                              variant="secondary"
                              className="h-8 px-2 text-xs"
                              onClick={() => {
                                if (i.codigoBarras) setQuickCodigo(i.codigoBarras)
                              }}
                            >
                              Usar
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                    {!filteredInsumos.length ? (
                      <tr>
                        <td className="p-3 text-blue-100/70" colSpan={8}>
                          {insumosLoading ? 'Carregando…' : isAuthed ? 'Sem itens.' : 'Faça login para carregar.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="mov" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-48">
                  <div className="text-xs text-blue-200/70 mb-1">Tipo</div>
                  <Select value={movTipo} onValueChange={(v) => setMovTipo(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">Todos</SelectItem>
                      <SelectItem value="ENTRADA">Entrada</SelectItem>
                      <SelectItem value="SAÍDA">Saída</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-48">
                  <div className="text-xs text-blue-200/70 mb-1">De</div>
                  <Input value={movDe} onChange={(e) => setMovDe(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
                <div className="w-48">
                  <div className="text-xs text-blue-200/70 mb-1">Até</div>
                  <Input value={movAte} onChange={(e) => setMovAte(e.target.value)} placeholder="YYYY-MM-DD" />
                </div>
                <Button variant="secondary" onClick={loadMovimentacoes} disabled={movLoading || !isAuthed}>
                  {movLoading ? 'Carregando…' : 'Filtrar'}
                </Button>
              </div>

              <div className="overflow-auto rounded-xl border border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/30 text-blue-100/80">
                    <tr>
                      <th className="text-left p-3">Data</th>
                      <th className="text-left p-3">Tipo</th>
                      <th className="text-left p-3">Produto</th>
                      <th className="text-left p-3">Código</th>
                      <th className="text-right p-3">Qtd</th>
                      <th className="text-left p-3">Usuário</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {movimentacoes.map((m, idx) => (
                      <tr key={`${m.dataHora || ''}-${idx}`} className="hover:bg-white/5">
                        <td className="p-3 text-blue-100/70">{fmtDate(m.dataHora)}</td>
                        <td className="p-3 text-blue-100/80">{m.tipo || '-'}</td>
                        <td className="p-3 text-blue-50">{m.produto || '-'}</td>
                        <td className="p-3 font-mono text-blue-100/70">{m.codigoBarras || '-'}</td>
                        <td className="p-3 text-right text-blue-100/80">{m.quantidade ?? '-'}</td>
                        <td className="p-3 text-blue-100/70">{m.usuario || '-'}</td>
                      </tr>
                    ))}
                    {!movimentacoes.length ? (
                      <tr>
                        <td className="p-3 text-blue-100/70" colSpan={6}>
                          {movLoading ? 'Carregando…' : isAuthed ? 'Sem movimentações.' : 'Faça login para carregar.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="backup" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-blue-100/70">Backup snapshot (D1) + restauração de Sheets (somente perfis autorizados).</div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={async () => {
                      if (!isAuthed) return
                      try {
                        await apiJson(`/backup/trigger?unidade=${encodeURIComponent(unidade)}`, {
                          method: 'POST',
                          csrfToken,
                          retryOnCsrf: refreshCsrf
                        })
                        toast.success('Backup disparado')
                        await loadBackups()
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e))
                      }
                    }}
                    disabled={backupLoading || !isAuthed}
                  >
                    Disparar backup
                  </Button>
                  <Button variant="secondary" onClick={loadBackups} disabled={backupLoading || !isAuthed}>
                    {backupLoading ? 'Carregando…' : 'Recarregar'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Restaurar</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-xs text-blue-200/60">
                      Confirmação obrigatória: envia <span className="font-mono">{`{"confirm":"RESTORE"}`}</span>.
                    </div>
                    <Input value={backupRestoreId} onChange={(e) => setBackupRestoreId(e.target.value)} placeholder="backup id" />
                    <Button
                      variant="destructive"
                      onClick={async () => {
                        if (!backupRestoreId.trim()) return toast.error('Informe o id')
                        try {
                          await apiJson('/backup/restore', {
                            method: 'POST',
                            body: { id: Number(backupRestoreId), confirm: 'RESTORE' },
                            csrfToken,
                            retryOnCsrf: refreshCsrf
                          })
                          toast.success('Restore concluído')
                          await Promise.allSettled([loadBackups(), loadInsumos(), loadMovimentacoes()])
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : String(e))
                        }
                      }}
                      disabled={!isAuthed}
                    >
                      Restaurar
                    </Button>
                  </CardContent>
                </Card>

                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-base">Limpeza</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-xs text-blue-200/60">Remove snapshots antigos mantendo N dias.</div>
                    <Input value={backupCleanupDays} onChange={(e) => setBackupCleanupDays(e.target.value)} type="number" />
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await apiJson('/backup/cleanup', {
                            method: 'POST',
                            body: { daysToKeep: Number(backupCleanupDays) || 30 },
                            csrfToken,
                            retryOnCsrf: refreshCsrf
                          })
                          toast.success('Limpeza executada')
                          await loadBackups()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : String(e))
                        }
                      }}
                      disabled={!isAuthed}
                    >
                      Limpar
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div className="overflow-auto rounded-xl border border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/30 text-blue-100/80">
                    <tr>
                      <th className="text-left p-3">ID</th>
                      <th className="text-left p-3">Data</th>
                      <th className="text-left p-3">Unidade</th>
                      <th className="text-left p-3">Autor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {backupItems.map((b) => (
                      <tr key={String(b.id)} className="hover:bg-white/5">
                        <td className="p-3 font-mono text-blue-100/80">{b.id}</td>
                        <td className="p-3 text-blue-100/70">{fmtDate(b.ts)}</td>
                        <td className="p-3 text-blue-100/70">{b.unidade || '-'}</td>
                        <td className="p-3 text-blue-100/70">{b.actor || '-'}</td>
                      </tr>
                    ))}
                    {!backupItems.length ? (
                      <tr>
                        <td className="p-3 text-blue-100/70" colSpan={4}>
                          {backupLoading ? 'Carregando…' : isAuthed ? 'Sem backups.' : 'Faça login para carregar.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="audit" className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-blue-100/70">Logs operacionais (preferência D1; fallback Sheets).</div>
                <Button variant="secondary" onClick={loadAudit} disabled={auditLoading || !isAuthed}>
                  {auditLoading ? 'Carregando…' : 'Recarregar'}
                </Button>
              </div>

              <div className="overflow-auto rounded-xl border border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/30 text-blue-100/80">
                    <tr>
                      <th className="text-left p-3">Data</th>
                      <th className="text-left p-3">Ação</th>
                      <th className="text-left p-3">Entidade</th>
                      <th className="text-left p-3">ID</th>
                      <th className="text-left p-3">Autor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {auditRows.map((a, idx) => (
                      <tr key={`${a.timestamp || ''}-${idx}`} className="hover:bg-white/5">
                        <td className="p-3 text-blue-100/70">{fmtDate(a.timestamp)}</td>
                        <td className="p-3 text-blue-100/80">{a.action || '-'}</td>
                        <td className="p-3 text-blue-100/70">{a.entity || '-'}</td>
                        <td className="p-3 font-mono text-blue-100/70">{a.entityId || '-'}</td>
                        <td className="p-3 text-blue-100/70">{a.actor || '-'}</td>
                      </tr>
                    ))}
                    {!auditRows.length ? (
                      <tr>
                        <td className="p-3 text-blue-100/70" colSpan={5}>
                          {auditLoading ? 'Carregando…' : isAuthed ? 'Sem logs.' : 'Faça login para carregar.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
