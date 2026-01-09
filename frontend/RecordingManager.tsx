import React, { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Input } from '@/input'
import { Label } from '@/label'
import { Switch } from '@/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Progress } from '@/progress'
import { Separator } from '@/separator'
import { Badge } from '@/badge'
import { 
  Circle, 
  HardDrives, 
  Folder,
  Download,
  Trash,
  Calendar,
  Square
} from '@phosphor-icons/react'
import { toast } from 'sonner'

interface RecordingSettings {
  quality: string
  savePath: string
  autoStop: boolean
  maxDuration: number // minutes
  segmentDuration: number // minutes
}

interface RecordingFile {
  id: string
  filename: string
  duration: string
  size: string
  timestamp: string
  quality: string
}

interface RecordingManagerProps {
  isConnected: boolean
  streamUrl?: string
  onRecordingStateChange?: (isRecording: boolean) => void
  onLog?: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void
}

export function RecordingManager({ 
  isConnected, 
  streamUrl,
  onRecordingStateChange,
  onLog 
}: RecordingManagerProps) {
  const [isRecording, setIsRecording] = useKV<boolean>('is-recording', false)
  const [settings, setSettings] = useKV<RecordingSettings>('recording-settings', {
    quality: 'HD',
    savePath: '/Users/Camera/Recordings',
    autoStop: false,
    maxDuration: 60,
    segmentDuration: 10
  })
  const [recordings, setRecordings] = useKV<RecordingFile[]>('recordings-list', [])
  
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [storageUsed, setStorageUsed] = useState(65)
  const [availableSpace, setAvailableSpace] = useState('2.1 TB')

  // Recording timer
  useEffect(() => {
    let interval: NodeJS.Timeout
    
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingDuration(prev => prev + 1)
      }, 1000)
    } else {
      setRecordingDuration(0)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isRecording])

  // Auto-stop recording
  useEffect(() => {
    if (isRecording && settings?.autoStop && recordingDuration >= (settings.maxDuration * 60)) {
      stopRecording()
      onLog?.('INFO', `Auto-stopped recording after ${settings.maxDuration} minutes`)
      toast.info(`Recording auto-stopped after ${settings.maxDuration} minutes`)
    }
  }, [isRecording, recordingDuration, settings, onLog])

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const generateFilename = (): string => {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5)
    return `camera_recording_${timestamp}_${settings?.quality || 'HD'}.mp4`
  }

  const startRecording = async () => {
    if (!isConnected || !streamUrl) {
      toast.error('Cannot start recording - camera not connected')
      return
    }

    if (!settings?.savePath) {
      toast.error('Please set a save location for recordings')
      return
    }

    try {
      // In a real implementation, you would:
      // 1. Start FFmpeg process to capture RTSP stream
      // 2. Configure output format and quality
      // 3. Monitor recording process
      
      const filename = generateFilename()
      
      setIsRecording(true)
      onRecordingStateChange?.(true)
      
      onLog?.('INFO', `Recording started: ${filename}`)
      onLog?.('INFO', `Quality: ${settings.quality}, Location: ${settings.savePath}`)
      
      if (settings.autoStop) {
        onLog?.('INFO', `Auto-stop enabled: ${settings.maxDuration} minutes`)
      }
      
      toast.success('Recording started successfully')
      
      // Simulate recording process
      console.log('Recording started with settings:', {
        streamUrl,
        quality: settings.quality,
        savePath: settings.savePath,
        filename
      })
      
    } catch (error) {
      console.error('Recording start error:', error)
      onLog?.('ERROR', 'Failed to start recording')
      toast.error('Failed to start recording')
    }
  }

  const stopRecording = async () => {
    if (!isRecording) return

    try {
      const filename = generateFilename()
      const duration = formatDuration(recordingDuration)
      const size = `${(recordingDuration * 2.5 / 60).toFixed(1)} MB` // Approximate size calculation
      
      // Create recording entry
      const newRecording: RecordingFile = {
        id: Date.now().toString(),
        filename,
        duration,
        size,
        timestamp: new Date().toLocaleString(),
        quality: settings?.quality || 'HD'
      }
      
      setRecordings(prev => [newRecording, ...(prev || [])])
      setIsRecording(false)
      onRecordingStateChange?.(false)
      
      onLog?.('INFO', `Recording stopped: ${filename}`)
      onLog?.('INFO', `Duration: ${duration}, Size: ${size}`)
      
      toast.success(`Recording saved: ${filename}`)
      
      // Update storage usage simulation
      setStorageUsed(prev => Math.min(prev + 2, 95))
      
    } catch (error) {
      console.error('Recording stop error:', error)
      onLog?.('ERROR', 'Error stopping recording')
      toast.error('Error stopping recording')
    }
  }

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  const deleteRecording = (id: string) => {
    setRecordings(prev => (prev || []).filter(rec => rec.id !== id))
    toast.success('Recording deleted')
    onLog?.('INFO', 'Recording file deleted')
    setStorageUsed(prev => Math.max(prev - 2, 10))
  }

  const updateSettings = (key: keyof RecordingSettings, value: any) => {
    setSettings(prev => {
      const currentSettings = prev || {
        quality: 'HD',
        savePath: '/Users/Camera/Recordings',
        autoStop: false,
        maxDuration: 60,
        segmentDuration: 10
      }
      return { ...currentSettings, [key]: value }
    })
  }

  return (
    <div className="space-y-6">
      {/* Recording Control Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Circle className="w-5 h-5" />
            Recording Control
            {isRecording && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <Badge variant="destructive">REC {formatDuration(recordingDuration)}</Badge>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="quality">Recording Quality</Label>
              <Select 
                value={settings?.quality || 'HD'} 
                onValueChange={(value) => updateSettings('quality', value)}
                disabled={isRecording}
              >
                <SelectTrigger id="quality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4K">4K (3840x2160)</SelectItem>
                  <SelectItem value="HD">HD (1920x1080)</SelectItem>
                  <SelectItem value="720p">720p (1280x720)</SelectItem>
                  <SelectItem value="480p">480p (854x480)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="segment-duration">Segment Duration (min)</Label>
              <Input
                id="segment-duration"
                type="number"
                min="1"
                max="60"
                value={settings?.segmentDuration || 10}
                onChange={(e) => updateSettings('segmentDuration', parseInt(e.target.value))}
                disabled={isRecording}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="save-path">Save Location</Label>
            <div className="flex gap-2">
              <Input
                id="save-path"
                value={settings?.savePath || ''}
                onChange={(e) => updateSettings('savePath', e.target.value)}
                placeholder="/Users/Camera/Recordings"
                disabled={isRecording}
              />
              <Button variant="outline" size="sm" disabled={isRecording}>
                <Folder className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Switch
                id="auto-stop"
                checked={settings?.autoStop || false}
                onCheckedChange={(checked) => updateSettings('autoStop', checked)}
                disabled={isRecording}
              />
              <Label htmlFor="auto-stop">Auto-stop after</Label>
              <Input
                type="number"
                min="1"
                max="480"
                value={settings?.maxDuration || 60}
                onChange={(e) => updateSettings('maxDuration', parseInt(e.target.value))}
                className="w-16"
                disabled={!settings?.autoStop || isRecording}
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrives className="w-4 h-4" />
              <div>
                <p className="text-sm font-medium">Storage: {storageUsed}% used</p>
                <p className="text-xs text-muted-foreground">{availableSpace} available</p>
              </div>
            </div>
            <Button
              onClick={toggleRecording}
              disabled={!isConnected}
              variant={isRecording ? "destructive" : "default"}
              className="min-w-24"
            >
              {isRecording ? (
                <>
                  <Square className="w-4 h-4 mr-2" />
                  Stop
                </>
              ) : (
                <>
                  <Circle className="w-4 h-4 mr-2" />
                  Record
                </>
              )}
            </Button>
          </div>

          <Progress value={storageUsed} className="w-full" />
        </CardContent>
      </Card>

      {/* Recordings List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Recent Recordings ({recordings?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recordings && recordings.length > 0 ? (
            <div className="space-y-3">
              {recordings.slice(0, 10).map((recording) => (
                <div key={recording.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{recording.filename}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                      <span>{recording.timestamp}</span>
                      <span>{recording.duration}</span>
                      <span>{recording.size}</span>
                      <Badge variant="outline" className="text-xs">
                        {recording.quality}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Button variant="ghost" size="sm">
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => deleteRecording(recording.id)}
                    >
                      <Trash className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Circle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No recordings yet</p>
              <p className="text-sm">Start recording to see files here</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
