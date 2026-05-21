import { useEffect, useMemo, useRef, useState } from 'react'
import { format, subDays } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { MetaTrackingDashboard } from '@/MetaTrackingDashboard'
import { metaAdsApi } from '@/metaAdsApi'
import { emitMetaAdsHeaderState, subscribeMetaAdsHeaderAction } from '@/metaAdsHeaderBridge'
import {
  MetaAdsAccountsPanel,
  MetaAdsConnectionPanel,
  MetaAdsEmptyState,
  MetaAdsHealthBanner,
  MetaAdsInventoryPanel,
  MetaAdsOAuthDialog,
  MetaAdsOverviewPanel,
  MetaAdsPersistentError,
} from '@/metaAdsPanels'
import { buildMetaAdsHealthState, deriveMetaAdsConnectionMode, describeMetaAdAccountStatus } from '@/metaAdsState'
import type {
  MetaAdAccount,
  MetaAdsApiError,
  MetaAdsCustomDateRange,
  MetaAdsReportResponse,
  MetaAdsReportWindowDays,
  MetaAdsHeaderState,
  MetaAdsStatusResponse,
  MetaAdsSummaryResponse,
  MetaAdsTrendPoint,
  MetaInventoryResponse,
} from '@/metaAdsTypes'

const DEFAULT_REPORT_WINDOW_DAYS: MetaAdsReportWindowDays = 30

const buildRange = (days: MetaAdsReportWindowDays) => {
  const since = format(subDays(new Date(), Math.max(0, days - 1)), 'yyyy-MM-dd')
  const until = format(new Date(), 'yyyy-MM-dd')
  return { since, until }
}

function formatCustomRangeLabel(range: MetaAdsCustomDateRange | null) {
  if (!range) return ''
  return `${range.since} -> ${range.until}`
}

export function MetaCampaignControlCenter() {
  const [status, setStatus] = useState<MetaAdsStatusResponse | null>(null)
  const [statusError, setStatusError] = useState<MetaAdsApiError | null>(null)
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([])
  const [accountsError, setAccountsError] = useState<MetaAdsApiError | null>(null)
  const [summary, setSummary] = useState<MetaAdsSummaryResponse | null>(null)
  const [trend, setTrend] = useState<MetaAdsTrendPoint[]>([])
  const [overviewError, setOverviewError] = useState<MetaAdsApiError | null>(null)
  const [report, setReport] = useState<MetaAdsReportResponse | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [inventory, setInventory] = useState<MetaInventoryResponse['inventory'] | null>(null)
  const [inventoryError, setInventoryError] = useState<MetaAdsApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const [reportWindowDays, setReportWindowDays] = useState<MetaAdsReportWindowDays>(DEFAULT_REPORT_WINDOW_DAYS)
  const [customRange, setCustomRange] = useState<MetaAdsCustomDateRange | null>(null)
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const [customRangeDraft, setCustomRangeDraft] = useState<MetaAdsCustomDateRange>(buildRange(DEFAULT_REPORT_WINDOW_DAYS))
  const [oauthDialogOpen, setOauthDialogOpen] = useState(false)
  const [oauthDialogState, setOauthDialogState] = useState<'opening' | 'opened' | 'blocked' | 'closed' | 'error'>('opening')
  const [oauthDialogError, setOauthDialogError] = useState<MetaAdsApiError | null>(null)
  const [manageConnectionsOpen, setManageConnectionsOpen] = useState(false)
  const oauthPopupRef = useRef<Window | null>(null)
  const oauthPollRef = useRef<number | null>(null)

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
  const metaAdsHeaderState = useMemo<MetaAdsHeaderState>(
    () => {
      return {
        refreshing: loading || refreshing,
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name || account.id,
          statusLabel: describeMetaAdAccountStatus(account).label,
          statusTone: describeMetaAdAccountStatus(account).tone,
        })),
        selectedAccountId: selectedAccount?.id || '',
        reportWindowDays,
        customRangeActive: Boolean(customRange),
        customRangeLabel: customRange ? formatCustomRangeLabel(customRange) : undefined,
        selectedAccountName: selectedAccount?.name || selectedAccount?.id || undefined,
        sessionUpdatedAt: status?.connection.updatedAt || undefined,
      }
    },
    [accounts, customRange, loading, refreshing, reportWindowDays, selectedAccount, status?.connection.updatedAt],
  )

  const getEffectiveRange = (options?: {
    windowDays?: MetaAdsReportWindowDays
    custom?: MetaAdsCustomDateRange | null
  }) => {
    const nextCustom = options?.custom === undefined ? customRange : options.custom
    if (nextCustom?.since && nextCustom?.until) {
      return nextCustom
    }
    return buildRange(options?.windowDays ?? reportWindowDays)
  }

  const resetConnectedData = () => {
    setAccounts([])
    setAccountsError(null)
    setSummary(null)
    setTrend([])
    setOverviewError(null)
    setReport(null)
    setReportError(null)
    setInventory(null)
    setInventoryError(null)
  }

  const clearOAuthWatcher = () => {
    if (oauthPollRef.current) {
      window.clearInterval(oauthPollRef.current)
      oauthPollRef.current = null
    }
  }

  const finalizeOAuthSuccess = () => {
    cleanupOAuthPopup(true)
    setOauthDialogError(null)
    setOauthDialogOpen(false)
    setOauthDialogState('opening')
  }

  const cleanupOAuthPopup = (closeWindow = false) => {
    clearOAuthWatcher()
    if (closeWindow) {
      try {
        oauthPopupRef.current?.close()
      } catch {
        // no-op
      }
    }
    oauthPopupRef.current = null
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

  const loadOverview = async (options?: {
    windowDays?: MetaAdsReportWindowDays
    custom?: MetaAdsCustomDateRange | null
  }) => {
    try {
      const { since, until } = getEffectiveRange(options)
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

  const loadReport = async (options?: {
    windowDays?: MetaAdsReportWindowDays
    custom?: MetaAdsCustomDateRange | null
  }) => {
    try {
      const nextReport = await metaAdsApi.report(getEffectiveRange(options))
      setReport(nextReport)
      setReportError(null)
    } catch (error) {
      setReport(null)
      setReportError(error instanceof Error ? error.message : 'Falha ao carregar o consolidado de Meta Ads')
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
      setReport(null)
      setReportError(null)
      setInventory(null)
      setInventoryError(null)
      return nextStatus
    }

    await Promise.allSettled([loadOverview(), loadReport(), loadInventory()])
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
    if (connectionMode !== 'connected-ready' && connectionMode !== 'degraded') {
      setManageConnectionsOpen(false)
    }
  }, [connectionMode])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'meta-ads:connected') return
      if (!event.data?.ok) {
        const error = event.data?.error && typeof event.data.error === 'object'
          ? {
              code: String(event.data.error.code || 'META_OAUTH_CONNECT_FAILED'),
              message: String(event.data.error.message || 'Falha ao concluir o login da Meta.'),
              hint: event.data.error.hint ? String(event.data.error.hint) : undefined,
              retryable: false,
            }
          : {
              code: 'META_OAUTH_CONNECT_FAILED',
              message: 'Falha ao concluir o login da Meta.',
              retryable: false,
            }
        cleanupOAuthPopup(true)
        setOauthDialogError(error)
        setOauthDialogState('error')
        setOauthDialogOpen(true)
        setStatusError(error)
        toast.error(error.message)
        return
      }
      finalizeOAuthSuccess()
      setRefreshing(true)
      refreshConnectedState()
        .then(() => {
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

  useEffect(() => {
    return () => cleanupOAuthPopup(true)
  }, [])

  useEffect(() => {
    emitMetaAdsHeaderState(metaAdsHeaderState)
  }, [metaAdsHeaderState])

  useEffect(() => () => emitMetaAdsHeaderState(null), [])

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

  const openOAuthPopup = () => {
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
    if (!popup) {
      setOauthDialogError(null)
      setOauthDialogState('blocked')
      return false
    }
    popup.focus?.()
    oauthPopupRef.current = popup
    setOauthDialogError(null)
    setOauthDialogState('opened')
    clearOAuthWatcher()
    oauthPollRef.current = window.setInterval(() => {
      const currentPopup = oauthPopupRef.current
      if (!currentPopup) {
        clearOAuthWatcher()
        return
      }
      if (currentPopup.closed) {
        cleanupOAuthPopup()
        setRefreshing(true)
        refreshConnectedState()
          .then((nextStatus) => {
            if (nextStatus.connection.connected) {
              finalizeOAuthSuccess()
              toast.success('Conta Meta Ads conectada')
              return
            }
            setOauthDialogState('closed')
          })
          .catch(() => {
            setOauthDialogState('closed')
          })
          .finally(() => setRefreshing(false))
      }
    }, 500)
    return true
  }

  const handleRetryOAuth = () => {
    setOauthDialogError(null)
    setOauthDialogState('opening')
    setOauthDialogOpen(true)
    openOAuthPopup()
  }

  const handleOpenOAuth = () => {
    if (metaAdsApi.isLocalMockMode()) {
      setRefreshing(true)
      metaAdsApi
        .simulateOAuthConnect()
        .then(() => refreshConnectedState())
        .then(() => {
          toast.success('Conexão Meta Ads simulada no ambiente local')
        })
        .catch((error: any) => {
          setStatusError(error)
          toast.error(error?.message || 'Falha ao iniciar a simulação local do Meta Ads')
        })
        .finally(() => setRefreshing(false))
      return
    }
    setOauthDialogOpen(true)
    setOauthDialogError(null)
    setOauthDialogState('opening')
    openOAuthPopup()
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
      setManageConnectionsOpen(false)
      toast.success('Conta de anúncios selecionada')
    } catch (error: any) {
      setAccountsError(error)
      toast.error(error?.message || 'Falha ao selecionar conta')
    } finally {
      setRefreshing(false)
    }
  }

  const handleReportWindowChange = async (nextWindowDays: MetaAdsReportWindowDays) => {
    if (nextWindowDays === reportWindowDays && !customRange) return
    setReportWindowDays(nextWindowDays)
    setCustomRange(null)
    setCustomRangeDraft(buildRange(nextWindowDays))
    if (!status?.connection.connected || !selectedAccount) return
    setRefreshing(true)
    try {
      await Promise.allSettled([
        loadOverview({ windowDays: nextWindowDays, custom: null }),
        loadReport({ windowDays: nextWindowDays, custom: null }),
      ])
      toast.success(`Janela ajustada para ${nextWindowDays} dias`)
    } catch (error: any) {
      setStatusError(error)
      toast.error(error?.message || 'Falha ao atualizar o período do Meta Ads')
    } finally {
      setRefreshing(false)
    }
  }

  const handleOpenCustomRange = () => {
    setCustomRangeDraft(customRange || buildRange(reportWindowDays))
    setCustomRangeOpen(true)
  }

  const handleApplyCustomRange = async () => {
    const since = customRangeDraft.since
    const until = customRangeDraft.until
    if (!since || !until) {
      toast.error('Preencha as duas datas do período personalizado.')
      return
    }
    if (since > until) {
      toast.error('A data inicial não pode ser maior que a data final.')
      return
    }
    const nextCustomRange = { since, until }
    setCustomRange(nextCustomRange)
    setCustomRangeOpen(false)
    if (!status?.connection.connected || !selectedAccount) return
    setRefreshing(true)
    try {
      await Promise.allSettled([
        loadOverview({ custom: nextCustomRange }),
        loadReport({ custom: nextCustomRange }),
      ])
      toast.success('Período personalizado aplicado ao Meta Ads')
    } catch (error: any) {
      setStatusError(error)
      toast.error(error?.message || 'Falha ao aplicar o período personalizado')
    } finally {
      setRefreshing(false)
    }
  }

  const handleResetCustomRange = async () => {
    const nextRange = buildRange(reportWindowDays)
    setCustomRange(null)
    setCustomRangeDraft(nextRange)
    setCustomRangeOpen(false)
    if (!status?.connection.connected || !selectedAccount) return
    setRefreshing(true)
    try {
      await Promise.allSettled([
        loadOverview({ windowDays: reportWindowDays, custom: null }),
        loadReport({ windowDays: reportWindowDays, custom: null }),
      ])
      toast.success(`Janela padrão de ${reportWindowDays} dias restaurada`)
    } catch (error: any) {
      setStatusError(error)
      toast.error(error?.message || 'Falha ao restaurar o período padrão')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    return subscribeMetaAdsHeaderAction((action) => {
      if (action.type === 'refresh') {
        handleRefresh()
        return
      }
      if (action.type === 'manage-connections') {
        setManageConnectionsOpen(true)
        return
      }
      if (action.type === 'disconnect') {
        if (status?.connection.connected) handleDisconnect()
        return
      }
      if (action.type === 'set-account' && action.value) {
        handleSelectAccount(action.value)
        return
      }
      if (action.type === 'set-report-window') {
        handleReportWindowChange(action.value)
        return
      }
      if (action.type === 'open-custom-period') {
        handleOpenCustomRange()
      }
    })
  }, [handleDisconnect, handleRefresh, handleReportWindowChange, handleSelectAccount, status?.connection.connected])

  const missingConfig = status?.missingConfig || []
  const connectActionsDisabled =
    loading ||
    refreshing ||
    !!missingConfig.length ||
    connectionMode === 'unauthorized' ||
    connectionMode === 'forbidden' ||
    connectionMode === 'misconfigured'
  const showConnectedWorkspace = connectionMode === 'connected-ready' || connectionMode === 'degraded'
  const showAccountSelection = Boolean(status?.connection.connected)

  return (
    <div className="meta-ads-surface space-y-6 animate-fade-in">
      <MetaAdsPersistentError error={statusError} onRetry={handleRefresh} />

      {!showConnectedWorkspace ? (
        <div className="space-y-6">
          <MetaAdsConnectionPanel
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
              onNavigate={() => undefined}
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
        <>
          {!status?.connection.connected ? (
            <MetaAdsEmptyState
              message="Conecte uma conta Meta Ads para carregar spend, tendência e inventário."
              actionLabel="Gerenciar conexão"
              onAction={() => setManageConnectionsOpen(true)}
            />
          ) : !selectedAccount ? (
            <MetaAdsEmptyState
              message="Escolha uma conta de anúncios para liberar a visão geral."
              actionLabel="Gerenciar conexão"
              onAction={() => setManageConnectionsOpen(true)}
            />
          ) : (
            <>
              <MetaAdsOverviewPanel
                selectedAccount={selectedAccount}
                summary={summary}
                trend={trend}
                report={report}
                overviewError={overviewError}
                onRetry={handleRefresh}
              />
              {inventory ? (
                <MetaAdsInventoryPanel inventory={inventory} report={report} inventoryError={inventoryError} onRetry={handleRefresh} />
              ) : (
                <MetaAdsEmptyState
                  message="Ainda não foi possível carregar o inventário desta conta."
                  actionLabel="Atualizar agora"
                  onAction={handleRefresh}
                />
              )}
              <MetaTrackingDashboard
                data={report}
                error={reportError}
              />
            </>
          )}
        </>
      )}
      <MetaAdsOAuthDialog
        open={oauthDialogOpen}
        state={oauthDialogState}
        error={oauthDialogError}
        onOpenChange={(open) => {
          setOauthDialogOpen(open)
          if (!open) {
            cleanupOAuthPopup(true)
            setOauthDialogError(null)
            setOauthDialogState('opening')
          }
        }}
        onRetry={handleRetryOAuth}
      />
      <Dialog open={manageConnectionsOpen} onOpenChange={setManageConnectionsOpen}>
        <DialogContent className="max-w-6xl border-slate-800/80 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle>Gerenciar conexão Meta Ads</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <MetaAdsConnectionPanel
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
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={customRangeOpen} onOpenChange={setCustomRangeOpen}>
        <DialogContent className="max-w-md border-slate-800/80 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle>Escolher período personalizado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-slate-300" htmlFor="meta-ads-custom-since">Data inicial</label>
              <Input
                id="meta-ads-custom-since"
                type="date"
                value={customRangeDraft.since}
                onChange={(event) => setCustomRangeDraft((current) => ({ ...current, since: event.target.value }))}
                className="border-slate-700 bg-slate-900/70 text-slate-100"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-300" htmlFor="meta-ads-custom-until">Data final</label>
              <Input
                id="meta-ads-custom-until"
                type="date"
                value={customRangeDraft.until}
                onChange={(event) => setCustomRangeDraft((current) => ({ ...current, until: event.target.value }))}
                className="border-slate-700 bg-slate-900/70 text-slate-100"
              />
            </div>
            <div className="flex justify-between gap-3">
              <Button
                variant="outline"
                className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80"
                onClick={handleResetCustomRange}
              >
                Voltar ao período padrão
              </Button>
              <Button className="bg-sky-500 text-slate-950 hover:bg-sky-400" onClick={handleApplyCustomRange}>
                Aplicar período
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
