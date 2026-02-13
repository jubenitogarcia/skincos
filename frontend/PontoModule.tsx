import React, { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { Label } from '@/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import * as QRCode from 'qrcode'

type ApiError = { ok?: boolean; error?: string; message?: string; code?: string; hint?: string }

type PontoEmployeePublic = {
  id: string
  code?: string
  name: string
  loginEmail?: string
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

const LS_DEVICE_TOKEN = 'skincos.ponto.deviceToken.v1'
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

function getDevEmployeeActorHeaders(): Record<string, string> {
  if (!import.meta.env.DEV) return {}
  let email = ''
  try { email = String(localStorage.getItem(LS_DEV_ACTOR_EMAIL) || '').trim().toLowerCase() } catch { email = '' }
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

function FaceModelsBadge({ state, mode }: { state: 'idle' | 'loading' | 'ready' | 'error'; mode?: FaceDetectorMode }) {
  if (state === 'ready') return <Badge variant="outline">Modelos: OK{mode === 'ssd' ? ' (robusto)' : ''}</Badge>
  if (state === 'loading') return <Badge variant="secondary">Modelos: carregando…</Badge>
  if (state === 'error') return <Badge variant="destructive">Modelos: erro</Badge>
  return null
}

function CameraStatusBadge({ active }: { active: boolean }) {
  return active ? <Badge>Camera: ativa</Badge> : null
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
  opts: { method?: string; body?: unknown; adminToken?: string; deviceToken?: string; signal?: AbortSignal; headers?: Record<string, string> } = {}
): Promise<T> {
  const method = (opts.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers || {}) }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.adminToken) headers.authorization = `Admin ${opts.adminToken}`
  if (opts.deviceToken) headers.authorization = `Device ${opts.deviceToken}`
  const res = await fetch(path, {
    method,
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
  const res = await fetch(path, { headers, signal: opts.signal })
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
  await faceBasePromise
  done = Math.max(done, 2)
  report('base')

  if (mode === 'ssd') {
    if (!faceSsdPromise) {
      faceSsdPromise = (async () => {
        await faceapi.nets.ssdMobilenetv1.loadFromUri('/face-models')
      })()
    }
    await faceSsdPromise
    done = Math.min(done + 1, total)
    report('ssd')
  } else {
    if (!faceTinyPromise) {
      faceTinyPromise = (async () => {
        await faceapi.nets.tinyFaceDetector.loadFromUri('/face-models')
      })()
    }
    await faceTinyPromise
    done = Math.min(done + 1, total)
    report('tiny')
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
  const [tab, setTab] = useState<'employee' | 'device' | 'admin'>('employee')

  const buildShaRaw = String(import.meta.env.VITE_BUILD_SHA || '').trim()
  const buildSha = buildShaRaw ? buildShaRaw.slice(0, 7) : (import.meta.env.DEV ? 'dev' : 'unknown')

  const [diagOpen, setDiagOpen] = useState(false)
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagError, setDiagError] = useState<string | null>(null)
  const [diagProxy, setDiagProxy] = useState<{ ok: boolean; status: number; requestId: string; cfRay: string; json: any; text: string } | null>(null)
  const [diagHealth, setDiagHealth] = useState<{ ok: boolean; status: number; requestId: string; cfRay: string; json: any; text: string } | null>(null)

  const [deviceToken, setDeviceToken] = useState(() => {
    try { return localStorage.getItem(LS_DEVICE_TOKEN) || '' } catch { return '' }
  })
  const [devActorEmail, setDevActorEmail] = useState(() => {
    try { return localStorage.getItem(LS_DEV_ACTOR_EMAIL) || '' } catch { return '' }
  })

  const employeeVideoRef = useRef<HTMLVideoElement | null>(null)
  const deviceVideoRef = useRef<HTMLVideoElement | null>(null)
  const adminVideoRef = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraOwner, setCameraOwner] = useState<'employee' | 'device' | 'admin' | null>(null)

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
  const [meStep, setMeStep] = useState<'face' | 'pin'>('face')
  const [mePin, setMePin] = useState('')
  const [meUnit, setMeUnit] = useState('')
  const [meRecords, setMeRecords] = useState<PontoPunchRecord[]>([])
  const [meRecordsFrom, setMeRecordsFrom] = useState('')
  const [meRecordsTo, setMeRecordsTo] = useState('')

  const [deviceStatus, setDeviceStatus] = useState<{ ok: boolean; unit?: string; device?: PontoDevicePublic } | null>(null)
  const [deviceEmployees, setDeviceEmployees] = useState<Array<{ id: string; name: string; code?: string; hasFace?: boolean; pinSet?: boolean }>>([])
  const [deviceConfig, setDeviceConfig] = useState<any>(null)
  const [identifyResult, setIdentifyResult] = useState<{
    match: { employeeId: string; name: string; distance: number } | null
    bestDistance: number | null
    threshold: number
  } | null>(null)
  // Avoid burning CPU in automated browser sessions (Playwright sets navigator.webdriver).
  const [autoIdentify, setAutoIdentify] = useState(() => !(typeof navigator !== 'undefined' && (navigator as any).webdriver))
  const [devicePinOpen, setDevicePinOpen] = useState(false)

  const [pinEmployeeId, setPinEmployeeId] = useState<string>('')
  const [pinValue, setPinValue] = useState<string>('')

  const [adminEmployees, setAdminEmployees] = useState<PontoEmployeePublic[]>([])
  const [adminDevices, setAdminDevices] = useState<PontoDevicePublic[]>([])
  const [records, setRecords] = useState<PontoPunchRecord[]>([])

  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [newEmployeeCode, setNewEmployeeCode] = useState('')
  const [newEmployeeLoginEmail, setNewEmployeeLoginEmail] = useState('')
  const [newEmployeePin, setNewEmployeePin] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('')
  const selectedEmployee = useMemo(() => adminEmployees.find(e => e.id === selectedEmployeeId) || null, [adminEmployees, selectedEmployeeId])

  const [enrollProgress, setEnrollProgress] = useState<{ total: number; done: number } | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrollHint, setEnrollHint] = useState<string>('Posicione o rosto no centro')
  const [enrollAutoRunning, setEnrollAutoRunning] = useState(false)
  const enrollAbortRef = useRef(false)

  const [newDeviceUnit, setNewDeviceUnit] = useState('')
  const [newDeviceLabel, setNewDeviceLabel] = useState('')
  const [newDeviceTokenOnce, setNewDeviceTokenOnce] = useState<string | null>(null)
  const [newDeviceTokenQr, setNewDeviceTokenQr] = useState<string | null>(null)

  const [qrScanOpen, setQrScanOpen] = useState(false)
  const [qrScanError, setQrScanError] = useState<string | null>(null)
  const qrVideoRef = useRef<HTMLVideoElement | null>(null)
  const qrControlsRef = useRef<any>(null)

  const [recordsFrom, setRecordsFrom] = useState('')
  const [recordsTo, setRecordsTo] = useState('')

  const [adminPunchType, setAdminPunchType] = useState<'AUTO' | 'IN' | 'OUT'>('AUTO')
  const [adminPunchUnit, setAdminPunchUnit] = useState('')
  const [adminPunchNote, setAdminPunchNote] = useState('')

  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editActive, setEditActive] = useState(true)

  const [recordsOpen, setRecordsOpen] = useState(false)
  const [selectedRecords, setSelectedRecords] = useState<PontoPunchRecord[]>([])
  const [selectedRecordsLoading, setSelectedRecordsLoading] = useState(false)
  const [selectedRecordsError, setSelectedRecordsError] = useState<string | null>(null)

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
    try { localStorage.setItem(LS_DEVICE_TOKEN, deviceToken) } catch { /* ignore */ }
  }, [deviceToken])

  useEffect(() => {
    try { localStorage.setItem(LS_DEV_ACTOR_EMAIL, devActorEmail) } catch { /* ignore */ }
  }, [devActorEmail])

  useEffect(() => {
    if (meRecordsFrom || meRecordsTo) return
    const now = new Date()
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    setMeRecordsFrom(toDateTimeLocalValue(from))
    setMeRecordsTo(toDateTimeLocalValue(now))
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
  const showAdminTab = canAdmin || isDev
  const canAdminActions = canAdmin || isDev

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
    void loadCrmMe()
  }, [loadCrmMe])

  useEffect(() => {
    if (!showAdminTab && tab === 'admin') setTab('employee')
  }, [showAdminTab, tab])

  useEffect(() => {
    if (!enrollOpen) return
    if (enrollAutoRunning) return
    enrollAbortRef.current = false
    setEnrollHint('Preparando câmera…')
    void ensureModelsUI(faceDetectorMode, { message: 'Preparando análise facial…' })
    void startCameraFor('admin', { silent: true, waitForVideoMs: 2400, suppressMissingVideoToast: true })
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

  const stopQrScan = React.useCallback(() => {
    try {
      qrControlsRef.current?.stop?.()
    } catch { /* ignore */ }
    qrControlsRef.current = null
  }, [])

  useEffect(() => {
    if (!qrScanOpen) {
      stopQrScan()
      setQrScanError(null)
      return
    }

    stopCamera(streamRef.current)
    setStream(null)
    setCameraOwner(null)

    let alive = true
    setQrScanError(null)
    void (async () => {
      try {
        const mod: any = await import('@zxing/browser')
        const Reader = mod?.BrowserMultiFormatReader
        if (!Reader) throw new Error('Scanner indisponível.')
        const reader = new Reader()
        const video = qrVideoRef.current
        if (!video) throw new Error('Pré-visualização indisponível.')
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } } as any,
          video,
          (result: any) => {
            if (!alive) return
            const raw = result?.getText ? String(result.getText() || '') : ''
            if (!raw) return
            stopQrScan()
            setDeviceToken(raw.trim())
            setQrScanOpen(false)
            toast.success('Token preenchido via QR')
          }
        )
        if (!alive) {
          try { controls?.stop?.() } catch { /* ignore */ }
          return
        }
        qrControlsRef.current = controls
      } catch (e: any) {
        if (!alive) return
        const msg = e?.message || 'Não foi possível iniciar o scanner. Verifique a permissão de câmera.'
        setQrScanError(msg)
      }
    })()

    return () => {
      alive = false
      stopQrScan()
    }
  }, [qrScanOpen, stopQrScan, stream])

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
    owner: 'employee' | 'device' | 'admin',
    opts: { silent?: boolean; waitForVideoMs?: number; suppressMissingVideoToast?: boolean } = {}
  ) {
    const getVideoEl = () => (
      owner === 'employee'
        ? employeeVideoRef.current
        : owner === 'device'
          ? deviceVideoRef.current
          : adminVideoRef.current
    )
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
      const res = await apiJson<PontoMeResponse>('/api/ponto/me', { headers: getDevEmployeeActorHeaders() })
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
      if (meRecordsFrom) qs.set('from', new Date(meRecordsFrom).toISOString())
      if (meRecordsTo) qs.set('to', new Date(meRecordsTo).toISOString())
      if (unit) qs.set('unit', unit)
      qs.set('limit', '500')
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord[] }>(
        '/api/ponto/me/records?' + qs.toString(),
        { headers: getDevEmployeeActorHeaders() }
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

  async function mePunchFace() {
    if (!me || !('linked' in me) || !me.linked) return toast.error('Usuário não vinculado a funcionário')
    if (!me.hasFace) return toast.error('Biometria facial não cadastrada (use PIN)')
    if (!stream || cameraOwner !== 'employee') return toast.error('Ative a câmera')
    const videoEl = employeeVideoRef.current
    if (!videoEl) return toast.error('Câmera não disponível')
    const unit = ensureEmployeeUnitSelected()
    if (allowedUnits.length && !unit) return
    const ok = await ensureModelsUI()
    if (!ok) {
      setMeStep('pin')
      return toast.error('Modelos faciais indisponíveis (use PIN)')
    }

    setLoading(true)
    try {
      const descriptor = await captureDescriptorStable(videoEl, 2, 220, faceDetectorMode)
      resetFaceFailures()
      resetFaceFailures()
      const meta = createRequestMeta()
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord }>(
        '/api/ponto/me/punch',
        { method: 'POST', body: { descriptor, unit, ...meta }, headers: getDevEmployeeActorHeaders() }
      )
      toast.success(`Ponto registrado (${res.data.type})`)
      setMePunchOpen(false)
      setMeStep('face')
      await stopCameraUI()
      await meRefresh()
      await meLoadRecords()
    } catch (e: any) {
      if (isFaceDetectionError(e)) {
        noteFaceFailure()
        toast.error(e?.message || 'Não foi possível detectar o rosto. Ajuste a posição e tente novamente.')
        toastErrorMeta(e)
        return
      }
      const details = e?.details as any
      const code = String(details?.error || details?.code || '')
      if (code === 'COOLDOWN') {
        toast.error(`Aguarde ${details?.secondsRemaining || '?'}s para registrar novamente.`)
      } else if (code === 'UNIT_ACCESS_NOT_CONFIGURED') {
        toast.error('Unidade não configurada para este usuário')
      } else if (code === 'UNIT_REQUIRED') {
        toast.error('Selecione a unidade')
      } else if (code === 'UNIT_FORBIDDEN') {
        toast.error('Unidade não permitida')
      } else if (code === 'FACE_NOT_RECOGNIZED' || code === 'FACE_NOT_ENROLLED') {
        toast.error('Rosto não reconhecido. Use PIN.')
        setMeStep('pin')
        await stopCameraUI()
      } else {
        toast.error(e?.message || String(e))
        setMeStep('pin')
      }
      toastErrorMeta(e)
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
        { method: 'POST', body: { pin, unit, ...meta }, headers: getDevEmployeeActorHeaders() }
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

  async function deviceConnect() {
    if (!deviceToken.trim()) return toast.error('Informe o token do dispositivo')
    setLoading(true)
    try {
      const res = await apiJson<{ ok: boolean; unit: string; device: PontoDevicePublic; config?: any; data: any[] }>(
        '/api/ponto/device/employees',
        { deviceToken }
      )
      setDeviceStatus({ ok: true, unit: res.unit, device: res.device })
      setDeviceEmployees(res.data || [])
      setDeviceConfig(res.config || null)
      if (!pinEmployeeId && (res.data || []).length) setPinEmployeeId(res.data[0].id)
      toast.success('Dispositivo autenticado')
    } catch (e: any) {
      setDeviceStatus({ ok: false })
      setDeviceEmployees([])
      setDeviceConfig(null)
      toast.error(e?.message || String(e))
      toastErrorMeta(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tab !== 'employee') return
    void meRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  useEffect(() => {
    if (tab !== 'admin') return
    if (!canAdminActions) return
    void adminRefreshAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canAdminActions])

  useEffect(() => {
    if (!selectedEmployee) return
    setEditName(selectedEmployee.name || '')
    setEditCode(selectedEmployee.code || '')
    setEditEmail(selectedEmployee.loginEmail || '')
    setEditActive(selectedEmployee.active !== false)
  }, [selectedEmployee])

  useEffect(() => {
    if (tab !== 'employee') return
    if (!me || !('linked' in me) || !me.linked) return
    if (!meRecordsFrom || !meRecordsTo) return
    if (unitMissing) return
    void meLoadRecords()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, me, meRecordsFrom, meRecordsTo, unitMissing])

  useEffect(() => {
    if (tab !== 'device') return
    setDevicePinOpen(false)
    setIdentifyResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  useEffect(() => {
    if (tab !== 'device') return
    if (!autoIdentify) return
    if (devicePinOpen) return
    if (!stream || cameraOwner !== 'device') return
    if (!deviceToken.trim()) return
    const intervalMs = identifyResult?.match ? 8000 : 3000
    let alive = true
    let inFlight = false
    let timeout: any = null

    const tick = async () => {
      if (!alive) return
      if (document.visibilityState !== 'visible') return
      if (inFlight) return
      inFlight = true
      try {
        const videoEl = deviceVideoRef.current
        if (!videoEl) return
        const ok = await ensureModelsUI()
        if (!ok) return
        const descriptor = await captureDescriptor(videoEl, faceDetectorMode)
        const res = await apiJson<{
          ok: boolean
          match: { employeeId: string; name: string; distance: number } | null
          bestDistance: number | null
          threshold: number
        }>('/api/ponto/device/identify', {
          deviceToken,
          method: 'POST',
          body: { descriptor, threshold: deviceConfig?.faceThresholdDefault ?? 0.52 }
        })
        setIdentifyResult({ match: res.match, bestDistance: res.bestDistance, threshold: res.threshold })
      } catch {
        // ignore noisy frames
      } finally {
        inFlight = false
      }
    }

    const schedule = () => {
      if (!alive) return
      timeout = setTimeout(() => {
        void tick().finally(schedule)
      }, intervalMs)
    }

    schedule()
    return () => {
      alive = false
      if (timeout) clearTimeout(timeout)
    }
  }, [autoIdentify, cameraOwner, deviceConfig, deviceToken, devicePinOpen, identifyResult?.match, stream, tab])

  async function devicePunchFace() {
    if (!deviceToken.trim()) return toast.error('Informe o token do dispositivo')
    if (!stream || cameraOwner !== 'device') return toast.error('Ative a câmera do dispositivo')
    const videoEl = deviceVideoRef.current
    if (!videoEl) return toast.error('Câmera não disponível')
    const ok = await ensureModelsUI()
    if (!ok) {
      setDevicePinOpen(true)
      return toast.error('Modelos faciais indisponíveis (use PIN)')
    }

    setLoading(true)
    try {
      if (identifyResult?.match?.name) {
        const okConfirm = window.confirm(`Confirmar registrar o ponto agora?\n\nReconhecido: ${identifyResult.match.name}`)
        if (!okConfirm) return
      }
      const descriptor = await captureDescriptorStable(videoEl, 2, 220, faceDetectorMode)
      const meta = createRequestMeta()
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord }>(
        '/api/ponto/device/punch/face',
        { deviceToken, method: 'POST', body: { descriptor, ...meta, liveness: { mode: 'multi-sample', ok: true, detail: 'samples=2;avg' } } }
      )
      toast.success(`Ponto registrado: ${res.data.employeeName} (${res.data.type})`)
    } catch (e: any) {
      if (isFaceDetectionError(e)) {
        noteFaceFailure()
        toast.error(e?.message || 'Não foi possível detectar o rosto. Ajuste a posição e tente novamente.')
        toastErrorMeta(e)
        return
      }
      const details = e?.details as any
      const code = String(details?.error || e?.message || '')
      if (code === 'NOT_RECOGNIZED' || code === 'DESCRIPTOR_INVALID' || code === 'EMPLOYEE_INACTIVE') {
        setDevicePinOpen(true)
        toast.error('Não reconhecido. Use PIN.')
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

  async function devicePunchPin() {
    if (!deviceToken.trim()) return toast.error('Informe o token do dispositivo')
    if (!pinEmployeeId) return toast.error('Selecione um funcionário')
    const pin = pinValue.trim()
    if (!pin) return toast.error('Informe o PIN')
    setLoading(true)
    try {
      const meta = createRequestMeta()
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord }>(
        '/api/ponto/device/punch/pin',
        { deviceToken, method: 'POST', body: { employeeId: pinEmployeeId, pin, ...meta } }
      )
      setPinValue('')
      toast.success(`Ponto registrado: ${res.data.employeeName} (${res.data.type})`)
    } catch (e: any) {
      const details = e?.details as any
      const code = String(details?.error || e?.message || '')
      if (code === 'PIN_LOCKED') {
        toast.error(`PIN bloqueado. Aguarde ${details?.secondsRemaining || '?'}s e tente novamente.`)
      } else if (code === 'PIN_INVALID') {
        toast.error(`PIN inválido${typeof details?.remaining === 'number' ? ` • tentativas restantes: ${details.remaining}` : ''}`)
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

  async function adminCreateEmployee() {
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
    const name = newEmployeeName.trim()
    if (!name) return toast.error('Nome é obrigatório')
    const loginEmail = newEmployeeLoginEmail.trim()
    if (!loginEmail || !loginEmail.includes('@')) return toast.error('Email inválido')
    const pin = newEmployeePin.trim()
    if (pin.length < 4) return toast.error('PIN deve ter pelo menos 4 dígitos')
    setLoading(true)
    try {
      const res = await apiJson<{ ok: boolean; data: PontoEmployeePublic }>(
        '/api/ponto/admin/employees',
        { method: 'POST', body: { name, code: newEmployeeCode.trim(), loginEmail } }
      )
      await apiJson('/api/ponto/admin/employees/' + res.data.id + '/pin', {
        method: 'POST',
        body: { pin }
      })
      setNewEmployeeName('')
      setNewEmployeeCode('')
      setNewEmployeeLoginEmail('')
      setNewEmployeePin('')
      await adminRefreshAll()
      setSelectedEmployeeId(res.data.id)
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
    setLoading(true)
    try {
      await apiJson('/api/ponto/admin/employees/' + selectedEmployeeId, {
        method: 'PATCH',
        body: {
          name,
          code: editCode.trim(),
          loginEmail: email || '',
          active: !!editActive
        }
      })
      await adminRefreshAll()
      toast.success('Cadastro atualizado')
      setEditOpen(false)
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

  async function adminManualPunch() {
    if (!canAdminActions) return toast.error('Acesso restrito a administradores')
    if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
    setLoading(true)
    try {
      const meta = createRequestMeta()
      const body: any = { employeeId: selectedEmployeeId, ...meta }
      if (adminPunchType !== 'AUTO') body.type = adminPunchType
      if (adminPunchUnit.trim()) body.unit = adminPunchUnit.trim()
      if (adminPunchNote.trim()) body.note = adminPunchNote.trim()
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord }>(
        '/api/ponto/admin/punch',
        { method: 'POST', body }
      )
      toast.success(`Ponto manual: ${res.data.employeeName} (${res.data.type})`)
      setAdminPunchNote('')
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

  const employeesForPin = useMemo(() => {
    const list = [...deviceEmployees]
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
    return list
  }, [deviceEmployees])

  return (
    <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">Ponto</h2>
            <p className="text-sm text-muted-foreground">
              Registro por identificação facial (com fallback por PIN) e trilha de auditoria.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" title={buildShaRaw || undefined}>Build: {buildSha}</Badge>
            <Button
              variant="outline"
              onClick={() => {
                setDiagOpen(true)
                void loadDiagnostics()
              }}
              disabled={loading}
            >
              Diagnóstico
            </Button>
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="employee">Funcionário</TabsTrigger>
          <TabsTrigger value="device">Kiosk</TabsTrigger>
          {showAdminTab ? <TabsTrigger value="admin">Admin</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="employee" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Meu ponto</CardTitle>
              <CardDescription>Bata ponto direto no CRM (fallback Face → PIN).</CardDescription>
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

              {me && 'linked' in me && me.linked ? (
                <div className="text-sm text-muted-foreground">
                  Última batida: {me.lastPunch ? `${fmtDate(me.lastPunch.at)} • ${me.lastPunch.type} • ${me.lastPunch.method || '-'}` : '—'}
                </div>
              ) : me && 'linked' in me && !me.linked ? (
                <div className="rounded-md border p-3 text-sm">
                  <div className="font-medium">Usuário não vinculado</div>
                  <div className="text-muted-foreground">{me.hint || 'Peça ao admin para vincular seu email a um funcionário.'}</div>
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

              {import.meta.env.DEV ? (
                <div className="rounded-md border p-3 text-sm space-y-2">
                  <div className="font-medium">Dev: actor email (para testar local sem Pages proxy)</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2 space-y-2">
                      <Label>Email</Label>
                      <Input value={devActorEmail} onChange={(e) => setDevActorEmail(e.target.value)} placeholder="ex: funcionario@empresa.com" />
                    </div>
                    <div className="flex items-end gap-2">
                      <Button variant="outline" onClick={meRefresh} disabled={meLoading}>Recarregar</Button>
                      <Button variant="secondary" onClick={() => setDevActorEmail('')} disabled={meLoading}>Limpar</Button>
                    </div>
                  </div>
                </div>
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
                <Button variant="outline" onClick={meRefresh} disabled={meLoading}>Atualizar status</Button>
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
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => startCameraFor('employee')} disabled={loading}>Ativar câmera</Button>
                    <Button variant="secondary" onClick={ensureModelsUI} disabled={loading}>Carregar modelos</Button>
                    <Button variant="outline" onClick={() => void stopCameraUI()} disabled={loading || !stream}>Desligar</Button>
                    <Button onClick={mePunchFace} disabled={loading || !stream}>Registrar por Face</Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CameraStatusBadge active={!!stream && cameraOwner === 'employee'} />
                    <FaceModelsBadge state={modelsReady} mode={faceDetectorMode} />
                  </div>
                  <div className="rounded-xl overflow-hidden border bg-black">
                    <video ref={employeeVideoRef} className="w-full aspect-video object-cover" playsInline muted autoPlay />
                  </div>
                  {modelsError ? <div className="text-sm text-red-600">{modelsError}</div> : null}
                  {modelsReady === 'loading' ? (
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">{modelsMessage || 'Carregando modelos faciais…'}</div>
                      <div className="h-2 rounded bg-muted/40 overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${modelsProgress}%` }} />
                      </div>
                      <div className="text-xs text-muted-foreground">{modelsProgress}%</div>
                    </div>
                  ) : null}
                  {modelsReady === 'idle' ? (
                    <div className="text-sm text-muted-foreground">
                      Carregue os modelos faciais antes de registrar por Face.
                    </div>
                  ) : null}
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

          <Card>
            <CardHeader>
              <CardTitle>Meu histórico</CardTitle>
              <CardDescription>Últimos registros (com correções, se existirem).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>De</Label>
                  <Input type="datetime-local" value={meRecordsFrom} onChange={(e) => setMeRecordsFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Até</Label>
                  <Input type="datetime-local" value={meRecordsTo} onChange={(e) => setMeRecordsTo(e.target.value)} />
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="device" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuração do Dispositivo</CardTitle>
              <CardDescription>Use o token do dispositivo (por unidade) para autenticar este relógio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 space-y-2">
                  <Label>Token do Dispositivo</Label>
                  <Input value={deviceToken} onChange={(e) => setDeviceToken(e.target.value)} placeholder="Device token..." />
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={deviceConnect} disabled={loading}>Conectar</Button>
                  <Button variant="outline" onClick={() => setDeviceToken('')} disabled={loading}>Limpar</Button>
                  <Dialog open={qrScanOpen} onOpenChange={setQrScanOpen}>
                    <Button variant="secondary" onClick={() => setQrScanOpen(true)} disabled={loading}>Ler QR</Button>
                    <DialogContent className="max-w-xl">
                      <DialogHeader>
                        <DialogTitle>Ler token por QR</DialogTitle>
                        <DialogDescription>Aponte a câmera para o QR do token do dispositivo.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-2">
                        {qrScanError ? <div className="text-sm text-red-600">{qrScanError}</div> : null}
                        <video ref={qrVideoRef} className="w-full rounded-lg border bg-black" playsInline muted />
                      </div>
                      <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => { setQrScanOpen(false); stopQrScan() }}>Fechar</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              {deviceStatus?.ok ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>Unidade: {deviceStatus.unit || '-'}</Badge>
                  <Badge variant="secondary">Dispositivo: {deviceStatus.device?.label || deviceStatus.device?.id || '-'}</Badge>
                  <Badge variant="outline">Funcionários: {deviceEmployees.length}</Badge>
                  {deviceConfig?.punchCooldownSeconds ? (
                    <Badge variant="outline">Cooldown: {String(deviceConfig.punchCooldownSeconds)}s</Badge>
                  ) : null}
                </div>
              ) : deviceStatus?.ok === false ? (
                <div className="text-sm text-red-600">Dispositivo não autenticado.</div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Face</CardTitle>
                <CardDescription>Ative a câmera e registre com identificação facial.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {modelsError ? (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                    <div className="font-medium">Modelos faciais não carregaram</div>
                    <div className="opacity-80">{modelsError}</div>
                    <div className="opacity-80 mt-2">
                      Rode <code className="font-mono">npm run fetch-face-models</code> no <code className="font-mono">frontend/</code> para baixar os arquivos.
                    </div>
                  </div>
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

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => startCameraFor('device')} disabled={loading}>Ativar câmera</Button>
                <Button variant="outline" onClick={() => void stopCameraUI()} disabled={loading || !stream}>Desligar</Button>
                <Button variant="secondary" onClick={ensureModelsUI} disabled={loading}>Carregar modelos</Button>
                <Button variant="outline" onClick={() => setAutoIdentify(v => !v)} disabled={loading || !stream}>
                  Auto-identificar: {autoIdentify ? 'ON' : 'OFF'}
                </Button>
              </div>

              <div className="rounded-xl overflow-hidden border bg-black">
                <video ref={deviceVideoRef} className="w-full aspect-video object-cover" playsInline muted autoPlay />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <CameraStatusBadge active={!!stream && cameraOwner === 'device'} />
                <FaceModelsBadge state={modelsReady} mode={faceDetectorMode} />
                {identifyResult?.match ? (
                  <>
                    <Badge>Reconhecido: {identifyResult.match.name}</Badge>
                    <Badge variant="outline">dist: {identifyResult.match.distance.toFixed(3)}</Badge>
                  </>
                  ) : (
                    <Badge variant="secondary">Nenhum reconhecimento</Badge>
                  )}
                </div>

                <Button onClick={devicePunchFace} disabled={loading || !stream || !deviceToken.trim()}>
                  Registrar ponto por Face
                </Button>
              </CardContent>
            </Card>

            {devicePinOpen ? (
              <Card>
                <CardHeader>
                  <CardTitle>Fallback por PIN</CardTitle>
                  <CardDescription>Use quando a câmera/modelo falhar ou o usuário não for reconhecido.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-2">
                      <Label>Funcionário</Label>
                      <Select value={pinEmployeeId} onValueChange={setPinEmployeeId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          {employeesForPin.map(e => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.name}{e.pinSet ? '' : ' (sem PIN)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>PIN</Label>
                      <Input value={pinValue} onChange={(e) => setPinValue(e.target.value)} inputMode="numeric" placeholder="••••" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={devicePunchPin} disabled={loading || !deviceToken.trim()}>
                      Registrar ponto por PIN
                    </Button>
                    <Button variant="outline" onClick={() => setDevicePinOpen(false)} disabled={loading}>
                      Fechar PIN
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="admin" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Admin</CardTitle>
              <CardDescription>Gerencie funcionários, dispositivos e exportações (somente para admins do CRM).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {crmMeLoading ? <Badge variant="secondary">Verificando sessão…</Badge> : null}
                {canAdmin ? <Badge>Admin logado</Badge> : <Badge variant="secondary">Acesso restrito</Badge>}
                {crmMe?.user?.username ? <Badge variant="outline">{crmMe.user.username}</Badge> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={adminRefreshAll} disabled={loading || !canAdminActions}>Atualizar</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Funcionários</CardTitle>
                <CardDescription>Cadastro, PIN e biometria (face templates).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Novo nome</Label>
                    <Input value={newEmployeeName} onChange={(e) => setNewEmployeeName(e.target.value)} placeholder="Nome..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Código (opcional)</Label>
                    <Input value={newEmployeeCode} onChange={(e) => setNewEmployeeCode(e.target.value)} placeholder="Matrícula..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Email (vínculo login)</Label>
                    <Input
                      value={newEmployeeLoginEmail}
                      onChange={(e) => setNewEmployeeLoginEmail(e.target.value)}
                      placeholder="ex: funcionario@empresa.com"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>PIN (min. 4)</Label>
                    <Input value={newEmployeePin} onChange={(e) => setNewEmployeePin(e.target.value)} inputMode="numeric" placeholder="••••" />
                  </div>
                  <div className="md:col-span-2 flex items-end">
                    <Button
                      onClick={adminCreateEmployee}
                      disabled={
                        loading ||
                        !canAdminActions ||
                        !newEmployeeName.trim() ||
                        !newEmployeeLoginEmail.trim() ||
                        !newEmployeeLoginEmail.includes('@') ||
                        newEmployeePin.trim().length < 4
                      }
                    >
                      Cadastrar
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Selecionado</Label>
                  <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {adminEmployees.map(e => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}{e.active === false ? ' (inativo)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
                      setEnrollOpen(true)
                    }}
                    disabled={loading || !canAdminActions || !selectedEmployeeId}
                  >
                    Cadastrar Biometria
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
                      setEditOpen(true)
                    }}
                    disabled={loading || !canAdminActions || !selectedEmployeeId}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
                      setRecordsOpen(true)
                      void adminLoadSelectedRecords()
                    }}
                    disabled={loading || !canAdminActions || !selectedEmployeeId}
                  >
                    Registros
                  </Button>
                </div>

                <div className="border rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Login</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Face</TableHead>
                        <TableHead>PIN</TableHead>
                        <TableHead>Atualizado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adminEmployees.map(e => (
                        <TableRow key={e.id} className={e.id === selectedEmployeeId ? 'bg-muted/40' : ''}>
                          <TableCell className="font-medium">{e.name}</TableCell>
                          <TableCell className="text-sm">{e.loginEmail || '-'}</TableCell>
                          <TableCell>{e.active === false ? <Badge variant="secondary">Inativo</Badge> : <Badge>Ativo</Badge>}</TableCell>
                          <TableCell><Badge variant="outline">{e.faceDescriptorsCount || 0}</Badge></TableCell>
                          <TableCell>{e.pinSet ? <Badge variant="outline">OK</Badge> : <Badge variant="secondary">—</Badge>}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{fmtDate(e.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                      {!adminEmployees.length ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-sm text-muted-foreground">Nenhum funcionário.</TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>

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
                      <DialogDescription>Atualize nome, codigo, email e status do funcionario.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="space-y-2">
                        <Label>Nome</Label>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nome" />
                      </div>
                      <div className="space-y-2">
                        <Label>Codigo</Label>
                        <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="Matricula" />
                      </div>
                      <div className="space-y-2">
                        <Label>Email (vinculo login)</Label>
                        <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="ex: funcionario@empresa.com" />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                        <span>Funcionario ativo</span>
                      </label>
                    </div>
                    <DialogFooter className="gap-2">
                      <Button variant="outline" onClick={() => setEditOpen(false)} disabled={loading}>Cancelar</Button>
                      <Button onClick={adminSaveEmployeeEdit} disabled={loading || !selectedEmployeeId}>Salvar</Button>
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Dispositivos & Registros</CardTitle>
                <CardDescription>Crie tokens por unidade e exporte registros.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <div className="font-medium">Ponto manual (admin)</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select value={adminPunchType} onValueChange={(v) => setAdminPunchType(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AUTO">AUTO</SelectItem>
                          <SelectItem value="IN">IN</SelectItem>
                          <SelectItem value="OUT">OUT</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Unidade (opcional)</Label>
                      <Input value={adminPunchUnit} onChange={(e) => setAdminPunchUnit(e.target.value)} placeholder="ex: unidade-01" />
                    </div>
                    <div className="flex items-end">
                      <Button onClick={adminManualPunch} disabled={loading || !canAdminActions || !selectedEmployeeId}>Registrar</Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Observação (opcional)</Label>
                    <Input value={adminPunchNote} onChange={(e) => setAdminPunchNote(e.target.value)} placeholder="Motivo / contexto..." />
                  </div>
                </div>

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
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
