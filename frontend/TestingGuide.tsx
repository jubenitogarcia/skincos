import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Badge } from '@/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { CameraTestingGuide } from '@/CameraTestingGuide'
import { 
  Monitor, 
  Camera, 
  VideoCamera, 
  Warning, 
  Info,
  CheckCircle,
  Play,
  Gear,
  Book
} from '@phosphor-icons/react'

export function TestingGuide() {
  return (
    <Tabs defaultValue="quick-start" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="quick-start">Quick Start</TabsTrigger>
        <TabsTrigger value="camera-guide">Camera Testing Guide</TabsTrigger>
      </TabsList>

      <TabsContent value="quick-start" className="space-y-6 mt-6">
      {/* Quick Start Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="w-5 h-5 text-green-500" />
            Quick Testing Guide
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Browser Testing
              </h4>
              <ol className="text-sm space-y-2 text-muted-foreground ml-6">
                <li>1. Click "Run All Tests" in the Test tab</li>
                <li>2. Grant screen capture permissions when prompted</li>
                <li>3. Verify all tests pass (green checkmarks)</li>
                <li>4. Try manual recording test</li>
                <li>5. Download and verify recorded videos</li>
              </ol>
            </div>
            
            <div className="space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-500" />
                Google Home Testing
              </h4>
              <ol className="text-sm space-y-2 text-muted-foreground ml-6">
                <li>1. Navigate to home.google.com</li>
                <li>2. Login to your Google account</li>
                <li>3. Open a camera feed</li>
                <li>4. Verify "Video Active" status appears</li>
                <li>5. Test recording the camera stream</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Scenarios */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <VideoCamera className="w-5 h-5" />
            Test Scenarios for Real Cameras
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Scenario 1 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-100 text-blue-800">Scenario 1</Badge>
              <h4 className="font-medium">Single Camera Recording</h4>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <p className="text-sm"><strong>Setup:</strong> One compatible camera accessible via Google Home</p>
              <p className="text-sm"><strong>Steps:</strong></p>
              <ol className="text-sm ml-4 space-y-1 text-muted-foreground">
                <li>1. Navigate to Google Home and login</li>
                <li>2. Open your camera's live feed</li>
                <li>3. Wait for "Video Active" indicator</li>
                <li>4. Start recording manually or enable auto-record</li>
                <li>5. Let it record for 30-60 seconds</li>
                <li>6. Stop recording and verify file saves</li>
              </ol>
              <p className="text-sm"><strong>Expected:</strong> Clean video file with visible camera feed, no audio</p>
            </div>
          </div>

          {/* Scenario 2 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800">Scenario 2</Badge>
              <h4 className="font-medium">Auto-Recording Test</h4>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <p className="text-sm"><strong>Setup:</strong> Enable auto-record in settings</p>
              <p className="text-sm"><strong>Steps:</strong></p>
              <ol className="text-sm ml-4 space-y-1 text-muted-foreground">
                <li>1. Go to Settings tab and enable "Auto Record"</li>
                <li>2. Set max duration to 2-3 minutes</li>
                <li>3. Navigate to Google Home</li>
                <li>4. Open any camera feed</li>
                <li>5. Recording should start automatically</li>
                <li>6. Verify it stops after max duration</li>
              </ol>
              <p className="text-sm"><strong>Expected:</strong> Recording starts when video appears, stops at time limit</p>
            </div>
          </div>

          {/* Scenario 3 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-purple-100 text-purple-800">Scenario 3</Badge>
              <h4 className="font-medium">Multiple Camera Switch</h4>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <p className="text-sm"><strong>Setup:</strong> Multiple cameras in Google Home</p>
              <p className="text-sm"><strong>Steps:</strong></p>
              <ol className="text-sm ml-4 space-y-1 text-muted-foreground">
                <li>1. Record first camera for 30 seconds</li>
                <li>2. Stop recording and switch to second camera</li>
                <li>3. Start new recording</li>
                <li>4. Verify each recording captured correct camera</li>
                <li>5. Test camera favorites automation</li>
              </ol>
              <p className="text-sm"><strong>Expected:</strong> Each file shows correct camera, favorites work</p>
            </div>
          </div>

          {/* Scenario 4 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-orange-100 text-orange-800">Scenario 4</Badge>
              <h4 className="font-medium">Quality & Format Testing</h4>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <p className="text-sm"><strong>Setup:</strong> Test different recording settings</p>
              <p className="text-sm"><strong>Steps:</strong></p>
              <ol className="text-sm ml-4 space-y-1 text-muted-foreground">
                <li>1. Record same camera at High, Medium, Low quality</li>
                <li>2. Try both WebM and MP4 formats (if supported)</li>
                <li>3. Compare file sizes and visual quality</li>
                <li>4. Test playback in different players</li>
              </ol>
              <p className="text-sm"><strong>Expected:</strong> Higher quality = larger files, all formats playable</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Common Issues */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warning className="w-5 h-5 text-yellow-500" />
            Common Issues & Solutions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="border-l-4 border-red-400 pl-4">
              <h4 className="font-medium text-red-700">Screen Capture Permission Denied</h4>
              <p className="text-sm text-muted-foreground mt-1">
                <strong>Solution:</strong> Check browser settings, enable screen recording permissions, or try in Chrome/Edge which have better support.
              </p>
            </div>

            <div className="border-l-4 border-yellow-400 pl-4">
              <h4 className="font-medium text-yellow-700">Recording Shows Black Screen</h4>
              <p className="text-sm text-muted-foreground mt-1">
                <strong>Solution:</strong> Some apps block screen capture. Try recording the entire screen instead of just the browser window.
              </p>
            </div>

            <div className="border-l-4 border-blue-400 pl-4">
              <h4 className="font-medium text-blue-700">Auto-Recording Not Starting</h4>
              <p className="text-sm text-muted-foreground mt-1">
                <strong>Solution:</strong> Verify video detection is working (check "Video Active" status). Some camera interfaces may not be detected properly.
              </p>
            </div>

            <div className="border-l-4 border-green-400 pl-4">
              <h4 className="font-medium text-green-700">Large File Sizes</h4>
              <p className="text-sm text-muted-foreground mt-1">
                <strong>Solution:</strong> Use lower quality settings or WebM format. Consider shorter recording durations for testing.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gear className="w-5 h-5" />
            Performance Optimization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">For Better Recording Quality:</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Use Chrome or Edge browser</li>
                <li>• Close unnecessary tabs</li>
                <li>• Record in full-screen mode</li>
                <li>• Ensure stable internet connection</li>
                <li>• Use high quality setting for important recordings</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-medium mb-2">For Better Performance:</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Use medium or low quality for long recordings</li>
                <li>• Set reasonable max duration limits</li>
                <li>• Monitor available disk space</li>
                <li>• Clear old recordings regularly</li>
                <li>• Use WebM format for smaller files</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Expected Results */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Expected Test Results
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-medium text-green-800 mb-2">✅ Successful Test Results Should Show:</h4>
              <ul className="text-sm text-green-700 space-y-1">
                <li>• All automated tests pass (green checkmarks)</li>
                <li>• Screen capture permissions granted</li>
                <li>• Video recording capabilities detected</li>
                <li>• Manual recording produces playable video files</li>
                <li>• Google Home camera feeds detected as "Video Active"</li>
                <li>• Auto-recording triggers when video appears</li>
                <li>• Recorded files saved to specified location</li>
                <li>• Quality settings affect file size appropriately</li>
              </ul>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="font-medium text-yellow-800 mb-2 flex items-center gap-2">
                <img src="/icons/warning.png" alt="" aria-hidden className="h-4 w-4" />
                Limitations to Expect:
              </h4>
              <ul className="text-sm text-yellow-700 space-y-1">
                <li>• No audio recording (by design for privacy)</li>
                <li>• Recording quality limited by display resolution</li>
                <li>• Some browsers may have format limitations</li>
                <li>• Google Home interface changes may affect detection</li>
                <li>• Performance depends on system resources</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Next Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-500" />
            Next Steps After Testing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <p><strong>If tests pass:</strong> Your system is ready for Google Home camera recording. Set up your favorites and recording preferences.</p>
            <p><strong>If tests fail:</strong> Check browser compatibility, permissions, and try the suggested solutions above.</p>
            <p><strong>For production use:</strong> Consider packaging as an Electron app for better performance and native file system access.</p>
          </div>
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="camera-guide" className="mt-6">
        <CameraTestingGuide />
      </TabsContent>
    </Tabs>
  )
}
