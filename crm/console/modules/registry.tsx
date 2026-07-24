import { ClipboardList, Stethoscope, WalletCards } from 'lucide-react'
import { hasCrmModuleAccess } from '@/crmRoleAccess'
import type { CrmModuleManifest, ModuleAccessContext, ModuleAvailability } from './types'

const fallbackFor = (label: string) => ({ loadingLabel: `Carregando ${label}`, unavailableLabel: `${label} indisponível` })
const manifest = (entry: Omit<CrmModuleManifest, 'permissions' | 'fallback'>): CrmModuleManifest => ({ ...entry, permissions: [`module.${entry.key}.access`], fallback: fallbackFor(entry.label) })

/** Declarative boundary for every CRM module: permissions, lazy entrypoint and fallbacks. */
export const crmModuleRegistry: readonly CrmModuleManifest[] = [
  manifest({ key: 'capabilities', label: 'Plataforma', icon: '🧭', loader: () => import('@/CapabilitiesCenter').then((m) => ({ default: m.CapabilitiesCenter })) }),
  manifest({ key: 'jobs', label: 'Execuções', icon: '🏃', loader: () => import('@/JobsCenter').then((m) => ({ default: m.JobsCenter })) }),
  manifest({ key: 'status', label: 'Status', icon: '📡', loader: () => import('@/SystemStatusModule').then((m) => ({ default: m.SystemStatusModule })) }),
  manifest({ key: 'unit-monitor', label: 'Unit Monitor', icon: '📹', loader: () => import('@/UnitMonitor').then((m) => ({ default: m.UnitMonitor })) }),
  manifest({ key: 'insumos', label: 'Insumos', icon: <img src="/icons/insumos-icon-192.svg" alt="" aria-hidden className="h-5 w-5" />, loader: () => import('@/InsumosModule').then((m) => ({ default: m.InsumosModule })) }),
  manifest({ key: 'users', label: 'Usuários', icon: '👤', loader: () => import('@/UsersModule').then((m) => ({ default: m.UsersModule })) }),
  manifest({ key: 'dashboard', label: 'Analítica', icon: <img src="/icons/chart.png" alt="" aria-hidden className="h-5 w-5" />, loader: () => import('@/ReportsDashboard').then((m) => ({ default: m.ReportsDashboard })) }),
  manifest({ key: 'leads', label: 'Leads', icon: '💎', loader: () => import('@/LeadsManager').then((m) => ({ default: m.LeadsManager })) }),
  manifest({ key: 'clientes', label: 'Clientes', icon: '👥', loader: () => import('@/ClientCommercialModule').then((m) => ({ default: m.ClientCommercialModule })) }),
  manifest({ key: 'notifications', label: 'Notificações', icon: '🔔', loader: () => import('@/NotificationCenter').then((m) => ({ default: m.NotificationCenter })) }),
  manifest({ key: 'conversa', label: 'Conversa', icon: '💬', loader: () => import('@/ConversaModule').then((m) => ({ default: m.ConversaModule })) }),
  manifest({ key: 'atendimento', label: 'Atendimento', icon: <span className="relative inline-flex h-5 w-5 items-center justify-center text-sky-100" aria-hidden><Stethoscope className="absolute h-4 w-4 -translate-x-1 translate-y-0.5" /><ClipboardList className="absolute h-3.5 w-3.5 translate-x-1 -translate-y-0.5 text-emerald-200" /></span>, loader: () => import('@/AtendimentoModule').then((m) => ({ default: m.AtendimentoModule })) }),
  manifest({ key: 'caixa', label: 'Caixa', icon: '💰', loader: () => import('@/CaixaModule').then((m) => ({ default: m.CaixaModule })) }),
  manifest({ key: 'faturamento', label: 'Faturamento', icon: <WalletCards className="h-5 w-5 text-emerald-100" aria-hidden />, loader: () => import('@/FaturamentoModule').then((m) => ({ default: m.FaturamentoModule })) }),
  manifest({ key: 'procedimentos', label: 'Procedimentos', icon: <ClipboardList className="h-5 w-5 text-sky-100" aria-hidden />, loader: () => import('@/ProcedimentosModule').then((m) => ({ default: m.ProcedimentosModule })) }),
  manifest({ key: 'escala-profissionais', label: 'Escala', icon: '🗓️', loader: () => import('@/EscalaProfissionaisModule').then((m) => ({ default: m.EscalaProfissionaisModule })) }),
  manifest({ key: 'site-tracking', label: 'Site EF', icon: '📍', loader: () => import('@/SiteTrackingModule').then((m) => ({ default: m.SiteTrackingModule })) }),
  manifest({ key: 'meta-ads', label: 'Meta Ads', icon: '📢', loader: () => import('@/MetaCampaignControlCenter').then((m) => ({ default: m.MetaCampaignControlCenter })) }),
  manifest({ key: 'meta-command', label: 'Meta Command', icon: '🧭', loader: () => import('@/MetaCommandCenter').then((m) => ({ default: m.MetaCommandCenter })) }),
  manifest({ key: 'meta-sync', label: 'Meta Sync', icon: '🔄', loader: () => import('@/MetaSyncMonitor').then((m) => ({ default: m.MetaSyncMonitor })) }),
  manifest({ key: 'meta-sentiment', label: 'Sentimento', icon: '🧠', loader: () => import('@/MetaSentimentMonitor').then((m) => ({ default: m.MetaSentimentMonitor })) }),
  manifest({ key: 'meta-pages-review', label: 'Meta Review', icon: '🧪', loader: () => import('@/MetaPagesReviewStudio').then((m) => ({ default: m.MetaPagesReviewStudio })) }),
  manifest({ key: 'instagram-studio', label: 'Redes Sociais', icon: '🌐', loader: () => import('@/SocialNetworksStudio').then((m) => ({ default: m.SocialNetworksStudio })) }),
  manifest({ key: 'threads-studio', label: 'Threads', icon: '🧵', loader: () => import('@/ThreadsStudio').then((m) => ({ default: m.ThreadsStudio })) }),
  manifest({ key: 'workflow', label: 'Workflows', icon: '⚙️', loader: () => import('@/WorkflowEngine').then((m) => ({ default: m.WorkflowEngine })) }),
  manifest({ key: 'projects', label: 'Projetos', icon: '📁', loader: () => import('@/ProjectManagement').then((m) => ({ default: m.ProjectManagement })) }),
  manifest({ key: 'kanban', label: 'Kanban', icon: '🗂️', loader: () => import('@/KanbanBoard').then((m) => ({ default: () => <m.KanbanBoard type="tasks" title="Quadro Kanban" description="Gestão visual de tarefas" /> })) }),
  manifest({ key: 'tasks', label: 'Tarefas', icon: '✅', loader: () => import('@/RichTaskManager').then((m) => ({ default: m.RichTaskManager })) }),
  manifest({ key: 'territories', label: 'Territórios', icon: '🗺️', loader: () => import('@/TerritoriesManager').then((m) => ({ default: m.TerritoriesManager })) }),
  manifest({ key: 'quotes', label: 'Cotações', icon: '💬', loader: () => import('@/QuotesManager').then((m) => ({ default: m.QuotesManager })) }),
  manifest({ key: 'web-forms', label: 'Forms', icon: '📝', loader: () => import('@/WebFormsManager').then((m) => ({ default: m.WebFormsManager })) }),
  manifest({ key: 'email-templates', label: 'Templates', icon: '✉️', loader: () => import('@/EmailTemplatesManager').then((m) => ({ default: m.EmailTemplatesManager })) }),
  manifest({ key: 'fields', label: 'Campos', icon: '🧩', loader: () => import('@/FieldsManager').then((m) => ({ default: () => <m.FieldsManager objectType="customer" objectName="Cliente" /> })) }),
  manifest({ key: 'permissions', label: 'Permissões', icon: '🔑', loader: () => import('@/PermissionsManager').then((m) => ({ default: m.PermissionsManager })) }),
  manifest({ key: 'custom-objects', label: 'Objetos', icon: '🛠️', loader: () => import('@/CustomObjectsManager').then((m) => ({ default: m.CustomObjectsManager })) }),
  manifest({ key: 'roi', label: 'ROI', icon: '📈', loader: () => import('@/ROIDashboard').then((m) => ({ default: m.ROIDashboard })) }),
  manifest({ key: 'ai-automation', label: 'AI Automação', icon: '🤖', loader: () => import('@/AIAutomationHub').then((m) => ({ default: m.AIAutomationHub })) }),
  manifest({ key: 'agent-dashboard', label: 'Agentes', icon: '🧑‍💼', loader: () => import('@/AgentDashboard').then((m) => ({ default: m.AgentDashboard })) }),
  manifest({ key: 'coaching', label: 'Coaching', icon: '🎯', loader: () => import('@/PerformanceCoaching').then((m) => ({ default: m.PerformanceCoaching })) }),
  manifest({ key: 'alerts', label: 'Alertas', icon: <img src="/icons/emergency.png" alt="" aria-hidden className="h-5 w-5" />, loader: () => import('@/PerformanceAlerts').then((m) => ({ default: m.PerformanceAlerts })) }),
  manifest({ key: 'backup-recovery', label: 'Backup', icon: '💾', loader: () => import('@/BackupRecoveryCenter').then((m) => ({ default: m.BackupRecoveryCenter })) }),
  manifest({ key: 'system-monitoring', label: 'Monitoramento', icon: '🖥️', loader: () => import('@/SystemMonitoring').then((m) => ({ default: m.SystemMonitoring })) }),
  manifest({ key: 'assets', label: 'Ativos', icon: '📦', loader: () => import('@/AssetManagement').then((m) => ({ default: m.AssetManagement })) }),
  manifest({ key: 'manufacturing', label: 'Fabricação', icon: '🏭', loader: () => import('@/ManufacturingModule').then((m) => ({ default: m.ManufacturingModule })) }),
  manifest({ key: 'hr', label: 'RH', icon: '👥', loader: () => import('@/HRModule').then((m) => ({ default: m.HRModule })) }),
  manifest({ key: 'ponto', label: 'Ponto', icon: '⏱️', loader: () => import('@/PontoModule').then((m) => ({ default: m.PontoModule })) }),
  manifest({ key: 'procurement', label: 'Compras', icon: '🛒', loader: () => import('@/ProcurementModule').then((m) => ({ default: m.ProcurementModule })) }),
  manifest({ key: 'finance', label: 'Financeiro', icon: <img src="/icons/money.png" alt="" aria-hidden className="h-5 w-5" />, loader: () => import('@/FinanceModule').then((m) => ({ default: m.FinanceModule })) }),
  manifest({ key: 'products', label: 'Produtos', icon: '📂', loader: () => import('@/ProductCatalog').then((m) => ({ default: m.ProductCatalog })) }),
  manifest({ key: 'pipelines', label: 'Pipelines', icon: '🔀', loader: () => import('@/PipelineManager').then((m) => ({ default: m.PipelineManager })) }),
  manifest({ key: 'lead-scoring', label: 'Lead Scoring', icon: '⭐', loader: () => import('@/LeadScoringSystem').then((m) => ({ default: m.LeadScoringSystem })) }),
  manifest({ key: 'webhooks', label: 'Webhooks', icon: '🔌', loader: () => import('@/WebhooksIntegrationsHub').then((m) => ({ default: m.WebhooksIntegrationsHub })) }),
  manifest({ key: 'companies', label: 'Empresas', icon: '🏢', loader: () => import('@/MultiCompanyManagement').then((m) => ({ default: m.MultiCompanyManagement })) }),
  manifest({ key: 'notifications-test', label: 'Notif. Tester', icon: '🔔', loader: () => import('@/NotificationTester').then((m) => ({ default: m.NotificationTester })) }),
  manifest({ key: 'api', label: 'API', icon: '🧪', loader: () => import('@/APIExplorer').then((m) => ({ default: m.APIExplorer })) }),
  manifest({ key: 'reports', label: 'Relatórios', icon: <img src="/icons/chart.png" alt="" aria-hidden className="h-5 w-5" />, loader: () => import('@/ReportsDashboard').then((m) => ({ default: m.ReportsDashboard })) }),
]

export const crmModuleByKey = new Map(crmModuleRegistry.map((entry) => [entry.key, entry]))
export function moduleAvailability(manifestEntry: CrmModuleManifest, context: ModuleAccessContext): ModuleAvailability {
  if (!context.enabledModuleKeys.has(manifestEntry.key)) return { available: false, state: 'unreleased', reason: 'Este módulo ainda não foi liberado neste ambiente.' }
  if (manifestEntry.key === 'finance' && !context.financeEnabled) return { available: false, state: 'unreleased', reason: 'Financeiro aguarda liberação operacional e escopo explícito.' }
  if (!hasCrmModuleAccess(context.role, context.allowedModules, manifestEntry.key)) return { available: false, state: 'forbidden', reason: 'Você não possui a permissão necessária para este módulo.' }
  if (context.maintenanceModuleKeys?.has(manifestEntry.key)) return { available: false, state: 'maintenance', reason: 'Este módulo está em manutenção programada. A navegação e os demais módulos continuam disponíveis.' }
  return { available: true, state: 'available' }
}
