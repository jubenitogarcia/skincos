import { useState, useEffect } from 'react'
import { useKV, isDemoEnabled } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Input } from "@/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Label } from "@/label"
import { Switch } from "@/switch"
import { Progress } from "@/progress"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/alert-dialog"
import { useNotifications } from '@/contexts'
import {
  CloudArrowUp,
  CloudArrowDown,
  HardDrives,
  Shield,
  Clock,
  Download,
  Upload,
  Database,
  FolderOpen,
  Warning,
  CheckCircle,
  Info,
  Play,
  Pause,
  Trash,
  Copy,
  CalendarBlank,
  Archive,
  Lightning,
  Gear
} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface BackupJob {
  id: string
  name: string
  type: 'full' | 'incremental' | 'differential'
  schedule: 'daily' | 'weekly' | 'monthly' | 'manual'
  status: 'running' | 'completed' | 'failed' | 'scheduled' | 'paused'
  lastRun: string
  nextRun: string
  size: number
  duration: number
  retention: number // days
  location: 'local' | 'cloud' | 'remote'
  encryption: boolean
  compression: boolean
  progress?: number
}

interface BackupHistory {
  id: string
  jobId: string
  jobName: string
  timestamp: string
  type: 'full' | 'incremental' | 'differential'
  status: 'success' | 'failed' | 'partial'
  size: number
  duration: number
  filesBackedUp: number
  location: string
  checksum: string
}

interface RestorePoint {
  id: string
  name: string
  timestamp: string
  type: 'automatic' | 'manual'
  size: number
  location: string
  verified: boolean
  components: string[]
}

export function BackupRecoveryCenter() {
  const [activeTab, setActiveTab] = useState('overview')
  const [backupJobs, setBackupJobs] = useKV<BackupJob[]>('backup-jobs', [])
  const [backupHistory, setBackupHistory] = useKV<BackupHistory[]>('backup-history', [])
  const [restorePoints, setRestorePoints] = useKV<RestorePoint[]>('restore-points', [])
  const [autoBackupEnabled, setAutoBackupEnabled] = useKV('auto-backup-enabled', true)
  const [storageQuota, setStorageQuota] = useKV('storage-quota', { used: 250, total: 1000 }) // GB
  const { addNotification } = useNotifications()
  const demoEnabled = isDemoEnabled()

  // Initialize with demo data
  useEffect(() => {
    if (!demoEnabled) return
    if (backupJobs.length === 0) {
      const demoJobs: BackupJob[] = [
        {
          id: '1',
          name: 'Backup Completo Diário',
          type: 'full',
          schedule: 'daily',
          status: 'completed',
          lastRun: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          nextRun: new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString(),
          size: 15.7,
          duration: 45,
          retention: 30,
          location: 'cloud',
          encryption: true,
          compression: true
        },
        {
          id: '2',
          name: 'Backup Incremental',
          type: 'incremental',
          schedule: 'daily',
          status: 'running',
          lastRun: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          nextRun: new Date(Date.now() + 23.5 * 60 * 60 * 1000).toISOString(),
          size: 2.3,
          duration: 12,
          retention: 14,
          location: 'local',
          encryption: true,
          compression: true,
          progress: 67
        },
        {
          id: '3',
          name: 'Backup Semanal',
          type: 'full',
          schedule: 'weekly',
          status: 'scheduled',
          lastRun: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          nextRun: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          size: 42.1,
          duration: 120,
          retention: 90,
          location: 'remote',
          encryption: true,
          compression: false
        }
      ]
      setBackupJobs(demoJobs)

      const demoHistory: BackupHistory[] = [
        {
          id: '1',
          jobId: '1',
          jobName: 'Backup Completo Diário',
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          type: 'full',
          status: 'success',
          size: 15.7,
          duration: 45,
          filesBackedUp: 125847,
          location: 'cloud://backup-bucket/daily/2024-01-15',
          checksum: 'SHA256:a1b2c3d4e5f6...'
        },
        {
          id: '2',
          jobId: '2',
          jobName: 'Backup Incremental',
          timestamp: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
          type: 'incremental',
          status: 'success',
          size: 2.1,
          duration: 8,
          filesBackedUp: 3247,
          location: 'local://backups/incremental/2024-01-14',
          checksum: 'SHA256:f6e5d4c3b2a1...'
        },
        {
          id: '3',
          jobId: '1',
          jobName: 'Backup Completo Diário',
          timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          type: 'full',
          status: 'partial',
          size: 14.9,
          duration: 47,
          filesBackedUp: 124103,
          location: 'cloud://backup-bucket/daily/2024-01-12',
          checksum: 'SHA256:b2c3d4e5f6a1...'
        }
      ]
      setBackupHistory(demoHistory)

      const demoRestorePoints: RestorePoint[] = [
        {
          id: '1',
          name: 'Sistema Estável - Pré Atualização',
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          type: 'manual',
          size: 18.5,
          location: 'cloud://restore-points/stable-pre-update',
          verified: true,
          components: ['Database', 'Application', 'Configurations', 'User Data']
        },
        {
          id: '2',
          name: 'Ponto de Restauração Automático',
          timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          type: 'automatic',
          size: 16.2,
          location: 'local://restore-points/auto-2024-01-08',
          verified: true,
          components: ['Database', 'Configurations']
        },
        {
          id: '3',
          name: 'Backup Mensal - Janeiro',
          timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
          type: 'manual',
          size: 45.7,
          location: 'remote://monthly-backups/2024-01',
          verified: false,
          components: ['Full System', 'Database', 'Application', 'Logs', 'User Data']
        }
      ]
      setRestorePoints(demoRestorePoints)
    }
  }, [backupJobs.length, demoEnabled, setBackupJobs, setBackupHistory, setRestorePoints])

  const runBackupJob = async (jobId: string) => {
    const job = backupJobs.find(j => j.id === jobId)
    if (!job) return

    // Update job status to running
    setBackupJobs(prev =>
      prev.map(j =>
        j.id === jobId
          ? { ...j, status: 'running', progress: 0 }
          : j
      )
    )

    toast.info(`Iniciando backup: ${job.name}`)

    // Simulate backup progress
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 15
      if (progress >= 100) {
        progress = 100
        clearInterval(interval)

        // Complete the backup
        setBackupJobs(prev =>
          prev.map(j =>
            j.id === jobId
              ? {
                ...j,
                status: 'completed',
                lastRun: new Date().toISOString(),
                progress: undefined
              }
              : j
          )
        )

        // Add to history
        const newHistoryEntry: BackupHistory = {
          id: Date.now().toString(),
          jobId: job.id,
          jobName: job.name,
          timestamp: new Date().toISOString(),
          type: job.type,
          status: 'success',
          size: job.size + Math.random() * 2 - 1, // Slight variation
          duration: Math.floor(job.duration * (0.8 + Math.random() * 0.4)),
          filesBackedUp: Math.floor(100000 + Math.random() * 50000),
          location: `${job.location}://backups/${new Date().toISOString().split('T')[0]}`,
          checksum: `SHA256:${Math.random().toString(36).substring(2, 15)}...`
        }

        setBackupHistory(prev => [newHistoryEntry, ...prev])

        addNotification({
          title: 'Backup Concluído',
          message: `${job.name} foi concluído com sucesso`,
          type: 'success',
          priority: 'medium',
          category: 'backup'
        })

        toast.success(`Backup concluído: ${job.name}`)
      } else {
        setBackupJobs(prev =>
          prev.map(j =>
            j.id === jobId
              ? { ...j, progress }
              : j
          )
        )
      }
    }, 500)
  }

  const createRestorePoint = async () => {
    const name = `Ponto Manual - ${new Date().toLocaleString()}`
    const newRestorePoint: RestorePoint = {
      id: Date.now().toString(),
      name,
      timestamp: new Date().toISOString(),
      type: 'manual',
      size: 15 + Math.random() * 10,
      location: `local://restore-points/manual-${Date.now()}`,
      verified: false,
      components: ['Database', 'Application', 'Configurations', 'User Data']
    }

    setRestorePoints(prev => [newRestorePoint, ...prev])

    toast.success('Ponto de restauração criado com sucesso')

    addNotification({
      title: 'Ponto de Restauração Criado',
      message: `Novo ponto de restauração: ${name}`,
      type: 'success',
      priority: 'medium',
      category: 'backup'
    })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-blue-500'
      case 'completed': return 'bg-green-500'
      case 'failed': return 'bg-red-500'
      case 'scheduled': return 'bg-yellow-500'
      case 'paused': return 'bg-gray-500'
      default: return 'bg-gray-400'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <Play className="h-4 w-4" />
      case 'completed': return <CheckCircle className="h-4 w-4" />
      case 'failed': return <Warning className="h-4 w-4" />
      case 'scheduled': return <Clock className="h-4 w-4" />
      case 'paused': return <Pause className="h-4 w-4" />
      default: return <Info className="h-4 w-4" />
    }
  }

  const formatFileSize = (sizeInGB: number) => {
    if (sizeInGB < 1) {
      return `${(sizeInGB * 1024).toFixed(0)} MB`
    }
    return `${sizeInGB.toFixed(1)} GB`
  }

  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes}min`
    }
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}min`
  }

  const storageUsagePercent = (storageQuota.used / storageQuota.total) * 100

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Centro de Backup e Recuperação</h2>
          <p className="text-muted-foreground">
            Gestão completa de backups, pontos de restauração e recuperação de dados
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={createRestorePoint}>
            <Archive className="h-4 w-4 mr-2" />
            Criar Ponto de Restauração
          </Button>
          <Button variant="outline">
            <Gear className="h-4 w-4 mr-2" />
            Configurações
          </Button>
        </div>
      </div>

      {/* Storage Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Armazenamento Usado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatFileSize(storageQuota.used)}</div>
            <Progress value={storageUsagePercent} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {formatFileSize(storageQuota.total - storageQuota.used)} disponível
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Último Backup</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2h atrás</div>
            <p className="text-xs text-muted-foreground mt-2">
              Backup Completo Diário - Sucesso
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Próximo Backup</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">22h</div>
            <p className="text-xs text-muted-foreground mt-2">
              Backup Completo Diário
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="jobs">Jobs de Backup</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
          <TabsTrigger value="restore">Restauração</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Backup Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Shield className="h-5 w-5" />
                  <span>Status dos Backups</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {backupJobs.slice(0, 3).map((job) => (
                  <div key={job.id} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={`w-2 h-2 rounded-full ${getStatusColor(job.status)}`}></div>
                      <div>
                        <p className="font-medium text-sm">{job.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.status === 'running' && job.progress
                            ? `${job.progress.toFixed(0)}% concluído`
                            : `Último: ${new Date(job.lastRun).toLocaleString()}`
                          }
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {job.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Recent Pulse */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Clock className="h-5 w-5" />
                  <span>Atividade Recente</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {backupHistory.slice(0, 3).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={`w-2 h-2 rounded-full ${entry.status === 'success' ? 'bg-green-500' :
                          entry.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                        }`}></div>
                      <div>
                        <p className="font-medium text-sm">{entry.jobName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(entry.size)} • {formatDuration(entry.duration)}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* System Health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5" />
                <span>Saúde do Sistema de Backup</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">98.5%</div>
                  <p className="text-sm text-muted-foreground">Taxa de Sucesso</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">15min</div>
                  <p className="text-sm text-muted-foreground">Tempo Médio</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{restorePoints.length}</div>
                  <p className="text-sm text-muted-foreground">Pontos de Restauração</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">30 dias</div>
                  <p className="text-sm text-muted-foreground">Retenção Média</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Jobs de Backup</span>
                <Button size="sm">
                  <HardDrives className="h-4 w-4 mr-2" />
                  Novo Job
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {backupJobs.map((job) => (
                  <div key={job.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(job.status)}
                        <div>
                          <h3 className="font-medium">{job.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {job.type} • {job.schedule} • {job.location}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline">{job.status}</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => runBackupJob(job.id)}
                          disabled={job.status === 'running'}
                        >
                          {job.status === 'running' ? 'Executando...' : 'Executar'}
                        </Button>
                      </div>
                    </div>

                    {job.progress !== undefined && (
                      <div className="mb-3">
                        <div className="flex justify-between text-sm mb-1">
                          <span>Progresso</span>
                          <span>{job.progress.toFixed(0)}%</span>
                        </div>
                        <Progress value={job.progress} />
                      </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Último Backup</p>
                        <p className="font-medium">{new Date(job.lastRun).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Próximo Backup</p>
                        <p className="font-medium">{new Date(job.nextRun).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Tamanho</p>
                        <p className="font-medium">{formatFileSize(job.size)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Retenção</p>
                        <p className="font-medium">{job.retention} dias</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 mt-3 text-sm">
                      <div className="flex items-center space-x-1">
                        <Shield className="h-4 w-4" />
                        <span className={job.encryption ? 'text-green-600' : 'text-gray-400'}>
                          {job.encryption ? 'Criptografado' : 'Sem criptografia'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Archive className="h-4 w-4" />
                        <span className={job.compression ? 'text-green-600' : 'text-gray-400'}>
                          {job.compression ? 'Comprimido' : 'Sem compressão'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Backups</CardTitle>
              <CardDescription>
                Histórico completo de todos os backups executados
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {backupHistory.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${entry.status === 'success' ? 'bg-green-500' :
                          entry.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                        }`}></div>
                      <div>
                        <h4 className="font-medium">{entry.jobName}</h4>
                        <p className="text-sm text-muted-foreground">
                          {entry.type} • {formatFileSize(entry.size)} • {formatDuration(entry.duration)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.filesBackedUp.toLocaleString()} arquivos • {entry.location}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={entry.status === 'success' ? 'default' : 'destructive'}>
                        {entry.status}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(entry.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="restore" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Pontos de Restauração</span>
                <Button onClick={createRestorePoint} size="sm">
                  <Archive className="h-4 w-4 mr-2" />
                  Criar Ponto
                </Button>
              </CardTitle>
              <CardDescription>
                Pontos de restauração disponíveis para recuperação do sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {restorePoints.map((point) => (
                  <div key={point.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <Archive className="h-5 w-5" />
                        <div>
                          <h3 className="font-medium">{point.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {point.type} • {formatFileSize(point.size)} • {new Date(point.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant={point.verified ? 'default' : 'secondary'}>
                          {point.verified ? 'Verificado' : 'Não verificado'}
                        </Badge>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              <CloudArrowDown className="h-4 w-4 mr-2" />
                              Restaurar
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar Restauração</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja restaurar o sistema para o ponto "{point.name}"?
                                Esta ação não pode ser desfeita e pode sobrescrever dados atuais.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => {
                                toast.info(`Iniciando restauração: ${point.name}`)
                                addNotification({
                                  title: 'Restauração Iniciada',
                                  message: `Restaurando sistema para: ${point.name}`,
                                  type: 'info',
                                  priority: 'high',
                                  category: 'backup'
                                })
                              }}>
                                Restaurar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        <strong>Localização:</strong> {point.location}
                      </p>
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">
                          <strong>Componentes:</strong>
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {point.components.map((component, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {component}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
