import React, { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Progress } from '@/progress'
import { ScrollArea } from '@/scroll-area'
import { Input } from '@/input'
import { Label } from '@/label'
import { 
  Globe, 
  Camera, 
  VideoCamera, 
  CheckCircle,
  XCircle,
  Warning,
  ArrowRight,
  Eye,
  Play
} from '@phosphor-icons/react'

interface GoogleHomeTestProps {
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void
}

interface CameraTestResult {
  cameraName: string
  status: 'success' | 'failed' | 'testing'
  videoDetected: boolean
  recordingWorked: boolean
  fileSize?: number
  error?: string
}

export function GoogleHomeTest({ onLog }: GoogleHomeTestProps) {
  const [isConnected, setIsConnected] = useState(false)
  const [detectedCameras, setDetectedCameras] = useState<string[]>([])
  const [testResults, setTestResults] = useState<CameraTestResult[]>([])
  const [currentTest, setCurrentTest] = useState<string | null>(null)
  const [testCameraName, setTestCameraName] = useState('')
  const [simulatedMode, setSimulatedMode] = useState(true)

  // Simulate Google Home connection status
  useEffect(() => {
    // Simulate connection check
    const checkConnection = () => {
      const connected = Math.random() > 0.3 // 70% chance of being "connected"
      setIsConnected(connected)
      
      if (connected) {
        // Simulate detected cameras
        const cameras = [
          'Living Room Camera',
          'Kitchen Security Cam',
          'Front Door Camera',
          'Backyard Cam',
          'Garage Camera'
        ]
        const numCameras = Math.floor(Math.random() * cameras.length) + 1
        const selectedCameras = cameras.slice(0, numCameras)
        setDetectedCameras(selectedCameras)
        onLog('INFO', `Connected to Google Home - Found ${numCameras} cameras`)
      } else {
        setDetectedCameras([])
        onLog('WARNING', 'Unable to connect to Google Home interface')
      }
    }

    checkConnection()
    const interval = setInterval(checkConnection, 10000) // Check every 10 seconds

    return () => clearInterval(interval)
  }, [onLog])

  const testCamera = async (cameraName: string): Promise<CameraTestResult> => {
    setCurrentTest(cameraName)
    onLog('INFO', `Testing camera: ${cameraName}`)

    return new Promise((resolve) => {
      // Simulate camera testing process
      const testSteps = [
        { step: 'Opening camera feed', delay: 1000 },
        { step: 'Detecting video stream', delay: 1500 },
        { step: 'Starting recording test', delay: 2000 },
        { step: 'Analyzing recording quality', delay: 1000 }
      ]

      let currentStep = 0
      const runNextStep = () => {
        if (currentStep < testSteps.length) {
          onLog('INFO', `${cameraName}: ${testSteps[currentStep].step}`)
          setTimeout(() => {
            currentStep++
            runNextStep()
          }, testSteps[currentStep].delay)
        } else {
          // Simulate test completion
          const success = Math.random() > 0.2 // 80% success rate
          const videoDetected = success && Math.random() > 0.1 // 90% video detection if successful
          const recordingWorked = videoDetected && Math.random() > 0.15 // 85% recording success if video detected
          const fileSize = recordingWorked ? Math.floor(Math.random() * 50) + 10 : undefined // 10-60 MB

          const result: CameraTestResult = {
            cameraName,
            status: success ? 'success' : 'failed',
            videoDetected,
            recordingWorked,
            fileSize,
            error: success ? undefined : 'Camera feed not accessible or video stream corrupted'
          }

          if (success) {
            onLog('INFO', `✓ ${cameraName}: Test completed successfully${fileSize ? ` (${fileSize}MB recorded)` : ''}`)
          } else {
            onLog('ERROR', `✗ ${cameraName}: ${result.error}`)
          }

          setCurrentTest(null)
          resolve(result)
        }
      }

      runNextStep()
    })
  }

  const runCameraTest = async (cameraName: string) => {
    setTestResults(prev => prev.filter(r => r.cameraName !== cameraName))
    
    // Add test as in progress
    setTestResults(prev => [...prev, {
      cameraName,
      status: 'testing',
      videoDetected: false,
      recordingWorked: false
    }])

    const result = await testCamera(cameraName)
    
    setTestResults(prev => prev.map(r => 
      r.cameraName === cameraName ? result : r
    ))
  }

  const runAllCameraTests = async () => {
    if (detectedCameras.length === 0) {
      onLog('WARNING', 'No cameras detected to test')
      return
    }

    onLog('INFO', `Starting tests for ${detectedCameras.length} cameras`)
    setTestResults([])

    for (const camera of detectedCameras) {
      await runCameraTest(camera)
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    onLog('INFO', 'All camera tests completed')
  }

  const addCustomCameraTest = () => {
    if (!testCameraName.trim()) {
      onLog('WARNING', 'Please enter a camera name')
      return
    }

    const cameraName = testCameraName.trim()
    setTestCameraName('')
    runCameraTest(cameraName)
  }

  const getStatusIcon = (status: CameraTestResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'testing':
        return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    }
  }

  const getRecordingQuality = (fileSize?: number) => {
    if (!fileSize) return null
    if (fileSize > 40) return { label: 'Excellent', color: 'text-green-600' }
    if (fileSize > 25) return { label: 'Good', color: 'text-blue-600' }
    if (fileSize > 15) return { label: 'Fair', color: 'text-yellow-600' }
    return { label: 'Poor', color: 'text-red-600' }
  }

  const successfulTests = testResults.filter(r => r.status === 'success').length
  const totalTests = testResults.length

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Google Home Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant={isConnected ? 'default' : 'destructive'}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </Badge>
              <span className="text-sm text-muted-foreground">
                home.google.com interface
              </span>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => window.open('https://home.google.com', '_blank')}
              className="gap-2"
            >
              <ArrowRight className="w-4 h-4" />
              Open Google Home
            </Button>
          </div>

          {isConnected && detectedCameras.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Camera className="w-4 h-4" />
                Detected Cameras ({detectedCameras.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {detectedCameras.map((camera, index) => (
                  <div key={index} className="flex items-center justify-between p-2 border rounded">
                    <span className="text-sm">{camera}</span>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => runCameraTest(camera)}
                      disabled={currentTest === camera}
                      className="gap-1"
                    >
                      {currentTest === camera ? (
                        <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Eye className="w-3 h-3" />
                      )}
                      Test
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {simulatedMode && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
              <div className="flex items-start gap-2">
                <Warning className="w-4 h-4 text-yellow-600 mt-0.5" />
                <div className="text-sm text-yellow-700">
                  <p className="font-medium">Simulation Mode Active</p>
                  <p>This is showing simulated results. In production, this will connect to your actual Google Home cameras.</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Camera Testing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <VideoCamera className="w-5 h-5" />
              Camera Testing
            </div>
            <Button 
              onClick={runAllCameraTests}
              disabled={!isConnected || detectedCameras.length === 0 || currentTest !== null}
              className="gap-2"
            >
              <Play className="w-4 h-4" />
              Test All Cameras
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Manual Camera Test */}
          <div className="space-y-2">
            <Label htmlFor="camera-name" className="text-sm font-medium">
              Add Custom Camera Test
            </Label>
            <div className="flex gap-2">
              <Input
                id="camera-name"
                value={testCameraName}
                onChange={(e) => setTestCameraName(e.target.value)}
                placeholder="Enter camera name..."
                onKeyPress={(e) => e.key === 'Enter' && addCustomCameraTest()}
              />
              <Button 
                onClick={addCustomCameraTest}
                disabled={!testCameraName.trim()}
                variant="outline"
              >
                Test
              </Button>
            </div>
          </div>

          {/* Test Progress */}
          {testResults.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Test Progress</span>
                <span className="text-sm text-muted-foreground">
                  {successfulTests}/{totalTests} successful
                </span>
              </div>
              <Progress 
                value={totalTests > 0 ? (successfulTests / totalTests) * 100 : 0} 
                className="h-2"
              />
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
            <ScrollArea className="h-80">
              <div className="space-y-3">
                {testResults.map((result, index) => (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      {getStatusIcon(result.status)}
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">{result.cameraName}</h4>
                          {result.status === 'testing' && (
                            <Badge variant="outline">Testing...</Badge>
                          )}
                        </div>

                        {result.status !== 'testing' && (
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Video Detection:</span>
                                <Badge variant={result.videoDetected ? 'default' : 'destructive'}>
                                  {result.videoDetected ? 'Success' : 'Failed'}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Recording:</span>
                                <Badge variant={result.recordingWorked ? 'default' : 'destructive'}>
                                  {result.recordingWorked ? 'Working' : 'Failed'}
                                </Badge>
                              </div>
                            </div>

                            <div className="space-y-1">
                              {result.fileSize && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">File Size:</span>
                                  <span className="font-mono text-sm">{result.fileSize}MB</span>
                                </div>
                              )}
                              {result.fileSize && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Quality:</span>
                                  <span className={`text-sm font-medium ${getRecordingQuality(result.fileSize)?.color}`}>
                                    {getRecordingQuality(result.fileSize)?.label}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {result.error && (
                          <div className="bg-red-50 border border-red-200 rounded p-2">
                            <p className="text-sm text-red-700">{result.error}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Real-World Testing Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Real Camera Testing Steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <h4 className="font-medium text-blue-800 mb-2">For Real Google Home Testing:</h4>
            <ol className="space-y-1 text-blue-700">
              <li>1. Ensure your cameras are connected to Google Home</li>
              <li>2. Navigate to home.google.com and login</li>
              <li>3. Access each camera's live feed manually</li>
              <li>4. Verify the app detects "Video Active" status</li>
              <li>5. Test manual recording with the red Record button</li>
              <li>6. Enable auto-recording and test automatic detection</li>
              <li>7. Check recorded files are saved to your chosen folder</li>
            </ol>
          </div>
          
          <div className="text-muted-foreground">
            <p>• The simulated tests above help verify the app's testing logic</p>
            <p>• Real tests require actual camera hardware and Google Home setup</p>
            <p>• Recording quality depends on your camera's stream quality and network</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
