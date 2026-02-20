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

type ApiError = { ok?: boolean; error?: string; message?: string; code?: string; hint?: string }

type PontoEmployeePublic = {
  id: string
  code?: string
  name: string
  cpf?: string
  birthDate?: string
  jobTitle?: string
  phone?: string
  loginEmail?: string
  unit?: string
  active?: boolean
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
  faceDescriptorsCount?: number
  lastEnrolledAt?: string | null
  pinSet?: boolean
}

type PontoDevicePublic = {
  id: string
  label?: string
  unit?: string
  active?: boolean
  createdAt?: string
  revokedAt?: string | null
  lastSeenAt?: string | null
}

type PontoEmailConflict = {
  email: string
  count: number
  employees: PontoEmployeePublic[]
}

type PontoPunchRecord = {
  id: string
  kind: 'PUNCH'
  employeeId: string
  employeeName: string
  type: 'IN' | 'OUT' | string
  at: string
  unit?: string | null
  deviceId?: string | null
  deviceLabel?: string | null
  method?: 'FACE' | 'PIN' | 'ADMIN' | string
  matchDistance?: number | null
  note?: string | null
  corrected?: { id: string; at: string; reason?: string | null } | null
}

type PontoMeResponse =
  | { ok: true; linked: false; actorEmail?: string; hint?: string; allowedUnits?: string[] }
  | {
    ok: true
    linked: true
    actorEmail?: string
    allowedUnits?: string[]
    employee: PontoEmployeePublic
    hasFace: boolean
    pinSet: boolean
    lastPunch: PontoPunchRecord | null
    cooldown?: { active: boolean; secondsRemaining?: number }
    suggestedNextMethod?: 'FACE' | 'PIN'
  }

type FaceDetectorMode = 'tiny' | 'ssd'

const LS_DEV_ACTOR_EMAIL = 'skincos.ponto.devActorEmail.v1'

function errorMetaString(meta: { code?: string; requestId?: string; cfRay?: string }) {
  const parts: string[] = []
  if (meta.code) parts.push(`code:${meta.code}`)
  if (meta.requestId) parts.push(`req:${meta.requestId}`)
  if (meta.cfRay) parts.push(`cf:${meta.cfRay}`)
  return parts.length ? parts.join(' • ') : ''
}

const FACE_FALLBACK_THRESHOLD = 3
const FACE_FALLBACK_MESSAGE =
  'Condições ruins detectadas. Estamos melhorando a análise do rosto, aguarde alguns segundos.'

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

function b64UrlEncodeBytes(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64UrlEncodeString(input: string): string {
  const bytes = new TextEncoder().encode(input)
  return b64UrlEncodeBytes(bytes.buffer)
}

function getDevEmployeeActorHeaders(emailOverride?: string): Record<string, string> {
  if (!import.meta.env.DEV) return {}
  let email = ''
  if (emailOverride) {
    email = String(emailOverride).trim().toLowerCase()
  } else {
    try { email = String(localStorage.getItem(LS_DEV_ACTOR_EMAIL) || '').trim().toLowerCase() } catch { email = '' }
  }
  if (!email) return {}
  const actor = { email }
  const actorB64 = b64UrlEncodeString(JSON.stringify(actor))
  const actorTs = String(Date.now())
  return { 'x-skincos-actor': actorB64, 'x-skincos-actor-ts': actorTs }
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

function createRequestMeta() {
  return {
    requestId: (globalThis.crypto?.randomUUID?.() || String(Date.now())),
    clientTime: new Date().toISOString(),
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
    locale: navigator.language || 'pt-BR',
    appVersion: null as string | null
  }
}

async function apiJson<T>(
  path: string,
  opts: { method?: string; body?: unknown; adminToken?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}
): Promise<T> {
  const method = (opts.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers || {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.adminToken) headers.authorization = `Admin ${opts.adminToken}`
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal
  })
  const requestId = String(res.headers.get('x-request-id') || '').trim()
  const cfRay = String(res.headers.get('cf-ray') || '').trim()
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (res.ok) return json as T
  const nonJsonText = String(text || '')
  const htmlWorkerCrash = !json && (nonJsonText.includes('Worker threw exception') || nonJsonText.includes('Cloudflare Ray ID'))
  const err = ((json || {}) as ApiError)
  const inferredCode = htmlWorkerCrash ? 'UPSTREAM_WORKER_EXCEPTION' : ''
  const code = String(err.error || err.code || inferredCode || '').trim()
  const hintFromHtml = htmlWorkerCrash ? 'Falha no Worker upstream (Cloudflare 1101). Verifique logs com o request-id/cf-ray.' : ''
  const hint = typeof err.hint === 'string' ? err.hint.trim() : hintFromHtml
  const base = err.error || err.message || `HTTP ${res.status}`
  const meta = errorMetaString({ code, requestId, cfRay })
  const e = new Error([base, hint, meta].filter(Boolean).join(' • '))
  ;(e as any).details = json || (code ? { error: code } : null)
  ;(e as any).status = res.status
  ;(e as any).requestId = requestId
  ;(e as any).cfRay = cfRay
  ;(e as any).code = code
  ;(e as any).rawText = nonJsonText.slice(0, 240)
  throw e
}

async function apiBlob(path: string, opts: { adminToken?: string; signal?: AbortSignal } = {}): Promise<Blob> {
  const headers: Record<string, string> = {}
  if (opts.adminToken) headers.authorization = `Admin ${opts.adminToken}`
  const res = await fetch(path, { headers, credentials: 'include', signal: opts.signal })
  if (!res.ok) {
    const requestId = String(res.headers.get('x-request-id') || '').trim()
    const cfRay = String(res.headers.get('cf-ray') || '').trim()
    let msg = `HTTP ${res.status}`
    try {
      const json = (await res.json()) as ApiError
      msg = json.error || json.message || msg
    } catch { /* ignore */ }
    const meta = errorMetaString({ requestId, cfRay })
    const e = new Error([msg, meta].filter(Boolean).join(' • '))
    ;(e as any).status = res.status
    ;(e as any).requestId = requestId
    ;(e as any).cfRay = cfRay
    throw e
  }
  return await res.blob()
}

async function fetchJsonWithMeta(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; requestId: string; cfRay: string; json: any; text: string }> {
  const method = (opts.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers || {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'

  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal
  })

  const requestId = String(res.headers.get('x-request-id') || '').trim()
  const cfRay = String(res.headers.get('cf-ray') || '').trim()
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, requestId, cfRay, json, text }
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

async function captureDescriptor(videoEl: HTMLVideoElement, mode: FaceDetectorMode) {
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

async function detectDescriptorWithInfo(videoEl: HTMLVideoElement, mode: FaceDetectorMode) {
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
    descriptor: Array.from(detection.descriptor),
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

async function captureDescriptorStable(videoEl: HTMLVideoElement, samples = 2, waitMs = 220, mode: FaceDetectorMode) {
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

  const buildShaRaw = String(import.meta.env.VITE_BUILD_SHA || '').trim()
  const buildSha = buildShaRaw ? buildShaRaw.slice(0, 7) : (import.meta.env.DEV ? 'dev' : 'unknown')

  const [diagOpen, setDiagOpen] = useState(false)
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagError, setDiagError] = useState<string | null>(null)
  const [diagProxy, setDiagProxy] = useState<{ ok: boolean; status: number; requestId: string; cfRay: string; json: any; text: string } | null>(null)
  const [diagHealth, setDiagHealth] = useState<{ ok: boolean; status: number; requestId: string; cfRay: string; json: any; text: string } | null>(null)

  const [devActorEmail, setDevActorEmail] = useState(() => {
    try { return localStorage.getItem(LS_DEV_ACTOR_EMAIL) || '' } catch { return '' }
  })

  const employeeVideoRef = useRef<HTMLVideoElement | null>(null)
  const adminVideoRef = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraOwner, setCameraOwner] = useState<'employee' | 'admin' | null>(null)
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
  const [meHistoryOpen, setMeHistoryOpen] = useState(false)
  const [meStep, setMeStep] = useState<'face' | 'pin'>('face')
  const [meFaceAutoRunning, setMeFaceAutoRunning] = useState(false)
  const [meFaceStatus, setMeFaceStatus] = useState<string | null>(null)
  const [mePin, setMePin] = useState('')
  const [meUnit, setMeUnit] = useState('')
  const [meRecords, setMeRecords] = useState<PontoPunchRecord[]>([])
  const [meRecordsFrom, setMeRecordsFrom] = useState('')
  const [meRecordsTo, setMeRecordsTo] = useState('')

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

  const isDev = import.meta.env.DEV
  const crmRole = String(crmMe?.user?.role || '').toUpperCase()
  const canAdmin = crmRole === 'ADMIN' || crmRole === 'GESTOR' || crmRole === 'GERENTE'
  const canAdminActions = canAdmin
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
    if (!canAdminActions) return
    void loadAdminUnits()
  }, [canAdminActions, loadAdminUnits])

  useEffect(() => {
    if (!canAdminActions) return
    void adminRefreshAll()
  }, [canAdminActions])

  useEffect(() => {
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
      if (next >= FACE_FALLBACK_THRESHOLD && faceDetectorMode !== 'ssd') {
        void upgradeToSsd()
      }
      return next
    })
  }

  function resetFaceFailures() {
    if (faceFailCount) setFaceFailCount(0)
  }

  async function startCameraFor(
    owner: 'employee' | 'admin',
    opts: { silent?: boolean; waitForVideoMs?: number; suppressMissingVideoToast?: boolean } = {}
  ) {
    const requestId = cameraRequestId.current + 1
    cameraRequestId.current = requestId
    const getVideoEl = () => (owner === 'employee' ? employeeVideoRef.current : adminVideoRef.current)
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

  async function mePunchFace(opts: { auto?: boolean } = {}) {
    const auto = opts.auto === true
    if (!me || !('linked' in me) || !me.linked) {
      if (!auto) toast.error('Usuário não vinculado a funcionário')
      return false
    }
    if (!me.hasFace) {
      if (!auto) toast.error('Biometria facial não cadastrada (use PIN)')
      return false
    }
    if (!stream || cameraOwner !== 'employee') {
      if (!auto) toast.error('Ative a câmera')
      return false
    }
    const videoEl = employeeVideoRef.current
    if (!videoEl) {
      if (!auto) toast.error('Câmera não disponível')
      return false
    }
    const unit = ensureEmployeeUnitSelected()
    if (allowedUnits.length && !unit) return false
    const ok = await ensureModelsUI()
    if (!ok) {
      setMeStep('pin')
      if (!auto) toast.error('Modelos faciais indisponíveis (use PIN)')
      return false
    }

    setLoading(true)
    try {
      const descriptor = await captureDescriptorStable(videoEl, 2, 220, faceDetectorMode)
      resetFaceFailures()
      resetFaceFailures()
      const meta = createRequestMeta()
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord }>(
        '/api/ponto/me/punch',
        { method: 'POST', body: { descriptor, unit, ...meta }, headers: getDevEmployeeActorHeaders(devActorEmail) }
      )
      toast.success(`Ponto registrado (${res.data.type})`)
      setMePunchOpen(false)
      setMeStep('face')
      await stopCameraUI()
      await meRefresh()
      await meLoadRecords()
      return true
    } catch (e: any) {
      if (isFaceDetectionError(e)) {
        noteFaceFailure()
        if (!auto) {
          toast.error(e?.message || 'Não foi possível detectar o rosto. Ajuste a posição e tente novamente.')
          toastErrorMeta(e)
        }
        return false
      }
      const details = e?.details as any
      const code = String(details?.error || details?.code || '')
      if (code === 'COOLDOWN') {
        if (!auto) toast.error(`Aguarde ${details?.secondsRemaining || '?'}s para registrar novamente.`)
      } else if (code === 'UNIT_ACCESS_NOT_CONFIGURED') {
        if (!auto) toast.error('Unidade não configurada para este usuário')
      } else if (code === 'UNIT_REQUIRED') {
        if (!auto) toast.error('Selecione a unidade')
      } else if (code === 'UNIT_FORBIDDEN') {
        if (!auto) toast.error('Unidade não permitida')
      } else if (code === 'FACE_NOT_RECOGNIZED' || code === 'FACE_NOT_ENROLLED') {
        if (!auto) toast.error('Rosto não reconhecido. Use PIN.')
        setMeStep('pin')
        await stopCameraUI()
      } else {
        if (!auto) toast.error(e?.message || String(e))
        setMeStep('pin')
      }
      if (!auto) toastErrorMeta(e)
      return false
    } finally {
      setLoading(false)
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
      const meta = createRequestMeta()
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord }>(
        '/api/ponto/me/punch',
        { method: 'POST', body: { pin, unit, ...meta }, headers: getDevEmployeeActorHeaders(devActorEmail) }
      )
      setMePin('')
      toast.success(`Ponto registrado (${res.data.type})`)
      setMePunchOpen(false)
      setMeStep('face')
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

  useEffect(() => {
    if (!mePunchOpen) {
      setMeFaceAutoRunning(false)
      setMeFaceStatus(null)
    }
  }, [mePunchOpen])

  useEffect(() => {
    if (!mePunchOpen) return
    if (meStep !== 'face') return
    if (meFaceAutoRunning) return
    let alive = true
    setMeFaceAutoRunning(true)
    setMeFaceStatus('Preparando câmera…')
    void (async () => {
      if (!me || !('linked' in me) || !me.linked) {
        setMeFaceStatus('Usuário não vinculado. Use PIN.')
        setMeStep('pin')
        return
      }
      if (!me.hasFace) {
        setMeFaceStatus('Biometria não cadastrada. Use PIN.')
        setMeStep('pin')
        return
      }
      const unit = ensureEmployeeUnitSelected()
      if (allowedUnits.length && !unit) {
        setMeFaceStatus('Selecione a unidade para continuar.')
        return
      }
      const camOk = await startCameraFor('employee', { silent: true, waitForVideoMs: 2400, suppressMissingVideoToast: true })
      if (!alive) return
      if (!camOk) {
        setMeFaceStatus('Não foi possível acessar a câmera. Use PIN.')
        setMeStep('pin')
        return
      }
      setMeFaceStatus('Carregando análise facial…')
      const modelsOk = await ensureModelsUI(faceDetectorMode, { message: 'Carregando análise facial…' })
      if (!alive) return
      if (!modelsOk) {
        setMeFaceStatus('Não foi possível carregar a análise. Use PIN.')
        setMeStep('pin')
        await stopCameraUI({ silent: true })
        return
      }
      setMeFaceStatus('Analisando rosto…')
      const ok = await mePunchFace({ auto: true })
      if (!alive) return
      if (!ok) {
        setMeFaceStatus('Não foi possível reconhecer. Digite seu PIN.')
        setMeStep('pin')
        await stopCameraUI({ silent: true })
      }
    })().finally(() => {
      if (alive) setMeFaceAutoRunning(false)
    })
    return () => {
      alive = false
      setMeFaceAutoRunning(false)
    }
  }, [mePunchOpen, meStep, meFaceAutoRunning, faceDetectorMode, me, allowedUnits, resolvedMeUnit])

  async function adminRefreshAll() {
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
    setLoading(true)
    try {
      const [emps, devs] = await Promise.all([
        apiJson<{ ok: boolean; data: PontoEmployeePublic[] }>('/api/ponto/admin/employees'),
        apiJson<{ ok: boolean; data: PontoDevicePublic[] }>('/api/ponto/admin/devices')
      ])
      setAdminEmployees(emps.data || [])
      setAdminDevices(devs.data || [])
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
    if (!canAdminActions) return
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
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
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
      if (opts.enrollAfter) {
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
    if (enrollAutoRunning) return
    if (!canAdminActions || !selectedEmployeeId) return
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
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
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

  function openSelectEmployee(action: 'enroll' | 'edit' | 'records') {
    if (!adminEmployees.length) void adminRefreshAll()
    setSelectEmployeeAction(action)
    setSelectEmployeeQuery('')
    setSelectEmployeeOpen(true)
  }

  function handleSelectEmployee(id: string) {
    setSelectedEmployeeId(id)
    setSelectEmployeeOpen(false)
    if (selectEmployeeAction === 'enroll') {
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
        toast.error('Acesso restrito a administradores')
        return
      }
      if (action === 'create') {
        setNewEmployeeOpen(true)
        return
      }
      if (action === 'edit') {
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
  }, [canAdminActions, adminDevices.length, adminRefreshAll, openSelectEmployee])

  async function adminLoadSelectedRecords() {
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
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
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
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
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
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
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
    if (!newDeviceUnit.trim()) return toast.error('Unidade é obrigatória')
    setLoading(true)
    try {
      const res = await apiJson<{ ok: boolean; data: PontoDevicePublic; tokenOnce: string }>(
        '/api/ponto/admin/devices',
        { method: 'POST', body: { unit: newDeviceUnit.trim(), label: newDeviceLabel.trim() } }
      )
      setNewDeviceTokenOnce(res.tokenOnce)
      setNewDeviceLabel('')
      await adminRefreshAll()
      toast.success('Dispositivo criado')
    } catch (e: any) {
      toast.error(e?.message || String(e))
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  async function adminRevokeDevice(deviceId: string) {
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
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
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
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
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
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
              <Badge variant="outline" title={buildShaRaw || undefined}>Build: {buildSha}</Badge>
              {diagLoading ? <Badge variant="secondary">Carregando…</Badge> : null}
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
            <CardDescription>Registre sua entrada/saída</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {meLoading ? <Badge variant="secondary">Carregando…</Badge> : null}
                {me && 'linked' in me && me.linked ? (
                  <>
                    <Badge>Funcionário: {me.employee?.name || '-'}</Badge>
                    <Badge variant="outline">Face: {me.hasFace ? 'OK' : '—'}</Badge>
                    <Badge variant="outline">PIN: {me.pinSet ? 'OK' : '—'}</Badge>
                    {me.cooldown?.active ? (
                      <Badge variant="secondary">Cooldown: {me.cooldown.secondsRemaining ?? '?'}s</Badge>
                    ) : null}
                  </>
                ) : null}
              </div>

              {me && 'linked' in me ? (
                <div className="rounded-md border p-3 text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Nome</div>
                      <div className="font-medium">{me.employee?.name || crmMe?.user?.displayName || crmMe?.user?.username || crmMe?.user?.email || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">CPF</div>
                      <div className="font-medium">{maskSensitive((me.employee as any)?.cpf || (crmMe?.user as any)?.cpf, '***.***.***-**')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Data Nascimento</div>
                      <div className="font-medium">{maskSensitive((me.employee as any)?.birthDate || (me.employee as any)?.dob || (crmMe?.user as any)?.birthDate, '**/**/****')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Cargo</div>
                      <div className="font-medium">{(me.employee as any)?.role || (me.employee as any)?.jobTitle || (crmMe?.user as any)?.role || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">E-mail</div>
                      <div className="font-medium">{me.employee?.loginEmail || me.actorEmail || crmMe?.user?.email || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Telefone</div>
                      <div className="font-medium">{maskSensitive((me.employee as any)?.phone || (me.employee as any)?.phoneRaw || (crmMe?.user as any)?.phone, '(**) *****-****')}</div>
                    </div>
                  </div>
                  {me.linked ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                      Última batida: {me.lastPunch ? `${fmtDate(me.lastPunch.at)} • ${me.lastPunch.type} • ${me.lastPunch.method || '-'}` : '—'}
                    </div>
                  ) : null}
                </div>
              ) : meError ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                  <div className="font-medium">Falha ao carregar</div>
                  <div className="opacity-80">{meError?.message || 'Erro desconhecido'}</div>
                </div>
              ) : null}

              {me && 'linked' in me && me.linked ? (
                allowedUnits.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2 md:col-span-1">
                      <Label>Unidade</Label>
                      {allowedUnits.length > 1 ? (
                        <Select value={resolvedMeUnit || undefined} onValueChange={setMeUnit}>
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
                    <div className="opacity-80">Seu usuário não possui unidade permitida. Contate o administrador.</div>
                  </div>
                )
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    if (me && 'linked' in me && me.linked) setMeStep(me.hasFace ? 'face' : 'pin')
                    else setMeStep('pin')
                    setMePunchOpen(true)
                  }}
                  disabled={meLoading || !(me && 'linked' in me && me.linked) || unitMissing}
                >
                  Bater ponto
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setMeHistoryOpen(true)}
                  disabled={meLoading || !(me && 'linked' in me && me.linked) || unitMissing}
                >
                  Ver Histórico
                </Button>
              </div>
          </CardContent>
        </Card>

        <Dialog
          open={mePunchOpen}
          onOpenChange={(open) => {
            setMePunchOpen(open)
            if (!open) void stopCameraUI({ silent: true })
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bater ponto</DialogTitle>
              <DialogDescription>Prioridade: Face → PIN. O próximo método aparece só se o anterior falhar/indisponível.</DialogDescription>
            </DialogHeader>

            {meStep === 'face' ? (
              <div className="space-y-3">
                {meFaceStatus ? (
                  <div className="text-sm text-muted-foreground">{meFaceStatus}</div>
                ) : null}
                <div className="rounded-xl overflow-hidden border bg-black">
                  <video ref={employeeVideoRef} className="w-full aspect-video object-cover" playsInline muted autoPlay />
                </div>
                {modelsError ? <div className="text-sm text-red-600">Não foi possível carregar a análise facial.</div> : null}
                {modelsReady === 'loading' ? (
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">{modelsMessage || 'Carregando modelos faciais…'}</div>
                    <div className="h-2 rounded bg-muted/40 overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${modelsProgress}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground">{modelsProgress}%</div>
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setMePunchOpen(false)} disabled={loading}>Fechar</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>PIN</Label>
                  <Input value={mePin} onChange={(e) => setMePin(e.target.value)} inputMode="numeric" placeholder="••••" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={mePunchPin} disabled={loading}>Registrar por PIN</Button>
                  {me && 'linked' in me && me.linked && me.hasFace ? (
                    <Button variant="outline" onClick={() => setMeStep('face')} disabled={loading}>Tentar Face</Button>
                  ) : null}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog
          open={meHistoryOpen}
          onOpenChange={(open) => setMeHistoryOpen(open)}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Meu histórico</DialogTitle>
              <DialogDescription>Registros realizados no período selecionado.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>De</Label>
                  <Input type="date" value={meRecordsFrom} onChange={(e) => setMeRecordsFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Até</Label>
                  <Input type="date" value={meRecordsTo} onChange={(e) => setMeRecordsTo(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button onClick={meLoadRecords} disabled={meLoading || !(me && 'linked' in me && me.linked) || unitMissing}>Buscar</Button>
                </div>
              </div>

              <div className="border rounded-xl overflow-hidden">
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
                    {meRecords.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{fmtDate(r.at)}</TableCell>
                        <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                        <TableCell className="text-sm">{r.unit || '-'}</TableCell>
                        <TableCell className="text-sm">{r.method || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {!meRecords.length ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">Nenhum registro.</TableCell>
                      </TableRow>
                  ) : null}
                </TableBody>
              </Table>
              </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMeHistoryOpen(false)}>Fechar</Button>
            </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>

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
                !canAdminActions ||
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
                !canAdminActions ||
                !newEmployeeName.trim() ||
                !newEmployeeLoginEmail.trim() ||
                !newEmployeeLoginEmail.includes('@') ||
                newEmployeePin.trim().length < 4 ||
                !newEmployeeUnit.trim()
              }
            >
              Salvar e cadastrar biometria
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
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                {selectedEmployee ? (
                  <>Biometrias cadastradas: {selectedEmployee.faceDescriptorsCount || 0} • Última atualização: {fmtDate(selectedEmployee.lastEnrolledAt)}</>
                ) : null}
              </div>
              {enrollProgress ? <Badge variant="secondary">{enrollProgress.done}/{enrollProgress.total}</Badge> : null}
            </div>

            <div className="rounded-xl overflow-hidden border bg-black">
              <video ref={adminVideoRef} className="w-full aspect-video object-cover" playsInline muted autoPlay />
            </div>

            <div className="text-sm text-muted-foreground">{enrollHint}</div>
            {enrollAutoRunning ? (
              <div className="text-xs text-muted-foreground">Capturando automaticamente…</div>
            ) : null}
            {modelsReady === 'loading' ? (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">{modelsMessage || 'Carregando modelos faciais…'}</div>
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
            <Button
              variant="secondary"
              onClick={() => {
                if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
                setEditOpen(false)
                setEnrollOpen(true)
              }}
              disabled={loading || !selectedEmployeeId}
            >
              Cadastrar biometria
            </Button>
            <Button onClick={adminSaveEmployeeEdit} disabled={loading || !selectedEmployeeId || !editUnit.trim()}>Salvar</Button>
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
            {conflictsLoading ? <div className="text-sm text-muted-foreground">Carregando...</div> : null}
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
              {selectedRecordsLoading ? <Badge variant="secondary">Carregando…</Badge> : null}
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedRecords.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{fmtDate(r.at)}</TableCell>
                      <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                      <TableCell className="text-sm">{r.unit || '-'}</TableCell>
                      <TableCell className="text-sm">{r.method || '-'}</TableCell>
                    </TableRow>
                  ))}
                  {!selectedRecords.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">Nenhum registro.</TableCell>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Unidade</Label>
                  <Input value={newDeviceUnit} onChange={(e) => setNewDeviceUnit(e.target.value)} placeholder="ex: unidade-01" />
                </div>
                <div className="space-y-2">
                  <Label>Rótulo</Label>
                  <Input value={newDeviceLabel} onChange={(e) => setNewDeviceLabel(e.target.value)} placeholder="Recepção, Sala 1..." />
                </div>
                <div className="flex items-end">
                  <Button onClick={adminCreateDevice} disabled={loading || !canAdminActions}>Criar token</Button>
                </div>
              </div>
              {newDeviceTokenOnce ? (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="text-sm">Token (mostrado uma única vez):</div>
                  <div className="font-mono text-sm break-all">{newDeviceTokenOnce}</div>
                  {newDeviceTokenQr ? (
                    <div className="flex flex-col items-center gap-2">
                      <img src={newDeviceTokenQr} alt="QR do token" className="w-56 h-56 rounded-md border" />
                      <div className="text-xs text-muted-foreground">Escaneie no telefone do relógio para preencher o token.</div>
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

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Rótulo</TableHead>
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
                      <TableCell>{d.revokedAt ? <Badge variant="secondary">Revogado</Badge> : <Badge>Ativo</Badge>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(d.lastSeenAt)}</TableCell>
                      <TableCell className="text-right">
                        {!d.revokedAt ? (
                          <Button size="sm" variant="outline" onClick={() => adminRevokeDevice(d.id)} disabled={loading}>
                            Revogar
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!adminDevices.length ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">Nenhum dispositivo.</TableCell>
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
