import React, { Suspense, lazy, useCallback, useState } from 'react'
import { Badge } from '@/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { ErrorBoundary } from '@/ErrorBoundary'
import { useAuth } from '@/contexts'
import { LoadingPercentText } from '@/LoadingPattern'
const OmnichannelCenter = lazy(() => import('@/OmnichannelCenter').then(m => ({ default: m.OmnichannelCenter })))

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
          <div className="glass-morphism rounded-2xl p-6 border border-white/20 animate-pulse text-white">
            <LoadingPercentText label="Carregando módulo" className="text-white/90" showPercent={false} />
          </div>
        }
      >
        {children}
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
      if (roleKey === 'ADMIN') return true
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
    <div className="space-y-6 atendimento-surface">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-white">Atendimento</h2>
        <Badge variant="secondary">Central</Badge>
      </div>

      <div className="space-y-4">
        {renderActivePanel()}
      </div>
    </div>
  )
}
