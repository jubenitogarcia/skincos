import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Input } from '@/input'
import { Separator } from '@/separator'
import { Switch } from '@/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { LoadingPercentText } from '@/LoadingPattern'

type JobMeta = {
  id: string
  job: string
  params: Record<string, unknown>
  status: 'running' | 'done' | 'error' | string
  startedAt?: string
  endedAt?: string | null
  exitCode?: number | null
  logPath?: string
}

type JobsListResponse = { ok: boolean; jobs?: JobMeta[]; error?: string }
type JobRunResponse = { ok: boolean; job?: JobMeta; error?: string }
type JobLogResponse = { ok: boolean; tail?: string; error?: string; logPath?: string }

async function fetchJobs(limit = 50): Promise<JobMeta[]> {
  const res = await fetch(`/api/jobs?limit=${encodeURIComponent(String(limit))}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Falha ao listar jobs (${res.status}): ${text || res.statusText}`)
  }
  const json = (await res.json()) as JobsListResponse
  if (!json.ok) throw new Error(json.error || 'Falha ao listar jobs')
  return json.jobs || []
}

async function runJob(job: string, params: Record<string, unknown>) {
  const res = await fetch('/api/jobs/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ job, params }),
  })
  const json = (await res.json().catch(() => ({}))) as JobRunResponse
  if (!res.ok || !json.ok || !json.job) {
    throw new Error(json.error || `Falha ao iniciar job (${res.status})`)
  }
  return json.job
}

async function fetchJobLog(id: string, lines = 200): Promise<string> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/log?lines=${encodeURIComponent(String(lines))}`, {
    headers: { Accept: 'application/json' },
  })
  const json = (await res.json().catch(() => ({}))) as JobLogResponse
  if (!res.ok || !json.ok) throw new Error(json.error || `Falha ao ler log (${res.status})`)
  return json.tail || ''
}

function formatTs(ts?: string) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleString()
  } catch {
    return ts
  }
}

export function JobsCenter() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<JobMeta[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [logTail, setLogTail] = useState<string>('')
  const [logLines, setLogLines] = useState<number>(200)
  const [loadingLog, setLoadingLog] = useState(false)

  // Sales Chart Messenger form
  const [salesMode, setSalesMode] = useState<'diagnose' | 'test' | 'run'>('diagnose')
  const [salesPeriod, setSalesPeriod] = useState<'morning' | 'evening'>('morning')
  const [salesCellSet, setSalesCellSet] = useState<'bss' | 'nh' | ''>('')
  const [salesForce, setSalesForce] = useState(false)

  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedJobId) || null, [jobs, selectedJobId])

  const refreshJobs = useCallback(async () => {
    const list = await fetchJobs(80)
    setJobs(list)
    if (!selectedJobId && list[0]?.id) setSelectedJobId(list[0].id)
  }, [selectedJobId])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
    refreshJobs()
      .catch((e) => {
        if (!mounted) return
        setError(e?.message || 'Falha ao carregar jobs')
      })
      .finally(() => {
        if (!mounted) return
        setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [refreshJobs])

  useEffect(() => {
    const t = setInterval(() => {
      refreshJobs().catch(() => {})
    }, 3500)
    return () => clearInterval(t)
  }, [refreshJobs])

  const refreshLog = useCallback(async () => {
    if (!selectedJobId) return
    setLoadingLog(true)
    try {
      const tail = await fetchJobLog(selectedJobId, logLines)
      setLogTail(tail)
    } catch (e) {
      setLogTail(`(falha ao carregar log)\n${e?.message || e}`)
    } finally {
      setLoadingLog(false)
    }
  }, [selectedJobId, logLines])

  useEffect(() => {
    refreshLog().catch(() => {})
  }, [refreshLog])

  async function onRunSales() {
    setError(null)
    if ((salesMode === 'run' || salesMode === 'test') && !salesCellSet) {
      setError('Selecione a unidade (bss|nh) para executar em modo run/test.')
      return
    }

    if (salesMode === 'run') {
      const msg = salesForce
        ? 'Você está prestes a EXECUTAR e FORÇAR reenvio (pode duplicar mensagens). Confirmar?'
        : 'Você está prestes a EXECUTAR (envio real no WhatsApp). Confirmar?'
      if (!window.confirm(msg)) return
    }

    const params: Record<string, unknown> = { mode: salesMode, period: salesPeriod }
    if (salesCellSet) params.cell_set = salesCellSet
    if (salesForce) params.force = true

    try {
      const meta = await runJob('sales-chart-messenger', params)
      await refreshJobs()
      setSelectedJobId(meta.id)
      setTimeout(() => refreshLog().catch(() => {}), 400)
    } catch (e) {
      setError(e?.message || 'Falha ao iniciar job')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Execuções</h2>
          <p className="text-sm text-blue-300/80">
            Rode automações pelo painel (sem terminal). Logs ficam em `backend/var/jobs/`.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="bg-white/[0.06] border-white/20 text-white hover:bg-white/[0.12]"
            onClick={() => refreshJobs().catch(() => {})}
          >
            Atualizar
          </Button>
        </div>
      </div>

      {error && (
        <Card className="glass-morphism border-red-500/30">
          <CardHeader>
            <CardTitle className="text-white">Atenção</CardTitle>
          </CardHeader>
          <CardContent className="text-red-200/90 text-sm">{error}</CardContent>
        </Card>
      )}

      <Card className="glass-morphism border-white/20">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-white">Executar automação</CardTitle>
          <Badge className="bg-white/10 text-white border-white/20">UI → backend</Badge>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="sales-chart-messenger">
            <TabsList>
              <TabsTrigger value="sales-chart-messenger">Sales Chart</TabsTrigger>
            </TabsList>

            <TabsContent value="sales-chart-messenger" className="mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="text-xs text-blue-200/70">Modo</div>
                  <Select value={salesMode} onValueChange={(v) => setSalesMode(v as any)}>
                    <SelectTrigger className="w-full bg-white/[0.06] border-white/20 text-white">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="diagnose">diagnose (seguro)</SelectItem>
                      <SelectItem value="test">test (teste)</SelectItem>
                      <SelectItem value="run">run (real)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-blue-200/70">Período</div>
                  <Select value={salesPeriod} onValueChange={(v) => setSalesPeriod(v as any)}>
                    <SelectTrigger className="w-full bg-white/[0.06] border-white/20 text-white">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="morning">morning</SelectItem>
                      <SelectItem value="evening">evening</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-blue-200/70">Unidade (obrigatória em run/test)</div>
                  <Select value={salesCellSet || undefined} onValueChange={(v) => setSalesCellSet(v as any)}>
                    <SelectTrigger className="w-full bg-white/[0.06] border-white/20 text-white">
                      <SelectValue placeholder="bss | nh" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bss">bss</SelectItem>
                      <SelectItem value="nh">nh</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 mt-4">
                <div className="flex items-center gap-3">
                  <Switch checked={salesForce} onCheckedChange={setSalesForce} />
                  <div className="text-sm text-blue-200/80">
                    `force` (reenvia mesmo se já executou hoje)
                  </div>
                </div>
                <Button onClick={() => onRunSales()}>
                  Executar
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Separator className="bg-white/10" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="glass-morphism border-white/20">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-white">Últimas execuções</CardTitle>
            <Badge className="bg-white/10 text-white border-white/20">{jobs.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && (
              <div className="text-blue-200/70 text-sm">
                <LoadingPercentText label="Carregando" showPercent={false} />
              </div>
            )}
            {!loading && jobs.length === 0 && (
              <div className="text-blue-200/70 text-sm">
                Nenhum job executado ainda. Use o painel acima.
              </div>
            )}
            {jobs.map((j) => (
              <button
                key={j.id}
                onClick={() => setSelectedJobId(j.id)}
                className={`w-full text-left rounded-xl border px-3 py-2 transition-all ${
                  selectedJobId === j.id
                    ? 'border-white/30 bg-white/[0.08]'
                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate">{j.job}</div>
                    <div className="text-xs text-blue-300/70 truncate">
                      {formatTs(j.startedAt)}{j.endedAt ? ` → ${formatTs(j.endedAt)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {j.status === 'running' && (
                      <Badge className="bg-blue-500/15 text-blue-100 border-blue-400/20">running</Badge>
                    )}
                    {j.status === 'done' && (
                      <Badge className="bg-emerald-500/15 text-emerald-100 border-emerald-400/20">
                        done{typeof j.exitCode === 'number' ? ` (${j.exitCode})` : ''}
                      </Badge>
                    )}
                    {j.status === 'error' && (
                      <Badge className="bg-red-500/15 text-red-100 border-red-400/20">error</Badge>
                    )}
                    {!['running', 'done', 'error'].includes(j.status) && (
                      <Badge className="bg-white/10 text-white border-white/20">{j.status}</Badge>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="glass-morphism border-white/20">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-white">Log</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                value={String(logLines)}
                onChange={(e) => {
                  const n = parseInt(e.target.value || '200', 10)
                  setLogLines(Number.isFinite(n) ? Math.max(10, Math.min(2000, n)) : 200)
                }}
                className="w-24 bg-white/[0.06] border-white/20 text-white"
                placeholder="linhas"
              />
              <Button
                size="sm"
                variant="outline"
                className="bg-white/[0.06] border-white/20 text-white hover:bg-white/[0.12]"
                onClick={() => refreshLog().catch(() => {})}
                disabled={!selectedJobId || loadingLog}
              >
                {loadingLog ? (
                  <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                ) : (
                  'Atualizar'
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {!selectedJob && <div className="text-blue-200/70 text-sm">Selecione um job para ver o log.</div>}
            {selectedJob && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-blue-300/70 truncate">
                    id: {selectedJob.id} • {selectedJob.job}
                  </div>
                  <Badge className="bg-white/10 text-white border-white/20">{selectedJob.status}</Badge>
                </div>
                <pre className="text-xs text-blue-100/90 whitespace-pre-wrap bg-black/30 border border-white/10 rounded-xl p-3 max-h-[420px] overflow-auto">
                  {logTail || '(sem saída ainda)'}
                </pre>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
