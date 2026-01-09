import React, { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Progress } from '@/progress'
import { ScrollArea } from '@/scroll-area'
import { Alert, AlertDescription } from '@/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { 
  VideoCamera,
  Record,
  Stop,
  CheckCircle,
  XCircle,
  Warning,
  Monitor,
  Globe,
  Download,
  Play,
  TestTube,
  Info,
  Gear
} from '@phosphor-icons/react'

interface RecordingTest {
  id: string
  name: string
  description: string
  category: 'basic' | 'codec' | 'permission' | 'quality' | 'compatibility'
  status: 'pending' | 'running' | 'passed' | 'failed' | 'warning'
  details?: string
  result?: any
  duration?: number
  fileSize?: number
  errorMessage?: string
}

interface PlatformInfo {
  os: string
  browser: string
  version: string
  mobile: boolean
  supportLevel: 'full' | 'partial' | 'limited' | 'unsupported'
  knownIssues: string[]
}

interface RecordingCapabilities {
  getDisplayMedia: boolean
  mediaRecorder: boolean
  supportedMimeTypes: string[]
  audioSupport: boolean
  videoCodecs: string[]
  constraints: {
    maxWidth: number
    maxHeight: number
    maxFrameRate: number
  }
}

const RECORDING_TESTS: RecordingTest[] = [
  {
    id: 'api-availability',
    name: 'Screen Capture API Available',
    description: 'Check if getDisplayMedia is supported',
    category: 'basic',
    status: 'pending'
  },
  {
    id: 'media-recorder-available',
    name: 'MediaRecorder API Available',
    description: 'Check if MediaRecorder is supported',
    category: 'basic',
    status: 'pending'
  },
  {
    id: 'permission-request',
    name: 'Screen Recording Permission',
    description: 'Test screen capture permission request',
    category: 'permission',
    status: 'pending'
  },
  {
    id: 'basic-recording',
    name: 'Basic Screen Recording',
    description: 'Record 5 seconds of screen content',
    category: 'basic',
    status: 'pending'
  },
  {
    id: 'webm-codec',
    name: 'WebM Recording (VP8/VP9)',
    description: 'Test WebM video format recording',
    category: 'codec',
    status: 'pending'
  },
  {
    id: 'mp4-codec',
    name: 'MP4 Recording (H.264)',
    description: 'Test MP4 video format recording',
    category: 'codec',
    status: 'pending'
  },
  {
    id: 'audio-recording',
    name: 'Screen + Audio Recording',
    description: 'Record screen with system audio',
    category: 'basic',
    status: 'pending'
  },
  {
    id: 'high-quality',
    name: 'High Quality Recording (1080p)',
    description: 'Test 1080p screen recording',
    category: 'quality',
    status: 'pending'
  },
  {
    id: 'frame-rate-test',
    name: 'High Frame Rate (60fps)',
    description: 'Test 60fps screen recording',
    category: 'quality',
    status: 'pending'
  },
  {
    id: 'long-recording',
    name: 'Extended Duration Recording',
    description: 'Test 30-second recording for stability',
    category: 'quality',
    status: 'pending'
  },
  {
    id: 'multiple-sessions',
    name: 'Multiple Recording Sessions',
    description: 'Test starting/stopping multiple times',
    category: 'compatibility',
    status: 'pending'
  },
  {
    id: 'concurrent-operations',
    name: 'Concurrent Operations',
    description: 'Test recording while using other media APIs',
    category: 'compatibility',
    status: 'pending'
  }
]

const KNOWN_BROWSER_ISSUES = {
  Safari: [
    'getDisplayMedia not supported on older versions',
    'Limited codec support (WebM not supported)',
    'Audio capture limitations',
    'Permission dialogs may be inconsistent'
  ],
  Firefox: [
    'Audio capture requires additional permissions',
    'VP9 codec may not be available on all systems',
    'Some frame rate limitations'
  ],
  Chrome: [
    'Corporate policies may block screen capture',
    'Some Linux distributions have audio issues'
  ],
  Edge: [
    'Based on Chromium - similar to Chrome behavior',
    'Legacy Edge (pre-Chromium) not supported'
  ]
}

export function CrossPlatformRecordingTest({ 
  onLog 
}: { 
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void 
}) {
  const [tests, setTests] = useState<RecordingTest[]>(RECORDING_TESTS)
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null)
  const [capabilities, setCapabilities] = useState<RecordingCapabilities | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [currentTest, setCurrentTest] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [testResults, setTestResults] = useState<{ [key: string]: any }>({})
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null)
  const [activeRecorder, setActiveRecorder] = useState<MediaRecorder | null>(null)
  const [recordedBlobs, setRecordedBlobs] = useState<{ [testId: string]: Blob }>({})

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    detectPlatformInfo()
    detectRecordingCapabilities()
    return () => {
      // Cleanup any active streams
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  const detectPlatformInfo = () => {
    const ua = navigator.userAgent
    const platform = navigator.platform
    
    let os = 'Unknown'
    let browser = 'Unknown'
    let version = 'Unknown'
    const mobile = /Mobile|Android|iPhone|iPad/.test(ua)

    // Detect OS
    if (platform.includes('Win')) os = 'Windows'
    else if (platform.includes('Mac')) os = 'macOS'
    else if (platform.includes('Linux')) os = 'Linux'
    else if (/Android/.test(ua)) os = 'Android'
    else if (/iPhone|iPad/.test(ua)) os = 'iOS'

    // Detect browser
    if (ua.includes('Chrome') && !ua.includes('Edg')) {
      browser = 'Chrome'
      const match = ua.match(/Chrome\/([0-9.]+)/)
      version = match ? match[1] : 'Unknown'
    } else if (ua.includes('Firefox')) {
      browser = 'Firefox'
      const match = ua.match(/Firefox\/([0-9.]+)/)
      version = match ? match[1] : 'Unknown'
    } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
      browser = 'Safari'
      const match = ua.match(/Version\/([0-9.]+)/)
      version = match ? match[1] : 'Unknown'
    } else if (ua.includes('Edg')) {
      browser = 'Edge'
      const match = ua.match(/Edg\/([0-9.]+)/)
      version = match ? match[1] : 'Unknown'
    }

    // Determine support level
    let supportLevel: PlatformInfo['supportLevel'] = 'unsupported'
    if (browser === 'Chrome' || browser === 'Edge') {
      supportLevel = 'full'
    } else if (browser === 'Firefox') {
      supportLevel = 'full'
    } else if (browser === 'Safari') {
      const versionNum = parseFloat(version)
      supportLevel = versionNum >= 13 ? 'partial' : 'unsupported'
    }

    const knownIssues = KNOWN_BROWSER_ISSUES[browser as keyof typeof KNOWN_BROWSER_ISSUES] || []

    setPlatformInfo({
      os,
      browser,
      version,
      mobile,
      supportLevel,
      knownIssues
    })

    onLog('INFO', `Platform detected: ${browser} ${version} on ${os}`)
  }

  const detectRecordingCapabilities = async () => {
    const caps: RecordingCapabilities = {
      getDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
      mediaRecorder: !!window.MediaRecorder,
      supportedMimeTypes: [],
      audioSupport: false,
      videoCodecs: [],
      constraints: {
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 60
      }
    }

    // Test supported MIME types
    if (window.MediaRecorder) {
      const testTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm;codecs=h264',
        'video/mp4;codecs=h264',
        'video/mp4;codecs=avc1',
        'video/webm',
        'video/mp4'
      ]

      caps.supportedMimeTypes = testTypes.filter(type => MediaRecorder.isTypeSupported(type))
      caps.videoCodecs = caps.supportedMimeTypes.map(type => {
        const match = type.match(/codecs=([^;,]+)/)
        return match ? match[1] : 'default'
      })
    }

    // Test audio support (requires user interaction)
    try {
      const audioTestTypes = [
        'audio/webm',
        'audio/mp4',
        'audio/ogg'
      ]
      caps.audioSupport = audioTestTypes.some(type => MediaRecorder.isTypeSupported(type))
    } catch (e) {
      caps.audioSupport = false
    }

    setCapabilities(caps)
    onLog('INFO', `Recording capabilities detected: ${caps.supportedMimeTypes.length} codecs available`)
  }

  const runSingleTest = async (test: RecordingTest): Promise<RecordingTest> => {
    setCurrentTest(test.id)
    
    try {
      switch (test.id) {
        case 'api-availability':
          if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
            return { ...test, status: 'passed', details: 'getDisplayMedia API is available' }
          }
          return { ...test, status: 'failed', details: 'getDisplayMedia API not supported' }

        case 'media-recorder-available':
          if (window.MediaRecorder) {
            const supportedTypes = capabilities?.supportedMimeTypes.length || 0
            return { 
              ...test, 
              status: 'passed', 
              details: `MediaRecorder available with ${supportedTypes} supported formats` 
            }
          }
          return { ...test, status: 'failed', details: 'MediaRecorder API not supported' }

        case 'permission-request':
          try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
              video: { width: 640, height: 480 }
            })
            stream.getTracks().forEach(track => track.stop())
            return { ...test, status: 'passed', details: 'Screen capture permission granted' }
          } catch (error) {
            return { 
              ...test, 
              status: 'failed', 
              details: 'Permission denied or API error',
              errorMessage: error instanceof Error ? error.message : 'Unknown error'
            }
          }

        case 'basic-recording':
          return await performRecordingTest(test, {
            video: { width: 1280, height: 720 }
          }, 'video/webm', 5000)

        case 'webm-codec':
          const webmType = capabilities?.supportedMimeTypes.find(t => t.includes('webm'))
          if (!webmType) {
            return { ...test, status: 'failed', details: 'WebM format not supported' }
          }
          return await performRecordingTest(test, {
            video: { width: 1280, height: 720 }
          }, webmType, 3000)

        case 'mp4-codec':
          const mp4Type = capabilities?.supportedMimeTypes.find(t => t.includes('mp4'))
          if (!mp4Type) {
            return { ...test, status: 'warning', details: 'MP4 format not supported (WebM fallback available)' }
          }
          return await performRecordingTest(test, {
            video: { width: 1280, height: 720 }
          }, mp4Type, 3000)

        case 'audio-recording':
          try {
            return await performRecordingTest(test, {
              video: { width: 1280, height: 720 },
              audio: true
            }, 'video/webm', 3000)
          } catch (error) {
            return { 
              ...test, 
              status: 'warning', 
              details: 'Audio recording failed, video-only available',
              errorMessage: error instanceof Error ? error.message : 'Unknown error'
            }
          }

        case 'high-quality':
          return await performRecordingTest(test, {
            video: { 
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }
          }, 'video/webm', 3000)

        case 'frame-rate-test':
          return await performRecordingTest(test, {
            video: { 
              width: 1280,
              height: 720,
              frameRate: { ideal: 60 }
            }
          }, 'video/webm', 3000)

        case 'long-recording':
          return await performRecordingTest(test, {
            video: { width: 1280, height: 720 }
          }, 'video/webm', 30000)

        case 'multiple-sessions':
          // Test starting and stopping multiple times
          let sessionsSuccessful = 0
          for (let i = 0; i < 3; i++) {
            try {
              const result = await performRecordingTest(test, {
                video: { width: 640, height: 480 }
              }, 'video/webm', 1000)
              if (result.status === 'passed') sessionsSuccessful++
            } catch (e) {
              // Continue with next session
            }
            await new Promise(resolve => setTimeout(resolve, 500))
          }
          
          if (sessionsSuccessful === 3) {
            return { ...test, status: 'passed', details: 'All 3 recording sessions successful' }
          } else if (sessionsSuccessful > 0) {
            return { 
              ...test, 
              status: 'warning', 
              details: `${sessionsSuccessful}/3 recording sessions successful` 
            }
          } else {
            return { ...test, status: 'failed', details: 'Multiple recording sessions failed' }
          }

        case 'concurrent-operations':
          // This is a simplified test - in practice would test with other media operations
          return { 
            ...test, 
            status: 'warning', 
            details: 'Concurrent operations test not fully implemented - requires more complex setup' 
          }

        default:
          return { ...test, status: 'warning', details: 'Test not implemented' }
      }
    } catch (error) {
      return {
        ...test,
        status: 'failed',
        details: 'Test execution failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  const performRecordingTest = async (
    test: RecordingTest,
    constraints: MediaStreamConstraints,
    mimeType: string,
    duration: number
  ): Promise<RecordingTest> => {
    const executeTest = async (): Promise<RecordingTest> => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia(constraints)
        
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          stream.getTracks().forEach(track => track.stop())
          return {
            ...test,
            status: 'failed',
            details: `MIME type ${mimeType} not supported`
          }
        }

        return new Promise((resolve) => {
          const recorder = new MediaRecorder(stream, { mimeType })
          const chunks: Blob[] = []
          
          const startTime = Date.now()
          
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunks.push(event.data)
            }
          }
          
          recorder.onstop = () => {
            const endTime = Date.now()
            const actualDuration = endTime - startTime
            const blob = new Blob(chunks, { type: mimeType })
            
            setRecordedBlobs(prev => ({ ...prev, [test.id]: blob }))
            
            stream.getTracks().forEach(track => track.stop())
            
            resolve({
              ...test,
              status: 'passed',
              details: `Recorded ${actualDuration}ms, file size: ${(blob.size / 1024).toFixed(1)}KB`,
              duration: actualDuration,
              fileSize: blob.size
            })
          }
          
          recorder.onerror = (event) => {
            stream.getTracks().forEach(track => track.stop())
            resolve({
              ...test,
              status: 'failed',
              details: 'Recording failed',
              errorMessage: event.error?.message || 'Unknown recording error'
            })
          }
          
          recorder.start(1000) // Collect data every second
          
          setTimeout(() => {
            if (recorder.state === 'recording') {
              recorder.stop()
            }
          }, duration)
        })
        
      } catch (error) {
        return {
          ...test,
          status: 'failed',
          details: 'Failed to capture screen',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }

    return executeTest()
  }

  const runAllTests = async () => {
    setIsRunning(true)
    setProgress(0)
    onLog('INFO', 'Starting comprehensive screen recording tests')

    const updatedTests: RecordingTest[] = []
    
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i]
      setProgress((i / tests.length) * 100)
      
      const result = await runSingleTest(test)
      updatedTests.push(result)
      
      setTests([...updatedTests, ...tests.slice(i + 1)])
      
      onLog(
        result.status === 'failed' ? 'ERROR' : result.status === 'warning' ? 'WARNING' : 'INFO',
        `${result.name}: ${result.status.toUpperCase()} - ${result.details}`
      )
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    setTests(updatedTests)
    setProgress(100)
    setCurrentTest(null)
    setIsRunning(false)
    
    const passed = updatedTests.filter(t => t.status === 'passed').length
    const warnings = updatedTests.filter(t => t.status === 'warning').length
    const failed = updatedTests.filter(t => t.status === 'failed').length
    
    onLog('INFO', `Screen recording tests completed: ${passed} passed, ${warnings} warnings, ${failed} failed`)
  }

  const downloadRecording = (testId: string) => {
    const blob = recordedBlobs[testId]
    if (blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `test-recording-${testId}.webm`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  const playRecording = (testId: string) => {
    const blob = recordedBlobs[testId]
    if (blob) {
      const url = URL.createObjectURL(blob)
      const video = document.createElement('video')
      video.src = url
      video.controls = true
      video.style.maxWidth = '100%'
      video.style.maxHeight = '300px'
      
      const dialog = document.createElement('div')
      dialog.style.position = 'fixed'
      dialog.style.top = '50%'
      dialog.style.left = '50%'
      dialog.style.transform = 'translate(-50%, -50%)'
      dialog.style.background = 'white'
      dialog.style.padding = '20px'
      dialog.style.borderRadius = '8px'
      dialog.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'
      dialog.style.zIndex = '1000'
      
      const closeBtn = document.createElement('button')
      closeBtn.textContent = 'Close'
      closeBtn.style.marginTop = '10px'
      closeBtn.onclick = () => {
        document.body.removeChild(dialog)
        document.body.removeChild(overlay)
        URL.revokeObjectURL(url)
      }
      
      const overlay = document.createElement('div')
      overlay.style.position = 'fixed'
      overlay.style.top = '0'
      overlay.style.left = '0'
      overlay.style.width = '100%'
      overlay.style.height = '100%'
      overlay.style.background = 'rgba(0,0,0,0.5)'
      overlay.style.zIndex = '999'
      overlay.onclick = closeBtn.onclick
      
      dialog.appendChild(video)
      dialog.appendChild(closeBtn)
      document.body.appendChild(overlay)
      document.body.appendChild(dialog)
    }
  }

  const getStatusIcon = (status: RecordingTest['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'warning':
        return <Warning className="w-4 h-4 text-yellow-500" />
      case 'running':
        return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      default:
        return <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
    }
  }

  const testsByCategory = tests.reduce((acc, test) => {
    if (!acc[test.category]) acc[test.category] = []
    acc[test.category].push(test)
    return acc
  }, {} as Record<string, RecordingTest[]>)

  return (
    <div className="space-y-6">
      {/* Platform Information */}
      {platformInfo && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Platform & Browser Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium">OS:</span>
                <p className="text-muted-foreground">{platformInfo.os}</p>
              </div>
              <div>
                <span className="font-medium">Browser:</span>
                <p className="text-muted-foreground">{platformInfo.browser} {platformInfo.version}</p>
              </div>
              <div>
                <span className="font-medium">Device:</span>
                <p className="text-muted-foreground">{platformInfo.mobile ? 'Mobile' : 'Desktop'}</p>
              </div>
              <div>
                <span className="font-medium">Support Level:</span>
                <Badge 
                  className={
                    platformInfo.supportLevel === 'full' ? 'bg-green-100 text-green-800 border-green-200' :
                    platformInfo.supportLevel === 'partial' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                    'bg-red-100 text-red-800 border-red-200'
                  }
                >
                  {platformInfo.supportLevel}
                </Badge>
              </div>
            </div>
            
            {platformInfo.knownIssues.length > 0 && (
              <Alert className="mt-4">
                <Warning className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-medium mb-1">Known Issues for {platformInfo.browser}:</div>
                  <ul className="text-sm space-y-1">
                    {platformInfo.knownIssues.map((issue, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="text-muted-foreground">•</span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recording Capabilities */}
      {capabilities && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Recording Capabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  {capabilities.getDisplayMedia ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                  <span>Screen Capture API</span>
                </div>
                <div className="flex items-center gap-2">
                  {capabilities.mediaRecorder ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                  <span>MediaRecorder API</span>
                </div>
                <div className="flex items-center gap-2">
                  {capabilities.audioSupport ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-yellow-500" />
                  )}
                  <span>Audio Recording</span>
                </div>
                <div>
                  <span className="font-medium">Supported Formats:</span>
                  <p className="text-muted-foreground">{capabilities.supportedMimeTypes.length} codecs</p>
                </div>
              </div>
              
              {capabilities.supportedMimeTypes.length > 0 && (
                <div>
                  <span className="font-medium text-sm">Available Codecs:</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {capabilities.supportedMimeTypes.map((type, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {type}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Screen Recording Tests</CardTitle>
            <Button 
              onClick={runAllTests} 
              disabled={isRunning}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <TestTube className="w-4 h-4 mr-2" />
              {isRunning ? 'Testing...' : 'Run All Tests'}
            </Button>
          </div>
          {isRunning && (
            <div className="space-y-2">
              <Progress value={progress} className="w-full" />
              {currentTest && (
                <p className="text-sm text-muted-foreground">
                  Running: {tests.find(t => t.id === currentTest)?.name}
                </p>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span>{tests.filter(t => t.status === 'passed').length} Passed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <span>{tests.filter(t => t.status === 'warning').length} Warnings</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
              <span>{tests.filter(t => t.status === 'failed').length} Failed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
              <span>{tests.filter(t => t.status === 'pending').length} Pending</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          {Object.keys(testsByCategory).map(category => (
            <TabsTrigger key={category} value={category}>
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>

        {Object.entries(testsByCategory).map(([category, categoryTests]) => (
          <TabsContent key={category} value={category}>
            <ScrollArea className="h-96">
              <div className="space-y-3">
                {categoryTests.map(test => (
                  <Card key={test.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(test.status)}
                          <div>
                            <h3 className="font-medium">{test.name}</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                              {test.description}
                            </p>
                            {test.details && (
                              <p className="text-sm mt-2 font-mono bg-muted p-2 rounded">
                                {test.details}
                              </p>
                            )}
                            {test.errorMessage && (
                              <p className="text-sm mt-2 text-red-600 font-mono bg-red-50 p-2 rounded">
                                Error: {test.errorMessage}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="ml-4 flex gap-2">
                        {recordedBlobs[test.id] && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => playRecording(test.id)}
                            >
                              <Play className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => downloadRecording(test.id)}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        <Badge
                          className={
                            test.status === 'passed' ? 'bg-green-100 text-green-800 border-green-200' :
                            test.status === 'failed' ? 'bg-red-100 text-red-800 border-red-200' :
                            test.status === 'warning' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                            test.status === 'running' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                            'bg-gray-100 text-gray-800 border-gray-200'
                          }
                        >
                          {test.status}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}