import React from 'react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
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

export function SystemStatusModule() {
  const [unitMonitorSelectedUnit] = useKV<string>('unit-monitor:selected-unit', 'unit-a')
  const [unitMonitorCustomUnit] = useKV<string>('unit-monitor:custom-unit', '')
  const unitMonitorEffectiveUnit =
    unitMonitorSelectedUnit === 'custom' ? (unitMonitorCustomUnit.trim() || 'custom') : unitMonitorSelectedUnit

  const [insumosUnit, setInsumosUnit] = React.useState('novo-hamburgo')

  const [rows, setRows] = React.useState<ServiceRow[]>([
    { key: 'insumos-api', title: 'Insumos', status: 'unknown', subtitle: 'API' },
    { key: 'insumos-session', title: 'Insumos', status: 'unknown', subtitle: 'Sessão' },
    { key: 'unit-monitor-api', title: 'Unit Monitor', status: 'unknown', subtitle: 'API' }
  ])
  const [loading, setLoading] = React.useState(false)
  const [updatedAt, setUpdatedAt] = React.useState<string>('')

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
        next.push({
          key: 'insumos-session',
          title: 'Insumos',
          status: hasSession ? 'ok' : 'warn',
          subtitle: hasSession ? 'Sessão ativa' : 'Sessão ausente'
        })
      } else {
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
  }, [])

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
                <div>Base: Sheets/Worker (Cloudflare)</div>
              ) : row.key === 'unit-monitor-api' ? (
                <div>Unidade atual: {unitMonitorSelectedUnit === 'custom' ? (unitMonitorCustomUnit.trim() || 'custom') : unitMonitorSelectedUnit}</div>
              ) : (
                <div>Controle de acesso unificado do CRM</div>
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
    </div>
  )
}
