import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Progress } from '@/progress'
import { 
  CheckCircle, 
  XCircle, 
  Warning, 
  Info,
  Play,
  DownloadSimple,
  Camera,
  Monitor,
  Globe
} from '@phosphor-icons/react'

interface TestSummaryProps {
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void
}

interface SystemCheck {
  name: string
  status: 'checking' | 'passed' | 'failed' | 'warning'
  message: string
  critical: boolean
}

export function TestSummary({ onLog }: TestSummaryProps) {
  const [systemChecks, setSystemChecks] = useState<SystemCheck[]>([])
  const [overallStatus, setOverallStatus] = useState<'checking' | 'ready' | 'issues' | 'failed'>('checking')
  const [runningChecks, setRunningChecks] = useState(false)

  const checks: Array<{name: string, test: () => Promise<SystemCheck>, critical: boolean}> = [
    {
      name: 'Screen Capture Support',
      critical: true,
      test: async () => {
        try {
          const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
          return {
            name: 'Screen Capture Support',
            status: supported ? 'passed' : 'failed',
            message: supported 
              ? 'Browser supports screen capture API' 
              : 'Screen capture not supported - try Chrome or Edge',
            critical: true
          }
        } catch (error) {
          return {
            name: 'Screen Capture Support',
            status: 'failed',
            message: 'Error checking screen capture support',
            critical: true
          }
        }
      }
    },
    {
      name: 'MediaRecorder Support',
      critical: true,
      test: async () => {
        try {
          const supported = typeof MediaRecorder !== 'undefined'
          if (!supported) {
            return {
              name: 'MediaRecorder Support',
              status: 'failed',
              message: 'MediaRecorder not available',
              critical: true
            }
          }

          const formats = ['video/webm', 'video/mp4']
          const supportedFormats = formats.filter(f => MediaRecorder.isTypeSupported(f))
          
          return {
            name: 'MediaRecorder Support',
            status: supportedFormats.length > 0 ? 'passed' : 'warning',
            message: `Supported formats: ${supportedFormats.join(', ') || 'Limited format support'}`,
            critical: true
          }
        } catch (error) {
          return {
            name: 'MediaRecorder Support',
            status: 'failed',
            message: 'Error checking MediaRecorder support',
            critical: true
          }
        }
      }
    },
    {
      name: 'Browser Compatibility',
      critical: false,
      test: async () => {
        const userAgent = navigator.userAgent.toLowerCase()
        let browserName = 'Unknown'
        let rating = 'warning'
        let message = 'Unknown browser - compatibility not guaranteed'

        if (userAgent.includes('chrome') && !userAgent.includes('edge')) {
          browserName = 'Chrome'
          rating = 'passed'
          message = 'Excellent compatibility - all features supported'
        } else if (userAgent.includes('edge')) {
          browserName = 'Edge'
          rating = 'passed'
          message = 'Good compatibility - most features supported'
        } else if (userAgent.includes('firefox')) {
          browserName = 'Firefox'
          rating = 'warning'
          message = 'Limited screen capture support'
        } else if (userAgent.includes('safari')) {
          browserName = 'Safari'
          rating = 'warning'
          message = 'Minimal support - consider using Chrome or Edge'
        }

        return {
          name: 'Browser Compatibility',
          status: rating as any,
          message: `${browserName}: ${message}`,
          critical: false
        }
      }
    },
    {
      name: 'Local Storage',
      critical: false,
      test: async () => {
        try {
          const testKey = 'unit-monitor-test'
          localStorage.setItem(testKey, 'test')
          const retrieved = localStorage.getItem(testKey)
          localStorage.removeItem(testKey)
          
          return {
            name: 'Local Storage',
            status: retrieved === 'test' ? 'passed' : 'warning',
            message: retrieved === 'test' 
              ? 'Settings and preferences will be saved' 
              : 'Settings may not persist between sessions',
            critical: false
          }
        } catch (error) {
          return {
            name: 'Local Storage',
            status: 'warning',
            message: 'Storage may be limited - settings may not persist',
            critical: false
          }
        }
      }
    },
    {
      name: 'Network Connectivity',
      critical: false,
      test: async () => {
        try {
          const online = navigator.onLine
          if (!online) {
            return {
              name: 'Network Connectivity',
              status: 'warning',
              message: 'Offline - Google Home will not be accessible',
              critical: false
            }
          }

          // Test if we can reach Google Home
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 5000)
          
          try {
            await fetch('https://home.google.com', {
              method: 'HEAD',
              mode: 'no-cors',
              signal: controller.signal
            })
            clearTimeout(timeoutId)
            
            return {
              name: 'Network Connectivity',
              status: 'passed',
              message: 'Online - Google Home should be accessible',
              critical: false
            }
          } catch (fetchError) {
            clearTimeout(timeoutId)
            return {
              name: 'Network Connectivity',
              status: 'warning',
              message: 'Network available but Google Home may be blocked',
              critical: false
            }
          }
        } catch (error) {
          return {
            name: 'Network Connectivity',
            status: 'warning',
            message: 'Cannot determine network status',
            critical: false
          }
        }
      }
    },
    {
      name: 'Performance Check',
      critical: false,
      test: async () => {
        const memory = (performance as any).memory
        const cores = navigator.hardwareConcurrency || 1
        
        let message = `${cores} CPU cores detected`
        let status: 'passed' | 'warning' | 'failed' = 'passed'
        
        if (memory) {
          const memMB = Math.round(memory.jsHeapSizeLimit / 1024 / 1024)
          message += `, ~${memMB}MB memory available`
          
          if (memMB < 512) {
            status = 'warning'
            message += ' - May affect recording quality'
          } else if (memMB < 256) {
            status = 'failed'
            message += ' - Insufficient memory for high-quality recording'
          }
        }
        
        if (cores < 2) {
          status = 'warning'
          message += ' - Single core may affect performance'
        }

        return {
          name: 'Performance Check',
          status,
          message,
          critical: false
        }
      }
    }
  ]

  const runAllChecks = async () => {
    setRunningChecks(true)
    setSystemChecks([])
    onLog('INFO', 'Running system compatibility checks...')

    const results: SystemCheck[] = []
    
    for (const { name, test, critical } of checks) {
      // Set as checking
      setSystemChecks(prev => [...prev, {
        name,
        status: 'checking',
        message: 'Checking...',
        critical
      }])

      try {
        const result = await test()
        results.push(result)
        
        setSystemChecks(prev => prev.map(check => 
          check.name === name ? result : check
        ))

        onLog(
          result.status === 'failed' ? 'ERROR' : 
          result.status === 'warning' ? 'WARNING' : 'INFO',
          `${name}: ${result.message}`
        )
      } catch (error: any) {
        const errorResult: SystemCheck = {
          name,
          status: 'failed',
          message: `Test failed: ${error.message}`,
          critical
        }
        results.push(errorResult)
        
        setSystemChecks(prev => prev.map(check => 
          check.name === name ? errorResult : check
        ))

        onLog('ERROR', `${name}: Test failed - ${error.message}`)
      }

      // Small delay between checks
      await new Promise(resolve => setTimeout(resolve, 300))
    }

    // Determine overall status
    const criticalFailures = results.filter(r => r.critical && r.status === 'failed')
    const criticalWarnings = results.filter(r => r.critical && r.status === 'warning')
    const anyFailures = results.filter(r => r.status === 'failed')

    let overall: typeof overallStatus = 'ready'
    if (criticalFailures.length > 0) {
      overall = 'failed'
    } else if (criticalWarnings.length > 0 || anyFailures.length > 0) {
      overall = 'issues'
    }

    setOverallStatus(overall)
    setRunningChecks(false)

    const summary = `System check complete: ${results.filter(r => r.status === 'passed').length}/${results.length} passed`
    onLog('INFO', summary)
  }

  useEffect(() => {
    // Run checks on mount
    runAllChecks()
  }, [])

  const getStatusIcon = (status: SystemCheck['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'warning':
        return <Warning className="w-4 h-4 text-yellow-500" />
      case 'checking':
        return <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    }
  }

  const getOverallStatusColor = () => {
    switch (overallStatus) {
      case 'ready': return 'text-green-600'
      case 'issues': return 'text-yellow-600'
      case 'failed': return 'text-red-600'
      default: return 'text-muted-foreground'
    }
  }

  const getOverallStatusText = () => {
    switch (overallStatus) {
      case 'checking': return 'Checking system compatibility...'
      case 'ready': return 'System ready for Google Home recording'
      case 'issues': return 'System functional with some limitations'
      case 'failed': return 'Critical issues detected - recording may not work'
    }
  }

  const passedChecks = systemChecks.filter(c => c.status === 'passed').length
  const totalChecks = systemChecks.length

  return (
    <div className="space-y-6">
      {/* Overall Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            System Compatibility Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className={`font-medium ${getOverallStatusColor()}`}>
                {getOverallStatusText()}
              </p>
              {totalChecks > 0 && (
                <div className="flex items-center gap-2">
                  <Progress value={(passedChecks / totalChecks) * 100} className="w-48" />
                  <span className="text-sm text-muted-foreground">
                    {passedChecks}/{totalChecks} checks passed
                  </span>
                </div>
              )}
            </div>
            <Button 
              onClick={runAllChecks} 
              disabled={runningChecks}
              variant="outline"
              className="gap-2"
            >
              {runningChecks ? (
                <>
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Re-run Checks
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Results */}
      {systemChecks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detailed Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {systemChecks.map((check, index) => (
                <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                  {getStatusIcon(check.status)}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium">{check.name}</h4>
                      {check.critical && (
                        <Badge variant="outline" className="text-xs">Critical</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{check.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Next Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-500" />
            Next Steps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {overallStatus === 'ready' && (
            <div className="bg-green-50 border border-green-200 rounded p-3">
              <h4 className="font-medium text-green-800 mb-2">✅ Ready to Record!</h4>
              <ol className="text-sm text-green-700 space-y-1">
                <li>1. Set up your recording preferences in the Settings tab</li>
                <li>2. Navigate to Google Home and login to your account</li>
                <li>3. Open your camera feeds and start recording</li>
                <li>4. Use the Test tabs to verify functionality</li>
              </ol>
            </div>
          )}

          {overallStatus === 'issues' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
              <h4 className="font-medium text-yellow-800 mb-2">⚠️ Some Issues Detected</h4>
              <p className="text-sm text-yellow-700 mb-2">
                The system will work but you may experience limitations:
              </p>
              <ul className="text-sm text-yellow-700 space-y-1">
                <li>• Check failed tests above for specific issues</li>
                <li>• Consider switching to Chrome or Edge for better support</li>
                <li>• Run individual tests to verify functionality</li>
                <li>• Some features may have reduced performance</li>
              </ul>
            </div>
          )}

          {overallStatus === 'failed' && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <h4 className="font-medium text-red-800 mb-2">❌ Critical Issues Found</h4>
              <p className="text-sm text-red-700 mb-2">
                Recording functionality may not work properly:
              </p>
              <ul className="text-sm text-red-700 space-y-1">
                <li>• Try using Chrome or Edge browser</li>
                <li>• Check if screen recording is enabled in browser settings</li>
                <li>• Ensure you're not in private/incognito mode</li>
                <li>• Update your browser to the latest version</li>
              </ul>
            </div>
          )}

          <div className="text-xs text-muted-foreground space-y-1">
            <p>• Use the Screen Recording tab to test recording functionality</p>
            <p>• Use the Google Home tab to test camera detection</p>
            <p>• Check the Testing Guide for comprehensive instructions</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}