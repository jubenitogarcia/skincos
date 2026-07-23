import React, { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { ClipboardList, Stethoscope, WalletCards } from 'lucide-react'
import { ErrorBoundary } from '@/ErrorBoundary'
import { LoadingPercentText } from '@/LoadingPattern'
import { hasCrmModuleAccess } from '@/crmRoleAccess'

type LazyModule = React.LazyExoticComponent<ComponentType<any>>

export type CrmModuleManifest = {
  key: string
  label: string
  icon: ReactNode
  entrypoint: string
  bundle: 'lazy'
  Component: LazyModule
  permissions: { kind: 'crm-module' | 'finance-pilot'; key: string }
  tests: readonly string[]
  unavailable: { title: string; description: string }
}

type ModuleAccessContext = { role: unknown; allowedModules: unknown; financeEnabled: boolean }

function entry(key: string, label: string, icon: ReactNode, entrypoint: string, Component: LazyModule, permissions: CrmModuleManifest['permissions'] = { kind: 'crm-module', key }) {
  return {
    key, label, icon, entrypoint, Component, permissions, bundle: 'lazy' as const,
    tests: ['npm --prefix crm/console test'],
    unavailable: { title: `${label} indisponível`, description: 'Este módulo não está liberado para a sua sessão ou está temporariamente indisponível.' },
  } satisfies CrmModuleManifest
}

const named = (loader: () => Promise<any>, name: string): LazyModule => lazy(() => loader().then((module) => ({ default: module[name] as ComponentType<any> })))

export const moduleRegistry: readonly CrmModuleManifest[] = [
  entry('capabilities', 'Plataforma', '🧭', '@/CapabilitiesCenter', named(() => import('@/CapabilitiesCenter'), 'CapabilitiesCenter')),
  entry('jobs', 'Execuções', '🏃', '@/JobsCenter', named(() => import('@/JobsCenter'), 'JobsCenter')),
  entry('status', 'Status', '📡', '@/SystemStatusModule', named(() => import('@/SystemStatusModule'), 'SystemStatusModule')),
  entry('unit-monitor', 'Unit Monitor', '📹', '@/UnitMonitor', named(() => import('@/UnitMonitor'), 'UnitMonitor')),
  entry('insumos', 'Insumos', <img src="/icons/insumos-icon-192.svg" alt="" aria-hidden className="h-5 w-5" />, '@/InsumosModule', named(() => import('@/InsumosModule'), 'InsumosModule')),
  entry('users', 'Usuários', '👤', '@/UsersModule', named(() => import('@/UsersModule'), 'UsersModule')),
  entry('dashboard', 'Analítica', <img src="/icons/chart.png" alt="" aria-hidden className="h-5 w-5" />, '@/ReportsDashboard', named(() => import('@/ReportsDashboard'), 'ReportsDashboard')),
  entry('leads', 'Leads', '💎', '@/LeadsManager', named(() => import('@/LeadsManager'), 'LeadsManager')),
  entry('clientes', 'Clientes', '👥', '@/ClientCommercialModule', named(() => import('@/ClientCommercialModule'), 'ClientCommercialModule')),
  entry('notifications', 'Notificações', '🔔', '@/NotificationCenter', named(() => import('@/NotificationCenter'), 'NotificationCenter')),
  entry('conversa', 'Conversa', '💬', '@/ConversaModule', named(() => import('@/ConversaModule'), 'ConversaModule')),
  entry('atendimento', 'Atendimento', <span className="relative inline-flex h-5 w-5 items-center justify-center text-sky-100" aria-hidden><Stethoscope className="absolute h-4 w-4 -translate-x-1 translate-y-0.5" /><ClipboardList className="absolute h-3.5 w-3.5 translate-x-1 -translate-y-0.5 text-emerald-200" /></span>, '@/AtendimentoModule', named(() => import('@/AtendimentoModule'), 'AtendimentoModule')),
  entry('caixa', 'Caixa', '💰', '@/CaixaModule', named(() => import('@/CaixaModule'), 'CaixaModule')),
  entry('faturamento', 'Faturamento', <WalletCards className="h-5 w-5 text-emerald-100" aria-hidden />, '@/FaturamentoModule', named(() => import('@/FaturamentoModule'), 'FaturamentoModule')),
  entry('procedimentos', 'Procedimentos', <ClipboardList className="h-5 w-5 text-sky-100" aria-hidden />, '@/ProcedimentosModule', named(() => import('@/ProcedimentosModule'), 'ProcedimentosModule')),
  entry('escala-profissionais', 'Escala', '🗓️', '@/EscalaProfissionaisModule', named(() => import('@/EscalaProfissionaisModule'), 'EscalaProfissionaisModule')),
  entry('site-tracking', 'Site EF', '📍', '@/SiteTrackingModule', named(() => import('@/SiteTrackingModule'), 'SiteTrackingModule')),
  entry('meta-ads', 'Meta Ads', '📢', '@/MetaCampaignControlCenter', named(() => import('@/MetaCampaignControlCenter'), 'MetaCampaignControlCenter')),
  entry('meta-command', 'Meta Command', '🧭', '@/MetaCommandCenter', named(() => import('@/MetaCommandCenter'), 'MetaCommandCenter')),
  entry('meta-sync', 'Meta Sync', '🔄', '@/MetaSyncMonitor', named(() => import('@/MetaSyncMonitor'), 'MetaSyncMonitor')),
  entry('meta-sentiment', 'Sentimento', '🧠', '@/MetaSentimentMonitor', named(() => import('@/MetaSentimentMonitor'), 'MetaSentimentMonitor')),
  entry('meta-pages-review', 'Meta Review', '🧪', '@/MetaPagesReviewStudio', named(() => import('@/MetaPagesReviewStudio'), 'MetaPagesReviewStudio')),
  entry('instagram-studio', 'Redes Sociais', '🌐', '@/SocialNetworksStudio', named(() => import('@/SocialNetworksStudio'), 'SocialNetworksStudio')),
  entry('threads-studio', 'Threads', '🧵', '@/ThreadsStudio', named(() => import('@/ThreadsStudio'), 'ThreadsStudio')),
  entry('workflow', 'Workflows', '⚙️', '@/WorkflowEngine', named(() => import('@/WorkflowEngine'), 'WorkflowEngine')),
  entry('projects', 'Projetos', '📁', '@/ProjectManagement', named(() => import('@/ProjectManagement'), 'ProjectManagement')),
  entry('kanban', 'Kanban', '🗂️', '@/KanbanBoard', lazy(() => import('@/KanbanBoard').then((module) => ({ default: () => <module.KanbanBoard type="tasks" title="Quadro Kanban" description="Gestão visual de tarefas" /> })))),
  entry('tasks', 'Tarefas', '✅', '@/RichTaskManager', named(() => import('@/RichTaskManager'), 'RichTaskManager')),
  entry('territories', 'Territórios', '🗺️', '@/TerritoriesManager', named(() => import('@/TerritoriesManager'), 'TerritoriesManager')),
  entry('quotes', 'Cotações', '💬', '@/QuotesManager', named(() => import('@/QuotesManager'), 'QuotesManager')),
  entry('web-forms', 'Forms', '📝', '@/WebFormsManager', named(() => import('@/WebFormsManager'), 'WebFormsManager')),
  entry('email-templates', 'Templates', '✉️', '@/EmailTemplatesManager', named(() => import('@/EmailTemplatesManager'), 'EmailTemplatesManager')),
  entry('fields', 'Campos', '🧩', '@/FieldsManager', lazy(() => import('@/FieldsManager').then((module) => ({ default: () => <module.FieldsManager objectType="customer" objectName="Cliente" /> })))),
  entry('permissions', 'Permissões', '🔑', '@/PermissionsManager', named(() => import('@/PermissionsManager'), 'PermissionsManager')),
  entry('custom-objects', 'Objetos', '🛠️', '@/CustomObjectsManager', named(() => import('@/CustomObjectsManager'), 'CustomObjectsManager')),
  entry('roi', 'ROI', '📈', '@/ROIDashboard', named(() => import('@/ROIDashboard'), 'ROIDashboard')),
  entry('ai-automation', 'AI Automação', '🤖', '@/AIAutomationHub', named(() => import('@/AIAutomationHub'), 'AIAutomationHub')),
  entry('agent-dashboard', 'Agentes', '🧑‍💼', '@/AgentDashboard', named(() => import('@/AgentDashboard'), 'AgentDashboard')),
  entry('coaching', 'Coaching', '🎯', '@/PerformanceCoaching', named(() => import('@/PerformanceCoaching'), 'PerformanceCoaching')),
  entry('alerts', 'Alertas', <img src="/icons/emergency.png" alt="" aria-hidden className="h-5 w-5" />, '@/PerformanceAlerts', named(() => import('@/PerformanceAlerts'), 'PerformanceAlerts')),
  entry('backup-recovery', 'Backup', '💾', '@/BackupRecoveryCenter', named(() => import('@/BackupRecoveryCenter'), 'BackupRecoveryCenter')),
  entry('system-monitoring', 'Monitoramento', '🖥️', '@/SystemMonitoring', named(() => import('@/SystemMonitoring'), 'SystemMonitoring')),
  entry('assets', 'Ativos', '📦', '@/AssetManagement', named(() => import('@/AssetManagement'), 'AssetManagement')),
  entry('manufacturing', 'Fabricação', '🏭', '@/ManufacturingModule', named(() => import('@/ManufacturingModule'), 'ManufacturingModule')),
  entry('hr', 'RH', '👥', '@/HRModule', named(() => import('@/HRModule'), 'HRModule')),
  entry('ponto', 'Ponto', '⏱️', '@/PontoModule', named(() => import('@/PontoModule'), 'PontoModule')),
  entry('procurement', 'Compras', '🛒', '@/ProcurementModule', named(() => import('@/ProcurementModule'), 'ProcurementModule')),
  entry('finance', 'Financeiro', <img src="/icons/money.png" alt="" aria-hidden className="h-5 w-5" />, '@/FinanceModule', named(() => import('@/FinanceModule'), 'FinanceModule'), { kind: 'finance-pilot', key: 'finance' }),
  entry('products', 'Produtos', '📂', '@/ProductCatalog', named(() => import('@/ProductCatalog'), 'ProductCatalog')),
  entry('pipelines', 'Pipelines', '🔀', '@/PipelineManager', named(() => import('@/PipelineManager'), 'PipelineManager')),
  entry('lead-scoring', 'Lead Scoring', '⭐', '@/LeadScoringSystem', named(() => import('@/LeadScoringSystem'), 'LeadScoringSystem')),
  entry('webhooks', 'Webhooks', '🔌', '@/WebhooksIntegrationsHub', named(() => import('@/WebhooksIntegrationsHub'), 'WebhooksIntegrationsHub')),
  entry('companies', 'Empresas', '🏢', '@/MultiCompanyManagement', named(() => import('@/MultiCompanyManagement'), 'MultiCompanyManagement')),
  entry('notifications-test', 'Notif. Tester', '🔔', '@/NotificationTester', named(() => import('@/NotificationTester'), 'NotificationTester')),
  entry('api', 'API', '🧪', '@/APIExplorer', named(() => import('@/APIExplorer'), 'APIExplorer')),
  entry('reports', 'Relatórios', <img src="/icons/chart.png" alt="" aria-hidden className="h-5 w-5" />, '@/ReportsDashboard', named(() => import('@/ReportsDashboard'), 'ReportsDashboard')),
]

export const modulesByKey = new Map(moduleRegistry.map((module) => [module.key, module]))

export function hasModulePermission(module: CrmModuleManifest, context: ModuleAccessContext) {
  if (module.permissions.kind === 'finance-pilot') {
    return context.financeEnabled && Array.isArray(context.allowedModules) && context.allowedModules.map(String).includes(module.permissions.key)
  }
  return hasCrmModuleAccess(context.role, context.allowedModules, module.permissions.key)
}

export function ModuleSlot({ module, className }: { module: CrmModuleManifest; className?: string }) {
  const Component = module.Component
  return (
    <ErrorBoundary reloadOnChunkFailure={false} fallback={<section className="glass-morphism rounded-2xl border border-rose-300/30 p-6 text-rose-50"><h2 className="text-lg font-semibold">{module.unavailable.title}</h2><p className="mt-2 text-sm text-rose-100/80">{module.unavailable.description}</p></section>}>
      <Suspense fallback={<div className="glass-morphism rounded-2xl border border-white/20 p-8 animate-pulse"><LoadingPercentText label={`Carregando ${module.label}`} className="text-white/90" showPercent={false} /><div className="text-blue-300/60 text-sm">Carregando bundle do módulo</div></div>}>
        <div className={className}><Component /></div>
      </Suspense>
    </ErrorBoundary>
  )
}
