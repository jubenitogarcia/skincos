import { useState, useEffect } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MetricCard } from '@/components/MetricCard'
import { useNotifications } from '@/contexts/NotificationContext'
import {
  Cpu,
  HardDrives,
  Network,
  Lightning,
  Pulse,
  Users,
  Database,
  Clock,
  TrendUp,
  Warning,
  CheckCircle,
  XCircle,
  Info,
  Eye,
  ArrowsClockwise,
  Download,
  Upload,
  Gauge
} from "@phosphor-icons/react"

interface SystemMetrics {
  cpu: {
    usage: number
    cores: number
    temperature: number
    processes: number
  }
  memory: {
    used: number
    total: number
    available: number
    cached: number
  }
  disk: {
    used: number
    total: number
    readSpeed: number
    writeSpeed: number
  }
  network: {
    downloadSpeed: number
    uploadSpeed: number
    latency: number
    packetsLost: number
  }
  database: {
    connections: number
    maxConnections: number
    queryTime: number
    slowQueries: number
  }
  application: {
    activeUsers: number
    requestsPerMinute: number
    responseTime: number
    errorRate: number
  }
}

interface SystemAlert {
  id: string
  level: 'info' | 'warning' | 'error' | 'critical'
  component: string
  message: string
  timestamp: string
  resolved: boolean
  metric?: string
  value?: number
  threshold?: number
}

export function SystemMonitoring() {
  const [activeTab, setActiveTab] = useState('overview')
  const [isLive, setIsLive] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshInterval, setRefreshInterval] = useState(5000)
  const [alerts, setAlerts] = useKV<SystemAlert[]>('system-alerts', [])
  const { addNotification } = useNotifications()

  // Simulated system metrics
  const [metrics, setMetrics] = useState<SystemMetrics>({
    cpu: {
      usage: 45,
      cores: 8,
      temperature: 58,
      processes: 156
    },
    memory: {
      used: 6.2,
      total: 16,
      available: 9.8,
      cached: 2.1
    },
    disk: {
      used: 750,
      total: 1000,
      readSpeed: 120,
      writeSpeed: 85
    },
    network: {
      downloadSpeed: 850,
      uploadSpeed: 420,
      latency: 45,
      packetsLost: 0.02
    },
    database: {
      connections: 25,
      maxConnections: 100,
      queryTime: 2.3,
      slowQueries: 3
    },
    application: {
      activeUsers: 847,
      requestsPerMinute: 1250,
      responseTime: 180,
      errorRate: 0.8
    }
  })

  // Simulate real-time metrics updates
  useEffect(() => {
    if (!isLive || !autoRefresh) return

    const interval = setInterval(() => {
      setMetrics(prev => {
        const newMetrics = { ...prev }

        // CPU usage fluctuation
        newMetrics.cpu.usage = Math.max(10, Math.min(95,
          prev.cpu.usage + (Math.random() - 0.5) * 10
        ))

        // Memory usage small changes
        newMetrics.memory.used = Math.max(3, Math.min(14,
          prev.memory.used + (Math.random() - 0.5) * 0.5
        ))

        // Network speeds variation
        newMetrics.network.downloadSpeed = Math.max(100, Math.min(1000,
          prev.network.downloadSpeed + (Math.random() - 0.5) * 100
        ))
        newMetrics.network.uploadSpeed = Math.max(50, Math.min(500,
          prev.network.uploadSpeed + (Math.random() - 0.5) * 50
        ))

        // Response time changes
        newMetrics.application.responseTime = Math.max(50, Math.min(500,
          prev.application.responseTime + (Math.random() - 0.5) * 30
        ))

        // Active users realistic fluctuation
        newMetrics.application.activeUsers = Math.max(500, Math.min(1200,
          prev.application.activeUsers + Math.floor((Math.random() - 0.5) * 20)
        ))

        return newMetrics
      })
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [isLive, autoRefresh, refreshInterval])

  // Generate alerts based on metrics
  useEffect(() => {
    const checkThresholds = () => {
      const newAlerts: SystemAlert[] = []
      const now = new Date().toISOString()

      // CPU usage alert
      if (metrics.cpu.usage > 85) {
        newAlerts.push({
          id: `cpu-${Date.now()}`,
          level: metrics.cpu.usage > 95 ? 'critical' : 'warning',
          component: 'CPU',
          message: `CPU usage is ${metrics.cpu.usage.toFixed(1)}%`,
          timestamp: now,
          resolved: false,
          metric: 'cpu_usage',
          value: metrics.cpu.usage,
          threshold: 85
        })
      }

      // Memory alert
      const memoryUsagePercent = (metrics.memory.used / metrics.memory.total) * 100
      if (memoryUsagePercent > 80) {
        newAlerts.push({
          id: `memory-${Date.now()}`,
          level: memoryUsagePercent > 90 ? 'critical' : 'warning',
          component: 'Memory',
          message: `Memory usage is ${memoryUsagePercent.toFixed(1)}%`,
          timestamp: now,
          resolved: false,
          metric: 'memory_usage',
          value: memoryUsagePercent,
          threshold: 80
        })
      }

      // Response time alert
      if (metrics.application.responseTime > 300) {
        newAlerts.push({
          id: `response-${Date.now()}`,
          level: metrics.application.responseTime > 400 ? 'critical' : 'warning',
          component: 'Application',
          message: `Response time is ${metrics.application.responseTime}ms`,
          timestamp: now,
          resolved: false,
          metric: 'response_time',
          value: metrics.application.responseTime,
          threshold: 300
        })
      }

      // Add new alerts
      if (newAlerts.length > 0) {
        setAlerts(prev => {
          // Avoid duplicate alerts
          const existingIds = new Set(prev.map(a => a.component))
          const filteredNewAlerts = newAlerts.filter(a => !existingIds.has(a.component))

          if (filteredNewAlerts.length > 0) {
            // Send notification for critical alerts
            filteredNewAlerts.forEach(alert => {
              if (alert.level === 'critical') {
                addNotification({
                  title: `Sistema crítico: ${alert.component}`,
                  message: alert.message,
                  type: 'error',
                  priority: 'high',
                  category: 'system'
                })
              }
            })
          }

          return [...prev, ...filteredNewAlerts].slice(-50) // Keep last 50 alerts
        })
      }
    }

    const interval = setInterval(checkThresholds, 10000) // CheckCircle every 10 seconds
    return () => clearInterval(interval)
  }, [metrics, addNotification, setAlerts])

  const getStatusColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-500'
      case 'warning': return 'bg-yellow-500'
      case 'error': return 'bg-orange-500'
      default: return 'bg-green-500'
    }
  }

  const getStatusIcon = (level: string) => {
    switch (level) {
      case 'critical': return <XCircle className="h-4 w-4" />
      case 'warning': return <Warning className="h-4 w-4" />
      case 'error': return <XCircle className="h-4 w-4" />
      default: return <CheckCircle className="h-4 w-4" />
    }
  }

  const resolveAlert = (alertId: string) => {
    setAlerts(prev =>
      prev.map(alert =>
        alert.id === alertId
          ? { ...alert, resolved: true }
          : alert
      )
    )
  }

  const memoryUsagePercent = (metrics.memory.used / metrics.memory.total) * 100
  const diskUsagePercent = (metrics.disk.used / metrics.disk.total) * 100
  const dbConnectionsPercent = (metrics.database.connections / metrics.database.maxConnections) * 100

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Monitoramento do Sistema</h2>
          <p className="text-muted-foreground">
            Monitoramento em tempo real da saúde e performance do sistema
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge variant={isLive ? "default" : "secondary"} className="flex items-center space-x-1">
            <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
            <span>{isLive ? 'Ao vivo' : 'Pausado'}</span>
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsLive(!isLive)}
          >
            {isLive ? 'Pausar' : 'Iniciar'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            <ArrowsClockwise className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* System Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          metric={{
            id: '1',
            title: 'CPU',
            value: `${metrics.cpu.usage.toFixed(1)}%`,
            change: metrics.cpu.usage > 75 ? -5.2 : 2.3,
            trend: metrics.cpu.usage > 75 ? 'down' : 'up',
            icon: 'chart',
            color: metrics.cpu.usage > 85 ? 'text-red-600' : metrics.cpu.usage > 65 ? 'text-yellow-600' : 'text-green-600'
          }}
        />
        <MetricCard
          metric={{
            id: '2',
            title: 'Memória',
            value: `${memoryUsagePercent.toFixed(1)}%`,
            change: memoryUsagePercent > 80 ? -3.1 : 1.8,
            trend: memoryUsagePercent > 80 ? 'down' : 'up',
            icon: 'chart',
            color: memoryUsagePercent > 85 ? 'text-red-600' : memoryUsagePercent > 70 ? 'text-yellow-600' : 'text-green-600'
          }}
        />
        <MetricCard
          metric={{
            id: '3',
            title: 'Usuários Ativos',
            value: metrics.application.activeUsers.toString(),
            change: 12.4,
            trend: 'up',
            icon: 'users',
            color: 'text-blue-600'
          }}
        />
        <MetricCard
          metric={{
            id: '4',
            title: 'Tempo Resposta',
            value: `${metrics.application.responseTime}ms`,
            change: metrics.application.responseTime > 300 ? -8.5 : 4.2,
            trend: metrics.application.responseTime > 300 ? 'down' : 'up',
            icon: 'chart',
            color: metrics.application.responseTime > 300 ? 'text-red-600' : metrics.application.responseTime > 200 ? 'text-yellow-600' : 'text-green-600'
          }}
        />
      </div>

      {/* Detailed Monitoring */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="database">Banco de Dados</TabsTrigger>
          <TabsTrigger value="network">Rede</TabsTrigger>
          <TabsTrigger value="alerts">Alertas</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* System Resources */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Gauge className="h-5 w-5" />
                  <span>Recursos do Sistema</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>CPU ({metrics.cpu.cores} cores)</span>
                    <span>{metrics.cpu.usage.toFixed(1)}%</span>
                  </div>
                  <Progress value={metrics.cpu.usage} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Memória ({metrics.memory.total}GB)</span>
                    <span>{memoryUsagePercent.toFixed(1)}%</span>
                  </div>
                  <Progress value={memoryUsagePercent} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Disco ({metrics.disk.total}GB)</span>
                    <span>{diskUsagePercent.toFixed(1)}%</span>
                  </div>
                  <Progress value={diskUsagePercent} className="h-2" />
                </div>
              </CardContent>
            </Card>

            {/* Application Metrics */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Pulse className="h-5 w-5" />
                  <span>Métricas da Aplicação</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Usuários Ativos</span>
                  <span className="font-medium">{metrics.application.activeUsers}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Requisições/min</span>
                  <span className="font-medium">{metrics.application.requestsPerMinute}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Tempo de Resposta</span>
                  <span className={`font-medium ${metrics.application.responseTime > 300 ? 'text-red-600' : 'text-green-600'}`}>
                    {metrics.application.responseTime}ms
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Taxa de Erro</span>
                  <span className={`font-medium ${metrics.application.errorRate > 1 ? 'text-red-600' : 'text-green-600'}`}>
                    {metrics.application.errorRate}%
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Cpu className="h-5 w-5" />
                  <span>CPU</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Uso</span>
                  <span className="font-medium">{metrics.cpu.usage.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Cores</span>
                  <span className="font-medium">{metrics.cpu.cores}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Temperatura</span>
                  <span className="font-medium">{metrics.cpu.temperature}°C</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Processos</span>
                  <span className="font-medium">{metrics.cpu.processes}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <HardDrives className="h-5 w-5" />
                  <span>Memória</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Usado</span>
                  <span className="font-medium">{metrics.memory.used}GB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Disponível</span>
                  <span className="font-medium">{metrics.memory.available}GB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Cache</span>
                  <span className="font-medium">{metrics.memory.cached}GB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="font-medium">{metrics.memory.total}GB</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Database className="h-5 w-5" />
                  <span>Disco</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Usado</span>
                  <span className="font-medium">{metrics.disk.used}GB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Leitura</span>
                  <span className="font-medium">{metrics.disk.readSpeed}MB/s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Escrita</span>
                  <span className="font-medium">{metrics.disk.writeSpeed}MB/s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="font-medium">{metrics.disk.total}GB</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="database" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Database className="h-5 w-5" />
                <span>Performance do Banco de Dados</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Conexões Ativas</span>
                    <span>{metrics.database.connections}/{metrics.database.maxConnections}</span>
                  </div>
                  <Progress value={dbConnectionsPercent} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Tempo Médio de Query</span>
                    <span className="font-medium">{metrics.database.queryTime}ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Queries Lentas</span>
                    <span className="font-medium">{metrics.database.slowQueries}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="network" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Network className="h-5 w-5" />
                <span>Performance de Rede</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Download</span>
                  <div className="flex items-center space-x-2">
                    <Download className="h-4 w-4" />
                    <span className="font-medium">{metrics.network.downloadSpeed} Mbps</span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Upload</span>
                  <div className="flex items-center space-x-2">
                    <Upload className="h-4 w-4" />
                    <span className="font-medium">{metrics.network.uploadSpeed} Mbps</span>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Latência</span>
                  <span className="font-medium">{metrics.network.latency}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Perda de Pacotes</span>
                  <span className="font-medium">{metrics.network.packetsLost}%</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Warning className="h-5 w-5" />
                <span>Alertas do Sistema</span>
              </CardTitle>
              <CardDescription>
                Alertas e avisos sobre a saúde do sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.length > 0 ? (
                <div className="space-y-3">
                  {alerts.filter(alert => !alert.resolved).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(alert.level)}`}></div>
                        <div>
                          <div className="flex items-center space-x-2">
                            {getStatusIcon(alert.level)}
                            <span className="font-medium">{alert.component}</span>
                            <Badge variant="outline" className="text-xs">
                              {alert.level}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{alert.message}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(alert.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resolveAlert(alert.id)}
                      >
                        Resolver
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Sistema Saudável</h3>
                  <p className="text-muted-foreground">
                    Nenhum alerta ativo no momento
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
