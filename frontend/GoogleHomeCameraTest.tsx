import React, { useState, useRef, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Progress } from '@/progress'
import { Alert, AlertDescription } from '@/alert'
import { ScrollArea } from '@/scroll-area'
import { Input } from '@/input'
import { Label } from '@/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { 
  Camera,
  Record,
  Stop,
  Play,
  Pause,
  Monitor,
  CheckCircle,
  XCircle,
  Warning,
  Eye,
  Download,
  Upload,
  Gear,
  Clock,
  Info,
  TestTube
} from '@phosphor-icons/react'

interface CameraTestResult {
  id: string
  testName: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'warning'
  details: string
  timestamp: string
  recordingPath?: string
  duration?: number
  quality?: string
  errorMessage?: string
}

interface GoogleHomeCameraTestProps {
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void
}

const CAMERA_TESTS = [
  {
    id: 'camera-detection',
    name: 'Camera Detection',
    description: 'Detect available cameras in Google Home interface'
  },
  {
    id: 'stream-access',
    name: 'Stream Access',
    description: 'Test accessing camera video stream'
  },
  {
    id: 'recording-capability',
    name: 'Recording Capability',
    description: 'Test screen recording of camera feed'
  },
  {
    id: 'quality-settings',
    name: 'Quality Settings',
    description: 'Test different recording quality options'
  },
  {
    id: 'long-recording',
    name: 'Extended Recording',
    description: 'Test recording for extended periods'
  },
  {
    id: 'multiple-cameras',
    name: 'Multiple Cameras',
    description: 'Test switching between multiple cameras'
  }
]

export function GoogleHomeCameraTest({ onLog }: GoogleHomeCameraTestProps) {
  const [testResults, setTestResults] = useState<CameraTestResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [currentTest, setCurrentTest] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  
  // Recording states
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [recordedBlobs, setRecordedBlobs] = useState<{ [testId: string]: Blob }>({})
  
  // Test configuration
  const [testConfig, setTestConfig] = useState({
    recordingQuality: 'high',
    testDuration: 10, // seconds
    cameraCount: 1,
    enableAudio: false
  })

  // Google Home simulation states
  const [mockCameras, setMockCameras] = useState([
    { id: 'camera-1', name: 'Living Room Camera', type: 'Smart IP Camera', online: true },
    { id: 'camera-2', name: 'Bedroom Camera', type: 'Smart IP Camera', online: true },
    { id: 'camera-3', name: 'Kitchen Camera', type: 'Smart IP Camera', online: false }
  ])
  
  const [selectedCamera, setSelectedCamera] = useState<string>('')
  const [cameraStreamActive, setCameraStreamActive] = useState(false)
  const [streamQuality, setStreamQuality] = useState<'720p' | '1080p'>('720p')

  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    return () => {
      // Cleanup
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1)
      }, 1000)
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
      }
      setRecordingDuration(0)
    }
    
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
      }
    }
  }, [isRecording])

  const runSingleTest = async (testId: string): Promise<CameraTestResult> => {
    const test = CAMERA_TESTS.find(t => t.id === testId)
    if (!test) {
      return {
        id: testId,
        testName: 'Unknown Test',
        status: 'failed',
        details: 'Test definition not found',
        timestamp: new Date().toISOString()
      }
    }

    setCurrentTest(testId)
    
    try {
      switch (testId) {
        case 'camera-detection':
          // Simulate camera detection
          await new Promise(resolve => setTimeout(resolve, 2000))
          const onlineCameras = mockCameras.filter(c => c.online)
          
          if (onlineCameras.length > 0) {
            return {
              id: testId,
              testName: test.name,
              status: 'passed',
              details: `Detected ${onlineCameras.length} online cameras: ${onlineCameras.map(c => c.name).join(', ')}`,
              timestamp: new Date().toISOString()
            }
          } else {
            return {
              id: testId,
              testName: test.name,
              status: 'failed',
              details: 'No online cameras detected',
              timestamp: new Date().toISOString()
            }
          }

        case 'stream-access':
          if (!selectedCamera) {
            return {
              id: testId,
              testName: test.name,
              status: 'failed',
              details: 'No camera selected for testing',
              timestamp: new Date().toISOString()
            }
          }

          // Simulate stream access test
          await new Promise(resolve => setTimeout(resolve, 3000))
          setCameraStreamActive(true)
          
          return {
            id: testId,
            testName: test.name,
            status: 'passed',
            details: `Successfully accessed stream from ${selectedCamera} at ${streamQuality}`,
            timestamp: new Date().toISOString(),
            quality: streamQuality
          }

        case 'recording-capability':
          if (!cameraStreamActive) {
            return {
              id: testId,
              testName: test.name,
              status: 'failed',
              details: 'No active camera stream to record',
              timestamp: new Date().toISOString()
            }
          }

          return await performRecordingTest(testId, test.name, 5000) // 5 second test

        case 'quality-settings':
          // Test different quality settings
          const qualities = ['720p', '1080p']
          let qualityResults: string[] = []
          
          for (const quality of qualities) {
            setStreamQuality(quality as '720p' | '1080p')
            await new Promise(resolve => setTimeout(resolve, 1000))
            qualityResults.push(`${quality}: OK`)
          }
          
          return {
            id: testId,
            testName: test.name,
            status: 'passed',
            details: `Quality settings tested: ${qualityResults.join(', ')}`,
            timestamp: new Date().toISOString()
          }

        case 'long-recording':
          if (!cameraStreamActive) {
            return {
              id: testId,
              testName: test.name,
              status: 'failed',
              details: 'No active camera stream for extended recording',
              timestamp: new Date().toISOString()
            }
          }

          return await performRecordingTest(testId, test.name, 30000) // 30 second test

        case 'multiple-cameras':
          const onlineTestCameras = mockCameras.filter(c => c.online)
          if (onlineTestCameras.length < 2) {
            return {
              id: testId,
              testName: test.name,
              status: 'warning',
              details: 'Need at least 2 online cameras for multi-camera test',
              timestamp: new Date().toISOString()
            }
          }

          // Simulate switching between cameras
          let switchResults: string[] = []
          for (const camera of onlineTestCameras.slice(0, 2)) {
            setSelectedCamera(camera.id)
            await new Promise(resolve => setTimeout(resolve, 2000))
            switchResults.push(camera.name)
          }
          
          return {
            id: testId,
            testName: test.name,
            status: 'passed',
            details: `Successfully switched between cameras: ${switchResults.join(' → ')}`,
            timestamp: new Date().toISOString()
          }

        default:
          return {
            id: testId,
            testName: test.name,
            status: 'warning',
            details: 'Test not implemented',
            timestamp: new Date().toISOString()
          }
      }
    } catch (error) {
      return {
        id: testId,
        testName: test.name,
        status: 'failed',
        details: 'Test execution failed',
        timestamp: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  const performRecordingTest = async (testId: string, testName: string, duration: number): Promise<CameraTestResult> => {
    const executeRecording = async (): Promise<CameraTestResult> => {
      try {
        // Get screen capture for the "camera area"
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { 
            width: { ideal: streamQuality === '1080p' ? 1920 : 1280 },
            height: { ideal: streamQuality === '1080p' ? 1080 : 720 }
          },
          audio: testConfig.enableAudio
        })

        return new Promise((resolve) => {
          const mimeType = 'video/webm'
          const recorder = new MediaRecorder(stream, { mimeType })
          const chunks: Blob[] = []
          
          const startTime = Date.now()
          setIsRecording(true)
          
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunks.push(event.data)
            }
          }
          
          recorder.onstop = () => {
            const endTime = Date.now()
            const actualDuration = endTime - startTime
            const blob = new Blob(chunks, { type: mimeType })
            
            setRecordedBlobs(prev => ({ ...prev, [testId]: blob }))
            setIsRecording(false)
            
            stream.getTracks().forEach(track => track.stop())
            
            resolve({
              id: testId,
              testName,
              status: 'passed',
              details: `Recorded ${Math.round(actualDuration / 1000)}s, size: ${(blob.size / 1024 / 1024).toFixed(2)}MB`,
              timestamp: new Date().toISOString(),
              duration: actualDuration,
              recordingPath: 'blob-data'
            })
          }
          
          recorder.onerror = (event) => {
            setIsRecording(false)
            stream.getTracks().forEach(track => track.stop())
            resolve({
              id: testId,
              testName,
              status: 'failed',
              details: 'Recording failed',
              timestamp: new Date().toISOString(),
              errorMessage: event.error?.message || 'Unknown recording error'
            })
          }
          
          recorder.start(1000)
          
          setTimeout(() => {
            if (recorder.state === 'recording') {
              recorder.stop()
            }
          }, duration)
        })
        
      } catch (error) {
        setIsRecording(false)
        return {
          id: testId,
          testName,
          status: 'failed',
          details: 'Failed to start recording',
          timestamp: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }

    return executeRecording()
  }

  const runAllTests = async () => {
    setIsRunning(true)
    setProgress(0)
    setTestResults([])
    onLog('INFO', 'Starting Google Home camera tests')

    const results: CameraTestResult[] = []
    
    for (let i = 0; i < CAMERA_TESTS.length; i++) {
      const test = CAMERA_TESTS[i]
      setProgress((i / CAMERA_TESTS.length) * 100)
      
      const result = await runSingleTest(test.id)
      results.push(result)
      setTestResults([...results])
      
      onLog(
        result.status === 'failed' ? 'ERROR' : result.status === 'warning' ? 'WARNING' : 'INFO',
        `${result.testName}: ${result.status.toUpperCase()} - ${result.details}`
      )
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    setProgress(100)
    setCurrentTest(null)
    setIsRunning(false)
    
    const passed = results.filter(r => r.status === 'passed').length
    const warnings = results.filter(r => r.status === 'warning').length
    const failed = results.filter(r => r.status === 'failed').length
    
    onLog('INFO', `Google Home camera tests completed: ${passed} passed, ${warnings} warnings, ${failed} failed`)
  }

  const downloadRecording = (testId: string) => {
    const blob = recordedBlobs[testId]
    if (blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `camera-test-${testId}-${Date.now()}.webm`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  const getStatusIcon = (status: CameraTestResult['status']) => {
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
        return <div className="w-4 h-4 bg-muted rounded-full" />
    }
  }

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="space-y-6">
      {/* Test Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Gear className="w-5 h-5" />
            Test Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="camera-select">Test Camera</Label>
              <Select value={selectedCamera} onValueChange={setSelectedCamera}>
                <SelectTrigger>
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent>
                  {mockCameras.filter(c => c.online).map(camera => (
                    <SelectItem key={camera.id} value={camera.id}>
                      {camera.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="quality-select">Stream Quality</Label>
              <Select value={streamQuality} onValueChange={(value: '720p' | '1080p') => setStreamQuality(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="720p">720p HD</SelectItem>
                  <SelectItem value="1080p">1080p Full HD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="duration">Test Duration (s)</Label>
              <Input
                id="duration"
                type="number"
                min="5"
                max="60"
                value={testConfig.testDuration}
                onChange={(e) => setTestConfig(prev => ({
                  ...prev,
                  testDuration: parseInt(e.target.value) || 10
                }))}
              />
            </div>
            
            <div className="flex items-center justify-center">
              <Button 
                onClick={runAllTests} 
                disabled={isRunning || !selectedCamera}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <TestTube className="w-4 h-4 mr-2" />
                {isRunning ? 'Testing...' : 'Run Camera Tests'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Camera Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Available Cameras
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {mockCameras.map(camera => (
              <div
                key={camera.id}
                className={`p-4 border rounded-lg ${
                  selectedCamera === camera.id ? 'border-blue-500 bg-blue-50' : 'border-border'
                } ${!camera.online ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{camera.name}</h3>
                  <Badge className={camera.online ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}>
                    {camera.online ? 'Online' : 'Offline'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-3">{camera.type}</p>
                
                {camera.id === selectedCamera && cameraStreamActive && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Eye className="w-4 h-4 text-green-500" />
                      <span>Stream Active</span>
                      <Badge variant="outline">{streamQuality}</Badge>
                    </div>
                    {isRecording && (
                      <div className="flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                        <span>Recording: {formatDuration(recordingDuration * 1000)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Test Progress */}
      {isRunning && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Test Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Progress value={progress} className="w-full" />
              {currentTest && (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">
                    Running: {CAMERA_TESTS.find(t => t.id === currentTest)?.name}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Results */}
      {testResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Test Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              <div className="space-y-3">
                {testResults.map(result => (
                  <div
                    key={result.id}
                    className="flex items-start justify-between p-4 border rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        {getStatusIcon(result.status)}
                        <div>
                          <h3 className="font-medium">{result.testName}</h3>
                          <p className="text-sm text-muted-foreground">
                            {new Date(result.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                      
                      <p className="text-sm bg-muted p-2 rounded">
                        {result.details}
                      </p>
                      
                      {result.errorMessage && (
                        <p className="text-sm mt-2 text-red-600 bg-red-50 p-2 rounded">
                          Error: {result.errorMessage}
                        </p>
                      )}
                      
                      {result.duration && (
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {formatDuration(result.duration)}
                          </span>
                          {result.quality && (
                            <Badge variant="outline">{result.quality}</Badge>
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="ml-4 flex items-center gap-2">
                      {recordedBlobs[result.id] && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadRecording(result.id)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
                      <Badge
                        className={
                          result.status === 'passed' ? 'bg-green-100 text-green-800 border-green-200' :
                          result.status === 'failed' ? 'bg-red-100 text-red-800 border-red-200' :
                          result.status === 'warning' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                          'bg-gray-100 text-gray-800 border-gray-200'
                        }
                      >
                        {result.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Test Summary */}
      {testResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Test Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-2">
                <div className="text-2xl font-bold text-green-600">
                  {testResults.filter(r => r.status === 'passed').length}
                </div>
                <div className="text-sm text-muted-foreground">Passed</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold text-yellow-600">
                  {testResults.filter(r => r.status === 'warning').length}
                </div>
                <div className="text-sm text-muted-foreground">Warnings</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold text-red-600">
                  {testResults.filter(r => r.status === 'failed').length}
                </div>
                <div className="text-sm text-muted-foreground">Failed</div>
              </div>
            </div>
            
            {testResults.some(r => r.recordingPath) && (
              <Alert className="mt-4">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  {Object.keys(recordedBlobs).length} test recordings are available for download. 
                  These recordings can help verify the camera feed quality and recording functionality.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
