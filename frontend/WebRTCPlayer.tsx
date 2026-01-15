import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@/button'
import {
  ArrowsOut,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  Square,
  Warning
} from '@phosphor-icons/react'

interface WebRTCPlayerProps {
  whepUrl: string
  isConnected: boolean
  onPlayStateChange?: (isPlaying: boolean) => void
  onReady?: () => void
  onError?: (error: string) => void
}

function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const t = window.setTimeout(() => {
      cleanup()
      resolve()
    }, timeoutMs)
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        cleanup()
        resolve()
      }
    }
    const cleanup = () => {
      window.clearTimeout(t)
      pc.removeEventListener('icegatheringstatechange', onChange)
    }
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

export function WebRTCPlayer({ whepUrl, isConnected, onPlayStateChange, onReady, onError }: WebRTCPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const onErrorRef = useRef(onError)
  const onPlayStateChangeRef = useRef(onPlayStateChange)
  const onReadyRef = useRef(onReady)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [volume, setVolume] = useState(75)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    onPlayStateChangeRef.current = onPlayStateChange
  }, [onPlayStateChange])

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !isConnected || !whepUrl) return

    setError(null)

    // Cleanup any existing connection
    if (pcRef.current) {
      try {
        pcRef.current.ontrack = null
        pcRef.current.oniceconnectionstatechange = null
        pcRef.current.onconnectionstatechange = null
        pcRef.current.close()
      } catch { /* ignore */ }
      pcRef.current = null
    }

    let cancelled = false
    let failed = false
    let firstFrameTimeout: number | null = null
    let connectTimeout: number | null = null
    let onLoadedData: (() => void) | null = null
    let firstFrameSeen = false
    let videoFrameCbHandle: number | null = null
    const pc = new RTCPeerConnection()
    pcRef.current = pc

    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })

    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0]
      if (!stream || !videoRef.current) return
      videoRef.current.srcObject = stream
      void videoRef.current.play().catch(() => {})
    }

    const fail = (msg: string) => {
      if (cancelled || failed) return
      failed = true
      setError(msg)
      onErrorRef.current?.(msg)
    }

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState
      if (st === 'failed' || st === 'disconnected') {
        fail(`WebRTC ICE ${st}`)
      }
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'failed' || st === 'disconnected') {
        fail(`WebRTC connection ${st}`)
      }
    }

    ;(async () => {
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await waitForIceGatheringComplete(pc, 2500)

        const sdp = pc.localDescription?.sdp
        if (!sdp) throw new Error('No local SDP')

        const res = await fetch(whepUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sdp',
            Accept: 'application/sdp'
          },
          body: sdp
        })
        const answerSdp = await res.text()
        if (!res.ok) throw new Error(answerSdp || `${res.status} ${res.statusText}`)
        if (cancelled) return

        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

        if (videoRef.current) {
          videoRef.current.muted = true
          setIsMuted(true)
          void videoRef.current.play().catch(() => {})
        }

        // If we don't receive any frames soon, treat this as a failure (black screen) and allow fallback.
        const v = videoRef.current
        const markReady = () => {
          if (firstFrameSeen) return
          firstFrameSeen = true
          if (firstFrameTimeout) window.clearTimeout(firstFrameTimeout)
          firstFrameTimeout = null
          if (!cancelled && !failed) onReadyRef.current?.()
        }

        // Prefer requestVideoFrameCallback when available (more reliable than loadeddata for "black frame" cases).
        if (v && typeof (v as any).requestVideoFrameCallback === 'function') {
          const cb = (_now: number, meta: any) => {
            if (cancelled || failed) return
            try {
              const presented = Number(meta?.presentedFrames ?? 0) || 0
              if (presented > 0 && v.videoWidth > 0) markReady()
              videoFrameCbHandle = (v as any).requestVideoFrameCallback(cb)
            } catch {
              // ignore
            }
          }
          videoFrameCbHandle = (v as any).requestVideoFrameCallback(cb)
        } else {
          onLoadedData = () => {
            if (!cancelled && !failed && v && v.videoWidth > 0) markReady()
            if (v) v.removeEventListener('loadeddata', onLoadedData as any)
          }
          if (v) v.addEventListener('loadeddata', onLoadedData as any)
        }

        firstFrameTimeout = window.setTimeout(() => {
          if (cancelled) return
          if (!firstFrameSeen) fail('WebRTC: sem frames de vídeo')
        }, 8000)

        // If we don't get connected soon, trigger fallback upstream.
        connectTimeout = window.setTimeout(() => {
          if (cancelled) return
          const ok = pc.connectionState === 'connected' || pc.iceConnectionState === 'connected'
          if (!ok) fail('WebRTC timeout')
        }, 5000)
      } catch (e: any) {
        fail(e?.message || String(e))
      }
    })()

    return () => {
      cancelled = true
      if (firstFrameTimeout) window.clearTimeout(firstFrameTimeout)
      if (connectTimeout) window.clearTimeout(connectTimeout)
      if (videoRef.current && onLoadedData) {
        try { videoRef.current.removeEventListener('loadeddata', onLoadedData as any) } catch { /* ignore */ }
      }
      try {
        const v = videoRef.current as any
        if (v && typeof v.cancelVideoFrameCallback === 'function' && videoFrameCbHandle != null) {
          v.cancelVideoFrameCallback(videoFrameCbHandle)
        }
      } catch { /* ignore */ }
      if (pcRef.current) {
        try {
          pcRef.current.close()
        } catch { /* ignore */ }
        pcRef.current = null
      }
      if (videoRef.current) {
        try {
          const stream = videoRef.current.srcObject as MediaStream | null
          stream?.getTracks?.().forEach((t) => t.stop())
        } catch { /* ignore */ }
        videoRef.current.srcObject = null
      }
    }
  }, [whepUrl, isConnected, retryNonce])

  const togglePlay = async () => {
    const video = videoRef.current
    if (!video) return
    try {
      if (isPlaying) {
        video.pause()
        setIsPlaying(false)
        onPlayStateChangeRef.current?.(false)
      } else {
        await video.play()
        setIsPlaying(true)
        onPlayStateChangeRef.current?.(true)
      }
    } catch (err) {
      setError('Playback control error')
    }
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setIsMuted(video.muted)
  }

  const handleVolumeChange = (newVolume: number) => {
    const video = videoRef.current
    if (!video) return
    video.volume = newVolume / 100
    setVolume(newVolume)
    if (newVolume === 0) {
      setIsMuted(true)
      video.muted = true
    } else if (isMuted) {
      setIsMuted(false)
      video.muted = false
    }
  }

  const toggleFullscreen = () => {
    const video = videoRef.current
    if (!video) return
    if (!document.fullscreenElement) {
      video
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  const stopStream = () => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = 0
    setIsPlaying(false)
    onPlayStateChangeRef.current?.(false)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleVolumeUpdate = () => {
      setVolume(Math.round(video.volume * 100))
      setIsMuted(video.muted)
    }
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('volumechange', handleVolumeUpdate)
    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('volumechange', handleVolumeUpdate)
    }
  }, [])

  return (
    <div className="relative aspect-video bg-black rounded-lg overflow-hidden group">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        controls={false}
        playsInline
        muted={isMuted}
      />

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center text-white">
            <Warning className="w-12 h-12 mx-auto mb-4 text-orange-500" />
            <p className="text-lg font-medium mb-2">Erro WebRTC</p>
            <p className="text-sm text-gray-300">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setError(null)
                setRetryNonce((v) => v + 1)
              }}
            >
              Tentar novamente
            </Button>
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/20" onClick={togglePlay}>
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/20" onClick={stopStream}>
              <Square className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/20" onClick={toggleMute}>
              {isMuted ? <SpeakerSlash className="w-4 h-4" /> : <SpeakerHigh className="w-4 h-4" />}
            </Button>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="w-20 h-1 bg-white/30 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, white 0%, white ${volume}%, rgba(255,255,255,0.3) ${volume}%, rgba(255,255,255,0.3) 100%)`
                }}
              />
              <span className="text-xs font-mono w-8">{volume}%</span>
            </div>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/20" onClick={toggleFullscreen}>
              <ArrowsOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {isConnected && !error && (
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded px-3 py-1 text-white text-xs">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500' : 'bg-red-500'}`} />
            <span>WebRTC (tempo real)</span>
          </div>
        </div>
      )}
    </div>
  )
}
