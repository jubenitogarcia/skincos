import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Label } from "@/label"
import { Switch } from "@/switch"
import { Separator } from "@/separator"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/alert-dialog"
import { Progress } from "@/progress"
import {
  Gear,
  Users,
  Shield,
  Envelope,
  Globe,
  Database,
  Palette,
  Bell,
  Code,
  Download,
  Upload,
  Trash,
  FloppyDisk as Save,
  ArrowsCounterClockwise as RefreshCw,
  Lock,
  Eye,
  EyeSlash,
  Warning,
  CheckCircle,
  Info,
  CloudArrowUp,
  Prohibit,
  Lightning
} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface SystemGear {
  general: {
    companyName: string
    companyLogo?: string
    timezone: string
    dateFormat: string
    timeFormat: string
    currency: string
    language: string
    defaultCountry: string
  }
  email: {
    mailDriver: 'smtp' | 'sendmail' | 'ses' | 'mailgun'
    smtpHost: string
    smtpPort: number
    smtpUsername: string
    smtpPassword: string
    smtpEncryption: 'tls' | 'ssl' | 'none'
    fromAddress: string
    fromName: string
    replyToAddress: string
    testEmailAddress: string
  }
  security: {
    sessionTimeout: number
    passwordMinLength: number
    requireUppercase: boolean
    requireNumbers: boolean
    requireSpecialChars: boolean
    twoFactorEnabled: boolean
    loginAttempts: number
    lockoutDuration: number
    ipWhitelist: string[]
    apiRateLimit: number
  }
  automation: {
    enableLeadScoring: boolean
    autoAssignLeads: boolean
    leadRotationMethod: 'round-robin' | 'weighted' | 'manual'
    duplicateDetection: boolean
    autoBackup: boolean
    backupFrequency: 'daily' | 'weekly' | 'monthly'
    backupRetention: number
  }
  integrations: {
    googleAnalytics: {
      enabled: boolean
      trackingId: string
    }
    zapier: {
      enabled: boolean
      webhookUrl: string
    }
    slack: {
      enabled: boolean
      webhookUrl: string
      channels: string[]
    }
    whatsapp: {
      enabled: boolean
      apiKey: string
      phoneNumber: string
    }
  }
  notifications: {
    emailNotifications: boolean
    pushNotifications: boolean
    smsNotifications: boolean
    leadAssignmentNotification: boolean
    dealWonNotification: boolean
    taskDueNotification: boolean
    systemMaintenanceNotification: boolean
  }
  appearance: {
    theme: 'light' | 'dark' | 'auto'
    primaryColor: string
    logoUrl?: string
    favicon?: string
    customCss?: string
    loginPageBranding: boolean
  }
  api: {
    enabled: boolean
    rateLimitPerMinute: number
    requireAuthentication: boolean
    allowedOrigins: string[]
    webhookSecret: string
    enableLogging: boolean
  }
  backup: {
    autoBackup: boolean
    frequency: 'daily' | 'weekly' | 'monthly'
    retentionDays: number
    includeFiles: boolean
    cloudStorage: {
      provider: 'aws' | 'gcp' | 'azure' | 'local'
      credentials: Record<string, string>
    }
  }
}

const defaultGear: SystemGear = {
  general: {
    companyName: 'CRM Inteligente',
    timezone: 'America/Sao_Paulo',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    currency: 'BRL',
    language: 'pt-BR',
    defaultCountry: 'BR'
  },
  email: {
    mailDriver: 'smtp',
    smtpHost: '',
    smtpPort: 587,
    smtpUsername: '',
    smtpPassword: '',
    smtpEncryption: 'tls',
    fromAddress: '',
    fromName: 'CRM Inteligente',
    replyToAddress: '',
    testEmailAddress: ''
  },
  security: {
    sessionTimeout: 60,
    passwordMinLength: 8,
    requireUppercase: true,
    requireNumbers: true,
    requireSpecialChars: false,
    twoFactorEnabled: false,
    loginAttempts: 5,
    lockoutDuration: 15,
    ipWhitelist: [],
    apiRateLimit: 1000
  },
  automation: {
    enableLeadScoring: true,
    autoAssignLeads: true,
    leadRotationMethod: 'round-robin',
    duplicateDetection: true,
    autoBackup: true,
    backupFrequency: 'daily',
    backupRetention: 30
  },
  integrations: {
    googleAnalytics: {
      enabled: false,
      trackingId: ''
    },
    zapier: {
      enabled: false,
      webhookUrl: ''
    },
    slack: {
      enabled: false,
      webhookUrl: '',
      channels: []
    },
    whatsapp: {
      enabled: false,
      apiKey: '',
      phoneNumber: ''
    }
  },
  notifications: {
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: false,
    leadAssignmentNotification: true,
    dealWonNotification: true,
    taskDueNotification: true,
    systemMaintenanceNotification: true
  },
  appearance: {
    theme: 'light',
    primaryColor: '#2563eb',
    loginPageBranding: true
  },
  api: {
    enabled: true,
    rateLimitPerMinute: 60,
    requireAuthentication: true,
    allowedOrigins: ['*'],
    webhookSecret: '',
    enableLogging: true
  },
  backup: {
    autoBackup: true,
    frequency: 'daily',
    retentionDays: 30,
    includeFiles: false,
    cloudStorage: {
      provider: 'local',
      credentials: {}
    }
  }
}

export function AdvancedGear() {
  const [settings, setGear] = useKV<SystemGear>('krayin-system-settings', defaultGear)
  const [activeTab, setActiveTab] = useState('general')
  const [isTestingEmail, setIsTestingEmail] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const updateSetting = (section: keyof SystemGear, field: string, value: any) => {
    setGear(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }))
    setIsDirty(true)
  }

  const updateNestedSetting = (section: keyof SystemGear, subsection: string, field: string, value: any) => {
    setGear(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [subsection]: {
          ...prev[section][subsection],
          [field]: value
        }
      }
    }))
    setIsDirty(true)
  }

  const saveGear = () => {
    // Gear are automatically saved due to useKV
    setIsDirty(false)
    toast.success('Configurações salvas com sucesso!')
  }

  const testEmailConnection = async () => {
    setIsTestingEmail(true)
    try {
      // Simulate email test
      await new Promise(resolve => setTimeout(resolve, 2000))
      toast.success('E-mail de teste enviado com sucesso!')
    } catch (error) {
      toast.error('Falha ao enviar e-mail de teste')
    }
    setIsTestingEmail(false)
  }

  const resetToDefaults = (section: keyof SystemGear) => {
    setGear(prev => ({
      ...prev,
      [section]: defaultGear[section]
    }))
    setIsDirty(true)
    toast.success(`Configurações de ${section} resetadas para padrão`)
  }

  const exportGear = () => {
    const dataStr = JSON.stringify(settings, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'crm-settings.json'
    link.click()
    toast.success('Configurações exportadas com sucesso!')
  }

  const importGear = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const importedGear = JSON.parse(e.target?.result as string)
        setGear(importedGear)
        setIsDirty(true)
        toast.success('Configurações importadas com sucesso!')
      } catch (error) {
        toast.error('Arquivo de configuração inválido')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Configurações Avançadas</h2>
          <p className="text-muted-foreground">
            Configure todos os aspectos do sistema estilo Krayin CRM
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={exportGear}>
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
          <Button variant="outline" onClick={() => document.getElementById('import-settings')?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Importar
          </Button>
          <Button onClick={saveGear} disabled={!isDirty}>
            <Save className="h-4 w-4 mr-2" />
            Salvar
          </Button>
          <input
            id="import-settings"
            type="file"
            accept=".json"
            className="hidden"
            onChange={importGear}
          />
        </div>
      </div>

      {/* Dirty State Warning */}
      {isDirty && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2 text-orange-800">
              <Warning className="h-4 w-4" />
              <span className="text-sm">Você possui alterações não salvas</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-8">
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="email">E-mail</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
          <TabsTrigger value="automation">Automação</TabsTrigger>
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
          <TabsTrigger value="notifications">Notificações</TabsTrigger>
          <TabsTrigger value="appearance">Aparência</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
        </TabsList>

        {/* General Gear */}
        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Gear className="h-5 w-5" />
                <span>Configurações Gerais</span>
              </CardTitle>
              <CardDescription>
                Configurações básicas da empresa e sistema
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">Nome da Empresa</Label>
                  <Input
                    id="companyName"
                    value={settings.general.companyName}
                    onChange={(e) => updateSetting('general', 'companyName', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Fuso Horário</Label>
                  <Select value={settings.general.timezone} onValueChange={(value) => updateSetting('general', 'timezone', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/Sao_Paulo">America/São Paulo</SelectItem>
                      <SelectItem value="America/New_York">America/New York</SelectItem>
                      <SelectItem value="Europe/London">Europe/London</SelectItem>
                      <SelectItem value="Asia/Tokyo">Asia/Tokyo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dateFormat">Formato de Data</Label>
                  <Select value={settings.general.dateFormat} onValueChange={(value) => updateSetting('general', 'dateFormat', value)}>
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
                  <Label htmlFor="currency">Moeda</Label>
                  <Select value={settings.general.currency} onValueChange={(value) => updateSetting('general', 'currency', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BRL">Real Brasileiro (BRL)</SelectItem>
                      <SelectItem value="USD">Dólar Americano (USD)</SelectItem>
                      <SelectItem value="EUR">Euro (EUR)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="language">Idioma</Label>
                  <Select value={settings.general.language} onValueChange={(value) => updateSetting('general', 'language', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                      <SelectItem value="en-US">English (US)</SelectItem>
                      <SelectItem value="es-ES">Español</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultCountry">País Padrão</Label>
                  <Select value={settings.general.defaultCountry} onValueChange={(value) => updateSetting('general', 'defaultCountry', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BR">Brasil</SelectItem>
                      <SelectItem value="US">Estados Unidos</SelectItem>
                      <SelectItem value="GB">Reino Unido</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => resetToDefaults('general')}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Restaurar Padrões
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Gear */}
        <TabsContent value="email" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Envelope className="h-5 w-5" />
                <span>Configurações de E-mail</span>
              </CardTitle>
              <CardDescription>
                Configure o servidor SMTP para envio de e-mails
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="mailDriver">Driver de E-mail</Label>
                  <Select value={settings.email.mailDriver} onValueChange={(value) => updateSetting('email', 'mailDriver', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="smtp">SMTP</SelectItem>
                      <SelectItem value="sendmail">Sendmail</SelectItem>
                      <SelectItem value="ses">Amazon SES</SelectItem>
                      <SelectItem value="mailgun">Envelopegun</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtpHost">Servidor SMTP</Label>
                  <Input
                    id="smtpHost"
                    placeholder="smtp.gmail.com"
                    value={settings.email.smtpHost}
                    onChange={(e) => updateSetting('email', 'smtpHost', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtpPort">Porta SMTP</Label>
                  <Input
                    id="smtpPort"
                    type="number"
                    value={settings.email.smtpPort}
                    onChange={(e) => updateSetting('email', 'smtpPort', Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtpEncryption">Criptografia</Label>
                  <Select value={settings.email.smtpEncryption} onValueChange={(value) => updateSetting('email', 'smtpEncryption', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tls">TLS</SelectItem>
                      <SelectItem value="ssl">SSL</SelectItem>
                      <SelectItem value="none">Nenhuma</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtpUsername">Usuário SMTP</Label>
                  <Input
                    id="smtpUsername"
                    value={settings.email.smtpUsername}
                    onChange={(e) => updateSetting('email', 'smtpUsername', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtpPassword">Senha SMTP</Label>
                  <div className="relative">
                    <Input
                      id="smtpPassword"
                      type={showPassword ? "text" : "password"}
                      value={settings.email.smtpPassword}
                      onChange={(e) => updateSetting('email', 'smtpPassword', e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeSlash className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fromAddress">E-mail Remetente</Label>
                  <Input
                    id="fromAddress"
                    type="email"
                    value={settings.email.fromAddress}
                    onChange={(e) => updateSetting('email', 'fromAddress', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fromName">Nome Remetente</Label>
                  <Input
                    id="fromName"
                    value={settings.email.fromName}
                    onChange={(e) => updateSetting('email', 'fromName', e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="font-medium">Teste de Conectividade</h4>
                <div className="flex items-center space-x-4">
                  <Input
                    placeholder="E-mail para teste"
                    value={settings.email.testEmailAddress}
                    onChange={(e) => updateSetting('email', 'testEmailAddress', e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={testEmailConnection} disabled={isTestingEmail}>
                    {isTestingEmail ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Envelope className="h-4 w-4 mr-2" />}
                    {isTestingEmail ? 'Enviando...' : 'Testar E-mail'}
                  </Button>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => resetToDefaults('email')}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Restaurar Padrões
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Gear */}
        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="h-5 w-5" />
                <span>Configurações de Segurança</span>
              </CardTitle>
              <CardDescription>
                Configure políticas de segurança e autenticação
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="font-medium mb-4">Políticas de Senha</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="passwordMinLength">Comprimento Mínimo</Label>
                    <Input
                      id="passwordMinLength"
                      type="number"
                      min="6"
                      max="32"
                      value={settings.security.passwordMinLength}
                      onChange={(e) => updateSetting('security', 'passwordMinLength', Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sessionTimeout">Timeout de Sessão (minutos)</Label>
                    <Input
                      id="sessionTimeout"
                      type="number"
                      value={settings.security.sessionTimeout}
                      onChange={(e) => updateSetting('security', 'sessionTimeout', Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="space-y-3 mt-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="requireUppercase">Exigir Maiúsculas</Label>
                    <Switch
                      id="requireUppercase"
                      checked={settings.security.requireUppercase}
                      onCheckedChange={(checked) => updateSetting('security', 'requireUppercase', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="requireNumbers">Exigir Números</Label>
                    <Switch
                      id="requireNumbers"
                      checked={settings.security.requireNumbers}
                      onCheckedChange={(checked) => updateSetting('security', 'requireNumbers', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="requireSpecialChars">Exigir Caracteres Especiais</Label>
                    <Switch
                      id="requireSpecialChars"
                      checked={settings.security.requireSpecialChars}
                      onCheckedChange={(checked) => updateSetting('security', 'requireSpecialChars', checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="twoFactorEnabled">Autenticação de Dois Fatores</Label>
                    <Switch
                      id="twoFactorEnabled"
                      checked={settings.security.twoFactorEnabled}
                      onCheckedChange={(checked) => updateSetting('security', 'twoFactorEnabled', checked)}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="font-medium mb-4">Proteção contra Ataques</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="loginAttempts">Tentativas de Login</Label>
                    <Input
                      id="loginAttempts"
                      type="number"
                      min="3"
                      max="10"
                      value={settings.security.loginAttempts}
                      onChange={(e) => updateSetting('security', 'loginAttempts', Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lockoutDuration">Duração do Bloqueio (minutos)</Label>
                    <Input
                      id="lockoutDuration"
                      type="number"
                      value={settings.security.lockoutDuration}
                      onChange={(e) => updateSetting('security', 'lockoutDuration', Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="apiRateLimit">Limite da API (por minuto)</Label>
                    <Input
                      id="apiRateLimit"
                      type="number"
                      value={settings.security.apiRateLimit}
                      onChange={(e) => updateSetting('security', 'apiRateLimit', Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => resetToDefaults('security')}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Restaurar Padrões
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Additional tabs would follow the same pattern... */}
      </Tabs>
    </div>
  )
}
