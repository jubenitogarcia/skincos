import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useNotifications, useNotificationsByType } from '@/contexts/NotificationContext'
import {
  BellRinging,
  X,
  CheckCircle,
  Trash,
  MagnifyingGlass,
  Robot,
  ChatCircle,
  Target,
  CalendarCheck,
  Warning,
  Sparkle,
  WifiSlash,
  WifiHigh,
  Circle
} from "@phosphor-icons/react"
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function NotificationCenter() {
  const {
    notifications,
    unreadCount,
    isConnected,
    connectionStatus,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll
  } = useNotifications()

  // Browser permission (best effort)
  const [permissionGranted, setPermissionGranted] = useState(
    typeof Notification !== 'undefined' ? Notification.permission === 'granted' : false
  )
  const requestPermission = async () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const res = await Notification.requestPermission()
      setPermissionGranted(res === 'granted')
    }
  }

  const [searchQuery, setMagnifyingGlassQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState<string>('all')

  // Precompute typed notification lists at top-level to satisfy hooks rules
  const chatNotifications = useNotificationsByType('chat')

  // Funnel notifications based on search and tab
  const filteredNotifications = notifications.filter(notification => {
    const matchesMagnifyingGlass = notification.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      notification.message.toLowerCase().includes(searchQuery.toLowerCase())

    if (selectedTab === 'unread') {
      return matchesMagnifyingGlass && !notification.read
    }

    if (selectedTab !== 'all') {
      return matchesMagnifyingGlass && notification.type === selectedTab
    }

    return matchesMagnifyingGlass
  })

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'chat': return ChatCircle
      case 'opportunity': return Target
      case 'task': return CalendarCheck
      case 'alert': return Warning
      case 'ai_insight': return Robot
      case 'system': return Sparkle
      default: return BellRinging
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200'
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'medium': return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'low': return 'text-green-600 bg-green-50 border-green-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'critical': return 'Crítica'
      case 'high': return 'Alta'
      case 'medium': return 'Média'
      case 'low': return 'Baixa'
      default: return priority
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Central de Notificações</h2>
          <p className="text-muted-foreground">
            Gerencie todas as notificações em tempo real
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Connection Status */}
          <div className="flex items-center space-x-2 px-3 py-1 rounded-lg bg-muted">
            {isConnected ? (
              <>
                <WifiHigh className="h-4 w-4 text-green-600" />
                <span className="text-sm text-green-600">Online</span>
              </>
            ) : (
              <>
                <WifiSlash className="h-4 w-4 text-red-600" />
                <span className="text-sm text-red-600">Offline</span>
              </>
            )}
          </div>

          {/* Permission Status */}
          {!permissionGranted && (
            <Button
              onClick={requestPermission}
              variant="outline"
              size="sm"
              className="text-orange-600 border-orange-200"
            >
              <BellRinging className="h-4 w-4 mr-2" />
              Ativar Notificações
            </Button>
          )}
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <BellRinging className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Total</p>
                <p className="text-2xl font-bold">{notifications.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Circle className="h-5 w-5 text-destructive fill-current" />
              <div>
                <p className="text-sm font-medium">Não Lidas</p>
                <p className="text-2xl font-bold text-destructive">{unreadCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Warning className="h-5 w-5 text-orange-600" />
              <div>
                <p className="text-sm font-medium">Alta Prioridade</p>
                <p className="text-2xl font-bold text-orange-600">
                  {notifications.filter(n => n.priority === 'high').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              {isConnected ? (
                <WifiHigh className="h-5 w-5 text-green-600" />
              ) : (
                <WifiSlash className="h-5 w-5 text-red-600" />
              )}
              <div>
                <p className="text-sm font-medium">Status</p>
                <p className="text-sm font-semibold capitalize">
                  {connectionStatus === 'connected' ? 'Conectado' :
                    connectionStatus === 'connecting' ? 'Conectando' :
                      'Desconectado'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Notificações Recentes</CardTitle>
              <CardDescription>
                Visualize e gerencie todas as notificações do sistema
              </CardDescription>
            </div>

            <div className="flex items-center space-x-2">
              {unreadCount > 0 && (
                <Button
                  onClick={markAllAsRead}
                  variant="outline"
                  size="sm"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Marcar Todas Lidas
                </Button>
              )}

              <Button
                onClick={clearAll}
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
              >
                <Trash className="h-4 w-4 mr-2" />
                Limpar Todas
              </Button>
            </div>
          </div>

          {/* MagnifyingGlass */}
          <div className="relative">
            <MagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar notificações..."
              value={searchQuery}
              onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardHeader>

        <CardContent>
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="all">
                Todas
                {notifications.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {notifications.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="unread">
                Não Lidas
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {unreadCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="chat">
                Chat
                {chatNotifications.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {chatNotifications.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="opportunity">
                Vendas
              </TabsTrigger>
              <TabsTrigger value="ai_insight">
                IA
              </TabsTrigger>
              <TabsTrigger value="system">
                Sistema
              </TabsTrigger>
            </TabsList>

            <div className="mt-6">
              <ScrollArea className="h-[600px]">
                {filteredNotifications.length > 0 ? (
                  <div className="space-y-3">
                    {filteredNotifications.map((notification) => {
                      const IconComponent = getNotificationIcon(notification.type)
                      const isUnread = !notification.read

                      return (
                        <div
                          key={notification.id}
                          className={`p-4 rounded-lg border transition-all duration-200 hover:shadow-md ${isUnread
                            ? 'bg-accent/5 border-accent/20 shadow-sm'
                            : 'bg-muted/30 border-border'
                            }`}
                        >
                          <div className="flex items-start justify-between space-x-3">
                            <div className="flex items-start space-x-3 flex-1">
                              <div className={`p-2 rounded-lg ${isUnread ? 'bg-accent/10' : 'bg-muted'
                                }`}>
                                <IconComponent className={`h-4 w-4 ${isUnread ? 'text-accent' : 'text-muted-foreground'
                                  }`} />
                              </div>

                              <div className="flex-1 space-y-2">
                                <div className="flex items-center space-x-2">
                                  <h4 className={`font-medium ${isUnread ? 'text-foreground' : 'text-muted-foreground'
                                    }`}>
                                    {notification.title}
                                  </h4>

                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${getPriorityColor(notification.priority)}`}
                                  >
                                    {getPriorityLabel(notification.priority)}
                                  </Badge>

                                  {isUnread && (
                                    <div className="w-2 h-2 bg-accent rounded-full"></div>
                                  )}
                                </div>

                                <p className="text-sm text-muted-foreground">
                                  {notification.message}
                                </p>

                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(new Date(notification.timestamp), {
                                      addSuffix: true,
                                      locale: ptBR
                                    })}
                                  </span>

                                  {notification.category && (
                                    <Badge variant="secondary" className="text-xs">
                                      {notification.category}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1">
                              {isUnread && (
                                <Button
                                  onClick={() => markAsRead(notification.id)}
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                              )}

                              <Button
                                onClick={() => removeNotification(notification.id)}
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {/* requiresAction is not in Notification; show action buttons only when actions exist */}
                          {notification.actions && notification.actions.length > 0 && (
                            <div className="mt-3 pt-3 border-t">
                              <Button
                                size="sm"
                                onClick={() => {
                                  // Use actions array if present; no direct navigation url in type
                                  markAsRead(notification.id)
                                }}
                              >
                                Ver Detalhes
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <BellRinging className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">
                      {searchQuery ? 'Nenhuma notificação encontrada' : 'Nenhuma notificação'}
                    </h3>
                    <p className="text-muted-foreground">
                      {searchQuery
                        ? 'Tente ajustar os filtros ou termo de busca'
                        : 'Você está em dia! Novas notificações aparecerão aqui.'
                      }
                    </p>
                  </div>
                )}
              </ScrollArea>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
