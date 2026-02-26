import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { ErrorBoundary } from '@/ErrorBoundary'
import { useAuth } from '@/contexts'
import { LoadingPercentText } from '@/LoadingPattern'
import { ChatCircle, WhatsappLogo, InstagramLogo, Headset, Sparkle } from '@phosphor-icons/react'

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

function HarmoniaFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-white">Harmonia indisponível</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-blue-100/70">
        <div>O módulo não carregou. Recarregue ou verifique o status do serviço.</div>
        <div className="text-xs text-blue-100/60">Sugestão: valide `/api/harmonia/health`.</div>
        <Button size="sm" variant="outline" onClick={onRetry} className="border-white/20 text-white">
          Tentar novamente
        </Button>
      </CardContent>
    </Card>
  )
}

type PanelKey = 'omnichannel' | 'whatsapp' | 'instagram' | 'helpdesk' | 'harmonia' | 'whatsapp-n8n'

function ChannelTile({
  title,
  description,
  icon,
  active,
  onOpen,
  onReload,
  ctaLabel,
}: {
  title: string
  description: string
  icon: React.ReactNode
  active: boolean
  onOpen: () => void
  onReload?: () => void
  ctaLabel?: string
}) {
  return (
    <div className={`rounded-xl border ${active ? 'border-blue-400/40 bg-white/10' : 'border-white/10 bg-white/5'} p-3 transition-colors`}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-white/10 p-2 text-blue-100">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-white">{title}</div>
            {active && <Badge variant="secondary" className="text-[10px]">Ativo</Badge>}
          </div>
          <div className="text-xs text-blue-100/70 mt-1">{description}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" className="h-7 px-3" onClick={onOpen}>
          {ctaLabel || 'Abrir painel'}
        </Button>
        {onReload ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-blue-100/70 hover:text-white"
            onClick={onReload}
          >
            Recarregar
          </Button>
        ) : null}
      </div>
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

  const [whatsAppKey, setWhatsAppKey] = useState(0)
  const [instagramKey, setInstagramKey] = useState(0)
  const [omniKey, setOmniKey] = useState(0)
  const [helpdeskKey, setHelpdeskKey] = useState(0)
  const [harmoniaKey, setHarmoniaKey] = useState(0)
  const [n8nKey, setN8nKey] = useState(0)
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null)

  const panelOptions = useMemo(
    () =>
      [
        {
          key: 'omnichannel' as PanelKey,
          title: 'Omnichannel',
          description: 'Central única com WhatsApp, Instagram e Facebook',
          enabled: canOmnichannel,
          icon: <ChatCircle className="h-4 w-4" />,
          reload: () => setOmniKey((v) => v + 1),
        },
        {
          key: 'whatsapp' as PanelKey,
          title: 'WhatsApp',
          description: 'Conversas, QR Code e status do canal',
          enabled: canWhatsApp,
          icon: <WhatsappLogo className="h-4 w-4" />,
          reload: () => setWhatsAppKey((v) => v + 1),
        },
        {
          key: 'instagram' as PanelKey,
          title: 'Instagram',
          description: 'DMs, posts, stories e insights',
          enabled: canInstagram,
          icon: <InstagramLogo className="h-4 w-4" />,
          reload: () => setInstagramKey((v) => v + 1),
        },
        {
          key: 'helpdesk' as PanelKey,
          title: 'Help Desk',
          description: 'Tickets e base de conhecimento',
          enabled: canHelpdesk,
          icon: <Headset className="h-4 w-4" />,
          reload: () => setHelpdeskKey((v) => v + 1),
        },
        {
          key: 'harmonia' as PanelKey,
          title: 'Harmonia',
          description: 'Assistente e insights de atendimento',
          enabled: canHarmonia,
          icon: <Sparkle className="h-4 w-4" />,
          reload: () => setHarmoniaKey((v) => v + 1),
        },
        {
          key: 'whatsapp-n8n' as PanelKey,
          title: 'WhatsApp n8n',
          description: 'Automação e integrações do fluxo',
          enabled: canWhatsAppN8n,
          icon: <WhatsappLogo className="h-4 w-4" />,
          reload: () => setN8nKey((v) => v + 1),
        },
      ].filter((panel) => panel.enabled),
    [canOmnichannel, canWhatsApp, canInstagram, canHelpdesk, canHarmonia, canWhatsAppN8n]
  )

  const availableKeys = useMemo(() => panelOptions.map((panel) => panel.key).join('|'), [panelOptions])

  useEffect(() => {
    if (activePanel && panelOptions.some((panel) => panel.key === activePanel)) return
    setActivePanel(panelOptions[0]?.key ?? null)
  }, [activePanel, availableKeys, panelOptions])

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

  const renderActivePanel = () => {
    switch (activePanel) {
      case 'whatsapp':
        return (
          <TabShell title="WhatsApp">
            <WhatsAppUnifiedHub key={`whatsapp-${whatsAppKey}`} />
          </TabShell>
        )
      case 'instagram':
        return (
          <TabShell title="Instagram">
            <InstagramStudioPro key={`instagram-${instagramKey}`} />
          </TabShell>
        )
      case 'helpdesk':
        return (
          <TabShell title="Help Desk">
            <HelpDeskModule key={`helpdesk-${helpdeskKey}`} />
          </TabShell>
        )
      case 'harmonia':
        return (
          <ErrorBoundary fallback={<HarmoniaFallback onRetry={() => setHarmoniaKey((v) => v + 1)} />}>
            <Suspense
              fallback={
                <div className="glass-morphism rounded-2xl p-6 border border-white/20 animate-pulse text-white">
                  <LoadingPercentText label="Carregando Harmonia" className="text-white/90" showPercent={false} />
                </div>
              }
            >
              <Card className="glass-card">
                <CardContent className="p-0">
                  <HarmoniaModule key={`harmonia-${harmoniaKey}`} mode="columns" showChannels={false} />
                </CardContent>
              </Card>
            </Suspense>
          </ErrorBoundary>
        )
      case 'whatsapp-n8n':
        return (
          <Card className="glass-card">
            <CardContent>
              <TabShell title="WhatsApp n8n">
                <WhatsAppN8nModule key={`n8n-${n8nKey}`} />
              </TabShell>
            </CardContent>
          </Card>
        )
      case 'omnichannel':
      default:
        return (
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
    }
  }

  return (
    <div className="space-y-6 atendimento-surface">
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
            <CardContent className="space-y-3">
              {panelOptions.map((panel) => (
                <ChannelTile
                  key={panel.key}
                  title={panel.title}
                  description={panel.description}
                  icon={panel.icon}
                  active={activePanel === panel.key}
                  onOpen={() => setActivePanel(panel.key)}
                  onReload={panel.reload}
                  ctaLabel={activePanel === panel.key ? 'Em uso' : 'Abrir painel'}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-8 space-y-4">
          {activePanel ? (
            renderActivePanel()
          ) : (
            <Card className="glass-card">
              <CardContent className="py-10 text-center text-blue-100/70">
                Selecione um canal para visualizar os detalhes.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
