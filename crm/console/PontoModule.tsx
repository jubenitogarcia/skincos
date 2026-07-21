import React, { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { Label } from '@/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { DEFAULT_UNIT_OPTIONS, type UnitOption } from '@/unitSelection'
import * as QRCode from 'qrcode'
import { LoadingPercentText } from '@/LoadingPattern'
import { apiBlob, apiJson, createRequestMeta, errorMetaString, fetchJsonWithMeta, getDevEmployeeActorHeaders, LS_DEV_ACTOR_EMAIL } from './pontoApi'
import { getNextPunchAction, getPunchConfirmation, getPunchTypeLabel } from './pontoPresentation'
import { profileMissingSummary, profileValue } from './pontoProfilePresentation'
import type { PontoCorrection, PontoDevicePublic, PontoEmailConflict, PontoEmployeePublic, PontoMeResponse, PontoMonthlyResult, PontoMyProfileResponse, PontoPresencePolicy, PontoPunchRecord } from './pontoTypes'

type FaceDetectorMode = 'tiny' | 'ssd'


const FACE_FALLBACK_THRESHOLD = 3
const FACE_FALLBACK_MESSAGE =
  'Condições ruins detectadas. Estamos melhorando a análise do rosto, aguarde alguns segundos.'
// Capture and facial identification remain intentionally off until an explicit
// operational decision enables the feature again. Punches use PIN only.
const FACE_IDENTIFICATION_ENABLED = false

function formatUnitLabel(u: string) {
  return String(u || '')
    .split('-')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

function isFaceDetectionError(err: any) {
  const code = String(err?.code || err?.details?.error || err?.details?.code || '').trim()
  if (code === 'FACE_DETECTION_FAILED' || code === 'FACE_LOW_QUALITY') return true
  const msg = String(err?.message || '').toLowerCase()
  return msg.includes('nenhum rosto') || msg.includes('baixa qualidade')
}

function extractErrorMeta(err: any) {
  const code = String(err?.details?.error || err?.details?.code || err?.code || '').trim()
  const requestId = String(err?.requestId || '').trim()
  const cfRay = String(err?.cfRay || '').trim()
  return { code, requestId, cfRay }
}

function toastErrorMeta(err: any) {
  const meta = extractErrorMeta(err)
  const text = errorMetaString(meta)
  if (text) toast.message(text)
}


function fmtDate(value?: string | null) {
  const v = String(value || '').trim()
  if (!v) return ''
  const d = new Date(v)
  if (!Number.isFinite(d.getTime())) return v
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d)
  } catch {
    return d.toISOString()
  }
}

function toDateTimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toDateValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toDateRangeISO(value: string, mode: 'start' | 'end'): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.includes('T')) {
    const dt = new Date(raw)
    return Number.isFinite(dt.getTime()) ? dt.toISOString() : ''
  }
  const iso = mode === 'end' ? `${raw}T23:59:59.999` : `${raw}T00:00:00.000`
  const dt = new Date(iso)
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : ''
}

let faceLibPromise: Promise<any> | null = null
let faceBasePromise: Promise<void> | null = null
let faceTinyPromise: Promise<void> | null = null
let faceSsdPromise: Promise<void> | null = null
const yieldToUI = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })

async function getFaceApi() {
  if (faceLibPromise) return faceLibPromise
  faceLibPromise = (async () => {
    await import('@tensorflow/tfjs')
    const mod: any = await import('@vladmandic/face-api')
    return mod
  })()
  return faceLibPromise
}

async function ensureFaceModels(
  mode: FaceDetectorMode,
  onProgress?: (done: number, total: number, label?: string) => void
) {
  const total = 3
  let done = 0
  const report = (label?: string) => onProgress?.(done, total, label)

  const faceapi = await getFaceApi()
  if (!faceBasePromise) {
    faceBasePromise = (async () => {
      const tf = faceapi?.tf as any
      if (tf?.setBackend) {
        try { await tf.setBackend('webgl') } catch { /* ignore */ }
        await tf.ready()
      }
      await faceapi.nets.faceLandmark68Net.loadFromUri('/face-models')
      done = Math.min(done + 1, total)
      report('landmarks')
      await faceapi.nets.faceRecognitionNet.loadFromUri('/face-models')
      done = Math.min(done + 1, total)
      report('recognition')
    })()
  }

  report('init')
  await yieldToUI()
  await faceBasePromise
  done = Math.max(done, 2)
  report('base')
  await yieldToUI()

  if (mode === 'ssd') {
    if (!faceSsdPromise) {
      faceSsdPromise = (async () => {
        await faceapi.nets.ssdMobilenetv1.loadFromUri('/face-models')
      })()
    }
    await faceSsdPromise
    done = Math.min(done + 1, total)
    report('ssd')
    await yieldToUI()
  } else {
    if (!faceTinyPromise) {
      faceTinyPromise = (async () => {
        await faceapi.nets.tinyFaceDetector.loadFromUri('/face-models')
      })()
    }
    await faceTinyPromise
    done = Math.min(done + 1, total)
    report('tiny')
    await yieldToUI()
  }
}

async function startUserCamera(videoEl: HTMLVideoElement) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  })
  videoEl.srcObject = stream
  await videoEl.play()
  return stream
}

function stopCamera(stream: MediaStream | null) {
  try {
    for (const t of stream?.getTracks?.() || []) t.stop()
  } catch { /* ignore */ }
}

async function captureDescriptor(videoEl: HTMLVideoElement, mode: FaceDetectorMode): Promise<number[]> {
  await ensureFaceModels(mode)
  const faceapi = await getFaceApi()
  const detector =
    mode === 'ssd'
      ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
      : new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
  const detection = await faceapi
    .detectSingleFace(videoEl, detector)
    .withFaceLandmarks()
    .withFaceDescriptor()
  const score = detection?.detection?.score
  if (!detection?.descriptor) {
    const err = new Error('Nenhum rosto detectado')
    ;(err as any).code = 'FACE_DETECTION_FAILED'
    throw err
  }
  if (typeof score === 'number' && score < 0.7) {
    const err = new Error('Rosto com baixa qualidade (aproxime e evite contra-luz)')
    ;(err as any).code = 'FACE_LOW_QUALITY'
    throw err
  }
  return Array.from(detection.descriptor)
}

async function detectDescriptorWithInfo(videoEl: HTMLVideoElement, mode: FaceDetectorMode): Promise<{ descriptor: number[]; score: number | null; box: any; landmarks: any }> {
  await ensureFaceModels(mode)
  const faceapi = await getFaceApi()
  const detector =
    mode === 'ssd'
      ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
      : new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
  const detection = await faceapi
    .detectSingleFace(videoEl, detector)
    .withFaceLandmarks()
    .withFaceDescriptor()
  const score = detection?.detection?.score
  if (!detection?.descriptor) {
    const err = new Error('Nenhum rosto detectado')
    ;(err as any).code = 'FACE_DETECTION_FAILED'
    throw err
  }
  if (typeof score === 'number' && score < 0.7) {
    const err = new Error('Rosto com baixa qualidade (aproxime e evite contra-luz)')
    ;(err as any).code = 'FACE_LOW_QUALITY'
    throw err
  }
  return {
    descriptor: Array.from(detection.descriptor) as number[],
    score: typeof score === 'number' ? score : null,
    box: detection?.detection?.box || null,
    landmarks: detection?.landmarks || null,
  }
}

async function detectFaceRaw(videoEl: HTMLVideoElement, mode: FaceDetectorMode) {
  await ensureFaceModels(mode)
  const faceapi = await getFaceApi()
  const detector =
    mode === 'ssd'
      ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
      : new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
  const detection = await faceapi
    .detectSingleFace(videoEl, detector)
    .withFaceLandmarks()
  return detection
}

function averagePoint(points: Array<{ x: number; y: number }>) {
  if (!points?.length) return null
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

function getEnrollHint(detection: any, videoEl: HTMLVideoElement) {
  if (!detection) return 'Posicione o rosto no centro'
  const box = detection?.box
  const vw = videoEl.videoWidth || 1
  const vh = videoEl.videoHeight || 1
  if (box) {
    const size = Math.min(box.width / vw, box.height / vh)
    if (size < 0.25) return 'Aproxime o rosto da câmera'
    if (size > 0.7) return 'Afaste um pouco o rosto'
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    if (cx < vw * 0.35) return 'Mova o rosto para a direita'
    if (cx > vw * 0.65) return 'Mova o rosto para a esquerda'
    if (cy < vh * 0.35) return 'Mova o rosto para baixo'
    if (cy > vh * 0.65) return 'Mova o rosto para cima'
  }
  try {
    const lm = detection?.landmarks
    const leftEye = averagePoint(lm?.getLeftEye?.() || [])
    const rightEye = averagePoint(lm?.getRightEye?.() || [])
    const nose = averagePoint(lm?.getNose?.() || [])
    if (leftEye && rightEye && nose) {
      const leftDist = nose.x - leftEye.x
      const rightDist = rightEye.x - nose.x
      if (leftDist > 0 && rightDist > 0) {
        const ratio = leftDist / rightDist
        if (ratio > 1.35) return 'Gire um pouco o rosto para a esquerda'
        if (ratio < 0.75) return 'Gire um pouco o rosto para a direita'
      }
    }
  } catch {
    // ignore hint errors
  }
  return 'Mantenha o rosto centralizado'
}

async function captureDescriptorStable(videoEl: HTMLVideoElement, samples = 2, waitMs = 220, mode: FaceDetectorMode): Promise<number[]> {
  const n = Math.max(1, Math.min(4, samples))
  const all: number[][] = []
  for (let i = 0; i < n; i++) {
    all.push(await captureDescriptor(videoEl, mode))
    if (i < n - 1) await new Promise(r => setTimeout(r, waitMs))
  }
  if (all.length === 1) return all[0]
  const len = all[0].length
  const out = new Array(len).fill(0)
  for (const d of all) {
    for (let i = 0; i < len; i++) out[i] += d[i]
  }
  for (let i = 0; i < len; i++) out[i] /= all.length
  return out
}

export function PontoModule() {


  const [diagOpen, setDiagOpen] = useState(false)
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagError, setDiagError] = useState<string | null>(null)
  const [diagProxy, setDiagProxy] = useState<{ ok: boolean; status: number; requestId: string; cfRay: string; json: any; text: string } | null>(null)
  const [diagHealth, setDiagHealth] = useState<{ ok: boolean; status: number; requestId: string; cfRay: string; json: any; text: string } | null>(null)

  const [devActorEmail, setDevActorEmail] = useState(() => {
    try { return localStorage.getItem(LS_DEV_ACTOR_EMAIL) || '' } catch { return '' }
  })

  const adminVideoRef = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraOwner, setCameraOwner] = useState<'admin' | null>(null)
  const cameraRequestId = useRef(0)

  const [modelsReady, setModelsReady] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsProgress, setModelsProgress] = useState(0)
  const [modelsMessage, setModelsMessage] = useState<string | null>(null)
  const [modelsLoaded, setModelsLoaded] = useState<FaceDetectorMode | null>(null)
  const [faceDetectorMode, setFaceDetectorMode] = useState<FaceDetectorMode>('tiny')
  const [faceFailCount, setFaceFailCount] = useState(0)

  const [loading, setLoading] = useState(false)

  const [me, setMe] = useState<PontoMeResponse | null>(null)
  const [meError, setMeError] = useState<any>(null)
  const [meLoading, setMeLoading] = useState(false)
  const [mePunchOpen, setMePunchOpen] = useState(false)
  const [mePin, setMePin] = useState('')
  const [meUnit, setMeUnit] = useState('')
  const [meRecords, setMeRecords] = useState<PontoPunchRecord[]>([])
  const [meRecordsFrom, setMeRecordsFrom] = useState('')
  const [meRecordsTo, setMeRecordsTo] = useState('')
  const [myProfile, setMyProfile] = useState<PontoMyProfileResponse['data'] | null>(null)
  const [myProfileLoading, setMyProfileLoading] = useState(false)
  const [myProfileError, setMyProfileError] = useState<string | null>(null)
  const meLinked = me && 'linked' in me && me.linked ? me : null
  const nextPunchAction = useMemo(() => getNextPunchAction(meLinked?.lastPunch), [meLinked?.lastPunch])
  const profile = myProfile?.profile || null

  const [adminEmployees, setAdminEmployees] = useState<PontoEmployeePublic[]>([])
  const [adminDevices, setAdminDevices] = useState<PontoDevicePublic[]>([])
  const [records, setRecords] = useState<PontoPunchRecord[]>([])

  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [newEmployeeCode, setNewEmployeeCode] = useState('')
  const [newEmployeeCpf, setNewEmployeeCpf] = useState('')
  const [newEmployeeBirthDate, setNewEmployeeBirthDate] = useState('')
  const [newEmployeeJobTitle, setNewEmployeeJobTitle] = useState('')
  const [newEmployeePhone, setNewEmployeePhone] = useState('')
  const [newEmployeeLoginEmail, setNewEmployeeLoginEmail] = useState('')
  const [newEmployeeUnit, setNewEmployeeUnit] = useState('')
  const [newEmployeePin, setNewEmployeePin] = useState('')
  const [newEmployeeOpen, setNewEmployeeOpen] = useState(false)
  const [selectEmployeeOpen, setSelectEmployeeOpen] = useState(false)
  const [selectEmployeeAction, setSelectEmployeeAction] = useState<'enroll' | 'edit' | 'records'>('edit')
  const [selectEmployeeQuery, setSelectEmployeeQuery] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('')
  const selectedEmployee = useMemo(() => adminEmployees.find(e => e.id === selectedEmployeeId) || null, [adminEmployees, selectedEmployeeId])
  const filteredAdminEmployees = useMemo(() => {
    const q = selectEmployeeQuery.trim().toLowerCase()
    if (!q) return adminEmployees
    return adminEmployees.filter((e) => {
      const name = String(e.name || '').toLowerCase()
      const email = String(e.loginEmail || '').toLowerCase()
      const code = String(e.code || '').toLowerCase()
      return name.includes(q) || email.includes(q) || code.includes(q)
    })
  }, [adminEmployees, selectEmployeeQuery])

  const [enrollProgress, setEnrollProgress] = useState<{ total: number; done: number } | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrollHint, setEnrollHint] = useState<string>('Posicione o rosto no centro')
  const [enrollAutoRunning, setEnrollAutoRunning] = useState(false)
  const enrollAbortRef = useRef(false)

  const [newDeviceUnit, setNewDeviceUnit] = useState('')
  const [newDeviceLabel, setNewDeviceLabel] = useState('')
  const [newDeviceTokenOnce, setNewDeviceTokenOnce] = useState<string | null>(null)
  const [newDeviceTokenQr, setNewDeviceTokenQr] = useState<string | null>(null)
  const [newDeviceNetworkPolicy, setNewDeviceNetworkPolicy] = useState<'NONE' | 'OBSERVE' | 'REQUIRE'>('OBSERVE')
  const [newDeviceNetworks, setNewDeviceNetworks] = useState('')
  const [presencePolicyUnit, setPresencePolicyUnit] = useState('')
  const [presencePolicy, setPresencePolicy] = useState<PontoPresencePolicy | null>(null)
  const [presencePolicyLoading, setPresencePolicyLoading] = useState(false)

  const [recordsFrom, setRecordsFrom] = useState('')
  const [recordsTo, setRecordsTo] = useState('')

  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')
  const [editCpf, setEditCpf] = useState('')
  const [editBirthDate, setEditBirthDate] = useState('')
  const [editJobTitle, setEditJobTitle] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPin, setEditPin] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editActive, setEditActive] = useState(true)

  const [recordsOpen, setRecordsOpen] = useState(false)
  const [selectedRecords, setSelectedRecords] = useState<PontoPunchRecord[]>([])
  const [selectedRecordsLoading, setSelectedRecordsLoading] = useState(false)
  const [selectedRecordsError, setSelectedRecordsError] = useState<string | null>(null)
  const [manageDevicesOpen, setManageDevicesOpen] = useState(false)
  const [conflictsOpen, setConflictsOpen] = useState(false)
  const [conflictsLoading, setConflictsLoading] = useState(false)
  const [conflictsError, setConflictsError] = useState<string | null>(null)
  const [emailConflicts, setEmailConflicts] = useState<PontoEmailConflict[]>([])
  const [managementMonth, setManagementMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [managementUnit, setManagementUnit] = useState('')
  const [monthlyResult, setMonthlyResult] = useState<PontoMonthlyResult | null>(null)
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [monthlyError, setMonthlyError] = useState<string | null>(null)
  const [corrections, setCorrections] = useState<PontoCorrection[]>([])
  const [correctionsLoading, setCorrectionsLoading] = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correctionEvent, setCorrectionEvent] = useState<PontoPunchRecord | null>(null)
  const [correctionAt, setCorrectionAt] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [lastClosureId, setLastClosureId] = useState('')
  const [periodReason, setPeriodReason] = useState('')

  const [adminUnitOptions, setAdminUnitOptions] = useState<UnitOption[]>(DEFAULT_UNIT_OPTIONS)
  const [adminUnitsLoading, setAdminUnitsLoading] = useState(false)
  const [adminUnitsError, setAdminUnitsError] = useState<string | null>(null)

  const [crmMe, setCrmMe] = useState<{ user?: { role?: string; username?: string; email?: string; displayName?: string; allowedUnits?: string[] } } | null>(null)
  const [crmMeLoading, setCrmMeLoading] = useState(false)

  const allowedUnits = useMemo(() => {
    const fromCrm = crmMe?.user?.allowedUnits
    const fromMe = me && 'allowedUnits' in me ? me.allowedUnits : undefined
    const raw = Array.isArray(fromCrm) && fromCrm.length ? fromCrm : (Array.isArray(fromMe) ? fromMe : [])
    return raw.map((u) => String(u || '').trim()).filter(Boolean)
  }, [crmMe, me])

  const resolvedMeUnit = allowedUnits.length === 1 ? allowedUnits[0] : (meUnit || '')
  const unitSelectionRequired = allowedUnits.length > 1
  const unitMissing = allowedUnits.length === 0 || (unitSelectionRequired && !resolvedMeUnit)

  useEffect(() => {
    try { localStorage.setItem(LS_DEV_ACTOR_EMAIL, devActorEmail) } catch { /* ignore */ }
  }, [devActorEmail])

  useEffect(() => {
    if (meRecordsFrom || meRecordsTo) return
    const now = new Date()
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    setMeRecordsFrom(toDateValue(from))
    setMeRecordsTo(toDateValue(now))
  }, [meRecordsFrom, meRecordsTo])

  useEffect(() => {
    if (allowedUnits.length === 1) {
      setMeUnit(allowedUnits[0])
    } else if (allowedUnits.length === 0) {
      setMeUnit('')
    }
  }, [allowedUnits])

  useEffect(() => {
    const employeeUnits = Array.from(new Set([...(selectedEmployee?.units || []), selectedEmployee?.unit || ''].filter(Boolean)))
    const preferred = employeeUnits[0] || allowedUnits[0] || adminUnitOptions[0]?.value || ''
    if ((!managementUnit || (employeeUnits.length > 0 && !employeeUnits.includes(managementUnit))) && preferred) {
      setManagementUnit(preferred)
    }
  }, [adminUnitOptions, allowedUnits, managementUnit, selectedEmployee])

  const isDev = import.meta.env.DEV
  const crmRole = String(crmMe?.user?.role || '').toUpperCase()
  const canAdmin = ['GESTOR', 'GERENTE', 'SUPERVISOR', 'ADMIN'].includes(crmRole)
  const canAdminActions = ['GESTOR', 'GERENTE', 'SUPERVISOR', 'ADMIN'].includes(crmRole)
  const canManageDevices = ['GESTOR', 'GERENTE', 'ADMIN'].includes(crmRole)
  const canManageCanonicalEmployee = ['SUPERVISOR', 'ADMIN'].includes(crmRole)
  const canApproveCorrection = ['SUPERVISOR', 'ADMIN'].includes(crmRole)
  const canClosePeriod = ['SUPERVISOR', 'ADMIN'].includes(crmRole)
  const canSeeSensitive = canAdmin || (me && 'linked' in me && me.linked)
  const maskSensitive = (value?: string | null, mask: string = '•••') => {
    const raw = String(value || '').trim()
    if (!raw) return '—'
    return canSeeSensitive ? raw : mask
  }

  function closeEnrollDialog() {
    enrollAbortRef.current = true
    setEnrollOpen(false)
    setEnrollAutoRunning(false)
    setEnrollProgress(null)
    setEnrollHint('Posicione o rosto no centro')
    void stopCameraUI({ silent: true })
  }

  const loadCrmMe = React.useCallback(async () => {
    setCrmMeLoading(true)
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      const json = await res.json().catch(() => null)
      setCrmMe(res.ok ? json : null)
    } catch {
      setCrmMe(null)
    } finally {
      setCrmMeLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isDev) return
    if (String(devActorEmail || '').trim()) return
    const email = String(crmMe?.user?.email || '').trim().toLowerCase()
    if (!email) return
    setDevActorEmail(email)
  }, [isDev, devActorEmail, crmMe])

  const loadAdminUnits = React.useCallback(async () => {
    setAdminUnitsLoading(true)
    setAdminUnitsError(null)
    try {
      const res = await fetch('/api/insumos/health', { credentials: 'include' })
      if (!res.ok) throw new Error('Falha ao carregar unidades')
      const data = await res.json().catch(() => null)
      const rawUnits = Array.isArray(data?.unidades) ? data.unidades : []
      const normalized = rawUnits
        .map((u: any) => String(u || '').trim())
        .filter(Boolean)
      const options = (normalized.length ? normalized : DEFAULT_UNIT_OPTIONS.map((u) => u.value))
        .map((u) => ({ value: u, label: formatUnitLabel(u) }))
      setAdminUnitOptions(options)
    } catch (e: any) {
      setAdminUnitOptions(DEFAULT_UNIT_OPTIONS)
      setAdminUnitsError(e?.message || 'Falha ao carregar unidades')
    } finally {
      setAdminUnitsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCrmMe()
  }, [loadCrmMe])

  useEffect(() => {
    if (!canAdmin) return
    void loadAdminUnits()
  }, [canAdmin, loadAdminUnits])

  useEffect(() => {
    if (!canAdmin) return
    void adminRefreshAll()
  }, [canAdmin])

  useEffect(() => {
    if (!FACE_IDENTIFICATION_ENABLED) return
    if (!enrollOpen) return
    if (enrollAutoRunning) return
    let alive = true
    enrollAbortRef.current = false
    setEnrollHint('Preparando câmera…')
    void ensureModelsUI(faceDetectorMode, { message: 'Preparando análise facial…' })
    void (async () => {
      const ok = await startCameraFor('admin', { silent: true, waitForVideoMs: 2400, suppressMissingVideoToast: true })
      if (!alive || !ok) return
      setEnrollHint('Câmera pronta. Centralize o rosto e aguarde.')
    })()
    return () => {
      alive = false
    }
  }, [enrollOpen, faceDetectorMode, enrollAutoRunning])

  useEffect(() => {
    if (enrollOpen) return
    void stopCameraUI({ silent: true })
  }, [enrollOpen])

  useEffect(() => {
    if (!FACE_IDENTIFICATION_ENABLED) return
    if (!enrollOpen) return
    if (!stream || cameraOwner !== 'admin') return
    void autoEnrollFace()
  }, [enrollOpen, stream, cameraOwner])

  useEffect(() => {
    streamRef.current = stream
  }, [stream])

  useEffect(() => {
    return () => {
      stopCamera(streamRef.current)
    }
  }, [])

  useEffect(() => {
    let alive = true
    setNewDeviceTokenQr(null)
    const val = String(newDeviceTokenOnce || '').trim()
    if (!val) return () => { alive = false }
    void (async () => {
      try {
        const url = await QRCode.toDataURL(val, { errorCorrectionLevel: 'M', margin: 1, width: 420 })
        if (!alive) return
        setNewDeviceTokenQr(url)
      } catch {
        if (!alive) return
        setNewDeviceTokenQr(null)
      }
    })()
    return () => { alive = false }
  }, [newDeviceTokenOnce])

  async function ensureModelsUI(nextMode?: FaceDetectorMode, opts?: { message?: string }) {
    const mode = nextMode || faceDetectorMode
    if (modelsReady === 'ready' && modelsLoaded === mode) return true
    setModelsReady('loading')
    setModelsError(null)
    setModelsProgress(0)
    setModelsMessage(
      opts?.message ||
      (mode === 'ssd' ? 'Carregando modelos robustos…' : 'Carregando modelos faciais…')
    )
    let progress = 0
    let timer: any = null
    const setProgress = (value: number) => {
      progress = Math.max(progress, Math.min(100, value))
      setModelsProgress(progress)
    }
    timer = setInterval(() => {
      if (progress >= 90) return
      progress = Math.min(90, progress + 3)
      setModelsProgress(progress)
    }, 500)
    try {
      await ensureFaceModels(mode, (done, total) => {
        const pct = total ? Math.round((done / total) * 100) : 0
        setProgress(Math.max(0, pct))
      })
      setModelsReady('ready')
      setModelsLoaded(mode)
      setModelsMessage(null)
      setProgress(100)
      return true
    } catch (e: any) {
      setModelsReady('error')
      setModelsError(e?.message || String(e))
      setModelsMessage(null)
      return false
    } finally {
      if (timer) clearInterval(timer)
    }
  }

  async function upgradeToSsd() {
    if (faceDetectorMode === 'ssd') return true
    setFaceDetectorMode('ssd')
    setFaceFailCount(0)
    return await ensureModelsUI('ssd', { message: FACE_FALLBACK_MESSAGE })
  }

  function noteFaceFailure() {
    if (faceDetectorMode === 'ssd') return
    setFaceFailCount((cur) => {
      const next = cur + 1
      if (next >= FACE_FALLBACK_THRESHOLD) {
        void upgradeToSsd()
      }
      return next
    })
  }

  function resetFaceFailures() {
    if (faceFailCount) setFaceFailCount(0)
  }

  async function startCameraFor(
    owner: 'admin',
    opts: { silent?: boolean; waitForVideoMs?: number; suppressMissingVideoToast?: boolean } = {}
  ) {
    const requestId = cameraRequestId.current + 1
    cameraRequestId.current = requestId
    const getVideoEl = () => adminVideoRef.current
    let videoEl = getVideoEl()
    const waitForVideoMs = Math.max(0, Number(opts.waitForVideoMs || 0))
    if (!videoEl && waitForVideoMs > 0) {
      const deadline = Date.now() + waitForVideoMs
      while (!videoEl && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 80))
        videoEl = getVideoEl()
      }
    }
    if (!videoEl) {
      if (!opts.suppressMissingVideoToast) toast.error('Vídeo não disponível')
      return false
    }
    setLoading(true)
    try {
      stopCamera(streamRef.current)
      const s = await startUserCamera(videoEl)
      if (requestId !== cameraRequestId.current) {
        stopCamera(s)
        return false
      }
      setStream(s)
      setCameraOwner(owner)
      if (!opts.silent) toast.success('Câmera ativa')
      return true
    } catch (e: any) {
      const errName = String(e?.name || '')
      if (errName === 'NotAllowedError') {
        toast.error('Permissão de câmera negada. Libere a câmera no navegador e tente novamente.')
      } else if (errName === 'NotReadableError') {
        toast.error('Não foi possível acessar a câmera. Feche outros apps que estejam usando a câmera e tente novamente.')
      } else if (errName === 'NotFoundError') {
        toast.error('Nenhuma câmera foi encontrada neste dispositivo.')
      } else {
        toast.error(e?.message || String(e))
      }
      toastErrorMeta(e)
      return false
    } finally {
      setLoading(false)
    }
  }

  async function stopCameraUI(opts: { silent?: boolean } = {}) {
    cameraRequestId.current += 1
    stopCamera(streamRef.current)
    setStream(null)
    setCameraOwner(null)
    if (!opts.silent) toast.message('Câmera desligada')
  }

  async function loadDiagnostics() {
    setDiagLoading(true)
    setDiagError(null)
    try {
      const [proxy, health] = await Promise.all([
        fetchJsonWithMeta('/api/ponto/_proxy-status'),
        fetchJsonWithMeta('/api/ponto/health'),
      ])
      setDiagProxy(proxy)
      setDiagHealth(health)
    } catch (e: any) {
      setDiagError(e?.message || String(e))
    } finally {
      setDiagLoading(false)
    }
  }

  async function meRefresh() {
    setMeLoading(true)
    setMeError(null)
    try {
      const res = await apiJson<PontoMeResponse>('/api/ponto/me', { headers: getDevEmployeeActorHeaders(devActorEmail) })
      setMe(res)
    } catch (e: any) {
      setMe(null)
      setMeError(e)
    } finally {
      setMeLoading(false)
    }
  }

  async function loadMyProfile() {
    setMyProfileLoading(true)
    setMyProfileError(null)
    try {
      const res = await apiJson<PontoMyProfileResponse>('/api/ponto/me/profile', { headers: getDevEmployeeActorHeaders(devActorEmail) })
      setMyProfile(res.data)
    } catch (e: any) {
      setMyProfile(null)
      setMyProfileError(e?.message || 'Perfil indisponível no momento')
    } finally {
      setMyProfileLoading(false)
    }
  }

  function ensureEmployeeUnitSelected() {
    if (!allowedUnits.length) {
      toast.error('Unidade não configurada')
      return null
    }
    if (allowedUnits.length && !resolvedMeUnit) {
      toast.error('Selecione a unidade')
      return null
    }
    return resolvedMeUnit || null
  }

  async function meLoadRecords() {
    setMeLoading(true)
    try {
      const unit = ensureEmployeeUnitSelected()
      if (allowedUnits.length && !unit) {
        setMeLoading(false)
        return
      }
      const qs = new URLSearchParams()
      if (meRecordsFrom) {
        const fromIso = toDateRangeISO(meRecordsFrom, 'start')
        if (fromIso) qs.set('from', fromIso)
      }
      if (meRecordsTo) {
        const toIso = toDateRangeISO(meRecordsTo, 'end')
        if (toIso) qs.set('to', toIso)
      }
      if (unit) qs.set('unit', unit)
      qs.set('limit', '500')
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord[] }>(
        '/api/ponto/me/records?' + qs.toString(),
        { headers: getDevEmployeeActorHeaders(devActorEmail) }
      )
      setMeRecords(res.data || [])
    } catch (e: any) {
      const details = e?.details as any
      if (details?.error === 'LOGIN_EMAIL_ALREADY_IN_USE') {
        toast.error(`Email já vinculado ao funcionário: ${details?.employeeName || details?.employeeId || 'outro usuário'}`)
      } else if (details?.error === 'UNIT_ACCESS_NOT_CONFIGURED') {
        toast.error('Unidade não configurada para este usuário')
      } else if (details?.error === 'UNIT_FORBIDDEN') {
        toast.error('Unidade não permitida')
      } else {
        toast.error(e?.message || String(e))
      }
      toastErrorMeta(e)
    } finally {
      setMeLoading(false)
    }
  }

  async function mePunchPin() {
    if (!me || !('linked' in me) || !me.linked) return toast.error('Usuário não vinculado a funcionário')
    const pin = mePin.trim()
    if (!pin) return toast.error('Informe o PIN')
    const unit = ensureEmployeeUnitSelected()
    if (allowedUnits.length && !unit) return
    setLoading(true)
    try {
      const presence = await apiJson<{ ok: boolean; data: { presenceMode: string; locationRequired: boolean; geofenceConfigured: boolean } }>(`/api/ponto/me/presence?unit=${encodeURIComponent(unit)}`, { headers: getDevEmployeeActorHeaders(devActorEmail) })
      if (presence.data.presenceMode === 'TERMINAL_REQUIRED') {
        toast.error('Esta unidade usa Terminal de Ponto. Registre no aparelho autorizado da unidade.')
        return
      }
      let location: { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string } | undefined
      if (presence.data.locationRequired) {
        if (!presence.data.geofenceConfigured || !navigator.geolocation) {
          toast.error('A política de trabalho externo desta unidade não está pronta para registrar localização.')
          return
        }
        const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }))
        location = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy, capturedAt: new Date().toISOString() }
      }
      const meta = createRequestMeta()
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord }>(
        '/api/ponto/me/punch',
        { method: 'POST', body: { pin, unit, location, ...meta }, headers: getDevEmployeeActorHeaders(devActorEmail) }
      )
      setMePin('')
      toast.success(getPunchConfirmation(res.data.eventType || res.data.type))
      setMePunchOpen(false)
      await meRefresh()
      await meLoadRecords()
    } catch (e: any) {
      const details = e?.details as any
      const code = String(details?.error || details?.code || '')
      if (code === 'PIN_INVALID') {
        toast.error('PIN inválido')
      } else if (code === 'PIN_NOT_SET') {
        toast.error('PIN não configurado para este funcionário')
      } else if (code === 'PIN_LOCKED') {
        toast.error(`PIN bloqueado. Aguarde ${details?.secondsRemaining || '?'}s e tente novamente.`)
      } else if (code === 'UNIT_ACCESS_NOT_CONFIGURED') {
        toast.error('Unidade não configurada para este usuário')
      } else if (code === 'UNIT_REQUIRED') {
        toast.error('Selecione a unidade')
      } else if (code === 'UNIT_FORBIDDEN') {
        toast.error('Unidade não permitida')
      } else if (code === 'COOLDOWN') {
        toast.error(`Aguarde ${details?.secondsRemaining || '?'}s para registrar novamente.`)
      } else if (code === 'LOCATION_REQUIRED') {
        toast.error('Permita a localização somente para esta marcação de trabalho externo.')
      } else if (code === 'LOCATION_INVALID' || code === 'LOCATION_POLICY_UNCONFIGURED') {
        toast.error('Não foi possível validar a localização para esta unidade.')
      } else if (code === 'TERMINAL_REQUIRED') {
        toast.error('Esta unidade exige o Terminal de Ponto autorizado.')
      } else {
        toast.error(e?.message || String(e))
      }
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void meRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devActorEmail])

  useEffect(() => {
    if (!me || !('linked' in me) || !me.linked) {
      setMyProfile(null)
      setMyProfileError(null)
      return
    }
    void loadMyProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, devActorEmail])

  useEffect(() => {
    if (!selectedEmployee) return
    setEditName(selectedEmployee.name || '')
    setEditCode(selectedEmployee.code || '')
    setEditCpf(selectedEmployee.cpf || '')
    setEditBirthDate(selectedEmployee.birthDate || '')
    setEditJobTitle(selectedEmployee.jobTitle || '')
    setEditPhone(selectedEmployee.phone || '')
    setEditEmail(selectedEmployee.loginEmail || '')
    setEditUnit(selectedEmployee.unit || '')
    setEditActive(selectedEmployee.active !== false)
    setEditPin('')
  }, [selectedEmployee])

  useEffect(() => {
    if (!me || !('linked' in me) || !me.linked) return
    if (!meRecordsFrom || !meRecordsTo) return
    if (unitMissing) return
    void meLoadRecords()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, meRecordsFrom, meRecordsTo, unitMissing])

  async function adminRefreshAll() {
    if (!canAdmin) return toast.error('Acesso restrito')
    setLoading(true)
    try {
      const [emps, devs] = await Promise.all([
        apiJson<{ ok: boolean; data: PontoEmployeePublic[] }>('/api/ponto/admin/employees'),
        apiJson<{ ok: boolean; data: PontoDevicePublic[] }>('/api/ponto/admin/devices')
      ])
      setAdminEmployees(emps.data || [])
      setAdminDevices(devs.data || [])
      const linkedUnits = Array.from(new Set((emps.data || []).flatMap((employee) => [...(employee.units || []), employee.unit || '']).filter(Boolean)))
      if (linkedUnits.length) {
        setAdminUnitOptions((current) => {
          const merged = new Map(current.map((unit) => [unit.value, unit]))
          for (const unit of linkedUnits) if (!merged.has(unit)) merged.set(unit, { value: unit, label: formatUnitLabel(unit) })
          return Array.from(merged.values())
        })
      }
      if (!selectedEmployeeId && (emps.data || []).length) setSelectedEmployeeId(emps.data[0].id)
      toast.success('Dados atualizados')
    } catch (e: any) {
      toast.error(e?.message || String(e))
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  async function adminLoadEmployeeDetail(employeeId: string) {
    if (!canManageCanonicalEmployee) return
    if (!employeeId) return
    try {
      const res = await apiJson<{ ok: boolean; data: PontoEmployeePublic }>(
        '/api/ponto/admin/employees/' + employeeId
      )
      setAdminEmployees((prev) =>
        prev.map((e) => (e.id === employeeId ? res.data : e))
      )
      if (selectedEmployeeId === employeeId || !selectedEmployeeId) {
        setEditName(res.data.name || '')
        setEditCode(res.data.code || '')
        setEditCpf(res.data.cpf || '')
        setEditBirthDate(res.data.birthDate || '')
        setEditJobTitle(res.data.jobTitle || '')
        setEditPhone(res.data.phone || '')
        setEditEmail(res.data.loginEmail || '')
        setEditUnit(res.data.unit || '')
        setEditActive(res.data.active !== false)
        setEditPin('')
      }
    } catch (e: any) {
      toastErrorMeta(e)
    }
  }

  async function adminCreateEmployee(opts: { enrollAfter?: boolean } = {}) {
    if (!canManageCanonicalEmployee) return toast.error('Cadastro restrito ao Supervisor')
    const name = newEmployeeName.trim()
    if (!name) return toast.error('Nome é obrigatório')
    const loginEmail = newEmployeeLoginEmail.trim()
    if (!loginEmail || !loginEmail.includes('@')) return toast.error('Email inválido')
    const unit = newEmployeeUnit.trim()
    if (!unit) return toast.error('Unidade é obrigatória')
    const pin = newEmployeePin.trim()
    if (pin.length < 4) return toast.error('PIN deve ter pelo menos 4 dígitos')
    setLoading(true)
    try {
      const res = await apiJson<{ ok: boolean; data: PontoEmployeePublic }>(
        '/api/ponto/admin/employees',
        {
          method: 'POST',
          body: {
            name,
            code: newEmployeeCode.trim(),
            cpf: newEmployeeCpf.trim(),
            birthDate: newEmployeeBirthDate.trim(),
            jobTitle: newEmployeeJobTitle.trim(),
            phone: newEmployeePhone.trim(),
            loginEmail,
            unit
          }
        }
      )
      await apiJson('/api/ponto/admin/employees/' + res.data.id + '/pin', {
        method: 'POST',
        body: { pin }
      })
      setNewEmployeeName('')
      setNewEmployeeCode('')
      setNewEmployeeCpf('')
      setNewEmployeeBirthDate('')
      setNewEmployeeJobTitle('')
      setNewEmployeePhone('')
      setNewEmployeeLoginEmail('')
      setNewEmployeeUnit('')
      setNewEmployeePin('')
      setNewEmployeeOpen(false)
      setSelectedEmployeeId(res.data.id)
      await adminRefreshAll()
      if (opts.enrollAfter && FACE_IDENTIFICATION_ENABLED) {
        setEnrollOpen(true)
      }
      toast.success('Funcionário criado e configurado')
    } catch (e: any) {
      const details = e?.details as any
      if (details?.error === 'LOGIN_EMAIL_ALREADY_IN_USE') {
        toast.error(`Email já vinculado ao funcionário: ${details?.employeeName || details?.employeeId || 'outro usuário'}`)
      } else {
        toast.error(e?.message || String(e))
      }
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  async function saveEnroll(descriptors: number[][], replace: boolean) {
    await apiJson('/api/ponto/admin/employees/' + selectedEmployeeId + '/enroll', {
      method: 'POST',
      body: { descriptors, replace, consentConfirmed: true }
    })
    await adminRefreshAll()
    resetFaceFailures()
  }

  async function autoEnrollFace() {
    if (!FACE_IDENTIFICATION_ENABLED) return
    if (enrollAutoRunning) return
    if (!canManageCanonicalEmployee || !selectedEmployeeId) return
    if (!stream || cameraOwner !== 'admin') return
    let videoEl = adminVideoRef.current
    if (!videoEl) {
      const deadline = Date.now() + 2400
      while (!videoEl && Date.now() < deadline) {
        if (enrollAbortRef.current) return
        await new Promise(r => setTimeout(r, 80))
        videoEl = adminVideoRef.current
      }
      if (!videoEl) {
        setEnrollHint('Não foi possível iniciar a câmera. Feche e tente novamente.')
        return
      }
    }

    enrollAbortRef.current = false
    resetFaceFailures()
    const ok = await ensureModelsUI(faceDetectorMode)
    if (!ok) return toast.error('Modelos faciais indisponíveis (use PIN)')

    const minSamples = 3
    const maxSamples = 7
    const targetScore = 0.85
    const descriptors: number[][] = []
    const scores: number[] = []
    const replace = (selectedEmployee?.faceDescriptorsCount || 0) >= 5

    setEnrollAutoRunning(true)
    setEnrollProgress({ total: maxSamples, done: 0 })
    setEnrollHint('Centralize o rosto e aguarde')

    try {
      while (!enrollAbortRef.current && descriptors.length < maxSamples) {
        try {
          const info = await detectDescriptorWithInfo(videoEl, faceDetectorMode)
          descriptors.push(info.descriptor)
          if (typeof info.score === 'number') scores.push(info.score)
          setEnrollProgress({ total: maxSamples, done: descriptors.length })
          const guide = getEnrollHint(info, videoEl)
          setEnrollHint(`Leitura ${descriptors.length}/${maxSamples} capturada. ${guide}`)

          if (descriptors.length >= minSamples) {
            const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.9
            if (avgScore >= targetScore) break
          }
          await new Promise(r => setTimeout(r, 500))
        } catch (e: any) {
          if (isFaceDetectionError(e)) {
            noteFaceFailure()
            const raw = await detectFaceRaw(videoEl, faceDetectorMode).catch(() => null)
            setEnrollHint(getEnrollHint(raw, videoEl))
            await new Promise(r => setTimeout(r, 350))
            continue
          }
          throw e
        }
      }

      if (enrollAbortRef.current) return
      if (descriptors.length < minSamples) {
        toast.error('Não foi possível capturar biometria com qualidade suficiente')
        setEnrollHint('Qualidade insuficiente. Ajuste posição e iluminação e tente novamente.')
        return
      }

      await saveEnroll(descriptors, replace)
      toast.success('Biometria cadastrada')
      setEnrollHint('Biometria salva com sucesso.')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setEnrollAutoRunning(false)
      setEnrollProgress(null)
    }
  }

  async function adminSaveEmployeeEdit() {
    if (!canManageCanonicalEmployee) return toast.error('Alteração restrita ao Supervisor')
    if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
    const name = editName.trim()
    if (!name) return toast.error('Nome é obrigatório')
    const email = editEmail.trim()
    if (email && !email.includes('@')) return toast.error('Email inválido')
    const unit = editUnit.trim()
    if (!unit) return toast.error('Unidade é obrigatória')
    const pin = editPin.trim()
    if (pin && pin.length < 4) return toast.error('PIN inválido (mínimo 4)')
    setLoading(true)
    try {
      await apiJson('/api/ponto/admin/employees/' + selectedEmployeeId, {
        method: 'PATCH',
        body: {
          name,
          code: editCode.trim(),
          cpf: editCpf.trim(),
          birthDate: editBirthDate.trim(),
          jobTitle: editJobTitle.trim(),
          phone: editPhone.trim(),
          loginEmail: email || '',
          unit,
          active: !!editActive
        }
      })
      if (pin) {
        await apiJson(`/api/ponto/admin/employees/${selectedEmployeeId}/pin`, {
          method: 'POST',
          body: { pin }
        })
      }
      await adminRefreshAll()
      toast.success('Cadastro atualizado')
      setEditOpen(false)
      setEditPin('')
    } catch (e: any) {
      const details = e?.details as any
      if (details?.error === 'LOGIN_EMAIL_ALREADY_IN_USE') {
        toast.error(`Email já vinculado ao funcionário: ${details?.employeeName || details?.employeeId || 'outro usuário'}`)
      } else {
        toast.error(e?.message || String(e))
      }
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  async function adminDeleteEmployee() {
    if (!canManageCanonicalEmployee) return toast.error('Desligamento restrito ao Supervisor')
    if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
    const name = selectedEmployee?.name || 'este funcionário'
    const confirmed = window.confirm(`Tem certeza que deseja remover ${name}?`)
    if (!confirmed) return
    setLoading(true)
    try {
      await apiJson(`/api/ponto/admin/employees/${selectedEmployeeId}`, { method: 'DELETE' })
      await adminRefreshAll()
      toast.success('Funcionário removido')
      setEditOpen(false)
      setSelectedEmployeeId('')
    } catch (e: any) {
      toast.error(e?.message || String(e))
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  function openSelectEmployee(action: 'enroll' | 'edit' | 'records') {
    if (action === 'enroll' && !FACE_IDENTIFICATION_ENABLED) {
      toast.error('A identificação facial está temporariamente desativada. Use PIN para marcações.')
      return
    }
    if (!adminEmployees.length) void adminRefreshAll()
    setSelectEmployeeAction(action)
    setSelectEmployeeQuery('')
    setSelectEmployeeOpen(true)
  }

  function handleSelectEmployee(id: string) {
    setSelectedEmployeeId(id)
    setSelectEmployeeOpen(false)
    if (selectEmployeeAction === 'enroll') {
      if (!FACE_IDENTIFICATION_ENABLED) {
        toast.error('A identificação facial está temporariamente desativada. Use PIN para marcações.')
        return
      }
      setEnrollOpen(true)
    } else if (selectEmployeeAction === 'edit') {
      setEditOpen(true)
      void adminLoadEmployeeDetail(id)
    } else {
      setRecordsOpen(true)
      void adminLoadSelectedRecords()
    }
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {}
      const action = String(detail.action || '').trim()
      if (!action) return
      if (!canAdminActions) {
        toast.error('Acesso restrito a gestores')
        return
      }
      if (action === 'create') {
        if (!canManageCanonicalEmployee) return toast.error('Cadastro canônico restrito ao Supervisor')
        setNewEmployeeOpen(true)
        return
      }
      if (action === 'edit') {
        if (!canManageCanonicalEmployee) return toast.error('Alteração cadastral restrita ao Supervisor')
        openSelectEmployee('edit')
        return
      }
      if (action === 'records') {
        openSelectEmployee('records')
        return
      }
      if (action === 'device') {
        if (!adminDevices.length) void adminRefreshAll()
        setManageDevicesOpen(true)
      }
    }
    window.addEventListener('skincos:ponto:action', handler as EventListener)
    return () => window.removeEventListener('skincos:ponto:action', handler as EventListener)
  }, [canAdminActions, canManageCanonicalEmployee, adminDevices.length, adminRefreshAll, openSelectEmployee])

  async function adminLoadSelectedRecords() {
    if (!canAdminActions) return toast.error('Acesso restrito a gestores')
    if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
    setSelectedRecordsLoading(true)
    setSelectedRecordsError(null)
    try {
      const qs = new URLSearchParams()
      qs.set('employeeId', selectedEmployeeId)
      qs.set('limit', '200')
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord[] }>(
        '/api/ponto/admin/records?' + qs.toString(),
        {}
      )
      setSelectedRecords(res.data || [])
    } catch (e: any) {
      const msg = e?.message || String(e)
      setSelectedRecordsError(msg)
      toast.error(msg)
      toastErrorMeta(e)
    } finally {
      setSelectedRecordsLoading(false)
    }
  }

  async function adminLoadEmailConflicts() {
    if (!canManageCanonicalEmployee) return toast.error('Resolução restrita ao Supervisor')
    setConflictsLoading(true)
    setConflictsError(null)
    try {
      const res = await apiJson<{ ok: boolean; data: PontoEmailConflict[] }>(
        '/api/ponto/admin/conflicts/login-email',
        {}
      )
      setEmailConflicts(res.data || [])
    } catch (e: any) {
      const msg = e?.message || String(e)
      setConflictsError(msg)
      toast.error(msg)
      toastErrorMeta(e)
    } finally {
      setConflictsLoading(false)
    }
  }

  async function adminResolveEmailConflict(email: string, keepEmployeeId: string) {
    if (!canManageCanonicalEmployee) return toast.error('Resolução restrita ao Supervisor')
    setConflictsLoading(true)
    setConflictsError(null)
    try {
      await apiJson('/api/ponto/admin/conflicts/login-email/resolve', {
        method: 'POST',
        body: { email, keepEmployeeId }
      })
      await adminRefreshAll()
      await adminLoadEmailConflicts()
      toast.success('Vínculo resolvido')
    } catch (e: any) {
      const msg = e?.message || String(e)
      setConflictsError(msg)
      toast.error(msg)
      toastErrorMeta(e)
    } finally {
      setConflictsLoading(false)
    }
  }

  async function adminCreateDevice() {
    if (!canManageDevices) return toast.error('Gestão de dispositivos restrita a gerentes')
    if (!newDeviceUnit.trim()) return toast.error('Unidade é obrigatória')
    setLoading(true)
    try {
      const res = await apiJson<{ ok: boolean; data: PontoDevicePublic & { token: string } }>(
        '/api/ponto/admin/devices',
        { method: 'POST', body: { unit: newDeviceUnit.trim(), label: newDeviceLabel.trim(), deviceMode: 'TERMINAL', networkPolicy: newDeviceNetworkPolicy, allowedNetworks: newDeviceNetworks.split(',').map((value) => value.trim()).filter(Boolean) } }
      )
      setNewDeviceTokenOnce(res.data.token)
      setNewDeviceLabel('')
      setNewDeviceNetworks('')
      await adminRefreshAll()
      toast.success('Dispositivo criado')
    } catch (e: any) {
      toast.error(e?.message || String(e))
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  async function loadPresencePolicy(unitId: string) {
    if (!unitId || !canManageDevices) return
    setPresencePolicyLoading(true)
    try {
      const response = await apiJson<{ ok: boolean; data: PontoPresencePolicy }>('/api/ponto/presence-policies/' + encodeURIComponent(unitId))
      setPresencePolicyUnit(unitId)
      setPresencePolicy(response.data)
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível carregar a política de presença')
      toastErrorMeta(e)
    } finally { setPresencePolicyLoading(false) }
  }

  async function savePresencePolicy() {
    if (!presencePolicy || !presencePolicyUnit || !canManageDevices) return
    setPresencePolicyLoading(true)
    try {
      const response = await apiJson<{ ok: boolean; data: PontoPresencePolicy }>('/api/ponto/presence-policies/' + encodeURIComponent(presencePolicyUnit), { method: 'PATCH', body: presencePolicy })
      setPresencePolicy(response.data)
      toast.success('Política de presença atualizada')
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível salvar a política de presença')
      toastErrorMeta(e)
    } finally { setPresencePolicyLoading(false) }
  }

  async function adminRevokeDevice(deviceId: string) {
    if (!canManageDevices) return toast.error('Gestão de dispositivos restrita a gerentes')
    setLoading(true)
    try {
      await apiJson('/api/ponto/admin/devices/' + deviceId + '/revoke', { method: 'POST' })
      await adminRefreshAll()
      toast.success('Dispositivo revogado')
    } catch (e: any) {
      toast.error(e?.message || String(e))
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  async function adminLoadRecords() {
    if (!canAdminActions) return toast.error('Acesso restrito a gestores')
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (recordsFrom) qs.set('from', new Date(recordsFrom).toISOString())
      if (recordsTo) qs.set('to', new Date(recordsTo).toISOString())
      if (selectedEmployeeId) qs.set('employeeId', selectedEmployeeId)
      qs.set('limit', '500')
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord[] }>(
        '/api/ponto/admin/records?' + qs.toString(),
        {}
      )
      setRecords(res.data || [])
      toast.success('Registros carregados')
    } catch (e: any) {
      toast.error(e?.message || String(e))
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  async function adminExportCsv() {
    if (!canAdminActions) return toast.error('Acesso restrito a gestores')
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (recordsFrom) qs.set('from', new Date(recordsFrom).toISOString())
      if (recordsTo) qs.set('to', new Date(recordsTo).toISOString())
      if (selectedEmployeeId) qs.set('employeeId', selectedEmployeeId)
      const blob = await apiBlob('/api/ponto/admin/records.csv?' + qs.toString())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'ponto_records.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('CSV gerado')
    } catch (e: any) {
      toast.error(e?.message || String(e))
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  function selectedMonthBounds() {
    if (!/^\d{4}-\d{2}$/.test(managementMonth)) return null
    const [year, month] = managementMonth.split('-').map(Number)
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return { from: `${managementMonth}-01`, to: `${managementMonth}-${String(lastDay).padStart(2, '0')}` }
  }

  async function loadMonthlyManagement() {
    if (!selectedEmployeeId || !managementUnit) return toast.error('Selecione funcionário e unidade')
    setMonthlyLoading(true); setMonthlyError(null)
    try {
      const query = new URLSearchParams({ employeeId: selectedEmployeeId, unitId: managementUnit, month: managementMonth })
      const response = await apiJson<{ ok: true; data: PontoMonthlyResult }>(`/api/ponto/monthly?${query}`)
      setMonthlyResult(response.data)
    } catch (error: any) { setMonthlyError(error?.message || String(error)); toastErrorMeta(error) } finally { setMonthlyLoading(false) }
  }

  async function loadCorrections() {
    setCorrectionsLoading(true)
    try {
      const query = new URLSearchParams({ status: 'PENDING' })
      if (managementUnit) query.set('unitId', managementUnit)
      const response = await apiJson<{ ok: true; data: PontoCorrection[] }>(`/api/ponto/corrections?${query}`)
      setCorrections(response.data || [])
    } catch (error: any) { toast.error(error?.message || String(error)); toastErrorMeta(error) } finally { setCorrectionsLoading(false) }
  }

  function openCorrection(record: PontoPunchRecord) {
    setCorrectionEvent(record)
    setCorrectionAt(toDateTimeLocalValue(new Date(record.corrected?.at || record.at)))
    setCorrectionReason('')
    setCorrectionOpen(true)
  }

  async function requestCorrection() {
    if (!correctionEvent || !correctionReason.trim()) return toast.error('Informe a justificativa')
    const proposed = new Date(correctionAt)
    if (!Number.isFinite(proposed.getTime())) return toast.error('Informe uma data válida')
    setLoading(true)
    try {
      await apiJson('/api/ponto/corrections', { method: 'POST', body: { eventId: correctionEvent.id, proposedAtUtc: proposed.toISOString(), reason: correctionReason.trim() } })
      setCorrectionOpen(false); toast.success('Correção enviada para aprovação'); await loadCorrections()
    } catch (error: any) { toast.error(error?.message || String(error)); toastErrorMeta(error) } finally { setLoading(false) }
  }

  async function decideCorrection(correction: PontoCorrection, decision: 'approve' | 'reject') {
    const reason = window.prompt(decision === 'approve' ? 'Justificativa da aprovação:' : 'Justificativa da recusa:')?.trim()
    if (!reason) return
    setLoading(true)
    try {
      await apiJson(`/api/ponto/corrections/${correction.id}/${decision}`, { method: 'POST', body: { reason } })
      toast.success(decision === 'approve' ? 'Correção aprovada' : 'Correção recusada'); await loadCorrections(); if (monthlyResult) await loadMonthlyManagement()
    } catch (error: any) { toast.error(error?.message || String(error)); toastErrorMeta(error) } finally { setLoading(false) }
  }

  async function closeManagementPeriod() {
    const bounds = selectedMonthBounds()
    if (!bounds || !selectedEmployeeId || !managementUnit || !periodReason.trim()) return toast.error('Selecione funcionário, unidade, mês e informe a justificativa')
    if (!window.confirm(`Fechar ${managementMonth} para ${selectedEmployee?.name || 'o funcionário'}? As batidas serão bloqueadas.`)) return
    setLoading(true)
    try {
      const response = await apiJson<{ ok: true; data: { id: string } }>('/api/ponto/periods/close', { method: 'POST', body: { employeeId: selectedEmployeeId, unitId: managementUnit, ...bounds, reason: periodReason.trim() } })
      setLastClosureId(response.data.id); toast.success('Período fechado com snapshot'); await loadMonthlyManagement()
    } catch (error: any) { toast.error(error?.message || String(error)); toastErrorMeta(error) } finally { setLoading(false) }
  }

  async function reopenManagementPeriod() {
    if (!lastClosureId || !periodReason.trim()) return toast.error('Informe a justificativa e carregue um fechamento desta sessão')
    if (!window.confirm('Reabrir o período? Esta ação será auditada.')) return
    setLoading(true)
    try {
      await apiJson('/api/ponto/periods/reopen', { method: 'POST', body: { closureId: lastClosureId, reason: periodReason.trim() } })
      setLastClosureId(''); toast.success('Período reaberto'); await loadMonthlyManagement()
    } catch (error: any) { toast.error(error?.message || String(error)); toastErrorMeta(error) } finally { setLoading(false) }
  }

  return (
    <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1" />
          <div className="flex flex-wrap items-center gap-2">
            {loading ? <Badge variant="secondary">Processando…</Badge> : null}
            {modelsReady === 'ready' ? <Badge variant="outline">Face OK</Badge> : null}
            {modelsReady === 'error' ? <Badge variant="destructive">Face indisponível</Badge> : null}
          </div>
        </div>

      <Dialog open={diagOpen} onOpenChange={setDiagOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Diagnóstico do Ponto</DialogTitle>
            <DialogDescription>Verifique rapidamente versão e conectividade (CRM → Proxy → Worker).</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {diagLoading ? (
                <Badge variant="secondary">
                  <LoadingPercentText label="Carregando" className="text-xs text-white/80" showPercent={false} />
                </Badge>
              ) : null}
              {diagError ? <Badge variant="destructive">Erro</Badge> : null}
              <Button variant="secondary" onClick={loadDiagnostics} disabled={diagLoading}>Atualizar</Button>
            </div>

            {diagError ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                <div className="font-medium">Falha ao carregar diagnóstico</div>
                <div className="opacity-80">{diagError}</div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Proxy status</CardTitle>
                  <CardDescription className="break-words">
                    <span className="font-mono">GET /api/ponto/_proxy-status</span>
                    {diagProxy?.requestId ? <> • request: <span className="font-mono">{diagProxy.requestId}</span></> : null}
                    {diagProxy?.cfRay ? <> • cf-ray: <span className="font-mono">{diagProxy.cfRay}</span></> : null}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3">
                    {diagProxy
                      ? JSON.stringify(diagProxy.json ?? { ok: diagProxy.ok, status: diagProxy.status, nonJson: true }, null, 2)
                      : '—'}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Health</CardTitle>
                  <CardDescription className="break-words">
                    <span className="font-mono">GET /api/ponto/health</span>
                    {diagHealth?.requestId ? <> • request: <span className="font-mono">{diagHealth.requestId}</span></> : null}
                    {diagHealth?.cfRay ? <> • cf-ray: <span className="font-mono">{diagHealth.cfRay}</span></> : null}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3">
                    {diagHealth
                      ? JSON.stringify(diagHealth.json ?? { ok: diagHealth.ok, status: diagHealth.status, nonJson: true }, null, 2)
                      : '—'}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Meu ponto</CardTitle>
            <CardDescription>Registre sua jornada usando seu PIN.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {meLoading ? (
                  <Badge variant="secondary">
                    <LoadingPercentText label="Carregando" className="text-xs text-white/80" showPercent={false} />
                  </Badge>
                ) : null}
                {meLinked ? (
                  <>
                    <Badge>Funcionário: {meLinked.employee?.name || '-'}</Badge>
                    <Badge variant="outline">Autenticação: PIN</Badge>
                    <Badge variant="outline">PIN: {meLinked.pinSet ? 'OK' : '—'}</Badge>
                    {meLinked.cooldown?.active ? (
                      <Badge variant="secondary">Cooldown: {meLinked.cooldown.secondsRemaining ?? '?'}s</Badge>
                    ) : null}
                  </>
                ) : null}
              </div>

              {meLinked ? (
                <div className="rounded-md border p-3 text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Nome</div>
                      <div className="font-medium">{meLinked.employee?.name || crmMe?.user?.displayName || crmMe?.user?.username || crmMe?.user?.email || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">CPF</div>
                      <div className="font-medium">{maskSensitive((meLinked.employee as any)?.cpf || (crmMe?.user as any)?.cpf, '***.***.***-**')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Data Nascimento</div>
                      <div className="font-medium">{maskSensitive((meLinked.employee as any)?.birthDate || (meLinked.employee as any)?.dob || (crmMe?.user as any)?.birthDate, '**/**/****')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Cargo</div>
                      <div className="font-medium">{(meLinked.employee as any)?.role || (meLinked.employee as any)?.jobTitle || (crmMe?.user as any)?.role || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">E-mail</div>
                      <div className="font-medium">{meLinked.employee?.loginEmail || meLinked.actorEmail || crmMe?.user?.email || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Telefone</div>
                      <div className="font-medium">{maskSensitive((meLinked.employee as any)?.phone || (meLinked.employee as any)?.phoneRaw || (crmMe?.user as any)?.phone, '(**) *****-****')}</div>
                    </div>
                  </div>
                  {meLinked.linked ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                      Última batida: {meLinked.lastPunch ? `${fmtDate(meLinked.lastPunch.at)} • ${getPunchTypeLabel(meLinked.lastPunch.eventType || meLinked.lastPunch.type)} • ${meLinked.lastPunch.method || '-'}` : '—'}
                    </div>
                  ) : null}
                </div>
              ) : meError ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                  <div className="font-medium">Falha ao carregar</div>
                  <div className="opacity-80">{meError?.message || 'Erro desconhecido'}</div>
                </div>
              ) : me && 'linked' in me && !me.linked ? (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  Conta não vinculada a um funcionário ainda.
                </div>
              ) : null}

              {me && 'linked' in me && me.linked ? (
                allowedUnits.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2 md:col-span-1">
                      <Label>Unidade</Label>
                      {allowedUnits.length > 1 ? (
                        <Select value={resolvedMeUnit} onValueChange={setMeUnit}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            {allowedUnits.map((unit) => (
                              <SelectItem key={unit} value={unit}>
                                {unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">Unidade: {allowedUnits[0]}</Badge>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                    <div className="font-medium">Unidade não configurada</div>
                    <div className="opacity-80">Seu usuário não possui unidade permitida. Contate o gestor.</div>
                  </div>
                )
              ) : null}

              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                Próxima ação: <strong>{nextPunchAction.label}</strong>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setMePunchOpen(true)
                  }}
                  disabled={meLoading || !(me && 'linked' in me && me.linked) || unitMissing}
                >
                  {nextPunchAction.label}
                </Button>
              </div>
          </CardContent>
        </Card>

        {meLinked ? (
          <Card>
            <CardHeader>
              <CardTitle>Meu perfil profissional</CardTitle>
              <CardDescription>Dados vinculados ao seu cadastro canônico de funcionário. Documentos pessoais permanecem protegidos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {myProfileLoading ? <div className="text-sm text-muted-foreground">Carregando perfil…</div> : null}
              {myProfileError ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <div className="font-medium">Perfil ainda não disponível</div>
                  <div className="opacity-80">{myProfileError}</div>
                </div>
              ) : null}
              {profile ? (
                <>
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                    {profileMissingSummary(profile, myProfile?.completeness.missing || [])}
                  </div>
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                    <div className="space-y-3 rounded-md border p-4">
                      <div className="font-medium">Identificação e vínculo</div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                        <div><div className="text-xs text-muted-foreground">Nome completo</div><div>{profileValue(profile.legalName)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Nome social</div><div>{profileValue(profile.socialName)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Matrícula</div><div>{profileValue(profile.employeeCode)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Status</div><div>{profileValue(profile.status)}</div></div>
                        <div><div className="text-xs text-muted-foreground">E-mail de acesso</div><div className="break-all">{profileValue(profile.loginEmail)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Celular</div><div>{profileValue(profile.mobilePhone)}</div></div>
                      </div>
                    </div>
                    <div className="space-y-3 rounded-md border p-4">
                      <div className="font-medium">Organização</div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                        <div><div className="text-xs text-muted-foreground">Cargo</div><div>{profileValue(profile.jobTitle)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Admissão</div><div>{profileValue(profile.admittedAt)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Grupo</div><div>{profileValue(profile.groupName)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Departamento</div><div>{profileValue(profile.departmentName)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Líder imediato</div><div>{profileValue(profile.manager?.name)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Unidades</div><div>{profile.units.length ? profile.units.join(', ') : 'Não informado'}</div></div>
                      </div>
                    </div>
                    <div className="space-y-3 rounded-md border p-4">
                      <div className="font-medium">Dados pessoais</div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                        <div><div className="text-xs text-muted-foreground">Data de nascimento</div><div>{profileValue(profile.birthDate)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Naturalidade</div><div>{profileValue(profile.birthPlace)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Grau de instrução</div><div>{profileValue(profile.educationLevel)}</div></div>
                        <div><div className="text-xs text-muted-foreground">E-mail pessoal</div><div className="break-all">{profileValue(profile.personalEmail)}</div></div>
                      </div>
                    </div>
                    <div className="space-y-3 rounded-md border p-4">
                      <div className="font-medium">Endereço e documentos</div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                        <div><div className="text-xs text-muted-foreground">CEP</div><div>{profileValue(profile.address.zipCode)}</div></div>
                        <div><div className="text-xs text-muted-foreground">Cidade / Estado</div><div>{[profile.address.city, profile.address.state].filter(Boolean).join(' / ') || 'Não informado'}</div></div>
                        <div className="sm:col-span-2"><div className="text-xs text-muted-foreground">Endereço</div><div>{[profile.address.street, profile.address.number, profile.address.complement, profile.address.neighborhood].filter(Boolean).join(', ') || 'Não informado'}</div></div>
                        <div className="sm:col-span-2 text-xs text-muted-foreground">CPF: {profile.documents.cpf.toLowerCase()} • PIS: {profile.documents.pis.toLowerCase()} • RG: {profile.documents.rg.toLowerCase()} • filiação: {profile.documents.family.toLowerCase()}</div>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Meu histórico</CardTitle>
            <CardDescription>As marcações do período aparecem aqui automaticamente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="ponto-history-from">De</Label>
                <Input id="ponto-history-from" type="date" value={meRecordsFrom} onChange={(e) => setMeRecordsFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ponto-history-to">Até</Label>
                <Input id="ponto-history-to" type="date" value={meRecordsTo} onChange={(e) => setMeRecordsTo(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button variant="outline" onClick={meLoadRecords} disabled={meLoading || !(me && 'linked' in me && me.linked) || unitMissing}>
                  Atualizar histórico
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Método</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="text-sm">{fmtDate(record.at)}</TableCell>
                      <TableCell><Badge variant="outline">{getPunchTypeLabel(record.eventType || record.type)}</Badge></TableCell>
                      <TableCell className="text-sm">{record.unit || '-'}</TableCell>
                      <TableCell className="text-sm">{record.method || '-'}</TableCell>
                    </TableRow>
                  ))}
                  {!meRecords.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">{meLoading ? 'Carregando registros…' : 'Nenhum registro no período.'}</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {canAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>Gestão do ponto</CardTitle>
              <CardDescription>Espelho mensal, inconsistências, correções, banco de horas e fechamento.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="ponto-management-employee">Funcionário</Label>
                  <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                    <SelectTrigger id="ponto-management-employee"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>{adminEmployees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}{employee.active === false ? ' (desligado)' : ''}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ponto-management-unit">Unidade</Label>
                  <Select value={managementUnit} onValueChange={setManagementUnit}>
                    <SelectTrigger id="ponto-management-unit"><SelectValue placeholder="Selecione...">{adminUnitOptions.find((unit) => unit.value === managementUnit)?.label || managementUnit}</SelectValue></SelectTrigger>
                    <SelectContent>{adminUnitOptions.map((unit) => <SelectItem key={unit.value} value={unit.value}>{unit.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ponto-management-month">Mês</Label>
                  <Input id="ponto-management-month" type="month" value={managementMonth} onChange={(event) => setManagementMonth(event.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={loadMonthlyManagement} disabled={monthlyLoading || !selectedEmployeeId || !managementUnit}>{monthlyLoading ? 'Calculando…' : 'Carregar espelho'}</Button>
                <Button variant="outline" onClick={loadCorrections} disabled={correctionsLoading}>{correctionsLoading ? 'Carregando…' : 'Atualizar correções'}</Button>
                <Button variant="outline" onClick={() => setManageDevicesOpen(true)} disabled={!canAdminActions}>Dispositivos e exportação</Button>
                <Button variant="outline" onClick={() => setDiagOpen(true)}>Diagnóstico</Button>
              </div>
              {monthlyError ? <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">{monthlyError}</div> : null}
              {monthlyResult ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Previsto: {monthlyResult.days.reduce((sum, day) => sum + day.expectedMinutes, 0)} min</Badge>
                    <Badge variant="outline">Trabalhado: {monthlyResult.days.reduce((sum, day) => sum + day.workedMinutes, 0)} min</Badge>
                    <Badge variant={monthlyResult.closingBalanceMinutes < 0 ? 'destructive' : 'secondary'}>Saldo: {monthlyResult.closingBalanceMinutes} min</Badge>
                    <Badge variant="outline">Inconsistências: {monthlyResult.days.reduce((sum, day) => sum + day.inconsistencies.length, 0)}</Badge>
                  </div>
                  <div className="max-h-72 overflow-auto rounded-lg border" tabIndex={0} aria-label="Espelho mensal do ponto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Dia</TableHead><TableHead>Previsto</TableHead><TableHead>Trabalhado</TableHead><TableHead>Intervalo</TableHead><TableHead>Saldo</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
                      <TableBody>{monthlyResult.days.map((day) => <TableRow key={day.date}><TableCell>{day.date.split('-').reverse().join('/')}</TableCell><TableCell>{day.expectedMinutes} min</TableCell><TableCell>{day.workedMinutes} min</TableCell><TableCell>{day.breakMinutes} min</TableCell><TableCell>{day.dailyBalanceMinutes} min</TableCell><TableCell><Badge variant={day.inconsistencies.length ? 'destructive' : 'outline'}>{day.frozen ? 'Fechado' : day.status}</Badge></TableCell></TableRow>)}</TableBody>
                    </Table>
                  </div>
                </div>
              ) : <div className="text-sm text-muted-foreground">Selecione os filtros e carregue o espelho mensal.</div>}
              {canClosePeriod ? (
                <div className="rounded-lg border p-3 space-y-3">
                  <div className="font-medium">Fechamento mensal</div>
                  <Label htmlFor="ponto-period-reason">Justificativa obrigatória</Label>
                  <Input id="ponto-period-reason" value={periodReason} onChange={(event) => setPeriodReason(event.target.value)} placeholder="Motivo do fechamento ou reabertura" />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={closeManagementPeriod} disabled={loading || !monthlyResult}>Fechar período</Button>
                    <Button variant="destructive" onClick={reopenManagementPeriod} disabled={loading || !lastClosureId}>Reabrir último fechamento</Button>
                  </div>
                  <div className="text-xs text-muted-foreground">A reabertura exige permissão de Supervisor/Administrador, justificativa e gera auditoria.</div>
                </div>
              ) : null}
              <div className="space-y-2">
                <div className="font-medium">Solicitações de correção pendentes</div>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader><TableRow><TableHead>Funcionário</TableHead><TableHead>Original</TableHead><TableHead>Proposto</TableHead><TableHead>Motivo</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {corrections.map((correction) => <TableRow key={correction.id}><TableCell>{correction.employeeName}</TableCell><TableCell>{fmtDate(correction.originalAtUtc)}</TableCell><TableCell>{fmtDate(correction.proposedAtUtc)}</TableCell><TableCell className="max-w-56 truncate" title={correction.reason}>{correction.reason}</TableCell><TableCell><div className="flex gap-2">{canApproveCorrection ? <><Button size="sm" onClick={() => decideCorrection(correction, 'approve')}>Aprovar</Button><Button size="sm" variant="outline" onClick={() => decideCorrection(correction, 'reject')}>Recusar</Button></> : <Badge variant="outline">Aguardando Supervisor</Badge>}</div></TableCell></TableRow>)}
                      {!corrections.length ? <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">Nenhuma solicitação pendente carregada.</TableCell></TableRow> : null}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Dialog
          open={mePunchOpen}
          onOpenChange={(open) => {
            setMePunchOpen(open)
            if (!open) setMePin('')
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{nextPunchAction.label}</DialogTitle>
              <DialogDescription>Confirme esta marcação com seu PIN. A identificação facial está indisponível neste momento.</DialogDescription>
            </DialogHeader>
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void mePunchPin() }}>
              <div className="space-y-2">
                <Label htmlFor="ponto-me-pin">PIN</Label>
                <Input id="ponto-me-pin" value={mePin} onChange={(e) => setMePin(e.target.value)} type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={12} placeholder="••••" autoFocus />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setMePunchOpen(false)} disabled={loading}>Cancelar</Button>
                <Button type="submit" disabled={loading || !mePin.trim()}>{nextPunchAction.label}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Solicitar correção</DialogTitle>
            <DialogDescription>O evento original será preservado. A alteração só vale após aprovação autorizada.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">Registro original: <strong>{fmtDate(correctionEvent?.at)}</strong></div>
            <div className="space-y-2"><Label htmlFor="ponto-correction-at">Novo horário</Label><Input id="ponto-correction-at" type="datetime-local" value={correctionAt} onChange={(event) => setCorrectionAt(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="ponto-correction-reason">Justificativa</Label><Input id="ponto-correction-reason" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Explique o motivo da correção" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCorrectionOpen(false)}>Cancelar</Button><Button onClick={requestCorrection} disabled={loading || !correctionReason.trim()}>Enviar para aprovação</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newEmployeeOpen} onOpenChange={setNewEmployeeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Cadastrar funcionário</DialogTitle>
            <DialogDescription>Preencha os dados abaixo para criar o funcionário.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={newEmployeeName} onChange={(e) => setNewEmployeeName(e.target.value)} placeholder="Nome..." />
            </div>
            <div className="space-y-2">
              <Label>Código (opcional)</Label>
              <Input value={newEmployeeCode} onChange={(e) => setNewEmployeeCode(e.target.value)} placeholder="Matrícula..." />
            </div>
            <div className="space-y-2">
              <Label>CPF (opcional)</Label>
              <Input value={newEmployeeCpf} onChange={(e) => setNewEmployeeCpf(e.target.value)} placeholder="Somente números" />
            </div>
            <div className="space-y-2">
              <Label>Data de nascimento (opcional)</Label>
              <Input type="date" value={newEmployeeBirthDate} onChange={(e) => setNewEmployeeBirthDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Cargo (opcional)</Label>
              <Input value={newEmployeeJobTitle} onChange={(e) => setNewEmployeeJobTitle(e.target.value)} placeholder="Cargo..." />
            </div>
            <div className="space-y-2">
              <Label>Telefone (opcional)</Label>
              <Input value={newEmployeePhone} onChange={(e) => setNewEmployeePhone(e.target.value)} placeholder="Telefone..." />
            </div>
            <div className="space-y-2">
              <Label>Email (vínculo login)</Label>
              <Input
                value={newEmployeeLoginEmail}
                onChange={(e) => setNewEmployeeLoginEmail(e.target.value)}
                placeholder="ex: funcionario@empresa.com"
              />
            </div>
            <div className="space-y-2">
              <Label>PIN (min. 4)</Label>
              <Input value={newEmployeePin} onChange={(e) => setNewEmployeePin(e.target.value)} inputMode="numeric" placeholder="••••" />
            </div>
            <div className="space-y-2">
              <Label>Unidade</Label>
              <Select value={newEmployeeUnit} onValueChange={setNewEmployeeUnit} disabled={adminUnitsLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {adminUnitOptions.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {adminUnitsError ? <div className="text-xs text-muted-foreground">{adminUnitsError}</div> : null}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNewEmployeeOpen(false)} disabled={loading}>Cancelar</Button>
            <Button
              onClick={() => adminCreateEmployee()}
              disabled={
                loading ||
                !canManageCanonicalEmployee ||
                !newEmployeeName.trim() ||
                !newEmployeeLoginEmail.trim() ||
                !newEmployeeLoginEmail.includes('@') ||
                newEmployeePin.trim().length < 4 ||
                !newEmployeeUnit.trim()
              }
            >
              Salvar
            </Button>
            <Button
              variant="secondary"
              onClick={() => adminCreateEmployee({ enrollAfter: true })}
              disabled={
                loading ||
                !FACE_IDENTIFICATION_ENABLED ||
                !canManageCanonicalEmployee ||
                !newEmployeeName.trim() ||
                !newEmployeeLoginEmail.trim() ||
                !newEmployeeLoginEmail.includes('@') ||
                newEmployeePin.trim().length < 4 ||
                !newEmployeeUnit.trim()
              }
            >
              Biometria temporariamente desativada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={selectEmployeeOpen} onOpenChange={setSelectEmployeeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Selecionar funcionário</DialogTitle>
            <DialogDescription>Escolha quem você deseja {selectEmployeeAction === 'enroll' ? 'cadastrar biometria' : selectEmployeeAction === 'edit' ? 'editar' : 'exportar registros'}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Buscar</Label>
              <Input
                value={selectEmployeeQuery}
                onChange={(e) => setSelectEmployeeQuery(e.target.value)}
                placeholder="Nome, email ou código"
              />
            </div>
            <div className="max-h-72 overflow-auto rounded-lg border">
              {filteredAdminEmployees.length ? (
                <div className="divide-y">
                  {filteredAdminEmployees.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => handleSelectEmployee(e.id)}
                      className="w-full text-left px-3 py-2 hover:bg-muted/40"
                    >
                      <div className="font-medium">{e.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.loginEmail || '—'} {e.unit ? `• ${formatUnitLabel(e.unit)}` : ''} {e.active === false ? '• inativo' : ''}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-sm text-muted-foreground">Nenhum funcionário encontrado.</div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSelectEmployeeOpen(false)} disabled={loading}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={enrollOpen}
        onOpenChange={(open) => {
          if (!open) return closeEnrollDialog()
          if (!FACE_IDENTIFICATION_ENABLED) return
          setEnrollOpen(true)
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Biometria facial</DialogTitle>
            <DialogDescription>
              {selectedEmployee
                ? `Funcionário: ${selectedEmployee.name}`
                : 'Selecione um funcionário.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {!FACE_IDENTIFICATION_ENABLED ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-muted-foreground">
                A identificação facial está temporariamente desativada. As marcações devem ser confirmadas por PIN.
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                {selectedEmployee ? (
                  <>Biometrias cadastradas: {selectedEmployee.faceDescriptorsCount || 0} • Última atualização: {fmtDate(selectedEmployee.lastEnrolledAt)}</>
                ) : null}
              </div>
              {enrollProgress ? <Badge variant="secondary">{enrollProgress.done}/{enrollProgress.total}</Badge> : null}
            </div>

            {FACE_IDENTIFICATION_ENABLED ? (
              <div className="rounded-xl overflow-hidden border bg-black">
                <video ref={adminVideoRef} className="w-full aspect-video object-cover" playsInline muted autoPlay />
              </div>
            ) : null}

            <div className="text-sm text-muted-foreground">{enrollHint}</div>
            {enrollAutoRunning ? (
              <div className="text-xs text-muted-foreground">Capturando automaticamente…</div>
            ) : null}
            {modelsReady === 'loading' ? (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">
                  <LoadingPercentText label={(modelsMessage || 'Carregando modelos faciais').replace(/[.…]+$/, '')} className="text-muted-foreground" showPercent={false} />
                </div>
                <div className="h-2 rounded bg-muted/40 overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${modelsProgress}%` }} />
                </div>
                <div className="text-xs text-muted-foreground">{modelsProgress}%</div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeEnrollDialog} disabled={loading}>Fechar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => setEditOpen(open)}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar cadastro</DialogTitle>
            <DialogDescription>Atualize os dados do funcionário.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nome" />
            </div>
            <div className="space-y-2">
              <Label>Código (opcional)</Label>
              <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="Matrícula" />
            </div>
            <div className="space-y-2">
              <Label>CPF (opcional)</Label>
              <Input value={editCpf} onChange={(e) => setEditCpf(e.target.value)} placeholder="Somente números" />
            </div>
            <div className="space-y-2">
              <Label>Data de nascimento (opcional)</Label>
              <Input type="date" value={editBirthDate} onChange={(e) => setEditBirthDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Cargo (opcional)</Label>
              <Input value={editJobTitle} onChange={(e) => setEditJobTitle(e.target.value)} placeholder="Cargo..." />
            </div>
            <div className="space-y-2">
              <Label>Telefone (opcional)</Label>
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Telefone..." />
            </div>
            <div className="space-y-2">
              <Label>Email (vínculo login)</Label>
              <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="ex: funcionario@empresa.com" />
            </div>
            <div className="space-y-2">
              <Label>PIN (min. 4)</Label>
              <Input value={editPin} onChange={(e) => setEditPin(e.target.value)} inputMode="numeric" placeholder="Deixe em branco para manter" />
            </div>
            <div className="space-y-2">
              <Label>Unidade</Label>
              <Select value={editUnit} onValueChange={setEditUnit} disabled={adminUnitsLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {adminUnitOptions.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {adminUnitsError ? <div className="text-xs text-muted-foreground">{adminUnitsError}</div> : null}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
              <span>Funcionario ativo</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={loading}>Cancelar</Button>
            <Button variant="destructive" onClick={adminDeleteEmployee} disabled={loading || !selectedEmployeeId || !canManageCanonicalEmployee}>Desligar</Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
                if (!FACE_IDENTIFICATION_ENABLED) return toast.error('A identificação facial está temporariamente desativada. Use PIN para marcações.')
                setEditOpen(false)
                setEnrollOpen(true)
              }}
              disabled={loading || !FACE_IDENTIFICATION_ENABLED || !selectedEmployeeId || !canManageCanonicalEmployee}
            >
              Biometria temporariamente desativada
            </Button>
            <Button onClick={adminSaveEmployeeEdit} disabled={loading || !selectedEmployeeId || !editUnit.trim() || !canManageCanonicalEmployee}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conflictsOpen} onOpenChange={setConflictsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Duplicidades de email</DialogTitle>
            <DialogDescription>Resolva conflitos de vínculo por email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {conflictsLoading ? (
              <div className="text-sm text-muted-foreground">
                <LoadingPercentText label="Carregando" showPercent={false} />
              </div>
            ) : null}
            {conflictsError ? <div className="text-sm text-destructive">{conflictsError}</div> : null}
            {!conflictsLoading && !emailConflicts.length ? (
              <div className="text-sm text-muted-foreground">Nenhuma duplicidade encontrada.</div>
            ) : null}
            {emailConflicts.map((c) => (
              <div key={c.email} className="rounded-lg border p-3">
                <div className="text-sm font-medium">{c.email}</div>
                <div className="mt-2 space-y-2">
                  {c.employees.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-medium">{e.name}</span>
                        {e.unit ? <span className="text-muted-foreground"> • {formatUnitLabel(e.unit)}</span> : null}
                        {e.active === false ? <span className="text-muted-foreground"> • inativo</span> : null}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={conflictsLoading}
                        onClick={() => adminResolveEmailConflict(c.email, e.id)}
                      >
                        Manter este
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflictsOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={recordsOpen}
        onOpenChange={(open) => setRecordsOpen(open)}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Registros do funcionario</DialogTitle>
            <DialogDescription>
              {selectedEmployee ? `Funcionario: ${selectedEmployee.name}` : 'Selecione um funcionario.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button onClick={adminLoadSelectedRecords} disabled={selectedRecordsLoading || !selectedEmployeeId}>Atualizar</Button>
              {selectedRecordsLoading ? (
                <Badge variant="secondary">
                  <LoadingPercentText label="Carregando" className="text-xs text-white/80" showPercent={false} />
                </Badge>
              ) : null}
              {selectedRecordsError ? <Badge variant="destructive">Erro</Badge> : null}
            </div>
            {selectedRecordsError ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                <div className="font-medium">Falha ao carregar registros</div>
                <div className="opacity-80">{selectedRecordsError}</div>
              </div>
            ) : null}
            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Metodo</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedRecords.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{fmtDate(r.at)}</TableCell>
                      <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                      <TableCell className="text-sm">{r.unit || '-'}</TableCell>
                      <TableCell className="text-sm">{r.method || '-'}</TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={() => openCorrection(r)}>Corrigir</Button></TableCell>
                    </TableRow>
                  ))}
                  {!selectedRecords.length ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">Nenhum registro.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manageDevicesOpen} onOpenChange={setManageDevicesOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Gerenciar dispositivo</DialogTitle>
            <DialogDescription>Crie tokens por unidade e exporte registros.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="font-medium">Novo dispositivo</div>
              <p className="text-sm text-muted-foreground">O terminal usa PIN, horário do servidor e unidade fixada no próprio dispositivo. Reconhecimento facial permanece bloqueado.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                <div className="space-y-2">
                  <Label>Unidade</Label>
                  <Input value={newDeviceUnit} onChange={(e) => setNewDeviceUnit(e.target.value)} placeholder="ex: unidade-01" />
                </div>
                <div className="space-y-2">
                  <Label>Rótulo</Label>
                  <Input value={newDeviceLabel} onChange={(e) => setNewDeviceLabel(e.target.value)} placeholder="Recepção, Sala 1..." />
                </div>
                <div className="space-y-2">
                  <Label>Rede</Label>
                  <Select value={newDeviceNetworkPolicy} onValueChange={(value) => setNewDeviceNetworkPolicy(value as 'NONE' | 'OBSERVE' | 'REQUIRE')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="OBSERVE">Observar</SelectItem><SelectItem value="REQUIRE">Exigir rede</SelectItem><SelectItem value="NONE">Sem evidência</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 xl:col-span-2">
                  <Label>CIDRs IPv4 públicos</Label>
                  <Input value={newDeviceNetworks} onChange={(e) => setNewDeviceNetworks(e.target.value)} placeholder="ex: 203.0.113.10/32, 198.51.100.0/24" />
                </div>
                <div className="flex items-end">
                  <Button onClick={adminCreateDevice} disabled={loading || !canManageDevices}>Criar token</Button>
                </div>
              </div>
              {newDeviceTokenOnce ? (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="text-sm">Token (mostrado uma única vez):</div>
                  <div className="font-mono text-sm break-all">{newDeviceTokenOnce}</div>
                  {newDeviceTokenQr ? (
                    <div className="flex flex-col items-center gap-2">
                      <img src={newDeviceTokenQr} alt="QR do token" className="w-56 h-56 rounded-md border" />
                      <div className="text-xs text-muted-foreground">Use apenas durante o provisionamento físico do terminal; não divulgue este QR.</div>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard?.writeText?.(newDeviceTokenOnce)
                        toast.success('Copiado')
                      }}
                    >
                      Copiar
                    </Button>
                    <Button variant="outline" onClick={() => setNewDeviceTokenOnce(null)}>Ocultar</Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border p-4 space-y-3">
              <div className="font-medium">Política de presença por unidade</div>
              <p className="text-sm text-muted-foreground">Terminal é o padrão. Trabalho externo pede localização apenas no momento da batida e registra só o resultado da verificação.</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="space-y-2"><Label>Unidade</Label><Input value={presencePolicyUnit} onChange={(e) => setPresencePolicyUnit(e.target.value)} placeholder="unidade-01" /></div>
                <div className="flex items-end"><Button variant="outline" onClick={() => void loadPresencePolicy(presencePolicyUnit)} disabled={presencePolicyLoading || !presencePolicyUnit}>Carregar</Button></div>
                {presencePolicy ? <>
                  <div className="space-y-2"><Label>Modo</Label><Select value={presencePolicy.presenceMode} onValueChange={(value) => setPresencePolicy((current) => current ? { ...current, presenceMode: value as PontoPresencePolicy['presenceMode'] } : current)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TERMINAL_REQUIRED">Terminal obrigatório</SelectItem><SelectItem value="EXTERNAL_REVIEW">Trabalho externo com revisão</SelectItem><SelectItem value="FLEXIBLE">Flexível</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><Label>Raio (m)</Label><Input type="number" min="25" max="5000" value={presencePolicy.geofenceRadiusMeters || 150} onChange={(e) => setPresencePolicy((current) => current ? { ...current, geofenceRadiusMeters: Number(e.target.value) } : current)} /></div>
                </> : null}
              </div>
              {presencePolicy ? <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><div className="space-y-2"><Label>Latitude da geocerca</Label><Input inputMode="decimal" value={presencePolicy.geofenceLatitude ?? ''} onChange={(e) => setPresencePolicy((current) => current ? { ...current, geofenceLatitude: e.target.value === '' ? null : Number(e.target.value) } : current)} /></div><div className="space-y-2"><Label>Longitude da geocerca</Label><Input inputMode="decimal" value={presencePolicy.geofenceLongitude ?? ''} onChange={(e) => setPresencePolicy((current) => current ? { ...current, geofenceLongitude: e.target.value === '' ? null : Number(e.target.value) } : current)} /></div><div className="flex items-end"><Button onClick={() => void savePresencePolicy()} disabled={presencePolicyLoading || !canManageDevices}>Salvar política</Button></div></div> : null}
            </div>

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Rótulo</TableHead>
                    <TableHead>Rede</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Último uso</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adminDevices.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.unit || '-'}</TableCell>
                      <TableCell>{d.label || '-'}</TableCell>
                      <TableCell className="text-sm">{d.networkPolicy === 'REQUIRE' ? `Obrigatória (${d.allowedNetworksCount || 0})` : d.networkPolicy === 'OBSERVE' ? 'Observada' : 'Não usada'}</TableCell>
                      <TableCell>{d.revokedAt ? <Badge variant="secondary">Revogado</Badge> : <Badge>Ativo</Badge>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(d.lastSeenAt)}</TableCell>
                      <TableCell className="text-right">
                        {!d.revokedAt ? (
                          <Button size="sm" variant="outline" onClick={() => adminRevokeDevice(d.id)} disabled={loading || !canManageDevices}>
                            Revogar
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!adminDevices.length ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">Nenhum dispositivo.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3">
              <div className="font-medium">Registros</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>De</Label>
                  <Input type="datetime-local" value={recordsFrom} onChange={(e) => setRecordsFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Até</Label>
                  <Input type="datetime-local" value={recordsTo} onChange={(e) => setRecordsTo(e.target.value)} />
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={adminLoadRecords} disabled={loading || !canAdminActions}>Buscar</Button>
                  <Button variant="outline" onClick={adminExportCsv} disabled={loading || !canAdminActions}>CSV</Button>
                </div>
              </div>

              <div className="border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quando</TableHead>
                      <TableHead>Funcionário</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Método</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{fmtDate(r.at)}</TableCell>
                        <TableCell className="font-medium">{r.employeeName}</TableCell>
                        <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                        <TableCell className="text-sm">{r.unit || '-'}</TableCell>
                        <TableCell className="text-sm">{r.method || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {!records.length ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-sm text-muted-foreground">Nenhum registro.</TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
