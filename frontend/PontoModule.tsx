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
import * as faceapi from '@vladmandic/face-api'
import '@tensorflow/tfjs'

type ApiError = { ok?: boolean; error?: string; message?: string; code?: string }

type PontoEmployeePublic = {
  id: string
  code?: string
  name: string
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

const LS_DEVICE_TOKEN = 'skincos.ponto.deviceToken.v1'
const LS_ADMIN_TOKEN = 'skincos.ponto.adminToken.v1'

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
  opts: { method?: string; body?: unknown; adminToken?: string; deviceToken?: string; signal?: AbortSignal } = {}
): Promise<T> {
  const method = (opts.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.adminToken) headers.authorization = `Admin ${opts.adminToken}`
  if (opts.deviceToken) headers.authorization = `Device ${opts.deviceToken}`
  const res = await fetch(path, {
    method,
    headers,
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

async function apiBlob(path: string, opts: { adminToken?: string; signal?: AbortSignal } = {}): Promise<Blob> {
  const headers: Record<string, string> = {}
  if (opts.adminToken) headers.authorization = `Admin ${opts.adminToken}`
  const res = await fetch(path, { headers, signal: opts.signal })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const json = (await res.json()) as ApiError
      msg = json.error || json.message || msg
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return await res.blob()
}

let faceInitPromise: Promise<void> | null = null
async function ensureFaceModels() {
  if (faceInitPromise) return faceInitPromise
  faceInitPromise = (async () => {
    const tf = (faceapi as any).tf as any
    if (tf?.setBackend) {
      try { await tf.setBackend('webgl') } catch { /* ignore */ }
      await tf.ready()
    }
    await faceapi.nets.tinyFaceDetector.loadFromUri('/face-models')
    await faceapi.nets.faceLandmark68Net.loadFromUri('/face-models')
    await faceapi.nets.faceRecognitionNet.loadFromUri('/face-models')
  })()
  return faceInitPromise
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

async function captureDescriptor(videoEl: HTMLVideoElement) {
  await ensureFaceModels()
  const detection = await faceapi
    .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor()
  if (!detection?.descriptor) throw new Error('Nenhum rosto detectado')
  return Array.from(detection.descriptor)
}

export function PontoModule() {
  const [tab, setTab] = useState<'device' | 'admin'>('device')

  const [deviceToken, setDeviceToken] = useState(() => {
    try { return localStorage.getItem(LS_DEVICE_TOKEN) || '' } catch { return '' }
  })
  const [adminToken, setAdminToken] = useState(() => {
    try { return localStorage.getItem(LS_ADMIN_TOKEN) || '' } catch { return '' }
  })

  const deviceVideoRef = useRef<HTMLVideoElement | null>(null)
  const adminVideoRef = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [cameraOwner, setCameraOwner] = useState<'device' | 'admin' | null>(null)

  const [modelsReady, setModelsReady] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [modelsError, setModelsError] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)

  const [deviceStatus, setDeviceStatus] = useState<{ ok: boolean; unit?: string; device?: PontoDevicePublic } | null>(null)
  const [deviceEmployees, setDeviceEmployees] = useState<Array<{ id: string; name: string; code?: string; hasFace?: boolean; pinSet?: boolean }>>([])
  const [identifyResult, setIdentifyResult] = useState<{
    match: { employeeId: string; name: string; distance: number } | null
    bestDistance: number | null
    threshold: number
  } | null>(null)
  const [autoIdentify, setAutoIdentify] = useState(true)

  const [pinEmployeeId, setPinEmployeeId] = useState<string>('')
  const [pinValue, setPinValue] = useState<string>('')

  const [adminEmployees, setAdminEmployees] = useState<PontoEmployeePublic[]>([])
  const [adminDevices, setAdminDevices] = useState<PontoDevicePublic[]>([])
  const [records, setRecords] = useState<PontoPunchRecord[]>([])

  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [newEmployeeCode, setNewEmployeeCode] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('')
  const selectedEmployee = useMemo(() => adminEmployees.find(e => e.id === selectedEmployeeId) || null, [adminEmployees, selectedEmployeeId])
  const [pinAdminValue, setPinAdminValue] = useState('')

  const [enrollCount, setEnrollCount] = useState(5)
  const [enrollReplace, setEnrollReplace] = useState(true)
  const [enrollConsent, setEnrollConsent] = useState(false)
  const [enrollProgress, setEnrollProgress] = useState<{ total: number; done: number } | null>(null)

  const [newDeviceUnit, setNewDeviceUnit] = useState('')
  const [newDeviceLabel, setNewDeviceLabel] = useState('')
  const [newDeviceTokenOnce, setNewDeviceTokenOnce] = useState<string | null>(null)

  const [recordsFrom, setRecordsFrom] = useState('')
  const [recordsTo, setRecordsTo] = useState('')

  const [adminPunchType, setAdminPunchType] = useState<'AUTO' | 'IN' | 'OUT'>('AUTO')
  const [adminPunchUnit, setAdminPunchUnit] = useState('')
  const [adminPunchNote, setAdminPunchNote] = useState('')

  useEffect(() => {
    try { localStorage.setItem(LS_DEVICE_TOKEN, deviceToken) } catch { /* ignore */ }
  }, [deviceToken])
  useEffect(() => {
    try { localStorage.setItem(LS_ADMIN_TOKEN, adminToken) } catch { /* ignore */ }
  }, [adminToken])

  useEffect(() => {
    return () => {
      stopCamera(stream)
      setStream(null)
      setCameraOwner(null)
    }
  }, [stream])

  async function ensureModelsUI() {
    if (modelsReady === 'ready') return true
    setModelsReady('loading')
    setModelsError(null)
    try {
      await ensureFaceModels()
      setModelsReady('ready')
      return true
    } catch (e: any) {
      setModelsReady('error')
      setModelsError(e?.message || String(e))
      return false
    }
  }

  async function startCameraFor(owner: 'device' | 'admin') {
    const videoEl = owner === 'device' ? deviceVideoRef.current : adminVideoRef.current
    if (!videoEl) return toast.error('Vídeo não disponível')
    setLoading(true)
    try {
      stopCamera(stream)
      const s = await startUserCamera(videoEl)
      setStream(s)
      setCameraOwner(owner)
      toast.success('Câmera ativa')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function stopCameraUI() {
    stopCamera(stream)
    setStream(null)
    setCameraOwner(null)
    toast.message('Câmera desligada')
  }

  async function deviceConnect() {
    if (!deviceToken.trim()) return toast.error('Informe o token do dispositivo')
    setLoading(true)
    try {
      const res = await apiJson<{ ok: boolean; unit: string; device: PontoDevicePublic; data: any[] }>(
        '/api/ponto/device/employees',
        { deviceToken }
      )
      setDeviceStatus({ ok: true, unit: res.unit, device: res.device })
      setDeviceEmployees(res.data || [])
      if (!pinEmployeeId && (res.data || []).length) setPinEmployeeId(res.data[0].id)
      toast.success('Dispositivo autenticado')
    } catch (e: any) {
      setDeviceStatus({ ok: false })
      setDeviceEmployees([])
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tab !== 'device') return
    if (!autoIdentify) return
    if (!stream || cameraOwner !== 'device') return
    if (!deviceToken.trim()) return
    let alive = true
    const interval = setInterval(() => {
      void (async () => {
        if (!alive) return
        const videoEl = deviceVideoRef.current
        if (!videoEl) return
        const ok = await ensureModelsUI()
        if (!ok) return
        try {
          const descriptor = await captureDescriptor(videoEl)
          const res = await apiJson<{
            ok: boolean
            match: { employeeId: string; name: string; distance: number } | null
            bestDistance: number | null
            threshold: number
          }>('/api/ponto/device/identify', {
            deviceToken,
            method: 'POST',
            body: { descriptor, threshold: 0.52 }
          })
          setIdentifyResult({ match: res.match, bestDistance: res.bestDistance, threshold: res.threshold })
        } catch {
          // ignore noisy frames
        }
      })()
    }, 1800)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [autoIdentify, cameraOwner, deviceToken, stream, tab])

  async function devicePunchFace() {
    if (!deviceToken.trim()) return toast.error('Informe o token do dispositivo')
    if (!stream || cameraOwner !== 'device') return toast.error('Ative a câmera do dispositivo')
    const videoEl = deviceVideoRef.current
    if (!videoEl) return toast.error('Câmera não disponível')
    const ok = await ensureModelsUI()
    if (!ok) return toast.error('Modelos faciais indisponíveis (use PIN)')

    setLoading(true)
    try {
      const descriptor = await captureDescriptor(videoEl)
      const meta = createRequestMeta()
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord }>(
        '/api/ponto/device/punch/face',
        { deviceToken, method: 'POST', body: { descriptor, ...meta, liveness: { mode: 'device-ui', ok: true, detail: 'multi-sample' } } }
      )
      toast.success(`Ponto registrado: ${res.data.employeeName} (${res.data.type})`)
    } catch (e: any) {
      toast.error(e?.message || String(e))
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
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function adminRefreshAll() {
    if (!adminToken.trim()) return toast.error('Informe o token de admin')
    setLoading(true)
    try {
      const [emps, devs] = await Promise.all([
        apiJson<{ ok: boolean; data: PontoEmployeePublic[] }>('/api/ponto/admin/employees', { adminToken }),
        apiJson<{ ok: boolean; data: PontoDevicePublic[] }>('/api/ponto/admin/devices', { adminToken })
      ])
      setAdminEmployees(emps.data || [])
      setAdminDevices(devs.data || [])
      if (!selectedEmployeeId && (emps.data || []).length) setSelectedEmployeeId(emps.data[0].id)
      toast.success('Dados atualizados')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function adminCreateEmployee() {
    if (!adminToken.trim()) return toast.error('Informe o token de admin')
    const name = newEmployeeName.trim()
    if (!name) return toast.error('Nome é obrigatório')
    setLoading(true)
    try {
      const res = await apiJson<{ ok: boolean; data: PontoEmployeePublic }>(
        '/api/ponto/admin/employees',
        { adminToken, method: 'POST', body: { name, code: newEmployeeCode.trim() } }
      )
      setNewEmployeeName('')
      setNewEmployeeCode('')
      await adminRefreshAll()
      setSelectedEmployeeId(res.data.id)
      toast.success('Funcionário criado')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function adminSetPin() {
    if (!adminToken.trim()) return toast.error('Informe o token de admin')
    if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
    const pin = pinAdminValue.trim()
    if (pin.length < 4) return toast.error('PIN deve ter pelo menos 4 dígitos')
    setLoading(true)
    try {
      await apiJson('/api/ponto/admin/employees/' + selectedEmployeeId + '/pin', {
        adminToken,
        method: 'POST',
        body: { pin }
      })
      setPinAdminValue('')
      await adminRefreshAll()
      toast.success('PIN atualizado')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function adminEnrollFace() {
    if (!adminToken.trim()) return toast.error('Informe o token de admin')
    if (!selectedEmployeeId) return toast.error('Selecione um funcionário')
    if (!enrollConsent) return toast.error('Confirme o consentimento para biometria')
    if (!stream || cameraOwner !== 'admin') return toast.error('Ative a câmera (admin)')
    const videoEl = adminVideoRef.current
    if (!videoEl) return toast.error('Câmera não inicializada')

    const ok = await ensureModelsUI()
    if (!ok) return toast.error('Modelos faciais indisponíveis (use PIN)')

    const total = Math.max(1, Math.min(10, Number(enrollCount) || 5))
    setEnrollProgress({ total, done: 0 })
    const descriptors: number[][] = []

    try {
      for (let i = 0; i < total; i++) {
        const d = await captureDescriptor(videoEl)
        descriptors.push(d)
        setEnrollProgress({ total, done: i + 1 })
        await new Promise(r => setTimeout(r, 650))
      }
      await apiJson('/api/ponto/admin/employees/' + selectedEmployeeId + '/enroll', {
        adminToken,
        method: 'POST',
        body: { descriptors, replace: enrollReplace, consentConfirmed: true }
      })
      await adminRefreshAll()
      toast.success('Rosto cadastrado')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setEnrollProgress(null)
    }
  }

  async function adminCreateDevice() {
    if (!adminToken.trim()) return toast.error('Informe o token de admin')
    if (!newDeviceUnit.trim()) return toast.error('Unidade é obrigatória')
    setLoading(true)
    try {
      const res = await apiJson<{ ok: boolean; data: PontoDevicePublic; tokenOnce: string }>(
        '/api/ponto/admin/devices',
        { adminToken, method: 'POST', body: { unit: newDeviceUnit.trim(), label: newDeviceLabel.trim() } }
      )
      setNewDeviceTokenOnce(res.tokenOnce)
      setNewDeviceLabel('')
      await adminRefreshAll()
      toast.success('Dispositivo criado')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function adminRevokeDevice(deviceId: string) {
    if (!adminToken.trim()) return toast.error('Informe o token de admin')
    setLoading(true)
    try {
      await apiJson('/api/ponto/admin/devices/' + deviceId + '/revoke', { adminToken, method: 'POST' })
      await adminRefreshAll()
      toast.success('Dispositivo revogado')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function adminManualPunch() {
    if (!adminToken.trim()) return toast.error('Informe o token de admin')
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
        { adminToken, method: 'POST', body }
      )
      toast.success(`Ponto manual: ${res.data.employeeName} (${res.data.type})`)
      setAdminPunchNote('')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function adminLoadRecords() {
    if (!adminToken.trim()) return toast.error('Informe o token de admin')
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (recordsFrom) qs.set('from', new Date(recordsFrom).toISOString())
      if (recordsTo) qs.set('to', new Date(recordsTo).toISOString())
      if (selectedEmployeeId) qs.set('employeeId', selectedEmployeeId)
      qs.set('limit', '500')
      const res = await apiJson<{ ok: boolean; data: PontoPunchRecord[] }>(
        '/api/ponto/admin/records?' + qs.toString(),
        { adminToken }
      )
      setRecords(res.data || [])
      toast.success('Registros carregados')
    } catch (e: any) {
      toast.error(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  async function adminExportCsv() {
    if (!adminToken.trim()) return toast.error('Informe o token de admin')
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (recordsFrom) qs.set('from', new Date(recordsFrom).toISOString())
      if (recordsTo) qs.set('to', new Date(recordsTo).toISOString())
      if (selectedEmployeeId) qs.set('employeeId', selectedEmployeeId)
      const blob = await apiBlob('/api/ponto/admin/records.csv?' + qs.toString(), { adminToken })
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
          {loading ? <Badge variant="secondary">Processando…</Badge> : null}
          {modelsReady === 'ready' ? <Badge variant="outline">Face OK</Badge> : null}
          {modelsReady === 'error' ? <Badge variant="destructive">Face indisponível</Badge> : null}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="device">Dispositivo (relógio)</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
        </TabsList>

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
                </div>
              </div>

              {deviceStatus?.ok ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>Unidade: {deviceStatus.unit || '-'}</Badge>
                  <Badge variant="secondary">Dispositivo: {deviceStatus.device?.label || deviceStatus.device?.id || '-'}</Badge>
                  <Badge variant="outline">Funcionários: {deviceEmployees.length}</Badge>
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

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => startCameraFor('device')} disabled={loading}>Ativar câmera</Button>
                  <Button variant="outline" onClick={stopCameraUI} disabled={loading || !stream}>Desligar</Button>
                  <Button variant="secondary" onClick={ensureModelsUI} disabled={loading}>Carregar modelos</Button>
                  <Button variant="outline" onClick={() => setAutoIdentify(v => !v)} disabled={loading || !stream}>
                    Auto-identificar: {autoIdentify ? 'ON' : 'OFF'}
                  </Button>
                </div>

                <div className="rounded-xl overflow-hidden border bg-black">
                  <video ref={deviceVideoRef} className="w-full aspect-video object-cover" playsInline muted autoPlay />
                </div>

                <div className="flex flex-wrap items-center gap-2">
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
                <Button onClick={devicePunchPin} disabled={loading || !deviceToken.trim()}>
                  Registrar ponto por PIN
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="admin" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Admin</CardTitle>
              <CardDescription>Gerencie funcionários, dispositivos e exportações. Somente com token admin.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 space-y-2">
                  <Label>Token Admin</Label>
                  <Input value={adminToken} onChange={(e) => setAdminToken(e.target.value)} placeholder="Admin token..." />
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={adminRefreshAll} disabled={loading}>Atualizar</Button>
                  <Button variant="outline" onClick={() => setAdminToken('')} disabled={loading}>Limpar</Button>
                </div>
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
                  <div className="flex items-end">
                    <Button onClick={adminCreateEmployee} disabled={loading || !adminToken.trim()}>Criar</Button>
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Novo PIN (min. 4)</Label>
                    <Input value={pinAdminValue} onChange={(e) => setPinAdminValue(e.target.value)} inputMode="numeric" placeholder="••••" />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={adminSetPin} disabled={loading || !adminToken.trim() || !selectedEmployeeId}>Salvar PIN</Button>
                  </div>
                </div>

                <div className="rounded-xl border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">Cadastro facial</div>
                      <div className="text-sm text-muted-foreground">
                        {selectedEmployee ? (
                          <>Atual: {selectedEmployee.faceDescriptorsCount || 0} templates • Último: {fmtDate(selectedEmployee.lastEnrolledAt)}</>
                        ) : (
                          <>Selecione um funcionário.</>
                        )}
                      </div>
                    </div>
                    {enrollProgress ? <Badge variant="secondary">{enrollProgress.done}/{enrollProgress.total}</Badge> : null}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Amostras</Label>
                      <Input value={String(enrollCount)} onChange={(e) => setEnrollCount(Number(e.target.value))} inputMode="numeric" />
                    </div>
                    <div className="space-y-2">
                      <Label>Modo</Label>
                      <Select value={enrollReplace ? 'replace' : 'append'} onValueChange={(v) => setEnrollReplace(v === 'replace')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="replace">Substituir</SelectItem>
                          <SelectItem value="append">Adicionar</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end gap-2">
                      <Button variant="secondary" onClick={ensureModelsUI} disabled={loading}>Carregar modelos</Button>
                      <Button onClick={() => startCameraFor('admin')} disabled={loading}>Ativar câmera</Button>
                    </div>
                  </div>

                  <div className="rounded-xl overflow-hidden border bg-black">
                    <video ref={adminVideoRef} className="w-full aspect-video object-cover" playsInline muted autoPlay />
                  </div>

                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={enrollConsent} onChange={(e) => setEnrollConsent(e.target.checked)} />
                    <span>Confirmo que o consentimento para biometria (rosto) foi obtido no cadastro do usuário.</span>
                  </label>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={stopCameraUI} disabled={loading || !stream}>Desligar</Button>
                    <Button onClick={adminEnrollFace} disabled={loading || !adminToken.trim() || !selectedEmployeeId}>
                      Capturar & salvar biometria
                    </Button>
                  </div>
                </div>

                <div className="border rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
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
                          <TableCell>{e.active === false ? <Badge variant="secondary">Inativo</Badge> : <Badge>Ativo</Badge>}</TableCell>
                          <TableCell><Badge variant="outline">{e.faceDescriptorsCount || 0}</Badge></TableCell>
                          <TableCell>{e.pinSet ? <Badge variant="outline">OK</Badge> : <Badge variant="secondary">—</Badge>}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{fmtDate(e.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                      {!adminEmployees.length ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-sm text-muted-foreground">Nenhum funcionário.</TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
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
                      <Button onClick={adminManualPunch} disabled={loading || !adminToken.trim() || !selectedEmployeeId}>Registrar</Button>
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
                      <Button onClick={adminCreateDevice} disabled={loading || !adminToken.trim()}>Criar token</Button>
                    </div>
                  </div>
                  {newDeviceTokenOnce ? (
                    <div className="rounded-md border p-3 space-y-2">
                      <div className="text-sm">Token (mostrado uma única vez):</div>
                      <div className="font-mono text-sm break-all">{newDeviceTokenOnce}</div>
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
                      <Button onClick={adminLoadRecords} disabled={loading || !adminToken.trim()}>Buscar</Button>
                      <Button variant="outline" onClick={adminExportCsv} disabled={loading || !adminToken.trim()}>CSV</Button>
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

