import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { toast } from 'sonner'
import {
  InstagramLogo,
  FacebookLogo,
  WhatsappLogo,
  ChatCircle,
  Lightning,
  Robot,
  Target,
  TrendUp,
  Users,
  Eye,
  Heart,
  Share,
  Clock,
  Bell,
  Star,
  CheckCircle,
  Warning,
  X,
  Play,
  Pause,
  ArrowRight,
  ChartLineUp,
  Crown,
  Fire,
  Globe
} from "@phosphor-icons/react"

interface UnifiedMetrics {
  totalFollowers: number
  totalEngagement: number
  totalReach: number
  totalConversions: number
  realtimeViews: number
  activeConversations: number
  unreadMessages: number
  scheduledPosts: number
}

interface CrossPlatformCampaign {
  id: string
  name: string
  platforms: ('facebook' | 'instagram' | 'whatsapp' | 'threads')[]
  status: 'active' | 'paused' | 'completed' | 'draft'
  startDate: Date
  endDate: Date
  budget: number
  spent: number
  metrics: {
    reach: number
    impressions: number
    clicks: number
    conversions: number
    leads: number
    revenue: number
  }
  content: {
    posts: number
    stories: number
    reels: number
    messages: number
  }
}

interface RealTimeAlert {
  id: string
  platform: 'facebook' | 'instagram' | 'whatsapp' | 'threads'
  type: 'mention' | 'comment' | 'message' | 'review' | 'crisis' | 'opportunity'
  priority: 'low' | 'medium' | 'high' | 'critical'
  title: string
  content: string
  timestamp: Date
  isRead: boolean
  actionRequired: boolean
  relatedContent?: {
    id: string
    type: string
    url?: string
  }
}

interface MetaIntegrationStatus {
  facebook: {
    connected: boolean
    pages: number
    lastSync: Date
    permissions: string[]
    health: 'good' | 'warning' | 'error'
  }
  instagram: {
    connected: boolean
    accounts: number
    lastSync: Date
    permissions: string[]
    health: 'good' | 'warning' | 'error'
  }
  whatsapp: {
    connected: boolean
    businessAccounts: number
    lastSync: Date
    permissions: string[]
    health: 'good' | 'warning' | 'error'
  }
  threads: {
    connected: boolean
    accounts: number
    lastSync: Date
    permissions: string[]
    health: 'good' | 'warning' | 'error'
  }
}

export function MetaCommandCenter() {
  const [activeTab, setActiveTab] = useState("overview")
  const [campaigns, setCampaigns] = useKV<CrossPlatformCampaign[]>("meta-campaigns-unified", [])
  const [alerts, setAlerts] = useKV<RealTimeAlert[]>("meta-alerts-realtime", [])
  const [integrationStatus, setIntegrationStatus] = useKV<MetaIntegrationStatus>("meta-integration-status", {
    facebook: { connected: true, pages: 3, lastSync: new Date(), permissions: ['read', 'write', 'ads'], health: 'good' },
    instagram: { connected: true, accounts: 2, lastSync: new Date(), permissions: ['read', 'write', 'insights'], health: 'good' },
    whatsapp: { connected: true, businessAccounts: 1, lastSync: new Date(), permissions: ['read', 'write', 'webhook'], health: 'warning' },
    threads: { connected: false, accounts: 0, lastSync: new Date(), permissions: [], health: 'error' }
  })
  const [selectedTimeframe, setSelectedTimeframe] = useState("7d")

  // Mock data initialization
  useEffect(() => {
    if (campaigns.length === 0) {
      setCampaigns([
        {
          id: "campaign_1",
          name: "Q1 2025 - Lançamento Produto",
          platforms: ["facebook", "instagram", "threads"],
          status: "active",
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60000),
          endDate: new Date(Date.now() + 23 * 24 * 60 * 60000),
          budget: 50000,
          spent: 18750,
          metrics: {
            reach: 125000,
            impressions: 450000,
            clicks: 8900,
            conversions: 234,
            leads: 156,
            revenue: 78000
          },
          content: {
            posts: 24,
            stories: 18,
            reels: 6,
            messages: 340
          }
        },
        {
          id: "campaign_2",
          name: "Retargeting - Abandoned Carts",
          platforms: ["facebook", "instagram", "whatsapp"],
          status: "active",
          startDate: new Date(Date.now() - 15 * 24 * 60 * 60000),
          endDate: new Date(Date.now() + 15 * 24 * 60 * 60000),
          budget: 25000,
          spent: 12800,
          metrics: {
            reach: 45000,
            impressions: 180000,
            clicks: 2100,
            conversions: 89,
            leads: 67,
            revenue: 34500
          },
          content: {
            posts: 12,
            stories: 8,
            reels: 3,
            messages: 89
          }
        }
      ])
    }

    if (alerts.length === 0) {
      setAlerts([
        {
          id: "alert_1",
          platform: "instagram",
          type: "mention",
          priority: "high",
          title: "Menção viral detectada",
          content: "Seu produto foi mencionado em um post que está viralizando (15K likes em 2h)",
          timestamp: new Date(Date.now() - 15 * 60000),
          isRead: false,
          actionRequired: true,
          relatedContent: {
            id: "post_viral_1",
            type: "post",
            url: "https://instagram.com/p/viral-post"
          }
        },
        {
          id: "alert_2",
          platform: "whatsapp",
          type: "crisis",
          priority: "critical",
          title: "Pico de reclamações",
          content: "Aumento de 400% em mensagens de suporte nas últimas 2 horas",
          timestamp: new Date(Date.now() - 45 * 60000),
          isRead: false,
          actionRequired: true
        },
        {
          id: "alert_3",
          platform: "facebook",
          type: "opportunity",
          priority: "medium",
          title: "Competitor mention",
          content: "Usuários comparando você favoravelmente com concorrente principal",
          timestamp: new Date(Date.now() - 90 * 60000),
          isRead: false,
          actionRequired: false
        },
        {
          id: "alert_4",
          platform: "threads",
          type: "comment",
          priority: "low",
          title: "Thread em destaque",
          content: "Seu thread sobre IA está ganhando tração (+200 replies)",
          timestamp: new Date(Date.now() - 120 * 60000),
          isRead: true,
          actionRequired: false
        }
      ])
    }
  }, [campaigns.length, alerts.length, setCampaigns, setAlerts])

  // Calculate unified metrics
  const unifiedMetrics: UnifiedMetrics = {
    totalFollowers: 125600, // Sum from all platforms
    totalEngagement: campaigns.reduce((sum, c) => sum + c.metrics.clicks, 0),
    totalReach: campaigns.reduce((sum, c) => sum + c.metrics.reach, 0),
    totalConversions: campaigns.reduce((sum, c) => sum + c.metrics.conversions, 0),
    realtimeViews: 2840,
    activeConversations: 23,
    unreadMessages: alerts.filter(a => !a.isRead).length,
    scheduledPosts: 12
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const formatTime = (input: Date | string | number) => {
    const date = input instanceof Date ? input : new Date(input)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)

    if (minutes < 60) return `${minutes}m`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
    return `${Math.floor(minutes / 1440)}d`
  }

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'facebook': return FacebookLogo
      case 'instagram': return InstagramLogo
      case 'whatsapp': return WhatsappLogo
      case 'threads': return ChatCircle
      default: return Globe
    }
  }

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'facebook': return 'text-blue-600'
      case 'instagram': return 'text-pink-600'
      case 'whatsapp': return 'text-green-600'
      case 'threads': return 'text-purple-600'
      default: return 'text-gray-600'
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200'
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getHealthIcon = (health: string) => {
    switch (health) {
      case 'good': return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'warning': return <Warning className="h-4 w-4 text-yellow-600" />
      case 'error': return <X className="h-4 w-4 text-red-600" />
      default: return <Clock className="h-4 w-4 text-gray-600" />
    }
  }

  const markAlertAsRead = (alertId: string) => {
    setAlerts(current =>
      current.map(alert =>
        alert.id === alertId ? { ...alert, isRead: true } : alert
      )
    )
  }

  const pauseCampaign = (campaignId: string) => {
    setCampaigns(current =>
      current.map(campaign =>
        campaign.id === campaignId
          ? { ...campaign, status: campaign.status === 'active' ? 'paused' : 'active' }
          : campaign
      )
    )
    toast.success("Status da campanha alterado!")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <div className="flex -space-x-2">
              <FacebookLogo className="h-6 w-6 text-blue-600 z-10" />
              <InstagramLogo className="h-6 w-6 text-pink-600 z-20" />
              <WhatsappLogo className="h-6 w-6 text-green-600 z-30" />
              <ChatCircle className="h-6 w-6 text-purple-600 z-40" />
            </div>
            <span>Meta Command Center</span>
          </h2>
          <p className="text-muted-foreground">
            Central unificada para todas as integrações Meta
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Select value={selectedTimeframe} onValueChange={setSelectedTimeframe}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">Hoje</SelectItem>
              <SelectItem value="7d">7 dias</SelectItem>
              <SelectItem value="30d">30 dias</SelectItem>
              <SelectItem value="90d">90 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Lightning className="h-4 w-4 mr-2" />
            Sincronizar
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
          <TabsTrigger value="alerts">Alertas</TabsTrigger>
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Real-time Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  <div>
                    <div className="text-2xl font-bold">{formatNumber(unifiedMetrics.totalFollowers)}</div>
                    <div className="text-sm text-muted-foreground">Total Seguidores</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <TrendUp className="h-5 w-5 text-green-600" />
                  <div>
                    <div className="text-2xl font-bold">{formatNumber(unifiedMetrics.totalEngagement)}</div>
                    <div className="text-sm text-muted-foreground">Engajamento</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Eye className="h-5 w-5 text-purple-600" />
                  <div>
                    <div className="text-2xl font-bold">{formatNumber(unifiedMetrics.totalReach)}</div>
                    <div className="text-sm text-muted-foreground">Alcance Total</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center space-x-2">
                  <Target className="h-5 w-5 text-orange-600" />
                  <div>
                    <div className="text-2xl font-bold">{unifiedMetrics.totalConversions}</div>
                    <div className="text-sm text-muted-foreground">Conversões</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Real-time Pulse Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Atividade em Tempo Real</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-sm text-green-600">Ao vivo</span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-3">
                    {[
                      { platform: 'instagram', action: 'Novo comentário em post promocional', time: '2min', icon: Heart },
                      { platform: 'whatsapp', action: 'Lead qualificado iniciou conversa', time: '5min', icon: Star },
                      { platform: 'facebook', action: 'Post compartilhado 15 vezes', time: '8min', icon: Share },
                      { platform: 'threads', action: 'Menção em thread viral', time: '12min', icon: Fire },
                      { platform: 'instagram', action: 'Story visualizada 500 vezes', time: '15min', icon: Eye },
                      { platform: 'whatsapp', action: 'Campanha de broadcast enviada', time: '18min', icon: Lightning }
                    ].map((activity, index) => {
                      const IconComponent = getPlatformIcon(activity.platform)
                      const ActionIcon = activity.icon
                      const colorClass = getPlatformColor(activity.platform)

                      return (
                        <div key={index} className="flex items-center space-x-3 p-3 rounded-lg bg-muted/30">
                          <div className="relative">
                            <IconComponent className={`h-6 w-6 ${colorClass}`} />
                            <ActionIcon className="h-3 w-3 absolute -bottom-1 -right-1 bg-background rounded-full p-0.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{activity.action}</p>
                            <p className="text-xs text-muted-foreground">{activity.time} atrás</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Top Performing Content</CardTitle>
                <CardDescription>Conteúdo com melhor performance nas últimas 24h</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    {
                      platform: 'instagram',
                      type: 'Reel',
                      title: 'Tutorial CRM em 60 segundos',
                      metrics: { views: 45600, likes: 3200, shares: 840 }
                    },
                    {
                      platform: 'facebook',
                      type: 'Post',
                      title: 'Case de sucesso - Cliente XYZ',
                      metrics: { views: 12400, likes: 890, shares: 156 }
                    },
                    {
                      platform: 'threads',
                      type: 'Thread',
                      title: 'Thread sobre automação de vendas',
                      metrics: { views: 8900, likes: 567, shares: 89 }
                    }
                  ].map((content, index) => {
                    const IconComponent = getPlatformIcon(content.platform)
                    const colorClass = getPlatformColor(content.platform)

                    return (
                      <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center space-x-3">
                          <IconComponent className={`h-5 w-5 ${colorClass}`} />
                          <div>
                            <p className="font-medium text-sm">{content.title}</p>
                            <p className="text-xs text-muted-foreground capitalize">{content.type} • {content.platform}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">{formatNumber(content.metrics.views)} views</p>
                          <p className="text-xs text-muted-foreground">
                            {formatNumber(content.metrics.likes)} ❤️ {formatNumber(content.metrics.shares)} 🔄
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="campaigns" className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            {campaigns.map((campaign) => (
              <Card key={campaign.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center space-x-2">
                        <span>{campaign.name}</span>
                        <Badge variant={campaign.status === 'active' ? 'default' : 'secondary'}>
                          {campaign.status === 'active' ? 'Ativa' :
                            campaign.status === 'paused' ? 'Pausada' :
                              campaign.status === 'completed' ? 'Concluída' : 'Rascunho'}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="flex items-center space-x-4">
                        <span>Orçamento: R$ {campaign.budget.toLocaleString()}</span>
                        <span>Gasto: R$ {campaign.spent.toLocaleString()}</span>
                        <div className="flex items-center space-x-1">
                          {campaign.platforms.map(platform => {
                            const IconComponent = getPlatformIcon(platform)
                            const colorClass = getPlatformColor(platform)
                            return (
                              <IconComponent key={platform} className={`h-4 w-4 ${colorClass}`} />
                            )
                          })}
                        </div>
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => pauseCampaign(campaign.id)}
                    >
                      {campaign.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Budget Progress */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Progresso do Orçamento</span>
                        <span>{((campaign.spent / campaign.budget) * 100).toFixed(1)}%</span>
                      </div>
                      <Progress value={(campaign.spent / campaign.budget) * 100} className="h-2" />
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                      <div className="text-center">
                        <div className="text-lg font-bold text-blue-600">{formatNumber(campaign.metrics.reach)}</div>
                        <div className="text-xs text-muted-foreground">Alcance</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-600">{formatNumber(campaign.metrics.impressions)}</div>
                        <div className="text-xs text-muted-foreground">Impressões</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-orange-600">{formatNumber(campaign.metrics.clicks)}</div>
                        <div className="text-xs text-muted-foreground">Cliques</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-purple-600">{campaign.metrics.conversions}</div>
                        <div className="text-xs text-muted-foreground">Conversões</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-red-600">{campaign.metrics.leads}</div>
                        <div className="text-xs text-muted-foreground">Leads</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-700">R$ {formatNumber(campaign.metrics.revenue)}</div>
                        <div className="text-xs text-muted-foreground">Receita</div>
                      </div>
                    </div>

                    {/* Content Stats */}
                    <div className="grid grid-cols-4 gap-4 pt-4 border-t">
                      <div className="text-center">
                        <div className="font-semibold">{campaign.content.posts}</div>
                        <div className="text-xs text-muted-foreground">Posts</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold">{campaign.content.stories}</div>
                        <div className="text-xs text-muted-foreground">Stories</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold">{campaign.content.reels}</div>
                        <div className="text-xs text-muted-foreground">Reels</div>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold">{campaign.content.messages}</div>
                        <div className="text-xs text-muted-foreground">Mensagens</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Alertas em Tempo Real</h3>
              <p className="text-muted-foreground">
                {alerts.filter(a => !a.isRead).length} alertas não lidos
              </p>
            </div>
            <Button variant="outline" onClick={() => setAlerts(current => current.map(a => ({ ...a, isRead: true })))}>
              Marcar Todos como Lidos
            </Button>
          </div>

          <div className="space-y-4">
            {alerts.map((alert) => {
              const IconComponent = getPlatformIcon(alert.platform)
              const colorClass = getPlatformColor(alert.platform)
              const priorityClass = getPriorityColor(alert.priority)

              return (
                <Card key={alert.id} className={`glass-card ${alert.isRead ? 'opacity-60' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start space-x-4">
                      <div className="flex-shrink-0">
                        <IconComponent className={`h-6 w-6 ${colorClass}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <h4 className="font-medium">{alert.title}</h4>
                            <Badge className={`text-xs ${priorityClass}`}>
                              {alert.priority === 'critical' ? 'Crítico' :
                                alert.priority === 'high' ? 'Alto' :
                                  alert.priority === 'medium' ? 'Médio' : 'Baixo'}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatTime(alert.timestamp)} atrás
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{alert.content}</p>
                        <div className="flex items-center justify-between mt-3">
                          <div className="text-xs text-muted-foreground capitalize">
                            {alert.platform} • {alert.type}
                          </div>
                          <div className="flex items-center space-x-2">
                            {!alert.isRead && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => markAlertAsRead(alert.id)}
                              >
                                Marcar como Lido
                              </Button>
                            )}
                            {alert.actionRequired && (
                              <Button size="sm">
                                Ação Necessária
                                <ArrowRight className="h-3 w-3 ml-1" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(integrationStatus).map(([platform, status]) => {
              const IconComponent = getPlatformIcon(platform)
              const colorClass = getPlatformColor(platform)
              const healthIcon = getHealthIcon(status.health)

              return (
                <Card key={platform} className="glass-card">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <IconComponent className={`h-6 w-6 ${colorClass}`} />
                        <div>
                          <CardTitle className="capitalize">{platform}</CardTitle>
                          <CardDescription>
                            {status.connected ? 'Conectado' : 'Desconectado'}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {healthIcon}
                        <Badge variant={status.connected ? 'default' : 'secondary'}>
                          {status.connected ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Contas/Páginas:</span>
                        <div className="font-medium">
                          {platform === 'facebook' ? status.pages :
                            platform === 'instagram' ? status.accounts :
                              platform === 'whatsapp' ? status.businessAccounts :
                                status.accounts}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Última Sinc:</span>
                        <div className="font-medium">{formatTime(status.lastSync)} atrás</div>
                      </div>
                    </div>

                    <div>
                      <span className="text-sm text-muted-foreground">Permissões:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {status.permissions.map(permission => (
                          <Badge key={permission} variant="outline" className="text-xs">
                            {permission}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="text-xs text-muted-foreground">
                        Status: {status.health === 'good' ? 'Saudável' :
                          status.health === 'warning' ? 'Atenção' : 'Erro'}
                      </div>
                      <Button variant="outline" size="sm">
                        {status.connected ? 'Reconfigurar' : 'Conectar'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <ChartLineUp className="h-5 w-5" />
                <span>Insights Cross-Platform</span>
              </CardTitle>
              <CardDescription>
                Análises avançadas com IA para otimizar sua estratégia Meta
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-4 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg border border-blue-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <Robot className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-800">Recomendação IA</span>
                  </div>
                  <div className="text-sm text-blue-700">
                    <p className="font-medium">Otimizar horários de posting</p>
                    <p className="mt-1">Posts às 14h30 têm 34% mais engajamento no Instagram</p>
                  </div>
                </div>

                <div className="p-4 bg-gradient-to-r from-green-50 to-green-100 rounded-lg border border-green-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <TrendUp className="h-4 w-4 text-green-600" />
                    <span className="font-medium text-green-800">Tendência Positiva</span>
                  </div>
                  <div className="text-sm text-green-700">
                    <p className="font-medium">Crescimento no WhatsApp</p>
                    <p className="mt-1">Taxa de conversão aumentou 28% na última semana</p>
                  </div>
                </div>

                <div className="p-4 bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg border border-purple-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <Fire className="h-4 w-4 text-purple-600" />
                    <span className="font-medium text-purple-800">Oportunidade</span>
                  </div>
                  <div className="text-sm text-purple-700">
                    <p className="font-medium">Threads em ascensão</p>
                    <p className="mt-1">Engajamento 156% acima da média da indústria</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-3">Performance por Plataforma</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-2">
                        <InstagramLogo className="h-4 w-4 text-pink-600" />
                        <span className="text-sm">Instagram</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">87% CTR</div>
                        <div className="text-xs text-green-600">+12% vs. última semana</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-2">
                        <WhatsappLogo className="h-4 w-4 text-green-600" />
                        <span className="text-sm">WhatsApp</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">94% Open Rate</div>
                        <div className="text-xs text-green-600">+8% vs. última semana</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-2">
                        <FacebookLogo className="h-4 w-4 text-blue-600" />
                        <span className="text-sm">Facebook</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">72% Reach</div>
                        <div className="text-xs text-red-600">-3% vs. última semana</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-2">
                        <ChatCircle className="h-4 w-4 text-purple-600" />
                        <span className="text-sm">Threads</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">156% Engagement</div>
                        <div className="text-xs text-green-600">+45% vs. última semana</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-3">Recomendações de Conteúdo</h4>
                  <div className="space-y-3">
                    <div className="p-3 border rounded-lg">
                      <div className="flex items-center space-x-2 mb-1">
                        <Crown className="h-4 w-4 text-yellow-600" />
                        <span className="font-medium text-sm">Top Hashtag</span>
                      </div>
                      <p className="text-xs text-muted-foreground">#AutomaçãoCRM está trending - use em próximos posts</p>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="flex items-center space-x-2 mb-1">
                        <Fire className="h-4 w-4 text-orange-600" />
                        <span className="font-medium text-sm">Formato Viral</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Carrossel com tips está performando +89% acima da média</p>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="flex items-center space-x-2 mb-1">
                        <Target className="h-4 w-4 text-green-600" />
                        <span className="font-medium text-sm">Audiência Ativa</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Terças 14h30 - 18h30 têm maior engajamento</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
