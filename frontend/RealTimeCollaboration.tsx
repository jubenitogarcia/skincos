import { useState, useEffect, useRef } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/avatar"
import { ScrollArea } from "@/scroll-area"
import { Separator } from "@/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/tooltip"
import {
  Users,
  Circle,
  Eye,
  PencilSimple,
  ChatCircle,
  Cursor,
  Share,
  Crown,
  Clock,
  Pulse,
  WifiHigh,
  WifiSlash,
  Lightning,
  Warning
} from "@phosphor-icons/react"

export interface ActiveUser {
  id: string
  name: string
  avatar?: string
  email: string
  cursor?: {
    x: number
    y: number
    elementId?: string
  }
  activity: {
    action: 'viewing' | 'editing' | 'commenting' | 'idle'
    target?: string
    startedAt: string
  }
  connection: {
    status: 'online' | 'away' | 'offline'
    lastSeen: string
    latency?: number
  }
  permissions: {
    canEdit: boolean
    canComment: boolean
    canShare: boolean
  }
}

export interface PulseEvent {
  id: string
  userId: string
  userName: string
  action: string
  target: string
  description: string
  timestamp: string
  metadata?: Record<string, any>
}

export interface RealTimeUpdate {
  id: string
  type: 'cursor' | 'edit' | 'comment' | 'join' | 'leave' | 'presence'
  userId: string
  data: any
  timestamp: string
}

interface RealTimeCollaborationProps {
  recordId: string
  recordType: string
  currentUserId?: string
}

export function RealTimeCollaboration({
  recordId,
  recordType,
  currentUserId = 'current-user'
}: RealTimeCollaborationProps) {
  const [activeUsers, setActiveUsers] = useKV<ActiveUser[]>(`active-users-${recordId}`, [])
  const [activities, setActivities] = useKV<PulseEvent[]>(`activities-${recordId}`, [])
  const [isConnected, setIsConnected] = useState(true)
  const [showCursors, setShowCursors] = useState(true)
  const [connectionLatency, setConnectionLatency] = useState(0)
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null)

  const lastPulseRef = useRef<string>(Date.now().toString())
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cursorUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialize current user
  useEffect(() => {
    const currentUser: ActiveUser = {
      id: currentUserId,
      name: 'Você',
      email: 'user@example.com',
      activity: {
        action: 'viewing',
        target: recordType,
        startedAt: new Date().toISOString()
      },
      connection: {
        status: 'online',
        lastSeen: new Date().toISOString(),
        latency: 0
      },
      permissions: {
        canEdit: true,
        canComment: true,
        canShare: true
      }
    }

    // Add current user to active users if not present
    setActiveUsers(prev => {
      const existing = prev.find(u => u.id === currentUserId)
      if (!existing) {
        return [...prev, currentUser]
      }
      return prev.map(u => u.id === currentUserId ? { ...u, ...currentUser } : u)
    })

    // Add join activity
    addPulse('join', recordType, `Entrou na visualização do ${recordType}`)

    // Cleanup on unmount
    return () => {
      setActiveUsers(prev => prev.filter(u => u.id !== currentUserId))
      addPulse('leave', recordType, `Saiu da visualização do ${recordType}`)
    }
  }, [currentUserId, recordType, recordId])

  // Simulate network connection and latency
  useEffect(() => {
    const updateLatency = () => {
      // Simulate network latency between 10-150ms
      const latency = Math.floor(Math.random() * 140) + 10
      setConnectionLatency(latency)

      // Simulate occasional connection issues
      if (Math.random() < 0.02) { // 2% chance
        setIsConnected(false)
        setTimeout(() => setIsConnected(true), 2000 + Math.random() * 3000)
      }
    }

    const interval = setInterval(updateLatency, 5000)
    return () => clearInterval(interval)
  }, [])

  // Mouse tracking for cursor collaboration
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const newPosition = { x: e.clientX, y: e.clientY }
      setCursorPosition(newPosition)

      // Throttle cursor updates
      if (cursorUpdateRef.current) clearTimeout(cursorUpdateRef.current)
      cursorUpdateRef.current = setTimeout(() => {
        updateUserCursor(newPosition)
      }, 100)
    }

    if (showCursors) {
      document.addEventListener('mousemove', handleMouseMove)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        if (cursorUpdateRef.current) clearTimeout(cursorUpdateRef.current)
      }
    }
  }, [showCursors])

  // Heartbeat to maintain presence
  useEffect(() => {
    const heartbeat = () => {
      setActiveUsers(prev => prev.map(user =>
        user.id === currentUserId
          ? {
            ...user,
            connection: {
              ...user.connection,
              lastSeen: new Date().toISOString(),
              latency: connectionLatency
            }
          }
          : user
      ))
    }

    heartbeatRef.current = setInterval(heartbeat, 30000) // 30 seconds
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [currentUserId, connectionLatency])

  const addPulse = (action: string, target: string, description: string) => {
    const activity: PulseEvent = {
      id: Date.now().toString(),
      userId: currentUserId,
      userName: 'Você',
      action,
      target,
      description,
      timestamp: new Date().toISOString()
    }

    setActivities(prev => [activity, ...prev.slice(0, 49)]) // Keep last 50 activities
  }

  const updateUserPulse = (action: ActiveUser['activity']['action'], target?: string) => {
    setActiveUsers(prev => prev.map(user =>
      user.id === currentUserId
        ? {
          ...user,
          activity: {
            action,
            target: target || user.activity.target,
            startedAt: new Date().toISOString()
          }
        }
        : user
    ))

    lastPulseRef.current = Date.now().toString()
  }

  const updateUserCursor = (position: { x: number; y: number }) => {
    setActiveUsers(prev => prev.map(user =>
      user.id === currentUserId
        ? { ...user, cursor: position }
        : user
    ))
  }

  const getStatusColor = (status: ActiveUser['connection']['status']) => {
    switch (status) {
      case 'online': return 'bg-green-500'
      case 'away': return 'bg-yellow-500'
      case 'offline': return 'bg-gray-400'
      default: return 'bg-gray-400'
    }
  }

  const getPulseIcon = (action: string) => {
    switch (action) {
      case 'viewing': return <Eye className="h-3 w-3" />
      case 'editing': return <PencilSimple className="h-3 w-3" />
      case 'commenting': return <ChatCircle className="h-3 w-3" />
      case 'join': return <Users className="h-3 w-3 text-green-600" />
      case 'leave': return <Users className="h-3 w-3 text-red-600" />
      default: return <Pulse className="h-3 w-3" />
    }
  }

  const getTimeSince = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) return `${hours}h atrás`
    if (minutes > 0) return `${minutes}m atrás`
    return 'agora'
  }

  // Mock some other users for demo
  useEffect(() => {
    if (activeUsers.length === 1) {
      const mockUsers: ActiveUser[] = [
        {
          id: 'user-2',
          name: 'João Silva',
          email: 'joao@example.com',
          activity: {
            action: 'editing',
            target: 'contact_email',
            startedAt: new Date(Date.now() - 120000).toISOString()
          },
          connection: {
            status: 'online',
            lastSeen: new Date().toISOString(),
            latency: 45
          },
          permissions: {
            canEdit: true,
            canComment: true,
            canShare: false
          },
          cursor: { x: 300, y: 200 }
        },
        {
          id: 'user-3',
          name: 'Maria Santos',
          email: 'maria@example.com',
          activity: {
            action: 'commenting',
            target: 'notes_section',
            startedAt: new Date(Date.now() - 300000).toISOString()
          },
          connection: {
            status: 'away',
            lastSeen: new Date(Date.now() - 180000).toISOString(),
            latency: 120
          },
          permissions: {
            canEdit: false,
            canComment: true,
            canShare: true
          }
        }
      ]

      // Randomly add mock users
      if (Math.random() > 0.3) {
        setActiveUsers(prev => [...prev, ...mockUsers.slice(0, Math.floor(Math.random() * 2) + 1)])
      }
    }
  }, [activeUsers.length, setActiveUsers])

  return (
    <div className="space-y-4">
      {/* Connection Status Bar */}
      <Card className={`transition-all ${!isConnected ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {isConnected ? (
                <>
                  <WifiHigh className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-800">Conectado</span>
                  <Badge variant="outline" className="text-xs">
                    <Lightning className="h-3 w-3 mr-1" />
                    {connectionLatency}ms
                  </Badge>
                </>
              ) : (
                <>
                  <WifiSlash className="h-4 w-4 text-red-600" />
                  <span className="text-sm font-medium text-red-800">Reconectando...</span>
                  <Warning className="h-4 w-4 text-red-600" />
                </>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCursors(!showCursors)}
                className="h-6 px-2"
              >
                <Cursor className="h-3 w-3 mr-1" />
                <span className="text-xs">{showCursors ? 'Ocultar' : 'Mostrar'} cursores</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addPulse('share', recordType, 'Compartilhou o registro')}
                className="h-6 px-2"
              >
                <Share className="h-3 w-3 mr-1" />
                <span className="text-xs">Compartilhar</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active Users */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Users className="h-4 w-4" />
                <span>Colaboradores</span>
              </div>
              <Badge variant="secondary" className="text-xs">
                {activeUsers.filter(u => u.connection.status === 'online').length} online
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeUsers.map((user) => (
              <div key={user.id} className="flex items-center space-x-3">
                <div className="relative">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.avatar} />
                    <AvatarFallback className="text-xs">
                      {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${getStatusColor(user.connection.status)}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium truncate">{user.name}</span>
                    {user.id === currentUserId && (
                      <Crown className="h-3 w-3 text-yellow-600" />
                    )}
                  </div>

                  <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                    {getPulseIcon(user.activity.action)}
                    <span className="truncate">
                      {user.activity.action === 'viewing' && 'Visualizando'}
                      {user.activity.action === 'editing' && `Editando ${user.activity.target}`}
                      {user.activity.action === 'commenting' && 'Comentando'}
                      {user.activity.action === 'idle' && 'Inativo'}
                    </span>
                    <span>•</span>
                    <span>{getTimeSince(user.activity.startedAt)}</span>
                  </div>
                </div>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <div className="flex items-center space-x-1">
                        {user.connection.latency && (
                          <Badge variant="outline" className="text-xs px-1">
                            {user.connection.latency}ms
                          </Badge>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        <div>Status: {user.connection.status}</div>
                        <div>Último acesso: {getTimeSince(user.connection.lastSeen)}</div>
                        {user.connection.latency && (
                          <div>Latência: {user.connection.latency}ms</div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            ))}

            {activeUsers.length === 0 && (
              <div className="text-center py-6">
                <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Nenhum colaborador ativo</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Real-time Pulse Feed */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center space-x-2">
              <Pulse className="h-4 w-4" />
              <span>Atividade em Tempo Real</span>
            </CardTitle>
            <CardDescription>
              Acompanhe as ações dos colaboradores em tempo real
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-3">
                {activities.length > 0 ? (
                  activities.map((activity, index) => (
                    <div key={activity.id}>
                      <div className="flex items-start space-x-3">
                        <div className="flex-shrink-0 mt-1">
                          {getPulseIcon(activity.action)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium">{activity.userName}</span>
                            <Badge variant="outline" className="text-xs">
                              {activity.action}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{activity.description}</p>
                          <div className="flex items-center space-x-2 mt-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                              {getTimeSince(activity.timestamp)}
                            </span>
                          </div>
                        </div>
                      </div>
                      {index < activities.length - 1 && <Separator className="mt-3" />}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <Pulse className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Nenhuma atividade recente</p>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Quick Actions */}
            <Separator className="my-4" />
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  updateUserPulse('editing', 'contact_details')
                  addPulse('edit', 'contact_details', 'Começou a editar os detalhes do contato')
                }}
              >
                <PencilSimple className="h-3 w-3 mr-1" />
                Simular Edição
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  updateUserPulse('commenting', 'general')
                  addPulse('comment', 'general', 'Adicionou um comentário')
                }}
              >
                <ChatCircle className="h-3 w-3 mr-1" />
                Simular Comentário
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  addPulse('view', recordType, `Atualizou a visualização do ${recordType}`)
                }}
              >
                <Eye className="h-3 w-3 mr-1" />
                Simular Visualização
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Collaborative Cursors Overlay */}
      {showCursors && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {activeUsers
            .filter(user => user.id !== currentUserId && user.cursor && user.connection.status === 'online')
            .map((user) => (
              <div
                key={user.id}
                className="absolute transition-all duration-100 ease-out pointer-events-none"
                style={{
                  left: user.cursor!.x,
                  top: user.cursor!.y,
                  transform: 'translate(-2px, -2px)'
                }}
              >
                <div className="relative">
                  <Cursor className="h-4 w-4 text-primary fill-current" />
                  <div className="absolute top-4 left-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap">
                    {user.name}
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
