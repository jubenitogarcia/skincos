import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Bell,
  Warning,
  CheckCircle,
  Trash,
  Plus,
  Gear,
  TrendDown,
  TrendUp,
  Clock,
  Target,
  Users,
  CurrencyDollar,
  ChartBar,
  Envelope,
  ChatCircle,
  DeviceMobile
} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface Alert {
  id: string
  title: string
  description: string
  metric: string
  condition: 'above' | 'below' | 'equals'
  threshold: number
  severity: 'low' | 'medium' | 'high' | 'critical'
  isActive: boolean
  channels: ('email' | 'sms' | 'in-app' | 'whatsapp')[]
  frequency: 'immediate' | 'hourly' | 'daily'
  createdAt: string
  lastTriggered?: string
  triggeredCount: number
}

interface AlertRule {
  id: string
  name: string
  description: string
  metric: string
  currentValue: number
  threshold: number
  condition: 'above' | 'below' | 'equals'
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'normal' | 'warning' | 'critical'
  trend: 'up' | 'down' | 'stable'
  lastCheckCircleed: string
}

interface NotificationHistory {
  id: string
  alertId: string
  alertTitle: string
  message: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  channels: string[]
  timestamp: string
  acknowledged: boolean
}

export function AlertsCenter() {
  const [alerts, setAlerts] = useKV<Alert[]>('performance-alerts', [])
  const [notifications, setNotifications] = useKV<NotificationHistory[]>('alert-notifications', [])
  const [alertRules, setAlertRules] = useState<AlertRule[]>([
    {
      id: '1',
      name: 'Taxa de Conversão Baixa',
      description: 'Pipeline de vendas com conversão abaixo do esperado',
      metric: 'conversion_rate',
      currentValue: 18.5,
      threshold: 25,
      condition: 'below',
      severity: 'high',
      status: 'warning',
      trend: 'down',
      lastCheckCircleed: new Date().toISOString()
    },
    {
      id: '2',
      name: 'Tempo de Resposta Alto',
      description: 'Agentes demorando mais que 2 horas para responder',
      metric: 'response_time',
      currentValue: 145,
      threshold: 120,
      condition: 'above',
      severity: 'medium',
      status: 'warning',
      trend: 'up',
      lastCheckCircleed: new Date().toISOString()
    },
    {
      id: '3',
      name: 'NPS Crítico',
      description: 'Net Promoter Score abaixo de 30',
      metric: 'nps_score',
      currentValue: 65,
      threshold: 30,
      condition: 'below',
      severity: 'critical',
      status: 'normal',
      trend: 'stable',
      lastCheckCircleed: new Date().toISOString()
    },
    {
      id: '4',
      name: 'Churn Rate Elevado',
      description: 'Taxa de cancelamento acima de 5%',
      metric: 'churn_rate',
      currentValue: 3.2,
      threshold: 5,
      condition: 'above',
      severity: 'high',
      status: 'normal',
      trend: 'down',
      lastCheckCircleed: new Date().toISOString()
    },
    {
      id: '5',
      name: 'Receita Mensal Baixa',
      description: 'MRR abaixo da meta estabelecida',
      metric: 'monthly_revenue',
      currentValue: 145000,
      threshold: 150000,
      condition: 'below',
      severity: 'high',
      status: 'warning',
      trend: 'up',
      lastCheckCircleed: new Date().toISOString()
    }
  ])

  const [newAlert, setNewAlert] = useState<Partial<Alert>>({
    title: '',
    description: '',
    metric: '',
    condition: 'below',
    threshold: 0,
    severity: 'medium',
    isActive: true,
    channels: ['in-app'],
    frequency: 'immediate'
  })

  // Simulate real-time monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      // CheckCircle alert rules and trigger notifications
      alertRules.forEach(rule => {
        const shouldTrigger = checkAlertCondition(rule)
        if (shouldTrigger && rule.status === 'warning') {
          triggerAlert(rule)
        }
      })
    }, 30000) // CheckCircle every 30 seconds

    return () => clearInterval(interval)
  }, [alertRules])

  const checkAlertCondition = (rule: AlertRule): boolean => {
    switch (rule.condition) {
      case 'above':
        return rule.currentValue > rule.threshold
      case 'below':
        return rule.currentValue < rule.threshold
      case 'equals':
        return rule.currentValue === rule.threshold
      default:
        return false
    }
  }

  const triggerAlert = (rule: AlertRule) => {
    const notification: NotificationHistory = {
      id: Date.now().toString(),
      alertId: rule.id,
      alertTitle: rule.name,
      message: `${rule.description} - Valor atual: ${rule.currentValue}`,
      severity: rule.severity,
      channels: ['in-app', 'email'],
      timestamp: new Date().toISOString(),
      acknowledged: false
    }

    setNotifications(prev => [notification, ...prev])

    // Show toast notification
    toast.error(`🚨 ${rule.name}`, {
      description: rule.description,
      action: {
        label: "Ver Detalhes",
        onClick: () => console.log("Alert details")
      }
    })
  }

  const createAlert = () => {
    if (!newAlert.title || !newAlert.metric || !newAlert.threshold) {
      toast.error("Preencha todos os campos obrigatórios")
      return
    }

    const alert: Alert = {
      id: Date.now().toString(),
      title: newAlert.title!,
      description: newAlert.description || '',
      metric: newAlert.metric!,
      condition: newAlert.condition!,
      threshold: newAlert.threshold!,
      severity: newAlert.severity!,
      isActive: newAlert.isActive!,
      channels: newAlert.channels!,
      frequency: newAlert.frequency!,
      createdAt: new Date().toISOString(),
      triggeredCount: 0
    }

    setAlerts(prev => [...prev, alert])
    setNewAlert({
      title: '',
      description: '',
      metric: '',
      condition: 'below',
      threshold: 0,
      severity: 'medium',
      isActive: true,
      channels: ['in-app'],
      frequency: 'immediate'
    })

    toast.success("Alerta criado com sucesso!")
  }

  const deleteAlert = (alertId: string) => {
    setAlerts(prev => prev.filter(alert => alert.id !== alertId))
    toast.success("Alerta removido")
  }

  const toggleAlert = (alertId: string) => {
    setAlerts(prev => prev.map(alert =>
      alert.id === alertId
        ? { ...alert, isActive: !alert.isActive }
        : alert
    ))
  }

  const acknowledgeNotification = (notificationId: string) => {
    setNotifications(prev => prev.map(notification =>
      notification.id === notificationId
        ? { ...notification, acknowledged: true }
        : notification
    ))
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'low': return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'critical': return 'text-red-600 bg-red-50 border-red-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getStatusIcon = (status: string, trend: string) => {
    if (status === 'critical') return <Warning className="h-5 w-5 text-red-500" />
    if (status === 'warning') return <Warning className="h-5 w-5 text-yellow-500" />
    if (trend === 'up') return <TrendUp className="h-5 w-5 text-green-500" />
    if (trend === 'down') return <TrendDown className="h-5 w-5 text-red-500" />
    return <CheckCircle className="h-5 w-5 text-green-500" />
  }

  const getMetricIcon = (metric: string) => {
    switch (metric) {
      case 'conversion_rate': return <Target className="h-4 w-4" />
      case 'response_time': return <Clock className="h-4 w-4" />
      case 'nps_score': return <ChartBar className="h-4 w-4" />
      case 'churn_rate': return <Users className="h-4 w-4" />
      case 'monthly_revenue': return <CurrencyDollar className="h-4 w-4" />
      default: return <ChartBar className="h-4 w-4" />
    }
  }

  const formatValue = (metric: string, value: number) => {
    switch (metric) {
      case 'conversion_rate':
      case 'churn_rate':
        return `${value}%`
      case 'response_time':
        return `${value} min`
      case 'monthly_revenue':
        return `R$ ${(value / 1000).toFixed(0)}K`
      default:
        return value.toString()
    }
  }

  const unacknowledgedCount = notifications.filter(n => !n.acknowledged).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Bell className="h-6 w-6 text-accent" />
            <span>Central de Alertas</span>
            {unacknowledgedCount > 0 && (
              <Badge variant="destructive" className="ml-2">
                {unacknowledgedCount}
              </Badge>
            )}
          </h2>
          <p className="text-muted-foreground">
            Monitoramento automático de métricas críticas de performance
          </p>
        </div>
        <Button onClick={() => setNewAlert({ ...newAlert })}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Alerta
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="rules">Regras Ativas</TabsTrigger>
          <TabsTrigger value="notifications">Notificações</TabsTrigger>
          <TabsTrigger value="settings">Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Key Metrics Status */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {alertRules.map((rule) => (
              <Card key={rule.id} className={`glass-card ${rule.status === 'warning' ? 'border-yellow-300' : ''}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getMetricIcon(rule.metric)}
                      <CardTitle className="text-sm font-medium">{rule.name}</CardTitle>
                    </div>
                    {getStatusIcon(rule.status, rule.trend)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold">
                        {formatValue(rule.metric, rule.currentValue)}
                      </span>
                      <Badge className={getSeverityColor(rule.severity)}>
                        {rule.severity.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <div>Meta: {formatValue(rule.metric, rule.threshold)}</div>
                      <div>Última verificação: {new Date(rule.lastCheckCircleed).toLocaleTimeString()}</div>
                    </div>
                    <p className="text-xs text-muted-foreground">{rule.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Recent Notifications */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Bell className="h-5 w-5" />
                <span>Notificações Recentes</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {notifications.slice(0, 5).map((notification) => (
                  <div
                    key={notification.id}
                    className={`flex items-start space-x-3 p-3 rounded-lg border ${notification.acknowledged ? 'bg-muted/50' : 'bg-background'
                      }`}
                  >
                    <div className={`w-2 h-2 rounded-full mt-2 ${getSeverityColor(notification.severity).split(' ')[0]} bg-current`}></div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">{notification.alertTitle}</h4>
                        <span className="text-xs text-muted-foreground">
                          {new Date(notification.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{notification.message}</p>
                      <div className="flex items-center space-x-2">
                        {notification.channels.map((channel) => (
                          <Badge key={channel} variant="outline" className="text-xs">
                            {channel === 'email' && <Envelope className="h-3 w-3 mr-1" />}
                            {channel === 'sms' && <DeviceMobile className="h-3 w-3 mr-1" />}
                            {channel === 'whatsapp' && <ChatCircle className="h-3 w-3 mr-1" />}
                            {channel === 'in-app' && <Bell className="h-3 w-3 mr-1" />}
                            {channel}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    {!notification.acknowledged && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => acknowledgeNotification(notification.id)}
                      >
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {notifications.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    Nenhuma notificação encontrada
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {alerts.map((alert) => (
              <Card key={alert.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <CardTitle className="text-lg">{alert.title}</CardTitle>
                      <Switch
                        checked={alert.isActive}
                        onCheckedChange={() => toggleAlert(alert.id)}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteAlert(alert.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                  {alert.description && (
                    <CardDescription>{alert.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="font-medium">Métrica:</span>
                        <div className="flex items-center space-x-1">
                          {getMetricIcon(alert.metric)}
                          <span>{alert.metric}</span>
                        </div>
                      </div>
                      <div>
                        <span className="font-medium">Condição:</span>
                        <div>{alert.condition} {alert.threshold}</div>
                      </div>
                      <div>
                        <span className="font-medium">Severidade:</span>
                        <Badge className={getSeverityColor(alert.severity)}>
                          {alert.severity}
                        </Badge>
                      </div>
                      <div>
                        <span className="font-medium">Frequência:</span>
                        <div>{alert.frequency}</div>
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-sm">Canais:</span>
                      <div className="flex space-x-1 mt-1">
                        {alert.channels.map((channel) => (
                          <Badge key={channel} variant="outline" className="text-xs">
                            {channel}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    {alert.triggeredCount > 0 && (
                      <div className="text-sm text-muted-foreground">
                        Disparado {alert.triggeredCount} vez(es)
                        {alert.lastTriggered && (
                          <div>Último disparo: {new Date(alert.lastTriggered).toLocaleString()}</div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <div className="space-y-4">
            {notifications.map((notification) => (
              <Card key={notification.id} className={`glass-card ${notification.acknowledged ? 'opacity-60' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start space-x-3">
                    <div className={`w-3 h-3 rounded-full mt-1 ${getSeverityColor(notification.severity).split(' ')[0]} bg-current`}></div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">{notification.alertTitle}</h4>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-muted-foreground">
                            {new Date(notification.timestamp).toLocaleString()}
                          </span>
                          {!notification.acknowledged && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => acknowledgeNotification(notification.id)}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Reconhecer
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-muted-foreground">{notification.message}</p>
                      <div className="flex items-center space-x-2">
                        <Badge className={getSeverityColor(notification.severity)}>
                          {notification.severity}
                        </Badge>
                        {notification.channels.map((channel) => (
                          <Badge key={channel} variant="outline" className="text-xs">
                            {channel}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {notifications.length === 0 && (
              <Card className="glass-card">
                <CardContent className="text-center py-12">
                  <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Nenhuma notificação</h3>
                  <p className="text-muted-foreground">
                    Todas as métricas estão dentro dos parâmetros esperados
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Plus className="h-5 w-5" />
                <span>Criar Novo Alerta</span>
              </CardTitle>
              <CardDescription>
                Configure alertas personalizados para métricas específicas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="alert-title">Título do Alerta</Label>
                  <Input
                    id="alert-title"
                    placeholder="Ex: Taxa de conversão baixa"
                    value={newAlert.title}
                    onChange={(e) => setNewAlert({ ...newAlert, title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alert-metric">Métrica</Label>
                  <Select value={newAlert.metric} onValueChange={(value) => setNewAlert({ ...newAlert, metric: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma métrica" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conversion_rate">Taxa de Conversão</SelectItem>
                      <SelectItem value="response_time">Tempo de Resposta</SelectItem>
                      <SelectItem value="nps_score">NPS Score</SelectItem>
                      <SelectItem value="churn_rate">Taxa de Churn</SelectItem>
                      <SelectItem value="monthly_revenue">Receita Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="alert-description">Descrição</Label>
                <Input
                  id="alert-description"
                  placeholder="Descrição detalhada do alerta"
                  value={newAlert.description}
                  onChange={(e) => setNewAlert({ ...newAlert, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Condição</Label>
                  <Select value={newAlert.condition} onValueChange={(value: any) => setNewAlert({ ...newAlert, condition: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="above">Acima de</SelectItem>
                      <SelectItem value="below">Abaixo de</SelectItem>
                      <SelectItem value="equals">Igual a</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alert-threshold">Valor Limite</Label>
                  <Input
                    id="alert-threshold"
                    type="number"
                    placeholder="0"
                    value={newAlert.threshold}
                    onChange={(e) => setNewAlert({ ...newAlert, threshold: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Severidade</Label>
                  <Select value={newAlert.severity} onValueChange={(value: any) => setNewAlert({ ...newAlert, severity: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="medium">Média</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                      <SelectItem value="critical">Crítica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <Label>Canais de Notificação</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {['in-app', 'email', 'sms', 'whatsapp'].map((channel) => (
                    <div key={channel} className="flex items-center space-x-2">
                      <Switch
                        checked={newAlert.channels?.includes(channel as any)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setNewAlert({
                              ...newAlert,
                              channels: [...(newAlert.channels || []), channel as any]
                            })
                          } else {
                            setNewAlert({
                              ...newAlert,
                              channels: newAlert.channels?.filter(c => c !== channel)
                            })
                          }
                        }}
                      />
                      <Label className="capitalize">{channel}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Frequência</Label>
                <Select value={newAlert.frequency} onValueChange={(value: any) => setNewAlert({ ...newAlert, frequency: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate">Imediata</SelectItem>
                    <SelectItem value="hourly">A cada hora</SelectItem>
                    <SelectItem value="daily">Diária</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={newAlert.isActive}
                  onCheckedChange={(checked) => setNewAlert({ ...newAlert, isActive: checked })}
                />
                <Label>Ativar alerta imediatamente</Label>
              </div>

              <Button onClick={createAlert} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Criar Alerta
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
