import React from 'react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Switch } from '@/switch'
import { DEFAULT_UNIT_OPTIONS, useGlobalUnitSelection } from '@/unitSelection'
import { LoadingPercentButton, LoadingPercentText } from '@/LoadingPattern'
import { getCsrfToken } from '@/csrf'

type StatusKind = 'ok' | 'warn' | 'error' | 'unknown'

function badgeVariant(kind: StatusKind): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (kind === 'ok') return 'success'
  if (kind === 'warn') return 'warning'
  if (kind === 'error') return 'destructive'
  return 'secondary'
}

function formatUnitLabel(u: string) {
  return String(u || '')
    .split('-')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

type ServiceRow = {
  key: string
  title: string
  status: StatusKind
  subtitle?: string
}

type ApiError = {
  error?: string
  message?: string
  code?: string
}

type InsumosMe = {
  user?: { username?: string; role?: string }
  csrfToken?: string
}

type UnitMonitorStreamingStatus = {
  ok?: boolean
  running?: boolean
  startedAt?: string | null
  lastError?: string | null
  streams?: Array<{ unit?: string; cameraId?: string }>
}

type BackupSnapshot = {
  id?: number
  ts?: string
  actor?: string
  role?: string
  unidade?: string
  kind?: string
}

type BackupStatus = {
  db?: boolean
  lastBackupTs?: string | null
  r2?: boolean
}

type AuditRow = {
  timestamp?: string
  actor?: string
  role?: string
  action?: string
  entity?: string
  entityId?: string
  unidade?: string
}

type AdminUser = {
  username: string
  displayName?: string
  email?: string
  role?: string
  photoUrl?: string
  allowedUnits?: string[]
  allowedModules?: string[]
  ativo?: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

async function apiJson<T>(
  path: string,
  opts: {
    method?: string
    body?: unknown
    csrfToken?: string | null
    signal?: AbortSignal
  } = {}
): Promise<T> {
  const method = opts.method || 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const effectiveCsrfToken = getCsrfToken() || opts.csrfToken || null
  if (effectiveCsrfToken) headers['x-csrf-token'] = effectiveCsrfToken

  let url = ''
  if (path.startsWith('/api/')) {
    url = path
  } else if (path === '/auth' || path.startsWith('/auth/')) {
    const rest = path.slice('/auth'.length) || '/'
    url = `/api/auth${rest.startsWith('/') ? '' : '/'}${rest}`
  } else {
    url = `/api/crm${path.startsWith('/') ? '' : '/'}${path}`
  }
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
  throw new Error(err.error || err.message || `HTTP ${res.status}`)
}

export function SystemStatusModule() {
  const { effectiveUnit } = useGlobalUnitSelection(DEFAULT_UNIT_OPTIONS)
  const unitMonitorUnitKey = effectiveUnit
  const insumosUnit = effectiveUnit
  const [insumosMe, setInsumosMe] = React.useState<InsumosMe | null>(null)
  const [loadingProgress, setLoadingProgress] = React.useState(0)
  const loadingStartedAtRef = React.useRef<number | null>(null)

  const [rows, setRows] = React.useState<ServiceRow[]>([
    { key: 'insumos-api', title: 'Insumos', status: 'unknown', subtitle: 'API' },
    { key: 'insumos-session', title: 'Insumos', status: 'unknown', subtitle: 'Sessão' },
    { key: 'unit-monitor-api', title: 'Unit Monitor', status: 'unknown', subtitle: 'API' }
  ])
  const [loading, setLoading] = React.useState(false)
  const [updatedAt, setUpdatedAt] = React.useState<string>('')

  const hasInsumosSession = Boolean(insumosMe?.user?.username)
  const insumosRole = String(insumosMe?.user?.role || '').toUpperCase()
  const canManageBackups = hasInsumosSession && insumosRole === 'GESTOR'

  const [backupLoading, setBackupLoading] = React.useState(false)
  const [backupStatus, setBackupStatus] = React.useState<BackupStatus | null>(null)
  const [backupItems, setBackupItems] = React.useState<BackupSnapshot[]>([])
  const [backupRestoreId, setBackupRestoreId] = React.useState('')
  const [backupCleanupDays, setBackupCleanupDays] = React.useState('30')
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [adminOpen, setAdminOpen] = React.useState(false)
  const [auditLoading, setAuditLoading] = React.useState(false)
  const [auditRows, setAuditRows] = React.useState<AuditRow[]>([])
  const [debugUi, setDebugUi] = React.useState(false)

  React.useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      setDebugUi(window.localStorage.getItem('skincos.debug') === '1')
    } catch {
      setDebugUi(false)
    }
  }, [])

  const refreshMe = React.useCallback(async () => {
    try {
      const out = await apiJson<InsumosMe>('/auth/me')
      setInsumosMe(out || null)
      return out?.csrfToken || null
    } catch {
      setInsumosMe(null)
      return null
    }
  }, [])

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const [insHealth, insMe, umStreaming] = await Promise.allSettled([
        fetch('/api/insumos/health', { credentials: 'include' }).then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => null) })),
        fetch('/api/auth/me', { credentials: 'include' }).then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => null) })),
        fetch(`/api/unit-monitor/streaming/status`, { credentials: 'include' }).then(async (r) => ({
          ok: r.ok,
          json: await r.json().catch(() => null)
        }))
      ])

      const next: ServiceRow[] = []

      if (insHealth.status === 'fulfilled') {
        const healthJson = (insHealth.value.json || {}) as any
        const online = Boolean(insHealth.value.ok)
        const storage = String(healthJson?.storage || '').toLowerCase() || '—'
        const lockedToD1 = storage === 'd1'
        const ready =
          typeof healthJson?.ready === 'boolean'
            ? healthJson.ready
            : (typeof healthJson?.dbConfigured === 'boolean' ? healthJson.dbConfigured : Boolean(healthJson?.ok))
        const status = online ? (ready ? (lockedToD1 ? 'ok' : 'warn') : 'warn') : 'error'
        const subtitle = online
          ? (ready ? `Online • ${storage.toUpperCase()}` : `Online • ${storage.toUpperCase()} • Indisponível`)
          : 'Offline'
        next.push({
          key: 'insumos-api',
          title: 'Insumos',
          status,
          subtitle
        })
      } else {
        next.push({ key: 'insumos-api', title: 'Insumos', status: 'error', subtitle: 'Erro ao consultar' })
      }

      if (insMe.status === 'fulfilled') {
        const hasSession = insMe.value.ok && Boolean(insMe.value.json?.user?.username)
        setInsumosMe(insMe.value.ok ? (insMe.value.json as InsumosMe) : null)
        next.push({
          key: 'insumos-session',
          title: 'Insumos',
          status: hasSession ? 'ok' : 'warn',
          subtitle: hasSession ? 'Sessão ativa' : 'Sessão ausente'
        })
      } else {
        setInsumosMe(null)
        next.push({ key: 'insumos-session', title: 'Insumos', status: 'error', subtitle: 'Erro ao consultar' })
      }

      if (umStreaming.status === 'fulfilled') {
        const ok = umStreaming.value.ok
        const json = (umStreaming.value.json || {}) as UnitMonitorStreamingStatus
        const running = ok && Boolean(json?.running)
        const lastError = typeof json?.lastError === 'string' ? json.lastError : null
        const streams = Array.isArray(json?.streams) ? json.streams : []
        const camsForUnit = streams.filter((s) => String(s?.unit || '') === String(unitMonitorUnitKey)).length
        const subtitle = ok
          ? (running
            ? `Online • Gateway ativo • ${unitMonitorUnitKey}${camsForUnit ? ` • ${camsForUnit} cams` : ''}`
            : `Online • Gateway parado • ${unitMonitorUnitKey}${lastError ? ` • ${lastError}` : ''}`)
          : `Offline • ${unitMonitorUnitKey}`
        next.push({
          key: 'unit-monitor-api',
          title: 'Unit Monitor',
          status: ok ? (running ? 'ok' : 'warn') : 'error',
          subtitle
        })
      } else {
        next.push({
          key: 'unit-monitor-api',
          title: 'Unit Monitor',
          status: 'error',
          subtitle: `Erro • ${unitMonitorUnitKey}`
        })
      }

      setRows(next)
      setUpdatedAt(new Date().toLocaleString('pt-BR'))
    } finally {
      setLoading(false)
    }
  }, [unitMonitorUnitKey])

  React.useEffect(() => {
    if (!loading) {
      loadingStartedAtRef.current = null
      setLoadingProgress(100)
      const t = window.setTimeout(() => setLoadingProgress(0), 250)
      return () => window.clearTimeout(t)
    }

    if (!loadingStartedAtRef.current) loadingStartedAtRef.current = Date.now()
    const tick = () => {
      const started = loadingStartedAtRef.current || Date.now()
      const elapsed = Date.now() - started
      const budgetMs = 6000
      const pct = Math.min(95, Math.max(1, Math.floor((elapsed / budgetMs) * 95)))
      setLoadingProgress(pct)
    }
    tick()
    const id = window.setInterval(tick, 150)
    return () => window.clearInterval(id)
  }, [loading])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const loadBackups = React.useCallback(async () => {
    if (!canManageBackups) return
    setBackupLoading(true)
    try {
      const status = await apiJson<{ success?: boolean; data?: BackupStatus }>('/backup/status')
      setBackupStatus((status?.data as BackupStatus) || null)
      const out = await apiJson<{ success?: boolean; data?: BackupSnapshot[] }>('/backup/list?limit=20')
      setBackupItems(Array.isArray(out?.data) ? out.data : [])
    } catch {
      setBackupStatus(null)
      setBackupItems([])
    } finally {
      setBackupLoading(false)
    }
  }, [canManageBackups])

  const canManageUsers = hasInsumosSession && (insumosRole === 'GESTOR' || insumosRole === 'GERENTE')
  const [usersLoading, setUsersLoading] = React.useState(false)
  const [usersQuery, setUsersQuery] = React.useState('')
  const [users, setUsers] = React.useState<AdminUser[]>([])
  const [userCreateOpen, setUserCreateOpen] = React.useState(false)
  const [userEdit, setUserEdit] = React.useState<AdminUser | null>(null)
  const [oneTimePassword, setOneTimePassword] = React.useState<string | null>(null)

  const loadUsers = React.useCallback(async () => {
    if (!canManageUsers) return
    setUsersLoading(true)
    try {
      const params = new URLSearchParams()
      if (usersQuery.trim()) params.set('q', usersQuery.trim())
      params.set('limit', '100')
      const out = await apiJson<{ success?: boolean; data?: AdminUser[] }>(`/admin/users?${params.toString()}`)
      setUsers(Array.isArray(out?.data) ? out.data : [])
    } catch {
      setUsers([])
    } finally {
      setUsersLoading(false)
    }
  }, [canManageUsers, usersQuery])

  const canViewAudit = hasInsumosSession && (insumosRole === 'GESTOR' || insumosRole === 'GERENTE')
  const loadAudit = React.useCallback(async () => {
    if (!canViewAudit) return
    setAuditLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; data?: AuditRow[] }>(`/audit?limit=100&unidade=${encodeURIComponent(insumosUnit)}`)
      setAuditRows(Array.isArray(out?.data) ? out.data : [])
    } catch {
      setAuditRows([])
    } finally {
      setAuditLoading(false)
    }
  }, [canViewAudit, insumosUnit])

  const mutate = React.useCallback(
    async (path: string, init: { method: string; body?: unknown }) => {
      const attempt = async (csrfToken: string | null) =>
        apiJson<{ success?: boolean; data?: unknown; code?: string }>(path, { method: init.method, body: init.body, csrfToken })
      try {
        return await attempt(insumosMe?.csrfToken || null)
      } catch (e: any) {
        const msg = String(e?.message || '')
        if (!msg.toUpperCase().includes('CSRF')) throw e
        const next = await refreshMe()
        if (!next) throw e
        return attempt(next)
      }
    },
    [insumosMe?.csrfToken, refreshMe]
  )

  React.useEffect(() => {
    void loadBackups()
  }, [loadBackups])

  React.useEffect(() => {
    if (!adminOpen) return
    void loadUsers()
  }, [adminOpen, loadUsers])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {loading ? (
        <div className="flex items-center justify-end">
          <LoadingPercentButton percent={loadingProgress} label="Carregando status" size="sm" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-white">Status do sistema</h2>
          <div className="text-sm text-blue-200/70">
            Monitoramento simples de saúde e conectividade.
            {updatedAt ? <span> • atualizado em {updatedAt}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2">
            <span className="text-xs text-blue-100/70">Debug</span>
            <Switch
              checked={debugUi}
              onCheckedChange={(checked) => {
                setDebugUi(Boolean(checked))
                try {
                  window.localStorage.setItem('skincos.debug', checked ? '1' : '0')
                } catch {}
              }}
            />
          </div>
          <Button onClick={refresh} disabled={loading}>
            {loading ? 'Atualizando…' : 'Atualizar'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {rows.map((row) => (
          <Card key={row.key} className="glass-morphism border border-white/10">
            <CardHeader className="space-y-2">
              <CardTitle className="text-white text-base flex items-center justify-between gap-2">
                <span>{row.title}</span>
                <Badge variant={badgeVariant(row.status)}>{row.status === 'ok' ? 'OK' : row.status === 'warn' ? 'Atenção' : row.status === 'error' ? 'Erro' : '—'}</Badge>
              </CardTitle>
              {row.subtitle ? <div className="text-sm text-blue-100/70">{row.subtitle}</div> : null}
            </CardHeader>
            <CardContent className="text-xs text-blue-200/60">
              {row.key === 'insumos-api' ? (
                <div>Integração do módulo</div>
              ) : row.key === 'unit-monitor-api' ? (
                <div>Unidade atual: {formatUnitLabel(unitMonitorUnitKey)}</div>
              ) : (
                <div>Login e permissões</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-morphism border border-white/10">
        <CardHeader>
          <CardTitle className="text-white text-base">Contexto</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-100/70 space-y-2">
          <div>
            Unidade Insumos: <span className="text-blue-100 font-semibold">{formatUnitLabel(insumosUnit)}</span>
          </div>
          <div>
            Unidade Unit Monitor: <span className="text-blue-100 font-semibold">{formatUnitLabel(unitMonitorUnitKey)}</span>
          </div>
          <div className="text-xs text-blue-200/60">
            Este módulo centraliza status para não poluir o cabeçalho dos módulos operacionais.
          </div>
        </CardContent>
      </Card>

      <Card className="glass-morphism border border-white/10">
        <CardHeader className="space-y-2">
          <CardTitle className="text-white text-base flex items-center justify-between gap-2">
            <span>Backups</span>
            <Badge variant={canManageBackups ? 'success' : 'secondary'}>{canManageBackups ? 'Disponível' : 'Restrito'}</Badge>
          </CardTitle>
          <div className="text-sm text-blue-100/70">Gerencie backups do Insumos para recuperação rápida.</div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasInsumosSession ? (
            <div className="text-sm text-blue-100/70">Faça login para gerenciar backups.</div>
          ) : !canManageBackups ? (
            <div className="text-sm text-blue-100/70">Seu perfil ({insumosRole || '—'}) não tem permissão para backups.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-blue-100/70">
                  Unidade selecionada: <span className="text-blue-50 font-semibold">{formatUnitLabel(insumosUnit)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={async () => {
                      try {
                        await mutate(`/backup/trigger?unidade=${encodeURIComponent(insumosUnit)}`, { method: 'POST' })
                        await loadBackups()
                      } catch (e) {
                        // keep toast minimal; module is locked
                      }
                    }}
                    disabled={backupLoading}
                  >
                    Disparar backup
                  </Button>
                  <Button variant="secondary" onClick={loadBackups} disabled={backupLoading}>
                    {backupLoading ? (
                      <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                    ) : (
                      'Recarregar'
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-blue-200/70">
                <Badge variant={backupStatus?.db ? 'success' : 'secondary'}>{backupStatus?.db ? 'D1 ok' : 'D1 —'}</Badge>
                <Badge variant={backupStatus?.r2 ? 'success' : 'secondary'}>{backupStatus?.r2 ? 'R2 ativo' : 'R2 off'}</Badge>
                {backupStatus?.lastBackupTs ? (
                  <span>Último backup: {new Date(String(backupStatus.lastBackupTs)).toLocaleString('pt-BR')}</span>
                ) : (
                  <span>Último backup: —</span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card className="bg-black/20 border border-white/10 md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">Restauração</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-xs text-blue-200/60">Informe o ID do backup e confirme a restauração.</div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input value={backupRestoreId} onChange={(e) => setBackupRestoreId(e.target.value)} placeholder="ID do backup" />
                      <Button
                        variant="destructive"
                        onClick={async () => {
                          const id = Number(backupRestoreId)
                          if (!Number.isFinite(id) || id <= 0) return
                          if (!window.confirm('Restaurar backup? Isso sobrescreve dados atuais.')) return
                          try {
                            await mutate(`/backup/restore?unidade=${encodeURIComponent(insumosUnit)}`, {
                              method: 'POST',
                              body: { id, confirm: 'RESTORE' }
                            })
                            setBackupRestoreId('')
                            await loadBackups()
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        Restaurar
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-black/20 border border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">Limpeza</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-xs text-blue-200/60">Remover backups antigos (dias).</div>
                    <Input value={backupCleanupDays} onChange={(e) => setBackupCleanupDays(e.target.value)} type="number" />
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        const daysToKeep = Math.max(1, Number(backupCleanupDays) || 30)
                        try {
                          await mutate(`/backup/cleanup?unidade=${encodeURIComponent(insumosUnit)}`, { method: 'POST', body: { daysToKeep } })
                          await loadBackups()
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      Limpar
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
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
                        <td className="p-3 text-blue-100/70">{b.ts ? new Date(b.ts).toLocaleString('pt-BR') : '-'}</td>
                        <td className="p-3 text-blue-100/70">{b.unidade ? formatUnitLabel(b.unidade) : '-'}</td>
                        <td className="p-3 text-blue-100/70">{b.actor || '-'}</td>
                      </tr>
                    ))}
                    {!backupItems.length ? (
                      <tr>
                        <td className="p-3 text-blue-100/70" colSpan={4}>
                          {backupLoading ? (
                            <LoadingPercentText label="Carregando" showPercent={false} />
                          ) : (
                            'Sem backups.'
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="glass-morphism border border-white/10">
        <CardHeader className="space-y-2">
          <CardTitle className="text-white text-base flex items-center justify-between gap-2">
            <span>Gestor</span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setAdminOpen((v) => !v)}>
                {adminOpen ? 'Ocultar usuários' : 'Usuários'}
              </Button>
              <Button variant="secondary" onClick={() => setAdvancedOpen((v) => !v)}>
                {advancedOpen ? 'Ocultar auditoria' : 'Auditoria'}
              </Button>
            </div>
          </CardTitle>
          <div className="text-sm text-blue-100/70">Ferramentas restritas para gestão (usuários, auditoria).</div>
        </CardHeader>
        {adminOpen ? (
          <CardContent className="space-y-4">
            {!hasInsumosSession ? (
              <div className="text-sm text-blue-100/70">Faça login para ver funções administrativas.</div>
            ) : !canManageUsers ? (
              <div className="text-sm text-blue-100/70">Seu perfil ({insumosRole || '—'}) não tem permissão para usuários.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-blue-100/70">Usuários do CRM (D1)</div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={usersQuery}
                      onChange={(e) => setUsersQuery(e.target.value)}
                      placeholder="Buscar usuário/email…"
                      className="max-w-xs"
                    />
                    <Button variant="secondary" onClick={loadUsers} disabled={usersLoading}>
                      {usersLoading ? (
                        <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                      ) : (
                        'Recarregar'
                      )}
                    </Button>
                    <Button onClick={() => { setOneTimePassword(null); setUserCreateOpen(true) }}>
                      Novo usuário
                    </Button>
                  </div>
                </div>

                <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
                  <table className="min-w-full text-sm">
                    <thead className="bg-black/30 text-blue-100/80">
                      <tr>
                        <th className="text-left p-3">Usuário</th>
                        <th className="text-left p-3">Perfil</th>
                        <th className="text-left p-3">Unidades</th>
                        <th className="text-left p-3">Ativo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {users.map((u) => (
                        <tr
                          key={u.username}
                          className="hover:bg-white/5 cursor-pointer"
                          onClick={() => { setOneTimePassword(null); setUserEdit(u) }}
                        >
                          <td className="p-3 text-blue-100/80">
                            <div className="font-mono">{u.username}</div>
                            {u.email ? <div className="text-xs text-blue-200/60">{u.email}</div> : null}
                          </td>
                          <td className="p-3 text-blue-100/70">
                            <Badge variant="secondary">{String(u.role || 'CONSULTOR').toUpperCase()}</Badge>
                            {u.displayName ? <div className="text-xs text-blue-200/60 mt-1">{u.displayName}</div> : null}
                          </td>
                          <td className="p-3 text-blue-100/70">
                            {(Array.isArray(u.allowedUnits) && u.allowedUnits.length)
                              ? u.allowedUnits.map(formatUnitLabel).join(', ')
                              : <span className="text-blue-200/60">Todas</span>}
                          </td>
                          <td className="p-3 text-blue-100/70">
                            <Badge variant={u.ativo ? 'success' : 'secondary'}>{u.ativo ? 'Sim' : 'Não'}</Badge>
                          </td>
                        </tr>
                      ))}
                      {!users.length ? (
                        <tr>
                          <td className="p-3 text-blue-100/70" colSpan={4}>
                            {usersLoading ? (
                              <LoadingPercentText label="Carregando" showPercent={false} />
                            ) : (
                              'Sem usuários.'
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <Dialog open={userCreateOpen} onOpenChange={(o) => { setUserCreateOpen(o); if (!o) setOneTimePassword(null) }}>
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Novo usuário (CRM)</DialogTitle>
                  <DialogDescription>Cria o usuário no D1 e retorna uma senha temporária.</DialogDescription>
                </DialogHeader>
                <AdminUserForm
                  mode="create"
                  onCancel={() => setUserCreateOpen(false)}
                  onSubmit={async (payload) => {
                    const out = await mutate('/admin/users', { method: 'POST', body: payload })
                    const pw = (out as any)?.oneTimePassword || null
                    setOneTimePassword(typeof pw === 'string' ? pw : null)
                    await loadUsers()
                  }}
                />
                {oneTimePassword ? (
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="text-sm text-blue-100/80">Senha temporária (mostrar só uma vez):</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="font-mono text-blue-50 break-all">{oneTimePassword}</div>
                      <Button
                        variant="secondary"
                        onClick={() => navigator.clipboard?.writeText(oneTimePassword).catch(() => null)}
                      >
                        Copiar
                      </Button>
                    </div>
                    <div className="mt-2 text-xs text-blue-200/60">Recomende trocar a senha no primeiro acesso.</div>
                  </div>
                ) : null}
              </DialogContent>
            </Dialog>

            <Dialog open={!!userEdit} onOpenChange={(o) => { if (!o) { setUserEdit(null); setOneTimePassword(null) } }}>
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Editar usuário</DialogTitle>
                  <DialogDescription>Atualiza permissões e permite resetar senha.</DialogDescription>
                </DialogHeader>
                {userEdit ? (
                  <AdminUserForm
                    mode="edit"
                    initial={userEdit}
                    onCancel={() => setUserEdit(null)}
                    onSubmit={async (payload) => {
                      await mutate(`/admin/users/${encodeURIComponent(userEdit.username)}`, { method: 'PUT', body: payload })
                      await loadUsers()
                    }}
                    onResetPassword={async () => {
                      const out = await mutate(`/admin/users/${encodeURIComponent(userEdit.username)}/reset-password`, {
                        method: 'POST',
                        body: {}
                      })
                      const pw = (out as any)?.oneTimePassword || null
                      setOneTimePassword(typeof pw === 'string' ? pw : null)
                    }}
                  />
                ) : null}
                {oneTimePassword ? (
                  <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="text-sm text-blue-100/80">Senha temporária:</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="font-mono text-blue-50 break-all">{oneTimePassword}</div>
                      <Button
                        variant="secondary"
                        onClick={() => navigator.clipboard?.writeText(oneTimePassword).catch(() => null)}
                      >
                        Copiar
                      </Button>
                    </div>
                  </div>
                ) : null}
              </DialogContent>
            </Dialog>
          </CardContent>
        ) : null}

        {advancedOpen ? (
          <CardContent className="space-y-3">
            {!hasInsumosSession ? (
              <div className="text-sm text-blue-100/70">Faça login para ver informações avançadas.</div>
            ) : !canViewAudit ? (
              <div className="text-sm text-blue-100/70">Seu perfil ({insumosRole || '—'}) não tem permissão para auditoria.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/10 p-3">
                  <div className="text-sm text-blue-100/70">Diagnóstico Unit Monitor</div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => window.open('/api/unit-monitor/streaming/status', '_blank', 'noopener,noreferrer')}
                    >
                      Status
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => window.open('/api/unit-monitor/diagnostics', '_blank', 'noopener,noreferrer')}
                    >
                      Logs
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-blue-100/70">
                    Auditoria • Unidade: <span className="text-blue-50 font-semibold">{formatUnitLabel(insumosUnit)}</span>
                  </div>
                  <Button variant="secondary" onClick={loadAudit} disabled={auditLoading}>
                    {auditLoading ? (
                      <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                    ) : (
                      'Recarregar'
                    )}
                  </Button>
                </div>
                <div className="overflow-auto max-h-[60vh] rounded-xl border border-white/10">
                  <table className="min-w-full text-sm">
                    <thead className="bg-black/30 text-blue-100/80">
                      <tr>
                        <th className="text-left p-3">Data</th>
                        <th className="text-left p-3">Ação</th>
                        <th className="text-left p-3">Item</th>
                        <th className="text-left p-3">Autor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {auditRows.map((a, idx) => (
                        <tr key={`${a.timestamp || ''}-${idx}`} className="hover:bg-white/5">
                          <td className="p-3 text-blue-100/70">{a.timestamp ? new Date(a.timestamp).toLocaleString('pt-BR') : '-'}</td>
                          <td className="p-3 text-blue-100/80">{a.action || '-'}</td>
                          <td className="p-3 text-blue-100/70">
                            {(a.entity || '-').toString()}
                            {a.entityId ? <span className="text-blue-200/60"> • {a.entityId}</span> : null}
                          </td>
                          <td className="p-3 text-blue-100/70">{a.actor || '-'}</td>
                        </tr>
                      ))}
                      {!auditRows.length ? (
                        <tr>
                          <td className="p-3 text-blue-100/70" colSpan={4}>
                            {auditLoading ? (
                              <LoadingPercentText label="Carregando" showPercent={false} />
                            ) : (
                              'Sem logs.'
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}

function AdminUserForm({
  mode,
  initial,
  onCancel,
  onSubmit,
  onResetPassword
}: {
  mode: 'create' | 'edit'
  initial?: AdminUser | null
  onCancel: () => void
  onSubmit: (payload: any) => Promise<void>
  onResetPassword?: () => Promise<void>
}) {
  const [loading, setLoading] = React.useState(false)
  const [username, setUsername] = React.useState(initial?.username || '')
  const [displayName, setDisplayName] = React.useState(initial?.displayName || '')
  const [email, setEmail] = React.useState(initial?.email || '')
  const [role, setRole] = React.useState(String(initial?.role || 'CONSULTOR').toUpperCase())
  const [allowedUnits, setAllowedUnits] = React.useState((initial?.allowedUnits || []).join(', '))
  const [allowedModules, setAllowedModules] = React.useState((initial?.allowedModules || []).join(', '))
  const [ativo, setAtivo] = React.useState(initial?.ativo ?? true)
  const [password, setPassword] = React.useState('')
  const isCreate = mode === 'create'

  const submit = async () => {
    setLoading(true)
    try {
      const payload: any = {
        displayName: displayName.trim(),
        email: email.trim(),
        role,
        allowedUnits: allowedUnits
          .split(/[,;|]/g)
          .map((s) => s.trim())
          .filter(Boolean),
        allowedModules: allowedModules
          .split(/[,;|]/g)
          .map((s) => s.trim())
          .filter(Boolean),
        ativo
      }
      if (isCreate) {
        payload.username = username.trim()
        if (password.trim()) payload.password = password.trim()
      }
      await onSubmit(payload)
        if (isCreate) {
          setUsername('')
          setDisplayName('')
          setEmail('')
          setRole('CONSULTOR')
          setAllowedUnits('')
          setAllowedModules('')
          setAtivo(true)
          setPassword('')
        }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="text-xs text-blue-200/70">Usuário</div>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={!isCreate} placeholder="ex: julian" />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-blue-200/70">Perfil</div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {['CONSULTOR', 'INJETOR', 'GERENTE', 'GESTOR'].map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <div className="text-xs text-blue-200/70">Nome exibido</div>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="ex: Julian Benito" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <div className="text-xs text-blue-200/70">Email</div>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ex: julian@empresa.com" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <div className="text-xs text-blue-200/70">Unidades permitidas</div>
          <Input value={allowedUnits} onChange={(e) => setAllowedUnits(e.target.value)} placeholder="vazio = todas • ex: novo-hamburgo, barra-shopping-sul" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <div className="text-xs text-blue-200/70">Módulos permitidos</div>
          <Input
            value={allowedModules}
            onChange={(e) => setAllowedModules(e.target.value)}
            placeholder="vazio = todos • ex: insumos, status, users"
          />
        </div>
        {isCreate ? (
          <div className="space-y-1 sm:col-span-2">
            <div className="text-xs text-blue-200/70">Senha (opcional)</div>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="deixe vazio para gerar automaticamente" />
          </div>
        ) : null}
        <div className="flex items-center justify-between sm:col-span-2 rounded-lg border border-white/10 bg-black/20 p-3">
          <div>
            <div className="text-sm text-blue-100/80">Ativo</div>
            <div className="text-xs text-blue-200/60">Desative para bloquear acesso sem apagar o usuário.</div>
          </div>
          <Switch checked={ativo} onCheckedChange={setAtivo} />
        </div>
      </div>

      <DialogFooter>
        {onResetPassword ? (
          <Button
            variant="secondary"
            onClick={async () => {
              setLoading(true)
              try {
                await onResetPassword()
              } finally {
                setLoading(false)
              }
            }}
            disabled={loading}
          >
            Reset senha
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={loading || (isCreate && !username.trim())}>
          {loading ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogFooter>
    </div>
  )
}
