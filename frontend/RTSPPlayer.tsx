import React, { useRef, useEffect, useState } from 'react'
import Hls from 'hls.js'
import { Button } from '@/button'
import { 
  Play, 
  Pause, 
  Square, 
  SpeakerHigh, 
  SpeakerSlash,
  ArrowsOut,
  Warning 
} from '@phosphor-icons/react'

interface RTSPPlayerProps {
  streamUrl: string
  isConnected: boolean
  onPlayStateChange?: (isPlaying: boolean) => void
  onError?: (error: string) => void
}

export function RTSPPlayer({ 
  streamUrl, 
  isConnected, 
  onPlayStateChange,
  onError 
}: RTSPPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(75)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !isConnected || !streamUrl) return

    // Clean up existing HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    // For RTSP streams, we need to convert them to HLS
    // In production, you would use FFmpeg or similar to convert RTSP to HLS
    // For this demo, we'll simulate the HLS stream URL conversion
    const hlsUrl = convertRTSPToHLS(streamUrl)

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90
      })

      hlsRef.current = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed, ready to play')
        setError(null)
      })

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data)
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setError('Network error - check stream URL and connection')
              onError?.('Network error accessing stream')
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              setError('Media error - stream format may be unsupported')
              onError?.('Media decoding error')
              break
            default:
              setError('Fatal streaming error occurred')
              onError?.('Fatal streaming error')
              break
          }
        }
      })

      hls.on(Hls.Events.FRAG_LOADED, () => {
        // Fragment loaded successfully
        if (error) setError(null)
      })

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS support
      video.src = hlsUrl
      video.addEventListener('loadedmetadata', () => {
        console.log('Native HLS loaded')
        setError(null)
      })
      video.addEventListener('error', (e) => {
        setError('Video playback error')
        onError?.('Video playback error')
      })
    } else {
      setError('HLS not supported in this browser')
      onError?.('HLS not supported in this browser')
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [streamUrl, isConnected, error, onError])

  // Convert RTSP URL to HLS (this is a simulation)
  // In real implementation, you'd have a media server doing this conversion
  const convertRTSPToHLS = (rtspUrl: string): string => {
    // For demo purposes, we'll use a test HLS stream
    // In production, this would be your media server endpoint
    // Example: http://your-media-server:8080/hls/camera1/index.m3u8
    
    // Test HLS streams for development
    const testStreams = [
      'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8'
    ]
    
    // Return a test stream for now
    return testStreams[0]
  }

  const togglePlay = async () => {
    const video = videoRef.current
    if (!video) return

    try {
      if (isPlaying) {
        video.pause()
        setIsPlaying(false)
        onPlayStateChange?.(false)
      } else {
        await video.play()
        setIsPlaying(true)
        onPlayStateChange?.(true)
      }
    } catch (err) {
      console.error('Play/pause error:', err)
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
      video.requestFullscreen().then(() => {
        setIsFullscreen(true)
      }).catch(err => {
        console.error('Fullscreen error:', err)
      })
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
      })
    }
  }

  const stopStream = () => {
    const video = videoRef.current
    if (!video) return

    video.pause()
    video.currentTime = 0
    setIsPlaying(false)
    onPlayStateChange?.(false)
  }

  // Handle video events
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

  if (!isConnected) {
    return (
      <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted-foreground/20 flex items-center justify-center">
              <Play className="w-8 h-8" />
            </div>
            <p className="text-lg font-medium">No Stream</p>
            <p className="text-sm">Connect to camera to view stream</p>
          </div>
        </div>
      </div>
    )
  }

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
            <p className="text-lg font-medium mb-2">Stream Error</p>
            <p className="text-sm text-gray-300">{error}</p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-4"
              onClick={() => window.location.reload()}
            >
              Retry Connection
            </Button>
          </div>
        </div>
      )}

      {/* Video Controls Overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/20"
              onClick={togglePlay}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/20"
              onClick={stopStream}
            >
              <Square className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/20"
              onClick={toggleMute}
            >
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
            
            <Button
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/20"
              onClick={toggleFullscreen}
            >
              <ArrowsOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Stream Info Overlay */}
      {isConnected && !error && (
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded px-3 py-1 text-white text-xs">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500' : 'bg-red-500'}`} />
            <span>RTSP Stream {isPlaying ? 'Active' : 'Paused'}</span>
          </div>
        </div>
      )}
    </div>
  )
}