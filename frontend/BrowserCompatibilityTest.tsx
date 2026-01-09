import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Progress } from '@/progress'
import { ScrollArea } from '@/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { 
  CheckCircle, 
  XCircle, 
  Warning, 
  Info,
  Monitor,
  Globe,
  Cpu,
  Database,
  VideoCamera,
  Microphone,
  Shield
} from '@phosphor-icons/react'

interface CompatibilityTest {
  id: string
  name: string
  description: string
  category: 'core' | 'media' | 'storage' | 'security' | 'advanced'
  required: boolean
  status: 'untested' | 'testing' | 'passed' | 'failed' | 'warning'
  details?: string
  errorMessage?: string
  browserSupport?: {
    chrome: boolean
    firefox: boolean
    safari: boolean
    edge: boolean
  }
}

interface BrowserInfo {
  name: string
  version: string
  engine: string
  platform: string
  mobile: boolean
  supported: 'full' | 'partial' | 'unsupported'
}

interface SystemCapabilities {
  webrtc: boolean
  mediaDevices: boolean
  getDisplayMedia: boolean
  webWorkers: boolean
  serviceWorkers: boolean
  webAssembly: boolean
  audioContext: boolean
  localStorage: boolean
  indexedDB: boolean
  webGL: boolean
  webGL2: boolean
  permissions: boolean
  notifications: boolean
  fullscreen: boolean
  clipboard: boolean
}

const COMPATIBILITY_TESTS: CompatibilityTest[] = [
  // Core Web APIs
  {
    id: 'fetch-api',
    name: 'Fetch API',
    description: 'Modern HTTP request API for network communication',
    category: 'core',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'promises',
    name: 'Promises',
    description: 'Native Promise support for asynchronous operations',
    category: 'core',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'es6-modules',
    name: 'ES6 Modules',
    description: 'Native ES6 import/export module system',
    category: 'core',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'websockets',
    name: 'WebSockets',
    description: 'Real-time bidirectional communication',
    category: 'core',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },

  // Media APIs
  {
    id: 'media-devices',
    name: 'MediaDevices API',
    description: 'Access to user media devices (camera, microphone)',
    category: 'media',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'get-display-media',
    name: 'Screen Capture API',
    description: 'Capture screen content for recording',
    category: 'media',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: false, edge: true }
  },
  {
    id: 'media-recorder',
    name: 'MediaRecorder API',
    description: 'Record audio and video streams',
    category: 'media',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'webrtc',
    name: 'WebRTC',
    description: 'Real-time communication and peer connections',
    category: 'media',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'web-audio',
    name: 'Web Audio API',
    description: 'Advanced audio processing and synthesis',
    category: 'media',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },

  // Storage APIs
  {
    id: 'local-storage',
    name: 'Local Storage',
    description: 'Client-side data persistence',
    category: 'storage',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'indexed-db',
    name: 'IndexedDB',
    description: 'Advanced client-side database',
    category: 'storage',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'cache-api',
    name: 'Cache API',
    description: 'Programmatic cache management',
    category: 'storage',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },

  // Security APIs
  {
    id: 'permissions-api',
    name: 'Permissions API',
    description: 'Query and request user permissions',
    category: 'security',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: false, edge: true }
  },
  {
    id: 'secure-contexts',
    name: 'Secure Contexts (HTTPS)',
    description: 'Secure context required for sensitive APIs',
    category: 'security',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'csp',
    name: 'Content Security Policy',
    description: 'Security policy enforcement',
    category: 'security',
    required: true,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },

  // Advanced Features
  {
    id: 'web-workers',
    name: 'Web Workers',
    description: 'Background JavaScript execution',
    category: 'advanced',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'service-workers',
    name: 'Service Workers',
    description: 'Background sync and offline functionality',
    category: 'advanced',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'web-assembly',
    name: 'WebAssembly',
    description: 'High-performance code execution',
    category: 'advanced',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'fullscreen-api',
    name: 'Fullscreen API',
    description: 'Enter and exit fullscreen mode',
    category: 'advanced',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  },
  {
    id: 'clipboard-api',
    name: 'Clipboard API',
    description: 'Read from and write to clipboard',
    category: 'advanced',
    required: false,
    status: 'untested',
    browserSupport: { chrome: true, firefox: true, safari: true, edge: true }
  }
]

export function BrowserCompatibilityTest({ onLog }: { onLog: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void }) {
  const [tests, setTests] = useState<CompatibilityTest[]>(COMPATIBILITY_TESTS)
  const [browserInfo, setBrowserInfo] = useState<BrowserInfo | null>(null)
  const [systemCaps, setSystemCaps] = useState<SystemCapabilities | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [activeTest, setActiveTest] = useState<string | null>(null)

  useEffect(() => {
    detectBrowserInfo()
    detectSystemCapabilities()
  }, [])

  const detectBrowserInfo = () => {
    const ua = navigator.userAgent
    const platform = navigator.platform
    const mobile = /Mobile|Android|iPhone|iPad/.test(ua)
    
    let name = 'Unknown'
    let version = 'Unknown'
    let engine = 'Unknown'
    let supported: 'full' | 'partial' | 'unsupported' = 'unsupported'

    // Detect browser
    if (ua.includes('Chrome') && !ua.includes('Edg')) {
      name = 'Chrome'
      const match = ua.match(/Chrome\/([0-9.]+)/)
      version = match ? match[1] : 'Unknown'
      engine = 'Blink'
      supported = 'full'
    } else if (ua.includes('Firefox')) {
      name = 'Firefox'
      const match = ua.match(/Firefox\/([0-9.]+)/)
      version = match ? match[1] : 'Unknown'
      engine = 'Gecko'
      supported = 'full'
    } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
      name = 'Safari'
      const match = ua.match(/Version\/([0-9.]+)/)
      version = match ? match[1] : 'Unknown'
      engine = 'WebKit'
      supported = 'partial'
    } else if (ua.includes('Edg')) {
      name = 'Edge'
      const match = ua.match(/Edg\/([0-9.]+)/)
      version = match ? match[1] : 'Unknown'
      engine = 'Blink'
      supported = 'full'
    }

    setBrowserInfo({
      name,
      version,
      engine,
      platform,
      mobile,
      supported
    })

    onLog('INFO', `Detected browser: ${name} ${version} on ${platform}`)
  }

  const detectSystemCapabilities = async () => {
    const caps: SystemCapabilities = {
      webrtc: !!window.RTCPeerConnection,
      mediaDevices: !!navigator.mediaDevices,
      getDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
      webWorkers: !!window.Worker,
      serviceWorkers: !!navigator.serviceWorker,
      webAssembly: !!window.WebAssembly,
      audioContext: !!(window.AudioContext || (window as any).webkitAudioContext),
      localStorage: !!window.localStorage,
      indexedDB: !!window.indexedDB,
      webGL: !!document.createElement('canvas').getContext('webgl'),
      webGL2: !!document.createElement('canvas').getContext('webgl2'),
      permissions: !!navigator.permissions,
      notifications: !!window.Notification,
      fullscreen: !!document.documentElement.requestFullscreen,
      clipboard: !!navigator.clipboard
    }

    setSystemCaps(caps)
    onLog('INFO', 'System capabilities detected')
  }

  const runSingleTest = async (test: CompatibilityTest): Promise<CompatibilityTest> => {
    setActiveTest(test.id)
    
    try {
      switch (test.id) {
        case 'fetch-api':
          if (typeof fetch === 'function') {
            return { ...test, status: 'passed', details: 'Fetch API is available' }
          }
          return { ...test, status: 'failed', details: 'Fetch API not supported' }

        case 'promises':
          if (typeof Promise === 'function') {
            return { ...test, status: 'passed', details: 'Native Promise support available' }
          }
          return { ...test, status: 'failed', details: 'Native Promise support missing' }

        case 'es6-modules':
          try {
            new Function('import("")')
            return { ...test, status: 'passed', details: 'ES6 modules supported' }
          } catch {
            return { ...test, status: 'failed', details: 'ES6 modules not supported' }
          }

        case 'websockets':
          if (typeof WebSocket === 'function') {
            return { ...test, status: 'passed', details: 'WebSocket API available' }
          }
          return { ...test, status: 'failed', details: 'WebSocket API not supported' }

        case 'media-devices':
          if (navigator.mediaDevices) {
            return { ...test, status: 'passed', details: 'MediaDevices API available' }
          }
          return { ...test, status: 'failed', details: 'MediaDevices API not supported' }

        case 'get-display-media':
          if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
            return { ...test, status: 'passed', details: 'Screen capture API available' }
          }
          return { ...test, status: 'failed', details: 'Screen capture API not supported' }

        case 'media-recorder':
          if (typeof MediaRecorder === 'function') {
            const supportedTypes = [
              'video/webm;codecs=vp9',
              'video/webm;codecs=vp8',
              'video/mp4;codecs=h264'
            ].filter(type => MediaRecorder.isTypeSupported(type))
            
            if (supportedTypes.length > 0) {
              return { 
                ...test, 
                status: 'passed', 
                details: `MediaRecorder supports: ${supportedTypes.join(', ')}` 
              }
            }
            return { 
              ...test, 
              status: 'warning', 
              details: 'MediaRecorder available but no supported codecs found' 
            }
          }
          return { ...test, status: 'failed', details: 'MediaRecorder API not supported' }

        case 'webrtc':
          if (typeof RTCPeerConnection === 'function') {
            return { ...test, status: 'passed', details: 'WebRTC API available' }
          }
          return { ...test, status: 'failed', details: 'WebRTC API not supported' }

        case 'web-audio':
          if (typeof AudioContext === 'function' || typeof (window as any).webkitAudioContext === 'function') {
            return { ...test, status: 'passed', details: 'Web Audio API available' }
          }
          return { ...test, status: 'failed', details: 'Web Audio API not supported' }

        case 'local-storage':
          try {
            const testKey = '__test_storage__'
            localStorage.setItem(testKey, 'test')
            localStorage.removeItem(testKey)
            return { ...test, status: 'passed', details: 'Local Storage working correctly' }
          } catch (error) {
            return { 
              ...test, 
              status: 'failed', 
              details: 'Local Storage not available or disabled',
              errorMessage: error instanceof Error ? error.message : 'Unknown error'
            }
          }

        case 'indexed-db':
          if (typeof indexedDB === 'object') {
            return { ...test, status: 'passed', details: 'IndexedDB API available' }
          }
          return { ...test, status: 'failed', details: 'IndexedDB API not supported' }

        case 'cache-api':
          if ('caches' in window) {
            return { ...test, status: 'passed', details: 'Cache API available' }
          }
          return { ...test, status: 'failed', details: 'Cache API not supported' }

        case 'permissions-api':
          if (navigator.permissions) {
            try {
              await navigator.permissions.query({ name: 'camera' as any })
              return { ...test, status: 'passed', details: 'Permissions API working' }
            } catch (error) {
              return { 
                ...test, 
                status: 'warning', 
                details: 'Permissions API available but query failed',
                errorMessage: error instanceof Error ? error.message : 'Unknown error'
              }
            }
          }
          return { ...test, status: 'failed', details: 'Permissions API not supported' }

        case 'secure-contexts':
          if (typeof window.isSecureContext !== 'undefined' && window.isSecureContext) {
            return { ...test, status: 'passed', details: 'Running in secure context (HTTPS)' }
          }
          return { 
            ...test, 
            status: 'warning', 
            details: 'Not running in secure context - some features may be limited' 
          }

        case 'csp':
          // Check if CSP is present by examining meta tags or headers
          const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
          if (cspMeta || document.querySelector('meta[name="Content-Security-Policy"]')) {
            return { ...test, status: 'passed', details: 'Content Security Policy detected' }
          }
          return { 
            ...test, 
            status: 'warning', 
            details: 'No Content Security Policy meta tag found' 
          }

        case 'web-workers':
          if (typeof Worker === 'function') {
            return { ...test, status: 'passed', details: 'Web Workers API available' }
          }
          return { ...test, status: 'failed', details: 'Web Workers API not supported' }

        case 'service-workers':
          if ('serviceWorker' in navigator) {
            return { ...test, status: 'passed', details: 'Service Workers API available' }
          }
          return { ...test, status: 'failed', details: 'Service Workers API not supported' }

        case 'web-assembly':
          if (typeof WebAssembly === 'object') {
            return { ...test, status: 'passed', details: 'WebAssembly support available' }
          }
          return { ...test, status: 'failed', details: 'WebAssembly not supported' }

        case 'fullscreen-api':
          if (typeof document.documentElement.requestFullscreen === 'function') {
            return { ...test, status: 'passed', details: 'Fullscreen API available' }
          }
          return { ...test, status: 'failed', details: 'Fullscreen API not supported' }

        case 'clipboard-api':
          if (navigator.clipboard) {
            return { ...test, status: 'passed', details: 'Clipboard API available' }
          }
          return { ...test, status: 'failed', details: 'Clipboard API not supported' }

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

  const runAllTests = async () => {
    setIsRunning(true)
    setProgress(0)
    onLog('INFO', 'Starting comprehensive browser compatibility tests')

    const updatedTests: CompatibilityTest[] = []
    
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i]
      setProgress((i / tests.length) * 100)
      
      const result = await runSingleTest(test)
      updatedTests.push(result)
      
      onLog(
        result.status === 'failed' ? 'ERROR' : result.status === 'warning' ? 'WARNING' : 'INFO',
        `${result.name}: ${result.status.toUpperCase()} - ${result.details}`
      )
      
      // Small delay between tests for better UX
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    setTests(updatedTests)
    setProgress(100)
    setActiveTest(null)
    setIsRunning(false)
    
    const failed = updatedTests.filter(t => t.status === 'failed')
    const warnings = updatedTests.filter(t => t.status === 'warning')
    const passed = updatedTests.filter(t => t.status === 'passed')
    
    onLog('INFO', `Tests completed: ${passed.length} passed, ${warnings.length} warnings, ${failed.length} failed`)
  }

  const getStatusIcon = (status: CompatibilityTest['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'warning':
        return <Warning className="w-4 h-4 text-yellow-500" />
      case 'testing':
        return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      default:
        return <Info className="w-4 h-4 text-muted-foreground" />
    }
  }

  const getStatusBadge = (status: CompatibilityTest['status']) => {
    switch (status) {
      case 'passed':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Passed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'warning':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Warning</Badge>
      case 'testing':
        return <Badge variant="secondary">Testing...</Badge>
      default:
        return <Badge variant="outline">Not Tested</Badge>
    }
  }

  const getCategoryIcon = (category: CompatibilityTest['category']) => {
    switch (category) {
      case 'core':
        return <Globe className="w-4 h-4" />
      case 'media':
        return <VideoCamera className="w-4 h-4" />
      case 'storage':
        return <Database className="w-4 h-4" />
      case 'security':
        return <Shield className="w-4 h-4" />
      case 'advanced':
        return <Cpu className="w-4 h-4" />
    }
  }

  const testsByCategory = tests.reduce((acc, test) => {
    if (!acc[test.category]) acc[test.category] = []
    acc[test.category].push(test)
    return acc
  }, {} as Record<string, CompatibilityTest[]>)

  const overallStatus = () => {
    const requiredTests = tests.filter(t => t.required)
    const failedRequired = requiredTests.filter(t => t.status === 'failed')
    const warningRequired = requiredTests.filter(t => t.status === 'warning')
    
    if (failedRequired.length > 0) return 'critical'
    if (warningRequired.length > 0) return 'warning'
    return 'good'
  }

  return (
    <div className="space-y-6">
      {/* Browser Information */}
      {browserInfo && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Browser Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium">Browser:</span>
                <p className="text-muted-foreground">{browserInfo.name} {browserInfo.version}</p>
              </div>
              <div>
                <span className="font-medium">Engine:</span>
                <p className="text-muted-foreground">{browserInfo.engine}</p>
              </div>
              <div>
                <span className="font-medium">Platform:</span>
                <p className="text-muted-foreground">{browserInfo.platform}</p>
              </div>
              <div>
                <span className="font-medium">Support Level:</span>
                <Badge 
                  className={
                    browserInfo.supported === 'full' ? 'bg-green-100 text-green-800 border-green-200' :
                    browserInfo.supported === 'partial' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                    'bg-red-100 text-red-800 border-red-200'
                  }
                >
                  {browserInfo.supported}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Compatibility Tests</CardTitle>
            <Button 
              onClick={runAllTests} 
              disabled={isRunning}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isRunning ? 'Testing...' : 'Run All Tests'}
            </Button>
          </div>
          {isRunning && (
            <div className="space-y-2">
              <Progress value={progress} className="w-full" />
              {activeTest && (
                <p className="text-sm text-muted-foreground">
                  Testing: {tests.find(t => t.id === activeTest)?.name}
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
              <div className="w-3 h-3 bg-muted rounded-full"></div>
              <span>{tests.filter(t => t.status === 'untested').length} Not Tested</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Results by Category */}
      <Tabs defaultValue="core" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          {Object.keys(testsByCategory).map(category => (
            <TabsTrigger key={category} value={category} className="flex items-center gap-2">
              {getCategoryIcon(category as any)}
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
                            <h3 className="font-medium flex items-center gap-2">
                              {test.name}
                              {test.required && (
                                <Badge variant="outline" className="text-xs">Required</Badge>
                              )}
                            </h3>
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
                      <div className="ml-4">
                        {getStatusBadge(test.status)}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>

      {/* System Capabilities Summary */}
      {systemCaps && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>System Capabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {Object.entries(systemCaps).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  {value ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                  <span className="capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}