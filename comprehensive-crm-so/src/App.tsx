// Combined NEATLAB layout + full functionality exposure
import React, { useState, Suspense, lazy, useMemo } from 'react'
import { ContextDebugger } from './debug/ContextDebugger'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { useAuth } from '@/contexts/AuthContext'
import { AuthScreen } from '@/components/auth/AuthScreen'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { isNoAuthMode } from '@/utils/noAuthMode'

// Key functional modules
const LeadsManager = lazy(() => import('@/components/LeadsManager').then(m => ({ default: m.LeadsManager })))
const NotificationCenter = lazy(() => import('@/components/NotificationCenter').then(m => ({ default: m.NotificationCenter })))
const ReportsDashboard = lazy(() => import('@/components/ReportsDashboard').then(m => ({ default: m.ReportsDashboard })))
const AccountingModule = lazy(() => import('@/components/AccountingModule').then(m => ({ default: m.AccountingModule })))
const HelpDeskModule = lazy(() => import('@/components/HelpDeskModule').then(m => ({ default: m.HelpDeskModule })))
const OmnichannelCenter = lazy(() => import('@/components/OmnichannelCenter').then(m => ({ default: m.OmnichannelCenter })))
const MetaAdsManager = lazy(() => import('@/components/MetaAdsManager').then(m => ({ default: m.MetaAdsManager })))
const MetaCommandCenter = lazy(() => import('@/components/MetaCommandCenter').then(m => ({ default: m.MetaCommandCenter })))
const MetaSyncMonitor = lazy(() => import('@/components/MetaSyncMonitor').then(m => ({ default: m.MetaSyncMonitor })))
const MetaSentimentMonitor = lazy(() => import('@/components/MetaSentimentMonitor').then(m => ({ default: m.MetaSentimentMonitor })))
const WhatsAppUnifiedHub = lazy(() => import('@/components/WhatsAppUnifiedHub').then(m => ({ default: m.WhatsAppUnifiedHub })))
const InstagramStudioPro = lazy(() => import('@/components/InstagramStudioPro').then(m => ({ default: m.InstagramStudioPro })))
const ThreadsStudio = lazy(() => import('@/components/ThreadsStudio').then(m => ({ default: m.ThreadsStudio })))
const WorkflowEngine = lazy(() => import('@/components/WorkflowEngine').then(m => ({ default: m.WorkflowEngine })))
const ProjectManagement = lazy(() => import('@/components/ProjectManagement').then(m => ({ default: m.ProjectManagement })))
const KanbanBoard = lazy(() => import('@/components/KanbanBoard').then(m => ({ default: m.KanbanBoard })))
const RichTaskManager = lazy(() => import('@/components/RichTaskManager').then(m => ({ default: m.RichTaskManager })))
const TerritoriesManager = lazy(() => import('@/components/TerritoriesManager').then(m => ({ default: m.TerritoriesManager })))
const QuotesManager = lazy(() => import('@/components/QuotesManager').then(m => ({ default: m.QuotesManager })))
const WebFormsManager = lazy(() => import('@/components/WebFormsManager').then(m => ({ default: m.WebFormsManager })))
const EmailTemplatesManager = lazy(() => import('@/components/EmailTemplatesManager').then(m => ({ default: m.EmailTemplatesManager })))
const FieldsManager = lazy(() => import('@/components/FieldsManager').then(m => ({ default: m.FieldsManager })))
const CustomObjectsManager = lazy(() => import('@/components/CustomObjectsManager').then(m => ({ default: m.CustomObjectsManager })))
const PermissionsManager = lazy(() => import('@/components/PermissionsManager').then(m => ({ default: m.PermissionsManager })))
const ROIDashboard = lazy(() => import('@/components/ROIDashboard').then(m => ({ default: m.ROIDashboard })))
const AIAutomationHub = lazy(() => import('@/components/AIAutomationHub').then(m => ({ default: m.AIAutomationHub })))
const AgentDashboard = lazy(() => import('@/components/AgentDashboard').then(m => ({ default: m.AgentDashboard })))
const PerformanceCoaching = lazy(() => import('@/components/PerformanceCoaching').then(m => ({ default: m.PerformanceCoaching })))
const PerformanceAlerts = lazy(() => import('@/components/PerformanceAlerts').then(m => ({ default: m.PerformanceAlerts })))
const BackupRecoveryCenter = lazy(() => import('@/components/BackupRecoveryCenter').then(m => ({ default: m.BackupRecoveryCenter })))
const SystemMonitoring = lazy(() => import('@/components/SystemMonitoring').then(m => ({ default: m.SystemMonitoring })))
const AssetManagement = lazy(() => import('@/components/AssetManagement').then(m => ({ default: m.AssetManagement })))
const ManufacturingModule = lazy(() => import('@/components/ManufacturingModule').then(m => ({ default: m.ManufacturingModule })))
const HRModule = lazy(() => import('@/components/HRModule').then(m => ({ default: m.HRModule })))
const ProcurementModule = lazy(() => import('@/components/ProcurementModule').then(m => ({ default: m.ProcurementModule })))
const Financeiro = lazy(() => import('@/components/AccountingModule').then(m => ({ default: m.AccountingModule })))
const ProductCatalog = lazy(() => import('@/components/ProductCatalog').then(m => ({ default: m.ProductCatalog })))
const PipelineManager = lazy(() => import('@/components/PipelineManager').then(m => ({ default: m.PipelineManager })))
const LeadScoringSystem = lazy(() => import('@/components/LeadScoringSystem').then(m => ({ default: m.LeadScoringSystem })))
const WebhooksIntegrationsHub = lazy(() => import('@/components/WebhooksIntegrationsHub').then(m => ({ default: m.WebhooksIntegrationsHub })))
const MultiCompanyManagement = lazy(() => import('@/components/MultiCompanyManagement').then(m => ({ default: m.MultiCompanyManagement })))
const APIExplorer = lazy(() => import('@/components/APIExplorer').then(m => ({ default: m.APIExplorer })))
const Relatorios = lazy(() => import('@/components/ReportsDashboard').then(m => ({ default: m.ReportsDashboard })))
const NotificationTester = lazy(() => import('@/components/NotificationTester').then(m => ({ default: m.NotificationTester })))

// TODO: Add remaining modules if needed

// Mocks mínimos para props obrigatórias
const mockActivities = [
    { id: 'a1', type: 'call', subject: 'Ligação inicial', description: 'Primeiro contato', date: new Date().toISOString(), userId: 'u1' },
    { id: 'a2', type: 'email', subject: 'Envio de proposta', description: 'Proposta enviada', date: new Date().toISOString(), userId: 'u1' }
] as any

const modules: { key: string; label: string; icon: string; component: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Analítica', icon: '📊', component: <ReportsDashboard /> },
    { key: 'leads', label: 'Leads', icon: '💎', component: <LeadsManager /> },
    { key: 'notifications', label: 'Notificações', icon: '🔔', component: <NotificationCenter /> },
    { key: 'helpdesk', label: 'Help Desk', icon: '🎧', component: <HelpDeskModule /> },
    { key: 'omnichannel', label: 'Omnichannel', icon: '💬', component: <OmnichannelCenter activities={mockActivities} /> },
    { key: 'meta-ads', label: 'Meta Ads', icon: '📢', component: <MetaAdsManager /> },
    { key: 'meta-command', label: 'Meta Command', icon: '🧭', component: <MetaCommandCenter /> },
    { key: 'meta-sync', label: 'Meta Sync', icon: '🔄', component: <MetaSyncMonitor /> },
    { key: 'meta-sentiment', label: 'Sentimento', icon: '🧠', component: <MetaSentimentMonitor /> },
    { key: 'whatsapp-business', label: 'WhatsApp', icon: '📱', component: <WhatsAppUnifiedHub /> },
    { key: 'instagram-studio', label: 'Instagram', icon: '📸', component: <InstagramStudioPro /> },
    { key: 'threads-studio', label: 'Threads', icon: '🧵', component: <ThreadsStudio /> },
    { key: 'workflow', label: 'Workflows', icon: '⚙️', component: <WorkflowEngine /> },
    { key: 'projects', label: 'Projetos', icon: '📁', component: <ProjectManagement /> },
    { key: 'kanban', label: 'Kanban', icon: '🗂️', component: <KanbanBoard type="tasks" title="Quadro Kanban" description="Gestão visual de tarefas" /> },
    { key: 'tasks', label: 'Tarefas', icon: '✅', component: <RichTaskManager /> },
    { key: 'territories', label: 'Territórios', icon: '🗺️', component: <TerritoriesManager /> },
    { key: 'quotes', label: 'Cotações', icon: '💬', component: <QuotesManager /> },
    { key: 'web-forms', label: 'Forms', icon: '📝', component: <WebFormsManager /> },
    { key: 'email-templates', label: 'Templates', icon: '✉️', component: <EmailTemplatesManager /> },
    { key: 'fields', label: 'Campos', icon: '🧩', component: <FieldsManager objectType="customer" objectName="Cliente" /> },
    { key: 'permissions', label: 'Permissões', icon: '🔑', component: <PermissionsManager /> },
    { key: 'custom-objects', label: 'Objetos', icon: '🛠️', component: <CustomObjectsManager /> },
    { key: 'roi', label: 'ROI', icon: '📈', component: <ROIDashboard /> },
    { key: 'ai-automation', label: 'AI Automação', icon: '🤖', component: <AIAutomationHub /> },
    { key: 'agent-dashboard', label: 'Agentes', icon: '🧑‍💼', component: <AgentDashboard /> },
    { key: 'coaching', label: 'Coaching', icon: '🎯', component: <PerformanceCoaching /> },
    { key: 'alerts', label: 'Alertas', icon: '🚨', component: <PerformanceAlerts /> },
    { key: 'backup-recovery', label: 'Backup', icon: '💾', component: <BackupRecoveryCenter /> },
    { key: 'system-monitoring', label: 'Monitoramento', icon: '🖥️', component: <SystemMonitoring /> },
    { key: 'assets', label: 'Ativos', icon: '📦', component: <AssetManagement /> },
    { key: 'manufacturing', label: 'Fabricação', icon: '🏭', component: <ManufacturingModule /> },
    { key: 'hr', label: 'RH', icon: '👥', component: <HRModule /> },
    { key: 'procurement', label: 'Compras', icon: '🛒', component: <ProcurementModule /> },
    { key: 'accounting', label: 'Financeiro', icon: '💰', component: <Financeiro /> },
    { key: 'products', label: 'Produtos', icon: '📂', component: <ProductCatalog /> },
    { key: 'pipelines', label: 'Pipelines', icon: '🔀', component: <PipelineManager /> },
    { key: 'lead-scoring', label: 'Lead Scoring', icon: '⭐', component: <LeadScoringSystem /> },
    { key: 'webhooks', label: 'Webhooks', icon: '🔌', component: <WebhooksIntegrationsHub /> },
    { key: 'companies', label: 'Empresas', icon: '🏢', component: <MultiCompanyManagement /> },
    { key: 'notifications-test', label: 'Notif. Tester', icon: '🔔', component: <NotificationTester /> },
    { key: 'api', label: 'API', icon: '🧪', component: <APIExplorer /> },
    { key: 'reports', label: 'Relatórios', icon: '📊', component: <Relatorios /> },
]

export default function AppFunctionalNeatlab() {
    const { isAuthenticated, user, signOut } = useAuth()
    // Persist active module to survive remounts/reloads and avoid accidental resets
    const [active, setActive] = useState<string>(() => {
        try {
            const saved = localStorage.getItem('app.activeModule')
            return saved || 'dashboard'
        } catch { return 'dashboard' }
    })
    const [search, setSearch] = useState('')
    console.log('AppFunctionalNeatlab render, active=', active)

    // Save active module selection
    React.useEffect(() => {
        try { localStorage.setItem('app.activeModule', active) } catch { /* ignore */ }
    }, [active])

    const filteredModules = useMemo(() => modules.filter(m =>
        m.label.toLowerCase().includes(search.toLowerCase()) ||
        m.key.includes(search.toLowerCase())
    ), [search])

    // Resolve active module once for rendering content independently of sidebar filtering
    const activeModule = useMemo(() => modules.find(m => m.key === active), [active])

    if (!isAuthenticated) {
        return <AuthScreen />
    }

    return (
        <NotificationProvider>
            {/* Premium Background with animated gradient */}
            <div className="min-h-screen relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-corporate-900 via-brand-900 to-corporate-800">
                    <div className="absolute inset-0 bg-gradient-to-r from-brand-600/20 via-purple-600/20 to-cyan-600/20"></div>
                    {/* Animated background patterns */}
                    <div className="absolute inset-0">
                        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl animate-pulse"></div>
                        <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
                        <div className="absolute top-2/3 left-1/2 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-2000"></div>
                    </div>
                </div>
                
                {/* Grid pattern overlay */}
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDYwIDAgTCAwIDAgMCA2MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDMpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-20"></div>
                
                <div className="relative z-10 flex h-screen">
                    {/* Premium Sidebar */}
                    <div className="w-80 glass-morphism border-r border-white/10 backdrop-blur-2xl flex flex-col">
                        {/* Header with Corporate Branding */}
                        <div className="p-6 border-b border-white/10">
                            <div className="flex items-center gap-4 mb-4">
                                {/* Premium Logo */}
                                <div className="relative">
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-blue flex items-center justify-center shadow-premium border border-white/20">
                                        <div className="text-xl font-bold text-white tracking-tight">EF</div>
                                        <div className="absolute -inset-1 bg-gradient-to-r from-brand-600 via-purple-600 to-cyan-600 rounded-2xl blur opacity-30 animate-pulse"></div>
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h1 className="text-lg font-bold text-white leading-tight truncate">Espaço Facial</h1>
                                    <p className="text-xs text-blue-300/80 truncate">CRM Enterprise</p>
                                </div>
                            </div>
                            
                            {/* User Info */}
                            <div className="glass-morphism rounded-xl p-3 border border-white/10">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-gradient-blue flex items-center justify-center text-sm font-semibold text-white">
                                        {(user?.name || 'U').charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-white text-sm leading-tight truncate">{user?.name || 'Usuário'}</p>
                                        <p className="text-xs text-blue-300/70 truncate">{user?.email}</p>
                                    </div>
                                    <button 
                                        onClick={signOut} 
                                        className="text-xs text-blue-300/70 hover:text-red-400 transition-all duration-300 hover:scale-105" 
                                        title="Sair"
                                    >
                                        ⏻
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        {/* Navigation */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {filteredModules.map((m, index) => (
                                <button
                                    key={m.key}
                                    onClick={() => setActive(m.key)}
                                    className={`w-full group relative overflow-hidden rounded-xl transition-all duration-300 animate-slide-up`}
                                    style={{ animationDelay: `${index * 50}ms` }}
                                >
                                    <div className={`flex items-center gap-3 px-4 py-3 relative z-10 transition-all duration-300 ${
                                        active === m.key 
                                            ? 'text-white transform scale-[1.02]' 
                                            : 'text-blue-100/80 hover:text-white hover:transform hover:scale-[1.01]'
                                    }`}>
                                        <span className="text-lg leading-none flex-shrink-0 transition-transform duration-300 group-hover:scale-110">{m.icon}</span>
                                        <span className="truncate font-medium text-sm">{m.label}</span>
                                        {active === m.key && (
                                            <div className="ml-auto w-2 h-2 rounded-full bg-white animate-pulse"></div>
                                        )}
                                    </div>
                                    
                                    {/* Active state background */}
                                    {active === m.key ? (
                                        <div className="absolute inset-0 bg-gradient-blue rounded-xl shadow-premium animate-scale-in"></div>
                                    ) : (
                                        <div className="absolute inset-0 bg-white/[0.05] hover:bg-white/[0.12] rounded-xl transition-all duration-300 opacity-0 group-hover:opacity-100"></div>
                                    )}
                                </button>
                            ))}
                        </div>
                        
                        {/* Footer */}
                        <div className="p-4 border-t border-white/10">
                            <div className="flex items-center gap-2 text-xs text-blue-300/60">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
                                <span>v1.0.0 Enterprise Edition</span>
                            </div>
                        </div>
                    </div>

                    {/* Premium Main Area */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Premium Header */}
                        <header className="glass-morphism border-b border-white/10 backdrop-blur-xl px-8 py-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="animate-fade-in">
                                        <h1 className="text-2xl font-bold text-white leading-tight">
                                            {modules.find(m => m.key === active)?.label || 'Dashboard'}
                                        </h1>
                                        <p className="text-sm text-blue-300/80 mt-1">Plataforma empresarial unificada</p>
                                    </div>
                                    <div className="w-px h-8 bg-white/20 hidden lg:block"></div>
                                    <div className="hidden lg:flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                                        <span className="text-xs text-green-300 font-medium">Sistema Online</span>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-4">
                                    {/* Premium Search */}
                                    <div className="relative">
                                        <Input
                                            placeholder="Buscar módulos..."
                                            value={search}
                                            onChange={e => setSearch(e.target.value)}
                                            className="pl-12 w-80 bg-white/[0.08] border-white/20 text-white placeholder:text-blue-300/60"
                                        />
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-300/60 text-lg">🔍</span>
                                        {search && (
                                            <button 
                                                onClick={() => setSearch('')}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-300/60 hover:text-white transition-colors"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                    
                                    {/* Premium Notifications */}
                                    <Button 
                                        variant="outline" 
                                        className="relative bg-white/[0.08] border-white/20 text-white hover:bg-white/[0.12] h-11 w-11 p-0"
                                    >
                                        <span className="text-lg">🔔</span>
                                        <Badge className="absolute -top-1 -right-1 bg-red-500 text-white text-xs h-5 w-5 rounded-full flex items-center justify-center p-0 animate-pulse">
                                            3
                                        </Badge>
                                    </Button>
                                    
                                    {/* Settings Button */}
                                    <Button 
                                        variant="outline" 
                                        className="bg-white/[0.08] border-white/20 text-white hover:bg-white/[0.12] h-11 w-11 p-0"
                                    >
                                        <span className="text-lg">⚙️</span>
                                    </Button>
                                </div>
                            </div>
                        </header>

                        {/* NO_AUTH DEBUG BANNER */}
                        {isNoAuthMode() && (
                            <div className="bg-gradient-to-r from-orange-600 via-red-600 to-pink-600 border-b border-red-500/30 px-8 py-3 animate-pulse">
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl">🔓</span>
                                        <span className="font-bold text-white text-sm">NO_AUTH MODE ATIVO</span>
                                    </div>
                                    <div className="w-px h-4 bg-white/30"></div>
                                    <div className="text-xs text-white/90">
                                        Autenticação desabilitada para desenvolvimento • Não usar em produção
                                    </div>
                                    <div className="ml-auto">
                                        <Badge className="bg-red-500/20 text-red-100 border-red-400/30 text-xs">
                                            DEVELOPMENT ONLY
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Premium Main Content */}
                        <main className="flex-1 overflow-auto p-8 relative">
                            {/* Content Background */}
                            <div className="absolute inset-0 bg-white/[0.02] backdrop-blur-sm"></div>
                            
                            <div className="relative z-10">
                                <div className="hidden">{search}</div>
                                <ErrorBoundary>
                                    <Suspense fallback={
                                        <div className="glass-morphism rounded-2xl p-8 border border-white/20 animate-pulse">
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 rounded-xl bg-gradient-blue animate-spin flex items-center justify-center">
                                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                </div>
                                                <div>
                                                    <div className="text-white font-semibold">Carregando módulo...</div>
                                                    <div className="text-blue-300/60 text-sm">Preparando interface empresarial</div>
                                                </div>
                                            </div>
                                        </div>
                                    }>
                                        <div className="animate-fade-in">
                                            {activeModule?.component}
                                        </div>
                                    </Suspense>
                                    <ContextDebugger />
                                </ErrorBoundary>
                            </div>
                        </main>
                    </div>
                </div>
            </div>
        </NotificationProvider>
    )
}
