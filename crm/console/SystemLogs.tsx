import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { ScrollArea } from '@/scroll-area'
import { Badge } from '@/badge'
import { Terminal } from '@phosphor-icons/react'

interface LogEntry {
  id: string
  timestamp: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'STATUS'
  message: string
}

interface SystemLogsProps {
  logs: LogEntry[]
}

export function SystemLogs({ logs }: SystemLogsProps) {
  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'ERROR': return 'text-red-600 border-red-200'
      case 'WARNING': return 'text-orange-600 border-orange-200'
      case 'INFO': return 'text-blue-600 border-blue-200'
      case 'STATUS': return 'text-green-600 border-green-200'
      default: return 'text-gray-600 border-gray-200'
    }
  }

  const getLevelVariant = (level: LogEntry['level']): "default" | "secondary" | "destructive" | "outline" => {
    switch (level) {
      case 'ERROR': return 'destructive'
      case 'WARNING': return 'secondary'
      case 'STATUS': return 'default'
      default: return 'outline'
    }
  }

  return (
    <Card className="h-64">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Terminal className="w-4 h-4" />
          System Logs
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-48">
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="text-xs border-l-2 border-muted pl-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-muted-foreground font-mono text-xs">
                    {log.timestamp}
                  </span>
                  <Badge 
                    variant={getLevelVariant(log.level)}
                    className={`text-xs px-1 py-0 ${getLevelColor(log.level)}`}
                  >
                    {log.level}
                  </Badge>
                </div>
                <p className="text-xs font-mono leading-relaxed break-words text-foreground/90">
                  {log.message}
                </p>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Terminal className="w-6 h-6 mx-auto mb-2 opacity-50" />
                <p className="text-xs">No logs yet</p>
                <p className="text-xs opacity-75">Activity will appear here</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}