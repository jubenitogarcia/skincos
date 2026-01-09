import React, { useEffect } from 'react'
import { useNotifications } from '@/contexts'
import { Button } from "@/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { useKV } from '@/spark-mock'
import {
  Robot,
  Sparkle,
  Bell,
  Warning,
  Info
} from "@phosphor-icons/react"
import { getIcon } from '@/iconRegistry'
const CircleWavyCheck = getIcon('success')

function generateMockNotifications(count = 5) {
  const levels = ['info', 'success', 'warning', 'error'] as const
  return Array.from({ length: count }).map((_, i) => ({
    id: `mock-${Date.now()}-${i}`,
    title: `Mock Notification ${i + 1}`,
    message: 'This is a simulated notification.',
    level: levels[i % levels.length],
    createdAt: new Date().toISOString()
  }))
}

export function NotificationTester() {
  const { notifications, unreadCount, isConnected } = useNotifications()

  // Generate mock notifications for demonstration
  const generateTestNotifications = () => {
    generateMockNotifications()
  }

  // Auto-generate notifications on component mount for demo
  useEffect(() => {
    const timer = setTimeout(() => {
      generateMockNotifications()
    }, 3000) // Generate after 3 seconds

    return () => clearTimeout(timer)
  }, [])

  return (
    <Card className="mb-6 border-accent/20 bg-accent/5">
      <CardHeader>
        <div className="flex items-center space-x-2">
          <Robot className="h-5 w-5 text-accent" />
          <CardTitle>Sistema de Notificações em Tempo Real</CardTitle>
          <Badge variant={isConnected ? "default" : "destructive"}>
            {isConnected ? "Conectado" : "Desconectado"}
          </Badge>
        </div>
        <CardDescription>
          Sistema WebSocket ativo para notificações push instantâneas
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center space-x-3 p-3 bg-background rounded-lg border">
            <div className="p-2 bg-green-100 rounded-lg">
              <CircleWavyCheck className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="font-medium text-sm">WebSocket Ativo</p>
              <p className="text-xs text-muted-foreground">
                Conexão em tempo real estabelecida
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 bg-background rounded-lg border">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Bell className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="font-medium text-sm">Notificações Ativas</p>
              <p className="text-xs text-muted-foreground">
                {unreadCount} não lidas de {notifications.length} total
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 bg-background rounded-lg border">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Sparkle className="h-4 w-4 text-purple-600" />
            </div>
            <div>
              <p className="font-medium text-sm">Push Notifications</p>
              <p className="text-xs text-muted-foreground">
                Browser e in-app habilitadas
              </p>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">Teste de Notificações</h4>
            <Button
              onClick={generateTestNotifications}
              size="sm"
              className="bg-accent hover:bg-accent/90"
            >
              <Sparkle className="h-4 w-4 mr-2" />
              Gerar Notificações de Teste
            </Button>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center space-x-2">
              <Info className="h-4 w-4 text-blue-500" />
              <span>As notificações aparecem automaticamente no centro de notificações</span>
            </div>
            <div className="flex items-center space-x-2">
              <Warning className="h-4 w-4 text-orange-500" />
              <span>Notificações críticas são exibidas como browser notifications</span>
            </div>
            <div className="flex items-center space-x-2">
              <Robot className="h-4 w-4 text-purple-500" />
              <span>IA classifica automaticamente prioridade e categoria</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
