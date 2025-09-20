import React, { useState } from 'react'
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
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import {
  Plus,
  PencilSimple,
  Trash,
  FloppyDisk,
  Copy,
  Gear,
  Target,
  TrendUp,
  Users,
  CurrencyDollar,
  Clock,
  ArrowRight,
  DotsSixVertical,
  Eye,
  ChartBar,
  CheckCircle,
  Warning,
  Circle,
  Funnel
} from "@phosphor-icons/react"
import { toast } from 'sonner'

interface Pipeline {
  id: string
  name: string
  description: string
  entity: 'leads' | 'deals' | 'opportunities' | 'projects' | 'support-tickets'
  isDefault: boolean
  isActive: boolean
  stages: PipelineStage[]
  settings: {
    autoProgressRules: boolean
    requireWinLossReason: boolean
    enableProbabilityTracking: boolean
    allowStageSkipping: boolean
    rottenDays: number
    notifyOnStagnation: boolean
  }
  analytics: {
    totalItems: number
    totalValue: number
    avgDealSize: number
    avgCycleTime: number
    conversionRate: number
    winRate: number
  }
  permissions: {
    view: string[]
    edit: string[]
    delete: string[]
  }
  createdAt: string
  updatedAt: string
}

interface PipelineStage {
  id: string
  name: string
  description?: string
  color: string
  probability: number
  order: number
  type: 'open' | 'won' | 'lost' | 'closed'
  isDefault: boolean
  settings: {
    requireFields: string[]
    autoActions: StageAction[]
    stageGoal?: number
    maxDaysInStage?: number
  }
  analytics: {
    itemCount: number
    totalValue: number
    avgTimeInStage: number
    conversionToNext: number
  }
}

interface StageAction {
  id: string
  trigger: 'enter' | 'exit' | 'timeout'
  action: 'send-email' | 'create-task' | 'notify-user' | 'update-field' | 'webhook'
  parameters: Record<string, any>
  isActive: boolean
}

const defaultPipeline: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  description: '',
  entity: 'deals',
  isDefault: false,
  isActive: true,
  stages: [],
  settings: {
    autoProgressRules: false,
    requireWinLossReason: true,
    enableProbabilityTracking: true,
    allowStageSkipping: false,
    rottenDays: 30,
    notifyOnStagnation: true
  },
  analytics: {
    totalItems: 0,
    totalValue: 0,
    avgDealSize: 0,
    avgCycleTime: 0,
    conversionRate: 0,
    winRate: 0
  },
  permissions: {
    view: ['all'],
    edit: ['manager', 'admin'],
    delete: ['admin']
  }
}

const defaultStages = [
  {
    name: 'Prospection',
    description: 'Initial contact and qualification',
    color: '#6b7280',
    probability: 10,
    type: 'open' as const
  },
  {
    name: 'Qualification',
    description: 'Lead is qualified and interested',
    color: '#3b82f6',
    probability: 25,
    type: 'open' as const
  },
  {
    name: 'Proposal',
    description: 'Proposal sent to prospect',
    color: '#f59e0b',
    probability: 50,
    type: 'open' as const
  },
  {
    name: 'Negotiation',
    description: 'Negotiating terms and conditions',
    color: '#ef4444',
    probability: 75,
    type: 'open' as const
  },
  {
    name: 'Closed Won',
    description: 'Deal successfully closed',
    color: '#22c55e',
    probability: 100,
    type: 'won' as const
  },
  {
    name: 'Closed Lost',
    description: 'Deal was lost',
    color: '#dc2626',
    probability: 0,
    type: 'lost' as const
  }
]

const entityTypes = [
  { value: 'leads', label: 'Leads', icon: Users },
  { value: 'deals', label: 'Negócios', icon: Target },
  { value: 'opportunities', label: 'Oportunidades', icon: TrendUp },
  { value: 'projects', label: 'Projetos', icon: Funnel },
  { value: 'support-tickets', label: 'Tickets de Suporte', icon: Warning }
]

const stageColors = [
  '#6b7280', '#3b82f6', '#f59e0b', '#ef4444', '#22c55e', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#84cc16'
]

export function PipelineManager() {
  const [pipelines, setPipelines] = useKV<Pipeline[]>('krayin-pipelines', [])
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null)
  const [editingPipeline, setEditingPipeline] = useState<Partial<Pipeline> | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  const createPipeline = (pipelineData: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newPipeline: Pipeline = {
      ...pipelineData,
      id: `pipeline-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    setPipelines(currentPipelines => [...currentPipelines, newPipeline])
    toast.success('Pipeline criado com sucesso!')
    setIsCreateDialogOpen(false)
  }

  const updatePipeline = (pipelineId: string, updates: Partial<Pipeline>) => {
    setPipelines(currentPipelines =>
      currentPipelines.map(pipeline =>
        pipeline.id === pipelineId
          ? { ...pipeline, ...updates, updatedAt: new Date().toISOString() }
          : pipeline
      )
    )
    toast.success('Pipeline atualizado com sucesso!')
    setIsEditDialogOpen(false)
    setEditingPipeline(null)
  }

  const deletePipeline = (pipelineId: string) => {
    setPipelines(currentPipelines => currentPipelines.filter(pipeline => pipeline.id !== pipelineId))
    toast.success('Pipeline removido com sucesso!')
  }

  const duplicatePipeline = (pipeline: Pipeline) => {
    const duplicatedPipeline: Pipeline = {
      ...pipeline,
      id: `pipeline-${Date.now()}`,
      name: `${pipeline.name} (Cópia)`,
      isDefault: false,
      analytics: {
        totalItems: 0,
        totalValue: 0,
        avgDealSize: 0,
        avgCycleTime: 0,
        conversionRate: 0,
        winRate: 0
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    setPipelines(currentPipelines => [...currentPipelines, duplicatedPipeline])
    toast.success('Pipeline duplicado com sucesso!')
  }

  const createDefaultPipeline = () => {
    const stages: PipelineStage[] = defaultStages.map((stage, index) => ({
      id: `stage-${Date.now()}-${index}`,
      ...stage,
      order: index,
      isDefault: index === 0,
      settings: {
        requireFields: [],
        autoActions: []
      },
      analytics: {
        itemCount: 0,
        totalValue: 0,
        avgTimeInStage: 0,
        conversionToNext: 0
      }
    }))

    const newPipeline: Pipeline = {
      ...defaultPipeline,
      id: `pipeline-${Date.now()}`,
      name: 'Pipeline Padrão de Vendas',
      description: 'Pipeline padrão para gestão de vendas',
      entity: 'deals',
      isDefault: pipelines.length === 0,
      stages,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    setPipelines([newPipeline])
    toast.success('Pipeline padrão criado com sucesso!')
  }

  const handleDragEnd = (result: any, pipelineId: string) => {
    if (!result.destination) return

    const pipeline = pipelines.find(p => p.id === pipelineId)
    if (!pipeline) return

    const items = Array.from(pipeline.stages)
    const [reorderedItem] = items.splice(result.source.index, 1)
    items.splice(result.destination.index, 0, reorderedItem)

    // Update order values
    const updatedStages = items.map((stage, index) => ({
      ...stage,
      order: index
    }))

    updatePipeline(pipelineId, { stages: updatedStages })
  }

  const getEntityIcon = (entity: string) => {
    const entityType = entityTypes.find(e => e.value === entity)
    return entityType ? entityType.icon : Target
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gerenciador de Pipelines</h2>
          <p className="text-muted-foreground">
            Configure pipelines customizáveis para diferentes processos de negócio
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {pipelines.length === 0 && (
            <Button variant="outline" onClick={createDefaultPipeline}>
              <Target className="h-4 w-4 mr-2" />
              Pipeline Padrão
            </Button>
          )}
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Pipeline
          </Button>
        </div>
      </div>

      {/* Pipelines Overview */}
      {pipelines.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pipelines.map((pipeline) => {
            const EntityIcon = getEntityIcon(pipeline.entity)
            const entityType = entityTypes.find(e => e.value === pipeline.entity)

            return (
              <Card key={pipeline.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg flex items-center space-x-2">
                        <EntityIcon className="h-5 w-5" />
                        <span>{pipeline.name}</span>
                      </CardTitle>
                      <CardDescription className="line-clamp-2">
                        {pipeline.description}
                      </CardDescription>
                    </div>
                    <div className="flex items-center space-x-1">
                      {pipeline.isDefault && (
                        <Badge variant="outline">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Padrão
                        </Badge>
                      )}
                      <Badge variant={pipeline.isActive ? "default" : "secondary"}>
                        {pipeline.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <Badge variant="outline" className="capitalize">
                      {entityType?.label}
                    </Badge>
                    <Badge variant="outline">
                      {pipeline.stages.length} estágios
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Stages Preview */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Estágios</Label>
                    <div className="flex items-center space-x-1 overflow-x-auto pb-2">
                      {pipeline.stages
                        .sort((a, b) => a.order - b.order)
                        .map((stage, index) => (
                          <div key={stage.id} className="flex items-center space-x-1 flex-shrink-0">
                            <div
                              className="w-3 h-3 rounded-full border-2 border-white shadow-sm"
                              style={{ backgroundColor: stage.color }}
                              title={stage.name}
                            />
                            {index < pipeline.stages.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Analytics */}
                  <div className="grid grid-cols-2 gap-4 text-center text-sm">
                    <div>
                      <p className="text-muted-foreground">Itens</p>
                      <p className="font-bold">{pipeline.analytics.totalItems}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Taxa Conversão</p>
                      <p className="font-bold">{pipeline.analytics.conversionRate.toFixed(1)}%</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setSelectedPipeline(pipeline)
                        setActiveTab('stages')
                      }}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Ver
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingPipeline(pipeline)
                        setIsEditDialogOpen(true)
                      }}
                    >
                      <PencilSimple className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => duplicatePipeline(pipeline)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card className="text-center py-12">
          <CardContent>
            <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum pipeline configurado</h3>
            <p className="text-muted-foreground mb-4">
              Crie seu primeiro pipeline para gerenciar processos de negócio
            </p>
            <div className="flex justify-center space-x-2">
              <Button onClick={createDefaultPipeline} variant="outline">
                <Target className="h-4 w-4 mr-2" />
                Pipeline Padrão
              </Button>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Criar Pipeline
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pipeline Detail Modal */}
      {selectedPipeline && (
        <Dialog open={!!selectedPipeline} onOpenChange={() => setSelectedPipeline(null)}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                {React.createElement(getEntityIcon(selectedPipeline.entity), { className: "h-5 w-5" })}
                <span>{selectedPipeline.name}</span>
              </DialogTitle>
              <DialogDescription>
                Configurações e estágios do pipeline
              </DialogDescription>
            </DialogHeader>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="stages">Estágios</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="settings">Configurações</TabsTrigger>
                <TabsTrigger value="permissions">Permissões</TabsTrigger>
              </TabsList>

              <TabsContent value="stages" className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Estágios do Pipeline</h4>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar Estágio
                  </Button>
                </div>

                <DragDropContext onDragEnd={(result) => handleDragEnd(result, selectedPipeline.id)}>
                  <Droppable droppableId="stages">
                    {(provided) => (
                      <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                        {selectedPipeline.stages
                          .sort((a, b) => a.order - b.order)
                          .map((stage, index) => (
                            <Draggable key={stage.id} draggableId={stage.id} index={index}>
                              {(provided, snapshot) => (
                                <Card
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className={`${snapshot.isDragging ? 'shadow-lg' : ''} transition-shadow`}
                                >
                                  <CardContent className="p-4">
                                    <div className="flex items-center space-x-4">
                                      <div
                                        {...provided.dragHandleProps}
                                        className="cursor-move"
                                      >
                                        <DotsSixVertical className="h-4 w-4 text-muted-foreground" />
                                      </div>

                                      <div
                                        className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                                        style={{ backgroundColor: stage.color }}
                                      />

                                      <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                          <h5 className="font-medium">{stage.name}</h5>
                                          <div className="flex items-center space-x-2">
                                            <Badge variant="outline">
                                              {stage.probability}% prob.
                                            </Badge>
                                            <Badge variant="outline" className="capitalize">
                                              {stage.type}
                                            </Badge>
                                          </div>
                                        </div>
                                        {stage.description && (
                                          <p className="text-sm text-muted-foreground mt-1">
                                            {stage.description}
                                          </p>
                                        )}

                                        <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
                                          <div>
                                            <span className="text-muted-foreground">Itens: </span>
                                            <span className="font-medium">{stage.analytics.itemCount}</span>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground">Valor: </span>
                                            <span className="font-medium">R$ {stage.analytics.totalValue.toLocaleString()}</span>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground">Tempo Médio: </span>
                                            <span className="font-medium">{stage.analytics.avgTimeInStage}d</span>
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center space-x-1">
                                        <Button variant="ghost" size="sm">
                                          <PencilSimple className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="sm">
                                          <Trash className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              )}
                            </Draggable>
                          ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              </TabsContent>

              <TabsContent value="analytics" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <Users className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                      <p className="text-2xl font-bold">{selectedPipeline.analytics.totalItems}</p>
                      <p className="text-sm text-muted-foreground">Total de Itens</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4 text-center">
                      <CurrencyDollar className="h-8 w-8 text-green-600 mx-auto mb-2" />
                      <p className="text-2xl font-bold">R$ {(selectedPipeline.analytics.totalValue / 1000).toFixed(0)}K</p>
                      <p className="text-sm text-muted-foreground">Valor Total</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4 text-center">
                      <Clock className="h-8 w-8 text-orange-600 mx-auto mb-2" />
                      <p className="text-2xl font-bold">{selectedPipeline.analytics.avgCycleTime}d</p>
                      <p className="text-sm text-muted-foreground">Ciclo Médio</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4 text-center">
                      <TrendUp className="h-8 w-8 text-purple-600 mx-auto mb-2" />
                      <p className="text-2xl font-bold">{selectedPipeline.analytics.winRate.toFixed(1)}%</p>
                      <p className="text-sm text-muted-foreground">Taxa de Vitória</p>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="settings" className="space-y-4">
                <div className="space-y-6">
                  <div>
                    <h4 className="font-medium mb-4">Configurações Gerais</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label>Regras de Progressão Automática</Label>
                          <p className="text-sm text-muted-foreground">
                            Automaticamente mover itens entre estágios baseado em critérios
                          </p>
                        </div>
                        <Switch checked={selectedPipeline.settings.autoProgressRules} disabled />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <Label>Exigir Motivo de Vitória/Perda</Label>
                          <p className="text-sm text-muted-foreground">
                            Obrigar preenchimento de motivo ao fechar negócios
                          </p>
                        </div>
                        <Switch checked={selectedPipeline.settings.requireWinLossReason} disabled />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <Label>Rastreamento de Probabilidade</Label>
                          <p className="text-sm text-muted-foreground">
                            Usar probabilidades para cálculos de receita prevista
                          </p>
                        </div>
                        <Switch checked={selectedPipeline.settings.enableProbabilityTracking} disabled />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-4">Configurações de Alerta</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Dias para Negócio Estagnado</Label>
                        <Input
                          type="number"
                          value={selectedPipeline.settings.rottenDays}
                          disabled
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <Label>Notificar sobre Estagnação</Label>
                          <p className="text-sm text-muted-foreground">
                            Alertar quando negócios ficam muito tempo em um estágio
                          </p>
                        </div>
                        <Switch checked={selectedPipeline.settings.notifyOnStagnation} disabled />
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="permissions" className="space-y-4">
                <div className="space-y-6">
                  <div>
                    <h4 className="font-medium mb-4">Controle de Acesso</h4>
                    <div className="space-y-4">
                      <div>
                        <Label className="text-sm font-medium">Visualizar Pipeline</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Usuários que podem visualizar este pipeline
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selectedPipeline.permissions.view.map((role) => (
                            <Badge key={role} variant="outline">{role}</Badge>
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Editar Pipeline</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Usuários que podem editar este pipeline
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selectedPipeline.permissions.edit.map((role) => (
                            <Badge key={role} variant="outline">{role}</Badge>
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Excluir Pipeline</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Usuários que podem excluir este pipeline
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selectedPipeline.permissions.delete.map((role) => (
                            <Badge key={role} variant="outline">{role}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}

      {/* Create/Edit Pipeline Dialogs would go here */}
    </div>
  )
}
