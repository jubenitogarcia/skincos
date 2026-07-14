import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { Button } from "@/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Progress } from "@/progress"
import {
  TrendUp,
  TrendDown,
  Users,
  Target,
  Clock,
  Star,
  Trophy,
  Lightning,
  ChartLineUp,
  UserCircle,
  ChatCircle,
  Phone,
  Envelope,
  CalendarBlank,
  CurrencyDollar,
  Percent,
  Timer,
  Crown,
  // Trophy removed duplicate (already imported above)
  Funnel,
  Download,
  ArrowClockwise as RefreshCw,
  Warning,
  CheckCircle,
  Eye
} from "@phosphor-icons/react"

interface AgentMetrics {
  id: string
  name: string
  role: string
  avatar: string
  performance: {
    totalConversations: number
    averageResponseTime: number
    satisfactionScore: number
    conversionRate: number
    revenueGenerated: number
    activeChats: number
    resolvedToday: number
    escalationsToday: number
  }
  trends: {
    conversationsTrend: number
    satisfactionTrend: number
    responseTimeTrend: number
    conversionTrend: number
  }
  status: 'online' | 'busy' | 'away' | 'offline'
  lastPulse: string
  specialties: string[]
  achievements: string[]
}

interface ExecutiveInsight {
  id: string
  type: 'opportunity' | 'warning' | 'success' | 'trend'
  title: string
  description: string
  impact: 'high' | 'medium' | 'low'
  actionRequired: boolean
  relatedAgents?: string[]
}

interface TeamMetrics {
  totalAgents: number
  onlineAgents: number
  avgSatisfactionScore: number
  totalConversationsToday: number
  avgResponseTime: number
  totalRevenueToday: number
  conversionRate: number
  escalationRate: number
}

export function ExecutiveDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState('today')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedView, setSelectedView] = useState('overview')

  // Mock data - in real app, this would come from API
  const teamMetrics: TeamMetrics = {
    totalAgents: 24,
    onlineAgents: 18,
    avgSatisfactionScore: 4.7,
    totalConversationsToday: 847,
    avgResponseTime: 1.2,
    totalRevenueToday: 156000,
    conversionRate: 23.4,
    escalationRate: 2.1
  }

  const agentMetrics: AgentMetrics[] = [
    {
      id: '1',
      name: 'Ana Silva',
      role: 'Senior Sales Agent',
      avatar: '/api/placeholder/40/40',
      performance: {
        totalConversations: 89,
        averageResponseTime: 0.8,
        satisfactionScore: 4.9,
        conversionRate: 31.2,
        revenueGenerated: 45000,
        activeChats: 3,
        resolvedToday: 12,
        escalationsToday: 0
      },
      trends: {
        conversationsTrend: 15.2,
        satisfactionTrend: 8.1,
        responseTimeTrend: -12.3,
        conversionTrend: 22.1
      },
      status: 'online',
      lastPulse: '2 min atrás',
      specialties: ['Enterprise Sales', 'Lead Qualification'],
      achievements: ['Top Performer', 'Customer Champion', 'Speed Demon']
    },
    {
      id: '2',
      name: 'Carlos Mendes',
      role: 'Support Specialist',
      avatar: '/api/placeholder/40/40',
      performance: {
        totalConversations: 134,
        averageResponseTime: 1.1,
        satisfactionScore: 4.6,
        conversionRate: 18.7,
        revenueGenerated: 23000,
        activeChats: 5,
        resolvedToday: 18,
        escalationsToday: 1
      },
      trends: {
        conversationsTrend: 8.7,
        satisfactionTrend: 3.2,
        responseTimeTrend: -5.1,
        conversionTrend: 12.8
      },
      status: 'busy',
      lastPulse: '5 min atrás',
      specialties: ['Technical Support', 'Customer Success'],
      achievements: ['Problem Solver', 'Team Player']
    },
    {
      id: '3',
      name: 'Marina Costa',
      role: 'Lead Generation',
      avatar: '/api/placeholder/40/40',
      performance: {
        totalConversations: 76,
        averageResponseTime: 1.5,
        satisfactionScore: 4.8,
        conversionRate: 28.9,
        revenueGenerated: 38000,
        activeChats: 2,
        resolvedToday: 9,
        escalationsToday: 0
      },
      trends: {
        conversationsTrend: 12.1,
        satisfactionTrend: 6.7,
        responseTimeTrend: -8.9,
        conversionTrend: 18.5
      },
      status: 'online',
      lastPulse: '1 min atrás',
      specialties: ['Lead Qualification', 'Cold Outreach'],
      achievements: ['Lead Master', 'Conversion King']
    }
  ]

  const executiveInsights: ExecutiveInsight[] = [
    {
      id: '1',
      type: 'opportunity',
      title: 'Oportunidade de Treinamento Identificada',
      description: 'Agentes novos têm 23% menor taxa de conversão. Programa de mentoria pode aumentar performance em 15%.',
      impact: 'high',
      actionRequired: true,
      relatedAgents: ['agent-4', 'agent-7', 'agent-12']
    },
    {
      id: '2',
      type: 'success',
      title: 'Meta de Satisfação Superada',
      description: 'Equipe alcançou 4.7/5.0 em satisfação do cliente, superando meta de 4.5 em 4.4%.',
      impact: 'medium',
      actionRequired: false
    },
    {
      id: '3',
      type: 'warning',
      title: 'Tempo de Resposta Aumentando',
      description: 'Tempo médio de resposta subiu 12% na última semana. Possível necessidade de reforço.',
      impact: 'medium',
      actionRequired: true,
      relatedAgents: ['agent-8', 'agent-15']
    },
    {
      id: '4',
      type: 'trend',
      title: 'Pico de Demanda Detectado',
      description: 'Aumento de 34% em conversas iniciadas nos últimos 3 dias. Trend positivo de engajamento.',
      impact: 'high',
      actionRequired: false
    }
  ]

  const handleRefresh = async () => {
    setIsRefreshing(true)
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000))
    setIsRefreshing(false)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500'
      case 'busy': return 'bg-yellow-500'
      case 'away': return 'bg-orange-500'
      case 'offline': return 'bg-gray-500'
      default: return 'bg-gray-500'
    }
  }

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'opportunity': return <TrendUp className="h-4 w-4 text-blue-600" />
      case 'warning': return <Warning className="h-4 w-4 text-orange-600" />
      case 'success': return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'trend': return <ChartLineUp className="h-4 w-4 text-purple-600" />
      default: return <Eye className="h-4 w-4" />
    }
  }

  const topPerformers = agentMetrics
    .sort((a, b) => b.performance.conversionRate - a.performance.conversionRate)
    .slice(0, 3)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold">Dashboard Executivo</h1>
          <p className="text-muted-foreground">
            Visão consolidada de performance e insights estratégicos da equipe
          </p>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Funnel className="h-4 w-4" />
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-background border border-input rounded-md px-3 py-2 text-sm"
            >
              <option value="today">Hoje</option>
              <option value="week">Esta Semana</option>
              <option value="month">Este Mês</option>
              <option value="quarter">Este Trimestre</option>
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>

          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Overview Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <div className="text-sm font-medium text-muted-foreground">Agentes Online</div>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{teamMetrics.onlineAgents}/{teamMetrics.totalAgents}</div>
            <div className="flex items-center space-x-2 text-xs text-muted-foreground">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>75% da equipe ativa</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <div className="text-sm font-medium text-muted-foreground">Satisfação Média</div>
              <Star className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{teamMetrics.avgSatisfactionScore}/5.0</div>
            <div className="flex items-center space-x-1 text-xs">
              <TrendUp className="h-3 w-3 text-green-600" />
              <span className="text-green-600">+4.4% vs meta</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <div className="text-sm font-medium text-muted-foreground">Conversões Hoje</div>
              <Target className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{teamMetrics.conversionRate}%</div>
            <div className="flex items-center space-x-1 text-xs">
              <TrendUp className="h-3 w-3 text-green-600" />
              <span className="text-green-600">+12.1% vs ontem</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <div className="text-sm font-medium text-muted-foreground">Receita Hoje</div>
              <CurrencyDollar className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">R$ {(teamMetrics.totalRevenueToday / 1000).toFixed(0)}K</div>
            <div className="flex items-center space-x-1 text-xs">
              <TrendUp className="h-3 w-3 text-green-600" />
              <span className="text-green-600">+18.7% vs ontem</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={selectedView} onValueChange={setSelectedView}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="team">Equipe</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Real-time Pulse */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Lightning className="h-5 w-5 text-accent" />
                  <span>Atividade em Tempo Real</span>
                </CardTitle>
                <CardDescription>
                  Monitoramento ao vivo das operações
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">
                      {agentMetrics.reduce((sum, agent) => sum + agent.performance.activeChats, 0)}
                    </div>
                    <div className="text-sm text-blue-700">Chats Ativos</div>
                  </div>
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">
                      {agentMetrics.reduce((sum, agent) => sum + agent.performance.resolvedToday, 0)}
                    </div>
                    <div className="text-sm text-green-700">Resolvidos Hoje</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Tempo de Resposta Médio</span>
                    <span className="text-sm font-medium">{teamMetrics.avgResponseTime}min</span>
                  </div>
                  <Progress value={85} className="h-2" />

                  <div className="flex justify-between items-center">
                    <span className="text-sm">Taxa de Escalação</span>
                    <span className="text-sm font-medium">{teamMetrics.escalationRate}%</span>
                  </div>
                  <Progress value={teamMetrics.escalationRate * 5} className="h-2" />
                </div>
              </CardContent>
            </Card>

            {/* Top Performers */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Crown className="h-5 w-5 text-yellow-600" />
                  <span>Top Performers</span>
                </CardTitle>
                <CardDescription>
                  Agentes com melhor performance hoje
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {topPerformers.map((agent, index) => (
                  <div key={agent.id} className="flex items-center space-x-3 p-3 bg-gradient-to-r from-accent/5 to-transparent rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${index === 0 ? 'bg-yellow-100 text-yellow-800' :
                        index === 1 ? 'bg-gray-100 text-gray-800' :
                          'bg-orange-100 text-orange-800'
                        }`}>
                        {index + 1}
                      </div>
                      <div className="relative">
                        <div className="w-8 h-8 bg-gradient-to-br from-primary/20 to-accent/20 rounded-full flex items-center justify-center">
                          <span className="text-xs font-medium">{agent.name.charAt(0)}</span>
                        </div>
                        <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${getStatusColor(agent.status)}`}></div>
                      </div>
                    </div>

                    <div className="flex-1">
                      <div className="font-medium text-sm">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">{agent.role}</div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-bold text-green-600">
                        {agent.performance.conversionRate}%
                      </div>
                      <div className="text-xs text-muted-foreground">conversão</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Performance Trends */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Tendências de Performance</CardTitle>
              <CardDescription>
                Métricas consolidadas da equipe nas últimas 24 horas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="text-center space-y-2">
                  <ChatCircle className="h-8 w-8 text-blue-600 mx-auto" />
                  <div className="text-2xl font-bold">{teamMetrics.totalConversationsToday}</div>
                  <div className="text-sm text-muted-foreground">Conversas Totais</div>
                  <Badge variant="secondary" className="text-xs">
                    <TrendUp className="h-3 w-3 mr-1" />
                    +15.2%
                  </Badge>
                </div>

                <div className="text-center space-y-2">
                  <Timer className="h-8 w-8 text-orange-600 mx-auto" />
                  <div className="text-2xl font-bold">{teamMetrics.avgResponseTime}min</div>
                  <div className="text-sm text-muted-foreground">Tempo Resposta</div>
                  <Badge variant="secondary" className="text-xs">
                    <TrendDown className="h-3 w-3 mr-1" />
                    -8.1%
                  </Badge>
                </div>

                <div className="text-center space-y-2">
                  <Percent className="h-8 w-8 text-green-600 mx-auto" />
                  <div className="text-2xl font-bold">{teamMetrics.conversionRate}%</div>
                  <div className="text-sm text-muted-foreground">Taxa Conversão</div>
                  <Badge variant="secondary" className="text-xs">
                    <TrendUp className="h-3 w-3 mr-1" />
                    +12.8%
                  </Badge>
                </div>

                <div className="text-center space-y-2">
                  <Star className="h-8 w-8 text-yellow-600 mx-auto" />
                  <div className="text-2xl font-bold">{teamMetrics.avgSatisfactionScore}</div>
                  <div className="text-sm text-muted-foreground">Satisfação</div>
                  <Badge variant="secondary" className="text-xs">
                    <TrendUp className="h-3 w-3 mr-1" />
                    +6.4%
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          {/* Agent Performance Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {agentMetrics.map((agent) => (
              <Card key={agent.id} className="glass-card">
                <CardHeader className="pb-3">
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-accent/20 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium">{agent.name.charAt(0)}</span>
                      </div>
                      <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${getStatusColor(agent.status)}`}></div>
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-base">{agent.name}</CardTitle>
                      <CardDescription className="text-xs">{agent.role}</CardDescription>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {agent.status}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Conversas</div>
                      <div className="font-bold">{agent.performance.totalConversations}</div>
                      <div className={`text-xs flex items-center ${agent.trends.conversationsTrend > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                        {agent.trends.conversationsTrend > 0 ?
                          <TrendUp className="h-3 w-3 mr-1" /> :
                          <TrendDown className="h-3 w-3 mr-1" />
                        }
                        {Math.abs(agent.trends.conversationsTrend)}%
                      </div>
                    </div>

                    <div>
                      <div className="text-muted-foreground">Conversão</div>
                      <div className="font-bold">{agent.performance.conversionRate}%</div>
                      <div className={`text-xs flex items-center ${agent.trends.conversionTrend > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                        {agent.trends.conversionTrend > 0 ?
                          <TrendUp className="h-3 w-3 mr-1" /> :
                          <TrendDown className="h-3 w-3 mr-1" />
                        }
                        {Math.abs(agent.trends.conversionTrend)}%
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Satisfação</span>
                      <span className="font-medium">{agent.performance.satisfactionScore}/5.0</span>
                    </div>
                    <Progress value={agent.performance.satisfactionScore * 20} className="h-2" />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Tempo Resposta</span>
                      <span className="font-medium">{agent.performance.averageResponseTime}min</span>
                    </div>
                    <Progress value={Math.max(0, 100 - (agent.performance.averageResponseTime * 30))} className="h-2" />
                  </div>

                  <div className="pt-2 border-t">
                    <div className="text-sm font-medium mb-2">Especialidades</div>
                    <div className="flex flex-wrap gap-1">
                      {agent.specialties.map((specialty, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {specialty}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {agent.achievements.length > 0 && (
                    <div className="pt-2 border-t">
                      <div className="text-sm font-medium mb-2">Conquistas</div>
                      <div className="flex flex-wrap gap-1">
                        {agent.achievements.slice(0, 2).map((achievement, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            <Trophy className="h-3 w-3 mr-1" />
                            {achievement}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          {/* Strategic Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {executiveInsights.map((insight) => (
              <Card key={insight.id} className={`glass-card border-l-4 ${insight.type === 'opportunity' ? 'border-l-blue-500' :
                insight.type === 'warning' ? 'border-l-orange-500' :
                  insight.type === 'success' ? 'border-l-green-500' :
                    'border-l-purple-500'
                }`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between space-x-2">
                    <div className="flex items-center space-x-2">
                      {getInsightIcon(insight.type)}
                      <CardTitle className="text-base">{insight.title}</CardTitle>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={insight.impact === 'high' ? 'destructive' : insight.impact === 'medium' ? 'default' : 'secondary'}>
                        {insight.impact === 'high' ? 'Alto' : insight.impact === 'medium' ? 'Médio' : 'Baixo'}
                      </Badge>
                      {insight.actionRequired && (
                        <Badge variant="outline" className="text-xs">
                          Ação Requerida
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {insight.description}
                  </p>

                  {insight.relatedAgents && (
                    <div className="mb-4">
                      <div className="text-sm font-medium mb-2">Agentes Relacionados:</div>
                      <div className="flex flex-wrap gap-1">
                        {insight.relatedAgents.map((agentId, index) => (
                          <Badge key={index} variant="secondary" className="text-xs">
                            Agente {agentId.slice(-1)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {insight.actionRequired && (
                    <div className="flex space-x-2">
                      <Button size="sm" variant="default">
                        Tomar Ação
                      </Button>
                      <Button size="sm" variant="outline">
                        Ver Detalhes
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="team" className="space-y-6">
          {/* Team Overview */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Visão Geral da Equipe</CardTitle>
              <CardDescription>
                Status e distribuição da equipe de agentes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="text-center space-y-2">
                  <div className="text-3xl font-bold">{teamMetrics.totalAgents}</div>
                  <div className="text-sm text-muted-foreground">Total de Agentes</div>
                </div>
                <div className="text-center space-y-2">
                  <div className="text-3xl font-bold text-green-600">{teamMetrics.onlineAgents}</div>
                  <div className="text-sm text-muted-foreground">Online Agora</div>
                </div>
                <div className="text-center space-y-2">
                  <div className="text-3xl font-bold text-yellow-600">
                    {agentMetrics.filter(a => a.status === 'busy').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Ocupados</div>
                </div>
                <div className="text-center space-y-2">
                  <div className="text-3xl font-bold text-blue-600">
                    {agentMetrics.reduce((sum, agent) => sum + agent.performance.activeChats, 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Chats Ativos</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Detailed Agent List */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Lista Detalhada de Agentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {agentMetrics.map((agent) => (
                  <div key={agent.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      <div className="relative">
                        <div className="w-12 h-12 bg-gradient-to-br from-primary/20 to-accent/20 rounded-full flex items-center justify-center">
                          <span className="text-lg font-medium">{agent.name.charAt(0)}</span>
                        </div>
                        <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${getStatusColor(agent.status)}`}></div>
                      </div>

                      <div>
                        <div className="font-medium">{agent.name}</div>
                        <div className="text-sm text-muted-foreground">{agent.role}</div>
                        <div className="text-xs text-muted-foreground">Último acesso: {agent.lastPulse}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-8 text-center">
                      <div>
                        <div className="text-sm font-bold">{agent.performance.totalConversations}</div>
                        <div className="text-xs text-muted-foreground">Conversas</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold">{agent.performance.conversionRate}%</div>
                        <div className="text-xs text-muted-foreground">Conversão</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold">{agent.performance.satisfactionScore}</div>
                        <div className="text-xs text-muted-foreground">Satisfação</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold">{agent.performance.averageResponseTime}min</div>
                        <div className="text-xs text-muted-foreground">Resp. Tempo</div>
                      </div>
                    </div>

                    <Button variant="outline" size="sm">
                      Ver Perfil
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
