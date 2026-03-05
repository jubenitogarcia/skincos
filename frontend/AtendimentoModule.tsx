import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { ErrorBoundary } from '@/ErrorBoundary'
import { useAuth } from '@/contexts'
import { LoadingPercentText } from '@/LoadingPattern'
const OmnichannelCenter = lazy(() => import('@/OmnichannelCenter').then(m => ({ default: m.OmnichannelCenter })))

type AtendimentoHeaderState = {
  whatsappConnected: boolean
  connectedWhatsapps: number
  instagramConnected: boolean
  facebookConfigured: boolean
  supportStats: {
    totalTickets: number
    openWithin24: number
    overdueTickets: number
    resolvedTickets: number
    avgSatisfaction: number
  }
  ticketFilter: 'total' | 'open' | 'overdue' | 'resolved'
  paused: boolean
}

function TabShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
      <ErrorBoundary
      fallback={
        <div className="glass-morphism rounded-2xl p-6 border border-white/20 text-white">
          <div className="text-sm text-blue-100/70">Falha ao carregar {title}.</div>
          <div className="text-xs text-blue-100/50 mt-2">Tente recarregar a página.</div>
          <div className="text-xs text-blue-100/60 mt-3">
            Se nenhuma conta estiver conectada, esta área exibirá conversas, mídia e indicadores do canal.
          </div>
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="glass-morphism h-full min-h-0 rounded-2xl p-6 border border-white/20 animate-pulse text-white">
            <LoadingPercentText label="Carregando módulo" className="text-white/90" showPercent={false} />
          </div>
        }
      >
        <div className="h-full min-h-0">
          {children}
        </div>
      </Suspense>
    </ErrorBoundary>
  )
}

export function AtendimentoModule() {
  const { user } = useAuth()
  const roleKey = String(user?.role || '').trim().toUpperCase()
  const allowedModulesKey = Array.isArray(user?.allowedModules) ? user.allowedModules.join('|') : ''

  const hasModuleAccess = useCallback(
    (moduleKey: string) => {
      const key = String(moduleKey || '').trim()
      if (!key) return false
      if (roleKey === 'GESTOR') return true
      const allowed = Array.isArray(user?.allowedModules)
        ? user.allowedModules.map(String).map((s) => s.trim()).filter(Boolean)
        : []
      if (!allowed.length) return true // compat: vazio/ausente => ALL
      return allowed.includes(key)
    },
    [allowedModulesKey, roleKey]
  )

  const canAtendimento = hasModuleAccess('atendimento')
  const canOmnichannel =
    canAtendimento ||
    hasModuleAccess('omnichannel') ||
    hasModuleAccess('whatsapp-business') ||
    hasModuleAccess('harmonia')

  const [omniKey, setOmniKey] = useState(0)

  const publishHeaderState = useCallback((state: AtendimentoHeaderState) => {
    try {
      window.dispatchEvent(new CustomEvent('skincos:atendimento:header', { detail: state }))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    return () => {
      try {
        window.dispatchEvent(new CustomEvent('skincos:atendimento:header', { detail: null }))
      } catch {
        /* ignore */
      }
    }
  }, [])

  if (!canOmnichannel) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">Sem acesso ao módulo de atendimento</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-100/70">
          Solicite permissões para Omnichannel.
        </CardContent>
      </Card>
    )
  }

  const renderActivePanel = () => (
    <TabShell title="Omnichannel">
      <OmnichannelCenter
        key={`omni-${omniKey}`}
        activities={[] as any}
        onHeaderStateChange={publishHeaderState}
        onStartConversation={(channel) => {
          const c = String(channel || '').toLowerCase()
          if (c === 'whatsapp') {
            // no-op: WhatsApp está disponível como painel dedicado
          }
        }}
      />
    </TabShell>
  )

  return (
    <div className="h-full min-h-0 atendimento-surface">
      <div className="h-full min-h-0">
        {renderActivePanel()}
      </div>
    </div>
  )
}
