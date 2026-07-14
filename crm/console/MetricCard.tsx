import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { formatCurrency, getRelativeTime, cn } from "@/utils"
import { TrendUp, TrendDown, Minus, Sparkle } from "@phosphor-icons/react"
import type { DashboardMetric } from "@/types"

interface MetricCardProps {
  metric: DashboardMetric
  className?: string
}

export function MetricCard({ metric, className }: MetricCardProps) {
  const TrendIcon = metric.trend === 'up' ? TrendUp : metric.trend === 'down' ? TrendDown : Minus
  const trendColor = metric.trend === 'up' ? 'text-green-600' : metric.trend === 'down' ? 'text-red-600' : 'text-gray-600'

  return (
    <Card className={cn("glass-card hover:shadow-lg transition-all duration-300", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {metric.title}
        </CardTitle>
        <div className={`h-4 w-4 ${metric.color}`}>
          <Sparkle className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold">{metric.value}</div>
            <div className={cn("flex items-center text-xs", trendColor)}>
              <TrendIcon className="mr-1 h-3 w-3" />
              {Math.abs(metric.change)}%
            </div>
          </div>
          <Badge variant="secondary" className="ai-processing">
            IA
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}