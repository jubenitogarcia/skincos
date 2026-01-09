import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Progress } from "@/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/dialog"
import { ConversationAnalytics } from '@/ConversationAnalytics'
import { GamificationSystem } from '@/GamificationSystem'
import { SmartNotifications } from '@/SmartNotifications'
import {
  Brain,
  Target,
  TrendUp,
  TrendDown,
  Clock,
  Trophy,
  Users,
  PhoneCall,
  Envelope,
  CalendarBlank,
  CheckCircle,
  XCircle,
  Lightbulb,
  Robot,
  Star,
  ArrowUp,
  ArrowDown,
  Play,
  BookOpen,
  Lightning
} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface PerformanceMetric {
  id: string
  name: string
  currentValue: number
  targetValue: number
  trend: 'up' | 'down' | 'stable'
  change: number
  category: 'sales' | 'activity' | 'quality' | 'time'
}

interface CoachingRecommendation {
  id: string
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  category: 'skill' | 'process' | 'behavior' | 'strategy'
  aiConfidence: number
  estimatedImpact: string
  timeToImplement: string
  resources: string[]
  completed: boolean
  createdAt: string
}

interface LearningPath {
  id: string
  title: string
  description: string
  modules: {
    id: string
    title: string
    duration: string
    completed: boolean
    type: 'video' | 'reading' | 'interactive' | 'assessment'
  }[]
  progress: number
  estimatedCompletion: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
}

interface PerformanceInsight {
  id: string
  type: 'achievement' | 'improvement' | 'warning' | 'opportunity'
  title: string
  description: string
  actionable: boolean
  timestamp: string
}

export function PerformanceCoaching() {
  const [selectedAgent, setSelectedAgent] = useState('current-user')
  const [showRecommendationDetails, setShowRecommendationDetails] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // Performance data with KV persistence
  const [metrics, setMetrics] = useKV<PerformanceMetric[]>('performance-metrics', [
    {
      id: '1',
      name: 'Taxa de Conversão',
      currentValue: 23.5,
      targetValue: 30,
      trend: 'up',
      change: 4.2,
      category: 'sales'
    },
    {
      id: '2',
      name: 'Calls por Dia',
      currentValue: 42,
      targetValue: 50,
      trend: 'down',
      change: -8.3,
      category: 'activity'
    },
    {
      id: '3',
      name: 'Tempo Médio de Resposta',
      currentValue: 3.2,
      targetValue: 2.0,
      trend: 'up',
      change: 12.1,
      category: 'time'
    },
    {
      id: '4',
      name: 'Score de Qualidade',
      currentValue: 8.7,
      targetValue: 9.0,
      trend: 'stable',
      change: 0.5,
      category: 'quality'
    }
  ])

  const [recommendations, setRecommendations] = useKV<CoachingRecommendation[]>('coaching-recommendations', [
    {
      id: '1',
      title: 'Otimizar Horário de Calls',
      description: 'Análise de dados mostra que suas calls entre 14h-16h têm 34% mais taxa de conversão. Considere reorganizar sua agenda.',
      priority: 'high',
      category: 'strategy',
      aiConfidence: 92,
      estimatedImpact: '+15% conversão',
      timeToImplement: '1 semana',
      resources: ['Guia de Otimização de Agenda', 'Template de Planejamento'],
      completed: false,
      createdAt: new Date().toISOString()
    },
    {
      id: '2',
      title: 'Melhorar Follow-up de E-mails',
      description: 'IA detectou que 67% dos seus leads não recebem follow-up após 48h. Implementar sequência automatizada pode aumentar conversão.',
      priority: 'high',
      category: 'process',
      aiConfidence: 88,
      estimatedImpact: '+25% engajamento',
      timeToImplement: '3 dias',
      resources: ['Templates de E-mail', 'Automação de Sequências'],
      completed: false,
      createdAt: new Date().toISOString()
    },
    {
      id: '3',
      title: 'Desenvolver Técnicas de Objeção',
      description: 'Análise de calls identifica que 45% das objeções sobre preço não são tratadas adequadamente. Treinamento específico recomendado.',
      priority: 'medium',
      category: 'skill',
      aiConfidence: 85,
      estimatedImpact: '+20% fechamento',
      timeToImplement: '2 semanas',
      resources: ['Curso de Objeções', 'Scripts Personalizados', 'Role-play Sessions'],
      completed: false,
      createdAt: new Date().toISOString()
    }
  ])

  const [learningPaths, setLearningPaths] = useKV<LearningPath[]>('learning-paths', [
    {
      id: '1',
      title: 'Maestria em Vendas Consultivas',
      description: 'Desenvolva habilidades avançadas para identificar necessidades do cliente e criar soluções personalizadas.',
      modules: [
        { id: '1', title: 'Fundamentos da Venda Consultiva', duration: '45 min', completed: true, type: 'video' },
        { id: '2', title: 'Técnicas de Discovery', duration: '30 min', completed: true, type: 'interactive' },
        { id: '3', title: 'Apresentação de Soluções', duration: '60 min', completed: false, type: 'video' },
        { id: '4', title: 'Fechamento Consultivo', duration: '40 min', completed: false, type: 'assessment' }
      ],
      progress: 50,
      estimatedCompletion: '3 semanas',
      difficulty: 'intermediate'
    },
    {
      id: '2',
      title: 'Comunicação Digital Eficaz',
      description: 'Otimize sua comunicação em canais digitais para maximizar engajamento e conversão.',
      modules: [
        { id: '1', title: 'E-mail Marketing Personalizado', duration: '35 min', completed: false, type: 'reading' },
        { id: '2', title: 'WhatsApp Business Avançado', duration: '25 min', completed: false, type: 'interactive' },
        { id: '3', title: 'Social Selling no LinkedIn', duration: '50 min', completed: false, type: 'video' }
      ],
      progress: 0,
      estimatedCompletion: '2 semanas',
      difficulty: 'beginner'
    }
  ])

  const [insights, setInsights] = useKV<PerformanceInsight[]>('performance-insights', [
    {
      id: '1',
      type: 'achievement',
      title: 'Meta de Calls Alcançada!',
      description: 'Você superou sua meta semanal de calls em 12%. Excelente trabalho!',
      actionable: false,
      timestamp: new Date().toISOString()
    },
    {
      id: '2',
      type: 'opportunity',
      title: 'Oportunidade de Upselling',
      description: '3 clientes ativos demonstram potencial para upgrade. Score de propensão: 89%',
      actionable: true,
      timestamp: new Date().toISOString()
    },
    {
      id: '3',
      type: 'warning',
      title: 'Tempo de Resposta Aumentando',
      description: 'Tempo médio de resposta subiu 15% esta semana. Considere otimizar workflow.',
      actionable: true,
      timestamp: new Date().toISOString()
    }
  ])

  const generateAIRecommendations = async () => {
    setIsAnalyzing(true)

    try {
      // Simulate AI analysis
      await new Promise(resolve => setTimeout(resolve, 2000))

      const newRecommendation: CoachingRecommendation = {
        id: Date.now().toString(),
        title: 'Personalizar Abordagem por Persona',
        description: 'IA identificou 3 personas distintas nos seus leads. Personalizar abordagem pode aumentar conversão em 28%.',
        priority: 'high',
        category: 'strategy',
        aiConfidence: 94,
        estimatedImpact: '+28% conversão',
        timeToImplement: '5 dias',
        resources: ['Guia de Personas', 'Scripts Personalizados', 'Análise Comportamental'],
        completed: false,
        createdAt: new Date().toISOString()
      }

      setRecommendations(current => [newRecommendation, ...current])
      toast.success('Novas recomendações de IA geradas!')

    } catch (error) {
      toast.error('Erro ao gerar recomendações')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const completeRecommendation = (id: string) => {
    setRecommendations(current =>
      current.map(rec =>
        rec.id === id ? { ...rec, completed: true } : rec
      )
    )
    toast.success('Recomendação marcada como concluída!')
  }

  const startLearningModule = (pathId: string, moduleId: string) => {
    setLearningPaths(current =>
      current.map(path =>
        path.id === pathId
          ? {
            ...path,
            modules: path.modules.map(module =>
              module.id === moduleId ? { ...module, completed: true } : module
            ),
            progress: Math.round(
              (path.modules.filter(m => m.completed || m.id === moduleId).length /
                path.modules.length) * 100
            )
          }
          : path
      )
    )
    toast.success('Módulo concluído! Continue aprendendo.')
  }

  const getMetricIcon = (category: string) => {
    switch (category) {
      case 'sales': return <Target className="h-4 w-4" />
      case 'activity': return <CalendarBlank className="h-4 w-4" />
      case 'quality': return <Trophy className="h-4 w-4" />
      case 'time': return <Clock className="h-4 w-4" />
      default: return <TrendUp className="h-4 w-4" />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200'
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'low': return 'bg-green-100 text-green-800 border-green-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'achievement': return <Trophy className="h-5 w-5 text-yellow-500" />
      case 'opportunity': return <Lightbulb className="h-5 w-5 text-blue-500" />
      case 'warning': return <XCircle className="h-5 w-5 text-red-500" />
      case 'improvement': return <TrendUp className="h-5 w-5 text-green-500" />
      default: return <Brain className="h-5 w-5 text-accent" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Brain className="h-6 w-6 text-accent ai-processing" />
            <span>Coaching de Performance com IA</span>
          </h2>
          <p className="text-muted-foreground">
            Análise comportamental e recomendações personalizadas para maximizar performance
          </p>
        </div>
        <Button onClick={generateAIRecommendations} disabled={isAnalyzing}>
          {isAnalyzing ? (
            <>
              <Robot className="h-4 w-4 mr-2 ai-processing" />
              Analisando...
            </>
          ) : (
            <>
              <Lightning className="h-4 w-4 mr-2" />
              Gerar Recomendações IA
            </>
          )}
        </Button>
      </div>

      {/* Performance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric) => (
          <Card key={metric.id} className="glass-card">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {getMetricIcon(metric.category)}
                  <span className="text-sm font-medium">{metric.name}</span>
                </div>
                {metric.trend === 'up' ? (
                  <ArrowUp className="h-4 w-4 text-green-500" />
                ) : metric.trend === 'down' ? (
                  <ArrowDown className="h-4 w-4 text-red-500" />
                ) : (
                  <div className="w-4 h-4 bg-gray-300 rounded-full" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-bold">
                    {metric.category === 'time' ? `${metric.currentValue}h` : metric.currentValue}
                    {metric.category === 'sales' || metric.category === 'quality' ?
                      (metric.name.includes('Taxa') ? '%' : '/10') : ''}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    / {metric.targetValue}
                    {metric.category === 'time' ? 'h' : ''}
                    {metric.category === 'sales' || metric.category === 'quality' ?
                      (metric.name.includes('Taxa') ? '%' : '/10') : ''}
                  </span>
                </div>
                <Progress
                  value={(metric.currentValue / metric.targetValue) * 100}
                  className="h-2"
                />
                <div className="flex items-center space-x-1">
                  <span className={`text-xs ${metric.trend === 'up' ? 'text-green-600' :
                    metric.trend === 'down' ? 'text-red-600' : 'text-gray-600'
                    }`}>
                    {metric.change > 0 ? '+' : ''}{metric.change}%
                  </span>
                  <span className="text-xs text-muted-foreground">esta semana</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="recommendations" className="space-y-6">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="recommendations">Recomendações IA</TabsTrigger>
          <TabsTrigger value="learning">Trilhas de Aprendizado</TabsTrigger>
          <TabsTrigger value="insights">Insights Comportamentais</TabsTrigger>
          <TabsTrigger value="conversations">Análise de Conversas</TabsTrigger>
          <TabsTrigger value="gamification">Gamificação</TabsTrigger>
          <TabsTrigger value="notifications">Notificações</TabsTrigger>
          <TabsTrigger value="analytics">Analytics Avançado</TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {recommendations.map((recommendation) => (
              <Card key={recommendation.id} className={`glass-card ${recommendation.completed ? 'opacity-75' : ''}`}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <CardTitle className="text-lg">{recommendation.title}</CardTitle>
                        {recommendation.completed && (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge className={getPriorityColor(recommendation.priority)}>
                          {recommendation.priority === 'high' ? 'Alta' :
                            recommendation.priority === 'medium' ? 'Média' : 'Baixa'} Prioridade
                        </Badge>
                        <Badge variant="outline">
                          <Brain className="h-3 w-3 mr-1" />
                          {recommendation.aiConfidence}% confiança
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {recommendation.description}
                  </p>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-green-600">Impacto Estimado:</span>
                      <p>{recommendation.estimatedImpact}</p>
                    </div>
                    <div>
                      <span className="font-medium text-blue-600">Tempo:</span>
                      <p>{recommendation.timeToImplement}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <BookOpen className="h-4 w-4 mr-2" />
                          Ver Detalhes
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>{recommendation.title}</DialogTitle>
                          <DialogDescription>
                            Recomendação gerada por IA com {recommendation.aiConfidence}% de confiança
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <h4 className="font-semibold mb-2">Descrição Detalhada</h4>
                            <p className="text-sm text-muted-foreground">
                              {recommendation.description}
                            </p>
                          </div>

                          <div>
                            <h4 className="font-semibold mb-2">Recursos Necessários</h4>
                            <ul className="space-y-1">
                              {recommendation.resources.map((resource, index) => (
                                <li key={index} className="text-sm flex items-center space-x-2">
                                  <CheckCircle className="h-3 w-3 text-green-500" />
                                  <span>{resource}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="flex items-center space-x-2 pt-4">
                            <Button onClick={() => completeRecommendation(recommendation.id)}>
                              Implementar Recomendação
                            </Button>
                            <Button variant="outline">
                              Solicitar Mais Detalhes
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {!recommendation.completed && (
                      <Button
                        size="sm"
                        onClick={() => completeRecommendation(recommendation.id)}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Concluir
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="learning" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {learningPaths.map((path) => (
              <Card key={path.id} className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <BookOpen className="h-5 w-5 text-accent" />
                    <span>{path.title}</span>
                  </CardTitle>
                  <CardDescription>{path.description}</CardDescription>
                  <div className="flex items-center space-x-4 text-sm">
                    <Badge variant="outline">{path.difficulty}</Badge>
                    <span className="text-muted-foreground">
                      Conclusão estimada: {path.estimatedCompletion}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Progresso</span>
                      <span className="text-sm text-muted-foreground">{path.progress}%</span>
                    </div>
                    <Progress value={path.progress} className="h-2" />
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm">Módulos</h4>
                    {path.modules.map((module) => (
                      <div key={module.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                        <div className="flex items-center space-x-3">
                          {module.completed ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <div className="h-4 w-4 rounded-full border-2 border-muted-foreground" />
                          )}
                          <div>
                            <p className="text-sm font-medium">{module.title}</p>
                            <p className="text-xs text-muted-foreground">{module.duration}</p>
                          </div>
                        </div>
                        {!module.completed && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startLearningModule(path.id, module.id)}
                          >
                            <Play className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
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
                <CardHeader className="pb-3">
                  <div className="flex items-start space-x-3">
                    {getInsightIcon(insight.type)}
                    <div className="flex-1">
                      <CardTitle className="text-base">{insight.title}</CardTitle>
                      <CardDescription className="text-sm mt-1">
                        {insight.description}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                {insight.actionable && (
                  <CardContent className="pt-0">
                    <Button size="sm" variant="outline" className="w-full">
                      <Lightbulb className="h-3 w-3 mr-2" />
                      Tomar Ação
                    </Button>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>

          {/* Behavioral Analytics */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Brain className="h-5 w-5 text-accent ai-processing" />
                <span>Análise Comportamental IA</span>
              </CardTitle>
              <CardDescription>
                Padrões identificados através de machine learning
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <Clock className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-800">Padrão Temporal</span>
                  </div>
                  <p className="text-sm text-blue-700">
                    Você é 40% mais produtivo entre 9h-11h. Considere agendar calls importantes neste período.
                  </p>
                </div>

                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <Users className="h-4 w-4 text-green-600" />
                    <span className="font-medium text-green-800">Estilo de Comunicação</span>
                  </div>
                  <p className="text-sm text-green-700">
                    Abordagem consultiva gera 28% mais engajamento que abordagem direta.
                  </p>
                </div>

                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <Target className="h-4 w-4 text-purple-600" />
                    <span className="font-medium text-purple-800">Segmento Ideal</span>
                  </div>
                  <p className="text-sm text-purple-700">
                    Empresas de 50-200 funcionários têm 3x mais probabilidade de conversão.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations">
          <ConversationAnalytics />
        </TabsContent>

        <TabsContent value="gamification">
          <GamificationSystem />
        </TabsContent>

        <TabsContent value="notifications">
          <SmartNotifications />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Performance Trends */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Tendências de Performance</CardTitle>
                <CardDescription>Evolução dos principais indicadores</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <TrendUp className="h-12 w-12 mx-auto mb-2 text-accent ai-processing" />
                    <p>Gráfico de tendências em tempo real</p>
                    <p className="text-sm">Dados sendo processados pela IA...</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Skill Assessment */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Avaliação de Competências</CardTitle>
                <CardDescription>Score IA baseado em performance real</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { skill: 'Comunicação', score: 92, trend: 'up' },
                  { skill: 'Negociação', score: 78, trend: 'stable' },
                  { skill: 'Relacionamento', score: 95, trend: 'up' },
                  { skill: 'Organização', score: 71, trend: 'down' }
                ].map((skill) => (
                  <div key={skill.skill} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{skill.skill}</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm">{skill.score}/100</span>
                        {skill.trend === 'up' ? (
                          <ArrowUp className="h-3 w-3 text-green-500" />
                        ) : skill.trend === 'down' ? (
                          <ArrowDown className="h-3 w-3 text-red-500" />
                        ) : (
                          <div className="w-3 h-3 bg-gray-300 rounded-full" />
                        )}
                      </div>
                    </div>
                    <Progress value={skill.score} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* AI Coaching Summary */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Robot className="h-5 w-5 text-accent ai-processing" />
                <span>Resumo do Coach IA</span>
              </CardTitle>
              <CardDescription>
                Análise consolidada e próximos passos recomendados
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
                <h4 className="font-semibold mb-2 flex items-center space-x-2">
                  <Star className="h-4 w-4 text-accent" />
                  <span>Destaque da Semana</span>
                </h4>
                <p className="text-sm text-muted-foreground">
                  Excelente melhoria na taxa de conversão (+15%). Continue focando em calls personalizadas
                  e implemente as recomendações de timing para maximizar resultados.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <Trophy className="h-8 w-8 text-green-600 mx-auto mb-2" />
                  <p className="font-semibold text-green-800">Pontos Fortes</p>
                  <p className="text-sm text-green-700">Relacionamento com clientes</p>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <Target className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                  <p className="font-semibold text-blue-800">Foco Atual</p>
                  <p className="text-sm text-blue-700">Otimização de processos</p>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded-lg">
                  <Lightbulb className="h-8 w-8 text-orange-600 mx-auto mb-2" />
                  <p className="font-semibold text-orange-800">Próximo Nível</p>
                  <p className="text-sm text-orange-700">Automação avançada</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
