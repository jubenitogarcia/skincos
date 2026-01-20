// Combined NEATLAB layout + full functionality exposure
import React, { useState, Suspense, lazy, useMemo } from 'react'
import { ContextDebugger } from './ContextDebugger'
import { ErrorBoundary } from '@/ErrorBoundary'
import { NotificationProvider, useAuth, useNotifications } from '@/contexts'
import { AuthScreen } from '@/AuthScreen'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Tabs, TabsContent } from '@/tabs'
import { Input } from '@/input'
import { isNoAuthMode } from '@/noAuthMode'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { useKV } from '@/spark-mock'

const INSUMOS_UNIT_KEY = 'skincos.insumos.unidade.v1'
const UNIT_MONITOR_UNITS: Array<{ value: string; label: string }> = [
    { value: 'unit-a', label: 'A' },
    { value: 'unit-b', label: 'B' },
    { value: 'unit-c', label: 'C' },
    { value: 'custom', label: 'Outra…' }
]

type ApiError = {
    error?: string
    message?: string
    code?: string
}

type InsumosMeResponse = {
    success?: boolean
    user?: { username?: string; displayName?: string; email?: string; role?: string }
    csrfToken?: string
}

async function insumosApiJson<T>(
    path: string,
    opts: {
        method?: string
        body?: unknown
        signal?: AbortSignal
    } = {}
): Promise<T> {
    const method = opts.method || 'GET'
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    const url = path.startsWith('/api/insumos') ? path : `/api/insumos${path.startsWith('/') ? '' : '/'}${path}`
    const res = await fetch(url, {
        method,
        headers,
        credentials: 'include',
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal
    })
    const text = await res.text()
    let json: unknown = null
    try {
        json = text ? JSON.parse(text) : null
    } catch {
        json = null
    }
    if (res.ok) return json as T
    const err = (json || {}) as ApiError
    throw new Error(err.error || err.message || `HTTP ${res.status}`)
}

// Key functional modules
const LeadsManager = lazy(() => import('@/LeadsManager').then(m => ({ default: m.LeadsManager })))
const NotificationCenter = lazy(() => import('@/NotificationCenter').then(m => ({ default: m.NotificationCenter })))
const ReportsDashboard = lazy(() => import('@/ReportsDashboard').then(m => ({ default: m.ReportsDashboard })))
const AccountingModule = lazy(() => import('@/AccountingModule').then(m => ({ default: m.AccountingModule })))
const HelpDeskModule = lazy(() => import('@/HelpDeskModule').then(m => ({ default: m.HelpDeskModule })))
const OmnichannelCenter = lazy(() => import('@/OmnichannelCenter').then(m => ({ default: m.OmnichannelCenter })))
const MetaAdsManager = lazy(() => import('@/MetaAdsManager').then(m => ({ default: m.MetaAdsManager })))
const MetaCommandCenter = lazy(() => import('@/MetaCommandCenter').then(m => ({ default: m.MetaCommandCenter })))
const MetaSyncMonitor = lazy(() => import('@/MetaSyncMonitor').then(m => ({ default: m.MetaSyncMonitor })))
const MetaSentimentMonitor = lazy(() => import('@/MetaSentimentMonitor').then(m => ({ default: m.MetaSentimentMonitor })))
const WhatsAppUnifiedHub = lazy(() => import('@/WhatsAppUnifiedHub').then(m => ({ default: m.WhatsAppUnifiedHub })))
const InstagramStudioPro = lazy(() => import('@/InstagramStudioPro').then(m => ({ default: m.InstagramStudioPro })))
const ThreadsStudio = lazy(() => import('@/ThreadsStudio').then(m => ({ default: m.ThreadsStudio })))
const WorkflowEngine = lazy(() => import('@/WorkflowEngine').then(m => ({ default: m.WorkflowEngine })))
const ProjectManagement = lazy(() => import('@/ProjectManagement').then(m => ({ default: m.ProjectManagement })))
const KanbanBoard = lazy(() => import('@/KanbanBoard').then(m => ({ default: m.KanbanBoard })))
const RichTaskManager = lazy(() => import('@/RichTaskManager').then(m => ({ default: m.RichTaskManager })))
const TerritoriesManager = lazy(() => import('@/TerritoriesManager').then(m => ({ default: m.TerritoriesManager })))
const QuotesManager = lazy(() => import('@/QuotesManager').then(m => ({ default: m.QuotesManager })))
const WebFormsManager = lazy(() => import('@/WebFormsManager').then(m => ({ default: m.WebFormsManager })))
const EmailTemplatesManager = lazy(() => import('@/EmailTemplatesManager').then(m => ({ default: m.EmailTemplatesManager })))
const FieldsManager = lazy(() => import('@/FieldsManager').then(m => ({ default: m.FieldsManager })))
const CustomObjectsManager = lazy(() => import('@/CustomObjectsManager').then(m => ({ default: m.CustomObjectsManager })))
const PermissionsManager = lazy(() => import('@/PermissionsManager').then(m => ({ default: m.PermissionsManager })))
const ROIDashboard = lazy(() => import('@/ROIDashboard').then(m => ({ default: m.ROIDashboard })))
const AIAutomationHub = lazy(() => import('@/AIAutomationHub').then(m => ({ default: m.AIAutomationHub })))
const AgentDashboard = lazy(() => import('@/AgentDashboard').then(m => ({ default: m.AgentDashboard })))
const PerformanceCoaching = lazy(() => import('@/PerformanceCoaching').then(m => ({ default: m.PerformanceCoaching })))
const PerformanceAlerts = lazy(() => import('@/PerformanceAlerts').then(m => ({ default: m.PerformanceAlerts })))
const BackupRecoveryCenter = lazy(() => import('@/BackupRecoveryCenter').then(m => ({ default: m.BackupRecoveryCenter })))
const SystemMonitoring = lazy(() => import('@/SystemMonitoring').then(m => ({ default: m.SystemMonitoring })))
const AssetManagement = lazy(() => import('@/AssetManagement').then(m => ({ default: m.AssetManagement })))
const ManufacturingModule = lazy(() => import('@/ManufacturingModule').then(m => ({ default: m.ManufacturingModule })))
const HRModule = lazy(() => import('@/HRModule').then(m => ({ default: m.HRModule })))
const ProcurementModule = lazy(() => import('@/ProcurementModule').then(m => ({ default: m.ProcurementModule })))
const Financeiro = lazy(() => import('@/AccountingModule').then(m => ({ default: m.AccountingModule })))
const ProductCatalog = lazy(() => import('@/ProductCatalog').then(m => ({ default: m.ProductCatalog })))
const PipelineManager = lazy(() => import('@/PipelineManager').then(m => ({ default: m.PipelineManager })))
const LeadScoringSystem = lazy(() => import('@/LeadScoringSystem').then(m => ({ default: m.LeadScoringSystem })))
const WebhooksIntegrationsHub = lazy(() => import('@/WebhooksIntegrationsHub').then(m => ({ default: m.WebhooksIntegrationsHub })))
const MultiCompanyManagement = lazy(() => import('@/MultiCompanyManagement').then(m => ({ default: m.MultiCompanyManagement })))
const APIExplorer = lazy(() => import('@/APIExplorer').then(m => ({ default: m.APIExplorer })))
const Relatorios = lazy(() => import('@/ReportsDashboard').then(m => ({ default: m.ReportsDashboard })))
const NotificationTester = lazy(() => import('@/NotificationTester').then(m => ({ default: m.NotificationTester })))
const CapabilitiesCenter = lazy(() => import('@/CapabilitiesCenter').then(m => ({ default: m.CapabilitiesCenter })))
const JobsCenter = lazy(() => import('@/JobsCenter').then(m => ({ default: m.JobsCenter })))
const UnitMonitor = lazy(() => import('@/UnitMonitor').then(m => ({ default: m.UnitMonitor })))
const InsumosModule = lazy(() => import('@/InsumosModule').then(m => ({ default: m.InsumosModule })))
const UsersModule = lazy(() => import('@/UsersModule').then(m => ({ default: m.UsersModule })))
const SystemStatusModule = lazy(() => import('@/SystemStatusModule').then(m => ({ default: m.SystemStatusModule })))

// TODO: Add remaining modules if needed

// Mocks mínimos para props obrigatórias
const mockActivities = [
    { id: 'a1', type: 'call', subject: 'Ligação inicial', description: 'Primeiro contato', date: new Date().toISOString(), userId: 'u1' },
    { id: 'a2', type: 'email', subject: 'Envio de proposta', description: 'Proposta enviada', date: new Date().toISOString(), userId: 'u1' }
] as any

const modules: { key: string; label: string; icon: React.ReactNode; component: React.ReactNode }[] = [
    { key: 'capabilities', label: 'Plataforma', icon: '🧭', component: <CapabilitiesCenter /> },
    { key: 'jobs', label: 'Execuções', icon: '🏃', component: <JobsCenter /> },
    { key: 'status', label: 'Status', icon: '📡', component: <SystemStatusModule /> },
    { key: 'unit-monitor', label: 'Unit Monitor', icon: '📹', component: <UnitMonitor /> },
    {
        key: 'insumos',
        label: 'Insumos',
        icon: <img src="/icons/insumos-icon-192.svg" alt="" aria-hidden className="h-5 w-5" />,
        component: <InsumosModule />
    },
    { key: 'users', label: 'Usuários', icon: '👤', component: <UsersModule /> },
    { key: 'dashboard', label: 'Analítica', icon: <img src="/icons/chart.png" alt="" aria-hidden className="h-5 w-5" />, component: <ReportsDashboard /> },
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
    { key: 'alerts', label: 'Alertas', icon: <img src="/icons/emergency.png" alt="" aria-hidden className="h-5 w-5" />, component: <PerformanceAlerts /> },
    { key: 'backup-recovery', label: 'Backup', icon: '💾', component: <BackupRecoveryCenter /> },
    { key: 'system-monitoring', label: 'Monitoramento', icon: '🖥️', component: <SystemMonitoring /> },
    { key: 'assets', label: 'Ativos', icon: '📦', component: <AssetManagement /> },
    { key: 'manufacturing', label: 'Fabricação', icon: '🏭', component: <ManufacturingModule /> },
    { key: 'hr', label: 'RH', icon: '👥', component: <HRModule /> },
    { key: 'procurement', label: 'Compras', icon: '🛒', component: <ProcurementModule /> },
    { key: 'accounting', label: 'Financeiro', icon: <img src="/icons/money.png" alt="" aria-hidden className="h-5 w-5" />, component: <Financeiro /> },
    { key: 'products', label: 'Produtos', icon: '📂', component: <ProductCatalog /> },
    { key: 'pipelines', label: 'Pipelines', icon: '🔀', component: <PipelineManager /> },
    { key: 'lead-scoring', label: 'Lead Scoring', icon: '⭐', component: <LeadScoringSystem /> },
    { key: 'webhooks', label: 'Webhooks', icon: '🔌', component: <WebhooksIntegrationsHub /> },
    { key: 'companies', label: 'Empresas', icon: '🏢', component: <MultiCompanyManagement /> },
    { key: 'notifications-test', label: 'Notif. Tester', icon: '🔔', component: <NotificationTester /> },
    { key: 'api', label: 'API', icon: '🧪', component: <APIExplorer /> },
    { key: 'reports', label: 'Relatórios', icon: <img src="/icons/chart.png" alt="" aria-hidden className="h-5 w-5" />, component: <Relatorios /> },
]

export default function AppFunctionalNeatlab() {
    const { isAuthenticated, user, signOut } = useAuth()

    const DEFAULT_MODULE_KEY = 'insumos'

	    const [profileOpen, setProfileOpen] = useState(false)
	    const [profileLoading, setProfileLoading] = useState(false)
	    const [profileSaving, setProfileSaving] = useState(false)
	    const [profileError, setProfileError] = useState<string | null>(null)
	    const [insumosMe, setInsumosMe] = useState<InsumosMeResponse | null>(null)
	    const [profileDisplayName, setProfileDisplayName] = useState('')
	    const [profileEmail, setProfileEmail] = useState('')
	    const [profileCurrentPassword, setProfileCurrentPassword] = useState('')
	    const [profileNewPassword, setProfileNewPassword] = useState('')

	    const loadProfile = React.useCallback(async () => {
	        setProfileLoading(true)
	        setProfileError(null)
	        try {
	            const out = await insumosApiJson<InsumosMeResponse>('/auth/me')
	            setInsumosMe(out || null)
	            setProfileDisplayName(out?.user?.displayName || out?.user?.username || '')
	            setProfileEmail(out?.user?.email || '')
	        } catch (e: any) {
	            setInsumosMe(null)
	            setProfileError(e?.message || 'Não foi possível carregar o perfil.')
	        } finally {
	            setProfileLoading(false)
	        }
	    }, [])

	    React.useEffect(() => {
	        if (!profileOpen) return
	        void loadProfile()
	    }, [loadProfile, profileOpen])

	    const saveProfile = React.useCallback(async () => {
	        setProfileSaving(true)
	        setProfileError(null)
	        try {
	            const body: any = {
	                displayName: profileDisplayName.trim(),
	                email: profileEmail.trim()
	            }
	            if (profileNewPassword.trim()) {
	                body.newPassword = profileNewPassword.trim()
	                body.currentPassword = profileCurrentPassword
	            }
	            await insumosApiJson('/auth/profile', { method: 'PUT', body })
	            setProfileCurrentPassword('')
	            setProfileNewPassword('')
	            await loadProfile()
	        } catch (e: any) {
	            setProfileError(e?.message || 'Não foi possível salvar o perfil.')
	        } finally {
	            setProfileSaving(false)
	        }
	    }, [loadProfile, profileCurrentPassword, profileDisplayName, profileEmail, profileNewPassword])

		    const UNLOCKED_MODULE_KEYS = useMemo(() => new Set([DEFAULT_MODULE_KEY]), [])
	    const [sidebarHover, setSidebarHover] = useState(false)
	    const [sidebarCanHover, setSidebarCanHover] = useState(() => {
	        try {
	            return window.matchMedia('(hover: hover) and (pointer: fine)').matches
	        } catch {
	            return false
	        }
	    })
	    const [sidebarPinned, setSidebarPinned] = useState<boolean>(() => {
	        try {
	            return localStorage.getItem('ui.sidebarPinned') === 'true'
	        } catch {
            return false
        }
    })

    React.useEffect(() => {
        try {
            setSidebarCanHover(window.matchMedia('(hover: hover) and (pointer: fine)').matches)
        } catch {
            setSidebarCanHover(false)
        }
    }, [])

    React.useEffect(() => {
        try {
            localStorage.setItem('ui.sidebarPinned', sidebarPinned ? 'true' : 'false')
        } catch { /* ignore */ }
    }, [sidebarPinned])

    const sidebarExpanded = sidebarPinned || !sidebarCanHover || sidebarHover

    // Persist active module to survive remounts/reloads and avoid accidental resets
	    const [active, setActive] = useState<string>(() => {
	        try {
	            const saved = localStorage.getItem('app.activeModule')
	            const candidate = saved || DEFAULT_MODULE_KEY
	            return UNLOCKED_MODULE_KEYS.has(candidate) ? candidate : DEFAULT_MODULE_KEY
	        } catch { return DEFAULT_MODULE_KEY }
	    })

	    React.useEffect(() => {
	        if (UNLOCKED_MODULE_KEYS.has(active)) return
	        setActive(DEFAULT_MODULE_KEY)
	    }, [DEFAULT_MODULE_KEY, UNLOCKED_MODULE_KEYS, active])
	    const [search, setSearch] = useState('')
	    const [insumosHeaderStatus, setInsumosHeaderStatus] = useState<{
	        online: boolean | null
	        authed: boolean | null
	        integrated: boolean | null
	        unidades: string[]
	        allowedUnits: string[]
	    } | null>(null)
	    const [insumosUnit, setInsumosUnit] = useState<string>(() => {
	        try {
	            return localStorage.getItem(INSUMOS_UNIT_KEY) || 'novo-hamburgo'
	        } catch {
	            return 'novo-hamburgo'
	        }
		    })
		    const [unitMonitorSelectedUnit, setUnitMonitorSelectedUnit] = useKV<string>('unit-monitor:selected-unit', 'unit-a')
		    const [unitMonitorCustomUnit, setUnitMonitorCustomUnit] = useKV<string>('unit-monitor:custom-unit', '')

		    const formatUnitLabel = (u: string) =>
		        String(u || '')
		            .split('-')
	            .filter(Boolean)
	            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
	            .join(' ')

    // Allow forcing a module via URL, e.g. http://localhost:5173/?module=capabilities
    React.useEffect(() => {
        try {
            const params = new URLSearchParams(window.location.search)
            const requested = params.get('module') || params.get('tab')
            const wantsInsumosShortcut =
                params.has('insumosTab') ||
                params.has('insumosAction') ||
                params.has('insumos') ||
                params.has('cadastro') ||
                params.has('scanner') ||
                params.has('shareTitle') ||
                params.has('shareText') ||
                params.has('shareUrl') ||
                params.has('shareFiles')
            if (requested && UNLOCKED_MODULE_KEYS.has(requested) && modules.some((m) => m.key === requested)) {
                setActive(requested)
            } else if (wantsInsumosShortcut && UNLOCKED_MODULE_KEYS.has('insumos')) {
                setActive('insumos')
            }
        } catch { /* ignore */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

	    // Save active module selection
	    React.useEffect(() => {
	        try { localStorage.setItem('app.activeModule', active) } catch { /* ignore */ }
	    }, [active])

	    React.useEffect(() => {
	        if (active !== 'insumos') {
	            setInsumosHeaderStatus(null)
	            return
	        }

	        const ac = new AbortController()

	        ;(async () => {
	            try {
	                const [healthRes, meRes] = await Promise.all([
	                    fetch('/api/insumos/health', { credentials: 'include', signal: ac.signal }).catch(() => null),
	                    fetch('/api/insumos/auth/me', { credentials: 'include', signal: ac.signal }).catch(() => null),
	                ])

	                let online: boolean | null = null
	                let integrated: boolean | null = null
	                let unidades: string[] = []
	                if (healthRes?.ok) {
	                    const h: any = await healthRes.json().catch(() => null)
	                    online = Boolean(h?.ok)
	                    integrated = typeof h?.sheetsConfigured === 'boolean' ? Boolean(h.sheetsConfigured) : null
	                    unidades = Array.isArray(h?.unidades) ? h.unidades.filter(Boolean).map((x: any) => String(x)) : []
	                } else if (healthRes) {
	                    online = false
	                }

	                let authed: boolean | null = null
	                let allowedUnits: string[] = []
	                if (meRes?.ok) {
	                    const m: any = await meRes.json().catch(() => null)
	                    authed = Boolean(m?.user?.username)
	                    allowedUnits = Array.isArray(m?.user?.allowedUnits)
	                        ? m.user.allowedUnits.filter(Boolean).map((x: any) => String(x))
	                        : []
	                } else if (meRes) {
	                    authed = false
	                }

	                const candidateUnits = unidades.length ? unidades : ['novo-hamburgo', 'barra-shopping-sul']
	                const filteredUnits = allowedUnits.length
	                    ? candidateUnits.filter((u) => allowedUnits.includes(u))
	                    : candidateUnits
	                const options = filteredUnits.length ? filteredUnits : candidateUnits

	                let nextUnit = insumosUnit
	                try {
	                    const saved = localStorage.getItem(INSUMOS_UNIT_KEY)
	                    if (saved) nextUnit = saved
	                } catch { /* ignore */ }
	                if (!options.includes(nextUnit)) nextUnit = options[0]
	                setInsumosUnit(nextUnit)
	                try { localStorage.setItem(INSUMOS_UNIT_KEY, nextUnit) } catch { /* ignore */ }
	                try { window.dispatchEvent(new CustomEvent('skincos:insumos:unidade', { detail: { unidade: nextUnit } })) } catch { /* ignore */ }

	                setInsumosHeaderStatus({ online, authed, integrated, unidades: options, allowedUnits })
	            } catch {
	                setInsumosHeaderStatus({ online: false, authed: false, integrated: null, unidades: [], allowedUnits: [] })
	            }
	        })()

		        return () => ac.abort()
		    }, [active, insumosUnit])

    const modulesSorted = useMemo(() => {
        const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })
        return [...modules].sort((a, b) => {
            const aLocked = !UNLOCKED_MODULE_KEYS.has(a.key)
            const bLocked = !UNLOCKED_MODULE_KEYS.has(b.key)
            if (aLocked !== bLocked) return aLocked ? 1 : -1
            return collator.compare(a.label, b.label)
        })
    }, [UNLOCKED_MODULE_KEYS])

		    const filteredModules = useMemo(() => modulesSorted.filter(m =>
		        m.label.toLowerCase().includes(search.toLowerCase()) ||
		        m.key.includes(search.toLowerCase())
		    ), [modulesSorted, search])

    // Resolve active module once for rendering content independently of sidebar filtering
    const activeModule = useMemo(
        () => modules.find(m => m.key === active) || modules.find(m => m.key === DEFAULT_MODULE_KEY),
        [DEFAULT_MODULE_KEY, active]
    )

	    if (!isAuthenticated) {
	        return <AuthScreen />
	    }

	    function HeaderNotificationsButton({ onOpen }: { onOpen: () => void }) {
	        const { unreadCount } = useNotifications()
	        return (
	            <Button
	                variant="outline"
	                className="relative bg-white/[0.08] border-white/20 text-white hover:bg-white/[0.12] h-11 w-11 p-0"
	                onClick={onOpen}
	                title="Notificações"
	                aria-label="Notificações"
	            >
	                <span className="text-lg">🔔</span>
	                {unreadCount > 0 ? (
	                    <Badge className="absolute -top-1 -right-1 bg-red-500 text-white text-xs h-5 min-w-5 rounded-full flex items-center justify-center px-1 animate-pulse">
	                        {unreadCount > 99 ? '99+' : String(unreadCount)}
	                    </Badge>
	                ) : null}
	            </Button>
	        )
	    }

	    return (
	        <NotificationProvider>
            <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Perfil</DialogTitle>
                        <DialogDescription>Atualize seus dados e, se necessário, altere sua senha.</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {profileError ? (
                            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                                {profileError}
                            </div>
                        ) : null}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <div className="text-xs text-blue-200/70 mb-1">Nome</div>
                                <Input value={profileDisplayName} onChange={(e) => setProfileDisplayName(e.target.value)} disabled={profileLoading} />
                            </div>
                            <div>
                                <div className="text-xs text-blue-200/70 mb-1">Email</div>
                                <Input value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} disabled={profileLoading} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <div className="text-xs text-blue-200/70 mb-1">Senha atual</div>
                                <Input
                                    type="password"
                                    value={profileCurrentPassword}
                                    onChange={(e) => setProfileCurrentPassword(e.target.value)}
                                    disabled={profileLoading}
                                    placeholder="Somente se for trocar a senha"
                                />
                            </div>
                            <div>
                                <div className="text-xs text-blue-200/70 mb-1">Nova senha</div>
                                <Input
                                    type="password"
                                    value={profileNewPassword}
                                    onChange={(e) => setProfileNewPassword(e.target.value)}
                                    disabled={profileLoading}
                                    placeholder="Opcional"
                                />
                            </div>
                        </div>

                        <div className="text-xs text-blue-200/60">
                            Usuário: <span className="text-blue-50 font-semibold">{insumosMe?.user?.username || '—'}</span> • Perfil:{' '}
                            <span className="text-blue-50 font-semibold">{insumosMe?.user?.role || '—'}</span>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="secondary" onClick={loadProfile} disabled={profileLoading || profileSaving}>
                            {profileLoading ? 'Atualizando…' : 'Atualizar'}
                        </Button>
                        <Button onClick={saveProfile} disabled={profileLoading || profileSaving}>
                            {profileSaving ? 'Salvando…' : 'Salvar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Premium Background with animated gradient */}
                <div className="min-h-screen relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-corporate-950 via-corporate-900 to-corporate-800">
                    <div className="absolute inset-0 bg-gradient-to-r from-brand-700/20 via-brand-600/10 to-brand-700/20"></div>
                    {/* Animated background patterns */}
                    <div className="absolute inset-0">
                        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-700/10 rounded-full blur-3xl animate-pulse"></div>
                        <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-brand-600/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
                        <div className="absolute top-2/3 left-1/2 w-72 h-72 bg-brand-700/10 rounded-full blur-3xl animate-pulse delay-2000"></div>
                    </div>
                </div>

                {/* Grid pattern overlay */}
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDYwIDAgTCAwIDAgMCA2MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDMpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-20"></div>

                <div className="relative z-10 flex h-screen">
                    {/* Premium Sidebar */}
                    <div
                        className="glass-morphism border-r border-white/10 backdrop-blur-2xl flex flex-col transition-[width] duration-200 ease-out"
                        style={{ width: sidebarExpanded ? '20rem' : '4.5rem' }}
                        onMouseEnter={() => { if (sidebarCanHover) setSidebarHover(true) }}
                        onMouseLeave={() => { if (sidebarCanHover) setSidebarHover(false) }}
                        onFocusCapture={() => { if (sidebarCanHover) setSidebarHover(true) }}
                        onBlurCapture={(e) => {
                            if (!sidebarCanHover) return
                            const next = (e.relatedTarget as Node | null)
                            if (!next || !e.currentTarget.contains(next)) setSidebarHover(false)
                        }}
                    >
                        {/* Header with Corporate Branding */}
                        <div className={`${sidebarExpanded ? 'p-6' : 'p-3'} border-b border-white/10`}>
                            <div className={`flex items-center gap-4 mb-4 ${sidebarExpanded ? '' : 'justify-center'}`}>
                                {/* Premium Logo */}
                                <div className="relative">
                                    <div className="w-12 h-12 rounded-2xl bg-gradient-blue flex items-center justify-center shadow-premium border border-white/20">
                                        <img src="/brand/espacofacial-mark-white.svg" alt="" aria-hidden className="h-6 w-6" />
                                        <div className="absolute -inset-1 bg-gradient-to-r from-brand-700 via-brand-600 to-brand-700 rounded-2xl blur opacity-30 animate-pulse"></div>
                                    </div>
                                </div>
                                <div className={`flex-1 min-w-0 ${sidebarExpanded ? '' : 'hidden'}`}>
                                    <img
                                        src="/brand/espacofacial-logo-light.svg"
                                        alt="Espaço Facial"
                                        className="h-8 w-auto max-w-full"
                                    />
                                    <p className="text-[10px] text-blue-100/70 tracking-[0.25em] uppercase truncate mt-1">CRM</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSidebarPinned((v) => !v)}
                                    title={sidebarPinned ? 'Desafixar menu' : 'Fixar menu'}
                                    className={`rounded-lg border border-white/10 bg-white/[0.06] hover:bg-white/[0.12] text-blue-100/80 hover:text-white transition-colors ${sidebarExpanded ? 'px-2 py-2 text-sm' : 'hidden'}`}
                                >
                                    {sidebarPinned ? '📌' : '📍'}
                                </button>
                            </div>

                            {/* User Info */}
                            <div className={`glass-morphism rounded-xl border border-white/10 ${sidebarExpanded ? 'p-3' : 'p-2'}`}>
                                <div className={`flex items-center gap-3 ${sidebarExpanded ? '' : 'justify-center'}`}>
                                    <div className="w-8 h-8 rounded-lg bg-gradient-blue flex items-center justify-center text-sm font-semibold text-white">
                                        {(user?.name || 'U').charAt(0).toUpperCase()}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setProfileOpen(true)}
                                        className={`flex-1 min-w-0 text-left ${sidebarExpanded ? '' : 'hidden'}`}
                                        title="Abrir perfil"
                                    >
                                        <p className="font-semibold text-white text-sm leading-tight truncate">{user?.name || 'Usuário'}</p>
                                        <p className="text-xs text-blue-300/70 truncate">{user?.email}</p>
                                    </button>
                                    <button
                                        onClick={signOut}
                                        className={`${sidebarExpanded ? 'text-xs' : 'text-sm'} text-blue-300/70 hover:text-red-400 transition-all duration-300 hover:scale-105`}
                                        title="Sair"
                                    >
                                        ⏻
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Navigation */}
                        <div className={`flex-1 overflow-y-auto ${sidebarExpanded ? 'p-4' : 'p-2'} space-y-2`}>
                            {filteredModules.map((m, index) => (
                                (() => {
                                    const isLocked = !UNLOCKED_MODULE_KEYS.has(m.key)
                                    const isActive = active === m.key
                                    return (
                                        <button
                                            key={m.key}
                                            onClick={() => {
                                                if (isLocked) return
                                                setActive(m.key)
                                            }}
                                            disabled={isLocked}
                                            aria-disabled={isLocked}
                                            title={isLocked ? `${m.label} (Em breve)` : m.label}
                                            className={`w-full group relative overflow-hidden rounded-xl transition-all duration-300 animate-slide-up ${isLocked ? 'opacity-50 cursor-not-allowed' : ''
                                                }`}
                                            style={{ animationDelay: `${index * 50}ms` }}
                                        >
                                            <div className={`flex items-center gap-3 ${sidebarExpanded ? 'px-4' : 'px-0 justify-center'} py-3 relative z-10 transition-all duration-300 ${isActive
                                                    ? 'text-white transform scale-[1.02]'
                                                    : isLocked
                                                        ? 'text-blue-100/60'
                                                        : 'text-blue-100/80 hover:text-white hover:transform hover:scale-[1.01]'
                                                }`}>
                                                <span className="text-lg leading-none flex-shrink-0 transition-transform duration-300 group-hover:scale-110">{m.icon}</span>
                                                {sidebarExpanded ? (
                                                    <span className="truncate font-medium text-sm">{m.label}</span>
                                                ) : null}
                                                {sidebarExpanded ? (
                                                    isLocked ? (
                                                        <span className="ml-auto text-sm text-blue-100/80" aria-hidden>
                                                            🔒
                                                        </span>
                                                    ) : isActive ? (
                                                        <div className="ml-auto w-2 h-2 rounded-full bg-white animate-pulse"></div>
                                                    ) : null
                                                ) : (
                                                    isLocked ? (
                                                        <span className="absolute top-1 right-1 text-[10px] text-blue-100/80" aria-hidden>
                                                            🔒
                                                        </span>
                                                    ) : isActive ? (
                                                        <span className="absolute bottom-1 right-1 inline-block h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden />
                                                    ) : null
                                                )}
                                            </div>

                                            {/* Active state background */}
                                            {isActive ? (
                                                <div className="absolute inset-0 bg-gradient-blue rounded-xl shadow-premium animate-scale-in"></div>
                                            ) : (
                                                <div className={`absolute inset-0 bg-white/[0.05] rounded-xl transition-all duration-300 ${isLocked ? 'opacity-0' : 'hover:bg-white/[0.12] opacity-0 group-hover:opacity-100'
                                                    }`}></div>
                                            )}
                                        </button>
                                    )
                                })()
                            ))}
                        </div>

                        {/* Footer */}
                        <div className={`${sidebarExpanded ? 'p-4' : 'p-2'} border-t border-white/10`}>
                            <div className={`flex items-center gap-2 text-xs text-blue-300/60 ${sidebarExpanded ? '' : 'justify-center'}`}>
                                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
                                {sidebarExpanded ? <span>v1.0.0 Enterprise Edition</span> : null}
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
		                                    </div>
			                                    <div className="w-px h-8 bg-white/20 hidden lg:block"></div>
			                                    <div className="hidden lg:flex items-center gap-2">
			                                        {active === 'insumos' ? (
			                                            <>
		                                                <span className="text-xs text-blue-200/70">Unidade</span>
		                                                <Select
		                                                    value={insumosUnit}
		                                                    onValueChange={(v) => {
		                                                        setInsumosUnit(v)
		                                                        try { localStorage.setItem(INSUMOS_UNIT_KEY, v) } catch { /* ignore */ }
		                                                        try {
		                                                            window.dispatchEvent(
		                                                                new CustomEvent('skincos:insumos:unidade', { detail: { unidade: v } })
		                                                            )
		                                                        } catch { /* ignore */ }
		                                                    }}
		                                                >
		                                                    <SelectTrigger className="h-8 w-56 bg-white/[0.06] border-white/20 text-white">
		                                                        <SelectValue placeholder="Selecione" />
		                                                    </SelectTrigger>
		                                                    <SelectContent>
		                                                        {(insumosHeaderStatus?.unidades?.length
		                                                            ? insumosHeaderStatus.unidades
		                                                            : ['novo-hamburgo', 'barra-shopping-sul']
		                                                        ).map((u) => (
		                                                            <SelectItem key={u} value={u}>
		                                                                {formatUnitLabel(u)}
		                                                            </SelectItem>
		                                                        ))}
		                                                    </SelectContent>
		                                                </Select>
		                                                <div className="flex items-center gap-1 ml-2">
		                                                    <Button
		                                                    size="icon"
		                                                        variant="ghost"
		                                                        className="bg-transparent text-white hover:bg-white/[0.10]"
		                                                        onClick={() => {
		                                                            try {
		                                                                window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'ENTRADA' } }))
		                                                            } catch { /* ignore */ }
	                                                        }}
		                                                        title="Entrada"
		                                                        aria-label="Entrada"
		                                                    >
		                                                        <img src="/icons/shortcut-entrada.svg" alt="" aria-hidden className="h-9 w-9" />
		                                                    </Button>
		                                                    <Button
		                                                    size="icon"
		                                                        variant="ghost"
		                                                        className="bg-transparent text-white hover:bg-white/[0.10]"
		                                                        onClick={() => {
		                                                            try {
		                                                                window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'BAIXA' } }))
		                                                            } catch { /* ignore */ }
	                                                        }}
		                                                        title="Saída"
		                                                        aria-label="Saída"
		                                                    >
		                                                        <img src="/icons/shortcut-saida.svg" alt="" aria-hidden className="h-9 w-9" />
		                                                    </Button>
		                                                    <Button
		                                                    size="icon"
		                                                        variant="ghost"
		                                                        className="bg-transparent text-white hover:bg-white/[0.10]"
		                                                        onClick={() => {
		                                                            try {
		                                                                window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'TRANSFERENCIA' } }))
		                                                            } catch { /* ignore */ }
	                                                        }}
		                                                        title="Transferência"
		                                                        aria-label="Transferência"
		                                                    >
		                                                        <img src="/icons/shortcut-transferencia.svg" alt="" aria-hidden className="h-9 w-9" />
		                                                    </Button>
	                                                </div>
		                                            </>
			                                        ) : null}
		                                        {active === 'unit-monitor' ? (
		                                            <>
		                                                <span className="text-xs text-blue-200/70">Unidade</span>
		                                                <Select value={unitMonitorSelectedUnit} onValueChange={(v) => setUnitMonitorSelectedUnit(v)}>
		                                                    <SelectTrigger className="h-8 w-28 bg-white/[0.06] border-white/20 text-white">
		                                                        <SelectValue placeholder="Selecione" />
		                                                    </SelectTrigger>
		                                                    <SelectContent>
		                                                        {UNIT_MONITOR_UNITS.map((u) => (
		                                                            <SelectItem key={u.value} value={u.value}>
		                                                                {u.label}
		                                                            </SelectItem>
		                                                        ))}
		                                                    </SelectContent>
		                                                </Select>
		                                                {unitMonitorSelectedUnit === 'custom' ? (
		                                                    <Input
		                                                        value={unitMonitorCustomUnit}
		                                                        onChange={(e) => setUnitMonitorCustomUnit(e.target.value)}
		                                                        placeholder="Nome da unidade"
		                                                        className="h-8 w-48 bg-white/[0.06] border-white/20 text-white placeholder:text-blue-200/40"
		                                                    />
		                                                ) : null}
		                                            </>
		                                        ) : null}
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

	                                    {UNLOCKED_MODULE_KEYS.has('notifications') ? (
	                                        <HeaderNotificationsButton
	                                            onOpen={() => {
	                                                setSearch('')
	                                                setActive('notifications')
	                                            }}
	                                        />
	                                    ) : null}

	                                    {UNLOCKED_MODULE_KEYS.has('status') ? (
	                                        <Button
	                                            variant="outline"
	                                            className="bg-white/[0.08] border-white/20 text-white hover:bg-white/[0.12] h-11 w-11 p-0"
	                                            onClick={() => {
	                                                setSearch('')
	                                                setActive('status')
	                                            }}
	                                            title="Status do sistema"
	                                            aria-label="Status do sistema"
	                                        >
	                                            <span className="text-lg">⚙️</span>
	                                        </Button>
	                                    ) : null}
	                                </div>
                            </div>

                            {active === 'insumos' ? (
                                <div className="mt-4 flex flex-col gap-2 lg:hidden">
                                    <div className="flex items-center gap-2">
                                        <Select
                                            value={insumosUnit}
                                            onValueChange={(v) => {
                                                setInsumosUnit(v)
                                                try { localStorage.setItem(INSUMOS_UNIT_KEY, v) } catch { /* ignore */ }
                                                try {
                                                    window.dispatchEvent(
                                                        new CustomEvent('skincos:insumos:unidade', { detail: { unidade: v } })
                                                    )
                                                } catch { /* ignore */ }
                                            }}
                                        >
                                            <SelectTrigger className="h-10 w-full bg-white/[0.06] border-white/20 text-white">
                                                <SelectValue placeholder="Selecione a unidade" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(insumosHeaderStatus?.unidades?.length
                                                    ? insumosHeaderStatus.unidades
                                                    : ['novo-hamburgo', 'barra-shopping-sul']
                                                ).map((u) => (
                                                    <SelectItem key={u} value={u}>
                                                        {formatUnitLabel(u)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <div className="flex items-center gap-1">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="bg-transparent text-white hover:bg-white/[0.10]"
                                                onClick={() => {
                                                    try {
                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'ENTRADA' } }))
                                                    } catch { /* ignore */ }
                                                }}
                                                title="Entrada"
                                                aria-label="Entrada"
                                            >
                                                <img src="/icons/shortcut-entrada.svg" alt="" aria-hidden className="h-9 w-9" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="bg-transparent text-white hover:bg-white/[0.10]"
                                                onClick={() => {
                                                    try {
                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'BAIXA' } }))
                                                    } catch { /* ignore */ }
                                                }}
                                                title="Saída"
                                                aria-label="Saída"
                                            >
                                                <img src="/icons/shortcut-saida.svg" alt="" aria-hidden className="h-9 w-9" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="bg-transparent text-white hover:bg-white/[0.10]"
                                                onClick={() => {
                                                    try {
                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'TRANSFERENCIA' } }))
                                                    } catch { /* ignore */ }
                                                }}
                                                title="Transferência"
                                                aria-label="Transferência"
                                            >
                                                <img src="/icons/shortcut-transferencia.svg" alt="" aria-hidden className="h-9 w-9" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
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
