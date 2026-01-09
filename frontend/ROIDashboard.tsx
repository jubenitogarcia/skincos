import { useState, useEffect } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Progress } from "@/progress"
import {
  TrendUp,
  TrendDown,
  CurrencyDollar,
  Target,
  ChartLine,
  Wallet,
  Calculator as CalcIcon,
  CalendarBlank,
  Sparkle,
  ArrowUp,
  ArrowDown,
  Minus,
  ChartPie,
  ChartBar,
  Pulse,
  Briefcase,
  Users,
  ShoppingCart,
  Rocket,
  Trophy,
  Lightning
} from "@phosphor-icons/react"

interface ROIMetric {
  id: string
  category: string
  investment: number
  revenue: number
  roi: number
  period: string
  status: 'positive' | 'negative' | 'neutral'
  trend: 'up' | 'down' | 'stable'
  details?: string
}

interface FinancialAnalysis {
  totalInvestment: number
  totalRevenue: number
  overallROI: number
  profitMargin: number
  customerAcquisitionCost: number
  lifetimeValue: number
  paybackPeriod: number
  marketingEfficiency: number
}

interface PredictiveInsight {
  id: string
  type: 'opportunity' | 'risk' | 'trend'
  title: string
  description: string
  impact: 'high' | 'medium' | 'low'
  confidence: number
  recommendation: string
  timeframe: string
}

export function ROIDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState("month")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [activeView, setActiveView] = useState("overview")

  // Initialize ROI data
  const [roiMetrics, setROIMetrics] = useKV<ROIMetric[]>("roi-metrics", [
    {
      id: "1",
      category: "Marketing Digital",
      investment: 25000,
      revenue: 95000,
      roi: 280,
      period: "Q1 2024",
      status: "positive",
      trend: "up",
      details: "Campanhas de Google Ads e Facebook"
    },
    {
      id: "2",
      category: "CRM Software",
      investment: 15000,
      revenue: 85000,
      roi: 467,
      period: "Q1 2024",
      status: "positive",
      trend: "up",
      details: "Licenças e implementação"
    },
    {
      id: "3",
      category: "Treinamento Equipe",
      investment: 8000,
      revenue: 45000,
      roi: 463,
      period: "Q1 2024",
      status: "positive",
      trend: "stable",
      details: "Capacitação em vendas consultivas"
    },
    {
      id: "4",
      category: "Automação Marketing",
      investment: 12000,
      revenue: 68000,
      roi: 467,
      period: "Q1 2024",
      status: "positive",
      trend: "up",
      details: "Ferramentas de email marketing e lead nurturing"
    },
    {
      id: "5",
      category: "IA e Analytics",
      investment: 18000,
      revenue: 125000,
      roi: 594,
      period: "Q1 2024",
      status: "positive",
      trend: "up",
      details: "Implementação de chatbots e análise preditiva"
    }
  ])

  // Calculate financial analysis
  const financialAnalysis: FinancialAnalysis = {
    totalInvestment: roiMetrics.reduce((sum, metric) => sum + metric.investment, 0),
    totalRevenue: roiMetrics.reduce((sum, metric) => sum + metric.revenue, 0),
    overallROI: 0,
    profitMargin: 0,
    customerAcquisitionCost: 125,
    lifetimeValue: 2850,
    paybackPeriod: 4.2,
    marketingEfficiency: 3.8
  }

  financialAnalysis.overallROI = ((financialAnalysis.totalRevenue - financialAnalysis.totalInvestment) / financialAnalysis.totalInvestment) * 100
  financialAnalysis.profitMargin = ((financialAnalysis.totalRevenue - financialAnalysis.totalInvestment) / financialAnalysis.totalRevenue) * 100

  // Predictive insights
  const [predictiveInsights] = useKV<PredictiveInsight[]>("predictive-insights", [
    {
      id: "1",
      type: "opportunity",
      title: "Potencial de Expansão IA",
      description: "Aumento de 40% no ROI de IA nos próximos 6 meses com investimento adicional",
      impact: "high",
      confidence: 87,
      recommendation: "Investir mais R$ 25K em soluções de IA avançada",
      timeframe: "6 meses"
    },
    {
      id: "2",
      type: "trend",
      title: "Marketing Digital Saturação",
      description: "ROI de marketing digital pode diminuir 15% devido à saturação do mercado",
      impact: "medium",
      confidence: 73,
      recommendation: "Diversificar canais de aquisição",
      timeframe: "3 meses"
    },
    {
      id: "3",
      type: "opportunity",
      title: "Otimização CAC",
      description: "Redução potencial de 25% no CAC com melhor segmentação",
      impact: "high",
      confidence: 91,
      recommendation: "Implementar segmentação comportamental avançada",
      timeframe: "2 meses"
    }
  ])

  // ROI chart data
  const roiChartData = [
    { category: "IA & Analytics", roi: 594, investment: 18000, color: "bg-purple-500" },
    { category: "CRM Software", roi: 467, investment: 15000, color: "bg-blue-500" },
    { category: "Treinamento", roi: 463, investment: 8000, color: "bg-green-500" },
    { category: "Marketing Digital", roi: 280, investment: 25000, color: "bg-orange-500" },
    { category: "Automação", roi: 467, investment: 12000, color: "bg-cyan-500" }
  ]

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  }

  const formatPercentage = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
  }

  const getROIColor = (roi: number) => {
    if (roi >= 400) return "text-green-600"
    if (roi >= 200) return "text-blue-600"
    if (roi >= 100) return "text-yellow-600"
    return "text-red-600"
  }

  const getROIBadgeColor = (roi: number) => {
    if (roi >= 400) return "bg-green-100 text-green-800 border-green-200"
    if (roi >= 200) return "bg-blue-100 text-blue-800 border-blue-200"
    if (roi >= 100) return "bg-yellow-100 text-yellow-800 border-yellow-200"
    return "bg-red-100 text-red-800 border-red-200"
  }

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
      case 'opportunity': return <Rocket className="h-4 w-4" />
      case 'risk': return <Pulse className="h-4 w-4" />
      case 'trend': return <TrendUp className="h-4 w-4" />
      default: return <Sparkle className="h-4 w-4" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Dashboard ROI & Análise Financeira</h2>
          <p className="text-muted-foreground">
            Insights avançados sobre retorno de investimento e performance financeira
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Semana</SelectItem>
              <SelectItem value="month">Mês</SelectItem>
              <SelectItem value="quarter">Trimestre</SelectItem>
              <SelectItem value="year">Ano</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <CalendarBlank className="h-4 w-4 mr-2" />
            Relatório
          </Button>
        </div>
      </div>

      {/* Key Financial Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">ROI Geral</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatPercentage(financialAnalysis.overallROI)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  vs. {formatPercentage(financialAnalysis.overallROI - 23)} mês anterior
                </p>
              </div>
              <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center">
                <TrendUp className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Receita Total</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(financialAnalysis.totalRevenue)}
                </p>
                <p className="text-xs text-green-600 mt-1 flex items-center">
                  <ArrowUp className="h-3 w-3 mr-1" />
                  +18.2% vs. anterior
                </p>
              </div>
              <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <CurrencyDollar className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">CAC</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(financialAnalysis.customerAcquisitionCost)}
                </p>
                <p className="text-xs text-green-600 mt-1 flex items-center">
                  <ArrowDown className="h-3 w-3 mr-1" />
                  -12.5% otimização
                </p>
              </div>
              <div className="h-12 w-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <Users className="h-6 w-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">LTV</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(financialAnalysis.lifetimeValue)}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Ratio LTV/CAC: {(financialAnalysis.lifetimeValue / financialAnalysis.customerAcquisitionCost).toFixed(1)}x
                </p>
              </div>
              <div className="h-12 w-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Target className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeView} onValueChange={setActiveView} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" className="flex items-center space-x-2">
            <ChartBar className="h-4 w-4" />
            <span>Visão Geral</span>
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex items-center space-x-2">
            <ChartPie className="h-4 w-4" />
            <span>Por Categoria</span>
          </TabsTrigger>
          <TabsTrigger value="predictions" className="flex items-center space-x-2">
            <Sparkle className="h-4 w-4" />
            <span>Insights IA</span>
          </TabsTrigger>
          <TabsTrigger value="analysis" className="flex items-center space-x-2">
            <CalcIcon className="h-4 w-4" />
            <span>Análise Avançada</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* ROI Performance Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <ChartLine className="h-5 w-5" />
                <span>Performance ROI por Categoria</span>
              </CardTitle>
              <CardDescription>
                Comparativo de retorno sobre investimento entre diferentes áreas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {roiChartData.map((item, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${item.color}`}></div>
                        <span className="font-medium">{item.category}</span>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className="text-sm text-muted-foreground">
                          {formatCurrency(item.investment)}
                        </span>
                        <Badge className={getROIBadgeColor(item.roi)}>
                          {formatPercentage(item.roi)}
                        </Badge>
                      </div>
                    </div>
                    <Progress
                      value={Math.min(item.roi / 6, 100)}
                      className="h-2"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Investment Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Distribuição de Investimentos</CardTitle>
                <CardDescription>Alocação de recursos por categoria</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {roiMetrics.map((metric) => (
                    <div key={metric.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div>
                        <p className="font-medium">{metric.category}</p>
                        <p className="text-sm text-muted-foreground">{metric.period}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(metric.investment)}</p>
                        <p className={`text-sm ${getROIColor(metric.roi)}`}>
                          ROI: {formatPercentage(metric.roi)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Métricas de Eficiência</CardTitle>
                <CardDescription>Indicadores chave de performance financeira</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Wallet className="h-4 w-4 text-blue-600" />
                    <span className="font-medium">Margem de Lucro</span>
                  </div>
                  <span className="font-semibold text-blue-600">
                    {formatPercentage(financialAnalysis.profitMargin)}
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <CalendarBlank className="h-4 w-4 text-green-600" />
                    <span className="font-medium">Payback Period</span>
                  </div>
                  <span className="font-semibold text-green-600">
                    {financialAnalysis.paybackPeriod} meses
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Lightning className="h-4 w-4 text-purple-600" />
                    <span className="font-medium">Eficiência Marketing</span>
                  </div>
                  <span className="font-semibold text-purple-600">
                    {financialAnalysis.marketingEfficiency}x
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Trophy className="h-4 w-4 text-orange-600" />
                    <span className="font-medium">Score Financeiro</span>
                  </div>
                  <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-200">
                    Excelente (9.2/10)
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="categories" className="space-y-6">
          {/* Category Funnel */}
          <div className="flex items-center space-x-4">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Selecionar categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Categorias</SelectItem>
                <SelectItem value="marketing">Marketing Digital</SelectItem>
                <SelectItem value="software">Software & Tecnologia</SelectItem>
                <SelectItem value="training">Treinamento</SelectItem>
                <SelectItem value="automation">Automação</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Detailed ROI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {roiMetrics.map((metric) => (
              <Card key={metric.id} className="glass-card hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{metric.category}</CardTitle>
                    <Badge className={getROIBadgeColor(metric.roi)}>
                      {formatPercentage(metric.roi)}
                    </Badge>
                  </div>
                  <CardDescription>{metric.details}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Investimento</p>
                      <p className="font-semibold">{formatCurrency(metric.investment)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Receita</p>
                      <p className="font-semibold text-green-600">{formatCurrency(metric.revenue)}</p>
                    </div>
                  </div>

                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Tendência</span>
                      <div className="flex items-center space-x-1">
                        {metric.trend === 'up' && <ArrowUp className="h-4 w-4 text-green-600" />}
                        {metric.trend === 'down' && <ArrowDown className="h-4 w-4 text-red-600" />}
                        {metric.trend === 'stable' && <Minus className="h-4 w-4 text-gray-600" />}
                        <span className={`text-sm ${metric.trend === 'up' ? 'text-green-600' :
                          metric.trend === 'down' ? 'text-red-600' : 'text-gray-600'
                          }`}>
                          {metric.trend === 'up' ? 'Crescimento' :
                            metric.trend === 'down' ? 'Declínio' : 'Estável'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <Progress
                    value={Math.min(metric.roi / 5, 100)}
                    className="h-2"
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="predictions" className="space-y-6">
          {/* AI Insights Header */}
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center space-x-2">
                <Sparkle className="h-5 w-5 text-accent ai-processing" />
                <CardTitle>Insights Preditivos de IA</CardTitle>
                <Badge variant="secondary" className="ai-processing">
                  <Lightning className="h-3 w-3 mr-1" />
                  Processando
                </Badge>
              </div>
              <CardDescription>
                Análise preditiva baseada em IA para otimização de ROI e identificação de oportunidades
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Predictive Insights */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {predictiveInsights.map((insight) => (
              <Card key={insight.id} className="glass-card hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getTypeIcon(insight.type)}
                      <CardTitle className="text-lg">{insight.title}</CardTitle>
                    </div>
                    <Badge className={getImpactColor(insight.impact)}>
                      {insight.impact}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{insight.description}</p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Confiança IA</span>
                      <span className="text-sm font-semibold">{insight.confidence}%</span>
                    </div>
                    <Progress value={insight.confidence} className="h-2" />
                  </div>

                  <div className="pt-2 border-t">
                    <p className="text-sm font-medium mb-1">Recomendação:</p>
                    <p className="text-sm text-muted-foreground">{insight.recommendation}</p>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Prazo: {insight.timeframe}</span>
                    <Badge variant="outline">
                      IA Avançada
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* AI Recommendations Summary */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <CalcIcon className="h-5 w-5" />
                <span>Resumo de Recomendações IA</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <Rocket className="h-4 w-4 text-green-600" />
                    <span className="font-medium text-green-800">Potencial de Crescimento</span>
                  </div>
                  <p className="text-2xl font-bold text-green-600">+45%</p>
                  <p className="text-sm text-green-700">ROI médio com implementação das recomendações</p>
                </div>

                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <Target className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-800">Otimização CAC</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-600">-25%</p>
                  <p className="text-sm text-blue-700">Redução potencial no custo de aquisição</p>
                </div>

                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="flex items-center space-x-2 mb-2">
                    <Lightning className="h-4 w-4 text-purple-600" />
                    <span className="font-medium text-purple-800">Eficiência</span>
                  </div>
                  <p className="text-2xl font-bold text-purple-600">6.2x</p>
                  <p className="text-sm text-purple-700">Nova eficiência marketing projetada</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis" className="space-y-6">
          {/* Advanced Financial Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Análise de Sensibilidade</CardTitle>
                <CardDescription>Como mudanças nos investimentos afetam o ROI</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <span className="text-sm font-medium">+10% Investimento IA</span>
                    <span className="text-sm font-semibold text-green-600">+23% ROI</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                    <span className="text-sm font-medium">+15% Budget Marketing</span>
                    <span className="text-sm font-semibold text-blue-600">+8% ROI</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                    <span className="text-sm font-medium">+20% Treinamento</span>
                    <span className="text-sm font-semibold text-orange-600">+15% ROI</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Benchmarking Setorial</CardTitle>
                <CardDescription>Comparação com médias do mercado</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">ROI Marketing Digital</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-muted-foreground">Mercado: 180%</span>
                      <span className="text-sm font-semibold text-green-600">Você: 280%</span>
                    </div>
                  </div>
                  <Progress value={75} className="h-2" />

                  <div className="flex items-center justify-between">
                    <span className="text-sm">CAC Médio</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-muted-foreground">Mercado: R$180</span>
                      <span className="text-sm font-semibold text-green-600">Você: R$125</span>
                    </div>
                  </div>
                  <Progress value={85} className="h-2" />

                  <div className="flex items-center justify-between">
                    <span className="text-sm">LTV/CAC Ratio</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-muted-foreground">Mercado: 3.2x</span>
                      <span className="text-sm font-semibold text-green-600">Você: 22.8x</span>
                    </div>
                  </div>
                  <Progress value={95} className="h-2" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Financial Breakdown */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Análise Detalhada de Cash Flow</CardTitle>
              <CardDescription>Projeção de fluxo de caixa e retorno por trimestre</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-4 text-sm font-medium text-muted-foreground border-b pb-2">
                  <span>Período</span>
                  <span>Investimento</span>
                  <span>Receita</span>
                  <span>ROI Acumulado</span>
                </div>

                {[
                  { period: "Q1 2024", investment: 78000, revenue: 418000, roi: 436 },
                  { period: "Q2 2024", investment: 85000, revenue: 485000, roi: 470 },
                  { period: "Q3 2024", investment: 92000, revenue: 562000, roi: 511 },
                  { period: "Q4 2024", investment: 88000, revenue: 615000, roi: 598 }
                ].map((item, index) => (
                  <div key={index} className="grid grid-cols-4 gap-4 text-sm py-2 border-b border-muted/30">
                    <span className="font-medium">{item.period}</span>
                    <span>{formatCurrency(item.investment)}</span>
                    <span className="text-green-600 font-medium">{formatCurrency(item.revenue)}</span>
                    <span className={`font-semibold ${getROIColor(item.roi)}`}>
                      {formatPercentage(item.roi)}
                    </span>
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
