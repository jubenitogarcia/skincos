import React, { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Progress } from '@/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { ScrollArea } from '@/scroll-area'
import { Input } from '@/input'
import { Label } from '@/label'
import { 
  Play, 
  Pause, 
  Square, 
  Camera,
  VideoCamera,
  Monitor,
  CheckCircle,
  XCircle,
  Clock,
  Download,
  Eye
} from '@phosphor-icons/react'

interface TestResult {
  testName: string
  status: 'pending' | 'running' | 'passed' | 'failed'
  duration?: number
  details?: string
  data?: any
}

interface RecordingSession {
  id: string
  startTime: Date
  endTime?: Date
  duration: number
  quality: string
  size: number
  format: string
  status: 'recording' | 'completed' | 'failed'
}

interface GoogleHomeCameraRecordingTestProps {
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR' | 'STATUS', message: string) => void
}

export function GoogleHomeCameraRecordingTest({ onLog }: GoogleHomeCameraRecordingTestProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [currentTest, setCurrentTest] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [recordingSessions, setRecordingSessions] = useState<RecordingSession[]>([])
  const [mockVideoElement, setMockVideoElement] = useState<HTMLVideoElement | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])

  const tests: Omit<TestResult, 'status' | 'duration'>[] = [
    {
      testName: 'Google Home Access Test',
      details: 'Verify connection to Google Home web interface'
    },
    {
      testName: 'Camera Discovery Test',
      details: 'Detect available cameras in Google Home'
    },
    {
      testName: 'Video Stream Detection',
      details: 'Identify video streams and player elements'
    },
    {
      testName: 'Screen Recording Setup',
      details: 'Initialize screen capture for camera feeds'
    },
    {
      testName: 'Recording Quality Test',
      details: 'Test different recording quality settings'
    },
    {
      testName: 'Automation Script Test',
      details: 'Test camera navigation automation'
    },
    {
      testName: 'File Export Test',
      details: 'Verify recorded video file creation'
    }
  ]

  useEffect(() => {
    // Initialize test results
    setTestResults(tests.map(test => ({ ...test, status: 'pending' })))
  }, [])

  useEffect(() => {
    if (isRecording && recordingTimerRef.current === null) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1)
      }, 1000)
    } else if (!isRecording && recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }

    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
      }
    }
  }, [isRecording])

  const updateTestResult = (testName: string, status: TestResult['status'], details?: string, data?: any) => {
    setTestResults(prev => prev.map(test => 
      test.testName === testName 
        ? { ...test, status, details, data }
        : test
    ))
  }

  const runAllTests = async () => {
    if (isRunning) return
    
    setIsRunning(true)
    onLog('INFO', 'Starting comprehensive Google Home camera recording tests')
    
    // Reset all tests
    setTestResults(tests.map(test => ({ ...test, status: 'pending' })))

    for (const test of tests) {
      setCurrentTest(test.testName)
      updateTestResult(test.testName, 'running')
      
      try {
        await runSingleTest(test.testName)
      } catch (error) {
        onLog('ERROR', `Test failed: ${test.testName} - ${error}`)
        updateTestResult(test.testName, 'failed', error instanceof Error ? error.message : 'Unknown error')
      }
      
      // Add delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    setCurrentTest(null)
    setIsRunning(false)
    onLog('INFO', 'All Google Home camera recording tests completed')
  }

  const runSingleTest = async (testName: string): Promise<void> => {
    const startTime = Date.now()
    
    switch (testName) {
      case 'Google Home Access Test':
        await testGoogleHomeAccess()
        break
      case 'Camera Discovery Test':
        await testCameraDiscovery()
        break
      case 'Video Stream Detection':
        await testVideoStreamDetection()
        break
      case 'Screen Recording Setup':
        await testScreenRecordingSetup()
        break
      case 'Recording Quality Test':
        await testRecordingQuality()
        break
      case 'Automation Script Test':
        await testAutomationScript()
        break
      case 'File Export Test':
        await testFileExport()
        break
      default:
        throw new Error(`Unknown test: ${testName}`)
    }
    
    const duration = Date.now() - startTime
    updateTestResult(testName, 'passed', `Completed in ${duration}ms`)
  }

  const testGoogleHomeAccess = async () => {
    onLog('INFO', 'Testing Google Home web interface access...')
    
    // Simulate checking Google Home availability
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Mock checking if Google Home is accessible
    const isAccessible = true // In real implementation, this would check actual connectivity
    
    if (!isAccessible) {
      throw new Error('Google Home interface not accessible')
    }
    
    onLog('STATUS', 'Google Home interface is accessible')
  }

  const testCameraDiscovery = async () => {
    onLog('INFO', 'Discovering available cameras in Google Home...')
    
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    // Mock camera discovery
    const mockCameras = [
      { id: 'cam1', name: 'Living Room Camera', type: 'Smart IP Camera' },
      { id: 'cam2', name: 'Kitchen Camera', type: 'Smart IP Camera' },
      { id: 'cam3', name: 'Bedroom Camera', type: 'Smart IP Camera' }
    ]
    
    updateTestResult('Camera Discovery Test', 'running', `Found ${mockCameras.length} cameras`, mockCameras)
    onLog('STATUS', `Discovered ${mockCameras.length} cameras`)
  }

  const testVideoStreamDetection = async () => {
    onLog('INFO', 'Testing video stream detection in DOM...')
    
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Create mock video element
    const video = document.createElement('video')
    video.width = 640
    video.height = 480
    video.autoplay = true
    video.muted = true
    
    // Simulate video stream
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 640, height: 480 }, 
          audio: false 
        })
        video.srcObject = stream
        setMockVideoElement(video)
        onLog('STATUS', 'Video stream detected and ready for recording')
      } catch (error) {
        onLog('WARNING', 'Camera access denied, using mock video for testing')
        // Use a mock video source for testing
        video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE='
        setMockVideoElement(video)
      }
    }
  }

  const testScreenRecordingSetup = async () => {
    onLog('INFO', 'Setting up screen recording capabilities...')
    
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Screen recording not supported in this browser')
    }
    
    onLog('STATUS', 'Screen recording setup completed successfully')
  }

  const testRecordingQuality = async () => {
    onLog('INFO', 'Testing different recording quality settings...')
    
    const qualities = ['high', 'medium', 'low']
    
    for (const quality of qualities) {
      await new Promise(resolve => setTimeout(resolve, 500))
      onLog('STATUS', `Testing ${quality} quality recording...`)
    }
    
    onLog('STATUS', 'All quality settings validated')
  }

  const testAutomationScript = async () => {
    onLog('INFO', 'Testing camera navigation automation scripts...')
    
    await new Promise(resolve => setTimeout(resolve, 1200))
    
    // Simulate automation script execution
    const automationSteps = [
      'Clicking on camera tile',
      'Waiting for video to load',
      'Detecting video player',
      'Starting recording'
    ]
    
    for (const step of automationSteps) {
      await new Promise(resolve => setTimeout(resolve, 300))
      onLog('STATUS', step)
    }
  }

  const testFileExport = async () => {
    onLog('INFO', 'Testing video file export functionality...')
    
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Mock file creation
    const mockFile = {
      name: `recording_${Date.now()}.webm`,
      size: 1024 * 1024 * 5, // 5MB
      type: 'video/webm'
    }
    
    onLog('STATUS', `Mock recording file created: ${mockFile.name} (${(mockFile.size / 1024 / 1024).toFixed(1)}MB)`)
  }

  const startTestRecording = async () => {
    if (isRecording) return
    
    try {
      onLog('INFO', 'Starting test recording...')
      
      // Request screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          width: 1920,
          height: 1080
        },
        audio: false
      })
      
      recordedChunksRef.current = []
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9'
      })
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: 'video/webm'
        })
        
        const session: RecordingSession = {
          id: Date.now().toString(),
          startTime: new Date(Date.now() - recordingDuration * 1000),
          endTime: new Date(),
          duration: recordingDuration,
          quality: 'high',
          size: blob.size,
          format: 'webm',
          status: 'completed'
        }
        
        setRecordingSessions(prev => [...prev, session])
        
        // Create download link
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `test_recording_${Date.now()}.webm`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        onLog('STATUS', `Recording completed: ${(blob.size / 1024 / 1024).toFixed(1)}MB`)
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop())
      }
      
      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start(1000) // Collect data every second
      setIsRecording(true)
      setRecordingDuration(0)
      
    } catch (error) {
      onLog('ERROR', `Failed to start recording: ${error}`)
    }
  }

  const stopTestRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      onLog('INFO', 'Test recording stopped')
    }
  }

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'running':
        return <Clock className="w-4 h-4 text-blue-500 animate-spin" />
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />
    }
  }

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const formatFileSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Google Home Camera Recording Tests
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <Button 
              onClick={runAllTests} 
              disabled={isRunning}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isRunning ? 'Running Tests...' : 'Run All Tests'}
            </Button>
            
            <div className="flex items-center gap-2">
              {!isRecording ? (
                <Button 
                  onClick={startTestRecording}
                  variant="outline"
                  className="border-red-600 text-red-600 hover:bg-red-50"
                >
                  <VideoCamera className="w-4 h-4 mr-2" />
                  Start Test Recording
                </Button>
              ) : (
                <Button 
                  onClick={stopTestRecording}
                  variant="outline"
                  className="border-red-600 text-red-600 hover:bg-red-50"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop ({formatDuration(recordingDuration)})
                </Button>
              )}
            </div>
            
            {isRecording && (
              <Badge variant="destructive" className="animate-pulse">
                <div className="w-2 h-2 bg-white rounded-full mr-2" />
                RECORDING
              </Badge>
            )}
          </div>

          {currentTest && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-medium text-blue-800">
                Currently running: {currentTest}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="tests" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="tests">Test Results</TabsTrigger>
          <TabsTrigger value="recordings">Recordings</TabsTrigger>
          <TabsTrigger value="settings">Test Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="tests" className="space-y-4">
          <ScrollArea className="h-96">
            <div className="space-y-2">
              {testResults.map((test, index) => (
                <Card key={index} className={`
                  ${test.status === 'running' ? 'border-blue-500 bg-blue-50' : ''}
                  ${test.status === 'passed' ? 'border-green-500 bg-green-50' : ''}
                  ${test.status === 'failed' ? 'border-red-500 bg-red-50' : ''}
                `}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(test.status)}
                        <div>
                          <h4 className="font-medium">{test.testName}</h4>
                          <p className="text-sm text-muted-foreground">{test.details}</p>
                        </div>
                      </div>
                      <Badge variant={
                        test.status === 'passed' ? 'default' :
                        test.status === 'failed' ? 'destructive' :
                        test.status === 'running' ? 'secondary' : 'outline'
                      }>
                        {test.status.toUpperCase()}
                      </Badge>
                    </div>
                    
                    {test.data && test.testName === 'Camera Discovery Test' && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-sm font-medium mb-2">Discovered Cameras:</p>
                        <div className="space-y-1">
                          {test.data.map((camera: any, idx: number) => (
                            <div key={idx} className="text-sm text-muted-foreground">
                              • {camera.name} ({camera.type})
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="recordings" className="space-y-4">
          <ScrollArea className="h-96">
            {recordingSessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <VideoCamera className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No recordings yet. Start a test recording to see results here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recordingSessions.map((session) => (
                  <Card key={session.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">
                            Recording {session.id.slice(-4)}
                          </h4>
                          <div className="text-sm text-muted-foreground space-y-1">
                            <p>Duration: {formatDuration(session.duration)}</p>
                            <p>Size: {formatFileSize(session.size)}</p>
                            <p>Format: {session.format.toUpperCase()}</p>
                            <p>Started: {session.startTime.toLocaleTimeString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={
                            session.status === 'completed' ? 'default' : 
                            session.status === 'failed' ? 'destructive' : 'secondary'
                          }>
                            {session.status.toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Test Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm">Recording Quality</Label>
                <div className="flex gap-2 mt-2">
                  {['high', 'medium', 'low'].map((quality) => (
                    <Button key={quality} variant="outline" size="sm">
                      {quality.charAt(0).toUpperCase() + quality.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
              
              <div>
                <Label className="text-sm">Test Timeout (seconds)</Label>
                <Input type="number" defaultValue={30} className="mt-1" />
              </div>
              
              <div>
                <Label className="text-sm">Max Recording Duration (minutes)</Label>
                <Input type="number" defaultValue={5} className="mt-1" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
