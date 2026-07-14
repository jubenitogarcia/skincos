import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Badge } from "@/badge"
import { Button } from "@/button"
import { formatDateTime, getStatusColor } from "@/utils"
import {
  Phone,
  Envelope,
  CalendarCheck,
  ChatCircle,
  WhatsappLogo,
  Chat,
  ArrowSquareOut
} from "@phosphor-icons/react"
import type { Activity } from "@/types"

interface ActivityCardProps {
  activity: Activity
  compact?: boolean
}

const activityIcons = {
  call: Phone,
  email: Envelope,
  meeting: CalendarCheck,
  note: ChatCircle,
  whatsapp: WhatsappLogo,
  sms: Chat
}

const activityLabels = {
  call: 'Ligação',
  email: 'E-mail',
  meeting: 'Reunião',
  note: 'Anotação',
  whatsapp: 'WhatsApp',
  sms: 'SMS'
}

export function ActivityCard({ activity, compact = false }: ActivityCardProps) {
  const Icon = activityIcons[activity.type]

  if (compact) {
    return (
      <div className="flex items-center space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
        <div className="flex-shrink-0">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium truncate">{activity.title}</p>
            <Badge variant="outline" className="text-xs">
              {activityLabels[activity.type]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {activity.description}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDateTime(activity.date)} • {activity.createdBy}
          </p>
        </div>
        <Button size="sm" variant="ghost">
          <ArrowSquareOut className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <Card className="glass-card hover:shadow-lg transition-all duration-300">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">{activity.title}</CardTitle>
              <CardDescription className="mt-1">
                {activityLabels[activity.type]} • {activity.channel}
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            {formatDateTime(activity.date)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {activity.description && (
          <p className="text-sm text-muted-foreground">
            {activity.description}
          </p>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Criado por</span>
          <span className="font-medium">{activity.createdBy}</span>
        </div>

        {activity.duration && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Duração</span>
            <span className="font-medium">{activity.duration} min</span>
          </div>
        )}

        {activity.outcome && (
          <div className="p-3 bg-green-50 rounded-lg border border-green-200">
            <div className="text-sm font-medium text-green-800 mb-1">Resultado</div>
            <div className="text-sm text-green-700">{activity.outcome}</div>
          </div>
        )}

        <div className="flex space-x-2 pt-2">
          <Button size="sm" variant="outline" className="flex-1">
            Editar
          </Button>
          <Button size="sm" variant="outline" className="flex-1">
            Responder
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
