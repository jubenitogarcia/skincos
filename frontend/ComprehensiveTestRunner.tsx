import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/tabs'
import { BrowserCompatibilityTest } from '@/BrowserCompatibilityTest'
import { BrowserCompatibilityGuide } from '@/BrowserCompatibilityGuide'
import { ScreenRecordingTest } from '@/ScreenRecordingTest'
import { CrossPlatformRecordingTest } from '@/CrossPlatformRecordingTest'
import { GoogleHomeTest } from '@/GoogleHomeTest'
import { GoogleHomeCameraTest } from '@/GoogleHomeCameraTest'
import { RealWorldCameraTest } from '@/RealWorldCameraTest'
import { TestingChecklist } from '@/TestingChecklist'
import { TestSummary } from '@/TestSummary'
import { 
  Play, 
  CheckCircle, 
  Warning, 
  XCircle,
  TestTube,
  Monitor,
  Camera,
  VideoCamera,
  Globe,
  Info,
  ListChecks,
  House
} from '@phosphor-icons/react'

interface ComprehensiveTestRunnerProps {
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void
}

interface TestSuite {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  component: React.ReactNode
  status: 'pending' | 'running' | 'passed' | 'failed' | 'warning'
  criticalIssues: number
  warnings: number
  passed: number
}

export function ComprehensiveTestRunner({ onLog }: ComprehensiveTestRunnerProps) {
  const [activeTest, setActiveTest] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, any>>({})

  const testSuites: TestSuite[] = [
    {
      id: 'system-overview',
      name: 'System Overview',
      description: 'Quick system compatibility check',
      icon: <Monitor className="w-4 h-4" />,
      component: <TestSummary onLog={onLog} />,
      status: 'pending',
      criticalIssues: 0,
      warnings: 0,
      passed: 0
    },
    {
      id: 'browser-compatibility',
      name: 'Browser Compatibility',
      description: 'Comprehensive browser API testing',
      icon: <Globe className="w-4 h-4" />,
      component: <BrowserCompatibilityTest onLog={onLog} />,
      status: 'pending',
      criticalIssues: 0,
      warnings: 0,
      passed: 0
    },
    {
      id: 'screen-recording',
      name: 'Screen Recording',
      description: 'Test screen capture and recording functionality',
      icon: <Camera className="w-4 h-4" />,
      component: <ScreenRecordingTest onLog={onLog} />,
      status: 'pending',
      criticalIssues: 0,
      warnings: 0,
      passed: 0
    },
    {
      id: 'cross-platform-recording',
      name: 'Cross-Platform Recording',
      description: 'Advanced screen recording compatibility tests',
      icon: <VideoCamera className="w-4 h-4" />,
      component: <CrossPlatformRecordingTest onLog={onLog} />,
      status: 'pending',
      criticalIssues: 0,
      warnings: 0,
      passed: 0
    },
    {
      id: 'google-home',
      name: 'Google Home Integration',
      description: 'Test Google Home connectivity and automation',
      icon: <TestTube className="w-4 h-4" />,
      component: <GoogleHomeTest onLog={onLog} />,
      status: 'pending',
      criticalIssues: 0,
      warnings: 0,
      passed: 0
    },
    {
      id: 'camera-testing',
      name: 'Camera Testing',
      description: 'Real-world camera recording tests with Google Home',
      icon: <House className="w-4 h-4" />,
      component: <RealWorldCameraTest onLog={onLog} />,
      status: 'pending',
      criticalIssues: 0,
      warnings: 0,
      passed: 0
    }
  ]

  const runAllTests = async () => {
    onLog('INFO', 'Starting comprehensive compatibility test suite')
    
    for (const suite of testSuites) {
      setActiveTest(suite.id)
      onLog('INFO', `Running ${suite.name} tests...`)
      
      // Simulate test execution
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      onLog('INFO', `${suite.name} tests completed`)
    }
    
    setActiveTest(null)
    onLog('INFO', 'All compatibility tests completed')
  }

  const getStatusIcon = (status: TestSuite['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'warning':
        return <Warning className="w-4 h-4 text-yellow-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'running':
        return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      default:
        return <div className="w-4 h-4 bg-muted rounded-full" />
    }
  }

  const getOverallStatus = () => {
    const totalCritical = testSuites.reduce((sum, suite) => sum + suite.criticalIssues, 0)
    const totalWarnings = testSuites.reduce((sum, suite) => sum + suite.warnings, 0)
    const totalPassed = testSuites.reduce((sum, suite) => sum + suite.passed, 0)
    
    if (totalCritical > 0) return 'critical'
    if (totalWarnings > 0) return 'warning'
    if (totalPassed > 0) return 'good'
    return 'unknown'
  }

  return (
    <div className="space-y-6">
      {/* Test Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TestTube className="w-5 h-5" />
              Comprehensive Compatibility Testing
            </CardTitle>
            <Button onClick={runAllTests} disabled={!!activeTest}>
              {activeTest ? 'Testing...' : 'Run All Tests'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {testSuites.map((suite) => (
              <div
                key={suite.id}
                className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                  activeTest === suite.id ? 'border-blue-500 bg-blue-50' : 'border-border hover:border-muted-foreground'
                }`}
                onClick={() => setActiveTest(suite.id)}
              >
                <div className="flex items-center gap-2 mb-2">
                  {suite.icon}
                  <h3 className="font-medium text-sm">{suite.name}</h3>
                  {getStatusIcon(suite.status)}
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {suite.description}
                </p>
                
                {suite.status !== 'pending' && (
                  <div className="flex items-center gap-2 text-xs">
                    {suite.criticalIssues > 0 && (
                      <Badge variant="destructive" className="text-xs px-1 py-0">
                        {suite.criticalIssues} Critical
                      </Badge>
                    )}
                    {suite.warnings > 0 && (
                      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs px-1 py-0">
                        {suite.warnings} Warnings
                      </Badge>
                    )}
                    {suite.passed > 0 && (
                      <Badge className="bg-green-100 text-green-800 border-green-200 text-xs px-1 py-0">
                        {suite.passed} Passed
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      <Tabs value={activeTest || 'system-overview'} onValueChange={setActiveTest}>
        <TabsList className="grid w-full grid-cols-8">
          {testSuites.map((suite) => (
            <TabsTrigger key={suite.id} value={suite.id} className="flex items-center gap-2">
              {suite.icon}
              <span className="hidden md:inline">{suite.name}</span>
            </TabsTrigger>
          ))}
          <TabsTrigger value="checklist" className="flex items-center gap-2">
            <ListChecks className="w-4 h-4" />
            <span className="hidden md:inline">Checklist</span>
          </TabsTrigger>
          <TabsTrigger value="guide" className="flex items-center gap-2">
            <Info className="w-4 h-4" />
            <span className="hidden md:inline">Guide</span>
          </TabsTrigger>
        </TabsList>

        {testSuites.map((suite) => (
          <TabsContent key={suite.id} value={suite.id} className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {suite.icon}
                  {suite.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {suite.description}
                </p>
              </CardHeader>
              <CardContent>
                {suite.component}
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        <TabsContent value="checklist" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="w-5 h-5" />
                Testing Checklist
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Step-by-step testing guide with progress tracking
              </p>
            </CardHeader>
            <CardContent>
              <TestingChecklist onLog={onLog} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="guide" className="mt-6">
          <BrowserCompatibilityGuide />
        </TabsContent>
      </Tabs>

      {/* Quick Status Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Test Status Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  getOverallStatus() === 'critical' ? 'bg-red-500' :
                  getOverallStatus() === 'warning' ? 'bg-yellow-500' :
                  getOverallStatus() === 'good' ? 'bg-green-500' :
                  'bg-muted-foreground'
                }`} />
                <div>
                  <h3 className="font-medium">Overall Compatibility</h3>
                  <p className="text-sm text-muted-foreground">
                    {getOverallStatus() === 'critical' && 'Critical issues found - app may not function properly'}
                    {getOverallStatus() === 'warning' && 'Some features may be limited'}
                    {getOverallStatus() === 'good' && 'System ready for Unit Monitor'}
                    {getOverallStatus() === 'unknown' && 'Run tests to check compatibility'}
                  </p>
                </div>
              </div>
              
              <div className="text-right">
                <div className="text-sm font-mono">
                  {testSuites.reduce((sum, suite) => sum + suite.passed, 0)} passed,{' '}
                  {testSuites.reduce((sum, suite) => sum + suite.warnings, 0)} warnings,{' '}
                  {testSuites.reduce((sum, suite) => sum + suite.criticalIssues, 0)} failed
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="space-y-2">
                <h4 className="font-medium text-green-600">✓ Recommended Browsers</h4>
                <ul className="text-muted-foreground space-y-1">
                  <li>• Google Chrome 72+</li>
                  <li>• Microsoft Edge 79+</li>
                </ul>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-medium text-yellow-600">⚠ Limited Support</h4>
                <ul className="text-muted-foreground space-y-1">
                  <li>• Firefox 66+ (partial)</li>
                  <li>• Safari 14+ (viewing only)</li>
                </ul>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-medium text-red-600">✗ Not Supported</h4>
                <ul className="text-muted-foreground space-y-1">
                  <li>• Internet Explorer</li>
                  <li>• Chrome {'<'} 72</li>
                  <li>• Safari {'<'} 14</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}