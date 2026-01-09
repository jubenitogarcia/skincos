import { useState } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Textarea } from "@/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Label } from "@/label"
import { Switch } from "@/switch"
import { Progress } from "@/progress"
import { Separator } from "@/separator"
import { Plus, Envelope, Users, TrendUp, Eye, PencilSimple, Trash, PaperPlaneRight, Pause, Play, CalendarBlank, Clock, ChartBar, FileText, Target, Funnel } from "@phosphor-icons/react"
import { toast } from 'sonner'

interface EmailTemplate {
  id: string
  name: string
  subject: string
  content: string
  htmlContent: string
  type: 'campaign' | 'transactional' | 'automated'
  category: string
  isActive: boolean
  preheader?: string
  createdAt: string
  updatedAt: string
}

interface EmailCampaign {
  id: string
  name: string
  subject: string
  templateId?: string
  content: string
  htmlContent: string
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled'
  type: 'newsletter' | 'promotional' | 'announcement' | 'drip' | 'welcome'

  // Targeting
  segmentIds: string[]
  totalRecipients: number

  // Scheduling
  sendImmediately: boolean
  scheduledAt?: string
  timeZone: string

  // A/B Testing
  isABTest: boolean
  abTestSubjects?: string[]
  abTestPercentage?: number

  // Gear
  fromName: string
  fromEmail: string
  replyTo: string
  trackOpens: boolean
  trackClicks: boolean

  // Results
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  unsubscribed: number

  // Metrics
  openRate: number
  clickRate: number
  bounceRate: number
  unsubscribeRate: number

  createdAt: string
  updatedAt: string
  sentAt?: string
}

interface EmailSegment {
  id: string
  name: string
  description: string
  conditions: SegmentCondition[]
  contactsCount: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface SegmentCondition {
  id: string
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'in' | 'not_in'
  value: string | string[]
  type: 'and' | 'or'
}

const defaultCampaign: Omit<EmailCampaign, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  subject: '',
  templateId: '',
  content: '',
  htmlContent: '',
  status: 'draft',
  type: 'newsletter',
  segmentIds: [],
  totalRecipients: 0,
  sendImmediately: true,
  scheduledAt: '',
  timeZone: 'America/Sao_Paulo',
  isABTest: false,
  abTestSubjects: [],
  abTestPercentage: 50,
  fromName: 'Sua Empresa',
  fromEmail: 'noreply@suaempresa.com',
  replyTo: 'contato@suaempresa.com',
  trackOpens: true,
  trackClicks: true,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  unsubscribed: 0,
  openRate: 0,
  clickRate: 0,
  bounceRate: 0,
  unsubscribeRate: 0
}

const campaignTypes = [
  { value: 'newsletter', label: 'Newsletter', description: 'Boletim informativo regular' },
  { value: 'promotional', label: 'Promocional', description: 'Ofertas e promoções' },
  { value: 'announcement', label: 'Anúncio', description: 'Comunicados importantes' },
  { value: 'drip', label: 'Sequência', description: 'Série de e-mails automatizados' },
  { value: 'welcome', label: 'Boas-vindas', description: 'E-mail de boas-vindas para novos contatos' }
]

const statusOptions = [
  { value: 'draft', label: 'Rascunho', color: 'bg-gray-100 text-gray-800' },
  { value: 'scheduled', label: 'Agendada', color: 'bg-blue-100 text-blue-800' },
  { value: 'sending', label: 'Enviando', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'sent', label: 'Enviada', color: 'bg-green-100 text-green-800' },
  { value: 'paused', label: 'Pausada', color: 'bg-orange-100 text-orange-800' },
  { value: 'cancelled', label: 'Cancelada', color: 'bg-red-100 text-red-800' }
]

export function EmailMarketing() {
  const [campaigns, setCampaigns] = useKV<EmailCampaign[]>('krayin-email-campaigns', [])
  const [templates, setTemplates] = useKV<EmailTemplate[]>('krayin-email-templates', [])
  const [segments, setSegments] = useKV<EmailSegment[]>('krayin-email-segments', [])

  const [selectedCampaign, setSelectedCampaign] = useState<EmailCampaign | null>(null)
  const [editingCampaign, setEditingCampaign] = useState<Partial<EmailCampaign> | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [searchQuery, setMagnifyingGlassQuery] = useState('')
  const [statusFunnel, setStatusFunnel] = useState<string>('all')
  const [typeFunnel, setTypeFunnel] = useState<string>('all')
  const [activeTab, setActiveTab] = useState<'campaigns' | 'templates' | 'segments'>('campaigns')

  // Calculate metrics
  const totalCampaigns = campaigns.length
  const activeCampaigns = campaigns.filter(c => ['scheduled', 'sending'].includes(c.status)).length
  const sentCampaigns = campaigns.filter(c => c.status === 'sent').length
  const totalSent = campaigns.reduce((sum, c) => sum + c.sent, 0)
  const totalOpened = campaigns.reduce((sum, c) => sum + c.opened, 0)
  const totalClicked = campaigns.reduce((sum, c) => sum + c.clicked, 0)
  const avgOpenRate = sentCampaigns > 0 ? campaigns.filter(c => c.status === 'sent').reduce((sum, c) => sum + c.openRate, 0) / sentCampaigns : 0
  const avgClickRate = sentCampaigns > 0 ? campaigns.filter(c => c.status === 'sent').reduce((sum, c) => sum + c.clickRate, 0) / sentCampaigns : 0

  // Funnel campaigns
  const filteredCampaigns = campaigns.filter(campaign => {
    const matchesMagnifyingGlass =
      campaign.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      campaign.subject.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus = statusFunnel === 'all' || campaign.status === statusFunnel
    const matchesType = typeFunnel === 'all' || campaign.type === typeFunnel

    return matchesMagnifyingGlass && matchesStatus && matchesType
  })

  const createCampaign = (campaignData: Omit<EmailCampaign, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newCampaign: EmailCampaign = {
      ...campaignData,
      id: `campaign-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setCampaigns(currentCampaigns => [...currentCampaigns, newCampaign])
    toast.success('Campanha criada com sucesso!')
    setIsCreateDialogOpen(false)
  }

  const updateCampaign = (campaignId: string, updates: Partial<EmailCampaign>) => {
    setCampaigns(currentCampaigns =>
      currentCampaigns.map(campaign =>
        campaign.id === campaignId
          ? { ...campaign, ...updates, updatedAt: new Date().toISOString() }
          : campaign
      )
    )
    toast.success('Campanha atualizada com sucesso!')
    setIsEditDialogOpen(false)
    setEditingCampaign(null)
  }

  const deleteCampaign = (campaignId: string) => {
    setCampaigns(currentCampaigns => currentCampaigns.filter(campaign => campaign.id !== campaignId))
    toast.success('Campanha removida com sucesso!')
  }

  const sendCampaign = (campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId)
    if (!campaign) return

    // Simulate sending
    const simulatedResults = {
      status: 'sent' as const,
      sent: campaign.totalRecipients,
      delivered: Math.floor(campaign.totalRecipients * 0.98), // 98% delivery rate
      opened: Math.floor(campaign.totalRecipients * 0.25), // 25% open rate
      clicked: Math.floor(campaign.totalRecipients * 0.03), // 3% click rate
      bounced: Math.floor(campaign.totalRecipients * 0.02), // 2% bounce rate
      unsubscribed: Math.floor(campaign.totalRecipients * 0.001), // 0.1% unsubscribe rate
      sentAt: new Date().toISOString()
    }

    // Calculate rates
    const openRate = (simulatedResults.opened / simulatedResults.delivered) * 100
    const clickRate = (simulatedResults.clicked / simulatedResults.delivered) * 100
    const bounceRate = (simulatedResults.bounced / simulatedResults.sent) * 100
    const unsubscribeRate = (simulatedResults.unsubscribed / simulatedResults.delivered) * 100

    updateCampaign(campaignId, {
      ...simulatedResults,
      openRate,
      clickRate,
      bounceRate,
      unsubscribeRate
    })

    toast.success('Campanha enviada com sucesso!')
  }

  const pauseCampaign = (campaignId: string) => {
    updateCampaign(campaignId, { status: 'paused' })
    toast.success('Campanha pausada!')
  }

  const resumeCampaign = (campaignId: string) => {
    updateCampaign(campaignId, { status: 'sending' })
    toast.success('Campanha retomada!')
  }

  const getStatusInfo = (status: string) => {
    return statusOptions.find(s => s.value === status) || statusOptions[0]
  }

  const getTypeInfo = (type: string) => {
    return campaignTypes.find(t => t.value === type) || campaignTypes[0]
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">E-mail Marketing</h2>
          <p className="text-muted-foreground">
            Sistema completo de e-mail marketing baseado no Krayin CRM
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Campanha
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Envelope className="h-4 w-4 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Total Campanhas</p>
                <p className="text-2xl font-bold">{totalCampaigns}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Play className="h-4 w-4 text-blue-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Ativas</p>
                <p className="text-2xl font-bold">{activeCampaigns}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <PaperPlaneRight className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Total Enviados</p>
                <p className="text-2xl font-bold">{totalSent.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Eye className="h-4 w-4 text-purple-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Taxa Abertura</p>
                <p className="text-2xl font-bold">{avgOpenRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Target className="h-4 w-4 text-orange-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Taxa Clique</p>
                <p className="text-2xl font-bold">{avgClickRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-4 w-4 text-blue-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Segmentos</p>
                <p className="text-2xl font-bold">{segments.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
        <TabsList>
          <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="segments">Segmentos</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="space-y-6">
          {/* Funnels */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Input
                    placeholder="Buscar campanhas..."
                    value={searchQuery}
                    onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
                  />
                </div>

                <Select value={statusFunnel} onValueChange={setStatusFunnel}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos Status</SelectItem>
                    {statusOptions.map(status => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={typeFunnel} onValueChange={setTypeFunnel}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos Tipos</SelectItem>
                    {campaignTypes.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button variant="outline" size="sm">
                  <Funnel className="h-4 w-4 mr-2" />
                  Filtros
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Campaigns Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCampaigns.map((campaign) => {
              const statusInfo = getStatusInfo(campaign.status)
              const typeInfo = getTypeInfo(campaign.type)

              return (
                <Card key={campaign.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg">{campaign.name}</CardTitle>
                        <CardDescription className="line-clamp-2">
                          {campaign.subject}
                        </CardDescription>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Badge variant="outline" className={statusInfo.color}>
                          {statusInfo.label}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                      <Badge variant="outline" className="bg-blue-100 text-blue-800">
                        {typeInfo.label}
                      </Badge>
                      <Badge variant="outline">
                        {campaign.totalRecipients} destinatários
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {campaign.status === 'sent' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="text-center">
                            <p className="font-semibold text-lg text-green-600">{campaign.openRate.toFixed(1)}%</p>
                            <p className="text-muted-foreground">Taxa Abertura</p>
                          </div>
                          <div className="text-center">
                            <p className="font-semibold text-lg text-blue-600">{campaign.clickRate.toFixed(1)}%</p>
                            <p className="text-muted-foreground">Taxa Clique</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Entregues:</span>
                            <span>{campaign.delivered.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span>Abertos:</span>
                            <span>{campaign.opened.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span>Cliques:</span>
                            <span>{campaign.clicked.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {campaign.status === 'scheduled' && campaign.scheduledAt && (
                      <div className="text-sm">
                        <div className="flex items-center space-x-2 text-blue-600">
                          <CalendarBlank className="h-4 w-4" />
                          <span>Agendada para:</span>
                        </div>
                        <p className="font-medium">
                          {new Date(campaign.scheduledAt).toLocaleString('pt-BR')}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          setSelectedCampaign(campaign)
                          setIsViewDialogOpen(true)
                        }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Ver
                      </Button>

                      {campaign.status === 'draft' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingCampaign(campaign)
                              setIsEditDialogOpen(true)
                            }}
                          >
                            <PencilSimple className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => sendCampaign(campaign.id)}
                          >
                            <PaperPlaneRight className="h-4 w-4" />
                          </Button>
                        </>
                      )}

                      {campaign.status === 'sending' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => pauseCampaign(campaign.id)}
                        >
                          <Pause className="h-4 w-4" />
                        </Button>
                      )}

                      {campaign.status === 'paused' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resumeCampaign(campaign.id)}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {filteredCampaigns.length === 0 && (
            <Card>
              <CardContent className="text-center py-12">
                <Envelope className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  Nenhuma campanha encontrada
                </h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery ? "Tente outro termo de busca" : "Crie sua primeira campanha de e-mail"}
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Campanha
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="templates" className="space-y-6">
          <Card>
            <CardContent className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                Templates de E-mail
              </h3>
              <p className="text-muted-foreground mb-4">
                Funcionalidade em desenvolvimento
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="segments" className="space-y-6">
          <Card>
            <CardContent className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                Segmentação de Contatos
              </h3>
              <p className="text-muted-foreground mb-4">
                Funcionalidade em desenvolvimento
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Campaign Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar Nova Campanha de E-mail</DialogTitle>
            <DialogDescription>
              Configure sua campanha de e-mail marketing
            </DialogDescription>
          </DialogHeader>

          <CampaignForm
            campaign={defaultCampaign}
            onSave={createCampaign}
            onCancel={() => setIsCreateDialogOpen(false)}
            segments={segments}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Campaign Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Campanha</DialogTitle>
            <DialogDescription>
              Atualize as configurações da campanha
            </DialogDescription>
          </DialogHeader>

          {editingCampaign && (
            <CampaignForm
              campaign={editingCampaign}
              onSave={(campaignData) => updateCampaign(editingCampaign.id!, campaignData)}
              onCancel={() => {
                setEditingCampaign(null)
                setIsEditDialogOpen(false)
              }}
              segments={segments}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* View Campaign Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da Campanha</DialogTitle>
          </DialogHeader>

          {selectedCampaign && (
            <CampaignDetails campaign={selectedCampaign} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface CampaignFormProps {
  campaign: Partial<EmailCampaign>
  onSave: (campaign: Omit<EmailCampaign, 'id' | 'createdAt' | 'updatedAt'>) => void
  onCancel: () => void
  segments: EmailSegment[]
}

function CampaignForm({ campaign, onSave, onCancel, segments }: CampaignFormProps) {
  const [formData, setFormData] = useState<Partial<EmailCampaign>>({
    ...campaign,
    totalRecipients: 1500 // Mock recipients count
  })

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData as Omit<EmailCampaign, 'id' | 'createdAt' | 'updatedAt'>)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="basic">Básico</TabsTrigger>
          <TabsTrigger value="content">Conteúdo</TabsTrigger>
          <TabsTrigger value="audience">Audiência</TabsTrigger>
          <TabsTrigger value="settings">Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da Campanha *</Label>
            <Input
              id="name"
              value={formData.name || ''}
              onChange={(e) => updateField('name', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Assunto do E-mail *</Label>
            <Input
              id="subject"
              value={formData.subject || ''}
              onChange={(e) => updateField('subject', e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Tipo da Campanha</Label>
              <Select value={formData.type} onValueChange={(value) => updateField('type', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {campaignTypes.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fromName">Nome do Remetente</Label>
              <Input
                id="fromName"
                value={formData.fromName || ''}
                onChange={(e) => updateField('fromName', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fromEmail">E-mail do Remetente</Label>
              <Input
                id="fromEmail"
                type="email"
                value={formData.fromEmail || ''}
                onChange={(e) => updateField('fromEmail', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="replyTo">Responder Para</Label>
              <Input
                id="replyTo"
                type="email"
                value={formData.replyTo || ''}
                onChange={(e) => updateField('replyTo', e.target.value)}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="content" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="content">Conteúdo do E-mail *</Label>
            <Textarea
              id="content"
              rows={10}
              value={formData.content || ''}
              onChange={(e) => updateField('content', e.target.value)}
              placeholder="Digite o conteúdo do seu e-mail aqui..."
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="htmlContent">HTML (Opcional)</Label>
            <Textarea
              id="htmlContent"
              rows={6}
              value={formData.htmlContent || ''}
              onChange={(e) => updateField('htmlContent', e.target.value)}
              placeholder="Versão HTML do e-mail (opcional)"
            />
          </div>
        </TabsContent>

        <TabsContent value="audience" className="space-y-4">
          <div className="space-y-4">
            <div>
              <Label>Segmentos de Audiência</Label>
              <p className="text-sm text-muted-foreground mb-3">
                Selecione os segmentos que receberão esta campanha
              </p>

              <div className="space-y-2">
                {segments.length > 0 ? (
                  segments.map(segment => (
                    <div key={segment.id} className="flex items-center space-x-2 p-3 border rounded">
                      <input
                        type="checkbox"
                        id={segment.id}
                        checked={formData.segmentIds?.includes(segment.id) || false}
                        onChange={(e) => {
                          const currentSegments = formData.segmentIds || []
                          if (e.target.checked) {
                            updateField('segmentIds', [...currentSegments, segment.id])
                          } else {
                            updateField('segmentIds', currentSegments.filter(id => id !== segment.id))
                          }
                        }}
                      />
                      <div className="flex-1">
                        <Label htmlFor={segment.id} className="font-medium cursor-pointer">
                          {segment.name}
                        </Label>
                        <p className="text-sm text-muted-foreground">{segment.description}</p>
                        <p className="text-xs text-muted-foreground">{segment.contactsCount} contatos</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6">
                    <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Nenhum segmento criado ainda. Enviando para todos os contatos.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <span className="font-medium">Total de Destinatários:</span>
                <span className="text-lg font-bold">{formData.totalRecipients?.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="sendImmediately"
                checked={formData.sendImmediately || false}
                onCheckedChange={(checked) => updateField('sendImmediately', checked)}
              />
              <Label htmlFor="sendImmediately">Enviar imediatamente</Label>
            </div>

            {!formData.sendImmediately && (
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Agendar para</Label>
                <Input
                  id="scheduledAt"
                  type="datetime-local"
                  value={formData.scheduledAt || ''}
                  onChange={(e) => updateField('scheduledAt', e.target.value)}
                />
              </div>
            )}

            <Separator />

            <div className="space-y-4">
              <h4 className="font-medium">Opções de Rastreamento</h4>

              <div className="flex items-center space-x-2">
                <Switch
                  id="trackOpens"
                  checked={formData.trackOpens || false}
                  onCheckedChange={(checked) => updateField('trackOpens', checked)}
                />
                <Label htmlFor="trackOpens">Rastrear aberturas</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="trackClicks"
                  checked={formData.trackClicks || false}
                  onCheckedChange={(checked) => updateField('trackClicks', checked)}
                />
                <Label htmlFor="trackClicks">Rastrear cliques</Label>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="isABTest"
                  checked={formData.isABTest || false}
                  onCheckedChange={(checked) => updateField('isABTest', checked)}
                />
                <Label htmlFor="isABTest">Teste A/B</Label>
              </div>

              {formData.isABTest && (
                <div className="space-y-2">
                  <Label htmlFor="abTestSubjects">Assuntos para Teste A/B (um por linha)</Label>
                  <Textarea
                    id="abTestSubjects"
                    rows={3}
                    value={formData.abTestSubjects?.join('\n') || ''}
                    onChange={(e) => updateField('abTestSubjects', e.target.value.split('\n').filter(Boolean))}
                    placeholder="Assunto Versão A&#10;Assunto Versão B"
                  />

                  <div className="space-y-2">
                    <Label htmlFor="abTestPercentage">Porcentagem para Teste (%)</Label>
                    <Input
                      id="abTestPercentage"
                      type="number"
                      value={formData.abTestPercentage || 50}
                      onChange={(e) => updateField('abTestPercentage', Number(e.target.value))}
                      min="10"
                      max="90"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end space-x-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">
          Salvar Campanha
        </Button>
      </div>
    </form>
  )
}

interface CampaignDetailsProps {
  campaign: EmailCampaign
}

function CampaignDetails({ campaign }: CampaignDetailsProps) {
  // Local helper duplicates to avoid scope issues
  const statusInfo = statusOptions.find(s => s.value === campaign.status) || statusOptions[0]
  const typeInfo = campaignTypes.find(t => t.value === campaign.type) || campaignTypes[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-2xl font-bold">{campaign.name}</h3>
          <p className="text-muted-foreground">{campaign.subject}</p>
          <div className="flex items-center space-x-2 mt-2">
            <Badge variant="outline" className={statusInfo.color}>
              {statusInfo.label}
            </Badge>
            <Badge variant="outline" className="bg-blue-100 text-blue-800">
              {typeInfo.label}
            </Badge>
          </div>
        </div>
      </div>

      {/* Stats for sent campaigns */}
      {campaign.status === 'sent' && (
        <Card>
          <CardHeader>
            <CardTitle>Resultados da Campanha</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{campaign.openRate.toFixed(1)}%</p>
                <p className="text-sm text-muted-foreground">Taxa de Abertura</p>
                <p className="text-xs text-muted-foreground">{campaign.opened.toLocaleString()} abertos</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{campaign.clickRate.toFixed(1)}%</p>
                <p className="text-sm text-muted-foreground">Taxa de Clique</p>
                <p className="text-xs text-muted-foreground">{campaign.clicked.toLocaleString()} cliques</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-orange-600">{campaign.bounceRate.toFixed(1)}%</p>
                <p className="text-sm text-muted-foreground">Taxa de Rejeição</p>
                <p className="text-xs text-muted-foreground">{campaign.bounced.toLocaleString()} rejeitados</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-600">{campaign.unsubscribeRate.toFixed(1)}%</p>
                <p className="text-sm text-muted-foreground">Taxa de Descadastro</p>
                <p className="text-xs text-muted-foreground">{campaign.unsubscribed.toLocaleString()} descadastros</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Campaign Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">Informações da Campanha</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Tipo:</span>
                <span>{typeInfo.label}</span>
              </div>
              <div className="flex justify-between">
                <span>Destinatários:</span>
                <span>{campaign.totalRecipients.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Remetente:</span>
                <span>{campaign.fromName} &lt;{campaign.fromEmail}&gt;</span>
              </div>
              <div className="flex justify-between">
                <span>Responder para:</span>
                <span>{campaign.replyTo}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">Configurações</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Rastreamento:</span>
                <div className="space-x-2">
                  {campaign.trackOpens && <Badge variant="secondary">Aberturas</Badge>}
                  {campaign.trackClicks && <Badge variant="secondary">Cliques</Badge>}
                </div>
              </div>
              {campaign.isABTest && (
                <div className="flex justify-between">
                  <span>Teste A/B:</span>
                  <Badge variant="secondary">Ativo ({campaign.abTestPercentage}%)</Badge>
                </div>
              )}
              {campaign.scheduledAt && (
                <div className="flex justify-between">
                  <span>Agendada:</span>
                  <span>{new Date(campaign.scheduledAt).toLocaleString('pt-BR')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Conteúdo do E-mail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h5 className="font-medium">Assunto:</h5>
              <p className="text-lg">{campaign.subject}</p>
            </div>
            <Separator />
            <div>
              <h5 className="font-medium mb-2">Conteúdo:</h5>
              <div className="bg-muted p-4 rounded-lg">
                <pre className="whitespace-pre-wrap text-sm">{campaign.content}</pre>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timestamps */}
      <div className="pt-4 border-t text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Criada em: {new Date(campaign.createdAt).toLocaleString('pt-BR')}</span>
          {campaign.sentAt && (
            <span>Enviada em: {new Date(campaign.sentAt).toLocaleString('pt-BR')}</span>
          )}
        </div>
      </div>
    </div>
  )
}
