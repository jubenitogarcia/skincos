import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  MicrophoneStage,
  Robot,
  TrendUp,
  TrendDown,
  Clock,
  Star,
  Users,
  PhoneCall,
  Play,
  Pause,
  SpeakerHigh as Volume,
  CheckCircle,
  XCircle,
  Lightbulb,
  Brain,
  Target,
  Trophy,
  Warning,
  ChatCircle,
  CalendarBlank,
  ChartBar
} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface ConversationAnalysis {
  id: string
  customerName: string
  agentName: string
  date: string
  duration: number
  channel: 'phone' | 'video' | 'chat'
  outcome: 'closed-won' | 'follow-up' | 'objection' | 'no-interest'
  aiScore: number
  sentiment: 'positive' | 'neutral' | 'negative'
  keyPoints: string[]
  improvements: string[]
  strengths: string[]
  transcript?: string
  audioUrl?: string
}

interface CoachingInsight {
  id: string
  type: 'improvement' | 'strength' | 'pattern' | 'recommendation'
  title: string
  description: string
  frequency: number
  impact: 'high' | 'medium' | 'low'
  category: 'communication' | 'sales-technique' | 'product-knowledge' | 'objection-handling'
}

interface SkillMetric {
  name: string
  score: number
  trend: 'improving' | 'declining' | 'stable'
  change: number
  benchmark: number
}

export function ConversationAnalytics() {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [searchQuery, setMagnifyingGlassQuery] = useState('')
  const [selectedAgent, setSelectedAgent] = useState('all')

  const [conversations, setConversations] = useKV<ConversationAnalysis[]>('conversation-analyses', [
    {
      id: '1',
      customerName: 'Maria Silva',
      agentName: 'João Santos',
      date: '2024-01-15T14:30:00Z',
      duration: 1248,
      channel: 'phone',
      outcome: 'closed-won',
      aiScore: 89,
      sentiment: 'positive',
      keyPoints: [
        'Cliente expressou interesse em solução enterprise',
        'Demonstrou preocupação com segurança de dados',
        'Mencionou orçamento de R$ 50k para Q1'
      ],
      improvements: [
        'Poderia ter explorado melhor as necessidades de integração',
        'Deixou passar oportunidade de upselling em módulos adicionais'
      ],
      strengths: [
        'Excelente rapport estabelecido',
        'Demonstração técnica clara e objetiva',
        'Fechamento assertivo e natural'
      ]
    },
    {
      id: '2',
      customerName: 'Tech Innovations Ltda',
      agentName: 'Ana Costa',
      date: '2024-01-15T10:15:00Z',
      duration: 1847,
      channel: 'video',
      outcome: 'follow-up',
      aiScore: 76,
      sentiment: 'neutral',
      keyPoints: [
        'Empresa em processo de expansão internacional',
        'Necessita de solução multi-idioma',
        'Decisão será tomada em comitê na próxima semana'
      ],
      improvements: [
        'Não identificou claramente os decision makers',
        'Poderia ter criado mais urgência na decisão'
      ],
      strengths: [
        'Boa compreensão dos requisitos técnicos',
        'Apresentação bem estruturada'
      ]
    },
    {
      id: '3',
      customerName: 'Carlos Mendoza',
      agentName: 'João Santos',
      date: '2024-01-14T16:45:00Z',
      duration: 892,
      channel: 'phone',
      outcome: 'objection',
      aiScore: 54,
      sentiment: 'negative',
      keyPoints: [
        'Cliente questionou ROI da solução',
        'Comparou com concorrente mais barato',
        'Demonstrou resistência a mudanças'
      ],
      improvements: [
        'Falhou em demonstrar valor diferencial',
        'Não conseguiu contornar objeção de preço',
        'Perdeu controle da conversa no meio'
      ],
      strengths: [
        'Manteve tom profissional durante objeções',
        'Tentou usar dados para sustentar argumentos'
      ]
    }
  ])

  const [insights, setInsights] = useKV<CoachingInsight[]>('coaching-insights', [
    {
      id: '1',
      type: 'pattern',
      title: 'Horário Ideal para Calls',
      description: 'Conversas entre 14h-16h têm 35% mais taxa de conversão',
      frequency: 12,
      impact: 'high',
      category: 'sales-technique'
    },
    {
      id: '2',
      type: 'improvement',
      title: 'Manejo de Objeções de Preço',
      description: 'Identificadas 8 oportunidades perdidas por não demonstrar ROI adequadamente',
      frequency: 8,
      impact: 'high',
      category: 'objection-handling'
    },
    {
      id: '3',
      type: 'strength',
      title: 'Excelente Rapport',
      description: 'Conversas com rapport forte têm 90%+ de sentiment positivo',
      frequency: 15,
      impact: 'medium',
      category: 'communication'
    }
  ])

  const [skillMetrics, setSkillMetrics] = useKV<SkillMetric[]>('skill-metrics', [
    { name: 'Comunicação', score: 87, trend: 'improving', change: 8, benchmark: 85 },
    { name: 'Descoberta de Necessidades', score: 76, trend: 'stable', change: 1, benchmark: 80 },
    { name: 'Demonstração Técnica', score: 91, trend: 'improving', change: 12, benchmark: 75 },
    { name: 'Manejo de Objeções', score: 68, trend: 'declining', change: -5, benchmark: 78 },
    { name: 'Fechamento', score: 83, trend: 'improving', change: 6, benchmark: 80 }
  ])

  const analyzeConversationWithAI = async (conversationId: string) => {
    setIsAnalyzing(true)
    try {
      // Simulate AI analysis
      await new Promise(resolve => setTimeout(resolve, 3000))

      const conversation = conversations.find(c => c.id === conversationId)
      if (!conversation) return

      // Generate additional insights
      const newInsight: CoachingInsight = {
        id: Date.now().toString(),
        type: 'recommendation',
        title: 'Oportunidade de Melhoria Detectada',
        description: `Análise da conversa com ${conversation.customerName} sugere foco em demonstração de valor antes da apresentação de preços`,
        frequency: 1,
        impact: 'high',
        category: 'sales-technique'
      }

      setInsights(current => [newInsight, ...current])
      toast.success('Análise IA concluída! Novas recomendações disponíveis.')

    } catch (error) {
      toast.error('Erro na análise IA')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const filteredConversations = conversations.filter(conv =>
    (selectedAgent === 'all' || conv.agentName === selectedAgent) &&
    (conv.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.agentName.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case 'closed-won': return 'bg-green-100 text-green-800 border-green-200'
      case 'follow-up': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'objection': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'no-interest': return 'bg-red-100 text-red-800 border-red-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return <TrendUp className="h-4 w-4 text-green-500" />
      case 'negative': return <TrendDown className="h-4 w-4 text-red-500" />
      default: return <div className="h-4 w-4 rounded-full bg-gray-400" />
    }
  }

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'phone': return <PhoneCall className="h-4 w-4" />
      case 'video': return <Users className="h-4 w-4" />
      case 'chat': return <ChatCircle className="h-4 w-4" />
      default: return <ChatCircle className="h-4 w-4" />
    }
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const averageScore = conversations.reduce((sum, conv) => sum + conv.aiScore, 0) / conversations.length
  const totalConversations = conversations.length
  const positiveConversations = conversations.filter(c => c.sentiment === 'positive').length
  const closedWonRate = (conversations.filter(c => c.outcome === 'closed-won').length / totalConversations) * 100

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <MicrophoneStage className="h-6 w-6 text-accent" />
            <span>Análise de Conversas com IA</span>
          </h2>
          <p className="text-muted-foreground">
            Insights profundos para aprimoramento contínuo de performance
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Input
            placeholder="Buscar conversas..."
            value={searchQuery}
            onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
            className="w-64"
          />
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="px-3 py-2 border rounded-md bg-background"
          >
            <option value="all">Todos os Agentes</option>
            <option value="João Santos">João Santos</option>
            <option value="Ana Costa">Ana Costa</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <ChartBar className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Score Médio IA</p>
                <p className="text-2xl font-bold">{averageScore.toFixed(1)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Target className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Taxa de Conversão</p>
                <p className="text-2xl font-bold">{closedWonRate.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <TrendUp className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Sentiment Positivo</p>
                <p className="text-2xl font-bold">{((positiveConversations / totalConversations) * 100).toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <ChatCircle className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total de Conversas</p>
                <p className="text-2xl font-bold">{totalConversations}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="conversations" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="conversations">Conversas Analisadas</TabsTrigger>
          <TabsTrigger value="skills">Métricas de Habilidades</TabsTrigger>
          <TabsTrigger value="insights">Insights de Coaching</TabsTrigger>
          <TabsTrigger value="trends">Tendências e Padrões</TabsTrigger>
        </TabsList>

        <TabsContent value="conversations" className="space-y-6">
          <div className="space-y-4">
            {filteredConversations.map((conversation) => (
              <Card key={conversation.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        {getChannelIcon(conversation.channel)}
                        <CardTitle className="text-lg">{conversation.customerName}</CardTitle>
                        <Badge className={getOutcomeColor(conversation.outcome)}>
                          {conversation.outcome === 'closed-won' ? 'Fechado' :
                            conversation.outcome === 'follow-up' ? 'Follow-up' :
                              conversation.outcome === 'objection' ? 'Objeção' : 'Sem interesse'}
                        </Badge>
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                        <span>{conversation.agentName}</span>
                        <span className="flex items-center space-x-1">
                          <CalendarBlank className="h-3 w-3" />
                          {new Date(conversation.date).toLocaleDateString('pt-BR')}
                        </span>
                        <span className="flex items-center space-x-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(conversation.duration)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getSentimentIcon(conversation.sentiment)}
                      <div className="text-right">
                        <p className="text-sm font-medium">Score IA</p>
                        <p className="text-lg font-bold">{conversation.aiScore}</p>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Key Points */}
                  <div>
                    <h4 className="font-medium mb-2 flex items-center space-x-2">
                      <Lightbulb className="h-4 w-4 text-blue-500" />
                      <span>Pontos Principais</span>
                    </h4>
                    <ul className="space-y-1">
                      {conversation.keyPoints.map((point, index) => (
                        <li key={index} className="text-sm text-muted-foreground flex items-start space-x-2">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Strengths and Improvements */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium mb-2 flex items-center space-x-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span>Pontos Fortes</span>
                      </h4>
                      <ul className="space-y-1">
                        {conversation.strengths.map((strength, index) => (
                          <li key={index} className="text-sm text-green-700 flex items-start space-x-2">
                            <CheckCircle className="h-3 w-3 mt-0.5 text-green-500" />
                            <span>{strength}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2 flex items-center space-x-2">
                        <Warning className="h-4 w-4 text-orange-500" />
                        <span>Oportunidades de Melhoria</span>
                      </h4>
                      <ul className="space-y-1">
                        {conversation.improvements.map((improvement, index) => (
                          <li key={index} className="text-sm text-orange-700 flex items-start space-x-2">
                            <Warning className="h-3 w-3 mt-0.5 text-orange-500" />
                            <span>{improvement}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 pt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => analyzeConversationWithAI(conversation.id)}
                      disabled={isAnalyzing}
                    >
                      {isAnalyzing ? (
                        <>
                          <Robot className="h-4 w-4 mr-2 ai-processing" />
                          Analisando...
                        </>
                      ) : (
                        <>
                          <Brain className="h-4 w-4 mr-2" />
                          Análise Profunda IA
                        </>
                      )}
                    </Button>
                    <Button variant="ghost" size="sm">
                      <Play className="h-4 w-4 mr-2" />
                      Reproduzir Áudio
                    </Button>
                    <Button variant="ghost" size="sm">
                      Ver Transcrição
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="skills" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {skillMetrics.map((skill) => (
              <Card key={skill.name} className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{skill.name}</CardTitle>
                    <div className="flex items-center space-x-2">
                      <Badge variant={skill.score >= skill.benchmark ? 'default' : 'secondary'}>
                        {skill.score >= skill.benchmark ? 'Acima do Benchmark' : 'Abaixo do Benchmark'}
                      </Badge>
                      {skill.trend === 'improving' ? (
                        <TrendUp className="h-4 w-4 text-green-500" />
                      ) : skill.trend === 'declining' ? (
                        <TrendDown className="h-4 w-4 text-red-500" />
                      ) : (
                        <div className="w-4 h-4 bg-gray-400 rounded-full" />
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Score Atual</span>
                      <span className="text-2xl font-bold">{skill.score}/100</span>
                    </div>
                    <Progress value={skill.score} className="h-3" />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span>Benchmark da Empresa: {skill.benchmark}</span>
                    <span className={`font-medium ${skill.change > 0 ? 'text-green-600' :
                      skill.change < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                      {skill.change > 0 ? '+' : ''}{skill.change} pts
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {insights.map((insight) => (
              <Card key={insight.id} className="glass-card">
                <CardHeader>
                  <div className="flex items-start space-x-2">
                    {insight.type === 'strength' ? (
                      <Trophy className="h-5 w-5 text-green-500" />
                    ) : insight.type === 'improvement' ? (
                      <Warning className="h-5 w-5 text-orange-500" />
                    ) : insight.type === 'pattern' ? (
                      <ChartBar className="h-5 w-5 text-blue-500" />
                    ) : (
                      <Lightbulb className="h-5 w-5 text-accent" />
                    )}
                    <div className="flex-1">
                      <CardTitle className="text-base">{insight.title}</CardTitle>
                      <div className="flex items-center space-x-2 mt-2">
                        <Badge variant="outline" className="text-xs">
                          {insight.frequency} ocorrências
                        </Badge>
                        <Badge className={
                          insight.impact === 'high' ? 'bg-red-100 text-red-800' :
                            insight.impact === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-green-100 text-green-800'
                        }>
                          Impacto {insight.impact === 'high' ? 'Alto' : insight.impact === 'medium' ? 'Médio' : 'Baixo'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {insight.description}
                  </p>
                  <Button size="sm" variant="outline" className="w-full">
                    <Target className="h-3 w-3 mr-2" />
                    Criar Plano de Ação
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Conversation Trends */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Tendências de Performance</CardTitle>
                <CardDescription>Evolução dos principais indicadores ao longo do tempo</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <ChartBar className="h-12 w-12 mx-auto mb-2 text-accent ai-processing" />
                    <p>Gráfico de tendências de conversas</p>
                    <p className="text-sm">Dados sendo processados pela IA...</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* AI Recommendations Summary */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Robot className="h-5 w-5 text-accent ai-processing" />
                  <span>Resumo de Recomendações IA</span>
                </CardTitle>
                <CardDescription>Ações prioritárias baseadas em análise de conversas</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <h4 className="font-semibold text-red-800 mb-1">Prioridade Alta</h4>
                    <p className="text-sm text-red-700">
                      Melhorar técnicas de manejo de objeções - 8 oportunidades perdidas identificadas
                    </p>
                  </div>

                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <h4 className="font-semibold text-yellow-800 mb-1">Prioridade Média</h4>
                    <p className="text-sm text-yellow-700">
                      Otimizar horários de calls para período 14h-16h (+35% conversão)
                    </p>
                  </div>

                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <h4 className="font-semibold text-green-800 mb-1">Ponto Forte</h4>
                    <p className="text-sm text-green-700">
                      Excelente estabelecimento de rapport (90%+ sentiment positivo)
                    </p>
                  </div>
                </div>

                <Button className="w-full">
                  <Brain className="h-4 w-4 mr-2" />
                  Gerar Plano de Desenvolvimento
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
