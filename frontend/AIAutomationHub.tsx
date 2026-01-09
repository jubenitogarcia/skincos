import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { Button } from "@/button"
import { Switch } from "@/switch"
import { Progress } from "@/progress"
import {
  Robot,
  Lightning,
  Sparkle,
  Gear,
  Target,
  TrendUp,
  Users,
  CalendarBlank,
  Brain,
  CheckCircle,
  Play,
  Pause
} from "@phosphor-icons/react"

interface AIAutomationHubProps {
  className?: string
}

export function AIAutomationHub({ className }: AIAutomationHubProps) {
  const automationRules = [
    {
      id: '1',
      name: 'Lead Scoring Automático',
      description: 'Classifica leads automaticamente baseado em comportamento e perfil',
      status: 'active',
      efficiency: 94,
      savings: '25h/semana'
    },
    {
      id: '2',
      name: 'Follow-up Inteligente',
      description: 'Envia follow-ups personalizados no momento ideal',
      status: 'active',
      efficiency: 87,
      savings: '18h/semana'
    },
    {
      id: '3',
      name: 'Distribuição de Leads',
      description: 'Distribui leads para vendedores baseado em perfil e carga',
      status: 'active',
      efficiency: 91,
      savings: '12h/semana'
    },
    {
      id: '4',
      name: 'Detecção de Churn',
      description: 'Identifica clientes em risco e aciona campanhas de retenção',
      status: 'paused',
      efficiency: 78,
      savings: '8h/semana'
    }
  ]

  const aiInsights = [
    {
      type: 'prediction',
      title: 'Previsão de Vendas',
      description: 'Modelo preditivo indica 85% de chance de bater meta mensal',
      confidence: 85,
      impact: 'high'
    },
    {
      type: 'opportunity',
      title: 'Oportunidades de Upsell',
      description: '12 clientes com alta probabilidade de expansão identificados',
      confidence: 92,
      impact: 'high'
    },
    {
      type: 'optimization',
      title: 'Otimização de Processo',
      description: 'Reduzir etapas no pipeline pode aumentar conversão em 15%',
      confidence: 78,
      impact: 'medium'
    },
    {
      type: 'alert',
      title: 'Alerta de Performance',
      description: 'Vendedor João Silva 40% abaixo da meta - sugerir treinamento',
      confidence: 95,
      impact: 'medium'
    }
  ]

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high': return 'text-red-600 bg-red-50 border-red-200'
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'low': return 'text-blue-600 bg-blue-50 border-blue-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'prediction': return <TrendUp className="h-4 w-4" />
      case 'opportunity': return <Target className="h-4 w-4" />
      case 'optimization': return <Gear className="h-4 w-4" />
      case 'alert': return <Lightning className="h-4 w-4" />
      default: return <Brain className="h-4 w-4" />
    }
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* AI Status Overview */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Robot className="h-6 w-6 text-accent ai-processing" />
              <div>
                <CardTitle>Central de Inteligência Artificial</CardTitle>
                <CardDescription>Sistema autônomo de otimização e insights</CardDescription>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="secondary" className="ai-processing">
                <Lightning className="h-3 w-3 mr-1" />
                Processando
              </Badge>
              <Badge variant="outline" className="text-green-600 border-green-200">
                <CheckCircle className="h-3 w-3 mr-1" />
                Online
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-accent mb-1">4</div>
              <div className="text-sm text-muted-foreground">Automações Ativas</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600 mb-1">63h</div>
              <div className="text-sm text-muted-foreground">Economia/Semana</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 mb-1">94%</div>
              <div className="text-sm text-muted-foreground">Precisão Média</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600 mb-1">156</div>
              <div className="text-sm text-muted-foreground">Insights Gerados</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Automation Rules */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center space-x-2">
                <Gear className="h-5 w-5" />
                <span>Regras de Automação</span>
              </CardTitle>
              <CardDescription>
                Configure e monitore automações inteligentes
              </CardDescription>
            </div>
            <Button>
              <Lightning className="h-4 w-4 mr-2" />
              Nova Regra
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {automationRules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={rule.status === 'active'}
                      className="data-[state=checked]:bg-accent"
                    />
                    {rule.status === 'active' ? (
                      <Play className="h-4 w-4 text-green-600" />
                    ) : (
                      <Pause className="h-4 w-4 text-yellow-600" />
                    )}
                  </div>
                  <div>
                    <h4 className="font-medium">{rule.name}</h4>
                    <p className="text-sm text-muted-foreground">{rule.description}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <div className="text-center">
                    <div className="text-sm font-medium">{rule.efficiency}%</div>
                    <div className="text-xs text-muted-foreground">Eficiência</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium text-green-600">{rule.savings}</div>
                    <div className="text-xs text-muted-foreground">Economia</div>
                  </div>
                  <Button variant="ghost" size="sm">
                    <Gear className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Insights */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Brain className="h-5 w-5 text-accent ai-processing" />
            <CardTitle>Insights de IA em Tempo Real</CardTitle>
            <Badge variant="secondary" className="ai-processing">
              <Sparkle className="h-3 w-3 mr-1" />
              Atualizando
            </Badge>
          </div>
          <CardDescription>
            Análises preditivas e recomendações acionáveis
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {aiInsights.map((insight, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border ${getImpactColor(insight.impact)}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    {getTypeIcon(insight.type)}
                    <h4 className="font-medium text-sm">{insight.title}</h4>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {insight.confidence}% confiança
                  </Badge>
                </div>
                <p className="text-sm mb-3 opacity-90">{insight.description}</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span>Nível de Confiança</span>
                    <span>{insight.confidence}%</span>
                  </div>
                  <Progress value={insight.confidence} className="h-1" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Training Status */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Sparkle className="h-5 w-5 text-accent ai-processing" />
            <span>Status do Aprendizado</span>
          </CardTitle>
          <CardDescription>
            Monitoramento contínuo da evolução da IA
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Modelo de Lead Scoring</span>
              <div className="flex items-center space-x-2">
                <Progress value={94} className="w-24 h-2" />
                <span className="text-sm font-medium">94%</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Previsão de Churn</span>
              <div className="flex items-center space-x-2">
                <Progress value={87} className="w-24 h-2" />
                <span className="text-sm font-medium">87%</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Análise de Sentimento</span>
              <div className="flex items-center space-x-2">
                <Progress value={91} className="w-24 h-2" />
                <span className="text-sm font-medium">91%</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Otimização de Preços</span>
              <div className="flex items-center space-x-2">
                <Progress value={78} className="w-24 h-2" />
                <span className="text-sm font-medium">78%</span>
              </div>
            </div>
          </div>

          <div className="mt-6 p-3 bg-accent/5 rounded-lg border border-accent/20">
            <div className="flex items-center space-x-2 mb-2">
              <Robot className="h-4 w-4 text-accent ai-processing" />
              <span className="font-medium text-sm">Próxima Atualização</span>
            </div>
            <p className="text-xs text-muted-foreground">
              O sistema será retreinado automaticamente com novos dados em 2 dias.
              Estimativa de melhoria na precisão: +3-5%
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
