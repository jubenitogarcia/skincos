import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMetaSync } from '@/hooks/useMetaSync'
import { toast } from 'sonner'
import {
  InstagramLogo,
  FacebookLogo,
  WhatsappLogo,
  ChatCircle,
  Lightning,
  CheckCircle,
  Warning,
  X,
  Clock,
  Repeat,
  Eye,
  TrendUp,
  Users,
  Bell,
  Play,
  Pause,
  ArrowClockwise,
  Database,
  Globe,
  Pulse
} from "@phosphor-icons/react"

export function MetaSyncMonitor() {
  const {
    platforms,
    operations,
    syncHealth,
    isGlobalSync,
    startSync,
    startGlobalSync,
    connectPlatform,
    disconnectPlatform,
    retryFailedSync,
    clearErrors
  } = useMetaSync()

  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)

  const getPlatformIcon = (platformId: string) => {
    switch (platformId) {
      case 'facebook': return FacebookLogo
      case 'instagram': return InstagramLogo
      case 'whatsapp': return WhatsappLogo
      case 'threads': return ChatCircle
      default: return Globe
    }
  }

  const getPlatformColor = (platformId: string) => {
    switch (platformId) {
      case 'facebook': return 'text-blue-600'
      case 'instagram': return 'text-pink-600'
      case 'whatsapp': return 'text-green-600'
      case 'threads': return 'text-purple-600'
      default: return 'text-gray-600'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected': return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'syncing': return <ArrowClockwise className="h-4 w-4 text-blue-600 animate-spin" />
      case 'error': return <X className="h-4 w-4 text-red-600" />
      case 'disconnected': return <Warning className="h-4 w-4 text-gray-600" />
      default: return <Clock className="h-4 w-4 text-gray-600" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-green-100 text-green-800 border-green-200'
      case 'syncing': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'error': return 'bg-red-100 text-red-800 border-red-200'
      case 'disconnected': return 'bg-gray-100 text-gray-800 border-gray-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const formatTime = (input: Date | string | number) => {
    const date = input instanceof Date ? input : new Date(input)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)

    if (minutes < 60) return `${minutes}m atrás`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h atrás`
    return `${Math.floor(minutes / 1440)}d atrás`
  }

  const formatDuration = (start: Date | string | number, end?: Date | string | number) => {
    const s = start instanceof Date ? start : new Date(start)
    const e = (end instanceof Date ? end : (end ? new Date(end) : new Date())) as Date
    const diff = e.getTime() - s.getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)

    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Database className="h-6 w-6 text-blue-600" />
            <span>Meta Sync Monitor</span>
          </h2>
          <p className="text-muted-foreground">
            Monitoramento em tempo real das sincronizações Meta
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            onClick={startGlobalSync}
            disabled={isGlobalSync}
          >
            {isGlobalSync ? (
              <ArrowClockwise className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Repeat className="h-4 w-4 mr-2" />
            )}
            {isGlobalSync ? 'Sincronizando...' : 'Sync Global'}
          </Button>
        </div>
      </div>

      {/* Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <div className="text-2xl font-bold">{syncHealth.connected}/{syncHealth.total}</div>
                <div className="text-sm text-muted-foreground">Plataformas Conectadas</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Pulse className="h-5 w-5 text-blue-600" />
              <div>
                <div className="text-2xl font-bold">{syncHealth.activeOperations}</div>
                <div className="text-sm text-muted-foreground">Operações Ativas</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              <Clock className="h-5 w-5 text-purple-600" />
              <div>
                <div className="text-2xl font-bold">
                  {formatTime(new Date(syncHealth.lastGlobalSync))}
                </div>
                <div className="text-sm text-muted-foreground">Último Sync</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-2">
              {syncHealth.hasErrors ? (
                <Warning className="h-5 w-5 text-red-600" />
              ) : (
                <CheckCircle className="h-5 w-5 text-green-600" />
              )}
              <div>
                <div className="text-2xl font-bold">
                  {syncHealth.hasErrors ? 'Atenção' : 'Saudável'}
                </div>
                <div className="text-sm text-muted-foreground">Status Geral</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="platforms" className="space-y-6">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="platforms">Plataformas</TabsTrigger>
          <TabsTrigger value="operations">Operações</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="platforms" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {platforms.map((platform) => {
              const IconComponent = getPlatformIcon(platform.id)
              const colorClass = getPlatformColor(platform.id)
              const statusIcon = getStatusIcon(platform.status)
              const statusColor = getStatusColor(platform.status)
              const isSyncing = platform.status === 'syncing'

              return (
                <Card key={platform.id} className="glass-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <IconComponent className={`h-6 w-6 ${colorClass}`} />
                        <div>
                          <CardTitle className="text-base">{platform.name}</CardTitle>
                          <CardDescription>
                            Última sinc: {formatTime(platform.lastSync)}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {statusIcon}
                        <Badge className={statusColor}>
                          {platform.status === 'connected' ? 'Conectado' :
                            platform.status === 'syncing' ? 'Sincronizando' :
                              platform.status === 'error' ? 'Erro' : 'Desconectado'}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Sync Progress */}
                    {platform.status === 'syncing' && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Progresso</span>
                          <span>{Math.round(platform.syncProgress)}%</span>
                        </div>
                        <Progress value={platform.syncProgress} className="h-2" />
                      </div>
                    )}

                    {/* Features */}
                    <div>
                      <h4 className="text-sm font-medium mb-2">Recursos Habilitados</h4>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(platform.features).map(([feature, enabled]) => (
                          <Badge
                            key={feature}
                            variant={enabled ? "default" : "outline"}
                            className="text-xs"
                          >
                            {feature}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Rate Limits */}
                    <div>
                      <h4 className="text-sm font-medium mb-2">Rate Limits</h4>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Restantes</span>
                          <span>{platform.rateLimits.remaining}/{platform.rateLimits.requests}</span>
                        </div>
                        <Progress
                          value={(platform.rateLimits.remaining / platform.rateLimits.requests) * 100}
                          className="h-1"
                        />
                        <div className="text-xs text-muted-foreground">
                          Reset: {formatTime(platform.rateLimits.resetTime)}
                        </div>
                      </div>
                    </div>

                    {/* Errors */}
                    {platform.errors.length > 0 && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-medium text-red-800">Erros</h4>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => clearErrors(platform.id)}
                            className="h-6 text-xs"
                          >
                            Limpar
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {platform.errors.map((error, index) => (
                            <div key={index} className="text-xs text-red-700">
                              • {error}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex space-x-2">
                        {platform.status === 'connected' ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startSync(platform.id, 'incremental')}
                              disabled={isSyncing}
                            >
                              <ArrowClockwise className="h-3 w-3 mr-1" />
                              Sync
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => disconnectPlatform(platform.id)}
                            >
                              Desconectar
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => connectPlatform(platform.id)}
                            disabled={isSyncing}
                          >
                            Conectar
                          </Button>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPlatform(platform.id)}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Detalhes
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="operations" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Operações de Sincronização</CardTitle>
              <CardDescription>Histórico e status das sincronizações</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-4">
                  {operations.map((operation) => {
                    const IconComponent = getPlatformIcon(operation.platform)
                    const colorClass = getPlatformColor(operation.platform)

                    return (
                      <div key={operation.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-3">
                            <IconComponent className={`h-5 w-5 ${colorClass}`} />
                            <div>
                              <div className="font-medium">
                                {operation.platform} - {operation.type} sync
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {formatTime(operation.startTime)} •
                                Duração: {formatDuration(operation.startTime, operation.endTime)}
                              </div>
                            </div>
                          </div>
                          <Badge
                            variant={
                              operation.status === 'completed' ? 'default' :
                                operation.status === 'running' ? 'secondary' :
                                  operation.status === 'failed' ? 'destructive' : 'outline'
                            }
                          >
                            {operation.status === 'completed' ? 'Concluído' :
                              operation.status === 'running' ? 'Executando' :
                                operation.status === 'failed' ? 'Falhou' : 'Pendente'}
                          </Badge>
                        </div>

                        {/* Progress */}
                        <div className="space-y-2 mb-3">
                          <div className="flex justify-between text-sm">
                            <span>Progresso: {operation.itemsProcessed}/{operation.totalItems}</span>
                            <span>{Math.round(operation.progress)}%</span>
                          </div>
                          <Progress value={operation.progress} className="h-2" />
                        </div>

                        {/* Errors */}
                        {operation.errors.length > 0 && (
                          <div className="p-2 bg-red-50 border border-red-200 rounded text-sm">
                            <div className="font-medium text-red-800 mb-1">Erros:</div>
                            {operation.errors.map((error, index) => (
                              <div key={index} className="text-red-700">• {error}</div>
                            ))}
                          </div>
                        )}

                        {/* Retry button for failed operations */}
                        {operation.status === 'failed' && (
                          <div className="flex justify-end mt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => retryFailedSync(operation.id)}
                            >
                              <Repeat className="h-3 w-3 mr-1" />
                              Tentar Novamente
                            </Button>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {operations.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <Pulse className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Nenhuma operação de sincronização recente</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base">Performance de Sync</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Taxa de Sucesso</span>
                    <div className="flex items-center space-x-2">
                      <Progress value={96.8} className="w-20 h-2" />
                      <span className="text-sm font-medium">96.8%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Tempo Médio</span>
                    <span className="text-sm font-medium">2.4s</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Syncs Hoje</span>
                    <span className="text-sm font-medium">156</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Dados Processados</span>
                    <span className="text-sm font-medium">2.3GB</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base">Alertas e Recomendações</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-center space-x-2 mb-1">
                      <Warning className="h-4 w-4 text-yellow-600" />
                      <span className="font-medium text-yellow-800 text-sm">Rate Limit Alert</span>
                    </div>
                    <p className="text-xs text-yellow-700">
                      WhatsApp está próximo do limite. Considere reduzir frequência.
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center space-x-2 mb-1">
                      <TrendUp className="h-4 w-4 text-blue-600" />
                      <span className="font-medium text-blue-800 text-sm">Performance</span>
                    </div>
                    <p className="text-xs text-blue-700">
                      Instagram sync 23% mais rápido que a média.
                    </p>
                  </div>
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center space-x-2 mb-1">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="font-medium text-green-800 text-sm">Otimização</span>
                    </div>
                    <p className="text-xs text-green-700">
                      Melhor horário para sync: 02:00-04:00 (menor tráfego).
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base">Dados Unificados</CardTitle>
              <CardDescription>Estatísticas consolidadas de todas as plataformas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">2.4K</div>
                  <div className="text-sm text-muted-foreground">Conversas Ativas</div>
                </div>
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">156</div>
                  <div className="text-sm text-muted-foreground">Posts Hoje</div>
                </div>
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">89K</div>
                  <div className="text-sm text-muted-foreground">Seguidores Total</div>
                </div>
                <div className="text-center p-4 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">94%</div>
                  <div className="text-sm text-muted-foreground">Taxa Engajamento</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
