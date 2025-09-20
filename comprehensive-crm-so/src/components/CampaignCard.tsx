import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatNumber, getRelativeTime } from "@/lib/utils"
import { 
  Play, 
  Pause, 
  Stop, 
  Eye, 
  Cursor, 
  TrendUp,
  Envelope,
  ChatCircle,
  WhatsappLogo,
  ShareNetwork,
  Sparkle
} from "@phosphor-icons/react"
import type { Campaign } from "@/lib/types"

interface CampaignCardProps {
  campaign: Campaign
  onAction?: (action: 'start' | 'pause' | 'stop' | 'edit') => void
}

export function CampaignCard({ campaign, onAction }: CampaignCardProps) {
  const getTypeIcon = (type: Campaign['type']) => {
    switch (type) {
      case 'email': return <Envelope className="h-4 w-4" />
      case 'sms': return <ChatCircle className="h-4 w-4" />
      case 'whatsapp': return <WhatsappLogo className="h-4 w-4" />
      case 'social': return <ShareNetwork className="h-4 w-4" />
      default: return <Envelope className="h-4 w-4" />
    }
  }

  const getStatusColor = (status: Campaign['status']) => {
    switch (status) {
      case 'active': return 'bg-green-500'
      case 'paused': return 'bg-yellow-500'
      case 'completed': return 'bg-blue-500'
      case 'draft': return 'bg-gray-500'
      default: return 'bg-gray-500'
    }
  }

  const conversionRate = campaign.metrics.sent > 0 
    ? (campaign.metrics.converted / campaign.metrics.sent * 100).toFixed(1)
    : '0.0'

  const openRate = campaign.metrics.sent > 0
    ? (campaign.metrics.opened / campaign.metrics.sent * 100).toFixed(1)
    : '0.0'

  const clickRate = campaign.metrics.opened > 0
    ? (campaign.metrics.clicked / campaign.metrics.opened * 100).toFixed(1)
    : '0.0'

  return (
    <Card className="glass-card hover:shadow-lg transition-all duration-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg bg-primary/10 text-primary`}>
              {getTypeIcon(campaign.type)}
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg truncate">{campaign.name}</CardTitle>
              <CardDescription className="truncate">{campaign.targetSegment}</CardDescription>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {campaign.aiOptimized && (
              <Badge variant="secondary" className="ai-processing">
                <Sparkle className="h-3 w-3 mr-1" />
                IA
              </Badge>
            )}
            <Badge variant="outline" className={getStatusColor(campaign.status)}>
              {campaign.status}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">
              {formatNumber(campaign.metrics.sent)}
            </div>
            <div className="text-xs text-muted-foreground">Enviados</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {campaign.metrics.converted}
            </div>
            <div className="text-xs text-muted-foreground">Convertidos</div>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span>Taxa de Abertura</span>
            </div>
            <span className="font-semibold">{openRate}%</span>
          </div>
          <Progress value={parseFloat(openRate)} className="h-2" />

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-2">
              <Cursor className="h-4 w-4 text-muted-foreground" />
              <span>Taxa de Clique</span>
            </div>
            <span className="font-semibold">{clickRate}%</span>
          </div>
          <Progress value={parseFloat(clickRate)} className="h-2" />

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-2">
              <TrendUp className="h-4 w-4 text-muted-foreground" />
              <span>Taxa de Conversão</span>
            </div>
            <span className="font-semibold text-green-600">{conversionRate}%</span>
          </div>
          <Progress value={parseFloat(conversionRate)} className="h-2" />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2 pt-2">
          {campaign.status === 'draft' && (
            <Button 
              size="sm" 
              onClick={() => onAction?.('start')}
              className="flex-1"
            >
              <Play className="h-4 w-4 mr-1" />
              Iniciar
            </Button>
          )}
          
          {campaign.status === 'active' && (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => onAction?.('pause')}
              className="flex-1"
            >
              <Pause className="h-4 w-4 mr-1" />
              Pausar
            </Button>
          )}

          {campaign.status === 'paused' && (
            <Button 
              size="sm" 
              onClick={() => onAction?.('start')}
              className="flex-1"
            >
              <Play className="h-4 w-4 mr-1" />
              Retomar
            </Button>
          )}

          <Button 
            size="sm" 
            variant="outline"
            onClick={() => onAction?.('edit')}
            className="flex-1"
          >
            Editar
          </Button>

          {(campaign.status === 'active' || campaign.status === 'paused') && (
            <Button 
              size="sm" 
              variant="destructive"
              onClick={() => onAction?.('stop')}
            >
              <Stop className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Period Info */}
        {campaign.endDate && (
          <div className="text-xs text-muted-foreground pt-2 border-t">
            Período: {getRelativeTime(campaign.startDate)} - {getRelativeTime(campaign.endDate)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}