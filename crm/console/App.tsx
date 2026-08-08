// Combined NEATLAB layout + full functionality exposure
import React, { useState, useMemo } from 'react'
import { ContextDebugger } from './ContextDebugger'
import { ModuleHost } from '@/modules/ModuleHost'
import { crmModuleByKey, crmModuleRegistry, moduleAvailability } from '@/modules/registry'
import { NotificationProvider, useAuth, useNotifications } from '@/contexts'
import { resolveFinanceBootstrapEnabled } from '@/financeBootstrap'
import { isOnlineCrmRuntime, unlockedModuleKeys } from '@/moduleAvailability'
import { LoadingScreen } from '@/LoadingPattern'
import { AuthScreen } from '@/AuthScreen'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/dropdown-menu'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Tooltip, TooltipButton, TooltipContent, TooltipLabel, TooltipTrigger } from '@/tooltip'
import { useKV } from '@/spark-mock'
import { DEFAULT_UNIT_OPTIONS, useGlobalUnitSelection } from '@/unitSelection'
import { dispatchEscalaHeaderAction, subscribeEscalaHeaderState } from '@/escalaHeaderBridge'
import type { EscalaHeaderState, EscalaHighlightMode } from '@/escalaTypes'
import { dispatchInsumosHeaderAction, subscribeInsumosHeaderState } from '@/insumosBridge'
import type { InsumosHeaderState, InsumosOverviewPeriod, InsumosQuickOperation } from '@/insumosTypes'
import { INSUMOS_ALL_UNITS } from '@/insumosUnitAccess'
import { dispatchMetaAdsHeaderAction, subscribeMetaAdsHeaderState } from '@/metaAdsHeaderBridge'
import type { MetaAdsHeaderState } from '@/metaAdsTypes'
import { dispatchSiteTrackingHeaderAction, subscribeSiteTrackingHeaderState } from '@/siteTrackingHeaderBridge'
import type { SiteTrackingHeaderState } from '@/siteTrackingTypes'
import { dispatchAtendimentoHeaderAction, subscribeAtendimentoHeaderState } from '@/atendimentoHeaderBridge'
import type { AtendimentoHeaderState } from '@/atendimentoHeaderBridge'
import { hasCrmModuleAccess } from '@/crmRoleAccess'
import { canManagePonto } from '@/pontoAccess'
import { clientesWorkspaceQueryKeys, clientesWorkspaceUrl, parseClientesWorkspaceRoute, readClientesWalletUrlState } from '@/clientesRoutes'
import { ArrowDownUp, CalendarX2, CheckCircle2, ChevronDown, ChevronsUpDown, Download, Pencil, Plus, RefreshCw, Search, Shield, Sparkles, Upload, X } from 'lucide-react'

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

function formatLocalIsoDate(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

type AtendimentoQuickPreset = 'last7' | 'last30' | 'currentWeek' | 'currentMonth'

type InsumosQuickPreset = Extract<InsumosOverviewPeriod, 'currentWeek' | 'currentMonth'>

const ATENDIMENTO_QUICK_PRESETS: Array<{
    key: AtendimentoQuickPreset
    label: string
    tooltip: string
    tooltipDescription?: string
    icon?: 'currentWeek' | 'currentMonth'
}> = [
    { key: 'currentWeek', label: 'Semana atual', tooltip: 'Semana atual', tooltipDescription: 'Da segunda-feira até hoje.', icon: 'currentWeek' },
    { key: 'currentMonth', label: 'Mês atual', tooltip: 'Mês atual', tooltipDescription: 'Do primeiro dia do mês até hoje.', icon: 'currentMonth' },
]

const ATENDIMENTO_PERIOD_PICKER_PRESETS: Array<Pick<(typeof ATENDIMENTO_QUICK_PRESETS)[number], 'key' | 'label' | 'tooltip'>> = [
    { key: 'last7', label: '7d', tooltip: 'Últimos 7 dias' },
    { key: 'last30', label: '30d', tooltip: 'Últimos 30 dias' },
]

const INSUMOS_QUICK_PRESETS: Array<{
    key: InsumosQuickPreset
    label: string
    tooltip: string
    tooltipDescription: string
    icon: 'currentWeek' | 'currentMonth'
}> = [
    { key: 'currentWeek', label: 'Semana atual', tooltip: 'Semana atual', tooltipDescription: 'Da segunda-feira até hoje.', icon: 'currentWeek' },
    { key: 'currentMonth', label: 'Mês atual', tooltip: 'Mês atual', tooltipDescription: 'Do primeiro dia do mês até hoje.', icon: 'currentMonth' },
]

const INSUMOS_PERIOD_PICKER_PRESETS: Array<{
    key: Extract<InsumosOverviewPeriod, '7d' | '30d' | '1y'>
    label: string
    tooltip: string
}> = [
    { key: '7d', label: '7d', tooltip: 'Últimos 7 dias' },
    { key: '30d', label: '30d', tooltip: 'Últimos 30 dias' },
    { key: '1y', label: '1 ano', tooltip: 'Último ano' },
]

function AtendimentoCurrentWeekIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
            <rect x="2.25" y="3.25" width="19.5" height="17.5" rx="3" stroke="currentColor" strokeWidth="1.6" />
            <path d="M2.75 7.5H21.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                <rect key={day} x={3.7 + day * 2.35} y="11" width="1.55" height="4.6" rx="0.45" fill="currentColor" />
            ))}
        </svg>
    )
}

function AtendimentoCurrentMonthIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
            <rect x="2.25" y="3.25" width="19.5" height="17.5" rx="3" stroke="currentColor" strokeWidth="1.6" />
            <path d="M2.75 7.5H21.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            {[0, 1, 2, 3].flatMap((week) => [0, 1, 2, 3, 4, 5, 6].map((day) => (
                <rect key={`${week}-${day}`} x={3.7 + day * 2.35} y={9.7 + week * 2.35} width="1.45" height="1.45" rx="0.3" fill="currentColor" />
            )))}
        </svg>
    )
}

function renderAtendimentoQuickPresetIcon(icon?: 'currentWeek' | 'currentMonth') {
    if (icon === 'currentWeek') return <AtendimentoCurrentWeekIcon />
    if (icon === 'currentMonth') return <AtendimentoCurrentMonthIcon />
    return null
}

function buildAtendimentoQuickRange(preset: AtendimentoQuickPreset, now = new Date()) {
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const from = new Date(to)
    if (preset === 'last7') {
        from.setDate(to.getDate() - 6)
    } else if (preset === 'last30') {
        from.setDate(to.getDate() - 29)
    } else if (preset === 'currentWeek') {
        const mondayOffset = (to.getDay() + 6) % 7
        from.setDate(to.getDate() - mondayOffset)
    } else {
        from.setDate(1)
    }
    return {
        from: formatLocalIsoDate(from),
        to: formatLocalIsoDate(to),
    }
}

function detectAtendimentoQuickPreset(filters?: { from?: string; to?: string } | null, now = new Date()): AtendimentoQuickPreset | null {
    const from = String(filters?.from || '')
    const to = String(filters?.to || '')
    if (!from || !to) return null
    for (const preset of ATENDIMENTO_QUICK_PRESETS) {
        const range = buildAtendimentoQuickRange(preset.key, now)
        if (range.from === from && range.to === to) return preset.key
    }
    return null
}

function formatAtendimentoPeriodRange(from?: string, to?: string) {
    const format = (value?: string) => {
        const [year, month, day] = String(value || '').slice(0, 10).split('-')
        return year && month && day ? `${day}/${month}/${year}` : ''
    }
    const start = format(from)
    const end = format(to)
    if (start && end) return `${start} - ${end}`
    return start || end || ''
}

function normalizeStoredInsumosPeriod(value: string | null): InsumosOverviewPeriod {
    if (value === 'currentWeek' || value === 'currentMonth' || value === 'custom' || value === '1y') return value
    if (value === '7d') return 'currentWeek'
    if (value === '30d') return 'currentMonth'
    return 'currentMonth'
}

type ApiError = {
    error?: string
    message?: string
    code?: string
}

type InsumosMeResponse = {
    success?: boolean
    user?: { username?: string; displayName?: string; email?: string; role?: string; allowedUnits?: string[]; allowedModules?: string[]; localFocusModule?: string }
    csrfToken?: string
}

type ConversaHeaderState = {
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

const modules = crmModuleRegistry

function configuredMaintenanceModuleKeys(): Set<string> {
    return new Set(
        String(import.meta.env.VITE_CRM_MAINTENANCE_MODULES || '')
            .split(',')
            .map((key) => key.trim())
            .filter((key) => crmModuleByKey.has(key)),
    )
}

export default function AppFunctionalNeatlab() {
    const { isAuthenticated, user, signOut, initializing, initProgress } = useAuth()

    const DEFAULT_MODULE_KEY = 'insumos'

    const allowedModulesKey = Array.isArray(user?.allowedModules) ? user.allowedModules.join('|') : ''
    const hasFinanceModuleGrant = allowedModulesKey.split('|').includes('finance')
    const roleKey = String(user?.role || '').trim().toUpperCase()
    const [financeEnabled, setFinanceEnabled] = React.useState(false)
    const pontoCanAdmin = canManagePonto(roleKey)
    const usersCanManage = ['ADMIN', 'GESTOR', 'GERENTE'].includes(roleKey)
        && (roleKey === 'ADMIN' || (Array.isArray(user?.allowedUnits) && user.allowedUnits.length > 0))
    const hasModuleAccess = React.useCallback(
        (moduleKey: string) => {
            const key = String(moduleKey || '').trim()
            if (!key) return false
            if (key === 'finance') return financeEnabled && Array.isArray(user?.allowedModules) && user.allowedModules.map(String).includes('finance')
            return hasCrmModuleAccess(roleKey, user?.allowedModules, key)
        },
        [allowedModulesKey, financeEnabled, roleKey, user?.allowedModules]
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

	    // Finance becomes operational only after its server-side bootstrap has
	    // confirmed flag, explicit module grant and scope grant. Keep the
	    // generic unlocked-module policy intact for every other module.
	    const UNLOCKED_MODULE_KEYS = useMemo(
	        () => unlockedModuleKeys(
                financeEnabled ? 'finance' : DEFAULT_MODULE_KEY,
                isOnlineCrmRuntime(window.location.hostname),
                user?.localFocusModule || '',
            ),
	        [DEFAULT_MODULE_KEY, financeEnabled, user?.localFocusModule]
	    )
	    const [sidebarHover, setSidebarHover] = useState(false)
	    React.useEffect(() => {
	        if (!hasFinanceModuleGrant) { setFinanceEnabled(false); return }
	        const controller = new AbortController()
	        void resolveFinanceBootstrapEnabled({
	            apiOrigin: String(import.meta.env.VITE_FINANCE_API_ORIGIN || '/api'),
	            signal: controller.signal,
	        }).then((enabled) => {
	            if (!controller.signal.aborted) setFinanceEnabled(enabled)
	        })
	        return () => controller.abort()
	    }, [hasFinanceModuleGrant])
	    const [sidebarCanHover, setSidebarCanHover] = useState(() => {
	        try {
	            return window.matchMedia('(hover: hover) and (pointer: fine)').matches
	        } catch {
	            return false
	        }
	    })
	    const [sidebarCompactViewport, setSidebarCompactViewport] = useState(() => {
	        try {
	            return window.matchMedia('(max-width: 1279px)').matches
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
            const media = window.matchMedia('(max-width: 1279px)')
            const sync = () => setSidebarCompactViewport(media.matches)
            sync()
            media.addListener(sync)
            return () => media.removeListener(sync)
        } catch {
            setSidebarCompactViewport(false)
            return undefined
        }
    }, [])

    React.useEffect(() => {
        try {
            localStorage.setItem('ui.sidebarPinned', sidebarPinned ? 'true' : 'false')
        } catch { /* ignore */ }
    }, [sidebarPinned])

    const sidebarExpanded = !sidebarCompactViewport && (sidebarPinned || !sidebarCanHover || sidebarHover)

	    // Persist active module to survive remounts/reloads and avoid accidental resets
	    const [active, setActive] = useState<string>(() => {
		        try {
		            if (parseClientesWorkspaceRoute(window.location)) return 'clientes'
		            const requested = new URLSearchParams(window.location.search).get('module') || new URLSearchParams(window.location.search).get('tab')
            if (requested && crmModuleByKey.has(requested)) {
                return requested
            }
		            const saved = localStorage.getItem('app.activeModule')
		            const candidate = saved || DEFAULT_MODULE_KEY
		            return UNLOCKED_MODULE_KEYS.has(candidate) ? candidate : DEFAULT_MODULE_KEY
		        } catch { return DEFAULT_MODULE_KEY }
		    })
	    const selectModule = React.useCallback((moduleKey: string) => {
		        setActive(moduleKey)
		        try {
		            const url = new URL(window.location.href)
		            if (moduleKey === 'clientes') {
		                const currentRoute = parseClientesWorkspaceRoute(url)
		                const href = clientesWorkspaceUrl(
		                    currentRoute || { view: 'overview' },
		                    currentRoute ? readClientesWalletUrlState(url) : undefined,
		                    url,
		                )
		                if (href !== `${url.pathname}${url.search}${url.hash}`) window.history.pushState(window.history.state, '', href)
		                return
		            }
		            if (parseClientesWorkspaceRoute(url)?.source === 'path') {
		                url.pathname = '/'
		                for (const key of clientesWorkspaceQueryKeys) url.searchParams.delete(key)
		            }
		            url.searchParams.set('module', moduleKey)
		            url.searchParams.delete('tab')
		            window.history.replaceState(window.history.state, '', url)
		        } catch { /* ignore */ }
		    }, [])
		    const mountedModuleKeys = useMemo(() => [active], [active])

	    React.useEffect(() => {
        if (crmModuleByKey.has(active)) return
        setActive(DEFAULT_MODULE_KEY)
	    }, [DEFAULT_MODULE_KEY, active])

        // Canonical Clientes paths are intentionally resolved before generic
        // query-string modules. The route selects a shell only; ModuleHost and
        // the API still enforce RBAC and fail closed for an unauthorized actor.
        React.useEffect(() => {
            const onPopState = () => {
                try {
                    if (parseClientesWorkspaceRoute(window.location)) {
                        setActive('clientes')
                        return
                    }
                    const params = new URLSearchParams(window.location.search)
                    const requested = params.get('module') || params.get('tab')
                    if (requested && crmModuleByKey.has(requested)) setActive(requested)
                } catch { /* ignore malformed browser state */ }
            }
            window.addEventListener('popstate', onPopState)
            return () => window.removeEventListener('popstate', onPopState)
        }, [])
        const [search, setSearch] = useState('')
        const [conversaHeaderState, setConversaHeaderState] = useState<ConversaHeaderState | null>(null)
        const [atendimentoHeaderState, setAtendimentoHeaderState] = useState<AtendimentoHeaderState | null>(null)
        const [atendimentoPeriodPickerOpen, setAtendimentoPeriodPickerOpen] = useState(false)
        const [atendimentoPeriodDraft, setAtendimentoPeriodDraft] = useState({ from: '', to: '' })
        const [insumosPeriodPickerOpen, setInsumosPeriodPickerOpen] = useState(false)
        const [insumosPeriodDraft, setInsumosPeriodDraft] = useState({ from: '', to: '' })
        const [insumosMobilePeriodPickerOpen, setInsumosMobilePeriodPickerOpen] = useState(false)
        const [insumosMobilePeriodDraft, setInsumosMobilePeriodDraft] = useState({ from: '', to: '' })
        const [escalaHeaderState, setEscalaHeaderState] = useState<EscalaHeaderState | null>(null)
        const [metaAdsHeaderState, setMetaAdsHeaderState] = useState<MetaAdsHeaderState | null>(null)
        const [siteTrackingHeaderState, setSiteTrackingHeaderState] = useState<SiteTrackingHeaderState | null>(null)
        const [metaAdsAccountRemovalId, setMetaAdsAccountRemovalId] = useState<string | null>(null)
        const metaAdsAccountPendingRemoval = useMemo(
            () => (metaAdsHeaderState?.accounts || []).find((account) => account.id === metaAdsAccountRemovalId) || null,
            [metaAdsAccountRemovalId, metaAdsHeaderState?.accounts],
        )
        const siteTrackingSelectedSite = useMemo(
            () => (siteTrackingHeaderState?.sites || []).find((site) => site.id === siteTrackingHeaderState?.selectedSiteId) || null,
            [siteTrackingHeaderState],
        )
				    const [insumosHeaderState, setInsumosHeaderState] = useState<InsumosHeaderState | null>(null)
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
				        if (insumosHeaderStatus?.canAggregateUnits && out.length > 1 && !out.includes(INSUMOS_ALL_UNITS)) out.unshift(INSUMOS_ALL_UNITS)
				        if (selectedUnit && selectedUnit !== INSUMOS_ALL_UNITS && !out.includes(selectedUnit)) out.unshift(selectedUnit)
				        if (selectedUnit === INSUMOS_ALL_UNITS && !insumosHeaderStatus?.canAggregateUnits) return out.filter((unit) => unit !== INSUMOS_ALL_UNITS)
			        return out
			    }, [canonicalUnitValues, insumosHeaderStatus?.canAggregateUnits, insumosHeaderStatus?.unidades?.join('|'), selectedUnit])
			    const unitMonitorUnitsForHeaderSelect = useMemo(() => {
			        const out = [...new Set(canonicalUnitValues)].filter((u) => String(u) !== 'custom')
			        if (selectedUnit && !out.includes(selectedUnit)) out.unshift(selectedUnit)
			        return out
			    }, [canonicalUnitValues, selectedUnit])
			    const [insumosOverviewPeriod, setInsumosOverviewPeriod] = useState<InsumosOverviewPeriod>(() => {
			        try {
			            const raw = localStorage.getItem(INSUMOS_OVERVIEW_PERIOD_KEY)
			            return normalizeStoredInsumosPeriod(raw)
		        } catch {
		            return 'currentMonth'
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

			    const formatUnitLabel = (u: string) => {
			        if (String(u || '').trim() === INSUMOS_ALL_UNITS) return 'Todas unidades'
			        return String(u || '')
			            .split('-')
		            .filter(Boolean)
		            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		            .join(' ')
			    }

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
                const atendimentoQuickWindow = React.useMemo(
                    () => detectAtendimentoQuickPreset(atendimentoHeaderState?.filters),
                    [atendimentoHeaderState?.filters],
                )
                const atendimentoCustomPeriodLabel = React.useMemo(() => {
                    const filters = atendimentoHeaderState?.filters
                    if (!filters) return false
                    const quickPreset = detectAtendimentoQuickPreset(filters)
                    if (quickPreset || (!filters.from && !filters.to)) return ''
                    return formatAtendimentoPeriodRange(filters.from, filters.to)
                }, [atendimentoHeaderState?.filters])
                const atendimentoOperationalPeriodLabel = React.useMemo(() => {
                    const days = atendimentoHeaderState?.periodOperationalDays
                    if ((atendimentoQuickWindow !== 'currentWeek' && atendimentoQuickWindow !== 'currentMonth') || days == null) return ''
                    return `${days}d laborais`
                }, [atendimentoHeaderState?.periodOperationalDays, atendimentoQuickWindow])
                const atendimentoLayoutExpanded = atendimentoHeaderState?.layoutExpanded === true
                const atendimentoLayoutLabel = atendimentoLayoutExpanded ? 'Contrair tudo' : 'Expandir tudo'
                const insumosLayoutExpanded = insumosHeaderState?.layoutExpanded !== false
                const insumosLayoutLabel = insumosLayoutExpanded ? 'Contrair tudo' : 'Expandir tudo'
                const insumosCustomPeriodLabel = React.useMemo(() => {
                    if (insumosOverviewPeriod !== 'custom') return ''
                    return formatAtendimentoPeriodRange(insumosOverviewFrom, insumosOverviewTo)
                }, [insumosOverviewFrom, insumosOverviewPeriod, insumosOverviewTo])
                const insumosLegacyPeriodLabel = insumosOverviewPeriod === '1y' ? 'Último ano' : ''
                const setAtendimentoQuickWindow = React.useCallback((preset: AtendimentoQuickPreset) => {
                    const { from, to } = buildAtendimentoQuickRange(preset)
                    dispatchAtendimentoHeaderAction({
                        type: 'set-filter',
                        patch: {
                            from,
                            to,
                        },
                    })
                }, [])
                const openAtendimentoPeriodPicker = React.useCallback((open: boolean) => {
                    setAtendimentoPeriodPickerOpen(open)
                    if (open) {
                        setAtendimentoPeriodDraft({
                            from: atendimentoHeaderState?.filters.from || '',
                            to: atendimentoHeaderState?.filters.to || '',
                        })
                    }
                }, [atendimentoHeaderState?.filters.from, atendimentoHeaderState?.filters.to])
                const applyAtendimentoCustomPeriod = React.useCallback(() => {
                    if (!atendimentoPeriodDraft.from || !atendimentoPeriodDraft.to || atendimentoPeriodDraft.from > atendimentoPeriodDraft.to) return
                    dispatchAtendimentoHeaderAction({
                        type: 'set-filter',
                        patch: { from: atendimentoPeriodDraft.from, to: atendimentoPeriodDraft.to },
                    })
                    setAtendimentoPeriodPickerOpen(false)
                }, [atendimentoPeriodDraft])
                const setInsumosQuickPeriod = React.useCallback((preset: InsumosQuickPreset) => {
                    setInsumosOverviewPeriod(preset)
                    setInsumosOverviewFrom('')
                    setInsumosOverviewTo('')
                    setInsumosPeriodPickerOpen(false)
                    setInsumosMobilePeriodPickerOpen(false)
                    try {
                        localStorage.setItem(INSUMOS_OVERVIEW_PERIOD_KEY, preset)
                        localStorage.removeItem(INSUMOS_OVERVIEW_FROM_KEY)
                        localStorage.removeItem(INSUMOS_OVERVIEW_TO_KEY)
                    } catch { /* ignore */ }
                    dispatchInsumosHeaderAction({ type: 'set-overview', value: { period: preset, from: '', to: '' } })
                }, [])
                const setInsumosLegacyPeriod = React.useCallback((period: Extract<InsumosOverviewPeriod, '7d' | '30d' | '1y'>) => {
                    setInsumosOverviewPeriod(period)
                    try { localStorage.setItem(INSUMOS_OVERVIEW_PERIOD_KEY, period) } catch { /* ignore */ }
                    dispatchInsumosHeaderAction({ type: 'set-overview', value: { period, from: insumosOverviewFrom, to: insumosOverviewTo } })
                    setInsumosPeriodPickerOpen(false)
                    setInsumosMobilePeriodPickerOpen(false)
                }, [insumosOverviewFrom, insumosOverviewTo])
                const openInsumosPeriodPicker = React.useCallback((open: boolean) => {
                    setInsumosPeriodPickerOpen(open)
                    if (open) {
                        setInsumosPeriodDraft({ from: insumosOverviewFrom, to: insumosOverviewTo })
                    }
                }, [insumosOverviewFrom, insumosOverviewTo])
                const openInsumosMobilePeriodPicker = React.useCallback((open: boolean) => {
                    setInsumosMobilePeriodPickerOpen(open)
                    if (open) {
                        setInsumosMobilePeriodDraft({ from: insumosOverviewFrom, to: insumosOverviewTo })
                    }
                }, [insumosOverviewFrom, insumosOverviewTo])
                const commitInsumosCustomPeriod = React.useCallback((draft: { from: string; to: string }) => {
                    if (!draft.from || !draft.to || draft.from > draft.to) return false
                    setInsumosOverviewPeriod('custom')
                    setInsumosOverviewFrom(draft.from)
                    setInsumosOverviewTo(draft.to)
                    try {
                        localStorage.setItem(INSUMOS_OVERVIEW_PERIOD_KEY, 'custom')
                        localStorage.setItem(INSUMOS_OVERVIEW_FROM_KEY, draft.from)
                        localStorage.setItem(INSUMOS_OVERVIEW_TO_KEY, draft.to)
                    } catch { /* ignore */ }
                    dispatchInsumosHeaderAction({
                        type: 'set-overview',
                        value: { period: 'custom', from: draft.from, to: draft.to },
                    })
                    return true
                }, [])
                const applyInsumosCustomPeriod = React.useCallback(() => {
                    if (commitInsumosCustomPeriod(insumosPeriodDraft)) setInsumosPeriodPickerOpen(false)
                }, [commitInsumosCustomPeriod, insumosPeriodDraft])
                const applyInsumosMobileCustomPeriod = React.useCallback(() => {
                    if (commitInsumosCustomPeriod(insumosMobilePeriodDraft)) setInsumosMobilePeriodPickerOpen(false)
                }, [commitInsumosCustomPeriod, insumosMobilePeriodDraft])
                const renderInsumosPeriodControls = React.useCallback((compact = false) => {
                    const pickerOpen = compact ? insumosMobilePeriodPickerOpen : insumosPeriodPickerOpen
                    const pickerDraft = compact ? insumosMobilePeriodDraft : insumosPeriodDraft
                    const openPicker = compact ? openInsumosMobilePeriodPicker : openInsumosPeriodPicker
                    const closePicker = compact ? setInsumosMobilePeriodPickerOpen : setInsumosPeriodPickerOpen
                    const setPickerDraft = compact ? setInsumosMobilePeriodDraft : setInsumosPeriodDraft
                    const applyPicker = compact ? applyInsumosMobileCustomPeriod : applyInsumosCustomPeriod
                    return (
                    <div className={compact ? 'flex flex-wrap items-center gap-1.5' : 'flex items-center gap-1.5'}>
                        <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] p-1">
                            {INSUMOS_QUICK_PRESETS.map((preset) => (
                                <Tooltip key={preset.key}>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label={preset.label}
                                            title={preset.tooltip}
                                            className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs transition ${
                                                insumosOverviewPeriod === preset.key
                                                    ? 'bg-white/16 text-white'
                                                    : 'text-blue-100/80 hover:bg-white/[0.08] hover:text-white'
                                            }`}
                                            onClick={() => setInsumosQuickPeriod(preset.key)}
                                        >
                                            <span className="inline-flex items-center justify-center opacity-90">{renderAtendimentoQuickPresetIcon(preset.icon)}</span>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-56">
                                        <div className="space-y-1">
                                            <div className="text-[11px] font-medium leading-tight text-white">{preset.tooltip}</div>
                                            <div className="text-[10px] leading-snug text-slate-300/92">{preset.tooltipDescription}</div>
                                        </div>
                                    </TooltipContent>
                                </Tooltip>
                            ))}
                            <DropdownMenu open={pickerOpen} onOpenChange={openPicker}>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                                            insumosCustomPeriodLabel
                                                ? 'bg-white/16 text-white'
                                                : 'text-blue-100/80 hover:bg-white/[0.08] hover:text-white'
                                        }`}
                                        aria-label="Selecionar período personalizado"
                                        title="Selecionar período personalizado"
                                    >
                                        <CalendarX2 className="size-4" aria-hidden="true" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-[22rem] border-slate-700 bg-slate-950/95 p-3 text-slate-100 shadow-2xl backdrop-blur-xl">
                                    <div className="flex items-center justify-between gap-3">
                                        <DropdownMenuLabel className="px-0 text-slate-200">Período personalizado</DropdownMenuLabel>
                                        <button
                                            type="button"
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10 hover:text-white"
                                            aria-label="Fechar seletor de período"
                                            onClick={() => closePicker(false)}
                                        >
                                            <X className="size-4" aria-hidden="true" />
                                        </button>
                                    </div>
                                    <DropdownMenuSeparator className="-mx-3 bg-slate-800" />
                                    <div className="grid gap-3 pt-3">
                                        <div className="space-y-1.5">
                                            <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-slate-500">Atalhos</div>
                                            <div className="grid grid-cols-3 gap-2">
                                                {INSUMOS_PERIOD_PICKER_PRESETS.map((preset) => (
                                                    <button
                                                        key={preset.key}
                                                        type="button"
                                                        aria-label={preset.tooltip}
                                                        className={`rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                                                            insumosOverviewPeriod === preset.key
                                                                ? 'border-sky-300/45 bg-sky-400/12 text-sky-100'
                                                                : 'border-slate-700 bg-slate-900/55 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
                                                        }`}
                                                        onClick={() => setInsumosLegacyPeriod(preset.key)}
                                                    >
                                                        <span className="block font-semibold">{preset.label}</span>
                                                        <span className="mt-0.5 block text-[10px] text-slate-400">{preset.tooltip}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <Input
                                                type="date"
                                                value={pickerDraft.from}
                                                onChange={(event) => setPickerDraft((current) => ({ ...current, from: event.target.value }))}
                                                className="h-8 bg-white/[0.06] border-white/20 text-white"
                                                aria-label="Data inicial"
                                            />
                                            <Input
                                                type="date"
                                                value={pickerDraft.to}
                                                onChange={(event) => setPickerDraft((current) => ({ ...current, to: event.target.value }))}
                                                className="h-8 bg-white/[0.06] border-white/20 text-white"
                                                aria-label="Data final"
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            className="h-8 w-full bg-sky-500/90 text-slate-950 hover:bg-sky-400"
                                            onClick={applyPicker}
                                            disabled={!pickerDraft.from || !pickerDraft.to || pickerDraft.from > pickerDraft.to}
                                        >
                                            Aplicar período
                                        </Button>
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            {insumosCustomPeriodLabel || insumosLegacyPeriodLabel ? (
                                <span className="inline-flex h-7 max-w-48 items-center truncate rounded-full border border-sky-300/35 bg-sky-400/10 px-2.5 text-[11px] font-medium text-sky-100">
                                    {insumosCustomPeriodLabel || insumosLegacyPeriodLabel}
                                </span>
                            ) : null}
                        </div>
                    </div>
                    )
				}, [applyInsumosCustomPeriod, applyInsumosMobileCustomPeriod, insumosCustomPeriodLabel, insumosLegacyPeriodLabel, insumosMobilePeriodDraft.from, insumosMobilePeriodDraft.to, insumosMobilePeriodPickerOpen, insumosOverviewPeriod, insumosPeriodDraft.from, insumosPeriodDraft.to, insumosPeriodPickerOpen, openInsumosMobilePeriodPicker, openInsumosPeriodPicker, setInsumosLegacyPeriod, setInsumosQuickPeriod])
				const renderInsumosQuickOperations = React.useCallback((compact = false) => {
				    const disabled = selectedUnit === INSUMOS_ALL_UNITS
				    const operations: Array<{ value: InsumosQuickOperation; label: string; tone: string; icon: string }> = [
				        { value: 'ENTRADA', label: 'Entrada', tone: 'emerald', icon: '/icons/shortcut-entrada.svg' },
				        { value: 'BAIXA', label: 'Saída', tone: 'rose', icon: '/icons/shortcut-saida.svg' },
				        { value: 'TRANSFERENCIA', label: 'Transferência', tone: 'sky', icon: '/icons/shortcut-transferencia.svg' },
				    ]
				    const toneClasses: Record<string, string> = {
				        emerald: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/45 hover:bg-emerald-500/20',
				        rose: 'border-rose-400/25 bg-rose-500/10 text-rose-100 hover:border-rose-300/45 hover:bg-rose-500/20',
				        sky: 'border-sky-400/25 bg-sky-500/10 text-sky-100 hover:border-sky-300/45 hover:bg-sky-500/20',
				    }
				    return (
				        <div
				            className={`flex items-center gap-1 rounded-xl border border-white/10 bg-slate-950/35 p-1 ${compact ? 'w-fit' : ''}`}
				            role="group"
				            aria-label="Operações rápidas"
				            data-testid="insumos-header-quick-operations"
				        >
				            {!compact ? <span className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-200/55">Operações</span> : null}
				            {operations.map((operation) => (
				                <TooltipButton
				                    key={operation.value}
				                    label={disabled ? 'Selecione uma unidade para operar' : operation.label}
				                    pinOnClick={false}
				                >
				                    <Button
				                        size={compact ? 'icon' : 'sm'}
				                        variant="ghost"
				                        className={`${compact ? 'size-10 rounded-lg' : 'h-8 rounded-lg px-2.5'} gap-1.5 border ${disabled ? 'cursor-not-allowed border-white/10 bg-white/[0.03] text-white/35' : toneClasses[operation.tone]}`}
				                        onClick={() => dispatchInsumosHeaderAction({ type: 'quick-op', value: operation.value })}
				                        disabled={disabled}
				                        aria-label={operation.label}
				                        data-testid={`insumos-header-action-${operation.value.toLowerCase()}`}
				                    >
				                        <img src={operation.icon} alt="" aria-hidden className={compact ? 'size-6' : 'size-4'} />
                        {!compact ? <span className="hidden min-[1360px]:inline">{operation.label}</span> : null}
				                    </Button>
				                </TooltipButton>
				            ))}
				        </div>
				    )
				}, [selectedUnit])
			    const lastInsumosUnitRef = React.useRef<string | null>(null)
			    React.useEffect(() => {
			        if (!insumosMounted) return
			        if (lastInsumosUnitRef.current === effectiveUnit) return
			        lastInsumosUnitRef.current = effectiveUnit
			        dispatchInsumosHeaderAction({ type: 'set-unit', value: effectiveUnit })
			    }, [effectiveUnit, insumosMounted])

                React.useEffect(() => {
                    return subscribeInsumosHeaderState((detail) => {
                        setInsumosHeaderState(detail)
                        setInsumosHeaderStatus(detail?.status || null)
                        setInsumosHeaderEstoque(detail?.stock || null)
                        if (detail?.selectedUnit && detail.selectedUnit !== effectiveUnitRef.current) {
                            setSelectedUnitRef.current(detail.selectedUnit)
                        }
                    })
                }, [])

                React.useEffect(() => {
                    const handler = (event: Event) => {
                        const detail = (event as CustomEvent<ConversaHeaderState | null>)?.detail || null
                        if (!detail || typeof detail !== 'object') {
                            setConversaHeaderState(null)
                            return
                        }
                        setConversaHeaderState(detail)
                    }
                    window.addEventListener('skincos:conversa:header', handler as EventListener)
                    return () => window.removeEventListener('skincos:conversa:header', handler as EventListener)
                }, [])

                React.useEffect(() => {
                    return subscribeAtendimentoHeaderState((detail) => {
                        setAtendimentoHeaderState(detail)
                    })
                }, [])

                const dispatchConversaHeaderAction = React.useCallback((action: string) => {
                    try {
                        window.dispatchEvent(new CustomEvent('skincos:conversa:header-action', { detail: { action } }))
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
	        // The local auth bootstrap can mount the console before the user role
	        // is resolved. Re-apply the explicit URL module once it is ready so
	        // `?module=ponto` never falls back to the previously saved module.
	        if (initializing) return
	        try {
		    if (parseClientesWorkspaceRoute(window.location)) {
		        setActive('clientes')
		        return
		    }
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
	    }, [financeEnabled, initializing])

	    // Save active module selection
	    React.useEffect(() => {
	        try { localStorage.setItem('app.activeModule', active) } catch { /* ignore */ }
	    }, [active])

				    React.useEffect(() => {
				        if (active !== 'insumos' || !isAuthenticated) {
				            setInsumosHeaderState(null)
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

    const maintenanceModuleKeys = useMemo(configuredMaintenanceModuleKeys, [])
    const moduleAccessContext = useMemo(() => ({ role: roleKey, allowedModules: user?.allowedModules, enabledModuleKeys: UNLOCKED_MODULE_KEYS, maintenanceModuleKeys, financeEnabled }), [UNLOCKED_MODULE_KEYS, financeEnabled, maintenanceModuleKeys, roleKey, user?.allowedModules])
    const activeModuleManifest = crmModuleByKey.get(active)
    const activeModuleAvailability = activeModuleManifest ? moduleAvailability(activeModuleManifest, moduleAccessContext) : { available: false, state: 'unreleased' as const, reason: 'O módulo solicitado não está registrado.' }
    const availableModuleKeys = useMemo(
        () => crmModuleRegistry
            .filter((manifest) => permittedUnlockedModules.some((entry) => entry.key === manifest.key))
            .filter((manifest) => moduleAvailability(manifest, moduleAccessContext).available)
            .map((manifest) => manifest.key),
        [moduleAccessContext, permittedUnlockedModules],
    )

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
                        role="complementary"
                        aria-label="Navegação principal do CRM"
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
	                                    const isLocked = !moduleAvailability(m, moduleAccessContext).available
	                                    const isActive = active === m.key
	                                    return (
                                        <TooltipLabel key={m.key} label={m.label} description={isLocked ? 'Módulo em breve.' : undefined}>
                                            <button
                                                onPointerDown={() => {
                                                    if (isLocked) return
                                                    selectModule(m.key)
                                                }}
                                                onClick={() => {
                                                    if (isLocked) return
                                                    selectModule(m.key)
                                                }}
                                                disabled={isLocked}
                                                aria-disabled={isLocked}
                                                aria-label={m.label}
                                                data-module-nav="true"
                                                data-module-key={m.key}
                                                data-module-label={m.label}
                                                data-module-active={isActive ? 'true' : 'false'}
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
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
	                        {/* Premium Header */}
			                        <header className="glass-morphism border-b border-white/10 backdrop-blur-xl px-8 py-5">
			                            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3" data-testid="crm-header-layout">
				                                <div className={`flex min-w-0 flex-wrap items-center gap-4 ${active === 'users' ? 'flex-1' : ''}`}>
					                                    <div className="shrink-0 animate-fade-in">
					                                        <h1 className={`whitespace-nowrap font-bold text-white leading-tight ${active === 'insumos' ? 'text-xl' : 'text-2xl'}`}>
					                                            {modules.find(m => m.key === active)?.label || 'Painel'}
					                                        </h1>
			                                    </div>
				                                    <div className="w-px h-8 bg-white/20 hidden lg:block"></div>
                                    <div className={`${active === 'escala-profissionais' || active === 'meta-ads' || active === 'site-tracking' || active === 'atendimento' || active === 'users' ? 'flex min-w-0' : 'hidden lg:flex'} ${active === 'users' ? 'ml-auto' : ''} items-center gap-2`}>
                                        {active === 'users' ? (
                                            <div className="flex min-w-0 items-center justify-end gap-2">
                                                <span className="hidden min-w-0 max-w-[34rem] flex-1 truncate text-xs text-blue-100/70 md:block">
                                                    Identidade, equipe e convites sob o mesmo cadastro; senhas são criadas pelo próprio funcionário.
                                                </span>
                                                <TooltipButton label="Atualizar usuários">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-9 w-9 rounded-full border border-white/15 bg-white/[0.06] text-blue-50 shadow-sm hover:bg-white/[0.12]"
                                                        aria-label="Atualizar usuários"
                                                        onClick={() => {
                                                            window.dispatchEvent(new CustomEvent('skincos:users:header-action', { detail: { action: 'refresh' } }))
                                                        }}
                                                    >
                                                        <RefreshCw className="size-3.5" aria-hidden="true" />
                                                    </Button>
                                                </TooltipButton>
                                                <TooltipButton label="Cadastrar funcionário">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-9 w-9 rounded-full border border-white/15 bg-white/[0.06] text-blue-50 shadow-sm hover:bg-white/[0.12]"
                                                        aria-label="Cadastrar funcionário"
                                                        disabled={!usersCanManage}
                                                        onClick={() => {
                                                            window.dispatchEvent(new CustomEvent('skincos:users:header-action', { detail: { action: 'create' } }))
                                                        }}
                                                    >
                                                        <Plus className="size-3.5" aria-hidden="true" />
                                                    </Button>
                                                </TooltipButton>
                                            </div>
                                        ) : null}
                                        {active === 'insumos' ? (
					                                            <>
					                                                <Select
					                                                    value={selectedUnit}
			                                                    onValueChange={(v) => setSelectedUnit(v)}
			                                                >
                                                    <SelectTrigger className="h-8 w-44 bg-white/[0.06] border-white/20 text-white">
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
                                                                    {renderInsumosPeriodControls()}
				                                                    {renderInsumosQuickOperations()}
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
                                                            <div className="flex min-w-0 items-center gap-2">
                                                                <div className="flex h-10 min-w-[18rem] max-w-[min(26rem,42vw)] flex-1 items-stretch overflow-hidden rounded-xl border border-white/20 bg-white/[0.06] text-white">
                                                                    <Select
                                                                        value={siteTrackingHeaderState?.selectedSiteId || ''}
                                                                        onValueChange={(value) => {
                                                                            if (value === '__site_tracking_add_connection__') {
                                                                                dispatchSiteTrackingHeaderAction({ type: 'connect' })
                                                                                return
                                                                            }
                                                                            dispatchSiteTrackingHeaderAction({ type: 'set-site', value })
                                                                        }}
                                                                        disabled={siteTrackingHeaderState?.refreshing}
                                                                    >
                                                                        <SelectTrigger className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 text-white shadow-none focus-visible:ring-0">
                                                                            <div className="flex min-w-0 flex-1 flex-col items-start justify-center text-left leading-none">
                                                                                <span className="w-full truncate text-[15px] font-semibold text-white">
                                                                                    {siteTrackingSelectedSite?.name || siteTrackingHeaderState?.selectedSiteName || 'Selecione um site'}
                                                                                </span>
                                                                                <span className="mt-1 w-full truncate text-[11px] font-medium text-slate-400">
                                                                                    {siteTrackingSelectedSite?.statusLabel || siteTrackingSelectedSite?.host || 'Sem conexão selecionada'}
                                                                                </span>
                                                                            </div>
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
                                                                                            action={
                                                                                                <button
                                                                                                    type="button"
                                                                                                    className="inline-flex size-6 items-center justify-center rounded-md text-cyan-100/70 transition hover:bg-cyan-400/15 hover:text-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                                                                                                    aria-label={`Renomear ${site.name || site.host || site.id}`}
                                                                                                    title="Renomear site"
                                                                                                    onPointerDown={(event) => {
                                                                                                        event.preventDefault()
                                                                                                        event.stopPropagation()
                                                                                                    }}
                                                                                                    onClick={(event) => {
                                                                                                        event.preventDefault()
                                                                                                        event.stopPropagation()
                                                                                                        dispatchSiteTrackingHeaderAction({ type: 'rename-site', value: site.id })
                                                                                                    }}
                                                                                                >
                                                                                                    <Pencil className="size-3.5" aria-hidden="true" />
                                                                                                </button>
                                                                                            }
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
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                            </div>
                                                        ) : null}
                                                        {active === 'atendimento' ? (
                                                            <div className="flex min-w-0 items-center gap-2" data-testid="atendimento-filters">
                                                                <Select
                                                                    value={atendimentoHeaderState?.filters.unit || 'all'}
                                                                    onValueChange={(value) => dispatchAtendimentoHeaderAction({ type: 'set-filter', patch: { unit: value } })}
                                                                >
                                                                    <SelectTrigger className="h-8 w-56 shrink-0 bg-white/[0.06] border-white/20 text-white">
                                                                        <SelectValue placeholder="Unidade" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="all">Todas unidades</SelectItem>
                                                                        {(atendimentoHeaderState?.units || []).map((unit) => (
                                                                            <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        ) : null}
			                                    </div>
		                                </div>

		                                <div className={`ml-auto flex min-w-0 items-center justify-end ${active === 'insumos' ? 'gap-2' : 'gap-4'}`} data-testid="crm-header-actions">
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
                                        <div className="flex shrink-0 items-center gap-1.5">
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
                                                <TooltipContent className="max-w-80">
                                                    <div className="space-y-1">
                                                        <div className="text-[11px] font-medium leading-tight text-white">Atualizar painel do Site EF</div>
                                                        {siteTrackingHeaderState?.dataSourceLabel || siteTrackingHeaderState?.updatedAt || siteTrackingHeaderState?.dataSiteHost ? (
                                                            <div className="space-y-0.5 text-[10px] leading-snug text-slate-300/92">
                                                                {siteTrackingHeaderState?.dataSourceLabel ? <div>Fonte: {siteTrackingHeaderState.dataSourceLabel}</div> : null}
                                                                <div>Janela: {siteTrackingHeaderState?.windowDays || 30} dias</div>
                                                                {siteTrackingHeaderState?.updatedAt ? <div>Atualizado: {new Date(siteTrackingHeaderState.updatedAt).toLocaleString('pt-BR')}</div> : null}
                                                                {siteTrackingHeaderState?.dataSiteHost ? <div>Site: {siteTrackingHeaderState.dataSiteHost}</div> : null}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    ) : null}
                                    {active === 'atendimento' ? (
                                        <div className="flex items-center gap-1.5 max-w-[58vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                            <div className="flex shrink-0 items-center gap-1.5">
                                                <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] p-1">
                                                    {ATENDIMENTO_QUICK_PRESETS.map((preset) => (
                                                        preset.icon ? (
                                                            <React.Fragment key={preset.key}>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <button
                                                                        type="button"
                                                                        aria-label={preset.tooltip}
                                                                        title={preset.tooltip}
                                                                        className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-xs transition ${
                                                                            atendimentoQuickWindow === preset.key
                                                                                ? 'bg-white/16 text-white'
                                                                                : 'text-blue-100/80 hover:bg-white/[0.08] hover:text-white'
                                                                        }`}
                                                                        onClick={() => setAtendimentoQuickWindow(preset.key)}
                                                                    >
                                                                        <span className="inline-flex items-center justify-center opacity-90">{renderAtendimentoQuickPresetIcon(preset.icon)}</span>
                                                                    </button>
                                                                </TooltipTrigger>
                                                                <TooltipContent className="max-w-56">
                                                                    <div className="space-y-1">
                                                                        <div className="text-[11px] font-medium leading-tight text-white">{preset.tooltip}</div>
                                                                        <div className="text-[10px] leading-snug text-slate-300/92">{preset.tooltipDescription}</div>
                                                                    </div>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                            {atendimentoQuickWindow === preset.key && atendimentoOperationalPeriodLabel ? (
                                                                <span
                                                                    className="inline-flex h-7 animate-in fade-in-0 zoom-in-95 items-center rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2.5 text-[11px] font-medium text-emerald-100 duration-200"
                                                                    data-testid="atendimento-operational-period-label"
                                                                >
                                                                    {atendimentoOperationalPeriodLabel}
                                                                </span>
                                                            ) : null}
                                                            </React.Fragment>
                                                        ) : null
                                                    ))}
                                                    <DropdownMenu open={atendimentoPeriodPickerOpen} onOpenChange={openAtendimentoPeriodPicker}>
                                                        <DropdownMenuTrigger asChild>
                                                            <button
                                                                type="button"
                                                                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                                                                    atendimentoCustomPeriodLabel
                                                                        ? 'bg-white/16 text-white'
                                                                        : 'text-blue-100/80 hover:bg-white/[0.08] hover:text-white'
                                                                }`}
                                                                aria-label="Selecionar período personalizado"
                                                                title="Selecionar período personalizado"
                                                            >
                                                                <CalendarX2 className="size-4" aria-hidden="true" />
                                                            </button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="w-[22rem] border-slate-700 bg-slate-950/95 p-3 text-slate-100 shadow-2xl backdrop-blur-xl">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <DropdownMenuLabel className="px-0 text-slate-200">Período personalizado</DropdownMenuLabel>
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10 hover:text-white"
                                                                    aria-label="Fechar seletor de período"
                                                                    onClick={() => setAtendimentoPeriodPickerOpen(false)}
                                                                >
                                                                    <X className="size-4" aria-hidden="true" />
                                                                </button>
                                                            </div>
                                                            <DropdownMenuSeparator className="-mx-3 bg-slate-800" />
                                                            <div className="grid gap-3 pt-3">
                                                                <div className="space-y-1.5">
                                                                    <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-slate-500">Atalhos</div>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        {ATENDIMENTO_PERIOD_PICKER_PRESETS.map((preset) => (
                                                                            <button
                                                                                key={preset.key}
                                                                                type="button"
                                                                                aria-label={preset.tooltip}
                                                                                className={`rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                                                                                    atendimentoQuickWindow === preset.key
                                                                                        ? 'border-sky-300/45 bg-sky-400/12 text-sky-100'
                                                                                        : 'border-slate-700 bg-slate-900/55 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
                                                                                }`}
                                                                                onClick={() => {
                                                                                    setAtendimentoQuickWindow(preset.key)
                                                                                    setAtendimentoPeriodPickerOpen(false)
                                                                                }}
                                                                            >
                                                                                <span className="block font-semibold">{preset.label}</span>
                                                                                <span className="mt-0.5 block text-[10px] text-slate-400">{preset.tooltip}</span>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    <Input
                                                                        type="date"
                                                                        value={atendimentoPeriodDraft.from}
                                                                        onChange={(event) => setAtendimentoPeriodDraft((current) => ({ ...current, from: event.target.value }))}
                                                                        className="h-8 bg-white/[0.06] border-white/20 text-white"
                                                                        aria-label="Data inicial"
                                                                    />
                                                                    <Input
                                                                        type="date"
                                                                        value={atendimentoPeriodDraft.to}
                                                                        onChange={(event) => setAtendimentoPeriodDraft((current) => ({ ...current, to: event.target.value }))}
                                                                        className="h-8 bg-white/[0.06] border-white/20 text-white"
                                                                        aria-label="Data final"
                                                                    />
                                                                </div>
                                                                <Button
                                                                    type="button"
                                                                    className="h-8 w-full bg-sky-500/90 text-slate-950 hover:bg-sky-400"
                                                                    onClick={applyAtendimentoCustomPeriod}
                                                                    disabled={!atendimentoPeriodDraft.from || !atendimentoPeriodDraft.to || atendimentoPeriodDraft.from > atendimentoPeriodDraft.to}
                                                                >
                                                                    Aplicar período
                                                                </Button>
                                                            </div>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                    {atendimentoCustomPeriodLabel ? (
                                                        <span
                                                            className="inline-flex h-7 animate-in fade-in-0 zoom-in-95 items-center rounded-full border border-sky-300/35 bg-sky-400/10 px-2.5 text-[11px] font-medium text-sky-100 duration-200"
                                                            data-testid="atendimento-custom-period-label"
                                                        >
                                                            {atendimentoCustomPeriodLabel}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <TooltipButton label={atendimentoLayoutLabel} pinOnClick={false}>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-8 w-8 rounded-full border border-white/15 bg-white/[0.06] text-blue-50 hover:bg-white/[0.12]"
                                                        onClick={() => dispatchAtendimentoHeaderAction({ type: 'layout', value: atendimentoLayoutExpanded ? 'collapseAll' : 'expandAll' })}
                                                        aria-label={atendimentoLayoutLabel}
                                                        data-testid="atendimento-header-layout-toggle"
                                                    >
                                                        <ChevronsUpDown className="size-3.5" aria-hidden="true" />
                                                    </Button>
                                                </TooltipButton>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 rounded-full border border-white/15 bg-white/[0.06] text-blue-50 hover:bg-white/[0.12]"
                                                            onClick={() => dispatchAtendimentoHeaderAction({ type: 'refresh' })}
                                                            disabled={atendimentoHeaderState?.loading}
                                                            aria-label="Atualizar Atendimento"
                                                            data-testid="atendimento-header-refresh"
                                                        >
                                                            <RefreshCw className={`size-3.5 ${atendimentoHeaderState?.loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent className="max-w-72">
                                                        <div className="space-y-1">
                                                            <div className="text-[11px] font-medium leading-tight text-white">Atualizar Atendimento</div>
                                                            <div className="space-y-0.5 text-[10px] leading-snug text-slate-300/92">
                                                                <div>Status: {atendimentoHeaderState?.loading ? 'Atualizando dados' : 'Dados carregados'}</div>
                                                                <div>Unidade: {atendimentoHeaderState?.activeUnitLabel || 'Todas unidades'}</div>
                                                                <div>Período: {atendimentoHeaderState?.periodLabel || 'Todos os períodos'}</div>
                                                                <div>Listagem: {Number(atendimentoHeaderState?.total || 0).toLocaleString('pt-BR')} linhas</div>
                                                                <div>Último import: {atendimentoHeaderState?.latestImportLabel || 'Sem import recente'}</div>
                                                                {atendimentoHeaderState?.localMirrorSummary ? <div>Base local: {atendimentoHeaderState.localMirrorSummary}</div> : null}
                                                                {atendimentoHeaderState?.localMirrorDetail ? <div>{atendimentoHeaderState.localMirrorDetail}</div> : null}
                                                            </div>
                                                        </div>
                                                    </TooltipContent>
                                                </Tooltip>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 rounded-full border border-white/15 bg-white/[0.06] text-blue-50 hover:bg-white/[0.12]"
                                                            aria-label="Importar / exportar Atendimento"
                                                            title="Importar / exportar"
                                                            data-testid="atendimento-header-import-export"
                                                        >
                                                            <ArrowDownUp className="size-3.5" aria-hidden="true" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-56 border-slate-700 bg-slate-950/95 p-1.5 text-slate-100 shadow-2xl backdrop-blur-xl">
                                                        <DropdownMenuLabel className="px-2 py-1.5 text-[11px] uppercase tracking-[0.12em] text-slate-400">Importar / exportar</DropdownMenuLabel>
                                                        <DropdownMenuSeparator className="bg-slate-800" />
                                                        <DropdownMenuItem
                                                            onSelect={() => dispatchAtendimentoHeaderAction({ type: 'report' })}
                                                            data-testid="atendimento-header-report"
                                                            className="text-slate-100 focus:bg-white/10 focus:text-white"
                                                        >
                                                            <Download className="size-4" aria-hidden="true" />
                                                            Exportar relatório
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onSelect={() => dispatchAtendimentoHeaderAction({ type: 'open-import' })}
                                                            disabled={!atendimentoHeaderState?.canManage}
                                                            data-testid="atendimento-header-import"
                                                            className="text-slate-100 focus:bg-white/10 focus:text-white"
                                                        >
                                                            <Upload className="size-4" aria-hidden="true" />
                                                            Importar Gerência
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </div>
                                    ) : null}
                                    {active === 'conversa' ? (
                                        <div className="flex items-center gap-1.5 max-w-[58vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className={`h-7 rounded-full border px-2.5 text-xs ${conversaHeaderState?.whatsappConnected ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100' : 'border-white/15 bg-white/5 text-blue-100/80'}`}
                                                onClick={() => dispatchConversaHeaderAction('wa')}
                                            >
                                                WhatsApp {conversaHeaderState?.connectedWhatsapps ?? 0}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className={`h-7 rounded-full border px-2.5 text-xs ${conversaHeaderState?.instagramConnected ? 'border-pink-400/40 bg-pink-500/15 text-pink-100' : 'border-white/15 bg-white/5 text-blue-100/80'}`}
                                                onClick={() => dispatchConversaHeaderAction('ig')}
                                            >
                                                Instagram
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className={`h-7 rounded-full border px-2.5 text-xs ${conversaHeaderState?.facebookConfigured ? 'border-blue-400/40 bg-blue-500/15 text-blue-100' : 'border-white/15 bg-white/5 text-blue-100/80'}`}
                                                onClick={() => dispatchConversaHeaderAction('fb')}
                                            >
                                                Facebook
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 rounded-full border border-sky-400/40 bg-sky-500/15 px-2.5 text-xs text-sky-100"
                                                onClick={() => dispatchConversaHeaderAction('tickets-total')}
                                            >
                                                Total {conversaHeaderState?.supportStats?.totalTickets ?? 0}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 text-xs text-amber-100"
                                                onClick={() => dispatchConversaHeaderAction('tickets-open')}
                                            >
                                                Abertos {conversaHeaderState?.supportStats?.openWithin24 ?? 0}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 rounded-full border border-rose-400/40 bg-rose-500/15 px-2.5 text-xs text-rose-100"
                                                onClick={() => dispatchConversaHeaderAction('tickets-overdue')}
                                            >
                                                Atrasados {conversaHeaderState?.supportStats?.overdueTickets ?? 0}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 text-xs text-emerald-100"
                                                onClick={() => dispatchConversaHeaderAction('tickets-resolved')}
                                            >
                                                Resolvidos {conversaHeaderState?.supportStats?.resolvedTickets ?? 0}
                                            </Button>
                                            <span className="inline-flex h-7 items-center rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 text-xs text-violet-100">
                                                Satisfação {Number(conversaHeaderState?.supportStats?.avgSatisfaction || 0).toFixed(1)}
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
                                                    <TooltipButton label={insumosLayoutLabel} pinOnClick={false}>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-9 w-9 rounded-full border border-white/15 bg-white/[0.06] text-blue-50 hover:bg-white/[0.12]"
                                                            onClick={() => dispatchInsumosHeaderAction({ type: 'layout', value: insumosLayoutExpanded ? 'collapseAll' : 'expandAll' })}
                                                            aria-label={insumosLayoutLabel}
                                                            data-testid="insumos-header-layout-toggle"
                                                        >
                                                            <ChevronsUpDown className="size-3.5" aria-hidden="true" />
                                                        </Button>
                                                    </TooltipButton>
                                                    <TooltipButton label="Atualizar dados de estoque" pinOnClick={false}>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-9 w-9 rounded-full border border-white/15 bg-white/[0.06] text-blue-50 hover:bg-white/[0.12]"
                                                            onClick={() => dispatchInsumosHeaderAction({ type: 'reload-overview' })}
                                                            disabled={insumosHeaderEstoque?.loading}
                                                            aria-label="Atualizar dados de estoque"
                                                            data-testid="insumos-header-refresh"
                                                        >
                                                            <RefreshCw className={`size-3.5 ${insumosHeaderEstoque?.loading ? 'animate-spin' : ''}`} aria-hidden="true" />
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
	                                    {renderInsumosPeriodControls(true)}

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
	                                        {renderInsumosQuickOperations(true)}
	                                    </div>
	                                </div>
	                            ) : null}
                        </header>

                        {/* Premium Main Content */}
                        <main className={`relative min-w-0 flex-1 p-4 sm:p-8 ${active === 'conversa' ? 'flex min-h-0 flex-col overflow-hidden' : active === 'site-tracking' ? 'overflow-x-hidden overflow-y-auto' : 'overflow-auto'} ${active === 'meta-ads' ? 'meta-ads-main' : ''} ${active === 'atendimento' ? 'atendimento-main' : ''}`}>
                            {/* Content Background */}
                            <div className={`absolute inset-0 ${active === 'meta-ads' ? 'meta-ads-main-bg' : active === 'atendimento' ? 'atendimento-main-bg' : 'bg-white/[0.02] backdrop-blur-sm'}`}></div>

                            <div className={`relative z-10 min-w-0 ${active === 'conversa' ? 'flex h-full min-h-0 flex-col' : active === 'site-tracking' ? 'max-w-full overflow-x-hidden' : ''}`}>
                                <div className="hidden">{search}</div>
                                <div className={`animate-fade-in ${active === 'conversa' ? 'flex h-full min-h-0 flex-col' : ''}`}>
                                    {activeModuleManifest ? <div className={active === 'conversa' ? 'h-full min-h-0' : active === 'site-tracking' ? 'min-w-0 max-w-full overflow-x-hidden' : undefined}><ModuleHost manifest={activeModuleManifest} availability={activeModuleAvailability} onReturnToNavigation={() => selectModule(active === DEFAULT_MODULE_KEY ? (availableModuleKeys.find((key) => key !== active) || DEFAULT_MODULE_KEY) : DEFAULT_MODULE_KEY)} /></div> : null}
                                </div>
                                <ContextDebugger />
                            </div>
                        </main>
                    </div>
                </div>
            </div>
        </NotificationProvider>
    )
}
