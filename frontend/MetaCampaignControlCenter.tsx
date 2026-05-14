import { useEffect, useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { toast } from 'sonner'
import { Card, CardContent } from '@/card'
import { Tabs, TabsContent } from '@/tabs'
import { MetaTrackingDashboard } from '@/MetaTrackingDashboard'
import { metaAdsApi } from '@/metaAdsApi'
import {
  MetaAdsAccountsPanel,
  MetaAdsConnectionPanel,
  MetaAdsConnectionProgress,
  MetaAdsEmptyState,
  MetaAdsHealthBanner,
  MetaAdsInventoryPanel,
  MetaAdsOverviewPanel,
  MetaAdsPersistentError,
  MetaAdsStatusHero,
  MetaAdsWorkspaceTabs,
} from '@/metaAdsPanels'
import { buildMetaAdsHealthState, deriveMetaAdsConnectionMode, getDefaultMetaAdsTab } from '@/metaAdsState'
import type {
  MetaAdAccount,
  MetaAdsApiError,
  MetaAdsStatusResponse,
  MetaAdsSummaryResponse,
  MetaAdsTab,
  MetaAdsTrendPoint,
  MetaInventoryResponse,
} from '@/metaAdsTypes'

const defaultRange = () => {
  const since = format(subDays(new Date(), 6), 'yyyy-MM-dd')
  const until = format(new Date(), 'yyyy-MM-dd')
  return { since, until }
}

export function MetaCampaignControlCenter() {
  const [status, setStatus] = useState<MetaAdsStatusResponse | null>(null)
  const [statusError, setStatusError] = useState<MetaAdsApiError | null>(null)
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([])
  const [accountsError, setAccountsError] = useState<MetaAdsApiError | null>(null)
  const [summary, setSummary] = useState<MetaAdsSummaryResponse | null>(null)
  const [trend, setTrend] = useState<MetaAdsTrendPoint[]>([])
  const [overviewError, setOverviewError] = useState<MetaAdsApiError | null>(null)
  const [inventory, setInventory] = useState<MetaInventoryResponse['inventory'] | null>(null)
  const [inventoryError, setInventoryError] = useState<MetaAdsApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const [activeTab, setActiveTab] = useState<MetaAdsTab>('connect')
  const [didAutofocusReadyFlow, setDidAutofocusReadyFlow] = useState(false)

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.isSelected) || null,
    [accounts],
  )

  const connectionMode = useMemo(
    () => deriveMetaAdsConnectionMode({ status, statusError, selectedAccount }),
    [status, statusError, selectedAccount],
  )

  const healthState = useMemo(
    () => buildMetaAdsHealthState({ mode: connectionMode, selectedAccount, status, statusError }),
    [connectionMode, selectedAccount, status, statusError],
  )

  const resetConnectedData = () => {
    setAccounts([])
    setAccountsError(null)
    setSummary(null)
    setTrend([])
    setOverviewError(null)
    setInventory(null)
    setInventoryError(null)
  }

  const loadStatus = async () => {
    const next = await metaAdsApi.status()
    setStatus(next)
    setStatusError(null)
    return next
  }

  const loadAccounts = async () => {
    try {
      const data = await metaAdsApi.listAdAccounts()
      setAccounts(data.accounts || [])
      setAccountsError(null)
      return data
    } catch (error: any) {
      setAccounts([])
      setAccountsError(error)
      throw error
    }
  }

  const loadOverview = async () => {
    try {
      const { since, until } = defaultRange()
      const [nextSummary, nextTrend] = await Promise.all([
        metaAdsApi.summary({ since, until }),
        metaAdsApi.trend({ since, until }),
      ])
      setSummary(nextSummary)
      setTrend(Array.isArray(nextTrend) ? nextTrend : [])
      setOverviewError(null)
    } catch (error: any) {
      setSummary(null)
      setTrend([])
      setOverviewError(error)
      throw error
    }
  }

  const loadInventory = async () => {
    try {
      const data = await metaAdsApi.inventory()
      setInventory(data.inventory || null)
      setInventoryError(null)
    } catch (error: any) {
      setInventory(null)
      setInventoryError(error)
      throw error
    }
  }

  const refreshConnectedState = async () => {
    const nextStatus = await loadStatus()
    if (!nextStatus.connection.connected) {
      resetConnectedData()
      return nextStatus
    }

    await loadAccounts().catch(() => null)

    if (!nextStatus.connection.selectedAdAccountId) {
      setSummary(null)
      setTrend([])
      setOverviewError(null)
      setInventory(null)
      setInventoryError(null)
      return nextStatus
    }

    await Promise.allSettled([loadOverview(), loadInventory()])
    return nextStatus
  }

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      setLoading(true)
      try {
        if (!cancelled) await refreshConnectedState()
      } catch (error: any) {
        if (!cancelled) {
          setStatus(null)
          setStatusError(error)
          toast.error(error?.message || 'Falha ao carregar Meta Ads')
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
    if (
      (connectionMode === 'disconnected' ||
        connectionMode === 'unauthorized' ||
        connectionMode === 'connected-no-account' ||
        connectionMode === 'forbidden' ||
        connectionMode === 'misconfigured') &&
      activeTab !== 'connect'
    ) {
      setActiveTab('connect')
      return
    }
    if (connectionMode !== 'connected-ready' && connectionMode !== 'degraded') {
      setDidAutofocusReadyFlow(false)
      return
    }
    if (!didAutofocusReadyFlow && activeTab === 'connect') {
      setActiveTab(getDefaultMetaAdsTab(connectionMode))
      setDidAutofocusReadyFlow(true)
    }
  }, [activeTab, connectionMode, didAutofocusReadyFlow])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'meta-ads:connected' || !event.data?.ok) return
      setRefreshing(true)
      refreshConnectedState()
        .then(() => {
          setActiveTab('connect')
          toast.success('Conta Meta Ads conectada')
        })
        .catch((error: any) => {
          setStatusError(error)
          toast.error(error?.message || 'Falha ao concluir conexão')
        })
        .finally(() => setRefreshing(false))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshConnectedState()
      toast.success('Meta Ads atualizado')
    } catch (error: any) {
      setStatusError(error)
      toast.error(error?.message || 'Falha ao atualizar')
    } finally {
      setRefreshing(false)
    }
  }

  const handleOpenOAuth = () => {
    if (metaAdsApi.isLocalMockMode()) {
      setRefreshing(true)
      metaAdsApi
        .simulateOAuthConnect()
        .then(() => refreshConnectedState())
        .then(() => {
          setActiveTab('connect')
          toast.success('Conexão Meta Ads simulada no ambiente local')
        })
        .catch((error: any) => {
          setStatusError(error)
          toast.error(error?.message || 'Falha ao iniciar a simulação local do Meta Ads')
        })
        .finally(() => setRefreshing(false))
      return
    }
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
      setActiveTab('connect')
      toast.success('Token manual conectado')
    } catch (error: any) {
      setStatusError(error)
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
      setActiveTab('connect')
      toast.success('Conexão Meta Ads removida')
    } catch (error: any) {
      setStatusError(error)
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
      setActiveTab('overview')
      toast.success('Conta de anúncios selecionada')
    } catch (error: any) {
      setAccountsError(error)
      toast.error(error?.message || 'Falha ao selecionar conta')
    } finally {
      setRefreshing(false)
    }
  }

  const handleNavigateTab = (tab: MetaAdsTab) => setActiveTab(tab)

  const missingConfig = status?.missingConfig || []
  const connectActionsDisabled =
    loading ||
    refreshing ||
    !!missingConfig.length ||
    connectionMode === 'unauthorized' ||
    connectionMode === 'forbidden' ||
    connectionMode === 'misconfigured'
  const scopesLabel = status?.connection.scopes?.join(', ') || 'ads_read, ads_management, business_management'
  const oauthMode = status?.oauthMode || 'scopes'
  const businessLoginConfigId = status?.businessLoginConfigId || null
  const connectedUser = status?.connection.metaUserName || status?.connection.metaUserId || null
  const showWorkspaceTabs = connectionMode === 'connected-ready' || connectionMode === 'degraded'
  const showAccountSelection = Boolean(status?.connection.connected)

  return (
    <div className="meta-ads-surface space-y-6 animate-fade-in">
      <MetaAdsStatusHero
        connected={Boolean(status?.connection.connected)}
        refreshing={loading || refreshing}
        onRefresh={handleRefresh}
        onDisconnect={handleDisconnect}
      />

      <MetaAdsPersistentError error={statusError} onRetry={handleRefresh} />

      {!showWorkspaceTabs ? (
        <div className="space-y-6">
          <MetaAdsConnectionProgress
            connected={Boolean(status?.connection.connected)}
            hasSelectedAccount={Boolean(selectedAccount)}
          />
          <MetaAdsConnectionPanel
            scopesLabel={scopesLabel}
            oauthMode={oauthMode}
            businessLoginConfigId={businessLoginConfigId}
            connectedUser={connectedUser}
            connectDisabled={connectActionsDisabled}
            onOAuth={handleOpenOAuth}
            manualToken={manualToken}
            setManualToken={setManualToken}
            onManualConnect={handleManualConnect}
            manualDisabled={refreshing || !manualToken.trim()}
          />
          {showAccountSelection ? (
            <MetaAdsHealthBanner
              health={healthState}
              statusUpdatedAt={status?.connection.updatedAt}
              selectedAccount={selectedAccount}
              onNavigate={handleNavigateTab}
            />
          ) : null}
          {showAccountSelection ? (
            <MetaAdsAccountsPanel
              connected={Boolean(status?.connection.connected)}
              accounts={accounts}
              refreshing={refreshing}
              accountsError={accountsError}
              onRetry={handleRefresh}
              onSelectAccount={handleSelectAccount}
            />
          ) : null}
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as MetaAdsTab)} className="space-y-6">
          <MetaAdsHealthBanner
            health={healthState}
            statusUpdatedAt={status?.connection.updatedAt}
            selectedAccount={selectedAccount}
            onNavigate={handleNavigateTab}
          />
          <MetaAdsWorkspaceTabs />

          <TabsContent value="connect" className="space-y-6">
            <MetaAdsConnectionProgress
              connected={Boolean(status?.connection.connected)}
              hasSelectedAccount={Boolean(selectedAccount)}
            />
            <MetaAdsConnectionPanel
              scopesLabel={scopesLabel}
              oauthMode={oauthMode}
              businessLoginConfigId={businessLoginConfigId}
              connectedUser={connectedUser}
              connectDisabled={connectActionsDisabled}
              onOAuth={handleOpenOAuth}
              manualToken={manualToken}
              setManualToken={setManualToken}
              onManualConnect={handleManualConnect}
              manualDisabled={refreshing || !manualToken.trim()}
            />
            <MetaAdsAccountsPanel
              connected={Boolean(status?.connection.connected)}
              accounts={accounts}
              refreshing={refreshing}
              accountsError={accountsError}
              onRetry={handleRefresh}
              onSelectAccount={handleSelectAccount}
            />
          </TabsContent>

          <TabsContent value="overview" className="space-y-6">
            {!status?.connection.connected ? (
              <MetaAdsEmptyState
                message="Conecte uma conta Meta Ads para carregar spend, tendência e inventário."
                actionLabel="Ir para conexão"
                onAction={() => setActiveTab('connect')}
              />
            ) : !selectedAccount ? (
              <MetaAdsEmptyState
                message="Escolha uma conta de anúncios para liberar a visão geral."
                actionLabel="Selecionar conta"
                onAction={() => setActiveTab('connect')}
              />
            ) : (
              <MetaAdsOverviewPanel
                selectedAccount={selectedAccount}
                summary={summary}
                trend={trend}
                inventory={inventory}
                overviewError={overviewError}
                onRetry={handleRefresh}
              />
            )}
          </TabsContent>

          <TabsContent value="inventory" className="space-y-6">
            {!status?.connection.connected ? (
              <MetaAdsEmptyState
                message="Conecte uma conta Meta Ads para liberar o inventário."
                actionLabel="Ir para conexão"
                onAction={() => setActiveTab('connect')}
              />
            ) : !selectedAccount ? (
              <MetaAdsEmptyState
                message="Selecione uma conta de anúncios para carregar campanhas, conjuntos, anúncios e criativos."
                actionLabel="Selecionar conta"
                onAction={() => setActiveTab('connect')}
              />
            ) : !inventory ? (
              <MetaAdsEmptyState
                message="Ainda não foi possível carregar o inventário desta conta."
                actionLabel="Atualizar agora"
                onAction={handleRefresh}
              />
            ) : (
              <MetaAdsInventoryPanel inventory={inventory} inventoryError={inventoryError} onRetry={handleRefresh} />
            )}
          </TabsContent>

          <TabsContent value="tracking" className="space-y-6">
            <Card className="border-slate-800/80 bg-slate-950/55 shadow-[0_20px_80px_rgba(2,6,23,0.35)] backdrop-blur-xl">
              <CardContent className="pt-6 text-sm leading-6 text-slate-300">
                Tracking do site e inventário da conta Meta convivem nesta aba, mas são superfícies diferentes: aqui você acompanha os sinais e eventos do site; nas etapas anteriores você conecta a conta e escolhe qual estrutura da Meta deve alimentar o CRM.
              </CardContent>
            </Card>
            <MetaTrackingDashboard />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
