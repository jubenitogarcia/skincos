import React, { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Camera, Monitor, Terminal } from '@phosphor-icons/react'

import { useKV } from '@/spark-mock'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { Label } from '@/label'
import { ScrollArea } from '@/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Switch } from '@/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { Toaster } from '@/sonner'

import { RTSPPlayer } from '@/RTSPPlayer'
import { WebRTCPlayer } from '@/WebRTCPlayer'
import { SystemLogs } from '@/SystemLogs'
import { DEFAULT_UNIT_OPTIONS, useGlobalUnitSelection } from '@/unitSelection'

type ApiError = { ok?: boolean; error?: string; message?: string; hint?: string }

interface LogEntry {
  id: string
  timestamp: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'STATUS'
  message: string
}

interface RtspCameraConfig {
  id?: string
  name?: string
  host?: string
  port?: number
  username?: string
  password?: string
  streamPath?: string
  rtspUrl?: string
  enabled?: boolean
}

interface RtspRecordingConfig {
  segmentSeconds: number
  retentionDays: number
}

interface StreamingStatus {
  ok: boolean
  running: boolean
  pid: number | null
  startedAt: string | null
  lastError: string | null
  configPath?: string | null
  hlsTarget?: string
  hlsProxyBase?: string
  webrtcTarget?: string
  webrtcProxyBase?: string
  iceServers?: RTCIceServer[]
  streams: Array<{
    unit: string
    cameraId: string
    name: string
    pathKey: string
    hlsUrlProxy: string
    webrtcUrlProxy: string
  }>
}

interface RtspRecorderStatus {
  unit: string
  cameraId: string
  pid: number | null
  startedAt: string | null
  segmentSeconds: number
  outDir: string
  logFile: string
  lastError: string | null
}

interface RecordingSegment {
  unit: string
  cameraId: string
  filename: string
  createdAt: string
  sizeBytes: number
  playbackUrl: string
  downloadUrl: string
}

interface RtspTestResult {
  ok: boolean
  maskedUrl?: string
  video?: { codec: string | null; width: number | null; height: number | null; fps: number | null } | null
  audio?: { codec: string | null; sampleRate: number | null; channels: number | null } | null
  format?: any
  error?: string
}

interface UnitMonitorDiagnostics {
  ok: boolean
  ts?: string
  recordingsDir?: string
  minFreeGb?: number
  disk?: {
    totalKb?: number | null
    usedKb?: number | null
    availableKb?: number | null
    capacity?: string | null
    mount?: string | null
    raw?: string
  } | null
  mediamtx?: {
    runtime?: { running?: boolean; pid?: number | null; startedAt?: string | null; lastError?: string | null; configPath?: string | null }
    pidFromFile?: number | null
    pidRunning?: boolean
    logFile?: string
    logTail?: string | null
  }
  recorders?: RtspRecorderStatus[]
}

type UnitMonitorProxyStatus = {
  ok: boolean
  targetConfigured: boolean
  proxyTokenConfigured: boolean
  hint?: string
}

type UnitMonitorGatewayInfo = {
  ok: boolean
  ts?: string
  uptimeSec?: number
  gateway?: { enabled?: boolean; startedAt?: string | null; version?: string | null }
  node?: string
  platform?: { os: string; arch: string }
  pid?: number
  ports?: { crmApiPort?: number }
  host?: { hostname?: string; ips?: string[] }
  resources?: { loadavg?: number[] | null; memTotalBytes?: number; memFreeBytes?: number; memRssBytes?: number }
  auth?: { proxyTokenRequired?: boolean }
  bins?: {
    ffmpeg?: string
    ffprobe?: string
    mediamtx?: string
    ffmpegVersion?: string | null
    ffprobeVersion?: string | null
    mediamtxVersion?: string | null
  }
}

function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(path, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers || {}) },
    credentials: 'include',
    ...init
  }).then(async (r) => {
    const text = await r.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (r.ok) return json as T
    const err = (json || {}) as ApiError
    const base = err.error || err.message || `HTTP ${r.status}`
    const hint = err.hint ? ` (${err.hint})` : ''
    throw new Error(`${base}${hint}`)
  })
}

function safeIdPart(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

function normalizeStreamPath(input: string): string {
  const s = String(input || '').trim()
  if (!s) return 'stream1'
  return s.startsWith('/') ? s.slice(1) : s
}

function buildRtspUrlFromParts(cam: RtspCameraConfig): string {
  const host = String(cam.host || '').trim()
  if (!host) return ''
  const port = Number(cam.port || 554) || 554
  const username = String(cam.username || '').trim()
  const password = String(cam.password || '').trim()
  const stream = normalizeStreamPath(cam.streamPath || 'stream1')
  const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : ''
  return `rtsp://${auth}${host}:${port}/${stream}`
}

function parseRtspUrl(rtspUrl: string): Pick<RtspCameraConfig, 'host' | 'port' | 'username' | 'password' | 'streamPath'> | null {
  const raw = String(rtspUrl || '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'rtsp:') return null
    const host = String(u.hostname || '').trim()
    if (!host) return null
    const port = Number(u.port || 554) || 554
    const username = u.username ? decodeURIComponent(u.username) : ''
    const password = u.password ? decodeURIComponent(u.password) : ''
    const streamPath = normalizeStreamPath(u.pathname || '/stream1')
    return { host, port, username, password, streamPath }
  } catch {
    return null
  }
}

function deriveCameraId(cam: RtspCameraConfig): string {
  if (cam.id && String(cam.id).trim()) return String(cam.id).trim()

  const host = safeIdPart(cam.host || '')
  const stream = safeIdPart(normalizeStreamPath(cam.streamPath || 'stream1'))
  if (host) return `cam_${host}_${stream || 'stream1'}`

  const parsed = parseRtspUrl(String(cam.rtspUrl || '').trim())
  if (parsed?.host) return `cam_${safeIdPart(parsed.host)}_${safeIdPart(parsed.streamPath || 'stream1') || 'stream1'}`

  return `cam_${Date.now()}`
}

function maskRtspUrl(input: string): string {
  const s = String(input || '').trim()
  const schemeIdx = s.indexOf('://')
  if (schemeIdx < 0) return s
  const afterScheme = schemeIdx + 3
  const atIdx = s.indexOf('@', afterScheme)
  if (atIdx < 0) return s
  const auth = s.slice(afterScheme, atIdx)
  const colonIdx = auth.indexOf(':')
  if (colonIdx < 0) return s
  const user = auth.slice(0, colonIdx)
  const rest = s.slice(atIdx)
  return s.slice(0, afterScheme) + `${user}:***` + rest
}

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes)) return '0 B'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
  return `${(sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function kbToBytes(kb?: number | null): number {
  if (!Number.isFinite(Number(kb))) return 0
  return Math.max(0, Number(kb) * 1024)
}

export function UnitMonitor() {
  const { selectedUnit, setSelectedUnit, effectiveUnit } = useGlobalUnitSelection(DEFAULT_UNIT_OPTIONS)
  const unitKey = effectiveUnit
  const normalizedUnit = useMemo(() => (effectiveUnit || '').toLowerCase(), [effectiveUnit])
  const unitOptionsForSelect = useMemo(() => {
    if (!selectedUnit) return DEFAULT_UNIT_OPTIONS
    if (DEFAULT_UNIT_OPTIONS.some((o) => o.value === selectedUnit)) return DEFAULT_UNIT_OPTIONS
    return [{ value: selectedUnit, label: selectedUnit }, ...DEFAULT_UNIT_OPTIONS]
  }, [selectedUnit])

  const [cameras, setCameras] = useKV<RtspCameraConfig[]>(`unit-monitor:cameras:${unitKey}`, [])
  const [rtspRecordingConfig, setRtspRecordingConfig] = useKV<RtspRecordingConfig>(
    `unit-monitor:rtsp-recording:${unitKey}`,
    { segmentSeconds: 60, retentionDays: 7 }
  )

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [serverStatus, setServerStatus] = useState<'unknown' | 'connected' | 'offline'>('unknown')
  const [mainTab, setMainTab] = useState<'rtsp' | 'logs'>('rtsp')

  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus | null>(null)
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<UnitMonitorDiagnostics | null>(null)
  const [rtspRecorders, setRtspRecorders] = useState<RtspRecorderStatus[]>([])
  const [rtspSegments, setRtspSegments] = useState<RecordingSegment[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')
  const [playbackUrl, setPlaybackUrl] = useState<string>('')

  const [cameraEditorAdvanced, setCameraEditorAdvanced] = useState(false)
  const [cameraEditor, setCameraEditor] = useState<RtspCameraConfig>({
    id: '',
    name: '',
    host: '',
    port: 554,
    username: '',
    password: '',
    streamPath: 'stream1',
    rtspUrl: '',
    enabled: true
  })
  const [editingCameraId, setEditingCameraId] = useState<string | null>(null)

  const [liveTransport, setLiveTransport] = useState<'webrtc' | 'hls'>('webrtc')

  const installerBaseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const macInstallerUrl = installerBaseUrl ? `${installerBaseUrl}/downloads/unit-monitor-gateway-mac.command` : '/downloads/unit-monitor-gateway-mac.command'
  const winInstallerUrl = installerBaseUrl ? `${installerBaseUrl}/downloads/unit-monitor-gateway-windows.ps1` : '/downloads/unit-monitor-gateway-windows.ps1'
  const macOneLiner = useMemo(
    () => `curl -fsSL "${macInstallerUrl}" -o unit-monitor-gateway.command && chmod +x unit-monitor-gateway.command && ./unit-monitor-gateway.command`,
    [macInstallerUrl]
  )
  const winOneLiner = useMemo(
    () => `powershell -ExecutionPolicy Bypass -Command "iwr -useb '${winInstallerUrl}' | iex"`,
    [winInstallerUrl]
  )

  const [proxyStatus, setProxyStatus] = useState<UnitMonitorProxyStatus | null>(null)
  const [gatewayInfo, setGatewayInfo] = useState<UnitMonitorGatewayInfo | null>(null)
  const [gatewayReachable, setGatewayReachable] = useState<'unknown' | 'ok' | 'fail'>('unknown')
  const [gatewayCheckBusy, setGatewayCheckBusy] = useState(false)
  const canQueryGateway = !!proxyStatus?.targetConfigured

  const copyText = async (text: string) => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      toast.success('Copiado')
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  const addLog = (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message
    }
    setLogs((prev) => [...prev.slice(-199), entry])
  }

  const refreshGatewaySetup = async () => {
    setGatewayCheckBusy(true)
    try {
      const ps = await apiJson<UnitMonitorProxyStatus>('/api/unit-monitor/_proxy-status')
      setProxyStatus(ps)

      if (!ps?.targetConfigured) {
        setGatewayReachable('fail')
        setGatewayInfo(null)
        return
      }

      try {
        await apiJson<{ ok: boolean; ts?: string }>('/api/unit-monitor/health')
        setGatewayReachable('ok')
      } catch {
        setGatewayReachable('fail')
      }

      try {
        const info = await apiJson<UnitMonitorGatewayInfo>('/api/unit-monitor/gateway/info')
        setGatewayInfo(info)
      } catch {
        setGatewayInfo(null)
      }
    } finally {
      setGatewayCheckBusy(false)
    }
  }

  const loadServerState = async () => {
    if (!effectiveUnit) return
    setServerStatus('unknown')
    try {
      const data = await apiJson<{
        ok: boolean
        config?: {
          cameras?: RtspCameraConfig[]
          rtspRecording?: Partial<RtspRecordingConfig>
        }
      }>(`/api/unit-monitor/state?unit=${encodeURIComponent(effectiveUnit)}`)

      if (Array.isArray(data?.config?.cameras)) setCameras(data.config!.cameras!)
      if (data?.config?.rtspRecording) setRtspRecordingConfig((prev) => ({ ...prev, ...data.config!.rtspRecording! }))
      setServerStatus('connected')
      addLog('STATUS', `Config carregada do servidor (${effectiveUnit})`)
    } catch (error) {
      setServerStatus('offline')
      addLog('WARNING', `Servidor offline ou sem config: ${error}`)
    }
  }

  const saveServerState = async () => {
    if (!effectiveUnit) return
    try {
      await apiJson(`/api/unit-monitor/state?unit=${encodeURIComponent(effectiveUnit)}`, {
        method: 'PUT',
        body: JSON.stringify({
          unit: effectiveUnit,
          config: {
            cameras,
            rtspRecording: rtspRecordingConfig
          }
        })
      })
      setServerStatus('connected')
      toast.success('Config salva no servidor')
      addLog('STATUS', `Config salva no servidor (${effectiveUnit})`)
    } catch (error) {
      setServerStatus('offline')
      toast.error('Falha ao salvar no servidor')
      addLog('ERROR', `Falha ao salvar no servidor: ${error}`)
    }
  }

  const refreshStreamingStatus = async () => {
    const data = await apiJson<StreamingStatus>('/api/unit-monitor/streaming/status')
    setStreamingStatus(data)
  }

  const refreshDiagnostics = async () => {
    setDiagnosticsBusy(true)
    try {
      const data = await apiJson<UnitMonitorDiagnostics>('/api/unit-monitor/diagnostics')
      setDiagnostics(data)
    } finally {
      setDiagnosticsBusy(false)
    }
  }

  const refreshRtspRecorders = async () => {
    const data = await apiJson<{ ok: boolean; recorders: RtspRecorderStatus[] }>('/api/unit-monitor/rtsp/recorders')
    setRtspRecorders(Array.isArray(data?.recorders) ? data.recorders : [])
  }

  const loadRtspSegments = async (unit: string, cameraId: string) => {
    if (!unit || !cameraId) return
    const data = await apiJson<{ ok: boolean; segments: RecordingSegment[] }>(
      `/api/unit-monitor/rtsp/recordings?unit=${encodeURIComponent(unit)}&cameraId=${encodeURIComponent(cameraId)}&limit=500`
    )
    setRtspSegments(Array.isArray(data?.segments) ? data.segments : [])
  }

  const startStreamingGateway = async () => {
    try {
      await saveServerState()
      await apiJson('/api/unit-monitor/streaming/start', { method: 'POST' })
      addLog('STATUS', 'Streaming gateway iniciado (MediaMTX)')
      await refreshStreamingStatus()
    } catch (error) {
      addLog('ERROR', `Falha ao iniciar streaming gateway: ${error}`)
      toast.error('Falha ao iniciar streaming gateway')
    }
  }

  const stopStreamingGateway = async () => {
    try {
      await apiJson('/api/unit-monitor/streaming/stop', { method: 'POST' })
      addLog('STATUS', 'Streaming gateway parado (MediaMTX)')
      await refreshStreamingStatus()
    } catch (error) {
      addLog('ERROR', `Falha ao parar streaming gateway: ${error}`)
      toast.error('Falha ao parar streaming gateway')
    }
  }

  const selectedStream = useMemo(() => {
    const list = streamingStatus?.streams || []
    return list.find((s) => s.unit === normalizedUnit && s.cameraId === selectedCameraId) || null
  }, [streamingStatus, normalizedUnit, selectedCameraId])

  const canWebrtc = !!streamingStatus?.running && !!selectedStream?.webrtcUrlProxy
  const canHls = !!streamingStatus?.running && !!selectedStream?.hlsUrlProxy

  const selectedRecorder = useMemo(() => {
    return (Array.isArray(rtspRecorders) ? rtspRecorders : []).find(
      (r) => r.unit === normalizedUnit && r.cameraId === selectedCameraId
    ) || null
  }, [rtspRecorders, normalizedUnit, selectedCameraId])

  const startRtspRecording = async () => {
    if (!effectiveUnit || !selectedCameraId) {
      toast.error('Selecione unidade e câmera')
      return
    }
    try {
      await saveServerState()
      await apiJson('/api/unit-monitor/rtsp/recorders/start', {
        method: 'POST',
        body: JSON.stringify({ unit: effectiveUnit, cameraId: selectedCameraId, segmentSeconds: rtspRecordingConfig.segmentSeconds })
      })
      addLog('STATUS', `Gravação RTSP iniciada (${effectiveUnit}/${selectedCameraId})`)
      await refreshRtspRecorders()
      await loadRtspSegments(effectiveUnit, selectedCameraId)
    } catch (error) {
      addLog('ERROR', `Falha ao iniciar gravação RTSP: ${error}`)
      toast.error('Falha ao iniciar gravação')
    }
  }

  const stopRtspRecording = async () => {
    if (!effectiveUnit || !selectedCameraId) return
    try {
      await apiJson('/api/unit-monitor/rtsp/recorders/stop', {
        method: 'POST',
        body: JSON.stringify({ unit: effectiveUnit, cameraId: selectedCameraId })
      })
      addLog('STATUS', `Gravação RTSP parada (${effectiveUnit}/${selectedCameraId})`)
      await refreshRtspRecorders()
    } catch (error) {
      addLog('ERROR', `Falha ao parar gravação RTSP: ${error}`)
      toast.error('Falha ao parar gravação')
    }
  }

  const testRtspConnection = async () => {
    const basicRtspUrl = buildRtspUrlFromParts(cameraEditor)
    const advancedRtspUrl = String(cameraEditor.rtspUrl || '').trim()
    const rtspUrl = cameraEditorAdvanced ? advancedRtspUrl : basicRtspUrl

    if (cameraEditorAdvanced && !rtspUrl) return toast.error('RTSP URL obrigatório')
    if (!cameraEditorAdvanced) {
      if (!String(cameraEditor.host || '').trim()) return toast.error('IP/Host obrigatório')
      if (!String(cameraEditor.username || '').trim()) return toast.error('Usuário obrigatório')
      if (!String(cameraEditor.password || '').trim()) return toast.error('Senha obrigatória')
    }

    try {
      const payload = cameraEditorAdvanced
        ? { rtspUrl }
        : {
            host: String(cameraEditor.host || '').trim(),
            port: Number(cameraEditor.port || 554) || 554,
            username: String(cameraEditor.username || '').trim(),
            password: String(cameraEditor.password || '').trim(),
            streamPath: normalizeStreamPath(cameraEditor.streamPath || 'stream1')
          }

      const result = await apiJson<RtspTestResult>('/api/unit-monitor/rtsp/test', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      addLog('STATUS', `RTSP OK: ${result.maskedUrl || maskRtspUrl(rtspUrl)}`)
      toast.success('RTSP OK')
    } catch (e: any) {
      let msg = e?.message || String(e)
      let json: any = null
      try { json = JSON.parse(msg) } catch { /* ignore */ }
      if (json && typeof json === 'object') msg = json.error || msg
      addLog('ERROR', `RTSP test falhou: ${msg}`)
      toast.error('Falha ao testar RTSP')
    }
  }

  const convertRtspUrlToBasic = () => {
    const raw = String(cameraEditor.rtspUrl || '').trim()
    const parsed = parseRtspUrl(raw)
    if (!parsed) {
      toast.error('RTSP URL inválida para converter')
      return
    }
    setCameraEditor((prev) => ({
      ...prev,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      streamPath: parsed.streamPath,
      rtspUrl: ''
    }))
    setCameraEditorAdvanced(false)
    toast.success('Convertido para modo simples')
  }

  const upsertCamera = () => {
    const name = String(cameraEditor.name || '').trim()
    const enabled = cameraEditor.enabled !== false

    const basicRtspUrl = buildRtspUrlFromParts(cameraEditor)
    const advancedRtspUrl = String(cameraEditor.rtspUrl || '').trim()
    const rtspUrl = cameraEditorAdvanced ? advancedRtspUrl : basicRtspUrl
    if (cameraEditorAdvanced && !rtspUrl) return toast.error('RTSP URL obrigatório')
    if (!cameraEditorAdvanced) {
      if (!String(cameraEditor.host || '').trim()) return toast.error('IP/Host obrigatório')
      if (!String(cameraEditor.username || '').trim()) return toast.error('Usuário obrigatório')
      if (!String(cameraEditor.password || '').trim()) return toast.error('Senha obrigatória')
    }

    const id = String(cameraEditor.id || '').trim() || deriveCameraId(cameraEditor)

    setCameras((prev) => {
      const list = Array.isArray(prev) ? prev.slice() : []
      const idx = list.findIndex((c) => c.id === (editingCameraId || id))
      const next: RtspCameraConfig = {
        id,
        name: name || id,
        enabled,
        ...(cameraEditorAdvanced
          ? { rtspUrl }
          : {
              host: String(cameraEditor.host || '').trim(),
              port: Number(cameraEditor.port || 554) || 554,
              username: String(cameraEditor.username || '').trim(),
              password: String(cameraEditor.password || '').trim(),
              streamPath: normalizeStreamPath(cameraEditor.streamPath || 'stream1')
            })
      }
      if (idx >= 0) list[idx] = next
      else list.push(next)
      return list
    })

    setEditingCameraId(null)
    setCameraEditorAdvanced(false)
    setCameraEditor({
      id: '',
      name: '',
      host: '',
      port: 554,
      username: '',
      password: '',
      streamPath: 'stream1',
      rtspUrl: '',
      enabled: true
    })
    toast.success('Câmera atualizada')
  }

  const editCamera = (cam: RtspCameraConfig) => {
    const id = String(cam.id || '').trim()
    setEditingCameraId(id)
    const hasParts = !!(cam.host || cam.username || cam.password || cam.streamPath)
    setCameraEditorAdvanced(!hasParts && !!cam.rtspUrl)
    setCameraEditor({
      id,
      name: String(cam.name || '').trim(),
      host: String(cam.host || '').trim(),
      port: Number(cam.port || 554) || 554,
      username: String(cam.username || '').trim(),
      password: String(cam.password || '').trim(),
      streamPath: normalizeStreamPath(cam.streamPath || 'stream1'),
      rtspUrl: String(cam.rtspUrl || '').trim(),
      enabled: cam.enabled !== false
    })
  }

  const deleteCamera = (cameraId: string) => {
    setCameras((prev) => (Array.isArray(prev) ? prev.filter((c) => c.id !== cameraId) : []))
    if (selectedCameraId === cameraId) setSelectedCameraId('')
    toast.success('Câmera removida')
  }

  useEffect(() => {
    addLog('INFO', 'Unit Monitor carregado (modo RTSP)')
    refreshGatewaySetup().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!effectiveUnit || !canQueryGateway) return
    loadServerState().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUnit, canQueryGateway])

  useEffect(() => {
    if (selectedCameraId) return
    const first = Array.isArray(cameras) ? cameras.find((c) => c?.id) : null
    if (first?.id) setSelectedCameraId(first.id)
  }, [cameras, selectedCameraId])

  useEffect(() => {
    if (mainTab !== 'rtsp' || !canQueryGateway) return
    refreshStreamingStatus().catch(() => {})
    refreshRtspRecorders().catch(() => {})
    if (effectiveUnit && selectedCameraId) loadRtspSegments(effectiveUnit, selectedCameraId).catch(() => {})

    const t = window.setInterval(() => {
      refreshStreamingStatus().catch(() => {})
      refreshRtspRecorders().catch(() => {})
      if (effectiveUnit && selectedCameraId) loadRtspSegments(effectiveUnit, selectedCameraId).catch(() => {})
    }, 5000)

    return () => window.clearInterval(t)
  }, [mainTab, effectiveUnit, selectedCameraId, canQueryGateway])

  return (
    <>
      <div className="space-y-6 max-w-6xl mx-auto">
	        <div className="space-y-2">
	          <p className="text-sm text-blue-300/80">Monitoramento e gravação RTSP por unidade (MediaMTX + ffmpeg).</p>
	          <div className="lg:hidden space-y-2">
            <Select value={selectedUnit} onValueChange={(v) => setSelectedUnit(v)}>
              <SelectTrigger className="bg-white/[0.06] border-white/20 text-white">
                <SelectValue placeholder="Unidade" />
              </SelectTrigger>
	              <SelectContent>
	                {unitOptionsForSelect.map((unit) => (
	                  <SelectItem key={unit.value} value={unit.value}>
	                    {unit.label}
	                  </SelectItem>
	                ))}
	              </SelectContent>
	            </Select>
	          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-blue-200/70">
              Unidade atual: <span className="font-mono text-white">{effectiveUnit || '-'}</span>
            </div>
          </div>
        </div>

	        <Card className="glass-morphism border-white/20">
	          <CardHeader>
	            <CardTitle className="text-white">Instalar Gateway na LAN</CardTitle>
	            <CardDescription className="text-blue-200/70">
	              Necessário quando as câmeras estão em <span className="font-mono">192.168.x.x</span>. O instalador faz as perguntas, conecta na LAN e expõe uma URL via Cloudflare Tunnel.
	            </CardDescription>
	          </CardHeader>
	          <CardContent className="flex flex-col gap-4">
	            <div className="flex flex-wrap items-center gap-2">
	              <Badge variant={proxyStatus?.targetConfigured ? 'default' : 'destructive'}>
	                CRM online: {proxyStatus?.targetConfigured ? 'apontando para o gateway' : 'falta configurar'}
	              </Badge>
	              <Badge variant={proxyStatus?.proxyTokenConfigured ? 'default' : 'outline'}>
	                Token: {proxyStatus?.proxyTokenConfigured ? 'ok' : 'falta configurar'}
	              </Badge>
	              <Badge variant={gatewayReachable === 'ok' ? 'default' : gatewayReachable === 'fail' ? 'destructive' : 'outline'}>
	                Gateway na LAN: {gatewayReachable === 'ok' ? 'online' : gatewayReachable === 'fail' ? 'offline' : '—'}
	              </Badge>
	              <Button
	                size="sm"
	                variant="outline"
	                onClick={() => refreshGatewaySetup()}
	                disabled={gatewayCheckBusy}
	                className="bg-white/[0.06] border-white/20 text-white"
	              >
	                {gatewayCheckBusy ? 'Verificando…' : 'Verificar agora'}
	              </Button>
	            </div>
	            {proxyStatus?.hint ? <div className="text-xs text-blue-200/70">{proxyStatus.hint}</div> : null}

	            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
	              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
	                <div className="flex items-start gap-3">
	                  <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">1</div>
	                  <div className="min-w-0">
	                    <div className="text-sm font-semibold text-white">Baixe e execute o instalador</div>
	                    <div className="mt-1 text-xs text-blue-200/70">
	                      Execute em um computador que fica na mesma rede das câmeras (LAN). Ele instala dependências, inicia o serviço e cria o Tunnel.
	                    </div>
	                    <div className="mt-3 flex flex-wrap gap-2">
	                      <a href={macInstallerUrl} download>
	                        <Button size="sm" className="bg-white/[0.10] border border-white/20 text-white hover:bg-white/[0.16]">
	                          Baixar para macOS
	                        </Button>
	                      </a>
	                      <a href={winInstallerUrl} download>
	                        <Button size="sm" className="bg-white/[0.10] border border-white/20 text-white hover:bg-white/[0.16]">
	                          Baixar para Windows
	                        </Button>
	                      </a>
	                    </div>
	                    <div className="mt-3 text-xs text-blue-200/70">Se preferir rodar via terminal (um comando):</div>
	                    <div className="mt-2 grid grid-cols-1 gap-2">
	                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 p-2">
	                        <div className="min-w-0 font-mono text-[11px] text-blue-100/80 truncate">{macOneLiner}</div>
	                        <Button size="sm" variant="outline" className="bg-white/[0.06] border-white/20 text-white" onClick={() => copyText(macOneLiner)}>
	                          Copiar
	                        </Button>
	                      </div>
	                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 p-2">
	                        <div className="min-w-0 font-mono text-[11px] text-blue-100/80 truncate">{winOneLiner}</div>
	                        <Button size="sm" variant="outline" className="bg-white/[0.06] border-white/20 text-white" onClick={() => copyText(winOneLiner)}>
	                          Copiar
	                        </Button>
	                      </div>
	                    </div>
	                  </div>
	                </div>
	              </div>

	              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
	                <div className="flex items-start gap-3">
	                  <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">2</div>
	                  <div className="min-w-0">
	                    <div className="text-sm font-semibold text-white">Responda as perguntas do assistente</div>
	                    <div className="mt-1 text-xs text-blue-200/70">Ele vai pedir (nessa ordem):</div>
	                    <ul className="mt-3 space-y-1 text-xs text-blue-100/80">
	                      <li>
	                        <span className="font-semibold text-white">Porta local</span> do gateway (padrão <span className="font-mono text-white">8099</span>)
	                      </li>
	                      <li>
	                        <span className="font-semibold text-white">URL pública</span> do Tunnel (ex: <span className="font-mono text-white">https://unit-monitor-gw.seudominio.com</span>)
	                      </li>
	                      <li>
	                        <span className="font-semibold text-white">CLOUDFLARE_TUNNEL_TOKEN</span> (Cloudflare Zero Trust)
	                      </li>
	                      <li>
	                        <span className="font-semibold text-white">UNIT_MONITOR_PROXY_TOKEN</span> (aperte Enter para gerar automaticamente)
	                      </li>
	                    </ul>
	                    <div className="mt-3 text-xs text-blue-200/70">
	                      Dica: deixe o assistente instalar como serviço (auto-start) para não precisar rodar manualmente depois.
	                    </div>
	                  </div>
	                </div>
	              </div>

	              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
	                <div className="flex items-start gap-3">
	                  <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">3</div>
	                  <div className="min-w-0">
	                    <div className="text-sm font-semibold text-white">Conecte o CRM online ao seu gateway</div>
	                    <div className="mt-1 text-xs text-blue-200/70">No Cloudflare Pages (projeto do CRM), configure as variáveis:</div>
	                    <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-blue-100/80">
	                      <div>
	                        <span className="font-mono text-white">UNIT_MONITOR_API_TARGET</span> = <span className="text-blue-200/80">URL pública do Tunnel</span>
	                      </div>
	                      <div className="mt-1">
	                        <span className="font-mono text-white">UNIT_MONITOR_PROXY_TOKEN</span> = <span className="text-blue-200/80">token gerado no assistente</span>
	                      </div>
	                    </div>
	                    <div className="mt-3 text-xs text-blue-200/70">
	                      Depois disso, o CRM consegue falar com seu computador na LAN de forma segura (via Cloudflare Tunnel).
	                    </div>
	                  </div>
	                </div>
	              </div>

	              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
	                <div className="flex items-start gap-3">
	                  <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">4</div>
	                  <div className="min-w-0">
	                    <div className="text-sm font-semibold text-white">Verifique e finalize</div>
	                    <div className="mt-1 text-xs text-blue-200/70">
	                      Clique em <span className="text-white font-semibold">Verificar agora</span> acima. Quando estiver online, você já pode configurar RTSP e iniciar o streaming.
	                    </div>
	                    {gatewayInfo?.ok ? (
	                      <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-blue-100/80">
	                        <div className="flex flex-wrap items-center gap-2">
	                          <Badge variant="secondary">Gateway</Badge>
	                          <Badge variant="outline">{gatewayInfo.gateway?.version ? `v${gatewayInfo.gateway.version}` : 'v?'}</Badge>
	                          <Badge variant="outline">{gatewayInfo.host?.ips?.[0] ? `IP ${gatewayInfo.host.ips[0]}` : 'IP ?'}</Badge>
	                          <Badge variant="outline">{gatewayInfo.bins?.mediamtxVersion ? `MediaMTX ${gatewayInfo.bins.mediamtxVersion}` : 'MediaMTX ?'}</Badge>
	                        </div>
	                        <div className="mt-2 text-[11px] text-blue-200/70">
	                          uptime {Math.floor(Number(gatewayInfo.uptimeSec || 0) / 60)}m · node {gatewayInfo.node || '—'}
	                        </div>
	                      </div>
	                    ) : (
	                      <div className="mt-3 text-xs text-blue-200/70">
	                        Se ficar <span className="text-white font-semibold">offline</span>, confirme que o computador está ligado, com internet, e que o Tunnel está ativo.
	                      </div>
	                    )}
	                  </div>
	                </div>
	              </div>
	            </div>
	          </CardContent>
	        </Card>

        <Card className="glass-morphism border-white/20">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Sincronização
            </CardTitle>
            <CardDescription className="text-blue-200/70">Salve/carregue a configuração da unidade no servidor do CRM.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="bg-white/[0.06] border-white/20 text-white" onClick={() => loadServerState()} disabled={!effectiveUnit}>
              Recarregar
            </Button>
            <Button size="sm" variant="outline" className="bg-white/[0.06] border-white/20 text-white" onClick={() => saveServerState()} disabled={!effectiveUnit}>
              Salvar
            </Button>
            <Badge variant={serverStatus === 'connected' ? 'default' : serverStatus === 'offline' ? 'destructive' : 'outline'}>
              Servidor: {serverStatus === 'connected' ? 'online' : serverStatus === 'offline' ? 'offline' : '?'}
            </Badge>
          </CardContent>
        </Card>

        <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as any)}>
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="rtsp" className="flex items-center gap-2">
              <Camera className="w-4 h-4" />
              RTSP
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rtsp" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Camera className="w-5 h-5" />
                  Unit Monitor (RTSP)
                </CardTitle>
                <CardDescription className="text-blue-200/70">
                  Live (WebRTC/HLS via MediaMTX) + gravação server-side (ffmpeg) + playback no CRM.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span>Streaming gateway (MediaMTX)</span>
                          <div className="flex items-center gap-2">
                            <Badge variant={streamingStatus?.running ? 'default' : 'outline'}>
                              {streamingStatus?.running ? 'RUNNING' : 'STOPPED'}
                            </Badge>
                            {streamingStatus?.pid ? <Badge variant="secondary">PID {streamingStatus.pid}</Badge> : null}
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {streamingStatus?.lastError ? <div className="text-xs text-red-400">Erro: {streamingStatus.lastError}</div> : null}
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" onClick={() => refreshStreamingStatus().catch(() => {})} variant="outline">
                            Atualizar
                          </Button>
                          <Button size="sm" onClick={() => refreshDiagnostics().catch(() => {})} variant="outline" disabled={diagnosticsBusy}>
                            {diagnosticsBusy ? 'Diagnóstico…' : 'Diagnóstico'}
                          </Button>
                          {!streamingStatus?.running ? (
                            <Button size="sm" onClick={startStreamingGateway}>
                              Salvar e iniciar
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={stopStreamingGateway}>
                              Parar
                            </Button>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">Dica: salve a config da unidade (câmeras + retenção) antes de iniciar.</div>
                        {diagnostics ? (
                          <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <Badge variant="secondary">Diagnóstico</Badge>
                              {diagnostics?.minFreeGb != null ? <Badge variant="outline">min free {Number(diagnostics.minFreeGb)}GB</Badge> : null}
                              {diagnostics?.disk?.capacity ? <Badge variant="outline">{diagnostics.disk.capacity} disco</Badge> : null}
                              {diagnostics?.disk?.availableKb != null ? <Badge variant="outline">{formatBytes(kbToBytes(diagnostics.disk.availableKb))} livre</Badge> : null}
                              {diagnostics?.mediamtx?.pidRunning ? <Badge>MediaMTX OK</Badge> : <Badge variant="outline">MediaMTX?</Badge>}
                            </div>
                            {diagnostics?.mediamtx?.logTail ? (
                              <ScrollArea className="h-32 rounded-md border border-white/10 bg-black/30 p-2">
                                <pre className="whitespace-pre-wrap break-words text-[10px] text-blue-100/80">{diagnostics.mediamtx.logTail}</pre>
                              </ScrollArea>
                            ) : (
                              <div className="text-xs text-muted-foreground">
                                Sem logs (arquivo não encontrado ou vazio): {diagnostics?.mediamtx?.logFile || '—'}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm">Câmeras (RTSP)</CardTitle>
                        <CardDescription className="text-xs">Exemplo Tapo: <span className="font-mono">rtsp://user:pass@IP:554/stream1</span></CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <ScrollArea className="h-44">
                          <div className="space-y-2">
                            {(cameras || []).map((cam) => (
                              <div key={cam.id || `${cam.host || cam.rtspUrl || 'cam'}`} className={`rounded-lg border p-2 ${selectedCameraId === cam.id ? 'border-primary' : 'border-border'}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">
                                      {cam.name || cam.id || 'Câmera'} {cam.id ? <span className="text-xs text-muted-foreground">({cam.id})</span> : null}
                                    </div>
                                    <div className="text-xs text-muted-foreground font-mono truncate">
                                      {maskRtspUrl(cam.rtspUrl || buildRtspUrlFromParts(cam))}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={cam.enabled !== false}
                                      onCheckedChange={(checked) => setCameras((prev) => (prev || []).map((c) => (c.id === cam.id ? { ...c, enabled: checked } : c)))}
                                    />
                                    <Button size="sm" variant="outline" onClick={() => cam.id && setSelectedCameraId(cam.id)}>
                                      Ver
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => editCamera(cam)}>
                                      Editar
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => deleteCamera(String(cam.id || ''))}>
                                      Remover
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                            {!cameras?.length ? <div className="text-center py-6 text-muted-foreground text-sm">Nenhuma câmera configurada ainda.</div> : null}
                          </div>
                        </ScrollArea>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <Label className="text-sm">ID</Label>
                            <Input value={String(cameraEditor.id || '')} onChange={(e) => setCameraEditor((p) => ({ ...p, id: e.target.value }))} placeholder="(opcional) ex: tapo_92" disabled={!!editingCameraId} />
                          </div>
                          <div>
                            <Label className="text-sm">Nome</Label>
                            <Input value={String(cameraEditor.name || '')} onChange={(e) => setCameraEditor((p) => ({ ...p, name: e.target.value }))} placeholder="ex: Recepção" />
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <Label className="text-sm">Modo avançado (URL completa)</Label>
                          <Switch checked={cameraEditorAdvanced} onCheckedChange={setCameraEditorAdvanced} />
                        </div>

                        {cameraEditorAdvanced ? (
                          <div>
                            <Label className="text-sm">RTSP URL</Label>
                            <Input value={String(cameraEditor.rtspUrl || '')} onChange={(e) => setCameraEditor((p) => ({ ...p, rtspUrl: e.target.value }))} placeholder="rtsp://user:pass@IP:554/stream1" />
                            <div className="mt-1 text-xs text-muted-foreground font-mono">Preview: {maskRtspUrl(String(cameraEditor.rtspUrl || ''))}</div>
                            <div className="mt-2 flex gap-2">
                              <Button size="sm" variant="outline" type="button" onClick={convertRtspUrlToBasic} disabled={!parseRtspUrl(String(cameraEditor.rtspUrl || '').trim())}>
                                Converter para modo simples
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <Label className="text-sm">IP / Host</Label>
                                <Input value={String(cameraEditor.host || '')} onChange={(e) => setCameraEditor((p) => ({ ...p, host: e.target.value }))} placeholder="192.168.15.92" />
                              </div>
                              <div>
                                <Label className="text-sm">Porta</Label>
                                <Input type="number" min="1" max="65535" value={Number(cameraEditor.port || 554)} onChange={(e) => setCameraEditor((p) => ({ ...p, port: Math.max(1, Math.min(65535, parseInt(e.target.value || '554', 10) || 554)) }))} />
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <Label className="text-sm">Usuário</Label>
                                <Input value={String(cameraEditor.username || '')} onChange={(e) => setCameraEditor((p) => ({ ...p, username: e.target.value }))} placeholder="skincos" />
                              </div>
                              <div>
                                <Label className="text-sm">Senha</Label>
                                <Input type="password" value={String(cameraEditor.password || '')} onChange={(e) => setCameraEditor((p) => ({ ...p, password: e.target.value }))} placeholder="••••••••" />
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm">Stream</Label>
                              <Select value={normalizeStreamPath(cameraEditor.streamPath || 'stream1')} onValueChange={(value) => setCameraEditor((p) => ({ ...p, streamPath: value }))}>
                                <SelectTrigger className="mt-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="stream1">stream1 (main)</SelectItem>
                                  <SelectItem value="stream2">stream2 (sub)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">Preview: {maskRtspUrl(buildRtspUrlFromParts(cameraEditor))}</div>
                          </>
                        )}

                        <div className="flex items-center justify-between">
                          <Label className="text-sm">Enabled</Label>
                          <Switch checked={cameraEditor.enabled !== false} onCheckedChange={(checked) => setCameraEditor((p) => ({ ...p, enabled: checked }))} />
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" variant="outline" onClick={() => testRtspConnection().catch(() => {})}>
                            Testar RTSP
                          </Button>
                          <Button size="sm" onClick={upsertCamera}>
                            {editingCameraId ? 'Salvar edição' : 'Adicionar'}
                          </Button>
                          {editingCameraId ? (
                            <Button size="sm" variant="outline" onClick={() => {
                              setEditingCameraId(null)
                              setCameraEditorAdvanced(false)
                              setCameraEditor({ id: '', name: '', host: '', port: 554, username: '', password: '', streamPath: 'stream1', rtspUrl: '', enabled: true })
                            }}>
                              Cancelar
                            </Button>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span>Live view</span>
                          <div className="flex items-center gap-2">
                            <Badge variant={liveTransport === 'webrtc' ? 'default' : 'secondary'}>{liveTransport === 'webrtc' ? 'WebRTC' : 'HLS'}</Badge>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setLiveTransport((v) => (v === 'webrtc' ? 'hls' : 'webrtc'))}>
                              Alternar
                            </Button>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {!selectedCameraId ? <div className="text-sm text-muted-foreground">Selecione uma câmera.</div> : null}
                        {selectedCameraId && !streamingStatus?.running ? (
                          <div className="text-sm text-muted-foreground">Streaming gateway parado. Clique em “Salvar e iniciar”.</div>
                        ) : null}
                        {selectedCameraId && streamingStatus?.running && !selectedStream ? (
                          <div className="text-sm text-muted-foreground">Stream ainda não disponível. Verifique se a câmera está enabled e se a config foi salva.</div>
                        ) : null}

                        {selectedStream && streamingStatus?.running ? (
                          <>
                            {liveTransport === 'webrtc' && canWebrtc ? (
                              <WebRTCPlayer
                                whepUrl={selectedStream.webrtcUrlProxy}
                                isConnected={true}
                                iceServers={streamingStatus?.iceServers}
                                onError={(err) => {
                                  addLog('WARNING', `WebRTC: ${err}`)
                                  setLiveTransport('hls')
                                }}
                              />
                            ) : liveTransport === 'hls' && canHls ? (
                              <RTSPPlayer streamUrl={selectedStream.hlsUrlProxy} isConnected={true} />
                            ) : (
                              <div className="text-sm text-muted-foreground">Sem transporte compatível (WebRTC/HLS).</div>
                            )}
                          </>
                        ) : null}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span>Gravação server-side (ffmpeg)</span>
                          {selectedRecorder?.pid ? <Badge variant="secondary">PID {selectedRecorder.pid}</Badge> : <Badge variant="outline">STOPPED</Badge>}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {!selectedRecorder ? (
                            <Button size="sm" onClick={startRtspRecording} disabled={!effectiveUnit || !selectedCameraId}>
                              Iniciar
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={stopRtspRecording}>
                              Parar
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => {
                            refreshRtspRecorders().catch(() => {})
                            if (effectiveUnit && selectedCameraId) loadRtspSegments(effectiveUnit, selectedCameraId).catch(() => {})
                          }}>
                            Atualizar
                          </Button>
                        </div>
                        {selectedRecorder?.lastError ? <div className="text-xs text-red-400">Erro: {selectedRecorder.lastError}</div> : null}
                        {selectedRecorder?.logFile ? <div className="text-xs text-muted-foreground font-mono truncate">log: {selectedRecorder.logFile}</div> : null}

                        <div className="text-xs text-muted-foreground">
                          Segmentos: {rtspRecordingConfig.segmentSeconds}s • Retenção: {rtspRecordingConfig.retentionDays} dias
                        </div>

                        <ScrollArea className="h-48">
                          <div className="space-y-2">
                            {rtspSegments.map((s) => (
                              <div key={`${s.cameraId}-${s.filename}-${s.createdAt}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-mono truncate">{s.filename}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {new Date(s.createdAt).toLocaleString()} • {formatBytes(s.sizeBytes)}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button size="sm" variant="outline" onClick={() => setPlaybackUrl(s.playbackUrl)}>
                                      Playback
                                    </Button>
                                    <a className="text-xs underline" href={s.downloadUrl} target="_blank" rel="noreferrer">
                                      Download
                                    </a>
                                  </div>
                                </div>
                              </div>
                            ))}
                            {!rtspSegments.length ? <div className="text-center py-6 text-muted-foreground text-sm">Nenhum segmento ainda.</div> : null}
                          </div>
                        </ScrollArea>

                        {playbackUrl ? (
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Playback</div>
                            <video controls className="w-full rounded-lg bg-black" src={playbackUrl} />
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-white">Logs Operacionais</CardTitle>
              </CardHeader>
              <CardContent>
                <SystemLogs logs={logs} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <Toaster />
    </>
  )
}

export default UnitMonitor
