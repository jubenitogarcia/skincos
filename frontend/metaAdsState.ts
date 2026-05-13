import type {
  MetaAdAccount,
  MetaAdsApiError,
  MetaAdsConnectionMode,
  MetaAdsHealthState,
  MetaAdsStatusResponse,
  MetaAdsTab,
} from '@/metaAdsTypes'

const DEFAULT_ERROR_MESSAGE = 'Não foi possível concluir a operação no Meta Ads.'

export function normalizeMetaAdsApiError(error: unknown): MetaAdsApiError {
  const source = error as any
  const payload = source?.payload && typeof source.payload === 'object' ? source.payload : null
  const code = String(payload?.code || payload?.error || source?.code || 'META_ADS_REQUEST_FAILED').trim() || 'META_ADS_REQUEST_FAILED'
  const message =
    String(payload?.message || source?.message || payload?.hint || DEFAULT_ERROR_MESSAGE).trim() || DEFAULT_ERROR_MESSAGE
  const hint = String(payload?.hint || '').trim() || undefined
  const status = Number.isFinite(Number(source?.status)) ? Number(source.status) : undefined
  const retryable =
    typeof payload?.retryable === 'boolean'
      ? payload.retryable
      : Boolean(status && status >= 500)

  return {
    status,
    code,
    message,
    hint,
    retryable,
    payload: payload || source?.payload,
  }
}

export function deriveMetaAdsConnectionMode({
  status,
  statusError,
  selectedAccount,
}: {
  status: MetaAdsStatusResponse | null
  statusError: MetaAdsApiError | null
  selectedAccount: MetaAdAccount | null
}): MetaAdsConnectionMode {
  if (statusError?.code === 'UNAUTHORIZED' || statusError?.status === 401) return 'unauthorized'
  if (statusError?.code === 'ADMIN_REQUIRED' || statusError?.status === 403) return 'forbidden'
  if (statusError?.status === 503 || (status?.missingConfig?.length || 0) > 0 || status?.oauthConfigured === false) {
    return 'misconfigured'
  }
  if (statusError && status?.connection.connected) return 'degraded'
  if (!status?.connection.connected) return 'disconnected'
  if (!selectedAccount || !status.connection.selectedAdAccountId) return 'connected-no-account'
  return 'connected-ready'
}

export function getDefaultMetaAdsTab(mode: MetaAdsConnectionMode): MetaAdsTab {
  if (
    mode === 'disconnected' ||
    mode === 'unauthorized' ||
    mode === 'forbidden' ||
    mode === 'misconfigured' ||
    mode === 'connected-no-account'
  ) {
    return 'connect'
  }
  return 'overview'
}

export function buildMetaAdsHealthState({
  mode,
  selectedAccount,
  status,
  statusError,
}: {
  mode: MetaAdsConnectionMode
  selectedAccount: MetaAdAccount | null
  status: MetaAdsStatusResponse | null
  statusError: MetaAdsApiError | null
}): MetaAdsHealthState {
  if (mode === 'forbidden') {
    return {
      mode,
      title: 'Acesso restrito ao Meta Ads',
      description: statusError?.hint || 'Este módulo exige um perfil de gestão para conectar e operar contas da Meta.',
      tone: 'danger',
      ctaLabel: 'Ver conexão',
      ctaTab: 'connect',
    }
  }

  if (mode === 'unauthorized') {
    return {
      mode,
      title: 'Faça login no CRM para continuar',
      description:
        statusError?.hint ||
        statusError?.message ||
        'A sessão do CRM expirou ou ainda não foi iniciada. Entre novamente para liberar a integração Meta Ads.',
      tone: 'danger',
      ctaLabel: 'Ver conexão',
      ctaTab: 'connect',
    }
  }

  if (mode === 'misconfigured') {
    return {
      mode,
      title: 'Integração ainda não pronta no runtime',
      description:
        statusError?.hint ||
        (status?.missingConfig?.length
          ? `Faltam bindings/segredos obrigatórios: ${status.missingConfig.join(', ')}.`
          : 'A autenticação Meta precisa de configuração adicional no Pages runtime.'),
      tone: 'warning',
      ctaLabel: 'Ver conexão',
      ctaTab: 'connect',
    }
  }

  if (mode === 'degraded') {
    return {
      mode,
      title: 'Integração conectada com falha parcial',
      description:
        statusError?.hint ||
        statusError?.message ||
        'A conta continua conectada, mas houve falha ao atualizar inventário ou visão geral.',
      tone: 'warning',
      ctaLabel: 'Tentar novamente',
      ctaTab: 'overview',
    }
  }

  if (mode === 'connected-ready') {
    return {
      mode,
      title: 'Conta Meta pronta para operar',
      description: selectedAccount
        ? `Conta selecionada: ${selectedAccount.name || selectedAccount.id}. Use Visão geral, Inventário e Tracking para operar.`
        : 'A integração está conectada e pronta para uso.',
      tone: 'success',
      ctaLabel: 'Ver visão geral',
      ctaTab: 'overview',
    }
  }

  if (mode === 'connected-no-account') {
    return {
      mode,
      title: 'Conexão ativa, mas falta escolher a conta',
      description: 'O login Meta já está válido. Selecione a conta de anúncios que deve alimentar o CRM.',
      tone: 'warning',
      ctaLabel: 'Selecionar conta',
      ctaTab: 'connect',
    }
  }

  return {
    mode,
    title: 'Conecte a conta Meta para liberar o módulo',
    description: 'Comece pela aba Conexão, autorize o Facebook e depois selecione a conta de anúncios.',
    tone: 'neutral',
    ctaLabel: 'Conectar agora',
    ctaTab: 'connect',
  }
}
