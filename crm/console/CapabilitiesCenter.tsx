import React, { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Separator } from '@/separator'
import { fetchCapabilitiesCatalog, type CapabilitiesCatalog } from '@/capabilities'
import { LoadingPercentText } from '@/LoadingPattern'

function stringifyPorts(ports?: Record<string, number | string>) {
  if (!ports) return null
  const entries = Object.entries(ports)
  if (!entries.length) return null
  return entries.map(([k, v]) => `${k}: ${v}`).join(' • ')
}

type ProbeAttempt = { ok: boolean; status?: number; ms?: number; url?: string; error?: string }
type ProbeResult = { ok: boolean; primary?: ProbeAttempt | null; attempts?: ProbeAttempt[] }
type CoreStatusEntry = {
  id: string
  ok: boolean
  ports?: Record<string, number | string>
  open?: { frontend?: string; api?: string }
  checks?: Record<string, ProbeResult>
}
type CapabilityStatusEntry = {
  id: string
  label?: string
  ok: boolean
  open?: string | null
  probe?: ProbeResult
}
type PlatformStatus = {
  ok: boolean
  ts?: string
  core?: Record<string, CoreStatusEntry>
  capabilities?: Record<string, CapabilityStatusEntry>
}

async function fetchPlatformStatus(): Promise<PlatformStatus> {
  const res = await fetch('/api/core/status', { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to load platform status (${res.status}): ${text || res.statusText}`)
  }
  return (await res.json()) as PlatformStatus
}

export function CapabilitiesCenter() {
  const [catalog, setCatalog] = useState<CapabilitiesCatalog | null>(null)
  const [status, setStatus] = useState<PlatformStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingStatus, setLoadingStatus] = useState(true)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
    fetchCapabilitiesCatalog()
      .then((data) => {
        if (!mounted) return
        setCatalog(data)
      })
      .catch((e) => {
        if (!mounted) return
        setError(e?.message || 'Failed to load capabilities')
      })
      .finally(() => {
        if (!mounted) return
        setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const load = async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoadingStatus(true)
      setStatusError(null)
      try {
        const data = await fetchPlatformStatus()
        if (!mounted) return
        setStatus(data)
      } catch (e: any) {
        if (!mounted) return
        setStatusError(e?.message || 'Failed to load platform status')
      } finally {
        if (mounted && !opts?.silent) setLoadingStatus(false)
      }
    }

    load().catch(() => {})
    const t = setInterval(() => {
      load({ silent: true }).catch(() => {})
    }, 5000)
    return () => {
      mounted = false
      clearInterval(t)
    }
  }, [])

  const coreItems = useMemo(() => {
    const core = catalog?.core || {}
    return Object.values(core)
  }, [catalog])

  const capabilityItems = useMemo(() => catalog?.capabilities || [], [catalog])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Capacidades</h2>
          <p className="text-sm text-blue-300/80">
            Catálogo do monorepo (core + capabilities) carregado do backend.
          </p>
          <p className="text-xs text-blue-300/60 mt-1">
            Status:{' '}
            {loadingStatus ? (
              <LoadingPercentText label="Carregando" className="text-xs" showPercent={false} />
            ) : (
              status?.ok ? `ok (${status.ts || 'agora'})` : 'indisponível'
            )}
          </p>
        </div>
        <Button
          variant="outline"
          className="bg-white/[0.06] border-white/20 text-white hover:bg-white/[0.12]"
          onClick={() => window.location.reload()}
        >
          Recarregar
        </Button>
      </div>

      {loading && (
        <Card className="glass-morphism border-white/20">
          <CardHeader>
            <CardTitle className="text-white">
              <LoadingPercentText label="Carregando" className="text-white/90" showPercent={false} />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-blue-200/80">Buscando `capabilities.json` via `/api/core/capabilities`.</CardContent>
        </Card>
      )}

      {error && (
        <Card className="glass-morphism border-red-500/30">
          <CardHeader>
            <CardTitle className="text-white">Falha ao carregar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-red-200/90 text-sm">{error}</div>
            <div className="text-blue-200/70 text-xs">
              Dica: confirme se o CRM API está rodando e se o proxy do Vite para `/api` está ativo.
            </div>
          </CardContent>
        </Card>
      )}

      {statusError && (
        <Card className="glass-morphism border-yellow-500/30">
          <CardHeader>
            <CardTitle className="text-white">Status indisponível</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-yellow-200/90 text-sm">{statusError}</div>
            <div className="text-blue-200/70 text-xs">Dica: confirme se o CRM API está rodando (porta 8099).</div>
          </CardContent>
        </Card>
      )}

      {!loading && !error && catalog && (
        <>
          <Card className="glass-morphism border-white/20">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-white">Core</CardTitle>
              <Badge className="bg-white/10 text-white border-white/20">{coreItems.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {coreItems.length === 0 && <div className="text-blue-200/70 text-sm">Nenhum core declarado.</div>}
              {coreItems.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-white font-medium truncate">{c.id}</div>
                      <Badge className="bg-blue-500/20 text-blue-100 border-blue-400/20">{c.kind}</Badge>
                      {status?.core?.[c.id]?.ok ? (
                        <Badge className="bg-emerald-500/15 text-emerald-100 border-emerald-400/20">online</Badge>
                      ) : (
                        <Badge className="bg-red-500/15 text-red-100 border-red-400/20">offline</Badge>
                      )}
                    </div>
                    <div className="text-xs text-blue-300/70 truncate">path: {c.path}</div>
                    {stringifyPorts(c.ports) && (
                      <div className="text-xs text-blue-200/70 mt-1">{stringifyPorts(c.ports)}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {status?.core?.[c.id]?.open?.frontend && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white/[0.06] border-white/20 text-white hover:bg-white/[0.12]"
                        onClick={() => window.open(status.core?.[c.id]?.open?.frontend, '_blank')}
                      >
                        Abrir FE
                      </Button>
                    )}
                    {status?.core?.[c.id]?.open?.api && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white/[0.06] border-white/20 text-white hover:bg-white/[0.12]"
                        onClick={() => window.open(status.core?.[c.id]?.open?.api, '_blank')}
                      >
                        Abrir API
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Separator className="bg-white/10" />

          <Card className="glass-morphism border-white/20">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-white">Capabilities</CardTitle>
              <Badge className="bg-white/10 text-white border-white/20">{capabilityItems.length}</Badge>
            </CardHeader>
            <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {capabilityItems.map((cap) => (
                <Card key={cap.id} className="bg-white/[0.04] border-white/10">
                  <CardHeader className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-white font-semibold truncate">{cap.label || cap.id}</div>
                        <div className="text-xs text-blue-300/70 truncate">{cap.id}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-emerald-500/15 text-emerald-100 border-emerald-400/20">{cap.kind}</Badge>
                        {status?.capabilities?.[cap.id]?.ok ? (
                          <Badge className="bg-emerald-500/15 text-emerald-100 border-emerald-400/20">online</Badge>
                        ) : (
                          <Badge className="bg-red-500/15 text-red-100 border-red-400/20">offline</Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-xs text-blue-200/70">path: {cap.path}</div>
                    {stringifyPorts(cap.ports) && <div className="text-xs text-blue-200/70">{stringifyPorts(cap.ports)}</div>}
                    {cap.notes && <div className="text-xs text-blue-200/60 line-clamp-3">{cap.notes}</div>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {cap.health?.path && <Badge className="bg-white/10 text-white border-white/20">health: {cap.health.path}</Badge>}
                      {cap.health?.alt && <Badge className="bg-white/10 text-white border-white/20">alt: {cap.health.alt}</Badge>}
                    </div>
                    {status?.capabilities?.[cap.id]?.open && (
                      <div className="pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-white/[0.06] border-white/20 text-white hover:bg-white/[0.12]"
                          onClick={() => window.open(status.capabilities?.[cap.id]?.open || undefined, '_blank')}
                        >
                          Abrir
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
