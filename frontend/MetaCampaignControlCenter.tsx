import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Input } from '@/input'
import { Badge } from '@/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { metaAdsApi, setMetaAdsToken, getMetaAdsToken } from '@/metaAdsApi'
import { formatCurrency, formatNumber, getStatusColor } from '@/utils'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { format, subDays } from 'date-fns'

const defaultRange = () => {
  const since = format(subDays(new Date(), 6), 'yyyy-MM-dd')
  const until = format(new Date(), 'yyyy-MM-dd')
  return { since, until }
}

export function MetaCampaignControlCenter() {
  const [token, setToken] = useState<string | null>(getMetaAdsToken())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [summary, setSummary] = useState<any | null>(null)
  const [trend, setTrend] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [bulkOps, setBulkOps] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgName, setOrgName] = useState('')

  const [actionType, setActionType] = useState<'pause' | 'resume' | 'budget' | 'rename' | 'duplicate'>('pause')
  const [budgetMode, setBudgetMode] = useState<'absolute' | 'percent'>('absolute')
  const [budgetValue, setBudgetValue] = useState(0)
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [deepCopy, setDeepCopy] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [preview, setPreview] = useState<any | null>(null)
  const [nameFilter, setNameFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const refreshDashboard = async () => {
    const { since, until } = defaultRange()
    const [sum, tr] = await Promise.all([metaAdsApi.summary({ since, until }), metaAdsApi.trend({ since, until })])
    setSummary(sum)
    setTrend(tr as any[])
  }

  const refreshCampaigns = async () => {
    const rows = await metaAdsApi.listCampaigns()
    setCampaigns(rows as any[])
  }

  const refreshBulkOps = async () => {
    const rows = await metaAdsApi.bulkOperations()
    setBulkOps(rows as any[])
  }

  const refreshAlerts = async () => {
    const rows = await metaAdsApi.alerts()
    setAlerts(rows as any[])
  }

  useEffect(() => {
    if (!token) return
    setLoading(true)
    refreshDashboard()
      .then(refreshCampaigns)
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!token) return
    const interval = setInterval(() => {
      refreshBulkOps().catch(() => null)
    }, 5000)
    return () => clearInterval(interval)
  }, [token])

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((row) => {
      const matchesName = nameFilter ? row.name?.toLowerCase().includes(nameFilter.toLowerCase()) : true
      const matchesStatus = statusFilter === 'all' ? true : row.status === statusFilter
      return matchesName && matchesStatus
    })
  }, [campaigns, nameFilter, statusFilter])

  const selectedList = Object.entries(selectedIds)
    .filter(([, v]) => v)
    .map(([id]) => id)

  const handleRegister = async () => {
    const res: any = await metaAdsApi.register({ email, password, orgName: orgName || 'Minha Org' })
    setMetaAdsToken(res.token)
    setToken(res.token)
    setMessage('Registrado com sucesso')
  }

  const handleLogin = async () => {
    const res: any = await metaAdsApi.login({ email, password })
    setMetaAdsToken(res.token)
    setToken(res.token)
    setMessage('Login OK')
  }

  const handleOAuth = async () => {
    const res: any = await metaAdsApi.oauthUrl()
    window.open(res.url, '_blank')
  }

  const handleLoadAccounts = async () => {
    const data: any = await metaAdsApi.listAdAccounts()
    setAccounts(data)
  }

  const handleSelectAccount = async (id: string) => {
    await metaAdsApi.selectAdAccount({ adAccountId: id })
    setMessage('Conta selecionada')
  }

  const handlePreview = async () => {
    const payload =
      actionType === 'budget'
        ? { mode: budgetMode, value: budgetValue }
        : actionType === 'rename'
          ? { prefix, suffix }
          : actionType === 'duplicate'
            ? { prefix, suffix, deepCopy }
            : undefined
    const res = await metaAdsApi.bulkPreview({ entityType: 'campaign', actionType, ids: selectedList, payload })
    setPreview(res)
  }

  const handleExecute = async () => {
    const payload =
      actionType === 'budget'
        ? { mode: budgetMode, value: budgetValue }
        : actionType === 'rename'
          ? { prefix, suffix }
          : actionType === 'duplicate'
            ? { prefix, suffix, deepCopy }
            : undefined
    await metaAdsApi.bulkExecute({ entityType: 'campaign', actionType, ids: selectedList, payload })
    setPreview(null)
    refreshBulkOps().catch(() => null)
  }

  const handleSyncInsights = async () => {
    const { since, until } = defaultRange()
    await metaAdsApi.syncInsights({ level: 'campaign', since, until })
    await refreshDashboard()
  }

  if (!token) {
    return (
      <Card className="border-muted/60">
        <CardHeader>
          <CardTitle>Meta Campaign Control Center</CardTitle>
          <CardDescription>Autenticacao local do subprojeto Meta Ads.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input placeholder="Org (registro)" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={handleRegister}>Registrar</Button>
            <Button variant="outline" onClick={handleLogin}>Login</Button>
          </div>
          {message ? <Badge className="bg-emerald-500/10 text-emerald-200">{message}</Badge> : null}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Meta Campaign Control Center</CardTitle>
            <CardDescription>Operacao e performance de campanhas Meta Ads.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={refreshDashboard} disabled={loading}>Atualizar</Button>
            <Button onClick={handleSyncInsights}>Sync Insights (7d)</Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="connect">Conectar</TabsTrigger>
          <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
          <TabsTrigger value="bulk">Bulk Ops</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader>
                <CardDescription>Spend</CardDescription>
                <CardTitle>{formatCurrency(summary?.spend ?? 0, 'USD')}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Campanhas ativas</CardDescription>
                <CardTitle>{summary?.activeCampaigns ?? 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>ROAS medio</CardDescription>
                <CardTitle>{summary?.roas ? `${summary.roas.toFixed(2)}x` : '—'}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Clicks</CardDescription>
                <CardTitle>{formatNumber(summary?.clicks ?? 0)}</CardTitle>
              </CardHeader>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Tendencia de gasto (7 dias)</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="spend" stroke="#0ea5e9" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connect" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Meta OAuth</CardTitle>
              <CardDescription>Conecte a conta Meta do usuario.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button onClick={handleOAuth}>Abrir OAuth</Button>
                <Button variant="outline" onClick={handleLoadAccounts}>Listar contas</Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((acc) => (
                    <TableRow key={acc.id}>
                      <TableCell>{acc.name}</TableCell>
                      <TableCell>{acc.metaAccountId ?? acc.id}</TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => handleSelectAccount(acc.id)}>Selecionar</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {message ? <Badge className="bg-emerald-500/10 text-emerald-200">{message}</Badge> : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Bulk Actions</CardTitle>
              <CardDescription>Selecione campanhas e aplique acoes em lote.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="border rounded px-2 py-1 text-sm bg-transparent"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as any)}
                >
                  <option value="pause">Pause</option>
                  <option value="resume">Resume</option>
                  <option value="budget">Ajustar budget</option>
                  <option value="rename">Renomear</option>
                  <option value="duplicate">Duplicar</option>
                </select>
                {actionType === 'budget' ? (
                  <div className="flex items-center gap-2">
                    <select
                      className="border rounded px-2 py-1 text-sm bg-transparent"
                      value={budgetMode}
                      onChange={(e) => setBudgetMode(e.target.value as any)}
                    >
                      <option value="absolute">Valor</option>
                      <option value="percent">%</option>
                    </select>
                    <Input
                      className="w-24"
                      type="number"
                      value={budgetValue}
                      onChange={(e) => setBudgetValue(Number(e.target.value))}
                    />
                  </div>
                ) : null}
                {actionType === 'rename' || actionType === 'duplicate' ? (
                  <div className="flex items-center gap-2">
                    <Input className="w-28" placeholder="Prefixo" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
                    <Input className="w-28" placeholder="Sufixo" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
                  </div>
                ) : null}
                {actionType === 'duplicate' ? (
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={deepCopy} onChange={(e) => setDeepCopy(e.target.checked)} />
                    Deep copy
                  </label>
                ) : null}
                <Button variant="outline" onClick={handlePreview} disabled={selectedList.length === 0}>Preview</Button>
                <Badge className="bg-white/10">{selectedList.length} selecionadas</Badge>
              </div>
              {preview ? (
                <div className="border rounded p-3 space-y-2">
                  <div className="text-sm">{preview.count} itens serao afetados</div>
                  {preview.previews.map((p: any) => (
                    <div key={p.id} className="text-xs">
                      {p.id}: {p.error ? `Erro: ${p.error}` : actionType === 'budget' ? `${p.before.dailyBudget ?? '-'} → ${p.after.dailyBudget ?? '-'}` : actionType === 'rename' || actionType === 'duplicate' ? `${p.before.name} → ${p.after.name}` : `${p.before.status} → ${p.after.status}`}
                    </div>
                  ))}
                  <Button onClick={handleExecute} disabled={preview.previews.some((p: any) => !p.valid)}>Executar</Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Campanhas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="Filtrar por nome" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} />
                <select className="border rounded px-2 py-1 text-sm bg-transparent" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">Status (todos)</option>
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused</option>
                </select>
                <Button variant="outline" onClick={refreshCampaigns}>Recarregar</Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Objetivo</TableHead>
                    <TableHead>Budget diario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCampaigns.map((row) => (
                    <TableRow key={row.metaId || row.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={!!selectedIds[row.metaId || row.id]}
                          onChange={(e) => {
                            const id = row.metaId || row.id
                            setSelectedIds((prev) => ({ ...prev, [id]: e.target.checked }))
                          }}
                        />
                      </TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs ${getStatusColor(row.status)}`}>{row.status}</span>
                      </TableCell>
                      <TableCell>{row.objective || '—'}</TableCell>
                      <TableCell>{row.dailyBudget ? formatCurrency(row.dailyBudget / 100, 'USD') : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bulk" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Bulk Operations</CardTitle>
              <CardDescription>Historico e status das operacoes em lote.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progresso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bulkOps.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell>{op.actionType}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs ${getStatusColor(op.status)}`}>{op.status}</span>
                      </TableCell>
                      <TableCell>
                        {op.processedItems}/{op.totalItems}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Alerts</CardTitle>
              <CardDescription>Pacing e anomalias detectadas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.map((alert) => (
                <div key={alert.id} className="flex items-center justify-between border rounded p-3">
                  <div>
                    <div className="font-medium">{alert.type}</div>
                    <div className="text-xs text-muted-foreground">{alert.message}</div>
                  </div>
                  <Button size="sm" onClick={() => metaAdsApi.resolveAlert(alert.id).then(refreshAlerts)}>Resolver</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
