import { useState, useEffect } from 'react'
import { useKV, isDemoEnabled } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Switch } from "@/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Progress } from "@/progress"
import { Separator } from "@/separator"
import { PermissionsManager } from "@/PermissionsManager"
import {
  Gear,
  Bell,
  Envelope,
  Clock,
  Warning,
  Info,
  CheckCircle,
  WifiHigh,
  WifiSlash,
  ChatCircle,
  Phone,
  CalendarBlank,
  Target,
  Lightning,
  Trophy,
  ChartBar,
  Users,
  UsersThree,
  UsersFour,
  UserPlus,
  UserCircle,
  UserGear,
  Funnel,
  Tag,
  Percent,
  Rocket,
  Sparkle,
  Code,
  Database,
  Globe,
  Shield,
  Lock,
  Key,
  Cloud,
  DeviceMobile,
  SpeakerHigh,
  SpeakerSlash,
  MoonStars,
  SunDim
} from '@phosphor-icons/react'
import { toast } from 'sonner'

interface GlobalGear {
  notifications: {
    inApp: boolean
    email: boolean
    sms: boolean
    whatsapp: boolean
    sound: boolean
    desktop: boolean
  }
  appearance: {
    theme: 'light' | 'dark' | 'auto'
    compactMode: boolean
    animations: boolean
    fontSize: 'small' | 'medium' | 'large'
  }
  privacy: {
    dataCollection: boolean
    analyticsSharing: boolean
    cookieConsent: boolean
    activityTracking: boolean
  }
  performance: {
    realtimeUpdates: boolean
    backgroundSync: boolean
    cacheEnabled: boolean
    dataSaver: boolean
  }
  security: {
    twoFactorEnabled: boolean
    sessionTimeout: number // minutes
    ipRestriction: boolean
    auditLogs: boolean
  }
  integrations: {
    webhooks: boolean
    apiAccess: boolean
    thirdPartyApps: boolean
    dataExport: boolean
  }
}

interface AlertConfiguration {
  id: string
  category: string
  name: string
  description: string
  enabled: boolean
  severity: 'low' | 'medium' | 'high' | 'critical'
  channels: string[]
  frequency: 'immediate' | 'hourly' | 'daily' | 'weekly'
  conditions: {
    threshold?: number
    operator?: 'above' | 'below' | 'equals'
    timeframe?: string
  }
}

export function SystemGear() {
  const [settings, setGear] = useKV<GlobalGear>('system-settings', {
    notifications: {
      inApp: true,
      email: true,
      sms: false,
      whatsapp: true,
      sound: true,
      desktop: true
    },
    appearance: {
      theme: 'light',
      compactMode: false,
      animations: true,
      fontSize: 'medium'
    },
    privacy: {
      dataCollection: true,
      analyticsSharing: false,
      cookieConsent: true,
      activityTracking: true
    },
    performance: {
      realtimeUpdates: true,
      backgroundSync: true,
      cacheEnabled: true,
      dataSaver: false
    },
    security: {
      twoFactorEnabled: false,
      sessionTimeout: 480, // 8 hours
      ipRestriction: false,
      auditLogs: true
    },
    integrations: {
      webhooks: true,
      apiAccess: true,
      thirdPartyApps: false,
      dataExport: true
    }
  })

  const [alertConfigs, setAlertConfigs] = useKV<AlertConfiguration[]>('alert-configurations', [
    {
      id: '1',
      category: 'Performance',
      name: 'Slow Response Time',
      description: 'Alert when average response time exceeds threshold',
      enabled: true,
      severity: 'high',
      channels: ['in-app', 'email'],
      frequency: 'immediate',
      conditions: {
        threshold: 2,
        operator: 'above',
        timeframe: '5 minutes'
      }
    },
    {
      id: '2',
      category: 'Sales',
      name: 'Low Conversion Rate',
      description: 'Alert when conversion rate drops below expected',
      enabled: true,
      severity: 'medium',
      channels: ['in-app', 'email'],
      frequency: 'daily',
      conditions: {
        threshold: 20,
        operator: 'below',
        timeframe: '24 hours'
      }
    },
    {
      id: '3',
      category: 'System',
      name: 'High Error Rate',
      description: 'Alert when system error rate is elevated',
      enabled: true,
      severity: 'critical',
      channels: ['in-app', 'email', 'sms'],
      frequency: 'immediate',
      conditions: {
        threshold: 5,
        operator: 'above',
        timeframe: '1 minute'
      }
    },
    {
      id: '4',
      category: 'Customer',
      name: 'Churn Risk',
      description: 'Alert when customer churn risk is detected',
      enabled: true,
      severity: 'high',
      channels: ['in-app', 'whatsapp'],
      frequency: 'immediate',
      conditions: {
        threshold: 80,
        operator: 'above',
        timeframe: 'real-time'
      }
    }
  ])

  const [systemStatus, setSystemStatus] = useState({
    api: 'operational',
    database: 'operational',
    integrations: 'operational',
    notifications: 'operational'
  })

  const updateGear = (section: keyof GlobalGear, key: string, value: any) => {
    setGear((prev: GlobalGear) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }))
    toast.success("Configuração atualizada")
  }

  const toggleAlertConfig = (alertId: string) => {
    setAlertConfigs((prev: AlertConfiguration[]) => prev.map(config =>
      config.id === alertId
        ? { ...config, enabled: !config.enabled }
        : config
    ))
  }

  const updateAlertChannels = (alertId: string, channel: string, enabled: boolean) => {
    setAlertConfigs((prev: AlertConfiguration[]) => prev.map(config => {
      if (config.id === alertId) {
        const channels = enabled
          ? [...config.channels, channel]
          : config.channels.filter(c => c !== channel)
        return { ...config, channels }
      }
      return config
    }))
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'operational':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'warning':
        return <Warning className="h-4 w-4 text-yellow-500" />
      case 'error':
        return <Warning className="h-4 w-4 text-red-500" />
      default:
        return <Info className="h-4 w-4 text-blue-500" />
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'critical': return 'bg-red-100 text-red-800 border-red-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const demoEnabled = isDemoEnabled()

  // Simulate system monitoring
  useEffect(() => {
    if (!demoEnabled) return
    const interval = setInterval(() => {
      // Randomly update system status for demo
      const statuses = ['operational', 'warning', 'error']
      const components = ['api', 'database', 'integrations', 'notifications']

      if (Math.random() > 0.95) { // 5% chance of status change
        const component = components[Math.floor(Math.random() * components.length)]
        const status = Math.random() > 0.8 ? 'warning' : 'operational'

        setSystemStatus(prev => ({
          ...prev,
          [component]: status
        }))
      }
    }, 10000)

    return () => clearInterval(interval)
  }, [demoEnabled])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Gear className="h-6 w-6 text-accent" />
            <span>Configurações do Sistema</span>
          </h2>
          <p className="text-muted-foreground">
            Gerencie preferências globais, alertas e monitoramento do sistema
          </p>
        </div>
      </div>

      <Tabs defaultValue="notifications" className="space-y-6">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="notifications">Notificações</TabsTrigger>
          <TabsTrigger value="appearance">Aparência</TabsTrigger>
          <TabsTrigger value="privacy">Privacidade</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
          <TabsTrigger value="permissions">Permissões</TabsTrigger>
          <TabsTrigger value="system">Sistema</TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="space-y-6">
          {/* Global Notification Gear */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Bell className="h-5 w-5" />
                <span>Configurações Globais</span>
              </CardTitle>
              <CardDescription>
                Configure como e quando receber notificações do sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Bell className="h-4 w-4" />
                      <span>Notificações no App</span>
                    </div>
                    <Switch
                      checked={settings.notifications.inApp}
                      onCheckedChange={(checked) => updateGear('notifications', 'inApp', checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Envelope className="h-4 w-4" />
                      <span>Notificações por Email</span>
                    </div>
                    <Switch
                      checked={settings.notifications.email}
                      onCheckedChange={(checked) => updateGear('notifications', 'email', checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <DeviceMobile className="h-4 w-4" />
                      <span>Notificações por SMS</span>
                    </div>
                    <Switch
                      checked={settings.notifications.sms}
                      onCheckedChange={(checked) => updateGear('notifications', 'sms', checked)}
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <ChatCircle className="h-4 w-4" />
                      <span>Notificações WhatsApp</span>
                    </div>
                    <Switch
                      checked={settings.notifications.whatsapp}
                      onCheckedChange={(checked) => updateGear('notifications', 'whatsapp', checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {settings.notifications.sound ? <SpeakerHigh className="h-4 w-4" /> : <SpeakerSlash className="h-4 w-4" />}
                      <span>Sons de Notificação</span>
                    </div>
                    <Switch
                      checked={settings.notifications.sound}
                      onCheckedChange={(checked) => updateGear('notifications', 'sound', checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Bell className="h-4 w-4" />
                      <span>Notificações Desktop</span>
                    </div>
                    <Switch
                      checked={settings.notifications.desktop}
                      onCheckedChange={(checked) => updateGear('notifications', 'desktop', checked)}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Alert Configurations */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Configuração de Alertas Específicos</CardTitle>
              <CardDescription>
                Configure alertas individuais por categoria e severidade
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {alertConfigs.map((config) => (
                  <div key={config.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Switch
                          checked={config.enabled}
                          onCheckedChange={() => toggleAlertConfig(config.id)}
                        />
                        <div>
                          <h4 className="font-medium">{config.name}</h4>
                          <p className="text-sm text-muted-foreground">{config.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline">{config.category}</Badge>
                        <Badge className={getSeverityColor(config.severity)}>
                          {config.severity.toUpperCase()}
                        </Badge>
                      </div>
                    </div>

                    {config.enabled && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t">
                        <div>
                          <span className="text-sm font-medium">Canais:</span>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {['in-app', 'email', 'sms', 'whatsapp'].map((channel) => (
                              <label key={channel} className="flex items-center space-x-1 text-sm">
                                <input
                                  type="checkbox"
                                  checked={config.channels.includes(channel)}
                                  onChange={(e) => updateAlertChannels(config.id, channel, e.target.checked)}
                                  className="rounded"
                                />
                                <span className="capitalize">{channel}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-sm font-medium">Frequência:</span>
                          <div className="flex items-center space-x-2 mt-1">
                            <Clock className="h-4 w-4" />
                            <span className="text-sm">{config.frequency}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                {settings.appearance.theme === 'dark' ? <MoonStars className="h-5 w-5" /> : <SunDim className="h-5 w-5" />}
                <span>Aparência e Interface</span>
              </CardTitle>
              <CardDescription>
                Personalize a aparência e comportamento da interface
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Tema</h4>
                    <div className="space-y-2">
                      {['light', 'dark', 'auto'].map((theme) => (
                        <label key={theme} className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name="theme"
                            value={theme}
                            checked={settings.appearance.theme === theme}
                            onChange={(e) => updateGear('appearance', 'theme', e.target.value)}
                          />
                          <span className="capitalize">{theme}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Tamanho da Fonte</h4>
                    <div className="space-y-2">
                      {['small', 'medium', 'large'].map((size) => (
                        <label key={size} className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name="fontSize"
                            value={size}
                            checked={settings.appearance.fontSize === size}
                            onChange={(e) => updateGear('appearance', 'fontSize', e.target.value)}
                          />
                          <span className="capitalize">{size}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span>Modo Compacto</span>
                    <Switch
                      checked={settings.appearance.compactMode}
                      onCheckedChange={(checked) => updateGear('appearance', 'compactMode', checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Animações</span>
                    <Switch
                      checked={settings.appearance.animations}
                      onCheckedChange={(checked) => updateGear('appearance', 'animations', checked)}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="privacy" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="h-5 w-5" />
                <span>Privacidade e Dados</span>
              </CardTitle>
              <CardDescription>
                Controle como seus dados são coletados e utilizados
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Coleta de Dados</span>
                    <p className="text-sm text-muted-foreground">Permite coleta de dados para melhorar a experiência</p>
                  </div>
                  <Switch
                    checked={settings.privacy.dataCollection}
                    onCheckedChange={(checked) => updateGear('privacy', 'dataCollection', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Compartilhamento de Analytics</span>
                    <p className="text-sm text-muted-foreground">Compartilha dados anônimos de uso</p>
                  </div>
                  <Switch
                    checked={settings.privacy.analyticsSharing}
                    onCheckedChange={(checked) => updateGear('privacy', 'analyticsSharing', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Rastreamento de Atividade</span>
                    <p className="text-sm text-muted-foreground">Registra atividades para auditoria</p>
                  </div>
                  <Switch
                    checked={settings.privacy.activityTracking}
                    onCheckedChange={(checked) => updateGear('privacy', 'activityTracking', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Consentimento de Cookies</span>
                    <p className="text-sm text-muted-foreground">Solicita consentimento para cookies</p>
                  </div>
                  <Switch
                    checked={settings.privacy.cookieConsent}
                    onCheckedChange={(checked) => updateGear('privacy', 'cookieConsent', checked)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <WifiHigh className="h-5 w-5" />
                <span>Performance e Sincronização</span>
              </CardTitle>
              <CardDescription>
                Otimize a performance e uso de dados da aplicação
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Atualizações em Tempo Real</span>
                    <p className="text-sm text-muted-foreground">Sincroniza dados automaticamente</p>
                  </div>
                  <Switch
                    checked={settings.performance.realtimeUpdates}
                    onCheckedChange={(checked) => updateGear('performance', 'realtimeUpdates', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Sincronização em Background</span>
                    <p className="text-sm text-muted-foreground">Mantém dados atualizados em segundo plano</p>
                  </div>
                  <Switch
                    checked={settings.performance.backgroundSync}
                    onCheckedChange={(checked) => updateGear('performance', 'backgroundSync', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Cache Habilitado</span>
                    <p className="text-sm text-muted-foreground">Armazena dados localmente para acesso rápido</p>
                  </div>
                  <Switch
                    checked={settings.performance.cacheEnabled}
                    onCheckedChange={(checked) => updateGear('performance', 'cacheEnabled', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Modo Economia de Dados</span>
                    <p className="text-sm text-muted-foreground">Reduz o uso de dados móveis</p>
                  </div>
                  <Switch
                    checked={settings.performance.dataSaver}
                    onCheckedChange={(checked) => updateGear('performance', 'dataSaver', checked)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="h-5 w-5" />
                <span>Segurança</span>
              </CardTitle>
              <CardDescription>
                Configure opções de segurança e autenticação
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Autenticação de Dois Fatores</span>
                    <p className="text-sm text-muted-foreground">Adiciona uma camada extra de segurança</p>
                  </div>
                  <Switch
                    checked={settings.security.twoFactorEnabled}
                    onCheckedChange={(checked) => updateGear('security', 'twoFactorEnabled', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Restrição por IP</span>
                    <p className="text-sm text-muted-foreground">Limita acesso a IPs específicos</p>
                  </div>
                  <Switch
                    checked={settings.security.ipRestriction}
                    onCheckedChange={(checked) => updateGear('security', 'ipRestriction', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Logs de Auditoria</span>
                    <p className="text-sm text-muted-foreground">Registra todas as atividades do sistema</p>
                  </div>
                  <Switch
                    checked={settings.security.auditLogs}
                    onCheckedChange={(checked) => updateGear('security', 'auditLogs', checked)}
                  />
                </div>

                <div className="space-y-2">
                  <span className="font-medium">Timeout da Sessão: {settings.security.sessionTimeout} minutos</span>
                  <div className="space-y-2">
                    <Progress value={(settings.security.sessionTimeout / 960) * 100} className="w-full" />
                    <input
                      type="range"
                      min="60"
                      max="960"
                      step="60"
                      value={settings.security.sessionTimeout}
                      onChange={(e) => updateGear('security', 'sessionTimeout', Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1h</span>
                      <span>16h</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-6">
          {/* System Status */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Database className="h-5 w-5" />
                <span>Status do Sistema</span>
              </CardTitle>
              <CardDescription>
                Monitoramento em tempo real dos componentes do sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(systemStatus).map(([component, status]) => (
                  <div key={component} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(status)}
                      <span className="capitalize font-medium">{component}</span>
                    </div>
                    <Badge variant={status === 'operational' ? 'default' : 'destructive'}>
                      {status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Integration Gear */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Globe className="h-5 w-5" />
                <span>Integrações e APIs</span>
              </CardTitle>
              <CardDescription>
                Configure conexões externas e acesso à API
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Webhooks</span>
                    <p className="text-sm text-muted-foreground">Permite recebimento de eventos externos</p>
                  </div>
                  <Switch
                    checked={settings.integrations.webhooks}
                    onCheckedChange={(checked) => updateGear('integrations', 'webhooks', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Acesso à API</span>
                    <p className="text-sm text-muted-foreground">Habilita acesso programático via API</p>
                  </div>
                  <Switch
                    checked={settings.integrations.apiAccess}
                    onCheckedChange={(checked) => updateGear('integrations', 'apiAccess', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Apps de Terceiros</span>
                    <p className="text-sm text-muted-foreground">Permite conexão com aplicações externas</p>
                  </div>
                  <Switch
                    checked={settings.integrations.thirdPartyApps}
                    onCheckedChange={(checked) => updateGear('integrations', 'thirdPartyApps', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">Exportação de Dados</span>
                    <p className="text-sm text-muted-foreground">Permite exportar dados do sistema</p>
                  </div>
                  <Switch
                    checked={settings.integrations.dataExport}
                    onCheckedChange={(checked) => updateGear('integrations', 'dataExport', checked)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions">
          <PermissionsManager />
        </TabsContent>
      </Tabs>
    </div>
  )
}
