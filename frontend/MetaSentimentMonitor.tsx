import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { ScrollArea } from "@/scroll-area"
import { Progress } from "@/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { toast } from 'sonner'
import {
  InstagramLogo,
  FacebookLogo,
  WhatsappLogo,
  ChatCircle,
  Heart,
  SmileyMeh,
  SmileySad,
  TrendUp,
  TrendDown,
  Users,
  Eye,
  Bell,
  Warning,
  CheckCircle,
  X,
  At,
  Hash,
  Lightning,
  Robot,
  ChartLine,
  Clock,
  Globe,
  Fire,
  ThumbsUp,
  ThumbsDown
} from "@phosphor-icons/react"

interface Mention {
  id: string
  platform: 'facebook' | 'instagram' | 'whatsapp' | 'threads'
  type: 'mention' | 'hashtag' | 'direct_message' | 'comment' | 'review'
  content: string
  author: {
    username: string
    displayName: string
    avatar: string
    verified: boolean
    followers: number
  }
  timestamp: Date
  url?: string
  postId?: string
  sentiment: {
    score: number // -1 to 1
    label: 'positive' | 'negative' | 'neutral'
    confidence: number // 0 to 1
  }
  engagement: {
    likes: number
    shares: number
    comments: number
    reach: number
  }
  isRead: boolean
  priority: 'low' | 'medium' | 'high' | 'critical'
  keywords: string[]
  language: string
  location?: string
}

interface SentimentTrend {
  date: Date
  positive: number
  negative: number
  neutral: number
  total: number
}

interface KeywordTracking {
  keyword: string
  mentions: number
  sentiment: number
  trend: 'up' | 'down' | 'stable'
  trendPercentage: number
}

interface CrisisAlert {
  id: string
  type: 'sentiment_drop' | 'negative_spike' | 'viral_negative' | 'brand_crisis'
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  affectedPlatforms: string[]
  mentionsCount: number
  sentimentScore: number
  timestamp: Date
  isActive: boolean
  recommendations: string[]
}

export function MetaSentimentMonitor() {
  const [mentions, setMentions] = useKV<Mention[]>('meta-mentions', [])
  const [sentimentTrends, setSentimentTrends] = useKV<SentimentTrend[]>('sentiment-trends', [])
  const [keywordTracking, setKeywordTracking] = useKV<KeywordTracking[]>('keyword-tracking', [])
  const [crisisAlerts, setCrisisAlerts] = useKV<CrisisAlert[]>('crisis-alerts', [])
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h')
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [selectedSentiment, setSelectedSentiment] = useState('all')

  // Mock data initialization
  useEffect(() => {
    if (mentions.length === 0) {
      setMentions([
        {
          id: 'mention_1',
          platform: 'instagram',
          type: 'mention',
          content: 'Adorei o novo CRM da @empresacrm! Interface super intuitiva e funcionalidades incríveis. Recomendo! 🚀',
          author: {
            username: '@maritech',
            displayName: 'Maria Tech',
            avatar: '/api/placeholder/40/40',
            verified: true,
            followers: 15600
          },
          timestamp: new Date(Date.now() - 15 * 60000),
          url: 'https://instagram.com/p/mention1',
          sentiment: {
            score: 0.8,
            label: 'positive',
            confidence: 0.92
          },
          engagement: {
            likes: 234,
            shares: 45,
            comments: 28,
            reach: 8900
          },
          isRead: false,
          priority: 'high',
          keywords: ['CRM', 'interface', 'funcionalidades'],
          language: 'pt-BR'
        },
        {
          id: 'mention_2',
          platform: 'threads',
          type: 'mention',
          content: 'Problemas com o suporte da @empresacrm hoje. Aguardando resposta há 3 horas 😤',
          author: {
            username: '@joaodev',
            displayName: 'João Developer',
            avatar: '/api/placeholder/40/40',
            verified: false,
            followers: 890
          },
          timestamp: new Date(Date.now() - 45 * 60000),
          sentiment: {
            score: -0.6,
            label: 'negative',
            confidence: 0.87
          },
          engagement: {
            likes: 12,
            shares: 3,
            comments: 8,
            reach: 450
          },
          isRead: false,
          priority: 'critical',
          keywords: ['problemas', 'suporte'],
          language: 'pt-BR'
        },
        {
          id: 'mention_3',
          platform: 'facebook',
          type: 'comment',
          content: 'Interessante a automação de vendas. Vocês têm trial gratuito?',
          author: {
            username: '@carlosvendastech',
            displayName: 'Carlos Vendas',
            avatar: '/api/placeholder/40/40',
            verified: false,
            followers: 2300
          },
          timestamp: new Date(Date.now() - 90 * 60000),
          sentiment: {
            score: 0.2,
            label: 'neutral',
            confidence: 0.74
          },
          engagement: {
            likes: 8,
            shares: 1,
            comments: 3,
            reach: 340
          },
          isRead: true,
          priority: 'medium',
          keywords: ['automação', 'vendas', 'trial'],
          language: 'pt-BR'
        },
        {
          id: 'mention_4',
          platform: 'whatsapp',
          type: 'direct_message',
          content: 'Sistema muito bom! Conseguimos aumentar nossa conversão em 40% em 2 meses',
          author: {
            username: '+5511999888777',
            displayName: 'Ana Gestora',
            avatar: '/api/placeholder/40/40',
            verified: false,
            followers: 0
          },
          timestamp: new Date(Date.now() - 120 * 60000),
          sentiment: {
            score: 0.9,
            label: 'positive',
            confidence: 0.95
          },
          engagement: {
            likes: 0,
            shares: 0,
            comments: 0,
            reach: 1
          },
          isRead: false,
          priority: 'high',
          keywords: ['sistema', 'conversão', 'resultado'],
          language: 'pt-BR'
        }
      ])
    }

    if (sentimentTrends.length === 0) {
      const trends: SentimentTrend[] = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 60 * 60000)
        trends.push({
          date,
          positive: Math.floor(Math.random() * 50) + 30,
          negative: Math.floor(Math.random() * 20) + 5,
          neutral: Math.floor(Math.random() * 30) + 15,
          total: Math.floor(Math.random() * 100) + 50
        })
      }
      setSentimentTrends(trends)
    }

    if (keywordTracking.length === 0) {
      setKeywordTracking([
        { keyword: 'CRM', mentions: 45, sentiment: 0.7, trend: 'up', trendPercentage: 12 },
        { keyword: 'automação', mentions: 32, sentiment: 0.8, trend: 'up', trendPercentage: 25 },
        { keyword: 'suporte', mentions: 18, sentiment: -0.3, trend: 'down', trendPercentage: -8 },
        { keyword: 'vendas', mentions: 28, sentiment: 0.5, trend: 'stable', trendPercentage: 2 },
        { keyword: 'interface', mentions: 22, sentiment: 0.9, trend: 'up', trendPercentage: 18 }
      ])
    }

    if (crisisAlerts.length === 0) {
      setCrisisAlerts([
        {
          id: 'crisis_1',
          type: 'negative_spike',
          severity: 'medium',
          title: 'Aumento de Menções Negativas - Suporte',
          description: 'Detectado aumento de 300% em menções negativas relacionadas ao suporte nas últimas 2 horas',
          affectedPlatforms: ['instagram', 'threads'],
          mentionsCount: 12,
          sentimentScore: -0.65,
          timestamp: new Date(Date.now() - 30 * 60000),
          isActive: true,
          recommendations: [
            'Revisar fila de atendimento do suporte',
            'Publicar comunicado sobre status do sistema',
            'Ativar equipe de plantão'
          ]
        }
      ])
    }
  }, [mentions.length, sentimentTrends.length, keywordTracking.length, crisisAlerts.length, setMentions, setSentimentTrends, setKeywordTracking, setCrisisAlerts])

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

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return <Heart className="h-4 w-4 text-green-600" />
      case 'negative': return <SmileySad className="h-4 w-4 text-red-600" />
      case 'neutral': return <SmileyMeh className="h-4 w-4 text-gray-600" />
      default: return <SmileyMeh className="h-4 w-4 text-gray-600" />
    }
  }

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return 'bg-green-100 text-green-800 border-green-200'
      case 'negative': return 'bg-red-100 text-red-800 border-red-200'
      case 'neutral': return 'bg-gray-100 text-gray-800 border-gray-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
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

  const formatTime = (input: Date | string | number) => {
    const date = input instanceof Date ? input : new Date(input)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)

    if (minutes < 60) return `${minutes}m`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
    return `${Math.floor(minutes / 1440)}d`
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  // Funnel mentions based on selected filters
  const filteredMentions = mentions.filter(mention => {
    if (selectedPlatform !== 'all' && mention.platform !== selectedPlatform) return false
    if (selectedSentiment !== 'all' && mention.sentiment.label !== selectedSentiment) return false
    return true
  })

  // Calculate sentiment distribution
  const sentimentDistribution = {
    positive: mentions.filter(m => m.sentiment.label === 'positive').length,
    negative: mentions.filter(m => m.sentiment.label === 'negative').length,
    neutral: mentions.filter(m => m.sentiment.label === 'neutral').length
  }

  const totalMentions = sentimentDistribution.positive + sentimentDistribution.negative + sentimentDistribution.neutral
  const overallSentiment = totalMentions > 0 ?
    ((sentimentDistribution.positive - sentimentDistribution.negative) / totalMentions) : 0

  const markAsRead = (mentionId: string) => {
    setMentions(current =>
      current.map(mention =>
        mention.id === mentionId ? { ...mention, isRead: true } : mention
      )
    )
  }

  const dismissAlert = (alertId: string) => {
    setCrisisAlerts(current =>
      current.map(alert =>
        alert.id === alertId ? { ...alert, isActive: false } : alert
      )
    )
    toast.success('Alerta dismissado')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <ChartLine className="h-6 w-6 text-blue-600" />
            <span>Meta Sentiment Monitor</span>
          </h2>
          <p className="text-muted-foreground">
            Monitoramento em tempo real de sentimento e menções
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Select value={selectedTimeframe} onValueChange={setSelectedTimeframe}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">1 hora</SelectItem>
              <SelectItem value="24h">24 horas</SelectItem>
              <SelectItem value="7d">7 dias</SelectItem>
              <SelectItem value="30d">30 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Crisis Alerts */}
      {crisisAlerts.filter(alert => alert.isActive).length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-red-800">🚨 Alertas Críticos</h3>
          {crisisAlerts.filter(alert => alert.isActive).map(alert => (
            <Card key={alert.id} className="border-red-200 bg-red-50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <Warning className="h-5 w-5 text-red-600" />
                      <h4 className="font-semibold text-red-800">{alert.title}</h4>
                      <Badge className="bg-red-600 text-white">
                        {alert.severity === 'critical' ? 'Crítico' :
                          alert.severity === 'high' ? 'Alto' :
                            alert.severity === 'medium' ? 'Médio' : 'Baixo'}
                      </Badge>
                    </div>
                    <p className="text-sm text-red-700 mb-3">{alert.description}</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                      <div className="text-sm">
                        <span className="font-medium">Plataformas:</span>
                        <div className="flex space-x-1 mt-1">
                          {alert.affectedPlatforms.map(platform => {
                            const IconComponent = getPlatformIcon(platform)
                            const colorClass = getPlatformColor(platform)
                            return (
                              <IconComponent key={platform} className={`h-4 w-4 ${colorClass}`} />
                            )
                          })}
                        </div>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">Menções:</span>
                        <div className="text-red-700">{alert.mentionsCount}</div>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">Sentimento:</span>
                        <div className="text-red-700">{(alert.sentimentScore * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                    <div className="mb-3">
                      <h5 className="font-medium text-sm mb-2">Recomendações:</h5>
                      <ul className="text-xs text-red-700 space-y-1">
                        {alert.recommendations.map((rec, index) => (
                          <li key={index}>• {rec}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => dismissAlert(alert.id)}
                    >
                      Dismissar
                    </Button>
                    <Button size="sm" className="bg-red-600 hover:bg-red-700">
                      Ação Imediata
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Sentiment Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Heart className="h-5 w-5 text-green-600" />
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {sentimentDistribution.positive}
                </div>
                <div className="text-sm text-muted-foreground">Positivas</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <SmileySad className="h-5 w-5 text-red-600" />
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {sentimentDistribution.negative}
                </div>
                <div className="text-sm text-muted-foreground">Negativas</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <SmileyMeh className="h-5 w-5 text-gray-600" />
              <div>
                <div className="text-2xl font-bold text-gray-600">
                  {sentimentDistribution.neutral}
                </div>
                <div className="text-sm text-muted-foreground">Neutras</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <TrendUp className="h-5 w-5 text-blue-600" />
              <div>
                <div className="text-2xl font-bold text-blue-600">
                  {(overallSentiment * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">Score Geral</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="mentions" className="space-y-6">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="mentions">Menções</TabsTrigger>
          <TabsTrigger value="sentiment">Sentimento</TabsTrigger>
          <TabsTrigger value="keywords">Palavras-chave</TabsTrigger>
          <TabsTrigger value="trends">Tendências</TabsTrigger>
        </TabsList>

        <TabsContent value="mentions" className="space-y-6">
          {/* Funnels */}
          <div className="flex items-center space-x-4">
            <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Plataformas</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="threads">Threads</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedSentiment} onValueChange={setSelectedSentiment}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Sentimentos</SelectItem>
                <SelectItem value="positive">Positivo</SelectItem>
                <SelectItem value="negative">Negativo</SelectItem>
                <SelectItem value="neutral">Neutro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mentions List */}
          <div className="space-y-4">
            {filteredMentions.map(mention => {
              const IconComponent = getPlatformIcon(mention.platform)
              const colorClass = getPlatformColor(mention.platform)
              const sentimentIcon = getSentimentIcon(mention.sentiment.label)
              const sentimentColor = getSentimentColor(mention.sentiment.label)
              const priorityColor = getPriorityColor(mention.priority)

              return (
                <Card key={mention.id} className={`glass-card ${mention.isRead ? 'opacity-70' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start space-x-4">
                      <Avatar className="h-10 w-10 flex-shrink-0">
                        <AvatarImage src={mention.author.avatar} />
                        <AvatarFallback>{mention.author.displayName.slice(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <span className="font-medium">{mention.author.displayName}</span>
                            <span className="text-sm text-muted-foreground">{mention.author.username}</span>
                            {mention.author.verified && (
                              <CheckCircle className="h-4 w-4 text-blue-500" />
                            )}
                            <IconComponent className={`h-4 w-4 ${colorClass}`} />
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge className={priorityColor}>
                              {mention.priority === 'critical' ? 'Crítico' :
                                mention.priority === 'high' ? 'Alto' :
                                  mention.priority === 'medium' ? 'Médio' : 'Baixo'}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {formatTime(mention.timestamp)} atrás
                            </span>
                          </div>
                        </div>

                        <p className="text-sm mb-3">{mention.content}</p>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-1">
                              {sentimentIcon}
                              <Badge className={sentimentColor}>
                                {mention.sentiment.label} ({(mention.sentiment.confidence * 100).toFixed(0)}%)
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              <Heart className="h-3 w-3 inline mr-1" />
                              {formatNumber(mention.engagement.likes)}
                              <Eye className="h-3 w-3 inline ml-2 mr-1" />
                              {formatNumber(mention.engagement.reach)}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            {!mention.isRead && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => markAsRead(mention.id)}
                              >
                                Marcar Lida
                              </Button>
                            )}
                            <Button size="sm">
                              Responder
                            </Button>
                          </div>
                        </div>

                        {mention.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {mention.keywords.map(keyword => (
                              <Badge key={keyword} variant="outline" className="text-xs">
                                {keyword}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="sentiment" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Distribuição de Sentimento</CardTitle>
                <CardDescription>Breakdown por tipo de sentimento</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center space-x-2">
                        <Heart className="h-4 w-4 text-green-600" />
                        <span>Positivo</span>
                      </span>
                      <span>{sentimentDistribution.positive} ({totalMentions > 0 ? ((sentimentDistribution.positive / totalMentions) * 100).toFixed(1) : 0}%)</span>
                    </div>
                    <Progress value={totalMentions > 0 ? (sentimentDistribution.positive / totalMentions) * 100 : 0} className="h-3" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center space-x-2">
                        <SmileyMeh className="h-4 w-4 text-gray-600" />
                        <span>Neutro</span>
                      </span>
                      <span>{sentimentDistribution.neutral} ({totalMentions > 0 ? ((sentimentDistribution.neutral / totalMentions) * 100).toFixed(1) : 0}%)</span>
                    </div>
                    <Progress value={totalMentions > 0 ? (sentimentDistribution.neutral / totalMentions) * 100 : 0} className="h-3" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center space-x-2">
                        <SmileySad className="h-4 w-4 text-red-600" />
                        <span>Negativo</span>
                      </span>
                      <span>{sentimentDistribution.negative} ({totalMentions > 0 ? ((sentimentDistribution.negative / totalMentions) * 100).toFixed(1) : 0}%)</span>
                    </div>
                    <Progress value={totalMentions > 0 ? (sentimentDistribution.negative / totalMentions) * 100 : 0} className="h-3" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Sentiment Score Geral</CardTitle>
                <CardDescription>Score médio baseado em todas as menções</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <div className="text-6xl font-bold mb-4" style={{
                    color: overallSentiment > 0.2 ? '#22c55e' :
                      overallSentiment < -0.2 ? '#ef4444' : '#6b7280'
                  }}>
                    {(overallSentiment * 100).toFixed(1)}%
                  </div>
                  <div className="text-lg text-muted-foreground mb-4">
                    {overallSentiment > 0.2 ? 'Muito Positivo' :
                      overallSentiment > 0 ? 'Positivo' :
                        overallSentiment > -0.2 ? 'Neutro' :
                          overallSentiment > -0.5 ? 'Negativo' : 'Muito Negativo'}
                  </div>
                  <Progress
                    value={((overallSentiment + 1) / 2) * 100}
                    className="h-4"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="keywords" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Tracking de Palavras-chave</CardTitle>
              <CardDescription>Monitoramento de termos importantes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {keywordTracking.map(keyword => (
                  <div key={keyword.keyword} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      <div>
                        <div className="font-medium">{keyword.keyword}</div>
                        <div className="text-sm text-muted-foreground">
                          {keyword.mentions} menções
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium" style={{
                          color: keyword.sentiment > 0.2 ? '#22c55e' :
                            keyword.sentiment < -0.2 ? '#ef4444' : '#6b7280'
                        }}>
                          {(keyword.sentiment * 100).toFixed(1)}%
                        </div>
                        <div className="text-xs text-muted-foreground">sentiment</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {keyword.trend === 'up' ? (
                        <TrendUp className="h-4 w-4 text-green-600" />
                      ) : keyword.trend === 'down' ? (
                        <TrendDown className="h-4 w-4 text-red-600" />
                      ) : (
                        <div className="h-4 w-4 bg-gray-400 rounded-full"></div>
                      )}
                      <span className={`text-sm font-medium ${keyword.trend === 'up' ? 'text-green-600' :
                        keyword.trend === 'down' ? 'text-red-600' : 'text-gray-600'
                        }`}>
                        {keyword.trendPercentage > 0 ? '+' : ''}{keyword.trendPercentage}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Tendências de Sentimento</CardTitle>
              <CardDescription>Evolução do sentiment ao longo do tempo</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64 flex items-end justify-between space-x-2">
                {sentimentTrends.map((trend, index) => {
                  const maxValue = Math.max(...sentimentTrends.map(t => t.total))
                  const positiveHeight = (trend.positive / maxValue) * 100
                  const negativeHeight = (trend.negative / maxValue) * 100
                  const neutralHeight = (trend.neutral / maxValue) * 100

                  return (
                    <div key={index} className="flex flex-col items-center space-y-2">
                      <div className="flex flex-col items-center space-y-1">
                        <div
                          className="bg-green-500 rounded-t w-8"
                          style={{ height: `${positiveHeight * 2}px` }}
                          title={`Positivas: ${trend.positive}`}
                        ></div>
                        <div
                          className="bg-gray-400 w-8"
                          style={{ height: `${neutralHeight * 2}px` }}
                          title={`Neutras: ${trend.neutral}`}
                        ></div>
                        <div
                          className="bg-red-500 rounded-b w-8"
                          style={{ height: `${negativeHeight * 2}px` }}
                          title={`Negativas: ${trend.negative}`}
                        ></div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(trend.date as any).toLocaleDateString('pt-BR', { weekday: 'short' })}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-center space-x-6 mt-4">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded"></div>
                  <span className="text-sm">Positivo</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-gray-400 rounded"></div>
                  <span className="text-sm">Neutro</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-red-500 rounded"></div>
                  <span className="text-sm">Negativo</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
