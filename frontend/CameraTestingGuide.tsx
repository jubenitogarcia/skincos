import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { 
  Camera,
  Globe,
  Play,
  Monitor,
  CheckCircle,
  Warning,
  Info,
  ArrowRight,
  VideoCamera,
  Gear,
  Shield,
  Download
} from '@phosphor-icons/react'

export function CameraTestingGuide() {
  const requirements = [
    {
      category: 'Browser Requirements',
      icon: <Globe className="w-5 h-5" />,
      items: [
        { name: 'Google Chrome 72+', status: 'recommended', note: 'Best compatibility' },
        { name: 'Microsoft Edge 79+', status: 'recommended', note: 'Full feature support' },
        { name: 'Firefox 66+', status: 'limited', note: 'Partial screen recording support' },
        { name: 'Safari 14+', status: 'limited', note: 'Viewing only, no recording' }
      ]
    },
    {
      category: 'System Permissions',
      icon: <Shield className="w-5 h-5" />,
      items: [
        { name: 'Screen Recording Permission', status: 'required', note: 'For capturing camera feeds' },
        { name: 'Microphone Access', status: 'optional', note: 'For audio recording' },
        { name: 'Camera Access', status: 'optional', note: 'For testing purposes only' },
        { name: 'Storage Access', status: 'required', note: 'For saving recordings' }
      ]
    },
    {
      category: 'Google Home Setup',
      icon: <Camera className="w-5 h-5" />,
      items: [
        { name: 'Google Account', status: 'required', note: 'With access to Google Home' },
        { name: 'Camera Setup', status: 'required', note: 'Cameras added to Google Home' },
        { name: 'Stable Internet', status: 'required', note: 'For reliable video streaming' },
        { name: 'Camera Online Status', status: 'required', note: 'Cameras must be powered and connected' }
      ]
    }
  ]

  const testingSteps = [
    {
      phase: 'Preparation',
      steps: [
        'Ensure your cameras are properly set up in Google Home',
        'Test that you can view camera feeds manually in Google Home',
        'Close unnecessary browser tabs to improve performance',
        'Grant screen recording permissions when prompted'
      ]
    },
    {
      phase: 'Basic Testing',
      steps: [
        'Open Unit Monitor and navigate to the Camera tab',
        'Run the automated browser compatibility tests',
        'Test manual screen recording functionality',
        'Verify that recordings are saved correctly'
      ]
    },
    {
      phase: 'Google Home Integration',
      steps: [
        'Log into Google Home through Unit Monitor',
        'Create favorites for your cameras',
        'Test automated navigation to different cameras',
        'Verify video player detection works correctly'
      ]
    },
    {
      phase: 'Recording Workflow',
      steps: [
        'Start with a camera favorite',
        'Enable auto-recording in settings',
        'Navigate to camera and verify recording starts automatically',
        'Test manual recording controls',
        'Verify recording quality and file output'
      ]
    }
  ]

  const troubleshooting = [
    {
      issue: 'Screen recording permission denied',
      solutions: [
        'Check browser settings for screen capture permissions',
        'Try reloading the page and granting permission again',
        'On macOS: System Preferences → Security → Screen Recording',
        'On Windows: Check browser security settings'
      ]
    },
    {
      issue: 'Camera feeds not loading in Google Home',
      solutions: [
        'Verify cameras are online and connected',
        'Check Google Home app on mobile device',
        'Try refreshing the Google Home page',
        'Ensure stable internet connection'
      ]
    },
    {
      issue: 'Recording files are too large',
      solutions: [
        'Lower recording quality in settings',
        'Reduce recording duration',
        'Choose WebM format for smaller files',
        'Clean up old recordings regularly'
      ]
    },
    {
      issue: 'Automation scripts not working',
      solutions: [
        'Check that camera favorites are set up correctly',
        'Verify Google Home interface is fully loaded',
        'Try manual navigation first to test',
        'Check browser console for errors'
      ]
    }
  ]

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'recommended':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Recommended</Badge>
      case 'required':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Required</Badge>
      case 'limited':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Limited</Badge>
      case 'optional':
        return <Badge variant="outline">Optional</Badge>
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <VideoCamera className="w-6 h-6" />
            Google Home Camera Testing Guide
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Complete guide for testing camera recording functionality with Google Home integration
          </p>
        </CardHeader>
      </Card>

      <Tabs defaultValue="requirements" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="requirements">Requirements</TabsTrigger>
          <TabsTrigger value="testing">Testing Steps</TabsTrigger>
          <TabsTrigger value="troubleshooting">Troubleshooting</TabsTrigger>
          <TabsTrigger value="tips">Tips & Best Practices</TabsTrigger>
        </TabsList>

        <TabsContent value="requirements" className="space-y-4">
          {requirements.map((req, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  {req.icon}
                  {req.category}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {req.items.map((item, itemIndex) => (
                    <div key={itemIndex} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <h4 className="font-medium">{item.name}</h4>
                        <p className="text-sm text-muted-foreground">{item.note}</p>
                      </div>
                      {getStatusBadge(item.status)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="testing" className="space-y-4">
          {testingSteps.map((phase, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                    {index + 1}
                  </div>
                  {phase.phase}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {phase.steps.map((step, stepIndex) => (
                    <div key={stepIndex} className="flex items-start gap-3 p-2">
                      <ArrowRight className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{step}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="troubleshooting" className="space-y-4">
          {troubleshooting.map((item, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Warning className="w-5 h-5 text-yellow-500" />
                  {item.issue}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <h4 className="font-medium text-sm mb-2">Solutions:</h4>
                  {item.solutions.map((solution, solutionIndex) => (
                    <div key={solutionIndex} className="flex items-start gap-3 p-2">
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{solution}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="tips" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  Best Practices
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">•</span>
                    Use Chrome or Edge for optimal compatibility
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">•</span>
                    Test during low network usage times
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">•</span>
                    Keep recordings under 5 minutes for file size
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">•</span>
                    Create favorites for frequently used cameras
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">•</span>
                    Test with different camera models if available
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Info className="w-5 h-5 text-blue-500" />
                  Performance Tips
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    Close other browser tabs during recording
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    Use wired internet connection when possible
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    Monitor CPU usage during long recordings
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    Clear browser cache if experiencing issues
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">•</span>
                    Ensure sufficient disk space for recordings
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Gear className="w-5 h-5 text-purple-500" />
                  Quality Settings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">•</span>
                    High quality for important recordings
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">•</span>
                    Medium quality for regular monitoring
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">•</span>
                    Low quality for testing or long recordings
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">•</span>
                    WebM format for smaller file sizes
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">•</span>
                    MP4 format for better compatibility
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Warning className="w-5 h-5 text-red-500" />
                  Important Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">•</span>
                    This captures what you see on screen
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">•</span>
                    No direct RTSP access to cameras
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">•</span>
                    Respect privacy and legal requirements
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">•</span>
                    Recording quality depends on stream quality
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">•</span>
                    Large recordings may impact performance
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ready to Start Testing?</CardTitle>
          <p className="text-sm text-muted-foreground">
            Follow the steps above to test Google Home camera recording functionality with Unit Monitor
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Play className="w-4 h-4 mr-2" />
              Start Camera Tests
            </Button>
            <Button variant="outline">
              <Monitor className="w-4 h-4 mr-2" />
              Open Google Home
            </Button>
            <Button variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Download Test Report Template
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
