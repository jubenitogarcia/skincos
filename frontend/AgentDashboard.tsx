import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/avatar"
import { Progress } from "@/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import {
  Timer,
  ChatCircle,
  Star,
  TrendUp,
  TrendDown,
  Trophy,
  Clock,
  Users,
  CheckCircle,
  Warning,
  Heart,
  Target,
  ChartBar,
  CalendarBlank,
  Funnel,
  Lightning,
  Headset
} from "@phosphor-icons/react"

interface Agent {
  id: string
  name: string
  avatar: string
  status: 'online' | 'busy' | 'away' | 'offline'
  department: string
  shift: string
}

interface ChatMetrics {
  agentId: string
  date: string
  totalChats: number
  averageResponseTime: number // in seconds
  customerSatisfaction: number // 1-5 rating
  resolutionRate: number // percentage
  activeTime: number // in minutes
  firstContactResolution: number // percentage
  escalations: number
  upsells: number
  revenue: number
}

interface PerformanceGoal {
  metric: string
  target: number
  current: number
  unit: string
}

const mockAgents: Agent[] = [
  {
    id: "1",
    name: "Ana Silva",
    avatar: "/api/placeholder/32/32",
    status: "online",
    department: "Vendas",
    shift: "Manhã"
  },
  {
    id: "2",
    name: "Carlos Santos",
    avatar: "/api/placeholder/32/32",
    status: "busy",
    department: "Suporte",
    shift: "Tarde"
  },
  {
    id: "3",
    name: "Maria Costa",
    avatar: "/api/placeholder/32/32",
    status: "online",
    department: "Vendas",
    shift: "Integral"
  },
  {
    id: "4",
    name: "João Oliveira",
    avatar: "/api/placeholder/32/32",
    status: "away",
    department: "Suporte",
    shift: "Noite"
  },
  {
    id: "5",
    name: "Lucia Pereira",
    avatar: "/api/placeholder/32/32",
    status: "online",
    department: "Retenção",
    shift: "Manhã"
  }
]

const mockMetrics: ChatMetrics[] = [
  {
    agentId: "1",
    date: "2024-03-15",
    totalChats: 45,
    averageResponseTime: 23,
    customerSatisfaction: 4.8,
    resolutionRate: 89,
    activeTime: 420,
    firstContactResolution: 78,
    escalations: 3,
    upsells: 8,
    revenue: 12500
  },
  {
    agentId: "2",
    date: "2024-03-15",
    totalChats: 52,
    averageResponseTime: 18,
    customerSatisfaction: 4.6,
    resolutionRate: 92,
    activeTime: 445,
    firstContactResolution: 85,
    escalations: 2,
    upsells: 5,
    revenue: 8300
  },
  {
    agentId: "3",
    date: "2024-03-15",
    totalChats: 38,
    averageResponseTime: 31,
    customerSatisfaction: 4.9,
    resolutionRate: 94,
    activeTime: 380,
    firstContactResolution: 82,
    escalations: 1,
    upsells: 12,
    revenue: 18700
  }
]

export function AgentDashboard() {
  const [agents] = useKV<Agent[]>("chat-agents", mockAgents)
  const [metrics] = useKV<ChatMetrics[]>("agent-metrics", mockMetrics)
  const [selectedPeriod, setSelectedPeriod] = useState("today")
  const [selectedDepartment, setSelectedDepartment] = useState("all")
  const [viewMode, setViewMode] = useState("overview")

  // Calculate team performance
  const teamMetrics = metrics.reduce((acc, metric) => {
    acc.totalChats += metric.totalChats
    acc.totalRevenue += metric.revenue
    acc.avgSatisfaction += metric.customerSatisfaction
    acc.avgResolution += metric.resolutionRate
    acc.totalUpsells += metric.upsells
    return acc
  }, {
    totalChats: 0,
    totalRevenue: 0,
    avgSatisfaction: 0,
    avgResolution: 0,
    totalUpsells: 0
  })

  teamMetrics.avgSatisfaction = teamMetrics.avgSatisfaction / metrics.length
  teamMetrics.avgResolution = teamMetrics.avgResolution / metrics.length

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500'
      case 'busy': return 'bg-red-500'
      case 'away': return 'bg-yellow-500'
      default: return 'bg-gray-400'
    }
  }

  const getPerformanceColor = (value: number, target: number) => {
    const percentage = (value / target) * 100
    if (percentage >= 90) return 'text-green-600'
    if (percentage >= 70) return 'text-yellow-600'
    return 'text-red-600'
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const AgentCard = ({ agent, metric }: { agent: Agent; metric?: ChatMetrics }) => (
    <Card className="glass-card hover:shadow-lg transition-all duration-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="relative">
              <Avatar className="h-10 w-10">
                <AvatarImage src={agent.avatar} alt={agent.name} />
                <AvatarFallback>{agent.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
              </Avatar>
              <div className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white ${getStatusColor(agent.status)}`} />
            </div>
            <div>
              <h3 className="font-semibold text-sm">{agent.name}</h3>
              <p className="text-xs text-muted-foreground">{agent.department} • {agent.shift}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            {agent.status}
          </Badge>
        </div>
      </CardHeader>

      {metric && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-1">
                <ChatCircle className="h-3 w-3 text-blue-500" />
                <span className="text-xs font-medium">Chats</span>
              </div>
              <p className="text-lg font-bold">{metric.totalChats}</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center space-x-1">
                <Timer className="h-3 w-3 text-orange-500" />
                <span className="text-xs font-medium">Resposta</span>
              </div>
              <p className="text-lg font-bold">{formatTime(metric.averageResponseTime)}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs flex items-center space-x-1">
                <Star className="h-3 w-3 text-yellow-500" />
                <span>Satisfação</span>
              </span>
              <span className="text-sm font-medium">{metric.customerSatisfaction.toFixed(1)}/5</span>
            </div>
            <Progress value={(metric.customerSatisfaction / 5) * 100} className="h-2" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs flex items-center space-x-1">
                <CheckCircle className="h-3 w-3 text-green-500" />
                <span>Resolução</span>
              </span>
              <span className="text-sm font-medium">{metric.resolutionRate}%</span>
            </div>
            <Progress value={metric.resolutionRate} className="h-2" />
          </div>

          <div className="flex justify-between text-xs text-muted-foreground border-t pt-2">
            <span>FCR: {metric.firstContactResolution}%</span>
            <span>R$ {(metric.revenue / 1000).toFixed(1)}K</span>
          </div>
        </CardContent>
      )}
    </Card>
  )

  const MetricOverview = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total de Chats</p>
              <p className="text-2xl font-bold">{teamMetrics.totalChats}</p>
              <p className="text-xs text-green-600 flex items-center mt-1">
                <TrendUp className="h-3 w-3 mr-1" />
                +12% vs ontem
              </p>
            </div>
            <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <ChatCircle className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Satisfação Média</p>
              <p className="text-2xl font-bold">{teamMetrics.avgSatisfaction.toFixed(1)}</p>
              <p className="text-xs text-green-600 flex items-center mt-1">
                <TrendUp className="h-3 w-3 mr-1" />
                +0.3 vs ontem
              </p>
            </div>
            <div className="h-12 w-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <Star className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Taxa de Resolução</p>
              <p className="text-2xl font-bold">{teamMetrics.avgResolution.toFixed(1)}%</p>
              <p className="text-xs text-red-600 flex items-center mt-1">
                <TrendDown className="h-3 w-3 mr-1" />
                -1.2% vs ontem
              </p>
            </div>
            <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Receita Gerada</p>
              <p className="text-2xl font-bold">R$ {(teamMetrics.totalRevenue / 1000).toFixed(0)}K</p>
              <p className="text-xs text-green-600 flex items-center mt-1">
                <TrendUp className="h-3 w-3 mr-1" />
                +18% vs ontem
              </p>
            </div>
            <div className="h-12 w-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <Target className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )

  const TopPerformers = () => {
    const sortedMetrics = [...metrics].sort((a, b) => b.customerSatisfaction - a.customerSatisfaction)

    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            <span>Top Performers</span>
          </CardTitle>
          <CardDescription>Agentes com melhor performance hoje</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sortedMetrics.slice(0, 3).map((metric, index) => {
              const agent = agents.find(a => a.id === metric.agentId)
              if (!agent) return null

              return (
                <div key={metric.agentId} className="flex items-center justify-between p-3 bg-gradient-to-r from-accent/5 to-transparent rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${index === 0 ? 'bg-yellow-500 text-white' :
                      index === 1 ? 'bg-gray-400 text-white' :
                        'bg-orange-400 text-white'
                      }`}>
                      {index + 1}
                    </div>
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={agent.avatar} alt={agent.name} />
                      <AvatarFallback>{agent.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.department}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center space-x-1">
                      <Star className="h-3 w-3 text-yellow-500" />
                      <span className="font-bold text-sm">{metric.customerSatisfaction.toFixed(1)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{metric.totalChats} chats</p>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    )
  }

  const RealTimeStatus = () => (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Headset className="h-5 w-5 text-blue-500" />
          <span>Status em Tempo Real</span>
        </CardTitle>
        <CardDescription>Disponibilidade atual da equipe</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {agents.map(agent => (
            <div key={agent.id} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-lg transition-colors">
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={agent.avatar} alt={agent.name} />
                    <AvatarFallback>{agent.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                  </Avatar>
                  <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border border-white ${getStatusColor(agent.status)}`} />
                </div>
                <div>
                  <p className="font-medium text-sm">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">{agent.department}</p>
                </div>
              </div>
              <Badge variant={agent.status === 'online' ? 'default' : 'secondary'} className="text-xs">
                {agent.status}
              </Badge>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t">
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-green-600">{agents.filter(a => a.status === 'online').length}</p>
              <p className="text-xs text-muted-foreground">Disponíveis</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-600">{agents.filter(a => a.status === 'busy').length}</p>
              <p className="text-xs text-muted-foreground">Ocupados</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dashboard de Performance</h2>
          <p className="text-muted-foreground">
            Monitoramento em tempo real da performance dos agentes de chat
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="week">Esta Semana</SelectItem>
              <SelectItem value="month">Este Mês</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="sales">Vendas</SelectItem>
              <SelectItem value="support">Suporte</SelectItem>
              <SelectItem value="retention">Retenção</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm">
            <Funnel className="h-4 w-4 mr-2" />
            Filtros
          </Button>
        </div>
      </div>

      {/* Metrics Overview */}
      <MetricOverview />

      {/* Main Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Agent Performance */}
        <div className="lg:col-span-2 space-y-6">
          <Tabs value={viewMode} onValueChange={setViewMode}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="overview">Visão Geral</TabsTrigger>
              <TabsTrigger value="detailed">Detalhado</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {agents.map(agent => {
                  const agentMetric = metrics.find(m => m.agentId === agent.id)
                  return <AgentCard key={agent.id} agent={agent} metric={agentMetric} />
                })}
              </div>
            </TabsContent>

            <TabsContent value="detailed" className="space-y-4">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle>Performance Detalhada</CardTitle>
                  <CardDescription>Métricas completas por agente</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {metrics.map(metric => {
                      const agent = agents.find(a => a.id === metric.agentId)
                      if (!agent) return null

                      return (
                        <div key={metric.agentId} className="p-4 border rounded-lg space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={agent.avatar} alt={agent.name} />
                                <AvatarFallback>{agent.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium">{agent.name}</p>
                                <p className="text-sm text-muted-foreground">{agent.department}</p>
                              </div>
                            </div>
                            <Badge variant="outline">{agent.status}</Badge>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="text-center">
                              <p className="text-lg font-bold">{metric.totalChats}</p>
                              <p className="text-xs text-muted-foreground">Chats</p>
                            </div>
                            <div className="text-center">
                              <p className="text-lg font-bold">{formatTime(metric.averageResponseTime)}</p>
                              <p className="text-xs text-muted-foreground">Tempo Resposta</p>
                            </div>
                            <div className="text-center">
                              <p className="text-lg font-bold">{metric.customerSatisfaction.toFixed(1)}</p>
                              <p className="text-xs text-muted-foreground">Satisfação</p>
                            </div>
                            <div className="text-center">
                              <p className="text-lg font-bold">R$ {(metric.revenue / 1000).toFixed(1)}K</p>
                              <p className="text-xs text-muted-foreground">Receita</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column - Side Widgets */}
        <div className="space-y-6">
          <TopPerformers />
          <RealTimeStatus />

          {/* Performance Goals */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Target className="h-5 w-5 text-purple-500" />
                <span>Metas da Equipe</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Satisfação Média</span>
                    <span>{teamMetrics.avgSatisfaction.toFixed(1)}/5.0</span>
                  </div>
                  <Progress value={(teamMetrics.avgSatisfaction / 5) * 100} className="h-2" />
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Taxa de Resolução</span>
                    <span>{teamMetrics.avgResolution.toFixed(1)}%</span>
                  </div>
                  <Progress value={teamMetrics.avgResolution} className="h-2" />
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Receita do Mês</span>
                    <span>R$ {(teamMetrics.totalRevenue / 1000).toFixed(0)}K / 100K</span>
                  </div>
                  <Progress value={(teamMetrics.totalRevenue / 100000) * 100} className="h-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
