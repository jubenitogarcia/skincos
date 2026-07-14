import React, { useEffect, useRef } from 'react'

interface RecordingSettings {
  quality: 'high' | 'medium' | 'low'
  format: 'webm' | 'mp4'
  autoRecord: boolean
  recordingPath: string
  maxDuration: number
}

interface ScreenRecorderProps {
  isRecording: boolean
  settings: RecordingSettings
  onRecordingChange: (recording: boolean) => void
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR' | 'STATUS', message: string) => void
  onRecordingSaved?: (metadata: {
    filename: string
    sizeBytes: number
    mimeType: string
    durationSeconds: number
    savedPath?: string
  }) => void
}

export function ScreenRecorder({ 
  isRecording, 
  settings, 
  onRecordingChange, 
  onLog,
  onRecordingSaved
}: ScreenRecorderProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartRef = useRef<number | null>(null)

  useEffect(() => {
    if (isRecording) {
      startRecording()
    } else {
      stopRecording()
    }

    return () => {
      stopRecording()
    }
  }, [isRecording])

  const getQualityConstraints = (quality: string) => {
    switch (quality) {
      case 'high':
        return { width: 1920, height: 1080, frameRate: 30 }
      case 'medium':
        return { width: 1280, height: 720, frameRate: 24 }
      case 'low':
        return { width: 854, height: 480, frameRate: 15 }
      default:
        return { width: 1280, height: 720, frameRate: 24 }
    }
  }

  const startRecording = async () => {
    try {
      onLog('INFO', 'Requesting screen capture permissions...')

      // Check if we're in Electron environment
      const isElectron = typeof window !== 'undefined' && window.electronAPI

      if (isElectron && (window.electronAPI as any).getDesktopSources) {
        onLog('INFO', 'Using Electron desktopCapturer API')
        // In Electron, use desktopCapturer for better performance
        try {
          const sources = await (window.electronAPI as any).getDesktopSources()
          onLog('INFO', `Found ${sources.length} screen sources`)
          
          // Use the first screen source (or let user select)
          const selectedSource = sources[0]
          
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedSource.id,
                ...getQualityConstraints(settings.quality)
              }
            } as any
          })

          streamRef.current = stream
          onLog('INFO', 'Electron screen capture stream obtained')
          
        } catch (electronError: any) {
          onLog('WARNING', `Electron capture failed, falling back to browser API: ${electronError.message}`)
          // Fall back to browser API
        }
      }

      // Browser environment or Electron fallback
      if (!streamRef.current && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        onLog('INFO', 'Using browser getDisplayMedia API')
        const constraints = getQualityConstraints(settings.quality)
        
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            ...constraints,
            displaySurface: 'window', // Prefer window capture over entire screen
            logicalSurface: true,
            cursor: 'never' // Don't show cursor in recording
          } as any,
          audio: false // We'll add audio separately if needed
        })

        streamRef.current = stream
        onLog('INFO', `Browser screen capture stream obtained: ${stream.getVideoTracks()[0].label}`)
      }

      if (!streamRef.current) {
        throw new Error('No screen capture method available')
      }

      chunksRef.current = []

      // Create MediaRecorder with detailed error handling
      const options: MediaRecorderOptions = {
        mimeType: settings.format === 'mp4' 
          ? 'video/mp4; codecs=h264' 
          : 'video/webm; codecs=vp9'
      }

      // Test supported formats and select best one
      const supportedFormats = [
        'video/webm; codecs=vp9',
        'video/webm; codecs=vp8', 
        'video/webm',
        'video/mp4; codecs=h264',
        'video/mp4'
      ]

      let selectedFormat = 'video/webm'
      for (const format of supportedFormats) {
        if (MediaRecorder.isTypeSupported(format)) {
          selectedFormat = format
          break
        }
      }

      if (settings.format === 'mp4' && selectedFormat.includes('mp4')) {
        options.mimeType = selectedFormat
      } else if (settings.format === 'webm' && selectedFormat.includes('webm')) {
        options.mimeType = selectedFormat
      } else {
        options.mimeType = selectedFormat
        onLog('WARNING', `Requested format ${settings.format} not supported, using ${selectedFormat}`)
      }

      onLog('INFO', `Recording with format: ${options.mimeType}`)

      const mediaRecorder = new MediaRecorder(streamRef.current, options)
      mediaRecorderRef.current = mediaRecorder
      recordingStartRef.current = Date.now()

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
          onLog('INFO', `Recording chunk: ${(event.data.size / 1024).toFixed(1)}KB`)
        }
      }

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { 
          type: options.mimeType || 'video/webm' 
        })

        onLog('INFO', `Recording stopped. Total size: ${(blob.size / 1024 / 1024).toFixed(2)}MB`)

        await saveRecording(blob)
        
        // Clean up
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => {
            track.stop()
            onLog('INFO', `Stopped track: ${track.label}`)
          })
          streamRef.current = null
        }
      }

      mediaRecorder.onerror = (event) => {
        const errorMsg = event.error?.message || 'Unknown recording error'
        onLog('ERROR', `Recording error: ${errorMsg}`)
        onRecordingChange(false)
      }

      mediaRecorder.onstart = () => {
        onLog('INFO', 'MediaRecorder started successfully')
      }

      mediaRecorder.onpause = () => {
        onLog('INFO', 'Recording paused')
      }

      mediaRecorder.onresume = () => {
        onLog('INFO', 'Recording resumed')
      }

      // Start recording with smaller chunk intervals for better monitoring
      mediaRecorder.start(500) // Record in 500ms chunks
      onLog('INFO', 'Screen recording started successfully')

      // Set up auto-stop timer if max duration is set
      if (settings.maxDuration > 0) {
        setTimeout(() => {
          if (mediaRecorderRef.current?.state === 'recording') {
            onLog('INFO', `Auto-stopping recording after ${settings.maxDuration} minutes`)
            onRecordingChange(false)
          }
        }, settings.maxDuration * 60 * 1000)
      }

      // Monitor stream health
      const videoTrack = streamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.onended = () => {
          onLog('WARNING', 'Video track ended - user may have stopped sharing')
          onRecordingChange(false)
        }
        
        // Log track settings
        const trackSettings = videoTrack.getSettings()
        onLog('INFO', `Recording settings: ${trackSettings.width}x${trackSettings.height} @ ${trackSettings.frameRate}fps`)
      }

    } catch (error: any) {
      onLog('ERROR', `Failed to start recording: ${error.message}`)
      
      // Clean up on error
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      
      onRecordingChange(false)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
      onLog('INFO', 'Stopping screen recording...')
    }
  }

  const saveRecording = async (blob: Blob) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const extension = settings.format === 'mp4' ? 'mp4' : 'webm'
      const filename = `recording-${timestamp}.${extension}`

      if (typeof window !== 'undefined' && window.electronAPI?.saveRecording) {
        // In Electron, use the native save dialog
        const buffer = await blob.arrayBuffer()
        const result = await window.electronAPI.saveRecording(buffer, filename, settings.recordingPath)

        if (result.success) {
          onLog('INFO', `Recording saved: ${result.path}`)
          onRecordingSaved?.({
            filename,
            sizeBytes: blob.size,
            mimeType: blob.type || (extension === 'mp4' ? 'video/mp4' : 'video/webm'),
            durationSeconds: recordingStartRef.current ? Math.max(1, Math.round((Date.now() - recordingStartRef.current) / 1000)) : 0,
            savedPath: result.path
          })
        } else {
          onLog('ERROR', `Failed to save recording: ${result.error}`)
        }
      } else {
        // In browser, trigger download
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        onLog('INFO', `Recording downloaded: ${filename}`)
        onRecordingSaved?.({
          filename,
          sizeBytes: blob.size,
          mimeType: blob.type || (extension === 'mp4' ? 'video/mp4' : 'video/webm'),
          durationSeconds: recordingStartRef.current ? Math.max(1, Math.round((Date.now() - recordingStartRef.current) / 1000)) : 0
        })
      }
      recordingStartRef.current = null
    } catch (error) {
      onLog('ERROR', `Failed to save recording: ${error.message}`)
      recordingStartRef.current = null
    }
  }

  // This component doesn't render anything visible - it's a background service
  return null
}
