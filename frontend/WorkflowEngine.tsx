import { useState } from 'react'
import { useKV } from '@/spark-mock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/card"
import { Button } from "@/button"
import { Badge } from "@/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/tabs"
import { Input } from "@/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/select"
import { Textarea } from "@/textarea"
import { Switch } from "@/switch"
import {
  FlowArrow,
  Play,
  Pause,
  Stop,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Plus,
  Eye,
  Gear,
  ArrowRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Diamond,
  Circle
} from "@phosphor-icons/react"

interface WorkflowState {
  id: string
  name: string
  description: string
  isStart: boolean
  isEnd: boolean
  actions: WorkflowAction[]
  color: string
}

interface WorkflowAction {
  id: string
  name: string
  type: 'approve' | 'reject' | 'submit' | 'return' | 'custom'
  nextState: string
  requiredRole?: string
  condition?: string
  notification?: {
    enabled: boolean
    template: string
    recipients: string[]
  }
}

interface Workflow {
  id: string
  name: string
  description: string
  documentType: string
  states: WorkflowState[]
  currentState: string
  isActive: boolean
  createdBy: string
  createdAt: string
  version: number
}

interface WorkflowInstance {
  id: string
  workflowId: string
  documentId: string
  documentType: string
  currentState: string
  startedAt: string
  completedAt?: string
  assignedTo?: string
  history: WorkflowHistory[]
  status: 'running' | 'completed' | 'cancelled' | 'error'
}

interface WorkflowHistory {
  id: string
  instanceId: string
  fromState: string
  toState: string
  action: string
  userId: string
  userName: string
  timestamp: string
  comment?: string
}

export function WorkflowEngine() {
  const [activeTab, setActiveTab] = useState("workflows")
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("")

  // Persistent data
  const [workflows, setWorkflows] = useKV<Workflow[]>("workflows", [
    {
      id: "1",
      name: "Aprovação de Vendas",
      description: "Fluxo de aprovação para oportunidades de vendas acima de R$ 10.000",
      documentType: "opportunity",
      currentState: "draft",
      states: [
        {
          id: "draft",
          name: "Rascunho",
          description: "Oportunidade em elaboração",
          isStart: true,
          isEnd: false,
          color: "#94a3b8",
          actions: [
            {
              id: "submit",
              name: "Enviar para Aprovação",
              type: "submit",
              nextState: "pending_approval"
            }
          ]
        },
        {
          id: "pending_approval",
          name: "Aguardando Aprovação",
          description: "Aguardando aprovação do gerente",
          isStart: false,
          isEnd: false,
          color: "#f59e0b",
          actions: [
            {
              id: "approve",
              name: "Aprovar",
              type: "approve",
              nextState: "approved",
              requiredRole: "manager"
            },
            {
              id: "reject",
              name: "Rejeitar",
              type: "reject",
              nextState: "rejected",
              requiredRole: "manager"
            },
            {
              id: "return",
              name: "Retornar",
              type: "return",
              nextState: "draft",
              requiredRole: "manager"
            }
          ]
        },
        {
          id: "approved",
          name: "Aprovado",
          description: "Oportunidade aprovada para fechamento",
          isStart: false,
          isEnd: true,
          color: "#10b981",
          actions: []
        },
        {
          id: "rejected",
          name: "Rejeitado",
          description: "Oportunidade rejeitada",
          isStart: false,
          isEnd: true,
          color: "#ef4444",
          actions: []
        }
      ],
      isActive: true,
      createdBy: "admin",
      createdAt: "2024-01-15",
      version: 1
    }
  ])

  const [workflowInstances, setWorkflowInstances] = useKV<WorkflowInstance[]>("workflow_instances", [
    {
      id: "inst_1",
      workflowId: "1",
      documentId: "opp_001",
      documentType: "opportunity",
      currentState: "pending_approval",
      startedAt: "2024-03-15T10:00:00Z",
      assignedTo: "manager_01",
      status: "running",
      history: [
        {
          id: "hist_1",
          instanceId: "inst_1",
          fromState: "draft",
          toState: "pending_approval",
          action: "submit",
          userId: "user_01",
          userName: "João Silva",
          timestamp: "2024-03-15T10:00:00Z",
          comment: "Enviando para aprovação - valor R$ 15.000"
        }
      ]
    }
  ])

  const [workflowHistory, setWorkflowHistory] = useKV<WorkflowHistory[]>("workflow_history", [])

  // Form states
  const [newWorkflow, setNewWorkflow] = useState({
    name: "",
    description: "",
    documentType: "",
    states: [
      {
        id: "draft",
        name: "Rascunho",
        description: "",
        isStart: true,
        isEnd: false,
        color: "#94a3b8",
        actions: []
      }
    ]
  })

  const [draggedState, setDraggedState] = useState<string | null>(null)

  const getStateIcon = (state: WorkflowState) => {
    if (state.isStart) return <Circle className="h-5 w-5" />
    if (state.isEnd) return <CheckCircle className="h-5 w-5" />
    return <Diamond className="h-5 w-5" />
  }

  const getStatusColor = (status: WorkflowInstance['status']) => {
    switch (status) {
      case 'running': return 'bg-blue-100 text-blue-800'
      case 'completed': return 'bg-green-100 text-green-800'
      case 'cancelled': return 'bg-gray-100 text-gray-800'
      case 'error': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const executeAction = (instanceId: string, actionId: string, comment?: string) => {
    setWorkflowInstances(prev =>
      prev.map(instance => {
        if (instance.id !== instanceId) return instance

        const workflow = workflows.find(w => w.id === instance.workflowId)
        if (!workflow) return instance

        const currentState = workflow.states.find(s => s.id === instance.currentState)
        if (!currentState) return instance

        const action = currentState.actions.find(a => a.id === actionId)
        if (!action) return instance

        const historyEntry: WorkflowHistory = {
          id: Date.now().toString(),
          instanceId: instance.id,
          fromState: instance.currentState,
          toState: action.nextState,
          action: action.name,
          userId: 'current_user',
          userName: 'Usuário Atual',
          timestamp: new Date().toISOString(),
          comment
        }

        const newState = workflow.states.find(s => s.id === action.nextState)
        const isCompleted = newState?.isEnd || false

        return {
          ...instance,
          currentState: action.nextState,
          completedAt: isCompleted ? new Date().toISOString() : instance.completedAt,
          status: isCompleted ? 'completed' as const : instance.status,
          history: [...instance.history, historyEntry]
        }
      })
    )
  }

  const createWorkflowInstance = (workflowId: string, documentId: string, documentType: string) => {
    const workflow = workflows.find(w => w.id === workflowId)
    if (!workflow) return

    const startState = workflow.states.find(s => s.isStart)
    if (!startState) return

    const instance: WorkflowInstance = {
      id: Date.now().toString(),
      workflowId,
      documentId,
      documentType,
      currentState: startState.id,
      startedAt: new Date().toISOString(),
      status: 'running',
      history: []
    }

    setWorkflowInstances(prev => [...prev, instance])
  }

  const cancelWorkflowInstance = (instanceId: string) => {
    setWorkflowInstances(prev =>
      prev.map(instance =>
        instance.id === instanceId
          ? { ...instance, status: 'cancelled' as const }
          : instance
      )
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <FlowArrow className="h-6 w-6 text-primary" />
            <span>Engine de Workflows</span>
          </h2>
          <p className="text-muted-foreground">
            Sistema visual de workflows com aprovações e automações
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Novo Workflow
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <FlowArrow className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Workflows Ativos</p>
                <p className="text-2xl font-bold">
                  {workflows.filter(w => w.isActive).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Em Andamento</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {workflowInstances.filter(i => i.status === 'running').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Concluídos</p>
                <p className="text-2xl font-bold text-green-600">
                  {workflowInstances.filter(i => i.status === 'completed').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Cancelados</p>
                <p className="text-2xl font-bold text-red-600">
                  {workflowInstances.filter(i => i.status === 'cancelled').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="instances">Instâncias</TabsTrigger>
          <TabsTrigger value="designer">Designer</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="workflows" className="space-y-6">
          {/* Workflows List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {workflows.map(workflow => (
              <Card key={workflow.id} className="glass-card">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{workflow.name}</CardTitle>
                      <CardDescription>{workflow.description}</CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={workflow.isActive ? 'default' : 'secondary'}>
                        {workflow.isActive ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Tipo de Documento</span>
                      <span className="font-medium">{workflow.documentType}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Estados</span>
                      <span className="font-medium">{workflow.states.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Versão</span>
                      <span className="font-medium">v{workflow.version}</span>
                    </div>
                  </div>

                  {/* Workflow States Preview */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Estados do Workflow</h4>
                    <div className="flex flex-wrap gap-2">
                      {workflow.states.map(state => (
                        <div key={state.id} className="flex items-center space-x-1">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: state.color }}
                          ></div>
                          <span className="text-xs">{state.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 pt-4 border-t">
                    <Button variant="outline" size="sm" className="flex-1">
                      <Eye className="h-4 w-4 mr-2" />
                      Visualizar
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      <Gear className="h-4 w-4 mr-2" />
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => createWorkflowInstance(workflow.id, 'test_doc', workflow.documentType)}
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Executar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="instances" className="space-y-6">
          {/* Workflow Instances */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Instâncias de Workflow</CardTitle>
              <CardDescription>
                Execuções ativas e históricas dos workflows
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {workflowInstances.map(instance => {
                  const workflow = workflows.find(w => w.id === instance.workflowId)
                  const currentState = workflow?.states.find(s => s.id === instance.currentState)

                  return (
                    <div key={instance.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <Badge className={getStatusColor(instance.status)}>
                            {instance.status === 'running' ? 'Em Andamento' :
                              instance.status === 'completed' ? 'Concluído' :
                                instance.status === 'cancelled' ? 'Cancelado' : 'Erro'}
                          </Badge>
                          <span className="font-medium">{workflow?.name}</span>
                          <span className="text-sm text-muted-foreground">
                            Doc: {instance.documentId}
                          </span>
                        </div>
                        <div className="flex items-center space-x-4 text-sm">
                          <span className="flex items-center space-x-1">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: currentState?.color || '#94a3b8' }}
                            ></div>
                            <span>Estado: {currentState?.name}</span>
                          </span>
                          <span>Iniciado: {new Date(instance.startedAt).toLocaleDateString('pt-BR')}</span>
                          {instance.assignedTo && (
                            <span className="flex items-center space-x-1">
                              <User className="h-4 w-4" />
                              <span>{instance.assignedTo}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {instance.status === 'running' && currentState?.actions.map(action => (
                          <Button
                            key={action.id}
                            variant="outline"
                            size="sm"
                            onClick={() => executeAction(instance.id, action.id)}
                          >
                            {action.name}
                          </Button>
                        ))}
                        {instance.status === 'running' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => cancelWorkflowInstance(instance.id)}
                          >
                            <Stop className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}

                {workflowInstances.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <FlowArrow className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhuma instância de workflow encontrada</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="designer" className="space-y-6">
          {/* Workflow Designer */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Designer Visual de Workflows</CardTitle>
              <CardDescription>
                Crie e edite workflows através de interface visual drag-and-drop
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Workflow Canvas */}
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 min-h-96 bg-muted/5">
                  <div className="text-center text-muted-foreground">
                    <FlowArrow className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-2">Canvas do Workflow</h3>
                    <p className="text-sm">Arraste e solte estados e ações para criar seu workflow</p>

                    {/* Sample Workflow Visual */}
                    <div className="flex items-center justify-center space-x-4 mt-8">
                      <div className="flex flex-col items-center space-y-2">
                        <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
                          <Circle className="h-8 w-8 text-gray-600" />
                        </div>
                        <span className="text-xs font-medium">Início</span>
                      </div>

                      <ArrowRight className="h-6 w-6 text-muted-foreground" />

                      <div className="flex flex-col items-center space-y-2">
                        <div className="w-16 h-16 rounded-lg bg-yellow-200 flex items-center justify-center">
                          <Diamond className="h-8 w-8 text-yellow-600" />
                        </div>
                        <span className="text-xs font-medium">Aprovação</span>
                      </div>

                      <ArrowRight className="h-6 w-6 text-muted-foreground" />

                      <div className="flex flex-col items-center space-y-2">
                        <div className="w-16 h-16 rounded-full bg-green-200 flex items-center justify-center">
                          <CheckCircle className="h-8 w-8 text-green-600" />
                        </div>
                        <span className="text-xs font-medium">Fim</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Toolbar */}
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center space-x-4">
                    <h4 className="font-medium">Componentes</h4>
                    <div className="flex items-center space-x-2">
                      <Button variant="outline" size="sm">
                        <Circle className="h-4 w-4 mr-2" />
                        Estado Inicial
                      </Button>
                      <Button variant="outline" size="sm">
                        <Diamond className="h-4 w-4 mr-2" />
                        Estado Processo
                      </Button>
                      <Button variant="outline" size="sm">
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Estado Final
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm">
                      Salvar
                    </Button>
                    <Button size="sm">
                      Publicar
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          {/* Workflow History */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Histórico de Execuções</CardTitle>
              <CardDescription>
                Registro detalhado de todas as transições de workflow
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {workflowInstances.flatMap(instance =>
                  instance.history.map(entry => (
                    <div key={entry.id} className="flex items-center space-x-4 p-4 border rounded-lg">
                      <div className="w-2 h-8 bg-primary rounded-full"></div>
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-1">
                          <span className="font-medium">{entry.action}</span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{entry.fromState} → {entry.toState}</span>
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                          <span className="flex items-center space-x-1">
                            <User className="h-4 w-4" />
                            <span>{entry.userName}</span>
                          </span>
                          <span>{new Date(entry.timestamp).toLocaleString('pt-BR')}</span>
                          {entry.comment && (
                            <span className="italic">"{entry.comment}"</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ).sort((a, b) => new Date(b.props.children[1].props.children[1].props.children[1].props.children).getTime() - new Date(a.props.children[1].props.children[1].props.children[1].props.children).getTime())}

                {workflowInstances.every(i => i.history.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum histórico de workflow encontrado</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
