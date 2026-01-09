import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Badge } from '@/badge'
import { Checkbox } from '@/checkbox'
import { ScrollArea } from '@/scroll-area'
import { Progress } from '@/progress'
import { 
  CheckCircle, 
  XCircle, 
  Info,
  Download,
  Play,
  Camera,
  Globe,
  Shield,
  Monitor
} from '@phosphor-icons/react'

interface ChecklistItem {
  id: string
  category: 'setup' | 'browser' | 'recording' | 'integration' | 'cleanup'
  title: string
  description: string
  importance: 'critical' | 'important' | 'optional'
  completed: boolean
  notes?: string
}

interface TestingChecklistProps {
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR', message: string) => void
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  // Setup Phase
  {
    id: 'browser-check',
    category: 'setup',
    title: 'Verify Browser Compatibility',
    description: 'Run browser compatibility tests to ensure all APIs are supported',
    importance: 'critical',
    completed: false,
    notes: 'Use Chrome 72+ or Edge 79+ for best results'
  },
  {
    id: 'permissions-setup',
    category: 'setup', 
    title: 'Grant Required Permissions',
    description: 'Allow camera, microphone, and screen sharing permissions',
    importance: 'critical',
    completed: false,
    notes: 'Browser will prompt for permissions during first use'
  },
  {
    id: 'recording-folder',
    category: 'setup',
    title: 'Configure Recording Folder',
    description: 'Set a default folder for saving recorded videos',
    importance: 'important',
    completed: false,
    notes: 'Ensure adequate disk space is available'
  },
  {
    id: 'quality-settings',
    category: 'setup',
    title: 'Adjust Quality Settings',
    description: 'Configure recording quality and format preferences',
    importance: 'optional',
    completed: false,
    notes: 'Higher quality requires more storage space'
  },

  // Browser Testing
  {
    id: 'screen-capture-api',
    category: 'browser',
    title: 'Test Screen Capture API',
    description: 'Verify getDisplayMedia API is available and working',
    importance: 'critical',
    completed: false,
    notes: 'Critical for recording functionality'
  },
  {
    id: 'media-recorder-api',
    category: 'browser',
    title: 'Test MediaRecorder API',
    description: 'Check video recording capabilities and codec support',
    importance: 'critical',
    completed: false,
    notes: 'WebM format has widest support'
  },
  {
    id: 'local-storage',
    category: 'browser',
    title: 'Verify Local Storage',
    description: 'Test that settings and preferences can be saved',
    importance: 'important',
    completed: false,
    notes: 'Required for saving favorites and settings'
  },
  {
    id: 'permissions-api',
    category: 'browser',
    title: 'Check Permissions API',
    description: 'Verify browser can query permission states',
    importance: 'optional',
    completed: false,
    notes: 'Enhances user experience but not required'
  },

  // Recording Tests
  {
    id: 'manual-recording',
    category: 'recording',
    title: 'Test Manual Recording',
    description: 'Start and stop recording manually, verify video output',
    importance: 'critical',
    completed: false,
    notes: 'Record for 5-10 seconds and check video quality'
  },
  {
    id: 'auto-recording',
    category: 'recording',
    title: 'Test Auto Recording',
    description: 'Enable auto-record and verify it triggers when video is detected',
    importance: 'important',
    completed: false,
    notes: 'Should start automatically when video player is visible'
  },
  {
    id: 'recording-formats',
    category: 'recording',
    title: 'Test Different Formats',
    description: 'Try recording in both WebM and MP4 formats',
    importance: 'optional',
    completed: false,
    notes: 'WebM typically has better browser support'
  },
  {
    id: 'recording-quality',
    category: 'recording',
    title: 'Test Quality Settings',
    description: 'Record at different quality levels and compare results',
    importance: 'optional',
    completed: false,
    notes: 'Higher quality = larger file sizes'
  },

  // Google Home Integration
  {
    id: 'google-login',
    category: 'integration',
    title: 'Test Google Home Login',
    description: 'Login to Google Home and verify authentication status',
    importance: 'critical',
    completed: false,
    notes: 'May require 2FA authentication'
  },
  {
    id: 'camera-navigation',
    category: 'integration',
    title: 'Test Camera Navigation',
    description: 'Navigate to camera feeds manually and verify video playback',
    importance: 'critical',
    completed: false,
    notes: 'Ensure cameras are accessible and streaming'
  },
  {
    id: 'favorites-creation',
    category: 'integration',
    title: 'Create Camera Favorites',
    description: 'Add cameras to favorites list and test quick access',
    importance: 'important',
    completed: false,
    notes: 'Saves time for repeated camera access'
  },
  {
    id: 'automation-scripts',
    category: 'integration',
    title: 'Test Automation Scripts',
    description: 'Verify automated camera selection and navigation works',
    importance: 'important',
    completed: false,
    notes: 'May need adjustment for interface changes'
  },

  // Cleanup & Verification
  {
    id: 'video-playback',
    category: 'cleanup',
    title: 'Verify Recorded Videos',
    description: 'Play back recorded videos to ensure quality and completeness',
    importance: 'important',
    completed: false,
    notes: 'Check audio sync and video clarity'
  },
  {
    id: 'storage-management',
    category: 'cleanup',
    title: 'Check Storage Usage',
    description: 'Monitor disk usage and plan for long-term storage needs',
    importance: 'optional',
    completed: false,
    notes: 'Videos can consume significant storage space'
  },
  {
    id: 'settings-persistence',
    category: 'cleanup',
    title: 'Verify Settings Persistence',
    description: 'Refresh browser and verify settings are maintained',
    importance: 'important',
    completed: false,
    notes: 'Settings should survive browser restarts'
  },
  {
    id: 'error-handling',
    category: 'cleanup',
    title: 'Test Error Scenarios',
    description: 'Test behavior when network fails or permissions are revoked',
    importance: 'optional',
    completed: false,
    notes: 'Application should handle errors gracefully'
  }
]

export function TestingChecklist({ onLog }: TestingChecklistProps) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>(CHECKLIST_ITEMS)
  const [activeCategory, setActiveCategory] = useState<string>('setup')

  const updateChecklistItem = (id: string, completed: boolean) => {
    setChecklist(prev => prev.map(item => 
      item.id === id ? { ...item, completed } : item
    ))
    
    const item = checklist.find(i => i.id === id)
    if (item) {
      onLog('INFO', `${completed ? 'Completed' : 'Unchecked'}: ${item.title}`)
    }
  }

  const getCompletionStats = () => {
    const total = checklist.length
    const completed = checklist.filter(item => item.completed).length
    const critical = checklist.filter(item => item.importance === 'critical').length
    const criticalCompleted = checklist.filter(item => 
      item.importance === 'critical' && item.completed
    ).length
    
    return {
      total,
      completed,
      critical,
      criticalCompleted,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      criticalPercentage: critical > 0 ? Math.round((criticalCompleted / critical) * 100) : 0
    }
  }

  const getCategoryStats = (category: string) => {
    const categoryItems = checklist.filter(item => item.category === category)
    const completed = categoryItems.filter(item => item.completed).length
    return {
      total: categoryItems.length,
      completed,
      percentage: categoryItems.length > 0 ? Math.round((completed / categoryItems.length) * 100) : 0
    }
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'setup':
        return <Monitor className="w-4 h-4" />
      case 'browser':
        return <Globe className="w-4 h-4" />
      case 'recording':
        return <Camera className="w-4 h-4" />
      case 'integration':
        return <Play className="w-4 h-4" />
      case 'cleanup':
        return <CheckCircle className="w-4 h-4" />
      default:
        return <Info className="w-4 h-4" />
    }
  }

  const getCategoryTitle = (category: string) => {
    switch (category) {
      case 'setup':
        return 'Initial Setup'
      case 'browser':
        return 'Browser Compatibility'
      case 'recording':
        return 'Recording Functions'
      case 'integration':
        return 'Google Home Integration'
      case 'cleanup':
        return 'Verification & Cleanup'
      default:
        return category
    }
  }

  const getImportanceBadge = (importance: ChecklistItem['importance']) => {
    switch (importance) {
      case 'critical':
        return <Badge variant="destructive" className="text-xs">Critical</Badge>
      case 'important':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs">Important</Badge>
      case 'optional':
        return <Badge variant="outline" className="text-xs">Optional</Badge>
    }
  }

  const generateReport = () => {
    const stats = getCompletionStats()
    const report = `
Unit Monitor Testing Report
Generated: ${new Date().toLocaleString()}

Overall Progress: ${stats.completed}/${stats.total} (${stats.percentage}%)
Critical Items: ${stats.criticalCompleted}/${stats.critical} (${stats.criticalPercentage}%)

Test Results by Category:
${Object.entries(
  checklist.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {} as Record<string, ChecklistItem[]>)
).map(([category, items]) => {
  const categoryStats = getCategoryStats(category)
  return `
${getCategoryTitle(category)}: ${categoryStats.completed}/${categoryStats.total} (${categoryStats.percentage}%)
${items.map(item => 
  `  ${item.completed ? '✓' : '✗'} ${item.title} [${item.importance}]`
).join('\n')}`
}).join('\n')}

Recommendations:
${stats.criticalPercentage < 100 ? 
  '- Complete all critical tests before using Unit Monitor in production' : 
  '- All critical tests passed - Unit Monitor ready for use'}
${stats.percentage < 80 ? 
  '- Consider completing additional tests for optimal experience' : 
  '- Testing comprehensive - application fully validated'}
    `.trim()

    // Create and download report
    const blob = new Blob([report], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `unit-monitor-testing-report-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    onLog('INFO', 'Testing report downloaded')
  }

  const stats = getCompletionStats()
  const categories = ['setup', 'browser', 'recording', 'integration', 'cleanup']

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Testing Progress</CardTitle>
            <Button onClick={generateReport} variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Download Report
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Overall Progress</span>
              <span className="font-mono">{stats.completed}/{stats.total}</span>
            </div>
            <Progress value={stats.percentage} className="w-full" />
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Critical Tests</span>
              <span className="font-mono">{stats.criticalCompleted}/{stats.critical}</span>
            </div>
            <Progress 
              value={stats.criticalPercentage} 
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-5 gap-2 pt-2">
            {categories.map(category => {
              const categoryStats = getCategoryStats(category)
              return (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`p-2 text-xs rounded border transition-colors ${
                    activeCategory === category 
                      ? 'border-primary bg-primary/10 text-primary' 
                      : 'border-border hover:border-muted-foreground'
                  }`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    {getCategoryIcon(category)}
                    <span className="truncate">{getCategoryTitle(category)}</span>
                  </div>
                  <div className="font-mono">
                    {categoryStats.completed}/{categoryStats.total}
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Checklist Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {getCategoryIcon(activeCategory)}
            {getCategoryTitle(activeCategory)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-96">
            <div className="space-y-3">
              {checklist
                .filter(item => item.category === activeCategory)
                .map(item => (
                  <div
                    key={item.id}
                    className={`p-4 border rounded-lg ${
                      item.completed ? 'border-green-200 bg-green-50' : 'border-border'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={item.id}
                        checked={item.completed}
                        onCheckedChange={(checked) => 
                          updateChecklistItem(item.id, checked as boolean)
                        }
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <label 
                            htmlFor={item.id} 
                            className={`font-medium cursor-pointer ${
                              item.completed ? 'line-through text-muted-foreground' : ''
                            }`}
                          >
                            {item.title}
                          </label>
                          {getImportanceBadge(item.importance)}
                          {item.completed && (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {item.description}
                        </p>
                        {item.notes && (
                          <p className="text-xs bg-muted p-2 rounded">
                            💡 {item.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Status Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Testing Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {stats.criticalPercentage === 100 ? (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <div>
                  <h4 className="font-medium text-green-900">Ready for Production</h4>
                  <p className="text-sm text-green-800">
                    All critical tests completed. Unit Monitor is ready for use.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <XCircle className="w-5 h-5 text-yellow-600" />
                <div>
                  <h4 className="font-medium text-yellow-900">Testing Required</h4>
                  <p className="text-sm text-yellow-800">
                    Complete critical tests before using Unit Monitor in production.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
                <div className="text-muted-foreground">Completed</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-yellow-600">
                  {checklist.filter(i => i.importance === 'important' && !i.completed).length}
                </div>
                <div className="text-muted-foreground">Important Remaining</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {checklist.filter(i => i.importance === 'critical' && !i.completed).length}
                </div>
                <div className="text-muted-foreground">Critical Remaining</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}