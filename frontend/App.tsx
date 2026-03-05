// Combined NEATLAB layout + full functionality exposure
import React, { useState, Suspense, lazy, useMemo } from 'react'
import { ContextDebugger } from './ContextDebugger'
import { ErrorBoundary } from '@/ErrorBoundary'
import { NotificationProvider, useAuth, useNotifications } from '@/contexts'
import { LoadingPercentText, LoadingScreen } from '@/LoadingPattern'
import { AuthScreen } from '@/AuthScreen'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Tabs, TabsContent } from '@/tabs'
import { Input } from '@/input'
import { BrDatePickerInput } from '@/br-date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { useKV } from '@/spark-mock'
import { DEFAULT_UNIT_OPTIONS, useGlobalUnitSelection } from '@/unitSelection'

const INSUMOS_UNIT_KEY = 'skincos.insumos.unidade.v1'
const INSUMOS_OVERVIEW_PERIOD_KEY = 'skincos.insumos.overview.period.v1'
const INSUMOS_OVERVIEW_FROM_KEY = 'skincos.insumos.overview.from.v1'
const INSUMOS_OVERVIEW_TO_KEY = 'skincos.insumos.overview.to.v1'
const INSUMOS_ESTOQUE_THRESHOLDS_KEY = 'skincos.insumos.estoque.thresholds.v1'
// Demo banners are not allowed. Keep the UI strictly real-data oriented.

function fmtMoneyBRLCompact(value: number) {
    const num = Number(value) || 0
    try {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 0 }).format(num)
    } catch {
        const rounded = Math.round(num / 1000)
        return `R$ ${rounded}k`
    }
}

type InsumosOverviewPeriod = '7d' | '30d' | '1y' | 'custom'

type ApiError = {
    error?: string
    message?: string
    code?: string
}

type InsumosMeResponse = {
    success?: boolean
    user?: { username?: string; displayName?: string; email?: string; role?: string; allowedUnits?: string[]; allowedModules?: string[] }
    csrfToken?: string
}

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
    const raw = path.startsWith('/auth') ? (path.slice('/auth'.length) || '/') : path
    const url = path.startsWith('/api/auth') ? path : `/api/auth${raw.startsWith('/') ? '' : '/'}${raw}`
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
const AtendimentoModule = lazy(() => import('@/AtendimentoModule').then(m => ({ default: m.AtendimentoModule })))
const MetaAdsManager = lazy(() => import('@/MetaCampaignControlCenter').then(m => ({ default: m.MetaCampaignControlCenter })))
const MetaCommandCenter = lazy(() => import('@/MetaCommandCenter').then(m => ({ default: m.MetaCommandCenter })))
const MetaSyncMonitor = lazy(() => import('@/MetaSyncMonitor').then(m => ({ default: m.MetaSyncMonitor })))
const MetaSentimentMonitor = lazy(() => import('@/MetaSentimentMonitor').then(m => ({ default: m.MetaSentimentMonitor })))
const InstagramStudioPro = lazy(() => import('@/InstagramStudioPro').then(m => ({ default: m.InstagramStudioPro })))
const ThreadsStudio = lazy(() => import('@/ThreadsStudio').then(m => ({ default: m.ThreadsStudio })))
const SocialNetworksStudio = lazy(() => import('@/SocialNetworksStudio').then(m => ({ default: m.SocialNetworksStudio })))
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
const PontoModule = lazy(() => import('@/PontoModule').then(m => ({ default: m.PontoModule })))
const EscalaProfissionaisModule = lazy(() => import('@/EscalaProfissionaisModule').then(m => ({ default: m.EscalaProfissionaisModule })))

// TODO: Add remaining modules if needed

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
    { key: 'atendimento', label: 'Atendimento', icon: '💬', component: <AtendimentoModule /> },
    { key: 'escala-profissionais', label: 'Escala', icon: '🗓️', component: <EscalaProfissionaisModule /> },
    { key: 'meta-ads', label: 'Meta Ads', icon: '📢', component: <MetaAdsManager /> },
    { key: 'meta-command', label: 'Meta Command', icon: '🧭', component: <MetaCommandCenter /> },
    { key: 'meta-sync', label: 'Meta Sync', icon: '🔄', component: <MetaSyncMonitor /> },
    { key: 'meta-sentiment', label: 'Sentimento', icon: '🧠', component: <MetaSentimentMonitor /> },
    { key: 'instagram-studio', label: 'Redes Sociais', icon: '🌐', component: <SocialNetworksStudio /> },
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
    { key: 'ponto', label: 'Ponto', icon: '⏱️', component: <PontoModule /> },
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
    const { isAuthenticated, user, signOut, initializing, initProgress } = useAuth()

    const DEFAULT_MODULE_KEY = 'insumos'

    const allowedModulesKey = Array.isArray(user?.allowedModules) ? user.allowedModules.join('|') : ''
    const roleKey = String(user?.role || '').trim().toUpperCase()
    const isLocalDev = import.meta.env.DEV && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
    const devEmail = String(user?.email || '').trim().toLowerCase()
    const pontoCanAdmin =
        roleKey === 'GESTOR' ||
        roleKey === 'GERENTE' ||
        (isLocalDev && devEmail.endsWith('@local.test'))
    const hasModuleAccess = React.useCallback(
        (moduleKey: string) => {
            const key = String(moduleKey || '').trim()
            if (!key) return false
            if (key === 'escala-profissionais') return roleKey === 'GESTOR' || roleKey === 'GERENTE'
            if (roleKey === 'GESTOR') return true
            const allowed = Array.isArray(user?.allowedModules)
                ? user.allowedModules.map(String).map((s) => s.trim()).filter(Boolean)
                : []
            if (!allowed.length) return true // compat: vazio/ausente => ALL
            if (allowed.includes(key)) return true
            if (key === 'atendimento') {
                return allowed.some((m) => ['whatsapp-business', 'harmonia', 'omnichannel'].includes(m))
            }
            if (key === 'ai-automation') {
                return allowed.some((m) => ['ai-automation', 'automation', 'whatsapp-n8n'].includes(m))
            }
            return false
        },
        [allowedModulesKey, roleKey]
    )

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

		    const UNLOCKED_MODULE_KEYS = useMemo(
		        () => new Set([DEFAULT_MODULE_KEY, 'insumos', 'atendimento', 'unit-monitor', 'instagram-studio', 'escala-profissionais']),
		        [DEFAULT_MODULE_KEY]
		    )
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
		    const [visitedModuleKeys, setVisitedModuleKeys] = useState<string[]>(() => [DEFAULT_MODULE_KEY])
		    const mountedModuleKeys = useMemo(() => {
		        if (visitedModuleKeys.includes(active)) return visitedModuleKeys
		        return [...visitedModuleKeys, active]
		    }, [active, visitedModuleKeys])
		    React.useEffect(() => {
		        if (!visitedModuleKeys.includes(active)) {
		            setVisitedModuleKeys((prev) => (prev.includes(active) ? prev : [...prev, active]))
		        }
		    }, [active, visitedModuleKeys])

	    React.useEffect(() => {
	        if (UNLOCKED_MODULE_KEYS.has(active)) return
	        setActive(DEFAULT_MODULE_KEY)
	    }, [DEFAULT_MODULE_KEY, UNLOCKED_MODULE_KEYS, active])
	    const [search, setSearch] = useState('')
        const [atendimentoHeaderState, setAtendimentoHeaderState] = useState<AtendimentoHeaderState | null>(null)
				    const [insumosHeaderStatus, setInsumosHeaderStatus] = useState<{
			        online: boolean | null
			        authed: boolean | null
			        integrated: boolean | null
			        unidades: string[]
			        allowedUnits: string[]
			    } | null>(null)
				    const [insumosHeaderEstoque, setInsumosHeaderEstoque] = useState<{
                        value: number | null
                        loading: boolean
                        percent: number | null
                        entradaValor?: number | null
                        saidaValor?: number | null
                    } | null>(null)
                    const defaultEstoqueThresholds = React.useMemo(() => ({ warning: 50000, critical: 20000 }), [])
                    const [estoqueThresholds, setEstoqueThresholds] = useState<{ warning: number; critical: number }>(() => {
                        try {
                            const raw = localStorage.getItem(INSUMOS_ESTOQUE_THRESHOLDS_KEY)
                            if (raw) {
                                const parsed = JSON.parse(raw || '{}')
                                const warning = Number(parsed?.warning)
                                const critical = Number(parsed?.critical)
                                if (Number.isFinite(warning) && Number.isFinite(critical)) {
                                    return { warning, critical }
                                }
                            }
                        } catch { /* ignore */ }
                        return { warning: defaultEstoqueThresholds.warning, critical: defaultEstoqueThresholds.critical }
                    })
                    const [estoqueThresholdsOpen, setEstoqueThresholdsOpen] = useState(false)
                    const [estoqueThresholdsDraft, setEstoqueThresholdsDraft] = useState<{ warning: string; critical: string }>({
                        warning: String(estoqueThresholds.warning),
                        critical: String(estoqueThresholds.critical)
                    })
                    const [estoqueThresholdsError, setEstoqueThresholdsError] = useState<string | null>(null)
				    const unitOptions = useMemo(() => DEFAULT_UNIT_OPTIONS, [])
				    const { selectedUnit, setSelectedUnit, effectiveUnit } = useGlobalUnitSelection(unitOptions)
				    const setSelectedUnitRef = React.useRef(setSelectedUnit)
				    React.useEffect(() => {
				        setSelectedUnitRef.current = setSelectedUnit
				    }, [setSelectedUnit])
				    const effectiveUnitRef = React.useRef(effectiveUnit)
				    React.useEffect(() => {
				        effectiveUnitRef.current = effectiveUnit
				    }, [effectiveUnit])
				    const insumosHeaderFetchRef = React.useRef<{ lastAt: number; inflight: boolean }>({ lastAt: 0, inflight: false })
				    const canonicalUnitValues = useMemo(() => unitOptions.map((o) => o.value), [unitOptions])
				    const insumosUnitsForHeaderSelect = useMemo(() => {
				        const fromApi = insumosHeaderStatus?.unidades?.length ? insumosHeaderStatus.unidades : canonicalUnitValues
				        const out = [...new Set(fromApi)].filter((u) => String(u) !== 'custom')
				        if (selectedUnit && !out.includes(selectedUnit)) out.unshift(selectedUnit)
			        return out
			    }, [canonicalUnitValues, insumosHeaderStatus?.unidades?.join('|'), selectedUnit])
			    const unitMonitorUnitsForHeaderSelect = useMemo(() => {
			        const out = [...new Set(canonicalUnitValues)].filter((u) => String(u) !== 'custom')
			        if (selectedUnit && !out.includes(selectedUnit)) out.unshift(selectedUnit)
			        return out
			    }, [canonicalUnitValues, selectedUnit])
			    const [insumosOverviewPeriod, setInsumosOverviewPeriod] = useState<InsumosOverviewPeriod>(() => {
			        try {
			            const raw = localStorage.getItem(INSUMOS_OVERVIEW_PERIOD_KEY)
			            const v = raw === '7d' || raw === '30d' || raw === '1y' || raw === 'custom' ? raw : '30d'
		            return v
		        } catch {
		            return '30d'
		        }
		    })
		    const [insumosOverviewFrom, setInsumosOverviewFrom] = useState<string>(() => {
		        try {
		            return localStorage.getItem(INSUMOS_OVERVIEW_FROM_KEY) || ''
		        } catch {
		            return ''
		        }
		    })
		    const [insumosOverviewTo, setInsumosOverviewTo] = useState<string>(() => {
		        try {
		            return localStorage.getItem(INSUMOS_OVERVIEW_TO_KEY) || ''
		        } catch {
		            return ''
		        }
		    })

			    const formatUnitLabel = (u: string) =>
			        String(u || '')
			            .split('-')
		            .filter(Boolean)
		            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		            .join(' ')

                const parseCurrencyInput = React.useCallback((raw: string) => {
                    if (!raw) return null
                    const cleaned = String(raw)
                        .replace(/[^\d,.-]/g, '')
                        .replace(/\./g, '')
                        .replace(',', '.')
                    const value = Number(cleaned)
                    return Number.isFinite(value) ? value : null
                }, [])

                React.useEffect(() => {
                    if (!estoqueThresholdsOpen) return
                    setEstoqueThresholdsDraft({
                        warning: String(estoqueThresholds.warning),
                        critical: String(estoqueThresholds.critical)
                    })
                    setEstoqueThresholdsError(null)
                }, [estoqueThresholds, estoqueThresholdsOpen])

                React.useEffect(() => {
                    try {
                        localStorage.setItem(INSUMOS_ESTOQUE_THRESHOLDS_KEY, JSON.stringify(estoqueThresholds))
                    } catch { /* ignore */ }
                }, [estoqueThresholds])

                const estoqueBadgeTone = React.useMemo(() => {
                    const value = Number(insumosHeaderEstoque?.value)
                    if (!Number.isFinite(value)) return 'neutral'
                    if (value < estoqueThresholds.critical) return 'critical'
                    if (value < estoqueThresholds.warning) return 'warning'
                    return 'ok'
                }, [estoqueThresholds.critical, estoqueThresholds.warning, insumosHeaderEstoque?.value])

                const estoqueBadgeClass =
                    estoqueBadgeTone === 'ok'
                        ? 'bg-emerald-500/25 text-emerald-100 border-emerald-400/40'
                        : estoqueBadgeTone === 'warning'
                          ? 'bg-amber-500/30 text-amber-100 border-amber-400/40'
                          : estoqueBadgeTone === 'critical'
                            ? 'bg-rose-500/30 text-rose-100 border-rose-400/40'
                            : 'bg-white/10 text-blue-100/70 border-white/15'

			    const insumosMounted = useMemo(() => mountedModuleKeys.includes('insumos'), [mountedModuleKeys])
			    const lastInsumosUnitRef = React.useRef<string | null>(null)
			    React.useEffect(() => {
			        if (!insumosMounted) return
			        if (lastInsumosUnitRef.current === effectiveUnit) return
			        lastInsumosUnitRef.current = effectiveUnit
			        try {
			            window.dispatchEvent(new CustomEvent('skincos:insumos:unidade', { detail: { unidade: effectiveUnit } }))
			        } catch { /* ignore */ }
			    }, [effectiveUnit, insumosMounted])

                React.useEffect(() => {
                    const handler = (event: Event) => {
                        const detail = (event as CustomEvent)?.detail || {}
                        const rawValue = detail?.value
                        const value = rawValue == null || Number.isNaN(Number(rawValue)) ? null : Number(rawValue)
                        const entradaValor = Number.isFinite(Number(detail?.entradaValor)) ? Number(detail?.entradaValor) : null
                        const saidaValor = Number.isFinite(Number(detail?.saidaValor)) ? Number(detail?.saidaValor) : null
                        setInsumosHeaderEstoque({
                            value,
                            loading: Boolean(detail?.loading),
                            percent: typeof detail?.percent === 'number' ? detail.percent : null,
                            entradaValor,
                            saidaValor
                        })
                    }
                    window.addEventListener('skincos:insumos:estoque', handler)
                    return () => window.removeEventListener('skincos:insumos:estoque', handler)
                }, [])

                React.useEffect(() => {
                    const handler = (event: Event) => {
                        const detail = (event as CustomEvent<AtendimentoHeaderState | null>)?.detail || null
                        if (!detail || typeof detail !== 'object') {
                            setAtendimentoHeaderState(null)
                            return
                        }
                        setAtendimentoHeaderState(detail)
                    }
                    window.addEventListener('skincos:atendimento:header', handler as EventListener)
                    return () => window.removeEventListener('skincos:atendimento:header', handler as EventListener)
                }, [])

                const dispatchAtendimentoHeaderAction = React.useCallback((action: string) => {
                    try {
                        window.dispatchEvent(new CustomEvent('skincos:atendimento:header-action', { detail: { action } }))
                    } catch { /* ignore */ }
                }, [])

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
				        if (active !== 'insumos' || !isAuthenticated) {
				            setInsumosHeaderStatus(null)
				            return
				        }

		        const ac = new AbortController()
		        const now = Date.now()
		        if (insumosHeaderFetchRef.current.inflight) return () => ac.abort()
		        if (now - insumosHeaderFetchRef.current.lastAt < 2500) return () => ac.abort()
		        insumosHeaderFetchRef.current.inflight = true
		        insumosHeaderFetchRef.current.lastAt = now

		        ;(async () => {
		            try {
		                const healthRes = await fetch('/api/insumos/health', { credentials: 'include', signal: ac.signal }).catch(() => null)

                let online: boolean | null = null
                let integrated: boolean | null = null
                let unidades: string[] = []
                if (healthRes?.ok) {
                    const h: any = await healthRes.json().catch(() => null)
                    const ready =
                        typeof h?.ready === 'boolean'
                            ? h.ready
                            : (typeof h?.dbConfigured === 'boolean' ? h.dbConfigured : Boolean(h?.ok))
                    online = true
                    integrated = typeof ready === 'boolean' ? Boolean(ready) : null
                    unidades = Array.isArray(h?.unidades) ? h.unidades.filter(Boolean).map((x: any) => String(x)) : []
                } else if (healthRes) {
                    online = false
                }

		                const authed: boolean | null = Boolean(user?.username)
		                const allowedUnits: string[] = Array.isArray(user?.allowedUnits)
		                    ? user.allowedUnits.filter(Boolean).map((x: any) => String(x))
		                    : []

	                const candidateUnits = unidades.length ? unidades : ['novo-hamburgo', 'barra-shopping-sul']
	                const filteredUnits = allowedUnits.length
	                    ? candidateUnits.filter((u) => allowedUnits.includes(u))
	                    : candidateUnits
	                const options = filteredUnits.length ? filteredUnits : candidateUnits

		                const currentUnit = effectiveUnitRef.current
		                let nextUnit = currentUnit
		                try {
		                    const saved = localStorage.getItem(INSUMOS_UNIT_KEY)
		                    if (saved) nextUnit = saved
		                } catch { /* ignore */ }
			                if (!options.includes(nextUnit)) nextUnit = options[0]
			                if (nextUnit && nextUnit !== currentUnit) setSelectedUnitRef.current(nextUnit)

			                setInsumosHeaderStatus({ online, authed, integrated, unidades: options, allowedUnits })
			            } catch {
			                setInsumosHeaderStatus({ online: false, authed: false, integrated: null, unidades: [], allowedUnits: [] })
			            } finally {
			                insumosHeaderFetchRef.current.inflight = false
			            }
		        })()

				        return () => ac.abort()
						    }, [active, isAuthenticated, user?.allowedUnits?.join('|'), user?.username])

		    const lastInsumosOverviewRef = React.useRef<string | null>(null)
		    React.useEffect(() => {
		        if (!insumosMounted) return
		        const nextKey = `${insumosOverviewPeriod}|${insumosOverviewFrom}|${insumosOverviewTo}`
		        if (lastInsumosOverviewRef.current === nextKey) return
		        lastInsumosOverviewRef.current = nextKey
		        try {
		            window.dispatchEvent(
		                new CustomEvent('skincos:insumos:overview', {
		                    detail: { period: insumosOverviewPeriod, from: insumosOverviewFrom, to: insumosOverviewTo }
		                })
		            )
		        } catch { /* ignore */ }
		    }, [insumosMounted, insumosOverviewFrom, insumosOverviewPeriod, insumosOverviewTo])

    const modulesSorted = useMemo(() => {
        const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })
        return [...modules].sort((a, b) => {
            const aLocked = !UNLOCKED_MODULE_KEYS.has(a.key)
            const bLocked = !UNLOCKED_MODULE_KEYS.has(b.key)
            if (aLocked !== bLocked) return aLocked ? 1 : -1
            return collator.compare(a.label, b.label)
        })
    }, [UNLOCKED_MODULE_KEYS])

    const permittedModulesSorted = useMemo(() => modulesSorted.filter((m) => hasModuleAccess(m.key)), [hasModuleAccess, modulesSorted])

    const permittedUnlockedModules = useMemo(
        () => permittedModulesSorted.filter((m) => UNLOCKED_MODULE_KEYS.has(m.key)),
        [UNLOCKED_MODULE_KEYS, permittedModulesSorted]
    )

    React.useEffect(() => {
        if (!hasModuleAccess(active)) {
            const next = permittedUnlockedModules[0]?.key || null
            if (next && next !== active) setActive(next)
        }
    }, [active, hasModuleAccess, permittedUnlockedModules])

    const filteredModules = useMemo(
        () =>
            permittedModulesSorted.filter(
                (m) => m.label.toLowerCase().includes(search.toLowerCase()) || m.key.includes(search.toLowerCase())
            ),
        [permittedModulesSorted, search]
    )

	    if (initializing) {
	        return (
	            <>
	                <LoadingScreen
	                    title="Carregando sessão..."
	                    subtitle="Aguarde enquanto verificamos sua sessão."
	                    percent={Math.max(0, Math.min(100, Number.isFinite(initProgress as any) ? (initProgress as any) : 0))}
	                    buttonLabel="Carregando dados"
	                />
	            </>
	        )
	    }

    if (!isAuthenticated) {
        return (
            <>
                <AuthScreen />
            </>
        )
    }

    if (!permittedUnlockedModules.length) {
        return (
            <>
                <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-corporate-950 via-corporate-900 to-corporate-800 p-6">
                    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/20 p-6 text-center text-white shadow-2xl space-y-3">
                        <div className="text-3xl">⛔</div>
                        <div className="text-lg font-semibold">Sem módulos liberados</div>
                        <div className="text-sm text-blue-100/70">
                            Seu usuário não tem nenhum módulo liberado para acesso. Solicite ao administrador atualizar suas permissões.
                        </div>
                        <div className="pt-2">
                            <Button variant="secondary" onClick={signOut}>
                                Sair
                            </Button>
                        </div>
                    </div>
                </div>
            </>
        )
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
            <Dialog open={estoqueThresholdsOpen} onOpenChange={setEstoqueThresholdsOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Faixas do estoque</DialogTitle>
                        <DialogDescription>
                            Defina quando o estoque fica amarelo ou vermelho. Valores em reais.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {estoqueThresholdsError ? (
                            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-100">
                                {estoqueThresholdsError}
                            </div>
                        ) : null}
                        <div>
                            <div className="text-xs text-blue-200/70 mb-1">Atenção (amarelo) abaixo de</div>
                            <Input
                                value={estoqueThresholdsDraft.warning}
                                onChange={(e) => setEstoqueThresholdsDraft((prev) => ({ ...prev, warning: e.target.value }))}
                                placeholder="ex: 50000"
                            />
                        </div>
                        <div>
                            <div className="text-xs text-blue-200/70 mb-1">Crítico (vermelho) abaixo de</div>
                            <Input
                                value={estoqueThresholdsDraft.critical}
                                onChange={(e) => setEstoqueThresholdsDraft((prev) => ({ ...prev, critical: e.target.value }))}
                                placeholder="ex: 20000"
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setEstoqueThresholds({
                                    warning: defaultEstoqueThresholds.warning,
                                    critical: defaultEstoqueThresholds.critical
                                })
                                setEstoqueThresholdsOpen(false)
                            }}
                        >
                            Resetar padrão
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                const warning = parseCurrencyInput(estoqueThresholdsDraft.warning)
                                const critical = parseCurrencyInput(estoqueThresholdsDraft.critical)
                                if (!Number.isFinite(Number(warning)) || !Number.isFinite(Number(critical))) {
                                    setEstoqueThresholdsError('Informe valores numéricos válidos.')
                                    return
                                }
                                if ((warning as number) <= (critical as number)) {
                                    setEstoqueThresholdsError('Atenção deve ser maior que Crítico.')
                                    return
                                }
                                setEstoqueThresholds({
                                    warning: warning as number,
                                    critical: critical as number
                                })
                                setEstoqueThresholdsOpen(false)
                            }}
                        >
                            Salvar
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
	                            {sidebarExpanded ? (
	                                <div className="relative mb-2">
	                                    <Input
	                                        placeholder="Buscar módulos..."
	                                        value={search}
	                                        onChange={e => setSearch(e.target.value)}
	                                        className="pl-10 w-full bg-white/[0.08] border-white/20 text-white placeholder:text-blue-300/60"
	                                    />
	                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300/60" aria-hidden>
	                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
	                                            <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="currentColor" strokeWidth="2" />
	                                            <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
	                                        </svg>
	                                    </span>
	                                    {search ? (
	                                        <button
	                                            onClick={() => setSearch('')}
	                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300/60 hover:text-white transition-colors"
	                                            title="Limpar busca"
	                                            aria-label="Limpar busca"
	                                        >
	                                            ✕
	                                        </button>
	                                    ) : null}
	                                </div>
	                            ) : null}
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
                                            aria-label={m.label}
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
                    </div>

                    {/* Premium Main Area */}
                    <div className="flex-1 flex flex-col overflow-hidden">
	                        {/* Premium Header */}
			                        <header className="glass-morphism border-b border-white/10 backdrop-blur-xl px-8 py-5">
			                            <div className="flex items-center justify-between">
				                                <div className="flex items-center gap-4">
					                                    <div className="animate-fade-in">
					                                        <h1 className={`font-bold text-white leading-tight ${active === 'insumos' ? 'text-xl' : 'text-2xl'}`}>
					                                            {modules.find(m => m.key === active)?.label || 'Painel'}
					                                        </h1>
			                                    </div>
				                                    <div className="w-px h-8 bg-white/20 hidden lg:block"></div>
				                                    <div className="hidden lg:flex items-center gap-2">
				                                        {active === 'insumos' ? (
					                                            <>
					                                                <Select
					                                                    value={selectedUnit}
			                                                    onValueChange={(v) => setSelectedUnit(v)}
			                                                >
				                                                    <SelectTrigger className="h-8 w-56 bg-white/[0.06] border-white/20 text-white">
				                                                        <SelectValue placeholder="Unidade" />
				                                                    </SelectTrigger>
				                                                    <SelectContent>
				                                                        {insumosUnitsForHeaderSelect.map((u) => (
				                                                            <SelectItem key={u} value={u}>
				                                                                {formatUnitLabel(u)}
				                                                            </SelectItem>
				                                                        ))}
				                                                    </SelectContent>
				                                                </Select>
					                                                <div className="flex items-center gap-1 ml-2">
					                                                    <Select
					                                                        value={insumosOverviewPeriod}
					                                                        onValueChange={(v) => {
				                                                            const next = (v as any) as InsumosOverviewPeriod
				                                                            setInsumosOverviewPeriod(next)
				                                                            try { localStorage.setItem(INSUMOS_OVERVIEW_PERIOD_KEY, next) } catch { /* ignore */ }
				                                                            try {
				                                                                window.dispatchEvent(new CustomEvent('skincos:insumos:overview', { detail: { period: next, from: insumosOverviewFrom, to: insumosOverviewTo } }))
				                                                            } catch { /* ignore */ }
				                                                        }}
				                                                    >
					                                                    <SelectTrigger className="h-8 w-40 bg-white/[0.06] border-white/20 text-white">
					                                                            <SelectValue placeholder="Período" />
					                                                        </SelectTrigger>
				                                                        <SelectContent>
				                                                            <SelectItem value="7d">Última semana</SelectItem>
				                                                            <SelectItem value="30d">Último mês</SelectItem>
				                                                            <SelectItem value="1y">Último ano</SelectItem>
				                                                            <SelectItem value="custom">Personalizado</SelectItem>
				                                                        </SelectContent>
				                                                    </Select>

					                                                    {insumosOverviewPeriod === 'custom' ? (
					                                                        <>
					                                                            <BrDatePickerInput
					                                                                value={insumosOverviewFrom}
				                                                                onChange={(next) => {
				                                                                    setInsumosOverviewFrom(next)
				                                                                    try { localStorage.setItem(INSUMOS_OVERVIEW_FROM_KEY, next) } catch { /* ignore */ }
				                                                                    try {
				                                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:overview', { detail: { period: insumosOverviewPeriod, from: next, to: insumosOverviewTo } }))
				                                                                    } catch { /* ignore */ }
					                                                                }}
					                                                                placeholder="De (DD/MM/AA)"
					                                                                className="h-8 w-36 bg-white/[0.06] border-white/20 text-white placeholder:text-blue-200/40"
					                                                                ariaLabel="De"
					                                                            />
					                                                            <BrDatePickerInput
					                                                                value={insumosOverviewTo}
				                                                                onChange={(next) => {
				                                                                    setInsumosOverviewTo(next)
				                                                                    try { localStorage.setItem(INSUMOS_OVERVIEW_TO_KEY, next) } catch { /* ignore */ }
				                                                                    try {
				                                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:overview', { detail: { period: insumosOverviewPeriod, from: insumosOverviewFrom, to: next } }))
				                                                                    } catch { /* ignore */ }
					                                                                }}
					                                                                placeholder="Até (DD/MM/AA)"
					                                                                className="h-8 w-36 bg-white/[0.06] border-white/20 text-white placeholder:text-blue-200/40"
					                                                                ariaLabel="Até"
					                                                            />
					                                                        </>
					                                                    ) : null}

						                                                    <Button
						                                                    size="icon"
						                                                        variant="ghost"
						                                                        className="h-9 w-9 rounded-md bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/35"
					                                                        onClick={() => {
				                                                            try {
				                                                                window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'ENTRADA' } }))
				                                                            } catch { /* ignore */ }
	                                                        }}
			                                                        title="Entrada"
			                                                        aria-label="Entrada"
			                                                    >
				                                                        <img src="/icons/shortcut-entrada.svg" alt="" aria-hidden className="h-5 w-5" />
			                                                    </Button>
						                                                    <Button
						                                                    size="icon"
						                                                        variant="ghost"
						                                                        className="h-9 w-9 rounded-md bg-rose-500/30 text-rose-100 hover:bg-rose-500/40"
					                                                        onClick={() => {
				                                                            try {
				                                                                window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'BAIXA' } }))
				                                                            } catch { /* ignore */ }
	                                                        }}
			                                                        title="Saída"
			                                                        aria-label="Saída"
			                                                    >
				                                                        <img src="/icons/shortcut-saida.svg" alt="" aria-hidden className="h-5 w-5" />
			                                                    </Button>
				                                                    <Button
				                                                    size="icon"
				                                                        variant="ghost"
				                                                        className="h-9 w-9 rounded-md bg-sky-500/30 text-sky-100 hover:bg-sky-500/40"
				                                                        onClick={() => {
				                                                            try {
				                                                                window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'TRANSFERENCIA' } }))
				                                                            } catch { /* ignore */ }
	                                                        }}
			                                                        title="Transferência"
			                                                        aria-label="Transferência"
				                                                    >
					                                                        <img src="/icons/shortcut-transferencia.svg" alt="" aria-hidden className="h-5 w-5" />
					                                                    </Button>
					
			                                                </div>
						                                            </>
						                                        ) : null}
				                                        {active === 'ponto' && pontoCanAdmin ? (
				                                            <div className="flex items-center gap-2">
				                                                <Button
				                                                    size="sm"
				                                                    variant="ghost"
				                                                    className="h-8 bg-white/[0.06] border border-white/20 text-white hover:bg-white/[0.12]"
				                                                    onClick={() => {
				                                                        try {
				                                                            window.dispatchEvent(new CustomEvent('skincos:ponto:action', { detail: { action: 'create' } }))
				                                                        } catch { /* ignore */ }
				                                                    }}
				                                                >
				                                                    Cadastrar
				                                                </Button>
				                                                <Button
				                                                    size="sm"
				                                                    variant="ghost"
				                                                    className="h-8 bg-white/[0.06] border border-white/20 text-white hover:bg-white/[0.12]"
				                                                    onClick={() => {
				                                                        try {
				                                                            window.dispatchEvent(new CustomEvent('skincos:ponto:action', { detail: { action: 'edit' } }))
				                                                        } catch { /* ignore */ }
				                                                    }}
				                                                >
				                                                    Editar
				                                                </Button>
				                                                <Button
				                                                    size="sm"
				                                                    variant="ghost"
				                                                    className="h-8 bg-white/[0.06] border border-white/20 text-white hover:bg-white/[0.12]"
				                                                    onClick={() => {
				                                                        try {
				                                                            window.dispatchEvent(new CustomEvent('skincos:ponto:action', { detail: { action: 'records' } }))
				                                                        } catch { /* ignore */ }
				                                                    }}
				                                                >
				                                                    Exportar
				                                                </Button>
				                                                <Button
				                                                    size="sm"
				                                                    variant="ghost"
				                                                    className="h-8 bg-white/[0.06] border border-white/20 text-white hover:bg-white/[0.12]"
				                                                    onClick={() => {
				                                                        try {
				                                                            window.dispatchEvent(new CustomEvent('skincos:ponto:action', { detail: { action: 'device' } }))
				                                                        } catch { /* ignore */ }
				                                                    }}
				                                                >
				                                                    Gerenciar Dispositivo
				                                                </Button>
				                                            </div>
				                                        ) : null}
				                                        {active === 'unit-monitor' ? (
				                                            <Select value={selectedUnit} onValueChange={(v) => setSelectedUnit(v)}>
				                                                <SelectTrigger className="h-8 w-56 bg-white/[0.06] border-white/20 text-white">
				                                                    <SelectValue placeholder="Unidade" />
				                                                </SelectTrigger>
				                                                <SelectContent>
				                                                    {unitMonitorUnitsForHeaderSelect.map((u) => (
				                                                        <SelectItem key={u} value={u}>
				                                                            {formatUnitLabel(u)}
				                                                        </SelectItem>
				                                                    ))}
				                                                </SelectContent>
				                                            </Select>
			                                        ) : null}
		                                    </div>
	                                </div>

		                                <div className="flex items-center gap-4">
                                    {active === 'atendimento' ? (
                                        <div className="flex items-center gap-1.5 max-w-[58vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className={`h-7 rounded-full border px-2.5 text-xs ${atendimentoHeaderState?.whatsappConnected ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100' : 'border-white/15 bg-white/5 text-blue-100/80'}`}
                                                onClick={() => dispatchAtendimentoHeaderAction('wa')}
                                            >
                                                WhatsApp {atendimentoHeaderState?.connectedWhatsapps ?? 0}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className={`h-7 rounded-full border px-2.5 text-xs ${atendimentoHeaderState?.instagramConnected ? 'border-pink-400/40 bg-pink-500/15 text-pink-100' : 'border-white/15 bg-white/5 text-blue-100/80'}`}
                                                onClick={() => dispatchAtendimentoHeaderAction('ig')}
                                            >
                                                Instagram
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className={`h-7 rounded-full border px-2.5 text-xs ${atendimentoHeaderState?.facebookConfigured ? 'border-blue-400/40 bg-blue-500/15 text-blue-100' : 'border-white/15 bg-white/5 text-blue-100/80'}`}
                                                onClick={() => dispatchAtendimentoHeaderAction('fb')}
                                            >
                                                Facebook
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 rounded-full border border-sky-400/40 bg-sky-500/15 px-2.5 text-xs text-sky-100"
                                                onClick={() => dispatchAtendimentoHeaderAction('tickets-total')}
                                            >
                                                Total {atendimentoHeaderState?.supportStats?.totalTickets ?? 0}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 text-xs text-amber-100"
                                                onClick={() => dispatchAtendimentoHeaderAction('tickets-open')}
                                            >
                                                Abertos {atendimentoHeaderState?.supportStats?.openWithin24 ?? 0}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 rounded-full border border-rose-400/40 bg-rose-500/15 px-2.5 text-xs text-rose-100"
                                                onClick={() => dispatchAtendimentoHeaderAction('tickets-overdue')}
                                            >
                                                Atrasados {atendimentoHeaderState?.supportStats?.overdueTickets ?? 0}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 text-xs text-emerald-100"
                                                onClick={() => dispatchAtendimentoHeaderAction('tickets-resolved')}
                                            >
                                                Resolvidos {atendimentoHeaderState?.supportStats?.resolvedTickets ?? 0}
                                            </Button>
                                            <span className="inline-flex h-7 items-center rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 text-xs text-violet-100">
                                                Satisfação {Number(atendimentoHeaderState?.supportStats?.avgSatisfaction || 0).toFixed(1)}
                                            </span>
                                        </div>
                                    ) : null}
		                                    {active === 'insumos' ? (
		                                        <div className="flex items-start gap-2 min-w-[220px] justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-blue-200/70">
		                                            <button
		                                                type="button"
		                                                className="inline-flex"
		                                                onClick={() => setEstoqueThresholdsOpen(true)}
		                                                title="Editar faixas de estoque"
		                                                aria-label="Editar faixas de estoque"
		                                            >
		                                                <Badge className={`uppercase tracking-wide border ${estoqueBadgeClass}`}>Estoque</Badge>
		                                            </button>
		                                            <span className="ml-auto text-right flex-1">
		                                                <span className="block font-mono text-blue-50">
		                                                {insumosHeaderEstoque?.loading ? (
		                                                    <span className="inline-flex items-center gap-2">
		                                                        <span className="inline-flex h-3 w-3 rounded-full border border-blue-200/70 border-t-transparent animate-spin" />
		                                                        {typeof insumosHeaderEstoque?.percent === 'number' ? `${insumosHeaderEstoque.percent}%` : '...'}
		                                                    </span>
		                                                ) : (
		                                                    insumosHeaderEstoque?.value != null ? fmtMoneyBRLCompact(insumosHeaderEstoque.value) : '-'
		                                                )}
		                                                </span>
		                                                {!insumosHeaderEstoque?.loading ? (
		                                                    <span className="mt-1 flex flex-col items-end text-[10px] leading-tight">
		                                                        <span className="text-emerald-300">
		                                                            {insumosHeaderEstoque?.entradaValor != null
		                                                                ? `+ ${fmtMoneyBRLCompact(insumosHeaderEstoque.entradaValor)}`
		                                                                : '-'}
		                                                        </span>
		                                                        <span className="text-rose-300">
		                                                            {insumosHeaderEstoque?.saidaValor != null
		                                                                ? `- ${fmtMoneyBRLCompact(insumosHeaderEstoque.saidaValor)}`
		                                                                : '-'}
		                                                        </span>
		                                                    </span>
		                                                ) : null}
		                                            </span>
		                                        </div>
		                                    ) : null}
		                                    {active === 'insumos' ? (
		                                        <div className="flex items-center gap-1">
		                                            <Button
		                                                size="icon"
		                                                variant="ghost"
		                                                className="h-9 w-9 rounded-md bg-transparent text-white hover:bg-white/[0.10]"
		                                                onClick={() => {
		                                                    try {
		                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:layout', { detail: { action: 'expandAll' } }))
		                                                    } catch { /* ignore */ }
	                                                }}
		                                                title="Expandir tudo"
		                                                aria-label="Expandir tudo"
		                                            >
		                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
		                                                    <path d="M7 9l5 5 5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                    <path d="M7 14l5 5 5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                </svg>
		                                            </Button>
		                                            <Button
		                                                size="icon"
		                                                variant="ghost"
		                                                className="h-9 w-9 rounded-md bg-transparent text-white hover:bg-white/[0.10]"
		                                                onClick={() => {
		                                                    try {
		                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:layout', { detail: { action: 'collapseAll' } }))
		                                                    } catch { /* ignore */ }
	                                                }}
		                                                title="Contrair tudo"
		                                                aria-label="Contrair tudo"
		                                            >
		                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
		                                                    <path d="M7 15l5-5 5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                    <path d="M7 10l5-5 5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                </svg>
		                                            </Button>
		                                            <Button
		                                                size="icon"
		                                                variant="ghost"
		                                                className="h-9 w-9 rounded-md bg-transparent text-white hover:bg-white/[0.10]"
		                                                onClick={() => {
		                                                    try {
		                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:layout', { detail: { action: 'reset' } }))
		                                                    } catch { /* ignore */ }
	                                                }}
		                                                title="Resetar layout"
		                                                aria-label="Resetar layout"
		                                            >
		                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
		                                                    <path d="M21 12a9 9 0 1 1-3.1-6.7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                    <path d="M21 4v6h-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                </svg>
		                                            </Button>
		                                        </div>
		                                    ) : null}
                                    {UNLOCKED_MODULE_KEYS.has('notifications') && hasModuleAccess('notifications') ? (
                                        <HeaderNotificationsButton
                                            onOpen={() => {
                                                setSearch('')
                                                setActive('notifications')
	                                            }}
	                                        />
	                                    ) : null}

                                    {UNLOCKED_MODULE_KEYS.has('status') && hasModuleAccess('status') ? (
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
	                                            value={insumosOverviewPeriod}
	                                            onValueChange={(v) => {
	                                                const next = (v as any) as InsumosOverviewPeriod
	                                                setInsumosOverviewPeriod(next)
	                                                try { localStorage.setItem(INSUMOS_OVERVIEW_PERIOD_KEY, next) } catch { /* ignore */ }
	                                                try {
	                                                    window.dispatchEvent(new CustomEvent('skincos:insumos:overview', { detail: { period: next, from: insumosOverviewFrom, to: insumosOverviewTo } }))
	                                                } catch { /* ignore */ }
	                                            }}
	                                        >
	                                            <SelectTrigger className="h-10 w-full bg-white/[0.06] border-white/20 text-white">
	                                                <SelectValue placeholder="Período" />
	                                            </SelectTrigger>
	                                            <SelectContent>
	                                                <SelectItem value="7d">Última semana</SelectItem>
	                                                <SelectItem value="30d">Último mês</SelectItem>
	                                                <SelectItem value="1y">Último ano</SelectItem>
	                                                <SelectItem value="custom">Personalizado</SelectItem>
	                                            </SelectContent>
	                                        </Select>
		                                    </div>

	                                    {insumosOverviewPeriod === 'custom' ? (
	                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
	                                            <Input
	                                                value={insumosOverviewFrom}
	                                                onChange={(e) => {
	                                                    const next = e.target.value
	                                                    setInsumosOverviewFrom(next)
	                                                    try { localStorage.setItem(INSUMOS_OVERVIEW_FROM_KEY, next) } catch { /* ignore */ }
	                                                    try {
	                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:overview', { detail: { period: insumosOverviewPeriod, from: next, to: insumosOverviewTo } }))
	                                                    } catch { /* ignore */ }
	                                                }}
	                                                placeholder="De (DD/MM/AAAA)"
	                                                className="h-10 bg-white/[0.06] border-white/20 text-white placeholder:text-blue-200/40"
	                                            />
	                                            <Input
	                                                value={insumosOverviewTo}
	                                                onChange={(e) => {
	                                                    const next = e.target.value
	                                                    setInsumosOverviewTo(next)
	                                                    try { localStorage.setItem(INSUMOS_OVERVIEW_TO_KEY, next) } catch { /* ignore */ }
	                                                    try {
	                                                        window.dispatchEvent(new CustomEvent('skincos:insumos:overview', { detail: { period: insumosOverviewPeriod, from: insumosOverviewFrom, to: next } }))
	                                                    } catch { /* ignore */ }
	                                                }}
	                                                placeholder="Até (DD/MM/AAAA)"
	                                                className="h-10 bg-white/[0.06] border-white/20 text-white placeholder:text-blue-200/40"
	                                            />
	                                        </div>
	                                    ) : null}

		                                    <div className="flex items-center gap-2">
		                                        <div className="flex-1">
		                                            <Select value={selectedUnit} onValueChange={(v) => setSelectedUnit(v)}>
		                                                <SelectTrigger className="h-10 w-full bg-white/[0.06] border-white/20 text-white">
		                                                    <SelectValue placeholder="Selecione a unidade" />
		                                                </SelectTrigger>
		                                                <SelectContent>
		                                                    {insumosUnitsForHeaderSelect.map((u) => (
		                                                        <SelectItem key={u} value={u}>
		                                                            {formatUnitLabel(u)}
		                                                        </SelectItem>
		                                                    ))}
		                                                </SelectContent>
		                                            </Select>
		                                        </div>
		                                        <div className="flex items-center gap-1">
	                                                <Button
	                                                    size="icon"
	                                                    variant="ghost"
                                                    className="bg-transparent text-white hover:bg-white/[0.10] p-0 size-11 rounded-full"
                                                    onClick={() => {
                                                        try {
                                                            window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'ENTRADA' } }))
                                                        } catch { /* ignore */ }
                                                    }}
                                                    title="Entrada"
                                                    aria-label="Entrada"
                                                >
                                                    <img src="/icons/shortcut-entrada.svg" alt="" aria-hidden className="h-11 w-11" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="bg-transparent text-white hover:bg-white/[0.10] p-0 size-11 rounded-full"
                                                    onClick={() => {
                                                        try {
                                                            window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'BAIXA' } }))
                                                        } catch { /* ignore */ }
                                                    }}
                                                    title="Saída"
                                                    aria-label="Saída"
                                                >
                                                    <img src="/icons/shortcut-saida.svg" alt="" aria-hidden className="h-11 w-11" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="bg-transparent text-white hover:bg-white/[0.10] p-0 size-11 rounded-full"
                                                    onClick={() => {
                                                        try {
                                                            window.dispatchEvent(new CustomEvent('skincos:insumos:op', { detail: { op: 'TRANSFERENCIA' } }))
                                                        } catch { /* ignore */ }
                                                    }}
                                                    title="Transferência"
                                                    aria-label="Transferência"
                                                >
	                                                <img src="/icons/shortcut-transferencia.svg" alt="" aria-hidden className="h-11 w-11" />
                                                </Button>
		
	                                        </div>
	                                    </div>
	                                </div>
	                            ) : null}
                        </header>

                        {/* Premium Main Content */}
                        <main className={`flex-1 p-8 relative ${active === 'atendimento' ? 'overflow-hidden flex min-h-0 flex-col' : 'overflow-auto'}`}>
                            {/* Content Background */}
                            <div className="absolute inset-0 bg-white/[0.02] backdrop-blur-sm"></div>

                            <div className={`relative z-10 ${active === 'atendimento' ? 'flex h-full min-h-0 flex-col' : ''}`}>
                                <div className="hidden">{search}</div>
                                <ErrorBoundary>
                                    <Suspense fallback={
                                        <div className="glass-morphism rounded-2xl p-8 border border-white/20 animate-pulse">
                                            <div className="space-y-1">
                                                <LoadingPercentText label="Carregando módulo" className="text-white/90" showPercent={false} />
                                                <div className="text-blue-300/60 text-sm">Preparando interface empresarial</div>
                                            </div>
                                        </div>
                                    }>
                                    <div className={`animate-fade-in ${active === 'atendimento' ? 'flex h-full min-h-0 flex-col' : ''}`}>
                                        {mountedModuleKeys
                                            .map((key) => permittedModulesSorted.find((m) => m.key === key))
                                            .filter((m) => Boolean(m) && UNLOCKED_MODULE_KEYS.has((m as any).key))
                                            .map((m) => {
                                                const moduleEntry = m as (typeof modules)[number]
                                                const isActive = moduleEntry.key === active
                                                return (
                                                    <div key={moduleEntry.key} hidden={!isActive} className={active === 'atendimento' ? 'h-full min-h-0' : undefined}>
                                                        {moduleEntry.component}
                                                    </div>
                                                )
                                            })}
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
