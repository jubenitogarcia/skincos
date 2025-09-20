import { useState } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SystemConfiguration } from '@/components/SystemConfiguration'
import { SystemMonitoring } from '@/components/SystemMonitoring'
import { BackupRecoveryCenter } from '@/components/BackupRecoveryCenter'
import { AdvancedPermissionsManager } from '@/components/AdvancedPermissionsManager'
import {
  Gear,
  Pulse,
  CloudArrowUp,
  Shield,
  Users,
  Code,
  Bell,
  Globe,
  Database,
  Lightning,
  ChartLineUp,
  Cpu,
  HardDrives,
  Warning,
  CheckCircle,
  Info
} from "@phosphor-icons/react"

interface SystemHealth {
  status: 'healthy' | 'warning' | 'critical'
  uptime: string
  lastBackup: string
  activeUsers: number
  systemLoad: number
  diskUsage: number
  memoryUsage: number
}

export function GlobalGear() {
  const [activeTab, setActiveTab] = useState('overview')

  // System health data
  const [systemHealth] = useKV<SystemHealth>('system-health', {
    status: 'healthy',
    uptime: '15 dias, 8 horas',
    lastBackup: '2 horas atrás',
    activeUsers: 47,
    systemLoad: 65,
    diskUsage: 42,
    memoryUsage: 58
  })

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-600'
      case 'warning': return 'text-yellow-600'
      case 'critical': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-5 w-5" />
      case 'warning': return <Warning className="h-5 w-5" />
      case 'critical': return <Warning className="h-5 w-5" />
      default: return <Info className="h-5 w-5" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Configurações Globais</h2>
          <p className="text-muted-foreground">
            Centro de controle para configurações, monitoramento e administração do sistema
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Badge
            variant={systemHealth.status === 'healthy' ? 'default' : 'destructive'}
            className="flex items-center space-x-1"
          >
            {getHealthIcon(systemHealth.status)}
            <span className="capitalize">{systemHealth.status}</span>
          </Badge>
        </div>
      </div>

      {/* System Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center space-x-2">
              <Pulse className="h-4 w-4" />
              <span>Status do Sistema</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getHealthColor(systemHealth.status)}`}>
              {systemHealth.status === 'healthy' && 'Saudável'}
              {systemHealth.status === 'warning' && 'Atenção'}
              {systemHealth.status === 'critical' && 'Crítico'}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Uptime: {systemHealth.uptime}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center space-x-2">
              <CloudArrowUp className="h-4 w-4" />
              <span>Último Backup</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemHealth.lastBackup}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Backup automático ativo
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center space-x-2">
              <Users className="h-4 w-4" />
              <span>Usuários Online</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemHealth.activeUsers}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Sessões ativas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center space-x-2">
              <Cpu className="h-4 w-4" />
              <span>Carga do Sistema</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemHealth.systemLoad}%</div>
            <p className="text-xs text-muted-foreground mt-2">
              CPU e memória
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Configuration Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="system">Sistema</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoramento</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
          <TabsTrigger value="permissions">Permissões</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Lightning className="h-5 w-5" />
                  <span>Ações Rápidas</span>
                </CardTitle>
                <CardDescription>
                  Acesso rápido às principais funcionalidades administrativas
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setActiveTab('system')}
                >
                  <Gear className="h-4 w-4 mr-2" />
                  Configurações do Sistema
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setActiveTab('monitoring')}
                >
                  <Pulse className="h-4 w-4 mr-2" />
                  Monitoramento em Tempo Real
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setActiveTab('backup')}
                >
                  <CloudArrowUp className="h-4 w-4 mr-2" />
                  Centro de Backup
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setActiveTab('permissions')}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Gerenciar Permissões
                </Button>
              </CardContent>
            </Card>

            {/* System Statistics */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <ChartLineUp className="h-5 w-5" />
                  <span>Estatísticas Rápidas</span>
                </CardTitle>
                <CardDescription>
                  Resumo do desempenho e uso do sistema
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Uso do Disco</span>
                    <span>{systemHealth.diskUsage}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${systemHealth.diskUsage}%` }}
                    ></div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Uso da Memória</span>
                    <span>{systemHealth.memoryUsage}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="bg-accent h-2 rounded-full transition-all duration-300"
                      style={{ width: `${systemHealth.memoryUsage}%` }}
                    ></div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Carga do Sistema</span>
                    <span>{systemHealth.systemLoad}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${systemHealth.systemLoad > 80 ? 'bg-red-500' :
                          systemHealth.systemLoad > 60 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                      style={{ width: `${systemHealth.systemLoad}%` }}
                    ></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Pulse */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Bell className="h-5 w-5" />
                <span>Atividade Recente do Sistema</span>
              </CardTitle>
              <CardDescription>
                Últimas alterações e eventos importantes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center space-x-3 p-3 bg-green-50 rounded-lg border border-green-200">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Backup automático concluído</p>
                    <p className="text-xs text-muted-foreground">2 horas atrás</p>
                  </div>
                </div>

                <div className="flex items-center space-x-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <Info className="h-4 w-4 text-blue-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Configurações de email atualizadas</p>
                    <p className="text-xs text-muted-foreground">5 horas atrás</p>
                  </div>
                </div>

                <div className="flex items-center space-x-3 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                  <Warning className="h-4 w-4 text-yellow-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Uso de memória acima de 80%</p>
                    <p className="text-xs text-muted-foreground">8 horas atrás</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system">
          <SystemConfiguration />
        </TabsContent>

        <TabsContent value="monitoring">
          <SystemMonitoring />
        </TabsContent>

        <TabsContent value="backup">
          <BackupRecoveryCenter />
        </TabsContent>

        <TabsContent value="permissions">
          <AdvancedPermissionsManager />
        </TabsContent>
      </Tabs>
    </div>
  )
}
