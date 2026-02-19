import React, { Suspense, lazy, useCallback, useMemo, useEffect, useState } from 'react'
import { Badge } from '@/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { ErrorBoundary } from '@/ErrorBoundary'
import { useAuth } from '@/contexts'

const WhatsAppUnifiedHub = lazy(() => import('@/WhatsAppUnifiedHub').then(m => ({ default: m.WhatsAppUnifiedHub })))
const WhatsAppN8nModule = lazy(() => import('@/WhatsAppN8nModule').then(m => ({ default: m.WhatsAppN8nModule })))
const HarmoniaModule = lazy(() => import('@/HarmoniaModule').then(m => ({ default: m.HarmoniaModule })))
const OmnichannelCenter = lazy(() => import('@/OmnichannelCenter').then(m => ({ default: m.OmnichannelCenter })))
const HelpDeskModule = lazy(() => import('@/HelpDeskModule').then(m => ({ default: m.HelpDeskModule })))

const TAB_STORAGE_KEY = 'ui.atendimento.tab'
const TAB_QUERY_KEY = 'atendimento'

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
            Carregando módulo...
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

  const tabs = useMemo(
    () => [
      { key: 'whatsapp', label: 'WhatsApp', legacy: 'whatsapp-business', render: () => <WhatsAppUnifiedHub /> },
      { key: 'whatsapp-n8n', label: 'WhatsApp n8n', legacy: 'whatsapp-n8n', render: () => <WhatsAppN8nModule /> },
      { key: 'harmonia', label: 'Harmonia', legacy: 'harmonia', render: () => <HarmoniaModule /> },
      { key: 'omnichannel', label: 'Omnichannel', legacy: 'omnichannel', render: () => <OmnichannelCenter activities={[]} /> },
      { key: 'helpdesk', label: 'Help Desk', legacy: 'helpdesk', render: () => <HelpDeskModule /> }
    ],
    []
  )

  const allowedTabs = useMemo(
    () => tabs.filter((tab) => hasModuleAccess('atendimento') || hasModuleAccess(tab.legacy)),
    [hasModuleAccess, tabs]
  )
  const allowedTabKeys = useMemo(() => allowedTabs.map((t) => t.key), [allowedTabs])

  const resolveInitialTab = useCallback(
    (keys: string[]) => {
      if (!keys.length) return ''
      if (typeof window === 'undefined') return keys[0]
      const params = new URLSearchParams(window.location.search)
      const fromUrl = params.get(TAB_QUERY_KEY)
      if (fromUrl && keys.includes(fromUrl)) return fromUrl
      try {
        const stored = window.localStorage.getItem(TAB_STORAGE_KEY)
        if (stored && keys.includes(stored)) return stored
      } catch { /* ignore */ }
      return keys[0]
    },
    []
  )

  const [activeTab, setActiveTab] = useState<string>(() => resolveInitialTab(allowedTabKeys))

  useEffect(() => {
    if (!allowedTabKeys.length) {
      setActiveTab('')
      return
    }
    const next = resolveInitialTab(allowedTabKeys)
    setActiveTab(next)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      const params = url.searchParams
      params.set(TAB_QUERY_KEY, next)
      url.search = params.toString()
      window.history.replaceState({}, '', url.toString())
      try { window.localStorage.setItem(TAB_STORAGE_KEY, next) } catch { /* ignore */ }
    }
  }, [allowedTabKeys.join('|'), resolveInitialTab])

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value)
    if (typeof window === 'undefined') return
    try { window.localStorage.setItem(TAB_STORAGE_KEY, value) } catch { /* ignore */ }
    const url = new URL(window.location.href)
    const params = url.searchParams
    params.set(TAB_QUERY_KEY, value)
    url.search = params.toString()
    window.history.replaceState({}, '', url.toString())
  }, [])

  if (!allowedTabs.length) {
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">Atendimento</h2>
          <p className="text-sm text-blue-100/70">WhatsApp, Omnichannel, Harmonia e Help Desk em um só lugar</p>
        </div>
        <Badge variant="secondary">Central</Badge>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">Canais e Operações</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="flex flex-wrap">
              {allowedTabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key}>{tab.label}</TabsTrigger>
              ))}
            </TabsList>

            {allowedTabs.map((tab) => (
              <TabsContent key={tab.key} value={tab.key} className="mt-4">
                <TabShell title={tab.label}>
                  {tab.render()}
                </TabShell>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
