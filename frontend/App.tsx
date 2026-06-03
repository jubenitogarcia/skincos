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
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/alert-dialog'
import { Tabs, TabsContent } from '@/tabs'
import { Input } from '@/input'
import { BrDatePickerInput } from '@/br-date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Tooltip, TooltipButton, TooltipContent, TooltipLabel, TooltipTrigger } from '@/tooltip'
import { useKV } from '@/spark-mock'
import { DEFAULT_UNIT_OPTIONS, useGlobalUnitSelection } from '@/unitSelection'
import { dispatchEscalaHeaderAction, subscribeEscalaHeaderState } from '@/escalaHeaderBridge'
import type { EscalaHeaderState, EscalaHighlightMode } from '@/escalaTypes'
import { dispatchInsumosHeaderAction, subscribeInsumosHeaderState } from '@/insumosBridge'
import type { InsumosHeaderState, InsumosOverviewPeriod } from '@/insumosTypes'
import { dispatchMetaAdsHeaderAction, subscribeMetaAdsHeaderState } from '@/metaAdsHeaderBridge'
import type { MetaAdsHeaderState } from '@/metaAdsTypes'
import { dispatchSiteTrackingHeaderAction, subscribeSiteTrackingHeaderState } from '@/siteTrackingHeaderBridge'
import type { SiteTrackingHeaderState } from '@/siteTrackingTypes'
import { CalendarX2, CheckCircle2, Download, Pencil, Plus, RefreshCw, Shield, Sparkles, X } from 'lucide-react'

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

function formatMonthLabelHeader(value: string) {
    if (!value) return 'Mês'
    const month = Number(value)
    if (!month) return value
    const date = new Date(2000, month - 1, 1)
    const label = date.toLocaleDateString('pt-BR', { month: 'long' })
    return label.charAt(0).toUpperCase() + label.slice(1)
}

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
const MetaCampaignControlCenter = lazy(() => import('@/MetaCampaignControlCenter').then(m => ({ default: m.MetaCampaignControlCenter })))
const MetaCommandCenter = lazy(() => import('@/MetaCommandCenter').then(m => ({ default: m.MetaCommandCenter })))
const MetaSyncMonitor = lazy(() => import('@/MetaSyncMonitor').then(m => ({ default: m.MetaSyncMonitor })))
const MetaSentimentMonitor = lazy(() => import('@/MetaSentimentMonitor').then(m => ({ default: m.MetaSentimentMonitor })))
const InstagramStudioPro = lazy(() => import('@/InstagramStudioPro').then(m => ({ default: m.InstagramStudioPro })))
const ThreadsStudio = lazy(() => import('@/ThreadsStudio').then(m => ({ default: m.ThreadsStudio })))
const SocialNetworksStudio = lazy(() => import('@/SocialNetworksStudio').then(m => ({ default: m.SocialNetworksStudio })))
const MetaPagesReviewStudio = lazy(() => import('@/MetaPagesReviewStudio').then(m => ({ default: m.MetaPagesReviewStudio })))
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
const SiteTrackingModule = lazy(() => import('@/SiteTrackingModule').then(m => ({ default: m.SiteTrackingModule })))

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
    { key: 'site-tracking', label: 'Site EF', icon: '📍', component: <SiteTrackingModule /> },
    { key: 'meta-ads', label: 'Meta Ads', icon: '📢', component: <MetaCampaignControlCenter /> },
    { key: 'meta-command', label: 'Meta Command', icon: '🧭', component: <MetaCommandCenter /> },
    { key: 'meta-sync', label: 'Meta Sync', icon: '🔄', component: <MetaSyncMonitor /> },
    { key: 'meta-sentiment', label: 'Sentimento', icon: '🧠', component: <MetaSentimentMonitor /> },
    { key: 'meta-pages-review', label: 'Meta Review', icon: '🧪', component: <MetaPagesReviewStudio /> },
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
		        () => new Set([DEFAULT_MODULE_KEY, 'insumos', 'atendimento', 'unit-monitor', 'instagram-studio', 'meta-pages-review', 'meta-ads', 'site-tracking', 'escala-profissionais']),
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
		    const mountedModuleKeys = useMemo(() => [active], [active])

	    React.useEffect(() => {
	        if (UNLOCKED_MODULE_KEYS.has(active)) return
	        setActive(DEFAULT_MODULE_KEY)
	    }, [DEFAULT_MODULE_KEY, UNLOCKED_MODULE_KEYS, active])
        const [search, setSearch] = useState('')
        const [atendimentoHeaderState, setAtendimentoHeaderState] = useState<AtendimentoHeaderState | null>(null)
        const [escalaHeaderState, setEscalaHeaderState] = useState<EscalaHeaderState | null>(null)
        const [metaAdsHeaderState, setMetaAdsHeaderState] = useState<MetaAdsHeaderState | null>(null)
        const [siteTrackingHeaderState, setSiteTrackingHeaderState] = useState<SiteTrackingHeaderState | null>(null)
        const [metaAdsAccountRemovalId, setMetaAdsAccountRemovalId] = useState<string | null>(null)
        const metaAdsAccountPendingRemoval = useMemo(
            () => (metaAdsHeaderState?.accounts || []).find((account) => account.id === metaAdsAccountRemovalId) || null,
            [metaAdsAccountRemovalId, metaAdsHeaderState?.accounts],
        )
				    const [insumosHeaderStatus, setInsumosHeaderStatus] = useState<InsumosHeaderState['status']>(null)
				    const [insumosHeaderEstoque, setInsumosHeaderEstoque] = useState<InsumosHeaderState['stock']>(null)
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
			        dispatchInsumosHeaderAction({ type: 'set-unit', value: effectiveUnit })
			    }, [effectiveUnit, insumosMounted])

                React.useEffect(() => {
                    return subscribeInsumosHeaderState((detail) => {
                        setInsumosHeaderStatus(detail?.status || null)
                        setInsumosHeaderEstoque(detail?.stock || null)
                        if (detail?.selectedUnit && detail.selectedUnit !== effectiveUnitRef.current) {
                            setSelectedUnitRef.current(detail.selectedUnit)
                        }
                    })
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

                React.useEffect(() => {
                    return subscribeEscalaHeaderState((detail) => {
                        setEscalaHeaderState(detail)
                    })
                }, [])

                React.useEffect(() => {
                    return subscribeMetaAdsHeaderState((detail) => {
                        setMetaAdsHeaderState(detail)
                    })
                }, [])

                React.useEffect(() => {
                    return subscribeSiteTrackingHeaderState((detail) => {
                        setSiteTrackingHeaderState(detail)
                    })
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
				            setInsumosHeaderEstoque(null)
				        }
				    }, [active, isAuthenticated])

                React.useEffect(() => {
                    if (active !== 'meta-ads') {
                        setMetaAdsHeaderState(null)
                    }
                }, [active])

                React.useEffect(() => {
                    if (active !== 'site-tracking') {
                        setSiteTrackingHeaderState(null)
                    }
                }, [active])

		    const lastInsumosOverviewRef = React.useRef<string | null>(null)
		    React.useEffect(() => {
		        if (!insumosMounted) return
		        const nextKey = `${insumosOverviewPeriod}|${insumosOverviewFrom}|${insumosOverviewTo}`
		        if (lastInsumosOverviewRef.current === nextKey) return
		        lastInsumosOverviewRef.current = nextKey
		        dispatchInsumosHeaderAction({
		            type: 'set-overview',
		            value: { period: insumosOverviewPeriod, from: insumosOverviewFrom, to: insumosOverviewTo },
		        })
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
            <AlertDialog open={Boolean(metaAdsAccountPendingRemoval)} onOpenChange={(open) => !open && setMetaAdsAccountRemovalId(null)}>
                <AlertDialogContent className="border-slate-800/80 bg-slate-950 text-slate-100">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remover conta Meta Ads?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-300">
                            A conta {metaAdsAccountPendingRemoval?.name || metaAdsAccountPendingRemoval?.id || 'selecionada'} será removida da lista deste usuário no CRM. Isso não exclui nada no Meta Ads; para desfazer, use “Adicionar conexão” e autorize a conta novamente.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-rose-500 text-white hover:bg-rose-400"
                            onClick={() => {
                                if (metaAdsAccountPendingRemoval?.id) {
                                    dispatchMetaAdsHeaderAction({ type: 'remove-account', value: metaAdsAccountPendingRemoval.id })
                                }
                                setMetaAdsAccountRemovalId(null)
                            }}
                        >
                            Remover conta
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
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
                                <TooltipButton label={sidebarPinned ? 'Desafixar menu' : 'Fixar menu'}>
                                    <button
                                        type="button"
                                        onClick={() => setSidebarPinned((v) => !v)}
                                        className={`rounded-lg border border-white/10 bg-white/[0.06] hover:bg-white/[0.12] text-blue-100/80 hover:text-white transition-colors ${sidebarExpanded ? 'px-2 py-2 text-sm' : 'hidden'}`}
                                    >
                                        {sidebarPinned ? '📌' : '📍'}
                                    </button>
                                </TooltipButton>
                            </div>

                            {/* User Info */}
                            <div className={`glass-morphism rounded-xl border border-white/10 ${sidebarExpanded ? 'p-3' : 'p-2'}`}>
                                <div className={`flex items-center gap-3 ${sidebarExpanded ? '' : 'justify-center'}`}>
                                    <div className="w-8 h-8 rounded-lg bg-gradient-blue flex items-center justify-center text-sm font-semibold text-white">
                                        {(user?.name || 'U').charAt(0).toUpperCase()}
                                    </div>
                                    <TooltipButton label="Abrir perfil">
                                        <button
                                            type="button"
                                            onClick={() => setProfileOpen(true)}
                                            className={`flex-1 min-w-0 text-left ${sidebarExpanded ? '' : 'hidden'}`}
                                        >
                                            <p className="font-semibold text-white text-sm leading-tight truncate">{user?.name || 'Usuário'}</p>
                                            <p className="text-xs text-blue-300/70 truncate">{user?.email}</p>
                                        </button>
                                    </TooltipButton>
                                    <TooltipButton label="Sair">
                                        <button
                                            onClick={signOut}
                                            className={`${sidebarExpanded ? 'text-xs' : 'text-sm'} text-blue-300/70 hover:text-red-400 transition-all duration-300 hover:scale-105`}
                                        >
                                            ⏻
                                        </button>
                                    </TooltipButton>
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
	                                        <TooltipButton label="Limpar busca">
	                                            <button
	                                                onClick={() => setSearch('')}
	                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300/60 hover:text-white transition-colors"
	                                                aria-label="Limpar busca"
	                                            >
	                                                ✕
	                                            </button>
	                                        </TooltipButton>
	                                    ) : null}
	                                </div>
	                            ) : null}
	                            {filteredModules.map((m, index) => (
	                                (() => {
	                                    const isLocked = !UNLOCKED_MODULE_KEYS.has(m.key)
	                                    const isActive = active === m.key
	                                    return (
                                        <TooltipLabel key={m.key} label={m.label} description={isLocked ? 'Módulo em breve.' : undefined}>
                                            <button
                                                onClick={() => {
                                                    if (isLocked) return
                                                    setActive(m.key)
                                                }}
                                                disabled={isLocked}
                                                aria-disabled={isLocked}
                                                aria-label={m.label}
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
                                        </TooltipLabel>
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
				                                    <div className={`${active === 'escala-profissionais' || active === 'meta-ads' || active === 'site-tracking' ? 'flex min-w-0' : 'hidden lg:flex'} items-center gap-2`}>
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
				                                                            dispatchInsumosHeaderAction({ type: 'set-overview', value: { period: next, from: insumosOverviewFrom, to: insumosOverviewTo } })
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
				                                                                    dispatchInsumosHeaderAction({ type: 'set-overview', value: { period: insumosOverviewPeriod, from: next, to: insumosOverviewTo } })
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
				                                                                    dispatchInsumosHeaderAction({ type: 'set-overview', value: { period: insumosOverviewPeriod, from: insumosOverviewFrom, to: next } })
					                                                                }}
					                                                                placeholder="Até (DD/MM/AA)"
					                                                                className="h-8 w-36 bg-white/[0.06] border-white/20 text-white placeholder:text-blue-200/40"
					                                                                ariaLabel="Até"
					                                                            />
					                                                        </>
					                                                    ) : null}

						                                                    <TooltipButton label="Entrada">
						                                                        <Button
						                                                            size="icon"
						                                                            variant="ghost"
						                                                            className="h-9 w-9 rounded-md bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/35"
					                                                            onClick={() => {
				                                                                dispatchInsumosHeaderAction({ type: 'quick-op', value: 'ENTRADA' })
	                                                            }}
			                                                            aria-label="Entrada"
			                                                        >
				                                                            <img src="/icons/shortcut-entrada.svg" alt="" aria-hidden className="h-5 w-5" />
			                                                        </Button>
						                                                    </TooltipButton>
						                                                    <TooltipButton label="Saída">
						                                                        <Button
						                                                            size="icon"
						                                                            variant="ghost"
						                                                            className="h-9 w-9 rounded-md bg-rose-500/30 text-rose-100 hover:bg-rose-500/40"
					                                                            onClick={() => {
				                                                                dispatchInsumosHeaderAction({ type: 'quick-op', value: 'BAIXA' })
	                                                            }}
			                                                            aria-label="Saída"
			                                                        >
				                                                            <img src="/icons/shortcut-saida.svg" alt="" aria-hidden className="h-5 w-5" />
			                                                        </Button>
						                                                    </TooltipButton>
				                                                    <TooltipButton label="Transferência">
				                                                        <Button
				                                                            size="icon"
				                                                            variant="ghost"
				                                                            className="h-9 w-9 rounded-md bg-sky-500/30 text-sky-100 hover:bg-sky-500/40"
				                                                            onClick={() => {
				                                                                dispatchInsumosHeaderAction({ type: 'quick-op', value: 'TRANSFERENCIA' })
	                                                            }}
			                                                            aria-label="Transferência"
				                                                        >
					                                                            <img src="/icons/shortcut-transferencia.svg" alt="" aria-hidden className="h-5 w-5" />
					                                                        </Button>
				                                                    </TooltipButton>
					
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
				                                        {active === 'escala-profissionais' ? (
					                                            <div className="flex items-center gap-2 max-w-[56vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-escala-preserve-filter="true">
					                                                <Select
					                                                    value={escalaHeaderState?.selectedUnit || ''}
				                                                    onValueChange={(value) => {
                                                                        dispatchEscalaHeaderAction({ type: 'set-unit', value })
				                                                    }}
				                                                >
					                                                    <SelectTrigger className="h-8 w-48 bg-white/[0.06] border-white/20 text-white" data-escala-preserve-filter="true">
					                                                        <SelectValue placeholder="Unidade" />
					                                                    </SelectTrigger>
					                                                    <SelectContent data-escala-preserve-filter="true">
				                                                        {(escalaHeaderState?.units || []).map((unit) => (
				                                                            <SelectItem key={unit} value={unit}>
				                                                                {formatUnitLabel(unit)}
				                                                            </SelectItem>
				                                                        ))}
				                                                    </SelectContent>
				                                                </Select>
					                                                <Select
					                                                    value={escalaHeaderState?.selectedMonthNumber || ''}
					                                                    onValueChange={(value) => {
                                                                        dispatchEscalaHeaderAction({ type: 'set-month', value })
					                                                    }}
					                                                >
					                                                    <SelectTrigger className="h-8 w-36 bg-white/[0.06] border-white/20 text-white" data-escala-preserve-filter="true">
					                                                        <SelectValue placeholder={formatMonthLabelHeader(escalaHeaderState?.selectedMonthNumber || '')} />
					                                                    </SelectTrigger>
					                                                    <SelectContent data-escala-preserve-filter="true">
					                                                        {(escalaHeaderState?.monthOptions || []).map((month) => (
					                                                            <SelectItem key={month} value={month}>
					                                                                {formatMonthLabelHeader(month)}
					                                                            </SelectItem>
					                                                        ))}
					                                                    </SelectContent>
					                                                </Select>
					                                                <Select
					                                                    value={escalaHeaderState?.selectedYear || ''}
					                                                    onValueChange={(value) => {
                                                                        dispatchEscalaHeaderAction({ type: 'set-year', value })
					                                                    }}
					                                                >
					                                                    <SelectTrigger className="h-8 w-28 bg-white/[0.06] border-white/20 text-white" data-escala-preserve-filter="true">
					                                                        <SelectValue placeholder={escalaHeaderState?.selectedYear || new Date().getFullYear().toString()} />
					                                                    </SelectTrigger>
					                                                    <SelectContent data-escala-preserve-filter="true">
					                                                        {(escalaHeaderState?.yearOptions || []).map((year) => (
					                                                            <SelectItem key={year} value={year}>
					                                                                {year}
					                                                            </SelectItem>
					                                                        ))}
					                                                    </SelectContent>
					                                                </Select>
				                                            </div>
				                                        ) : null}
                                                        {active === 'meta-ads' ? (
                                                            <div className="flex items-center gap-2 max-w-[56vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                                                <Select
                                                                    value={metaAdsHeaderState?.selectedAccountId || ''}
                                                                    onValueChange={(value) => {
                                                                        if (value === '__meta_ads_add_connection__') {
                                                                            dispatchMetaAdsHeaderAction({ type: 'connect' })
                                                                            return
                                                                        }
                                                                        dispatchMetaAdsHeaderAction({ type: 'set-account', value })
                                                                    }}
                                                                    disabled={metaAdsHeaderState?.refreshing}
                                                                >
                                                                    <SelectTrigger className="h-8 w-64 bg-white/[0.06] border-white/20 text-white">
                                                                        <SelectValue placeholder="Conta de anúncios" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {[...(metaAdsHeaderState?.accounts || [])]
                                                                            .sort((a, b) => {
                                                                                if (a.id === metaAdsHeaderState?.selectedAccountId) return -1
                                                                                if (b.id === metaAdsHeaderState?.selectedAccountId) return 1
                                                                                return (a.name || a.id).localeCompare(b.name || b.id, 'pt-BR')
                                                                            })
                                                                            .map((account) => {
                                                                            const isSelectedAccount = account.id === metaAdsHeaderState?.selectedAccountId
                                                                            const statusTone =
                                                                                account.statusTone === 'success'
                                                                                    ? 'bg-emerald-500/12 text-emerald-100 focus:bg-emerald-500/20 focus:text-emerald-50'
                                                                                    : account.statusTone === 'warning'
                                                                                        ? 'bg-amber-500/12 text-amber-100 focus:bg-amber-500/20 focus:text-amber-50'
                                                                                        : account.statusTone === 'danger'
                                                                                            ? 'bg-rose-500/12 text-rose-100 focus:bg-rose-500/20 focus:text-rose-50'
                                                                                            : 'bg-slate-950 text-slate-100 focus:bg-slate-800/90'
                                                                            return (
                                                                                <SelectItem
                                                                                    key={account.id}
                                                                                    value={account.id}
                                                                                    className={`${statusTone} ${isSelectedAccount ? 'border-l-2 border-sky-300/80 font-semibold ring-1 ring-inset ring-sky-300/20' : 'border-l-2 border-transparent font-normal'}`}
                                                                                    hideIndicator
                                                                                    action={
                                                                                        <button
                                                                                            type="button"
                                                                                            className="inline-flex size-5 items-center justify-center rounded-full border border-white/15 text-blue-100/70 transition hover:border-rose-300/50 hover:bg-rose-500/15 hover:text-rose-100"
                                                                                            aria-label={`Remover ${account.name || account.id} da lista`}
                                                                                            tabIndex={-1}
                                                                                            onPointerDown={(event) => {
                                                                                                event.preventDefault()
                                                                                                event.stopPropagation()
                                                                                                setMetaAdsAccountRemovalId(account.id)
                                                                                            }}
                                                                                            onClick={(event) => {
                                                                                                event.preventDefault()
                                                                                                event.stopPropagation()
                                                                                            }}
                                                                                        >
                                                                                            <X className="size-3" aria-hidden="true" />
                                                                                        </button>
                                                                                    }
                                                                                >
                                                                                    <div className="flex min-w-0 items-center pr-7">
                                                                                        <span className={`truncate ${isSelectedAccount ? 'text-white' : ''}`}>{account.name || account.id}</span>
                                                                                    </div>
                                                                                </SelectItem>
                                                                            )
                                                                        })}
                                                                        <SelectItem value="__meta_ads_add_connection__" className="bg-slate-950 text-sky-100 focus:bg-sky-500/15 focus:text-sky-50">
                                                                            <div className="flex w-full items-center gap-2 pr-4">
                                                                                <Plus className="size-3.5 text-sky-300" aria-hidden="true" />
                                                                                <span>Adicionar conexão</span>
                                                                            </div>
                                                                        </SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        ) : null}
                                                        {active === 'site-tracking' ? (
                                                            <div className="flex items-center gap-2 max-w-[56vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Select
                                                                        value={siteTrackingHeaderState?.selectedSiteId || ''}
                                                                        onValueChange={(value) => {
                                                                            if (value === '__site_tracking_add_connection__') {
                                                                                dispatchSiteTrackingHeaderAction({ type: 'connect' })
                                                                                return
                                                                            }
                                                                            if (value === '__site_tracking_rename_site__') {
                                                                                dispatchSiteTrackingHeaderAction({ type: 'rename-site', value: siteTrackingHeaderState?.selectedSiteId })
                                                                                return
                                                                            }
                                                                            dispatchSiteTrackingHeaderAction({ type: 'set-site', value })
                                                                        }}
                                                                        disabled={siteTrackingHeaderState?.refreshing}
                                                                    >
                                                                        <SelectTrigger className="h-8 w-64 bg-white/[0.06] border-white/20 text-white">
                                                                            <SelectValue placeholder="Site" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {[...(siteTrackingHeaderState?.sites || [])]
                                                                                .sort((a, b) => {
                                                                                    if (a.id === siteTrackingHeaderState?.selectedSiteId) return -1
                                                                                    if (b.id === siteTrackingHeaderState?.selectedSiteId) return 1
                                                                                    return (a.name || a.host || a.id).localeCompare(b.name || b.host || b.id, 'pt-BR')
                                                                                })
                                                                                .map((site) => {
                                                                                    const isSelectedSite = site.id === siteTrackingHeaderState?.selectedSiteId
                                                                                    const statusTone =
                                                                                        site.statusTone === 'success'
                                                                                            ? 'bg-emerald-500/12 text-emerald-100 focus:bg-emerald-500/20 focus:text-emerald-50'
                                                                                            : site.statusTone === 'warning'
                                                                                                ? 'bg-amber-500/12 text-amber-100 focus:bg-amber-500/20 focus:text-amber-50'
                                                                                                : site.statusTone === 'danger'
                                                                                                    ? 'bg-rose-500/12 text-rose-100 focus:bg-rose-500/20 focus:text-rose-50'
                                                                                                    : 'bg-slate-950 text-slate-100 focus:bg-slate-800/90'
                                                                                    return (
                                                                                        <SelectItem
                                                                                            key={site.id}
                                                                                            value={site.id}
                                                                                            className={`${statusTone} ${isSelectedSite ? 'border-l-2 border-cyan-300/80 font-semibold ring-1 ring-inset ring-cyan-300/20' : 'border-l-2 border-transparent font-normal'}`}
                                                                                            hideIndicator
                                                                                        >
                                                                                            <div className="flex min-w-0 flex-col pr-4 leading-tight">
                                                                                                <span className={`truncate ${isSelectedSite ? 'text-white' : ''}`}>{site.name || site.host || site.id}</span>
                                                                                                {site.statusLabel ? <span className="truncate text-[10px] font-normal opacity-70">{site.statusLabel}</span> : null}
                                                                                            </div>
                                                                                        </SelectItem>
                                                                                    )
                                                                                })}
                                                                            <SelectItem value="__site_tracking_add_connection__" className="bg-slate-950 text-cyan-100 focus:bg-cyan-500/15 focus:text-cyan-50">
                                                                                <div className="flex w-full items-center gap-2 pr-4">
                                                                                    <Plus className="size-3.5 text-cyan-300" aria-hidden="true" />
                                                                                    <span>Adicionar conexão</span>
                                                                                </div>
                                                                            </SelectItem>
                                                                            <SelectItem value="__site_tracking_rename_site__" className="bg-slate-950 text-cyan-100 focus:bg-cyan-500/15 focus:text-cyan-50">
                                                                                <div className="flex w-full items-center gap-2 pr-4">
                                                                                    <Pencil className="size-3.5 text-cyan-300" aria-hidden="true" />
                                                                                    <span>Renomear site</span>
                                                                                </div>
                                                                            </SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <button
                                                                        type="button"
                                                                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/[0.05] text-cyan-100/80 transition hover:border-cyan-300/50 hover:bg-cyan-400/10 hover:text-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                                        aria-label="Renomear site selecionado"
                                                                        title="Renomear site"
                                                                        disabled={siteTrackingHeaderState?.refreshing || !siteTrackingHeaderState?.selectedSiteId}
                                                                        onClick={() => dispatchSiteTrackingHeaderAction({ type: 'rename-site', value: siteTrackingHeaderState?.selectedSiteId })}
                                                                    >
                                                                        <Pencil className="size-3.5" aria-hidden="true" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ) : null}
		                                    </div>
	                                </div>

		                                <div className={`flex items-center gap-4 ${active === 'escala-profissionais' ? 'pr-44' : ''}`}>
	                                    {active === 'escala-profissionais' ? (
		                                        <div className="flex items-center gap-1.5 max-w-[58vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-escala-preserve-filter="true">
                                                    {[
                                                        {
                                                            key: 'manual' as EscalaHighlightMode,
                                                            label: 'Manual',
                                                            icon: <Pencil className="size-3.5" aria-hidden="true" />,
                                                            value: escalaHeaderState?.manualDays ?? escalaHeaderState?.totalScheduledDays ?? 0,
                                                            activeClass: 'border-sky-300/55 bg-sky-300/16 text-sky-50 shadow-[0_0_0_1px_rgba(125,211,252,0.16)]',
                                                        },
                                                        {
                                                            key: 'auto' as EscalaHighlightMode,
                                                            label: 'Auto',
                                                            icon: <Sparkles className="size-3.5" aria-hidden="true" />,
                                                            value: escalaHeaderState?.autoDays ?? 0,
                                                            activeClass: 'border-emerald-300/55 bg-emerald-300/16 text-emerald-50 shadow-[0_0_0_1px_rgba(110,231,183,0.16)]',
                                                        },
                                                        {
                                                            key: 'blocked' as EscalaHighlightMode,
                                                            label: 'Bloqueado',
                                                            icon: <Shield className="size-3.5" aria-hidden="true" />,
                                                            value: escalaHeaderState?.blockedDays ?? 0,
                                                            activeClass: 'border-rose-300/55 bg-rose-300/16 text-rose-50 shadow-[0_0_0_1px_rgba(253,164,175,0.16)]',
                                                        },
                                                        {
                                                            key: 'empty' as EscalaHighlightMode,
                                                            label: 'Vazio',
                                                            icon: <CalendarX2 className="size-3.5" aria-hidden="true" />,
                                                            value: escalaHeaderState?.emptyDays ?? escalaHeaderState?.unavailableDaysCount ?? 0,
                                                            activeClass: 'border-amber-300/55 bg-amber-300/14 text-amber-50 shadow-[0_0_0_1px_rgba(252,211,77,0.16)]',
                                                        },
                                                    ].map((item) => (
                                                        <Tooltip key={item.key}>
                                                            <TooltipTrigger asChild>
                                                                <button
                                                                    type="button"
                                                                    className={`escala-kpi-badge inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-all ${escalaHeaderState?.highlightMode === item.key ? item.activeClass : 'border-white/15 bg-white/[0.06] text-blue-50'}`}
                                                                    data-escala-preserve-filter="true"
                                                                    data-testid={`escala-highlight-${item.key}`}
                                                                    aria-label={`Destacar dias ${item.label.toLowerCase()}`}
                                                                    onClick={() => {
                                                                        dispatchEscalaHeaderAction({ type: 'toggle-highlight', value: item.key })
                                                                    }}
                                                                >
                                                                    {item.icon}
                                                                    <span className="sr-only">{item.label}</span>
                                                                    <span>{item.value}</span>
                                                                </button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                {item.label}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    ))}
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-2.5 text-xs text-blue-50" data-escala-preserve-filter="true">
                                                                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                                                                <span className="sr-only">Cobertura</span>
                                                                <span>{escalaHeaderState?.coveredDays ?? escalaHeaderState?.totalScheduledDays ?? 0}</span>
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Cobertura
                                                        </TooltipContent>
                                                    </Tooltip>
	                                            <Tooltip>
	                                                <TooltipTrigger asChild>
	                                                    <span data-escala-preserve-filter="true">
	                                                        <Button
	                                                            size="icon"
	                                                            variant="ghost"
	                                                            className="h-8 w-8 rounded-full border border-white/15 bg-white/5 text-blue-50 opacity-60"
	                                                            disabled
	                                                        >
                                                                <Download className="size-3.5" aria-hidden="true" />
	                                                        </Button>
	                                                    </span>
	                                                </TooltipTrigger>
	                                                <TooltipContent>
	                                                    Exportar resumo
	                                                </TooltipContent>
	                                            </Tooltip>
                                        </div>
                                    ) : null}
                                    {active === 'meta-ads' ? (
                                        <div className="flex items-center gap-1.5 max-w-[58vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                            <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] p-1">
                                                {[7, 30, 60].map((period) => (
                                                    <button
                                                        key={period}
                                                        type="button"
                                                        className={`h-6 rounded-full px-2.5 text-xs transition ${
                                                            !metaAdsHeaderState?.customRangeActive && metaAdsHeaderState?.reportWindowDays === period
                                                                ? 'bg-white/16 text-white'
                                                                : 'text-blue-100/80 hover:bg-white/[0.08] hover:text-white'
                                                        }`}
                                                        onClick={() => dispatchMetaAdsHeaderAction({ type: 'set-report-window', value: period as 7 | 30 | 60 })}
                                                    >
                                                        {period}d
                                                    </button>
                                                ))}
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <button
                                                            type="button"
                                                            className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition ${
                                                                metaAdsHeaderState?.customRangeActive
                                                                    ? 'bg-white/16 text-white'
                                                                    : 'text-blue-100/80 hover:bg-white/[0.08] hover:text-white'
                                                            }`}
                                                            onClick={() => dispatchMetaAdsHeaderAction({ type: 'open-custom-period' })}
                                                            aria-label="Periodo personalizado"
                                                        >
                                                            <CalendarX2 className="size-3.5" aria-hidden="true" />
                                                        </button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        {metaAdsHeaderState?.customRangeActive && metaAdsHeaderState?.customRangeLabel
                                                            ? `Período personalizado: ${metaAdsHeaderState.customRangeLabel}`
                                                            : 'Escolher período personalizado'}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </div>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-8 w-8 rounded-full border border-white/15 bg-white/[0.06] text-blue-50 hover:bg-white/[0.12]"
                                                        onClick={() => dispatchMetaAdsHeaderAction({ type: 'refresh' })}
                                                        disabled={metaAdsHeaderState?.refreshing}
                                                        aria-label="Atualizar"
                                                    >
                                                        <RefreshCw className={`size-3.5 ${metaAdsHeaderState?.refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    {metaAdsHeaderState?.sessionUpdatedAt
                                                        ? `Atualizar. Ultima atualizacao: ${new Date(metaAdsHeaderState.sessionUpdatedAt).toLocaleString('pt-BR')}`
                                                        : 'Atualizar'}
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    ) : null}
                                    {active === 'site-tracking' ? (
                                        <div className="flex items-center gap-1.5 max-w-[58vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                            <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] p-1">
                                                {[7, 30, 60, 90].map((period) => (
                                                    <button
                                                        key={period}
                                                        type="button"
                                                        className={`h-6 rounded-full px-2.5 text-xs transition ${
                                                            siteTrackingHeaderState?.windowDays === period
                                                                ? 'bg-white/16 text-white'
                                                                : 'text-blue-100/80 hover:bg-white/[0.08] hover:text-white'
                                                        }`}
                                                        onClick={() => dispatchSiteTrackingHeaderAction({ type: 'set-window', value: period as 7 | 30 | 60 | 90 })}
                                                    >
                                                        {period}d
                                                    </button>
                                                ))}
                                            </div>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-8 w-8 rounded-full border border-white/15 bg-white/[0.06] text-blue-50 hover:bg-white/[0.12]"
                                                        onClick={() => dispatchSiteTrackingHeaderAction({ type: 'refresh' })}
                                                        disabled={siteTrackingHeaderState?.refreshing}
                                                        aria-label="Atualizar Site EF"
                                                    >
                                                        <RefreshCw className={`size-3.5 ${siteTrackingHeaderState?.refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    {siteTrackingHeaderState?.updatedAt
                                                        ? `Atualizar. Ultima atualizacao: ${new Date(siteTrackingHeaderState.updatedAt).toLocaleString('pt-BR')}`
                                                        : 'Atualizar'}
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    ) : null}
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
		                                            <TooltipButton label="Editar faixas de estoque">
		                                                <button
		                                                    type="button"
		                                                    className="inline-flex"
		                                                    onClick={() => setEstoqueThresholdsOpen(true)}
		                                                    aria-label="Editar faixas de estoque"
		                                                >
		                                                    <Badge className={`uppercase tracking-wide border ${estoqueBadgeClass}`}>Estoque</Badge>
		                                                </button>
		                                            </TooltipButton>
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
		                                            <TooltipButton label="Expandir tudo">
		                                                <Button
		                                                    size="icon"
		                                                    variant="ghost"
		                                                    className="h-9 w-9 rounded-md bg-transparent text-white hover:bg-white/[0.10]"
		                                                    onClick={() => {
		                                                        dispatchInsumosHeaderAction({ type: 'layout', value: 'expandAll' })
	                                                    }}
		                                                    aria-label="Expandir tudo"
		                                                >
		                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
		                                                    <path d="M7 9l5 5 5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                    <path d="M7 14l5 5 5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                </svg>
		                                                </Button>
		                                            </TooltipButton>
		                                            <TooltipButton label="Contrair tudo">
		                                                <Button
		                                                    size="icon"
		                                                    variant="ghost"
		                                                    className="h-9 w-9 rounded-md bg-transparent text-white hover:bg-white/[0.10]"
		                                                    onClick={() => {
		                                                        dispatchInsumosHeaderAction({ type: 'layout', value: 'collapseAll' })
	                                                    }}
		                                                    aria-label="Contrair tudo"
		                                                >
		                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
		                                                    <path d="M7 15l5-5 5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                    <path d="M7 10l5-5 5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                </svg>
		                                                </Button>
		                                            </TooltipButton>
		                                            <TooltipButton label="Resetar layout">
		                                                <Button
		                                                    size="icon"
		                                                    variant="ghost"
		                                                    className="h-9 w-9 rounded-md bg-transparent text-white hover:bg-white/[0.10]"
		                                                    onClick={() => {
		                                                        dispatchInsumosHeaderAction({ type: 'layout', value: 'reset' })
	                                                    }}
		                                                    aria-label="Resetar layout"
		                                                >
		                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
		                                                    <path d="M21 12a9 9 0 1 1-3.1-6.7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                    <path d="M21 4v6h-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
		                                                </svg>
		                                                </Button>
		                                            </TooltipButton>
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
                                        <TooltipButton label="Status do sistema">
                                            <Button
                                                variant="outline"
                                                className="bg-white/[0.08] border-white/20 text-white hover:bg-white/[0.12] h-11 w-11 p-0"
	                                                onClick={() => {
	                                                    setSearch('')
	                                                    setActive('status')
	                                                }}
	                                                aria-label="Status do sistema"
	                                            >
	                                                <span className="text-lg">⚙️</span>
	                                            </Button>
                                        </TooltipButton>
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
	                                                dispatchInsumosHeaderAction({ type: 'set-overview', value: { period: next, from: insumosOverviewFrom, to: insumosOverviewTo } })
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
	                                                    dispatchInsumosHeaderAction({ type: 'set-overview', value: { period: insumosOverviewPeriod, from: next, to: insumosOverviewTo } })
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
	                                                    dispatchInsumosHeaderAction({ type: 'set-overview', value: { period: insumosOverviewPeriod, from: insumosOverviewFrom, to: next } })
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
	                                                <TooltipButton label="Entrada">
	                                                    <Button
	                                                        size="icon"
	                                                        variant="ghost"
                                                        className="bg-transparent text-white hover:bg-white/[0.10] p-0 size-11 rounded-full"
                                                        onClick={() => {
                                                            dispatchInsumosHeaderAction({ type: 'quick-op', value: 'ENTRADA' })
                                                        }}
                                                        aria-label="Entrada"
                                                    >
                                                    <img src="/icons/shortcut-entrada.svg" alt="" aria-hidden className="h-11 w-11" />
                                                    </Button>
                                                </TooltipButton>
                                                <TooltipButton label="Saída">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="bg-transparent text-white hover:bg-white/[0.10] p-0 size-11 rounded-full"
                                                        onClick={() => {
                                                            dispatchInsumosHeaderAction({ type: 'quick-op', value: 'BAIXA' })
                                                        }}
                                                        aria-label="Saída"
                                                    >
                                                    <img src="/icons/shortcut-saida.svg" alt="" aria-hidden className="h-11 w-11" />
                                                    </Button>
                                                </TooltipButton>
                                                <TooltipButton label="Transferência">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="bg-transparent text-white hover:bg-white/[0.10] p-0 size-11 rounded-full"
                                                        onClick={() => {
                                                            dispatchInsumosHeaderAction({ type: 'quick-op', value: 'TRANSFERENCIA' })
                                                        }}
                                                        aria-label="Transferência"
                                                    >
	                                                <img src="/icons/shortcut-transferencia.svg" alt="" aria-hidden className="h-11 w-11" />
                                                    </Button>
                                                </TooltipButton>
		
	                                        </div>
	                                    </div>
	                                </div>
	                            ) : null}
                        </header>

                        {/* Premium Main Content */}
                        <main className={`flex-1 p-8 relative ${active === 'atendimento' ? 'overflow-hidden flex min-h-0 flex-col' : 'overflow-auto'} ${active === 'meta-ads' ? 'meta-ads-main' : ''}`}>
                            {/* Content Background */}
                            <div className={`absolute inset-0 ${active === 'meta-ads' ? 'meta-ads-main-bg' : 'bg-white/[0.02] backdrop-blur-sm'}`}></div>

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
