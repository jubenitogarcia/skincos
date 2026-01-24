import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Label } from "@/label"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { Switch } from "@/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/table"
import { Separator } from "@/separator"
import { toast } from 'sonner'
import {
  Plugs,
  Globe,
  Lightning,
  Gear,
  Plus,
  PencilSimple,
  Trash,
  Eye,
  Copy,
  CheckCircle,
  XCircle,
  Clock,
  Warning,
  Code,
  Database,
  ArrowRight,
  PlayCircle,
  StopCircle,
  ArrowCounterClockwise,
  Pulse,
  Shield,
  Key,
  FileCode,
  Bug,
  Timer,
  TrendUp,
  Headset,
  Users,
  Target,
  Envelope,
  Calculator
} from "@phosphor-icons/react"

interface WebhookEndpoint {
  id: string
  name: string
  description: string
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  headers: Record<string, string>
  events: string[]
  isActive: boolean
  secret?: string
  retryAttempts: number
  timeoutSeconds: number
  createdAt: string
  updatedAt: string
  lastTriggered?: string
  successCount: number
  failureCount: number
  averageResponseTime: number
}

interface WebhookEvent {
  id: string
  name: string
  description: string
  category: 'lead' | 'customer' | 'opportunity' | 'activity' | 'campaign' | 'system'
  payload: Record<string, any>
  isEnabled: boolean
}

interface WebhookLog {
  id: string
  endpointId: string
  endpointName: string
  event: string
  status: 'success' | 'failed' | 'pending' | 'retrying'
  responseCode?: number
  responseTime?: number
  errorMessage?: string
  payload: Record<string, any>
  response?: string
  attempt: number
  triggeredAt: string
}

interface APIIntegration {
  id: string
  name: string
  description: string
  type: 'crm' | 'marketing' | 'accounting' | 'helpdesk' | 'analytics' | 'custom'
  provider: string
  apiKey?: string
  baseUrl: string
  endpoints: Record<string, string>
  isActive: boolean
  syncFrequency: 'realtime' | 'hourly' | 'daily' | 'weekly'
  lastSync?: string
  status: 'connected' | 'error' | 'disconnected'
  errorMessage?: string
  createdAt: string
}

export function WebhooksIntegrationsHub() {
  const [webhookEndpoints, setWebhookEndpoints] = useKV<WebhookEndpoint[]>("webhook-endpoints", [])
  const [webhookEvents, setWebhookEvents] = useKV<WebhookEvent[]>("webhook-events", [])
  const [webhookLogs, setWebhookLogs] = useKV<WebhookLog[]>("webhook-logs", [])
  const [apiIntegrations, setApiIntegrations] = useKV<APIIntegration[]>("api-integrations", [])
  const [selectedEndpoint, setSelectedEndpoint] = useState<WebhookEndpoint | null>(null)
  const [selectedIntegration, setSelectedIntegration] = useState<APIIntegration | null>(null)
  const [isCreateWebhookOpen, setIsCreateWebhookOpen] = useState(false)
  const [isCreateIntegrationOpen, setIsCreateIntegrationOpen] = useState(false)
  const [isEditWebhookOpen, setIsEditWebhookOpen] = useState(false)
  const [isEditIntegrationOpen, setIsEditIntegrationOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("webhooks")

  // Initialize with sample data if empty
  useEffect(() => {
    if (webhookEvents.length === 0) {
      const sampleEvents: WebhookEvent[] = [
        {
          id: "1",
          name: "lead.created",
          description: "Novo lead criado no sistema",
          category: "lead",
          payload: { leadId: "string", name: "string", email: "string", source: "string" },
          isEnabled: true
        },
        {
          id: "2",
          name: "lead.updated",
          description: "Dados do lead foram atualizados",
          category: "lead",
          payload: { leadId: "string", changes: "object", updatedBy: "string" },
          isEnabled: true
        },
        {
          id: "3",
          name: "opportunity.won",
          description: "Oportunidade foi fechada como ganha",
          category: "opportunity",
          payload: { opportunityId: "string", value: "number", closedBy: "string" },
          isEnabled: true
        },
        {
          id: "4",
          name: "customer.converted",
          description: "Lead foi convertido em cliente",
          category: "customer",
          payload: { customerId: "string", originalLeadId: "string", convertedBy: "string" },
          isEnabled: true
        },
        {
          id: "5",
          name: "activity.completed",
          description: "Atividade foi marcada como concluída",
          category: "activity",
          payload: { activityId: "string", type: "string", completedBy: "string" },
          isEnabled: true
        }
      ]
      setWebhookEvents(sampleEvents)
    }

    if (webhookEndpoints.length === 0) {
      const sampleEndpoints: WebhookEndpoint[] = [
        {
          id: "1",
          name: "Marketing Automation",
          description: "Sincroniza leads com plataforma de marketing",
          url: "https://api.marketing.com/webhooks/crm",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer sk_test_123..."
          },
          events: ["lead.created", "lead.updated"],
          isActive: true,
          secret: process.env.WEBHOOK_SECRET || "",
          retryAttempts: 3,
          timeoutSeconds: 30,
          createdAt: "2024-01-15T10:00:00Z",
          updatedAt: "2024-03-10T14:30:00Z",
          lastTriggered: "2024-03-15T09:30:00Z",
          successCount: 1247,
          failureCount: 23,
          averageResponseTime: 245
        },
        {
          id: "2",
          name: "Slack Notifications",
          description: "Envia notificações para canal do Slack",
          url: process.env.SLACK_WEBHOOK_URL || "",
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          events: ["opportunity.won", "customer.converted"],
          isActive: true,
          retryAttempts: 2,
          timeoutSeconds: 15,
          createdAt: "2024-02-01T09:00:00Z",
          updatedAt: "2024-03-08T16:45:00Z",
          lastTriggered: "2024-03-15T11:15:00Z",
          successCount: 89,
          failureCount: 2,
          averageResponseTime: 120
        }
      ]
      setWebhookEndpoints(sampleEndpoints)
    }

    if (apiIntegrations.length === 0) {
      const sampleIntegrations: APIIntegration[] = [
        {
          id: "1",
          name: "HubSpot CRM",
          description: "Sincronização bidirecional com HubSpot",
          type: "crm",
          provider: "HubSpot",
          baseUrl: "https://api.hubapi.com/crm/v3",
          endpoints: {
            contacts: "/objects/contacts",
            companies: "/objects/companies",
            deals: "/objects/deals"
          },
          isActive: true,
          syncFrequency: "hourly",
          lastSync: "2024-03-15T10:00:00Z",
          status: "connected",
          createdAt: "2024-01-20T11:30:00Z"
        },
        {
          id: "2",
          name: "QuickBooks Online",
          description: "Integração contábil com QuickBooks",
          type: "accounting",
          provider: "Intuit",
          baseUrl: "https://sandbox-quickbooks.api.intuit.com/v3",
          endpoints: {
            customers: "/customers",
            invoices: "/invoices",
            payments: "/payments"
          },
          isActive: false,
          syncFrequency: "daily",
          status: "error",
          errorMessage: "Token de acesso expirado",
          createdAt: "2024-02-05T14:20:00Z"
        },
        {
          id: "3",
          name: "Google Analytics",
          description: "Tracking de conversões e comportamento",
          type: "analytics",
          provider: "Google",
          baseUrl: "https://www.googleapis.com/analytics/v3",
          endpoints: {
            data: "/data/ga",
            goals: "/management/goals"
          },
          isActive: true,
          syncFrequency: "daily",
          lastSync: "2024-03-14T23:00:00Z",
          status: "connected",
          createdAt: "2024-01-25T08:45:00Z"
        }
      ]
      setApiIntegrations(sampleIntegrations)
    }

    if (webhookLogs.length === 0) {
      const sampleLogs: WebhookLog[] = [
        {
          id: "1",
          endpointId: "1",
          endpointName: "Marketing Automation",
          event: "lead.created",
          status: "success",
          responseCode: 200,
          responseTime: 234,
          payload: {
            leadId: "lead-123",
            name: "João Silva",
            email: "joao@exemplo.com",
            source: "website"
          },
          response: '{"success": true, "id": "ma_456"}',
          attempt: 1,
          triggeredAt: "2024-03-15T09:30:00Z"
        },
        {
          id: "2",
          endpointId: "2",
          endpointName: "Slack Notifications",
          event: "opportunity.won",
          status: "success",
          responseCode: 200,
          responseTime: 89,
          payload: {
            opportunityId: "opp-789",
            value: 50000,
            closedBy: "Ana Costa"
          },
          response: '{"ok": true}',
          attempt: 1,
          triggeredAt: "2024-03-15T11:15:00Z"
        },
        {
          id: "3",
          endpointId: "1",
          endpointName: "Marketing Automation",
          event: "lead.updated",
          status: "failed",
          responseCode: 500,
          responseTime: 5000,
          errorMessage: "Internal Server Error",
          payload: {
            leadId: "lead-456",
            changes: { status: "qualified" },
            updatedBy: "Maria Santos"
          },
          attempt: 3,
          triggeredAt: "2024-03-15T08:45:00Z"
        }
      ]
      setWebhookLogs(sampleLogs)
    }
  }, [webhookEvents.length, webhookEndpoints.length, apiIntegrations.length, webhookLogs.length, setWebhookEvents, setWebhookEndpoints, setApiIntegrations, setWebhookLogs])

  const handleCreateWebhook = (webhookData: Partial<WebhookEndpoint>) => {
    const newWebhook: WebhookEndpoint = {
      id: Date.now().toString(),
      name: webhookData.name || "",
      description: webhookData.description || "",
      url: webhookData.url || "",
      method: webhookData.method || "POST",
      headers: webhookData.headers || {},
      events: webhookData.events || [],
      isActive: true,
      retryAttempts: webhookData.retryAttempts || 3,
      timeoutSeconds: webhookData.timeoutSeconds || 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      successCount: 0,
      failureCount: 0,
      averageResponseTime: 0
    }

    setWebhookEndpoints(prev => [...prev, newWebhook])
    setIsCreateWebhookOpen(false)
    toast.success("Webhook criado com sucesso!")
  }

  const handleEditWebhook = (webhookData: Partial<WebhookEndpoint>) => {
    if (!selectedEndpoint) return

    setWebhookEndpoints(prev => prev.map(webhook =>
      webhook.id === selectedEndpoint.id
        ? { ...webhook, ...webhookData, updatedAt: new Date().toISOString() }
        : webhook
    ))
    setIsEditWebhookOpen(false)
    setSelectedEndpoint(null)
    toast.success("Webhook atualizado com sucesso!")
  }

  const handleDeleteWebhook = (webhookId: string) => {
    setWebhookEndpoints(prev => prev.filter(webhook => webhook.id !== webhookId))
    toast.success("Webhook removido com sucesso!")
  }

  const handleToggleWebhookStatus = (webhookId: string) => {
    setWebhookEndpoints(prev => prev.map(webhook =>
      webhook.id === webhookId
        ? { ...webhook, isActive: !webhook.isActive, updatedAt: new Date().toISOString() }
        : webhook
    ))
    toast.success("Status do webhook alterado!")
  }

  const handleTestWebhook = (webhookId: string) => {
    // In a real implementation, this would send a test webhook
    toast.success("Webhook de teste enviado!")
  }

  const handleCreateIntegration = (integrationData: Partial<APIIntegration>) => {
    const newIntegration: APIIntegration = {
      id: Date.now().toString(),
      name: integrationData.name || "",
      description: integrationData.description || "",
      type: integrationData.type || "custom",
      provider: integrationData.provider || "",
      baseUrl: integrationData.baseUrl || "",
      endpoints: integrationData.endpoints || {},
      isActive: true,
      syncFrequency: integrationData.syncFrequency || "daily",
      status: "disconnected",
      createdAt: new Date().toISOString()
    }

    setApiIntegrations(prev => [...prev, newIntegration])
    setIsCreateIntegrationOpen(false)
    toast.success("Integração criada com sucesso!")
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
      case 'connected': return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'failed':
      case 'error': return <XCircle className="h-4 w-4 text-red-600" />
      case 'pending':
      case 'retrying': return <Clock className="h-4 w-4 text-yellow-600" />
      default: return <Warning className="h-4 w-4 text-gray-600" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
      case 'connected': return 'text-green-600'
      case 'failed':
      case 'error': return 'text-red-600'
      case 'pending':
      case 'retrying': return 'text-yellow-600'
      default: return 'text-gray-600'
    }
  }

  const getEventCategoryIcon = (category: string) => {
    switch (category) {
      case 'lead': return <Users className="h-4 w-4" />
      case 'customer': return <CheckCircle className="h-4 w-4" />
      case 'opportunity': return <Target className="h-4 w-4" />
      case 'activity': return <Pulse className="h-4 w-4" />
      case 'campaign': return <Envelope className="h-4 w-4" />
      default: return <Gear className="h-4 w-4" />
    }
  }

  const getIntegrationTypeIcon = (type: string) => {
    switch (type) {
      case 'crm': return <Database className="h-4 w-4" />
      case 'marketing': return <Envelope className="h-4 w-4" />
      case 'accounting': return <Calculator className="h-4 w-4" />
      case 'helpdesk': return <Headset className="h-4 w-4" />
      case 'analytics': return <TrendUp className="h-4 w-4" />
      default: return <Code className="h-4 w-4" />
    }
  }

  // Calculate summary statistics
  const totalWebhooks = webhookEndpoints.length
  const activeWebhooks = webhookEndpoints.filter(w => w.isActive).length
  const totalIntegrations = apiIntegrations.length
  const connectedIntegrations = apiIntegrations.filter(i => i.status === 'connected').length
  const recentLogs = webhookLogs.filter(log => {
    const logDate = new Date(log.triggeredAt)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return logDate >= yesterday
  }).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Webhooks & Integrações</h2>
          <p className="text-muted-foreground">
            Configure integrações com sistemas externos e webhooks para automação
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Dialog open={isCreateWebhookOpen} onOpenChange={setIsCreateWebhookOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plugs className="h-4 w-4 mr-2" />
                Novo Webhook
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Criar Novo Webhook</DialogTitle>
              </DialogHeader>
              <WebhookForm
                events={webhookEvents}
                onSubmit={handleCreateWebhook}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={isCreateIntegrationOpen} onOpenChange={setIsCreateIntegrationOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Nova Integração
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Criar Nova Integração</DialogTitle>
              </DialogHeader>
              <IntegrationForm onSubmit={handleCreateIntegration} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Overview Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Plugs className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Webhooks</p>
                <p className="text-2xl font-bold">{totalWebhooks}</p>
                <p className="text-xs text-green-600">{activeWebhooks} ativos</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Globe className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Integrações</p>
                <p className="text-2xl font-bold">{totalIntegrations}</p>
                <p className="text-xs text-green-600">{connectedIntegrations} conectadas</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Pulse className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Eventos 24h</p>
                <p className="text-2xl font-bold">{recentLogs}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Taxa de Sucesso</p>
                <p className="text-2xl font-bold">
                  {webhookEndpoints.length > 0
                    ? ((webhookEndpoints.reduce((sum, w) => sum + w.successCount, 0) /
                      webhookEndpoints.reduce((sum, w) => sum + w.successCount + w.failureCount, 1)) * 100).toFixed(1)
                    : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Timer className="h-5 w-5 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Tempo Médio</p>
                <p className="text-2xl font-bold">
                  {webhookEndpoints.length > 0
                    ? Math.round(webhookEndpoints.reduce((sum, w) => sum + w.averageResponseTime, 0) / webhookEndpoints.length)
                    : 0}ms
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
          <TabsTrigger value="events">Eventos</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="webhooks" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {webhookEndpoints.map((webhook) => (
              <Card key={webhook.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Plugs className="h-5 w-5" />
                      <CardTitle className="text-lg">{webhook.name}</CardTitle>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={webhook.isActive ? "default" : "secondary"}>
                        {webhook.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedEndpoint(webhook)
                          setIsEditWebhookOpen(true)
                        }}
                      >
                        <PencilSimple className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>{webhook.description}</CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* URL and Method */}
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      ENDPOINT
                    </Label>
                    <div className="mt-1 flex items-center space-x-2">
                      <Badge variant="outline">{webhook.method}</Badge>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {webhook.url.length > 40 ? webhook.url.substring(0, 40) + '...' : webhook.url}
                      </code>
                    </div>
                  </div>

                  {/* Events */}
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      EVENTOS ({webhook.events.length})
                    </Label>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {webhook.events.slice(0, 3).map((event) => (
                        <Badge key={event} variant="secondary" className="text-xs">
                          {event}
                        </Badge>
                      ))}
                      {webhook.events.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{webhook.events.length - 3} mais
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Statistics */}
                  <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                    <div>
                      <p className="text-xs text-muted-foreground">Sucessos</p>
                      <p className="font-semibold text-green-600">{webhook.successCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Falhas</p>
                      <p className="font-semibold text-red-600">{webhook.failureCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Tempo Médio</p>
                      <p className="font-semibold">{webhook.averageResponseTime}ms</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex space-x-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestWebhook(webhook.id)}
                    >
                      <PlayCircle className="h-4 w-4 mr-1" />
                      Testar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleWebhookStatus(webhook.id)}
                    >
                      {webhook.isActive ? (
                        <StopCircle className="h-4 w-4 mr-1" />
                      ) : (
                        <PlayCircle className="h-4 w-4 mr-1" />
                      )}
                      {webhook.isActive ? "Desativar" : "Ativar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteWebhook(webhook.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {apiIntegrations.map((integration) => (
              <Card key={integration.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getIntegrationTypeIcon(integration.type)}
                      <CardTitle className="text-lg">{integration.name}</CardTitle>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(integration.status)}
                      <Badge
                        variant={integration.status === 'connected' ? "default" :
                          integration.status === 'error' ? "destructive" : "secondary"}
                      >
                        {integration.status === 'connected' ? 'Conectado' :
                          integration.status === 'error' ? 'Erro' : 'Desconectado'}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription>{integration.description}</CardDescription>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline">{integration.provider}</Badge>
                    <Badge variant="outline">{integration.type}</Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Base URL */}
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      BASE URL
                    </Label>
                    <code className="text-xs bg-muted px-2 py-1 rounded block mt-1">
                      {integration.baseUrl}
                    </code>
                  </div>

                  {/* Sync Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Frequência</p>
                      <p className="font-medium">{integration.syncFrequency}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Última Sync</p>
                      <p className="font-medium">
                        {integration.lastSync
                          ? new Date(integration.lastSync).toLocaleDateString('pt-BR')
                          : 'Nunca'
                        }
                      </p>
                    </div>
                  </div>

                  {/* Error Message */}
                  {integration.errorMessage && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-600 flex items-center">
                        <Warning className="h-4 w-4 mr-2" />
                        {integration.errorMessage}
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex space-x-2 pt-2">
                    <Button variant="outline" size="sm">
                      <ArrowCounterClockwise className="h-4 w-4 mr-1" />
                      Sincronizar
                    </Button>
                    <Button variant="outline" size="sm">
                      <Gear className="h-4 w-4 mr-1" />
                      Configurar
                    </Button>
                    <Button variant="outline" size="sm">
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="events" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Eventos Disponíveis</CardTitle>
              <CardDescription>
                Configure quais eventos do sistema devem disparar webhooks
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {webhookEvents.map((event) => (
                  <div key={event.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      {getEventCategoryIcon(event.category)}
                      <div>
                        <h4 className="font-medium">{event.name}</h4>
                        <p className="text-sm text-muted-foreground">{event.description}</p>
                        <Badge variant="outline" className="mt-1">
                          {event.category}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <Switch
                        checked={event.isEnabled}
                        onCheckedChange={(checked) => {
                          setWebhookEvents(prev => prev.map(e =>
                            e.id === event.id ? { ...e, isEnabled: checked } : e
                          ))
                        }}
                      />
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Log de Webhooks</CardTitle>
              <CardDescription>
                Histórico de execuções e tentativas de webhook
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Webhook</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Resposta</TableHead>
                    <TableHead>Tempo</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webhookLogs.slice(0, 10).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">{log.endpointName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.event}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className={`flex items-center space-x-2 ${getStatusColor(log.status)}`}>
                          {getStatusIcon(log.status)}
                          <span className="capitalize">{log.status}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {log.responseCode && (
                          <Badge variant={log.responseCode < 300 ? "default" : "destructive"}>
                            {log.responseCode}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {log.responseTime ? `${log.responseTime}ms` : '-'}
                      </TableCell>
                      <TableCell>
                        {new Date(log.triggeredAt).toLocaleString('pt-BR')}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Webhook Modal */}
      <Dialog open={isEditWebhookOpen} onOpenChange={setIsEditWebhookOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Webhook</DialogTitle>
          </DialogHeader>
          {selectedEndpoint && (
            <WebhookForm
              webhook={selectedEndpoint}
              events={webhookEvents}
              onSubmit={handleEditWebhook}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Webhook Form Component
function WebhookForm({
  webhook,
  events,
  onSubmit
}: {
  webhook?: WebhookEndpoint
  events: WebhookEvent[]
  onSubmit: (data: Partial<WebhookEndpoint>) => void
}) {
  const [formData, setFormData] = useState({
    name: webhook?.name || "",
    description: webhook?.description || "",
    url: webhook?.url || "",
    method: webhook?.method || "POST",
    events: webhook?.events || [],
    retryAttempts: webhook?.retryAttempts || 3,
    timeoutSeconds: webhook?.timeoutSeconds || 30
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome do Webhook</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Ex: Marketing Automation"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="method">Método HTTP</Label>
          <Select
            value={formData.method}
            onValueChange={(value) => setFormData(prev => ({ ...prev, method: value as any }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Método" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="PATCH">PATCH</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descrição</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Descreva o propósito deste webhook..."
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="url">URL do Endpoint</Label>
        <Input
          id="url"
          type="url"
          value={formData.url}
          onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
          placeholder="https://api.exemplo.com/webhooks/crm"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Eventos para Monitorar</Label>
        <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
          {events.filter(e => e.isEnabled).map((event) => (
            <div key={event.id} className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={`event-${event.id}`}
                checked={formData.events.includes(event.name)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setFormData(prev => ({
                      ...prev,
                      events: [...prev.events, event.name]
                    }))
                  } else {
                    setFormData(prev => ({
                      ...prev,
                      events: prev.events.filter(name => name !== event.name)
                    }))
                  }
                }}
                className="rounded border-gray-300"
              />
              <Label htmlFor={`event-${event.id}`} className="text-sm">
                {event.name}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="retryAttempts">Tentativas de Retry</Label>
          <Input
            id="retryAttempts"
            type="number"
            min="0"
            max="10"
            value={formData.retryAttempts}
            onChange={(e) => setFormData(prev => ({ ...prev, retryAttempts: parseInt(e.target.value) }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="timeoutSeconds">Timeout (segundos)</Label>
          <Input
            id="timeoutSeconds"
            type="number"
            min="1"
            max="300"
            value={formData.timeoutSeconds}
            onChange={(e) => setFormData(prev => ({ ...prev, timeoutSeconds: parseInt(e.target.value) }))}
          />
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline">
          Cancelar
        </Button>
        <Button type="submit">
          {webhook ? "Atualizar" : "Criar"} Webhook
        </Button>
      </div>
    </form>
  )
}

// Integration Form Component
function IntegrationForm({
  integration,
  onSubmit
}: {
  integration?: APIIntegration
  onSubmit: (data: Partial<APIIntegration>) => void
}) {
  const [formData, setFormData] = useState({
    name: integration?.name || "",
    description: integration?.description || "",
    type: integration?.type || "custom",
    provider: integration?.provider || "",
    baseUrl: integration?.baseUrl || "",
    syncFrequency: integration?.syncFrequency || "daily"
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome da Integração</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Ex: HubSpot CRM"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider">Provedor</Label>
          <Input
            id="provider"
            value={formData.provider}
            onChange={(e) => setFormData(prev => ({ ...prev, provider: e.target.value }))}
            placeholder="Ex: HubSpot"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descrição</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Descreva o propósito desta integração..."
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="type">Tipo</Label>
          <Select
            value={formData.type}
            onValueChange={(value) => setFormData(prev => ({ ...prev, type: value as any }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Tipo de integração" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="crm">CRM</SelectItem>
              <SelectItem value="marketing">Marketing</SelectItem>
              <SelectItem value="accounting">Contábil</SelectItem>
              <SelectItem value="helpdesk">Suporte</SelectItem>
              <SelectItem value="analytics">Analytics</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="syncFrequency">Frequência de Sync</Label>
          <Select
            value={formData.syncFrequency}
            onValueChange={(value) => setFormData(prev => ({ ...prev, syncFrequency: value as any }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Frequência" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="realtime">Tempo Real</SelectItem>
              <SelectItem value="hourly">A cada hora</SelectItem>
              <SelectItem value="daily">Diário</SelectItem>
              <SelectItem value="weekly">Semanal</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="baseUrl">URL Base da API</Label>
        <Input
          id="baseUrl"
          type="url"
          value={formData.baseUrl}
          onChange={(e) => setFormData(prev => ({ ...prev, baseUrl: e.target.value }))}
          placeholder="https://api.exemplo.com/v1"
          required
        />
      </div>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline">
          Cancelar
        </Button>
        <Button type="submit">
          {integration ? "Atualizar" : "Criar"} Integração
        </Button>
      </div>
    </form>
  )
}
