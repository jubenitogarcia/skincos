import React from 'react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { useKV } from '@/spark-mock'

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
  throw new Error(err.error || err.message || `HTTP ${res.status}`)
}

export function SystemStatusModule() {
  const [unitMonitorSelectedUnit] = useKV<string>('unit-monitor:selected-unit', 'unit-a')
  const [unitMonitorCustomUnit] = useKV<string>('unit-monitor:custom-unit', '')
  const unitMonitorEffectiveUnit =
    unitMonitorSelectedUnit === 'custom' ? (unitMonitorCustomUnit.trim() || 'custom') : unitMonitorSelectedUnit

  const [insumosUnit, setInsumosUnit] = React.useState('novo-hamburgo')
  const [insumosMe, setInsumosMe] = React.useState<InsumosMe | null>(null)

  const [rows, setRows] = React.useState<ServiceRow[]>([
    { key: 'insumos-api', title: 'Insumos', status: 'unknown', subtitle: 'API' },
    { key: 'insumos-session', title: 'Insumos', status: 'unknown', subtitle: 'Sessão' },
    { key: 'unit-monitor-api', title: 'Unit Monitor', status: 'unknown', subtitle: 'API' }
  ])
  const [loading, setLoading] = React.useState(false)
  const [updatedAt, setUpdatedAt] = React.useState<string>('')

  const hasInsumosSession = Boolean(insumosMe?.user?.username)
  const insumosRole = String(insumosMe?.user?.role || '').toUpperCase()
  const canManageBackups = hasInsumosSession && (insumosRole === 'ADMIN' || insumosRole === 'GESTOR')

  const [backupLoading, setBackupLoading] = React.useState(false)
  const [backupItems, setBackupItems] = React.useState<BackupSnapshot[]>([])
  const [backupRestoreId, setBackupRestoreId] = React.useState('')
  const [backupCleanupDays, setBackupCleanupDays] = React.useState('30')
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [auditLoading, setAuditLoading] = React.useState(false)
  const [auditRows, setAuditRows] = React.useState<AuditRow[]>([])

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
      const [insHealth, insMe, umState] = await Promise.allSettled([
        fetch('/api/insumos/health', { credentials: 'include' }).then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => null) })),
        fetch('/api/insumos/auth/me', { credentials: 'include' }).then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => null) })),
        fetch(`/api/unit-monitor/state?unit=${encodeURIComponent(unitMonitorEffectiveUnit)}`, { credentials: 'include' }).then(async (r) => ({
          ok: r.ok,
          json: await r.json().catch(() => null)
        }))
      ])

      const next: ServiceRow[] = []

      if (insHealth.status === 'fulfilled') {
        const online = insHealth.value.ok && Boolean(insHealth.value.json?.ok)
        const integrated = typeof insHealth.value.json?.sheetsConfigured === 'boolean' ? Boolean(insHealth.value.json.sheetsConfigured) : null
        next.push({
          key: 'insumos-api',
          title: 'Insumos',
          status: online ? (integrated === false ? 'warn' : 'ok') : 'error',
          subtitle: online ? (integrated === false ? 'Online • Integração pendente' : 'Online') : 'Offline'
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

      if (umState.status === 'fulfilled') {
        const ok = umState.value.ok
        next.push({
          key: 'unit-monitor-api',
          title: 'Unit Monitor',
          status: ok ? 'ok' : 'error',
          subtitle: ok ? `Online • ${unitMonitorEffectiveUnit}` : `Offline • ${unitMonitorEffectiveUnit}`
        })
      } else {
        next.push({
          key: 'unit-monitor-api',
          title: 'Unit Monitor',
          status: 'error',
          subtitle: `Erro • ${unitMonitorEffectiveUnit}`
        })
      }

      setRows(next)
      setUpdatedAt(new Date().toLocaleString('pt-BR'))
    } finally {
      setLoading(false)
    }
  }, [unitMonitorEffectiveUnit])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      const value = window.localStorage.getItem('skincos.insumos.unidade.v1')
      if (value) setInsumosUnit(value)
    } catch {
      // ignore
    }

    const onUnit = (ev: Event) => {
      const e = ev as CustomEvent<{ unidade?: string }>
      const next = String(e.detail?.unidade || '').trim()
      if (next) setInsumosUnit(next)
    }
    window.addEventListener('skincos:insumos:unidade', onUnit as EventListener)
    return () => window.removeEventListener('skincos:insumos:unidade', onUnit as EventListener)
  }, [])

  const loadBackups = React.useCallback(async () => {
    if (!canManageBackups) return
    setBackupLoading(true)
    try {
      const out = await apiJson<{ success?: boolean; data?: BackupSnapshot[] }>('/backup/list?limit=20')
      setBackupItems(Array.isArray(out?.data) ? out.data : [])
    } catch {
      setBackupItems([])
    } finally {
      setBackupLoading(false)
    }
  }, [canManageBackups])

  const canViewAudit = hasInsumosSession && (insumosRole === 'ADMIN' || insumosRole === 'GESTOR' || insumosRole === 'GERENTE')
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-white">Status do sistema</h2>
          <div className="text-sm text-blue-200/70">
            Monitoramento simples de saúde e conectividade.
            {updatedAt ? <span> • atualizado em {updatedAt}</span> : null}
          </div>
        </div>
        <Button onClick={refresh} disabled={loading}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </Button>
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
                <div>Unidade atual: {unitMonitorSelectedUnit === 'custom' ? (unitMonitorCustomUnit.trim() || 'custom') : unitMonitorSelectedUnit}</div>
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
            Unidade Unit Monitor: <span className="text-blue-100 font-semibold">{unitMonitorEffectiveUnit}</span>
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
                    {backupLoading ? 'Carregando…' : 'Recarregar'}
                  </Button>
                </div>
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
                          {backupLoading ? 'Carregando…' : 'Sem backups.'}
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
            <span>Avançado</span>
            <Button variant="secondary" onClick={() => setAdvancedOpen((v) => !v)}>
              {advancedOpen ? 'Ocultar' : 'Abrir'}
            </Button>
          </CardTitle>
          <div className="text-sm text-blue-100/70">Logs e diagnósticos (para gestores).</div>
        </CardHeader>
        {advancedOpen ? (
          <CardContent className="space-y-3">
            {!hasInsumosSession ? (
              <div className="text-sm text-blue-100/70">Faça login para ver informações avançadas.</div>
            ) : !canViewAudit ? (
              <div className="text-sm text-blue-100/70">Seu perfil ({insumosRole || '—'}) não tem permissão para auditoria.</div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-blue-100/70">
                    Auditoria • Unidade: <span className="text-blue-50 font-semibold">{formatUnitLabel(insumosUnit)}</span>
                  </div>
                  <Button variant="secondary" onClick={loadAudit} disabled={auditLoading}>
                    {auditLoading ? 'Carregando…' : 'Recarregar'}
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
                            {auditLoading ? 'Carregando…' : 'Sem logs.'}
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
