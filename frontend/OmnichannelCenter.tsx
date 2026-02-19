import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { Button } from "@/button"
import { Avatar, AvatarFallback } from "@/avatar"
import { getRelativeTime, getInitials } from "@/utils"
import {
  Phone,
  Envelope,
  WhatsappLogo,
  ChatCircle,
  VideoCamera,
  CalendarBlank,
  User,
  Clock,
  CheckCircle,
  Warning,
  Sparkle
} from "@phosphor-icons/react"
import type { Activity } from "@/types"

interface OmnichannelCenterProps {
  activities: Activity[]
  onStartConversation?: (channel: string, customerId: string) => void
}

export function OmnichannelCenter({ activities, onStartConversation }: OmnichannelCenterProps) {
  if (!activities || activities.length === 0) {
    return (
      <div className="space-y-6">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Sem atividades</CardTitle>
            <CardDescription>
              Nenhuma integração ou atividade registrada ainda. Conecte os canais para começar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              Quando houver interações, a central Omnichannel exibirá estatísticas e histórico aqui.
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const getChannelIcon = (type: Activity['type']) => {
    switch (type) {
      case 'call': return <Phone className="h-4 w-4" />
      case 'email': return <Envelope className="h-4 w-4" />
      case 'whatsapp': return <WhatsappLogo className="h-4 w-4" />
      case 'sms': return <ChatCircle className="h-4 w-4" />
      case 'meeting': return <VideoCamera className="h-4 w-4" />
      default: return <ChatCircle className="h-4 w-4" />
    }
  }

  const getChannelColor = (type: Activity['type']) => {
    switch (type) {
      case 'call': return 'text-blue-600 bg-blue-50'
      case 'email': return 'text-green-600 bg-green-50'
      case 'whatsapp': return 'text-green-700 bg-green-100'
      case 'sms': return 'text-purple-600 bg-purple-50'
      case 'meeting': return 'text-orange-600 bg-orange-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const getOutcomeIcon = (outcome?: string) => {
    if (!outcome) return null
    if (outcome.toLowerCase().includes('positivo') || outcome.toLowerCase().includes('sucesso')) {
      return <CheckCircle className="h-4 w-4 text-green-600" />
    }
    if (outcome.toLowerCase().includes('atenção') || outcome.toLowerCase().includes('problema')) {
      return <Warning className="h-4 w-4 text-yellow-600" />
    }
    return <Clock className="h-4 w-4 text-blue-600" />
  }

  const recentActivities = activities
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)

  const channelStats = {
    call: activities.filter(a => a.type === 'call').length,
    email: activities.filter(a => a.type === 'email').length,
    whatsapp: activities.filter(a => a.type === 'whatsapp').length,
    sms: activities.filter(a => a.type === 'sms').length,
    meeting: activities.filter(a => a.type === 'meeting').length
  }

  return (
    <div className="space-y-6">
      {/* Channel Statistics */}
      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Sparkle className="h-5 w-5 text-accent ai-processing" />
            <CardTitle>Central Omnichannel</CardTitle>
            <Badge variant="secondary">Tempo Real</Badge>
          </div>
          <CardDescription>
            Gestão unificada de todos os canais de comunicação
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-4">
            <div className="text-center">
              <div className="p-3 rounded-lg bg-blue-50 text-blue-600 mx-auto w-fit mb-2">
                <Phone className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.call}</div>
              <div className="text-xs text-muted-foreground">Chamadas</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-green-50 text-green-600 mx-auto w-fit mb-2">
                <Envelope className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.email}</div>
              <div className="text-xs text-muted-foreground">E-mails</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-green-100 text-green-700 mx-auto w-fit mb-2">
                <WhatsappLogo className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.whatsapp}</div>
              <div className="text-xs text-muted-foreground">WhatsApp</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-purple-50 text-purple-600 mx-auto w-fit mb-2">
                <ChatCircle className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.sms}</div>
              <div className="text-xs text-muted-foreground">SMS</div>
            </div>
            <div className="text-center">
              <div className="p-3 rounded-lg bg-orange-50 text-orange-600 mx-auto w-fit mb-2">
                <VideoCamera className="h-5 w-5" />
              </div>
              <div className="text-2xl font-bold">{channelStats.meeting}</div>
              <div className="text-xs text-muted-foreground">Reuniões</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Ações Rápidas</CardTitle>
          <CardDescription>
            Inicie conversas em qualquer canal com um clique
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('call', '')}
            >
              <Phone className="h-5 w-5 text-blue-600" />
              <span className="text-xs">Nova Chamada</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('email', '')}
            >
              <Envelope className="h-5 w-5 text-green-600" />
              <span className="text-xs">Novo E-mail</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('whatsapp', '')}
            >
              <WhatsappLogo className="h-5 w-5 text-green-700" />
              <span className="text-xs">WhatsApp</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('sms', '')}
            >
              <ChatCircle className="h-5 w-5 text-purple-600" />
              <span className="text-xs">SMS</span>
            </Button>
            <Button
              variant="outline"
              className="flex flex-col h-20 space-y-2"
              onClick={() => onStartConversation?.('meeting', '')}
            >
              <CalendarBlank className="h-5 w-5 text-orange-600" />
              <span className="text-xs">Agendar</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Interactions */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Interações Recentes</CardTitle>
          <CardDescription>
            Timeline unificado de todas as comunicações
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentActivities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className={`p-2 rounded-lg ${getChannelColor(activity.type)}`}>
                  {getChannelIcon(activity.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-medium text-sm truncate">{activity.title}</h4>
                    <div className="flex items-center space-x-2">
                      {getOutcomeIcon(activity.outcome)}
                      <span className="text-xs text-muted-foreground">
                        {getRelativeTime(activity.date)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                    {activity.description}
                  </p>
                  <div className="flex items-center space-x-4 text-xs">
                    <div className="flex items-center space-x-1">
                      <User className="h-3 w-3" />
                      <span>{activity.createdBy}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Badge variant="outline" className="text-xs px-2 py-0">
                        {activity.channel}
                      </Badge>
                    </div>
                    {activity.duration && (
                      <div className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>{activity.duration}min</span>
                      </div>
                    )}
                  </div>
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
            <Sparkle className="h-5 w-5 text-accent ai-processing" />
            <CardTitle>Insights de Comunicação</CardTitle>
            <Badge variant="secondary" className="ai-processing">IA</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center space-x-2 mb-1">
                <Phone className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-800 text-sm">Melhor Horário</span>
              </div>
              <p className="text-xs text-blue-700">
                Chamadas realizadas entre 14h-16h têm 40% mais taxa de atendimento
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center space-x-2 mb-1">
                <WhatsappLogo className="h-4 w-4 text-green-700" />
                <span className="font-medium text-green-800 text-sm">Canal Preferido</span>
              </div>
              <p className="text-xs text-green-700">
                67% dos clientes preferem WhatsApp para primeiros contatos
              </p>
            </div>
            <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
              <div className="flex items-center space-x-2 mb-1">
                <CalendarBlank className="h-4 w-4 text-orange-600" />
                <span className="font-medium text-orange-800 text-sm">Follow-up</span>
              </div>
              <p className="text-xs text-orange-700">
                5 clientes precisam de follow-up nos próximos 2 dias
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
