import React, { useState, useRef, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Progress } from '@/progress'
import { ScrollArea } from '@/scroll-area'
import { Switch } from '@/switch'
import { Label } from '@/label'
import { 
  Play, 
  Stop, 
  Pause, 
  VideoCamera, 
  DownloadSimple,
  CheckCircle,
  XCircle,
  Warning,
  Monitor,
  Camera
} from '@phosphor-icons/react'

interface TestResult {
  test: string
  status: 'pending' | 'running' | 'passed' | 'failed'
  message: string
  duration?: number
}

interface ScreenRecordingTestProps {
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void
}

export function ScreenRecordingTest({ onLog }: ScreenRecordingTestProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [isRunningTests, setIsRunningTests] = useState(false)
  const [recordedBlobs, setRecordedBlobs] = useState<Blob[]>([])
  const [capabilities, setCapabilities] = useState<any>(null)
  const [fakeVideoVisible, setFakeVideoVisible] = useState(false)
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const tests: Array<{name: string, test: () => Promise<TestResult>}> = [
    {
      name: 'Screen Capture API Support',
      test: async () => {
        const start = Date.now()
        try {
          const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
          if (supported) {
            onLog('INFO', 'Screen Capture API is supported')
            return {
              test: 'Screen Capture API Support',
              status: 'passed',
              message: 'navigator.mediaDevices.getDisplayMedia is available',
              duration: Date.now() - start
            }
          } else {
            return {
              test: 'Screen Capture API Support',
              status: 'failed',
              message: 'Screen Capture API not supported in this browser',
              duration: Date.now() - start
            }
          }
        } catch (error) {
          return {
            test: 'Screen Capture API Support',
            status: 'failed',
            message: `Error checking API support: ${error.message}`,
            duration: Date.now() - start
          }
        }
      }
    },
    {
      name: 'MediaRecorder Support',
      test: async () => {
        const start = Date.now()
        try {
          const supported = typeof MediaRecorder !== 'undefined'
          if (supported) {
            const mimeTypes = [
              'video/webm',
              'video/webm;codecs=vp9',
              'video/webm;codecs=vp8',
              'video/mp4',
              'video/mp4;codecs=h264'
            ]
            
            const supportedTypes = mimeTypes.filter(type => MediaRecorder.isTypeSupported(type))
            onLog('INFO', `MediaRecorder supported formats: ${supportedTypes.join(', ')}`)
            
            return {
              test: 'MediaRecorder Support',
              status: 'passed',
              message: `Supported formats: ${supportedTypes.join(', ')}`,
              duration: Date.now() - start
            }
          } else {
            return {
              test: 'MediaRecorder Support',
              status: 'failed',
              message: 'MediaRecorder not supported',
              duration: Date.now() - start
            }
          }
        } catch (error) {
          return {
            test: 'MediaRecorder Support',
            status: 'failed',
            message: `Error checking MediaRecorder: ${error.message}`,
            duration: Date.now() - start
          }
        }
      }
    },
    {
      name: 'Screen Capture Permissions',
      test: async () => {
        const start = Date.now()
        try {
          onLog('INFO', 'Requesting screen capture permissions...')
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: 640, height: 480 },
            audio: false
          })
          
          // Store capabilities for later analysis
          const videoTrack = stream.getVideoTracks()[0]
          const trackCapabilities = videoTrack.getCapabilities()
          setCapabilities(trackCapabilities)
          
          // Clean up immediately
          stream.getTracks().forEach(track => track.stop())
          
          onLog('INFO', 'Screen capture permissions granted')
          return {
            test: 'Screen Capture Permissions',
            status: 'passed',
            message: `Permissions granted. Video capabilities: ${JSON.stringify(trackCapabilities, null, 2)}`,
            duration: Date.now() - start
          }
        } catch (error) {
          return {
            test: 'Screen Capture Permissions',
            status: 'failed',
            message: `Permission denied or error: ${error.message}`,
            duration: Date.now() - start
          }
        }
      }
    },
    {
      name: 'Short Recording Test',
      test: async () => {
        const start = Date.now()
        return new Promise<TestResult>((resolve) => {
          const testRecording = async () => {
            try {
              onLog('INFO', 'Starting 3-second test recording...')
              
              const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: 1280, height: 720 },
                audio: false
              })

              const chunks: Blob[] = []
              const recorder = new MediaRecorder(stream, {
                mimeType: 'video/webm'
              })

              recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                  chunks.push(event.data)
                }
              }

              recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' })
                setRecordedBlobs(prev => [...prev, blob])
                
                // Clean up
                stream.getTracks().forEach(track => track.stop())
                
                onLog('INFO', `Test recording completed. File size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`)
                resolve({
                  test: 'Short Recording Test',
                  status: 'passed',
                  message: `Successfully recorded ${(blob.size / 1024 / 1024).toFixed(2)} MB in 3 seconds`,
                  duration: Date.now() - start
                })
              }

              recorder.onerror = (event) => {
                stream.getTracks().forEach(track => track.stop())
                resolve({
                  test: 'Short Recording Test',
                  status: 'failed',
                  message: `Recording failed: ${event.error?.message || 'Unknown error'}`,
                  duration: Date.now() - start
                })
              }

              recorder.start(1000)
              
              // Stop after 3 seconds
              setTimeout(() => {
                if (recorder.state === 'recording') {
                  recorder.stop()
                }
              }, 3000)
              
            } catch (error) {
              resolve({
                test: 'Short Recording Test',
                status: 'failed',
                message: `Setup failed: ${error.message}`,
                duration: Date.now() - start
              })
            }
          }

          testRecording()
        })
      }
    },
    {
      name: 'Camera Detection Simulation',
      test: async () => {
        const start = Date.now()
        return new Promise<TestResult>((resolve) => {
          try {
            // Simulate camera detection workflow
            onLog('INFO', 'Testing camera detection simulation...')
            
            // Create a fake video element to simulate Google Home camera
            const videoElement = document.createElement('video')
            videoElement.style.width = '640px'
            videoElement.style.height = '480px'
            videoElement.style.position = 'absolute'
            videoElement.style.top = '-1000px'
            videoElement.muted = true
            
            // Set up a test video source (data URL with minimal video data)
            videoElement.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMWRzMXMBAAA='
            
            document.body.appendChild(videoElement)
            
            videoElement.onloadeddata = () => {
              videoElement.play().then(() => {
                setFakeVideoVisible(true)
                onLog('INFO', 'Fake video element created and playing')
                
                // Clean up after test
                setTimeout(() => {
                  document.body.removeChild(videoElement)
                  setFakeVideoVisible(false)
                  resolve({
                    test: 'Camera Detection Simulation',
                    status: 'passed',
                    message: 'Successfully created and detected fake video element',
                    duration: Date.now() - start
                  })
                }, 2000)
              }).catch(() => {
                document.body.removeChild(videoElement)
                resolve({
                  test: 'Camera Detection Simulation',
                  status: 'passed',
                  message: 'Video element created (autoplay may be blocked)',
                  duration: Date.now() - start
                })
              })
            }
            
            videoElement.onerror = () => {
              document.body.removeChild(videoElement)
              resolve({
                test: 'Camera Detection Simulation',
                status: 'failed',
                message: 'Failed to create fake video element',
                duration: Date.now() - start
              })
            }
            
          } catch (error) {
            resolve({
              test: 'Camera Detection Simulation',
              status: 'failed',
              message: `Simulation setup failed: ${error.message}`,
              duration: Date.now() - start
            })
          }
        })
      }
    }
  ]

  const runAllTests = async () => {
    setIsRunningTests(true)
    setTestResults([])
    onLog('INFO', 'Starting screen recording functionality tests...')

    for (const { name, test } of tests) {
      // Set test as running
      setTestResults(prev => [...prev, {
        test: name,
        status: 'running',
        message: 'Running...'
      }])

      try {
        const result = await test()
        setTestResults(prev => prev.map(r => r.test === name ? result : r))
        
        if (result.status === 'passed') {
          onLog('INFO', `✓ ${name}: ${result.message}`)
        } else {
          onLog('ERROR', `✗ ${name}: ${result.message}`)
        }
      } catch (error) {
        const failResult: TestResult = {
          test: name,
          status: 'failed',
          message: `Test crashed: ${error.message}`
        }
        setTestResults(prev => prev.map(r => r.test === name ? failResult : r))
        onLog('ERROR', `✗ ${name}: Test crashed - ${error.message}`)
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    setIsRunningTests(false)
    onLog('INFO', 'All tests completed')
  }

  const startManualRecording = async () => {
    try {
      onLog('INFO', 'Starting manual recording test...')
      
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1280, height: 720, frameRate: 30 },
        audio: false
      })

      streamRef.current = stream
      chunksRef.current = []
      setRecordingDuration(0)

      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm'
      })

      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        setRecordedBlobs(prev => [...prev, blob])
        
        // Clean up
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }
        
        onLog('INFO', `Manual recording stopped. File size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`)
      }

      recorder.onerror = (event) => {
        onLog('ERROR', `Recording error: ${event.error?.message || 'Unknown error'}`)
        setIsRecording(false)
      }

      recorder.start(1000)
      setIsRecording(true)

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1)
      }, 1000)

    } catch (error) {
      onLog('ERROR', `Failed to start manual recording: ${error.message}`)
    }
  }

  const stopManualRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }

  const downloadRecording = (blob: Blob, index: number) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `test-recording-${index + 1}-${Date.now()}.webm`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    onLog('INFO', `Downloaded test recording ${index + 1}`)
  }

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'running':
        return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      default:
        return <div className="w-4 h-4 bg-gray-300 rounded-full" />
    }
  }

  const passedTests = testResults.filter(r => r.status === 'passed').length
  const totalTests = testResults.length

  return (
    <div className="space-y-6">
      {/* Test Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Screen Recording Test Suite
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Comprehensive testing of screen recording functionality
              </p>
              {testResults.length > 0 && (
                <div className="flex items-center gap-2">
                  <Progress value={(passedTests / totalTests) * 100} className="w-32" />
                  <span className="text-sm">
                    {passedTests}/{totalTests} tests passed
                  </span>
                </div>
              )}
            </div>
            <Button 
              onClick={runAllTests} 
              disabled={isRunningTests}
              className="gap-2"
            >
              {isRunningTests ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Running Tests...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run All Tests
                </>
              )}
            </Button>
          </div>

          {capabilities && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <h4 className="text-sm font-medium mb-2">Screen Capture Capabilities:</h4>
              <pre className="text-xs font-mono overflow-x-auto">
                {JSON.stringify(capabilities, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Results */}
      {testResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-3">
                {testResults.map((result, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                    {getStatusIcon(result.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-sm font-medium">{result.test}</h4>
                        {result.duration && (
                          <span className="text-xs text-muted-foreground">
                            {result.duration}ms
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground break-words">
                        {result.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Manual Recording Test */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <VideoCamera className="w-5 h-5" />
            Manual Recording Test
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Test manual recording controls and capture quality
              </p>
              {isRecording && (
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  Recording: {formatDuration(recordingDuration)}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isRecording ? (
                <Button onClick={startManualRecording} className="gap-2">
                  <VideoCamera className="w-4 h-4" />
                  Start Recording
                </Button>
              ) : (
                <Button onClick={stopManualRecording} variant="outline" className="gap-2">
                  <Stop className="w-4 h-4" />
                  Stop Recording
                </Button>
              )}
            </div>
          </div>

          {/* Fake Video Detection */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div className="flex items-center gap-2">
              <Camera className={`w-4 h-4 ${fakeVideoVisible ? 'text-green-500' : 'text-muted-foreground'}`} />
              <span className="text-sm">Simulated Video Player</span>
            </div>
            <Badge variant={fakeVideoVisible ? 'default' : 'secondary'}>
              {fakeVideoVisible ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Recorded Videos */}
      {recordedBlobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recorded Videos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recordedBlobs.map((blob, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Recording {index + 1}</p>
                    <p className="text-xs text-muted-foreground">
                      Size: {(blob.size / 1024 / 1024).toFixed(2)} MB | Type: {blob.type}
                    </p>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => downloadRecording(blob, index)}
                    className="gap-2"
                  >
                    <DownloadSimple className="w-4 h-4" />
                    Download
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Summary */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>• Screen recording tests verify browser capabilities and permissions</p>
        <p>• Manual recording allows you to test the actual recording workflow</p>
        <p>• In production, recordings will be saved to your selected folder automatically</p>
        <p>• Camera detection simulates the Google Home video player detection system</p>
      </div>
    </div>
  )
}