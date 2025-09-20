import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Plus,
  CalendarCheck,
  Clock,
  Users,
  PencilSimple,
  Trash,
  FloppyDisk as Save,
  Phone,
  Envelope,
  ChatCircle,
  Video,
  FileText,
  CheckCircle,
  Warning as AlertCircle,
  Calendar as CalendarIcon,
  Funnel,
  MagnifyingGlass,
  DotsThree,
  Bell,
  Tag,
  MapPin,
  Repeat,
  User,
  Building
} from "@phosphor-icons/react"
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface Pulse {
  id: string
  type: 'call' | 'email' | 'meeting' | 'task' | 'note' | 'sms' | 'video-call' | 'appointment'
  title: string
  description: string
  status: 'pending' | 'completed' | 'cancelled' | 'in-progress'
  priority: 'low' | 'medium' | 'high' | 'urgent'

  // Timing
  scheduledDate: string
  scheduledTime?: string
  duration?: number // in minutes
  completedAt?: string

  // Relationships
  contactId?: string
  leadId?: string
  dealId?: string
  companyId?: string
  assignedTo: string
  createdBy: string

  // Additional fields
  location?: string
  outcome?: string
  followUpRequired?: boolean
  followUpDate?: string
  tags: string[]
  customFields: Record<string, any>

  // Recurrence
  isRecurring: boolean
  recurrencePattern?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval: number
    endDate?: string
    daysOfWeek?: number[]
  }

  // Tracking
  reminders: PulseReminder[]
  attachments: string[]
  notes: PulseNote[]

  createdAt: string
  updatedAt: string
}

interface PulseReminder {
  id: string
  type: 'email' | 'push' | 'sms'
  minutesBefore: number
  sent: boolean
  sentAt?: string
}

interface PulseNote {
  id: string
  content: string
  createdBy: string
  createdAt: string
}

const defaultPulse: Omit<Pulse, 'id' | 'createdAt' | 'updatedAt'> = {
  type: 'call',
  title: '',
  description: '',
  status: 'pending',
  priority: 'medium',
  scheduledDate: new Date().toISOString().split('T')[0],
  assignedTo: 'current-user',
  createdBy: 'current-user',
  tags: [],
  customFields: {},
  isRecurring: false,
  reminders: [],
  attachments: [],
  notes: []
}

const activityTypes = [
  { value: 'call', label: 'Ligação', icon: Phone, color: 'bg-blue-100 text-blue-800' },
  { value: 'email', label: 'E-mail', icon: Envelope, color: 'bg-green-100 text-green-800' },
  { value: 'meeting', label: 'Reunião', icon: Users, color: 'bg-purple-100 text-purple-800' },
  { value: 'task', label: 'Tarefa', icon: CheckCircle, color: 'bg-orange-100 text-orange-800' },
  { value: 'note', label: 'Nota', icon: FileText, color: 'bg-gray-100 text-gray-800' },
  { value: 'sms', label: 'SMS', icon: ChatCircle, color: 'bg-yellow-100 text-yellow-800' },
  { value: 'video-call', label: 'Vídeo Chamada', icon: Video, color: 'bg-indigo-100 text-indigo-800' },
  { value: 'appointment', label: 'Compromisso', icon: CalendarIcon, color: 'bg-pink-100 text-pink-800' }
]

const statusOptions = [
  { value: 'pending', label: 'Pendente', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'in-progress', label: 'Em Andamento', color: 'bg-blue-100 text-blue-800' },
  { value: 'completed', label: 'Concluído', color: 'bg-green-100 text-green-800' },
  { value: 'cancelled', label: 'Cancelado', color: 'bg-red-100 text-red-800' }
]

const priorityOptions = [
  { value: 'low', label: 'Baixa', color: 'bg-gray-100 text-gray-600' },
  { value: 'medium', label: 'Média', color: 'bg-blue-100 text-blue-600' },
  { value: 'high', label: 'Alta', color: 'bg-orange-100 text-orange-600' },
  { value: 'urgent', label: 'Urgente', color: 'bg-red-100 text-red-600' }
]

export function AdvancedActivitiesManager() {
  const [activities, setActivities] = useKV<Pulse[]>('krayin-activities', [])
  const [selectedPulse, setSelectedPulse] = useState<Pulse | null>(null)
  const [editingPulse, setEditingPulse] = useState<Partial<Pulse> | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('list')

  // Funnels
  const [searchQuery, setMagnifyingGlassQuery] = useState('')
  const [typeFunnel, setTypeFunnel] = useState<string>('all')
  const [statusFunnel, setStatusFunnel] = useState<string>('all')
  const [priorityFunnel, setPriorityFunnel] = useState<string>('all')
  const [assigneeFunnel, setAssigneeFunnel] = useState<string>('all')
  const [dateFunnel, setDateFunnel] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'kanban'>('list')

  // Funnel activities
  const filteredActivities = activities.filter(activity => {
    const matchesMagnifyingGlass =
      activity.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      activity.description.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesType = typeFunnel === 'all' || activity.type === typeFunnel
    const matchesStatus = statusFunnel === 'all' || activity.status === statusFunnel
    const matchesPriority = priorityFunnel === 'all' || activity.priority === priorityFunnel
    const matchesAssignee = assigneeFunnel === 'all' || activity.assignedTo === assigneeFunnel

    let matchesDate = true
    if (dateFunnel === 'today') {
      const today = new Date().toISOString().split('T')[0]
      matchesDate = activity.scheduledDate === today
    } else if (dateFunnel === 'overdue') {
      const today = new Date().toISOString().split('T')[0]
      matchesDate = activity.scheduledDate < today && activity.status === 'pending'
    } else if (dateFunnel === 'this-week') {
      const today = new Date()
      const weekStart = new Date(today.setDate(today.getDate() - today.getDay()))
      const weekEnd = new Date(today.setDate(today.getDate() - today.getDay() + 6))
      const activityDate = new Date(activity.scheduledDate)
      matchesDate = activityDate >= weekStart && activityDate <= weekEnd
    }

    return matchesMagnifyingGlass && matchesType && matchesStatus && matchesPriority && matchesAssignee && matchesDate
  })

  // Calculate metrics
  const totalActivities = activities.length
  const pendingActivities = activities.filter(a => a.status === 'pending').length
  const completedToday = activities.filter(a =>
    a.status === 'completed' &&
    a.completedAt?.split('T')[0] === new Date().toISOString().split('T')[0]
  ).length
  const overdueActivities = activities.filter(a =>
    a.status === 'pending' &&
    a.scheduledDate < new Date().toISOString().split('T')[0]
  ).length

  const createPulse = (activityData: Omit<Pulse, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newPulse: Pulse = {
      ...activityData,
      id: `activity-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    setActivities(currentActivities => [...currentActivities, newPulse])
    toast.success('Atividade criada com sucesso!')
    setIsCreateDialogOpen(false)
  }

  const updatePulse = (activityId: string, updates: Partial<Pulse>) => {
    setActivities(currentActivities =>
      currentActivities.map(activity =>
        activity.id === activityId
          ? { ...activity, ...updates, updatedAt: new Date().toISOString() }
          : activity
      )
    )
    toast.success('Atividade atualizada com sucesso!')
    setIsEditDialogOpen(false)
    setEditingPulse(null)
  }

  const deletePulse = (activityId: string) => {
    setActivities(currentActivities => currentActivities.filter(activity => activity.id !== activityId))
    toast.success('Atividade removida com sucesso!')
  }

  const markAsCompleted = (activityId: string) => {
    updatePulse(activityId, {
      status: 'completed',
      completedAt: new Date().toISOString()
    })
  }

  const getTypeInfo = (type: string) => {
    return activityTypes.find(t => t.value === type) || activityTypes[0]
  }

  const getStatusInfo = (status: string) => {
    return statusOptions.find(s => s.value === status) || statusOptions[0]
  }

  const getPriorityInfo = (priority: string) => {
    return priorityOptions.find(p => p.value === priority) || priorityOptions[0]
  }

  const getUpcomingActivities = () => {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const currentTime = now.getHours() * 60 + now.getMinutes()

    return activities
      .filter(activity =>
        activity.status === 'pending' &&
        activity.scheduledDate >= todayStr
      )
      .sort((a, b) => {
        if (a.scheduledDate !== b.scheduledDate) {
          return a.scheduledDate.localeCompare(b.scheduledDate)
        }
        const aTime = a.scheduledTime ?
          parseInt(a.scheduledTime.split(':')[0]) * 60 + parseInt(a.scheduledTime.split(':')[1]) : 0
        const bTime = b.scheduledTime ?
          parseInt(b.scheduledTime.split(':')[0]) * 60 + parseInt(b.scheduledTime.split(':')[1]) : 0
        return aTime - bTime
      })
      .slice(0, 5)
  }

  const upcomingActivities = getUpcomingActivities()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Atividades Avançadas</h2>
          <p className="text-muted-foreground">
            Sistema completo de gestão de atividades estilo Krayin CRM
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Atividade
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CalendarCheck className="h-4 w-4 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Total</p>
                <p className="text-2xl font-bold">{totalActivities}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-yellow-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Pendentes</p>
                <p className="text-2xl font-bold">{pendingActivities}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Concluídas Hoje</p>
                <p className="text-2xl font-bold">{completedToday}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Atrasadas</p>
                <p className="text-2xl font-bold">{overdueActivities}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="list">Lista</TabsTrigger>
          <TabsTrigger value="calendar">Calendário</TabsTrigger>
          <TabsTrigger value="upcoming">Próximas</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Funnels */}
        <Card className="mt-4">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              <div className="relative">
                <MagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={searchQuery}
                  onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={typeFunnel} onValueChange={setTypeFunnel}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Tipos</SelectItem>
                  {activityTypes.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFunnel} onValueChange={setStatusFunnel}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Status</SelectItem>
                  {statusOptions.map(status => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={priorityFunnel} onValueChange={setPriorityFunnel}>
                <SelectTrigger>
                  <SelectValue placeholder="Prioridade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {priorityOptions.map(priority => (
                    <SelectItem key={priority.value} value={priority.value}>
                      {priority.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={dateFunnel} onValueChange={setDateFunnel}>
                <SelectTrigger>
                  <SelectValue placeholder="Data" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Datas</SelectItem>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="this-week">Esta Semana</SelectItem>
                  <SelectItem value="overdue">Atrasadas</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" size="sm">
                <Funnel className="h-4 w-4 mr-2" />
                Filtros
              </Button>

              <div className="flex items-center space-x-2">
                <Button
                  variant={viewMode === 'list' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                >
                  Lista
                </Button>
                <Button
                  variant={viewMode === 'calendar' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('calendar')}
                >
                  Calendário
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <TabsContent value="list" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredActivities.map((activity) => {
              const typeInfo = getTypeInfo(activity.type)
              const statusInfo = getStatusInfo(activity.status)
              const priorityInfo = getPriorityInfo(activity.priority)
              const TypeIcon = typeInfo.icon

              return (
                <Card key={activity.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg flex items-center space-x-2">
                          <TypeIcon className="h-5 w-5" />
                          <span>{activity.title}</span>
                        </CardTitle>
                        <CardDescription className="line-clamp-2">
                          {activity.description}
                        </CardDescription>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Badge variant="outline" className={priorityInfo.color}>
                          {priorityInfo.label}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 pt-2">
                      <Badge variant="outline" className={typeInfo.color}>
                        {typeInfo.label}
                      </Badge>
                      <Badge variant="outline" className={statusInfo.color}>
                        {statusInfo.label}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2 text-sm">
                        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {format(new Date(activity.scheduledDate), 'dd/MM/yyyy', { locale: ptBR })}
                          {activity.scheduledTime && ` às ${activity.scheduledTime}`}
                        </span>
                      </div>

                      {activity.duration && (
                        <div className="flex items-center space-x-2 text-sm">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span>{activity.duration} minutos</span>
                        </div>
                      )}

                      {activity.location && (
                        <div className="flex items-center space-x-2 text-sm">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate">{activity.location}</span>
                        </div>
                      )}

                      <div className="flex items-center space-x-2 text-sm">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span>Atribuído para: {activity.assignedTo}</span>
                      </div>
                    </div>

                    {activity.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {activity.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            <Tag className="h-3 w-3 mr-1" />
                            {tag}
                          </Badge>
                        ))}
                        {activity.tags.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{activity.tags.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}

                    <div className="flex items-center space-x-2">
                      {activity.status === 'pending' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => markAsCompleted(activity.id)}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Concluir
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingPulse(activity)
                          setIsEditDialogOpen(true)
                        }}
                      >
                        <PencilSimple className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                      >
                        <DotsThree className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {filteredActivities.length === 0 && (
            <Card className="text-center py-12">
              <CardContent>
                <CalendarCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Nenhuma atividade encontrada</h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery || typeFunnel !== 'all' || statusFunnel !== 'all'
                    ? "Tente ajustar os filtros ou criar uma nova atividade"
                    : "Comece criando sua primeira atividade"
                  }
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Atividade
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="upcoming" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Próximas Atividades</CardTitle>
              <CardDescription>
                Suas próximas 5 atividades agendadas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {upcomingActivities.length > 0 ? (
                upcomingActivities.map((activity) => {
                  const typeInfo = getTypeInfo(activity.type)
                  const TypeIcon = typeInfo.icon
                  const isToday = activity.scheduledDate === new Date().toISOString().split('T')[0]

                  return (
                    <div key={activity.id} className="flex items-center space-x-4 p-3 border rounded-lg">
                      <div className={`p-2 rounded-full ${typeInfo.color}`}>
                        <TypeIcon className="h-4 w-4" />
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="font-medium">{activity.title}</h4>
                          {isToday && (
                            <Badge variant="destructive" className="text-xs">Hoje</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(activity.scheduledDate), 'dd/MM/yyyy', { locale: ptBR })}
                          {activity.scheduledTime && ` às ${activity.scheduledTime}`}
                        </p>
                      </div>

                      <Button variant="outline" size="sm">
                        Ver Detalhes
                      </Button>
                    </div>
                  )
                })
              ) : (
                <div className="text-center py-8">
                  <CalendarCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">Nenhuma atividade agendada</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Atividades por Tipo</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {activityTypes.map((type) => {
                    const count = activities.filter(a => a.type === type.value).length
                    const percentage = totalActivities > 0 ? (count / totalActivities * 100) : 0

                    return (
                      <div key={type.value} className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <type.icon className="h-4 w-4" />
                          <span className="text-sm">{type.label}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-primary h-2 rounded-full"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium w-8">{count}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Status das Atividades</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {statusOptions.map((status) => {
                    const count = activities.filter(a => a.status === status.value).length
                    const percentage = totalActivities > 0 ? (count / totalActivities * 100) : 0

                    return (
                      <div key={status.value} className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className={`w-3 h-3 rounded-full ${status.color}`} />
                          <span className="text-sm">{status.label}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-primary h-2 rounded-full"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium w-8">{count}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create/Edit Pulse Dialogs would go here */}
    </div>
  )
}
