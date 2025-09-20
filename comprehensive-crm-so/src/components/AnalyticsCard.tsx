import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatCurrency, formatNumber } from "@/lib/utils"
import {
  ChartLineUp,
  TrendUp,
  TrendDown,
  Users,
  Target,
  Funnel,
  CalendarBlank,
  Sparkle,
  Download
} from "@phosphor-icons/react"

interface AnalyticsCardProps {
  title: string
  value: string | number
  change?: number
  trend?: 'up' | 'down' | 'stable'
  type: 'revenue' | 'conversion' | 'leads' | 'activities' | 'forecast'
  period?: string
  children?: React.ReactNode
}

export function AnalyticsCard({
  title,
  value,
  change,
  trend,
  type,
  period = "30 dias",
  children
}: AnalyticsCardProps) {
  const getIcon = () => {
    switch (type) {
      case 'revenue': return <ChartLineUp className="h-5 w-5" />
      case 'conversion': return <Funnel className="h-5 w-5" />
      case 'leads': return <Users className="h-5 w-5" />
      case 'activities': return <CalendarBlank className="h-5 w-5" />
      case 'forecast': return <Target className="h-5 w-5" />
      default: return <ChartLineUp className="h-5 w-5" />
    }
  }

  const getColor = () => {
    switch (type) {
      case 'revenue': return 'text-green-600'
      case 'conversion': return 'text-blue-600'
      case 'leads': return 'text-orange-600'
      case 'activities': return 'text-purple-600'
      case 'forecast': return 'text-indigo-600'
      default: return 'text-gray-600'
    }
  }

  const TrendIcon = trend === 'up' ? TrendUp : trend === 'down' ? TrendDown : null
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-600'

  return (
    <Card className="glass-card hover:shadow-lg transition-all duration-300">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <div className="flex items-center space-x-2">
            <div className={getColor()}>
              {getIcon()}
            </div>
            <Badge variant="secondary" className="text-xs">
              {period}
            </Badge>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="sm">
            <Funnel className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold">
              {typeof value === 'number' ? formatNumber(value) : value}
            </div>
            {change !== undefined && TrendIcon && (
              <div className={`flex items-center text-xs ${trendColor}`}>
                <TrendIcon className="mr-1 h-3 w-3" />
                {Math.abs(change)}%
              </div>
            )}
          </div>

          {children}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Análise realizada por IA</span>
            <Sparkle className="h-3 w-3 ai-processing" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface PipelineAnalyticsProps {
  data: {
    stage: string
    count: number
    value: number
    conversionRate: number
  }[]
}

export function PipelineAnalytics({ data }: PipelineAnalyticsProps) {
  const totalValue = data.reduce((acc, stage) => acc + stage.value, 0)

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center space-x-2">
              <Funnel className="h-5 w-5 text-blue-600" />
              <span>Pipeline de Vendas</span>
            </CardTitle>
            <CardDescription>
              Análise detalhada do funil de conversão
            </CardDescription>
          </div>
          <Badge variant="secondary" className="ai-processing">
            <Sparkle className="h-3 w-3 mr-1" />
            IA
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">
              {formatCurrency(totalValue)}
            </div>
            <div className="text-sm text-muted-foreground">Valor Total</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {data.reduce((acc, stage) => acc + stage.count, 0)}
            </div>
            <div className="text-sm text-muted-foreground">Oportunidades</div>
          </div>
        </div>

        {data.map((stage, index) => (
          <div key={stage.stage} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{stage.stage}</span>
              <div className="flex items-center space-x-2">
                <span className="text-muted-foreground">
                  {stage.count} ops
                </span>
                <span className="font-semibold">
                  {formatCurrency(stage.value)}
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Progress
                value={stage.conversionRate}
                className="flex-1 h-2"
              />
              <span className="text-xs text-muted-foreground w-10">
                {stage.conversionRate.toFixed(1)}%
              </span>
            </div>
          </div>
        ))}

        <div className="pt-4 border-t">
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <Sparkle className="h-4 w-4 ai-processing" />
            <span>
              IA identificou 3 oportunidades com alta probabilidade de fechamento nos próximos 7 dias
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface RevenueChartProps {
  data: {
    period: string
    revenue: number
    forecast: number
  }[]
}

export function RevenueChart({ data }: RevenueChartProps) {
  const currentRevenue = data[data.length - 1]?.revenue || 0
  const forecastRevenue = data[data.length - 1]?.forecast || 0
  const growth = currentRevenue > 0 ? ((forecastRevenue - currentRevenue) / currentRevenue * 100) : 0

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center space-x-2">
              <ChartLineUp className="h-5 w-5 text-green-600" />
              <span>Receita & Forecast</span>
            </CardTitle>
            <CardDescription>
              Previsão inteligente baseada em dados históricos
            </CardDescription>
          </div>
          <Badge variant="secondary" className="ai-processing">
            <Sparkle className="h-3 w-3 mr-1" />
            IA
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(currentRevenue)}
            </div>
            <div className="text-sm text-muted-foreground">Receita Atual</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {formatCurrency(forecastRevenue)}
            </div>
            <div className="text-sm text-muted-foreground">Previsão IA</div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Crescimento Previsto</span>
            <div className="flex items-center space-x-1">
              {growth > 0 ? (
                <TrendUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendDown className="h-4 w-4 text-red-600" />
              )}
              <span className={growth > 0 ? 'text-green-600' : 'text-red-600'}>
                {Math.abs(growth).toFixed(1)}%
              </span>
            </div>
          </div>
          <Progress value={Math.min(Math.abs(growth), 100)} className="h-2" />
        </div>

        <div className="pt-4 border-t space-y-2">
          <h4 className="font-medium text-sm">Insights de IA:</h4>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>• Tendência de crescimento sustentável identificada</li>
            <li>• Oportunidades de upselling estimadas em R$ 250K</li>
            <li>• Melhor performance esperada em Q2 2024</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
