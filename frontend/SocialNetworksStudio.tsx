import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Input } from '@/input'
import { Textarea } from '@/textarea'
import { Label } from '@/label'
import { Badge } from '@/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Checkbox } from '@/checkbox'
import { toast } from 'sonner'
import { InstagramStudioPro } from '@/InstagramStudioPro'
import { ThreadsStudio } from '@/ThreadsStudio'
import { csrfHeader } from '@/csrf'
import { LoadingPercentText } from '@/LoadingPattern'

type SocialPlatform = 'instagram' | 'facebook' | 'threads'

type SetupStatus = {
  ok?: boolean
  user?: { username?: string; displayName?: string; email?: string; role?: string; allowedUnits?: string[] }
  r2?: { bucketConfigured?: boolean; effectiveKeyPrefix?: string }
  encryption?: { required?: boolean; configured?: boolean }
  admin?: { isAdmin?: boolean; role?: string }
  socialDefaults?: { defaultUnitsFromEnv?: string[] }
}

type QueueGroup = {
  group: {
    dateKey: string
    groupKey: string
    scheduledAt: string
    unitKeys: string[]
    platforms: SocialPlatform[]
    captions?: Partial<Record<SocialPlatform, string>>
  }
  assetsCount: number
  published: Record<string, Record<SocialPlatform, boolean>>
}

const PLATFORM_ORDER: SocialPlatform[] = ['instagram', 'facebook', 'threads']

function mapUserUnitToSocialUnitKey(unit: string): string | null {
  const raw = String(unit || '').trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  if (upper === 'BSS' || upper === 'NH') return upper
  const lower = raw.toLowerCase()
  if (lower === 'barra-shopping-sul') return 'BSS'
  if (lower === 'novo-hamburgo') return 'NH'
  return null
}

export function SocialNetworksStudio() {
  const [tab, setTab] = useState<'planner' | 'instagram' | 'facebook' | 'threads'>('planner')

  const SOCIAL_UNIT_KEY_STORAGE = 'social.unitKey'
  const SOCIAL_ONLY_MY_UNIT_STORAGE = 'social.onlyMyUnit'
  const SOCIAL_ONBOARDING_SCOPE_UNITS_STORAGE = 'social.onboarding.scopeUnits'
  const SOCIAL_ONBOARDING_SCOPE_PLATFORMS_STORAGE = 'social.onboarding.scopePlatforms'
  const SOCIAL_ONBOARDING_COMPLETED_STORAGE = 'social.onboarding.completed'
  const SOCIAL_ONBOARDING_COMPLETED_AT_STORAGE = 'social.onboarding.completedAt'

  const parseCsvList = (raw: string | null | undefined) =>
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const toCsvList = (items: Array<string | null | undefined>) => items.map((s) => String(s || '').trim()).filter(Boolean).join(',')

  const [unitKey, setUnitKey] = useState(() => {
    try {
      return window.localStorage.getItem(SOCIAL_UNIT_KEY_STORAGE) || 'BSS'
    } catch {
      return 'BSS'
    }
  })
  const [unitKeyWasSaved] = useState(() => {
    try {
      return !!window.localStorage.getItem(SOCIAL_UNIT_KEY_STORAGE)
    } catch {
      return false
    }
  })
  const setUnitKeyPersist = (next: string) => {
    setUnitKey(next)
    try {
      window.localStorage.setItem(SOCIAL_UNIT_KEY_STORAGE, next)
    } catch {}
  }

  const [onlyMyUnit, setOnlyMyUnit] = useState(() => {
    try {
      return window.localStorage.getItem(SOCIAL_ONLY_MY_UNIT_STORAGE) === 'true'
    } catch {
      return false
    }
  })
  const setOnlyMyUnitPersist = (next: boolean) => {
    setOnlyMyUnit(next)
    try {
      window.localStorage.setItem(SOCIAL_ONLY_MY_UNIT_STORAGE, String(next))
    } catch {}
  }

  const [scopeUnitsWasSaved] = useState(() => {
    try {
      return !!window.localStorage.getItem(SOCIAL_ONBOARDING_SCOPE_UNITS_STORAGE)
    } catch {
      return false
    }
  })
  const [scopePlatformsWasSaved] = useState(() => {
    try {
      return !!window.localStorage.getItem(SOCIAL_ONBOARDING_SCOPE_PLATFORMS_STORAGE)
    } catch {
      return false
    }
  })

  const [scopeUnits, setScopeUnits] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(SOCIAL_ONBOARDING_SCOPE_UNITS_STORAGE)
      const parsed = parseCsvList(raw).map((s) => s.toUpperCase())
      return parsed.length ? parsed : ['BSS', 'NH']
    } catch {
      return ['BSS', 'NH']
    }
  })
  const setScopeUnitsPersist = (next: string[]) => {
    const cleaned = next.map((u) => String(u || '').trim().toUpperCase()).filter(Boolean)
    setScopeUnits(cleaned)
    try {
      window.localStorage.setItem(SOCIAL_ONBOARDING_SCOPE_UNITS_STORAGE, toCsvList(cleaned))
    } catch {}
  }

  const [scopePlatforms, setScopePlatforms] = useState<SocialPlatform[]>(() => {
    try {
      const raw = window.localStorage.getItem(SOCIAL_ONBOARDING_SCOPE_PLATFORMS_STORAGE)
      const parsed = parseCsvList(raw) as SocialPlatform[]
      const cleaned = parsed.filter((p) => PLATFORM_ORDER.includes(p))
      return cleaned.length ? cleaned : [...PLATFORM_ORDER]
    } catch {
      return [...PLATFORM_ORDER]
    }
  })
  const setScopePlatformsPersist = (next: SocialPlatform[]) => {
    const cleaned = next.filter((p) => PLATFORM_ORDER.includes(p))
    setScopePlatforms(cleaned)
    try {
      window.localStorage.setItem(SOCIAL_ONBOARDING_SCOPE_PLATFORMS_STORAGE, toCsvList(cleaned))
    } catch {}
  }

  const [onboardingCompleted, setOnboardingCompleted] = useState(() => {
    try {
      return window.localStorage.getItem(SOCIAL_ONBOARDING_COMPLETED_STORAGE) === 'true'
    } catch {
      return false
    }
  })
  const setOnboardingCompletedPersist = (next: boolean) => {
    setOnboardingCompleted(next)
    try {
      if (next) {
        window.localStorage.setItem(SOCIAL_ONBOARDING_COMPLETED_STORAGE, 'true')
        window.localStorage.setItem(SOCIAL_ONBOARDING_COMPLETED_AT_STORAGE, new Date().toISOString())
      } else {
        window.localStorage.removeItem(SOCIAL_ONBOARDING_COMPLETED_STORAGE)
        window.localStorage.removeItem(SOCIAL_ONBOARDING_COMPLETED_AT_STORAGE)
      }
    } catch {}
  }

  const [platforms, setPlatforms] = useState<SocialPlatform[]>(['instagram', 'facebook', 'threads'])
  const [scheduledAtLocal, setScheduledAtLocal] = useState<string>('')
  const [files, setFiles] = useState<File[]>([])
  const [captionInstagram, setCaptionInstagram] = useState('')
  const [captionFacebook, setCaptionFacebook] = useState('')
  const [captionThreads, setCaptionThreads] = useState('')
  const [uploading, setUploading] = useState(false)

  const [dateKey, setDateKey] = useState(() => {
    const d = new Date()
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yy = String(d.getFullYear()).slice(-2)
    return `${dd}${mm}${yy}`
  })
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueGroups, setQueueGroups] = useState<QueueGroup[]>([])
  const [queueResults, setQueueResults] = useState<Record<string, Record<string, any>>>({})
  const [queueResultsLoading, setQueueResultsLoading] = useState<Record<string, boolean>>({})
  const [queueJobIds, setQueueJobIds] = useState<Record<string, string>>({})
  const [queueJobStatus, setQueueJobStatus] = useState<Record<string, string>>({})

  const [setupLoading, setSetupLoading] = useState(false)
  const [setup, setSetup] = useState<SetupStatus | null>(null)
  const [setupAuthed, setSetupAuthed] = useState<boolean | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)

  const [metricsLoading, setMetricsLoading] = useState(false)
  const [lastJobsRun, setLastJobsRun] = useState<any | null>(null)
  const [lastJobsRunError, setLastJobsRunError] = useState<string | null>(null)

  const [accountsLoadedOnce, setAccountsLoadedOnce] = useState(false)
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accounts, setAccounts] = useState<
    Array<{ unitKey: string; platform: SocialPlatform; accountId: string; apiVersion?: string; apiBase?: string; updatedAt?: string }>
  >([])
  const [autoTriedAccounts, setAutoTriedAccounts] = useState(false)

  const [accountUnit, setAccountUnit] = useState(() => {
    try {
      return window.localStorage.getItem(SOCIAL_UNIT_KEY_STORAGE) || 'BSS'
    } catch {
      return 'BSS'
    }
  })
  const [accountPlatform, setAccountPlatform] = useState<SocialPlatform>('instagram')
  const [accountId, setAccountId] = useState('')
  const [accountToken, setAccountToken] = useState('')
  const [accountApiVersion, setAccountApiVersion] = useState('v20.0')

  type UnitKey = 'BSS' | 'NH'
  const unitOptions = useMemo<UnitKey[]>(() => ['BSS', 'NH'], [])
  const detectedRole = String(setup?.admin?.role || setup?.user?.role || '')
    .trim()
    .toUpperCase()

  const refreshSetup = async (opts: { silent?: boolean } = {}) => {
    setSetupLoading(true)
    try {
      const res = await fetch('/api/social/setup/status', { credentials: 'include' })
      if (res.status === 401) {
        setSetupAuthed(false)
        setSetup(null)
        setSetupError('Faça login no CRM para usar este módulo.')
        return false
      }
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setSetupAuthed(true)
      setSetup((data || null) as SetupStatus)
      setSetupError(null)
      return true
    } catch (e: any) {
      setSetupAuthed(null)
      setSetup(null)
      const msg = e?.message || 'Falha ao carregar status de configuração'
      setSetupError(msg)
      if (!opts.silent) toast.error(msg)
      return false
    } finally {
      setSetupLoading(false)
    }
  }

  const refreshQueue = async (dk = dateKey) => {
    setQueueLoading(true)
    try {
      const res = await fetch(`/api/social/queue/list?dateKey=${encodeURIComponent(dk)}`, { credentials: 'include' })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setQueueGroups((data?.groups || []) as QueueGroup[])
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao carregar fila')
      setQueueGroups([])
    } finally {
      setQueueLoading(false)
    }
  }

  const refreshLastJobsRun = async (opts: { silent?: boolean } = {}) => {
    setMetricsLoading(true)
    setLastJobsRunError(null)
    try {
      const res = await fetch('/api/social/metrics/last-jobs-run', { credentials: 'include' })
      const data = (await res.json().catch(() => null)) as any
      if (res.status === 404) {
        setLastJobsRun(null)
        setLastJobsRunError(data?.hint || 'Métricas não encontradas.')
        return false
      }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setLastJobsRun(data?.metrics || null)
      return true
    } catch (e: any) {
      const msg = e?.message || 'Falha ao carregar métricas'
      setLastJobsRun(null)
      setLastJobsRunError(msg)
      if (!opts.silent) toast.error(msg)
      return false
    } finally {
      setMetricsLoading(false)
    }
  }

  const loadResults = async (g: QueueGroup) => {
    const key = `${g.group.dateKey}:${g.group.groupKey}`
    setQueueResultsLoading((prev) => ({ ...prev, [key]: true }))
    try {
      const res = await fetch(`/api/social/results?dateKey=${encodeURIComponent(g.group.dateKey)}&groupKey=${encodeURIComponent(g.group.groupKey)}`, {
        credentials: 'include',
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setQueueResults((prev) => ({ ...prev, [key]: data?.results || {} }))
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao carregar resultados')
    } finally {
      setQueueResultsLoading((prev) => ({ ...prev, [key]: false }))
    }
  }

  const refreshAccounts = async (opts: { silent?: boolean } = {}) => {
    setAccountsLoading(true)
    try {
      const res = await fetch('/api/social/admin/accounts', {
        credentials: 'include',
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) {
        if (res.status === 403 && data?.code === 'ADMIN_REQUIRED') {
          throw new Error(data?.hint || 'Permissão insuficiente: este módulo exige GESTOR/GERENTE.')
        }
        if (res.status === 403 && data?.code === 'CSRF_INVALID') {
          throw new Error('Sessão inválida: recarregue a página e faça login novamente.')
        }
        if (res.status === 403 && data?.code === 'ORIGIN_INVALID') {
          throw new Error('Requisição bloqueada (ORIGIN). Recarregue a página e tente novamente.')
        }
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setAccounts((data?.accounts || []) as any)
      return true
    } catch (e: any) {
      const msg = e?.message || 'Falha ao carregar contas'
      if (!opts.silent) toast.error(msg)
      setAccounts([])
      return false
    } finally {
      setAccountsLoading(false)
      setAccountsLoadedOnce(true)
    }
  }

  useEffect(() => {
    if (tab !== 'planner') return
    void refreshQueue()
    void refreshSetup({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const suggestedUnitKey = useMemo(() => {
    const allowed = Array.isArray(setup?.user?.allowedUnits) ? setup!.user!.allowedUnits!.filter(Boolean) : []
    const mapped = [...new Set(allowed.map(mapUserUnitToSocialUnitKey).filter(Boolean) as string[])]
    return mapped.length === 1 ? mapped[0] : null
  }, [setup?.user?.allowedUnits])

  useEffect(() => {
    if (!setup || setupAuthed !== true) return
    if (unitKeyWasSaved) return

    const envDefault = Array.isArray(setup?.socialDefaults?.defaultUnitsFromEnv)
      ? (setup!.socialDefaults!.defaultUnitsFromEnv!.map(String).map((s) => s.trim()).filter(Boolean)[0] || '')
      : ''

    const next = suggestedUnitKey || envDefault || 'BSS'
    if (next && next !== unitKey) setUnitKeyPersist(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupAuthed, suggestedUnitKey, setup])

  useEffect(() => {
    if (!setup || setupAuthed !== true) return
    if (scopeUnitsWasSaved) return

    const envUnits = Array.isArray(setup?.socialDefaults?.defaultUnitsFromEnv) ? setup!.socialDefaults!.defaultUnitsFromEnv! : []
    const envCleaned = envUnits
      .map((u) => String(u || '').trim().toUpperCase())
      .filter((u) => u && u !== 'NULL')
      .filter((u) => u === 'BSS' || u === 'NH')

    const next = suggestedUnitKey ? [suggestedUnitKey] : envCleaned.length ? envCleaned : ['BSS', 'NH']
    setScopeUnitsPersist(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupAuthed, setup, suggestedUnitKey])

  useEffect(() => {
    if (scopePlatformsWasSaved) return
    if (!Array.isArray(scopePlatforms) || !scopePlatforms.length) setScopePlatformsPersist([...PLATFORM_ORDER])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const adminReady = useMemo(() => {
    if (setupAuthed !== true) return false
    if (setup?.admin?.isAdmin === true) return true
    const role = String(setup?.admin?.role || setup?.user?.role || '').trim().toUpperCase()
    return role === 'GESTOR' || role === 'GERENTE'
  }, [setup?.admin?.isAdmin, setup?.admin?.role, setup?.user?.role, setupAuthed])

  useEffect(() => {
    if (tab !== 'planner') return
    if (!setup || setupAuthed !== true) return
    if (!adminReady) return
    if (autoTriedAccounts) return
    setAutoTriedAccounts(true)
    void refreshAccounts({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminReady, autoTriedAccounts, setupAuthed, tab])

  const selectedScopeUnits = useMemo<UnitKey[]>(() => {
    const cleaned = (scopeUnits || [])
      .map((u) => String(u || '').trim().toUpperCase())
      .filter((u) => u && u !== 'NULL')
      .filter((u) => u === 'BSS' || u === 'NH')
    return [...new Set(cleaned)] as UnitKey[]
  }, [scopeUnits])

  const selectedScopePlatforms = useMemo(() => {
    const cleaned = (scopePlatforms || []).filter((p) => PLATFORM_ORDER.includes(p))
    return [...new Set(cleaned)]
  }, [scopePlatforms])

  const scopeValid = selectedScopeUnits.length > 0 && selectedScopePlatforms.length > 0

  const togglePlatform = (p: SocialPlatform) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }

  const uploadToQueue = async () => {
    if (!files.length) return toast.error('Selecione pelo menos 1 arquivo.')
    if (!platforms.length) return toast.error('Selecione pelo menos 1 rede.')

    setUploading(true)
    try {
      const fd = new FormData()
      fd.set('unitKey', unitKey)
      fd.set('platforms', platforms.join(','))
      if (scheduledAtLocal) fd.set('scheduledAt', new Date(scheduledAtLocal).toISOString())
      if (captionInstagram.trim()) fd.set('captionInstagram', captionInstagram.trim())
      if (captionFacebook.trim()) fd.set('captionFacebook', captionFacebook.trim())
      if (captionThreads.trim()) fd.set('captionThreads', captionThreads.trim())
      for (const f of files) fd.append('files', f)

      const res = await fetch('/api/social/queue/upload', { method: 'POST', body: fd, credentials: 'include', headers: csrfHeader() })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      toast.success(`Enfileirado: ${data.groupKey}`)
      setFiles([])
      await refreshQueue(data.dateKey || dateKey)
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao enfileirar')
    } finally {
      setUploading(false)
    }
  }

  const saveAccount = async () => {
    if (!accountUnit.trim() || !accountPlatform || !accountId.trim() || !accountToken.trim()) {
      return toast.error('Preencha unit/platform/accountId/accessToken.')
    }
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', ...csrfHeader() }
      const res = await fetch('/api/social/admin/accounts', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          unitKey: accountUnit.trim(),
          platform: accountPlatform,
          accountId: accountId.trim(),
          accessToken: accountToken.trim(),
          apiVersion: accountApiVersion.trim() || undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) {
        if (res.status === 403 && data?.code === 'ADMIN_REQUIRED') throw new Error(data?.hint || 'Permissão insuficiente: GESTOR/GERENTE.')
        if (res.status === 403 && data?.code === 'CSRF_INVALID') throw new Error('Sessão inválida: recarregue e faça login novamente.')
        if (res.status === 403 && data?.code === 'ORIGIN_INVALID') throw new Error('Requisição bloqueada (ORIGIN). Recarregue e tente novamente.')
        throw new Error(data?.hint || data?.error || `HTTP ${res.status}`)
      }
      toast.success('Conta salva')
      setAccountId('')
      setAccountToken('')
      await refreshAccounts()
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao salvar conta')
    }
  }

  const deleteAccount = async (u: string, p: SocialPlatform) => {
    if (!confirm(`Remover conta ${u}/${p}?`)) return
    try {
      const headers: Record<string, string> = { ...csrfHeader() }
      const res = await fetch(`/api/social/admin/accounts?unitKey=${encodeURIComponent(u)}&platform=${encodeURIComponent(p)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers,
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) {
        if (res.status === 403 && data?.code === 'ADMIN_REQUIRED') throw new Error(data?.hint || 'Permissão insuficiente: GESTOR/GERENTE.')
        if (res.status === 403 && data?.code === 'CSRF_INVALID') throw new Error('Sessão inválida: recarregue e faça login novamente.')
        if (res.status === 403 && data?.code === 'ORIGIN_INVALID') throw new Error('Requisição bloqueada (ORIGIN). Recarregue e tente novamente.')
        throw new Error(data?.hint || data?.error || `HTTP ${res.status}`)
      }
      toast.success('Conta removida')
      await refreshAccounts({ silent: true })
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao remover conta')
    }
  }

  const copyText = async (text: string, label = 'Copiado') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(label)
    } catch {
      toast.error('Falha ao copiar')
    }
  }

  const publishNow = async (g: QueueGroup, force = false) => {
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', ...csrfHeader() }
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ dateKey: g.group.dateKey, groupKey: g.group.groupKey, force }),
      })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) {
        if (res.status === 403 && data?.code === 'ADMIN_REQUIRED') throw new Error(data?.hint || 'Permissão insuficiente: GESTOR/GERENTE.')
        if (res.status === 403 && data?.code === 'CSRF_INVALID') throw new Error('Sessão inválida: recarregue e faça login novamente.')
        if (res.status === 403 && data?.code === 'ORIGIN_INVALID') throw new Error('Requisição bloqueada (ORIGIN). Recarregue e tente novamente.')
        throw new Error(data?.hint || data?.error || `HTTP ${res.status}`)
      }
      if (data?.jobId) {
        const key = `${g.group.dateKey}:${g.group.groupKey}`
        setQueueJobIds((prev) => ({ ...prev, [key]: data.jobId }))
        setQueueJobStatus((prev) => ({ ...prev, [key]: 'pending' }))
        toast.success(`Publish enfileirado (${data.jobId})`)
      } else {
        toast.success('Publish enfileirado')
      }
      await refreshQueue(g.group.dateKey)
      await loadResults(g)
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao publicar')
    }
  }

  const checkJobStatus = async (g: QueueGroup) => {
    const key = `${g.group.dateKey}:${g.group.groupKey}`
    const jobId = queueJobIds[key]
    if (!jobId) return toast.error('JobId não encontrado. Reenfileire o publish.')
    try {
      const res = await fetch(`/api/social/job-status?jobId=${encodeURIComponent(jobId)}`, { credentials: 'include' })
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      const status = String(data?.status || 'unknown')
      setQueueJobStatus((prev) => ({ ...prev, [key]: status }))
      if (status === 'done') {
        await loadResults(g)
      }
      toast.success(`Status do job: ${status}`)
    } catch (e: any) {
      toast.error(e?.message || 'Falha ao carregar status do job')
    }
  }
  const platformsLabel = (ps: SocialPlatform[]) => PLATFORM_ORDER.filter((p) => ps.includes(p)).join(', ')

  const requiredUnits = useMemo(() => {
    if (selectedScopeUnits.length) return selectedScopeUnits
    const envUnits = Array.isArray(setup?.socialDefaults?.defaultUnitsFromEnv) ? setup!.socialDefaults!.defaultUnitsFromEnv! : []
    const cleaned = envUnits
      .map((u) => String(u || '').trim().toUpperCase())
      .filter((u): u is UnitKey => u === 'BSS' || u === 'NH')
    return cleaned.length ? cleaned : unitOptions
  }, [selectedScopeUnits, setup?.socialDefaults?.defaultUnitsFromEnv, unitOptions])

  const requiredPlatforms = useMemo(() => {
    return selectedScopePlatforms.length ? selectedScopePlatforms : [...PLATFORM_ORDER]
  }, [selectedScopePlatforms])

  const missingAccounts = useMemo(() => {
    const existing = new Set(accounts.map((a) => `${a.unitKey}:${a.platform}`))
    const out: Array<{ unitKey: string; platform: SocialPlatform }> = []
    for (const u of requiredUnits) {
      for (const p of requiredPlatforms) {
        const key = `${u}:${p}`
        if (!existing.has(key)) out.push({ unitKey: u, platform: p })
      }
    }
    return out
  }, [accounts, requiredPlatforms, requiredUnits])

  const infraOk = setupAuthed === true && !!setup?.r2?.bucketConfigured
  const encryptionOk = setupAuthed === true && (!setup?.encryption?.required || !!setup?.encryption?.configured)
  const adminOk = adminReady
  const accountsOk = setupAuthed === true && adminOk && missingAccounts.length === 0
  const unlockReady = scopeValid && infraOk && encryptionOk && adminOk && accountsOk

  const unlockEvaluated = useMemo(() => {
    if (setupAuthed === false) return true
    if (setupAuthed !== true) return false
    if (!scopeValid) return true
    if (!infraOk) return true
    if (!encryptionOk) return true
    if (!adminOk) return true
    return accountsLoadedOnce
  }, [accountsLoadedOnce, adminOk, encryptionOk, infraOk, scopeValid, setupAuthed])

  const tabsUnlocked = onboardingCompleted && unlockReady

  useEffect(() => {
    if (!onboardingCompleted) return
    if (!unlockEvaluated) return
    if (unlockReady) return
    setOnboardingCompletedPersist(false)
    setTab('planner')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingCompleted, unlockEvaluated, unlockReady])

  useEffect(() => {
    if (tab === 'planner') return
    if (tabsUnlocked) return
    setTab('planner')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsUnlocked])

  const visibleQueueGroups = useMemo(() => {
    if (!onlyMyUnit) return queueGroups
    return queueGroups.filter((g) => Array.isArray(g.group?.unitKeys) && g.group.unitKeys.includes(unitKey))
  }, [onlyMyUnit, queueGroups, unitKey])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 min-w-0 w-full md:flex-row md:items-center md:gap-3">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold text-white">Redes Sociais</h2>
          <p className="text-blue-300/80 text-sm">Instagram · Facebook · Threads — fila em R2 + publicação (Cloudflare)</p>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v: any) => {
          const next = v as 'planner' | 'instagram' | 'facebook' | 'threads'
          if (next !== 'planner' && !tabsUnlocked) {
            setTab('planner')
            toast.error('Finalize o Planner para liberar as abas.')
            return
          }
          setTab(next)
        }}
        className="space-y-6"
      >
        <TabsList className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <TabsTrigger value="planner">Planner</TabsTrigger>
          <TabsTrigger value="instagram" disabled={!tabsUnlocked}>
            Instagram{!tabsUnlocked ? ' (bloqueado)' : ''}
          </TabsTrigger>
          <TabsTrigger value="facebook" disabled={!tabsUnlocked}>
            Facebook{!tabsUnlocked ? ' (bloqueado)' : ''}
          </TabsTrigger>
          <TabsTrigger value="threads" disabled={!tabsUnlocked}>
            Threads{!tabsUnlocked ? ' (bloqueado)' : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="planner" className="space-y-6">
          <Card className="glass-morphism border-white/20">
            <CardHeader>
              <CardTitle className="text-white">Configuração do módulo (primeiro acesso)</CardTitle>
              <CardDescription className="text-blue-200/70">
                Checklist para habilitar “Redes Sociais” com seus dados (login, permissões, contas e processamento).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => refreshSetup()}
                  disabled={setupLoading}
                  className="bg-white/[0.06] border-white/20 text-white"
                >
                  {setupLoading ? (
                    <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                  ) : (
                    'Recarregar status'
                  )}
                </Button>

                {setupAuthed === true ? (
                  <Badge variant="outline" className="border-white/20 text-white">
                    Sessão: OK
                  </Badge>
                ) : setupAuthed === false ? (
                  <Badge variant="outline" className="border-red-200/50 text-red-100">
                    Sessão: login necessário
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-white/20 text-white">
                    Sessão: …
                  </Badge>
                )}

                {setup?.r2?.bucketConfigured ? (
                  <Badge variant="outline" className="border-white/20 text-white">
                    R2: OK
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-red-200/50 text-red-100">
                    R2: não configurado
                  </Badge>
                )}

                {setup?.encryption?.required ? (
                  setup?.encryption?.configured ? (
                    <Badge variant="outline" className="border-white/20 text-white">
                      Crypto: OK (required)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-red-200/50 text-red-100">
                      Crypto: faltando (required)
                    </Badge>
                  )
                ) : setup?.encryption?.configured ? (
                  <Badge variant="outline" className="border-white/20 text-white">
                    Crypto: OK
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-white/20 text-white">
                    Crypto: opcional
                  </Badge>
                )}

                <Badge variant="outline" className="border-white/20 text-white">
                  Prefix: <span className="font-mono">{setup?.r2?.effectiveKeyPrefix || '(prod)'}</span>
                </Badge>
              </div>

              {setupError ? <div className="text-sm text-red-200">{setupError}</div> : null}

              {suggestedUnitKey && suggestedUnitKey !== unitKey ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-blue-200/80">
                  Detectamos sua unidade provável: <span className="font-mono">{suggestedUnitKey}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setUnitKeyPersist(suggestedUnitKey)}
                    className="bg-white/[0.06] border-white/20 text-white"
                  >
                    Usar
                  </Button>
                </div>
              ) : null}

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-white font-medium">0) O que você quer habilitar?</div>
                    <div className="text-xs text-blue-200/70">Esse escopo define quais contas/config serão exigidas para liberar as abas.</div>
                  </div>
                  {scopeValid ? (
                    <Badge variant="outline" className="border-white/20 text-white">
                      OK
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-red-200/50 text-red-100">
                      Pendente
                    </Badge>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="text-xs text-blue-200/70">Unidades</div>
                    <div className="flex flex-wrap gap-3">
                      {unitOptions.map((u) => {
                        const checked = selectedScopeUnits.includes(u)
                        return (
                          <label key={u} className="flex items-center gap-2 text-sm text-blue-100/90">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const next = v ? [...new Set([...selectedScopeUnits, u])] : selectedScopeUnits.filter((x) => x !== u)
                                setScopeUnitsPersist(next)
                              }}
                            />
                            <span className="font-mono">{u}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-blue-200/70">Redes</div>
                    <div className="flex flex-wrap gap-3">
                      {PLATFORM_ORDER.map((p) => {
                        const checked = selectedScopePlatforms.includes(p)
                        return (
                          <label key={p} className="flex items-center gap-2 text-sm text-blue-100/90">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const next = v ? [...new Set([...selectedScopePlatforms, p])] : selectedScopePlatforms.filter((x) => x !== p)
                                setScopePlatformsPersist(next)
                              }}
                            />
                            <span className="font-mono">{p}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {!scopeValid ? <div className="text-xs text-red-200">Selecione pelo menos 1 unidade e 1 rede.</div> : null}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-white font-medium">1) Login (CRM)</div>
                    <div className="text-xs text-blue-200/70">A aba usa a sessão do CRM (cookies + CSRF).</div>
                  </div>
                  {setupAuthed === true ? (
                    <Badge variant="outline" className="border-white/20 text-white">
                      OK
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-red-200/50 text-red-100">
                      Pendente
                    </Badge>
                  )}
                </div>
                {setupAuthed === false ? (
                  <div className="text-sm text-blue-200/80">
                    Faça login no <span className="font-semibold">CRM</span> e volte aqui para recarregar o status.
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-white font-medium">2) Permissão de Gestor</div>
                    <div className="text-xs text-blue-200/70">Somente GESTOR/GERENTE podem configurar contas e publicar.</div>
                  </div>
                  {adminReady ? (
                    <Badge variant="outline" className="border-white/20 text-white">
                      OK
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-red-200/50 text-red-100">
                      Pendente
                    </Badge>
                  )}
                </div>
                {setupAuthed !== true ? (
                  <div className="text-sm text-blue-200/70">Faça login para validar permissões.</div>
                ) : adminReady ? (
                  <div className="text-sm text-blue-200/80">
                    Permissão OK{detectedRole ? ` (role: ${detectedRole})` : ''}.
                  </div>
                ) : (
                  <div className="text-sm text-red-200">
                    Somente GESTOR/GERENTE podem configurar/publicar neste módulo{detectedRole ? ` (seu role: ${detectedRole})` : ''}.
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-white font-medium">3) Contas configuradas</div>
                    <div className="text-xs text-blue-200/70">Configure accountId + accessToken por unidade e plataforma.</div>
                  </div>
                  <Badge variant="outline" className="border-white/20 text-white">
                    {accounts.length} conta(s)
                  </Badge>
                </div>

                {adminReady ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => refreshAccounts()}
                      disabled={accountsLoading}
                      className="bg-white/[0.06] border-white/20 text-white"
                    >
                      {accountsLoading ? (
                        <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                      ) : (
                        'Atualizar contas'
                      )}
                    </Button>
                    {missingAccounts.length ? (
                      <Badge variant="outline" className="border-yellow-200/40 text-yellow-100">
                        Faltando: {missingAccounts.length}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-white/20 text-white">
                        Completo
                      </Badge>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-blue-200/70">Valide a permissão de admin para carregar e configurar contas.</div>
                )}

                {adminReady && accounts.length ? (
                  <div className="rounded-md border border-white/10 bg-white/[0.03] overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-blue-200/70 border-b border-white/10">
                      <div className="col-span-2">Unidade</div>
                      <div className="col-span-2">Plataforma</div>
                      <div className="col-span-5">Account ID</div>
                      <div className="col-span-2">API</div>
                      <div className="col-span-1 text-right">Ações</div>
                    </div>
                    {accounts.map((a) => (
                      <div key={`${a.unitKey}:${a.platform}`} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-white border-b border-white/5">
                        <div className="col-span-2 font-mono">{a.unitKey}</div>
                        <div className="col-span-2">{a.platform}</div>
                        <div className="col-span-5 font-mono truncate" title={a.accountId}>
                          {a.accountId}
                        </div>
                        <div className="col-span-2 font-mono">{a.apiVersion || '—'}</div>
                        <div className="col-span-1 flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyText(String(a.accountId || ''), 'Account ID copiado')}
                            className="bg-white/[0.06] border-white/20 text-white"
                          >
                            Copiar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setAccountUnit(a.unitKey)
                              setAccountPlatform(a.platform)
                              setAccountId(a.accountId)
                              setAccountApiVersion(a.apiVersion || 'v20.0')
                              setAccountToken('')
                              toast.message('Conta carregada no formulário. Cole um novo token para atualizar.')
                            }}
                            className="bg-white/[0.06] border-white/20 text-white"
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void deleteAccount(a.unitKey, a.platform)}
                            className="bg-white/[0.06] border-white/20 text-white"
                          >
                            Remover
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {adminReady && missingAccounts.length ? (
                  <div className="space-y-2">
                    <div className="text-xs text-blue-200/70">Faltando configuração (clique para pré-preencher o formulário):</div>
                    <div className="flex flex-wrap gap-2">
                      {missingAccounts.slice(0, 20).map((m) => (
                        <Button
                          key={`${m.unitKey}:${m.platform}`}
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setAccountUnit(m.unitKey)
                            setAccountPlatform(m.platform)
                            toast.message(`Preenchido: ${m.unitKey}/${m.platform}`)
                          }}
                          className="bg-white/[0.06] border-white/20 text-white"
                        >
                          {m.unitKey}/{m.platform}
                        </Button>
                      ))}
                      {missingAccounts.length > 20 ? <Badge variant="outline" className="border-white/20 text-white">+{missingAccounts.length - 20}</Badge> : null}
                    </div>
                  </div>
                ) : null}

                <div className="grid md:grid-cols-5 gap-3">
                  <div className="space-y-2">
                    <Select value={accountUnit} onValueChange={(v) => setAccountUnit(v)}>
                      <SelectTrigger className="bg-white/[0.06] border-white/20 text-white">
                        <SelectValue placeholder="Unidade" />
                      </SelectTrigger>
                      <SelectContent>
                        {unitOptions.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-blue-200">Plataforma</Label>
                    <Select value={accountPlatform} onValueChange={(v: any) => setAccountPlatform(v)}>
                      <SelectTrigger className="bg-white/[0.06] border-white/20 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLATFORM_ORDER.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-blue-200">Account ID</Label>
                    <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-blue-200">API Version</Label>
                    <Input
                      value={accountApiVersion}
                      onChange={(e) => setAccountApiVersion(e.target.value)}
                      placeholder="v20.0 / v1.0"
                      className="bg-white/[0.06] border-white/20 text-white"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="text-blue-200">Access Token</Label>
                  <Input value={accountToken} onChange={(e) => setAccountToken(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => saveAccount()}
                    disabled={!adminReady}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                  >
                    Salvar conta
                  </Button>
                  {!adminReady ? <div className="text-xs text-blue-200/70">Valide o admin para salvar.</div> : null}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-white font-medium">4) Processamento (Worker)</div>
                    <div className="text-xs text-blue-200/70">Confirma se o worker está processando jobs.</div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => refreshLastJobsRun()}
                    disabled={metricsLoading || setupAuthed !== true}
                    className="bg-white/[0.06] border-white/20 text-white"
                  >
                    {metricsLoading ? (
                      <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                    ) : (
                      'Carregar métricas'
                    )}
                  </Button>
                </div>
                {lastJobsRun ? (
                  <div className="text-xs text-blue-200/80">
                    processed: <span className="font-mono">{String(lastJobsRun.processed ?? '')}</span> · ok:{' '}
                    <span className="font-mono">{String(lastJobsRun.okCount ?? '')}</span> · fail:{' '}
                    <span className="font-mono">{String(lastJobsRun.failCount ?? '')}</span> · finishedAt:{' '}
                    <span className="font-mono">{String(lastJobsRun.finishedAt ?? '')}</span>
                  </div>
                ) : lastJobsRunError ? (
                  <div className="text-xs text-blue-200/70">{lastJobsRunError}</div>
                ) : (
                  <div className="text-xs text-blue-200/70">Sem dados carregados.</div>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-white font-medium">5) Finalizar</div>
                    <div className="text-xs text-blue-200/70">Libera as abas Instagram/Facebook/Threads quando tudo estiver OK para o escopo acima.</div>
                  </div>
                  {tabsUnlocked ? (
                    <Badge variant="outline" className="border-white/20 text-white">
                      Abas liberadas
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-white/20 text-white">
                      Bloqueado
                    </Badge>
                  )}
                </div>

                {missingAccounts.length ? (
                  <div className="text-xs text-blue-200/70">
                    Faltam {missingAccounts.length} conta(s):{' '}
                    <span className="font-mono">
                      {missingAccounts
                        .slice(0, 6)
                        .map((m) => `${m.unitKey}/${m.platform}`)
                        .join(', ')}
                      {missingAccounts.length > 6 ? '…' : ''}
                    </span>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => {
                      if (!unlockReady) return
                      setOnboardingCompletedPersist(true)
                      toast.success('Planner finalizado. Abas liberadas.')
                    }}
                    disabled={!unlockReady}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                  >
                    Finalizar e liberar abas
                  </Button>
                  {!unlockReady ? <div className="text-xs text-blue-200/70">Conclua os passos pendentes para liberar.</div> : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-morphism border-white/20">
            <CardHeader>
              <CardTitle className="text-white">Enfileirar mídia (R2)</CardTitle>
              <CardDescription className="text-blue-200/70">Arquivos viram URLs públicas em /social-media para o Graph puxar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Select value={unitKey} onValueChange={(v) => setUnitKeyPersist(v)}>
                    <SelectTrigger className="bg-white/[0.06] border-white/20 text-white">
                      <SelectValue placeholder="Unidade" />
                    </SelectTrigger>
                    <SelectContent>
                      {unitOptions.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-blue-200">Agendar (opcional)</Label>
                  <Input
                    type="datetime-local"
                    value={scheduledAtLocal}
                    onChange={(e) => setScheduledAtLocal(e.target.value)}
                    className="bg-white/[0.06] border-white/20 text-white"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                {PLATFORM_ORDER.map((p) => (
                  <Button
                    key={p}
                    variant={platforms.includes(p) ? 'default' : 'outline'}
                    onClick={() => togglePlatform(p)}
                    className={platforms.includes(p) ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-white/[0.06] border-white/20 text-white'}
                  >
                    {p}
                  </Button>
                ))}
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-blue-200">Legenda Instagram</Label>
                  <Textarea value={captionInstagram} onChange={(e) => setCaptionInstagram(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-blue-200">Legenda Facebook</Label>
                  <Textarea value={captionFacebook} onChange={(e) => setCaptionFacebook(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-blue-200">Legenda Threads</Label>
                  <Textarea value={captionThreads} onChange={(e) => setCaptionThreads(e.target.value)} className="bg-white/[0.06] border-white/20 text-white" />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-blue-200">Arquivos</Label>
                <Input
                  type="file"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  className="bg-white/[0.06] border-white/20 text-white"
                />
                <div className="text-xs text-blue-200/70">{files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Nenhum arquivo selecionado'}</div>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={() => uploadToQueue()} disabled={uploading} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                  {uploading ? 'Enfileirando…' : 'Enfileirar'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-morphism border-white/20">
            <CardHeader>
              <CardTitle className="text-white">Fila</CardTitle>
              <CardDescription className="text-blue-200/70">Lista grupos por dia (ddMMyy). Publicação manual aqui ou automática via Worker cron.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-nowrap items-center gap-2 min-w-0 overflow-x-auto">
                <div className="space-y-2">
                  <Label className="text-blue-200">dateKey</Label>
                  <Input
                    value={dateKey}
                    onChange={(e) => setDateKey(e.target.value)}
                    placeholder="ddMMyy"
                    className="h-8 bg-white/[0.06] border-white/20 text-white w-36"
                  />
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <Checkbox checked={onlyMyUnit} onCheckedChange={(v) => setOnlyMyUnitPersist(!!v)} />
                  <div className="text-sm text-blue-200/80">Somente minha unidade ({unitKey})</div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => refreshQueue()}
                  disabled={queueLoading}
                  className="h-8 bg-white/[0.06] border-white/20 text-white"
                >
                  {queueLoading ? (
                    <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                  ) : (
                    'Carregar'
                  )}
                </Button>
                <Badge variant="outline" className="border-white/20 text-white">
                  {visibleQueueGroups.length} grupo(s)
                </Badge>
              </div>

              <div className="space-y-2">
                {visibleQueueGroups.map((g) => (
                  <div key={`${g.group.dateKey}:${g.group.groupKey}`} className="rounded-lg border border-white/10 bg-white/[0.04] p-3 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-white">
                        <span className="font-mono">{g.group.groupKey}</span> · {g.assetsCount} mídia(s) ·{' '}
                        <span className="text-blue-200/80">{platformsLabel(g.group.platforms || [])}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => loadResults(g)}
                          disabled={queueResultsLoading[`${g.group.dateKey}:${g.group.groupKey}`]}
                          variant="outline"
                          className="bg-white/[0.06] border-white/20 text-white"
                        >
                          {queueResultsLoading[`${g.group.dateKey}:${g.group.groupKey}`] ? (
                            <LoadingPercentText label="Carregando" className="text-white/80" showPercent={false} />
                          ) : (
                            'Resultados'
                          )}
                        </Button>
                        {queueJobIds[`${g.group.dateKey}:${g.group.groupKey}`] ? (
                          <Button
                            size="sm"
                            onClick={() => checkJobStatus(g)}
                            variant="outline"
                            className="bg-white/[0.06] border-white/20 text-white"
                          >
                            Status: {queueJobStatus[`${g.group.dateKey}:${g.group.groupKey}`] || 'pendente'}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          onClick={() => publishNow(g)}
                          disabled={!adminReady}
                          className="bg-blue-600 hover:bg-blue-500 text-white"
                        >
                          Publicar agora
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            if (!confirm('Forçar reprocesso? Isso tenta publicar mesmo se já marcado como publicado.')) return
                            void publishNow(g, true)
                          }}
                          disabled={!adminReady}
                          variant="outline"
                          className="bg-white/[0.06] border-white/20 text-white"
                        >
                          Reprocessar
                        </Button>
                      </div>
                    </div>
                    <div className="text-xs text-blue-200/70">scheduledAt: {g.group.scheduledAt}</div>
                    <div className="flex flex-wrap gap-2">
                      {(g.group.unitKeys || []).map((u) => (
                        <Badge key={u} variant="outline" className="border-white/20 text-white">
                          {u}:{' '}
                          {PLATFORM_ORDER.filter((p) => (g.group.platforms || []).includes(p))
                            .map((p) => `${p}${g.published?.[u]?.[p] ? '✅' : '⏳'}`)
                            .join(' · ')}
                        </Badge>
                      ))}
                    </div>
                    {queueResults[`${g.group.dateKey}:${g.group.groupKey}`] ? (
                      <div className="rounded-md border border-white/10 bg-white/[0.03] p-2 space-y-2 text-xs text-blue-100/90">
                        {Object.entries(queueResults[`${g.group.dateKey}:${g.group.groupKey}`] || {}).map(([unitKey, platforms]) => (
                          <div key={unitKey}>
                            <div className="text-blue-200/80">{unitKey}</div>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(platforms || {}).map(([platform, result]) => (
                                <Badge key={`${unitKey}:${platform}`} variant="outline" className="border-white/20 text-white">
                                  {platform}: {(result as any)?.ok ? 'OK' : ((result as any)?.error || 'ERRO')}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                        {!Object.keys(queueResults[`${g.group.dateKey}:${g.group.groupKey}`] || {}).length ? (
                          <div className="text-blue-200/70">Sem resultados.</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                {!visibleQueueGroups.length ? <div className="text-sm text-blue-200/70">Nenhum grupo encontrado.</div> : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="instagram" className="space-y-6">
          <InstagramStudioPro />
        </TabsContent>

        <TabsContent value="facebook" className="space-y-6">
          <Card className="glass-morphism border-white/20">
            <CardHeader>
              <CardTitle className="text-white">Facebook</CardTitle>
              <CardDescription className="text-blue-200/70">
                Publicação via Planner. (UI de insights/engajamento pode ser adicionada depois.)
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-blue-200/70">Use o Planner para enfileirar e publicar.</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="threads" className="space-y-6">
          <ThreadsStudio />
        </TabsContent>
      </Tabs>
    </div>
  )
}
