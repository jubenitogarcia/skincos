import { useState } from 'react'
import { useKV } from '@/spark-mock'
import { useNotifications } from '@/contexts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Input } from "@/input"
import { Label } from "@/label"
import { Switch } from "@/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Textarea } from "@/textarea"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/alert-dialog"
import { toast } from 'sonner'
import { ArrowsCounterClockwise as RefreshCw, FloppyDisk as Save, Gear, Shield, Envelope, Bell, Lightning, Globe, Database } from "@phosphor-icons/react"

interface SystemConfig {
  general: {
    companyName: string
    timezone: string
    dateFormat: string
    timeFormat: string
    currency: string
    language: string
    defaultCountry: string
    companyAddress: string
    companyPhone: string
    companyEmail: string
    companyWebsite: string
  }
  email: {
    mailDriver: string
    smtpHost: string
    smtpPort: number
    smtpUsername: string
    smtpPassword: string
    smtpEncryption: string
    fromName: string
    fromEmail: string
    replyToEmail: string
  }
  security: {
    passwordMinLength: number
    passwordRequireSpecialChars: boolean
    passwordRequireNumbers: boolean
    passwordRequireUppercase: boolean
    sessionTimeout: number
    maxLoginAttempts: number
    lockoutDuration: number
    twoFactorEnabled: boolean
    ipWhitelist: string[]
    allowedFileTypes: string[]
    maxFileSize: number
  }
  notifications: {
    emailNotifications: boolean
    pushNotifications: boolean
    smsNotifications: boolean
    slackIntegration: boolean
    notificationFrequency: string
    quietHoursStart: string
    quietHoursEnd: string
  }
  performance: {
    cacheEnabled: boolean
    cacheTimeout: number
    compressionEnabled: boolean
    minifyAssets: boolean
    cdnEnabled: boolean
    maxConcurrentUsers: number
    apiRateLimit: number
    enableQueryOptimization: boolean
  }
  integrations: object
  advanced: {
    debugMode: boolean
    logLevel: string
    maxLogFileSize: number
    logRetentionDays: number
    enableProfiling: boolean
    enableAnalytics: boolean
    maintenanceMode: boolean
  }
}

export function SystemConfiguration() {
  const { addNotification } = useNotifications()
  const [isLoading, setIsLoading] = useState(false)

  const [config, setConfig] = useKV<SystemConfig>("system-config", {
    general: {
      companyName: 'CRM Inteligente Ltda',
      timezone: 'America/Sao_Paulo',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '24h',
      currency: 'BRL',
      language: 'pt-BR',
      defaultCountry: 'BR',
      companyAddress: '',
      companyPhone: '',
      companyEmail: '',
      companyWebsite: ''
    },
    email: {
      mailDriver: 'smtp',
      smtpHost: '',
      smtpPort: 587,
      smtpUsername: '',
      smtpPassword: '',
      smtpEncryption: 'tls',
      fromName: '',
      fromEmail: '',
      replyToEmail: ''
    },
    security: {
      passwordMinLength: 8,
      passwordRequireSpecialChars: true,
      passwordRequireNumbers: true,
      passwordRequireUppercase: true,
      sessionTimeout: 480,
      maxLoginAttempts: 5,
      lockoutDuration: 15,
      twoFactorEnabled: false,
      ipWhitelist: [],
      allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx'],
      maxFileSize: 10
    },
    notifications: {
      emailNotifications: true,
      pushNotifications: true,
      smsNotifications: false,
      slackIntegration: false,
      notificationFrequency: 'realtime',
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00'
    },
    performance: {
      cacheEnabled: true,
      cacheTimeout: 3600,
      compressionEnabled: true,
      minifyAssets: true,
      cdnEnabled: false,
      maxConcurrentUsers: 1000,
      apiRateLimit: 1000,
      enableQueryOptimization: true
    },
    integrations: {},
    advanced: {
      debugMode: false,
      logLevel: 'warning',
      maxLogFileSize: 100,
      logRetentionDays: 30,
      enableProfiling: false,
      enableAnalytics: true,
      maintenanceMode: false
    }
  })

  const [hasChanges, setHasChanges] = useState(false)

  const updateConfig = (section: keyof SystemConfig, field: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }))
    setHasChanges(true)
  }

  const saveConfiguration = async () => {
    setIsLoading(true)
    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 2000))

      setHasChanges(false)
      toast.success('Configurações salvas com sucesso!')

      addNotification({
        title: 'Configurações Atualizadas',
        message: 'As configurações do sistema foram salvas com sucesso',
        type: 'success',
        priority: 'medium',
        category: 'system'
      })
    } catch (error) {
      toast.error('Erro ao salvar configurações')
    } finally {
      setIsLoading(false)
    }
  }

  const resetToDefaults = () => {
    // Reset configuration to defaults
    setConfig({
      general: {
        companyName: 'CRM Inteligente Ltda',
        timezone: 'America/Sao_Paulo',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '24h',
        currency: 'BRL',
        language: 'pt-BR',
        defaultCountry: 'BR',
        companyAddress: '',
        companyPhone: '',
        companyEmail: '',
        companyWebsite: ''
      },
      email: {
        mailDriver: 'smtp',
        smtpHost: '',
        smtpPort: 587,
        smtpUsername: '',
        smtpPassword: '',
        smtpEncryption: 'tls',
        fromName: '',
        fromEmail: '',
        replyToEmail: ''
      },
      security: {
        passwordMinLength: 8,
        passwordRequireSpecialChars: true,
        passwordRequireNumbers: true,
        passwordRequireUppercase: true,
        sessionTimeout: 480,
        maxLoginAttempts: 5,
        lockoutDuration: 15,
        twoFactorEnabled: false,
        ipWhitelist: [],
        allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'pdf'],
        maxFileSize: 10
      },
      notifications: {
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: false,
        slackIntegration: false,
        notificationFrequency: 'realtime',
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00'
      },
      performance: {
        cacheEnabled: true,
        cacheTimeout: 3600,
        compressionEnabled: true,
        minifyAssets: true,
        cdnEnabled: false,
        maxConcurrentUsers: 1000,
        apiRateLimit: 1000,
        enableQueryOptimization: true
      },
      integrations: {},
      advanced: {
        debugMode: false,
        logLevel: 'warning',
        maxLogFileSize: 100,
        logRetentionDays: 30,
        enableProfiling: false,
        enableAnalytics: true,
        maintenanceMode: false
      }
    })
    setHasChanges(true)
    toast.info('Configurações restauradas para padrão')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Configurações do Sistema</h2>
          <p className="text-muted-foreground">
            Configure todas as opções avançadas do sistema CRM
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {hasChanges && (
            <Badge variant="secondary" className="animate-pulse">
              Alterações não salvas
            </Badge>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Restaurar Padrões
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Restaurar Configurações Padrão</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação irá restaurar todas as configurações para os valores padrão.
                  Você perderá todas as personalizações feitas. Deseja continuar?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={resetToDefaults}>
                  Restaurar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            onClick={saveConfiguration}
            disabled={!hasChanges || isLoading}
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Salvar Configurações
          </Button>
        </div>
      </div>

      {/* Configuration Tabs */}
      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="email">E-mail</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
          <TabsTrigger value="notifications">Notificações</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
          <TabsTrigger value="advanced">Avançado</TabsTrigger>
        </TabsList>

        {/* General Gear */}
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Gear className="h-5 w-5" />
                <span>Configurações Gerais</span>
              </CardTitle>
              <CardDescription>
                Configurações básicas da empresa e localização
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="companyName">Nome da Empresa</Label>
                  <Input
                    id="companyName"
                    value={config.general.companyName}
                    onChange={(e) => updateConfig('general', 'companyName', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companyEmail">E-mail da Empresa</Label>
                  <Input
                    id="companyEmail"
                    type="email"
                    value={config.general.companyEmail}
                    onChange={(e) => updateConfig('general', 'companyEmail', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="companyPhone">Telefone da Empresa</Label>
                  <Input
                    id="companyPhone"
                    value={config.general.companyPhone}
                    onChange={(e) => updateConfig('general', 'companyPhone', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companyWebsite">Website da Empresa</Label>
                  <Input
                    id="companyWebsite"
                    value={config.general.companyWebsite}
                    onChange={(e) => updateConfig('general', 'companyWebsite', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="companyAddress">Endereço da Empresa</Label>
                <Textarea
                  id="companyAddress"
                  value={config.general.companyAddress}
                  onChange={(e) => updateConfig('general', 'companyAddress', e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>Fuso Horário</Label>
                  <Select
                    value={config.general.timezone}
                    onValueChange={(value) => updateConfig('general', 'timezone', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/Sao_Paulo">São Paulo (UTC-3)</SelectItem>
                      <SelectItem value="America/Manaus">Manaus (UTC-4)</SelectItem>
                      <SelectItem value="America/Rio_Branco">Rio Branco (UTC-5)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Formato de Data</Label>
                  <Select
                    value={config.general.dateFormat}
                    onValueChange={(value) => updateConfig('general', 'dateFormat', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                      <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Moeda</Label>
                  <Select
                    value={config.general.currency}
                    onValueChange={(value) => updateConfig('general', 'currency', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BRL">Real (BRL)</SelectItem>
                      <SelectItem value="USD">Dólar (USD)</SelectItem>
                      <SelectItem value="EUR">Euro (EUR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Gear */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="h-5 w-5" />
                <span>Configurações de Segurança</span>
              </CardTitle>
              <CardDescription>
                Políticas de senha e segurança do sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Comprimento Mínimo da Senha</Label>
                  <Input
                    type="number"
                    value={config.security.passwordMinLength}
                    onChange={(e) => updateConfig('security', 'passwordMinLength', parseInt(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Timeout de Sessão (minutos)</Label>
                  <Input
                    type="number"
                    value={config.security.sessionTimeout}
                    onChange={(e) => updateConfig('security', 'sessionTimeout', parseInt(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Requer Caracteres Especiais</Label>
                    <p className="text-sm text-muted-foreground">
                      Senhas devem conter pelo menos um caractere especial
                    </p>
                  </div>
                  <Switch
                    checked={config.security.passwordRequireSpecialChars}
                    onCheckedChange={(checked) => updateConfig('security', 'passwordRequireSpecialChars', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Requer Números</Label>
                    <p className="text-sm text-muted-foreground">
                      Senhas devem conter pelo menos um número
                    </p>
                  </div>
                  <Switch
                    checked={config.security.passwordRequireNumbers}
                    onCheckedChange={(checked) => updateConfig('security', 'passwordRequireNumbers', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Autenticação de Dois Fatores</Label>
                    <p className="text-sm text-muted-foreground">
                      Habilitar 2FA para todos os usuários
                    </p>
                  </div>
                  <Switch
                    checked={config.security.twoFactorEnabled}
                    onCheckedChange={(checked) => updateConfig('security', 'twoFactorEnabled', checked)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance Gear */}
        <TabsContent value="performance">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Lightning className="h-5 w-5" />
                <span>Configurações de Performance</span>
              </CardTitle>
              <CardDescription>
                Otimizações de cache e performance do sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Cache Habilitado</Label>
                    <p className="text-sm text-muted-foreground">
                      Melhorar performance com sistema de cache
                    </p>
                  </div>
                  <Switch
                    checked={config.performance.cacheEnabled}
                    onCheckedChange={(checked) => updateConfig('performance', 'cacheEnabled', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Compressão Habilitada</Label>
                    <p className="text-sm text-muted-foreground">
                      Comprimir arquivos para melhor velocidade
                    </p>
                  </div>
                  <Switch
                    checked={config.performance.compressionEnabled}
                    onCheckedChange={(checked) => updateConfig('performance', 'compressionEnabled', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>CDN Habilitado</Label>
                    <p className="text-sm text-muted-foreground">
                      Usar CDN para entrega de conteúdo
                    </p>
                  </div>
                  <Switch
                    checked={config.performance.cdnEnabled}
                    onCheckedChange={(checked) => updateConfig('performance', 'cdnEnabled', checked)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Timeout do Cache (segundos)</Label>
                  <Input
                    type="number"
                    value={config.performance.cacheTimeout}
                    onChange={(e) => updateConfig('performance', 'cacheTimeout', parseInt(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Limite de Rate da API</Label>
                  <Input
                    type="number"
                    value={config.performance.apiRateLimit}
                    onChange={(e) => updateConfig('performance', 'apiRateLimit', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Advanced Gear */}
        <TabsContent value="advanced">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Database className="h-5 w-5" />
                <span>Configurações Avançadas</span>
              </CardTitle>
              <CardDescription>
                Configurações de depuração e análise do sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Modo de Depuração</Label>
                    <p className="text-sm text-muted-foreground">
                      Ativar logs detalhados para desenvolvimento
                    </p>
                  </div>
                  <Switch
                    checked={config.advanced.debugMode}
                    onCheckedChange={(checked) => updateConfig('advanced', 'debugMode', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Analytics Habilitado</Label>
                    <p className="text-sm text-muted-foreground">
                      Coletar dados de uso para melhorias
                    </p>
                  </div>
                  <Switch
                    checked={config.advanced.enableAnalytics}
                    onCheckedChange={(checked) => updateConfig('advanced', 'enableAnalytics', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Modo de Manutenção</Label>
                    <p className="text-sm text-muted-foreground">
                      Ativar página de manutenção para usuários
                    </p>
                  </div>
                  <Switch
                    checked={config.advanced.maintenanceMode}
                    onCheckedChange={(checked) => updateConfig('advanced', 'maintenanceMode', checked)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Nível de Log</Label>
                  <Select
                    value={config.advanced.logLevel}
                    onValueChange={(value) => updateConfig('advanced', 'logLevel', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="error">Error</SelectItem>
                      <SelectItem value="warning">Warning</SelectItem>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="debug">Debug</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Retenção de Logs (dias)</Label>
                  <Input
                    type="number"
                    value={config.advanced.logRetentionDays}
                    onChange={(e) => updateConfig('advanced', 'logRetentionDays', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
