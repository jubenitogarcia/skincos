import React, { Suspense, lazy, useCallback } from 'react'
import { Badge } from '@/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { ErrorBoundary } from '@/ErrorBoundary'
import { useAuth } from '@/contexts'
import { LoadingPercentText } from '@/LoadingPattern'

const WhatsAppUnifiedHub = lazy(() => import('@/WhatsAppUnifiedHub').then(m => ({ default: m.WhatsAppUnifiedHub })))
const WhatsAppN8nModule = lazy(() => import('@/WhatsAppN8nModule').then(m => ({ default: m.WhatsAppN8nModule })))
const HarmoniaModule = lazy(() => import('@/HarmoniaModule').then(m => ({ default: m.HarmoniaModule })))
const OmnichannelCenter = lazy(() => import('@/OmnichannelCenter').then(m => ({ default: m.OmnichannelCenter })))
const HelpDeskModule = lazy(() => import('@/HelpDeskModule').then(m => ({ default: m.HelpDeskModule })))
const InstagramStudioPro = lazy(() => import('@/InstagramStudioPro').then(m => ({ default: m.InstagramStudioPro })))

function TabShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="glass-morphism rounded-2xl p-6 border border-white/20 text-white">
          <div className="text-sm text-blue-100/70">Falha ao carregar {title}.</div>
          <div className="text-xs text-blue-100/50 mt-2">Tente recarregar a página.</div>
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

function ChannelPanel({
  title,
  children,
  onReload,
}: {
  title: string
  children: React.ReactNode
  onReload?: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-white">{title}</div>
        {onReload ? (
          <button
            type="button"
            className="text-[11px] text-blue-200/70 hover:text-white transition-colors"
            onClick={onReload}
          >
            Recarregar
          </button>
        ) : null}
      </div>
      {children}
    </div>
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
  const canWhatsApp = canAtendimento || hasModuleAccess('whatsapp-business')
  const canWhatsAppN8n = canAtendimento || hasModuleAccess('whatsapp-n8n')
  const canHarmonia = canAtendimento || hasModuleAccess('harmonia')
  const canOmnichannel = canAtendimento || hasModuleAccess('omnichannel')
  const canHelpdesk = canAtendimento || hasModuleAccess('helpdesk')
  const canInstagram = canAtendimento || hasModuleAccess('harmonia')

  const [whatsAppKey, setWhatsAppKey] = React.useState(0)
  const [instagramKey, setInstagramKey] = React.useState(0)
  const [omniKey, setOmniKey] = React.useState(0)
  const [helpdeskKey, setHelpdeskKey] = React.useState(0)

  if (!canWhatsApp && !canWhatsAppN8n && !canHarmonia && !canOmnichannel && !canHelpdesk && !canInstagram) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">Sem acesso ao módulo de atendimento</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-100/70">
          Solicite permissões para WhatsApp, Harmonia, Omnichannel ou Help Desk.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 min-w-0 w-full md:flex-row md:items-center md:gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold text-white">Atendimento</h2>
          <p className="text-sm text-blue-100/70">WhatsApp, Omnichannel, Harmonia e Help Desk em um só lugar</p>
        </div>
        <Badge variant="secondary" className="ml-0 md:ml-auto">Central</Badge>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-4 space-y-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-white">Canais de Atendimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canWhatsApp ? (
                <ChannelPanel title="WhatsApp" onReload={() => setWhatsAppKey((v) => v + 1)}>
                  <TabShell title="WhatsApp">
                    <WhatsAppUnifiedHub key={`whatsapp-${whatsAppKey}`} />
                  </TabShell>
                </ChannelPanel>
              ) : null}

              {canInstagram ? (
                <ChannelPanel title="Instagram (DM)" onReload={() => setInstagramKey((v) => v + 1)}>
                  <TabShell title="Instagram">
                    <InstagramStudioPro key={`instagram-${instagramKey}`} />
                  </TabShell>
                </ChannelPanel>
              ) : null}

              {canOmnichannel ? (
                <ChannelPanel title="Omnichannel" onReload={() => setOmniKey((v) => v + 1)}>
                  <TabShell title="Omnichannel">
                    <OmnichannelCenter
                      key={`omni-${omniKey}`}
                      activities={[] as any}
                      onStartConversation={(channel) => {
                        const c = String(channel || '').toLowerCase()
                        if (c === 'whatsapp') {
                          // no-op: WhatsApp está disponível acima
                        }
                      }}
                    />
                  </TabShell>
                </ChannelPanel>
              ) : null}

              {canHelpdesk ? (
                <ChannelPanel title="Help Desk" onReload={() => setHelpdeskKey((v) => v + 1)}>
                  <TabShell title="Help Desk">
                    <HelpDeskModule key={`helpdesk-${helpdeskKey}`} />
                  </TabShell>
                </ChannelPanel>
              ) : null}
            </CardContent>
          </Card>

          {canWhatsAppN8n ? (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-white">Automação (WhatsApp n8n)</CardTitle>
              </CardHeader>
              <CardContent>
                <TabShell title="WhatsApp n8n">
                  <WhatsAppN8nModule />
                </TabShell>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="xl:col-span-8">
          {canHarmonia ? (
            <Card className="glass-card">
              <CardContent className="p-0">
                <TabShell title="Harmonia">
                  <HarmoniaModule mode="columns" showChannels={false} />
                </TabShell>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
