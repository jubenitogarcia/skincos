import React, { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Camera,
  FolderOpen,
  Globe,
  Heart,
  Monitor,
  Play,
  Square,
  TestTube,
  Terminal,
  VideoCamera
} from '@phosphor-icons/react'

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

import { CameraFavorites } from '@/CameraFavorites'
import { ComprehensiveTestRunner } from '@/ComprehensiveTestRunner'
import { CrossPlatformRecordingTest } from '@/CrossPlatformRecordingTest'
import { GoogleHomeCameraRecordingTest } from '@/GoogleHomeCameraRecordingTest'
import { GoogleHomeCameraTest } from '@/GoogleHomeCameraTest'
import { GoogleHomeTest } from '@/GoogleHomeTest'
import { GoogleHomeWebView } from '@/GoogleHomeWebView'
import { RealWorldCameraTest } from '@/RealWorldCameraTest'
import { RTSPPlayer } from '@/RTSPPlayer'
import { WebRTCPlayer } from '@/WebRTCPlayer'
import { ScreenRecorder } from '@/ScreenRecorder'
import { ScreenRecordingTest } from '@/ScreenRecordingTest'
import { SystemLogs } from '@/SystemLogs'
import { TestSummary } from '@/TestSummary'
import { TestingChecklist } from '@/TestingChecklist'
import { TestingGuide } from '@/TestingGuide'
import { CameraTestingGuide } from '@/CameraTestingGuide'
import { BrowserCompatibilityGuide } from '@/BrowserCompatibilityGuide'
import { BrowserCompatibilityTest } from '@/BrowserCompatibilityTest'

interface CameraFavorite {
  id: string
  name: string
  automationScript?: string
  createdAt: string
}

interface RecordingSettings {
  quality: 'high' | 'medium' | 'low'
  format: 'webm' | 'mp4'
  autoRecord: boolean
  recordingPath: string
  maxDuration: number
}

interface RecordingMeta {
  id: string
  unit: string
  filename: string
  createdAt: string
  durationSeconds: number
  sizeBytes: number
  mimeType?: string | null
  savedPath?: string | null
}

interface LogEntry {
  id: string
  timestamp: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'STATUS'
  message: string
}

interface RtspCameraConfig {
  id?: string
  name?: string
  // Basic mode (recommended)
  host?: string
  port?: number
  username?: string
  password?: string
  streamPath?: string // e.g. "stream1" or "/stream1"
  // Advanced mode (power users)
  rtspUrl?: string
  enabled?: boolean
}

interface RtspRecordingConfig {
  segmentSeconds: number
  retentionDays: number
}

type OperatingDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

interface OperatingHoursDay {
  day: OperatingDayKey
  enabled: boolean
  start: string // HH:MM
  end: string // HH:MM
}

interface OperatingHoursConfig {
  enabled: boolean
  timezone: string
  days: OperatingHoursDay[]
}

interface StreamingStatus {
  ok: boolean
  running: boolean
  pid: number | null
  startedAt: string | null
  lastError: string | null
  hlsTarget?: string
  hlsProxyBase?: string
  webrtcTarget?: string
  webrtcProxyBase?: string
  streams: Array<{
    unit: string
    cameraId: string
    name: string
    pathKey: string
    hlsUrlDirect: string
    hlsUrlProxy: string
    webrtcUrlDirect: string
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

const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  quality: 'high',
  format: 'webm',
  autoRecord: false,
  recordingPath: 'Downloads (Browser)',
  maxDuration: 30
}

function getDefaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function makeDefaultOperatingHours(timezone: string = getDefaultTimeZone()): OperatingHoursConfig {
  return {
    enabled: true,
    timezone,
    days: [
      { day: 'mon', enabled: true, start: '09:00', end: '18:00' },
      { day: 'tue', enabled: true, start: '09:00', end: '18:00' },
      { day: 'wed', enabled: true, start: '09:00', end: '18:00' },
      { day: 'thu', enabled: true, start: '09:00', end: '18:00' },
      { day: 'fri', enabled: true, start: '09:00', end: '18:00' },
      { day: 'sat', enabled: true, start: '09:00', end: '13:00' },
      { day: 'sun', enabled: false, start: '09:00', end: '13:00' }
    ]
  }
}

const DEFAULT_UNITS = [
  { value: 'unit-a', label: 'Unidade A' },
  { value: 'unit-b', label: 'Unidade B' },
  { value: 'unit-c', label: 'Unidade C' },
  { value: 'custom', label: 'Outra' }
]

function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init
  }).then(async (res) => {
    const text = await res.text()
    if (!res.ok) throw new Error(text || `${res.status} ${res.statusText}`)
    return (text ? JSON.parse(text) : null) as T
  })
}

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes)) return '0 B'
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
  return `${(sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI
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

function deriveCameraId(cam: RtspCameraConfig): string {
  const host = safeIdPart(cam.host || '')
  const stream = safeIdPart(normalizeStreamPath(cam.streamPath || 'stream1'))
  if (host) return `cam_${host}_${stream || 'stream1'}`
  return `cam_${Date.now()}`
}

const OPERATING_DAY_ORDER: OperatingDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const OPERATING_DAY_LABEL: Record<OperatingDayKey, string> = {
  mon: 'Seg',
  tue: 'Ter',
  wed: 'Qua',
  thu: 'Qui',
  fri: 'Sex',
  sat: 'Sáb',
  sun: 'Dom'
}

function parseTimeToMinutes(value: string): number | null {
  const s = String(value || '').trim()
  const m = s.match(/^(\d{2}):(\d{2})$/)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

function getZonedNowParts(timezone: string): { day: OperatingDayKey; minutes: number } | null {
  const tz = String(timezone || '').trim() || 'UTC'
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
    const parts = dtf.formatToParts(new Date())
    const weekday = parts.find((p) => p.type === 'weekday')?.value || ''
    const hour = parts.find((p) => p.type === 'hour')?.value || ''
    const minute = parts.find((p) => p.type === 'minute')?.value || ''
    const dayMap: Record<string, OperatingDayKey> = {
      Mon: 'mon',
      Tue: 'tue',
      Wed: 'wed',
      Thu: 'thu',
      Fri: 'fri',
      Sat: 'sat',
      Sun: 'sun'
    }
    const day = dayMap[weekday]
    const hh = Number(hour)
    const mm = Number(minute)
    if (!day || !Number.isFinite(hh) || !Number.isFinite(mm)) return null
    return { day, minutes: hh * 60 + mm }
  } catch {
    return null
  }
}

function isNowWithinOperatingHours(cfg: OperatingHoursConfig): boolean | null {
  if (!cfg?.enabled) return null
  const now = getZonedNowParts(cfg.timezone)
  if (!now) return null
  const dayCfg = (cfg.days || []).find((d) => d.day === now.day)
  if (!dayCfg?.enabled) return false

  const start = parseTimeToMinutes(dayCfg.start)
  const end = parseTimeToMinutes(dayCfg.end)
  if (start == null || end == null) return null
  if (start === end) return false

  if (start < end) return now.minutes >= start && now.minutes < end
  // crosses midnight
  return now.minutes >= start || now.minutes < end
}

export function UnitMonitor() {
  const [selectedUnit, setSelectedUnit] = useKV<string>('unit-monitor:selected-unit', 'unit-a')
  const [customUnit, setCustomUnit] = useKV<string>('unit-monitor:custom-unit', '')
  const unitKey = selectedUnit === 'custom' ? (customUnit.trim() || 'custom') : selectedUnit
  const [recordingSettings, setRecordingSettings] = useKV<RecordingSettings>(
    `unit-monitor:recording:${unitKey}`,
    DEFAULT_RECORDING_SETTINGS
  )
  const [favorites, setFavorites] = useKV<CameraFavorite[]>(`unit-monitor:favorites:${unitKey}`, [])
  const [cameras, setCameras] = useKV<RtspCameraConfig[]>(`unit-monitor:cameras:${unitKey}`, [])
  const [rtspRecordingConfig, setRtspRecordingConfig] = useKV<RtspRecordingConfig>(
    `unit-monitor:rtsp-recording:${unitKey}`,
    { segmentSeconds: 60, retentionDays: 7 }
  )
  const [operatingHours, setOperatingHours] = useKV<OperatingHoursConfig>(
    `unit-monitor:operating-hours:${unitKey}`,
    makeDefaultOperatingHours()
  )

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [recordings, setRecordings] = useState<RecordingMeta[]>([])
  const [serverStatus, setServerStatus] = useState<'unknown' | 'connected' | 'offline'>('unknown')

  const [isGoogleHomeLoaded, setIsGoogleHomeLoaded] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [videoPlayerVisible, setVideoPlayerVisible] = useState(false)

  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [clockTick, setClockTick] = useState(0)

  const [mainTab, setMainTab] = useState<'home' | 'rtsp' | 'tests' | 'guides' | 'logs'>('home')
  const [opsTab, setOpsTab] = useState<'favorites' | 'settings' | 'recordings'>('favorites')

  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus | null>(null)
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
  const [liveMode, setLiveMode] = useKV<'auto' | 'webrtc' | 'hls'>(`unit-monitor:live-mode:${unitKey}`, 'auto')
  const [autoLiveFallback, setAutoLiveFallback] = useState<'webrtc' | 'hls'>('webrtc')

  const recordTimerRef = useRef<number | null>(null)

  const effectiveUnit = unitKey === 'custom' ? customUnit.trim() : unitKey

  const addLog = (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message
    }
    setLogs((prev) => [...prev.slice(-199), entry])
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
      if (idx >= 0) {
        list[idx] = next
      } else {
        if (list.some((c) => c.id === id)) {
          toast.error('Já existe uma câmera com esse ID')
          return list
        }
        list.push(next)
      }
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
    const hasParts = !!(cam.host || (cam as any).ip || cam.username || cam.password || cam.streamPath)
    setCameraEditorAdvanced(!hasParts && !!cam.rtspUrl)
    setCameraEditor({
      id,
      name: String(cam.name || '').trim(),
      host: String(cam.host || (cam as any).ip || '').trim(),
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

  const updateOperatingDay = (day: OperatingDayKey, patch: Partial<OperatingHoursDay>) => {
    setOperatingHours((prev) => {
      const currentDays = Array.isArray(prev?.days) ? prev.days.slice() : []
      const idx = currentDays.findIndex((d) => d.day === day)
      const fallback: OperatingHoursDay = { day, enabled: false, start: '09:00', end: '18:00' }
      const current = idx >= 0 ? currentDays[idx] : fallback
      const next = { ...current, ...patch, day }
      if (idx >= 0) currentDays[idx] = next
      else currentDays.push(next)
      currentDays.sort(
        (a, b) => OPERATING_DAY_ORDER.indexOf(a.day) - OPERATING_DAY_ORDER.indexOf(b.day)
      )
      return { ...prev, days: currentDays }
    })
  }

  const copyDayHours = (from: OperatingDayKey, targets: OperatingDayKey[]) => {
    setOperatingHours((prev) => {
      const days = Array.isArray(prev?.days) ? prev.days.slice() : []
      const source = days.find((d) => d.day === from) || { day: from, enabled: true, start: '09:00', end: '18:00' }
      const sourcePayload = { enabled: source.enabled, start: source.start, end: source.end }

      for (const t of targets) {
        const idx = days.findIndex((d) => d.day === t)
        const cur = idx >= 0 ? days[idx] : { day: t, enabled: false, start: '09:00', end: '18:00' }
        const next = { ...cur, ...sourcePayload, day: t }
        if (idx >= 0) days[idx] = next
        else days.push(next)
      }

      days.sort((a, b) => OPERATING_DAY_ORDER.indexOf(a.day) - OPERATING_DAY_ORDER.indexOf(b.day))
      return { ...prev, days }
    })
  }

  const refreshStreamingStatus = async () => {
    const data = await apiJson<StreamingStatus>('/api/unit-monitor/streaming/status')
    setStreamingStatus(data)
  }

  const refreshRtspRecorders = async () => {
    const data = await apiJson<{ ok: boolean; recorders: RtspRecorderStatus[] }>(
      '/api/unit-monitor/rtsp/recorders'
    )
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

  const startRtspRecording = async () => {
    if (!effectiveUnit || !selectedCameraId) {
      toast.error('Selecione unidade e câmera')
      return
    }
    try {
      await saveServerState()
      await apiJson('/api/unit-monitor/rtsp/recorders/start', {
        method: 'POST',
        body: JSON.stringify({
          unit: effectiveUnit,
          cameraId: selectedCameraId,
          segmentSeconds: rtspRecordingConfig.segmentSeconds
        })
      })
      addLog('STATUS', `Gravação RTSP iniciada (${effectiveUnit}/${selectedCameraId})`)
      await refreshRtspRecorders()
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

  const loadRecordings = async () => {
    if (!effectiveUnit) return
    try {
      const data = await apiJson<{ ok: boolean; recordings: RecordingMeta[] }>(
        `/api/unit-monitor/recordings?unit=${encodeURIComponent(effectiveUnit)}`
      )
      setRecordings(data?.recordings || [])
    } catch (error) {
      addLog('WARNING', `Falha ao carregar gravações: ${error}`)
    }
  }

  const loadServerState = async () => {
    if (!effectiveUnit) return
    setServerStatus('unknown')
    try {
      const data = await apiJson<{
        ok: boolean
        config?: {
          recording?: RecordingSettings
          favorites?: CameraFavorite[]
          cameras?: RtspCameraConfig[]
          rtspRecording?: Partial<RtspRecordingConfig>
          operatingHours?: Partial<OperatingHoursConfig>
        }
      }>(
        `/api/unit-monitor/state?unit=${encodeURIComponent(effectiveUnit)}`
      )
      if (data?.config?.recording) {
        setRecordingSettings((prev) => ({ ...prev, ...data.config!.recording! }))
      }
      if (Array.isArray(data?.config?.favorites)) {
        setFavorites(data.config!.favorites!)
      }
      if (Array.isArray(data?.config?.cameras)) {
        setCameras(data.config!.cameras!)
      }
      if (data?.config?.rtspRecording) {
        setRtspRecordingConfig((prev) => ({ ...prev, ...data.config!.rtspRecording! }))
      }
      if (data?.config?.operatingHours) {
        setOperatingHours((prev) => ({ ...prev, ...data.config!.operatingHours! }))
      }
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
            recording: recordingSettings,
            favorites,
            cameras,
            rtspRecording: rtspRecordingConfig,
            operatingHours
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

  const handleRecordingSaved = async (meta: {
    filename: string
    sizeBytes: number
    mimeType: string
    durationSeconds: number
    savedPath?: string
  }) => {
    if (!effectiveUnit) return
    try {
      const res = await apiJson<{ ok: boolean; recording: RecordingMeta }>(
        '/api/unit-monitor/recordings',
        {
          method: 'POST',
          body: JSON.stringify({
            unit: effectiveUnit,
            filename: meta.filename,
            sizeBytes: meta.sizeBytes,
            durationSeconds: meta.durationSeconds,
            mimeType: meta.mimeType,
            savedPath: meta.savedPath || null,
            createdAt: new Date().toISOString()
          })
        }
      )
      if (res?.recording) {
        setRecordings((prev) => [...prev, res.recording])
      }
    } catch (error) {
      addLog('WARNING', `Falha ao registrar gravação: ${error}`)
    }
  }

  const handleSelectRecordingFolder = async () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.selectSaveLocation) {
      try {
        const path = await (window as any).electronAPI.selectSaveLocation()
        if (path) {
          setRecordingSettings((prev) => ({ ...prev, recordingPath: path }))
          toast.success('Pasta selecionada')
          addLog('INFO', `Pasta de gravação: ${path}`)
        }
        return
      } catch (error) {
        addLog('WARNING', `Falha ao selecionar pasta: ${error}`)
      }
    }
    setRecordingSettings((prev) => ({ ...prev, recordingPath: 'Downloads (Browser)' }))
    toast.info('Usando Downloads do navegador')
  }

  const startRecording = () => {
    if (!effectiveUnit) {
      toast.error('Selecione uma unidade')
      return
    }
    addLog('INFO', 'Iniciando gravação de tela')
    setIsRecording(true)
  }

  const stopRecording = () => {
    addLog('INFO', 'Encerrando gravação de tela')
    setIsRecording(false)
  }

  useEffect(() => {
    addLog('INFO', 'Unit Monitor carregado no CRM')
    addLog('INFO', 'Abra o Google Home e selecione a câmera da unidade')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setClockTick((v) => v + 1), 30000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!effectiveUnit) return
    loadServerState().catch(() => {})
    loadRecordings().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUnit])

  useEffect(() => {
    if (selectedCameraId) return
    const first = Array.isArray(cameras) ? cameras.find((c) => c?.id) : null
    if (first?.id) setSelectedCameraId(first.id)
  }, [cameras, selectedCameraId])

  useEffect(() => {
    if (liveMode !== 'auto') return
    setAutoLiveFallback('webrtc')
  }, [liveMode, selectedCameraId, effectiveUnit, streamingStatus?.running])

  useEffect(() => {
    if (mainTab !== 'rtsp') return

    refreshStreamingStatus().catch(() => {})
    refreshRtspRecorders().catch(() => {})
    if (effectiveUnit && selectedCameraId) loadRtspSegments(effectiveUnit, selectedCameraId).catch(() => {})

    const t = window.setInterval(() => {
      refreshStreamingStatus().catch(() => {})
      refreshRtspRecorders().catch(() => {})
      if (effectiveUnit && selectedCameraId) loadRtspSegments(effectiveUnit, selectedCameraId).catch(() => {})
    }, 5000)

    return () => window.clearInterval(t)
  }, [mainTab, effectiveUnit, selectedCameraId])

  useEffect(() => {
    if (!isRecording) {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
      setRecordingSeconds(0)
      return
    }

    recordTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1)
    }, 1000)

    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
  }, [isRecording])

  useEffect(() => {
    if (recordingSettings.autoRecord && videoPlayerVisible && !isRecording) {
      addLog('INFO', 'Auto-record: video ativo detectado')
      setIsRecording(true)
    }
  }, [recordingSettings.autoRecord, videoPlayerVisible, isRecording])

  const handleFavoriteClick = (favorite: CameraFavorite) => {
    addLog('INFO', `Favorito acionado: ${favorite.name}`)
  }

  const normalizedUnit = useMemo(() => (effectiveUnit || '').toLowerCase(), [effectiveUnit])
  const operatingWithin = useMemo(() => {
    return isNowWithinOperatingHours(operatingHours)
  }, [operatingHours, clockTick])

  const selectedCamera = useMemo(() => {
    if (!selectedCameraId) return null
    return (Array.isArray(cameras) ? cameras : []).find((c) => c.id === selectedCameraId) || null
  }, [cameras, selectedCameraId])

  const selectedStream = useMemo(() => {
    const list = streamingStatus?.streams || []
    return list.find((s) => s.unit === normalizedUnit && s.cameraId === selectedCameraId) || null
  }, [streamingStatus, normalizedUnit, selectedCameraId])

  const selectedRecorder = useMemo(() => {
    return (Array.isArray(rtspRecorders) ? rtspRecorders : []).find(
      (r) => r.unit === normalizedUnit && r.cameraId === selectedCameraId
    ) || null
  }, [rtspRecorders, normalizedUnit, selectedCameraId])

  const recordingControls = (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`} />
        <span className="text-sm font-mono text-white">
          {isRecording ? formatDuration(recordingSeconds) : 'READY'}
        </span>
      </div>
      {!isRecording ? (
        <Button size="sm" onClick={startRecording} className="bg-red-600 hover:bg-red-700">
          <Play className="w-4 h-4" />
          Gravar
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={stopRecording}>
          <Square className="w-4 h-4" />
          Parar
        </Button>
      )}
    </div>
  )

  return (
    <>
      <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <VideoCamera className="w-5 h-5" />
            Unit Monitor (Cameras)
          </h2>
          <p className="text-sm text-blue-300/80">
            Monitoramento e gravação de evidências de câmeras por unidade com automação Google Home.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-white/10 text-white border-white/20">API: {serverStatus}</Badge>
          <Badge className="bg-white/10 text-white border-white/20">Modo: {isElectron() ? 'electron' : 'browser'}</Badge>
          {recordingControls}
        </div>
      </div>

      <Card className="glass-morphism border-white/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Contexto Operacional
          </CardTitle>
          <CardDescription className="text-blue-200/70">
            Configure a unidade, sincronize com o servidor e acesse o Google Home.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-white">Unidade</Label>
            <Select value={selectedUnit} onValueChange={(v) => setSelectedUnit(v)}>
              <SelectTrigger className="bg-white/[0.06] border-white/20 text-white">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {DEFAULT_UNITS.map((unit) => (
                  <SelectItem key={unit.value} value={unit.value}>
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedUnit === 'custom' && (
              <Input
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value)}
                placeholder="ex: unidade-centro"
                className="bg-white/[0.06] border-white/20 text-white placeholder:text-blue-200/40"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-white">Status Google Home</Label>
            <div className="flex flex-wrap gap-2">
              <Badge variant={isGoogleHomeLoaded ? 'default' : 'secondary'}>
                Google Home {isGoogleHomeLoaded ? 'loaded' : 'loading'}
              </Badge>
              <Badge variant={isLoggedIn ? 'default' : 'outline'}>{isLoggedIn ? 'Logged in' : 'Logged out'}</Badge>
              <Badge className="bg-green-600 text-white">
                <Camera className="w-3 h-3 mr-1" />
                {videoPlayerVisible ? 'Video Active' : 'No Video'}
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-white">Sincronização</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="bg-white/[0.06] border-white/20 text-white"
                onClick={() => loadServerState()}
                disabled={!effectiveUnit}
              >
                Recarregar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="bg-white/[0.06] border-white/20 text-white"
                onClick={() => saveServerState()}
                disabled={!effectiveUnit}
              >
                Salvar
              </Button>
            </div>
            <div className="text-xs text-blue-200/60">Unit: {effectiveUnit || 'selecione'}</div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as any)}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="home" className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Operação
          </TabsTrigger>
          <TabsTrigger value="rtsp" className="flex items-center gap-2">
            <Camera className="w-4 h-4" />
            RTSP
          </TabsTrigger>
          <TabsTrigger value="tests" className="flex items-center gap-2">
            <TestTube className="w-4 h-4" />
            Testes
          </TabsTrigger>
          <TabsTrigger value="guides" className="flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            Guias
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="home" className="mt-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="w-full lg:w-80 flex flex-col gap-4">
              <Tabs value={opsTab} onValueChange={(v) => setOpsTab(v as any)}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="favorites" className="flex items-center gap-1">
                    <Heart className="w-4 h-4" />
                    Favoritos
                  </TabsTrigger>
                  <TabsTrigger value="settings" className="flex items-center gap-1">
                    <Monitor className="w-4 h-4" />
                    Config
                  </TabsTrigger>
                  <TabsTrigger value="recordings" className="flex items-center gap-1">
                    <VideoCamera className="w-4 h-4" />
                    Arquivos
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="favorites" className="mt-4">
                  <CameraFavorites
                    favorites={favorites}
                    onFavoritesChange={setFavorites}
                    onFavoriteClick={handleFavoriteClick}
                    onLog={addLog}
                  />
                </TabsContent>

                <TabsContent value="settings" className="mt-4 space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Gravação</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label htmlFor="recording-folder" className="text-sm">Pasta</Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            id="recording-folder"
                            value={recordingSettings.recordingPath || 'Downloads'}
                            readOnly
                            className="text-xs"
                          />
                          <Button size="sm" variant="outline" onClick={handleSelectRecordingFolder}>
                            <FolderOpen className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      <div>
                        <Label className="text-sm">Qualidade</Label>
                        <Select
                          value={recordingSettings.quality}
                          onValueChange={(value: RecordingSettings['quality']) =>
                            setRecordingSettings((prev) => ({ ...prev, quality: value }))}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="high">High (1080p)</SelectItem>
                            <SelectItem value="medium">Medium (720p)</SelectItem>
                            <SelectItem value="low">Low (480p)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-sm">Formato</Label>
                        <Select
                          value={recordingSettings.format}
                          onValueChange={(value: RecordingSettings['format']) =>
                            setRecordingSettings((prev) => ({ ...prev, format: value }))}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="webm">WebM</SelectItem>
                            <SelectItem value="mp4">MP4 (se suportado)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center justify-between">
                        <Label htmlFor="auto-record" className="text-sm">Auto-record</Label>
                        <Switch
                          id="auto-record"
                          checked={recordingSettings.autoRecord}
                          onCheckedChange={(checked) =>
                            setRecordingSettings((prev) => ({ ...prev, autoRecord: checked }))}
                        />
                      </div>

                      <div>
                        <Label className="text-sm">Max duration (min)</Label>
                        <Input
                          type="number"
                          min="1"
                          max="120"
                          value={recordingSettings.maxDuration}
                          onChange={(e) =>
                            setRecordingSettings((prev) => ({
                              ...prev,
                              maxDuration: Math.max(1, Math.min(120, parseInt(e.target.value || '30', 10) || 30))
                            }))}
                          className="mt-1"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Horário de funcionamento</CardTitle>
                      <CardDescription className="text-xs">
                        Usado para disparar eventos (motion/people) e clips fora do expediente.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Ativar controle por horário</Label>
                        <Switch
                          checked={operatingHours.enabled}
                          onCheckedChange={(checked) => setOperatingHours((p) => ({ ...p, enabled: checked }))}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm">Fuso horário (IANA)</Label>
                        <div className="flex gap-2">
                          <Input
                            value={operatingHours.timezone || ''}
                            onChange={(e) => setOperatingHours((p) => ({ ...p, timezone: e.target.value }))}
                            placeholder="America/Sao_Paulo"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setOperatingHours((p) => ({ ...p, timezone: getDefaultTimeZone() }))}
                          >
                            Auto
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Ex.: <span className="font-mono">America/Sao_Paulo</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">Status agora</div>
                        {operatingHours.enabled ? (
                          operatingWithin === null ? (
                            <Badge variant="outline">Indefinido</Badge>
                          ) : operatingWithin ? (
                            <Badge variant="default">Em expediente</Badge>
                          ) : (
                            <Badge variant="secondary">Fora do expediente</Badge>
                          )
                        ) : (
                          <Badge variant="outline">Desativado</Badge>
                        )}
                      </div>

                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyDayHours('mon', ['tue', 'wed', 'thu', 'fri'])}
                        >
                          Copiar Seg → Semana
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyDayHours('mon', ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'])}
                        >
                          Copiar Seg → Todos
                        </Button>
                      </div>

                      <div className="space-y-2">
                        {OPERATING_DAY_ORDER.map((day) => {
                          const cfg =
                            (operatingHours.days || []).find((d) => d.day === day) ||
                            ({ day, enabled: false, start: '09:00', end: '18:00' } as OperatingHoursDay)
                          return (
                            <div key={day} className="flex items-center gap-2">
                              <div className="w-10 text-sm font-medium">{OPERATING_DAY_LABEL[day]}</div>
                              <Switch
                                checked={cfg.enabled}
                                onCheckedChange={(checked) => updateOperatingDay(day, { enabled: checked })}
                              />
                              <Input
                                type="time"
                                value={cfg.start}
                                disabled={!cfg.enabled}
                                onChange={(e) => updateOperatingDay(day, { start: e.target.value })}
                                className="w-28"
                              />
                              <span className="text-xs text-muted-foreground">–</span>
                              <Input
                                type="time"
                                value={cfg.end}
                                disabled={!cfg.enabled}
                                onChange={(e) => updateOperatingDay(day, { end: e.target.value })}
                                className="w-28"
                              />
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="recordings" className="mt-4">
                  <Card>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Gravações</CardTitle>
                      <Button size="sm" variant="outline" onClick={() => loadRecordings()}>
                        Atualizar
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-56">
                        <div className="space-y-2">
                          {recordings.map((rec) => (
                            <div key={rec.id} className="text-xs border border-border rounded-lg p-2">
                              <div className="font-medium text-foreground truncate">{rec.filename}</div>
                              <div className="text-muted-foreground">
                                {formatDuration(rec.durationSeconds)} • {formatBytes(rec.sizeBytes)}
                              </div>
                              <div className="text-muted-foreground">
                                {new Date(rec.createdAt).toLocaleString()}
                              </div>
                              {rec.savedPath && (
                                <div className="text-muted-foreground font-mono truncate">{rec.savedPath}</div>
                              )}
                            </div>
                          ))}
                          {recordings.length === 0 && (
                            <div className="text-center py-6 text-muted-foreground">
                              Nenhum arquivo registrado
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              <SystemLogs logs={logs} />
            </div>

            <div className="flex-1 min-h-[520px]">
              <GoogleHomeWebView
                onLoad={() => {
                  setIsGoogleHomeLoaded(true)
                  addLog('INFO', 'Google Home carregado')
                }}
                onLoginStatusChange={(loggedIn) => {
                  setIsLoggedIn(loggedIn)
                  addLog(loggedIn ? 'INFO' : 'WARNING', loggedIn ? 'Login Google Home OK' : 'Sessao Google Home expirou')
                }}
                onVideoPlayerChange={(visible) => {
                  setVideoPlayerVisible(visible)
                  addLog('STATUS', visible ? 'Video ativo detectado' : 'Video nao visivel')
                }}
                onLog={addLog}
              />
              <ScreenRecorder
                isRecording={isRecording}
                settings={recordingSettings}
                onRecordingChange={setIsRecording}
                onLog={addLog}
                onRecordingSaved={handleRecordingSaved}
              />
            </div>
          </div>
        </TabsContent>

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
                          {streamingStatus?.pid ? (
                            <Badge variant="secondary">PID {streamingStatus.pid}</Badge>
                          ) : null}
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {streamingStatus?.lastError ? (
                        <div className="text-xs text-red-400">Erro: {streamingStatus.lastError}</div>
                      ) : null}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => refreshStreamingStatus().catch(() => {})} variant="outline">
                          Atualizar
                        </Button>
                        {!streamingStatus?.running ? (
                          <>
                            <Button size="sm" onClick={startStreamingGateway}>
                              Salvar e iniciar
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" onClick={stopStreamingGateway}>
                            Parar
                          </Button>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Dica: salve a config da unidade (câmeras + retenção) antes de iniciar.
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Câmeras (RTSP)</CardTitle>
                      <CardDescription className="text-xs">
                        Exemplo Tapo: <span className="font-mono">rtsp://user:pass@IP:554/stream1</span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <ScrollArea className="h-56">
                        <div className="space-y-2">
                          {(cameras || []).map((cam) => (
                            <div
                              key={cam.id || `${cam.host || cam.rtspUrl || 'cam'}-${Math.random()}`}
                              className={`rounded-lg border p-2 ${selectedCameraId === cam.id ? 'border-primary' : 'border-border'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">
                                    {cam.name || cam.id || 'Câmera'}{' '}
                                    {cam.id ? <span className="text-xs text-muted-foreground">({cam.id})</span> : null}
                                  </div>
                                  <div className="text-xs text-muted-foreground font-mono truncate">
                                    {maskRtspUrl(cam.rtspUrl || buildRtspUrlFromParts(cam))}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Switch
                                    checked={cam.enabled !== false}
                                    onCheckedChange={(checked) =>
                                      setCameras((prev) =>
                                        (prev || []).map((c) => (c.id === cam.id ? { ...c, enabled: checked } : c))
                                      )}
                                  />
                                  <Button size="sm" variant="outline" onClick={() => setSelectedCameraId(cam.id)}>
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
                          {!cameras?.length ? (
                            <div className="text-center py-6 text-muted-foreground text-sm">
                              Nenhuma câmera configurada ainda.
                            </div>
                          ) : null}
                        </div>
                      </ScrollArea>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-sm">ID</Label>
                          <Input
                            value={String(cameraEditor.id || '')}
                            onChange={(e) => setCameraEditor((p) => ({ ...p, id: e.target.value }))}
                            placeholder="(opcional) ex: tapo_92"
                            disabled={!!editingCameraId}
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Nome</Label>
                          <Input
                            value={String(cameraEditor.name || '')}
                            onChange={(e) => setCameraEditor((p) => ({ ...p, name: e.target.value }))}
                            placeholder="ex: Recepção"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Modo avançado (URL completa)</Label>
                        <Switch checked={cameraEditorAdvanced} onCheckedChange={setCameraEditorAdvanced} />
                      </div>

                      {cameraEditorAdvanced ? (
                        <div>
                          <Label className="text-sm">RTSP URL</Label>
                          <Input
                            value={String(cameraEditor.rtspUrl || '')}
                            onChange={(e) => setCameraEditor((p) => ({ ...p, rtspUrl: e.target.value }))}
                            placeholder="rtsp://user:pass@IP:554/stream1"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-sm">IP / Host</Label>
                              <Input
                                value={String(cameraEditor.host || '')}
                                onChange={(e) => setCameraEditor((p) => ({ ...p, host: e.target.value }))}
                                placeholder="192.168.15.92"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Porta</Label>
                              <Input
                                type="number"
                                min="1"
                                max="65535"
                                value={Number(cameraEditor.port || 554)}
                                onChange={(e) =>
                                  setCameraEditor((p) => ({
                                    ...p,
                                    port: Math.max(1, Math.min(65535, parseInt(e.target.value || '554', 10) || 554))
                                  }))}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-sm">Usuário</Label>
                              <Input
                                value={String(cameraEditor.username || '')}
                                onChange={(e) => setCameraEditor((p) => ({ ...p, username: e.target.value }))}
                                placeholder="skincos"
                              />
                            </div>
                            <div>
                              <Label className="text-sm">Senha</Label>
                              <Input
                                type="password"
                                value={String(cameraEditor.password || '')}
                                onChange={(e) => setCameraEditor((p) => ({ ...p, password: e.target.value }))}
                                placeholder="••••••••"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-sm">Stream</Label>
                            <Select
                              value={normalizeStreamPath(cameraEditor.streamPath || 'stream1')}
                              onValueChange={(value) => setCameraEditor((p) => ({ ...p, streamPath: value }))}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="stream1">stream1 (main)</SelectItem>
                                <SelectItem value="stream2">stream2 (sub)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            Preview: {maskRtspUrl(buildRtspUrlFromParts(cameraEditor))}
                          </div>
                        </>
                      )}

                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Enabled</Label>
                        <Switch
                          checked={cameraEditor.enabled !== false}
                          onCheckedChange={(checked) => setCameraEditor((p) => ({ ...p, enabled: checked }))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={upsertCamera}>
                          {editingCameraId ? 'Salvar edição' : 'Adicionar'}
                        </Button>
                        {editingCameraId ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
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
                            }}
                          >
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
	                          {selectedStream?.webrtcUrlProxy ? (
	                            <a className="text-xs underline" href={selectedStream.webrtcUrlProxy} target="_blank" rel="noreferrer">
	                              whep
	                            </a>
	                          ) : null}
	                          {selectedStream?.hlsUrlProxy ? (
	                            <a className="text-xs underline" href={selectedStream.hlsUrlProxy} target="_blank" rel="noreferrer">
	                              m3u8
	                            </a>
	                          ) : null}
	                        </div>
	                      </CardTitle>
	                    </CardHeader>
	                    <CardContent className="space-y-3">
	                      <div className="flex flex-col md:flex-row gap-2">
	                        <Select value={selectedCameraId || ''} onValueChange={(v) => setSelectedCameraId(v)}>
	                          <SelectTrigger className="flex-1">
	                            <SelectValue placeholder="Selecione uma câmera" />
	                          </SelectTrigger>
	                          <SelectContent>
	                            {(cameras || []).map((cam) => (
	                              <SelectItem key={cam.id} value={cam.id}>
	                                {cam.name || cam.id}
	                              </SelectItem>
	                            ))}
	                          </SelectContent>
	                        </Select>
		                        <Select value={liveMode} onValueChange={(v) => setLiveMode(v as 'auto' | 'webrtc' | 'hls')}>
	                          <SelectTrigger className="w-full md:w-[180px]">
	                            <SelectValue placeholder="Modo" />
	                          </SelectTrigger>
	                          <SelectContent>
	                            <SelectItem value="auto">Auto (WebRTC → HLS)</SelectItem>
	                            <SelectItem value="webrtc">WebRTC (tempo real)</SelectItem>
	                            <SelectItem value="hls">HLS (com delay)</SelectItem>
	                          </SelectContent>
	                        </Select>
	                        <Button size="sm" variant="outline" onClick={() => refreshStreamingStatus().catch(() => {})}>
	                          Atualizar
	                        </Button>
	                      </div>

		                      {liveMode === 'auto' ? (
		                        <div className="flex items-center justify-between gap-3">
		                          <div className="text-xs text-muted-foreground">
		                            {autoLiveFallback === 'webrtc'
		                              ? (selectedStream?.webrtcUrlProxy
		                                ? 'Auto: WebRTC (tempo real)'
		                                : 'Auto: WebRTC indisponível, usando HLS (com delay)')
		                              : 'Auto: fallback para HLS (com delay)'}
		                          </div>
		                          {(autoLiveFallback === 'hls' || !selectedStream?.webrtcUrlProxy) ? (
		                            <Button size="sm" variant="outline" onClick={() => setAutoLiveFallback('webrtc')}>
		                              Tentar WebRTC novamente
		                            </Button>
		                          ) : null}
		                        </div>
		                      ) : null}

	                      {!streamingStatus?.running ? (
	                        <div className="text-sm text-muted-foreground">
	                          Gateway parado. Clique em <span className="font-medium">Iniciar</span> para habilitar live (WebRTC/HLS).
	                        </div>
	                      ) : null}
	                      {streamingStatus?.running && !selectedStream ? (
	                        <div className="text-sm text-muted-foreground">
	                          Stream ainda não disponível para essa câmera. Verifique se a câmera está enabled e se a config foi salva no servidor.
	                        </div>
	                      ) : null}

	                      {((liveMode === 'auto' ? autoLiveFallback : liveMode) === 'webrtc' && !!selectedStream?.webrtcUrlProxy) ? (
	                        <WebRTCPlayer
	                          whepUrl={selectedStream?.webrtcUrlProxy || ''}
	                          isConnected={!!streamingStatus?.running && !!selectedStream?.webrtcUrlProxy}
	                          onError={(err) => {
	                            addLog('WARNING', `WebRTC: ${err}`)
	                            if (liveMode === 'auto' && autoLiveFallback !== 'hls') {
	                              toast.error('WebRTC falhou — usando HLS (com delay)')
	                              setAutoLiveFallback('hls')
	                              return
	                            }
	                            toast.error(`WebRTC: ${err}`)
	                          }}
	                        />
	                      ) : (
	                        <RTSPPlayer
	                          streamUrl={selectedStream?.hlsUrlProxy || ''}
	                          isConnected={!!streamingStatus?.running && !!selectedStream?.hlsUrlProxy}
	                          onError={(err) => addLog('ERROR', `Live(HLS): ${err}`)}
	                        />
	                      )}
	                    </CardContent>
	                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Gravação + Playback</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-sm">Segmento (seg)</Label>
                          <Input
                            type="number"
                            min="5"
                            max="3600"
                            value={rtspRecordingConfig.segmentSeconds}
                            onChange={(e) =>
                              setRtspRecordingConfig((p) => ({
                                ...p,
                                segmentSeconds: Math.max(5, Math.min(3600, parseInt(e.target.value || '60', 10) || 60))
                              }))}
                          />
                        </div>
                        <div>
                          <Label className="text-sm">Retenção (dias)</Label>
                          <Input
                            type="number"
                            min="0"
                            max="3650"
                            value={rtspRecordingConfig.retentionDays}
                            onChange={(e) =>
                              setRtspRecordingConfig((p) => ({
                                ...p,
                                retentionDays: Math.max(0, Math.min(3650, parseInt(e.target.value || '7', 10) || 7))
                              }))}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                          {selectedRecorder ? (
                            <>
                              Gravando • PID {selectedRecorder.pid} • desde{' '}
                              {selectedRecorder.startedAt ? new Date(selectedRecorder.startedAt).toLocaleString() : '-'}
                            </>
                          ) : (
                            'Parado'
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => refreshRtspRecorders().catch(() => {})}>
                            Status
                          </Button>
                          {!selectedRecorder ? (
                            <Button size="sm" onClick={startRtspRecording} disabled={!selectedCamera}>
                              Iniciar gravação
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={stopRtspRecording}>
                              Parar gravação
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">Arquivos ({rtspSegments.length})</div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => (effectiveUnit && selectedCameraId ? loadRtspSegments(effectiveUnit, selectedCameraId) : Promise.resolve())}
                          disabled={!effectiveUnit || !selectedCameraId}
                        >
                          Atualizar
                        </Button>
                      </div>

                      <ScrollArea className="h-44">
                        <div className="space-y-2">
                          {rtspSegments.map((seg) => (
                            <div
                              key={seg.filename}
                              className="rounded-lg border border-border p-2 hover:bg-muted/50 cursor-pointer"
                              onClick={() => setPlaybackUrl(seg.playbackUrl)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-xs font-mono truncate">{seg.filename}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {new Date(seg.createdAt).toLocaleString()} • {formatBytes(seg.sizeBytes)}
                                  </div>
                                </div>
                                <a
                                  className="text-xs underline"
                                  href={seg.downloadUrl}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  baixar
                                </a>
                              </div>
                            </div>
                          ))}
                          {rtspSegments.length === 0 ? (
                            <div className="text-center py-6 text-muted-foreground text-sm">
                              Nenhum arquivo ainda. Inicie a gravação e aguarde o primeiro segmento.
                            </div>
                          ) : null}
                        </div>
                      </ScrollArea>

                      {playbackUrl ? (
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Playback</div>
                          <video
                            controls
                            className="w-full rounded-lg bg-black"
                            src={playbackUrl}
                          />
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tests" className="mt-4 space-y-4">
          <Tabs defaultValue="suite">
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="suite">Suite</TabsTrigger>
              <TabsTrigger value="summary">Resumo</TabsTrigger>
              <TabsTrigger value="browser">Browser</TabsTrigger>
              <TabsTrigger value="screen">Screen</TabsTrigger>
              <TabsTrigger value="cross">Cross</TabsTrigger>
              <TabsTrigger value="google">Google Home</TabsTrigger>
              <TabsTrigger value="camera">Camera Test</TabsTrigger>
              <TabsTrigger value="recording">Recording Test</TabsTrigger>
              <TabsTrigger value="real">Real World</TabsTrigger>
              <TabsTrigger value="checklist">Checklist</TabsTrigger>
            </TabsList>

            <TabsContent value="suite" className="mt-4">
              <ComprehensiveTestRunner onLog={addLog} />
            </TabsContent>
            <TabsContent value="summary" className="mt-4">
              <TestSummary onLog={addLog} />
            </TabsContent>
            <TabsContent value="browser" className="mt-4">
              <BrowserCompatibilityTest onLog={addLog} />
            </TabsContent>
            <TabsContent value="screen" className="mt-4">
              <ScreenRecordingTest onLog={addLog} />
            </TabsContent>
            <TabsContent value="cross" className="mt-4">
              <CrossPlatformRecordingTest onLog={addLog} />
            </TabsContent>
            <TabsContent value="google" className="mt-4">
              <GoogleHomeTest onLog={addLog} />
            </TabsContent>
            <TabsContent value="camera" className="mt-4">
              <GoogleHomeCameraTest onLog={addLog} />
            </TabsContent>
            <TabsContent value="recording" className="mt-4">
              <GoogleHomeCameraRecordingTest onLog={addLog} />
            </TabsContent>
            <TabsContent value="real" className="mt-4">
              <RealWorldCameraTest onLog={addLog} />
            </TabsContent>
            <TabsContent value="checklist" className="mt-4">
              <TestingChecklist onLog={addLog} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="guides" className="mt-4 space-y-4">
          <Tabs defaultValue="testing-guide">
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="testing-guide">Testing Guide</TabsTrigger>
              <TabsTrigger value="camera-guide">Camera Guide</TabsTrigger>
              <TabsTrigger value="browser-guide">Browser Guide</TabsTrigger>
            </TabsList>
            <TabsContent value="testing-guide" className="mt-4">
              <TestingGuide />
            </TabsContent>
            <TabsContent value="camera-guide" className="mt-4">
              <CameraTestingGuide />
            </TabsContent>
            <TabsContent value="browser-guide" className="mt-4">
              <BrowserCompatibilityGuide />
            </TabsContent>
          </Tabs>
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
