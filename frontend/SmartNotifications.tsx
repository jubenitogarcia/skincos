import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Switch } from "@/switch"
import {
  Bell,
  BellRinging,
  Robot,
  Target,
  TrendUp,
  TrendDown,
  Clock,
  Users,
  Lightbulb,
  Warning,
  CheckCircle,
  X,
  Gear,
  CalendarBlank,
  ChatCircle,
  PhoneCall,
  Trophy,
  Star
} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface SmartNotification {
  id: string
  type: 'coaching' | 'performance' | 'achievement' | 'reminder' | 'opportunity' | 'warning'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  title: string
  message: string
  actionable: boolean
  action?: {
    type: 'view' | 'complete' | 'schedule' | 'contact'
    label: string
    data?: any
  }
  isRead: boolean
  createdAt: string
  scheduledFor?: string
  aiGenerated: boolean
  tags: string[]
}

interface NotificationGear {
  enableAICoaching: boolean
  enablePerformanceAlerts: boolean
  enableAchievementNotifications: boolean
  enableOpportunityAlerts: boolean
  quietHoursStart: string
  quietHoursEnd: string
  aiInsightFrequency: 'real-time' | 'hourly' | 'daily' | 'weekly'
  performanceThreshold: number
}

export function SmartNotifications() {
  const [notifications, setNotifications] = useKV<SmartNotification[]>('smart-notifications', [
    {
      id: '1',
      type: 'coaching',
      priority: 'high',
      title: 'Oportunidade de Melhoria Detectada',
      message: 'IA identificou que suas calls entre 14h-16h têm 34% mais taxa de conversão. Considere reorganizar sua agenda.',
      actionable: true,
      action: {
        type: 'schedule',
        label: 'Reorganizar Agenda'
      },
      isRead: false,
      createdAt: new Date().toISOString(),
      aiGenerated: true,
      tags: ['agenda', 'conversão', 'otimização']
    },
    {
      id: '2',
      type: 'performance',
      priority: 'medium',
      title: 'Meta Semanal Próxima',
      message: 'Você está a 3 calls da sua meta semanal de 50 calls. Continue assim!',
      actionable: true,
      action: {
        type: 'view',
        label: 'Ver Pipeline'
      },
      isRead: false,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      aiGenerated: false,
      tags: ['meta', 'calls', 'progresso']
    },
    {
      id: '3',
      type: 'achievement',
      priority: 'low',
      title: 'Nova Conquista Desbloqueada!',
      message: 'Parabéns! Você desbloqueou a conquista "Maratonista" por manter 10 dias de streak.',
      actionable: false,
      isRead: false,
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      aiGenerated: false,
      tags: ['conquista', 'streak', 'gamificação']
    },
    {
      id: '4',
      type: 'opportunity',
      priority: 'urgent',
      title: 'Lead Quente Detectado',
      message: 'Cliente TechCorp demonstrou alto interesse. Score de propensão: 94%. Recomendado contato imediato.',
      actionable: true,
      action: {
        type: 'contact',
        label: 'Contatar Agora',
        data: { customerId: 'tech-corp-123' }
      },
      isRead: false,
      createdAt: new Date(Date.now() - 1800000).toISOString(),
      aiGenerated: true,
      tags: ['lead', 'oportunidade', 'urgente']
    },
    {
      id: '5',
      type: 'warning',
      priority: 'medium',
      title: 'Cliente em Risco de Churn',
      message: 'Maria Silva não teve interações há 15 dias. IA sugere follow-up imediato para reativação.',
      actionable: true,
      action: {
        type: 'contact',
        label: 'Agendar Follow-up'
      },
      isRead: true,
      createdAt: new Date(Date.now() - 10800000).toISOString(),
      aiGenerated: true,
      tags: ['churn', 'retenção', 'follow-up']
    }
  ])

  const [settings, setGear] = useKV<NotificationGear>('notification-settings', {
    enableAICoaching: true,
    enablePerformanceAlerts: true,
    enableAchievementNotifications: true,
    enableOpportunityAlerts: true,
    quietHoursStart: '18:00',
    quietHoursEnd: '08:00',
    aiInsightFrequency: 'real-time',
    performanceThreshold: 80
  })

  const [showGear, setShowGear] = useState(false)

  const markAsRead = (notificationId: string) => {
    setNotifications(current =>
      current.map(notification =>
        notification.id === notificationId
          ? { ...notification, isRead: true }
          : notification
      )
    )
  }

  const dismissNotification = (notificationId: string) => {
    setNotifications(current =>
      current.filter(notification => notification.id !== notificationId)
    )
  }

  const handleNotificationAction = (notification: SmartNotification) => {
    if (!notification.action) return

    switch (notification.action.type) {
      case 'schedule':
        toast.success('Redirecionando para agenda...')
        break
      case 'view':
        toast.success('Abrindo pipeline...')
        break
      case 'contact':
        toast.success('Abrindo contato do cliente...')
        break
      case 'complete':
        toast.success('Ação concluída!')
        break
    }

    markAsRead(notification.id)
  }

  const generateAINotification = async () => {
    const newNotification: SmartNotification = {
      id: Date.now().toString(),
      type: 'coaching',
      priority: 'medium',
      title: 'Padrão Comportamental Identificado',
      message: 'IA detectou que você converte 45% mais quando usa storytelling. Considere incorporar mais histórias nas suas apresentações.',
      actionable: true,
      action: {
        type: 'view',
        label: 'Ver Análise Completa'
      },
      isRead: false,
      createdAt: new Date().toISOString(),
      aiGenerated: true,
      tags: ['storytelling', 'conversão', 'técnica']
    }

    setNotifications(current => [newNotification, ...current])
    toast.success('Nova recomendação IA disponível!')
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'coaching': return <Robot className="h-5 w-5 text-blue-500" />
      case 'performance': return <TrendUp className="h-5 w-5 text-green-500" />
      case 'achievement': return <Trophy className="h-5 w-5 text-yellow-500" />
      case 'reminder': return <Clock className="h-5 w-5 text-orange-500" />
      case 'opportunity': return <Target className="h-5 w-5 text-purple-500" />
      case 'warning': return <Warning className="h-5 w-5 text-red-500" />
      default: return <Bell className="h-5 w-5 text-muted-foreground" />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'border-red-500 bg-red-50'
      case 'high': return 'border-orange-500 bg-orange-50'
      case 'medium': return 'border-blue-500 bg-blue-50'
      case 'low': return 'border-gray-300 bg-gray-50'
      default: return 'border-gray-300 bg-white'
    }
  }

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent': return <Badge className="bg-red-100 text-red-800">Urgente</Badge>
      case 'high': return <Badge className="bg-orange-100 text-orange-800">Alta</Badge>
      case 'medium': return <Badge className="bg-blue-100 text-blue-800">Média</Badge>
      case 'low': return <Badge className="bg-gray-100 text-gray-800">Baixa</Badge>
      default: return null
    }
  }

  const unreadCount = notifications.filter(n => !n.isRead).length
  const sortedNotifications = [...notifications].sort((a, b) => {
    // Primeiro por não lidas
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1
    // Depois por prioridade
    const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 }
    return priorityOrder[b.priority] - priorityOrder[a.priority]
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <BellRinging className="h-6 w-6 text-accent" />
            <span>Central de Notificações Inteligentes</span>
            {unreadCount > 0 && (
              <Badge className="bg-red-500 text-white">{unreadCount}</Badge>
            )}
          </h2>
          <p className="text-muted-foreground">
            Alertas personalizados e recomendações de IA para otimizar sua performance
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={() => setShowGear(!showGear)}>
            <Gear className="h-4 w-4 mr-2" />
            Configurações
          </Button>
          <Button onClick={generateAINotification}>
            <Robot className="h-4 w-4 mr-2" />
            Gerar Insight IA
          </Button>
        </div>
      </div>

      {/* Gear Panel */}
      {showGear && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Configurações de Notificações</CardTitle>
            <CardDescription>Personalize como você recebe alertas e recomendações</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="font-semibold">Tipos de Notificação</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm">Coaching com IA</label>
                    <Switch
                      checked={settings.enableAICoaching}
                      onCheckedChange={(checked) =>
                        setGear(prev => ({ ...prev, enableAICoaching: checked }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm">Alertas de Performance</label>
                    <Switch
                      checked={settings.enablePerformanceAlerts}
                      onCheckedChange={(checked) =>
                        setGear(prev => ({ ...prev, enablePerformanceAlerts: checked }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm">Conquistas</label>
                    <Switch
                      checked={settings.enableAchievementNotifications}
                      onCheckedChange={(checked) =>
                        setGear(prev => ({ ...prev, enableAchievementNotifications: checked }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm">Oportunidades</label>
                    <Switch
                      checked={settings.enableOpportunityAlerts}
                      onCheckedChange={(checked) =>
                        setGear(prev => ({ ...prev, enableOpportunityAlerts: checked }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-semibold">Frequência de Insights IA</h4>
                <select
                  value={settings.aiInsightFrequency}
                  onChange={(e) =>
                    setGear(prev => ({ ...prev, aiInsightFrequency: e.target.value as any }))
                  }
                  className="w-full px-3 py-2 border rounded-md bg-background"
                >
                  <option value="real-time">Tempo Real</option>
                  <option value="hourly">A cada Hora</option>
                  <option value="daily">Diário</option>
                  <option value="weekly">Semanal</option>
                </select>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Limite de Performance (%)</label>
                  <input
                    type="number"
                    value={settings.performanceThreshold}
                    onChange={(e) =>
                      setGear(prev => ({ ...prev, performanceThreshold: parseInt(e.target.value) }))
                    }
                    className="w-full px-3 py-2 border rounded-md bg-background"
                    min="0"
                    max="100"
                  />
                  <p className="text-xs text-muted-foreground">
                    Receber alertas quando performance cair abaixo deste valor
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notifications List */}
      <div className="space-y-4">
        {sortedNotifications.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="text-center py-12">
              <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhuma notificação</h3>
              <p className="text-muted-foreground">
                Você está em dia! Novas notificações aparecerão aqui.
              </p>
            </CardContent>
          </Card>
        ) : (
          sortedNotifications.map((notification) => (
            <Card
              key={notification.id}
              className={`glass-card border-l-4 transition-all hover:shadow-md ${getPriorityColor(notification.priority)} ${!notification.isRead ? 'shadow-sm' : 'opacity-75'
                }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    {getNotificationIcon(notification.type)}
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <CardTitle className="text-base">{notification.title}</CardTitle>
                        {!notification.isRead && (
                          <div className="w-2 h-2 bg-accent rounded-full"></div>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 mb-2">
                        {getPriorityBadge(notification.priority)}
                        {notification.aiGenerated && (
                          <Badge variant="outline" className="text-xs">
                            <Robot className="h-3 w-3 mr-1" />
                            IA
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(notification.createdAt).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissNotification(notification.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{notification.message}</p>

                {notification.tags.length > 0 && (
                  <div className="flex items-center space-x-1 flex-wrap">
                    {notification.tags.map((tag, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  {notification.actionable && notification.action && (
                    <Button
                      size="sm"
                      onClick={() => handleNotificationAction(notification)}
                    >
                      {notification.action.label}
                    </Button>
                  )}
                  {!notification.isRead && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => markAsRead(notification.id)}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Marcar como Lida
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Robot className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-sm font-medium">Insights IA</p>
                <p className="text-lg font-bold">
                  {notifications.filter(n => n.aiGenerated && !n.isRead).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Warning className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-sm font-medium">Urgentes</p>
                <p className="text-lg font-bold">
                  {notifications.filter(n => n.priority === 'urgent' && !n.isRead).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Target className="h-4 w-4 text-purple-500" />
              <div>
                <p className="text-sm font-medium">Oportunidades</p>
                <p className="text-lg font-bold">
                  {notifications.filter(n => n.type === 'opportunity' && !n.isRead).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Trophy className="h-4 w-4 text-yellow-500" />
              <div>
                <p className="text-sm font-medium">Conquistas</p>
                <p className="text-lg font-bold">
                  {notifications.filter(n => n.type === 'achievement').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
