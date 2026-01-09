import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Badge } from '@/badge'
import { ScrollArea } from '@/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { 
  CheckCircle, 
  XCircle, 
  Warning,
  Info,
  Globe
} from '@phosphor-icons/react'

interface BrowserSupport {
  name: string
  icon: React.ReactNode
  screenCapture: 'full' | 'partial' | 'none'
  mediaRecording: 'full' | 'partial' | 'none'
  permissions: 'full' | 'partial' | 'none'
  overall: 'excellent' | 'good' | 'limited' | 'unsupported'
  minVersion: string
  notes: string[]
  limitations: string[]
  recommendations: string[]
}

const BROWSER_SUPPORT: BrowserSupport[] = [
  {
    name: 'Google Chrome',
    icon: <div className="w-4 h-4 bg-blue-500 rounded-full" />,
    screenCapture: 'full',
    mediaRecording: 'full',
    permissions: 'full',
    overall: 'excellent',
    minVersion: '72',
    notes: [
      'Best overall support for all Unit Monitor features',
      'Full Screen Capture API support',
      'Complete MediaRecorder API with multiple codecs',
      'Robust Permissions API implementation'
    ],
    limitations: [],
    recommendations: [
      'Recommended primary browser for Unit Monitor',
      'Enable camera and microphone permissions when prompted',
      'Ensure running on HTTPS for all features to work'
    ]
  },
  {
    name: 'Microsoft Edge',
    icon: <div className="w-4 h-4 bg-blue-600 rounded-full" />,
    screenCapture: 'full',
    mediaRecording: 'full',
    permissions: 'full',
    overall: 'excellent',
    minVersion: '79',
    notes: [
      'Chromium-based Edge has excellent compatibility',
      'Full feature parity with Chrome',
      'Strong enterprise integration'
    ],
    limitations: [],
    recommendations: [
      'Excellent alternative to Chrome',
      'Good choice for enterprise environments',
      'All Unit Monitor features fully supported'
    ]
  },
  {
    name: 'Mozilla Firefox',
    icon: <div className="w-4 h-4 bg-orange-500 rounded-full" />,
    screenCapture: 'full',
    mediaRecording: 'full',
    permissions: 'partial',
    overall: 'good',
    minVersion: '66',
    notes: [
      'Good support for core functionality',
      'Screen sharing works well',
      'MediaRecorder API fully supported'
    ],
    limitations: [
      'Permissions API has limited query support',
      'Some advanced WebRTC features may differ'
    ],
    recommendations: [
      'Suitable for Unit Monitor with minor limitations',
      'May require manual permission management',
      'Test screen recording functionality thoroughly'
    ]
  },
  {
    name: 'Safari',
    icon: <div className="w-4 h-4 bg-blue-400 rounded-full" />,
    screenCapture: 'none',
    mediaRecording: 'partial',
    permissions: 'none',
    overall: 'limited',
    minVersion: '14',
    notes: [
      'Limited support for advanced media features',
      'No Screen Capture API support',
      'MediaRecorder API available but limited codec support'
    ],
    limitations: [
      'No getDisplayMedia API - cannot capture screen',
      'No Permissions API support',
      'Limited MediaRecorder codec support',
      'May have WebRTC compatibility issues'
    ],
    recommendations: [
      'Not recommended for Unit Monitor',
      'Core Google Home viewing may work',
      'Screen recording will not function',
      'Consider using Chrome or Firefox instead'
    ]
  }
]

const FEATURE_COMPATIBILITY = [
  {
    feature: 'Google Home WebView',
    description: 'Loading and interacting with Google Home interface',
    chrome: 'full',
    edge: 'full', 
    firefox: 'full',
    safari: 'full',
    notes: 'Basic web browsing supported in all modern browsers'
  },
  {
    feature: 'Screen Capture',
    description: 'Capturing screen content for recording',
    chrome: 'full',
    edge: 'full',
    firefox: 'full', 
    safari: 'none',
    notes: 'Safari does not support getDisplayMedia API'
  },
  {
    feature: 'Video Recording',
    description: 'Recording captured screen content to video files',
    chrome: 'full',
    edge: 'full',
    firefox: 'partial',
    safari: 'partial',
    notes: 'Codec support varies; WebM widely supported, MP4 limited'
  },
  {
    feature: 'Permissions Management',
    description: 'Requesting and managing user permissions',
    chrome: 'full',
    edge: 'full',
    firefox: 'partial',
    safari: 'none',
    notes: 'Safari requires manual permission management'
  },
  {
    feature: 'File System Access',
    description: 'Choosing save locations for recordings',
    chrome: 'full',
    edge: 'full',
    firefox: 'full',
    safari: 'full',
    notes: 'All browsers support file download dialogs'
  },
  {
    feature: 'Local Storage',
    description: 'Saving user preferences and settings',
    chrome: 'full',
    edge: 'full',
    firefox: 'full',
    safari: 'full',
    notes: 'Universal support across all browsers'
  }
]

const TROUBLESHOOTING_TIPS = [
  {
    issue: 'Screen recording not working',
    browsers: ['Safari'],
    solution: 'Switch to Chrome, Edge, or Firefox. Safari does not support screen capture.',
    priority: 'high'
  },
  {
    issue: 'Permission dialogs not appearing',
    browsers: ['All'],
    solution: 'Ensure the app is running on HTTPS. Check browser settings for blocked permissions.',
    priority: 'high'
  },
  {
    issue: 'Recording files not saving',
    browsers: ['All'],
    solution: 'Check browser download settings. Ensure sufficient disk space available.',
    priority: 'medium'
  },
  {
    issue: 'Poor recording quality',
    browsers: ['Firefox', 'Safari'],
    solution: 'Try different quality settings. Some browsers have limited codec support.',
    priority: 'medium'
  },
  {
    issue: 'Google Home not loading',
    browsers: ['All'],
    solution: 'Check internet connection. Verify Google account permissions. Clear browser cache.',
    priority: 'medium'
  },
  {
    issue: 'App running slowly',
    browsers: ['Firefox', 'Safari'],
    solution: 'Close other tabs. Chrome and Edge typically have better performance.',
    priority: 'low'
  }
]

export function BrowserCompatibilityGuide() {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'full':
      case 'excellent':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'partial':
      case 'good':
        return <Warning className="w-4 h-4 text-yellow-500" />
      case 'none':
      case 'limited':
      case 'unsupported':
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <Info className="w-4 h-4 text-muted-foreground" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'full':
      case 'excellent':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Full Support</Badge>
      case 'partial':
      case 'good':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Partial Support</Badge>
      case 'none':
      case 'limited':
        return <Badge className="bg-red-100 text-red-800 border-red-200">No Support</Badge>
      case 'unsupported':
        return <Badge variant="destructive">Unsupported</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Browser Compatibility Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Unit Monitor requires modern web APIs for screen capture and video recording. 
            Browser support varies significantly, with Chromium-based browsers providing 
            the best experience.
          </p>
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-medium text-blue-900 mb-2">Recommended Browsers</h4>
            <p className="text-blue-800 text-sm">
              For the best experience with Unit Monitor, use <strong>Google Chrome 72+</strong> or 
              <strong> Microsoft Edge 79+</strong>. These browsers provide full support for all features.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="browsers" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="browsers">Browser Support</TabsTrigger>
          <TabsTrigger value="features">Feature Matrix</TabsTrigger>
          <TabsTrigger value="troubleshooting">Troubleshooting</TabsTrigger>
        </TabsList>

        {/* Browser Support Tab */}
        <TabsContent value="browsers">
          <div className="space-y-4">
            {BROWSER_SUPPORT.map((browser) => (
              <Card key={browser.name}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {browser.icon}
                      <div>
                        <CardTitle className="text-lg">{browser.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          Minimum version: {browser.minVersion}
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(browser.overall)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Feature Support */}
                  <div>
                    <h4 className="font-medium mb-2">Feature Support</h4>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(browser.screenCapture)}
                        <span>Screen Capture</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(browser.mediaRecording)}
                        <span>Media Recording</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(browser.permissions)}
                        <span>Permissions API</span>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  {browser.notes.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Notes</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {browser.notes.map((note, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <CheckCircle className="w-3 h-3 mt-0.5 text-green-500 flex-shrink-0" />
                            {note}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Limitations */}
                  {browser.limitations.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Limitations</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {browser.limitations.map((limitation, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <Warning className="w-3 h-3 mt-0.5 text-yellow-500 flex-shrink-0" />
                            {limitation}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Recommendations */}
                  {browser.recommendations.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Recommendations</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {browser.recommendations.map((rec, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <Info className="w-3 h-3 mt-0.5 text-blue-500 flex-shrink-0" />
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Feature Matrix Tab */}
        <TabsContent value="features">
          <Card>
            <CardHeader>
              <CardTitle>Feature Compatibility Matrix</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Feature</th>
                      <th className="text-center py-2">Chrome</th>
                      <th className="text-center py-2">Edge</th>
                      <th className="text-center py-2">Firefox</th>
                      <th className="text-center py-2">Safari</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FEATURE_COMPATIBILITY.map((feature, index) => (
                      <tr key={index} className="border-b">
                        <td className="py-3">
                          <div>
                            <div className="font-medium">{feature.feature}</div>
                            <div className="text-xs text-muted-foreground">
                              {feature.description}
                            </div>
                          </div>
                        </td>
                        <td className="text-center py-3">
                          {getStatusIcon(feature.chrome)}
                        </td>
                        <td className="text-center py-3">
                          {getStatusIcon(feature.edge)}
                        </td>
                        <td className="text-center py-3">
                          {getStatusIcon(feature.firefox)}
                        </td>
                        <td className="text-center py-3">
                          {getStatusIcon(feature.safari)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-green-500" />
                    <span>Full Support</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Warning className="w-3 h-3 text-yellow-500" />
                    <span>Partial Support</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-red-500" />
                    <span>No Support</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Troubleshooting Tab */}
        <TabsContent value="troubleshooting">
          <div className="space-y-4">
            {TROUBLESHOOTING_TIPS.map((tip, index) => (
              <Card key={index}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-2 ${
                      tip.priority === 'high' ? 'bg-red-500' :
                      tip.priority === 'medium' ? 'bg-yellow-500' :
                      'bg-green-500'
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-medium">{tip.issue}</h3>
                        <Badge variant="outline" className="text-xs">
                          {tip.priority} priority
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {tip.solution}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Affects:</span>
                        {tip.browsers.map((browser, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {browser}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}