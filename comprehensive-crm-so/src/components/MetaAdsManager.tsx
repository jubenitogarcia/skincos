import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { toast } from 'sonner'
import {
  FacebookLogo,
  InstagramLogo,
  Target,
  TrendUp,
  Users,
  Eye,
  CurrencyDollar,
  CalendarBlank,
  Plus,
  Play,
  Pause,
  Stop,
  Gear,
  ChartPie,
  Lightning,
  Robot,
  Image as ImageIcon,
  Video,
  CaretDown,
  Warning,
  CheckCircle,
  Clock
} from "@phosphor-icons/react"

interface MetaAdCampaign {
  id: string
  name: string
  objective: 'AWARENESS' | 'TRAFFIC' | 'ENGAGEMENT' | 'LEADS' | 'APP_PROMOTION' | 'SALES'
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED'
  budget_type: 'DAILY' | 'LIFETIME'
  budget: number
  spent: number
  start_time: Date
  end_time?: Date
  platforms: ('facebook' | 'instagram' | 'audience_network' | 'messenger')[]
  targeting: {
    age_min: number
    age_max: number
    genders: number[]
    locations: string[]
    interests: string[]
    behaviors: string[]
    custom_audiences: string[]
    lookalike_audiences: string[]
  }
  performance: {
    reach: number
    impressions: number
    clicks: number
    ctr: number
    cpc: number
    cpm: number
    conversions: number
    conversion_rate: number
    roas: number
  }
  ad_sets: MetaAdSet[]
}

interface MetaAdSet {
  id: string
  name: string
  campaign_id: string
  status: 'ACTIVE' | 'PAUSED' | 'DELETED'
  budget: number
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP' | 'LOWEST_COST_WITH_BID_CAP' | 'TARGET_COST'
  bid_amount?: number
  optimization_goal: 'REACH' | 'IMPRESSIONS' | 'CLICKS' | 'CONVERSIONS'
  targeting: any
  ads: MetaAd[]
}

interface MetaAd {
  id: string
  name: string
  adset_id: string
  status: 'ACTIVE' | 'PAUSED' | 'DELETED'
  creative: {
    title: string
    body: string
    image_url?: string
    video_url?: string
    call_to_action: string
    website_url?: string
  }
  performance: {
    reach: number
    impressions: number
    clicks: number
    conversions: number
    spend: number
  }
}

interface AudienceInsight {
  id: string
  name: string
  size: number
  demographics: {
    age: { [key: string]: number }
    gender: { [key: string]: number }
    location: { [key: string]: number }
  }
  interests: string[]
  overlap_score?: number
}

export function MetaAdsManager() {
  const [activeTab, setActiveTab] = useState("campaigns")
  const [campaigns, setCampaigns] = useKV<MetaAdCampaign[]>("meta-campaigns", [])
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null)
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false)
  const [audienceInsights, setAudienceInsights] = useKV<AudienceInsight[]>("audience-insights", [])

  // Mock data initialization
  useEffect(() => {
    if (campaigns.length === 0) {
      setCampaigns([
        {
          id: "camp_1",
          name: "Campanha CRM Q1 2025",
          objective: "LEADS",
          status: "ACTIVE",
          budget_type: "DAILY",
          budget: 500,
          spent: 1750,
          start_time: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          end_time: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
          platforms: ["facebook", "instagram"],
          targeting: {
            age_min: 25,
            age_max: 55,
            genders: [1, 2],
            locations: ["BR", "US"],
            interests: ["CRM", "Business Software", "Sales"],
            behaviors: ["Business Decision Makers"],
            custom_audiences: [],
            lookalike_audiences: []
          },
          performance: {
            reach: 45000,
            impressions: 125000,
            clicks: 1250,
            ctr: 1.0,
            cpc: 1.40,
            cpm: 14.00,
            conversions: 89,
            conversion_rate: 7.12,
            roas: 3.2
          },
          ad_sets: [
            {
              id: "adset_1",
              name: "Interesse em CRM",
              campaign_id: "camp_1",
              status: "ACTIVE",
              budget: 250,
              bid_strategy: "LOWEST_COST_WITHOUT_CAP",
              optimization_goal: "CONVERSIONS",
              targeting: {},
              ads: [
                {
                  id: "ad_1",
                  name: "CRM Carousel",
                  adset_id: "adset_1",
                  status: "ACTIVE",
                  creative: {
                    title: "Revolucione suas Vendas",
                    body: "Descubra como nossa plataforma de CRM pode aumentar suas vendas em 40%",
                    image_url: "/api/placeholder/400/400",
                    call_to_action: "Saiba Mais",
                    website_url: "https://empresacrm.com/demo"
                  },
                  performance: {
                    reach: 25000,
                    impressions: 67000,
                    clicks: 670,
                    conversions: 48,
                    spend: 938
                  }
                }
              ]
            }
          ]
        },
        {
          id: "camp_2",
          name: "Retargeting Website",
          objective: "SALES",
          status: "ACTIVE",
          budget_type: "DAILY",
          budget: 200,
          spent: 840,
          start_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          platforms: ["facebook", "instagram"],
          targeting: {
            age_min: 25,
            age_max: 65,
            genders: [1, 2],
            locations: ["BR"],
            interests: [],
            behaviors: [],
            custom_audiences: ["website_visitors"],
            lookalike_audiences: []
          },
          performance: {
            reach: 8500,
            impressions: 34000,
            clicks: 425,
            ctr: 1.25,
            cpc: 1.98,
            cpm: 24.71,
            conversions: 23,
            conversion_rate: 5.41,
            roas: 4.1
          },
          ad_sets: []
        }
      ])
    }

    if (audienceInsights.length === 0) {
      setAudienceInsights([
        {
          id: "audience_1",
          name: "Decision Makers Tech",
          size: 2300000,
          demographics: {
            age: { "25-34": 35, "35-44": 40, "45-54": 20, "55+": 5 },
            gender: { "male": 65, "female": 35 },
            location: { "São Paulo": 30, "Rio de Janeiro": 15, "Outros": 55 }
          },
          interests: ["Business Software", "CRM", "Sales Automation", "Marketing Technology"],
          overlap_score: 0.75
        },
        {
          id: "audience_2",
          name: "Small Business Owners",
          size: 1800000,
          demographics: {
            age: { "25-34": 25, "35-44": 45, "45-54": 25, "55+": 5 },
            gender: { "male": 55, "female": 45 },
            location: { "São Paulo": 25, "Minas Gerais": 20, "Outros": 55 }
          },
          interests: ["Small Business", "Entrepreneurship", "Business Tools"],
          overlap_score: 0.45
        }
      ])
    }
  }, [campaigns.length, audienceInsights.length, setCampaigns, setAudienceInsights])

  const getObjectiveLabel = (objective: string) => {
    const labels = {
      'AWARENESS': 'Reconhecimento',
      'TRAFFIC': 'Tráfego',
      'ENGAGEMENT': 'Engajamento',
      'LEADS': 'Geração de Leads',
      'APP_PROMOTION': 'Promoção de App',
      'SALES': 'Vendas'
    }
    return labels[objective] || objective
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'text-green-600'
      case 'PAUSED': return 'text-yellow-600'
      case 'DELETED': return 'text-red-600'
      case 'ARCHIVED': return 'text-gray-600'
      default: return 'text-gray-600'
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const formatPercentage = (value: number) => {
    return `${value.toFixed(2)}%`
  }

  const pauseCampaign = (campaignId: string) => {
    setCampaigns(current =>
      current.map(camp =>
        camp.id === campaignId
          ? { ...camp, status: 'PAUSED' as const }
          : camp
      )
    )
    toast.success("Campanha pausada")
  }

  const resumeCampaign = (campaignId: string) => {
    setCampaigns(current =>
      current.map(camp =>
        camp.id === campaignId
          ? { ...camp, status: 'ACTIVE' as const }
          : camp
      )
    )
    toast.success("Campanha reativada")
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="text-center md:text-left">
          <h2 className="text-3xl font-bold text-white flex items-center justify-center md:justify-start gap-3 mb-3">
            <div className="relative">
              <div className="flex items-center gap-2">
                <FacebookLogo className="h-7 w-7 text-blue-400" />
                <InstagramLogo className="h-7 w-7 text-pink-400" />
              </div>
              <div className="absolute -inset-1 bg-blue-400/20 rounded-full blur opacity-75 animate-pulse"></div>
            </div>
            Meta Ads Manager
          </h2>
          <p className="text-blue-300/80 text-base leading-relaxed">
            Gerencie campanhas publicitárias no Facebook e Instagram
          </p>
        </div>
        <Dialog open={isCreatingCampaign} onOpenChange={setIsCreatingCampaign}>
          <DialogTrigger asChild>
            <Button className="glass-morphism border-blue-500/30 text-blue-300 hover:text-white hover:bg-blue-500/10 transition-all duration-300 hover:scale-105">
              <Plus className="h-4 w-4 mr-2" />
              Nova Campanha
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Criar Nova Campanha</DialogTitle>
              <DialogDescription>
                Configure uma nova campanha publicitária para Facebook e Instagram
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              {/* Campaign Creation Form would go here */}
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  Formulário de criação de campanha em desenvolvimento...
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
        <TabsList className="grid grid-cols-4 w-full max-w-3xl glass-morphism p-2 border-white/20 shadow-premium">
          <TabsTrigger 
            value="campaigns" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Campanhas
          </TabsTrigger>
          <TabsTrigger 
            value="audiences" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Audiências
          </TabsTrigger>
          <TabsTrigger 
            value="creatives" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Criativos
          </TabsTrigger>
          <TabsTrigger 
            value="insights" 
            className="glass-morphism-dark text-blue-100/80 data-[state=active]:text-white data-[state=active]:bg-white/[0.12] data-[state=active]:shadow-premium transition-all duration-300 hover:text-white hover:bg-white/[0.08]"
          >
            Insights
          </TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="space-y-6">
          {/* Campaign Performance Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Investido</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(campaigns.reduce((sum, camp) => sum + camp.spent, 0))}
                    </p>
                  </div>
                  <CurrencyDollar className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Alcance Total</p>
                    <p className="text-2xl font-bold">
                      {campaigns.reduce((sum, camp) => sum + camp.performance.reach, 0).toLocaleString()}
                    </p>
                  </div>
                  <Users className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Conversões</p>
                    <p className="text-2xl font-bold">
                      {campaigns.reduce((sum, camp) => sum + camp.performance.conversions, 0)}
                    </p>
                  </div>
                  <Target className="h-8 w-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">ROAS Médio</p>
                    <p className="text-2xl font-bold">
                      {(campaigns.reduce((sum, camp) => sum + camp.performance.roas, 0) / campaigns.length).toFixed(1)}x
                    </p>
                  </div>
                  <TrendUp className="h-8 w-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Campaigns List */}
          <div className="space-y-4">
            {campaigns.map((campaign) => (
              <Card key={campaign.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div>
                        <CardTitle className="flex items-center space-x-2">
                          <span>{campaign.name}</span>
                          <Badge variant="outline">{getObjectiveLabel(campaign.objective)}</Badge>
                        </CardTitle>
                        <CardDescription className="flex items-center space-x-4 mt-1">
                          <span className={getStatusColor(campaign.status)}>
                            {campaign.status === 'ACTIVE' ? 'Ativo' :
                              campaign.status === 'PAUSED' ? 'Pausado' :
                                campaign.status === 'DELETED' ? 'Deletado' : 'Arquivado'}
                          </span>
                          <span>•</span>
                          <span>{campaign.budget_type === 'DAILY' ? 'Diário' : 'Vitalício'}: {formatCurrency(campaign.budget)}</span>
                          <span>•</span>
                          <div className="flex space-x-1">
                            {campaign.platforms.map(platform => (
                              <div key={platform}>
                                {platform === 'facebook' && <FacebookLogo className="h-4 w-4 text-blue-600" />}
                                {platform === 'instagram' && <InstagramLogo className="h-4 w-4 text-pink-600" />}
                              </div>
                            ))}
                          </div>
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {campaign.status === 'ACTIVE' ? (
                        <Button variant="outline" size="sm" onClick={() => pauseCampaign(campaign.id)}>
                          <Pause className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => resumeCampaign(campaign.id)}>
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm">
                        <Gear className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-lg font-semibold text-blue-600">
                        {campaign.performance.reach.toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">Alcance</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-green-600">
                        {campaign.performance.impressions.toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">Impressões</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-orange-600">
                        {campaign.performance.clicks.toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">Cliques</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-purple-600">
                        {formatPercentage(campaign.performance.ctr)}
                      </div>
                      <div className="text-xs text-muted-foreground">CTR</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-red-600">
                        {formatCurrency(campaign.performance.cpc)}
                      </div>
                      <div className="text-xs text-muted-foreground">CPC</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-indigo-600">
                        {campaign.performance.roas.toFixed(1)}x
                      </div>
                      <div className="text-xs text-muted-foreground">ROAS</div>
                    </div>
                  </div>

                  {/* Budget Progress */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Orçamento utilizado</span>
                      <span>{formatCurrency(campaign.spent)} / {formatCurrency(campaign.budget * 30)}</span>
                    </div>
                    <Progress value={(campaign.spent / (campaign.budget * 30)) * 100} className="h-2" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="audiences" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Insights de Audiência</h3>
            <Button variant="outline">
              <Robot className="h-4 w-4 mr-2" />
              Gerar com IA
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {audienceInsights.map((audience) => (
              <Card key={audience.id} className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {audience.name}
                    <Badge variant="secondary">
                      {(audience.size / 1000000).toFixed(1)}M pessoas
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Demographics */}
                  <div>
                    <h4 className="font-medium mb-2">Faixa Etária</h4>
                    <div className="space-y-1">
                      {Object.entries(audience.demographics.age).map(([age, percentage]) => (
                        <div key={age} className="flex items-center justify-between">
                          <span className="text-sm">{age}</span>
                          <div className="flex items-center space-x-2">
                            <Progress value={percentage} className="w-20 h-2" />
                            <span className="text-sm text-muted-foreground">{percentage}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Interests */}
                  <div>
                    <h4 className="font-medium mb-2">Principais Interesses</h4>
                    <div className="flex flex-wrap gap-1">
                      {audience.interests.map((interest) => (
                        <Badge key={interest} variant="outline" className="text-xs">
                          {interest}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Overlap Score */}
                  {audience.overlap_score && (
                    <div>
                      <h4 className="font-medium mb-2">Score de Qualidade</h4>
                      <div className="flex items-center space-x-2">
                        <Progress value={audience.overlap_score * 100} className="flex-1 h-2" />
                        <span className="text-sm font-medium">
                          {Math.round(audience.overlap_score * 100)}%
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="creatives" className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Banco de Criativos</h3>
            <div className="flex space-x-2">
              <Button variant="outline">
                <ImageIcon className="h-4 w-4 mr-2" />
                Upload Imagem
              </Button>
              <Button variant="outline">
                <Video className="h-4 w-4 mr-2" />
                Upload Vídeo
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {/* Mock creative assets */}
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <Card key={item} className="glass-card">
                <CardContent className="p-0">
                  <div className="aspect-square bg-muted rounded-t-lg flex items-center justify-center">
                    <ImageIcon className="h-12 w-12 text-muted-foreground" />
                  </div>
                  <div className="p-4">
                    <h4 className="font-medium mb-1">Criativo {item}</h4>
                    <p className="text-sm text-muted-foreground mb-2">1200x1200px</p>
                    <div className="flex justify-between text-sm">
                      <span>CTR: 2.1%</span>
                      <span>Impressões: 45K</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <ChartPie className="h-5 w-5" />
                <span>Insights Avançados</span>
              </CardTitle>
              <CardDescription>
                Análise detalhada de performance e recomendações de otimização
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-medium flex items-center space-x-2">
                    <Lightning className="h-4 w-4 text-yellow-500" />
                    <span>Recomendações de Otimização</span>
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-start space-x-3 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                      <Warning className="h-4 w-4 text-yellow-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Aumentar Orçamento</p>
                        <p className="text-xs text-muted-foreground">
                          Campanha "CRM Q1 2025" está limitada por orçamento. Aumento de 30% pode gerar +40% conversões.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3 p-3 bg-green-50 rounded-lg border border-green-200">
                      <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Performance Excelente</p>
                        <p className="text-xs text-muted-foreground">
                          Criativo "CRM Carousel" tem CTR 35% acima da média do setor.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <Clock className="h-4 w-4 text-blue-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Horário de Pico</p>
                        <p className="text-xs text-muted-foreground">
                          Maior engajamento entre 14h-16h. Considere aumentar bid neste período.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">Comparativo Semanal</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Alcance</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium">+12.3%</span>
                        <TrendUp className="h-3 w-3 text-green-600" />
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">CTR</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium">+5.7%</span>
                        <TrendUp className="h-3 w-3 text-green-600" />
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">CPC</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium">-8.2%</span>
                        <CaretDown className="h-3 w-3 text-green-600" />
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">ROAS</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium">+18.9%</span>
                        <TrendUp className="h-3 w-3 text-green-600" />
                      </div>
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
