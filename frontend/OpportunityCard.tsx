import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { Button } from "@/button"
import { Progress } from "@/progress"
import { formatCurrency, getRelativeTime, getStatusColor } from "@/utils"
import { CalendarBlank, TrendUp, User, Sparkle } from "@phosphor-icons/react"
import type { Opportunity } from "@/types"

interface OpportunityCardProps {
  opportunity: Opportunity
  onClick?: () => void
}

export function OpportunityCard({ opportunity, onClick }: OpportunityCardProps) {
  const stageLabels = {
    qualification: 'Qualificação',
    proposal: 'Proposta',
    negotiation: 'Negociação',
    'closed-won': 'Fechado - Ganho',
    'closed-lost': 'Fechado - Perdido'
  }

  return (
    <Card className="glass-card hover:shadow-lg transition-all duration-300 cursor-pointer" onClick={onClick}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{opportunity.title}</CardTitle>
            <CardDescription className="mt-1">
              {formatCurrency(opportunity.value)}
            </CardDescription>
          </div>
          <Badge className={getStatusColor(opportunity.stage)} variant="secondary">
            {stageLabels[opportunity.stage]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Probabilidade</span>
            <span className="font-medium">{opportunity.probability}%</span>
          </div>
          <Progress value={opportunity.probability} className="h-2" />
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Score IA</span>
            <div className="flex items-center space-x-1">
              <Sparkle className="h-3 w-3 text-accent ai-processing" />
              <span className="font-medium">{opportunity.aiScore}/100</span>
            </div>
          </div>
          <div className={`h-1.5 rounded-full bg-gray-200`}>
            <div 
              className={`h-1.5 rounded-full transition-all duration-500 ${
                opportunity.aiScore >= 80 ? 'bg-green-500' : 
                opportunity.aiScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${opportunity.aiScore}%` }}
            />
          </div>
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center">
            <CalendarBlank className="h-4 w-4 mr-1" />
            Fechamento Esperado
          </span>
          <span>{getRelativeTime(opportunity.expectedCloseDate)}</span>
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center">
            <User className="h-4 w-4 mr-1" />
            Responsável
          </span>
          <span className="font-medium">{opportunity.assignedTo}</span>
        </div>
        
        {opportunity.aiInsights.length > 0 && (
          <div className="p-3 bg-accent/5 rounded-lg border border-accent/20">
            <div className="flex items-center space-x-2 mb-2">
              <Sparkle className="h-4 w-4 text-accent ai-processing" />
              <span className="text-sm font-medium text-accent">Insights IA</span>
            </div>
            <div className="space-y-1">
              {opportunity.aiInsights.slice(0, 2).map((insight, index) => (
                <div key={index} className="text-xs text-muted-foreground">
                  • {insight}
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="flex space-x-2 pt-2">
          <Button size="sm" variant="outline" className="flex-1">
            <TrendUp className="h-4 w-4 mr-1" />
            Atualizar
          </Button>
          <Button size="sm" className="flex-1">
            Ver Detalhes
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}