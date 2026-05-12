import { useEffect, useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Textarea } from '@/textarea'
import { metaAdsApi, type MetaAdsStatusResponse } from '@/metaAdsApi'
import { MetaTrackingDashboard } from '@/MetaTrackingDashboard'
import { CheckCircle, FacebookLogo, FadersHorizontal, Link, PresentationChart, Spinner, Target } from '@phosphor-icons/react'

type MetaAdAccount = {
  id: string
  name: string
  account_status?: string
  currency?: string
  timezone_name?: string
  business_name?: string
  isSelected?: boolean
}

type MetaCampaignRow = {
  id: string
  name: string
  status?: string
  effective_status?: string
  objective?: string
  totals?: { adSets: number; ads: number }
  adSets?: Array<{ id: string; name: string; ads: any[] }>
}

type MetaInventoryResponse = {
  ok: boolean
  accountId: string
  inventory: {
    campaigns: MetaCampaignRow[]
    adSets: any[]
    ads: any[]
    creatives: any[]
  }
}

const defaultRange = () => {
  const since = format(subDays(new Date(), 6), 'yyyy-MM-dd')
  const until = format(new Date(), 'yyyy-MM-dd')
  return { since, until }
}

function formatCurrency(value: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(Number(value || 0))
  } catch {
    return `${currency || 'USD'} ${Number(value || 0).toFixed(2)}`
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0))
}

function statusTone(status?: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'ACTIVE') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (normalized === 'PAUSED') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  if (normalized === 'ARCHIVED') return 'bg-slate-500/15 text-slate-200 border-slate-500/30'
  return 'bg-white/10 text-blue-100 border-white/10'
}

function emptyState(message: string) {
  return (
    <Card className="glass-card border-white/10">
      <CardContent className="py-10 text-center text-sm text-blue-100/70">
        {message}
      </CardContent>
    </Card>
  )
}

export function MetaCampaignControlCenter() {
  const [status, setStatus] = useState<MetaAdsStatusResponse | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([])
  const [summary, setSummary] = useState<any | null>(null)
  const [trend, setTrend] = useState<any[]>([])
  const [inventory, setInventory] = useState<MetaInventoryResponse['inventory'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const [activeTab, setActiveTab] = useState('tracking')

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.isSelected) || null,
    [accounts],
  )

  const loadStatus = async () => {
    const next = await metaAdsApi.status()
    setStatus(next)
    setStatusError(null)
    return next
  }

  const loadAccounts = async () => {
    const data = await metaAdsApi.listAdAccounts()
    setAccounts(data.accounts || [])
    return data
  }

  const loadOverview = async () => {
    const { since, until } = defaultRange()
    const [nextSummary, nextTrend] = await Promise.all([
      metaAdsApi.summary({ since, until }),
      metaAdsApi.trend({ since, until }),
    ])
    setSummary(nextSummary)
    setTrend(Array.isArray(nextTrend) ? nextTrend : [])
  }

  const loadInventory = async () => {
    const data = await metaAdsApi.inventory()
    setInventory(data.inventory || null)
  }

  const refreshConnectedState = async () => {
    const nextStatus = await loadStatus()
    if (!nextStatus.connection.connected) {
      setAccounts([])
      setSummary(null)
      setTrend([])
      setInventory(null)
      return
    }
    await loadAccounts()
    if (nextStatus.connection.selectedAdAccountId) {
      await Promise.all([loadOverview(), loadInventory()])
    } else {
      setSummary(null)
      setTrend([])
      setInventory(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      setLoading(true)
      try {
        if (!cancelled) await refreshConnectedState()
      } catch (error: any) {
        if (!cancelled) {
          const message = error?.message || 'Falha ao carregar Meta Ads'
          setStatusError(message)
          toast.error(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'meta-ads:connected' || !event.data?.ok) return
      setRefreshing(true)
      refreshConnectedState()
        .then(() => toast.success('Conta Meta Ads conectada'))
        .catch((error: any) => toast.error(error?.message || 'Falha ao concluir conexão'))
        .finally(() => setRefreshing(false))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshConnectedState()
      setStatusError(null)
      toast.success('Meta Ads atualizado')
    } catch (error: any) {
      const message = error?.message || 'Falha ao atualizar'
      setStatusError(message)
      toast.error(message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleOpenOAuth = () => {
    const oauthUrl = metaAdsApi.oauthStartUrl()
    const width = 620
    const height = 760
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))
    const popup = window.open(
      oauthUrl,
      'meta-ads-oauth',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    )
    if (popup) {
      popup.focus?.()
      return
    }
    toast.info('O navegador bloqueou a janela pop-up. A autenticação será aberta nesta mesma aba.')
    window.location.assign(oauthUrl)
  }

  const handleManualConnect = async () => {
    if (!manualToken.trim()) {
      toast.error('Cole um access token válido da Meta.')
      return
    }
    setRefreshing(true)
    try {
      await metaAdsApi.connectManual({ accessToken: manualToken.trim() })
      setManualToken('')
      await refreshConnectedState()
      toast.success('Token manual conectado')
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao conectar token manual')
    } finally {
      setRefreshing(false)
    }
  }

  const handleDisconnect = async () => {
    setRefreshing(true)
    try {
      await metaAdsApi.disconnect()
      await refreshConnectedState()
      toast.success('Conexão Meta Ads removida')
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao desconectar')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSelectAccount = async (adAccountId: string) => {
    setRefreshing(true)
    try {
      await metaAdsApi.selectAdAccount({ adAccountId })
      await refreshConnectedState()
      toast.success('Conta de anúncios selecionada')
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao selecionar conta')
    } finally {
      setRefreshing(false)
    }
  }

  const creativeCount = inventory?.creatives?.length || 0
  const adCount = inventory?.ads?.length || 0
  const adSetCount = inventory?.adSets?.length || 0
  const campaignCount = inventory?.campaigns?.length || 0
  const missingConfig = status?.missingConfig || []
  const connectActionsDisabled = loading || refreshing || !!missingConfig.length || !!statusError

  return (
    <div className="space-y-6 animate-fade-in">
      <Card className="glass-card border-white/10">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-3 text-white">
              <div className="flex items-center gap-2">
                <FacebookLogo className="h-6 w-6 text-blue-400" />
                <Target className="h-6 w-6 text-pink-400" />
              </div>
              Meta Ads
            </CardTitle>
            <CardDescription>
              Conecte o Gerenciador de Anúncios da Meta ao CRM e explore campanhas, conjuntos, anúncios e criativos em tempo real.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status?.connection.connected ? (
              <Badge className="bg-emerald-500/15 text-emerald-200 border border-emerald-500/30">
                <CheckCircle className="mr-1 h-4 w-4" />
                Conectado
              </Badge>
            ) : (
              <Badge className="bg-amber-500/15 text-amber-200 border border-amber-500/30">
                <Link className="mr-1 h-4 w-4" />
                Não conectado
              </Badge>
            )}
            <Button variant="outline" onClick={handleRefresh} disabled={loading || refreshing}>
              {refreshing ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
              Atualizar
            </Button>
            {status?.connection.connected ? (
              <Button variant="outline" onClick={handleDisconnect} disabled={refreshing}>
                Desconectar
              </Button>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {missingConfig.length ? (
        <Card className="glass-card border-amber-500/30 bg-amber-500/10">
          <CardContent className="pt-6 text-sm text-amber-100">
            Faltam configurações de runtime para OAuth/armazenamento: <span className="font-mono">{missingConfig.join(', ')}</span>
          </CardContent>
        </Card>
      ) : null}

      {statusError ? (
        <Card className="glass-card border-rose-500/30 bg-rose-500/10">
          <CardContent className="pt-6 text-sm text-rose-100">
            Não foi possível preparar a integração Meta Ads. <span className="font-medium">{statusError}</span>
          </CardContent>
        </Card>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-4xl grid-cols-4 glass-morphism p-2 border-white/20">
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="connect">Conexão</TabsTrigger>
          <TabsTrigger value="inventory">Inventário</TabsTrigger>
        </TabsList>

        <TabsContent value="tracking" className="space-y-6">
          <MetaTrackingDashboard />
        </TabsContent>

        <TabsContent value="overview" className="space-y-6">
          {!status?.connection.connected
            ? emptyState('Conecte uma conta Meta Ads para carregar spend, tendência e inventário.')
            : !selectedAccount
              ? emptyState('Escolha uma conta de anúncios na aba Conexão para carregar os dados.')
              : (
                <>
                  <div className="grid gap-4 md:grid-cols-4">
                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardDescription>Spend (7 dias)</CardDescription>
                        <CardTitle>{formatCurrency(summary?.spend ?? 0, selectedAccount.currency || 'USD')}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardDescription>Impressões</CardDescription>
                        <CardTitle>{formatNumber(summary?.impressions ?? 0)}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardDescription>Clicks</CardDescription>
                        <CardTitle>{formatNumber(summary?.clicks ?? 0)}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardDescription>Campanhas ativas</CardDescription>
                        <CardTitle>{formatNumber(summary?.activeCampaigns ?? 0)}</CardTitle>
                      </CardHeader>
                    </Card>
                  </div>

                  <div className="grid gap-4 md:grid-cols-4">
                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardDescription>Campanhas</CardDescription>
                        <CardTitle>{campaignCount}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardDescription>Conjuntos</CardDescription>
                        <CardTitle>{adSetCount}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardDescription>Anúncios</CardDescription>
                        <CardTitle>{adCount}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardDescription>Criativos</CardDescription>
                        <CardTitle>{creativeCount}</CardTitle>
                      </CardHeader>
                    </Card>
                  </div>

                  <Card className="glass-card border-white/10">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <PresentationChart className="h-5 w-5 text-blue-300" />
                        Tendência de gasto
                      </CardTitle>
                      <CardDescription>Últimos 7 dias da conta selecionada.</CardDescription>
                    </CardHeader>
                    <CardContent className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trend}>
                          <XAxis dataKey="day" />
                          <YAxis />
                          <Tooltip />
                          <Line type="monotone" dataKey="spend" stroke="#38bdf8" strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </>
              )}
        </TabsContent>

        <TabsContent value="connect" className="space-y-6">
          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle>Conectar com Facebook</CardTitle>
              <CardDescription>
                Use OAuth para autorizar leitura e gestão do Gerenciador de Anúncios com os escopos da Meta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleOpenOAuth} disabled={connectActionsDisabled}>
                  Conectar via Facebook
                </Button>
                <Badge className="bg-white/10 text-blue-100 border border-white/10">
                  Escopos: {status?.connection.scopes?.join(', ') || 'ads_read, ads_management, business_management'}
                </Badge>
              </div>
              {status?.connection.connected ? (
                <div className="text-sm text-blue-100/70">
                  Usuário conectado: <span className="font-medium text-white">{status.connection.metaUserName || status.connection.metaUserId || 'Meta User'}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle>Conectar por token manual</CardTitle>
              <CardDescription>
                Alternativa para tokens de longa duração ou integrações administrativas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Cole aqui o access token da Meta"
                className="min-h-28"
              />
              <div className="flex justify-end">
                <Button onClick={handleManualConnect} disabled={refreshing || !manualToken.trim()}>
                  Validar e conectar token
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle>Contas de anúncios</CardTitle>
              <CardDescription>
                Depois da conexão, selecione a conta que deve alimentar campanhas, conjuntos, anúncios e criativos no CRM.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!status?.connection.connected ? (
                <div className="text-sm text-blue-100/70">Conecte a Meta primeiro para listar as contas disponíveis.</div>
              ) : accounts.length === 0 ? (
                <div className="text-sm text-blue-100/70">Nenhuma conta encontrada para este usuário/token.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Conta</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Moeda</TableHead>
                      <TableHead>Timezone</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell className="font-mono">{account.id}</TableCell>
                        <TableCell>{account.name || '—'}</TableCell>
                        <TableCell>{account.currency || '—'}</TableCell>
                        <TableCell>{account.timezone_name || '—'}</TableCell>
                        <TableCell className="text-right">
                          {account.isSelected ? (
                            <Badge className="bg-emerald-500/15 text-emerald-200 border border-emerald-500/30">Selecionada</Badge>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => handleSelectAccount(account.id)} disabled={refreshing}>
                              Selecionar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-6">
          {!status?.connection.connected
            ? emptyState('Conecte uma conta Meta Ads para liberar o inventário.')
            : !selectedAccount
              ? emptyState('Selecione uma conta de anúncios para carregar campanhas, conjuntos, anúncios e criativos.')
              : !inventory
                ? emptyState('Ainda não foi possível carregar o inventário desta conta. Clique em Atualizar.')
                : (
                  <>
                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <FadersHorizontal className="h-5 w-5 text-blue-300" />
                          Campanhas
                        </CardTitle>
                        <CardDescription>
                          Relação da conta selecionada com total de conjuntos e anúncios por campanha.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Campanha</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Objetivo</TableHead>
                              <TableHead>Conjuntos</TableHead>
                              <TableHead>Anúncios</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {inventory.campaigns.map((campaign) => (
                              <TableRow key={campaign.id}>
                                <TableCell>
                                  <div className="space-y-1">
                                    <div className="font-medium text-white">{campaign.name || campaign.id}</div>
                                    <div className="font-mono text-xs text-blue-100/60">{campaign.id}</div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge className={statusTone(campaign.effective_status || campaign.status)}>
                                    {campaign.effective_status || campaign.status || '—'}
                                  </Badge>
                                </TableCell>
                                <TableCell>{campaign.objective || '—'}</TableCell>
                                <TableCell>{campaign.totals?.adSets || 0}</TableCell>
                                <TableCell>{campaign.totals?.ads || 0}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>

                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardTitle>Anúncios</CardTitle>
                        <CardDescription>
                          Mapa direto de anúncios com campanha, conjunto e criativo associados.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Anúncio</TableHead>
                              <TableHead>Campanha</TableHead>
                              <TableHead>Conjunto</TableHead>
                              <TableHead>Criativo</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {inventory.ads.map((ad: any) => (
                              <TableRow key={ad.id}>
                                <TableCell>
                                  <div className="space-y-1">
                                    <div className="font-medium text-white">{ad.name || ad.id}</div>
                                    <div className="font-mono text-xs text-blue-100/60">{ad.id}</div>
                                  </div>
                                </TableCell>
                                <TableCell>{ad.campaign_name || ad.campaign_id || '—'}</TableCell>
                                <TableCell>{ad.adset_name || ad.adset_id || '—'}</TableCell>
                                <TableCell>{ad.creative?.name || ad.creative?.id || '—'}</TableCell>
                                <TableCell>
                                  <Badge className={statusTone(ad.effective_status || ad.status)}>
                                    {ad.effective_status || ad.status || '—'}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>

                    <Card className="glass-card border-white/10">
                      <CardHeader>
                        <CardTitle>Criativos</CardTitle>
                        <CardDescription>
                          Criativos deduplicados a partir dos anúncios retornados pela Meta para a conta selecionada.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {inventory.creatives.length === 0 ? (
                          <div className="text-sm text-blue-100/70">Nenhum criativo encontrado.</div>
                        ) : (
                          inventory.creatives.map((creative: any) => (
                            <div key={creative.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                              {creative.thumbnailUrl ? (
                                <img
                                  src={creative.thumbnailUrl}
                                  alt={creative.name || creative.id}
                                  className="mb-3 h-40 w-full rounded-xl object-cover"
                                />
                              ) : null}
                              <div className="space-y-1">
                                <div className="font-medium text-white">{creative.name || creative.id}</div>
                                <div className="font-mono text-xs text-blue-100/60">{creative.id}</div>
                                <div className="text-xs text-blue-100/70">Campanha: {creative.campaignId || '—'}</div>
                                <div className="text-xs text-blue-100/70">Anúncio: {creative.adName || creative.adId || '—'}</div>
                              </div>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </>
                )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
