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
import { CameraDiscovery } from '@/CameraDiscovery'
import { ComprehensiveTestRunner } from '@/ComprehensiveTestRunner'
import { CrossPlatformRecordingTest } from '@/CrossPlatformRecordingTest'
import { GoogleHomeCameraRecordingTest } from '@/GoogleHomeCameraRecordingTest'
import { GoogleHomeCameraTest } from '@/GoogleHomeCameraTest'
import { GoogleHomeTest } from '@/GoogleHomeTest'
import { GoogleHomeWebView } from '@/GoogleHomeWebView'
import { RealWorldCameraTest } from '@/RealWorldCameraTest'
import { RecordingManager } from '@/RecordingManager'
import { RTSPPlayer } from '@/RTSPPlayer'
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

const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  quality: 'high',
  format: 'webm',
  autoRecord: false,
  recordingPath: 'Downloads (Browser)',
  maxDuration: 30
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

export function UnitMonitor() {
  const [selectedUnit, setSelectedUnit] = useKV<string>('unit-monitor:selected-unit', 'unit-a')
  const [customUnit, setCustomUnit] = useKV<string>('unit-monitor:custom-unit', '')
  const unitKey = selectedUnit === 'custom' ? (customUnit.trim() || 'custom') : selectedUnit
  const [recordingSettings, setRecordingSettings] = useKV<RecordingSettings>(
    `unit-monitor:recording:${unitKey}`,
    DEFAULT_RECORDING_SETTINGS
  )
  const [favorites, setFavorites] = useKV<CameraFavorite[]>(`unit-monitor:favorites:${unitKey}`, [])

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [recordings, setRecordings] = useState<RecordingMeta[]>([])
  const [serverStatus, setServerStatus] = useState<'unknown' | 'connected' | 'offline'>('unknown')

  const [isGoogleHomeLoaded, setIsGoogleHomeLoaded] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [videoPlayerVisible, setVideoPlayerVisible] = useState(false)

  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)

  const [mainTab, setMainTab] = useState<'home' | 'rtsp' | 'tests' | 'guides' | 'logs'>('home')
  const [opsTab, setOpsTab] = useState<'favorites' | 'settings' | 'recordings'>('favorites')

  const [rtspStreamUrl, setRtspStreamUrl] = useState('')
  const [rtspConnected, setRtspConnected] = useState(false)

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
      const data = await apiJson<{ ok: boolean; config?: { recording?: RecordingSettings; favorites?: CameraFavorite[] } }>(
        `/api/unit-monitor/state?unit=${encodeURIComponent(effectiveUnit)}`
      )
      if (data?.config?.recording) {
        setRecordingSettings((prev) => ({ ...prev, ...data.config!.recording! }))
      }
      if (Array.isArray(data?.config?.favorites)) {
        setFavorites(data.config!.favorites!)
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
            favorites
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
    if (!effectiveUnit) return
    loadServerState().catch(() => {})
    loadRecordings().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveUnit])

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
                RTSP Monitoring
              </CardTitle>
              <CardDescription className="text-blue-200/70">
                Fluxo RTSP/HLS para cameras IP (simulado). Use para preparar pipeline de streaming.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-3">
                <Input
                  value={rtspStreamUrl}
                  onChange={(e) => setRtspStreamUrl(e.target.value)}
                  placeholder="rtsp://<ip>/stream"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={() => setRtspConnected((prev) => !prev)}
                >
                  {rtspConnected ? 'Desconectar' : 'Conectar'}
                </Button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <RTSPPlayer
                  streamUrl={rtspStreamUrl}
                  isConnected={rtspConnected}
                  onError={(err) => addLog('ERROR', `RTSP: ${err}`)}
                />
                <CameraDiscovery
                  onCameraSelect={(camera) => {
                    setRtspStreamUrl(`rtsp://${camera.ip}/live`)
                    addLog('INFO', `Camera RTSP selecionada: ${camera.name}`)
                  }}
                  onLog={addLog}
                />
              </div>

              <RecordingManager
                isConnected={rtspConnected}
                streamUrl={rtspStreamUrl}
                onRecordingStateChange={(rec) => addLog('STATUS', rec ? 'RTSP recording ON' : 'RTSP recording OFF')}
                onLog={(level, message) => addLog(level, message)}
              />
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
